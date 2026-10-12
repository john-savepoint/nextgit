#!/usr/bin/env bun
// Contract suite for the reference-counted, lifecycle-safe
// asset-blob delete path (e12 lifecycle — the
// nextgit-e12-impl-lifecycle-safe-deletes-no-orphans order's
// deliverable B).
//
// Run: bun porting/tests/asset-gc.test.mjs   (exit 0 = pass)
//
// Idiom: r2-asset-tier.test.mjs — the real worker module
// imported and exercised through worker.fetch against an
// in-memory Artifacts fake + a stubbed ASSET_BLOB (the
// platform binding seam is the only thing stubbed; no
// mock.module, no source grep; full-suite safe, no network,
// no live fixtures — demo/agent-1..5 are never touched).
//
// The fixture's base repo remote points at an in-process
// git smart-HTTP server (git http-backend), so pushLand's
// clone/fold/commit/push run for real — the land path is
// the real code path, not a simulated one.
//
// Groups (each defends an observable contract):
//   1. Zero-reference delete — the only pointer to blobX is
//      removed by the fold -> 200, the pointer is gone from
//      the base tree, blobX is gone from the stubbed R2, and
//      the log seam recorded asset-blob-deleted.
//   2. Shared-blob survival — blobX is pointed at by two
//      repos; one removal lands -> 200, pointer gone, blobX
//      STILL in the R2 store (asset-blob-retained).
//   3. Fold-touched-only (NFR-1) — a land that removes a
//      NON-pointer file performs zero ASSET_BLOB.delete calls
//      and a bounded walk (the fake counts readTree/list
//      invocations).
//   4. R2 failure never fails the land — ASSET_BLOB.delete
//      throws -> land still 200, pointer gone,
//      asset-gc-failed logged.
//   5. Union is manifest-derived (rebuildability) — after
//      the land, collectReferencedBlobIds against the same
//      fake yields exactly the surviving manifests' blobIds
//      (no hidden index state).
//   6. Invariance — a land with no pointer rows behaves
//      byte-identically to pre-GC (response shape, evidence
//      keys).

import worker from "../../platform/src/index.ts";
import { collectReferencedBlobIds } from "../../platform/src/asset-gc.ts";
import { assetPointerFor } from "../../platform/src/assets.ts";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

let fails = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
 if (!ok) fails++;
 else passes++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push seam.
// The makeGitServer factory shape from auto-land-gate.test.mjs: each
// environment gets its OWN bare repo + server port, so environments
// cannot alias.
// ---------------------------------------------------------------------------
const repoDir = mkdtempSync(join(tmpdir(), "asset-gate-"));
function sh(args, cwd = repoDir) {
 const r = spawnSync("git", args, { cwd, encoding: "utf8" });
 if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
 return r.stdout;
}

