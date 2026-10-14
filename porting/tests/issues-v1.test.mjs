#!/usr/bin/env bun
// Contract suite: GET /issues — the derived triage issue list
// (nextgit-e16). Run: bun porting/tests/issues-v1.test.mjs
// (exit 0 = pass)
//
// Real construction (the forks-route.test.mjs posture):
// imports the real `worker` + `ROUTES` from platform/src/index.ts
// and `ROUTE_RATE_LIMITS` from platform/src/rate.ts, and drives
// worker.fetch() over the real dispatcher (authorize + csrf +
// ROUTES) with an in-memory Artifacts fake (the fork-signals /
// forks-route tree/blob/log fixture — real first-parent
// histories, real tree walks) and an in-memory Map-backed CACHE
// KV fake. No mock.module, no source grep. Every request
// carries a unique CF-Connecting-IP (module-global limiter).
//
// Groups (each defends an observable contract):
//   1. Round-trip — the four derivation legs over a fixture
//      where agent-conflict folds a real diff3 conflict on
//      src/a.ts, agent-secret carries a withheld-secret file
//      (config/.env), agent-stale shares no first-parent
//      commit with the base, agent-clean folds clean → 200
//      {ok:true,base:"demo"}, exactly the derived issue set
//      with honest kinds, each row carries all seven fields,
//      links is an array, the conflicting path appears in
//      detail.
//   2. Deterministic order — discovery order ≠ severity
//      order (a low discovered before a high) → the exact
//      sorted sequence; two consecutive reads byte-identical.
//   3. Empty state — every candidate folds clean → issues: [].
//   4. AD-8 default seam — GET /issues (no base) == GET
//      /issues?base=demo (byte-identical bodies); base="" → 400.
//   5. Charset — base="not demo!" → 400 invalid base repo.
//   6. Allowlist (AD-9) — base="notdemo-xyz" → 403
//      repo-not-allowed BEFORE any Artifacts read (the fake's
//      get/list call counters prove zero reads).
//   7. Deny mode — AUTH_MODE absent → 401 unauthorized.
//   8. Rate row — the 61st request from one caller is 429
//      {ok:false,error:"rate-limited"}; a different caller is
//      unaffected; ROUTE_RATE_LIMITS["/issues"] exists with
//      limit 60.
//   9. Registration — ROUTES carries GET /issues with
//      action:"read"; ROUTE_RATE_LIMITS row present.
//  10. No-new-store invariance — the derivation reads only
//      env.ARTIFACTS (get/list/log/readFile/readTree/readBlob);
//      the fake records every method call; zero put/delete on
//      Artifacts (read-only derivation, no new store).

