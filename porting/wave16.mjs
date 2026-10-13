// porting/wave16.mjs — WAVE 16 LANE PLAN (max-concurrency roadmap burn; 8 lanes / 12 orders).
//
// John's mandate (2026-10-13): build out the rest of the roadmap at maximum
// concurrency — more parity/exceeding-parity work + the remaining work orders.
// The honest ceiling is FILE OWNERSHIP, not RAM (49GiB + idle swap): every
// worker order touches index.ts + CONTRACT.md, so worker work is chained into
// three serial lanes (merge unions at integration, the proven recipe); UI and
// docs/machinery work is file-disjoint and parallel-free. Gate phases fan each
// lane 4-wide → ~32 concurrent agents at peaks (the "30 workflows" band).
//
// LANES (12 orders):
//   L1 trust-chain (serial 3): signed-validation-evidence (P0) → change-set
//      identity fingerprint → post-merge silent-drop guard.  [index.ts chain]
//   L2 storage-chain (serial 2): classify-every-file (language/role/sensitivity)
//      → serve-blobs-via-presigned-R2.  [index.ts chain + new modules]
//   L3 story-page (1): game-industry story page (three storage classes + R2 tier).
//   L4 judge-step5 (1): judge agent-set comparison recommendation (demo story step 5).
//   L5 sessions-ui (1): sessions panel + steer composer (the v1 API's surface).
//   L6 ship-checks (serial 2): pre-submission eligibility automation → push-size
//      under-64MiB guard scripts.
//   L7 semantics-docs (1): explicit-vs-whiteboard set semantics differentiation
//      (CONTRACT + copy; disjoint from the code chains apart from CONTRACT union).
//   L8 cpu-budget (1): worker CPU budget hardening for large change-sets.
//
// COLLISION MAP: L1/L2/L8 + L7 touch index.ts/CONTRACT.md (union merges, 4-way
// worst case — wave 15 survived 5-way). L3/L4/L5 create NEW UI files (registration
// trio union: UI_ASSET_PATHS + route-discipline Group 3 + CONTRACT UI list).
// L6 is porting/scripts/docs-disjoint.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed 287af05f.
// POSTFLIGHT: submission-live gate (30 checks) + six-probe deploy gate + demo
// reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave16.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 8,
  limit: 12,
  parallel: 1,
  spawnCap: 240,
  plans: [
    {
      name: "trust-chain",
      parallel: 1,
      limit: 3,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-attach-signed-validation-evidence-to-every-change",
        "nextgit-change-set-identity-stable-per-proposal-identity-fingerprint",
        "nextgit-post-merge-behavioral-verification-silent-drop-guard",
      ],
    },
    {
      name: "storage-chain",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-classify-every-file-by-language-role-and-sensitivity",
        "nextgit-serve-blobs-via-presigned-direct-to-r2-transfers",
      ],
    },
    {
      name: "story-page",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "ux"],
      ids: ["nextgit-game-industry-story-page"],
    },
    {
      name: "judge-step5",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "ux"],
      ids: ["nextgit-judge-agent-set-comparison-recommendation-demo-story-step-5"],
    },
    {
      name: "sessions-ui",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "ux"],
      ids: ["nextgit-e16-impl-sessions-panel"],
    },
    {
      name: "ship-checks",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "resilience"],
      ids: [
        "nextgit-automate-competition-pre-submission-eligibility-checks",
        "nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap",
      ],
    },
    {
      name: "semantics-docs",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit"],
      ids: ["nextgit-differentiate-explicitly-vs-whiteboard-set-semantics-multipl"],
    },
    {
      name: "cpu-budget",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit", "resilience"],
      ids: ["nextgit-cpu-budget-hardening-large-change-sets-within-the-30s-worker"],
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
        if (!(row.check_cmd ?? row.check)) problems.push(`no check_cmd: ${id}`);
        const deps = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  if (problems.length) throw new Error(`wave16 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
