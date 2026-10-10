#!/usr/bin/env bun
// Contract suite: step-7 quiz grades must agree with the live /proposals
// state — the drift guard. The quiz is derived (gradeProposal) from the
// SAME state.realProposals / state.realConflicts that renders the step-6
// cards, so the two steps share one source of truth and can never disagree.
// Run: bun porting/tests/tour-step7-quiz.test.mjs   (exit 0 = pass)
//
// Real construction, two surfaces:
//   * tour.js is loaded as a real ES module in real headless Chrome over a
//     loopback origin. The only scripted pieces are the HTTP surface (the
//     /proposals payload the shipped fetch path receives — the live URL is
//     redirected to the loopback origin, never the product code) and an
//     observer module injected BEFORE tour.js that drives the REAL quiz
//     buttons and reads the REAL rendered feedback. No module mocks, no
//     source grep of the assertion.
//   * The real gradeProposal construction is exercised through
//     handleQuizChoice: clicking [data-quiz] buttons and reading the
//     #quiz-feedback class + headline the product renders.
//
// Fixture (mirrors the canonical demo state the tour teaches —
// one of each graded state over the first-four slice):
//   agent-1/agent-2 — ready, src/auth.ts, text-conflict pair
//   agent-3         — landed, src/store.ts, no collision  → grades LANDED
//   agent-4         — ready, src/feature.ts, no collision → grades SAFE
// (the live platform is all-pending per demo-verify.mjs; the offline
//  snapshot the quiz grades against is the tour's teaching narrative,
//  where agent-3's clean proposal has already shipped. The derivation
//  reads whatever state is live, so both surfaces stay consistent.)
//
// Contracts:
//   1. four quiz options over the proposal set (agent-1..agent-4)
//   2. feedback hidden before answering
//   3. grade↔state consistency for every option:
//        a repo whose landing.status === "landed" is the ONLY repo
//        that may carry feedback-landed;
//        a repo that appears in no conflicts[] entry AND is not
//        withheld-secret may carry feedback-safe;
//        the converse: a repo that is withheld-secret or conflict-listed
//        must NOT be graded safe, and must NOT be graded landed while its
//        live status is pending;
//   4. exact headlines for the canonical fixture: agent-3 landed
//      ("Already Shipped: agent-3 has landed"), agent-4 safe ("Optimal
//      choice: agent-4 is clean and safe to ship");
//   5. single .is-selected after each choice;
//   6. step-6 card annotation derived from the payload's
//      conflicts[] (not hardcoded): agent-1/agent-2 name
//      src/auth.ts; agent-3 is landed; agent-4 is clean.
// A box without a Chrome binary skips the suite (precedent:
// ui-first-load-chips.test.mjs).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const TOUR_TAG = `<script type="module" src="tour.js"></script>`;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  tour-step7-quiz — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(77); // POSIX skip: Chrome absent, not a failure
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-tour-quiz-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 15000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 15s"));
    }, 15000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

