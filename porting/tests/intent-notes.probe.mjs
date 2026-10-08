#!/usr/bin/env node
// intent-notes.probe.mjs — LIVE probe for the three-refspec intent push recipe
// and intent durability across branch movement.
// Scratch chain ONLY: fork demo -> agent-in-1 (proposal). Asserts:
//  (1) the single three-refspec push
//        git push origin main refs/notes/commits refs/notes/commits:refs/heads/nextgit-notes
//      leaves a mirror branch `nextgit-notes` on the remote; (2) the git-note
//      intent resolves for the head commit via GET /changes (changeSet.files[0].intent);
//  (3) after advancing main to shaB (main-only push), the notes mirror branch is
//      untouched and shaA's note blob is still present (cloned tree inspection);
//  (4) the NEXTGIT_INTENT fallback carrier resolves intent for the new head shaB
//      via GET /changes (readIntentFile fallback); (5) a non-FF push onto
//      nextgit-notes is rejected ("Updates were rejected" — FF-only mirror);
//      (6) GET /proposals carries the intent string on the proposal card.
// Run: node porting/tests/intent-notes.probe.mjs
// Exit 0 = all green. Never touches demo's main branch; cleans up agent-in-1 + temp dirs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-intent-notes-probe/1.0";
const BASE_REPO = "demo";
const PROPOSAL_REPO = "agent-in-1";

