#!/usr/bin/env bun
// Contract suite: FR-16 (read half) — GET /proposals publishes the reviewed-state
// anchors: base.head (the base repo's head at baseRef) and proposals[].head (each
// proposal's head at ref); those exact values are what POST /land's reviewed-state
// gate compares against. Story: e3-impl-reviewed-heads-exposed.
// Run: bun porting/tests/proposals-reviewed-heads.test.mjs   (exit 0 = pass)
//
// Real construction: both routes go through the REAL worker module (worker.fetch)
// against an in-memory Artifacts fake — the platform binding seam is the only fake
// (pattern per fork-point-pinning / proposals-conflict-map / judge.test.mjs); no
// module mocks, no source grep.
//
// Legs:
//   1. fixture, moved baseline (demo head C_LAND over the shared fork C_FORK):
//      base.head === C_LAND (NOT the fork point), agent-1 row head === C_A1,
//      agent-done row head === C_DONE; an unreadable repo keeps its error row and
//      carries no head; base identity and existing row fields unchanged; the
//      empty set still carries base.head.
//   2. fixture, /land agreement: a land carrying exactly the emitted anchors passes
//      the reviewed gate and reaches the fold's 409 no-changes (never 409 stale),
//      while a wrong proposal head or a wrong base head is refused 409 stale; all
//      refusals leave the base head unmoved. Nothing is pushed (no clone: the
//      zero-change fold returns before the push section).
//   3. live capture: with HEADS_CAPTURE=<path> pointing at a captured /proposals
//      body, the wire checks run over it verbatim; unset → one SKIP line.
//
// Recovery for live drift: demo reset (seed.mjs + real-agents.mjs), not an edit here.

import { readFileSync } from "node:fs";
import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);
const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};
const sha = (n) => n.toString(16).padStart(2, "0").repeat(20); // 40 hex chars
const C_BASE = sha(0x11), C_FORK = sha(0x22), C_LAND = sha(0x33), C_A1 = sha(0x55), C_DONE = sha(0x88);
const AUTH_V0 = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_V1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const MID0 = "export const mid = 1;\n";
const MID1 = "export const mid = 2;\n";
const LANDED = "export const landed = 1;\n";

function makeFakeArtifacts() {
  const blobText = new Map(), blobHashByText = new Map(), treeEntries = new Map(), repos = new Map();

  function internBlob(text) {
    if (!blobHashByText.has(text)) { const hash = `blob-${blobHashByText.size + 1}`; blobHashByText.set(text, hash); blobText.set(hash, text); }
    return blobHashByText.get(text);
  }
  function entriesFor(node) {
    return Object.entries(node).map(([name, child]) => (typeof child === "string"
      ? { name, mode: "100644", hash: child, type: "blob" }
      : { name, mode: "40000", hash: treeHashFor(child), type: "tree" }));
  }
  function treeHashFor(node) { const entries = entriesFor(node); const hash = `tree-${treeEntries.size + 1}`; treeEntries.set(hash, entries); return hash; }
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
  function defineRepo(name, { history, refs, intents = {} }) { repos.set(name, { history, refs, intents }); }
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
      async log(opts = {}) {
        const { ref = "HEAD", limit = 50 } = opts;
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
          const shaPart = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[shaPart];
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
  };
}

function makeEnvironment() {
  const fake = makeFakeArtifacts();
  const tBase = fake.tree({ "src/auth.ts": AUTH_V0 });
  const tFork = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID0 });
  const tLand = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID1, "src/landed.ts": LANDED });
  const tDone = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID1, "src/landed.ts": LANDED }); // same contents as tLand
  const tA1 = fake.tree({ "src/auth.ts": AUTH_V1, "src/mid.ts": MID0 });

  fake.defineRepo("demo", { history: [fake.commit(C_LAND, tLand), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_LAND } });
  fake.defineRepo("agent-1", { history: [fake.commit(C_A1, tA1), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_A1 } });
  fake.defineRepo("agent-done", { history: [fake.commit(C_DONE, tDone), fake.commit(C_FORK, tFork), fake.commit(C_BASE, tBase)], refs: { main: C_DONE } });

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { fake, env };
}

