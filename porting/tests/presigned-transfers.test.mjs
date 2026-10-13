#!/usr/bin/env bun
// Contract suite for presigned direct-to-R2 transfers (AD-10; FR-47) —
// the nextgit-serve-blobs-via-presigned-direct-to-r2-transfers order's
// check: "a 3 GB upload completes without traversing the Worker body
// path; range download works via presigned URL".
//
// Run: bun porting/tests/presigned-transfers.test.mjs   (exit 0 = pass)
//
// Real construction: the real worker module is imported and driven
// through worker.fetch() with an in-memory env whose ARTIFACTS fake
// THROWS (so a repo read on these routes fails loudly — the transfer
// surface is repo-state-free), and a recorder installed as
// globalThis.fetch stands in for the S3 API (the platform binding seam
// is the only thing stubbed; no mock.module, no source grep). Every
// group saves and restores globalThis.fetch and console.log.
//
// Groups (each defends an observable contract):
//   1.  SigV4 canonical form — the shipped signer's signature verified
//       by an INDEPENDENT implementation (node:crypto) rebuilt from the
//       URL, plus sensitivity controls (key / expiry / clock).
//   2.  Single-part grant — one presigned PUT, zero control frames.
//   3.  Part plan — the count math, the 10,000 clamp, the bounds.
//   4.  Grant shape — closed schema, field guards, allowlist 403,
//       CSRF 403, zero Artifacts reads.
//   5.  Multipart grant — Create control frame only; per-part PUTs
//       target the bucket (partNumber + uploadId signed).
//   6.  Complete — happy path, MEASURED size (never the client's word),
//       exactly one Complete control frame.
//   7.  Complete failures — S3 refusal is a 502, never a 500; path
//       discipline and part-list guards.
//   8.  Presign GET — URL shape, expiry default/floor/cap, range signed.
//   9.  Rate limits — the 21st grant is a 429 (row read dynamically).
//   10. Deny mode — 401 before ANY mint (zero frames, zero repo reads).
//   11. Fail-closed — missing credentials answer 503, never a mint.
//   12. THE 3 GB ACCEPTANCE LEG — the Worker carries only control
//       frames; every payload byte targets the presigned bucket URL.
//   13. Git-path invariance — the git read routes mint nothing.
//   14. No URL egress (logs) + the 405 law that forced the dynamic
//       registration.
//   15. abortMultipartSession — a real DELETE control frame, best-effort.

