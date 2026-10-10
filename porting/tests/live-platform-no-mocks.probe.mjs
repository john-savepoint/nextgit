#!/usr/bin/env node
// live-platform-no-mocks.probe.mjs — durable contract test for the
// nextgit-e10 acceptance: the demo path is the LIVE Cloudflare
// Worker + the live Artifacts namespace, with no mocks anywhere.
// This probe re-runs the frozen edge check as a durable assertion
// (the one-off curl in the plan phase was evidence, not a contract)
// and observes fresh clone/push traffic against the live Artifacts
// git-over-HTTPS remote. Arms:
//   (A) edge identity — GET /health -> 200, `server: cloudflare`,
//       a `cf-ray:` edge header, and the exact body
//       {"ok":true,"service":"nextgit-platform","namespace":"nextgit"}
//       — 3-attempt transport retry (this WSL2 box's edge connect
//       latency occasionally busts undici's connect budget;
//       demo-verify.mjs:35-66 shape).
//   (B) wrangler.jsonc declaration pin — name nextgit-platform,
//       compatibility_date 2026-09-01, ARTIFACTS binding namespace
//       nextgit, no compatibility_flags/nodejs_compat (the shipped
//       declaration the live edge serves).
//   (C) negative scan — platform/scripts contains no miniflare,
//       `wrangler dev`, `localhost:`, or `127.0.0.1` (the demo
//       scripts drive the live control plane + live git remote,
//       never a local emulator).
//   (D) rehearsal — REST-fork a SCRATCH agent-ln-1 repo from demo,
//       mint a write token, git clone with http.extraHeader Bearer,
//       one real commit, push origin HEAD:refs/heads/main, assert
//       ls-remote === rev-parse (the push landed on the live
//       remote), print a rehearsal excerpt.
//   (E) delete the scratch repo; NEVER touches demo or agent-1..5.
// Zero product-code changes. Exit 0 = all green.
// Run: node porting/tests/live-platform-no-mocks.probe.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-live-platform-no-mocks-probe/1.0";
const EXPECTED_BODY = { ok: true, service: "nextgit-platform", namespace: "nextgit" };
const SCRATCH_REPO = "agent-ln-1";   // scratch-only: ln- prefix, never agent-1..5

// Scratch-only guard: the probe must never operate outside its ln-*
// scratch repo.
if (!SCRATCH_REPO.startsWith("agent-ln-")) {
  throw new Error(`scratch-only probe: refusing ${SCRATCH_REPO}`);
}
if (/^agent-[1-5]$/.test(SCRATCH_REPO)) {
  throw new Error(`scratch-only probe: refusing collision with live ${SCRATCH_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// apiToken(): copied from land-beat-receipt.probe.mjs:93-107
// (CLOUDFLARE_API_TOKEN env, else wrangler OAuth toml).
let cachedToken = null;
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (cachedToken) return cachedToken;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return (cachedToken = m[1]);
    }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const apiHeaders = () => ({ Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" });
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const gitAuthEnv = (token) => ({ ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });

// api(method, path, body): copied from land-beat-receipt.probe.mjs:119-150
// — 3 transport retries, 30s timeout; on 401 (when not using the env
// token) runs `wrangler whoami` to refresh the OAuth toml in place and
// retries once — a mid-run token expiry must not false-RED the probe.
// HTTP statuses are data, never retried.
async function api(method, path, body) {
  let last;
  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers: apiHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && !refreshed && !process.env.CLOUDFLARE_API_TOKEN) {
        refreshed = true;
        cachedToken = null;
        console.log(`  auth 401 on ${method} ${path} -> wrangler whoami refresh, retrying`);
        try {
          execFileSync("wrangler", ["whoami"], { stdio: "ignore", timeout: 60_000 });
        } catch (refreshErr) {
          last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh the OAuth token: ${refreshErr?.message ?? refreshErr}`);
          break;
        }
        continue;
      }
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err; // transport failure only
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

