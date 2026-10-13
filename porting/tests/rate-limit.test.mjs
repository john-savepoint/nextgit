#!/usr/bin/env bun
// Contract suite: FR-45 / AD-9 — edge rate limits on /land, /merge,
// /proposals, /judge via the shared in-isolate limiter (platform/src/rate.ts).
// Run: bun porting/tests/rate-limit.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts,
// ROUTES from the same, and rateAllow/ROUTE_RATE_LIMITS from
// platform/src/rate.ts; drives worker.fetch() with an in-memory Artifacts
// fake (the judge.test.mjs fixture pattern) and a scripted AI binding.
// No module mocks, no source grep — the limiter is exercised end-to-end
// through the real dispatcher.
//
// Unique caller keys per check (rl-<route>-<random>) so the per-isolate
// limiter state from one check never bleeds into another. Offline
// sections 1-2 always run; section 3 (live burst) runs only when
// NEXTGIT_PLATFORM is set (the repo's established live-gated pattern).

import worker, { ROUTES } from "../../platform/src/index.ts";
import { rateAllow, ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);
const RATE_LIMITED = { ok: false, error: "rate-limited" };
const uniqueKey = (route) => `rl-${route}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the judge.test.mjs fixture surface).
// ---------------------------------------------------------------------------

const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

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

const ARTIFACTS = {
 async get(name) {
  return repoFor(name);
 },
};

// Fixture repos: demo base + one agent proposal (the minimal set every
// route here needs). agent-1 changes src/a.ts; demo carries a secret-class
// config/.env so masking stays exercised on the read paths.
const SECRET_ENV_TEXT = `# demo env\nAPI_TOKEN=judge_fixture_secret\n`;
const A0 = "export const a = 1;\nexport const keep = true;\n";
const A1 = "export const a = 2;\nexport const keep = true;\n";
const B0 = "export const b = 1;\n";
const BASE_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": SECRET_ENV_TEXT };

const c1 = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

const a1 = commit("c-agent-1", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash }, intents: { [a1.hash]: "Bump the a module for the demo." } });

// ---------------------------------------------------------------------------
// Scripted AI binding + KV fakes.
// ---------------------------------------------------------------------------

const aiCalls = [];
const AI = {
 async run(model, inputs) {
  aiCalls.push({ model, inputs });
  // Minimal valid Clef reply for a single judged repo: risk + intent +
  // content_secret answer the three card signals.
  return {
   model: "clef",
   answers: {
    risk_1: { type: "score", score: 1.2, confidence: 0.5 },
    intent_1: { type: "choice", choice: "supports" },
    overclaim_1: { type: "noul", noul: 0.2 },
    content_secret_1: { type: "noul", noul: 0.1 },
   },
   usage: { neurons: 1 },
  };
 },
};

function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) {
   return store.get(key) ?? null;
  },
  async put(key, value) {
   store.set(key, value);
  },
 };
}

function envFor({ artifacts = ARTIFACTS, cache = makeFakeKV() } = {}) {
 return { ARTIFACTS: artifacts, LIVE: makeFakeKV(), CACHE: cache, ASSETS: { fetch: async () => new Response("") }, AI, AUTH_MODE: "demo" };
}

// Artifacts fake that counts get/list calls (proves "no landing attempt" —
// nothing reached a repo read on a rate-limited /land burst).
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
const nextIp = () => `10.8.0.${++ipSeq}`;

