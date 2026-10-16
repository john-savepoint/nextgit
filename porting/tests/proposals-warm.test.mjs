#!/usr/bin/env bun
// Contract suite: warm-after-land (nextgit-e20).
// Run: bun porting/tests/proposals-warm.test.mjs   (exit 0 = pass)
//
// A successful POST /land or POST /upstream schedules
// ctx.waitUntil(warmProposalsCache(env, ctx)) — a background
// recompute through the SAME computeProposals seam — so the
// generation the land's cache:gen bump invalidates is re-warmed
// before the next reader. Six check groups, each defending an
// observable contract (the plan §3 ladder). Real construction:
// the REAL worker (worker.fetch) against an in-process git
// smart-HTTP server + in-memory Artifacts fake; the fake ctx
// captures waitUntil promises and actually runs them so their
// KV writes are observable. No module mocks, no source grep.
// Idiom: fork-upstream.test.mjs + land-waituntil.test.mjs.

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

const repoDir = fs.mkdtempSync(join(os.tmpdir(), "proposals-warm-"));
function sh(args, cwd = repoDir) {
 const r = spawnSync("git", args, { cwd, encoding: "utf8" });
 if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
 return r.stdout;
}

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
// In-memory Artifacts fake (fork-upstream.test.mjs shape). list() returns the
// demo fleet so the warm's computeProposals(env,"demo","main","main",null)
// auto-discovery arm is non-empty; info() points at the per-environment git
// server so pushLand's clone/push run for real.
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
    return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
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
  // The warm's computeProposals auto-discovery arm (repoList=null)
  // reads this — the demo fleet must be discoverable for the warm
  // to produce a non-empty proposals set.
  async list() {
   return {
    repos: [
     { name: "demo", status: "ready" },
     { name: "agent-1", status: "ready" },
     { name: "agent-2", status: "ready" },
     { name: "agent-3", status: "ready" },
     { name: "agent-4", status: "ready" },
    ],
   };
  },
  _fixture: { internBlob, tree, commit, defineRepo, tokenMints: () => tokenMints },
 };
}

// ---------------------------------------------------------------------------
// Fixture: `demo` base + the agent fleet. Each environment gets its OWN git
// server + fake (no cross-test aliasing). demo's head IS the git server's
// real main tip, so pushLand clones/folds/commits/pushes for real.
// ---------------------------------------------------------------------------

const A0 = "export const a = 1;\n";
const A1 = "export const a = 2;\n";
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
  _store: store,
 };
}

/**
 * The proposals-warm fixture. Forks carry history [forkHead, baseCommit] so
 * the fork point is baseCommit; lineage is seeded as
 * `fork:<name> = {repo:"demo", forkPoint: baseCommit.hash}`. The Artifacts
 * fake's list() exposes the demo fleet (agent-1..4) so the warm's
 * computeProposals auto-discovery produces proposals.
 */
async function makeEnvironmentAsync() {
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

 // agent-2: bumps src/b.ts B0 -> B1 (a second clean fork for the conflict map)
 const a2 = F.commit("c-agent-2", F.tree({ ...BASE_FILES, "src/b.ts": "export const b = 2;\n" }));
 F.defineRepo("agent-2", { history: [a2, c1], refs: { main: a2.hash } });

 // agent-3: same tree as demo (the no-changes refusal case)
 const a3 = F.commit("c-agent-3", F.tree(BASE_FILES));
 F.defineRepo("agent-3", { history: [a3, c1], refs: { main: a3.hash } });

 const env = {
  ARTIFACTS: artifacts,
  LIVE: makeFakeKV(),
  CACHE: makeFakeKV(),
  ASSETS: { fetch: async () => new Response("") },
  AI: { async run() { return { model: "clef", answers: {}, usage: { neurons: 0 } }; } },
  AUTH_MODE: "demo",
 };

 // Seed the lineage records (the provisioning seam's write).
 for (const name of ["agent-1", "agent-2", "agent-3"]) {
  await env.CACHE.put(`fork:${name}`, JSON.stringify({ repo: "demo", forkPoint: c1.hash }));
 }

 return { g, env, F, baseCommit: c1 };
}

// ---------------------------------------------------------------------------
// Driver helpers.
// ---------------------------------------------------------------------------