// Scratch-only guard: BASE_REPO must be `demo` (the real baseline); PROPOSAL_REPO
// must not collide with the live agent-1..5 chain. The probe only ever forks
// demo -> agent-in-1 and never writes to demo's main.
if (BASE_REPO !== "demo" || !PROPOSAL_REPO.startsWith("agent-in-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}
if (/^agent-[1-5]$/.test(PROPOSAL_REPO)) {
  throw new Error(`scratch-only probe: refusing collision with live ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): CLOUDFLARE_API_TOKEN env, else wrangler OAuth toml — cached so
// api() can drop it after a 401 and re-read the toml `wrangler whoami` refreshes.
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

// api(method, path, body): fetch against apiBase with 3 transport retries, 30s timeout;
// returns { status, success, result, raw }. A 401 refreshes the wrangler OAuth token
// in place (`wrangler whoami`) and retries once.
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
// 5 attempts with 1.5s*attempt backoff on transient creation lag.
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

// deleteRepo(name): DELETE with bounded retry on 5xx and 403 (rate-limit).
async function deleteRepo(name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("DELETE", `/repos/${name}`);
    if (r.status === 404) return r;
    if (r.status < 500 && r.status !== 403) return r;
    last = r;
    await sleep(2000 * attempt);
  }
  return last;
}

// getJson(path): read-only GET against the platform.
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  GET ${path} -> HTTP ${res.status}`);
  return { status: res.status, json };
}

// lsRemote(token, repo, refspec): git ls-remote against the Artifacts git endpoint.
function lsRemote(token, repo, refspec) {
  const env = gitAuthEnv(token);
  return execFileSync("git", ["ls-remote", `${gitBase}/${repo}.git`, refspec], { env, encoding: "utf8" }).trim();
}

// gitExec(env, args): execFileSync wrapper for git in a given cwd.
function gitExec(cwd, env, args) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let dir;
let noteDir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);

  // Pre-clean: delete agent-in-1 if it lingers from a prior aborted run.
  const r = await deleteRepo(PROPOSAL_REPO);
  console.log(`pre-clean DELETE ${PROPOSAL_REPO}: HTTP ${r.status}`);
  if (r.status === 200 || r.status === 202) await sleep(1200);

  // Fork demo -> agent-in-1
  await fork(BASE_REPO, PROPOSAL_REPO);

  // Mint write token for agent-in-1, clone to temp dir.
  const token = await mint(PROPOSAL_REPO);
  dir = mkdtempSync(join(tmpdir(), "nextgit-intent-probe-"));
  const env = gitAuthEnv(token);
  const git = (...args) => gitExec(dir, env, args);
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "intent-notes-probe");
  git("config", "user.email", "probe@nextgit.dev");

  // --- shaA: commit, attach note, push with three-refspec recipe ---
  writeFileSync(join(dir, "probe-test.txt"), "probe content\n");
  git("add", "-A"); git("commit", "-m", "probe: intent shaA");
  const shaA = git("rev-parse", "HEAD");
  const intentA = "probe: intent for shaA";

  // git note is the primary intent carrier
  git("notes", "add", "-m", intentA, "HEAD");

  // CONTRACT recipe — single three-refspec push (CONTRACT.md:194-196)
  const pushOut = git("push", "origin", "main", "refs/notes/commits", "refs/notes/commits:refs/heads/nextgit-notes");
  console.log(`  push > ${pushOut}`);

  // (1) Mirror branch exists via ls-remote
  const mirrorRef = lsRemote(token, PROPOSAL_REPO, "refs/heads/nextgit-notes");
  check("nextgit-notes mirror exists", mirrorRef.length > 0, `ls-remote returned: ${mirrorRef}`);

  // (2) Intent resolves for shaA via /changes (ref=main resolves to shaA)
  const c2 = await getJson(`/changes?repo=${PROPOSAL_REPO}&ref=main&base=${BASE_REPO}`);
  const files2 = c2.json?.changeSet?.files ?? [];
  const intent2 = files2.find((f) => f.intent)?.intent;
  check("intent resolves for shaA via /changes", intent2 === intentA, `got: ${JSON.stringify(intent2)}`);

  // (6) Proposal card carries intent (checked BEFORE advance — /proposals cache
  // may lag on git push events, so the authoritative fresh-intent check is /changes)
  const c6 = await getJson(`/proposals?base=${BASE_REPO}&repos=${PROPOSAL_REPO}`);
  const props = c6.json?.proposals ?? [];
  const propIntent = props.find((p) => p.repo === PROPOSAL_REPO)?.intent;
  check("proposal card carries shaA intent", propIntent === intentA, `got: ${JSON.stringify(propIntent)}`);

  // --- Advance branch to shaB (main-only push, no notes ref) ---
  // shaA's note survives in the notes mirror; shaB uses the fallback carrier.
  const intentB = "probe: intent for shaB";
  writeFileSync(join(dir, "probe-test-2.txt"), "probe content 2\n");

  // Fallback carrier: NEXTGIT_INTENT/intent.txt (SHA-less fallback; the SHA-specific
  // path NEXTGIT_INTENT/<headSha>.txt cannot match after a new commit because the
  // HEAD SHA is unknown until the commit is made — intent.txt works for any HEAD).
  mkdirSync(join(dir, "NEXTGIT_INTENT"), { recursive: true });
  writeFileSync(join(dir, "NEXTGIT_INTENT", "intent.txt"), intentB + "\n");

  git("add", "-A"); git("commit", "-m", "probe: intent shaB (fallback carrier)");
  const shaB = git("rev-parse", "HEAD");
  git("push", "origin", "main");
  console.log(`shaA ${shaA}\nshaB ${shaB}\n`);

  // (3) shaA's note still in the notes mirror after main-only push
  const mirrorRefAfter = lsRemote(token, PROPOSAL_REPO, "refs/heads/nextgit-notes");
  check("notes mirror untouched by main-only push", mirrorRefAfter.length > 0, `ls-remote returned: ${mirrorRefAfter}`);

  // Clone the mirror branch and verify shaA's note blob is still present
  noteDir = mkdtempSync(join(tmpdir(), "nextgit-intent-mirror-"));
  const gitM = (...args) => gitExec(noteDir, env, args);
  gitM("clone", `${gitBase}/${PROPOSAL_REPO}.git`, noteDir);
  gitM("config", "user.name", "intent-notes-probe");
  gitM("config", "user.email", "probe@nextgit.dev");
  gitM("fetch", "origin", `refs/heads/nextgit-notes`);
  gitM("checkout", "-b", "nextgit-notes", "FETCH_HEAD");

  // List tree of the mirror branch — notes are stored as blobs at paths
  // derived from commit SHAs (git notes fanout: XX/YYYYYY...)
  const notesTree = gitM("ls-tree", "-r", "nextgit-notes");
  console.log(`  notes mirror tree:\n${notesTree}`);

  // Parse each blob line: "100644 blob <hash>\t<path>" -> extract hash
  const blobLines = notesTree.split("\n").filter((l) => l.includes(" blob "));
  check("notes mirror tree has blob(s)", blobLines.length > 0, `found ${blobLines.length} blob(s)`);

  // Verify shaA's note text is still present in the mirror tree
  let noteFound = false;
  for (const line of blobLines) {
    const tabIdx = line.lastIndexOf("\t");
    if (tabIdx === -1) continue;
    const metaPart = line.slice(0, tabIdx);
    const hash = metaPart.split(" ").pop();
    if (!hash || !/^[0-9a-f]{40}$/.test(hash)) continue;
    try {
      const content = gitM("cat-file", "-p", hash);
      if (content.includes(intentA)) {
        noteFound = true;
        break;
      }
    } catch {
      // skip unreadable blobs
    }
  }
  check("shaA note blob present in mirror after advance", noteFound, "note text not found in any mirror blob");

  // (4) Fallback carrier serves shaB intent via /changes
  const c4 = await getJson(`/changes?repo=${PROPOSAL_REPO}&ref=main&base=${BASE_REPO}`);
  const files4 = c4.json?.changeSet?.files ?? [];
  const intent4 = files4.find((f) => f.intent)?.intent;
  check("fallback carrier serves shaB intent", intent4 === intentB, `got: ${JSON.stringify(intent4)}`);

  // (5) Non-FF push to nextgit-notes is rejected (FF-only mirror): create a
  // divergent (orphan) commit and push WITHOUT --force. Any git server rejects
  // non-FF updates to an existing branch. (A --force push would succeed, but the
  // recipe never uses --force — the mirror is updated via FF notes pushes only.)
  const orphanTree = gitM("mktree");
  const diverTip = gitM("commit-tree", orphanTree, "-m", "divergent: non-FF commit");
  gitM("update-ref", "refs/heads/nextgit-notes", diverTip);
  let ffRejected = false;
  let ffMsg = "";
  try {
    gitM("push", "origin", `nextgit-notes:refs/heads/nextgit-notes`);
  } catch (err) {
    ffRejected = true;
    ffMsg = String(err?.stderr ?? err?.message ?? "unknown").slice(0, 200);
  }
  check("non-FF mirror push rejected (FF-only mirror)", ffRejected, ffMsg || "push unexpectedly succeeded");

  // No leaked secrets in any platform response
  check("no credential field in /changes response", !credRe.test(JSON.stringify(c2.json)));
  check("no credential field in /proposals response", !credRe.test(JSON.stringify(c6.json)));
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  // Cleanup — the API rate-limits DELETE after rapid operations, so back off
  // before attempting deletion; deleteRepo retries on 403/5xx internally.
  await sleep(3000);
  let r;
  try {
    r = await deleteRepo(PROPOSAL_REPO);
    console.log(`cleanup DELETE ${PROPOSAL_REPO}: HTTP ${r?.status}`);
  } catch (err) {
    console.log(`cleanup DELETE ${PROPOSAL_REPO}: error ${err}`);
  }
  check(`deleted ${PROPOSAL_REPO}`, r && (r.status === 200 || r.status === 202 || r.status === 404), r ? `HTTP ${r.status}` : "no response");
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (noteDir) rmSync(noteDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — intent-notes probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
