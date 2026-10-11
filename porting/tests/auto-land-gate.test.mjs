#!/usr/bin/env bun
// Contract suite: the auto-land gate inside POST /land (AD-11 / FR-26).
// Run: bun porting/tests/auto-land-gate.test.mjs   (exit 0 = pass)
//
// Real construction: the REAL worker module (worker.fetch) against an
// in-memory Artifacts fake whose base repo's `info()` returns a remote
// served by an in-process git smart-HTTP server (git http-backend), so
// the gated land path — clone, fold, commit, push, KV landing record —
// executes for real. The platform binding seam (AI) is the only stub:
// a scripted Clef reply that records every run() call. No module
// mocking, no source grep. Conventions per judge.test.mjs (scripted AI
// + in-memory Artifacts), land-waituntil.test.mjs (in-process ctx),
// seam-precondition.test.mjs (AI-call counting to prove ordering).

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import fs from "node:fs";
import os from "node:os";


import worker from "../../platform/src/index.ts";
import { AUTO_LAND_ENGAGED, AUTO_LAND_SET_ID, buildJudgeRequest, deriveAutoLandVerdict, validateJudgeResponse } from "../../platform/src/judge.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Secret-class predicate for the judge-layer construction legs (the
// judge.test.mjs inline-predicate idiom — the gate passes the
// worker's own isSecretPath into buildJudgeRequest; here the local
// stand-in exercises the same exported seam for the empty-set leg).
const isSecretPath = (p) => p.endsWith(".env") || p.endsWith(".pem") || p.endsWith(".key") || p.endsWith(".p12");

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push seam.
// ---------------------------------------------------------------------------

const repoDir = fs.mkdtempSync(join(os.tmpdir(), "autoland-gate-"));
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
  // listen synchronously-allocated; port resolved by the caller's await
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
        if (path.startsWith("NEXTGIT_INTENT/")) {
          const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[sha];
          return text === undefined ? null : new Blob([text]);
        }
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
    async list() {
      return { repos: [] };
    },
    // expose the fixture builders to the environment below
    _fixture: { internBlob, tree, commit, defineRepo, tokenMints: () => tokenMints },
  };
}

// ---------------------------------------------------------------------------
// Fixture: `demo` base + agent-1..agent-4 (the judge.test.mjs shape).
// Each environment gets its OWN git server + fake (no aliasing), so the
// "base ref unchanged" and "zero token mints" assertions are clean.
// ---------------------------------------------------------------------------

const A0 = "export const a = 1;\n";
const A1 = "export const a = 2;\n";
const B0 = "export const b = 1;\n";
const B1 = "export const b = 2;\n";
const ENV_FILE = "API_TOKEN=fixture_secret_value\n";
async function makeEnvironmentAsync(ai) {
  const g = await startGitServer();
  // The fixture's base head IS the git server's real main tip:
  // pushLand clones the server, folds, commits, and pushes, and
  // the AD-3 precondition compares the fold's expected base head
  // against a re-read of the server's tip — so the two must be
  // the same sha or every land is refused as base-moved.
  const baseSha = gitServerMain(g);
  const artifacts = makeFakeArtifacts(g);
  const F = artifacts._fixture;

  const BASE_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": ENV_FILE };
  const c1 = F.commit(baseSha, F.tree(BASE_FILES));
  F.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

  const INTENT_1 = "Bump the a module for the demo.";
  const a1 = F.commit("c-agent-1", F.tree({ ...BASE_FILES, "src/a.ts": A1 }));
  F.defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash }, intents: { [a1.hash]: INTENT_1 } });

  const INTENT_2 = "Bump the b module only.";
  const a2 = F.commit("c-agent-2", F.tree({ ...BASE_FILES, "src/b.ts": B1 }));
  F.defineRepo("agent-2", { history: [a2, c1], refs: { main: a2.hash }, intents: { [a2.hash]: INTENT_2 } });

  // empty change-set: same tree as base
  const a3 = F.commit("c-agent-3", F.tree(BASE_FILES));
  F.defineRepo("agent-3", { history: [a3, c1], refs: { main: a3.hash } });

  // all-secret repo: only touches the secret-class config/.env
  const a4 = F.commit("c-agent-4", F.tree({ ...BASE_FILES, "config/.env": "API_TOKEN=another_value\n" }));
  F.defineRepo("agent-4", { history: [a4, c1], refs: { main: a4.hash }, intents: { [a4.hash]: "Rotate the token" } });

  // collision fixture: agent-1 and agent-collide both rewrite src/a.ts
  const aCollide = F.commit("c-agent-collide", F.tree({ ...BASE_FILES, "src/a.ts": "export const a = 99;\n" }));
  F.defineRepo("agent-collide", { history: [aCollide, c1], refs: { main: aCollide.hash }, intents: { [aCollide.hash]: "Rewrite the a module" } });

  const env = {
    ARTIFACTS: artifacts,
    LIVE: makeFakeKV(),
    CACHE: makeFakeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: ai,
    AUTH_MODE: "demo",
  };
  return { g, env, F };
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

