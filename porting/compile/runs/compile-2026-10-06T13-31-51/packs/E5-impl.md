# Slice pack — E5-impl

**Kind:** implementation · **Epic:** E5 — Judge layer · **Milestone:** M1
**Epic goal:** A reviewer gets three typed advisory signals per proposal — risk, intent-vs-diff, semantic collision — from a server-assembled, pinned, fail-closed judge; chips advise while code decides, and thresholds are calibrated before any gating is trusted.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E5-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E5-impl-<short-slug>`), title, kind, epic="E5", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-26, FR-27, UX-DR-2)
### FR-26 — Auto-land gate
- status: `roadmap (unsequenced — the judge is live; the gate is explicitly not engaged, pending calibration per FR-27/OQ-5)`
- needs: implementation=true, verification=false
- description: Auto-landing can exist later, gated and fail-closed — not before. Realizes UJ-1. *[NON-GOAL: engaging auto-land — the gate is roadmap, unsequenced (OQ-5); no demo or first-version path auto-lands.]*
- consequences (testable):
  - The gate is evaluated inside `POST /land` before fold and push; when engaged and the judge cannot answer, `/land` fails closed (no push).
  - Auto-land stays off until an injection-testing spike passes on our labeled set and at least one non-model corroborating signal exists (fold status / conflict map).
  - Clients render verdicts; they never decide them.
### FR-27 — Calibration before trust
- status: `required-M1 (advisory-only; the gate stays off) — calibration not yet run; the judge ships advisory-only until the calibration record exists`
- needs: implementation=true, verification=false
- milestone hint: M1
- description: Judge thresholds are tuned on our own labeled proposals before any gating is trusted.
- consequences (testable):
  - The calibration record's minimum contents: ≥50 labeled proposals carrying risk + intent-verification labels; precision ≥0.9 on the ship-blocking class; the injection-testing spike passes; sign-off by John. [ASSUMPTION: numeric targets proposed.]
  - Thresholds/weights/labels are code constants tuned on that labeled set; the first version ships advisory-only until the record exists — the auto-land gate engages only after the record exists (OQ-5 cites this).
  - Model id is logged per response; drift to an unpinned id fails closed.
### UX-DR-2
- GAP #6 — judge chips + auto-land gate planned P0, not rendered: risk score, intent-vs-diff verification, semantic collision; when built: chips on the card, gate behind the Land button; "the judge advises; code decides; humans still own irreversible acts." Draft brief lists them as first-version — contradiction flagged (`EXPERIENCE.md:273`; `DESIGN.md:606-614`).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 3)
- `live-only-e2e-verification-gate-before-submission-no-mocks` [pending] Live-only E2E verification gate before submission (no mocks) (overlap 3)
- `proposal-card-signal-set-risk-provenance-fields-on-every-car` [pending] Proposal card signal set: risk + provenance fields on every card (overlap 3)
- `score-fork-people-trust-signals` [pending] Score fork people/trust signals (overlap 3)
- `score-landing-subset-risk-for-proposal-combinations` [pending] Score landing-subset risk for proposal combinations (overlap 3)
- `tour-v2-fold-judge-chips-auto-land-language-in` [pending] Tour v2: fold judge chips + auto-land language in (overlap 3)
- `auto-land-gate-live` [pending] Auto-land gate live (server-side, AD-11) (overlap 2)
- `contextual-clustering-trace-affected-code-from-an-issue-card` [pending] Contextual clustering: trace affected code from an issue card (overlap 2)
- `demo-one-repo-3-5-agents-seeded-collision-land-one-scrub-lea` [pending] Demo: one repo, 3-5 agents, seeded collision, land one, scrub leak (overlap 2)
- `detect-cross-worktree-conflicts-before-writes-land` [pending] Detect cross-worktree conflicts before writes land (overlap 2)
- `entity-api-pull-proposal-client-entity-state-draft-checks-cl` [pending] Entity API: Pull / Proposal client entity (state, draft, checks, closes) (overlap 2)
- `fork-card-six-cluster-signals-fit-trust-liveness-proof-dista` [pending] Fork-card six-cluster signals (fit, trust, liveness, proof, distance, cost) (overlap 2)
- `tune-judge-thresholds-on-our-own-labeled-proposals` [pending] Tune judge thresholds on our own labeled proposals (overlap 2)
- `version-judge-question-sets-in-code-with-the-platform` [pending] Version judge question sets in code with the platform (overlap 2)

## Architecture context
Constraints:
- CPU budget: Workers CPU 30 s default / 5 min max per HTTP request; all change-set/conflict work in-Worker diffs, no server-side git (SPINE:69; SPEC:53).
- Artifacts limits: 1 GB/repo · 32 MB/file · 2k git req/10 s/repo; no server-side merge/diff/conflict/branch-protection — the platform builds them (SPEC:51); 32 MB/blob wall stands (MEMLOG:21). Push ~64 MiB cap → small incremental pushes; push protocol v1-only (SPEC:52).
- Runtime pin: compat 2026-09-01, no `nodejs_compat` (in-tree fs/Buffer shims) (SPINE:162,135); isomorphic-git ^1.43.0 (v1 wire; SPEC names 1.42.x — verified compatible REAL:53).
- Environments: one environment (live demo `nextgit-platform.john-b7d.workers.dev`); no staging split until auth seam + non-demo data (SPINE:177,251).
- Fork walk limit 200 on change-set diffing; landing preconditions `stale`/`base-moved` (SPINE:75).
- Events/polling plan: `/events` ≤50 newest; KV single writer; queue single consumer; dedupe `(type,repo,ref,after)`; polling only as fallback (SPINE:93); live-feed transport (SSE/WS) deferred until polling latency is real at scale (SPINE:253).
- Scale budget unresolved: `/proposals` fully recomputes per poll; only AD-2's CPU sentence bounds it; a P2 cache item is the implicit home (RUB:33); brief flags the 20–50-proposal fleet view as a known engineering budget item (BRIEF:64).
- Token lifecycle: worker tokens minutes-TTL, single-use, revoked in `finally`; agent tokens hours-scale; 0600 outside repos/transcripts; never logs/argv; mint/use/revoke audited (SPINE:99).
- Auth/demo: `AUTH_MODE` default deny; demo allowlist `demo`/`agent-*`; rate limits on `/land`,`/merge`,`/proposals`,`/judge`; seam enforced before first non-demo data (SPINE:111).
- Judge: pinned model, fail-closed, per-caller budget/rate caps, auto-land requires injection-spike pass + non-model corroboration (SPINE:123).
- Deploy/log hygiene: lockfile-pinned wrangler only; worker logs never Authorization headers or request bodies (SPINE:135).
- Gate rule: 0 ship-blockers + 0 highs; contract smoke in each platform VERIFY (SPINE:129).
- Write protection is ours to enforce: CF `read_only:true` flag does NOT constrain binding-level writes (probe landed on a read-only fork) — never assumed as a guard (MEMLOG:39).
- No Windows/GPU/macOS hosting; no servers to run; only local dependency is the loop host (SPINE:147,177).
Near-term capabilities:
- Judge layer wiring (P0): `POST /judge` + `AI` binding + typed envelope + card-signal vocabulary, contract-pinned before the wave (SPINE:119-123; MEMLOG:34 `judge-contract-pin` P0).
- Landing path hardening (P0): reviewed-heads fields + evidence object + `base-moved` preconditions + AD-9 allowlist/rate rules as one work order, contract bump first (SPINE:244; MEMLOG:34).
- Event pipeline: Queues → worker (sole recorder, validation, dedupe) → KV → `/events` → UI (SPINE:89-93; `event-consumer-validation-dedupe` P1 MEMLOG:34).
- Store choices in scope: Artifacts (repos/forks/notes-mirror), KV `LIVE`, Queues `nextgit-events`, DO leases (`do-lease-serializes-lands` P1), Workflows provisioning (`workflows-provisioning` P1), R2 asset tier owning manifest/pointer format (`r2-asset-tier-manifest-format` P1) (SPINE:42-56,113-117; MEMLOG:34).
- Auth seam v1 + token lifecycle (P1) (SPINE:107-111; MEMLOG:34).
- Secret-class widening + scrub (P1) and the content-scan decision landing in CONTRACT before its unit ships (SPINE:81).
- Contract smoke in VERIFY gates + `tsc --noEmit` type gate (`contract-smoke-verify-gates` P2) (SPINE:129; MEMLOG:34).
- Client contract: CONTRACT.md + 11-entity protocol + push-event surface; adapter synthesizes GitHub semantics (SPINE:137-141; capability map SPINE:226-237: CAP-1..10, CAP-10 deferred).
- Deferred (post-competition unless noted): game-asset pipeline internals, federation runners, fork community + intent router, staging/SSO split, jurisdiction, SSE/WS transport, macro-merging + SHOULD/COULD list (SPINE:248-254).
- Demo incorporation requirement: DO/Workflows/R2 introduction slices scheduled as work orders immediately after the spine (user requires demo incorporation) (SPINE:241; MEMLOG:9).

## Source refs
- PRD: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/prds/prd-cloudflare-git-comp-2026-10-06/prd.md
- Platform contract: /home/johnzealanddoyle/projects/cloudflare-git-comp/platform/CONTRACT.md · SPEC: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/specs/spec-next-git-platform/SPEC.md
- UX spines: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/
- Arch spine: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md
