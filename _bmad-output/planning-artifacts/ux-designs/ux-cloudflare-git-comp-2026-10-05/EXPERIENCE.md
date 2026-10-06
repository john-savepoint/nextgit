---
name: NextGit
status: draft
sources:
  - _bmad-output/specs/spec-next-git-platform/SPEC.md
  - _bmad-output/specs/spec-next-git-platform/demo-scope.md
  - _bmad-output/specs/spec-next-git-platform/engineering-laws.md
  - _bmad-output/specs/spec-next-git-platform/interface-contract.md
  - docs/judge-layer-ideas.md
  - platform/CONTRACT.md
updated: 2026-10-05
---

# NextGit — Experience Spine

> Behavioral contract for the convergence surface, distilled from the as-built platform (`platform/ui/`) plus the frozen contract (`platform/CONTRACT.md`). Paired with `DESIGN.md` (visual identity — this spine cross-references its tokens as `{colors.*}`). Spines win on conflict with any mock or import. `[ASSUMPTION]` marks unconfirmed decisions pending intake; **build gap** marks contract-defined behavior the UI does not render yet.

## Foundation

Web-first, single-surface product: a browser tab on the platform Worker. Two served pages form one experience family — the triage app (`GET /`; `index.html` + `app.js` + `styles.css`) and the interactive tour (`tour.html` + `tour.js` + `tour.css`).

- **No UI library / no framework.** Vanilla ES modules and one stylesheet per page; behavior is authored directly in `app.js` / `tour.js`. No component package, no build step to respect — the rules below are the contract for new behavior.
- **Dark-only, as built.** There is no light mode in this version; never invent one. `DESIGN.md` owns color; this spine references its tokens by name.
- **All state is server-side.** The platform Worker + Artifacts own repos, proposals, merges, and landings; the browser is a lens. No offline mode, no clones, no CLI on the caller's side (`CONTRACT.md:75`; `tour.html:309`).
- **API-first by construction.** Clients are surfaces; the future 3D client ("Agent Office") is a separate API consumer and out of scope for this run (brief.md:30).
- **Naming.** Product name NextGit; "convergence" is a concept term, not a product label. Header subtitle: "your agents' work, all in one place" (memlog).
- **Stakes.** Public competition demo (5–10 min video; Oct 14 gate; UX is 25% of the score) plus a real product; not regulated. [ASSUMPTION — pending intake]
- **Central premise (Law 1).** Convergence is the central act — sets, not diffs; triage at set level. The set view shows all proposals at once; no per-item paging, no tab explosion (engineering-laws.md:5,12; memlog).

## Information Architecture

Surface labels are as built; the draft brief's "fleet view" coinage is not canon (`.working/brief-extract.md` §6.5 — draft peer). Every stated need maps to a surface: compare the set → Concurrent Proposals; see collisions → Convergence Conflicts; inspect → Inspector modal; ship → card Land + Action banner; learn → Tour. The modal stacks one level deep.

Triage app (`platform/ui/index.html`):

| Surface | Reached from | Purpose | Behavior |
|---|---|---|---|
| Header (brand + ref-spec) | Always visible | Orientation | `NextGit / your agents' work, all in one place` + `base: demo · ref: main` |
| Header controls | Header | Refresh + tour link | auto-refresh toggle (8s, default on), `refresh`, `Start the tour`, `?` (both open the tour) |
| Summary chips | Header | Set-level counts | 5 chips — proposals / shared files / conflicting pairs / changed files / clean pairs; each tinted alert/warn/clean by its own threshold |
| Events ticker | Below header | Live proof that pushes flow | Newest ≤8 events (type, repo, time); 2s poll; pulse dot goes stale on failure |
| Convergence Conflicts | Main, above proposals | Collision map | Per-file cards: kind badge, involved repos, pair rows with line regions; meta `N detected`; read-only |
| Concurrent Proposals | Main | The triage canvas — every proposal as one card | Repo, intent, stats, file rows, actions; meta `N active`; all cards at once |
| Diff viewer modal | `view diff` on a file row | Read one file's change-set | Loading / patch / error / not-found / secret states; closes via `close`, backdrop, Escape |
| Merge preview modal | `preview merge` on a card | See the landing outcome before committing | Status bar, per-file tabs, merged text / conflict text / withheld notice |
| Action banner | A land attempt | Land outcome | Badge + message + `dismiss`; persists until dismissed (no auto-hide) |
| Connection banner | Any failed fetch | Platform reachability | Red alert bar + `Retry now`; hidden on the next success |
| Footer | Always | Provenance | `nextgit — serverless convergence engine` + sync time (`not synced yet` → `synced HH:MM:SS`) |

