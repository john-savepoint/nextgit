#!/usr/bin/env node
// real-agents.mjs — drive the demo proposals with REAL AI coding-agent CLIs.
//
// Difference from agents.mjs: that script applies deterministic text transforms.
// This one hands the task to an actual agent CLI (codex / omp / …) running in a
// real clone of the fork, so the proposal the platform serves is whatever the
// agent really wrote. A candidate CLI is only trusted after it proves, in a
// throwaway scratch dir, that it can create a file.
//
// Usage:  node platform/scripts/real-agents.mjs [baseline] [ttlSeconds]
// Output: /tmp/real-agents/          — clones, per-agent logs, report.md
//         /tmp/nextgit-agents.json  — [{ name, remote, token, … }]

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureWorkspaceFiles } from "./workspace-manifest.mjs";
import { loadRegistry, buildArgs } from "./harness-registry.mjs";
import { bustProposalsCache } from "./lib/bust-cache.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const OUT_FILE = process.env.AGENTS_OUT ?? "/tmp/nextgit-agents.json";
const WORK_ROOT = process.env.REAL_AGENTS_ROOT ?? "/tmp/real-agents";
const PLATFORM = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";

// Usage:  node platform/scripts/real-agents.mjs [baseline] [ttlSeconds] [--only agent-1,agent-3]
const only = (() => {
 const i = process.argv.indexOf("--only");
 return i < 0 ? null : new Set(process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
})();

const baseline = /^\d+$/.test(process.argv[3] ?? "") ? process.argv[2] ?? "demo" : "demo";
const ttl = Number(process.argv[3]) || 604800;
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 8 * 60_000;
// An agent killed mid-flight leaves its clone with real work but no commit.
// The clone is kept so a retry can collect it, and on the first full run
// starvation is retried serially.
const KEEP_CLONES = true;
// Four agent CLIs at once starve each other: measured, one omp agent out of two
// concurrent omp runs produces no output at all in 480s while it succeeds
// alone in ~350s. Agents that come back empty are retried one at a time.
const SERIAL_RETRY = process.env.SERIAL_RETRY !== "0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;

function wranglerToken() {
 const candidates = [
  join(homedir(), ".config/.wrangler/config/default.toml"),
  join(homedir(), ".wrangler/config/default.toml"),
 ];
 for (const p of candidates) {
  if (existsSync(p)) {
   const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
   if (m) return m[1];
  }
 }
 return null;
}

function apiToken() {
 if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
 if (cachedToken) return cachedToken;
 cachedToken = wranglerToken();
 if (!cachedToken) throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
 return cachedToken;
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const authHeader = () => ({ Authorization: `Bearer ${apiToken()}` });

async function call(method, url, body, headers = null) {
 const send = (h) =>
  fetch(url, {
   method,
   headers: { ...(h ?? authHeader()), "Content-Type": "application/json" },
   body: body ? JSON.stringify(body) : undefined,
  });

 let res = await send(headers);
 let data = await res.json().catch(() => ({}));

 // The wrangler OAuth token expires on its own; `wrangler whoami` refreshes it
 // in place. Retry once through that path instead of failing the whole run.
 if (res.status === 401 && !headers && !process.env.CLOUDFLARE_API_TOKEN) {
  cachedToken = null;
  try {
   execFileSync("wrangler", ["whoami"], { stdio: "ignore", timeout: 60_000 });
  } catch {
   throw new Error(`${method} ${url} -> 401 and 'wrangler whoami' could not refresh the OAuth token`);
  }
  res = await send(null);
  data = await res.json().catch(() => ({}));
 }

 if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
 return data.result;
}

/** Fork `name` fresh, tolerating the post-delete consistency lag. */
async function forkFresh(name) {
 const url = `${apiBase}/repos/${baseline}/fork`;
 let last;
 for (let attempt = 1; attempt <= 5; attempt++) {
  try {
   return await call("POST", url, { name, default_branch_only: true });
  } catch (err) {
   last = err;
   if (!/already exists/i.test(err.message)) throw err;
   await sleep(1500 * attempt);
  }
 }
 throw last;
}

// ---------------------------------------------------------------------------
// CLI candidates.
//
// A candidate is `usable` only when it both authenticates and actually edits the
// filesystem. `{sandbox: false}` means the binary cannot write files at all, so
// it is never dispatched a task.
// ---------------------------------------------------------------------------


const { harnesses: CANDIDATES, errors: registryErrors } = loadRegistry();
if (registryErrors.length) {
 console.error("harness registry load failed:");
 for (const e of registryErrors) console.error(`  ${e}`);
 if (process.argv.includes("--list-harnesses")) {
  console.error("  (--list-harnesses cannot proceed — registry is broken)");
  process.exit(2);
 }
 process.exitCode = 1;
}
const KNOWN_UNAVAILABLE = [
 { id: "claude", reason: "401 OAuth access token is invalid" },
 { id: "gemini", reason: "2.5-pro no longer available to new users (model revoked)" },
 { id: "opencode", reason: "Token refresh failed: 401" },
 { id: "dsh", reason: "headless profile fails to boot: node:zlib createZstdDecompress missing + Koffi native module not found" },
];

/** Spawn a candidate with a hard ceiling; resolves {rc, out, err, timedOut}. */
function spawnBounded(cand, args, cwd, timeoutMs, sink) {
 return new Promise((resolve) => {
  const child = spawn(cand.bin, args, {
   cwd,
   env: { ...process.env, ...cand.env },
   stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let timedOut = false;
  child.stdout.on("data", (d) => {
   out += d;
   sink?.out?.write(d);
  });
  child.stderr.on("data", (d) => {
   err += d;
   sink?.err?.write(d);
  });
  const timer = setTimeout(() => {
   timedOut = true;
   child.kill("SIGKILL");
  }, timeoutMs);
  child.on("error", (e) => {
   clearTimeout(timer);
   resolve({ rc: -1, out, err: `${err}${e.message}`, timedOut });
  });
  child.on("close", (rc) => {
   clearTimeout(timer);
   resolve({ rc, out, err, timedOut });
  });
 });
}

/**
 * Empirically validate a candidate: can it write a file in a scratch dir?
 * Judged by the artifact on disk, never by the CLI's self-reported success.
 */
async function probeCandidate(cand) {
 const row = {
  cli: cand.id,
  bin: cand.bin,
  present: true,
  writesFiles: false,
  rc: null,
  ms: null,
  detail: "",
 };
 const scratch = join(WORK_ROOT, `probe-${cand.id}`);
 rmSync(scratch, { recursive: true, force: true });
 mkdirSync(scratch, { recursive: true });
 writeFileSync(join(scratch, "README.md"), "hi\n");

 const git = (...args) =>
  execFileSync("git", args, { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] });
 git("init", "-q", ".");
 git("config", "user.email", "probe@local");
 git("config", "user.name", "probe");

 const started = Date.now();
 const res = await spawnBounded(
  cand,
  buildArgs(cand, "Create a file named hello.txt in this directory whose only content is the word pong. Do not do anything else.", scratch),
  scratch,
  cand.probeBudgetMs ?? 4 * 60_000,
  null,
 );
 row.rc = res.rc;
 row.ms = Date.now() - started;
 row.writesFiles = existsSync(join(scratch, "hello.txt"));
 const tail = (res.err || res.out || "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
 row.detail = row.writesFiles
  ? `created hello.txt in ${row.ms}ms`
  : `no file written — ${(tail || `exit ${res.rc}${res.timedOut ? " (timeout)" : ""}`).slice(0, 120)}`;
 row.usable = row.writesFiles;
 rmSync(scratch, { recursive: true, force: true });
 return row;
}

// ---------------------------------------------------------------------------
// Tasks — deliberately overlapping: agent-1 and agent-2 both rewrite src/auth.ts.
// ---------------------------------------------------------------------------

const TASKS = [
 {
  name: "agent-1",
  cli: "codex",
  short: "add refreshSession(session, ttlMs) to src/auth.ts",
  note: "Feature: refreshSession() extends a live session by TTL",
  prompt:
   "Working in this git repository, add a refreshSession(session, ttlMs = 3600_000) function to src/auth.ts returning an updated session.",
 },
 {
  name: "agent-2",
  cli: "omp",
  short: "give isExpired an optional leewayMs parameter",
  note: "Fix: tolerate clock skew in isExpired via leewayMs",
  prompt:
   "Working in this git repository, update isExpired in src/auth.ts to accept an optional leewayMs parameter: Date.now() > session.expiresAt + leewayMs.",
 },
 {
  name: "agent-3",
  cli: "omp",
  short: "add getCached(key, compute) memo cache to src/store.ts",
  note: "Perf: read-through memo cache for store reads",
  prompt:
   "Working in this git repository, add a getCached(key, compute) memo cache to src/store.ts.",
 },
 {
  name: "agent-4",
  cli: "codex",
  short: "add src/feature.ts with isEnabled(flag)",
  note: "Feature: feature-flag module with isEnabled()",
  prompt:
   "Working in this git repository, add a feature-flag module src/feature.ts with isEnabled(flag).",
 },
];

/** The agent's prompt plus the git hygiene it must do itself. */
function promptWithCommitInstructions(task) {
 return [
  task.prompt,
  "",
  "Do not run `git push` — the runner pushes for you.",
  "When you are done, commit the change with `git add -A` and `git commit -m \"${task.name}: ${task.short}\"`.",
  "Workspace manifest: read .nextgit/manifest.json before planning — never dispatch a context-blind agent.",
 ].join("\n");
}

// ---------------------------------------------------------------------------

async function prepareFork(task) {
 const repos = await call("GET", `${apiBase}/repos?limit=200`);
 if (repos.some((r) => r.name === task.name)) {
  await call("DELETE", `${apiBase}/repos/${task.name}`);
  // The delete is eventually consistent; a same-name fork can still collide.
  await sleep(1200);
 }
 const fork = await forkFresh(task.name);
 const tok = await call("POST", `${apiBase}/tokens`, { repo: task.name, scope: "write", ttl });
 return { remote: fork.remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at };
}

/** Mint a fresh write token for an existing fork (resume path: keep the clone). */
async function refreshForkToken(name, remote) {
 const tok = await call("POST", `${apiBase}/tokens`, { repo: name, scope: "write", ttl });
 return { remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at };
}

async function runAgent(task, cand) {
 const row = {
  agent: task.name,
  cli: cand.id,
  fallbackFrom: task.usedFallback ? task.cli : null,
  task: task.short,
  status: "pending",
  files: "",
  head: "",
  detail: "",
 };
 const dir = join(WORK_ROOT, task.name);
 let minted = null;

 try {
  // Resume ONLY when the kept clone holds un-collected work (uncommitted
  // paths or unpushed commits). A fully-pushed clone from a completed run
  // must be re-provisioned fresh — resuming it dead-loops on "no file
  // changes" (the replay barrier found by the demo-reset gate).
  let resumeDir = null;
  let stalePaths = [];
  if (KEEP_CLONES && existsSync(join(dir, ".git"))) {
   stalePaths = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" })
    .split("\n").filter(Boolean);
   let hasUnpushed = false;
   try {
    hasUnpushed =
     execFileSync("git", ["log", "--oneline", "origin/main..HEAD"], { cwd: dir, encoding: "utf8" }).trim().length > 0;
   } catch {
    hasUnpushed = false;
   }
   resumeDir = stalePaths.length || hasUnpushed ? dir : null;
  }
  if (resumeDir) {
   console.log(`  ${task.name}  ${cand.id}  resuming (${stalePaths.length} uncommitted path(s) kept)`);
   minted = await refreshForkToken(
    task.name,
    execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" }).trim(),
   );
  } else {
   minted = await prepareFork(task);
  }
  const env = {
   ...process.env,
   GIT_CONFIG_COUNT: "1",
   GIT_CONFIG_KEY_0: "http.extraheader",
   GIT_CONFIG_VALUE_0: `Authorization: Bearer ${minted.token}`,
  };
  const git = (...args) =>
   execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const one = (...args) => git(...args).trim();


  if (!resumeDir) {
   rmSync(dir, { recursive: true, force: true });
   mkdirSync(dir, { recursive: true });
   one("clone", minted.remote, dir);
   one("config", "user.name", task.name);
   one("config", "user.email", `${task.name.replace("-", "")}@nextgit.dev`);
   // The host's global gitignore would make `git add -A` skip agent-4's
   // possible .env work; ignore rules must come from the repo alone.
   one("config", "core.excludesFile", "/dev/null");
  }
  // Law 3: ship a workspace manifest + structure map into every clone so the
  // agent is never context-blind. Creates .nextgit/ files if absent.
  ensureWorkspaceFiles(dir);
  // origin/main is the fork point: the clone starts there and the runner only
  // pushes after the agent is done, so it never masks an agent's own commits.
  const forkHead = execFileSync("git", ["rev-parse", "origin/main"], { cwd: dir, encoding: "utf8" }).trim();

  if (resumeDir) {
   row.detail = "resumed after an earlier timeout; committing the agent's existing edits";
  } else {
   const logPath = join(WORK_ROOT, `${task.name}.log`);
   const outSink = createWriteStream(logPath);
   outSink.write(`$ ${cand.bin} ${buildArgs(cand, promptWithCommitInstructions(task), dir).map((a) => JSON.stringify(a).slice(0, 200)).join(" ")}\n\n`);
   const errSink = createWriteStream(`${logPath}.err`);
   console.log(`  ${task.name}  ${cand.id}  running…`);
   const res = await spawnBounded(
    cand,
    buildArgs(cand, promptWithCommitInstructions(task), dir),
    dir,
    AGENT_TIMEOUT_MS,
    { out: outSink, err: errSink },
   );
   outSink.end();
   errSink.end();
   row.detail = res.timedOut ? `timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)}s` : `exit ${res.rc}`;
  }
  const changed = git("status", "--porcelain").split("\n").filter(Boolean);

  // The baseline already has history, so commit count proves nothing. The
  // agent's work exists only if HEAD moved past the fork point or the tree is
  // dirty — a crashed CLI (exit 1, no edits) must not score as a proposal.
  const agentMovedHead = one("rev-parse", "HEAD") !== forkHead;
  if (!changed.length && !agentMovedHead) {
   throw new Error(`agent produced no file changes (${row.detail || "no edits on disk"})`);
  }

  // The prompt asks the agent to commit; commit here if it did not.
  let committedByRunner = false;
  if (changed.length) {
   one("add", "-A");
   one("commit", "-m", `${task.name}: ${task.short}`);
   committedByRunner = true;
  }

  row.files = (changed.length
   ? changed.map((l) => `${l.slice(0, 2).trim() || "M"} ${l.slice(3).trim()}`)
   : git("show", "--name-only", "--pretty=", "HEAD").split("\n").filter(Boolean).map((p) => `M ${p}`)
  ).join(", ");
  row.head = one("rev-parse", "--short", "HEAD");
  row.committedByRunner = committedByRunner;
  row.agentCommit = one("log", "-1", "--pretty=%s");

  // Intent travels as a git note; the Artifacts binding cannot resolve
  // refs/notes/*, so it is mirrored to a branch (CONTRACT "Notes mirror").
  one("notes", "add", "-m", task.note, "HEAD");
  // Forced mirror (derived state: mirror := refs/notes/commits). See agents.mjs comment.
  one("push", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes");

  row.status = "ok";
 } catch (err) {
  row.status = "fail";
  const stderr = err.stderr ? String(err.stderr).trim().split("\n").filter(Boolean) : [];
  row.detail = `${row.detail ? row.detail + " — " : ""}${stderr.length ? stderr.slice(-2).join(" ").slice(0, 160) : err.message.slice(0, 160)}`;
 }
 return { row, minted: minted ? { name: task.name, ...minted } : null };
}

function cliTable(statuses) {
 const lines = [];
 const all = [
  ...statuses.map((s) => ({ cli: s.cli, status: s.usable ? "usable" : "unusable", detail: s.detail })),
  ...KNOWN_UNAVAILABLE.map((k) => ({ cli: k.id, status: "unusable", detail: k.reason })),
 ].sort((a, b) => a.cli.localeCompare(b.cli));
 const pad = (s, n) => String(s).padEnd(n);
 lines.push(`  ${pad("cli", 10)} ${pad("status", 10)} detail`);
 lines.push(`  ${"-".repeat(78)}`);
 for (const r of all) lines.push(`  ${pad(r.cli, 10)} ${pad(r.status, 10)} ${r.detail}`);
 return lines.join("\n");
}

async function main() {
 mkdirSync(WORK_ROOT, { recursive: true });

 console.log("\n  probing agent CLIs (real scratch-dir edit test)…\n");
 const statuses = [];
 for (const cand of CANDIDATES) {
  let row;
  try {
   row = await probeCandidate(cand);
  } catch (err) {
   row = { cli: cand.id, bin: cand.bin, writesFiles: false, usable: false, detail: `probe threw: ${err.message}` };
  }
  statuses.push(row);
  console.log(`  ${row.cli.padEnd(6)} ${row.usable ? "usable  " : "unusable"} ${row.detail}`);
 }
 const usable = new Map(statuses.filter((s) => s.usable).map((s) => [s.cli, s]));
 const byId = new Map(CANDIDATES.map((c) => [c.id, c]));

 // Only assign tasks to CLIs that proved they can write. A task whose preferred
 // CLI is unavailable falls back to any proven CLI rather than being skipped —
 // a codex usage limit should degrade the run, not halve it.
 const fallbackOrder = [...byId.keys()].filter((id) => usable.has(id));
 const assignments = [];
 let fallbackCursor = 0;
 for (const task of TASKS) {
  if (only && !only.has(task.name)) continue;
  let cand = byId.get(task.cli);
  let usedFallback = false;
  if (!cand || !usable.has(task.cli)) {
   cand = fallbackOrder.length ? byId.get(fallbackOrder[fallbackCursor++ % fallbackOrder.length]) : null;
   usedFallback = Boolean(cand);
  }
  assignments.push({ ...task, cand, usedFallback });
 }

 console.log(`\n  dispatching ${assignments.filter((a) => a.cand).length}/${assignments.length} agents concurrently (timeout ${Math.round(AGENT_TIMEOUT_MS / 1000)}s)…`);
 const settled = await Promise.all(
  assignments.map(async (task) => {
   if (!task.cand) {
    return {
     row: {
      agent: task.name,
      cli: task.cli,
      task: task.short,
      status: "fail",
      files: "",
      head: "",
      detail: `CLI ${task.cli} is not usable — no agent dispatched`,
     },
     minted: null,
    };
   }
   return runAgent(task, task.cand);
  }),
 );

 const results = settled.map((s) => s.row);

 // Retry starved agents one at a time, in place in `results`.
 if (SERIAL_RETRY) {
  for (let i = 0; i < assignments.length; i++) {
   if (!assignments[i].cand || results[i].status === "ok") continue;
   console.log(`  ${assignments[i].name}  retrying serially (was: ${results[i].detail})`);
   const retry = await runAgent(assignments[i], assignments[i].cand);
   results[i] = retry.row;
   settled[i] = retry;
  }
 }

 const minted = settled.map((s) => s.minted).filter(Boolean);
 // A `--only` run must not drop the other agents' tokens from the shared file.
 const merged = [...new Map([...(only && existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")) : []), ...minted].map((m) => [m.name, m])).values()];
 writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));

 console.log("\n  agent    cli      status  head     change");
 console.log(`  ${"-".repeat(72)}`);
 for (const r of results) {
  console.log(`  ${String(r.agent).padEnd(8)} ${String(r.cli).padEnd(8)} ${r.status.padEnd(7)} ${(r.head || "-").padEnd(8)} ${r.files || r.detail}`);
 }
 const ok = results.filter((r) => r.status === "ok").length;
 console.log(`\n  ${ok}/${results.length} real agents pushed a proposal -> ${PLATFORM}`);
 if (ok < 2) process.exitCode = 1;

 // Bust the /proposals KV gen BEFORE the verification reads below: the report embeds this
 // read, and queue-driven invalidation is 1.5-4 min (a bust after the report would leave it
 // showing pre-push counts). Must also stay AFTER the last push so no new stale window opens.
 await bustProposalsCache("real-agents");

 // ---- platform verification -------------------------------------------
 // Always re-check all four: a `--only` run still has to prove the whole set.
 const repos = TASKS.map((t) => t.name).join(",");
 const q = `base=${baseline}&repos=${repos}`;
 const proposalsRes = await fetch(`${PLATFORM}/proposals?${q}`).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

 // The patch proves the proposal is the agent's own work, not a scripted edit.
 const patches = {};
 for (const repo of repos.split(",")) {
  const cs = await fetch(`${PLATFORM}/changes?repo=${repo}&base=${baseline}`).then((r) => r.json()).catch(() => ({}));
  patches[repo] = (cs.changeSet?.files ?? [])
   .map((f) => f.patch)
   .filter(Boolean)
   .join("\n");
 }
 writeReport({ statuses, results, proposalsRes, assignments, patches });
}

const HISTORY_FILE = join(WORK_ROOT, "runs.json");

/** Last known result per agent, so a `--only` retry does not erase earlier rows. */
function readRunHistory() {
 if (!existsSync(HISTORY_FILE)) return new Map();
 try {
  return new Map(JSON.parse(readFileSync(HISTORY_FILE, "utf8")));
 } catch {
  return new Map();
 }
}

function writeReport({ statuses, results, proposalsRes, assignments, patches }) {
 const props = proposalsRes?.proposals ?? [];
 const conflicts = proposalsRes?.conflicts ?? [];
 const authPair = conflicts.filter((c) =>
  c.repos.includes("agent-1") && c.repos.includes("agent-2") && c.file === "src/auth.ts",
 );

 const lines = [];
 lines.push("# nextgit — real agents runner report");
 lines.push("");
 lines.push(`Generated: ${new Date().toISOString()}`);
 lines.push("");
 lines.push("## CLI status table");
 lines.push("");
 lines.push("`usable` = headless run created a file in a throwaway scratch dir (artifact checked on disk, not CLI self-report).");
 lines.push("");
 lines.push(cliTable(statuses));
 lines.push("");
 lines.push("## Agent runs");
 lines.push("");
 // A `--only` retry must not erase the earlier run's rows, so the table is
 // merged by agent name and keyed on the platform-visible head.
 const prev = readRunHistory();
 for (const r of results) prev.set(r.agent, r);
 lines.push("| agent | cli | task | status | head | committed by | files |");
 lines.push("|---|---|---|---|---|---|---|");
 for (const r of [...prev.values()].sort((a, b) => a.agent.localeCompare(b.agent))) {
  lines.push(
   `| ${r.agent} | ${r.cli}${r.fallbackFrom ? ` (fallback from ${r.fallbackFrom})` : ""} | ${r.task} | ${r.status} | ${r.head || "-"} | ${r.committedByRunner ? "runner" : r.status === "ok" ? "agent" : "-"} | ${(r.files || r.detail).replace(/\|/g, "\\|")} |`,
  );
 }
 lines.push("");
 lines.push("Full per-agent stdout/stderr: `/tmp/real-agents/<agent>.log` and `.log.err`.");
 lines.push("");
 lines.push("## Real agent patches (`GET /changes`)");
 lines.push("");
 for (const [repo, cs] of Object.entries(patches)) {
  lines.push(`### ${repo}`);
  lines.push("");
  lines.push("```diff");
  lines.push(cs || "(no patch — secret-class or unchanged)");
  lines.push("```");
  lines.push("");
 }
 writeFileSync(HISTORY_FILE, JSON.stringify([...prev], null, 2));
 lines.push("");
 lines.push("## Platform verification (curl)");
 lines.push("");
 lines.push("`GET /proposals?base=demo&repos=agent-1,agent-2,agent-3,agent-4`");
 lines.push("");
 lines.push("```json");
 lines.push(JSON.stringify(proposalsRes, null, 2));
 lines.push("```");
 lines.push("");
 lines.push(`**agent-1 x agent-2 text-conflict on src/auth.ts:** ${authPair.length ? "YES" : "no"}`);
 if (authPair.length) lines.push("```json\n" + JSON.stringify(authPair, null, 2) + "\n```");
 lines.push("");
 lines.push("## Assignments");
 lines.push("");
 for (const a of assignments) lines.push(`- ${a.name} [${a.cli}] ${a.prompt}`);
 lines.push("");

 mkdirSync(WORK_ROOT, { recursive: true });
 writeFileSync(join(WORK_ROOT, "report.md"), lines.join("\n"));
 console.log(`\n  report -> ${join(WORK_ROOT, "report.md")}`);
 console.log(`  proposals visible: ${props.length}, conflict rows: ${conflicts.length}, agent-1x2 auth conflict: ${authPair.length ? "yes" : "no"}`);
}

if (process.argv.includes("--list-harnesses")) {
 if (registryErrors.length) {
  console.error("harness registry errors:");
  for (const e of registryErrors) console.error(`  ${e}`);
  process.exitCode = 1;
 }
 console.log(JSON.stringify(CANDIDATES, null, 2));
 process.exit(registryErrors.length ? 1 : 0);
}
await main();