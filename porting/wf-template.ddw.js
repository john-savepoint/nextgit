// porting/wf-template.ddw.js — NextGit single work-order runner (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runWorkOrder } = await import("./porting/wf-template.ddw.js");
//   await runWorkOrder({ id, title, scope, corpus, testCmd, acceptance });
//
// Contract: PLAN → IMPLEMENT → VERIFY → GATE → HEAL (budgeted, file-partitioned) → REPORT.
// Disk is the truth: every phase writes into porting/runs/<order-id>/ + run-state.json.
// Workers never commit; the CALLER (orchestrator) commits on green.
// v1 note: sequential, single workspace; per-order worktree isolation is a recorded carry.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

export const DEFAULT_LENSES = ["quality", "spec-fit", "security", "resilience"]; // scale down, never to zero
const LENS_SCHEMA = {
  type: "object",
  required: ["lens", "verdict", "shipBlockers", "highs", "mediums", "notes"],
  properties: {
    lens: { type: "string" },
    verdict: { enum: ["SHIP", "BLOCK"] },
    shipBlockers: { type: "array", items: { type: "string" } },
    highs: { type: "array", items: { type: "string" } },
    mediums: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
};

export async function runWorkOrder(order, opts = {}) {
  const root = opts.root ?? process.cwd();
  const healMax = opts.healMax ?? 3;
  const lenses = opts.lenses ?? DEFAULT_LENSES;
  const agentType = opts.agent ?? "task";
  const runDir = `${root}/porting/runs/${order.id}`;
  mkdirSync(runDir, { recursive: true });

  if (!order.id || !order.title || !order.testCmd || !order.acceptance) {
    throw new Error("work order incomplete: id, title, testCmd and acceptance are required (no order ships without a check)");
  }
  const corpus = (order.corpus ?? [`${root}/docs/STATE.md`, `${root}/platform/CONTRACT.md`]).join(", ");
  let heals = 0;
  const writeState = (phase, extra = {}) =>
    writeFileSync(`${runDir}/run-state.json`, JSON.stringify({ order: order.id, title: order.title, phase, healRound: heals, updatedAt: new Date().toISOString(), ...extra }, null, 2));

  phase(`ORDER ${order.id}: ${order.title}`);
  writeState("plan");

  // ---- PLAN ----------------------------------------------------------------
  await agent(
    `PLAN phase for work order "${order.id}" — ${order.title}.\n` +
      `Scope + acceptance: ${order.scope}\n${order.acceptance}\n` +
      `Corpus (read first): ${corpus}. Repo root: ${root}.\n` +
      `Write a file-level plan to ${runDir}/plan.md (files touched, exact changes, the check that proves it). ` +
      `Do NOT implement anything yet. Do NOT commit. Return only a <=5 line summary.`,
    { agent: agentType, label: `plan:${order.id}` },
  ).wait();

  // ---- IMPLEMENT -----------------------------------------------------------
  writeState("implement");
  await agent(
    `IMPLEMENT phase of ${order.id} per ${runDir}/plan.md.\n` +
      `Smallest correct diffs; respect existing patterns. Run the order's focused check: ${order.testCmd} (cwd ${root}).\n` +
      `Write the report — changes + the check's VERBATIM output — to ${runDir}/implement.md. Do NOT commit. Return a <=5 line summary.`,
    { agent: agentType, label: `impl:${order.id}` },
  ).wait();

  // ---- VERIFY (fresh eyes, no fixes) --------------------------------------
  writeState("verify");
  await agent(
    `VERIFY phase of ${order.id}. You are a FRESH verifier: do not fix anything.\n` +
      `Run ${order.testCmd} (cwd ${root}) and write the VERBATIM output + a PASS/FAIL judgement to ${runDir}/verify.md. ` +
      `Also state whether the acceptance for "${order.title}" is observably met: ${order.acceptance}. Return only the verdict line.`,
    { agent: agentType, label: `verify:${order.id}` },
  ).wait();

  // ---- GATE (lens set, parallel; a missing verdict is BLOCK) ---------------
  const gatePass = async (round) => {
    writeState(`gate:${round}`);
    const handles = lenses.map((lens) =>
      agent(
        `GATE lens "${lens}" for work order ${order.id} (${order.title}). Round ${round}.\n` +
          `Review the change set in ${root} (git diff vs the batch base; read ${runDir}/plan.md, implement.md, verify.md).\n` +
          `Block rule: 0 ship-blockers + 0 highs = SHIP. Attribution: only reds INTRODUCED by this order block — a red identical at the batch base (porting/runs/base-red.json plus the standing red set in docs/STATE.md) is recorded as a HIGH with a named owner, not a blocker.\n` +
          `Write the same verdict to ${runDir}/gate-${lens}.md. Schema-return {lens, verdict, shipBlockers, highs, mediums, notes}.`,
        { agent: agentType, label: `gate:${lens}:${order.id}`, schema: LENS_SCHEMA },
      ),
    );
    const settled = await wait(handles, { raiseErrors: false });
    return lenses.map((lens, i) => (settled[i] instanceof Error ? { lens, verdict: "BLOCK", shipBlockers: [`lens errored: ${settled[i].message}`], highs: [], mediums: [], notes: [] } : settled[i]));
  };

  let verdicts = await gatePass(0);

  // ---- HEAL (file-partitioned, budgeted) -----------------------------------
  while (heals < healMax && verdicts.some((v) => v.verdict !== "SHIP")) {
    heals++;
    writeState("heal", { healRound: heals });
    const blockers = verdicts.filter((v) => v.verdict !== "SHIP").flatMap((v) => v.shipBlockers ?? []);
    await agent(
      `HEAL round ${heals} for ${order.id}. Blocking findings:\n- ${blockers.join("\n- ")}\n\n` +
        `Group findings by file; ONE writer per file per wave; <=10 files this wave; fix only what the findings name.\n` +
        `Re-run ${order.testCmd} after the wave. Write ${runDir}/heal-${heals}.md (fixes + verbatim output). Do NOT commit. <=5 line summary.`,
      { agent: agentType, label: `heal:${order.id}:${heals}` },
    ).wait();
    // re-verify + re-gate ONLY the previously failing lenses
    writeState("re-verify", { healRound: heals });
    await agent(`Re-run ${order.testCmd} (cwd ${root}) after heal round ${heals}; append verbatim output to ${runDir}/verify.md. Do not fix.`, {
      agent: agentType, label: `reverify:${order.id}:${heals}` }).wait();
    const failed = verdicts.filter((v) => v.verdict !== "SHIP").map((v) => v.lens);
    const prevLenses = lenses.slice();
    lenses.length = 0; lenses.push(...failed);
    const re = await gatePass(heals);
    lenses.length = 0; lenses.push(...prevLenses);
    verdicts = verdicts.map((v) => re.find((r) => r.lens === v.lens) ?? v);
  }

  const blocked = verdicts.some((v) => v.verdict !== "SHIP");
  const result = {
    order: order.id,
    title: order.title,
    verdict: blocked ? (heals >= healMax ? "BLOCKED (heal budget exhausted)" : "BLOCKED") : "GREEN",
    heals,
    lenses: Object.fromEntries(verdicts.map((v) => [v.lens, { verdict: v.verdict, shipBlockers: v.shipBlockers, highs: v.highs }])),
    next: blocked ? `heal exhausted or recorded — blockers: ${verdicts.flatMap((v) => v.shipBlockers ?? []).slice(0, 3).join(" | ")}` : "ALL GREEN — caller may commit + tick the queue row",
    evidence: `${runDir}/`,
  };
  writeFileSync(`${runDir}/result.json`, JSON.stringify(result, null, 2));
  writeState(blocked ? "blocked" : "green");
  log(`${order.id}: ${result.verdict} (heals: ${heals})`);
  return result;
}
