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
check("C: ROUTES has 23 entries (base 9 + GET /floors, POST /upstream, POST /intents, GET /whoami, GET /tree, GET /file, GET /commits, GET /forks, GET /comments, POST /comments, GET /issues, GET /checks, GET /sessions, GET /agents)", ROUTES.length === 23, `got ${ROUTES?.length}`);
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
check("C: /floors → GET read", routeMap["/floors"]?.method === "GET" && routeMap["/floors"]?.action === "read");
check("C: /forks → GET read", routeMap["/forks"]?.method === "GET" && routeMap["/forks"]?.action === "read", `got ${J(routeMap["/forks"] ? { method: routeMap["/forks"].method, action: routeMap["/forks"].action } : null)}`);
check("C: /agents → GET read", routeMap["/agents"]?.method === "GET" && routeMap["/agents"]?.action === "read", `got ${J(routeMap["/agents"] ? { method: routeMap["/agents"].method, action: routeMap["/agents"].action } : null)}`);
check("C: /merge → GET read", routeMap["/merge"]?.method === "GET" && routeMap["/merge"]?.action === "read");
check("C: /land → POST write", routeMap["/land"]?.method === "POST" && routeMap["/land"]?.action === "write");
check("C: /judge → POST judge", routeMap["/judge"]?.method === "POST" && routeMap["/judge"]?.action === "judge");
check("C: /intents → POST judge (authorize-covered)", routeMap["/intents"]?.method === "POST" && routeMap["/intents"]?.action === "judge", `got ${J(routeMap["/intents"] ? { method: routeMap["/intents"].method, action: routeMap["/intents"].action } : null)}`);
check("C: /reveal → POST reveal (authorize-covered)", routeMap["/reveal"]?.method === "POST" && routeMap["/reveal"]?.action === "reveal", `got ${J(routeMap["/reveal"] ? { method: routeMap["/reveal"].method, action: routeMap["/reveal"].action } : null)}`);
check("C: /events → GET read", routeMap["/events"]?.method === "GET" && routeMap["/events"]?.action === "read");
// /events/stream MUST be tabled: while it lived in an inline branch it bypassed authorize()
// (deny mode still streamed). Pinned 2026-10-10.
check("C: /events/stream → GET read (authorize-covered)", routeMap["/events/stream"]?.method === "GET" && routeMap["/events/stream"]?.action === "read", `got ${J(routeMap["/events/stream"] ? { method: routeMap["/events/stream"].method, action: routeMap["/events/stream"].action } : null)}`);
check("C: /commits → GET read (authorize-covered; the read API's history half)", routeMap["/commits"]?.method === "GET" && routeMap["/commits"]?.action === "read", `got ${J(routeMap["/commits"] ? { method: routeMap["/commits"].method, action: routeMap["/commits"].action } : null)}`);
// /comments is registered for BOTH verbs (the review-comment data plane);
// routeMap keys by path so it cannot pin both — find each entry explicitly.
check("C: /comments → GET read (authorize-covered)", ROUTES.some((r) => r.path === "/comments" && r.method === "GET" && r.action === "read"));
check("C: /comments → POST write (authorize + csrf-covered)", ROUTES.some((r) => r.path === "/comments" && r.method === "POST" && r.action === "write"));
check("C: /checks → GET read (authorize-covered; the authoritative server-computed checks route)", ROUTES.some((r) => r.path === "/checks" && r.method === "GET" && r.action === "read"));
// GET /sessions (nextgit-e16) — the session list read;
// the authorize() chokepoint covers it (extractScope
// adjudicates the query-carried base pre-read, the
// /forks posture).
check("C: /sessions → GET read (authorize-covered)", routeMap["/sessions"]?.method === "GET" && routeMap["/sessions"]?.action === "read", `got ${J(routeMap["/sessions"] ? { method: routeMap["/sessions"].method, action: routeMap["/sessions"].action } : null)}`);

