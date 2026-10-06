# Slice pack — E6-impl

**Kind:** implementation · **Epic:** E6 — Trust: secrets, intent & provenance · **Milestone:** M1
**Epic goal:** Secret-class values never leave the worker — schema-only rendering, scrubbed free-text channels, withheld folds, 409-blocked landings — while every change-set durably carries its why via the notes mirror and its provenance stays visible.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E6-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E6-impl-<short-slug>`), title, kind, epic="E6", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-30, NFR-5)
### FR-30 — Masking posture and widening
- status: `built (path-driven) / sequenced (M2) (content detection)`
- needs: implementation=true, verification=true
- milestone hint: M2
- description: Masking is path-driven by design in this version; widening is deliberate, additive, and decided once.
- consequences (testable):
  - A secret value placed in a non-secret-class path is not redacted in v1 (documented limitation; values must live in secret-class paths).
  - Widening the class list is additive via a contract bump.
  - Content-detected secrets (non-path) arrive either as a contract-bumped additive status value or as a judge gate — decided once in `CONTRACT.md` before that unit ships, never implicit.
### NFR-5
- No secret-class content leaves the worker in any response, log, or model state; free-text channels derived from repo content are scrubbed before entering any body (AD-4).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `secret-class-widening-scrub` [pending] Secret-class widening + free-text scrub (AD-4, contract bump) (overlap 4)
- `scan-intent-and-notes-text-for-secrets-and-pii-leaks` [pending] Scan intent and notes text for secrets and PII leaks (overlap 3)
- `attach-mandatory-per-write-provenance-via-git-notes` [pending] Attach mandatory per-write provenance via Git Notes (overlap 2)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 2)
- `contextual-mfa-elevation-to-reveal-or-inject-secret-values` [pending] Contextual MFA elevation to reveal or inject secret values (overlap 2)
- `declare-intent-router-pings-before-work-starts` [pending] Declare intent: router pings before work starts (overlap 2)
- `enforce-typed-secret-files-ciphertext-policy-schema-only-vie` [pending] Enforce typed secret files: ciphertext + policy + schema-only view (overlap 2)
- `entity-api-issue-number-title-state-labels-assignees-body` [pending] Entity API: Issue (number, title, state, labels, assignees, body) (overlap 2)
- `entity-api-worker-provider-model-effort-desk-status-worktree` [pending] Entity API: Worker (provider/model/effort, desk, status, worktree, pr, usage) (overlap 2)
- `intent-router-declare-intent-first-match-before-building` [pending] Intent router: declare intent first, match before building (overlap 2)
- `law-4-repo-answers-for-itself-index-preview-demos-provenance` [pending] Law 4: repo answers for itself - index, preview, demos, provenance (overlap 2)
- `model-policy-driven-stream-branches-with-derived-views` [pending] Model policy-driven stream branches with derived views (overlap 2)
- `proposal-card-signal-set-risk-provenance-fields-on-every-car` [pending] Proposal card signal set: risk + provenance fields on every card (overlap 2)
- `schema-only-decoupled-views-for-secret-files-demo-beat` [pending] Schema-only decoupled views for secret files (demo beat) (overlap 2)
- `tier-3-provenance-artifact-store-notes-traces-receipts-previ` [pending] Tier 3: provenance/artifact store (notes, traces, receipts, previews) (overlap 2)
- `trust-beat-content-based-secret-detection` [pending] Trust beat: content-based secret detection (overlap 2)
- `use-crdts-for-review-state-only-never-code-text` [pending] Use CRDTs for review state only, never code text (overlap 2)

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
