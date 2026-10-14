#!/usr/bin/env node
// colliding-land-refusal.probe.mjs — LIVE probe: POST /land with two
// proposals that collide on the same file is REFUSED with 409
// {ok:false,error:"conflict",conflicted:[...]} and pushes nothing
// (nextgit-e10). Scratch chain ONLY: REST-fork demo -> demo-cr-base
// -> agent-cr-1 + agent-cr-2; both proposals rewrite src/auth.ts
// with different content (a genuine diff3 text-conflict); then:
//  (a) POST /land -> 409 ok:false error:"conflict"
//  (b) conflicted[] non-empty and includes src/auth.ts
//  (c) detail names src/auth.ts
//  (d) the 409 body carries NO landed/evidence/commit keys (the
//      refusal is structural: it fires before withLandGate/pushLand,
//      so no write token is ever minted)
// Invariance (SM-C1 — the refusal pushes nothing):
//  (e) the base repo's main ref is byte-identical before/after
//  (f) GET /proposals is unchanged — both proposals still ready with
//      the same heads, and the src/auth.ts collision map is intact
//  (g) GET /merge reports status "conflict" with a diff3 conflictText
//      (<<<ours / === / >>>theirs) — the preview-merge guidance target
//  (h) the deployed /app.js is sha256-identical to the tree
//      platform/ui/app.js and carries both conflict-banner copy strings
//      ("Conflicted files:" + "(preview merge first)")
// Finally: DELETE both scratch proposals + the scratch base, remove
// the temp clones. Never lands into `demo`; never touches agent-1..5.
// Exit 0 = all green.
// Run: node porting/tests/colliding-land-refusal.probe.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-colliding-land-refusal-probe/1.0";
const BASE_REPO = "demo-cr-base";    // scratch-only: cr- prefix, never demo
const PROPOSAL_A = "agent-cr-1";     // scratch-only: cr- prefix, never agent-1..5
const PROPOSAL_B = "agent-cr-2";     // scratch-only: cr- prefix, never agent-1..5
const COLLIDING_PATH = "src/auth.ts";

