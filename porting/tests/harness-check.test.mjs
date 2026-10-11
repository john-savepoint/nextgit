#!/usr/bin/env bun
// Contract suite: BYO harness onboarding standard — the --check-harness
// validator end-to-end.
// Run: bun porting/tests/harness-check.test.mjs   (exit 0 = pass)
//
// Real construction: spawns the REAL platform/scripts/real-agents.mjs
// against real registry fixture files written to a mkdtempSync dir.
// No module mocks, no source grep. Every spawn isolates NEXTGIT_HARNESSES
// ("" — the validator must validate only the named file) so the suite is
// safe under parallel or repeated runs.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRegistry } from "../../platform/scripts/harness-registry.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "platform/scripts/real-agents.mjs");
const EXAMPLE = join(ROOT, "platform/scripts/harnesses.example.json");
const SHIPPED = join(ROOT, "platform/scripts/harnesses.json");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  pass += ok ? 1 : 0;
  fail += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const tmp = mkdtempSync(join(tmpdir(), "harness-check-"));
const fixture = (name, obj) => {
  const p = join(tmp, name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  return p;
};

// Isolated spawn: the validator must judge ONLY the named file.
const runCheck = (target) =>
  spawnSync("node", [SCRIPT, "--check-harness", target], {
    encoding: "utf8",
    env: { ...process.env, NEXTGIT_HARNESSES: "" },
    timeout: 15000,
  });

// ---------------------------------------------------------------------------
// 1. Acceptance positive — shipped example registry validates
// ---------------------------------------------------------------------------
{
  const result = runCheck(EXAMPLE);
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* report stays null */ }
  check("--check-harness exits 0 on the example registry", result.status === 0, `rc=${result.status}`);
  check("--check-harness stdout is JSON that parses", report !== null, result.stdout.slice(0, 120));
  check("report .ok === true", report?.ok === true, JSON.stringify(report?.ok));
  check("report .harnesses.length >= 1", Array.isArray(report?.harnesses) && report.harnesses.length >= 1, JSON.stringify(report?.harnesses?.length));
  check("report .errors is empty", Array.isArray(report?.errors) && report.errors.length === 0, JSON.stringify(report?.errors));
}

// ---------------------------------------------------------------------------
// 2. Acceptance negative — /dev/null is rejected, errors name the file
// ---------------------------------------------------------------------------
{
  const result = runCheck("/dev/null");
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* report stays null */ }
  check("--check-harness exits non-zero on /dev/null", result.status !== 0, `rc=${result.status}`);
  check("errors[0].detail names /dev/null", String(report?.errors?.[0]?.detail ?? "").includes("/dev/null"), JSON.stringify(report?.errors?.[0]?.detail));
  check("errors[0].field is 'file'", report?.errors?.[0]?.field === "file", JSON.stringify(report?.errors?.[0]?.field));
}

// ---------------------------------------------------------------------------
// 3. Blank id → field "id"
// ---------------------------------------------------------------------------
{
  const p = fixture("blank-id.json", [{ id: "", bin: "node", args: ["-e", "{prompt}"] }]);
  const result = runCheck(p);
  const report = JSON.parse(result.stdout);
  check("blank id exits non-zero", result.status !== 0, `rc=${result.status}`);
  check("blank id reports field 'id'", report.errors[0]?.field === "id", JSON.stringify(report.errors[0]));
}

// ---------------------------------------------------------------------------
// 4. Non-array args → field "args"
// ---------------------------------------------------------------------------
{
  const p = fixture("bad-args.json", [{ id: "x", bin: "node", args: "not-an-array" }]);
  const result = runCheck(p);
  const report = JSON.parse(result.stdout);
  check("non-array args exits non-zero", result.status !== 0, `rc=${result.status}`);
  check("non-array args reports field 'args'", report.errors[0]?.field === "args", JSON.stringify(report.errors[0]));
}

