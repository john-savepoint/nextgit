#!/usr/bin/env bun
// provision-asset-presign.mjs — provision + verify the presigned
// direct-to-R2 transfer credentials
// (nextgit-serve-blobs-via-presigned-direct-to-r2-transfers).
//
// The presign surface signs OFF-binding with AWS SigV4 (the Workers R2
// binding has no presign method), so it needs three operator-provisioned
// values. This script prints that recipe and then DRY-RUN MINTS against
// the configured credentials — no network, no upload, no bucket state —
// proving the signer runs and emits well-formed URLs. `--emit-url` also
// prints one presigned URL (a bearer token: curl it, never save it).
//
// Run: bun platform/scripts/provision-asset-presign.mjs [--emit-url]
//      exit 0 = credentials present + every mint assertion passed
//      exit 2 = provisioning missing (fail closed)
//      exit 1 = a mint assertion failed
//
// It imports the ONE SigV4 implementation (platform/src/r2-presign.ts) —
// a dry-run must exercise the shipped signer, never a second copy of it.

import {
  DEFAULT_PRESIGN_EXPIRY_SECONDS,
  presignGetUrl,
  presignPutUrl,
  resolvePresignCredentials,
} from "../src/r2-presign.ts";

const BUCKET = process.env.R2_BUCKET ?? "nextgit-asset-blobs";
/** An unmistakably-probe key: all-zero hex-64 (a real key is a sha256). */
const PROBE_KEY = "0".repeat(64);
const PROBE_RANGE = "bytes=0-1023";
const EXPIRES = DEFAULT_PRESIGN_EXPIRY_SECONDS;
const REQUIRED = ["ASSET_ACCOUNT_ID", "ASSET_S3_ACCESS_KEY_ID", "ASSET_S3_SECRET_ACCESS_KEY"];

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("usage: bun platform/scripts/provision-asset-presign.mjs [--emit-url]");
  console.log("  --emit-url   also print a minted presigned PUT URL (a bearer token)");
  process.exit(0);
}
const emitUrl = argv.includes("--emit-url");

const RECIPE = `Provision (piped — persists across deploys, keeps the key pair out of git):
  # 1. Create an R2 S3 API token, Object Read & Write on ${BUCKET} only.
  cd platform
  printf '%s' '<account-id>'          | npx wrangler secret put ASSET_ACCOUNT_ID
  printf '%s' '<access-key-id>'       | npx wrangler secret put ASSET_S3_ACCESS_KEY_ID
  printf '%s' '<secret-access-key>'   | npx wrangler secret put ASSET_S3_SECRET_ACCESS_KEY
  npx wrangler deploy
Absent credentials fail every presign route closed (503 presign-unavailable).`;

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`FAIL presign credentials absent: ${missing.join(", ")}`);
  console.error(RECIPE);
  process.exit(2);
}

const creds = resolvePresignCredentials(process.env);
if (creds === null) {
  console.error("FAIL resolvePresignCredentials returned null with all three present");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const now = Date.now();
const putUrl = await presignPutUrl(creds, { bucket: BUCKET, key: PROBE_KEY, expiresInSeconds: EXPIRES, now });
const getUrl = await presignGetUrl(creds, {
  bucket: BUCKET,
  key: PROBE_KEY,
  expiresInSeconds: EXPIRES,
  now,
  range: PROBE_RANGE,
});

const parse = (url) => {
  const parsed = new URL(url);
  const params = Object.fromEntries(parsed.searchParams);
  return { parsed, params };
};
const put = parse(putUrl);
const get = parse(getUrl);
const expectedHost = `${creds.accountId}.r2.cloudflarestorage.com`;
const expectedPath = `/${BUCKET}/${PROBE_KEY}`;
const AMZ_PARAMS = [
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-SignedHeaders",
  "X-Amz-Signature",
];

check("PUT url host is the account's r2 S3 endpoint", put.parsed.host === expectedHost, put.parsed.host);
check("PUT url path is /<bucket>/<key> (path-style)", put.parsed.pathname === expectedPath, put.parsed.pathname);
check("PUT url carries all six X-Amz params", AMZ_PARAMS.every((p) => typeof put.params[p] === "string"));
check("PUT signature is 64 lowercase hex", /^[0-9a-f]{64}$/.test(put.params["X-Amz-Signature"] ?? ""), put.params["X-Amz-Signature"]);
check("PUT credential scope is <accessKeyId>/<date>/auto/s3/aws4_request", (put.params["X-Amz-Credential"] ?? "").startsWith(`${creds.accessKeyId}/`) && (put.params["X-Amz-Credential"] ?? "").endsWith("/auto/s3/aws4_request"), put.params["X-Amz-Credential"]);
check(`PUT expiry is the requested ${EXPIRES}s`, put.params["X-Amz-Expires"] === String(EXPIRES), put.params["X-Amz-Expires"]);
check("GET url signs the range header", (get.params["X-Amz-SignedHeaders"] ?? "").split(";").includes("range"), get.params["X-Amz-SignedHeaders"]);
check("the range changes the signature (it is signed, not free-floating)", put.params["X-Amz-Signature"] !== get.params["X-Amz-Signature"]);

console.log(`mint: host=${put.parsed.host} path=${expectedPath} expires=${EXPIRES}s signedHeaders=${put.params["X-Amz-SignedHeaders"]}`);
if (emitUrl) {
  // Bearer token — operator terminal only; never persisted, never logged.
  console.log(`PUT url (expires in ${EXPIRES}s, bearer — do not save):\n${putUrl}`);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
