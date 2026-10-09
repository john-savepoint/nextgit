#!/usr/bin/env bun
// Contract suite: FR-11 — Intent readers resolve from the nextgit-notes mirror,
// with fallback carrier (story e6-verify-notes-mirror-readers).
// Run: bun porting/tests/notes-mirror.test.mjs   (exit 0 = pass)
//
// Real construction: GET /changes and GET /proposals are exercised through the
// REAL worker module (worker.fetch) against an in-memory Artifacts fake — the
// platform binding seam is the only fake (pattern per fork-point-pinning.test.mjs
// and one-set-one-response.test.mjs); no module mocks, no source grep.
//
// The contract this suite pins (platform/src/index.ts readIntent / readNotes /
// readIntentFile / computeChangeSet / computeProposals; CONTRACT.md intent
// carry):
//   * readNotes walks `repo.log({ ref: "nextgit-notes", limit: 20 })` — a
//     SEPARATE tree from `main` — and maps blob path → blob hash;
//   * readIntent resolves by direct sha key (`notes.get(headSha)`) then by path
//     SUFFIX (`p.endsWith("/" + headSha)`) for fan-out trees;
//   * if a note blob is found, its text is capIntent'd (≤500 chars + …) and
//     served as `intent` on the file row and on the proposal card;
//   * if no note, readIntentFile reads NEXTGIT_INTENT/<sha>.txt (sha-specific
//     carrier) then NEXTGIT_INTENT/intent.txt (generic carrier);
//   * note beats fallback when both exist (notes checked first);
//   * when neither exists, the `intent` key is ABSENT from the row (not undefined);
//   * intent is scrubFreeText'd (no-op here) and only attached to non-secret paths.

import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---- sha helpers (40-hex, matching the existing fake convention) ---------------
const sha = (n) => String(n).padStart(2, "0").repeat(20);
const C_BASE = sha(0x11);   // sha("1111"...)
const C_FORK = sha(0x22);   // sha("2222"...)
const C_A1 = sha(0x55);
const C_A1B = sha(0x56);
const C_A2 = sha(0x57);
const C_A2B = sha(0x58);
const C_A3 = sha(0x59);
const C_A4 = sha(0x5a);
const C_A5 = sha(0x5b);

// ---- content fixtures --------------------------------------------------------
const AUTH_V0 = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_V1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";

const NOTE_INTENT = "Refactor auth session to use TTL-based refresh";
const FALLBACK_INTENT = "Fallback carrier intent text";
const LONG_INTENT = "x".repeat(600); // exceeds the 500-char cap; capIntent slices to 500 + …

// ---- Fake Artifacts (extends fork-point-pinning.test.mjs makeFakeArtifacts) ----
// The existing fake uses a single `history` array per repo. readNotes calls
// repo.log({ ref: "nextgit-notes" }), which needs a DIFFERENT commit tree than
// repo.log({ ref: "main" }). The fake supports per-ref histories:
//   - `histories`: Map<ref, Commit[]> — per-ref commit arrays.
//     log checks `store.histories[ref] ?? store.history`.
//   - `refs`: Map<ref, commitHash> — branch-name → commit-hash mapping.
//   - `intents`: Map<sha | "intent", text> — fallback carrier for NEXTGIT_INTENT/.

const NOTE_SHA = sha(0x99);      // the notes-branch commit sha

function makeFakeArtifacts() {
  const blobText = new Map();      // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
  const treeEntries = new Map();   // tree hash -> entries
  const repos = new Map();         // name -> { history, histories, refs, intents }

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
      for (const part of parts.slice(0, -1)) { node[part] = node[part] || {}; node = node[part]; }
      node[parts[parts.length - 1]] = internBlob(text);
    }
    return treeHashFor(root);
  }
  function commit(hash, treeHash) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
  }
  function defineRepo(name, { history, histories = {}, refs = {}, intents = {} }) {
    repos.set(name, { history, histories, refs, intents });
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
    const resolve = (ref) => {
      for (const hist of [store.histories[ref], store.history]) {
        const found = (hist ?? []).find((c) => c.hash === ref);
        if (found) return found;
      }
      return null;
    };
    return {
      async log(opts = {}) {
        const { ref = "HEAD", limit = 50 } = opts;
        // Per-ref history takes priority; fall back to the default history.
        const hist = store.histories[ref] ?? store.history;
        if (store.refs[ref]) return hist.slice(0, limit);
        // Resolve as a commit hash across all histories.
        const single = resolve(ref);
        return single ? [single].slice(0, limit) : [];
      },
      async readTree(hash) { return treeEntries.get(hash) ?? null; },
      async readFile({ ref, path }) {
        const hist = store.histories[ref] ?? store.history;
        const head = store.refs[ref] ? hist.find((c) => c.hash === store.refs[ref]) : resolve(ref);
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
      async info() { return { remote: `https://artifacts.invalid/nextgit/${name}` }; },
      async revokeToken() { return true; },
      [Symbol.dispose]() { },
    };
  }
  return {
    ARTIFACTS: {
      async get(name) { return repoFor(name); },
      async list() { return { repos: [] }; },
    },
    tree, commit, defineRepo,
    blobHashOf: (text) => blobHashByText.get(text) ?? null,
  };
}

