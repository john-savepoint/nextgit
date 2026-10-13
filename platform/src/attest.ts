// Signed validation evidence (FR-18 authenticity layer).
//
// The ONE place anything signs or verifies an attestation.
// The envelope law (CONTRACT.md §Attestations): the
// signature covers every field of the envelope except
// `sig` — `sig = sign( canonicalize( attestation minus
// the "sig" key ) )` — so adding a field is automatically
// covered. Canonicalization is the `foldHashOf` discipline
// (recursive key sort, code-unit comparison, no whitespace,
// arrays in order): the contract publishes it and clients
// recompute it.
//
// Fail-closed posture: an absent or malformed signing key
// NEVER fails a land that already pushed (the landing-note
// / asset-gc best-effort posture) — `signAttestation`
// returns the honest `{ status: "unavailable", reason }`
// shape instead of throwing. `verifyAttestation` is pure and
// returns `false` on ANY defect — it recomputes from the
// supplied object, never trusting a stored copy of the
// payload.

// Structural typing (the readVerifiedBlob posture, assets.ts:172-174):
// index.ts imports this module, so a type-only import would be
// circular. The functions need only the binding names they read.
type Env = {
 EVIDENCE_BLOB?: R2Bucket;
 EVIDENCE_SIGNING_KEY?: unknown;
 EVIDENCE_PUBLIC_KEY?: unknown;
 CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
};

/** Envelope version (CONTRACT.md §Attestations). */
export const ATTESTATION_VERSION = 1;
/** Signing algorithm — WebCrypto Ed25519 (probe-gated, §8 row 1). */
export const ATTEST_ALGO = "Ed25519";
/** R2 key prefix for the durable archival copy. */
export const EVIDENCE_KEY_PREFIX = "attestations/";
/** Read-back parse bound: refuse to parse an oversized body. */
export const EVIDENCE_MAX_BYTES = 256 * 1024;

/** The land subject: the commit and the repos/refs that produced it. */
export interface AttestationSubject {
 commit: string;
 repos: string[];
 base: string;
 ref: string;
 baseRef: string;
}

/** The deploy context the attestation ran in (§2.1 environment). */
export interface AttestationEnvironment {
 worker: string;
 deploy: string | null;
 tag: string | null;
 runtime: string;
}

/** A signed attestation envelope. `sig` covers every other field. */
export interface AttestationSigned {
 status: "signed";
 v: number;
 algo: string;
 keyId: string;
 at: string;
 subject: AttestationSubject;
 environment: AttestationEnvironment;
 evidence: Record<string, unknown>;
 sig: string;
}

/** Honest-unavailable shape (same tagged union, stable key set). */
export interface AttestationUnavailable {
 status: "unavailable";
 reason: string;
}

export type Attestation = AttestationSigned | AttestationUnavailable;

