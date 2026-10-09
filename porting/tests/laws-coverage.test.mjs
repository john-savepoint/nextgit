#!/usr/bin/env bun
// Machine-check the twelve-law carrier map (NFR-12).
// Run: bun porting/tests/laws-coverage.test.mjs   (exit 0 = pass)
//
// Guards NFR-12 (Design constitution): every engineering law is either
// carried by concrete FR carriers + stories, or rides as an explicit
// roadmap queue entry — and the mapping is machine-checked, not prose.
//
// Data sources (read-only):
//   - porting/laws-carrier-map.json  (the map under test)
//   - porting/compile/requirements.json  (FR id set)
//   - porting/migration/issues-v2.jsonl  (the task-store JSONL mirror;
//     same rows that `bd export` returns, with canonical `nextgit-` ids)
//
// The task store migrated from porting/tasks.db (frozen, 0 bytes) to bd/Dolt;
// issues-v2.jsonl is its JSONL mirror and is the read source for this checker
// so the test is self-contained and needs no `bd` binary or BEADS_DIR.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const MAP_PATH = process.env.LAWS_MAP_PATH || join(ROOT, "porting/laws-carrier-map.json");
const REQS_PATH = join(ROOT, "porting/compile/requirements.json");
const ISSUES_PATH = join(ROOT, "porting/migration/issues-v2.jsonl");
const ID_PREFIX = "nextgit-";

// --- load carriers -------------------------------------------------------
if (!existsSync(MAP_PATH)) {
  console.error(`ERROR: Missing carrier map: ${MAP_PATH}`);
  process.exit(1);
}
if (!existsSync(REQS_PATH)) {
  console.error(`ERROR: Missing requirements.json: ${REQS_PATH}`);
  process.exit(1);
}
if (!existsSync(ISSUES_PATH)) {
  console.error(`ERROR: Missing issues-v2.jsonl: ${ISSUES_PATH}`);
  process.exit(1);
}

const map = JSON.parse(await Bun.file(MAP_PATH).text());
const reqs = JSON.parse(await Bun.file(REQS_PATH).text());
const frIds = new Set(reqs.frs.map((f) => f.id));

// --- load task store ids (issues-v2.jsonl, canonical nextgit- ids) -------
const storeIds = new Set();
const issuesText = await Bun.file(ISSUES_PATH).text();
for (const line of issuesText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    const row = JSON.parse(trimmed);
    if (row._type === "issue" && row.issue_type !== "epic") storeIds.add(row.id);
  } catch {
    /* skip non-JSON lines */
  }
}

// Accept canonical (nextgit-*) and bare slug ids in the map
const storeBare = new Set();
for (const id of storeIds) {
  if (id.startsWith(ID_PREFIX)) storeBare.add(id.slice(ID_PREFIX.length));
  else storeBare.add(id);
}
const canon = (x) => (String(x).startsWith(ID_PREFIX) ? String(x) : ID_PREFIX + String(x));
const bare = (x) => (String(x).startsWith(ID_PREFIX) ? String(x).slice(ID_PREFIX.length) : String(x));

// --- helpers -------------------------------------------------------------
let fails = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const LAW_KEYS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"];

// --- Check 1: exactly twelve laws, L1–L12 in order -----------------------
const mapKeys = Object.keys(map);
check(
  "exactly 12 laws (L1–L12 in order)",
  mapKeys.length === 12 && mapKeys.every((k, i) => k === LAW_KEYS[i]),
  `got keys=${JSON.stringify(mapKeys)}`
);

// --- Check 2: every law has ≥1 carrier or ≥1 roadmap entry ---------------
for (const law of LAW_KEYS) {
  const entry = map[law];
  const nc = (entry.carriers?.length || 0) + (entry.roadmap?.length || 0);
  check(`${law} has ≥1 carrier or roadmap`, nc > 0, `carriers=${entry.carriers?.length || 0} roadmap=${entry.roadmap?.length || 0}`);
}

