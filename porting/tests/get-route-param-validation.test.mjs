#!/usr/bin/env bun
// Contract suite: AD-9 param-validation gate on GET read routes.
// Run: bun porting/tests/get-route-param-validation.test.mjs   (exit 0 = pass)
//
// Real construction: the real worker module is imported and exercised through
// worker.fetch against an in-memory ARTIFACTS fake (full git-repo surface)
// that tracks every get() call — the platform binding seam is the only fake;
// no module mocking, no source grep. env.LIVE is a map-backed KV stub so the
// /proposals KV cache path is exercised too.
//
// Guards: invalid base/ref/repos query params on GET /changes, /proposals, /merge
// MUST return 400 with { ok:false } and MUST NOT reach env.ARTIFACTS.get (no
// namespace read for attacker-probed names). Valid params MUST proceed and call
// ARTIFACTS.get with the expected names. The cache key must be composed only of
// validated charset segments (no raw injection into the KV key).

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// In-memory git repo fake (mirrors makeFakeArtifacts from one-set-one-response).
// Tracks all ARTIFACTS.get / list / KV calls so tests can assert the validation
// gate fires BEFORE any namespace read.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map();
  const blobHashByText = new Map();
  const treeEntries = new Map();
  const repos = new Map();
  const discovered = [];

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
        return { remote: `https://artifacts.invalid/nextgit/${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }

  return {
    discovered,
    ARTIFACTS: {
      async get(name) {
        return repoFor(name);
      },
      async list({ limit = 200 } = {}) {
        return { repos: discovered.slice(0, limit) };
      },
    },
    tree,
    commit,
    defineRepo,
  };
}

// Build a minimal demo + one agent repo so the happy-path routes return 200.
const BASE_FILES = { "src/a.ts": "export const a = 1;\n" };

function makeEnv() {
  const calls = [];
  const fake = makeFakeArtifacts();
  const c1 = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });

  const a1 = fake.commit("c-agent-1", fake.tree({ ...BASE_FILES, "src/a.ts": "export const a = 2;\n" }));
  fake.defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash }, intents: { [a1.hash]: "fixture intent" } });
  fake.discovered.push({ name: "agent-1", status: "ready" });

  const kv = {
    _store: new Map(),
    async get(key) {
      calls.push({ method: "kv.get", key });
      if (key === "cache:gen") return this._store.get(key) ?? "0";
      return this._store.get(key) ?? null;
    },
    async put(key, value, _opts) {
      calls.push({ method: "kv.put", key, value });
      this._store.set(key, value);
      return;
    },
  };
  const env = {
    ARTIFACTS: {
      async get(name) {
        calls.push({ method: "get", name });
        return fake.ARTIFACTS.get(name);
      },
      async list(opts) {
        calls.push({ method: "list", opts });
        return fake.ARTIFACTS.list(opts);
      },
    },
    LIVE: kv,
    CACHE: kv,
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    // auth.ts chokepoint is default-deny; demo opt-in (see judge.test.mjs).
    AUTH_MODE: "demo",
  };
  return { env, calls };
}

async function fetchRoute(path, env) {
  const res = await worker.fetch(new Request(`https://test.invalid${path}`), env);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// 1. GET /changes rejects invalid repo (charset + path traversal) before any
//    ARTIFACTS.get call.
// ---------------------------------------------------------------------------
const BAD_REPOS = [
  ["demo;drop", "semicolon injection"],
  ["../etc", "path traversal"],
  ["demo/../secret", "nested traversal"],
  ["demo space", "space in name"],
  ["repo|rm", "pipe injection"],
];

for (const [badRepo, label] of BAD_REPOS) {
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/changes?repo=${encodeURIComponent(badRepo)}`, env);
  check(
    `/changes bad repo (${label}) returns 400`,
    res.status === 400 && res.body?.ok === false,
    `got ${res.status} ${JSON.stringify(res.body)}`,
  );
  const getCalls = calls.filter((c) => c.method === "get");
  check(
    `/changes bad repo (${label}) does not call ARTIFACTS.get`,
    getCalls.length === 0,
    `get calls: ${JSON.stringify(getCalls)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. GET /changes rejects invalid ref before any ARTIFACTS.get call.
// ---------------------------------------------------------------------------
const BAD_REFS = [
  ["main..exploit", "dot-dot segment"],
  ["/main", "leading slash"],
  ["main/", "trailing slash"],
  ["refs/heads/../../x", "refspec escape"],
];

for (const [badRef, label] of BAD_REFS) {
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/changes?repo=agent-1&ref=${encodeURIComponent(badRef)}`, env);
  check(
    `/changes bad ref (${label}) returns 400`,
    res.status === 400 && res.body?.ok === false,
    `got ${res.status} ${JSON.stringify(res.body)}`,
  );
  const getCalls = calls.filter((c) => c.method === "get");
  check(
    `/changes bad ref (${label}) does not call ARTIFACTS.get`,
    getCalls.length === 0,
    `get calls: ${JSON.stringify(getCalls)}`,
  );
}

// ---------------------------------------------------------------------------
// 3. GET /changes rejects invalid base before any ARTIFACTS.get call.
// ---------------------------------------------------------------------------
{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/changes?repo=agent-1&base=demo;evil`, env);
  check(`/changes bad base returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/changes bad base does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
}

// ---------------------------------------------------------------------------
// 4. GET /proposals rejects invalid base/ref before any ARTIFACTS.get or KV
//    cache access (cache key pollution prevention).
// ---------------------------------------------------------------------------
{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/proposals?base=demo;evil&ref=main`, env);
  check(`/proposals bad base returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/proposals bad base does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
}

{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/proposals?base=demo&ref=main..x`, env);
  check(`/proposals bad ref returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/proposals bad ref does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
  const kvCalls = calls.filter((c) => c.method.startsWith("kv."));
  check(`/proposals bad ref does not touch KV cache`, kvCalls.length === 0, `kv calls: ${JSON.stringify(kvCalls)}`);
}

{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/proposals?base=demo&repos=agent-1,evil%00name`, env);
  check(`/proposals bad repo in list returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/proposals bad repo in list does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
}

// ---------------------------------------------------------------------------
// 5. GET /merge rejects invalid base/repo/ref/repos before computeMerge.
// ---------------------------------------------------------------------------
{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/merge?base=demo&repos=agent-1&ref=main..x`, env);
  check(`/merge bad ref returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/merge bad ref does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
}

{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/merge?base=demo&repos=agent-1,demo%00evil&ref=main`, env);
  check(`/merge bad repo returns 400`, res.status === 400 && res.body?.ok === false, `got ${res.status} ${JSON.stringify(res.body)}`);
  const getCalls = calls.filter((c) => c.method === "get");
  check(`/merge bad repo does not call ARTIFACTS.get`, getCalls.length === 0, `get calls: ${JSON.stringify(getCalls)}`);
}

// ---------------------------------------------------------------------------
// 6. Happy path: valid params reach ARTIFACTS.get and return 200.
// ---------------------------------------------------------------------------
{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/changes?repo=agent-1&base=demo&ref=main&baseRef=main`, env);
  check(`/changes valid params returns 200`, res.status === 200, `got ${res.status}`);
  const baseGet = calls.find((c) => c.method === "get" && c.name === "demo");
  const repoGet = calls.find((c) => c.method === "get" && c.name === "agent-1");
  check(`/changes valid params calls ARTIFACTS.get("demo")`, baseGet !== undefined, "");
  check(`/changes valid params calls ARTIFACTS.get("agent-1")`, repoGet !== undefined, "");
}

{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/proposals?base=demo&repos=agent-1&ref=main&baseRef=main`, env);
  check(`/proposals valid params returns 200`, res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`);
  const baseGet = calls.find((c) => c.method === "get" && c.name === "demo");
  check(`/proposals valid params calls ARTIFACTS.get("demo")`, baseGet !== undefined, "");
}

{
  const { env, calls } = makeEnv();
  const res = await fetchRoute(`/merge?base=demo&repos=agent-1&ref=main&baseRef=main`, env);
  check(`/merge valid params returns 200`, res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`);
  const baseGet = calls.find((c) => c.method === "get" && c.name === "demo");
  const repoGet = calls.find((c) => c.method === "get" && c.name === "agent-1");
  check(`/merge valid params calls ARTIFACTS.get("demo")`, baseGet !== undefined, "");
  check(`/merge valid params calls ARTIFACTS.get("agent-1")`, repoGet !== undefined, "");
}

// ---------------------------------------------------------------------------
// 7. Cache key is composed only of validated charset segments — no raw
//    user input interpolation. After a valid request, the KV put key is
//    structurally clean (no special chars from attacker payloads).
// ---------------------------------------------------------------------------
{
  const { env, calls } = makeEnv();
  await fetchRoute(`/proposals?base=demo&repos=agent-1&ref=main&baseRef=main`, env);
  const kvPuts = calls.filter((c) => c.method === "kv.put");
  check(`/proposals writes a cache key`, kvPuts.length > 0, `kv puts: ${JSON.stringify(kvPuts)}`);
  for (const p of kvPuts) {
    const segments = p.key.split(":");
    for (const seg of segments) {
      check(`/proposals cache key segment "${seg}" is charset-safe`, /^[A-Za-z0-9._*-]+$|^[*]$/.test(seg), `segment has unsafe chars`);
    }
  }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
