#!/usr/bin/env bun
// Contract suite: Issues v2 — the repo-scoped issue store's
// API surface (nextgit-e18). Run: bun porting/tests/issues-api-v2.test.mjs
// (exit 0 = pass)
//
// Real construction (the issues-v1.test.mjs / comments-api.test.mjs
// posture): imports the real `worker`, `ROUTES`, `DYNAMIC_ROUTES` from
// platform/src/index.ts and `ROUTE_RATE_LIMITS` from platform/src/rate.ts,
// and drives worker.fetch() over the REAL dispatcher (authorize +
// csrfGate + route tables + handlers) with an in-memory Artifacts fake
// (the issues-v1 fixture — real first-parent histories, real tree walks,
// so the derived legs still derive) and an in-memory Map-backed CACHE KV
// fake (exposing `store` so checks prove ZERO writes). No mock.module,
// no source grep. Every request carries a unique CF-Connecting-IP
// (10.18.0.<seq>) except deliberate single-caller rate bursts (the
// limiter is module-global).
//
// The suite is written against the landed contract (wave-17 land
// 1131de2 + reconcile commits):
//   Store: platform/src/index.ts (StoredIssueRecord, ISSUES_KEY_PREFIX
//   "issues:", MAX_ISSUE_{TITLE,BODY,ASSIGNEE}_CHARS 128/2000/128,
//   ISSUE_ID_HEX 12, parseIssuesPostBody closed schema exactly
//   {repo,title,body,severity}, parseIssuesPatchBody closed schema
//   exactly {state,assignee?}, readStoredIssues fail-closed [],
//   withIssueAppendGate per-repo serialization, appendIssue,
//   rewriteIssueLine in-place rewrite).
//   POST: 201 {ok:true,issue:<10 stored fields, no kind>}; order
//   400 shape -> 403 DEMO_REPO_RE allowlist -> 403 isSecretPath ->
//   429 rateGate("/issues:write").
//   PATCH: id from the pathname tail; order 400 empty-id -> 400 body
//   shape -> 400 REPO_NAME_RE base -> 403 allowlist on query base ->
//   403 secret-class -> 429 -> 404 not-found -> 409 already-closed ->
//   200 {ok:true,issue:<closed record>}.
//   GET merge: derived rows tagged kind:"derived", stored rows tagged
//   kind:"stored", concatenated [...derived, ...stored] (NOT re-sorted).
//   Rate: one shared "/issues:write" budget (20/60s) for POST and PATCH.
//
// Groups (each defends an observable contract):
//   1. Store round-trip (POST 201 -> GET merge).
//   2. GET merge determinism (derived-first concatenation).
//   3. PATCH close 200 -> repeat 409 (close-once).
//   4. PATCH 404s (unknown id, derived id, empty id).
//   5. Closed-schema 400s (unknown fields, missing/empty, vocabulary).
//   6. Secret-class repo 403 with ZERO writes + allowlist precedence.
//   7. Deny mode 401.
//   8. Rate (20/60s, one shared /issues:write budget).
//   9. Registration + 405 boundary.
//  10. CSRF posture (the wave-17 ship-gate blocker, pinned).

import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";
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
// In-memory Artifacts fake (issues-v1.test.mjs shape) — the bounded
// `list()` the discovery seam reads and the `get()` the compute seams
// read. WRITES/READS count the binding touches so groups 6 and 7 can
// prove zero reads / zero writes.
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

// The Artifacts binding fake. `get`/`list` count reads (group 6/7 prove
// the refusals fire before any of them); the binding carries NO
// put/delete at all — the derivation's only legal store touch is a read,
// so a write attempt throws and the request fails the group instead of
// silently passing.
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
// Fixture repos — the issues-v1.test.mjs shape (real first-parent
// histories so the derived legs still derive).
//
// The base repo `demo` carries TWO first-parent commits: the fork point
// `c1` (src/a.ts = A0) and the CURRENT base head `cBaseHead` (src/a.ts
// = A_BASE). A baseline that moved past the fork point is what makes the
// conflict leg a REAL diff3 conflict.
// ---------------------------------------------------------------------------
const SECRET_VALUE = "issues_api_v2_fixture_secret_9c4d21aa";
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

// Candidate 1 — a REAL conflict on src/a.ts.
const cConflict = commit("c-agent-conflict", tree({ ...FORK_POINT_FILES, "src/a.ts": A_FORK_CONFLICT }));
defineRepo("agent-conflict", {
 history: [cConflict, c1],
 refs: { main: cConflict.hash },
 intents: { [cConflict.hash]: "Rework the a module." },
});

// Candidate 2 — a withheld-secret file in its change-set.
const cSecret = commit(
 "c-agent-secret",
 tree({ ...FORK_POINT_FILES, "config/.env": `# demo env v2\nAPI_TOKEN=rotated_${SECRET_VALUE}\nDB_PASSWORD=new_${SECRET_VALUE}\n` }),
);
defineRepo("agent-secret", {
 history: [cSecret, c1],
 refs: { main: cSecret.hash },
 intents: { [cSecret.hash]: "Rotate the env keys." },
});

