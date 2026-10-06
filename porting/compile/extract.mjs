#!/usr/bin/env bun
// porting/compile/extract.mjs — deterministic requirements extractor for the epics compiler.
//
// Reads (sources of record):
//   - the PRD: FR blocks (`#### FR-N: title` + `**Status:**` + description + `**Consequences (testable):**`),
//     the NFR list (section 6), and counts.
//   - the PRD run's UX extract (build gaps / behaviors) → UX-DRs.
//   - the PRD run's architecture extract (constraints + near-term capabilities) → ARCH items.
// Writes: porting/compile/requirements.json
//
// Determinism: pure text parsing, no network, no agents. Fails LOUD on shape drift:
//   - FR count != 47, an FR missing its status line, an FR whose status classifies to no need,
//     a UX-DR / NFR section that parses to zero items → exit 1 with a precise message.
//
// Run: bun porting/compile/extract.mjs [--root /path/to/repo]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const ROOT = resolve(argOf("--root", process.cwd()));
const PRD_RUN = `${ROOT}/_bmad-output/planning-artifacts/prds/prd-cloudflare-git-comp-2026-10-06`;
const PRD = `${PRD_RUN}/prd.md`;
const UX = `${PRD_RUN}/.working/ux-extract.md`;
const ARCH = `${PRD_RUN}/.working/arch-extract.md`;
const OUT = `${ROOT}/porting/compile/requirements.json`;
const EXPECTED_FRS = 47;

const fail = (msg) => {
  console.error(`extract: ${msg}`);
  process.exit(1);
};

const read = (p, label) => {
  try {
    return readFileSync(p, "utf8");
  } catch (e) {
    fail(`cannot read ${label}: ${p} (${e.message})`);
  }
};

// --- PRD: FR blocks -----------------------------------------------------------
const prd = read(PRD, "PRD");
const lines = prd.split("\n");

// Classify a raw status line into needs. Text heuristics, kept deliberately explicit:
//   build-gap | required-M1 | planned | not started | pending | roadmap | sequenced (Mn) → implementation
//   built (but NOT "not yet built") → verification
//   mixed statuses ("built (...) / build-gap (...) / required-M1 (...)" in one line) → union.
const classifyStatus = (raw, frId) => {
  const s = raw.toLowerCase();
  const sNoNotYet = s.replace(/not yet built/g, "");
  const needs = { implementation: false, verification: false };
  const milestones = new Set();
  if (/build-gap/.test(s)) needs.implementation = true;
  if (/required-m1/.test(s)) { needs.implementation = true; milestones.add("M1"); }
  if (/not started/.test(s)) needs.implementation = true;
  if (/\bplanned\b/.test(s)) needs.implementation = true;
  for (const m of s.matchAll(/sequenced \(m([2-4])\)/g)) { needs.implementation = true; milestones.add(`M${m[1]}`); }
  if (/\bpending\b/.test(s)) needs.implementation = true;
  if (/\broadmap\b/.test(s)) needs.implementation = true;
  if (/\bbuilt\b/.test(sNoNotYet)) needs.verification = true;
  if (!needs.implementation && !needs.verification) fail(`FR ${frId}: status classified to no need — raw: "${raw}"`);
  const milestoneHint = milestones.has("M1") ? "M1" : [...milestones].sort()[0] ?? null;
  return { needs, milestoneHint };
};

const frs = [];
const frHeadRe = /^#### (FR-\d+): (.+)$/;
const headingRe = /^#{2,4} /;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(frHeadRe);
  if (!m) continue;
  const id = m[1];
  const title = m[2].trim();
  // block runs until the next heading of level 2-4
  let end = i + 1;
  while (end < lines.length && !headingRe.test(lines[end])) end++;
  const block = lines.slice(i + 1, end);
  const statusLine = block.find((l) => /^\*\*Status:\*\*/.test(l));
  if (!statusLine) fail(`FR ${id}: no **Status:** line`);
  const statusRaw = statusLine.replace(/^\*\*Status:\*\*\s*/, "").replace(/\.$/, "").trim();
  const { needs, milestoneHint } = classifyStatus(statusRaw, id);
  const consIdx = block.findIndex((l) => /^\*\*Consequences \(testable\):\*\*/.test(l));
  const descIdx = 0;
  const descEnd = consIdx === -1 ? block.length : consIdx;
  const description = block
    .slice(descIdx, descEnd)
    .filter((l) => l.trim() && !/^\*\*Status:\*\*/.test(l))
    .join(" ")
    .trim();
  const consequences = consIdx === -1
    ? []
    : block
      .slice(consIdx + 1)
      .filter((l) => /^\s*([-*]|\d+\.)\s+/.test(l))
      .map((l) => l.replace(/^\s*([-*]|\d+\.)\s+/, "").trim());
  if (consIdx === -1) fail(`FR ${id}: no **Consequences (testable):** block`);
  frs.push({ id, title, status_raw: statusRaw, needs, milestone_hint: milestoneHint, description, consequences });
  i = end - 1;
}
if (frs.length !== EXPECTED_FRS) fail(`FR count ${frs.length} != expected ${EXPECTED_FRS} — PRD shape drifted`);

