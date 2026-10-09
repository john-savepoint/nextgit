#!/usr/bin/env bun
// Regression suite for the bd-backed task adapter (porting/tasks.mjs → beads/Dolt).
// Run: bun porting/tests/tasks.test.mjs   (exit 0 = pass)
//
// Each case copies a once-initialized bd template into a temp BEADS_DIR, so the real
// repo .beads is never written. Every assertion goes through the adapter CLI surface —
// the same surface the runners and commands use. NOTE: bd is a real Dolt process per
// call (~1-3s); the suite trades runtime for fidelity.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TASKS = join(ROOT, "porting/tasks.mjs");
const LIVE_BEADS = join(ROOT, ".beads");
const ID_PREFIX = "selftest-";
const CID = (slug) => `nextgit-${slug}`;
const BD_BIN = process.env.BD_BIN || (existsSync(`${process.env.HOME ?? ""}/.local/bin/bd`) ? `${process.env.HOME}/.local/bin/bd` : "bd");

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const idOf = (out) => (out.match(/^id: (.+)$/m) ?? [])[1];

const tmps = [];
// Suites must never inherit the caller's store configuration: a leaked BEADS_DIR makes
// `bd init` target the LIVE store instead of the temp template (observed 2026-10-10 —
// integrate-harness battery exports BEADS_DIR and these fixtures crashed on init).
const cleanEnv = () => { const e = { ...process.env }; delete e.BEADS_DIR; delete e.TASKS_DB; return e; };
const TEMPLATE = mkdtempSync(join(tmpdir(), "tasks-bd-template-"));
tmps.push(TEMPLATE);
execFileSync(BD_BIN, ["init", "--non-interactive", "--prefix", "nextgit"], { cwd: TEMPLATE, env: cleanEnv(), encoding: "utf8", timeout: 60000 });

// per-case fixture: throwaway BEADS_DIR + a run() bound to it
function fixture(name) {
  const dir = mkdtempSync(join(tmpdir(), `tasks-bd-${name}-`));
  tmps.push(dir);
  const beadsDir = join(dir, ".beads");
  execFileSync("cp", ["-r", join(TEMPLATE, ".beads"), beadsDir], { encoding: "utf8", timeout: 30000 });
  const env = { ...process.env, BEADS_DIR: beadsDir };
  const run = (args) => spawnSync("bun", [TASKS, ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 120000 });
  const list = () => jparse(run(["list", "--json"]).stdout) ?? [];
  return { dir, beadsDir, env, run, list, rowOf: (id) => list().find((r) => r.id === id) };
}

