# Reconciliation — Product Brief → PRD (NextGit)

Verified: brief + addendum (`briefs/brief-cloudflare-git-comp-2026-10-06/`) against `prd.md` + `addendum.md` (this folder). Read-only on sources; this record flags, does not fix. Working date 2026-10-06.

Status legend: **Covered** (carried; canon corrections noted), **Partial** (carried in materially reduced form, or only in the PRD addendum/qualitative tier), **MISSING** (no carrier found).

## 1. Coverage map

### Brief §Executive Summary

| Claim | PRD location | Status |
|---|---|---|
| Bottleneck moved from writing to converging; one-change-at-a-time tools buckle on agent traffic | §1 ¶1–2; §2.1 | Covered |
| 33,596 agent PRs / ~41.7% pair conflicts / 15–31% frontier catch | §1; §8; add. §2 | Covered |
| Proposal carries intent, diff, collision status, provenance | §1; FR-2, FR-9–13, FR-32–33 | Covered |
| All proposals as one comparable set on a single surface | FR-1; FR-3; §4.1 | Covered |
| Platform-native judge layer (risk, intent-vs-diff, semantic collisions) — P0 build step | §4.5 (FR-23–27); §1; §13.1 | Covered (status pinned: planned P0, not live) |
| One-click server-side landing — no clones, no CLI | FR-14; §4.3 | Covered |
| Convergence-layer bet; no counterexample across six search efforts; GitGhost/Whiteboard/Entire | §1; §8 | Covered |
| Why now substrate: Artifacts + Workers/Queues/DO + Clef (39 ms/209 ms) | §8; §7.4; add. §2 | Covered |
| Built end-to-end on the stack; works today (real agents, proposals, collisions, landings) | SM-2; FR-34; §13.1 | Covered |
| Competition entry due Oct 14; adoption ambitions beyond | §7.1; SM-1, SM-4 | Covered |

### Brief §The Problem

| Claim | PRD location | Status |
|---|---|---|
| Concurrent work invisible until expensive; reviewer can't hold the set, see collisions, compare, reconstruct why | §1 ¶1; §2.1 | Covered |
| Duplicated effort compounds waste — same fix attempted across several forks | — (no mention anywhere in PRD) | **MISSING** |
| Trust gaps first-class: who wrote it / did the diff do what it claimed / is it a secret | FR-24, FR-28, FR-33; §2.1 | Covered |
| Status-quo costs: review queues bind shipping velocity; late-discovered conflicts; silent context loss | §2.1 (social); §1; SM-3; FR-32 | Covered |
| Cost line: wasted agent compute | — | **MISSING** |
| GitHub's own guidance pushes partitioning to humans ("be thoughtful about partitioning work") | §8 | Covered |

### Brief §The Solution

| Claim | PRD location | Status |
|---|---|---|
| "One screen — the fleet view" | §4.1 (naming corrected: Concurrent Proposals / Convergence Conflicts; "fleet" market language only) | Covered |
| Card = intent + touched + collision computed by attempting the merge + provenance | FR-2, FR-11, FR-33 | Covered |
| Compare set / preview landing / read diff / one-click ship server-side | FR-1, FR-13, FR-12, FR-14 | Covered |
| "…its validation evidence attached" | FR-18; FR-15 outcome 3; OQ-4 | Partial (corrected: receipt = short SHA today; evidence artifact only with land-hardening P0) |
| Isolated workspaces per agent (fork-per-agent on Artifacts) | FR-34; glossary "Workspace" | Covered |
| Live event flow (pushes appear in seconds — no manual refresh) | FR-5, FR-20, FR-22; OQ-3 | Covered (corrected: polling 2 s/8 s as-built; push transport P1 goal) |
| Decision-model judgments per proposal (risk, intent-vs-diff, semantic collision) landing with judge layer | §4.5; FR-23 | Covered |
| Trust layer: secret-class files as typed objects; key names visible, values never | FR-28–30; glossary | Covered |
| "What users feel: convergence — fleet work becomes tractable" | §1 ("the set the unit of review"); SM-3 | Partial (felt-quality framing compressed to a comprehension metric) |

### Brief §What Makes This Different

| Claim | PRD location | Status |
|---|---|---|
| Convergence layer unoccupied; rubric weights it most heavily | §1; §8; §7.1 (50% originality/prototype) | Covered |
| Native to the stack (Artifacts + Workers/Queues/DO + Clef inside, not bolted on) | §8; §4.5; §7.4 | Covered (DO/Workflows/R2 staged per AD-10 — see OQ-1) |
| [ASSUMPTION] Honest moat = timing, execution speed, unclaimed category | §8 assumption; §15 | Covered |
| API-first by construction; platform is the heart, clients are surfaces | §9 (bullets 2–3); FR-44 | Covered |
| Trust as a first-class layer, "not a compliance add-on"; no surveyed host treats secret files as typed, access-controlled objects | §4.6 (mechanics); add. §2 (whitespace claim) | Partial (positioning flourish + whitespace claim absent from PRD body; "access-controlled" term correctly not carried) |

