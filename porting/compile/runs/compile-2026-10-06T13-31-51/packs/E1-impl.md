# Slice pack — E1-impl

**Kind:** implementation · **Epic:** E1 — Convergence triage canvas · **Milestone:** M1
**Epic goal:** A reviewer sees every concurrent proposal as one comparable set on a single surface — cards, exact counts, the conflict map — with click-first interaction, honest first-load and failure states, and set freshness that converges on server truth.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E1-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E1-impl-<short-slug>`), title, kind, epic="E1", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-7, NFR-8, NFR-9, UX-DR-3, UX-DR-4, UX-DR-5)
### FR-7 — First-load states
- status: `build-gap (specified; not yet built)`
- needs: implementation=true, verification=false
- description: A first-time viewer can tell the difference between loading and empty. Realizes UJ-2.
- consequences (testable):
  - Chips render `—` until the first payload (today they start at `0`).
  - Both panels show a loading indicator matching the final layout ("Loading the set from /proposals..." [ASSUMPTION: copy]) and swap to data or empty state on the first response.
  - The empty states ("No active proposals" / "No convergence conflicts") explain what is awaited.
### NFR-8
- Every failed fetch except the ticker surfaces in one connection banner; panels keep their last render; the ticker degrades silently; landing state is content-derived — the UI never shows a success it did not observe.
### NFR-9
- Visible focus on every interactive control; modal focus trap returning focus to the trigger; Escape/backdrop/close modal semantics; reduced-motion support; ≥44px touch targets at phone widths; document-order tab order. Known gap to fix: `{colors.text-muted}` ≈3.3:1 and `{colors.text-dim}` ≈2.1:1 are below 4.5:1 for small text — confined to meta labels/ambient chrome; they must not be extended to body copy or state messaging, and raising them is a pending decision. [ASSUMPTION: floor ratified for M1 (revisit at the §7.5 gate; John may overrule anytime).] [NOTE FOR PM: raising `{colors.text-muted}`/`{colors.text-dim}` is a pending decision — the current ratios are the as-built floor, not a ratified contrast target.]
### UX-DR-3
- GAP #7 — <424px overflow: proposals grid 360px track floor + 2rem container padding overflows below ~424px viewports; fix = single column below the floor `[ASSUMPTION]` (`EXPERIENCE.md:259`). Triage app has no authored media queries; only tour.css has breakpoints (768px, 640px) (`EXPERIENCE.md:255-257`).
### UX-DR-4
- Pending-intake state behaviors to lock at requirement level: WCAG 2.2 AA floor; tab order; modal focus trap; reduced-motion; 44px touch targets; first-load treatment; card treatments for the two unrendered states; `no-changes` copy (`EXPERIENCE.md:264`).
### UX-DR-5
- Interaction requirements as behavior: click-first (no drag/context menus/custom shortcuts beyond Tab/Enter/Space/Escape); inline confirm replaces dialogs; Escape closes topmost modal (one level deep, never two); hover is enhancement only — every action always visible without hover; tab order = document order, modal traps focus and returns it to trigger `[ASSUMPTION — verify in build]` (`EXPERIENCE.md:32`, `:177-181`).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `build-multiplayer-triage-canvas-with-proposal-artifacts` [pending] Build multiplayer triage canvas with proposal artifacts (overlap 4)
- `entity-api-issue-number-title-state-labels-assignees-body` [pending] Entity API: Issue (number, title, state, labels, assignees, body) (overlap 3)
- `entity-api-pull-proposal-client-entity-state-draft-checks-cl` [pending] Entity API: Pull / Proposal client entity (state, draft, checks, closes) (overlap 3)
- `inline-streaming-leak-deflectors-on-every-canvas-and-doc-wri` [pending] Inline streaming leak deflectors on every canvas and doc write (overlap 3)
- `proposal-card-signal-set-risk-provenance-fields-on-every-car` [pending] Proposal card signal set: risk + provenance fields on every card (overlap 3)
- `use-crdts-for-review-state-only-never-code-text` [pending] Use CRDTs for review state only, never code text (overlap 3)
- `build-one-continuous-surface-no-tab-explosion` [pending] Build one continuous surface, no tab explosion (overlap 2)
- `build-semantic-index-and-context-maps-for-repos` [pending] Build semantic index and context maps for repos (overlap 2)
- `build-specialist-judge-scoring-proposals-for-arbitration` [pending] Build specialist judge scoring proposals for arbitration (overlap 2)
- `build-three-tier-architecture-substrate-judge-triage-ui` [pending] Build three-tier architecture: substrate, judge, triage UI (overlap 2)
- `choose-canvas-tech-without-license-traps` [pending] Choose canvas tech without license traps (overlap 2)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 2)
- `compute-cross-change-conflict-graph-across-concurrent-change` [pending] Compute cross-change conflict graph across concurrent change-sets (overlap 2)
- `detect-duplicated-behavior-across-proposals-and-forks` [pending] Detect duplicated behavior across proposals and forks (overlap 2)
- `enable-interactive-output-pages-with-action-buttons` [pending] Enable interactive output pages with action buttons (overlap 2)
- `entity-api-floor-project-repo-branch-cloning-counts` [pending] Entity API: Floor / Project (repo, branch, cloning, counts) (overlap 2)
- `events-floor-lifecycle-enter-added-removed` [pending] Events: floor lifecycle (enter/added/removed) (overlap 2)
- `gate-behavior-changes-without-matching-tests` [pending] Gate behavior changes without matching tests (overlap 2)
- `keep-durable-work-state-tier-queue-presence-leases` [pending] Keep durable work/state tier (queue, presence, leases) (overlap 2)
- `keep-pushes-small-and-incremental-under-the-64-mib-cap` [pending] Keep pushes small and incremental under the ~64 MiB cap (overlap 2)
- `law-2-two-tier-intelligence-system-1-sees-every-file-first` [pending] Law 2: two-tier intelligence - System-1 sees every file first (overlap 2)
- `match-beat-incumbent-conflict-resolution-at-set-level` [pending] Match/beat incumbent conflict resolution at set level (overlap 2)
- `mcp-server-exposing-set-context-to-external-agents` [pending] MCP server exposing set context to external agents (overlap 2)
- `render-fork-cards-with-six-signal-clusters` [pending] Render fork cards with six signal clusters (overlap 2)
- `ship-set-level-triage-of-n-concurrent-agent-change-sets-as-h` [pending] Ship set-level triage of N concurrent agent change-sets as hero flow (overlap 2)

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
