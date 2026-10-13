#!/usr/bin/env node
// land-beat-receipt.probe.mjs — LIVE probe for the one-click landing
// beat (nextgit-e10): the real user surface — `node
// platform/scripts/land.mjs <repo>` — against a scratch chain, with the
// CLI receipt parsed and cross-validated against the server. Scratch
// chain ONLY: REST-fork demo -> demo-lb-base -> agent-lb-3; one real
// commit on the proposal (the agent-3 store-memoize transform,
// agents.mjs:121-147); then the beat: spawn the REAL land.mjs with
// NEXTGIT_PLATFORM/NEXTGIT_BASELINE pointed at the scratch chain and
// assert:
//  (1) exit code 0; stdout carries `landed <40-hex>`, >=1 `file <path>`
//      row including src/store.ts (the folded file list = the receipt),
//      and `done — baseline advanced to <sha12>` === landedCommit.slice(0,12)
//  (2) the script never cloned or pushed (POST-only client): the base
//      repo's refs/heads/main resolves to exactly landedCommit (ls-remote),
//      the landed commit's parent is the pre-land base head (exactly ONE
//      server-side commit), and the proposal repo's head is unchanged
//  (3) GET /proposals?base=demo-lb-base reports agent-lb-3
//      landing.status "landed" and base.head === landedCommit (bounded
//      poll — the land's cache:gen bump is ctx.waitUntil, the served
//      view recomputes within seconds)
//  (4) GET /landings/<landedCommit> returns 200, landed.commit ===
//      landedCommit, and landed.files deep-equals the CLI `file` rows
//      (the receipt and the persisted FR-18 record agree — the receipt
//      is not console decoration); evidence heads/ancestor pin the fold
//      inputs; no credential-shaped field anywhere
//  (5) the landing-decision note (pushLand landingNote) resolves on the
//      landed commit via the base's nextgit-notes mirror: exact keys
//      {repos,commit,foldHash,at}, repos === [agent-lb-3], commit ===
//      landedCommit, foldHash === evidence.foldHash, at ISO
//  (6) pre-land: the proposal card carries the intent note (the
//      three-refspec push recipe left it readable)
// Finally: DELETE both scratch repos (200/202/404 all count as gone),
// remove temp clones. Never lands into `demo`; never touches agent-1..5.
// Exit 0 = all green.
// Run: node porting/tests/land-beat-receipt.probe.mjs

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const LAND_MJS = fileURLToPath(new URL("../../platform/scripts/land.mjs", import.meta.url));
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-land-beat-receipt-probe/1.0";
const BASE_REPO = "demo-lb-base";     // scratch-only: lb- prefix, never demo
const PROPOSAL_REPO = "agent-lb-3";   // scratch-only: lb- prefix, never agent-1..5

// The agent-3 transform (agents.mjs:121-147), expressed as a pure text
// transform over the cloned baseline so a drifted baseline fails loudly
// instead of silently producing a no-op commit.
const STORE_ANCHOR = "const rows = new Map<string, Row<unknown>>();";
const STORE_ADDITION = `
/** Read-through cache so repeated reads of a hot row skip the map lookup. */
const cache = new Map<string, Row<unknown>>();

export function getCached<T>(id: string): Row<T> | undefined {
  const hit = cache.get(id);
  if (hit) return hit as Row<T>;
  const row = get<T>(id);
  if (row) cache.set(id, row as Row<unknown>);
  return row;
}

export function invalidateCache(id?: string): void {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}`;
const PROPOSAL_PATH = "src/store.ts";
const INTENT_NOTE = "Perf: memoize store reads";

