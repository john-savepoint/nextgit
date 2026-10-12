// nextgit-platform — the six-cluster fork-signals computation (CAP-10).
//
// The single computation surface both POST /intents (wave 10) and the
// future GET /forks (wave-11) consume — one writer, no divergence.
// The computation moved here verbatim from index.ts (nextgit-e13-impl-
// six-cluster-fork-signals) with one structural fix: `distance` now
// reuses `forkPoint()`'s resolved fork point (exposed as
// `computeChangeSet().base.sha` — distance reads that SHA and never
// re-walks the log) and the `classifyPair()` conflict kinds (the
// inline version only read computeMerge's aggregate `conflicted[]`,
// never the typed conflict-kind surface). No behavior change to the
// other five clusters: fit/liveness/proof/cost formulas move as-is.

import {
 computeChangeSet,
 computeMerge,
 forkPoint,
 classifyPair,
 KIND_SEVERITY,
 type ConflictKind,
 type ProposalEntry,
 MAX_FILES_WITH_PATCH,
 FORK_LOG_LIMIT,
 type Env,
 DEFAULT_REF,
} from "./index";

/** The six-cluster signal vector one candidate fork carries (CAP-10). */
export interface SixClusterSignals {
 fitOverlap: number | null;
 peopleTrust: number | null;
 liveness: number | null;
 proof: number | null;
 distance: number | null;
 costToAdoptVsRegenerate: number | null;
}

/**
 * The shared six-cluster computation seam (CAP-10): per candidate
 * fork, a pure extraction over the EXISTING read seams —
 * computeChangeSet (fit/distance over the fork-point change-set),
 * computeMerge (the fold's conflict surface), the fork repo's own
 * log (liveness/proof). Every cluster is a typed number or null
 * (unmeasured) — the wire carries values, never prose.
 *
 * Trust law (AD-4): repo content is untrusted. Secret-class paths
 * contribute key names only (computeChangeSet's own masking); no
 * secret-class value may enter matcher state or any log.
 */
export async function computeSixClusterSignals(
 env: Env,
 base: string,
 ref: string,
 name: string,
): Promise<SixClusterSignals> {
 // fitOverlap: the fork-point change-set's size against the
 // platform's per-change-set patch budget — a fork that changed
 // few files against the base overlaps more of the declared work.
 const changeSet = await computeChangeSet(env, base, ref, name, ref, { includeTexts: true });
 const fileCount = changeSet.stats.files;
 const fitOverlap = fileCount === 0 ? null : Math.max(0, 1 - fileCount / MAX_FILES_WITH_PATCH);
 // liveness: commit cadence over the fork's first-parent log
 // (recency of the newest commit; a stale fork drifts toward 0).
 using forkRepo = await env.ARTIFACTS.get(name);
 const forkLog = await forkRepo.log({ ref, limit: FORK_LOG_LIMIT });
 const newestAt = forkLog.length ? forkLog[0].authoredAt : 0;
 const ageDays = newestAt ? (Date.now() / 1000 - newestAt) / 86400 : Infinity;
 const liveness = forkLog.length === 0 ? null : Math.max(0, 1 - ageDays / 30);
 // proof: the session trail the change-set carries (commit count).
 const proof = changeSet.commits.length === 0 ? null : Math.min(1, changeSet.commits.length / 10);
 // distance: the fold's conflict surface, measured over the
 // classifyPair conflict kinds — the conflict cost of joining
 // the fork onto the base, aggregated as the MAX over the
 // fork's changed files (the surface is driven by its worst
 // file). The fork point is the one forkPoint() resolved
 // inside computeChangeSet (exposed as changeSet.base.sha —
 // distance reads that SHA and never re-walks the log). The
 // pair is the exact one computeProposals constructs for a
 // shared file: base-side at the fork point's base text
 // (changeSet.texts[path].base), fork-side at its head text
 // (changeSet.texts[path].head). Files with no pair (secret-
 // class / binary / pointer rows keep no texts entry) fall
 // back to the fold's aggregate conflicted share, so
 // single-sided change-sets keep today's distance semantics.
 const fold = await computeMerge(env, base, ref, [name], ref);
 const foldFiles = fold.files.length;
 const foldShare = foldFiles === 0 ? 0 : fold.conflicted.length / foldFiles;
 let worst = 0;
 for (const f of changeSet.files) {
  const texts = changeSet.texts[f.path];
  if (!texts) continue; // no text pair (secret/binary/pointer row) — fold share carries it
  const baseEntry: ProposalEntry = { repo: base, status: f.status === "added" ? "added" : "modified", texts: { base: texts.base, head: texts.base } };
  const forkEntry: ProposalEntry = { repo: name, status: f.status === "removed" ? "removed" : f.status, texts: { base: texts.base, head: texts.head } };
  const { kind } = classifyPair(baseEntry, forkEntry);
  const severity = KIND_SEVERITY[kind as ConflictKind] / 4;
  if (severity > worst) worst = severity;
 }
 const distance = Math.min(1, Math.max(worst, foldShare * 2));
 // costToAdoptVsRegenerate: the adopt cost (conflict surface plus
 // the non-overlapping share of the change-set) against the
 // regenerate cost (rebuild from scratch).
 const adoptCost = distance * 0.6 + (fitOverlap === null ? 0 : (1 - fitOverlap) * 0.4);
 const costToAdoptVsRegenerate = Math.max(0, Math.min(1, 1 - adoptCost));
 // peopleTrust: unmeasured in the platform (no signed-identity
 // seam yet) — null by the typed-null law, never a fabricated 0.
 const peopleTrust = null;
 return {
  fitOverlap,
  peopleTrust,
  liveness,
  proof,
  distance,
  costToAdoptVsRegenerate,
 };
}
