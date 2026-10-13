// push-guard.mjs — the script-side push budget guard (order:
// nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap).
//
// The runner scripts push with the git CLI, so they measure the ACTUAL
// git objects the push would carry — real plumbing, not an estimate.
// Artifacts enforces a ~64 MiB push cap (push-side only, no ETA, no
// workaround posted): 63 MiB passes, 64 MiB returns HTTP 500
// (research/2026-10-02-platform-recon-briefs/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:65).
// The guard refuses a push BEFORE the wire call, so an over-budget
// push never leaves the box and never dies on that opaque 500.
//
// Sized set: the objects reachable from each pushed SOURCE ref and not
// already on the remote-tracking ref that mirrors its DESTINATION —
// exactly the negotiation the push itself performs. With no upstream
// (a freshly created repo, or a ref the clone never fetched) the whole
// ref is sized: the conservative posture, never an understatement.
//
// The byte count is metadata (AD-4 egress class): content-free, no
// paths, no tokens — the refusal is auditable without leaking.

import { execFileSync } from "node:child_process";

/** Per-push byte budget: 16 MiB (4x under the measured pass threshold). */
export const PUSH_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Raised when a push's measured size exceeds the budget. Typed so a
 * runner can distinguish it from a git failure. Carries the byte count
 * only.
 */
export class PushBudgetError extends Error {
 constructor(estimatedBytes) {
  super(
   `push budget exceeded: estimated ${estimatedBytes} bytes exceeds the ${PUSH_BUDGET_BYTES}-byte push budget`,
  );
  this.name = "PushBudgetError";
  this.estimatedBytes = estimatedBytes;
 }
}

/** Full-ref form of a refspec source/dest side ("main" -> refs/heads/main). */
function fullRef(ref) {
 if (!ref || ref === "HEAD") return ref;
 return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

/** Split one refspec into its source and destination refs (force prefix dropped). */
export function parseRefspec(refspec) {
 const bare = refspec.startsWith("+") ? refspec.slice(1) : refspec;
 const colon = bare.indexOf(":");
 const source = fullRef(colon === -1 ? bare : bare.slice(0, colon));
 const dest = fullRef(colon === -1 ? bare : bare.slice(colon + 1));
 return { source, dest };
}

/** The default git runner: local plumbing only, no network, no credentials. */
function defaultGit(dir) {
 return (args, input) =>
  execFileSync("git", args, {
   cwd: dir,
   encoding: "utf8",
   input,
   stdio: ["pipe", "pipe", "pipe"],
  });
}

/** True when `ref` resolves to a commit in this repo (no throw on absence). */
function refExists(git, ref) {
 try {
  git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return true;
 } catch {
  return false;
 }
}

/**
 * Measure the uncompressed byte volume the push would carry: for every
 * distinct source ref, the objects reachable from it and not from the
 * remote-tracking refs that mirror the pushed destinations. Each object
 * is counted once however many refspecs reach it.
 *
 * `deps.git` is an injection seam for tests (a runner taking
 * `(args, input)`); production uses real, credential-free git plumbing.
 */
export function estimatePushBytesGit(dir, refspecs, deps = {}) {
 const git = deps.git ?? defaultGit(dir);
 const sources = new Set();
 const excludes = new Set();
 const tracking = (ref) =>
  ref && ref.startsWith("refs/heads/") ? `refs/remotes/origin/${ref.slice("refs/heads/".length)}` : null;

 for (const refspec of refspecs) {
  const { source, dest } = parseRefspec(refspec);
  sources.add(source);
  // What the server already has for this push: the tracking ref mirroring
  // the destination (and, for a same-name refspec, the source itself).
  for (const candidate of [tracking(dest), tracking(source)]) {
   if (candidate && refExists(git, candidate)) excludes.add(candidate);
  }
 }

 const shas = new Set();
 for (const source of sources) {
  if (!refExists(git, source)) continue; // nothing to push for this ref
  const args = ["rev-list", "--objects", source];
  if (excludes.size) args.push("--not", ...excludes);
  for (const line of git(args).split("\n")) {
   const sha = line.trim().split(/\s+/)[0];
   if (sha) shas.add(sha);
  }
 }
 if (shas.size === 0) return 0;

 const sizes = git(["cat-file", "--batch-check=%(objectsize)"], `${[...shas].join("\n")}\n`);
 let bytes = 0;
 for (const line of sizes.split("\n")) {
  const n = Number(line.trim());
  if (Number.isFinite(n)) bytes += n;
 }
 return bytes;
}

/**
 * Fail closed: throw PushBudgetError when the measured push size exceeds
 * the budget, and return the measured size otherwise. Call IMMEDIATELY
 * before the push — the measurement is of the very objects that push
 * would send.
 *
 * Logs one content-free `push-budget` line per call (byte counts and
 * refspec counts only — the NFR-3 log idiom, mirrored from the worker
 * seam in platform/src/land.ts), so a demo run shows every push's
 * estimate rather than only the refusals.
 */
export function assertPushBudgetGit(dir, refspecs, deps = {}) {
 const estimatedBytes = estimatePushBytesGit(dir, refspecs, deps);
 console.log(
  "push-budget",
  JSON.stringify({ seam: "runner", estimatedBytes, budgetBytes: PUSH_BUDGET_BYTES, refspecs: refspecs.length }),
 );
 if (estimatedBytes > PUSH_BUDGET_BYTES) throw new PushBudgetError(estimatedBytes);
 return estimatedBytes;
}
