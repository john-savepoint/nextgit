// porting/wf-template.ddw.js — NextGit single work-order runner (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runWorkOrder } = await import("./porting/wf-template.ddw.js");
//   await runWorkOrder({ id, title, scope, corpus, testCmd, acceptance });
//   await runWorkOrder(order, { resume: true })   // phase-granular resume (see below)
//
// Contract: PLAN → IMPLEMENT → VERIFY → GATE → HEAL (budgeted, file-partitioned) → REPORT.
// Disk is the truth: every phase writes into porting/runs/<order-id>/ + run-state.json.
// Workers never commit; the CALLER (orchestrator) commits on green.
//
// FIXES 2026-10-05 (learned from the bootstrap-health-sweep run):
//  - verdicts live in a Map keyed by lens; re-gates receive the failing lens list explicitly
//    (the old array-mutation approach mislabeled a lens as "undefined")
//  - normalizeVerdict(): schema slips (array/string/errored shapes) are coerced, never dropped
//  - heal briefs inline the extracted blockers AND name the gate reports as authoritative
//    (the old brief could be empty when a lens returned a non-object shape — it happened)
//  - resume:true skips phases whose artifacts exist (plan.md / implement.md / verify.md) and
//    ALWAYS re-runs gates; the in-flight phase restarts from scratch. Resume is never a
//    silent no-op: gates/heals execute and rewrite result.json.
//
// FIXES 2026-10-06 (heal round 4 of the same run — the claims above were not yet true):
//  - normalizeVerdict() fails CLOSED. The array branch used to take a bare verdict token and
//    shove every finding into `notes`, so ["SHIP", "HIGH: ..."] normalized to SHIP with
//    highs: [] — a green light manufactured by the very layer that exists to stop
//    mislabeling. A bare token now decides the verdict only when it is alone; every other
//    string is routed by severity prefix into shipBlockers/highs/mediums so it counts.
//  - blank strings are dropped and a verdict-less lens is BLOCK with a shipBlocker, so the
//    shipBlockers: [""] / highs: [""] recorded in this run's result.json cannot recur.
//  - the heal budget counts rounds run by THIS invocation, not heal-N.md files on disk. It
//    compared the on-disk count to the max, so resuming an order that had already spent
//    its budget could never heal again — exactly what this order is doing.
// v1 notes: sequential, single workspace; per-order worktree isolation is a recorded carry.

import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";

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

const asArr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
// Blanks are not findings: asArr([""]).map(String) yields [""], and "" counted under the
// block rule while rendering as nothing (observed in bootstrap-health-sweep result.json).
const strs = (x) => asArr(x).flat(Infinity).map((s) => (s == null ? "" : String(s)).trim()).filter(Boolean);

