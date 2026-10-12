// porting/wave13.mjs — WAVE 13 LANE PLAN (UX PROGRAM, infrastructure-first).
//
// John's mandate (2026-10-12): a significant UX upgrade that represents everything built
// and planned — file visibility first — at higher concurrency. This wave is the
// ENABLER set: the four workstreams that unlock the wave-14 fan-out (8-10 lanes).
//
// Scope (4 lanes, 5 orders):
//   - lane-1 `read-api`  : nextgit-e14-impl-tree-and-file-read-api — worker read API
//     (/tree, /file, /raw) so files/repos become VISIBLE (the GitHub floor).
//   - lane-2 `ui-split`  : nextgit-e14-infra-ui-module-split — app.js -> platform/ui/js/*
//     (behavior-preserving; the single-writer bottleneck remover for wave 14).
//   - lane-3 `tokens`    : nextgit-e14-infra-design-tokens — token layer + dual typography
//     in styles.css only (no index.html / app.js contention with lane-2).
//   - lane-4 `tour-parity`: nextgit-e14-impl-tour-fixes (parallel 2) + the EXISTING
//     nextgit-capability-parity-vs-github audit row (read-only; ranks the wave-14 set).
//
// LENSES: UI/UX lanes carry the `ux: "designer"` lens (already in the runner's default
// lens map, pinned by normalize.test.mjs) alongside quality/spec-fit.
//
// CONCURRENCY: 4 lanes x (up to 4 concurrent lens gates) ≈ 12-16 agents in flight —
// the 5x step before wave 14's 8-10 lanes. RAM guard: ~13G available; spawns are
// staggered by the runner; if free RAM < ~10G, hold lane-4.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed 83b7f63b.
// POSTFLIGHT: six-probe deploy gate + demo reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave13.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 4,
  limit: 5,
  parallel: 1,
  spawnCap: 240,
  plans: [
    {
      name: "read-api",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: ["nextgit-e14-impl-tree-and-file-read-api"],
    },
    {
      name: "ui-split",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "ux"],
      ids: ["nextgit-e14-infra-ui-module-split"],
    },
    {
      name: "tokens",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "ux"],
      ids: ["nextgit-e14-infra-design-tokens"],
    },
    {
      name: "tour-parity",
      parallel: 2,
      limit: 2,
      lenses: ["quality", "spec-fit", "ux"],
      ids: [
        "nextgit-e14-impl-tour-fixes",
        "nextgit-capability-parity-vs-github",
      ],
    },
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
  if (problems.length) throw new Error(`wave13 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
