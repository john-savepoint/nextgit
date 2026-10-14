// nextgit-platform — server-side landing.
//
// The one-click "ship it": fold proposals onto a base repo (diff3, in order,
// exactly as /merge does) and push the result as ONE commit to the base repo's
// branch, from inside the worker. No clone, no CLI on the caller's side.
//
// The push itself is isomorphic-git over the v1 wire protocol against the
// Artifacts remote, on a purpose-built in-memory filesystem (Workers have no
// fs) and an http client that injects the repo-scoped write token minted from
// the Artifacts binding.

import "./globals";
import git from "isomorphic-git";
import { createMemFs } from "./memfs";
import { createGitHttpClient } from "./githttp";
import { collectReferencedBlobIds, deleteUnreferenced } from "./asset-gc";
import { estimatePushBytes, assertPushBudget, PUSH_BUDGET_BYTES } from "./push-budget";
import type { AssetPointer } from "./assets";
import type { Env } from "./index";

const LAND_COMMIT_AUTHOR = {
 name: "nextgit-platform",
 email: "platform@nextgit.dev",
} as const;

export const TOKEN_TTL_SECONDS = 300; // one push, seconds-scale; revoked in a finally by the caller
const LAND_WORKDIR = "/repo";
const NOTES_REF_LOCAL = "refs/notes/commits"; // git-notes ref for landing-decision notes
const NOTES_BRANCH_LOCAL = "refs/heads/nextgit-notes"; // mirror branch for refs/notes/commits (full ref for isomorphic-git push remoteRef)
// Incremental land: the fold lands in increments of at most this many
// folded files per commit+push, so no single push can approach the
// Artifacts ~64 MiB push cap (research.md:65) — the push budget guard
// (push-budget.ts) fail-closes anything that still exceeds 16 MiB.
// Bounds every push by construction while keeping the commit/push
// count bounded for large folds.
export const LAND_INCREMENT_GROUP = 4;

/** One file of a folded merge, as /merge produces it. */
export interface LandFile {
 path: string;
 action: "write" | "delete";
 result: "merged" | "conflict" | "withheld-secret";
 merged?: string;
}

export interface LandInput {
 remote: string;
 token: string;
 baseRef: string;
 repos: string[];
 files: LandFile[];
 expectedBaseHead?: string;
 readBaseHead?: () => Promise<string>;
 /** When true, attach a landing-decision git note to the landed commit and mirror it. */
 landingNote?: boolean;
 /** R2 asset pointers carried by the fold's pointer rows (AD-10) —
  * the post-push reference-counted reclamation set. Absent on
  * pointer-free folds; the GC step is then a no-op. */
 assetPointers?: AssetPointer[];
 /** The worker's Env (the ARTIFACTS + ASSET_BLOB bindings the
  * reference-counted reclamation reads). Required exactly when
  * `assetPointers` is non-empty; the GC step is a no-op otherwise. */
 env?: Env;
}

/** Raised when the base ref moved between the fold and the push (AD-3). */
export class BaseMovedError extends Error {
 constructor(readonly currentHead: string) {
  super(`base ref moved to ${currentHead}`);
  this.name = "BaseMovedError";
 }
}

/**
 * Stable SHA-256 (hex) over the folded result: action + path + content, path-sorted.
 * Lives here so /land's landing-decision note can compute the fold hash inline
 * without a circular import from index.ts.
 */
