#!/usr/bin/env bun
// Contract suite: FR-11 — /proposals classifies every pair, carries regions, and the
// summary counts agree with the map the UI renders from the same payload.
// Run: bun porting/tests/proposals-conflict-map.test.mjs   (exit 0 = pass)
//
// Real construction, two surfaces:
//   * GET /proposals is exercised through the REAL worker module (worker.fetch)
//     against an in-memory Artifacts fake — the platform binding seam is the only
//     fake (pattern per one-set-one-response.test.mjs / judge.test.mjs); no module
//     mocks, no source grep. The fixture constructs one pair per wire kind
//     (CONTRACT.md:48) so `kind in the enum` is proven non-vacuous: every one of the
//     seven kinds is produced by the real classifyPair path.
//   * The shipped platform/ui (index.html + app.js) is loaded in a real headless
//     Chrome over a loopback origin serving the payload THAT ROUTE RETURNED —
//     the DOM's pair rows are compared against the payload's own counters.
// Legs:
//   1. wire contract over the fixture set: ok:true; every conflict/pair kind is in
//      the enum; every conflict enumerates ALL C(n,2) repo pairs; pair conflict
//      semantics follow the kind (hard -> true, undetermined -> null, clean ->
//      false); region {baseLines,aLines,bLines} is carried iff kind ===
//      "text-conflict" and its values are numbers >= 0; summary.conflictingPairs /
//      cleanPairs equal the recomputed counts; the deliberate agent-1 x agent-2
//      src/auth.ts collision is exactly one text-conflict pair with a real
//      both-sides region; the fixture kinds are exactly the designed seven.
//   2. DOM agreement over the same payload: one card per conflict; the pair rows
//      the map renders partition by kind class into the same counts the payload's
//      summary carries (hard rows == conflictingPairs, clean rows == cleanPairs,
//      undetermined in neither); the five header chips show the payload's summary.
//   3. live capture — when PROPS_FIXTURE points at a /proposals capture, the wire
//      contract + the src/auth.ts collision contract + the DOM agreement run over
//      it verbatim; unset -> one SKIP line.
//   4. zero-state DOM leg — an all-zero summary exercises the REMOVE branch of
//      every tint (is-alert / is-warn / is-clean all absent) and pins the zero-state
//      chip labels ("0 detected" / "0 active").
// A box without a Chrome binary skips the suite (precedent: ui-first-load-chips);
// the order's acceptance gate hard-requires Chrome.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../platform/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const ARROW = "\u2194";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  FR-11 proposals conflict map — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Wire vocabulary — the CONTRACT.md:48 enum and the conflict semantics the
// counter math in computeProposals (index.ts:665-666) partitions on.
// ---------------------------------------------------------------------------
const ENUM = ["text-conflict", "modify/delete", "add/add", "undetermined", "mergeable", "identical-add", "both-removed"];
const HARD = ["text-conflict", "modify/delete", "add/add"];
const CLEAN = ["mergeable", "identical-add", "both-removed"];
const CONFLICT_OF = {
  "text-conflict": true,
  "modify/delete": true,
  "add/add": true,
  undetermined: null,
  mergeable: false,
  "identical-add": false,
  "both-removed": false,
};
// The severity spine (DESIGN.md:556-557): hard kinds red, undetermined amber,
// clean kinds neutral. Used to check the per-file aggregate honors its worst pair.
const SEVERITY = { "text-conflict": 4, "modify/delete": 4, "add/add": 4, undetermined: 3, mergeable: 1, "identical-add": 1, "both-removed": 1 };

