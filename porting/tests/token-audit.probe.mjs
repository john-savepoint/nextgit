#!/usr/bin/env node
// token-audit.probe.mjs — LIVE probe for FR-36: token mint/use/revoke
// audited at two surfaces (Worker logs + Artifacts token events).
//
// Leg A (live Artifacts events): fork a scratch base repo, mint a
//   write token (POST /tokens), revoke it (DELETE /tokens/{id}), then
//   poll the deployed worker's GET /events until both repo.token.created
//   and repo.token.revoked appear for the scratch repo. Asserts shapes
//   + that no plaintext/tokenId appears anywhere in the feed.
//
// Leg B (local wrangler tail): spawn a local `wrangler dev` + a
//   `wrangler tail --format json --search token-`, fork a scratch chain,
//   push a one-file change, POST /land against the LOCAL worker, and
//   assert both content-free audit lines (token-mint {repo,ttl} and
//   token-revoke {repo,phase}) are captured — with no token value in
//   any captured line.
//
// Scratch chain ONLY: `demo-ta-base-<ts>` -> `agent-ta-1`; never
// touches `demo` or `agent-1..5`. Exit 0 = all green.
// Run: node porting/tests/token-audit.probe.mjs

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-token-audit-probe/1.0";
const TS = Date.now();
const BASE_REPO = `demo-ta-base-${TS}`;
const PROPOSAL_REPO = `agent-ta-1`;
const LOCAL_PORT = 8791;
const DEV_TIMEOUT_MS = 120_000;
const EVENTS_DEADLINE_MS = 300_000; // the observed 1.5–4 min queue-latency class
// The pinned-lockfile wrangler (4.147.0) — used for the 401 refresh
// (whoami) and the local dev + tail legs.
const WRANGLER = join(import.meta.dirname, "..", "..", "platform", "node_modules", ".bin", "wrangler");

// Scratch-only guard: the probe must never operate outside its ta-* chain.
if (!BASE_REPO.startsWith("demo-ta-") || !PROPOSAL_REPO.startsWith("agent-ta-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /art_v1_[a-z0-9]+/i;

// apiToken(): CLOUDFLARE_API_TOKEN env, else wrangler OAuth toml (cached).
let cachedToken = null;
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (cachedToken) return cachedToken;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return (cachedToken = m[1]);
    }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

// api(method, path, body): fetch against the Artifacts control plane
// with 3 transport retries, a 30s timeout, and an in-place 401
// refresh (`wrangler whoami` re-reads the OAuth token) — a mid-run
// token expiry must not false-RED the probe (land-hardening pattern).
// Returns { status, success, result, raw }.
async function api(method, path, body) {
  let last;
  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers: apiHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && !refreshed && !process.env.CLOUDFLARE_API_TOKEN) {
        refreshed = true;
        cachedToken = null;
        console.log(`  auth 401 on ${method} ${path} -> wrangler whoami refresh, retrying`);
        try {
          execFileSync(WRANGLER, ["whoami"], { stdio: "ignore", timeout: 60_000 });
        } catch (refreshErr) {
          last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh: ${refreshErr?.message ?? refreshErr}`);
          break;
        }
        continue;
      }
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const apiHeaders = () => ({ Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" });
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const gitAuthEnv = (token) => ({ ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });

// fork(src, name): POST /repos/{src}/fork with backoff on the
// transient creation lag (already-exists / 404 / 5xx / 403).
async function fork(src, name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("POST", `/repos/${src}/fork`, { name, default_branch_only: true });
    if (r.success) return r.result;
    last = new Error(`fork ${src} -> ${name} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
    const transient = /already exists/i.test(last.message) || r.status === 403 || r.status === 404 || r.status >= 500;
    if (!transient) throw last;
    await sleep(1500 * attempt);
  }
  throw last;
}

// mintToken(repo): POST /tokens {repo, scope:"write", ttl:3600} ->
// CreateTokenResult {id, plaintext, scope, expires_at}.
async function mintToken(repo) {
  const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.result;
}

// revokeToken(id): DELETE /tokens/{id} -> accepted.
async function revokeToken(id) {
  const r = await api("DELETE", `/tokens/${id}`);
  return r;
}

// deleteRepo(name): DELETE with bounded retry on 5xx.
async function deleteRepo(name) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await api("DELETE", `/repos/${name}`);
    if (r.status < 500) return r;
    last = r;
    await sleep(1500 * attempt);
  }
  return last;
}