// Coerce whatever a lens agent returned into the verdict shape. Never drop a result:
// a non-conforming shape is BLOCK with its content preserved (schema slips were observed).
export function normalizeVerdict(lens, v, err) {
  if (err) return { lens, verdict: "BLOCK", shipBlockers: [`lens errored: ${err?.message ?? err}`], highs: [], mediums: [], notes: [] };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const shipBlockers = [...strs(v.shipBlockers ?? v.ship_blockers), ...(v.verdict == null ? ["lens returned no verdict field"] : [])];
    const highs = strs(v.highs);
    const saidShip = String(v.verdict ?? "BLOCK").toUpperCase() === "SHIP";
    // Fail CLOSED: the runner enforces the block rule itself — a lens that says SHIP while
    // listing ship-blockers or highs is inconsistent, and inconsistency blocks, never ships.
    const verdict = saidShip && shipBlockers.length === 0 && highs.length === 0 ? "SHIP" : "BLOCK";
    const notes = strs(v.notes);
    if (saidShip && verdict === "BLOCK") notes.push("lens said SHIP but listed findings — runner enforced the block rule");
    return { lens, verdict, shipBlockers, highs, mediums: strs(v.mediums), notes };
  }
  // Fail CLOSED. Nothing in a non-conforming shape is trusted as prose: a bare verdict
  // token decides the verdict only when it is alone, and every other string is routed by
  // severity prefix so it counts under the block rule.
  const route = (list) => ({
    shipBlockers: list.filter((s) => /^ship[\s-]?blocker\b/i.test(s)),
    mediums: list.filter((s) => !/^ship[\s-]?blocker\b/i.test(s) && /^med(ium)?\b/i.test(s)),
    highs: list.filter((s) => !/^ship[\s-]?blocker\b/i.test(s) && !/^med(ium)?\b/i.test(s)),
  });
  if (Array.isArray(v)) {
    const flat = strs(v);
    const findings = flat.filter((s) => !/^(SHIP|BLOCK)$/i.test(s));
    const saysShip = flat.some((s) => /^SHIP$/i.test(s));
    const { shipBlockers, highs, mediums } = route(findings);
    const verdict = findings.length === 0 && saysShip ? "SHIP" : "BLOCK";
    const cap = (arr, n) => (arr.length > n ? [...arr.slice(0, n), `(+${arr.length - n} more — see gate report)`] : arr);
    return { lens, verdict, shipBlockers: cap(shipBlockers, 4), highs: cap(highs, 12), mediums: cap(mediums, 12), notes: [] };
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^(SHIP|BLOCK)$/i.test(s)) return { lens, verdict: /SHIP/i.test(s) ? "SHIP" : "BLOCK", shipBlockers: [], highs: [], mediums: [], notes: [] };
    const { shipBlockers, highs, mediums } = route([s]);
    return { lens, verdict: "BLOCK", shipBlockers, highs, mediums, notes: [] };
  }
  // JSON.stringify(undefined) is undefined, not a string — String() before slicing.
  return { lens, verdict: "BLOCK", shipBlockers: ["unrecognized verdict shape"], highs: [], mediums: [], notes: [String(JSON.stringify(v) ?? String(v)).slice(0, 400)] };
}

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
  const resumed = opts.resume === true;
  const skip = (artifact) => resumed && existsSync(`${runDir}/${artifact}`);

  let heals = 0;
  let healedThisRun = 0;
  if (resumed) {
    try { for (const f of readdirSync(runDir)) { const m = f.match(/^heal-(\d+)\.md$/); if (m) heals = Math.max(heals, Number(m[1])); } } catch {}
  }
  const writeState = (phase, extra = {}) =>
    writeFileSync(`${runDir}/run-state.json`, JSON.stringify({ order: order.id, title: order.title, phase, healRound: heals, resumed, updatedAt: new Date().toISOString(), ...extra }, null, 2));

  phase(`ORDER ${order.id}: ${order.title}${resumed ? " (resume)" : ""}`);
  writeState(resumed ? "resume-scan" : "plan");

  // ---- PLAN ----------------------------------------------------------------
  if (!skip("plan.md")) await agent(
    `PLAN phase for work order "${order.id}" — ${order.title}.\n` +
      `Scope + acceptance: ${order.scope}\n${order.acceptance}\n` +
      `Corpus (read first): ${corpus}. Repo root: ${root}.\n` +
      `Write a file-level plan to ${runDir}/plan.md (files touched, exact changes, the check that proves it). ` +
      `Do NOT implement anything yet. Do NOT commit. Return only a <=5 line summary.`,
    { agent: agentType, label: `plan:${order.id}` },
  ).wait();

  // ---- IMPLEMENT -----------------------------------------------------------
  if (!skip("implement.md")) await agent(
    `IMPLEMENT phase of ${order.id} per ${runDir}/plan.md.\n` +
      `Smallest correct diffs; respect existing patterns. Run the order's focused check: ${order.testCmd} (cwd ${root}).\n` +
      `Write the report — changes + the check's VERBATIM output — to ${runDir}/implement.md. Do NOT commit. Return a <=5 line summary.`,
    { agent: agentType, label: `impl:${order.id}` },
  ).wait();

  // ---- VERIFY (fresh eyes, no fixes) --------------------------------------
  if (!skip("verify.md")) await agent(
    `VERIFY phase of ${order.id}. You are a FRESH verifier: do not fix anything.\n` +
      `Run ${order.testCmd} (cwd ${root}) and write the VERBATIM output + a PASS/FAIL judgement to ${runDir}/verify.md. ` +
      `Also state whether the acceptance for "${order.title}" is observably met: ${order.acceptance}. Return only the verdict line.`,
    { agent: agentType, label: `verify:${order.id}` },
  ).wait();

  // ---- GATE (lens set; explicit lens list per pass; missing/errored = BLOCK) ----
  const gatePass = async (round, lensList) => {
    writeState(`gate:${round}`);
    const handles = lensList.map((lens) =>
      agent(
        `GATE lens "${lens}" for work order ${order.id} (${order.title}). Round ${round}.\n` +
          `Review the change set in ${root} (git diff vs the batch base; read ${runDir}/plan.md, implement.md, verify.md).\n` +
          `Block rule: 0 ship-blockers + 0 highs = SHIP. Attribution: only reds INTRODUCED by this order block — a red identical at the batch base (porting/runs/base-red.json plus the standing red set in docs/STATE.md) is a HIGH with a named owner, not a blocker.\n` +
          `Write the verdict to ${runDir}/gate-${lens}.md AND return it as the structured object {lens, verdict, shipBlockers, highs, mediums, notes} — objects only, no arrays, no prose.`,
        { agent: agentType, label: `gate:${lens}:${order.id}`, schema: LENS_SCHEMA },
      ),
    );
    const settled = await wait(handles, { raiseErrors: false });
    const out = new Map();
    lensList.forEach((lens, i) => {
      const s = settled[i];
      out.set(lens, s instanceof Error ? normalizeVerdict(lens, null, s) : normalizeVerdict(lens, s));
      if (out.get(lens).verdict !== "SHIP" && s && !(s instanceof Error) && typeof s !== "object") {
        out.get(lens).notes.push("verdict shape was coercible but non-conforming — see gate-" + lens + ".md");
      }
    });
    return out;
  };

  const verdicts = await gatePass(resumed ? heals : 0, lenses);

  // ---- HEAL (file-partitioned, budgeted) -----------------------------------
  while (healedThisRun < healMax && [...verdicts.values()].some((v) => v.verdict !== "SHIP")) {
    heals++;
    healedThisRun++;
    writeState("heal", { healRound: heals });
    const blockers = [...verdicts.values()]
      .filter((v) => v.verdict !== "SHIP")
      .flatMap((v) => [...(v.shipBlockers ?? []), ...(v.highs ?? [])])
      .filter(Boolean);
    await agent(
      `HEAL round ${heals} for ${order.id}.\n` +
        `The AUTHORITATIVE findings are the gate reports in ${runDir}/gate-*.md — read them first; the inline list below may be partial.\n` +
        `Inline (extracted, may be empty): ${blockers.length ? blockers.join(" | ") : "(none extracted — use the gate reports)"}\n` +
        `Group findings by file; ONE writer per file per wave; <=10 files; fix only what the findings name.\n` +
        `Re-run ${order.testCmd} after the wave. Write ${runDir}/heal-${heals}.md (fixes + verbatim output). Do NOT commit. <=5 line summary.`,
      { agent: agentType, label: `heal:${order.id}:${heals}` },
    ).wait();

    writeState("re-verify", { healRound: heals });
    await agent(`Re-run ${order.testCmd} (cwd ${root}) after heal round ${heals}; append the VERBATIM output to ${runDir}/verify.md. Do not fix anything.`, {
      agent: agentType,
      label: `reverify:${order.id}:${heals}`,
    }).wait();

    const failed = [...verdicts.entries()].filter(([, v]) => v.verdict !== "SHIP").map(([lens]) => lens);
    const re = await gatePass(heals, failed);
    for (const [lens, v] of re) verdicts.set(lens, v);
  }

  const blocked = [...verdicts.values()].some((v) => v.verdict !== "SHIP");
  const result = {
    order: order.id,
    title: order.title,
    verdict: blocked ? (healedThisRun >= healMax ? "BLOCKED (heal budget exhausted)" : "BLOCKED") : "GREEN",
    heals,
    healsThisRun: healedThisRun,
    resumed,
    lensesRun: lenses,
    healMax,
    lenses: Object.fromEntries(
      [...verdicts.entries()].map(([lens, v]) => [lens, { verdict: v.verdict, shipBlockers: v.shipBlockers, highs: v.highs, mediums: v.mediums }]),
    ),
    next: blocked
      ? `recorded block — blockers: ${[...verdicts.values()].flatMap((v) => [...(v.shipBlockers ?? []), ...(v.highs ?? [])]).filter(Boolean).slice(0, 3).join(" | ") || "(see gate reports)"}`
      : "ALL GREEN — caller may commit + tick the queue row",
    evidence: `${runDir}/`,
  };
  writeFileSync(`${runDir}/result.json`, JSON.stringify(result, null, 2));
  writeState(blocked ? "blocked" : "green");
  log(`${order.id}: ${result.verdict} (heals: ${heals}${resumed ? ", resumed" : ""})`);
  return result;
}
