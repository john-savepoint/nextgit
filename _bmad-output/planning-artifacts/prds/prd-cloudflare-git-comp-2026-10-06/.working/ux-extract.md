# UX Extract → PRD — NextGit

Sources (cited by short name, all verification read in full unless noted):

- `EXPERIENCE.md:NN` = `_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/EXPERIENCE.md` (draft-complete; 4 adjudications pending)
- `reconcile-brief.md:NN` = `_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/.working/reconcile-brief.md`
- `DESIGN.md:NN` = `_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/DESIGN.md` (skim only)
- `brief.md:NN` / `addendum.md:NN` = `_bmad-output/planning-artifacts/briefs/brief-cloudflare-git-comp-2026-10-06/` (draft peer, NOT canon — `reconcile-brief.md:3`)

Form factor baseline (carry into PRD scope): web-first, single-surface browser app on the platform Worker; dark-only as built; all state server-side (no offline, no clones, no CLI); API-first — future 3D client "Agent Office" is an out-of-scope API consumer; English-only copy; product name NextGit. (`EXPERIENCE.md:20-28`, `DESIGN.md:401`)

---

## 1. Surface inventory

Every surface/panel the experience defines — one line each.

**Triage app** (`platform/ui/index.html`) — `EXPERIENCE.md:34-48`:

1. Header (brand + ref-spec) — always visible; `NextGit / your agents' work, all in one place` + `base: demo · ref: main` (`EXPERIENCE.md:38`).
2. Header controls — auto-refresh toggle (8s, default on), `refresh`, `Start the tour`, `?` (both open the tour) (`EXPERIENCE.md:39`).
3. Summary chips — 5 set-level counts: proposals / shared files / conflicting pairs / changed files / clean pairs; each tinted alert/warn/clean by its own threshold (`EXPERIENCE.md:40`, `:106`).
4. Events ticker — newest ≤8 events (type, repo, time); 2s poll; pulse dot goes stale on failure; degrades silently, never an error banner (`EXPERIENCE.md:41`, `:104`).
5. Convergence Conflicts — collision map above proposals; per-file cards: kind badge, involved repos, pair rows with line regions; meta `N detected`; read-only, no actions (`EXPERIENCE.md:42`).
6. Concurrent Proposals — the triage canvas; every proposal as one card (repo, intent, stats, file rows, actions); meta `N active`; all cards at once, no paging (`EXPERIENCE.md:43`, `:97`).
7. Diff viewer modal — per-file change-set; loading / patch / error / not-found / secret states; closes via `close`, backdrop, Escape (`EXPERIENCE.md:44`).
8. Merge preview modal — landing outcome before committing; status bar, per-file tabs, merged text / conflict text / withheld notice (`EXPERIENCE.md:45`).
9. Action banner — land outcome; badge + message + `dismiss`; persists until dismissed, no auto-hide; a new action replaces the previous banner (`EXPERIENCE.md:46`, `:107`).
10. Connection banner — any failed fetch except the ticker; red `role="alert"` bar + `Retry now`; hidden on next success (`EXPERIENCE.md:47`, `:108`, `:153`).
11. Footer — provenance: `nextgit — serverless convergence engine` + sync time (`not synced yet` → `synced HH:MM:SS`); never error-styled (`EXPERIENCE.md:48`, `:172`).

**Tour app** (`platform/ui/tour.html`) — `EXPERIENCE.md:50-65`:

12. Tour header + stepper — 10 clickable tab buttons (`0. Intro` … `9. Your Role`), progress fill; scrolls horizontally on narrow widths (`EXPERIENCE.md:54`).
13. Step 0 — Intro: pitch + 4 vocabulary cards (NextGit, Convergence, Proposal, Collision) (`EXPERIENCE.md:55`).
14. Step 1 — The Problem: set-level review rationale; simulation vs traditional GitHub view (`EXPERIENCE.md:56`).
15. Step 2 — Workspaces: isolated fork-per-agent model; `demo` baseline + "Give 4 agents tasks" spawn (`EXPERIENCE.md:57`).
16. Step 3 — Proposals: annotated card anatomy, 5 inspectable regions + details pane (`EXPERIENCE.md:58`).
17. Step 4 — Collisions: collision comprehension on `src/auth.ts`; "Try to ship both" → conflict box (`EXPERIENCE.md:59`).
18. Step 5 — Shipping: one-click server-side land, no clone (`EXPERIENCE.md:60`).
19. Step 6 — Real Platform: live `/proposals` grid fetched from the worker inside the tour (`EXPERIENCE.md:61`).
20. Step 7 — Exercise: quiz "Which Would You Ship?" over agent-1…4 + per-answer feedback (`EXPERIENCE.md:62`).
21. Step 8 — Scope: honest non-goals, two-column "What Is Not Here (Yet) and Why" (`EXPERIENCE.md:63`).
22. Step 9 — Your Role: operator framing + CTA `Open the Triage App` / `Restart Tour` (`EXPERIENCE.md:64`).
23. Tour controls/footer — `Previous` / `Next` + "Step N of 10"; back link to the app (`EXPERIENCE.md:65`).

