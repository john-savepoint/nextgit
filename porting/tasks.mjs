#!/usr/bin/env bun
// porting/tasks.mjs — SQLite task backbone for the NextGit queue.
//
// The store is authoritative; docs/NEXT-ACTIONS.md is a derived view (`view`).
// Zero npm deps: bun:sqlite + node builtins only. Safe across concurrent bun
// processes: WAL + busy_timeout=5000, and every write runs in BEGIN IMMEDIATE.
//
// Commands: init | import <path> | add | upsert | set | claim | release | next | list | view | query | epic-upsert | epic-list | activate
// Exit codes: 0 ok · 1 no unblocked pending / generic error · 2 usage/validation/unknown id/duplicate id/rejected query · 3 claim conflict / release without claim

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STATUSES = ["pending", "done", "blocked", "remediated", "partial"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const GRAMMAR_RE = /^- \[(pending|done|blocked|remediated|partial)\]\s+(?:(P[0-3])\s+—\s+)?(.+)$/;
const ORDER_BY =
 "ORDER BY (t.priority IS NULL), CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 END, t.created_at, t.rowid";
const PRAGMA_ALLOW = new Set([
 "table_info", "table_list", "table_xinfo", "index_list", "index_info", "index_xinfo",
 "foreign_key_list", "database_list", "schema_version", "user_version", "page_count",
 "page_size", "freelist_count", "integrity_check", "quick_check", "compile_options", "application_id",
]);

class CliError extends Error {
 constructor(code, msg) {
  super(msg);
  this.code = code;
 }
}

export const slugify = (title) =>
 String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export const defaultDbPath = () => process.env.TASKS_DB || "porting/tasks.db";

export function ensureSchema(db) {
 db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT,
  scope TEXT,
  acceptance TEXT,
  check_cmd TEXT,
  deps TEXT,
  evidence TEXT,
  owner TEXT,
  layer TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS claims (
  task_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  note TEXT,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  task_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority, created_at);
CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT,
  milestone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
 // idempotent additive migration for stores created before a column existed
 const cols = new Set(db.query("PRAGMA table_info(tasks)").all().map((c) => c.name));
 if (!cols.has("layer")) db.exec("ALTER TABLE tasks ADD COLUMN layer TEXT");
 if (!cols.has("source")) db.exec("ALTER TABLE tasks ADD COLUMN source TEXT");
 if (!cols.has("epic_id")) db.exec("ALTER TABLE tasks ADD COLUMN epic_id TEXT");
 if (!cols.has("fr_refs")) db.exec("ALTER TABLE tasks ADD COLUMN fr_refs TEXT");
}

export function openDb(p, { readonly = false } = {}) {
 if (!readonly) mkdirSync(dirname(resolve(p)), { recursive: true });
 const db = readonly ? new Database(p, { readonly: true }) : new Database(p);
 db.exec("PRAGMA busy_timeout = 5000");
 if (!readonly) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  ensureSchema(db);
 }
 return db;
}

function writeTx(db, fn) {
 db.exec("BEGIN IMMEDIATE");
 try {
  const r = fn();
  db.exec("COMMIT");
  return r;
 } catch (e) {
  try { db.exec("ROLLBACK"); } catch { }
  throw e;
 }
}

const event = (db, kind, taskId, detail) =>
 db.prepare("INSERT INTO events (kind, task_id, detail) VALUES (?, ?, ?)").run(kind, taskId ?? null, detail ?? null);

export function readRows(db, { status, priority } = {}) {
 const where = [];
 const params = [];
 if (status) { where.push("t.status = ?"); params.push(status); }
 if (priority) { where.push("t.priority = ?"); params.push(priority); }
 return db
  .query(
   `SELECT t.*, c.agent AS claimed_by, c.lease_until AS claim_lease
         FROM tasks t
         LEFT JOIN claims c ON c.task_id = t.id AND c.lease_until > datetime('now')
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ${ORDER_BY}`
  )
  .all(...params);
}

function allocateId(base, title, db, used) {
 const stem = base || "task";
 let candidate = stem;
 let n = 1;
 for (; ;) {
  const row = db.query("SELECT title FROM tasks WHERE id = ?").get(candidate);
  if (!used.has(candidate) && (!row || row.title === title)) break;
  n++;
  const suffix = `-${n}`;
  candidate = stem.slice(0, 60 - suffix.length) + suffix;
 }
 used.add(candidate);
 return candidate;
}

