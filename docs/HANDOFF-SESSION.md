# HANDOFF — 2026-10-09 (session end)

Self-sufficient handoff. A fresh session should read this + `docs/STATE.md` + `docs/CHECKPOINT.md` and be able to continue with **no other context**.

## TL;DR

All 10 wave-7 lanes are **merged in a transactional integration worktree** and the **full battery is RUNNING RIGHT NOW** (background job). When green: finalize (FF main) → tick ~25 rows → deploy → live gates → wave 8 under the optimization rules. If red: fix in the worktree, re-run battery, then finalize. Nothing has touched `main` yet — that's the point of O1.

## Exact state (as of this handoff)

| Thing | Where / value |
|---|---|
| Main repo | `/home/johnzealanddoyle/projects/cloudflare-git-comp` — main branch, clean, `git log -1` = commit below |
| Integration worktree | `.worktrees/integrate-wave7` on branch `integrate-wave7` (HEAD `9b7265b`) — **all 10 lanes merged** (49 files, +15,812/−720); merge log: `porting/runs/integrate-wave7/merges.ndjson`; state: `…/state.json` |
| Battery | `porting/runs/integrate-wave7/battery.json` — written when the background run finishes; **check this first** |
| Lane durability | `refs/lane/lane-1..10` in the MAIN repo (the `.fleet/` clones are gitignore-fragile; these refs are the source of record) |
| Store | bd store (`.beads/`) — 72/148 compile rows done, 0 claims |
| Live worker | `nextgit-platform.john-b7d.workers.dev` — deploy of record `22ccbd62` (judge rule fix). Demo-verify 25/25 at last check. |
| Models | `@workflows` role in BOTH config layers (global `~/.omp/agent/config.yml` + project `.omp/config.yml`); resolved = `commandcode/inclusionai/ling-3.1-flash:free`. Do NOT use `&workflows` (invalid — falls back to default). |

## Resume: THE NEXT TEN COMMANDS

```bash
cd /home/johnzealanddoyle/projects/cloudflare-git-comp
# 0. battery result (the gate for everything):
jq '{green, failed, total: (.results|length)}' porting/runs/integrate-wave7/battery.json
# 1. if green — finalize (FFs main to the integrated head; refuses if main dirty or diverged):
bun -e "const I=await import('./porting/wf-integrate.ddw.js'); console.log(JSON.stringify(await I.finalize({root:process.cwd(), id:'wave7'})))"
# 2. if red — fix the failing suite(s) IN .worktrees/integrate-wave7, commit there, re-run:
bun -e "const I=await import('./porting/wf-integrate.ddw.js'); console.log(JSON.stringify(await I.battery({root:process.cwd(), id:'wave7'})))"
# 3. clean up the worktree after finalize:
git worktree remove .worktrees/integrate-wave7 && git branch -D integrate-wave7
# 4. tick the wave-7 rows that are GREEN with "caller may tick" (list first, then tick):
#    order ids live in refs/lane/* run evidence; see "Row ticking" below
# 5. regenerate derived views + commit:
bun porting/tasks.mjs view && bun scripts/status-index.mjs && git add -A && git commit -m "wave 7 integrated: <n> orders"
# 6. deploy (lockfile-pinned wrangler — NEVER @latest for deploy; @latest only for artifacts/kv commands):
cd platform && npx wrangler deploy 2>&1 | tail -4 && cd ..
# 7. live gates (both MUST pass before any wave):
node porting/tests/live-render.probe.mjs && node platform/scripts/demo-verify.mjs
# 8. if the deploy changed judge/events behaviour ALSO run:
bun porting/tests/judge.test.mjs && bun porting/tests/events-consumer.test.mjs
# 9. THEN wave 8 under O2/O3/O7 (below).
# 10. if anything is unclear: docs/DIAGNOSIS-2026-10-09.md (why we stopped) + docs/CHECKPOINT.md (chronology).
```

## Row ticking (wave-7 orders)

~25 orders are GREEN in lane run dirs (`porting/runs/nextgit-*/result.json` with `verdict: GREEN`). Cross-reference against the store before ticking:

```bash
for f in porting/runs/nextgit-*/result.json; do jq -r --arg d "$(dirname $f)" '"\($d|split("/")[2]) \(.verdict)"' "$f"; done | sort -u | grep GREEN
# tick each pending+GREEN row:
bun porting/tasks.mjs set <nextgit-id> --status done --evidence "wave-7 GREEN; evidence porting/runs/<id>/; integrated <finalize-sha>"
```

Do NOT tick rows whose verdict is not GREEN. `e5-verify-typed-signal-envelope` was BLOCKED in wave 6 — leave pending.

