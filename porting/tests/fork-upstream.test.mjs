#!/usr/bin/env bun
// Contract suite: POST /upstream — route a fork's work back to its
// upstream with /land-shaped evidence (CAP-10).
// Run: bun porting/tests/fork-upstream.test.mjs   (exit 0 = pass)
//
// Real construction: the REAL worker (worker.fetch) against an
// in-memory Artifacts fake whose base repo's `info()` returns a
// remote served by an in-process `git http-backend` smart-HTTP
// server, so the /upstream path — clone, fold, commit, push, KV
// landing record — executes for real. `gitServerMain(g)` observes
// the parent's landed tip — the only offline way to prove "A's
// head advanced". No module mocks, no source grep. The test seeds
// env.CACHE with `fork:<name>` lineage records directly (it does
// not run fanout; the fanout write is proven by a live-gated leg,
// §4.2 below). Idiom: auto-land-gate.test.mjs.
//
// The fixture: parent `demo` (bare repo `demo.git` on the git
// server) + forks whose history is [forkHead, baseCommit] (fork
// point = baseCommit). Lineage seeded as
// `fork:<fork> = {repo:"demo", forkPoint: baseCommit.hash}`.

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import fs from "node:fs";
import os from "node:os";

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
 if (!ok) fails++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push seam.
// ---------------------------------------------------------------------------

const repoDir = fs.mkdtempSync(join(os.tmpdir(), "fork-upstream-"));
function sh(args, cwd = repoDir) {
 const r = spawnSync("git", args, { cwd, encoding: "utf8" });
 if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
 return r.stdout;
}

// The server holds ONE bare repo per test environment (a factory, so
// environments cannot alias): each makeGitServer() materializes a fresh
// bare `demo.git` and serves it at its own port.
function makeGitServer() {
 const dir = fs.mkdtempSync(join(repoDir, "srv-"));
 const bareDir = join(dir, "demo.git");
 const workDir = join(dir, "work");
 fs.mkdirSync(workDir, { recursive: true });
 const w = (args) => sh(args, workDir);
 w(["init", "-q", "-b", "main"]);
 w(["config", "user.email", "fixture@test"]);
 w(["config", "user.name", "fixture"]);
 fs.mkdirSync(join(workDir, "src"), { recursive: true });
 fs.writeFileSync(join(workDir, "src", "a.ts"), "export const a = 1;\n");
 w(["add", "-A"]);
 w(["commit", "-qm", "base"]);
 sh(["clone", "--bare", workDir, bareDir], dir);
 sh(["-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], dir);
 sh(["-C", bareDir, "config", "http.receivepack", "true"], dir);

 const server = createServer((req, res) => {
  const url = `http://localhost${req.url}`;
  const backend = spawn("git", ["http-backend"], {
   cwd: dir,
   env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_PROJECT_ROOT: dir,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: new URL(url).pathname,
    REQUEST_METHOD: req.method,
    QUERY_STRING: new URL(url).searchParams.toString(),
    CONTENT_TYPE: req.headers["content-type"] ?? "",
    REMOTE_ADDR: "127.0.0.1",
   },
   stdio: ["pipe", "pipe", "ignore"],
  });
  if (req.method === "POST" || req.method === "PUT") {
   const chunks = [];
   req.on("data", (c) => chunks.push(c));
   req.on("end", () => backend.stdin.end(Buffer.concat(chunks)));
  } else {
   backend.stdin.end();
  }
  let headers = {};
  const body = [];
  let status = 200;
  backend.stdout.on("data", (d) => body.push(d));
  backend.on("close", () => {
   const buf = Buffer.concat(body);
   const idx = buf.indexOf("\r\n\r\n");
   const head = buf.slice(0, idx).toString();
   const payload = buf.slice(idx + 4);
   for (const line of head.split("\r\n")) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
     const k = m[1].toLowerCase();
     if (k === "status") status = parseInt(m[2].split(" ")[0], 10);
     else headers[m[1]] = m[2];
    }
   }
   res.writeHead(status, headers);
   res.end(payload);
  });
 });
 return { dir, bareDir, server };
}

