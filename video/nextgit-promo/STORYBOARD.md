---
format: 1920x1080
duration: 86s
message: "Many AI agents, one repo — every change triaged, proven, and signed."
arc: "PAS with feature-benefit progression"
audience: "developers, engineering leads, and the agent-tooling crowd"
mode: collaborative
music: none
---

## Video direction

- **palette (frame.md is truth)** — ground `{colors.ink-black}` #0A0E14; text `{colors.cream}` #E6EDF3 / `{colors.cream-muted}`; the ONE accent `{colors.fire-orange}` (remapped #58A6FF) — emphasis, spotlights, marker boxes, underlines, the URL. Status hues (green #2EA043 / red #F85149 / amber #D29922) appear ONLY where the real product state carries them inside the plates — never as film decoration. Hairlines `{colors.border-dark}` 1px. No pure #000/#fff, no second accent, no gradients as grounds.
- **type (frame.md is truth)** — display: Barlow, lowercase, 900, negative-tracked (the film's voice); chrome/labels: IBM Plex Mono, uppercase, 0.14em; reading: Barlow 400/600. Mono is never the display; Barlow is never uppercase. Load the staged faces from `assets/fonts/` (@font-face block in frame.md) — never a Google-Fonts link.
- **motion grammar** — one camera logic for the whole film: dark cockpit, plates as exhibits. Camera = slow dives/pulls on the plates (`viewport-change`, `power3` settles, `expo.out` on fast arrivals) with a faint micro-drift; NEVER zoom-in-then-zoom-out churn. Reveal model: sequential, timed to the VO cues — nothing appears before its spoken cue; no front-loading. Seams inside a frame are velocity-matched `zoom-through` cuts, not slideshow crossfades. Stillness wins: holds stay still (at most a low-amplitude finite `sine-wave-loop` jitter, one ambient element per frame).
- **annotation law** — the product UI is never rebuilt or repainted: plates are real captures; the film annotates WITH its own layer (1px accent boxes with corner ticks, mono tags, spotlight falloffs, type). Any label the film adds is mono chrome.
- **layout law** — keep all film-added text inside the top ~83% of canvas (bottom band stays clear); plates may bleed full-frame; type columns hold `pad-x` 5.5cqw.
- **negative list** — no deck chrome (no counters, timecodes, progress bars, corner brackets-as-frame), no cards floating on voids, no bouncy/elastic overshoot (settle only), no infinite loops, no breathing cards, no invented numbers (every figure on screen traces to a captured plate or the script), no captions (disabled for this cut).

## Frame 1 — the bottleneck

- scene: three kinetic type beats land alone on the dark ground; the last one hangs.
- voiceover: "Five AI agents. One repo. You're the bottleneck."
- duration: 6.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/01-bottleneck.html
- type: hook
- persuasion: Pain validation
- beat: tension
- blueprint: kinetic-type-beats
- asset_candidates: 

### Scenes

- Scene 1 (0.0–1.3): empty ink-black field; nothing on screen — the silence is the seat. A single centered mono tick "•" (cream-hint) fades in at 0.9 as the pulse before the first word.
- Scene 2 (1.3–4.6): the statement builds beat-by-beat, each beat ALONE at center (layout: centered, ~55% emptiness between beats, one hierarchy level): "five agents." arrives 1.35 via per-word staggered reveal (`dynamic-content-sequencing`, smooth `power3` settle) → hard-cut flash-swap (`discrete-text-sequence`) replaces it with "one repo." at 2.6 → replaced by "you're the" + "bottleneck" at 3.5, where "bottleneck" lands as a hard-cut accent-fill snap (the fill flips to `{colors.fire-orange}`) — `spring-pop-entrance` restricted to a restrained settle, no overshoot.
- Scene 3 (4.6–6.5): hold on "bottleneck."; a 1px accent underline draws left→right beneath it (`svg-path-draw`) ending in a small bound undulation (`sine-wave-loop`, finite, ≤1.5s); everything else still. No further motion.

narrativeRole: Names the playing field and the problem in three beats — the viewer is running agents faster than review.
keyMessage: Agent-speed shipping has outrun human review.

## Frame 2 — the messy landing

- scene: type beats accumulate the chaos; a conflicts-card plate slides in on the last cue.
- voiceover: "Five change-sets land at once. One shared file — and one agent just touched the .env."
- duration: 8.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-messy-landing.html
- type: pain_point
- persuasion: Pain agitation
- beat: overwhelm
- blueprint: kinetic-type-beats
- asset_candidates: assets/sec-conflicts.png — the red src/auth.ts conflict card (agent-1 ↔ agent-2)

### Scenes

- Scene 1 (0.0–2.6): "five change-sets" builds word-by-word at center (`dynamic-content-sequencing`); on "at once" (≈2.2) five small mono chips (agent-1…agent-5, hairline-bordered, cream-hint) burst outward from behind the text and settle scattered around it (`center-outward-expansion`, short paths, ≤500ms).
- Scene 2 (2.6–5.0): "one shared file —" lands; the five chips CONVERGE inward onto the center (same machinery run inward) collapsing into one mono line "src/auth.ts" that lands inside a 1px status-red selection box (`css-marker-patterns` box marker; the box's hairline is the only red — the plate's red comes later).
- Scene 3 (5.0–8.5): "and one agent just touched the .env" — the conflicts-card plate (`assets/sec-conflicts.png`) rises from below the frame edge into the lower-left at ~62% width, dimmed to 85% (masked slide, `power3`); as ".env" is spoken (≈6.4) a mono tag ".env" with an amber hairline border pops beside the plate's top edge (`spring-pop-entrance` settle only); hold through the cut.

narrativeRole: Raises the stakes from "busy" to "risky" — collision AND a secret in play; seeds both pillars.
keyMessage: Concurrent agent work lands collisions and secret-class risk at the same time.

## Frame 3 — meet NextGit

- scene: open tight on a real proposal card macro, then one continuous pull-out reveals the whole triage board.
- voiceover: "This is NextGit — your agents' work, all in one place."
- duration: 6.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-meet-nextgit.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: clarity
- blueprint: zoom-out-workspace-reveal
- asset_candidates: assets/macro-card-agent1.png — agent-1 card at 3× (the tight start); assets/triage-viewport.png — the full triage board (the pull-out end)

### Scenes

- Scene 1 (0.0–2.6): ONE `.world` holds both plates — the full triage board (`assets/triage-viewport.png`) at final layout with the 3× card macro (`assets/macro-card-agent1.png`) placed over its card-1 region. The camera opens at ~2.1× on the card's check-strip region (full-bleed, no chrome), resolving from a soft blur in the first 0.3s (`depth-of-field-blur` refocus); micro-action: the five check chips along the strip pop in sequence, low-overshoot staggered `spring-pop-entrance` (≤500ms stagger total) — each chip's pop reads in close-up.
- Scene 2 (2.6–4.6): as "This is NextGit" lands (≈2.7), ONE decelerating pull-back begins (`viewport-change`, single `cam` state, `expo.out`) and reveals the whole board; it eases to a full stop at ~4.5. Camera NEVER moves again after the stop.
- Scene 3 (4.6–6.5): locked on the wide. Element payoff: the wordmark "nextgit" (Barlow 900 lowercase, ≈6cqw, cream) fades/scales in at top-left (`gsap-effects` short settle; no rotation); on "all in one place" (≈5.9) the mono line "all in one place." lands beneath it with a 1px accent rule above; hold.

narrativeRole: The value claim lands in the product's own words, proven by the real board.
keyMessage: Every agent's work lands on one board.

## Frame 4 — the five-check set

- scene: the proposal grid holds; per cue, the check strip walks — fold, collision, conflicts, secrets, base.
- voiceover: "Five checks per proposal: fold, collision, conflicts, secrets, base — server-side, no vibes."
- duration: 10.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-five-checks.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: confidence
- blueprint: grid-card-assemble
- asset_candidates: assets/sec-proposals.png — all five proposal cards with check strips; assets/macro-card-agent1.png — 3× card (chip legibility source)

### Scenes

- Scene 1 (0.0–1.6): the proposals board (`assets/sec-proposals.png`) settles into frame full-width (masked rise, `power3`, no bounce); camera static from here. A mono kicker "five checks per proposal" is NOT added — the VO says it.
- Scene 2 (1.6–8.6): the annotation walk — a 1px accent spotlight box with corner ticks (`ai-tracking-box`, static-bracket variant; our annotation layer, never overpainted UI) steps chip-to-chip across card agent-1's check strip on each spoken cue: fold 2.0, collision 3.3, conflicts 4.6, secrets 5.9, base 7.2 — each step is an instant `tl.set` (no glide), each landing fires a 300ms accent glow envelope (`asr-keyword-glow`) behind the box. The box's width refits per chip (`card-morph-anchor` substitution law — uniform scaleX, never tweened width). On "server-side" (≈8.2) the box releases: a hairline accent rule sweeps left→right across all five cards' strips (`svg-path-draw`, one pass) and stays.
- Scene 3 (8.6–10.5): hold; stable tween: the sweep rule flickers a single accent pulse at each card boundary arriving in sequence (four quick `tl.set` opacity steps — a server-side heartbeat, finite); then stillness. Nothing else moves.

narrativeRole: Turns "five proposals" into "one comparable set" — the product's reason to exist, on cue per check.
keyMessage: Triage is computed server-side per proposal, not eyeballed.

## Frame 5 — the collision

- scene: a three-leg camera journey: red conflict card → merge preview → the diff3 conflict pane's markers.
- voiceover: "Two agents, one file. The board says collide — the merge preview shows you where."
- duration: 8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-collision.html
- type: feature_showcase
- persuasion: Negative contrast (chaos → handled)
- beat: intrigue
- blueprint: camera-journey
- asset_candidates: assets/sec-conflicts.png — the colliding pair card; assets/modal-merge-clean.png — merge preview modal; assets/modal-conflict-pane.png — the diff3 conflict markers

### Scenes

- Scene 1 (0.0–2.6): "Two agents, one file." — the conflicts card (`assets/sec-conflicts.png`) is already full-bleed; the camera dives (fast `power2.out` push, `viewport-scale` leg) landing tight on the card's pair row `agent-1 ↔ agent-2` at ≈1.7; on "collide" (≈2.9 in the VO, cue here ≈2.3) a status-red spotlight box frames the row (`ai-tracking-box` static variant) with a single pulse.
- Scene 2 (2.6–5.6): "the merge preview shows you where" — a velocity-matched `zoom-through` seam (blur peaks, resolves sharp) swaps to the conflict pane plate (`assets/modal-conflict-pane.png`) pushed to ~1.4× on the marker region; camera eases to rest (`power3`). On "where" (≈4.9) two mono annotations land in sequence beside the marker lines: "ours — agent-1" (accent hairline) then "theirs — agent-2" (cream-hint hairline), each via a short fade/slide (`gsap-effects`) — our annotation layer only.
- Scene 3 (5.6–8.0): locked; hold on the two annotated markers; at most a low-amplitude finite jitter on the box hairlines (`sine-wave-loop`); end still.

narrativeRole: Shows the platform catching what would otherwise land as a broken merge — evidence first.
keyMessage: Collisions are detected before anyone runs a merge.

## Frame 6 — the judge

- scene: the judge-set plate dims; the four real scores count up beside it; the skip row resolves last, on purpose.
- voiceover: "A judge scores the set — and skips the secret one, on purpose."
- duration: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-judge.html
- type: feature_showcase
- persuasion: Authority by association (an evaluator reads for you)
- beat: trust
- blueprint: dataviz-countup
- asset_candidates: assets/sec-judge.png — judge-set comparison rows + strongest-candidate strip + agent-5 skip; assets/macro-judge-row.png — one row at 3×

### Scenes

- Scene 1 (0.0–3.8): the judge plate (`assets/sec-judge.png`) as ground, dimmed to 62% (`depth-of-field-blur`-style falloff via opacity — the plate is the context, the numbers are the reading). A right-side column builds as the VO moves: four mono numerals (tabular, cream) count up to the REAL scores with their repo tags beside them — agent-2 → 1.6028 (lands ≈1.5), agent-1 → 1.5069 (≈2.2), agent-3 → 0.8707 (≈2.9), agent-4 → 0.7581 (≈3.5) — `counting-dynamic-scale` per numeral (size constant; the count is the move), rows arriving on the VO's cadence, low-overshoot. These four values trace to the captured plate.
- Scene 2 (3.8–6.0): "skips the secret one, on purpose" — a mono row "agent-5 — secret-typed — not judged" (the plate's own words, its real skip row magnified from the 3× macro if legible, else typed in mono) slides up from the plate's skip-row position to center at ~4.6 (`gsap-effects`, no bounce) framed by a 1px accent box; a single restrained accent pulse on the box at "purpose" (≈5.4); hold still.

narrativeRole: The AI-implementation-agent story deepens: agents propose, a judge scores the set — and the secret-class skip is a designed feature, not an omission (ownership is carried on-screen by the advisory strip).
keyMessage: The judge scores the set and skips the secret one by design; the human keeps the button (on-screen strip).

## Frame 7 — secrets stay secrets

- scene: agent-5's blocked card → the file viewer with key names only → the audited reveal line renders last.
- voiceover: "Secrets stay typed — key names, never values. Reveal is audited, repo-scoped, and re-checked every click."
- duration: 12.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/07-secrets.html
- type: feature_showcase
- persuasion: Risk reversal
- beat: relief + control
- blueprint: device-surface-showcase
- asset_candidates: assets/sec-card-agent5.png — withheld-secret card (secret-class blocks fold); assets/files-agent5-env-secret.png — key names only; assets/macro-env-revealed.png — the revealed value line at 3×

### Scenes

- Scene 1 (0.0–3.4): the agent-5 card plate (`assets/sec-card-agent5.png`) holds center at ~86% width with a faint hairline frame; as "Secrets stay typed" lands (≈0.9) a 1px accent box walks the card's blocked badges in two steps (`tl.set` steps): "blocked" (≈1.6) → the file row's `secret-typed` chip (≈2.6); on "key names, never values" (≈3.0) the two key chips DATABASE_URL / REDIS_URL glint once (single accent glow envelope).
- Scene 2 (3.4–7.6): velocity-matched `zoom-through` seam → the secret file viewer (`assets/files-agent5-env-secret.png`) fills frame (masked push-in, `power3`); camera settles. On "Reveal is audited" (≈5.6) the reveal button gets the accent box + a soft press dip (`press-release-spring`) — the plate's own button, annotated, not pressed-for-real.
- Scene 3 (7.6–12.5): seam → the REVEALED plate (`assets/macro-env-revealed.png`, 3×) fills frame on the value line region; on "repo-scoped" (≈9.4) a mono tag "repo-scoped · agent-5" lands left of the value line; on "re-checked every click" (≈11.0) a mono tag "audited — re-checked every click" lands right (both `gsap-effects` short settles, hairline-bordered); hold to the cut. The value line is the real captured reveal.

narrativeRole: The security blockbuster: typing, masking, repo-scoped grants, an audited reveal.
keyMessage: Secret-class content is schema-only by default; the one path to a value is audited and repo-scoped.

## Frame 8 — signed landings

- scene: the claim "signed." pins; pipeline rows cycle beneath it, every row carrying the green badge.
- voiceover: "Every landing ships signed. Two independent copies — verify it yourself."
- duration: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/08-signed.html
- type: benefit_highlight
- persuasion: Statistical proof (every single row)
- beat: confidence
- blueprint: fixed-anchor-cycle
- asset_candidates: assets/macro-pipeline-row.png — one row at 3× (hash + signed badge); assets/sec-pipelines.png — the 20-row signed ledger

### Scenes

- Scene 1 (0.0–1.4): the anchor "signed." (Barlow 900 lowercase, ≈9cqw, cream) lands center-top third via a restrained scale/fade settle; a 1px green (`{colors.status-green}` — the product's own badge hue for this beat) underline draws beneath it (`svg-path-draw`). The anchor then PINS — zero movement for the remainder.
- Scene 2 (1.4–4.8): beneath the anchor, a masked slot cycles row crops from `assets/macro-pipeline-row.png` (each carrying hash + green `signed` badge): rows step up through the slot on a steady cadence (`vertical-spring-ticker` stepped form — instant steps, masked edges), 4 rows over the window. On "two independent copies" (≈3.0) two mono tags pop beside the anchor in sequence — "KV landing:‹commit›" then "R2 attestations/‹commit›.json" — `spring-pop-entrance` restrained, each with a hairline; they hold.
- Scene 3 (4.8–6.0): on "verify it yourself" (≈4.9) a mono command line types in under the rows: `node platform/scripts/attest-verify.mjs --commit <sha>` (`discrete-text-sequence` typing + `context-sensitive-cursor` caret), then a single blink; hold to cut.

narrativeRole: Converts "trust us" into "verify us" — attestation as a habit, not a promise.
keyMessage: Every landing record carries a signature you can check yourself.

## Frame 9 — review together

- scene: the real comment thread types into view; then the rail assembles the set view.
- voiceover: "Comment on the merge. Steer with the rail. Review the set like a team."
- duration: 8.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-review-together.html
- type: benefit_highlight
- persuasion: Friction reduction
- beat: belonging
- blueprint: typewriter-reveal
- asset_candidates: assets/modal-comments.png — the real "looks good — ship it" thread; assets/sec-rail.png — the convergence rail set view

### Scenes

- Scene 1 (0.0–3.4): the comments plate (`assets/modal-comments.png`) lands center at ~78% width (short slide-up, `power3`); on "Comment on the merge" (≈1.0) a mono line beneath the plate types on: "on the merge. on the file. on line 3." (`discrete-text-sequence` type-on + caret blink `context-sensitive-cursor`); the plate's own real comment (author "john · line 3 · looks good — ship it") gains a 1px accent box for 600ms on "merge" — the annotation points AT the real artifact.
- Scene 2 (3.4–6.0): on "Steer with the rail" (≈3.9) a velocity-matched `zoom-through` seam swaps to the rail plate (`assets/sec-rail.png`) full-width; the accent box steps across the five repo cards left→right (`tl.set` steps ≈4.3/4.7/5.1/5.5/5.9 — one step per card, quick); camera static.
- Scene 3 (6.0–8.5): the two plates STACK — comments plate settles above (≈52% width), rail plate below (full width), both with hairline frames (`gsap-effects` layout settle); on "Review the set like a team" (≈6.7) the type line "review the set like a team." lands centered above both (Barlow 600, cream; mono kicker "the human layer" not added); the accent boxes clear; hold.

narrativeRole: The social layer in one beat: review is a conversation on the artifact itself.
keyMessage: Comments live on the merge; the rail keeps the set story visible.

## Frame 10 — the honest ledger

- scene: three tiles assemble — history, fork signals, parity — and the not-built list types in under them.
- voiceover: "History, fork signals, an honest parity ledger — including what's not built yet."
- duration: 7.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/10-honest-ledger.html
- type: benefit_highlight
- persuasion: Risk reversal (honesty as proof)
- beat: trust
- blueprint: grid-card-assemble
- asset_candidates: assets/history-detail.png — real commit + changed-files row; assets/parity-viewport.png — verdict chips; assets/tour-step-07-live.png — the live tour step; assets/sec-forks.png — fork signals

### Scenes

- Scene 1 (0.0–5.4): three tiles cascade into a row (layout: thirds, hairline-framed, sharp corners), each a masked slide + fade into its slot (`center-outward-expansion` short-path / per-item `gsap-effects` stagger), arriving on the VO: history tile (`assets/history-detail.png`) at "History" (≈0.7), forks tile (`assets/sec-forks.png`) at "fork signals" (≈2.0), parity tile (`assets/parity-viewport.png`) at "parity ledger" (≈3.4). At "honest" (≈3.0) a single accent pulse crosses beneath the parity tile (one-pass `ambient-glow-bloom` sweep, left→right).
- Scene 2 (5.4–7.5): on "including what's not built yet" (≈5.6) a mono line types in under the tiles: "below parity: session-steering · agent-federation · issues · ci" (`discrete-text-sequence` type-on; the four names are the real below-set from the parity plate); then a 1px accent underline draws under the line (`svg-path-draw`); hold static to the cut.

narrativeRole: Buries the "perfect-product" smell: the platform publishes its own gaps.
keyMessage: What's below parity is shown, not hidden.

## Frame 11 — nextgit

- scene: the wordmark blooms on a dimmed board; the tagline and URL land; hold.
- voiceover: "NextGit. Your agents' work, all in one place."
- duration: 5.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/11-nextgit.html
- type: cta
- persuasion: Direct invitation
- beat: inevitability
- blueprint: logo-assemble-lockup
- asset_candidates: assets/triage-viewport.png — the dimmed board behind the lockup

### Scenes

- Scene 1 (0.0–1.7): the triage board (`assets/triage-viewport.png`) fills frame at 20% opacity behind a vignette; a near-imperceptible continuous push runs (multi-phase steady-push, ≤3% over the frame — the only camera motion).
- Scene 2 (1.7–3.6): on "NextGit." (≈2.0) the wordmark "nextgit" (Barlow 900 lowercase, ≈10cqw, cream) blooms from zero at center (single restrained `spring-pop-entrance`: ζ≈1 settle, no rotation); a 1px accent hairline draws left→right beneath it (`svg-path-draw`).
- Scene 3 (3.6–5.5): on "your agents' work, all in one place" (≈3.0..4.3) the mono tagline "your agents' work, all in one place." fades in under the hairline (`gsap-effects`, quiet); then the URL `nextgit-platform.john-b7d.workers.dev` reveals left→right in accent mono (clip-path reveal) at the lower-left of the safe area; the board dims to 12%; hold still to the end — the film's only true still frame is its last.

narrativeRole: Fix the name and the one sentence; nothing new to learn, everything already shown.
keyMessage: NextGit — your agents' work, all in one place.
