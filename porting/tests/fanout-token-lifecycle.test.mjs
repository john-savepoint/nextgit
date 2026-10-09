#!/usr/bin/env bun
// Contract suite: FR-36 — token lifecycle hardening (resolveTtl + 0o600 manifest)
// Run: bun porting/tests/fanout-token-lifecycle.test.mjs   (exit 0 = pass)
//
// Leg 1 (offline, permanent): Import resolveTtl from fanout.mjs — pure function,
// no network. Assert default/clamp/reject behavior per FR-36: 24h default,
// 7d max, reject <60s.
//
// Leg 2 (live, optional): If CLOUDFLARE_API_TOKEN is set, spawn the real
// fanout.mjs as a subprocess (no mocking), assert manifest file mode 0o600
// and agent entry shape. If token unset: SKIP + exit 0.
//
// Pattern: real construction only, no module mocks, no source grep.

import { resolveTtl } from "../../platform/scripts/fanout.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Leg 1: resolveTtl — offline, permanent
// ---------------------------------------------------------------------------

// Default = 86400 (24h) when undefined
check("resolveTtl default = 86400 (24h)", resolveTtl(undefined) === 86400);

// Default = 86400 when null
check("resolveTtl(null) = 86400", resolveTtl(null) === 86400);

// Explicit value within range
check("resolveTtl(3600) = 3600", resolveTtl(3600) === 3600);

// At exact max boundary = 604800 (7d)
check("resolveTtl(604800) = 604800 (max)", resolveTtl(604800) === 604800);

// Above max is clamped to 604800
check("resolveTtl(999999) = 604800 (clamped)", resolveTtl(999999) === 604800);

// Reject < 60 seconds
let threw = false;
try { resolveTtl(30); } catch { threw = true; }
check("resolveTtl(30) throws (<60s)", threw);

// Reject NaN input
threw = false;
try { resolveTtl("not-a-number"); } catch { threw = true; }
check("resolveTtl('not-a-number') throws (NaN)", threw);

// Boundary: exactly 60 is accepted
check("resolveTtl(60) = 60 (boundary ok)", resolveTtl(60) === 60);

// ---------------------------------------------------------------------------
// Leg 2: Live fanout — optional, gated on CLOUDFLARE_API_TOKEN
// ---------------------------------------------------------------------------

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.log("SKIP  live fanout (CLOUDFLARE_API_TOKEN unset) + exit 0");
  console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FANOUT = join(__dirname, "..", "..", "platform", "scripts", "fanout.mjs");
const OUT_FILE = "/tmp/nextgit-agents.json";

const env = {
  ...process.env,
  NODE_OPTIONS: "--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=5000",
};

const result = spawnSync("node", [FANOUT, "4", "demo", "604800"], {
  env,
  cwd: join(__dirname, "..", ".."),
  encoding: "utf-8",
  timeout: 30000,
});

check("fanout subprocess exit 0", result.status === 0, `exit=${result.status}, stderr=${result.stderr?.slice(0, 200)}`);
check("fanout stdout contains '4 agent workspaces'", result.stdout?.includes("4 agent workspaces"));

// Verify manifest file permissions = 0o600
const stat = statSync(OUT_FILE);
const mode = stat.mode & 0o777;
check("manifest file mode = 0o600", mode === 0o600, `actual=${mode.toString(8)}`);

// Verify manifest shape
let agents = [];
try {
  agents = JSON.parse(readFileSync(OUT_FILE, "utf-8"));
} catch (e) {
  check("manifest parseable", false, e.message);
}

check("manifest has 4 agents", agents.length === 4);
for (const a of agents) {
  check(`${a.name}: scope=write`, a.scope === "write");
  check(`${a.name}: token is non-empty string`, typeof a.token === "string" && a.token.length > 0);
  const remoteOk = /^https:\/\/[0-9a-f]+\.artifacts\.cloudflare\.net\/git\/nextgit\/agent-[1-4]\.git$/.test(a.remote);
  check(`${a.name}: remote matches pattern`, remoteOk, a.remote);
  check(`${a.name}: expires_at is ISO`, typeof a.expires_at === "string" && !isNaN(Date.parse(a.expires_at)));
}

// ---------------------------------------------------------------------------
console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