### Brief §Who This Serves

| Claim | PRD location | Status |
|---|---|---|
| Primary: teams running agent fleets + reviewer/conductor | §2.1 | Covered |
| Their success: triage in minutes, ship with confidence, never late collisions | §2.1 (emotional JTBD); SM-3 | Covered |
| Secondary: game studios, harness builders, agents themselves; machine-legible first | §2.1; §4.7; FR-35 | Covered |
| [ASSUMPTION] Segment ordering inferred; validate with design partners | §2.1; §15 | Covered |

### Brief §Success Criteria

| Claim | PRD location | Status |
|---|---|---|
| Gate: 5–10 min video + OSS repo + run instructions; all three axes on real infra | §7.1; SM-1; FR-41 | Covered |
| Rubric: originality 50% / concurrency 25% / UX 25% | §7.1; FR-41 | Covered |
| Demo-scale proof: N≥4 agents, ≥1 genuine collision pre-land, landing with evidence, masking + provenance, reproducible scripts | SM-2; §10; FR-39, FR-34 | Partial (evidence→receipt corrected; remainder covered) |
| [ASSUMPTION] Fleet-scale target 12–50 agents | §10; OQ-6; §15 | Covered |
| Adoption signals: real API team use; second client renders live state; landed-per-week with attached evidence | SM-4 ("attached records") | Covered |

### Brief §Scope

| Claim | PRD location | Status |
|---|---|---|
| In: platform worker API (proposals, changes, merge/land, events) | §13.1; §4.10 | Covered |
| In: fleet-view UI + interactive tour | §13.1; §4.1; §4.8 | Covered |
| In: real-agent onboarding (omp, codex; more via harness routing) | FR-35; §13.1 | Covered |
| In: judge layer | FR-23–27; §13.1 (P0) | Covered |
| In: secret-typed files | FR-28; §13.1 | Covered |
| In: provenance via git notes | FR-32; §13.1 | Covered |
| In: reproducible demo scripts | FR-39; §13.1 | Covered |
| Out: repo browsing / issues / CI / profiles | §5; §13.2 | Covered |
| Out: game-industry binary-asset tier (R2, locking, per-file ACLs) | §5; §13.2; OQ-1 | Partial (PRD keeps "out"; AD-10 stages the R2 tier in-scope — boundary left open in OQ-1) |
| Out: 3D office client | §5; §9; FR-44 | Covered |
| Out: PM integrations | §5; §13.2 | Covered |
| Out: multi-tenant hardening | §5; §13.2; §7.3 | Covered |
| Out: billing | §5; §7.4 | Covered |

### Brief §Vision

| Claim | PRD location | Status |
|---|---|---|
| Fleet view becomes how teams think about concurrent agent work — the default surface | §1 (set as unit); SM-3 | Partial (long-horizon framing not carried) |
| Year 1: adopted by agent-heavy teams as convergence layer over existing repos | SM-4 (directional only) | Partial |
| Year 2–3: workspaces become the default home for agent work (local optional) | — | **MISSING** |
| Year 2–3: asset tier opens the game industry; clients multiply (web, IDE, office) | — (§13.2 keeps them out) | **MISSING** |
| Endgame: "make GitHub irrelevant" (directional) | — (§5 keeps only "not a GitHub clone"; grep: "irrelevant" absent) | **MISSING** |
| [ASSUMPTION] Near-term metrics stay demo- and adoption-scale | §12; SM-4 | Covered |

### Brief §Open Questions / Honest Unknowns

| Claim | PRD location | Status |
|---|---|---|
| Name is a working title | Title line; OQ-8 | Covered |
| Business model deferred (credits/seats/API pricing) | OQ-7; §7.4; §5 | Covered |
| Fleet-scale performance at 20–50 proposals = budget item (caching, incremental change-sets) | §10; OQ-6 | Covered |
| Judge-layer calibration before any gating is trusted | FR-27; OQ-5; SM-C2 | Covered |

### Brief Addendum