Tour app (`platform/ui/tour.html`):

| Surface | Reached from | Purpose | Behavior |
|---|---|---|---|
| Tour header + stepper | `Start the tour` / `?` in the triage header, or direct | Progress + jumping | 10 tab buttons (`0. Intro` … `9. Your Role`), progress fill, clickable; buttons scroll horizontally on narrow widths |
| Step 0 — Intro | Stepper | Pitch + vocabulary | "The place where many AI agents work on your code at once…" + 4 term cards (NextGit, Convergence, Proposal, Collision) |
| Step 1 — The Problem | Stepper / Next | Why set-level review | "Single-Threaded Review Is Broken" + sim: traditional GitHub view vs NextGit fleet view |
| Step 2 — Workspaces | Stepper / Next | Isolation model | Sim: baseline `demo` diagram + "Give 4 agents tasks" spawn |
| Step 3 — Proposals | Stepper / Next | Card anatomy | Annotated sample card, 5 inspectable regions + details pane |
| Step 4 — Collisions | Stepper / Next | Conflict comprehension | Two snippets on `src/auth.ts` + "Try to ship both" → conflict box |
| Step 5 — Shipping | Stepper / Next | One-click land | Sim: ship card + terminal narration ("One click folds the proposal onto the main branch on the server.") |
| Step 6 — Real Platform | Stepper / Next | Proof it is live | Real `/proposals` grid fetched from the worker; annotations call out real collisions, clean additions, and landed changes |
| Step 7 — Exercise | Stepper / Next | Active check | Quiz "Which Would You Ship?" over agent-1…4 + per-answer feedback |
| Step 8 — Scope | Stepper / Next | Honest non-goals | Two-column "What Is Not Here (Yet) and Why" |
| Step 9 — Your Role | Stepper / Next | Operator framing | "You are the conductor. Agents write code; you control convergence." + CTA `Open the Triage App` / `Restart Tour` |
| Tour controls/footer | All steps | Navigation | `Previous` / `Next` + "Step N of 10"; back link to the app |

## Voice and Tone

Microcopy. Brand voice and aesthetic posture live in `DESIGN.md`. Two registers, one person:

- **In-app — the operator register.** Lowercase control labels, terse sentence-case status lines; names the object and the next step. "refresh", "dismiss", "landing...", "confirm land?", "landed — nothing pending".
- **Tour — the teacher register.** Plain-English, complete sentences, zero unglossed jargon. "Two agents edited the same lines of code. Both changes cannot ship unchanged." / "You are the conductor. Agents write code; you control convergence."

Hard rules: no emoji anywhere (styles.css:2; tour.css:4); no exclamation marks; no marketing adjectives; status is never cute.

| Do | Don't |
|---|---|
| "refresh" / "dismiss" / "confirm land?" | "Refresh ⟳" / "Close this notification" / "Are you sure you want to proceed?" |
| "landed — nothing pending" | "Success! All merged." |
| "0 detected" / "4 active" | "Nothing to worry about!" |
| "Disconnected from platform worker. Retrying..." | "Oops! Something went wrong." |
| "Two agents edited the same lines of code. Both changes cannot ship unchanged." (tour) | "Merge conflict detected." |
| "Withheld-secret file — landing blocked (src/.env)." | "Security policy prevented this operation." |

