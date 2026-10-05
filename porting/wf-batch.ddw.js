// porting/wf-batch.ddw.js — NextGit batch driver over the queue (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runBatch } = await import("./porting/wf-batch.ddw.js"); await runBatch({ limit: 1 });
//
// Picks the first N `pending` rows from docs/NEXT-ACTIONS.md, runs each through runWorkOrder
// (direct composition — the sub-driver returns a result promise, wait() is not involved),
// then a MERGED gate over the union. The CALLER ticks rows + commits — this driver never does.
// v1 note: orders run SEQUENTIALLY in one workspace; per-order worktree isolation + parallel
// orders are a recorded carry (see docs/STATE.md).

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const DEFAULT_TEST = "node --check platform/ui/app.js && node --check platform/ui/tour.js";
const DEFAULT_CORPUS = [
  "docs/STATE.md",
  "docs/CHECKPOINT.md",
  "_bmad-output/specs/spec-next-git-platform/SPEC.md",
  "platform/CONTRACT.md",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const extractCheck = (scope) => { const m = scope.match(/check:\s*([^).]+)/i); return m ? m[1].trim() : null; };

export async function runBatch({ limit = 1, root = process.cwd(), lenses, agent } = {}) {
  const { runWorkOrder } = await import(`${root}/porting/wf-template.ddw.js`);
  mkdirSync(`${root}/porting/runs`, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = `${root}/porting/runs/batch-${ts}`;
  mkdirSync(batchDir, { recursive: true });

  // --- parse the queue -------------------------------------------------------
  const rows = [];
  for (const line of readFileSync(`${root}/docs/NEXT-ACTIONS.md`, "utf8").split("\n")) {
    const m = line.match(/^- \[pending\]\s*(P[0-3])\s*—\s*(.+)$/);
    if (!m) continue;
    const rest = m[2];
    const cut = rest.indexOf(" — ");
    rows.push({ priority: m[1], title: (cut === -1 ? rest : rest.slice(0, cut)).trim(), scope: cut === -1 ? "" : rest.slice(cut + 3).trim() });
  }
  const picked = rows.slice(0, limit);
  if (!picked.length) return { orders: [], gate: null, next: "NO PENDING ROWS" };

  // --- base reds (what was already red before this batch) --------------------
  const stateText = readFileSync(`${root}/docs/STATE.md`, "utf8");
  const standing = stateText.split("\n").filter((l) => /^\|\s/.test(l) && !/^\|\s*(Red|---)/.test(l));
  writeFileSync(`${root}/porting/runs/base-red.json`, JSON.stringify({ capturedAt: new Date().toISOString(), note: "v1: standing reds parsed from docs/STATE.md; per-batch testCmd baseline is captured by the first order's VERIFY phase", standingReds: standing }, null, 2));

  // --- run orders (sequential; stop stacking on a red) -----------------------
  const results = [];
  for (const row of picked) {
    const order = {
      id: slug(row.title),
      title: row.title,
      scope: row.scope,
      acceptance: row.scope,
      corpus: DEFAULT_CORPUS.map((p) => `${root}/${p}`),
      testCmd: extractCheck(row.scope) ?? DEFAULT_TEST,
    };
    const r = await runWorkOrder(order, { root, lenses, agent });
    results.push(r);
    if (r.verdict !== "GREEN") break;
  }

  // --- merged gate (v1: sequential workspace; this gate sees the union) ------
  const merged = await agent(
    `MERGED GATE for batch ${ts}. Orders run: ${results.map((r) => `${r.order} (${r.verdict}, heals=${r.heals})`).join("; ")}.\n` +
      `Read every order's result.json + reports under ${batchDir}/../ and the current working tree (git diff vs the pre-batch commit).\n` +
      `Block rule + attribution as in the per-order gate: only reds INTRODUCED by this batch block; base-identical reds are recorded with owners.\n` +
      `Write the verdict to ${batchDir}/gate-merged.md (same verdict-file shape). Return a <=6 line summary ending with NEXT: ALL GREEN or the blockers.`,
    { agent: agent ?? "task", label: `gate:merged:${ts}`, schema: { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["SHIP", "BLOCK"] }, shipBlockers: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } } },
  ).wait();

  const next = results.some((r) => r.verdict !== "GREEN") || merged?.verdict !== "SHIP" ? "BLOCKED — see per-order results + gate-merged.md" : "ALL GREEN — tick the queue rows, update the spine, regenerate the status index, commit";
  const report = { batch: ts, orders: results, merge: "v1 sequential (no worktrees)", gate: merged, next };
  writeFileSync(`${batchDir}/report.json`, JSON.stringify(report, null, 2));
  log(`batch ${ts}: ${next}`);
  return report;
}
