# nextgit-start — cold start

Read, in order: `docs/STATE.md`, `docs/CHECKPOINT.md`, `docs/NEXT-ACTIONS.md` (the derived view of the **bd store** — `.beads/`, regenerate with `bun porting/tasks.mjs view`), and the corpus spine files listed in STATE.

Then report, **without doing any work yet**:
1. where the project is (one paragraph, from STATE);
2. the next action (`bun porting/tasks.mjs next` — top unblocked pending task; if it exits 1, the exact blocker);
3. the constraints that apply to it (from STATE + the latest CHECKPOINT entry + its recorded carries).

If any of those three cannot be answered from those files alone, say which file is missing what — and fix the spine before any work.
