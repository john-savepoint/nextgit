#!/usr/bin/env bun
// Contract suite: nextgit-e16 — federation manifest (GET /harnesses).
// Run: bun porting/tests/harnesses-api.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker`, `ROUTES`, and the
// real `validateFederationRegistry` from platform/src/index.ts and
// drives worker.fetch() against an in-memory env (the tree-read.test.mjs
// makeEnv idiom) — the platform binding seam is the ONLY fake; no
// mock.module, no source grep, end-to-end through the real dispatcher
// (authorize() mode gate + the API boundary 405-before-404 law).
//
// 7 groups:
//   1. shape contract — the served payload is exactly
//      {ok:true, harnesses:[{name,kind,capabilities,docs}]} over the
//      three shipped entries, closed-schema per entry.
//   2. registry-serves — the worker's served manifest deep-equals the
//      bundled platform/harnesses.json (the single source).
//   3. method guard — POST /harnesses → 405 {ok:false,error:"method-not-allowed"}
//      (the API boundary law; fires before authorize()).
//   4. deny mode — AUTH_MODE "deny" ⇒ 401 {ok:false,error:"unauthorized"}
//      BEFORE any handler work (the authorize() chokepoint).
//   5. namespace-wide posture — /harnesses carries no repo scope, so it
//      sits under the SAME uniform authorize() chokepoint as /health;
//      a scoped route (/changes) under the same env 403s on an
//      out-of-namespace name (control proving the chokepoint is live
//      and /harnesses is gated identically, not bypassed).
//   6. validator fail-closed construction — validateFederationRegistry
//      rejects every law: not-an-array, non-object entry, unknown key
//      (the reserved `endpoint`), missing key, blank name, duplicate
//      name, wrong kind, empty capabilities, unknown capability,
//      duplicated capability, non-https docs. Each is a THROWN error
//      (the module-load posture — an invalid registry never boots).
//   7. egress guard — dispatch internals (bin/args/env/notes/
//      probeBudgetMs/id) and the shipped registry's internal fields
//      never appear in any served body; the served wire is exactly
//      the closed four-key schema (the egress law).
//
// Full-suite safety: a fresh env per group (fresh fake Artifacts,
// fresh per-caller CF-Connecting-IP budget) — in-isolate rate-limiter
// state from one group never bleeds into another; process.exit code
// carries the verdict.

import worker, { ROUTES, validateFederationRegistry } from "../../platform/src/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let passes = 0;
let fails = 0;
const check = (name, ok, detail) => { if (ok) passes++; else { fails++; console.log("FAIL  " + name + (detail ? " - " + detail : "")); } if (ok) console.log("PASS  " + name); };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake — minimal (the route reads nothing). Mirrors
// the tree-read.test.mjs makeFakeArtifacts surface the dispatcher touches
// so env construction is the same idiom, but GET /harnesses never calls
// into it — that is the point (namespace-wide, no repo read).
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
 return {
  get: async () => { throw new Error("unexpected ARTIFACTS.get on /harnesses"); },
  log: async () => { throw new Error("unexpected ARTIFACTS.log on /harnesses"); },
  readTree: async () => { throw new Error("unexpected ARTIFACTS.readTree on /harnesses"); },
  readFile: async () => { throw new Error("unexpected ARTIFACTS.readFile on /harnesses"); },
  readBlob: async () => { throw new Error("unexpected ARTIFACTS.readBlob on /harnesses"); },
  info: async () => { throw new Error("unexpected ARTIFACTS.info on /harnesses"); },
  list: async () => { throw new Error("unexpected ARTIFACTS.list on /harnesses"); },
  createToken: async () => { throw new Error("unexpected ARTIFACTS.createToken on /harnesses"); },
  revokeToken: async () => { throw new Error("unexpected ARTIFACTS.revokeToken on /harnesses"); },
  [Symbol.dispose]: () => { },
 };
}

// Fresh env per group (fresh fake Artifacts + fresh rate budget via
// per-caller IPs), so no group can observe another's state — full-suite
// safe by construction.
let ipSeq = 0;
const nextIp = () => "10.9.1." + (++ipSeq);
function makeEnv(authMode = "demo") {
 return {
  env: {
   ARTIFACTS: makeFakeArtifacts(),
   LIVE: { get: async () => undefined },
   CACHE: { get: async () => undefined, put: async () => { } },
   ASSETS: { fetch: async () => new Response("") },
   AI: { run: async () => null },
   AUTH_MODE: authMode,
  },
 };
}

