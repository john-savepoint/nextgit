---
name: NextGit
description: Agent-era software platform. The convergence surface shows every concurrent agent proposal as one set — intent, diffs, collisions — and ships the chosen one with a click. Web-first on Cloudflare Workers + Artifacts. This spine codifies the as-built visual identity and its near-term extensions (judge chips, collision emphasis).
status: draft
updated: 2026-10-05
colors:
  # Background layers — depth by tone, not shadow.
  bg-app: '#0a0e14'                 # --bg-app · page canvas
  bg-surface: '#0f141c'             # --bg-surface · panels, inner blocks, modal window
  bg-surface-elevated: '#141b24'    # --bg-surface-elevated · hover fills, modal header, repo tags
  bg-card: '#111822'                # --bg-card · proposal cards
  bg-card-hover: '#151e2b'          # --bg-card-hover · declared in source, unused as of 2026-10-05
  bg-subtle: '#182230'              # --bg-subtle · heavier hover fills (modal close, tour buttons)
  bg-inset: '#070a0e'               # --bg-inset · deepest wells: pair rows, diff viewer, merge pane, landed banner
  # Border hairlines
  border-subtle: '#1c2634'          # --border-subtle · default hairline
  border-default: '#253346'         # --border-default · stronger border (conflict card, modal, card hover)
  border-focus: '#3e5473'           # --border-focus · interactive hover/focus lift
  border-strong: '#3e5473'          # alias of border-focus (cross-spine shorthand — same value, keep in sync)
  # Text ramp
  text-primary: '#e6edf3'           # --text-primary
  text-secondary: '#8b9bb0'         # --text-secondary
  text-muted: '#57657a'             # --text-muted · meta/labels register
  text-dim: '#3d4959'               # --text-dim · faintest register (footer, stale, empty ticker)
  text-faint: '#3d4959'             # alias of text-dim (cross-spine shorthand — same value, keep in sync)
  text-bright: '#ffffff'            # canonized from the as-built #fff hover literals — hover text on tinted fills only
  # Status triads (solid / 12% bg / 35% border)
  status-green: '#2ea043'
  status-green-bg: 'rgba(46, 160, 67, 0.12)'
  status-green-border: 'rgba(46, 160, 67, 0.35)'
  status-red: '#f85149'
  status-red-bg: 'rgba(248, 81, 73, 0.12)'
  status-red-border: 'rgba(248, 81, 73, 0.35)'
  status-amber: '#d29922'
  status-amber-bg: 'rgba(210, 153, 34, 0.12)'
  status-amber-border: 'rgba(210, 153, 34, 0.35)'
  status-neutral: '#7d8590'
  status-neutral-bg: 'rgba(125, 133, 144, 0.12)'
  status-neutral-border: 'rgba(125, 133, 144, 0.3)'   # 0.3, not 0.35 — as-built
  # Accent
  accent-blue: '#58a6ff'            # --accent-blue · interactive accent
  accent: '#58a6ff'                 # alias of accent-blue (cross-spine shorthand — same value, keep in sync)
  accent-blue-bg: 'rgba(88, 166, 255, 0.1)'
  accent-blue-border: 'rgba(88, 166, 255, 0.3)'
  accent-bg: 'rgba(88, 166, 255, 0.1)'      # alias of accent-blue-bg
  accent-border: 'rgba(88, 166, 255, 0.3)'  # alias of accent-blue-border
  # Diff staff
  diff-add-text: '#3fb950'          # --diff-add-text · addition lines and addition counts
  diff-add: '#3fb950'               # alias of diff-add-text
  diff-add-bg: 'rgba(46, 160, 67, 0.15)'
  diff-del-text: '#f85149'          # --diff-del-text · deletion lines and deletion counts
  diff-del: '#f85149'               # alias of diff-del-text
  diff-del-bg: 'rgba(248, 81, 73, 0.15)'
  diff-hunk-text: '#79c0ff'         # --diff-hunk-text · hunk/range headers
  diff-meta: '#79c0ff'              # alias of diff-hunk-text; meta rows without a hunk value use text-muted
  diff-hunk-bg: 'rgba(88, 166, 255, 0.08)'
  diff-meta-bg: 'rgba(88, 166, 255, 0.08)'  # alias of diff-hunk-bg
typography:
  base:
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 13px
    lineHeight: '1.5'
  brand-title:
    fontSize: 1.125rem
    fontWeight: '600'
    letterSpacing: -0.02em
  brand-subtitle:
    fontSize: 0.875rem
    fontWeight: '400'
  section-title:
    fontSize: 0.8125rem
    fontWeight: '600'
    letterSpacing: 0.06em
  title:
    fontSize: 0.875rem
    fontWeight: '600'
  body:
    fontSize: 0.8125rem
    lineHeight: '1.4'
  control:
    fontSize: 0.75rem
  micro:
    fontSize: 0.6875rem
  micro-xs:
    fontSize: 0.625rem
rounded:
  DEFAULT: 0
  sm: 2px
  full: 999px    # toggle track; circles (knob, help, pulse dot) draw 50% direct — see Shapes
spacing:
  2xs: 0.1rem        # micro paddings — commit-sha, repo tags, event chips
  xs: 0.15rem        # badge / ref-spec vertical padding
  sm: 0.25rem        # chip vertical padding, tab padding-x
  sm-plus: 0.375rem  # file-row internals, card action gap
  md: 0.5rem         # chip/button gaps, intent padding-y
  md-plus: 0.625rem  # banner padding-y, conflict-card inner gap
  lg: 0.75rem        # card internals, ticker gap
  lg-plus: 0.875rem  # header controls gap, header block spacing
  xl: 1rem           # card padding-y, banner padding-x, modal body
  xl-plus: 1.125rem  # card padding-x
  2xl: 1.25rem       # grid gap, banner block spacing, modal padding
  2xl-plus: 1.5rem   # container padding-y, modal backdrop padding
  3xl: 2rem          # section bottom margins, container padding-x
  3xl-plus: 2.5rem   # empty-state padding-y
  4xl: 3rem          # footer margin-top
  5xl: 4rem          # container bottom padding
