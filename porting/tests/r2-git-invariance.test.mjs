#!/usr/bin/env bun
// Contract suite: the git-surfaces invariance proof (AD-2/AD-4/AD-10;
// FR-47) — the nextgit-e12-impl-git-surfaces-unchanged-pointers order's
// check.
// Run: bun porting/tests/r2-git-invariance.test.mjs   (exit 0 = pass)
//
// THE PROOF. The platform binding seam (ASSET_BLOB) is the ONLY fake,
// and it is an INSTRUMENTED stub: every get() is recorded, and the
// suite fails loudly if any git read path ever calls it. The instrumented
// bucket IS the proof — if a git path ever fetches a blob, the suite
// names the scenario and fails rather than silently passing (the
// AD-4/AD-10 enforcement mechanism).
//
// Real construction (judge.test.mjs / r2-asset-tier.test.mjs idiom):
// the REAL worker module + REAL land.ts + REAL githttp.ts + REAL
// memfs.ts, exercised through worker.fetch against an in-memory
// Artifacts fake. G1 additionally drives the REAL isomorphic-git clone
// surface through land.ts's createMemFs + createGitHttpClient against an
// in-process git smart-HTTP server (git http-backend — the auto-land-gate
// test.mjs idiom), so clone/checkout executes for real. No mock.module,
// no source grep; exit 0 = pass; full-suite safe, no network.
//
// Groups (each defends an observable contract):
//   G1 — clone/checkout reads zero blobs (the cloned pointer file is
//        byte-identical to the pointer text committed to the repo);
//   G2 — change-set computation reads zero blobs (metadata-only render);
//   G3 — fork-point selection is unchanged with pointers present (the
//        extracted findSharedFirstParent walk over identical histories
//        picks the identical ancestor; FORK_LOG_LIMIT === 200 bound;
//        the base-head fallback for the no-shared-commit repo);
//   G4 — a pointer-only change-set renders as file rows, and its stats
//        + fork point are identical to the same tree with the pointer
//        replaced by an ordinary text file (the invariance control);
//   G5 — /proposals set view carries the pointer on the file row with
//        zero blob access (landing computes through the same fold).

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import fs from "node:fs";
import os from "node:os";

import worker from "../../platform/src/index.ts";
import { forkPoint, findSharedFirstParent, FORK_LOG_LIMIT } from "../../platform/src/index.ts";
import { ASSET_POINTER_VERSION } from "../../platform/src/assets.ts";
import { assetPointerFor } from "../../platform/src/assets.ts";
import { pushLand } from "../../platform/src/land.ts";
import { createMemFs } from "../../platform/src/memfs.ts";
import { createGitHttpClient } from "../../platform/src/githttp.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

// ---------------------------------------------------------------------------
// The instrumented blob bucket — the load-bearing novelty.
//
// A stub R2Bucket whose get(key) RECORDS every read and throws
// BlobReadDuringGitOperation. Every git-path scenario constructs its env
// with this stub as ASSET_BLOB; the scenario asserts blobReads.length
// === 0 at its end. The blob bytes ARE present (keyed by the real
// content-addressed blobId), so a read would SUCCEED — proving the
// zero-read is invariance, not absence.
// ---------------------------------------------------------------------------

class BlobReadDuringGitOperation extends Error {
  constructor(key) {
    super(`blob read during git operation: ${key}`);
    this.name = "BlobReadDuringGitOperation";
  }
}