function cmdImport(dbPath, file) {
 const text = readFileSync(file, "utf8");
 const db = openDb(dbPath);
 let count = 0;
 writeTx(db, () => {
  const used = new Set();
  const upsert = db.prepare(`
      INSERT INTO tasks (id, title, status, priority, scope, check_cmd, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        priority = excluded.priority,
        scope = excluded.scope,
        check_cmd = COALESCE(excluded.check_cmd, tasks.check_cmd),
        updated_at = datetime('now')`);
  for (const line of text.split("\n")) {
   const m = line.match(GRAMMAR_RE);
   if (!m) continue;
   const status = m[1];
   const priority = m[2] ?? null;
   const rest = m[3];
   const cut = rest.indexOf(" — ");
   const title = (cut === -1 ? rest : rest.slice(0, cut)).trim();
   if (!title) continue;
   const scope = cut === -1 ? null : rest.slice(cut + 3).trim();
   const id = allocateId(slugify(title), title, db, used);
   const check = scope ? scope.match(/check:\s*(.+)$/i) : null;
   const checkCmd = check ? check[1].trim() : null;
   const isNew = !db.query("SELECT id FROM tasks WHERE id = ?").get(id);
   upsert.run(id, title, status, priority, scope, checkCmd);
   event(db, "import", id, `imported from ${file} (${isNew ? "new" : "updated"})`);
   count++;
  }
 });
 console.log(`imported ${count} rows into ${resolve(dbPath)}`);
}