components:
  button-land:
    background: '{colors.accent-blue-bg}'
    border: '1px solid {colors.accent-blue-border}'
    foreground: '{colors.accent-blue}'
    fontWeight: '500'
    fontSize: '{typography.micro.fontSize}'
    padding: 0.25rem 0.5rem
    radius: '{rounded.DEFAULT}'
    hover-background: 'rgba(88, 166, 255, 0.2)'
    hover-border: '1px solid {colors.accent-blue}'
    hover-foreground: '{colors.text-bright}'
  button-land-confirming:
    background: '{colors.status-amber-bg}'
    border: '1px solid {colors.status-amber-border}'
    foreground: '{colors.status-amber}'
    hover-background: 'rgba(210, 153, 34, 0.25)'
    hover-foreground: '{colors.text-bright}'
  button-ghost:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-subtle}'
    foreground: '{colors.text-secondary}'
    fontSize: '{typography.micro.fontSize}'
    padding: 0.25rem 0.5rem
    radius: '{rounded.DEFAULT}'
    transition: '0.12s ease'
    hover-background: '{colors.bg-surface-elevated}'
    hover-border: '1px solid {colors.border-default}'
    hover-foreground: '{colors.text-primary}'
    disabled-opacity: 0.5
  button-refresh:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-default}'
    foreground: '{colors.text-primary}'
    fontSize: '{typography.control.fontSize}'
    padding: 0.3rem 0.75rem
    radius: '{rounded.DEFAULT}'
    hover-background: '{colors.bg-surface-elevated}'
    hover-border: '1px solid {colors.border-focus}'
    disabled-opacity: 0.5
  proposal-card:
    background: '{colors.bg-card}'
    border: '1px solid {colors.border-subtle}'
    padding: 1rem 1.125rem
    gap: '{spacing.lg}'
    radius: '{rounded.DEFAULT}'
    hover-border: '1px solid {colors.border-default}'
    header-divider: '1px solid {colors.border-subtle}'
    repo-title: '{colors.accent-blue}'
    transition: 'border-color 0.15s ease, opacity 0.15s ease'
  proposal-card-landed:
    opacity: 0.55
    hover-opacity: 0.85
    border: '1px dashed {colors.border-subtle}'
    background: '{colors.bg-surface}'
  conflict-card:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-default}'
    padding: 1rem 1.125rem
    gap: 0.625rem
    radius: '{rounded.DEFAULT}'
    shadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
    pair-well-background: '{colors.bg-inset}'
  conflict-card-red:
    severity-border: '4px solid {colors.status-red}'
    wash: 'linear-gradient(90deg, rgba(248, 81, 73, 0.05), {colors.bg-surface} 120px)'
    kinds: 'text-conflict · modify/delete · add/add'
  conflict-card-amber:
    severity-border: '4px solid {colors.status-amber}'
    wash: 'linear-gradient(90deg, rgba(210, 153, 34, 0.05), {colors.bg-surface} 120px)'
    kinds: 'undetermined'
  conflict-card-neutral:
    severity-border: '4px solid {colors.status-neutral}'
    kinds: 'mergeable · identical-add · both-removed'
  badge:
    padding: 0.15rem 0.5rem
    fontSize: '{typography.micro.fontSize}'
    letterSpacing: 0.02em
    border: '1px solid transparent'
    radius: '{rounded.DEFAULT}'
  badge-red:
    background: '{colors.status-red-bg}'
    border: '1px solid {colors.status-red-border}'
    foreground: '{colors.status-red}'
  badge-amber:
    background: '{colors.status-amber-bg}'
    border: '1px solid {colors.status-amber-border}'
    foreground: '{colors.status-amber}'
  badge-neutral:
    background: '{colors.status-neutral-bg}'
    border: '1px solid {colors.status-neutral-border}'
    foreground: '{colors.status-neutral}'
  badge-secret:
    background: 'rgba(210, 153, 34, 0.15)'   # as-built literal; drift vs status-amber-bg 0.12 — align on next touch
    border: '1px solid {colors.status-amber-border}'
    foreground: '{colors.status-amber}'
  badge-clean:
    background: '{colors.status-green-bg}'
    border: '1px solid {colors.status-green-border}'
    foreground: '{colors.status-green}'
  summary-chip:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-subtle}'
    padding: 0.25rem 0.625rem
    minHeight: 28px
    fontSize: '{typography.control.fontSize}'
    label-foreground: '{colors.text-muted}'
    label-fontSize: '{typography.micro.fontSize}'
    label-letterSpacing: 0.04em
    value-foreground: '{colors.text-primary}'
    value-fontWeight: '600'
  summary-chip-alert:
    background: '{colors.status-red-bg}'
    border: '1px solid {colors.status-red-border}'
    value-foreground: '{colors.status-red}'
  summary-chip-warn:
    background: '{colors.status-amber-bg}'
    border: '1px solid {colors.status-amber-border}'
    value-foreground: '{colors.status-amber}'
  summary-chip-clean:
    background: '{colors.status-green-bg}'
    border: '1px solid {colors.status-green-border}'
    value-foreground: '{colors.status-green}'
  ticker:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-subtle}'
    padding: 0.35rem 0.75rem
    label-fontSize: '{typography.micro.fontSize}'
    label-foreground: '{colors.text-muted}'
    label-letterSpacing: 0.05em
    event-fontSize: '{typography.control.fontSize}'
    event-foreground: '{colors.text-secondary}'
    event-type-foreground: '{colors.accent-blue}'
    event-type-background: '{colors.accent-blue-bg}'
    max-rows: 8
  ticker-pulse:
    width: 6px
    height: 6px
    radius: 50%
    background: '{colors.status-green}'
    opacity: 0.8
    stale-background: '{colors.text-dim}'
  modal:
    backdrop: 'rgba(4, 7, 11, 0.8)'
    backdrop-padding: '{spacing.2xl-plus}'
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-default}'
    radius: '{rounded.DEFAULT}'
    maxWidth: 960px
    maxHeight: 85vh
    shadow: '0 16px 40px rgba(0, 0, 0, 0.5)'
    header-background: '{colors.bg-surface-elevated}'
    header-divider: '1px solid {colors.border-subtle}'
    body-padding: '{spacing.2xl}'
  diff-viewer:
    background: '{colors.bg-inset}'
    border: '1px solid {colors.border-subtle}'
    fontSize: '{typography.control.fontSize}'
    lineHeight: '1.45'
    line-add-background: '{colors.diff-add-bg}'
    line-add-foreground: '{colors.diff-add-text}'
    line-del-background: '{colors.diff-del-bg}'
    line-del-foreground: '{colors.diff-del-text}'
    line-hunk-background: '{colors.diff-hunk-bg}'
    line-hunk-foreground: '{colors.diff-hunk-text}'
    line-meta-foreground: '{colors.text-muted}'
  merge-pane:
    background: '{colors.bg-inset}'
    border: '1px solid {colors.border-subtle}'
    padding: 0.75rem 1rem
    minHeight: 200px
    maxHeight: 50vh
    conflict-border: '1px solid {colors.status-red-border}'
    tab-active-background: '{colors.bg-surface-elevated}'
  intent-block:
    background: '{colors.bg-surface}'
    rule: '2px solid {colors.accent-blue}'
    padding: 0.5rem 0.75rem
    fontSize: '{typography.body.fontSize}'
    fontWeight: '500'
    lineHeight: '1.4'
    label-foreground: '{colors.text-muted}'
    label-fontSize: '{typography.micro.fontSize}'
  commit-sha:
    background: '{colors.bg-surface-elevated}'
    border: '1px solid {colors.border-subtle}'
    foreground: '{colors.text-primary}'
    fontWeight: '600'
    fontSize: '{typography.micro.fontSize}'
    padding: 0.1rem 0.35rem
  file-row:
    background: '{colors.bg-surface}'
    border: '1px solid {colors.border-subtle}'
    padding: 0.375rem 0.625rem
    fontSize: '{typography.control.fontSize}'
    indicator-radius: '{rounded.sm}'
    indicator-fontSize: '{typography.micro-xs.fontSize}'
    indicator-added: '{colors.diff-add-text} on {colors.diff-add-bg}'
    indicator-modified: '{colors.accent-blue} on {colors.accent-blue-bg}'
    indicator-removed: '{colors.diff-del-text} on {colors.diff-del-bg}'
    secret-key-tag-background: 'rgba(210, 153, 34, 0.12)'
    secret-key-tag-border: '1px solid rgba(210, 153, 34, 0.25)'
  landed-banner:
    background: '{colors.bg-inset}'
    border: '1px dashed {colors.border-subtle}'
    padding: 0.75rem 1rem
    foreground: '{colors.text-muted}'
    fontSize: '{typography.control.fontSize}'
  empty-state:
    background: '{colors.bg-surface}'
    border: '1px dashed {colors.border-subtle}'
    padding: 2.5rem 1rem
    title-fontSize: '{typography.title.fontSize}'
    title-foreground: '{colors.text-secondary}'
    desc-fontSize: '{typography.control.fontSize}'
    desc-foreground: '{colors.text-muted}'
  action-banner:
    border: '1px solid {colors.border-default}'
    padding: 0.625rem 1rem
    fontSize: '{typography.body.fontSize}'
    close-foreground: 'currentColor'
    success-background: '{colors.status-green-bg}'
    success-border: '1px solid {colors.status-green-border}'
    success-foreground: '{colors.status-green}'
    error-background: '{colors.status-red-bg}'
    error-border: '1px solid {colors.status-red-border}'
    error-foreground: '{colors.status-red}'
    warn-background: '{colors.status-amber-bg}'
    warn-border: '1px solid {colors.status-amber-border}'
    warn-foreground: '{colors.status-amber}'
  connection-banner:
    background: '{colors.status-red-bg}'
    border: '1px solid {colors.status-red-border}'
    foreground: '{colors.status-red}'
    fontSize: '{typography.body.fontSize}'
    padding: 0.625rem 1rem
    action-border: '1px solid {colors.status-red-border}'
    action-foreground: '{colors.status-red}'
    action-hover-background: 'rgba(248, 81, 73, 0.2)'
  loading-indicator:
    foreground: '{colors.text-muted}'
    fontSize: '{typography.control.fontSize}'
  toggle-input:
    width: 2rem
    height: 1.125rem
    radius: '{rounded.full}'
    background: '{colors.bg-surface-elevated}'
    border: '1px solid {colors.border-default}'
    knob-size: 0.875rem
    knob-radius: 50%
    knob-background: '{colors.text-muted}'
    checked-background: '{colors.status-green-bg}'
    checked-border: '1px solid {colors.status-green-border}'
    checked-knob-background: '{colors.status-green}'
  button-tour-header:
    background: '{colors.accent-blue-bg}'
    border: '1px solid {colors.accent-blue-border}'
    foreground: '{colors.accent-blue}'
    fontSize: '{typography.control.fontSize}'
    padding: 0.3rem 0.75rem
    radius: '{rounded.DEFAULT}'
    hover-background: 'rgba(88, 166, 255, 0.2)'
    hover-border: '1px solid {colors.accent-blue}'
    hover-foreground: '{colors.text-bright}'
  risk-chip:
    status: planned
    routine: '{colors.status-green} on {colors.status-green-bg}'
    focused: '{colors.status-amber} on {colors.status-amber-bg}'
    senior-security: '{colors.status-red} on {colors.status-red-bg}'
    note: 'badge anatomy at {typography.micro.fontSize}; score: Routine / Focused / Senior-security'
  intent-verification-badge:
    status: planned
    supports: '{colors.status-green} on {colors.status-green-bg}'
    contradicts: '{colors.status-red} on {colors.status-red-bg}'
    insufficient: '{colors.status-neutral} on {colors.status-neutral-bg}'
    note: 'badge anatomy; labels: intent verified / intent mismatch / insufficient'
  collision-chip:
    status: planned
    soft-collision: '{colors.status-amber} on {colors.status-amber-bg}'
    note: 'advisory register — never {colors.status-red}; hard conflicts stay on conflict-card red'
