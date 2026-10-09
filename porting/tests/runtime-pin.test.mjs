#!/usr/bin/env bun
// Run: bun porting/tests/runtime-pin.test.mjs   (exit 0 = pass)
// Mechanical guard for lockfile-pinned deploy convention, pinned compatibility date,
// node engines pin, and the no-auth-or-body-logging invariant.
// Follows the normalize.test.mjs / tasks.test.mjs / batch.test.mjs direct-run convention.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let fails = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

// --- wrangler.jsonc ---------------------------------------------------------
const wranglerRaw = readFileSync(join(ROOT, "platform/wrangler.jsonc"), "utf8");
// strip // comments before JSON.parse (jsonc)
const wranglerClean = wranglerRaw.replace(/\/\/.*$/gm, "");
const wrangler = JSON.parse(wranglerClean);

check("wrangler.jsonc name = nextgit-platform", wrangler.name === "nextgit-platform", `got: ${wrangler.name}`);
check("wrangler.jsonc compatibility_date = 2026-09-01", wrangler.compatibility_date === "2026-09-01", `got: ${wrangler.compatibility_date}`);

// Check 3 + 4: no compatibility_flags field, or if present, no nodejs_compat
const hasCompatibilityFlags = "compatibility_flags" in wrangler;
check("wrangler.jsonc has no compatibility_flags field", !hasCompatibilityFlags, `field present: ${hasCompatibilityFlags}`);
if (hasCompatibilityFlags) {
  check("wrangler.jsonc compatibility_flags does not contain nodejs_compat",
    !wrangler.compatibility_flags || !wrangler.compatibility_flags.includes("nodejs_compat"),
    `got: ${JSON.stringify(wrangler.compatibility_flags)}`);
}

// --- platform/package.json --------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, "platform/package.json"), "utf8"));
check("platform/package.json engines.node >= 20", pkg.engines?.node === ">=20", `got: ${pkg.engines?.node}`);

// --- docs/HANDOFF.md has no wrangler@latest deploy --------------------------
const handoffRaw = readFileSync(join(ROOT, "docs/HANDOFF.md"), "utf8");
const handoffHasLatestDeploy = /wrangler@latest\s+deploy/.test(handoffRaw);
check("docs/HANDOFF.md has no wrangler@latest deploy", !handoffHasLatestDeploy, "found wrangler@latest deploy");

// --- .omp/agents.md has no wrangler@latest deploy ---------------------------
const agentsRaw = readFileSync(join(ROOT, ".omp/agents.md"), "utf8");
const agentsHasLatestDeploy = /wrangler@latest\s+deploy/.test(agentsRaw);
check(".omp/agents.md has no wrangler@latest deploy", !agentsHasLatestDeploy, "found wrangler@latest deploy");

// --- no console call references Authorization or request body ---------------
const srcDir = join(ROOT, "platform/src");
const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const AUTH_BODY_RE = /console\.(log|warn|error|info|debug)\s*\([^)]*\b(Authorization|request\s*body|requestBody)\b/i;
let leaked = null;
for (const f of srcFiles) {
  const content = readFileSync(join(srcDir, f), "utf8");
  const m = content.match(AUTH_BODY_RE);
  if (m) {
    leaked = `${f}: ${m[0]}`;
    break;
  }
}
check("platform/src/*.ts: no console call references Authorization or request body", !leaked, leaked ?? "");

console.log(fails === 0 ? `ALL PASS (checks=${checks})` : `${fails} FAILURES (checks=${checks})`);
process.exit(fails === 0 ? 0 : 1);