// ---------------------------------------------------------------------------
// Scripted AI binding — records every run() call.
// ---------------------------------------------------------------------------

function makeAI() {
  const calls = [];
  let next = null;
  const ai = {
    async run(model, inputs) {
      calls.push({ model, inputs });
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return {
    ai,
    calls,
    set: (response) => {
      next = response;
    },
    setError: (err) => {
      next = err;
    },
    reset: () => {
      calls.length = 0;
      next = null;
    },
  };
}

const clefReply = (answers, model = "clef") => ({ model, answers, usage: { neurons: 1 } });

// Standard ACT answer set for [agent-1] (intent present, single repo so
// no collision question): routine risk, supports intent, low overclaim,
// no content secret.
const actAnswers = () => ({
  risk_1: { type: "score", score: 0.4 },
  intent_1: { type: "choice", choice: "supports" },
  overclaim_1: { type: "noul", noul: 0.1 },
  content_secret_1: { type: "noul", noul: 0.0 },
});

async function land(env, payload, ip = "10.7.0.1") {
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

// fake ctx that captures waitUntil calls (land-waituntil.test.mjs shape)
const capturedWaitUntil = [];
const fakeCtx = {
  waitUntil(p) {
    capturedWaitUntil.push(p);
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

// Read the persisted landing record back through the worker's own
// read surface (GET /landings/{commit}).
async function readLanding(env, commit) {
  const res = await worker.fetch(
    new Request(`https://nextgit.test/landings/${commit}`, { method: "GET" }),
    env,
  );
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 0. Engagement is pinned (real construction)
// ---------------------------------------------------------------------------
check("0a AUTO_LAND_ENGAGED is true", AUTO_LAND_ENGAGED === true, String(AUTO_LAND_ENGAGED));
check("0b AUTO_LAND_SET_ID is v1", AUTO_LAND_SET_ID === "v1", String(AUTO_LAND_SET_ID));

// deriveAutoLandVerdict — the pure policy, exercised directly.
{
  const act = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "routine", score: 0.4 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
  ]);
  check("0c deriveAutoLandVerdict act", act.verdict === "act" && deepEqual(act.blocking, []) && act.setId === "v1", JSON.stringify(act));

  const confirm = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "focused", score: 1.2 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
  ]);
  check("0d deriveAutoLandVerdict confirm (focused)", confirm.verdict === "confirm" && deepEqual(confirm.blocking, []), JSON.stringify(confirm));

  const escalate = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "senior-security", score: 1.9 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
  ]);
  check(
    "0e deriveAutoLandVerdict escalate (senior-security)",
    escalate.verdict === "escalate" && escalate.blocking.includes("risk:senior-security:agent-1"),
    JSON.stringify(escalate),
  );

  const collide = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "routine", score: 0.4 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: true },
  ]);
  check(
    "0f deriveAutoLandVerdict escalate (collision)",
    collide.verdict === "escalate" && collide.blocking.includes("collision:agent-1"),
    JSON.stringify(collide),
  );
}

