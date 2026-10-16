#!/usr/bin/env bun
// Contract suite: GET /pipelines (nextgit-e17-impl-ci-pipelines-v2) —
// landed runs as pipeline records, the landing-record projection.
// Run: bun porting/tests/pipelines-api.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts
// and drives worker.fetch() over the REAL dispatcher (authorize() +
// the ROUTES table) against an in-memory KV fake (the sessions-v1 /
// checks-api fixture surface: internBlob/tree/commit/defineRepo +
// makeFakeKV). No mock.module, no source grep. The KV fake carries an
// instrumented get/put counter (the artifactsProbe idiom) so the
// 403-prefires-pre-read law is observable.
//
// The contract this suite pins:
//   1. Projection — seeded landing:<sha> records + the registry project
//      to 200 {ok, base, pipelines[]}; every row carries exactly the
//      eight keys; status/attestation in their closed sets; newest-first;
//      the default cap is 20.
//   2. Status honesty — pass -> passed; mismatch/fail -> failed (a
//      failure token dominates a pass token, position-independent);
//      neither -> not-recorded.
//   3. Attestation projection — signed -> "signed"; unavailable ->
//      "unavailable"; no attestation key (the pre-layer shape) -> null.
//   4. Registry derivation (the acceptance) — a real POST /land through
//      the fake lists its commit as a run with an honest status; a
//      registry entry whose landing: key vanished is skipped.
//   5. Preconditions — omitted base == demo; absent base -> 400
//      "base parameter required"; base=notdemo -> 403 with ZERO KV
//      reads; limit=0/limit=abc -> 400; limit=1000 clamps to <=100
//      rows served; an empty namespace -> 200 pipelines:[]; POST
//      /pipelines -> 405; the 61st call -> 429.
//   6. Negative scan — no secret-class value/key leaves /pipelines;
//      the handler performs zero Artifacts reads.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker, { ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);
const ROW_KEYS = ["id", "repos", "at", "checks", "results", "status", "attestation", "deliveries"];
const STATUS_SET = new Set(["passed", "not-recorded", "failed"]);
const ATTESTATION_SET = new Set(["signed", "unavailable", null]);

// ---------------------------------------------------------------------------
// In-memory KV fake with instrumented get/put counters (the
// artifactsProbe idiom — the 403-prefires-pre-read law is observable).
// ---------------------------------------------------------------------------
function makeFakeKV() {
  const store = new Map();
  const counters = { get: 0, put: 0 };
  return {
    store,
    counters,
    get: async (k, type) => {
      counters.get++;
      const v = store.get(k);
      if (v === undefined) return null;
      if (type === "json") { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    put: async (k, v) => { counters.put++; store.set(k, String(v)); },
  };
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the rate-limit.test.mjs / sessions-v1
// fixture surface). Built as a factory so group 4's full POST /land
// leg can point `info()` at a real in-process git http-backend
// server (the auto-land-gate.test.mjs push seam — pushLand clones
// and pushes for real); every other group uses the plain in-memory
// fake. Counts reads so the zero-Artifacts-reads law is observable.
// Each fake owns its own blob/tree/repo maps, so environments
// cannot alias.
// ---------------------------------------------------------------------------
function makeArtifactsFake(gitServer = null) {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash
  const treeEntries = new Map(); // tree hash -> entries
  const repos = new Map(); // name -> { history, refs, intents }
  let tokenMints = 0;

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
  function defineRepo(name, def) { repos.set(name, def); }
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

  const api = {
    reads: 0,
    internBlob, tree, commit, defineRepo,
    async get(name) {
      api.reads++;
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
        async readTree(hash) { return treeEntries.get(hash) ?? null; },
        async readFile({ ref, path }) {
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
        async readBlob(hash) { return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null; },
        async info() {
          // The push seam: with a git server, the base repo's remote
          // is the in-process server, so pushLand clones and pushes
          // for real; without one, an unreachable URL (the read-only
          // groups never push).
          return { remote: gitServer ? gitServer.remote : `https://artifacts.invalid/nextgit/${name}` };
        },
        async createToken(_scope, _ttl) {
          tokenMints++;
          return { plaintext: `fake-write-token-${tokenMints}` };
        },
        async revokeToken() { return true; },
        [Symbol.dispose]() { },
      };
    },
    async list({ limit = 200 } = {}) {
      api.reads++;
      const out = [];
      for (const [name] of repos) {
        if (out.length >= limit) break;
        out.push({ name, status: "ready", defaultBranch: "main" });
      }
      return { repos: out };
    },
  };
  return api;
}

// The shared read-only fake (groups 1-3, 5-6): no git server, so
// no push is ever attempted. Seeded with the demo base + agent-1
// (the sessions-v1 fixture shape).
const ARTIFACTS = makeArtifactsFake();
const A0 = "export const a = 1;\nexport const keep = true;\n";
const c1 = ARTIFACTS.commit("c-base", ARTIFACTS.tree({ "src/a.ts": A0 }));
ARTIFACTS.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
const A1 = "export const a = 2;\nexport const keep = true;\n";
const a1 = ARTIFACTS.commit("c-agent-1", ARTIFACTS.tree({ "src/a.ts": A1 }));
ARTIFACTS.defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash }, intents: { [a1.hash]: "Bump the a module for the demo." } });