function makeGitServer(files) {
 const dir = mkdtempSync(join(repoDir, "srv-"));
 const bareDir = join(dir, "demo.git");
 const workDir = join(dir, "work");
 mkdirSync(workDir, { recursive: true });
 const w = (args) => sh(args, workDir);
 w(["init", "-q", "-b", "main"]);
 w(["config", "user.email", "fixture@test"]);
 w(["config", "user.name", "fixture"]);
 for (const [path, text] of Object.entries(files)) {
  const abs = join(workDir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
 }
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

async function startGitServer(files) {
 const g = makeGitServer(files);
 await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
 g.port = g.server.address().port;
 g.remote = `http://127.0.0.1:${g.port}/demo.git`;
 return g;
}

/** Current tip of the served bare repo's main (the observable landed state). */
function gitServerMain(g) {
 return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
}

/** The landed tree of the served bare repo (read back over git). */
function gitServerTree(g) {
 const out = sh(["-C", g.bareDir, "ls-tree", "-r", "--name-only", "refs/heads/main"], g.dir);
 return new Set(out.split("\n").filter(Boolean));
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake — one instance per environment (a factory,
// so environments cannot alias). The surface the land path reads:
// get/log/readTree/readBlob/list. The base repo's info() points at
// the per-environment git server so pushLand's clone/push run for real.
// ---------------------------------------------------------------------------
function makeFakeArtifacts(g) {
 const IDENTITY = { name: "fixture", email: "fixture@test" };
 const blobText = new Map(); // hash -> text
 const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
 const treeEntries = new Map(); // tree hash -> entries
 const repos = new Map(); // name -> { history, refs, intents }
 const discovered = []; // [{ name, status }] — the list() surface
 const counters = { readTree: 0, list: 0 }; // walk-bound counters (group 3)

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
  return { hash, treeHash, message: hash, author: IDENTITY, committer: IDENTITY, parents: [], authoredAt: 0, committedAt: 0 };
 }
 function defineRepo(name, { history, refs, intents = {}, serverBacked = false }) {
  repos.set(name, { history, refs, intents, serverBacked });
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
  // The base repo is the REAL git server's store: log/readTree/
  // readBlob/readFile delegate to the served bare repo, so a land's
  // push is visible to the binding immediately — exactly as the live
  // Artifacts binding reflects a push (the post-push union walk must
  // read the landed tree, not a stale snapshot).
  const gitOut = (args) => {
   const r = spawnSync("git", ["-C", g.bareDir, ...args], { cwd: g.dir, encoding: "utf8" });
   return r.status === 0 ? r.stdout : null;
  };
  const resolveServerRef = (ref) => {
   const out = gitOut(["rev-parse", "--verify", `${ref}^{commit}`]) ?? gitOut(["rev-parse", "--verify", `refs/heads/${ref}^{commit}`]);
   return out ? out.trim() : null;
  };
  const serverLog = (ref, limit) => {
   const tip = resolveServerRef(ref);
   if (!tip) return [];
   const out = gitOut(["rev-list", `--max-count=${limit}`, tip]);
   if (out === null) return [];
   return out.split("\n").filter(Boolean).map((sha) => ({ hash: sha, treeHash: `server:${sha}`, message: "base", author: IDENTITY, committer: IDENTITY, parents: [], authoredAt: 0, committedAt: 0 }));
  };
  const serverLsTree = (sha) => {
   const out = gitOut(["ls-tree", "-r", sha]);
   if (out === null) return [];
   return out.split("\n").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t");
    const type = meta.split(" ")[1];
    return { name: path, mode: "100644", hash: `server:${sha}:${path}`, type: type === "tree" ? "tree" : "blob" };
   });
  };
  const splitServerKey = (hash) => {
   const rest = hash.slice("server:".length);
   const i = rest.indexOf(":");
   return i === -1 ? { sha: rest, path: null } : { sha: rest.slice(0, i), path: rest.slice(i + 1) };
  };
  const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
  return {
   async log({ ref = "HEAD", limit = 50 } = {}) {
    if (store.serverBacked) return serverLog(ref, limit);
    const byBranch = store.refs[ref];
    if (byBranch) return store.history.slice(0, limit);
    const single = resolve(ref);
    return single ? [single].slice(0, limit) : [];
   },
   async readTree(hash) {
    counters.readTree++;
    if (typeof hash === "string" && hash.startsWith("server:")) return serverLsTree(splitServerKey(hash).sha);
    return treeEntries.get(hash) ?? null;
   },
   async readFile({ ref, path }) {
    if (store.serverBacked) {
     const sha = resolveServerRef(ref);
     if (!sha) return null;
     const text = gitOut(["show", `${sha}:${path}`]);
     return text === null ? null : new Blob([text]);
    }
    const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
    if (!head) return null;
    if (path.startsWith("NEXTGIT_INTENT/")) {
     const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
     const text = store.intents[sha];
     return text === undefined ? null : new Blob([text]);
    }
    const blobHash = lookupPath(head.treeHash, path);
    return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
   },
   async readBlob(hash) {
    if (typeof hash === "string" && hash.startsWith("server:")) {
     const { sha, path } = splitServerKey(hash);
     const text = gitOut(["show", `${sha}:${path}`]);
     return text === null ? null : new Blob([text]);
    }
    return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
   },
   async info() {
    // The push seam: the base repo's remote is the in-process
    // git server, so pushLand clones and pushes for real.
    return { remote: g.remote };
   },
   async createToken(_scope, _ttl) {
    return { plaintext: `fake-write-token-${name}` };
   },
   async revokeToken() {
    return true;
   },
   [Symbol.dispose]() { },
  };
 }
 return {
  counters,
  discovered,
  ARTIFACTS: {
   async get(name) {
    return repoFor(name);
   },
   async list({ limit = 200 } = {}) {
    counters.list++;
    return { repos: discovered.slice(0, limit) };
   },
  },
  tree,
  commit,
  defineRepo,
 };
}

// ---------------------------------------------------------------------------
// Fixture — base `demo` + proposal repos, each head committed over the
// shared base commit (so the fork point is that base).
// ---------------------------------------------------------------------------
const BASE_FILES = { "src/a.ts": "export const a = 1;\nexport const keep = true;\n" };

// Two content-addressed asset blobs (real sha256 blobIds).
const ASSET_A_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const POINTER_A = await assetPointerFor(ASSET_A_BYTES, "application/octet-stream");
const POINTER_A_TEXT = `${JSON.stringify(POINTER_A, null, 2)}\n`;

// ---------------------------------------------------------------------------
// Stubbed ASSET_BLOB — in-memory R2 (the platform binding seam),
// extended with a delete-call ledger (group 1/2/3 assertions).
// ---------------------------------------------------------------------------
function makeR2Store() {
 const store = new Map(); // key -> Uint8Array
 const deleted = []; // keys the binding was asked to delete
 let failDelete = false; // group 4: delete throws
 const blob = {
  async get(key) {
   const bytes = store.get(key);
   if (!bytes) return null;
   return { body: new Blob([bytes]), httpMetadata: {} };
  },
  async put(key, value) {
   store.set(key, new Uint8Array(await value.arrayBuffer()));
  },
  async delete(key) {
   deleted.push(key);
   if (failDelete) throw new Error("fixture: R2 delete failure");
   store.delete(key);
  },
 };
 return { store, deleted, blob, setFailDelete() { failDelete = true; } };
}

// Synchronous git-server construction is impossible (listen is async),
// so the fixture builder is async — the same posture as
// auto-land-gate.test.mjs's makeEnvironmentAsync. The base tree is
// committed BOTH into the served bare repo (so pushLand's clone sees
// it) and into the fake (so the fold/compute reads see it) — the base
// head sha is the server tip, which is the AD-3 precondition the land
// compares against.
async function makeEnvironmentAsync(baseFiles = BASE_FILES) {
 const g = await startGitServer(baseFiles);
 const fake = makeFakeArtifacts(g);
 const base = fake.commit(gitServerMain(g), fake.tree(baseFiles));
 fake.defineRepo("demo", { history: [base], refs: { main: base.hash }, serverBacked: true });
 fake.discovered.push({ name: "demo", status: "ready", defaultBranch: "main" });
 return { g, fake, base };
}

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

// fake ctx that captures waitUntil calls (land-waituntil.test.mjs shape).
const fakeCtx = {
 waitUntil(p) {
  p.catch((e) => console.log("waitUntil error:", String(e)));
 },
};

function envFor(fake, r2) {
 return {
  ARTIFACTS: fake.ARTIFACTS,
  LIVE: makeFakeKV(),
  CACHE: makeFakeKV(),
  ASSETS: { fetch: async () => new Response("") },
  AI: { run: async () => null },
  ASSET_BLOB: r2.blob,
  AUTH_MODE: "demo",
 };
}

async function post(env, body) {
 const res = await worker.fetch(
  new Request("https://nextgit.test/land", {
   method: "POST",
   headers: { "content-type": "application/json", "CF-Connecting-IP": "10.7.0.1" },
   body: JSON.stringify(body),
  }),
  env,
  fakeCtx,
 );
 return readJson(res);
}

// Captured log seam (the NFR-3 log idiom: console.log(event, JSON)).
let logLines = [];
const realLog = console.log;
console.log = (...args) => {
 logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
 realLog(...args);
};

// ---------------------------------------------------------------------------
// 1. Zero-reference delete.
// ---------------------------------------------------------------------------
{
 const { g, fake, base } = await makeEnvironmentAsync({ ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT });
 const r2 = makeR2Store();
 r2.store.set(POINTER_A.blobId, ASSET_A_BYTES);

 // agent-1 REMOVES the pointer the base carries: the fold is a real
 // delete (action "delete") and the base no longer carries the path
 // after the land.
 const a1 = fake.commit("c-agent-1", fake.tree(BASE_FILES));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 const before = gitServerMain(g);
 const r = await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 check("1a land 200", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.error ?? r.body));
 check("1b base ref advanced (real push)", gitServerMain(g) !== before, `before ${before} after ${gitServerMain(g)}`);
 // The pointer is gone from the base tree.
 const landedTree = gitServerTree(g);
 check("1c pointer gone from the base tree", !landedTree.has("assets/hero.asset.json"), JSON.stringify([...landedTree]));
 // blobX is gone from the stubbed R2.
 check("1d blob deleted from the R2 store", !r2.store.has(POINTER_A.blobId), `store keys: ${[...r2.store.keys()]}`);
 check("1e ASSET_BLOB.delete called with blobId", r2.deleted.includes(POINTER_A.blobId), JSON.stringify(r2.deleted));
 check("1f log seam recorded asset-blob-deleted", logLines.some((l) => l.startsWith("asset-blob-deleted") && l.includes(POINTER_A.blobId)), JSON.stringify(logLines.filter((l) => l.includes("asset-blob"))));

 g.server.close();
}