const get = async (env, path, query = "", ip = nextIp()) => {
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}${query}`, { headers: { "CF-Connecting-IP": ip } }), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

const post = async (env, path, body = null, ip = nextIp()) => {
 const init = body === null ? { headers: { "CF-Connecting-IP": ip } } : { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) };
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// 1. Offline limiter semantics (real rate.ts).
// ---------------------------------------------------------------------------

// Per-route cap boundary: first `limit` allowed, `limit+1` denied, read
// dynamically from ROUTE_RATE_LIMITS (the repo's established pattern).
for (const [route, { limit, windowMs }] of Object.entries(ROUTE_RATE_LIMITS)) {
 const key = uniqueKey(route);
 let allowed = 0;
 for (let i = 0; i < limit; i++) if (rateAllow(route, key)) allowed++;
 const denied = rateAllow(route, key);
 check(`1 ${route} cap boundary (${limit})`, allowed === limit && denied === false, `${allowed} allowed, denied=${denied}`);
 // Window rollover via the `now` parameter (deterministic, no sleeping).
 check(`1 ${route} window rollover`, rateAllow(route, key, Date.now() + windowMs + 1) === true);
}

// Per-caller isolation: caller B allowed while A is blocked.
{
 const a = uniqueKey("iso-a"), b = uniqueKey("iso-b");
 for (let i = 0; i < ROUTE_RATE_LIMITS["/land"].limit; i++) rateAllow("/land", a);
 const aBlocked = rateAllow("/land", a) === false;
 const bAllowed = rateAllow("/land", b) === true;
 check("1 per-caller isolation (B allowed while A blocked)", aBlocked && bAllowed, `aBlocked=${aBlocked} bAllowed=${bAllowed}`);
}

// Route isolation: exhausting /land leaves /judge allowed for the same caller.
{
 const key = uniqueKey("route-iso");
 for (let i = 0; i < ROUTE_RATE_LIMITS["/land"].limit; i++) rateAllow("/land", key);
 const landBlocked = rateAllow("/land", key) === false;
 const judgeAllowed = rateAllow("/judge", key) === true;
 check("1 route isolation (/judge allowed after /land exhausted)", landBlocked && judgeAllowed, `landBlocked=${landBlocked} judgeAllowed=${judgeAllowed}`);
}

// Unbound-route fail-open (/changes is not a bound route).
{
 const key = uniqueKey("unbound");
 let allAllowed = true;
 for (let i = 0; i < 1000; i++) if (!rateAllow("/changes", key)) allAllowed = false;
 check("1 unbound-route fail-open (/changes always allowed)", allAllowed);
}

// Key-space eviction: 600 distinct keys on one route does not throw and
// still enforces the cap (the sweep fires when a route's map > 500).
{
 let threw = false;
 let capStillEnforced = true;
 try {
  for (let i = 0; i < 600; i++) rateAllow("/land", `rl-evict-${i}`);
  const probe = uniqueKey("evict-probe");
  for (let i = 0; i < ROUTE_RATE_LIMITS["/land"].limit; i++) rateAllow("/land", probe);
  if (rateAllow("/land", probe) !== false) capStillEnforced = false;
 } catch (e) {
  threw = true;
 }
 check("1 key-space eviction (600 keys, no throw, cap holds)", !threw && capStillEnforced, `threw=${threw} capStillEnforced=${capStillEnforced}`);
}

// ---------------------------------------------------------------------------
// 2. Route-table binding through the real dispatcher.
// ---------------------------------------------------------------------------

// The acceptance's "route-table binding asserted": ROUTES carries the four
// entries with the expected method/action (real imported array, not a grep).
{
 const routeMap = Object.fromEntries(ROUTES.map((r) => [r.path, r]));
 check("2 ROUTES /land POST write", routeMap["/land"]?.method === "POST" && routeMap["/land"]?.action === "write", J(routeMap["/land"]));
 check("2 ROUTES /merge GET read", routeMap["/merge"]?.method === "GET" && routeMap["/merge"]?.action === "read", J(routeMap["/merge"]));
 check("2 ROUTES /proposals GET read", routeMap["/proposals"]?.method === "GET" && routeMap["/proposals"]?.action === "read", J(routeMap["/proposals"]));
 check("2 ROUTES /judge POST judge", routeMap["/judge"]?.method === "POST" && routeMap["/judge"]?.action === "judge", J(routeMap["/judge"]));
}

const env = envFor();

// --- /land: 21 POSTs, one caller, NON-allowlisted repo (the pinned live-
// acceptance shape). First 20 -> 403 repo-not-allowed, 21st -> uniform 429,
// zero 200s; the Artifacts fake counts get/list and asserts 0 (proves no
// landing attempt — nothing reached a repo read).
{
 const probeEnv = envFor({ artifacts: artifactsProbe });
 artifactsProbe.calls = 0;
 const ip = `10.9.0.1`;
 const statuses = [];
 let lastBody = null;
 for (let i = 0; i < 21; i++) {
  const r = await post(probeEnv, "/land", { base: "notdemo-xyz", repos: ["notdemo-xyz"], ref: "main", baseRef: "main" }, ip);
  statuses.push(r.status);
  lastBody = r.body;
 }
 const non403 = statuses.filter((s) => s !== 403).length;
 const firstTwenty403 = statuses.slice(0, 20).every((s) => s === 403);
 const twentyFirst = statuses[20];
 check("2 /land first 20 -> 403 repo-not-allowed", firstTwenty403 && non403 === 1, J(statuses));
 check("2 /land 21st -> uniform 429", twentyFirst === 429 && JSON.stringify(lastBody) === J(RATE_LIMITED), `${twentyFirst} ${J(lastBody)}`);
 check("2 /land burst: zero 200s (no landing attempt)", !statuses.includes(200), J(statuses));
 check("2 /land burst: zero Artifacts reads", artifactsProbe.calls === 0, `${artifactsProbe.calls} reads`);
}

// --- /judge: 31 POSTs, allowlisted repos, scripted AI: first 30 -> 200
// envelope, 31st -> uniform 429; a different caller still 200 while the
// first is blocked.
{
 const ip = `10.9.0.2`;
 const statuses = [];
 let lastBody = null;
 for (let i = 0; i < 31; i++) {
  const r = await post(env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, ip);
  statuses.push(r.status);
  lastBody = r.body;
 }
 const firstThirty200 = statuses.slice(0, 30).every((s) => s === 200);
 const thirtyFirst = statuses[30];
 check("2 /judge first 30 -> 200 envelope", firstThirty200, J(statuses));
 check("2 /judge 31st -> uniform 429", thirtyFirst === 429 && JSON.stringify(lastBody) === J(RATE_LIMITED), `${thirtyFirst} ${J(lastBody)}`);
 const differentCaller = await post(env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, `10.9.0.3`);
 check("2 /judge different caller still 200 while first blocked", differentCaller.status === 200 && differentCaller.body?.ok === true, `${differentCaller.status} ${J(differentCaller.body)}`);
}

// --- /merge: first 60 -> 200 {ok:true, merge:{...}} (real fold against the
// fixture), 61st -> uniform 429; different caller still 200.
{
 const ip = `10.9.0.4`;
 const statuses = [];
 let capBody = null;
 for (let i = 0; i < 61; i++) {
  const r = await get(env, "/merge", "?base=demo&repos=agent-1", ip);
  statuses.push(r.status);
  if (i === ROUTE_RATE_LIMITS["/merge"].limit - 1) capBody = r.body;
 }
 const firstSixty200 = statuses.slice(0, 60).every((s) => s === 200);
 const sixtyFirst = statuses[60];
 check("2 /merge first 60 -> 200", firstSixty200, J(statuses));
 check("2 /merge cap-th (60th) normal 200 shape", capBody?.ok === true && capBody?.merge?.status !== undefined, J(capBody));
 check("2 /merge 61st -> uniform 429", sixtyFirst === 429, `${sixtyFirst}`);
 const differentCaller = await get(env, "/merge", "?base=demo&repos=agent-1", `10.9.0.5`);
 check("2 /merge different caller still 200", differentCaller.status === 200 && differentCaller.body?.ok === true, `${differentCaller.status} ${J(differentCaller.body)}`);
}

// --- /proposals: first 60 -> 200 {ok:true, base, proposals, conflicts,
// summary}, 61st -> uniform 429; different caller still 200.
{
 const ip = `10.9.0.6`;
 const statuses = [];
 let capBody = null;
 for (let i = 0; i < 61; i++) {
  const r = await get(env, "/proposals", "?base=demo&repos=agent-1", ip);
  statuses.push(r.status);
  if (i === ROUTE_RATE_LIMITS["/proposals"].limit - 1) capBody = r.body;
 }
 const firstSixty200 = statuses.slice(0, 60).every((s) => s === 200);
 const sixtyFirst = statuses[60];
 check("2 /proposals first 60 -> 200", firstSixty200, J(statuses));
 check("2 /proposals cap-th (60th) normal 200 shape", capBody?.ok === true && Array.isArray(capBody?.proposals), J(capBody));
 check("2 /proposals 61st -> uniform 429", sixtyFirst === 429, `${sixtyFirst}`);
 const differentCaller = await get(env, "/proposals", "?base=demo&repos=agent-1", `10.9.0.7`);
 check("2 /proposals different caller still 200", differentCaller.status === 200 && differentCaller.body?.ok === true, `${differentCaller.status} ${J(differentCaller.body)}`);
}

// --- /checks: first 60 -> 200 {ok:true, base, checks:[...]},
// 61st -> uniform 429 (the new ROUTE_RATE_LIMITS row is
// reachable — the intents-matcher rate leg); different caller
// still 200.
{
 const ip = `10.9.0.8`;
 const statuses = [];
 let capBody = null;
 for (let i = 0; i < 61; i++) {
  const r = await get(env, "/checks", "?base=demo&repos=agent-1", ip);
  statuses.push(r.status);
  if (i === ROUTE_RATE_LIMITS["/checks"].limit - 1) capBody = r.body;
 }
 const firstSixty200 = statuses.slice(0, 60).every((s) => s === 200);
 const sixtyFirst = statuses[60];
 check("2 /checks first 60 -> 200", firstSixty200, J(statuses));
 check("2 /checks cap-th (60th) normal 200 shape", capBody?.ok === true && Array.isArray(capBody?.checks), J(capBody));
 check("2 /checks 61st -> uniform 429", sixtyFirst === 429, `${sixtyFirst}`);
 const differentCaller = await get(env, "/checks", "?base=demo&repos=agent-1", `10.9.0.9`);
 check("2 /checks different caller still 200", differentCaller.status === 200 && differentCaller.body?.ok === true, `${differentCaller.status} ${J(differentCaller.body)}`);
}

// --- caller-key fallback: a burst with NO CF-Connecting-IP header shares
// one "unknown" budget -> 429 at cap+1 (pins the ?? "unknown" law).
{
 // Fresh env so the "unknown" budget is not pre-warmed by earlier checks.
 const freshEnv = envFor();
 const noIpGet = async (path, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}${query}`), freshEnv);
  return { status: res.status, body: await res.json().catch(() => null) };
 };
 const statuses = [];
 for (let i = 0; i < 61; i++) {
  const r = await noIpGet("/merge", "?base=demo&repos=agent-1");
  statuses.push(r.status);
 }
 const unknownShared = statuses.slice(0, 60).every((s) => s === 200) && statuses[60] === 429;
 check("2 caller-key fallback (no CF-Connecting-IP -> shared unknown budget)", unknownShared, J(statuses));
}