Three microcopy rules for new copy (distilled; apply to the unrendered states below):

1. **Echo the verb.** One verb per action, reused across button → in-flight → result: "Land into demo" → "landing..." → "Successfully landed…". New actions invent the verb once and reuse it everywhere.
2. **Counts are exact and labeled.** A number always sits next to its visible noun ("N detected", "N active", "N files"); never approximate or decorate it.
3. **Name the object, name the next step.** Failures carry the concrete thing (file names, repos) plus the next action — "(preview merge first)" — never a bare code or abstraction.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`. Quoted strings are as-built verbatim.

| Component | Used in | Behavioral rules |
|---|---|---|
| Proposal card | Concurrent Proposals | One card per proposal — repo title, intent block, stats (`N files`, `+a`, `−d`), file rows, actions. All cards render at once (no paging). State machine below. |
| File row | Proposal card | Status indicator (added/modified/removed) + path + `+a/−d`; secret rows show the `secret-typed` badge + key chips and no `view diff` button. |
| Card actions | Proposal card | `preview merge` + `Land into demo` at rest; `view diff` per file. Hover/focus border lift uses `{colors.border-strong}`; disabled = 50% opacity. |
| Land flow | Card + Action banner | Inline confirm → in-flight → outcome; exact strings below. |
| Diff viewer | Inspector modal | Loading / patch / error / not-found / secret states; per file. |
| Merge preview | Inspector modal | Status bar, file tabs, merged / conflict / withheld content. |
| Conflict card | Convergence Conflicts | Severity by kind — `text-conflict` / `modify/delete` / `add/add` → red; `undetermined` → amber; `mergeable` / `identical-add` / `both-removed` → neutral. Carried by a 4px left band + the status triad (e.g. `{colors.status-red}`, `{colors.status-red-bg}`, `{colors.status-red-border}`). Header: file + kind badge; `proposals:` repo tags; pair rows `agent-1 ↔ agent-2` + pair kind + region `(base: NL, agent-1: NL, agent-2: NL)`. Read-only — no actions. |
| Events ticker | Below header | Newest ≤8; row = event-type chip + repo + `HH:MM:SS`; pulse dot. On `/events` failure the pulse goes stale (`{colors.text-faint}`) and the last events stay; a new top event key debounces a `/proposals` refresh (500ms). |
| Auto-refresh / polling | Header toggle + background | `/proposals` every 8s while the toggle is on (default on); manual `refresh` always available; new-event debounce (500ms); a land triggers an immediate reload of both endpoints; `/events` polls every 2s independently. |
| Summary chips | Header | Recompute on each `/proposals`: `conflictingPairs > 0` → alert tint; `sharedFiles > 0` → warn tint; `cleanPairs > 0` → clean tint. |
| Action banner | Top of app | `role="status" aria-live="polite"`; warn/success/error variants with badge + message + `dismiss`; never auto-hides; a new action replaces the previous banner. |
| Connection banner | Top of app | `role="alert"`; shown on any failed fetch with `Retry now`; hidden on the next success. |
| Modal shell | Inspector | `role="dialog" aria-modal="true"`; closes on `close`, backdrop click, or Escape; one level deep. |
| Empty/loading primitives | Everywhere | `empty-state` (title + desc), `loading-indicator` (modal fetches), `diff-placeholder` for absent patches. |

### Proposal card — state machine

| State | Entered when | Renders |
|---|---|---|
| default (`ready`) | No other state applies | `preview merge` + `Land into demo`; intent block; stats; files list |
| confirming | `Land into demo` clicked | `confirm land?` (amber `{colors.status-amber}` tint) + `cancel`; no dialog |
| landing | `confirm land?` clicked | Single disabled `landing...` button; card otherwise static |
| landed | `landing.status === "landed"` **or** `stats.files === 0` | Card dims to 0.55 opacity, dashed border, hover 0.85; `landed` badge; banner "landed — nothing pending" / "All changes from this branch have been merged into baseline." |
| withheld-secret | **CONTRACT state — not rendered (build gap)** | Spec: amber blocked state; secret rows stay schema-only (badge + key chips); `Land` disabled with reason "withheld-secret file — landing blocked". Mirrors `/land` 409 `withheld-secret`. |
| conflict | **CONTRACT state — not rendered (build gap)** | Spec: red `{colors.status-red}` state; `Land` disabled; hint "(preview merge first)". Mirrors `/land` 409 `conflict`. |

Transition rule: any failure returns the card to `default`; only a user `dismiss` clears the banner. `landing.files` (the count) is also unrendered — see Open Items.

### Land flow — exact copy

1. `Land into demo` → card flips to `confirm land?` + `cancel` (inline; no dialog).
2. `confirm land?` → card shows disabled `landing...`; action banner (warn): "Landing proposal **{repo}** into **{base}**..."
3. Success → banner (success): "Successfully landed proposal **{repo}** into **{base}**. Commit `<sha8>`" — `sha8` = first 8 chars, full SHA in the title tooltip (`commit-sha` chip). Proposals + events refresh immediately; the `repo.pushed` event re-enters the ticker.
4. 409 `withheld-secret` → banner (error): "Withheld-secret file — landing blocked ({files})."
5. 409 `conflict` → banner (error): "Conflicted files: **{files}**. (preview merge first)"
6. 409 `no-changes` → **build gap:** today it falls into the generic "Failed to land…"; spec a dedicated variant: "Nothing to land — fold produced zero changes." [ASSUMPTION — copy]
7. Any other failure → banner (error): "Failed to land **{repo}**: {msg}"

### Diff viewer (`view diff`)

- Loading: title `{repo} — {path}`, badge "fetching diff...", body "Loading change-set from /changes...".
- Patch rows: `+` lines `{colors.diff-add-bg}`/`{colors.diff-add}`; `−` lines `{colors.diff-del-bg}`/`{colors.diff-del}`; hunk headers `{colors.diff-meta-bg}`/`{colors.diff-meta}`; metadata lines plain.
- No patch (omitted, binary): `diff-placeholder` — "No patch available for this file (omitted, withheld, or binary)."
- Secret file: never offered a diff from the card. If reached: "Secret content withheld" / "Per platform contract, secret file contents and diffs are never exposed." + key chips.
- Error: badge "error", "Failed to load diff" + message. Not found: badge "not found" (amber), "File not present in changeSet".

### Merge preview (`preview merge`)

- Loading: badge "computing diff3...", body "Computing merge projection from /merge...".
- Status bar: "Overall status:" + `clean` (green) / `conflict` (red) badge; "action: X · result: Y" where X ∈ `write`/`delete` and Y ∈ `merged`/`conflict`/`withheld-secret`.
- Tabs: one per file; conflicted files carry a ` [!]` suffix; the active tab lifts to `{colors.bg-surface-elevated}`.
- Content: merged text in a `merge-pane`; conflict → red-bordered pane (`{colors.status-red-border}`) with the diff3 markers `<<<<<<<` / `=======` / `>>>>>>>`; withheld → "Secret content withheld" / "Secret-class file contents are withheld from merge previews."
- Empty: "No files changed in merge". Error: badge "error", "Failed to compute merge" + message.

## State Patterns

One error surface: every failed fetch except the ticker funnels into the red Connection banner; panels keep their last render. The ticker degrades silently by design.

| State | Surface | Treatment |
|---|---|---|
| Ticker empty | Events ticker | "listening for convergence events..." |
| Ticker loading | Events ticker | None — no skeleton; events appear on the first 2s poll |
| Ticker error | Events ticker | Pulse → stale (`{colors.text-faint}`); last events stay |
| Ticker live | Events ticker | 2s poll, ≤8 rows |
| Conflicts empty | Convergence Conflicts | "No convergence conflicts" / "All concurrent proposals merge cleanly or target orthogonal files." |
| Conflicts loading | Convergence Conflicts | **GAP** — see first-load spec below |
| Conflicts live | Convergence Conflicts | Severity cards; meta "N detected" |
| Proposals empty | Concurrent Proposals | "No active proposals" / "Waiting for agent branches to propose changes against base." |
| Proposals loading | Concurrent Proposals | **GAP** — see first-load spec below |
| Proposals live | Concurrent Proposals | 8s poll (toggle on) + 500ms event debounce; card states above |
| First load (whole canvas) | Chips + Conflicts + Proposals | **GAP — spec:** chips show `—` until the first payload; both panels show a `loading-indicator` matching the final layout ("Loading the set from /proposals..." [ASSUMPTION — copy]) and swap to data or empty state on the first response. Today chips start at `0` and the grid shows nothing until the first response. |
| Global fetch error | Connection banner | Shown: "Connection error: {msg}. Retrying..." — or initial "Disconnected from platform worker. Retrying..." — with `Retry now`; hidden on success |
| Diff modal | Inspector | Loading / error / not-found / secret / patch (Component Patterns) |
| Merge modal | Inspector | Loading / empty / clean / conflict / withheld / error (Component Patterns) |
| Action banner | Top of app | Hidden at rest; warn in-flight; success/error outcome; dismiss-only |
| Footer sync | Footer | "not synced yet" → "synced HH:MM:SS"; never error-styled |
| Tour step 6 | Tour | Loading: "Fetching live proposal state from platform worker..."; error: console warning + fallback snapshot (graceful, no banner) |

## Interaction Primitives

- **Click-first.** Every action is a click/tap on a native control; no drag, no context menus, no custom shortcuts beyond Tab/Enter/Space/Escape. [ASSUMPTION — keyboard model below]
- **Inline confirm replaces dialogs.** Arm ("confirm land?") → commit; `cancel` disarms. No modal confirms, no browser `confirm()`.
- **Escape closes the topmost modal**; backdrop click and `close` do the same. Modals stack one level deep, never two.
- **Hover is enhancement, never the only path.** Hover lifts fills to `{colors.bg-surface-elevated}`/`{colors.bg-subtle}` and borders to `{colors.border-strong}`; landed cards lift 0.55 → 0.85 opacity. Every action is also always visible without hover.
- **Tab order [ASSUMPTION — verify in build]:** document order — banners (when visible) → auto-refresh toggle → `refresh` → `Start the tour` → `?` → proposal cards (`view diff` per file → `preview merge` → `Land into demo`); conflict cards are read-only; the modal traps focus and returns it to the trigger on close.
- **Polling cadence is behavior, not implementation detail:** `/events` every 2s; `/proposals` every 8s when auto-refresh is on; a new top event key triggers one debounced refresh (500ms); a land triggers an immediate reload of both endpoints; `/events` failure must never break the proposals UI. The product goal is push-style ("pushes appear in seconds") — as-built polls; delta flagged in Open Items.
- **Set view, no paging.** All proposals on one canvas; no tab-hopping between items, no collapse (Law 1; Law 8).

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`. WCAG 2.2 AA is the proposed floor — [ASSUMPTION, pending intake]. Split into as-built bones and to-build requirements.