import worker, { ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
 if (ok) pass++;
 else fails++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (forks-route.test.mjs shape) — the
// bounded `list()` the discovery seam reads and the `get()` the
// compute seams read. WRITES/READS count the binding touches so
// groups 6 and 10 can prove zero reads / zero writes.
// ---------------------------------------------------------------------------
const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

const READS = { list: 0, get: 0 };
const WRITES = { put: 0, delete: 0 };

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

function commit(hash, treeHash, authoredAt = 0) {
 const identity = { name: "fixture", email: "fixture@test" };
 return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt, committedAt: authoredAt };
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

// The discovered fork set — the discovery seam's source. Fresh per
// environment so mutation probes cannot alias across cases.
const LISTED = [];
function listFor(entries) {
 LISTED.length = 0;
 for (const e of entries) LISTED.push(e);
}
const READY = (name) => ({ name, status: "ready", defaultBranch: "main" });

// The Artifacts binding fake. `get`/`list` count reads (group 6
// proves the allowlist refusal fires before any of them); the
// binding carries NO put/delete at all — the derivation's only
// legal store touch is a read, so a write attempt throws and the
// request fails the group instead of silently passing.
function makeArtifacts() {
 return {
  async get(name) {
   READS.get++;
   return repoFor(name);
  },
  async list() {
   READS.list++;
   return { repos: LISTED.slice() };
  },
  async put() {
   WRITES.put++;
   throw new Error("fixture: Artifacts.put is not part of the /issues derivation contract");
  },
  async delete() {
   WRITES.delete++;
   throw new Error("fixture: Artifacts.delete is not part of the /issues derivation contract");
  },
 };
}

// ---------------------------------------------------------------------------
// Fixture repos — the forks-route.test.mjs shape.
//
// The base repo `demo` carries TWO first-parent commits: the
// fork point `c1` (src/a.ts = A0) and the CURRENT base head
// `cBaseHead` (src/a.ts = A_BASE). A baseline that moved past
// the fork point is what makes the conflict leg a REAL diff3
// conflict: the fold's three sides are ancestor = A0 (the
// fork-point text), ours = A_BASE (the current base head),
// theirs = the candidate head — and when the candidate head
// edits the same region differently, renderMerge emits a
// conflict region.
//
// The stale candidate's history shares NO first-parent commit
// with the base (an unrelated root `c-stale-root`); its head
// carries the base files plus one unrelated file, so its
// change-set (fork-point fallback = the base head) is exactly
// the added file — no spurious fold rows.
// ---------------------------------------------------------------------------
const SECRET_VALUE = "issues_v1_fixture_secret_9c4d21aa";
const SECRET_ENV_TEXT = `# demo env\nAPI_TOKEN=${SECRET_VALUE}\nDB_PASSWORD=also_${SECRET_VALUE}\n`;

const A0 = "export const a = 1;\nexport const keep = true;\n";
const A_BASE = "export const a = 1;\nexport const keep = true;\nexport const base = true;\n";
const A_FORK_CONFLICT = "export const a = 1;\nexport const keep = true;\nexport const conflict = true;\n";
const B0 = "export const b = 1;\n";
const B2 = "export const b = 2;\n";
const BASE_FILES = { "src/a.ts": A_BASE, "src/b.ts": B0, "config/.env": SECRET_ENV_TEXT };
// The fork-point tree: src/a.ts as it was at the fork (A0).
const FORK_POINT_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": SECRET_ENV_TEXT };

// The base: fork point c1, then the moved base head.
const c1 = commit("c-base", tree(FORK_POINT_FILES));
const cBaseHead = commit("c-base-head", tree(BASE_FILES));
defineRepo("demo", { history: [cBaseHead, c1], refs: { main: cBaseHead.hash } });

// Candidate 1 — a REAL conflict: the same trailing region of
// src/a.ts gained a DIFFERENT line on each side since the
// fork point. diff3(ours=A_BASE, ancestor=A0,
// theirs=A_FORK_CONFLICT) cannot join the two edits.
const cConflict = commit("c-agent-conflict", tree({ ...FORK_POINT_FILES, "src/a.ts": A_FORK_CONFLICT }));
defineRepo("agent-conflict", {
 history: [cConflict, c1],
 refs: { main: cConflict.hash },
 intents: { [cConflict.hash]: "Rework the a module." },
});

// Candidate 2 — a withheld-secret file in its change-set: the
// fork's head rewrites config/.env (a secret-class path) with
// a two-key text. The fold masks it to key NAMES (the
// masking law) — the count is the surviving side's key count.
const cSecret = commit(
 "c-agent-secret",
 tree({ ...FORK_POINT_FILES, "config/.env": `# demo env v2\nAPI_TOKEN=rotated_${SECRET_VALUE}\nDB_PASSWORD=new_${SECRET_VALUE}\n` }),
);
defineRepo("agent-secret", {
 history: [cSecret, c1],
 refs: { main: cSecret.hash },
 intents: { [cSecret.hash]: "Rotate the env keys." },
});

// Candidate 3 — stale base: its history shares NO first-parent
// commit with the base (an unrelated root). Its head carries
// the base files plus one unrelated file, so the change-set
// (fork-point fallback = the base head) is exactly the added
// file.
const cStaleRoot = commit("c-stale-root", tree({ "src/unrelated.ts": "export const unrelated = 1;\n" }));
const cStale = commit(
 "c-agent-stale",
 tree({ ...BASE_FILES, "src/unrelated.ts": "export const unrelated = 2;\n" }),
);
defineRepo("agent-stale", {
 history: [cStale, cStaleRoot],
 refs: { main: cStale.hash },
 intents: { [cStale.hash]: "A whole different line of work." },
});

// Candidate 4 — clean: one-file change-set, no conflict,
// shared history.
const cClean = commit("c-agent-clean", tree({ ...FORK_POINT_FILES, "src/b.ts": B2 }));
defineRepo("agent-clean", {
 history: [cClean, c1],
 refs: { main: cClean.hash },
 intents: { [cClean.hash]: "Bump src/b.ts." },
});

// Candidate 5 — non-aligned: a 40-file change-set (fitOverlap
// = 1 - 40/50 = 0.2 < 0.3), so the structural matcher scores
// it "ignore" — the blocked-intent leg. No conflict, no
// secret-class path: its only issue row is the advisory one.
const NONALIGNED_FILES = {};
for (let i = 1; i <= 40; i++) {
 NONALIGNED_FILES[`src/other-${String(i).padStart(2, "0")}.ts`] = `export const other${i} = ${i};\n`;
}
const cNonaligned = commit("c-agent-nonaligned", tree({ ...FORK_POINT_FILES, ...NONALIGNED_FILES }));
defineRepo("agent-nonaligned", {
 history: [cNonaligned, c1],
 refs: { main: cNonaligned.hash },
 intents: { [cNonaligned.hash]: "A whole different feature." },
});

// Non-candidate fixtures: a non-agent repo and a non-ready agent
// fork (the discovery filter must exclude both).
defineRepo("demo-2", { history: [cBaseHead, c1], refs: { main: cBaseHead.hash } });
defineRepo("agent-pending", { history: [c1], refs: { main: c1.hash } });

// ---------------------------------------------------------------------------
// Fake KV (CACHE): the fork-lineage seam + the compute caches.
// ---------------------------------------------------------------------------
function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) {
   return store.get(key) ?? null;
  },
  async put(key, value) {
   store.set(key, value);
  },
  _store: store,
 };
}

