#!/usr/bin/env bun
// Contract suite: POST /reveal — the authorized, audited seam rule (FR-31).
// Run: bun porting/tests/reveal-seam.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts
// and drives worker.fetch() with an in-memory env — the same harness as
// auth-seam.test.mjs / judge.test.mjs. The Artifacts fake is the real
// git-ish shape (content-addressed blobs, trees, commits, refs) seeded
// with agent-5/config/.env (the two ENV_LINES from secret-fixture.mjs).
// No module mocks, no source grep — the route is exercised end-to-end
// through the real dispatcher (authorize mode gate + CSRF gate + handler).

import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") });

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the real git-ish surface the reveal path reads).
// ---------------------------------------------------------------------------
const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history: [] newest-first, refs, intents }

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
   const blobHash = lookupPath(head.treeHash, path);
   return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
  },
  async readBlob(hash) {
   return blobText.has(hash) ? new Blob([blobText.get(blobHash)]) : null;
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

// --- fixture: agent-5/config/.env (the two ENV_LINES from secret-fixture.mjs) ---
const ENV_LINES = [
 "DATABASE_URL=postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app",
 "REDIS_URL=redis://cache.internal:6379",
];
const ENV_CONTENT = `${ENV_LINES.join("\n")}\n`;
const FIXTURE_VALUE = "postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app";
const PLAIN_FILE = "export const a = 1;\n";

const BASE_FILES = { "src/a.ts": PLAIN_FILE };
// demo's .env differs from agent-5's so the agent-5 change-set carries a
// real config/.env row (secret-class) for the no-leak check (J).
const DEMO_ENV = "DATABASE_URL=demo-only-value\nREDIS_URL=redis://cache.internal:6379\n";
const c1 = commit("c-base", tree({ ...BASE_FILES, "config/.env": DEMO_ENV }));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
const a5 = commit("c-agent-5", tree({ ...BASE_FILES, "config/.env": ENV_CONTENT }));
defineRepo("agent-5", { history: [a5, c1], refs: { main: a5.hash } });

const ARTIFACTS = { async get(name) { return repoFor(name); } };

// --- REVEAL_AUDIT recorder (KV-shaped) --------------------------------------
const auditWrites = [];
const REVEAL_AUDIT = {
 async put(key, value) {
  auditWrites.push({ key, value });
 },
};

// --- env factory ----------------------------------------------------------
// reads: counts Artifacts.get calls (to prove "zero repo reads" on denials).
let artifactGetCount = 0;
const countingArtifacts = {
 async get(name) {
  artifactGetCount++;
  return ARTIFACTS.get(name);
 },
};

const makeEnv = ({ authMode, revealAllow, audit = REVEAL_AUDIT } = {}) => {
 artifactGetCount = 0;
 auditWrites.length = 0;
 return {
  ARTIFACTS: countingArtifacts,
  LIVE: {},
  CACHE: {},
  ASSETS: { async fetch() { return new Response("assets", { status: 200 }); } },
  AI: {},
  LAND_LEASE: {},
  EVENTS_HUB: {},
  ...(authMode !== undefined ? { AUTH_MODE: authMode } : {}),
  ...(revealAllow !== undefined ? { REVEAL_ALLOW: revealAllow } : {}),
  ...(audit ? { REVEAL_AUDIT: audit } : {}),
 };
};

const post = async (env, path, body, headers = {}) => {
 const h = { "Content-Type": "application/json", ...headers };
 return readJson(await worker.fetch(new Request(`https://worker.local${path}`, { method: "POST", headers: h, body: J(body) }), env, {}));
};
const get = async (env, path, headers = {}) => {
 return readJson(await worker.fetch(new Request(`https://worker.local${path}`, { method: "GET", headers }), env, {}));
};

const revealBody = { repo: "agent-5", ref: "main", path: "config/.env", key: "DATABASE_URL" };

// ---------------------------------------------------------------------------
// A — deny mode (AUTH_MODE unset) ⇒ 401 unauthorized, no value, zero
// Artifacts reads (fake's get throws — a 500 proves the gate failed),
// zero audit writes.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({}); // AUTH_MODE unset ⇒ deny
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("A: deny mode → 401 unauthorized",
  r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized",
  J({ status: r.status, body: r.body }));
 check("A: deny mode → no value in body", r.text?.includes(FIXTURE_VALUE) === false);
 check("A: deny mode → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("A: deny mode → zero audit writes", auditWrites.length === 0, J(auditWrites));
}

// ---------------------------------------------------------------------------
// B — demo mode, no REVEAL_ALLOW (default = no one) ⇒ 403
// reveal-not-authorized, no value, zero Artifacts reads, exactly one
// denied audit record whose JSON has no value field and whose bytes
// don't contain the secret.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo" }); // REVEAL_ALLOW absent
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("B: no allowlist → 403 reveal-not-authorized",
  r.status === 403 && r.body?.ok === false && r.body?.error === "reveal-not-authorized",
  J({ status: r.status, body: r.body }));
 check("B: no allowlist → no value", r.text?.includes(FIXTURE_VALUE) === false);
 check("B: no allowlist → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("B: exactly one denied audit record", auditWrites.length === 1, J(auditWrites));
 const rec = JSON.parse(auditWrites[0]?.value ?? "{}");
 check("B: audit decision is denied", rec.decision === "denied", J(rec));
 check("B: audit record has no value field", !("value" in rec), J(rec));
 check("B: audit bytes never contain the secret", !auditWrites[0]?.value?.includes("FAKE-SECRET-DO-NOT-USE"));
}

// ---------------------------------------------------------------------------
// C — identity not in allowlist ⇒ same 403 + audit-denied.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "someone-else" }] });
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("C: unknown identity → 403 reveal-not-authorized",
  r.status === 403 && r.body?.error === "reveal-not-authorized", J({ status: r.status, body: r.body }));
 check("C: unknown identity → no value", r.text?.includes(FIXTURE_VALUE) === false);
 check("C: unknown identity → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("C: one denied audit record", auditWrites.length === 1 && JSON.parse(auditWrites[0].value).decision === "denied", J(auditWrites));
}

// ---------------------------------------------------------------------------
// D — identity in allowlist but repo outside its `repos` scope ⇒ 403
// + audit-denied (repo-scope half of the rule).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-6"] }] });
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("D: repo-scope mismatch → 403 reveal-not-authorized",
  r.status === 403 && r.body?.error === "reveal-not-authorized", J({ status: r.status, body: r.body }));
 check("D: repo-scope mismatch → no value", r.text?.includes(FIXTURE_VALUE) === false);
 check("D: repo-scope mismatch → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("D: one denied audit record", auditWrites.length === 1 && JSON.parse(auditWrites[0].value).decision === "denied", J(auditWrites));
}

// ---------------------------------------------------------------------------
// D2 — granted (repos-absent) identity + charset-valid repo OUTSIDE the
// demo namespace ⇒ 403 repo-not-allowed + zero Artifacts reads + zero
// audit writes (AD-9 boundary holds on the body-carried scope; the
// dispatcher chokepoint cannot see body.repo, so the handler must).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity" }] });
 const r = await post(env, "/reveal", { ...revealBody, repo: "notdemo-xyz" }, { Authorization: "Bearer test-identity" });
 check("D2: repos-absent grant + non-demo repo → 403 repo-not-allowed",
  r.status === 403 && r.body?.ok === false && r.body?.error === "repo-not-allowed"
  && r.body?.detail === `repo "notdemo-xyz" is outside the demo allowlist`,
  J({ status: r.status, body: r.body }));
 check("D2: non-demo repo → no value", r.text?.includes(FIXTURE_VALUE) === false);
 check("D2: non-demo repo → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("D2: non-demo repo → zero audit writes", auditWrites.length === 0, J(auditWrites));
}

// ---------------------------------------------------------------------------
// E — authorized grant ({ id:"test-identity", repos:["agent-5"] },
// body {repo:"agent-5",ref:"main",path:"config/.env",key:"DATABASE_URL"},
// Authorization: Bearer test-identity) ⇒ 200 with the EXACT fixture
// value (proves the real Artifacts read), plus exactly one granted
// record containing identity/repo/path/key/at and NOT the value string.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("E: authorized grant → 200",
  r.status === 200 && r.body?.ok === true, J({ status: r.status, body: r.body }));
 check("E: 200 carries the exact fixture value",
  r.body?.value === FIXTURE_VALUE, J(r.body?.value));
 check("E: 200 echoes repo/ref/path/key",
  r.body?.repo === "agent-5" && r.body?.ref === "main" && r.body?.path === "config/.env" && r.body?.key === "DATABASE_URL",
  J(r.body));
 check("E: grant reads the repo (one Artifacts read)", artifactGetCount === 1, `reads=${artifactGetCount}`);
 check("E: exactly one granted audit record", auditWrites.length === 1, J(auditWrites));
 const rec = JSON.parse(auditWrites[0]?.value ?? "{}");
 check("E: audit decision is granted", rec.decision === "granted", J(rec));
 check("E: audit carries identity/repo/path/key/at",
  rec.identity === "test-identity" && rec.repo === "agent-5" && rec.path === "config/.env" && rec.key === "DATABASE_URL" && typeof rec.at === "string",
  J(rec));
 check("E: audit record has no value field", !("value" in rec), J(rec));
 check("E: audit bytes never contain the secret", !auditWrites[0]?.value?.includes("FAKE-SECRET-DO-NOT-USE"));
}

