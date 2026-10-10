#!/usr/bin/env node
// seven-route-surface.probe.mjs — LIVE sweep of the platform's seven core
// routes against platform/CONTRACT.md v2.4 (2026-10-09), route sections
// :9-161. Promotes the acceptance from the ephemeral `node -e` one-liner in
// the compile slice record (porting/compile/runs/compile-2026-10-06T13-31-51/
// slices/E11-verify.json → e11-verify-seven-route-surface.check_cmd) to a
// named, re-runnable file.
//
// Twelve legs (~30 assertions): seven success shapes (health, changes,
// proposals, merge, events, judge, land-safe-error) + four documented 4xx
// shapes (missing repo, missing repos, unknown setId, closed schema) + one
// envelope-law leg. Each assertion pins ONE documented shape element so drift
// (renamed key, changed enum, dropped error string, cap regression) fails
// loudly with a named FAIL line.
//
// Read-only discipline (STRIDE scoping, security-design-review applied to
// scope): every leg is a GET or a documented NON-mutating POST; no forks,
// pushes, or deletes; the /land leg sends only `{}` (validation rejects it
// pre-mutation — asserted via absence of a `landed` key); /judge is
// advisory-only per CONTRACT:147. No credentials: the live worker serves
// these routes under AUTH_MODE=demo. DoS-bounded: per-request timeouts +
// retry caps. Info-disclosure boundary: this probe asserts shapes only —
// secret-class value masking is deliberately NOT re-tested here (owned by the
// VERIFY-gate pair demo-verify.mjs check 6 + egress-guard.probe.mjs), so the
// probe cannot green-pass vacuously on a masking regression it never looked
// for.
//
// Re-runnable/idempotent; never mutates `demo` or `agent-1..5`, keeping the
// demo all-pending for the recording.
//
// Run: node porting/tests/seven-route-surface.probe.mjs (exit 0 = all seven routes + error shapes green)
// ENV: NEXTGIT_PLATFORM_URL or PLATFORM (both precedent env names honored)
// Exit: 0 green · 1 route-surface failure (any named FAIL) · 2 transport-unreachable
//       (all retries exhausted — a WSL2 edge-connect stall must never masquerade
//       as a shape regression, per the demo-verify.mjs:39 precedent)

const PLATFORM =
  process.env.NEXTGIT_PLATFORM_URL ??
  process.env.PLATFORM ??
  "https://nextgit-platform.john-b7d.workers.dev";

