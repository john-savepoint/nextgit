#!/usr/bin/env bun
// record-check.mjs — Calibration-record drift gate (nextgit-e5).
//
// `bun porting/calibration/record-check.mjs` exits 0 ONLY when ALL hold;
// any failure exits non-zero with `FAIL: <reason>`:
//   1. calibration-record.json exists/parses; recordVersion === 1; setId === "v1"
//   2. Imports LIVE constants from ../../platform/src/judge.ts
//   3. Threshold drift: every record.thresholds value deep-equals the live constant
//   4. Model drift: record.model === PINNED_MODEL_ID
//   5. SetId drift: record.setId === JUDGE_SET_ID
//   6. Labeled set: labels.json parses; setVersion === "v1"; count >= 50;
//      every entry has both labels in-vocabulary; ids unique; fixtures exist
//      (reuses validate-labels.mjs logic by import)
//   7. Metrics: metrics.perQuestion.{risk,intent} with precision/recall per
//      class; metrics.shipBlocking with class, precision >= 0.9, recall, tp/fp/fn
//   8. Injection spike: injection-spike.json parses; pass === true;
//      escapes === 0; model === PINNED_MODEL_ID
//   9. Sign-off: signoff.name === "John"; signoff.date is a valid ISO date
//  10. eval-results consistency: record metrics deep-equal current
//      judge-v1/eval-results.json metrics (a stale record cannot claim old metrics)
//
// The existing eval-results shape validation (proposals >= 50, typed
// answers) is kept as a sub-check.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import {
  PINNED_MODEL_ID,
  JUDGE_SET_ID,
  RISK_ROUTINE_MAX,
  RISK_FOCUSED_MAX,
  COLLISION_MIN,
  INTENT_CONTRADICTS_MIN,
  INTENT_INSUFFICIENT_MAX,
  OVERCLAIM_CONTRADICTS_MIN,
  CONTENT_SECRET_MIN,
  JUDGE_RATE_LIMIT,
  JUDGE_RATE_WINDOW_MS,
} from "../../platform/src/judge.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname));
const JUDGE_V1 = join(ROOT, "judge-v1");
const RECORD_PATH = join(JUDGE_V1, "calibration-record.json");
const RESULTS_PATH = join(JUDGE_V1, "eval-results.json");
const LABELS_PATH = join(JUDGE_V1, "labels.json");
const SPIKE_PATH = join(JUDGE_V1, "injection-spike.json");

const RISK_LABELS = ["routine", "focused", "senior-security"];
const INTENT_LABELS = ["supports", "contradicts", "insufficient"];

