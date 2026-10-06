---
title: "NextGit — Product Requirements"
status: final
created: 2026-10-06
updated: 2026-10-06
---

# PRD: NextGit — Product Requirements
*Working title — confirm.*

## 0. Document Purpose

This PRD is the product-requirements layer for NextGit, written for the PM, stakeholders, and the downstream workflow owners (UX, architecture, story creation) that source-extract from it. It is Glossary-anchored: features are grouped by area, functional requirements are numbered globally (FR-1 … FR-47), and every FR carries a status tag — **built** · **required-M1** · **sequenced (Mn)** · **pending** · **roadmap**, with **build-gap** qualifying a built FR whose specified behavior the UI does not yet render — plus its milestone field (the `Mn` in `sequenced (Mn)`; unsequenced work is listed in §13.2), so a reader can always tell shipped behavior from scheduled behavior. Deferred and skipped items are explicit: §5 Non-Goals, §13 Milestones, and `[NON-GOAL]` / `[SEQUENCED]` callouts inline. Inline `[ASSUMPTION]` tags flag inferred defaults and are indexed in §15.

It builds on finished and draft artifacts rather than duplicating them: the product brief (final), the frozen SPEC + companions, the architecture spine (final — 15 ADs; the architecture is referenced, not restated; implementation detail lives there and behind `platform/CONTRACT.md`), the UX spines (draft — `DESIGN.md` + `EXPERIENCE.md`, four adjudications pending), the judge-layer catalog (`docs/judge-layer-ideas.md`), and the research dossiers. `addendum.md` in this folder carries the evidence pack with sources and an index to all of them. Platform/API FRs (FR-30/31/39, FR-42-47) serve all journeys — "Realizes UJ-1 through UJ-4" is implied for that class.

## 1. Vision

Many AI agents now work on one codebase at once. Each finishes its task in isolation and arrives as yet another branch; the reviewer is left holding a set they cannot see — ten proposals, no way to compare them side by side, no way to know which two collide, often no way to reconstruct why each change was made. Across 33,596 agent-authored PRs, ~41.7% of concurrent agent pairs conflict; frontier models catch only 15–31% of human-flagged issues. Integration, not generation, is the crisis. Duplicated effort compounds the waste — the same fix attempted across several forks, agent compute spent twice or thrice. [ASSUMPTION: directional — no metric yet; revisit at M4 when FR-46 ships.]

NextGit makes **the set the unit of review**. Every concurrent agent change-set arrives as a **proposal** carrying its intent, its diff, its collision status, and its provenance. All proposals sit on one review surface as one comparable set — cards, a conflict map, set-level counts. Any proposal's landing can be previewed; any diff can be read; a chosen proposal **lands server-side in one click** — no clones, no CLI. A judge layer (built & live 2026-10-06) scores risk, verifies that the diff does what its intent claims, and flags semantic collisions; code decides; humans still own irreversible acts. A trust layer treats secret-class files as typed objects: key names visible, values never.

The bet: **the convergence layer** — the set-level surface where concurrent agent work is compared, judged, and merged — is the missing piece of the agent era. No shipping product presents N concurrent agent change-sets as one comparable set with real conflict computation (no counterexample across six independent search efforts; nearest alternatives are GitGhost (private beta), Whiteboard (single-branch, local), and Entire (announced, unshipped)). NextGit is built end-to-end on the stack that makes it possible — Cloudflare Workers + Artifacts, with Queues and KV for the event path and Clef for hot-path decisions — and is the entry in Cloudflare's next-gen Git platform competition, due October 14, with adoption ambitions beyond it.

