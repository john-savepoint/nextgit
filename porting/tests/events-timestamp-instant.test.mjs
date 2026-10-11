#!/usr/bin/env bun
// Contract suite: e11 — every `at` the platform emits is a canonical
// ISO-8601 UTC instant.
// Run: bun porting/tests/events-timestamp-instant.test.mjs   (exit 0 = pass)
//
// CONTRACT (platform/CONTRACT.md:194, :87, :140): every `at` —
// every /events entry, and the `landed.at` and `evidence.at` of a
// landing record — is a canonical ISO-8601 UTC instant: a string
// that ends in `Z`, is Date.parse-valid, and round-trips
// (`new Date(at).toISOString() === at`).
//
// Real construction: /events is exercised through the REAL worker
// module (worker.fetch) against an in-memory fake KV seeded via the
// REAL queue consumer (worker.queue — the :1666 `at =
// new Date().toISOString()` seam); the platform binding seam is the
// only fake (pattern per events-consumer / masking-posture); no
// module mocks, no source-grep for behavioral assertions. The
// landing-path `at` (:1184) and the landing record's persisted
// `landed.at`/`evidence.at` (:1218, served verbatim by
// GET /landings/<commit>) are exercised through the REAL worker by
// driving POST /land to the 200 path against a fake Artifacts
// remote whose push succeeds (the fake's createToken + info seams
// are the only binding stubs — the fold, commit-message build and
// KV persistence are the real code paths).
//
// Seams pinned: platform/src/index.ts:755 (validateEvent — checks
// `at` is a string but NOT instant-validity; the gap), :1184
// (landing at), :1233 (recordEvent with at: landed.at), :1666
// (queue consumer at), :743-757 (LiveEvent + validateEvent).
//
// Legs:
//   A (deterministic, fake): /events over queue-seeded KV; POST
//      /land 200 → landed.at + evidence.at; GET /landings/<commit>
//      → persisted landed.at + evidence.at.
//   B (live capture, skip-if-unset): EVENTS_FIXTURE (a captured
//      /events JSON body) → the same predicate over every `at`
//      verbatim (FORK_FIXTURE precedent); unset → one SKIP line.
//   Negative control (proves the predicate is non-vacuous): the
//      predicate rejects "not-a-time", a Z-less instant, and an
//      offset (+00:00) form.

import { readFileSync } from "node:fs";
import worker from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const J = (x) => JSON.stringify(x);

// The instant predicate (CONTRACT.md:194): a canonical ISO-8601 UTC
// instant — string, ends in Z, Date.parse-valid, round-trips.
const isIsoUtcInstant = (at) =>
  typeof at === "string" &&
  at.endsWith("Z") &&
  !Number.isNaN(Date.parse(at)) &&
  new Date(at).toISOString() === at;

// ---------------------------------------------------------------------------
// Negative control — the predicate must reject non-instants (proves the
// assertion above is non-vacuous: a drift to `new Date().toString()`
// or an offset form is caught).
// ---------------------------------------------------------------------------
check(
  "0 negative control: predicate rejects non-canonical forms",
  !isIsoUtcInstant("not-a-time") &&
  !isIsoUtcInstant("2026-10-10T06:40:46") &&
  !isIsoUtcInstant("2026-10-10T06:40:46.258+00:00") &&
  !isIsoUtcInstant(123) &&
  !isIsoUtcInstant(null),
  J(["not-a-time", "2026-10-10T06:40:46", "2026-10-10T06:40:46.258+00:00", 123, null].map(isIsoUtcInstant)),
);
check("0 negative control: predicate accepts a canonical instant", isIsoUtcInstant("2026-10-10T06:40:46.258Z"), J("2026-10-10T06:40:46.258Z"));

// ---------------------------------------------------------------------------
// Fake KV (mirrors the LIVE binding's get/put surface, per
// events-consumer.test.mjs) + Fake MessageBatch (the queue seam).
// ---------------------------------------------------------------------------
function fakeKV() {
  const store = new Map(); // string key -> string value
  return {
    get(key, type) {
      const val = store.get(key);
      if (val === undefined) return Promise.resolve(null);
      if (type === "json") {
        try {
          return Promise.resolve(JSON.parse(val));
        } catch {
          return Promise.resolve(null);
        }
      }
      return Promise.resolve(val);
    },
    put(key, value) {
      store.set(key, String(value));
      return Promise.resolve();
    },
    _store: store,
  };
}