---

## Brand & Style

NextGit is the convergence surface for agent fleets: "the place where many AI agents work on your code at once — you see everything, catch the collisions, ship what you want" (tour voice). The visual identity is **a tool an engineer trusts**: near-black canvas (`{colors.bg-app}`, the `#0a0e14` range), tone-stepped surfaces, 1px hairline borders, monospace type at a small consistent size, generous whitespace, and color reserved exclusively for state — never for decoration. No emoji. No heavy gradients. The posture is calm and institutional while the content is loud: concurrent agents, collisions, landings. The UI stays quiet so the signal is carried by order and color discipline, not ornament.

This is an operator's instrument, not a dashboard to be admired. Every screen answers three questions in the same order: what is the set, what collides, what can land. The layout delivers them in that order, top to bottom, on one canvas — no tab-hopping, no per-item paging (the whole set at a glance is the product).

Editorial voice: lowercase, terse, operator-addressed in the app ("refresh", "dismiss", "landing..."); the tour is a plain-English teacher ("One click folds the proposal onto the main branch on the server. No local git clone required."). Labels are uppercase micro-caps; sentences are short; jargon (convergence, proposal, collision) is defined once, then used precisely. The success register is quiet too: "landed — nothing pending", not confetti.

Near-term extension posture (judge layer): risk, intent-verification, and semantic-collision chips join the card in the same badge/chip language; collision emphasis must not introduce new hues. The judge advises; code decides; humans still own irreversible acts — the visuals carry that by keeping advisory signals amber/neutral and never dressing advice as a red hard conflict.

