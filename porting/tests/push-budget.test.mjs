#!/usr/bin/env bun
// Contract suite: push budget seam (order nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap).
// Run: bun porting/tests/push-budget.test.mjs   (exit 0 = pass)
//
// Pure seam, no construction: exercises the budget rule itself —
// platform/src/push-budget.ts — arithmetic, threshold, and the typed
// fail-closed error. Real arithmetic on real strings; no mocks, no
// git, no module mocks, no source grep. Full-suite safe.
//
// The contract this suite pins:
//   * estimatePushBytes sums the per-file text length x 2 (a
//     conservative upper bound — UTF-16 code units -> ~2 bytes each)
//     and treats a missing/withheld file as 0;
//   * the empty list estimates 0;
//   * assertPushBudget passes at budget-1 and at exactly the budget;
//   * assertPushBudget throws a PushBudgetError (typed, carries the
//     estimate) at budget+1;
//   * PUSH_BUDGET_BYTES is 16 MiB, derived from the research-measured
//     platform cap (~64 MiB; 63 MiB passes, 64 MiB HTTP 500 —
//     research.md:65) with 4x headroom.

import {
  PUSH_BUDGET_BYTES,
  PushBudgetError,
  assertPushBudget,
  estimatePushBytes,
} from "../../platform/src/push-budget.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// (1) The budget constant is 16 MiB (4x under the measured 63 MiB
// pass threshold — a policy constant, moves in one place).
check(
  "1 PUSH_BUDGET_BYTES is 16 MiB",
  PUSH_BUDGET_BYTES === 16 * 1024 * 1024,
  `got ${PUSH_BUDGET_BYTES}`,
);

// (2) Empty file list estimates zero.
check(
  "2 empty list estimates 0",
  estimatePushBytes([]) === 0,
  `got ${estimatePushBytes([])}`,
);

// (3) A single text file estimates length x 2 (documented upper bound).
const ONE_KB = "x".repeat(1024);
check(
  "3 single file = length x 2",
  estimatePushBytes([{ path: "a.txt", content: ONE_KB }]) === 2048,
  `got ${estimatePushBytes([{ path: "a.txt", content: ONE_KB }])}`,
);

// (4) Multiple files sum.
const files = [
  { path: "a.txt", content: "aaaa" },   // 4 chars -> 8
  { path: "b.txt", content: "bb" },     // 2 chars -> 4
  { path: "c.txt", content: "cccccc" }, // 6 chars -> 12
];
check(
  "4 multiple files sum",
  estimatePushBytes(files) === 24,
  `got ${estimatePushBytes(files)}`,
);

// (5) Missing/withheld content (null or absent) counts as 0 — the
// estimate never fabricates bytes for a file the fold withheld.
check(
  "5 null content = 0",
  estimatePushBytes([{ path: "x.txt", content: null }]) === 0,
  `got ${estimatePushBytes([{ path: "x.txt", content: null }])}`,
);
check(
  "5b absent content = 0",
  estimatePushBytes([{ path: "x.txt" }]) === 0,
  `got ${estimatePushBytes([{ path: "x.txt" }])}`,
);

// (6) Mixed null + text sums only the text.
check(
  "6 mixed null + text",
  estimatePushBytes([{ path: "a", content: null }, { path: "b", content: "yyy" }]) === 6,
  `got ${estimatePushBytes([{ path: "a", content: null }, { path: "b", content: "yyy" }])}`,
);

// (7) Non-ASCII text: length counts UTF-16 code units (surrogates
// count as 2 units — still an upper bound on UTF-8 bytes for
// BMP text; astral planes are the rare exception, x2 covers them).
check(
  "7 non-ASCII counts code units",
  estimatePushBytes([{ path: "u.txt", content: "héllo→" }]) === 12,
  `got ${estimatePushBytes([{ path: "u.txt", content: "héllo→" }])}`,
);

// (8) assertPushBudget passes below the budget.
check(
  "8 passes at budget-1",
  (() => {
    try {
      assertPushBudget(PUSH_BUDGET_BYTES - 1);
      return true;
    } catch {
      return false;
    }
  })(),
);

// (9) assertPushBudget passes at exactly the budget (the budget is
// the inclusive ceiling — the cap it refuses is anything ABOVE it).
check(
  "9 passes at exactly the budget",
  (() => {
    try {
      assertPushBudget(PUSH_BUDGET_BYTES);
      return true;
    } catch {
      return false;
    }
  })(),
);

// (10) assertPushBudget throws PushBudgetError above the budget.
let threw = null;
try {
  assertPushBudget(PUSH_BUDGET_BYTES + 1);
} catch (e) {
  threw = e;
}
check(
  "10 throws PushBudgetError at budget+1",
  threw instanceof PushBudgetError,
  `got ${threw?.constructor?.name ?? "no throw"}`,
);

// (11) The thrown error carries the estimate (byte counts only —
// STRIDE: no content, no tokens, no paths).
check(
  "11 PushBudgetError carries estimatedBytes",
  threw instanceof PushBudgetError && threw.estimatedBytes === PUSH_BUDGET_BYTES + 1,
  `got ${threw?.estimatedBytes ?? "n/a"}`,
);

// (12) The error message is content-free metadata (no file paths,
// no content — only the byte count and the budget).
check(
  "12 error message is content-free",
  threw instanceof PushBudgetError &&
  /push budget/i.test(threw.message) &&
  !/path|content|merged/i.test(threw.message.replace(/push budget/i, "")),
  `got "${threw?.message ?? "n/a"}"`,
);

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