// The fake ctx: captures every waitUntil promise AND lets it run, so the
// warm's KV writes (and recordEvent's cache:gen bump) are observable after
// the response returns (the land-waituntil.test.mjs:20-28 shape).
const capturedWaitUntil = [];
const fakeCtx = {
 waitUntil(p) {
  capturedWaitUntil.push(p);
  p.catch((e) => console.log("waitUntil error:", String(e)));
 },
};

async function land(env, payload, ip = "10.9.0.1") {
 const res = await worker.fetch(
  new Request("https://nextgit.test/land", {
   method: "POST",
   headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
   body: JSON.stringify(payload),
  }),
  env,
  fakeCtx,
 );
 return readJson(res);
}

async function upstream(env, payload, ip = "10.9.0.2") {
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

/** GET /proposals (the route's own compute — cache-miss path by gen). */
async function getProposals(env, query) {
 const res = await worker.fetch(
  new Request(`https://nextgit.test/proposals${query}`, { method: "GET" }),
  env,
 );
 return readJson(res);
}

/** Let every captured waitUntil promise settle; return them. */
async function settleWaitUntil() {
 const ps = capturedWaitUntil.splice(0);
 await Promise.all(ps);
 return ps;
}

/** All KV keys (in the CACHE namespace) written under a cache:proposals: prefix. */
function proposalsKeys(cache) {
 return [...cache._store.keys()].filter((k) => k.startsWith("cache:proposals:"));
}

/**
 * Among the settled captured promises, find the ones whose completion wrote a
 * cache:proposals: key. The waitUntil promise itself is opaque, so the
 * observable is the KV store: the warm's puts are the only writes of that
 * prefix among the captured promises' side effects (the land's OWN writes —
 * landing:<commit>, fork lineage, cache:gen — are different prefixes, and the
 * landing-record/landing-registry writes happen SYNCHRONOUSLY in the land,
 * not via a captured waitUntil).
 */
async function warmWrites(cache) {
 const before = new Set(cache._store.keys());
 await settleWaitUntil();
 const wrote = [...cache._store.keys()].filter((k) => k.startsWith("cache:proposals:") && !before.has(k));
 return wrote;
}

// ---------------------------------------------------------------------------
// 1. Land success schedules exactly one warm, keyed on the current gen.
// ---------------------------------------------------------------------------
{
 const { g, env, baseCommit } = await makeEnvironmentAsync();
 // Seed a pre-land generation so the warm's key is observable against it.
 await env.CACHE.put("cache:gen", "pre-land-gen");
 const r = await land(env, { repos: ["agent-1"], base: "demo" });
 check("1a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
 check("1b body.ok", r.body?.ok === true, JSON.stringify(r.body));
 const commit = r.body?.landed?.commit;
 check("1c evidence.commit is a NEW sha", typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit), String(commit));
 check("1d gitServerMain === evidence.commit (real push)", gitServerMain(g) === commit, `server ${gitServerMain(g)} commit ${commit}`);
 check("1e landed repos === ['agent-1']", deepEqual(r.body?.landed?.repos, ["agent-1"]), JSON.stringify(r.body?.landed?.repos));
 // The land's own recordEvent waitUntil bumped cache:gen to a NEW value.
 const genAfter = env.CACHE._store.get("cache:gen");
 check("1f cache:gen advanced past pre-land-gen", typeof genAfter === "string" && genAfter !== "pre-land-gen" && genAfter !== null, `got "${genAfter}"`);
 // Exactly ONE warm: the seam writes BOTH the wildcard key AND the
 // explicit-subset key (the verbatim cron block warms both — salvage
 // 650a550), on the post-land generation the land's own recordEvent
 // waitUntil bumped. One warm = both keys, same gen.
 const warmKeys = await warmWrites(env.CACHE);
 check(
  "1g exactly one warm (both its keys) on the post-land gen",
  warmKeys.length === 2 && warmKeys.every((k) => k.startsWith(`cache:proposals:${genAfter}:demo:main:main:`)),
  `got ${warmKeys.length}: ${JSON.stringify(warmKeys)} (gen ${genAfter})`,
 );
 const warmKey = warmKeys.find((k) => k.endsWith(":*")) ?? "";
 check(
  "1h warm wildcard key carries the post-land gen and the demo/main/main/* shape",
  warmKey === `cache:proposals:${genAfter}:demo:main:main:*`,
  `want cache:proposals:${genAfter}:demo:main:main:* got "${warmKey}"`,
 );
 const subsetKey = warmKeys.find((k) => k.endsWith(":agent-1,agent-2,agent-3,agent-4")) ?? "";
 check(
  "1h2 warm subset key carries the post-land gen and the agent-1..4 subset",
  subsetKey === `cache:proposals:${genAfter}:demo:main:main:agent-1,agent-2,agent-3,agent-4`,
  `got "${subsetKey}"`,
 );
 const warmBody = env.CACHE._store.get(warmKey);
 let parsed = null;
 try {
  parsed = JSON.parse(warmBody ?? "null");
 } catch {
  parsed = null;
 }
 check("1i warmed value parses as the compute seam's {ok:true,...} envelope", parsed?.ok === true, `ok=${parsed?.ok}`);
 check("1j warmed base is demo/main", parsed?.base?.repo === "demo" && parsed?.base?.ref === "main", JSON.stringify(parsed?.base));
 check(
  "1k warmed proposals is a non-empty array (fleet discoverable)",
  Array.isArray(parsed?.proposals) && parsed.proposals.length > 0,
  `got ${JSON.stringify(parsed?.proposals?.length)}`,
 );
 check(
  "1l warmed proposals[0] is agent-1 (sorted auto-discovery)",
  parsed?.proposals?.[0]?.repo === "agent-1",
  JSON.stringify(parsed?.proposals?.map((p) => p.repo)),
 );
}

// ---------------------------------------------------------------------------
// 2. The warm is the CURRENT (post-land) gen, not the pre-land gen.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 // Seed a pre-land gen AND a stale proposals entry under it.
 await env.CACHE.put("cache:gen", "old-gen");
 await env.CACHE.put("cache:proposals:old-gen:demo:main:main:*", JSON.stringify({ ok: true, stale: true }));
 const r = await land(env, { repos: ["agent-1"], base: "demo" });
 check("2a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
 const genAfter = env.CACHE._store.get("cache:gen");
 check("2b cache:gen is a NEW value (not old-gen)", genAfter !== "old-gen" && genAfter !== null, `got "${genAfter}"`);
 const warmKeys = await warmWrites(env.CACHE);
 const warmKey = warmKeys.find((k) => k.endsWith(":*")) ?? "";
 check(
  "2c warm key carries the NEW gen (re-armed post-land generation)",
  warmKey === `cache:proposals:${genAfter}:demo:main:main:*`,
  `want cache:proposals:${genAfter}:demo:main:main:* got "${warmKey}"`,
 );
 const staleStillThere = env.CACHE._store.get("cache:proposals:old-gen:demo:main:main:*");
 check("2d the pre-land stale entry is untouched (warm writes only the new gen)", staleStillThere === JSON.stringify({ ok: true, stale: true }), `got "${staleStillThere}"`);
}

// ---------------------------------------------------------------------------
// 3. A throwing warm does not affect the response.
// ---------------------------------------------------------------------------
{
 const { g, env, F } = await makeEnvironmentAsync();
 // First land (baseline) so we can then break the KV put path.
 const r1 = await land(env, { repos: ["agent-1"], base: "demo" });
 check("3a baseline land 200", r1.status === 200 && r1.body?.ok === true, `got ${r1.status}`);
 await settleWaitUntil();
 // The baseline land folded agent-1's A0->A1 into the base. For the
 // second land to be a real change (not 409 no-changes), define a
 // NEW fork (agent-2) carrying a DISTINCT change (src/b.ts B0->B1),
 // and keep the fake's `demo` head in sync with the advanced server
 // tip so the second land's AD-3 precondition (the fold's expected
 // base head vs a re-read server tip) still matches — otherwise the
 // second land is refused base-moved before the warm runs, which
 // would not exercise the throwing-warm path at all.
 const landedTip = gitServerMain(g);
 const landedFiles = { "src/a.ts": A1, "src/b.ts": B0, "config/.env": ENV_FILE };
 const landedCommit = F.commit(landedTip, F.tree(landedFiles));
 F.defineRepo("demo", { history: [landedCommit], refs: { main: landedCommit.hash } });
 const b1 = F.commit("c-agent-2b", F.tree({ ...landedFiles, "src/b.ts": "export const b = 2;\n" }));
 F.defineRepo("agent-2", { history: [b1, landedCommit], refs: { main: b1.hash } });
 await env.CACHE.put("fork:agent-2", JSON.stringify({ repo: "demo", forkPoint: landedCommit.hash }));
 // Key-scoped fault: every non-proposals put succeeds (landing record,
 // registry, cache:gen); only the WARM's own `cache:proposals:` put throws,
 // so the waitUntil warm actually runs and the warmup-failed swallow must
 // contain its failure — and 3d' below asserts the throw really happened
 // (both wave-20 gate lenses caught the old `puts > 2` aiming at
 // recordEvent's cache:gen write, which skipped the warm entirely).
 const realCache = env.CACHE;
 const store = realCache._store;
 let warmThrows = 0;
 const failingCache = {
  async get(key) {
   return store.get(key) ?? null;
  },
  async put(key, value) {
   if (String(key).startsWith("cache:proposals:")) {
    warmThrows++;
    throw new Error("kv-fault");
   }
   store.set(key, value);
  },
  _store: store,
 };
 env.CACHE = failingCache;
 const mainBefore = gitServerMain(g);
 const r2 = await land(env, { repos: ["agent-2"], base: "demo" });
 check("3b second land 200 ok:true despite throwing KV put", r2.status === 200 && r2.body?.ok === true, `got ${r2.status} ${JSON.stringify(r2.body)}`);
 check("3c gitServerMain advanced (the land itself succeeded)", gitServerMain(g) !== mainBefore && gitServerMain(g) === r2.body?.landed?.commit, `server ${gitServerMain(g)} commit ${r2.body?.landed?.commit}`);
 // The captured warm promise must SETTLE (not reject into the test).
 const captured = capturedWaitUntil.splice(0);
 let allSettled = true;
 try {
  await Promise.all(captured);
 } catch {
  allSettled = false;
 }
 check("3d all captured waitUntil promises settled (warmup-failed swallow)", allSettled, `${captured.length} promises`);
 check("3d' the warm actually ran and threw on its own generation put (fault exercised, not vacuous)",
  warmThrows >= 1, `warmThrows=${warmThrows}`);
 env.CACHE = realCache;
}

// ---------------------------------------------------------------------------
// 4. No warm on refusals. Each leg uses a fresh capturedWaitUntil.
// ---------------------------------------------------------------------------
async function refusalLeg(name, payload, wantStatus, wantError) {
 capturedWaitUntil.splice(0);
 const { g, env } = await makeEnvironmentAsync();
 const before = gitServerMain(g);
 const r = await land(env, payload);
 check(
  `${name} status ${wantStatus} ${wantError}`,
  r.status === wantStatus && r.body?.error === wantError,
  `got ${r.status} ${JSON.stringify(r.body)}`,
 );
 check(`${name} gitServerMain unchanged (nothing landed)`, gitServerMain(g) === before, `before ${before} after ${gitServerMain(g)}`);
 const warmKeys = await warmWrites(env.CACHE);
 check(`${name} zero cache:proposals writes among settled waitUntil`, warmKeys.length === 0, `got ${JSON.stringify(warmKeys)}`);
}
await refusalLeg("4a no-changes", { repos: ["agent-3"], base: "demo" }, 409, "no-changes");
await refusalLeg("4b stale", { repos: ["agent-1"], base: "demo", reviewed: { baseHead: "0".repeat(40) } }, 409, "stale");
await refusalLeg("4c repo-not-allowed", { repos: ["evil-repo"], base: "demo" }, 403, "repo-not-allowed");

// ---------------------------------------------------------------------------
// 5. /upstream success schedules the warm too (the second surface).
// ---------------------------------------------------------------------------
{
 const { g, env, baseCommit } = await makeEnvironmentAsync();
 await env.CACHE.put("cache:gen", "pre-upstream-gen");
 const r = await upstream(env, { repo: "agent-1" });
 check("5a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
 check("5b body.ok", r.body?.ok === true, JSON.stringify(r.body));
 const commit = r.body?.landed?.commit;
 check("5c gitServerMain === evidence.commit (real push)", gitServerMain(g) === commit, `server ${gitServerMain(g)} commit ${commit}`);
 const genAfter = env.CACHE._store.get("cache:gen");
 check("5d cache:gen advanced past pre-upstream-gen", genAfter !== "pre-upstream-gen" && genAfter !== null, `got "${genAfter}"`);
 const warmKeys = await warmWrites(env.CACHE);
 check(
  "5e exactly one warm (both its keys) on the post-land gen",
  warmKeys.length === 2 && warmKeys.every((k) => k.startsWith(`cache:proposals:${genAfter}:demo:main:main:`)),
  `got ${warmKeys.length}: ${JSON.stringify(warmKeys)} (gen ${genAfter})`,
 );
 const warmKey = warmKeys.find((k) => k.endsWith(":*")) ?? "";
 check(
  "5f warm wildcard key carries the post-land gen and demo/main/main/* shape",
  warmKey === `cache:proposals:${genAfter}:demo:main:main:*`,
  `want cache:proposals:${genAfter}:demo:main:main:* got "${warmKey}"`,
 );
 const subsetKey = warmKeys.find((k) => k.endsWith(":agent-1,agent-2,agent-3,agent-4")) ?? "";
 check(
  "5f2 warm subset key carries the post-land gen and the agent-1..4 subset",
  subsetKey === `cache:proposals:${genAfter}:demo:main:main:agent-1,agent-2,agent-3,agent-4`,
  `got "${subsetKey}"`,
 );
}

// ---------------------------------------------------------------------------
// 6. The seam reuses the same compute (no duplicate logic) — observable:
//    the warmed value's proposals[0].identity.fingerprint equals the
//    fingerprint GET /proposals (fresh compute, same env) returns.
// ---------------------------------------------------------------------------
{
 const { g, env } = await makeEnvironmentAsync();
 const r = await land(env, { repos: ["agent-1"], base: "demo" });
 check("6a land 200", r.status === 200 && r.body?.ok === true, `got ${r.status}`);
 await settleWaitUntil();
 // The land bumped the gen, so a GET /proposals now is a cache MISS (the
 // route's own compute — its put writes the same key the warm wrote, but the
 // READ path computes fresh). The fingerprint is the same because both paths
 // call the same computeProposals.
 const fresh = await getProposals(env, "?base=demo&repos=agent-1");
 check("6b GET /proposals 200 ok:true", fresh.status === 200 && fresh.body?.ok === true, `got ${fresh.status} ${JSON.stringify(fresh.body)}`);
 const freshFp = fresh.body?.proposals?.[0]?.identity?.fingerprint;
 check("6c fresh compute carries a fingerprint", typeof freshFp === "string" && freshFp.length > 0, String(freshFp));
 // Read the warmed value back from the KV the warm wrote.
 const warmKeys = [...env.CACHE._store.keys()].filter((k) => k.startsWith("cache:proposals:") && k.endsWith(":*"));
 check("6d the warm wrote the * key", warmKeys.length >= 1, `got ${JSON.stringify(warmKeys)}`);
 const warmBody = env.CACHE._store.get(warmKeys[0]);
 let warmed = null;
 try {
  warmed = JSON.parse(warmBody ?? "null");
 } catch {
  warmed = null;
 }
 const warmFp = warmed?.proposals?.[0]?.identity?.fingerprint;
 check("6e warmed proposals[0].identity.fingerprint === fresh GET /proposals fingerprint", warmFp === freshFp, `warm ${warmFp} fresh ${freshFp}`);
 // The envelope shapes are byte-equivalent (same {ok:true, base, ref,
 // proposals, conflicts, summary} keys — the same computeProposals return).
 const warmKeysSorted = Object.keys(warmed ?? {}).sort().join(",");
 const freshKeysSorted = Object.keys(fresh.body ?? {}).sort().join(",");
 check("6f warmed envelope key-set === GET /proposals envelope key-set", warmKeysSorted === freshKeysSorted, `warm [${warmKeysSorted}] fresh [${freshKeysSorted}]`);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