// Candidate 3 — stale base (no shared first-parent commit).
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

// Candidate 4 — clean.
const cClean = commit("c-agent-clean", tree({ ...FORK_POINT_FILES, "src/b.ts": B2 }));
defineRepo("agent-clean", {
 history: [cClean, c1],
 refs: { main: cClean.hash },
 intents: { [cClean.hash]: "Bump src/b.ts." },
});

// Candidate 5 — non-aligned (the blocked-intent leg).
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

// Non-candidate fixtures: a non-agent repo and a non-ready agent fork.
defineRepo("demo-2", { history: [cBaseHead, c1], refs: { main: cBaseHead.hash } });
defineRepo("agent-pending", { history: [c1], refs: { main: c1.hash } });

// ---------------------------------------------------------------------------
// Fake KV (CACHE): the issue store's `issues:<repo>` JSONL seam + the
// fork-lineage / compute caches. `store` is exposed so checks prove ZERO
// writes (the secret-class refusal, the CSRF refusal).
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

// The full discovery roster the route must filter. Discovery order is
// deliberately ≠ severity order (a LOW-severity candidate discovered
// BEFORE the HIGH-severity one) so the GET merge's derived prefix keeps
// its deterministic sorted order.
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
// Request helpers — every verb through the real dispatcher.
// ---------------------------------------------------------------------------
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => null) });

let ipSeq = 0;
const nextIp = () => `10.18.0.${++ipSeq}`;

/** POST /issues with a JSON body through the real dispatcher. */
async function postIssue(env, body, { ip = nextIp(), headers = {} } = {}) {
 const res = await worker.fetch(
  new Request("https://nextgit.invalid/issues", {
   method: "POST",
   headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
   body: J(body),
  }),
  env,
 );
 return readJson(res);
}

/** PATCH /issues/<id>?base=<base> with a JSON body through the real dispatcher. */
async function patchIssue(env, id, base, body, { ip = nextIp(), headers = {} } = {}) {
 const res = await worker.fetch(
  new Request(`https://nextgit.invalid/issues/${id}?base=${encodeURIComponent(base)}`, {
   method: "PATCH",
   headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
   body: J(body),
  }),
  env,
 );
 return readJson(res);
}

/** GET /issues?base=<base> through the real dispatcher. */
async function getIssues(env, base, { ip = nextIp() } = {}) {
 const res = await worker.fetch(
  new Request(`https://nextgit.invalid/issues?base=${encodeURIComponent(base)}`, {
   headers: { "CF-Connecting-IP": ip },
  }),
  env,
 );
 return readJson(res);
}

/** A generic verb request (the 405-boundary probes). */
async function rawRequest(env, { method, path, body, ip = nextIp(), headers = {} } = {}) {
 const init = { method, headers: { "CF-Connecting-IP": ip, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers } };
 if (body !== undefined) init.body = typeof body === "string" ? body : J(body);
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
 return readJson(res);
}

// The derived legs' issue identifiers (deriveIssues).
const DERIVED_LEGS = ["conflict", "withheld-secret", "stale-base", "blocked-intent"];
const ISSUE_ID_HEX_RE = /^[0-9a-f]{12}$/;
const STORED_FIELDS = ["id", "repo", "title", "body", "severity", "state", "assignee", "at", "closedAt"];

// A fresh env per group so CACHE stores cannot alias across cases. The
// Artifacts fake is module-rooted (the fixture), so derived rows are
// identical in every env — only the store differs.
const freshEnv = () => makeEnv();