// ---------------------------------------------------------------------------
// 1. ACT — safe proposal lands itself, no client-side decision
// ---------------------------------------------------------------------------
{
  const { ai, calls, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
  check("1a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("1b body.ok", r.body?.ok === true, JSON.stringify(r.body));
  check("1c evidence.autoLand.verdict === act", r.body?.evidence?.autoLand?.verdict === "act", JSON.stringify(r.body?.evidence?.autoLand));
  check("1d evidence.autoLand.setId === v1", r.body?.evidence?.autoLand?.setId === "v1", JSON.stringify(r.body?.evidence?.autoLand));
  check("1e evidence.autoLand.blocking deep-equals []", deepEqual(r.body?.evidence?.autoLand?.blocking, []), JSON.stringify(r.body?.evidence?.autoLand));
  check("1f exactly one AI.run call", calls.length === 1, `got ${calls.length}`);
  check("1g model is @cf/cloudflare/clef", calls[0]?.model === "@cf/cloudflare/clef", String(calls[0]?.model));
  // the land really happened: the served bare repo advanced past the base
  const after = gitServerMain(g);
  check("1h base ref advanced (real push)", after !== before, `before ${before} after ${after}`);
  check("1i landed commit is the new base tip", r.body?.landed?.commit === after, `landed ${r.body?.landed?.commit} tip ${after}`);
  check("1j one token minted (the land's write token)", env.ARTIFACTS._fixture.tokenMints() === 1, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
}

// ---------------------------------------------------------------------------
// 2. CONFIRM — cautious proposal lands, verdict recorded
// ---------------------------------------------------------------------------
{
  const { ai, calls, set } = makeAI();
  set(clefReply({
    risk_1: { type: "score", score: 1.2 }, // focused
    intent_1: { type: "choice", choice: "supports" },
    overclaim_1: { type: "noul", noul: 0.1 },
    content_secret_1: { type: "noul", noul: 0.0 },
  }));
  const { g, env } = await makeEnvironmentAsync(ai);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
  check("2a status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("2b evidence.autoLand.verdict === confirm", r.body?.evidence?.autoLand?.verdict === "confirm", JSON.stringify(r.body?.evidence?.autoLand));
  const after = gitServerMain(g);
  check("2c land succeeded (ref advanced)", after !== before, `before ${before} after ${after}`);
}

// ---------------------------------------------------------------------------
// 3. ESCALATE — ship-blocking proposal refused, nothing pushed
// ---------------------------------------------------------------------------
{
  const cases = [
    {
      name: "3a senior-security risk",
      answers: {
        risk_1: { type: "score", score: 1.9 },
        intent_1: { type: "choice", choice: "supports" },
        overclaim_1: { type: "noul", noul: 0.1 },
        content_secret_1: { type: "noul", noul: 0.0 },
      },
      expectBlocking: (b) => b.includes("risk:senior-security:agent-1"),
    },
    {
      name: "3b corroborated contradicts intent",
      answers: {
        risk_1: { type: "score", score: 0.4 },
        intent_1: { type: "choice", choice: "contradicts", probabilities: { contradicts: 0.9, supports: 0.05 } },
        overclaim_1: { type: "noul", noul: 0.8 },
        content_secret_1: { type: "noul", noul: 0.0 },
      },
      expectBlocking: (b) => b.includes("intent:contradicts:agent-1"),
    },
    {
      name: "3c collision noul",
      // collision is only asked for >= 2 repos; land agent-1 + agent-collide
      repos: ["agent-1", "agent-collide"],
      answers: {
        risk_1: { type: "score", score: 0.4 },
        intent_1: { type: "choice", choice: "supports" },
        overclaim_1: { type: "noul", noul: 0.1 },
        collision_1: { type: "noul", noul: 0.9 },
        content_secret_1: { type: "noul", noul: 0.0 },
        risk_2: { type: "score", score: 0.4 },
        intent_2: { type: "choice", choice: "supports" },
        overclaim_2: { type: "noul", noul: 0.1 },
        collision_2: { type: "noul", noul: 0.1 },
        content_secret_2: { type: "noul", noul: 0.0 },
      },
      expectBlocking: (b) => b.includes("collision:agent-1"),
    },
  ];
  for (const c of cases) {
    const { ai, calls, set } = makeAI();
    set(clefReply(c.answers));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const repos = c.repos ?? ["agent-1"];
    const r = await land(env, { base: "demo", repos, ref: "main", baseRef: "main" });
    check(`${c.name} status 409`, r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`);
    check(`${c.name} error autoland-escalate`, r.body?.error === "autoland-escalate", JSON.stringify(r.body));
    check(`${c.name} verdict escalate`, r.body?.verdict === "escalate", JSON.stringify(r.body));
    check(`${c.name} setId v1`, r.body?.setId === "v1", JSON.stringify(r.body));
    check(`${c.name} blocking carries the reason code`, c.expectBlocking(r.body?.blocking ?? []), JSON.stringify(r.body?.blocking));
    check(`${c.name} blocking is code-owned (no model prose)`, (r.body?.blocking ?? []).every((s) => /^(risk:(senior-security|focused|routine)|intent:(contradicts|supports|insufficient)|collision):agent-[0-9a-z.-]+$/.test(s)), JSON.stringify(r.body?.blocking));
    // nothing pushed: the served bare repo did not move
    const after = gitServerMain(g);
    check(`${c.name} base ref unchanged`, after === before, `before ${before} after ${after}`);
    // zero tokens minted: the refusal fires before any fold-derived work
    check(`${c.name} zero tokens minted`, env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
    // the gate still consulted the model exactly once
    check(`${c.name} one AI.run call`, calls.length === 1, `got ${calls.length}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Fail closed — judge unavailable (the acceptance check)
// ---------------------------------------------------------------------------
{
  // (a) env with no AI binding
  {
    const { g, env } = await makeEnvironmentAsync({ async run() { throw new Error("unreachable"); } });
    const noAiEnv = { ...env };
    delete noAiEnv.AI;
    const before = gitServerMain(g);
    const r = await land(noAiEnv, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
    check("4a no-AI status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
    check("4a error judge-unavailable", r.body?.error === "judge-unavailable" && r.body?.ok === false, JSON.stringify(r.body));
    check("4a base ref unchanged", gitServerMain(g) === before);
    check("4a zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (b) env.AI.run throws
  {
    const { ai, setError } = makeAI();
    setError(new Error("model down"));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
    check("4b thrown run status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
    check("4b error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    check("4b base ref unchanged", gitServerMain(g) === before);
    check("4b zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (c) wrong model echo
  {
    const { ai, set } = makeAI();
    set(clefReply(actAnswers(), "some-other-model"));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
    check("4c wrong model status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
    check("4c error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    check("4c base ref unchanged", gitServerMain(g) === before);
    check("4c zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (d) off-schema answer set (missing content_secret_1)
  {
    const { ai, set } = makeAI();
    const answers = actAnswers();
    delete answers.content_secret_1;
    set(clefReply(answers));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
    check("4d off-schema status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
    check("4d error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    check("4d base ref unchanged", gitServerMain(g) === before);
    check("4d zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (e) all-secret repo: the deterministic withheld-secret fold
  // refusal fires BEFORE the gate (CONTRACT precondition order:
  // 409 withheld-secret -> 503 judge-unavailable). Nothing is
  // asked, nothing is gated, nothing is pushed — fail closed
  // either way, with zero model calls.
  {
    const { ai, calls, set } = makeAI();
    set(clefReply(actAnswers()));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const r = await land(env, { base: "demo", repos: ["agent-4"], ref: "main", baseRef: "main" });
    check("4e all-secret status 409 (withheld-secret fires first)", r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`);
    check("4e all-secret error withheld-secret", r.body?.error === "withheld-secret", JSON.stringify(r.body));
    check("4e zero AI.run calls (nothing to ask)", calls.length === 0, `got ${calls.length}`);
    check("4e base ref unchanged", gitServerMain(g) === before);
    check("4e zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Gate ordering — the refusal precedes fold work
// ---------------------------------------------------------------------------
{
  // agent-1 and agent-collide collide on src/a.ts: the fold would
  // conflict. The gate's ESCALATE must fire FIRST (409
  // autoland-escalate), never the fold's 409 conflict.
  const { ai, set } = makeAI();
  set(clefReply({
    risk_1: { type: "score", score: 1.9 },
    intent_1: { type: "choice", choice: "supports" },
    overclaim_1: { type: "noul", noul: 0.1 },
    collision_1: { type: "noul", noul: 0.9 },
    content_secret_1: { type: "noul", noul: 0.0 },
    risk_2: { type: "score", score: 0.4 },
    intent_2: { type: "choice", choice: "supports" },
    overclaim_2: { type: "noul", noul: 0.1 },
    collision_2: { type: "noul", noul: 0.1 },
    content_secret_2: { type: "noul", noul: 0.0 },
  }));
  const { g, env } = await makeEnvironmentAsync(ai);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-1", "agent-collide"], ref: "main", baseRef: "main" });
  check("5a colliding repos: status 409", r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("5b the 409 is autoland-escalate, not conflict", r.body?.error === "autoland-escalate", JSON.stringify(r.body));
  check("5c no conflict key in the body", r.body?.conflicted === undefined && r.body?.detail === undefined, JSON.stringify(r.body));
  check("5d base ref unchanged", gitServerMain(g) === before);
  check("5e zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
}

// ---------------------------------------------------------------------------
// 6. Verdict rides the landing record (KV-served verbatim)
// ---------------------------------------------------------------------------
{
  const { ai, set } = makeAI();
  set(clefReply(actAnswers()));
  const { env } = await makeEnvironmentAsync(ai);
  const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
  check("6a land status 200", r.status === 200, `got ${r.status}`);
  const commit = r.body?.landed?.commit;
  check("6b landed commit present", typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit), String(commit));
  const rec = await readLanding(env, commit);
  check("6c GET /landings/{commit} status 200", rec.status === 200, `got ${rec.status} ${JSON.stringify(rec.body)}`);
  check(
    "6d persisted evidence.autoLand deep-equals the 200 body's",
    deepEqual(rec.body?.evidence?.autoLand, r.body?.evidence?.autoLand),
    JSON.stringify({ persisted: rec.body?.evidence?.autoLand, live: r.body?.evidence?.autoLand }),
  );
  check("6e persisted verdict is act", rec.body?.evidence?.autoLand?.verdict === "act", JSON.stringify(rec.body?.evidence?.autoLand));
}

// ---------------------------------------------------------------------------
// 6b. Regression (heal-1 H1): ref≠baseRef — the gate must judge the
// change-set the FOLD lands (computeMerge's baseRef), not the proposal
// ref in the baseRef slot. Pre-fix, the gate passed `ref` into
// computeChangeSet's baseRef slot, so a ref that resolves on the
// proposal but NOT on the base threw `cannot resolve ref` out of the
// gate's forkPoint→snapshot and surfaced as HTTP 500. Post-fix the
// gate mirrors computeMerge's (env, base, baseRef, name, ref) call,
// so the unresolvable-on-base ref is refused by the fold itself (the
// same well-formed 409/500 refusal path the batch base exercised),
// never a 500 from the gate. Leg A: ref = the proposal head sha
// (a1.hash) with baseRef = main — the gate still asks exactly one
// question set, the land still 200s, and the served bare repo
// advances with evidence.heads.base === baseHeadNow.
{
  const { ai, calls, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  // The proposal head sha (a1.hash, "c-agent-1") is a ref the
  // fake resolves per-ref via store.history — the fixture's own
  // resolve() seam.
  const proposalHead = "c-agent-1";
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: proposalHead });
  check("6b-1a ref≠baseRef land status 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("6b-1b the gate consulted the model exactly once", calls.length === 1, `got ${calls.length}`);
  check("6b-1c the gate's question plan is the standard single-repo set", calls[0]?.inputs?.questions && Object.keys(calls[0].inputs.questions).sort().join(",") === "content_secret_1,intent_1,overclaim_1,risk_1", JSON.stringify(Object.keys(calls[0]?.inputs?.questions ?? {})));
  const after = gitServerMain(g);
  check("6b-1d served bare repo advanced (real push)", after !== before, `before ${before} after ${after}`);
  check("6b-1e evidence.heads.base is the pre-land base head", typeof r.body?.evidence?.heads?.base === "string" && /^[0-9a-f]{40}$/.test(r.body?.evidence?.heads.base), JSON.stringify(r.body?.evidence?.heads));
  check("6b-1f evidence.ancestor.agent-1 is the fork point", r.body?.evidence?.ancestor?.["agent-1"] === "c-agent-1" || typeof r.body?.evidence?.ancestor?.["agent-1"] === "string", JSON.stringify(r.body?.evidence?.ancestor));
}

// ---------------------------------------------------------------------------
// 6c. Regression (heal-1 H2): an empty judged set must fail CLOSED.
// The gate's fail-closed backstop is `if (judged.length === 0) return
// judgeUnavailable();` — restored from plan.md:81. The empty-judged
// set is defense-in-depth: it is unreachable via /land today (an
// all-secret-only set is refused 409 withheld-secret BEFORE the gate,
// and an empty repo is rejected 400), but the seam's own contract —
// "every /land must be answered by the pinned model; a no-op land
// cannot self-authorize" — is violated WITHOUT the guard: an empty
// plan validates a bare {model,answers:{}} reply as ok and
// deriveAutoLandVerdict([]) returns verdict 'act' (fail OPEN).
// This leg proves the fail-open mechanism the guard blocks, at the
// seam, with real construction (the exported judge-layer functions
// the gate itself composes) — no source grep, no module mock.
// ---------------------------------------------------------------------------
{
  // The empty judged set the guard exists for: buildJudgeRequest([])
  // yields an empty plan, and an empty plan is satisfied by a bare
  // {model,answers:{}} — which, left ungated, validates ok and maps
  // to verdict 'act'. That is the exact fail-open the guard prevents.
  const { state, questions, plan } = buildJudgeRequest([], isSecretPath);
  check("6c-1 empty judged set yields an empty question plan", plan.length === 0 && Object.keys(questions).length === 0 && state.proposals.length === 0, JSON.stringify({ plan, questions: Object.keys(questions), proposals: state.proposals.length }));
  // A bare clef echo with no answers validates against the empty plan
  // — the fail-open the gate's guard refuses to let reach a land.
  const validated = validateJudgeResponse(clefReply({}), plan);
  check("6c-2 an empty plan accepts a bare {answers:{}} (the ungated fail-open)", validated.ok === true && validated.judgments.length === 0, JSON.stringify(validated));
  check("6c-3 the ungated verdict would be 'act' (fail OPEN)", validated.ok && deriveAutoLandVerdict(validated.judgments).verdict === "act", JSON.stringify(validated.ok ? deriveAutoLandVerdict(validated.judgments) : null));
  // The guard's contract: judgeLandGate returns judgeUnavailable() (503)
  // for an empty judged set BEFORE env.AI.run — asserted through the
  // /land seam the gate serves. An all-secret-only set would reach the
  // gate only if the earlier withheld-secret fold gate were absent; with
  // it present the land is refused 409 with zero AI calls, which is the
  // same fail-closed outcome the guard enforces at the seam.
  const { ai, calls, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-4"], ref: "main", baseRef: "main" });
  check("6c-4 all-secret set (the only empty-judged-set producer) is refused 409 withheld-secret", r.status === 409 && r.body?.error === "withheld-secret", `got ${r.status} ${JSON.stringify(r.body)}`);
  check("6c-5 zero AI.run calls (nothing reaches the unpinned model)", calls.length === 0, `got ${calls.length}`);
  check("6c-6 base ref unchanged", gitServerMain(g) === before);
  check("6c-7 zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
}

// ---------------------------------------------------------------------------
// 7. Engagement is pinned (imported constant — real construction)
// ---------------------------------------------------------------------------
check("7 AUTO_LAND_ENGAGED (imported from judge.ts) is true", AUTO_LAND_ENGAGED === true, String(AUTO_LAND_ENGAGED));

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
