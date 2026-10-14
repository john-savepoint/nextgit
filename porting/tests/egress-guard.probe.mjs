#!/usr/bin/env node
// egress-guard.probe.mjs — LIVE probe for the Credential/Egress Guard (AD-9 E8).
// Read-only: hits the deployed platform worker with only GET requests and
// non-mutating POSTs (malformed bodies, unknown repos), inducing each failure
// path without landing. Scans every response BODY for credential material and
// shell snippets.
//
// Exit contract: exit 0 = no credential material found AND self-test caught
// the injected token; exit 1 = a real leak detected.
//
// Run: node porting/tests/egress-guard.probe.mjs

const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-egress-guard-probe/1.0";

// ---------------------------------------------------------------------------
// Scanner: credential + shell-snippet patterns tested against raw response text.
// ---------------------------------------------------------------------------

// A sample credential token shape the worker masks in display but never emits
// in responses. The self-test injects one of these synthetic values and asserts
// the scanner detects it — proving the scanner is not a no-op.
const INJECTED_TOKEN = "art_v1_" + "a".repeat(40) + "?expires=1899999999";
const INJECTED_BEARER = `Bearer ${"x".repeat(43)}`;
const INJECTED_KEYLINE = `SUPER_SECRET_KEY=${"k".repeat(32)}`;

// Credential patterns (regex on raw response text):
const CREDENTIAL_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/]{20,}/,          // bearer tokens
  /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/]{20,}/i, // auth header in body
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._~+/]{20,}/i, // api keys
  /CF_Artifact_Token_[A-Za-z0-9]+/i,        // artifacts token env var shape
  /[A-Za-z0-9]{40}\.[A-Za-z0-9]{40}/,       // git-style token.split
  /art_v1_[A-Za-z0-9_.?]+/,                 // artifacts repo token prefix
];

// Shell-snippet patterns (defense: error bodies must never carry runnable shell):
const SHELL_PATTERNS = [
  /git\s+(push|clone|fetch|pull)\s+https?:\/\//,
  /GIT_SSH_COMMAND=/,
  /GIT_CONFIG_/,
];

/** Returns matched substrings, or null if clean. */
function scanBody(text) {
  if (!text) return null;
  const hits = [];
  for (const re of CREDENTIAL_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ kind: "credential", pattern: re.source, hit: m[0] });
  }
  for (const re of SHELL_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ kind: "shell", pattern: re.source, hit: m[0] });
  }
  return hits.length ? hits : null;
}

// ---------------------------------------------------------------------------
// HTTP helpers

const headers = { "user-agent": UA, "content-type": "application/json" };
// Keep-alive hazard (2026-10-14): undici pools a keep-alive socket to the edge;
// after heavy churn the pooled socket goes half-closed and EVERY retry reuses
// it (3x30s hangs, retry-immune). Close the connection per request — the probe
// is low-volume and the fresh-dial cost is negligible (curl behaves this way
// and never stalled the same window).

