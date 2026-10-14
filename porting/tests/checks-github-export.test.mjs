#!/usr/bin/env bun
// Contract suite: GET /checks?format=github (nextgit-e19-impl-checks-
// github-export) — the GitHub-compatible check-runs export.
// Run: bun porting/tests/checks-github-export.test.mjs   (exit 0 = pass)
//
// Real construction: the real worker through worker.fetch against
// an in-memory Artifacts fake (the checks-api.test.mjs fixture
// surface; no mock.module, no source grep; full-suite-safe, no
// network/Chrome/live worker). Defends the observable contract:
//   1. Mapping per state — the envelope shape, closed conclusion
//      set, per-state mapping over every state the internal shape
//      produces (pass/fail/unknown).
//   2. name = check id — the five ids in order, per proposal.
//   3. summary = the honest detail — output.summary deep-equals the
//      internal shape's detail for the same repo+check (the same
//      datum, never a secret path/key/value).
//   4. Both shapes side-by-side — absent format / format=anythingelse
//      = internal shape; ONLY the literal `github` switches.
//   5. Closed-set conclusions — conclusion is exactly the function of
//      state, cross-checked per (repo, check-id) pair.
//   6. Cache-key law (no poisoning) — one shared cache entry serves
//      both shapes; the projection runs post-cache on hit and miss.
//   7. Preconditions travel — 403 chokepoint (zero Artifacts reads),
//      400, 405, 429 all reachable in the github shape.
//   8. Negative scan — no secret value/key/path, no base-head sha.
//   9. Determinism — two consecutive github bodies deep-equal.
import worker, { ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";
import { CHECK_IDS } from "../../platform/ui/js/checks.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : " — " + detail)); };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the checks-api.test.mjs fixture surface).
// ---------------------------------------------------------------------------

const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

function internBlob(text) {
 if (!blobHashByText.has(text)) {
  const hash = "blob-" + (blobHashByText.size + 1);
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
 const hash = "tree-" + (treeEntries.size + 1);
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
 if (!store) throw new Error("fixture: no repo " + name);
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
   return { remote: "https://artifacts.invalid/nextgit/" + name };
  },
  async revokeToken() {
   return true;
  },
  [Symbol.dispose]() { },
 };
}

const ARTIFACTS = {
 async get(name) {
  return repoFor(name);
 },
};

// Fixture repos (the checks scenario — the same grammar as
// checks-api.test.mjs so the projection is proven over EVERY
// state the internal shape produces):
//   demo          — the baseline (agent-* forked from it)
//   agent-ready   — clean proposal (fold pass, in-sync base)
//   agent-secret  — a secret-class change (withheld-secret fold)
//   agent-collide — collides with agent-elsewhere on src/auth.ts
//   agent-elsewhere — the collision partner (shares src/auth.ts)
//   agent-broken  — an UNRESOLVABLE ref proposal (honesty leg:
//                   history exists but no ref maps to it; all
//                   five checks are unknown)
const SECRET_ENV_TEXT = "# demo env\nAPI_TOKEN=checks_fixture_secret\n";
const A0 = "export const a = 1;\nexport const keep = true;\n";
const A1 = "export const a = 2;\nexport const keep = true;\n";
const AUTH0 = "export const auth = 0;\n";
const AUTH1 = "export const auth = 1;\n";
const AUTH2 = "export const auth = 2;\n";
const ENV0 = "# agent env\nDB_$$443KPBG12PC0:M$$\n";
const BASE_FILES = { "src/a.ts": A0, "src/auth.ts": AUTH0, "config/.env": SECRET_ENV_TEXT };

const cBase = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [cBase], refs: { main: cBase.hash } });