const proposals = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/proposals${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const land = async (env, payload) => {
  const res = await worker.fetch(new Request("https://nextgit.invalid/land", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Leg 1 — fixture: the anchors over the moved-baseline history set.
// ---------------------------------------------------------------------------
const { env } = makeEnvironment();
const r = await proposals(env, "?base=demo&repos=agent-1,agent-done,agent-missing&ref=main&baseRef=main");
const body = r.body;
const row = (name) => (body?.proposals ?? []).find((p) => p.repo === name);

check("1: 200 ok:true", r.status === 200 && body?.ok === true, J({ status: r.status, error: body?.error }));
check("1: base keys exactly {repo, ref, head}", exactKeys(body?.base, ["repo", "ref", "head"]), J(body?.base));
check("1: base.repo/ref unchanged (demo/main)", body?.base?.repo === "demo" && body?.base?.ref === "main", J(body?.base));
check("1: base.head === C_LAND — the current base head, NOT the fork point C_FORK", body?.base?.head === C_LAND, J({ got: body?.base?.head, want: C_LAND, fork: C_FORK }));
check("1: base.head is 40-hex", /^[0-9a-f]{40}$/.test(String(body?.base?.head)), String(body?.base?.head));
check("1: proposal rows keep the requested order and identity", J((body?.proposals ?? []).map((p) => p.repo)) === J(["agent-1", "agent-done", "agent-missing"]), J((body?.proposals ?? []).map((p) => p.repo)));
check("1: agent-1 row head === C_A1 (the proposal's head at ref)", row("agent-1")?.head === C_A1, J(row("agent-1")));
check("1: agent-done row head === C_DONE", row("agent-done")?.head === C_DONE, J(row("agent-done")));
check("1: every readable row head is 40-hex and not the shared fork point", ["agent-1", "agent-done"].every((n) => /^[0-9a-f]{40}$/.test(String(row(n)?.head)) && row(n)?.head !== C_FORK), J({ a1: row("agent-1")?.head, done: row("agent-done")?.head }));
check("1: unreadable repo keeps an error row and carries no head", typeof row("agent-missing")?.error === "string" && !("head" in (row("agent-missing") ?? {})), J(row("agent-missing")));
check("1: existing row fields unchanged (agent-1 landing/files/stats)", row("agent-1")?.landing?.status === "ready" && (row("agent-1")?.files ?? []).length === 1 && row("agent-1")?.stats?.files === 1, J({ landing: row("agent-1")?.landing, files: row("agent-1")?.files, stats: row("agent-1")?.stats }));
check("1: agent-done folds to landed (zero-change)", row("agent-done")?.landing?.status === "landed", J(row("agent-done")?.landing));
check("1: summary keys unchanged", exactKeys(body?.summary, ["proposals", "changedFiles", "sharedFiles", "conflictingPairs", "cleanPairs"]), J(body?.summary));
check("1: envelope keys exactly {base, conflicts, ok, proposals, ref, summary}", exactKeys(body, ["base", "conflicts", "ok", "proposals", "ref", "summary"]), J(body && Object.keys(body).sort()));

// empty set (nothing discovered) still carries the base anchor
{
  const { env: env2 } = makeEnvironment();
  const r2 = await proposals(env2, "?base=demo");
  check("1: empty set — no proposals, base.head still emitted", r2.status === 200 && (r2.body?.proposals ?? []).length === 0 && r2.body?.base?.head === C_LAND, J({ status: r2.status, base: r2.body?.base, n: r2.body?.proposals?.length }));
}

// ---------------------------------------------------------------------------
// Leg 2 — fixture: /land accepts exactly these anchors; wrong anchors refused.
// ---------------------------------------------------------------------------
const emittedBase = body?.base?.head;
const emittedDone = row("agent-done")?.head;

const accepted = await land(env, {
  base: "demo", repos: ["agent-done"], baseRef: "main", ref: "main",
  reviewed: { baseHead: emittedBase, heads: { "agent-done": emittedDone } },
});
check("2a: land carrying the emitted anchors passes the reviewed gate → 409 no-changes", accepted.status === 409 && accepted.body?.error === "no-changes", J(accepted.body));

const wrong = sha(0xee);
const badHead = await land(env, {
  base: "demo", repos: ["agent-done"], baseRef: "main", ref: "main",
  reviewed: { baseHead: emittedBase, heads: { "agent-done": wrong } },
});
check("2b: a proposal head that is not the emitted one → 409 stale", badHead.status === 409 && badHead.body?.error === "stale", J(badHead.body));

const badBase = await land(env, {
  base: "demo", repos: ["agent-done"], baseRef: "main", ref: "main",
  reviewed: { baseHead: wrong, heads: { "agent-done": emittedDone } },
});
check("2c: a base head that is not the emitted one → 409 stale", badBase.status === 409 && badBase.body?.error === "stale", J(badBase.body));

const after = await proposals(env, "?base=demo&repos=agent-done&ref=main&baseRef=main");
check("2d: every refusal left the base head unmoved (still the emitted value)", after.body?.base?.head === emittedBase, J(after.body?.base));

// ---------------------------------------------------------------------------
// Leg 3 — live capture (HEADS_CAPTURE = a captured /proposals body). Unset → SKIP.
// ---------------------------------------------------------------------------
const capturePath = process.env.HEADS_CAPTURE;
if (!capturePath) {
  console.log("SKIP  3 live capture — HEADS_CAPTURE unset (the order's check_cmd owns the live fetch)");
} else {
  try {
    const live = JSON.parse(readFileSync(capturePath, "utf8"));
    check("3 live: ok:true with envelope keys exactly {base, conflicts, ok, proposals, ref, summary}", live?.ok === true && exactKeys(live, ["base", "conflicts", "ok", "proposals", "ref", "summary"]), J(live && Object.keys(live).sort()));
    check("3 live: base.head is 40-hex", /^[0-9a-f]{40}$/.test(String(live?.base?.head)), String(live?.base?.head));
    check("3 live: every proposals[].head is 40-hex", (live?.proposals ?? []).length > 0 && live.proposals.every((p) => /^[0-9a-f]{40}$/.test(String(p?.head))), J((live?.proposals ?? []).map((p) => p?.head)));
  } catch (err) {
    check("3 live: capture readable and valid JSON", false, `${capturePath}: ${err?.message}`);
  }
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
