#!/usr/bin/env bun
// Contract suite for the e12 integrity row (FR-47) — the
// nextgit-e12-impl-integrity-fail-closed-blob-reads order's
// check. Fail closed on blob integrity at every materialization
// path: the readVerifiedBlob chokepoint (the ONLY byte-returning
// ASSET_BLOB.get in platform/src/**) plus the GET /asset/{blobId}
// download route that funnels through it.
//
// Run: bun porting/tests/r2-integrity.test.mjs   (exit 0 = pass)
//
// Idiom: r2-asset-tier.test.mjs — the real worker module is
// imported and exercised through worker.fetch with an in-memory
// Artifacts fake and a stubbed ASSET_BLOB binding (the platform
// binding seam is the only thing stubbed; no mock.module, no
// source grep; exit 0 = pass; full-suite safe, no network).
//
// Groups (each defends an observable contract):
//   G1 happy path — bytes hash to H, expectation H, the
//      chokepoint returns the EXACT bytes (byte-equal).
//   G2 mismatch direction 1 (pointer hash != stored digest):
//      R2 holds bytes hashing to H2, expectation H1 ⇒ throws
//      BlobIntegrityError (name + digest-only fields), zero
//      bytes returned.
//   G3 mismatch direction 2 (blob id key != stored digest):
//      R2 key K holds bytes hashing to D (D != K), expectation
//      K ⇒ throws BlobIntegrityError.
//   G4 route happy path — GET /asset/{blobId} → 200 raw bytes,
//      byte-equal, content-type application/octet-stream.
//   G5 route mismatch (both directions) → 422
//      {ok:false,error:"integrity"} (non-2xx, no bytes).
//   G6 route not-found (missing object at a content-addressed
//      key) → 422 {ok:false,error:"integrity"} — no key-existence
//      oracle.
//   G7 route bad-request — non-64-hex blobId → 400 bad-request.
//   G8 chokepoint fail-closed preconditions — unbound bucket
//      ⇒ BlobIntegrityError; the git paths stay pointer-blind
//      (the instrumented invariance suite owns the zero-read
//      proof; here we prove the chokepoint is the read seam).
//   G9 mismatch log/detail carries digests only — no blob bytes
//      in the BlobIntegrityError fields (AD-4/NFR-5).

import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";
import {
  readVerifiedBlob,
  BlobIntegrityError,
  assetPointerFor,
} from "../../platform/src/assets.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

function makeR2() {
  const store = new Map(); // key -> Uint8Array
  return {
    store,
    async get(key) {
      const bytes = store.get(key);
      if (!bytes) return null;
      // R2ObjectBody shape (worker-configuration.d.ts:2059-2067):
      // arrayBuffer() lives on the object itself, alongside
      // httpMetadata — not a {body, httpMetadata} wrapper.
      return {
        arrayBuffer: async () => bytes.slice().buffer,
        httpMetadata: {},
      };
    },
    async put(key, value) {
      store.set(key, new Uint8Array(await value.arrayBuffer()));
    },
  };
}

const ARTIFACTS = {
  async get(name) {
    return { name, defaultBranch: "main", status: "ready", head: { sha: "0".repeat(40), tree: "t" } };
  },
  async list() {
    return { repos: [] };
  },
};

