# Parallelization — design of record (pit stop, 2026-10-07)

## What we know works (measured, not theory)

- **Claims are a real mutual-exclusion primitive.** Two runners (this session + w1/w2 clones + the parallel session) picked from one store for ~12 hours with zero double-execution after the claim-window fix (green rows keep claims until ticked).
- **Clone-per-worker ran successfully** (w1: 3 batches; w2: 1 batch) but leaked: prompts/slice scopes carry absolute live-tree paths, so some agents edited the integration tree instead of their clone. Isolation via clone is only as good as the path discipline in the prompts.
- **Per-order evidence + resume work**: every order reconstructs from `porting/runs/<id>/`; probes/suites are green-run reproducible.

## The three limiters

1. **Sequential orders per batch.** `runBatch` runs picks one at a time (~10–25 min/order). This is the dominant wall-clock cost.
2. **Absolute-path leakage.** Compile packs embed live-tree absolute paths; agents follow them and write outside their assigned root.
3. **Serialized close-out.** Tick/commit/merge/deploy are orchestrator-only and manual; merges from clone workers need human reconciliation.

## The solution — three layers

### L1: Worktree-parallel orders inside one batch (`wf-batch` v3)
- Pick N rows, claim all.
- `git worktree add -b order/<id> .worktrees/<id> HEAD` per pick — same repo, isolated working dirs, shared `.git`.
- Run all N `runWorkOrder`s **concurrently** with `root = <worktree>`; per-order gates diff inside their own worktree (clean attribution, no cross-order noise in diffs).
- `evidenceDir` option → run evidence lands in the MAIN tree's `porting/runs/<id>/` so it survives worktree removal.
- Settle → **driver commit** then **serial merge-back**: the DRIVER commits each worktree's work onto its branch (`git -C wt add -A && commit --no-verify -m "order <id>: …"`; a failed commit ⇒ unit ERROR, worktree kept) — orders themselves never commit. Then `git merge --no-ff order/<id>` per green order (conflicts pause the merge, reported, never auto-resolved); green → remove worktree + delete branch; red → remove worktree, **keep the branch (it now holds the work)**. Tick row; release claim.
- **Why the driver commit is load-bearing:** without it `git merge` reports "Already up to date" and the worktree removal destroys the work — the phantom-merge defect (records said merged=3, build gained nothing; parity gate caught it 2026-10-07). Regression-pinned in batch.test.mjs scenarios 8/9 (stub orders write files; content-landing asserted).
- Batch-level merged/parity gates run after merge-back, exactly as today.
- Default N=3 (bounds concurrent agent count ≈ 3 × active-phase agents ≈ 6–9); configurable.

### L2: Multiple pipeline processes
- Each additional pipeline = a headless `omp -p` worker (the w1/w2 pattern, now safe): own clone as its root, shared store via `TASKS_DB`, `sourceLike` scoping, pull-before-batch (`git pull --rebase` after every merge-back so its base stays fresh), tick + release after each batch.
- With L1, each pipeline carries N parallel orders → M pipelines × N orders in flight (2 × 3 = 6 initially; scale M after resource measurement).

### L3: Integration lane (orchestrator, serialized)
- Main tree = integration point only. After each batch: merge-back (L1 does it), full suite battery, live probes, deploy gates, commit.
- Workers pull main after each integration; conflicts surface in the worker's context (it has the change knowledge), not as a pile-up for the orchestrator.
- Deploy remains orchestrator-only from the integration tree.

## Hard rules (learned the hard way)

1. **Workspace-scope law in every prompt**: "Your workspace root is `<root>`. ALL reads/writes under it. NEVER touch the integration tree path unless root == that path." (w2 leak, 2026-10-07)
2. **Green rows keep claims until ticked** (duplicate-run window — fixed).
3. **One writer per file per wave** — worktrees make this structural rather than hoped-for.
4. **Probes take a per-run scratch suffix** (`LAND_PROBE_SUFFIX`) when two pipelines can run the same live check concurrently.
5. **Workers never deploy, never touch the live namespace, never commit outside their root.** The DRIVER commits worktree work before merge-back (see L1) — that is the only commit path.
6. **Merge-back is serial and conflict=pause** (never auto-resolve across pipelines). Verify content actually landed (`git diff <base>` non-empty for green orders) — records lie when the commit step is missing.
7. **Never force-remove a worktree with uncommitted changes** — commit (or salvage) first; the e3 leftovers proved this twice (salvage commits e85bb56, cc56912).

## Resource budget

- Agents are remote (API); local cost = process count. Measured available RAM ~11–25 GB during two-pipeline runs (no pressure observed); a 3-parallel batch ≈ 6–9 live agent processes + the pipeline session. Scale check before M>2.

## Rollout order

1. L1 in `wf-batch` + tests (stubbed harness proves scheduling, worktree lifecycle, merge-back, cleanup).
2. Worker template (`porting/WORKER-PROMPT.md` + `porting/spawn-worker.sh`) — retire ad-hoc prompts.
3. Probe suffix + skill-gap fixes (resilience lens hint; compiler roles name their skills).
4. Prove: one 3-parallel batch end-to-end in the main tree.
5. Then the model migration (`poolside/laguna-s-2.1-free` for workflow/project agents; roles/globals untouched).
