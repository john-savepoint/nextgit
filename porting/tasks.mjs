#!/usr/bin/env bun
// porting/tasks.mjs — bd-backed task-store adapter (beads / Dolt).
//
// The store is authoritative (`.beads/`; resolve with `bd where` or BEADS_DIR);
// docs/NEXT-ACTIONS.md is a derived view (`view`).
//
// Replaces the legacy SQLite store (porting/tasks.db — frozen archive).
// Same CLI surface for the runners (wf-batch, wf-epics, merge-harvest) plus the
// bd-native safety verbs: heartbeat (keep long claims alive), reclaim (reaper sweep).
// Claims are bd assigns (BD_ACTOR = --agent) with a fixed ~5m lease; long orders MUST
// heartbeat. Evidence is appended to bd notes ("COMPLETED: ...").
//
// Commands: init | import <path> | add | upsert | set | claim | heartbeat | release |
//           reclaim | next | done-ids | list | view | epic-upsert | epic-list | activate
// Exit codes: 0 ok · 1 no unblocked pending / generic error · 2 usage/validation/unknown id/duplicate id · 3 claim conflict / release without claim
//
// Env: BEADS_DIR (workspace override; tests/workers), BD_BIN (bd binary override).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const BD = (() => {
  if (process.env.BD_BIN) return process.env.BD_BIN;
  const local = `${process.env.HOME ?? ""}/.local/bin/bd`;
  if (existsSync(local)) return local;
  return "bd"; // PATH lookup at spawn
})();
const STATUSES = ["pending", "done", "blocked", "remediated", "partial"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const GRAMMAR_RE = /^- \[(pending|done|blocked|remediated|partial)\]\s+(?:(P[0-3])\s+—\s+)?(.+)$/;

class CliError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

export const slugify = (title) =>
  String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// Canonical id layer. bd classifies a dep target as EXTERNAL (→ never blocks) when its
// prefix differs from the source's; prefix = text before the first hyphen. Every issue
// therefore carries the store prefix `nextgit-`, and ALL ids flowing through this adapter
// are canonicalized here. Callers may pass bare slugs; reads always return canonical ids.
export const ID_PREFIX = "nextgit-";
export const canonId = (x) => {
  const s = String(x);
  return s.startsWith(ID_PREFIX) ? s : ID_PREFIX + s;
};
export const bareId = (x) => {
  const s = String(x);
  return s.startsWith(ID_PREFIX) ? s.slice(ID_PREFIX.length) : s;
};

// ---------------------------------------------------------------------------
// bd plumbing
// ---------------------------------------------------------------------------

function bd(args, { input, actor, allowFail } = {}) {
  try {
    return execFileSync(BD, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024, // `bd export` exceeds the 1MB default at ~670 rows
      input,
      env: { ...process.env, ...(actor ? { BD_ACTOR: actor } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    if (allowFail) return { failed: true, status: e.status ?? 1, stderr: String(e.stderr ?? "") };
    throw e;
  }
}

function bdOk(args, opts) {
  const r = bd(args, { ...opts, allowFail: true });
  if (r && typeof r === "object" && r.failed) {
    throw new CliError(r.status === 13 ? 3 : 1, `bd ${args[0]}: ${r.stderr.trim().split("\n").pop() || "failed"}`);
  }
  return r;
}

// Full-fidelity read: one `bd export` (JSONL) per invocation; ~1s at 700 rows.
// Task-scoped: epics are store structure (epic-list reads them separately).
export function exportAll() {
  const out = bd(["export"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r._type === "issue" && r.issue_type !== "epic");
}

// Epics only (issue_type=epic).
export function exportEpics() {
  const out = bd(["export"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r._type === "issue" && r.issue_type === "epic");
}

// ---------------------------------------------------------------------------
// row mapping: bd issue -> legacy adapter row shape (callers depend on this)
// ---------------------------------------------------------------------------

const labelsOf = (r) => (Array.isArray(r.labels) ? r.labels : []);
const metaOf = (r) => r.metadata ?? {};

export function toRow(r) {
  const labels = labelsOf(r);
  const m = metaOf(r);
  let status;
  if (r.status === "closed") status = labels.includes("remediated") ? "remediated" : "done";
  else if (r.status === "blocked") status = "blocked";
  else status = labels.includes("partial") ? "partial" : "pending"; // open | in_progress
  const claimed = r.status === "in_progress";
  return {
    id: r.id,
    title: r.title,
    status,
    priority: r.priority === undefined || r.priority === null ? null : `P${r.priority}`,
    scope: r.description ?? null,
    acceptance: r.acceptance_criteria ?? null,
    check_cmd: m.check_cmd || null,
    deps: m.deps || null,
    evidence: r.notes || null,
    owner: m.owner || null,
    layer: m.layer || null,
    source: m.source || null,
    epic_id: m.epic_id || null,
    fr_refs: m.fr_refs || null,
    claimed_by: claimed ? (r.assignee ?? null) : null,
    claim_lease: claimed ? (r.lease_expires_at ?? null) : null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  };
}

const prioRank = (p) => (p === null || p === undefined ? 9 : p);
const sortRows = (rows) =>
  rows.sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));

const iso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const nextIso = (prev, now = new Date()) => {
  const p = prev ? Date.parse(prev) : 0;
  const n = Math.max(Date.now(), p + 1000);
  return iso(new Date(n));
};

// Build a complete bd JSONL row (import replaces content wholesale for newer rows;
// every field we care about must be present to survive the round-trip).
function buildIssueRow({ id, title, status, priority, description, acceptance, metadata, labels, notes, deps, keep, depsEdges }) {
  const now = new Date();
  const base = keep ? { ...keep } : {};
  const finalStatus = STATUS_MAP_NEW[status] ?? base.status ?? "open";
  const row = {
    _type: "issue",
    id,
    title,
    description: description ?? base.description ?? "",
    status: finalStatus,
    priority: priority ?? base.priority ?? 2,
    issue_type: base.issue_type ?? "task",
    external_ref: `nextgit:${bareId(id)}`,
    created_at: base.created_at ?? iso(now),
    updated_at: nextIso(base.updated_at, now),
  };
  if (acceptance !== undefined) row.acceptance_criteria = acceptance ?? "";
  else if (base.acceptance_criteria) row.acceptance_criteria = base.acceptance_criteria;
  if (notes !== undefined) row.notes = notes;
  else if (base.notes) row.notes = base.notes;
  // validations: closed rows carry closed_at; non-closed rows must NOT; assignee cleared on close after claim
  if (finalStatus === "closed") row.closed_at = base.closed_at ?? iso(now);
  else if (base.assignee) row.assignee = base.assignee;
  const mergedMeta = { ...(base.metadata ?? {}), ...(metadata ?? {}) };
  if (Object.keys(mergedMeta).length) row.metadata = mergedMeta;
  const mergedLabels = [...new Set([...(base.labels ?? []), ...(labels ?? [])])];
  if (mergedLabels.length) row.labels = mergedLabels;
  if (depsEdges) row.dependencies = depsEdges; // full replacement of the edge set
  else if (base.dependencies) row.dependencies = base.dependencies;
  return row;
}

const STATUS_MAP_NEW = { pending: "open", done: "closed", blocked: "blocked", remediated: "closed", partial: "open" };

function importRows(rows) {
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return bd(["import", "-"], { input: jsonl });
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function cmdInit() {
  const where = bd(["--version"]);
  const out = bd(["init", "--non-interactive", "--init-if-missing"]);
  console.log(out.trim().split("\n").pop());
  console.log(`initialized (bd ${where.trim()})`);
}

function cmdImport(dbless, file) {
  const text = readFileSync(file, "utf8");
  const existing = new Map(exportAll().map((r) => [r.id, r]));
  const rows = [];
  const used = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(GRAMMAR_RE);
    if (!m) continue;
    const status = m[1];
    const priorityStr = m[2] ?? null;
    const rest = m[3];
    const cut = rest.indexOf(" — ");
    const title = (cut === -1 ? rest : rest.slice(0, cut)).trim();
    if (!title) continue;
    const scope = cut === -1 ? null : rest.slice(cut + 3).trim();
    let slug = slugify(title);
    let n = 1;
    while (used.has(canonId(slug)) || (existing.has(canonId(slug)) && existing.get(canonId(slug)).title !== title)) {
      n++;
      const suffix = `-${n}`;
      slug = slugify(title).slice(0, 60 - suffix.length) + suffix;
    }
    const id = canonId(slug);
    used.add(id);
    const check = scope ? scope.match(/check:\s*(.+)$/i) : null;
    const keep = existing.get(id);
    rows.push(
      buildIssueRow({
        id,
        title,
        status,
        priority: priorityStr ? Number(priorityStr.slice(1)) : undefined,
        description: scope,
        metadata: check ? { check_cmd: check[1].trim() } : {},
        keep,
      }),
    );
  }
  importRows(rows);
  console.log(`imported ${rows.length} rows`);
}

function cmdList({ status, priority, json }) {
  let rows = exportAll().map(toRow);
  if (status) rows = rows.filter((r) => r.status === status || (status === "done" && r.status === "remediated"));
  if (priority) rows = rows.filter((r) => r.priority === priority);
  sortRows(rows);
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const cells = [
    ["PRI", (r) => r.priority ?? "-"],
    ["STATUS", (r) => r.status],
    ["ID", (r) => r.id],
    ["TITLE", (r) => r.title],
  ];
  const widths = cells.map(([h, f]) => Math.max(h.length, ...rows.map((r) => String(f(r)).length)));
  const render = (vals) => vals.map((v, i) => (i === vals.length - 1 ? v : v.padEnd(widths[i]))).join("  ");
  console.log(render(cells.map(([h]) => h)));
  for (const r of rows) console.log(render(cells.map(([, f]) => String(f(r)))));
}

function gatedRows() {
  const all = exportAll().map(toRow);
  const done = new Set(all.filter((r) => r.status === "done" || r.status === "remediated").map((r) => r.id));
  const pending = all.filter((r) => r.status === "pending");
  sortRows(pending);
  return pending.map((r) => {
    const deps = (r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { ...r, unmet: deps.filter((d) => !done.has(d)) };
  });
}

function cmdNext() {
  for (const r of gatedRows()) {
    if (r.claimed_by || r.unmet.length) continue;
    console.log(`id: ${r.id}`);
    console.log(`title: ${r.title}`);
    console.log(`acceptance: ${r.acceptance ?? r.scope ?? "(none)"}`);
    console.log(`check: ${r.check_cmd ?? "(none)"}`);
    return;
  }
  throw new CliError(1, "no unblocked pending task");
}

function cmdDoneIds() {
  const ids = exportAll().filter((r) => r.status === "closed").map((r) => r.id);
  console.log(JSON.stringify(ids));
}

function cmdAdd({ id, title, priority, scope, acceptance, check, deps, layer, source }) {
  if (!id || !title) throw new CliError(2, "usage: tasks.mjs add --id ID --title T [...]");
  const cid = canonId(id);
  const existing = [...exportAll(), ...exportEpics()].some((r) => r.id === cid);
  if (existing) throw new CliError(2, `duplicate id: ${id}`);
  const depIds = (deps ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(canonId);
  const edges = depIds.map((d) => ({ issue_id: cid, depends_on_id: d, type: "blocks" }));
  importRows([
    buildIssueRow({
      id: cid,
      title,
      status: "pending",
      priority: priority ? Number(priority.slice(1)) : undefined,
      description: scope,
      acceptance,
      metadata: { check_cmd: check ?? "", deps: depIds.join(","), layer: layer ?? "", source: source ?? "" },
      depsEdges: edges.length ? edges : undefined,
    }),
  ]);
  console.log(cid);
}

// Content upsert preserving status/evidence (idempotent re-compile):
// existing row -> `bd update` content flags only (bd preserves status, claim/assignee,
// notes); deps diffed via dep add/remove. new row -> import (create).
// NOTE: import must not be used for updates on claimed rows — it normalizes
// in_progress back to open and drops the lease (stale-assignee state).
function cmdUpsert(f) {
  const cid = canonId(f.id);
  const existing = new Map(exportAll().map((r) => [r.id, r]));
  const keep = existing.get(cid);
  const depIds = f.deps !== undefined ? String(f.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(canonId) : null;

  if (!keep) {
    const edges = depIds ? depIds.map((d) => ({ issue_id: cid, depends_on_id: d, type: "blocks" })) : undefined;
    const meta = {};
    if (f.check !== undefined) meta.check_cmd = f.check ?? "";
    if (f.deps !== undefined) meta.deps = depIds.join(",");
    if (f.layer !== undefined) meta.layer = f.layer ?? "";
    if (f.source !== undefined) meta.source = f.source ?? "";
    if (f.epicId !== undefined) meta.epic_id = f.epicId ? canonId(f.epicId) : "";
    if (f.frRefs !== undefined) meta.fr_refs = (f.frRefs ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",");
    const labels = [];
    if (f.status === "partial") labels.push("partial");
    if (f.status === "remediated") labels.push("remediated");
    importRows([
      buildIssueRow({
        id: cid,
        title: f.title,
        status: f.status,
        priority: f.priority ? Number(f.priority.slice(1)) : undefined,
        description: f.scope,
        acceptance: f.acceptance,
        metadata: meta,
        labels,
        depsEdges: edges,
      }),
    ]);
    console.log(f.id);
    return;
  }

  // existing row: targeted content update — never touches status/claim/notes
  const args = ["update", cid, "--title", f.title];
  if (f.scope !== undefined) args.push("--description", f.scope ?? "");
  if (f.acceptance !== undefined) args.push("--acceptance", f.acceptance ?? "");
  if (f.priority) args.push("--priority", String(Number(f.priority.slice(1))));
  const setMeta = [];
  if (f.check !== undefined) setMeta.push(`check_cmd=${f.check ?? ""}`);
  if (f.layer !== undefined) setMeta.push(`layer=${f.layer ?? ""}`);
  if (f.source !== undefined) setMeta.push(`source=${f.source ?? ""}`);
  if (f.epicId !== undefined) setMeta.push(`epic_id=${f.epicId ? canonId(f.epicId) : ""}`);
  if (f.frRefs !== undefined) setMeta.push(`fr_refs=${(f.frRefs ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",")}`);
  if (depIds !== null) setMeta.push(`deps=${depIds.join(",")}`);
  for (const kv of setMeta) args.push("--set-metadata", kv);
  bdOk(args);

  // dependency edge diff (exact replacement of the blocks set)
  if (depIds !== null) {
    const current = (keep.dependencies ?? []).filter((e) => e.type === "blocks").map((e) => e.depends_on_id);
    const toAdd = depIds.filter((d) => !current.includes(d));
    const toRemove = current.filter((d) => !depIds.includes(d));
    for (const d of toAdd) bdOk(["dep", "add", cid, d]);
    for (const d of toRemove) {
      const r = bd(["dep", "remove", cid, d], { allowFail: true });
      if (r && typeof r === "object" && r.failed) console.error(`tasks: dep remove failed (${cid} -> ${d}): ${r.stderr.trim().split("\n").pop()}`);
    }
  }
  console.log(cid);
}

function cmdEpicUpsert(f) {
  if (!f.id || !f.title) throw new CliError(2, "usage: tasks.mjs epic-upsert --id ID --title T [...]");
  const cid = canonId(f.id);
  const existing = new Map(exportEpics().map((r) => [r.id, r]));
  const keep = existing.get(cid);
  const now = new Date();
  const row = {
    _type: "issue",
    id: cid,
    title: f.title,
    description: f.goal ?? keep?.description ?? "",
    issue_type: "epic",
    status: keep?.status ?? "open",
    priority: keep?.priority ?? 2,
    external_ref: `nextgit:epic:${bareId(cid)}`,
    created_at: keep?.created_at ?? iso(now),
    updated_at: nextIso(keep?.updated_at, now),
    metadata: { ...(keep?.metadata ?? {}), milestone: f.milestone ?? keep?.metadata?.milestone ?? "", source: f.source ?? keep?.metadata?.source ?? "" },
    labels: [...new Set([...(keep?.labels ?? []).filter((l) => !l.startsWith("milestone:")), ...(f.milestone ? [`milestone:${f.milestone}`] : [])])],
  };
  importRows([row]);
  console.log(cid);
}

function cmdEpicList(json) {
  const rows = exportEpics()
    .map((r) => ({
      id: r.id,
      title: r.title,
      goal: r.description ?? null,
      milestone: labelsOf(r).find((l) => l.startsWith("milestone:"))?.slice("milestone:".length) ?? null,
      status: r.status,
      source: metaOf(r).source ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    }))
    .sort((a, b) => String(a.milestone).localeCompare(String(b.milestone)) || a.id.localeCompare(b.id));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) console.log(`${r.milestone ?? "-"}  ${r.status}  ${r.id}  ${r.title}`);
}

// Flip staged rows runnable: blocked -> open for a source prefix (explicit activation gate).
function cmdActivate(prefix) {
  const staged = exportAll()
    .filter((r) => r.status === "blocked" && String(metaOf(r).source ?? "").startsWith(prefix))
    .map((r) => r.id);
  if (!staged.length) {
    console.log("activated 0");
    return;
  }
  bdOk(["update", ...staged, "--status", "open"]);
  console.log(`activated ${staged.length}`);
}

function cmdSet(id, status, evidence, owner) {
  if (!id || !status || !STATUSES.includes(status)) throw new CliError(2, "usage: tasks.mjs set <id> --status <...> [--evidence e] [--owner o]");
  const cid = canonId(id);
  const rows = exportAll();
  const row = rows.find((r) => r.id === cid);
  if (!row) throw new CliError(2, `unknown task: ${id}`);
  const note = evidence ? (status === "done" ? `COMPLETED: ${evidence}` : `EVIDENCE: ${evidence}`) : null;
  if (status === "done" || status === "remediated") {
    const args = ["update", cid, "--status", "closed"];
    if (row.status === "in_progress") args.push("--if-status", "in_progress");
    if (note) args.push("--append-notes", note);
    if (owner) args.push("--set-metadata", `owner=${owner}`); // owner is a metadata stamp (see toRow), not the claim assignee
    const r = bd(args, { allowFail: true });
    if (r && typeof r === "object" && r.failed) {
      if (r.status === 13) {
        // lost the CAS race (claim moved) — retry unconditionally, preserving tick semantics
        const plain = ["update", cid, "--status", "closed"];
        if (note) plain.push("--append-notes", note);
        bdOk(plain);
        console.error(`tasks: CAS note — ${cid} changed state mid-tick; closed unconditionally`);
      } else throw new CliError(1, `bd update: ${r.stderr.trim().split("\n").pop()}`);
    }
  } else {
    const args = ["update", cid, "--status", STATUS_MAP_NEW[status]];
    if (status === "partial") args.push("--add-label", "partial");
    if (status === "remediated") args.push("--add-label", "remediated");
    if (note) args.push("--append-notes", note);
    if (owner) args.push("--set-metadata", `owner=${owner}`); // owner is a metadata stamp (see toRow), not the claim assignee
    bdOk(args);
  }
  if (status === "done" && !evidence && !row.notes) console.error(`WARN: marking ${cid} done without evidence`);
  console.log(status);
}

function cmdClaim(id, agent, ttl, note) {
  if (!id || !agent) throw new CliError(2, "usage: tasks.mjs claim <id> --agent A [--ttl 3600] [--note n]");
  const cid = canonId(id);
  const known = exportAll().some((r) => r.id === cid);
  if (!known) throw new CliError(2, `unknown task: ${id}`);
  const r = bd(["update", cid, "--claim"], { actor: agent, allowFail: true });
  if (r && typeof r === "object" && r.failed) {
    const msg = r.stderr.trim().split("\n").pop() ?? "claim failed";
    if (/already claimed|in_progress/i.test(msg)) throw new CliError(3, `claim conflict: ${msg}`);
    throw new CliError(1, `claim: ${msg}`);
  }
  if (note) bd(["comment", cid, note], { actor: agent, allowFail: true });
  const fresh = exportAll().find((r2) => r2.id === cid);
  console.log(`${cid} claimed by ${fresh?.assignee ?? agent} until ${fresh?.lease_expires_at ?? "(lease ~5m; heartbeat to extend)"}`);
  if (ttl !== undefined) console.error(`tasks: note — bd leases are fixed (~5m); --ttl ignored. Use \`heartbeat <id> --agent ${agent}\` for long orders.`);
}

function cmdHeartbeat(id, agent) {
  if (!id) throw new CliError(2, "usage: tasks.mjs heartbeat <id> [--agent A]");
  const cid = canonId(id);
  const r = bd(["heartbeat", cid], { actor: agent, allowFail: true });
  if (r && typeof r === "object" && r.failed) throw new CliError(3, `heartbeat: ${r.stderr.trim().split("\n").pop()}`);
  console.log(`heartbeat ${cid}`);
}

function cmdReclaim(olderThan) {
  const args = ["reclaim", "--older-than", olderThan ?? "10m"];
  bdOk(args);
  console.log(`reclaimed (older-than ${olderThan ?? "10m"})`);
}

function cmdRelease(id, agent) {
  if (!id) throw new CliError(2, "usage: tasks.mjs release <id> [--agent A]");
  const cid = canonId(id);
  const rows = exportAll();
  const row = rows.find((r) => r.id === cid);
  if (!row) throw new CliError(2, `unknown task: ${id}`);
  if (row.status !== "in_progress" || !row.assignee) throw new CliError(3, `no claim to release: ${id}`);
  const actor = agent || row.assignee;
  const r = bd(["unclaim", cid], { actor, allowFail: true });
  if (r && typeof r === "object" && r.failed) throw new CliError(3, `release: ${r.stderr.trim().split("\n").pop()}`);
  console.log(`released ${cid}`);
}

const renderRow = (r) =>
  `- [${r.status}] ${r.priority ? `${r.priority} — ` : ""}${r.title}${r.scope ? ` — ${r.scope}` : ""}`;

function cmdView(out) {
  const outPath = resolve(out || "docs/NEXT-ACTIONS.md");
  const rows = sortRows(exportAll().map(toRow));
  const pending = rows.filter((r) => r.status === "pending" || r.status === "partial");
  const closed = [];
  for (const s of ["done", "remediated", "blocked"]) closed.push(...rows.filter((r) => r.status === s));
  const sections = [
    "# Next actions\n\n> Derived from the bd store (beads/Dolt) via `bun porting/tasks.mjs view` — never edit by hand; starting fresh? Read docs/STATE.md then docs/CHECKPOINT.md.",
  ];
  if (pending.length) sections.push(pending.map(renderRow).join("\n"));
  if (closed.length) sections.push(closed.map(renderRow).join("\n"));
  sections.push("Grammar: `- [status] Pn — title`. Statuses: `pending|done|remediated|blocked|partial`.");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, sections.join("\n\n") + "\n");
  console.log(`view -> ${outPath}`);
}

// ---------------------------------------------------------------------------
// arg parsing / dispatch (legacy surface)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const str = (v) => (typeof v === "string" ? v : undefined);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  switch (cmd) {
    case "init":
      cmdInit();
      break;
    case "import": {
      const file = pos[0];
      if (!file) throw new CliError(2, "usage: tasks.mjs import <path>");
      if (!existsSync(file)) throw new CliError(2, `cannot read ${file}`);
      cmdImport(null, file);
      break;
    }
    case "list": {
      const { status, priority } = flags;
      if (status !== undefined && (typeof status !== "string" || !STATUSES.includes(status))) throw new CliError(2, `invalid --status: ${status}`);
      if (priority !== undefined && (typeof priority !== "string" || !PRIORITIES.includes(priority))) throw new CliError(2, `invalid --priority: ${priority}`);
      cmdList({ status, priority, json: flags.json === true });
      break;
    }
    case "next":
      cmdNext();
      break;
    case "done-ids":
      cmdDoneIds();
      break;
    case "add": {
      const id = str(flags.id);
      const title = str(flags.title);
      if (!id || !title) throw new CliError(2, "usage: tasks.mjs add --id ID --title T [--priority P0-P3] [--scope s] [--acceptance a] [--check cmd] [--deps a,b] [--layer l] [--source s]");
      if (flags.priority !== undefined && (typeof flags.priority !== "string" || !PRIORITIES.includes(flags.priority))) throw new CliError(2, `invalid --priority: ${flags.priority}`);
      cmdAdd({ id, title, priority: str(flags.priority), scope: str(flags.scope), acceptance: str(flags.acceptance), check: str(flags.check), deps: str(flags.deps), layer: str(flags.layer), source: str(flags.source) });
      break;
    }
    case "upsert": {
      const id = str(flags.id);
      const title = str(flags.title);
      if (!id || !title) throw new CliError(2, "usage: tasks.mjs upsert --id ID --title T [--status S] [--priority P0-P3] [--scope s] [--acceptance a] [--check cmd] [--deps a,b] [--layer l] [--source s] [--epic-id e] [--fr-refs FR-1,FR-2]");
      if (flags.priority !== undefined && (typeof flags.priority !== "string" || !PRIORITIES.includes(flags.priority))) throw new CliError(2, `invalid --priority: ${flags.priority}`);
      if (flags.status !== undefined && (typeof flags.status !== "string" || !STATUSES.includes(flags.status))) throw new CliError(2, `invalid --status: ${flags.status}`);
      cmdUpsert({ id, title, status: str(flags.status), priority: str(flags.priority), scope: str(flags.scope), acceptance: str(flags.acceptance), check: str(flags.check), deps: str(flags.deps), layer: str(flags.layer), source: str(flags.source), epicId: str(flags["epic-id"]), frRefs: str(flags["fr-refs"]) });
      break;
    }
    case "epic-upsert": {
      const id = str(flags.id);
      const title = str(flags.title);
      if (!id || !title) throw new CliError(2, "usage: tasks.mjs epic-upsert --id ID --title T [--goal g] [--milestone M1] [--status s] [--source s]");
      cmdEpicUpsert({ id, title, goal: str(flags.goal), milestone: str(flags.milestone), status: str(flags.status), source: str(flags.source) });
      break;
    }
    case "epic-list":
      cmdEpicList(flags.json === true);
      break;
    case "activate": {
      const prefix = pos[0];
      if (!prefix) throw new CliError(2, "usage: tasks.mjs activate <source-prefix>");
      cmdActivate(prefix);
      break;
    }
    case "set": {
      const id = pos[0];
      const status = str(flags.status);
      if (!id || !status || !STATUSES.includes(status)) throw new CliError(2, "usage: tasks.mjs set <id> --status <pending|done|blocked|remediated|partial> [--evidence e] [--owner o]");
      cmdSet(id, status, str(flags.evidence), str(flags.owner));
      break;
    }
    case "claim": {
      const id = pos[0];
      const agent = str(flags.agent);
      if (!id || !agent) throw new CliError(2, "usage: tasks.mjs claim <id> --agent A [--ttl 3600] [--note n]");
      let ttl;
      if (flags.ttl !== undefined) {
        if (typeof flags.ttl !== "string" || !Number.isFinite(Number(flags.ttl))) throw new CliError(2, `invalid --ttl: ${flags.ttl}`);
        ttl = Number(flags.ttl);
      }
      cmdClaim(id, agent, ttl, str(flags.note));
      break;
    }
    case "heartbeat": {
      const id = pos[0];
      if (!id) throw new CliError(2, "usage: tasks.mjs heartbeat <id> [--agent A]");
      cmdHeartbeat(id, str(flags.agent));
      break;
    }
    case "reclaim":
      cmdReclaim(str(flags["older-than"]));
      break;
    case "release": {
      const id = pos[0];
      if (!id) throw new CliError(2, "usage: tasks.mjs release <id> [--agent A]");
      cmdRelease(id, str(flags.agent));
      break;
    }
    case "view":
      cmdView(str(flags.out));
      break;
    default:
      throw new CliError(2, `usage: tasks.mjs <init|import|add|upsert|set|claim|heartbeat|release|reclaim|next|done-ids|list|view|epic-upsert|epic-list|activate>${cmd ? ` (unknown command: ${cmd})` : ""}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    if (e instanceof CliError) {
      console.error(`tasks: ${e.message}`);
      process.exit(e.code);
    }
    console.error(`tasks: ${e?.message ?? e}`);
    process.exit(1);
  });
}