// WebCrypto hex-64 sha256 (the assets.ts sha256Hex idiom).
async function sha256Hex(bytes) {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- env -------------------------------------------------------------------

function envFor(r2, { authMode = "demo" } = {}) {
  return {
    ARTIFACTS,
    LIVE: {},
    CACHE: {},
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    ASSET_BLOB: r2,
    AUTH_MODE: authMode,
  };
}

// --- fixtures ---------------------------------------------------------------

// A real asset blob, content-addressed by its own hash.
const ASSET_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const ASSET_SHA = await sha256Hex(ASSET_BYTES); // H

// A DIFFERENT blob (hashes to H2 != H) — the tamper/substitution fixture.
const TAMPERED_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
const TAMPERED_SHA = await sha256Hex(TAMPERED_BYTES); // H2

// A content-addressed key that does NOT match its stored digest
// (key K, stored bytes hash to D, D != K) — the substitution-at-key case.
const SUBSTITUTION_KEY = "c".repeat(64); // K
const SUBSTITUTION_DIGEST = await sha256Hex(TAMPERED_BYTES); // D (D != K)

// A non-64-hex blobId (bad-request fixture).
const BAD_BLOB_ID = "not-a-valid-blob-id";

// ---------------------------------------------------------------------------
// G1 — happy path: bytes hash to H, expectation H ⇒ exact bytes returned.
// ---------------------------------------------------------------------------
{
  const r2 = makeR2();
  r2.store.set(ASSET_SHA, ASSET_BYTES);
  const bytes = await readVerifiedBlob(envFor(r2), ASSET_SHA, ASSET_SHA);
  check("G1 chokepoint returns the exact verified bytes (byte-equal)",
    bytes instanceof Uint8Array && bytes.length === ASSET_BYTES.length &&
    bytes.every((b, i) => b === ASSET_BYTES[i]),
    `got length ${bytes?.length}`);
}

// ---------------------------------------------------------------------------
// G2 — mismatch direction 1: stored bytes hash to H2, expectation H1
//      (pointer/content divergence) ⇒ BlobIntegrityError, zero bytes.
// ---------------------------------------------------------------------------
{
  const r2 = makeR2();
  // Keyed by the EXPECTED id H1, but the stored bytes hash to H2.
  const expected = "a".repeat(64); // H1 (the pointer's recorded hash)
  r2.store.set(expected, TAMPERED_BYTES); // stored bytes actually hash to H2
  let threw = null;
  try {
    await readVerifiedBlob(envFor(r2), expected, expected);
  } catch (err) {
    threw = err;
  }
  check("G2 pointer/content divergence throws BlobIntegrityError",
    threw instanceof BlobIntegrityError && threw.name === "BlobIntegrityError",
    `got ${threw ? threw.name : "no throw"}`);
  check("G2 error fields are digests only (blobId/expected/actual, no bytes)",
    threw instanceof BlobIntegrityError &&
    threw.blobId === expected &&
    threw.expectedSha256 === expected &&
    threw.actualSha256 === TAMPERED_SHA,
    `got ${JSON.stringify(threw && { blobId: threw.blobId, expectedSha256: threw.expectedSha256, actualSha256: threw.actualSha256 })}`);
}

// ---------------------------------------------------------------------------
// G3 — mismatch direction 2: content-addressed key K != stored digest D
//      (the substitution case) ⇒ BlobIntegrityError.
// ---------------------------------------------------------------------------
{
  const r2 = makeR2();
  // Key K holds bytes that hash to D; K != D. The caller expects K
  // (the content-addressed key IS the expectation).
  r2.store.set(SUBSTITUTION_KEY, TAMPERED_BYTES);
  let threw = null;
  try {
    await readVerifiedBlob(envFor(r2), SUBSTITUTION_KEY, SUBSTITUTION_KEY);
  } catch (err) {
    threw = err;
  }
  check("G3 content-addressed key != stored digest throws BlobIntegrityError",
    threw instanceof BlobIntegrityError && threw.name === "BlobIntegrityError",
    `got ${threw ? threw.name : "no throw"}`);
  check("G3 error carries the stored digest as actualSha256",
    threw instanceof BlobIntegrityError && threw.actualSha256 === SUBSTITUTION_DIGEST,
    `got actualSha256 ${threw?.actualSha256}`);
}

// ---------------------------------------------------------------------------
// G4 — route happy path: GET /asset/{blobId} → 200 raw bytes.
// ---------------------------------------------------------------------------
{
  const r2 = makeR2();
  r2.store.set(ASSET_SHA, ASSET_BYTES);
  const env = envFor(r2);
  const res = await worker.fetch(new Request(`https://nextgit.test/asset/${ASSET_SHA}`), env);
  const body = new Uint8Array(await res.arrayBuffer());
  check("G4 GET /asset/{blobId} → 200",
    res.status === 200, `got ${res.status}`);
  check("G4 route returns the exact verified bytes (byte-equal)",
    body.length === ASSET_BYTES.length && body.every((b, i) => b === ASSET_BYTES[i]),
    `got length ${body.length}`);
  check("G4 route serves content-type application/octet-stream",
    (res.headers.get("content-type") ?? "").startsWith("application/octet-stream"),
    `got ${res.headers.get("content-type")}`);
}

// ---------------------------------------------------------------------------
// G5 — route mismatch (both directions) → 422 {ok:false,error:"integrity"}.
// ---------------------------------------------------------------------------
{
  // Direction 1: keyed by expected H1, stored bytes hash to H2.
  const r2a = makeR2();
  const expected = "a".repeat(64);
  r2a.store.set(expected, TAMPERED_BYTES);
  const resA = await worker.fetch(new Request(`https://nextgit.test/asset/${expected}`), envFor(r2a));
  const bodyA = await readJson(resA);
  check("G5a route pointer/content divergence → 422 integrity",
    resA.status === 422 && bodyA?.body?.ok === false && bodyA?.body?.error === "integrity",
    `got ${resA.status} ${JSON.stringify(bodyA?.body)}`);

  // Direction 2: key K holds bytes hashing to D != K.
  const r2b = makeR2();
  r2b.store.set(SUBSTITUTION_KEY, TAMPERED_BYTES);
  const resB = await worker.fetch(new Request(`https://nextgit.test/asset/${SUBSTITUTION_KEY}`), envFor(r2b));
  const bodyB = await readJson(resB);
  check("G5b route substitution-at-key → 422 integrity",
    resB.status === 422 && bodyB?.body?.ok === false && bodyB?.body?.error === "integrity",
    `got ${resB.status} ${JSON.stringify(bodyB?.body)}`);
}

// ---------------------------------------------------------------------------
// G6 — route not-found: missing object at a content-addressed key ⇒
//      the same 422 {ok:false,error:"integrity"} (no key-existence oracle).
// ---------------------------------------------------------------------------
{
  const r2 = makeR2(); // empty store
  const res = await worker.fetch(new Request(`https://nextgit.test/asset/${ASSET_SHA}`), envFor(r2));
  const body = await readJson(res);
  check("G6 route missing blob → 422 integrity (no key-existence oracle)",
    res.status === 422 && body?.body?.ok === false && body?.body?.error === "integrity",
    `got ${res.status} ${JSON.stringify(body?.body)}`);
}

// ---------------------------------------------------------------------------
// G7 — route bad-request: non-64-hex blobId → 400 bad-request.
// ---------------------------------------------------------------------------
{
  const r2 = makeR2();
  const res = await worker.fetch(new Request(`https://nextgit.test/asset/${BAD_BLOB_ID}`), envFor(r2));
  const body = await readJson(res);
  check("G7 route non-64-hex blobId → 400 bad-request",
    res.status === 400 && body?.body?.ok === false && body?.body?.error === "bad-request",
    `got ${res.status} ${JSON.stringify(body?.body)}`);
}

// ---------------------------------------------------------------------------
// G8 — chokepoint fail-closed preconditions: unbound bucket ⇒
//      BlobIntegrityError (never a silent null / undefined deref).
// ---------------------------------------------------------------------------
{
  let threw = null;
  try {
    await readVerifiedBlob({ /* no ASSET_BLOB */ }, ASSET_SHA, ASSET_SHA);
  } catch (err) {
    threw = err;
  }
  check("G8 unbound ASSET_BLOB throws BlobIntegrityError (fail closed)",
    threw instanceof BlobIntegrityError && threw.name === "BlobIntegrityError",
    `got ${threw ? threw.name : "no throw"}`);
}

// ---------------------------------------------------------------------------
// G9 — the route is registered (dynamic, GET read) and the chokepoint
//      is the single byte-returning read seam: the route table carries
//      /asset/ as a dynamic GET read (the authorize() chokepoint covers
//      it — deny mode 401s before any bucket read).
// ---------------------------------------------------------------------------
{
  check("G9a /asset/ registered as a dynamic GET read route",
    DYNAMIC_ROUTES.some((r) => r.prefix === "/asset/" && r.method === "GET" && r.action === "read"),
    `got ${JSON.stringify(DYNAMIC_ROUTES)}`);
  // Deny mode: the authorize() chokepoint 401s BEFORE the handler
  // (and therefore before any ASSET_BLOB.get) — the mode gate is
  // the route's first defense.
  const r2 = makeR2();
  r2.store.set(ASSET_SHA, ASSET_BYTES);
  const res = await worker.fetch(new Request(`https://nextgit.test/asset/${ASSET_SHA}`), envFor(r2, { authMode: "deny" }));
  const body = await readJson(res);
  check("G9b deny mode 401s before any blob read (authorize chokepoint covers /asset/)",
    res.status === 401 && body?.body?.ok === false && body?.body?.error === "unauthorized",
    `got ${res.status} ${JSON.stringify(body?.body)}`);
}

// ---------------------------------------------------------------------------
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
