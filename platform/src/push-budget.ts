// nextgit-platform — push budget seam (order:
// nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap).
//
// Artifacts enforces a ~64 MiB push cap (push-side only, no ETA, no
// workaround posted): 63 MiB passes, 64 MiB returns HTTP 500
// (research/2026-10-02-platform-recon-briefs/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:65).
// Nothing in the platform may approach that cap: every push seam
// estimates its payload and fails closed BEFORE the wire call.
//
// Budget: 16 MiB per push — 4x under the measured pass threshold,
// comfortably above any demo-scale text fold. If the platform lifts
// the cap, this constant moves in one place.
//
// The estimate is an upper bound, never a measurement: text length
// (UTF-16 code units) x 2 approximates worst-case UTF-8 bytes for
// BMP text (surrogates count double, which covers astral planes
// too). It never fabricates: a withheld (null) file contributes 0.

/** Per-push byte budget: 16 MiB. */
export const PUSH_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Raised when a push's estimated size exceeds the budget. Typed so
 * callers can fail closed with a distinguishable error. Carries the
 * byte count only — no content, no paths, no tokens (STRIDE: the
 * refusal is auditable metadata, AD-4 egress class).
 */
export class PushBudgetError extends Error {
 constructor(readonly estimatedBytes: number) {
  super(
   `push budget exceeded: estimated ${estimatedBytes} bytes exceeds the ${PUSH_BUDGET_BYTES}-byte push budget`,
  );
  this.name = "PushBudgetError";
 }
}

/** One pushed file, as a push seam sees it: path plus its text. */
export interface PushFile {
 path: string;
 content?: string | null;
}

/**
 * Estimate the byte volume a push would carry: the sum of each
 * file's text length (UTF-16 code units) x 2 — a conservative
 * upper bound on UTF-8 bytes, documented as such. A missing or
 * withheld file (null/absent content) contributes 0: the estimate
 * never fabricates bytes.
 */
export function estimatePushBytes(files: PushFile[]): number {
 let bytes = 0;
 for (const file of files) {
  bytes += (file.content?.length ?? 0) * 2;
 }
 return bytes;
}

/**
 * Fail closed: throw a PushBudgetError when the estimated size
 * exceeds the budget. Callers invoke this BEFORE any wire call, so
 * an over-budget push never leaves the box. The budget is the
 * inclusive ceiling: exactly-at-budget passes.
 */
export function assertPushBudget(estimatedBytes: number): void {
 if (estimatedBytes > PUSH_BUDGET_BYTES) {
  throw new PushBudgetError(estimatedBytes);
 }
}
