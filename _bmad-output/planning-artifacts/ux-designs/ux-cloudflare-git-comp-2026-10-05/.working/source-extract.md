# NextGit — UX Source Extract (discovery digest)

Read-only extraction from the NextGit corpus, 2026-10-05. All values verbatim from source; citations are `path:line`.
Sources read in full: `_bmad-output/specs/spec-next-git-platform/{SPEC.md,demo-scope.md,engineering-laws.md,interface-contract.md}`, `docs/judge-layer-ideas.md`, `platform/CONTRACT.md`, `platform/ui/{styles.css,index.html,tour.html,app.js,tour.css,tour.js}` (tour.css/tour.js consulted where they carry copy or tokens).

---

## 1. As-built visual tokens

Design intent, verbatim: *"Aesthetic: near-black (#0a0e14 range), subtle 1px borders, ui-monospace accents, generous whitespace, no emoji, no heavy gradients"* (`platform/ui/styles.css:1-3`). Tour stylesheet: *"Design system aligns with styles.css: near-black (#0a0e14), subtle 1px borders, monospace accents, accessible contrast, strict no-emoji, smooth transitions"* (`platform/ui/tour.css:2-4`).

### 1.1 Colors — every hex, with its CSS var name

Root block: `platform/ui/styles.css:5-53`; duplicated (same values) in `platform/ui/tour.css:7-51`.

| Token (var name) | Value | Carries |
|---|---|---|
| `--bg-app` | `#0a0e14` | page background (styles.css:6) |
| `--bg-surface` | `#0f141c` | panels, cards' inner blocks, modals (styles.css:7) |
| `--bg-surface-elevated` | `#141b24` | hover fills, modal header, repo-tag (styles.css:8) |
| `--bg-card` | `#111822` | proposal cards (styles.css:9) |
| `--bg-card-hover` | `#151e2b` | declared but **unused** in both stylesheets (styles.css:10) |
| `--bg-subtle` | `#182230` | hover fills (modal close hover :870, tour buttons tour.css:320) (styles.css:11) |
| `--bg-inset` | `#070a0e` | deepest insets: conflict-pairs, landed-banner, diff-viewer, merge-pane (styles.css:12) |
| `--border-subtle` | `#1c2634` | default 1px hairlines (styles.css:14) |
| `--border-default` | `#253346` | stronger borders: conflict-card, modal, card hover (styles.css:15) |
| `--border-focus` | `#3e5473` | hover/focus border lift (styles.css:16) |
| `--text-primary` | `#e6edf3` | primary text (styles.css:18) |
| `--text-secondary` | `#8b9bb0` | secondary text, idle button labels (styles.css:19) |
| `--text-muted` | `#57657a` | meta/labels (styles.css:20) |
| `--text-dim` | `#3d4959` | faintest text: footer, ticker-empty, stale pulse (styles.css:21) |
| `--status-green` | `#2ea043` | clean/landed/success (styles.css:24) |
| `--status-green-bg` | `rgba(46, 160, 67, 0.12)` (styles.css:25) | |
| `--status-green-border` | `rgba(46, 160, 67, 0.35)` (styles.css:26) | |
| `--status-red` | `#f85149` | conflict/error (styles.css:28) |
| `--status-red-bg` | `rgba(248, 81, 73, 0.12)` (styles.css:29) | |
| `--status-red-border` | `rgba(248, 81, 73, 0.35)` (styles.css:30) | |
| `--status-amber` | `#d29922` | warn/secret/confirm (styles.css:32) |
| `--status-amber-bg` | `rgba(210, 153, 34, 0.12)` (styles.css:33) | |
| `--status-amber-border` | `rgba(210, 153, 34, 0.35)` (styles.css:34) | |
| `--status-neutral` | `#7d8590` | neutral badges, severity-neutral band (styles.css:36) |
| `--status-neutral-bg` | `rgba(125, 133, 144, 0.12)` (styles.css:37) | |
| `--status-neutral-border` | `rgba(125, 133, 144, 0.3)` (styles.css:38) | |
| `--accent-blue` | `#58a6ff` | interactive accent, repo titles, intent rule, event type (styles.css:40) |
| `--accent-blue-bg` | `rgba(88, 166, 255, 0.1)` (styles.css:41) | |
| `--accent-blue-border` | `rgba(88, 166, 255, 0.3)` (styles.css:42) | |
| `--diff-add-bg` | `rgba(46, 160, 67, 0.15)` (styles.css:44) | |
| `--diff-add-text` | `#3fb950` (styles.css:45) | `+` lines, addition counts |
| `--diff-del-bg` | `rgba(248, 81, 73, 0.15)` (styles.css:46) | |
| `--diff-del-text` | `#f85149` (styles.css:47) | `-` lines, deletion counts |
| `--diff-hunk-bg` | `rgba(88, 166, 255, 0.08)` (styles.css:48) | **exists only in styles.css** — tour.css omits it (tour.css:44-48) |
| `--diff-hunk-text` | `#79c0ff` (styles.css:49) | same |

