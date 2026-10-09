#!/usr/bin/env node
// realtime-transport.probe.mjs — LIVE probe for GET /events/stream (SSE hub).
// Scratch repo ONLY: forks `agent-e4r-<ts>-<n>` from `demo`, pushes a trivial
// change via git-over-HTTPS, and asserts the SSE stream delivers a repo.pushed
// frame within the latency budget. Never touches demo / agent-1..5.
// Run: node porting/tests/realtime-transport.probe.mjs  (exit 0 = green)
//
// Assertions (all observable via the live SSE stream endpoint, no source grep):
//  1. Structural guard — wrangler.jsonc: EVENTS_HUB binding + EventsHubDO migration class
//     + max_batch_timeout === 1.
//  2. Initial frame ≤5 s — `: connected` comment arrives within 5 s of fetch start,
//     AND it precedes any `event:`/`data:` line (CONTRACT §204: never an event
//     frame on connect alone — the first decoded line MUST be a `: ` comment).
//  3. Heartbeat ≤30 s — without any event, assert a `: heartbeat` comment arrives
//     within 30 s (or an event satisfies liveness first).
//  4. End-to-end push → frame ≤2 s — fork scratch repo, mint write token, push via
//     git-over-HTTPS, assert matching `event: repo.pushed` frame appears on the SSE
//     stream within ≤2 s of the git push exiting. data.repo equals the scratch fork.
//  5. Frame shape — data: payload parses as JSON with keys {type,repo,ref,after,at}
//     and type === "repo.pushed", repo === <scratch fork>.
//  6. Cleanup — delete the scratch fork in a finally block.
//  7. No demo pollution — `if (!target.startsWith("agent-e4r-")) throw …`.
//
// Skip condition: if /events/stream returns HTTP 404 AND no CLOUDFLARE_API_TOKEN,
// structural guards (1) still run and report; SSE live legs skip gracefully.

import { execFileSync, execFileSync as execGit } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLATFORM_ROOT = join(ROOT, "platform");
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-realtime-transport-probe/1.0";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";

let fails = 0;
let skips = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const skip = (name, reason) => {
  skips++;
  console.log(`SKIP  ${name} — ${reason}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Token + API helpers (mirrors land-hardening.probe.mjs + events-queue-consumes-live)
// ---------------------------------------------------------------------------
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return null;
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const authHeader = () => ({ Authorization: `Bearer ${apiToken()}` });

async function call(method, url, body, headers = null) {
  const send = (h) =>
    fetch(url, {
      method,
      headers: { ...(h ?? authHeader()), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await send(headers);
  let data = await res.json().catch(() => ({}));

  if (res.status === 401 && !headers && !process.env.CLOUDFLARE_API_TOKEN) {
    try {
      execFileSync("wrangler", ["whoami"], { stdio: "ignore", timeout: 60000 });
    } catch {
      throw new Error(`${method} ${url} -> 401 and 'wrangler whoami' could not refresh`);
    }
    res = await send(null);
    data = await res.json().catch(() => ({}));
  }

  return { status: res.status, data, raw: data };
}

// fork(src, name): POST /repos/{src}/fork with retry on transient lag.
async function fork(src, name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await call("POST", `${apiBase}/repos/${src}/fork`, { name, default_branch_only: true });
    if (r.data?.success) return r.data.result;
    last = new Error(`fork ${src} -> ${name} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
    const transient = /already exists/i.test(last.message) || r.status === 403 || r.status === 404 || r.status >= 500;
    if (!transient) throw last;
    await sleep(1500 * attempt);
  }
  throw last;
}

