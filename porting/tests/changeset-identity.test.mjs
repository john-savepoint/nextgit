#!/usr/bin/env bun
// Contract suite: nextgit-e16 — the change-set's stable content
// identity (identity.fingerprint) is served on GET /changes and
// GET /proposals, is byte-identical across independent
// re-materializations, differs for any content delta, never
// depends on timestamps/intent, and equals the recomputed
// sha256 over the published serialization law.
// Run: bun porting/tests/changeset-identity.test.mjs   (exit 0 = pass)
//
// CONTRACT (platform/CONTRACT.md §GET /changes / §GET /proposals,
// v3.9): the changeSet carries `identity.fingerprint` — a 64-hex
// sha256 over the deterministic serialization (code-unit-sorted
// file paths + per-row status + per-row blob hashes + the base
// fork-point sha + the head repo/ref/sha). Never timestamps,
// intent, stats, or notes. The pure function is
// platform/src/identity.ts; the proposals[].identity.fingerprint
// row is identical to the same proposal's /changes value.
//
// Real construction: both routes are exercised through the REAL
// worker module (worker.fetch) against an in-memory Artifacts
// fake — the platform binding seam is the only fake (pattern per
// fork-point-pinning / change-status-enum); no module mocks, no
// source-grep for behavioral assertions. The recompute leg derives
// the expected digest from the SERVED changeSet content via the
// published serialization law + crypto.subtle, proving the served
// value is the derivation, not an opaque token.
//
// Legs:
//   1. deterministic order — two independently-constructed
//      environments yield byte-identical 64-hex fingerprints;
//   2. collision resistance — any content delta (an added file,
//      a moved blob hash, a different base ref/fork-point sha)
//      yields a distinct fingerprint;
//   3. field presence + cross-surface — /changes and /proposals
//      both carry identity.fingerprint and agree for the same
//      proposal;
//   4. content-only law — differing intent text and commit
//      timestamps (identical trees) yield the SAME fingerprint;
//   5. recompute — the served fingerprint deep-equals the
//      sha256 recomputed from the served changeSet content under
//      the published serialization law.

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
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the makeFakeArtifacts factory pattern
// from fork-point-pinning / change-status-enum). A factory, so
// environments cannot alias — leg 1 needs two independent ones.
// ---------------------------------------------------------------------------
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
  // commit() carries the per-commit authoredAt so leg 4 can vary
  // timestamps while holding the tree (and therefore the
  // fingerprint) fixed.
  function commit(hash, treeHash, authoredAt = 0) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt, committedAt: authoredAt };
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
      async list({ limit = 200 } = {}) { return { repos: [] }; },
    },
    tree, commit, defineRepo,
    blobHashOf: (text) => blobHashByText.get(text) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fixture — base `demo` (fork point over a moved baseline) and
// proposal `agent-1` whose change-set MODIFIES src/auth.ts and
// ADDS src/extra.ts relative to the fork point. A second proposal
// `agent-2` differs by exactly one content delta (a different
// src/auth.ts head blob) for leg 2. `agent-dates` re-materializes
// agent-1's trees with different authoredAt + intent for leg 4.
// ---------------------------------------------------------------------------
const AUTH_V0 = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_V1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const AUTH_V1B = "export function refreshSession(ttl) {\n  return Date.now() + ttl + 1;\n}\nexport const keep = true;\n";
const MID = "export const mid = 1;\n";
const EXTRA = "export const extra = 1;\n";
const INTENT_A1 = "refresh session helper";
const INTENT_A1_OTHER = "a completely different intent note";

// commit shas (40-hex so base.sha / head.sha are realistic)
const sha = (n) => String(n).padStart(2, "0").repeat(20);
const C_BASE = sha(0x11), C_FORK = sha(0x22), C_LAND = sha(0x33);
const C_A1 = sha(0x55), C_A1B = sha(0x56), C_A2 = sha(0x66), C_DATES = sha(0x77);

