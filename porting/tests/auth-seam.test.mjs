#!/usr/bin/env bun
// Contract suite: FR-45 / AD-9 — authorize() chokepoint with AUTH_MODE default-deny.
// Run: bun porting/tests/auth-seam.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts and
// drives worker.fetch() with an in-memory fake env. ARTIFACTS.get throws to prove
// no pre-authorize binding read happens on denials. No module mocks, no source
// grep — the chokepoint is exercised end-to-end through the real dispatcher.

import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// Shared in-memory fake: ARTIFACTS.get throws to prove the deny path returns 401
// BEFORE any repo read. LIVE.get is undefined (real KV would have a value) so we
// catch if deny fails to short-circuit the cache key path.
function makeEnv(authMode) {
 const ARTIFACTS = { get: async () => { throw new Error("should not be reached — authorize must reject before any repo read"); }, list: async () => { throw new Error("should not be reached"); } };
 const env = { ARTIFACTS, LIVE: { get: async () => undefined }, CACHE: { get: async () => undefined, put: async () => { } }, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: authMode };
 return env;
}

// ---------------------------------------------------------------------------
const get = async (env, path, query = "") => {
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}${query}`), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

const post = async (env, path, body = null) => {
 const init = body === null ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};
// ---------------------------------------------------------------------------

const denyEnv = makeEnv(undefined);

// /health
{
 const r = await get(denyEnv, "/health");
 check("A: GET /health → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /changes
{
 const r = await get(denyEnv, "/changes", "?repo=agent-1");
 check("A: GET /changes → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /proposals
{
 const r = await get(denyEnv, "/proposals");
 check("A: GET /proposals → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /merge
{
 const r = await get(denyEnv, "/merge", "?repos=agent-1");
 check("A: GET /merge → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /land
{
 const r = await post(denyEnv, "/land", { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
 check("A: POST /land → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /judge
{
 const r = await post(denyEnv, "/judge", { setId: "v1", target: { base: "demo", ref: "main", repos: ["agent-1"] } });
 check("A: POST /judge → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /events
{
 const r = await get(denyEnv, "/events");
 check("A: GET /events → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// /landings/{commit}
{
 const r = await get(denyEnv, "/landings/", "0123456789abcdef0123456789abcdef01234567");
 check("A: GET /landings/{sha} → 401 unauthorized", r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// Also test AUTH_MODE = "deny" explicitly and AUTH_MODE = "garbage"
{
 const denyEnv2 = makeEnv("deny");
 const r = await get(denyEnv2, "/health");
 check("A: AUTH_MODE='deny' → 401", r.status === 401 && r.body?.error === "unauthorized", `got ${r.status}`);

 const denyEnv3 = makeEnv("garbage");
 const r2 = await get(denyEnv3, "/health");
 check("A: AUTH_MODE='garbage' → 401 (any non-demo ⇒ deny)", r2.status === 401 && r2.body?.error === "unauthorized", `got ${r2.status}`);
}

// ---------------------------------------------------------------------------
// Group B — demo mode (AUTH_MODE="demo"): current demo behavior preserved.
// Routes run (not 401); /health returns 200; /changes runs (200 or 400, never
// 401). ARTIFACTS.get throws but demo routes that don't resolve repos (like
// /health) should return 200 regardless.
// ---------------------------------------------------------------------------

const demoEnv = makeEnv("demo");

// /health — should return 200 (no repo read needed)
{
 const r = await get(demoEnv, "/health");
 check("B: GET /health → 200 health (demo)", r.status === 200 && r.body?.ok === true && r.body?.service === "nextgit-platform", `got ${r.status} ${J(r.body)}`);
}

// /events — should return 200 (uses LIVE.get, which is {} so returns ok:true events:[])
{
 const r = await get(demoEnv, "/events");
 check("B: GET /events → 200 (demo, not 401)", r.status === 200 && r.body?.ok === true && Array.isArray(r.body?.events), `got ${r.status} ${J(r.body)}`);
}

// /changes — should route to handler, which tries to resolve the repo (ARTIFACTS.get
// throws). The handler itself will 500 (artifacts error) — but NOT 401.
// This proves demo mode passes authorize() and reaches the handler.
{
 const r = await get(demoEnv, "/changes", "?repo=agent-1");
 check("B: GET /changes → not 401 (demo, handler reached)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
 // The handler will hit the ARTIFACTS.get throw → 500, proving it got past authorize
 check("B: GET /changes → 500 from handler (past authorize)", r.status === 500, `got ${r.status} ${J(r.body)}`);
}

// /proposals — same: not 401, reaches computeProposals which calls ARTIFACTS.list
// We make ARTIFACTS.list throw too so the handler 500s (but not 401)
{
 const env = makeEnv("demo");
 // ARTIFACTS.get already throws; computeProposals calls env.ARTIFACTS.list
 // which is undefined → will error → 500
 const r = await get(env, "/proposals");
 check("B: GET /proposals → not 401 (demo)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
}

// /merge — same: not 401, reaches handler
{
 const r = await get(demoEnv, "/merge", "?repos=agent-1");
 check("B: GET /merge → not 401 (demo)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
}

// /land — not 401, reaches handler (will fail on repo head resolution via ARTIFACTS.get)
{
 const r = await post(demoEnv, "/land", { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
 check("B: POST /land → not 401 (demo)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
}

// /judge — not 401, reaches handler
{
 const r = await post(demoEnv, "/judge", { setId: "v1", target: { base: "demo", ref: "main", repos: ["agent-1"] } });
 check("B: POST /judge → not 401 (demo)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
}

// /landings/{commit} — not 401, reaches handler (CACHE.get returns null → 404)
{
 const r = await get(demoEnv, "/landings/", "0123456789abcdef0123456789abcdef01234567");
 check("B: GET /landings/{sha} → not 401 (demo)", r.status !== 401, `got ${r.status} ${J(r.body)}`);
 // CACHE.get is {} so .get() is undefined → will error or return null
 // The handler calls env.CACHE.get — since CACHE is {} it throws → 500
 // But the key point is it's NOT 401
}

// ---------------------------------------------------------------------------
// Group C — route table structure: ROUTES + DYNAMIC_ROUTES exported and correct.
// ---------------------------------------------------------------------------

check("C: ROUTES is array", Array.isArray(ROUTES), `typeof ${typeof ROUTES}`);
check("C: ROUTES has 7 entries", ROUTES.length === 7, `got ${ROUTES?.length}`);

const validActions = new Set(["read", "write", "judge", "reveal"]);
let allActionsValid = true;
let routeMap = {};
for (const route of ROUTES) {
 if (!(route.path && route.method && route.action && typeof route.handler === "function")) {
  allActionsValid = false;
  break;
 }
 if (!validActions.has(route.action)) {
  allActionsValid = false;
  break;
 }
 routeMap[route.path] = route;
}
check("C: every ROUTES entry has path|method|action|handler, action ∈ valid set", allActionsValid);

check("C: /health → GET read", routeMap["/health"]?.method === "GET" && routeMap["/health"]?.action === "read");
check("C: /changes → GET read", routeMap["/changes"]?.method === "GET" && routeMap["/changes"]?.action === "read");
check("C: /proposals → GET read", routeMap["/proposals"]?.method === "GET" && routeMap["/proposals"]?.action === "read");
check("C: /merge → GET read", routeMap["/merge"]?.method === "GET" && routeMap["/merge"]?.action === "read");
check("C: /land → POST write", routeMap["/land"]?.method === "POST" && routeMap["/land"]?.action === "write");
check("C: /judge → POST judge", routeMap["/judge"]?.method === "POST" && routeMap["/judge"]?.action === "judge");
check("C: /events → GET read", routeMap["/events"]?.method === "GET" && routeMap["/events"]?.action === "read");

check("C: DYNAMIC_ROUTES is array", Array.isArray(DYNAMIC_ROUTES), `typeof ${typeof DYNAMIC_ROUTES}`);
check("C: DYNAMIC_ROUTES has 1 entry", DYNAMIC_ROUTES.length === 1, `got ${DYNAMIC_ROUTES?.length}`);
check("C: DYNAMIC_ROUTES /landings/ → GET read",
 DYNAMIC_ROUTES[0]?.prefix === "/landings/" && DYNAMIC_ROUTES[0]?.method === "GET" && DYNAMIC_ROUTES[0]?.action === "read",
 `got ${J(DYNAMIC_ROUTES[0])}`);

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