/** base64url encode (no padding) — the envelope's binary encoding. */
function b64url(bytes: Uint8Array): string {
 let s = "";
 for (const b of bytes) s += String.fromCharCode(b);
 return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url decode — null on any defect (fail-closed). */
function unb64url(value: string): Uint8Array | null {
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

/**
 * The ONE serializer for signed objects: recursive key sort
 * (code-unit `<` — never localeCompare), no whitespace, arrays
 * in order. Exactly the `foldHashOf` discipline (land.ts:71-81),
 * because the contract publishes it and clients recompute it.
 */
export function canonicalize(value: unknown): string {
 if (value === null) return "null";
 if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
 switch (typeof value) {
  case "string":
   return JSON.stringify(value);
  case "number":
   return Number.isFinite(value) ? String(value) : "null";
  case "boolean":
   return String(value);
  case "object": {
   const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
   const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",");
   return `{${body}}`;
  }
  default:
   return "null";
 }
}

/** keyId = sha256(raw public key)[0..16] hex — makes rotation expressible. */
export async function keyIdOf(publicKeyRaw: Uint8Array): Promise<string> {
 // Copy into a fixed BufferSource view — a generic
 // Uint8Array<ArrayBufferLike> is not assignable (assets.ts:102-103).
 const view = new Uint8Array(publicKeyRaw.byteLength);
 view.set(publicKeyRaw);
 const digest = await crypto.subtle.digest("SHA-256", view);
 return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Import the Worker secret `EVIDENCE_SIGNING_KEY` (base64url
 * PKCS#8). Returns null — NEVER throws — for absent, blank, or
 * malformed material: the land path must never 500 on
 * attestation config (§2.3 honest-unavailable law).
 */
export async function importSigningKey(env: Env): Promise<CryptoKey | null> {
 const material = env.EVIDENCE_SIGNING_KEY;
 if (typeof material !== "string" || material.trim() === "") return null;
 try {
  const decoded = unb64url(material.trim());
  if (decoded === null) return null;
  // Copy into a fixed BufferSource view before importKey
  // (a generic Uint8Array<ArrayBufferLike> is not assignable).
  const raw = new Uint8Array(decoded.byteLength);
  raw.set(decoded);
  return await crypto.subtle.importKey("pkcs8", raw, { name: ATTEST_ALGO }, false, ["sign"]);
 } catch {
  return null;
 }
}

/**
 * Import a base64url RAW public key (the pinned
 * `EVIDENCE_PUBLIC_KEY` shape). Returns null — never throws —
 * on any defect.
 */
export async function importPublicKey(rawB64url: string): Promise<CryptoKey | null> {
 if (typeof rawB64url !== "string" || rawB64url.trim() === "") return null;
 try {
  const decoded = unb64url(rawB64url.trim());
  if (decoded === null) return null;
  // Copy into a fixed BufferSource view before importKey.
  const raw = new Uint8Array(decoded.byteLength);
  raw.set(decoded);
  return await crypto.subtle.importKey("raw", raw, { name: ATTEST_ALGO }, false, ["verify"]);
 } catch {
  return null;
 }
}

/**
 * Build and sign the attestation envelope for one landing.
 * Honest-unavailable: a missing/malformed key (or a missing
 * public var) yields `{status:"unavailable"}` — the caller's
 * land still succeeds.
 *
 * WebCrypto cannot export the raw public key from an imported
 * Ed25519 private key, so the envelope's `keyId` derives from
 * the `EVIDENCE_PUBLIC_KEY` worker var — which IS the raw
 * public key (base64url). Both halves are provisioned together
 * by attestation-keygen.mjs, so a missing public var is the
 * same honest-unavailable condition as a missing secret.
 */
export async function signAttestation(
 env: Env,
 input: { subject: AttestationSubject; environment: AttestationEnvironment; evidence: Record<string, unknown> },
): Promise<Attestation> {
 const key = await importSigningKey(env);
 if (key === null) {
  return { status: "unavailable", reason: "signing-key-absent" };
 }
 const publicKeyMaterial = env.EVIDENCE_PUBLIC_KEY;
 if (typeof publicKeyMaterial !== "string" || publicKeyMaterial.trim() === "") {
  return { status: "unavailable", reason: "public-key-absent" };
 }
 const publicKeyRaw = unb64url(publicKeyMaterial.trim());
 if (publicKeyRaw === null) {
  return { status: "unavailable", reason: "public-key-absent" };
 }
 const at = new Date().toISOString();
 const envelope: Omit<AttestationSigned, "sig"> = {
  status: "signed",
  v: ATTESTATION_VERSION,
  algo: ATTEST_ALGO,
  keyId: await keyIdOf(publicKeyRaw),
  at,
  subject: input.subject,
  environment: input.environment,
  evidence: input.evidence,
 };
 const sig = await crypto.subtle.sign(ATTEST_ALGO, key, new TextEncoder().encode(canonicalize(envelope)));
 return { ...envelope, sig: b64url(new Uint8Array(sig)) };
}

/**
 * PURE verification: recompute the signature over the SUPPLIED
 * object (never a stored payload copy) and check it, plus the
 * §2.1 internal-consistency law (`subject.commit ===
 * evidence.commit` and `subject.repos` deep-equals
 * `evidence.repos`). Returns false on ANY defect; never throws.
 */
export async function verifyAttestation(att: unknown, publicKeyB64url: string): Promise<boolean> {
 try {
  if (att === null || typeof att !== "object" || Array.isArray(att)) return false;
  const record = att as Record<string, unknown>;
  if (record.status !== "signed") return false;
  if (record.v !== ATTESTATION_VERSION) return false;
  if (record.algo !== ATTEST_ALGO) return false;
  if (typeof record.keyId !== "string" || record.keyId.length !== 16) return false;
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) return false;
  if (typeof record.sig !== "string") return false;
  const subject: unknown = record.subject;
  const environment: unknown = record.environment;
  const evidence: unknown = record.evidence;
  if (subject === null || typeof subject !== "object" || Array.isArray(subject)) return false;
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) return false;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const subjectRecord = subject as Record<string, unknown>;
  const evidenceRecord = evidence as Record<string, unknown>;
  if (typeof subjectRecord.commit !== "string" || !/^[0-9a-f]{40}$/.test(subjectRecord.commit)) return false;
  if (!Array.isArray(subjectRecord.repos) || subjectRecord.repos.some((r) => typeof r !== "string")) return false;
  // §2.1 internal-consistency law: a spliced subject is
  // detectable even when the signature itself is valid.
  if (subjectRecord.commit !== evidenceRecord.commit) return false;
  if (JSON.stringify(subjectRecord.repos) !== JSON.stringify(evidenceRecord.repos)) return false;
  const key = await importPublicKey(publicKeyB64url);
  if (key === null) return false;
  const sigDecoded = unb64url(record.sig);
  if (sigDecoded === null || sigDecoded.length !== 64) return false; // Ed25519 signature is exactly 64 bytes
  // Copy into a fixed BufferSource view before verify.
  const sigBytes = new Uint8Array(sigDecoded.byteLength);
  sigBytes.set(sigDecoded);
  const payload: Record<string, unknown> = { ...record };
  delete payload.sig;
  const data = new TextEncoder().encode(canonicalize(payload));
  return await crypto.subtle.verify(ATTEST_ALGO, key, sigBytes, data);
 } catch {
  return false;
 }
}

/**
 * Store the durable R2 copy (`attestations/<commit>.json`).
 * Best-effort: returns the R2 key on success, null on any
 * failure (the caller logs `attestation-store-failed` — a
 * storage failure never fails a land that already pushed).
 */
export async function storeAttestation(env: Env, commit: string, att: AttestationSigned): Promise<string | null> {
 const bucket = env.EVIDENCE_BLOB;
 if (bucket === undefined || bucket === null) return null;
 const key = `${EVIDENCE_KEY_PREFIX}${commit}.json`;
 try {
  await bucket.put(key, JSON.stringify(att), { httpMetadata: { contentType: "application/json" } });
  return key;
 } catch {
  return null;
 }
}

/**
 * Read the durable R2 copy back. Fail-closed: null — never a
 * throw, never a 500 — for an absent key, an oversized body,
 * or a body that is not an object with a `status` field.
 */
export async function readAttestation(env: Env, commit: string): Promise<Attestation | null> {
 const bucket = env.EVIDENCE_BLOB;
 if (bucket === undefined || bucket === null) return null;
 try {
  const object = await bucket.get(`${EVIDENCE_KEY_PREFIX}${commit}.json`);
  if (object === null || object === undefined) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > EVIDENCE_MAX_BYTES) return null;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!("status" in parsed)) return null;
  return parsed as Attestation;
 } catch {
  return null;
 }
}
