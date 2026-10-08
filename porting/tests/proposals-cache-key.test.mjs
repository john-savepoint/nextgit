#!/usr/bin/env bun
// Contract test for /proposals KV cache-key validation (cache-key-cachepoison HIGH).
// Run: bun porting/tests/proposals-cache-key.test.mjs  (exit 0 = pass)
//
// Guards: every cacheKey segment is validated against REPO_NAME_RE / REF_RE before
// interpolation, so raw query params cannot inject key-segment metacharacters or
// craft cache-key collisions. Mirrors the validation already enforced by POST /land
// and POST /judge. The real worker module is imported and exercised through
// worker.fetch with an in-memory KV fake — no module mocking, no source grep.

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// --- in-memory KV fake -------------------------------------------------------
const kvStore = new Map();

const LIVE = {
  async get(key) {
    return kvStore.get(key) ?? null;
  },
  async put(key, value) {
    kvStore.set(key, value);
  },
  async delete(key) {
    kvStore.delete(key);
  },
};

const ARTIFACTS = {
  async list() {
    return { repos: [] };
  },
  async get(name) {
    throw new Error(`fixture: no repo ${name}`);
  },
};

const env = { ARTIFACTS, LIVE, ASSETS: { fetch: async () => new Response("") } };

// --- helpers -----------------------------------------------------------------
async function proposals(url) {
  const res = await worker.fetch(new Request(url), env);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
}

function clearCache() {
  kvStore.clear();
}

// ---------------------------------------------------------------------------
// 1. Valid params pass validation (status is 200 or 500 from compute, NOT 400)
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status, headers } = await proposals("https://test/proposals?base=demo&ref=main&baseRef=main&repos=agent-1,agent-2");
  check("1 valid params pass validation (not 400)", status !== 400, `status ${status}`);
  check("1 cache header set on 200", status === 200 ? (headers["x-nextgit-cache"] === "miss" || headers["x-nextgit-cache"] === "hit") : true, String(headers["x-nextgit-cache"]));
} catch (e) {
  check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. Invalid base repo rejected before cache key construction
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status, body } = await proposals("https://test/proposals?base=evil/base&ref=main&baseRef=main");
  check("2 invalid base 400", status === 400, `status ${status}`);
  check("2 invalid base error body", body.includes("ok") && body.includes("false"), body);
  check("2 no cache write on 400", kvStore.size === 0, `cache size ${kvStore.size}`);
  const poisonedKey = [...kvStore.keys()].find((k) => k.includes("evil"));
  check("2 no poisoned cache entry", !poisonedKey, String(poisonedKey));
} catch (e) {
  check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. Invalid ref rejected (.. traversal)
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo&ref=..%2Fescape&baseRef=main");
  check("3 invalid ref (..) 400", status === 400, `status ${status}`);
} catch (e) {
  check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. Invalid ref rejected (leading slash)
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo&ref=/main&baseRef=main");
  check("4 invalid ref (leading /) 400", status === 400, `status ${status}`);
} catch (e) {
  check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. Invalid ref rejected (trailing slash)
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo&ref=main/&baseRef=main");
  check("5 invalid ref (trailing /) 400", status === 400, `status ${status}`);
} catch (e) {
  check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Invalid baseRef rejected
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo&ref=main&baseRef=..%2Fescape");
  check("6 invalid baseRef 400", status === 400, `status ${status}`);
} catch (e) {
  check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7. Invalid repo name in repos param rejected
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo&ref=main&baseRef=main&repos=valid,evil/name");
  check("7 invalid repo name 400", status === 400, `status ${status}`);
} catch (e) {
  check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. Cache key poisoning attempt — metacharacters in base
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals?base=demo%3Aother&ref=main&baseRef=main");
  check("8 cache-key metachar base 400", status === 400, `status ${status}`);
  check("8 no cache entry for crafted key", !kvStore.has("cache:proposals"), `kvStore keys: ${[...kvStore.keys()].join(",")}`);
} catch (e) {
  check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. Default values (no params) pass validation (not 400)
// ---------------------------------------------------------------------------
try {
  clearCache();
  const { status } = await proposals("https://test/proposals");
  check("9 defaults pass validation (not 400)", status !== 400, `status ${status}`);
} catch (e) {
  check("9 case threw", false, String(e?.stack ?? e));
}

console.log(fails === 0 ? `ALL PASS` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
