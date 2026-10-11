#!/usr/bin/env bun
// Contract suite: FR-36 — token audit at two surfaces.
// Run: bun porting/tests/token-audit-consumer.test.mjs   (exit 0 = pass)
//
// Offline, full-suite safe. Real construction only: the real worker
// module is imported and exercised through worker.queue / worker.fetch
// with an in-memory fake KV (env.LIVE) and a fake ARTIFACTS binding.
// No module mocking, no source grep.
//
// 8 scenarios:
//   1. token.created (cf.artifacts envelope) records — normalized
//      repo.token.created, repo mapped, acked
//   2. token.revoked records — normalized repo.token.revoked, acked
//   3. normalized-type form (repo.token.created) also records
//   4. tokenId never reaches the feed
//   5. cache:gen NOT bumped (token events are not cache-invalidating)
//   6. dedupe stays (type,repo,ref,after) — two token.created on one
//      repo record once
//   7. auditToken hygiene — POST /land against an egress-guard-style
//      fake ARTIFACTS (createToken/revokeToken fakes) + console.log
//      capture: `token-mint {repo,ttl:300}` and
//      `token-revoke {repo,phase:"success"}` lines, no fake plaintext
//      in any captured line
//   8. failed revoke audited — revokeToken throws => token-revoke
//      {repo,phase:"failed"}

import worker from "../../platform/src/index.ts";
import { TOKEN_TTL_SECONDS } from "../../platform/src/land.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Fake KVNamespace that mirrors the LIVE binding's get/put surface.
// ---------------------------------------------------------------------------

function fakeKV() {
  const store = new Map();
  return {
    _store: store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
  };
}

// ---------------------------------------------------------------------------
// Fake MessageBatch + message wrapper.
// ---------------------------------------------------------------------------

function fakeMessage(body) {
  return {
    body,
    acks: { count: 0 },
    ack() {
      this.acks.count++;
    },
  };
}

function fakeBatch(messages) {
  return { messages };
}

// ---------------------------------------------------------------------------
// Helpers

const SHA_AFTER = "0".repeat(40);

function envFor(kv) {
  return {
    LIVE: kv,
    CACHE: kv,
    ARTIFACTS: {
      async list() {
        return { repos: [{ name: "demo", status: "ready" }] };
      },
      async get() {
        throw new Error("not-used-by-queue-scenarios");
      },
    },
    ASSETS: { fetch: async () => new Response("") },
    AUTH_MODE: "demo",
  };
}

async function dispatchQueue(env, msgWrappers) {
  await worker.queue(fakeBatch(msgWrappers), env);
}

async function fetchEvents(env) {
  const res = await worker.fetch(new Request("https://test/events"), env);
  return (await res.json()).events;
}

