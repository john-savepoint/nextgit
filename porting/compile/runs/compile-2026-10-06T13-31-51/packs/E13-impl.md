# Slice pack — E13-impl

**Kind:** implementation · **Epic:** E13 — Fork community & intent router · **Milestone:** M4
**Epic goal:** A builder declares intent before building and matches it against the fork ecosystem — merge-it / use-as-context / ignore verdicts drive join-don't-restart, with merge-back-to-upstream paths defined.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E13-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E13-impl-<short-slug>`), title, kind, epic="E13", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-46)
### FR-46 — Declare intent before building; match it against the fork ecosystem
- status: `sequenced (M4)`
- needs: implementation=true, verification=false
- milestone hint: M4
- description: A builder can declare intent before building and match it against the fork ecosystem — joining existing work instead of restarting it.
- consequences (testable):
  - The matcher returns one verdict per declared intent — `merge-it` (an existing fork already carries the work), `use-as-context` (overlap supplies context), or `ignore` (no actionable overlap).
  - Fork cards carry the six-cluster signals that drive matcher verdicts (defined in `fork-community.md`, the CAP-10 companion).
  - Join-don't-restart is a platform reflex: the default path from a declaration leads to the fork that already attempted the work, not to a restart.
  - Merge-back-to-upstream paths are defined: a fork's work can be routed back to the repository it forked from.

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `intent-router-declare-intent-first-match-before-building` [pending] Intent router: declare intent first, match before building (overlap 6)
- `declare-intent-router-pings-before-work-starts` [pending] Declare intent: router pings before work starts (overlap 4)
- `run-background-matcher-against-the-fork-ecosystem` [pending] Run background matcher against the fork ecosystem (overlap 3)
- `implement-join-don-t-restart-with-merge-refactor` [pending] Implement join-don't-restart with merge/refactor (overlap 2)
- `rank-candidate-forks-against-a-declared-intent` [pending] Rank candidate forks against a declared intent (overlap 2)
- `return-matcher-verdicts-merge-context-or-ignore` [pending] Return matcher verdicts: merge, context, or ignore (overlap 2)
- `swarm-r3-declare-before-touch-receipt-when-finished` [pending] Swarm R3: declare before touch, receipt when finished (overlap 2)
- `swarm-r4-join-don-t-restart-as-a-platform-reflex` [pending] Swarm R4: join-don't-restart as a platform reflex (overlap 2)

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