import { createHash, createHmac } from "node:crypto";
import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";
import {
 DEFAULT_PRESIGN_EXPIRY_SECONDS,
 MAX_MULTIPART_PARTS,
 MAX_PRESIGN_EXPIRY_SECONDS,
 MIN_PRESIGN_EXPIRY_SECONDS,
 R2_MAX_OBJECT_BYTES,
 abortMultipartSession,
 clampPresignExpiry,
 planUpload,
 presignGetUrl,
 presignPutUrl,
} from "../../platform/src/r2-presign.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const CREDS = { ASSET_ACCOUNT_ID: "acct1234", ASSET_S3_ACCESS_KEY_ID: "AKIAEXAMPLEKEYID", ASSET_S3_SECRET_ACCESS_KEY: "s3cr3t-example-key" };
const BUCKET = "nextgit-asset-blobs";
const S3_HOST = `${CREDS.ASSET_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const THREE_GIB = 3 * GIB;
const SHA = "a".repeat(64);
const POINTER_PATH = "assets/hero.asset.json";
const UPLOAD_ID = "up-load-id-42";
const COMPLETE_ETAG = "\"composite-etag-1\"";
const STORED_SIZE = THREE_GIB;

/** The in-memory env. ARTIFACTS throws: these routes never read repo
 *  state, so any read is a bug the suite surfaces as a 500. */
function envFor({ authMode = "demo", creds = true, r2 = true, seen = { reads: 0 } } = {}) {
 const env = {
  ARTIFACTS: {
   get: async () => { seen.reads++; throw new Error("ARTIFACTS.get must not be reached on the transfer routes"); },
   list: async () => { seen.reads++; throw new Error("ARTIFACTS.list must not be reached on the transfer routes"); },
  },
  LIVE: { get: async () => undefined, put: async () => undefined },
  CACHE: { get: async () => undefined, put: async () => undefined },
  ASSETS: { fetch: async () => new Response("ASSETS-SERVED") },
  AI: { run: async () => null },
  AUTH_MODE: authMode,
  seen,
 };
 if (creds) Object.assign(env, CREDS);
 // The asset tier is bound only where the contract needs its metadata
 // (the complete route's measured size).
 if (r2) env.ASSET_BLOB = { head: async (key) => (key === SHA ? { size: STORED_SIZE, key } : null) };
 return env;
}

/** A scripted S3 transport installed as globalThis.fetch. Records every
 *  frame so a group can assert what the WORKER actually sent. */
function makeTransport({ createStatus = 200, completeStatus = 200, abortStatus = 200, throwOnCall = false } = {}) {
 const frames = [];
 const transport = async (url, init = {}) => {
  const parsed = new URL(url);
  const frame = {
   method: (init.method ?? "GET").toUpperCase(),
   host: parsed.host,
   path: parsed.pathname,
   query: Object.fromEntries(parsed.searchParams),
   rawQuery: parsed.search,
   body: init.body ?? null,
   bodyBytes: typeof init.body === "string" ? init.body.length : 0,
   url,
  };
  frames.push(frame);
  if (throwOnCall) throw new TypeError("transport must not be called");
  if (frame.method === "POST" && frame.rawQuery === "?uploads=") {
   if (createStatus !== 200) return new Response("<Error><Code>InternalError</Code></Error>", { status: createStatus });
   return new Response(`<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>k</Key><UploadId>${UPLOAD_ID}</UploadId></InitiateMultipartUploadResult>`, { status: 200 });
  }
  if (frame.method === "POST" && "uploadId" in frame.query) {
   if (completeStatus !== 200) return new Response("<Error><Code>InvalidPart</Code></Error>", { status: completeStatus });
   return new Response(`<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><ETag>${COMPLETE_ETAG}</ETag></CompleteMultipartUploadResult>`, { status: 200 });
  }
  if (frame.method === "DELETE" && "uploadId" in frame.query) {
   return new Response("", { status: abortStatus });
  }
  return new Response("", { status: 200 });
 };
 return { frames, transport };
}

/** Run fn with the transport installed and console output captured. */
async function withTransport(transport, fn) {
 const realFetch = globalThis.fetch;
 const realLog = console.log;
 const logs = [];
 globalThis.fetch = transport;
 console.log = (...args) => { logs.push(args.map(String).join(" ")); };
 try {
  return { result: await fn(), logs };
 } finally {
  globalThis.fetch = realFetch;
  console.log = realLog;
 }
}

const drive = async (env, method, path, { body, headers = {} } = {}) => {
 const init = { method, headers: { ...headers } };
 if (body !== undefined) {
  init.headers["content-type"] = "application/json";
  init.body = typeof body === "string" ? body : JSON.stringify(body);
 }
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
 const text = await res.text();
 let parsed = null;
 try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
 return { status: res.status, body: parsed, text, contentType: res.headers.get("content-type") ?? "" };
};

const grant = (extra = {}, env) => drive(env ?? envFor(), "POST", "/asset/uploads", {
 body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: 3 * GIB, ...extra },
});
const complete = (uploadId, body, env) => drive(env ?? envFor(), "POST", `/asset/uploads/${uploadId}/complete`, { body });
const presign = (blobId, query = "", env) => drive(env ?? envFor(), "GET", `/asset/${blobId}/presign${query}`);
const parseUrl = (url) => { const u = new URL(url); return { host: u.host, pathname: u.pathname, params: Object.fromEntries(u.searchParams) }; };

// ---------------------------------------------------------------------------
// 1. SigV4 canonical form — the shipped signer vs an independent signer.
//    The reference below is written from the SigV4 spec with node:crypto;
//    it rebuilds the canonical request FROM THE URL, so a canonical-form
//    drift in the module fails here.
// ---------------------------------------------------------------------------
{
 const NOW = 1_760_000_000_000; // fixed clock
 const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
 const referenceSignature = (url, method, extraHeaderValues) => {
  const u = new URL(url);
  const params = Object.fromEntries(u.searchParams);
  const signature = params["X-Amz-Signature"];
  delete params["X-Amz-Signature"];
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const signedHeaders = params["X-Amz-SignedHeaders"].split(";");
  const values = { host: u.host, ...extraHeaderValues };
  const canonicalHeaders = signedHeaders.map((n) => `${n}:${values[n]}\n`).join("");
  const canonicalRequest = [method, u.pathname, canonicalQuery, canonicalHeaders, params["X-Amz-SignedHeaders"], "UNSIGNED-PAYLOAD"].join("\n");
  const [keyId, date, region, service] = params["X-Amz-Credential"].split("/");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", params["X-Amz-Date"], scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = createHmac("sha256", `AWS4${CREDS.ASSET_S3_SECRET_ACCESS_KEY}`).update(date).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  return { expected: createHmac("sha256", kSigning).update(stringToSign).digest("hex"), signature, keyId, region, service };
 };
 const creds = { accountId: CREDS.ASSET_ACCOUNT_ID, accessKeyId: CREDS.ASSET_S3_ACCESS_KEY_ID, secretAccessKey: CREDS.ASSET_S3_SECRET_ACCESS_KEY };

 const putUrl = await presignPutUrl(creds, { bucket: BUCKET, key: SHA, expiresInSeconds: 300, now: NOW, contentType: "application/octet-stream" });
 const put = parseUrl(putUrl);
 const putRef = referenceSignature(putUrl, "PUT", { "content-type": "application/octet-stream" });
 check("1 PUT signature matches the independent implementation", putRef.signature === putRef.expected, `got ${putRef.signature} want ${putRef.expected}`);
 check("1 the signed scope is <keyId>/<date>/auto/s3/aws4_request", putRef.keyId === CREDS.ASSET_S3_ACCESS_KEY_ID && putRef.region === "auto" && putRef.service === "s3");
 check("1 the canonical date is the injected clock (2025-10-09T08:53:20Z)", put.params["X-Amz-Date"] === "20251009T085320Z", put.params["X-Amz-Date"]);
 check("1 the URL is path-style on the r2 S3 host", put.host === S3_HOST && put.pathname === `/${BUCKET}/${SHA}`, `${put.host}${put.pathname}`);
 check("1 content-type is in the signed headers", (put.params["X-Amz-SignedHeaders"] ?? "").includes("content-type"), put.params["X-Amz-SignedHeaders"]);

 // A special-character uploadId must survive the strict encoder (a
 // naive encodeURIComponent-based canonical query would drift here).
 const partUrl = await presignPutUrl(creds, { bucket: BUCKET, key: SHA, expiresInSeconds: 300, now: NOW, partNumber: 7, uploadId: "up/with+special=chars" });
 const part = parseUrl(partUrl);
 const partRef = referenceSignature(partUrl, "PUT", {});
 check("1 a part URL (special-char uploadId) verifies independently", partRef.signature === partRef.expected, `got ${partRef.signature}`);
 check("1 the part URL carries the signed partNumber + uploadId", part.params["partNumber"] === "7" && part.params["uploadId"] === "up/with+special=chars", J({ part: part.params["partNumber"], uploadId: part.params["uploadId"] }));

 // Sensitivity controls: the signature is a function of its inputs.
 const otherKey = await presignPutUrl(creds, { bucket: BUCKET, key: "b".repeat(64), expiresInSeconds: 300, now: NOW, contentType: "application/octet-stream" });
 const otherExpiry = await presignPutUrl(creds, { bucket: BUCKET, key: SHA, expiresInSeconds: 301, now: NOW, contentType: "application/octet-stream" });
 const otherClock = await presignPutUrl(creds, { bucket: BUCKET, key: SHA, expiresInSeconds: 300, now: NOW + 1000, contentType: "application/octet-stream" });
 check("1 the key is signed (change the key -> change the signature)", parseUrl(otherKey).params["X-Amz-Signature"] !== put.params["X-Amz-Signature"]);
 check("1 the expiry is signed", parseUrl(otherExpiry).params["X-Amz-Signature"] !== put.params["X-Amz-Signature"]);
 check("1 the timestamp is signed", parseUrl(otherClock).params["X-Amz-Signature"] !== put.params["X-Amz-Signature"]);
}

// ---------------------------------------------------------------------------
// 2. Single-part grant — one presigned PUT, zero control frames.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport();
 const env = envFor();
 const { result } = await withTransport(transport, () => grant({ size: MIB, contentType: "image/png" }, env));
 check("2 single-part grant -> 200", result.status === 200 && result.body?.ok === true, `${result.status} ${J(result.body)}`);
 check("2 mode is single", result.body?.upload?.mode === "single", J(result.body?.upload?.mode));
 check("2 the key is the content-addressed sha256 and path is echoed", result.body?.key === SHA && result.body?.path === POINTER_PATH, J({ key: result.body?.key, path: result.body?.path }));
 check("2 the grant minted ZERO control frames (no Create for one part)", frames.length === 0, J(frames.map((f) => f.rawQuery)));
 const url = parseUrl(result.body?.upload?.url ?? "");
 check("2 the PUT targets the bucket's S3 endpoint (data plane), never the worker", url.host === S3_HOST && !url.host.includes("nextgit.invalid"), url.host);
 check("2 the PUT url signs the declared content-type", (url.params["X-Amz-SignedHeaders"] ?? "").includes("content-type"), url.params["X-Amz-SignedHeaders"]);
 check("2 the grant declares the default expiry", result.body?.upload?.expiresIn === DEFAULT_PRESIGN_EXPIRY_SECONDS && typeof result.body?.upload?.expiresAt === "string", J({ expiresIn: result.body?.upload?.expiresIn }));
 check("2 the response is JSON", result.contentType.includes("application/json"), result.contentType);
}

// ---------------------------------------------------------------------------
// 3. Part plan — the count math, the 10,000 clamp, and the bounds.
// ---------------------------------------------------------------------------
{
 const three = planUpload(THREE_GIB);
 check("3 3 GiB plans to multipart at the 64 MiB default (48 parts)", three.mode === "multipart" && three.partCount === 48 && three.partSize === 64 * MIB, J(three));
 const small = planUpload(MIB);
 check("3 a size that fits one part plans single", small.mode === "single" && small.partCount === 1, J(small));
 const explicit = planUpload(THREE_GIB, 5 * MIB);
 check("3 an explicit 5 MiB part size plans ceil(size/part)", explicit.mode === "multipart" && explicit.partCount === 615 && explicit.partSize === 5 * MIB, J(explicit));
 const clamped = planUpload(R2_MAX_OBJECT_BYTES, 5 * MIB);
 check("3 the 5 TiB worst case clamps to exactly 10,000 parts", clamped.partCount === MAX_MULTIPART_PARTS, J(clamped));
 check("3 the clamp GROWS the part size (5 MiB -> ~524 MiB) and stays in range", clamped.partSize > 5 * MIB && clamped.partSize <= 5 * GIB, J(clamped));
 check("3 the clamp is a fixed point (re-planning yields the same count)", planUpload(R2_MAX_OBJECT_BYTES, clamped.partSize).partCount === MAX_MULTIPART_PARTS);
 check("3 clamped.effective covers the whole object", clamped.partSize * clamped.partCount >= R2_MAX_OBJECT_BYTES);

 const tooSmall = await grant({ partSize: MIB });
 check("3 a partSize below the S3 minimum -> 400 (never silently clamped)", tooSmall.status === 400, `${tooSmall.status} ${J(tooSmall.body)}`);
 const tooBig = await grant({ partSize: 6 * GIB });
 check("3 a partSize above the S3 maximum -> 400", tooBig.status === 400, `${tooBig.status}`);
 const nonInteger = await grant({ partSize: 1.5 * MIB });
 check("3 a non-integer partSize -> 400", nonInteger.status === 400, `${nonInteger.status}`);
}

// ---------------------------------------------------------------------------
// 4. Grant shape — closed schema, field guards, allowlist, CSRF, no reads.
// ---------------------------------------------------------------------------
{
 const env = envFor();
 const unknown = await drive(env, "POST", "/asset/uploads", { body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB, extra: 1 } });
 check("4 an unknown body key -> 400 bad-request", unknown.status === 400 && unknown.body?.error === "bad-request", `${unknown.status} ${J(unknown.body)}`);

 const full = { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB };
 const cases = [
  ["missing repo", { repo: undefined }, 400],
  ["bad repo charset", { repo: "not a repo" }, 400],
  ["missing path", { path: undefined }, 400],
  ["a non-pointer path", { path: "src/hero.png" }, 400],
  ["a traversing path", { path: "assets/../hero.asset.json" }, 400],
  ["a leading-slash path", { path: "/assets/hero.asset.json" }, 400],
  ["a short sha256", { sha256: "abc" }, 400],
  ["an uppercase sha256", { sha256: "A".repeat(64) }, 400],
  ["a negative size", { size: -1 }, 400],
  ["a fractional size", { size: 1.5 }, 400],
  ["a size beyond 5 TiB", { size: R2_MAX_OBJECT_BYTES + 1 }, 400],
  ["an empty contentType", { contentType: "" }, 400],
  ["a CRLF contentType", { contentType: "image/png\r\nx: y" }, 400],
 ];
 for (const [name, override, status] of cases) {
  // JSON.stringify drops an undefined value, so an override of
  // `undefined` is a genuinely absent key (the closed-schema probe).
  const r = await drive(env, "POST", "/asset/uploads", { body: { ...full, ...override } });
  check(`4 ${name} -> ${status}`, r.status === status, `${r.status} ${J(r.body)}`);
 }

 // The allowlist runs BEFORE any mint: a non-demo repo gets no URL.
 const seen = { reads: 0 };
 const { frames, transport } = makeTransport();
 const denied = await withTransport(transport, () => drive(envFor({ seen }), "POST", "/asset/uploads", { body: { repo: "notdemo-xyz", path: POINTER_PATH, sha256: SHA, size: MIB } }));
 check("4 a non-allowlisted repo -> 403 repo-not-allowed", denied.result.status === 403 && denied.result.body?.error === "repo-not-allowed", `${denied.result.status} ${J(denied.result.body)}`);
 check("4 the allowlist denial mints ZERO urls (zero transport frames)", frames.length === 0, J(frames.length));
 check("4 the denial body carries no url", !denied.result.text.includes("X-Amz-Signature") && !denied.result.text.includes("https://"), denied.result.text.slice(0, 120));

 // CSRF: a cookie-carrying POST is refused by the dispatcher gate.
 const csrf = await drive(envFor(), "POST", "/asset/uploads", { body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB }, headers: { Cookie: "identity=op" } });
 check("4 a cookie-carrying grant -> 403 csrf-required (dispatcher gate)", csrf.status === 403 && csrf.body?.error === "csrf-required", `${csrf.status} ${J(csrf.body)}`);
 const csrfComplete = await drive(envFor(), "POST", `/asset/uploads/${UPLOAD_ID}/complete`, { body: { repo: "agent-1", sha256: SHA, parts: [{ partNumber: 1, etag: "\"a1\"" }] }, headers: { Cookie: "identity=op" } });
 check("4 a cookie-carrying complete -> 403 csrf-required", csrfComplete.status === 403 && csrfComplete.body?.error === "csrf-required", `${csrfComplete.status}`);

 // The routes are repo-state-free.
 const { frames: f2, transport: t2 } = makeTransport();
 const reused = envFor({ seen });
 await withTransport(t2, async () => {
  await grant({ size: MIB }, reused);
  await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts: [{ partNumber: 1, etag: "\"a1\"" }] }, reused);
  await presign(SHA, "", reused);
 });
 check("4 the transfer routes make ZERO Artifacts reads", reused.seen.reads === 0, `${reused.seen.reads} reads`);
 check("4 the single-part grant and the presign minted NOTHING; only the complete sent a control frame", f2.length === 1 && f2[0].method === "POST" && "uploadId" in f2[0].query, J(f2.map((f) => `${f.method} ${f.rawQuery}`)));
}

// ---------------------------------------------------------------------------
// 5. Multipart grant — Create only; parts target the bucket.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport();
 const { result } = await withTransport(transport, () => grant({ size: THREE_GIB }));
 const upload = result.body?.upload ?? {};
 check("5 multipart grant -> 200", result.status === 200 && result.body?.ok === true, `${result.status}`);
 check("5 mode multipart with uploadId, partSize and partCount", upload.mode === "multipart" && upload.uploadId === UPLOAD_ID && upload.partSize === 64 * MIB && upload.partCount === 48, J({ mode: upload.mode, id: upload.uploadId, partSize: upload.partSize, count: upload.partCount }));
 check("5 one part URL per part, ascending from 1", Array.isArray(upload.parts) && upload.parts.length === 48 && upload.parts[0]?.partNumber === 1 && upload.parts[47]?.partNumber === 48, `${upload.parts?.length}`);
 check("5 the Worker issued EXACTLY ONE control frame (the Create)", frames.length === 1 && frames[0].method === "POST" && frames[0].rawQuery === "?uploads=" && frames[0].host === S3_HOST, J(frames.map((f) => `${f.method} ${f.rawQuery}`)));
 check("5 the Create frame carried NO asset bytes", frames[0].body === null || frames[0].body === undefined, J(frames[0].body));
 const first = parseUrl(upload.parts[0].url);
 const last = parseUrl(upload.parts[47].url);
 check("5 every part URL targets the bucket (not the worker)", [first, last].every((u) => u.host === S3_HOST), `${first.host} ${last.host}`);
 check("5 every part URL carries its signed partNumber + uploadId", first.params["partNumber"] === "1" && last.params["partNumber"] === "48" && first.params["uploadId"] === UPLOAD_ID, J({ p1: first.params["partNumber"], p48: last.params["partNumber"] }));
 check("5 the part URL expires with the grant", first.params["X-Amz-Expires"] === String(DEFAULT_PRESIGN_EXPIRY_SECONDS), first.params["X-Amz-Expires"]);
 check("5 the response carries no signature leak beyond the minted urls", Object.keys(upload).sort().join(",") === "expiresAt,expiresIn,mode,partCount,partSize,parts,uploadId", Object.keys(upload).sort().join(","));

 const createFails = makeTransport({ createStatus: 500 });
 const init = await withTransport(createFails.transport, () => grant({ size: THREE_GIB }));
 check("5 a failed Create -> 502 upload-init-failed (never a 500)", init.result.status === 502 && init.result.body?.error === "upload-init-failed", `${init.result.status} ${J(init.result.body)}`);
 check("5 the 502 detail carries the S3 status only", init.result.body?.detail === "s3 status 500", J(init.result.body?.detail));
 const unreachable = makeTransport({ throwOnCall: true });
 const netDown = await withTransport(unreachable.transport, () => grant({ size: THREE_GIB }));
 check("5 an unreachable S3 -> 502 s3 unreachable (never a 500)", netDown.result.status === 502 && netDown.result.body?.detail === "s3 unreachable", `${netDown.result.status} ${J(netDown.result.body)}`);
}

// ---------------------------------------------------------------------------
// 6. Complete — happy path; the size is MEASURED, never the client's word.
// ---------------------------------------------------------------------------
{
 const parts = Array.from({ length: 48 }, (_, i) => ({ partNumber: i + 1, etag: `"${String(i + 1).padStart(32, "0")}"` }));
 const { frames, transport } = makeTransport();
 const { result, logs } = await withTransport(transport, () => complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts }));
 check("6 complete -> 200", result.status === 200 && result.body?.ok === true, `${result.status} ${J(result.body)}`);
 check("6 the composite etag is reported", result.body?.etag === COMPLETE_ETAG, J(result.body?.etag));
 check("6 the key is re-derived from the body's sha256", result.body?.key === SHA, J(result.body?.key));
 check("6 the size is MEASURED from the bucket, not declared", result.body?.size === STORED_SIZE, J(result.body?.size));
 check("6 exactly one Complete control frame", frames.length === 1 && frames[0].method === "POST" && frames[0].query.uploadId === UPLOAD_ID, J(frames.map((f) => f.rawQuery)));
 check("6 the Complete body is the S3 XML for those parts", typeof frames[0].body === "string" && frames[0].body.startsWith("<CompleteMultipartUpload>") && frames[0].body.includes("<PartNumber>48</PartNumber>") && frames[0].body.endsWith("</CompleteMultipartUpload>"), String(frames[0].body).slice(0, 80));
 check("6 the Complete frame is tiny (a control frame, not payload)", frames[0].bodyBytes > 0 && frames[0].bodyBytes < 8192, `${frames[0].bodyBytes} bytes`);

 // A client that declares a size it does not own cannot influence the
 // reported size (an extra key is a closed-schema 400, so the measured
 // value is the only source).
 const lying = await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, size: 1, parts });
 check("6 a declared size is a closed-schema 400 (the measured value is the only source)", lying.status === 400, `${lying.status} ${J(lying.body)}`);

 const tierless = makeTransport();
 const noTier = await withTransport(tierless.transport, () => complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts }, envFor({ r2: false })));
 check("6 with the tier unreadable the size is null (typed-null law, never a guess)", noTier.result.status === 200 && noTier.result.body?.size === null, `${noTier.result.status} ${J(noTier.result.body)}`);
 check("6 the completion log line carries no url and no signature", !logs.join("\n").includes("X-Amz-Signature") && !logs.join("\n").includes("http"), logs.join(" | ").slice(0, 120));
}

// ---------------------------------------------------------------------------
// 7. Complete failures + path discipline + part-list guards.
// ---------------------------------------------------------------------------
{
 const parts = [{ partNumber: 1, etag: "\"a1\"" }];
 const conflict = makeTransport({ completeStatus: 409 });
 const res = await withTransport(conflict.transport, () => complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts }));
 check("7 an S3 409 -> 502 upload-complete-failed (never a 500)", res.result.status === 502 && res.result.body?.error === "upload-complete-failed", `${res.result.status} ${J(res.result.body)}`);
 check("7 the 502 detail carries the S3 status only (no S3 error body)", res.result.body?.detail === "s3 status 409" && !res.result.text.includes("InvalidPart"), J(res.result.body?.detail));

 const wrong = await drive(envFor(), "POST", "/asset/uploads/up-1/ship", { body: { repo: "agent-1", sha256: SHA, parts } });
 check("7 a bad path remainder -> 404 not-found", wrong.status === 404 && wrong.body?.error === "not-found", `${wrong.status} ${J(wrong.body)}`);
 const deep = await drive(envFor(), "POST", "/asset/uploads/a/b/complete", { body: { repo: "agent-1", sha256: SHA, parts } });
 check("7 a nested uploadId -> 404 (never a guess)", deep.status === 404, `${deep.status}`);
 const grantWithRemainder = await drive(envFor(), "POST", "/asset/uploads/extra", { body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB } });
 check("7 the grant prefix refuses a remainder -> 404", grantWithRemainder.status === 404, `${grantWithRemainder.status}`);

 const guards = [
  ["empty parts", { parts: [] }],
  ["parts not an array", { parts: "nope" }],
  ["a part without an etag", { parts: [{ partNumber: 1 }] }],
  ["a descending partNumber", { parts: [{ partNumber: 2, etag: "\"a1\"" }, { partNumber: 1, etag: "\"a2\"" }] }],
  ["a duplicate partNumber", { parts: [{ partNumber: 1, etag: "\"a1\"" }, { partNumber: 1, etag: "\"a2\"" }] }],
  ["partNumber 0", { parts: [{ partNumber: 0, etag: "\"a1\"" }] }],
  ["an XML-injecting etag", { parts: [{ partNumber: 1, etag: "\"a1\"/><Injected>" }] }],
  ["a non-hex etag", { parts: [{ partNumber: 1, etag: "\"zzzz\"" }] }],
  ["an empty etag", { parts: [{ partNumber: 1, etag: "" }] }],
  ["too many parts", { parts: Array.from({ length: MAX_MULTIPART_PARTS + 1 }, (_, i) => ({ partNumber: i + 1, etag: "\"a\"" })) }],
 ];
 for (const [name, override] of guards) {
  const r = await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, ...override });
  check(`7 ${name} -> 400`, r.status === 400, `${r.status} ${J(r.body)}`);
 }
 const notAllowed = await complete(UPLOAD_ID, { repo: "notdemo-xyz", sha256: SHA, parts });
 check("7 complete for a non-allowlisted repo -> 403 (before any S3 call)", notAllowed.status === 403, `${notAllowed.status}`);
}

// ---------------------------------------------------------------------------
// 8. Presign GET — URL shape, expiry handling, the range signature.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport();
 const { result, logs } = await withTransport(transport, () => presign(SHA));
 check("8 presign -> 200", result.status === 200 && result.body?.ok === true, `${result.status} ${J(result.body)}`);
 check("8 the blobId is echoed and range is null", result.body?.blobId === SHA && result.body?.range === null, J({ blobId: result.body?.blobId, range: result.body?.range }));
 check("8 the default expiry is 300s", result.body?.expiresIn === DEFAULT_PRESIGN_EXPIRY_SECONDS && result.body?.expiresAt !== undefined, J(result.body?.expiresIn));
 check("8 PRESIGN MINTS NO CONTROL FRAMES (it is a pure off-binding signature)", frames.length === 0, J(frames.length));
 const url = parseUrl(result.body?.url ?? "");
 check("8 the GET url targets the bucket on the content-addressed key", url.host === S3_HOST && url.pathname === `/${BUCKET}/${SHA}`, `${url.host}${url.pathname}`);
 check("8 the GET is signed as GET with the requested expiry", url.params["X-Amz-Expires"] === "300" && (url.params["X-Amz-SignedHeaders"] ?? "") === "host", J({ exp: url.params["X-Amz-Expires"], sh: url.params["X-Amz-SignedHeaders"] }));
 check("8 the presign log line carries no url and no signature", !logs.join("\n").includes("X-Amz-Signature") && !logs.join("\n").includes("http"), logs.join(" | ").slice(0, 120));

 const expired = await presign(SHA, "?expires=42");
 check("8 a small expiry is honoured", expired.body?.expiresIn === 42 && parseUrl(expired.body?.url ?? "").params["X-Amz-Expires"] === "42", J(expired.body?.expiresIn));
 const floored = await presign(SHA, "?expires=0");
 check("8 expires=0 -> 400 (a non-positive lifetime is a shape violation)", floored.status === 400, `${floored.status}`);
 const capped = await presign(SHA, `?expires=${MAX_PRESIGN_EXPIRY_SECONDS * 10}`);
 check("8 an over-cap expiry is clamped to the 7-day hard cap", capped.body?.expiresIn === MAX_PRESIGN_EXPIRY_SECONDS, J(capped.body?.expiresIn));
 const clampUnit = clampPresignExpiry(0) === MIN_PRESIGN_EXPIRY_SECONDS && clampPresignExpiry(MAX_PRESIGN_EXPIRY_SECONDS + 1) === MAX_PRESIGN_EXPIRY_SECONDS;
 check("8 the clamp helper floors and caps", clampUnit);
 const garbage = await presign(SHA, "?expires=abc");
 check("8 expires=abc -> 400 (never silently rounded)", garbage.status === 400, `${garbage.status}`);
 const fractional = await presign(SHA, "?expires=1.5");
 check("8 a fractional expiry -> 400", fractional.status === 400, `${fractional.status}`);

 const badBlob = await presign("not-a-key");
 check("8 a non-64-hex blobId -> 400", badBlob.status === 400, `${badBlob.status}`);

 const ranged = await presign(SHA, "?range=bytes%3D0-1023");
 check("8 a range request -> 200 with the range echoed", ranged.status === 200 && ranged.body?.range === "bytes=0-1023", `${ranged.status} ${J(ranged.body?.range)}`);
 const rangedUrl = parseUrl(ranged.body?.url ?? "");
 check("8 the range is in the SIGNED headers (tamper-evident)", (rangedUrl.params["X-Amz-SignedHeaders"] ?? "").split(";").includes("range"), rangedUrl.params["X-Amz-SignedHeaders"]);
 check("8 a different range yields a different signature", parseUrl((await presign(SHA, "?range=bytes%3D0-2047")).body?.url ?? "").params["X-Amz-Signature"] !== rangedUrl.params["X-Amz-Signature"]);
 const suffixRange = await presign(SHA, "?range=bytes%3D-1024");
 check("8 a suffix range is accepted", (parseUrl(suffixRange.body?.url ?? "").params["X-Amz-SignedHeaders"] ?? "").includes("range"), suffixRange.status);
 for (const bad of ["bytes=abc", "items=0-1", "bytes=0-1,3-4", "bytes=0-1%0AInjected:1"]) {
  const r = await presign(SHA, `?range=${bad}`);
  check(`8 malformed range ${J(bad)} -> 400`, r.status === 400, `${r.status}`);
 }
}

// ---------------------------------------------------------------------------
// 9. Rate limits — the cap comes from the table, read dynamically.
// ---------------------------------------------------------------------------
{
 const limit = ROUTE_RATE_LIMITS["/asset-uploads:write"]?.limit ?? 0;
 check("9 the grant/complete share the /asset-uploads:write write class at 20/60s", limit === 20 && ROUTE_RATE_LIMITS["/asset-uploads:write"]?.windowMs === 60_000, J(ROUTE_RATE_LIMITS["/asset-uploads:write"]));
 check("9 the presign row is 60/60s", ROUTE_RATE_LIMITS["/asset/presign"]?.limit === 60, J(ROUTE_RATE_LIMITS["/asset/presign"]));

 const { frames, transport } = makeTransport();
 const env = envFor();
 const statuses = [];
 let last = null;
 await withTransport(transport, async () => {
  for (let i = 0; i <= limit; i++) {
   const r = await drive(env, "POST", "/asset/uploads", { body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB }, headers: { "CF-Connecting-IP": "10.77.0.1" } });
   statuses.push(r.status);
   last = r;
  }
 });
 check(`9 the first ${limit} grants -> 200`, statuses.slice(0, limit).every((s) => s === 200), J(statuses));
 check(`9 grant ${limit + 1} (one past the cap) -> 429 rate-limited`, statuses[limit] === 429 && last.body?.error === "rate-limited", `${statuses[limit]} ${J(last.body)}`);
 const other = await drive(env, "POST", "/asset/uploads", { body: { repo: "agent-1", path: POINTER_PATH, sha256: SHA, size: MIB }, headers: { "CF-Connecting-IP": "10.77.0.2" } });
 check("9 a different caller is unaffected", other.status === 200, `${other.status}`);
 const presignBurst = await drive(env, "GET", `/asset/${SHA}/presign`, { headers: { "CF-Connecting-IP": "10.77.0.1" } });
 check("9 the exhausted write class does not touch the presign budget", presignBurst.status === 200, `${presignBurst.status}`);
}

// ---------------------------------------------------------------------------
// 10. Deny mode — 401 before ANY mint (the dispatcher's authorize()).
// ---------------------------------------------------------------------------
{
 const deny = envFor({ authMode: "deny" });
 const { frames, transport } = makeTransport({ throwOnCall: true });
 const out = await withTransport(transport, async () => {
  const g = await grant({ size: THREE_GIB }, deny);
  const c = await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts: [{ partNumber: 1, etag: "\"a1\"" }] }, deny);
  const p = await presign(SHA, "?range=bytes%3D0-1023", deny);
  return { g, c, p };
 });
 check("10 deny mode grant -> 401 unauthorized", out.result.g.status === 401 && out.result.g.body?.error === "unauthorized", `${out.result.g.status}`);
 check("10 deny mode complete -> 401", out.result.c.status === 401, `${out.result.c.status}`);
 check("10 deny mode presign -> 401", out.result.p.status === 401, `${out.result.p.status}`);
 check("10 deny mode mints nothing: ZERO S3 calls reached the transport", frames.length === 0, J(frames.length));
 check("10 deny mode reads no repo state", deny.seen.reads === 0, `${deny.seen.reads} reads`);
 check("10 no 401 body carries a url", [out.result.g, out.result.c, out.result.p].every((r) => !r.text.includes("http")), J(out.result.p.text));
}

// ---------------------------------------------------------------------------
// 11. Fail-closed — missing credentials answer 503, never a mint.
// ---------------------------------------------------------------------------
{
 const unprovisioned = envFor({ creds: false });
 const { frames, transport } = makeTransport({ throwOnCall: true });
 const out = await withTransport(transport, async () => ({
  g: await grant({ size: MIB }, unprovisioned),
  c: await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts: [{ partNumber: 1, etag: "\"a1\"" }] }, unprovisioned),
  p: await presign(SHA, "", unprovisioned),
 }));
 for (const [name, r] of [["grant", out.result.g], ["complete", out.result.c], ["presign", out.result.p]]) {
  check(`11 the ${name} answers 503 presign-unavailable without credentials`, r.status === 503 && r.body?.error === "presign-unavailable", `${r.status} ${J(r.body)}`);
 }
 check("11 the unprovisioned routes make ZERO S3 calls", frames.length === 0, J(frames.length));
 check("11 a partially provisioned env still fails closed", (await grant({ size: MIB }, envFor({ creds: false }))).status === 503);
 const oneMissing = { ...envFor(), ASSET_S3_SECRET_ACCESS_KEY: undefined };
 check("11 one missing secret fails closed (no partial credential)", (await grant({ size: MIB }, oneMissing)).status === 503);
}

// ---------------------------------------------------------------------------
// 12. THE 3 GB ACCEPTANCE LEG — no Worker body path.
//    A 3 GB upload: the Worker carries exactly two tiny control frames
//    (Create, Complete); every payload byte is aimed at the presigned
//    bucket URL, whose host is the R2 data plane, never the Worker.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport();
 const env = envFor();
 let grantBody = null;
 let completeBody = null;
 let clientPuts = [];
 await withTransport(transport, async () => {
  const g = await grant({ size: THREE_GIB, contentType: "application/octet-stream" }, env);
  grantBody = g.body;
  const parts = grantBody.upload.parts.map((p) => ({ partNumber: p.partNumber, etag: `"${String(p.partNumber).padStart(32, "0")}"` }));
  // The client uploads DIRECTLY to each presigned part URL: the byte
  // length per part and the TARGET it aims at are recorded here.
  clientPuts = [];
  for (const [index, part] of grantBody.upload.parts.entries()) {
   const target = parseUrl(part.url);
   clientPuts.push({ host: target.host, path: target.pathname, bytes: Math.min(grantBody.upload.partSize, THREE_GIB - index * grantBody.upload.partSize) });
   await fetch(part.url, { method: "PUT", body: "x" }); // the transport stands in for R2
  }
  const c = await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts }, env);
  completeBody = c.body;
 });

 const upload = grantBody?.upload ?? {};
 const totalWired = clientPuts.reduce((sum, p) => sum + p.bytes, 0);
 check("12 the 3 GiB upload plans to 48 parts of 64 MiB", upload.mode === "multipart" && upload.partCount === 48 && upload.partSize === 64 * MIB, J({ mode: upload.mode, count: upload.partCount }));
 check("12 the client's part PUTs account for every one of the 3 GiB", totalWired === THREE_GIB, `${totalWired} of ${THREE_GIB}`);
 check("12 every part PUT targets the bucket's S3 host, never the worker origin", clientPuts.length === 48 && clientPuts.every((p) => p.host === S3_HOST), J([...new Set(clientPuts.map((p) => p.host))]));
 const control = frames.filter((f) => f.method === "POST" && (f.rawQuery === "?uploads=" || "uploadId" in f.query));
 check("12 the Worker sent EXACTLY TWO control frames (Create + Complete)", control.length === 2, J(frames.map((f) => `${f.method} ${f.rawQuery}`)));
 const largest = frames.reduce((max, f) => Math.max(max, f.bodyBytes), 0);
 check("12 no Worker frame carried more than 8 KiB (the 3 GiB never entered the Worker)", largest <= 8192, `largest frame body: ${largest} bytes`);
 check("12 the biggest frame body is the Complete XML, not asset bytes", largest > 0 && largest < THREE_GIB / 1000, `${largest} bytes`);
 check("12 no frame targeted the worker origin", frames.every((f) => f.host === S3_HOST), J([...new Set(frames.map((f) => f.host))]));
 check("12 the complete reported the measured 3 GiB object size", completeBody?.size === STORED_SIZE, J(completeBody?.size));
 check("12 the composite etag came back from S3", completeBody?.etag === COMPLETE_ETAG, J(completeBody?.etag));
 check("12 total bytes the Worker would have to proxy: 0", frames.filter((f) => f.bodyBytes > 8192).length === 0);
}

// ---------------------------------------------------------------------------
// 13. Git-path invariance — the read routes mint nothing.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport({ throwOnCall: true });
 const env = envFor();
 const paths = ["/changes?repo=demo", "/proposals?base=demo&repos=agent-1", "/merge?base=demo&repos=agent-1", "/tree?repo=demo", "/file?repo=demo&path=README.md", "/raw/demo/main/README.md", "/checks?base=demo&repos=agent-1"];
 const statuses = [];
 await withTransport(transport, async () => {
  for (const p of paths) {
   // The ARTIFACTS fake throws, so these answer 500 — the point is
   // that NONE of them minted anything (zero transport frames).
   const r = await drive(env, "GET", p);
   statuses.push(r.status);
  }
 });
 check("13 the git read routes made ZERO S3 calls (no presign, no control frame)", frames.length === 0, J(frames.length));
 check("13 no git read route succeeded silently (the throwing repo fake surfaced as 500/404)", statuses.every((s) => s !== 200), J(statuses));
}

// ---------------------------------------------------------------------------
// 14. No URL egress in logs + the 405 law that forced the dynamic
//     registration of the upload routes.
// ---------------------------------------------------------------------------
{
 const { transport } = makeTransport();
 const env = envFor();
 const { logs } = await withTransport(transport, async () => {
  await grant({ size: THREE_GIB }, env);
  await presign(SHA, "?range=bytes%3D0-1023", env);
  await complete(UPLOAD_ID, { repo: "agent-1", sha256: SHA, parts: [{ partNumber: 1, etag: "\"a1\"" }] }, env);
 });
 const logText = logs.join("\n");
 check("14 no log line carries a presigned URL or a signature", !logText.includes("X-Amz-Signature") && !logText.includes("http"), logText.slice(0, 160));
 check("14 the logs ARE content-free evidence (key + counts only)", logText.includes("asset-upload-grant") && logText.includes("asset-presign") && logText.includes(SHA), logText.slice(0, 160));

 // The registration shape: both upload routes are DYNAMIC prefixes. A
 // static "POST /asset/uploads" would claim the path, so "GET
 // /asset/uploads" would fall to the "/asset/" GET prefix (a 400) and
 // the API boundary's 405 would be unreachable — the route-discipline
 // 405 law.
 const dynamicPrefixes = DYNAMIC_ROUTES.map((r) => r.prefix);
 check("14 the complete prefix is registered before the grant prefix", dynamicPrefixes.indexOf("/asset/uploads/") === dynamicPrefixes.indexOf("/asset/uploads") - 1, J(dynamicPrefixes));
 check("14 neither upload route is a static ROUTES entry", !ROUTES.some((r) => r.path.startsWith("/asset/uploads")), J(ROUTES.filter((r) => r.path.startsWith("/asset")).map((r) => r.path)));
 const wrongMethod = await drive(envFor({ authMode: undefined }), "GET", "/asset/uploads");
 check("14 GET /asset/uploads keeps the /asset/ GET route's 400 (the 405 law is intact for other methods)", wrongMethod.status === 400, `${wrongMethod.status}`);
 const deleted = await drive(envFor({ authMode: undefined }), "DELETE", "/asset/uploads");
 check("14 DELETE /asset/uploads -> 405 method-not-allowed (the API boundary)", deleted.status === 405 && deleted.body?.error === "method-not-allowed", `${deleted.status} ${J(deleted.body)}`);
 const deletedComplete = await drive(envFor({ authMode: undefined }), "DELETE", `/asset/uploads/${UPLOAD_ID}/complete`);
 check("14 DELETE .../complete -> 405", deletedComplete.status === 405, `${deletedComplete.status}`);
 const putAsset = await drive(envFor({ authMode: undefined }), "PUT", SHA === "" ? "/" : `/asset/${SHA}`);
 check("14 an unregistered method on the download route -> 405", putAsset.status === 405, `${putAsset.status}`);
}

// ---------------------------------------------------------------------------
// 15. abortMultipartSession — a real signed DELETE, best-effort.
// ---------------------------------------------------------------------------
{
 const { frames, transport } = makeTransport();
 const creds = { accountId: CREDS.ASSET_ACCOUNT_ID, accessKeyId: CREDS.ASSET_S3_ACCESS_KEY_ID, secretAccessKey: CREDS.ASSET_S3_SECRET_ACCESS_KEY };
 await withTransport(transport, () => abortMultipartSession(creds, { bucket: BUCKET, key: SHA, uploadId: UPLOAD_ID }));
 check("15 abort sends one signed DELETE with the uploadId", frames.length === 1 && frames[0].method === "DELETE" && frames[0].query.uploadId === UPLOAD_ID, J(frames.map((f) => `${f.method} ${f.rawQuery}`)));
 const failing = makeTransport({ throwOnCall: true });
 let threw = false;
 await withTransport(failing.transport, async () => {
  try { await abortMultipartSession(creds, { bucket: BUCKET, key: SHA, uploadId: UPLOAD_ID }); } catch { threw = true; }
 });
 check("15 an abort failure is swallowed (best-effort cleanup)", threw === false);
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