The arc: Year 1 — adoption as the convergence layer over existing repos; Years 2–3 — the platform absorbs the rest (workspaces become the default home for agent work, the asset tier opens the game industry, clients multiply). The endgame — make GitHub irrelevant, not by cloning it but by making the layer it lacks the layer everyone uses. [ASSUMPTION: founder's stated ambition — retained as directional]

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** see every concurrent agent change-set as one comparable set; decide which proposal ships without tab-hopping; see which proposals collide before landing; reconstruct why a change was made; keep secret values out of review surfaces; ship with a record of what was reviewed and landed.
- **Emotional:** confidence in what ships; never re-discover a collision late; never wonder whether a diff did what its summary claimed.
- **Social:** a team can let agents run in parallel without becoming the bottleneck; reviewers are conductors, not queue processors.
- **Contextual:** the agents write; a human decides. The product assumes machine-authored work first and is designed to be machine-legible — the API is a first-class consumer surface.

**Market language (v1):** teams already running agent fleets — platform and dev teams at AI-forward companies, agencies, OSS projects receiving machine-authored PRs — and the reviewer/conductor who decides what ships. Secondary: game studios (asset scale — roadmap), agent-harness builders (API consumers), and the agents themselves. [ASSUMPTION: the ordering of segments is inferred from the competitive research's early-adopter read; validate with first design partners.]

**Demo protagonist:** John — the human conductor/reviewer; a solo operator. The agent crews (`agent-1` … `agent-4`) are workers. The demo story is written for this protagonist; the market language above stays "teams + reviewer/conductor". [ASSUMPTION: ratified for M1 (revisit at the §7.5 gate; John may overrule anytime) — the UX spines hold John as the demo protagonist; the brief's primary segment is teams + reviewer. Feeds the four pending UX adjudications.]

### 2.2 Non-Users (v1)

- Teams wanting the classic GitHub surface — repo browsing, issues, CI, profiles. NextGit is not a GitHub clone, and per-change review is explicitly not its center.
- Teams with no concurrent agent work — a single sequential author gains little from set-level triage.
- Game studios at asset scale (binary pipeline, locking, per-file ACLs) — named roadmap; not v1.
- Enterprise compliance buyers — no multi-tenant hardening, no SSO product, no billing in v1.
- Any client beyond the web app — the planned Agent Office 3D client, IDEs, CLIs are future API consumers; the platform API is the product, clients are surfaces.

### 2.3 Key User Journeys

UJ IDs mirror the UX spine's flows (`EXPERIENCE.md` §Key Flows). Where the UX document is richer than this PRD, it is the source of truth for interaction detail.

- **UJ-1. John lands one proposal out of four concurrent crews (the demo story).**
  - **Persona + context:** John, a solo operator/conductor, one repository, four agent crews working concurrently. The 5–10 minute demo take.
  - **Entry state:** platform open; baseline `demo @ main` on screen; four workspaces provisioned; crews pushing.
  - **Path:** every proposal routes to the triage canvas as a card (intent, files, stats); pushes flow into the ticker; a deliberate collision on `src/auth.ts` renders in the conflict map with line regions; John reads an intent block, opens a diff, previews the merge.
  - **Climax:** John clicks `Land into demo` → `confirm land?` → the card lands: "Successfully landed proposal agent-3 into demo. Commit `<sha8>`"; the card flips to "landed — nothing pending"; a `repo.pushed` event re-enters the ticker; the decision record persists as a git note.
  - **Resolution:** the set is smaller; the baseline moved; the receipt is on screen. Next: dismiss the banner and continue triage.
  - **Edge case:** landing the colliding proposal → 409 conflict with the files named and "(preview merge first)"; landing a secret-touching proposal → 409 withheld-secret. Every failure returns the card to default; the banner stays until dismissed. (Rehearse all three failure paths.)
- **UJ-2. John's first contact: comprehension under a minute.**
  - **Persona + context:** John opens the worker URL cold. No documentation read.
  - **Entry state:** unauthenticated (demo); browser only.
  - **Path:** the header orients in one line (brand + `base: demo · ref: main`); chips give the set's counts; the ticker shows recent pushes; the conflict panel and the proposal grid are the entire set on one canvas — nothing to open first.
  - **Climax:** inside a minute John can state what the fleet is doing and which pair collides — the set is legible before any click.
  - **Resolution:** if anything is unclear, `Start the tour` is one click away.
  - **Edge case:** platform unreachable → "Disconnected from platform worker. Retrying..." + `Retry now`; empty repo → both panels' empty states explain what they await.
- **UJ-3. The triage decision — scan the conflict map, then decide.**
  - **Persona + context:** John has minutes, not an hour. Several proposals are competing for the same file.
  - **Entry state:** the `conflicting pairs` chip is tinted; the conflict map is the first stop.
  - **Path:** the conflict card names the file, the two repos, and the pair's line regions; John opens the colliding proposal's diff; then `preview merge` to see the landing outcome before committing.
  - **Climax:** the decision happens on the canvas — the chosen proposal lands (UJ-1, climax) or is held; no tab-hopping, no local git, no CLI.
  - **Resolution:** the set reflects the decision; the record explains it.
  - **Edge case:** merge preview fails → badge "error" + "Failed to compute merge" (reopen to retry); landing anyway → 409 conflict banner "(preview merge first)".
- **UJ-4. Learn the model — the tour, and when it is offered.**
  - **Persona + context:** a first-time reviewer (or a judge in the competition video) needs the vocabulary: convergence, proposal, collision.
  - **Entry state:** offered from the triage header at all times (`Start the tour`, `?`); also openable directly.
  - **Path:** a 10-step clickable stepper; steps 0–5 teach the model with simulations; step 6 shows the real platform; step 7 quizzes ("Which Would You Ship?"); step 8 states scope honestly; step 9 frames the role.
  - **Climax:** at step 6 the lesson becomes the product — the real `/proposals` grid renders live inside the tour; at step 9 `Open the Triage App` returns the operator to the surface.
  - **Resolution:** the operator can name the parts of the platform and act.
  - **Edge case:** step 6 fetch fails → console warning + graceful fallback snapshot; the tour never breaks and shows no error banner.

## 3. Glossary

Downstream artifacts use these terms exactly. Introducing a synonym anywhere is a discipline violation.

- **Proposal** — one agent's change-set offered for landing, presented as one card on the review surface. Cardinality: 1 workspace → 1 proposal (the repo's head vs the baseline fork point). Identified by its repo name (`agent-N`).
- **Change-set** — what a proposal changed: per-file status (added/modified/removed), additions/deletions, and diffs computed against the **fork point**. Captured server-side; no clones.
- **Fork point** — the most recent commit shared between the proposal repo and the baseline (first-parent walk, limit 200; base-head fallback when none is found). Diffs and merges use it as the 3-way ancestor; the change-set is stable while the baseline moves.
- **Convergence** — the set-level act: comparing, judging, and merging concurrent proposals. The product's central act; sets, not diffs.
- **Landing** — folding a chosen proposal (or ordered set) onto the baseline and pushing the result server-side as one commit. The only path that writes baseline branches.
- **Judge chips** — the three advisory signals on a proposal card from the judge layer (built & live 2026-10-06): risk, intent-vs-diff verification, semantic collision. Advisory only: the judge advises; code decides.
- **Conflict kinds** — the enumerated pairwise classification: `text-conflict`, `modify/delete`, `add/add`, `undetermined`, `mergeable`, `identical-add`, `both-removed`. Severity mapping: the first three are hard conflicts, `undetermined` is amber, the last three are clean. Computed by attempting the merge, not by heuristics.
- **Baseline** — the base repo (`demo`) and its default branch (`main`) that proposals are made against and landed onto.
- **Workspace** — one agent's isolated repo fork provisioned from the baseline, with a scoped token. Fork-per-agent.
- **Intent record** — the written why of a change-set, carried as git notes and surfaced on the card and file rows; durable across rebases.
- **Notes mirror** — the branch (`nextgit-notes`) mirroring `refs/notes/commits`; all readers use the mirror because binding-side `refs/notes/*` resolution is unsupported. Fast-forward-only.
- **Secret-class file** — a path matching the platform's secret classes (`.env*`, `*.pem`, `*.key`, `*.p12`, `credentials.json`, `secrets.json`, `.dev.vars`, any path containing `secrets/`). Rendered as key names only, never values.
- **Withheld-secret** — the state of a fold or change-set row that touches a secret-class file: content never leaves the worker; landings of such proposals are refused with 409.
- **Crew** — informal: the set of agent workers on one repo (the demo's four crews); not a formal platform term.

## 4. Features

### 4.1 Set view — Concurrent Proposals and Convergence Conflicts (CAP-4)

**Description:** The triage canvas. Every concurrent proposal appears as one card on one surface — repo, written intent, stats, file rows, actions — and every collision appears in the map above it. Set-level summary chips carry the counts. There is no paging, no tab-hopping, and no collapse: the whole set is the screen. Realizes UJ-1, UJ-2, UJ-3. UI copy uses the as-built labels **Concurrent Proposals** and **Convergence Conflicts**; "fleet" is market language and does not appear in the UI.

#### FR-1: See all concurrent proposals as one set

**Status:** built.

A reviewer can see every concurrent proposal as one comparable set on a single surface, with no paging and no tab-hopping. Realizes UJ-2.

**Consequences (testable):**
- `GET /proposals` returns every auto-discovered proposal (`agent-*`) in one response; the UI renders all cards at once.
- No route-level pagination or collapse exists in v1; a set of N proposals renders as N cards on the canvas.
- The set view and the conflict map are visible without opening anything first.

#### FR-2: Proposal card anatomy

**Status:** built.

A reviewer can judge a proposal from its card: repo name, written intent, stats (`N files`, `+a`, `−d`), and per-file rows. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- Each card shows `repo`, `intent` when present, file counts, and per-file rows with path + status + additions/deletions.
- Cards carry `preview merge` and `Land into demo` actions at rest; file rows carry `view diff`.
- Secret-class file rows show the secret badge and key names and offer no diff action.

#### FR-3: Summary chips (set-level counts)

**Status:** built.

A reviewer can read the set's shape at a glance from five exact counts. Realizes UJ-2.

**Consequences (testable):**
- On each `/proposals` payload, chips recompute: proposals / shared files / conflicting pairs / changed files / clean pairs.
- Tint thresholds: `conflictingPairs > 0` → alert; `sharedFiles > 0` → warn; `cleanPairs > 0` → clean.
- Counts are exact and labeled ("N detected", "N active"), never approximate.

#### FR-4: Collision map (Convergence Conflicts)

**Status:** built.

A reviewer can see which proposals collide, on which files, and where — before reading any diff. Realizes UJ-3.

**Consequences (testable):**
- For every conflicting pair, the map renders a per-file card: file path, `kind` badge from the conflict-kinds enum, involved repos, and pair rows naming the two repos with base/line regions.
- Severity follows the kind mapping (hard conflicts red, `undetermined` amber, clean kinds neutral); cards are read-only with no actions.
- The panel meta reads `N detected`; an empty set renders an explanatory empty state, not a blank panel.

#### FR-5: Freshness cycle

**Status:** built.

The set stays fresh without manual work: pushes appear in seconds, and the surface always converges on the server's truth. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- `/proposals` refreshes every 8s while auto-refresh is on (default on); a manual `refresh` is always available.
- A new top event key (from the ticker) triggers one debounced refresh (500ms).
- A land triggers an immediate reload of both `/proposals` and `/events`; within one refresh cycle a landed proposal's card state matches the server.

#### FR-6: Degradation and errors

**Status:** built.

The surface degrades instead of crashing, and never dresses a failure as success. Realizes UJ-2, UJ-3.

**Consequences (testable):**
- One error surface: every failed fetch except the ticker funnels into the red Connection banner ("Connection error: {msg}. Retrying..." / "Disconnected from platform worker. Retrying...") with `Retry now`; the banner hides on the next success.
- Ticker failure degrades silently — pulse goes stale, last events stay, the rest of the surface keeps rendering.
- Action banner: warn in-flight, success/error outcome, dismiss-only (no auto-hide); a new action replaces the previous banner; every failure returns the card to `default`.
- The footer sync line (`not synced yet` → `synced HH:MM:SS`) is never error-styled.

#### FR-7: First-load states

**Status:** build-gap (specified; not yet built).

A first-time viewer can tell the difference between loading and empty. Realizes UJ-2.

**Consequences (testable):**
- Chips render `—` until the first payload (today they start at `0`).
- Both panels show a loading indicator matching the final layout ("Loading the set from /proposals..." [ASSUMPTION: copy]) and swap to data or empty state on the first response.
- The empty states ("No active proposals" / "No convergence conflicts") explain what is awaited.

#### FR-8: Interaction model

**Status:** built.

Every action is reachable click-first; hover is enhancement, never the only path. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- Every action is a click/tap on a native control; no drag, no context menus, no custom shortcuts beyond Tab/Enter/Space/Escape.
- Inline confirm replaces dialogs: `confirm land?` → commit; `cancel` disarms; no modal confirms, no browser `confirm()`.
- Escape closes the topmost modal; backdrop click and `close` do the same; modals stack one level deep.

**Feature-specific NFRs:** the set view is one surface — the API-first design means it consumes only documented routes (§4.10).

### 4.2 Change-set engine (CAP-2, CAP-3)

**Description:** What each agent changed, computed server-side against the fork point, with conflicts classified by actually attempting the merge. No clones on the review path. Realizes UJ-1, UJ-3.

#### FR-9: Server-side change-set capture

**Status:** built.

A reviewer can read any proposal's commits, changed files, and diffs without a clone. Realizes UJ-3.

**Consequences (testable):**
- `GET /changes?repo=…&base=demo&ref=main&baseRef=main` returns the baseline and head identities, stats, and per-file rows.
- The change-set carries a per-fork commit list — hash, author, timestamp, message — alongside the per-file rows.
- Per-file rows carry status (added/modified/removed), additions/deletions, and a patch; patches are absent for secret, binary, or oversized files.
- No read route shells out to git or clones; the review path never clones (architecture: AD-2; the only in-memory clone is inside `/land`).

#### FR-10: Fork-point diff semantics

**Status:** built.

A proposal's change-set means "what the agent changed" and stays stable while the baseline moves. Realizes UJ-3.

**Consequences (testable):**
- Change-sets are diffed against the fork point (most recent commit shared with base, first-parent walk limit 200; base-head fallback when none is found).
- `/merge` and `/land` use the fork point as the 3-way ancestor (ancestor = fork-point texts, ours = current base head, theirs = proposal head).
- After the baseline advances (another proposal lands), an unchanged proposal's change-set is byte-identical.

#### FR-11: Real conflict detection with enumerated kinds

**Status:** built.

A reviewer can trust that a "conflict" is real — it was produced by attempting the merge. Realizes UJ-3.

**Consequences (testable):**
- `/proposals` classifies every pair; `kind` ∈ `text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed`.
- Conflict cards carry the pair's line regions (`base`, `a`, `b` lines) where a region exists.
- The summary's `conflictingPairs` / `cleanPairs` counts agree with the map's rendered cards.

#### FR-12: Diff viewer states

**Status:** built.

A reviewer can read one file's change-set with unambiguous states. Realizes UJ-3.

**Consequences (testable):**
- Patch rows render additions/deletions/hunk headers with the diff color staff.
- A file with no patch renders the placeholder "No patch available for this file (omitted, withheld, or binary)."
- Secret content never renders: "Secret content withheld" / "Per platform contract, secret file contents and diffs are never exposed." + key chips.
- Error and not-found render distinct badges ("error" / "not found").

#### FR-13: Merge preview

**Status:** built.

A reviewer can see the landing outcome before committing. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- `GET /merge` folds the given proposals in order onto the baseline (diff3) and returns `status` `clean|conflict` with per-file action/result.
- The modal renders merged text, conflict text with `<<<<<<< / ======= / >>>>>>>` markers, or a withheld notice for secret-class files.
- No files changed → "No files changed in merge"; compute failure → "Failed to compute merge".

### 4.3 Landing (CAP-7)

**Description:** One click, server-side. The chosen proposal folds onto the baseline and the worker pushes exactly one commit. The reviewer sees a receipt with its validation evidence; nothing pretends to land that did not. Realizes UJ-1. Semantics: architecture AD-1/AD-3.

#### FR-14: One-click server-side landing

**Status:** built.

A reviewer can land a chosen proposal from its card, with no clone and no CLI. Realizes UJ-1.

**Consequences (testable):**
- `Land into demo` → inline `confirm land?` → `POST /land`; the worker folds and pushes one commit (`land(<repos>): fold proposal(s)`) to the baseline branch.
- In-flight: the card shows a single disabled `landing...` button; the banner narrates "Landing proposal {repo} into {base}...".
- The caller needs no local git, no credentials, and never sees a token.

#### FR-15: Landing outcomes — an open, numbered set

**Status:** built (outcomes 1–5, 7) / build-gap (dedicated `no-changes` banner copy; `withheld-secret` and `conflict` card states) / required-M1 (outcomes 8–9: `stale`, `base-moved`).

A reviewer gets an unambiguous outcome for every landing attempt. The set is open and numbered: outcomes 1–7 below, plus 8 (`stale`) and 9 (`base-moved`) — nine total; the last two ship with the land-hardening slice (FR-16, FR-17). Realizes UJ-1 (edge case path).

**Consequences (testable):**
1. `Land into demo` → card flips to `confirm land?` + `cancel` (inline; no dialog).
2. `confirm land?` → disabled `landing...`; banner (warn) "Landing proposal {repo} into {base}...".
3. Success → banner (success) "Successfully landed proposal {repo} into {base}. Commit `<sha8>`" — first 8 chars, full SHA in the tooltip; proposals + events refresh immediately; the `repo.pushed` event re-enters the ticker.
4. 409 `withheld-secret` → error banner "Withheld-secret file — landing blocked ({files})."
5. 409 `conflict` → error banner "Conflicted files: {files}. (preview merge first)"
6. 409 `no-changes` → dedicated variant: "Nothing to land — fold produced zero changes." [ASSUMPTION: copy]
7. Any other failure → error banner "Failed to land {repo}: {msg}".
8. 409 `stale` → error banner "This proposal is stale — rebase and re-push to land." [ASSUMPTION: copy]
9. 409 `base-moved` → error banner "Nothing to land — the baseline moved since this proposal was made." [ASSUMPTION: copy]
- Every failure returns the card to `default`; the banner persists until dismissed; card states for `withheld-secret` and `conflict` are specified in the UX spine and not yet rendered (build gap).

#### FR-16: Reviewed-state precondition

**Status:** required-M1 — planned (land-hardening workstream; contract bump first).

A reviewer can trust that what lands is what was reviewed. Realizes UJ-1.

**Consequences (testable):**
- `/land` accepts the reviewed base head and proposal heads (additive request fields) and returns 409 `stale` on mismatch — no silent re-fold.
- Landing content a reviewer never saw is impossible through the public route once the precondition is enforced.

#### FR-17: Concurrency precondition

**Status:** required-M1 — planned (land-hardening); the DO lease arrives later (roadmap, unsequenced).

Concurrent landings cannot silently overwrite each other. Realizes UJ-1.

**Consequences (testable):**
- After the in-memory clone, `/land` re-reads the base head and returns 409 `base-moved` on divergence.
- A Durable Object lease (roadmap, unsequenced) serializes lands when it arrives; until then the precondition is the guarantee.
- The race is reproduced and covered by a regression check (4 concurrent lands → no silent overwrite).

#### FR-18: Landing record and validation evidence

**Status:** required-M1 (land-hardening workstream); the short-SHA receipt is the minimum the build carries today.

Every landing is traceable and carries its validation evidence: what was reviewed, what checks ran and their results, what was folded, and the hash that proves merged-SHA equals tested-SHA. Realizes UJ-1.

**Consequences (testable):**
- Every landing records ancestor + heads + fold hash; merged-SHA-equals-tested-SHA is checked against the recorded fold hash — no landing claims validation it did not run.
- The landing record extends with `evidence { checks[], results[], mergedSha, testedSha, artifactRef, at }` on `POST /land`; a read surface serves the record — planned route `GET /landings/{commit}`. [ASSUMPTION: the contract bump is pinned with the land-hardening workstream per contract-first discipline (FR-42) — the latest `CONTRACT.md` revision carries it.]
- The short-SHA success banner is the minimum receipt, not the target; the evidence artifact ships with the land-hardening workstream (Milestone 1). `landed.files` and `landed.at` render in the same slice (contract-defined, currently unrendered — build gap).
- The decision record persists as a git note on the proposal.

#### FR-19: Landed-state card

**Status:** built (landed) / build-gap (`landed.files` count unrendered).

A reviewer can see at a glance that a proposal has nothing pending. Realizes UJ-1.

**Consequences (testable):**
- `landing.status === "landed"` (or `stats.files === 0`) dims the card to 0.55 opacity with a dashed border and the "landed — nothing pending" line ("All changes from this branch have been merged into baseline.").
- `landing.status` is content-derived: a zero-change fold is `landed`; `/land` with zero changes is 409 `no-changes` — never a fake success.

### 4.4 Live events (CAP-6)

**Description:** The platform proves it is alive: pushes, forks, and landings flow through an event pipeline into the ticker and drive UI freshness. The feed is a hint, never authority. Realizes UJ-1, UJ-2. Semantics: architecture AD-6.

#### FR-20: Events ticker

**Status:** built.

A reviewer can see recent platform activity without asking. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- The ticker shows the newest ≤8 events (type, repo, time); it consumes the real-time feed (FR-22) and polls `/events` every 2s only on the fallback path.
- A push appears in the ticker within seconds and can trigger the debounced proposals refresh (FR-5).
- On `/events` failure the pulse goes stale and the last events stay; the ticker never breaks the rest of the surface.

#### FR-21: Event feed discipline

**Status:** built (core) / sequenced (M2) (payload validation + dedupe hardening).

The event feed is accurate: recorded once, deduped, validated, and never authoritative for writes. Realizes UJ-1.

**Consequences (testable):**
- Artifacts events arrive through exactly one queue consumer (the worker) — the sole recorder; dedupe key `(type, repo, ref, after)`.
- Events without repo identity are logged and dropped, never partially recorded; payloads are validated (type whitelist, repo/ref charsets, hex shas) before recording (sequenced M2).
- `GET /events` serves the ≤50 newest; KV `LIVE` has exactly one writer; the feed is a hint, never authority for writes or identity.

#### FR-22: Real-time transport, polling fallback

**Status:** required-M1 (real-time transport); built (polling fallback).

The UI is event-driven end to end: pushes, forks, and landings surface in real time; polling exists only as the degraded fallback. Realizes UJ-1, UJ-2. [OQ-3 (retired) — real-time required, 2026-10-06.]

**Consequences (testable):**
- Real-time transport (SSE or WebSocket over a Durable Object hub) carries platform events to the UI; a push appears without any poll, and a landing updates the set without waiting for a refresh cycle.
- The proof form holds: on-screen freshness visibly beats a 90 s poll (SM-2 keeps the ≤2 s form), captured as demo evidence.
- Polling remains the degraded fallback: when the transport is unavailable, `/events` 2s, `/proposals` 8s (auto-refresh toggle, default on); a land reloads both endpoints immediately; `/events` failure must never break the proposals UI.
- As-built today: polling only (the event pipeline is live); the real-time transport ships in Milestone 1.

### 4.5 Judge layer — built & live (CAP-8 partial; judge-layer catalog)

**Description:** A platform-native decision layer over the set: for each proposal, a risk score, an intent-vs-diff verification, and a semantic-collision flag, delivered as typed answers from Clef through one `POST /judge`. State is assembled server-side and masking-filtered; callers cannot supply state or questions; the model is pinned and fails closed. Chips are advisory; code decides. Realizes UJ-3. The contract shapes and the v1 card-signal vocabulary are pinned (2026-10-06); the layer is **built & live** (2026-10-06: `platform/src/judge.ts`, `POST /judge`, chips browser-verified, suite 73/73). The auto-land gate stays off pending calibration (FR-26, OQ-5). Semantics: architecture AD-11.

#### FR-23: Three typed card signals

**Status:** built (contract pinned 2026-10-06; live 2026-10-06).

A reviewer can see three advisory signals per proposal: risk, intent-vs-diff, semantic collision. Realizes UJ-3.

**Consequences (testable):**
- `POST /judge` `setId v1` returns one typed entry per judged proposal: `risk.label` ∈ {routine, focused, senior-security} + `risk.score` [0,2]; `intent.verdict` ∈ {supports, contradicts, insufficient} + `intent.overclaim` [0,1] (null when insufficient); `collision` boolean.
- Unknown `setId` → 400 `unknown-set`; sets are versioned in code; new ids are additive and existing ids never change meaning.
- The wire carries typed answers, never prose; thresholds, weights, and labels live in code.

#### FR-24: Server-assembled state, pinned model, fail-closed

**Status:** built (contract pinned 2026-10-06; live 2026-10-06).

A reviewer can trust that judgments cannot be steered from the outside and never appear when the judge is unavailable. Realizes UJ-3.

**Consequences (testable):**
- Callers cannot supply `state`, `questions`, or `model`; unknown fields → 400 `bad-request`.
- State is assembled server-side from the same fork-point change-sets the set view uses; untrusted content enters delimited and labeled as data; instruction-like text is stripped; every outbound state passes the masking filter (no secret-class values).
- Model id is pinned (`@cf/cloudflare/clef`); a response whose `model` differs or is absent ⇒ 503 `judge-unavailable` (no judgments); schema-invalid answers ⇒ 503; failures are silent to the UI and never block landing.
- Per-caller caps: 60 judge runs/min and 1000/day; beyond → 429. [ASSUMPTION: constants proposed — pin in code at the land-hardening slice.] `skipped[]` lists unjudged proposals with reasons (`secret-class`, `empty-change-set`) — a skip is not a verdict.

#### FR-25: Advisory chip rendering

**Status:** built.

A reviewer can read judge output as advice, visibly distinct from hard conflict state. Realizes UJ-3.

**Consequences (testable):**
- Chips render on proposal cards in the existing badge/chip language; collision emphasis introduces no new hues; advisory signals stay amber/neutral and are never dressed as a red hard conflict.
- Skipped proposals render no chips.
- "The judge advises; code decides; humans still own irreversible acts" holds in behavior: no chip blocks or forces an action.

#### FR-26: Auto-land gate

**Status:** roadmap (unsequenced — the judge is live; the gate is explicitly not engaged, pending calibration per FR-27/OQ-5).

Auto-landing can exist later, gated and fail-closed — not before. Realizes UJ-1.

*[NON-GOAL: engaging auto-land — the gate is roadmap, unsequenced (OQ-5); no demo or first-version path auto-lands.]*

**Consequences (testable):**
- The gate is evaluated inside `POST /land` before fold and push; when engaged and the judge cannot answer, `/land` fails closed (no push).
- Auto-land stays off until an injection-testing spike passes on our labeled set and at least one non-model corroborating signal exists (fold status / conflict map).
- Clients render verdicts; they never decide them.

#### FR-27: Calibration before trust

**Status:** required-M1 (advisory-only; the gate stays off) — calibration not yet run; the judge ships advisory-only until the calibration record exists.

Judge thresholds are tuned on our own labeled proposals before any gating is trusted.

**Consequences (testable):**
- The calibration record's minimum contents: ≥50 labeled proposals carrying risk + intent-verification labels; precision ≥0.9 on the ship-blocking class; the injection-testing spike passes; sign-off by John. [ASSUMPTION: numeric targets proposed.]
- Thresholds/weights/labels are code constants tuned on that labeled set; the first version ships advisory-only until the record exists — the auto-land gate engages only after the record exists (OQ-5 cites this).
- Model id is logged per response; drift to an unpinned id fails closed.

### 4.6 Trust layer (CAP-8, CAP-5)

**Description:** Two guarantees: secret-class content never leaves the worker, and every change-set carries its why. Values are never rendered; intent survives as git notes. Realizes UJ-1. Semantics: architecture AD-4, AD-5, AD-9.

#### FR-28: Secret-class masking law

**Status:** built.

A reviewer can read a secret-class file's schema without exposing a value. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Secret-class paths (`.env*`, `*.pem`, `*.key`, `*.p12`, `credentials.json`, `secrets.json`, `.dev.vars`, any path containing `secrets/`) render key names only (`keys[]`) in any response body — never values; secret rows carry no patch and no intent.
- No secret-class content leaves the worker in any form — including logs and any AI/judge state; outbound judge states are constructed through the masking filter.
- Free-text channels derived from repo content (intent, notes, error strings) are scrubbed: `KEY=VALUE`-shaped values redacted; intent dropped whenever the head commit touches a secret-class path.

#### FR-29: Blocked landing and withheld merges

**Status:** built.

A reviewer cannot leak a secret by landing it. Realizes UJ-1.

**Consequences (testable):**
- A fold touching a secret-class file returns `withheld-secret`; `/land` with any affected secret-class file → 409 `withheld-secret` with the files listed; values are never pushed by the worker.
- Merge previews render `result: withheld-secret` with the withheld notice and no text.

#### FR-30: Masking posture and widening

**Status:** built (path-driven) / sequenced (M2) (content detection).

Masking is path-driven by design in this version; widening is deliberate, additive, and decided once.

**Consequences (testable):**
- A secret value placed in a non-secret-class path is not redacted in v1 (documented limitation; values must live in secret-class paths).
- Widening the class list is additive via a contract bump.
- Content-detected secrets (non-path) arrive either as a contract-bumped additive status value or as a judge gate — decided once in `CONTRACT.md` before that unit ships, never implicit.

#### FR-31: Elevated reveal

**Status:** sequenced (M2) (requires the auth seam and the §7.5 auth decision gate; not demo-able before them).

Masked-by-default holds everywhere until an authorization mechanism exists. [OQ-2 (retired) — sequenced to Milestone 2 behind the auth seam.]

*[SEQUENCED: elevated reveal — Milestone 2, behind the auth seam and the §7.5 auth decision gate. The demo shows schema-only views and the withheld notice; no value-reveal surface ships before the seam is enforced.]*

**Consequences (testable):**
- No route or view exposes secret-class values today; the schema-only view and the withheld notice are the complete surface.
- Elevated reveal requires the auth seam plus an explicit authorization rule; until then it does not exist anywhere in the product.

#### FR-32: Intent records via the notes mirror

**Status:** built.

Every change-set can carry its why, durably. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- Intent lives as git notes pushed to `refs/notes/commits` and mirrored to branch `nextgit-notes` in one push (three refspecs); all readers use the mirror; fallback carrier `NEXTGIT_INTENT/<sha>.txt` lives only on the mirror.
- Exactly one pusher per proposal repo — the runner/orchestrator performs the push after commit; agents never push refs; the mirror is fast-forward-only.
- Intent survives a rebase and is visible on the card (`intent`) and file rows.

#### FR-33: Provenance visible

**Status:** built.

A reviewer can see where a change came from and what was decided. Realizes UJ-2, UJ-3.

**Consequences (testable):**
- Cards show the proposal repo and the baseline (`base: demo · ref: main` in the header).
- The landing decision record persists as a git note (FR-18) and a `repo.pushed` event records the baseline move in the feed.

### 4.7 Agent onboarding (CAP-1)

**Description:** The platform is machine-legible first: agents get isolated workspaces, scoped credentials, a self-describing standard, and a commit/push path that keeps refs single-pushed. Realizes UJ-1. Semantics: architecture AD-5, AD-7.

#### FR-34: Provision N isolated workspaces

**Status:** built (N≥4 proven live 2026-10-03).

An operator can provision N isolated agent workspaces from one baseline in one command. Realizes UJ-1.

**Consequences (testable):**
- One command creates N forks with scoped tokens; each accepts independent pushes; each push emits an event.
- Provisioning guarantees discoverability before tokens are handed off (conventions naming, status ready); auto-discovery semantics are documented in the contract.
- Demo floor: N≥4 real agents proven concurrently.

#### FR-35: Harness onboarding and routing

**Status:** built (omp + codex verified) / pending (more harnesses via routing).

An operator can onboard real agent CLIs — starting with omp and codex — and bring their own harness. Realizes UJ-1.

**Consequences (testable):**
- omp and codex routes produce real proposals against the baseline (verified; claude/gemini/opencode are standing auth items, not blockers).
- BYO harness is supported through the standard interface: agents edit their own clones; the runner/orchestrator commits and performs the single three-refspec push; agents never push refs.
- The platform ships a machine-readable tool manifest + structure map into every workspace (engineering law: no context-blind agents).

#### FR-36: Token lifecycle

**Status:** sequenced (M2) (auth seam wave).

Credentials are short-lived, scoped, audited, and never rendered. Realizes UJ-1.

**Consequences (testable):**
- Worker-minted access tokens: single-use, TTL ≤300 s, revoked in a `finally` (as-built today). Repo git tokens: 24 h default, 7 d max. [ASSUMPTION: repo git token TTLs proposed.]
- Token values live mode 0600 outside repos/transcripts, never in logs or argv; mint/use/revoke are audited at two surfaces: Worker logs (observability) and Artifacts token events (`token.created` / `token.revoked`).
- No response ever contains tokens or credentials (architecture AD-9; the law holds today even though the seam is sequenced (M2)).

### 4.8 Tour

**Description:** A self-contained explainer that turns a cold viewer into an operator: vocabulary, model, a live proof, a quiz, honest scope, and the role frame. Realizes UJ-4.

#### FR-37: The 10-step interactive tour

**Status:** built.

A first-time viewer can learn the model in one sitting, without documentation. Realizes UJ-4.

**Consequences (testable):**
- The tour ships 10 clickable stepper tabs (0. Intro … 9. Your Role) with progress fill; narrow widths scroll the stepper horizontally.
- Steps 0–5 teach with simulations; step 6 fetches and renders the real `/proposals` grid inside the tour, annotating real collisions, clean additions, and landed changes; step 7 quizzes over the real proposal set; step 8 states non-goals; step 9 frames the operator and offers `Open the Triage App`.

#### FR-38: Tour degradation

**Status:** built.

The tour never breaks and never shows an error banner. Realizes UJ-4.

**Consequences (testable):**
- Step 6 fetch failure → console warning + graceful fallback snapshot; the tour continues.
- The tour is the mobile-friendly member of the family (single-column stacking at ≤720px).

### 4.9 Demo and reproducible scripts

**Description:** The competition's proof and the product's reproducibility contract: real agents, real infrastructure, committed scripts, rehearsed failure paths. Realizes UJ-1.

#### FR-39: Reproducible end-to-end demo

**Status:** built (scripts) / required-M1 (submission packaging not started).

An operator can reproduce the demo end-to-end from committed scripts.

**Consequences (testable):**
- Committed scripts: `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (REAL CLI agents) · `land.mjs` (lands or refuses) — reproducible from the repo.
- The run shows N≥4 real agents concurrently, ≥1 genuine collision surfaced pre-land, one-click landing with receipt, secret masking and provenance visible.
- No mocks: live Workers + Artifacts end to end.

#### FR-40: Rehearsed failure paths

**Status:** built (spec'd; rehearsed as part of the demo run).

The demo (and the product) handles its failure modes with exact copy. Realizes UJ-1.

**Consequences (testable):**
- Colliding land → 409 conflict, files named, "(preview merge first)"; secret-touching land → 409 withheld-secret; any other failure → generic error.
- Every failure returns the card to `default`; the banner stays until dismissed.

#### FR-41: Submission package

**Status:** required-M1 — not started (the gate itself).

The entry can be submitted and judged.

**Consequences (testable):**
- Deliverables: a 5–10 minute video; an open-source repo (MIT/Apache/BSD + LICENSE file); run instructions.
- The demo is one uninterrupted take exercising all three rubric axes (originality/prototype 50%, multi-agent concurrency 25%, UX 25%) on real infrastructure; single entry.

### 4.10 Platform API and clients (CAP-9; API Contracts / Public Surface)

**Description:** The platform is the heart; clients are surfaces. The frozen contract is the product's public surface for machine consumers, and the web UI consumes only what the contract documents. Realizes UJ-1 through UJ-4.

#### FR-42: Contract discipline

**Status:** built.

Any client can depend on shapes that never drift silently.

**Consequences (testable):**
- `platform/CONTRACT.md` is the single source of route shapes; changes are additive-only; a shape change bumps the contract first.
- Every new route or payload lands its shape in `CONTRACT.md` in the same slice that adds it — no producer or consumer ships an undocumented shape.
- Default resolution of `base`/`ref`/`baseRef` is identical on every route and pinned; every API route enforces its method; unknown API paths return JSON 404 (never asset fallthrough).

#### FR-43: Route surface

**Status:** built (seven routes live, incl. `POST /judge`).

A client can drive the whole platform through the documented route surface.

**Consequences (testable):**
- Routes: `GET /health`, `GET /changes`, `GET /proposals`, `GET /merge`, `POST /land`, `POST /judge`, `GET /events`; errors are `{ ok: false, error }` with 4xx/5xx.
- Enums are frozen where documented: file status, conflict kinds, landing status; commit messages `land(<repos>): …`; timestamps ISO-8601 UTC.
- `/judge` is contract-pinned and rate-limited per caller; `target.repos` ≤16; `refs` exactly one entry in v1.

#### FR-44: Client protocol for future surfaces

**Status:** sequenced (M4) (second client); the 11-entity protocol is pending.

A future client — Agent Office, IDE, CLI — can render and act on platform state from the API alone; the second client is the API's proof.

*[SEQUENCED: shipping a second client — Agent Office and IDE/CLI surfaces arrive in Milestone 4; the API is built for them.]*

**Consequences (testable):**
- The 11-entity protocol (Floor/Project, Worker, Task/Queue, Issue, Pull/Proposal, Pull/Proposal detail, Presence/Peer, Whiteboard, Services, Settings, Chat/Notifications) plus the contract-pinned push-event surface is the client contract.
- GitHub-specific semantics (`reviewDecision`, `mergeStateStatus`, `mergeable`) are synthesized in adapters — never in the core.
- A second client (e.g., the 3D office) renders live platform state without platform changes; this is an adoption signal, not a v1 build target.

#### FR-45: Auth seam

**Status:** sequenced (M2) (seam wave; hard precondition before non-demo data; the §7.5 auth decision gate precedes it).

The platform is auth-ready and demo-open, with zero credential egress.

**Consequences (testable):**
- A single `authorize(request, env, action, {repo|base})` chokepoint is called by every route; `AUTH_MODE` defaults to deny; the demo opts in explicitly (`demo`).
- While demo, a repo allowlist (`demo`, `agent-*`) is enforced on every `base`/`repos` param; edge rate limits cover `/land`, `/merge`, `/proposals`, `/judge`.
- The seam is enforced before the first non-demo data exists in the namespace; CSRF protection is required for the future cookie-based SSO path.

### 4.11 Roadmap — fork community + intent router (CAP-10)

**Description:** The fork ecosystem as a first-class source: intent is declared before building and matched against what the fork community already attempted, so work joins instead of restarting.

#### FR-46: Declare intent before building; match it against the fork ecosystem

**Status:** sequenced (M4).

A builder can declare intent before building and match it against the fork ecosystem — joining existing work instead of restarting it.

**Consequences (testable):**
- The matcher returns one verdict per declared intent — `merge-it` (an existing fork already carries the work), `use-as-context` (overlap supplies context), or `ignore` (no actionable overlap).
- Fork cards carry the six-cluster signals that drive matcher verdicts (defined in `fork-community.md`, the CAP-10 companion).
- Join-don't-restart is a platform reflex: the default path from a declaration leads to the fork that already attempted the work, not to a restart.
- Merge-back-to-upstream paths are defined: a fork's work can be routed back to the repository it forked from.

### 4.12 Asset tier — R2 blob storage (sequenced M3)

**Description:** The git fabric stays small: large and binary assets live as content-addressed blobs in R2, with manifests and pointers in Artifacts preserving the git contract. The tier is additive — git is not re-architected for blobs. Sequenced to Milestone 3 (§13.2); pipeline internals (chunking, locks, per-file ACLs) remain staged per AD-10.

#### FR-47: R2 asset tier

**Status:** sequenced (M3) (R2 tier in product scope; OQ-1 resolved 2026-10-06).

A repo can carry large and binary assets without bottlenecking the git fabric: assets are content-addressed blobs in R2; git carries manifests and pointers only.

**Consequences (testable):**
- Large/binary assets are stored as content-addressed blobs in R2, and the repo holds a manifest/pointer (path, blob id, content hash, size) in Artifacts — clones, change-sets, and the fork-point contract are unchanged.
- Integrity verification: a blob whose content hash does not match its pointer fails closed — no silent substitution; verification runs on any read path that materializes a blob.
- Lifecycle: bucket lifecycle rules (retention/expiry) plus lifecycle-safe deletes — removing a path removes the pointer and schedules the blob; no orphan-blob accumulation.
- Git is NOT re-architected for blobs: the five landing semantics, secret masking, and the fork-point change-set contract are unchanged — the tier adds a pointer layer only.

## 5. Non-Goals (Explicit)

- **Not a GitHub clone, not a per-change review product.** The per-change review model is explicitly rejected as the platform's center; the set is the unit.
- **Repo browsing, issues, CI, profiles** (the classic code-host surface) — deferred roadmap: the classic surface is deliberately not the center; unscheduled in the current milestone plan. Integrate where possible; imitate PM nowhere. (The permanent non-goal is the per-change review *center* — the GitHub-clone shape — not the surface's existence; §2.2, §13.2.)
- **No 3D office in the demo** — Agent Office is the flagship future *client* of the platform API, never a build target for the competition sprint.
- **No project-management system** — PM tools integrate via API later; milestones/epics are roadmap.
- **No binary/game-asset pipeline internals this phase** — R2 chunking, exclusive locks, per-file ACLs are staged per AD-10. The R2 tier itself IS in product scope (OQ-1 — resolved: sequenced to Milestone 3, FR-47); the pipeline internals remain staged behind it.
- **No always-on decision mesh, macro-merging, 10M-node scale.**
- **No from-scratch merge algorithm** — entity-level merge concepts are borrowed (SPEC stack companion).
- **No multi-tenant hardening, no billing, no business model** in v1 — deliberately deferred past the competition.
- **No offline mode, no native app, no PWA, no light mode, no i18n** in this version [ASSUMPTION: concerns floor — see §15].
- **No Windows/GPU/macOS workload hosting** — the platform orchestrates such runners (self-hosted) and never hosts them (roadmap).

## 6. Cross-Cutting NFRs

- **NFR-1 — Compute envelope.** All change-set, conflict, and merge-preview work happens in-Worker within the Workers CPU budget: 30 s default / 5 min max per HTTP request. No read route clones; the only in-memory clone is inside `/land` (AD-2). Fork walks are bounded at 200 first-parent commits.
- **NFR-2 — Artifacts envelope.** 1 GB/repo · 32 MB/file · 2k git requests/10 s/repo; push cap ~64 MiB → small incremental pushes; push protocol v1-only. Artifacts provides no server-side merge, diff, conflict detection, or branch protection — the platform builds all of them (SPEC constraints).
- **NFR-3 — Runtime pin.** One Worker (`nextgit-platform`); compatibility date 2026-09-01; no `nodejs_compat` (in-tree fs/Buffer shims). Deploys use the lockfile-pinned local wrangler, never `@latest`. Worker logs never include Authorization headers or request bodies.
- **NFR-4 — One gated write path.** The worker performs no git writes except the single-commit fold+push inside `POST /land`; base branches are written only by `/land`; control-plane pushes are limited to provisioning baselines and proposal repos; landing replays are prohibited (AD-1).
- **NFR-5 — Secret egress law.** No secret-class content leaves the worker in any response, log, or model state; free-text channels derived from repo content are scrubbed before entering any body (AD-4).
- **NFR-6 — Zero credential egress.** No response ever contains tokens or credentials — no exception; failure paths return fold artifacts only; no response carries shell snippets containing repo content or paths (AD-9).
- **NFR-7 — Single writer / single consumer.** KV `LIVE` has exactly one writer (the worker); the queue has exactly one consumer; Artifacts events are deduped on `(type, repo, ref, after)`; the feed is a hint, never authority for writes or identity (AD-6).
- **NFR-8 — Degrade, never fake.** Every failed fetch except the ticker surfaces in one connection banner; panels keep their last render; the ticker degrades silently; landing state is content-derived — the UI never shows a success it did not observe.
- **NFR-9 — Accessibility floor (WCAG 2.2 AA behavioral floor).** Visible focus on every interactive control; modal focus trap returning focus to the trigger; Escape/backdrop/close modal semantics; reduced-motion support; ≥44px touch targets at phone widths; document-order tab order. Known gap to fix: `{colors.text-muted}` ≈3.3:1 and `{colors.text-dim}` ≈2.1:1 are below 4.5:1 for small text — confined to meta labels/ambient chrome; they must not be extended to body copy or state messaging, and raising them is a pending decision. [ASSUMPTION: floor ratified for M1 (revisit at the §7.5 gate; John may overrule anytime).] [NOTE FOR PM: raising `{colors.text-muted}`/`{colors.text-dim}` is a pending decision — the current ratios are the as-built floor, not a ratified contrast target.]
- **NFR-10 — Concerns floor.** Dark-only theme; desktop-web primary; English-only copy; no offline, no native, no PWA. [ASSUMPTION: ratified for M1 (revisit at the §7.5 gate; John may overrule anytime).]
- **NFR-11 — Contract-first.** Additive-only shapes; bump before change; defaults pinned in `CONTRACT.md`; consumers read only documented surfaces (AD-8).
- **NFR-12 — Design constitution.** Every requirement's intent answers to the twelve engineering laws (`engineering-laws.md`; per-law carrier mapping: `reconcile-spec.md` §3); laws not yet carried as FRs ride as roadmap explicitly — L2 two-tier intelligence (fast System-1 sweeps classify every file before expensive reasoning), L9 work-item ↔ change-set linkage, L11 always-on decision layer; the partially-represented laws remain binding.

## 7. Constraints and Guardrails

### 7.1 Competition constraints (the gate)

- Built on **Cloudflare Workers + Artifacts** (mandatory); multiple agents working concurrently demonstrated; real infrastructure, no mocks.
- Submission due **2026-10-14**: a 5–10 minute video + open-source repo (MIT/Apache/BSD + LICENSE file) + run instructions; **single entry**.
- Judged: **originality/prototype 50% · multi-agent concurrency 25% · UX 25%**. Winner presents at Cloudflare Connect SF (Oct 21). Eligibility: resolved — the US-resident teammate files the entry (2026-10-06).

### 7.2 Safety guardrails

- Secret-class masking is a pre-egress filter, not a UI behavior: response bodies, folds, intent fields, logs, and judge state all pass through it.
- Landings that touch secret-class files are refused; the worker never pushes secret values.
- Write protection is ours to enforce: Cloudflare's `read_only:true` flag does **not** constrain binding-level writes (measured: a probe landed on a read-only fork). The platform never assumes a platform guard it does not have.
- Judge state is assembled server-side; untrusted repo content is delimited, labeled, and stripped of instruction-like text; model answers are schema-validated; judge failure is silent and never blocks or forces an action.

### 7.3 Privacy and data

- One environment (the live demo) until the auth seam exists; **no non-demo data enters the namespace before the seam is enforced** (hard precondition; §7.5 decision gate).
- Data jurisdiction selection (us/eu namespaces) is deferred until a non-demo tenant exists.

### 7.4 Cost guardrails

- Clef economics: `@cf/cloudflare/clef` median 209 ms / `clef-flash` 39 ms; $0.24 / $0.09 per M input tokens; a typical judgment ≈520 tokens ≈ **$0.00012**. Judgment runs hot-path cheap by design.
- Per-caller budget and rate caps on `/judge`; the judge never runs per-file-per-poll by accident (one call per payload change, throttled in the UI).
- Auto-land (the only path that could amplify cost and risk at once) stays off until calibration + injection spike (FR-26).
- No billing in v1; business model deferred.

### 7.5 Data and identity (decision gate)

- **Persistence today:** Artifacts (the git fabric — repos, notes, manifests), KV `LIVE` (the event feed), Workers AI (the judge), Queues (the event path) — no platform-side SQL exists.
- **Build-layer task registry:** the machine-readable work store is `porting/tasks.db` (SQLite/WAL — ~506 rows; the work queue derives from it). Build-layer only: it is not a product surface and carries no product data.
- **Product database layer (Milestone 2):** identity and accounts persist in a product database layer (D1-class) arriving with the auth seam. [ASSUMPTION: D1 (SQLite-class) is the candidate product database — confirm at the gate.]
- **THE GATE — authentication decision.** Owner: John. Decide by: within one week of the competition milestone (before M2 kickoff); sooner if any M1 dependency emerges. Candidate approaches [ASSUMPTION: proposed set]: (a) Cloudflare Access (Zero Trust) in front of the worker; (b) platform-native token seam (signed repo-scoped tokens + session cookie); (c) external OIDC IdP with the platform as RP. Criteria: identity rows needed for accounts, judge/calibration records, and per-file access; least new infrastructure; reversible. Current pulls toward deciding sooner: judge/calibration records, accounts, and per-file access all trend toward needing identity rows; none blocks Milestone 1 today. [NOTE FOR PM: the gate is a decision with an owner and a date — the approach is unchosen and no identity rows exist; nothing in M1 may depend on them without reopening this gate.]

## 8. Why Now

- **The substrate just arrived.** Cloudflare Artifacts gives a programmable git-compatible repo fabric; Workers, Queues, and Durable Objects give orchestration without servers; Clef makes judgment cheap enough to run on every change (209 ms median; ~$0.00012 per judgment). The platform is built end-to-end on that stack today.
- **The problem is measured, not hypothesized.** ~41.7% of concurrent agent pairs conflict across 33,596 agent-authored PRs; frontier models catch 15–31% of human-flagged issues; GitHub's own guidance pushes partitioning to humans ("be thoughtful about partitioning work"). The GitHub merge-queue incident silently deleted 2,092 PRs across 230 repos for 3 h 33 m before anyone noticed — evidence for the attach-evidence thesis.
- **The position is unoccupied.** No shipping product presents N concurrent agent change-sets as one comparable set with real conflict computation (no counterexample across six independent search efforts).
- **The deadline sets the clock.** The competition gate (Oct 14) forces a demo-grade, end-to-end proof inside one sprint — which is exactly the shape of proof this product needs first.
- [ASSUMPTION: the honest moat is timing, execution speed, and the unclaimed category — not a proprietary algorithm; competitors would need substantial platform work to match the integration.]

## 9. Platform

- **Web-first, single-surface browser app** served by the platform Worker (`/` triage, `/tour.html` tour). Vanilla ES modules, no build step, no framework, no UI library.
- **API-first by construction:** the same platform state renders to the web UI and, later, to any client — the planned Agent Office 3D client, IDEs, CLIs. Clients depend only on the frozen API; the platform depends on no client.
- **Future clients are out of scope** for this version: the 3D office is the flagship future API consumer (CAP-9's proof), not a build target.
- **No staging split** until the auth seam and non-demo data exist; one environment today, deployed by lockfile-pinned wrangler.

## 10. Performance Budgets

- **Scale band:** demo proof is N≥4 real agents concurrently (proven live 2026-10-03); the product target band is **12–50 agents** [ASSUMPTION: ratified for M1 (revisit at the §7.5 gate; John may overrule anytime) — demo floor N≥4 proven; the 12–50 target band is not demo-verified]. The 20–50-proposal set view is a known engineering budget item — caching and incremental change-sets are the named remedies (roadmap, unsequenced — the cache/increment slice).
- **Set view recompute:** `/proposals` fully recomputes per poll today; bounded only by the CPU sentence (NFR-1). At fleet scale, the budget requires the cache/increment slice.
- **UI freshness:** `/events` 2 s; `/proposals` 8 s (toggle default on); a land reloads both immediately; a new top event debounces one refresh (500 ms). These cadences are the degraded-fallback behavior, not implementation detail; Milestone 1 adds the real-time transport (FR-22).
- **Judge latency:** median 209 ms (clef) / 39 ms (clef-flash) — fast enough for on-change chips; REST cold path ~1.3 s measured.
- **Landing path:** one in-memory clone + diff3 fold + one push inside a single request; preconditions fail fast (409 before fold when stale/moved).
- **Push envelope:** ~64 MiB cap → demo pushes are small and incremental; the platform's git fabric is not a large-artifact transport (assets move to the R2 tier — Milestone 3, FR-47).

## 11. Aesthetic and Tone

- **Two registers, one person.** In-app: the operator register — lowercase control labels, terse status lines, names the object and the next step ("refresh", "dismiss", "landing...", "confirm land?", "landed — nothing pending"). Tour: the teacher register — plain-English complete sentences, zero unglossed jargon ("You are the conductor. Agents write code; you control convergence.").
- **Quiet success.** The success register is "landed — nothing pending", not confetti; failures name the concrete thing (files, repos) plus the next action ("(preview merge first)"), never a bare code.
- **Color means state.** Four semantic triads (green/clean, red/conflict, amber/warn-secret-confirm, neutral/mergeable), one accent (blue = actionable/identity), one diff staff. Nothing is colored for beauty; depth is tonal, never shadow.
- **Judge-layer posture.** Chips join in the existing badge/chip language; advisory signals stay amber/neutral and are never dressed as a red hard conflict — the visuals carry "the judge advises; code decides; humans still own irreversible acts."
- **Felt outcome: *convergent*** — fleet work becomes tractable at the surface where it matters.
- **No marketing gloss in product surfaces.** The product speaks like the operator's tool, not a landing page. [This PRD's own voice follows the same rule except where market language is explicitly quoted.]

## 12. Success Metrics

**Primary**
- **SM-1 — Demo gate (Oct 14).** A 5–10 minute video + OSI-licensed repo + run instructions, one uninterrupted take, all three rubric axes on real infrastructure. Validates FR-39, FR-41.
- **SM-2 — Demo-scale proof.** N≥4 real agents concurrently; ≥1 genuine collision surfaced pre-land; one-click server-side landing with receipt; secret masking and provenance visible — reproducible end-to-end from committed scripts; on-screen freshness ≤2 s, visibly beating a 90 s poll. Validates FR-34, FR-14, FR-28, FR-32, FR-39, FR-22.
- **SM-3 — Set-level comprehension.** A cold viewer can state what the fleet is doing and which pair collides inside a minute, with no tab-hopping. Validates FR-1, FR-3, FR-4, FR-7.

**Secondary**
- **SM-4 — Adoption signals (beyond the competition).** A team uses the API for real work; a second client renders live platform state; proposals landed per week tracked with attached records. Validates FR-44, FR-42, FR-18. [ASSUMPTION: directional until a design partner uses the API for real work.]

**Counter-metrics (do not optimize)**
- **SM-C1 — Landed-per-week must not be gamed by weakening preconditions.** Never bypass `stale` / `base-moved` / `withheld-secret` to move the number; a refused landing is a correct outcome. Counterbalances SM-2, SM-4.
- **SM-C2 — Judge engagement must not be gamed by over-advising.** Chips are advisory; skips are not verdicts; no gating before calibration. Counterbalances any future judge metric.
- **SM-C3 — Set readability must not be traded for render speed.** No paging, no collapsing, no "top N" — the whole set stays the surface. Counterbalances SM-3 under the scale band.

## 13. Milestones

Milestones sequence the work; they do not cap the product. Every item below is scheduled product scope — Milestone 1 is the competition milestone; Milestones 2–4 are the product's own sequence.

### 13.1 Milestone 1 — Competition milestone (due Oct 14)

The demo chain, end to end:

- The five MUSTs (`demo-scope.md`): set-level triage canvas · concurrent agent workspaces · cross-proposal conflict map · per-proposal intent record · live events to the UI. (Built, except FR-7 (build-gap) — FR-1 … FR-13, FR-32, FR-34.)
- Platform worker API (proposals, changes, merge/land, events) on Workers + Artifacts. (Built — FR-42, FR-43.)
- One-click server-side landing with the landing outcome set (open, numbered — nine). (Built; build gaps close in M1 — FR-14, FR-15.)
- Triage surface: Concurrent Proposals + Convergence Conflicts + chips + ticker + banners + footer. (Built; FR-7 and the two contract card states are build gaps to close — FR-7, FR-19.)
- Real-agent onboarding (omp, codex; more via harness routing). (Built — FR-34, FR-35; token lifecycle hardening is sequenced (M2) — FR-36.)
- Judge layer: risk, intent verification, semantic collision. (**Built & live 2026-10-06** — `platform/src/judge.ts`, `POST /judge`, chips browser-verified, suite 73/73. Calibration record is required-M1, advisory-only with the gate off — FR-27; the auto-land gate is roadmap, unsequenced — FR-26.)
- Real-time transport: SSE/WebSocket over a DO hub — pushes surface live; polling is the degraded fallback. (required-M1 — FR-20 … FR-22.)
- Land hardening with rich validation evidence: checks + results, merged-SHA == tested-SHA, evidence artifact attached to the landing record, served by the planned read route. (required-M1 — FR-16 … FR-18.)
- Secret-typed files (path-driven masking). (Built — FR-28 … FR-30; content-detection widening is sequenced (M2).)
- Provenance via git notes. (Built — FR-32, FR-33.)
- The interactive tour. (Built — FR-37, FR-38.)
- Reproducible demo scripts. (Built — FR-39, FR-40.)
- Submission package: 5–10 minute video · OSI-licensed repo · run instructions. (required-M1, not started — FR-41; SM-1.)

*[SCOPE NOTE: the demo-sprint baseline is the five MUSTs (`demo-scope.md`); Milestone 1 additionally carries the tour and the judge layer per the brief, plus real-time transport and the land-hardening evidence chain — deliberate, noted extensions.]*

*[NOTE FOR PM: **M1 critical path, in order:** (a) demo chain — the five MUSTs [built]; (b) land hardening FR-16 … FR-18, rich evidence [required-M1]; (c) real-time transport FR-22 [required-M1]; (d) submission package FR-39 / FR-41 [NOT STARTED — the gate itself]. Owner: John.*

*Fallback ordering if the deadline binds (a decision, not a hope): (1) real-time transport drops first → the shipped 2 s polling path is already the degraded fallback and the demo narrative is unaffected; (2) rich evidence drops next → ship the minimum receipt plus the evidence route immediately after. NOTHING drops from the five MUSTs or the submission package — SM-1 / SM-2 fail without them.]*

### 13.2 Later milestones, deferred roadmap, and non-goals

**Milestone 2 — Identity and data layer.**
- The auth decision gate (§7.5) resolves → the auth seam (FR-45) is enforced; non-demo data may enter only after.
- Token lifecycle hardening with the seam (FR-36).
- Product database layer (D1-class) for identity/accounts. [ASSUMPTION: D1 (SQLite-class) is the candidate product database — confirm at the gate; §15.]
- Elevated reveal (FR-31) — behind the seam plus an explicit authorization rule.
- Scoped secret access.
- Event-consumer hardening: payload validation + dedupe (FR-21).
- Content-detected secret widening (FR-30) — a contract-bumped additive status value or a judge gate, decided once in `CONTRACT.md` before that unit ships.

**Milestone 3 — Asset tier.**
- R2 blob storage live (FR-47): large/binary assets as content-addressed blobs in R2; manifests/pointers in Artifacts keep the git contract; integrity verification; lifecycle-safe deletes.
- Pipeline internals (chunking, exclusive locks, per-file ACLs) staged per AD-10.

**Milestone 4 — Fork community and clients.**
- Fork community + intent router: FR-46 — radar, matcher verdicts, join-don't-restart.
- Agent Office adapter + IDE/CLI surfaces (FR-44; rides the FR-45 seam enforced in M2).
- PM linkage: integrate, don't imitate.
- Then multi-tenant hardening + billing.

**Deferred roadmap — unscheduled in the current milestone plan:**
- Repo browsing / issues / CI / profiles (the classic code-host surface) — deferred roadmap, unscheduled in the current milestone plan (§5, §2.2). [NOTE FOR PM: this is the most-asked-for thing a GitHub-shaped reader will expect — integrate-first.]

**Remain non-goals (§5) — not scheduled in any milestone:**
- Macro-merging, 10M-node mesh, always-on decision mesh.
- Light mode, i18n, mobile-native; offline mode, native app, PWA — the concerns floor (§6 NFR-10).

**Roadmap, unsequenced (listed so nothing silently drops):**
- Auto-land gate (FR-26) — stays off pending the FR-27 calibration record and the injection spike.
- Durable Object landing lease (FR-17) — arrives after the base-moved precondition; the precondition is the M1 guarantee.

## 14. Open Questions

**Resolved decisions (2026-10-06, John)** — the four questions below were adjudicated; their numbers are retired and never reused.

- **OQ-1 (retired) — R2 asset tier: in product scope.** The R2 blob/asset tier IS product scope, sequenced to Milestone 3 (FR-47); the binary-pipeline internals (chunking, locks, per-file ACLs) remain staged per AD-10.
- **OQ-2 (retired) — elevated reveal: deferred behind the auth seam.** Sequenced to Milestone 2 under the §7.5 auth decision gate (FR-31); masked-by-default until then.
- **OQ-3 (retired) — real-time push transport: required.** SSE/WebSocket over a DO hub is required for Milestone 1 (FR-22); polling is the degraded fallback only.
- **OQ-4 (retired) — rich landing evidence: required.** Checks run + results, merged-SHA == tested-SHA, and an evidence artifact attached to the landing record ship with the land-hardening workstream (Milestone 1 — FR-18).

**Open:**

5. **OQ-5 — Judge gating engagement criteria.** The judge layer is live (advisory-only); the auto-land gate stays off until an injection-testing spike passes and ≥1 non-model signal exists, and the labeled-set calibration record does not exist yet. The record's minimum contents and pass criteria are pinned in FR-27; gating engages only once that record exists. When does gating become trustable?
6. **OQ-6 — Scale band.** Demo floor N≥4 is proven; the 12–50 target and the 20–50-proposal set view are unvalidated and carry a caching budget. Ratified for M1 (revisit at the §7.5 gate; John may overrule anytime): the 12–50 band is the working target. Which number becomes the committed product target remains open.
7. **OQ-7 — Business model.** Deferred past the competition by design (usage credits / seats / API pricing all open).
8. **OQ-8 — Name.** "NextGit" is a working title.
9. **OQ-9 — Submission repo publication.** Where does the public OSI-licensed submission repo live, and when is this working repo curated/mirrored for entry? (The working repo is git-initialized as of 2026-10-05.)
10. **OQ-10 — 64 MiB push-cap watch.** The push envelope is push-side (~64 MiB); monitor the Artifacts cap limit before submission — demo pushes stay small and incremental.

## 15. Assumptions Index

Every inline `[ASSUMPTION]` from this document, surfaced for explicit confirmation:

- §1 — The duplicated-effort waste claim ("the same fix attempted across several forks, agent compute spent twice or thrice") is directional framing: no metric yet; revisit at M4 when FR-46 ships.
- §1 — The arc/endgame (convergence-layer adoption → platform expansion → "make GitHub irrelevant") is the founder's stated ambition, retained as directional.
- §2.1 — Segment ordering (teams running agent fleets first; game studios / harness builders secondary) is inferred from the competitive research's early-adopter read.
- §2.1 / §2.3 — Demo protagonist is John, a solo operator/conductor; market language stays "teams + reviewer/conductor" — ratified for M1 (revisit at the §7.5 gate; John may overrule anytime); UX spines hold John under the same assumption; feeds the four pending UX adjudications.
- §4.1 FR-7 — First-load copy ("Loading the set from /proposals...") is proposed, not ratified.
- §4.3 FR-15 — The `no-changes`, `stale`, and `base-moved` banner copies are proposed, not ratified ("Nothing to land — fold produced zero changes." / "This proposal is stale — rebase and re-push to land." / "Nothing to land — the baseline moved since this proposal was made.").
- §4.3 FR-18 — The landing-record `evidence { checks[], results[], mergedSha, testedSha, artifactRef, at }` shape and the planned `GET /landings/{commit}` read route are the contract bump, pinned with the land-hardening workstream (the latest `CONTRACT.md` revision carries it; FR-42 discipline).
- §4.5 FR-24 — Judge caps (60 runs/min, 1000/day per caller) are proposed constants to pin in code at the land-hardening slice.
- §4.5 FR-27 — Calibration-record numeric targets (≥50 labeled proposals; precision ≥0.9 on the ship-blocking class; injection-spike pass; sign-off by John) are proposed, not ratified.
- §4.7 FR-36 — Repo git token TTLs (24 h default / 7 d max) are proposed; the access-token discipline (single-use, ≤300 s, revoked in `finally`) is as-built.
- §6 NFR-9 — WCAG 2.2 AA is the accessibility floor — ratified for M1 (revisit at the §7.5 gate; John may overrule anytime); the `text-muted`/`text-dim` contrast gap is a real as-built finding, and raising it remains a pending decision.
- §5 / §6 NFR-10 — Concerns floor: dark-only, desktop-web, English-only — ratified for M1 (revisit at the §7.5 gate; John may overrule anytime).
- §7.5 — The auth-approach candidate set (Cloudflare Access / platform-native token seam / external OIDC IdP) is proposed; the gate decision is John's, due within one week of the competition milestone.
- §7.5 / §13.2 — The product database layer is D1-class (SQLite) — the candidate, to be confirmed at the auth decision gate.
- §8 — Timing/execution/category is the honest moat (no proprietary algorithm claim).
- §10 / §14 OQ-6 — Product scale band: demo floor N≥4 (proven); the 12–50 target band is ratified for M1 (revisit at the §7.5 gate; John may overrule anytime) and is not demo-verified; the 20–50-proposal set view carries a noted caching budget.
- §12 — Adoption-signal metrics (SM-4) remain directional until a design partner uses the API for real work.
