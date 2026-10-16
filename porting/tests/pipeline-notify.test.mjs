#!/usr/bin/env bun
// Contract suite: POST /pipelines/{commit}/notify (nextgit-e20) —
// the signed, credential-free, fire-and-forget outbound webhook v1.
// Run: bun porting/tests/pipeline-notify.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker`, `ROUTES`,
// `DYNAMIC_ROUTES` from platform/src/index.ts and
// `ROUTE_RATE_LIMITS` from platform/src/rate.ts; drives
// worker.fetch() over the REAL dispatcher (authorize + csrfGate +
// the route tables + the handler) with an in-memory KV fake (the
// pipelines-api.test.mjs makeFakeKV fixture) and an in-memory
// Artifacts fake. No mock.module, no source grep.
//
// Outbound transport seam: a recorder installed as globalThis.fetch
// (the presigned-transfers.test.mjs makeTransport/withTransport
// idiom — save/restore in `finally`) captures the ONE delivery
// frame. In-process ctx (the land-waituntil.test.mjs shape)
// captures the waitUntil promise so the fire-and-forget leg is
// observable.
//
// Groups (each defends an observable contract):
//   1. Validation refusals — commit RE, closed body schema, url
//      validation (scheme/userinfo/port/host-charset/length),
//      the private-net class (every literal encoding). Each
//      refusal mints ZERO transport frames.
//   2. HMAC verify with a test key — the captured frame's
//      x-nextgit-signature equals sha256=<hex> over the frame's
//      OWN body bytes (independently computed via node:crypto,
//      re-derived, never a fixture constant); tamper control:
//      HMAC over a MUTATED body does NOT match.
//   3. No-credential body assertion (the egress law) — the
//      frame's header set is EXACTLY {content-type,
//      x-nextgit-signature}; the body parses to exactly
//      {commit, status, checks}; no secret-class material.
//   4. Delivery-record legs — the notify appends to the
//      pipeline's deliveries[] (readable via GET /pipelines);
//      a second notify appends; a pre-feature record serves
//      deliveries: [] (the typed-absent path); the row carries
//      the seven e17 keys PLUS deliveries (8 keys); a KV put
//      that throws still yields the 200 (best-effort record).
//   4g. Healed gate postures — bare /pipelines/<sha> without /notify
//      -> 404 (never an alias, zero frames); an unknown commit is
//      never written (GET /landings stays 404 on both sides); the
//      delivery fetch carries redirect:'manual' and a 3xx is a failed
//      delivery (never followed); fd/fc-prefixed public hosts are not
//      over-blocked.
//   5. Fail-honest with no key — env WITHOUT the key, with "",
//      and with a short key (three legs) -> 503 notify-unavailable,
//      ZERO transport frames, NO delivery record appended.
//   6. Preconditions + registration + rate — deny mode 401 before
//      any read; cookie-carrying POST without x-csrf-token -> 403
//      csrf-required; GET /pipelines/<sha>/notify -> 405 (known
//      dynamic prefix, wrong method); a nonexistent commit -> 200
//      with status:"not-recorded" (honest-unknown, never a 404
//      oracle); route-table pin (found by prefix+method, NOT
//      positionally); ROUTE_RATE_LIMITS["/pipelines:write"] =
//      20/60s; the 21st call from one caller -> 429; the read
//      budget "/pipelines" unchanged at 60/60s.
//   7. waitUntil posture — exactly ONE waitUntil call per notify;
//      the delivery frame arrived via the captured promise (the
//      transport was called from within the waitUntil promise —
//      proving fire-and-forget: the 200 response is returned
//      before the delivery promise settles).
import { createHmac } from "node:crypto";
import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);
const ROW_KEYS = ["id", "repos", "at", "checks", "results", "status", "attestation", "deliveries"];
const STATUS_SET = new Set(["passed", "not-recorded", "failed"]);
const KEY = "k".repeat(32); // the test HMAC key (>= 32 chars)