// --- uniform body: every observed 429 across all four routes deep-equals
// {ok:false,error:"rate-limited"}. (Re-asserted per route above; one
// aggregate check pins the law once more from the collected bodies.)
{
 const bodies = [];
 const collect = async (path, method, body, ip) => {
  const r = method === "GET"
   ? await get(env, path, body, ip)
   : await post(env, path, body, ip);
  if (r.status === 429) bodies.push(r.body);
  return r;
 };
 // Exhaust each route on a fresh caller to collect one 429 body per route.
 const k1 = uniqueKey("ub-land"), k2 = uniqueKey("ub-judge");
 const k3 = uniqueKey("ub-merge"), k4 = uniqueKey("ub-proposals");
 for (let i = 0; i < ROUTE_RATE_LIMITS["/land"].limit + 1; i++) await collect("/land", "POST", { base: "notdemo-xyz", repos: ["notdemo-xyz"], ref: "main", baseRef: "main" }, `10.9.1.1`);
 for (let i = 0; i < ROUTE_RATE_LIMITS["/judge"].limit + 1; i++) await collect("/judge", "POST", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, `10.9.1.2`);
 for (let i = 0; i < ROUTE_RATE_LIMITS["/merge"].limit + 1; i++) await collect("/merge", "GET", "?base=demo&repos=agent-1", `10.9.1.3`);
 for (let i = 0; i < ROUTE_RATE_LIMITS["/proposals"].limit + 1; i++) await collect("/proposals", "GET", "?base=demo&repos=agent-1", `10.9.1.4`);
 check("2 uniform 429 body across all four routes", bodies.length === 4 && bodies.every((b) => JSON.stringify(b) === J(RATE_LIMITED)), `${bodies.length} bodies: ${J(bodies)}`);
}