Also defined as primitives, cross-surface: modal shell (one level deep), `empty-state`, `loading-indicator`, `diff-placeholder` (`EXPERIENCE.md:109`).

---

## 2. State coverage + build gaps (these become UX requirements)

### 2a. Proposal card state machine (`EXPERIENCE.md:112-123`)

- **Built:** `default (ready)`; `confirming` (amber `confirm land?` + `cancel`, inline, no dialog); `landing` (single disabled `landing...` button, no spinner); `landed` (`landing.status === "landed"` OR `stats.files === 0`; 0.55 opacity, dashed border; "landed — nothing pending" / "All changes from this branch have been merged into baseline.").
- **Build gap #1 — `withheld-secret`** (CONTRACT state, unrendered; `CONTRACT.md:41`): spec amber blocked state; secret rows stay schema-only (badge + key chips); `Land` disabled with reason "withheld-secret file — landing blocked"; mirrors `/land` 409 `withheld-secret` (`EXPERIENCE.md:120`, `:268`).
- **Build gap #2 — `conflict`** (CONTRACT state, unrendered): spec red state; `Land` disabled; hint "(preview merge first)"; mirrors `/land` 409 `conflict` (`EXPERIENCE.md:121`).
- **Transition rule (requirement):** any failure returns the card to `default`; only a user `dismiss` clears the banner (`EXPERIENCE.md:123`).
- Unrendered contract fields: `landing.files` count; `pairs[].conflict` boolean; `/merge` `files[].note` + `conflicted[]`; `/land` `landed.files` + `landed.at`; `/events` `ref` + `after`; `/health` unsurfaced (`EXPERIENCE.md:269`).

### 2b. Land flow — 7 outcomes, exact copy (`EXPERIENCE.md:125-133`)

1. `Land into demo` → `confirm land?` + `cancel` (inline; no dialog).
2. In-flight banner (warn): "Landing proposal **{repo}** into **{base}**...".
3. Success: "Successfully landed proposal **{repo}** into **{base}**. Commit `<sha8>`" — sha8 = first 8 chars, full SHA in title tooltip; both endpoints reload immediately; `repo.pushed` re-enters ticker.
4. 409 `withheld-secret` → error banner: "Withheld-secret file — landing blocked ({files})."
5. 409 `conflict` → error banner: "Conflicted files: **{files}**. (preview merge first)".
6. 409 `no-changes` → **build gap #3:** today falls to generic failure; spec dedicated variant "Nothing to land — fold produced zero changes." `[ASSUMPTION — copy]` (`EXPERIENCE.md:132`, `:270`).
7. Any other failure → "Failed to land **{repo}**: {msg}".

### 2c. Modal states

- Diff viewer (`EXPERIENCE.md:135-141`, `:169`): loading ("fetching diff..." / "Loading change-set from /changes..."); patch rows (+/−/hunk/meta registers); no patch (omitted/binary/withheld) → `diff-placeholder` "No patch available for this file (omitted, withheld, or binary)."; secret reached → "Secret content withheld" / "Per platform contract, secret file contents and diffs are never exposed." + key chips; error → "Failed to load diff"; not-found (amber) → "File not present in changeSet".
- Merge preview (`EXPERIENCE.md:143-149`, `:170`): loading ("computing diff3..."); status bar "Overall status:" clean/conflict + "action: X · result: Y" (X ∈ write/delete; Y ∈ merged/conflict/withheld-secret); per-file tabs, conflicted files ` [!]`; conflict pane with diff3 markers; withheld → "Secret content withheld"; empty → "No files changed in merge"; error → "Failed to compute merge".

### 2d. Canvas + system state coverage (`EXPERIENCE.md:151-173`)