// ---------------------------------------------------------------------------
// In-memory KV fake with instrumented get/put counters (the
// pipelines-api.test.mjs artifactsProbe idiom).
// ---------------------------------------------------------------------------
function makeFakeKV({ throwOnPut = false } = {}) {
  const store = new Map();
  const counters = { get: 0, put: 0 };
  return {
    store,
    counters,
    get: async (k, type) => {
      counters.get++;
      const v = store.get(k);
      // Real Workers KV returns null on a miss (never undefined) — model that,
      // so `=== null` guards in the worker's read paths are exercised honestly.
      if (v === undefined) return null;
      if (type === "json") { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    put: async (k, v) => {
      counters.put++;
      if (throwOnPut) throw new Error("fixture: put must fail");
      store.set(k, String(v));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the pipelines-api.test.mjs fixture
// surface). The notify route is repo-state-free: every get/list
// THROWS so a stray repo read surfaces as a 500 the suite sees.
// ---------------------------------------------------------------------------
function makeArtifactsFake() {
  const api = {
    reads: 0,
    async get(_name) { api.reads++; throw new Error("ARTIFACTS.get must not be reached on the notify route"); },
    async list() { api.reads++; throw new Error("ARTIFACTS.list must not be reached on the notify route"); },
  };
  return api;
}
const ARTIFACTS = makeArtifactsFake();
const AI = { run: async () => null };

// Sentinel: the "no key" leg (group 5) needs the property ABSENT,
// not undefined — a destructuring default would fill undefined with KEY.
const NO_KEY = Symbol("no-key");
function envFor({ cache = makeFakeKV(), key = KEY, artifacts = ARTIFACTS } = {}) {
  const env = {
    ARTIFACTS: artifacts,
    LIVE: makeFakeKV(),
    CACHE: cache,
    ASSETS: { fetch: async () => new Response("") },
    AI,
    AUTH_MODE: "demo",
  };
  if (key !== NO_KEY) env.NOTIFY_WEBHOOK_KEY = key;
  return env;
}

let ipSeq = 0;
const nextIp = () => `10.9.0.${++ipSeq}`;

// In-process ctx (the land-waituntil.test.mjs shape): captures
// waitUntil promises so the notify's ctx.waitUntil delivery has
// a real, observable target.
const capturedWaitUntil = [];
const fakeCtx = {
  waitUntil(p) {
    capturedWaitUntil.push(p);
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

// ---------------------------------------------------------------------------
// Outbound transport seam (the presigned-transfers.test.mjs
// makeTransport/withTransport idiom): a recorder installed as
// globalThis.fetch captures the ONE delivery frame. console.log
// is captured alongside so the pipeline-notify-delivered /
// pipeline-notify-failed log lines are observable.
// ---------------------------------------------------------------------------
function makeTransport() {
  const frames = [];
  const transport = async (url, init = {}) => {
    const parsed = new URL(url);
    const headers = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v);
    }
    frames.push({
      method: (init.method ?? "GET").toUpperCase(),
      host: parsed.host,
      path: parsed.pathname,
      headers,
      body: init.body ?? null,
      signal: init.signal ?? null,
      redirect: init.redirect ?? null,
    });
    return new Response("{}", { status: 200 });
  };
  return { frames, transport };
}

async function withTransport(transport, fn) {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const logs = [];
  globalThis.fetch = transport;
  console.log = (...args) => { logs.push(args.map(String).join(" ")); };
  try {
    return { result: await fn(), logs };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

const drive = async (env, method, path, { body, ip, headers = {} } = {}) => {
  const h = { ...headers };
  if (ip) h["CF-Connecting-IP"] = ip;
  if (body !== undefined) h["content-type"] = "application/json";
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env, fakeCtx);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: parsed, text };
};

// ---------------------------------------------------------------------------
// Seeding helpers (the pipelines-api.test.mjs seedLanding shape).
// ---------------------------------------------------------------------------
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
function seedLanding(cache, sha, { results = ["pass"], repos = ["agent-1"], at = "2026-10-14T00:00:00.000Z", deliveries = null } = {}) {
  const record = {
    landed: { at, repos },
    evidence: {
      repos,
      checks: ["merged-sha-equals-tested-sha"],
      results,
    },
    attestation: { status: "signed" },
  };
  if (deliveries !== null) record.deliveries = deliveries;
  cache.store.set(`landing:${sha}`, JSON.stringify(record));
}
function seedRegistry(cache, entries) {
  cache.store.set("landing-registry", JSON.stringify(entries));
}

// A single notify under the transport recorder: drives the REAL
// dispatcher, captures the delivery frame, and returns everything
// a group needs. `withWaitUntil` drains the captured waitUntil
// promises so the delivery settles inside the observation window.
async function notify(env, sha, url, { ip = nextIp(), headers = {} } = {}) {
  const { frames, transport } = makeTransport();
  const before = capturedWaitUntil.length;
  const { result, logs } = await withTransport(transport, async () => {
    const res = await drive(env, "POST", `/pipelines/${sha}/notify`, { body: { url }, ip, headers });
    // Fire-and-forget observation: drain the waitUntil promise
    // the handler registered so the delivery frame settles.
    const pending = capturedWaitUntil.slice(before);
    await Promise.all(pending);
    return res;
  });
  return { res: result, frames, logs };
}

// ===========================================================================
// Group 1 — Validation refusals (each mints ZERO transport frames).
// ===========================================================================
{
  const env = envFor();
  const cases = [
    ["not-a-sha (commit RE)", `/pipelines/not-a-sha/notify`, { url: "https://ci.example.tld/hook" }],
    ["missing url (closed schema)", `/pipelines/${SHA}/notify`, {}],
    ["unknown extra field (closed schema)", `/pipelines/${SHA}/notify`, { url: "https://ci.example.tld/hook", extra: 1 }],
    ["non-JSON body", `/pipelines/${SHA}/notify`, "not-json{{{"],
    ["http:// scheme", `/pipelines/${SHA}/notify`, { url: "http://ci.example.tld/hook" }],
    ["userinfo", `/pipelines/${SHA}/notify`, { url: "https://user:pass@ci.example.tld/hook" }],
    ["port", `/pipelines/${SHA}/notify`, { url: "https://ci.example.tld:8443/hook" }],
    ["private-net 10.0.0.1", `/pipelines/${SHA}/notify`, { url: "https://10.0.0.1/hook" }],
    ["private-net 192.168.1.1", `/pipelines/${SHA}/notify`, { url: "https://192.168.1.1/hook" }],
    ["loopback 127.0.0.1", `/pipelines/${SHA}/notify`, { url: "https://127.0.0.1/hook" }],
    ["localhost", `/pipelines/${SHA}/notify`, { url: "https://localhost/hook" }],
    ["metadata 169.254.169.254", `/pipelines/${SHA}/notify`, { url: "https://169.254.169.254/latest/meta-data" }],
    ["CGNAT 100.64.0.1", `/pipelines/${SHA}/notify`, { url: "https://100.64.0.1/hook" }],
    ["benchmark 198.18.0.1", `/pipelines/${SHA}/notify`, { url: "https://198.18.0.1/hook" }],
    ["multicast 224.0.0.1", `/pipelines/${SHA}/notify`, { url: "https://224.0.0.1/hook" }],
    ["hex-encoded v4 0x7f.1", `/pipelines/${SHA}/notify`, { url: "https://0x7f.1/hook" }],
    ["bracketed v6 [::1]", `/pipelines/${SHA}/notify`, { url: "https://[::1]/hook" }],
    ["2100-char URL", `/pipelines/${SHA}/notify`, { url: `https://${"h".repeat(2000)}.example.tld/${"x".repeat(100)}` }],
    ["non-string url", `/pipelines/${SHA}/notify`, { url: 123 }],
  ];
  for (const [name, path, body] of cases) {
    const { frames, transport } = makeTransport();
    const { result } = await withTransport(transport, () => drive(env, "POST", path, { body }));
    check(`1 ${name} → 400`, result.status === 400 && result.body?.error === "bad-request", `${result.status} ${J(result.body)}`);
    check(`1 ${name} mints ZERO transport frames`, frames.length === 0, `${frames.length} frames`);
  }
  // The 400 detail names the violation CLASS and never echoes the URL back (NFR-3).
  const leakEnv = envFor();
  const { result: leakResult } = await withTransport(makeTransport().transport, () =>
    drive(leakEnv, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://10.0.0.1/leak?x=secret" } }));
  const detail = String(leakResult.body?.detail ?? "");
  check("1 400 detail names the violation class, never echoes the URL", leakResult.status === 400 && !detail.includes("10.0.0.1") && !detail.includes("leak"), `detail=${J(detail)}`);
}

// ===========================================================================
// Group 2 — HMAC verify with a test key.
// ===========================================================================
{
  const cache = makeFakeKV();
  seedLanding(cache, SHA, { results: ["pass"] });
  const env = envFor({ cache });
  const { res, frames, logs } = await notify(env, SHA, "https://ci.example.tld/hook");
  check("2 valid notify → 200 {ok:true, commit, delivery:{status:'attempted'}}",
    res.status === 200 && res.body?.ok === true && res.body?.commit === SHA && res.body?.delivery?.status === "attempted",
    `${res.status} ${J(res.body)}`);
  check("2 exactly ONE transport frame (ONE delivery attempt)", frames.length === 1, `${frames.length} frames`);
  const frame = frames[0];
  const frameBody = String(frame.body ?? "");
  const expectedSig = `sha256=${createHmac("sha256", KEY).update(frameBody).digest("hex")}`;
  check("2 the frame's x-nextgit-signature equals the independent HMAC-SHA256 over the frame's OWN body bytes",
    frame.headers["x-nextgit-signature"] === expectedSig,
    `got ${J(frame.headers["x-nextgit-signature"])} want ${J(expectedSig)}`);
  check("2 the signature carries the sha256= prefix",
    typeof frame.headers["x-nextgit-signature"] === "string" && frame.headers["x-nextgit-signature"].startsWith("sha256="),
    J(frame.headers["x-nextgit-signature"]));
  const parsed = JSON.parse(frameBody);
  check("2 the frame body JSON-parses to exactly {commit, status, checks}",
    JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(["checks", "commit", "status"]) &&
    parsed.commit === SHA && STATUS_SET.has(parsed.status) && Array.isArray(parsed.checks),
    J(parsed));
  check("2 the status is the honest pipeline status (passed from the pass ledger)",
    parsed.status === "passed", `got ${J(parsed.status)}`);
  // Tamper control: HMAC over a MUTATED body does NOT match the sent signature.
  const mutated = JSON.stringify({ ...parsed, status: "failed" });
  const mutatedSig = `sha256=${createHmac("sha256", KEY).update(mutated).digest("hex")}`;
  check("2 tamper control: HMAC over a MUTATED body does NOT match the sent signature",
    mutatedSig !== expectedSig, "mutated HMAC unexpectedly matched");
  check("2 the delivered log line is content-free ({commit, status})",
    logs.some((l) => l.startsWith("pipeline-notify-delivered ") && l.includes(SHA)),
    J(logs));
}

// ===========================================================================
// Group 3 — No-credential body assertion (the egress law).
// ===========================================================================
{
  const cache = makeFakeKV();
  // Seed a canary into the landing record's UNRELATED fields — it must
  // never appear in the delivery frame.
  cache.store.set(`landing:${SHA2}`, JSON.stringify({
    landed: { at: "2026-10-14T00:00:00.000Z", repos: ["agent-1"] },
    evidence: { repos: ["agent-1"], checks: ["merged-sha-equals-tested-sha"], results: ["pass"] },
    attestation: { status: "signed" },
    canary: "art_v1_SUPERSECRETTOKENVALUE",
  }));
  seedRegistry(cache, [{ commit: SHA2, at: "2026-10-14T00:00:00.000Z" }]);
  const env = envFor({ cache });
  const { res, frames } = await notify(env, SHA2, "https://ci.example.tld/hook");
  const frame = frames[0];
  const headerNames = Object.keys(frame.headers).sort();
  check("3 the frame's header set is EXACTLY {content-type, x-nextgit-signature}",
    JSON.stringify(headerNames) === JSON.stringify(["content-type", "x-nextgit-signature"]),
    J(headerNames));
  const forbidden = ["authorization", "bearer", "x-api-key", "cookie"];
  check("3 no authorization/bearer/x-api-key/cookie header (case-insensitive)",
    forbidden.every((h) => !(h in frame.headers)), J(frame.headers));
  const frameBody = String(frame.body ?? "");
  check("3 the body contains no art_v1_ / Bearer / NOTIFY_WEBHOOK_KEY",
    !frameBody.includes("art_v1_") && !frameBody.includes("Bearer") && !frameBody.includes("NOTIFY_WEBHOOK_KEY"),
    frameBody);
  const parsed = JSON.parse(frameBody);
  check("3 the parsed body has exactly the three keys {commit,status,checks}",
    JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(["checks", "commit", "status"]), J(parsed));
  check("3 the canary planted in the landing record does not appear in the frame",
    !frameBody.includes("SUPERSECRETTOKENVALUE"), frameBody);
  check("3 the frame targets the caller-supplied URL verbatim (host + path)",
    frame.host === "ci.example.tld" && frame.path === "/hook" && frame.method === "POST",
    `${frame.method} ${frame.host}${frame.path}`);
  check("3 the notify succeeded (200)", res.status === 200, `${res.status} ${J(res.body)}`);
}

// ===========================================================================
// Group 4 — Delivery-record legs.
// ===========================================================================
{
  // 4a: notify against a seeded landing:<sha> -> GET /pipelines?base=demo
  // row carries deliveries with exactly one entry.
  const cache = makeFakeKV();
  seedLanding(cache, SHA, { results: ["pass"] });
  seedRegistry(cache, [{ commit: SHA, at: "2026-10-14T00:00:00.000Z" }]);
  const env = envFor({ cache });
  const { res: res4a, frames: frames4a } = await notify(env, SHA, "https://ci.example.tld/hook");
  check("4a notify → 200 with ONE frame", res4a.status === 200 && frames4a.length === 1, `${res4a.status} ${frames4a.length}f`);
  const list = await drive(env, "GET", "/pipelines?base=demo");
  const row = list.body?.pipelines?.[0];
  check("4a the GET /pipelines row carries deliveries with exactly one entry",
    Array.isArray(row?.deliveries) && row.deliveries.length === 1, J(row?.deliveries));
  const entry = row?.deliveries?.[0];
  check("4a the entry is {at (server-set ISO-8601), status:'attempted', url}",
    entry && typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at)) &&
    entry.status === "attempted" && entry.url === "https://ci.example.tld/hook",
    J(entry));
  // 4b: a second notify appends (two entries).
  await notify(env, SHA, "https://ci2.example.tld/hook2");
  const list2 = await drive(env, "GET", "/pipelines?base=demo");
  const row2 = list2.body?.pipelines?.[0];
  check("4b a second notify appends (two entries, append order)",
    row2?.deliveries?.length === 2 &&
    row2.deliveries[0].url === "https://ci.example.tld/hook" &&
    row2.deliveries[1].url === "https://ci2.example.tld/hook2",
    J(row2?.deliveries));
  // 4c: a pipeline with no deliveries serves deliveries: [] (typed-absent).
  const cache3 = makeFakeKV();
  seedLanding(cache3, SHA2, { results: ["fail"] }); // a pre-feature record: no deliveries key
  seedRegistry(cache3, [{ commit: SHA2, at: "2026-10-14T00:00:00.000Z" }]);
  const env3 = envFor({ cache: cache3 });
  const list3 = await drive(env3, "GET", "/pipelines?base=demo");
  const row3 = list3.body?.pipelines?.[0];
  check("4c a pre-feature record serves deliveries: [] (the typed-absent path)",
    Array.isArray(row3?.deliveries) && row3.deliveries.length === 0, J(row3?.deliveries));
  // 4d: the row carries the seven e17 keys PLUS deliveries (8 keys — additive-only).
  check("4d the row carries the seven e17 keys PLUS deliveries (8 keys total)",
    JSON.stringify(Object.keys(row).sort()) === JSON.stringify(ROW_KEYS.slice().sort()),
    J(Object.keys(row).sort()));
  // 4e: a KV fake whose put throws still yields the 200 (best-effort record write).
  const cache4 = makeFakeKV({ throwOnPut: true });
  seedLanding(cache4, SHA, { results: ["pass"] });
  const env4 = envFor({ cache: cache4 });
  const { res: res4, frames: frames4, logs: logs4 } = await notify(env4, SHA, "https://ci.example.tld/hook");
  check("4e a KV put that throws still yields the 200 (best-effort record write, never a 500)",
    res4.status === 200 && frames4.length === 1, `${res4.status} ${J(res4.body)}`);
  // 4f: the failed record write logs delivery-record-write-failed (captured logs, non-tautological).
  check("4f the failed record write logs delivery-record-write-failed",
    Array.isArray(logs4) && logs4.some((l) => l.startsWith("delivery-record-write-failed ")), J(logs4));
}

// ===========================================================================
// Group 4g — Wave-20 gate-heal postures: the /notify suffix is REQUIRED,
// an unknown commit is never written to, redirects are never followed, and
// fc/fd-prefixed public hosts are not over-blocked.
// ===========================================================================
{
  // 4g-a: the bare path is not an alias for the notify route.
  const cA = makeFakeKV();
  seedLanding(cA, SHA, { results: ["pass"] });
  const envA = envFor({ cache: cA });
  const ta = makeTransport();
  const { result: aliasRes } = await withTransport(ta.transport, () =>
    drive(envA, "POST", `/pipelines/${SHA}`, { body: { url: "https://ci.example.tld/hook" } }));
  check("4g-a POST /pipelines/<sha> without /notify → 404 (never a guess)",
    aliasRes.status === 404 && aliasRes.body?.error === "not-found", `${aliasRes.status} ${J(aliasRes.body)}`);
  check("4g-a the alias refusal mints ZERO transport frames", ta.frames.length === 0, `${ta.frames.length} frames`);
  // 4g-b: a notify for a never-landed commit writes NO record (no forge, no 404 flip).
  const cB = makeFakeKV();
  const envB = envFor({ cache: cB });
  const before = await drive(envB, "GET", `/landings/${SHA2}`);
  const { res: unknownRes, frames: unknownFrames } = await notify(envB, SHA2, "https://ci.example.tld/hook");
  const after = await drive(envB, "GET", `/landings/${SHA2}`);
  const unknownBody = JSON.parse(String(unknownFrames[0]?.body ?? "{}"));
  check("4g-b an unknown commit → 200 carrying frame status:'not-recorded'",
    unknownRes.status === 200 && unknownBody.status === "not-recorded", `${unknownRes.status} ${J(unknownBody)}`);
  check("4g-b notify never fabricates a landing record (GET /landings stays 404 both sides)",
    before.status === 404 && after.status === 404, `${before.status} ${J(before.body)} -> ${after.status} ${J(after.body)}`);
  // 4g-c: the delivery fetch asks for redirect:'manual'; a 3xx is a FAILED delivery.
  const cC = makeFakeKV();
  seedLanding(cC, SHA, { results: ["pass"] });
  const envC = envFor({ cache: cC });
  const rc = makeTransport();
  const t307 = async (url, init = {}) => {
    await rc.transport(url, init);
    return new Response("", { status: 307, headers: { location: "http://169.254.169.254/" } });
  };
  const beforeWU = capturedWaitUntil.length;
  const { logs: redirLogs } = await withTransport(t307, async () => {
    const res = await drive(envC, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" } });
    // Drain INSIDE the capture window so the delivery's log line lands in redirLogs.
    await Promise.all(capturedWaitUntil.slice(beforeWU));
    return res;
  });
  check("4g-c the fetch is called with redirect:'manual'", rc.frames[0]?.redirect === "manual", J(rc.frames[0]?.redirect));
  check("4g-c a 3xx response is a FAILED delivery (never followed), logged content-free",
    Array.isArray(redirLogs) && redirLogs.some((l) => l.startsWith("pipeline-notify-failed ") && l.includes("redirect")), J(redirLogs));
  // 4g-d: a public host beginning fd/fc is accepted (no label-prefix over-match).
  const cD = makeFakeKV();
  seedLanding(cD, SHA, { results: ["pass"] });
  const envD = envFor({ cache: cD });
  const { res: fdicRes } = await notify(envD, SHA, "https://fdic.gov/hook");
  check("4g-d a public host beginning fd/fc is accepted (guard has no over-match)",
    fdicRes.status === 200, `${fdicRes.status} ${J(fdicRes.body)}`);
}

// ===========================================================================
// Group 5 — Fail-honest with no key (three legs).
// ===========================================================================
{
  const legs = [
    ["env WITHOUT NOTIFY_WEBHOOK_KEY", NO_KEY],
    ["env with empty-string key", ""],
    ["env with a 10-char short key", "short-key"],
  ];
  for (const [name, key] of legs) {
    const cache = makeFakeKV();
    seedLanding(cache, SHA, { results: ["pass"] });
    seedRegistry(cache, [{ commit: SHA, at: "2026-10-14T00:00:00.000Z" }]);
    const env = envFor({ cache, key });
    const { res, frames } = await notify(env, SHA, "https://ci.example.tld/hook");
    check(`5 ${name} → 503 {ok:false,error:'notify-unavailable'}`,
      res.status === 503 && res.body?.ok === false && res.body?.error === "notify-unavailable",
      `${res.status} ${J(res.body)}`);
    check(`5 ${name} mints ZERO transport frames (never unsigned, never a delivery attempt)`,
      frames.length === 0, `${frames.length} frames`);
    // NO delivery record appended: the KV read pattern for the record write
    // never fires — the landing:<sha> record is untouched (no deliveries key).
    const raw = cache.store.get(`landing:${SHA}`);
    const record = raw ? JSON.parse(raw) : {};
    check(`5 ${name} appends NO delivery record`, record.deliveries === undefined, J(record.deliveries));
  }
}

// ===========================================================================
// Group 6 — Preconditions + registration + rate.
// ===========================================================================
{
  // 6a: deny mode (AUTH_MODE: undefined) -> 401 before any read.
  const cache = makeFakeKV();
  const env = envFor({ cache, key: KEY });
  env.AUTH_MODE = undefined;
  const deny = await drive(env, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" } });
  check("6a deny mode → 401 before any read", deny.status === 401, `${deny.status} ${J(deny.body)}`);
  check("6a deny mode performs ZERO KV reads on the landing record",
    cache.counters.get === 0, `get=${cache.counters.get}`);
  // 6b: a cookie-carrying POST without x-csrf-token -> 403 csrf-required
  // (the dispatcher's dynamic-POST branch).
  const env2 = envFor({ cache: makeFakeKV() });
  const csrf = await drive(env2, "POST", `/pipelines/${SHA}/notify`, {
    body: { url: "https://ci.example.tld/hook" },
    headers: { Cookie: "identity=op" },
  });
  check("6b cookie-carrying POST without x-csrf-token → 403 csrf-required",
    csrf.status === 403 && csrf.body?.error === "csrf-required", `${csrf.status} ${J(csrf.body)}`);
  // 6c: GET /pipelines/<sha>/notify -> 405 (known dynamic prefix, wrong method).
  const env3 = envFor({ cache: makeFakeKV() });
  const method = await drive(env3, "GET", `/pipelines/${SHA}/notify`);
  check("6c GET /pipelines/<sha>/notify → 405 (the API-boundary method law)",
    method.status === 405 && method.body?.error === "method-not-allowed", `${method.status} ${J(method.body)}`);
  // 6d: a valid body against a nonexistent commit -> 200 with status:"not-recorded"
  // (honest-unknown, never a 404 oracle).
  const env4 = envFor({ cache: makeFakeKV() });
  const missing = await notify(env4, "c".repeat(40), "https://ci.example.tld/hook");
  check("6d a nonexistent commit → 200 with status:'not-recorded' (honest-unknown, never a 404)",
    missing.res.status === 200 && missing.frames.length === 1 &&
    JSON.parse(String(missing.frames[0].body)).status === "not-recorded",
    `${missing.res.status} ${J(missing.res.body)} ${J(missing.frames[0]?.body)}`);
  // 6e: route-table pin — DYNAMIC_ROUTES carries the /pipelines/ POST write
  // entry (found by prefix+method, NOT positionally).
  const entry = DYNAMIC_ROUTES.find((r) => r.prefix === "/pipelines/" && r.method === "POST");
  check("6e DYNAMIC_ROUTES carries the /pipelines/ POST write entry (by prefix+method, not positionally)",
    entry !== undefined && entry.action === "write", J(entry));
  // 6f: ROUTE_RATE_LIMITS["/pipelines:write"] = 20/60s; the read budget stays 60/60s.
  const w = ROUTE_RATE_LIMITS["/pipelines:write"];
  const r = ROUTE_RATE_LIMITS["/pipelines"];
  check("6f ROUTE_RATE_LIMITS['/pipelines:write'] = 20/60s",
    w?.limit === 20 && w?.windowMs === 60_000, J(w));
  check("6f ROUTE_RATE_LIMITS['/pipelines'] (read) unchanged at 60/60s",
    r?.limit === 60 && r?.windowMs === 60_000, J(r));
  // 6g: the 21st call from one caller -> 429 (the new row is reachable).
  // All drives ride the transport seam and drain inside the capture window —
  // the handler's fire-and-forget delivery must never hit the real network
  // (round-2 gate finding: the unwrapped loop leaked 21 real egress POSTs).
  const env5 = envFor({ cache: makeFakeKV() });
  const callerIp = "10.9.9.9";
  const t6g = makeTransport();
  const drain = async (fn) => {
    const { result } = await withTransport(t6g.transport, async () => {
      const r = await fn();
      await Promise.all(capturedWaitUntil.splice(0));
      return r;
    });
    return result;
  };
  let allowed = 0;
  for (let i = 0; i < 20; i++) {
    const res = await drain(() => drive(env5, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" }, ip: callerIp }));
    if (res.status === 200) allowed++;
  }
  const twentyFirst = await drain(() => drive(env5, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" }, ip: callerIp }));
  check("6g the 21st notify from one caller → 429 (the /pipelines:write row is reachable)",
    allowed === 20 && twentyFirst.status === 429 && twentyFirst.body?.error === "rate-limited",
    `allowed=${allowed} 21st=${twentyFirst.status} ${J(twentyFirst.body)}`);
  // A different caller is unaffected (per-caller window).
  const other = await drain(() => drive(env5, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" }, ip: nextIp() }));
  check("6g a different caller is unaffected by the first caller's window (per-caller isolation)",
    other.status === 200, `${other.status} ${J(other.body)}`);
  // 6h: POST /pipelines (bare) — "/pipelines" does NOT start with the
  // "/pipelines/" prefix, so the dynamic loop never claims it; the
  // knownPath boundary (GET /pipelines is a registered static path)
  // answers 405 method-not-allowed (the API-boundary method law —
  // the correct behavior: the route family exists, the bare verb
  // is not a registered POST).
  const bare = await drive(env5, "POST", "/pipelines", { body: { url: "https://ci.example.tld/hook" } });
  check("6h POST /pipelines (bare) → 405 (the API-boundary method law)",
    bare.status === 405 && bare.body?.error === "method-not-allowed", `${bare.status} ${J(bare.body)}`);
}

// ===========================================================================
// Group 7 — waitUntil posture (fire-and-forget).
// ===========================================================================
{
  const cache = makeFakeKV();
  seedLanding(cache, SHA, { results: ["pass"] });
  const env = envFor({ cache });
  const before = capturedWaitUntil.length;
  // Fire the notify WITHOUT draining the waitUntil promise: prove the 200
  // returns BEFORE the delivery promise settles (the deferred-settled flag).
  const { frames, transport } = makeTransport();
  let deliverySettled = false;
  const slowTransport = async (url, init = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    deliverySettled = true;
    return transport(url, init);
  };
  let res;
  let beforeOk = false;
  await withTransport(slowTransport, async () => {
    res = await drive(env, "POST", `/pipelines/${SHA}/notify`, { body: { url: "https://ci.example.tld/hook" } });
    // At this point the 200 has been returned; the delivery (still in
    // flight) must NOT have settled yet. Captured here (console.log is
    // mocked inside withTransport) and asserted AFTER the transport is
    // restored — the check itself must print to the real console.
    beforeOk = res.status === 200 && deliverySettled === false;
    const pending = capturedWaitUntil.slice(before);
    await Promise.all(pending);
  });
  check("7 the 200 response is returned BEFORE the delivery promise settles (fire-and-forget)",
    beforeOk, `res=${res?.status} settled=${deliverySettled}`);
  check("7 the delivery settled AFTER the response (via the captured waitUntil promise)",
    deliverySettled === true && frames.length === 1, `settled=${deliverySettled} frames=${frames.length}`);
  check("7 exactly ONE waitUntil call per notify",
    capturedWaitUntil.length - before === 1, `${capturedWaitUntil.length - before} waitUntil calls`);
  // The delivery frame was produced by the waitUntil promise (the transport
  // was called from within it) — proven by the settled flag ordering above.
  check("7 the delivery frame targets the validated URL",
    frames[0]?.host === "ci.example.tld" && frames[0]?.method === "POST",
    J(frames[0] && { host: frames[0].host, method: frames[0].method }));
}

// Route-table pin: ROUTES registers GET /pipelines as a read (the e17
// static entry — the exact-match loop runs first, so the read route never
// falls to the notify prefix).
check("pin: ROUTES registers GET /pipelines as a read (static entry wins the exact-match loop)",
  ROUTES.some((r) => r.path === "/pipelines" && r.method === "GET" && r.action === "read"));

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
