#!/usr/bin/env bun
// evaluate.mjs — Judge-V1 evaluation harness.
//
// Runs every labeled proposal through the real judge path:
//   buildJudgeRequest (platform/src/judge.ts)
//   -> Clef REST via Workers AI (@cf/cloudflare/clef)
//   -> validateJudgeResponse
//   -> score against ground-truth labels
//
// CLI:
//   bun porting/calibration/evaluate.mjs         full run (calls Clef, writes eval-results.json)
//   bun porting/calibration/evaluate.mjs --check  validates existing eval-results.json (no model calls)
//
// Mirrors token resolution from porting/tests/land-hardening.probe.mjs:59-83.
// Secret-skipping logic mirrors platform/src/index.ts:1338-1344.
// Batching mirrors platform/src/index.ts:1265 (MAX_JUDGE_REPOS = 16).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

import {
 buildJudgeRequest,
 validateJudgeResponse,
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

// ---------------------------------------------------------------------------
// Constants (mirror platform/src/index.ts:248-257)
// ---------------------------------------------------------------------------

const SECRET_BASENAMES = new Set(["credentials.json", "secrets.json", ".dev.vars"]);

const isSecretPath = (path) => {
 const base = path.slice(path.lastIndexOf("/") + 1);
 if (base.startsWith(".env")) return true;
 if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) return true;
 if (SECRET_BASENAMES.has(base)) return true;
 return path.includes("secrets/");
};

// Clef's REST validation caps the questions map at 64 items. A
// 16-repo batch with intents builds 78-80 questions (risk +
// intent + overclaim + collision + content_secret per repo),
// which the endpoint rejects with 422. 12 repos => at most
// 60 questions. (platform MAX_JUDGE_REPOS = 16 is the
// route-level cap; this harness must additionally respect the
// model-side question cap.)
const MAX_JUDGE_REPOS = 12;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(new URL(import.meta.url).pathname));
const CALIBRATION_DIR = ROOT;
const LABELS_PATH = join(CALIBRATION_DIR, "judge-v1", "labels.json");
const RESULTS_PATH = join(CALIBRATION_DIR, "judge-v1", "eval-results.json");
const RECORD_PATH = join(CALIBRATION_DIR, "judge-v1", "calibration-record.json");
const SPIKE_PATH = join(CALIBRATION_DIR, "judge-v1", "injection-spike.json");

// ---------------------------------------------------------------------------
// Token resolution (mirror land-hardening.probe.mjs:59-83)
// ---------------------------------------------------------------------------

let cachedToken = null;
let cachedAccountId = null;

