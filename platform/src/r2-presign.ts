// nextgit-platform — in-house AWS SigV4 presigning + the multipart
// control plane for the R2 asset bucket
// (nextgit-serve-blobs-via-presigned-direct-to-r2-transfers).
//
// WHY IN-HOUSE: the Workers R2 binding carries NO presign method
// (worker-configuration.d.ts: head/get/put/delete/list/
// createMultipartUpload/resumeMultipartUpload only) and AWS SDK v3 does
// not run in Workers (documented DOMParser failure). Presigned URLs are
// minted OFF-binding with an S3 API token via AWS SigV4 — "no
// communication with R2, only credentials + SigV4" (R2 docs). WebCrypto
// HMAC-SHA256 only, no new dependency.
//
// CONTROL PLANE vs DATA PLANE — the Worker never carries asset bytes:
//   - Uploads: the client PUTs bytes DIRECTLY to the presigned bucket URL
//     (single-part) or to per-part presigned PUTs (multipart). The Worker
//     issues only CreateMultipartUpload / CompleteMultipartUpload /
//     AbortMultipartUpload control frames over the S3 API.
//   - Downloads: the client GETs bytes DIRECTLY from the presigned bucket
//     URL; an optional `Range` header folds into the SigV4 signed-headers
//     set (so the byte range is tamper-evident, not free-floating).
//
// URL SHAPE: path-style — `https://<accountId>.r2.cloudflarestorage.com/
// <bucket>/<key>` (the R2 S3 endpoint form the R2 presigned-URL docs
// show). The canonical URI therefore carries the bucket as its first
// segment, and the canonical form of both sides is derived from the SAME
// encoder so the signed request and the emitted URL cannot drift.
//
// SECURITY: presigned URLs are bearer tokens — credential-adjacent. They
// are minted at request time, NEVER stored (the assets.ts no-URL-egress
// law: not in pointers, not in events), never logged, and carry a short
// default expiry (300 s) inside a hard cap (604800 s = 7 d) and floor
// (1 s). Credentials (ASSET_S3_ACCESS_KEY_ID / ASSET_S3_SECRET_ACCESS_KEY
// wrangler secrets) are injected via env; their absence fails closed
// (resolvePresignCredentials returns null — the caller answers 503, never
// a silent empty-string credential).

/** The R2 S3 API region — R2's fixed SigV4 region name. */
export const R2_SIGV4_REGION = "auto";

/** The S3 service name in the SigV4 scope. */
export const R2_SIGV4_SERVICE = "s3";

/** SigV4 algorithm identifier (the X-Amz-Algorithm value). */
export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";

/** Default presigned-URL lifetime: 300 s (STM T1/T3: short by default). */
export const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;

/** Floor on a presigned-URL lifetime: 1 s (R2's documented minimum). */
export const MIN_PRESIGN_EXPIRY_SECONDS = 1;

/** Hard cap on a presigned-URL lifetime: 7 days (R2's documented maximum). */
export const MAX_PRESIGN_EXPIRY_SECONDS = 604800;

/** The R2 single-part object ceiling: 5 GiB (a larger object MUST multipart). */
export const R2_SINGLE_PART_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** The R2 object ceiling: 5 TiB. */
export const R2_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024;

/** S3/R2 multipart minimum part size: 5 MiB (the FINAL part is exempt). */
export const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;

/** S3/R2 multipart maximum part size: 5 GiB. */
export const MAX_MULTIPART_PART_BYTES = 5 * 1024 * 1024 * 1024;

/** Default part size: 64 MiB (a 3 GiB object -> 48 parts). */
export const DEFAULT_MULTIPART_PART_BYTES = 64 * 1024 * 1024;

/** S3 multipart hard ceiling: 10,000 parts per upload. */
export const MAX_MULTIPART_PARTS = 10_000;

/**
 * Off-binding SigV4 credentials. Injected via env: the account id rides
 * the ASSET_ACCOUNT_ID var; the key pair rides the
 * ASSET_S3_ACCESS_KEY_ID / ASSET_S3_SECRET_ACCESS_KEY wrangler secrets.
 */
export interface PresignCredentials {
 accountId: string;
 accessKeyId: string;
 secretAccessKey: string;
}