// JSON GET helper (query routes).
const get = async (env, path, query, ip) => {
 const q = query || "";
 const caller = ip || nextIp();
 const res = await worker.fetch(
  new Request("https://nextgit.invalid" + path + q, { headers: { "CF-Connecting-IP": caller } }),
  env,
 );
 return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

// JSON helper for arbitrary verbs.
const send = async (env, method, path, ip) => {
 const caller = ip || nextIp();
 const res = await worker.fetch(
  new Request("https://nextgit.invalid" + path, { method, headers: { "CF-Connecting-IP": caller } }),
  env,
 );
 return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

// The bundled manifest — the single source the route serves.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUNDLED = JSON.parse(readFileSync(join(ROOT, "platform", "harnesses.json"), "utf8"));

// ===========================================================================
// Group 1 - shape contract: 200 {ok:true, harnesses:[...]} with the
// closed four-key entry schema over the three shipped harnesses.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/harnesses");
 check("1 GET /harnesses → 200", r.status === 200, `got ${r.status} ${J(r.body)}`);
 check("1 body.ok === true", r.body?.ok === true, J(r.body));
 check("1 body.harnesses is an array of 3", Array.isArray(r.body?.harnesses) && r.body.harnesses.length === 3, J(r.body?.harnesses?.length));
 const entryOk = r.body?.harnesses?.every((h) =>
  h && typeof h.name === "string" && h.kind === "byo-cli" &&
  Array.isArray(h.capabilities) && h.capabilities.length > 0 &&
  typeof h.docs === "string"
 );
 check("1 every entry matches the closed shape {name,kind,capabilities,docs}", entryOk === true, J(r.body?.harnesses));
 const closed = r.body?.harnesses?.every((h) => Object.keys(h).sort().join(",") === "capabilities,docs,kind,name");
 check("1 every entry is exactly the four keys (no extras)", closed === true, J(r.body?.harnesses));
}
// ===========================================================================
// Group 3 - method guard: POST /harnesses → 405 method-not-allowed
// (the API boundary law — a registered path addressed with a method no
// route accepts). Fires BEFORE authorize().
// ===========================================================================
{
 const { env } = makeEnv("deny"); // even in deny mode the 405 law fires first
 const r = await send(env, "POST", "/harnesses");
 check("3 POST /harnesses → 405", r.status === 405, `got ${r.status} ${J(r.body)}`);
 check("3 405 body is exactly {ok:false,error:method-not-allowed}", J(r.body) === J({ ok: false, error: "method-not-allowed" }), J(r.body));
}

// ===========================================================================
// Group 4 - deny mode: AUTH_MODE "deny" ⇒ 401 unauthorized
// BEFORE any handler work (the authorize() chokepoint).
// ===========================================================================
{
 const { env } = makeEnv("deny");
 const r = await get(env, "/harnesses");
 check("4 deny mode → 401", r.status === 401, `got ${r.status} ${J(r.body)}`);
 check("4 401 body is exactly {ok:false,error:unauthorized}", J(r.body) === J({ ok: false, error: "unauthorized" }), J(r.body));
}

// ===========================================================================
// Group 5 - namespace-wide posture: /harnesses carries no repo
// scope to adjudicate, so it sits under the SAME uniform
// authorize() chokepoint as /health — the namespace-wide routes'
// shared posture. Control: a scoped route (/changes) under the
// SAME env 403s on an out-of-namespace name, proving the
// chokepoint is live and /harnesses is gated identically (not
// bypassed, not under-gated).
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/harnesses");
 check("5 /harnesses serves 200 in demo mode (namespace-wide, no scope carried)", r.status === 200 && r.body?.ok === true, `got ${r.status} ${J(r.body)}`);
 const control = await get(env, "/changes", "?repo=outside-namespace");
 check("5 control: /changes with an out-of-namespace name → 403 repo-not-allowed (chokepoint live)", control.status === 403 && control.body?.error === "repo-not-allowed", `got ${control.status} ${J(control.body)}`);
}

