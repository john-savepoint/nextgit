// porting/wf-template.ddw.js — NextGit single work-order runner (DDW, handle era). v3
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runWorkOrder } = await import("./porting/wf-template.ddw.js");
//   await runWorkOrder({ id, title, scope, corpus, testCmd, acceptance });
//   await runWorkOrder(order, { resume: true })   // phase-granular resume (see below)
//   await runWorkOrder(order, { lenses: FULL_LENSES, agents: { plan: "task" } })  // overrides
//
// Contract: PLAN → IMPLEMENT → VERIFY → GATE → HEAL (budgeted, file-partitioned) → REPORT.
// Disk is the truth: every phase writes into porting/runs/<order-id>/ + run-state.json.
// Workers never commit; the CALLER (orchestrator) commits on green.
//
// v3 (2026-10-06) — specialist roster + read-only protocol:
//  - ROUTING: phases spawn their specialist agent type (plan-agent / wf-implementer /
//    wf-verifier / heal-researcher / per-lens reviewers). See DEFAULT_AGENTS. Legacy
//    opts.agent still forces one type for all phases (blunt mode, kept for fallback).
//  - READ-ONLY PROTOCOL: most specialists cannot write files. The RUNNER persists every
//    artifact from schema-validated returns (plan.md, verify.md, gate-*.md, heal-N-research.md);
//    only wf-implementer (write+edit tools) writes implement.md / heal-N.md itself.
//  - HEAL SPLIT: heal-researcher proposes (read-only) → wf-implementer applies (one writer
//    per file) → wf-verifier re-verifies → failed lenses re-gate.
//  - PINNED-SHAPE ADAPTER: the fork's reviewer defs yield {verdict: PASS|WARN|FAIL, findings[]};
//    normalizeVerdict maps that (FAIL/CRITICAL/HIGH → BLOCK) instead of dropping it.
//  - SKILL HINTS are named in phase prompts. Recorded skill gaps: compliance / resilience /
//    spec-fit / parity lenses have no dedicated skill — the prompt carries the lens text.
//
// v2 (2026-10-05/06) fixes preserved: fail-CLOSED normalizeVerdict (SHIP with listed findings
//  is overridden to BLOCK; blanks are not findings), verdicts in a Map keyed by lens, resume
//  skips plan/implement/verify artifacts + counts heal artifacts as implement record, heal
//  budget counted per invocation, loud implement guard, truncation markers, lensesRun recorded.
// v1 note: sequential, single workspace; per-order worktree isolation remains a recorded carry.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";

// Full gate battery (reference: security · quality+architecture · spec-fit · compliance ·
// resilience ×2 · + project extras parity/ux). Default = scaled-down 4 (never zero).
export const FULL_LENSES = ["security", "quality", "spec-fit", "compliance", "resilience", "resilience-2"];
export const DEFAULT_LENSES = ["quality", "spec-fit", "security", "resilience"];

export const DEFAULT_AGENTS = {
  plan: "plan-agent",
  implement: "wf-implementer",
  verify: "wf-verifier",
  healResearch: "heal-researcher",
  healApply: "wf-implementer",
  fallback: "task",
  mergedGate: "senior-reviewer",
  lens: {
    security: "security-reviewer",
    quality: "senior-reviewer",
    "spec-fit": "reviewer",
    compliance: "compliance-reviewer",
    resilience: "senior-reviewer",
    "resilience-2": "reviewer",
    parity: "parity-auditor",
    ux: "designer",
  },
};

// Skill packs per phase/lens (mapping pass 2026-10-06; full ratings in
// porting/runs/agent-skill-map/*.json). Names + paths are also recorded in .omp/agents.md —
// some live in plugin caches the skill router may miss, so the prompt names them explicitly.
export const SKILL_HINTS = {
  plan: "writing-plans + security-design-review (STRIDE for scoping)",
  implement: "workers-best-practices + typescript-professional (+ cloudflare when a bound product is touched)",
  healApply: "workers-best-practices + typescript-professional",
  verify: "verification-before-completion (+ full-output-enforcement: report EVERY failure line)",
  healResearch: "systematic-debugging + receiving-code-review",
  mergedGate: "typescript-professional + concurrency-pro",
  lens: {
    security: "claude-code-security-review + security-design-review",
    quality: "typescript-professional + concurrency-pro",
    "spec-fit": "bmad-review (pin the edge-case + verification-gap lenses)",
    compliance: "compliance (web-analytics when tracking/consent surfaces are touched)",
    parity: "git-pro (range-diff for lost behavior)",
    ux: "impeccable + design-taste-frontend + accessibility-pro (pick one per run) + stitch-design (Open Design Bridge: catalogue → Stitch MCP render; for brand-grade/demo surfaces)",
  },
};

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
const PLAN_SCHEMA = { type: "object", required: ["plan", "summary"], properties: { plan: { type: "string" }, summary: { type: "string" } } };
const VERIFY_SCHEMA = { type: "object", required: ["verdict", "evidence"], properties: { verdict: { enum: ["PASS", "FAIL"] }, evidence: { type: "string" }, notes: { type: "array", items: { type: "string" } } } };
const HEAL_RESEARCH_SCHEMA = { type: "object", required: ["proposals"], properties: { proposals: { type: "string" } } };