check("C: DYNAMIC_ROUTES is array", Array.isArray(DYNAMIC_ROUTES), `typeof ${typeof DYNAMIC_ROUTES}`);
check("C: DYNAMIC_ROUTES has 5 entries (landings, proposals, asset, raw, sessions)", DYNAMIC_ROUTES.length === 5, `got ${DYNAMIC_ROUTES?.length}`);
check("C: DYNAMIC_ROUTES /landings/ → GET read",
 DYNAMIC_ROUTES[0]?.prefix === "/landings/" && DYNAMIC_ROUTES[0]?.method === "GET" && DYNAMIC_ROUTES[0]?.action === "read",
 `got ${J(DYNAMIC_ROUTES[0])}`);
check("C: DYNAMIC_ROUTES /proposals/ → GET read",
 DYNAMIC_ROUTES[1]?.prefix === "/proposals/" && DYNAMIC_ROUTES[1]?.method === "GET" && DYNAMIC_ROUTES[1]?.action === "read",
 `got ${J(DYNAMIC_ROUTES[1])}`);
check("C: DYNAMIC_ROUTES /asset/ → GET read (the e12 asset download route)",
 DYNAMIC_ROUTES[2]?.prefix === "/asset/" && DYNAMIC_ROUTES[2]?.method === "GET" && DYNAMIC_ROUTES[2]?.action === "read",
 `got ${J(DYNAMIC_ROUTES[2])}`);
check("C: DYNAMIC_ROUTES /raw/ → GET read (the repo-browsing raw-byte read; authorize-covered, the handler re-checks the path-carried repo)",
 DYNAMIC_ROUTES[3]?.prefix === "/raw/" && DYNAMIC_ROUTES[3]?.method === "GET" && DYNAMIC_ROUTES[3]?.action === "read",
 `got ${J(DYNAMIC_ROUTES[3])}`);
// /sessions/ (nextgit-e16) — the FIRST dynamic POST
// route: the session-steering write. The dispatcher's
// dynamic branch applies authorize() + csrfGate() to
// POSTs (no dispatcher change needed); the handler
// re-checks the path-carried repo against the demo
// allowlist (the /raw carve-out posture).
check("C: DYNAMIC_ROUTES /sessions/ → POST write (the first dynamic POST; authorize + csrf-covered, the handler re-checks the path-carried repo)",
 DYNAMIC_ROUTES[4]?.prefix === "/sessions/" && DYNAMIC_ROUTES[4]?.method === "POST" && DYNAMIC_ROUTES[4]?.action === "write",
 `got ${J(DYNAMIC_ROUTES[4])}`);
// The static-POST set is UNCHANGED by the steer POST:
// /sessions/steer is dynamic (prefix "/sessions/"), not
// a static ROUTES entry — the exact-POST-paths set
// stays {/land, /upstream, /judge, /intents, /reveal, /comments}.
check("C: static POST paths unchanged (the steer POST is dynamic, not static)",
 JSON.stringify(ROUTES.filter((r) => r.method === "POST").map((r) => r.path).sort()) ===
 JSON.stringify(["/comments", "/intents", "/judge", "/land", "/reveal", "/upstream"].sort()));
// DYNAMIC_ROUTES now carries exactly one POST (the steer).
check("C: DYNAMIC_ROUTES carries exactly one POST at /sessions/",
 DYNAMIC_ROUTES.filter((r) => r.method === "POST").length === 1 &&
 DYNAMIC_ROUTES.filter((r) => r.method === "POST")[0]?.prefix === "/sessions/");

// ---------------------------------------------------------------------------
// Group D — demo mode (AUTH_MODE="demo"): the demo repo allowlist is
// enforced at the authorize() chokepoint on EVERY route (FR-45 / AD-9).
// demoAllowEnv's Artifacts get/list throw "should not be reached": a 403
// that fails to fire surfaces as 500 (handler reached the binding), never
// as a silent pass. The allowlist fires BEFORE any env.ARTIFACTS read.
// ---------------------------------------------------------------------------

const demoAllowEnv = makeEnv("demo");