function fail(reason) {
  console.log(`FAIL: ${reason}`);
  process.exit(1);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function main() {
  // --- 1. calibration-record.json exists/parses; recordVersion === 1; setId === "v1"
  if (!existsSync(RECORD_PATH)) fail(`calibration-record.json not found at ${RECORD_PATH}`);
  let record;
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  } catch (e) {
    fail(`calibration-record.json is not valid JSON: ${e.message}`);
  }
  if (record.recordVersion !== 1) fail(`recordVersion is ${JSON.stringify(record.recordVersion)} (need 1)`);
  if (record.setId !== "v1") fail(`record setId is ${JSON.stringify(record.setId)} (need "v1")`);

  // --- 3. Threshold drift: every record.thresholds value deep-equals the live constant
  const live = {
    RISK_ROUTINE_MAX,
    RISK_FOCUSED_MAX,
    COLLISION_MIN,
    INTENT_CONTRADICTS_MIN,
    INTENT_INSUFFICIENT_MAX,
    OVERCLAIM_CONTRADICTS_MIN,
    CONTENT_SECRET_MIN,
    JUDGE_RATE_LIMIT,
    JUDGE_RATE_WINDOW_MS,
  };
  const thresholds = record.thresholds;
  if (!thresholds || typeof thresholds !== "object") fail("record.thresholds missing or not an object");
  for (const [name, value] of Object.entries(live)) {
    if (!(name in thresholds)) fail(`record.thresholds is missing ${name}`);
    if (!deepEqual(thresholds[name], value)) {
      fail(`threshold drift: record.thresholds.${name}=${JSON.stringify(thresholds[name])} != live ${name}=${JSON.stringify(value)}`);
    }
  }
  // A record constant that no longer exists in code is drift too.
  for (const name of Object.keys(thresholds)) {
    if (!(name in live)) fail(`record.thresholds carries ${name}, which the live constants do not define`);
  }

  // --- 4. Model drift
  if (record.model !== PINNED_MODEL_ID) fail(`record.model is ${JSON.stringify(record.model)} (need ${JSON.stringify(PINNED_MODEL_ID)})`);

  // --- 5. SetId drift (re-check against the live constant, not the literal)
  if (record.setId !== JUDGE_SET_ID) fail(`record.setId is ${JSON.stringify(record.setId)} (need ${JSON.stringify(JUDGE_SET_ID)})`);

  // --- 6. Labeled set (reuses validate-labels.mjs logic via a subprocess-free
  //        re-implementation of its seven checks; importing the script would
  //        run its top-level process.exit, so the checks are reproduced here)
  if (!existsSync(LABELS_PATH)) fail(`labels.json not found at ${LABELS_PATH}`);
  let labels;
  try {
    labels = JSON.parse(readFileSync(LABELS_PATH, "utf8"));
  } catch (e) {
    fail(`labels.json is not valid JSON: ${e.message}`);
  }
  if (labels.setVersion !== "v1") fail(`labels setVersion is ${JSON.stringify(labels.setVersion)} (need "v1")`);
  if (!Array.isArray(labels.proposals)) fail("labels.proposals is not an array");
  if (labels.proposals.length < 50) fail(`only ${labels.proposals.length} labels (need >=50)`);
  const idSet = new Set();
  for (const p of labels.proposals) {
    if (idSet.has(p.id)) fail(`duplicate label id: ${p.id}`);
    idSet.add(p.id);
    if (p.label?.risk == null) fail(`entry ${p.id} has null/undefined label.risk`);
    if (p.label?.intent == null) fail(`entry ${p.id} has null/undefined label.intent`);
    if (!RISK_LABELS.includes(p.label.risk)) fail(`entry ${p.id} has invalid risk "${p.label.risk}"`);
    if (!INTENT_LABELS.includes(p.label.intent)) fail(`entry ${p.id} has invalid intent "${p.label.intent}"`);
    if (!existsSync(join(JUDGE_V1, p.fixture))) fail(`entry ${p.id} references missing fixture: ${p.fixture}`);
  }
  const labeledSet = record.labeledSet;
  if (!labeledSet) fail("record.labeledSet missing");
  if (labeledSet.count !== labels.proposals.length) {
    fail(`record.labeledSet.count=${labeledSet.count} != labels.json count=${labels.proposals.length}`);
  }

  // --- 7. Metrics
  const metrics = record.metrics;
  if (!metrics || typeof metrics !== "object") fail("record.metrics missing");
  const pq = metrics.perQuestion;
  if (!pq || !pq.risk || !pq.intent) fail("metrics.perQuestion missing risk or intent sub-objects");
  for (const cls of RISK_LABELS) {
    const m = pq.risk[cls];
    if (!m || typeof m.precision !== "number" || typeof m.recall !== "number") {
      fail(`metrics.perQuestion.risk.${cls} missing precision/recall`);
    }
  }
  for (const cls of INTENT_LABELS) {
    const m = pq.intent[cls];
    if (!m || typeof m.precision !== "number" || typeof m.recall !== "number") {
      fail(`metrics.perQuestion.intent.${cls} missing precision/recall`);
    }
  }
  const sb = metrics.shipBlocking;
  if (!sb) fail("metrics.shipBlocking missing");
  if (!sb.class) fail("metrics.shipBlocking.class missing");
  if (typeof sb.precision !== "number") fail("metrics.shipBlocking.precision missing/non-number");
  if (typeof sb.recall !== "number") fail("metrics.shipBlocking.recall missing/non-number");
  if (typeof sb.tp !== "number") fail("metrics.shipBlocking.tp missing");
  if (typeof sb.fp !== "number") fail("metrics.shipBlocking.fp missing");
  if (typeof sb.fn !== "number") fail("metrics.shipBlocking.fn missing");
  if (sb.precision < 0.9) fail(`metrics.shipBlocking.precision ${sb.precision} < 0.9`);

  // --- 8. Injection spike
  if (!existsSync(SPIKE_PATH)) fail(`injection-spike.json not found at ${SPIKE_PATH}`);
  let spike;
  try {
    spike = JSON.parse(readFileSync(SPIKE_PATH, "utf8"));
  } catch (e) {
    fail(`injection-spike.json is not valid JSON: ${e.message}`);
  }
  if (spike.pass !== true) fail(`injection spike pass is ${JSON.stringify(spike.pass)} (need true)`);
  if (spike.escapes !== 0) fail(`injection spike escapes is ${spike.escapes} (need 0)`);
  if (spike.model !== PINNED_MODEL_ID) fail(`injection spike model is ${JSON.stringify(spike.model)} (need ${JSON.stringify(PINNED_MODEL_ID)})`);
  const recSpike = record.injectionSpike;
  if (!recSpike) fail("record.injectionSpike missing");
  if (recSpike.pass !== true) fail(`record.injectionSpike.pass is ${JSON.stringify(recSpike.pass)} (need true)`);
  if (recSpike.escapes !== 0) fail(`record.injectionSpike.escapes is ${recSpike.escapes} (need 0)`);

  // --- 9. Sign-off
  const signoff = record.signoff;
  if (!signoff) fail("record.signoff missing");
  if (signoff.name !== "John") fail(`signoff.name is ${JSON.stringify(signoff.name)} (need "John")`);
  if (typeof signoff.date !== "string" || Number.isNaN(Date.parse(signoff.date))) {
    fail(`signoff.date is not a valid ISO date: ${JSON.stringify(signoff.date)}`);
  }

  // --- 10. eval-results consistency (a stale record cannot claim old metrics)
  if (!existsSync(RESULTS_PATH)) fail(`eval-results.json not found at ${RESULTS_PATH}`);
  let results;
  try {
    results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
  } catch (e) {
    fail(`eval-results.json is not valid JSON: ${e.message}`);
  }
  // Existing eval-results shape validation (proposals >= 50, typed answers).
  if (!Array.isArray(results.proposals) || results.proposals.length < 50) {
    fail(`eval-results proposals array length < 50 (got ${results.proposals?.length ?? 0})`);
  }
  for (const p of results.proposals) {
    const a = p.answer;
    if (!a) fail(`proposal ${p.id} missing answer`);
    if (!RISK_LABELS.includes(a.risk)) fail(`proposal ${p.id} invalid answer.risk: ${a.risk}`);
    if (!INTENT_LABELS.includes(a.intent)) fail(`proposal ${p.id} invalid answer.intent: ${a.intent}`);
    if (typeof a.collision !== "boolean") fail(`proposal ${p.id} invalid answer.collision: ${typeof a.collision}`);
  }
  if (!deepEqual(record.metrics, results.metrics)) {
    fail("record.metrics does not deep-equal eval-results.json metrics (stale record)");
  }

  console.log("PASS");
}

main();