As built:

- Native controls throughout (buttons, links, checkbox), labeled by text; `?` and `dismiss` carry `aria-label`s.
- `role="alert"` on the connection banner; `role="status" aria-live="polite"` on the action banner; the ticker region is labeled "Live event ticker".
- Status is never color-alone — every tinted state carries a word ("landed", "secret-typed", "conflict", kind names).
- Escape + backdrop close the modal.

To build (floor requirements):

- Visible focus on every interactive control — use the `{colors.border-strong}` lift; verify non-hover focus parity. [ASSUMPTION]
- Modal focus management: move focus into the dialog on open, trap it while open, return it to the triggering control on close. [ASSUMPTION]
- Ticker announcements: polite `aria-live` on the ticker region (not per row) so new events are announced without spam. [ASSUMPTION]
- `prefers-reduced-motion`: drop the 0.15s transitions and the ticker pulse animation. [ASSUMPTION — unbuilt]
- Touch targets ≥44px at phone widths. [ASSUMPTION]

## Key Flows

Protagonist: **John — the human conductor/reviewer; a solo operator.** The agent crews (`agent-1` … `agent-4`) are workers. [ASSUMPTION — memlog holds the demo protagonist as pending; the draft brief frames the primary segment as "teams running agent fleets … and the reviewer/conductor who decides what ships" (brief-extract §1, draft peer).]