[DRAFT PEER — not canon] The draft product brief (`.working/brief-extract.md` §2/§4) reinforces this posture — "triage a fleet's work on one screen in minutes", "What users feel: *convergent*" — while carrying no visual directives of its own; its "fleet view" coinage is not adopted here (naming stays per the memlog: the convergence surface; brief-extract §6.5 flags the term unratified). The [ASSUMPTION] tags stand untouched by it.

[ASSUMPTION] Dark-only: the build ships a single dark theme on `{colors.bg-app}`; no light mode exists and none is specified here — a light mode needs an explicit future decision. [ASSUMPTION] Form factor: web-first single-surface browser app; a future Agent Office 3D client consumes the platform API and is out of scope for this spine.

## Colors

Two laws govern the palette. **Law 1 — color means state.** Four semantic triads (green/clean, red/conflict, amber/warn-secret-confirm, neutral/mergeable), one accent (blue = actionable/identity), and one diff staff (add/del/hunk). Nothing is colored for beauty. **Law 2 — depth is tonal.** Surfaces step one level when their role changes (hover, elevation) — never by shadow, never by hue.

### Backgrounds (the ramp)

- **`{colors.bg-app}` `#0a0e14`** — the page canvas. Nothing else uses it; panels must lift off it by tone.
- **`{colors.bg-surface}` `#0f141c`** — panels and inner blocks: summary chips, ticker section, conflict cards, file rows, intent block, empty states, the modal window itself. One step up from the page.
- **`{colors.bg-surface-elevated}` `#141b24`** — the hover/interaction step: refresh hover, ghost-button hover, modal header, repo tags. If something is temporarily "warm", it is this.
- **`{colors.bg-card}` `#111822`** — proposal cards, and only proposal cards. The card register is distinct from panel register on purpose: the set view must read as objects, not panels.
- **`{colors.bg-card-hover}` `#151e2b`** — declared in the source stylesheet and **unused** as of 2026-10-05. Reserved for a future card hover fill; today a card hover lifts its border to `{colors.border-default}` instead. Adopt on decision, not by default.
- **`{colors.bg-subtle}` `#182230`** — the heavier hover step above elevated: modal close hover, tour control hover.
- **`{colors.bg-inset}` `#070a0e`** — the deepest wells: conflict pair rows, landed banner, diff viewer, merge pane. Insets are *content* wells; never a page background.

### Borders

- **`{colors.border-subtle}` `#1c2634`** — the default 1px hairline everywhere: cards, chips, ticker, header underline, footer rule, file rows. If in doubt, this one.
- **`{colors.border-default}` `#253346`** — the lift: conflict cards, modal, card hover state, control buttons, toggle.
- **`{colors.border-focus}` `#3e5473`** — interaction lift only: refresh hover, help hover, annotated-region hover. Never a resting border. (Alias: `{colors.border-strong}`.)

### Text ramp

- **`{colors.text-primary}` `#e6edf3`** — body and base text. ≈16:1 on `{colors.bg-app}`, ≈15:1 on `{colors.bg-card}`.
- **`{colors.text-secondary}` `#8b9bb0`** — secondary labels: brand subtitle, section titles, idle button labels, pair endpoints' context. ≈6.3–6.8:1 across surfaces.
- **`{colors.text-muted}` `#57657a`** — the meta/label register: chip labels, stats, timestamps, pair regions, diff meta rows. ≈3.0–3.4:1 — see the contrast gap below; confine to meta, never body copy.
- **`{colors.text-dim}` `#3d4959`** — the faintest register: footer, ticker-empty, stale pulse. ≈2:1 — ambient only, never load-bearing. (Alias: `{colors.text-faint}`.)
- **`{colors.text-bright}` `#ffffff`** — canonized from the as-built `#fff` hover literals (land button, confirming land, tour header/controls). Reserved for hover text on tinted fills (≈12–13:1 there); never a resting text color. This resolves the off-palette literal: it was always the top of the ramp, it just had no token.

### Status triads

Each status is a triad: solid text/accent + ~12% background + ~35% border (neutral border runs 0.3). Use the triad as a set — a status colored on one channel but not the others reads as a mistake.

- **`{colors.status-green}` `#2ea043`** — clean, landed, success, clean merges, clean pairs. ≈5.7:1 on `{colors.bg-app}`, ≈5:1 on its own tinted banner.
- **`{colors.status-red}` `#f85149`** — conflict, error, blocked land, conflicting pairs, severity-red conflict cards. ≈5.8:1 on app, ≈5.2:1 on its tinted banner.
- **`{colors.status-amber}` `#d29922`** — warn, secret-typed, confirm states, undetermined severity. ≈7.7:1 on app, ≈6.5:1 on its tinted banner. Amber has a second job: secrets always read amber (`secret-typed` badge, secret key tags) — the badge literal runs 15% bg (drift vs the 12% triad; align on next touch).
- **`{colors.status-neutral}` `#7d8590`** — landed badges, severity-neutral conflict bands, mergeable signals. ≈5.2:1 on app.

### Accent

- **`{colors.accent-blue}` `#58a6ff`** — the interactive/identity accent: proposal repo titles, intent rule, event-type chips, ref-spec values, the Land button, help hover, tour active steps. ≈7.6:1 on app. Blue means "actionable or identity" — it never means success.

### Diff staff

- **`{colors.diff-add-text}` `#3fb950`** on **`{colors.diff-add-bg}`** — addition lines and addition counts. ≈6.6:1 on its line fill. Note the deliberate two-green split: diff green is *brighter* than `{colors.status-green}` for line-level legibility; do not swap them. (Alias: `{colors.diff-add}`.)
- **`{colors.diff-del-text}` `#f85149`** on **`{colors.diff-del-bg}`** — deletions. Shares the red hex with `{colors.status-red}` on purpose. ≈5.1:1 on its fill. (Alias: `{colors.diff-del}`.)
- **`{colors.diff-hunk-text}` `#79c0ff`** on **`{colors.diff-hunk-bg}`** — hunk/range headers. ≈9.3:1. Context rows without a hunk value (`line-meta`) use `{colors.text-muted}`. (Alias: `{colors.diff-meta}` / `{colors.diff-meta-bg}`.) The hunk tokens exist only in the triage stylesheet; the tour stylesheet omits them and has no hunk register — keep the triage definition as canon.

