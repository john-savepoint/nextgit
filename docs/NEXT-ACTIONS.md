# Next actions

> Starting fresh? Read `docs/STATE.md` → `docs/CHECKPOINT.md` → this file.

- [pending] P0 — Wire the Clef judge layer — add `"ai"` binding + `POST /judge` to the worker; put risk score + intent-vs-diff verification + semantic-collision chips on proposal cards; acceptance: chips render from live Clef answers in-browser; check: curl `/proposals` shows judge fields + the page renders them (ideas 1-4 in docs/judge-layer-ideas.md)
- [pending] P0 — Write the PRD (bmad-prd) — product requirements for platform + demo + submission, built from SPEC + dossiers; acceptance: PRD lands under `_bmad-output/planning-artifacts/` and upstream SPEC re-derives clean
- [pending] P0 — UX spec for the triage surface (bmad-ux) — canvas review flow, judge chips, land flow, recording needs; acceptance: DESIGN/EXPERIENCE docs exist and the video storyboard cites them
- [pending] P0 — Architecture doc (bmad-architecture) — freeze worker/Artifacts/DO/R2/federation boundaries + the `/judge` contract; acceptance: doc lands beside the spec and matches the deployed reality
- [pending] P0 — Demo scenario reset + fresh real-agent fleet — run `seed.mjs` → `real-agents.mjs` for a pristine 4-pending state; acceptance: `/proposals` = 4 real proposals, ≥1 conflict, intents present
- [pending] P0 — Video script + storyboard — the 5–10 min narrative: agents work → collision → judge chips → one click lands → done; acceptance: script reviewed by John before recording
- [pending] P0 — Record + edit the submission video — capture the live platform end-to-end (reset first); acceptance: 5–10 min video ready to submit
- [pending] P0 — Submission package — OSI LICENSE + README + run instructions + repo curation + eligibility resolution; acceptance: every submission requirement checked off; entry filed
- [pending] P1 — Auto-land gate live — confidence-gated ACT/CONFIRM/ESCALATE behind the Land button; acceptance: a safe proposal lands itself in the demo (idea 5)
- [pending] P1 — Fleet-scale demo — 12–20 real agent runs (staggered tasks) through the platform; acceptance: fleet view at scale, collisions surfaced, page stays responsive
- [pending] P1 — Unlock marquee agents — `claude login` + gemini/opencode auth (John), then route tasks via harness-capability choice (idea 32)
- [pending] P1 — Trust beat: content-based secret detection — semantic secret flagging demoable on a proposal that hides a secret in a non-secret path (idea 11)
- [pending] P1 — Game-industry story page — storage classes + R2 asset tier rendered honestly for the video (SPEC `stack.md`)
- [pending] P2 — Tour v2 — fold judge chips + auto-land language into `/tour.html` after the judge wave; acceptance: tour matches the live page
- [pending] P2 — Performance: cache `/proposals` — avoid full recompute on every poll; acceptance: <1 s responses at 20 proposals
- [pending] P2 — Corpus copies — fetch competition terms + launch blog into `docs/corpus/` for the submission audit
- [pending] P2 — tsc hygiene — install TypeScript in `platform/`, fix the 4 pre-existing errors; acceptance: `npx tsc --noEmit` clean
- [pending] P3 — Post-submission roadmap — R2 asset tier, Agent Office integration, fork community, Clef RL fine-tune track
- [pending] P3 — Bootstrap health sweep — run the live smoke + syntax checks through the runner (the bootstrap acceptance order); acceptance: BUILD-LOG row with verbatim evidence
- [done] P0 — Judge-layer research + live proof — Clef verified callable 2026-10-04; 36 ideas recorded in `docs/judge-layer-ideas.md`
- [done] P1 — State spine + loop scaffolding — `docs/` spine, `porting/` runner, `.omp/commands/`, `scripts/status-index.mjs` (this bootstrap)

Grammar: `- [status] Pn — title`. Statuses: `pending|done|remediated|blocked|partial`.
