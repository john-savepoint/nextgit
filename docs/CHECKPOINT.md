# Checkpoint — NextGit (append-only)

> Append a new `## <date> — <session/batch name>` entry per session or batch. A correction to an entry appends under it as `### CORRECTIONS to the entry above` with numbered items — a record that cannot correct itself misleads the next session.

## 2026-10-05 — Bootstrap acceptance: first loop order (health sweep)
**Shipped:** the first work order through `porting/wf-template.ddw.js` — PLAN → IMPLEMENT → VERIFY → GATE → HEAL ×4 → REPORT. Subject: 4/4 baseline checks green, byte-identical across 5+ independent reproductions (C1 UI syntax · C2 `/health` · C3 `/proposals` summary · C4 status-index `--check`). Apparatus: runner hardened and committed (`d5f6b5b`, +133/−35) exactly as the gates' required-before-ship text demands (separate commit with its own justification; `git status` clean at acceptance) — verdict normalization now fails CLOSED on both branches, blanks are not findings, truncation markers replace silent caps, resume rounds are labeled from the on-disk heal count, heal budget counts per invocation, `lensesRun`/`healMax` recorded; regression test committed at `porting/tests/normalize.test.mjs` (10/10).
**What the gates caught (the point of the exercise):** 7 NUL bytes injected into `plan.md` by its own agent (repo-wide scan: no other file contaminated; the plan agent reported fighting byte corruption mid-run — flags #2/#6 territory); a fictional failure guard in the plan — `jq -c` on this box is **jaq 2.3.0**, exit 0 on empty *and* dead input (fixed to `-ec`, locking both the empty-body and error-envelope cases); **two fail-open branches** in the verdict layer (a lens saying SHIP while listing blockers would have shipped — the exact cited inputs now BLOCK; caught by gates twice, fixed and pinned by test); a heal-budget-on-resume bug (resumed runs could not heal; now counted per invocation); citation rot from the runner diff (line-map.md built; partial coverage carried).
**Recorded carries:** same-lens re-adjudication BLOCKED on the spawn outage — `stealth/space-bunny-alpha` 404, all new agent spawns fail (task probe + eval retries verified; owner John) → queue P2 · `base-red.json` absent until a real batch runs (attribution interpretive) · resumed runs gate against a stale `verify.md` (noted in the runner header) · C3 lacks HTTP-status capture (`-f`) — folds into the P2 re-adjudication · run-dir line citations are point-in-time snapshots.
**Next:** P0 — Wire the Clef judge layer — the loop's first real consumer (clear the spawn outage first).

### CORRECTIONS to the entry above
1. The two round-4 gate reports (`gate-quality.md` 00:58, `gate-spec-fit.md` 01:02) predate runner commit `d5f6b5b` (01:05:01 — reflog) and the object-branch fail-closed fix; each report's own prescribed remedy is the committed state. Both are recorded **SUPERSEDED**, not outstanding — see `porting/certifications/bootstrap-health-sweep.md`.
2. The pending same-lens re-adjudication was replaced by a deterministic certification pass (no agent spawns): HEAD pinned, both gate-cited fail-open inputs re-executed → `BLOCK`/`BLOCK`, regression suite 10/10. The crashed resumption attempts were reconciled: only residue is `run-state.json` parked at `heal:5`; tree clean, no post-commit edits, no fresh gate reports, no `heal-5.md`.
3. Test count corrected: the suite has 10 cases, not 9 — STATE / CHECKPOINT / BUILD-LOG / NEXT-ACTIONS now say 10/10.
4. spec-fit HIGH-3 disposition: `line-map.md` stands as a partial frozen snapshot (heal-4 vintage; 9 of 14 runner citations mapped; runner numbers shifted again post-`d5f6b5b`) — run-dir line citations are point-in-time; not chased further.
5. The spawn outage now blocks only NEW work (the judge wave and P2-class items); the bootstrap order itself is fully closed.
6. **Spawn outage RESOLVED (2026-10-05):** root cause — `~/.omp/agent/config.yml` pinned all 16 subagent types to `commandcode{N}/stealth/space-bunny-alpha:max` (dead provider endpoints), so every spawn failed regardless of session model; all 16 redirected to `commandcode/deepseek/deepseek-v4.1-flash:max` (the route the session's own roles already use). Backup: `config.yml.bak-pre-deepseek-fix`. Live spawn probe green (SpawnProbe2 → "OK", 6.1 s). All work orders unblocked.

## 2026-10-05 — project-init bootstrap (spine + loop)
**Shipped:** `docs/` spine (STATE/CHECKPOINT/LOG/BUILD-LOG/NEXT-ACTIONS), `docs/SKILLS.md`, `docs/judge-layer-ideas.md` (36 ideas), `porting/wf-template.ddw.js` + `porting/wf-batch.ddw.js`, `.omp/commands/{nextgit-start,nextgit-warm,nextgit-continue,goal}.md`, `.omp/agents.md`, `scripts/status-index.mjs` + `docs/status-index.json`; git repo initialized (`b324b73`, `f001a1f`). The acceptance run is the next entry up.
**What the gates caught:** the project-init skill's `references/` ships the contracts but **not** the two DDW template files — authored from the loop-and-gates contract instead (flagged here so nobody hunts for the missing originals). tsc baseline not yet runnable (TypeScript not installed in `platform/`) → recorded carry, queue P2-4.
**Recorded carries:** tsc 4 pre-existing errors (owner unassigned, P2-4) · claude/gemini/opencode CLI auth (owner John) · competition eligibility (owner John).
**Next:** P0 — Wire the Clef judge layer (`AI` binding + `POST /judge` + card chips).

## 2026-10-05 — Tour + judge-layer investigation (Clef vs Jev)
**Shipped:** the interactive tour (`/tour.html` — 10 steps, 4 sims, live-data step; browser-verified) + the NextGit rebrand; verified `@cf/cloudflare/clef` end-to-end from this account (REST, typed answers on real NextGit data); wrote the 36-idea catalog at `docs/judge-layer-ideas.md`; established the wiring plan (`AI` binding + `/judge` + first three card judgments).
**What the gates caught:** calibration nuance — the collision noul came back 0.17 while diff3 flags a real conflict: the noul judges "same function/behavior", the diff3 signal is *adjacency*. Keep the lenses distinct on the card (two different signals, both true).
**Recorded carries:** none new (the earlier REST auth failure was transient — retry worked; noted for the record).
**Next:** same as above — wire it.

## 2026-10-04 — Build waves: worker · UI · scripts · real agents · landing · fork-point
**Shipped:** platform worker (`/changes /proposals /merge /land /events`, secret masking, intent via mirrored notes branch, fork-point change-sets, `landing.status`), triage UI, demo scripts (`seed/agents/real-agents/land`), real CLI agents (omp + codex) producing real proposals, server-side landing (isomorphic-git over the v1 protocol), browser-verified click-to-land (commit `da120ab2` landed agent-3).
**What the gates caught (honest list):** intent text attached to secret-class rows (latent leak — fixed + re-verified); demo `.env` fixture not a realistic env file (fixed); reverse-diff noise after the first live land (fixed by fork-point semantics); 4 script bugs incl. a host gitignore silently eating `.env` (fail-closed check added); my own browser scripts held stale DOM refs during the land test (probe bug, not product).
**Recorded carries:** scratch-repo hygiene (delete after tests — done); `wrangler@latest` needed for Artifacts commands (global wrangler 4.106 lacks them).
**Next:** tour + judge layer (P0).

## 2026-10-03 — SPEC written (bmad-spec)
**Shipped:** `SPEC-next-git-platform` — five-field kernel + 5 companions, preservation-validated (both passes clean); memlog of record.
**Next:** build the convergence layer (done 2026-10-04).

## 2026-10-02 — Analyst session: research → brainstorm
**Shipped:** full read of both source docs + competition terms (rubric: 50% originality/prototype · 25% concurrency · 25% UX); three research dossiers (technical, competitive, feature-matrix — 493 sources) + five recon briefs (Artifacts API, Perforce/game-dev, big-assets/R2, CI/CD, cloud-dev); brainstorming session (91 memlog entries) converged to the convergence layer + MoSCoW demo scope.
**What the gates caught:** the "unlimited hardware" premise from the source conversation is not in any official material (flagged); competition-white space verified absent across 6+ independent sweeps; nearest competitors (GitGhost beta, Whiteboard, Entire) catalogued.
**Recorded carries:** eligibility question (§3 residency) raised same day — still open, owner John.
**Next:** SPEC (written 2026-10-03) → build.