const DENY403 = (r, name) =>
 r.status === 403 &&
 r.body?.ok === false &&
 r.body?.error === "repo-not-allowed" &&
 r.body?.detail === `repo "${name}" is outside the demo allowlist`;

// /changes?repo=notdemo-xyz → 403, zero Artifacts reads
{
 const r = await get(demoAllowEnv, "/changes", "?repo=notdemo-xyz");
 check("D: GET /changes?repo=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
}

// /changes?repo=agent-1&base=notdemo-base → 403 names the base
{
 const r = await get(demoAllowEnv, "/changes", "?repo=agent-1&base=notdemo-base");
 check("D: GET /changes base variant → 403 names notdemo-base", DENY403(r, "notdemo-base"), `got ${r.status} ${J(r.body)}`);
}

// /proposals?repos=notdemo-xyz → 403, and the body carries NO proposals key
{
 const r = await get(demoAllowEnv, "/proposals", "?repos=notdemo-xyz");
 check("D: GET /proposals?repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("D: GET /proposals 403 body has no proposals key", r.body !== null && !("proposals" in r.body), `keys ${r.body ? Object.keys(r.body).join(",") : "null"}`);
}

// /merge?base=demo&repos=notdemo-xyz → 403
{
 const r = await get(demoAllowEnv, "/merge", "?base=demo&repos=notdemo-xyz");
 check("D: GET /merge?repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
}

// POST /judge {target:{base:"demo",repos:["notdemo-xyz"]}} → 403 (handler-side allowlist)
{
 const r = await post(demoAllowEnv, "/judge", { setId: "v1", target: { base: "demo", repos: ["notdemo-xyz"] } });
 check("D: POST /judge repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
}

// POST /land {repos:["notdemo-xyz"]} → 403 (handler-side allowlist)
{
 const r = await post(demoAllowEnv, "/land", { base: "demo", repos: ["notdemo-xyz"], ref: "main", baseRef: "main" });
 check("D: POST /land repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
}

// Allowlisted names still pass the chokepoint (reach the handler — the
// throwing Artifacts fake then 500s, proving the 403 did NOT fire).
// Scratch chains demo-lh-* / agent-lh-* stay green.
{
 const r = await get(demoAllowEnv, "/changes", "?repo=agent-1");
 check("D: GET /changes?repo=agent-1 passes allowlist (not 403)", r.status !== 403, `got ${r.status} ${J(r.body)}`);
 const r2 = await get(demoAllowEnv, "/proposals", "?repos=demo-lh-base,agent-lh-1");
 check("D: GET /proposals scratch chain passes allowlist (not 403)", r2.status !== 403, `got ${r2.status} ${J(r2.body)}`);
}

// Deny mode still 401s first — the 403 is demo-only by construction.
{
 const r = await get(denyEnv, "/changes", "?repo=notdemo-xyz");
 check("D: deny mode 401s before the allowlist (not 403)", r.status === 401 && r.body?.error === "unauthorized", `got ${r.status} ${J(r.body)}`);
}

// ---------------------------------------------------------------------------
// Group C (e11 route discipline) — the API boundary answers a wrong
// method on a registered path with 405 JSON, and an unknown path with
// 404 JSON, BEFORE the asset layer (and before authorize()). Both via
// the real dispatcher; denyEnv proves the boundary fires pre-auth.
// ---------------------------------------------------------------------------
{
 // Wrong method: POST on the GET /health route -> 405 method-not-allowed.
 // (Explicit POST init: the post() helper defaults to GET when body is null.)
 const r = await post(denyEnv, "/health", {});
 check("C: POST /health (wrong method) → 405 method-not-allowed",
  r.status === 405 && r.body?.ok === false && r.body?.error === "method-not-allowed",
  `got ${r.status} ${J(r.body)}`);

 // Unknown path -> 404 not-found.
 const u = await get(denyEnv, "/no-such-route");
 check("C: GET /no-such-route (unknown path) → 404 not-found",
  u.status === 404 && u.body?.ok === false && u.body?.error === "not-found",
  `got ${u.status} ${J(u.body)}`);
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);

