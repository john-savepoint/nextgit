// porting/wave10.mjs — WAVE 10 LANE PLAN (the post-wave-9 tranche).
//
// Scope (3 orders):
//   - `nextgit-return-matcher-verdicts-merge-context-or-ignore` (P1, harvest row,
//     no deps): the /intents three-state matcher (index.ts + CONTRACT) — also the
//     store-dep for `nextgit-e13-impl-six-cluster-fork-signals` (wave 11);
//   - `nextgit-e5-impl-autoland-engagement-interlock` (P3): autoland.ts engagement
//     switch + eligibility predicate + non-model corroboration interlock +
//     engagement-check.mjs (record-gated) — delta over the shipped gate;
//   - `nextgit-e5-impl-land-verdict-render` (P3): platform/ui/land-verdict.js pure
//     view mapping + wiring (render, never decide).
//
// WHY THIS SHAPE:
// - O2 single-owner: lane-1 chains the index.ts/CONTRACT writers (matcher then
//   interlock — the interlock consults the /land gate the matcher does not touch,
//   but both edit index.ts, so serial). lane-2 owns platform/ui (verdict-render;
//   NOTE: a new UI file must join UI_ASSET_PATHS + route-discipline Group 3 +
//   every whitelist-style UI fixture — the wave-9 reveal-decision.js lesson).
// - O3 lens tiers: 4 lenses on platform/secrets writers (lane-1); 3 on the UI lane.
// - O7 budget: spawn estimate ≈ 2×7+2 + 1×6+2 ≈ 24 vs cap 240.
// - No sourceLike (matcher is a harvest row, untagged) — explicit ids only.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25 baseline; deployed worker
// carries the wave-9 surface (a437b90b).
// POSTFLIGHT: four-probe deploy gate (live-render, demo-verify, land-hardening,
// egress-guard) + demo reset chain + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave10.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 2,
  limit: 3,
  parallel: 1,
  spawnCap: 240,
  plans: [
    {
      // lane-1: gate-chain — matcher then the auto-land interlock (index.ts writers, serial).
      name: "gate-chain",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-return-matcher-verdicts-merge-context-or-ignore",
        "nextgit-e5-impl-autoland-engagement-interlock",
      ],
    },
    {
      // lane-2: verdict-ui — the pure view mapping behind the Land button.
      name: "verdict-ui",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "security"],
      ids: ["nextgit-e5-impl-land-verdict-render"],
    },
  ],
};

// Launch-time validator (also run at prepare time):
//   const { plan, validate } = await import("./porting/wave10.mjs");
//   await validate(); // throws with a precise message on drift
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
  const assigned = [...seen];
  const runnableAll = rows
    .filter((r) => String(r.source ?? "").startsWith("compile:") && r.status === "pending")
    .filter((r) => ((r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean)).every((d) => done.has(d)))
    .map((r) => r.id);
  const unassigned = runnableAll.filter((id) => !seen.has(id));
  if (unassigned.length) problems.push(`runnable but unassigned: ${unassigned.join(", ")}`);
  if (problems.length) throw new Error(`wave10 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: assigned.length, lanes: plan.plans.length };
}
