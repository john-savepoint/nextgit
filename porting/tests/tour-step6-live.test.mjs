#!/usr/bin/env node
// tour-step6-live.test.mjs — the step-6 "Live Proposals" contract, proven
// against the REAL live worker (same surface demo-verify.mjs and
// live-render.probe.mjs already exercise). Read-only: GET /proposals only,
// no KV writes, no /land, no fixture mutation. Chrome spawns with a
// throwaway --user-data-dir.
//
// What it pins (the tour's step-6 teaching contract):
//   1. GET /proposals?base=demo → 200, ok:true, base.repo "demo", ≥4 proposals.
//   2. The deliberate src/auth.ts pair is present (agent-1 × agent-2).
//   3. Annotation-text derivation (the fidelity seam): re-implement the exact
//      derivation from tour.js renderRealProposalsCards as a pure function over
//      the fetched payload and assert agent-1/agent-2 → "src/auth.ts",
//      agent-3 → "clean", agent-4 → its REAL conflict file (or "clean" when
//      agent-4 carries no conflict — the canonical 2-conflict/2-clean grid).
//   4. Offline-snapshot fidelity: the shipped fallbackProposals array still
//      yields agent-3 → "landed" and agent-1/agent-2 → "src/auth.ts" through
//      the same derivation (the landed branch stays reachable; the
//      no-conflict-data fallback to "src/auth.ts" is preserved).
//   5. Headless render gate: dump-dom the live /tour.html and assert the
//      rendered DOM carries the status line, exactly 4 cards, ≥2 ann-conflict,
//      ≥1 ann-clean, and the agent-1/agent-2 cards carry "Collides on src/auth.ts".
//
// Run:  node porting/tests/tour-step6-live.test.mjs
// Exit: 0 all green · 1 broken · 2 no Chrome (render gate skipped, degradable)

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PLATFORM = process.env.PLATFORM || "https://nextgit-platform.john-b7d.workers.dev";
const TOUR_SRC = join(ROOT, "platform/ui/tour.js");

let fails = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