async function startGitServer() {
 const g = makeGitServer();
 await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
 g.port = g.server.address().port;
 g.remote = `http://127.0.0.1:${g.port}/demo.git`;
 return g;
}

/** Current tip of the served bare repo's main (the observable landed state). */
function gitServerMain(g) {
 return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (judge.test.mjs shape) — info() points at the
// per-environment git server so pushLand's clone/push run for real.
// ---------------------------------------------------------------------------

function makeFakeArtifacts(g) {
 const blobText = new Map(); // hash -> text
 const blobHashByText = new Map(); // text -> hash
 const treeEntries = new Map(); // tree hash -> entries
 const repos = new Map(); // name -> { history, refs, intents }

 function internBlob(text) {
  if (!blobHashByText.has(text)) {
   const hash = `blob-${blobHashByText.size + 1}`;
   blobHashByText.set(text, hash);
   blobText.set(hash, text);
  }
  return blobHashByText.get(text);
 }
 function entriesFor(node) {
  return Object.entries(node).map(([name, child]) => {
   if (typeof child === "string") return { name, mode: "100644", hash: child, type: "blob" };
   return { name, mode: "40000", hash: treeHashFor(child), type: "tree" };
  });
 }
 function treeHashFor(node) {
  const entries = entriesFor(node);
  const hash = `tree-${treeEntries.size + 1}`;
  treeEntries.set(hash, entries);
  return hash;
 }
 function tree(files) {
  const root = {};
  for (const [path, text] of Object.entries(files)) {
   const parts = path.split("/");
   let node = root;
   for (const part of parts.slice(0, -1)) {
    node[part] = node[part] || {};
    node = node[part];
   }
   node[parts[parts.length - 1]] = internBlob(text);
  }
  return treeHashFor(root);
 }
 function commit(hash, treeHash) {
  const identity = { name: "fixture", email: "fixture@test" };
  return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
 }
 function defineRepo(name, { history, refs, intents = {} }) {
  repos.set(name, { history, refs, intents });
 }
 function lookupPath(treeHash, path) {
  const parts = path.split("/");
  let entries = treeEntries.get(treeHash);
  for (let i = 0; i < parts.length; i++) {
   const entry = (entries ?? []).find((e) => e.name === parts[i]);
   if (!entry) return null;
   if (i === parts.length - 1) return entry.type === "blob" ? entry.hash : null;
   if (entry.type !== "tree") return null;
   entries = treeEntries.get(entry.hash);
  }
  return null;
 }
 function repoFor(name) {
  const store = repos.get(name);
  if (!store) throw new Error(`fixture: no repo ${name}`);
  const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
  return {
   async log({ ref = "HEAD", limit = 50 } = {}) {
    const byBranch = store.refs[ref];
    if (byBranch) return store.history.slice(0, limit);
    const single = resolve(ref);
    return single ? [single].slice(0, limit) : [];
   },
   async readTree(hash) {
    return treeEntries.get(hash) ?? null;
   },
   async readFile({ ref, path }) {
    const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
    if (!head) return null;
    const blobHash = lookupPath(head.treeHash, path);
    return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
   },
   async readBlob(hash) {
    return blobText.has(hash) ? new Blob([blobText.get(blobHash)]) : null;
   },
   async info() {
    // The push seam: the base repo's remote is the in-process
    // git server, so pushLand clones and pushes for real.
    return { remote: g.remote };
   },
   async createToken(_scope, _ttl) {
    tokenMints++;
    return { plaintext: `fake-write-token-${tokenMints}` };
   },
   async revokeToken() {
    return true;
   },
   [Symbol.dispose]() { },
  };
 }
 let tokenMints = 0;
 return {
  async get(name) {
   return repoFor(name);
  },
  async list() {
   return { repos: [] };
  },
  _fixture: { internBlob, tree, commit, defineRepo, tokenMints: () => tokenMints },
 };
}

// ---------------------------------------------------------------------------
// Fixture: `demo` base + the /upstream fork fleet. Each environment
// gets its OWN git server + fake (no aliasing).
// ---------------------------------------------------------------------------

const A0 = "export const a = 1;\n";
const A1 = "export const a = 2;\n";
const A2 = "export const a = 3;\n";
const B0 = "export const b = 1;\n";
const ENV_FILE = "API_TOKEN=fixture_secret_value\n";

function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) {
   return store.get(key) ?? null;
  },
  async put(key, value) {
   store.set(key, value);
  },
 };
}