// agent-ready: one clean change on top of the base commit.
const cReady = commit("c-ready", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-ready", { history: [cReady, cBase], refs: { main: cReady.hash } });

// agent-secret: changes a secret-class file (fold is withheld-secret).
const cSecret = commit("c-secret", tree({ ...BASE_FILES, "config/.env": ENV0 }));
defineRepo("agent-secret", { history: [cSecret, cBase], refs: { main: cSecret.hash } });

// agent-collide + agent-elsewhere: both modify src/auth.ts with
// DIFFERENT texts -> a genuine text-conflict in the shared map
// (the conflict map is built over the requested set, so the
// collision surfaces only when the partner is co-requested).
const cCollide = commit("c-collide", tree({ ...BASE_FILES, "src/auth.ts": AUTH1 }));
defineRepo("agent-collide", { history: [cCollide, cBase], refs: { main: cCollide.hash } });
const cElsewhere = commit("c-elsewhere", tree({ ...BASE_FILES, "src/auth.ts": AUTH2 }));
defineRepo("agent-elsewhere", { history: [cElsewhere, cBase], refs: { main: cElsewhere.hash } });

// agent-broken: a repo whose ref does not resolve (the honesty
// leg — computeChangeSet throws, the proposal row is an error row,
// all five checks are unknown).
const cBroken = commit("c-broken", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-broken", { history: [cBroken, cBase], refs: {} });

// ---------------------------------------------------------------------------
// Scripted AI binding + KV fakes.
// ---------------------------------------------------------------------------

const aiCalls = [];
const AI = {
 async run() {
  aiCalls.push(1);
  return { response: "[]", model: "@cf/cloudflare/clef" };
 },
};

function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) { return store.get(key) ?? null; },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
 };
}

function envFor({ artifacts = ARTIFACTS, cache = makeFakeKV() } = {}) {
 return { ARTIFACTS: artifacts, LIVE: makeFakeKV(), CACHE: cache, ASSETS: { fetch: async () => new Response("") }, AI, AUTH_MODE: "demo" };
}

// Artifacts fake that counts get/list calls (proves the 403
// chokepoint fires pre-handler: ZERO Artifacts reads).
const artifactsProbe = {
 calls: 0,
 async get(name) {
  this.calls++;
  return repoFor(name);
 },
 async list() {
  this.calls++;
  return [];
 },
};

let ipSeq = 0;
const nextIp = () => "10.8.1." + ++ipSeq;