// ---- Fake KVNamespace for CACHE (best-effort, /proposals catches errors) -------
function makeKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    async put(key, value) { store.set(key, value); },
  };
}

// ---- Test fixture repos ------------------------------------------------------
// Each agent repo is a fork of `demo` (base): history = [head, C_FORK, C_BASE],
// refs.main -> head. Code tree for each head: { "src/auth.ts": AUTH_V1 } (a
// single modified file vs base). C_BASE and C_FORK are shared with `demo`.

function makeEnvironment() {
  const fake = makeFakeArtifacts();

  // Base repo: demo has C_FORK (which introduced MID) then C_BASE.
  const tBase = fake.tree({ "src/auth.ts": AUTH_V0 });
  const tFork = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": "export const mid = 1;\n" });
  const cBase = fake.commit(C_BASE, tBase);
  const cFork = fake.commit(C_FORK, tFork);
  fake.defineRepo("demo", {
    history: [cFork, cBase],
    refs: { main: C_FORK },
  });

  // Helper: build an agent repo forking demo.
  function agentRepo(headSha, { notesTree, intents } = {}) {
    const history = [
      fake.commit(headSha, fake.tree({ "src/auth.ts": AUTH_V1 })),
      cFork, cBase,
    ];
    const repo = {
      history,
      refs: { main: headSha },
      intents: intents ?? {},
    };
    if (notesTree) {
      repo.histories = { "nextgit-notes": [fake.commit(NOTE_SHA, notesTree)] };
      repo.refs["nextgit-notes"] = NOTE_SHA;
    }
    return repo;
  }

  // (a): note blob on nextgit-notes → direct sha path
  const tNoteA = fake.tree({ [C_A1]: NOTE_INTENT });
  fake.defineRepo("agent-1", agentRepo(C_A1, { notesTree: tNoteA }));

  // (b): note blob on nextgit-notes → fan-out path "ab/<sha>"
  const tNoteB = fake.tree({ [`ab/${C_A1B}`]: NOTE_INTENT });
  fake.defineRepo("agent-1b", agentRepo(C_A1B, { notesTree: tNoteB }));

  // (c): no note, fallback carrier (sha-specific)
  fake.defineRepo("agent-2", agentRepo(C_A2, { intents: { [C_A2]: FALLBACK_INTENT } }));

  // (c-cont): no note, fallback carrier (generic intent.txt)
  fake.defineRepo("agent-2b", agentRepo(C_A2B, { intents: { intent: FALLBACK_INTENT } }));

  // (d): note AND fallback — note wins
  const tNoteD = fake.tree({ [C_A3]: NOTE_INTENT });
  fake.defineRepo("agent-3", agentRepo(C_A3, {
    notesTree: tNoteD,
    intents: { [C_A3]: FALLBACK_INTENT },
  }));

  // (e): note with 600-char intent → capIntent truncates to 500 + …
  const tNoteE = fake.tree({ [C_A4]: LONG_INTENT });
  fake.defineRepo("agent-4", agentRepo(C_A4, { notesTree: tNoteE }));

  // (f): no note, no fallback → intent key absent
  fake.defineRepo("agent-5", agentRepo(C_A5));

  const env = {
    ARTIFACTS: fake.ARTIFACTS,
    CACHE: makeKV(),
    LIVE: makeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
  };
  return { fake, env };
}

// ---- HTTP helper for /changes -------------------------------------------------
const changesGet = async (env, repo) => {
  const url = `https://nextgit.invalid/changes?repo=${repo}&base=demo&ref=main&baseRef=main`;
  const res = await worker.fetch(new Request(url), env);
  return { status: res.status, body: await res.json() };
};