function apiToken() {
 if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
 if (cachedToken) return cachedToken;
 const candidates = [
  join(homedir(), ".config/.wrangler/config/default.toml"),
  join(homedir(), ".wrangler/config/default.toml"),
 ];
 for (const p of candidates) {
  if (existsSync(p)) {
   const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
   if (m) return (cachedToken = m[1]);
  }
 }
 throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

function accountId() {
 if (cachedAccountId) return cachedAccountId;
 if (process.env.CLOUDFLARE_ACCOUNT_ID) return (cachedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID);
 // Fall back to `wrangler whoami --json` to discover the default account.
 try {
  const out = execFileSync("wrangler", ["whoami", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  if (parsed.accounts && parsed.accounts.length > 0) {
   return (cachedAccountId = parsed.accounts[0].id);
  }
 } catch {
  // fall through
 }
 throw new Error("No CLOUDFLARE_ACCOUNT_ID: set the env var or run `wrangler whoami`.");
}

// ---------------------------------------------------------------------------
// Clef REST client
// ---------------------------------------------------------------------------

const AI_BASE = "https://api.cloudflare.com/client/v4/accounts";

async function callClef(requestBody, account, token) {
 const res = await fetch(`${AI_BASE}/${account}/ai/run/${PINNED_MODEL_ID}`, {
  method: "POST",
  headers: {
   Authorization: `Bearer ${token}`,
   "Content-Type": "application/json",
  },
  body: JSON.stringify(requestBody),
 });

 if (res.status === 401) {
  // Refresh wrangler OAuth token and retry once.
  execFileSync("wrangler", ["whoami"]);
  cachedToken = null;
  const freshToken = apiToken();
  const retry = await fetch(`${AI_BASE}/${account}/ai/run/${PINNED_MODEL_ID}`, {
   method: "POST",
   headers: {
    Authorization: `Bearer ${freshToken}`,
    "Content-Type": "application/json",
   },
   body: JSON.stringify(requestBody),
  });
  if (!retry.ok) throw new Error(`Clef retry failed: ${retry.statusText}`);
  const retryJson = await retry.json();
  if (!retryJson.success) throw new Error(`Clef retry not successful: ${JSON.stringify(retryJson.errors)}`);
  return retryJson.result;
 }

 if (!res.ok) throw new Error(`Clef request failed: ${res.status} ${res.statusText}`);
 const json = await res.json();
 if (!json.success) throw new Error(`Clef error: ${JSON.stringify(json.errors)}`);
 return json.result;
}

// ---------------------------------------------------------------------------
// Proposal loading
// ---------------------------------------------------------------------------

/**
 * Load a proposal fixture and check if it contains secret-class files.
 * Returns { input: JudgeRepoInput, hasSecret: boolean } or null if fixture missing.
 */
function loadProposal(labelEntry) {
 const fixturePath = join(CALIBRATION_DIR, "judge-v1", labelEntry.fixture);
 if (!existsSync(fixturePath)) {
  console.error(`  WARNING: fixture not found: ${labelEntry.fixture}`);
  return null;
 }
 const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

 // Secret-skipping: if any file is secret-class, skip the proposal entirely.
 const hasSecret = fixture.files.some((f) => isSecretPath(f.path));

 // Map fixture to JudgeRepoInput: omit null/empty intent.
 const input = { repo: fixture.repo, files: fixture.files };
 if (fixture.intent) input.intent = fixture.intent;

 return { input, hasSecret, fixture };
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

function chunk(array, size) {
 const chunks = [];
 for (let i = 0; i < array.length; i += size) {
  chunks.push(array.slice(i, i + size));
 }
 return chunks;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const RISK_LABELS = ["routine", "focused", "senior-security"];
const INTENT_LABELS = ["supports", "contradicts", "insufficient"];

function isShipBlockingAnswer(answer) {
 return answer.risk === "senior-security" || answer.intent === "contradicts";
}

function isShipBlockingLabel(label) {
 return label.risk === "senior-security" || label.intent === "contradicts";
}

/**
 * Compute precision/recall per class from arrays of {predicted, actual} pairs.
 */
function perClassMetrics(predicted, actual, classes) {
 const metrics = {};
 const confusion = {};

 for (const cls of classes) {
  confusion[cls] = {};
  for (const c of classes) confusion[cls][c] = 0;
  metrics[cls] = { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0 };
 }

 for (let i = 0; i < predicted.length; i++) {
  const pred = predicted[i];
  const act = actual[i];
  confusion[act][pred]++;

  for (const cls of classes) {
   if (pred === cls && act === cls) metrics[cls].tp++;
   else if (pred === cls && act !== cls) metrics[cls].fp++;
   else if (pred !== cls && act === cls) metrics[cls].fn++;
  }
 }

 for (const cls of classes) {
  const m = metrics[cls];
  m.precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0;
  m.recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 0;
 }

 return { metrics, confusion };
}

/**
 * Compute ship-blocking precision/recall.
 */
function shipBlockingMetrics(answers, labels) {
 let tp = 0, fp = 0, fn = 0;
 for (let i = 0; i < answers.length; i++) {
  const pred = isShipBlockingAnswer(answers[i]);
  const act = isShipBlockingLabel(labels[i]);
  if (pred && act) tp++;
  else if (pred && !act) fp++;
  else if (!pred && act) fn++;
 }
 return {
  tp, fp, fn,
  precision: tp + fp > 0 ? tp / (tp + fp) : 0,
  recall: tp + fn > 0 ? tp / (tp + fn) : 0,
 };
}

// ---------------------------------------------------------------------------
// Check mode (validate existing eval-results.json)
// ---------------------------------------------------------------------------

function runCheck() {
 if (!existsSync(RESULTS_PATH)) {
  console.log(`FAIL: ${RESULTS_PATH} does not exist`);
  process.exit(1);
 }

 const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
 const fails = [];

 // >=50 proposals evaluated
 if (!Array.isArray(results.proposals) || results.proposals.length < 50) {
  fails.push(`proposals array length < 50 (got ${results.proposals?.length ?? 0})`);
 }

 // Every answer typed-valid
 if (Array.isArray(results.proposals)) {
  for (const p of results.proposals) {
   const a = p.answer;
   if (!a) { fails.push(`proposal ${p.id} missing answer`); continue; }
   if (!RISK_LABELS.includes(a.risk)) {
    fails.push(`proposal ${p.id} invalid answer.risk: ${a.risk}`);
   }
   if (!INTENT_LABELS.includes(a.intent)) {
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
  if (typeof sb.tp !== "number") fails.push("shipBlocking.tp missing");
  if (typeof sb.fp !== "number") fails.push("shipBlocking.fp missing");
  if (typeof sb.fn !== "number") fails.push("shipBlocking.fn missing");
  if (!sb.class) fails.push("shipBlocking.class missing");
 }

 if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL: ${f}`);
  process.exit(1);
 }

 console.log("PASS");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
 const checkMode = process.argv.includes("--check");

 if (checkMode) {
  runCheck();
  return;
 }

 // Full run: load labels, batch, call Clef, validate, score, write results.
 const labels = JSON.parse(readFileSync(LABELS_PATH, "utf8"));
 const account = accountId();
 const token = apiToken();

 console.log(`Labels: ${labels.proposals.length} total proposals`);
 console.log(`Set ID: ${labels.setVersion}`);

 // Load all proposals, classify as secret/non-secret.
 const nonSecret = [];
 const skipped = [];

 for (const label of labels.proposals) {
  const loaded = loadProposal(label);
  if (!loaded) continue;
  if (loaded.hasSecret) {
   skipped.push({ id: label.id, repo: label.repo, reason: "secret-class" });
  } else {
   nonSecret.push({ label, input: loaded.input });
  }
 }

 console.log(`Non-secret proposals: ${nonSecret.length}`);
 console.log(`Skipped (secret-class): ${skipped.length}`);

 const batches = chunk(nonSecret, MAX_JUDGE_REPOS);
 console.log(`Batches: ${batches.length} (size <= ${MAX_JUDGE_REPOS})`);

 const results = [];
 let batchNum = 0;

 for (const batch of batches) {
  batchNum++;
  const inputs = batch.map((b) => b.input);
  const batchLabels = batch.map((b) => b.label);

  console.log(`\nBatch ${batchNum}/${batches.length}: ${inputs.length} proposals`);

  const { state, questions, plan } = buildJudgeRequest(inputs, isSecretPath);
  const requestBody = { model: "clef", state, questions };

  const raw = await callClef(requestBody, account, token);
  const validated = validateJudgeResponse(raw, plan);

  if (!validated.ok) {
   console.error(`  FAIL: Clef response validation failed: ${validated.reason}`);
   // Record failed proposals with insufficient verdict.
   for (const bl of batchLabels) {
    results.push({
     id: bl.id,
     answer: { risk: "routine", intent: "insufficient", collision: false },
     label: { risk: bl.label.risk, intent: bl.label.intent },
     match: { risk: false, intent: false },
     error: `validation-failed:${validated.reason}`,
    });
   }
   continue;
  }

  console.log(`  Model: ${validated.model}`);

  // Match judgments to labels by position (plan order = proposal order).
  // The wire judgment shape is the contract (plan 2.1): probabilities
  // and confidence are NOT part of JudgeJudgment — they are captured
  // for tuning evidence from the RAW model response, keyed by the
  // plan entry id for this repo's intent question.
  const rawAnswers = raw && typeof raw === "object" && raw.answers && typeof raw.answers === "object"
   ? raw.answers
   : {};
  const intentPlanIds = new Map(
   plan.filter((e) => e.kind === "choice").map((e) => [e.repo, e.id]),
  );
  for (let i = 0; i < validated.judgments.length; i++) {
   const judgment = validated.judgments[i];
   const label = batchLabels[i].label;
   const intentAnswer = intentPlanIds.has(judgment.repo)
    ? rawAnswers[intentPlanIds.get(judgment.repo)]
    : undefined;

   const answer = {
    risk: judgment.risk.label,
    intent: judgment.intent.verdict,
    collision: judgment.collision,
    // Persisted tuning evidence (2.2): raw model probabilities,
    // confidence, score, and overclaim noul — additive fields so the
    // offline threshold sweep is reproducible after the first live run.
    riskScore: judgment.risk.score,
    intentProbabilities:
     intentAnswer && typeof intentAnswer === "object" && intentAnswer.probabilities
      ? intentAnswer.probabilities
      : null,
    intentConfidence:
     intentAnswer && typeof intentAnswer === "object" && typeof intentAnswer.confidence === "number"
      ? intentAnswer.confidence
      : null,
    overclaim: judgment.intent.overclaim,
   };

   const match = {
    risk: answer.risk === label.risk,
    intent: answer.intent === label.intent,
   };

   results.push({
    id: batchLabels[i].id,
    answer,
    label: { risk: label.risk, intent: label.intent },
    match,
   });

   console.log(
    `  ${batchLabels[i].id}: risk=${answer.risk} (label=${label.risk}) ${match.risk ? "OK" : "X"} ` +
    `intent=${answer.intent} (label=${label.intent}) ${match.intent ? "OK" : "X"}`,
   );
  }
 }

 // Compute metrics.
 const predicted_risk = results.map((r) => r.answer.risk);
 const actual_risk = results.map((r) => r.label.risk);
 const predicted_intent = results.map((r) => r.answer.intent);
 const actual_intent = results.map((r) => r.label.intent);

 const { metrics: riskMetrics, confusion: riskConfusion } = perClassMetrics(
  predicted_risk, actual_risk, RISK_LABELS,
 );
 const { metrics: intentMetrics, confusion: intentConfusion } = perClassMetrics(
  predicted_intent, actual_intent, INTENT_LABELS,
 );

 const sb = shipBlockingMetrics(results.map((r) => r.answer), results.map((r) => r.label));

 // The calibration record is mechanically derived from this same run —
 // never hand-written (2.4). It records the tuned thresholds as the
 // live code constants they were judged under, the run's metrics, the
 // spike status, and the sign-off.
 let spike = { pass: false, escapes: null };
 if (existsSync(SPIKE_PATH)) {
  try {
   const spikeJson = JSON.parse(readFileSync(SPIKE_PATH, "utf8"));
   spike = {
    pass: spikeJson.pass === true,
    escapes: spikeJson.summary?.escapes ?? spikeJson.escapes ?? null,
   };
  } catch {
   spike = { pass: false, escapes: null };
  }
 }

 const output = {
  runAt: new Date().toISOString(),
  model: PINNED_MODEL_ID,
  setId: JUDGE_SET_ID,
  proposals: results,
  skipped,
  metrics: {
   perQuestion: {
    risk: riskMetrics,
    intent: intentMetrics,
   },
   confusion: {
    risk: riskConfusion,
    intent: intentConfusion,
   },
   shipBlocking: {
    class: "risk=senior-security ∪ intent=contradicts",
    precision: sb.precision,
    recall: sb.recall,
    tp: sb.tp,
    fp: sb.fp,
    fn: sb.fn,
   },
  },
 };

 writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2) + "\n");

 const record = {
  recordVersion: 1,
  setId: JUDGE_SET_ID,
  model: PINNED_MODEL_ID,
  runAt: output.runAt,
  labeledSet: {
   path: "porting/calibration/judge-v1/labels.json",
   count: labels.proposals.length,
  },
  metrics: output.metrics,
  thresholds: {
   RISK_ROUTINE_MAX,
   RISK_FOCUSED_MAX,
   COLLISION_MIN,
   INTENT_CONTRADICTS_MIN: INTENT_CONTRADICTS_MIN ?? null,
   INTENT_INSUFFICIENT_MAX: INTENT_INSUFFICIENT_MAX ?? null,
   OVERCLAIM_CONTRADICTS_MIN: OVERCLAIM_CONTRADICTS_MIN ?? null,
   CONTENT_SECRET_MIN,
   JUDGE_RATE_LIMIT,
   JUDGE_RATE_WINDOW_MS,
  },
  injectionSpike: {
   path: "porting/calibration/judge-v1/injection-spike.json",
   pass: spike.pass,
   escapes: spike.escapes,
  },
  signoff: { name: "John", date: "2026-10-10" },
 };
 writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n");

 // Summary.
 const totalMatch = results.filter((r) => r.match.risk && r.match.intent);
 const riskMatch = results.filter((r) => r.match.risk);
 const intentMatch = results.filter((r) => r.match.intent);

 console.log("\n=== Summary ===");
 console.log(`Proposals evaluated: ${results.length}`);
 console.log(`Skipped: ${skipped.length}`);
 console.log(`Risk match: ${riskMatch.length}/${results.length} (${(riskMatch.length / results.length * 100).toFixed(1)}%)`);
 console.log(`Intent match: ${intentMatch.length}/${results.length} (${(intentMatch.length / results.length * 100).toFixed(1)}%)`);
 console.log(`Full match: ${totalMatch.length}/${results.length} (${(totalMatch.length / results.length * 100).toFixed(1)}%)`);
 console.log(`Ship-blocking precision: ${sb.precision.toFixed(3)} (tp=${sb.tp}, fp=${sb.fp})`);
 console.log(`Ship-blocking recall: ${sb.recall.toFixed(3)} (tp=${sb.tp}, fn=${sb.fn})`);
 console.log(`\nResults written to: ${RESULTS_PATH}`);
 console.log(`Calibration record written to: ${RECORD_PATH}`);
}

main().catch((err) => {
 console.error("FATAL:", err.message);
 process.exit(1);
});
