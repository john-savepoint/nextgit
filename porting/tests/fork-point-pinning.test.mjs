#!/usr/bin/env bun
// Contract suite: FR-10 — GET /changes pins every change-set to the fork point
// (story e2-verify-fork-point-pinning).
// Run: bun porting/tests/fork-point-pinning.test.mjs   (exit 0 = pass)
//
// Real construction: GET /changes is exercised through the REAL worker module
// (worker.fetch) against an in-memory Artifacts fake — the platform binding
// seam is the only fake (pattern per merge-fold-api / proposals-conflict-map /
// judge.test.mjs); no module mocks, no source grep. The fixture gives the
// baseline a moved head (`demo` C_LAND over the fork C_FORK) so the pinned
// behaviour is distinguishable from a legacy base-head diff, and carries the
// disjoint-history and binding-fault repos the fallback contracts need.
//
// The contract this suite pins (platform/CONTRACT.md "Change-set semantics —
// fork point"; platform/src/index.ts forkPoint / computeChangeSet):
//   * forkPoint walks BOTH first-parent logs bounded by `limit: 200`, takes
//     the NEWEST shared commit (first hit in the proposal's newest-first log),
//     and falls back to the base head when none is shared OR the walk throws;
//   * the change-set is diffed against that fork point: row identity
//     (`baseHash`) is the fork blob, `base.sha` is the fork point actually
//     diffed, and a moved baseline adds no reverse-deletion noise and does not
//     change the body;
//   * live /changes for agent-1 returns `base.sha` as a 40-hex sha with
//     exactly one modified src/auth.ts row and zero removed rows.
//
// Legs:
//   1. fixture (no network): route + fork-point contract over in-memory
//      `demo` / `agent-1` / `agent-orphan` / `agent-flaky`:
//      * moved baseline — base.sha === C_FORK (NOT the moved base head),
//        fork-side treeHashes, exactly one modified src/auth.ts row, zero
//        removed/added rows, fork-blob baseHash, fork-text patch old side;
//      * baseline-motion invariance — the same proposal against depth 0/1/2
//        base heads yields a byte-identical changeSet;
//      * no shared commit → base-head fallback (agent-orphan) with the legacy
//        head-diff reporting base-only files removed;
//      * fork-walk fault → degraded 200 + base-head fallback (agent-flaky),
//        not a 500;
//      * bounded walk — exactly two `limit: 200` log calls (base ref +
//        proposal ref) and every log call explicitly bounded;
//      * route guard — /changes without repo → 400 repo-parameter-required.
//   2. live capture: with FORK_FIXTURE pointing at a captured /changes body
//      (the one the order check_cmd curls), the same wire-level shape
//      contracts run over it verbatim; unset → one SKIP line (exit still 0).
//
// The live leg pins the recording-ready fleet (agent-1 = one commit over the
// fork on src/auth.ts): drift fails closed with named FAIL lines; recovery is
// the demo reset (`seed.mjs` + `real-agents.mjs`), not an edit to this file.

import { readFileSync } from "node:fs";
import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);
const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

const sha = (n) => String(n).padStart(2, "0").repeat(20);
const C_BASE = sha(0x11), C_FORK = sha(0x22), C_LAND = sha(0x33), C_LAND2 = sha(0x44);
const C_A1 = sha(0x55), C_ORPHAN = sha(0x66), C_FL = sha(0x77);

const AUTH_V0 = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_V1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const MID = "export const mid = 1;\n";
const LANDED = "export const landed = 1;\n";
const LANDED2 = "export const landed2 = 1;\n";
const AUTH_LAND = "export const auth = 9;\nexport const keep = true;\n";

