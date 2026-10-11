#!/usr/bin/env node
// method-guards.probe.mjs — LIVE probe of the platform's API method
// guards: for each documented route, the NON-documented method must be
// answered by the worker — not the asset handler — with a 4xx JSON
// error. Promotes the acceptance from the ephemeral `node -e` one-liner
// in the compile slice record (porting/compile/runs/compile-2026-10-06T13-31-51/
// slices/E11-verify.json → e11-verify-method-guards.check_cmd) to a
// named, re-runnable file (repo convention: verify check_cmds are
// promoted to named probe files — direct precedent: the sibling
// e11-verify-seven-route-surface story in the SAME slice record,
// promoted to porting/tests/seven-route-surface.probe.mjs).
//
// Verbatim acceptance (compile slice E11-verify.json →
// e11-verify-method-guards): for each documented route, the
// non-documented method (POST /health, POST /changes, POST /proposals,
// POST /merge, GET /land, GET /judge, POST /events) is answered by the
// worker — not the asset handler — with 4xx and `content-type:
// application/json` carrying `{ok:false,error}`; no probe may return 2xx
// or an empty/non-JSON asset response; the check lists every failing
// probe and exits non-zero.
//
// Seven probes, five named checks each (failures accumulate — every
// failing probe is listed, no early bail):
//   (1) status ∈ [400,500)             — excludes 2xx
//   (2) content-type includes application/json
//   (3) body non-empty and JSON-parses — excludes empty/non-JSON asset responses
//   (4) parsed.ok === false + non-empty string error (envelope law)
//   (5) error === "method-not-allowed" — exact pin of the API-boundary
//       static literal (CONTRACT.md §API boundary; platform/src/index.ts
//       returns it before authorize()/CSRF; catches deployed-bundle
//       drift live)
//
// Read-only discipline (STRIDE scoping, security-design-review applied
// to scope): fixed paths, GET + empty-body POST only. Every probe is a
// wrong-method request, so the boundary answers 405 BEFORE
// authorize()/CSRF and no handler — and no mutation of `demo` or
// `agent-1..5` — can run. User-Agent nextgit-method-guards/1.0;
// AbortSignal.timeout per request; bounded exponential-backoff retries;
// no fan-out. Info-disclosure boundary: asserts response shapes only —
// secret-class value masking is deliberately NOT re-tested here (owned
// by the VERIFY-gate pair demo-verify.mjs check 6 +
// egress-guard.probe.mjs), so this probe cannot green-pass vacuously
// on a masking regression.
//
// Full-registry wrong-method coverage (/reveal, /events/stream,
// /landings/) is pinned OFFLINE by route-discipline.test.mjs Group 1
// (real dispatcher + ASSETS-probe negative proof); this probe stays
// exactly the seven probes the acceptance enumerates.
//
// Run: node porting/tests/method-guards.probe.mjs
// ENV: NEXTGIT_PLATFORM_URL or PLATFORM (both precedent env names honored)
// Exit: 0 green (`method guards OK (7 routes)`) · 1 method-guard drift
//       (any failing probe; every failure listed) · 2 transport-unreachable
//       (all retries exhausted — a WSL2 edge-connect stall must never
//       masquerade as guard drift, per the demo-verify.mjs:39 precedent)

import { setDefaultResultOrder } from "node:dns";
// WSL2 edge-connect workaround carried by the original check_cmd
// (`require("dns").setDefaultResultOrder("ipv4first")`).
setDefaultResultOrder("ipv4first");

const PLATFORM =
  process.env.NEXTGIT_PLATFORM_URL ??
  process.env.PLATFORM ??
  "https://nextgit-platform.john-b7d.workers.dev";

// The check_cmd's own transport budget (compile slice check_cmd):
// 60s per attempt, 5 attempts, 1000 * 2^attempt ms backoff.
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
const USER_AGENT = "nextgit-method-guards/1.0";

// Exactly the seven wrong-method probes the acceptance enumerates.
const PROBES = [
  ["POST", "/health"],
  ["POST", "/changes"],
  ["POST", "/proposals"],
  ["POST", "/merge"],
  ["GET", "/land"],
  ["GET", "/judge"],
  ["POST", "/events"],
];

// one(method, path): single request. Returns {status, ct, text}.
const one = async (method, path) => {
  const res = await fetch(`${PLATFORM}${path}`, {
    method,
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, ct: res.headers.get("content-type") || "", text };
};

// req(method, path): MAX_ATTEMPTS attempts with 1000 * 2^attempt ms
// backoff (the check_cmd pattern). Transport exhaustion (fetch throws
// after all retries) throws — the caller maps that to
// PROBE-UNREACHABLE + exit 2.
const req = async (method, path) => {
  let last;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await one(method, path);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
};

const bad = [];

try {
  for (const [method, path] of PROBES) {
    const r = await req(method, path);
    let parsed = null;
    try {
      parsed = JSON.parse(r.text);
    } catch {
      parsed = null;
    }

    const label = `${method} ${path}`;
    const problems = [];
    // (1) status ∈ [400,500) — a 2xx (or 5xx) is a guard failure.
    if (!(r.status >= 400 && r.status < 500)) problems.push(`status=${r.status} not in [400,500)`);
    // (2) content-type includes application/json.
    if (!r.ct.includes("application/json")) problems.push(`ct=${JSON.stringify(r.ct)}`);
    // (3) body non-empty and JSON-parses (excludes asset responses).
    if (r.text.length === 0 || parsed === null) problems.push("body empty or non-JSON");
    // (4) envelope law: ok === false + non-empty string error.
    if (parsed?.ok !== false || typeof parsed?.error !== "string" || parsed.error.length === 0) {
      problems.push("body not {ok:false,error:<non-empty string>}");
    }
    // (5) exact pin: the API-boundary static literal.
    if (parsed?.error !== "method-not-allowed") {
      problems.push(`error=${JSON.stringify(parsed?.error)} != "method-not-allowed"`);
    }

    if (problems.length > 0) {
      console.log(`FAIL  ${label} — ${problems.join("; ")}`);
      bad.push(`${label} -> ${r.status} ct=${r.ct} body=${r.text.slice(0, 60)}`);
    } else {
      console.log(`PASS  ${label} -> ${r.status} ${r.ct} ${r.text.slice(0, 60)}`);
    }
  }
} catch (err) {
  // Transport exhaustion: a WSL2 edge-connect stall must never
  // masquerade as guard drift (demo-verify.mjs:39 precedent).
  const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
  console.error(`PROBE-UNREACHABLE: ${cause}`);
  process.exit(2);
}

if (bad.length > 0) {
  console.error("method-guard failures: " + bad.join("; "));
  process.exit(1);
}
console.log("method guards OK (7 routes)");
process.exit(0);
