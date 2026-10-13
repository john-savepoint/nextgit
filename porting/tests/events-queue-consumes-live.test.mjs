#!/usr/bin/env node
// Contract suite: E4 — single queue consumer + single KV writer + queue events recording live.
// Run: node porting/tests/events-queue-consumes-live.test.mjs   (exit 0 = pass)
//
// Real construction: the SHIPPED platform (platform/src/index.ts + platform/wrangler.jsonc)
// is the source of truth — no mocks, no source grep of production code beyond the structural
// wrangler.jsonc guards. The live assertion hits the REAL deployed worker at
// https://nextgit-platform.john-b7d.workers.dev and verifies that a push to a fork repo
// produces a cf.artifacts.repo.pushed event in GET /events — proving the queue consumer
// actually records through KV to the live feed.
//
//   1. wrangler.jsonc: exactly 1 queues.consumers entry with queue === "nextgit-events"
//   2. wrangler.jsonc: exactly 1 kv_namespaces entry bound as "LIVE" + 1 as "CACHE"
//   3. Push a small change to a SCRATCH fork (never the live demo) via the Artifacts API + git-over-HTTPS
//      (minted write token, real push — no mocks) → generates a queue event
//   4. Poll GET /events until an event with type matching /^repo\.pushed$/
//      and repo === the scratch fork appears (300s timeout — queue delivery is seconds-to-tens)
//   5. Assert the event shape matches CONTRACT.md § GET /events: { type, repo, ref, after, at }
//   6. Assert `at` is within the test window (proves it came from this push, not stale cache)
//
// A box without an Artifacts API token skips the live-push leg — structural guards (1)-(2)
// and the live /events envelope check still run and report.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLATFORM_ROOT = join(ROOT, "platform");

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

// ---------------------------------------------------------------------------
// Token + API helpers (mirrors platform/scripts/seed.mjs)
// ---------------------------------------------------------------------------
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";

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

  // The wrangler OAuth token expires on its own; `wrangler whoami` refreshes it
  // in place. Retry once through that path instead of failing the whole run.
  if (res.status === 401 && !headers && !process.env.CLOUDFLARE_API_TOKEN) {
    try {
      execFileSync("wrangler", ["whoami"], { stdio: "ignore", timeout: 60000 });
    } catch {
      throw new Error(`${method} ${url} -> 401 and 'wrangler whoami' could not refresh`);
    }
    res = await send(null);
    data = await res.json().catch(() => ({}));
  }

  if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
}

// ---------------------------------------------------------------------------
// Structural guards — wrangler.jsonc is plain JSON (no comments/trailing commas)
// ---------------------------------------------------------------------------
const WRANGLER = JSON.parse(readFileSync(join(PLATFORM_ROOT, "wrangler.jsonc"), "utf8"));

// 1. Exactly one queue consumer on nextgit-events
const consumers = (WRANGLER.queues && WRANGLER.queues.consumers) || [];
check(
  "exactly one queue consumer",
  consumers.length === 1 && consumers[0].queue === "nextgit-events",
  consumers.length === 1 ? `queue=${consumers[0]?.queue}` : `consumers=${JSON.stringify(consumers)}`,
);

// 2. Exactly one KV namespace bound as LIVE (event feed); a separate CACHE namespace
//    holds the proposal cache + landing records.
const kv = WRANGLER.kv_namespaces || [];
const liveBindings = kv.filter((k) => k?.binding === "LIVE");
const cacheBindings = kv.filter((k) => k?.binding === "CACHE");
check(
  "exactly one kv_namespaces entry bound as LIVE",
  liveBindings.length === 1,
  `LIVE entries=${liveBindings.length}, all bindings=[${kv.map((k) => k?.binding).join(", ")}]`,
);
check(
  "CACHE namespace bound for proposal cache + landing records",
  cacheBindings.length === 1,
  `CACHE entries=${cacheBindings.length}`,
);

// ---------------------------------------------------------------------------
// Live envelope check — independent of push, always runs when network is up
// ---------------------------------------------------------------------------
const PLATFORM = process.env.PLATFORM || "https://nextgit-platform.john-b7d.workers.dev";

let envelopeOk = false;
try {
  const r = await fetch(`${PLATFORM}/events`, { headers: { "user-agent": "nextgit-e4-test/1.0" } });
  const j = await r.json().catch(() => null);
  envelopeOk = j && j.ok === true && Array.isArray(j.events);
  check("live GET /events envelope", envelopeOk, `status=${r.status}, ok=${j?.ok}, eventsLen=${j?.events?.length}`);
} catch (e) {
  skip("live GET /events envelope", `network error: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Live push leg — pushes a trivial change to a SCRATCH fork, then polls for the event
// ---------------------------------------------------------------------------
const token = apiToken();
if (!token) {
  skip("live push to scratch fork", "no CLOUDFLARE_API_TOKEN / wrangler OAuth token found");
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES (${skips} SKIPPED)`);
  process.exit(fails === 0 ? 0 : 1);
}