// The slice's own budget (compile slice check_cmd): 180s per attempt — the
// judge leg measured ~9s for a 2-repo judge, so this covers latency spikes.
const TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// one(path, init): fetch with AbortSignal.timeout(180_000); returns
// {status, body} with best-effort JSON parse (body stays null on non-JSON).
const one = async (path, init) => {
  const res = await fetch(`${PLATFORM}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

// get/post: 3-attempt retry with 1000 * 2^attempt ms backoff (the slice
// check_cmd pattern). Transport exhaustion (fetch throws after all retries)
// throws — the caller maps that to PROBE-UNREACHABLE + exit 2.
const get = async (path) => {
  let last;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await one(path);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
};

const post = async (path, body) => {
  let last;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await one(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
};

const isErr = (res, status) =>
  res.status === status &&
  res.body?.ok === false &&
  typeof res.body?.error === "string" &&
  res.body.error.length > 0;

try {
  // Leg 1 — GET /health → 200, ok===true, service==="nextgit-platform",
  // typeof namespace==="string" (CONTRACT:8-10).
  const health = await get("/health");
  check("health 200", health.status === 200, `status=${health.status}`);
  check("health ok===true", health.body?.ok === true, `ok=${health.body?.ok}`);
  check(
    "health service===\"nextgit-platform\"",
    health.body?.service === "nextgit-platform",
    `service=${health.body?.service}`,
  );
  check(
    "health typeof namespace===\"string\"",
    typeof health.body?.namespace === "string",
    `namespace=${health.body?.namespace}`,
  );

  // Leg 2 — GET /changes → 200 changeSet{base,head,stats,files[]}; stats
  // numeric {files,added,modified,removed,additions,deletions}; every
  // files[] row carries {path,status,additions,deletions} (CONTRACT:12-27).
  const chg = await get("/changes?repo=agent-1&base=demo&ref=main&baseRef=main");
  check("changes 200", chg.status === 200, `status=${chg.status}`);
  check("changes ok===true", chg.body?.ok === true, `ok=${chg.body?.ok}`);
  const cs = chg.body?.changeSet;
  check(
    "changes changeSet carries base/head/stats/files",
    !!cs &&
    typeof cs.base === "object" &&
    typeof cs.head === "object" &&
    typeof cs.stats === "object" &&
    Array.isArray(cs.files),
    `keys=${cs ? Object.keys(cs).join(",") : "missing"}`,
  );
  const statsNum =
    !!cs?.stats &&
    ["files", "added", "modified", "removed", "additions", "deletions"].every(
      (k) => typeof cs.stats[k] === "number",
    );
  check(
    "changes stats numeric {files,added,modified,removed,additions,deletions}",
    statsNum,
    `stats=${JSON.stringify(cs?.stats)}`,
  );
  const fileRowsOk =
    Array.isArray(cs?.files) &&
    cs.files.every(
      (f) =>
        typeof f?.path === "string" &&
        typeof f?.status === "string" &&
        typeof f?.additions === "number" &&
        typeof f?.deletions === "number",
    );
  check(
    "changes files[] rows carry {path,status,additions,deletions}",
    fileRowsOk,
    `n=${cs?.files?.length ?? "missing"}`,
  );

  // Leg 3 — GET /proposals → 200, ok===true, base.repo==="demo",
  // Array.isArray(proposals), Array.isArray(conflicts) (CONTRACT:36-46).
  const pr = await get("/proposals?base=demo");
  check("proposals 200", pr.status === 200, `status=${pr.status}`);
  check("proposals ok===true", pr.body?.ok === true, `ok=${pr.body?.ok}`);
  check(
    "proposals base.repo===\"demo\"",
    pr.body?.base?.repo === "demo",
    `base.repo=${pr.body?.base?.repo}`,
  );
  check(
    "proposals proposals[] is an array",
    Array.isArray(pr.body?.proposals),
    `type=${typeof pr.body?.proposals}`,
  );
  check(
    "proposals conflicts[] is an array",
    Array.isArray(pr.body?.conflicts),
    `type=${typeof pr.body?.conflicts}`,
  );

  // Leg 4 — GET /merge → 200, ok===true, merge.base.repo==="demo",
  // merge.status ∈ {"clean","conflict"}, Array.isArray(merge.files)
  // (CONTRACT:61-76).
  const mrg = await get("/merge?base=demo&repos=agent-3&ref=main&baseRef=main");
  check("merge 200", mrg.status === 200, `status=${mrg.status}`);
  check("merge ok===true", mrg.body?.ok === true, `ok=${mrg.body?.ok}`);
  check(
    "merge base.repo===\"demo\"",
    mrg.body?.merge?.base?.repo === "demo",
    `base.repo=${mrg.body?.merge?.base?.repo}`,
  );
  check(
    "merge status ∈ {clean,conflict}",
    mrg.body?.merge?.status === "clean" || mrg.body?.merge?.status === "conflict",
    `status=${mrg.body?.merge?.status}`,
  );
  check(
    "merge files[] is an array",
    Array.isArray(mrg.body?.merge?.files),
    `type=${typeof mrg.body?.merge?.files}`,
  );

  // Leg 5 — GET /events → 200, ok===true, events.length ≤ 50, `at`
  // non-increasing (newest-first), every event has string `type` and `at`
  // (CONTRACT:192-194).
  const ev = await get("/events");
  check("events 200", ev.status === 200, `status=${ev.status}`);
  check("events ok===true", ev.body?.ok === true, `ok=${ev.body?.ok}`);
  check(
    "events length ≤ 50 (cap)",
    Array.isArray(ev.body?.events) && ev.body.events.length <= 50,
    `n=${ev.body?.events?.length ?? "missing"}`,
  );
  const ats = (ev.body?.events ?? [])
    .map((e) => e?.at)
    .filter((a) => typeof a === "string");
  check(
    "events newest-first (at non-increasing)",
    ats.every((a, i) => i === 0 || a <= ats[i - 1]),
    `head=${JSON.stringify(ats.slice(0, 3))}`,
  );
  check(
    "events entries carry string type+at",
    (ev.body?.events ?? []).every(
      (e) => typeof e?.type === "string" && typeof e?.at === "string",
    ),
    `n=${ev.body?.events?.length ?? "missing"}`,
  );

  // Leg 6 — POST /judge with the NESTED contract body (setId +
  // target.{base,repos,refs}) → 200, ok===true, setId==="v1",
  // model==="@cf/cloudflare/clef", Array.isArray(judgments),
  // Array.isArray(skipped), every judgment carries `repo` (CONTRACT:145-179).
  const jd = await post("/judge", {
    setId: "v1",
    target: { base: "demo", repos: ["agent-1", "agent-2"], refs: ["main"] },
  });
  check("judge 200", jd.status === 200, `status=${jd.status}`);
  check("judge ok===true", jd.body?.ok === true, `ok=${jd.body?.ok}`);
  check(
    "judge setId===\"v1\"",
    jd.body?.setId === "v1",
    `setId=${jd.body?.setId}`,
  );
  check(
    "judge model===\"@cf/cloudflare/clef\"",
    jd.body?.model === "@cf/cloudflare/clef",
    `model=${jd.body?.model}`,
  );
  check(
    "judge judgments[] is an array",
    Array.isArray(jd.body?.judgments),
    `type=${typeof jd.body?.judgments}`,
  );
  check(
    "judge skipped[] is an array",
    Array.isArray(jd.body?.skipped),
    `type=${typeof jd.body?.skipped}`,
  );
  check(
    "judge judgments carry repo",
    (jd.body?.judgments ?? []).every((j) => typeof j?.repo === "string"),
    `n=${jd.body?.judgments?.length ?? "missing"}`,
  );

  // Leg 7 — POST /land body `{}` → 4xx (observed 400), ok===false, non-empty
  // string error, and NO `landed` key — the safe error path proves no
  // mutation happened (CONTRACT:78-133, validation-before-mutation).
  const land = await post("/land", {});
  check(
    "land {} → 4xx validation error",
    land.status >= 400 && land.status < 500,
    `status=${land.status}`,
  );
  check(
    "land {} error envelope (ok===false, non-empty string error)",
    isErr(land, land.status),
    `body=${JSON.stringify(land.body)}`,
  );
  check(
    "land {} carries no landed key (no mutation)",
    land.body?.landed === undefined,
    `landed=${JSON.stringify(land.body?.landed)}`,
  );

  // Leg 8 — GET /changes (no repo param) → 400, ok===false, string error
  // (CONTRACT:6; observed "repo parameter required").
  const c400 = await get("/changes");
  check(
    "changes (no repo) → 400 error envelope",
    isErr(c400, 400),
    `status=${c400.status} body=${JSON.stringify(c400.body)}`,
  );

  // Leg 9 — GET /merge?base=demo (no repos param) → 400, ok===false, string
  // error (CONTRACT:6; observed "repos parameter required").
  const m400 = await get("/merge?base=demo");
  check(
    "merge (no repos) → 400 error envelope",
    isErr(m400, 400),
    `status=${m400.status} body=${JSON.stringify(m400.body)}`,
  );

  // Leg 10 — POST /judge unknown setId → 400, error === "unknown-set" (exact
  // string, CONTRACT:156).
  const j400 = await post("/judge", {
    setId: "nope-v9",
    target: { base: "demo", repos: ["agent-1"], refs: ["main"] },
  });
  check(
    "judge unknown setId → 400 error===\"unknown-set\"",
    j400.status === 400 && j400.body?.error === "unknown-set",
    `status=${j400.status} error=${j400.body?.error}`,
  );

  // Leg 11 — POST /judge closed-schema (`state` field) → 400, error ===
  // "bad-request" (exact; CONTRACT:160).
  const j400b = await post("/judge", {
    setId: "v1",
    state: {},
    target: { base: "demo", repos: ["agent-1"], refs: ["main"] },
  });
  check(
    "judge closed schema (state) → 400 error===\"bad-request\"",
    j400b.status === 400 && j400b.body?.error === "bad-request",
    `status=${j400b.status} error=${j400b.body?.error}`,
  );

  // Leg 12 — Envelope law: every error response across legs 7-11 satisfies
  // ok===false && typeof error==="string" && error.length>0 (CONTRACT:6).
  const errResponses = [land, c400, m400, j400, j400b];
  check(
    "envelope law: all error responses satisfy ok===false + non-empty string error",
    errResponses.every((r) => isErr(r, r.status)),
    `checked=${errResponses.length}`,
  );
} catch (err) {
  // Transport exhaustion: a WSL2 edge-connect stall must never masquerade as
  // a shape regression (demo-verify.mjs:39 precedent).
  const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
  console.error(`PROBE-UNREACHABLE: ${cause}`);
  process.exit(2);
}

console.log(fails === 0 ? "\nPASS — seven-route-surface probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