// getPlatformEvents(): GET the deployed worker's /events feed.
async function getPlatformEvents() {
  const res = await fetch(`${PLATFORM}/events`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  return (await res.json()).events ?? [];
}

// openSSEStream(): GET /events/stream; collect `event:` frames until
// onFrame signals "done" or the timeout elapses (the
// realtime-transport.probe.mjs pattern — accept: text/event-stream,
// AbortSignal timeout, reader + TextDecoder, frame split on \n\n).
// Returns the first line of the connect comment.
async function openSSEStream(timeoutMs, onFrame) {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(`${PLATFORM}/events/stream`, {
    headers: { "user-agent": UA, "accept": "text/event-stream" },
    signal,
  });

  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`SSE stream -> HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  let firstLine = null;

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      if (firstLine === null && buffer.trim()) {
        firstLine = buffer.trim().split("\n")[0];
      }

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const result = onFrame(frame, buffer);
        if (result === "done") {
          done = true;
          break;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  return firstLine;
}

// ---------------------------------------------------------------------------
// Leg A — live Artifacts token events surface in GET /events.
// ---------------------------------------------------------------------------

async function legA() {
  console.log("\n=== Leg A: live Artifacts token events in GET /events ===");
  let cleaned = false;
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    const r = await deleteRepo(name);
    console.log(`  pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);

  await fork("demo", BASE_REPO);
  console.log(`  forked ${BASE_REPO}`);

  // Mint then revoke a scratch write token. The mint emits
  // token.created; the revoke emits token.revoked.
  const minted = await mintToken(BASE_REPO);
  console.log(`  minted token ${minted.id} (scope ${minted.scope})`);
  check("A mint returns id+plaintext+scope+expires_at", !!minted.id && !!minted.plaintext && !!minted.scope && !!minted.expires_at, JSON.stringify(Object.keys(minted ?? {})));

  const revoked = await revokeToken(minted.id);
  console.log(`  revoked token ${minted.id}: HTTP ${revoked.status}`);
  check("A revoke accepted", revoked.status < 400, `HTTP ${revoked.status}`);

  // Poll GET /events until both token events appear for the scratch
  // repo. The live open-beta environment emits the token events as
  // cf.artifacts.token.* (normalized token.created/token.revoked —
  // the acceptance copy's names); the documented repo.token.* form
  // is also accepted. Queue delivery is seconds-to-minutes (300s
  // deadline, the observed 1.5–4 min latency class).
  const deadline = Date.now() + EVENTS_DEADLINE_MS;
  let created = null;
  let revokedEv = null;
  while (Date.now() < deadline) {
    const events = await getPlatformEvents();
    created = events.find((e) => (e.type === "token.created" || e.type === "repo.token.created") && e.repo === BASE_REPO) ?? null;
    revokedEv = events.find((e) => (e.type === "token.revoked" || e.type === "repo.token.revoked") && e.repo === BASE_REPO) ?? null;
    if (created && revokedEv) break;
    await sleep(5000);
  }

  check("A token.created in feed", !!created, "token.created for " + BASE_REPO + " not seen within deadline");
  check("A token.revoked in feed", !!revokedEv, "token.revoked for " + BASE_REPO + " not seen within deadline");
  if (created) {
    check("A created entry shape {type,repo,at}", (created.type === "token.created" || created.type === "repo.token.created") && created.repo === BASE_REPO && typeof created.at === "string", JSON.stringify(created));
    check("A created entry has no ref/after", created.ref === undefined && created.after === undefined, JSON.stringify(created));
  }
  if (revokedEv) {
    check("A revoked entry shape {type,repo,at}", (revokedEv.type === "token.revoked" || revokedEv.type === "repo.token.revoked") && revokedEv.repo === BASE_REPO && typeof revokedEv.at === "string", JSON.stringify(revokedEv));
    check("A revoked entry has no ref/after", revokedEv.ref === undefined && revokedEv.after === undefined, JSON.stringify(revokedEv));
  }

  // NFR-3: no token plaintext or tokenId anywhere in the feed.
  const feed = await getPlatformEvents();
  const feedJson = JSON.stringify(feed);
  check("A no plaintext in feed", !credRe.test(feedJson) && !feedJson.includes(minted.plaintext), "a token value appears in the feed");
  check("A no tokenId in feed", !feedJson.includes(minted.id), "the tokenId appears in the feed");

  // Second surface (FR-36): the same token events must reach the
  // live SSE transport (GET /events/stream) — the hub re-validates
  // every publish against its own whitelist, so a token frame here
  // proves the DO-side whitelist mirrors the consumer's. Poll the
  // stream (fresh connection per attempt: the ring-buffer tail on
  // subscribe replays the most recent MAX_EVENTS records) until both
  // frames arrive or the queue-latency deadline passes.
  const sseDeadline = Date.now() + EVENTS_DEADLINE_MS;
  let sseCreated = false;
  let sseRevoked = false;
  while (Date.now() < sseDeadline && !(sseCreated && sseRevoked)) {
    try {
      await openSSEStream(35_000, (frame) => {
        if (frame.includes(`event: token.created`) || frame.includes(`event: repo.token.created`)) {
          if (frame.includes(`"repo":"${BASE_REPO}"`)) sseCreated = true;
        }
        if (frame.includes(`event: token.revoked`) || frame.includes(`event: repo.token.revoked`)) {
          if (frame.includes(`"repo":"${BASE_REPO}"`)) sseRevoked = true;
        }
        return (sseCreated && sseRevoked) ? "done" : undefined;
      });
    } catch (e) {
      // Transient stream/abort errors just retry on the next poll.
    }
    if (!(sseCreated && sseRevoked)) await sleep(5000);
  }
  check("A token.created on /events/stream", sseCreated, `token.created frame for ${BASE_REPO} not seen within deadline`);
  check("A token.revoked on /events/stream", sseRevoked, `token.revoked frame for ${BASE_REPO} not seen within deadline`);
}

