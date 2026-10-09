#!/usr/bin/env bun
// Contract suite for the Artifacts queue event consumer (platform/src/index.ts queue()).
// Run: bun porting/tests/events-consumer.test.mjs   (exit 0 = pass)
//
// The real worker module is imported and exercised through worker.queue with an
// in-memory fake KV (env.LIVE). No module mocking, no source grep.

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Fake KVNamespace that mirrors the LIVE binding's get/put surface.
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

// ---------------------------------------------------------------------------
// Fake MessageBatch + message wrapper.
// ---------------------------------------------------------------------------

function fakeMessage(body) {
  const acks = { count: 0 };
  const message = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    body,
    attempts: 1,
    retry: false,
    ack() {
      acks.count++;
    },
  };
  return { message, acks };
}

function fakeBatch(messages) {
  return {
    messages,
    // MessageBatch requires these but the consumer doesn't use them.
    acknowledgeAll() { },
    retryAll() { },
    save() { },
  };
}

// ---------------------------------------------------------------------------
// Helpers

const VALID_AFTER = "a".repeat(40); // 40 hex chars
const SHA_AFTER = "0".repeat(40); // valid 40-hex after

function envFor(kv) {
  return {
    ARTIFACTS: { get: async () => null },
    LIVE: kv,
    CACHE: kv,
    AI: { run: async () => null },
    AUTH_MODE: "demo",
  };
}

async function dispatchQueue(env, msgWrappers) {
  const messages = msgWrappers.map((w) => w.message);
  const batch = fakeBatch(messages);
  await worker.queue(batch, env);
  return msgWrappers;
}

async function fetchEvents(env) {
  const res = await worker.fetch(new Request("https://test/events"), env);
  const body = await res.json();
  return body;
}

