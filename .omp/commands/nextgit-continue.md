# nextgit-continue — drive the next queue item

Take the top task from the store. Run it through the loop:

1. `bun porting/tasks.mjs next` → the task (id/title/scope/acceptance/check; exit 1 = no unblocked pending → boundary).
2. `bun porting/tasks.mjs claim <id> --agent <worker>` before running; build the order from the row (`scope` as `scope`+`acceptance`, `check` clause → `testCmd`, fallback `node --check platform/ui/app.js && node --check platform/ui/tour.js`).
3. Run it from an eval cell:
   ```js
   const { runWorkOrder } = await import("./porting/wf-template.ddw.js");
   await runWorkOrder(order);
   // or a whole batch:
   const { runBatch } = await import("./porting/wf-batch.ddw.js");
   await runBatch({ limit: 1 });
   ```
4. Read `porting/runs/<id>/result.json`.
   - **Green:** all-green batches **CAS-close their own rows** (evidence = batch dir); verify the row shows `done` (`bun porting/tasks.mjs list --json`) — do **not** call `release` on a closed row (it exits 3, and scripted sessions abort). Then `bun porting/tasks.mjs view`, append CHECKPOINT + BUILD-LOG + LOG lines, update STATE's header, regenerate `bun scripts/status-index.mjs`, commit (orchestrator only).
   - **Recorded block:** release the claim first if the batch left one (`bun porting/tasks.mjs release <id>`), then `bun porting/tasks.mjs set <id> --status blocked --evidence "<blocker + owner>"`; stop. Never loop past a recorded block.
   - Soft-recovery: a dead session's claims lapse (bd lease ~5m) and are swept by the next batch's `reclaim` — resume from `porting/runs/<id>/` evidence, never from memory.

Rules: heals are file-partitioned (one writer per file); heal budget 3 rounds; workers never commit; nothing starts a batch it cannot reconstruct from disk.
