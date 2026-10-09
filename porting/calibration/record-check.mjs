#!/usr/bin/env bun
// record-check.mjs — Standalone validator for porting/calibration/judge-v1/eval-results.json.
//
// Reads eval-results.json and asserts:
//   - proposals array length >= 50
//   - every answer.risk in {routine, focused, senior-security}
//   - every answer.intent in {supports, contradicts, insufficient}
//   - every answer.collision is boolean
//   - metrics.perQuestion present with risk + intent precision/recall
//   - metrics.shipBlocking present with class + precision + recall + tp + fp + fn
//
// Exit 0 = PASS, 1 = FAIL. Prints PASS or "FAIL: <reason>".
// Used as a separate CI gate or called internally by evaluate.mjs --check.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname));
const RESULTS_PATH = join(ROOT, "judge-v1", "eval-results.json");

const RISK_LABELS = new Set(["routine", "focused", "senior-security"]);
const INTENT_LABELS = new Set(["supports", "contradicts", "insufficient"]);

function main() {
  const fails = [];

  if (!existsSync(RESULTS_PATH)) {
    console.log(`FAIL: ${RESULTS_PATH} does not exist`);
    process.exit(1);
  }

  let results;
  try {
    results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
  } catch (e) {
    console.log(`FAIL: eval-results.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  // >=50 proposals
  if (!Array.isArray(results.proposals) || results.proposals.length < 50) {
    fails.push(`proposals array length < 50 (got ${results.proposals?.length ?? 0})`);
  }

  // Typed-valid answers
  if (Array.isArray(results.proposals)) {
    for (const p of results.proposals) {
      const a = p.answer;
      if (!a) {
        fails.push(`proposal ${p.id} missing answer`);
        continue;
      }
      if (!RISK_LABELS.has(a.risk)) {
        fails.push(`proposal ${p.id} invalid answer.risk: ${a.risk}`);
      }
      if (!INTENT_LABELS.has(a.intent)) {
        fails.push(`proposal ${p.id} invalid answer.intent: ${a.intent}`);
      }
      if (typeof a.collision !== "boolean") {
        fails.push(`proposal ${p.id} invalid answer.collision: ${typeof a.collision}`);
      }
    }
  }

  // metrics.perQuestion with risk + intent
  const pq = results.metrics?.perQuestion;
  if (!pq || !pq.risk || !pq.intent) {
    fails.push("metrics.perQuestion missing risk or intent sub-objects");
  } else {
    for (const cls of RISK_LABELS) {
      if (!pq.risk[cls] || typeof pq.risk[cls].precision !== "number" || typeof pq.risk[cls].recall !== "number") {
        fails.push(`perQuestion.risk.${cls} missing precision/recall`);
      }
    }
    for (const cls of INTENT_LABELS) {
      if (!pq.intent[cls] || typeof pq.intent[cls].precision !== "number" || typeof pq.intent[cls].recall !== "number") {
        fails.push(`perQuestion.intent.${cls} missing precision/recall`);
      }
    }
  }

  // metrics.shipBlocking
  const sb = results.metrics?.shipBlocking;
  if (!sb) {
    fails.push("metrics.shipBlocking missing");
  } else {
    if (typeof sb.precision !== "number") fails.push("shipBlocking.precision missing/non-number");
    if (typeof sb.recall !== "number") fails.push("shipBlocking.recall missing/non-number");
    if (typeof sb.tp !== "number") fails.push("shipBlocking.tp missing/non-number");
    if (typeof sb.fp !== "number") fails.push("shipBlocking.fp missing/non-number");
    if (typeof sb.fn !== "number") fails.push("shipBlocking.fn missing/non-number");
    if (!sb.class) fails.push("shipBlocking.class missing/empty");
  }

  if (fails.length > 0) {
    for (const f of fails) console.log(`FAIL: ${f}`);
    process.exit(1);
  }

  console.log("PASS");
}

main();
