# State — NextGit

**Last updated:** 2026-10-06 (architecture spine through a 4-lens gate — live HIGH fixes `d0d8b17`; task store live — SQLite queue, 52/52 tests, derived `NEXT-ACTIONS.md`; registry harvest wave running; judge layer next)
**Branch:** `main` · **Last commit:** `7ca477b` (architecture follow-ups; this batch: sqlite closure + spine updates)
**Test baseline:** `node --check platform/ui/app.js && node --check platform/ui/tour.js` (clean) · `node porting/tests/normalize.test.mjs` (10/10 PASS) · `bun porting/tests/tasks.test.mjs` (52/52 PASS) · live smoke: C2 `/health` → `ok:true`; C3 `/proposals | jq -ec .summary` → 5-key summary · `bun scripts/status-index.mjs --check` → current — **enforced at every commit: repo-local `core.hooksPath=.git/hooks` (re-armed 2026-10-06; proven by a blocked stale-index commit)**. Current status: **GREEN**; standing reds below.
**Corpus spine (read these first — recorded 2026-10-05):**
- `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions (`demo-scope.md`, `engineering-laws.md`, `stack.md`, `interface-contract.md`, `fork-community.md`) — the frozen contract
- `platform/CONTRACT.md` — frozen platform API v2
- `_bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md` — technical dossier (convergence layer; feasibility)
- `_bmad-output/planning-artifacts/research/competitive-multi-agent-git-platform-landscape-2026-10-02/research.md` — competitive dossier (whitespace verified)
- `research/2026-10-02-agentic-git-platform-ecosystem-feature-matrix/report.md` — 493-source feature matrix
- `research/2026-10-02-platform-recon-briefs/*.md` — Artifacts / Perforce / big-assets / CI-CD / cloud-dev recon briefs
- `_bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md` — session record (91 entries)
- `docs/judge-layer-ideas.md` — the 36-idea judge-layer catalog (Clef/Jev)
- Competition terms: key constraints captured in `SPEC.md → Constraints` (eligibility OPEN — owner John)

NextGit is the agent-era software platform: many AI agents work concurrently on one codebase; the platform shows **all their proposals as one set**, finds **real collisions** (diff3 merge simulation, fork-point change-sets), preserves each change's **intent**, and **ships a chosen proposal server-side in one click**. Web-first, built on Cloudflare Workers + Artifacts (no mocks). It is NOT yet a full GitHub replacement (repo browsing, issues, CI are roadmap), and the Agent Office 3D client is a future API consumer — not a build target.

| Subsystem | State | Evidence / next |
|---|---|---|
| Platform worker (`platform/src/index.ts`) | shipped | live: `/health /changes /proposals /merge /land /events`; latest deploy 2026-10-05 (tour version). Next: add `AI` binding + `/judge` (queue P0) |
| Triage UI + tour (`platform/ui/`) | shipped | live at `/` and `/tour.html`; click-to-land verified in real browser; landed-state via `landing.status` |
| Demo scripts (`platform/scripts/`) | shipped | `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (REAL CLI agents) · `land.mjs` (lands or refuses) — reproducible two-command demo |
| Real agent fleet | working (2 CLIs) | omp + codex verified producing real proposals; claude/gemini/opencode need logins (standing reds, John) |
| Judge layer (Clef) | verified callable | live typed answers 2026-10-05 (~1.3 s REST, ~$0.00012/call); catalog in `docs/judge-layer-ideas.md`; NOT yet wired |
| State spine + loop | shipped | task store `porting/tasks.db` (SQLite/WAL/claims; CLI `bun porting/tasks.mjs`; `NEXT-ACTIONS.md` derived) + runner; two orders GREEN (`bootstrap-health-sweep` 2026-10-05, `sqlite-task-backbone` 2026-10-06); tests `porting/tests/{normalize,tasks}.test.mjs` |
| Architecture spine | shipped | 15 ADs at `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/`; lint 0; 4-lens gate (`reviews/`); live HIGH fixes `d0d8b17`; governs every unit below |
| Planning artifacts | in flight | SPEC ✓; architecture spine ✓ (15 ADs); briefs + ux-designs runs in progress (parallel session); PRD pending (queue P0) |
| Submission package | not started | video + README + LICENSE + repo curation + eligibility — queue P0/P1 |

## Standing red set (pre-existing, owned)

| Red | Owner | Why not fixed |
|---|---|---|
| `claude` CLI auth (401 OAuth expired) | John | one `claude login` (≈30 s); unlocks a marquee demo agent |
| `gemini` + `opencode` CLI auth | John | optional demo agents; need auth setup |
| 4 pre-existing tsc errors in `platform/` | unassigned | recorded from build waves; fix with a TypeScript pass (queue P2-4); verify after installing TS |
| Eligibility — US/Canada residency (competition §3) | John | decision, not code; blocks the submission path if absent |
