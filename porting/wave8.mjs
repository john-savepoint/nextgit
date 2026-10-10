// porting/wave8.mjs — WAVE 8 LANE PLAN (O2 file-ownership + O3 risk tiers + O7 spawn budget).
//
// PREPARED, NOT LAUNCHED (John, 2026-10-10: "dont start wave 8 yet").
//
// LAUNCH (one-liner, from the main repo root):
//   const { plan } = await import("./porting/wave8.mjs");
//   const { runFleet } = await import("./porting/wf-fleet.ddw.js");
//   await runFleet({ root: process.cwd(), ...plan });
//
// WHY THIS SHAPE:
// - O2 single-owner: every order that WRITES a shared file is chained (parallel:1) inside ONE
//   lane. The connected writer-cluster is platform/src/index.ts + platform/src/auth.ts +
//   platform/src/judge.ts + platform/CONTRACT.md (they interlock through reveal/token-audit/
//   rate-limits) → lane-1 "core-chain", 10 orders serial, ordered router→policy→contract pins.
//   Scripts cluster (fanout/agents/real-agents/secret-fixture + githttp.ts) → lane-2.
//   No two lanes touch the same file. (The O1 engine can merge conflicts, but the wave-7 burn
//   says: don't create them.)
// - O3 risk tiers: 4 lenses on platform/src/auth/secrets writers (lanes 1-2); 2 lenses
//   (quality + spec-fit) on UI/docs/tests lanes (lanes 3-7).
// - Verify lanes are split by SIDE EFFECT: lane-5 is SERIAL because its orders touch the LIVE
//   demo (/land probes; real CLI agents; one lands agent-3) — concurrent live mutation is how
//   wave-6 created phantom conflicts. lane-6/lane-7 are read-only (loopback + live GETs) → parallel:4.
// - O7 budget: spawn estimate = Σ orders × (3 phases + lens count) + 2 gates/lane = 208
//   (lane1 70 + lane2 14 + lane3 5 + lane4 5 + lane5 35 + lane6 40 + lane7 25 + gates 14).
//   Cap 240. Heals not counted; raise the cap or split the wave if a chain heals repeatedly.
//   (34 orders assigned; 2 e11 verifies are store-dep'd on the lane-1 router fix and re-run
//   in wave 9 after the post-wave deploy.)
//
// PREFLIGHT (all must hold before launch):
//   1. main clean (`git status --porcelain` empty) — runFleet refuses integration on dirty main.
//   2. store: 0 claims (`bd list --json | jq '[.[]|select(.assignee)]|length'` = 0).
//   3. lane clones resync: runFleet prep merges main into each lane; any lane with unmerged
//      commits is HELD (reconcile or re-create the clone first).
//   4. `node platform/scripts/demo-verify.mjs` → 25/25 BEFORE (baseline).
//   5. chrome guard present: `.fleet/bin/google-chrome` shim + CHROME_BIN_REAL pinned (fleet sets env).
//   6. models: both config layers route through the @workflows role (verified 2026-10-10:
//      commandcode/inclusionai/ling-3.1-flash:free:xhigh).
//
// POSTFLIGHT (after integration + battery + deploy):
//   1. `bun porting/tests/live-render.probe.mjs` + `node platform/scripts/demo-verify.mjs`.
//   2. DEMO RESET (lane-5 lands agent-3 and re-runs real agents):
//      seed.mjs → agents.mjs → secret-fixture.mjs → demo-verify.mjs (25/25).
//   3. Tick GREEN rows; regenerate views; commit.
//   4. O8 leftovers: none (sweep completed 2026-10-10).

