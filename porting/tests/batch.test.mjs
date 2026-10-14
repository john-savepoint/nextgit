#!/usr/bin/env bun
// Machinery self-test for the batch composition path (porting/wf-batch.ddw.js):
//   claim → order → almost-last parity gate → merged gate — run against a temp store.
// Run: bun porting/tests/batch.test.mjs   (exit 0 = pass)
//
// Isolation: every scenario builds its own throwaway fixture root (a /tmp dir with
// symlinks to the machinery + a scratch git repo holding one commit) and points
// BEADS_DIR at a copied bd template, so the real repo .beads queue is never written
// and no artifact lands in the repo. The DDW agent runtime (globals agent/wait/phase/log)
// is stubbed — agent returns are the composition's inputs. Everything else — runBatch,
// runWorkOrder, normalizeVerdict, the tasks.mjs adapter, bd (beads/Dolt), the artifact
// writes — is the real machinery. NOTE: each bd CLI call costs ~1-3s (embedded Dolt
// startup); the suite trades runtime for fidelity — expect a few minutes.

import { mkdtempSync, mkdirSync, symlinkSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TASKS = join(ROOT, "porting/tasks.mjs");
const LIVE_BEADS = join(ROOT, ".beads");
const ID_PREFIX = "selftest-batch-";
// Canonical store id: every issue carries the `nextgit-` prefix; bd classifies a dep
// target whose prefix differs from the source's as EXTERNAL (never blocks).
const CID = (slug) => `nextgit-${slug}`;
const BD_BIN = process.env.BD_BIN || (existsSync(`${process.env.HOME ?? ""}/.local/bin/bd`) ? `${process.env.HOME}/.local/bin/bd` : "bd");

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
  if (label.startsWith("plan:")) return { plan: "# plan (stub)\n\n## Files\n- porting/fixture-target.md (create)\n\n## Change\nCreate the fixture target with the run id; no source files touched.\n\n## Check\nThe order's focused check command runs and exits 0 on the written fixture.\n".padEnd(320, "x"), summary: "stub plan" };
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
  calls.push({ label: opts.label ?? "?", spawn: opts.agent, prompt: String(_prompt), schema: opts.schema });
  return { wait: async () => reply(opts.label ?? "") };
};
globalThis.wait = async (handles) => Promise.all(handles.map((h) => Promise.resolve(h.wait()).catch((e) => e)));

// --- fixture: throwaway root that mirrors what runBatch needs -----------------
// runBatch(root) touches root only: porting/wf-template.ddw.js (import), porting/tasks.mjs
// (spawn), docs/STATE.md (base-red capture), porting/runs/ (outputs), and `git rev-parse
// HEAD` — the scratch repo guarantees a pre-batch commit so the parity gate is eligible.
// The bd store is a copy of a once-initialized template (bd init is ~7s; copies are ms)
// addressed via BEADS_DIR, so no fixture ever touches the live repo .beads.
const tmps = [];
// Suites must never inherit the caller's store configuration: a leaked BEADS_DIR makes
// `bd init` target the LIVE store instead of the temp template (observed 2026-10-10 —
// integrate-harness battery exports BEADS_DIR and these fixtures crashed on init).
// Strip it for every spawn that is meant to resolve its own store.
const cleanEnv = () => { const e = { ...process.env }; delete e.BEADS_DIR; delete e.TASKS_DB; return e; };
const BD_TEMPLATE = mkdtempSync(join(tmpdir(), "bd-template-"));
tmps.push(BD_TEMPLATE);
execFileSync(BD_BIN, ["init", "--non-interactive", "--prefix", "selftest"], { cwd: BD_TEMPLATE, env: cleanEnv(), encoding: "utf8", timeout: 60000 });