Off-palette/literal colors (not var-led):
- `#fff` hover text: `.btn-tour-header:hover` (styles.css:299), `.btn-land:hover` (styles.css:658), `.btn-land.is-confirming:hover` (styles.css:667); tour: `.btn-ctrl.btn-primary:hover` (tour.css:335), `.btn-launch-app:hover` (tour.css:1034).
- `#ffb4af` — `.conflict-region` text in the tour's sim-3 conflict box (tour.css:752).
- Hover tints: `rgba(248, 81, 73, 0.2)` (styles.css:169), `rgba(88, 166, 255, 0.2)` (styles.css:297, 656), `rgba(210, 153, 34, 0.25)` (styles.css:666), `rgba(46, 160, 67, 0.22)` (tour.css:1032).
- Secret treatments: `.badge-secret` bg `rgba(210, 153, 34, 0.15)` (styles.css:532); `.secret-key-tag` bg `rgba(210, 153, 34, 0.12)` / border `rgba(210, 153, 34, 0.25)` (styles.css:807-808).
- Severity gradients: `rgba(248, 81, 73, 0.05)` (styles.css:482), `rgba(210, 153, 34, 0.05)` (styles.css:486).
- Modal backdrop: `rgba(4, 7, 11, 0.8)` (styles.css:818).

### 1.2 Typography