/** The upload plan for one declared object size (pure, derived). */
export interface UploadPlan {
 mode: "single" | "multipart";
 /** The byte size of every part (single mode: the whole object). */
 partSize: number;
 /** The number of parts (single mode: 1). */
 partCount: number;
}

/** One presigned per-part PUT target. */
export interface PresignedPart {
 partNumber: number;
 url: string;
}

/**
 * An S3 control-plane failure (Create/Complete/Abort). `status` is the
 * S3 HTTP status ONLY — never a response body, URL, or credential (the
 * caller maps it to the contract's 502 shape).
 */
export class S3ControlError extends Error {
 readonly status: number;

 constructor(operation: string, status: number) {
  super(`${operation} failed with s3 status ${status}`);
  this.name = "S3ControlError";
  this.status = status;
 }
}

/**
 * Resolve credentials from the worker env. Fail closed: ANY missing value
 * returns null (the caller maps null -> 503 presign-unavailable — never a
 * silent empty-string credential).
 */
export function resolvePresignCredentials(env: {
 ASSET_ACCOUNT_ID?: string;
 ASSET_S3_ACCESS_KEY_ID?: string;
 ASSET_S3_SECRET_ACCESS_KEY?: string;
}): PresignCredentials | null {
 const accountId = env.ASSET_ACCOUNT_ID;
 const accessKeyId = env.ASSET_S3_ACCESS_KEY_ID;
 const secretAccessKey = env.ASSET_S3_SECRET_ACCESS_KEY;
 if (!accountId || !accessKeyId || !secretAccessKey) return null;
 return { accountId, accessKeyId, secretAccessKey };
}

