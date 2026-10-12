#!/usr/bin/env bun
// Contract suite: capability parity vs GitHub (nextgit-capability-parity-vs-github).
// Run: bun porting/tests/capability-parity.test.mjs   (exit 0 = pass)
//
// Real construction — imports the shipped harness (porting/parity/compare.mjs)
// and the shipped data files; no mock.module, no source grep, offline.
// Five legs:
//   1. shipped-data derivation: 18 dimensions, exactly the derived below set,
//      every below row carries a store payload with a `nextgit-parity-below-` id
//   2. verdict-rule proofs over a temp fixture (below/exceeds/parity × both)
//   3. idempotence: two harness runs produce byte-identical derived content
//      (modulo the generated stamp)
//   4. --check-data rejects: missing side, out-of-enum status, zero sources,
//      id present in one file only (each -> non-zero exit)
//   5. --sync-store idempotence against a BEADS_DIR-isolated temp store
//      (two runs -> one row; the second no-ops via the duplicate guard)
// Full-suite-safe: every store touch is a copied bd template under a temp
// BEADS_DIR (the live repo .beads is never written); per-test env save/restore.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPARE = join(ROOT, "porting/parity/compare.mjs");
const TASKS = join(ROOT, "porting/tasks.mjs");
const BASELINE = join(ROOT, "porting/parity/baseline-github.json");
const CAPABILITIES = join(ROOT, "porting/parity/nextgit-capabilities.json");
const UI_DIR = join(ROOT, "platform/ui");
const DATA_MODULE = join(UI_DIR, "parity-data.js");
const TABLE_MD = join(ROOT, "porting/parity/parity-table.md");
const ROWS_JSON = join(ROOT, "porting/parity/below-baseline-rows.json");

// The below set fixed at plan time (plan.md: the expected below-baseline set).
const EXPECTED_BELOW = [
  "session-steering",
  "agent-identity-policy",
  "inline-review-comments",
  "agent-federation",
  "repo-browsing",
  "issues",
  "ci",
];

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const tmps = [];
const temp = (p) => { const d = mkdtempSync(join(tmpdir(), `capability-parity-${p}-`)); tmps.push(d); return d; };

// Suites must never inherit the caller's store configuration (a leaked
// BEADS_DIR makes `bd init` target the LIVE store — observed 2026-10-10).
const cleanEnv = () => { const e = { ...process.env }; delete e.BEADS_DIR; delete e.TASKS_DB; return e; };

