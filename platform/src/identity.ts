// nextgit-platform — change-set identity (nextgit-e16).
//
// The change-set's stable content identity: a SHA-256 over a
// deterministic serialization of exactly what the change-set
// MEANS (its files' paths/statuses/blob-hashes plus the base
// fork point and the head repo/ref/sha) — never timestamps,
// intent, stats, or notes. Identical for identical
// re-materializations; distinct for any content delta.
//
// The CONTRACT.md §GET /changes / §GET /proposals entries
// publish this serialization; clients recompute it (the same
// `canonicalize`/`foldHashOf` discipline). This module is the
// pure function behind it — no binding reads, no `env`, a
// function of its input alone.

/**
 * Structural input (no import from index.ts — index.ts imports
 * this module, so a type-only import would be circular; the
 * attest.ts:22-30 posture). `files` mirrors the served
 * change-set rows: a `modified` row carries both hashes, an
 * `added` row only `headHash`, a `removed` row only `baseHash`.
 */
export interface ChangeSetIdentityInput {
 base: { repo: string; ref: string; sha: string };
 head: { repo: string; ref: string; sha: string };
 files: Array<{
  path: string;
  status: "added" | "modified" | "removed";
  baseHash?: string;
  headHash?: string;
 }>;
}

/**
 * The canonical serialization law (CONTRACT.md §GET /changes
 * `identity.fingerprint`):
 *
 *   base.repo\nbase.ref\nbase.sha\nhead.repo\nhead.ref\nhead.sha\n
 *   then, for each file in CODE-UNIT path order, one record:
 *   ${status}\n${path}\n${headHash-or-""}\n${baseHash-or-""}\x00
 *
 * The head hash is emitted only when the row is not `removed`
 * (an `added`/`modified` row has one); the base hash only when
 * the row is not `added`. `?? ""` guards the optional-hash
 * holes so a row's shape can never change the digest.
 */
export function serializeChangeSetIdentity(input: ChangeSetIdentityInput): string {
 const identityBlock = `${input.base.repo}\n${input.base.ref}\n${input.base.sha}\n${input.head.repo}\n${input.head.ref}\n${input.head.sha}\n`;
 // Code-unit order (not localeCompare): the contract publishes
 // this serialization and clients recompute it — ICU collation
 // must never enter the digest (the foldHashOf discipline,
 // land.ts:79-89; the canonicalize discipline, attest.ts:108-126).
 const records = [...input.files]
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  .map(
   (f) =>
    `${f.status}\n${f.path}\n${f.status !== "removed" ? f.headHash ?? "" : ""}\n${f.status !== "added" ? f.baseHash ?? "" : ""}\x00`,
  )
  .join("");
 return identityBlock + records;
}

/**
 * The change-set fingerprint: sha256 over the canonical
 * serialization, hex-encoded (the `foldHashOf`/`keyIdOf` idiom).
 */
export async function changeSetFingerprint(input: ChangeSetIdentityInput): Promise<string> {
 const canonical = serializeChangeSetIdentity(input);
 const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
 return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