/** The R2 S3 API endpoint for an account. */
export function r2Endpoint(accountId: string): string {
 return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Clamp a requested presign lifetime into [MIN, MAX]. Pure.
 */
export function clampPresignExpiry(seconds: number): number {
 if (seconds < MIN_PRESIGN_EXPIRY_SECONDS) return MIN_PRESIGN_EXPIRY_SECONDS;
 if (seconds > MAX_PRESIGN_EXPIRY_SECONDS) return MAX_PRESIGN_EXPIRY_SECONDS;
 return seconds;
}

/**
 * Parse the `?expires=` query value into a clamped lifetime, or null when
 * the value is not a positive integer (the caller answers 400 — a
 * malformed requested lifetime is a shape violation, never silently
 * rounded). Absent (null) -> the default.
 */
export function parsePresignExpiry(raw: string | null): number | null {
 if (raw === null) return DEFAULT_PRESIGN_EXPIRY_SECONDS;
 const seconds = Number(raw);
 if (!Number.isInteger(seconds) || seconds <= 0) return null;
 return clampPresignExpiry(seconds);
}

/**
 * Plan an upload for a declared object size (pure, derived — never
 * hand-added counts). A size that fits one part is single-part; anything
 * larger is multipart. The part count is clamped to MAX_MULTIPART_PARTS
 * by GROWING the part size (a 5 TiB object at the 5 MiB minimum would
 * otherwise need 1,048,576 parts), and the grown size stays inside
 * [MIN, MAX].
 */
export function planUpload(size: number, requestedPartSize?: number): UploadPlan {
 const partSize = Math.min(
  Math.max(requestedPartSize ?? DEFAULT_MULTIPART_PART_BYTES, MIN_MULTIPART_PART_BYTES),
  MAX_MULTIPART_PART_BYTES,
 );
 if (size <= partSize) return { mode: "single", partSize: size, partCount: 1 };
 let effective = partSize;
 let partCount = Math.ceil(size / effective);
 if (partCount > MAX_MULTIPART_PARTS) {
  effective = Math.ceil(size / MAX_MULTIPART_PARTS);
  partCount = Math.ceil(size / effective);
 }
 return { mode: "multipart", partSize: effective, partCount };
}

// ---------------------------------------------------------------------------
// SigV4 core (WebCrypto only).
// ---------------------------------------------------------------------------

/**
 * The strict RFC-3986 segment encoder SigV4 requires: everything outside
 * the unreserved set is percent-encoded with UPPERCASE hex. (Not
 * `encodeURIComponent`, which leaves `!()*'` literal — a divergence that
 * silently breaks the signature for those bytes.)
 */
function encodeSegment(value: string): string {
 const bytes = new TextEncoder().encode(value);
 let out = "";
 for (const byte of bytes) {
  const ch = String.fromCharCode(byte);
  out += /^[A-Za-z0-9\-._~]$/.test(ch)
   ? ch
   : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
 }
 return out;
}

/** Lowercase hex of raw bytes (the one byte-to-hex conversion). */
function toHex(buffer: ArrayBuffer): string {
 return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** hex over the exact bytes (WebCrypto digest — the assets.ts idiom). */
async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
 return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** HMAC-SHA256(key, msg) — raw bytes (the SigV4 signing-key chain). */
async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
 const cryptoKey = await crypto.subtle.importKey(
  "raw",
  key,
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
 );
 return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

/**
 * Derive the SigV4 signing key from the secret:
 *   kDate = HMAC("AWS4" + secret, dateStamp)
 *   kRegion = HMAC(kDate, region)
 *   kService = HMAC(kRegion, service)
 *   kSigning = HMAC(kService, "aws4_request")
 */
async function deriveSigningKey(
 secretAccessKey: string,
 dateStamp: string,
 region: string,
 service: string,
): Promise<ArrayBuffer> {
 const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
 const kRegion = await hmac(kDate, region);
 const kService = await hmac(kRegion, service);
 return hmac(kService, "aws4_request");
}

/** The ISO-8601 basic SigV4 timestamp: `YYYYMMDDTHHMMSSZ`. */
function sigv4Timestamp(now: number): { dateTime: string; dateStamp: string } {
 const d = new Date(now);
 const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
 const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
 const dateTime = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
 return { dateTime, dateStamp };
}

/** The canonical URI: `/<bucket>/<key>`, each segment strictly encoded. */
function canonicalUri(bucket: string, key: string): string {
 const bucketSeg = encodeSegment(bucket);
 if (key === "") return `/${bucketSeg}/`;
 return `/${bucketSeg}/${key.split("/").map(encodeSegment).join("/")}`;
}

/** The canonical query string: sorted by key, both sides strictly encoded. */
function canonicalQuery(params: Record<string, string>): string {
 return Object.keys(params)
  .sort()
  .map((k) => `${encodeSegment(k)}=${encodeSegment(params[k] ?? "")}`)
  .join("&");
}

/**
 * The canonical headers block + the signed-headers list. Header names are
 * lowercased and sorted; each line is `name:value\n`; `signedHeaders` is
 * the `;`-joined sorted name list.
 */
function canonicalHeaders(headers: Record<string, string>): { block: string; signedHeaders: string } {
 const names = Object.keys(headers)
  .map((n) => n.toLowerCase())
  .sort();
 const block = names.map((n) => `${n}:${(headers[n] ?? "").trim()}\n`).join("");
 return { block, signedHeaders: names.join(";") };
}

/** The string-to-sign: `ALGORITHM \n dateTime \n scope \n hash(canonical)`. */
async function stringToSign(
 canonicalRequest: string,
 dateTime: string,
 dateStamp: string,
): Promise<string> {
 const scope = `${dateStamp}/${R2_SIGV4_REGION}/${R2_SIGV4_SERVICE}/aws4_request`;
 const hash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
 return [SIGV4_ALGORITHM, dateTime, scope, hash].join("\n");
}

/** Sign one canonical request -> hex signature. */
async function signCanonical(
 secretAccessKey: string,
 dateStamp: string,
 canonicalRequest: string,
 dateTime: string,
): Promise<string> {
 const sts = await stringToSign(canonicalRequest, dateTime, dateStamp);
 const key = await deriveSigningKey(secretAccessKey, dateStamp, R2_SIGV4_REGION, R2_SIGV4_SERVICE);
 return toHex(await hmac(key, sts));
}

/** The X-Amz-Credential scope value for one signed request. */
function credentialScope(accessKeyId: string, dateStamp: string): string {
 return `${accessKeyId}/${dateStamp}/${R2_SIGV4_REGION}/${R2_SIGV4_SERVICE}/aws4_request`;
}

/**
 * Mint a presigned URL for ONE S3 operation (GET/HEAD/PUT/DELETE). The
 * signature covers the canonical request (method, path, query, signed
 * headers, UNSIGNED-PAYLOAD); the emitted URL carries the same canonical
 * query plus the SigV4 auth params, so the URL the client uses IS the
 * request that was signed.
 *
 * `extraHeaders` (e.g. `range` for a ranged download, `content-type` for a
 * typed upload) fold into the signed-headers set: the client MUST send
 * the same header values, which is what makes them tamper-evident.
 * `extraQuery` (e.g. `partNumber`/`uploadId`) rides the signed query.
 */
async function presignUrl(
 creds: PresignCredentials,
 opts: {
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  bucket: string;
  key: string;
  expiresInSeconds: number;
  now: number;
  extraHeaders?: Record<string, string>;
  extraQuery?: Record<string, string>;
 },
): Promise<string> {
 const { dateTime, dateStamp } = sigv4Timestamp(opts.now);
 const host = new URL(r2Endpoint(creds.accountId)).host;
 const headers: Record<string, string> = { host };
 for (const [name, value] of Object.entries(opts.extraHeaders ?? {})) {
  headers[name.toLowerCase()] = value;
 }
 const query: Record<string, string> = {
  "X-Amz-Algorithm": SIGV4_ALGORITHM,
  "X-Amz-Credential": credentialScope(creds.accessKeyId, dateStamp),
  "X-Amz-Date": dateTime,
  "X-Amz-Expires": String(opts.expiresInSeconds),
  ...(opts.extraQuery ?? {}),
 };
 const { block, signedHeaders } = canonicalHeaders(headers);
 query["X-Amz-SignedHeaders"] = signedHeaders;
 const canonicalRequest = [
  opts.method,
  canonicalUri(opts.bucket, opts.key),
  canonicalQuery(query),
  block,
  signedHeaders,
  "UNSIGNED-PAYLOAD",
 ].join("\n");
 query["X-Amz-Signature"] = await signCanonical(
  creds.secretAccessKey,
  dateStamp,
  canonicalRequest,
  dateTime,
 );
 return `${r2Endpoint(creds.accountId)}${canonicalUri(opts.bucket, opts.key)}?${canonicalQuery(query)}`;
}

/**
 * One authorized (non-presigned) S3 API call for the multipart control
 * plane. The payload hash is REAL here (the control body is small and
 * fully known), and `authorization` carries the credential scope.
 */
async function s3ApiRequest(
 creds: PresignCredentials,
 opts: {
  operation: string;
  method: "POST" | "DELETE";
  bucket: string;
  key: string;
  query: Record<string, string>;
  body?: string;
  now: number;
 },
): Promise<Response> {
 const { dateTime, dateStamp } = sigv4Timestamp(opts.now);
 const host = new URL(r2Endpoint(creds.accountId)).host;
 const headers: Record<string, string> = { host };
 if (opts.body !== undefined) headers["content-type"] = "application/xml";
 const payloadHash = await sha256Hex(
  opts.body === undefined ? new Uint8Array(0) : new TextEncoder().encode(opts.body),
 );
 headers["x-amz-content-sha256"] = payloadHash;
 headers["x-amz-date"] = dateTime;
 const { block, signedHeaders } = canonicalHeaders(headers);
 const canonicalRequest = [
  opts.method,
  canonicalUri(opts.bucket, opts.key),
  canonicalQuery(opts.query),
  block,
  signedHeaders,
  payloadHash,
 ].join("\n");
 const signature = await signCanonical(creds.secretAccessKey, dateStamp, canonicalRequest, dateTime);
 const url = `${r2Endpoint(creds.accountId)}${canonicalUri(opts.bucket, opts.key)}?${canonicalQuery(opts.query)}`;
 return await fetch(url, {
  method: opts.method,
  headers: {
   ...headers,
   authorization:
    `${SIGV4_ALGORITHM} Credential=${credentialScope(creds.accessKeyId, dateStamp)}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  },
  body: opts.body,
 });
}

/**
 * Mint a presigned PUT for one object (single-part upload) or one part
 * (multipart upload). A declared `contentType` folds into the signed
 * headers — the client must send that exact `content-type`.
 */
export async function presignPutUrl(
 creds: PresignCredentials,
 opts: {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  now?: number;
  contentType?: string;
  partNumber?: number;
  uploadId?: string;
 },
): Promise<string> {
 const extraHeaders: Record<string, string> = {};
 if (opts.contentType) extraHeaders["content-type"] = opts.contentType;
 const extraQuery: Record<string, string> = {};
 if (opts.partNumber !== undefined && opts.uploadId !== undefined) {
  extraQuery["partNumber"] = String(opts.partNumber);
  extraQuery["uploadId"] = opts.uploadId;
 }
 return await presignUrl(creds, {
  method: "PUT",
  bucket: opts.bucket,
  key: opts.key,
  expiresInSeconds: opts.expiresInSeconds,
  now: opts.now ?? Date.now(),
  extraHeaders,
  extraQuery,
 });
}

/**
 * Mint a presigned GET for one object. A `range` (e.g. `bytes=0-1023`)
 * folds into the signed headers — the client must send that exact
 * `Range` header, so the byte range cannot be swapped after minting.
 */
export async function presignGetUrl(
 creds: PresignCredentials,
 opts: {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  now?: number;
  range?: string;
 },
): Promise<string> {
 const extraHeaders: Record<string, string> = {};
 if (opts.range) extraHeaders["range"] = opts.range;
 return await presignUrl(creds, {
  method: "GET",
  bucket: opts.bucket,
  key: opts.key,
  expiresInSeconds: opts.expiresInSeconds,
  now: opts.now ?? Date.now(),
  extraHeaders,
 });
}

/**
 * Start a client-direct multipart upload (S3 CreateMultipartUpload) and
 * return the S3 `uploadId` — the control-plane handle the per-part
 * presigned PUTs and the Complete call all reference.
 */
export async function createMultipartSession(
 creds: PresignCredentials,
 opts: { bucket: string; key: string; contentType?: string; now?: number },
): Promise<string> {
 const response = await s3ApiRequest(creds, {
  operation: "CreateMultipartUpload",
  method: "POST",
  bucket: opts.bucket,
  key: opts.key,
  query: { uploads: "" },
  now: opts.now ?? Date.now(),
 });
 if (!response.ok) throw new S3ControlError("CreateMultipartUpload", response.status);
 const text = await response.text();
 const match = /<UploadId>([^<]+)<\/UploadId>/.exec(text);
 if (!match?.[1]) throw new S3ControlError("CreateMultipartUpload", response.status);
 return match[1];
}

/**
 * Complete a client-direct multipart upload (S3 CompleteMultipartUpload)
 * from the client-returned `[{partNumber, etag}]` list, and return the
 * composite object ETag. Any S3 failure is an S3ControlError carrying the
 * status only — the caller maps it to a contract 502, never a 500.
 */
export async function completeMultipartSession(
 creds: PresignCredentials,
 opts: {
  bucket: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  now?: number;
 },
): Promise<string> {
 const body = [
  "<CompleteMultipartUpload>",
  ...opts.parts.map(
   (p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`,
  ),
  "</CompleteMultipartUpload>",
 ].join("");
 const response = await s3ApiRequest(creds, {
  operation: "CompleteMultipartUpload",
  method: "POST",
  bucket: opts.bucket,
  key: opts.key,
  query: { uploadId: opts.uploadId },
  body,
  now: opts.now ?? Date.now(),
 });
 if (!response.ok) throw new S3ControlError("CompleteMultipartUpload", response.status);
 const text = await response.text();
 const match = /<ETag>([^<]+)<\/ETag>/.exec(text);
 return match?.[1] ?? "";
}

/**
 * Abort a client-direct multipart upload (S3 AbortMultipartUpload) —
 * best-effort: an abort failure must not fail the caller's error path
 * (the bucket lifecycle rule is the reclamation backstop).
 */
export async function abortMultipartSession(
 creds: PresignCredentials,
 opts: { bucket: string; key: string; uploadId: string; now?: number },
): Promise<void> {
 try {
  await s3ApiRequest(creds, {
   operation: "AbortMultipartUpload",
   method: "DELETE",
   bucket: opts.bucket,
   key: opts.key,
   query: { uploadId: opts.uploadId },
   now: opts.now ?? Date.now(),
  });
 } catch {
  // Best-effort cleanup only.
 }
}