/**
 * The /upstream fixture. `demo`'s head IS the git server's real main
 * tip (pushLand clones the server, folds, commits, pushes, and the
 * AD-3 precondition compares the fold's expected base head against a
 * re-read of the server's tip — the two must be the same sha or every
 * upstream is refused as base-moved). Forks carry history
 * [forkHead, baseCommit] so the fork point is baseCommit.
 *
 * `lineage` seeds the `fork:<name>` records (the provisioning seam's
 * write) — absent for the no-lineage leg.
 */
async function makeEnvironmentAsync(lineage = true) {
 const g = await startGitServer();
 const baseSha = gitServerMain(g);
 const artifacts = makeFakeArtifacts(g);
 const F = artifacts._fixture;

 const BASE_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": ENV_FILE };
 const c1 = F.commit(baseSha, F.tree(BASE_FILES));
 F.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

 // agent-1: bumps src/a.ts A0 -> A1 (the happy-path change)
 const a1 = F.commit("c-agent-1", F.tree({ ...BASE_FILES, "src/a.ts": A1 }));
 F.defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash } });

 // agent-3: same tree as demo (the no-changes case)
 const a3 = F.commit("c-agent-3", F.tree(BASE_FILES));
 F.defineRepo("agent-3", { history: [a3, c1], refs: { main: a3.hash } });

 // agent-env: forks then touches config/.env (the withheld-secret case)
 const aEnvFork = F.commit("c-agent-env", F.tree({ ...BASE_FILES, "config/.env": "API_TOKEN=another_value\n" }));
 F.defineRepo("agent-env", { history: [aEnvFork, c1], refs: { main: aEnvFork.hash } });

 // agent-collide: bumps src/a.ts A0 -> A1 while the base later moves
 // A0 -> A2 (the merge-conflict case: both sides edit the same lines)
 const aCollide = F.commit("c-agent-collide", F.tree({ ...BASE_FILES, "src/a.ts": A1 }));
 F.defineRepo("agent-collide", { history: [aCollide, c1], refs: { main: aCollide.hash } });

 // agent-x: allowlisted, used for the base-mismatch leg
 const aX = F.commit("c-agent-x", F.tree({ ...BASE_FILES, "src/b.ts": "export const b = 2;\n" }));
 F.defineRepo("agent-x", { history: [aX, c1], refs: { main: aX.hash } });

 const env = {
  ARTIFACTS: artifacts,
  LIVE: makeFakeKV(),
  CACHE: makeFakeKV(),
  ASSETS: { fetch: async () => new Response("") },
  AI: { async run() { return { model: "clef", answers: {}, usage: { neurons: 0 } }; } },
  AUTH_MODE: "demo",
 };

 // Seed the lineage records — the provisioning seam's write. The
 // recorded fork point is the base commit every fork shares.
 if (lineage) {
  for (const name of ["agent-1", "agent-3", "agent-env", "agent-collide", "agent-x"]) {
   await env.CACHE.put(`fork:${name}`, JSON.stringify({ repo: "demo", forkPoint: c1.hash }));
  }
 }

 return { g, env, F, baseCommit: c1 };
}

// ---------------------------------------------------------------------------
// Driver helpers.
// ---------------------------------------------------------------------------

const capturedWaitUntil = [];
const fakeCtx = {
 waitUntil(p) {
  capturedWaitUntil.push(p);
  p.catch((e) => console.log("waitUntil error:", String(e)));
 },
};