// fork(src, name): copied from land-beat-receipt.probe.mjs:157-168 —
// POST `/repos/${src}/fork` { name, default_branch_only: true }; 5
// attempts with 1.5s*attempt backoff on the transient creation lag
// ("already exists" 10201 right after an async DELETE, 404/5xx while
// a just-forked repo settles, the plan-recorded transient 403); other
// errors throw.
async function fork(src, name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("POST", `/repos/${src}/fork`, { name, default_branch_only: true });
    if (r.success) return r.result;
    last = new Error(`fork ${src} -> ${name} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
    const transient = /already exists/i.test(last.message) || r.status === 403 || r.status === 404 || r.status >= 500;
    if (!transient) throw last;
    await sleep(1500 * attempt);
  }
  throw last;
}

// mint(repo): POST `/tokens` { repo, scope: "write", ttl: 3600 } ->
// result.plaintext. Bounded transient retry MIRRORING fork() above:
// 404 10200 "Repository not found" while a just-forked repo settles,
// 403/5xx control-plane lag, 10201 "already exists" from an
// async-DELETE phantom — the same creation-lag classes fork() absorbs.
// Other errors throw.
async function mint(repo) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
    if (r.success) return r.result.plaintext;
    last = new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
    const transient = /already exists/i.test(last.message) || r.status === 403 || r.status === 404 || r.status >= 500;
    if (!transient) throw last;
    await sleep(1500 * attempt);
  }
  throw last;
}

// deleteRepo(name): copied from land-beat-receipt.probe.mjs:191-200 —
// bounded 5xx retry (3 attempts); 200/202 = accepted, 404 = already
// gone; every other status returns as-is and the caller fails closed
// on it.
async function deleteRepo(name) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await api("DELETE", `/repos/${name}`);
    if (r.status < 500) return r;
    last = r;
    await sleep(1500 * attempt);
  }
  return last;
}

// walkScripts(root): every .mjs/.js/.ts under root, recursively —
// the scan surface for arm (C). An unreadable dir reads as empty.
function walkScripts(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur); } catch { continue; }
    for (const ent of entries) {
      const full = join(cur, ent);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) stack.push(full);
      else if (/\.(mjs|js|ts)$/.test(ent)) out.push(full);
    }
  }
  return out;
}

let dir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${SCRATCH_REPO} (rehearsal — never demo / agent-1..5)\n`);

  // -------------------------------------------------------------------
  // (A) Edge identity — the frozen check_cmd, re-run as a contract.
  //     3-attempt transport retry (connect-stall absorption,
  //     demo-verify.mjs:35-66); HTTP status and body are data.
  // -------------------------------------------------------------------
  let health = null;
  let lastHealthErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${PLATFORM}/health`, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      health = { status: res.status, headers: res.headers, text, json };
      break;
    } catch (err) {
      lastHealthErr = err; // transport failure only — retry
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  if (!health) throw lastHealthErr ?? new Error("GET /health failed with no error");

  check("(A) GET /health -> 200", health.status === 200, `HTTP ${health.status}`);
  check("(A) server: cloudflare", (health.headers.get("server") ?? "").trim().toLowerCase() === "cloudflare", `server=${health.headers.get("server")}`);
  const cfRay = health.headers.get("cf-ray") ?? "";
  check("(A) cf-ray edge header present", /^[0-9a-f]+-[A-Z]{3}$/.test(cfRay.trim()), `cf-ray=${cfRay}`);
  check("(A) exact body {ok,service,namespace}", JSON.stringify(health.json) === JSON.stringify(EXPECTED_BODY), health.text);
  const edgeLine = `cf-ray: ${cfRay.trim()} — GET ${PLATFORM}/health -> ${health.status} ${health.text}`;
  console.log(`  edge  ${edgeLine}`);

  // -------------------------------------------------------------------
  // (B) wrangler.jsonc declaration pin — the shipped config the live
  //     edge serves (parsed with the repo's jsonc strip convention;
  //     runtime-pin.test.mjs:22-25 shape).
  // -------------------------------------------------------------------
  const wranglerRaw = readFileSync(fileURLToPath(new URL("../../platform/wrangler.jsonc", import.meta.url)), "utf8");
  const wrangler = JSON.parse(wranglerRaw.replace(/\/\/.*$/gm, ""));
  const artifactsBinding = (wrangler.artifacts ?? []).find((a) => a.binding === "ARTIFACTS");
  check("(B) wrangler.jsonc name === nextgit-platform", wrangler.name === "nextgit-platform", `name=${wrangler.name}`);
  check("(B) wrangler.jsonc compatibility_date === 2026-09-01", wrangler.compatibility_date === "2026-09-01", `compatibility_date=${wrangler.compatibility_date}`);
  check("(B) ARTIFACTS binding namespace === nextgit", artifactsBinding?.namespace === "nextgit", `artifacts=${JSON.stringify(wrangler.artifacts)}`);
  const hasCompatFlags = "compatibility_flags" in wrangler;
  check("(B) no compatibility_flags field", !hasCompatFlags, `field present: ${hasCompatFlags}`);
  check("(B) no nodejs_compat", !(wrangler.compatibility_flags || []).includes("nodejs_compat"), JSON.stringify(wrangler.compatibility_flags ?? []));

  // -------------------------------------------------------------------
  // (C) Negative scan — platform/scripts drives the LIVE control
  //     plane and LIVE git remote only. No local emulator anywhere.
  // -------------------------------------------------------------------
  const scriptsDir = fileURLToPath(new URL("../../platform/scripts", import.meta.url));
  const LOCAL_EMU_RE = /miniflare|wrangler\s+dev|localhost:|127\.0\.0\.1/;
  const hits = [];
  for (const f of walkScripts(scriptsDir)) {
    const text = readFileSync(f, "utf8");
    const m = text.match(LOCAL_EMU_RE);
    if (m) hits.push(`${f.slice(scriptsDir.length + 1)}: ${m[0]}`);
  }
  check("(C) platform/scripts free of miniflare / 'wrangler dev' / localhost: / 127.0.0.1", hits.length === 0, hits.join("; "));

  // -------------------------------------------------------------------
  // (D) Rehearsal — fresh clone/push against the LIVE Artifacts
  //     remote, through the same fabric the demo scripts use
  //     (agents.mjs:213-275): REST-fork a scratch repo from demo,
  //     mint a write token, clone with http.extraHeader Bearer, one
  //     real commit, push origin HEAD:refs/heads/main, then assert
  //     ls-remote === rev-parse.
  // -------------------------------------------------------------------
  // Pre-clean the scratch repo (idempotent re-runs); sleep only when
  // something was actually deleted (post-delete settle lag —
  // land-hardening.probe.mjs:192-201).
  let cleaned = false;
  {
    const r = await deleteRepo(SCRATCH_REPO);
    console.log(`pre-clean DELETE ${SCRATCH_REPO}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);

  const forkResult = await fork("demo", SCRATCH_REPO);
  console.log(`forked ${SCRATCH_REPO} from demo -> ${forkResult.remote ?? "(remote url omitted)"}`);
  // Wait for the fork to MATERIALIZE before minting/cloning: cloning
  // or minting mid-fork can yield an empty/not-found repo (observed
  // 2026-10-10 — secret-fixture.mjs:97-103 pattern,
  // colliding-land-refusal.probe.mjs:230).
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const page = await api("GET", "/repos?limit=200");
    const rows = page.result ?? [];
    if (rows.some((r) => r.name === SCRATCH_REPO && r.status === "ready")) { ready = true; break; }
    await sleep(1000);
  }
  check("(D) scratch repo materialized (status ready)", ready, "repo listing never showed status ready within 30s");

  const token = await mint(SCRATCH_REPO);
  // Token shape is versioned by the platform (SKILL "Token shape
  // matters": art_v1_<hex>, later art_v2_x_<hex>) — never assume a
  // uniform shape across methods or versions; assert the family only.
  check("(D) minted write token (art_v… shape)", /^art_v[0-9]+_[a-z0-9]+/i.test(token), `shape=${token.slice(0, 12)}…`);
  const env = gitAuthEnv(token);

  dir = mkdtempSync(join(tmpdir(), "nextgit-ln-rehearsal-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${SCRATCH_REPO}.git`, dir);
  git("config", "user.name", "live-platform-no-mocks-probe");
  git("config", "user.email", "probe@nextgit.dev");
  // Ignore rules must come from the repo alone so the staged tree is
  // deterministic (agents.mjs:249 — the host gitignore would
  // otherwise silently skip a promised path).
  git("config", "core.excludesFile", "/dev/null");

  // One real commit — a pure-text append to the baseline's src/store.ts
  // (anchored, fail-loudly), mirroring the agent-3 transform shape
  // (agents.mjs:121-147) so a drifted baseline fails loudly instead
  // of silently producing a no-op commit.
  const STORE_PATH = "src/store.ts";
  const ANCHOR = "const rows = new Map<string, Row<unknown>>();";
  const ADDITION = `
// Rehearsal marker: live-platform-no-mocks.probe.mjs wrote this line
// against the live Artifacts remote (no mocks).`;
  const storeText = readFileSync(join(dir, STORE_PATH), "utf8");
  const lines = storeText.split("\n");
  const anchorIdx = lines.findIndex((l) => l.includes(ANCHOR));
  if (anchorIdx < 0) throw new Error(`anchor not found in baseline: ${ANCHOR}`);
  lines.splice(anchorIdx + 1, 0, ADDITION);
  writeFileSync(join(dir, STORE_PATH), lines.join("\n"));
  git("add", "-A");
  const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMRT");
  if (!staged.split("\n").filter(Boolean).includes(STORE_PATH)) {
    throw new Error(`git ignored intended path: ${STORE_PATH}`);
  }
  git("commit", "-m", `${SCRATCH_REPO}: Rehearsal: live remote push`);
  const localRev = git("rev-parse", "HEAD");
  console.log(`commit ${localRev} (local)`);
  git("push", "origin", "HEAD:refs/heads/main");

  // ls-remote === rev-parse — the push landed on the live remote.
  const remoteRev = git("ls-remote", `${gitBase}/${SCRATCH_REPO}.git`, "refs/heads/main").split("\t")[0];
  check("(D) git push origin HEAD:refs/heads/main -> ls-remote === rev-parse", remoteRev === localRev, `ls-remote=${remoteRev} rev-parse=${localRev}`);

  // The rehearsal excerpt the verify phase archives to
  // rehearsal-log.txt — every fact an observer needs, zero
  // credential-shaped material.
  console.log("\n--- rehearsal excerpt ---");
  console.log(`platform   ${PLATFORM}/health`);
  console.log(`edge       ${edgeLine}`);
  console.log(`namespace  ${NAMESPACE} (account ${ACCOUNT_ID})`);
  console.log(`scratch    ${SCRATCH_REPO} forked from demo`);
  console.log(`remote     ${gitBase}/${SCRATCH_REPO}.git`);
  console.log(`clone      git clone <remote> (http.extraHeader Authorization: Bearer art_v…)`);
  console.log(`commit     ${localRev}`);
  console.log(`push       git push origin HEAD:refs/heads/main`);
  console.log(`ls-remote  ${remoteRev} === rev-parse ${localRev}`);
  console.log(`file       M ${STORE_PATH}`);
  console.log("--- end excerpt ---");

  // -------------------------------------------------------------------
  // (E) Delete the scratch repo. Never touches demo or agent-1..5.
  // -------------------------------------------------------------------
  {
    const r = await deleteRepo(SCRATCH_REPO);
    console.log(`cleanup DELETE ${SCRATCH_REPO}: HTTP ${r.status}`);
    check("(E) scratch repo deleted (200/202/404)", r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
  }
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  // Cleanup on any exit path (even when an assertion or the rehearsal
  // itself failed): the scratch repo is deleted (200/202/404 all
  // count as gone) and the temp clone removed. The demo repos are
  // NEVER touched by this probe.
  try {
    const r = await deleteRepo(SCRATCH_REPO);
    console.log(`finally DELETE ${SCRATCH_REPO}: HTTP ${r.status}`);
    check("(cleanup) scratch repo gone", r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
  } catch (e) {
    check("(cleanup) scratch repo gone", false, String(e));
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — live-platform-no-mocks probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
