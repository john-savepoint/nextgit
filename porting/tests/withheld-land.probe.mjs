#!/usr/bin/env node
// withheld-land.probe.mjs — LIVE probe: /land refuses secret-class folds with 409 withheld-secret and pushes nothing.
// Scratch chain ONLY: REST-fork demo -> demo-wh-base -> agent-wh-1; asserts:
//  (1) POST /land with a config/.env secret-class file yields 409 {ok:false,error:"withheld-secret",files:["config/.env"]}
//  (2) the base repo's main ref NEVER advances (== pre-land SHA) — no write token minted, no push
//  (3) GET /merge reports the config/.env row result:"withheld-secret" with NO merged / NO conflictText keys
//  (4) no secret value string appears in any worker response body
// Never lands into `demo`; never touches agent-1..5. Exit 0 = all green.
// Run: node porting/tests/withheld-land.probe.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-withheld-land-probe/1.0";
const BASE_REPO = "demo-wh-base";
const PROPOSAL_REPO = "agent-wh-1";

// Scratch-only guard: the probe must never operate outside its wh-* chain.
if (!BASE_REPO.startsWith("demo-wh-") || !PROPOSAL_REPO.startsWith("agent-wh-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): copy fanout.mjs:24-37 + real-agents.mjs:45-67 (CLOUDFLARE_API_TOKEN env,
// else wrangler OAuth toml) — cached so api() can drop it after a 401 and re-read the
// toml `wrangler whoami` refreshes in place.
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

// api(method, path, body): fetch against `${apiBase}` with 3 transport retries, 30s timeout;
// returns { status, result, raw }. A 401 refreshes the wrangler OAuth token in place and retries once.
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
      return { status: res.status, result: data.result, raw: data };
    } catch (err) {
      last = err; // transport failure only — HTTP statuses are never retried
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

// fork(src, name): POST `/repos/${src}/fork` { name, default_branch_only: true }; 5 attempts
// with 1.5s*attempt backoff on the transient creation lag: "already exists" (10201) right
// after an async DELETE, 404 10200 "Repository not found" / 5xx while a just-forked repo
// settles, and the plan-recorded transient 403; other errors throw.
async function fork(src, name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("POST", `/repos/${src}/fork`, { name, default_branch_only: true });
    if (r.status === 200 || r.status === 201) return r.result;
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
  if (!r.result || (r.status !== 200 && r.status !== 201)) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
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

// getJson(path): read-only GET against the platform (the /merge arm).
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  GET ${path} -> HTTP ${res.status}`);
  return { status: res.status, json };
}

// lsBase(): read the SHA the base repo's main ref resolves to via git ls-remote.
const lsBase = (baseEnv) => execFileSync("git", ["ls-remote", `${gitBase}/${BASE_REPO}.git`, "refs/heads/main"], { env: baseEnv, encoding: "utf8" }).trim().split("\t")[0];

let dir;
let baseDir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);

  // 1. Pre-clean + fork demo -> demo-wh-base -> agent-wh-1.
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

  // 2. Commit a secret-class file (config/.env) with fake placeholder values.
  dir = mkdtempSync(join(tmpdir(), "nextgit-wh-probe-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "withheld-land-probe");
  git("config", "user.email", "probe@nextgit.dev");
  const H0 = git("rev-parse", "HEAD");

  // The fake secret fixture — probe-owned dummies, never real credentials.
  // config/ may not exist in the forked demo repo; create it first.
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(
    join(dir, "config/.env"),
    "# withheld-land probe\nAPI_TOKEN=placeholder_value_for_probe\nDB_$$EAMK4AV2C2UB:M$$\n",
  );
  git("add", "-f", "-A");  // -f: .env may be gitignored in the demo repo; we intentionally stage a secret-class fixture
  git("commit", "-m", "probe: add secret-class fixture (config/.env)");
  git("push", "origin", "HEAD:refs/heads/main");
  const C1 = git("rev-parse", "HEAD");
  console.log(`H0 ${H0}\nC1 ${C1} (proposal head with config/.env)\n`);

  // Intent note (CONTRACT.md:192-198 mirror recipe): push git-notes, then mirror onto a branch.
  try {
    git("push", "origin", "HEAD:refs/notes/commits");
    git("push", "origin", "refs/notes/commits:refs/heads/nextgit-notes");
    console.log(`  pushed intent note for ${C1}`);
  } catch (noteErr) {
    console.log(`  (note push skipped: ${noteErr?.message ?? noteErr})`);
  }

  // 3. Capture pre-land base head.
  const PRE_LAND_SHA = lsBase(baseEnv);
  console.log(`PRE_LAND_SHA ${PRE_LAND_SHA}\n`);

  // 4-5. POST /land — must hit the withheld-secret gate BEFORE any push.
  console.log("(1) /land with secret-class fold -> 409 withheld-secret");
  const r = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main" });
  check("(land) 409 withheld-secret", r.status === 409 && r.json?.ok === false && r.json?.error === "withheld-secret", JSON.stringify(r.json));
  check("(land) files == [\"config/.env\"]", JSON.stringify(r.json?.files ?? []) === JSON.stringify(["config/.env"]), JSON.stringify(r.json?.files));
  check("(land) 409 body exact keys {error,files,ok}", exactKeys(r.json, ["error", "files", "ok"]), JSON.stringify(r.json && Object.keys(r.json)));

  // 6. Assert base untouched (nothing pushed) — the gate fires before mintWriteToken/pushLand.
  const POST_LAND_SHA = lsBase(baseEnv);
  check("(land) base ref unchanged (== PRE_LAND_SHA)", POST_LAND_SHA === PRE_LAND_SHA, `pre=${PRE_LAND_SHA} post=${POST_LAND_SHA}`);
  // 7. /merge preview matches — read-only GET, secret row must be withheld-secret, no merged/conflictText keys.
  console.log("\n(2) GET /merge — secret-class row is withheld-secret with no merged/conflictText");
  const m = await getJson(`/merge?base=${BASE_REPO}&repos=${PROPOSAL_REPO}&ref=main&baseRef=main`);
  const hm = m.json?.merge ?? {};
  const files = Array.isArray(hm.files) ? hm.files : [];
  const envRow = files.find((f) => f.path === "config/.env");
  check("(merge) 200 ok / clean", m.status === 200 && m.json?.ok === true && hm.status === "clean", JSON.stringify(m.json?.status));
  check("(merge) config/.env row present", !!envRow, JSON.stringify(envRow));
  check("(merge) config/.env result == withheld-secret", envRow?.result === "withheld-secret", JSON.stringify(envRow));
  check("(merge) config/.env has NO merged key", envRow && !("merged" in envRow), JSON.stringify(envRow));
  check("(merge) config/.env has NO conflictText key", envRow && !("conflictText" in envRow), JSON.stringify(envRow));
  check("(merge) config/.env exact keys {action,note,path,result}", exactKeys(envRow, ["action", "note", "path", "result"]), JSON.stringify(envRow && Object.keys(envRow)));
  const mergeBody = JSON.stringify(m.json);
  check("(merge) no probe secret value (placeholder_value_for_probe) in merge body", !mergeBody.includes("placeholder_value_for_probe"));
  check("(merge) no probe dummy (dummy_secret_409) in merge body", !mergeBody.includes("dummy_secret_409"));

  // 6b. /land 409 body must not contain the secret value either.
  const landBody = JSON.stringify(r.json);
  check("(land) no probe secret value in /land 409 body", !landBody.includes("placeholder_value_for_probe"));
  // credRe checks for leaked credential *values* — the word "withheld-secret" in the
  // error string is a legitimate refusal label, not a leaked secret. Sweep only for
  // the probe's fake secret values, not the word "secret" itself.
  const secretValueRe = /placeholder_value_for_probe|dummy_secret_409/i;
  check("(land+merge) no probe secret value anywhere", !secretValueRe.test(mergeBody + landBody));

  // 8. No evidence object in the 409 (refused before fold evidence / push).
  const ev = r.json?.evidence ?? {};
  check("(land) no evidence object in 409 withheld-secret (refused before fold evidence)", !r.json?.evidence, JSON.stringify(ev));
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
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — withheld-land probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