// Scratch-only guard: the probe must never operate outside its lb-* chain.
if (!BASE_REPO.startsWith("demo-lb-") || !PROPOSAL_REPO.startsWith("agent-lb-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}
if (/^agent-[1-5]$/.test(PROPOSAL_REPO)) {
  throw new Error(`scratch-only probe: refusing collision with live ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): copied from land-feed.probe.mjs:44-58 (CLOUDFLARE_API_TOKEN
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

// api(method, path, body): copied from land-feed.probe.mjs:70-101 — 3
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

// fork(src, name): copied from land-feed.probe.mjs:108-119 — POST
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

// mint(repo): POST `/tokens` { repo, scope: "write", ttl: 3600 } ->
// result.plaintext. Bounded transient retry MIRRORING fork() above:
// 404 10200 "Repository not found" while a just-forked repo settles,
// 403/5xx control-plane lag, 10201 "already exists" from an async-DELETE
// phantom — the same creation-lag classes fork() absorbs. Other errors throw.
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

// deleteRepo(name): copied from land-feed.probe.mjs:132-141 — bounded 5xx
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

// getJson(path): read-only GET against the platform (the /proposals +
// /landings arms) — copied from land-feed.probe.mjs:160-167. Kept silent:
// the post-state poll below bounds retries, so per-poll logging would flood
// the verdict.
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// refSha(repo, env): read the SHA the repo's main ref resolves to via
// git ls-remote (generalized from withheld-land.probe.mjs:154 lsBase —
// the same read, parameterized so both the base and the proposals can be
// pinned). A transient auth/creation-lag failure returns null — a named
// FAIL assertion at the call sites, not an unnamed PROBE ERROR.
const refSha = (repo, env) => {
  try {
    return execFileSync("git", ["ls-remote", `${gitBase}/${repo}.git`, "refs/heads/main"], { env, encoding: "utf8" }).trim().split("\t")[0];
  } catch {
    return null;
  }
};

// Insert text after the first line that matches `anchor` (agents.mjs:54-60
// shape — a missing anchor fails loudly instead of silently no-op'ing).
function insertAfter(source, anchor, addition) {
  const lines = source.split("\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) throw new Error(`anchor not found in baseline: ${anchor}`);
  lines.splice(i + 1, 0, addition);
  return lines.join("\n");
}

let dir;
let baseDir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);

  // 0. Pre-clean both scratch repos (idempotent re-runs); sleep 1200 ms
  //    only when something was actually deleted (post-delete settle lag —
  //    land-hardening.probe.mjs:192-201).
  let cleaned = false;
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    const r = await deleteRepo(name);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);
  await fork("demo", BASE_REPO);            // demo -> demo-lb-base
  await fork(BASE_REPO, PROPOSAL_REPO);     // demo-lb-base -> agent-lb-3
  // Wait for both forks to MATERIALIZE before minting/cloning: cloning or
  // minting mid-fork can yield an empty/not-found repo (observed 2026-10-10 —
  // secret-fixture.mjs:97-103 pattern, colliding-land-refusal.probe.mjs:230).
  for (let i = 0; i < 30; i++) {
    const page = await api("GET", "/repos?limit=200");
    const rows = page.result ?? [];
    const ready = (n) => rows.some((r) => r.name === n && r.status === "ready");
    if (ready(BASE_REPO) && ready(PROPOSAL_REPO)) break;
    await sleep(1000);
  }
  const proposalToken = await mint(PROPOSAL_REPO);
  const baseEnv = gitAuthEnv(await mint(BASE_REPO));

  // 1. One real commit on the proposal: the agent-3 store-memoize transform
  //    applied to the cloned baseline (pure text transform, fail-loudly
  //    anchor), committed with the agent-3 intent note, pushed main + both
  //    note refspecs (the CONTRACT three-refspec recipe — the mirror is
  //    DERIVED single-writer state, forced). H0 is the fork point = the base
  //    head at fork time, which the reviewed-heads gate requires for a clean
  //    single land.
  dir = mkdtempSync(join(tmpdir(), "nextgit-lb-proposal-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "land-beat-receipt-probe");
  git("config", "user.email", "probe@nextgit.dev");
  // Ignore rules must come from the repo alone so the staged tree is
  // deterministic (agents.mjs:249 — the host gitignore would otherwise
  // silently skip a promised path).
  git("config", "core.excludesFile", "/dev/null");
  const H0 = git("rev-parse", "HEAD");
  const storeText = readFileSync(join(dir, PROPOSAL_PATH), "utf8");
  writeFileSync(join(dir, PROPOSAL_PATH), insertAfter(storeText, STORE_ANCHOR, STORE_ADDITION));
  git("add", "-A");
  git("commit", "-m", `${PROPOSAL_REPO}: ${INTENT_NOTE}`);
  git("notes", "add", "-m", INTENT_NOTE, "HEAD");
  git("push", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes");
  const C1 = git("rev-parse", "HEAD");
  console.log(`H0 ${H0}\nC1 ${C1}\n`);

  // (6) Pre-land: the proposal card carries the intent note (the
  //     three-refspec push left it readable — the same surface the land
  //     button renders).
  const pre = await getJson(`/proposals?base=${BASE_REPO}&repos=${PROPOSAL_REPO}`);
  const preRow = (pre.json?.proposals ?? []).find((p) => p.repo === PROPOSAL_REPO);
  check("(6) pre-land /proposals 200 ok", pre.status === 200 && pre.json?.ok === true, `HTTP ${pre.status}`);
  check("(6) proposal card carries the intent note", preRow?.intent === INTENT_NOTE, String(preRow?.intent));
  check("(6) pre-land base.head === fork point H0", pre.json?.base?.head === H0, `base.head=${pre.json?.base?.head}`);

  // The reviewed heads the land route's 409-stale gate compares against —
  // the true heads, so the beat is a single clean land (the same
  // happy-path discipline as land-hardening.probe.mjs:222). The CLI client
  // does not send them; the worker reads the live heads itself.
  const PRE_LAND_BASE_SHA = refSha(BASE_REPO, baseEnv);
  check("(pre) base main ref readable pre-land", !!PRE_LAND_BASE_SHA, `PRE_LAND_BASE_SHA=${PRE_LAND_BASE_SHA}`);
  if (PRE_LAND_BASE_SHA !== H0) throw new Error(`base moved before the beat: H0 ${H0} -> ${PRE_LAND_BASE_SHA}`);

  // 2. THE BEAT: spawn the real land.mjs against the scratch chain. The
  //    client only POSTs /land — it never clones or pushes (land.mjs
  //    header law: "This script never pushes anything").
  console.log("(1) the beat: node platform/scripts/land.mjs " + PROPOSAL_REPO);
  const beat = spawnSync(process.execPath, [LAND_MJS, PROPOSAL_REPO], {
    env: { ...process.env, NEXTGIT_PLATFORM: PLATFORM, NEXTGIT_BASELINE: BASE_REPO },
    encoding: "utf8",
    timeout: 180_000,
  });
  const stdout = String(beat.stdout ?? "");
  const stderr = String(beat.stderr ?? "");
  console.log(stdout.trimEnd());
  if (stderr.trim()) console.log(`  (land.mjs stderr) ${stderr.trim().split("\n").join("\n  ")}`);
  check("(1) land.mjs exit code 0", beat.status === 0, `status=${beat.status} signal=${beat.signal ?? "-"} stderr=${stderr.trim().slice(0, 200)}`);
  const landedCommit = stdout.match(/landed\s+([0-9a-f]{40})/)?.[1] ?? null;
  check("(1) receipt: landed <40-hex>", !!landedCommit, stdout.slice(0, 200));
  const fileRows = [...stdout.matchAll(/file\s+(\S+)/g)].map((m) => m[1]);
  check("(1) receipt: >=1 file row, includes src/store.ts", fileRows.length > 0 && fileRows.includes(PROPOSAL_PATH), JSON.stringify(fileRows));
  const doneSuffix = stdout.match(/done — baseline advanced to ([0-9a-f]{12})/)?.[1] ?? null;
  check("(1) receipt: done suffix === landedCommit.slice(0,12)", !!doneSuffix && !!landedCommit && doneSuffix === landedCommit.slice(0, 12), `suffix=${doneSuffix} commit=${landedCommit?.slice(0, 12)}`);
  check("(1) CLI receipt carries no credential-shaped field", !credRe.test(stdout), stdout.slice(0, 200));

  // (2) The script never cloned or pushed — the receipt came from the POST
  //     only: the base advanced to exactly the printed commit, by exactly
  //     one commit (parent = the pre-land base head), and the proposal head
  //     is untouched (the client wrote nothing anywhere).
  const POST_BASE_SHA = refSha(BASE_REPO, baseEnv);
  check("(2) base main ref === printed landedCommit", !!landedCommit && POST_BASE_SHA === landedCommit, `ref=${POST_BASE_SHA} receipt=${landedCommit}`);
  baseDir = mkdtempSync(join(tmpdir(), "nextgit-lb-base-"));
  const gitB = (...args) => execFileSync("git", args, { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  gitB("clone", `${gitBase}/${BASE_REPO}.git`, baseDir);
  gitB("config", "user.name", "land-beat-receipt-probe");
  gitB("config", "user.email", "probe@nextgit.dev");
  const landedTip = gitB("rev-parse", "HEAD");
  const landedParent = gitB("rev-parse", "HEAD^");
  check("(2) base advanced exactly ONE server-side commit (parent === pre-land head H0)", landedTip === landedCommit && landedParent === H0, `tip=${landedTip} parent=${landedParent} H0=${H0}`);
  const landedStore = landedCommit ? gitB("show", `${landedCommit}:${PROPOSAL_PATH}`) : "";
  check("(2) landed src/store.ts carries the folded proposal change", landedStore.includes("getCached") && landedStore.includes("invalidateCache"), landedStore.slice(0, 120));
  const POST_PROP_SHA = refSha(PROPOSAL_REPO, gitAuthEnv(proposalToken));
  check("(2) proposal head unchanged (client pushed nothing)", POST_PROP_SHA === C1, `post=${POST_PROP_SHA} pre=${C1}`);

  // (3) Served post-state: /proposals reports the proposal landed and the
  //     base head advanced to the landed commit. The land route bumps
  //     cache:gen via ctx.waitUntil (index.ts:1230-1238 + recordEvent
  //     index.ts:777-779), so the served view recomputes within seconds —
  //     bounded poll absorbs the lag (never retry an HTTP status; the
  //     landing.status value itself is data).
  let post = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const r = await getJson(`/proposals?base=${BASE_REPO}&repos=${PROPOSAL_REPO}`);
    const row = (r.json?.proposals ?? []).find((p) => p.repo === PROPOSAL_REPO);
    if (r.status === 200 && row?.landing?.status === "landed") { post = r; break; }
    await sleep(2000);
  }
  const postRow = (post?.json?.proposals ?? []).find((p) => p.repo === PROPOSAL_REPO);
  check("(3) /proposals 200 ok", post?.status === 200 && post?.json?.ok === true, `HTTP ${post?.status}`);
  check("(3) agent-lb-3 landing.status === \"landed\"", postRow?.landing?.status === "landed", String(postRow?.landing?.status));
  check("(3) served base.head === landedCommit", post?.json?.base?.head === landedCommit, `base.head=${post?.json?.base?.head}`);

  // (4) The persisted FR-18 record agrees with the CLI receipt: GET
  //     /landings/<commit> serves exactly the {landed, evidence} the land
  //     response carried. landed.files deep-equals the receipt `file` rows —
  //     the receipt is not console decoration.
  console.log("(4) GET /landings/" + landedCommit);
  const rec = await getJson(`/landings/${landedCommit}`);
  check("(4) 200 from /landings/<commit>", rec.status === 200, `HTTP ${rec.status}`);
  check("(4) exact keys {ok,landed,evidence,attestation}", exactKeys(rec.json, ["ok", "landed", "evidence", "attestation"]), JSON.stringify(Object.keys(rec.json ?? {})));
  check("(4) landed.commit === receipt commit", rec.json?.landed?.commit === landedCommit, String(rec.json?.landed?.commit));
  check("(4) landed.files deep-equals the CLI file rows", JSON.stringify(rec.json?.landed?.files) === JSON.stringify(fileRows), `${JSON.stringify(rec.json?.landed?.files)} vs ${JSON.stringify(fileRows)}`);
  const ev = rec.json?.evidence ?? {};
  check("(4) evidence.commit === landedCommit", ev.commit === landedCommit, String(ev.commit));
  check("(4) evidence.ancestor[proposal] === fork point H0", ev.ancestor?.[PROPOSAL_REPO] === H0, JSON.stringify(ev.ancestor));
  check("(4) evidence.heads.base === pre-land base head", ev.heads?.base === H0, String(ev.heads?.base));
  check("(4) evidence.heads.repos[proposal] === C1", ev.heads?.repos?.[PROPOSAL_REPO] === C1, JSON.stringify(ev.heads?.repos));
  check("(4) evidence.foldHash sha256 hex", /^[0-9a-f]{64}$/.test(String(ev.foldHash)), String(ev.foldHash));
  check("(4) no credential field in the /landings record", !credRe.test(JSON.stringify(rec.json ?? {})));

  // (5) The landing-decision note (pushLand landingNote, land.ts:126-149):
  //     metadata-only {repos,commit,foldHash,at} on the landed commit, read
  //     from the base's nextgit-notes mirror (the Artifacts binding cannot
  //     resolve refs/notes/*, so the mirror branch is the read surface).
  console.log("(5) landing-decision note on " + landedCommit);
  try {
    execFileSync("git", ["fetch", `${gitBase}/${BASE_REPO}.git`, "refs/heads/nextgit-notes:refs/notes/commits"], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    check("(5) nextgit-notes mirror fetched from base", false, String(e?.message ?? e));
  }
  let noteContent = "";
  try {
    noteContent = execFileSync("git", ["notes", "--ref=refs/notes/commits", "show", landedCommit], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    check("(5) note exists on landed commit", false, String(e?.message ?? e));
  }
  let note = {};
  try { note = JSON.parse(noteContent); } catch { check("(5) note is valid JSON", false, "parse error"); }
  check("(5) note exists on landed commit", !!noteContent, "empty note content");
  check("(5) note exact keys {repos,commit,foldHash,at}", exactKeys(note, ["repos", "commit", "foldHash", "at"]), JSON.stringify(Object.keys(note ?? {})));
  check("(5) note.repos === [agent-lb-3]", JSON.stringify(note.repos) === JSON.stringify([PROPOSAL_REPO]), JSON.stringify(note.repos));
  check("(5) note.commit === landedCommit", note.commit === landedCommit, String(note.commit));
  check("(5) note.foldHash === evidence.foldHash", note.foldHash === ev.foldHash, `${note.foldHash} vs ${ev.foldHash}`);
  check("(5) note.at is ISO", typeof note.at === "string" && !Number.isNaN(Date.parse(note.at)), String(note.at));
  check("(5) no secret-shaped content in note", !credRe.test(noteContent), noteContent);
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  // 6. Cleanup — both scratch repos deleted on exit (200/202/404 all count
  //    as gone), temp clones removed. Runs even when an assertion or the
  //    beat itself failed.
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    try {
      const r = await deleteRepo(name);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      check(`(cleanup) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (e) {
      check(`(cleanup) deleted ${name}`, false, String(e));
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — land-beat-receipt probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
