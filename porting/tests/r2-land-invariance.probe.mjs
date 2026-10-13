#!/usr/bin/env node
// r2-land-invariance.probe.mjs — LIVE invariance proof for the R2 asset
// tier (AD-10 / FR-47) across landing, masking, and fork-point contracts.
//
// Scratch chains ONLY: demo -> demo-r2i-base -> agent-r2i-1 (pointer +
// second change); demo -> demo-r2i-ctrl -> agent-r2i-ctrl (pointer-free
// control); plus agent-r2i-s (secret-class pointer) and agent-r2i-2
// (conflict). Asserts:
//   (a) 200 land carries the pinned evidence shape; base remote ref ===
//       evidence.commit; landed.files includes BOTH the pointer and the
//       second change; the pointer rode the fold BYTE-FOR-BYTE;
//       (a-changes) GET /changes renders the pointer metadata-only (asset
//       + note, no patch, no additions/deletions); (a-merge) GET /merge
//       renders the pointer result:"merged" with NO merged field;
//   (b) re-land with refreshed reviewed heads -> 409 no-changes;
//   (c) stale reviewed heads -> 409 stale (both variants), base unmoved;
//   (d) secret-class pointer path -> /changes key-names-only (keys present,
//       NO asset field — the Task-1 wiring); /merge withheld-secret;
//       /land 409 withheld-secret; the canary appears in NO response body
//       and NO worker log line (wrangler tail);
//   (e) conflict -> 409 conflict, base unmoved;
//   (f) concurrent double-land -> exactly one 200, loser 409 base-moved|
//       stale, base advanced exactly once;
//   (g) fork-point ancestor equality: evidence.ancestor[repo] === H0 for
//       the asset chain AND the pointer-free control; a moved-base fold
//       still anchors at the fork point and keeps both sides;
//   (h) precondition order: stale beats withheld-secret, withheld-secret
//       beats conflict.
// Never lands into `demo`; never touches agent-1..4. Exit 0 = all green.
// Run: node porting/tests/r2-land-invariance.probe.mjs

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const WORKER = "nextgit-platform";
const UA = "nextgit-r2-land-invariance-probe/1.0";
const BASE_REPO = "demo-r2i-base";
const PROPOSAL_REPO = "agent-r2i-1";
const SECRET_PROPOSAL_REPO = "agent-r2i-s";
const CONFLICT_PROPOSAL_REPO = "agent-r2i-2";
const CTRL_BASE_REPO = "demo-r2i-ctrl";
const CTRL_PROPOSAL_REPO = "agent-r2i-ctrl";
const SHA_ZERO = "0".repeat(40);
const PLATFORM_DIR = join(import.meta.dirname, "..", "..", "platform");
// The pinned-lockfile wrangler (4.147.0) — the 401 refresh (whoami) and the
// worker-log tail (d-5).
const WRANGLER = join(PLATFORM_DIR, "node_modules", ".bin", "wrangler");

// The planted canaries: opaque R2 object keys (never URLs). If either ever
// appears in a response body or a worker log line it never should, the
// masking law is violated.
const CANARY = `r2-canary-${createHash("sha256").update(`r2i-${Date.now()}`).digest("hex").slice(0, 16)}`;
const SECRET_CANARY = `r2-canary-secret-${createHash("sha256").update(`r2is-${Date.now()}`).digest("hex").slice(0, 16)}`;

const POINTER_PATH = "assets/probe.asset.json";
const SECOND_PATH = "src/r2i-change.txt";
const SECRET_POINTER_PATH = "secrets/cred.asset.json";
// The moved-base markers (baseline side prepends, proposal side appends, so
// a fork-point-anchored fold keeps both and a base-anchored one drops one).
const BASE_MARKER = "r2i-fork-point: baseline-side change";
const PROP_MARKER = "r2i-fork-point: proposal-side change";