- Base: `html, body { font-family: var(--font-mono); font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased }` (styles.css:127-135).
- Mono stack: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` (styles.css:51; tour.css:50).
- Sans stack declared (`--font-sans`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, styles.css:52; tour.css:51) but **never referenced** — the as-built UI is fully monospace.
- Sizes in use (styles.css): 1.125rem/600/-0.02em brand title (:191-196); 0.875rem brand subtitle/modal title/proposal repo title/empty-state title (:202-206, :618-622, :852-859, :967-971); 0.8125rem ref-spec, section titles (uppercase, ls .06em, weight 600), action/connection banners, proposal intent (:207-213, :450-456, :62, :153, :678-688); 0.75rem controls, chips, ticker, badges' context, file rows, diff/merge panes, loading indicator, tour step copy (:418-424, :338-342, :884-886, :976-981); 0.6875rem micro-labels (chip labels, ticker labels/timestamps, file counts, footer, pair region) (:343-348, :386-391, :434-437, :780-784, :989-991); 0.625rem file status indicators + secret key tags (:755-760, :806-812).
- All-caps micro-labels via `text-transform: uppercase` with letter-spacing .04em-.06em (chip label :343-348, section title :450-456, ticker label :386-391, intent label :689-696).

### 1.3 Radii — nearly square by design

Only five rounded values exist in styles.css: toggle track `999px` (:238), toggle knob `50%` (:251), tour help `50%` (:308), ticker pulse dot `50%` (:399), file status indicator `2px` (:758). Tour adds `2px` on `.annotated-region` (tour.css:649). Everything else (cards, chips, badges, buttons, modals) is square-cornered.

### 1.4 Spacing / layout

- rem-based on the 13px base. Recurring steps: 0.05/0.1/0.15/0.2/0.25/0.3/0.35/0.375/0.4/0.45/0.5/0.6/0.625/0.75/0.875/1/1.125/1.25/1.5/2/2.5/3/4 rem.
- App shell: `.app-container { max-width: 1440px; margin: 0 auto; padding: 1.5rem 2rem 4rem }` (styles.css:138-142).
- Proposals grid: `repeat(auto-fill, minmax(360px, 1fr))`, gap 1.25rem (styles.css:585-589).
- Recurring gaps: 0.75rem (card internals, ticker), 0.5rem (chips, buttons), 1rem/1.25rem (sections, banners). Section bottom margins 2rem (conflicts :463-465, proposals :582-584).
- Transitions: `0.15s ease` standard (banner :65, refresh :271, card :597); `0.12s ease` on card action buttons (:637).

### 1.5 Borders, shadows

- Border system: 1px `solid` hairlines everywhere; semantic left bands `border-left: 4px solid` on conflict cards (styles.css:480-490) and `border-left: 2px solid var(--accent-blue)` on intent blocks (:680).
- Dashed treatments mark terminal/inert states: landed card `border-style: dashed` (:604), landed banner `1px dashed` (:714), empty-state `1px dashed` (:963), tour conflict-region `1px dashed var(--status-red)` (tour.css:748).
- Shadows — exactly two: `.conflict-card { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) }` (styles.css:478); `.modal-window { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5) }` (styles.css:836).
- Status is carried by border+bg+text tint triads (e.g. `.action-banner.banner-success` :70-74, `.summary-chip.is-alert` :353-359, `.proposal-card.is-landed` :602-609).

---

## 2. Surfaces inventory

Triage app (`platform/ui/index.html`):

| Surface | Purpose | Ref |
|---|---|---|
| Connection error banner | red bar: "Disconnected from platform worker. Retrying..." + "Retry now" | index.html:12-15 |
| Action banner | transient result of a land action (success/error/warn) with badge + dismiss | index.html:18-24 |
| Header | brand ("NextGit / your agents' work, all in one place") + ref-spec (`base: demo · ref: main`) | index.html:27-71 |
| Header controls | auto-refresh toggle (8s), manual refresh, "Start the tour" link, "?" help | index.html:37-45 |
| Summary chips | 5 count chips: proposals, shared files, conflicting pairs, changed files, clean pairs | index.html:48-70 |
| Events ticker | live row of newest ≤8 events with pulse indicator | index.html:74-82 |
| Convergence Conflicts | conflict map: per-file conflict cards with involved repos + pair rows | index.html:87-95 |
| Concurrent Proposals | the set-level triage canvas: one card per proposal | index.html:98-106 |
| Inspector modal | diff viewer (`/changes`) and merge preview (`/merge`) in one dialog | index.html:110-123 |
| Footer | "nextgit — serverless convergence engine" + last-sync time | index.html:126-129 |

Tour app (`platform/ui/tour.html`):

| Surface | Purpose | Ref |
|---|---|---|
| Tour header + stepper | 10-step progress with clickable step buttons (0. Intro → 9. Your Role) | tour.html:12-40 |
| Step 0 Intro | pitch + glossary rule + 4 term cards (NextGit, Convergence, Proposal, Collision) | tour.html:44-93 |
| Step 1 The Problem | "Single-Threaded Review Is Broken" + sim 1: Traditional GitHub View vs NextGit Fleet View | tour.html:95-129 |
| Step 2 Workspaces | sim 2: baseline `demo` diagram + "Give 4 agents tasks" spawn | tour.html:131-174 |
| Step 3 What a Proposal Is | annotated sample card with 5 inspectable regions + details pane | tour.html:176-240 |
| Step 4 What a Collision Is | sim 3: two snippets on `src/auth.ts` + "Try to ship both" | tour.html:242-299 |
| Step 5 Shipping | sim 4: one-click ship card with terminal narration | tour.html:301-350 |
| Step 6 Real Platform | live proposals grid fetched from the platform worker | tour.html:352-375 |
| Step 7 Exercise | quiz: "Which Would You Ship?" over agent-1..4 | tour.html:377-416 |
| Step 8 Scope | "What Is Not Here (Yet) and Why" — two-column scope grid | tour.html:418-456 |
| Step 9 Your Role | operator bullets + CTA "Open the Triage App" / "Restart Tour" | tour.html:458-486 |
| Tour controls/footer | Previous/Next + "Step N of 10"; foot back-link | tour.html:490-500 |

---

## 3. Component inventory (as implemented)

Buttons:
- `btn-refresh` "refresh" — hover elevates bg + `--border-focus`, `:disabled` 50% opacity (styles.css:263-280).
- `btn-tour-header` "Start the tour" — blue-tinted link button; hover → `rgba(88,166,255,0.2)`, `#fff` (styles.css:282-301).
- `btn-tour-help` "?" — 1.5rem circle, hover blue label (styles.css:302-324).
- `connection-banner-action` "Retry now" — red-on-red; hover fill `rgba(248,81,73,0.2)` (styles.css:159-170).
- `action-banner-close` "dismiss" — currentColor outline; hover 0.8 opacity (styles.css:107-119).
- `btn-card-action` base — surface bg, mono 0.6875rem; `:disabled` 50% (styles.css:629-648).
- `btn-land` "Land into demo" — accent-blue tint; hover `rgba(88,166,255,0.2)` + `#fff` (styles.css:649-659).
- `btn-land.is-confirming` "confirm land?" — flips to amber tint; hover `rgba(210,153,34,0.25)` (styles.css:660-668).
- `btn-cancel-land` "cancel" — transparent, muted, hover → primary text (styles.css:669-676).
- `btn-file-diff` "view diff" — only rendered for non-secret files (styles.css:786-799; app.js:465-469).
- `btn-close-modal` "close" — modal header (styles.css:860-872).
- `merge-file-tab` — inactive/`.active` (elevated bg, primary text); conflict files get a ` [!]` suffix (styles.css:930-943; app.js:719-728).
- `toggle-input` — pill toggle, `:checked` = green bg/border + knob translateX (styles.css:232-261).
- Tour: `.btn-nav` (tour.css:130-149), `.step-btn` (+ `.is-active` blue tint, `.is-completed`, tour.css:180-205), `.btn-ctrl` (+ `.btn-primary`, tour.css:312-336), `.sim-btn` (+ `.is-active`, tour.css:455-470), `.quiz-option-btn` (+ `.is-selected`, tour.css:878-884), `.btn-launch-app` green CTA (tour.css:1020-1036).