// ---------------------------------------------------------------------------
// 2. Shared-blob survival.
// ---------------------------------------------------------------------------
{
 logLines = [];
 const { g, fake, base } = await makeEnvironmentAsync({ ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT });
 const r2 = makeR2Store();
 r2.store.set(POINTER_A.blobId, ASSET_A_BYTES);

 // agent-1 removes the base's pointer; agent-2 STILL carries a
 // pointer at another path that references the same blob.
 const a1 = fake.commit("c-agent-1", fake.tree(BASE_FILES));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });
 const a2 = fake.commit("c-agent-2", fake.tree({ ...BASE_FILES, "assets/b.asset.json": POINTER_A_TEXT }));
 fake.defineRepo("agent-2", { history: [a2, base], refs: { main: a2.hash } });
 fake.discovered.push({ name: "agent-2", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 const r = await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 check("2a land 200", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.error ?? r.body));
 const landedTree = gitServerTree(g);
 check("2b agent-1's pointer gone from the base tree", !landedTree.has("assets/hero.asset.json"), JSON.stringify([...landedTree]));
 // agent-2's pointer is still in agent-2's tree, which the
 // post-push union walk reads — so the blob survives.
 check("2c blob STILL in the R2 store (shared)", r2.store.has(POINTER_A.blobId), `store keys: ${[...r2.store.keys()]}`);
 check("2d ASSET_BLOB.delete NOT called", r2.deleted.length === 0, JSON.stringify(r2.deleted));
 check("2e log seam recorded asset-blob-retained", logLines.some((l) => l.startsWith("asset-blob-retained") && l.includes(POINTER_A.blobId)), JSON.stringify(logLines.filter((l) => l.includes("asset-blob"))));

 g.server.close();
}