## The laws that cost us blood (do not relearn)

From `.omp/agents.md` flags 1–10, the ones that bit THIS week:
- **#9 prefix law** — all bd ids are `nextgit-<slug>`; cross-prefix deps silently stop blocking.
- **#10 `.env` gitignore trap** — `~/.gitignore_global` ignores `.env`; fixture pushes need `git add -f config/.env` (silent no-op otherwise — cost a restore cycle).
- **Demo-safety** — never push into `demo`/`agent-1..5`; scratch repos must NOT start with `agent-` (they surface as phantom proposals). reset-agent-1.mjs exists but prefer the canonical chain: `seed.mjs → agents.mjs → secret-fixture.mjs → demo-verify.mjs` (25/25).
- **Deployed-but-uncommitted = lost** — the e10 judge fix was deployed once, never committed, and a rebuild clobbered it. ALWAYS commit before/with deploy.
- **`@workflows` role** — not `&workflows`.
- **Path law for agents** — edit/write tools resolve against session cwd; absolute paths only.

## After integration: wave 8 under the optimization rules (O2/O3/O7 from docs/DIAGNOSIS-2026-10-09.md)

1. **O2 — file-ownership pre-pass:** before a wave, group the pending orders by their scope's touched files; single-owner for shared files (runner, `platform/src/index.ts`); no two lanes on the same file.
2. **O3 — risk-tiered lenses:** 4 lenses for risky orders (platform/src, auth, landing, secrets), 2 for docs/tests-only orders.
3. **O7 — spawn accounting:** record spawn count per wave in the wave report; hard stop at ~120 spawns/wave.
4. Fleet: `runFleet({lanes, limit, parallel})` — 10 lanes × 3 = 30 concurrent worked; keep the chrome-slot guard ON (PATH shim in `.fleet/bin`), keep `sourceLike: "compile:compile-2026-10-06T13-31-51"`, keep main-clean gate (runFleet refuses integration on a dirty main — commit/stash first).
5. Never merge lanes directly into main — **only through `wf-integrate`** (this session's O1). That's the standing rule now.

## What was IN this integration (so a reviewer knows what landed)

Lane 1: param validation + `GET /landings/*` route + landed-card suite. Lane 2: e1 degrade + e10 landing-decision note. Lane 3: event-consumer hardening + parseProposalsQuery validation + (deleted reset-agent-1.mjs — overridden, see below). Lane 4: card-contract states + events suites. Lane 5: shim/tsc fixes + cache tests + polling-cadence + shim d.ts. Lane 6: fleet-floor N4 + reset-agent-1 improvements (**kept** — deletion from lane-3 was deliberate but lane-6's improved version is the better artifact; resolved in `9b7265b` lineage) + `submission/` (incl. a 7MB demo mp4!). Lane 7: harness registry + workspace manifest. Lane 8: cache-key validation + ctx.waitUntil. Lane 9: secret-egress + judge mixed-repo fix (already on main from the correction cycle — merge carried only comments). Lane 10: e3 landing-decision + E8 auth chokepoint (`AUTH_MODE`, `EVENTS_HUB`, VERIFY-gate docs section).

**Conflict resolutions of record:** reset-agent-1.mjs → kept lane-6's improved version (lane-3 deleted deliberately — both defensible; lane-6's is newer and was used successfully today). judge/secret-egress tests → ours (lane-9 versions) + `CACHE`/`AUTH_MODE` added to `envFor` in both (empirically verified green). agents.md → our corrected Project facts + lane-10's VERIFY-gate section.

## Known open items (not blockers)

- `porting/tests/events-queue-consumes-live.test.mjs` — matcher fixed to accept normalized `repo.pushed`; the 300s delivery window is long; fine.
- `submission/nextgit-demo.mp4` is 7MB — check whether the submission pipeline wants it committed or gitignored before public repo curation.
- `porting/tests/proposals-conflict-map.test.mjs` — was batted around during the wave; battery will say.
- The `wf-integrate` finalize was just patched to FF via `merge --ff-only` (was `update-ref`, which would have stranded main's working tree). Patch is committed; the running battery used the pre-patch tree only for merging (unaffected).

## Session artifacts

- `docs/DIAGNOSIS-2026-10-09.md` — the full "what went wrong + O1–O8" report.
- `docs/abort-forensics-2026-10-09.md` — the aborted-agents investigation (harness-side: 7-min idle→dispose after successful yield; missing cross-worktree file in a gate yield).
- `docs/CHECKPOINT.md` — chronological entries incl. the correction cycle.
- `porting/runs/integrate-wave7/` — state.json, merges.ndjson, battery.json (when finished).