Badges (`styles.css:508-540`): `badge` base + `badge-red`, `badge-amber`, `badge-neutral`, `badge-secret` ("secret-typed"), `badge-clean`. Rendered in: action banner (app.js:189-193), conflict cards (kind text, app.js:385), proposal landed state `badge-neutral` "landed" (app.js:479), file rows `badge-secret` (app.js:449), modal header (app.js:575-583), merge status (app.js:734).

Summary chips (`styles.css:332-373`): `summary-chip` + `is-alert` (red) / `is-warn` (amber) / `is-clean` (green); applied from `summary.conflictingPairs > 0`, `sharedFiles > 0`, `cleanPairs > 0` (app.js:265-287). Chip labels: "proposals", "shared files", "conflicting pairs", "changed files", "clean pairs" (index.html:49-70).

Ticker (`styles.css:376-441`): `ticker-section`, `ticker-label` + `ticker-pulse` (`is-stale` on events fetch failure, app.js:237, :299-301), `ticker-event` rows with `event-type` chip, `event-repo`, `event-time` (app.js:309-324); `ticker-empty` fallback; ≤8 events shown (app.js:232).

Conflict card (`styles.css:471-579`, app.js:330-399): `conflict-card` + severity class from kind — `text-conflict|modify/delete|add/add` → `severity-red`; `undetermined` → `severity-amber`; `mergeable|identical-add|both-removed` → `severity-neutral` (app.js:89-103); header file name + kind badge; "proposals:" repo tags; pair rows `agent-1 ↔ agent-2` + pair kind + region `(base: NL, agent-1: NL, agent-2: NL)` (app.js:360-373). Section meta "N detected" (app.js:335).

Proposal card (`styles.css:590-812`, app.js:404-538) states, exactly as coded (app.js:427-497):
- default: actions "preview merge" + "Land into demo"; intent block; stats (files, +additions, −deletions); files list.
- `isLanding` (repo in flight): single disabled "landing..." button.
- `isConfirming`: "confirm land?" (amber `is-confirming`) + "cancel".
- `isLanded` (`landing.status === "landed"` **or** `stats.files === 0`): card `is-landed` (0.55 opacity, dashed border, hover 0.85), "landed" badge, `landed-banner` instead of stats/files.
- Secret file row: `badge-secret` "secret-typed" + `secret-key-tag` chips from `keys[]` + **no** "view diff" button (app.js:447-469).
- File row also: `file-status-indicator` added/modified/removed (green/blue/red, styles.css:761-772), path with title tooltip, +/− counts (app.js:442-472).
- `proposal-intent` block: blue left rule + uppercase "intent:" label (styles.css:678-696).

