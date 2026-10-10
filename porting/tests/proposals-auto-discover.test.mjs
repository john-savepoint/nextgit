#!/usr/bin/env bun
// Contract test for FR-34 consequence 2 + adversarial F10:
// agent-* workspace auto-discovery before token handoff.
// Run: bun porting/tests/proposals-auto-discover.test.mjs   (exit 0 = pass)
//
// Real construction: imports the REAL worker module (worker.fetch) and drives
// GET /proposals through it against an in-memory Artifacts fake. The fake's
// list() returns mixed-status repos that exercise the negative-filtering
// contract: non-ready agent-* repos and ready non-agent-* repos must be
// excluded. No module mocks, no source grep — the route reads list() and
// filters in computeProposals (index.ts:613-616).
//
// Legs:
//   1. /proposals (no repos param) → 200 ok:true
//   2. proposals[].repo set equals {agent-1, agent-2} (sorted set equality)
//   3. agent-3 (forking) absent
//   4. agent-4 (importing) absent
//   5. shared-config (ready, non-agent) absent
//   6. demo (base, ready, non-agent) absent
//   7. returned repos sorted by name (agent-1 before agent-2)

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import worker from "../../platform/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let fails = 0;

const check = (name, ok, detail = "") => {
  if (!ok) {
    fails++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
};

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (mirrors one-set-one-response.test.mjs factory).
// The route reads get() + list(); list() returns the `discovered` array with
// mixed statuses to exercise negative filtering.
// ---------------------------------------------------------------------------

function makeFakeArtifacts(discovered) {
  const repos = new Map();

  function internBlob(text) {
    const hash = `blob-${text}`;
    return hash;
  }

  function treeHashFor(entries) {
    return `tree-${entries.length}`;
  }

  function commit(hash, treeHash) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
  }

  function defineRepo(name, { history, refs }) {
    repos.set(name, { history, refs });
  }

  return {
    ARTIFACTS: {
      async get(name) {
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
            return null; // not exercised by auto-discover route
          },
          async readFile({ ref, path }) {
            return null; // not exercised by auto-discover route
          },
          async readBlob(hash) {
            return null; // not exercised
          },
          async info() {
            return { remote: `https://artifacts.invalid/nextgit/${name}` };
          },
          async revokeToken() {
            return true;
          },
          [Symbol.dispose]() { },
        };
      },
      async list({ limit = 200 } = {}) {
        return { repos: discovered.slice(0, limit) };
      },
    },
    commit,
    defineRepo,
  };
}

// ---------------------------------------------------------------------------
// Fixture: mixed-status repo set exercising negative filtering.
//   demo        — base repo, ready, excluded (non-agent prefix)
//   agent-1     — ready, included
//   agent-2     — ready, included
//   agent-3     — forking, excluded (not ready)
//   agent-4     — importing, excluded (not ready)
//   shared-config — ready, excluded (non-agent prefix)
// ---------------------------------------------------------------------------

function makeEnvironment() {
  const discovered = [
    { name: "demo", status: "ready" },
    { name: "agent-1", status: "ready" },
    { name: "agent-2", status: "ready" },
    { name: "agent-3", status: "forking" },
    { name: "agent-4", status: "importing" },
    { name: "shared-config", status: "ready" },
  ];

  const fake = makeFakeArtifacts(discovered);

  // Define the base + agent repos with minimal history so computeChangeSet
  // (called inside computeProposals for each included repo) can resolve refs.
  const baseFiles = { "src/auth.ts": "export const auth = 1;\n" };
  const baseTree = fake.commit("c-base", "tree-base");
  fake.defineRepo("demo", { history: [baseTree], refs: { main: baseTree.hash } });

  for (const name of ["agent-1", "agent-2", "agent-3", "agent-4"]) {
    const head = fake.commit(`c-${name}`, "tree-head");
    fake.defineRepo(name, { history: [head, baseTree], refs: { main: head.hash } });
  }
  fake.defineRepo("shared-config", { history: [baseTree], refs: { main: baseTree.hash } });

  const kv = {
    async get(key, type) {
      return null; // cache miss → compute path
    },
    async put(key, value) {
      // best-effort; ignore
    },
  };
  const env = {
    ARTIFACTS: fake.ARTIFACTS,
    LIVE: kv,
    CACHE: kv,
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    // auth.ts chokepoint is default-deny; demo opt-in (see judge.test.mjs).
    AUTH_MODE: "demo",
  };
  return { env, discovered };
}

// ---------------------------------------------------------------------------
// Exercise the route with NO repos param — triggers auto-discovery.
// ---------------------------------------------------------------------------

let result;
try {
  const { env } = makeEnvironment();
  // GET /proposals?base=demo (no repos param) — auto-discover path
  const res = await worker.fetch(new Request("https://nextgit.invalid/proposals?base=demo"), env);
  const body = await res.json().catch(() => null);
  result = { status: res.status, body };
} catch (e) {
  check("route threw", false, String(e?.stack ?? e));
  result = { status: -1, body: null };
}

const expectedRepos = ["agent-1", "agent-2"];

// 1. /proposals answers 200 with ok:true
check("1 /proposals answers 200 with ok:true", result.status === 200 && result.body?.ok === true, `status=${result.status} error=${result.body?.error ?? ""}`);

const returnedRepos = Array.isArray(result.body?.proposals) ? result.body.proposals.map((p) => p.repo) : [];

// 2. proposals[].repo set equals {agent-1, agent-2} (sorted set equality)
check(
  "2 proposals[].repo set equals {agent-1, agent-2} (non-agent demo + non-ready agents excluded)",
  Array.isArray(returnedRepos) && JSON.stringify([...returnedRepos].sort()) === JSON.stringify([...expectedRepos].sort()),
  JSON.stringify(returnedRepos),
);

// 3. agent-3 (forking) absent
check("3 agent-3 (forking) absent from response", !returnedRepos.includes("agent-3"), JSON.stringify(returnedRepos));

// 4. agent-4 (importing) absent
check("4 agent-4 (importing) absent from response", !returnedRepos.includes("agent-4"), JSON.stringify(returnedRepos));

// 5. shared-config (ready, non-agent) absent
check("5 shared-config (ready, non-agent) absent from response", !returnedRepos.includes("shared-config"), JSON.stringify(returnedRepos));

// 6. demo (base, ready, non-agent) absent
check("6 demo (base, ready, non-agent) absent from response", !returnedRepos.includes("demo"), JSON.stringify(returnedRepos));

// 7. returned repos sorted by name (agent-1 before agent-2)
check(
  "7 returned repos sorted by name (agent-1 before agent-2)",
  returnedRepos.length === 2 && returnedRepos[0] === "agent-1" && returnedRepos[1] === "agent-2",
  JSON.stringify(returnedRepos),
);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