- Ticker: empty "listening for convergence events..."; loading none (no skeleton; events appear on first 2s poll); error → pulse stale, last events stay; live 2s poll (`:157-160`, `:104`).
- Conflicts: empty "No convergence conflicts" / "All concurrent proposals merge cleanly or target orthogonal files."; **GAP #4** loading; live severity cards + meta `N detected` (`:161-163`).
- Proposals: empty "No active proposals" / "Waiting for agent branches to propose changes against base."; **GAP #4** loading; live 8s poll + 500ms event debounce (`:164-166`).
- **GAP #4 — first load (whole canvas)** spec: chips show `—` until first payload; both panels show a `loading-indicator` matching final layout ("Loading the set from /proposals..." `[ASSUMPTION — copy]`), swapping to data or empty state on first response; today chips start at `0` and grid is blank (`EXPERIENCE.md:167`, `:228`).
- Global fetch error → Connection banner ("Connection error: {msg}. Retrying..." / initial "Disconnected from platform worker. Retrying...") + `Retry now`; hidden on success (`:168`). One error surface only: every failed fetch except the ticker funnels here; panels keep their last render (`:153`).
- Tour step 6: loading "Fetching live proposal state from platform worker..."; error → console warning + graceful fallback snapshot, no banner (`:173`, `:246`).
- Footer sync: "not synced yet" → "synced HH:MM:SS"; never error-styled (`:172`).

### 2e. Additional specced build gaps

- **GAP #5 — CAP-8 "elevated reveal" beat not implemented** (schema-only / withheld views only) (`EXPERIENCE.md:272`).
- **GAP #6 — judge chips + auto-land gate planned P0, not rendered:** risk score, intent-vs-diff verification, semantic collision; when built: chips on the card, gate behind the Land button; "the judge advises; code decides; humans still own irreversible acts." Draft brief lists them as first-version — contradiction flagged (`EXPERIENCE.md:273`; `DESIGN.md:606-614`).
- **GAP #7 — <424px overflow:** proposals grid 360px track floor + 2rem container padding overflows below ~424px viewports; fix = single column below the floor `[ASSUMPTION]` (`EXPERIENCE.md:259`). Triage app has no authored media queries; only tour.css has breakpoints (768px, 640px) (`EXPERIENCE.md:255-257`).
- Pending-intake state behaviors to lock at requirement level: WCAG 2.2 AA floor; tab order; modal focus trap; reduced-motion; 44px touch targets; first-load treatment; card treatments for the two unrendered states; `no-changes` copy (`EXPERIENCE.md:264`).
- Interaction requirements as behavior: click-first (no drag/context menus/custom shortcuts beyond Tab/Enter/Space/Escape); inline confirm replaces dialogs; Escape closes topmost modal (one level deep, never two); hover is enhancement only — every action always visible without hover; tab order = document order, modal traps focus and returns it to trigger `[ASSUMPTION — verify in build]` (`EXPERIENCE.md:32`, `:177-181`).
- Polling cadence is behavioral requirement, not implementation detail: `/events` 2s; `/proposals` 8s with toggle on; new top event debounce 500ms; land reloads both endpoints; `/events` failure must never break proposals UI; push-style immediacy is the product goal — as-built polls (`EXPERIENCE.md:182`). Set view, no paging — all proposals on one canvas, no tab-hopping, no collapse (`EXPERIENCE.md:183`).
- Provenance requirement: the landing decision persists as a git note (`EXPERIENCE.md:214`).

---

## 3. Key Flows (`EXPERIENCE.md:204-246`)

