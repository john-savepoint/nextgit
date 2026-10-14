// porting/wf-integrate.ddw.js — transactional integration (O1).
//
// WHY: three waves of lane work have been lost or half-landed because lane merges were run
// directly in the live tree; a crash mid-merge left main broken (dangling imports, hand-revert).
// This module makes integration transactional: ALL merging + the full battery happen in an
// integration worktree; main is only fast-forwarded when the battery is FULLY green.
// A crash at any point leaves main untouched.
//
// RUN VIA ONE-LINER IMPORT — never transcribe:
//   const I = await import("./porting/wf-integrate.ddw.js");
//   await I.open();                    // create/reuse the integration worktree + state
//   await I.merge("refs/lane/lane-1"); // merge one source; conflicts => you resolve in the wt
//   await I.battery();                 // tsc + all *.test.mjs in the worktree, per-suite rc
//   await I.finalize();                // FF main to wt HEAD (only when battery green)
//   await I.abort();                   // discard the wt (branch kept for forensics)
//
// Disk is the truth: state at porting/runs/integrate-<id>/state.json; battery report at
// porting/runs/integrate-<id>/battery.json (per-suite exit codes — never string-counted).
// Sources default: refs/lane/lane-1..10. Main is the main repo's refs/heads/main.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";

const sh = (cmd, args, cwd, { timeout = 120000, allowFail = false } = {}) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} [${cwd}] rc=${r.status}: ${(r.stderr || r.stdout || "").trim().slice(0, 400)}`);
  }
  return r;
};
const git = (args, cwd, opts) => sh("git", args, cwd, opts);

// Deterministic Chrome discovery for the battery: the Chrome-driving
// suites (action-banner-states, parity-dashboard, …) honor
// process.env.CHROME_BIN, but the battery never exported it — every
// suite fell back to its own `which` probe, which wave 16 measured
// as flaky under fleet load (two reds, both Chrome discovery). The
// battery now resolves ONCE and exports CHROME_BIN into the suite
// env, so every suite shares one deterministic binary. A
// pre-set CHROME_BIN wins (a lane with a nonstandard location
// controls its own resolution). Fail-open: a Chrome-less box gets
// null and the suites' own SKIP-and-exit-0 contract applies — the
// battery must not red on a box without Chrome.
const CHROME_CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
const resolveChromeBin = () => {
  for (const bin of CHROME_CANDIDATES) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    const hit = String(r.stdout ?? "").trim();
    if (r.status === 0 && hit) return hit;
  }
  return null;
};

export async function open({ root, id, reuse = true } = {}) {
  const mainRoot = root ?? process.cwd();
  const runId = id ?? "main";
  const runDir = `${mainRoot}/porting/runs/integrate-${runId}`;
  const wt = `${mainRoot}/.worktrees/integrate-${runId}`;
  const branch = `integrate-${runId}`;
  mkdirSync(runDir, { recursive: true });

  const mainSha = git(["rev-parse", "HEAD"], mainRoot).stdout.trim();
  let created = false;

  if (reuse && existsSync(`${wt}/.git`)) {
    // reuse: verify it is on our branch
    const cur = git(["rev-parse", "--abbrev-ref", "HEAD"], wt).stdout.trim();
    if (cur !== branch) throw new Error(`worktree exists but on ${cur}, expected ${branch}`);
  } else {
    git(["worktree", "add", "-b", branch, wt, "HEAD"], mainRoot);
    created = true;
  }
  // tsc + suites need platform deps (gitignored, not shared across worktrees)
  if (!existsSync(`${wt}/platform/node_modules`)) {
    sh("ln", ["-s", `${mainRoot}/platform/node_modules`, `${wt}/platform/node_modules`], mainRoot);
  }
  const st = { runId, mainRoot, runDir, wt, branch, baseSha: mainSha, created, opens: (readState(runDir)?.opens ?? 0) + 1, updatedAt: new Date().toISOString() };
  writeFileSync(`${runDir}/state.json`, JSON.stringify(st, null, 2));
  return st;
}
const readState = (runDir) => { try { return JSON.parse(readFileSync(`${runDir}/state.json`, "utf8")); } catch { return null; } };

export async function merge({ root, id, source } = {}) {
  const { mainRoot, wt, runDir } = state(root, id);
  const r = git(["merge", "--no-ff", "--no-edit", "-m", `integrate: merge ${source}`, source], wt, { allowFail: true, timeout: 300000 });
  const conflicts = git(["diff", "--name-only", "--diff-filter=U"], wt).stdout.trim().split("\n").filter(Boolean);
  const head = git(["rev-parse", "HEAD"], wt).stdout.trim();
  const status = r.status === 0 ? "merged" : conflicts.length ? "conflict" : "failed";
  const rec = { source, status, conflicts, head, at: new Date().toISOString(), stderr: r.status !== 0 && !conflicts.length ? (r.stderr || "").slice(0, 300) : undefined };
  appendRecord(runDir, "merges", rec);
  const inMerge = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], wt, { allowFail: true }).status === 0;
  return { ...rec, inMerge };
}

export async function resolve({ root, id } = {}) {
  // Finalize a halted merge after manual conflict resolution: add everything, commit.
  const { wt, runDir } = state(root, id);
  git(["add", "-A"], wt);
  const staged = git(["diff", "--cached", "--name-only"], wt).stdout.trim().split("\n").filter(Boolean);
  if (!staged.length) return { status: "nothing-staged" };
  git(["-c", "user.email=runner@local", "-c", "user.name=runner", "commit", "-q", "--no-edit"], wt, { timeout: 120000 });
  const head = git(["rev-parse", "HEAD"], wt).stdout.trim();
  const rec = { status: "resolved", files: staged.length, head, at: new Date().toISOString() };
  appendRecord(runDir, "merges", rec);
  return rec;
}

export async function battery({ root, id, timeoutPer = 900000, only = null } = {}) {
  const { wt, runDir } = state(root, id);
  const results = [];
  // tsc first
  const tsc = sh("npx", ["tsc", "--noEmit"], `${wt}/platform`, { allowFail: true, timeout: 300000 });
  results.push({ suite: "tsc", rc: tsc.status, output: ((tsc.stdout || "") + (tsc.stderr || "")).trim().slice(0, 1500) });
  const files = readdirSync(`${wt}/porting/tests`).filter((f) => f.endsWith(".test.mjs")).sort();
  // Suite env: strip caller store-config so fixture suites always resolve their OWN temp
  // stores — a leaked BEADS_DIR (e.g. exported by a parent harness) pointed fixtures at
  // the live store and crashed them on init (observed 2026-10-10).
  const suiteEnv = { ...process.env };
  delete suiteEnv.BEADS_DIR;
  delete suiteEnv.TASKS_DB;
  // Deterministic Chrome: resolve once, share with every suite
  // (a pre-set CHROME_BIN wins — `||`). When no Chrome binary
  // exists, warn: the Chrome-gated suites self-SKIP (their own
  // contract), so the battery stays green on a Chrome-less box
  // but never rediscovers per-suite under load.
  if (!suiteEnv.CHROME_BIN) {
    const chrome = resolveChromeBin();
    if (chrome) suiteEnv.CHROME_BIN = chrome;
    else console.error("battery: no Chrome binary found — Chrome-gated suites will self-SKIP");
  }
  // Chrome serialization across concurrently-running batteries
  // (nextgit-e19-mach-watchdog-calibration; wave-16/17 evidence:
  // "battery Chrome contention (2 reds / 3 runs, standalone-green)"
  // when 8 parallel lanes each launch their integration battery's
  // headless-Chrome suites). The loop above is serial WITHIN one
  // battery; the gap is cross-lane batteries with no serialization
  // when the fleet's chrome-slot guard is not wired (direct
  // battery() calls, or a lane without the guard). Default ON
  // (NEXTGIT_BATTERY_CHROME_SERIAL=0 opts out for single-battery
  // boxes / already-serialized harnesses). Injection is a PATH shim
  // — suites resolve Chrome PATH-FIRST (`which google-chrome` before
  // the CHROME_BIN fallback; the fleet-guard comment in
  // wf-fleet.ddw.js records why a bare CHROME_BIN point is not
  // reliable), so this uses the fleet guard's proven pattern
  // verbatim: <runDir>/chrome-bin/google-chrome -> chrome-slot.sh
  // (flock, N slots). The slot script is the SAME
  // porting/tests/chrome-slot.sh the fleet guard uses — single
  // source; the script itself is not modified. A pre-set
  // NEXTGIT_CHROME_GUARD=1 (the fleet already armed the guard for
  // this process) short-circuits: the shim is already in force and
  // CHROME_BIN already points at the slot script. Fail-open: a
  // missing slot script or a Chrome-less box logs and continues
  // unserialized — suites' own SKIP-and-exit-0 contract applies.
  const slotScript = `${mainRoot}/porting/tests/chrome-slot.sh`;
  if (process.env.NEXTGIT_BATTERY_CHROME_SERIAL !== "0" && !process.env.NEXTGIT_CHROME_GUARD && existsSync(slotScript)) {
    try {
      const real = (() => {
        for (const c of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
          if (existsSync(c)) return c;
        }
        try {
          return execFileSync("bash", ["-lc", "command -v google-chrome || command -v chromium || true"], { encoding: "utf8" }).trim().split("\n")[0] || null;
        } catch { return null; }
      })();
      if (real) {
        const shimDir = `${runDir}/chrome-bin`;
        mkdirSync(shimDir, { recursive: true });
        const shim = `${shimDir}/google-chrome`;
        writeFileSync(shim, `#!/usr/bin/env bash\nexec "${slotScript}" "$@"\n`);
        execFileSync("chmod", ["+x", shim]);
        suiteEnv.CHROME_BIN_REAL = real; // pinned: slot script must never resolve the shim
        suiteEnv.CHROME_BIN = slotScript; // probes prefer the env var
        suiteEnv.PATH = `${shimDir}:${suiteEnv.PATH}`;
        console.error(`battery: chrome serialized via slot script (${shimDir}; real=${real}; slots=${process.env.CHROME_SLOTS ?? 4}; opt out with NEXTGIT_BATTERY_CHROME_SERIAL=0)`);
      } else {
        console.error("battery: chrome serialization skipped — no real Chrome binary found");
      }
    } catch (e) {
      console.error(`battery: chrome serialization failed (${String(e?.message ?? e).slice(0, 120)}) — continuing unserialized`);
    }
  }
  for (const f of files) {
    if (only && !only.includes(f)) continue;
    const r = spawnSync("bun", [`porting/tests/${f}`], { cwd: wt, encoding: "utf8", timeout: timeoutPer, env: suiteEnv });
    const tail = ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-2).join(" | ").slice(0, 200);
    results.push({ suite: f, rc: r.status, tail });
  }
  const green = results.every((r) => r.rc === 0);
  const report = { at: new Date().toISOString(), green, failed: results.filter((r) => r.rc !== 0).map((r) => r.suite), results };
  writeFileSync(`${runDir}/battery.json`, JSON.stringify(report, null, 2));
  return { green, failed: report.failed, total: results.length };
}