### Flow 1 — The demo story (John, one repo, four agent crews; the 5–10 minute take)

1. One repository; four agent crews provisioned as isolated workspaces; baseline `demo @ main` on screen (demo-scope.md:26-33).
2. Crews push; every proposal routes to the triage canvas as a card — intent, files, stats; pushes flow into the ticker (2s).
3. A deliberate collision lands on the same file: agent-1 adds `refreshSession()` and agent-2 modifies `isExpired()` in `src/auth.ts`. The conflict map renders the pair with line regions; the `conflicting pairs` chip tints alert.
4. John compares the whole set on the one canvas — intent blocks, file rows, a diff in the modal, a merge preview for the candidate landing.
5. **Climax — the land.** John clicks `Land into demo` → `confirm land?`; the banner narrates "Landing proposal agent-3 into demo...", the card shows `landing...`, then success: "Successfully landed proposal agent-3 into demo. Commit `<sha8>`". The card flips to "landed — nothing pending"; a `repo.pushed` event re-enters the ticker; the decision record persists as a git note.
6. Secret beat: a secret-typed file is shown schema-only (badge + key names, no diff button; merge shows "Secret content withheld"). Landing a secret-touching proposal is blocked — "Withheld-secret file — landing blocked (files)."

Failure paths (rehearse all three): landing the colliding proposal → "Conflicted files: src/auth.ts. (preview merge first)"; landing a secret-touching proposal → the blocked banner; any other failure → "Failed to land agent-3: {msg}". Every failure returns the card to default and the banner stays until dismissed.