Modal / inspector (`styles.css:814-957`): backdrop click + Escape close (app.js:895-904); diff viewer with `line-add|line-del|line-hunk|line-meta` rows and `diff-placeholder` "No patch available for this file (omitted, withheld, or binary)." (app.js:108-129, :110); merge viewer: `merge-status-bar` ("Overall status:" badge + `action: X · result: Y`), file tabs, `merge-pane` (+`has-conflict` red border), secret files show "Secret content withheld" (app.js:701-741, :711-713).

Action-banner land flow (app.js:776-848): warn "Landing proposal X into demo..." → success "Successfully landed proposal X into demo. Commit `<sha8>`" (`.commit-sha` chip, styles.css:95-102) → or blocked "Withheld-secret file — landing blocked (files)" → conflict "Conflicted files: … (preview merge first)" → or "Failed to land …". Auto-refresh after land (app.js:813-814).

Empty/loading primitives: `empty-state` + `empty-state-title`/`empty-state-desc` (styles.css:960-974); `loading-indicator` (styles.css:976-981); `diff-placeholder` (styles.css:908-913). Polling: `/events` every 2s, `/proposals` every 8s, debounce refresh 500ms when a new event key appears (app.js:213-239, :941-958).

---

## 4. Copy and voice — verbatim samples

1. `platform/ui/index.html:6` — "NextGit — your agents' work, all in one place" (page title; same string as brand subtitle at `index.html:30`).
2. `platform/ui/index.html:13-14` — "Disconnected from platform worker. Retrying..." / "Retry now".
3. `platform/ui/index.html:39,42,44` — "auto-refresh (8s)" / "refresh" / "Start the tour".
4. `platform/ui/index.html:80` — "listening for convergence events...".
5. `platform/ui/index.html:89-90,100-101` — "Convergence Conflicts" / "0 detected" · "Concurrent Proposals" / "0 active".
6. `platform/ui/index.html:127-128` — "nextgit — serverless convergence engine" / "not synced yet".
7. `platform/ui/app.js:340-342` — "No convergence conflicts" / "All concurrent proposals merge cleanly or target orthogonal files."
8. `platform/ui/app.js:414-415` — "No active proposals" / "Waiting for agent branches to propose changes against base."
9. `platform/ui/app.js:516-518` — "landed — nothing pending" / "All changes from this branch have been merged into baseline."
10. `platform/ui/tour.html:51-53` — "The place where many AI agents work on your code at once — you see everything, catch the collisions, ship what you want."
11. `platform/ui/tour.html:101,108` — "Single-Threaded Review Is Broken" · "You approve PR #1, and PR #2 breaks silently. NextGit replaces sequential review with a unified fleet view."
12. `platform/ui/tour.html:250-251,255` — "Two agents edited the same lines of code. Both changes cannot ship unchanged." · "NextGit finds this by actually attempting the merge in memory before anything ships."
13. `platform/ui/tour.html:309,313-314` — "One click folds the proposal onto the main branch on the server. No local git clone required." · "…creates a merge commit, updates the default branch, and marks the proposal as landed."
14. `platform/ui/tour.html:426,466` — "We deliberately did not rebuild today's GitHub. The competition calls for the new layer." · "You are the conductor. Agents write code; you control convergence."
15. `platform/ui/tour.js:530-532` (quiz feedback) — "Risky: agent-1 collides with agent-2" / "agent-1 adds refreshSession() in src/auth.ts on the exact same lines where agent-2 modifies isExpired(). Shipping agent-1 now will make agent-2 unmergeable without manual intervention."

Voice summary: lowercase, terse, operator-addressed UI copy in the app ("refresh", "dismiss", "landing..."); the tour is plain-English teacher-voice ("No tab-hopping" claim lives in demo-scope.md:41: "one canvas; the whole set at a glance; no tab-hopping"). No emoji anywhere (styles.css:2, tour.css:4).

---

## 5. States present per surface

