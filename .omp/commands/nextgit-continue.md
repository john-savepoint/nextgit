# nextgit-continue — drive the next queue item

Take the top `pending` row of `docs/NEXT-ACTIONS.md`. Run it through the loop:

1. Build the work order from the row: `id` (slug of the title), `title`, `scope` (the row's remainder), `corpus` (STATE + SPEC + CONTRACT), `testCmd` from the row's `check:` clause (fallback: `node --check platform/ui/app.js && node --check platform/ui/tour.js`), `acceptance` = the row's scope.
2. Run it from an eval cell:
   ```js
   const { runWorkOrder } = await import("./porting/wf-template.ddw.js");
   await runWorkOrder(order);
   // or a whole batch:
   const { runBatch } = await import("./porting/wf-batch.ddw.js");
   await runBatch({ limit: 1 });
   ```
3. Read `porting/runs/<id>/result.json`.
   - **Green:** tick the row to `[done]`, append CHECKPOINT + BUILD-LOG + LOG lines, update STATE's header, regenerate `bun scripts/status-index.mjs`, commit (orchestrator only).
   - **Recorded block:** label the row `[blocked]` with the blocker + owner and stop. Never loop past a recorded block.

Rules: heals are file-partitioned (one writer per file); heal budget 3 rounds; workers never commit; nothing starts a batch it cannot reconstruct from disk.
