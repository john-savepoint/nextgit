// porting/wave15.mjs — WAVE 15 LANE PLAN (parity v1 + demo-critical live fixes).
//
// Scope (7 lanes, 1 order each):
//   - 5 parity v1 slices (the remaining below-baseline areas, honest v1):
//     issues-v1, ci-signals-v1, session-steering-v1, agent-identity-policy-v1,
//     agent-federation-v1;
//   - reveal-identity-live: the audited reveal must WORK on the deployed demo
//     (UI identity channel + repo-scoped whoami probe) — demo-critical;
//   - ux-polish-mediums: the wave-14 gate mediums (modal anchoring, aria-live,
//     comment empty-state, thread role).
//
// COLLISION MAP (accepted per merge-at-integration — the wave-14 recipe):
//   - index.ts: lanes 1-5 add ROUTES + UI_ASSET_PATHS; union-resolve; auth-seam
//     census will need the cumulative count; route-discipline Group 3 unions.
//   - CONTRACT.md: lanes 1-5 additive sections + UI list unions.
//   - rate.ts: lanes 1-3 add rows (union).
//   - js/*: lane 7 owns modal.js/reveal.js/comments.js regions; lane 6 owns
//     files-page.js + api.js identity header; disjoint.
//
// LENSES: worker/secret writers 4 lenses; UI lanes quality/spec-fit/ux;
// lane 6 (secrets) quality/security/ux.
//
// CONCURRENCY: 7 lanes × up to 4 lens gates — disk at 2TB (46%), RAM 25G avail
// + idle swap; the new watchdogs bound any wedged phase.
//
// PREFLIGHT: main clean; reclaim; demo-verify 25/25; deployed 70b0b43e.
// POSTFLIGHT: six-probe deploy gate + demo reset + tick + regenerate views + commit.
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave15.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan, integrate: false });

export const plan = {
  lanes: 7,
  limit: 7,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "issues-v1", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "ux"], ids: ["nextgit-e16-impl-issues-v1"] },
    { name: "ci-signals-v1", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e16-impl-ci-signals-v1"] },
    { name: "session-steering-v1", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security"], ids: ["nextgit-e16-impl-session-steering-v1"] },
    { name: "agent-identity-policy-v1", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e16-impl-agent-identity-policy-v1"] },
    { name: "agent-federation-v1", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e16-impl-agent-federation-v1"] },
    { name: "reveal-identity-live", parallel: 1, limit: 1, lenses: ["quality", "security", "ux"], ids: ["nextgit-e16-impl-reveal-identity-live"] },
    { name: "ux-polish-mediums", parallel: 1, limit: 1, lenses: ["quality", "ux"], ids: ["nextgit-e16-impl-ux-polish-mediums"] },
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
        if (!row.check) problems.push(`no check_cmd: ${id}`);
        const deps = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  if (problems.length) throw new Error(`wave15 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
