#!/usr/bin/env bun
// porting/parity/compare.mjs — capability-parity harness vs the GitHub baseline.
//
// Usage:
//   bun porting/parity/compare.mjs            (derive + write the three artifacts)
//   bun porting/parity/compare.mjs --check-data   (validate the two source JSONs only)
//   bun porting/parity/compare.mjs --sync-store   (also insert below-baseline rows into the bd store)
//
// Inputs (read-only):
//   porting/parity/baseline-github.json      — GitHub baseline, one row per dimension
//   porting/parity/nextgit-capabilities.json — our set, same dimension ids
// Derived (this harness is the only writer):
//   platform/ui/parity-data.js  — `export const PARITY_TABLE = {generated, dimensions}`
//                                 (committed artifact of record; strings are escaped at
//                                 RENDER time by parity.js, never at generation)
//   porting/parity/parity-table.md         — markdown comparison table
//   porting/parity/below-baseline-rows.json — store-row payloads for the below-baseline areas
//
// Verdict rule (derived, never hand-authored). The comparison axes and the
// expected below set are fixed at plan time
// (porting/runs/nextgit-capability-parity-vs-github/plan.md):
//   below   = github shipped|partial AND nextgit none|partial
//             (a partial NextGit capability is still below a shipped GitHub
//             baseline — the plan's dimension table marks "partial (…) → below")
//   exceeds = nextgit shipped          AND github none
//   parity  = otherwise (both shipped/partial, or both none)
//
// Exit 0 ALWAYS — the dashboard is informational; a below-baseline verdict is a
// finding, not a failure. `--sync-store` inserts below rows via `bun porting/tasks.mjs add`
// (canonId + duplicate guard); exit 2 from the adapter means "already present" and
// is treated as success (idempotent re-runs). repo-browsing's below row references
// the existing nextgit-read-api P0 row instead of inserting a duplicate.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PARITY_DIR = fileURLToPath(new URL(".", import.meta.url));
const BASELINE_PATH = join(PARITY_DIR, "baseline-github.json");
const CAPABILITIES_PATH = join(PARITY_DIR, "nextgit-capabilities.json");
const DATA_MODULE_PATH = join(ROOT, "platform/ui/parity-data.js");
const TABLE_MD_PATH = join(PARITY_DIR, "parity-table.md");
const ROWS_PATH = join(PARITY_DIR, "below-baseline-rows.json");
const TASKS_CLI = join(ROOT, "porting/tasks.mjs");
const SOURCE = "harvest:parity-github";

const STATUSES = new Set(["shipped", "partial", "none"]);
// The dimension the platform already tracks as a P0 row (worker read API, in
// flight): its below-baseline verdict references that row instead of inserting
// a duplicate store row.
const EXISTING_ROW_DIM = "repo-browsing";
const EXISTING_ROW_ID = "nextgit-e14-impl-tree-and-file-read-api";

// --- data loading ---------------------------------------------------------

