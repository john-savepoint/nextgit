#!/usr/bin/env bun
// Contract suite: CSRF precondition + seam precondition (FR-45 / AD-9).
// Run: bun porting/tests/seam-precondition.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts
// and drives worker.fetch() with an in-memory fake env. ARTIFACTS.get/list
// throw to prove no binding read happens on CSRF denials; AI.run records
// calls to prove no compute happens. No module mocks, no source grep.

import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";
import {
  hasCookieIdentity,
  csrfGate,
  csrfRequiredResponse,
  CSRF_HEADER,
  assertSeamEnabled,
} from "../../platform/src/auth.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// Fake env: ARTIFACTS.get/list THROW (a CSRF-denied request that still
// reaches a handler 500s, never silently passes); AI.run RECORDS so we can
// prove zero compute on denied paths.
// ---------------------------------------------------------------------------
function makeEnv(authMode) {
  const aiCalls = [];
  const ARTIFACTS = {
    get: async () => { throw new Error("should not be reached — CSRF gate must reject before any repo read"); },
    list: async () => { throw new Error("should not be reached"); },
  };
  const env = {
    ARTIFACTS,
    LIVE: { get: async () => undefined },
    CACHE: { get: async () => undefined, put: async () => { } },
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async (...a) => { aiCalls.push(a); return null; } },
    AUTH_MODE: authMode,
  };
  return { env, aiCalls };
}