### Contrast notes (load-bearing pairs)

[ASSUMPTION] WCAG AA is the contrast target. Computed from the as-built hex values:

| Pair | Ratio | Verdict |
|---|---|---|
| `{colors.text-primary}` on app / surface / card | ≈16.4 / 15.6 / 15.1 | AAA |
| `{colors.text-secondary}` on app / surface / card | ≈6.8 / 6.5 / 6.3 | AA |
| `{colors.accent-blue}` on app / card | ≈7.6 / 7.1 | AA+ |
| status solids on app | ≈5.2–7.7 | AA |
| status solids on their own tinted banners | ≈5.0–6.5 | AA |
| diff text on its line fills | ≈5.1–9.3 | AA |
| `{colors.text-bright}` on tinted hover fills | ≈12–13 | AAA |
| **`{colors.text-muted}` on app / surface / card** | **≈3.3 / 3.1 / 3.1** | **below 4.5 — gap** |
| **`{colors.text-dim}` on app / surface** | **≈2.1 / 2.0** | **below 4.5 — gap** |

The two flagged gaps are real as-built findings under the AA assumption: the meta and faint registers fail AA for small text. They are confined by rule (meta labels, ambient chrome only); raising them is a pending decision, and their use must not be extended to body copy or state messaging in the meantime.

Off-palette findings from the source: the `#fff` hover literal (resolved — `{colors.text-bright}`); `#ffb4af` in the tour's conflict-region text (tour-only one-off; drift — replace with the `{colors.status-red}` family when next touched); hover tint literals (accent 0.2, red 0.2, amber 0.25, green 0.22) and the two 5% severity washes are intentional recipes, not new tokens. Never: light backgrounds, novelty hues, gradient fills beyond the 5% severity wash, color as decoration.

## Typography

[ASSUMPTION] Mono-only is canon until a decision says otherwise. The entire UI renders in one stack — `{typography.base.fontFamily}` (ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace) — at a **13px base** (html/body root), line-height 1.5, `-webkit-font-smoothing: antialiased`. A sans stack is declared in the source (`--font-sans`) but never referenced; treat it as dead code, not an invitation. Every rem in this spine is an expression of that 13px root.

The ramp, by role:

| Role | Size | Weight / tracking | Used for |
|---|---|---|---|
| `{typography.brand-title}` | 1.125rem | 600 / −0.02em | "NextGit" in the header |
| `{typography.title}` | 0.875rem | 600 | modal titles, proposal repo titles (colored `{colors.accent-blue}`), empty-state titles (shown `{colors.text-secondary}`, weight inherited) |
| `{typography.brand-subtitle}` | 0.875rem | 400 | "your agents' work, all in one place" |
| `{typography.section-title}` | 0.8125rem | 600 / 0.06em | uppercase section heads ("Convergence Conflicts", "Concurrent Proposals") |
| `{typography.body}` | 0.8125rem | 400 (500 at lh 1.4 for intent) | banners, ref-spec, proposal intent |
| `{typography.control}` | 0.75rem | defaults | controls, buttons, chips, ticker events, file rows, diff/merge panes, loading, tour copy |
| `{typography.micro}` | 0.6875rem | defaults | chip labels (uppercase, 0.04em), ticker labels (0.05em) and timestamps, file counts, footer, pair regions, commit shas |
| `{typography.micro-xs}` | 0.625rem | defaults | file status indicators, secret key tags |

Rules: one size per role — no fluid type, no display sizes beyond the brand title. Uppercase is reserved for micro-labels and section titles (tracked 0.04–0.06em); everything else is sentence case. The lowercase editorial voice is copy, not CSS: control labels keep their literal casing ("refresh", "dismiss", "landing..."). The tour adds one larger title (0.9375rem) for its details pane — tour-local; do not import it into the app.

## Layout & Spacing

Spacing is rem-based on the 13px root. The scale runs `{spacing.2xs}` (0.1rem) → `{spacing.5xl}` (4rem), listed step by step in the frontmatter; micro paddings below it (0.05–0.075rem) serve the status indicators. Anchors: `{spacing.sm-plus}` (0.375rem) for file-row internals, `{spacing.md}` (0.5rem) for chip/button gaps, `{spacing.lg}` (0.75rem) for card internals and ticker gaps, `{spacing.2xl}` (1.25rem) for section blocks and banners, `{spacing.3xl}` (2rem) for section bottom margins, `{spacing.5xl}` (4rem) for the page's bottom breath.

Shell: `.app-container` max-width **1440px**, centered, padding 1.5rem 2rem 4rem. Proposals render in `repeat(auto-fill, minmax(360px, 1fr))` with 1.25rem gap — the 360px minimum is the layout's only "breakpoint": below it the set reflows to a single column. There are **no media queries in the triage stylesheet**; fluidity comes from the grid and flex-wrap. (The tour adds two tour-local breakpoints, 768px and 640px, for its simulation grids — tour-only.)

Vertical rhythm is fixed and ordered: header (1px bottom hairline, 1.25rem below) → optional banners (1.25rem each) → ticker (1.25rem below) → Conflicts section (2rem below) → Proposals section (2rem below) → footer (3rem above, 1px top hairline, 1rem padding). One canvas: everything on one page, top to bottom. No paging, no tabs.

Motion: 0.15s ease is the standard transition (banners, refresh, cards, toggles); 0.12s ease on card action buttons. Only background, border-color, color, opacity, and the toggle's knob transform animate. Nothing bounces, nothing slides in.

## Elevation & Depth

Depth is hairline + tone, not shadow. Exactly **two shadows exist**, by decree:

- `.conflict-card` — `0 2px 8px rgba(0, 0, 0, 0.2)`. The conflict map deserves a lifted-plane cue; nothing else in the page gets one.
- `.modal-window` — `0 16px 40px rgba(0, 0, 0, 0.5)`, over a `rgba(4, 7, 11, 0.8)` backdrop. A modal is the one true overlay; its shadow is deep because the backdrop is deep.