// ---------------------------------------------------------------------------
// E2 — in-namespace grant under a repos-ABSENT entry (the documented
// "every demo-namespace repo" posture, CONTRACT.md §POST /reveal) still
// returns 200 with the fixture value — guards the D2 fix against
// over-correction.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity" }] });
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 check("E2: repos-absent grant + demo-namespace repo → 200",
  r.status === 200 && r.body?.ok === true, J({ status: r.status, body: r.body }));
 check("E2: 200 carries the exact fixture value", r.body?.value === FIXTURE_VALUE, J(r.body?.value));
 check("E2: grant reads the repo (one Artifacts read)", artifactGetCount === 1, `reads=${artifactGetCount}`);
 check("E2: exactly one granted audit record", auditWrites.length === 1, J(auditWrites));
 const rec = JSON.parse(auditWrites[0]?.value ?? "{}");
 check("E2: audit decision is granted", rec.decision === "granted", J(rec));
}

// ---------------------------------------------------------------------------
// F — audit shape (both decisions): parsed JSON has exactly keys
// ["at","decision","identity","key","path","repo"] (sorted compare) —
// no value field, bytes never contain the secret.
// ---------------------------------------------------------------------------
{
 const grantEnv = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 await post(grantEnv, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 const grantRec = JSON.parse(auditWrites[0].value);
 check("F: granted audit has exactly the 6 keys",
  Object.keys(grantRec).sort().join(",") === "at,decision,identity,key,path,repo",
  J(Object.keys(grantRec).sort()));

 const denyEnv = makeEnv({ authMode: "demo" }); // no allowlist
 await post(denyEnv, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
 const denyRec = JSON.parse(auditWrites[0].value);
 check("F: denied audit has exactly the 6 keys",
  Object.keys(denyRec).sort().join(",") === "at,decision,identity,key,path,repo",
  J(Object.keys(denyRec).sort()));
}

// ---------------------------------------------------------------------------
// G — non-secret-class path, authorized ⇒ 400 not-secret-class, no
// value; a granted audit record IS written (authorization event
// happened — Q1: audit at the authorization decision point only).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const r = await post(env, "/reveal", { ...revealBody, path: "src/a.ts" }, { Authorization: "Bearer test-identity" });
 check("G: non-secret-class → 400 not-secret-class",
  r.status === 400 && r.body?.ok === false && r.body?.error === "not-secret-class",
  J({ status: r.status, body: r.body }));
 check("G: non-secret-class → no value", r.text?.includes(FIXTURE_VALUE) === false);
 check("G: granted audit written (authorization happened)", auditWrites.length === 1 && JSON.parse(auditWrites[0].value).decision === "granted", J(auditWrites));
}

// ---------------------------------------------------------------------------
// H — key absent ⇒ 404 key-not-found; missing file ⇒ 404 not-found.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const r1 = await post(env, "/reveal", { ...revealBody, key: "NOPE" }, { Authorization: "Bearer test-identity" });
 check("H: absent key → 404 key-not-found",
  r1.status === 404 && r1.body?.error === "key-not-found", J({ status: r1.status, body: r1.body }));
 // config/.env.missing has basename ".env.missing" (starts with ".env") ⇒
 // secret-class, but the file does not exist ⇒ 404 not-found.
 const r2 = await post(env, "/reveal", { ...revealBody, path: "config/.env.missing" }, { Authorization: "Bearer test-identity" });
 check("H: missing file → 404 not-found",
  r2.status === 404 && r2.body?.error === "not-found", J({ status: r2.status, body: r2.body }));
}

