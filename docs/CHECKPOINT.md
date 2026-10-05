# Checkpoint — NextGit (append-only)

> Append a new `## <date> — <session/batch name>` entry per session or batch. A correction to an entry appends under it as `### CORRECTIONS to the entry above` with numbered items — a record that cannot correct itself misleads the next session.

## 2026-10-04 — project-init bootstrap (spine + loop + judge research)
**Shipped:** `docs/` spine (STATE/CHECKPOINT/LOG/BUILD-LOG/NEXT-ACTIONS), `docs/SKILLS.md`, `docs/judge-layer-ideas.md` (36 ideas), `porting/wf-template.ddw.js` + `porting/wf-batch.ddw.js`, `.omp/commands/{nextgit-start,nextgit-warm,nextgit-continue,goal}.md`, `.omp/agents.md`, `scripts/status-index.mjs` + `docs/status-index.json`; git repo initialized. Clef judge layer verified callable (live typed answers, ~$0.00012/call). One trivial work order (bootstrap health sweep) run through the runner.
**What the gates caught:** the project-init skill's `references/` ships the contracts but **not** the two DDW template files — authored from the loop-and-gates contract instead (flagged here so nobody hunts for the missing originals). tsc baseline not yet runnable (TypeScript not installed in `platform/`) → recorded carry, queue P2-4.
**Recorded carries:** tsc 4 pre-existing errors (owner unassigned, P2-4) · claude/gemini/opencode CLI auth (owner John) · competition eligibility (owner John).
**Next:** P0 — Wire the Clef judge layer (`AI` binding + `POST /judge` + card chips).

## 2026-10-04 — Judge-layer investigation (Clef vs Jev)
**Shipped:** verified `@cf/cloudflare/clef` end-to-end from this account (REST, typed answers on real NextGit data); wrote the 36-idea catalog at `docs/judge-layer-ideas.md`; established the wiring plan (`AI` binding + `/judge` + first three card judgments).
**What the gates caught:** calibration nuance — the collision noul came back 0.17 while diff3 flags a real conflict: the noul judges "same function/behavior", the diff3 signal is *adjacency*. Keep the lenses distinct on the card (two different signals, both true).
**Recorded carries:** none new (the earlier REST auth failure was transient — retry worked; noted for the record).
**Next:** same as above — wire it.

## 2026-10-03 — Build waves: worker · UI · scripts · real agents · landing · fork-point · tour
**Shipped:** platform worker (`/changes /proposals /merge /land /events`, secret masking, intent via mirrored notes branch, fork-point change-sets, `landing.status`), triage UI + interactive tour, demo scripts (`seed/agents/real-agents/land`), real CLI agents (omp + codex) producing real proposals, server-side landing (isomorphic-git over the v1 protocol), browser-verified click-to-land (commit `da120ab2` landed agent-3).
**What the gates caught (honest list):** intent text attached to secret-class rows (latent leak — fixed + re-verified); demo `.env` fixture not a realistic env file (fixed); reverse-diff noise after the first live land (fixed by fork-point semantics); 4 script bugs incl. a host gitignore silently eating `.env` (fail-closed check added); my own browser scripts held stale DOM refs during the land test (probe bug, not product).
**Recorded carries:** scratch-repo hygiene (delete after tests — done); `wrangler@latest` needed for Artifacts commands (global wrangler 4.106 lacks them).
**Next:** judge layer (P0-1).

## 2026-10-02 — Analyst session: research → brainstorm → SPEC
**Shipped:** full read of both source docs + competition terms (rubric: 50% originality/prototype · 25% concurrency · 25% UX); three research dossiers (technical, competitive, feature-matrix — 493 sources) + five recon briefs (Artifacts API, Perforce/game-dev, big-assets/R2, CI/CD, cloud-dev); brainstorming session (91 memlog entries) converged to the convergence layer + MoSCoW demo scope; `SPEC-next-git-platform` written and preservation-validated.
**What the gates caught:** the "unlimited hardware" premise from the source conversation is not in any official material (flagged); competition-white space verified absent across 6+ independent sweeps; nearest competitors (GitGhost beta, Whiteboard, Entire) catalogued.
**Recorded carries:** eligibility question (§3 residency) raised same day — still open, owner John.
**Next:** build the convergence layer (done 2026-10-03).
