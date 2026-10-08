#!/usr/bin/env node
// validate-labels.mjs — Enforce the judge-v1 calibration labeled set acceptance criteria.
//
// Validates labels.json against NEXT-ACTIONS.md:903 and PRD FR-27:
// - Check 1: ≥50 proposals
// - Check 2: unique ids (no duplicates)
// - Check 3: every entry has label.risk AND label.intent (not null/undefined)
// - Check 4: label.risk ∈ {routine, focused, senior-security}
// - Check 5: label.intent ∈ {supports, contradicts, insufficient}
// - Check 6: fixture file exists on disk
// - Check 7: setVersion === "v1"
//
// On success: prints "proposals=N ...risk={...} intent={...}" and exits 0.
// On failure: prints "FAIL: <reason>" and exits 1.
//
// Usage: bun porting/calibration/validate-labels.mjs
//        (no arguments; reads porting/calibration/judge-v1/labels.json)

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const __dirname = resolve(new URL(".", import.meta.url).pathname);
const labelsPath = join(__dirname, "judge-v1", "labels.json");
const judgeV1Dir = join(__dirname, "judge-v1");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(labelsPath)) fail(`labels.json not found at ${labelsPath}`);

const raw = readFileSync(labelsPath, "utf8");
let labels;
try {
  labels = JSON.parse(raw);
} catch (e) {
  fail(`labels.json is not valid JSON: ${e.message}`);
}

// Check 7: setVersion
if (labels.setVersion !== "v1") fail(`setVersion is "${labels.setVersion}" (need "v1")`);

// Check 1: count
const proposals = labels.proposals;
if (!Array.isArray(proposals)) fail("labels.proposals is not an array");
if (proposals.length < 50) fail(`only ${proposals.length} labels (need ≥50)`);

// Check 2: unique ids
const idSet = new Set();
for (const p of proposals) {
  if (idSet.has(p.id)) fail(`duplicate id: ${p.id}`);
  idSet.add(p.id);
}

// Check 3, 4, 5, 6: per-entry validation
const RISK_VALUES = new Set(["routine", "focused", "senior-security"]);
const INTENT_VALUES = new Set(["supports", "contradicts", "insufficient"]);

for (const p of proposals) {
  // Check 3: both labels present
  if (p.label?.risk == null) fail(`entry ${p.id} has null/undefined label.risk`);
  if (p.label?.intent == null) fail(`entry ${p.id} has null/undefined label.intent`);

  // Check 4: risk vocabulary
  if (!RISK_VALUES.has(p.label.risk)) {
    fail(`entry ${p.id} has invalid risk "${p.label.risk}" (expected: routine|focused|senior-security)`);
  }

  // Check 5: intent vocabulary
  if (!INTENT_VALUES.has(p.label.intent)) {
    fail(`entry ${p.id} has invalid intent "${p.label.intent}" (expected: supports|contradicts|insufficient)`);
  }

  // Check 6: fixture exists
  if (!existsSync(join(judgeV1Dir, p.fixture))) {
    fail(`entry ${p.id} references missing fixture: ${p.fixture}`);
  }
}

// Compute distributions
const riskCount = {};
const intentCount = {};
for (const p of proposals) {
  riskCount[p.label.risk] = (riskCount[p.label.risk] || 0) + 1;
  intentCount[p.label.intent] = (intentCount[p.label.intent] || 0) + 1;
}

console.log(
  `proposals=${proposals.length} ` +
  `risk={routine:${riskCount["routine"] ?? 0}, focused:${riskCount["focused"] ?? 0}, senior-security:${riskCount["senior-security"] ?? 0}} ` +
  `intent={supports:${intentCount["supports"] ?? 0}, contradicts:${intentCount["contradicts"] ?? 0}, insufficient:${intentCount["insufficient"] ?? 0}}`
);
process.exit(0);
