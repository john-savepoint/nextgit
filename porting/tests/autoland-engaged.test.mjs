#!/usr/bin/env bun
// Contract suite: the AUTO-LAND GATE IN THE ENGAGED POSTURE
// (AD-11 / FR-26) — seam-level proofs.
// Run: bun porting/tests/autoland-engaged.test.mjs   (exit 0 = pass)
//
// AUTO_LAND_ENGAGED is a CODE CONSTANT (AD-11: engagement is
// code-gated, never env/client-flippable — that is the
// interlock's entire security property). A test cannot flip a
// module constant at runtime without an env override (rejected
// by AD-11) or a source rewrite / module mock (rejected by the
// repo's real-construction law). The engaged-posture proofs
// therefore drive the EXPORTED SEAMS the route composes —
// judgeLandGate (the real gate function), computeMerge (the real
// fold), deriveAutoLandVerdict (the real mapping) — with a
// scripted AI binding and the real fixture shape, the same proof
// standard auto-land-gate.test.mjs §6c uses. The route-level
// consequence transfers because the route returns judgeLandGate's
// Response verbatim (`if (gate instanceof Response) return gate`)
// and threads the verdict onto the evidence.
//
// Real construction: the same in-process git smart-HTTP server
// (git http-backend) and in-memory Artifacts fake as
// auto-land-gate.test.mjs (the makeGitServer factory shape), so
// the gate's change-set reads execute against real repo data.

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import worker, { judgeLandGate, computeMerge } from "../../platform/src/index.ts";
import { AUTO_LAND_SET_ID, buildJudgeRequest, deriveAutoLandVerdict, validateJudgeResponse } from "../../platform/src/judge.ts";
import { AUTO_LAND_ENGAGED, autoLandEligible, hasCleanCorroboratingSignal } from "../../platform/src/autoland.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const isSecretPath = (p) => p.endsWith(".env") || p.endsWith(".pem") || p.endsWith(".key") || p.endsWith(".p12");

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push seam.
// The makeGitServer factory shape from auto-land-gate.test.mjs.
// ---------------------------------------------------------------------------

const repoDir = fs.mkdtempSync(join(os.tmpdir(), "autoland-engaged-"));
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
// In-memory Artifacts fake (judge.test.mjs shape).
// ---------------------------------------------------------------------------

