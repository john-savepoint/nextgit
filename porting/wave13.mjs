// porting/wave13.mjs — WAVE 13 LANE PLAN (UX PROGRAM, infrastructure-first — 5 lanes).
//
// John's mandate (2026-10-12): significant UX upgrade representing everything built and
// planned, file visibility first, at 5-10x concurrency; run orders in WORKTREES and MERGE
// (worktree-parallel batches are the default posture; conflicts resolve at integration).
//
// Scope (5 lanes, 6 orders):
//   - lane-1 `read-api`  : nextgit-e14-impl-tree-and-file-read-api — /tree, /file, /raw.
//   - lane-2 `files-page`: nextgit-e14-impl-files-page — NEW page (files.html + js/files-page.js;
//     no app.js contention) consuming the read-api contract in parallel (contract-first in
//     the order descriptions; loopback fixture tests per the pinned shapes).
//   - lane-3 `ui-split`  : nextgit-e14-infra-ui-module-split — app.js -> js/* (enabler).
//   - lane-4 `tokens`    : nextgit-e14-infra-design-tokens — styles.css token layer + dual type.
//   - lane-5 `tour-parity` (parallel: 2): nextgit-e14-impl-tour-fixes + the EXISTING
//     nextgit-capability-parity-vs-github audit (read-only; ranks the wave-14 set).
//
// LENSES: UI/UX lanes carry `ux: "designer"` (in the runner's default lens map, pinned by
// normalize.test.mjs) alongside quality/spec-fit. Platform/secret writers keep 4 lenses.
//
// CONCURRENCY POSTURE (John's directive): worktree-parallel batches, merge at integration.
// 5 lanes x up to 4 concurrent lens gates ≈ 15-20 agents in flight (5x wave-12). Resources
// verified: cgroup uncapped (memory.max=max, cpu.max=max), 16 cores, swap 99G idle — the
// honest headroom for wave 14's 8-10 lanes (20-30 agents).
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed 83b7f63b.
// POSTFLIGHT: six-probe deploy gate + demo reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave13.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 5,
  limit: 6,
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
      name: "files-page",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "ux"],
      ids: ["nextgit-e14-impl-files-page"],
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
