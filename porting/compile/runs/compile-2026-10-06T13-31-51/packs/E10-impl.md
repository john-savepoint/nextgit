# Slice pack — E10-impl

**Kind:** implementation · **Epic:** E10 — Operational excellence: demo, submission & governance · **Milestone:** M1
**Epic goal:** The entry can be reproduced and submitted — committed scripts, rehearsed failure paths, a 5–10 minute uninterrupted take and an open-source package — under the platform's binding operating discipline: pinned runtime, declared scope floor, engineering-law governance.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E10-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E10-impl-<short-slug>`), title, kind, epic="E10", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-39, FR-41, NFR-3, NFR-10, NFR-12)
### FR-39 — Reproducible end-to-end demo
- status: `built (scripts) / required-M1 (submission packaging not started)`
- needs: implementation=true, verification=true
- milestone hint: M1
- description: An operator can reproduce the demo end-to-end from committed scripts.
- consequences (testable):
  - Committed scripts: `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (REAL CLI agents) · `land.mjs` (lands or refuses) — reproducible from the repo.
  - The run shows N≥4 real agents concurrently, ≥1 genuine collision surfaced pre-land, one-click landing with receipt, secret masking and provenance visible.
  - No mocks: live Workers + Artifacts end to end.
### FR-41 — Submission package
- status: `required-M1 — not started (the gate itself)`
- needs: implementation=true, verification=false
- milestone hint: M1
- description: The entry can be submitted and judged.
- consequences (testable):
  - Deliverables: a 5–10 minute video; an open-source repo (MIT/Apache/BSD + LICENSE file); run instructions.
  - The demo is one uninterrupted take exercising all three rubric axes (originality/prototype 50%, multi-agent concurrency 25%, UX 25%) on real infrastructure; single entry.
### NFR-3
- One Worker (`nextgit-platform`); compatibility date 2026-09-01; no `nodejs_compat` (in-tree fs/Buffer shims). Deploys use the lockfile-pinned local wrangler, never `@latest`. Worker logs never include Authorization headers or request bodies.
### NFR-10
- Dark-only theme; desktop-web primary; English-only copy; no offline, no native, no PWA. [ASSUMPTION: ratified for M1 (revisit at the §7.5 gate; John may overrule anytime).]
### NFR-12
- Every requirement's intent answers to the twelve engineering laws (`engineering-laws.md`; per-law carrier mapping: `reconcile-spec.md` §3); laws not yet carried as FRs ride as roadmap explicitly — L2 two-tier intelligence (fast System-1 sweeps classify every file before expensive reasoning), L9 work-item ↔ change-set linkage, L11 always-on decision layer; the partially-represented laws remain binding.

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `law-2-two-tier-intelligence-system-1-sees-every-file-first` [pending] Law 2: two-tier intelligence - System-1 sees every file first (overlap 5)
- `classify-every-file-with-system-1-models-at-ingest` [pending] Classify every file with System-1 models at ingest (overlap 4)
- `law-11-always-on-system-1-decision-layer-primed-for-agents-a` [pending] Law 11: always-on System-1 decision layer primed for agents and CI/CD (overlap 4)
- `classify-every-file-by-language-role-and-sensitivity` [pending] Classify every file by language, role, and sensitivity (overlap 3)
- `law-9-work-item-to-change-set-linkage-on-one-review-surface` [pending] Law 9: work-item to change-set linkage on one review surface (overlap 3)
- `live-only-e2e-verification-gate-before-submission-no-mocks` [pending] Live-only E2E verification gate before submission (no mocks) (overlap 3)
- `run-always-on-system-1-decision-agents` [pending] Run always-on System-1 decision agents (overlap 3)
- `auto-tag-and-classify-issues-with-fast-models` [pending] Auto-tag and classify issues with fast models (overlap 2)
- `change-set-identity-stable-per-proposal-identity-fingerprint` [pending] Change-set identity: stable per-proposal identity + fingerprint (demo SHOULD) (overlap 2)
- `declare-intent-router-pings-before-work-starts` [pending] Declare intent: router pings before work starts (overlap 2)
- `demo-video-5-10-min-single-take-covering-all-three-axes` [pending] Demo video: 5-10 min single take covering all three axes (overlap 2)
- `ensure-hermetic-reproducible-builds-with-pinned-images` [pending] Ensure hermetic, reproducible builds with pinned images (overlap 2)
- `entity-api-services-worker-branch-page-title-local-port` [pending] Entity API: Services (worker, branch, page title, local port) (overlap 2)
- `intent-router-declare-intent-first-match-before-building` [pending] Intent router: declare intent first, match before building (overlap 2)
- `make-workflows-steps-idempotent-design-ordering-explicitly` [pending] Make Workflows steps idempotent; design ordering explicitly (overlap 2)
- `measure-system-1-cost-accuracy-vs-expensive-reads` [pending] Measure System-1 cost/accuracy vs expensive reads (overlap 2)
- `rank-candidate-forks-against-a-declared-intent` [pending] Rank candidate forks against a declared intent (overlap 2)
- `route-expensive-reasoning-only-to-files-needing-judgment` [pending] Route expensive reasoning only to files needing judgment (overlap 2)
- `speculative-validation-of-the-fold-result-before-landing-dem` [pending] Speculative validation of the fold result before landing (demo SHOULD) (overlap 2)
- `submission-compliance-osi-license-license-file-run-instructi` [pending] Submission compliance: OSI license + LICENSE file + run instructions (overlap 2)
- `submission-package` [pending] Submission package (overlap 2)
- `submission-repo-location-single-entry-registered-by-oct-14` [pending] Submission: repo location + single entry registered by Oct 14 (overlap 2)
- `surface-decision-logs-per-change-human-vs-agent` [pending] Surface decision logs per change (human vs agent) (overlap 2)
- `sync-local-and-platform-sides-over-standard-git` [pending] Sync local and platform sides over standard git (overlap 2)

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