async function upstream(env, payload, ip = "10.9.0.1") {
 const res = await worker.fetch(
  new Request("https://nextgit.test/upstream", {
   method: "POST",
   headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
   body: JSON.stringify(payload),
  }),
  env,
  fakeCtx,
 );
 return readJson(res);
}

/** Read the persisted landing record back through the worker's own read surface. */
async function readLanding(env, commit) {
 const res = await worker.fetch(
  new Request(`https://nextgit.test/landings/${commit}`, { method: "GET" }),
  env,
 );
 return readJson(res);
}

// ---------------------------------------------------------------------------
// 1. Happy path — the acceptance.
// ---------------------------------------------------------------------------
{
 const { g, env, baseCommit } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r = await upstream(env, { repo: "agent-1" });
 check("1a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
 check("1b body.ok", r.body?.ok === true, JSON.stringify(r.body));
 const commit = r.body?.landed?.commit;
 check("1c evidence.commit is a NEW sha", typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit), String(commit));
 const after = gitServerMain(g);
 check("1d gitServerMain === evidence.commit (real push)", after === commit, `server ${after} commit ${commit}`);
 check("1e base advanced by exactly ONE server-side commit", after !== before, `before ${before} after ${after}`);
 // the new commit's parent is the base commit (advanced by exactly one)
 const parent = sh(["-C", g.bareDir, "rev-parse", `${commit}^`], g.dir).trim();
 check("1f evidence.commit^ === baseCommit (one commit on top)", parent === baseCommit.hash, `parent ${parent} base ${baseCommit.hash}`);
 const ev = r.body?.evidence;
 check("1g evidence.ancestor['agent-1'] === recorded fork point", ev?.ancestor?.["agent-1"] === baseCommit.hash, JSON.stringify(ev?.ancestor));
 check("1h evidence.heads.base === base head", ev?.heads?.base === baseCommit.hash, JSON.stringify(ev?.heads));
 check("1i evidence.heads.repos['agent-1'] === fork head", ev?.heads?.repos?.["agent-1"] === "c-agent-1", JSON.stringify(ev?.heads?.repos));
 // the 12-key /land evidence, mechanically (no autoLand)
 const EXPECTED_KEYS = ["repos", "commit", "ancestor", "heads", "foldHash", "checks", "results", "mergedSha", "testedSha", "artifactRef", "at", "lease"];
 check("1j evidence key-set is exactly the 12 /land keys", ev && Object.keys(ev).length === 12 && EXPECTED_KEYS.every((k) => k in ev), JSON.stringify(Object.keys(ev ?? {})));
 check("1k evidence.foldHash === evidence.mergedSha", ev?.foldHash === ev?.mergedSha && typeof ev?.foldHash === "string" && /^[0-9a-f]{64}$/.test(ev?.foldHash), JSON.stringify({ foldHash: ev?.foldHash, mergedSha: ev?.mergedSha }));
 check("1l degenerate no-validation ledger", deepEqual(ev?.checks, ["merged-sha-equals-tested-sha"]) && deepEqual(ev?.results, ["not-recorded"]) && ev?.testedSha === null && ev?.artifactRef === null, JSON.stringify({ checks: ev?.checks, results: ev?.results }));
 check("1m landed.repos === ['agent-1']", deepEqual(r.body?.landed?.repos, ["agent-1"]), JSON.stringify(r.body?.landed));
 check("1n landed.files carries src/a.ts", deepEqual(r.body?.landed?.files, ["src/a.ts"]), JSON.stringify(r.body?.landed?.files));
 // GET /landings/{commit} serves the record: landed/evidence deep-equal the 200
 const rec = await readLanding(env, commit);
 check("1o GET /landings/{commit} status 200", rec.status === 200, `got ${rec.status} ${JSON.stringify(rec.body)}`);
 check("1p persisted landed deep-equals the 200 body's", deepEqual(rec.body?.landed, r.body?.landed), JSON.stringify({ persisted: rec.body?.landed, live: r.body?.landed }));
 check("1q persisted evidence deep-equals the 200 body's", deepEqual(rec.body?.evidence, ev), JSON.stringify({ persisted: rec.body?.evidence, live: ev }));
 // the folded tree on the server carries src/a.ts === A1
 const folded = sh(["-C", g.bareDir, "show", `${commit}:src/a.ts`], g.dir);
 check("1r folded tree on the server carries src/a.ts === A1", folded === A1, JSON.stringify(folded));
}

