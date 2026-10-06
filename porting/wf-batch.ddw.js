// porting/wf-batch.ddw.js — NextGit batch driver over the queue (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runBatch } = await import("./porting/wf-batch.ddw.js"); await runBatch({ limit: 1 });
//
// Picks the first N `pending` rows from the task store (porting/tasks.db; md fallback
// docs/NEXT-ACTIONS.md), runs each through runWorkOrder
// (direct composition — the sub-driver returns a result promise, wait() is not involved),
// then a MERGED gate over the union. The CALLER ticks rows + commits — this driver never does.
// v1 note: orders run SEQUENTIALLY in one workspace; per-order worktree isolation + parallel
// orders are a recorded carry (see docs/STATE.md).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DEFAULT_TEST = "node --check platform/ui/app.js && node --check platform/ui/tour.js";
const DEFAULT_CORPUS = [
  "docs/STATE.md",
  "docs/CHECKPOINT.md",
  "_bmad-output/specs/spec-next-git-platform/SPEC.md",
  "platform/CONTRACT.md",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const extractCheck = (scope) => { const m = scope.match(/check:\s*(.+)$/i); return m ? m[1].trim().replace(/[.]$/, "") : null; };

// Queue source for runBatch: the DB is authoritative when it exists (even when empty —
// an empty store returns NO PENDING ROWS, never a silent stale-md re-read); the md parser
// is the fallback only when the store is absent or the CLI read throws.
export function readQueueRows(root = process.cwd(), { sourceLike } = {}) {
  const dbPath = process.env.TASKS_DB ?? `${root}/porting/tasks.db`;
  if (existsSync(dbPath)) {
    try {
      // execFileSync (no shell interpolation — space/metachar-safe) + a bounded wait.
      // Live-claimed rows are skipped: another session owns them (claims are the collision guard).
      const out = execFileSync("bun", [`${root}/porting/tasks.mjs`, "list", "--status", "pending", "--json"],
        { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, TASKS_DB: dbPath } });
      // Dep-aware scheduling (mirrors `tasks.mjs next`): a row whose deps are not all done is
      // NOT runnable yet — skipped, never picked, and reported in `gated`. If the done-set read
      // fails, every dep-carrying row is gated (fail closed; never run a dependent early).
      let done = new Set();
      try {
        const dq = execFileSync("bun", [`${root}/porting/tasks.mjs`, "query", "SELECT id FROM tasks WHERE status IN ('done','remediated')"],
          { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, TASKS_DB: dbPath } });
        done = new Set(JSON.parse(dq).map((r) => r.id));
      } catch { }
      let mapped = out.trim()
        ? JSON.parse(out)
          .filter((r) => r.claimed_by == null)
          .map((r) => ({ id: r.id, priority: r.priority ?? "P3", title: r.title, scope: r.scope ?? "", acceptance: r.acceptance ?? null, check: r.check_cmd, deps: r.deps ?? null, source: r.source ?? null, epic: r.epic_id ?? null }))
        : [];
      if (sourceLike) mapped = mapped.filter((r) => (r.source ?? "").startsWith(sourceLike));
      const gated = [];
      const rows = mapped.filter((r) => {
        const deps = (r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) { gated.push({ id: r.id, unmet }); return false; }
        return true;
      });
      return { source: "db", rows, gated };
    } catch (e) {
      console.error(`wf-batch: DB queue read failed (${e.message}); falling back to docs/NEXT-ACTIONS.md`);
    }
  }
  const rows = [];
  for (const line of readFileSync(`${root}/docs/NEXT-ACTIONS.md`, "utf8").split("\n")) {
    const m = line.match(/^- \[pending\]\s*(P[0-3])\s*—\s*(.+)$/);
    if (!m) continue;
    const rest = m[2];
    const cut = rest.indexOf(" — ");
    rows.push({ priority: m[1], title: (cut === -1 ? rest : rest.slice(0, cut)).trim(), scope: cut === -1 ? "" : rest.slice(cut + 3).trim() });
  }
  return { source: "md", rows };
}

