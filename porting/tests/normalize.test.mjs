#!/usr/bin/env node
// Regression test for the work-order runner's verdict normalization.
// Run: node porting/tests/normalize.test.mjs   (exit 0 = pass)
// Guards the fail-closed contract the bootstrap-health-sweep gates demanded:
// a lens reporting SHIP while listing ship-blockers/highs must never yield a green light.

import { normalizeVerdict } from "../wf-template.ddw.js";

const cases = [
  ["obj clean SHIP", { verdict: "SHIP", shipBlockers: [], highs: [], mediums: [], notes: [] }, "SHIP"],
  ["obj SHIP + shipBlocker (was fail-open)", { verdict: "SHIP", shipBlockers: ["C1 not actually run"] }, "BLOCK"],
  ["obj SHIP + high (was fail-open)", { verdict: "SHIP", highs: ["unreported source mutation"] }, "BLOCK"],
  ["arr SHIP alone", ["SHIP"], "SHIP"],
  ["arr SHIP + high (was fail-open)", ["SHIP", "HIGH: x"], "BLOCK"],
  ["blanks are not findings", { verdict: "SHIP", shipBlockers: [""], highs: [""] }, "SHIP"],
  ["no verdict field", { shipBlockers: [] }, "BLOCK"],
  ["undefined shape", undefined, "BLOCK"],
  ["error shape", new Error("boom"), "BLOCK"],
  ["pinned-shape FAIL + HIGH finding", { verdict: "FAIL", summary: "two issues", findings: [{ severity: "HIGH", title: "secret in log" }] }, "BLOCK"],
  ["pinned-shape WARN + medium only", { verdict: "WARN", summary: "nit", findings: [{ severity: "MEDIUM", title: "naming" }] }, "SHIP"],
  ["pinned-shape PASS clean", { verdict: "PASS", summary: "ok", findings: [] }, "SHIP"],
  ["blocked() check: SHIP+highs blocks", { verdict: "SHIP", highs: ["h"] }, null],
  ["pinned-shape WARN + HIGH finding", { verdict: "WARN", findings: [{ severity: "HIGH", title: "x" }] }, "BLOCK"],
  ["pinned-shape PASS + CRITICAL finding", { verdict: "PASS", findings: [{ severity: "CRITICAL", title: "y" }] }, "BLOCK"],
  ["pinned-shape WARN + string severity finding", { verdict: "WARN", findings: ["HIGH: secret in log"] }, "BLOCK"],
  ["pinned-shape issue-field tag", { verdict: "FAIL", findings: [{ severity: "HIGH", issue: "table drop" }] }, "BLOCK"],
  ["reviewer overall_correctness INCORRECT", { overall_correctness: "INCORRECT", explanation: "wrong", confidence: 0.9 }, "BLOCK"],
  ["reviewer overall_correctness CORRECT", { overall_correctness: "CORRECT", explanation: "fine", confidence: 0.8 }, "SHIP"],
];

let fails = 0;
for (const [name, input, want] of cases) {
  const got = normalizeVerdict("test", input instanceof Error ? null : input, input instanceof Error ? input : null);
  const blocked = [got].some((g) => g.verdict !== "SHIP");
  const ok = want === null ? blocked === true : got.verdict === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} → ${got.verdict} (blocked=${blocked})`);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
