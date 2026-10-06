#!/usr/bin/env bun
// Machinery self-test for the batch composition path (porting/wf-batch.ddw.js):
//   claim → order → almost-last parity gate → merged gate — run against a temp store.
// Run: bun porting/tests/batch.test.mjs   (exit 0 = pass)
//
// Isolation: every scenario builds its own throwaway fixture root (a /tmp dir with
// symlinks to the machinery + a scratch git repo holding one commit) and points
// TASKS_DB at a temp store, so the real porting/tasks.db queue is never opened and
// no artifact lands in the repo. The DDW agent runtime (globals agent/wait/phase/log)
// is stubbed — agent returns are the composition's inputs. Everything else — runBatch,
// runWorkOrder, normalizeVerdict, the tasks.mjs CLI, SQLite, the artifact writes — is
// the real machinery.

import { mkdtempSync, mkdirSync, symlinkSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TASKS = join(ROOT, "porting/tasks.mjs");
const LIVE_DB = join(ROOT, "porting/tasks.db");
const ID_PREFIX = "selftest-batch-";

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

// --- DDW runtime stubs: the composition's inbound boundary --------------------
let calls = [];
let reply = () => "ok";
const defaultReply = (label) => {
  if (label.startsWith("plan:")) return { plan: "# plan (stub)", summary: "stub plan" };
  if (label.startsWith("impl:")) return "stub implement";
  if (label.startsWith("verify:")) return { verdict: "PASS", evidence: "stub verify PASS" };
  if (label.startsWith("heal-research:")) return { proposals: "(none)" };
  if (label.startsWith("heal:")) return "stub heal";
  if (label.startsWith("gate:parity:")) return { verdict: "SHIP", shipBlockers: [], highs: [], notes: [] };
  if (label.startsWith("gate:merged:")) return { verdict: "SHIP", shipBlockers: [], notes: [] };
  if (label.startsWith("gate:")) return { lens: label.split(":")[1], verdict: "SHIP", shipBlockers: [], highs: [], mediums: [], notes: [] };
  return "ok";
};
globalThis.phase = () => { };
globalThis.log = () => { };
globalThis.agent = (_prompt, opts = {}) => {
  calls.push({ label: opts.label ?? "?", spawn: opts.agent });
  return { wait: async () => reply(opts.label ?? "") };
};
globalThis.wait = async (handles) => Promise.all(handles.map((h) => Promise.resolve(h.wait()).catch((e) => e)));

// --- fixture: throwaway root that mirrors what runBatch needs -----------------
// runBatch(root) touches root only: porting/wf-template.ddw.js (import), porting/tasks.mjs
// (spawn), docs/STATE.md (base-red capture), porting/runs/ (outputs), and `git rev-parse
// HEAD` — the scratch repo guarantees a pre-batch commit so the parity gate is eligible.
const tmps = [];
function fixture(rows = [], preclaimed = []) {
  const tmp = mkdtempSync(join(tmpdir(), "batch-selftest-"));
  tmps.push(tmp);
  const root = join(tmp, "fixture");
  mkdirSync(join(root, "porting/runs"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const f of ["porting/wf-template.ddw.js", "porting/tasks.mjs", "docs/STATE.md", "docs/NEXT-ACTIONS.md"])
    symlinkSync(join(ROOT, f), join(root, f));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
  git(["init", "-q"]);
  git(["-c", "user.email=selftest@local", "-c", "user.name=selftest", "commit", "-q", "--allow-empty", "--no-verify", "-m", "base"]);
  const store = join(tmp, "store.db");
  const env = { ...process.env, TASKS_DB: store };
  const cli = (args) => spawnSync("bun", [TASKS, ...args], { cwd: ROOT, env, encoding: "utf8" });
  cli(["init"]);
  for (const id of rows) cli(["add", "--id", id, "--title", `row ${id}`, "--priority", "P1", "--scope", `do ${id}`, "--check", "true"]);
  for (const id of preclaimed) cli(["claim", id, "--agent", "other-session", "--ttl", "600"]);
  const q = (sql) => JSON.parse(cli(["query", sql]).stdout);
  return { tmp, root, store, cli, q };
}

const { runBatch } = await import(new URL("../wf-batch.ddw.js", import.meta.url).href);
const gateFile = (o, name) => JSON.parse(readFileSync(join(o.batchDir, name), "utf8"));

async function scenario(rows, { preclaimed = [], limit = 2, mode } = {}) {
  const fx = fixture(rows, preclaimed);
  calls = [];
  reply = (label) => (mode ? mode(label, defaultReply) : defaultReply(label));
  const prevDB = process.env.TASKS_DB;
  process.env.TASKS_DB = fx.store;
  const out = { fx };
  try { out.report = await runBatch({ limit, root: fx.root }); } catch (e) { out.error = e; }
  finally { if (prevDB === undefined) delete process.env.TASKS_DB; else process.env.TASKS_DB = prevDB; }
  out.calls = calls;
  const bDirName = readdirSync(join(fx.root, "porting/runs")).find((f) => f.startsWith("batch-"));
  out.batchDir = bDirName ? join(fx.root, "porting/runs", bDirName) : null;
  return out;
}

// --- 1. green path: claim → orders → parity (SHIP) → merged (SHIP) ------------
try {
  const a = `${ID_PREFIX}s1-a`, b = `${ID_PREFIX}s1-b`;
  const o = await scenario([a, b], { limit: 2 });
  if (o.error) { check("1 batch composition completes (batch gates reach the DDW agent runtime)", false, String(o.error.message).slice(0, 200)); }
  else {
    const r = o.report;
    check("1 next ALL GREEN", r.next.startsWith("ALL GREEN"), r.next.slice(0, 80));
    check("1 both orders GREEN in pick order", r.orders.length === 2 && r.orders.every((x) => x.verdict === "GREEN") && r.orders.map((x) => x.order).join(",") === `${a},${b}`, JSON.stringify(r.orders.map((x) => [x.order, x.verdict])));
    check("1 parity gate SHIPs and persists gate-parity.md", r.parity?.verdict === "SHIP" && gateFile(o, "gate-parity.md").verdict === "SHIP");
    check("1 merged gate SHIPs and report.json is written", r.gate.verdict === "SHIP" && existsSync(join(o.batchDir, "report.json")));
    const pIdx = o.calls.findIndex((c) => c.label.startsWith("gate:parity:"));
    const mIdx = o.calls.findIndex((c) => c.label.startsWith("gate:merged:"));
    const lastOrder = Math.max(...o.calls.map((c, i) => (c.label.startsWith("gate:parity:") || c.label.startsWith("gate:merged:") ? -1 : i)));
    check("1 ordering: every order call < parity < merged", pIdx > lastOrder && mIdx > pIdx && lastOrder >= 0, `lastOrder=${lastOrder} parity=${pIdx} merged=${mIdx}`);
    check("1 batch gates spawn their specialists", o.calls[pIdx]?.spawn === "parity-auditor" && o.calls[mIdx]?.spawn === "senior-reviewer", JSON.stringify([o.calls[pIdx]?.spawn, o.calls[mIdx]?.spawn]));
    check("1 order artifacts persisted by the runner", [a, b].every((id) => ["plan.md", "verify.md", "result.json", "run-state.json"].every((f) => existsSync(join(o.fx.root, "porting/runs", id, f)))));
    const claims = o.fx.q("SELECT task_id FROM claims");
    check("1 claims released when the batch completes", claims.length === 0, JSON.stringify(claims));
    const ev = o.fx.q("SELECT kind FROM events WHERE kind IN ('claim','release')");
    check("1 claim→release cycle recorded per pick", ev.filter((e) => e.kind === "claim").length === 2 && ev.filter((e) => e.kind === "release").length === 2, JSON.stringify(ev));
    const pend = o.fx.q("SELECT id FROM tasks WHERE status='pending'");
    check("1 rows stay pending (only the caller ticks)", pend.length === 2, JSON.stringify(pend));
    check("1 queue + claims resolved through TASKS_DB (no fixture-default store created)", !existsSync(join(o.fx.root, "porting/tasks.db")));
  }
} catch (e) { check("1 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 2. parity BLOCK blocks the batch ----------------------------------------
try {
  const c = `${ID_PREFIX}s2-a`;
  const o = await scenario([c], { limit: 1, mode: (label, dflt) => (label.startsWith("gate:parity:") ? { verdict: "BLOCK", shipBlockers: ["stub: capability removed"], highs: [], notes: [] } : dflt(label)) });
  if (o.error) check("2 parity-block scenario completes", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    check("2 parity BLOCK blocks the whole batch", r.parity?.verdict === "BLOCK" && r.next.startsWith("BLOCKED"), `${r.parity?.verdict} / ${r.next.slice(0, 40)}`);
    check("2 gate-parity.md persisted with the block verdict", gateFile(o, "gate-parity.md").verdict === "BLOCK");
    const pIdx = o.calls.findIndex((x) => x.label.startsWith("gate:parity:"));
    const mIdx = o.calls.findIndex((x) => x.label.startsWith("gate:merged:"));
    check("2 merged gate still runs after a parity block", mIdx > pIdx && r.gate.verdict === "SHIP");
    check("2 claims released on a blocked batch", o.fx.q("SELECT task_id FROM claims").length === 0);
  }
} catch (e) { check("2 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 3. merged gate fails closed on an incoherent return ---------------------
try {
  const d = `${ID_PREFIX}s3-a`;
  const o = await scenario([d], { limit: 1, mode: (label, dflt) => (label.startsWith("gate:merged:") ? { verdict: "SHIP", shipBlockers: ["stub: incoherent merged return"], highs: [], notes: [] } : dflt(label)) });
  if (o.error) check("3 merged fail-closed scenario completes", false, String(o.error.message).slice(0, 200));
  else check("3 incoherent merged return (SHIP + blockers) fails closed to BLOCK", o.report.gate.verdict === "BLOCK" && o.report.next.startsWith("BLOCKED"), `${o.report.gate.verdict} / ${o.report.next.slice(0, 40)}`);
} catch (e) { check("3 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 4. contention skip + stop-on-red (parity + lease invariants) ------------
try {
  const e1 = `${ID_PREFIX}s4-claimed`, e2 = `${ID_PREFIX}s4-red`, e3 = `${ID_PREFIX}s4-next`;
  const o = await scenario([e1, e2, e3], {
    preclaimed: [e1], limit: 3,
    mode: (label, dflt) => (label.startsWith("gate:") && !label.startsWith("gate:parity:") && !label.startsWith("gate:merged:")
      ? { lens: label.split(":")[1], verdict: "BLOCK", shipBlockers: ["stub: red lens"], highs: [], mediums: [], notes: [] } : dflt(label)),
  });
  if (o.error) check("4 stop-on-red scenario completes", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    check("4 pre-claimed row skipped; red order stops the batch", r.orders.length === 1 && r.orders[0].order === e2 && r.orders[0].verdict.startsWith("BLOCKED"), JSON.stringify(r.orders.map((x) => [x.order, x.verdict])));
    const claims = o.fx.q("SELECT task_id, agent FROM claims");
    check("4 pre-claimed lease untouched; other picks released", claims.length === 1 && claims[0].task_id === e1 && claims[0].agent === "other-session", JSON.stringify(claims));
    check("4 unpicked row never ran (no run dir)", !existsSync(join(o.fx.root, "porting/runs", e3)));
    check("4 parity gate skipped when no order was GREEN", r.parity === null && !o.calls.some((x) => x.label.startsWith("gate:parity:")) && !existsSync(join(o.batchDir, "gate-parity.md")));
    check("4 merged gate still runs (sees the union)", o.calls.some((x) => x.label.startsWith("gate:merged:")) && r.gate !== null);
  }
} catch (e) { check("4 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 5. empty store returns before any gate ----------------------------------
try {
  const o = await scenario([], { limit: 2 });
  if (o.error) check("5 empty-store scenario completes", false, String(o.error.message).slice(0, 200));
  else check("5 empty store → NO PENDING ROWS, no gates", o.report.orders.length === 0 && o.report.gate === null && o.report.next.startsWith("NO PENDING ROWS") && o.calls.length === 0, `${o.report.next} / calls=${o.calls.length}`);
} catch (e) { check("5 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 6. live-store isolation + cleanup ---------------------------------------
try {
  if (existsSync(LIVE_DB)) {
    const env = { ...process.env, TASKS_DB: LIVE_DB };
    const q = (sql) => JSON.parse(spawnSync("bun", [TASKS, "query", sql], { cwd: ROOT, env, encoding: "utf8" }).stdout);
    const t = q(`SELECT COUNT(*) AS n FROM tasks WHERE id LIKE '${ID_PREFIX}%'`)[0].n;
    const c = q(`SELECT COUNT(*) AS n FROM claims WHERE task_id LIKE '${ID_PREFIX}%'`)[0].n;
    check("6 live store untouched (no selftest rows/claims)", t === 0 && c === 0, JSON.stringify({ rows: t, claims: c }));
  } else {
    check("6 live-store isolation (no live store present — check skipped)", true);
  }
} catch (e) { check("6 live-store check threw", false, String(e?.message ?? e)); }
for (const t of tmps) rmSync(t, { recursive: true, force: true });
check("6 all temp state cleaned", tmps.every((t) => !existsSync(t)));

// teardown: the DDW runtime stubs are this suite's only globals — leave none behind
for (const k of ["agent", "wait", "phase", "log"]) delete globalThis[k];

console.log(fails === 0 ? `ALL PASS (checks=${checks})` : `${fails} FAILURES (checks=${checks})`);
process.exit(fails === 0 ? 0 : 1);
