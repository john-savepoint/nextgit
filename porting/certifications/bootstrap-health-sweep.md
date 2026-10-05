# Certification — bootstrap-health-sweep gates (supersession + fail-closed re-execution)

**Date:** 2026-10-05 (UTC) · **Certified tree:** `8f17b84` (contains runner commit `d5f6b5b`)
**Method:** deterministic execution by the caller — no agent spawns required (the spawn route is down; see Standing reds in `docs/STATE.md`).

## 1. Why the two round-4 BLOCK reports are SUPERSEDED

Both reports were written mid-resume-run, **before** commit `d5f6b5b` (2026-10-06 01:05:01 +0900 — recorded in `.git/logs/HEAD`). Each report's own prescribed remedy is the state now on disk:

| Report (mtime) | Ship-blocker it raised | Remedy already committed |
|---|---|---|
| `gate-quality.md` (00:58:42) | SB-1: uncommitted `wf-template.ddw.js` diff inside a "no files changed" order | → committed separately with justification, exactly as prescribed (`d5f6b5b`) |
| `gate-quality.md` (00:58:42) | SB-2: fail-open in the verdict coercion layer | → array branch healed; **object branch (live path) fixed fail-closed** at `wf-template.ddw.js:62-71` |
| `gate-spec-fit.md` (01:02:33) | SB-1: fix applied to the non-live branch; live object branch still failed open | → the exact one-line fix it prescribes is the code on disk; pinned by regression test |
| both | HIGH-1: uncommitted diff / falsified "no source modified" claims | → commit `d5f6b5b`; `git status` clean at acceptance; claims reconciled in `docs/CHECKPOINT.md` |

No BLOCK from either report reproduces on the certified tree.

## 2. Certification pass — the two cited inputs re-executed

```
$ node /tmp/gate-inputs-test.mjs
PASS  specfit-SB1-cited-1 → verdict=BLOCK blocked()=true sb=1 highs=0
PASS  specfit-SB1-cited-2 → verdict=BLOCK blocked()=true sb=0 highs=1
BOTH GATE BLOCKERS DO NOT REPRODUCE ON CURRENT CODE
```

```
$ node porting/tests/normalize.test.mjs   (committed regression suite)
10 PASS  (includes both fail-open cases + blank-shape, no-verdict, undefined, error shapes)
ALL PASS
```

Subject evidence (unchanged, previously verified 5+ times): the sweep's four checks reproduce byte-identically — see `plan.md` / `implement.md` / `verify.md` / `gate-*.md` in `porting/runs/bootstrap-health-sweep/`.

## 3. Residue reconciliation (crashed resumption attempts)

- Two resumption attempts died at handle resolution (provider 404) after spawning agents; roster showed heal-5 ×2 + gate instances left idle.
- Disk scan at reconcile: the **only** artifact newer than the commit is `run-state.json` (parked `phase: "heal"`, round 5). No `heal-5.md`, no fresh gate reports, **no post-commit edits** — `git status` / `git diff` empty.
- Consequence: none. No fresh verdicts to conflate with the pre-fix pair; the uncommitted-diff trap did not fire.

## 4. Dispositions (recorded, not chased)

- **Same-lens re-adjudication**: blocked-on-infrastructure (spawn route down; owner John — standing red). Superseded in practice by §2; the next order's gates re-gate the tree as a matter of course.
- **spec-fit HIGH-3**: `line-map.md` stands as a **partial, frozen snapshot** (heal-4 vintage; covers 9 of the run's 14 runner citations; excludes plan.md; runner line numbers shifted again with `d5f6b5b`). Run-dir line citations are point-in-time; not extended.
- **`base-red.json`**: batch-level carry — written by `wf-batch.ddw.js` when a real batch first runs.
- **C3 HTTP-status capture (`-f`)**: folds into the next order that touches the `docs/STATE.md` baseline.