const loadDims = (path) => {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array`);
  return parsed;
};

// Verdict rule (derived, never hand-authored). The comparison axes and the
// expected below set are fixed at plan time
// (porting/runs/nextgit-capability-parity-vs-github/plan.md):
//   below   = github shipped/partial AND nextgit none
//             OR github shipped AND nextgit partial
//             (a partial NextGit capability is still below a shipped
//             GitHub baseline — the plan's dimension table marks
//             "partial (…) → below"; both-partial stays parity)
//   exceeds = nextgit shipped          AND github none
//   parity  = otherwise (both shipped/partial, or both none)
export const deriveVerdict = (githubStatus, nextgitStatus) => {
  if (githubStatus !== "none" && nextgitStatus === "none") return "below";
  if (githubStatus === "shipped" && nextgitStatus === "partial") return "below";
  if (nextgitStatus === "shipped" && githubStatus === "none") return "exceeds";
  return "parity";
};

// --- input validation (the --check-data contract) -------------------------

// Validate one side's status object. Throws with a precise reason on any
// contract violation: every dimension has both sides, statuses in the enum,
// >=1 source each, ids unique and identical across both files.
const validateSide = (dim, sideName, side) => {
  if (side === undefined || side === null) throw new Error(`dimension ${dim.id}: missing "${sideName}" side`);
  if (!STATUSES.has(side.status)) {
    throw new Error(`dimension ${dim.id}: ${sideName} status "${side.status}" not in enum [${[...STATUSES].join(", ")}]`);
  }
  if (typeof side.evidence !== "string" || side.evidence.length === 0) {
    throw new Error(`dimension ${dim.id}: ${sideName} evidence must be a non-empty string`);
  }
  if (!Array.isArray(side.sources) || side.sources.length === 0 || side.sources.some((s) => typeof s !== "string" || s.length === 0)) {
    throw new Error(`dimension ${dim.id}: ${sideName} sources must be a non-empty array of strings`);
  }
};

// Join both files on dimension id. The id sets must be identical (same ids,
// same multiplicity — uniqueness is checked first so a dup cannot mask a miss).
export const joinDimensions = (baseline, capabilities) => {
  const seen = new Set();
  for (const dim of baseline) {
    if (seen.has(dim.id)) throw new Error(`baseline-github.json: duplicate dimension id ${dim.id}`);
    seen.add(dim.id);
    validateSide(dim, "github", dim.github);
  }
  const seenCap = new Set();
  for (const dim of capabilities) {
    if (seenCap.has(dim.id)) throw new Error(`nextgit-capabilities.json: duplicate dimension id ${dim.id}`);
    seenCap.add(dim.id);
    validateSide(dim, "nextgit", dim.nextgit);
  }
  if (seen.size !== seenCap.size || [...seen].some((id) => !seenCap.has(id))) {
    const missing = [...seen].filter((id) => !seenCap.has(id));
    const extra = [...seenCap].filter((id) => !seen.has(id));
    throw new Error(`dimension id sets differ — baseline-only: [${missing.join(", ")}] capabilities-only: [${extra.join(", ")}]`);
  }
  const capById = new Map(capabilities.map((d) => [d.id, d]));
  return baseline.map((base) => {
    const cap = capById.get(base.id);
    return {
      id: base.id,
      dimension: base.dimension,
      github: base.github,
      nextgit: cap.nextgit,
      verdict: deriveVerdict(base.github.status, cap.nextgit.status),
    };
  });
};

// --- artifact emitters ------------------------------------------------------

const ISO = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const tally = (dimensions) => {
  const counts = { exceeds: 0, parity: 0, below: 0 };
  for (const d of dimensions) counts[d.verdict]++;
  return counts;
};

// parity-data.js: the PARITY_TABLE contract with parity.js. Strings are NOT
// escaped here — escaping happens at render time (parity.js inserts every
// value via textContent) so the committed artifact stays human-readable
// data, and the render layer owns the only DOM sink (single chokepoint,
// per the STRIDE tampering control).
const emitDataModule = (dimensions, generated) => {
  const table = { generated, dimensions };
  return `// GENERATED by porting/parity/compare.mjs — do not edit by hand.
// Regenerate: bun porting/parity/compare.mjs
// The PARITY_TABLE contract consumed by platform/ui/parity.js.
// Strings are escaped at RENDER time (parity.js), not at generation.
export const PARITY_TABLE = ${JSON.stringify(table, null, 2)};
`;
};

const mdCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

const emitTableMd = (dimensions, generated) => {
  const lines = [
    "# Capability parity — NextGit vs GitHub baseline",
    "",
    `Generated: ${generated} — derived by \`bun porting/parity/compare.mjs\` (verdicts are computed, never hand-authored).`,
    "",
    "Verdicts: **exceeds** = NextGit shipped where GitHub has none · **parity** = both sides (or both absent) · **below** = GitHub shipped/partial where NextGit has none (or only a partial capability).",
    "",
    "| Verdict | Dimension | GitHub | NextGit |",
    "|---|---|---|---|",
  ];
  for (const d of dimensions) {
    lines.push(`| ${d.verdict} | ${mdCell(d.dimension)} | ${d.github.status} | ${d.nextgit.status} |`);
  }
  const counts = tally(dimensions);
  lines.push("", `Summary: ${counts.exceeds} exceeds · ${counts.parity} parity · ${counts.below} below (of ${dimensions.length} dimensions).`);
  return lines.join("\n") + "\n";
};