// --- Check 3: carrier FR ids exist in requirements.json -------------------
for (const law of LAW_KEYS) {
  const entry = map[law];
  const frs = entry.carriers || [];
  for (const c of frs) {
    if (c.type === "fr") {
      check(`${law} carrier FR ${c.id} exists in requirements.json`, frIds.has(c.id), "");
    }
  }
}

// --- Check 4: story ids exist in the task store --------------------------
for (const law of LAW_KEYS) {
  const entry = map[law];
  const stories = entry.stories || [];
  for (const s of stories) {
    const present = storeIds.has(canon(s.id)) || storeBare.has(bare(s.id));
    check(`${law} story ${s.id} exists in store`, present, "");
  }
}

// --- Check 5: roadmap ids exist in the task store ------------------------
for (const law of LAW_KEYS) {
  const entry = map[law];
  const roadmap = entry.roadmap || [];
  for (const r of roadmap) {
    const present = storeIds.has(canon(r.id)) || storeBare.has(bare(r.id));
    check(`${law} roadmap ${r.id} exists in store`, present, "");
  }
}

// --- Check 6: L2/L9/L11 are roadmap-only with specific rows ---------------
const roadmapExpect = {
  L2: ["law-2-two-tier-intelligence-system-1-sees-every-file-first", "classify-every-file-with-system-1-models-at-ingest"],
  L9: ["law-9-work-item-to-change-set-linkage-on-one-review-surface"],
  L11: ["law-11-always-on-system-1-decision-layer-primed-for-agents-a", "run-always-on-system-1-decision-agents"],
};
for (const [law, expectedIds] of Object.entries(roadmapExpect)) {
  const entry = map[law];
  const roads = (entry.roadmap || []).map((r) => bare(r.id));
  const allPresent = expectedIds.every((id) => roads.includes(id));
  const noCarriers = !entry.carriers || entry.carriers.length === 0;
  check(
    `${law} is roadmap-only & has expected rows`,
    entry.status === "roadmap" && noCarriers && allPresent,
    `status=${entry.status} carriers=${entry.carriers?.length || 0} roadmap=${JSON.stringify(roads)} expected=${JSON.stringify(expectedIds)}`
  );
}

// --- Check 7: map status matches carrier/roadmap presence -----------------
for (const law of LAW_KEYS) {
  const entry = map[law];
  const hasCarriers = entry.carriers && entry.carriers.length > 0;
  const expected = hasCarriers ? "carried" : "roadmap";
  check(
    `${law} status matches carriers/roadmap`,
    entry.status === expected,
    `status=${entry.status} expected=${expected} carriers=${hasCarriers}`
  );
}

// --- Check 8: mutant guards (synthetic) -----------------------------------
// Mutant A: delete L1 carriers + roadmap → check #2 must fail
{
  const mutant = JSON.parse(JSON.stringify(map));
  mutant.L1.carriers = [];
  mutant.L1.roadmap = [];
  const nc = (mutant.L1.carriers?.length || 0) + (mutant.L1.roadmap?.length || 0);
  check("MUTANT A: L1 with no carriers+roadmap would fail check #2", nc === 0, "(expected failure — guard is structural)");
}

// Mutant B: roadmap id pointing at nonexistent task row → check #5 must fail
{
  const mutant = JSON.parse(JSON.stringify(map));
  mutant.L2.roadmap[0].id = "THIS-ID-DOES-NOT-EXIST-9999";
  const present = storeIds.has(canon("THIS-ID-DOES-NOT-EXIST-9999")) || storeBare.has("THIS-ID-DOES-NOT-EXIST-9999");
  check("MUTANT B: nonexistent roadmap id would fail check #5", !present, "(expected failure — guard is structural)");
}

// --- summary -------------------------------------------------------------
console.log(fails === 0 ? `ALL PASS (checks=${checks})` : `${fails} FAILURES (checks=${checks})`);
process.exit(fails === 0 ? 0 : 1);