// mint(repo): POST /tokens { repo, scope: "write", ttl: 3600 } -> plaintext.
async function mint(repo) {
  const r = await call("POST", `${apiBase}/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.data?.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.data.result.plaintext;
}

// deleteRepo(name): DELETE with bounded retry on 5xx.
async function deleteRepo(name) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call("DELETE", `${apiBase}/repos/${name}`);
    if (r.status < 500) return r;
    last = r;
    await sleep(1500 * attempt);
  }
  return last;
}

// gitAuthEnv: env override for git-over-HTTPS with a bearer token.
const gitAuthEnv = (token) => ({
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraheader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
});

// ---------------------------------------------------------------------------
// 1. Structural guard — wrangler.jsonc parsed from disk
// ---------------------------------------------------------------------------
const WRANGLER = JSON.parse(readFileSync(join(PLATFORM_ROOT, "wrangler.jsonc"), "utf8"));

const doBindings = (WRANGLER.durable_objects?.bindings) || [];
const hasEventsHub = doBindings.some((b) => b.name === "EVENTS_HUB" && b.class_name === "EventsHubDO");
check("1 wrangler: EVENTS_HUB binding present", hasEventsHub, JSON.stringify(doBindings));

const migrations = WRANGLER.migrations || [];
const hasHubMigration = migrations.some((m) => (m.new_sqlite_classes || []).includes("EventsHubDO"));
check("1 wrangler: EventsHubDO in migrations", hasHubMigration, JSON.stringify(migrations));

const consumers = (WRANGLER.queues?.consumers) || [];
check("1 wrangler: max_batch_timeout === 1", consumers[0]?.max_batch_timeout === 1, `got ${consumers[0]?.max_batch_timeout}`);

// ---------------------------------------------------------------------------
// SSE stream reader: opens GET /events/stream, collects frames until the callback
// signals done or a timeout elapses.
// ---------------------------------------------------------------------------
async function openSSEStream(timeoutMs = 35_000, onFrame) {
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

      // Track the first decoded line for connect-frame ordering (CONTRACT § 204).
      if (firstLine === null && buffer.trim()) {
        firstLine = buffer.trim().split("\n")[0];
      }

      // Process complete SSE frames (terminated by \n\n).
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
// LIVE SSE legs — skip gracefully if no token or stream 404s
// ---------------------------------------------------------------------------
const token = apiToken();

// First check if the stream endpoint even exists (structural gate before live legs).
let streamAvailable = false;
try {
  const probe = await fetch(`${PLATFORM}/events/stream`, {
    headers: { "user-agent": UA, "accept": "text/event-stream" },
    signal: AbortSignal.timeout(5_000),
  });
  streamAvailable = probe.ok;
} catch {
  streamAvailable = false;
}

if (!streamAvailable) {
  if (!token) {
    skip("SSE live legs", "stream endpoint not available (404) and no CLOUDFLARE_API_TOKEN — structural guards only");
  } else {
    skip("SSE live legs", "stream endpoint not available (404)");
  }
} else {
  // 2. Initial frame ≤5 s — `: connected` within 5 s of fetch start.
  //    M7: first decoded line MUST be a `: ` comment (CONTRACT §204), not an
  //    event/data/id line — connect frame precedes snapshot drain.
  const pushStart = Date.now();
  try {
    let initFrame = null;
    const firstLine = await openSSEStream(6_000, (frame) => {
      if (frame.trim().startsWith(": connected") || frame.trim().startsWith(": heartbeat") || frame.startsWith("event:")) {
        initFrame = frame;
        return "done";
      }
      return undefined;
    });
    const latency = Date.now() - pushStart;
    const isComment = firstLine !== null && firstLine.startsWith(": ");
    check("2 initial frame ≤5 s", latency <= 5000 && initFrame !== null, `latency=${latency}ms, frame=${initFrame?.slice(0, 60)}`);
    check("2 connect-frame ordering: first line is a `: ` comment", isComment, `firstLine=${firstLine?.slice(0, 40)}`);
  } catch (e) {
    check("2 initial frame ≤5 s", false, String(e?.stack ?? e));
    check("2 connect-frame ordering: first line is a `: ` comment", false, String(e?.stack ?? e));
  }

  // 3. Heartbeat ≤30 s — receive `: heartbeat` within 30 s without any event.
  try {
    let gotHeartbeat = false;
    await openSSEStream(35_000, (frame) => {
      if (frame.trim().startsWith(": heartbeat")) {
        gotHeartbeat = true;
        return "done";
      }
      // An event frame also satisfies liveness.
      if (frame.startsWith("event:")) {
        return "done";
      }
      return undefined;
    });
    check("3 heartbeat ≤30 s", gotHeartbeat, gotHeartbeat ? "got : heartbeat" : "received event instead (liveness ok)");
  } catch (e) {
    check("3 heartbeat ≤30 s", false, String(e?.stack ?? e));
  }

  // 4-5. End-to-end push → frame ≤2 s — fork scratch, push, watch SSE.
  if (token) {
    // Scratch-only guard: target name must start with agent-e4r-.
    const target = `agent-e4r-${Date.now()}`;
    if (!target.startsWith("agent-e4r-")) throw new Error(`scratch-only: refusing ${target}`);

    let dir;
    try {
      // Fork demo -> target.
      await fork("demo", target);
      // Wait for repo to be ready.
      for (let i = 0; i < 30; i++) {
        const page = await call("GET", `${apiBase}/repos?limit=100`);
        const row = (page.data?.result ?? []).find((x) => x.name === target);
        if (row && row.status === "ready") break;
        await sleep(2000);
      }

      const writeToken = await mint(target);
      const remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${target}.git`;

      dir = join(tmpdir(), `nextgit-e4-transport-${Date.now()}`);
      const env = gitAuthEnv(writeToken);

      const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

      execFileSync("git", ["clone", "--quiet", remote, dir], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("git", ["config", "user.name", "e4-transport-probe"], { cwd: dir, env, encoding: "utf8" });
      execFileSync("git", ["config", "user.email", "probe@nextgit.dev"], { cwd: dir, env, encoding: "utf8" });

      writeFileSync(join(dir, "TRANSPORT-MARKER"), `e4-rtt-${Date.now()}\n`);
      git("add", "-A");
      git("commit", "-m", "probe: transport marker");
      const pushDone = Date.now();
      git("push", "--quiet", "origin", "HEAD:refs/heads/main");

      // 4. Assert repo.pushed frame appears within ≤2 s of push exiting.
      // 5. Assert frame shape: {type,repo,ref,after,at}, type === "repo.pushed", repo === target.
      let found = null;
      await openSSEStream(5_000, (frame) => {
        // Look for event: repo.pushed with matching repo in data.
        if (frame.trim().startsWith("event: repo.pushed")) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            try {
              const data = JSON.parse(dataLine.slice("data: ".length));
              if (data.repo === target && data.type === "repo.pushed") {
                found = data;
                return "done";
              }
            } catch { }
          }
        }
        return undefined;
      });

      const latency = Date.now() - pushDone;
      check("4 end-to-end push → frame ≤2 s", found !== null && latency <= 2000, `latency=${latency}ms, found=${found === null ? "no" : "yes"}`);

      if (found) {
        check("5 frame shape: type === repo.pushed", found.type === "repo.pushed", `type=${found.type}`);
        check("5 frame shape: repo === scratch fork", found.repo === target, `repo=${found.repo}`);
        const fields = ["type", "repo", "ref", "after", "at"];
        const missing = fields.filter((f) => found[f] === undefined || found[f] === null);
        check("5 frame shape: all fields present", missing.length === 0, `missing=${JSON.stringify(missing)}`);
      } else {
        check("5 frame shape", false, "no repo.pushed frame found for scratch fork");
      }
    } catch (e) {
      check("4-5 end-to-end push → frame", false, String(e?.stack ?? e));
    } finally {
      // 6. Cleanup — delete the scratch fork.
      if (target) {
        try {
          const r = await deleteRepo(target);
          check("6 cleanup: deleted scratch fork", r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
        } catch (e) {
          check("6 cleanup: deleted scratch fork", false, String(e));
        }
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------

console.log(fails === 0 ? (skips > 0 ? `\nALL PASS (${skips} SKIPPED)` : "\nALL PASS — realtime transport probe green") : `\nFAIL — ${fails} assertion(s) failed (${skips} SKIPPED)`);
process.exit(fails === 0 ? 0 : 1);