// Store-row payloads for the below-baseline areas. The id is canonId-safe
// (the `nextgit-` prefix + a slug), and repo-browsing references the existing
// P0 row instead of inserting a duplicate.
const emitBelowRows = (dimensions) => dimensions
  .filter((d) => d.verdict === "below")
  .map((d) => {
    const id = `nextgit-parity-below-${d.id}`;
    const title = `Parity gap vs GitHub: ${d.dimension}`;
    let acceptance;
    if (d.id === EXISTING_ROW_DIM) {
      acceptance = `Bring ${d.dimension} to at least GitHub-baseline parity. Already tracked by the in-flight P0 row ${EXISTING_ROW_ID} (worker read API for repo browsing — GET /tree, GET /file, GET /raw/{repo}); this row records the parity finding and the reference, and intentionally inserts no duplicate.`;
    } else {
      acceptance = `Bring "${d.dimension}" to at least GitHub-baseline parity (GitHub: ${d.github.status}; NextGit: ${d.nextgit.status}). Evidence: ${d.github.evidence}`;
    }
    return {
      id,
      title,
      priority: "P2",
      scope: `Capability parity vs the GitHub baseline (porting/parity/baseline-github.json) — dimension "${d.id}": GitHub ${d.github.status}, NextGit ${d.nextgit.status}. Sources: ${d.github.sources.join(" ; ")}`,
      acceptance,
      check: "bun porting/parity/compare.mjs --check-data",
      source: SOURCE,
    };
  });

// --- store sync (idempotent) ------------------------------------------------

// Insert each below-baseline row via the sanctioned adapter. `tasks.mjs add`
// canonicalizes the id (canonId) and rejects a duplicate id with exit 2 —
// which means "already present", i.e. success for an idempotent re-run.
const syncStore = (rows) => {
  const results = [];
  for (const row of rows) {
    let outcome;
    try {
      execFileSync("bun", [TASKS_CLI, "add", "--id", row.id, "--title", row.title, "--priority", row.priority, "--scope", row.scope, "--acceptance", row.acceptance, "--check", row.check, "--source", row.source], { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"] });
      outcome = "inserted";
    } catch (e) {
      const code = e.status ?? 1;
      const stderr = String(e.stderr ?? e.message ?? "");
      if (code === 2 && /duplicate id/.test(stderr)) outcome = "already-present";
      else throw new Error(`store insert failed for ${row.id} (exit ${code}): ${stderr.trim().split("\n").pop()}`);
    }
    results.push({ id: row.id, outcome });
  }
  return results;
};

// --- main --------------------------------------------------------------------

// Main runs only when invoked directly — importing the module for its
// pure functions (the contract suite) must be side-effect-free.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const checkDataOnly = args.includes("--check-data");
  const syncStoreFlag = args.includes("--sync-store");

  // Load + validate (throws -> non-zero exit for --check-data; the derived run
  // re-uses the same validation before emitting anything).
  const baseline = loadDims(BASELINE_PATH);
  const capabilities = loadDims(CAPABILITIES_PATH);
  const dimensions = joinDimensions(baseline, capabilities);
  const generated = ISO();
  const belowRows = emitBelowRows(dimensions);

  if (checkDataOnly) {
    console.log(`check-data: ${dimensions.length} dimensions valid (both sides, statuses in enum, sources present, id sets identical)`);
    process.exit(0);
  }

  // Emit the three derived artifacts (the harness is the only writer; the
  // source JSONs are read-only inputs — the STRIDE tampering control).
  writeFileSync(DATA_MODULE_PATH, emitDataModule(dimensions, generated));
  writeFileSync(TABLE_MD_PATH, emitTableMd(dimensions, generated));
  writeFileSync(ROWS_PATH, JSON.stringify(belowRows, null, 2) + "\n");

  const counts = tally(dimensions);
  console.log(`parity: ${dimensions.length} dimensions — ${counts.exceeds} exceeds, ${counts.parity} parity, ${counts.below} below (${generated})`);
  console.log("wrote: platform/ui/parity-data.js, porting/parity/parity-table.md, porting/parity/below-baseline-rows.json");

  if (syncStoreFlag) {
    const results = syncStore(belowRows);
    const inserted = results.filter((r) => r.outcome === "inserted").length;
    const present = results.filter((r) => r.outcome === "already-present").length;
    console.log(`sync-store: ${inserted} inserted, ${present} already-present (${results.length} below-baseline rows)`);
  }
  process.exit(0);
}
