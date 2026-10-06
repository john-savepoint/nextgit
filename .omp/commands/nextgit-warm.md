# nextgit-warm — mid-session re-ground

Re-read `docs/STATE.md`, the current `docs/CHECKPOINT.md` entry, and `docs/NEXT-ACTIONS.md` — and check the store: `bun porting/tasks.mjs list`. `docs/NEXT-ACTIONS.md` is derived — if it disagrees with the store, regenerate with `bun porting/tasks.mjs view`.

Report: what changed since we last looked, what is in flight, and whether the derived queue still matches the store.

Fix the spine if it does not — but state updates happen only at boundaries: if work is mid-flight, note it, don't rewrite history.