1. **Flow 1 — The demo story** (John, one repo, four agent crews; the 5–10 minute take) — four crews push proposals onto the one canvas; a deliberate `src/auth.ts` collision renders in the conflict map with the alert chip; climax is the one-click land with sha receipt, landed card, ticker event, and git-note record; secret beat shows schema-only masking and the blocked land. Three failure paths rehearsed: colliding land 409, secret-touching land 409, generic failure (`:208-217`).
2. **Flow 2 — First contact** (cold open; comprehension under a minute) — open URL; header orients; chips + ticker; whole set on one canvas with nothing to open first; climax: inside a minute John can state what the fleet is doing and which pair collides, before any click. Failure: disconnected banner + `Retry now`; empty repo → empty states explain what is awaited (`:219-228`).
3. **Flow 3 — Triage** (scan the conflict map, then decide) — follow the `conflicting pairs` chip to the map; conflict card names file, repos, line regions without reading a diff; open diff then `preview merge`; climax: the decision happens on the canvas — land or hold; no tab-hopping, no local git, no CLI. Failure: merge preview error badge, reopen to retry; land anyway → 409 conflict banner (`:230-237`).
4. **Flow 4 — Learn** (the tour, and when it's offered) — offered from the triage header at all times (`Start the tour`, `?`) or direct; 10-step stepper; steps 0–5 teach with sims, 6 shows the real platform, 7 quizzes, 8 states scope, 9 frames the role; climax: real `/proposals` renders live in step 6, step 9 returns to the app. Failure: fallback snapshot, never breaks, no error banner (`:239-246`).

---

## 4. Accessibility floor + DESIGN.md honest gaps

### 4a. Floor as stated (`EXPERIENCE.md:185-202`)

- Target: **WCAG 2.2 AA is the proposed floor** — `[ASSUMPTION, pending intake]` (`:187`).
- As built: native controls throughout, labeled by text; `?` / `dismiss` carry `aria-label`s; `role="alert"` connection banner; `role="status" aria-live="polite"` action banner; ticker region labeled "Live event ticker"; status never color-alone — every tinted state carries a word; Escape + backdrop close the modal (`:189-194`).
- To build (floor requirements): visible focus on every interactive control via `{colors.border-strong}` lift with non-hover focus parity; modal focus management (move in, trap, return to trigger); polite `aria-live` on the ticker region (not per row) so events announce without spam; `prefers-reduced-motion` drops 0.15s transitions + ticker pulse; touch targets ≥44px at phone widths (all `[ASSUMPTION]`, unbuilt) (`:196-202`).

### 4b. DESIGN.md honest gaps (PRD should carry as requirements)

- **Contrast gap (real as-built finding under the AA assumption):** `{colors.text-muted}` ≈3.3/3.1/3.1:1 on app/surface/card and `{colors.text-dim}` ≈2.1/2.0:1 — both **below 4.5:1 for small text**; raising them is a pending decision; they are confined by rule to meta labels / ambient chrome and MUST NOT be extended to body copy or state messaging meanwhile (`DESIGN.md:454-466`). Everything else in the load-bearing table passes AA+ (text-primary ≈15-16:1, secondary ≈6.3-6.8, accent ≈7.6, status solids ≈5.2-7.7, diff text ≈5.1-9.3, text-bright on tinted hover ≈12-13) (`DESIGN.md:454-464`).
- Wording requirement: WCAG AA is `[ASSUMPTION]` contrast target in DESIGN too (`DESIGN.md:452`).
- Off-palette drift to resolve: `badge-secret` uses a 15% amber bg literal vs 12% triad (align on next touch); `#ffb4af` tour conflict-region text is flagged drift — replace with status-red family (`DESIGN.md:200`, `:468`); `bg-card-hover` declared but unused as of 2026-10-05 (`DESIGN.md:12`); sans stack declared but never referenced — dead code (`DESIGN.md:472`).
- Stance assumptions the PRD should lock as scope decisions: dark-only, no light mode without explicit future decision; mono-only type; square-corner canon; web-first single surface (`DESIGN.md:401`, `:472`, `:510`).
- Planned judge chips: risk chip (Routine/Focused/Senior-security), intent-verification badge (intent verified / intent mismatch / insufficient), semantic-collision chip (advisory amber, never red); chip color mapping is a proposed canon `[ASSUMPTION — confirm or correct at intake]`; auto-land gate stays behind the Land button, CONFIRM reuses amber confirming, ESCALATE shows red badge and never auto-fires (`DESIGN.md:606-614`, `:397`).

---

## 5. Adjudication-required list (do not re-inherit contradictions)

### 5a. Four live conflicts (`reconcile-brief.md:49-55`)

1. **Protagonist** — draft brief: teams + reviewer/conductor (`brief.md:35`) vs spines: **John, solo operator/conductor as demo protagonist** under `[ASSUMPTION pending intake]` (`EXPERIENCE.md:206`, `:264`; ux memlog:18 "[confirm or correct]"). PRD needs one primary-user statement; pending answer.
2. **Concerns floor** — brief silent on light mode / mobile / i18n / offline / accessibility; spines ship dark-only, English-only, web-only with WCAG 2.2 AA proposed — all `[ASSUMPTION]`/open (`reconcile-brief.md:53`; `DESIGN.md:401`; `EXPERIENCE.md:23`, `:187`, `:250`, `:264`). PRD scope/quality section must state each decision or flag it.
3. **Connect presentation** — addendum "3 finalists present live" (`addendum.md:18`) vs canon "winner presents" (`SPEC.md:50`); non-UX, no spine coverage (`reconcile-brief.md:54`). PRD must not restate either silently.
4. **Scale framing** — N≥4 floor / 12–50 target / 20–50-proposal budget (`brief.md:40`, `:58`) vs four-crew demo (`EXPERIENCE.md:206`) and the no-paging, all-cards set view (`EXPERIENCE.md:97`, `:183`). PRD target-scale claims must not contradict the one-canvas requirement.

### 5b. Five superseded items — spines keep reality as canon (`reconcile-brief.md:24-30`)

1. **"fleet view" naming** — as-built labels stand ("Concurrent Proposals", "Convergence Conflicts"); coinage is not canon (`:26`; `EXPERIENCE.md:32`, `:275`).
2. **Judge-layer-as-live framing** — chips are planned P0, not rendered; no live scoring/verification today (`:27`; `EXPERIENCE.md:273`).
3. **"no polling" wording** — as-built polls `/events` 2s and `/proposals` 8s; push-style is the product goal, wording is wrong (`:28`; `EXPERIENCE.md:182`).
4. **"access-controlled" secrets wording** — masking is path-driven by design; elevated reveal (CAP-8) unbuilt; schema-only views (`:29`; `EXPERIENCE.md:120`, `:273`).
5. **Landing "validation evidence attached"** — receipt is the short commit SHA only; `landed.files`/`at` unrendered (`:30`; `EXPERIENCE.md:129`, `:269`).

Also carry the three draft-brief deltas flagged at `EXPERIENCE.md:275`: fleet-view naming, no-polling claim, validation-evidence claim. Seven further brief conflicts are resolved by spines keeping reality as canon — reopens only if the user overturns (`reconcile-brief.md:57`). Incorporated baseline PRD can build on: 16 items (`reconcile-brief.md:5-22`).

---

## 6. Qualitative ideas the UX reconcile dropped — PRD homes needed (`reconcile-brief.md:32-47`)

These have no home in either UX spine; they are strategy/adoption material that the PRD should absorb rather than lose.

1. **Executive stats + competitive claims** ("bottleneck moved to converging", 41.7% / 15–31%, six / 6+ sweeps, nearest-competitor list, timing-moat) — PRD problem statement / success metrics (`brief.md:12,14,28,29`; `addendum.md:15-17`).
2. **Why-now substrate** (Artifacts / Workers / Queues / Durable Objects + Clef characterization and costs) — PRD tech-context / constraints (`brief.md:16`; `addendum.md:19`).
3. **Secondary personas** (game studios at asset scale, agent-harness builders, "machine-legible first") — PRD target-users beyond the primary operator (`brief.md:35`).
4. **Adoption signals beyond the competition** (API used in anger, second client rendering live state, proposals-landed-per-week) — PRD success metrics (`brief.md:41`).
5. **Vision/timeline** ("make GitHub irrelevant", Year 1 / 2–3 roadmap, workspaces as default home, game-asset tier, clients multiply) — PRD vision / roadmap framing (`brief.md:51`).
6. **Harness commitments** (omp, codex, harness routing) — PRD integration/onboarding requirements; note spines stay harness-agnostic (`brief.md:45`; `EXPERIENCE.md:206`).
7. **Reproducible-from-committed-scripts demo criterion** — PRD demo acceptance / reproducibility requirement (`brief.md:40`).
8. **New non-goals + parked alternatives** (no multi-tenant hardening, no billing; GitHub-bolted-on rejected; rebuild-PM parked) — PRD non-goals section (`brief.md:47`; `addendum.md:25-28`).
9. **Scale framing** (N≥4 floor, 12–50 target, 20–50-proposal budget item) — PRD scale requirement; interacts with live conflict #4 and the all-cards set view (`brief.md:40`, `:58`; `EXPERIENCE.md:97`, `:183`).
10. **Open unknowns** (eligibility US/Canada, working name, deferred business model) — PRD open-questions; note eligibility is already resolved in this run by the US-resident team member (PRD memlog:11), working name is NextGit, business model stays deferred (`brief.md:55-57`).
11. **Evidence-pack incidents** (GitHub merge-queue silent deletions; Cloudflare internal review stats) — PRD problem/evidence section (`addendum.md:20-21`).
12. **Judge-layer calibration thresholds** (tune on labeled proposals before gating) — PRD requirement for judge-layer gating rollout; aligns with planned P0 posture (`brief.md:59`; `EXPERIENCE.md:273`).

---

Counts: surfaces 23 (11 triage + 12 tour) · specced build gaps 7 · key flows 4 · live conflicts 4 · superseded 5 · dropped-but-needed ideas 12.