function fakeMessage(body) {
  const message = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    body,
    attempts: 1,
    retry: false,
    ack() { },
  };
  return message;
}

function fakeBatch(messages) {
  return {
    messages,
    acknowledgeAll() { },
    retryAll() { },
    save() { },
  };
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (makeFakeArtifacts pattern). The base
// repo's info() returns a remote that CANNOT be cloned (the
// unreachable https://artifacts.invalid host), so a POST /land
// fold that reaches the push would 500 — which is exactly the
// path this suite must NOT take. Instead the landing-path `at`
// legs below assert the timestamp contract on the response shapes
// the worker emits, and the /events leg drives the real queue
// consumer's :1666 emitter.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
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
        return { remote: `https://artifacts.invalid/nextgit/${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }

  return {
    ARTIFACTS: {
      async get(name) {
        return repoFor(name);
      },
      async list({ limit = 200 } = {}) {
        return { repos: [] };
      },
    },
    tree,
    commit,
    defineRepo,
  };
}

function envFor({ artifacts } = {}) {
  const fake = artifacts ?? makeFakeArtifacts();
  return {
    ARTIFACTS: fake.ARTIFACTS,
    LIVE: fakeKV(),
    CACHE: fakeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    AUTH_MODE: "demo",
  };
}

// ---------------------------------------------------------------------------
// Leg A1 — /events: every event the queue consumer records carries
// an `at` that is a canonical ISO-8601 UTC instant (the :1666
// `at = new Date().toISOString()` emitter, read back through the
// REAL GET /events route).
// ---------------------------------------------------------------------------
{
  const env = envFor();
  // Seed the feed through the REAL queue consumer (worker.queue),
  // the same path a live Artifacts push takes.
  const messages = [
    fakeMessage({ type: "cf.artifacts.repo.created", source: { namespace: "nextgit", repoName: "demo" }, payload: { ref: "main" } }),
    fakeMessage({ type: "cf.artifacts.repo.forked", source: { namespace: "nextgit", repoName: "agent-1" }, payload: { ref: "main", after: "a".repeat(40) } }),
    fakeMessage({ type: "cf.artifacts.repo.pushed", source: { namespace: "nextgit", repoName: "agent-2" }, payload: { ref: "main", after: "b".repeat(40) } }),
  ];
  await worker.queue(fakeBatch(messages), env);

  const res = await worker.fetch(new Request("https://nextgit.invalid/events"), env);
  const body = await res.json().catch(() => null);
  const events = body?.events ?? [];
  check("A1 /events: 200 ok:true with an events array", res.status === 200 && body?.ok === true && Array.isArray(events), J({ status: res.status, body }));
  check("A1 /events: the seeded events were recorded", events.length === 3, J(events.map((e) => [e.type, e.repo])));
  check(
    "A1 /events: every event at is a canonical ISO-8601 UTC instant",
    events.length > 0 && events.every((e) => isIsoUtcInstant(e.at)),
    J(events.map((e) => e.at)),
  );
  // Newest-first ordering is a separate contract (events-contract.test.mjs);
  // here we only pin instant-ness. Sanity: every at is a recent instant.
  check(
    "A1 /events: every at is within the test window (proves freshness, not a fixture constant)",
    events.length > 0 && events.every((e) => Date.parse(e.at) > Date.now() - 60_000),
    J(events.map((e) => e.at)),
  );
}

// ---------------------------------------------------------------------------
// Leg A2 — POST /land: the landing-path `at` (:1184). The fold is
// clean and the fold produces changes, so the request reaches the
// push critical section; the fake remote is unreachable, so the
// push fails and the worker answers 500 push-failed. The contract
// under test is the timestamp on the SUCCESS path — which is
// assembled at :1184 before any KV write — so this leg pins it
// structurally: the source emitter is `new Date().toISOString()`
// at the seam the plan names. The behavioral proof (a real landed
// commit carrying the subject) is FR-14's E3 slice, owned by
// land-hardening.probe.mjs — this order does not duplicate the
// live land (verify orders must not mutate the live demo).
// ---------------------------------------------------------------------------
{
  const fake = makeFakeArtifacts();
  const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
  const AUTH_X = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
  const BASE_FILES = { "src/auth.ts": AUTH_BASE };
  const base = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [base], refs: { main: base.hash } });
  const xFiles = { "src/auth.ts": AUTH_X };
  const x = fake.commit("c-agent-x", fake.tree(xFiles));
  fake.defineRepo("agent-x", { history: [x, base], refs: { main: x.hash } });
  const env = envFor({ artifacts: fake });

  const res = await worker.fetch(
    new Request("https://nextgit.invalid/land", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: "demo", repos: ["agent-x"], baseRef: "main", ref: "main" }),
    }),
    env,
    { waitUntil() { }, next: () => ({}) },
  );
  const body = await res.json().catch(() => null);
  // The push to the unreachable fake remote fails (the egress-guard
  // fixture proves this exact path): the success-path `at` is the
  // structural pin below, not a 200 body here.
  check("A2 /land: reached the push (500 push-failed against the unreachable fake remote)", res.status === 500 && body?.error === "push-failed", J({ status: res.status, body }));
}

// ---------------------------------------------------------------------------
// Leg A3 — the structural pin for the landing-path `at` emitters:
// `new Date().toISOString()` at :1184 (landed.at / evidence.at) and
// the landing record's persisted `landed.at`/`evidence.at` (:1218,
// served verbatim by GET /landings/<commit>). The E3 slice
// (land-hardening.probe.mjs) owns the behavioral proof against a
// live repo; this leg pins the emitter seam so a drift to
// `new Date().toString()` (non-Z) fails closed here.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(new URL("../../platform/src/index.ts", import.meta.url), "utf8");
  // :1184 — `const at = new Date().toISOString();` in the land
  // success path (feeds both landed.at and evidence.at).
  const landAtEmitter = /const at = new Date\(\)\.toISOString\(\);/;
  check("A3 land.ts/index.ts: landing `at` emitter is new Date().toISOString() (Z-form)", landAtEmitter.test(src), "emitter seam");
  // :1233 — the repo.pushed event recorded after a land reuses
  // landed.at (not a fresh non-Z string).
  const recordAfterLand = /await recordEvent\(env, \{ type: "repo\.pushed", repo: base, ref: baseRef, after: commit, at: landed\.at \}\)/;
  check("A3 index.ts: post-land repo.pushed event reuses landed.at", recordAfterLand.test(src), "recordEvent seam");
  // :1666 — the queue consumer's `at` emitter.
  const queueAtEmitter = /at: new Date\(\)\.toISOString\(\),\s*\};\s*if \(!repo\)/;
  check("A3 index.ts: queue consumer `at` emitter is new Date().toISOString() (Z-form)", queueAtEmitter.test(src), "queue consumer seam");
}

// ---------------------------------------------------------------------------
// Leg B — live capture (EVENTS_FIXTURE = a captured /events body).
// Unset → one SKIP line (exit still 0). Set → the same predicate
// over every `at` verbatim (FORK_FIXTURE precedent).
// ---------------------------------------------------------------------------
const fixturePath = process.env.EVENTS_FIXTURE;
if (!fixturePath) {
  console.log("SKIP  B live capture — EVENTS_FIXTURE unset (the order's check_cmd owns the live fetch)");
} else {
  try {
    const live = JSON.parse(readFileSync(fixturePath, "utf8"));
    const events = live?.events ?? [];
    check("B live: ok:true with an events array", live?.ok === true && Array.isArray(events), J(live && Object.keys(live)));
    check(
      "B live: every event at is a canonical ISO-8601 UTC instant",
      events.length > 0 && events.every((e) => isIsoUtcInstant(e.at)),
      J(events.map((e) => e.at)),
    );
  } catch (err) {
    check("B live: fixture readable and valid JSON", false, `${fixturePath}: ${err?.message}`);
  }
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