// ---------------------------------------------------------------------------
// 3. Live burst (gated on NEXTGIT_PLATFORM — the repo's established
// live-gated pattern, e.g. one-set-one-response.test.mjs). 21 POST /land
// with a non-allowlisted repo against the deployed worker -> >=1 429,
// every status in {403, 429}, no 200; GET /merge + GET /proposals remain
// 200 under cap.
// ---------------------------------------------------------------------------

if (process.env.NEXTGIT_PLATFORM) {
 try {
  const base = process.env.NEXTGIT_PLATFORM.replace(/\/$/, "");
  const liveIp = `10.99.0.${++ipSeq}`;
  const statuses = [];
  for (let i = 0; i < 21; i++) {
   const res = await fetch(`${base}/land`, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": liveIp },
    body: JSON.stringify({ base: "notdemo-xyz", repos: ["notdemo-xyz"], ref: "main", baseRef: "main" }),
   });
   statuses.push(res.status);
   await res.text();
  }
  check("3 live /land burst >=1 429", statuses.includes(429), J(statuses));
  check("3 live /land burst all in {403,429}", statuses.every((s) => s === 403 || s === 429), J(statuses));
  check("3 live /land burst no 200", !statuses.includes(200), J(statuses));

  const merge = await fetch(`${base}/merge?base=demo&repos=agent-1`, { headers: { "CF-Connecting-IP": liveIp } });
  const mergeBody = await merge.json().catch(() => null);
  check("3 live /merge 200 under cap", merge.status === 200 && mergeBody?.ok === true, `${merge.status} ${J(mergeBody)}`);

  const proposals = await fetch(`${base}/proposals?base=demo&repos=agent-1`, { headers: { "CF-Connecting-IP": liveIp } });
  const proposalsBody = await proposals.json().catch(() => null);
  check("3 live /proposals 200 under cap", proposals.status === 200 && proposalsBody?.ok === true, `${proposals.status} ${J(proposalsBody)}`);
 } catch (e) {
  check("3 live burst case threw", false, String(e?.stack ?? e));
 }
} else {
 console.log("SKIP  section 3 (live burst) — NEXTGIT_PLATFORM not set");
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
