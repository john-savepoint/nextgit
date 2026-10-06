#!/usr/bin/env bun
// Regression suite for the SQLite task backbone (porting/tasks.mjs).
// Run: bun porting/tests/tasks.test.mjs   (exit 0 = pass)
//
// Every case runs against its own temp DB via TASKS_DB; the real
// porting/tasks.db is never opened and docs/NEXT-ACTIONS.md is only read.

import { spawnSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TASKS = join(ROOT, "porting/tasks.mjs");
const tmp = mkdtempSync(join(tmpdir(), "tasks-test-"));
const tmpDb = join(tmp, "tasks.db");
const dbFor = (name) => join(tmp, `${name}.db`);

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const run = (args, env = {}) =>
  spawnSync("bun", [TASKS, ...args], { cwd: ROOT, env: { ...process.env, TASKS_DB: tmpDb, ...env }, encoding: "utf8" });
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const idOf = (out) => (out.match(/^id: (.+)$/m) ?? [])[1];

const { openDb } = await import(pathToFileURL(TASKS).href);

// --- 1. init + import idempotency -------------------------------------------
const db1 = dbFor("case1");
try {
  const fix = join(tmp, "fix.md");
  writeFileSync(fix, [
    "# fixture",
    "",
    "- [pending] P0 — Dup title — scope one; check: bun porting/tests/tasks.test.mjs",
    "- [pending] P1 — Dup title — scope two",
    "- [done] P2 — Other row — scope three",
    "",
  ].join("\n"));
  const c1 = { TASKS_DB: db1 };
  const i1 = run(["init"], c1), i2 = run(["init"], c1);
  check("1 init twice exits 0", i1.status === 0 && i2.status === 0, i1.stderr || i2.stderr);
  const p1 = run(["import", fix], c1), p2 = run(["import", fix], c1);
  check("1 import twice exits 0", p1.status === 0 && p2.status === 0, p1.stderr || p2.stderr);
  const rows = jparse(run(["list", "--json"], c1).stdout) ?? [];
  check("1 row count stable at 3", rows.length === 3, `got ${rows.length}`);
  check("1 ids stable (dup suffix)", JSON.stringify(rows.map((r) => r.id).sort()) === JSON.stringify(["dup-title", "dup-title-2", "other-row"]), JSON.stringify(rows.map((r) => r.id)));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  check("1 statuses/priorities/titles match fixture",
    byId["dup-title"]?.status === "pending" && byId["dup-title"]?.priority === "P0" && byId["dup-title"]?.title === "Dup title" &&
    byId["dup-title-2"]?.status === "pending" && byId["dup-title-2"]?.priority === "P1" &&
    byId["other-row"]?.status === "done" && byId["other-row"]?.priority === "P2" && byId["other-row"]?.title === "Other row",
    JSON.stringify(rows.map((r) => [r.id, r.status, r.priority, r.title])));
  const ev = jparse(run(["query", "SELECT task_id, COUNT(*) AS n FROM events WHERE kind='import' GROUP BY task_id"], c1).stdout) ?? [];
  check("1 import event per row", ev.length === 3 && ev.every((e) => e.n >= 1), JSON.stringify(ev));
} catch (e) { check("1 case threw", false, String(e?.stack ?? e)); }

// --- 2. add/set/list round-trip ---------------------------------------------
const db2 = dbFor("case2");
try {
  const c2 = { TASKS_DB: db2 };
  check("2 add t-a", run(["add", "--id", "t-a", "--title", "Alpha", "--priority", "P1", "--scope", "s", "--deps", "t-b"], c2).status === 0);
  check("2 add t-b", run(["add", "--id", "t-b", "--title", "Beta"], c2).status === 0);
  const all = jparse(run(["list", "--json"], c2).stdout) ?? [];
  const tA = all.find((r) => r.id === "t-a");
  check("2 list contains both", !!tA && !!all.find((r) => r.id === "t-b"));
  check("2 deps normalized", tA?.deps === "t-b", tA?.deps);
  const filtered = jparse(run(["list", "--status", "pending", "--priority", "P1", "--json"], c2).stdout) ?? [];
  check("2 status+priority filter", filtered.length === 1 && filtered[0].id === "t-a" && filtered.every((r) => r.status === "pending" && r.priority === "P1"), JSON.stringify(filtered.map((r) => r.id)));
  const s1 = run(["set", "t-a", "--status", "done", "--evidence", "ran x"], c2);
  let t = (jparse(run(["list", "--json"], c2).stdout) ?? []).find((r) => r.id === "t-a");
  check("2 set done + evidence", s1.status === 0 && t?.status === "done" && t?.evidence === "ran x", `${s1.status} ${s1.stderr}`);
  run(["set", "t-a", "--status", "partial", "--owner", "alice"], c2);
  t = (jparse(run(["list", "--json"], c2).stdout) ?? []).find((r) => r.id === "t-a");
  check("2 evidence preserved + owner set", t?.status === "partial" && t?.evidence === "ran x" && t?.owner === "alice", JSON.stringify([t?.status, t?.evidence, t?.owner]));
  check("2 set unknown id exits 2", run(["set", "nope", "--status", "done"], c2).status === 2);
  const s4 = run(["set", "t-b", "--status", "done"], c2);
  check("2 done without evidence: exit 0 + WARN", s4.status === 0 && /WARN.*evidence/.test(s4.stderr), `exit ${s4.status} stderr=${JSON.stringify(s4.stderr)}`);
  const s5 = run(["set", "t-b", "--status", "done", "--evidence", "e"], c2);
  check("2 done with evidence: no WARN", s5.status === 0 && !/WARN/.test(s5.stderr), s5.stderr);
} catch (e) { check("2 case threw", false, String(e?.stack ?? e)); }

// --- 3. next: deps + live claims + lease expiry -----------------------------
const db3 = dbFor("case3");
try {
  const c3 = { TASKS_DB: db3 };
  for (const a of [
    ["add", "--id", "n1", "--title", "N one", "--priority", "P0"],
    ["add", "--id", "n2", "--title", "N two", "--priority", "P0", "--deps", "n1"],
    ["add", "--id", "n3", "--title", "N three", "--priority", "P1"],
    ["add", "--id", "n4", "--title", "N four", "--priority", "P0"],
  ]) check(`3 seed ${a[2]}`, run(a, c3).status === 0);
  run(["set", "n4", "--status", "done", "--evidence", "seed"], c3);
  const n1 = run(["next"], c3);
  check("3 next → n1", n1.status === 0 && idOf(n1.stdout) === "n1", n1.stdout.trim());
  check("3 claim n1 by other", run(["claim", "n1", "--agent", "other"], c3).status === 0);
  const n2 = run(["next"], c3);
  check("3 live claim + pending dep → n3", idOf(n2.stdout) === "n3", n2.stdout.trim());
  const db = openDb(db3);
  db.exec("UPDATE claims SET lease_until = datetime('now', '-1 hour') WHERE task_id = 'n1'");
  db.close();
  const n3 = run(["next"], c3);
  check("3 expired lease → n1 again", idOf(n3.stdout) === "n1", n3.stdout.trim());
  run(["set", "n1", "--status", "done", "--evidence", "e"], c3);
  const n4 = run(["next"], c3);
  check("3 dep satisfied → n2", idOf(n4.stdout) === "n2", n4.stdout.trim());
  run(["set", "n2", "--status", "done", "--evidence", "e"], c3);
  run(["set", "n3", "--status", "done", "--evidence", "e"], c3);
  const n5 = run(["next"], c3);
  check("3 nothing eligible → exit 1 + stderr", n5.status === 1 && n5.stderr.trim().length > 0 && n5.stdout.trim() === "", `exit ${n5.status} stdout=${JSON.stringify(n5.stdout)} stderr=${JSON.stringify(n5.stderr)}`);
} catch (e) { check("3 case threw", false, String(e?.stack ?? e)); }

// --- 4. claim semantics ------------------------------------------------------
const db4 = dbFor("case4");
try {
  const c4 = { TASKS_DB: db4 };
  run(["add", "--id", "n3", "--title", "N three", "--priority", "P1"], c4);
  const k1 = run(["claim", "n3", "--agent", "A", "--ttl", "60"], c4);
  check("4 claim exits 0", k1.status === 0, k1.stderr.trim());
  const lease1 = (jparse(run(["query", "SELECT agent, lease_until FROM claims WHERE task_id='n3'"], c4).stdout) ?? [])[0];
  const k2 = run(["claim", "n3", "--agent", "A", "--ttl", "60"], c4);
  const claims = jparse(run(["query", "SELECT agent, lease_until FROM claims WHERE task_id='n3'"], c4).stdout) ?? [];
  check("4 same-agent refresh: 1 row, lease not decreased", k2.status === 0 && claims.length === 1 && claims[0].agent === "A" && claims[0].lease_until >= lease1.lease_until, JSON.stringify(claims));
  check("4 rival → exit 3", run(["claim", "n3", "--agent", "rival"], c4).status === 3);
  check("4 release → 0", run(["release", "n3"], c4).status === 0);
  check("4 release again → 3", run(["release", "n3"], c4).status === 3);
  check("4 claim unknown → 2", run(["claim", "ghost", "--agent", "A"], c4).status === 2);
} catch (e) { check("4 case threw", false, String(e?.stack ?? e)); }

// --- 5. CONCURRENT CLAIM (two processes) -------------------------------------
const db5 = dbFor("case5");
try {
  const c5 = { TASKS_DB: db5 };
  run(["add", "--id", "race", "--title", "Race task", "--priority", "P0"], c5);
  const agents = ["A", "B"];
  const results = await new Promise((resolvePromise) => {
    const env = { ...process.env, TASKS_DB: db5 };
    const procs = agents.map((agent) => spawn("bun", [TASKS, "claim", "race", "--agent", agent], { cwd: ROOT, env }));
    let left = procs.length;
    const res = [];
    procs.forEach((p, i) => {
      let err = "";
      p.stderr.on("data", (d) => { err += d; });
      p.on("close", (code) => {
        res[i] = { agent: agents[i], code, err };
        if (--left === 0) resolvePromise(res);
      });
    });
  });
  const codes = results.map((r) => r.code).sort();
  check("5 two-process contention → [0,3]", JSON.stringify(codes) === "[0,3]", JSON.stringify(codes));
  const winner = results.find((r) => r.code === 0) ?? {};
  const raceClaims = jparse(run(["query", "SELECT agent FROM claims WHERE task_id='race'"], c5).stdout) ?? [];
  check("5 one winner claim owned by winner", raceClaims.length === 1 && raceClaims[0].agent === winner.agent, JSON.stringify(raceClaims));
  const loser = results.find((r) => r.code === 3) ?? {};
  check("5 loser stderr non-empty", String(loser.err ?? "").trim().length > 0, JSON.stringify(String(loser.err ?? "")));
  run(["release", "race"], c5);
} catch (e) { check("5 case threw", false, String(e?.stack ?? e)); }

// --- 6. query rejects writes --------------------------------------------------
const db6 = dbFor("case6");
try {
  const c6 = { TASKS_DB: db6 };
  run(["init"], c6);
  const okQ = run(["query", "SELECT id, status FROM tasks"], c6);
  check("6 SELECT ok", okQ.status === 0 && Array.isArray(jparse(okQ.stdout)), `exit ${okQ.status} ${okQ.stderr}`);
  for (const bad of ["UPDATE tasks SET status='done'", "DELETE FROM tasks", "SELECT 1; DROP TABLE tasks", "PRAGMA journal_mode=DELETE"]) {
    const r = run(["query", bad], c6);
    check(`6 rejects ${JSON.stringify(bad)}`, r.status === 2, `exit ${r.status}`);
  }
  const pragma = run(["query", "PRAGMA table_info(tasks)"], c6);
  check("6 PRAGMA table_info ok", pragma.status === 0 && Array.isArray(jparse(pragma.stdout)), `exit ${pragma.status} ${pragma.stderr}`);
} catch (e) { check("6 case threw", false, String(e?.stack ?? e)); }

// --- 7. view round-trip + determinism ----------------------------------------
const db7a = dbFor("case7a"), db7b = dbFor("case7b");
try {
  const c7a = { TASKS_DB: db7a }, c7b = { TASKS_DB: db7b };
  const real = join(ROOT, "docs/NEXT-ACTIONS.md");
  const original = readFileSync(real, "utf8");
  const originalRows = [];
  for (const line of original.split("\n")) {
    const m = line.match(/^- \[(pending|done|blocked|remediated|partial)\]\s+(?:(P[0-3])\s+—\s+)?(.+)$/);
    if (!m) continue;
    const rest = m[3];
    const cut = rest.indexOf(" — ");
    originalRows.push({ status: m[1], priority: m[2] ?? null, title: (cut === -1 ? rest : rest.slice(0, cut)).trim(), scope: cut === -1 ? null : rest.slice(cut + 3).trim() });
  }
  check("7 init + import real queue", run(["init"], c7a).status === 0 && run(["import", real], c7a).status === 0);
  const v1 = join(tmp, "view1.md"), v2 = join(tmp, "view2.md");
  run(["view", "--out", v1], c7a);
  run(["view", "--out", v2], c7a);
  check("7 view byte-identical across runs", readFileSync(v1, "utf8") === readFileSync(v2, "utf8"));
  const rows = jparse(run(["list", "--json"], c7a).stdout) ?? [];
  check("7 row count == original row count", rows.length === originalRows.length && originalRows.length > 0, `${rows.length} vs ${originalRows.length}`);
  const keyOf = (r) => JSON.stringify([r.status, r.priority ?? null, r.title, r.scope ?? null]);
  const have = new Set(rows.map(keyOf));
  const missing = originalRows.filter((r) => !have.has(keyOf(r)));
  check("7 every original row present", missing.length === 0, JSON.stringify(missing.slice(0, 2)));
  check("7 init + import view output", run(["init"], c7b).status === 0 && run(["import", v1], c7b).status === 0);
  const q = "SELECT status, priority, title, scope FROM tasks ORDER BY title, scope";
  const qa = run(["query", q], c7a).stdout, qb = run(["query", q], c7b).stdout;
  check("7 round-trip semantic equality", qa === qb && qa.trim().length > 0, "query outputs differ");
} catch (e) { check("7 case threw", false, String(e?.stack ?? e)); }

// --- 8. wf-batch queue reads (DB preferred, md fallback) ----------------------
try {
  const { readQueueRows } = await import(new URL("../wf-batch.ddw.js", import.meta.url).href);
  const fbRoot = join(tmp, "fb-root");
  mkdirSync(join(fbRoot, "docs"), { recursive: true });
  writeFileSync(join(fbRoot, "docs/NEXT-ACTIONS.md"), "# f\n\n- [pending] P0 — Fallback row — scope here\n");
  const fb = readQueueRows(fbRoot);
  check("8 md fallback (no db)", fb.source === "md" && fb.rows.length === 1 && fb.rows[0].title === "Fallback row", JSON.stringify(fb));
  const prefRoot = join(tmp, "pref-root");
  mkdirSync(join(prefRoot, "porting"), { recursive: true });
  mkdirSync(join(prefRoot, "docs"), { recursive: true });
  copyFileSync(TASKS, join(prefRoot, "porting/tasks.mjs"));
  writeFileSync(join(prefRoot, "docs/NEXT-ACTIONS.md"), "# f\n\n- [pending] P0 — Md row — should lose\n");
  const prefDb = join(prefRoot, "porting/tasks.db");
  const dbf = join(prefRoot, "db-fixture.md");
  writeFileSync(dbf, "- [pending] P0 — Db row — should win\n");
  const envP = { ...process.env, TASKS_DB: prefDb };
  const pi = spawnSync("bun", [join(prefRoot, "porting/tasks.mjs"), "init"], { cwd: prefRoot, env: envP, encoding: "utf8" });
  const pim = spawnSync("bun", [join(prefRoot, "porting/tasks.mjs"), "import", dbf], { cwd: prefRoot, env: envP, encoding: "utf8" });
  check("8 pref db seeded", pi.status === 0 && pim.status === 0, pi.stderr + pim.stderr);
  const pr = readQueueRows(prefRoot);
  check("8 db preferred over md", pr.source === "db" && pr.rows.length === 1 && pr.rows[0].id === "db-row" && pr.rows[0].title === "Db row", JSON.stringify(pr));
} catch (e) { check("8 case threw", false, String(e?.stack ?? e)); }

// --- 9. upsert / epic-upsert / activate (epics compiler consumer contract) ----
try {
  const db9 = dbFor("case9");
  const c9 = { TASKS_DB: db9 };
  check("9 init", run(["init"], c9).status === 0);
  const u1 = run(["upsert", "--id", "cv-1", "--title", "First", "--status", "blocked", "--priority", "P1", "--scope", "s1", "--acceptance", "a1", "--check", "true", "--epic-id", "e1", "--fr-refs", "FR-1,FR-2", "--source", "compile:test"], c9);
  check("9 upsert inserts", u1.status === 0 && u1.stdout.trim() === "cv-1", u1.stderr || u1.stdout);
  const u2 = run(["upsert", "--id", "cv-1", "--title", "First renamed", "--priority", "P2", "--scope", "s1b", "--acceptance", "a1b", "--check", "true", "--epic-id", "e1", "--fr-refs", "FR-1", "--source", "compile:test"], c9);
  check("9 upsert idempotent", u2.status === 0);
  let rows9 = jparse(run(["list", "--json"], c9).stdout) ?? [];
  let row9 = rows9.find((r) => r.id === "cv-1");
  check("9 upsert updates content, preserves status", row9 && row9.title === "First renamed" && row9.priority === "P2" && row9.scope === "s1b" && row9.status === "blocked" && row9.epic_id === "e1", JSON.stringify(row9));
  check("9 fr_refs stored", row9 && row9.fr_refs === "FR-1", JSON.stringify(row9?.fr_refs));
  check("9 set done", run(["set", "cv-1", "--status", "done", "--evidence", "proof"], c9).status === 0);
  run(["upsert", "--id", "cv-1", "--title", "First renamed again", "--scope", "s1c", "--source", "compile:test"], c9);
  row9 = (jparse(run(["list", "--json"], c9).stdout) ?? []).find((r) => r.id === "cv-1");
  check("9 upsert preserves done + evidence", row9 && row9.status === "done" && row9.evidence === "proof" && row9.title === "First renamed again", JSON.stringify(row9));
  check("9 upsert requires id+title", run(["upsert", "--id", "x"], c9).status === 2);
  const e1 = run(["epic-upsert", "--id", "e1", "--title", "Epic one", "--goal", "g1", "--milestone", "M1", "--source", "compile:test"], c9);
  const e2 = run(["epic-upsert", "--id", "e1", "--title", "Epic one", "--goal", "g1b", "--milestone", "M1"], c9);
  check("9 epic-upsert x2 exits 0", e1.status === 0 && e2.status === 0, e1.stderr + e2.stderr);
  const epics = jparse(run(["epic-list", "--json"], c9).stdout) ?? [];
  check("9 epic idempotent + goal updated", epics.length === 1 && epics[0].id === "e1" && epics[0].goal === "g1b" && epics[0].milestone === "M1", JSON.stringify(epics));
  run(["upsert", "--id", "cv-2", "--title", "Second", "--status", "blocked", "--source", "compile:test"], c9);
  run(["upsert", "--id", "cv-3", "--title", "Third", "--status", "blocked", "--source", "other"], c9);
  const act = run(["activate", "compile:test"], c9);
  check("9 activate count (only matching blocked)", act.status === 0 && act.stdout.trim() === "activated 1", act.stderr || act.stdout);
  rows9 = jparse(run(["list", "--json"], c9).stdout) ?? [];
  const st = Object.fromEntries(rows9.map((r) => [r.id, r.status]));
  check("9 activate flips only prefix (done stays done)", st["cv-2"] === "pending" && st["cv-3"] === "blocked" && st["cv-1"] === "done", JSON.stringify(st));
} catch (e) { check("9 case threw", false, String(e?.stack ?? e)); }

// --- 10. cleanup + summary ----------------------------------------------------
rmSync(tmp, { recursive: true, force: true });
check("10 all temp state cleaned", !existsSync(tmp));
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);