async function fetchProposals() {
  const res = await fetch(`${PLATFORM}/proposals?base=demo`, {
    headers: { "User-Agent": "tour-step6-live-test/1" },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// The exact derivation seam from tour.js renderRealProposalsCards():
//   hasConflict := p.repo==="agent-1" || p.repo==="agent-2" ||
//                  realConflicts.some(c => c.repos?.includes(p.repo))
//   (landed branch checked first)
//   collisionFiles := realConflicts.filter(c => c.repos?.includes(p.repo))
//                     .map(c => c.file) deduped
//   label := collisionFiles.length ? collisionFiles.join(", ") : "src/auth.ts"
// Returns "landed" | "clean" | the collision label string.
function deriveAnnotation(proposal, realConflicts) {
  const isLanded = proposal.landing?.status === "landed";
  const hasConflict =
    proposal.repo === "agent-1" ||
    proposal.repo === "agent-2" ||
    (Array.isArray(realConflicts) && realConflicts.some((c) => c.repos?.includes(proposal.repo)));
  if (isLanded) return "landed";
  if (!hasConflict) return "clean";
  const collisionFiles = (realConflicts || [])
    .filter((c) => c.repos?.includes(proposal.repo))
    .map((c) => c.file)
    .filter((v, i, a) => a.indexOf(v) === i);
  return collisionFiles.length > 0 ? collisionFiles.join(", ") : "src/auth.ts";
}

// ---- checks 1-4: the API + derivation contract ------------------------
const { status, body } = await fetchProposals();
check("GET /proposals?base=demo → 200", status === 200, `status ${status}`);
check("proposals body ok:true", body?.ok === true, JSON.stringify(body?.error ?? null));
check("base repo is demo", body?.base?.repo === "demo", JSON.stringify(body?.base ?? null));
const proposals = Array.isArray(body?.proposals) ? body.proposals : [];
check("≥4 proposals", proposals.length >= 4, `got ${proposals.length}`);

const conflicts = Array.isArray(body?.conflicts) ? body.conflicts : [];
const authPair = conflicts.find((c) => c.file === "src/auth.ts");
check(
  "deliberate src/auth.ts pair present (agent-1 × agent-2)",
  Boolean(authPair) && authPair.repos?.includes("agent-1") && authPair.repos?.includes("agent-2"),
  JSON.stringify(authPair ?? null),
);

// Check 3: annotation derivation on the REAL payload.
const find = (repo) => proposals.find((p) => p.repo === repo);
const a1 = find("agent-1");
const a2 = find("agent-2");
const a3 = find("agent-3");
const a4 = find("agent-4");
check("agent-1 annotation → src/auth.ts", a1 && deriveAnnotation(a1, conflicts) === "src/auth.ts", a1 ? deriveAnnotation(a1, conflicts) : "missing");
check("agent-2 annotation → src/auth.ts", a2 && deriveAnnotation(a2, conflicts) === "src/auth.ts", a2 ? deriveAnnotation(a2, conflicts) : "missing");
check("agent-3 annotation → clean", a3 && deriveAnnotation(a3, conflicts) === "clean", a3 ? deriveAnnotation(a3, conflicts) : "missing");
// agent-4: the canonical grid is 2-conflict/2-clean, so agent-4 is clean.
// If the live demo ever carries an agent-4 conflict, the derived label must
// be that conflict's REAL file — never a hardcoded "src/auth.ts" that names a
// file agent-4 does not touch.
if (a4) {
  const label = deriveAnnotation(a4, conflicts);
  const a4Conflicted = (conflicts || []).some((c) => c.repos?.includes("agent-4"));
  if (a4Conflicted) {
    const realFiles = (conflicts || []).filter((c) => c.repos?.includes("agent-4")).map((c) => c.file);
    check(
      "agent-4 annotation names its real conflict file (not hardcoded src/auth.ts)",
      realFiles.every((f) => label.includes(f)) && !(realFiles.every((f) => f !== "src/auth.ts") && label === "src/auth.ts"),
      `label=${label} realFiles=${JSON.stringify(realFiles)}`,
    );
  } else {
    check("agent-4 annotation → clean (canonical 2-conflict/2-clean grid)", label === "clean", label);
  }
} else {
  check("agent-4 present", false, "missing from /proposals");
}

// Check 4: offline-snapshot fidelity via the shipped fallbackProposals.
// Parse the literal fallbackProposals array out of tour.js (source-of-truth
// assertion — the suite lives beside the source; not a mock).
const tourSrc = readFileSync(TOUR_SRC, "utf8");
const fbStart = tourSrc.indexOf("const fallbackProposals = [");
const fbEnd = tourSrc.indexOf("\n];", fbStart);
// The array literal itself (between "=" and the closing "];").
const fbLiteral = tourSrc.slice(fbStart + "const fallbackProposals = ".length, fbEnd + 2); // +2 to include the closing "]"
let fallbackProposals;
let syntheticConflicts = [{ file: "src/auth.ts", repos: ["agent-1", "agent-2"] }];
try {
  // Evaluate the array literal in isolation (it is a pure data literal).
  fallbackProposals = new Function(`"use strict"; return (${fbLiteral});`)();
} catch (err) {
  check("fallbackProposals parses", false, err.message);
}
if (Array.isArray(fallbackProposals)) {
  const fbA1 = fallbackProposals.find((p) => p.repo === "agent-1");
  const fbA2 = fallbackProposals.find((p) => p.repo === "agent-2");
  const fbA3 = fallbackProposals.find((p) => p.repo === "agent-3");
  check("offline snapshot agent-1 → src/auth.ts", fbA1 && deriveAnnotation(fbA1, syntheticConflicts) === "src/auth.ts", fbA1 ? deriveAnnotation(fbA1, syntheticConflicts) : "missing");
  check("offline snapshot agent-2 → src/auth.ts", fbA2 && deriveAnnotation(fbA2, syntheticConflicts) === "src/auth.ts", fbA2 ? deriveAnnotation(fbA2, syntheticConflicts) : "missing");
  check("offline snapshot agent-3 → landed (Already shipped to main)", fbA3 && deriveAnnotation(fbA3, syntheticConflicts) === "landed", fbA3 ? deriveAnnotation(fbA3, syntheticConflicts) : "missing");
  // No-conflict-data fallback: an empty realConflicts still yields src/auth.ts
  // for agent-1/agent-2 (the hardcoded agents are always "in conflict").
  check(
    "offline snapshot agent-1 falls back to src/auth.ts with empty conflict data",
    fbA1 && deriveAnnotation(fbA1, []) === "src/auth.ts",
    fbA1 ? deriveAnnotation(fbA1, []) : "missing",
  );
}

// ---- check 5: headless render gate ------------------------------------
function findChrome() {
  for (const bin of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (!bin) continue;
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0) return bin;
  }
  return null;
}
const CHROME = findChrome();
if (!CHROME) {
  console.log("SKIP — no Chrome binary on PATH (headless render gate unverified)");
  process.exit(2);
}

const url = `${PLATFORM}/tour.html`;
const userDataDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
const child = spawn(
  CHROME,
  ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=15000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
  { stdio: ["ignore", "pipe", "ignore"] },
);
let dom = "";
child.stdout.on("data", (d) => (dom += d));
const kill = setTimeout(() => child.kill("SIGKILL"), 90000);
child.on("close", () => {
  clearTimeout(kill);
  execFileSync("rm", ["-rf", userDataDir]);

  const statusEl = dom.match(/id="live-proposals-status"[^>]*>([\s\S]*?)<\/div>/);
  const statusText = statusEl ? statusEl[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  check(
    "status line: live connection established + Loaded + proposals",
    statusText.includes("Live connection established") && statusText.includes("Loaded") && statusText.includes("proposals"),
    statusText || "status element not found",
  );

  const cardRe = /<div class="live-tour-card([^"]*)">([\s\S]*?)<\/div>\s*<\/div>/g;
  const cards = [];
  let m;
  while ((m = cardRe.exec(dom)) !== null) cards.push({ cls: m[1].trim(), body: m[2] });
  check("exactly 4 live-tour-card elements", cards.length === 4, `got ${cards.length}`);

  const annConflict = (dom.match(/ann-conflict/g) || []).length;
  const annClean = (dom.match(/ann-clean/g) || []).length;
  check("≥2 ann-conflict annotations", annConflict >= 2, `got ${annConflict}`);
  check("≥1 ann-clean annotation", annClean >= 1, `got ${annClean}`);

  const cardText = (body) => body.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const authCards = cards.filter((c) => c.cls.includes("is-conflict") && cardText(c.body).includes("Collides on src/auth.ts"));
  check("agent-1/agent-2 cards carry 'Collides on src/auth.ts'", authCards.length >= 2, `got ${authCards.length}`);

  for (const repo of ["agent-1", "agent-2", "agent-3", "agent-4"]) {
    check(`card present: ${repo}`, cards.some((c) => cardText(c.body).includes(repo)), "not rendered");
  }

  console.log(`\n${fails === 0 ? "TOUR STEP-6 LIVE: PASS" : "TOUR STEP-6 LIVE: FAIL"} — ${checks - fails}/${checks} checks`);
  process.exit(fails === 0 ? 0 : 1);
});