// A shared builder so every environment constructs the SAME trees
// (the trees are the fingerprint's content; only the
// non-content metadata differs).
function buildTrees(fake) {
  const tBase = fake.tree({ "src/auth.ts": AUTH_V0 });
  const tFork = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID });
  const tLand = fake.tree({ "src/auth.ts": AUTH_V0, "src/mid.ts": MID, "src/landed.ts": "export const landed = 1;\n" });
  const tA1 = fake.tree({ "src/auth.ts": AUTH_V1, "src/mid.ts": MID, "src/extra.ts": EXTRA });
  const tA1B = fake.tree({ "src/auth.ts": AUTH_V1B, "src/mid.ts": MID, "src/extra.ts": EXTRA });
  const tA2 = fake.tree({ "src/auth.ts": AUTH_V1, "src/mid.ts": MID, "src/extra.ts": "export const extra = 2;\n" });
  return { tBase, tFork, tLand, tA1, tA1B, tA2 };
}

// Two independent environments (leg 1). `withDates` re-materializes
// agent-1 with different authoredAt + a different intent (leg 4).
function makeEnvironment({ withDates = false, variant = "a1" } = {}) {
  const fake = makeFakeArtifacts();
  const { tBase, tFork, tLand, tA1, tA1B, tA2 } = buildTrees(fake);

  // demo baseline: a moved head (C_LAND) over the fork (C_FORK).
  fake.defineRepo("demo", {
    history: [
      fake.commit(C_LAND, tLand, 1000),
      fake.commit(C_FORK, tFork, 500),
      fake.commit(C_BASE, tBase, 100),
    ],
    refs: { main: C_LAND },
  });

  // agent-1: the canonical proposal (modified auth.ts + added extra.ts).
  const a1AuthoredAt = withDates ? 999999 : 4242;
  fake.defineRepo("agent-1", {
    history: [
      fake.commit(C_A1, tA1, a1AuthoredAt),
      fake.commit(C_FORK, tFork, 500),
      fake.commit(C_BASE, tBase, 100),
    ],
    refs: { main: C_A1 },
    intents: { [C_A1]: withDates ? INTENT_A1_OTHER : INTENT_A1 },
  });

  // agent-1b: same trees as agent-1 but a DIFFERENT head sha (leg 2
  // negative control — a head-sha delta moves the fingerprint).
  fake.defineRepo("agent-1b", {
    history: [
      fake.commit(C_A1B, tA1, 4242),
      fake.commit(C_FORK, tFork, 500),
      fake.commit(C_BASE, tBase, 100),
    ],
    refs: { main: C_A1B },
    intents: { [C_A1B]: INTENT_A1 },
  });

  // agent-2: one content delta (extra.ts text differs -> its headHash moves).
  fake.defineRepo("agent-2", {
    history: [
      fake.commit(C_A2, tA2, 4242),
      fake.commit(C_FORK, tFork, 500),
      fake.commit(C_BASE, tBase, 100),
    ],
    refs: { main: C_A2 },
    intents: { [C_A2]: INTENT_A1 },
  });

  // agent-dates: agent-1's EXACT trees, different authoredAt + intent (leg 4).
  fake.defineRepo("agent-dates", {
    history: [
      fake.commit(C_DATES, tA1, 777777),
      fake.commit(C_FORK, tFork, 500),
      fake.commit(C_BASE, tBase, 100),
    ],
    refs: { main: C_DATES },
    intents: { [C_DATES]: INTENT_A1_OTHER },
  });

  // agent-1-variant: agent-1's trees but a different auth blob (leg 2, tA1B).
  if (variant === "a1b") {
    fake.defineRepo("agent-1", {
      history: [
        fake.commit(C_A1, tA1B, 4242),
        fake.commit(C_FORK, tFork, 500),
        fake.commit(C_BASE, tBase, 100),
      ],
      refs: { main: C_A1 },
      intents: { [C_A1]: INTENT_A1 },
    });
  }

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { fake, env };
}

