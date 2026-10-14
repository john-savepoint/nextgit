// nextgit-platform — silent-drop guard (post-merge behavioral
// verification).
//
// The law (CONTRACT §POST /land, "Silent-drop guard"): every content
// contribution a proposal makes to a folded TEXT path must be present
// in the fold's final state for that path — otherwise the fold
// silently dropped it. The fold (computeMerge) applies proposals in
// order into a running `ours`; three drop classes exist at that seam
// and NONE of them sets `conflicted`:
//
//   D1 modify/delete — a proposal modifies src/x.ts, a later proposal
//      removes it: the removal runs unconditionally over the
//      modification and the fold reports `clean` while the added
//      content vanishes (the seeded-feature-drop class). The reverse
//      order resurrects the file; the removal intent vanishes.
//   D2 net-cancel — a later proposal reverts an earlier one's
//      contribution, so the merged result reproduces the base and the
//      emission loop drops the path entirely; with every path so
//      dropped, /land would answer the misleading `no-changes`.
//   D3 non-text rows — secret/pointer/binary writers are absorbed
//      last-write-wins by design; there is no text to verify, so they
//      are excluded by construction (never contributions, never drops).
//
// This module is a PURE function over (contributions, finalStates):
// no imports, no env, no IO — trivially testable and trivially
// auditable. computeMerge captures the contributions while folding
// (forLand only) and feeds the folds' own final states in; handleLand
// refuses with 409 silent-drop-detected before anything is pushed.
//
// The contribution model mirrors the fold's own 3-way semantics: a
// proposal's contribution to a path is the set of non-blank lines
// present in its head text but nowhere in the fork-point ancestor
// (a set difference — no diff library, deterministic). A proposal
// that only REMOVES a path contributes nothing textual; its intent is
// checked against the final ACTION (a later write reintroduces it).

/** Closed vocabulary of silent-drop classes (CONTRACT §POST /land). */
export type DropCause = "file-removed-in-fold" | "file-reintroduced-in-fold" | "lines-absent-in-fold";

/** One detected silent drop — the evidence row the 409 carries. */
export interface DropEvidence {
 /** The proposal whose change was dropped. */
 repo: string;
 /** The folded path the change was lost on. */
 path: string;
 cause: DropCause;
 /** The dropped lines (≤ MAX_DROP_LINES; empty for whole-file causes that carry none). */
 missing: string[];
 /** The proposal that absorbed the change, or null when no single writer is attributable. */
 byRepo: string | null;
}

/** One proposal's content contribution to one folded text path. */
export interface Contribution {
 repo: string;
 path: string;
 /** The 3-way ancestor text (the fork-point text; "" for added files). */
 ancestor: string;
 /** The proposal's head text for the path. */
 head: string;
 /** true = the proposal REMOVES the path (a delete intent, no text). */
 removed: boolean;
}

/** The fold's final state for one path (built from the fold itself). */
export interface FinalState {
 action: "write" | "delete";
 /** The final folded text; null for a delete. */
 text: string | null;
 /** Advisory attribution — the last proposal that wrote the path. */
 byRepo: string | null;
}

/** Per-row cap on the `missing` line list (NFR-1 bounded evidence). */
export const MAX_DROP_LINES = 8;
/** Cap on the drops array the 409 carries (NFR-1 bounded evidence). */
export const MAX_DROPS = 50;

/**
 * Non-blank, de-duplicated lines present in `head` but nowhere in
 * `ancestor` — a proposal's textual contribution to a path. A set
 * difference over lines, so it is deterministic and diff-library-free.
 * Blank lines are ignored (they carry no content); duplicates inside
 * `head` collapse (the contribution is a set, not a multiset).
 */
export function contributedLines(ancestor: string, head: string): string[] {
 const ancestorLines = new Set<string>();
 for (const line of ancestor.split("\n")) {
  const trimmed = line.trim();
  if (trimmed) ancestorLines.add(trimmed);
 }
 const seen = new Set<string>();
 const added: string[] = [];
 for (const line of head.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || seen.has(trimmed) || ancestorLines.has(trimmed)) continue;
  seen.add(trimmed);
  added.push(trimmed);
 }
 return added;
}

/**
 * Detect every silently-dropped contribution. For each contribution:
 *
 *  - `removed:false` (the proposal wrote text): compute its added
 *    lines over the ancestor; no added lines → nothing to lose, skip.
 *    Final `delete` → the whole contribution was dropped
 *    (`file-removed-in-fold`, `missing` = the added lines). Final
 *    `write` → `missing` = the added lines absent from the final text;
 *    non-empty → `lines-absent-in-fold`.
 *  - `removed:true` (the proposal deleted the path): if the final
 *    action is `write`, the removal was silently reversed
 *    (`file-reintroduced-in-fold`, `missing` empty — intent, not text).
 *
 * Output is sorted by `(path, repo, cause)` for determinism and
 * truncated to MAX_DROPS.
 */
export function detectDroppedChanges(
 contributions: Contribution[],
 finalStates: Map<string, FinalState>,
): DropEvidence[] {
 const drops: DropEvidence[] = [];
 for (const c of contributions) {
  if (c.removed) {
   const finalState = finalStates.get(c.path);
   if (finalState && finalState.action === "write") {
    drops.push({ repo: c.repo, path: c.path, cause: "file-reintroduced-in-fold", missing: [], byRepo: finalState.byRepo });
   }
   continue;
  }
  const added = contributedLines(c.ancestor, c.head);
  if (added.length === 0) continue;
  const finalState = finalStates.get(c.path);
  if (!finalState) continue;
  if (finalState.action === "delete") {
   drops.push({ repo: c.repo, path: c.path, cause: "file-removed-in-fold", missing: added.slice(0, MAX_DROP_LINES), byRepo: finalState.byRepo });
   continue;
  }
  const finalLines = new Set<string>();
  for (const line of (finalState.text ?? "").split("\n")) {
   const trimmed = line.trim();
   if (trimmed) finalLines.add(trimmed);
  }
  const missing = added.filter((line) => !finalLines.has(line));
  if (missing.length > 0) {
   drops.push({ repo: c.repo, path: c.path, cause: "lines-absent-in-fold", missing: missing.slice(0, MAX_DROP_LINES), byRepo: finalState.byRepo });
  }
 }
 drops.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0));
 return drops.slice(0, MAX_DROPS);
}