// ---------------------------------------------------------------------------
// 3. Fold-touched-only (NFR-1): a land that removes a NON-pointer
// file performs zero ASSET_BLOB.delete calls and a bounded walk.
// ---------------------------------------------------------------------------
{
 logLines = [];
 const { g, fake, base } = await makeEnvironmentAsync({ ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT });
 const r2 = makeR2Store();
 r2.store.set(POINTER_A.blobId, ASSET_A_BYTES);

 // agent-1 REMOVES src/a.ts but KEEPS the pointer unchanged — a
 // plain delete fold with NO pointer rows. The GC step must not run.
 const { "src/a.ts": _removed, ...agentFiles } = { ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT };
 const a1 = fake.commit("c-agent-1", fake.tree(agentFiles));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 const r = await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 check("3a land 200 (plain delete fold)", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.error ?? r.body));
 check("3b zero ASSET_BLOB.delete calls", r2.deleted.length === 0, JSON.stringify(r2.deleted));
 check("3c no asset-blob log lines", logLines.every((l) => !l.startsWith("asset-blob-")), JSON.stringify(logLines));
 // Bounded walk: the GC step never ran (no pointer rows), so the
 // fake's readTree counter reflects only the fold's own reads —
 // the land path's change-set computation. The exact count is
 // fixture-shaped; the contract is that it is finite and small.
 check("3d walk bounded (finite readTree count)", Number.isFinite(fake.counters.readTree) && fake.counters.readTree < 1000, `readTree=${fake.counters.readTree}`);

 g.server.close();
}

