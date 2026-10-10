#!/usr/bin/env bun
// Contract suite: e11 — the {added, modified, removed} file-status enum
// is pinned on both wire surfaces that carry it.
// Run: bun porting/tests/change-status-enum.test.mjs   (exit 0 = pass)
//
// CONTRACT (platform/CONTRACT.md:22, :42): every `files[]` row from
// GET /changes?repo=<p>&base=demo and every proposals[].files[] row
// from GET /proposals?base=demo&repos=<p> carries
// status ∈ {added, modified, removed}.
//
// Real construction: both routes are exercised through the REAL worker
// module (worker.fetch) against an in-memory Artifacts fake — the
// platform binding seam is the only fake (pattern per masking-posture /
// fork-point-pinning / merge-fold-api); no module mocks, no source-grep
// for behavioral assertions. The fixture deliberately adds a NEW file,
// MODIFIES an existing file, and REMOVES an existing file so all three
// enum values are constructed and the assertion is non-vacuous (a drift
// that emits any other value — e.g. "changed" — fails a named check).
//
// Seams pinned: platform/src/index.ts:68 (FileStatus union),
// :479-483 (computeChangeSet emission), :643/:680 (proposals
// files[].status), :1496-1500 (/changes route guard).

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const J = (x) => JSON.stringify(x);
const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (exact copy of the makeFakeArtifacts pattern
// from masking-posture.test.mjs / merge-fold-api.test.mjs). A factory, so
// environments cannot alias.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
  const treeEntries = new Map(); // tree hash -> entries
  const repos = new Map(); // name -> { history: [] newest-first, refs, intents }
  const discovered = []; // [{ name, status }] — the list() surface

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

// ---------------------------------------------------------------------------
// Fixture — base `demo` and one proposal `agent-x` whose change-set,
// relative to the fork point, ADDS src/new.ts, MODIFIES src/auth.ts and
// REMOVES src/gone.ts. All three enum values are therefore constructed.
// ---------------------------------------------------------------------------
const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_X = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const GONE_BASE = "export const gone = 1;\n";
const NEW_X = "export const fresh = 1;\n";

const BASE_FILES = { "src/auth.ts": AUTH_BASE, "src/gone.ts": GONE_BASE };

function makeEnvironment() {
  const fake = makeFakeArtifacts();
  const base = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [base], refs: { main: base.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });

  const xFiles = { "src/auth.ts": AUTH_X, "src/new.ts": NEW_X };
  const x = fake.commit("c-agent-x", fake.tree(xFiles));
  fake.defineRepo("agent-x", { history: [x, base], refs: { main: x.hash } });
  fake.discovered.push({ name: "agent-x", status: "ready" });

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { env };
}

const get = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/changes${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const getProposals = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/proposals${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const { env } = makeEnvironment();

// --- /changes: every file row status in-enum, all three constructed --------
{
  const r = await get(env, "?repo=agent-x&base=demo&ref=main&baseRef=main");
  const cs = r.body?.changeSet;
  const rows = cs?.files ?? [];
  check("1 /changes: 200 ok:true", r.status === 200 && r.body?.ok === true, J({ status: r.status, body: r.body }));
  check("1 /changes: changeSet.files is a non-empty array", rows.length > 0, J(rows));
  check(
    "1 /changes: every file row status ∈ {added, modified, removed}",
    rows.length > 0 && rows.every((f) => ["added", "modified", "removed"].includes(f.status)),
    J(rows.map((f) => [f.path, f.status])),
  );
  const present = new Set(rows.map((f) => f.status));
  check(
    "1 /changes: all three statuses constructed (none missing, none extra)",
    present.has("added") && present.has("modified") && present.has("removed") && present.size === 3,
    J([...present]),
  );
  // Discriminating (not vacuous): each constructed row maps to its intended status.
  const byPath = new Map(rows.map((f) => [f.path, f.status]));
  check("1 /changes: src/new.ts → added", byPath.get("src/new.ts") === "added", J(byPath.get("src/new.ts")));
  check("1 /changes: src/auth.ts → modified", byPath.get("src/auth.ts") === "modified", J(byPath.get("src/auth.ts")));
  check("1 /changes: src/gone.ts → removed", byPath.get("src/gone.ts") === "removed", J(byPath.get("src/gone.ts")));
  check(
    "1 /changes: stats keys exactly {files,added,modified,removed,additions,deletions}",
    exactKeys(cs?.stats, ["files", "added", "modified", "removed", "additions", "deletions"]),
    J(cs?.stats && Object.keys(cs.stats)),
  );
  check(
    "1 /changes: stats invariant (added+modified+removed === files)",
    cs?.stats?.added + cs?.stats?.modified + cs?.stats?.removed === cs?.stats?.files,
    J(cs?.stats),
  );
}

// --- /proposals: every proposals[].files[] row status in-enum ---------------
{
  const r = await getProposals(env, "?base=demo&repos=agent-x&ref=main&baseRef=main");
  const proposals = r.body?.proposals ?? [];
  const rows = proposals.flatMap((p) => p.files ?? []);
  check("2 /proposals: 200 ok:true", r.status === 200 && r.body?.ok === true, J({ status: r.status, body: r.body }));
  check("2 /proposals: the agent-x row is present", proposals.some((p) => p.repo === "agent-x"), J(proposals.map((p) => p.repo)));
  check("2 /proposals: the agent-x row carries files", rows.length > 0, J(rows));
  check(
    "2 /proposals: every proposals[].files[] status ∈ {added, modified, removed}",
    rows.length > 0 && rows.every((f) => ["added", "modified", "removed"].includes(f.status)),
    J(rows.map((f) => [f.path, f.status])),
  );
  const present = new Set(rows.map((f) => f.status));
  check(
    "2 /proposals: union of statuses is exactly {added, modified, removed}",
    present.has("added") && present.has("modified") && present.has("removed") && present.size === 3,
    J([...present]),
  );
  const xRow = proposals.find((p) => p.repo === "agent-x");
  const xByPath = new Map((xRow?.files ?? []).map((f) => [f.path, f.status]));
  check("2 /proposals: agent-x src/new.ts → added", xByPath.get("src/new.ts") === "added", J(xByPath.get("src/new.ts")));
  check("2 /proposals: agent-x src/auth.ts → modified", xByPath.get("src/auth.ts") === "modified", J(xByPath.get("src/auth.ts")));
  check("2 /proposals: agent-x src/gone.ts → removed", xByPath.get("src/gone.ts") === "removed", J(xByPath.get("src/gone.ts")));
}

// --- route guard (re-asserted so this file is self-contained) --------------
{
  const r = await get(env, "");
  check("3 /changes without repo → 400 repo-parameter-required", r.status === 400 && r.body?.ok === false && r.body?.error === "repo parameter required", J(r.body));
}

console.log(fails === 0 ? `ALL PASS` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