const asArr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
// Blanks are not findings: asArr([""]).map(String) yields [""], and "" counted under the
// block rule while rendering as nothing (observed in bootstrap-health-sweep result.json).
const strs = (x) => asArr(x).flat(Infinity).map((s) => (s == null ? "" : String(s)).trim()).filter(Boolean);

// Coerce whatever a lens agent returned into the verdict shape. Never drop a result:
// a non-conforming shape is BLOCK with its content preserved (schema slips were observed).
export function normalizeVerdict(lens, v, err) {
  if (err) return { lens, verdict: "BLOCK", shipBlockers: [`lens errored: ${err?.message ?? err}`], highs: [], mediums: [], notes: [] };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // Adapter: the fork's reviewer defs pin shapes — {verdict: PASS|WARN|FAIL, findings:[{severity|issue}]}
    // and reviewer's {overall_correctness: CORRECT|INCORRECT, explanation, confidence}.
    // FAIL/INCORRECT or any CRITICAL/HIGH finding blocks; WARN + non-high findings ships with records.
    // Findings may be objects (severity|level|issue) or strings ("HIGH: ...") — both severity-routed.
    const oc = String(v.overall_correctness ?? "").toUpperCase();
    const pinVerdict = String(v.verdict ?? "").toUpperCase();
    if ((["PASS", "WARN", "FAIL"].includes(pinVerdict) && Array.isArray(v.findings)) || oc) {
      const findings = asArr(v.findings);
      const sevOf = (f) => typeof f === "string"
        ? (String(f).match(/^(CRITICAL|HIGH|MEDIUM|LOW)\b/i)?.[1]?.toUpperCase() ?? "")
        : String(f?.severity ?? f?.level ?? "").toUpperCase();
      const tagOf = (f) => typeof f === "string" ? f : String(f?.title ?? f?.issue ?? f?.summary ?? JSON.stringify(f));
      const crit = findings.filter((f) => /CRITICAL|HIGH/.test(sevOf(f))).map(tagOf);
      const nonHigh = findings.filter((f) => !/CRITICAL|HIGH/.test(sevOf(f))).map(tagOf);
      const ocWrong = oc !== "" && oc !== "CORRECT";
      const failed = pinVerdict === "FAIL" || ocWrong;
      const shipBlockers = crit.length > 0 ? crit : failed ? [String(v.summary ?? v.explanation ?? "lens FAIL")] : [];
      const notes = [];
      if (v.reportPath) notes.push(`reportPath: ${v.reportPath}`);
      if (oc && oc !== "CORRECT" && oc !== "INCORRECT") notes.push(`unrecognized overall_correctness: ${oc}`);
      return { lens, verdict: failed || crit.length > 0 ? "BLOCK" : "SHIP", shipBlockers, highs: [], mediums: nonHigh.slice(0, 12), notes };
    }
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
  const ag = {
    ...DEFAULT_AGENTS,
    ...(opts.agents ?? {}),
    lens: { ...DEFAULT_AGENTS.lens, ...(opts.agents?.lens ?? {}) },
  };
  // Legacy blunt mode: opts.agent forces ONE type for every phase.
  if (opts.agent) { for (const k of ["plan", "implement", "verify", "healResearch", "healApply"]) ag[k] = opts.agent; ag.fallback = opts.agent; }
  const lensAgent = (lens) => ag.lens[lens] ?? ag.fallback;
  const evidenceRoot = opts.evidenceRoot ?? root;
  const runDir = `${evidenceRoot}/porting/runs/${order.id}`;
  mkdirSync(runDir, { recursive: true });

  if (!order.id || !order.title || !order.testCmd || !order.acceptance) {
    throw new Error("work order incomplete: id, title, testCmd and acceptance are required (no order ships without a check)");
  }
  const corpus = (order.corpus ?? [`${root}/docs/STATE.md`, `${root}/platform/CONTRACT.md`]).join(", ");
  const SCOPE_LAW = `WORKSPACE LAW: your workspace root is ${root}; ALL code/file reads and writes MUST stay under it. NEVER write code outside it — especially never into /home/johnzealanddoyle/projects/cloudflare-git-comp unless that IS your workspace root (a parallel run may own that tree). Exception (required): write YOUR phase reports/verdicts to the run-evidence directory ${runDir} — that is the only permitted path outside your workspace root.\n`;
  const resumed = opts.resume === true;
  const skip = (artifact) => resumed && existsSync(`${runDir}/${artifact}`);
  // IMPLEMENT also counts a completed heal round as its record: a healed run must not
  // re-implement over landed code on resume (observed: mute IMPLEMENT + heal-1 landed the work).
  const implDone = () => skip("implement.md") || (resumed && readdirSync(runDir).some((f) => /^heal-\d+\.md$/.test(f)));

  let heals = 0;
  let healedThisRun = 0;
  if (resumed) {
    try { for (const f of readdirSync(runDir)) { const m = f.match(/^heal-(\d+)\.md$/); if (m) heals = Math.max(heals, Number(m[1])); } } catch { }
  }
  const writeState = (phase, extra = {}) =>
    writeFileSync(`${runDir}/run-state.json`, JSON.stringify({ order: order.id, title: order.title, phase, healRound: heals, resumed, updatedAt: new Date().toISOString(), ...extra }, null, 2));

  phase(`ORDER ${order.id}: ${order.title}${resumed ? " (resume)" : ""}`);
  writeState(resumed ? "resume-scan" : "plan", { agents: { plan: ag.plan, implement: ag.implement, verify: ag.verify, healResearch: ag.healResearch, healApply: ag.healApply } });

  // ---- PLAN (plan-agent: read-only → returns; runner persists) --------------
  if (!skip("plan.md")) {
    const p = await agent(
      `${SCOPE_LAW}` +
      `PLAN phase for work order "${order.id}" — ${order.title}.\n` +
      `Scope + acceptance: ${order.scope}\n${order.acceptance}\n` +
      `Corpus (read first): ${corpus}. Repo root: ${root}.\n` +
      `Produce a file-level plan (files touched, exact changes, the check that proves it) and return it as {plan: "<full plan markdown>", summary: "<<=5 lines>"}. ` +
      `Skills: apply ${SKILL_HINTS.plan} (paths in .omp/agents.md if the router misses them).\n` +
      `Do NOT implement anything yet. Do NOT commit.`,
      { agent: ag.plan, label: `plan:${order.id}`, schema: PLAN_SCHEMA },
    ).wait();
    const planText = typeof p === "string" ? p : (p?.plan ?? JSON.stringify(p, null, 2));
    writeFileSync(`${runDir}/plan.md`, planText);
    log(`plan: ${String(typeof p === "object" ? (p?.summary ?? "") : "").slice(0, 200)}`);
  }

  // ---- IMPLEMENT (wf-implementer: has write; writes implement.md itself) ----
  if (!implDone()) await agent(
    `${SCOPE_LAW}` +
    `IMPLEMENT phase of ${order.id} per ${runDir}/plan.md.\n` +
    `Smallest correct diffs; respect existing patterns. Skills: ${SKILL_HINTS.implement}. Run the order's focused check: ${order.testCmd} (cwd ${root}).\n` +
    `Write the report — changes + the check's VERBATIM output — to ${runDir}/implement.md. Do NOT commit. Return a <=5 line summary.`,
    { agent: ag.implement, label: `impl:${order.id}` },
  ).wait();
  // Loud phase guard: a mute IMPLEMENT (observed once — the agent wrote nothing) must not fail silent.
  if (!existsSync(`${runDir}/implement.md`)) {
    writeState("implement-no-artifact", { guard: "IMPLEMENT wrote no implement.md — gates will see an empty change set; heal artifacts count as the implement record on resume" });
  }

  // ---- VERIFY (wf-verifier: mechanical; runner persists) --------------------
  const runVerify = async (label) => {
    const v = await agent(
      `${SCOPE_LAW}` +
      `VERIFY phase of ${order.id} (${label}). You are a FRESH verifier: do not fix anything.\n` +
      `Run ${order.testCmd} (cwd ${root}) and return {verdict: "PASS"|"FAIL", evidence: "<the VERBATIM output>", notes: [...]}. ` +
      `Per ${SKILL_HINTS.verify}: evidence is the executed command + raw output, nothing paraphrased. ` +
      `Also state whether the acceptance is observably met: ${order.acceptance}`,
      { agent: ag.verify, label: `verify:${order.id}:${label}`, schema: VERIFY_SCHEMA },
    ).wait();
    // Prefer the caller-schema verdict over the def's pinned `clean` flag — the pinned flag is
    // fork-specific (its <=7 testFailures exemption can record a verdict unrelated to this
    // order's testCmd; gate finding 2026-10-06, wf-v3-selftest quality lens).
    const verdict = typeof v === "object" && v ? (v.verdict ?? (v.clean !== undefined ? (v.clean ? "PASS" : "FAIL") : "UNKNOWN")) : "UNKNOWN";
    const evidence = typeof v === "string" ? v : (v?.evidence ?? JSON.stringify(v, null, 2));
    appendFileSync(`${runDir}/verify.md`, `\n\n## VERIFY — ${label} @ ${new Date().toISOString()}\nverdict: ${verdict}\n\n${evidence}\n`);
    writeState(`verify:${label}`, { verifyVerdict: verdict });
    return verdict;
  };
  if (!skip("verify.md")) await runVerify("phase");

  // ---- GATE (lens set; specialist per lens; missing/errored = BLOCK) --------
  const gatePass = async (round, lensList) => {
    writeState(`gate:${round}`);
    const handles = lensList.map((lens) =>
      agent(
        `${SCOPE_LAW}` +
        `GATE lens "${lens}" for work order ${order.id} (${order.title}). Round ${round}.\n` +
        `Review the change set in ${root} (git diff vs the batch base; read ${runDir}/plan.md, implement.md, verify.md).` +
        (SKILL_HINTS.lens[lens] ? ` Apply: ${SKILL_HINTS.lens[lens]}.` : "") +
        (lens === "parity"
          ? " PARITY semantics: compare the current tree against the batch base — list any behavior, file, endpoint, capability, or output REMOVED or weakened. A removal blocks UNLESS this order's scope/acceptance declares it (intentional replacement) or an adequate covering test still passes (tests substitute for manual comparison); with neither, it is a ship-blocker. The rule is: this build must be ≥ the previous build. Competitor mode: compare against the GitHub baseline feature list in the research dossiers."
          : "") + "\n" +
        `Block rule: 0 ship-blockers + 0 highs = SHIP. Attribution: only reds INTRODUCED by this order block — a red identical at the batch base (porting/runs/base-red.json plus the standing red set in docs/STATE.md) is a HIGH with a named owner, not a blocker.\n` +
        `Do NOT write files — the runner records your verdict. Return ONLY the object {lens, verdict, shipBlockers, highs, mediums, notes} (objects only, no arrays, no prose).`,
        { agent: lensAgent(lens), label: `gate:${lens}:${order.id}`, schema: LENS_SCHEMA },
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
      // Persist the verdict file ourselves: reviewer defs are read-only.
      writeFileSync(`${runDir}/gate-${lens}.md`, JSON.stringify(out.get(lens), null, 2));
    });
    return out;
  };

  const verdicts = await gatePass(resumed ? heals : 0, lenses);

  // ---- HEAL (research → apply → re-verify → re-gate failed lenses) ----------
  while (healedThisRun < healMax && [...verdicts.values()].some((v) => v.verdict !== "SHIP")) {
    heals++;
    healedThisRun++;
    writeState("heal-research", { healRound: heals });
    const blockers = [...verdicts.values()]
      .filter((v) => v.verdict !== "SHIP")
      .flatMap((v) => [...(v.shipBlockers ?? []), ...(v.highs ?? [])])
      .filter(Boolean);
    const hr = await agent(
      `${SCOPE_LAW}` +
      `HEAL research round ${heals} for ${order.id} (skills: ${SKILL_HINTS.healResearch} — root cause before fix).\n` +
      `The AUTHORITATIVE findings are the gate reports in ${runDir}/gate-*.md — read them first; the inline list below may be partial.\n` +
      `Inline (extracted, may be empty): ${blockers.length ? blockers.join(" | ") : "(none extracted — use the gate reports)"}\n` +
      `For each blocking finding return a minimal fix: finding → file:line → the repo-sibling pattern to follow. Do NOT edit files.\n` +
      `Return {proposals: "<full markdown>"}.`,
      { agent: ag.healResearch, label: `heal-research:${order.id}:${heals}`, schema: HEAL_RESEARCH_SCHEMA },
    ).wait();
    writeFileSync(`${runDir}/heal-${heals}-research.md`, String(typeof hr === "object" ? (hr?.proposals ?? JSON.stringify(hr, null, 2)) : hr));

    writeState("heal", { healRound: heals });
    await agent(
      `${SCOPE_LAW}` +
      `HEAL apply round ${heals} for ${order.id}. Read ${runDir}/heal-${heals}-research.md and the gate reports; apply the minimal fixes. Skills: ${SKILL_HINTS.healApply}.\n` +
      `Group by file; ONE writer per file per wave; <=10 files; fix only what the findings name. Run ${order.testCmd} after the wave.\n` +
      `Write ${runDir}/heal-${heals}.md (fixes + verbatim output). Do NOT commit. <=5 line summary.`,
      { agent: ag.healApply, label: `heal:${order.id}:${heals}` },
    ).wait();

    writeState("re-verify", { healRound: heals });
    await runVerify(`heal-${heals}`);

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
    agentsRun: { plan: ag.plan, implement: ag.implement, verify: ag.verify, healResearch: ag.healResearch, healApply: ag.healApply, lens: Object.fromEntries(lenses.map((l) => [l, lensAgent(l)])) },
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
