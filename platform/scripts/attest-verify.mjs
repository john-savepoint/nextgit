#!/usr/bin/env node
// attest-verify.mjs — the "verifiable later" gate
// (CONTRACT.md §Attestations). Re-derives the canonical
// bytes of a landing's attestation and verifies the
// signature against the pinned public key — from OUTSIDE
// the platform, so a third party needs nothing but the
// public key and the served record.
//
// Usage:
//   node platform/scripts/attest-verify.mjs --commit <sha>
//        [--base <url>] [--public-key <b64url>] [--r2-copy]
//        [--self-test]
//
//   --commit <sha>    the landing commit to verify
//   --base <url>      platform base URL (default: the live
//                     deploy's origin from wrangler.jsonc
//                     consumers' convention — pass explicitly)
//   --public-key      base64url RAW public key override
//                     (default: EVIDENCE_PUBLIC_KEY from
//                     platform/wrangler.jsonc)
//   --r2-copy         also fetch attestations/<commit>.json
//                     from the R2 bucket via the
//                     lockfile-pinned wrangler and assert
//                     deep-equality with the served copy
//                     (the cross-copy tamper leg)
//   --self-test       run the verifier over a deliberately
//                     tampered copy and assert a non-zero
//                     outcome (the egress-guard scanner
//                     precedent: a no-op verifier cannot
//                     green-pass)
//
// Exit codes: 0 = verified, 1 = FAILED (with an honest
// message on stderr), 2 = usage error.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const commit = opt("commit");
const base = opt("base");
const publicKeyOverride = opt("public-key");
const r2Copy = flag("r2-copy");
const selfTest = flag("self-test");

if (!commit && !selfTest) {
  console.error("usage: attest-verify.mjs --commit <sha> [--base <url>] [--public-key <b64url>] [--r2-copy] | --self-test");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Canonicalization — the ONE law (CONTRACT.md §Attestations):
// recursive key sort, code-unit (<) comparison, no whitespace,
// arrays in order. Must byte-match platform/src/attest.ts
// `canonicalize` — the contract publishes it and clients
// recompute it.
// ---------------------------------------------------------------------------
function canonicalize(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return String(value);
    case "object": {
      const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",");
      return `{${body}}`;
    }
    default:
      return "null";
  }
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const rem = normalized.length % 4;
  if (rem === 1) return null;
  const padded = rem === 2 ? `${normalized}==` : rem === 3 ? `${normalized}=` : normalized;
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Pure verifier — mirrors platform/src/attest.ts verifyAttestation (guard set identical, same order). */
async function verify(att, publicKeyB64url) {
  if (att === null || typeof att !== "object" || Array.isArray(att)) return false;
  if (att.status !== "signed") return false;
  if (att.v !== 1) return false;
  if (att.algo !== "Ed25519") return false;
  if (typeof att.keyId !== "string" || att.keyId.length !== 16) return false;
  if (typeof att.at !== "string" || Number.isNaN(Date.parse(att.at))) return false;
  if (typeof att.sig !== "string") return false;
  const subject = att.subject;
  const environment = att.environment;
  const evidence = att.evidence;
  if (subject === null || typeof subject !== "object" || Array.isArray(subject)) return false;
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) return false;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (typeof subject.commit !== "string" || !/^[0-9a-f]{40}$/.test(subject.commit)) return false;
  if (!Array.isArray(subject.repos) || subject.repos.some((r) => typeof r !== "string")) return false;
  // Internal-consistency law: a spliced subject is detectable even when the signature is valid.
  if (subject.commit !== evidence.commit) return false;
  if (JSON.stringify(subject.repos) !== JSON.stringify(evidence.repos)) return false;
  const key = await crypto.subtle
    .importKey("raw", unb64url(publicKeyB64url), { name: "Ed25519" }, false, ["verify"])
    .catch(() => null);
  if (key === null) return false;
  const sigDecoded = unb64url(att.sig);
  if (sigDecoded === null || sigDecoded.length !== 64) return false; // Ed25519 signature is exactly 64 bytes
  const payload = { ...att };
  delete payload.sig;
  const data = new TextEncoder().encode(canonicalize(payload));
  return crypto.subtle.verify("Ed25519", key, sigDecoded, data);
}

