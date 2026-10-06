# PRD Quality Review — NextGit

*Rubric: `bmad-prd/assets/prd-validation-checklist.md`. Read in full: `prd.md` (868 lines) and `addendum.md`. Stakes calibrated: launch-grade, chain-top (feeds UX → architecture → stories), competition gate in 8 days, brownfield (a large share of FRs are `built`).*

## Overall verdict

This PRD is unusually earned for its stage: every FR carries "Consequences (testable)", statuses separate shipped from scheduled, the resolved-decisions block is real, and the non-goals do work. What's at risk is not the product content but the frame around the build and the extraction surface: the Oct 14 critical path (submission package not started, two Required workstreams) is listed but never framed as a decision, the §7.5 auth gate has no owner or criteria, and three defects will trip downstream story creation — FR-18's evidence artifact has no defined API surface, §5 and §13.2 contradict each other on whether repo browsing/issues are roadmap or permanent non-goals, and §0's promised status vocabulary is not the one the FRs actually use. All fixable in one short pass; none of it invalidates the corpus this PRD references.

## Decision-readiness — adequate

The decision content is mostly real: §14 retires four OQs with their resolutions and date (R2 in scope → FR-47; elevated reveal deferred behind the auth seam; real-time required; rich landing evidence required), tensions are surfaced rather than smoothed (§7.2: "Write protection is ours to enforce… The platform never assumes a platform guard it does not have"; FR-30's documented path-driven masking limitation), and SM-C1–C3 guard the metrics against gaming. A reader can act on most of it. What's missing is the decision that dominates the next eight days.

### Findings

- **[high] The Oct 14 critical path is listed, never framed as a decision (§13.1; FR-39, FR-41)** — The submission package is "not started (gate requirement)" (FR-41) and "submission packaging not started" (FR-39), while two M1 items are "Required" (FR-22 real-time transport; FR-16…FR-18 land hardening) and the scope note calls M1 "deliberate, noted extensions" beyond the five MUSTs. Nowhere does the PRD say what yields if the deadline binds, who owns the submission package, or that SM-1/SM-2 — the primary metrics — fail without these items. *Fix:* add a PM callout in §13.1: critical path, owner, and the fallback ordering if any Required item slips.
- **[medium] The §7.5 gate defers the auth decision without an owner, date, or option set** — "the authentication approach must be decided before Milestone 2 begins — earlier if any Milestone-1 feature depends on authenticated identity rows." "Before Milestone 2" has no calendar anchor, the candidate approaches (SSO? cookie sessions? token seam?) are not named, and no one is assigned. Compare with §14's retired OQs, which show what a decision record looks like. *Fix:* name the deciding role and the pre-M2 date; list the candidate approaches and the criteria for choosing.
- **[medium] Three consolidated adjudication gaps remain `[ASSUMPTION: pending intake]` with no forcing function (§2.1, §6 NFR-9/NFR-10, §10; OQ-6)** — Demo protagonist "John — a solo operator" vs "the brief's primary segment is teams + reviewer"; the concerns floor and the WCAG 2.2 AA target; the 12–50 scale band. These feed the four pending UX adjudications and M1 acceptance, yet sit as prose defaults. *Fix:* give each a decision-by date and an owner, or state explicitly that each is ratified as-is for M1 and revisited at the auth gate.

## Substance over theater — strong

No persona roster, no boilerplate. The Vision is numerically specific to this product (41.7% pair conflict across 33,596 PRs; 15–31% issue catch; named competitors with their beta/unshipped status), NFRs carry product-specific thresholds (30 s/5 min CPU, 1 GB/repo, 32 MB/file, 2k req/10 s, ~64 MiB push cap, 209 ms/39 ms judge latency, measured contrast ratios), and §10 bounds real paths. The judge-layer claims are receipted to code and a test suite. Two pieces of furniture remain.

### Findings

- **[low] §0's "Adapt-in clusters" paragraph is workflow bookkeeping** — "Adapt-in clusters pulled in beyond the Essential Spine, and why: …" addresses the BMad workflow, not the PRD reader; the same section promises a status vocabulary the FRs don't keep (see Downstream usability). *Fix:* cut or move to the addendum; keep the "builds on" artifact list and the Status-tag sentence.
- **[low] NFR-12 commits to twelve engineering laws without a coverage map** — "laws not yet carried as FRs ride as roadmap explicitly — L2…, L9…, L11…; the partially-represented laws remain binding." The three roadmap exceptions are named; which laws are "partially represented" and where is not. *Fix:* one line per law with its FR carrier or a "not carried" flag, or cite the mapping artifact directly.

## Strategic coherence — strong

The thesis is stated and load-bearing — "the set is the unit of review", "the convergence layer" (§1) — and the feature set serves it rather than reading as a backlog: set view → change-set engine → landing → events → judge → trust → onboarding, each realized through UJ-1/2/3, with roadmap (fork community, asset tier, clients) extending the same arc. Success metrics validate the thesis rather than activity, and counter-metrics are present and specific. Prioritization follows the competition's rubric rather than "easy first".

### Findings

- **[low] The Vision's waste claim has no metric** — §1 asserts "Duplicated effort compounds the waste — the same fix attempted across several forks, agent compute spent twice or thrice", but its only carriers are FR-46 (Milestone 4) and the conflict map; SM-1…SM-4 measure the demo, comprehension, and adoption, not redundant work. *Fix:* add a counter-metric (e.g., matched-intent joins per week once FR-46 ships) or tag the waste claim as directional framing.

## Done-ness clarity — adequate

Coverage is near-exemplary: all 47 FRs carry "Consequences (testable)" with exact copy, HTTP codes, enum values, counts, and bounds — a downstream story pass can extract acceptance criteria from almost every FR without invention (FR-15's outcomes, FR-10's fork-point semantics, FR-47's pointer contract). The misses cluster in the land-hardening slice — the "most important" M1 work per John's corrections — and in P1/pending FRs.

### Findings

- **[high] FR-18's evidence artifact has no defined surface or shape** — The consequence promises "an evidence artifact attached to the landing record, readable through the API", but no route carries it: FR-43 pins "seven routes live" and `platform/CONTRACT.md`'s `POST /land` response carries only `landed {repos, commit, files, at}`. FR-42 makes shipping an undocumented shape a discipline violation, so an M1-required FR currently resolves to a sentence. *Fix:* name the read surface and the contract bump (an eighth route or an extended landing record), or state that the shape is deferred to a named land-hardening contract change.
- **[medium] FR-15's outcome set is unstable and under-specified at the P0 boundary** — The title promises "seven landing outcomes"; the status line adds "P0 (outcomes for `stale`, `base-moved`)", which are not among the seven and will make nine; no banner copy is specified for them, while FR-16/FR-17 are M1-required and UJ-1's edge case rehearses the failures. *Fix:* treat the outcomes as an open, numbered set; add the two P0 copies (or fold them into FR-16/FR-17's consequences).
- **[medium] FR-27 has no acceptance criterion** — "Judge thresholds are tuned on our own labeled proposals before any gating is trusted"; "the first version ships advisory-only until the calibration record exists." What a calibration record must contain (set size, labels, target accuracy), and who signs it off, is exactly what OQ-5 asks — the FR restates the question instead of bounding the work. *Fix:* define the record's minimum contents and the pass criteria for engaging the gate.
- **[medium] FR-36's credential bounds are adjectives** — "single-use, minutes-scale TTL" and "agent tokens are hours-scale"; "mint/use/revoke are audited" names no audit surface. Rubric: bounds, not adjectives. *Fix:* state both TTLs numerically and name where mint/use/revoke are recorded.
- **[low] FR-24's caps are unquantified** — "Per-caller budget and rate caps apply (429 when exceeded)" — no numbers, so built behavior cannot be verified against the PRD. *Fix:* pin the constants (or cite the code constants with current values).

## Scope honesty — adequate

The apparatus is mostly honest: §5 non-goals, inline `[NON-GOAL]` / `[SEQUENCED]` callouts, a scope note admitting M1 extensions, retired OQs marked resolved, and an assumptions index that roundtrips almost fully (see Mechanical notes). The reader is not meant to infer omissions. Two scope facts are still mis-stated or unstated.

### Findings

- **[high] §5 and §13.2 contradict each other on repo browsing / issues / CI / profiles** — §5: "No repo browsing, issues, CI, profiles … — roadmap, not v1." §13.2: "Remain non-goals (§5) — not scheduled in any milestone: Repo browsing / issues / CI / profiles … a deliberate non-goal per §5." One says future roadmap, the other says never scheduled; downstream story creation and any GitHub-shaped reader will read the first. *Fix:* pick one status — "permanent non-goal" fits §5's opening and §2.2 — and make §13.2 cite it accurately.
- **[medium] The M1 scope note admits extensions but carries no contingency** — "*[SCOPE NOTE: … deliberate, noted extensions.]*", plus FR-39's "submission packaging not started", plus two Required workstreams, means the reader must infer schedule risk silently. *Fix:* add the fallback ordering (what drops, what can't) to §13.1.
- **[medium] The document's only `[NOTE FOR PM]` sits at a mid-stakes tension while the high-stakes ones go unmarked** — §13.2's repo-browsing note is real, but the auth gate (§7.5), the contrast decision (NFR-9: "raising them is a pending decision"), and the critical path read as settled prose. *Fix:* add PM callouts at those three points.

## Downstream usability — adequate

The glossary, global FR numbering, UJ/SM traceability, and per-FR consequences make source extraction feasible — better than most chain-top PRDs. But the extraction contract is not quite enforced by the document itself.

### Findings

- **[medium] §0's promised status vocabulary is not the vocabulary in use, and several FRs are unsequenced** — §0: "every FR carries a status tag — **built**, **P0**, **P1**, **roadmap**, or **build-gap** — plus its milestone sequencing (§13)". Actual statuses include "required for Milestone 1" (FR-18, FR-22), "roadmap-staged" (FR-26), "pending" (FR-27), "not started (gate requirement)" (FR-41), "sequenced — Milestone 2/3/4" (FR-31, FR-46, FR-47). And FR-21's P1 dedupe/validation, FR-26/FR-27, and FR-30's content detection appear nowhere in §13. A story-generation pass that greps for the promised tags will silently drop work. *Fix:* normalize statuses to the declared set plus a milestone field; add the missing FRs to §13 or to a "roadmap, unsequenced" list.
- **[low] The UJ traceability tail is incomplete** — FR-30, FR-31, FR-39, and FR-42–FR-47 carry no "Realizes UJ-x" line while FR-1–FR-29 almost all do. For platform/API FRs that may be correct (they serve all UJs), but the pattern break is silent. *Fix:* add "Realizes UJ-1 through UJ-4" for platform FRs or state the convention.
- **[low] §13.1's "Built" ranges conflict with per-FR statuses** — "(Built — FR-1 … FR-13, FR-32, FR-34.)" includes FR-7, whose own status is "build-gap (specified; not yet built)" — acknowledged two bullets later. Cross-checking is forced on the reader. *Fix:* qualify the ranges ("built, except FR-7") or drop ranges in favor of FR statuses.

## Shape fit — strong

Shape matches the product and the stakes. It is brownfield, so as-built statuses and build-gap callouts are load-bearing — present, and accurate to spot checks (`platform/CONTRACT.md`, `platform/src/judge.ts`, `docs/judge-layer-ideas.md`, `demo-scope.md`, `engineering-laws.md`, `EXPERIENCE.md`/`DESIGN.md` all exist). Four UJs with a named protagonist are justified — the demo narrative is judged (UX 25%) and UX is a downstream consumer — and the adapted sections (Why Now, Platform, Performance Budgets, Aesthetic) do real work rather than decorate. Competition logistics (§7.1, FR-41) are correctly framed as constraints, not product scope. No over- or under-formalization found.

(no findings)

## Mechanical notes

- **ID continuity:** FR-1…FR-47, UJ-1…UJ-4, SM-1…SM-4 + SM-C1…C3, NFR-1…NFR-12, OQ-1…OQ-10 (1–4 retired by design, explicitly not reused), CAP-1…CAP-10 — all contiguous and unique; no duplicate IDs found.
- **Cross-references resolve:** internal section refs (§7.5, §13.2, §15) and AD-1…AD-11 all resolve; referenced artifacts exist on disk (spot-checked CONTRACT.md, judge.ts, judge-layer-ideas.md, demo-scope.md, engineering-laws.md, docs/STATE.md, EXPERIENCE.md, DESIGN.md). One undefined domain noun: FR-46's "six-cluster signals" ("Fork cards carry the six-cluster signals that drive matcher verdicts") — defined nowhere in the PRD or addendum index; point to `fork-community.md` or enumerate.
- **Assumptions Index roundtrip:** 11 inline `[ASSUMPTION]` tags and 11 index entries, with one orphan index entry — "§12 — Adoption-signal metrics (SM-4) remain directional…" has no inline tag at §12 — and one mapping quirk (the §5 concerns-floor inline tag is indexed under "§6 NFR-10").
- **UJ protagonist naming:** UJ-1–3 name John; UJ-4's protagonist is "a first-time reviewer (or a judge in the competition video)" — unnamed.
- **Glossary drift:** "crew" (L40 "The agent crews (`agent-1` … `agent-4`) are workers."; L54–56 "four concurrent crews") is a synonym for workspace/agent group absent from the Glossary, violating §3's own rule ("Introducing a synonym anywhere is a discipline violation"). "Fleet" is used only as declared market language and never as a defined term in FRs — acceptable per §4.1.
- **Typo:** FR-43 "rated-limited per caller" → "rate-limited".
- **Required sections:** all present for the stakes (Vision; Target User + UJs; Glossary; Features + FRs; Non-Goals; NFRs; Constraints; Why Now; Platform; Performance Budgets; Aesthetic; Success Metrics; Milestones; Open Questions; Assumptions Index).
