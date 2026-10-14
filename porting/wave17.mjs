// porting/wave17.mjs — WAVE 17 LANE PLAN (trust-chain rest + below-dim v2 + machinery + gate).
//
// 8 lanes / 9 orders:
//   L1 trust-chain-rest (serial 2): changeset-fingerprint → post-merge-silent-drop-guard.
//   L2 issues-crud-v2 (1): stored issues + merge semantics + UI composer/close. [worker+UI]
//   L3 ci-pipelines-v2 (1): GET /pipelines from landing records + UI list.        [worker+UI]
//   L4 convergence-rail (1): per-repo timeline from live data.                     [UI]
//   L5 machinery-a (1): wf-batch auto-close/parity race fix deterministically.
//   L6 machinery-b (1): batched claims + whitelist-equality guard + CHROME_BIN discovery.
//   L7 gate-extension (1): submission-live gate covers every shipped surface.
//   L8 docs-refresh (1): HANDOFF/STATE inventory + parity evidence refresh.
//
// COLLISION MAP: L1/L2/L3 touch index.ts + CONTRACT (3-way union, proven regime);
// L5 touches wf-batch + batch.test; L6 touches tasks.mjs + wf-integrate + a new
// whitelist test (batch.test overlap possible — union if it happens); L7 owns
// submission-live.probe.mjs; L8 owns docs + parity files. UI files: new modules
// (rail.js, pipelines.js bits, issues edits) — registration trio unions.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed c2709a1d.
// POSTFLIGHT: six-probe + submission gate + demo reset + tick + views + commit.
//
// LAUNCH (direct composition — runFleet drops resume):
//   see the eval cell: Promise.allSettled over runBatch({root: .fleet/lane-N, ids, lenses, resume:true})

export const plan = {
  lanes: 8,
  limit: 9,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "trust-chain-rest", parallel: 1, limit: 2, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e16-impl-changeset-fingerprint", "nextgit-post-merge-behavioral-verification-silent-drop-guard"] },
    { name: "issues-crud-v2", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "ux"], ids: ["nextgit-e17-impl-issues-crud-v2"] },
    { name: "ci-pipelines-v2", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e17-impl-ci-pipelines-v2"] },
    { name: "convergence-rail", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e17-impl-convergence-rail"] },
    { name: "machinery-a", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e17-mach-auto-close-race"] },
    { name: "machinery-b", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e17-mach-claims-guard-chrome"] },
    { name: "gate-extension", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e17-submission-gate-extension"] },
    { name: "docs-refresh", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e17-docs-refresh"] },
  ],
};

// Launch-time validator (also run at prepare time).
export async function validate(root = process.cwd()) {
  const { execFileSync } = await import("node:child_process");
  const rows = JSON.parse(execFileSync("bun", [`${root}/porting/tasks.mjs`, "list", "--json"], { cwd: root, encoding: "utf8" }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const done = new Set(rows.filter((r) => r.status === "done" || r.status === "remediated").map((r) => r.id));
  const problems = [];
  const seen = new Set();
  for (const lane of plan.plans) {
    for (const id of lane.ids) {
      if (seen.has(id)) problems.push(`duplicate across lanes: ${id}`);
      seen.add(id);
      const row = byId.get(id);
      if (!row) problems.push(`missing from store: ${id}`);
      else {
        if (row.status !== "pending") problems.push(`not pending (${row.status}): ${id}`);
        if (!(row.check_cmd ?? row.check)) problems.push(`no check_cmd: ${id}`);
        const deps = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  if (problems.length) throw new Error(`wave17 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
