// porting/wf-fleet.ddw.js — multi-lane fleet runner (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: "/home/.../cloudflare-git-comp", lanes: 5, limit: 2, parallel: 2,
//                    sourceLike: "compile:compile-2026-10-06T13-31-51" });
//
// N CONCURRENT workflows in ONE cell: each lane is an isolated git clone under `.fleet/`
// that runs its own worktree-parallel batch against the SHARED bd store (claims, heartbeats,
// ALL-GREEN auto-close are global — no row can run twice). Run evidence + batch reports land
// in the MAIN tree (evidenceRoot) so the audit trail is single-sited even though the code
// merges into lane clones.
//
// After all lanes settle: each lane's commits merge into main SERIALLY (conflict ⇒ merge
// aborted, lane held, reported — nothing auto-resolved). Held lanes are skipped on later
// waves until reconciled (their commits stay reachable on the lane's own main).
//
// Recovery model: every lane is reconstructible from disk (clone + commits + reports);
// a dead session's claims lapse (~5m lease) and the next wave's reclaim sweep returns them;
// budget/ratelimit errors surface per order and are re-runnable via the normal queue.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] }).trim();

export async function runFleet({
  root,
  lanes = 5,
  limit = 2,
  parallel = 2,
  sourceLike,
  fleetDir,
  agent: agentOpt,
  lanesOnly,
} = {}) {
  if (!root) throw new Error("runFleet: root (main repo path) is required");
  const mainRoot = root;
  const fleetRoot = fleetDir ?? `${mainRoot}/.fleet`;
  // Every lane + every spawned adapter call must see the SHARED store.
  const beadsDir = process.env.BEADS_DIR ?? `${mainRoot}/.beads`;
  process.env.BEADS_DIR = beadsDir;
  mkdirSync(fleetRoot, { recursive: true });
  mkdirSync(`${mainRoot}/porting/runs`, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  // ---- prepare lanes (clone / sync; held lanes are skipped) --------------------
  const laneIds = Array.from({ length: lanes }, (_, i) => `lane-${i + 1}`).filter(
    (id) => !lanesOnly || lanesOnly.includes(id),
  );
  const prep = [];
  for (const id of laneIds) {
    const dir = `${fleetRoot}/${id}`;
    try {
      if (!existsSync(`${dir}/.git`)) {
        git(["clone", "-q", mainRoot, dir], mainRoot);
        // test suites need platform deps; symlink to the main tree's install (gitignored)
        if (existsSync(`${mainRoot}/platform/node_modules`) && !existsSync(`${dir}/platform/node_modules`)) {
          execFileSync("ln", ["-s", `${mainRoot}/platform/node_modules`, `${dir}/platform/node_modules`], { encoding: "utf8" });
        }
        prep.push({ id, state: "cloned" });
      } else {
        git(["fetch", "-q", mainRoot, "main"], dir);
        const ahead = git(["log", "--oneline", "FETCH_HEAD..main"], dir);
        if (ahead) {
          prep.push({ id, state: "HELD — unmerged lane commits", detail: ahead.split("\n").slice(0, 3) });
        } else {
          git(["merge", "--ff-only", "FETCH_HEAD"], dir);
          prep.push({ id, state: "synced" });
        }
      }
    } catch (e) {
      prep.push({ id, state: "prep-failed", detail: String(e.stderr ?? e.message).slice(0, 200) });
    }
  }
  const active = prep.filter((p) => p.state !== "prep-failed" && !String(p.state).startsWith("HELD")).map((p) => p.id);
  if (!active.length) {
    const out = { ts, beadsDir, lanes: prep, runs: [], integration: [], next: "NO READY LANES — reconcile held lanes first" };
    writeFileSync(`${mainRoot}/porting/runs/fleet-${ts}.json`, JSON.stringify(out, null, 2));
    log(`fleet ${ts}: no ready lanes`);
    return out;
  }

  // ---- run lanes CONCURRENTLY (one worktree-parallel batch per lane) -----------
  const { runBatch } = await import(`${mainRoot}/porting/wf-batch.ddw.js`);
  const settled = await Promise.allSettled(
    active.map((id) =>
      runBatch({ root: `${fleetRoot}/${id}`, limit, parallel, sourceLike, evidenceRoot: mainRoot, agent: agentOpt }),
    ),
  );
  const runs = active.map((id, i) => {
    const s = settled[i];
    if (s.status !== "fulfilled") return { id, error: String(s.reason?.message ?? s.reason).slice(0, 300) };
    const rep = s.value ?? {};
    return {
      id,
      next: rep.next,
      closed: rep.closed ?? [],
      orders: (rep.orders ?? []).map((o) => ({ id: o.order, verdict: o.verdict, heals: o.heals })),
      conflicts: rep.mergeBack?.conflicts ?? [],
      error: null,
    };
  });

  // ---- serial integration into main --------------------------------------------
  const integration = [];
  for (const r of runs) {
    const dir = `${fleetRoot}/${r.id}`;
    if (r.error) {
      // Lane errored mid-batch. Its commits may still be partial — merge what exists, report.
      integration.push({ id: r.id, state: "lane errored (batch)", detail: r.error.slice(0, 160) });
    }
    try {
      git(["fetch", "-q", dir, "main"], mainRoot);
      const ahead = git(["log", "--oneline", "HEAD..FETCH_HEAD"], mainRoot);
      if (!ahead) {
        integration.push({ id: r.id, state: "no new commits" });
        continue;
      }
      try {
        git(["merge", "--no-ff", "--no-edit", "-m", `fleet ${ts} ${r.id}: parallel batch merge`, "FETCH_HEAD"], mainRoot);
        integration.push({ id: r.id, state: "merged", commits: ahead.split("\n").filter(Boolean).length });
        try {
          git(["fetch", "-q", mainRoot, "main"], dir);
          git(["merge", "--ff-only", "FETCH_HEAD"], dir);
        } catch (e) {
          integration.push({ id: r.id, state: "merged (lane sync deferred)", detail: String(e.stderr ?? e.message).slice(0, 160) });
        }
      } catch (e) {
        try { git(["merge", "--abort"], mainRoot); } catch { }
        integration.push({ id: r.id, state: "CONFLICT — lane held for manual reconcile", detail: String(e.stderr ?? e.message).slice(0, 200) });
      }
    } catch (e) {
      integration.push({ id: r.id, state: "integration error", detail: String(e.stderr ?? e.message).slice(0, 200) });
    }
  }

  const out = {
    ts,
    beadsDir,
    lanes: prep,
    runs,
    integration,
    next: "review integration[]; reconcile CONFLICT lanes; regenerate the spine views; commit",
  };
  writeFileSync(`${mainRoot}/porting/runs/fleet-${ts}.json`, JSON.stringify(out, null, 2));
  const merged = integration.filter((i) => i.state === "merged").length;
  const conflicts = integration.filter((i) => String(i.state).includes("CONFLICT")).length;
  log(`fleet ${ts}: lanes=${active.length} merged=${merged} conflicts=${conflicts}`);
  return out;
}