// ---------------------------------------------------------------------------
// 1. Store round-trip (POST 201 -> GET merge). POST /issues
//    {repo:"demo",title,body,severity:"high"} -> 201 with the exact
//    10-field issue (id 12-hex, server-set at; NO kind discriminator —
//    kind is added only by the GET merge step); server-set at/id (caller
//    cannot choose them). GET /issues?base=demo -> 200 with the stored
//    row present, kind:"stored", state:"open", assignee:null; every
//    derived row carries kind:"derived"; the CACHE store holds key
//    "issues:demo" whose JSONL holds the row in append order (single row
//    -> one line). Two POSTs -> two rows, two lines, append order.
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const r = await postIssue(env, { repo: "demo", title: "triage: wire the close", body: "close-once semantics", severity: "high" });
 check("1 POST /issues -> 201", r.status === 201, `got ${r.status} ${J(r.body)}`);
 check("1 POST {ok:true}", r.body?.ok === true, J(r.body));
 const issue = r.body?.issue;
 check("1 POST issue is an object", !!issue && typeof issue === "object", J(r.body));
 check("1 issue carries exactly the 9 stored fields", !!issue && STORED_FIELDS.every((f) => f in issue) && Object.keys(issue).length === STORED_FIELDS.length, J(issue ? Object.keys(issue) : null));
 check("1 no kind discriminator on the POST response", !!issue && !("kind" in issue), J(issue));
 check("1 id is 12 lowercase hex", typeof issue?.id === "string" && ISSUE_ID_HEX_RE.test(issue.id), J(issue?.id));
 check("1 repo echoed", issue?.repo === "demo", J(issue?.repo));
 check("1 title echoed", issue?.title === "triage: wire the close", J(issue?.title));
 check("1 body echoed", issue?.body === "close-once semantics", J(issue?.body));
 check("1 severity echoed", issue?.severity === "high", J(issue?.severity));
 check("1 state open", issue?.state === "open", J(issue?.state));
 check("1 assignee null", issue?.assignee === null, J(issue?.assignee));
 check("1 closedAt null", issue?.closedAt === null, J(issue?.closedAt));
 check("1 at is server-set ISO-8601", typeof issue?.at === "string" && !Number.isNaN(Date.parse(issue.at)), J(issue?.at));

 // Caller cannot choose id/at: they are not in the POST schema, so
 // supplying them is a closed-schema 400 (group 5 pins the 400; here
 // we pin that the server minted them, i.e. they are present and
 // well-formed above).
 const stored = env.CACHE._store.get("issues:demo") ?? null;
 check("1 CACHE holds issues:demo", typeof stored === "string", J(env.CACHE._store.keys()));
 const lines = (stored ?? "").split("\n").filter((l) => l !== "");
 check("1 single POST -> single JSONL line", lines.length === 1, J(lines));
 const storedRow = lines.length === 1 ? JSON.parse(lines[0]) : null;
 check("1 stored row equals the response issue", J(storedRow) === J(issue), `${J(storedRow)} vs ${J(issue)}`);

 // GET merge: the stored row is present, kind:"stored"; every derived
 // row carries kind:"derived"; the derived prefix precedes the stored
 // suffix.
 const g = await getIssues(env, "demo");
 check("1 GET /issues -> 200", g.status === 200, `got ${g.status} ${J(g.body)}`);
 check("1 GET {ok:true, base:demo}", g.body?.ok === true && g.body?.base === "demo", J(g.body));
 const rows = g.body?.issues ?? [];
 const storedRows = rows.filter((i) => i.kind === "stored");
 const derivedRows = rows.filter((i) => i.kind === "derived");
 check("1 exactly one stored row", storedRows.length === 1, J(storedRows));
 check("1 stored row carries kind:stored + state open + assignee null",
  storedRows[0]?.state === "open" && storedRows[0]?.assignee === null && storedRows[0]?.id === issue?.id, J(storedRows[0]));
 check("1 derived rows present and all kind:derived", derivedRows.length > 0 && derivedRows.every((i) => i.kind === "derived"), J(derivedRows.length));
 check("1 every derived row carries its issue leg", derivedRows.every((i) => DERIVED_LEGS.includes(i.issue)), J(derivedRows.map((i) => i.issue)));
 check("1 derived prefix precedes stored suffix", rows.length > 0 && rows.indexOf(storedRows[0]) > rows.indexOf(derivedRows[derivedRows.length - 1]), "stored row not after the derived prefix");

 // Two POSTs -> two rows, two lines, append order (oldest first).
 const r2 = await postIssue(env, { repo: "demo", title: "second", body: "append order", severity: "low" });
 check("1 second POST -> 201", r2.status === 201, `got ${r2.status} ${J(r2.body)}`);
 const stored2 = env.CACHE._store.get("issues:demo") ?? "";
 const lines2 = stored2.split("\n").filter((l) => l !== "");
 check("1 two POSTs -> two JSONL lines", lines2.length === 2, J(lines2));
 check("1 append order preserved (first id precedes second id)",
  JSON.parse(lines2[0]).id === issue?.id && JSON.parse(lines2[1]).id === r2.body?.issue?.id,
  J([JSON.parse(lines2[0])?.id, JSON.parse(lines2[1])?.id]));
} catch (e) {
 check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. GET merge determinism — derived-first concatenation: every derived
//    row precedes every stored row; every derived row carries
//    kind:"derived" + its issue leg in {conflict, withheld-secret,
//    stale-base, blocked-intent}; every stored row carries kind:"stored";
//    two consecutive GETs byte-identical (the derived-prefix determinism
//    law — the merge is a concatenation, not a re-sort).
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 await postIssue(env, { repo: "demo", title: "determinism probe", body: "stored row must sort after derived", severity: "medium" });

 const g1 = await getIssues(env, "demo");
 const g2 = await getIssues(env, "demo");
 check("2 both GETs 200", g1.status === 200 && g2.status === 200, `${g1.status}/${g2.status}`);
 const rows1 = g1.body?.issues ?? [];
 const rows2 = g2.body?.issues ?? [];
 check("2 two consecutive GETs byte-identical", J(rows1) === J(rows2), "merge output is non-deterministic");

 const firstStoredIdx = rows1.findIndex((i) => i.kind === "stored");
 const derivedRows = rows1.filter((i) => i.kind === "derived");
 const storedRows = rows1.filter((i) => i.kind === "stored");
 check("2 derived rows precede every stored row",
  firstStoredIdx >= derivedRows.length && derivedRows.length + storedRows.length === rows1.length,
  `firstStoredIdx=${firstStoredIdx} derived=${derivedRows.length} stored=${storedRows.length} total=${rows1.length}`);
 check("2 every derived row carries kind:derived", derivedRows.every((i) => i.kind === "derived"), J(derivedRows.filter((i) => i.kind !== "derived")));
 check("2 every derived row's issue leg is in the vocabulary", derivedRows.every((i) => DERIVED_LEGS.includes(i.issue)), J(derivedRows.map((i) => i.issue)));
 check("2 every stored row carries kind:stored", storedRows.every((i) => i.kind === "stored"), J(storedRows.filter((i) => i.kind !== "stored")));
 check("2 the four derivation legs all derived (the fixture drives each)",
  DERIVED_LEGS.every((leg) => derivedRows.some((i) => i.issue === leg)),
  J([...new Set(derivedRows.map((i) => i.issue))]));
 check("2 exactly one stored row present", storedRows.length === 1, J(storedRows.length));
 check("2 stored row keeps its append-order identity (id matches POST)",
  storedRows[0]?.title === "determinism probe", J(storedRows[0]?.title));
} catch (e) {
 check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. PATCH close 200 -> repeat 409 — POST then PATCH /issues/<id>?base=demo
//    {state:"closed"} -> 200 {ok:true, issue:{...state:"closed",
//    closedAt:<iso>}}; the stored JSONL line is rewritten in place (same
//    index, same id); repeat PATCH -> 409 {ok:false,error:"already-closed"};
//    PATCH {state:"open"} against the closed issue -> also 409 (close-only
//    semantics); PATCH with assignee:"reviewer" rides along on the close.
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const r = await postIssue(env, { repo: "demo", title: "close me once", body: "close-once", severity: "high" });
 const id = r.body?.issue?.id;
 const before = env.CACHE._store.get("issues:demo") ?? "";
 const beforeLines = before.split("\n").filter((l) => l !== "");

 const p = await patchIssue(env, id, "demo", { state: "closed" });
 check("3 PATCH close -> 200", p.status === 200, `got ${p.status} ${J(p.body)}`);
 check("3 PATCH {ok:true}", p.body?.ok === true, J(p.body));
 check("3 closed issue carries state:closed", p.body?.issue?.state === "closed", J(p.body?.issue));
 check("3 closedAt is a server-set ISO-8601 instant",
  typeof p.body?.issue?.closedAt === "string" && !Number.isNaN(Date.parse(p.body?.issue.closedAt)), J(p.body?.issue?.closedAt));
 check("3 id preserved on close", p.body?.issue?.id === id, J(p.body?.issue?.id));

 // The JSONL line is rewritten IN PLACE: same line index, same id.
 const after = env.CACHE._store.get("issues:demo") ?? "";
 const afterLines = after.split("\n").filter((l) => l !== "");
 check("3 line count unchanged (in-place rewrite)", afterLines.length === beforeLines.length, `${afterLines.length} vs ${beforeLines.length}`);
 check("3 same line index, same id",
  JSON.parse(afterLines[0]).id === id && JSON.parse(beforeLines[0]).id === id,
  J([JSON.parse(beforeLines[0])?.id, JSON.parse(afterLines[0])?.id]));
 check("3 stored line now carries state:closed", JSON.parse(afterLines[0]).state === "closed", J(afterLines[0]));

 // Repeat PATCH -> 409 already-closed.
 const repeat = await patchIssue(env, id, "demo", { state: "closed" });
 check("3 repeat close -> 409 already-closed", repeat.status === 409 && repeat.body?.error === "already-closed", `got ${repeat.status} ${J(repeat.body)}`);
 check("3 repeat close {ok:false}", repeat.body?.ok === false, J(repeat.body));

 // PATCH {state:"open"} against the closed issue -> also 409 (close-only).
 const reopen = await patchIssue(env, id, "demo", { state: "open" });
 check("3 reopen a closed issue -> 409 already-closed (close-only)", reopen.status === 409 && reopen.body?.error === "already-closed", `got ${reopen.status} ${J(reopen.body)}`);

 // assignee rides along on the close (a second issue, so the closed one
 // stays closed for the 409 legs above).
 const r2 = await postIssue(env, { repo: "demo", title: "assign me", body: "assignee rides along", severity: "low" });
 const id2 = r2.body?.issue?.id;
 const p2 = await patchIssue(env, id2, "demo", { state: "closed", assignee: "reviewer" });
 check("3 PATCH close with assignee -> 200", p2.status === 200, `got ${p2.status} ${J(p2.body)}`);
 check("3 assignee rides along on the close", p2.body?.issue?.assignee === "reviewer", J(p2.body?.issue?.assignee));
 const storedRow2 = JSON.parse((env.CACHE._store.get("issues:demo") ?? "").split("\n").filter((l) => l !== "")[1]);
 check("3 stored row carries the assignee", storedRow2.assignee === "reviewer", J(storedRow2.assignee));
} catch (e) {
 check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. PATCH 404s — unknown 12-hex id -> 404 {ok:false,error:"not-found"};
//    a derived row id (e.g. conflict:agent-conflict:src/a.ts) -> 404
//    (derived rows are never in the store — the store is the only
//    mutable surface); empty id (PATCH /issues/?base=demo) -> 400
//    bad-request (the pathname-tail extraction).
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const unknown = await patchIssue(env, "deadbeefdead", "demo", { state: "closed" });
 check("4 unknown 12-hex id -> 404 not-found", unknown.status === 404 && unknown.body?.error === "not-found", `got ${unknown.status} ${J(unknown.body)}`);
 check("4 unknown id {ok:false}", unknown.body?.ok === false, J(unknown.body));

 // A derived row id — the store is the only mutable surface, so a
 // derived id is a 404 (never a 200/409).
 const derived = await patchIssue(env, "conflict:agent-conflict:src/a.ts", "demo", { state: "closed" });
 check("4 derived row id -> 404 not-found", derived.status === 404 && derived.body?.error === "not-found", `got ${derived.status} ${J(derived.body)}`);

 // Empty id: PATCH /issues/?base=demo -> 400 bad-request (the
 // pathname-tail extraction yields "" which the handler 400s).
 const empty = await rawRequest(env, {
  method: "PATCH",
  path: "/issues/?base=demo",
  body: { state: "closed" },
 });
 check("4 empty id -> 400 bad-request", empty.status === 400 && empty.body?.error === "bad-request", `got ${empty.status} ${J(empty.body)}`);
} catch (e) {
 check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. Closed-schema 400s — POST unknown field (assignee is NOT in the POST
//    schema -> 400; id; at); PATCH unknown field (title); POST missing
//    title / empty title / empty body; POST severity:"critical" (not in
//    the 4-value vocabulary) -> 400; POST repo:"not demo!" (charset) ->
//    400; PATCH state:"weird" -> 400; PATCH assignee:"" (empty) -> 400;
//    malformed JSON body -> 400.
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const cases = [
  ["POST unknown field assignee", () => postIssue(env, { repo: "demo", title: "t", body: "b", severity: "high", assignee: "x" })],
  ["POST unknown field id", () => postIssue(env, { repo: "demo", title: "t", body: "b", severity: "high", id: "chosen" })],
  ["POST unknown field at", () => postIssue(env, { repo: "demo", title: "t", body: "b", severity: "high", at: "2020-01-01T00:00:00Z" })],
  ["POST missing title", () => postIssue(env, { repo: "demo", body: "b", severity: "high" })],
  ["POST empty title", () => postIssue(env, { repo: "demo", title: "", body: "b", severity: "high" })],
  ["POST empty body", () => postIssue(env, { repo: "demo", title: "t", body: "", severity: "high" })],
  ["POST severity critical (not in vocabulary)", () => postIssue(env, { repo: "demo", title: "t", body: "b", severity: "critical" })],
  ["POST repo charset 'not demo!'", () => postIssue(env, { repo: "not demo!", title: "t", body: "b", severity: "high" })],
  ["PATCH unknown field title", () => patchIssue(env, "deadbeefdead", "demo", { state: "closed", title: "nope" })],
  ["PATCH state weird", () => patchIssue(env, "deadbeefdead", "demo", { state: "weird" })],
  ["PATCH empty assignee", () => patchIssue(env, "deadbeefdead", "demo", { state: "closed", assignee: "" })],
  ["PATCH missing state", () => patchIssue(env, "deadbeefdead", "demo", { assignee: "x" })],
 ];
 for (const [name, run] of cases) {
  const r = await run();
  check(`5 ${name} -> 400 bad-request`, r.status === 400, `got ${r.status} ${J(r.body)}`);
 }
 // Malformed JSON body -> 400.
 const malformed = await rawRequest(env, {
  method: "POST",
  path: "/issues",
  body: "{not json",
 });
 check("5 malformed JSON body -> 400", malformed.status === 400, `got ${malformed.status} ${J(malformed.body)}`);
 // The closed-schema refusals must not have written anything.
 check("5 no closed-schema refusal wrote to the store", !env.CACHE._store.has("issues:demo"), J([...env.CACHE._store.keys()]));
} catch (e) {
 check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Secret-class repo 403 with ZERO writes — POST an
//    allowlisted repo whose NAME is secret-class (the basename
//    *.pem rule fires on the repo NAME: "demo-x.pem" matches the
//    AD-9 allowlist (demo-<suffix>) AND carries a .pem basename)
//    -> 403 {ok:false,error:"secret-class"} and the CACHE store
//    has NO issues:demo-x.pem key (zero writes); PATCH against
//    base=demo-x.pem -> 403 secret-class, zero writes. The
//    *.key / *.p12 basename rules are the other live legs on an
//    allowlisted name. Allowlist precedence: POST
//    {repo:"notdemo-xyz"} -> 403 repo-not-allowed (not
//    secret-class) — the 403 ordering law (the handler checks
//    DEMO_REPO_RE before isSecretPath, so a name that fails the
//    allowlist is repo-not-allowed even when it also looks
//    secret-class).
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const secret = await postIssue(env, { repo: "demo-x.pem", title: "t", body: "b", severity: "high" });
 check("6 POST repo demo-x.pem -> 403 secret-class", secret.status === 403 && secret.body?.error === "secret-class", `got ${secret.status} ${J(secret.body)}`);
 check("6 secret-class refusal wrote NOTHING", !env.CACHE._store.has("issues:demo-x.pem"), J([...env.CACHE._store.keys()]));

 const patchSecret = await patchIssue(env, "deadbeefdead", "demo-x.pem", { state: "closed" });
 check("6 PATCH base demo-x.pem -> 403 secret-class", patchSecret.status === 403 && patchSecret.body?.error === "secret-class", `got ${patchSecret.status} ${J(patchSecret.body)}`);
 check("6 PATCH secret-class refusal wrote NOTHING", !env.CACHE._store.has("issues:demo-x.pem"), J([...env.CACHE._store.keys()]));

 // Allowlist precedence: a non-allowlisted, charset-valid repo
 // name is repo-not-allowed, NOT secret-class (the handler
 // checks DEMO_REPO_RE before isSecretPath).
 const notAllowed = await postIssue(env, { repo: "notdemo-xyz", title: "t", body: "b", severity: "high" });
 check("6 allowlist precedes secret-class (notdemo-xyz -> repo-not-allowed)",
  notAllowed.status === 403 && notAllowed.body?.error === "repo-not-allowed", `got ${notAllowed.status} ${J(notAllowed.body)}`);

 // The *.key and *.p12 basename rules are the other live
 // secret-class legs on a repo NAME (the name passes both
 // REPO_NAME_RE and DEMO_REPO_RE, so charset and allowlist are
 // fine; only the basename rule fires).
 const key = await postIssue(env, { repo: "agent-x.key", title: "t", body: "b", severity: "high" });
 check("6 POST repo agent-x.key -> 403 secret-class", key.status === 403 && key.body?.error === "secret-class", `got ${key.status} ${J(key.body)}`);
 check("6 agent-x.key refusal wrote NOTHING", !env.CACHE._store.has("issues:agent-x.key"), J([...env.CACHE._store.keys()]));
 const p12 = await postIssue(env, { repo: "demo-x.p12", title: "t", body: "b", severity: "high" });
 check("6 POST repo demo-x.p12 -> 403 secret-class", p12.status === 403 && p12.body?.error === "secret-class", `got ${p12.status} ${J(p12.body)}`);
 check("6 demo-x.p12 refusal wrote NOTHING", !env.CACHE._store.has("issues:demo-x.p12"), J([...env.CACHE._store.keys()]));
} catch (e) {
 check("6 case threw", false, String(e?.stack ?? e));
}

try {
 // Deny mode: an env whose AUTH_MODE is absent (not "demo") —
 // the authorize() chokepoint default-denies (the issues-v1
 // group-7 posture: build the env, then delete AUTH_MODE, so
 // the undefined does not re-trigger makeEnv's "demo" default).
 const denyEnv = makeEnv();
 delete denyEnv.AUTH_MODE;
 // READS is a module-global cumulative counter; snapshot it so
 // the zero-read proof is a delta, not an absolute.
 const readsBefore = { ...READS };
 const post = await postIssue(denyEnv, { repo: "demo", title: "t", body: "b", severity: "high" });
 check("7 POST in deny mode -> 401 unauthorized", post.status === 401 && post.body?.error === "unauthorized", `got ${post.status} ${J(post.body)}`);
 const patch = await patchIssue(denyEnv, "deadbeefdead", "demo", { state: "closed" });
 check("7 PATCH in deny mode -> 401 unauthorized", patch.status === 401 && patch.body?.error === "unauthorized", `got ${patch.status} ${J(patch.body)}`);
 check("7 deny mode touched NOTHING in the store", denyEnv.CACHE._store.size === 0, J([...denyEnv.CACHE._store.keys()]));
 check("7 deny mode performed ZERO Artifacts reads",
  READS.get === readsBefore.get && READS.list === readsBefore.list,
  `get ${readsBefore.get}->${READS.get} list ${readsBefore.list}->${READS.list}`);
} catch (e) {
 check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. Rate (20/60s, one shared /issues:write budget) — 20 POSTs from one
//    caller (one deliberate caller IP for the burst) -> first 20 201,
//    21st 429 {ok:false,error:"rate-limited"}; a distinct caller IP is
//    unaffected (its POST is 201); PATCH shares the SAME budget: exhaust
//    the budget via POSTs, then a PATCH from the same caller -> 429 (the
//    shared-key law — pinned from the route side: ROUTE_RATE_LIMITS
//    ["/issues:write"] exists with limit 20, windowMs 60000).
// ---------------------------------------------------------------------------
try {
 // Route-side pin first.
 const row = ROUTE_RATE_LIMITS["/issues:write"];
 check("8 ROUTE_RATE_LIMITS['/issues:write'] = {limit:20, windowMs:60000}",
  row?.limit === 20 && row?.windowMs === 60000, J(row));

 // A fresh env + a single deliberate caller IP for the burst.
 const env = freshEnv();
 const burstIp = "10.18.99.99";
 let last = null;
 for (let i = 0; i < 20; i++) {
  last = await postIssue(env, { repo: "demo", title: `burst ${i}`, body: "b", severity: "low" }, { ip: burstIp });
 }
 check("8 first 20 POSTs all 201", last?.status === 201, `last was ${last?.status} ${J(last?.body)}`);
 const twentyFirst = await postIssue(env, { repo: "demo", title: "one too many", body: "b", severity: "low" }, { ip: burstIp });
 check("8 21st POST -> 429 rate-limited", twentyFirst.status === 429 && twentyFirst.body?.error === "rate-limited", `got ${twentyFirst.status} ${J(twentyFirst.body)}`);

 // A distinct caller IP is unaffected (per-caller isolation).
 const other = await postIssue(env, { repo: "demo", title: "unaffected", body: "b", severity: "low" }, { ip: "10.18.99.100" });
 check("8 a distinct caller IP is unaffected (201)", other.status === 201, `got ${other.status} ${J(other.body)}`);

 // PATCH shares the SAME budget: exhaust it via POSTs from ONE caller,
 // then a PATCH from that same caller -> 429.
 const env2 = freshEnv();
 const sharedIp = "10.18.99.101";
 for (let i = 0; i < 20; i++) {
  await postIssue(env2, { repo: "demo", title: `shared ${i}`, body: "b", severity: "low" }, { ip: sharedIp });
 }
 // First seed one issue to close (from a DIFFERENT caller so the burst
 // caller's budget is still fully exhausted by the 20 POSTs).
 const seeded = await postIssue(env2, { repo: "demo", title: "seed", body: "b", severity: "low" }, { ip: "10.18.99.102" });
 const seedId = seeded.body?.issue?.id;
 const sharedPatch = await patchIssue(env2, seedId, "demo", { state: "closed" }, { ip: sharedIp });
 check("8 PATCH shares the /issues:write budget (exhausted caller's PATCH -> 429)",
  sharedPatch.status === 429 && sharedPatch.body?.error === "rate-limited", `got ${sharedPatch.status} ${J(sharedPatch.body)}`);
 // The issue was NOT closed (the 429 fired before the store access).
 const storedAfter = JSON.parse((env2.CACHE._store.get("issues:demo") ?? "").split("\n").filter((l) => l !== "").find((l) => JSON.parse(l).id === seedId) ?? "{}");
 check("8 the rate-limited PATCH closed NOTHING (state still open)", storedAfter.state === "open", J(storedAfter.state));
} catch (e) {
 check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. Registration + 405 boundary — ROUTES carries
//    {path:"/issues", method:"POST", action:"write"} and
//    {path:"/issues", method:"GET", action:"read"}; DYNAMIC_ROUTES
//    carries {prefix:"/issues/", method:"PATCH", action:"write"};
//    ROUTE_RATE_LIMITS["/issues:write"] = {limit:20, windowMs:60000}.
//    Method boundary: PUT /issues -> 405 method-not-allowed;
//    DELETE /issues -> 405; GET /issues/<id> -> 405 (known dynamic
//    prefix, wrong method); POST /issues/<id> -> 405.
// ---------------------------------------------------------------------------
try {
 const postEntry = ROUTES.find((r) => r.path === "/issues" && r.method === "POST");
 const getEntry = ROUTES.find((r) => r.path === "/issues" && r.method === "GET");
 check("9 ROUTES carries POST /issues with action:write",
  postEntry?.action === "write", J(postEntry && { path: postEntry.path, method: postEntry.method, action: postEntry.action }));
 check("9 ROUTES carries GET /issues with action:read",
  getEntry?.action === "read", J(getEntry && { path: getEntry.path, method: getEntry.method, action: getEntry.action }));
 const dynEntry = DYNAMIC_ROUTES.find((r) => r.prefix === "/issues/" && r.method === "PATCH");
 check("9 DYNAMIC_ROUTES carries PATCH /issues/ with action:write",
  dynEntry?.action === "write", J(dynEntry && { prefix: dynEntry.prefix, method: dynEntry.method, action: dynEntry.action }));

 // 405 boundary: a registered path with the wrong method.
 const env = freshEnv();
 const put = await rawRequest(env, { method: "PUT", path: "/issues", body: { repo: "demo", title: "t", body: "b", severity: "high" } });
 check("9 PUT /issues -> 405 method-not-allowed", put.status === 405 && put.body?.error === "method-not-allowed", `got ${put.status} ${J(put.body)}`);
 const del = await rawRequest(env, { method: "DELETE", path: "/issues" });
 check("9 DELETE /issues -> 405 method-not-allowed", del.status === 405 && del.body?.error === "method-not-allowed", `got ${del.status} ${J(del.body)}`);
 const getDynamic = await rawRequest(env, { method: "GET", path: "/issues/deadbeefdead?base=demo" });
 check("9 GET /issues/<id> -> 405 (known dynamic prefix, wrong method)",
  getDynamic.status === 405 && getDynamic.body?.error === "method-not-allowed", `got ${getDynamic.status} ${J(getDynamic.body)}`);
 const postDynamic = await rawRequest(env, { method: "POST", path: "/issues/deadbeefdead", body: { state: "closed" } });
 check("9 POST /issues/<id> -> 405 (known dynamic prefix, wrong method)",
  postDynamic.status === 405 && postDynamic.body?.error === "method-not-allowed", `got ${postDynamic.status} ${J(postDynamic.body)}`);
 // The 405s fired before the handler: no writes, no reads.
 check("9 the 405 probes touched NOTHING in the store", env.CACHE._store.size === 0, J([...env.CACHE._store.keys()]));
} catch (e) {
 check("9 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 10. CSRF posture (the wave-17 ship-gate blocker, pinned) — PATCH
//     /issues/<id>?base=demo carrying a Cookie header and NO
//     x-csrf-token -> 403 {ok:false,error:"csrf-required"} with ZERO
//     writes (the store row's state is still "open" and closedAt still
//     null); POST with a Cookie header and no token -> 403 csrf-required,
//     zero writes; a cookie-carrying PATCH WITH a non-empty but wrong
//     x-csrf-token -> 403 csrf-required (csrfExpectedToken() returns null
//     — the unwired-seam fail-closed law; the suite pins that the null
//     must NOT be "fixed" into a real token source); header-only PATCH
//     (no Cookie) proceeds (the gate does not apply — group 3's close
//     already proves this path).
// ---------------------------------------------------------------------------
try {
 const env = freshEnv();
 const r = await postIssue(env, { repo: "demo", title: "csrf probe", body: "cookie identity", severity: "high" });
 const id = r.body?.issue?.id;

 // PATCH with a Cookie and NO x-csrf-token -> 403 csrf-required, zero writes.
 const patchNoToken = await patchIssue(env, id, "demo", { state: "closed" }, { headers: { Cookie: "session=abc" } });
 check("10 cookie PATCH with no token -> 403 csrf-required",
  patchNoToken.status === 403 && patchNoToken.body?.error === "csrf-required", `got ${patchNoToken.status} ${J(patchNoToken.body)}`);
 const row = JSON.parse((env.CACHE._store.get("issues:demo") ?? "").split("\n").filter((l) => l !== "")[0] ?? "{}");
 check("10 the refused PATCH closed NOTHING (state still open)", row.state === "open" && row.closedAt === null, J({ state: row.state, closedAt: row.closedAt }));

 // POST with a Cookie and no token -> 403 csrf-required, zero writes.
 const postNoToken = await postIssue(env, { repo: "demo", title: "cookie post", body: "b", severity: "high" }, { headers: { Cookie: "session=abc" } });
 check("10 cookie POST with no token -> 403 csrf-required",
  postNoToken.status === 403 && postNoToken.body?.error === "csrf-required", `got ${postNoToken.status} ${J(postNoToken.body)}`);
 const linesAfterPost = (env.CACHE._store.get("issues:demo") ?? "").split("\n").filter((l) => l !== "");
 check("10 the refused POST appended NOTHING (still one line)", linesAfterPost.length === 1, J(linesAfterPost.length));

 // A cookie-carrying PATCH WITH a non-empty but WRONG x-csrf-token ->
 // still 403 (csrfExpectedToken() returns null — the unwired-seam
 // fail-closed law).
 const patchWrongToken = await patchIssue(env, id, "demo", { state: "closed" }, { headers: { Cookie: "session=abc", "x-csrf-token": "wrong-but-nonempty" } });
 check("10 cookie PATCH with a WRONG token -> 403 csrf-required (fail-closed unwired seam)",
  patchWrongToken.status === 403 && patchWrongToken.body?.error === "csrf-required", `got ${patchWrongToken.status} ${J(patchWrongToken.body)}`);
 const row2 = JSON.parse((env.CACHE._store.get("issues:demo") ?? "").split("\n").filter((l) => l !== "")[0] ?? "{}");
 check("10 the wrong-token PATCH closed NOTHING (state still open)", row2.state === "open" && row2.closedAt === null, J({ state: row2.state, closedAt: row2.closedAt }));

 // Header-only PATCH (no Cookie) proceeds — group 3 already proved the
 // close path; assert it once more here so the gate's scope is pinned in
 // the same group as the refusals.
 const headerOnly = await patchIssue(env, id, "demo", { state: "closed" });
 check("10 header-only PATCH (no Cookie) proceeds -> 200", headerOnly.status === 200, `got ${headerOnly.status} ${J(headerOnly.body)}`);
} catch (e) {
 check("10 case threw", false, String(e?.stack ?? e));
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
