#!/usr/bin/env node
// land-feed.probe.mjs — LIVE probe: a landing records its baseline move in the
// live feed (nextgit-e6). Scratch chain ONLY: REST-fork demo -> demo-lf-base
// -> agent-lf-1; one real commit on the proposal; one clean POST /land with
// the true reviewed heads; then polls GET /events (bounded) for the
// repo.pushed event whose {repo, ref, after} 4-tuple is exactly
// {demo-lf-base, main, landed.commit}. Asserts: (1) /land -> 200 with
// landed.commit (40-hex) and no credential-shaped field in the body; (2) the
// feed event matches the land's own commit — proving the LANDING's move is
// what the feed recorded (the land route's best-effort inline recordEvent and
// the queue consumer share the dedup key type|repo|ref|after, so either writer
// satisfies the criterion — the poll absorbs both); event has an ISO `at` and
// no credential-shaped field; (3) both scratch repos deleted on exit
// (200/202/404 all count as gone) and the temp clone removed. Never lands
// into `demo`; never touches agent-1..5. Exit 0 = all green.
// Run: node porting/tests/land-feed.probe.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-land-feed-probe/1.0";
const BASE_REPO = "demo-lf-base";     // scratch-only: lf- prefix, never demo
const PROPOSAL_REPO = "agent-lf-1";      // scratch-only: lf- prefix, never agent-1..5

// Scratch-only guard: the probe must never operate outside its lf-* chain.
if (!BASE_REPO.startsWith("demo-lf-") || !PROPOSAL_REPO.startsWith("agent-lf-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): copied from land-hardening.probe.mjs:65-83 (CLOUDFLARE_API_TOKEN
// env, else wrangler OAuth toml) — cached so api() can drop it after a 401 and
// re-read the toml `wrangler whoami` refreshes in place.
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

// api(method, path, body): copied from land-hardening.probe.mjs:85-120 — 3
// transport retries, 30s timeout; on 401 (when not using the env token) runs
// `wrangler whoami` to refresh the OAuth toml in place and retries once — a
// mid-run token expiry must not false-RED the probe. HTTP statuses are data,
// never retried.
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

// fork(src, name): copied from land-hardening.probe.mjs:122-137 — POST
// `/repos/${src}/fork` { name, default_branch_only: true }; 5 attempts with
// 1.5s*attempt backoff on the transient creation lag ("already exists" 10201
// right after an async DELETE, 404/5xx while a just-forked repo settles, the
// plan-recorded transient 403); other errors throw.
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

// mint(repo): copied from land-hardening.probe.mjs:139-144 — POST `/tokens`
// { repo, scope: "write", ttl: 3600 } -> result.plaintext.
async function mint(repo) {
  const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.result.plaintext;
}

// deleteRepo(name): copied from land-hardening.probe.mjs:146-158 — bounded 5xx
// retry (3 attempts); 200/202 = accepted, 404 = already gone; every other
// status returns as-is and the caller fails closed on it.
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

// land(body): copied from land-hardening.probe.mjs:165-175 — POST ${PLATFORM}/land,
// 120s timeout, logs the full JSON.
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

// getJson(path): read-only GET against the platform (the /events arm) — copied
// from land-hardening.probe.mjs:177-186. Kept silent: the feed poll below
// bounds retries to ~75, so per-poll logging would flood the verdict.
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

let dir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);
  // 0. Pre-clean both scratch repos (idempotent re-runs); sleep 1200 ms only
  //    when something was actually deleted (post-delete settle lag —
  //    land-hardening.probe.mjs:192-201).
  let cleaned = false;
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    const r = await deleteRepo(name);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);
  await fork("demo", BASE_REPO);            // demo -> demo-lf-base
  await fork(BASE_REPO, PROPOSAL_REPO);     // demo-lf-base -> agent-lf-1

  const proposalToken = await mint(PROPOSAL_REPO);

  // 1. One real commit on the proposal (clone -> write lf-probe-1.txt ->
  //    commit -> push). H0 is the fork point = the base head at fork time,
  //    which the reviewed-heads gate requires for a clean single land.
  dir = mkdtempSync(join(tmpdir(), "nextgit-lf-probe-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "land-feed-probe");
  git("config", "user.email", "probe@nextgit.dev");
  const H0 = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "lf-probe-1.txt"), `land-feed probe ${new Date().toISOString()}\n`);
  git("add", "-A"); git("commit", "-m", "probe: feed verification commit"); git("push", "origin", "HEAD:refs/heads/main");
  const C1 = git("rev-parse", "HEAD");
  console.log(`H0 ${H0}\nC1 ${C1}\n`);

  // 2. Land: one clean land with the true reviewed heads (the reviewed-heads
  //    gate is the live 409-stale precondition; supplying the real heads
  //    keeps this a single land — the same happy-path shape as
  //    land-hardening.probe.mjs:222).
  console.log("(1) land with reviewed heads");
  const a = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: H0, heads: { [PROPOSAL_REPO]: C1 } } });
  check("(1) /land -> 200 ok", a.status === 200 && a.json?.ok === true);
  check("(1) landed.commit is 40-hex", /^[0-9a-f]{40}$/.test(a.json?.landed?.commit ?? ""), String(a.json?.landed?.commit));
  check("(1) success no credential field", !credRe.test(JSON.stringify(a.json)));
  const landedCommit = a.json?.landed?.commit;

  // 3. Poll GET /events (bounded: 150 s deadline, 2 s interval). The land
  //    route writes the event best-effort INLINE (index.ts:1221-1236, inside
  //    the 200 path) so the frame normally appears in seconds; the queue
  //    consumer (index.ts:1653-1676) is the backstop and can lag 1.5-4 min
  //    when idle. Both writers share the dedup key repo.pushed|<base>|main|
  //    <landed.commit> (recordEvent, index.ts:769-776), so whichever lands
  //    first writes and the other is a logged feed-dedup — either path alone
  //    satisfies the criterion, which is why the poll (not a fixed writer) is
  //    the correct verification shape. The matcher is the NORMALIZED exact
  //    string "repo.pushed" (normalizeEventType strips cf.artifacts.,
  //    index.ts:820-822) — never the cf.artifacts. prefix.
  let found = null;
  let r = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !found) {
    r = await getJson("/events");
    found = r.json?.events?.find((e) =>
      e?.type === "repo.pushed" && e?.repo === BASE_REPO &&
      e?.ref === "main" && e?.after === landedCommit) ?? null;
    if (!found) await sleep(2000);
  }
  check("(2) /events GET 200", r !== null && r.status === 200, r === null ? "never polled" : `HTTP ${r.status}`);
  check("(2) repo.pushed event matches repo/ref/after", !!found, found ? "" : `no repo.pushed|${BASE_REPO}|main|${landedCommit} within 150s`);
  check("(2) event.repo === demo-lf-base", found?.repo === BASE_REPO, String(found?.repo));
  check("(2) event.ref === main", found?.ref === "main", String(found?.ref));
  check("(2) event.after === landed.commit", found?.after === landedCommit, String(found?.after));
  check("(2) event has ISO at timestamp", !Number.isNaN(Date.parse(found?.at)), String(found?.at));
  check("(2) event no credential field", !credRe.test(JSON.stringify(found ?? {})));
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  // 4. Cleanup — both scratch repos deleted on exit (200/202/404 all count as
  //    gone), temp clone removed. Runs even when an assertion or the land
  //    itself failed.
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    try {
      const r = await deleteRepo(name);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      check(`(3) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (e) {
      check(`(3) deleted ${name}`, false, String(e));
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — land-feed probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
