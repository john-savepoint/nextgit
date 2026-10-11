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

const LAND_COMMIT_AUTHOR = {
 name: "nextgit-platform",
 email: "platform@nextgit.dev",
} as const;

export const TOKEN_TTL_SECONDS = 300; // one push, seconds-scale; revoked in a finally by the caller
const LAND_WORKDIR = "/repo";
const NOTES_REF_LOCAL = "refs/notes/commits"; // git-notes ref for landing-decision notes
const NOTES_BRANCH_LOCAL = "refs/heads/nextgit-notes"; // mirror branch for refs/notes/commits (full ref for isomorphic-git push remoteRef)

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
 * Clone `remote` into memory, apply the fold, commit, and push.
 *
 * Returns the new commit sha; throws on push failure so the caller can return
 * a credential-free error (spine AD-9: no tokens and no shell snippets in any
 * response, failure paths included).
 */
export async function pushLand(input: LandInput): Promise<{ commit: string; remote: string }> {
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

 for (const file of input.files) {
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

 const commit = await git.commit({
  fs: fs as never,
  dir: LAND_WORKDIR,
  message: `land(${input.repos.join(",")}): fold proposal(s)`,
  author: LAND_COMMIT_AUTHOR,
  committer: LAND_COMMIT_AUTHOR,
 });

 // AD-3 concurrency precondition: re-read the base head after the clone and
 // before the push; a concurrent land that advanced the ref must refuse this
 // one instead of committing on top of it (the silent-overwrite path).
 if (input.expectedBaseHead !== undefined && input.readBaseHead) {
  const currentHead = await input.readBaseHead();
  if (currentHead !== input.expectedBaseHead) throw new BaseMovedError(currentHead);
 }

 // Landing-decision note: metadata-only (repos, commit, foldHash, at). No
 // file contents, no secrets — withheld-secret files are excluded at fold.
 // Written to the local notes ref, then pushed to the mirror branch after
 // the base-branch push succeeds. Best-effort: a write failure here does
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

 let remoteTipAtPush: string | null = null;
 const result = (await git.push({
  fs: fs as never,
  http: http as never,
  dir: LAND_WORKDIR,
  ref: input.baseRef,
  // AD-3 witness: the ref the push is actually based on, straight from the
  // push's server discovery (no binding read lag). Must return true — a falsy
  // return cancels the push with UserCanceledError.
  onPrePush: (info: { remoteRef: { oid: string } }) => {
   remoteTipAtPush = info.remoteRef.oid;
   return true;
  },
 })) as unknown as { refs: Record<string, { ok: boolean; error?: string }> };

 // The ref moved between the fold and the push: the exact loser path this
 // guard exists for (same 409 as :95-98) — including a duplicate land that
 // built this byte-identical commit and won inside the same second.
 if (remoteTipAtPush !== null && input.expectedBaseHead !== undefined && remoteTipAtPush !== input.expectedBaseHead) {
  throw new BaseMovedError(remoteTipAtPush);
 }

 const refResult = result.refs[`refs/heads/${input.baseRef}`];
 if (!refResult?.ok) {
  throw new Error(`land: push rejected: ${refResult?.error ?? "unknown ref result"}`);
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