export const plan = {
  lanes: 7,
  limit: 12, // upper bound; per-lane plans carry exact counts
  parallel: 1, // default; per-lane plans override
  sourceLike: "compile:compile-2026-10-06T13-31-51",
  spawnCap: 240,
  plans: [
    {
      // lane-1: core-chain — EVERY shared-file writer (index.ts / auth.ts / judge.ts / CONTRACT.md), serial.
      name: "core-chain",
      parallel: 1,
      limit: 10,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-e11-impl-api-route-discipline", // dispatch table + 405/404 JSON — foundational for every later index.ts edit
        "nextgit-e8-impl-allowlist-all-routes", // allowlist via authorize() on every base/repos param
        "nextgit-e8-impl-route-rate-limits", // rate.ts module; generalizes judgeRateAllow (judge.ts)
        "nextgit-e5-impl-calibration-record-v1", // judge.ts constants + calibration record (after the limiter move)
        "nextgit-e8-impl-token-audit-two-surfaces", // index.ts + CONTRACT.md (audit shapes)
        "nextgit-e8-impl-csrf-precondition-gate", // auth.ts fail-closed seam
        "nextgit-e8-impl-reveal-behind-seam", // index.ts + auth.ts + CONTRACT.md (needs csrf semantics)
        "nextgit-e11-impl-pin-client-protocol", // CONTRACT.md — 11-entity client protocol
        "nextgit-e13-impl-cap10-contract-pin", // CONTRACT.md — CAP-10 intent/matcher contract
        "nextgit-e7-impl-byo-harness-onboarding-standard", // CONTRACT.md + validator declaration schema
      ],
    },
    {
      // lane-2: scripts-chain — token minting + storage hygiene (same script files, serial).
      name: "scripts-chain",
      parallel: 1,
      limit: 2,
      lenses: ["quality", "spec-fit", "security", "resilience"],
      ids: [
        "nextgit-e8-impl-repo-token-ttl-policy", // scripts/lib/tokens.mjs + 4 mint sites
        "nextgit-e8-impl-token-storage-hygiene", // same 4 writers (0600, no token logs) + githttp.ts
      ],
    },
    {
      // lane-3: UI — app.js EventSource consumer (single writer).
      name: "ui",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit"],
      ids: ["nextgit-e4-impl-ui-consume-event-stream"],
    },
    {
      // lane-4: README — submission run-instructions cross-link (docs-only).
      name: "readme",
      parallel: 1,
      limit: 1,
      lenses: ["quality", "spec-fit"],
      ids: ["nextgit-e10-impl-submission-readme-run-instructions"],
    },
    {
      // lane-5: verify-live — SERIAL: these touch the live deployment; two of them mutate the
      // demo fixture (land-beat lands agent-3; real-agents reshapes agent-1..4). Read-only
      // probes first, mutating last; postflight resets the demo.
      name: "verify-live",
      parallel: 1,
      limit: 7,
      lenses: ["quality", "spec-fit"],
      ids: [
        "nextgit-e6-verify-repo-pushed-feed-on-land", // scratch land probe → feed event
        "nextgit-e10-verify-colliding-land-refusal", // 409 conflict on agent-1×agent-2 (read-only)
        "nextgit-e10-verify-secret-land-refusal", // 409 withheld-secret on agent-5 (read-only)
        "nextgit-e10-verify-live-workers-artifacts-no-mocks", // live worker + namespace reads
        "nextgit-e10-verify-failure-card-banner-states", // banner states over fixtures + live reads
        "nextgit-e10-verify-land-beat-receipt", // MUTATES: lands agent-3 into demo
        "nextgit-e10-verify-real-agents-concurrent-run", // MUTATES: real CLI agents reshape agent-1..4
      ],
    },
    {
      // lane-6: verify-tour — tour suite, loopback + read-only live GETs → parallel.
      name: "verify-tour",
      parallel: 4,
      limit: 8,
      lenses: ["quality", "spec-fit"],
      ids: [
        "nextgit-e9-verify-stepper-nav",
        "nextgit-e9-verify-steps-0-2-sims",
        "nextgit-e9-verify-steps-3-5-sims",
        "nextgit-e9-verify-step6-live-proposals",
        "nextgit-e9-verify-step7-quiz",
        "nextgit-e9-verify-steps-8-9-scope-role",
        "nextgit-e9-verify-fetch-fallback",
        "nextgit-e9-verify-mobile-stacking",
      ],
    },
    {
      // lane-7: verify-api — contract/route verification, read-only → parallel.
      // NOTE (2026-10-10): e11-verify-json-404-unknown-paths and e11-verify-method-guards were
      // deferred OUT of wave 8 — both probe the LIVE worker and their authoring notes record
      // "NOT satisfied today" (asset fallthrough); their repair (e11-impl-api-route-discipline)
      // is lane-1 #1 and only reaches the live worker post-deploy. They now carry a store dep
      // on that order and re-run in wave 9 (after deploy + tick).
      name: "verify-api",
      parallel: 4,
      limit: 5,
      lenses: ["quality", "spec-fit"],
      ids: [
        "nextgit-e11-verify-contract-single-source",
        "nextgit-e11-verify-default-resolution-pinned",
        "nextgit-e11-verify-seven-route-surface",
        "nextgit-e11-verify-enums-timestamps-msg-pin",
        "nextgit-e11-verify-judge-pin-caps-ratelimit",
      ],
    },
  ],
};

// Launch-time validator (also run at prepare time):
//   const { plan, validate } = await import("./porting/wave8.mjs");
//   await validate(); // throws with a precise message on drift
export async function validate(root = process.cwd()) {
  const { execFileSync } = await import("node:child_process");
  const rows = JSON.parse(execFileSync("bun", [`${root}/porting/tasks.mjs`, "list", "--json"], { cwd: root, encoding: "utf8" }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const done = new Set(rows.filter((r) => r.status === "done" || r.status === "remediated").map((r) => r.id));
  const problems = [];
  const seen = new Set();
  for (const lane of plan.plans) {
    for (const id of lane.ids) {
      if (seen.has(id)) problems.push(`duplicate across lanes: ${id}`);
      seen.add(id);
      const row = byId.get(id);
      if (!row) problems.push(`missing from store: ${id}`);
      else {
        if (row.status !== "pending") problems.push(`not pending (${row.status}): ${id}`);
        const deps = (row.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const unmet = deps.filter((d) => !done.has(d));
        if (unmet.length) problems.push(`dep-gated (${unmet.join(",")}): ${id}`);
      }
    }
  }
  const assigned = [...seen];
  const runnableAll = rows
    .filter((r) => String(r.source ?? "").startsWith("compile:") && r.status === "pending")
    .filter((r) => ((r.deps ?? "").split(",").map((s) => s.trim()).filter(Boolean)).every((d) => done.has(d)))
    .map((r) => r.id);
  const unassigned = runnableAll.filter((id) => !seen.has(id));
  if (unassigned.length) problems.push(`runnable but unassigned: ${unassigned.join(", ")}`);
  if (problems.length) throw new Error(`wave8 plan invalid:\n- ${problems.join("\n- ")}`);
  return { ok: true, assigned: assigned.length, lanes: plan.plans.length };
}