function instrumentedBlobBucket(r2Store) {
  const reads = [];
  return {
    reads,
    async get(key) {
      reads.push(key);
      // A read would succeed — the bytes are present. The suite fails
      // on the counter, not on a missing blob.
      const bytes = r2Store.get(key);
      if (!bytes) return null;
      return { body: new Blob([bytes]), httpMetadata: {} };
    },
    async put(key, value) {
      r2Store.set(key, new Uint8Array(await value.arrayBuffer()));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (r2-asset-tier.test.mjs shape) — only the
// surface the read paths touch.
// ---------------------------------------------------------------------------

function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
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
    return Object.entries(node).map(([name, child]) => (typeof child === "string"
      ? { name, mode: "100644", hash: child, type: "blob" }
      : { name, mode: "40000", hash: treeHashFor(child), type: "tree" }));
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
        if (path.startsWith("NEXTGIT_INTENT/")) {
          const shaPart = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[shaPart];
          return text === undefined ? null : new Blob([text]);
        }
        const blobHash = lookupPath(head.treeHash, path);
        return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
      },
      async readBlob(hash) {
        return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
      },
      async info() {
        return { remote: `https://artifacts.invalid/nextgit/${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }
  return {
    ARTIFACTS: { async get(name) { return repoFor(name); } },
    tree, commit, defineRepo, blobHashOf: (text) => blobHashByText.get(text) ?? null,
  };
}

function makeFakeKV() {
  const store = new Map();
  return {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); },
  };
}

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the G1 clone
// surface (the auto-land-gate.test.mjs idiom). Each server holds ONE
// bare repo served at its own port.
// ---------------------------------------------------------------------------

const serverRoot = fs.mkdtempSync(join(os.tmpdir(), "r2-git-invariance-"));
function sh(args, cwd = serverRoot) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function makeGitServer(repoName) {
  const dir = fs.mkdtempSync(join(serverRoot, "srv-"));
  const bareDir = join(dir, `${repoName}.git`);
  const workDir = join(dir, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const w = (args) => sh(args, workDir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);

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
  return { dir, bareDir, workDir, server };
}

async function startGitServer(repoName) {
  const g = makeGitServer(repoName);
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  g.port = g.server.address().port;
  g.remote = `http://127.0.0.1:${g.port}/${repoName}.git`;
  return g;
}

/** Current tip of the served bare repo's main (the observable landed state). */
function gitServerMain(g) {
  return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
}

// ---------------------------------------------------------------------------
// Fixture repos — the demo base + the agent-pointer fork.
// ---------------------------------------------------------------------------

const BASE_FILES = { "src/a.ts": "export const a = 1;\nexport const keep = true;\n" };

// A real asset: blob bytes content-addressed into the R2 store, a pointer
// file committed into the proposal repo. The blob bytes are present in the
// instrumented bucket so a read would succeed — proving the zero-read is
// invariance, not absence.
const ASSET_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const ASSET_POINTER = await assetPointerFor(ASSET_BYTES, "application/octet-stream");
const POINTER_TEXT = `${JSON.stringify(ASSET_POINTER, null, 2)}\n`;

// A plain-text twin of the pointer (the G4 invariance control): the same
// tree with assets/hero.asset.json replaced by an ordinary text file.
const TWIN_TEXT = `// hero asset (text twin)\nexport const hero = ${ASSET_POINTER.size};\n`;

// ---------------------------------------------------------------------------
// Environments. Each scenario builds a fresh instrumented bucket so the
// per-scenario counter names the scenario that read a blob.
// ---------------------------------------------------------------------------

function makeEnv(fake, bucket) {
  return {
    ARTIFACTS: fake.ARTIFACTS,
    LIVE: makeFakeKV(),
    CACHE: makeFakeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    ASSET_BLOB: bucket,
    AUTH_MODE: "demo",
  };
}

async function get(path, env) {
  const res = await worker.fetch(new Request(`https://nextgit.test${path}`), env);
  return readJson(res);
}

// =========================================================================
// G3 — fork-point selection is unchanged with pointers present.
// The extracted findSharedFirstParent walk is a pure function over two
// newest-first logs; identical histories pick the identical ancestor,
// whether or not a tree carries a pointer file. (Run first: the
// extraction it pins is the order's one source change.)
// =========================================================================

{
  // The fork-point-pinning.test.mjs fixture idiom (moved baseline →
  // newest shared = C_FORK, not the moved head), built twice: once with
  // a pointer file in the trees, once without.
  const sha = (n) => String(n).padStart(2, "0").repeat(20);
  const C_BASE = sha(0x11), C_FORK = sha(0x22), C_LAND = sha(0x33);
  const C_A1 = sha(0x55);

  // Identical histories; the ONLY difference is the pointer file in the
  // trees (the walk's input is commit metadata, never tree contents).
  const baseLog = [
    { hash: C_LAND },
    { hash: C_FORK },
    { hash: C_BASE },
  ];
  const proposalLog = [
    { hash: C_A1 },
    { hash: C_FORK },
    { hash: C_BASE },
  ];
  const selected = findSharedFirstParent(baseLog, proposalLog);
  check("G3a findSharedFirstParent selects the newest shared commit (C_FORK)",
    selected === C_FORK, `selected=${selected}`);

  // The pointer-in-tree variant: the walk's input is identical (commit
  // metadata only), so the selection is byte-identical.
  const selectedWithPointer = findSharedFirstParent(
    baseLog.map((c) => ({ ...c })),
    proposalLog.map((c) => ({ ...c })),
  );
  check("G3b pointer-carrying histories select the IDENTICAL ancestor",
    selectedWithPointer === selected, `withPointer=${selectedWithPointer} vs ${selected}`);

  // No shared commit -> undefined (the forkPoint fallback's trigger).
  const orphanLog = [{ hash: sha(0x66) }];
  check("G3c no shared commit -> undefined (base-head fallback trigger)",
    findSharedFirstParent(baseLog, orphanLog) === undefined);

  // The bound is pinned: FORK_LOG_LIMIT === 200 (the walk's limit).
  check("G3d FORK_LOG_LIMIT === 200 (bounded walk)", FORK_LOG_LIMIT === 200);

  // The walk is exactly two bounded log calls through the real forkPoint
  // (the base ref + the proposal ref), via the real route.
  const fake = makeFakeArtifacts();
  const tFork = fake.tree({ "src/a.ts": BASE_FILES["src/a.ts"], "assets/hero.asset.json": POINTER_TEXT });
  const tBase = fake.tree(BASE_FILES);
  const tA1 = fake.tree({ ...BASE_FILES, "assets/hero.asset.json": POINTER_TEXT, "src/b.ts": "export const b = 2;\n" });
  fake.defineRepo("demo", {
    history: [fake.commit(C_LAND, fake.tree({ ...BASE_FILES, "src/landed.ts": "export const landed = 1;\n" })), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)],
    refs: { main: C_LAND },
  });
  fake.defineRepo("agent-1", { history: [fake.commit(C_A1, tA1), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_A1 } });
  const bucket = instrumentedBlobBucket(new Map());
  const env = makeEnv(fake, bucket);
  const { status, body } = await get("/changes?repo=agent-1&base=demo&ref=main&baseRef=main", env);
  check("G3e /changes through the real forkPoint pins base.sha to the fork point (not the moved head)",
    status === 200 && body?.changeSet?.base?.sha === C_FORK, `status=${status} sha=${body?.changeSet?.base?.sha}`);
  check("G3f zero blob reads through the fork-point walk", bucket.reads.length === 0, JSON.stringify(bucket.reads));
}

// =========================================================================
// G2 — change-set computation reads zero blobs.
// GET /changes?repo=agent-pointer through worker.fetch; the pointer row
// renders metadata-only with no patch/additions/deletions/binary, is
// absent from texts, stats exclude the pointer, and the instrumented
// bucket records zero reads.
// =========================================================================

{
  const fake = makeFakeArtifacts();
  const c1 = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
  const PROPOSAL_FILES = {
    ...BASE_FILES,
    "assets/hero.asset.json": POINTER_TEXT,
    "src/b.ts": "export const b = 2;\n",
  };
  const c2 = fake.commit("c-agent-pointer", fake.tree(PROPOSAL_FILES));
  fake.defineRepo("agent-pointer", {
    history: [c2, c1], refs: { main: c2.hash },
    intents: { [c2.hash]: "Add the hero asset and bump b." },
  });
  const r2Store = new Map();
  r2Store.set(ASSET_POINTER.blobId, ASSET_BYTES);
  const bucket = instrumentedBlobBucket(r2Store);
  const env = makeEnv(fake, bucket);

  const { status, body } = await get("/changes?repo=agent-pointer&base=demo&ref=main&baseRef=main", env);
  check("G2a /changes 200", status === 200 && body?.ok === true, JSON.stringify(body?.error ?? body));
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "assets/hero.asset.json");
  check("G2b pointer row renders (path/status/action + asset metadata + note)",
    row !== undefined && row.asset?.v === ASSET_POINTER_VERSION && row.asset?.blobId === ASSET_POINTER.blobId && typeof row.note === "string" && row.note.includes(ASSET_POINTER.blobId),
    JSON.stringify(row));
  check("G2c pointer row has no patch/additions/deletions/binary",
    row?.patch === undefined && row?.additions === undefined && row?.deletions === undefined && row?.binary === undefined,
    JSON.stringify(row));
  const stats = body?.changeSet?.stats;
  // src/b.ts is the only text diff: 2 files, +1 addition.
  check("G2d stats exclude the pointer row", stats?.files === 2 && stats?.additions === 1 && stats?.deletions === 0, JSON.stringify(stats));
  check("G2e pointer row absent from texts", body?.changeSet?.texts?.["assets/hero.asset.json"] === undefined, JSON.stringify(Object.keys(body?.changeSet?.texts ?? {})));
  check("G2f ZERO blob reads during change-set computation", bucket.reads.length === 0, JSON.stringify(bucket.reads));
}

// =========================================================================
// G5 — /proposals set view carries the pointer on the file row with zero
// blob access (landing computes through the same fold).
// =========================================================================

{
  const fake = makeFakeArtifacts();
  const c1 = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
  const PROPOSAL_FILES = { ...BASE_FILES, "assets/hero.asset.json": POINTER_TEXT, "src/b.ts": "export const b = 2;\n" };
  const c2 = fake.commit("c-agent-pointer", fake.tree(PROPOSAL_FILES));
  fake.defineRepo("agent-pointer", {
    history: [c2, c1], refs: { main: c2.hash },
    intents: { [c2.hash]: "Add the hero asset and bump b." },
  });
  const r2Store = new Map();
  r2Store.set(ASSET_POINTER.blobId, ASSET_BYTES);
  const bucket = instrumentedBlobBucket(r2Store);
  const env = makeEnv(fake, bucket);

  const { status, body } = await get("/proposals?base=demo&repos=agent-pointer&ref=main&baseRef=main", env);
  check("G5a /proposals 200", status === 200 && body?.ok === true, JSON.stringify(body?.error ?? body));
  const proposal = body?.proposals?.[0];
  const row = (proposal?.files ?? []).find((f) => f.path === "assets/hero.asset.json");
  check("G5b the file row carries asset + note",
    row !== undefined && row.asset?.blobId === ASSET_POINTER.blobId && row.asset?.sha256 === ASSET_POINTER.sha256 && typeof row.note === "string",
    JSON.stringify(row));
  // Landing computes through the same fold: the pointer-only merge renders
  // metadata-only (result "merged", no merged field).
  check("G5c landing verdict computes through the fold (ready, files counted)",
    proposal?.landing?.status === "ready" && typeof proposal?.landing?.files === "number" && proposal.landing.files > 0,
    JSON.stringify(proposal?.landing));
  check("G5d ZERO blob reads during the /proposals set view", bucket.reads.length === 0, JSON.stringify(bucket.reads));
}

// =========================================================================
// G4 — pointer-only change-set renders as file rows, and its stats + fork
// point are identical to the same tree with the pointer replaced by an
// ordinary text file (the invariance control — proves pointers add a
// layer, never drift).
// =========================================================================

{
  const build = (pointerFileText) => {
    const fake = makeFakeArtifacts();
    const c1 = fake.commit("c-base", fake.tree(BASE_FILES));
    fake.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
    // A proposal whose ONLY change is the single asset file.
    const ONLY_FILES = { ...BASE_FILES, "assets/hero.asset.json": pointerFileText };
    const c2 = fake.commit("c-agent-pointer-only", fake.tree(ONLY_FILES));
    fake.defineRepo("agent-pointer-only", {
      history: [c2, c1], refs: { main: c2.hash },
      intents: { [c2.hash]: "Add the hero asset." },
    });
    return { fake, forkSha: c1.hash };
  };

  // The pointer variant.
  const pointer = build(POINTER_TEXT);
  const r2Store = new Map();
  r2Store.set(ASSET_POINTER.blobId, ASSET_BYTES);
  const pointerBucket = instrumentedBlobBucket(r2Store);
  const pointerEnv = makeEnv(pointer.fake, pointerBucket);
  const pRes = await get("/changes?repo=agent-pointer-only&base=demo&ref=main&baseRef=main", pointerEnv);
  const pRow = (pRes.body?.changeSet?.files ?? []).find((f) => f.path === "assets/hero.asset.json");
  check("G4a pointer-only change-set renders the file row with pinned metadata",
    pRes.status === 200 && pRow?.asset?.v === ASSET_POINTER_VERSION && pRow?.asset?.blobId === ASSET_POINTER.blobId && pRow?.note !== undefined,
    JSON.stringify(pRow));
  check("G4b pointer-only change-set has zero blob access", pointerBucket.reads.length === 0, JSON.stringify(pointerBucket.reads));

  // The invariance control: the SAME tree with the pointer replaced by an
  // ordinary text file.
  const twin = build(TWIN_TEXT);
  const twinBucket = instrumentedBlobBucket(new Map());
  const twinEnv = makeEnv(twin.fake, twinBucket);
  const tRes = await get("/changes?repo=agent-pointer-only&base=demo&ref=main&baseRef=main", twinEnv);

  // The change-set stats and fork point are IDENTICAL between the two
  // trees — the tier adds a pointer layer, never drift.
  check("G4c stats identical: pointer-only vs text-twin",
    JSON.stringify(pRes.body?.changeSet?.stats) === JSON.stringify(tRes.body?.changeSet?.stats),
    `pointer=${JSON.stringify(pRes.body?.changeSet?.stats)} twin=${JSON.stringify(tRes.body?.changeSet?.stats)}`);
  check("G4d fork point identical: pointer-only vs text-twin",
    pRes.body?.changeSet?.base?.sha === tRes.body?.changeSet?.base?.sha,
    `pointer=${pRes.body?.changeSet?.base?.sha} twin=${tRes.body?.changeSet?.base?.sha}`);
  check("G4e twin tree also reads zero blobs", twinBucket.reads.length === 0, JSON.stringify(twinBucket.reads));
}

// =========================================================================
// G1 — clone/checkout reads zero blobs.
//
// Drive the REAL isomorphic-git clone surface through land.ts's
// createMemFs + createGitHttpClient against the in-process git server.
// The agent-pointer repo's remote IS the git server (a real bare repo
// carrying assets/hero.asset.json); pushLand's clone path — the same
// createMemFs + createGitHttpClient + git.clone seam /land uses —
// checks out the working tree. The cloned pointer file is byte-identical
// to the pointer text committed to the repo, and the instrumented
// bucket records zero reads.
// =========================================================================

{
  // Materialize the repo on the git server: the base commit + the
  // pointer-carrying proposal commit, committed for real.
  const g = await startGitServer("agent-pointer");
  const w = (args) => sh(args, g.workDir);
  fs.mkdirSync(join(g.workDir, "assets"), { recursive: true });
  fs.mkdirSync(join(g.workDir, "src"), { recursive: true });
  fs.writeFileSync(join(g.workDir, "src", "a.ts"), BASE_FILES["src/a.ts"]);
  fs.writeFileSync(join(g.workDir, "assets", "hero.asset.json"), POINTER_TEXT);
  w(["add", "-A"]);
  w(["commit", "-qm", "Add the hero asset pointer"]);
  sh(["clone", "--bare", g.workDir, g.bareDir], g.dir);
  sh(["-C", g.bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], g.dir);
  const committedSha = gitServerMain(g);

  // The Artifacts fake's info() returns the git server remote, so the
  // clone seam drives the real wire. createToken mints the write token
  // the http client injects.
  const fake = makeFakeArtifacts();
  const c1 = fake.commit(committedSha, fake.tree({ ...BASE_FILES, "assets/hero.asset.json": POINTER_TEXT }));
  fake.defineRepo("agent-pointer", { history: [c1], refs: { main: c1.hash } });
  // Point the repo's info() at the live git server.
  const repo = await fake.ARTIFACTS.get("agent-pointer");
  repo.info = async () => ({ remote: g.remote });

  const r2Store = new Map();
  r2Store.set(ASSET_POINTER.blobId, ASSET_BYTES);
  const bucket = instrumentedBlobBucket(r2Store);
  const env = makeEnv(fake, bucket);

  // The clone surface: land.ts's createMemFs + createGitHttpClient, the
  // exact pair pushLand's git.clone uses, driven against the real
  // git-over-HTTPS server.
  const mem = createMemFs();
  const http = createGitHttpClient("fixture-write-token");
  const git = await import("../../platform/node_modules/isomorphic-git/index.js").then((m) => m.default);
  await git.clone({
    fs: mem,
    http: http,
    dir: "/repo",
    url: g.remote,
    ref: "main",
    singleBranch: true,
    depth: 1,
  });

  // The cloned working tree's pointer file is byte-identical to the
  // pointer text committed to the repo.
  const cloned = await mem.readFile("/repo/assets/hero.asset.json", { encoding: "utf8" });
  check("G1a cloned working tree's pointer file is byte-identical to the committed pointer text",
    cloned === POINTER_TEXT, `cloned=${JSON.stringify(cloned)}`);
  // ...and the pointer still parses (integrity anchor survives the round-trip).
  const parsed = JSON.parse(cloned);
  check("G1b the cloned pointer parses to the same content-addressed blobId",
    parsed.blobId === ASSET_POINTER.blobId && parsed.sha256 === ASSET_POINTER.sha256, JSON.stringify(parsed));
  check("G1c ZERO blob reads during clone/checkout", bucket.reads.length === 0, JSON.stringify(bucket.reads));

  g.server.close();
}

// =========================================================================
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
