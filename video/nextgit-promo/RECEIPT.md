# RECEIPT — nextgit-promo

Delivery record for the NextGit promo film. All numbers below are measured on
the shipped file, not estimated.

## The film

- **Master:** `renders/video.mp4` — 18.6 MB · 86.016 s · 1920×1080 @ 30 fps ·
  H.264 + AAC 48 kHz stereo. Pre-normalization master kept at
  `renders/video.prenorm.mp4`.
- Duration planned 86.0 s = 43 bars @ 120 BPM — every frame boundary sits on
  the beat grid; the music bed is authored to the frames.
- Voice: Grady (Higgsfield `seed_audio`), 11 lines — silence-trimmed, atempo
  1.12, per-frame slots with leads. Music: code-synthesized
  (`music/synth.py`), loudness-normalized, carved under the voiceover
  (`data-fx-carve`: 6 bands, 358-point level envelope).
- Captions: none (intended — the film's typography is the text voice).
- Render: 2580 frames, hardware-GPU capture path, 3 m 56 s.

## Computed gates (none self-certified)

| Gate | Measured |
| --- | --- |
| Structure / motion / contrast (`hyperframes check`) | PASS — 0 errors; **17/17 WCAG AA** text checks |
| Transitions (`transitions.mjs verify`) | 10 verified (cross-track, overlap>0, both ids referenced) |
| Decode (`tools/qa.sh`, full decode to null) | **PASS — 0 error lines** |
| Loudness (two-pass loudnorm + ebur128) | **I = −14.2 LUFS** (target −14 ±1) · LRA 4.3 · TP ≤ −1.5 dBTP |
| Silence (silencedetect ≥2.5 s) | PASS — none |
| Black (blackdetect ≥0.4 s) | WARN ×4 — **all deliberate** (see below) |
| Snapshot stills | 60+ frames across four passes + contact sheets, all read and reconciled |

## Fresh-eyes review (reviewer ≠ maker)

- **Round 1** (independent subagent, 18 m): story 9 /10 · typography 7 /10 ·
  finish 6 /10, verdict RETURN with 5 defects.
- Reconciliation: 4 of 5 cited **stale snapshot generations** (fixed before the
  review completed: code-pane crop, secret-view clipping, rail header, etc.);
  1 real (a rail push cropped its own header) → push removed.
- **Round 2** (independent subagent, 9.5 m): confirmed 6/7 previously flagged
  items fixed; 2 real items remained → fixed and re-verified:
  1. F3 wordmark sat raw over the live board → scrim strengthened (board dims
     to 42–97% under the wordmark; verified "reads cleanly").
  2. F9 rail clipped ~11 px left (`ONVERGENCE RAIL`) → the stage's 1.012 push
     removed; header verified complete.
  3. F9 comments beat read sparse → plate enlarged 1498→1680 px.

## Known flaws (honest list)

- Four deliberate near-black stretches (blackdetect flags them): the hook's
  minimal opening (2 beats), the comments beat's dark strip (3.1 s), and the
  pre-bloom hold before the wordmark (1.1 s). Chosen sparsity, not defects.
- The F3 establishing board is a tall page in a 16:9 frame: the bottom
  proposal row is sliced by the viewport edge by design (top-of-board view).
- Full-board UI text is small by nature (real capture; legibility of fine
  print is better on pause than at speed).
- No burned captions, synthesized music bed — swap-in options documented in
  `BRIEF.md`/`POSTS.md`.

## Sources of truth

- Brief `BRIEF.md` · Storyboard `STORYBOARD.md` · Script `SCRIPT.md` ·
  Design system `frame.md` (broadside preset remixed onto NextGit tokens)
- Captures: `assets/*.png` — live platform, canonical demo state
  (demo-verify PASS 25/25, 2026-10-15); rig + manifests in `capture-rig/`
- Tools: `tools/qa.sh` (battery), `tools/normalize.mjs` (delivery loudness),
  `tools/diag.mjs` + `tools/frame-preview.html` (frame diagnostics)
