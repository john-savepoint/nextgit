# HANDOFF — NextGit (read this first, then follow the pointers)

**What this repo is:** NextGit — the agent-era software platform for Cloudflare's "next-gen Git" competition (submission **2026-10-14**, US-resident teammate files the entry; video + repo + run instructions). Core thesis: many AI agents work concurrently; the platform shows **all their proposals as one set**, finds **real collisions** (diff3 on fork-point change-sets), preserves each change's **intent**, and **ships a chosen proposal server-side in one click**. Live: `https://nextgit-platform.john-b7d.workers.dev` (`/` triage UI · `/tour.html` interactive tutorial). Full product context: `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions.

## Read in this order

1. `docs/STATE.md` — the spine: corpus paths, subsystem table, test baseline, standing reds.
2. `docs/CHECKPOINT.md` — append-only session/batch record (newest first) incl. CORRECTIONS blocks.
3. This file's system map below → then the code.
4. `docs/SKILLS.md` + `.omp/agents.md` — skill load paths, loop roster, skill packs.
5. `_bmad-output/planning-artifacts/` — research dossiers, brief, ux-designs, architecture spine, PRDs (current wave).

## The systems

| System | Where | What it is |
|---|---|---|
| **Platform (product)** | `platform/` | Live Cloudflare Worker + UI. `src/index.ts` (API: `/health /changes /proposals /merge /land /events`), `ui/` (triage UI + tour; vanilla ES modules), `scripts/` (`seed.mjs` baseline · `agents.mjs` scripted · `real-agents.mjs` REAL CLI agents · `land.mjs` · `fanout.mjs`), `CONTRACT.md` (frozen API v2 — read before touching), `wrangler.jsonc` (Artifacts + KV + assets bindings). Deploy: `npx wrangler@latest deploy` from `platform/`. Demo reset: `node platform/scripts/seed.mjs && node platform/scripts/real-agents.mjs`. |
| **Task store (the queue)** | `porting/tasks.db` + `porting/tasks.mjs` | SQLite (bun:sqlite, WAL, claims, events). THE queue — `docs/NEXT-ACTIONS.md` is a DERIVED view (`tasks.mjs view`); never hand-edit. CLI: `next` `list [--json]` `add` `set` `claim` `release` `view` `query` (read-only). Claims are the collision guard across concurrent sessions. |
| **Loop machinery** | `porting/wf-template.ddw.js` (v3.2) + `porting/wf-batch.ddw.js` | DDW runners. Template: PLAN→IMPLEMENT→VERIFY→GATE→HEAL(budgeted, file-partitioned)→REPORT, specialist routing (`DEFAULT_AGENTS`), skill hints (`SKILL_HINTS`), fail-closed verdicts (`normalizeVerdict`). Batch: claim-safe queue pick → orders (sequential) → **PARITY GATE (almost-last: no lost behavior vs pre-batch commit; declared removals pass; tests substitute)** → merged gate. Run via one-liner import; NEVER transcribe. |
| **Specialists** | `~/.omp/agent/agents/*.md` | plan-agent · wf-implementer (only writer) · wf-verifier · heal-researcher · senior/security-reviewer · reviewer · compliance-reviewer (created here) · parity-auditor · designer · scout etc. Read-only roles → the RUNNER persists artifacts from schema returns. |
| **Tests** | `porting/tests/{normalize,tasks,batch}.test.mjs` | normalize: 19 cases incl. fail-closed + pinned-shape adapters + roster pins. tasks: 52 incl. two-process claim contention. **batch: 24 checks** — the batch composition path (claim → orders → parity gate → merged gate), gate ordering, fail-closed cases, temp-store isolation. Run all three after machinery edits. |
| **Records** | `docs/{STATE,CHECKPOINT,LOG,BUILD-LOG,NEXT-ACTIONS,status-index.json}` + `porting/certifications/` | status-index regenerated at every commit (`bun scripts/status-index.mjs`; pre-commit hook enforces freshness — `git config core.hooksPath`). |
| **Run evidence** | `porting/runs/<order-id>/` (gitignored) | plan.md, implement.md, verify.md, gate-*.md, heal-N*.md, result.json, run-state.json per order; batches add gate-parity.md + gate-merged.md + report.json. point-in-time snapshots. |
| **Registry** | `porting/tasks.db` (~511 rows) | everything discussed, itemized with priority/layer/scope/acceptance/Ref. Merged via `porting/merge-harvest.mjs` (audit: `porting/certifications/harvest-merge-*.md`). |

## Rules that bite (learned the hard way)

- Workers never commit; the orchestrator commits at green gates only. One writer per file.
- Commits require a fresh status index (hook blocks otherwise). `wrangler@latest` for Artifacts commands (global 4.106 lacks them).
- `jq` on this box is **jaq** — exit 0 on empty/dead input; check pipelines use `-ec`. Never ship a check whose failure-mode claim wasn't executed (flag #7).
- Fail CLOSED everywhere: a SHIP verdict carrying findings is a BLOCK; missing verdicts are BLOCKs.
- `runBatch` binds its `agent` option as **`agentOpt`** on purpose — the bare name `agent` must stay the DDW spawn global (shadowing it crashes every batch at the parity gate; pinned by `batch.test.mjs`). Keep it.
- Out-of-band syncs are writers: never rewrite a dirty path inside an in-flight order's IMPLEMENT→GATE window (rule + recovery procedure in `.omp/agents.md:7`).
- Subagent model routing: `~/.omp/agent/config.yml` `agentModelOverrides` (all → `commandcode/deepseek/deepseek-v4.1-flash:max` after the space-bunny outage; backup at `config.yml.bak-pre-deepseek-fix`).
- Secrets: never in argv/records; wrangler OAuth at `~/.config/.wrangler/config/default.toml`.

## Where work is decided

`bun porting/tasks.mjs next` → the top unblocked pending row (claims-aware). Current top of the wave: judge layer (`wire-the-clef-judge-layer` — Clef decision model on Workers AI; catalog `docs/judge-layer-ideas.md`), then PRD → epics → systematic build, then demo/video/submission package. `docs/NEXT-ACTIONS.md` is the readable mirror; `docs/status-index.json` the queryable one.