export async function foldHashOf(files: LandFile[]): Promise<string> {
 const canonical = [...files]
  // Code-unit order (not localeCompare): the contract publishes this
  // serialization (CONTRACT.md POST /land) and clients recompute it from a
  // /merge preview — ICU collation must never enter the digest.
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  .map((f) => `${f.action}\n${f.path}\n${f.action === "write" ? f.merged ?? "" : ""}\n\x00`)
  .join("");
 const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
 return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Split the fold into the increment plan: bounded groups of at most `size`
 * files, in the fold's own order. An empty fold yields one (empty) increment
 * so the single-commit behavior of a no-file fold is unchanged.
 */
function landIncrements(files: LandFile[], size: number): LandFile[][] {
 if (files.length === 0) return [[]];
 const groups: LandFile[][] = [];
 for (let i = 0; i < files.length; i += size) groups.push(files.slice(i, i + size));
 return groups;
}

/**
 * Clone `remote` into memory, apply the fold, commit, and push — in
 * bounded increments, so no single push can approach the Artifacts
 * push cap (research.md:65).
 *
 * Returns the new commit sha (the FINAL increment's commit); throws on push
 * failure so the caller can return a credential-free error (spine AD-9: no
 * tokens and no shell snippets in any response, failure paths included).
 */
export async function pushLand(input: LandInput): Promise<{ commit: string; remote: string }> {
 // Push budget, fail closed BEFORE any wire call: the fold's own text is
 // the payload this land would push, so an over-budget fold is refused here
 // rather than dying on the remote with the opaque 64 MiB HTTP 500. The
 // estimate is a documented upper bound (see push-budget.ts) — never a
 // fabricated measurement. Content-free log: byte counts and counts only.
 const estimatedBytes = estimatePushBytes(input.files.map((f) => ({ path: f.path, content: f.merged ?? null })));
 assertPushBudget(estimatedBytes);
 const increments = landIncrements(input.files, LAND_INCREMENT_GROUP);
 console.log(
  "push-budget",
  JSON.stringify({ seam: "land", estimatedBytes, budgetBytes: PUSH_BUDGET_BYTES, increments: increments.length, files: input.files.length }),
 );

 const fs = createMemFs();
 const http = createGitHttpClient(input.token);

 await git.clone({
  fs: fs as unknown as Parameters<typeof git.clone>[0]["fs"],
  http: http as unknown as Parameters<typeof git.clone>[0]["http"],
  dir: LAND_WORKDIR,
  url: input.remote,
  ref: input.baseRef,
  singleBranch: true,
  depth: 1,
 });

 // Incremental land: the fold is applied and pushed one bounded increment at
 // a time, so each push carries one increment's text instead of the whole
 // fold — pushed history is chunked by construction. The landed TREE is the
 // same fold either way; only the history between base and tip differs.
 let commit = "";
 // The ref this increment's push must be based on: the reviewed base head for
 // the first increment, then our own last increment.
 let expectedHead = input.expectedBaseHead;
 let baseHeadChecked = false;
 // Compensating revert, so the land stays all-or-nothing across increments: on
 // a mid-loop failure the base ref is put back to the state this land found it
 // in — `observedBaseHead`, the tip the FIRST increment's own push discovery
 // reported (never a binding read, which can lag our own push). The flag turns
 // true once the remote has accepted a push: the pack is on the wire by then,
 // so the increments that already pushed are durable whatever the post-push
 // witness decides about the current one.
 let observedBaseHead: string | undefined;
 let pushedAnyIncrement = false;
 try {
  for (const increment of increments) {
   for (const file of increment) {
    const abs = `${LAND_WORKDIR}/${file.path}`;
    if (file.action === "delete") {
     await fs.unlink(abs);
     await git.remove({ fs: fs as never, dir: LAND_WORKDIR, filepath: file.path });
    } else {
     if (typeof file.merged !== "string") throw new Error(`land: no merged text for ${file.path}`);
     await fs.writeFile(abs, file.merged);
     await git.add({ fs: fs as never, dir: LAND_WORKDIR, filepath: file.path });
    }
   }

   commit = await git.commit({
    fs: fs as never,
    dir: LAND_WORKDIR,
    message: `land(${input.repos.join(",")}): fold proposal(s)`,
    author: LAND_COMMIT_AUTHOR,
    committer: LAND_COMMIT_AUTHOR,
   });

   // AD-3 concurrency precondition, once, before the first wire call: re-read
   // the base head after the clone; a concurrent land that advanced the ref
   // must refuse this one instead of committing on top of it (the
   // silent-overwrite path). NOT re-read per increment on purpose — the
   // binding's ref read can lag our own push, which would false-refuse the
   // second increment; the lag-free onPrePush witness below re-validates
   // every increment directly against the server's discovery.
   if (!baseHeadChecked) {
    baseHeadChecked = true;
    if (input.expectedBaseHead !== undefined && input.readBaseHead) {
     const currentHead = await input.readBaseHead();
     if (currentHead !== input.expectedBaseHead) throw new BaseMovedError(currentHead);
    }
   }

   let remoteTipAtPush: string | null = null;
   const result = (await git.push({
    fs: fs as never,
    http: http as never,
    dir: LAND_WORKDIR,
    ref: input.baseRef,
    // AD-3 witness: the ref the push is actually based on, straight from the
    // push's server discovery (no binding read lag). Must return true — a falsy
    // return cancels the push with UserCanceledError. Also the revert target:
    // the first increment's discovery is the ref's state before this land
    // wrote anything.
    onPrePush: (info: { remoteRef: { oid: string } }) => {
     remoteTipAtPush = info.remoteRef.oid;
     if (observedBaseHead === undefined) observedBaseHead = info.remoteRef.oid;
     return true;
    },
   })) as unknown as { refs: Record<string, { ok: boolean; error?: string }> };

   // The pack reached the remote: this increment is durable whether or not the
   // post-push witness below refuses it, so anything that throws from here on
   // leaves a partial fold for the catch to undo.
   pushedAnyIncrement = true;

   // The ref moved since the fold (the exact loser path this guard exists
   // for — including a duplicate land that built this byte-identical commit
   // and won inside the same second): same 409 as the reviewed-head gate
   // above. Checked per increment against THIS increment's own parent — the
   // reviewed base head for the first, our own last commit after that — so
   // each increment re-validates without the binding read.
   if (remoteTipAtPush !== null && expectedHead !== undefined && remoteTipAtPush !== expectedHead) {
    throw new BaseMovedError(remoteTipAtPush);
   }
   const refResult = result.refs[`refs/heads/${input.baseRef}`];
   if (!refResult?.ok) {
    throw new Error(`land: push rejected: ${refResult?.error ?? "unknown ref result"}`);
   }
   // The next increment lands on top of the commit this one just pushed.
   expectedHead = commit;
  }
 } catch (err: unknown) {
  // A mid-loop failure with increments already durable on input.baseRef: put the
  // base ref back where this land found it, restoring the all-or-nothing land —
  // no partial fold, and no fold the landing-decision note cannot reference
  // (FR-18). A foreign base move is not ours to move back (the caller's 409
  // classification owns that path), so it is left alone. Best-effort: if the
  // revert push fails too, the original error still propagates — a double fault
  // that honestly needs the operator, logged content-free (byte counts and
  // hashes only, AD-4).
  const foreignMove = err instanceof BaseMovedError && err.currentHead !== observedBaseHead;
  if (pushedAnyIncrement && observedBaseHead !== undefined && !foreignMove) {
   try {
    await git.branch({ fs: fs as never, dir: LAND_WORKDIR, ref: input.baseRef, object: observedBaseHead, force: true });
    await git.push({ fs: fs as never, http: http as never, dir: LAND_WORKDIR, ref: input.baseRef, force: true });
   } catch (e: unknown) {
    console.log("land-revert-failed", JSON.stringify({ commit, base: observedBaseHead, error: String(e) }));
   }
  }
  throw err;
 }

 // Landing-decision note: metadata-only (repos, commit, foldHash, at). No
 // file contents, no secrets — withheld-secret files are excluded at fold.
 // Attached to the FINAL increment's commit (the land's evidence reference),
 // then pushed to the mirror branch. Best-effort: a write failure here does
 // not fail the land.
 let noteWritten = false;
 if (input.landingNote) {
  try {
   await git.addNote({
    fs: fs as never,
    dir: LAND_WORKDIR,
    ref: NOTES_REF_LOCAL,
    oid: commit,
    note: JSON.stringify({
     repos: input.repos,
     commit,
     foldHash: await foldHashOf(input.files),
     at: new Date().toISOString(),
    }),
    force: true,
    author: LAND_COMMIT_AUTHOR,
    committer: LAND_COMMIT_AUTHOR,
   });
   noteWritten = true;
  } catch (e: unknown) {
   const err = e as { code?: string; data?: unknown; message?: string };
   console.log("landing-note-write-failed", JSON.stringify({ commit, code: err?.code, data: err?.data, error: String(e) }));
  }
 }

 // Reference-counted blob reclamation (e12 lifecycle): the
 // base-branch push is durable, so the fold's removed pointer
 // paths are gone from the base tree. For each asset pointer
 // the fold touched, re-read the namespace's manifest union
 // (the walk includes the just-pushed commit) and delete the
 // blob ONLY when no surviving pointer references it — shared
 // blobs are retained. Best-effort + non-blocking: wrapped in
 // its own try/catch (logs asset-gc-failed, content-free) so
 // a binding failure degrades to the lifecycle-rule backstop
 // (platform/r2-lifecycle.json) rather than failing a land
 // that already pushed. Mirrors the landing-note posture.
 if (input.assetPointers && input.assetPointers.length > 0 && input.env) {
  try {
   const referenced = await collectReferencedBlobIds(input.env);
   for (const pointer of input.assetPointers) {
    await deleteUnreferenced(input.env, pointer.blobId, referenced);
   }
  } catch (e: unknown) {
   console.log("asset-gc-failed", JSON.stringify({ commit, error: String(e) }));
  }
 }

 // Push the notes ref to its mirror branch — NOT a base-branch write.
 // Best-effort: logs "landing-note-push-failed" and degrades gracefully.
 // Only push if the local note was written successfully; otherwise there is
 // nothing to push.
 if (noteWritten) {
  await git.push({
   fs: fs as never,
   http: http as never,
   dir: LAND_WORKDIR,
   ref: NOTES_REF_LOCAL,
   remoteRef: NOTES_BRANCH_LOCAL,
   // The mirror is DERIVED state (always := refs/notes/commits); unforced pushes are
   // rejected non-ff once the base carries a divergent mirror from an earlier land
   // (2026-10-10). Forced, single-writer, inside the pushLand critical section.
   force: true,
   onPrePush: () => true,
  }).catch((e: unknown) => {
   const err = e as { code?: string; data?: unknown; message?: string };
   console.log("landing-note-push-failed", JSON.stringify({ commit, code: err?.code, data: err?.data, error: String(e) }));
  });
 }

 return { commit, remote: input.remote };
}

/**
 * Mint a repo-scoped write token. Lives here so the endpoint and the fallback
 * path share one minting rule.
 */
export async function mintWriteToken(repo: ArtifactsRepo): Promise<string> {
 const token = await repo.createToken("write", TOKEN_TTL_SECONDS);
 return token.plaintext;
}