Everything else earns depth two ways: (1) **step the tone** — app → surface → card/elevated, with inset for wells; (2) **step the border** — subtle at rest, default on hover/emphasis, focus on interaction. The only gradients in the system are the two severity washes on red/amber conflict cards: `linear-gradient(90deg, rgba(triad, 0.05), {colors.bg-surface} 120px)` — a left-edge bloom that fades into the card, never a fill. No glass, no blur, no glow, no ambient shadow "for polish". If a surface feels flat, the answer is a tone step, not a shadow.

## Shapes

Square by default — deliberately enforced. Cards, chips, badges, buttons, banners, modals, file rows, panes, and tags are corner-zero (radius `{rounded.DEFAULT}` = 0). The shape language is terminals and institutional tooling; nothing about convergence should look cute. [ASSUMPTION] Near-square is canon; a departure needs an explicit decision.

The exceptions — all six of them, each with a physical reason:

1. Toggle track — `{rounded.full}` (999px). It must read as a switch.
2. Toggle knob — 50%. It is a knob.
3. Tour help button "?" — 50%. It is a circle control.
4. Ticker pulse dot — 50%. It is a dot.
5. File status indicator — `{rounded.sm}` (2px). A near-square tag; the 2px softening marks it as a transient annotation against the file row's 1px frame.
6. Tour annotated-region — `{rounded.sm}` (2px), tour-only. A hover target, softened to read as inspectable.

Rule: radius appears only where a circle is the physical metaphor (switch, knob, dot, round control) or where 2px marks a transient/target state. Never round cards, buttons, chips, badges, modals, or panes. Nested elements never round inside square parents.

## Components

Every component below is specified from the as-built stylesheets; state deltas are exact.

### Buttons

- **Land (`{components.button-land}`)** — "Land into demo". Accent triad at rest: `{colors.accent-blue-bg}` fill, 1px `{colors.accent-blue-border}`, `{colors.accent-blue}` text, weight 500, micro size, square. Hover: fill deepens to `rgba(88, 166, 255, 0.2)`, border goes solid `{colors.accent-blue}`, text flips to `{colors.text-bright}`. This is the one directional button in a card: it is the only element that flips text to pure white on hover, and the flip is the "armed" signal.
- **Land, confirming (`{components.button-land-confirming}`)** — "confirm land?". The same anatomy flipped to the amber triad: `{colors.status-amber-bg}` / `{colors.status-amber-border}` / `{colors.status-amber}`; hover deepens to `rgba(210, 153, 34, 0.25)` with `{colors.text-bright}` text. Amber means "a human decision is mid-flight"; it must never appear on the resting Land button.
- **Ghost (`{components.button-ghost}`)** — the card-action register: "preview merge", "view diff", "cancel". `{colors.bg-surface}` fill, 1px `{colors.border-subtle}`, `{colors.text-secondary}` text, micro, square, 0.12s transitions. Hover: `{colors.bg-surface-elevated}` + `{colors.border-default}` + `{colors.text-primary}`. Disabled: 50% opacity, not-allowed. Cancel is the transparent variant (no fill) that hovers from `{colors.text-muted}` to `{colors.text-primary}`. The family in full: `preview merge` and `view diff` (per file, and only for non-secret files) in the ghost fill; `cancel` in the transparent variant; `Land into demo` is the one non-ghost action.
- **Refresh (`{components.button-refresh}`)** — header control: `{colors.bg-surface}` / `{colors.border-default}` / `{colors.text-primary}`, control size, padding 0.3rem 0.75rem. Hover lifts fill + `{colors.border-focus}`; disabled 50%. The "?" help button shares this anatomy as a 1.5rem circle (see Shapes).
- **Header controls** — `Start the tour` (`{components.button-tour-header}`): accent-tinted link button at control size (padding 0.3rem 0.75rem); hover deepens the fill to `rgba(88, 166, 255, 0.2)`, border goes solid `{colors.accent-blue}`, text flips `{colors.text-bright}`. Auto-refresh toggle (`{components.toggle-input}`): a 2rem × 1.125rem pill (`{rounded.full}`), `{colors.bg-surface-elevated}` track framed in `{colors.border-default}`, 0.875rem `{colors.text-muted}` knob at 50%; checked flips the track to `{colors.status-green-bg}`, the border to `{colors.status-green-border}`, and the knob to `{colors.status-green}` while translating 0.875rem.
- **Land-flow disabled state** — while a repo is in flight the card shows a single disabled "landing..." button (50% opacity); the flow has no spinner — the disabled label is the progress affordance.

### Proposal card (`{components.proposal-card}`)

The central object. `{colors.bg-card}` fill, 1px `{colors.border-subtle}` border, padding 1rem 1.125rem, 0.75rem internal gap, square; header row (repo title in `{colors.accent-blue}` + badge slot) separated by a 1px `{colors.border-subtle}` bottom hairline.

Anatomy top to bottom: header → action row → **intent block** → stats (files, `+additions` in `{colors.diff-add-text}`, `−deletions` in `{colors.diff-del-text}`, micro) → file rows. State deltas:

- **Resting → hover**: border lifts to `{colors.border-default}` (0.15s ease). No fill change, no lift, no shadow.
- **Landing** (`isLanding`): actions collapse to the single disabled ghost "landing..." button.
- **Confirming** (`isConfirming`): actions show `{components.button-land-confirming}` ("confirm land?") + the cancel ghost.
- **Landed** (`{components.proposal-card-landed}`): 0.55 opacity (0.85 on hover), 1px **dashed** `{colors.border-subtle}` border, fill drops to `{colors.bg-surface}`, a `badge-neutral` "landed" chip enters the header, and the stats/files block is replaced by the landed banner: "landed — nothing pending" / "All changes from this branch have been merged into baseline." Dashed = terminal/inert; this is the system's convention for "done, keep, don't touch".

File rows (`{components.file-row}`): `{colors.bg-surface}`, 1px `{colors.border-subtle}`, padding 0.375rem 0.625rem, control size; path truncates with ellipsis and carries a title tooltip; status indicator is a 2px-radius micro-xs tag — added `{colors.diff-add-text}` on `{colors.diff-add-bg}`, modified `{colors.accent-blue}` on `{colors.accent-blue-bg}`, removed `{colors.diff-del-text}` on `{colors.diff-del-bg}`; counts colored in the diff red/green. Secret-typed rows: a `badge-secret` "secret-typed" chip, key-name tags (0.12/0.25 amber literals, micro-xs), and **no "view diff" button** — the absence is the affordance.