// ---- HTTP helper for /proposals ------------------------------------------------
const proposalsGet = async (env, repos) => {
  const usp = new URLSearchParams();
  usp.set("base", "demo");
  usp.set("ref", "main");
  usp.set("baseRef", "main");
  for (const r of repos) usp.append("repos", r);
  const url = `https://nextgit.invalid/proposals?${usp.toString()}`;
  const res = await worker.fetch(new Request(url), env);
  return { status: res.status, body: await res.json() };
};

const { env } = makeEnvironment();

// ---------------------------------------------------------------------------
// Test cases (a)–(f)
// ---------------------------------------------------------------------------

// (a) Note blob on nextgit-notes resolves for /changes file rows and /proposals card
{
  const cs = await changesGet(env, "agent-1");
  check("a-1 /changes status 200", cs.status === 200, `status=${cs.status}`);
  const row = cs.body?.changeSet?.files?.[0];
  check("a-2 /changes file row has intent", row?.intent === NOTE_INTENT, `got=${JSON.stringify(row?.intent)}`);
  const pj = await proposalsGet(env, ["agent-1"]);
  check("a-3 /proposals status 200", pj.status === 200, `status=${pj.status}`);
  check("a-4 /proposals card intent", pj.body?.proposals?.[0]?.intent === NOTE_INTENT, `got=${JSON.stringify(pj.body?.proposals?.[0]?.intent)}`);
}

// (b) Fan-out note tree resolves by path suffix
{
  const cs = await changesGet(env, "agent-1b");
  const row = cs.body?.changeSet?.files?.[0];
  check("b-1 /changes fan-out intent resolves by suffix", row?.intent === NOTE_INTENT, `got=${JSON.stringify(row?.intent)}`);
}

// (c) Fallback carrier serves when no note
{
  const cs = await changesGet(env, "agent-2");
  const row = cs.body?.changeSet?.files?.[0];
  check("c-1 /changes sha-specific fallback carrier", row?.intent === FALLBACK_INTENT, `got=${JSON.stringify(row?.intent)}`);

  const cs2b = await changesGet(env, "agent-2b");
  const row2b = cs2b.body?.changeSet?.files?.[0];
  check("c-2 /changes generic fallback carrier (intent.txt)", row2b?.intent === FALLBACK_INTENT, `got=${JSON.stringify(row2b?.intent)}`);
}

// (d) Note wins over fallback when both exist
{
  const cs = await changesGet(env, "agent-3");
  const row = cs.body?.changeSet?.files?.[0];
  check("d-1 /changes note beats fallback", row?.intent === NOTE_INTENT, `got=${JSON.stringify(row?.intent)}`);

  const pj = await proposalsGet(env, ["agent-3"]);
  check("d-2 /proposals note beats fallback", pj.body?.proposals?.[0]?.intent === NOTE_INTENT, `got=${JSON.stringify(pj.body?.proposals?.[0]?.intent)}`);
}

// (e) Intent capped at 500 chars
{
  const cs = await changesGet(env, "agent-4");
  const row = cs.body?.changeSet?.files?.[0];
  const expected = LONG_INTENT.slice(0, 500) + "…";
  check("e-1 /changes intent capped to 500 + ellipsis", row?.intent === expected, `len=${row?.intent?.length}`);
  check("e-2 /changes intent length === 501", row?.intent?.length === 501, `len=${row?.intent?.length}`);
}

// (f) Repo with neither note nor fallback serves no intent
{
  const cs = await changesGet(env, "agent-5");
  const row = cs.body?.changeSet?.files?.[0];
  check("f-1 /changes intent key absent (not undefined)", !("intent" in row), `keys=${JSON.stringify(Object.keys(row ?? {}))}`);
  check("f-2 /changes intent is undefined (property absent)", row?.intent === undefined, `got=${JSON.stringify(row?.intent)}`);

  const pj = await proposalsGet(env, ["agent-5"]);
  check("f-3 /proposals card intent absent", !("intent" in (pj.body?.proposals?.[0] ?? {})), `keys=${JSON.stringify(Object.keys(pj.body?.proposals?.[0] ?? {}))}`);
  check("f-4 /proposals card intent === undefined", pj.body?.proposals?.[0]?.intent === undefined, `got=${JSON.stringify(pj.body?.proposals?.[0]?.intent)}`);
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
