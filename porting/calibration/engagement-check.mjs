#!/usr/bin/env bun
// engagement-check.mjs — the auto-land engagement guard (AD-11 / FR-26).
//
// `bun porting/calibration/engagement-check.mjs` exits 0 when the
// engagement posture is CONSISTENT:
//   - AUTO_LAND_ENGAGED=false (default, unengaged): PASS — auto-land
//     is off; no record is required (the switch is the gate).
//   - AUTO_LAND_ENGAGED=true (engaged): the calibration record MUST
//     pass record-check (exists, spike passes, sign-off present) —
//     engagement cannot ship without the record. Runs record-check.mjs
//     as a subprocess and requires exit 0.
// Any inconsistency (engaged + record failing/absent) exits non-zero
// with `FAIL: <reason>` — the repo fails.
//
// Imports the LIVE constant from ../../platform/src/autoland.ts so the
// check can never drift from the code (single source of truth).

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTO_LAND_ENGAGED } from "../../platform/src/autoland.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

function fail(reason) {
 console.log(`FAIL: ${reason}`);
 process.exit(1);
}

if (!AUTO_LAND_ENGAGED) {
 // Unengaged (the default): auto-land is off. No record required —
 // the switch itself is the gate.
 console.log("PASS (AUTO_LAND_ENGAGED=false — auto-land off by default)");
} else {
 // Engaged: the calibration record MUST pass record-check.
 let rc;
 try {
  rc = execFileSync("bun", [resolve(ROOT, "record-check.mjs")], {
   encoding: "utf8",
   stdio: ["ignore", "pipe", "pipe"],
  });
 } catch (e) {
  fail(`AUTO_LAND_ENGAGED=true but the calibration record fails record-check (exit ${e.status ?? "?"}): engagement cannot ship without the record`);
 }
 if (!/PASS/.test(rc)) fail("AUTO_LAND_ENGAGED=true but record-check did not report PASS");
 console.log("PASS (AUTO_LAND_ENGAGED=true — calibration record passes record-check)");
}