/** The pinned public key: the --public-key flag, else the wrangler.jsonc var. */
function pinnedPublicKey() {
  if (publicKeyOverride) return publicKeyOverride;
  const wrangler = JSON.parse(
    readFileSync(join(here, "..", "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
  );
  const value = wrangler.vars?.EVIDENCE_PUBLIC_KEY;
  if (typeof value !== "string" || value.startsWith("<")) {
    console.error("FAIL: EVIDENCE_PUBLIC_KEY is not provisioned in platform/wrangler.jsonc (and no --public-key given)");
    process.exit(1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Self-test leg (the egress-guard scanner precedent): verify a
// deliberately tampered copy and assert the verifier catches it.
// ---------------------------------------------------------------------------
async function runSelfTest() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const publicKey = b64url(rawPub);
  const evidence = {
    repos: ["agent-3"], commit: "a".repeat(40), ancestor: {}, heads: {},
    foldHash: "b".repeat(64), checks: ["node --check"], results: ["pass"],
    mergedSha: "b".repeat(64), testedSha: null, artifactRef: null, at: "2026-10-14T00:00:00.000Z",
  };
  const envelope = {
    status: "signed", v: 1, algo: "Ed25519",
    keyId: b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", rawPub))).slice(0, 16),
    at: "2026-10-14T00:00:00.000Z",
    subject: { commit: evidence.commit, repos: evidence.repos, base: "demo", ref: "main", baseRef: "main" },
    environment: { worker: "nextgit-platform", deploy: null, tag: null, runtime: "workerd" },
    evidence,
  };
  const sig = await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(canonicalize(envelope)));
  const good = { ...envelope, sig: b64url(new Uint8Array(sig)) };

  if (!(await verify(good, publicKey))) {
    console.error("FAIL (self-test): a GOOD bundle did not verify — the verifier is broken");
    process.exit(1);
  }
  // Tamper: flip a signed field (evidence.foldHash).
  const tampered = JSON.parse(JSON.stringify(good));
  tampered.evidence.foldHash = "c".repeat(64);
  if (await verify(tampered, publicKey)) {
    console.error("FAIL (self-test): a TAMPERED bundle verified — the verifier is a no-op");
    process.exit(1);
  }
  console.log("PASS (self-test): good bundle verifies; tampered bundle fails verification");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live verification leg.
// ---------------------------------------------------------------------------
async function main() {
  if (selfTest) return runSelfTest();
  if (!base) {
    console.error("FAIL: --base <url> is required for live verification (the platform's origin)");
    process.exit(1);
  }
  const publicKey = pinnedPublicKey();
  const res = await fetch(`${base.replace(/\/$/, "")}/landings/${commit}`);
  if (res.status === 404) {
    console.error(`FAIL: no landing record for commit ${commit} (GET /landings/${commit} → 404)`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`FAIL: GET /landings/${commit} → HTTP ${res.status}`);
    process.exit(1);
  }
  const record = await res.json();
  const att = record.attestation;
  if (att === null || att === undefined) {
    console.error(`FAIL: /landings/${commit} carries no attestation (absent or null — pre-feature record or unprovisioned deploy)`);
    process.exit(1);
  }
  if (att.status !== "signed") {
    console.error(`FAIL: attestation status "${att.status}" (reason: ${att.reason ?? "?"}) — the deploy could not sign (key absent)`);
    process.exit(1);
  }
  if (!(await verify(att, publicKey))) {
    console.error(`FAIL: signature verification FAILED for commit ${commit} — the attestation is tampered, or the public key does not match the signing key`);
    process.exit(1);
  }
  console.log(`PASS: attestation for ${commit} verifies against the pinned public key (keyId ${att.keyId}, algo ${att.algo})`);

  if (r2Copy) {
    // Cross-copy leg: the R2 archival copy must deep-equal the served copy.
    const bucket = "nextgit-evidence";
    const key = `attestations/${commit}.json`;
    const { execFileSync } = await import("node:child_process");
    let r2Text;
    try {
      r2Text = execFileSync(
        "npx",
        ["wrangler", "r2", "object", "get", `${bucket}/${key}`, "--file", "-"],
        { cwd: join(here, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      console.error(`FAIL: could not read the R2 copy ${bucket}/${key} — ${e.stderr?.toString() ?? e.message}`);
      process.exit(1);
    }
    let r2Att;
    try {
      r2Att = JSON.parse(r2Text);
    } catch {
      console.error(`FAIL: the R2 copy ${bucket}/${key} is not valid JSON`);
      process.exit(1);
    }
    if (JSON.stringify(r2Att) !== JSON.stringify(att)) {
      console.error(`FAIL: the R2 copy ${bucket}/${key} differs from the served attestation — cross-copy tamper detected`);
      process.exit(1);
    }
    console.log(`PASS: the R2 copy ${bucket}/${key} deep-equals the served attestation`);
  }
  process.exit(0);
}

await main();