function makeFakeArtifacts() {
  const blobText = new Map(), blobHashByText = new Map(), treeEntries = new Map(), repos = new Map();
  const logCalls = [], logFaults = new Map();

  function internBlob(text) {
    if (!blobHashByText.has(text)) { const hash = `blob-${blobHashByText.size + 1}`; blobHashByText.set(text, hash); blobText.set(hash, text); }
    return blobHashByText.get(text);
  }
  function entriesFor(node) {
    return Object.entries(node).map(([name, child]) => (typeof child === "string"
      ? { name, mode: "100644", hash: child, type: "blob" }
      : { name, mode: "40000", hash: treeHashFor(child), type: "tree" }));
  }
  function treeHashFor(node) { const entries = entriesFor(node); const hash = `tree-${treeEntries.size + 1}`; treeEntries.set(hash, entries); return hash; }
  function tree(files) {
    const root = {};
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split("/");
      let node = root;
      for (const part of parts.slice(0, -1)) { node[part] = node[part] || {}; node = node[part]; }
      node[parts[parts.length - 1]] = internBlob(text);
    }
    return treeHashFor(root);
  }
  function commit(hash, treeHash) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
  }
  function defineRepo(name, { history, refs, intents = {} }) { repos.set(name, { history, refs, intents }); }
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
      async log(opts = {}) {
        logCalls.push({ repo: name, ...opts });
        const fault = logFaults.get(name);
        if (fault && fault(opts)) throw new Error("fixture: log fault");
        const { ref = "HEAD", limit = 50 } = opts;
        const byBranch = store.refs[ref];
        if (byBranch) return store.history.slice(0, limit);
        const single = resolve(ref);
        return single ? [single].slice(0, limit) : [];
      },
      async readTree(hash) { return treeEntries.get(hash) ?? null; },
      async readFile({ ref, path }) {
        const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
        if (!head) return null;
        if (path.startsWith("NEXTGIT_INTENT/")) {
          const shaPart = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[shaPart];
          return text === undefined ? null : new Blob([text]);
        }
        const blobHash = lookupPath(head.treeHash, path);
        return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
      },
      async readBlob(hash) { return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null; },
      async info() { return { remote: `https://artifacts.invalid/nextgit/${name}` }; },
      async revokeToken() { return true; },
      [Symbol.dispose]() { },
    };
  }
  return {
    ARTIFACTS: {
      async get(name) { return repoFor(name); },
      async list({ limit = 200 } = {}) { return { repos: [] }; },
    },
    tree, commit, defineRepo, logCalls, logFaults,
    blobHashOf: (text) => blobHashByText.get(text) ?? null,
  };
}

function makeEnvironment({ depth = 1 } = {}) {
  const fake = makeFakeArtifacts();
  const tBase = fake.tree({ "src/auth.ts": AUTH_V0 });
  const tFork = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID });
  const tLand = fake.tree({ "src/auth.ts": AUTH_LAND, "src/mid.ts": MID, "src/landed.ts": LANDED });
  const tLand2 = fake.tree({ "src/auth.ts": AUTH_LAND, "src/mid.ts": MID, "src/landed.ts": LANDED, "src/landed2.ts": LANDED2 });
  const tA1 = fake.tree({ "src/auth.ts": AUTH_V1, "src/mid.ts": MID });

  const baseRows = depth >= 2
    ? [[C_LAND2, tLand2], [C_LAND, tLand], [C_FORK, tFork], [C_BASE, tBase]]
    : depth === 1
      ? [[C_LAND, tLand], [C_FORK, tFork], [C_BASE, tBase]]
      : [[C_FORK, tFork], [C_BASE, tBase]];
  const baseHead = baseRows[0][0];
  fake.defineRepo("demo", { history: baseRows.map(([h, t]) => fake.commit(h, t)), refs: { main: baseHead } });
  fake.defineRepo("agent-1", { history: [fake.commit(C_A1, tA1), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_A1 } });
  fake.defineRepo("agent-orphan", { history: [fake.commit(C_ORPHAN, tA1)], refs: { main: C_ORPHAN } });
  fake.defineRepo("agent-flaky", { history: [fake.commit(C_FL, tA1), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_FL } });
  fake.logFaults.set("agent-flaky", (opts) => opts.limit === 200);

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null } };
  return { fake, env, tBase, tFork, tLand, tLand2, tA1, baseHead };
}