| Surface | Empty | Loading | Error | Live |
|---|---|---|---|---|
| Ticker | "listening for convergence events..." (index.html:80, app.js:305) | none (no skeleton) | pulse turns `is-stale` (text-dim) but row keeps last events (app.js:235-238) | 2s poll `/events`, ≤8 rows, event-key debounce → proposals refresh (app.js:213-239, :952) |
| Conflicts panel | empty-state "No convergence conflicts" (app.js:337-344) | none | via connection banner only | meta "N detected"; severity-banded cards |
| Proposals grid | empty-state "No active proposals" (app.js:411-418) | none (grid renders only after first `/proposals`) | via connection banner only | 8s poll; per-card landing/confirm/landed states |
| Connection banner | hidden (`hidden` attr, index.html:12) | — | shown with `Connection error: <msg>. Retrying...` (app.js:559-561) or initial "Disconnected from platform worker. Retrying..." | hidden when fetch OK (app.js:564-566) |
| Footer sync | "not synced yet" (index.html:128) | — | stays "not synced yet" | `synced HH:MM:SS` (app.js:288-290) |
| Diff modal | — | "Loading change-set from /changes..." + badge "fetching diff..." (app.js:602-607) | badge "error", "Failed to load diff" + message (app.js:651-658); not-found variant (app.js:615-623) | patch rendered; secret → "Secret content withheld" + keys (app.js:625-640) |
| Merge modal | "No files changed in merge" (app.js:681-696) | "Computing merge projection from /merge..." (app.js:665-670) | badge "error" "Failed to compute merge" (app.js:764-771) | clean/conflict badge; per-file merged / conflictText / withheld-secret |
| Action banner | hidden until an action | "landing" warn banner during POST (app.js:782-786) | "blocked" / "conflict" / "failed" variants (app.js:819-844) | auto-dismiss only by user click |
| Tour step 6 (live) | — | "Fetching live proposal state from platform worker..." (tour.html:369); "Connecting to https://…/proposals?base=demo..." (tour.js:441) | console warning + fallback snapshot gracefully (tour.js:457-460) | real `/proposals` render, plus annotations ("real collisions, clean additions, and changes that have already landed", tour.html:363-366) |

Notable gap: the app has no explicit first-load loading state for the main canvas; only modal fetches show `loading-indicator`. Error handling for the main data path collapses into the single red connection banner.

---

## 6. Planned-but-unbuilt UX

Judge chips (planned, `docs/judge-layer-ideas.md:36-45`; wiring plan :93-98):
- **Risk chip** — Idea 1: "Review-risk score — score: Routine / Focused / Senior-security. → risk chip on each card; policy in code." (`:38`)
- **Intent-verification badge** — Idea 2: "does the diff do what the intent claims? (supports / contradicts / insufficient + overclaim noul). → 'intent verified / mismatch' badge; catches drifted or bluffing agents." (`:39`)
- **Change-kind label** — Idea 3: "choice: feature / bugfix / refactor / docs / test / chore. → card label; feeds changelog + policy." (`:40`)
- **Semantic-collision chip** — Idea 4: "noul per proposal pair: do they change the same behavior, even in different files? → 'soft collision' warnings diff3 cannot see." (`:41`)
- **Auto-land gate** — Idea 5: "Auto-land eligibility — confidence-gated routing: ACT / CONFIRM / ESCALATE over the other answers. → behind the Land button; safe proposals land themselves." (`:45`)
- Wiring order, verbatim: "First three card fields: **risk score + intent verification + semantic collision**; render as chips; then the auto-land gate behind the Land button." (`:97`); transport plan: add `"ai": { "binding": "AI" }` (`:95`), Worker `POST /judge` (`:96`). Rule: "The judge advises; code decides; humans still own irreversible acts." (`:104`)
- The as-built card has **no** risk/kind/verification chips; the only card signals today are repo, intent, stats, files, landing status (app.js:499-533).