// ---------------------------------------------------------------------------
// 2. No-changes — agent-3 (same tree as demo) → 409 no-changes.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r = await upstream(env, { repo: "agent-3" });
 check("2a status 409 no-changes", r.status === 409 && r.body?.error === "no-changes", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("2b gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 3. No lineage — agent-none (allowlisted, no fork: record) → 400 no-lineage.
// ---------------------------------------------------------------------------
{
 const { g, env, F } = await makeEnvironmentAsync(false);
 const before = gitServerMain(g);
 const r = await upstream(env, { repo: "agent-none" });
 check("3a status 400 no-lineage", r.status === 400 && r.body?.error === "no-lineage", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("3b gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// 4. Base mismatch — agent-x lineage {repo:"demo"} but POST /upstream
//    {repo:"agent-x", base:"agent-1"} (a fork name, never its
//    parent) → 409 conflict. The mismatched base must itself be
//    allowlisted — the AD-9 chokepoint 403s a non-demo base
//    before the lineage check fires.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r = await upstream(env, { repo: "agent-x", base: "agent-1" });
 check("4a status 409 conflict", r.status === 409 && r.body?.error === "conflict", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("4b gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 5. Non-demo repo — POST /upstream {repo:"evil-repo"} → 403
//    repo-not-allowed, before any repo read (counting fake).
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 let gets = 0;
 const realGet = env.ARTIFACTS.get.bind(env.ARTIFACTS);
 env.ARTIFACTS.get = async (name) => {
  gets++;
  return realGet(name);
 };
 const r = await upstream(env, { repo: "evil-repo" });
 check("5a status 403 repo-not-allowed", r.status === 403 && r.body?.error === "repo-not-allowed", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("5b zero Artifacts.get reads (fires before any repo read)", gets === 0, `got ${gets}`);
 check("5c gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 6. Closed schema — unknown field → 400; missing repo → 400.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r1 = await upstream(env, { repo: "agent-1", validation: { checks: ["x"] } });
 check("6a unknown field (validation) → 400 bad-request", r1.status === 400 && r1.body?.error === "bad-request", `got ${r1.status} ${JSON.stringify(r1.body)}`);
 const r2 = await upstream(env, {});
 check("6b missing repo → 400", r2.status === 400, `got ${r2.status} ${JSON.stringify(r2.body)}`);
 const r3 = await upstream(env, { repo: "agent-1", ref: "main" });
 check("6c ref is not a body param → 400", r3.status === 400, `got ${r3.status} ${JSON.stringify(r3.body)}`);
 check("6d gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 7. Stale reviewed heads — wrong baseHead → 409 stale; wrong fork head
//    → 409 stale.
// ---------------------------------------------------------------------------
{
 const { g, env, baseCommit } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r1 = await upstream(env, {
  repo: "agent-1",
  reviewed: { baseHead: "0".repeat(40), heads: { "agent-1": "c-agent-1" } },
 });
 check("7a wrong reviewed.baseHead → 409 stale", r1.status === 409 && r1.body?.error === "stale", `got ${r1.status} ${JSON.stringify(r1.body)}`);
 const r2 = await upstream(env, {
  repo: "agent-1",
  reviewed: { baseHead: baseCommit.hash, heads: { "agent-1": "0".repeat(40) } },
 });
 check("7b wrong reviewed.heads['agent-1'] → 409 stale", r2.status === 409 && r2.body?.error === "stale", `got ${r2.status} ${JSON.stringify(r2.body)}`);
 check("7c gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 8. Withheld secret — agent-env (fork touches config/.env) → 409
//    withheld-secret with files:["config/.env"]; the secret VALUE
//    appears nowhere in the response body.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r = await upstream(env, { repo: "agent-env" });
 check("8a status 409 withheld-secret", r.status === 409 && r.body?.error === "withheld-secret", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("8b files === ['config/.env']", deepEqual(r.body?.files, ["config/.env"]), JSON.stringify(r.body?.files));
 check("8c the secret VALUE appears nowhere in the response body", !JSON.stringify(r.body).includes("fixture_secret_value") && !JSON.stringify(r.body).includes("another_value"), JSON.stringify(r.body));
 check("8d gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 9. Merge conflict — demo advanced src/a.ts A0 → A2 after the fork
//    point; agent-collide changes A0 → A1 → 409 conflict with
//    conflicted:["src/a.ts"]; gitServerMain unchanged (still the
//    advanced demo head).
// ---------------------------------------------------------------------------
{
 const { g, env, F, baseCommit } = await makeEnvironmentAsync();
 // Advance the parent: A0 -> A2, one commit on main.
 // The work dir was `git init`'d fresh (no origin), so
 // push straight to the bare repo the server serves —
 // the bare repo's main IS the served tip
 // (gitServerMain reads it), and pushLand's own push
 // goes through the http-backend separately.
 const w = (args) => sh(args, join(g.dir, "work"));
 fs.writeFileSync(join(g.dir, "work", "src", "a.ts"), A2);
 w(["add", "-A"]);
 w(["commit", "-qm", "advance demo A0->A2"]);
 w(["push", "-q", g.bareDir, "main"]);
 const advancedHead = gitServerMain(g);
 check("9a fixture: demo advanced on the server", advancedHead !== baseCommit.hash, `base ${baseCommit.hash} advanced ${advancedHead}`);
 // Re-point the fake's demo repo at the advanced head (the
 // worker reads the fold's base through the binding). The
 // advanced history is [advancedCommit, baseCommit] — the
 // fake's per-ref log still finds baseCommit shared with the
 // fork, so the fork-point walk is unchanged.
 const advancedCommit = F.commit(advancedHead, F.tree({ "src/a.ts": A2, "src/b.ts": B0, "config/.env": ENV_FILE }));
 F.defineRepo("demo", {
  history: [advancedCommit, baseCommit],
  refs: { main: advancedCommit.hash },
 });
 const r = await upstream(env, { repo: "agent-collide" });
 check("9b status 409 conflict", r.status === 409 && r.body?.error === "conflict", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("9c conflicted === ['src/a.ts']", deepEqual(r.body?.conflicted, ["src/a.ts"]), JSON.stringify(r.body?.conflicted));
 check("9d gitServerMain unchanged (still the advanced demo head)", gitServerMain(g) === advancedHead, `advanced ${advancedHead} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 10. Rate limit — the 21st POST /upstream from one caller
//     (unique CF-Connecting-IP) → 429 rate-limited. The
//     first 20 pass the allowlist/shape gate and LAND (the
//     in-isolate fixed window admits 20/min), so the 21st is
//     the refused one — the same shape as the /land rate
//     burst (rate-limit.test.mjs §2).
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const ip = "10.9.9.9";
 let last = null;
 for (let i = 0; i < 21; i++) {
  last = await upstream(env, { repo: "agent-1" }, ip);
 }
 check("10a the 21st /upstream from one caller → 429 rate-limited", last.status === 429 && last.body?.error === "rate-limited", `got ${last.status} ${JSON.stringify(last.body)}`);
 // The 21st is the refusal: it must not advance the head
 // past the 20th land's tip (the refusal leaves A's head
 // unchanged — the acceptance's per-refusal law).
 const tip = gitServerMain(g);
 const r22 = await upstream(env, { repo: "agent-1" }, ip);
 check("10b the refused 21st/22nd leave the head unchanged", r22.status === 429 && gitServerMain(g) === tip, `tip ${tip} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 11. Auth seam — AUTH_MODE unset → 401 unauthorized before any
//     handler read (the default-deny chokepoint).
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const deniedEnv = { ...env, AUTH_MODE: undefined };
 const res = await worker.fetch(
  new Request("https://nextgit.test/upstream", {
   method: "POST",
   headers: { "content-type": "application/json", "CF-Connecting-IP": "10.9.0.2" },
   body: JSON.stringify({ repo: "agent-1" }),
  }),
  deniedEnv,
  fakeCtx,
 );
 const r = await readJson(res);
 check("11a AUTH_MODE unset → 401 unauthorized", r.status === 401 && r.body?.error === "unauthorized", `got ${r.status} ${JSON.stringify(r.body)}`);
 check("11b gitServerMain unchanged", gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
}

// ---------------------------------------------------------------------------
// 12. Route discipline — POST /upstream is registered with action
//     "write" (the authorize() chokepoint covers it), and GET
//     /upstream answers 405 (the boundary law).
// ---------------------------------------------------------------------------
{
 const { ROUTES } = await import("../../platform/src/index.ts");
 const entry = ROUTES.find((r) => r.path === "/upstream");
 check("12a ROUTES carries POST /upstream with action write", entry !== undefined && entry.method === "POST" && entry.action === "write", JSON.stringify(entry));
 const { g, env } = await makeEnvironmentAsync();
 const res = await worker.fetch(new Request("https://nextgit.test/upstream", { method: "GET" }), env, fakeCtx);
 check("12b GET /upstream → 405 method-not-allowed", res.status === 405, `got ${res.status}`);
}

// ---------------------------------------------------------------------------
// 4.2 Live-gated fanout leg (gated on CLOUDFLARE_API_TOKEN; else one
// SKIP line): spawn the real fanout.mjs against the live namespace
// with a throwaway baseline, assert the `fork:<name>` record lands in
// the CACHE namespace (KV REST GET) with `repo` = the baseline and a
// 40-hex `forkPoint`. Proves the provisioning seam records lineage
// end-to-end (the fanout-token-lifecycle.test.mjs leg-2 pattern).
// ---------------------------------------------------------------------------
{
 const token = process.env.CLOUDFLARE_API_TOKEN;
 if (!token) {
  console.log("SKIP  4.2 live fanout lineage leg — CLOUDFLARE_API_TOKEN not set");
 } else {
  const OUT = `/tmp/nextgit-fork-upstream-agents.json`;
  const env = { ...process.env, AGENTS_OUT: OUT, ARTIFACTS_NAMESPACE: "nextgit" };
  const FANOUT = join(import.meta.dir, "..", "..", "platform", "scripts", "fanout.mjs");
  const result = spawnSync("node", [FANOUT, "1", "demo", "604800"], { env, encoding: "utf8" });
  check("4.2a fanout subprocess exit 0", result.status === 0, `exit=${result.status} stderr=${result.stderr?.slice(0, 200)}`);
  // The lineage record must be readable back through the KV REST API
  // with repo = the baseline and a 40-hex forkPoint.
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
  const cacheId = process.env.CACHE_NAMESPACE_ID ?? "55d973240e2d4770a07ddc0faedf757c";
  const kv = await fetch(
   `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${cacheId}/values/${encodeURIComponent("fork:agent-1")}`,
   { headers: { Authorization: `Bearer ${token}` } },
  );
  check("4.2b KV REST GET fork:agent-1 → 200", kv.status === 200, `got ${kv.status}`);
  if (kv.status === 200) {
   const rec = await kv.json().catch(() => null);
   check("4.2c lineage record {repo:'demo', forkPoint:40-hex}", rec?.repo === "demo" && /^[0-9a-f]{40}$/.test(rec?.forkPoint ?? ""), JSON.stringify(rec));
  }
 }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