// --- 1. add / list round-trip + canonical ids --------------------------------
try {
  const fx = fixture("case1");
  check("1 add t-a", fx.run(["add", "--id", `${ID_PREFIX}t-a`, "--title", "Alpha", "--priority", "P1", "--scope", "s", "--deps", `${ID_PREFIX}t-b`]).status === 0);
  check("1 add t-b", fx.run(["add", "--id", `${ID_PREFIX}t-b`, "--title", "Beta"]).status === 0);
  const all = fx.list();
  const tA = fx.rowOf(CID(`${ID_PREFIX}t-a`));
  check("1 list contains both (canonical ids)", !!tA && !!fx.rowOf(CID(`${ID_PREFIX}t-b`)), JSON.stringify(all.map((r) => r.id)));
  check("1 deps stored canonical", tA?.deps === CID(`${ID_PREFIX}t-b`), tA?.deps);
  const filtered = jparse(fx.run(["list", "--status", "pending", "--priority", "P1", "--json"]).stdout) ?? [];
  check("1 status+priority filter", filtered.length === 1 && filtered[0].id === CID(`${ID_PREFIX}t-a`), JSON.stringify(filtered.map((r) => r.id)));
  check("1 duplicate id exits 2", fx.run(["add", "--id", `${ID_PREFIX}t-a`, "--title", "Dup"]).status === 2);
  check("1 bare id accepted (canonicalized on write)", fx.rowOf(CID(`${ID_PREFIX}t-b`))?.status === "pending");
} catch (e) { check("1 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 2. set semantics ---------------------------------------------------------
try {
  const fx = fixture("case2");
  fx.run(["add", "--id", `${ID_PREFIX}s-a`, "--title", "S alpha", "--priority", "P1"]);
  const s1 = fx.run(["set", `${ID_PREFIX}s-a`, "--status", "done", "--evidence", "ran x"]);
  let t = fx.rowOf(CID(`${ID_PREFIX}s-a`));
  check("2 set done + evidence (COMPLETED note)", s1.status === 0 && t?.status === "done" && /COMPLETED: ran x/.test(t?.evidence ?? ""), `${s1.status} ${s1.stderr}`);
  fx.run(["set", `${ID_PREFIX}s-a`, "--status", "partial", "--owner", "alice"]);
  t = fx.rowOf(CID(`${ID_PREFIX}s-a`));
  check("2 evidence preserved + owner set on partial", t?.status === "partial" && /ran x/.test(t?.evidence ?? "") && t?.owner === "alice", JSON.stringify([t?.status, t?.evidence, t?.owner]));
  check("2 set unknown id exits 2", fx.run(["set", "nope", "--status", "done"]).status === 2);
  fx.run(["add", "--id", `${ID_PREFIX}s-b`, "--title", "S beta"]);
  const s4 = fx.run(["set", `${ID_PREFIX}s-b`, "--status", "done"]);
  check("2 done without evidence: exit 0 + WARN", s4.status === 0 && /WARN.*evidence/.test(s4.stderr), `exit ${s4.status} stderr=${JSON.stringify(s4.stderr)}`);
  const s5 = fx.run(["set", `${ID_PREFIX}s-b`, "--status", "done", "--evidence", "e"]);
  check("2 done with evidence: no WARN", s5.status === 0 && !/WARN/.test(s5.stderr), s5.stderr);
} catch (e) { check("2 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 3. next: deps + live claims ----------------------------------------------
try {
  const fx = fixture("case3");
  for (const a of [
    ["add", "--id", `${ID_PREFIX}n1`, "--title", "N one", "--priority", "P0"],
    ["add", "--id", `${ID_PREFIX}n2`, "--title", "N two", "--priority", "P0", "--deps", `${ID_PREFIX}n1`],
    ["add", "--id", `${ID_PREFIX}n3`, "--title", "N three", "--priority", "P1"],
    ["add", "--id", `${ID_PREFIX}n4`, "--title", "N four", "--priority", "P0"],
  ]) check(`3 seed ${a[2]}`, fx.run(a).status === 0);
  fx.run(["set", `${ID_PREFIX}n4`, "--status", "done", "--evidence", "seed"]);
  const n1 = fx.run(["next"]);
  check("3 next → n1", n1.status === 0 && idOf(n1.stdout) === CID(`${ID_PREFIX}n1`), n1.stdout.trim());
  check("3 claim n1 by other", fx.run(["claim", `${ID_PREFIX}n1`, "--agent", "other"]).status === 0);
  const n2 = fx.run(["next"]);
  check("3 live claim + pending dep → n3", idOf(n2.stdout) === CID(`${ID_PREFIX}n3`), n2.stdout.trim());
  fx.run(["set", `${ID_PREFIX}n1`, "--status", "done", "--evidence", "e"]);
  const n3 = fx.run(["next"]);
  check("3 dep satisfied → n2", idOf(n3.stdout) === CID(`${ID_PREFIX}n2`), n3.stdout.trim());
  fx.run(["set", `${ID_PREFIX}n2`, "--status", "done", "--evidence", "e"]);
  fx.run(["set", `${ID_PREFIX}n3`, "--status", "done", "--evidence", "e"]);
  const n5 = fx.run(["next"]);
  check("3 nothing eligible → exit 1 + stderr", n5.status === 1 && n5.stderr.trim().length > 0 && n5.stdout.trim() === "", `exit ${n5.status} stdout=${JSON.stringify(n5.stdout)}`);
} catch (e) { check("3 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 4. claim semantics -------------------------------------------------------
try {
  const fx = fixture("case4");
  fx.run(["add", "--id", `${ID_PREFIX}c-a`, "--title", "C alpha", "--priority", "P1"]);
  const k1 = fx.run(["claim", `${ID_PREFIX}c-a`, "--agent", "A"]);
  check("4 claim exits 0 (lease noted)", k1.status === 0 && /claimed by A/.test(k1.stdout), k1.stderr.trim());
  const k2 = fx.run(["claim", `${ID_PREFIX}c-a`, "--agent", "A"]);
  check("4 same-agent refresh exits 0", k2.status === 0, k2.stderr.trim());
  check("4 rival → exit 3", fx.run(["claim", `${ID_PREFIX}c-a`, "--agent", "rival"]).status === 3);
  check("4 heartbeat owner → 0", fx.run(["heartbeat", `${ID_PREFIX}c-a`, "--agent", "A"]).status === 0);
  check("4 heartbeat non-owner → 3", fx.run(["heartbeat", `${ID_PREFIX}c-a`, "--agent", "rival"]).status === 3);
  check("4 release → 0", fx.run(["release", `${ID_PREFIX}c-a`]).status === 0);
  check("4 release again → 3", fx.run(["release", `${ID_PREFIX}c-a`]).status === 3);
  check("4 claim unknown → 2", fx.run(["claim", "ghost", "--agent", "A"]).status === 2);
  const cRow = fx.rowOf(CID(`${ID_PREFIX}c-a`));
  check("4 row back to pending, unclaimed", cRow?.status === "pending" && cRow?.claimed_by == null, JSON.stringify([cRow?.status, cRow?.claimed_by]));
} catch (e) { check("4 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 5. upsert: create + content-update preserves status/claim ----------------
try {
  const fx = fixture("case5");
  check("5 upsert creates", fx.run(["upsert", "--id", `${ID_PREFIX}u-a`, "--title", "U alpha", "--priority", "P1", "--scope", "s1", "--check", "true", "--source", "compile:selftest"]).status === 0);
  fx.run(["claim", `${ID_PREFIX}u-a`, "--agent", "U1"]);
  fx.run(["upsert", "--id", `${ID_PREFIX}u-a`, "--title", "U alpha v2", "--scope", "s2"]);
  let row = fx.rowOf(CID(`${ID_PREFIX}u-a`));
  check("5 content update preserves claim + status", row?.title === "U alpha v2" && row?.scope === "s2" && row?.claimed_by === "U1" && row?.status === "pending", JSON.stringify([row?.title, row?.scope, row?.claimed_by, row?.status]));
  fx.run(["set", `${ID_PREFIX}u-a`, "--status", "done", "--evidence", "u proof"]);
  fx.run(["upsert", "--id", `${ID_PREFIX}u-a`, "--title", "U alpha v3"]);
  row = fx.rowOf(CID(`${ID_PREFIX}u-a`));
  check("5 update preserves done + evidence", row?.status === "done" && /u proof/.test(row?.evidence ?? "") && row?.title === "U alpha v3", JSON.stringify([row?.status, row?.title]));
  fx.run(["add", "--id", `${ID_PREFIX}u-b`, "--title", "U beta"]);
  fx.run(["upsert", "--id", `${ID_PREFIX}u-a`, "--title", "U alpha v4", "--deps", `${ID_PREFIX}u-b`]);
  row = fx.rowOf(CID(`${ID_PREFIX}u-a`));
  check("5 deps add via upsert (canonical)", row?.deps === CID(`${ID_PREFIX}u-b`), row?.deps);
  fx.run(["upsert", "--id", `${ID_PREFIX}u-a`, "--title", "U alpha v5", "--deps", ""]);
  row = fx.rowOf(CID(`${ID_PREFIX}u-a`));
  check("5 deps clear via upsert", !row?.deps || row?.deps === "", JSON.stringify(row?.deps));
} catch (e) { check("5 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 6. activate (staged → runnable) ------------------------------------------
try {
  const fx = fixture("case6");
  fx.run(["add", "--id", `${ID_PREFIX}a-a`, "--title", "Act one", "--source", "blocker:x"]);
  fx.run(["add", "--id", `${ID_PREFIX}a-b`, "--title", "Act two", "--source", "other:y"]);
  fx.run(["set", `${ID_PREFIX}a-a`, "--status", "blocked"]);
  fx.run(["set", `${ID_PREFIX}a-b`, "--status", "blocked"]);
  const act = fx.run(["activate", "blocker:"]);
  check("6 activate flips only the source prefix", act.status === 0 && /activated 1/.test(act.stdout), act.stdout + act.stderr);
  check("6 flipped row pending; other stays blocked", fx.rowOf(CID(`${ID_PREFIX}a-a`))?.status === "pending" && fx.rowOf(CID(`${ID_PREFIX}a-b`))?.status === "blocked", JSON.stringify([fx.rowOf(CID(`${ID_PREFIX}a-a`))?.status, fx.rowOf(CID(`${ID_PREFIX}a-b`))?.status]));
} catch (e) { check("6 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 7. epics ----------------------------------------------------------------
try {
  const fx = fixture("case7");
  check("7 epic-upsert creates", fx.run(["epic-upsert", "--id", "E9", "--title", "Epic nine", "--goal", "g", "--milestone", "M1"]).status === 0);
  fx.run(["epic-upsert", "--id", "E9", "--title", "Epic nine", "--goal", "g2", "--milestone", "M1"]);
  const epics = jparse(fx.run(["epic-list", "--json"]).stdout) ?? [];
  check("7 epic idempotent + goal updated (canonical id)", epics.length === 1 && epics[0].id === CID("E9") && epics[0].goal === "g2" && epics[0].milestone === "M1", JSON.stringify(epics));
  const taskRows = fx.list();
  check("7 task list excludes epics", taskRows.length === 0, JSON.stringify(taskRows.map((r) => r.id)));
} catch (e) { check("7 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 8. view (derived) + import (md grammar) ----------------------------------
try {
  const fx = fixture("case8");
  const fix = join(fx.dir, "fix.md");
  writeFileSync(fix, [
    "# fixture",
    "",
    "- [pending] P0 — Dup title — scope one; check: bun porting/tests/tasks.test.mjs",
    "- [pending] P1 — Dup title — scope two",
    "- [done] P2 — Other row — scope three",
    "",
  ].join("\n"));
  const p1 = fx.run(["import", fix]), p2 = fx.run(["import", fix]);
  check("8 import twice exits 0", p1.status === 0 && p2.status === 0, p1.stderr || p2.stderr);
  const rows = fx.list();
  check("8 import row count stable at 3 (stable slugs)", rows.length === 3, JSON.stringify(rows.map((r) => r.id)));
  check("8 ids stable (dup suffix) + canonical", JSON.stringify(rows.map((r) => r.id).sort()) === JSON.stringify([CID("dup-title"), CID("dup-title-2"), CID("other-row")]), JSON.stringify(rows.map((r) => r.id)));
  const out = join(fx.dir, "NEXT-ACTIONS.md");
  const v = fx.run(["view", "--out", out]);
  const text = existsSync(out) ? readFileSync(out, "utf8") : "";
  check("8 view writes derived md with legacy grammar", v.status === 0 && /- \[pending\] P0 — Dup title/.test(text) && /Grammar:/.test(text), text.slice(0, 120));
} catch (e) { check("8 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 9. reclaim no-op safety --------------------------------------------------
try {
  const fx = fixture("case9");
  fx.run(["add", "--id", `${ID_PREFIX}r-a`, "--title", "R alpha"]);
  fx.run(["claim", `${ID_PREFIX}r-a`, "--agent", "R1"]);
  const rc = fx.run(["reclaim", "--older-than", "0m"]);
  check("9 reclaim exits 0 (live lease untouched)", rc.status === 0 && fx.rowOf(CID(`${ID_PREFIX}r-a`))?.claimed_by === "R1", rc.stdout + rc.stderr);
} catch (e) { check("9 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 10. live-store isolation + cleanup ---------------------------------------
try {
  if (existsSync(LIVE_BEADS)) {
    // cleanEnv() strips BEADS_DIR → bd resolves the repo's OWN store from cwd=ROOT.
    const live = JSON.parse(execFileSync(BD_BIN, ["list", "--json", "--all", "--limit", "3000"], { cwd: ROOT, env: cleanEnv(), encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }));
    const leaked = live.filter((r) => String(r.id).includes(ID_PREFIX));
    check("10 live store untouched (no selftest rows)", leaked.length === 0, JSON.stringify(leaked.map((r) => r.id).slice(0, 4)));
  } else {
    check("10 live-store isolation (no live store present — check skipped)", true);
  }
} catch (e) { check("10 live-store check threw", false, String(e?.message ?? e)); }

for (const t of tmps) rmSync(t, { recursive: true, force: true });
check(`10+ all temp state cleaned (${tmps.length} dirs)`, tmps.every((t) => !existsSync(t)));

console.log(fails === 0 ? `ALL PASS (checks=${checks})` : `${fails} FAILURES (checks=${checks})`);
process.exit(fails === 0 ? 0 : 1);