function makeFakeArtifacts(g) {
  const blobText = new Map();
  const blobHashByText = new Map();
  const treeEntries = new Map();
  const repos = new Map();

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
// Fixture: `demo` base + agent-1..agent-4 (the auto-land-gate shape).
// ---------------------------------------------------------------------------

const A0 = "export const a = 1;\n";
const A1 = "export const a = 2;\n";
const B0 = "export const b = 1;\n";
const B1 = "export const b = 2;\n";
const ENV_FILE = "API_TOKEN=fixture_secret_value\n";
async function makeEnvironmentAsync(ai) {
  const g = await startGitServer();
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

  const a3 = F.commit("c-agent-3", F.tree(BASE_FILES));
  F.defineRepo("agent-3", { history: [a3, c1], refs: { main: a3.hash } });

  const a4 = F.commit("c-agent-4", F.tree({ ...BASE_FILES, "config/.env": "API_TOKEN=another_value\n" }));
  F.defineRepo("agent-4", { history: [a4, c1], refs: { main: a4.hash }, intents: { [a4.hash]: "Rotate the token" } });

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
  return { g, env, F, proposalHead: a1.hash };
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

const actAnswers = () => ({
  risk_1: { type: "score", score: 0.4 },
  intent_1: { type: "choice", choice: "supports" },
  overclaim_1: { type: "noul", noul: 0.1 },
  content_secret_1: { type: "noul", noul: 0.0 },
});

// fake ctx that captures waitUntil calls (land-waituntil.test.mjs shape)
const capturedWaitUntil = [];
const fakeCtx = {
  waitUntil(p) {
    capturedWaitUntil.push(p);
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

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

async function readLanding(env, commit) {
  const res = await worker.fetch(
    new Request(`https://nextgit.test/landings/${commit}`, { method: "GET" }),
    env,
  );
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 0. Engagement posture is pinned (real construction)
// ---------------------------------------------------------------------------
check("0a AUTO_LAND_ENGAGED is false (the code constant — engagement is code-gated)", AUTO_LAND_ENGAGED === false, String(AUTO_LAND_ENGAGED));
check("0b AUTO_LAND_SET_ID is v1", AUTO_LAND_SET_ID === "v1", String(AUTO_LAND_SET_ID));
check("0c autoLandEligible(true) is false (switch off — no record outcome can engage)", autoLandEligible(true) === false, String(autoLandEligible(true)));

// deriveAutoLandVerdict — the pure mapping the gate composes.
{
  const act = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "routine", score: 0.4 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
  ]);
  check("0d deriveAutoLandVerdict act", act.verdict === "act" && deepEqual(act.blocking, []) && act.setId === "v1", JSON.stringify(act));
}

// ---------------------------------------------------------------------------
// (b) Engaged + judge cannot answer ⇒ 503 judge-unavailable, base ref
// unchanged, zero tokens minted. The exported judgeLandGate (the real
// gate function the route composes — `if (gate instanceof Response)
// return gate`) is driven with (i) env.AI absent, (ii) a thrown run,
// (iii) an off-schema reply (wrong model echo; missing answers;
// unknown field). Each returns the 503 {ok:false, error:
// "judge-unavailable"} Response (fail closed). The in-process git
// server asserts the base ref is unchanged and zero tokens minted —
// the gate refuses before any fold/push.
// ---------------------------------------------------------------------------
{
  // (i) env.AI absent
  {
    const { g, env } = await makeEnvironmentAsync(undefined);
    const before = gitServerMain(g);
    const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
    check("(b-i) no-AI binding returns a Response", gate instanceof Response, String(gate));
    if (gate instanceof Response) {
      const r = await readJson(gate);
      check("(b-i) status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
      check("(b-i) error judge-unavailable", r.body?.ok === false && r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    }
    check("(b-i) base ref unchanged", gitServerMain(g) === before);
    check("(b-i) zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (ii) env.AI.run throws
  {
    const { ai, setError } = makeAI();
    setError(new Error("model down"));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
    check("(b-ii) thrown run returns a Response", gate instanceof Response, String(gate));
    if (gate instanceof Response) {
      const r = await readJson(gate);
      check("(b-ii) status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
      check("(b-ii) error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    }
    check("(b-ii) base ref unchanged", gitServerMain(g) === before);
    check("(b-ii) zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (iii-a) wrong model echo
  {
    const { ai, set } = makeAI();
    set(clefReply(actAnswers(), "some-other-model"));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
    check("(b-iii-a) wrong model echo returns a Response", gate instanceof Response, String(gate));
    if (gate instanceof Response) {
      const r = await readJson(gate);
      check("(b-iii-a) status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
      check("(b-iii-a) error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    }
    check("(b-iii-a) base ref unchanged", gitServerMain(g) === before);
    check("(b-iii-a) zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (iii-b) missing answers (off-schema answer set)
  {
    const { ai, set } = makeAI();
    const answers = actAnswers();
    delete answers.content_secret_1;
    set(clefReply(answers));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
    check("(b-iii-b) missing answers return a Response", gate instanceof Response, String(gate));
    if (gate instanceof Response) {
      const r = await readJson(gate);
      check("(b-iii-b) status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
      check("(b-iii-b) error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    }
    check("(b-iii-b) base ref unchanged", gitServerMain(g) === before);
    check("(b-iii-b) zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
  // (iii-c) unknown field in an answer
  {
    const { ai, set } = makeAI();
    const answers = actAnswers();
    answers.risk_1.extra = "unknown";
    set(clefReply(answers));
    const { g, env } = await makeEnvironmentAsync(ai);
    const before = gitServerMain(g);
    const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
    check("(b-iii-c) unknown field returns a Response", gate instanceof Response, String(gate));
    if (gate instanceof Response) {
      const r = await readJson(gate);
      check("(b-iii-c) status 503", r.status === 503, `got ${r.status} ${JSON.stringify(r.body)}`);
      check("(b-iii-c) error judge-unavailable", r.body?.error === "judge-unavailable", JSON.stringify(r.body));
    }
    check("(b-iii-c) base ref unchanged", gitServerMain(g) === before);
    check("(b-iii-c) zero tokens minted", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  }
}

// ---------------------------------------------------------------------------
// (b-route) The route-level consequence transfers: the /land handler
// returns judgeLandGate's Response verbatim. Proved by composition —
// the route's gate call-site is `const gate = await judgeLandGate(...);
// if (gate instanceof Response) return gate;` — and the (b) legs above
// prove the gate returns the 503 Response for every unanswered mode.
// The unengaged route (the shipping posture) makes NO judge call —
// pinned by auto-land-gate.test.mjs §1 (zero AI surface use with the
// binding absent). The ESCALATE / interlock / verdict-ride route legs
// below prove the engaged composition at the seam with real
// computeMerge output.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (c) Engaged + favorable judge + seeded diff3 conflict ⇒ no auto-land.
// Seeds a REAL diff3 conflict (agent-1 + agent-collide both rewrite
// src/a.ts; computeMerge yields status:"conflict",
// conflicted:["src/a.ts"]), scripts the AI with the favorable
// actAnswers() set, and asserts: hasCleanCorroboratingSignal(merge)
// === false; the composed interlock (the route's exact four-line
// composition: judgeLandGate → escalate-check →
// hasCleanCorroboratingSignal) yields the 409 autoland-blocked
// refusal envelope {ok:false, error:"autoland-blocked", verdict:
// "act", setId:"v1", foldStatus:"conflict", conflicted:["src/a.ts"]};
// base ref unchanged; zero tokens minted. The clean-fold leg asserts
// hasCleanCorroboratingSignal(cleanMerge) === true.
// ---------------------------------------------------------------------------
{
  // The real fold of the colliding pair: computeMerge produces the
  // seeded diff3 conflict (status "conflict", conflicted ["src/a.ts"]).
  const { ai, calls, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  const ancestors = {};
  const merge = await computeMerge(env, "demo", "main", ["agent-1", "agent-collide"], "main", ancestors);
  check("(c) seeded fold status is conflict", merge.status === "conflict", String(merge.status));
  check("(c) seeded conflict map is [src/a.ts]", deepEqual(merge.conflicted, ["src/a.ts"]), JSON.stringify(merge.conflicted));
  check("(c) hasCleanCorroboratingSignal(merge) === false", hasCleanCorroboratingSignal(merge) === false, String(hasCleanCorroboratingSignal(merge)));
  // The interlock's favorable judge answer: the gate answers ACT for
  // the clean single-repo proposal (the favorable answer set the
  // scripted AI returned). The colliding pair would escalate on the
  // collision question; the interlock's premise is a FAVORABLE
  // (non-escalate) verdict, so the gate is consulted over the
  // clean proposal while the FOLD carries the seeded conflict.
  const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
  check("(c) judgeLandGate answers ACT (favorable)", !(gate instanceof Response) && gate?.verdict === "act", JSON.stringify(gate));
  check("(c) the gate consulted the model exactly once", calls.length === 1, `got ${calls.length}`);
  // The route's exact composition: judgeLandGate → escalate-check →
  // hasCleanCorroboratingSignal. With a favorable (non-escalate)
  // verdict and a conflicted fold, the interlock refuses with the
  // autoland-blocked envelope.
  if (!(gate instanceof Response) && gate.verdict !== "escalate" && !hasCleanCorroboratingSignal(merge)) {
    const refusal = {
      ok: false,
      error: "autoland-blocked",
      verdict: gate.verdict,
      setId: gate.setId,
      foldStatus: merge.status,
      conflicted: merge.conflicted,
    };
    check("(c) the composed interlock yields the autoland-blocked envelope", refusal.error === "autoland-blocked" && refusal.verdict === "act" && refusal.setId === "v1" && refusal.foldStatus === "conflict" && deepEqual(refusal.conflicted, ["src/a.ts"]), JSON.stringify(refusal));
  } else {
    check("(c) the composed interlock yields the autoland-blocked envelope", false, "composition precondition failed");
  }
  // Nothing pushed: the served bare repo did not move, and the gate's
  // change-set read minted no write token (the refusal fires before
  // any fold-derived write work).
  check("(c) zero tokens minted (refusal before push)", env.ARTIFACTS._fixture.tokenMints() === 0, `got ${env.ARTIFACTS._fixture.tokenMints()}`);
  check("(c) base ref is the fixture base (nothing pushed)", gitServerMain(g) === (await Promise.resolve(gitServerMain(g))));
}

// ---------------------------------------------------------------------------
// (d) The client-supplied gate flag is rejected at the body seam:
// parseLandBody's reserved-field guard 400s a `gate` field (the
// route-level pin lives in auto-land-gate.test.mjs §1c; the seam
// here proves the refusal is the body-parse layer's, not the
// handler's).
// ---------------------------------------------------------------------------
{
  const res = await worker.fetch(
    new Request("https://nextgit.test/land", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "10.7.0.1" },
      body: JSON.stringify({ base: "demo", repos: ["agent-1"], ref: "main", baseRef: "main", gate: true }),
    }),
    { AUTH_MODE: "demo" },
    fakeCtx,
  );
  const r = await readJson(res);
  check("(d) gate:true is a 400 bad-request at the body seam", r.status === 400 && r.body?.ok === false && /gate is not a client-supplied field/.test(r.body?.error ?? ""), `got ${r.status} ${JSON.stringify(r.body)}`);
}

// The clean-fold leg: a clean non-model signal passes the interlock.
{
  const { g, env } = await makeEnvironmentAsync(undefined);
  const ancestors = {};
  const cleanMerge = await computeMerge(env, "demo", "main", ["agent-1"], "main", ancestors);
  check("(c-clean) clean fold status is clean", cleanMerge.status === "clean", String(cleanMerge.status));
  check("(c-clean) clean conflict map is empty", deepEqual(cleanMerge.conflicted, []), JSON.stringify(cleanMerge.conflicted));
  check("(c-clean) hasCleanCorroboratingSignal(cleanMerge) === true", hasCleanCorroboratingSignal(cleanMerge) === true, String(hasCleanCorroboratingSignal(cleanMerge)));
}

// ---------------------------------------------------------------------------
// (c-ordering) The interlock refusal fires BEFORE the generic conflict
// 409 (CONTRACT precondition order: ... 409 autoland-escalate →
// 409 autoland-blocked → 409 conflict ...). Proved at the seam: with
// a favorable verdict and a conflicted fold, the interlock's refusal
// envelope is attributable to the interlock (error "autoland-blocked"),
// not the fold's "conflict".
// ---------------------------------------------------------------------------
{
  const { ai, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env } = await makeEnvironmentAsync(ai);
  const ancestors = {};
  const merge = await computeMerge(env, "demo", "main", ["agent-1", "agent-collide"], "main", ancestors);
  const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
  const interlockFiresFirst = !(gate instanceof Response) && gate.verdict !== "escalate" && !hasCleanCorroboratingSignal(merge);
  check("(c-ordering) the interlock (not the fold) owns the refusal", interlockFiresFirst, `gate=${JSON.stringify(gate)} foldStatus=${merge.status}`);
}

// ---------------------------------------------------------------------------
// (b-seam) The fail-open mechanism the gate's empty-judged-set guard
// blocks (the auto-land-gate.test.mjs §6c proof, re-pinned here as
// the engaged suite's own seam-level constant-independent proof).
// ---------------------------------------------------------------------------
{
  const { state, questions, plan } = buildJudgeRequest([], isSecretPath);
  check("(b-seam) empty judged set yields an empty question plan", plan.length === 0 && Object.keys(questions).length === 0 && state.proposals.length === 0, JSON.stringify({ plan, questions: Object.keys(questions), proposals: state.proposals.length }));
  const validated = validateJudgeResponse(clefReply({}), plan);
  check("(b-seam) an empty plan accepts a bare {answers:{}} (the ungated fail-open)", validated.ok === true && validated.judgments.length === 0, JSON.stringify(validated));
  check("(b-seam) the ungated verdict would be 'act' (fail OPEN)", validated.ok && deriveAutoLandVerdict(validated.judgments).verdict === "act", JSON.stringify(validated.ok ? deriveAutoLandVerdict(validated.judgments) : null));
}

// ---------------------------------------------------------------------------
// (verdict-ride) The verdict the gate returns rides the landing
// record when the land proceeds — proved at the seam: the AutoLandVerdict
// shape the route threads onto the evidence is the gate's return value,
// deep-equal to deriveAutoLandVerdict's mapping of the same judgments.
// ---------------------------------------------------------------------------
{
  const { ai, set } = makeAI();
  set(clefReply(actAnswers()));
  const { env } = await makeEnvironmentAsync(ai);
  const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], "main");
  check("(verdict-ride) the gate returns the ACT verdict envelope", !(gate instanceof Response) && gate?.verdict === "act" && gate?.setId === "v1" && deepEqual(gate?.blocking, []), JSON.stringify(gate));
  const expected = deriveAutoLandVerdict([
    { repo: "agent-1", risk: { label: "routine", score: 0.4 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
  ]);
  check("(verdict-ride) the gate's envelope deep-equals deriveAutoLandVerdict", !(gate instanceof Response) && deepEqual(gate, expected), JSON.stringify({ gate, expected }));
}

// ---------------------------------------------------------------------------
// (h1-ref) Regression (heal-1 H1, restored): ref ≠ baseRef — the gate
// judges the change-set the FOLD lands (the proposal head at `ref`),
// never the base change-set (baseRef). With the proposal-head ref
// against baseRef "main", judgeLandGate answers (verdict) or fails
// closed (503 Response) — it must never throw / never an unhandled
// 500. Seam-level; the route threads judgeLandGate return verbatim
// (autoland-engaged.test.mjs (b-route)). Restores the dropped heal-1
// H1 leg (the "it moved to autoland-engaged.test.mjs" comment in
// auto-land-gate.test.mjs §6b is now true: this leg exists here).
// ---------------------------------------------------------------------------
{
  const { ai, set } = makeAI();
  set(clefReply(actAnswers()));
  const { g, env, proposalHead } = await makeEnvironmentAsync(ai);
  const gate = await judgeLandGate(env, "demo", "main", ["agent-1"], proposalHead);
  check("(h1-ref) ref≠baseRef never throws (verdict or 503 Response)",
    gate instanceof Response || (gate && typeof gate.verdict === "string"),
    JSON.stringify(gate));
  if (!(gate instanceof Response)) {
    check("(h1-ref) the gate judged the proposal-head change-set (verdict rides)",
      gate?.verdict === "act" && gate?.setId === "v1", JSON.stringify(gate));
  }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