// ---------------------------------------------------------------------------
// 1. Replay of one key records exactly one entry — two identical repo.pushed
//    events => one KV entry, both acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.pushed", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w1 = fakeMessage(body);
  const w2 = fakeMessage(body);
  await dispatchQueue(env, [w1, w2]);
  const events = await fetchEvents(env);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("1 replay: one KV entry recorded", parsed.length === 1, `got ${parsed.length} entries`);
  check("1 replay: both messages acked", w1.acks.count === 1 && w2.acks.count === 1, `w1=${w1.acks.count} w2=${w2.acks.count}`);
} catch (e) {
  check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. cf.artifacts.repo.pushed normalizes to repo.pushed — stored event has type: repo.pushed
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "cf.artifacts.repo.pushed", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("2 normalize: type is repo.pushed", parsed[0]?.type === "repo.pushed", `got "${parsed[0]?.type}"`);
  check("2 normalize: acked", w.acks.count === 1);
} catch (e) {
  check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. Unknown type writes nothing — repo.unknown => zero entries, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.unknown", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("3 unknown type: zero entries", parsed.length === 0, `got ${parsed.length}`);
  check("3 unknown type: acked", w.acks.count === 1);
} catch (e) {
  check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. Bad repo charset writes nothing — repo with / or space => zero entries, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.pushed", source: { namespace: "test", repoName: "bad/repo name" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("4 bad repo charset: zero entries", parsed.length === 0, `got ${parsed.length}`);
  check("4 bad repo charset: acked", w.acks.count === 1);
} catch (e) {
  check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. Non-hex after writes nothing — after: "not-a-sha" => zero entries, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.pushed", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: "not-a-sha" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("5 non-hex after: zero entries", parsed.length === 0, `got ${parsed.length}`);
  check("5 non-hex after: acked", w.acks.count === 1);
} catch (e) {
  check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Missing repo identity is dropped + acked — no source.repoName => zero entries,
//    acked, feed-drop logged
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.pushed", source: { namespace: "test" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("6 no repo identity: zero entries", parsed.length === 0, `got ${parsed.length}`);
  check("6 no repo identity: acked", w.acks.count === 1);
} catch (e) {
  check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7. repo.forked records + cache:gen bumped — event recorded, cache:gen changed
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  kv._store.set("cache:gen", "0");
  const body = { type: "repo.forked", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  const genAfter = kv._store.get("cache:gen");
  check("7 repo.forked: event recorded", parsed.length === 1, `got ${parsed.length}`);
  check("7 repo.forked: cache:gen bumped", genAfter !== "0" && genAfter !== null, `got "${genAfter}"`);
} catch (e) {
  check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. repo.cloned records, cache:gen NOT bumped — event recorded, cache:gen unchanged
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  kv._store.set("cache:gen", "0");
  const body = { type: "repo.cloned", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  const genAfter = kv._store.get("cache:gen");
  check("8 repo.cloned: event recorded", parsed.length === 1, `got ${parsed.length}`);
  check("8 repo.cloned: cache:gen unchanged", genAfter === "0", `got "${genAfter}"`);
} catch (e) {
  check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. token.* type is rejected — token.created => zero entries, acked
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "token.created", source: { namespace: "test", repoName: "my-repo" }, payload: { ref: "main", after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("9 token type: zero entries", parsed.length === 0, `got ${parsed.length}`);
  check("9 token type: acked", w.acks.count === 1);
} catch (e) {
  check("9 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 10. Poisoned feed leaves /proposals untouched — pre-seed cache:gen + cache:proposals.*;
//     dispatch poison event; verify cache:gen unchanged, cache:proposals intact
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const seedGen = "seed-gen-123";
  const seedProp = JSON.stringify({ ok: true, proposals: [{ repo: "demo", ref: "main", diff: "abc" }] });
  kv._store.set("cache:gen", seedGen);
  kv._store.set("cache:proposals:demo:main:main:*", seedProp);
  const body = { type: "repo.pushed", source: { namespace: "test", repoName: "bad/repo" }, payload: { ref: "main", after: "not-hex" } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const genAfter = kv._store.get("cache:gen");
  const propAfter = kv._store.get("cache:proposals:demo:main:main:*");
  check("10 poisoned: cache:gen unchanged", genAfter === seedGen, `got "${genAfter}"`);
  check("10 poisoned: cache:proposals intact", propAfter === seedProp, "proposals cache changed");
} catch (e) {
  check("10 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 11. GET /events shape matches CONTRACT.md — returns { ok: true, events: [...] }
//     newest first, <=50
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  // Seed with 5 events, newest-first (matching how recordEvent stores them).
  const events = [];
  for (let i = 4; i >= 0; i--) {
    events.push({ type: "repo.pushed", repo: "repo-" + i, ref: "main", after: SHA_AFTER, at: `2026-01-0${i}T00:00:00.000Z` });
  }
  kv._store.set("recent", JSON.stringify(events));
  const body = await fetchEvents(env);
  check("11 events: ok is true", body.ok === true, `got ${body.ok}`);
  check("11 events: has events array", Array.isArray(body.events), `got ${typeof body.events}`);
  check("11 events: 5 returned", body.events.length === 5, `got ${body.events.length}`);
  check("11 events: newest first", body.events[0].at === "2026-01-04T00:00:00.000Z", `got "${body.events[0]?.at}"`);
} catch (e) {
  check("11 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 12. ref absent on repo.* events is allowed — event with no ref => recorded with ref: undefined
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const body = { type: "repo.pushed", source: { namespace: "test", repoName: "my-repo" }, payload: { after: SHA_AFTER } };
  const w = fakeMessage(body);
  await dispatchQueue(env, [w]);
  const stored = kv._store.get("recent");
  const parsed = stored ? JSON.parse(stored) : [];
  check("12 no ref: event recorded", parsed.length === 1, `got ${parsed.length}`);
  check("12 no ref: ref is undefined", parsed[0]?.ref === undefined, `got "${parsed[0]?.ref}"`);
  check("12 no ref: acked", w.acks.count === 1);
} catch (e) {
  check("12 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 13. GET /proposals rejects invalid base repo — base=../etc/passwd => 400
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const res = await worker.fetch(new Request("https://test/proposals?base=../etc/passwd"), env);
  check("13 bad base: status 400", res.status === 400, `got ${res.status}`);
  const body = await res.json();
  check("13 bad base: ok is false", body.ok === false, `got ${body.ok}`);
  check("13 bad base: error mentions invalid", body.error?.includes("invalid"), `got "${body.error}"`);
} catch (e) {
  check("13 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 14. GET /proposals rejects invalid ref — ref=../escape => 400
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const res = await worker.fetch(new Request("https://test/proposals?ref=../escape"), env);
  check("14 bad ref: status 400", res.status === 400, `got ${res.status}`);
  const body = await res.json();
  check("14 bad ref: ok is false", body.ok === false, `got ${body.ok}`);
} catch (e) {
  check("14 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 15. GET /changes rejects invalid repo — repo=bad/repo => 400
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const res = await worker.fetch(new Request("https://test/changes?repo=bad/repo"), env);
  check("15 bad repo on /changes: status 400", res.status === 400, `got ${res.status}`);
  const body = await res.json();
  check("15 bad repo on /changes: ok is false", body.ok === false, `got ${body.ok}`);
} catch (e) {
  check("15 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 16. GET /merge rejects invalid repos param — repos=bad/repo => 400
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv);
  const res = await worker.fetch(new Request("https://test/merge?repos=bad/repo"), env);
  check("16 bad repos on /merge: status 400", res.status === 400, `got ${res.status}`);
  const body = await res.json();
  check("16 bad repos on /merge: ok is false", body.ok === false, `got ${body.ok}`);
} catch (e) {
  check("16 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 17. GET /events/stream degrades gracefully when EVENTS_HUB is unbound.
//     Per CONTRACT.md § GET /events/stream: "degrades gracefully to the
//     `: connected` + snapshot tail if the hub is unbound or empty."
//     With no EVENTS_HUB binding, handleSSEStream returns a minimal SSE
//     response with just `: connected` so the client reconnects and falls
//     back to GET /events.
// ---------------------------------------------------------------------------
try {
  const kv = fakeKV();
  const env = envFor(kv); // envFor omits EVENTS_HUB — simulating local-dev/staging
  const res = await worker.fetch(new Request("https://test/events/stream"), env);
  check("17 stream unbound: status 200", res.status === 200, `got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  check("17 stream unbound: text/event-stream content-type", ct.startsWith("text/event-stream"), `got "${ct}"`);
  check("17 stream unbound: cache-control no-cache", res.headers.get("cache-control") === "no-cache", `got ${res.headers.get("cache-control")}`);
  const text = await res.text();
  check("17 stream unbound: body is `: connected` comment", text === ": connected\n\n", `got "${text}"`);
} catch (e) {
  check("17 stream unbound case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