// ---------------------------------------------------------------------------
// I — closed schema: extra field ⇒ 400 bad-request; missing key ⇒ 400
// invalid key; charset-invalid repo ⇒ 400 invalid repo name; ref:".." ⇒ 400 invalid ref.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const r1 = await post(env, "/reveal", { ...revealBody, extra: "x" }, { Authorization: "Bearer test-identity" });
 check("I: extra field → 400 bad-request",
  r1.status === 400 && r1.body?.error === "bad-request", J({ status: r1.status, body: r1.body }));
 const r2 = await post(env, "/reveal", { repo: "agent-5", ref: "main", path: "config/.env" }, { Authorization: "Bearer test-identity" });
 check("I: missing key → 400 invalid key",
  r2.status === 400 && r2.body?.error === "invalid key", J({ status: r2.status, body: r2.body }));
 const r3 = await post(env, "/reveal", { ...revealBody, repo: "bad repo!" }, { Authorization: "Bearer test-identity" });
 check("I: charset-invalid repo → 400 invalid repo name",
  r3.status === 400 && r3.body?.error === "invalid repo name", J({ status: r3.status, body: r3.body }));
 const r4 = await post(env, "/reveal", { ...revealBody, ref: ".." }, { Authorization: "Bearer test-identity" });
 check("I: ref '..' → 400 invalid ref",
  r4.status === 400 && r4.body?.error === "invalid ref", J({ status: r4.status, body: r4.body }));
 check("I: schema 400s write no audit (pre-authorization)", auditWrites.length === 0, J(auditWrites));
}

