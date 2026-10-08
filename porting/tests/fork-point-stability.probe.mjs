#!/usr/bin/env node
// fork-point-stability.probe.mjs — LIVE probe for the fork-point change-set
// stability invariant (FR-10 / CONTRACT.md §Fork point).
//
// Scratch chain ONLY: REST-fork demo -> demo-e2s-base -> agent-e2s-1.
// The probe proves that an UNCHANGED proposal's GET /changes body is byte-identical
// before and after the proposal is landed onto the base (which advances the base
// head). The change-set stays pinned to the fork point, so base.sha does not move.
//
// Flow:
//   1. pre-clean DELETE both scratch repos -> fork demo -> demo-e2s-base -> fork
//      demo-e2s-base -> agent-e2s-1.
//   2. Clone agent-e2s-1, add + commit a single file, push; capture C_PROPOSAL.
//   3. GET /changes (pre-land) -> serialize body -> bodyPre (sha256 reference).
//   4. POST /land the proposal onto demo-e2s-base (baseHead = H0, the fork point).
//   5. GET /changes (post-land) -> serialize body -> bodyPost.
//   6. Assert bodyPre === bodyPost (byte-identical), base.sha === H0 in both,
//      and the two sha256 digests are equal.
//   7. Cleanup: DELETE both repos, rmSync local clones.
//
// Never lands into `demo`; never touches agent-1..5 or any demo-lh-* / agent-lh-* chain.
// Run: node porting/tests/fork-point-stability.probe.mjs
// Exit 0 = all green.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-fork-point-stability-probe/1.0";
const BASE_REPO = "demo-e2s-base";
const PROPOSAL_REPO = "agent-e2s-1";
const SHA_ZERO = "0".repeat(40);

// Scratch-only guard: the probe must never operate outside its e2s chain.
if (!BASE_REPO.startsWith("demo-e2s-") || !PROPOSAL_REPO.startsWith("agent-e2s-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// api(method, path, body): fetch against `${apiBase}` with transport retries, 401
// refresh via `wrangler whoami`, 30s timeout; returns { status, success, result, raw }.
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
          last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh: ${refreshErr?.message ?? refreshErr}`);
          break;
        }
        continue;
      }
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err;
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

// fork(src, name): POST `/repos/${src}/fork` { name, default_branch_only: true };
// 5 attempts with backoff on transient creation lag.
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

// mint(repo): POST `/tokens` { repo, scope: "write", ttl: 3600 } -> result.plaintext.
async function mint(repo) {
  const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.result.plaintext;
}

// deleteRepo(name): DELETE with bounded retry on 5xx.
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

// land(body): POST /land with a 120s timeout.
async function land(body) {
  const res = await fetch(`${PLATFORM}/land`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, json };
}

// getJson(path): read-only GET against the platform (the /changes arm).
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  GET ${path} -> HTTP ${res.status}`);
  return { status: res.status, json };
}

const { existsSync } = await import("node:fs");

const changesQuery = (repo, base) =>
  `/changes?repo=${repo}&base=${base}&ref=main&baseRef=main`;