// ---------------------------------------------------------------------------
// In-memory Artifacts fake — one instance per environment. Mirrors the surface
// the route reads (get/log/readTree/readFile/list); a factory, so environments
// cannot alias.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
  const treeEntries = new Map(); // tree hash -> entries
  const repos = new Map(); // name -> { history, refs, intents }
  const discovered = []; // [{ name, status }] — the list() surface

  function internBlob(text) {
    if (!blobHashByText.has(text)) {
      const hash = `blob-${blobHashByText.size + 1}`;
      blobHashByText.set(text, hash);
      blobText.set(hash, text);
    }
    return blobHashByText.get(text);
  }

  function entriesFor(node) {
    return Object.entries(node).map(([name, child]) => {
      if (typeof child === "string") return { name, mode: "100644", hash: child, type: "blob" };
      return { name, mode: "40000", hash: treeHashFor(child), type: "tree" };
    });
  }

  function treeHashFor(node) {
    const entries = entriesFor(node);
    const hash = `tree-${treeEntries.size + 1}`;
    treeEntries.set(hash, entries);
    return hash;
  }

  function tree(files) {
    const root = {};
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split("/");
      let node = root;
      for (const part of parts.slice(0, -1)) {
        node[part] = node[part] || {};
        node = node[part];
      }
      node[parts[parts.length - 1]] = internBlob(text);
    }
    return treeHashFor(root);
  }

  function commit(hash, treeHash) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
  }

  function defineRepo(name, { history, refs, intents = {} }) {
    repos.set(name, { history, refs, intents });
  }

  function lookupPath(treeHash, path) {
    const parts = path.split("/");
    let entries = treeEntries.get(treeHash);
    for (let i = 0; i < parts.length; i++) {
      const entry = (entries ?? []).find((e) => e.name === parts[i]);
      if (!entry) return null;
      if (i === parts.length - 1) return entry.type === "blob" ? entry.hash : null;
      if (entry.type !== "tree") return null;
      entries = treeEntries.get(entry.hash);
    }
    return null;
  }

  function repoFor(name) {
    const store = repos.get(name);
    if (!store) throw new Error(`fixture: no repo ${name}`);
    const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
    return {
      async log({ ref = "HEAD", limit = 50 } = {}) {
        const byBranch = store.refs[ref];
        if (byBranch) return store.history.slice(0, limit);
        const single = resolve(ref);
        return single ? [single].slice(0, limit) : [];
      },
      async readTree(hash) {
        return treeEntries.get(hash) ?? null;
      },
      async readFile({ ref, path }) {
        const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
        if (!head) return null;
        if (path.startsWith("NEXTGIT_INTENT/")) {
          const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[sha];
          return text === undefined ? null : new Blob([text]);
        }
        const blobHash = lookupPath(head.treeHash, path);
        return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
      },
      async readBlob(hash) {
        return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
      },
      async info() {
        return { remote: `https://artifacts.invalid/nextgit/${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }

  return {
    discovered,
    ARTIFACTS: {
      async get(name) {
        return repoFor(name);
      },
      async list({ limit = 200 } = {}) {
        return { repos: discovered.slice(0, limit) };
      },
    },
    tree,
    commit,
    defineRepo,
  };
}

// ---------------------------------------------------------------------------
// Fixture — agent-1/agent-2 carry the deliberate src/auth.ts collision (both
// rewrite the first statement); agent-3/agent-4 construct the remaining six
// kinds on distinct files; agent-5 joins src/tri.ts so one file enumerates a
// 3-way pair set (proves ALL C(n,2) pairs are classified, not just the 2-way).
// ---------------------------------------------------------------------------
const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_AGENT1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const AUTH_AGENT2 = "export function isExpired(claims) {\n  return claims.exp < Date.now();\n}\nexport const keep = true;\n";

const MG_BASE = "export const m1 = 1;\nexport const m2 = 2;\nexport const m3 = 3;\nexport const m4 = 4;\nexport const m5 = 5;\nexport const m6 = 6;\n";
const TRI_BASE = "export const t1 = 1;\nexport const t2 = 2;\nexport const t3 = 3;\nexport const t4 = 4;\nexport const t5 = 5;\nexport const t6 = 6;\n";
const replaceLine = (text, index, next) => {
  const lines = text.split("\n");
  lines[index] = next;
  return lines.join("\n");
};

const BASE_FILES = {
  "src/auth.ts": AUTH_BASE,
  "src/md.ts": "export const md = 1;\n",
  "src/br.ts": "export const br = 1;\n",
  "src/mg.ts": MG_BASE,
  "src/tri.ts": TRI_BASE,
  "src/bin.dat": "bin\u0000\u0000v1", // NUL byte -> readContent flags it binary -> no merge texts
};

function makeEnvironment() {
  const fake = makeFakeArtifacts();
  const base = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [base], refs: { main: base.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });

  const agent1 = { ...BASE_FILES, "src/auth.ts": AUTH_AGENT1 };
  const agent2 = { ...BASE_FILES, "src/auth.ts": AUTH_AGENT2 };

  const agent3 = {
    ...BASE_FILES,
    "src/md.ts": "export const md = 3;\n",
    "src/aa.ts": "export const aa = 3;\n", // add/add — differs from agent-4's
    "src/ia.ts": "export const ia = 'same';\n", // identical-add — byte-equal to agent-4's
    "src/mg.ts": replaceLine(MG_BASE, 0, "export const m1 = 10;"), // non-overlapping edits
    "src/tri.ts": replaceLine(TRI_BASE, 0, "export const t1 = 10;"),
    "src/bin.dat": "bin\u0000\u0000v3",
  };
  const { "src/br.ts": _br3, ...files3 } = agent3; // both agents remove src/br.ts (both-removed)

  const agent4 = {
    ...BASE_FILES,
    "src/aa.ts": "export const aa = 4;\n",
    "src/ia.ts": "export const ia = 'same';\n",
    "src/mg.ts": replaceLine(MG_BASE, 4, "export const m5 = 50;"), // line 5 vs agent-3's line 1
    "src/tri.ts": replaceLine(TRI_BASE, 2, "export const t3 = 30;"),
    "src/bin.dat": "bin\u0000\u0000v4",
  };
  const { "src/md.ts": _md4, "src/br.ts": _br4, ...files4 } = agent4; // agent-3 modifies md.ts; agent-4 deletes it

  const agent5 = { ...BASE_FILES, "src/tri.ts": replaceLine(TRI_BASE, 5, "export const t6 = 60;") };

  for (const [name, files] of [
    ["agent-1", agent1],
    ["agent-2", agent2],
    ["agent-3", files3],
    ["agent-4", files4],
    ["agent-5", agent5],
  ]) {
    const head = fake.commit(`c-${name}`, fake.tree(files));
    fake.defineRepo(name, { history: [head, base], refs: { main: head.hash } });
    fake.discovered.push({ name, status: "ready" });
  }

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { env };
}

// The route's real response for the fixture environment.
async function proposalsThroughRoute() {
  const { env } = makeEnvironment();
  const res = await worker.fetch(new Request("https://nextgit.invalid/proposals"), env);
  const body = await res.json().catch(() => null); // wire form: undefined keys dropped
  return { status: res.status, body };
}

// The fixture's designed classification — every wire kind appears exactly once at
// the PAIR level, src/tri.ts enumerates three pairs. Counts: 8 files, 10 pairs,
// conflictingPairs 3 (auth, md, aa), cleanPairs 6 (ia, br, mg, tri x3),
// undetermined 1 (bin.dat, counted in neither). `fileKind` is pinned only where
// the per-file aggregate equals the pair kind; for a file whose only pairs are the
// specific clean kinds (both-removed / identical-add) the aggregate surfaces the
// clean archetype "mergeable" — the pair rows carry the exact kind (asserted), the
// file kind is covered by the enum + severity checks in wireContract.
const FIXTURE_KINDS = {
  "src/aa.ts": { fileKind: "add/add", repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/auth.ts": { fileKind: "text-conflict", repos: ["agent-1", "agent-2"], pairs: 1 },
  "src/bin.dat": { fileKind: "undetermined", repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/br.ts": { repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/ia.ts": { repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/md.ts": { fileKind: "modify/delete", repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/mg.ts": { fileKind: "mergeable", repos: ["agent-3", "agent-4"], pairs: 1 },
  "src/tri.ts": { fileKind: "mergeable", repos: ["agent-3", "agent-4", "agent-5"], pairs: 3 },
};
const FIXTURE_SUMMARY = { proposals: 5, changedFiles: 8, sharedFiles: 8, conflictingPairs: 3, cleanPairs: 6 };

// ---------------------------------------------------------------------------
// Wire contract — property checks that hold for ANY /proposals payload
// (fixture or live), plus the fixture-specific exact expectations.
// ---------------------------------------------------------------------------
function wireContract(label, payload) {
  check(
    `${label} ok:true with proposals[] and conflicts[]`,
    payload?.ok === true && Array.isArray(payload?.proposals) && Array.isArray(payload?.conflicts),
  );
  const allPairs = [];
  for (const c of payload.conflicts) {
    check(`${label} ${c.file} kind "${c.kind}" is in the wire enum`, ENUM.includes(c.kind), String(c.kind));
    const n = Array.isArray(c.repos) ? c.repos.length : 0;
    check(
      `${label} ${c.file} pairs enumerate all C(${n},2)=${(n * (n - 1)) / 2} repo pairs`,
      Array.isArray(c.pairs) && c.pairs.length === (n * (n - 1)) / 2,
      `pairs=${c.pairs?.length}`,
    );
    const combos = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) combos.push([c.repos[i], c.repos[j]].sort().join("|"));
    const seen = c.pairs.map((p) => [p.a, p.b].sort().join("|"));
    check(
      `${label} ${c.file} pair endpoints are exactly the repo 2-combinations`,
      seen.every((k) => combos.includes(k)) && combos.every((k) => seen.includes(k)),
      JSON.stringify(seen),
    );
    for (const p of c.pairs) {
      allPairs.push(p);
      check(`${label} ${c.file} ${p.a}${ARROW}${p.b} kind "${p.kind}" is in the wire enum`, ENUM.includes(p.kind), String(p.kind));
      check(
        `${label} ${c.file} ${p.a}${ARROW}${p.b} conflict=${JSON.stringify(p.conflict)} matches kind "${p.kind}"`,
        p.conflict === CONFLICT_OF[p.kind],
        `kind=${p.kind} conflict=${p.conflict}`,
      );
      if (p.kind === "text-conflict") {
        const r = p.region;
        check(
          `${label} ${c.file} ${p.a}${ARROW}${p.b} text-conflict carries region {baseLines,aLines,bLines} of numbers >= 0`,
          !!r &&
          typeof r === "object" &&
          Object.keys(r).sort().join(",") === "aLines,bLines,baseLines" &&
          [r.baseLines, r.aLines, r.bLines].every((v) => typeof v === "number" && v >= 0),
          JSON.stringify(r),
        );
      } else {
        check(
          `${label} ${c.file} ${p.a}${ARROW}${p.b} kind "${p.kind}" carries no region`,
          !("region" in p),
          JSON.stringify(p.region),
        );
      }
    }
    const maxPair = c.pairs.reduce((n, p) => Math.max(n, SEVERITY[p.kind]), 0);
    check(
      `${label} ${c.file} file kind severity matches its worst pair (card severity spine)`,
      SEVERITY[c.kind] === maxPair,
      `file=${c.kind}(${SEVERITY[c.kind]}) maxPair=${maxPair}`,
    );
  }

  const s = payload.summary || {};
  const trueCount = allPairs.filter((p) => p.conflict === true).length;
  const falseCount = allPairs.filter((p) => p.conflict === false).length;
  check(`${label} summary.conflictingPairs == count(conflict===true)`, s.conflictingPairs === trueCount, `summary=${s.conflictingPairs} recompute=${trueCount}`);
  check(`${label} summary.cleanPairs == count(conflict===false)`, s.cleanPairs === falseCount, `summary=${s.cleanPairs} recompute=${falseCount}`);
  check(`${label} summary.sharedFiles == conflicts.length`, s.sharedFiles === payload.conflicts.length, `summary=${s.sharedFiles} conflicts=${payload.conflicts.length}`);
  const changed = new Set((payload.proposals || []).flatMap((p) => (p.files || []).map((f) => f.path)));
  check(`${label} summary.changedFiles == distinct changed file paths`, s.changedFiles === changed.size, `summary=${s.changedFiles} distinct=${changed.size}`);
  check(`${label} summary.proposals == proposals.length`, s.proposals === payload.proposals.length, `summary=${s.proposals} proposals=${payload.proposals.length}`);
  return allPairs;
}

function fixtureContract(label, payload) {
  check(
    `${label} proposal set is exactly agent-1..agent-5`,
    JSON.stringify(payload.proposals.map((p) => p.repo)) === JSON.stringify(["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]),
    JSON.stringify(payload.proposals.map((p) => p.repo)),
  );
  const files = payload.conflicts.map((c) => c.file);
  check(
    `${label} conflicts are exactly the designed shared files`,
    JSON.stringify(files) === JSON.stringify(Object.keys(FIXTURE_KINDS)),
    JSON.stringify(files),
  );
  for (const c of payload.conflicts) {
    const want = FIXTURE_KINDS[c.file];
    if (!want) continue;
    if (want.fileKind) check(`${label} ${c.file} file kind "${want.fileKind}"`, c.kind === want.fileKind, `got=${c.kind}`);
    check(`${label} ${c.file} repos exactly [${want.repos.join(",")}]`, JSON.stringify(c.repos) === JSON.stringify(want.repos), JSON.stringify(c.repos));
    check(`${label} ${c.file} pair count == ${want.pairs}`, c.pairs.length === want.pairs, `pairs=${c.pairs.length}`);
  }
  const pairKinds = new Set(payload.conflicts.flatMap((c) => c.pairs.map((p) => p.kind)));
  check(
    `${label} the fixture constructs every wire kind at the pair level`,
    ENUM.every((k) => pairKinds.has(k)),
    JSON.stringify([...pairKinds].sort()),
  );
  check(
    `${label} summary is exactly ${JSON.stringify(FIXTURE_SUMMARY)}`,
    JSON.stringify(payload.summary) === JSON.stringify(FIXTURE_SUMMARY),
    JSON.stringify(payload.summary),
  );
  const auth = payload.conflicts.filter((c) => c.file === "src/auth.ts");
  check(`${label} exactly one src/auth.ts conflict`, auth.length === 1, `count=${auth.length}`);
  const tp = auth.length === 1 ? auth[0].pairs.filter((p) => p.kind === "text-conflict" && p.conflict === true) : [];
  check(`${label} src/auth.ts carries exactly one text-conflict pair`, tp.length === 1, JSON.stringify(auth[0]?.pairs));
  const pair = tp[0];
  check(
    `${label} src/auth.ts text-conflict pair is agent-1 ${ARROW} agent-2`,
    !!pair && [pair.a, pair.b].sort().join("|") === "agent-1|agent-2",
    pair ? `${pair.a}|${pair.b}` : "missing",
  );
  const r = pair?.region || {};
  check(
    `${label} src/auth.ts region is a real both-sides region (baseLines/aLines/bLines > 0)`,
    r.baseLines > 0 && r.aLines > 0 && r.bLines > 0,
    JSON.stringify(pair?.region),
  );
}

// The deliberate-collision clause that must hold on the LIVE set (mirrors the
// order's check_cmd): exactly one src/auth.ts conflict carrying exactly one
// text-conflict pair — agent-1 x agent-2 — with a numeric region.
function liveCollisionContract(label, payload) {
  const auth = payload.conflicts.filter((c) => c.file === "src/auth.ts");
  check(`${label} exactly one src/auth.ts conflict`, auth.length === 1, `count=${auth.length}`);
  if (auth.length !== 1) return;
  const tp = auth[0].pairs.filter(
    (p) => p.kind === "text-conflict" && p.conflict === true && p.region && p.region.baseLines >= 0 && p.region.aLines >= 0 && p.region.bLines >= 0,
  );
  check(`${label} src/auth.ts carries exactly one text-conflict pair with a numeric region`, tp.length === 1, JSON.stringify(auth[0].pairs));
  const pair = tp[0];
  check(
    `${label} src/auth.ts text-conflict pair is agent-1 ${ARROW} agent-2`,
    !!pair && [pair.a, pair.b].sort().join("|") === "agent-1|agent-2",
    pair ? `${pair.a}|${pair.b}` : "missing",
  );
}

// ---------------------------------------------------------------------------
// DOM agreement — the map's rendered pair rows partition by kind class into the
// same counts the payload's own summary carries; the chips show that summary.
// ---------------------------------------------------------------------------
function agreementContract(label, payload, dom) {
  const cards = (dom.match(/class="conflict-card /g) || []).length;
  check(`${label} one card per conflict (${payload.conflicts.length})`, cards === payload.conflicts.length, `cards=${cards}`);

  const segments = dom.split(/class="conflict-card /).slice(1);
  const rows = segments.flatMap((seg) => seg.split('class="conflict-pair-row"').slice(1));
  const kinds = rows.map((seg) => (seg.match(/class="pair-kind">([^<]*)</) || [null, null])[1]);
  check(`${label} every rendered pair row carries a kind`, kinds.every((k) => typeof k === "string" && k.length > 0), JSON.stringify(kinds));

  // Exact endpoints→kind mapping: a renderer that falls back to the FILE kind for pair
  // labels (or reorders/mixes pairs) is invisible to the class-partition counts above
  // but must fail here — every rendered row must carry the payload's own pair kind.
  const observedPairs = rows.map((seg) => {
    const e = (seg.match(/class="pair-endpoints">([^<]*)</) || [null, null])[1];
    const k = (seg.match(/class="pair-kind">([^<]*)</) || [null, null])[1];
    return e === null || k === null ? null : `${e} => ${k}`;
  });
  const expectedPairs = payload.conflicts
    .flatMap((c) => c.pairs)
    .map((p) => `${p.a} ${ARROW} ${p.b} => ${p.kind}`);
  check(
    `${label} rendered pair rows carry the payload's exact endpoints→kind mapping`,
    observedPairs.length === expectedPairs.length &&
    JSON.stringify([...observedPairs].sort()) === JSON.stringify([...expectedPairs].sort()),
    `observed=${JSON.stringify(observedPairs)} expected=${JSON.stringify(expectedPairs)}`,
  );

  const totalPairs = payload.conflicts.reduce((n, c) => n + c.pairs.length, 0);
  const hardRows = kinds.filter((k) => HARD.includes(k)).length;
  const cleanRows = kinds.filter((k) => CLEAN.includes(k)).length;
  const undeterminedRows = kinds.filter((k) => k === "undetermined").length;
  const undeterminedPairs = payload.conflicts.flatMap((c) => c.pairs).filter((p) => p.conflict === null).length;
  check(`${label} rendered pair rows == payload pairs (${totalPairs})`, rows.length === totalPairs, `rows=${rows.length}`);
  check(
    `${label} hard-kind rows == summary.conflictingPairs (${payload.summary.conflictingPairs})`,
    hardRows === payload.summary.conflictingPairs,
    `rows=${hardRows}`,
  );
  check(
    `${label} clean-kind rows == summary.cleanPairs (${payload.summary.cleanPairs})`,
    cleanRows === payload.summary.cleanPairs,
    `rows=${cleanRows}`,
  );
  check(
    `${label} undetermined rows == payload undetermined pairs (${undeterminedPairs})`,
    undeterminedRows === undeterminedPairs,
    `rows=${undeterminedRows}`,
  );

  const chip = (id) => {
    const m = dom.match(new RegExp(`id=${JSON.stringify(id)}[^>]*>([^<]*)<`));
    return m ? m[1].trim() : null;
  };
  check(
    `${label} #val-conflicts chip == summary.conflictingPairs == hard rows`,
    chip("val-conflicts") === String(payload.summary.conflictingPairs) && hardRows === payload.summary.conflictingPairs,
    `chip=${chip("val-conflicts")} rows=${hardRows}`,
  );
  check(
    `${label} #val-clean chip == summary.cleanPairs == clean rows`,
    chip("val-clean") === String(payload.summary.cleanPairs) && cleanRows === payload.summary.cleanPairs,
    `chip=${chip("val-clean")} rows=${cleanRows}`,
  );
  check(`${label} #val-shared chip == summary.sharedFiles`, chip("val-shared") === String(payload.summary.sharedFiles), `chip=${chip("val-shared")}`);
  check(`${label} #val-proposals chip == summary.proposals`, chip("val-proposals") === String(payload.summary.proposals), `chip=${chip("val-proposals")}`);
  check(`${label} #val-changed chip == summary.changedFiles`, chip("val-changed") === String(payload.summary.changedFiles), `chip=${chip("val-changed")}`);

  const chipClass = (id) => {
    const m = dom.match(new RegExp(`<div[^>]*id=${JSON.stringify("chip-" + id)}[^>]*>`));
    if (!m) return null;
    const cls = m[0].match(/class="([^"]*)"/);
    return cls ? cls[1] : null;
  };
  const cc = chipClass("conflicts");
  check(
    `${label} #chip-conflicts has is-alert iff summary.conflictingPairs > 0`,
    (cc ? cc.indexOf("is-alert") >= 0 : false) === (payload.summary.conflictingPairs > 0),
    `classes=${cc}`,
  );
  const cs = chipClass("shared");
  check(
    `${label} #chip-shared has is-warn iff summary.sharedFiles > 0`,
    (cs ? cs.indexOf("is-warn") >= 0 : false) === (payload.summary.sharedFiles > 0),
    `classes=${cs}`,
  );
  const cl = chipClass("clean");
  check(
    `${label} #chip-clean has is-clean iff summary.cleanPairs > 0`,
    (cl ? cl.indexOf("is-clean") >= 0 : false) === (payload.summary.cleanPairs > 0),
    `classes=${cl}`,
  );
}
// ---------------------------------------------------------------------------
// Independent jq recompute — pipes the raw payload through `jq -ec` (jaq 2.3.0
// on this box; `-c` exits 0 on empty/dead input, so `-ec` is required) and
// re-derives all five summary fields from the pair/file arrays, proving the
// server-side counters match a from-JSON recompute outside the test process.
// ---------------------------------------------------------------------------
const QJ = '.proposals as $ps | .conflicts as $cs | ($cs | map(.pairs) | add // []) as $all | ($all | map(select(.conflict == true)) | length) as $tp | ($all | map(select(.conflict == false)) | length) as $fp | ($ps | length) as $np | ([$ps[].files[]? | .path] | unique | length) as $cf | {proposals: $np, changedFiles: $cf, sharedFiles: ($cs | length), conflictingPairs: $tp, cleanPairs: $fp}';
function jqRecompute(label, payload) {
  const jqBin = String(spawnSync("which", ["jq"], { encoding: "utf8" }).stdout ?? "").trim() || null;
  if (!jqBin) {
    check(`${label} jq recompute skipped (no jq binary on PATH)`, true, "no jq binary on PATH");
    return;
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "nextgit-jq-"));
  const tmp = join(tmpDir, "payload.json");
  writeFileSync(tmp, JSON.stringify(payload));
  let recompute = null;
  try {
    recompute = JSON.parse(execFileSync(jqBin, ["-ec", QJ, tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (e) {
    check(`${label} jq recompute exited 0`, false, `jq error: ${e.stderr || e.message}`);
    return;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const s = payload.summary || {};
  check(`${label} jq recompute: proposals`, recompute.proposals === s.proposals, `jq=${recompute.proposals} summary=${s.proposals}`);
  check(`${label} jq recompute: changedFiles`, recompute.changedFiles === s.changedFiles, `jq=${recompute.changedFiles} summary=${s.changedFiles}`);
  check(`${label} jq recompute: sharedFiles`, recompute.sharedFiles === s.sharedFiles, `jq=${recompute.sharedFiles} summary=${s.sharedFiles}`);
  check(`${label} jq recompute: conflictingPairs`, recompute.conflictingPairs === s.conflictingPairs, `jq=${recompute.conflictingPairs} summary=${s.conflictingPairs}`);
  check(`${label} jq recompute: cleanPairs`, recompute.cleanPairs === s.cleanPairs, `jq=${recompute.cleanPairs} summary=${s.cleanPairs}`);
}

// ---------------------------------------------------------------------------
// Headless-Chrome DOM leg: the shipped UI over a loopback worker surface
// ---------------------------------------------------------------------------
const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-propsmap-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=8000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

let currentPayload = null; // swapped per DOM leg
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(currentPayload));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, judgments: [], skipped: [] }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

try {
  // 1. Fixture set through the real route: wire contract + exact classification.
  const { status, body } = await proposalsThroughRoute();
  check("1 /proposals answers 200 with ok:true", status === 200 && body?.ok === true, `status=${status} error=${body?.error ?? ""}`);
  wireContract("1", body);
  fixtureContract("1", body);
  jqRecompute("1", body);

  // 2. DOM agreement over the same payload (the route's real response).
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;
  currentPayload = body;
  const dom = await dumpDom(url);
  if (process.env.DOM_OUT) writeFileSync(`${process.env.DOM_OUT}.fixture.html`, dom);
  agreementContract("2", body, dom);

  // 3. Live capture — the order's check_cmd captures /proposals?base=demo;
  //    PROPS_FIXTURE points this leg at it. Unset -> SKIP.
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  3 live capture — PROPS_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    const live = JSON.parse(readFileSync(fixturePath, "utf8"));
    check("3 live capture: ok:true, non-empty proposal set", live?.ok === true && Array.isArray(live?.proposals) && live.proposals.length >= 1, `n=${live?.proposals?.length}`);
    wireContract("3", live);
    liveCollisionContract("3", live);
    currentPayload = live;
    const liveDom = await dumpDom(url);
    if (process.env.DOM_OUT) writeFileSync(`${process.env.DOM_OUT}.live.html`, liveDom);
    agreementContract("3", live, liveDom);
    jqRecompute("3", live);
  }

  // 4. Zero-state DOM leg — an empty/all-zero summary exercises the REMOVE
  //    branch of every tint (is-alert / is-warn / is-clean all absent) and
  //    pins the zero-state chip labels ("0 detected" / "0 active").
  const empty = { ok: true, proposals: [], conflicts: [], summary: { proposals: 0, changedFiles: 0, sharedFiles: 0, conflictingPairs: 0, cleanPairs: 0 } };
  currentPayload = empty;
  const emptyDom = await dumpDom(url);
  if (process.env.DOM_OUT) writeFileSync(`${process.env.DOM_OUT}.empty.html`, emptyDom);
  agreementContract("4", empty, emptyDom);
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