### Conflict card (`{components.conflict-card}`)

The collision map's unit. `{colors.bg-surface}`, 1px `{colors.border-default}`, padding 1rem 1.125rem, 0.625rem gap, square, and the system's only resting shadow (`0 2px 8px rgba(0,0,0,0.2)`). Header: file name (600, `{colors.text-primary}`) + kind badge; "proposals:" repo tags (`{colors.bg-surface-elevated}`, 1px `{colors.border-subtle}`); pair rows sit in an `{colors.bg-inset}` well with `{colors.border-subtle}` frame — endpoints `agent-1 ↔ agent-2` in `{colors.text-primary}`, pair kind in `{colors.text-secondary}`, region `(base: NL, agent-1: NL, agent-2: NL)` in `{colors.text-muted}` micro.

Severity variants (mapping is code-owned):

- **Red (`{components.conflict-card-red}`)** — `text-conflict`, `modify/delete`, `add/add`. 4px left band `{colors.status-red}` + the red 5% gradient wash + `badge-red` kind chip.
- **Amber (`{components.conflict-card-amber}`)** — `undetermined`. 4px `{colors.status-amber}` band + amber wash + `badge-amber`.
- **Neutral (`{components.conflict-card-neutral}`)** — `mergeable`, `identical-add`, `both-removed`. 4px `{colors.status-neutral}` band, no wash, `badge-neutral`.

The 4px band is the only place borders exceed 1px outside the intent block; it is the map's severity spine.

### Badges (`{components.badge}` + variants)

Universal state chip: padding 0.15rem 0.5rem, micro size, 0.02em tracking, square, 1px border. Five variant triads: `{components.badge-red}` (conflicts, errors, failed land), `{components.badge-amber}` (warn, undetermined, not-found), `{components.badge-neutral}` (landed, mergeable, default), `{components.badge-secret}` ("secret-typed" — amber with the 15%-bg literal), `{components.badge-clean}` (success, clean merge, diff-added files). Placement as built: action banners, conflict-card kind, proposal header "landed", file rows "secret-typed", modal header status, merge status bar.

### Summary chips (`{components.summary-chip}`)

Five count chips in the header: "proposals", "shared files", "conflicting pairs", "changed files", "clean pairs". `{colors.bg-surface}` / 1px `{colors.border-subtle}` / min-height 28px; label micro uppercase `{colors.text-muted}` at 0.04em; value control-size `{colors.text-primary}` weight 600. State by count: conflicting pairs > 0 → `{components.summary-chip-alert}` (red triad, value red); shared files > 0 → `{components.summary-chip-warn}` (amber); clean pairs > 0 → `{components.summary-chip-clean}` (green). A zero count stays neutral even when its category is red-worthy — color reports what is present, not what could exist.

### Ticker (`{components.ticker}`)

One live row, ≤8 events, newest first: `{colors.bg-surface}` / `{colors.border-subtle}`, padding 0.35rem 0.75rem, horizontal scroll with hidden scrollbar. Label "convergence events" micro uppercase `{colors.text-muted}` at 0.05em, preceded by the pulse dot (`{components.ticker-pulse}`: 6px, 50%, `{colors.status-green}` at 0.8 opacity). Event: type chip in `{colors.accent-blue}` on `{colors.accent-blue-bg}` (micro), repo in `{colors.text-primary}`, time in `{colors.text-muted}` (micro), the row itself `{colors.text-secondary}` control-size. Stale (events fetch failing): pulse drops to `{colors.text-dim}` and **keeps the last events on screen** — staleness is a signal, not an emptying. Empty: "listening for convergence events..." in `{colors.text-dim}` control-size.

### Modal (`{components.modal}`)

Backdrop `rgba(4, 7, 11, 0.8)` with 1.5rem padding; window `{colors.bg-surface}`, 1px `{colors.border-default}`, square, max 960px wide, max 85vh tall, deep shadow; header is `{colors.bg-surface-elevated}` with a 1px `{colors.border-subtle}` underline, title `{typography.title}` + status badge, close button (control size, `{colors.border-subtle}` outline, hover `{colors.bg-subtle}` + `{colors.text-primary}`); body padding 1.25rem, scrolls. Two bodies:

- **Diff viewer (`{components.diff-viewer}`)** — `{colors.bg-inset}` / `{colors.border-subtle}`, control size, 1.45 line-height, `pre` rows: `line-add` (green fill/text), `line-del` (red), `line-hunk` (blue 8% fill / `{colors.diff-hunk-text}`), `line-meta` (`{colors.text-muted}`). Loading is a `badge-neutral` "fetching diff..." + "Loading change-set from /changes..."; not-found is `badge-amber` over an empty-state ("File not present in changeSet"); secret is `badge-secret` "secret-typed" + "Secret content withheld" empty-state with key tags; error is `badge-red` over "Failed to load diff". No patch → `diff-placeholder`: "No patch available for this file (omitted, withheld, or binary)." in italic `{colors.text-muted}`, 2rem padding.
- **Merge preview (`{components.merge-pane}`)** — status bar: "Overall status:" + `badge-clean` "clean" / `badge-red` "conflict" + `action: X · result: Y` line; file tabs (control size; inactive transparent `{colors.text-secondary}`; active `{colors.bg-surface-elevated}` + `{colors.border-subtle}` + `{colors.text-primary}`; conflict files get a ` [!]` suffix); pane is `{colors.bg-inset}` with 1px `{colors.border-subtle}`, min-height 200px / max 50vh, `pre`; conflict pane swaps its border to `{colors.status-red-border}`. Secret files render "Secret content withheld" instead of content.

### Intent block (`{components.intent-block}`)

The proposal's stated intent, quoted back: `{colors.bg-surface}` fill, **2px `{colors.accent-blue}` left rule**, padding 0.5rem 0.75rem, body size at weight 500 / 1.4, `{colors.text-primary}`, `overflow-wrap: anywhere`. A micro uppercase "intent:" label in `{colors.text-muted}` at 0.04em leads the text. This block and the conflict band are the only sub-4px-border elements; the blue rule is the card's "why" spine and must not be used for anything else.

### Commit-sha chip (`{components.commit-sha}`)

