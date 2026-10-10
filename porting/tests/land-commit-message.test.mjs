#!/usr/bin/env bun
// Contract suite: e11 — the `land(<repos>): fold proposal(s)` commit
// message is pinned at the emitter seam in land.ts.
// Run: bun porting/tests/land-commit-message.test.mjs   (exit 0 = pass)
//
// CONTRACT (platform/CONTRACT.md:85): a clean land creates exactly
// ONE commit on top of `baseRef` whose message is the template
// `land(<repos>): fold proposal(s)` — `<repos>` is the requested
// repos joined by a single comma with no spaces, and the suffix is
// literally `: fold proposal(s)`.
//
// Boundary: the BEHAVIORAL end-to-end proof — that a real landed
// commit on a real Artifacts repo carries this subject — is FR-14's
// E3-verify slice, owned by porting/tests/land-hardening.probe.mjs
// (which lands against a live repo and reads back evidence.commit).
// This order does NOT duplicate that live land (it would mutate the
// live demo, which verify orders must not). What this order pins is
// the STRUCTURAL contract at the emitter seam, following the
// platform-native-merge.test.mjs leg-1 precedent (static source
// assertions for configuration/shape contracts — import shape,
// call-site counts, pinned literals).
//
// Seams pinned: platform/src/land.ts:105-111 (the single git.commit
// call), :79 (pushLand signature), :27-33 (LandFile), :35-45
// (LandInput). Reference: platform/CONTRACT.md:85.

import { readFileSync } from "node:fs";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const J = (x) => JSON.stringify(x);

// Count call sites of `obj.prop` in source text — `member(` including
// optional whitespace before `(`. Excludes type-position uses like
// `typeof obj.prop` where no `(` follows the member expression.
// (Copied from platform-native-merge.test.mjs:48-54 — suites carry
// their own copy by convention; not imported.)
function countCallSites(src, member) {
  const esc = member.replace(/\./g, "\\.");
  const re = new RegExp(esc + "\\s*\\(", "g");
  let count = 0;
  while (re.exec(src) !== null) count++;
  return count;
}

const landSrc = readFileSync(new URL("../../platform/src/land.ts", import.meta.url), "utf8");
const contractSrc = readFileSync(new URL("../../platform/CONTRACT.md", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../../platform/src/index.ts", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 1. Exactly one git.commit call site in land.ts (the single commit a
//    clean land creates).
// ---------------------------------------------------------------------------
const commitSites = countCallSites(landSrc, "git.commit");
check(
  "1 land.ts has exactly one git.commit( call site",
  commitSites === 1,
  `found ${commitSites}`,
);

// ---------------------------------------------------------------------------
// 2. That call's `message` argument is the exact template literal
//    `land(${input.repos.join(",")}): fold proposal(s)` — pinning the
//    comma-join (no spaces) and the literal suffix byte-for-byte.
// ---------------------------------------------------------------------------
const messageTemplate = /message: `land\(\$\{input\.repos\.join\(","\)\}\): fold proposal\(s\)`/;
check(
  "2 git.commit message is the exact template land(<repos>): fold proposal(s) with comma-joined repos",
  messageTemplate.test(landSrc),
  "message template seam",
);

// ---------------------------------------------------------------------------
// 3. git.commit appears only inside pushLand (single-writer invariant;
//    matches platform-native-merge leg-1's "one git.clone + the pinned
//    push pair in land.ts, zero in index.ts").
// ---------------------------------------------------------------------------
const pushLandBody = landSrc.slice(landSrc.indexOf("export async function pushLand"), landSrc.indexOf("/**\n * Mint a repo-scoped write token"));
const commitInPushLand = countCallSites(pushLandBody, "git.commit");
const commitInIndex = countCallSites(indexSrc, "git.commit");
check(
  "3 git.commit appears only inside pushLand (single-writer)",
  commitInPushLand === 1 && commitInIndex === 0,
  `pushLand=${commitInPushLand} index=${commitInIndex}`,
);

// ---------------------------------------------------------------------------
// 4. CONTRACT.md documents the format `land(<repos>): fold proposal(s)`
//    (doc-pin and code-pin agree).
// ---------------------------------------------------------------------------
check(
  "4 CONTRACT.md documents the `land(<repos>): fold proposal(s)` format",
  contractSrc.includes("land(<repos>): fold proposal(s)"),
  "CONTRACT.md:85",
);

// ---------------------------------------------------------------------------
// 5. The E3 boundary is named: land-hardening.probe.mjs owns the
//    behavioral proof (a real landed commit carrying the subject).
// ---------------------------------------------------------------------------
check(
  "5 this suite names land-hardening.probe.mjs as the behavioral (E3) owner",
  /land-hardening\.probe\.mjs/.test(readFileSync(new URL("./land-commit-message.test.mjs", import.meta.url), "utf8")),
  "boundary comment",
);

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
