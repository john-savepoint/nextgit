#!/usr/bin/env bun
// Contract suite: FR-35 consequence 2 — BYO harness clone/commit/three-refspec push protocol
// (story e7-verify-byo-harness-push-protocol).
//
// Deterministic source-parse contract test pinning all six invariants of the
// BYO-harness push protocol.
// Run: bun porting/tests/byo-harness-push-protocol.test.mjs  (exit 0 = pass)
// No network, no mocks — pure source text inspection of real-agents.mjs and
// CONTRACT.md, per the repo's bun check()+process.exit() convention.
//
// Invariants pinned:
//   1. Exactly one runner push invocation per agent (one("push", "origin", …))
//   2. That push carries exactly three refspecs
//   3. No --force / -f flag on the push (fast-forward-only mirror)
//   4. The agent prompt forbids "git push" (runner pushes for the agent)
//   5. The runner commits leftover work with committedByRunner tracking
//   6. The report table carries a "committed by" column fed by committedByRunner
//   7. CONTRACT.md documents the three-refspec agent push recipe

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
  } else {
    fail++;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const REAL_AGENTS = readFileSync("platform/scripts/real-agents.mjs", "utf8");
const CONTRACT = readFileSync("platform/CONTRACT.md", "utf8");

// --- Invariant 1: exactly one runner push call ---
const pushMatches = [...REAL_AGENTS.matchAll(/one\("push",\s*"origin",\s*(.*?)\)/g)];
check(
  "1. exactly one runner push invocation",
  pushMatches.length === 1,
  `found ${pushMatches.length} one("push",…) calls`,
);

// --- Invariant 2: exactly three refspecs ---
const refspecStr = pushMatches[0]?.[1] ?? "";
const refs = refspecStr
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
check(
  "2. push carries exactly three refspecs",
  refs.length === 3,
  `refs=[${refs.join(", ")}]`,
);

// --- Invariant 3: no --force / -f on the push ---
check(
  "3. push does not use --force or -f",
  !/one\("push"[^)]*--force/.test(REAL_AGENTS) && !/one\("push"[^)]*\s-f\b/.test(REAL_AGENTS),
  `--force/-f absent from push call`,
);

// --- Invariant 4: agent prompt forbids git push ---
check(
  "4. agent prompt forbids git push",
  /Do not run `git push` — the runner pushes for you/.test(REAL_AGENTS),
  `prompt contains the git push prohibition`,
);

// --- Invariant 5: runner commits leftover work with committedByRunner tracking ---
check(
  "5a. runner commits leftover work",
  /one\("add",\s*"-A"\)/.test(REAL_AGENTS) && /one\("commit",\s*"-m"/.test(REAL_AGENTS),
  `add -A + commit present`,
);
check(
  "5b. committedByRunner flag is tracked",
  /let committedByRunner = false/.test(REAL_AGENTS) &&
  /committedByRunner = true/.test(REAL_AGENTS) &&
  /row\.committedByRunner = committedByRunner/.test(REAL_AGENTS),
  `committedByRunner declared, set true, and assigned to row`,
);

// --- Invariant 6: report table has committed by column ---
check(
  "6. report table carries 'committed by' column",
  /\| committed by \|/.test(REAL_AGENTS) &&
  /r\.committedByRunner \? "runner" : r\.status === "ok" \? "agent" : "-"/.test(REAL_AGENTS),
  `column header + row expression present`,
);

// --- Invariant 7: CONTRACT.md documents the three-refspec recipe ---
const expectedRecipe = "git push origin main refs/notes/commits refs/notes/commits:refs/heads/nextgit-notes";
check(
  "7. CONTRACT.md documents the three-refspec push recipe",
  CONTRACT.includes(expectedRecipe),
  `recipe string found in CONTRACT.md`,
);

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
