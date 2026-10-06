# Harvest merge — registry population (APPLIED)

Date: 2026-10-06T02:50:58.557Z · threshold: 0.68 · items: 489 → kept 471, skipped 18

## Kept by source
- spec: 84
- memlog: 88
- recon: 78
- research: 76
- session: 30
- source-docs: 83
- judge: 32

## Skipped (merged/retired — nothing silently dropped)
- [judge] Add review-risk score chip to proposal cards — manual:chip children of existing:wire-the-clef-judge-layer
- [judge] Add intent-vs-diff verification badge to cards — manual:chip children of existing:wire-the-clef-judge-layer
- [judge] Add change-kind label to proposal cards — manual:chip children of existing:wire-the-clef-judge-layer
- [judge] Add semantic collision warnings across proposals — manual:chip children of existing:wire-the-clef-judge-layer
- [judge] Add AI binding to platform wrangler config — manual:wiring children of existing:wire-the-clef-judge-layer
- [judge] Add POST /judge with server-side state assembly — manual:wiring children of existing:wire-the-clef-judge-layer
- [judge] Render risk, intent, and collision chips on proposal cards — manual:wiring children of existing:wire-the-clef-judge-layer
- [session] Video script + storyboard (reviewed by John before recording) — manual:dup of existing:video-script-storyboard
- [session] Record + edit the submission video (reset demo first) — manual:dup of existing:record-edit-the-submission-video
- [session] Submission package: LICENSE + README + run instructions + entry — manual:dup of existing:submission-package
- [session] Demo reset to pristine 4-pending real-agent state — manual:dup of existing:demo-scenario-reset-fresh-real-agent-fleet
- [judge] Evaluate auto-land eligibility server-side in POST /land — manual:dup of existing:auto-land-gate-live
- [judge] Add content-based secret detection regardless of path — manual:dup of existing:trust-beat-content-based-secret-detection
- [judge] Enforce auto-land gate inside POST /land, fail-closed — manual:dup of existing:auto-land-gate-live
- [session] Fleet-scale demo: 12–20 staggered real agent runs — manual:dup of existing:fleet-scale-demo
- [session] Unlock marquee agents: claude + gemini + opencode auth (John) — manual:dup of existing:unlock-marquee-agents
- [spec] Matcher verdicts: merge it / use as context / ignore — kept:return-matcher-verdicts-merge-context-or-ignore (sim 0.71)
- [session] Corpus copies: competition terms + launch blog into docs/corpus — manual:dup of existing:corpus-copies

## Audit
- Kept items carry `source: harvest:<src>` + `Ref: ...` in scope: `bun porting/tasks.mjs list --json | jq '[.[] | select(.source | startswith("harvest:"))] | length'`
- Raw harvest inputs: `porting/harvest/*.json` (gitignored, transient) — in-store provenance is authoritative.