export async function finalize({ root, id } = {}) {
  const { mainRoot, wt, branch, runDir } = state(root, id);
  const batt = JSON.parse(readFileSync(`${runDir}/battery.json`, "utf8"));
  if (!batt.green) throw new Error(`battery not green (${batt.failed.join(", ")}) — refusing to advance main`);
  const wtHead = git(["rev-parse", "HEAD"], wt).stdout.trim();
  const mainHead = git(["rev-parse", "HEAD"], mainRoot).stdout.trim();
  // main must be an ancestor of wt head (FF only)
  const anc = git(["merge-base", "--is-ancestor", mainHead, wtHead], mainRoot, { allowFail: true });
  if (anc.status !== 0) throw new Error("main has moved off the integration base — refusing non-FF advance.");
  // main must be CLEAN: `merge --ff-only` updates the working tree; uncommitted work would be at risk.
  const dirty = git(["status", "--porcelain"], mainRoot).stdout.trim();
  if (dirty) throw new Error(`main working tree is dirty (${dirty.split("\n").length} paths) — commit/stash before finalize, then merge main INTO the integration branch and re-run battery+finalize.`);
  // Advance ref AND working tree in one step (plain update-ref would strand the files).
  git(["merge", "--ff-only", wtHead], mainRoot, { timeout: 300000 });
  const rec = { status: "finalized", from: mainHead, to: wtHead, branch, battery: { total: batt.results.length, green: true }, at: new Date().toISOString() };
  appendRecord(runDir, "merges", rec);
  return rec;
}

export async function abort({ root, id, dropBranch = false } = {}) {
  const { mainRoot, wt, branch, runDir } = state(root, id);
  git(["merge", "--abort"], wt, { allowFail: true });
  git(["worktree", "remove", "--force", wt], mainRoot, { allowFail: true });
  if (dropBranch) git(["branch", "-D", branch], mainRoot, { allowFail: true });
  const rec = { status: "aborted", branchKept: !dropBranch, at: new Date().toISOString() };
  appendRecord(runDir, "merges", rec);
  return rec;
}

function state(root, id) {
  const mainRoot = root ?? process.cwd();
  const runDir = `${mainRoot}/porting/runs/integrate-${id ?? "main"}`;
  const st = readState(runDir);
  if (!st) throw new Error(`no integration state at ${runDir} — run open() first`);
  return st;
}
function appendRecord(runDir, file, rec) {
  const p = `${runDir}/${file}.ndjson`;
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
  writeFileSync(p, prev + JSON.stringify(rec) + "\n");
}