// Determine a unique marker so we can confirm the event is from THIS push.
const marker = `e4-test-${Date.now()}`;
const windowStart = Date.now();

// SCRATCH-ONLY LAW (2026-10-08): never push into the live demo fixtures (demo / agent-1..5) —
// a previous version of this suite pushed e4-test commits into agent-1 and destroyed its
// demo change-set + intent. Fork a scratch repo, push there, delete after.
const TARGET = `e4s-scratch-${Date.now()}`;

try {
  // Fork a scratch repo from demo + mint a write token for it
  await call("POST", `${apiBase}/repos/demo/fork`, { name: TARGET, default_branch_only: true });
  for (let i = 0; i < 30; i++) {
    const page = await call("GET", `${apiBase}/repos?limit=100`);
    const row = (page ?? []).find((x) => x.name === TARGET);
    if (row && row.status === "ready") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const tok = await call("POST", `${apiBase}/tokens`, { repo: TARGET, scope: "write", ttl: 3600 });
  const remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${TARGET}.git`;

  // Clone, push a trivial change, push
  const dir = join(tmpdir(), `nextgit-e4-test-${marker}`);
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tok.plaintext}`,
  };

  try {
    execFileSync("git", ["clone", "--quiet", remote, dir], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    execFileSync("git", ["config", "user.name", "e4-test"], { cwd: dir, env, encoding: "utf8" });
    execFileSync("git", ["config", "user.email", "e4@e4.dev"], { cwd: dir, env, encoding: "utf8" });

    // Append a marker file so the push is non-empty and identifiable
    const markerPath = join(dir, "MARKER");
    writeFileSync(markerPath, `${marker}\n`);
    execFileSync("git", ["add", "MARKER"], { cwd: dir, env, encoding: "utf8" });
    execFileSync("git", ["commit", "-m", `e4-test: ${marker}`], { cwd: dir, env, encoding: "utf8" });
    execFileSync("git", ["push", "--quiet", "origin", "HEAD:refs/heads/main"], { cwd: dir, env, encoding: "utf8" });

    // 4. Poll GET /events until repo.pushed from agent-1 appears
    const deadline = Date.now() + 300_000; // Artifacts->Queues delivery latency observed 1.5-4min when the subscription is idle
    let found = null;
    while (Date.now() < deadline) {
      const resp = await fetch(`${PLATFORM}/events`, { headers: { "user-agent": "nextgit-e4-test/1.0" } });
      const parsed = await resp.json().catch(() => null);
      if (parsed && Array.isArray(parsed.events)) {
        const evt = parsed.events.find(
          (e) =>
            typeof e.type === "string" &&
            /^repo\.pushed$/.test(e.type) &&
            e.repo === TARGET &&
            Date.parse(String(e.at)) >= windowStart,
        );
        if (evt) {
          found = evt;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!found) {
      check("live queue event materializes in GET /events", false, `timed out after 300s — no repo.pushed for ${TARGET}`);
    } else {
      check("live queue event materializes in GET /events", true, `type=${found.type}, repo=${found.repo}`);

      // 5. Assert event shape: { type, repo, ref, after, at } — none absent
      const fields = ["type", "repo", "ref", "after", "at"];
      const missing = fields.filter((f) => found[f] === undefined || found[f] === null);
      check("event shape matches CONTRACT.md § GET /events", missing.length === 0, `missing fields=${JSON.stringify(missing)}`);

      // 6. Assert `at` timestamp is within the test window
      const atMs = Date.parse(found.at);
      const withinWindow = !Number.isNaN(atMs) && atMs >= windowStart - 5000 && atMs <= Date.now() + 5000;
      check("event `at` timestamp within test window", withinWindow, `at=${found.at}, windowStart=${new Date(windowStart).toISOString()}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (e) {
  check("harness run (live push + poll)", false, String((e && e.stack) || e));
} finally {
  // Cleanup covers EVERY exit path (fork throw, ready-loop fallthrough, token
  // mint, clone/push failure) — the inner-only delete leaked a fresh
  // e4s-scratch-* repo on each failed run (observed 2026-10-12/13).
  await call("DELETE", `${apiBase}/repos/${TARGET}`).catch(() => null);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES (${skips} SKIPPED)`);
process.exit(fails === 0 ? 0 : 1);
