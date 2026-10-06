# Slice pack — E4-impl

**Kind:** implementation · **Epic:** E4 — Live platform events · **Milestone:** M1
**Epic goal:** The platform proves it is alive: pushes, forks, and landings flow through a single-consumer, deduped, validated event pipeline to the UI in real time, with polling existing only as the degraded fallback.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E4-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E4-impl-<short-slug>`), title, kind, epic="E4", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-21, FR-22, NFR-7, UX-DR-6)
### FR-21 — Event feed discipline
- status: `built (core) / sequenced (M2) (payload validation + dedupe hardening)`
- needs: implementation=true, verification=true
- milestone hint: M2
- description: The event feed is accurate: recorded once, deduped, validated, and never authoritative for writes. Realizes UJ-1.
- consequences (testable):
  - Artifacts events arrive through exactly one queue consumer (the worker) — the sole recorder; dedupe key `(type, repo, ref, after)`.
  - Events without repo identity are logged and dropped, never partially recorded; payloads are validated (type whitelist, repo/ref charsets, hex shas) before recording (sequenced M2).
  - `GET /events` serves the ≤50 newest; KV `LIVE` has exactly one writer; the feed is a hint, never authority for writes or identity.
### FR-22 — Real-time transport, polling fallback
- status: `required-M1 (real-time transport); built (polling fallback)`
- needs: implementation=true, verification=true
- milestone hint: M1
- description: The UI is event-driven end to end: pushes, forks, and landings surface in real time; polling exists only as the degraded fallback. Realizes UJ-1, UJ-2. [OQ-3 (retired) — real-time required, 2026-10-06.]
- consequences (testable):
  - Real-time transport (SSE or WebSocket over a Durable Object hub) carries platform events to the UI; a push appears without any poll, and a landing updates the set without waiting for a refresh cycle.
  - The proof form holds: on-screen freshness visibly beats a 90 s poll (SM-2 keeps the ≤2 s form), captured as demo evidence.
  - Polling remains the degraded fallback: when the transport is unavailable, `/events` 2s, `/proposals` 8s (auto-refresh toggle, default on); a land reloads both endpoints immediately; `/events` failure must never break the proposals UI.
  - As-built today: polling only (the event pipeline is live); the real-time transport ships in Milestone 1.
### NFR-7
- KV `LIVE` has exactly one writer (the worker); the queue has exactly one consumer; Artifacts events are deduped on `(type, repo, ref, after)`; the feed is a hint, never authority for writes or identity (AD-6).
### UX-DR-6
- Polling cadence is behavioral requirement, not implementation detail: `/events` 2s; `/proposals` 8s with toggle on; new top event debounce 500ms; land reloads both endpoints; `/events` failure must never break proposals UI; push-style immediacy is the product goal — as-built polls (`EXPERIENCE.md:182`). Set view, no paging — all proposals on one canvas, no tab-hopping, no collapse (`EXPERIENCE.md:183`).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `fan-out-artifacts-repo-events-through-queues` [pending] Fan out Artifacts repo events through Queues (overlap 4)
- `event-consumer-validation-dedupe` [pending] Event consumer: sole recorder + dedupe + payload validation (AD-6) (overlap 3)
- `events-normalized-platform-event-bus-across-all-families` [pending] Events: normalized platform event bus across all families (overlap 3)
- `add-observability-for-repo-and-agent-event-streams` [pending] Add observability for repo and agent event streams (overlap 2)
- `build-multiplayer-triage-canvas-with-proposal-artifacts` [pending] Build multiplayer triage canvas with proposal artifacts (overlap 2)
- `deliver-events-to-canvas-via-true-push-sse-websocket` [pending] Deliver events to canvas via true push (SSE/WebSocket) (overlap 2)
- `demo-one-repo-3-5-agents-seeded-collision-land-one-scrub-lea` [pending] Demo: one repo, 3-5 agents, seeded collision, land one, scrub leak (overlap 2)
- `detect-cross-worktree-conflicts-before-writes-land` [pending] Detect cross-worktree conflicts before writes land (overlap 2)
- `detect-duplicated-behavior-across-proposals-and-forks` [pending] Detect duplicated behavior across proposals and forks (overlap 2)
- `events-queue-state` [pending] Events: queue state (overlap 2)
- `events-worker-lifecycle-worktree-spawn-update-remove-worktre` [pending] Events: worker lifecycle + worktree (spawn/update/remove, worktree) (overlap 2)
- `fan-out-event-subscriptions-to-ci-and-agents-deduped` [pending] Fan out event subscriptions to CI and agents (deduped) (overlap 2)
- `keep-pushes-on-the-v1-protocol-for-artifacts-interop` [pending] Keep pushes on the v1 protocol for Artifacts interop (overlap 2)
- `law-12-merge-workspace-transparency-woven-through-the-experi` [pending] Law 12: merge/workspace transparency woven through the experience (overlap 2)
- `live-pipeline-heatmap-for-parallel-test-execution` [pending] Live pipeline heatmap for parallel test execution (overlap 2)
- `normalize-worker-events-across-provider-hook-formats` [pending] Normalize worker events across provider hook formats (overlap 2)
- `submission-repo-location-single-entry-registered-by-oct-14` [pending] Submission: repo location + single entry registered by Oct 14 (overlap 2)
- `weave-workspaces-through-the-whole-experience` [pending] Weave workspaces through the whole experience (overlap 2)

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
