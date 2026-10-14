#!/usr/bin/env bun
// Contract guard — nextgit-e17-mach-claims-guard-chrome (item 2)
// Run: bun porting/tests/ui-whitelist-parity.test.mjs   (exit 0 = pass)
//
// The UI-serve whitelist travels in THREE carriers:
//   A = platform/src/index.ts            — UI_ASSET_PATHS (the dispatcher's
//                                          literal; serves exactly these)
//   B = porting/tests/route-discipline.test.mjs — Group 3 literal (the live
//                                          dispatcher parity check's array)
//   C = platform/CONTRACT.md             — §API-boundary "UI document" list
//                                          (the documented contract)
// All three must carry the SAME path set (normalized: "" ≡ "/"). Wave-16
// realized the drift class: UI_ASSET_PATHS gained entries the CONTRACT never
// recorded (CHECKPOINT 2026-10-14 wave-16). This guard is the single
// greppable place naming all three carriers so the next edit moves them in
// lockstep (the PIN-WEB rule: a count/name pin and its prose carriers move
// together).
//
// Static filesystem reads only; guards the file surface, not runtime
// behavior. No mock.module, no live worker, no env deps — full-suite safe
// (mirrors contract-single-source.test.mjs posture). Extraction is
// fail-closed: a malformed literal throws → exit 1, never silently
// compares a partial set equal.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const contract = read("platform/CONTRACT.md");
const source = read("platform/src/index.ts");
const routeDiscipline = read("porting/tests/route-discipline.test.mjs");

// --- extract A: keys of the UI_ASSET_PATHS object literal ---------------
const aBlock = source.match(/const UI_ASSET_PATHS: Record<string, true> = \{([\s\S]*?)\n\};/);
if (!aBlock) throw new Error("index.ts: UI_ASSET_PATHS literal not found (shape drifted — fix the extractor)");
const A = Array.from(aBlock[1].matchAll(/"([^"]+)":\s*true/g)).map((m) => m[1]);

// --- extract B: the Group 3 "UI-serve law" array literal ----------------
const bSection = routeDiscipline.match(/\/\/ Group 3 — UI-serve law:[\s\S]*?for \(const p of \[([\s\S]*?)\]\)/);
if (!bSection) throw new Error("route-discipline.test.mjs: Group 3 array literal not found (shape drifted — fix the extractor)");
const B = Array.from(bSection[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);

// --- extract C: the CONTRACT.md §API-boundary "UI document" list --------
const cLine = contract.match(/\*\*UI document\*\* \(`(.*?)`\)/);
if (!cLine) throw new Error("CONTRACT.md: §API-boundary 'UI document' list not found (shape drifted — fix the extractor)");
const C = cLine[1].split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean);

// The ""/"/" pair is the root-doc idiom in the source literal; normalize
// "" → "/" so the three carriers compare on the same key.
const norm = (xs) => xs.map((p) => (p === "" ? "/" : p));
const nA = norm(A), nB = norm(B), nC = norm(C);
const eq = (x, y) => x.length === y.length && [...x].sort().join("\n") === [...y].sort().join("\n");
const diff = (x, y) => {
  const sx = new Set(x), sy = new Set(y);
  const onlyX = x.filter((p) => !sy.has(p)), onlyY = y.filter((p) => !sx.has(p));
  return [...onlyX.map((p) => `only in left: ${p}`), ...onlyY.map((p) => `only in right: ${p}`)].join("; ");
};

// --- the parity checks --------------------------------------------------
check("1 index.ts UI_ASSET_PATHS == route-discipline Group 3 (normalized)", eq(nA, nB), diff(nA, nB));
check("2 index.ts UI_ASSET_PATHS == CONTRACT.md UI document list (normalized)", eq(nA, nC), diff(nA, nC));
check("3 route-discipline Group 3 == CONTRACT.md UI document list (normalized)", eq(nB, nC), diff(nB, nC));
check("4 non-empty + no duplicates within each carrier",
  A.length > 0 && B.length > 0 && C.length > 0 &&
  new Set(A).size === A.length && new Set(B).size === B.length && new Set(C).size === C.length,
  `A=${A.length} B=${B.length} C=${C.length} (dups: A=${A.length - new Set(A).size}, B=${B.length - new Set(B).size}, C=${C.length - new Set(C).size})`);
const badShape = [...nA, ...nB, ...nC].filter((p) => !p.startsWith("/") || /\s/.test(p) || p.includes("?") || p.includes("#"));
check("5 every path starts with '/' and carries no whitespace/?/# (serve-path shape law)", badShape.length === 0, badShape.join("; "));

console.log(fails === 0 ? `ALL PASS (${checks} checks)` : `${fails} FAILURES (${checks} checks)`);
process.exit(fails === 0 ? 0 : 1);
