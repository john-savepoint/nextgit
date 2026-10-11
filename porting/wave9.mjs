// porting/wave9.mjs — WAVE 9 LANE PLAN (the post-wave-8 tranche).
//
// Scope (7 orders):
//   - the 6 runnable compile rows after wave-8's ticks (e8 reveal-beat UI; e11 defaults-parity,
//     entity-surface; e13 merge-back-upstream; e11-verify json-404 + method-guards — the two
//     deferred live probes, now unblocked by the deploy of the route-discipline fix);
//   - `nextgit-auto-land-gate-live` (registry row, NO `compile:` source tag): the AD-11 gate
//     inside POST /land — it gates the e5 verdict-render + interlock rows (wave 10).
//     Because it is untagged, this wave sets NO sourceLike: every lane picks by its explicit
//     `ids` set only (the O2 guarantee is unchanged — lane plans carry exact ids).
//
// WHY THIS SHAPE:
// - O2 single-owner: lane-1 chains EVERY index.ts/land.ts/CONTRACT.md writer serially
//   (auto-land → defaults-parity → entity-surface → merge-back-upstream; no two lanes touch
//   one file). lane-2 owns platform/ui (reveal-beat). lane-3 is read-only live probes.
// - O3 lens tiers: 4 lenses on platform/secrets writers (lane-1); 3 on the reveal UI
//   (reads secret-class values); 2 on read-only verifies.
// - O7 budget: spawn estimate ≈ lane1 4×7+2 + lane2 1×6+2 + lane3 2×5+2 ≈ 50 vs cap 240.
//
// PREFLIGHT (all must hold before launch):
//   1. main clean; `bun porting/tasks.mjs reclaim --older-than 10m` run (0 claims).
//   2. wave-8 rows ticked (135/148 done) — deps for this tranche are all satisfied.
//   3. `node platform/scripts/demo-verify.mjs` → 25/25 (baseline; lane-3 probes are read-only).
//   4. deployed worker carries the route-discipline fix (e11 verifies probe live).
//
// POSTFLIGHT (after integration + battery + deploy): four-probe deploy gate (live-render,
// demo-verify, land-hardening, egress-guard) + demo reset chain (lane-3 is read-only, but the
// gate set is non-negotiable); tick GREEN rows; regenerate views; commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave9.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 3,
  limit: 6, // upper bound; per-lane plans carry exact counts
  parallel: 1, // default; per-lane plans override
  spawnCap: 240,
  plans: [
    {
      // lane-1: routes-chain — every index.ts/land.ts/CONTRACT.md writer, serial.
      name: "routes-chain",
      parallel: 1,
      limit: 4,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-auto-land-gate-live", // AD-11 gate inside POST /land (ACT/CONFIRM/ESCALATE; fail closed)
        "nextgit-e11-impl-defaults-parity", // route defaults parity (index.ts + CONTRACT.md)
        "nextgit-e11-impl-entity-surface-boundary", // client-protocol shapes/boundary (CONTRACT.md)
        "nextgit-e13-impl-merge-back-upstream", // POST /upstream — merge-back with /land-shaped evidence
      ],
    },
    {
      // lane-2: reveal-ui — the reveal beat UI (reads secret-class values through the seam).
      name: "reveal-ui",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "security"],
      ids: ["nextgit-e8-impl-reveal-beat-ui"],
    },
    {
      // lane-3: verify-e11 — the two deferred live probes (read-only against the deployed worker).
      name: "verify-e11",
      parallel: 2,
      limit: 2,
      lenses: ["quality", "spec-fit"],
      ids: [
        "nextgit-e11-verify-json-404-unknown-paths",
        "nextgit-e11-verify-method-guards",
      ],
    },
  ],
};

// Launch-time validator (also run at prepare time):
//   const { plan, validate } = await import("./porting/wave9.mjs");
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
  if (!seen.has("nextgit-auto-land-gate-live")) problems.push("auto-land-gate-live not assigned");
  const assigned = [...seen];
  const runnableAll = rows
    .filter((r) => String(r.source ?? "").startsWith("compile:") && r.status === "pending")
    .filter((r) => ((r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean)).every((d) => done.has(d)))
    .map((r) => r.id);
  const unassigned = runnableAll.filter((id) => !seen.has(id));
  if (unassigned.length) problems.push(`runnable but unassigned: ${unassigned.join(", ")}`);
  if (problems.length) throw new Error(`wave9 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: assigned.length, lanes: plan.plans.length };
}
