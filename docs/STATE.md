# State — NextGit

**Last updated:** 2026-10-12 (WAVE 10 FORMALLY CLOSED — 3/3 orders GREEN (gate-chain ×2 / verdict-ui); integrated `3e587a9 → 585227c4` via wf-integrate; **battery 89/89 GREEN**; deployed **`e5f72117`** — POST /intents CAP-10 matcher, auto-land **OFF by default** (record-gated `autoland.ts` switch + non-model corroboration interlock), verdict-render UI; five-probe gate green (live-render 8/8 · demo 25/25 · land-hardening · egress-guard · colliding-land-refusal); stray scratch repos cleaned + cache busted → demo 25/25; **143/148 done, 5 pending** — wave 11 = six-cluster (matcher dep now done) + `e12` ×4 (gated on the R2 asset-tier manifest row))
**Branch:** `main` · **Last commit:** `585227c4` (+ this record) — see `docs/CHECKPOINT.md` top entry
**Test baseline:** full battery **89/89** (classify by EXIT CODE — output shapes vary; e.g. `PASS — N/N checks green`) · `tsc --noEmit` **0 errors** · live smoke: demo-verify 25/25 · live-render probe 8/8 · `bun scripts/status-index.mjs --check` → current — **enforced at every commit: pre-commit chain = status-index check + bd integration (`.beads/hooks`, core.hooksPath)**. Current status: **GREEN**; standing reds below.
**Corpus spine (read these first — recorded 2026-10-05):**
- `docs/HANDOFF-PLATFORM.md` — **authoritative platform handoff** (inventory, endpoints, invariants, production gaps, verification recipes, lessons) — for anyone building on the platform
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
| Platform worker (`platform/src/index.ts`) | shipped | live: `/health /changes /proposals /merge /land /judge /intents /events /events/stream /reveal /floors /proposals/{repo} /whoami /upstream` + rate limits (in-isolate fixed windows); **AD-11 auto-land gate: OFF by default** (`platform/src/autoland.ts` — record-gated engagement switch + non-model corroboration interlock; engagement-check.mjs deploy guard); deployed `e5f72117` (wave 10; wave 9 `a437b90b`; judge `0518de12`; land hardening `69b59673`) |
| Triage UI + tour (`platform/ui/`) | shipped | live at `/` and `/tour.html`; click-to-land verified in real browser; landed-state via `landing.status` |
| Demo scripts (`platform/scripts/`) | shipped | `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (REAL CLI agents) · `land.mjs` · `secret-fixture.mjs` (agent-5 secret fixture) · `demo-verify.mjs` (canonical live-state check, 25/25) — reproducible reset + pre-recording gate |
| Demo fleet | fresh + recording-ready | canonical chain re-run 2026-10-11 (`seed → agents → secret-fixture → demo-verify` **25/25**, all-pending with intents + collision); real-CLI variant = `real-agents.mjs` (verified 25/25 during wave 8); claude/gemini/opencode remain unauth (standing reds, John) |
| Judge layer (Clef) | wired + live | `POST /judge` live (pinned envelope; egress masking; fail-closed 503); chips render in-browser on agent-1/2/4; skipped/landed render none (2026-10-06); suite `porting/tests/judge.test.mjs` 73/73 |
| State spine + loop | shipped | task store = **bd (beads/Dolt) at `.beads/`** — 674 issues (661 tasks + 13 epics, canonical `nextgit-` ids); CLI `bun porting/tasks.mjs` (adapter: next/list/done-ids/set/claim/heartbeat/release/reclaim/upsert/activate/view); `NEXT-ACTIONS.md` derived; runner v3 + worktree-parallel batches (**ALL-GREEN auto-close** with evidence; heartbeat + reclaim); suites `porting/tests/{normalize,tasks,batch}.test.mjs` (43+47 checks, BEADS_DIR-isolated) |
| Architecture spine | shipped | 15 ADs at `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/`; lint 0; 4-lens gate (`reviews/`); live HIGH fixes `d0d8b17`; governs every unit below |
| Planning artifacts | mixed → compiling | SPEC ✓; architecture spine ✓ (15 ADs); brief FINAL ✓; PRD ✓ (`1e58c50` — FR-1..47, M1–M4); ux-designs ✓ (partial — 4 LIVE conflicts await John); **epics compiled ✓** (13 epics / 21 slices / 148 stories, staged in the bd store 2026-10-07) |
| Submission package | in progress | README ✓ + LICENSE (MIT) ✓ with run instructions ✓ (2026-10-06); recording + repo curation + single-entry filing remain — John/next agents |

## Standing red set (pre-existing, owned)

| Red | Owner | Why not fixed |
|---|---|---|
| `claude` CLI auth (401 OAuth expired) | John | one `claude login` (≈30 s); unlocks a marquee demo agent |
| `codex` CLI usage-limited; `pi` insufficient balance | John | fleet currently runs all-omp; restore when quotas reset — optional demo agents |
| `gemini` + `opencode` CLI auth | John | optional demo agents; need auth setup |

*(tsc red RESOLVED 2026-10-10: the wave-7 artifacts-shim fixed the ArtifactsRepo surface — `tsc --noEmit` 0 errors, verified.)*
