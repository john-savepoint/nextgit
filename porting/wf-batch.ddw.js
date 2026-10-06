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
export function readQueueRows(root = process.cwd()) {
  const dbPath = `${root}/porting/tasks.db`;
  if (existsSync(dbPath)) {
    try {
      // execFileSync (no shell interpolation — space/metachar-safe) + a bounded wait.
      // Live-claimed rows are skipped: another session owns them (claims are the collision guard).
      const out = execFileSync("bun", [`${root}/porting/tasks.mjs`, "list", "--status", "pending", "--json"],
        { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, TASKS_DB: dbPath } });
      const rows = out.trim()
        ? JSON.parse(out)
          .filter((r) => r.claimed_by == null)
          .map((r) => ({ id: r.id, priority: r.priority ?? "P3", title: r.title, scope: r.scope ?? "", check: r.check_cmd }))
        : [];
      return { source: "db", rows };
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

export async function runBatch({ limit = 1, root = process.cwd(), lenses, agent, agents } = {}) {
  const { runWorkOrder, normalizeVerdict, SKILL_HINTS } = await import(`${root}/porting/wf-template.ddw.js`);
  mkdirSync(`${root}/porting/runs`, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = `${root}/porting/runs/batch-${ts}`;
  mkdirSync(batchDir, { recursive: true });

  // --- queue (DB preferred; md fallback on a store fault) --------------------
  const { source: queueSource, rows } = readQueueRows(root);

  // --- claim the picks (contended rows are skipped; released after running) --
  // Two sessions running batches must never pick the same row: claims are the guard.
  const dbPath = `${root}/porting/tasks.db`;
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
  if (!picked.length) return { orders: [], gate: null, next: "NO PENDING ROWS (or all picks contended)" };

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
      acceptance: row.scope,
      corpus: DEFAULT_CORPUS.map((p) => `${root}/${p}`),
      testCmd: row.check ?? extractCheck(row.scope) ?? DEFAULT_TEST,
    };
    const r = await runWorkOrder(order, { root, lenses, agent, agents });
    results.push(r);
    ranIds.add(row.id);
    if (row.claimed) releaseRow(row.id);
    if (r.verdict !== "GREEN") break;
  }
  // picks that never ran (batch stopped early) must not hold leases
  for (const row of picked) if (row.claimed && !ranIds.has(row.id)) releaseRow(row.id);

  // --- merged gate (v1: sequential workspace; this gate sees the union) ------
  // Fail-closed like every per-order gate: a merged return is RAW INPUT, not a verdict —
  // an incoherent {verdict:"SHIP", shipBlockers:[…]} must not read ALL GREEN (v3.2).
  const mergedRaw = await agent(
    `MERGED GATE for batch ${ts}. Orders run: ${results.map((r) => `${r.order} (${r.verdict}, heals=${r.heals})`).join("; ")}.\n` +
    `Read every order's result.json + reports under ${batchDir}/../ and the current working tree (git diff vs the pre-batch commit).\n` +
    `Skills: apply ${SKILL_HINTS.mergedGate}.\n` +
    `Block rule + attribution as in the per-order gate: only reds INTRODUCED by this batch block; base-identical reds are recorded with owners.\n` +
    `Do NOT write files — the runner records your verdict. Return the verdict object + a <=6 line summary ending with NEXT: ALL GREEN or the blockers.`,
    { agent: agents?.mergedGate ?? agent ?? "senior-reviewer", label: `gate:merged:${ts}`, schema: { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["SHIP", "BLOCK"] }, shipBlockers: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } } },
  ).wait();
  const merged = normalizeVerdict("merged", mergedRaw);
  writeFileSync(`${batchDir}/gate-merged.md`, JSON.stringify(merged, null, 2));

  const next = results.some((r) => r.verdict !== "GREEN") || merged.verdict !== "SHIP" ? "BLOCKED — see per-order results + gate-merged.md" : "ALL GREEN — tick the queue rows, update the spine, regenerate the status index, commit";
  const report = { batch: ts, queueSource, orders: results, merge: "v1 sequential (no worktrees)", gate: merged, next };
  writeFileSync(`${batchDir}/report.json`, JSON.stringify(report, null, 2));
  log(`batch ${ts}: ${next}`);
  return report;
}
