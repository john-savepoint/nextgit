#!/usr/bin/env bun
// Contract suite: FR-36 — repo git-token TTL policy (24 h default / 7 d max /
// over-max rejected before the API call).
// Run: bun porting/tests/token-ttl.test.mjs   (exit 0 = pass)
//
// Offline, permanent, full-suite-safe: imports the shared helper
// (platform/scripts/lib/tokens.mjs) and the fanout.mjs mint site, exercises
// the pure TTL resolver, spies the injected fetch-boundary `call` to prove
// an over-max ttl never reaches the network, and asserts function identity
// so every script mint site is provably routed through the one helper.
//
// Pattern: real construction only, no module mocks, no source grep, no network.

import { resolveTtl, mintRepoToken } from "../../platform/scripts/lib/tokens.mjs";
import * as fanout from "../../platform/scripts/fanout.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// 1. The 24 h default (shared helper, not just fanout).
check("resolveTtl(undefined) = 86400 (24h default)", resolveTtl(undefined) === 86400);
check("resolveTtl(null) = 86400 (24h default)", resolveTtl(null) === 86400);

// 2. Explicit shorter TTL passes (the seed class: 3600 s).
check("resolveTtl(3600) = 3600 (explicit shorter legal)", resolveTtl(3600) === 3600);

// 3. The 7 d boundary is legal.
check("resolveTtl(604800) = 604800 (max boundary legal)", resolveTtl(604800) === 604800);

// 4. Over-max is REJECTED — fail closed, no clamp.
let threw = false;
let msg = "";
try { resolveTtl(999999); } catch (e) { threw = true; msg = e.message; }
check("resolveTtl(999999) throws (>7d rejected, no clamp)", threw && /604800/.test(msg), `message=${msg}`);

// 5. Floor + NaN guards kept.
threw = false;
try { resolveTtl(30); } catch { threw = true; }
check("resolveTtl(30) throws (<60s floor kept)", threw);

threw = false;
try { resolveTtl("x"); } catch { threw = true; }
check("resolveTtl('x') throws (NaN kept)", threw);

// 6. Pre-API-call refusal: an over-max ttl rejects AND the injected call
// spy records ZERO invocations — the refusal happens before the network.
{
  let calls = 0;
  const fakeCall = async () => { calls++; return { plaintext: "tok" }; };
  let rejected = false;
  try { await mintRepoToken(fakeCall, { base: "https://api.example", repo: "r", ttl: 999999, headers: {} }); }
  catch { rejected = true; }
  check("mintRepoToken rejects over-max ttl", rejected);
  check("mintRepoToken refusal precedes the API call (0 invocations)", calls === 0, `calls=${calls}`);
}

// 7. Happy path through the helper: resolves with the spy's return, and the
// spy was called with the resolved default ttl — proves routing + mint shape.
{
  let recorded = null;
  const spy = async (method, url, body) => { recorded = { method, url, body }; return { plaintext: "tok", scope: "write", expires_at: "x" }; };
  const result = await mintRepoToken(spy, { base: "https://api.example", repo: "my-repo", ttl: undefined, headers: { Authorization: "Bearer t" } });
  check("mintRepoToken resolves with the call's return", result.plaintext === "tok");
  check("mintRepoToken calls POST <base>/tokens", recorded.method === "POST" && recorded.url === "https://api.example/tokens");
  check("mintRepoToken mints { repo, scope: 'write', ttl: 86400 }",
    recorded.body.repo === "my-repo" && recorded.body.scope === "write" && recorded.body.ttl === 86400,
    `body=${JSON.stringify(recorded.body)}`);
}

// 8. Import-surface / routing identity: fanout's resolveTtl IS the helper's
// resolveTtl — every script mint site is provably routed through one home.
check("fanout.resolveTtl === tokens.resolveTtl (single policy home)", fanout.resolveTtl === resolveTtl);

// ---------------------------------------------------------------------------
console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