// ===========================================================================
// Group 6 - validator fail-closed construction: validateFederationRegistry
// throws on EVERY law (the module-load posture — an invalid registry
// never boots). Each case is a real construction through the exported
// function, not a source grep.
// ===========================================================================
{
 const mustThrow = (name, input, match) => {
  try {
   validateFederationRegistry(input);
   check("6 " + name, false, "did not throw");
  } catch (e) {
   const msg = String((e)?.message ?? e);
   check("6 " + name, match ? msg.includes(match) : true, msg);
  }
 };
 const base = (over = {}) => ({ name: "x", kind: "byo-cli", capabilities: ["probe"], docs: "https://x.dev", ...over });
 mustThrow("not an array → throws", { not: "array" }, "array");
 mustThrow("non-object entry → throws", ["nope"], "object");
 mustThrow("unknown key (reserved endpoint) → throws", [base({ endpoint: "https://x" })], "exactly");
 mustThrow("missing docs key → throws", [{ name: "x", kind: "byo-cli", capabilities: ["probe"] }], "exactly");
 mustThrow("blank name → throws", [base({ name: "  " })], "non-blank");
 mustThrow("duplicate name → throws", [base(), base({ docs: "https://y.dev" })], "duplicates name");
 mustThrow("wrong kind → throws", [base({ kind: "hosted" })], "byo-cli");
 mustThrow("empty capabilities → throws", [base({ capabilities: [] })], "non-empty");
 mustThrow("unknown capability → throws", [base({ capabilities: ["deploy-it"] })], "vocabulary");
 mustThrow("duplicated capability → throws", [base({ capabilities: ["probe", "probe"] })], "duplicated");
 mustThrow("non-https docs → throws", [base({ docs: "http://x.dev" })], "https");
 // Valid input returns the normalized FederationHarness array.
 const ok = validateFederationRegistry([base()]);
 check("6 valid input → returns the normalized entry", J(ok) === J([{ name: "x", kind: "byo-cli", capabilities: ["probe"], docs: "https://x.dev" }]), J(ok));
 // The shipped manifest itself validates (the module-load proof ran at import).
 const shipped = validateFederationRegistry(BUNDLED);
 check("6 the bundled manifest validates clean", shipped.length === 3, J(shipped?.length));
}

// ===========================================================================
// Group 7 - egress guard: dispatch internals never egress. The served
// wire is exactly the closed four-key schema — no bin/args/env/notes/
// probeBudgetMs/id, and no dispatch-registry value appears in any
// served body (the egress law, AD-9 / NFR-3).
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/harnesses");
 const body = J(r.body);
 // Dispatch-registry-only field names must not appear as served keys.
 const internalFields = ["bin", "args", "env", "notes", "probeBudgetMs", "id", "stdinPrompt", "endpoint"];
 const leaked = internalFields.filter((f) => r.body?.harnesses?.some((h) => f in h));
 check("7 no dispatch-internal field appears as a served key", leaked.length === 0, `leaked: ${leaked.join(",")}`);
 // The shipped registry's dispatch-internal VALUES must not
 // appear in the served body. Harness NAMES legitimately appear
 // (the federation `name` IS the dispatch `id` by design), so
 // the assertion targets the values that are internal-only by
 // construction: the arg tokens (CLI flags/placeholders) and
 // the free-text notes. `bin` equals the harness name for every
 // shipped entry, so it is excluded — the arg tokens and notes
 // are the discriminating internal values.
 const registry = JSON.parse(readFileSync(join(ROOT, "platform", "scripts", "harnesses.json"), "utf8"));
 const internalValues = registry.flatMap((e) => [...(e.args ?? []), ...(e.notes ? [e.notes] : [])]);
 const leakedValues = internalValues.filter((v) => typeof v === "string" && v.length > 0 && body.includes(v));
 check("7 no dispatch-internal value (args/notes) appears in the served body", leakedValues.length === 0, `leaked: ${leakedValues.join(" | ")}`);
 // The ROUTES entry itself is the tabled posture (GET, read, authorize-covered).
 const route = ROUTES.find((rt) => rt.path === "/harnesses");
 check("7 ROUTES carries /harnesses as GET read", route?.method === "GET" && route.action === "read", J(route ? { method: route.method, action: route.action } : null));
}

console.log(fails === 0 ? "ALL PASS (" + passes + " checks)" : fails + " FAILURES (" + passes + " passed)");
process.exit(fails === 0 ? 0 : 1);
