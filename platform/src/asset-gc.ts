// nextgit-platform — asset garbage collection (e12 lifecycle).
//
// The reference-count rule for R2 asset blobs (AD-10; FR-47).
//
// Source of truth: the union of every repo's pointer manifests. Any
// cache or index of "live blobs" must be rebuildable from those
// manifests — no new state is persisted here; the union is computed
// on demand (B1's rebuildability contract, pinned by
// porting/tests/asset-gc.test.mjs group 5).
//
// The rule lives in exactly one place (AD-8 single-source). The
// out-of-band sweep (platform/scripts/r2-orphan-sweep.mjs) runs in
// Node and cannot import this worker module — it re-implements the
// walk over the Artifacts REST/git surface; the walk contract (which
// paths count as pointer manifests, how the union is defined) is
// pinned by the shared test, not shared code.

import { isAssetPointer, parseAssetPointer } from "./assets";
import type { Env } from "./index";

/**
 * The union of every repo's pointer manifests: every blobId any
 * surviving `*.asset.json` pointer file references. Namespace-wide
 * by construction — a blob shared with ANY repo survives, which is
 * the whole point of reference counting.
 *
 * Walks `env.ARTIFACTS.list({limit:200})` — the same bounded
 * namespace-discovery seam `/proposals`/`/floors` use — and for
 * each repo reads its default-branch tree via the in-worker idiom
 * (`repo.log({ref, limit:1})` -> `repo.readTree(treeHash)`
 * recursion, exactly `walkTree` in index.ts). Pure over the
 * binding; no R2 reads.
 */
export async function collectReferencedBlobIds(env: { ARTIFACTS: Artifacts }): Promise<Set<string>> {
 const referenced = new Set<string>();
 // Cursor to exhaustion: the union is the DELETE precondition, so it
 // must be complete — a namespace with more than 200 repos would
 // otherwise under-count the union and a blob referenced only beyond
 // the first 200 list entries would be wrongly deleted. (The
 // /proposals seam reuses the same limit but is read-only.)
 let cursor: string | undefined;
 do {
  const list = await env.ARTIFACTS.list({ limit: 200, ...(cursor !== undefined ? { cursor } : {}) });
  for (const entry of list.repos) {
   // The discovery seam's non-ready repos (importing/forking) have
   // no readable default branch; skip them — the same filter the
   // /proposals auto-discovery applies.
   if (entry.status !== undefined && entry.status !== "ready") continue;
   const repo = await env.ARTIFACTS.get(entry.name);
   const commits = await repo.log({ ref: entry.defaultBranch ?? "main", limit: 1 });
   if (!commits.length) continue;
   const out = new Map<string, string>();
   await walkReferenced(repo, commits[0].treeHash, "", out);
   for (const [path, hash] of out) {
    if (!isAssetPointer(path)) continue;
    const text = await readBlobText(repo, hash);
    const pointer = text === null ? null : parseAssetPointer(text);
    if (pointer) referenced.add(pointer.blobId);
   }
  }
  cursor = list.cursor;
 } while (cursor !== undefined);
 return referenced;
}

// The walkTree idiom (index.ts) — tree recursion over readTree.
async function walkReferenced(repo: ArtifactsRepo, treeHash: string, prefix: string, out: Map<string, string>): Promise<void> {
 const entries = await repo.readTree(treeHash);
 if (!entries) return;
 for (const entry of entries) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.type === "tree") {
   await walkReferenced(repo, entry.hash, path, out);
  } else if (entry.type === "blob" || entry.type === "exec") {
   out.set(path, entry.hash);
  }
 }
}

async function readBlobText(repo: ArtifactsRepo, hash: string): Promise<string | null> {
 const blob = await repo.readBlob(hash);
 if (!blob) return null;
 return await blob.text();
}

/**
 * Reference count for one blob over the manifest union. Trivial
 * membership (0/1) — a named function so the contract is explicit
 * at the call site.
 */
export function refcount(blobId: string, referenced: Set<string>): number {
 return referenced.has(blobId) ? 1 : 0;
}

/**
 * Delete a blob via the ASSET_BLOB binding ONLY when its reference
 * count is zero. Returns "retained" when the blob is still
 * referenced (shared blobs are never deleted — the survival
 * contract). Best-effort: an R2 delete failure logs
 * `asset-blob-delete-failed` (content-free: `{blobId, error}` —
 * blobId is an opaque key, not egress per AD-4) and never throws,
 * never fails the land (the landing-note best-effort posture).
 */
export async function deleteUnreferenced(
 env: Pick<Env, "ASSET_BLOB">,
 blobId: string,
 referenced: Set<string>,
): Promise<"deleted" | "retained" | "error"> {
 if (refcount(blobId, referenced) > 0) {
  console.log("asset-blob-retained", JSON.stringify({ blobId }));
  return "retained";
 }
 const bucket = env.ASSET_BLOB;
 if (!bucket) {
  // Unbound bucket (local dev): nothing to delete. The lifecycle
  // rule (platform/r2-lifecycle.json) is the backstop where the
  // bucket exists; an unbound binding degrades identically.
  console.log("asset-blob-delete-skipped", JSON.stringify({ blobId, reason: "binding-absent" }));
  return "error";
 }
 try {
  await bucket.delete(blobId);
  console.log("asset-blob-deleted", JSON.stringify({ blobId }));
  return "deleted";
 } catch (e: unknown) {
  console.log("asset-blob-delete-failed", JSON.stringify({ blobId, error: String(e) }));
  return "error";
 }
}