function makeEnv({ artifacts = null, cache = null, authMode = "demo" } = {}) {
 const CACHE = cache ?? makeFakeKV();
 return {
  ARTIFACTS: artifacts ?? makeArtifacts(),
  LIVE: {},
  CACHE,
  ASSETS: { fetch: async () => new Response("") },
  AI: undefined,
  AUTH_MODE: authMode,
 };
}

// The full discovery roster the route must filter. Group 2's
// fixture orders discovery so a LOW-severity candidate
// (agent-stale) is discovered BEFORE the HIGH-severity one
// (agent-conflict) — the sort must reorder them.
listFor([
 READY("agent-stale"),
 READY("agent-conflict"),
 READY("agent-secret"),
 READY("agent-clean"),
 READY("agent-nonaligned"),
 { name: "demo-2", status: "ready", defaultBranch: "main" },
 { name: "agent-pending", status: "importing", defaultBranch: "main" },
]);

// ---------------------------------------------------------------------------
// Request helper — GET /issues through the real dispatcher.
// ---------------------------------------------------------------------------
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => null) });

let ipSeq = 0;
const nextIp = () => `10.11.0.${++ipSeq}`;

async function getIssues({ base, ip = nextIp(), env = makeEnv() } = {}) {
 const suffix = base === undefined ? "" : `?base=${encodeURIComponent(base)}`;
 const res = await worker.fetch(
  new Request(`https://issues.test/issues${suffix}`, { headers: { "CF-Connecting-IP": ip } }),
  env,
 );
 return readJson(res);
}

const ISSUE_FIELDS = ["id", "issue", "repo", "severity", "title", "detail", "links"];
const byKind = (body, kind) => (body?.issues ?? []).filter((i) => i.issue === kind);
const byKindRepo = (body, kind, repo) => (body?.issues ?? []).find((i) => i.issue === kind && i.repo === repo) ?? null;

