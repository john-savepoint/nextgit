// porting/wave18.mjs — WAVE 18 LANE PLAN (queue completion: fingerprint, gate re-run, issues-v2 finish, hygiene, runbook).
//
// 6 lanes / 6 orders:
//   L1 changeset-fingerprint (1): the never-started trust-chain order (identity.fingerprint over the deterministic change-set).
//   L2 gate-extension (1): submission-live gate v2 — cover attestation/presign/classify/story/judge/sessions/pipelines.
//   L3 issues-api-suite (1): the missing 11-group API suite for the shipped issues-v2 code half.
//   L4 issues-ui (1): the missing composer + close affordances (stored rows only).
//   L5 runbook (1): the submission-day command chain + failure actions (demo-critical).
//   L6 hygiene (1): the four carried code mediums (floors filter, proposal-detail errors, verdict ternary, fanout revoke).
//
// COLLISION MAP: L1 + L6 both touch index.ts (2-way union); L3 owns a NEW test file
// (+ fixes any gap it exposes in index.ts — 3-way union worst case); L4 owns
// js/issues-panel.js + ui test + index.html (disjoint from L1/L6 apart from
// index.html which only L4 touches this wave); L2 owns submission-live.probe.mjs;
// L5 owns docs/. Registration trio unions if L4 adds files (it should not — composer
// lives inside the existing panel).
//
// PREFLIGHT (direct composition skips fleet prepare — SYNC LANES FIRST):
//   for L in 1..8: git -C .fleet/lane-$L fetch origin main && reset --hard FETCH_HEAD
//   main clean; reclaim; demo-verify 25/25; deployed 47d28485.
// POSTFLIGHT: seven-gate chain + demo reset + tick + views + commit.
//
// LAUNCH (direct composition — runFleet drops resume):
//   Promise.allSettled over runBatch({root: .fleet/lane-N, ids, lenses, resume:true, evidenceRoot: root})

export const plan = {
  lanes: 6,
  limit: 6,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "changeset-fingerprint", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e16-impl-changeset-fingerprint"] },
    { name: "gate-extension", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e17-submission-gate-extension"] },
    { name: "issues-api-suite", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security"], ids: ["nextgit-e18-impl-issues-v2-api-suite"] },
    { name: "issues-ui", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e18-impl-issues-v2-ui"] },
    { name: "runbook", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e18-docs-submission-runbook"] },
    { name: "hygiene", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e18-impl-hygiene-mediums"] },
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
  if (problems.length) throw new Error(`wave18 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