// ---------------------------------------------------------------------------
// 5. Neither {prompt} nor stdinPrompt → field "args", detail mentions prompt
//    (bin "node" so the semantic prompt check is isolated from bin resolution)
// ---------------------------------------------------------------------------
{
  const p = fixture("no-prompt.json", [{ id: "x", bin: "node", args: ["-e", "console.log(1)"] }]);
  const result = runCheck(p);
  const report = JSON.parse(result.stdout);
  check("args without {prompt} exits non-zero", result.status !== 0, `rc=${result.status}`);
  check("missing prompt reports field 'args'", report.errors[0]?.field === "args", JSON.stringify(report.errors[0]));
  check("missing prompt detail mentions the placeholder", /prompt/.test(report.errors[0]?.detail ?? ""), report.errors[0]?.detail ?? "");
}

// ---------------------------------------------------------------------------
// 6. Unresolvable bin → field "bin"
// ---------------------------------------------------------------------------
{
  const p = fixture("bad-bin.json", [{ id: "x", bin: "definitely-not-a-real-bin-xyz", args: ["{prompt}"] }]);
  const result = runCheck(p);
  const report = JSON.parse(result.stdout);
  check("unresolvable bin exits non-zero", result.status !== 0, `rc=${result.status}`);
  check("unresolvable bin reports field 'bin'", report.errors[0]?.field === "bin", JSON.stringify(report.errors[0]));
}

// ---------------------------------------------------------------------------
// 7. stdinPrompt:true with no args → valid
// ---------------------------------------------------------------------------
{
  const p = fixture("stdin.json", [{ id: "stdin-agent", bin: "node", stdinPrompt: true }]);
  const result = runCheck(p);
  const report = JSON.parse(result.stdout);
  check("stdinPrompt:true with no args exits 0", result.status === 0, `rc=${result.status}`);
  check("stdinPrompt:true report .ok === true", report.ok === true, JSON.stringify(report));
}

// ---------------------------------------------------------------------------
// 8. Unit: checkRegistry returns the exact {ok, harnesses, errors} shape
//    with normalized entries (stdinPrompt defaulted false, env defaulted {})
// ---------------------------------------------------------------------------
{
  const p = fixture("shape.json", [{ id: "shape", bin: "node", args: ["-e", "{prompt}"] }]);
  const report = checkRegistry(p);
  check("checkRegistry ok true on valid fixture", report.ok === true, JSON.stringify(report));
  check("checkRegistry harnesses normalized (stdinPrompt:false, env:{})",
    report.harnesses[0]?.stdinPrompt === false && JSON.stringify(report.harnesses[0]?.env) === "{}",
    JSON.stringify(report.harnesses[0]));
  check("checkRegistry errors empty on valid fixture", report.errors.length === 0, JSON.stringify(report.errors));
  check("checkRegistry on missing file returns ok:false with file error",
    checkRegistry(join(tmp, "does-not-exist.json")).errors[0]?.field === "file",
    JSON.stringify(checkRegistry(join(tmp, "does-not-exist.json")).errors[0]));
}

// ---------------------------------------------------------------------------
// 9. Unit: multiple errors collected — two bad entries → >= 2 errors
// ---------------------------------------------------------------------------
{
  const p = fixture("multi.json", [
    { id: "a", bin: "definitely-not-a-real-bin-xyz", args: ["{prompt}"] },
    { id: "", bin: "node", args: "not-an-array" },
  ]);
  const report = checkRegistry(p);
  check("checkRegistry collects multiple errors", report.ok === false && report.errors.length >= 2, JSON.stringify(report.errors));
  check("multi-error report carries no harnesses", report.harnesses.length === 0, JSON.stringify(report.harnesses));
}

// ---------------------------------------------------------------------------
// 10. Shipped harnesses.json has no STRUCTURAL errors — bin resolution is
//     machine-dependent (a box without the CLIs legitimately fails `bin`;
//     that is correct, not a defect), so filter to non-bin errors only.
// ---------------------------------------------------------------------------
{
  const report = checkRegistry(SHIPPED);
  const structural = report.errors.filter((e) => e.field !== "bin");
  check("shipped harnesses.json has no structural errors", structural.length === 0, JSON.stringify(structural));
  const semantic = checkRegistry(SHIPPED).errors.filter((e) => e.field === "args");
  check("shipped harnesses.json has no prompt-delivery errors", semantic.length === 0, JSON.stringify(semantic));
}

console.log(pass === 0 ? `${fail} FAILURES` : fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
