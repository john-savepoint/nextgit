// porting/wave19.mjs — WAVE 19 LANE PLAN (below-dim pushes + attributed carries + recording docs).
//
// 7 lanes / 7 orders:
//   L1 session-inject      (worker): GET /sessions/{repo}/instructions — the poll half of steering.
//   L2 checks-github-export(worker): GET /checks?format=github — GitHub check-run interop (the ci-dim push).
//   L3 ux-attributed       (UI): aria-live failure legs, <=720px floors (+selector arrays), focus restore, 400/429 legs.
//   L4 watchdog-calibration(porting): per-phase-class deadlines (impl 120m) + battery Chrome isolation.
//   L5 parity-refresh      (docs/parity): wave-17/18 evidence + HANDOFF routes + regen.
//   L6 session-inject-ui   (UI): instructions subsection (consumes L1's pinned contract via loopback).
//   L7 demo-story          (docs): the recording shot-list against the live deploy.
//
// COLLISION MAP: L1 + L2 touch index.ts + CONTRACT (2-way union, disjoint regions);
// L3 + L6 both edit platform/ui/js/sessions-panel.js (2-way union — L3 adds the
// aria-live failure region, L6 adds the instructions list; note at integration);
// L4 owns porting/ (wf-template/wf-batch/wf-integrate + batch.test); L5 owns
// porting/parity/ + docs/HANDOFF; L7 owns docs/DEMO-STORY.md (new file).
//
// PREFLIGHT (direct composition skips fleet prepare — SYNC LANES FIRST):
//   for L in 1..8: git -C .fleet/lane-$L fetch origin main && reset --hard FETCH_HEAD
// POSTFLIGHT: seven-gate chain + demo reset + tick + views + commit.
//
// LAUNCH (direct composition): Promise.allSettled over runBatch({root: .fleet/lane-N, ids, lenses, resume:true, evidenceRoot: root})

export const plan = {
  lanes: 7,
  limit: 7,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "session-inject", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e19-impl-session-inject"] },
    { name: "checks-github-export", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e19-impl-checks-github-export"] },
    { name: "ux-attributed", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e19-impl-ux-attributed-fixes"] },
    { name: "watchdog-calibration", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e19-mach-watchdog-calibration"] },
    { name: "parity-refresh", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e19-docs-parity-refresh"] },
    { name: "session-inject-ui", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e19-impl-session-inject-ui"] },
    { name: "demo-story", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e19-docs-demo-story"] },
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
  if (problems.length) throw new Error(`wave19 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
