#!/usr/bin/env bun
// Contract suite: FR-11 — GET route param validation (security gate fix heal-1)
// Run: bun porting/tests/param-validation.test.mjs   (exit 0 = pass)
//
// Real construction: GET /changes, /proposals, /merge are exercised through the
// REAL worker module (worker.fetch) against an in-memory Artifacts fake — the
// platform binding seam is the only fake (pattern per fork-point-pinning.test.mjs);
// no module mocks, no source grep.
//
// The contract: unvalidated repo/ref params must be rejected with 400 before
// any Artifacts get() call, mirroring parseLandBody/parseJudgeBody validation.
// The fake ARTIFACTS.get throws to prove validation rejects first; env.LIVE.get
// returns undefined to prove the cache key path is never reached on rejection.

import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// Shared in-memory fake: ARTIFACTS.get throws to prove validation REJECTS before
// any binding is touched; LIVE.get is undefined (real KV would have it) so we
// catch if validation fails to short-circuit the cache key path.
function makeEnv() {
  const ARTIFACTS = { get: async () => { throw new Error("should not be reached — validation must reject first"); } };
  const env = { ARTIFACTS, LIVE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null } };
  return env;
}

const get = async (env, path, query = "") => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/${path}${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

// ---- case A: /changes rejects invalid repo name (char outside charset) ---------
{
  const env = makeEnv();
  const r = await get(env, "changes", "?repo=bad%20name&base=demo&ref=main&baseRef=main");
  check("A: /changes rejects invalid repo name (space)", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case B: /changes rejects invalid base repo name ----------------------------
{
  const env = makeEnv();
  const r = await get(env, "changes", "?repo=agent-1&base=bad%20name&ref=main&baseRef=main");
  check("B: /changes rejects invalid base repo", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case C: /changes rejects ref with .. traversal -----------------------------
{
  const env = makeEnv();
  const r = await get(env, "changes", "?repo=agent-1&base=demo&ref=../main&baseRef=main");
  check("C: /changes rejects ref with .. segment", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case D: /changes rejects baseRef with leading slash -----------------------
{
  const env = makeEnv();
  const r = await get(env, "changes", "?repo=agent-1&base=demo&ref=main&baseRef=/main");
  check("D: /changes rejects baseRef with leading slash", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case E: /proposals rejects invalid base (guard cache key) -----------------
{
  const env = makeEnv();
  const r = await get(env, "proposals", "?base=bad%20name&ref=main&baseRef=main");
  check("E: /proposals rejects invalid base repo (cache key guarded)", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case F: /proposals rejects ref with traversal (guard cache key) ------------
{
  const env = makeEnv();
  const r = await get(env, "proposals", "?base=demo&ref=evil/..%2Fref&baseRef=main");
  check("F: /proposals rejects ref with traversal (cache key guarded)", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case G: /proposals rejects invalid repo name in repos list ------------------
{
  const env = makeEnv();
  const r = await get(env, "proposals", "?base=demo&ref=main&baseRef=main&repos=agent-1,bad%20name");
  check("G: /proposals rejects invalid repo name in list", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case H: /merge rejects missing repos ---------------------------------------
{
  const env = makeEnv();
  const r = await get(env, "merge", "?base=demo&ref=main&baseRef=main");
  check("H: /merge rejects missing repos parameter", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case I: /merge rejects invalid repo name in repos list ---------------------
{
  const env = makeEnv();
  const r = await get(env, "merge", "?base=demo&ref=main&baseRef=main&repos=bad%20name");
  check("I: /merge rejects invalid repo name in list", r.status === 400 && r.body?.ok === false, J(r.body));
}

// ---- case J: /changes missing repo -> 400 (unchanged behavior) -----------------
{
  const env = makeEnv();
  const r = await get(env, "changes", "?base=demo&ref=main&baseRef=main");
  check("J: /changes missing repo -> 400 repo-parameter-required", r.status === 400 && r.body?.error === "repo parameter required", J(r.body));
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