Inside the success banner after a land: `{colors.bg-surface-elevated}` fill, 1px `{colors.border-subtle}`, `{colors.text-primary}` at weight 600, micro size, padding 0.1rem 0.35rem, square. Rendered as `Commit `<sha8>``. It is a receipt, not a link — no hover, no color.

### Action banner (`{components.action-banner}`)

Transient land-flow result, top of page: 1px border, padding 0.625rem 1rem, body size, badge + message + dismiss ("dismiss": transparent, `currentColor` 1px outline, hover 0.8 opacity). Variants: success (green triad + `badge-clean`, carries the commit-sha chip), warn (amber triad + `badge-amber` — "Landing proposal X into demo..."), error (red triad + `badge-red` — withheld-secret block, conflicted files, or "Failed to land"). The banner stays until dismissed — results are read deliberately, never auto-vanished.

### Landed banner (`{components.landed-banner}`)

Replaces stats/files on a landed card: `{colors.bg-inset}`, **1px dashed** `{colors.border-subtle}`, padding 0.75rem 1rem, centered, `{colors.text-muted}` control size, 0.25rem gaps; status line "landed — nothing pending" in `{colors.text-secondary}` at weight 500. Same dashed-terminal convention as the landed card border.

### Empty state (`{components.empty-state}`)

Centered block, **1px dashed** `{colors.border-subtle}` on `{colors.bg-surface}`, padding 2.5rem 1rem. Title `{typography.title}` in `{colors.text-secondary}` ("No active proposals", "No convergence conflicts", "No files changed in merge"); desc control size `{colors.text-muted}` ("Waiting for agent branches to propose changes against base."). Dashed here means "nothing yet" — the same border language as "done" on landed; both are inert states.

### System chrome

- **Connection banner (`{components.connection-banner}`)** — the red bar at the very top: `{colors.status-red-bg}` fill, 1px `{colors.status-red-border}`, `{colors.status-red}` text at body size, padding 0.625rem 1rem. Copy: "Disconnected from platform worker. Retrying..." (initial) / "Connection error: <msg>. Retrying..." (reconnect loop). "Retry now" is the only action — a transparent red-outline button (control size, border `{colors.status-red-border}`), hover fill `rgba(248, 81, 73, 0.2)`. Hidden entirely when fetches succeed: absence is the healthy state.
- **Loading indicator (`{components.loading-indicator}`)** — inline text only: control size, `{colors.text-muted}`, no spinner, no skeleton, no shimmer. Modal fetches pair it with a `badge-neutral` label ("fetching diff...", "computing diff3..."). The ticker and main panels deliberately have no loading state — they show last-known data or the empty state, never a blank.
- **Footer** — margin-top 3rem, 1px `{colors.border-subtle}` top hairline, 1rem padding, space-between: "nextgit — serverless convergence engine" left, sync time right ("not synced yet" → "synced HH:MM:SS"), both micro `{colors.text-dim}`. Ambient chrome; it never carries state.

### Judge chips (planned — queue P0)

The extension keeps the badge/chip language exactly. All three render at `{typography.micro.fontSize}` with badge anatomy (0.15rem/0.5rem padding, 1px border, square) and sit in the proposal card header badge slot (below the repo title when wrapping).

- **Risk chip (`{components.risk-chip}`)** — review-risk score: `Routine` → `{colors.status-green}` on `{colors.status-green-bg}`; `Focused` → amber triad; `Senior-security` → red triad. Label prefix "risk:" micro uppercase `{colors.text-muted}`.
- **Intent-verification badge (`{components.intent-verification-badge}`)** — does the diff do what the intent claims: `supports` → `badge-clean` anatomy, label "intent verified"; `contradicts` → `badge-red`, "intent mismatch"; `insufficient` → `badge-neutral`, "insufficient". The overclaim note, when present, is micro `{colors.text-secondary}` text beside the badge — it never recolors the badge; the verdict does.
- **Semantic-collision chip (`{components.collision-chip}`)** — "soft collision": `{colors.status-amber}` on `{colors.status-amber-bg}`, advisory register. It must never wear `{colors.status-red}`: red is reserved for hard conflicts the merge engine actually found, which live on conflict cards. A soft collision is a heads-up, not a verdict.

[ASSUMPTION] Chip color mapping above is a proposed canon (green/amber/red = advised posture, neutral = not enough information); confirm or correct at intake. The auto-land gate stays behind the Land button: CONFIRM reuses the amber confirming state; ESCALATE surfaces as a red badge next to Land and the button never auto-fires. "The judge advises; code decides" — no chip may imply that landing is automatic.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Color = state only (status triads, accent, diff staff) | Color for decoration, category, or sentiment |
| Step tone or border for depth (app → surface → card/elevated; subtle → default → focus) | Add shadows beyond the two (conflict card, modal), or any blur/glow/glass |
| Keep the 1px hairline as the default border everywhere | Thicken borders except the 4px severity band and 2px intent rule |
| Keep corners square (`{rounded.DEFAULT}`); radius only for the six physical exceptions | Round cards, buttons, chips, badges, modals, or panes |
| Render everything in `{typography.base.fontFamily}` at the 13px-rooted ramp — mono-only until a decision says otherwise | Introduce the declared-but-unreferenced sans stack (or any second family) |
| Reserve uppercase for micro-labels and section titles (0.04–0.06em) | Use uppercase for body, titles, or emphasis |
| Use dashed borders for terminal/inert states (landed, empty) | Use dashed borders as decoration or hover treatment |
| Keep `{colors.text-bright}` as hover text on tinted fills only | Set resting text or body copy in `#ffffff` |
| Confine `{colors.text-muted}` to meta labels and `{colors.text-dim}` to ambient chrome (both below AA at small sizes) | Put load-bearing copy, state messages, or instructions in the muted/faint registers |
| Use the two greens as split: `{colors.diff-add-text}` for diff/counts, `{colors.status-green}` for status | Swap the diff and status greens, or use them interchangeably |
| Keep amber's second job (secrets) at `{colors.status-amber}` on tinted fills; align the `badge-secret` bg to 0.12 on next touch | Invent new secret colors, or render secret **values** anywhere — key names only, schema-only views |
| Extend the judge layer with the existing chip anatomy (planned chips) | Introduce new hues for advisory signals, or dress advice as a hard red conflict |
| Ship dark-only as built | Invent a light mode, or light surfaces, without an explicit decision (`#fff`-literals resolved to `{colors.text-bright}`; `#ffb4af` is flagged drift — replace with the `{colors.status-red}` family when next touched) |