// order check: FR-1..FR-47 contiguous
for (let n = 1; n <= EXPECTED_FRS; n++) {
  if (!frs.some((f) => f.id === `FR-${n}`)) fail(`missing FR-${n}`);
}

// --- PRD: NFR list ------------------------------------------------------------
const nfrs = [];
{
  const start = lines.findIndex((l) => /^## 6\. Cross-Cutting NFRs/.test(l));
  if (start === -1) fail("NFR section not found (## 6.)");
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  for (const l of lines.slice(start + 1, end)) {
    const m = l.match(/^- \*\*(NFR-\d+) — (.+?)\.?\*\*(.*)$/);
    if (m) {
      nfrs.push({ id: m[1], title: m[2].replace(/\.$/, "").trim(), text: (m[3] ?? "").trim() });
    }
  }
}
if (nfrs.length === 0) fail("NFR section parsed to zero items");

// --- UX extract: build gaps / behaviors --------------------------------------
const uxdrs = [];
{
  const ux = read(UX, "ux-extract");
  const uxLines = ux.split("\n");
  const start = uxLines.findIndex((l) => /^### 2e\. Additional specced build gaps/.test(l));
  if (start === -1) fail("UX extract: section 2e not found");
  let end = start + 1;
  while (end < uxLines.length && !/^---/.test(uxLines[end])) end++;
  for (const l of uxLines.slice(start + 1, end)) {
    if (!/^- /.test(l)) continue;
    const text = l.replace(/^- /, "").replace(/\*\*/g, "").trim();
    if (text) uxdrs.push({ id: `UX-DR-${uxdrs.length + 1}`, text });
  }
}
if (uxdrs.length === 0) fail("UX extract: section 2e parsed to zero items");

// --- Arch extract: constraints + capabilities ---------------------------------
const archConstraints = [];
const archCapabilities = [];
{
  const arch = read(ARCH, "arch extract");
  const aLines = arch.split("\n");
  const section = (headRe) => {
    const start = aLines.findIndex((l) => headRe.test(l));
    if (start === -1) return [];
    let end = start + 1;
    while (end < aLines.length && !/^## /.test(aLines[end])) end++;
    return aLines.slice(start + 1, end);
  };
  for (const l of section(/^## 2\. Constraints/)) {
    if (!/^- /.test(l)) continue;
    const text = l.replace(/^- /, "").replace(/\*\*/g, "").trim();
    if (text) archConstraints.push({ id: `ARCH-C-${archConstraints.length + 1}`, text });
  }
  for (const l of section(/^## 3\. Capabilities/)) {
    if (!/^- /.test(l)) continue;
    const text = l.replace(/^- /, "").replace(/\*\*/g, "").trim();
    if (text) archCapabilities.push({ id: `ARCH-CAP-${archCapabilities.length + 1}`, text });
  }
}
if (archConstraints.length === 0) fail("arch extract: constraints parsed to zero");
if (archCapabilities.length === 0) fail("arch extract: capabilities parsed to zero");

// --- write --------------------------------------------------------------------
const out = {
  generatedAt: new Date().toISOString(),
  sources: { prd: PRD, ux_extract: UX, arch_extract: ARCH },
  counts: {
    frs: frs.length,
    frs_needing_implementation: frs.filter((f) => f.needs.implementation).length,
    frs_needing_verification: frs.filter((f) => f.needs.verification).length,
    nfrs: nfrs.length,
    ux_drs: uxdrs.length,
    arch_constraints: archConstraints.length,
    arch_capabilities: archCapabilities.length,
  },
  frs,
  nfrs,
  ux_drs: uxdrs,
  arch_constraints: archConstraints,
  arch_capabilities: archCapabilities,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`extract -> ${OUT}`);
console.log(JSON.stringify(out.counts));
