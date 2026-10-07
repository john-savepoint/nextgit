#!/usr/bin/env bun
// porting/migrate-to-bd.mjs — v2: legacy SQLite store (porting/tasks.db) → bd JSONL.
//
// WHY v2: bd classifies a dependency target as EXTERNAL when its prefix differs from
// the source's (issueops.IsExternalDepTarget; prefix = text before the first hyphen or "").
// External targets land in depends_on_external and NEVER block. Our legacy slugs
// (`e12-impl-…`, `r2-asset-…`) each had a different first segment, so cross-epic blocking
// edges silently stopped gating. Fix: every issue id is prefixed with the store prefix
// (`nextgit-`), making every edge same-prefix → internal → blocking.
//
// Mapping:
//   id            → "nextgit-" + legacy id  (bd store prefix; canonical everywhere)
//   legacy_id     → metadata.legacy_id (+ every metadata id ref rewritten canonical)
//   external_ref  → "nextgit:<legacy-id>"  (stable external key; bare by design)
//   status        → pending→open · partial→open(+label "partial") · done→closed
//   priority      → P0..P3 → 0..3
//   scope         → description · acceptance → acceptance_criteria
//   evidence      → notes "COMPLETED: <evidence>"
//   deps (csv)    → blocks edges  {issue_id: self, depends_on_id: dep}  (canonical ids)
//   epic_id       → parent-child edge to the epic bead (informational)
//   layer/source/epic_id/fr_refs/check_cmd → metadata (+ layer/partial labels)
// Epics import as issue_type=epic ("nextgit-E1"…), milestone label.
//
// Run from the repo root:  bun porting/migrate-to-bd.mjs [--out porting/migration/issues-v2.jsonl]
// Then (fresh store):      bd init --non-interactive --prefix nextgit && bd import <out>
// Idempotent re-runs regenerate the JSONL; import upserts by id when updated_at is newer.

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : "porting/migration/issues-v2.jsonl";

const PREFIX = "nextgit-";
const cid = (id) => (id.startsWith(PREFIX) ? id : PREFIX + id);

const db = new Database("porting/tasks.db", { readonly: true });
const tasks = db.query("SELECT * FROM tasks").all();
const epics = db.query("SELECT * FROM epics").all();
const taskIds = new Set(tasks.map((t) => t.id));
const epicIds = new Set(epics.map((e) => e.id));

const PRI = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const iso = (s) => (s ? s.replace(" ", "T") + "Z" : undefined);
const badId = (id) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);

const problems = [];
let skippedDeps = 0;
const lines = [];

// --- epics -------------------------------------------------------------------
for (const e of epics) {
  if (badId(e.id)) { problems.push(`bad epic id: ${e.id}`); continue; }
  lines.push({
    _type: "issue",
    id: cid(e.id),
    title: e.title,
    description: e.goal ?? "",
    status: "open",
    priority: 2,
    issue_type: "epic",
    external_ref: `nextgit:epic:${e.id}`,
    labels: e.milestone ? [`milestone:${e.milestone}`] : [],
    metadata: { milestone: e.milestone ?? "", source: e.source ?? "", legacy_status: e.status ?? "", legacy_id: e.id },
    created_at: iso(e.created_at),
    updated_at: iso(e.updated_at),
  });
}

// --- tasks -------------------------------------------------------------------
const countByStatus = { open: 0, closed: 0 };
for (const t of tasks) {
  if (badId(t.id)) { problems.push(`bad task id: ${t.id}`); continue; }
  const deps = (t.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dependencies = [];
  for (const d of deps) {
    if (taskIds.has(d)) dependencies.push({ issue_id: cid(t.id), depends_on_id: cid(d), type: "blocks" });
    else { skippedDeps++; problems.push(`dangling dep: ${t.id} -> ${d} (skipped)`); }
  }
  if (t.epic_id && epicIds.has(t.epic_id)) dependencies.push({ issue_id: cid(t.id), depends_on_id: cid(t.epic_id), type: "parent-child" });

  const labels = [];
  if (t.layer) labels.push(`layer:${t.layer}`);
  if (t.status === "partial") labels.push("partial");

  const status = t.status === "done" ? "closed" : "open";
  countByStatus[status]++;

  const row = {
    _type: "issue",
    id: cid(t.id),
    title: t.title,
    status,
    priority: PRI[t.priority] ?? 2,
    issue_type: "task",
    external_ref: `nextgit:${t.id}`,
    created_at: iso(t.created_at),
    updated_at: iso(t.updated_at),
  };
  if (t.scope) row.description = t.scope;
  if (t.acceptance) row.acceptance_criteria = t.acceptance;
  if (status === "closed") row.closed_at = iso(t.updated_at);
  if (labels.length) row.labels = labels;
  row.metadata = {
    check_cmd: t.check_cmd ?? "",
    deps: deps.map(cid).join(","),
    layer: t.layer ?? "",
    source: t.source ?? "",
    epic_id: t.epic_id ? cid(t.epic_id) : "",
    fr_refs: t.fr_refs ?? "",
    legacy_status: t.status ?? "",
    legacy_id: t.id,
    owner: t.owner ?? "",
  };
  if (t.evidence) row.notes = `COMPLETED: ${t.evidence}`;
  if (dependencies.length) row.dependencies = dependencies;
  lines.push(row);
}

mkdirSync("porting/migration", { recursive: true });
writeFileSync(outPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

console.log(JSON.stringify({
  out: outPath,
  prefix: PREFIX,
  epics: epics.length,
  tasks: tasks.length,
  open: countByStatus.open,
  closed: countByStatus.closed,
  edges: lines.reduce((n, l) => n + ((l.dependencies ?? []).length), 0),
  skippedDeps,
  problemCount: problems.length,
  problems: problems.slice(0, 10),
}, null, 2));