// ---------------------------------------------------------------------------
// 1. Round-trip: 200 {ok:true,base:"demo"}; exactly the derived
//    issue set with honest legs (each row carries kind:"derived"
//    + its issue leg); each row carries all seven fields; links is
//    an array; the conflicting path appears in detail; the
//    withheld-secret detail carries the key count; the stale-base
//    detail names the base.
try {
 const r = await getIssues({ base: "demo" });
 check("1 GET /issues?base=demo -> 200", r.status === 200, `got ${r.status} ${J(r.body)}`);
 check("1 body ok:true", r.body?.ok === true, J(r.body));
 check("1 body base echoed as demo", r.body?.base === "demo", J(r.body?.base));
 const issues = r.body?.issues;
 check("1 issues is an array", Array.isArray(issues), J(issues));

 const conflict = byKindRepo(r.body, "conflict", "agent-conflict");
 check("1 one conflict issue for agent-conflict", conflict !== null, J(byKind(r.body, "conflict")));
 check("1 conflict detail carries the conflicting path", conflict?.detail === "src/a.ts", J(conflict));
 check("1 conflict severity is high", conflict?.severity === "high", J(conflict));
 check("1 conflict links is an array", Array.isArray(conflict?.links) && conflict.links.length > 0, J(conflict?.links));
 check("1 conflict title names the path", typeof conflict?.title === "string" && conflict.title.includes("src/a.ts"), J(conflict?.title));

 const withheld = byKindRepo(r.body, "withheld-secret", "agent-secret");
 check("1 one withheld-secret issue for agent-secret", withheld !== null, J(byKind(r.body, "withheld-secret")));
 check("1 withheld-secret severity is medium", withheld?.severity === "medium", J(withheld));
 check("1 withheld-secret detail carries the path and the key count", withheld?.detail === "config/.env: 2 key(s) withheld", J(withheld));

 const stale = byKindRepo(r.body, "stale-base", "agent-stale");
 check("1 one stale-base issue for agent-stale", stale !== null, J(byKind(r.body, "stale-base")));
 check("1 stale-base severity is low", stale?.severity === "low", J(stale));
 check("1 stale-base detail names the base", typeof stale?.detail === "string" && stale.detail.includes("demo"), J(stale));

 const blocked = byKindRepo(r.body, "blocked-intent", "agent-nonaligned");
 check("1 one blocked-intent issue for the non-aligned candidate", blocked !== null, J(byKind(r.body, "blocked-intent")));
 check("1 blocked-intent severity is info", blocked?.severity === "info", J(blocked));
 check("1 blocked-intent detail names the matcher verdict", typeof blocked?.detail === "string" && blocked.detail.includes("ignore"), J(blocked?.detail));
 check("1 no issue for the clean candidate", (issues ?? []).every((i) => i.repo !== "agent-clean"), J(issues?.map((i) => i.repo)));
 check("1 no issue for the non-candidate fixtures", (issues ?? []).every((i) => i.repo !== "demo-2" && i.repo !== "agent-pending"), J(issues?.map((i) => i.repo)));

 check("1 every issue row carries all seven fields", (issues ?? []).every((i) => ISSUE_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(i, f))), J(issues?.map((i) => Object.keys(i))));
 check("1 every issue row is kind:derived", (issues ?? []).every((i) => i.kind === "derived"), J(issues?.map((i) => i.kind)));
 check("1 every issue links field is an array", (issues ?? []).every((i) => Array.isArray(i.links)), J(issues?.map((i) => typeof i.links)));

 // The masking law: no fixture secret value reaches the body.
 const serialized = r.text ?? "";
 check("1 no fixture secret value reaches the body", !serialized.includes(SECRET_VALUE), "secret value present");
} catch (e) {
 check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. Deterministic order: discovery order ≠ severity order (a
//    low discovered before a high) → the exact sorted sequence
//    (severityRank, kind, repo, detail); two consecutive reads
//    byte-identical.
// ---------------------------------------------------------------------------
try {
 const r1 = await getIssues({ base: "demo" });
 const r2 = await getIssues({ base: "demo" });
 const kinds = (r1.body?.issues ?? []).map((i) => `${i.severity}:${i.issue}:${i.repo}:${i.detail}`);
 // The pure comparator: severityRank (high=0…info=3),
 // then issue-leg, then repo, then detail — lexicographic.
 const rank = { high: 0, medium: 1, low: 2, info: 3 };
 const expected = [...kinds].sort((a, b) => {
  const pa = a.split(":");
  const pb = b.split(":");
  return (
   rank[pa[0]] - rank[pb[0]] ||
   (pa[1] < pb[1] ? -1 : pa[1] > pb[1] ? 1 : 0) ||
   (pa[2] < pb[2] ? -1 : pa[2] > pb[2] ? 1 : 0) ||
   (pa[3] < pb[3] ? -1 : pa[3] > pb[3] ? 1 : 0)
  );
 });
 check("2 issues are in deterministic (severity, issue, repo, detail) order", J(kinds) === J(expected), `got ${J(kinds)}`);
 // Discovery had the LOW-severity stale-base FIRST and
 // the HIGH-severity conflict second; the sort must have
 // reversed them (high=0 ahead of low=2, info=3 last).
 check("2 the high-severity conflict sorts first (discovery had a low first)", kinds.length >= 2 && kinds[0].startsWith("high:conflict:agent-conflict"), J(kinds));
 check("2 the info-severity blocked-intent sorts last", kinds.length >= 2 && kinds[kinds.length - 1].startsWith("info:blocked-intent"), J(kinds));
 check("2 two consecutive reads are byte-identical", r1.text === r2.text, "bodies differ");
} catch (e) {
 check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. Empty state: every candidate folds clean → issues: [].
// ---------------------------------------------------------------------------
try {
 // A roster of only the clean candidate (and the excluded
 // non-candidates) folds to no issues.
 listFor([READY("agent-clean"), { name: "demo-2", status: "ready", defaultBranch: "main" }]);
 const r = await getIssues({ base: "demo" });
 check("3 clean roster -> 200", r.status === 200, `got ${r.status}`);
 check("3 clean roster -> issues: []", J(r.body?.issues) === "[]", J(r.body?.issues));
 // Restore the full roster for the remaining groups.
 listFor([
  READY("agent-stale"),
  READY("agent-conflict"),
  READY("agent-secret"),
  READY("agent-clean"),
  READY("agent-nonaligned"),
  { name: "demo-2", status: "ready", defaultBranch: "main" },
  { name: "agent-pending", status: "importing", defaultBranch: "main" },
 ]);
} catch (e) {
 check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. AD-8 default seam: GET /issues (no base) == GET
//    /issues?base=demo (byte-identical bodies); base="" -> 400.
// ---------------------------------------------------------------------------
try {
 const omitted = await getIssues({});
 const explicit = await getIssues({ base: "demo" });
 check("4 omitted base -> 200", omitted.status === 200, `got ${omitted.status}`);
 check("4 omitted base == explicit base=demo (byte-identical)", omitted.text === explicit.text, "bodies differ");
 const empty = await getIssues({ base: "" });
 check("4 empty base -> 400", empty.status === 400, `got ${empty.status} ${J(empty.body)}`);
} catch (e) {
 check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. Charset: base="not demo!" -> 400 invalid base repo.
// ---------------------------------------------------------------------------
try {
 const r = await getIssues({ base: "not demo!" });
 check("5 charset-invalid base -> 400", r.status === 400, `got ${r.status} ${J(r.body)}`);
 check("5 400 body names the invalid base repo", typeof r.body?.error === "string" && r.body.error.startsWith("invalid base repo"), J(r.body));
} catch (e) {
 check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Allowlist (AD-9): base="notdemo-xyz" -> 403 repo-not-allowed
//    BEFORE any Artifacts read (the fake's get/list call counters
//    prove zero reads — the egress-guard discipline).
// ---------------------------------------------------------------------------
try {
 const beforeGet = READS.get;
 const beforeList = READS.list;
 const r = await getIssues({ base: "notdemo-xyz" });
 check("6 non-allowlisted base -> 403", r.status === 403, `got ${r.status} ${J(r.body)}`);
 check("6 403 body is repo-not-allowed", r.body?.error === "repo-not-allowed", J(r.body));
 check("6 the refusal fires before any ARTIFACTS.get", READS.get === beforeGet, `${READS.get} vs ${beforeGet}`);
 check("6 the refusal fires before any ARTIFACTS.list", READS.list === beforeList, `${READS.list} vs ${beforeList}`);
} catch (e) {
 check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7. Deny mode: AUTH_MODE absent -> 401 unauthorized (the
//    seam-precondition posture).
// ---------------------------------------------------------------------------
try {
 // Deny mode: an env whose AUTH_MODE is absent (not
 // "demo") — the authorize() chokepoint default-denies.
 const denyEnv = makeEnv();
 delete denyEnv.AUTH_MODE;
 const r = await getIssues({ base: "demo", env: denyEnv });
 check("7 deny mode -> 401", r.status === 401, `got ${r.status} ${J(r.body)}`);
 check("7 401 body is unauthorized", r.body?.error === "unauthorized", J(r.body));
} catch (e) {
 check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. Rate row: 60/60s per caller — the 61st in-window call is
//    429; a different caller is unaffected; ROUTE_RATE_LIMITS
//    ["/issues"] exists with limit 60.
// ---------------------------------------------------------------------------
try {
 check("8 ROUTE_RATE_LIMITS['/issues'] exists with limit 60", ROUTE_RATE_LIMITS["/issues"]?.limit === 60 && ROUTE_RATE_LIMITS["/issues"]?.windowMs === 60_000, J(ROUTE_RATE_LIMITS["/issues"]));
 // Cheap roster (only the clean candidate) so the window is
 // filled without per-candidate compute.
 listFor([READY("agent-clean")]);
 const floodIp = "10.99.0.77";
 let last = null;
 for (let i = 0; i < 61; i++) {
  last = await getIssues({ base: "demo", ip: floodIp });
 }
 check("8 the 61st in-window call from one caller -> 429", last.status === 429, `got ${last.status} ${J(last.body)}`);
 check("8 the 429 body is the uniform rate-limited envelope", J(last.body) === '{"ok":false,"error":"rate-limited"}', J(last.body));
 const other = await getIssues({ base: "demo", ip: "10.99.0.78" });
 check("8 a different caller is unaffected", other.status === 200, `got ${other.status} ${J(other.body)}`);
 // Restore the full roster.
 listFor([
  READY("agent-stale"),
  READY("agent-conflict"),
  READY("agent-secret"),
  READY("agent-clean"),
  { name: "demo-2", status: "ready", defaultBranch: "main" },
  { name: "agent-pending", status: "importing", defaultBranch: "main" },
 ]);
} catch (e) {
 check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. Registration: ROUTES carries GET /issues with action
//    "read"; the rate row is present (group 8 pins the values).
// ---------------------------------------------------------------------------
try {
 const entry = ROUTES.find((r) => r.path === "/issues" && r.method === "GET");
 check("9 ROUTES carries GET /issues", entry !== undefined, J(ROUTES.map((r) => `${r.method} ${r.path}`)));
 check("9 the /issues entry is action:read", entry?.action === "read", J(entry));
 check("9 the /issues entry carries a handler function", typeof entry?.handler === "function", J(entry));
 check("9 ROUTE_RATE_LIMITS carries the /issues row", ROUTE_RATE_LIMITS["/issues"] !== undefined, J(ROUTE_RATE_LIMITS));
} catch (e) {
 check("9 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 10. No-new-store invariance: the derivation reads only
//     env.ARTIFACTS (get/list/log/readFile/readTree/readBlob) —
//     the fake records every method call; assert zero put/delete
//     on Artifacts (read-only derivation, no new store).
// ---------------------------------------------------------------------------
try {
 WRITES.put = 0;
 WRITES.delete = 0;
 const r = await getIssues({ base: "demo" });
 check("10 the derivation succeeds over the full roster", r.status === 200, `got ${r.status}`);
 check("10 zero Artifacts.put calls", WRITES.put === 0, `${WRITES.put} put(s)`);
 check("10 zero Artifacts.delete calls", WRITES.delete === 0, `${WRITES.delete} delete(s)`);
} catch (e) {
 check("10 case threw", false, String(e?.stack ?? e));
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