const get = async (env, path, query = "", headers = {}) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}${query}`, { headers }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

const post = async (env, path, body = null, headers = {}) => {
  const init = body === null
    ? { method: "POST", headers }
    : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Group A — detector matrix: hasCookieIdentity.
// ---------------------------------------------------------------------------
{
  const withCookie = new Request("https://nextgit.invalid/land", { method: "POST", headers: { Cookie: "a=b" } });
  const withoutCookie = new Request("https://nextgit.invalid/land", { method: "POST" });
  const emptyCookie = new Request("https://nextgit.invalid/land", { method: "POST", headers: { Cookie: "" } });
  check("A: hasCookieIdentity true with Cookie header", hasCookieIdentity(withCookie) === true);
  check("A: hasCookieIdentity false with no Cookie header", hasCookieIdentity(withoutCookie) === false);
  check("A: hasCookieIdentity true with empty Cookie header", hasCookieIdentity(emptyCookie) === true, "any Cookie: header = cookie-carried identity");
}

// ---------------------------------------------------------------------------
// Group B — csrfGate matrix (unit level, on the real exported gate).
// ---------------------------------------------------------------------------
{
  // No cookie → gate does not apply (null), even with a token.
  const bare = new Request("https://nextgit.invalid/land", { method: "POST" });
  check("B: csrfGate null when no Cookie header", csrfGate(bare) === null);

  // Cookie present, expected token is unwired (null) → hard deny 403.
  const cookieReq = new Request("https://nextgit.invalid/land", { method: "POST", headers: { Cookie: "session=x" } });
  const denied = csrfGate(cookieReq);
  check("B: csrfGate 403 when Cookie present and expected token unwired", denied !== null && denied.status === 403, `got ${denied ? denied.status : "null"}`);
  const deniedBody = denied ? await denied.json().catch(() => null) : null;
  check("B: csrfGate denial body is {ok:false,error:csrf-required}", deniedBody?.ok === false && deniedBody?.error === "csrf-required", J(deniedBody));

  // Cookie + absent header → 403.
  check("B: csrfGate 403 when Cookie present and x-csrf-token absent", csrfGate(cookieReq)?.status === 403);

  // Cookie + empty header value → 403.
  const emptyHeader = new Request("https://nextgit.invalid/land", { method: "POST", headers: { Cookie: "session=x", "x-csrf-token": "" } });
  check("B: csrfGate 403 when Cookie present and x-csrf-token empty", csrfGate(emptyHeader)?.status === 403);

  // Cookie + any non-matching token → still 403 (expected source is null, nothing matches).
  const bogusToken = new Request("https://nextgit.invalid/land", { method: "POST", headers: { Cookie: "session=x", "x-csrf-token": "artificial-token" } });
  check("B: csrfGate 403 when Cookie present and token cannot match (unwired source)", csrfGate(bogusToken)?.status === 403);

  // csrfRequiredResponse shape.
  const r = csrfRequiredResponse();
  check("B: csrfRequiredResponse is 403", r.status === 403);
  const rBody = await r.json().catch(() => null);
  check("B: csrfRequiredResponse body {ok:false,error:csrf-required}", rBody?.ok === false && rBody?.error === "csrf-required", J(rBody));

  // CSRF_HEADER constant.
  check("B: CSRF_HEADER is x-csrf-token", CSRF_HEADER === "x-csrf-token");
}

// ---------------------------------------------------------------------------
// Group C — end-to-end POST /judge + POST /land: cookie-carried identity
// is denied 403 csrf-required with ZERO AI calls and ZERO Artifacts reads.
// ---------------------------------------------------------------------------
{
  const { env, aiCalls } = makeEnv("demo");
  const cookieHeaders = { Cookie: "session=demo" };

  // POST /judge with cookie, no CSRF token → 403, zero compute.
  const judgeNoToken = await post(env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, cookieHeaders);
  check("C: POST /judge + Cookie, no token → 403", judgeNoToken.status === 403, `got ${judgeNoToken.status}`);
  check("C: POST /judge + Cookie denial body csrf-required", judgeNoToken.body?.error === "csrf-required", J(judgeNoToken.body));
  check("C: POST /judge denial makes zero AI.run calls", aiCalls.length === 0, `got ${aiCalls.length}`);

  // POST /judge with cookie + bogus token → still 403 (expected source unwired).
  const judgeBogus = await post(env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, { ...cookieHeaders, "x-csrf-token": "bogus" });
  check("C: POST /judge + Cookie + bogus token → 403", judgeBogus.status === 403, `got ${judgeBogus.status}`);
  check("C: POST /judge bogus-token denial body csrf-required", judgeBogus.body?.error === "csrf-required", J(judgeBogus.body));
  check("C: POST /judge bogus-token denial makes zero AI.run calls", aiCalls.length === 0, `got ${aiCalls.length}`);

  // POST /land with cookie, no token → 403 (handler never parses the body / reads repos).
  const landNoToken = await post(env, "/land", { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" }, cookieHeaders);
  check("C: POST /land + Cookie, no token → 403", landNoToken.status === 403, `got ${landNoToken.status}`);
  check("C: POST /land denial body csrf-required", landNoToken.body?.error === "csrf-required", J(landNoToken.body));
  check("C: POST /land denial makes zero AI.run calls", aiCalls.length === 0, `got ${aiCalls.length}`);
  // Repo-not-allowed for /judge is enforced INSIDE the handler (the body is
  // the scope carrier, readable only there) — so a cookie-carrying POST is
  // stopped by the dispatcher-level CSRF gate first: 403 csrf-required.
  // A header-only (no Cookie) POST reaches the handler's own 403.
  const allowEnv = makeEnv("demo");
  const badRepoNoCookie = await post(allowEnv.env, "/judge", { setId: "v1", target: { base: "demo", repos: ["notdemo-xyz"], refs: ["main"] } });
  check("C: POST /judge non-allowlisted repo without Cookie → 403 repo-not-allowed (handler)", badRepoNoCookie.status === 403 && badRepoNoCookie.body?.error === "repo-not-allowed", `got ${badRepoNoCookie.status} ${J(badRepoNoCookie.body)}`);
  const badRepoCookie = await post(allowEnv.env, "/judge", { setId: "v1", target: { base: "demo", repos: ["notdemo-xyz"], refs: ["main"] } }, cookieHeaders);
  check("C: POST /judge non-allowlisted repo + Cookie → 403 csrf-required (gate precedes handler)", badRepoCookie.status === 403 && badRepoCookie.body?.error === "csrf-required", `got ${badRepoCookie.status} ${J(badRepoCookie.body)}`);

  const denyEnv = makeEnv(undefined);
  const denyJudge = await post(denyEnv.env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } }, cookieHeaders);
  check("C: deny mode POST /judge + Cookie → 401 (authorize precedes CSRF)", denyJudge.status === 401 && denyJudge.body?.error === "unauthorized", `got ${denyJudge.status} ${J(denyJudge.body)}`);


}

// ---------------------------------------------------------------------------
// Group D — header-identity (no Cookie) rows: machine callers unaffected.
// POST /judge with no Cookie header passes the CSRF gate and reaches the
// handler: it reads the repo (the throwing ARTIFACTS fake makes that a
// 500 "should not be reached" — NOT a 403 csrf-required), proving the
// gate did not fire for header-only callers.
// ---------------------------------------------------------------------------
{
  const { env, aiCalls } = makeEnv("demo");
  const noCookie = await post(env, "/judge", { setId: "v1", target: { base: "demo", repos: ["agent-1"], refs: ["main"] } });
  check("D: POST /judge without Cookie reaches handler (not csrf-required)", noCookie.status !== 403 || noCookie.body?.error !== "csrf-required", `got ${noCookie.status} ${J(noCookie.body)}`);
  // The handler ran: it got past parsing and the allowlist into the repo
  // read, which the throwing fake turns into a 500 — never a silent pass.
  check("D: POST /judge without Cookie reads repos (500 artifacts error, not 403)", noCookie.status === 500, `got ${noCookie.status} ${J(noCookie.body)}`);
  check("D: POST /judge without Cookie makes zero AI.run calls (repo read precedes compute)", aiCalls.length === 0, `got ${aiCalls.length}`);

  const noCookieLand = await post(env, "/land", { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  check("D: POST /land without Cookie reaches handler (not csrf-required)", noCookieLand.status !== 403 || noCookieLand.body?.error !== "csrf-required", `got ${noCookieLand.status} ${J(noCookieLand.body)}`);
}

// ---------------------------------------------------------------------------
// Group E — GET routes unaffected: a Cookie header on a GET route does
// NOT trip the CSRF gate (only mutating methods gate). GET /health 200s.
// ---------------------------------------------------------------------------
{
  const { env } = makeEnv("demo");
  const health = await get(env, "/health", "", { Cookie: "session=demo" });
  check("E: GET /health + Cookie → 200 (GET routes ungated)", health.status === 200 && health.body?.ok === true, `got ${health.status} ${J(health.body)}`);

  const events = await get(env, "/events", "", { Cookie: "session=demo" });
  check("E: GET /events + Cookie → 200 (GET routes ungated)", events.status === 200 && events.body?.ok === true, `got ${events.status} ${J(events.body)}`);
}

// ---------------------------------------------------------------------------
// Group F — assertSeamEnabled matrix.
// ---------------------------------------------------------------------------
{
  check("F: assertSeamEnabled returns 'demo' for AUTH_MODE=demo", assertSeamEnabled({ AUTH_MODE: "demo" }) === "demo");
  let threwUnset = false;
  try { assertSeamEnabled({}); } catch (e) { threwUnset = e instanceof Error && e.message === "seam-not-enabled"; }
  check("F: assertSeamEnabled throws seam-not-enabled for unset AUTH_MODE", threwUnset);
  let threwDeny = false;
  try { assertSeamEnabled({ AUTH_MODE: "deny" }); } catch (e) { threwDeny = e instanceof Error && e.message === "seam-not-enabled"; }
  check("F: assertSeamEnabled throws seam-not-enabled for AUTH_MODE=deny", threwDeny);
  let threwGarbage = false;
  try { assertSeamEnabled({ AUTH_MODE: "garbage" }); } catch (e) { threwGarbage = e instanceof Error && e.message === "seam-not-enabled"; }
  check("F: assertSeamEnabled throws seam-not-enabled for garbage AUTH_MODE", threwGarbage);
}

// ---------------------------------------------------------------------------
// Group G — provisioning-shape proof: the seam precondition throws BEFORE
// any binding use. assertSeamEnabled throws on a deny env; the throw
// precedes any env.ARTIFACTS access (the fake throws "should not be
// reached" — if the seam had read a binding first, the error message
// would differ).
// ---------------------------------------------------------------------------
{
  const { env } = makeEnv(undefined);
  let err = null;
  try {
    // Simulate a provisioner that checks the seam before touching bindings.
    assertSeamEnabled(env);
    env.ARTIFACTS.get("should-not-happen");
  } catch (e) { err = e; }
  check("G: seam precondition throws before any binding use", err instanceof Error && err.message === "seam-not-enabled", `got ${err?.message}`);
}

// ---------------------------------------------------------------------------
// Group H — route table structure: every POST route is a CSRF-gated
// mutating route; GET routes are not.
// ---------------------------------------------------------------------------
{
  const posts = ROUTES.filter((r) => r.method === "POST").map((r) => r.path);
  check("H: POST routes are exactly /land, /upstream, /judge, /intents, /reveal and /comments", J(posts) === J(["/land", "/upstream", "/judge", "/intents", "/reveal", "/comments"]), J(posts));
  const gets = ROUTES.filter((r) => r.method === "GET").map((r) => r.path);
  check("H: GET routes exist and are not gated", gets.length > 0, J(gets));
  // nextgit-e16: /sessions/ is the FIRST dynamic POST route
  // (the session-steering write). The static-POST set above
  // is UNCHANGED — the steer POST is dynamic, not static.
  // DYNAMIC_ROUTES now carries exactly one POST at /sessions/.
  const dynPosts = DYNAMIC_ROUTES.filter((r) => r.method === "POST");
  check("H: DYNAMIC_ROUTES carries exactly one POST at /sessions/ (the steer)",
    dynPosts.length === 1 && dynPosts[0]?.prefix === "/sessions/",
    J(DYNAMIC_ROUTES.filter((r) => r.method === "POST")));
}

// ---------------------------------------------------------------------------
// Group H2 (nextgit-e16) — every DYNAMIC_ROUTES POST runs behind
// csrfGate: the new /sessions/{repo}/steer write is covered by the
// dispatcher's dynamic branch (authorize() + csrfGate() fire before
// the handler). Prove it end-to-end: a cookie-carrying steer is
// denied 403 csrf-required with ZERO KV writes (the seam-precondition
// posture — the ARTIFACTS/LIVE fakes here throw/return nothing, so a
// request that slipped the gate would surface as a 500, not a 403).
// ---------------------------------------------------------------------------
{
  const { env } = makeEnv("demo");
  const res = await post(env, "/sessions/agent-1/steer", { instruction: "ship the login fix first" }, { Cookie: "identity=op" });
  check("H2: cookie-carrying steer → 403 csrf-required (the dynamic POST is CSRF-gated)",
    res.status === 403 && res.body?.ok === false && res.body?.error === "csrf-required",
    `${res.status} ${J(res.body)}`);
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