// Scratch-only guard: the probe must never operate outside its cr-* chain.
if (!BASE_REPO.startsWith("demo-cr-") || !PROPOSAL_A.startsWith("agent-cr-") || !PROPOSAL_B.startsWith("agent-cr-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_A} / ${PROPOSAL_B}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): copied from land-feed.probe.mjs:44-58 (CLOUDFLARE_API_TOKEN
// env, else wrangler OAuth toml) — cached so api() can drop it after a 401
// and re-read the toml `wrangler whoami` refreshes in place.
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
        headers: { ...apiHeaders(), connection: "close" },
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

// land(body): copied from land-feed.probe.mjs:145-155 — POST ${PLATFORM}/land,
// 120s timeout, logs the full JSON.
async function land(body) {
  const res = await fetch(`${PLATFORM}/land`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, connection: "close" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, json };
}

// getJson(path): read-only GET against the platform (the /merge + /proposals
// arms) — copied from land-feed.probe.mjs:160-167. Kept silent: the view
// captures below are one-shot, so per-call logging would flood the verdict.
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA, connection: "close" },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// refSha(repo, env): read the SHA the repo's main ref resolves to via
// git ls-remote (generalized from withheld-land.probe.mjs:154 lsBase —
// the same read, parameterized so both the base and the proposals can
// be pinned). A transient auth/creation-lag failure returns null — a
// named FAIL assertion at the call sites, not an unnamed PROBE ERROR.
const refSha = (repo, env) => {
  try {
    return execFileSync("git", ["ls-remote", `${gitBase}/${repo}.git`, "refs/heads/main"], { env, encoding: "utf8" }).trim().split("\t")[0];
  } catch {
    return null;
  }
};

let dirA;
let dirB;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_A} + ${PROPOSAL_B} (colliding proposals)\n`);

  // 0. Pre-clean all three scratch repos (idempotent re-runs). Proposals
  //    first, base last. The post-delete settle is scaled to the burst
  //    actually performed — deletes are eventually consistent, and a
  //    3-fork burst + immediate mint hits the creation lag far harder
  //    than a flat 1200 ms (land-hardening.probe.mjs:192-201 shape,
  //    deletion-count-scaled).
  let deleted = 0;
  for (const name of [PROPOSAL_B, PROPOSAL_A, BASE_REPO]) {
    const r = await deleteRepo(name);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) deleted++;
  }
  if (deleted) await sleep(1200 * deleted);
  await fork("demo", BASE_REPO);          // demo -> demo-cr-base
  await fork(BASE_REPO, PROPOSAL_A);      // demo-cr-base -> agent-cr-1
  await fork(BASE_REPO, PROPOSAL_B);      // demo-cr-base -> agent-cr-2
  // Wait for all three forks to MATERIALIZE before minting: cloning or
  // minting mid-fork can yield an empty/not-found repo (observed
  // 2026-10-10 — secret-fixture.mjs:97-103 pattern).
  for (let i = 0; i < 30; i++) {
    const page = await api("GET", "/repos?limit=200");
    const rows = page.result ?? [];
    const ready = (n) => rows.some((r) => r.name === n && r.status === "ready");
    if (ready(BASE_REPO) && ready(PROPOSAL_A) && ready(PROPOSAL_B)) break;
    await sleep(1000);
  }
  const tokenA = await mint(PROPOSAL_A);
  const tokenB = await mint(PROPOSAL_B);
  const baseEnv = gitAuthEnv(await mint(BASE_REPO));

  // 1. Two REAL colliding commits. Both proposals forked from the same base
  //    head H0; each rewrites COLLIDING_PATH with different content, so the
  //    3-way fold (ancestor = fork-point text, ours = base head, theirs =
  //    proposal head) hits a genuine diff3 text-conflict: both sides changed
  //    the same region of the same file differently. The first line of each
  //    replacement is probe-unique, so the conflict holds for ANY base text
  //    (the base can equal neither side).
  const COLLIDE_A = `// colliding-land-refusal probe — agent-cr-1 edit\nexport const auth = 1;\nexport const keep = true;\n`;
  const COLLIDE_B = `// colliding-land-refusal probe — agent-cr-2 edit\nexport const auth = 1;\nexport const keep = true;\n`;
  const pushEdit = async (repo, token, content, label) => {
    const dir = mkdtempSync(join(tmpdir(), `nextgit-cr-${label}-`));
    const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(token), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("clone", `${gitBase}/${repo}.git`, dir);
    git("config", "user.name", "colliding-land-refusal-probe");
    git("config", "user.email", "probe@nextgit.dev");
    const H0 = git("rev-parse", "HEAD");
    writeFileSync(join(dir, COLLIDING_PATH), content);
    git("add", "-A");
    git("commit", "-m", `probe: colliding edit on ${COLLIDING_PATH} (${label})`);
    git("push", "origin", "HEAD:refs/heads/main");
    const C = git("rev-parse", "HEAD");
    return { dir, H0, C };
  };
  const a = await pushEdit(PROPOSAL_A, tokenA, COLLIDE_A, "1");
  dirA = a.dir;
  const b = await pushEdit(PROPOSAL_B, tokenB, COLLIDE_B, "2");
  dirB = b.dir;
  if (a.H0 !== b.H0) throw new Error(`fork-point drift: ${PROPOSAL_A} H0 ${a.H0} != ${PROPOSAL_B} H0 ${b.H0}`);
  console.log(`H0 ${a.H0} (shared fork point)\n${PROPOSAL_A} head ${a.C}\n${PROPOSAL_B} head ${b.C}\n`);

  // 2. Pre-land snapshot: the base head (ls-remote) and the proposals view.
  const PRE_LAND_SHA = refSha(BASE_REPO, baseEnv);
  check("(e) base main ref readable pre-land", !!PRE_LAND_SHA, `PRE_LAND_SHA=${PRE_LAND_SHA}`);
  const PRE = await getJson(`/proposals?base=${BASE_REPO}&repos=${PROPOSAL_A},${PROPOSAL_B}&ref=main&baseRef=main`);
  console.log(`PRE_LAND_SHA ${PRE_LAND_SHA}\n`);

  // 3. POST /land with the TRUE reviewed heads — the reviewed-heads gate
  //    (index.ts:1076-1091) passes, so the refusal below is the CONFLICT
  //    arm (index.ts:1115-1121), not a stale-head refusal: this is what
  //    proves the collision itself is what refuses the land.
  console.log("(1) POST /land with both colliding proposals");
  const landRes = await land({
    base: BASE_REPO,
    repos: [PROPOSAL_A, PROPOSAL_B],
    baseRef: "main",
    ref: "main",
    reviewed: { baseHead: PRE_LAND_SHA, heads: { [PROPOSAL_A]: a.C, [PROPOSAL_B]: b.C } },
  });
  const body = landRes.json ?? {};
  check("(a) /land -> 409 ok:false error:conflict", landRes.status === 409 && body.ok === false && body.error === "conflict", JSON.stringify(body));
  check("(b) conflicted[] non-empty and includes src/auth.ts", Array.isArray(body.conflicted) && body.conflicted.length > 0 && body.conflicted.includes(COLLIDING_PATH), JSON.stringify(body.conflicted));
  check("(c) detail names src/auth.ts", typeof body.detail === "string" && body.detail.includes(COLLIDING_PATH), String(body.detail));
  check("(d) 409 body exact keys {ok,error,conflicted,detail}", exactKeys(body, ["ok", "error", "conflicted", "detail"]), JSON.stringify(body && Object.keys(body)));
  check("(d) no landed/evidence/commit keys in the 409 (refusal fires before any push)", !("landed" in body) && !("evidence" in body) && !("commit" in body), JSON.stringify(Object.keys(body)));
  const landBodyText = JSON.stringify(body);
  check("(d) 409 body carries no credential-shaped field", !credRe.test(landBodyText));

  // 4. SM-C1 invariance — the refusal pushed NOTHING.
  const POST_LAND_SHA = refSha(BASE_REPO, baseEnv);
  check("(e) base main ref unchanged (== PRE_LAND_SHA)", POST_LAND_SHA === PRE_LAND_SHA, `pre=${PRE_LAND_SHA} post=${POST_LAND_SHA}`);

  const POST = await getJson(`/proposals?base=${BASE_REPO}&repos=${PROPOSAL_A},${PROPOSAL_B}&ref=main&baseRef=main`);
  const preView = PRE.json ?? {};
  const postView = POST.json ?? {};
  const headsOf = (v) => Object.fromEntries((v?.proposals ?? []).map((p) => [p.repo, p.head]));
  const landingOf = (v) => Object.fromEntries((v?.proposals ?? []).map((p) => [p.repo, p.landing?.status]));
  const collisionOf = (v) => (v?.conflicts ?? []).find((c) => c.file === COLLIDING_PATH) ?? null;
  const preCol = collisionOf(preView);
  const postCol = collisionOf(postView);
  check("(f) /proposals 200 both views", PRE.status === 200 && POST.status === 200 && preView.ok === true && postView.ok === true, `pre=${PRE.status} post=${POST.status}`);
  check("(f) base.head unchanged", preView.base?.head === postView.base?.head && preView.base?.head === PRE_LAND_SHA, `pre=${preView.base?.head} post=${postView.base?.head}`);
  check("(f) both proposals still ready, same heads", JSON.stringify(headsOf(preView)) === JSON.stringify(headsOf(postView)) && JSON.stringify(landingOf(preView)) === JSON.stringify(landingOf(postView)) && landingOf(postView)[PROPOSAL_A] === "ready" && landingOf(postView)[PROPOSAL_B] === "ready", `heads=${JSON.stringify(headsOf(postView))} landing=${JSON.stringify(landingOf(postView))}`);
  check("(f) src/auth.ts collision map intact (one hard text-conflict pair)", !!preCol && !!postCol && preCol.kind === postCol.kind && postCol.kind === "text-conflict" && (postCol.pairs ?? []).some((p) => p.conflict === true), JSON.stringify(postCol));

  // 5. The preview-merge guidance target: /merge reports the conflict with a
  //    real diff3 conflictText (renderMerge, index.ts:301-303).
  console.log("\n(2) GET /merge — conflict preview carries diff3 conflictText");
  const m = await getJson(`/merge?base=${BASE_REPO}&repos=${PROPOSAL_A},${PROPOSAL_B}&ref=main&baseRef=main`);
  const hm = m.json?.merge ?? {};
  const row = (hm.files ?? []).find((f) => f.path === COLLIDING_PATH);
  check("(g) /merge 200 ok, status conflict", m.status === 200 && m.json?.ok === true && hm.status === "conflict", JSON.stringify(m.json?.merge?.status));
  check("(g) conflicted[] includes src/auth.ts", Array.isArray(hm.conflicted) && hm.conflicted.includes(COLLIDING_PATH), JSON.stringify(hm.conflicted));
  check("(g) src/auth.ts row result === conflict", row?.result === "conflict", JSON.stringify(row));
  check("(g) conflictText carries <<<ours / ===== / >>>theirs", typeof row?.conflictText === "string" && row.conflictText.includes("<<<<<<< ours") && row.conflictText.includes("=======") && row.conflictText.includes(">>>>>>> theirs"), String(row?.conflictText).slice(0, 120));
  check("(g) row note names the colliding repo", typeof row?.note === "string" && /agent-cr-[12]/.test(row.note), String(row?.note));

  // 6. The shipped UI: the deployed module set must be the tree
  //    build. The wave-13 module split moved the conflict-banner
  //    copy out of app.js into ./js/land.js ("Conflicted files:",
  //    the 409-conflict banner) and ./js/proposals.js ("(preview
  //    merge first)", the conflict-state action button) — so the
  //    copy-string assertions verify the DEPLOYED module set, and
  //    the sha256 fingerprint pins /app.js itself to the tree.
  console.log("\n(3) deployed module set — conflict banner copy present");
  const sha256 = (s) => createHash("sha256").update(s).digest("hex");
  const fetchText = async (asset) => {
    const r = await fetch(`${PLATFORM}${asset}`, { headers: { "user-agent": UA, connection: "close" }, signal: AbortSignal.timeout(30_000) });
    check(`(h) GET ${asset} -> 200`, r.status === 200, `HTTP ${r.status}`);
    return { status: r.status, text: await r.text() };
  };
  const app = await fetchText("/app.js");
  check("(h) deployed /app.js sha256-identical to tree platform/ui/app.js", sha256(app.text) === sha256(readFileSync(new URL("../../platform/ui/app.js", import.meta.url), "utf8")), "app.js fingerprint mismatch");
  const landJs = await fetchText("/js/land.js");
  check("(h) deployed /js/land.js contains \"Conflicted files:\"", landJs.text.includes("Conflicted files:"));
  const proposalsJs = await fetchText("/js/proposals.js");
  check("(h) deployed /js/proposals.js contains \"(preview merge first)\"", proposalsJs.text.includes("(preview merge first)"));
  check("(h) deployed /js/land.js sha256-identical to tree platform/ui/js/land.js", sha256(landJs.text) === sha256(readFileSync(new URL("../../platform/ui/js/land.js", import.meta.url), "utf8")), "land.js fingerprint mismatch");
  check("(h) deployed /js/proposals.js sha256-identical to tree platform/ui/js/proposals.js", sha256(proposalsJs.text) === sha256(readFileSync(new URL("../../platform/ui/js/proposals.js", import.meta.url), "utf8")), "proposals.js fingerprint mismatch");
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  // 7. Cleanup — all three scratch repos deleted on exit (200/202/404 all
  //    count as gone), temp clones removed. Runs even when an assertion or
  //    the land itself failed. Proposals first, base last.
  for (const name of [PROPOSAL_B, PROPOSAL_A, BASE_REPO]) {
    try {
      const r = await deleteRepo(name);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      check(`(cleanup) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (err) {
      check(`(cleanup) deleted ${name}`, false, String(err));
    }
  }
  if (dirA) rmSync(dirA, { recursive: true, force: true });
  if (dirB) rmSync(dirB, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — colliding-land-refusal probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
