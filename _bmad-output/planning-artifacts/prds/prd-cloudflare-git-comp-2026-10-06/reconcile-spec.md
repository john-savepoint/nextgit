# Reconcile — frozen SPEC + companions vs PRD (Finalize step 2)

Sources: `_bmad-output/specs/spec-next-git-platform/SPEC.md`, `demo-scope.md`, `engineering-laws.md` (read-only) → `prd.md` + `addendum.md`.
Verdicts: **covered** (FR carries the capability's success criterion), **partial** (FR exists; a success-criterion element is deferred, weakened, or absent), **missing** (no PRD FR).

## 1. CAP coverage

| Cap | PRD location | Verdict | Notes (success criterion) |
|---|---|---|---|
| CAP-1 Concurrent workspaces | §4.7 FR-34 (-36); §4.3 FR-17 | covered | One command + scoped tokens + independent pushes + push event all in FR-34 consequences; N=4 live. Token lifecycle hardening P1 (FR-36) but no criterion loss. |
| CAP-2 Change-set capture | §4.2 FR-9, FR-10; NFR-1 | covered* | *Criterion says "per-fork commit list + per-file diffs"; FR-9 requirement claims commits but consequences enumerate only identities/stats/per-file rows — commit enumeration not explicit in PRD text (contract has it). |
| CAP-3 Conflict detection | §4.2 FR-11; §4.1 FR-4 | covered | Map + enumerated kinds (structural modify/delete, add/add + textual text-conflict); deliberate collision in demo story (FR-39, SM-2). |
| CAP-4 Set-level triage | §4.1 FR-1…FR-8; SM-3 | covered | One canvas, no paging/collapse (FR-1), card anatomy (FR-2), chips (FR-3), collision map (FR-4); selection-to-land path FR-14. |
| CAP-5 Intent records | §4.6 FR-32, FR-33; UJ-1 | covered | Card rationale (FR-2/FR-32), notes survive rebase; as-built mirror (`nextgit-notes`) rather than direct `refs/notes` reads — canon-consistent (binding-side notes resolution unsupported). |
| CAP-6 Live event pipeline | §4.4 FR-20…FR-22 | **partial** | Pipeline push→queue→worker→UI built (FR-21) at 2 s polling; "push-style, no polling, visibly beating a 90 s poll" is P1 (FR-22) and the 90 s benchmark appears nowhere — carried as OQ-3. |
| CAP-7 Landing path | §4.3 FR-14…FR-19 | **partial** | Merge-to-baseline built (FR-14); "evidence recorded / merged-SHA-equals-tested" is P0 (FR-18), today's receipt is short SHA — carried as OQ-4. |
| CAP-8 Trust layer | §4.6 FR-28…FR-31; §4.5 FR-23 | **partial** | Schema-only view + commit-time scrub built (FR-28/29); "elevated reveal" is roadmap/non-goal (FR-31) — carried as OQ-2. |
| CAP-9 Platform API for clients | §4.10 FR-42…FR-45 | **partial** | Route surface + contract discipline built; 11-entity protocol P1 (FR-44); "external client renders / Agent Office replaces GitHub as backing store" is non-goal MVP — no adapter FR. |
| CAP-10 Fork community + intent router | — | **MISSING** | No mention anywhere in prd.md (only addendum's corpus index + `.working/arch-extract.md` note "CAP-10 deferred"). SPEC says post-demo, but the PRD gives it no roadmap hook, no matcher/verdicts/six-cluster trace. |

## 2. Demo-scope MoSCoW coverage

| Item | PRD FR | Verdict |
|---|---|---|
| MUST · set-level triage canvas (CAP-4) | FR-1…FR-8 | covered |
| MUST · concurrent agent workspaces (CAP-1) | FR-34, FR-35 | covered |
| MUST · cross-proposal conflict map (CAP-3) | FR-4, FR-11 | covered |
| MUST · per-proposal intent record (CAP-5) | FR-32, FR-33 | covered |
| MUST · live push events to UI (CAP-6) | FR-20…FR-22 | **partial** — polling fallback only; push transport P1 (OQ-3). |
| SHOULD · secret-typed files (CAP-8) | FR-28…FR-31 | covered for masking/scrub (demo beat 6); reveal excluded (OQ-2, SPEC demo story also omits reveal). |
| SHOULD · speculative validation (CAP-7) | FR-13, FR-16, FR-18 | **partial** — preview + reviewed-state precondition built; "validation" evidence is P0 (OQ-4); no explicit speculative-validation FR. |
| SHOULD · git-notes provenance (CAP-5) | FR-32, FR-33 | covered |
| SHOULD · authoring lease (CAP-5) | FR-32 (one pusher per repo), FR-17 (DO lease) | **partial** — single-pusher rule built; DO lease P1. |
| SHOULD · change-set identity (CAP-2) | FR-9 (baseline/head identities), FR-10 (fork-point stability) | covered |

Demo story (one take) is fully realized in UJ-1 + FR-14/32/28/29; rubric mapping echoed in SM-1/§7.1.

## 3. Engineering-laws check (one line per law)

1. Convergence central act — **covered** (§1 vision, FR-1…FR-8, SM-C3 "whole set stays the surface").
2. Two-tier intelligence — **unrepresented**: no FR for System-1 sweep (classify/type/tag/lint every file); judge layer (P0) reads proposals, not files.
3. Self-describing platform — **covered** (FR-35: machine-readable tool manifest + structure map into every workspace).
4. Repo answers for itself — **partial**: no-clone path (NFR-1), provenance (FR-33), merge preview (FR-13), tour; no semantic-index or native-demos FR.
5. Agents inspect just enough — **partial**: structure map only (FR-35); no semantic index.
6. Locks are surgical — **partial**: FR-17 relies on head-re-read + optional DO lease; no scoped/expiring/advisory lock FR; not contradicted (no fleet-wide serialization requirement).
7. Contribution standard as a service — **partial**: commit-message convention (FR-43) + intent standard (FR-32); no platform-side lint/conventions/changelog enforcement (auto-changelog is demo COULD).
8. Ambient capability — **partial**: single surface/no tabs (FR-1), click-first (FR-8); "GitLens-class parity" is demo-COULD and absent as an FR.
9. Work-item ↔ change-set linkage — **unrepresented**: no FR; Issue appears only inside the P1 11-entity protocol (FR-44); PM is out of v1 (§5).
10. Integrate PM, don't imitate — **partial**: direction kept (§5 "PM tools integrate via API later"); milestones/epics as first-class checkout-able objects are roadmap, no FR.
11. Always-on decision layer — **unrepresented**: judge is per-proposal hot-path (P0), not continuous System-1; no CI/CD-driving FR; SPEC itself defers always-on mesh this phase (PRD §5 non-goal — deferred, not contradicted).
12. Workspaces woven through the experience — **partial**: landing transparency strong (FR-14/15/19, FR-13); workspace provisioning is operator-facing (FR-34/35), not woven UI.

Swarm rules R1–R4: R1/R3 partially reflected (single-pusher/refs discipline, status conventions); R2/R4 have no requirement surface (R4 belongs to missing CAP-10).

## 4. Constraints coverage (SPEC → PRD)

| SPEC constraint | PRD carrier | Verdict |
|---|---|---|
| Competition gate: Workers + Artifacts mandatory; concurrent agents; 5–10 min video + OSI license + run instructions; due 2026-10-14; 50/25/25 rubric; single entry; Connect SF Oct 21; US/Canada eligibility | §7.1, FR-41, SM-1 | covered — eligibility updated to resolved (US-resident teammate files); SPEC's unresolved status is closed per addendum/STATE. |
| Artifacts limits: 1 GB/repo · 32 MB/file · 2k req/10 s · no server-side merge/diff/conflict/branch protection | NFR-2 | covered (all four). |
| Artifacts push: ~64 MiB cap; v1-only; `refs/notes/*`; events via Queues | NFR-2, FR-32, FR-21 | covered (isomorphic-git 1.42.x pin dropped as impl detail; 64 MiB "fix ETA" watch item not carried — see drops). |
| Workers compute: 30 s/5 min; no Windows/GPU/macOS; review path never clones | NFR-1, §5 (orchestrate, never host; roadmap), FR-9 | covered. |
| Demo sprint: ships exactly the five MUSTs; ~10 days; everything else roadmap | §13, FR statuses | partial — five MUSTs all present, but PRD MVP scope also carries built extras (tour FR-37/38, scripts) and P0 judge; judge is "later increment"-compatible, tour is unlisted in demo-scope COULD/WON'T (scope note, not violation). |
| Real platform only, no mocks | §7.1, FR-39 | covered. |
| Design constitution: every build decision answers to the twelve laws | FR-35, FR-36 (two isolated citations) | **partial** — no consolidated laws commitment; laws 2/9/11 unrepresented, 4/5/6/7/8/10/12 partial (§3). |

## 5. Contradictions, drops, qualitative losses

**Canon corrections re-inherited?** No re-inherited contradiction found. All five superseded draft-brief claims are carried in corrected form (addendum §3 verified): as-built labels; judge not live; polling honest + OQ-3; path-driven masking; evidence = P0 + OQ-4. Canon-internal tensions (R2 boundary, reveal) are flagged, not silently resolved (OQ-1, OQ-2).

**Qualitative drops / flags (do not fix here):**
- CAP-10's narrative (join-don't-restart reflex, matcher verdicts, six-cluster fork cards) has zero PRD trace, not even a roadmap FR — PRD's only pointer is addendum's corpus index.
- SPEC CAP-6's proof form ("visibly beating a 90 s poll") absent; SPEC CAP-2's "commit list" and CAP-7's "validation evidence" weakened by status (P0).
- SPEC open questions not carried into PRD §14: submission repo location; 64 MiB push-cap watch item. (Harness OQ is resolved by FR-35/FR-39; card-signal OQ effectively answered by FR-2/FR-23.)
- Law vocabulary (System-1, always-on, self-describing) almost absent from requirements; only FR-35/FR-36 cite the constitution.
- PRD adds concerns-floor NFRs (a11y, dark-only) not present in SPEC constraints — additive, no conflict.

## 6. Verdict

- **CAPs:** 5 covered · 4 partial (CAP-6/7/8/9) · **1 missing (CAP-10)**.
- **Demo scope:** MUST 4 covered / 1 partial; SHOULD 3 covered / 2 partial; 0 missing.
- **Laws:** 2 covered · 7 partial · 3 unrepresented (L2, L9, L11).
- **Constraints:** 5 covered · 2 partial (demo-sprint scope note; design constitution).
