#!/usr/bin/env bun
// status-index.mjs — DERIVED status index for any project on this loop.
// Never hand-edit the output: regenerate it from the sources; if the index and a
// source disagree, the source wins. Project-agnostic: run it from the project root.
//
//   bun status-index.mjs [--check] [--root <dir>]
//
// Reads (whatever exists; absent sources are skipped, not invented):
//   docs/NEXT-ACTIONS.md · docs/PRODUCT-ROADMAP.md|ROADMAP.md|docs/ROADMAP.md
//   docs/STATE.md · git ls-files (the enforcement surface)
// Writes: docs/status-index.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const ROOT = (args.includes("--root") ? args[args.indexOf("--root") + 1] : null) ?? process.cwd();
const OUT = join(ROOT, "docs/status-index.json");
const read = (...ps) => { for (const p of ps) { const f = join(ROOT, p); if (existsSync(f)) return readFileSync(f, "utf8"); } return ""; };
const git = (c) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8" }); } catch { return ""; } };

// queue
const queue = { total: 0, byStatus: {}, items: [] };
for (const line of read("docs/NEXT-ACTIONS.md").split("\n")) {
  const m = line.match(/^- \[(done|pending|remediated|blocked|partial|not started)\]\s*(.*)$/i);
  if (!m) continue;
  const status = m[1].toLowerCase();
  const pr = m[2].match(/^(P[0-3])\b/);
  const title = m[2].replace(/^\*?\*?P[0-3]\*?\*?\s*—\s*/, "").replace(/\*\*/g, "").split(/[—.(]/)[0].trim().slice(0, 120);
  queue.byStatus[status] = (queue.byStatus[status] ?? 0) + 1; queue.total++;
  if (status !== "done") queue.items.push({ status, priority: pr ? pr[1] : null, title });
}

// roadmap axes (any table with an id + a bolded name)
const roadmap = { axes: 0, items: [] };
for (const line of read("docs/PRODUCT-ROADMAP.md", "docs/ROADMAP.md", "ROADMAP.md").split("\n")) {
  const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]{0,140})/);
  if (!m) continue;
  roadmap.axes++; roadmap.items.push({ id: Number(m[1]), axis: m[2].trim(), state: m[3].replace(/\*\*/g, "").trim().slice(0, 100) });
}

// state header + standing reds
const st = read("docs/STATE.md");
const pick = (re) => (st.match(re) ?? [])[1] ?? null;
const state = {
  lastUpdated: pick(/\*\*Last updated:\*\*\s*([^\n(]+)/),
  branch: pick(/\*\*Branch:\*\*\s*`?([^`\n]+)`?/),
  lastCommit: pick(/\*\*Last commit:\*\*\s*`?([^`\n]+)`?/),
  standingRedSet: (() => { const m = st.match(/(\d+)\s*tests?\s*\/\s*(\d+)\s*files/i); return m ? { tests: +m[1], files: +m[2] } : null; })(),
};

// enforcement surface (what actually proves things)
const count = (pat) => git(`git ls-files '${pat}'`).split("\n").filter(Boolean).length;
const enforcement = {
  testFiles: count("*.test.ts") + count("*.test.tsx") + count("*.test.py") + count("*_test.py") + count("*.test.js"),
  migrations: count("**/migrations/*.sql") + count("**/db-migrations/*.sql") + count("drizzle/*.sql"),
  auditRecords: count("docs/audit/*.md"),
};

const index = {
  $comment: "DERIVED by status-index.mjs — never hand-edit; the sources win on disagreement.",
  generatedAt: new Date().toISOString(),
  head: git("git rev-parse --short HEAD").trim(),
  branch: git("git rev-parse --abbrev-ref HEAD").trim(),
  state, queue, roadmap, enforcement,
};
const json = JSON.stringify(index, null, 2) + "\n";

if (args.includes("--check")) {
  // Compare only the DETERMINISTIC sections: head/branch advance on every commit
  // and generatedAt on every run, so including them would make --check red forever.
  const det = (o) => JSON.stringify({ state: o.state, queue: o.queue, roadmap: o.roadmap, enforcement: o.enforcement });
  const cur = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  if (det(cur) !== det(index)) {
    console.error("status-index.json is STALE — regenerate: bun status-index.mjs"); process.exit(1);
  }
  console.log("status index is current"); process.exit(0);
}
writeFileSync(OUT, json);
console.log("status index -> docs/status-index.json");
console.log(`  queue: ${queue.total} rows — ${Object.entries(queue.byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "empty"}`);
console.log(`  roadmap: ${roadmap.axes} axes · enforcement: ${enforcement.testFiles} test files, ${enforcement.migrations} migrations, ${enforcement.auditRecords} audit records`);
