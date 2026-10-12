// porting/wave12.mjs — WAVE 12 LANE PLAN (the FINAL compile tranche: e12 ×4).
//
// Scope (4 orders — completes the 148-story compile set):
//   - `nextgit-e12-impl-integrity-fail-closed-blob-reads` (readVerifiedBlob chokepoint in
//     platform/src/assets.ts; R2 fetch + sha verify + fail-closed);
//   - `nextgit-e12-impl-git-surfaces-unchanged-pointers` (read-surface invariance guards:
//     githttp/memfs/land + /changes + /proposals never fetch blobs);
//   - `nextgit-e12-impl-lifecycle-safe-deletes-no-orphans` (bucket lifecycle rules:
//     platform/r2-lifecycle.json + wrangler apply + orphan safety);
//   - `nextgit-e12-impl-land-mask-invariance` (the LIVE scratch-fork probe
//     porting/tests/r2-land-invariance.probe.mjs: pointer + second change, landing
//     semantics/masking/fork-point contract unchanged).
//
// WHY THIS SHAPE (partitioned by file scope — the wave-11 lesson):
// - lane-1 chains the two platform/src writers serially (integrity chokepoint first,
//   then the invariance guards that read it); lane-2 owns r2-lifecycle.json + wrangler
//   config (no platform/src edits); lane-3 owns the new read-only probe file (no
//   overlap; runs against the deployed f6e932fb surface).
// - O3 lenses: 4 on the secrets/platform writers (lane-1); 3 on lifecycle (bucket
//   config + deletes); 2 on the read-only probe.
// - O7 budget: ≈ 2×7+2 + 1×6+2 + 1×5+2 ≈ 31 vs cap 240.
// - No sourceLike (all four are compile-sourced but explicit ids are the contract).
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed f6e932fb.
// POSTFLIGHT: five-probe deploy gate + (if lane-3's probe is added to the gate set, it
// runs as a sixth) + demo reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave12.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 3,
  limit: 4,
  parallel: 1,
  spawnCap: 240,
  plans: [
    {
      // lane-1: tier-chain — the two platform/src writers, serial (integrity → invariance).
      name: "tier-chain",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-e12-impl-integrity-fail-closed-blob-reads",
        "nextgit-e12-impl-git-surfaces-unchanged-pointers",
      ],
    },
    {
      // lane-2: lifecycle — bucket retention/expiry config + delete/orphan safety.
      name: "lifecycle",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "security"],
      ids: ["nextgit-e12-impl-lifecycle-safe-deletes-no-orphans"],
    },
    {
      // lane-3: invariance-probe — the live scratch-fork probe (read-only against live).
      name: "invariance-probe",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit"],
      ids: ["nextgit-e12-impl-land-mask-invariance"],
    },
  ],
};

// Launch-time validator (also run at prepare time):
//   const { plan, validate } = await import("./porting/wave12.mjs");
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
  if (problems.length) throw new Error(`wave12 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: assigned.length, lanes: plan.plans.length };
}
