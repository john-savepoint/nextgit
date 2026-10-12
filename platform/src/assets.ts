// nextgit-platform — R2 asset tier (AD-10; FR-47).
//
// Large/binary assets live as content-addressed blobs in the R2 bucket
// `nextgit-asset-blobs`; git carries a pointer file in Artifacts. This
// module owns the pointer format — later R2 slices conform additively
// (`v` is the format generation).
//
// Format laws (CONTRACT.md §R2 asset tier):
//   - blobId is an OPAQUE R2 object key, never a URL (presigned URLs
//     are credential-adjacent; minted at read time by the binding,
//     never stored — AD-4/AD-10).
//   - sha256 is the integrity anchor: blob bytes must hash to it at
//     every materialization path (the e12 integrity row owns the
//     verified-read chokepoint; fail-closed there).
//   - Pointer files render METADATA ONLY: no patch, no
//     additions/deletions, never merge text (AD-4 — pointer metadata
//     is egress; raw contents never leave the worker).
//   - parseAssetPointer is pure and fail-closed: ANY structural
//     violation returns null. The caller renders a metadata row with
//     a note — never a 500, never the raw text.

/** Pointer format generation. Later slices bump `v` and conform additively. */
export const ASSET_POINTER_VERSION = 1;

/**
 * Pointer-file size cap (1 MiB). A pointer is metadata, never a
 * payload — the hostile-pointer DoS defense at the format seam.
 */
export const MAX_POINTER_CHARS = 1_048_576;

/**
 * A parsed asset pointer. `blobId` is an opaque R2 object key;
 * `sha256` is the hex-64 content hash of the blob bytes; `size` is
 * the blob byte length.
 */
export interface AssetPointer {
 v: typeof ASSET_POINTER_VERSION;
 /** Opaque R2 object key — NEVER a URL. */
 blobId: string;
 /** hex-64 content hash of the blob bytes. */
 sha256: string;
 /** Blob byte length (uint, <= 2**53). */
 size: number;
 contentType?: string;
}

/**
 * Single classifier: `assets/<name>` is carried by
 * `assets/<name>.asset.json`. Both the change-set and merge seams
 * call this (no duplicated regexes — AD-8 single-source).
 */
export function isAssetPointer(path: string): boolean {
 return path.endsWith(".asset.json");
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Parse a pointer file's text. Pure, exported, fail-closed: any
 * structural violation (bad `v`, non-hex-64 sha256, non-uint /
 * negative / missing size, missing blobId, JSON > 1 MiB, non-JSON
 * text) returns `null`.
 */
export function parseAssetPointer(text: string): AssetPointer | null {
 if (typeof text !== "string" || text.length > MAX_POINTER_CHARS) return null;
 let parsed: unknown;
 try {
  parsed = JSON.parse(text);
 } catch {
  return null;
 }
 if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
 const obj = parsed as Record<string, unknown>;
 if (obj.v !== ASSET_POINTER_VERSION) return null;
 if (typeof obj.blobId !== "string" || obj.blobId.length === 0) return null;
 if (typeof obj.sha256 !== "string" || !SHA256_RE.test(obj.sha256)) return null;
 if (typeof obj.size !== "number" || !Number.isInteger(obj.size) || obj.size < 0 || obj.size > Number.MAX_SAFE_INTEGER) {
  return null;
 }
 if (obj.contentType !== undefined && typeof obj.contentType !== "string") return null;
 return {
  v: ASSET_POINTER_VERSION,
  blobId: obj.blobId,
  sha256: obj.sha256,
  size: obj.size,
  ...(obj.contentType === undefined ? {} : { contentType: obj.contentType }),
 };
}

/**
 * Content-addressed constructor (blobId = sha256 hex) for the
 * upload path and the round-trip test. WebCrypto
 * (`crypto.subtle.digest`, the land.ts idiom) — no node:
 * builtin in worker code (globals.ts posture).
 */
export async function assetPointerFor(blob: Uint8Array, contentType?: string): Promise<AssetPointer> {
 // Copy into a fresh ArrayBuffer-backed view: crypto.subtle.digest
 // takes a BufferSource (ArrayBufferView<ArrayBuffer>), and a
 // generic Uint8Array<ArrayBufferLike> is not assignable.
 const bytes = new Uint8Array(blob.byteLength);
 bytes.set(blob);
 const digest = await crypto.subtle.digest("SHA-256", bytes);
 const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
 const pointer: AssetPointer = { v: ASSET_POINTER_VERSION, blobId: sha256, sha256, size: blob.length };
 if (contentType !== undefined) pointer.contentType = contentType;
 return pointer;
}

