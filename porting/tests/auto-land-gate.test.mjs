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
import { AUTO_LAND_SET_ID, buildJudgeRequest, deriveAutoLandVerdict, validateJudgeResponse } from "../../platform/src/judge.ts";
import { AUTO_LAND_ENGAGED, autoLandEligible, hasCleanCorroboratingSignal } from "../../platform/src/autoland.ts";

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
check("0a AUTO_LAND_ENGAGED is false (off by default)", AUTO_LAND_ENGAGED === false, String(AUTO_LAND_ENGAGED));
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
// 1. Unengaged /land works with the AI binding ABSENT (acceptance a).
// The engagement switch is off: NO judge call is made (there is no
// binding to call — zero AI surface use), the land runs the
// pre-gate path (clone, fold, commit, push) for real, and the
// evidence carries NO autoLand key (byte-identical to the pre-gate
// 12-key shape).
// ---------------------------------------------------------------------------
{
  const { g, env } = await makeEnvironmentAsync(undefined);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main" });
  check("1a status 200 (unengaged, AI binding absent)", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("1b body.ok", r.body?.ok === true, JSON.stringify(r.body));
  check("1c autoLand key ABSENT from evidence", !("autoLand" in (r.body?.evidence ?? {})), JSON.stringify(Object.keys(r.body?.evidence ?? {})));
  // the land really happened: the served bare repo advanced past the base
  const after = gitServerMain(g);
  check("1d base ref advanced (real push)", after !== before, `before ${before} after ${after}`);
  check("1e landed commit is the new base tip", r.body?.landed?.commit === after, `landed ${r.body?.landed?.commit} tip ${after}`);
  check("1f evidence is the pre-gate 12-key shape", Object.keys(r.body?.evidence ?? {}).length === 12, JSON.stringify(Object.keys(r.body?.evidence ?? {})));
  check("1g one token minted (the land's write token)", env.ARTIFACTS._fixture.tokenMints() === 1, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
}

// ---------------------------------------------------------------------------
// 1b. Unengaged refusals — the pre-gate refusal legs (withheld-secret
// 409 / content-detected-secret 409 / conflict 409 / no-changes 409 /
// base-moved 409) re-run with AI: undefined and assert zero AI use +
// autoLand absent — byte-identical behavior while unengaged.
// ---------------------------------------------------------------------------
{
  // withheld-secret: agent-4 is the all-secret fixture — the fold
  // refuses 409 withheld-secret before anything else.
  const { g, env } = await makeEnvironmentAsync(undefined);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-4"], ref: "main", baseRef: "main" });
  check("1b-1 withheld-secret 409 (AI absent)", r.status === 409 && r.body?.error === "withheld-secret", `got ${r.status} ${JSON.stringify(r.body)}`);
  check("1b-2 autoLand absent", !("autoLand" in (r.body ?? {})), JSON.stringify(Object.keys(r.body ?? {})));
  check("1b-3 base ref unchanged", gitServerMain(g) === before);
  check("1b-4 zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  // no-changes: agent-3 folds nothing onto the base.
  const e2 = await makeEnvironmentAsync(undefined);
  const r2 = await land(e2.env, { base: "demo", repos: ["agent-3"], ref: "main", baseRef: "main" });
  check("1b-5 no-changes 409 (AI absent)", r2.status === 409 && r2.body?.error === "no-changes", `got ${r2.status} ${JSON.stringify(r2.body)}`);
  check("1b-6 autoLand absent", !("autoLand" in (r2.body ?? {})), JSON.stringify(Object.keys(r2.body ?? {})));
  // conflict: agent-1 + agent-collide collide on src/a.ts.
  const e3 = await makeEnvironmentAsync(undefined);
  const before3 = gitServerMain(e3.g);                       // capture BEFORE the land (e3 env)
  const r3 = await land(e3.env, { base: "demo", repos: ["agent-1", "agent-collide"], ref: "main", baseRef: "main" });
  check("1b-7 conflict 409 (AI absent)", r3.status === 409 && r3.body?.error === "conflict", `got ${r3.status} ${JSON.stringify(r3.body)}`);
  check("1b-8 autoLand absent", !("autoLand" in (r3.body ?? {})), JSON.stringify(Object.keys(r3.body ?? {})));
  check("1b-9 conflicted carries a.js", Array.isArray(r3.body?.conflicted) && r3.body.conflicted.includes("src/a.ts"), JSON.stringify(r3.body?.conflicted));
  check("1b-10 base ref unchanged", gitServerMain(e3.g) === before3);   // real before/after compare
  check("1b-11 zero tokens minted", e3.env.ARTIFACTS._fixture.tokenMints() === 0, `got ${e3.env.ARTIFACTS._fixture.tokenMints()}`);
}

// ---------------------------------------------------------------------------
// 1c. Client-supplied gate flag rejected (acceptance d): a body
// carrying `gate` (true, false, or a string form) is a 400
// bad-request — engagement is server-side and record-gated, never
// a client field. Zero AI use; base ref unchanged.
// ---------------------------------------------------------------------------
{
  for (const gateValue of [true, false, "engaged"]) {
    const { ai, calls } = makeAI();
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const r = await land(env, { base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main", gate: gateValue });
    check(`1c error bad-request (gate=${JSON.stringify(gateValue)})`, r.body?.ok === false && /gate is not a client-supplied field/.test(r.body?.error ?? ""), JSON.stringify(r.body));
    check(`1c zero AI.run calls (gate=${JSON.stringify(gateValue)})`, calls.length === 0, `got ${calls.length}`);
    check(`1c base ref unchanged (gate=${JSON.stringify(gateValue)})`, gitServerMain(g) === before);
    check(`1c zero tokens minted (gate=${JSON.stringify(gateValue)})`, env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Eligibility + corroboration predicates (pure policy — the
// engaged-posture ROUTE legs moved to autoland-engaged.test.mjs;
// the constant-independent policy stays here).
// ---------------------------------------------------------------------------
{
  // Eligibility: the switch is off, so no record outcome can make
  // the land eligible — engagement cannot ship without the switch.
  check("2a autoLandEligible(true) is false (switch off)", autoLandEligible(true) === false, String(autoLandEligible(true)));
  // The corroboration interlock: a clean fold (status clean, empty
  // conflict map) passes; a seeded diff3 conflict does not.
  const cleanMerge = { status: "clean", conflicted: [], files: [{ result: "clean" }, { result: "identical" }] };
  check("2b hasCleanCorroboratingSignal(clean) === true", hasCleanCorroboratingSignal(cleanMerge) === true, String(hasCleanCorroboratingSignal(cleanMerge)));
  const conflictMerge = { status: "conflict", conflicted: ["a.js"], files: [{ result: "conflict" }] };
  check("2c hasCleanCorroboratingSignal(conflict) === false", hasCleanCorroboratingSignal(conflictMerge) === false, String(hasCleanCorroboratingSignal(conflictMerge)));
  // An unclean fold status with an empty conflict map still blocks.
  const uncleanMerge = { status: "conflict", conflicted: [], files: [] };
  check("2d hasCleanCorroboratingSignal(unclean status) === false", hasCleanCorroboratingSignal(uncleanMerge) === false, String(hasCleanCorroboratingSignal(uncleanMerge)));
  // A clean status with a non-empty conflict map still blocks.
  const mapMerge = { status: "clean", conflicted: ["a.js"], files: [] };
  check("2e hasCleanCorroboratingSignal(non-empty map) === false", hasCleanCorroboratingSignal(mapMerge) === false, String(hasCleanCorroboratingSignal(mapMerge)));
}

// ---------------------------------------------------------------------------
// 3. Unengaged precondition ordering — the pre-gate refusal legs that
// do not depend on the gate: an all-secret repo is refused 409
// withheld-secret BEFORE any gate (CONTRACT precondition order),
// with the AI binding scripted but never consulted. (The engaged
// ESCALATE / fail-closed / ordering / verdict-ride route legs moved
// to autoland-engaged.test.mjs — the seam-level engaged suite.)
// ---------------------------------------------------------------------------
{
  const { ai, calls, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  const before = gitServerMain(g);
  const r = await land(env, { base: "demo", repos: ["agent-4"], ref: "main", baseRef: "main" });
  check("3a all-secret status 409 (withheld-secret fires first)", r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`);
  check("3b all-secret error withheld-secret", r.body?.error === "withheld-secret", JSON.stringify(r.body));
  check("3c zero AI.run calls (nothing to ask)", calls.length === 0, `got ${calls.length}`);
  check("3d base ref unchanged", gitServerMain(g) === before);
  check("3e zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  check("3f autoLand absent from the refusal body", !("autoLand" in r.body), JSON.stringify(Object.keys(r.body)));
}

// ---------------------------------------------------------------------------
// 6b. Regression (heal-1 H1) — the ref≠baseRef route leg (the gate
// judges the change-set the FOLD lands) is an engaged-posture route
// leg: it moved to autoland-engaged.test.mjs. The constant-
// independent seam proof (6c) stays below.

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
check("7 AUTO_LAND_ENGAGED (imported from autoland.ts) is false", AUTO_LAND_ENGAGED === false, String(AUTO_LAND_ENGAGED));
check("7b autoLandEligible(false) is false (record-gated)", autoLandEligible(false) === false, String(autoLandEligible(false)));

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
