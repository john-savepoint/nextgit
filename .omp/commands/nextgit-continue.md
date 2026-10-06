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
   - **Green:** `bun porting/tasks.mjs set <id> --status done --evidence "<check + verbatim result>"`, `bun porting/tasks.mjs release <id>`, `bun porting/tasks.mjs view`, append CHECKPOINT + BUILD-LOG + LOG lines, update STATE's header, regenerate `bun scripts/status-index.mjs`, commit (orchestrator only).
   - **Recorded block:** `bun porting/tasks.mjs set <id> --status blocked --evidence "<blocker + owner>"` + `release`, stop. Never loop past a recorded block.

Rules: heals are file-partitioned (one writer per file); heal budget 3 rounds; workers never commit; nothing starts a batch it cannot reconstruct from disk.