### Flow 2 — First contact (John, cold open; comprehension under a minute)

1. John opens the worker URL in a browser tab.
2. The header orients in one line: brand + "base: demo · ref: main".
3. Chips give the set's counts; the ticker shows recent pushes.
4. The conflicts panel and the proposals grid are the entire set on one canvas — no tabs, no paging, nothing to open first.
5. **Climax:** inside a minute John can state what the fleet is doing and which pair collides — the set is legible before any click ("one canvas; the whole set at a glance; no tab-hopping", demo-scope.md:37-41).
6. If anything is unclear, `Start the tour` is one click away (Flow 4).

Failure: platform unreachable → "Disconnected from platform worker. Retrying..." + `Retry now`; empty repo → both panels' empty states explain what is awaited. [No first-load loading state today — State Patterns GAP.]

### Flow 3 — Triage (scan the conflict map, then decide)

1. The `conflicting pairs` chip flags the set; John goes to the conflict map first.
2. The conflict card names the file, the two repos, and the pair's line regions — the collision is legible without reading a diff.
3. He opens the colliding proposal's diff, then `preview merge` to see the landing outcome before committing.
4. **Climax:** the decision happens on the canvas — the chosen proposal lands (Flow 1, beat 5) or is held; no tab-hopping, no local git, no CLI.

Failure: merge preview fails → badge "error" + "Failed to compute merge" (reopen to retry); landing anyway → 409 conflict banner with "(preview merge first)".

