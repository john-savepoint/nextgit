# Diagnosis & Optimization — 2026-10-09

Written at John's instruction after stopping all waves: "hundreds of agents to end up on a broken main."
Everything below is measured from disk/API, not reconstructed from memory.

## 1. Cost ledger (measured)

| Metric | Value |
|---|---|
| Subagent sessions spawned **today alone** | **622** (`~/.omp/agent/sessions/…` jsonl count, Oct 9) |
| Order executions today | 59 (`porting/runs/nextgit-*` run dirs) |
| Batch dirs today | 21 |
| Fleet waves attempted today | 3 (machine-kill mid-wave; crash mid-integration; completed-then-died pre-integration) |
| Gated lane work **not integrated** | **43 commits across 10 lanes ≈ 25 orders** (E3 landing-decision, E4 SSE, E5 judge/injection, E6 content-detection/masking, E7 harness registry, E8 auth chokepoint, E10 submission bundle…) |
| Store | 72/148 done · 76 pending · 0 claims (stale 29 released) |
| Live | demo + agent-1..5 only · demo-verify **25/25** · live-render probe OK · main clean `324a24c`, tsc 0 errors |

## 2. Incident ledger (what actually broke, in order)

1. **Machine kill mid-wave** (external). Recovery design held: resume-from-disk worked; no data loss beyond in-flight spawns.
2. **Orphaned session's integration crash → half-merged main.** The integration step merged lanes DIRECTLY into the live tree; the process died mid-merge, leaving `index.ts` importing a missing `auth.ts`, syntax-broken probes, a 40MB tarball, and an unpacked `package/` dir. Hand-reverted; patch preserved at `/tmp/main-halfmerge-20261009.patch`; main verified clean + tsc 0. **This is the "broken main" John saw. Twice now this class has occurred (earlier: phantom merge).**
3. **Demo fixture mutation + a lost deploy.** `events-queue-consumes-live` pushed 3 `e4-test:` commits into **agent-1** (a demo fixture), destroying its change-set + intent, and left **8 `agent-e4s-*` scratch repos** polluting `/proposals` auto-discovery (5 fixtures + 8 strays = 13 cards; 28 of the 30 phantom conflict-pairs were MARKER add/add noise between strays). Repaired: agent-1 reset, strays deleted, cache forced fresh. **Second defect surfaced during repair — a deployment that silently regressed:** agent-4's `config/.env` is *intentional fixture design* (`agents.mjs` writes it so the schema-only view renders key names) — but the worker's judge rule skipped any repo merely *containing* a secret file, so mixed agent-4 was skipped. The e10 order had already fixed this (`files.length > 0 && files.every(isSecretPath)` → only all-secret repos skip; mixed repos judged with the `.env` masked) and it was **deployed live at 04:01Z (25/25 verified) but never committed** — a later rebuild redeployed the old rule and the green state silently regressed. Fix restored to main (+ `judge.test.mjs` test-16 mixed-repo case) and redeployed `22ccbd62`; agent-4's `.env` restored to design. **Root causes: a live-verified test whose target was the demo fixture; scratch naming under `agent-*` (discovery-visible); cleanup skipped on abort; deployed-but-uncommitted fixes; rebuilds without a regression recheck.**
4. **Real aborts investigated** (John's question). Report: `docs/abort-forensics-2026-10-09.md`. Verdict: **harness-side, not the provider.** Agent-1's yield succeeded ("Result submitted.") then the session idled ~7:00 and was disposed (`session_exit dispose/normal`); the parent ledger still counted it **aborted** and spawned retries (-2/-4). Agent-2's yield tool call itself failed on a **missing cross-worktree file** (`Cannot read file: …/lane-1/.worktrees/…/landLeaseDO.ts`). No HTTP/stream errors, no max_tokens cutoff, tokens 115K/108K ≪ 256K. Fixes: reconcile the job ledger on yield; examine the 7-min idle→dispose timer; gates should verify file existence before reading sibling-worktree paths.
5. **Integration throughput collapse.** Three waves ran ~30-wide each, but integration (merge → resolve → tick → battery → deploy → live-verify) is single-threaded and hand-driven. Crashes during integration cost whole waves' landings; the last session died before integrating anything. Result: 622 agents of output piled into 43 unintegrated commits.

## 3. Systemic root causes

1. **Generation ≫ absorption.** The fleet generates ~30 gated orders per wave, each ~8 sub-agents (plan/impl/verify/4 lenses/batch gates). Integration absorbs one lane at a time, manually, with conflicts. Until integration is transactional and automated, more concurrency makes the pile worse, not progress.
2. **Shared-file contention without ownership.** Orders legitimately touch the same files (runner, `index.ts`, shared suites). Lanes duplicated fixes: the same `execFileSync` import bug was fixed **3×**, the tsc/CACHE work **2×**, cache-key work **2×** — churn plus merge conflicts.
3. **Verification blind spots in both directions.** False positives (sha1-vs-sha256 guard; lockfile misread; expired OAuth mid-run) burned heal rounds (~8 spawns each). False negatives: fixture-only suites that stay green after refactors gut them; no live-page gate existed until today.
4. **Write isolation is prompt-only.** Agents' `edit`/`write` tools resolve paths against the session cwd (main tree) — every wave leaked files into main. Lands mitigations already; not yet structurally impossible.
5. **No spawn accounting.** 622 sessions/day went unremarked until the end. No per-wave budget or cap.

## 4. Optimization plan (ranked, concrete)

- **O1 — Transactional integration (do first).** `porting/wf-integrate.ddw.js`: create an integration worktree; merge all green lane branches there; run the full battery + tsc; only on all-green fast-forward `main`; then deploy + live gates. Never merge into the live tree. Pre-flight: abort/complete any lingering `MERGE_HEAD`. Any failure = nothing changed on main. This kills incident class #2 permanently and makes integration one command.
- **O2 — File-ownership scheduling pre-pass.** Parse picked orders' scopes → touched-file sets; assign conflict-free groups per lane; serialize overlapping orders; law: runner/shared files are single-owner (one lane per wave).
- **O3 — Risk-tiered lensing.** 4 lenses for high-risk orders (platform/src, landing, auth, secrets); 2 for low-risk (docs/tests). Estimated ~35–45% fewer spawns per wave with no gate-quality loss on the risky surface.
- **O4 — Demo/fixture discipline (partly landed).** Namespace census pre/post wave; auto-sweep non-`agent-1..5` strays; scratch repos must NOT use the `agent-` prefix (discovery-visible); wave closes only when demo-verify + live-render pass. Agent-1 reset script exists; generalize it.
- **O5 — Write-isolation hardening.** Absolute-path law in prompts (landed); main-dirty gate in runFleet (landed); next: per-phase file fingerprints on ORDER runs too, and a leaked-file auto-quarantine (copy to lane, restore main, kill the lane's run).
- **O6 — Harness abort fixes** (from the forensics report): ledger reconcile on `Result submitted.`; 7-min idle-dispose timer investigation; gate file-existence checks.
- **O7 — Spawn telemetry + budget.** Log per-wave spawn counts into the wave report; configurable cap (e.g. 120 spawns/wave) that halts a runaway wave.
- **O8 — Fixture-vacuity sweep** (one small pass): retarget `land-waituntil`'s gen-patch to the CACHE fake; give `proposals-cache-key` a CACHE in its env; fix the e4 matcher to the normalized `repo.pushed` form; rename its scratch prefix off `agent-`.

## 5. Resume point (on John's go)

1. Build O1 (`wf-integrate`) — ~1 session.
2. Integrate the **43 lane commits** transactionally; tick the ~25 genuinely-done orders (evidence = run dirs; several were GREEN with "caller may tick").
3. Battery + deploy + live gates → then next wave under **O2+O3+O7** with `@workflows` (resolved model verified: `commandcode/inclusionai/ling-3.1-flash:free`, ~1 min trivial probes vs laguna 4–13 min).

Until then: **no waves run.**