// The `agent` OPTION is bound as `agentOpt` on purpose: the bare name `agent` must stay the DDW
// spawn global that the batch-level gates below call (shadowing it crashed every batch at the
// parity gate — `TypeError: agent is not a function`).
export async function runBatch({ limit = 1, root = process.cwd(), lenses, agent: agentOpt, agents, resume, sourceLike } = {}) {
  const { runWorkOrder, normalizeVerdict, SKILL_HINTS } = await import(`${root}/porting/wf-template.ddw.js`);
  mkdirSync(`${root}/porting/runs`, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = `${root}/porting/runs/batch-${ts}`;
  mkdirSync(batchDir, { recursive: true });
  // Parity baseline: the commit BEFORE the batch ran. The almost-last gate compares against it.
  let preBatchCommit = "";
  try { preBatchCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10000 }).trim(); } catch { }

  // --- queue (DB preferred; md fallback on a store fault) --------------------
  const { source: queueSource, rows, gated = [] } = readQueueRows(root, { sourceLike });

  // --- claim the picks (contended rows are skipped; released after running) --
  // Two sessions running batches must never pick the same row: claims are the guard.
  const dbPath = process.env.TASKS_DB ?? `${root}/porting/tasks.db`;
  const batchAgent = `batch:${ts}`;
  const releaseRow = (id) => {
    try { execFileSync("bun", [`${root}/porting/tasks.mjs`, "release", id], { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, TASKS_DB: dbPath } }); } catch { /* lease expires on its own */ }
  };
  const picked = [];
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (!row.id) { picked.push({ ...row, claimed: false }); continue; } // md-fallback rows carry no ids
    try {
      execFileSync("bun", [`${root}/porting/tasks.mjs`, "claim", row.id, "--agent", batchAgent, "--ttl", "7200"],
        { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, TASKS_DB: dbPath } });
      picked.push({ ...row, claimed: true });
    } catch {
      console.error(`wf-batch: ${row.id} contended — skipping`);
    }
  }
  if (!picked.length) return { orders: [], gate: null, gated, next: "NO PENDING ROWS (or all picks contended/dep-gated)" };

  // --- base reds (what was already red before this batch) --------------------
  const stateText = readFileSync(`${root}/docs/STATE.md`, "utf8");
  const standing = stateText.split("\n").filter((l) => /^\|\s/.test(l) && !/^\|\s*(Red|---)/.test(l));
  writeFileSync(`${root}/porting/runs/base-red.json`, JSON.stringify({ capturedAt: new Date().toISOString(), note: "v1: standing reds parsed from docs/STATE.md; per-batch testCmd baseline is captured by the first order's VERIFY phase", standingReds: standing }, null, 2));

  // --- run orders (sequential; stop stacking on a red) -----------------------
  const results = [];
  const ranIds = new Set();
  for (const row of picked) {
    const order = {
      id: row.id ?? slug(row.title),
      title: row.title,
      scope: row.scope,
      acceptance: row.acceptance ?? row.scope,
      corpus: DEFAULT_CORPUS.map((p) => `${root}/${p}`),
      testCmd: row.check ?? extractCheck(row.scope) ?? DEFAULT_TEST,
    };
    const r = await runWorkOrder(order, { root, lenses, agent: agentOpt, agents, resume });
    results.push(r);
    ranIds.add(row.id);
    if (row.claimed) releaseRow(row.id);
    if (r.verdict !== "GREEN") break;
  }
  // picks that never ran (batch stopped early) must not hold leases
  for (const row of picked) if (row.claimed && !ranIds.has(row.id)) releaseRow(row.id);

  // --- PARITY GATE (almost last): did this batch LOSE anything vs the pre-batch state? -----
  // Principle (John, 2026-10-06): every build must do MORE than the one before, never less.
  // Declared removals pass; adequate tests substitute for manual comparison; else it blocks.
  const PARITY_SCHEMA = { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["BLOCK", "SHIP"] }, shipBlockers: { type: "array", items: { type: "string" } }, highs: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } };
  let parity = null;
  if (preBatchCommit && results.some((r) => r.verdict === "GREEN")) {
    const pRaw = await agent(
      `PARITY GATE (almost last) for batch ${ts}. Compare the PRE-BATCH state vs now — the build must be >= the previous build.\n` +
      `Pre-batch commit: ${preBatchCommit}. Run \`git diff --stat ${preBatchCommit}\` and \`git diff ${preBatchCommit} -- <suspicious paths>\`; inspect for any behavior, file, endpoint, capability, or output that was REMOVED or weakened.\n` +
      `Rules: a removal blocks UNLESS the batch's orders explicitly declared it (scope/acceptance) or an adequate covering test still passes (tests substitute for manual comparison); with neither it is a ship-blocker.\n` +
      `Skill: ${SKILL_HINTS.lens.parity}. Do NOT write files — the runner records your verdict.\n` +
      `Return ONLY {verdict, shipBlockers, highs, notes}.`,
      { agent: agents?.parity ?? "parity-auditor", label: `gate:parity:${ts}`, schema: PARITY_SCHEMA },
    ).wait();
    parity = normalizeVerdict("parity", pRaw);
    writeFileSync(`${batchDir}/gate-parity.md`, JSON.stringify(parity, null, 2));
  }

  // --- merged gate (v1: sequential workspace; this gate sees the union) ------
  // Fail-closed like every per-order gate: a merged return is RAW INPUT, not a verdict —
  // an incoherent {verdict:"SHIP", shipBlockers:[…]} must not read ALL GREEN (v3.2).
  const mergedRaw = await agent(
    `MERGED GATE for batch ${ts}. Orders run: ${results.map((r) => `${r.order} (${r.verdict}, heals=${r.heals})`).join("; ")}.\n` +
    `Read every order's result.json + reports under ${batchDir}/../ and the current working tree (git diff vs the pre-batch commit).\n` +
    `Skills: apply ${SKILL_HINTS.mergedGate}.\n` +
    `Block rule + attribution as in the per-order gate: only reds INTRODUCED by this batch block; base-identical reds are recorded with owners.\n` +
    `Do NOT write files — the runner records your verdict. Return the verdict object + a <=6 line summary ending with NEXT: ALL GREEN or the blockers.`,
    { agent: agents?.mergedGate ?? agentOpt ?? "senior-reviewer", label: `gate:merged:${ts}`, schema: { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["SHIP", "BLOCK"] }, shipBlockers: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } } },
  ).wait();
  const merged = normalizeVerdict("merged", mergedRaw);
  writeFileSync(`${batchDir}/gate-merged.md`, JSON.stringify(merged, null, 2));

  const parityBlocked = parity !== null && parity.verdict !== "SHIP";
  const next = results.some((r) => r.verdict !== "GREEN") || merged.verdict !== "SHIP" || parityBlocked ? "BLOCKED — see per-order results + gate-merged.md + gate-parity.md" : "ALL GREEN — tick the queue rows, update the spine, regenerate the status index, commit";
  const report = { batch: ts, queueSource, sourceLike: sourceLike ?? null, gated, orders: results, merge: "v1 sequential (no worktrees)", gate: merged, parity, next };
  writeFileSync(`${batchDir}/report.json`, JSON.stringify(report, null, 2));
  log(`batch ${ts}: ${next}`);
  return report;
}
