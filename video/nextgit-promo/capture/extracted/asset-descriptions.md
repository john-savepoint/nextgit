# Asset descriptions — the captured inventory

Source: the live NextGit platform, canonical demo state (demo-verify PASS 25/25,
2026-10-15):
`https://nextgit-platform.john-b7d.workers.dev`.

All product screens in `assets/` are fresh 2× device-pixel captures (3× for the
`macro-*` set) taken read-only from that deployment by `capture-rig/capture.mjs`
(manifest: `capture-rig/rig-manifest.json`, with sha256 + pixel sizes).
Viewport 1440×900 @2x; page ground is `#0A0E14`.

## Product surfaces (real UI, 2×)

- assets/triage-viewport.png — `/` hero: header chips (proposals 5, conflicting
  pairs 1, …), Convergence Conflicts, proposal grid with five-check strips.
- assets/triage-full.png — `/` full-page scroll plate (2880×7670): every
  triage section in one continuous column (scroll-shot source).
- assets/sec-header.png — the app header alone: brand line + five summary chips
  + controls (tour / parity / files links).
- assets/sec-ticker.png — the live event ticker strip. CAVEAT: at capture time
  it carried sibling test-suite traffic (demo-lh-base, agent-lh-1) — do not
  feature; archive only.
- assets/sec-conflicts.png — Convergence Conflicts panel: the deliberate
  `src/auth.ts` pair (agent-1 ↔ agent-2, text-conflict, severity red).
- assets/sec-proposals.png — Concurrent Proposals: all five cards
  (agent-1..agent-5) with intents, check strips, badges, file rows.
- assets/sec-card-agent1.png — agent-1 proposal card alone: intent
  "Refactor: session refresh with TTL"; FOLD folds clean; COLLISION
  text-conflict · src/auth.ts; CONFLICTS 1; SECRETS none.
- assets/sec-card-agent5.png — agent-5 card alone: `blocked`, "withheld-secret
  file — landing blocked"; FOLD "secret-class blocks fold"; SECRETS "withheld";
  file row config/.env `secret-typed` with key names DATABASE_URL, REDIS_URL.
- assets/sec-forks.png — Fork Signals: five per-fork cards with typed signal
  chips (fit / trust / likeness / proof / distance / cost) and policy chips.
- assets/sec-issues.png — Issues panel in its honest error state
  ("Issues unavailable." — /issues exceeds the UI's 20s fetch cap; filed as
  nextgit-ayft). Archive only; do not feature.
- assets/sec-judge.png — Judge-Set Comparison: "4 proposals compared · 1 not
  judged"; rows agent-4/3/2/1 with risk badges + scores; "strongest candidate:
  agent-4"; advisory-only strip; skip row "agent-5 — secret-typed — not judged".
- assets/sec-pipelines.png — Pipelines: 20 landing records, every row carrying
  the green `signed` attestation badge. CAVEAT: row attributions are historical
  scratch repos (agent-lh-1, agent-r2i-*); crop tight to hash + badge.
- assets/sec-rail.png — Convergence Rail: five per-repo cards (landing chip,
  intent line, neutral check dots, policy chips, "no events"). Neutral-state
  surface (no landings in the current set → no attestation badges here).
- assets/sec-sessions-empty.png — Sessions panel empty state ("No session
  activity for demo"). Archive only; do not feature.

## Merge preview + comments (the review room, 2×)

- assets/modal-merge-clean.png — "Merge preview: agent-1" modal: overall
  status clean; the merged src/auth.ts pane; review-comments thread with the
  real comment "john · line 3 · looks good — ship it".
- assets/modal-comments.png — just the review-comments thread strip from that
  modal (composer + the john comment).
- assets/modal-merge-conflict.png — the pair preview `agent-1,agent-2` in the
  real modal render: red "conflict" state. CAVEAT: its comment thread shows an
  honest "Comments unavailable" row (the pair string is not an accepted repo
  key) — prefer modal-conflict-pane.png.
- assets/modal-conflict-pane.png — the diff3 conflict pane alone:
  `<<<<<<< ours` / `=======` / `>>>>>>> theirs` over src/auth.ts, monochrome
  monospace, fully readable.

## Files, secrets, history (2×)

- assets/files-agent5-view.png — the Repo files page for agent-5 (picker +
  tree at repo root).
- assets/files-agent5-env-secret.png — config/.env before reveal: "secret —
  config/.env (key names only)"; DATABASE_URL, REDIS_URL; reveal button.
- assets/files-agent5-env-revealed.png — after the audited reveal: the value
  line (fixture FAKE-SECRET-DO-NOT-USE) rendered from the POST /reveal 200
  body only.
- assets/files-agent1-auth.png — the file viewer on agent-1's src/auth.ts
  (ordinary text file, full source visible).
- assets/files-agent1-view.png — agent-1 repo files page with the file open.
- assets/history-viewport.png — /history for agent-1 at its head: real commit
  rows (agent-1: Refactor: session refresh with TTL; baseline v3: service
  skeleton; land(agent-N): fold proposal(s)) with authors + dates.
- assets/history-detail.png — "Changed files in eb2c4a4 – 1 files (+6/-0)":
  src/auth.ts · modified · +6 -0.

## Parity, tour (2×)

- assets/parity-viewport.png — /parity: verdict chips (exceeds / parity /
  below), legend, the comparison table above the fold.
- assets/parity-full.png — full-page parity ledger (2880×4506).
- assets/tour-step-01.png — tour step 1 "Welcome to NextGit" (positioning copy
  visible).
- assets/tour-step-04.png — tour step 4 "What a Proposal Is".
- assets/tour-step-07-live.png — tour step 7 "The Real Thing: Live Proposals":
  "Live connection established: Loaded 5 proposals from nextgit-platform." +
  live proposal cards + the secret-typed callout.
- assets/tour-step-09.png — tour step 9 "What Is Not Here (Yet) and Why".

## Component macros (3×)

- assets/macro-card-agent1.png — agent-1 card at 3× (check strip legible).
- assets/macro-rail-agent1.png — agent-1 rail card at 3×.
- assets/macro-pipeline-row.png — one pipeline row at 3× (hash + `signed`).
- assets/macro-judge-row.png — one judge row at 3× (repo, score, badges).
- assets/macro-fork-agent5.png — agent-5 fork-signal card at 3×.
- assets/macro-env-revealed.png — the revealed config/.env viewer at 3×.

## Support (not product screens)

- capture/screenshots/full-page.png — the HyperFrames CLI crawl's 1× full-page
  plate of `/` (scroll-shot fallback).
- assets/fonts/ — the film's staged faces (Barlow 400/600/700/800/900,
  IBM Plex Mono 400/500/600), offline @font-face; see frame.md.
