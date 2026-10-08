#!/usr/bin/env node
// Contract test for GET /events (platform/CONTRACT.md "GET /events" section).
// Run: node porting/tests/events-contract.test.mjs   (exit 0 = pass)
//
// Read-only HTTP contract against the live worker — no mocks, no module mocks,
// no source grep. The KV-backed feed is unreachable from outside the worker,
// so this test pins the *observable* wire contract: the envelope shape, the
// 50-cap, the newest-first ordering, and the per-entry required fields.
//
// The live edge occasionally stalls WSL2 connects (measured ~7 transient
// timeouts/day), so fetchJson retries 3x before failing the gate — that is a
// transport concern, not a contract assertion.

const PLATFORM = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";
const MAX_EVENTS_CAP = 50; // platform/src/index.ts MAX_EVENTS=50 (platform/CONTRACT.md "GET /events")
const TIMEOUT_MS = 30_000;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) {
    fails++;
    console.error(`FAIL ${name}${detail ? " — " + detail : ""}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${name}${detail ? " — " + detail : ""}`);
  }
};

async function fetchJson(path) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${PLATFORM}${path}`, {
        headers: { "User-Agent": "nextgit-events-contract-test/1" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // non-JSON — the status check reports it
      }
      return { status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.log(`  (transient fetch failure on ${path} — attempt ${attempt}/3: ${err?.cause?.code ?? err?.message}; retrying)`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// 1. Envelope: ok=true, events is an array
// ---------------------------------------------------------------------------
const res = await fetchJson("/events");
check("GET /events → 200", res.status === 200, `status ${res.status}`);
check("GET /events → ok:true", res.body?.ok === true, JSON.stringify(res.body?.error ?? ""));
const events = Array.isArray(res.body?.events) ? res.body.events : null;
check("GET /events → events is array", events !== null, JSON.stringify(res.body?.events ?? null));

// ---------------------------------------------------------------------------
// 2. Cap: <= MAX_EVENTS entries
// ---------------------------------------------------------------------------
if (events !== null) {
  check(`feed cap <= ${MAX_EVENTS_CAP}`, events.length <= MAX_EVENTS_CAP, `len=${events.length}`);
} else {
  check(`feed cap <= ${MAX_EVENTS_CAP}`, false, "events is null");
}

// ---------------------------------------------------------------------------
// 3. Newest-first: non-increasing `at` (ISO-8601 fixed-width Z-suffixed UTC)
// ---------------------------------------------------------------------------
if (events !== null && events.length > 0) {
  let firstViolation = -1;
  for (let i = 1; i < events.length; i++) {
    if (String(events[i - 1].at) < String(events[i].at)) {
      firstViolation = i;
      break;
    }
  }
  check("events newest-first (non-increasing at)", firstViolation === -1, `first violation at index ${firstViolation}`);
}

// ---------------------------------------------------------------------------
// 4. Entry fields: every entry carries type and at (both strings)
// ---------------------------------------------------------------------------
if (events !== null) {
  const missing = events
    .map((x, i) => ({ i, type: typeof x?.type === "string", at: typeof x?.at === "string" }))
    .filter((r) => !r.type || !r.at);
  check("every event has type:string and at:string", missing.length === 0, JSON.stringify(missing.slice(0, 5)));
}

// ---------------------------------------------------------------------------
// 5. Evidence line
// ---------------------------------------------------------------------------
if (events !== null && events.length > 0 && fails === 0) {
  console.log(`PASS GET /events ok=true len=${events.length} newest=${events[0]?.at}`);
} else if (fails === 0) {
  console.log(`PASS GET /events ok=true len=${events?.length ?? 0} newest=empty`);
}

if (fails > 0) {
  process.exitCode = 1;
}
