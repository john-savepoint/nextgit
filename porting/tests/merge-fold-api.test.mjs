#!/usr/bin/env bun
// Contract suite: FR-13 — GET /merge folds proposals in order with clean,
// conflict and withheld-secret outcomes (story e2-verify-merge-fold-api).
// Run: bun porting/tests/merge-fold-api.test.mjs   (exit 0 = pass)
//
// Real construction: GET /merge is exercised through the REAL worker module
// (worker.fetch) against an in-memory Artifacts fake — the platform binding
// seam is the only fake (pattern per judge.test.mjs / one-set-one-response /
// proposals-conflict-map); no module mocks, no source grep. The fixture
// constructs every outcome the contract names — merged, conflict,
// withheld-secret — plus the delete action and the no-change fold, so the
// vocabulary assertions are non-vacuous.
//
// Legs:
//   1. fixture: route + fold contract over base `demo` + `agent-1`..`agent-5`
//      (agent-1/agent-2 collide on src/auth.ts; agent-3 folds clean; agent-4
//      deletes a base file; agent-5 adds the secret-class config/.env):
//      * wire contract (CONTRACT.md GET /merge): envelope keys exactly
//        {ok,merge}; merge keys exactly {base,repos,status,files,conflicted};
//        status in {clean,conflict}; action in {write,delete}; result in
//        {merged,conflict,withheld-secret}; merged present iff write+merged;
//        conflictText present iff conflict; neither on withheld-secret;
//        conflicted == the conflict-result paths; status conflict iff any.
//      * conflict case: status conflict; src/auth.ts write/conflict carrying
//        <<<<<<< ours / ======= / >>>>>>> theirs with BOTH sides' text.
//      * clean case: status clean; write/merged with the exact folded text.
//      * withheld case: exactly one config/.env row, write/withheld-secret,
//        no merged / no conflictText, note names the withheld count, and no
//        fixture secret VALUE appears anywhere in the serialized body.
//      * empty case: repos=demo (no change) → files [] and conflicted [].
//      * delete case: the removed base file folds to action delete / merged.
//      * order case: [agent-3,agent-1] and [agent-1,agent-3] fold BOTH
//        proposals into one result; [agent-1,agent-2] vs [agent-2,agent-1]
//        swap the ours/theirs conflict sides and the note — the repo list is
//        consumed in order.
//      * route guard: /merge without repos → 400 repos-required.
//   2. live-capture leg: when MERGE_FIXTURE points at the JSON bundle captured
//      from the live worker (keys: conflict, conflictReversed, clean, withheld,
//      empty, order — written by the order check_cmd), the same case contracts
//      run over it verbatim; unset → one SKIP line.
//
// The live leg pins the live scenario (agent-1 x agent-2 on src/auth.ts, the
// agent-5 secret fixture): drift fails closed with named FAIL lines; recovery
// is the demo reset (`seed.mjs` + `real-agents.mjs` + `secret-fixture.mjs`).

import { readFileSync } from "node:fs";
import worker from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const J = (x) => JSON.stringify(x);
const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

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
// Fixture — base `demo` + `agent-1`..`agent-6`, each head committed over the
// shared base commit (so the fork point is that base). agent-1 and agent-2
// rewrite the first statement of src/auth.ts (the deliberate collision;
// refreshSession vs isExpired); agent-3 rewrites src/store.ts line 1; agent-6
// edits src/store.ts line 5 — well-separated, so folding both CLEAN must
// accumulate (1j). agent-4 removes src/legacy.ts; agent-5 adds the
// secret-class config/.env.
// ---------------------------------------------------------------------------
const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const AUTH_2 = "export function isExpired(claims) {\n  return claims.exp < Date.now();\n}\nexport const keep = true;\n";
const STORE_BASE = "export const store = 1;\nexport const keep = 0;\nexport const mid = 0;\nexport const tail = 0;\nexport const end = 0;\n";
const STORE_3 = "export const store = 2;\nexport const keep = 0;\nexport const mid = 0;\nexport const tail = 0;\nexport const end = 0;\n";
const STORE_6 = "export const store = 1;\nexport const keep = 0;\nexport const mid = 0;\nexport const tail = 0;\nexport const end = 7;\n";
const LEGACY_BASE = "export const legacy = 1;\n";
const SECRET_VALUE_1 = "postgres://fake-user:fake-pass@localhost:5432/db";
const SECRET_VALUE_2 = "redis://localhost:6379";
const ENV_FILE = `DATABASE_URL=${SECRET_VALUE_1}\nREDIS_URL=${SECRET_VALUE_2}\n`;