CONTRACT fields the UI does not yet render:
- `landing.status` — contract enum `ready|conflict|landed|withheld-secret` (`platform/CONTRACT.md:41`); UI branches only on `=== "landed"` (app.js:428), so `withheld-secret`/`conflict` never surface as card states.
- `landing.files` count (`CONTRACT.md:41`) unrendered; `pairs[].conflict` boolean (`:43`) unrendered (region rendered, app.js:364-372); `base.treeHash`/`head.treeHash` (`:19`) and `stats.added/modified/removed` (`:20`) unrendered.
- `/merge` `files[].note` and `conflicted[]` (`CONTRACT.md:63-64`) unrendered; merge `repos` order only implicit in title.
- `/land` response `landed.files` and `landed.at` (`CONTRACT.md:82`) unrendered — only `commit` sha is shown (app.js:802-810); `409 no-changes` (`:81`) has no dedicated banner (falls to generic "Failed to land").
- `/events` `ref` and `after` fields (`CONTRACT.md:88`) unrendered (type/repo/at only, app.js:311-318); `/health` (`:9-11`) not surfaced anywhere.
- CAP-8 "elevated reveal" beat (SPEC.md:39-40) is not implemented — UI offers only the schema-only/withheld views; masking remains path-driven by design (CONTRACT.md:110), while content-based secret detection is still an idea (judge-layer-ideas.md:54).
- Explicitly set aside (by the product, shown in tour): file browsers, issue threads, profiles, CI logs, comment chains (tour.html:435-444) — and roadmap list (tour.html:446-453).

---

## 7. Journey fragments (demo story, verbatim)

From `_bmad-output/specs/spec-next-git-platform/demo-scope.md:26-33` ("Demo story (one uninterrupted take)"):
1. "One repository; 3–5 agents provisioned as isolated workspaces (CAP-1)."
2. "A deliberate cross-agent collision on the same files."
3. "The platform detects the overlap and renders the conflict map (CAP-3); pushes flow live (CAP-6)."
4. "Every proposal routes to the triage canvas as a card — intent, diff, risk, conflict map, provenance (CAP-4, CAP-5)."
5. "The reviewer (and/or a judge agent) compares the set; one proposal lands with validation evidence (CAP-7); the decision record persists as a git note (CAP-5)."
6. "Secret-typed file beat: schema-only view; a leak is scrubbed at commit (CAP-8)."

Supporting fragments:
- Success signal, `SPEC.md:69`: "Submit by Oct 14 a live 5–10 minute demo in which one repository runs 3–5 concurrent agents, a deliberate cross-agent collision surfaces as a conflict map, every proposal sits on one triage canvas with intent and provenance, one proposal lands with its validation evidence, and a secret-typed file is shown schema-only — all on real Workers + Artifacts, exercising all three scored axes in one uninterrupted story."
- Why, `SPEC.md:13`: "Code generation became cheap; code integration did not. … No shipping product presents N concurrent agent change-sets as one comparable set … the unoccupied layer: **convergence** — the set-level surface where concurrent proposals are compared, judged, and landed."
- Rubric, `demo-scope.md:37-41`: UX 25% — "one canvas; the whole set at a glance; no tab-hopping".
- Design constitution: Law 1 "Convergence is the central act. Sets, not diffs. Triage at set level." (`engineering-laws.md:5`); Law 8 "features surface in context — discoverable in place, never buried in tabs. No tab explosion; SPA-like continuity." (`:12`); Law 12 "Merging feels transparent, seamless, understandable — not a bolt-on." (`:16`); swarm rule R1 "Communicate through the work… any agent orients locally — no hub, no global truth." (`:22`).
- Landing as journey, `platform/CONTRACT.md:75`: "This is the browser's one-click 'ship it'." + `:83` "After landing, a `repo.pushed` event for the base repo flows through `/events` — the UI refreshes itself."
- Tour-voiced journeys: workspaces — "Every agent gets its own clean copy of your code to edit. No agent blocks another while typing." (`tour.html:139`); collision — "Two agents edited the same lines of code. Both changes cannot ship unchanged." (`:250-251`); shipping — "One click folds the proposal onto the main branch on the server. No local git clone required." (`:309`); operator — "You are the conductor. Agents write code; you control convergence." (`:466`).
- Tree/collision facts that drive the UI: conflict kinds `text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed` (`CONTRACT.md:48`); fork-point semantics ("what the agent changed": `:50-54`); the demo's deliberate collision file is `src/auth.ts` (agent-1 `refreshSession` vs agent-2 `isExpired`; judge-layer-ideas.md:20, tour.html:261-288).