// --- 1. shipped-data derivation ---------------------------------------
// Import the shipped harness's pure functions and run the derivation over
// the shipped data files (real construction — the same code path the
// dashboard's generation runs).
try {
  const { deriveVerdict, joinDimensions } = await import(new URL("../parity/compare.mjs", import.meta.url).href);
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const capabilities = JSON.parse(readFileSync(CAPABILITIES, "utf8"));
  const dimensions = joinDimensions(baseline, capabilities);

  check("1 derivation yields 18 dimensions", dimensions.length === 18, `got ${dimensions.length}`);

  const belowIds = dimensions.filter((d) => d.verdict === "below").map((d) => d.id);
  check("1 below set is exactly the plan's expected 7",
    belowIds.length === EXPECTED_BELOW.length && EXPECTED_BELOW.every((id) => belowIds.includes(id)) && belowIds.every((id) => EXPECTED_BELOW.includes(id)),
    JSON.stringify(belowIds));

  // The derived below rows (store payloads) carry the canonical id shape.
  const rows = JSON.parse(readFileSync(ROWS_JSON, "utf8"));
  check("1 every below row carries a nextgit-parity-below- id",
    rows.length === EXPECTED_BELOW.length && rows.every((r) => /^nextgit-parity-below-[a-z0-9-]+$/.test(r.id)),
    JSON.stringify(rows.map((r) => r.id)));

  // The data module the dashboard consumes: PARITY_TABLE shape + verdicts match.
  const dataModule = readFileSync(DATA_MODULE, "utf8");
  const table = JSON.parse(dataModule.replace(/^[\s\S]*?export const PARITY_TABLE = /, "").replace(/;\s*$/, ""));
  check("1 parity-data.js exports PARITY_TABLE with dimensions", Array.isArray(table.dimensions) && table.dimensions.length === 18, `dims=${table.dimensions?.length}`);
  check("1 parity-data.js generated stamp present", typeof table.generated === "string" && table.generated.length > 0, table.generated);
  check("1 parity-data.js verdicts match the derivation",
    table.dimensions.every((d) => d.verdict === deriveVerdict(d.github.status, d.nextgit.status)),
    "a stored verdict disagrees with deriveVerdict");

  // The markdown table shows the expected 7 below rows.
  const md = readFileSync(TABLE_MD, "utf8");
  const mdBelow = (md.match(/^\| below \|/gm) || []).length;
  check("1 parity-table.md shows 7 below rows", mdBelow === 7, `got ${mdBelow}`);
} catch (e) { check("1 derivation case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 2. verdict-rule proofs over a temp fixture ------------------------
// The four rule cells, exercised through the exported derivation.
try {
  const { deriveVerdict } = await import(new URL("../parity/compare.mjs", import.meta.url).href);
  check("2 baseline-shipped + nextgit-none -> below", deriveVerdict("shipped", "none") === "below");
  check("2 baseline-partial + nextgit-none -> below", deriveVerdict("partial", "none") === "below");
  check("2 baseline-shipped + nextgit-partial -> below (partial is below a shipped baseline)", deriveVerdict("shipped", "partial") === "below");
  check("2 nextgit-shipped + github-none -> exceeds", deriveVerdict("none", "shipped") === "exceeds");
  check("2 both-shipped -> parity", deriveVerdict("shipped", "shipped") === "parity");
  check("2 both-none -> parity", deriveVerdict("none", "none") === "parity");
  check("2 both-partial -> parity", deriveVerdict("partial", "partial") === "parity");
} catch (e) { check("2 verdict-rule case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 3. idempotence ---------------------------------------------------
// Two harness runs produce byte-identical derived content (the generated
// stamp is the record of when it was derived — everything else is stable).
try {
  const runCompare = () => execFileSync("bun", [COMPARE], { cwd: ROOT, encoding: "utf8", timeout: 60000, env: cleanEnv() });
  runCompare();
  const dataA = readFileSync(DATA_MODULE, "utf8");
  const mdA = readFileSync(TABLE_MD, "utf8");
  const rowsA = readFileSync(ROWS_JSON, "utf8");
  runCompare();
  const dataB = readFileSync(DATA_MODULE, "utf8");
  const mdB = readFileSync(TABLE_MD, "utf8");
  const rowsB = readFileSync(ROWS_JSON, "utf8");
  // Strip the generated stamp (the only field that legitimately varies).
  const stripStamp = (s) => s.replace(/"generated": "[^"]*"/, '"generated": "TS"').replace(/Generated: [^\s]*/, "Generated: TS");
  check("3 parity-data.js byte-identical across runs (modulo stamp)", stripStamp(dataA) === stripStamp(dataB));
  check("3 parity-table.md byte-identical across runs (modulo stamp)", stripStamp(mdA) === stripStamp(mdB));
  check("3 below-baseline-rows.json byte-identical across runs", rowsA === rowsB);
} catch (e) { check("3 idempotence case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 4. --check-data rejects malformed inputs ------------------------
// Each mutation breaks exactly one contract and must yield a non-zero exit.
try {
  const checkData = (baselineObj, capabilitiesObj) => {
    // Run a COPY of the harness out of a temp parity dir whose two
    // source JSONs are the mutated inputs. The harness resolves its
    // input/output paths from its own location (import.meta.url), so
    // the copy reads and writes only inside the temp dir — the
    // shipped JSONs are never written, so a hard kill mid-leg cannot
    // leave the repo's parity inputs corrupted (no in-place swap).
    const dir = temp("checkdata");
    const harness = join(dir, "compare.mjs");
    copyFileSync(COMPARE, harness);
    writeFileSync(join(dir, "baseline-github.json"), JSON.stringify(baselineObj));
    writeFileSync(join(dir, "nextgit-capabilities.json"), JSON.stringify(capabilitiesObj));
    let code = 0;
    try {
      execFileSync("bun", [harness, "--check-data"], { cwd: ROOT, encoding: "utf8", timeout: 60000, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      code = e.status ?? 1;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return code;
  };

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const capabilities = JSON.parse(readFileSync(CAPABILITIES, "utf8"));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // (a) a dimension missing a side
  const missingSide = clone(baseline);
  delete missingSide[0].github;
  check("4 --check-data rejects a dimension missing a side", checkData(missingSide, clone(capabilities)) !== 0);

  // (b) an out-of-enum status
  const badStatus = clone(baseline);
  badStatus[0].github.status = "maybe";
  check("4 --check-data rejects an out-of-enum status", checkData(badStatus, clone(capabilities)) !== 0);

  // (c) a dimension with zero sources
  const noSources = clone(capabilities);
  noSources[0].nextgit.sources = [];
  check("4 --check-data rejects a dimension with zero sources", checkData(clone(baseline), noSources) !== 0);

  // (d) an id present in one file only
  const idMismatch = clone(capabilities);
  idMismatch[0].id = "not-a-real-dim";
  check("4 --check-data rejects an id present in one file only", checkData(clone(baseline), idMismatch) !== 0);

  // (e) the shipped data passes
  check("4 --check-data accepts the shipped data", checkData(clone(baseline), clone(capabilities)) === 0);
} catch (e) { check("4 check-data case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 5. --sync-store idempotence (BEADS_DIR-isolated temp store) ------
// Two runs insert the below rows once; the second no-ops via the
// duplicate guard (exit 2 = already-present).
try {
  const dir = temp("syncstore");
  const beadsDir = join(dir, ".beads");
  // A once-initialized bd template, copied so the live store is never touched.
  const template = temp("syncstore-template");
  execFileSync("bd", ["init", "--non-interactive", "--prefix", "nextgit"], { cwd: template, encoding: "utf8", timeout: 60000, env: cleanEnv() });
  copyFileSync(join(template, ".beads", "config.yaml"), join(template, ".beads", "config.yaml"));
  execFileSync("cp", ["-r", join(template, ".beads"), beadsDir], { encoding: "utf8", timeout: 30000 });

  const syncEnv = { ...cleanEnv(), BEADS_DIR: beadsDir };
  const syncRun = () => spawnSync("bun", [COMPARE, "--sync-store"], { cwd: ROOT, encoding: "utf8", timeout: 180000, env: syncEnv });

  const first = syncRun();
  check("5 first --sync-store run exits 0", first.status === 0, String(first.stderr).slice(0, 300));

  // Count the parity rows in the isolated store via the adapter.
  const list = () => {
    const out = execFileSync("bun", [TASKS, "list", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 60000, env: syncEnv });
    return JSON.parse(out);
  };
  const afterFirst = list().filter((r) => /^nextgit-parity-below-/.test(r.id));
  check("5 below rows inserted into the isolated store", afterFirst.length === EXPECTED_BELOW.length, JSON.stringify(afterFirst.map((r) => r.id)));

  // Second run: idempotent — every insert is a duplicate (exit 2), still exit 0.
  const second = syncRun();
  check("5 second --sync-store run exits 0 (idempotent)", second.status === 0, String(second.stderr).slice(0, 300));
  const afterSecond = list().filter((r) => /^nextgit-parity-below-/.test(r.id));
  check("5 second run inserts no duplicates", afterSecond.length === EXPECTED_BELOW.length, `got ${afterSecond.length}`);

  // repo-browsing references the existing P0 row instead of a duplicate:
  // its acceptance names the read-api row, and no separate duplicate row exists.
  const repoRow = afterSecond.find((r) => r.id === "nextgit-parity-below-repo-browsing");
  check("5 repo-browsing row references the existing P0 read-api row",
    !!repoRow && /nextgit-e14-impl-tree-and-file-read-api/.test(repoRow.acceptance ?? ""),
    repoRow?.acceptance?.slice(0, 120));

  rmSync(dir, { recursive: true, force: true });
  rmSync(template, { recursive: true, force: true });
} catch (e) { check("5 sync-store case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// cleanup
for (const t of tmps) rmSync(t, { recursive: true, force: true });

console.log(fails === 0 ? `ALL PASS (${checks} checks)` : `${fails} FAILURES (${checks} checks)`);
process.exit(fails === 0 ? 0 : 1);
