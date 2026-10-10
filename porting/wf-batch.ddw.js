// porting/wf-batch.ddw.js — NextGit batch driver over the queue (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runBatch } = await import("./porting/wf-batch.ddw.js"); await runBatch({ limit: 1 });
//
// Picks the first N `pending` rows from the bd task store (beads/Dolt; md fallback
// docs/NEXT-ACTIONS.md), runs each through runWorkOrder
// (direct composition — the sub-driver returns a result promise, wait() is not involved),
// then a MERGED gate over the union. The CALLER ticks rows + commits the state docs — the
// DRIVER commits order WORK itself before the batch gates (per-worktree in the parallel
// branch; once in the root in the sequential branch) so fleet integration can carry it.
// Claim discipline: batches claim rows before running (collision guard) and heartbeat
// long orders (bd leases ~5m). An ALL-GREEN batch CAS-closes its rows itself; red/stopped
// rows are released for the caller to reconcile. bd leases are ~5m; a per-batch heartbeat loop
// keeps claims alive while orders run (10–25m); a dead batch's claims lapse and are reclaimable.
// Worktree-parallel mode (parallel>1) runs orders concurrently; merge-back is serial.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";

const DEFAULT_TEST = "node --check platform/ui/app.js && node --check platform/ui/tour.js";
const DEFAULT_CORPUS = [
  "docs/STATE.md",
  "docs/CHECKPOINT.md",
  "_bmad-output/specs/spec-next-git-platform/SPEC.md",
  "platform/CONTRACT.md",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const extractCheck = (scope) => { const m = scope.match(/check:\s*(.+)$/i); return m ? m[1].trim().replace(/[.]$/, "") : null; };

// Queue source for runBatch: the bd store is authoritative when it exists (even when empty —
// an empty store returns NO PENDING ROWS, never a silent stale-md re-read); the md parser
// is the fallback only when the store is absent or the CLI read throws.
export function readQueueRows(root = process.cwd(), { sourceLike } = {}) {
  const beadsDir = process.env.BEADS_DIR ?? `${root}/.beads`;
  if (existsSync(beadsDir)) {
    try {
      // execFileSync (no shell interpolation — space/metachar-safe) + a bounded wait.
      // Live-claimed rows are skipped: another session owns them (claims are the collision guard).
      const out = execFileSync("bun", [`${root}/porting/tasks.mjs`, "list", "--status", "pending", "--json"],
        { cwd: root, encoding: "utf8", timeout: 20000, env: process.env });
      // Dep-aware scheduling (mirrors `tasks.mjs next`): a row whose deps are not all done is
      // NOT runnable yet — skipped, never picked, and reported in `gated`. If the done-set read
      // fails, every dep-carrying row is gated (fail closed; never run a dependent early).
      // NB: bd itself also blocks dependent picks (native blocks edges); this mirror keeps the
      // report's `gated` view truthful and fail-closed if the adapter read is limited.
      let done = new Set();
      try {
        const dq = execFileSync("bun", [`${root}/porting/tasks.mjs`, "done-ids"],
          { cwd: root, encoding: "utf8", timeout: 20000, env: process.env });
        done = new Set(JSON.parse(dq));
      } catch { }
      let mapped = out.trim()
        ? JSON.parse(out)
          .filter((r) => r.claimed_by == null)
          .map((r) => ({ id: r.id, priority: r.priority ?? "P3", title: r.title, scope: r.scope ?? "", acceptance: r.acceptance ?? null, check: r.check_cmd, deps: r.deps ?? null, source: r.source ?? null, epic: r.epic_id ?? null }))
        : [];
      if (sourceLike) mapped = mapped.filter((r) => (r.source ?? "").startsWith(sourceLike));
      const gated = [];
      const rows = mapped.filter((r) => {
        const deps = (r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) { gated.push({ id: r.id, unmet }); return false; }
        return true;
      });
      return { source: "db", rows, gated };
    } catch (e) {
      console.error(`wf-batch: DB queue read failed (${e.message}); falling back to docs/NEXT-ACTIONS.md`);
    }
  }
  const rows = [];
  for (const line of readFileSync(`${root}/docs/NEXT-ACTIONS.md`, "utf8").split("\n")) {
    const m = line.match(/^- \[pending\]\s*(P[0-3])\s*—\s*(.+)$/);
    if (!m) continue;
    const rest = m[2];
    const cut = rest.indexOf(" — ");
    rows.push({ priority: m[1], title: (cut === -1 ? rest : rest.slice(0, cut)).trim(), scope: cut === -1 ? "" : rest.slice(cut + 3).trim() });
  }
  return { source: "md", rows };
}

// The `agent` OPTION is bound as `agentOpt` on purpose: the bare name `agent` must stay the DDW
// spawn global that the batch-level gates below call (shadowing it crashed every batch at the
// parity gate — `TypeError: agent is not a function`).
export async function runBatch({ limit = 1, root = process.cwd(), lenses, agent: agentOpt, agents, resume, sourceLike, parallel = 1, evidenceRoot: evidenceRootOpt, ids } = {}) {
  // evidenceRoot: where run evidence + batch reports land (defaults to root). Fleet lanes
  // pass the MAIN tree so all audit evidence lands in one place while the lane works in
  // its own clone.
  const evidenceRoot = evidenceRootOpt ?? root;
  const { runWorkOrder, normalizeVerdict, SKILL_HINTS } = await import(`${root}/porting/wf-template.ddw.js`);
  mkdirSync(`${root}/porting/runs`, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = `${evidenceRoot}/porting/runs/batch-${ts}`;
  mkdirSync(batchDir, { recursive: true });
  // Parity baseline: the commit BEFORE the batch ran. The almost-last gate compares against it.
  let preBatchCommit = "";
  try { preBatchCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10000 }).trim(); } catch { }

  // --- reclaim sweep (return dead sessions' claimed rows BEFORE picking) ------
  // bd reclaim releases claims whose lease expired (dead/crashed workers). Running it
  // at wave start means a crashed session's rows become pickable on the next batch.
  // NOTE: bd's own reap window applies; --older-than is a grace on top of expiry.
  try {
    execFileSync("bun", [`${root}/porting/tasks.mjs`, "reclaim", "--older-than", "10m"], { cwd: root, encoding: "utf8", timeout: 20000, env: process.env });
  } catch { }

  // --- queue (bd preferred; md fallback on a store fault) --------------------
  const { source: queueSource, rows, gated = [] } = readQueueRows(root, { sourceLike });

  // --- claim the picks (contended rows are skipped; released after running) --
  // Two sessions running batches must never pick the same row: claims are the guard.
  // bd leases are ~5m; the heartbeat loop below keeps them alive while orders run.
  const batchAgent = `batch:${ts}`;
  const releaseRow = (id, note) => {
    try {
      execFileSync("bun", [`${root}/porting/tasks.mjs`, "release", id, ...(note ? ["--note", note] : [])], { cwd: root, encoding: "utf8", timeout: 20000, env: process.env });
    } catch { /* lease expires on its own */ }
  };
  const picked = [];
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (ids && (!row.id || !ids.includes(row.id))) continue; // O2 lane plan: explicit id set
    if (!row.id) { picked.push({ ...row, claimed: false }); continue; } // md-fallback rows carry no ids
    try {
      execFileSync("bun", [`${root}/porting/tasks.mjs`, "claim", row.id, "--agent", batchAgent],
        { cwd: root, encoding: "utf8", timeout: 20000, env: process.env });
      picked.push({ ...row, claimed: true });
    } catch {
      console.error(`wf-batch: ${row.id} contended — skipping`);
    }
  }
  if (!picked.length) return { orders: [], gate: null, gated, next: "NO PENDING ROWS (or all picks contended/dep-gated)" };

  // --- claim heartbeat (bd leases expire ~5m; orders run 10–25m) --------------
  // A loop heartbeats every claimed id while THIS process is alive (parent-pid guard:
  // if the batch dies, the loop exits within one interval, the lease lapses in ~5m and
  // the next reclaim returns the row — no zombie claims). Failures are tolerated
  // (heartbeating a released/closed row is a no-op error).
  const claimedIds = picked.filter((r) => r.claimed && r.id).map((r) => r.id);
  let hbProc = null;
  if (claimedIds.length) {
    const ids = claimedIds.map((id) => `'${id}'`).join(" ");
    const script = `parent=${process.pid}; while kill -0 $parent 2>/dev/null; do for id in ${ids}; do bun ${root}/porting/tasks.mjs heartbeat "$id" --agent '${batchAgent}' >/dev/null 2>&1 || true; done; sleep 120; done`;
    try {
      hbProc = spawn("bash", ["-c", script], { cwd: root, detached: false, stdio: "ignore", env: process.env });
      hbProc.unref?.();
    } catch (e) {
      console.error(`wf-batch: heartbeat loop failed to start (${e.message}); relying on lease expiry`);
    }
  }
  const stopHeartbeat = () => { try { hbProc?.kill("SIGTERM"); } catch { } };

  try {

    // --- base reds (what was already red before this batch) --------------------
    const stateText = readFileSync(`${root}/docs/STATE.md`, "utf8");
    const standing = stateText.split("\n").filter((l) => /^\|\s/.test(l) && !/^\|\s*(Red|---)/.test(l));
    writeFileSync(`${root}/porting/runs/base-red.json`, JSON.stringify({ capturedAt: new Date().toISOString(), note: "v1: standing reds parsed from docs/STATE.md; per-batch testCmd baseline is captured by the first order's VERIFY phase", standingReds: standing }, null, 2));

    // --- run orders: worktree-parallel (L1) or sequential ----------------------
    const makeOrder = (row, base) => ({
      id: row.id ?? slug(row.title),
      title: row.title,
      scope: row.scope,
      acceptance: row.acceptance ?? row.scope,
      corpus: DEFAULT_CORPUS.map((p) => `${base}/${p}`),
      testCmd: row.check ?? extractCheck(row.scope) ?? DEFAULT_TEST,
    });
    let results = [];
    let mergeBack = null;
    if (parallel > 1) {
      // L1 parallelism: one git worktree per pick, N orders in flight, serial merge-back.
      // Worktrees share this repo's .git; evidence is redirected to the main tree
      // (evidenceRoot) so it survives worktree removal. Green rows merge into `root`
      // (merge commits land HERE — the caller still owns tick/commit of the batch).
      const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60000 }).trim();
      const wtRoot = `${root}/.worktrees`;
      mkdirSync(wtRoot, { recursive: true });
      const units = [];
      for (const row of picked) {
        const id = row.id ?? slug(row.title);
        const wt = `${wtRoot}/${id}`;
        try {
          // Reuse-first: a leftover worktree from a crashed run IS our resume point —
          // never hard-fail on it (the crash-loop class: `worktree add` on an existing
          // branch loops forever). Order: existing worktree → existing branch → fresh.
          let ready = false;
          const wtList = git(["worktree", "list", "--porcelain"]);
          if (wtList.split("\n").some((l) => l === `worktree ${wt}`)) {
            if (existsSync(`${wt}/.git`)) ready = true; // reuse as-is
            else { git(["worktree", "remove", "--force", wt]); }
          }
          if (!ready) {
            // Reuse an existing leftover branch (crash resume); otherwise create fresh.
            // Probe with show-ref (quiet, exit-code only) — the old try/catch cascade
            // printed fatal-noise on every fresh batch.
            let branchExists = false;
            try {
              git(["show-ref", "--verify", "--quiet", `refs/heads/order/${id}`]);
              branchExists = true;
            } catch { }
            if (branchExists) {
              git(["worktree", "add", wt, `order/${id}`]);
            } else {
              git(["worktree", "add", "-b", `order/${id}`, wt, "HEAD"]);
            }
            ready = true;
          }
          units.push({ row, id, wt });
        } catch (e) {
          console.error(`wf-batch: worktree add failed for ${id}: ${e.message}`);
          units.push({ row, id, wt, failed: true });
          if (row.claimed && row.id) releaseRow(row.id, `batch ${ts}: worktree creation failed`);
        }
      }
      const runnable = units.filter((u) => !u.failed);
      const settled = await Promise.allSettled(
        runnable.map((u) =>
          runWorkOrder(makeOrder(u.row, u.wt), { root: u.wt, evidenceRoot, lenses, agent: agentOpt, agents, resume }),
        ),
      );
      const byId = new Map();
      let si = 0;
      for (const u of units) {
        if (u.failed) { byId.set(u.id, { order: u.id, title: u.row.title, verdict: "ERROR: worktree creation failed", heals: 0 }); continue; }
        const s = settled[si++];
        byId.set(u.id, s.status === "fulfilled" ? s.value : { order: u.id, title: u.row.title, verdict: `ERROR: ${String(s.reason?.message ?? s.reason).slice(0, 200)}`, heals: 0 });
      }
      // --- commit each order's work onto its branch (the merge-back contract) ---
      // Orders run in worktrees and never commit (workers never commit — by design).
      // The DRIVER commits here, before merge-back: without this step `git merge` is a
      // no-op ("Already up to date") and the worktree removal destroys the work — the
      // phantom-merge defect the parity gate caught 2026-10-07 (records said merged=3
      // while the build gained nothing). --no-verify: runner bookkeeping must not
      // re-enter repo hooks from the worktree context. A failed commit marks the unit
      // ERROR and its worktree is KEPT (never removed uncommitted).
      const commitFailed = new Set();
      for (const u of units) {
        if (u.failed) continue;
        try {
          const dirty = execFileSync("git", ["-C", u.wt, "status", "--porcelain"], { encoding: "utf8", timeout: 30000 }).trim();
          if (dirty) {
            const who = ["-c", "user.email=nextgit-runner@local", "-c", "user.name=nextgit-runner"];
            execFileSync("git", ["-C", u.wt, ...who, "add", "-A"], { encoding: "utf8", timeout: 60000 });
            execFileSync("git", ["-C", u.wt, ...who, "commit", "-q", "--no-verify", "-m", `order ${u.id}: ${u.row.title} (batch ${ts})`], { encoding: "utf8", timeout: 60000 });
          }
        } catch (e) {
          commitFailed.add(u.id);
          byId.set(u.id, { order: u.id, title: u.row.title, verdict: `ERROR: worktree commit failed — ${String(e.stderr ?? e.message).slice(0, 160)}`, heals: 0 });
          console.error(`wf-batch: worktree commit failed for ${u.id} — worktree kept: ${u.wt}`);
        }
      }
      const merged = [], conflicts = [], kept = [];
      for (const u of units) {
        const r = byId.get(u.id) ?? {};
        if (commitFailed.has(u.id)) { kept.push({ id: u.id, branch: `order/${u.id}`, worktree: u.wt, note: "commit failed — worktree kept" }); if (u.row.claimed && u.row.id) releaseRow(u.row.id, `batch ${ts}: worktree commit failed — worktree kept ${u.wt}`); continue; }
        if (r.verdict === "GREEN") {
          try {
            git(["merge", "--no-ff", `order/${u.id}`, "-m", `order ${u.id}: ${u.row.title} (batch ${ts})`]);
            merged.push(u.id);
            try { git(["worktree", "remove", "--force", u.wt]); } catch { }
            try { git(["branch", "-D", `order/${u.id}`]); } catch { }
          } catch (e) {
            try { git(["merge", "--abort"]); } catch { }
            conflicts.push(u.id);
            kept.push({ id: u.id, branch: `order/${u.id}`, worktree: u.wt });
            console.error(`wf-batch: merge conflict for ${u.id} — branch kept for reconciliation`);
          }
        } else {
          // red/errored: the branch now HOLDS the work (committed above); removing the
          // worktree loses nothing — the branch is the reconciliation surface.
          try { git(["worktree", "remove", "--force", u.wt]); } catch { }
          kept.push({ id: u.id, branch: `order/${u.id}`, worktree: u.wt });
          // red/errored rows are safe to release now; green rows keep claims for the caller tick
          if (u.row.claimed && u.row.id) releaseRow(u.row.id, `batch ${ts}: ${r.verdict}`);
        }
      }
      mergeBack = { mode: "parallel", parallel, merged, conflicts, kept, commitFailed: [...commitFailed] };
      writeFileSync(`${batchDir}/merge-back.json`, JSON.stringify(mergeBack, null, 2));
      results = units.map((u) => byId.get(u.id));
      log(`batch ${ts}: parallel x${parallel} — GREEN ${results.filter((r) => r.verdict === "GREEN").length}, merged ${merged.length}, conflicts ${conflicts.length}, kept ${kept.length}`);
    } else {
      const ranIds = new Set();
      for (const row of picked) {
        const r = await runWorkOrder(makeOrder(row, root), { root, lenses, agent: agentOpt, agents, resume });
        results.push(r);
        ranIds.add(row.id);
        // GREEN rows KEEP their claim: the caller ticks them done (then the claim is moot).
        // Releasing here opens a duplicate-run window — observed live: two sessions ran the
        // same row between this release and the caller's tick.
        if (r.verdict !== "GREEN") { if (row.claimed) releaseRow(row.id, `batch ${ts}: ${r.verdict}`); break; }
      }
      // picks that never ran (batch stopped early) must not hold leases
      for (const row of picked) if (row.claimed && !ranIds.has(row.id)) releaseRow(row.id, `batch ${ts}: not run (batch stopped early)`);

      // --- driver commit (sequential path) ---------------------------------------
      // Orders here run directly in the batch root and never commit (workers never commit).
      // Without this the lane carries uncommitted dirt: fleet integration fetches the lane's
      // main, finds "no new commits", and skips — rows close while the build gains nothing
      // (phantom-merge class, resurrected; caught in wave-8 plan review 2026-10-10). Mirrors
      // the parallel branch's per-worktree driver commit. Failure is tolerated: the work
      // stays in the tree for the caller (integration will then hold that lane).
      if (results.some((r) => r.verdict === "GREEN")) {
        try {
          const dirty = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", timeout: 30000 }).trim();
          if (dirty) {
            const who = ["-c", "user.email=nextgit-runner@local", "-c", "user.name=nextgit-runner"];
            execFileSync("git", ["-C", root, ...who, "add", "-A"], { encoding: "utf8", timeout: 60000 });
            execFileSync("git", ["-C", root, ...who, "commit", "-q", "--no-verify", "-m", `batch ${ts}: ${results.filter((r) => r.verdict === "GREEN").map((r) => r.order).join(", ")}`], { encoding: "utf8", timeout: 60000 });
            log(`batch ${ts}: sequential driver-commit landed (${results.filter((r) => r.verdict === "GREEN").length} green orders)`);
          }
        } catch (e) {
          console.error(`wf-batch: sequential driver-commit failed — ${String(e.stderr ?? e.message).slice(0, 160)}; work left in tree`);
        }
      }
    }

    // --- BATCH GATES (parallel): parity + merged ------------------------------
    // Both lenses read the same post-merge tree; they run CONCURRENTLY (John, 2026-10-08:
    // "gates can be run in parallel"). Spawn parity first, then merged — spawn order is
    // preserved in the call ledger (tests pin it), wall-clock overlaps.
    // Unlanded work (red/kept branches + merge conflicts) must reach the merged gate.
    const mergeConflicts = mergeBack?.conflicts ?? [];
    const PARITY_SCHEMA = { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["BLOCK", "SHIP"] }, shipBlockers: { type: "array", items: { type: "string" } }, highs: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } };
    const parityHandle = preBatchCommit && results.some((r) => r.verdict === "GREEN")
      ? agent(
        `PARITY GATE (almost last) for batch ${ts}. Compare the PRE-BATCH state vs now — the build must be >= the previous build.\n` +
        `THE BATCH TREE — the only tree to inspect — is ${root}. Your shell cwd is NOT it (it is the session dir): use \`git -C ${root} …\` for every git command and absolute paths under ${root} for everything else.\n` +
        `Pre-batch commit: ${preBatchCommit}. Run \`git -C ${root} diff --stat ${preBatchCommit}\` and \`git -C ${root} diff ${preBatchCommit} -- <suspicious paths>\`; inspect for any behavior, file, endpoint, capability, or output that was REMOVED or weakened.\n` +
        `Rules: a removal blocks UNLESS the batch's orders explicitly declared it (scope/acceptance) or an adequate covering test still passes (tests substitute for manual comparison); with neither it is a ship-blocker.\n` +
        `Skill: ${SKILL_HINTS.lens.parity}. Do NOT write files — the runner records your verdict.\n` +
        `Return ONLY {verdict, shipBlockers, highs, notes}.`,
        { agent: agents?.parity ?? "parity-auditor", label: `gate:parity:${ts}`, schema: PARITY_SCHEMA },
      )
      : null;

    // --- merged gate (v1: sequential workspace; this gate sees the union) ------
    // Fail-closed like every per-order gate: a merged return is RAW INPUT, not a verdict —
    // an incoherent {verdict:"SHIP", shipBlockers:[…]} must not read ALL GREEN (v3.2).
    const mergedHandle = agent(
      `MERGED GATE for batch ${ts}. Orders run: ${results.map((r) => `${r.order} (${r.verdict}, heals=${r.heals})`).join("; ")}.\n` +
      `Unlanded work (kept branches — NOT in the build): ${(mergeBack?.kept ?? []).map((k) => k.id).join(", ") || "(none)"}. Merge conflicts: ${mergeConflicts.join(", ") || "(none)"}.\n` +
      `THE BATCH TREE — the only tree to inspect — is ${root} (your shell cwd is NOT it): use \`git -C ${root} …\` / absolute paths under ${root}. Read the run reports under ${batchDir}/../.\n` +
      `Run \`git -C ${root} diff ${preBatchCommit}\` versus the pre-batch commit and judge the batch's effect on it.\n` +
      `Skills: apply ${SKILL_HINTS.mergedGate}.\n` +
      `Block rule + attribution as in the per-order gate: only reds INTRODUCED by this batch block; base-identical reds are recorded with owners.\n` +
      `Do NOT write files — the runner records your verdict. Return the verdict object + a <=6 line summary ending with NEXT: ALL GREEN or the blockers.`,
      { agent: agents?.mergedGate ?? agentOpt ?? "senior-reviewer", label: `gate:merged:${ts}`, schema: { type: "object", required: ["verdict", "shipBlockers", "notes"], properties: { verdict: { enum: ["SHIP", "BLOCK"] }, shipBlockers: { type: "array", items: { type: "string" } }, notes: { type: "array", items: { type: "string" } } } } },
    );

    const [parityRaw, mergedRaw] = await Promise.all([parityHandle ? parityHandle.wait() : Promise.resolve(null), mergedHandle.wait()]);
    const parity = parityHandle ? normalizeVerdict("parity", parityRaw) : null;
    if (parity) writeFileSync(`${batchDir}/gate-parity.md`, JSON.stringify(parity, null, 2));
    const merged = normalizeVerdict("merged", mergedRaw);
    writeFileSync(`${batchDir}/gate-merged.md`, JSON.stringify(merged, null, 2));

    const parityBlocked = parity !== null && parity.verdict !== "SHIP";
    // A merge conflict keeps that unit's work on a branch UNlanded — the batch cannot be
    // all-green while any order's content is not in the build (caught by the parity-gate
    // class review 2026-10-08: conflicts previously fell through to ALL GREEN + auto-close).
    const allGreen = results.every((r) => r.verdict === "GREEN") && merged.verdict === "SHIP" && !parityBlocked && mergeConflicts.length === 0;
    // Close contract: an ALL-GREEN batch CAS-closes its rows itself (evidence = batch dir),
    // so no claim can lapse into a reclaim/re-run window after the batch ends. The caller's
    // tick becomes verification; re-closing is a no-op (adapter + bd).
    const closed = [];
    if (allGreen) {
      for (const row of picked) {
        if (!row.claimed || !row.id) continue;
        try {
          execFileSync("bun", [`${root}/porting/tasks.mjs`, "set", row.id, "--status", "done", "--evidence", `batch ${ts} GREEN; report: ${batchDir}/report.json`], { cwd: root, encoding: "utf8", timeout: 30000, env: process.env });
          closed.push(row.id);
        } catch (e) {
          console.error(`wf-batch: close failed for ${row.id}: ${String(e.stderr ?? e.message).slice(0, 160)}`);
        }
      }
    }
    const conflictNote = mergeConflicts.length ? ` — merge conflicts kept as branches: ${mergeConflicts.join(", ")}` : "";
    const next = !allGreen
      ? `BLOCKED — see per-order results + gate-merged.md + gate-parity.md${conflictNote}`
      : `ALL GREEN — ${closed.length} row(s) auto-closed; update the spine, regenerate the status index, commit`;
    const report = { batch: ts, queueSource, sourceLike: sourceLike ?? null, gated, parallel: parallel > 1 ? parallel : 1, mergeBack, orders: results, merge: parallel > 1 ? `worktree-parallel x${parallel} (serial merge-back)` : "v1 sequential (no worktrees)", gate: merged, parity, closed, next };
    writeFileSync(`${batchDir}/report.json`, JSON.stringify(report, null, 2));
    log(`batch ${ts}: ${next}`);
    return report;

  } finally {
    // any mid-batch throw (order/gate errors) must kill the heartbeat loop — a leaked
    // loop keeps refreshing claims forever (reclaim cannot touch a live lease).
    stopHeartbeat();
  }
}
