// nextgit-platform — the six-cluster fork-signals computation (CAP-10).
//
// The single computation surface both POST /intents (wave 10) and the
// future GET /forks (wave-11) consume — one writer, no divergence.
// The computation moved here verbatim from index.ts (nextgit-e13-impl-
// six-cluster-fork-signals) with one structural fix: `distance` now
// mirrors `computeMerge`'s per-file 3-way fold (ancestor = the
// fork-point base text, ours = the CURRENT base head, theirs = the
// fork head — the exact three sides computeMerge reads) instead of
// the inline version's aggregate `conflicted[]`, and consults the
// `classifyPair()` conflict kinds. No behavior change to the other
// five clusters: fit/liveness/proof/cost formulas move as-is.

import {
 computeChangeSet,
 computeMerge,
 classifyPair,
 KIND_SEVERITY,
 type ProposalEntry,
 MAX_FILES_WITH_PATCH,
 FORK_LOG_LIMIT,
 type Env,
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
 // file). The fork point is the one computeChangeSet resolved
 // (the fold reads the same fork point). The pair is the one
 // the fold uses for this file: the CURRENT base head (ours)
 // against the fork-point base (ancestor) and the fork head
 // (theirs) — the exact 3-way computeMerge performs. Files
 // with no text pair (secret/binary/pointer rows keep no texts
 // entry) fall back to the fold's aggregate conflicted share.
 const fold = await computeMerge(env, base, ref, [name], ref);
 const foldFiles = fold.files.length;
 const foldShare = foldFiles === 0 ? 0 : fold.conflicted.length / foldFiles;
 let worst = 0;
 // The pair is the one computeMerge's fold uses for this file:
 // the CURRENT base head (ours) against the fork-point base
 // (ancestor) and the fork head (theirs) — the exact 3-way the
 // fold performs (mirrors computeMerge, index.ts:368-378,411;
 // NOT a base-vs-fork synthetic pair — computeProposals never
 // pairs against the base).
 using baseRepo = await env.ARTIFACTS.get(base);
 for (const f of changeSet.files) {
  const texts = changeSet.texts[f.path];
  if (!texts) continue; // no text pair (secret/binary/pointer row) — fold share carries it
  // `ours` = the CURRENT base head's text (the reviewer's
  // frame); null when the base no longer has the path.
  // `ancestor` = the fork-point base text (the 3-way
  // ancestor the fold uses).
  const ancestor = f.status === "added" ? "" : (texts.base ?? "");
  const baseBlob = await baseRepo.readFile({ ref, path: f.path });
  const oursBytes = baseBlob ? new Uint8Array(await baseBlob.arrayBuffer()) : null;
  const ours = oursBytes && !(oursBytes.subarray(0, Math.min(oursBytes.length, 8000)).some((b) => b === 0))
   ? new TextDecoder().decode(oursBytes)
   : null;
  // A clean single-sided change folds without conflict:
  //   removed — base still has it (computeMerge: fold.conflicted=false)
  //   added   — base lacks it (genuinely new file, no add/add)
  if (f.status === "removed") continue;
  if (f.status === "added" && ours === null) continue;
  // Build the two real sides the fold pairs: base (ours) vs fork
  // (theirs), both against the shared ancestor. A side the base
  // no longer has is a removal on that side -> modify/delete (the
  // real conflict class).
  const baseEntry: ProposalEntry = { repo: base, status: ours === null ? "removed" : "modified", texts: { base: ancestor, head: ours } };
  const forkEntry: ProposalEntry = { repo: name, status: "modified", texts: { base: ancestor, head: texts.head } };
  const { kind } = classifyPair(baseEntry, forkEntry);
  const severity = KIND_SEVERITY[kind] / 4;
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