const BASE_FILES = { "src/auth.ts": AUTH_BASE, "src/store.ts": STORE_BASE, "src/legacy.ts": LEGACY_BASE };

function makeEnvironment() {
  const fake = makeFakeArtifacts();
  const base = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [base], refs: { main: base.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });

  const agent1 = { ...BASE_FILES, "src/auth.ts": AUTH_1 };
  const agent2 = { ...BASE_FILES, "src/auth.ts": AUTH_2 };
  const agent3 = { ...BASE_FILES, "src/store.ts": STORE_3 };
  const agent6 = { ...BASE_FILES, "src/store.ts": STORE_6 };
  const { "src/legacy.ts": _legacy4, ...agent4 } = BASE_FILES;
  const agent5 = { ...BASE_FILES, "config/.env": ENV_FILE };

  for (const [name, files] of [
    ["agent-1", agent1],
    ["agent-2", agent2],
    ["agent-3", agent3],
    ["agent-4", agent4],
    ["agent-5", agent5],
    ["agent-6", agent6],
  ]) {
    const head = fake.commit(`c-${name}`, fake.tree(files));
    fake.defineRepo(name, { history: [head, base], refs: { main: head.hash } });
    fake.discovered.push({ name, status: "ready" });
  }

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { env };
}

const get = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/merge${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Wire contract — holds for ANY /merge payload (fixture or live capture).
// ---------------------------------------------------------------------------
const FILE_KEYS = ["path", "action", "result", "merged", "conflictText", "note"];

function wireContract(label, body, requested) {
  check(`${label}: ok:true, envelope keys exactly {ok,merge}`, body?.ok === true && exactKeys(body, ["ok", "merge"]), J(body && Object.keys(body)));
  const m = body?.merge;
  check(`${label}: merge keys exactly {base,repos,status,files,conflicted}`, exactKeys(m, ["base", "repos", "status", "files", "conflicted"]), J(m && Object.keys(m)));
  check(`${label}: base identity is demo/main (keys exactly {repo,ref})`, m?.base?.repo === "demo" && m?.base?.ref === "main" && exactKeys(m?.base, ["repo", "ref"]), J(m?.base));
  check(`${label}: status in {clean,conflict}`, m?.status === "clean" || m?.status === "conflict", J(m?.status));
  check(
    `${label}: repos echo is the requested list${requested ? ` (${requested.join(",")})` : ""}`,
    Array.isArray(m?.repos) &&
    m.repos.length >= 1 &&
    (requested === undefined || J([...m.repos].sort()) === J([...requested].sort())),
    `echo=${J(m?.repos)} requested=${J(requested)}`,
  );
  const files = m?.files ?? [];
  const rowsOk =
    Array.isArray(m?.files) &&
    files.every(
      (f) =>
        Object.keys(f).every((k) => FILE_KEYS.includes(k)) &&
        typeof f.path === "string" &&
        f.path.length > 0 &&
        (f.action === "write" || f.action === "delete") &&
        ["merged", "conflict", "withheld-secret"].includes(f.result) &&
        (f.result === "conflict" ? typeof f.conflictText === "string" : !("conflictText" in f)) &&
        (f.action === "write" && f.result === "merged" ? typeof f.merged === "string" : !("merged" in f)),
    );
  check(`${label}: rows are action in {write,delete} x result in {merged,conflict,withheld-secret}; merged iff write+merged; conflictText iff conflict`, rowsOk, J(files));
  const conflictPaths = files.filter((f) => f.result === "conflict").map((f) => f.path);
  const conflicted = m?.conflicted ?? [];
  check(`${label}: conflicted == the conflict-result paths, unique`, J([...conflicted].sort()) === J([...conflictPaths].sort()) && new Set(conflicted).size === conflicted.length, `conflicted ${J(conflicted)} vs rows ${J(conflictPaths)}`);
  check(`${label}: status conflict iff conflicted non-empty`, (m?.status === "conflict") === (conflicted.length > 0), `status=${m?.status} n=${conflicted.length}`);
}

// ---------------------------------------------------------------------------
// Case contracts.
// ---------------------------------------------------------------------------
function splitConflict(text) {
  const oursMark = "<<<<<<< ours\n";
  const midMark = "\n=======\n";
  const theirsMark = "\n>>>>>>> theirs";
  const i = text.indexOf(oursMark);
  const j = text.indexOf(midMark, i + oursMark.length);
  const k = text.lastIndexOf(theirsMark);
  if (i < 0 || j < 0 || k < 0 || j < i || k < j) return { ours: "", theirs: "" };
  return { ours: text.slice(i + oursMark.length, j), theirs: text.slice(j + midMark.length, k) };
}

function conflictContract(label, body, side) {
  const m = body?.merge;
  check(`${label}: status conflict`, m?.status === "conflict", J(m?.status));
  const row = (m?.files ?? []).find((f) => f.path === "src/auth.ts" && f.result === "conflict");
  check(`${label}: src/auth.ts is a write/conflict row`, !!row && row.action === "write", J(row));
  const text = row?.conflictText ?? "";
  check(`${label}: conflictText carries <<<<<<< ours / ======= / >>>>>>> theirs`, text.includes("<<<<<<< ours") && text.includes("=======") && text.includes(">>>>>>> theirs"));
  const { ours, theirs } = splitConflict(text);
  check(`${label}: both sides carry text`, ours.trim().length > 0 && theirs.trim().length > 0, J({ ours, theirs }));
  check(`${label}: ours side carries "${side.ours}"`, ours.includes(side.ours), J(ours));
  check(`${label}: theirs side carries "${side.theirs}"`, theirs.includes(side.theirs), J(theirs));
  check(`${label}: note is "${side.note}"`, row?.note === side.note, J(row?.note));
  check(`${label}: conflicted lists src/auth.ts`, (m?.conflicted ?? []).includes("src/auth.ts"), J(m?.conflicted));
}

function cleanContract(label, body, expectedText) {
  const m = body?.merge;
  check(`${label}: status clean`, m?.status === "clean", J(m?.status));
  const merged = (m?.files ?? []).filter((f) => f.action === "write" && f.result === "merged" && typeof f.merged === "string" && f.merged.length > 0);
  check(`${label}: at least one write/merged row with non-empty text`, merged.length >= 1, J(m?.files));
  check(`${label}: no conflict markers anywhere`, !J(m?.files ?? []).includes("<<<<<<<") && !J(m?.files ?? []).includes(">>>>>>>"));
  check(`${label}: conflicted empty`, (m?.conflicted ?? []).length === 0, J(m?.conflicted));
  if (expectedText) {
    const row = (m?.files ?? []).find((f) => f.path === "src/store.ts");
    check(`${label}: src/store.ts merged text is the exact fold of the proposal`, row?.merged === expectedText, J(row?.merged));
  }
}

function withheldContract(label, body, secretValues) {
  const m = body?.merge;
  check(`${label}: withheld: status clean`, m?.status === "clean", J(m?.status));
  const files = m?.files ?? [];
  check(`${label}: withheld: exactly one file row`, files.length === 1 && files[0]?.path === "config/.env", J(files.map((f) => f.path)));
  const row = files[0] ?? {};
  check(`${label}: withheld: action write / result withheld-secret`, row.action === "write" && row.result === "withheld-secret", J(row));
  check(`${label}: withheld: no merged and no conflictText`, !("merged" in row) && !("conflictText" in row), J(row));
  check(
    `${label}: withheld: note names the withheld key count`,
    typeof row.note === "string" && /withheld/.test(row.note) && (secretValues.length === 0 || row.note.includes(String(secretValues.length))),
    J(row.note),
  );
  check(`${label}: withheld: no secret VALUE appears in the response body`, secretValues.every((v) => !J(body).includes(v)), J(body).slice(0, 240));
}

function emptyContract(label, body) {
  const m = body?.merge;
  check(`${label}: empty: status clean`, m?.status === "clean", J(m?.status));
  check(`${label}: empty: files []`, Array.isArray(m?.files) && m.files.length === 0, J(m?.files));
  check(`${label}: empty: conflicted []`, (m?.conflicted ?? []).length === 0, J(m?.conflicted));
}

function deleteContract(label, body) {
  const row = (body?.merge?.files ?? []).find((f) => f.path === "src/legacy.ts");
  check(`${label}: delete: src/legacy.ts action delete / result merged`, !!row && row.action === "delete" && row.result === "merged", J(row));
  check(`${label}: delete: no merged text on a delete row`, !!row && !("merged" in row), J(row));
  check(`${label}: delete: note names the removing proposal`, row?.note === "removed by agent-4", J(row?.note));
}

function orderContract(label, body) {
  const m = body?.merge;
  check(`${label}: order: status clean`, m?.status === "clean", J(m?.status));
  check(`${label}: order: exactly two write/merged rows with non-empty text`, (m?.files ?? []).length === 2 && m.files.every((f) => f.action === "write" && f.result === "merged" && typeof f.merged === "string" && f.merged.length > 0), J(m?.files));
  check(`${label}: order: conflicted empty`, (m?.conflicted ?? []).length === 0, J(m?.conflicted));
}

// ---------------------------------------------------------------------------
// Leg 1 — fixture through the real route.
// ---------------------------------------------------------------------------
{
  const { env } = makeEnvironment();

  const conflict = await get(env, "?base=demo&repos=agent-1,agent-2");
  wireContract("1a conflict", conflict.body, ["agent-1", "agent-2"]);
  conflictContract("1a conflict", conflict.body, { ours: "refreshSession", theirs: "isExpired", note: "conflicts with agent-2" });

  const conflictRev = await get(env, "?base=demo&repos=agent-2,agent-1");
  wireContract("1b conflict-reversed", conflictRev.body, ["agent-2", "agent-1"]);
  conflictContract("1b conflict-reversed", conflictRev.body, { ours: "isExpired", theirs: "refreshSession", note: "conflicts with agent-1" });

  const clean = await get(env, "?base=demo&repos=agent-3");
  wireContract("1c clean", clean.body, ["agent-3"]);
  cleanContract("1c clean", clean.body, STORE_3);

  const withheld = await get(env, "?base=demo&repos=agent-5");
  wireContract("1d withheld", withheld.body, ["agent-5"]);
  withheldContract("1d withheld", withheld.body, [SECRET_VALUE_1, SECRET_VALUE_2]);

  const empty = await get(env, "?base=demo&repos=demo");
  wireContract("1e empty", empty.body, ["demo"]);
  emptyContract("1e empty", empty.body);

  const del = await get(env, "?base=demo&repos=agent-4");
  wireContract("1f delete", del.body, ["agent-4"]);
  deleteContract("1f delete", del.body);
  check("1f delete: status clean", del.body?.merge?.status === "clean", J(del.body?.merge?.status));

  const orderA = await get(env, "?base=demo&repos=agent-3,agent-1");
  wireContract("1g order agent-3,agent-1", orderA.body, ["agent-3", "agent-1"]);
  orderContract("1g order agent-3,agent-1", orderA.body);
  check("1g order agent-3,agent-1: src/auth.ts folds to agent-1's text", (orderA.body?.merge?.files ?? []).find((f) => f.path === "src/auth.ts")?.merged === AUTH_1);
  check("1g order agent-3,agent-1: src/store.ts folds to agent-3's text", (orderA.body?.merge?.files ?? []).find((f) => f.path === "src/store.ts")?.merged === STORE_3);

  const orderB = await get(env, "?base=demo&repos=agent-1,agent-3");
  wireContract("1g order agent-1,agent-3", orderB.body, ["agent-1", "agent-3"]);
  orderContract("1g order agent-1,agent-3", orderB.body);
  check("1g order agent-1,agent-3: same two paths (order folds both proposals into one result)", J((orderB.body?.merge?.files ?? []).map((f) => f.path).sort()) === J(["src/auth.ts", "src/store.ts"]), J(orderB.body?.merge?.files));

  // 1j: a second CLEAN writer on the same path must fold ONTO the accumulated text
  // (exercises the fold.ours = merged.text chaining — a regression there would drop or
  // overwrite the first writer's edit).
  const accum = await get(env, "?base=demo&repos=agent-3,agent-6");
  wireContract("1j clean-accumulation", accum.body, ["agent-3", "agent-6"]);
  const accumRow = (accum.body?.merge?.files ?? []).find((f) => f.path === "src/store.ts");
  check(
    "1j clean-accumulation: second clean writer folds onto accumulated text (both edits present)",
    accum.body?.merge?.status === "clean" &&
    accumRow?.result === "merged" &&
    accumRow.merged.includes("store = 2") &&
    accumRow.merged.includes("end = 7"),
    J(accumRow),
  );

  const fixtureBodies = [conflict, conflictRev, clean, withheld, empty, del, orderA, orderB, accum].map((r) => J(r.body));
  check("1h masking: no fixture secret value in ANY fixture response", fixtureBodies.every((b) => !b.includes(SECRET_VALUE_1) && !b.includes(SECRET_VALUE_2) && !b.includes("fake-pass")));

  const noRepos = await worker.fetch(new Request("https://nextgit.invalid/merge?base=demo"), env);
  const noReposBody = await noRepos.json().catch(() => null);
  check("1i guard: /merge without repos → 400 repos-required", noRepos.status === 400 && noReposBody?.ok === false && noReposBody?.error === "repos parameter required", `${noRepos.status} ${J(noReposBody)}`);
  const blankRepos = await worker.fetch(new Request("https://nextgit.invalid/merge?base=demo&repos=%20,"), env);
  check("1i guard: blank repos list → 400", blankRepos.status === 400, String(blankRepos.status));
}

// ---------------------------------------------------------------------------
// Leg 2 — live capture (MERGE_FIXTURE bundle). Unset → one SKIP line.
// ---------------------------------------------------------------------------
const fixturePath = process.env.MERGE_FIXTURE;
if (!fixturePath) {
  console.log("SKIP  2 live capture — MERGE_FIXTURE unset (the order's check_cmd owns the live fetch)");
} else {
  const live = JSON.parse(readFileSync(fixturePath, "utf8"));
  const CASE_KEYS = ["conflict", "conflictReversed", "clean", "withheld", "empty", "order"];
  check("2 live: bundle carries all six case captures", CASE_KEYS.every((k) => live?.[k]?.ok === true), J(Object.keys(live ?? {})));

  wireContract("2 live conflict", live.conflict, ["agent-1", "agent-2"]);
  conflictContract("2 live conflict", live.conflict, { ours: "refreshSession", theirs: "leewayMs", note: "conflicts with agent-2" });

  wireContract("2 live conflict-reversed", live.conflictReversed, ["agent-2", "agent-1"]);
  conflictContract("2 live conflict-reversed", live.conflictReversed, { ours: "leewayMs", theirs: "refreshSession", note: "conflicts with agent-1" });

  wireContract("2 live clean", live.clean, ["agent-3"]);
  cleanContract("2 live clean", live.clean, null);

  wireContract("2 live withheld", live.withheld, ["agent-5"]);
  withheldContract("2 live withheld", live.withheld, []);

  wireContract("2 live empty", live.empty, ["demo"]);
  emptyContract("2 live empty", live.empty);

  wireContract("2 live order", live.order, ["agent-3", "agent-1"]);
  orderContract("2 live order", live.order);
  check("2 live order: folds src/auth.ts + src/store.ts", J((live.order?.merge?.files ?? []).map((f) => f.path).sort()) === J(["src/auth.ts", "src/store.ts"]), J(live.order?.merge?.files));
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
