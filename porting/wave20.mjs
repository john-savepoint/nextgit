// porting/wave20.mjs — WAVE 20 (perf fix + mediums + ci notify + mobile + docs). 6 lanes.
export const plan = {
  lanes: 6,
  limit: 6,
  parallel: 1,
  spawnCap: 240,
  plans: [
    { name: "proposals-warm", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "resilience"], ids: ["nextgit-e20-impl-proposals-warm"] },
    { name: "sessions-mediums", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e20-impl-sessions-mediums"] },
    { name: "api-hygiene", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e20-impl-api-hygiene"] },
    { name: "pipeline-notify", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "security", "resilience"], ids: ["nextgit-e20-impl-pipeline-notify"] },
    { name: "mobile-pass", parallel: 1, limit: 1, lenses: ["quality", "spec-fit", "ux"], ids: ["nextgit-e20-impl-mobile-pass"] },
    { name: "docs-refresh", parallel: 1, limit: 1, lenses: ["quality", "spec-fit"], ids: ["nextgit-e20-docs-refresh-v2"] },
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
        const unmet = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean).filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  if (problems.length) throw new Error(`wave20 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: [...seen].length, lanes: plan.plans.length };
}