### Flow 4 — Learn (the tour, and when it's offered)

1. Offered from the triage header at all times: `Start the tour` (button) and `?` (help); it can also be opened directly. It is the comprehension aid for first contact (Flow 2, step 6) and the explainer whenever a term ("convergence", "proposal", "collision") needs grounding.
2. The stepper shows 10 steps — clickable, with progress fill.
3. Steps 0–5 teach the model with simulations; step 6 shows the real platform; step 7 quizzes ("Which Would You Ship?"); step 8 states scope; step 9 frames the role.
4. **Climax:** at step 6 the lesson becomes the product — the real `/proposals` grid renders live inside the tour; at step 9 `Open the Triage App` returns the operator to the surface.

Failure: step 6 fetch fails → console warning + graceful fallback snapshot; the tour never breaks and shows no error banner.

## Responsive & Platform

Desktop-first, browser-only; no native app, no PWA, no offline mode, no i18n in this version (copy is English-only as built). The tour is the mobile-friendly member of the family; the triage app is usable on phones for scan + simple actions.

| Width | Triage app | Tour |
|---|---|---|
| ≥1024px | Container ≤1440px; proposals grid multi-column (`auto-fill, minmax(360px, 1fr)`) | Container ≤980px |
| 721–1023px | Grid reflows to fewer columns (no authored breakpoints — `styles.css` has none) | Annotated layout stacks at ≤768px |
| ≤720px | One column; panels stack; land flow unchanged (click-only, fine on touch) | ≤640px: collision snippets, quiz options, scope grid stack to one column; stepper scrolls horizontally |

- The only authored breakpoints live in `tour.css` (768px, 640px); the triage app's reflow comes entirely from the grid.
- **Build gap:** the proposals grid's 360px track floor + 2rem container padding overflows horizontally below ~424px viewports. [ASSUMPTION — fix: single column below the floor.]
- Touch targets ≥44px at phone widths [ASSUMPTION]. No hover-only actions exist, so touch loses nothing.

## Open Items

**Pending user intake (reconcile in Update mode):** [ASSUMPTION] Stakes — public competition demo + real product, not regulated. Protagonist — John, solo operator/conductor (draft brief adds reviewer/conductor + teams; draft peer, not canon). WCAG 2.2 AA floor; tab order; modal focus trap; reduced-motion; 44px touch targets; first-load treatment; card treatments for the two unrendered states; `no-changes` copy. Concerns still open (memlog): light mode (as-built dark-only, decided not to invent), i18n (copy English-only as built), offline (web-only as built).

**Build gaps — contract-defined behavior the UI does not render yet:**

- `landing.status` `withheld-secret` and `conflict` card states (CONTRACT.md:41; UI branches only on `=== "landed"`) — spec'd in Component Patterns, sections "Proposal card — state machine".
- `landing.files` count; `pairs[].conflict` boolean; `/merge` `files[].note` + `conflicted[]`; `/land` `landed.files` + `landed.at` (only the short SHA is shown); `/events` `ref` + `after`; `/health` unsurfaced.
- 409 `no-changes` has no dedicated banner (falls to generic "Failed to land").
- First-load loading state for the main canvas — spec'd in State Patterns; not built.
- CAP-8 "elevated reveal" beat not implemented (schema-only / withheld views only).
- Judge chips (risk score, intent-vs-diff verification, semantic collision) + auto-land gate: planned P0 (memlog; judge-layer-ideas.md), not rendered — the draft brief lists them as first-version, contradiction flagged (brief-extract §6.1). When built: chips on the card, gate behind the Land button; "the judge advises; code decides; humans still own irreversible acts."

**Draft-brief deltas to reconcile at intake:** "fleet view" naming (unratified coinage; as-built labels stand); "no polling" product claim vs as-built 2s/8s polling; "validation evidence attached" (CAP-7) vs the UI's short-SHA-only landing receipt.
