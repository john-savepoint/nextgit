# State — NextGit

**Last updated:** 2026-10-06 (judge layer WIRED + chips browser-verified (0 heals; suite 73/73); brief FINAL; eligibility RESOLVED — US teammate files the entry; next: land hardening → demo chain; PRD handled by the parallel agent)
**Branch:** `main` · **Last commit:** `2cb2864` (brief finalize + eligibility resolution; v3 machinery in `1619073`)
**Test baseline:** `node --check platform/ui/app.js && node --check platform/ui/tour.js` (clean) · `node porting/tests/normalize.test.mjs` (ALL PASS) · `bun porting/tests/tasks.test.mjs` (ALL PASS, exit 0) · live smoke: C2 `/health` → `ok:true`; C3 `/proposals | jq -ec .summary` → 5-key summary · `bun scripts/status-index.mjs --check` → current — **enforced at every commit: repo-local `core.hooksPath=.git/hooks` (re-armed 2026-10-06; proven by a blocked stale-index commit)**. Current status: **GREEN**; standing reds below.
**Corpus spine (read these first — recorded 2026-10-05):**
- `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions (`demo-scope.md`, `engineering-laws.md`, `stack.md`, `interface-contract.md`, `fork-community.md`) — the frozen contract
- `platform/CONTRACT.md` — frozen platform API v2
- `_bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md` — technical dossier (convergence layer; feasibility)
- `_bmad-output/planning-artifacts/research/competitive-multi-agent-git-platform-landscape-2026-10-02/research.md` — competitive dossier (whitespace verified)
- `research/2026-10-02-agentic-git-platform-ecosystem-feature-matrix/report.md` — 493-source feature matrix
- `research/2026-10-02-platform-recon-briefs/*.md` — Artifacts / Perforce / big-assets / CI-CD / cloud-dev recon briefs
- `_bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md` — session record (91 entries)
- `docs/judge-layer-ideas.md` — the 36-idea judge-layer catalog (Clef/Jev)
- Competition terms: key constraints captured in `SPEC.md → Constraints` (eligibility RESOLVED 2026-10-06 — US-resident teammate files the entry)

NextGit is the agent-era software platform: many AI agents work concurrently on one codebase; the platform shows **all their proposals as one set**, finds **real collisions** (diff3 merge simulation, fork-point change-sets), preserves each change's **intent**, and **ships a chosen proposal server-side in one click**. Web-first, built on Cloudflare Workers + Artifacts (no mocks). It is NOT yet a full GitHub replacement (repo browsing, issues, CI are roadmap), and the Agent Office 3D client is a future API consumer — not a build target.

| Subsystem | State | Evidence / next |
|---|---|---|
| Platform worker (`platform/src/index.ts`) | shipped | live: `/health /changes /proposals /merge /land /events`; latest deploy 2026-10-05 (tour version). Next: add `AI` binding + `/judge` (queue P0) |
| Triage UI + tour (`platform/ui/`) | shipped | live at `/` and `/tour.html`; click-to-land verified in real browser; landed-state via `landing.status` |
| Demo scripts (`platform/scripts/`) | shipped | `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (REAL CLI agents) · `land.mjs` (lands or refuses) — reproducible two-command demo |
| Real agent fleet | working (2 CLIs) | omp + codex verified producing real proposals; claude/gemini/opencode need logins (standing reds, John) |
| Judge layer (Clef) | wired + live | `POST /judge` live (pinned envelope; egress masking; fail-closed 503); chips render in-browser on agent-1/2/4; skipped/landed render none (2026-10-06); suite `porting/tests/judge.test.mjs` 73/73 |
| State spine + loop | shipped | task store `porting/tasks.db` (SQLite/WAL/claims; CLI `bun porting/tasks.mjs`; `NEXT-ACTIONS.md` derived) — **506 rows, registry populated**; runner v3 specialist routing (self-test GREEN — `porting/runs/wf-v3-selftest/`); claim-safe batches; tests `porting/tests/{normalize,tasks}.test.mjs` |
| Architecture spine | shipped | 15 ADs at `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/`; lint 0; 4-lens gate (`reviews/`); live HIGH fixes `d0d8b17`; governs every unit below |
| Planning artifacts | mixed | SPEC ✓; architecture spine ✓ (15 ADs); brief FINAL ✓ (polish applied 2026-10-06); ux-designs landed ✓ (partial — key-screen mock + 4 LIVE conflicts await John); PRD + epics pending (queue) |
| Submission package | not started | video + README + LICENSE + repo curation (eligibility resolved 2026-10-06) — queue P0/P1 |

## Standing red set (pre-existing, owned)

| Red | Owner | Why not fixed |
|---|---|---|
| `claude` CLI auth (401 OAuth expired) | John | one `claude login` (≈30 s); unlocks a marquee demo agent |
| `gemini` + `opencode` CLI auth | John | optional demo agents; need auth setup |
| 4 pre-existing tsc errors in `platform/` | unassigned | recorded from build waves; fix with a TypeScript pass (queue P2-4); verify after installing TS |