function fixture(rows = [], preclaimed = []) {
  const tmp = mkdtempSync(join(tmpdir(), "batch-selftest-"));
  tmps.push(tmp);
  const root = join(tmp, "fixture");
  mkdirSync(join(root, "porting/runs"), { recursive: true });
  mkdirSync(join(root, "porting/parity"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const f of ["porting/wf-template.ddw.js", "docs/STATE.md", "docs/NEXT-ACTIONS.md"])
    symlinkSync(join(ROOT, f), join(root, f));
  // tasks.mjs is a COUNTING SHIM (not a symlink): every invocation —
  // including the picker's own `claim-many` spawn — appends its argv to
  // <tmp>/tasks-calls.jsonl and then delegates to the real adapter.
  // This is the call-count capture for section 14 (the picker spawns
  // tasks.mjs directly, so a cli-spy cannot see its claim-many calls).
  const callsLog = join(tmp, "tasks-calls.jsonl");
  const shim = [
    "#!/usr/bin/env bun",
    'import { appendFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    `appendFileSync(${JSON.stringify(callsLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    `const r = spawnSync("bun", [${JSON.stringify(TASKS)}, ...process.argv.slice(2)], { stdio: "inherit" });`,
    "process.exit(r.status ?? 1);",
    "",
  ].join("\n");
  writeFileSync(join(root, "porting/tasks.mjs"), shim);
  // The parity pack (competitor mode reads the baseline as data;
  // the gate artifact hashes it at gate time).
  for (const f of ["porting/parity/baseline-github.json", "porting/parity/nextgit-capabilities.json"])
    symlinkSync(join(ROOT, f), join(root, f));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
  git(["init", "-q"]);
  git(["-c", "user.email=selftest@local", "-c", "user.name=selftest", "commit", "-q", "--allow-empty", "--no-verify", "-m", "base"]);
  const beadsDir = join(tmp, ".beads");
  execFileSync("cp", ["-r", join(BD_TEMPLATE, ".beads"), beadsDir], { encoding: "utf8", timeout: 30000 });
  const env = { ...process.env, BEADS_DIR: beadsDir };
  const cli = (args) => spawnSync("bun", [TASKS, ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 120000 });
  for (const row of rows) {
    const r = typeof row === "string" ? { id: row } : row;
    const args = ["add", "--id", r.id, "--title", `row ${r.id}`, "--priority", "P1", "--scope", `do ${r.id}`, "--check", "true"];
    if (r.acceptance) args.push("--acceptance", r.acceptance);
    if (r.deps) args.push("--deps", r.deps);
    if (r.source) args.push("--source", r.source);
    cli(args);
  }
  for (const id of preclaimed) cli(["claim", id, "--agent", "other-session"]);
  const listAll = () => JSON.parse(cli(["list", "--json"]).stdout);
  const claimManyCalls = () =>
    existsSync(callsLog)
      ? readFileSync(callsLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a[0] === "claim-many")
      : [];
  return {
    tmp, root, beadsDir, cli, listAll, claimManyCalls,
    rowOf: (id) => listAll().find((r) => r.id === id),
    claimsOf: () => listAll().filter((r) => r.claimed_by != null),
  };
}

const { runBatch } = await import(new URL("../wf-batch.ddw.js", import.meta.url).href);
const gateFile = (o, name) => JSON.parse(readFileSync(join(o.batchDir, name), "utf8"));

async function scenario(rows, { preclaimed = [], limit = 2, mode, sourceLike, before, parallel, phaseDeadlineMs, gateDeadlineMs } = {}) {
  const fx = fixture(rows, preclaimed);
  calls = [];
  reply = (label) => (mode ? mode(label, defaultReply) : defaultReply(label));
  const prevBeads = process.env.BEADS_DIR;
  process.env.BEADS_DIR = fx.beadsDir; // runBatch spawns inherit this — the store under test
  const out = { fx };
  if (before) before(fx);
  try { out.report = await runBatch({ limit, root: fx.root, sourceLike, parallel, phaseDeadlineMs, gateDeadlineMs }); } catch (e) { out.error = e; }
  finally { if (prevBeads === undefined) delete process.env.BEADS_DIR; else process.env.BEADS_DIR = prevBeads; }
  out.calls = calls;
  const bDirName = readdirSync(join(fx.root, "porting/runs")).find((f) => f.startsWith("batch-"));
  out.batchDir = bDirName ? join(fx.root, "porting/runs", bDirName) : null;
  return out;
}

// --- 1. green path: claim → orders → parity (SHIP) → merged (SHIP) ------------
try {
  const a = `${ID_PREFIX}s1-a`, b = `${ID_PREFIX}s1-b`;
  let fx1;
  const o = await scenario([a, b], {
    limit: 2,
    before: (fx) => { fx1 = fx; },
    mode: (label, dflt) => {
      // Serial path: orders run directly in the batch root; stub "real work" writes files
      // there so the sequential driver-commit can be asserted (phantom-merge guard).
      for (const id of [a, b]) if (label === `impl:${CID(id)}`) writeFileSync(join(fx1.root, `order-work-${id}.md`), `work for ${id}\n`);
      // Batch gates resolve on a REAL macrotask delay: a defaulted 0ms/undefined
      // deadline would win the race here (production's insta-BLOCK regression,
      // 2026-10-13) — microtask-fast stubs could not discriminate it.
      if (label.startsWith("gate:parity:") || label.startsWith("gate:merged:")) {
        return Bun.sleep(30).then(() => dflt(label));
      }
      return dflt(label);
    },
  });
  if (o.error) { check("1 batch composition completes (batch gates reach the DDW agent runtime)", false, String(o.error.message).slice(0, 200)); }
  else {
    const r = o.report;
    check("1 next ALL GREEN", r.next.startsWith("ALL GREEN"), r.next.slice(0, 80));
    check("1 both orders GREEN in pick order", r.orders.length === 2 && r.orders.every((x) => x.verdict === "GREEN") && r.orders.map((x) => x.order).join(",") === `${CID(a)},${CID(b)}`, JSON.stringify(r.orders.map((x) => [x.order, x.verdict])));
    check("1 parity gate SHIPs and persists gate-parity.md", r.parity?.verdict === "SHIP" && gateFile(o, "gate-parity.md").verdict === "SHIP");
    check("1 merged gate SHIPs and report.json is written", r.gate.verdict === "SHIP" && existsSync(join(o.batchDir, "report.json")));
    const pIdx = o.calls.findIndex((c) => c.label.startsWith("gate:parity:"));
    const mIdx = o.calls.findIndex((c) => c.label.startsWith("gate:merged:"));
    const lastOrder = Math.max(...o.calls.map((c, i) => (c.label.startsWith("gate:parity:") || c.label.startsWith("gate:merged:") ? -1 : i)));
    check("1 ordering: every order call < parity < merged", pIdx > lastOrder && mIdx > pIdx && lastOrder >= 0, `lastOrder=${lastOrder} parity=${pIdx} merged=${mIdx}`);
    check("1 batch gates spawn their specialists", o.calls[pIdx]?.spawn === "parity-auditor" && o.calls[mIdx]?.spawn === "senior-reviewer", JSON.stringify([o.calls[pIdx]?.spawn, o.calls[mIdx]?.spawn]));
    check("1 order artifacts persisted by the runner", [a, b].every((id) => ["plan.md", "verify.md", "result.json", "run-state.json"].every((f) => existsSync(join(o.fx.root, "porting/runs", CID(id), f)))));
    const aRow = o.fx.rowOf(CID(a)), bRow = o.fx.rowOf(CID(b));
    check("1 green rows auto-closed by the batch (CAS + batch evidence)", aRow?.status === "done" && bRow?.status === "done" && /COMPLETED: batch/.test(aRow?.evidence ?? ""), JSON.stringify([aRow?.status, bRow?.status, (aRow?.evidence ?? "").slice(0, 70)]));
    check("1 report records the closed rows", Array.isArray(r.closed) && r.closed.length === 2 && r.closed.includes(CID(a)) && r.closed.includes(CID(b)), JSON.stringify(r.closed));
    check("1 no claims left after the close (reclaim/re-run window closed)", o.fx.claimsOf().length === 0, JSON.stringify(o.fx.claimsOf().map((x) => x.id)));
    check("1 fixture store isolation via BEADS_DIR (no SQLite store created)", existsSync(join(o.fx.beadsDir, "metadata.json")) && !existsSync(join(o.fx.root, "porting/tasks.db")));
    check("1 serial orders' content present in the batch root", readFileSync(join(o.fx.root, `order-work-${a}.md`), "utf8") === `work for ${a}\n` && readFileSync(join(o.fx.root, `order-work-${b}.md`), "utf8") === `work for ${b}\n`);
    const seqLog = execFileSync("git", ["log", "--oneline"], { cwd: o.fx.root, encoding: "utf8" });
    check("1 sequential driver-commit landed the orders' work (lane integration can carry it)", seqLog.split("\n").filter(Boolean).length >= 2 && seqLog.includes("batch ") && seqLog.includes(a), seqLog.slice(0, 200));
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
    check("2 green-but-batch-blocked: claim retained, row NOT closed (caller reconciles)", o.fx.claimsOf().length === 1 && o.fx.rowOf(CID(c))?.status === "pending", JSON.stringify([o.fx.claimsOf().map((x) => x.id), o.fx.rowOf(CID(c))?.status]));
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
    check("4 pre-claimed row skipped; red order stops the batch", r.orders.length === 1 && r.orders[0].order === CID(e2) && r.orders[0].verdict.startsWith("BLOCKED"), JSON.stringify(r.orders.map((x) => [x.order, x.verdict])));
    const claims = o.fx.claimsOf();
    check("4 pre-claimed lease untouched; other picks released", claims.length === 1 && claims[0].id === CID(e1) && claims[0].claimed_by === "other-session", JSON.stringify(claims.map((x) => [x.id, x.claimed_by])));
    check("4 unpicked row never ran (no run dir)", !existsSync(join(o.fx.root, "porting/runs", CID(e3))));
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

// --- 6. consumer contract: acceptance passthrough, dep-gating, source filter ---
try {
  // 6a: dependent row gated until its dep is done; acceptance text flows into the order
  const a6 = `${ID_PREFIX}s6-a`, b6 = `${ID_PREFIX}s6-b`;
  const oA = await scenario([{ id: a6, acceptance: `ACCEPT-${a6}` }, { id: b6, deps: a6 }], { limit: 2 });
  if (oA.error) check("6a dep-gating scenario completes", false, String(oA.error.message).slice(0, 200));
  else {
    const rA = oA.report;
    check("6a dependent row gated (only the dep runs)", rA.orders.length === 1 && rA.orders[0].order === CID(a6), JSON.stringify(rA.orders.map((x) => x.order)));
    check("6a gated row reported with unmet dep", (rA.gated ?? []).length === 1 && rA.gated[0].id === CID(b6) && rA.gated[0].unmet.includes(CID(a6)), JSON.stringify(rA.gated));
    check("6a gated row never ran and stays pending", !existsSync(join(oA.fx.root, "porting/runs", CID(b6))) && oA.fx.rowOf(CID(b6))?.status === "pending");
    const planCall = oA.calls.find((c) => c.label === `plan:${CID(a6)}`);
    check("6a acceptance text passes through to the order", !!planCall && planCall.prompt.includes(`ACCEPT-${a6}`) && planCall.prompt.includes(`do ${a6}`), planCall ? "acceptance text missing from plan prompt" : "no plan call captured");
  }
  // 6b: once the dep is done, the dependent becomes runnable
  const c6 = `${ID_PREFIX}s6-c`, d6 = `${ID_PREFIX}s6-d`;
  const oB = await scenario([{ id: c6 }, { id: d6, deps: c6 }], { limit: 2, before: (fx) => fx.cli(["set", c6, "--status", "done", "--evidence", "seeded done"]) });
  if (oB.error) check("6b satisfied-dep scenario completes", false, String(oB.error.message).slice(0, 200));
  else check("6b satisfied dep runs; gating clears", oB.report.orders.length === 1 && oB.report.orders[0].order === CID(d6) && (oB.report.gated ?? []).length === 0, JSON.stringify(oB.report.orders.map((x) => x.order)));
  // 6c: sourceLike filter restricts the pick set
  const e6 = `${ID_PREFIX}s6-e`, f6 = `${ID_PREFIX}s6-f`;
  const oC = await scenario([{ id: e6, source: "compile:selftest" }, { id: f6, source: "harvest:x" }], { limit: 2, sourceLike: "compile:" });
  if (oC.error) check("6c source-filter scenario completes", false, String(oC.error.message).slice(0, 200));
  else {
    check("6c only source-matching rows picked", oC.report.orders.length === 1 && oC.report.orders[0].order === CID(e6), JSON.stringify(oC.report.orders.map((x) => x.order)));
    check("6c filtered-out row untouched (no run dir, stays pending)", !existsSync(join(oC.fx.root, "porting/runs", CID(f6))) && oC.fx.rowOf(CID(f6))?.status === "pending");
  }
} catch (e) { check("6 consumer-contract case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 8. worktree-parallel: N orders in flight, serial merge-back --------------
try {
  const a8 = `${ID_PREFIX}s8-a`, b8 = `${ID_PREFIX}s8-b`;
  let fx8;
  const o = await scenario([a8, b8], {
    limit: 2, parallel: 2,
    before: (fx) => { fx8 = fx; },
    mode: (label, dflt) => {
      // The driver-commit contract: orders change the worktree; the DRIVER commits and
      // merges. Stub "real work" by writing a file into each worktree during IMPLEMENT.
      for (const id of [a8, b8]) {
        if (label === `impl:${CID(id)}`) writeFileSync(join(fx8.root, ".worktrees", CID(id), `order-work-${id}.md`), `work for ${id}\n`);
      }
      return dflt(label);
    },
  });
  if (o.error) check("8 parallel scenario completes", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    check("8 both orders GREEN under parallel x2", r.parallel === 2 && r.orders.length === 2 && r.orders.every((x) => x.verdict === "GREEN"), JSON.stringify(r.orders.map((x) => [x.order, x.verdict])));
    check("8 both branches merged back (merge-back.json)", r.mergeBack?.mode === "parallel" && r.mergeBack.merged.length === 2 && r.mergeBack.conflicts.length === 0, JSON.stringify(r.mergeBack));
    check("8 CONTENT LANDS: order work exists in main after merge-back", readFileSync(join(o.fx.root, `order-work-${a8}.md`), "utf8") === `work for ${a8}\n` && readFileSync(join(o.fx.root, `order-work-${b8}.md`), "utf8") === `work for ${b8}\n`);
    const log8 = execFileSync("git", ["log", "--oneline"], { cwd: o.fx.root, encoding: "utf8" });
    check("8 driver committed each order's work onto its branch", log8.includes(`order ${CID(a8)}`) && log8.includes(`order ${CID(b8)}`));
    check("8 merge commits present (--no-ff)", execFileSync("git", ["log", "--merges", "--oneline"], { cwd: o.fx.root, encoding: "utf8" }).split("\n").some((l) => l.includes(`order ${CID(a8)}:`)));
    check("8 worktrees removed after merge", !existsSync(join(o.fx.root, ".worktrees", CID(a8))) && !existsSync(join(o.fx.root, ".worktrees", CID(b8))));
    check("8 order branches deleted after merge", execFileSync("git", ["branch", "--list", "order/*"], { cwd: o.fx.root, encoding: "utf8" }).trim() === "");
    check("8 evidence landed in the main tree, not the worktree", ["plan.md", "verify.md", "result.json"].every((f) => existsSync(join(o.fx.root, "porting/runs", CID(a8), f))) && ["plan.md", "result.json"].every((f) => existsSync(join(o.fx.root, "porting/runs", CID(b8), f))));
    check("8 green parallel rows auto-closed (all-green batch)", [a8, b8].every((id) => o.fx.rowOf(CID(id))?.status === "done") && o.fx.claimsOf().length === 0, JSON.stringify([o.fx.rowOf(CID(a8))?.status, o.fx.rowOf(CID(b8))?.status]));
  }
} catch (e) { check("8 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 9. parallel with one BLOCKED: merge only green, keep the red branch ------
try {
  const c9 = `${ID_PREFIX}s9-a`, d9 = `${ID_PREFIX}s9-b`;
  let fx9;
  const o = await scenario([c9, d9], {
    limit: 2, parallel: 2,
    before: (fx) => { fx9 = fx; },
    mode: (label, dflt) => {
      for (const id of [c9, d9]) {
        if (label === `impl:${CID(id)}`) writeFileSync(join(fx9.root, ".worktrees", CID(id), `order-work-${id}.md`), `work for ${id}\n`);
      }
      return label.startsWith("gate:") && !label.startsWith("gate:parity:") && !label.startsWith("gate:merged:") && label.endsWith(`:${CID(d9)}`)
        ? { lens: label.split(":")[1], verdict: "BLOCK", shipBlockers: ["stub: red lens"], highs: [], mediums: [], notes: [] }
        : dflt(label);
    },
  });
  if (o.error) check("9 parallel-blocked scenario completes", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    const byId = Object.fromEntries(r.orders.map((x) => [x.order, x.verdict]));
    check("9 one GREEN + one BLOCKED under parallel x2", byId[CID(c9)] === "GREEN" && String(byId[CID(d9)]).startsWith("BLOCKED"), JSON.stringify(byId));
    check("9 only the green branch merged", r.mergeBack?.merged.length === 1 && r.mergeBack.merged[0] === CID(c9), JSON.stringify(r.mergeBack));
    check("9 green order's work landed in main", readFileSync(join(o.fx.root, `order-work-${c9}.md`), "utf8") === `work for ${c9}\n`);
    check("9 red order's work PRESERVED on its kept branch (not in main)", execFileSync("git", ["show", `order/${CID(d9)}:order-work-${d9}.md`], { cwd: o.fx.root, encoding: "utf8" }) === `work for ${d9}\n` && !existsSync(join(o.fx.root, `order-work-${d9}.md`)));
    check("9 red branch kept for reconciliation", r.mergeBack?.kept.some((k) => k.id === CID(d9) && k.branch === `order/${CID(d9)}`), JSON.stringify(r.mergeBack?.kept));
    check("9 red worktree removed, red branch retained", !existsSync(join(o.fx.root, ".worktrees", CID(d9))) && execFileSync("git", ["branch", "--list", "order/*"], { cwd: o.fx.root, encoding: "utf8" }).includes(`order/${CID(d9)}`));
    const claims = o.fx.claimsOf();
    check("9 blocked row released; green row keeps its claim (batch not all-green)", claims.length === 1 && claims[0].id === CID(c9), JSON.stringify(claims.map((x) => x.id)));
    check("9 batch reports BLOCKED", r.next.startsWith("BLOCKED"), r.next.slice(0, 60));
  }
} catch (e) { check("9 case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 11. parity-gate competitor mode ----------------------------------
// (a) PARITY_SCHEMA carries the optional `competitor` property;
// (b) the parity prompt names the baseline file path (interpolated,
//     never the file's content);
// (c) a stub parity-auditor return carrying `competitor` round-trips
//     into report.parity.competitor AND the persisted
//     gate-parity-competitor.json artifact (with the baseline's
//     sha256 at gate time).
try {
  const a11 = `${ID_PREFIX}s11-a`;
  const o = await scenario([a11], {
    limit: 1,
    mode: (label, dflt) => {
      if (label.startsWith("gate:parity:")) {
        return {
          verdict: "SHIP", shipBlockers: [], highs: [], notes: [],
          competitor: { baseline: "porting/parity/baseline-github.json", below: ["session-steering", "issues"] },
        };
      }
      return dflt(label);
    },
  });
  if (o.error) check("11 competitor-mode scenario completes", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    check("11 competitor return passes through to report.parity.competitor",
      r.parity?.competitor?.baseline === "porting/parity/baseline-github.json" &&
      Array.isArray(r.parity.competitor.below) && r.parity.competitor.below.length === 2,
      JSON.stringify(r.parity?.competitor));
    // The persisted artifact carries the provenance: baseline path,
    // the named below dimensions, the baseline file's sha256, a stamp.
    const compPath = join(o.batchDir, "gate-parity-competitor.json");
    check("11 gate-parity-competitor.json persisted", existsSync(compPath), compPath);
    // (a)+(b): the schema and the prompt, read off the captured
    // parity-gate call (the composition's inbound boundary).
    const parityCall = o.calls.find((c) => c.label.startsWith("gate:parity:"));
    check("11 PARITY_SCHEMA carries the optional competitor property",
      !!parityCall?.schema?.properties?.competitor &&
      parityCall.schema.properties.competitor.properties?.baseline?.type === "string" &&
      parityCall.schema.properties.competitor.properties?.below?.type === "array" &&
      parityCall.schema.properties.competitor.properties?.below?.items?.type === "string",
      JSON.stringify(parityCall?.schema?.properties?.competitor));
    check("11 parity prompt names the baseline path (never its content)",
      !!parityCall && parityCall.prompt.includes("porting/parity/baseline-github.json") &&
      parityCall.prompt.includes("porting/parity/parity-table.md") &&
      !parityCall.prompt.includes('"dimension"'),
      parityCall ? "baseline path missing from prompt" : "no parity call captured");
    if (existsSync(compPath)) {
      const artifact = gateFile(o, "gate-parity-competitor.json");
      const { createHash } = await import("node:crypto");
      const expectedSha = createHash("sha256").update(readFileSync(join(ROOT, "porting/parity/baseline-github.json"))).digest("hex");
      check("11 artifact carries baseline + below + sha256",
        artifact.baseline === "porting/parity/baseline-github.json" &&
        JSON.stringify(artifact.below) === JSON.stringify(["session-steering", "issues"]) &&
        artifact.baselineSha256 === expectedSha &&
        typeof artifact.at === "string",
        JSON.stringify({ baseline: artifact.baseline, below: artifact.below, sha: artifact.baselineSha256?.slice(0, 12) }));
    }
  }
} catch (e) { check("11 competitor-mode case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 12. ask() WATCHDOG: a wedged phase fails fast, no retry, row released ----
// Fault injection: the plan phase's wait NEVER settles; a tiny phaseDeadlineMs
// must trip the watchdog — no retry (a wedged agent won't unwedge), the order
// records a WATCHDOG red, and the batch still reaches its record-and-release path.
try {
  const w1 = `${ID_PREFIX}s12-wedged`;
  const t0 = Date.now();
  const o = await scenario([w1], {
    limit: 1, phaseDeadlineMs: 1500,
    mode: (label, dflt) => (label === `plan:${CID(w1)}` ? new Promise(() => { }) : dflt(label)),
  });
  const elapsed = Date.now() - t0;
  if (o.error) check("12 wedged-phase scenario completes (no hang)", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    const planCalls = o.calls.filter((c) => c.label === `plan:${CID(w1)}`);
    check("12 plan phase ran exactly once (watchdog throw is never retried)", planCalls.length === 1, `calls=${planCalls.length}`);
    check("12 wedged phase is a WATCHDOG red, not a hang", /WATCHDOG/.test(r.orders[0]?.verdict ?? ""), (r.orders[0]?.verdict ?? "").slice(0, 120));
    check("12 batch completed via the record-and-release path", typeof r.next === "string" && r.next.length > 0 && elapsed < 60000, `elapsed=${elapsed}ms next=${(r.next ?? "").slice(0, 40)}`);
    check("12 red row's claim released (reclaimable)", o.fx.claimsOf().length === 0, JSON.stringify(o.fx.claimsOf().map((x) => x.id)));
  }
} catch (e) { check("12 watchdog case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 13. batch-gate WATCHDOG: wedged parity+merged fail CLOSED (synthesized BLOCK)
// Fault injection: both batch gates never settle; a tiny gateDeadlineMs must
// cancel them and feed synthesized BLOCK verdicts through the normal persist
// path — absence of a verdict is a BLOCK, never a throw or a hang.
try {
  const g1 = `${ID_PREFIX}s13-a`;
  const t0 = Date.now();
  const o = await scenario([g1], {
    limit: 1, gateDeadlineMs: 1500,
    mode: (label, dflt) => (label.startsWith("gate:parity:") || label.startsWith("gate:merged:") ? new Promise(() => { }) : dflt(label)),
  });
  const elapsed = Date.now() - t0;
  if (o.error) check("13 batch-gate watchdog scenario completes (no hang)", false, String(o.error.message).slice(0, 200));
  else {
    const r = o.report;
    check("13 wedged parity gate fails closed to a synthesized BLOCK", r.parity?.verdict === "BLOCK" && (r.parity?.shipBlockers ?? []).some((b) => /watchdog/i.test(b)), JSON.stringify(r.parity).slice(0, 160));
    check("13 wedged merged gate fails closed to a synthesized BLOCK", r.gate?.verdict === "BLOCK" && (r.gate?.shipBlockers ?? []).some((b) => /watchdog/i.test(b)), JSON.stringify(r.gate).slice(0, 160));
    check("13 gate artifacts persisted with the watchdog block", gateFile(o, "gate-parity.md").verdict === "BLOCK" && gateFile(o, "gate-merged.md").verdict === "BLOCK");
    check("13 batch completed fast (no 45m hostage)", elapsed < 60000, `elapsed=${elapsed}ms`);
  }
} catch (e) { check("13 batch-gate watchdog case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 14. batched claims: the picker issues ONE claim-many invocation ----
// nextgit-e17-mach-claims-guard-chrome (item 1): the per-row claim
// loop was swapped for a single `tasks.mjs claim-many <ids...>`
// spawn. These cases pin the new shape: (a) ≤1 claim-many call for
// N picks, (b) a contended row does not abort the batch (the rest
// still run, the contended row is reported claimed:false and never
// runs), (c) all-green auto-close still fires on the claimed rows.
try {
  // 14a: two picks → at most ONE claim-many invocation carrying both ids.
  const x = `${ID_PREFIX}s14-a`, y = `${ID_PREFIX}s14-b`;
  let fx14;
  const oA = await scenario([x, y], {
    limit: 2,
    before: (fx) => { fx14 = fx; },
    mode: (label, dflt) => {
      for (const id of [x, y]) if (label === `impl:${CID(id)}`) writeFileSync(join(fx14.root, `order-work-${id}.md`), `work ${id}\n`);
      if (label.startsWith("gate:parity:") || label.startsWith("gate:merged:")) return Bun.sleep(30).then(() => dflt(label));
      return dflt(label);
    },
  });
  if (oA.error) check("14a batched-claim scenario completes", false, String(oA.error.message).slice(0, 200));
  else {
    const cm = fx14.claimManyCalls();
    check("14a at most one claim-many invocation for two picks", cm.length <= 1, JSON.stringify(cm));
    check("14a the one claim-many carries both ids",
      cm.length === 1 && cm[0].includes(CID(x)) && cm[0].includes(CID(y)),
      JSON.stringify(cm));
    check("14a both orders GREEN (batch still runs)", oA.report.orders.length === 2 && oA.report.orders.every((r) => r.verdict === "GREEN"), JSON.stringify(oA.report.orders.map((r) => [r.order, r.verdict])));
    const aRow = oA.fx.rowOf(CID(x)), bRow = oA.fx.rowOf(CID(y));
    // The all-green batch CAS-closes its claimed rows (the close
    // contract keys off row.claimed, which the batched claim path
    // preserves). Auto-close releases the lease, so claimed_by is
    // null at assertion time — the DONE status is the proof the
    // claim was held and the row was owned by the batch.
    check("14a all-green auto-close still fires on claimed rows", aRow?.status === "done" && bRow?.status === "done", JSON.stringify([aRow?.status, bRow?.status]));
    check("14a report records both closed (claim was held)", Array.isArray(oA.report.closed) && oA.report.closed.length === 2 && oA.report.closed.includes(CID(x)) && oA.report.closed.includes(CID(y)), JSON.stringify(oA.report.closed));
  }

  // 14b: one row preclaimed (contended) → the batch still runs the
  // OTHER pick; the contended row is reported claimed:false and
  // never runs (order set excludes it).
  const p = `${ID_PREFIX}s14-pre`, q = `${ID_PREFIX}s14-q`;
  let fx14b;
  const oB = await scenario([p, q], {
    preclaimed: [p], limit: 2,
    before: (fx) => { fx14b = fx; },
    mode: (label, dflt) => {
      if (label === `impl:${CID(q)}`) writeFileSync(join(fx14b.root, `order-work-${q}.md`), `work ${q}\n`);
      if (label.startsWith("gate:parity:") || label.startsWith("gate:merged:")) return Bun.sleep(30).then(() => dflt(label));
      return dflt(label);
    },
  });
  if (oB.error) check("14b contended scenario completes", false, String(oB.error.message).slice(0, 200));
  else {
    check("14b only the non-contended order ran", oB.report.orders.length === 1 && oB.report.orders[0].order === CID(q), JSON.stringify(oB.report.orders.map((r) => r.order)));
    check("14b contended row untouched (stays other-session)",
      oB.fx.rowOf(CID(p))?.claimed_by === "other-session" && oB.fx.rowOf(CID(p))?.status === "pending",
      JSON.stringify([oB.fx.rowOf(CID(p))?.claimed_by, oB.fx.rowOf(CID(p))?.status]));
    check("14b contended row never ran (no run dir)", !existsSync(join(oB.fx.root, "porting/runs", CID(p))));
    const cmB = fx14b.claimManyCalls();
    // The preclaimed row is in_progress → readQueueRows excludes it
    // (claimed_by != null), so claim-many carries ONLY the pending
    // pick. The per-id contention tolerance (a row claimed in the
    // race window between read and claim-many) is pinned at the
    // adapter level in tasks.test.mjs 11b; here we pin that the
    // picker's claim-many carries exactly its pending selection.
    check("14b claim-many carries exactly the pending pick",
      cmB.length === 1 && cmB[0].includes(CID(q)) && !cmB[0].includes(CID(p)),
      JSON.stringify(cmB));
    check("14b non-contended row still closed on green", oB.fx.rowOf(CID(q))?.status === "done", JSON.stringify(oB.fx.rowOf(CID(q))?.status));
  }

  // 14c: three picks, all green, default limit → auto-close on all
  // claimed rows (the close contract is keyed off row.claimed, which
  // the batched path preserves).
  const c1 = `${ID_PREFIX}s14-c1`, c2 = `${ID_PREFIX}s14-c2`, c3 = `${ID_PREFIX}s14-c3`;
  let fx14c;
  const oC = await scenario([c1, c2, c3], {
    limit: 3,
    before: (fx) => { fx14c = fx; },
    mode: (label, dflt) => {
      for (const id of [c1, c2, c3]) if (label === `impl:${CID(id)}`) writeFileSync(join(fx14c.root, `order-work-${id}.md`), `work ${id}\n`);
      if (label.startsWith("gate:parity:") || label.startsWith("gate:merged:")) return Bun.sleep(30).then(() => dflt(label));
      return dflt(label);
    },
  });
  if (oC.error) check("14c auto-close scenario completes", false, String(oC.error.message).slice(0, 200));
  else {
    check("14c all three orders GREEN", oC.report.orders.length === 3 && oC.report.orders.every((r) => r.verdict === "GREEN"), JSON.stringify(oC.report.orders.map((r) => r.verdict)));
    check("14c all three rows auto-closed",
      [c1, c2, c3].every((id) => oC.fx.rowOf(CID(id))?.status === "done"),
      JSON.stringify([c1, c2, c3].map((id) => oC.fx.rowOf(CID(id))?.status)));
    check("14c report records all closed", Array.isArray(oC.report.closed) && oC.report.closed.length === 3, JSON.stringify(oC.report.closed));
  }
} catch (e) { check("14 batched-claims case threw", false, String(e?.stack ?? e).slice(0, 300)); }

// --- 10. live-store isolation + cleanup ---------------------------------------
try {
  if (existsSync(LIVE_BEADS)) {
    // cleanEnv() strips BEADS_DIR → bd resolves the repo's OWN store from cwd=ROOT.
    const live = JSON.parse(execFileSync(BD_BIN, ["list", "--json", "--all", "--limit", "3000"], { cwd: ROOT, env: cleanEnv(), encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }));
    const leaked = live.filter((r) => String(r.id).includes(ID_PREFIX));
    const leakedClaims = live.filter((r) => r.assignee && String(r.id).includes(ID_PREFIX));
    check("10 live store untouched (no selftest rows/claims)", leaked.length === 0 && leakedClaims.length === 0, JSON.stringify({ rows: leaked.map((r) => r.id).slice(0, 4), claims: leakedClaims.map((r) => r.id).slice(0, 4) }));
  } else {
    check("10 live-store isolation (no live store present — check skipped)", true);
  }
} catch (e) { check("10 live-store check threw", false, String(e?.message ?? e)); }
for (const t of tmps) rmSync(t, { recursive: true, force: true });
check("10 all temp state cleaned", tmps.every((t) => !existsSync(t)));

// teardown: the DDW runtime stubs are this suite's only globals — leave none behind
for (const k of ["agent", "wait", "phase", "log"]) delete globalThis[k];

console.log(fails === 0 ? `ALL PASS (checks=${checks})` : `${fails} FAILURES (checks=${checks})`);
process.exit(fails === 0 ? 0 : 1);
