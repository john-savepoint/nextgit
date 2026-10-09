#!/usr/bin/env bun
// Contract suite: FR-24 — declarative harness route registry.
// Run: bun porting/tests/harness-registry.test.mjs   (exit 0 = pass)
//
// Real construction: the registry loader is exercised against the REAL shipped
// harnesses.json + harnesses.example.json files. No module mocks, no source grep.
// Per-test env (NEXTGIT_HARNESSES) is saved/restored so the suite is safe under
// parallel or repeated runs.

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadShipped, loadRegistry, loadFile, validateRegistry, buildArgs } from "../../platform/scripts/harness-registry.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  pass += ok ? 1 : 0;
  fail += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const EXAMPLE_PATH = join(import.meta.dirname, "..", "..", "platform", "scripts", "harnesses.example.json");
const savedEnv = process.env.NEXTGIT_HARNESSES;
const restoreEnv = () => { if (savedEnv === undefined) delete process.env.NEXTGIT_HARNESSES; else process.env.NEXTGIT_HARNESSES = savedEnv; };
const withEnv = (path) => { process.env.NEXTGIT_HARNESSES = path; };

// ---------------------------------------------------------------------------
// 1. loadShipped() → 3 entries (codex, omp, pi) with exact bin and args arrays
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  check("loadShipped has 3 entries", registry.length === 3, `got ${registry.length}`);
  const ids = registry.map((h) => h.id);
  check("loadShipped ids are codex,omp,pi", ids.join(",") === "codex,omp,pi", ids.join(","));

  const codex = registry.find((h) => h.id === "codex");
  check("codex bin is 'codex'", codex.bin === "codex", codex.bin);
  check("codex args match", JSON.stringify(codex.args) === JSON.stringify(["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "{prompt}"]), JSON.stringify(codex.args));
  check("codex env is empty", JSON.stringify(codex.env) === "{}", JSON.stringify(codex.env));
  check("codex stdinPrompt false", codex.stdinPrompt === false, String(codex.stdinPrompt));

  const omp = registry.find((h) => h.id === "omp");
  check("omp bin is 'omp'", omp.bin === "omp", omp.bin);
  check("omp args match", JSON.stringify(omp.args) === JSON.stringify(["-p", "--approval-mode=write", "--no-session", "--cwd", "{cwd}", "{prompt}"]), JSON.stringify(omp.args));

  const pi = registry.find((h) => h.id === "pi");
  check("pi bin is 'pi'", pi.bin === "pi", pi.bin);
  check("pi args match", JSON.stringify(pi.args) === JSON.stringify(["-p", "{prompt}"]), JSON.stringify(pi.args));
  check("pi probeBudgetMs is 60000", pi.probeBudgetMs === 60000, String(pi.probeBudgetMs));
}

// ---------------------------------------------------------------------------
// 2. buildArgs(codex, "P", "/cwd") → ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "P"]
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  const codex = registry.find((h) => h.id === "codex");
  const args = buildArgs(codex, "P", "/cwd");
  check("buildArgs codex substitutes {prompt}", args[args.length - 1] === "P", JSON.stringify(args));
  check("buildArgs codex has no {cwd} in output", args.every((a) => !a.includes("{cwd}")), JSON.stringify(args));
  check("buildArgs codex length matches", args.length === codex.args.length, `${args.length} vs ${codex.args.length}`);
}

// ---------------------------------------------------------------------------
// 3. buildArgs(omp, "P", "/cwd") → ["-p", "--approval-mode=write", "--no-session", "--cwd", "/cwd", "P"]
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  const omp = registry.find((h) => h.id === "omp");
  const args = buildArgs(omp, "P", "/cwd");
  check("buildArgs omp substitutes {cwd}", args.includes("/cwd"), JSON.stringify(args));
  check("buildArgs omp substitutes {prompt}", args[args.length - 1] === "P", JSON.stringify(args));
  check("buildArgs omp has no unresolved placeholders", args.every((a) => !a.includes("{cwd}") && !a.includes("{prompt}")), JSON.stringify(args));
}

// ---------------------------------------------------------------------------
// 4. buildArgs(pi, "P", "/cwd") → ["-p", "P"] (no {cwd} in args)
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  const pi = registry.find((h) => h.id === "pi");
  const args = buildArgs(pi, "P", "/cwd");
  check("buildArgs pi args match", JSON.stringify(args) === JSON.stringify(["-p", "P"]), JSON.stringify(args));
}

// ---------------------------------------------------------------------------
// 5. buildArgs preserves $-metacharacters in prompt/cwd (no $ replacement interpretation)
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  const codex = registry.find((h) => h.id === "codex");
  const promptWithMetachars = "hello $&$`$'  world";
  const cwdWithMetachars = "/tmp/$1/$`test";
  const args = buildArgs(codex, promptWithMetachars, cwdWithMetachars);
  check("buildArgs preserves $ metacharacters in prompt", args[args.length - 1] === promptWithMetachars, JSON.stringify(args));
  check("buildArgs preserves $ metacharacters in cwd", !args.includes("/tmp/world") && !args.includes("/tmp/ hello"), JSON.stringify(args));
}