const get = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/changes${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const proposals = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid/proposals${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// The published serialization law (platform/src/identity.ts —
// reimplemented here so the recompute leg cross-checks the served
// value against a real second derivation, not the production code.
// The production serializer is intentionally NOT imported: a shared
// implementation would make the recompute leg tautological — a bug
// in the production serialization law would be invisible).
function serializeChangeSetIdentity(input) {
  const identityBlock = `${input.base.repo}\n${input.base.ref}\n${input.base.sha}\n${input.head.repo}\n${input.head.ref}\n${input.head.sha}\n`;
  const records = [...input.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.status}\n${f.path}\n${f.status !== "removed" ? f.headHash ?? "" : ""}\n${f.status !== "added" ? f.baseHash ?? "" : ""}\x00`)
    .join("");
  return identityBlock + records;
}
async function recomputeFingerprint(changeSet) {
  // The served changeSet.head carries {repo, ref, treeHash, sha} —
  // the head commit sha the fingerprint law covers (the proposal
  // head). `commits[0].hash` is the cross-check derivation (the
  // change-set first-parent log is newest-first, so [0] is the
  // head the change-set describes); head.sha is the served value.
  const headSha = changeSet.head.sha ?? changeSet.commits?.[0]?.hash;
  const canonical = serializeChangeSetIdentity({
    base: { repo: changeSet.base.repo, ref: changeSet.base.ref, sha: changeSet.base.sha },
    head: { repo: changeSet.head.repo, ref: changeSet.head.ref, sha: headSha },
    files: changeSet.files.map((f) => ({ path: f.path, status: f.status, baseHash: f.baseHash, headHash: f.headHash })),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Leg 1 — deterministic order: two independently-constructed
// environments yield byte-identical 64-hex fingerprints.
// ---------------------------------------------------------------------------
{
  const { env: env1 } = makeEnvironment();
  const { env: env2 } = makeEnvironment();
  const r1 = await get(env1, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const r2 = await get(env2, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const fp1 = r1.body?.changeSet?.identity?.fingerprint;
  const fp2 = r2.body?.changeSet?.identity?.fingerprint;
  check("1: /changes 200 ok:true (env1)", r1.status === 200 && r1.body?.ok === true, J({ status: r1.status, ok: r1.body?.ok }));
  check("1: /changes 200 ok:true (env2)", r2.status === 200 && r2.body?.ok === true, J({ status: r2.status, ok: r2.body?.ok }));
  check("1: changeSet carries identity.fingerprint (env1)", typeof fp1 === "string", J({ fp1 }));
  check("1: fingerprint is 64-hex (env1)", HEX64.test(String(fp1)), String(fp1));
  check("1: fingerprint is 64-hex (env2)", HEX64.test(String(fp2)), String(fp2));
  check("1: two independent environments yield byte-identical fingerprints", fp1 === fp2, J({ fp1, fp2 }));
  check("1: changeSet keys exactly {base, head, stats, files, texts, commits, identity}", exactKeys(r1.body?.changeSet, ["base", "head", "stats", "files", "texts", "commits", "identity"]), J(r1.body?.changeSet && Object.keys(r1.body.changeSet)));
  check("1: identity keys exactly {fingerprint}", exactKeys(r1.body?.changeSet?.identity, ["fingerprint"]), J(r1.body?.changeSet?.identity && Object.keys(r1.body.changeSet.identity)));
}

// ---------------------------------------------------------------------------
// Leg 2 — collision resistance: any content delta yields a distinct
// fingerprint. (a) an added file's text delta moves its headHash;
// (b) a different head sha (same trees) moves head.sha; (c) a
// different base ref resolves a different fork-point sha.
// ---------------------------------------------------------------------------
{
  const { env } = makeEnvironment();
  const base = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const baseFp = base.body?.changeSet?.identity?.fingerprint;

  // (a) one content delta: agent-2's extra.ts text differs -> headHash moves.
  const delta = await get(env, "?repo=agent-2&base=demo&ref=main&baseRef=main");
  const deltaFp = delta.body?.changeSet?.identity?.fingerprint;
  check("2a: content delta (extra.ts text) yields a distinct fingerprint", typeof deltaFp === "string" && deltaFp !== baseFp, J({ baseFp, deltaFp }));

  // (b) different head sha, same trees (agent-1b) -> head.sha moves.
  const shaDelta = await get(env, "?repo=agent-1b&base=demo&ref=main&baseRef=main");
  const shaDeltaFp = shaDelta.body?.changeSet?.identity?.fingerprint;
  check("2b: different head sha (same trees) yields a distinct fingerprint", typeof shaDeltaFp === "string" && shaDeltaFp !== baseFp, J({ baseFp, shaDeltaFp }));

  // (c) different base ref -> a different fork-point sha (base.sha moves).
  // baseRef=C_BASE resolves the base's oldest commit as the fork point.
  const refDelta = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=" + C_BASE);
  const refDeltaFp = refDelta.body?.changeSet?.identity?.fingerprint;
  check("2c: different base ref (different fork-point sha) yields a distinct fingerprint", typeof refDeltaFp === "string" && refDeltaFp !== baseFp, J({ baseFp, refDeltaFp, baseSha: base.body?.changeSet?.base?.sha, refDeltaSha: refDelta.body?.changeSet?.base?.sha }));
}

// ---------------------------------------------------------------------------
// Leg 3 — field presence + cross-surface: /proposals rows carry
// identity.fingerprint equal to the same proposal's /changes value.
// ---------------------------------------------------------------------------
{
  const { env } = makeEnvironment();
  const cs = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const pr = await proposals(env, "?base=demo&repos=agent-1&ref=main&baseRef=main");
  const csFp = cs.body?.changeSet?.identity?.fingerprint;
  const rowFp = pr.body?.proposals?.[0]?.identity?.fingerprint;
  check("3: /proposals 200 ok:true", pr.status === 200 && pr.body?.ok === true, J({ status: pr.status, ok: pr.body?.ok }));
  check("3: /proposals row carries identity.fingerprint", typeof rowFp === "string", J({ rowFp }));
  check("3: /proposals row fingerprint is 64-hex", HEX64.test(String(rowFp)), String(rowFp));
  check("3: /changes fingerprint is 64-hex", HEX64.test(String(csFp)), String(csFp));
  check("3: /proposals row fingerprint === /changes changeSet fingerprint (same proposal)", rowFp === csFp, J({ rowFp, csFp }));
}

// ---------------------------------------------------------------------------
// Leg 4 — content-only law: identical {paths, statuses, blob hashes,
// base/head shas} but different intent text and commit timestamps
// yield the SAME fingerprint. agent-dates re-materializes agent-1's
// exact trees with a different authoredAt and a different intent.
// ---------------------------------------------------------------------------
{
  const { env } = makeEnvironment();
  const { env: envDates } = makeEnvironment({ withDates: true });
  const r = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const rDates = await get(envDates, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const fp = r.body?.changeSet?.identity?.fingerprint;
  const fpDates = rDates.body?.changeSet?.identity?.fingerprint;
  // Sanity: the two change-sets really do differ in intent + timestamp.
  const intent = r.body?.changeSet?.files?.find((f) => f.intent)?.intent;
  const intentDates = rDates.body?.changeSet?.files?.find((f) => f.intent)?.intent;
  const ts = r.body?.changeSet?.commits?.[0]?.timestamp;
  const tsDates = rDates.body?.changeSet?.commits?.[0]?.timestamp;
  check("4: intent text differs between the two materializations", intent !== intentDates, J({ intent, intentDates }));
  check("4: commit timestamp differs between the two materializations", ts !== tsDates, J({ ts, tsDates }));
  check("4: differing intent + timestamps (identical content) yield the SAME fingerprint", fp === fpDates, J({ fp, fpDates }));
}

// ---------------------------------------------------------------------------
// Leg 5 — recompute: the served fingerprint deep-equals the sha256
// recomputed from the served changeSet content under the published
// serialization law (code-unit order, per-row status + hashes,
// base/head shas).
// ---------------------------------------------------------------------------
{
  const { env } = makeEnvironment();
  const r = await get(env, "?repo=agent-1&base=demo&ref=main&baseRef=main");
  const served = r.body?.changeSet?.identity?.fingerprint;
  const recomputed = await recomputeFingerprint(r.body?.changeSet);
  check("5: served fingerprint is 64-hex", HEX64.test(String(served)), String(served));
  check("5: recomputed fingerprint is 64-hex", HEX64.test(String(recomputed)), String(recomputed));
  check("5: served fingerprint deep-equals the recomputed sha256 over the served content", served === recomputed, J({ served, recomputed }));

  // Cross-check the recompute law catches a delta: recompute over a
  // mutated copy (one headHash flipped) must NOT equal the served value.
  const mutated = JSON.parse(JSON.stringify(r.body?.changeSet));
  const anyFile = mutated.files.find((f) => f.status !== "removed");
  if (anyFile) anyFile.headHash = "blob-mutated";
  const mutatedFp = await recomputeFingerprint(mutated);
  check("5: recompute over a mutated headHash differs from the served fingerprint", mutatedFp !== served, J({ mutatedFp, served }));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