const get = async (env, path, query = "", ip = nextIp()) => {
 const res = await worker.fetch(new Request("https://nextgit.invalid" + path + query, { headers: { "CF-Connecting-IP": ip } }), env);
 return { status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") };
};

const post = async (env, path, body = null, ip = nextIp()) => {
 const init = body === null ? { headers: { "CF-Connecting-IP": ip } } : { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) };
 const res = await worker.fetch(new Request("https://nextgit.invalid" + path, init), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

// The full five-repo grammar: every state the internal shape
// produces is exercised (ready pass; collide fail; secret fail;
// broken unknown). agent-elsewhere is co-requested so the
// collision map actually names agent-collide (the map is built
// over the requested set).
const REPOS_PARAM = "agent-ready,agent-secret,agent-collide,agent-elsewhere,agent-broken";
const GITHUB_QUERY = "?base=demo&repos=" + REPOS_PARAM + "&format=github";
const INTERNAL_QUERY = "?base=demo&repos=" + REPOS_PARAM;

// The GitHub check-runs envelope vocabulary (the closed set).
const CONCLUSIONS = new Set(["success", "failure", "neutral"]);

// ---------------------------------------------------------------------------
// 1. MAPPING PER STATE — the envelope shape over every state.
// ---------------------------------------------------------------------------
{
 const r = await get(envFor(), "/checks", GITHUB_QUERY);
 check("1 format=github -> 200 {ok:true, repo, check_runs}",
  r.status === 200 && r.body?.ok === true && r.body?.repo === "demo" && Array.isArray(r.body?.check_runs),
  r.status + " " + J(r.body ?? null).slice(0, 120));
 // 25 check-runs: 5 proposals x 5 checks.
 check("1 one check_run per check per proposal (5x5 = 25)",
  r.body?.check_runs?.length === 25, "len " + String(r.body?.check_runs?.length));
 // Every entry has the closed shape.
 const shapeOk = (r.body?.check_runs ?? []).every((cr) =>
  typeof cr.name === "string" && cr.status === "completed" &&
  CONCLUSIONS.has(cr.conclusion) &&
  cr.output && typeof cr.output.title === "string" && typeof cr.output.summary === "string");
 check("1 every entry {name,status:'completed',conclusion,output:{title,summary}}",
  shapeOk, J((r.body?.check_runs ?? [])[0] ?? null));
 // conclusion is in the CLOSED SET across the whole body — no
 // other value ever appears.
 const closedSet = (r.body?.check_runs ?? []).every((cr) => CONCLUSIONS.has(cr.conclusion));
 check("1 conclusion in the closed set {success,failure,neutral} across the whole body",
  closedSet, J([...new Set((r.body?.check_runs ?? []).map((cr) => cr.conclusion))]));
 // Per-state mapping, per proposal:
 const byRepo = {};
 let i = 0;
 for (const repo of REPOS_PARAM.split(",")) {
  byRepo[repo] = (r.body?.check_runs ?? []).slice(i, i + 5);
  i += 5;
 }
 check("1 agent-ready (all pass) -> all five conclusions success",
  byRepo["agent-ready"]?.every((cr) => cr.conclusion === "success"),
  J(byRepo["agent-ready"]?.map((cr) => cr.conclusion)));
 check("1 agent-collide (fold pass, collision/conflicts fail, secrets/base pass) -> failure where the internal state fails",
  byRepo["agent-collide"]?.[0]?.conclusion === "success" && // fold
  byRepo["agent-collide"]?.[1]?.conclusion === "failure" && // collision
  byRepo["agent-collide"]?.[2]?.conclusion === "failure" && // conflicts
  byRepo["agent-collide"]?.[3]?.conclusion === "success" && // secrets
  byRepo["agent-collide"]?.[4]?.conclusion === "success", // base
  J(byRepo["agent-collide"]?.map((cr) => [cr.name, cr.conclusion])));
 check("1 agent-secret (fold fail, secrets fail, rest pass) -> failure for fold+secrets",
  byRepo["agent-secret"]?.[0]?.conclusion === "failure" && // fold
  byRepo["agent-secret"]?.[3]?.conclusion === "failure" && // secrets
  byRepo["agent-secret"]?.every((cr, idx) => (idx === 0 || idx === 3) ? cr.conclusion === "failure" : cr.conclusion === "success"),
  J(byRepo["agent-secret"]?.map((cr) => [cr.name, cr.conclusion])));
 check("1 agent-broken (all five unknown) -> all five conclusions neutral",
  byRepo["agent-broken"]?.every((cr) => cr.conclusion === "neutral"),
  J(byRepo["agent-broken"]?.map((cr) => cr.conclusion)));
}

// 2. NAME = CHECK ID — the set of name values across one
//    proposal's five entries is exactly the five ids, order
//    preserved as emitted.
{
 const r = await get(envFor(), "/checks", "?base=demo&repos=agent-ready&format=github");
 const names = (r.body?.check_runs ?? []).map((cr) => cr.name);
 check("2 one proposal's five names are exactly fold,collision,conflicts,secrets,base in order",
  J(names) === J(CHECK_IDS), J(names));
}

// 3. SUMMARY = THE HONEST DETAIL — output.summary deep-equals the
//    detail the INTERNAL shape serves for the same repo+check.
//    Proves the projection serializes the SAME datum.
{
 const env = envFor();
 const [internal, github] = await Promise.all([
  get(env, "/checks", INTERNAL_QUERY),
  get(env, "/checks", GITHUB_QUERY),
 ]);
 const byRepo = Object.fromEntries((internal.body?.checks ?? []).map((c) => [c.repo, c.checks]));
 let ok = true;
 const detail = [];
 let i = 0;
 for (const row of internal.body?.checks ?? []) {
  const crs = (github.body?.check_runs ?? []).slice(i, i + row.checks.length);
  i += row.checks.length;
  for (let k = 0; k < row.checks.length; k++) {
   const cr = crs[k];
   const src = row.checks[k];
   if (!cr || cr.output?.summary !== src.detail || cr.output?.title !== src.label || cr.name !== src.id) {
    ok = false;
    detail.push([row.repo, src.id, { summary: cr?.output?.summary, detail: src.detail }]);
   }
  }
 }
 check("3 every output.summary === the internal detail (same datum, same order)", ok, J(detail.slice(0, 3)));
}

// 4. BOTH SHAPES SIDE-BY-SIDE — only the literal `github` switches.
{
 const env = envFor();
 const plain = await get(env, "/checks", INTERNAL_QUERY);
 const github = await get(env, "/checks", GITHUB_QUERY);
 const other = await get(env, "/checks", "?base=demo&repos=" + REPOS_PARAM + "&format=anythingelse");
 check("4 plain GET /checks (no format) -> internal {ok,base,checks} shape",
  plain.status === 200 && plain.body?.ok === true && Array.isArray(plain.body?.checks) && plain.body?.check_runs === undefined,
  J(Object.keys(plain.body ?? {})));
 check("4 format=github -> check_runs shape (no `checks` key)",
  github.status === 200 && Array.isArray(github.body?.check_runs) && github.body?.checks === undefined,
  J(Object.keys(github.body ?? {})));
 check("4 format=anythingelse -> internal shape (only the literal github switches)",
  other.status === 200 && Array.isArray(other.body?.checks) && other.body?.check_runs === undefined,
  J(Object.keys(other.body ?? {})));
}

// 5. CLOSED-SET CONCLUSIONS — conclusion is exactly the function of
//    state, cross-checked per (repo, check-id) pair.
{
 const env = envFor();
 const [internal, github] = await Promise.all([
  get(env, "/checks", INTERNAL_QUERY),
  get(env, "/checks", GITHUB_QUERY),
 ]);
 const EXPECTED = { pass: "success", fail: "failure", unknown: "neutral" };
 let ok = true;
 const bad = [];
 let i = 0;
 for (const row of internal.body?.checks ?? []) {
  const crs = (github.body?.check_runs ?? []).slice(i, i + row.checks.length);
  i += row.checks.length;
  for (let k = 0; k < row.checks.length; k++) {
   const cr = crs[k];
   const src = row.checks[k];
   if (cr?.conclusion !== EXPECTED[src.state]) {
    ok = false;
    bad.push([row.repo, src.id, src.state, cr?.conclusion]);
   }
  }
 }
 check("5 conclusion === {pass:success,fail:failure,unknown:neutral}[state] for every (repo,check) pair",
  ok, J(bad.slice(0, 3)));
}

// 6. CACHE-KEY LAW (no poisoning) — a plain request populates the
//    cache; a format=github request on the same params is correctly
//    projected FROM THE SHARED cache entry (a hit, not a 500, not
//    the raw internal body, not empty check_runs); then a plain
//    request still returns the internal shape.
{
 const cache = makeFakeKV();
 const env = envFor({ cache });
 const first = await get(env, "/checks", INTERNAL_QUERY); // populates the cache
 check("6 plain request populates the cache (miss)", first.status === 200, String(first.status));
 const github = await get(env, "/checks", GITHUB_QUERY); // served from the SAME entry
 check("6 format=github over the shared cache entry -> projected check_runs (a hit, not raw/empty)",
  github.status === 200 && Array.isArray(github.body?.check_runs) && github.body?.check_runs.length === 25 &&
  github.body?.checks === undefined && github.body?.check_runs[0]?.conclusion === "success",
  github.status + " " + J(github.body ?? null).slice(0, 120));
 const plain = await get(env, "/checks", INTERNAL_QUERY); // still the internal shape
 check("6 plain request after the github one still returns the internal shape",
  plain.status === 200 && Array.isArray(plain.body?.checks) && plain.body?.check_runs === undefined,
  J(Object.keys(plain.body ?? {})));
}

// 7. PRECONDITIONS TRAVEL — 403 chokepoint (zero Artifacts reads),
//    400, 405, 429 all reachable in the github shape.
{
 // 7a. ?base=notdemo -> 403 repo-not-allowed with ZERO Artifacts reads.
 artifactsProbe.calls = 0;
 const denyEnv = envFor({ artifacts: artifactsProbe });
 const r = await get(denyEnv, "/checks", "?base=notdemo&format=github");
 check("7a ?base=notdemo&format=github -> 403 repo-not-allowed",
  r.status === 403 && r.body?.ok === false && r.body?.error === "repo-not-allowed", r.status + " " + J(r.body));
 check("7a the 403 fired with ZERO Artifacts reads (chokepoint is pre-handler)",
  artifactsProbe.calls === 0, artifactsProbe.calls + " reads");

 // 7b. ?base= (empty) -> 400.
 const r2 = await get(envFor(), "/checks", "?base=&format=github");
 check("7b ?base=&format=github -> 400", r2.status === 400 && r2.body?.ok === false, r2.status + " " + J(r2.body));

 // 7c. wrong method (POST /checks?format=github) -> 405.
 const r3 = await post(envFor(), "/checks?format=github", {});
 check("7c POST /checks?format=github -> 405 method-not-allowed",
  r3.status === 405 && r3.body?.ok === false && r3.body?.error === "method-not-allowed", r3.status + " " + J(r3.body));

 // 7d. the 61st format=github call on one caller -> 429 (the same
 //     ROUTE_RATE_LIMITS row is reachable in the github shape).
 const ip = "10.8.2.1";
 const statuses = [];
 for (let n = 0; n < 61; n++) {
  const rr = await get(envFor(), "/checks", "?base=demo&repos=agent-ready&format=github", ip);
  statuses.push(rr.status);
 }
 check("7d /checks?format=github first 60 -> 200", statuses.slice(0, 60).every((s) => s === 200), J(statuses));
 check("7d /checks?format=github 61st -> uniform 429", statuses[60] === 429, String(statuses[60]));
 // The same rate row serves both shapes.
 check("7d ROUTE_RATE_LIMITS['/checks'] is the unchanged 60/60s row",
  ROUTE_RATE_LIMITS["/checks"]?.limit === 60 && ROUTE_RATE_LIMITS["/checks"]?.windowMs === 60_000,
  J(ROUTE_RATE_LIMITS["/checks"]));
}

// 8. NEGATIVE SCAN — the github wire body carries no secret
//    value/key/path and no base-head sha (the masking law travels
//    to the projection).
{
 const r = await get(envFor(), "/checks", GITHUB_QUERY);
 const wire = r.text || J(r.body);
 check("8 no secret VALUE leaves the github export",
  !wire.includes("checks_fixture_secret") && !wire.includes("checks_fixture_db_password"), "value scan");
 check("8 no secret KEY NAME leaves the github export",
  !wire.includes("API_TOKEN") && !wire.includes("DB_PASSWORD"), "key scan");
 check("8 no secret-class PATH leaves the github export",
  !wire.includes("config/.env") && !wire.includes(".env"), "path scan");
 // The base-head sha must not egress inside any check entry.
 const internal = await get(envFor(), "/checks", INTERNAL_QUERY);
 const baseHead = internal.body?.base?.head;
 const shaInRuns = (r.body?.check_runs ?? []).some((cr) => J(cr).includes(baseHead));
 check("8 the base-head sha does not egress inside any check_run",
  baseHead !== undefined && !shaInRuns, "baseHead len " + String(baseHead?.length));
}

// 9. DETERMINISM — two consecutive format=github requests over the
//    same fixture deep-equal (byte-identical bodies).
{
 const env = envFor();
 const [a, b] = await Promise.all([
  get(env, "/checks", GITHUB_QUERY),
  get(env, "/checks", GITHUB_QUERY),
 ]);
 check("9 two consecutive format=github bodies are byte-identical",
  a.status === 200 && b.status === 200 && J(a.body) === J(b.body), "differs");
}

// Sanity: the route count is UNCHANGED by this export (the
// projection rides the existing /checks registration).
check("route count unchanged (the export adds no route)", ROUTES.length === 26, "ROUTES.length " + ROUTES.length);

console.log(fail === 0 ? `ALL PASS(${pass} checks)` : `${fail} FAILURES(${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
