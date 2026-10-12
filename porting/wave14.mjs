// porting/wave14.mjs — WAVE 14 LANE PLAN (the 8-lane fan-out; John's mandate:
// worktree-parallel orders, merge at integration, 10-30 agents in flight).
//
// Scope (8 lanes, 1 order each — the biggest concurrent wave so far):
//   L1 commits-api      : GET /commits (worker read API; index.ts + CONTRACT)
//   L2 history-page     : history.html + js/history-page.js (new page)
//   L3 forks-panel      : js/forks-panel.js + triage section (six-cluster signals)
//   L4 reveal-reach     : reveal affordance (files page + merge modal; audited seam)
//   L5 land-verdict     : js/land.js confirm sheet (render the verdict, never decide)
//   L6 checks-strip     : js/checks.js per-proposal checks (honest unknowns)
//   L7 comments-api     : GET/POST /comments (worker data plane; Artifacts-backed)
//   L8 comments-ui      : merge-modal per-file comment threads (loopback vs L7 contract)
//
// COLLISION MAP (accepted per the merge-at-integration directive):
//   - index.ts: L1 + L7 (routes) + all six UI lanes (UI_ASSET_PATHS) — additive unions.
//   - CONTRACT.md: L1 + L7 (additive sections).
//   - auth-seam count: L1 + L7 (12 → 13 → 14; union-resolve to the true count).
//   - js/modal.js: L4 (reveal affordance) + L8 (comment threads) — real overlap;
//     resolve at integration (both additive regions).
//   - route-discipline Group 3 + fingerprint whitelists: every UI lane appends.
//   The wave battery + integration worktree are the correctness backstop.
//
// LENSES: worker/secret-adjacent lanes 4 lenses; UI lanes quality/spec-fit/ux (the
// designer gate); L8 + L4 sit on the secret seam → security lens too.
//
// CONCURRENCY: 8 lanes × up to 4 concurrent lens gates — the 10-30 agent band.
// Resources verified: cgroup memory.max=max, cpu.max=max; 16 cores; swap idle.
// If free RAM drops under ~10G the runner's memory guard holds spawns (leave it on).
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed 891c464f.
// POSTFLIGHT: six-probe deploy gate + demo reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave14.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 8,
  limit: 8,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "commits-api", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e15-impl-commits-api"] },
    { name: "history-page", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e15-impl-history-page"] },
    { name: "forks-panel", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e15-impl-forks-panel"] },
    { name: "reveal-reach", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "ux"], ids: ["nextgit-e15-impl-reveal-reachability"] },
    { name: "land-verdict", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e15-impl-land-verdict-sheet"] },
    { name: "checks-strip", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e15-impl-checks-strip"] },
    { name: "comments-api", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e15-impl-comments-api"] },
    { name: "comments-ui", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "ux"], ids: ["nextgit-e15-impl-comments-ui"] },
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
        const deps = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  if (problems.length) throw new Error(`wave14 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
