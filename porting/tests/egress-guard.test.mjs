#!/usr/bin/env bun
// Contract suite for the Credential/Egress Guard (AD-9 E8).
// Run: bun porting/tests/egress-guard.test.mjs  (exit 0 = pass)
//
// Verifies that the 500 push-failed path structurally strips `merged`
// (file-content payload) from its projected `files` array, so a
// non-secret file carrying credential-shaped material can never echo
// in a failure response body.
//
// No module mocking — the real worker module is imported and exercised
// through worker.fetch with an in-memory Artifacts fake whose base repo
// `info()` returns a fake remote and `createToken()` succeeds, making
// pushLand's git.clone fail against the unreachable URL. That failure
// propagates to handleLand's catch block, which must return the 500
// push-failed shape WITHOUT `merged` on any files entry.

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };

// ---------------------------------------------------------------------------
// In-memory Artifacts fake — minimal: enough to drive handleLand to pushLand.
// The base repo's `info()` returns a fake remote; createToken returns a
// plaintext token. pushLand's git.clone against the fake remote throws,
// reaching the 500 push-failed path.
// ---------------------------------------------------------------------------

const blobText = new Map();
const blobHashByText = new Map();
const treeEntries = new Map();
const repos = new Map();

function internBlob(text) {
  if (blobHashByText.has(text)) return blobHashByText.get(text);
  const hash = `blob${blobText.size + 1}`;
  blobText.set(hash, text);
  blobHashByText.set(text, hash);
  return hash;
}

function entryFor(path, text) {
  return { name: path.split("/").pop() || path, path, sha: internBlob(text), type: "blob" };
}

function tree(files) {
  const fileEntries = Object.entries(files).map(([p, t]) => entryFor(p, t));
  const entries = [...fileEntries, ...fileEntries.map((e) => ({ name: e.name, path: e.path, sha: e.sha, type: "blob" }))];
  const h = internBlob(JSON.stringify(entries.map((e) => ({ name: e.name, path: e.path, sha: e.sha, type: "blob" }))));
  treeEntries.set(h, entries);
  return h;
}

function commit(msg, treeHash) {
  const hash = `c${repos.size + 1}`;
  return { hash, treeHash, message: msg, author: { name: "test", email: "test@test" }, authoredAt: 0 };
}

function defineRepo(name, { history, refs }) {
  repos.set(name, { history, refs });
}

function repoFor(name) {
  const store = repos.get(name);
  if (!store) throw new Error(`fixture: no repo ${name}`);
  const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
  return {
    async log({ ref: r = "HEAD", limit = 50 } = {}) {
      const byBranch = store.refs[r];
      if (byBranch) return store.history.slice(0, limit);
      const single = resolve(r);
      return single ? [single].slice(0, limit) : [];
    },
    async readTree(hash) {
      return treeEntries.get(hash) ?? null;
    },
    async readFile({ ref, path }) {
      const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
      if (!head) return null;
      // find entry in tree
      const entries = treeEntries.get(head.treeHash) ?? [];
      const entry = entries.find((e) => e.path === path);
      return entry ? new Blob([blobText.get(entry.sha)]) : null;
    },
    async readBlob(hash) {
      return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
    },
    async info() {
      return { remote: `https://artifacts.invalid/nextgit/${name}` };
    },
    async createToken(_scope, _ttl) {
      return { plaintext: "fake-write-token-should-never-leak" };
    },
    async revokeToken() {
      return true;
    },
    [Symbol.dispose]() { },
  };
}

const ARTIFACTS = {
  async get(name) {
    return repoFor(name);
  },
  async list() {
    return { repos: [] };
  },
};

const makeFakeKV = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); return true; } };
};

function envFor() {
  return { ARTIFACTS, LIVE: makeFakeKV(), CACHE: makeFakeKV(), ASSETS: { fetch: async () => new Response("") }, AI: { async run() { return { model: "clef", answers: [], usage: { neurons: 1 } }; } } };
}

// ---------------------------------------------------------------------------
// Fixture: demo with a single file containing a canary. A proposal adds
// a non-secret file also carrying a canary. The fold succeeds (clean), but the
// push fails (fake remote) — hitting the 500 push-failed path.
// ---------------------------------------------------------------------------

const CANARY = "egress_canary_8f2a1d7c_leakgate";
const DEMO_FILES = { "src/a.ts": `export const a = 1;\nexport const TOKEN = "${CANARY}";\n` };

const cBase = commit("base", tree(DEMO_FILES));
defineRepo("demo", { history: [cBase], refs: { main: cBase.hash } });

// Proposal: adds src/b.ts with canary text, modifies demo file with canary.
const propFiles = { ...DEMO_FILES, "src/b.ts": `export const b = "${CANARY}";\n` };
const cProp = commit("prop", tree(propFiles));
defineRepo("agent-canary", { history: [cProp, cBase], refs: { main: cProp.hash } });

// ---------------------------------------------------------------------------
// Test: POST /land with a clean fold that fails to push -> 500 push-failed
// must NOT carry `merged` on any files entry, and CANARY must not appear.
// ---------------------------------------------------------------------------

try {
  const env = envFor();
  const req = new Request("https://nextgit-platform.john-b7d.workers.dev/land", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base: "demo", repos: ["agent-canary"], baseRef: "main", ref: "main" }),
  });
  const res = await worker.fetch(req, env, { waitUntil() { }, next: () => ({}) });
  const body = await res.json();
  const text = JSON.stringify(body);

  check("(1) 500 status", res.status === 500, `got ${res.status}`);
  check("(1) error push-failed", body?.error === "push-failed", JSON.stringify(body));
  check("(1) files is an array", Array.isArray(body?.files), JSON.stringify(body?.files));
  check("(1) no `merged` key in any files entry", !body?.files?.some((f) => "merged" in f), JSON.stringify(body?.files));
  // Each files entry must have exactly {path, action, result} — no merged.
  for (const f of body?.files ?? []) {
    check(`(1) files entry ${f.path} keys = {path,action,result}`, exactKeys(f, ["path", "action", "result"]), JSON.stringify(Object.keys(f)));
  }
  check("(1) no canary in response body", !text.includes(CANARY), text.slice(0, 200));
  check("(1) no fake token in response body", !text.includes("fake-write-token-should-never-leak"), text.slice(0, 200));
  check("(1) no Bearer in response body", !text.includes("Bearer "), text.slice(0, 200));
} catch (e) {
  check("(1) suite threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
