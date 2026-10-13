#!/usr/bin/env node
// attestation-keygen.mjs — generate the signed-evidence key pair
// (CONTRACT.md §Attestations) and print the provisioning command.
//
// The PRIVATE half is staged in a chmod-600 file (.attest-key.b64)
// and piped to `wrangler secret put EVIDENCE_SIGNING_KEY` — never on
// argv, never in a shell history (the repo's secrets law, NFR-3).
// The PUBLIC half (base64url RAW key) is printed for the
// wrangler.jsonc `vars` block and the CONTRACT.md pin.
//
// Usage: node scripts/attestation-keygen.mjs [--keep]
//   --keep  keep the staging file on exit (default: removed after
//           the command is printed — copy the command first).
//
// Algorithm (ATTEST_ALGO, probe-gated): WebCrypto Ed25519.
//   - EVIDENCE_SIGNING_KEY: base64url(PKCS#8 private key)
//   - EVIDENCE_PUBLIC_KEY:  base64url(RAW public key, 32 bytes)
import { writeFileSync, chmodSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const staging = join(here, "..", ".attest-key.b64");
const keep = process.argv.includes("--keep");

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));

const privateB64url = b64url(pkcs8);
const publicB64url = b64url(rawPub);

writeFileSync(staging, privateB64url, { mode: 0o600 });
try {
  chmodSync(staging, 0o600);
} catch {
  // chmod is a hardening no-op if the platform lacks it; the write
  // mode above already created the file private.
}

const digest = await crypto.subtle.digest("SHA-256", rawPub);
const keyId = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

console.log("Attestation key pair generated (Ed25519).");
console.log("keyId (sha256(raw public key)[0..16]):", keyId);
console.log("");
console.log("1) PUBLIC key — put in platform/wrangler.jsonc vars as EVIDENCE_PUBLIC_KEY");
console.log("   (and pin it in platform/CONTRACT.md §Attestations):");
console.log("");
console.log(`   ${publicB64url}`);
console.log("");
console.log("2) PRIVATE key — staged at platform/.attest-key.b64 (chmod 600).");
console.log("   Provision the Worker secret with the piped command (never argv):");
console.log("");
console.log(`   printf '%s' "$(cat ${staging})" | npx wrangler secret put EVIDENCE_SIGNING_KEY`);
console.log("");
console.log("Both halves must be provisioned together — the envelope's keyId");
console.log("derives from the public var, and a missing public var is the same");
console.log("honest-unavailable condition as a missing secret.");
console.log("");
if (!keep) {
  rmSync(staging);
  console.log("Staging file removed (--keep to retain it).");
} else {
  console.log("Staging file retained (--keep). Remove it after provisioning.");
}