// ---------------------------------------------------------------------------
// 4. R2 failure never fails the land.
// ---------------------------------------------------------------------------
{
 logLines = [];
 const { g, fake, base } = await makeEnvironmentAsync({ ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT });
 const r2 = makeR2Store();
 r2.store.set(POINTER_A.blobId, ASSET_A_BYTES);
 r2.setFailDelete();

 const a1 = fake.commit("c-agent-1", fake.tree(BASE_FILES));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 const r = await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 check("4a land still 200 (best-effort GC)", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.error ?? r.body));
 const landedTree = gitServerTree(g);
 check("4b pointer gone from the base tree", !landedTree.has("assets/hero.asset.json"), JSON.stringify([...landedTree]));
 check("4c the R2 delete failure is logged, content-free", logLines.some((l) => l.startsWith("asset-blob-delete-failed") && l.includes(POINTER_A.blobId)), JSON.stringify(logLines.filter((l) => l.includes("asset-"))));

 g.server.close();
}

// ---------------------------------------------------------------------------
// 5. Union is manifest-derived (rebuildability).
// ---------------------------------------------------------------------------
{
 const { g, fake, base } = await makeEnvironmentAsync({ ...BASE_FILES, "assets/hero.asset.json": POINTER_A_TEXT });
 const r2 = makeR2Store();
 r2.store.set(POINTER_A.blobId, ASSET_A_BYTES);

 const a1 = fake.commit("c-agent-1", fake.tree(BASE_FILES));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 // After the land, the union recomputed on demand is exactly the
 // surviving manifests' blobIds — the removed pointer no longer
 // contributes (neither demo nor agent-1 carries it), so the union
 // is EMPTY and nothing references blobA. No hidden index state.
 const referenced = await collectReferencedBlobIds(env);
 check("5a post-land union excludes the removed pointer's blob", !referenced.has(POINTER_A.blobId), JSON.stringify([...referenced]));
 check("5b union is empty (no surviving pointer manifests)", referenced.size === 0, JSON.stringify([...referenced]));

 g.server.close();
}

// ---------------------------------------------------------------------------
// 6. Invariance: a land with no pointer rows behaves byte-identically
// to pre-GC (response shape, evidence keys).
// ---------------------------------------------------------------------------
{
 logLines = [];
 const { g, fake, base } = await makeEnvironmentAsync();
 const r2 = makeR2Store();

 const a1 = fake.commit("c-agent-1", fake.tree({ ...BASE_FILES, "src/b.ts": "export const b = 2;\n" }));
 fake.defineRepo("agent-1", { history: [a1, base], refs: { main: a1.hash } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const env = envFor(fake, r2);
 const r = await post(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });

 check("6a land 200", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.error ?? r.body));
 const evidenceKeys = Object.keys(r.body?.evidence ?? {}).sort();
 const LAND_EVIDENCE_KEYS = ["ancestor", "artifactRef", "at", "checks", "commit", "foldHash", "heads", "lease", "mergedSha", "repos", "results", "testedSha"].sort();
 // The 12-key shape: the contract keys + lease (autoLand is
 // engaged-only — unengaged here).
 check("6b evidence key-set is the pre-GC 12-key shape", JSON.stringify(evidenceKeys) === JSON.stringify(LAND_EVIDENCE_KEYS), JSON.stringify(evidenceKeys));
 check("6c zero ASSET_BLOB.delete calls", r2.deleted.length === 0, JSON.stringify(r2.deleted));
 check("6d no asset-blob log lines", logLines.every((l) => !l.startsWith("asset-blob-")), JSON.stringify(logLines));

 g.server.close();
}

rmSync(repoDir, { recursive: true, force: true });
console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
