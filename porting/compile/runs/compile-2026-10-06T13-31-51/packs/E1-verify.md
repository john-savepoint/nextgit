# Slice pack — E1-verify

**Kind:** verification · **Epic:** E1 — Convergence triage canvas · **Milestone:** M1
**Epic goal:** A reviewer sees every concurrent proposal as one comparable set on a single surface — cards, exact counts, the conflict map — with click-first interaction, honest first-load and failure states, and set freshness that converges on server truth.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E1-verify.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E1-verify-<short-slug>`), title, kind, epic="E1", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = verification: author verification stories for the built requirements here.

## Your requirements (FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-8)
### FR-1 — See all concurrent proposals as one set
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can see every concurrent proposal as one comparable set on a single surface, with no paging and no tab-hopping. Realizes UJ-2.
- consequences (testable):
  - `GET /proposals` returns every auto-discovered proposal (`agent-*`) in one response; the UI renders all cards at once.
  - No route-level pagination or collapse exists in v1; a set of N proposals renders as N cards on the canvas.
  - The set view and the conflict map are visible without opening anything first.
### FR-2 — Proposal card anatomy
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can judge a proposal from its card: repo name, written intent, stats (`N files`, `+a`, `−d`), and per-file rows. Realizes UJ-1, UJ-3.
- consequences (testable):
  - Each card shows `repo`, `intent` when present, file counts, and per-file rows with path + status + additions/deletions.
  - Cards carry `preview merge` and `Land into demo` actions at rest; file rows carry `view diff`.
  - Secret-class file rows show the secret badge and key names and offer no diff action.
### FR-3 — Summary chips (set-level counts)
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can read the set's shape at a glance from five exact counts. Realizes UJ-2.
- consequences (testable):
  - On each `/proposals` payload, chips recompute: proposals / shared files / conflicting pairs / changed files / clean pairs.
  - Tint thresholds: `conflictingPairs > 0` → alert; `sharedFiles > 0` → warn; `cleanPairs > 0` → clean.
  - Counts are exact and labeled ("N detected", "N active"), never approximate.
### FR-4 — Collision map (Convergence Conflicts)
- status: `built`
- needs: implementation=false, verification=true
- description: A reviewer can see which proposals collide, on which files, and where — before reading any diff. Realizes UJ-3.
- consequences (testable):
  - For every conflicting pair, the map renders a per-file card: file path, `kind` badge from the conflict-kinds enum, involved repos, and pair rows naming the two repos with base/line regions.
  - Severity follows the kind mapping (hard conflicts red, `undetermined` amber, clean kinds neutral); cards are read-only with no actions.
  - The panel meta reads `N detected`; an empty set renders an explanatory empty state, not a blank panel.
### FR-5 — Freshness cycle
- status: `built`
- needs: implementation=false, verification=true
- description: The set stays fresh without manual work: pushes appear in seconds, and the surface always converges on the server's truth. Realizes UJ-1, UJ-2.
- consequences (testable):
  - `/proposals` refreshes every 8s while auto-refresh is on (default on); a manual `refresh` is always available.
  - A new top event key (from the ticker) triggers one debounced refresh (500ms).
  - A land triggers an immediate reload of both `/proposals` and `/events`; within one refresh cycle a landed proposal's card state matches the server.
### FR-6 — Degradation and errors
- status: `built`
- needs: implementation=false, verification=true
- description: The surface degrades instead of crashing, and never dresses a failure as success. Realizes UJ-2, UJ-3.
- consequences (testable):
  - One error surface: every failed fetch except the ticker funnels into the red Connection banner ("Connection error: {msg}. Retrying..." / "Disconnected from platform worker. Retrying...") with `Retry now`; the banner hides on the next success.
  - Ticker failure degrades silently — pulse goes stale, last events stay, the rest of the surface keeps rendering.
  - Action banner: warn in-flight, success/error outcome, dismiss-only (no auto-hide); a new action replaces the previous banner; every failure returns the card to `default`.
  - The footer sync line (`not synced yet` → `synced HH:MM:SS`) is never error-styled.
### FR-8 — Interaction model
- status: `built`
- needs: implementation=false, verification=true
- description: Every action is reachable click-first; hover is enhancement, never the only path. Realizes UJ-1, UJ-3.
- consequences (testable):
  - Every action is a click/tap on a native control; no drag, no context menus, no custom shortcuts beyond Tab/Enter/Space/Escape.
  - Inline confirm replaces dialogs: `confirm land?` → commit; `cancel` disarms; no modal confirms, no browser `confirm()`.
  - Escape closes the topmost modal; backdrop click and `close` do the same; modals stack one level deep.

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `build-multiplayer-triage-canvas-with-proposal-artifacts` [pending] Build multiplayer triage canvas with proposal artifacts (overlap 3)
- `proposal-card-signal-set-risk-provenance-fields-on-every-car` [pending] Proposal card signal set: risk + provenance fields on every card (overlap 3)
- `ship-set-level-triage-of-n-concurrent-agent-change-sets-as-h` [pending] Ship set-level triage of N concurrent agent change-sets as hero flow (overlap 3)
- `complete-unified-proposal-card-intent-diff-risk-provenance` [pending] Complete unified proposal card (intent, diff, risk, provenance) (overlap 2)
- `compute-cross-change-conflict-graph-across-concurrent-change` [pending] Compute cross-change conflict graph across concurrent change-sets (overlap 2)
- `inline-streaming-leak-deflectors-on-every-canvas-and-doc-wri` [pending] Inline streaming leak deflectors on every canvas and doc write (overlap 2)
- `law-2-two-tier-intelligence-system-1-sees-every-file-first` [pending] Law 2: two-tier intelligence - System-1 sees every file first (overlap 2)
- `support-host-git-or-native-proposal-model` [pending] Support host git or native proposal model (overlap 2)
- `validate-every-proposal-with-speculative-execution` [pending] Validate every proposal with speculative execution (overlap 2)
- `visualize-the-cross-change-conflict-map-on-the-canvas` [pending] Visualize the cross-change conflict map on the canvas (overlap 2)

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
