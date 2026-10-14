# State — NextGit

**Last updated:** 2026-10-14 (WAVE 17 CLOSED — **8 lanes / 9 orders** (max concurrency, direct composition, resume): 6 orders GREEN + 1 partial + fingerprint never-started + gate-extension aborted-by-watchdog. Shipped: **post-merge silent-drop guard** (detectDroppedChanges over forLand contributions; `409 silent-drop-detected` between conflict and no-changes; CONTRACT law + closed DropCause vocabulary; 35-check suite incl. real-worker R1/R2); **GET /pipelines** (landing records → pipeline runs, honest statuses, 43-check API + 3 Chrome legs, UI panel); **convergence rail** (per-repo governance timeline, render-only from live data; 47-check suite); **issues v2 code+contract half** (repo-scoped KV store, POST /issues + PATCH close-once, kind:derived|stored merge, `/issues:write` 20/60s, **csrfGate extended to PATCH**, CONTRACT v3.8 — suite+UI deferred); **machinery**: auto-close/parity race FIXED (single-source verdict, close-then-record, resume-idempotent — scenarios 14/15) + `claim-many` batched picker + **whitelist-parity guard** (caught a real wave-17 omission at integration — CONTRACT UI list missing pipelines/rail) + deterministic CHROME_BIN discovery; docs refresh (HANDOFF v3.7 + 17 route rows, STATE row, parity citations re-anchored; lifecycle abort-transition doc claims corrected to the rule file's truth). Integrated `4f31edd → 1131de2` (**battery 129/129**); deployed **`47d28485`**. Store: 288 done / 2 partial / 412 pending.)
**Branch:** `main` · **Last commit:** `1131de2` (+ this record) — see `docs/CHECKPOINT.md` top entry
**Test baseline:** full battery **129/129** (CHROME_BIN exported) · `tsc --noEmit` **0 errors** · live smoke: demo-verify 25/25 · submission-live gate · six-probe gate · land-hardening rc=0 (attestation live). Current status: **GREEN**; standing reds below.
**Next:** wave 18 = `changeset-fingerprint`, the `submission-gate-extension` re-run, issues-v2 tests+UI (partial → done), then the remaining below-dim gaps. Recurring machinery notes: battery Chrome-suite contention (two reds across three wave-17 battery runs, each green standalone); union-resolver mid-block truncation (caught by structural counts twice, rebuilt from refs).
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
| Platform worker (`platform/src/index.ts`) | shipped | live: `/health /changes /proposals /merge /land /judge /intents /forks /events /events/stream /reveal /floors /proposals/{repo} /whoami /upstream /sessions /sessions/{repo}/steer /asset/{blobId} /asset/{blobId}/presign /asset/uploads /asset/uploads/{uploadId}/complete /tree /file /commits /raw/{repo} /comments GET+POST /checks /agents /harnesses /issues GET` + rate limits (in-isolate fixed windows); **AD-11 auto-land gate: OFF by default** (`platform/src/autoland.ts` — record-gated engagement switch + non-model corroboration interlock); **R2 asset tier live** (`ASSET_BLOB` → `nextgit-asset-blobs`; `assets/*.asset.json` pointers, metadata-only rendering — FR-47); deployed `f6e932fb` (wave 11; wave 10 `e5f72117`; judge `0518de12`; land hardening `69b59673`) |
| Push budget (land path + runner pushes) | shipped | push budget 16 MiB + incremental land increments (4 files per commit/push) — the ~64 MiB Artifacts cap (research.md:65) is unreachable by construction: every seam measures its payload and fails closed BEFORE the wire call (`platform/src/push-budget.ts`, `platform/scripts/lib/push-guard.mjs`; suites `porting/tests/{push-budget,land-incremental,script-push-guard}.test.mjs`) |
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