// ---------------------------------------------------------------------------
// 1. token.created records — cf.artifacts envelope -> one entry
//    (normalized repo.token.created), repo mapped, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "cf.artifacts.repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "tok_1" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const events = await fetchEvents(env);
  check("1 token.created: one entry", events.length === 1, `got ${events.length}`);
  check("1 token.created: normalized type", events[0]?.type === "repo.token.created", `got ${events[0]?.type}`);
  check("1 token.created: repo mapped", events[0]?.repo === "my-repo", `got ${events[0]?.repo}`);
  check("1 token.created: acked", w.acks.count === 1);
} catch (e) {
  check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. token.revoked records — normalized repo.token.revoked, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "cf.artifacts.repo.token.revoked", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "tok_2" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const events = await fetchEvents(env);
  check("2 token.revoked: one entry", events.length === 1, `got ${events.length}`);
  check("2 token.revoked: normalized type", events[0]?.type === "repo.token.revoked", `got ${events[0]?.type}`);
  check("2 token.revoked: acked", w.acks.count === 1);
} catch (e) {
  check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. normalized-type form also records — repo.token.created (already
//    normalized; normalizeEventType strips only cf.artifacts.)
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: {} };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const events = await fetchEvents(env);
  check("3 normalized form: one entry", events.length === 1, `got ${events.length}`);
  check("3 normalized form: type unchanged", events[0]?.type === "repo.token.created", `got ${events[0]?.type}`);
  check("3 normalized form: acked", w.acks.count === 1);
} catch (e) {
  check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3b. live-emitted form records — the open-beta environment
//     emits cf.artifacts.token.created (no `repo.` segment)
//     => one entry (normalized token.created), acked. The
//     acceptance copy names token.created/token.revoked in
//     GET /events, so this is the live path.
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "cf.artifacts.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "tok_live" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const events = await fetchEvents(env);
  check("3b live token.created: one entry", events.length === 1, `got ${events.length}`);
  check("3b live token.created: normalized type", events[0]?.type === "token.created", `got ${events[0]?.type}`);
  check("3b live token.created: repo mapped", events[0]?.repo === "my-repo", `got ${events[0]?.repo}`);
  check("3b live token.created: acked", w.acks.count === 1);
} catch (e) {
  check("3b case threw", false, String(e?.stack ?? e));
}
// ---------------------------------------------------------------------------
// 4. tokenId never reaches the feed — the consumer maps only
//    source.repoName -> repo, so the token id is dropped at the seam
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "cf.artifacts.repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "secret-token-id-xyz" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  check("4 tokenId not in KV value", !stored?.includes("secret-token-id-xyz"));
  const events = await fetchEvents(env);
  check("4 tokenId not in events JSON", !JSON.stringify(events).includes("secret-token-id-xyz"));
  check("4 acked", w.acks.count === 1);
} catch (e) {
  check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. cache:gen NOT bumped — token events never change a change-set
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  await kv.put("cache:gen", "42");
  const body = { type: "cf.artifacts.repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: {} };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const gen = await kv.get("cache:gen");
  check("5 cache:gen unchanged", gen === "42", `got ${gen}`);
  check("5 acked", w.acks.count === 1);
} catch (e) {
  check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. dedupe stays (type,repo,ref,after) — two token.created on one
//    repo (no ref/after) record once
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const w1 = fakeMessage({ type: "cf.artifacts.repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "a" } });
  const w2 = fakeMessage({ type: "cf.artifacts.repo.token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { tokenId: "b" } });
  await dispatchQueue(env, [w1, w2]);
  const events = await fetchEvents(env);
  check("6 dedupe: one entry", events.length === 1, `got ${events.length}`);
  check("6 dedupe: both acked", w1.acks.count === 1 && w2.acks.count === 1);
} catch (e) {
  check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7 & 8. auditToken hygiene — drive POST /land against an
//    egress-guard-style fake ARTIFACTS (createToken/revokeToken
//    fakes) with console.log capture. The fixture is a real two-repo
//    graph: `demo` (base) + `agent-audit` (proposal with an added
//    file), so the fold produces a change and the land reaches the
//    mint/revoke critical section. pushLand's clone fails against the
//    unreachable fake remote — the land returns 500 push-failed, but
//    the finally still revokes (and audits) the minted token.
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

// The fake plaintext minted by createToken — must never appear in any
// captured log line (NFR-3).
const FAKE_PLAINTEXT = "art_v1_fake-audit-plaintext-never-log";

// createToken/revokeToken call records, shared by scenarios 7 and 8.
const tokenCalls = { created: [], revoked: [], failRevoke: false };

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
    async createToken() {
      tokenCalls.created.push(name);
      return { plaintext: FAKE_PLAINTEXT };
    },
    async revokeToken() {
      tokenCalls.revoked.push(name);
      if (tokenCalls.failRevoke) throw new Error("fixture: revoke failed");
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

function landEnv() {
  const store = new Map();
  const kv = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => {
      store.set(k, v);
      return true;
    },
  };
  // The AD-11 auto-land gate runs inside every engaged POST /land: the
  // land must be answered by the pinned model (a null/absent AI fails
  // closed 503 BEFORE the mint/revoke critical section this suite
  // exercises). Schema-valid Clef reply for the no-intent plan
  // [risk_1, content_secret_1] — routine risk, no content-secret flag.
  return { env: { ARTIFACTS, LIVE: kv, CACHE: kv, ASSETS: { fetch: async () => new Response("") }, AI: { async run() { return { model: "clef", answers: { risk_1: { type: "score", score: 0.4 }, content_secret_1: { type: "noul", noul: 0.0 } }, usage: { neurons: 1 } }; } }, AUTH_MODE: "demo" }, kv };
}

// Capture console.log while a land runs.
function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = orig;
    })
    .then((result) => ({ result, lines }));
}

// A minimal ctx that absorbs waitUntil (the land's cache-invalidation
// fire-and-forget must not escape into the real event loop).
const fakeCtx = { waitUntil() { } };

// Fixture: demo with a single file. A proposal adds a second file, so
// the fold produces a change and the land reaches the mint/revoke
// critical section (a no-changes land returns before the mint).
const DEMO_FILES = { "src/a.ts": "export const a = 1;\n" };
const cBase = commit("base", tree(DEMO_FILES));
defineRepo("demo", { history: [cBase], refs: { main: cBase.hash } });
const propFiles = { ...DEMO_FILES, "src/b.ts": "export const b = 2;\n" };
const cProp = commit("prop", tree(propFiles));
defineRepo("agent-audit", { history: [cProp, cBase], refs: { main: cProp.hash } });

// The land body: base=demo, proposal=agent-audit (a real change).
function landRequest() {
  return new Request("https://test/land", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "10.0.1.1" },
    body: JSON.stringify({ base: "demo", repos: ["agent-audit"], baseRef: "main", ref: "main" }),
  });
}

// 7. land reaches the mint/revoke critical section =>
//    token-mint {repo,ttl} + token-revoke {phase:success}
try {
  tokenCalls.created.length = 0;
  tokenCalls.revoked.length = 0;
  tokenCalls.failRevoke = false;
  const { env } = landEnv();
  const { result, lines } = await captureLogs(() => worker.fetch(landRequest(), env, fakeCtx));
  const mint = lines.find((l) => l.startsWith("token-mint "));
  const revoke = lines.find((l) => l.startsWith("token-revoke "));
  check("7 land reached mint/revoke (push-failed path)", result.status === 500, `status ${result.status}`);
  check("7 mint line present", mint !== undefined, JSON.stringify(lines));
  check("7 mint fields", mint === `token-mint {"repo":"demo","ttl":${TOKEN_TTL_SECONDS}}`, mint);
  check("7 revoke line present", revoke !== undefined, JSON.stringify(lines));
  check("7 revoke phase success", revoke === 'token-revoke {"repo":"demo","phase":"success"}', revoke);
  check("7 fake plaintext never logged", !lines.some((l) => l.includes(FAKE_PLAINTEXT)));
  check("7 createToken called once", tokenCalls.created.length === 1, `created=${JSON.stringify(tokenCalls.created)}`);
  check("7 revokeToken called once", tokenCalls.revoked.length === 1, `revoked=${JSON.stringify(tokenCalls.revoked)}`);
} catch (e) {
  check("7 case threw", false, String(e?.stack ?? e));
}

// 8. failed revoke => token-revoke {phase:"failed"} (never silent)
try {
  tokenCalls.created.length = 0;
  tokenCalls.revoked.length = 0;
  tokenCalls.failRevoke = true;
  const { env } = landEnv();
  const { lines } = await captureLogs(() => worker.fetch(landRequest(), env, fakeCtx));
  const revoke = lines.find((l) => l.startsWith("token-revoke "));
  check("8 failed revoke audited", revoke === 'token-revoke {"repo":"demo","phase":"failed"}', revoke);
  check("8 fake plaintext never logged", !lines.some((l) => l.includes(FAKE_PLAINTEXT)));
  check("8 revokeToken attempted", tokenCalls.revoked.length === 1, `revoked=${JSON.stringify(tokenCalls.revoked)}`);
} catch (e) {
  check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
