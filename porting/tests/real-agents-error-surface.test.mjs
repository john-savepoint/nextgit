#!/usr/bin/env bun
// Contract suite: HEAL-1 — loadRegistry errors surfaced to operator.
// Run: bun porting/tests/real-agents-error-surface.test.mjs   (exit 0 = pass)
//
// Real construction: spawns the REAL platform/scripts/real-agents.mjs with
// NEXTGIT_HARNESSES pointing at a broken registry file and verifies the process
// exits non-zero with errors on stderr. No module mocks, no source grep.
// Per-test env is isolated via env override on spawn; no global env mutation.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "platform/scripts/real-agents.mjs");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  pass += ok ? 1 : 0;
  fail += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const runScript = (env) =>
  spawnSync("node", [SCRIPT, "--list-harnesses"], {
    encoding: "utf8",
    env: { ...process.env, NEXTGIT_HARNESSES: env.NEXTGIT_HARNESSES },
    timeout: 15000,
  });

// ---------------------------------------------------------------------------
// 1. Broken JSON in NEXTGIT_HARNESSES → --list-harnesses exits non-zero, errors on stderr
// ---------------------------------------------------------------------------
{
  const badPath = join(mkdtempSync(join(tmpdir(), "harness-bad-")), "broken.json");
  writeFileSync(badPath, "{ this is not valid json");
  const result = runScript({ NEXTGIT_HARNESSES: badPath });
  check("--list-harnesses exits non-zero on broken registry", result.status !== 0, `rc=${result.status}`);
  check("--list-harnesses prints error to stderr", result.stderr.includes("harness registry") || result.stderr.includes("error"), result.stderr.slice(0, 200));
  check("--list-harnesses does not exit 0 on broken registry", result.status !== 0, `rc=${result.status}`);
}

// ---------------------------------------------------------------------------
// 2. Valid NEXTGIT_HARNESSES → --list-harnesses exits 0, no stderr errors
// ---------------------------------------------------------------------------
{
  const goodPath = join(ROOT, "platform/scripts/harnesses.example.json");
  const result = runScript({ NEXTGIT_HARNESSES: goodPath });
  check("--list-harnesses exits 0 on valid registry", result.status === 0, `rc=${result.status}`);
  check("--list-harnesses has no error on stderr", !result.stderr.includes("error") || result.stderr.includes("0%"), result.stderr.slice(0, 200));
  check("--list-harnesses prints JSON to stdout", result.stdout.trim().startsWith("["), result.stdout.slice(0, 80));
}

// ---------------------------------------------------------------------------
// 3. No NEXTGIT_HARNESSES (default shipped) → --list-harnesses exits 0
// ---------------------------------------------------------------------------
{
  const result = runScript({ NEXTGIT_HARNESSES: "" });
  check("--list-harnesses exits 0 with shipped registry", result.status === 0, `rc=${result.status}`);
  check("--list-harnesses stdout includes omp id", result.stdout.includes("omp"), result.stdout.slice(0, 80));
}

console.log(pass === 0 ? `${fail} FAILURES` : fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
