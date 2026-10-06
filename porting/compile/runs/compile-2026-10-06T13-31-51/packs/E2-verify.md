# Slice pack — E2-verify

**Kind:** verification · **Epic:** E2 — Change-set engine & merge preview · **Milestone:** M1
**Epic goal:** A reviewer can read any proposal's commits, files, and diffs computed server-side against the fork point, trust that collisions are real because the merge was attempted, and preview the landing outcome before committing — no clones, no CLI on the review path.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E2-verify.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E2-verify-<short-slug>`), title, kind, epic="E2", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = verification: author verification stories for the built requirements here.

## Your requirements (FR-9, FR-10, FR-11, FR-12, FR-13, NFR-1, NFR-2)
### FR-9 — Server-side change-set capture
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can read any proposal's commits, changed files, and diffs without a clone. Realizes UJ-3.
- consequences (testable):
  - `GET /changes?repo=…&base=demo&ref=main&baseRef=main` returns the baseline and head identities, stats, and per-file rows.
  - The change-set carries a per-fork commit list — hash, author, timestamp, message — alongside the per-file rows.
  - Per-file rows carry status (added/modified/removed), additions/deletions, and a patch; patches are absent for secret, binary, or oversized files.
  - No read route shells out to git or clones; the review path never clones (architecture: AD-2; the only in-memory clone is inside `/land`).
### FR-10 — Fork-point diff semantics
- status: `built`
- needs: implementation=false, verification=true
- description: A proposal's change-set means "what the agent changed" and stays stable while the baseline moves. Realizes UJ-3.
- consequences (testable):
  - Change-sets are diffed against the fork point (most recent commit shared with base, first-parent walk limit 200; base-head fallback when none is found).
  - `/merge` and `/land` use the fork point as the 3-way ancestor (ancestor = fork-point texts, ours = current base head, theirs = proposal head).
  - After the baseline advances (another proposal lands), an unchanged proposal's change-set is byte-identical.
### FR-11 — Real conflict detection with enumerated kinds
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can trust that a "conflict" is real — it was produced by attempting the merge. Realizes UJ-3.
- consequences (testable):
  - `/proposals` classifies every pair; `kind` ∈ `text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed`.
  - Conflict cards carry the pair's line regions (`base`, `a`, `b` lines) where a region exists.
  - The summary's `conflictingPairs` / `cleanPairs` counts agree with the map's rendered cards.
### FR-12 — Diff viewer states
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can read one file's change-set with unambiguous states. Realizes UJ-3.
- consequences (testable):
  - Patch rows render additions/deletions/hunk headers with the diff color staff.
  - A file with no patch renders the placeholder "No patch available for this file (omitted, withheld, or binary)."
  - Secret content never renders: "Secret content withheld" / "Per platform contract, secret file contents and diffs are never exposed." + key chips.
  - Error and not-found render distinct badges ("error" / "not found").
### FR-13 — Merge preview
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can see the landing outcome before committing. Realizes UJ-1, UJ-3.
- consequences (testable):
  - `GET /merge` folds the given proposals in order onto the baseline (diff3) and returns `status` `clean|conflict` with per-file action/result.
  - The modal renders merged text, conflict text with `<<<<<<< / ======= / >>>>>>>` markers, or a withheld notice for secret-class files.
  - No files changed → "No files changed in merge"; compute failure → "Failed to compute merge".
### NFR-1
- All change-set, conflict, and merge-preview work happens in-Worker within the Workers CPU budget: 30 s default / 5 min max per HTTP request. No read route clones; the only in-memory clone is inside `/land` (AD-2). Fork walks are bounded at 200 first-parent commits.
### NFR-2
- 1 GB/repo · 32 MB/file · 2k git requests/10 s/repo; push cap ~64 MiB → small incremental pushes; push protocol v1-only. Artifacts provides no server-side merge, diff, conflict detection, or branch protection — the platform builds all of them (SPEC constraints).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `landing-policy-engine-branch-protection-and-merge-policy` [pending] Landing policy engine: branch protection and merge policy (overlap 5)
- `watch-artifacts-64-mib-push-cap-v1-protocol-before-oct-14` [pending] Watch Artifacts 64 MiB push cap + v1 protocol before Oct 14 (overlap 4)
- `add-branch-protection-and-defined-concurrent-push-semantics` [pending] Add branch protection and defined concurrent-push semantics (overlap 3)
- `batch-merge-bot-temp-branch-full-ci-push-only-if-green` [pending] Batch merge bot: temp branch, full CI, push only if green (overlap 3)
- `diff-topography-merge-ripples-and-conflict-intersections` [pending] Diff topography: merge ripples and conflict intersections (overlap 3)
- `enforce-server-side-exclusive-file-locks-binary-l-semantics` [pending] Enforce server-side exclusive file locks (binary+l semantics) (overlap 3)
- `keep-pushes-on-the-v1-protocol-for-artifacts-interop` [pending] Keep pushes on the v1 protocol for Artifacts interop (overlap 3)
- `keep-pushes-small-and-incremental-under-the-64-mib-cap` [pending] Keep pushes small and incremental under the ~64 MiB cap (overlap 3)
- `publish-preview-deployments-per-proposal-branch` [pending] Publish preview deployments per proposal branch (overlap 3)
- `review-ui-diffs-visually-from-before-after-screenshots` [pending] Review UI diffs visually from before/after screenshots (overlap 3)
- `budget-for-artifacts-billing-start-2026-10-14` [pending] Budget for Artifacts billing start 2026-10-14 (overlap 2)
- `build-multiplayer-triage-canvas-with-proposal-artifacts` [pending] Build multiplayer triage canvas with proposal artifacts (overlap 2)
- `chained-incremental-pr-stacking-engine-with-auto-restack` [pending] Chained incremental PR stacking engine with auto-restack (overlap 2)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 2)
- `compute-cross-change-conflict-graph-across-concurrent-change` [pending] Compute cross-change conflict graph across concurrent change-sets (overlap 2)
- `cpu-budget-hardening-large-change-sets-within-the-30s-worker` [pending] CPU-budget hardening: large change-sets within the 30s Worker envelope (overlap 2)
- `declare-intent-router-pings-before-work-starts` [pending] Declare intent: router pings before work starts (overlap 2)
- `demo-one-repo-3-5-agents-seeded-collision-land-one-scrub-lea` [pending] Demo: one repo, 3-5 agents, seeded collision, land one, scrub leak (overlap 2)
- `design-review-for-acceptance-not-raw-detection` [pending] Design review for acceptance, not raw detection (overlap 2)
- `detect-cross-worktree-conflicts-before-writes-land` [pending] Detect cross-worktree conflicts before writes land (overlap 2)
- `do-binding-side-diffing-no-clones-in-review-paths` [pending] Do binding-side diffing; no clones in review paths (overlap 2)
- `entity-api-floor-project-repo-branch-cloning-counts` [pending] Entity API: Floor / Project (repo, branch, cloning, counts) (overlap 2)
- `entity-api-proposal-detail-mergeable-commits-comments-review` [pending] Entity API: Proposal detail (mergeable, commits, comments, reviews, checks) (overlap 2)
- `expose-content-read-apis-log-commit-tree-blob-file-raw` [pending] Expose content read APIs (log/commit/tree/blob/file/raw) (overlap 2)
- `fan-out-artifacts-repo-events-through-queues` [pending] Fan out Artifacts repo events through Queues (overlap 2)

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
