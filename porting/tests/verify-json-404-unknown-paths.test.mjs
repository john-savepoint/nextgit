#!/usr/bin/env node
// verify-json-404-unknown-paths.test.mjs — LIVE acceptance suite for work
// order nextgit-e11-verify-json-404-unknown-paths: unknown API paths
// return JSON 404, never the asset handler, and the triage UI still serves.
//
// The dispatcher-side consequence (platform/src/index.ts boundary
// classification: 405 on a known path with the wrong method, 404
// {ok:false,error:"not-found"} on any unknown path, env.ASSETS.fetch only
// for the closed UI_ASSET_PATHS whitelist) is pinned OFFLINE by
// porting/tests/route-discipline.test.mjs Groups 1-3 (real worker.fetch
// with an ASSETS probe proving the asset handler is never reached). This
// suite carries the order's acceptance legs against the DEPLOYED worker:
//
//   GET /no-such-route, GET /api/no-such-route, GET /changes/extra
//     -> 404, content-type: application/json, {ok:false,error:<string>}
//   GET / -> 200 text/html (a catch-all cannot break static assets)
//
// Exit codes: 0 green · 1 acceptance failure (every failure is listed) ·
// 2 transport unreachable (retries exhausted — a WSL2 edge-connect stall
// must never masquerade as an acceptance failure; seven-route-surface
// precedent). No NEXTGIT_PLATFORM -> one SKIP line, exit 0 (battery
// convention; the deploy gate runs it with the env set).
//
// Run: NEXTGIT_PLATFORM=https://<worker> node porting/tests/verify-json-404-unknown-paths.test.mjs

const BASE = process.env.NEXTGIT_PLATFORM;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; return; }
  fail++;
  console.log("FAIL  " + (detail ? name + " — " + detail : name));
};
const J = (x) => JSON.stringify(x);

if (!BASE) {
  console.log("SKIP  live group (NEXTGIT_PLATFORM not set) — rerun with NEXTGIT_PLATFORM=<worker-url>");
  process.exit(0);
}

const UA = "nextgit-verify-json-404-unknown-paths/1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (path) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": UA } });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
};
const get = async (path) => {
  let last;
  for (let i = 0; i < 5; i++) {
    try { return await one(path); } catch (e) { last = e; await sleep(1000 * 2 ** i); }
  }
  console.error("PROBE-UNREACHABLE: " + (last && last.cause ? String(last.cause.code ?? last.cause.message ?? last.cause) : String(last)));
  process.exit(2);
};

// Legs 1-3: the three unknown paths from the order's acceptance — each must
// be a JSON 404 envelope, never an empty or non-JSON asset-layer response.
for (const p of ["/no-such-route", "/api/no-such-route", "/changes/extra"]) {
  const r = await get(p);
  let body = null;
  try { body = JSON.parse(r.text); } catch { /* non-JSON body: fails the shape check below */ }
  check(`404: GET ${p} -> status 404`, r.status === 404, `got ${r.status}`);
  check(`404: GET ${p} -> content-type application/json`, r.contentType.includes("application/json"), `got ${r.contentType}`);
  check(`404: GET ${p} -> body {ok:false,error:<string>}`, body !== null && body.ok === false && typeof body.error === "string", `got ${J(body)}`);
}

// Leg 4: the triage UI still serves — the boundary cannot 404-everything.
const ui = await get("/");
check("UI: GET / -> status 200", ui.status === 200, `got ${ui.status}`);
check("UI: GET / -> content-type text/html", ui.contentType.includes("text/html"), `got ${ui.contentType}`);
check("UI: GET / -> triage document served", ui.text.includes("<html"), `body starts ${J(ui.text.slice(0, 60))}`);

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