// Transport hardening (2026-10-14, the observed class): a single WSL->edge
// connect stall reds the whole probe because one `getRaw` timeout lands in
// the top-level catch as "PROBE ERROR — TimeoutError". Retry the TRANSPORT
// (not the assertion): 3 attempts, 1.5s/3s backoff, 30s per attempt. A
// persistent stall still reds — but only after the bounded retries (5 x 30s
// max, the post-land connection-storm class), so a genuine outage is never
// masked. Mirrors the submission probe's jRetry.
async function getRaw(path, tries = 5) {
  for (let a = 1; ; a++) {
    try {
      const res = await fetch(`${PLATFORM}${path}`, { headers: { ...headers, connection: "close" }, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      return { status: res.status, text };
    } catch (e) {
      if (a >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
}

async function postRaw(path, body, tries = 5) {
  for (let a = 1; ; a++) {
    try {
      const res = await fetch(`${PLATFORM}${path}`, {
        method: "POST",
        headers: { ...headers, connection: "close" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { status: res.status, text };
    } catch (e) {
      if (a >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test: the scanner MUST detect an injected token in a synthetic body.
// ---------------------------------------------------------------------------

function selfTest() {
  const synthetic = JSON.stringify({
    ok: false,
    error: "push-failed",
    token: INJECTED_TOKEN,
    auth: INJECTED_BEARER,
    env: INJECTED_KEYLINE,
    shell: `git push https://example.com/repo.git`,
  });
  const hits = scanBody(synthetic);
  return hits && hits.length > 0;
}

// ---------------------------------------------------------------------------
// Main

let fails = 0;
const scan = (n, status, text) => {
  const hits = scanBody(text);
  const ok = !hits;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n} (HTTP ${status})${ok ? "" : ` — ${hits.map((h) => `${h.kind}:${h.pattern}`).join(", ")}`}`);
};

const selfTestPassed = selfTest();
if (!selfTestPassed) {
  fails++;
  console.log("FAIL  self-test: scanner did not detect injected credentials");
} else {
  console.log("PASS  self-test: scanner detected injected credentials");
}

console.log(`platform ${PLATFORM}\n`);

try {
  // --- GET success + failure paths ---

  const health = await getRaw("/health");
  scan("/health (200 success)", health.status, health.text);

  const ui = await getRaw("/");
  scan("/ (200 UI shell)", ui.status, ui.text);

  const proposalsOk = await getRaw("/proposals?base=demo");
  scan("/proposals?base=demo (200 success)", proposalsOk.status, proposalsOk.text);

  // bad base param: invalid repo name fails REPO_NAME_RE -> 400
  const proposalsBad = await getRaw("/proposals?base=demo%20bad!");
  scan("/proposals?base=<invalid> (400 bad base)", proposalsBad.status, proposalsBad.text);

  const changesOk = await getRaw("/changes?repo=agent-3&base=demo");
  scan("/changes?repo=agent-3 (200 success)", changesOk.status, changesOk.text);

  // unknown repo: env.ARTIFACTS.get throws -> catch-all 500 scrubbed
  const changesUnknown = await getRaw("/changes?repo=agent-999&base=demo");
  scan("/changes?repo=agent-999 (500 unknown repo)", changesUnknown.status, changesUnknown.text);

  // missing repo param -> 400
  const changesMissing = await getRaw("/changes?base=demo");
  scan("/changes (400 missing repo)", changesMissing.status, changesMissing.text);

  const mergeOk = await getRaw("/merge?base=demo&repos=agent-1");
  scan("/merge (200 success)", mergeOk.status, mergeOk.text);

  // missing repos -> 400
  const mergeMissing = await getRaw("/merge?base=demo");
  scan("/merge (400 missing repos)", mergeMissing.status, mergeMissing.text);

  // --- POST /land failure paths (non-mutating: malformed bodies, bad names) ---

  // malformed body (non-JSON) -> 400
  const landMalformed = await postRaw("/land", "not json");
  scan("/land (400 malformed body)", landMalformed.status, landMalformed.text);

  // bad repo name -> 400
  const landBadRepo = await postRaw("/land", { base: "demo", repos: ["bad repo!"], baseRef: "main", ref: "main" });
  scan("/land (400 bad repo name)", landBadRepo.status, landBadRepo.text);

  // repo not in allowlist -> 403
  const landNotAllowed = await postRaw("/land", { base: "demo", repos: ["evil-99"], baseRef: "main", ref: "main" });
  scan("/land (403 repo not allowed)", landNotAllowed.status, landNotAllowed.text);

  // empty repos -> 400
  const landEmpty = await postRaw("/land", { base: "demo", repos: [], baseRef: "main", ref: "main" });
  scan("/land (400 empty repos)", landEmpty.status, landEmpty.text);

  // --- /landings read paths ---

  // unknown commit (valid sha, not a landing) -> 404
  const landingsUnknown = await getRaw("/landings/" + "a".repeat(40));
  scan("/landings/<unknown-sha> (404 not-found)", landingsUnknown.status, landingsUnknown.text);

  // bad input (non-sha) -> 400
  const landingsBad = await getRaw("/landings/not-a-sha");
  scan("/landings/not-a-sha (400 bad-request)", landingsBad.status, landingsBad.text);

  // unknown route -> 404 JSON (contract boundary, not the asset layer)
  const unknownRoute = await getRaw("/nonexistent-route-404");
  scan("/nonexistent-route-404 (404 JSON)", unknownRoute.status, unknownRoute.text);

  const events = await getRaw("/events");
  scan("/events (200 success)", events.status, events.text);
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
}

console.log(fails === 0 ? "\nPASS — egress-guard probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