const parse = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// ---------------------------------------------------------------------------
// Fixture — the canonical teaching state the tour grades against:
// agent-1/agent-2 text-conflict on src/auth.ts; agent-3 landed on
// src/store.ts (already shipped); agent-4 ready on src/feature.ts
// (clean). agent-5 is NOT in the tour's first-four slice.
// ---------------------------------------------------------------------------
const PROPOSALS = {
  ok: true,
  proposals: [
    {
      repo: "agent-1",
      intent: "Feature: refreshSession() extends a live session by TTL",
      files: [{ path: "src/auth.ts", additions: 5, deletions: 0 }],
      landing: { status: "ready" },
    },
    {
      repo: "agent-2",
      intent: "Fix: tolerate clock skew in isExpired via leewayMs",
      files: [{ path: "src/auth.ts", additions: 2, deletions: 2 }],
      landing: { status: "ready" },
    },
    {
      repo: "agent-3",
      intent: "Perf: read-through memo cache for store reads",
      files: [{ path: "src/store.ts", additions: 16, deletions: 0 }],
      landing: { status: "landed" },
    },
    {
      repo: "agent-4",
      intent: "Feature: feature-flag module with isEnabled()",
      files: [{ path: "src/feature.ts", additions: 29, deletions: 0 }],
      landing: { status: "ready" },
    },
    {
      repo: "agent-5",
      intent: "",
      files: [{ path: "config/.env", additions: 3, deletions: 0 }],
      landing: { status: "withheld-secret" },
    },
  ],
  conflicts: [
    { file: "src/auth.ts", repos: ["agent-1", "agent-2"] },
  ],
};

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE tour.js. Intercepts the shipped
// fetch (hardcoded absolute live URL) so the loopback fixture is what
// the product's own loadRealProposals() consumes, waits for the render
// to settle, then drives the REAL step-7 quiz — clicking each
// [data-quiz] option in turn and recording the graded feedback the
// product renders (class + headline) — and reads the step-6 live-card
// annotations. Emits #test-out with structured observations.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Intercept the shipped tour.js fetch (hardcoded absolute live URL) and
// serve the loopback fixture — the product code runs verbatim; only the
// HTTP surface is scripted. Installed synchronously in this module,
// which executes BEFORE tour.js, so loadRealProposals() sees it.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url && url.includes("/proposals")) return realFetch("/proposals", init);
  return realFetch(input, init);
};
const R = { options: 0, feedbackHiddenBefore: null, grades: {}, selectedCounts: {}, annotations: [], err: null };
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // wait for loadRealProposals() to settle (fetch -> renderRealProposalsCards)
    await sleep(2500);
    R.options = qs(".quiz-option-btn").length;
    const fb = document.getElementById("quiz-feedback");
    R.feedbackHiddenBefore = fb ? fb.hidden : null;
    // step-6 card annotations (the realConflicts derivation surface)
    R.annotations = qs(".live-tour-card").map((c) => {
      const ann = c.querySelector(".live-card-annotation");
      return { cls: c.className, annotation: ann ? ann.textContent.trim() : null };
    });
    // drive the real quiz, one option at a time
    const btns = qs(".quiz-option-btn");
    for (const btn of btns) {
      const repo = btn.getAttribute("data-quiz");
      btn.click();
      await sleep(120);
      const f = document.getElementById("quiz-feedback");
      R.grades[repo] = {
        cls: f ? f.className : null,
        headline: f ? f.querySelector(".feedback-headline")?.textContent?.trim() : null,
      };
      R.selectedCounts[repo] = qs(".quiz-option-btn.is-selected").length;
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface — serves the fixture as /proposals and injects
// the observer before the shipped tour.js module. The product code is
// served verbatim; only the HTTP surface is scripted.
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }
  const rel = pathname === "/" ? "tour.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "tour.html") {
    res.writeHead(200, { "content-type": "text/html" });
    // inject the observer BEFORE the product module
    res.end(readFileSync(file, "utf8").replace(TOUR_TAG, `<script type="module" src="/__client.js"></script>` + TOUR_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs — grade↔state consistency over the fixture payload
// ---------------------------------------------------------------------------

function legQuizShape(R) {
  check("1: four quiz options over the proposal set", R.options === 4, `options=${R.options}`);
  check("2: feedback hidden before answering", R.feedbackHiddenBefore === true, `hidden=${R.feedbackHiddenBefore}`);
}

function legGradeStateConsistency(R) {
  // derive ground truth from the fixture itself (no hardcoding of the
  // verdicts — the contract is the derivation, so a demo reset that
  // changes the payload changes what the quiz MUST say)
  const byRepo = new Map(PROPOSALS.proposals.map((p) => [p.repo, p]));
  const conflictRepos = new Set(PROPOSALS.conflicts.flatMap((c) => c.repos));

  for (const [repo, grade] of Object.entries(R.grades)) {
    const p = byRepo.get(repo);
    const isLanded = p?.landing?.status === "landed";
    const isWithheld = p?.landing?.status === "withheld-secret";
    const isConflictListed = conflictRepos.has(repo);
    const cls = grade.cls || "";

    check(`3 ${repo}: feedback class is one of the graded states`,
      ["feedback-conflict", "feedback-landed", "feedback-safe"].some((k) => cls.includes(k)), `cls=${cls}`);

    // landed grade is only legal for a repo that actually landed
    check(`3 ${repo}: feedback-landed only if live landing.status === "landed"`,
      !cls.includes("feedback-landed") || isLanded, `cls=${cls} live=${p?.landing?.status}`);

    // safe grade is only legal for a repo in NO conflict entry and not withheld
    check(`3 ${repo}: feedback-safe only if clean (no conflict entry, not withheld-secret)`,
      !cls.includes("feedback-safe") || (!isConflictListed && !isWithheld && !isLanded),
      `cls=${cls} conflictListed=${isConflictListed} withheld=${isWithheld}`);

    // converse: withheld-secret or conflict-listed repos must NOT be safe
    check(`3 ${repo}: withheld-secret or conflict-listed repo is NOT graded safe`,
      !(isWithheld || isConflictListed) || !cls.includes("feedback-safe"),
      `cls=${cls} withheld=${isWithheld} conflictListed=${isConflictListed}`);

    // a pending (ready) repo must NOT be graded landed
    check(`3 ${repo}: pending repo is NOT graded landed`,
      p?.landing?.status !== "ready" || !cls.includes("feedback-landed"),
      `cls=${cls} live=${p?.landing?.status}`);
  }
}

function legCanonicalHeadlines(R) {
  // the canonical fixture's expected verdicts: agent-3 has landed;
  // agent-4 is the clean proposal; agent-1/agent-2 are the only collision pair
  const g3 = R.grades["agent-3"];
  const g4 = R.grades["agent-4"];
  check("4 agent-3 graded landed", (g3?.cls || "").includes("feedback-landed"), `cls=${g3?.cls}`);
  check("4 agent-3 headline is the already-shipped headline",
    (g3?.headline || "") === "Already Shipped: agent-3 has landed", `headline=${g3?.headline}`);
  check("4 agent-4 graded safe", (g4?.cls || "").includes("feedback-safe"), `cls=${g4?.cls}`);
  check("4 agent-4 headline is the optimal-choice headline",
    (g4?.headline || "").startsWith("Optimal choice: agent-4"), `headline=${g4?.headline}`);
}

function legSingleSelection(R) {
  for (const [repo, n] of Object.entries(R.selectedCounts)) {
    check(`5 ${repo}: exactly one option selected after choice`, n === 1, `count=${n}`);
  }
}

function legStep6Annotation(R) {
  // the annotation must be derived from the payload (not hardcoded):
  // agent-1/agent-2's cards name the conflicting src/auth.ts,
  // agent-3's card is landed (is-landed), and agent-4's card is
  // clean (is-clean) — agent-3 and agent-4 appear in no conflicts[]
  // entry, and agent-3 has landing.status === "landed".
  const agent12 = R.annotations.filter((a) => (a.annotation || "").includes("src/auth.ts"));
  const cleans = R.annotations.filter((a) => (a.cls || "").includes("is-clean"));
  const landed = R.annotations.filter((a) => (a.cls || "").includes("is-landed"));

  check("6 agent-1 and agent-2 cards name src/auth.ts", agent12.length === 2,
    `count=${agent12.length} annotations=${JSON.stringify(R.annotations)}`);
  check("6 agent-4 card is clean (no conflict annotation)", cleans.length === 1,
    `count=${cleans.length} annotations=${JSON.stringify(R.annotations)}`);
  check("6 agent-3 card is landed (already shipped)", landed.length === 1,
    `count=${landed.length} annotations=${JSON.stringify(R.annotations)}`);
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  const dom = await dumpDom(url);
  const R = parse(dom);
  if (!R) {
    check("scenario output present", false, "no #test-out");
  } else if (R.err) {
    check("scenario ran without throwing", false, R.err);
  } else {
    legQuizShape(R);
    legGradeStateConsistency(R);
    legCanonicalHeadlines(R);
    legSingleSelection(R);
    legStep6Annotation(R);
  }
} catch (e) {
  check("harness setup failed", false, String(e?.message ?? e));
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 1000);
    server.close(() => { clearTimeout(t); resolve(); });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
