# Slice pack — E3-impl

**Kind:** implementation · **Epic:** E3 — Landing: one click, with receipt · **Milestone:** M1
**Epic goal:** A chosen proposal lands server-side in one click; every attempt yields one of nine unambiguous, numbered outcomes; the reviewed-state and concurrency preconditions make 'what lands is what was reviewed' true, and each landing records its validation evidence.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E3-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E3-impl-<short-slug>`), title, kind, epic="E3", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-15, FR-16, FR-17, FR-18, FR-19, NFR-4, UX-DR-7)
### FR-15 — Landing outcomes — an open, numbered set
- status: `built (outcomes 1–5, 7) / build-gap (dedicated `no-changes` banner copy; `withheld-secret` and `conflict` card states) / required-M1 (outcomes 8–9: `stale`, `base-moved`)`
- needs: implementation=true, verification=true
- milestone hint: M1
- description: A reviewer gets an unambiguous outcome for every landing attempt. The set is open and numbered: outcomes 1–7 below, plus 8 (`stale`) and 9 (`base-moved`) — nine total; the last two ship with the land-hardening slice (FR-16, FR-17). Realizes UJ-1 (edge case path).
- consequences (testable):
  - `Land into demo` → card flips to `confirm land?` + `cancel` (inline; no dialog).
  - `confirm land?` → disabled `landing...`; banner (warn) "Landing proposal {repo} into {base}...".
  - Success → banner (success) "Successfully landed proposal {repo} into {base}. Commit `<sha8>`" — first 8 chars, full SHA in the tooltip; proposals + events refresh immediately; the `repo.pushed` event re-enters the ticker.
  - 409 `withheld-secret` → error banner "Withheld-secret file — landing blocked ({files})."
  - 409 `conflict` → error banner "Conflicted files: {files}. (preview merge first)"
  - 409 `no-changes` → dedicated variant: "Nothing to land — fold produced zero changes." [ASSUMPTION: copy]
  - Any other failure → error banner "Failed to land {repo}: {msg}".
  - 409 `stale` → error banner "This proposal is stale — rebase and re-push to land." [ASSUMPTION: copy]
  - 409 `base-moved` → error banner "Nothing to land — the baseline moved since this proposal was made." [ASSUMPTION: copy]
  - Every failure returns the card to `default`; the banner persists until dismissed; card states for `withheld-secret` and `conflict` are specified in the UX spine and not yet rendered (build gap).
### FR-16 — Reviewed-state precondition
- status: `required-M1 — planned (land-hardening workstream; contract bump first)`
- needs: implementation=true, verification=false
- milestone hint: M1
- description: A reviewer can trust that what lands is what was reviewed. Realizes UJ-1.
- consequences (testable):
  - `/land` accepts the reviewed base head and proposal heads (additive request fields) and returns 409 `stale` on mismatch — no silent re-fold.
  - Landing content a reviewer never saw is impossible through the public route once the precondition is enforced.
### FR-17 — Concurrency precondition
- status: `required-M1 — planned (land-hardening); the DO lease arrives later (roadmap, unsequenced)`
- needs: implementation=true, verification=false
- milestone hint: M1
- description: Concurrent landings cannot silently overwrite each other. Realizes UJ-1.
- consequences (testable):
  - After the in-memory clone, `/land` re-reads the base head and returns 409 `base-moved` on divergence.
  - A Durable Object lease (roadmap, unsequenced) serializes lands when it arrives; until then the precondition is the guarantee.
  - The race is reproduced and covered by a regression check (4 concurrent lands → no silent overwrite).
### FR-18 — Landing record and validation evidence
- status: `required-M1 (land-hardening workstream); the short-SHA receipt is the minimum the build carries today`
- needs: implementation=true, verification=false
- milestone hint: M1
- description: Every landing is traceable and carries its validation evidence: what was reviewed, what checks ran and their results, what was folded, and the hash that proves merged-SHA equals tested-SHA. Realizes UJ-1.
- consequences (testable):
  - Every landing records ancestor + heads + fold hash; merged-SHA-equals-tested-SHA is checked against the recorded fold hash — no landing claims validation it did not run.
  - The landing record extends with `evidence { checks[], results[], mergedSha, testedSha, artifactRef, at }` on `POST /land`; a read surface serves the record — planned route `GET /landings/{commit}`. [ASSUMPTION: the contract bump is pinned with the land-hardening workstream per contract-first discipline (FR-42) — the latest `CONTRACT.md` revision carries it.]
  - The short-SHA success banner is the minimum receipt, not the target; the evidence artifact ships with the land-hardening workstream (Milestone 1). `landed.files` and `landed.at` render in the same slice (contract-defined, currently unrendered — build gap).
  - The decision record persists as a git note on the proposal.
### FR-19 — Landed-state card
- status: `built (landed) / build-gap (`landed.files` count unrendered)`
- needs: implementation=true, verification=true
- description: A reviewer can see at a glance that a proposal has nothing pending. Realizes UJ-1.
- consequences (testable):
  - `landing.status === "landed"` (or `stats.files === 0`) dims the card to 0.55 opacity with a dashed border and the "landed — nothing pending" line ("All changes from this branch have been merged into baseline.").
  - `landing.status` is content-derived: a zero-change fold is `landed`; `/land` with zero changes is 409 `no-changes` — never a fake success.
### NFR-4
- The worker performs no git writes except the single-commit fold+push inside `POST /land`; base branches are written only by `/land`; control-plane pushes are limited to provisioning baselines and proposal repos; landing replays are prohibited (AD-1).
### UX-DR-7
- Provenance requirement: the landing decision persists as a git note (`EXPERIENCE.md:214`).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `proposal-card-signal-set-risk-provenance-fields-on-every-car` [pending] Proposal card signal set: risk + provenance fields on every card (overlap 4)
- `attach-signed-validation-evidence-to-every-change` [pending] Attach signed validation evidence to every change (overlap 3)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 3)
- `landing-evidence-receipt-tested-sha-equals-merged-sha-record` [pending] Landing evidence receipt: tested SHA equals merged SHA, recorded (overlap 3)
- `speculative-validation-of-the-fold-result-before-landing-dem` [pending] Speculative validation of the fold result before landing (demo SHOULD) (overlap 3)
- `deliver-events-to-canvas-via-true-push-sse-websocket` [pending] Deliver events to canvas via true push (SSE/WebSocket) (overlap 2)
- `detect-cross-worktree-conflicts-before-writes-land` [pending] Detect cross-worktree conflicts before writes land (overlap 2)
- `inline-streaming-leak-deflectors-on-every-canvas-and-doc-wri` [pending] Inline streaming leak deflectors on every canvas and doc write (overlap 2)
- `per-worker-traces-git-notes-records-h4-provenance-gap` [pending] Per-worker traces + git-notes records (H4 provenance gap) (overlap 2)
- `read-write-agents-md-as-cross-vendor-task-records` [pending] Read/write AGENTS.md as cross-vendor task records (overlap 2)
- `store-arbitration-decision-record-as-git-notes-on-landed-cha` [pending] Store arbitration decision record as git notes on landed change (overlap 2)
- `track-push-provenance-laptop-vs-production` [pending] Track push provenance (laptop vs production) (overlap 2)
- `validate-every-proposal-with-speculative-execution` [pending] Validate every proposal with speculative execution (overlap 2)
- `worktree-as-a-service-platform-provisioning-api-create-list-` [pending] Worktree-as-a-service: platform provisioning API (create/list/push/PR/cleanup) (overlap 2)

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
