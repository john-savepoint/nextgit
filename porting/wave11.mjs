// porting/wave11.mjs — WAVE 11 LANE PLAN (the post-wave-10 tranche).
//
// Scope (2 orders, serial):
//   - `nextgit-e13-impl-six-cluster-fork-signals` (P3, deps met): new
//     platform/src/fork-signals.ts wired through index.ts; exposes the typed
//     six-cluster signals on the fork payload (GET /forks goes live) and feeds
//     the matcher verdicts from the one shared computation; CONTRACT pins.
//   - `nextgit-r2-asset-tier-manifest-format` (P1, no deps; "AD-10; demo
//     component"): the FIRST R2 slice — pointer format in Artifacts, one asset
//     end-to-end (R2 blob + pointer), metadata-only diff/merge rendering,
//     CONTRACT-documented. Unlocks the four e12-impl rows (wave 12).
//
// WHY THIS SHAPE:
// - O2 single-owner: BOTH orders edit platform/src/index.ts (+ CONTRACT.md) —
//   one serial chain in lane-1. The R2 slice additionally touches
//   platform/wrangler.jsonc (new binding) and platform/scripts (upload path);
//   no other lane exists to collide with.
// - O3 lens tiers: 4 lenses (platform/secrets writers; the R2 slice handles
//   credential-adjacent pointer values under AD-4).
// - O7 budget: spawn estimate ≈ 2×7+2 = 16 vs cap 240.
// - No sourceLike (r2 row is untagged) — explicit ids only.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25 baseline; deployed worker
// carries the wave-10 surface (e5f72117).
// POSTFLIGHT: five-probe deploy gate (live-render, demo-verify, land-hardening,
// egress-guard, colliding-land-refusal) + demo reset chain + tick + regenerate
// views + commit. NOTE: the R2 slice may deploy the worker from the lane to
// verify the binding end-to-end — the postflight redeploys from main regardless.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave11.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 1,
  limit: 2,
  parallel: 1,
  spawnCap: 240,
  plans: [
    {
      // lane-1: signals-r2-chain — serial index.ts/CONTRACT writers.
      name: "signals-r2-chain",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-e13-impl-six-cluster-fork-signals",
        "nextgit-r2-asset-tier-manifest-format",
      ],
    },
  ],
};

// Launch-time validator (also run at prepare time):
//   const { plan, validate } = await import("./porting/wave11.mjs");
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
  if (problems.length) throw new Error(`wave11 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: assigned.length, lanes: plan.plans.length };
}
