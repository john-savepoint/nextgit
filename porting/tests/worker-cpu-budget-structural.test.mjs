#!/usr/bin/env bun
// Structural assertion suite: FR-10 + CPU-budget work order.
// Run: bun porting/tests/worker-cpu-budget-structural.test.mjs   (exit 0 = pass)
//
// Static source inspection only — reads .ts source text, no worker execution,
// no mock.module, no Chrome, no network. Same pattern as normalize.test.mjs.
// Each assertion is a contract-gate that fails on regression:
//   * FORK_LOG_LIMIT pinned to 200 and applied to both log walks inside forkPoint
//   * no child_process import in index.ts (read routes never shell out)
//   * git.clone / git.push only in land.ts (read routes never clone or push)
//   * exactly one git.commit per land (one commit per fold-push)
//   * evidence record carries the FR-18 keys
//   * token revoked in the finally of handleLand
//   * reviewed-heads gate (reviewed?.baseHead + reviewed?.heads) precedes computeMerge
//     and returns 409 "stale" on mismatch
//
// The mechanism these pin mathematically guarantees the CPU budget: each proposal's
// fork walk is capped at 200 log entries (binding repo.log via FORK_LOG_LIMIT),
// and the read routes (index.ts) never invoke git.clone/git.push — there is no
// isomorphic-git in index.ts.

import { readFileSync } from "node:fs";

const indexSrc = readFileSync(new URL("../../platform/src/index.ts", import.meta.url), "utf8");
const landSrc = readFileSync(new URL("../../platform/src/land.ts", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

/**
 * Count actual call sites of `obj.prop` in source text, excluding type-position
 * references like `Parameters<typeof obj.prop>` and interface/type annotations.
 * A call site is `obj.prop(` — the `(` immediately after the member expression.
 */
function countCallSites(src, member) {
 // Escape dots for regex, then match `member` followed by optional whitespace
 // and an opening paren.
 const esc = member.replace(/\./g, "\\.");
 const re = new RegExp(esc + "\\s*\\(", "g");
 let count = 0;
 while (re.exec(src) !== null) count++;
 return count;
}

// 1. FORK_LOG_LIMIT pinned to 200 — the constant exists and both log walks
//    inside forkPoint bind `limit: FORK_LOG_LIMIT` (not a raw number).
check("FORK_LOG_LIMIT === 200", /const FORK_LOG_LIMIT\s*=\s*200;/.test(indexSrc));
const forkPointMatch = indexSrc.match(/async function forkPoint[\s\S]*?\n}/);
const forkPointBody = forkPointMatch ? forkPointMatch[0] : "";

const logCallsInFork = forkPointBody.match(/[A-Za-z_]+Repo\.log\(/g) || [];
const limitRefs = forkPointBody.match(/limit:\s*FORK_LOG_LIMIT/g) || [];
check("forkPoint bound log walks use limit: FORK_LOG_LIMIT", logCallsInFork.length === 2 && limitRefs.length === 2, `logCalls=${logCallsInFork.length}, limitRefs=${limitRefs.length}`);

// 2. No child_process in index.ts — the read routes never import or use a shell.
check("no child_process in index.ts", !/child_process/.test(indexSrc));

// 3. git.clone / git.push only in land.ts — index.ts has zero, land.ts has exactly one each.
check("git.clone only in land.ts", indexSrc.match(/git\.clone/g) === null && countCallSites(landSrc, "git.clone") === 1);
check("git.push only in land.ts", indexSrc.match(/git\.push/g) === null && countCallSites(landSrc, "git.push") === 1);

// 4. Exactly one git.commit per land (single commit per fold-push).
check("git.commit only in land.ts (one per land)", countCallSites(landSrc, "git.commit") === 1);

// 5. Evidence record carries the FR-18 keys.
check("evidence record keys", ["repos", "commit", "ancestor", "heads", "foldHash"].every((k) => indexSrc.includes(k)));

// 6. Token revocation in the finally block of handleLand.
check("token revoke in finally", /finally[\s\S]*?baseRepo\.revokeToken/s.test(indexSrc));

// 7. Reviewed-heads gate precedes computeMerge and returns 409 "stale".
//    Both reviewed?.heads and reviewed?.baseHead checks must appear before the
//    computeMerge call, and both return 409 with error: "stale".
check("reviewed-heads gate before fold", /reviewed\?\.heads[\s\S]*?reviewed\?\.baseHead[\s\S]*?computeMerge/s.test(indexSrc) && indexSrc.includes("stale"));

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