// Scratch-only guard: the probe must never operate outside its r2i-* chain.
if (
  !BASE_REPO.startsWith("demo-r2i-") ||
  !PROPOSAL_REPO.startsWith("agent-r2i-") ||
  !SECRET_PROPOSAL_REPO.startsWith("agent-r2i-") ||
  !CONFLICT_PROPOSAL_REPO.startsWith("agent-r2i-") ||
  !CTRL_BASE_REPO.startsWith("demo-r2i-") ||
  !CTRL_PROPOSAL_REPO.startsWith("agent-r2i-")
) {
  throw new Error(
    `scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO} / ${SECRET_PROPOSAL_REPO} / ${CONFLICT_PROPOSAL_REPO} / ${CTRL_BASE_REPO} / ${CTRL_PROPOSAL_REPO}`,
  );
}

let fails = 0;
const check = (n, ok, d = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`);
};
const exactKeys = (o, ks) => {
  const a = Object.keys(o ?? {}).sort();
  const w = [...ks].sort();
  return a.length === w.length && a.every((k, i) => k === w[i]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|credential|caller/i;

// apiToken(): CLOUDFLARE_API_TOKEN env, else the wrangler OAuth toml
// (cached so api() can drop it after a 401 and re-read what `wrangler
// whoami` refreshes in place) — the land-hardening.probe.mjs idiom.
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

// api(method, path, body): fetch against the Artifacts control plane with 3
// transport retries, a 30s timeout, and an in-place 401 refresh
// (`wrangler whoami` re-reads the OAuth token). Returns
// { status, success, result, raw }.
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
          execFileSync(WRANGLER, ["whoami"], { stdio: "ignore", timeout: 60_000 });
        } catch (refreshErr) {
          last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh the OAuth token: ${refreshErr?.message ?? refreshErr}`);
          break;
        }
        continue;
      }
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err; // transport failure only — HTTP statuses are never retried
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

// fork(src, name): POST /repos/{src}/fork with backoff on the transient
// creation lag (already-exists / 404 / 5xx / plan-recorded 403).
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

// mint(repo): POST /tokens { repo, scope:"write", ttl:3600 } -> result.plaintext.
async function mint(repo) {
  const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.result.plaintext;
}

// deleteRepo(name): DELETE with bounded retry on 5xx; 200/202 = accepted,
// 404 = already gone.
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

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const apiHeaders = () => ({ Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" });
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const gitAuthEnv = (token) => ({ ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });

async function land(body) {
  const res = await fetch(`${PLATFORM}/land`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, json, body: JSON.stringify(json ?? {}) };
}

// getJson(path): read-only GET against the platform (/changes + /merge arms).
async function getJson(path) {
  const res = await fetch(`${PLATFORM}${path}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  GET ${path} -> HTTP ${res.status}`);
  return { status: res.status, json, body: JSON.stringify(json ?? {}) };
}

// spawnLogs / parseTailEvents / messageTexts / messageText: the worker-log
// tail helper set (token-audit.probe.mjs Leg B). `wrangler tail --format
// json` wraps each request in an envelope whose `logs[]` carries the
// worker's console.log calls.
function spawnLogs(opts) {
  const child = spawn(opts.cmd, opts.args, { ...opts.spawnOpts, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const onData = (chunk) => {
    out += chunk.toString();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return { child, get out() { return out; } };
}
function parseTailEvents(out) {
  const events = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { events.push(JSON.parse(out.slice(start, i + 1))); } catch { /* partial flush */ }
        start = -1;
      }
    }
  }
  return events;
}
function messageTexts(event) {
  const texts = [];
  for (const entry of event?.logs ?? []) texts.push(messageText(entry));
  if (event?.message !== undefined) texts.push(messageText(event));
  return texts;
}
function messageText(entry) {
  const m = entry?.message;
  if (Array.isArray(m)) return m.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  return String(m ?? "");
}

// The pointer fixture: parseable (v:1, opaque blobId, sha256 hex-64, size).
const pointerJson = (blobId, size) =>
  JSON.stringify(
    { v: 1, blobId, sha256: createHash("sha256").update(`blob-${blobId}`).digest("hex"), size, contentType: "text/plain" },
    null,
    0,
  );
// Write a fixture at a nested path inside a repo clone, creating parent dirs
// (a fresh Artifacts clone may not carry `assets/` or `src/`).
const writeNested = (root, rel, content) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

let dir, baseDir, ctrlDir, ctrlBaseDir, secretDir, conflictDir;
let tail = null;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);
  // Pre-clean every scratch repo this probe owns (a half-finished prior run
  // cannot collide), then fork both chains back-to-back so both fork points
  // are the same `demo` head.
  let cleaned = false;
  const chainRepos = [PROPOSAL_REPO, BASE_REPO, SECRET_PROPOSAL_REPO, CONFLICT_PROPOSAL_REPO, CTRL_PROPOSAL_REPO, CTRL_BASE_REPO];
  for (const name of chainRepos) {
    const r = await deleteRepo(name);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
    if (r.status === 200 || r.status === 202) cleaned = true;
  }
  if (cleaned) await sleep(1200);
  await fork("demo", BASE_REPO);
  await fork(BASE_REPO, PROPOSAL_REPO);
  await fork(BASE_REPO, SECRET_PROPOSAL_REPO);
  await fork(BASE_REPO, CONFLICT_PROPOSAL_REPO);
  await fork("demo", CTRL_BASE_REPO);
  await fork(CTRL_BASE_REPO, CTRL_PROPOSAL_REPO);

  const proposalToken = await mint(PROPOSAL_REPO);
  const secretToken = await mint(SECRET_PROPOSAL_REPO);
  const conflictToken = await mint(CONFLICT_PROPOSAL_REPO);
  const ctrlToken = await mint(CTRL_PROPOSAL_REPO);
  const baseToken = await mint(BASE_REPO);
  const ctrlBaseToken = await mint(CTRL_BASE_REPO);
  const baseEnv = gitAuthEnv(baseToken);
  const ctrlBaseEnv = gitAuthEnv(ctrlBaseToken);
  const lsBase = () => execFileSync("git", ["ls-remote", `${gitBase}/${BASE_REPO}.git`, "refs/heads/main"], { env: baseEnv, encoding: "utf8" }).trim().split("\t")[0];
  const lsCtrlBase = () => execFileSync("git", ["ls-remote", `${gitBase}/${CTRL_BASE_REPO}.git`, "refs/heads/main"], { env: ctrlBaseEnv, encoding: "utf8" }).trim().split("\t")[0];

  dir = mkdtempSync(join(tmpdir(), "nextgit-r2i-proposal-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "r2-land-invariance-probe");
  git("config", "user.email", "probe@nextgit.dev");
  const H0 = git("rev-parse", "HEAD");
  // One commit carries the pointer + the second change.
  writeNested(dir, POINTER_PATH, pointerJson(CANARY, 42) + "\n");
  writeNested(dir, SECOND_PATH, `r2 land invariance probe ${new Date().toISOString()}\n`);
  git("add", "-A");
  git("commit", "-m", "probe: pointer + second change");
  git("push", "origin", "HEAD:refs/heads/main");
  const C1 = git("rev-parse", "HEAD");
  console.log(`H0 ${H0}\nC1 ${C1}\n`);
  const exactPointerText = readFileSync(join(dir, POINTER_PATH), "utf8");

  // (a) 200 land + pointer rides the fold.
  console.log("(a) land with reviewed heads");
  const a = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: H0, heads: { [PROPOSAL_REPO]: C1 } } });
  const ev = a.json?.evidence ?? {};
  check("(a) 200 ok", a.status === 200 && a.json?.ok === true);
  const EVIDENCE_KEYS = ["repos", "commit", "ancestor", "heads", "foldHash", "checks", "results", "mergedSha", "testedSha", "artifactRef", "at", "lease"];
  const expectedKeys = "autoLand" in ev ? [...EVIDENCE_KEYS, "autoLand"] : EVIDENCE_KEYS;
  check("(a) evidence keys", exactKeys(ev, expectedKeys), JSON.stringify(Object.keys(ev)));
  check("(a) evidence.commit === landed.commit", !!ev.commit && ev.commit === a.json?.landed?.commit);
  check("(a) ancestor = fork point H0", ev.ancestor?.[PROPOSAL_REPO] === H0, JSON.stringify(ev.ancestor));
  check("(a) heads = fold inputs", ev.heads?.base === H0 && ev.heads?.repos?.[PROPOSAL_REPO] === C1, JSON.stringify(ev.heads));
  check("(a) foldHash sha256 hex", /^[0-9a-f]{64}$/.test(String(ev.foldHash)), String(ev.foldHash));
  check("(a) mergedSha === foldHash (sha256 hex)", typeof ev.mergedSha === "string" && ev.mergedSha === ev.foldHash && /^[0-9a-f]{64}$/.test(ev.mergedSha), String(ev.mergedSha));
  check("(a) at is an ISO timestamp", typeof ev.at === "string" && !Number.isNaN(Date.parse(ev.at)), String(ev.at));
  check("(a) landed.files includes the pointer AND the second change",
    Array.isArray(a.json?.landed?.files) && a.json.landed.files.includes(POINTER_PATH) && a.json.landed.files.includes(SECOND_PATH),
    JSON.stringify(a.json?.landed?.files));
  const C2 = ev.commit;
  check("(a) base remote ref === evidence.commit", (await lsBase()) === C2);
  check("(a) landed commit is a new sha (≠ fork point)", !!C2 && C2 !== H0);
  check("(a) success exact keys {ok,landed,evidence}", exactKeys(a.json, ["ok", "landed", "evidence"]), JSON.stringify(Object.keys(a.json ?? {})));
  check("(a) success no credential field", !credRe.test(a.body));
  check("(a) landed exact keys {repos,commit,files,at}", exactKeys(a.json?.landed, ["repos", "commit", "files", "at"]), JSON.stringify(a.json?.landed ?? null));
  check("(a) landed no credential field", !credRe.test(JSON.stringify(a.json?.landed ?? {})));
  execFileSync("git", ["fetch", `${gitBase}/${BASE_REPO}.git`, "main"], { cwd: dir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const landedPointer = execFileSync("git", ["show", `${C2}:${POINTER_PATH}`], { cwd: dir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  check("(a) pointer rode the fold byte-for-byte", landedPointer === exactPointerText, JSON.stringify(landedPointer.slice(0, 120)));

  // (a-changes) /changes renders the pointer metadata-only.
  console.log("(a-changes) GET /changes for the proposal");
  const ac = await getJson(`/changes?repo=${PROPOSAL_REPO}&base=${BASE_REPO}&ref=main`);
  const acRow = (ac.json?.changeSet?.files ?? []).find((f) => f.path === POINTER_PATH);
  check("(a-changes) 200 ok", ac.status === 200 && ac.json?.ok === true);
  check("(a-changes) pointer row carries asset metadata", !!acRow?.asset && acRow.asset.v === 1 && acRow.asset.blobId === CANARY, JSON.stringify(acRow?.asset));
  check("(a-changes) pointer row has a note", typeof acRow?.note === "string" && acRow.note.length > 0, String(acRow?.note));
  check("(a-changes) pointer row has no patch", acRow?.patch === undefined, JSON.stringify(acRow?.patch));
  check("(a-changes) pointer row has no additions/deletions", acRow?.additions === undefined && acRow?.deletions === undefined, JSON.stringify([acRow?.additions, acRow?.deletions]));
  check("(a-changes) canary IS present here (metadata egress, AD-10)", acRow?.asset?.blobId === CANARY);

  // (a-merge) /merge renders the pointer metadata-only, no merged text.
  console.log("(a-merge) GET /merge for the proposal");
  const am = await getJson(`/merge?base=${BASE_REPO}&repos=${PROPOSAL_REPO}`);
  const amMerge = am.json?.merge ?? {};
  const amRow = (amMerge.files ?? []).find((f) => f.path === POINTER_PATH);
  check("(a-merge) 200 ok / clean", am.status === 200 && am.json?.ok === true && amMerge.status === "clean", JSON.stringify(amMerge.status));
  check("(a-merge) pointer row result merged", amRow?.result === "merged", JSON.stringify(amRow));
  check("(a-merge) pointer row note is the pinned rendering law", amRow?.note === "asset pointer; metadata only", String(amRow?.note));
  check("(a-merge) pointer row carries asset metadata", !!amRow?.asset && amRow.asset.blobId === CANARY, JSON.stringify(amRow?.asset));
  check("(a-merge) pointer row has NO merged field (rendering law unchanged)", amRow?.merged === undefined, JSON.stringify(amRow?.merged));

  // (b) re-land same proposal, refreshed reviewed heads -> no-changes.
  console.log("(b) re-land (refreshed reviewed heads)");
  const b = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1 } } });
  check("(b) 409 no-changes", b.status === 409 && b.json?.error === "no-changes", JSON.stringify(b.json));
  check("(b) base unmoved", (await lsBase()) === C2);

  // (c) stale reviewed heads refuse before any fold (two variants).
  console.log("(c) stale reviewed heads");
  const c1 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { heads: { [PROPOSAL_REPO]: SHA_ZERO } } });
  const c2 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: SHA_ZERO, heads: { [PROPOSAL_REPO]: C1 } } });
  check("(c) stale proposal head -> 409 stale", c1.status === 409 && c1.json?.error === "stale", JSON.stringify(c1.json));
  check("(c) stale base head -> 409 stale", c2.status === 409 && c2.json?.error === "stale", JSON.stringify(c2.json));
  check("(c) base unmoved by refusals", (await lsBase()) === C2);
  check("(c) c1 exact keys {detail,error,ok}", exactKeys(c1.json, ["detail", "error", "ok"]), JSON.stringify(c1.json));
  check("(c) c2 exact keys {detail,error,ok}", exactKeys(c2.json, ["detail", "error", "ok"]), JSON.stringify(c2.json));
  check("(c) no credential field", !credRe.test(c1.body) && !credRe.test(c2.body));

  // (d) secret-class pointer path: masking + withholding + canary absence.
  console.log("(d) secret-class pointer path");
  secretDir = mkdtempSync(join(tmpdir(), "nextgit-r2i-secret-"));
  const gitSecret = (...args) =>
    execFileSync("git", args, { cwd: secretDir, env: gitAuthEnv(secretToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  gitSecret("clone", `${gitBase}/${SECRET_PROPOSAL_REPO}.git`, secretDir);
  gitSecret("config", "user.name", "r2-land-invariance-probe");
  gitSecret("config", "user.email", "probe@nextgit.dev");
  writeNested(secretDir, SECRET_POINTER_PATH, pointerJson(SECRET_CANARY, 99) + "\n");
  gitSecret("add", "-A");
  gitSecret("commit", "-m", "probe: secret-class pointer");
  gitSecret("push", "origin", "HEAD:refs/heads/main");
  const CS = gitSecret("rev-parse", "HEAD");
  const secretBodies = [];
  // (d-1) /changes masks the secret-class pointer to key names only.
  const d1 = await getJson(`/changes?repo=${SECRET_PROPOSAL_REPO}&base=${BASE_REPO}&ref=main`);
  secretBodies.push(d1.body);
  const dRow = (d1.json?.changeSet?.files ?? []).find((f) => f.path === SECRET_POINTER_PATH);
  check("(d-1) 200 ok", d1.status === 200 && d1.json?.ok === true);
  check("(d-1) row present", !!dRow, JSON.stringify((d1.json?.changeSet?.files ?? []).map((f) => f.path)));
  check("(d-1) row carries keys (key-names-only surface)", Array.isArray(dRow?.keys), JSON.stringify(dRow?.keys));
  check("(d-1) row has NO asset field (Task-1 wiring)", dRow?.asset === undefined, JSON.stringify(dRow?.asset));
  check("(d-1) row has no patch", dRow?.patch === undefined, JSON.stringify(dRow?.patch));
  check("(d-1) secret-class canary absent from the body", !d1.body.includes(SECRET_CANARY));
  // (d-2) /merge withholds the secret-class pointer.
  const d2 = await getJson(`/merge?base=${BASE_REPO}&repos=${SECRET_PROPOSAL_REPO}`);
  secretBodies.push(d2.body);
  const d2Row = (d2.json?.merge?.files ?? []).find((f) => f.path === SECRET_POINTER_PATH);
  check("(d-2) 200 ok", d2.status === 200 && d2.json?.ok === true);
  check("(d-2) result withheld-secret", d2Row?.result === "withheld-secret", JSON.stringify(d2Row));
  check("(d-2) no merged text", d2Row?.merged === undefined, JSON.stringify(d2Row?.merged));
  check("(d-2) secret-class canary absent from the body", !d2.body.includes(SECRET_CANARY));
  // (d-3) /land refuses with withheld-secret, base unmoved.
  const d3 = await land({ base: BASE_REPO, repos: [SECRET_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C2, heads: { [SECRET_PROPOSAL_REPO]: CS } } });
  secretBodies.push(d3.body);
  check("(d-3) 409 withheld-secret", d3.status === 409 && d3.json?.error === "withheld-secret", JSON.stringify(d3.json));
  check("(d-3) files names the secret-class path", JSON.stringify(d3.json?.files) === JSON.stringify([SECRET_POINTER_PATH]), JSON.stringify(d3.json?.files));
  check("(d-3) base ref unmoved", (await lsBase()) === C2);
  // (d-4) the canary appears in NO response body of (d-1)/(d-2)/(d-3).
  check("(d-4) secret-class canary in no response body", secretBodies.every((b) => !b.includes(SECRET_CANARY)));
  // (d-5) worker log tail: a real land mints a token (audit line observed)
  // and no log line ever carries a canary.
  console.log("(d-5) worker log tail during a real land");
  tail = spawnLogs({ cmd: WRANGLER, args: ["tail", WORKER, "--format", "json"], spawnOpts: { cwd: PLATFORM_DIR, env: process.env } });
  await sleep(6000);
  // Re-drive the refused secret land (must log nothing credential-shaped) …
  await land({ base: BASE_REPO, repos: [SECRET_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C2, heads: { [SECRET_PROPOSAL_REPO]: CS } } });
  // … and drive a pointer-free control land (mints the write token).
  ctrlDir = mkdtempSync(join(tmpdir(), "nextgit-r2i-ctrl-"));
  const gitCtrl = (...args) =>
    execFileSync("git", args, { cwd: ctrlDir, env: gitAuthEnv(ctrlToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  gitCtrl("clone", `${gitBase}/${CTRL_PROPOSAL_REPO}.git`, ctrlDir);
  gitCtrl("config", "user.name", "r2-land-invariance-probe");
  gitCtrl("config", "user.email", "probe@nextgit.dev");
  const CH0 = gitCtrl("rev-parse", "HEAD");
  writeFileSync(join(ctrlDir, "ctrl-change.txt"), `control chain ${new Date().toISOString()}\n`);
  gitCtrl("add", "-A");
  gitCtrl("commit", "-m", "probe: control change");
  gitCtrl("push", "origin", "HEAD:refs/heads/main");
  const CC1 = gitCtrl("rev-parse", "HEAD");
  const ctrlLand = await land({ base: CTRL_BASE_REPO, repos: [CTRL_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: CH0, heads: { [CTRL_PROPOSAL_REPO]: CC1 } } });
  // Bounded poll: edge log delivery is variable (the (d-5) flake — a flat
  // 9s capture window raced propagation and red the leg intermittently).
  // Poll for the audit line up to 15x2s before detaching.
  for (let i = 0; i < 15; i++) {
    const ev = parseTailEvents(tail.out);
    const txt = ev.flatMap((e) => messageTexts(e)).join("\n");
    if (/token-mint/.test(txt)) break;
    await sleep(2000);
  }
  tail.child.kill("SIGTERM");
  await sleep(1500);
  const tailEvents = parseTailEvents(tail.out);
  const tailText = tailEvents.flatMap((e) => messageTexts(e)).join("\n");
  check("(d-5) tail captured worker log events", tailEvents.length > 0, `events=${tailEvents.length}`);
  check("(d-5) tail observed the token-mint audit line", /token-mint/.test(tailText));
  check("(d-5) no canary in any worker log line", !tailText.includes(CANARY) && !tailText.includes(SECRET_CANARY));

  // (g) fork-point ancestor equality: control chain === asset chain === H0.
  console.log("(g) fork-point ancestor equality (asset vs pointer-free)");
  const ctrlEv = ctrlLand.json?.evidence ?? {};
  check("(g) control land 200 ok", ctrlLand.status === 200 && ctrlLand.json?.ok === true, JSON.stringify(ctrlLand.json));
  check("(g) control ancestor = fork point H0", ctrlEv.ancestor?.[CTRL_PROPOSAL_REPO] === H0, JSON.stringify(ctrlEv.ancestor));
  check("(g) asset-chain ancestor === control-chain ancestor === H0",
    ev.ancestor?.[PROPOSAL_REPO] === ctrlEv.ancestor?.[CTRL_PROPOSAL_REPO] && ctrlEv.ancestor?.[CTRL_PROPOSAL_REPO] === H0,
    JSON.stringify({ asset: ev.ancestor, ctrl: ctrlEv.ancestor }));

  // (e) conflict -> 409 conflict, base unmoved.
  console.log("(e) conflicting proposal");
  conflictDir = mkdtempSync(join(tmpdir(), "nextgit-r2i-conflict-"));
  const gitConflict = (...args) =>
    execFileSync("git", args, { cwd: conflictDir, env: gitAuthEnv(conflictToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  gitConflict("clone", `${gitBase}/${CONFLICT_PROPOSAL_REPO}.git`, conflictDir);
  gitConflict("config", "user.name", "r2-land-invariance-probe");
  gitConflict("config", "user.email", "probe@nextgit.dev");
  writeNested(conflictDir, SECOND_PATH, `divergent content ${new Date().toISOString()}\n`);
  gitConflict("add", "-A");
  gitConflict("commit", "-m", "probe: divergent edit");
  gitConflict("push", "origin", "HEAD:refs/heads/main");
  const CC = gitConflict("rev-parse", "HEAD");
  const e = await land({ base: BASE_REPO, repos: [CONFLICT_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C2, heads: { [CONFLICT_PROPOSAL_REPO]: CC } } });
  check("(e) 409 conflict", e.status === 409 && e.json?.error === "conflict", JSON.stringify(e.json));
  check("(e) conflicted names the second path", Array.isArray(e.json?.conflicted) && e.json.conflicted.includes(SECOND_PATH), JSON.stringify(e.json?.conflicted));
  check("(e) base ref unmoved", (await lsBase()) === C2);

  // (f) concurrent double-land -> one 200, loser 409, base advanced once.
  console.log("(f) concurrent double-land");
  writeFileSync(join(dir, "r2i-probe-2.txt"), `double land ${new Date().toISOString()}\n`);
  git("add", "-A");
  git("commit", "-m", "probe: edit for double land");
  git("push", "origin", "HEAD:refs/heads/main");
  const Cf = git("rev-parse", "HEAD");
  const raceBody = { base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: Cf } } };
  const racers = await Promise.all([land(raceBody), land(raceBody)]);
  const isWinner = (r) => r.status === 200 && r.json?.ok === true;
  const winners = racers.filter(isWinner);
  const losers = racers.filter((r) => !isWinner(r));
  check("(f) exactly one 200", winners.length === 1, JSON.stringify(racers.map((r) => r.status)));
  check("(f) loser 409 base-moved|stale, no success payload",
    losers.length === 1 && losers[0].status === 409 &&
    (losers[0].json?.error === "base-moved" || losers[0].json?.error === "stale") &&
    losers[0].json?.landed === undefined && losers[0].json?.evidence === undefined,
    JSON.stringify(losers.map((r) => [r.status, r.json?.error])));
  const Cw = winners[0]?.json?.evidence?.commit;
  check("(f) winner commit is a new sha", /^[0-9a-f]{40}$/.test(String(Cw)) && Cw !== C2 && Cw === winners[0]?.json?.landed?.commit, String(Cw));
  await sleep(1200);
  check("(f) base ref advanced exactly once to the winner commit", (await lsBase()) === Cw, String(Cw));

  // (g-moved) moved-base fold anchors at the fork point and keeps both sides.
  console.log("(g-moved) moved-base fold with the fork point as ancestor");
  const F = (git("ls-tree", "-r", "--name-only", "HEAD").split("\n")
    .find((p) => /\.(md|txt|json|yml|yaml)$/.test(p) && p !== SECOND_PATH)) ?? "README.md";
  let F0 = "";
  try { F0 = readFileSync(join(dir, F), "utf8"); } catch { /* absent at H0 */ }
  check("(g-moved) a baseline file existed at the fork point", F0.length > 0, `F=${F}`);
  // Proposal side: append the proposal marker.
  if (F0.length > 0) {
    writeNested(dir, F, F0 + PROP_MARKER + "\n");
    git("add", "-A");
    git("commit", "-m", `probe: edit ${F} (proposal side)`);
    git("push", "origin", "HEAD:refs/heads/main");
    const Cg = git("rev-parse", "HEAD");
    // Baseline side: prepend the baseline marker from the moved base head.
    baseDir = mkdtempSync(join(tmpdir(), "nextgit-r2i-base-"));
    const gitBaseRepo = (...args) =>
      execFileSync("git", args, { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    gitBaseRepo("clone", `${gitBase}/${BASE_REPO}.git`, baseDir);
    gitBaseRepo("config", "user.name", "r2-land-invariance-probe");
    gitBaseRepo("config", "user.email", "probe@nextgit.dev");
    const X1 = readFileSync(join(baseDir, F), "utf8");
    writeNested(baseDir, F, BASE_MARKER + "\n" + X1);
    gitBaseRepo("add", "-A");
    gitBaseRepo("commit", "-m", `probe: edit ${F} (baseline side)`);
    gitBaseRepo("push", "origin", "HEAD:refs/heads/main");
    const Cm = gitBaseRepo("rev-parse", "HEAD");
    check("(g-moved) base advanced by the baseline-side commit", Cm !== C2 && (await lsBase()) === Cm);
    const gm = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: Cm, heads: { [PROPOSAL_REPO]: Cg } } });
    const gmEv = gm.json?.evidence ?? {};
    check("(g-moved) 200 ok", gm.status === 200 && gm.json?.ok === true, JSON.stringify(gm.json));
    check("(g-moved) ancestor = fork point while the base head moved", gmEv.ancestor?.[PROPOSAL_REPO] === H0 && gmEv.heads?.base === Cm && Cm !== H0, JSON.stringify({ ancestor: gmEv.ancestor, heads: gmEv.heads }));
    execFileSync("git", ["fetch", "origin", "main"], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const landedF = execFileSync("git", ["show", `${gmEv.commit}:${F}`], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    check("(g-moved) landed file keeps the baseline-side change", landedF.includes(BASE_MARKER), landedF.slice(0, 120));
    check("(g-moved) landed file keeps the proposal-side change", landedF.includes(PROP_MARKER));
  }

  // (h) precondition order: stale beats withheld-secret; withheld-secret beats conflict.
  console.log("(h) precondition order");
  const h1 = await land({ base: BASE_REPO, repos: [SECRET_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { heads: { [SECRET_PROPOSAL_REPO]: SHA_ZERO } } });
  check("(h) stale beats withheld-secret", h1.status === 409 && h1.json?.error === "stale", JSON.stringify(h1.json));
  const h2 = await land({ base: BASE_REPO, repos: [SECRET_PROPOSAL_REPO, CONFLICT_PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: (await lsBase()), heads: { [SECRET_PROPOSAL_REPO]: CS, [CONFLICT_PROPOSAL_REPO]: CC } } });
  check("(h) withheld-secret beats conflict", h2.status === 409 && h2.json?.error === "withheld-secret", JSON.stringify(h2.json));
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  if (tail) {
    try { tail.child.kill("SIGTERM"); } catch { /* already gone */ }
  }
  for (const name of [PROPOSAL_REPO, BASE_REPO, SECRET_PROPOSAL_REPO, CONFLICT_PROPOSAL_REPO, CTRL_PROPOSAL_REPO, CTRL_BASE_REPO]) {
    try {
      const r = await deleteRepo(name);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      check(`cleanup deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (err) {
      check(`cleanup deleted ${name}`, false, String(err));
    }
  }
  for (const d of [dir, baseDir, ctrlDir, ctrlBaseDir, secretDir, conflictDir]) {
    if (d) rmSync(d, { recursive: true, force: true });
  }
}

console.log(fails === 0 ? "\nPASS — r2-land-invariance probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