| Claim | PRD location | Status |
|---|---|---|
| Corpus index (SPEC, CONTRACT, dossiers, judge catalog, architecture, UX, loop records) | PRD add. §1 | Covered |
| Evidence pack (all sourced numbers incl. merge-queue incident 2,092/230/3 h 33 m; CF internal 131,246 runs/48,095 MRs/3 m 39 s; Artifacts + Workers envelopes; competition logistics) | PRD add. §2; body §8, §7.4, §7.1 | Covered |
| Alternatives parked (GitHub-with-agents-bolted-on, office-first, rebuild PM, game-asset tier) | §5; PRD add. §4 (plus decision-mesh additions) | Covered |
| "What is not in this brief by design" (architecture, UX spec, competitive teardown deferred) | §0; PRD add. §1 | Covered |

## 2. Qualitative drops (ideas the FR structure silently lost)

1. **Duplicated effort across forks** (Problem §): "the same fix attempted across several forks" has no carrier — no FR, metric, or narrative mention; the PRD's problem statement covers visibility and trust, not redundant work.
2. **Wasted agent compute** (Problem § cost list): dropped; the cost model in the PRD is reviewer time + late conflicts only.
3. **"What users feel: convergence"** (Solution §): the affective product claim is compressed to SM-3's comprehension test ("state what the fleet is doing… inside a minute"). The felt-quality framing — the thing the brief proposes users actually experience — appears nowhere.
4. **Long-horizon vision** (Vision §, Year 1 / Year 2–3): the trajectory — fleet view as default surface, workspaces as default home for agent work (local optional), asset tier opening the game industry, clients multiplying — is absent. The PRD is deliberately near-term (non-goals + roadmap), but the directional arc is no longer anywhere except the brief.
5. **Endgame positioning** ("make GitHub irrelevant"): absent from the PRD entirely; §5 retains only the defensive "not a GitHub clone." The brief flagged it as directional/ASSUMPTION, so this may be intentional — flagged for PM awareness, not as an error.
6. **Trust positioning** (Differentiation §): "not a compliance add-on" and the competitive whitespace claim ("no surveyed code host treats secret files as typed") survive only as mechanics (§4.6) + PRD addendum §2; the PRD body never states the whitespace claim it is built on.

## 3. Contradiction check — canon-corrected claims vs the PRD

Canon corrections come from the UX reconcile + spines (recorded in PRD addendum §3). Verified the PRD did not drift back:

| Canon correction | PRD form | Drift? |
|---|---|---|
| "Fleet view" is not UI copy — as-built labels are **Concurrent Proposals** / **Convergence Conflicts** | §4.1 pins the rule; "fleet" survives only as market/narrative language (§2.1, UJ-2/3, SM-3, §10). Note: the *final brief itself* still says "the fleet view" (Solution §) — the PRD does not inherit it. | No drift |
| Judge layer planned P0, **not live** | §4.5 description: "not live in the shipped demo surface"; FR-23/24: "P0 — planned (contract pinned 2026-10-06)"; §13.1: "not live". Brief's own "wiring next — the P0 build step" is aligned. | No drift |
| "No polling" claim — as-built polling 2 s/8 s; push is the P1 goal | FR-22 states the corrected form (polling today; SSE/WebSocket P1); §10 cadences; OQ-3 open. Watch item only: FR-5/§1 retain the goal phrasing "pushes appear in seconds" as the stated intent, properly status-tagged by FR-22. | No drift |
| "Access-controlled" secrets wording — masking is path-driven; reveal requires the auth seam | No access-control claim anywhere in prd.md; FR-30 documents the path-driven limitation; FR-31 + OQ-2 roadmap reveal. Note: the *final brief itself* still says "typed, access-controlled objects" (Differentiation §) — the PRD does not inherit it. | No drift |
| Landing "validation evidence attached" — receipt today is the short SHA; evidence ships only with the land-hardening P0 | FR-18: "An evidence artifact is not attached yet"; FR-15 receipt = `<sha8>`; SM-2 says "with receipt"; OQ-4. | No drift |

**Carried-open delta (flagged, not adjudicated — not a canon-corrected claim):** OQ-1 — the brief lists the game-asset tier (R2) as explicitly out, while architecture AD-10 stages the R2 tier in scope for the competition build. The PRD records the conflict in OQ-1 and does not resolve it; §5/§13.2 keep the brief's "out" wording. Adjudication is owed (OQ-1).

## 4. Verdict

**66 brief claims checked: 54 covered, 7 partial, 5 missing.** All four canon-corrected claims (judge=planned; polling; masking; receipt) carried in corrected form — no drift. Partials are corrections-by-design (receipt, evidence, R2 boundary) or positioning trimmed to PRD register (felt-convergence, vision framing). Missings: duplicated-effort waste, wasted agent compute, and three long-horizon Vision claims (Year 2–3 trajectory, endgame) — the last three likely deliberate but unrecoverable from the PRD alone.