// ---------------------------------------------------------------------------
// J — no other route leaks: with the authorized env, GET /changes and
// GET /proposals contain the KEY DATABASE_URL but NOT the value string
// (masking law holds).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const changes = await get(env, "/changes?repo=agent-5&base=demo&ref=main&baseRef=main");
 const changesText = J(changes.body);
 check("J: /changes carries the KEY", changesText.includes("DATABASE_URL"), changesText.slice(0, 200));
 check("J: /changes never carries the value", !changesText.includes("FAKE-SECRET-DO-NOT-USE"), changesText.slice(0, 200));
 const proposals = await get(env, "/proposals?base=demo&repos=agent-5");
 const proposalsText = J(proposals.body);
 check("J: /proposals is well-formed (200)", proposals.status === 200, J({ status: proposals.status, body: proposals.body?.error }));
 check("J: /proposals never carries the value", !proposalsText.includes("FAKE-SECRET-DO-NOT-USE"), proposalsText.slice(0, 200));
}

// ---------------------------------------------------------------------------
// K — CSRF: cookie-carrying POST /reveal without x-csrf-token ⇒ 403
// csrf-required (dispatcher gate fires pre-handler).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: [{ id: "test-identity", repos: ["agent-5"] }] });
 const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity", Cookie: "session=x" });
 check("K: cookie POST without csrf token → 403 csrf-required",
  r.status === 403 && r.body?.ok === false && r.body?.error === "csrf-required",
  J({ status: r.status, body: r.body }));
 check("K: csrf-required → zero Artifacts reads", artifactGetCount === 0, `reads=${artifactGetCount}`);
 check("K: csrf-required → zero audit writes", auditWrites.length === 0, J(auditWrites));
}

// ---------------------------------------------------------------------------
// L — malformed allowlist ("not-json{", [{"id":""}]) ⇒ every request
// 403, never a grant.
// ---------------------------------------------------------------------------
{
 for (const [label, allow] of [["garbage string", "not-json{"], ["blank id", [{ id: "" }]]]) {
  const env = makeEnv({ authMode: "demo", revealAllow: allow });
  const r = await post(env, "/reveal", revealBody, { Authorization: "Bearer test-identity" });
  check(`L: malformed allowlist (${label}) → 403`,
   r.status === 403 && r.body?.error === "reveal-not-authorized", J({ status: r.status, body: r.body }));
  check(`L: malformed allowlist (${label}) → no value`, r.text?.includes(FIXTURE_VALUE) === false);
  check(`L: malformed allowlist (${label}) → zero Artifacts reads`, artifactGetCount === 0, `reads=${artifactGetCount}`);
 }
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