const get = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/changes${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Leg 1 — fixture: fork-point pinning over the in-memory history set.
// ---------------------------------------------------------------------------

// ---- case A: moved baseline — newest shared = C_FORK -------------------------
{
  const { fake, env, tFork, tA1 } = makeEnvironment({ depth: 1 });
  const r = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const cs = r.body?.changeSet;

  check("A: 200 with ok:true", r.status === 200 && r.body?.ok === true, J({ status: r.status, ok: r.body?.ok }));
  check("A: envelope keys exactly {ok, changeSet}", exactKeys(r.body, ["ok", "changeSet"]), J(r.body && Object.keys(r.body)));
  check("A: changeSet keys exactly {base, head, stats, files, texts}", exactKeys(cs, ["base", "head", "stats", "files", "texts"]), J(cs && Object.keys(cs)));
  check("A: base keys exactly {repo, ref, treeHash, sha}", exactKeys(cs?.base, ["repo", "ref", "treeHash", "sha"]), J(cs?.base && Object.keys(cs.base)));
  check("A: base.repo === demo, base.ref === main", cs?.base?.repo === "demo" && cs?.base?.ref === "main", J({ repo: cs?.base?.repo, ref: cs?.base?.ref }));
  check("A: head keys exactly {repo, ref, treeHash}", exactKeys(cs?.head, ["repo", "ref", "treeHash"]), J(cs?.head && Object.keys(cs.head)));
  check("A: head.repo === agent-1, head.ref === main", cs?.head?.repo === "agent-1" && cs?.head?.ref === "main", J({ repo: cs?.head?.repo, ref: cs?.head?.ref }));
  check("A: base.sha === C_FORK (newest shared, NOT base head C_LAND)", cs?.base?.sha === C_FORK, J({ sha: cs?.base?.sha, want: C_FORK, head: C_LAND }));
  check("A: base.sha is 40-hex", /^[0-9a-f]{40}$/.test(String(cs?.base?.sha)), String(cs?.base?.sha));
  check("A: base.treeHash === fork tree", cs?.base?.treeHash === tFork, J({ got: cs?.base?.treeHash, want: tFork }));
  check("A: head.treeHash === proposal head tree", cs?.head?.treeHash === tA1, J({ got: cs?.head?.treeHash, want: tA1 }));
  check("A: files exactly one modified src/auth.ts", cs?.files?.length === 1 && cs.files[0].path === "src/auth.ts" && cs.files[0].status === "modified", J(cs?.files?.map((f) => [f.path, f.status])));
  check("A: zero removed rows (no reverse-deletion noise)", (cs?.files ?? []).filter((f) => f.status === "removed").length === 0, J(cs?.files?.filter((f) => f.status === "removed").map((f) => f.path)));
  check("A: zero added rows", (cs?.files ?? []).filter((f) => f.status === "added").length === 0, J(cs?.files?.filter((f) => f.status === "added").map((f) => f.path)));
  check("A: row baseHash === fork blob of src/auth.ts", cs?.files?.[0]?.baseHash === fake.blobHashOf(AUTH_V0), J({ got: cs?.files?.[0]?.baseHash, want: fake.blobHashOf(AUTH_V0) }));
  check("A: row headHash === head blob of src/auth.ts", cs?.files?.[0]?.headHash === fake.blobHashOf(AUTH_V1), J({ got: cs?.files?.[0]?.headHash, want: fake.blobHashOf(AUTH_V1) }));
  check("A: patch old side is the fork text", String(cs?.files?.[0]?.patch).includes("-export const auth = 1;"), J(String(cs?.files?.[0]?.patch).slice(0, 160)));
  check("A: patch new side is the head text", String(cs?.files?.[0]?.patch).includes("+export function refreshSession"), J(String(cs?.files?.[0]?.patch).slice(0, 160)));
  check("A: stats keys exactly {files, added, modified, removed, additions, deletions}", exactKeys(cs?.stats, ["files", "added", "modified", "removed", "additions", "deletions"]), J(cs?.stats && Object.keys(cs.stats)));
  check("A: stats sum invariant (added+modified+removed === files)", cs?.stats?.added + cs?.stats?.modified + cs?.stats?.removed === cs?.stats?.files, J(cs?.stats));
  check("A: stats pinned (files 1 / modified 1 / added 0 / removed 0)", cs?.stats?.files === 1 && cs.stats.modified === 1 && cs.stats.removed === 0 && cs.stats.added === 0, J(cs?.stats));
  check("A: stats additions/deletions pinned (fork-side diff)", cs?.stats?.additions === 3 && cs?.stats?.deletions === 1, J(cs?.stats));
  check("A: texts deep-equals {} (route does not request texts)", J(cs?.texts) === "{}", J(cs?.texts));

  const walks = fake.logCalls.filter((c) => c.limit === 200);
  check("A: exactly two bounded fork-walk calls (limit 200)", walks.length === 2, J(walks));
  check("A: fork-walk refs are base mainRef + proposal ref", J(walks.map((c) => [c.repo, c.ref]).sort()) === J([["agent-1", "main"], ["demo", "main"]]), J(walks));
  check("A: every log call passes an explicit numeric limit", fake.logCalls.length > 0 && fake.logCalls.every((c) => typeof c.limit === "number" && c.limit > 0 && c.limit <= 1000), J(fake.logCalls.filter((c) => typeof c.limit !== "number")));
}

// ---- case B: baseline-motion invariance (depth 0 / 1 / 2) --------------------
{
  const bodies = [];
  for (const depth of [0, 1, 2]) {
    const { env } = makeEnvironment({ depth });
    const r = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
    bodies.push(J(r.body?.changeSet));
  }
  check("B: changeSet byte-identical at baseline depth 0/1/2", bodies[0] === bodies[1] && bodies[1] === bodies[2], bodies.map((b) => b.length).join(","));
}

// ---- case C: no shared commit -> base-head fallback --------------------------
{
  const { env, baseHead } = makeEnvironment({ depth: 1 });
  const r = await get(env, "?repo=agent-orphan&base=demo&ref=main&baseRef=main");
  const cs = r.body?.changeSet;
  check("C: fallback base.sha === base head", cs?.base?.sha === baseHead, J({ sha: cs?.base?.sha, want: baseHead }));
  const removed = (cs?.files ?? []).filter((f) => f.status === "removed").map((f) => f.path).sort();
  check("C: legacy head-diff shows base-only files removed", J(removed) === J(["src/landed.ts"]), J(removed));
}

// ---- case D: binding log fault on the fork walk -> degraded fallback ---------
{
  const { env, baseHead } = makeEnvironment({ depth: 1 });
  const r = await get(env, "?repo=agent-flaky&base=demo&ref=main&baseRef=main");
  check("D: 200 (degraded fallback, not 500)", r.status === 200 && r.body?.ok === true, J({ status: r.status, body: r.body }));
  check("D: fallback base.sha === base head", r.body?.changeSet?.base?.sha === baseHead, J(r.body?.changeSet?.base));
}

// ---- case E: route guard -----------------------------------------------------
{
  const { env } = makeEnvironment({ depth: 1 });
  const r = await get(env, "");
  check("E: /changes without repo -> 400 repo-parameter-required", r.status === 400 && r.body?.ok === false && r.body?.error === "repo parameter required", J(r.body));
}

// ---------------------------------------------------------------------------
// Leg 2 — live capture (FORK_FIXTURE = a captured /changes body).
// Unset → one SKIP line; drift fails closed with named FAIL lines.
// ---------------------------------------------------------------------------
function liveContract(label, body) {
  const cs = body?.changeSet;
  check(`${label}: envelope ok:true with keys exactly {ok, changeSet}`, body?.ok === true && exactKeys(body, ["ok", "changeSet"]), J(body && Object.keys(body)));
  check(`${label}: changeSet keys exactly {base, head, stats, files, texts}`, exactKeys(cs, ["base", "head", "stats", "files", "texts"]), J(cs && Object.keys(cs)));
  check(`${label}: base keys exactly {repo, ref, treeHash, sha}`, exactKeys(cs?.base, ["repo", "ref", "treeHash", "sha"]), J(cs?.base && Object.keys(cs.base)));
  check(`${label}: head keys exactly {repo, ref, treeHash}`, exactKeys(cs?.head, ["repo", "ref", "treeHash"]), J(cs?.head && Object.keys(cs.head)));
  check(`${label}: base.repo === demo, base.ref === main`, cs?.base?.repo === "demo" && cs?.base?.ref === "main", J({ repo: cs?.base?.repo, ref: cs?.base?.ref }));
  check(`${label}: head.repo === agent-1, head.ref === main`, cs?.head?.repo === "agent-1" && cs?.head?.ref === "main", J({ repo: cs?.head?.repo, ref: cs?.head?.ref }));
  check(`${label}: base.sha is 40-hex`, /^[0-9a-f]{40}$/.test(String(cs?.base?.sha)), String(cs?.base?.sha));
  check(`${label}: base.treeHash is 40-hex`, /^[0-9a-f]{40}$/.test(String(cs?.base?.treeHash)), String(cs?.base?.treeHash));
  check(`${label}: head.treeHash is 40-hex`, /^[0-9a-f]{40}$/.test(String(cs?.head?.treeHash)), String(cs?.head?.treeHash));

  const rows = Array.isArray(cs?.files) ? cs.files : [];
  check(`${label}: every row path is a non-empty string`, rows.length > 0 && rows.every((f) => typeof f.path === "string" && f.path.length > 0), J(rows.map((f) => f.path)));
  check(`${label}: every row status in {added, modified, removed}`, rows.length > 0 && rows.every((f) => ["added", "modified", "removed"].includes(f.status)), J(rows.map((f) => [f.path, f.status])));
  check(`${label}: baseHash present iff status !== "added"`, rows.length > 0 && rows.every((f) => (f.status !== "added") === ("baseHash" in f)), J(rows.map((f) => [f.path, f.status, "baseHash" in f])));
  check(`${label}: headHash present iff status !== "removed"`, rows.length > 0 && rows.every((f) => (f.status !== "removed") === ("headHash" in f)), J(rows.map((f) => [f.path, f.status, "headHash" in f])));
  check(`${label}: stats keys exactly {files, added, modified, removed, additions, deletions}`, exactKeys(cs?.stats, ["files", "added", "modified", "removed", "additions", "deletions"]), J(cs?.stats && Object.keys(cs.stats)));
  check(`${label}: stats sum invariant (added+modified+removed === files)`, cs?.stats?.added + cs?.stats?.modified + cs?.stats?.removed === cs?.stats?.files, J(cs?.stats));
  check(`${label}: exactly one modified src/auth.ts row`, rows.filter((f) => f.path === "src/auth.ts" && f.status === "modified").length === 1, J(rows.map((f) => [f.path, f.status])));
  check(`${label}: zero removed rows`, rows.filter((f) => f.status === "removed").length === 0, J(rows.filter((f) => f.status === "removed").map((f) => f.path)));
  check(`${label}: zero added rows`, rows.filter((f) => f.status === "added").length === 0, J(rows.filter((f) => f.status === "added").map((f) => f.path)));
}

const fixturePath = process.env.FORK_FIXTURE;
if (!fixturePath) {
  console.log("SKIP  2 live capture — FORK_FIXTURE unset (the order's check_cmd owns the live fetch)");
} else {
  try {
    liveContract("2 live", JSON.parse(readFileSync(fixturePath, "utf8")));
  } catch (err) {
    check("2 live: fixture readable and valid JSON", false, `${fixturePath}: ${err?.message}`);
  }
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