function cmdList(dbPath, { status, priority, json }) {
 const db = openDb(dbPath);
 const rows = readRows(db, { status, priority });
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

function cmdNext(dbPath) {
 const db = openDb(dbPath);
 const rows = db
  .query(
   `SELECT t.*, c.agent AS claimed_by
         FROM tasks t
         LEFT JOIN claims c ON c.task_id = t.id AND c.lease_until > datetime('now')
         WHERE t.status = 'pending'
         ${ORDER_BY}`
  )
  .all();
 const done = new Set(db.query("SELECT id FROM tasks WHERE status = 'done'").all().map((r) => r.id));
 for (const r of rows) {
  if (r.claimed_by) continue;
  const deps = (r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!deps.every((d) => done.has(d))) continue;
  console.log(`id: ${r.id}`);
  console.log(`title: ${r.title}`);
  console.log(`acceptance: ${r.acceptance ?? r.scope ?? "(none)"}`);
  console.log(`check: ${r.check_cmd ?? "(none)"}`);
  return;
 }
 throw new CliError(1, "no unblocked pending task");
}

function cmdAdd(dbPath, { id, title, priority, scope, acceptance, check, deps, layer, source }) {
 const normDeps = deps ? deps.split(",").map((s) => s.trim()).filter(Boolean).join(",") : null;
 const db = openDb(dbPath);
 writeTx(db, () => {
  if (db.query("SELECT id FROM tasks WHERE id = ?").get(id)) throw new CliError(2, `duplicate id: ${id}`);
  db.prepare(
   `INSERT INTO tasks (id, title, status, priority, scope, acceptance, check_cmd, deps, layer, source)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, priority ?? null, scope ?? null, acceptance ?? null, check ?? null, normDeps || null, layer ?? null, source ?? null);
  event(db, "add", id, `added${priority ? " " + priority : ""}`);
 });
 console.log(id);
}

// Full-field content upsert (idempotent re-compile): content fields update in place;
// status/evidence/owner are PRESERVED on conflict — re-compiles never clobber progress or proof.
function cmdUpsert(dbPath, f) {
 const normDeps = f.deps ? f.deps.split(",").map((s) => s.trim()).filter(Boolean).join(",") : null;
 const normRefs = f.frRefs ? f.frRefs.split(",").map((s) => s.trim()).filter(Boolean).join(",") : null;
 const db = openDb(dbPath);
 const status = f.status ?? "pending";
 if (!STATUSES.includes(status)) throw new CliError(2, `invalid status: ${status}`);
 writeTx(db, () => {
  const isNew = !db.query("SELECT id FROM tasks WHERE id = ?").get(f.id);
  db.prepare(
   `INSERT INTO tasks (id, title, status, priority, scope, acceptance, check_cmd, deps, layer, source, epic_id, fr_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        priority = excluded.priority,
        scope = excluded.scope,
        acceptance = excluded.acceptance,
        check_cmd = excluded.check_cmd,
        deps = excluded.deps,
        layer = excluded.layer,
        source = excluded.source,
        epic_id = excluded.epic_id,
        fr_refs = excluded.fr_refs,
        updated_at = datetime('now')`
  ).run(f.id, f.title, status, f.priority ?? null, f.scope ?? null, f.acceptance ?? null, f.check ?? null, normDeps, f.layer ?? null, f.source ?? null, f.epicId ?? null, normRefs);
  event(db, isNew ? "upsert-new" : "upsert-update", f.id, isNew ? `inserted (${status})` : "content updated; status/evidence preserved");
 });
 console.log(f.id);
}

function cmdEpicUpsert(dbPath, f) {
 const db = openDb(dbPath);
 writeTx(db, () => {
  const isNew = !db.query("SELECT id FROM epics WHERE id = ?").get(f.id);
  db.prepare(
   `INSERT INTO epics (id, title, goal, milestone, status, source)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        goal = excluded.goal,
        milestone = excluded.milestone,
        source = excluded.source,
        updated_at = datetime('now')`
  ).run(f.id, f.title, f.goal ?? null, f.milestone ?? null, f.status ?? "active", f.source ?? null);
  event(db, isNew ? "epic-new" : "epic-update", f.id, isNew ? "inserted" : "updated");
 });
 console.log(f.id);
}

function cmdEpicList(dbPath, json) {
 const db = openDb(dbPath);
 const rows = db.query("SELECT * FROM epics ORDER BY milestone, id").all();
 if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
 for (const r of rows) console.log(`${r.milestone ?? "-"}  ${r.status}  ${r.id}  ${r.title}`);
}

// Flip staged rows runnable: blocked -> pending for a source prefix (explicit activation gate).
function cmdActivate(dbPath, prefix) {
 const db = openDb(dbPath);
 let n = 0;
 writeTx(db, () => {
  const r = db.prepare("UPDATE tasks SET status = 'pending', updated_at = datetime('now') WHERE status = 'blocked' AND source LIKE ? || '%'").run(prefix);
  n = r.changes;
  event(db, "activate", null, `${n} rows activated (source like ${prefix}%)`);
 });
 console.log(`activated ${n}`);
}

function cmdSet(dbPath, id, status, evidence, owner) {
 const db = openDb(dbPath);
 let effective;
 writeTx(db, () => {
  const row = db.query("SELECT evidence FROM tasks WHERE id = ?").get(id);
  if (!row) throw new CliError(2, `unknown task: ${id}`);
  db.prepare(
   `UPDATE tasks SET status = ?, evidence = COALESCE(?, evidence), owner = COALESCE(?, owner), updated_at = datetime('now') WHERE id = ?`
  ).run(status, evidence ?? null, owner ?? null, id);
  event(db, "set", id, `status=${status}${evidence ? ` evidence=${evidence}` : ""}`);
  effective = evidence ?? row.evidence ?? "";
 });
 if (status === "done" && !effective) console.error(`WARN: marking ${id} done without evidence`);
 console.log(status);
}

function cmdClaim(dbPath, id, agent, ttl, note) {
 const db = openDb(dbPath);
 let lease;
 writeTx(db, () => {
  if (!db.query("SELECT id FROM tasks WHERE id = ?").get(id)) throw new CliError(2, `unknown task: ${id}`);
  const row = db
   .query("SELECT agent, lease_until, (lease_until > datetime('now')) AS live FROM claims WHERE task_id = ?")
   .get(id);
  if (row?.live && row.agent !== agent) {
   throw new CliError(3, `claim conflict: ${id} is claimed by ${row.agent} until ${row.lease_until}`);
  }
  if (row?.live) {
   db.prepare(
    `UPDATE claims SET lease_until = datetime('now', ?), claimed_at = datetime('now'), note = COALESCE(?, note) WHERE task_id = ?`
   ).run(`${ttl} seconds`, note ?? null, id);
   event(db, "claim-refresh", id, `refreshed by ${agent} (ttl ${ttl}s)`);
  } else {
   if (row) db.prepare("DELETE FROM claims WHERE task_id = ?").run(id);
   db.prepare(
    `INSERT INTO claims (task_id, agent, note, lease_until) VALUES (?, ?, ?, datetime('now', ?))`
   ).run(id, agent, note ?? null, `${ttl} seconds`);
   event(db, "claim", id, `claimed by ${agent} (ttl ${ttl}s)`);
  }
  lease = db.query("SELECT lease_until FROM claims WHERE task_id = ?").get(id).lease_until;
 });
 console.log(`${id} claimed by ${agent} until ${lease}`);
}

function cmdRelease(dbPath, id) {
 const db = openDb(dbPath);
 writeTx(db, () => {
  const r = db.prepare("DELETE FROM claims WHERE task_id = ?").run(id);
  if (r.changes === 0) throw new CliError(3, `no claim to release: ${id}`);
  event(db, "release", id, "released");
 });
 console.log(`released ${id}`);
}

const renderRow = (r) =>
 `- [${r.status}] ${r.priority ? `${r.priority} — ` : ""}${r.title}${r.scope ? ` — ${r.scope}` : ""}`;

function cmdView(dbPath, out) {
 const outPath = resolve(out || "docs/NEXT-ACTIONS.md");
 const db = openDb(dbPath);
 const rows = db.query(`SELECT * FROM tasks t ${ORDER_BY}`).all();
 const pending = rows.filter((r) => r.status === "pending");
 const closed = [];
 for (const s of ["done", "blocked", "remediated", "partial"]) closed.push(...rows.filter((r) => r.status === s));
 const sections = [
  "# Next actions\n\n> Derived from porting/tasks.db via bun porting/tasks.mjs — never edit by hand; starting fresh? Read docs/STATE.md then docs/CHECKPOINT.md.",
 ];
 if (pending.length) sections.push(pending.map(renderRow).join("\n"));
 if (closed.length) sections.push(closed.map(renderRow).join("\n"));
 sections.push("Grammar: `- [status] Pn — title`. Statuses: `pending|done|remediated|blocked|partial`.");
 mkdirSync(dirname(outPath), { recursive: true });
 writeFileSync(outPath, sections.join("\n\n") + "\n");
 console.log(`view -> ${outPath}`);
}

function cmdQuery(dbPath, sql) {
 if (!sql) throw new CliError(2, 'usage: tasks.mjs query "SELECT ..."');
 const s = sql.trim();
 if (!/^(SELECT|PRAGMA)\b/i.test(s)) throw new CliError(2, "query rejected: only SELECT/PRAGMA statements");
 if (/;\s*\S/.test(s)) throw new CliError(2, "query rejected: single statement only");
 const stmt = s.replace(/(;+\s*)+$/, "");
 if (/^PRAGMA/i.test(stmt)) {
  const m = stmt.match(/^PRAGMA\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  const name = (m?.[1] ?? "").toLowerCase();
  if (stmt.includes("=") || !PRAGMA_ALLOW.has(name)) throw new CliError(2, `query rejected: PRAGMA ${name || "?"} is not allowed`);
 }
 const db = openDb(dbPath, { readonly: true });
 console.log(JSON.stringify(db.query(stmt).all(), null, 2));
}

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
 const dbPath = defaultDbPath();
 switch (cmd) {
  case "init": {
   const db = openDb(dbPath);
   writeTx(db, () => ensureSchema(db));
   console.log(`initialized ${resolve(dbPath)}`);
   break;
  }
  case "import": {
   const file = pos[0];
   if (!file) throw new CliError(2, "usage: tasks.mjs import <path>");
   if (!existsSync(file)) throw new CliError(2, `cannot read ${file}`);
   cmdImport(dbPath, file);
   break;
  }
  case "list": {
   const { status, priority } = flags;
   if (status !== undefined && (typeof status !== "string" || !STATUSES.includes(status))) throw new CliError(2, `invalid --status: ${status}`);
   if (priority !== undefined && (typeof priority !== "string" || !PRIORITIES.includes(priority))) throw new CliError(2, `invalid --priority: ${priority}`);
   cmdList(dbPath, { status, priority, json: flags.json === true });
   break;
  }
  case "next":
   cmdNext(dbPath);
   break;
  case "add": {
   const id = str(flags.id);
   const title = str(flags.title);
   if (!id || !title) throw new CliError(2, "usage: tasks.mjs add --id ID --title T [--priority P0-P3] [--scope s] [--acceptance a] [--check cmd] [--deps a,b] [--layer l] [--source s]");
   let priority = null;
   if (flags.priority !== undefined) {
    if (typeof flags.priority !== "string" || !PRIORITIES.includes(flags.priority)) throw new CliError(2, `invalid --priority: ${flags.priority}`);
    priority = flags.priority;
   }
   cmdAdd(dbPath, { id, title, priority, scope: str(flags.scope), acceptance: str(flags.acceptance), check: str(flags.check), deps: str(flags.deps), layer: str(flags.layer), source: str(flags.source) });
   break;
  }
  case "upsert": {
   const id = str(flags.id);
   const title = str(flags.title);
   if (!id || !title) throw new CliError(2, "usage: tasks.mjs upsert --id ID --title T [--status S] [--priority P0-P3] [--scope s] [--acceptance a] [--check cmd] [--deps a,b] [--layer l] [--source s] [--epic-id e] [--fr-refs FR-1,FR-2]");
   let priority = null;
   if (flags.priority !== undefined) {
    if (typeof flags.priority !== "string" || !PRIORITIES.includes(flags.priority)) throw new CliError(2, `invalid --priority: ${flags.priority}`);
    priority = flags.priority;
   }
   cmdUpsert(dbPath, { id, title, status: str(flags.status), priority, scope: str(flags.scope), acceptance: str(flags.acceptance), check: str(flags.check), deps: str(flags.deps), layer: str(flags.layer), source: str(flags.source), epicId: str(flags["epic-id"]), frRefs: str(flags["fr-refs"]) });
   break;
  }
  case "epic-upsert": {
   const id = str(flags.id);
   const title = str(flags.title);
   if (!id || !title) throw new CliError(2, "usage: tasks.mjs epic-upsert --id ID --title T [--goal g] [--milestone M1] [--status s] [--source s]");
   cmdEpicUpsert(dbPath, { id, title, goal: str(flags.goal), milestone: str(flags.milestone), status: str(flags.status), source: str(flags.source) });
   break;
  }
  case "epic-list":
   cmdEpicList(dbPath, flags.json === true);
   break;
  case "activate": {
   const prefix = pos[0];
   if (!prefix) throw new CliError(2, "usage: tasks.mjs activate <source-prefix>");
   cmdActivate(dbPath, prefix);
   break;
  }
  case "set": {
   const id = pos[0];
   const status = str(flags.status);
   if (!id || !status || !STATUSES.includes(status)) throw new CliError(2, "usage: tasks.mjs set <id> --status <pending|done|blocked|remediated|partial> [--evidence e] [--owner o]");
   cmdSet(dbPath, id, status, str(flags.evidence), str(flags.owner));
   break;
  }
  case "claim": {
   const id = pos[0];
   const agent = str(flags.agent);
   if (!id || !agent) throw new CliError(2, "usage: tasks.mjs claim <id> --agent A [--ttl 3600] [--note n]");
   let ttl = 3600;
   if (flags.ttl !== undefined) {
    if (typeof flags.ttl !== "string" || !Number.isFinite(Number(flags.ttl))) throw new CliError(2, `invalid --ttl: ${flags.ttl}`);
    ttl = Number(flags.ttl);
   }
   cmdClaim(dbPath, id, agent, ttl, str(flags.note));
   break;
  }
  case "release": {
   const id = pos[0];
   if (!id) throw new CliError(2, "usage: tasks.mjs release <id>");
   cmdRelease(dbPath, id);
   break;
  }
  case "view":
   cmdView(dbPath, str(flags.out));
   break;
  case "query":
   cmdQuery(dbPath, pos[0]);
   break;
  default:
   throw new CliError(2, `usage: tasks.mjs <init|import|add|upsert|set|claim|release|next|list|view|query|epic-upsert|epic-list|activate>${cmd ? ` (unknown command: ${cmd})` : ""}`);
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