// ---------------------------------------------------------------------------
// 6. NEXTGIT_HARNESSES=harnesses.example.json → 4 entries (example + shipped 3)
// ---------------------------------------------------------------------------
{
  withEnv(EXAMPLE_PATH);
  const { harnesses, errors } = loadRegistry();
  check("loadRegistry with example has 4 entries", harnesses.length === 4, `got ${harnesses.length}`);
  check("loadRegistry has no errors", errors.length === 0, JSON.stringify(errors));
  const ids = harnesses.map((h) => h.id);
  check("loadRegistry includes example", ids.includes("example"), ids.join(","));
  check("loadRegistry includes codex", ids.includes("codex"), ids.join(","));
  check("loadRegistry includes omp", ids.includes("omp"), ids.join(","));
  check("loadRegistry includes pi", ids.includes("pi"), ids.join(","));
  restoreEnv();
}

// ---------------------------------------------------------------------------
// 7. Same-id override: BYO file with id "codex" and different bin overrides shipped codex
// ---------------------------------------------------------------------------
{
  const overridePath = join(mkdtempSync(join(tmpdir(), "harness-override-")), "override.json");
  writeFileSync(overridePath, JSON.stringify([
    { id: "codex", bin: "my-custom-codex", args: ["run", "{prompt}"] },
  ]));
  withEnv(overridePath);
  const { harnesses, errors } = loadRegistry();
  check("override: no errors", errors.length === 0, JSON.stringify(errors));
  const codex = harnesses.find((h) => h.id === "codex");
  check("override: codex bin replaced", codex.bin === "my-custom-codex", codex.bin);
  check("override: codex args replaced", JSON.stringify(codex.args) === JSON.stringify(["run", "{prompt}"]), JSON.stringify(codex.args));
  check("override: still 3 entries (no duplicate)", harnesses.length === 3, `got ${harnesses.length}`);
  restoreEnv();
}

// ---------------------------------------------------------------------------
// 8. Validation rejects: missing id, missing bin, args not array, both args+stdinPrompt,
//    negative probeBudgetMs, non-string env value, duplicate ids
// ---------------------------------------------------------------------------
{
  const expectThrow = (name, data) => {
    try { validateRegistry(data, "test"); check(name, false, "did not throw"); }
    catch (e) { check(name, true, e.message); }
  };

  expectThrow("rejects missing id", [{ bin: "x", args: [] }]);
  expectThrow("rejects non-string id", [{ id: 42, bin: "x", args: [] }]);
  expectThrow("rejects missing bin", [{ id: "x", args: [] }]);
  expectThrow("rejects args not array", [{ id: "x", bin: "b", args: "not-array" }]);
  expectThrow("rejects both args and stdinPrompt", [{ id: "x", bin: "b", args: ["{prompt}"], stdinPrompt: true }]);
  expectThrow("rejects args with non-string element", [{ id: "x", bin: "b", args: [42] }]);
  expectThrow("rejects negative probeBudgetMs", [{ id: "x", bin: "b", args: [], probeBudgetMs: -1 }]);
  expectThrow("rejects non-string env value", [{ id: "x", bin: "b", args: [], env: { KEY: 42 } }]);
  expectThrow("rejects non-object env", [{ id: "x", bin: "b", args: [], env: "bad" }]);
  expectThrow("rejects duplicate ids", [{ id: "x", bin: "b", args: [] }, { id: "x", bin: "c", args: [] }]);
  expectThrow("rejects root not array", { id: "x", bin: "b", args: [] });
  expectThrow("rejects non-object entry", "not-an-object");
}

// ---------------------------------------------------------------------------
// 9. loadFile on nonexistent / invalid JSON → throws
// ---------------------------------------------------------------------------
{
  try {
    loadFile(join(tmpdir(), "definitely-does-not-exist-" + Date.now() + ".json"));
    check("loadFile on nonexistent file throws", false, "did not throw");
  } catch (e) {
    check("loadFile on nonexistent file throws", true, e.message);
  }

  const badPath = join(mkdtempSync(join(tmpdir(), "harness-bad-")), "bad.json");
  writeFileSync(badPath, "{ this is not valid json");
  try {
    loadFile(badPath);
    check("loadFile on invalid JSON throws", false, "did not throw");
  } catch (e) {
    check("loadFile on invalid JSON throws", true, e.message);
  }
}

// ---------------------------------------------------------------------------
// 10. loadShipped() env defaults: all entries have env={} (normalized)
// ---------------------------------------------------------------------------
{
  const registry = loadShipped();
  check("all shipped entries have env object", registry.every((h) => typeof h.env === "object" && h.env !== null), "");
  check("all shipped entries have args array or stdinPrompt", registry.every((h) => Array.isArray(h.args) || h.stdinPrompt === true), "");
  check("all shipped entries have string bin", registry.every((h) => typeof h.bin === "string" && h.bin.length > 0), "");
}

restoreEnv();

console.log(pass === 0 ? `${fail} FAILURES` : fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