const AI = { run: async () => null };

function envFor({ live = makeFakeKV(), cache = makeFakeKV(), deny = false, artifacts = ARTIFACTS } = {}) {
  return {
    ARTIFACTS: artifacts,
    LIVE: live,
    CACHE: cache,
    ASSETS: { fetch: async () => new Response("") },
    AI,
    AUTH_MODE: deny ? undefined : "demo",
  };
}

let ipSeq = 0;
const nextIp = () => `10.9.0.${++ipSeq}`;

// In-process ctx (the land-waituntil.test.mjs shape): captures
// waitUntil promises so the land path's ctx.waitUntil calls
// (the feed-lag best-effort duplicate) have a real target.
const capturedWaitUntil = [];
const fakeCtx = {
  waitUntil(p) {
    capturedWaitUntil.push(p);
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

const drive = async (env, method, path, { body, ip, headers = {} } = {}) => {
  const h = { ...headers };
  if (ip) h["CF-Connecting-IP"] = ip;
  if (body !== undefined) h["content-type"] = "application/json";
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env, fakeCtx);
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return null; } })(), text };
};

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push
// seam for group 4's full POST /land (the auto-land-gate.test.mjs
// idiom). Each environment gets its OWN bare repo + port, so
// environments cannot alias.
// ---------------------------------------------------------------------------
const gitRepoDir = mkdtempSync(join(tmpdir(), "pipelines-api-"));
function gitSh(args, cwd = gitRepoDir) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
function makeGitServer() {
  const dir = mkdtempSync(join(gitRepoDir, "srv-"));
  const bareDir = join(dir, "demo.git");
  const workDir = join(dir, "work");
  mkdirSync(workDir, { recursive: true });
  const w = (args) => gitSh(args, workDir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src", "a.ts"), A0);
  w(["add", "-A"]);
  w(["commit", "-qm", "base"]);
  gitSh(["clone", "--bare", workDir, bareDir], dir);
  gitSh(["-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], dir);
  gitSh(["-C", bareDir, "config", "http.receivepack", "true"], dir);
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

// ---------------------------------------------------------------------------
// Seeding helpers.
// ---------------------------------------------------------------------------
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);

function seedLanding(cache, sha, { results = ["pass"], attestation = { status: "signed" }, repos = ["agent-1"], at = "2026-10-14T00:00:00.000Z" } = {}) {
  cache.store.set(`landing:${sha}`, JSON.stringify({
    landed: { repos, commit: sha, files: [], at },
    evidence: { repos, commit: sha, ancestor: [], heads: { base: "demo", repos: {} }, foldHash: "f".repeat(40), checks: ["merged-sha-equals-tested-sha"], results, mergedSha: "f".repeat(40), testedSha: "e".repeat(40), artifactRef: null, at, lease: null },
    attestation,
  }));
}

function seedRegistry(cache, entries) {
  cache.store.set("landing-registry", JSON.stringify(entries));
}

const getPipelines = (env, query = "?base=demo", ip = nextIp()) =>
  drive(env, "GET", `/pipelines${query}`, { ip });

// 1. Projection — seeded records + registry -> 200, eight keys, closed sets.
{
  const cache = makeFakeKV();
  seedLanding(cache, SHA1, { at: "2026-10-14T01:00:00.000Z" });
  seedLanding(cache, SHA2, { at: "2026-10-14T02:00:00.000Z" });
  seedRegistry(cache, [
    { commit: SHA2, at: "2026-10-14T02:00:00.000Z" },
    { commit: SHA1, at: "2026-10-14T01:00:00.000Z" },
  ]);
  const env = envFor({ cache });
  const r = await getPipelines(env);
  check("1: GET /pipelines?base=demo -> 200", r.status === 200, `got ${r.status} ${J(r.body)}`);
  check("1: body ok:true", r.body?.ok === true, J(r.body));
  check("1: base echoes demo", r.body?.base === "demo", J(r.body?.base));
  const rows = r.body?.pipelines;
  check("1: pipelines is an array of 2", Array.isArray(rows) && rows.length === 2, J(rows?.length));
  const rowKeys = rows?.every((row) => Array.isArray(Object.keys(row)) && Object.keys(row).length === 8 && ROW_KEYS.every((k) => k in row));
  check("1: every row carries exactly the eight keys (seven e17 + additive deliveries)", rowKeys === true, J(rows?.[0] && Object.keys(rows[0])));
  check("1: every status in the closed set", rows?.every((row) => STATUS_SET.has(row.status)), J(rows?.map((r) => r.status)));
  check("1: every attestation in the closed set", rows?.every((row) => ATTESTATION_SET.has(row.attestation)), J(rows?.map((r) => r.attestation)));
  check("1: newest-first ordering", rows?.[0]?.id === SHA2 && rows?.[1]?.id === SHA1, J(rows?.map((r) => r.id)));
  check("1: row fields verbatim (repos/at/checks/results)", rows?.[0]?.repos?.[0] === "agent-1" && rows?.[0]?.at === "2026-10-14T02:00:00.000Z" && rows?.[0]?.checks?.[0] === "merged-sha-equals-tested-sha" && rows?.[0]?.results?.[0] === "pass", J(rows?.[0]));
}

// 1b. Default cap is 20: 25 seeded entries serve exactly 20 rows.
{
  const cache = makeFakeKV();
  const entries = [];
  for (let i = 0; i < 25; i++) {
    const sha = `${"d".repeat(39)}${i.toString(16).padStart(2, "0").slice(-1)}`;
    seedLanding(cache, sha, { at: `2026-10-14T00:${String(i).padStart(2, "0")}:00.000Z` });
    entries.push({ commit: sha, at: `2026-10-14T00:${String(i).padStart(2, "0")}:00.000Z` });
  }
  seedRegistry(cache, entries);
  const env = envFor({ cache });
  const r = await getPipelines(env);
  check("1b: default cap is 20 (25 seeded -> 20 served)", r.status === 200 && r.body?.pipelines?.length === 20, `got ${r.body?.pipelines?.length}`);
}

// 2. Status honesty — pass/mismatch/fail/neither.
{
  const cache = makeFakeKV();
  const PASS = "1".repeat(40), MISMATCH = "2".repeat(40), FAIL = "3".repeat(40), NEITHER = "4".repeat(40);
  seedLanding(cache, PASS, { results: ["pass"] });
  seedLanding(cache, MISMATCH, { results: ["pass", "mismatch"] }); // failure token AFTER a pass token — still failed
  seedLanding(cache, FAIL, { results: ["fail"] });
  seedLanding(cache, NEITHER, { results: [] });
  seedRegistry(cache, [
    { commit: NEITHER, at: "2026-10-14T04:00:00.000Z" },
    { commit: FAIL, at: "2026-10-14T03:00:00.000Z" },
    { commit: MISMATCH, at: "2026-10-14T02:00:00.000Z" },
    { commit: PASS, at: "2026-10-14T01:00:00.000Z" },
  ]);
  const env = envFor({ cache });
  const r = await getPipelines(env);
  const byId = Object.fromEntries((r.body?.pipelines ?? []).map((row) => [row.id, row.status]));
  check("2: pass -> passed", byId[PASS] === "passed", J(byId));
  check("2: mismatch AFTER a pass token -> failed (failure dominates, position-independent)", byId[MISMATCH] === "failed", J(byId));
  check("2: fail -> failed", byId[FAIL] === "failed", J(byId));
  check("2: neither -> not-recorded", byId[NEITHER] === "not-recorded", J(byId));
}

// 3. Attestation projection — signed/unavailable/absent.
{
  const cache = makeFakeKV();
  const SIGNED = "5".repeat(40), UNAVAILABLE = "6".repeat(40), PRE_LAYER = "7".repeat(40);
  seedLanding(cache, SIGNED, { attestation: { status: "signed", v: 1, algo: "x", sig: "y" } });
  seedLanding(cache, UNAVAILABLE, { attestation: { status: "unavailable", reason: "no key" } });
  seedLanding(cache, PRE_LAYER, { attestation: undefined });
  // A record predating the layer has NO attestation key at all.
  cache.store.set(`landing:${PRE_LAYER}`, JSON.stringify({
    landed: { repos: ["agent-1"], commit: PRE_LAYER, files: [], at: "2026-10-14T03:00:00.000Z" },
    evidence: { repos: ["agent-1"], commit: PRE_LAYER, checks: ["merged-sha-equals-tested-sha"], results: ["pass"] },
  }));
  seedRegistry(cache, [
    { commit: PRE_LAYER, at: "2026-10-14T03:00:00.000Z" },
    { commit: UNAVAILABLE, at: "2026-10-14T02:00:00.000Z" },
    { commit: SIGNED, at: "2026-10-14T01:00:00.000Z" },
  ]);
  const env = envFor({ cache });
  const r = await getPipelines(env);
  const byId = Object.fromEntries((r.body?.pipelines ?? []).map((row) => [row.id, row.attestation]));
  check("3: signed envelope -> \"signed\"", byId[SIGNED] === "signed", J(byId));
  check("3: unavailable envelope -> \"unavailable\"", byId[UNAVAILABLE] === "unavailable", J(byId));
  check("3: pre-layer record (no attestation key) -> null", byId[PRE_LAYER] === null, J(byId));
}

// 4. Registry derivation (the acceptance) — a real POST /land
//    through a git-backed fake (pushLand clones/pushes the
//    in-process git server for real), then GET /pipelines
//    lists that commit with an honest status.
{
  const g = await startGitServer();
  try {
    // A per-environment fake whose `info()` points at the git
    // server, seeded with the server's REAL main tip as the
    // demo base head (the auto-land-gate.test.mjs posture —
    // the AD-3 precondition compares the fold's expected base
    // head against a re-read of the server's tip, so the two
    // must be the same sha or every land is refused as
    // base-moved).
    const artifacts = makeArtifactsFake(g);
    const baseSha = gitSh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
    const demoTree = artifacts.tree({ "src/a.ts": A0 });
    const demoCommit = artifacts.commit(baseSha, demoTree);
    artifacts.defineRepo("demo", { history: [demoCommit], refs: { main: demoCommit.hash } });
    const agentTree = artifacts.tree({ "src/a.ts": A1 });
    const agentCommit = artifacts.commit("c-agent-1", agentTree);
    artifacts.defineRepo("agent-1", { history: [agentCommit, demoCommit], refs: { main: agentCommit.hash }, intents: { [agentCommit.hash]: "Bump the a module for the demo." } });

    const cache = makeFakeKV();
    const env = envFor({ cache, artifacts });
    // Drive a real land: /land computes the fold (agent-1's
    // intent vs demo), pushes (pushLand over the git server),
    // persists the landing record AND appends the registry.
    const land = await drive(env, "POST", "/land", {
      body: {
        base: "demo", ref: "main", baseRef: "main",
        repos: ["agent-1"],
        validation: {
          checks: ["unit-tests", "typecheck"],
          results: ["pass", "pass"],
          testedSha: "e".repeat(64),
        },
      },
      ip: nextIp(),
    });
    check("4: POST /land -> 200", land.status === 200, `got ${land.status} ${J(land.body)}`);
    const landedCommit = land.body?.landed?.commit;
    check("4: land returned a commit", typeof landedCommit === "string" && /^[0-9a-f]{40}$/.test(landedCommit), J(landedCommit));
    const r = await getPipelines(env);
    const rows = r.body?.pipelines ?? [];
    check("4: GET /pipelines lists the landed commit (every landed commit appears)", rows.some((row) => row.id === landedCommit), J(rows?.map((x) => x.id)));
    const row = rows.find((x) => x.id === landedCommit);
    check("4: the landed run's status is derived honestly from its ledger (the FR-18 equality row decides)", row?.status === (row?.results?.includes("mismatch") || row?.results?.includes("fail") ? "failed" : row?.results?.includes("pass") ? "passed" : "not-recorded"), J(row));
    check("4: the landed run's ledger carries the platform-appended merged-sha check", row?.checks?.[row.checks.length - 1] === "merged-sha-equals-tested-sha", J(row?.checks));
    check("4: the landed run's results carry the platform-appended equality row", ["pass", "mismatch", "not-recorded"].includes(row?.results?.[row.results.length - 1]), J(row?.results));
    check("4: the landed run's attestation projects (signed or unavailable — never fabricated)", row?.attestation === "signed" || row?.attestation === "unavailable", J(row?.attestation));

    // A registry entry whose landing: key vanished is skipped —
    // the row is not fabricated, no 500.
    cache.store.delete(`landing:${landedCommit}`);
    const r2 = await getPipelines(env);
    check("4: a vanished landing: key is skipped (row not fabricated, no 500)", r2.status === 200 && !(r2.body?.pipelines ?? []).some((x) => x.id === landedCommit), `status=${r2.status} rows=${J(r2.body?.pipelines?.map((x) => x.id))}`);
  } finally {
    g.server.close();
  }
}

// 4b. A malformed registry reads as [] — fail-closed, never a 500.
{
  const cache = makeFakeKV();
  cache.store.set("landing-registry", "not-json");
  const env = envFor({ cache });
  const r = await getPipelines(env);
  check("4b: a malformed registry reads as [] (200, empty)", r.status === 200 && Array.isArray(r.body?.pipelines) && r.body.pipelines.length === 0, `status=${r.status} ${J(r.body)}`);
}

// 5. Preconditions.
{
  // Omitted base == demo (the AD-8 seam).
  const cache = makeFakeKV();
  const env = envFor({ cache });
  const omitted = await drive(env, "GET", "/pipelines", { ip: nextIp() });
  check("5: omitted base == demo", omitted.status === 200 && omitted.body?.base === "demo", `got ${omitted.status} ${J(omitted.body?.base)}`);

  // Absent base (present but empty) -> 400 "base parameter required" (the
  // /changes law: a present "" passes through resolveRouteBase to the
  // handler's REPO_NAME_RE, which rejects it).
  const emptyBase = await drive(env, "GET", "/pipelines?base=", { ip: nextIp() });
  check("5: base= -> 400", emptyBase.status === 400, `got ${emptyBase.status} ${J(emptyBase.body)}`);

  // A charset-VALID name outside the AD-9 allowlist -> 403 (the
  // authorize() chokepoint adjudicates it pre-handler, the
  // /changes posture; a charset-INVALID name would 400 at the
  // handler — 400 precedes 403 only for invalid charsets).
  const numBase = await drive(env, "GET", "/pipelines?base=123", { ip: nextIp() });
  check("5: base=123 -> 403 (charset-valid, non-allowlisted)", numBase.status === 403, `got ${numBase.status} ${J(numBase.body)}`);

  // base outside the AD-9 allowlist -> 403 with ZERO KV reads (the
  // authorize() chokepoint fires pre-handler).
  const kv = makeFakeKV();
  const env2 = envFor({ cache: kv });
  const denied = await drive(env2, "GET", "/pipelines?base=notdemo", { ip: nextIp() });
  check("5: base=notdemo -> 403", denied.status === 403, `got ${denied.status} ${J(denied.body)}`);
  check("5: the 403 path performs ZERO KV reads (the chokepoint fired pre-read)", kv.counters.get === 0, `get=${kv.counters.get}`);

  // limit validation: 0 / abc -> 400; 1000 clamps to <=100 rows served.
  const badLimit0 = await drive(env, "GET", "/pipelines?base=demo&limit=0", { ip: nextIp() });
  check("5: limit=0 -> 400", badLimit0.status === 400, `got ${badLimit0.status} ${J(badLimit0.body)}`);
  const badLimitAbc = await drive(env, "GET", "/pipelines?base=demo&limit=abc", { ip: nextIp() });
  check("5: limit=abc -> 400", badLimitAbc.status === 400, `got ${badLimitAbc.status} ${J(badLimitAbc.body)}`);

  const bigCache = makeFakeKV();
  const entries = [];
  for (let i = 0; i < 150; i++) {
    const sha = `${"e".repeat(38)}${i.toString(16).padStart(2, "0")}`;
    seedLanding(bigCache, sha, { at: `2026-10-14T00:00:${String(i).padStart(2, "0")}.000Z` });
    entries.push({ commit: sha, at: `2026-10-14T00:00:${String(i).padStart(2, "0")}.000Z` });
  }
  seedRegistry(bigCache, entries);
  const env3 = envFor({ cache: bigCache });
  const clamped = await drive(env3, "GET", "/pipelines?base=demo&limit=1000", { ip: nextIp() });
  check("5: limit=1000 clamps to at most 100 rows served", clamped.status === 200 && clamped.body?.pipelines?.length === 100, `got ${clamped.body?.pipelines?.length}`);

  // An empty namespace -> 200 pipelines:[] (NOT 404).
  const emptyNs = await drive(env, "GET", "/pipelines?base=demo", { ip: nextIp() });
  check("5: an empty namespace -> 200 pipelines:[]", emptyNs.status === 200 && Array.isArray(emptyNs.body?.pipelines) && emptyNs.body.pipelines.length === 0, `got ${emptyNs.status} ${J(emptyNs.body)}`);

  // POST /pipelines -> 405 (the API-boundary method law).
  const post = await drive(env, "POST", "/pipelines?base=demo", { body: {}, ip: nextIp() });
  check("5: POST /pipelines -> 405", post.status === 405, `got ${post.status} ${J(post.body)}`);

  // The 61st call in 60s -> 429 (the new ROUTE_RATE_LIMITS row).
  const rateEnv = envFor({ cache: makeFakeKV() });
  const caller = `10.9.9.${++ipSeq}`;
  let saw429 = false;
  for (let i = 0; i < 61; i++) {
    const rr = await drive(rateEnv, "GET", "/pipelines?base=demo", { ip: caller });
    if (rr.status === 429) { saw429 = true; break; }
  }
  check("5: the 61st call in 60s -> 429 (the new ROUTE_RATE_LIMITS row)", saw429, "no 429 observed in 61 calls");
  check("5: ROUTE_RATE_LIMITS carries the /pipelines row (60/60s)", ROUTE_RATE_LIMITS["/pipelines"]?.limit === 60 && ROUTE_RATE_LIMITS["/pipelines"]?.windowMs === 60_000, J(ROUTE_RATE_LIMITS["/pipelines"]));
}

// 6. Negative scan — no secret-class value/key leaves /pipelines; the
//    handler performs zero Artifacts reads.
{
  const SECRET_VALUE = "ghp_supersecret_fixture_value_1234567890";
  const SECRET_KEY = "AWS_SECRET_ACCESS_KEY";
  const cache = makeFakeKV();
  const SHA = "8".repeat(40);
  // A landing record whose evidence carries secret-class-shaped strings —
  // the projection must egress none of them.
  // A landing record whose NON-projected fields carry
  // secret-class-shaped strings — the projection must egress
  // none of them (the projection carries only id/repos/at/
  // checks/results/status/attestation).
  cache.store.set(`landing:${SHA}`, JSON.stringify({
    landed: { repos: ["agent-1"], commit: SHA, files: [`config/.env:${SECRET_KEY}=${SECRET_VALUE}`], at: "2026-10-14T00:00:00.000Z" },
    evidence: {
      repos: ["agent-1"], commit: SHA, checks: ["merged-sha-equals-tested-sha"], results: ["pass"],
      mergedSha: SECRET_VALUE, testedSha: SECRET_KEY, artifactRef: `secret:${SECRET_VALUE}`, at: "2026-10-14T00:00:00.000Z",
      lease: { provider: "do", leaseId: SECRET_VALUE },
      heads: { base: "demo", repos: { "agent-1": `${SECRET_VALUE}` } },
    },
    attestation: { status: "signed", sig: SECRET_VALUE },
  }));
  seedRegistry(cache, [{ commit: SHA, at: "2026-10-14T00:00:00.000Z" }]);
  const env = envFor({ cache });
  const before = ARTIFACTS.reads;
  const r = await getPipelines(env);
  check("6: GET /pipelines -> 200", r.status === 200, `got ${r.status}`);
  check("6: no secret-class VALUE leaves /pipelines", !r.text.includes(SECRET_VALUE), "the fixture secret value egressed");
  check("6: no secret-class KEY name leaves /pipelines", !r.text.includes(SECRET_KEY), "the fixture secret key egressed");
  check("6: the handler performs ZERO Artifacts reads (the KV fake is the only store touched)", ARTIFACTS.reads === before, `reads ${before} -> ${ARTIFACTS.reads}`);
}

// Route-table pin (the lockstep carrier).
check("pin: ROUTES registers GET /pipelines as a read", ROUTES.some((r) => r.path === "/pipelines" && r.method === "GET" && r.action === "read"));

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