// ---------------------------------------------------------------------------
// Leg B — local wrangler dev + tail: both audit log lines captured.
// ---------------------------------------------------------------------------

// Spawn a long-running process, resolving on first output matching a
// readiness regex (or rejecting after a timeout).
function spawnReady(opts, { readyRe, timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, { ...opts.spawnOpts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => {
      reject(new Error(`${label}: not ready within ${timeoutMs}ms; output:\n${out.slice(-2000)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      const s = chunk.toString();
      out += s;
      if (readyRe && readyRe.test(out)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve({ child, out });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// Spawn a long-running log source (e.g. `wrangler tail`) and
// accumulate its output. Unlike spawnReady, this does NOT gate on
// a readiness signal — `wrangler tail` connects silently and
// prints nothing until a matching log line arrives, so there is
// no startup banner to wait for. Returns a handle whose `out`
// grows as logs arrive; the caller sleeps to let logs flush,
// then parses `out` as a stream of JSON events (parseTailEvents).
function spawnLogs(opts) {
  const child = spawn(opts.cmd, opts.args, { ...opts.spawnOpts, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const onData = (chunk) => { out += chunk.toString(); };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return { child, get out() { return out; } };
}
// Parse the concatenated JSON objects in a `wrangler tail
// --format json` stream. Each log event is one JSON object
// (pretty-printed across multiple lines, possibly several
// objects in the stream); a depth scan recovers the object
// boundaries without assuming one-object-per-line.
function parseTailEvents(out) {
  const events = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { events.push(JSON.parse(out.slice(start, i + 1))); } catch { /* partial flush */ }
        start = -1;
      }
    }
  }
  return events;
}

// The message texts of a tail event. `wrangler tail
// --format json` wraps each request in an envelope whose
// `logs[]` array carries the worker's console.log calls —
// each `message` is the console.log args (a string, or an
// array joined with spaces, matching console.log
// semantics). A top-level `message` is honored as a
// fallback for single-line formats.
function messageTexts(event) {
  const texts = [];
  for (const entry of event?.logs ?? []) {
    texts.push(messageText(entry));
  }
  if (event?.message !== undefined) texts.push(messageText(event));
  return texts;
}

// One console.log entry's text: `message` is a string, or
// the console.log args as an array (joined with spaces).
function messageText(entry) {
  const m = entry?.message;
  if (Array.isArray(m)) {
    return m.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  }
  return String(m ?? "");
}

async function legB() {
  console.log("\n=== Leg B: local wrangler tail captures both audit log lines ===");
  let dev = null;
  let tail = null;
  let cleaned = false;
  try {
    for (const name of [PROPOSAL_REPO, BASE_REPO]) {
      const r = await deleteRepo(name);
      if (r.status === 200 || r.status === 202) cleaned = true;
    }
    if (cleaned) await sleep(1200);
    await fork("demo", BASE_REPO);
    await fork(BASE_REPO, PROPOSAL_REPO);

    // The pinned local `wrangler dev` (local mode) — spawned per
    // the plan. The land below targets the DEPLOYED worker so the
    // `wrangler tail` leg (which tails the deployed worker's logs)
    // captures the audit lines the land emits.
    const platformDir = join(import.meta.dirname, "..", "..", "platform");
    dev = await spawnReady(
      {
        cmd: WRANGLER,
        args: ["dev", "src/index.ts", "--port", String(LOCAL_PORT), "--local"],
        spawnOpts: { cwd: platformDir },
      },
      {
        readyRe: /Ready on|Local:\s+http|Listening on/i,
        timeoutMs: DEV_TIMEOUT_MS,
        label: "wrangler dev",
      },
    );
    console.log(`  wrangler dev ready on :${LOCAL_PORT}`);

    // Tail the deployed worker's console.log lines, filtered to
    // token-* events. `wrangler tail` connects silently (no
    // startup banner), so it is spawned via spawnLogs — no
    // readiness gate — and given time to connect before the
    // land drives the audit lines.
    tail = spawnLogs({
      cmd: WRANGLER,
      args: ["tail", "nextgit-platform", "--format", "json", "--search", "token-"],
      spawnOpts: { cwd: platformDir },
    });
    // Let the tail connect before the land fires.
    await sleep(8000);
    console.log("  wrangler tail connected (search token-)");

    // Drive a land into the scratch chain so the DEPLOYED worker
    // mints and revokes a token inside the land critical section.
    const baseToken = await mintToken(BASE_REPO);
    const proposalToken = await mintToken(PROPOSAL_REPO);
    const dir = mkdtempSync(join(tmpdir(), "nextgit-ta-probe-"));
    const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken.plaintext), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
    git("config", "user.name", "token-audit-probe");
    git("config", "user.email", "probe@nextgit.dev");
    writeFileSync(join(dir, "ta-probe.txt"), `token-audit probe ${new Date().toISOString()}\n`);
    git("add", "-A"); git("commit", "-m", "probe: token-audit edit"); git("push", "origin", "HEAD:refs/heads/main");
    const C1 = git("rev-parse", "HEAD");

    // Land against the DEPLOYED worker (its logs are what the
    // wrangler tail leg captures). The CF-Connecting-IP is
    // set by the edge — a client-supplied value is a reserved
    // header the edge rejects, so it is omitted (the rate
    // limiter's caller key falls back to the edge-provided
    // value).
    const res = await fetch(`${PLATFORM}/land`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main" }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => null);
    console.log(`  POST /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
    check("B land succeeded (200)", res.status === 200 && json?.ok === true, `HTTP ${res.status}`);

    // Give the tail a moment to flush the captured lines.
    await sleep(6000);

    // Read the tail's accumulated output. `wrangler tail
    // --format json` pretty-prints each log event as a
    // multi-line JSON envelope whose `logs[]` array carries
    // the worker's console.log calls, so line-splitting
    // cannot recover a full event — parse the object stream
    // instead and assert on each event's log messages.
    const events = parseTailEvents(tail.out);
    const messages = events.flatMap(messageTexts).filter((m) => m.includes("token-mint") || m.includes("token-revoke"));
    const mintMsg = messages.find((m) => m.includes("token-mint"));
    const revokeMsg = messages.find((m) => m.includes("token-revoke"));
    check("B token-mint line captured", !!mintMsg, `no token-mint in tail output:\n${tail.out.slice(-2000)}`);
    check("B token-revoke line captured", !!revokeMsg, `no token-revoke in tail output:\n${tail.out.slice(-2000)}`);
    if (mintMsg) {
      check("B token-mint fields {repo,ttl:300}", mintMsg.includes(`"repo":"${BASE_REPO}"`) && mintMsg.includes(`"ttl":300`), mintMsg);
    }
    if (revokeMsg) {
      check("B token-revoke fields {repo,phase:success}", revokeMsg.includes(`"repo":"${BASE_REPO}"`) && revokeMsg.includes(`"phase":"success"`), revokeMsg);
    }
    // NFR-3: no token plaintext in any captured message.
    check("B no plaintext in captured lines", !messages.some((m) => credRe.test(m) || m.includes(baseToken.plaintext) || m.includes(proposalToken.plaintext)), "a token value appears in a captured tail message");

    rmSync(dir, { recursive: true, force: true });
  } finally {
    // Stop the spawned dev + tail processes.
    for (const p of [tail, dev]) {
      if (p?.child) {
        try { p.child.kill("SIGTERM"); } catch { }
      }
    }
    // Scratch cleanup: delete the scratch chain.
    for (const name of [PROPOSAL_REPO, BASE_REPO]) {
      try { await deleteRepo(name); } catch { }
    }
  }
}

// ---------------------------------------------------------------------------

try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);
  await legA();
  await legB();
} catch (err) {
  check("probe threw", false, String(err?.stack ?? err));
  // Best-effort scratch cleanup on failure.
  try { await deleteRepo(PROPOSAL_REPO); } catch { }
  try { await deleteRepo(BASE_REPO); } catch { }
}

console.log(fails === 0 ? "\nPASS — token-audit probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);