let dir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);

  // --- Setup: pre-clean both scratch repos, then fork demo -> base -> proposal
  let cleaned = false;
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    const r = await deleteRepo(name);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);
  await fork("demo", BASE_REPO);
  await fork(BASE_REPO, PROPOSAL_REPO);

  const proposalToken = await mint(PROPOSAL_REPO);
  const baseEnv = gitAuthEnv(await mint(BASE_REPO));
  const lsBase = () => execFileSync("git", ["ls-remote", `${gitBase}/${BASE_REPO}.git`, "refs/heads/main"], { env: baseEnv, encoding: "utf8" }).trim().split("\t")[0];

  // --- H0: the fork point (proposal HEAD at fork time = demo-e2s-base HEAD)
  const H0 = lsBase();
  console.log(`H0 (fork point) ${H0}\n`);

  // --- Step 1: clone proposal, add a single committed file change, push
  dir = mkdtempSync(join(tmpdir(), "nextgit-fps-probe-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "fork-point-stability-probe");
  git("config", "user.email", "probe@nextgit.dev");

  writeFileSync(join(dir, "fork-point-stability-probe.txt"), `fork-point-stability probe ${new Date().toISOString()}\n`);
  git("add", "-A");
  git("commit", "-m", "probe: fork-point-stability edit");
  git("push", "origin", "HEAD:refs/heads/main");
  const C_PROPOSAL = git("rev-parse", "HEAD");
  console.log(`C_PROPOSAL ${C_PROPOSAL}\n`);

  // --- Step 2: capture /changes (pre-land) — byte-identity reference
  console.log("(1) GET /changes (pre-land)");
  const pre = await getJson(changesQuery(PROPOSAL_REPO, BASE_REPO));
  if (pre.status !== 200 || pre.json?.ok !== true) throw new Error(`pre-land /changes failed: HTTP ${pre.status} ${JSON.stringify(pre.json)}`);
  const bodyPre = JSON.stringify(pre.json);
  const digestPre = createHash("sha256").update(bodyPre).digest("hex");
  console.log(`  body sha256: ${digestPre} (len ${bodyPre.length})`);

  // Assert the pre-land change-set is pinned to the fork point H0.
  const csPre = pre.json.changeSet;
  check("(pre) base.sha === fork point H0", csPre?.base?.sha === H0, `got ${csPre?.base?.sha}`);
  check("(pre) base.sha is 40-hex", /^[0-9a-f]{40}$/.test(String(csPre?.base?.sha)), String(csPre?.base?.sha));

  // --- Step 3: land the proposal onto the base (reviewed heads anchored at H0)
  console.log("(2) POST /land");
  const landRes = await land({
    base: BASE_REPO,
    repos: [PROPOSAL_REPO],
    baseRef: "main",
    ref: "main",
    reviewed: { baseHead: H0, heads: { [PROPOSAL_REPO]: C_PROPOSAL } },
  });
  check("(land) 200 ok", landRes.status === 200 && landRes.json?.ok === true, JSON.stringify(landRes.json));

  // Confirm the base head moved (the land pushed something to the base).
  const H1 = lsBase();
  check("(land) base advanced", H1 !== H0 && H1 !== SHA_ZERO, `H0 ${H0} -> H1 ${H1}`);

  // --- Step 4: capture /changes (post-land) — proposal repo is UNCHANGED
  console.log("(3) GET /changes (post-land)");
  const post = await getJson(changesQuery(PROPOSAL_REPO, BASE_REPO));
  if (post.status !== 200 || post.json?.ok !== true) throw new Error(`post-land /changes failed: HTTP ${post.status} ${JSON.stringify(post.json)}`);
  const bodyPost = JSON.stringify(post.json);
  const digestPost = createHash("sha256").update(bodyPost).digest("hex");
  console.log(`  body sha256: ${digestPost} (len ${bodyPost.length})`);

  // --- Step 5: the invariant assertions
  const csPost = post.json.changeSet;
  check("(post) base.sha === fork point H0 (unchanged by land)", csPost?.base?.sha === H0, `got ${csPost?.base?.sha}`);
  check("(post) base.sha === pre-land base.sha", csPost?.base?.sha === csPre?.base?.sha, `got ${csPost?.base?.sha} vs ${csPre?.base?.sha}`);
  check("(byte) sha256 digests equal", digestPre === digestPost, `${digestPre} vs ${digestPost}`);
  check("(byte) bodyPre === bodyPost (string identity)", bodyPre === bodyPost, `lengths ${bodyPre.length} vs ${bodyPost.length}`);
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    try {
      const r = await deleteRepo(name);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      check(`(cleanup) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (err) {
      check(`(cleanup) deleted ${name}`, false, String(err));
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — fork-point-stability probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
