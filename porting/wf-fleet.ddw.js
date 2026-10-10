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
  plans,
  spawnCap = 240,
  integrate = true, // O1 standing rule: wave lanes must not merge into the live tree directly —
  // pass integrate:false, then pin each lane tip and run wf-integrate (open/merge/battery/finalize).
} = {}) {
  if (!root) throw new Error("runFleet: root (main repo path) is required");
  const mainRoot = root;
  const fleetRoot = fleetDir ?? `${mainRoot}/.fleet`;
  // Every lane + every spawned adapter call must see the SHARED store.
  const beadsDir = process.env.BEADS_DIR ?? `${mainRoot}/.beads`;
  process.env.BEADS_DIR = beadsDir;
  mkdirSync(fleetRoot, { recursive: true });
  mkdirSync(`${mainRoot}/porting/runs`, { recursive: true });

  // Chrome memory guard (John, 2026-10-08): at 30 concurrent workflows unbounded headless
  // Chrome OOMs the box. Suites resolve Chrome PATH-FIRST (`which google-chrome` before the
  // CHROME_BIN fallback), so the reliable injection is a PATH shim: `<fleet>/bin/google-chrome`
  // -> chrome-slot.sh (flock, N slots). CHROME_BIN_REAL is pinned so the slot script cannot
  // re-find the shim (exec-loop hazard); CHROME_BIN also points at the slot script for probes.
  const slotScript = `${mainRoot}/porting/tests/chrome-slot.sh`;
  if (!process.env.NEXTGIT_CHROME_GUARD && existsSync(slotScript)) {
    try {
      const real = (() => {
        for (const c of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
          if (existsSync(c)) return c;
        }
        try {
          return execFileSync("bash", ["-lc", "command -v google-chrome || command -v chromium || true"], { encoding: "utf8" }).trim().split("\n")[0] || null;
        } catch { return null; }
      })();
      if (real) {
        const shimDir = `${fleetRoot}/bin`;
        mkdirSync(shimDir, { recursive: true });
        const shim = `${shimDir}/google-chrome`;
        writeFileSync(shim, `#!/usr/bin/env bash\nexec "${slotScript}" "$@"\n`);
        execFileSync("chmod", ["+x", shim]);
        process.env.CHROME_BIN_REAL = real; // pinned: slot script must never resolve the shim
        process.env.CHROME_BIN = slotScript; // probe prefers this env var
        process.env.PATH = `${shimDir}:${process.env.PATH}`;
        process.env.NEXTGIT_CHROME_GUARD = "1";
        log(`fleet: chrome guard on PATH (${shimDir}; real=${real}; slots=${process.env.CHROME_SLOTS ?? 4})`);
      } else {
        console.error("fleet: chrome guard skipped — no real Chrome binary found");
      }
    } catch (e) {
      console.error(`fleet: chrome guard failed (${String(e?.message ?? e).slice(0, 120)})`);
    }
  }
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
  // plans (optional, aligned to laneIds order): { ids?: string[], lenses?: string[], parallel?: number, limit?: number }
  // — enforces the O2 file-ownership pre-pass (explicit id sets per lane) and the O3
  // risk tiering (2 lenses for docs/tests lanes, 4 for platform-risky lanes).
  const { runBatch } = await import(`${mainRoot}/porting/wf-batch.ddw.js`);
  const settled = await Promise.allSettled(
    active.map((id, i) => {
      const plan = plans ? plans[laneIds.indexOf(id)] ?? null : null;
      return runBatch({
        root: `${fleetRoot}/${id}`,
        limit: plan?.limit ?? limit,
        parallel: plan?.parallel ?? parallel,
        sourceLike,
        evidenceRoot: mainRoot,
        agent: agentOpt,
        ids: plan?.ids,
        lenses: plan?.lenses,
      });
    }),
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

  // O7 — spawn telemetry (estimate: per order ≈ 3 phases [plan/impl/verify] + its lens count;
  // + 2 batch gates per lane). A wave over the cap HALTS before integration (runaway guard).
  const spawnEstimate = runs.reduce((n, r) => {
    const plan = plans ? plans[laneIds.indexOf(r.id)] ?? null : null;
    const lensCount = plan?.lenses?.length ?? 4;
    return n + (r.orders?.length ?? 0) * (3 + lensCount) + 2;
  }, 0);
  const spawnCapExceeded = spawnEstimate > spawnCap;

  // ---- serial integration into main --------------------------------------------
  // Main-tree cleanliness gate: a dirty main tree refuses lane merges (and is usually a leak's
  // fingerprint — lane agents' cwd is main, so relative-path writes escape the worktree). Detect
  // ONCE per wave; if dirty, skip ALL integration with named files instead of failing halfway.
  let mainDirty = "";
  try {
    mainDirty = execFileSync("git", ["-C", mainRoot, "status", "--porcelain"], { encoding: "utf8", timeout: 30000 }).trim();
  } catch { }
  const integration = [];
  if (!integrate) {
    // O1 (HANDOFF-SESSION rule 5 / DIAGNOSIS O1): lanes must NEVER merge into the live tree
    // directly — main stays untouched until the transactional wave battery (wf-integrate) is
    // green. Wave-8 launches with integrate:false; the orchestrator pins each lane tip
    // (refs/lane/…) and runs wf-integrate open/merge/battery/finalize.
    for (const r of runs) {
      integration.push({
        id: r.id,
        state: "deferred — O1 transactional integration (integrate:false)",
        detail: `pin ${fleetRoot}/${r.id} main → refs/lane/<name>; then wf-integrate open/merge/battery/finalize`,
      });
    }
  } else if (spawnCapExceeded) {
    for (const r of runs) integration.push({ id: r.id, state: `halted — spawn estimate ${spawnEstimate} > cap ${spawnCap} (O7 runaway guard)`, detail: "raise spawnCap or split the wave" });
    console.error(`fleet: O7 spawn cap exceeded (${spawnEstimate} > ${spawnCap}) — integration halted`);
  } else if (mainDirty) {
    const files = mainDirty.split("\n").map((l) => l.slice(3).split(" -> ")[0]).slice(0, 12);
    for (const r of runs) integration.push({ id: r.id, state: "main-dirty — integration skipped", detail: files.join(", ") });
    console.error(`fleet: main tree dirty — integration skipped for all lanes (reconcile: ${files.join(", ")})`);
  } else
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

  // ---- UX lens (John, 2026-10-08): every wave gets a UX/UI pass on the LIVE page ----
  // Objective breakage is already covered by the live-render probe; this lens reviews
  // consistency + product feel against the UX spines. Runs on the main tree's evidence.
  const uxReportPath = `${mainRoot}/porting/runs/fleet-${ts}-ux.md`;
  try {
    const liveProbe = (() => {
      try {
        execFileSync("node", [`${mainRoot}/porting/tests/live-render.probe.mjs`], { cwd: mainRoot, encoding: "utf8", timeout: 150000, env: process.env });
        return "live-render probe: LIVE PAGE OK";
      } catch (e) {
        return `live-render probe: BROKEN — ${String(e.stdout ?? e.message).slice(-400)}`;
      }
    })();
    const ux = await agent(
      `UX LENS for fleet wave ${ts} — review the LIVE deployment as a product designer would.\n` +
      `1. Read the objective gate first: ${liveProbe}\n` +
      `2. Read the design spines: _bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/DESIGN.md and EXPERIENCE.md.\n` +
      `3. Inspect the live page evidence under ${mainRoot}/porting/runs/live-render-*/ (dom.html + summary.json — the freshest dir) and the deployed CSS/JS (curl ${process.env.PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev"}/styles.css, /app.js).\n` +
      `4. Apply the UI/UX skills: frontend-design, accessibility-pro, high-end-visual-design (load by trigger; read frontmatter first if unsure).\n` +
      `5. Write ${uxReportPath}: what the page looks like state-by-state (cards/chips/banner/empty), inconsistencies vs DESIGN.md/EXPERIENCE.md, concrete fixes (file:line where possible), and a verdict {verdict: "OK"|"ISSUES", findings: [...]}.\n` +
      `Do NOT edit files. Keep it honest and specific — this report drives the next wave's UI orders.`,
      { agent: "designer", label: `ux-lens:${ts}`, schema: { type: "object", required: ["verdict", "findings"], properties: { verdict: { enum: ["OK", "ISSUES"] }, findings: { type: "array", items: { type: "string" } } } } },
    ).wait();
    writeFileSync(uxReportPath, `# UX lens — fleet ${ts}\n\n${liveProbe}\n\n## Verdict: ${ux.verdict}\n\n${(ux.findings ?? []).map((f) => `- ${f}`).join("\n")}\n`);
    log(`ux lens: ${ux.verdict} (${(ux.findings ?? []).length} findings) -> ${uxReportPath}`);
  } catch (e) {
    try { writeFileSync(uxReportPath, `# UX lens — fleet ${ts}\n\nFAILED: ${String(e?.message ?? e).slice(0, 300)}\n`); } catch { }
    console.error(`fleet: ux lens failed (${String(e?.message ?? e).slice(0, 160)}) — recorded`);
  }

  const out = {
    ts,
    beadsDir,
    lanes: prep,
    runs,
    integration,
    spawnEstimate,
    spawnCap,
    uxReport: uxReportPath,
    next: "review integration[]; reconcile CONFLICT lanes; read the UX report; regenerate the spine views; commit",
  };
  writeFileSync(`${mainRoot}/porting/runs/fleet-${ts}.json`, JSON.stringify(out, null, 2));
  const merged = integration.filter((i) => i.state === "merged").length;
  const conflicts = integration.filter((i) => String(i.state).includes("CONFLICT")).length;
  log(`fleet ${ts}: lanes=${active.length} merged=${merged} conflicts=${conflicts}`);
  return out;
}
