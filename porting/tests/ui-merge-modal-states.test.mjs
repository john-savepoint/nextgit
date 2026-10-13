#!/usr/bin/env bun
// Contract suite: FR-13 — merge preview modal renders all five states through
// the real browser harness: (1) merged text, (2) conflict with diff3 markers,
// (3) withheld-secret notice, (4) no files changed in merge, (5) error state.
// Run: bun porting/tests/ui-merge-modal-states.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js)
// is loaded in real headless Chrome over a loopback origin. The only scripted
// pieces are the HTTP surface (which fixture /merge serves per scenario) and
// an observer module injected BEFORE app.js that clicks the real preview-merge
// control and reads the real rendered modal DOM — no product mocks, no source
// grep. Each scenario resets the loopback worker's /merge response.
// A box without a Chrome binary skips the suite (precedent: ui-contrast-register).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;
if (!CHROME) { console.log("SKIP  merge modal states — no Chrome binary on PATH"); process.exit(0); }

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-mergeview-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 8000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
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
// Fixture data
// ---------------------------------------------------------------------------

// A clean merged file: agent-1 folds cleanly over base.
const CLEAN_MERGED = "export const store = 42;\nexport const keep = true;\n";

// conflictText with diff3 markers and both sides present.
const CONFLICT_TEXT = "<<<<<<< ours\n...ours text...\n=======\n...theirs text...\n>>>>>>> theirs";

// The value POST /reveal returns on a grant — rendered only from that body.
const FIXTURE_REVEAL_VALUE = "postgres://agent-5:FAKE-REVEAL-DO-NOT-USE@db.internal:5432/app";

// /merge fixture for the clean leg
const CLEAN_MERGE = {
  ok: true, merge: {
    base: "demo", repos: ["agent-1"], status: "clean",
    files: [{ path: "src/store.ts", action: "write", result: "merged", merged: CLEAN_MERGED }],
    conflicted: [],
  },
};

// /merge fixture for the conflict leg
const CONFLICT_MERGE = {
  ok: true, merge: {
    base: "demo", repos: ["agent-1", "agent-2"], status: "conflict",
    files: [{
      path: "src/auth.ts", action: "write", result: "conflict",
      conflictText: CONFLICT_TEXT,
      note: "conflicts with agent-2",
    }],
    conflicted: ["src/auth.ts"],
  },
};

// /merge fixture for the withheld-secret leg
const WITHHELD_MERGE = {
  ok: true, merge: {
    base: "demo", repos: ["agent-5"], status: "clean",
    files: [{
      path: "config/.env2", action: "write", result: "withheld-secret",
      note: "Secret-class file contents are withheld from merge previews.",
    }],
    conflicted: [],
  },
};

// /merge fixture for the empty leg (repos=demo → fold of base onto itself)
const EMPTY_MERGE = {
  ok: true, merge: {
    base: "demo", repos: ["demo"], status: "clean",
    files: [], conflicted: [],
  },
};

// The proposals fixture: one proposal card for agent-1 with a preview-merge button.
const PROPOSALS = {
  ok: true, base: { repo: "fixture", ref: "main", head: "d0".repeat(20) }, ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1", head: "a0".repeat(20), landing: { status: "ready" }, stats: { files: 2, additions: 1, deletions: 0 },
      files: [
        { path: "src/store.ts", status: "modified", additions: 1, deletions: 0 },
        // The masked surface the merge modal sources keys from (F2): path
        // matches WITHHELD_MERGE's row so the withheld lookup resolves.
        { path: "config/.env2", status: "modified", secret: true, keys: ["DATABASE_URL"], additions: 0, deletions: 0 },
      ],
    },
  ],
  conflicts: [],
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. The loopback worker serves the right
// /merge fixture based on the scenario. We click the real .btn-preview-merge
// control for agent-1, wait for the modal, then read the real rendered DOM
// inside #inspector-modal and emit #test-out.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const texts = (els) => els.map((e) => e.textContent.trim());
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for app.js to load proposals and render the grid
    await sleep(900);

    // Click the real preview-merge control for agent-1
    const btn = qs(".btn-preview-merge").find((b) => b.getAttribute("data-repo") === "agent-1");
    if (!btn) { R.err = "no preview-merge button for repo: agent-1"; } else {
      btn.click();
      await sleep(900);
    }

    const m = q("#inspector-modal");
    const b = q("#modal-badge");
    const body = q("#modal-body");

    if (m && m.hidden === false) {
      R.s.modalOpen = true;
      R.s.badgeText = b ? b.textContent.trim() : null;
      R.s.badgeClass = b ? b.className : null;
      R.s.title = q("#modal-title") ? q("#modal-title").textContent.trim() : null;
      R.s.mergePane = qs("#inspector-modal .merge-pane").length;
      R.s.mergePaneHasConflict = qs("#inspector-modal .merge-pane.has-conflict").length;
      R.s.mergePaneText = texts(qs("#inspector-modal .merge-pane"));
      R.s.emptyState = qs("#inspector-modal .empty-state").length;
      R.s.emptyStateTitle = texts(qs("#inspector-modal .empty-state-title"));
      R.s.emptyStateDesc = texts(qs("#inspector-modal .empty-state-desc"));
      R.s.bodyInnerHTML = body ? body.innerHTML : null;
      // Reveal affordance (merge-modal secret row): the F2 control and the
      // value slot render inside the modal body.
      R.s.hasBtnReveal = !!q("#inspector-modal .btn-reveal");
      const rv0 = q("#inspector-modal #reveal-value");
      R.s.revealValueHiddenBefore = rv0 ? rv0.hidden : null;
      R.s.beforeValueInDom = !((document.documentElement.outerHTML || "").includes("${FIXTURE_REVEAL_VALUE}"));
      if (window.__CLICK_REVEAL__ && q("#inspector-modal .btn-reveal")) {
        q("#inspector-modal .btn-reveal").click();
        await sleep(700);
        const rv = q("#inspector-modal #reveal-value");
        R.s.afterClickValueHidden = rv ? rv.hidden : null;
        R.s.afterClickValueText = rv ? rv.textContent.trim() : null;
        R.s.afterClickInnerHTML = rv ? rv.innerHTML : null;
        R.s.revealValueDecision = rv ? rv.getAttribute("data-reveal-decision") : null;
        R.s.bodyInnerHTMLAfter = body ? body.innerHTML : null;
      }
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker: mergeMode selects what /merge returns.
// ---------------------------------------------------------------------------
let mergeMode = "clean";
// Scenario selectors for the withheld-reveal legs: whoamiMode drives GET
// /whoami, revealMode drives POST /reveal, clickReveal arms the observer click.
let whoamiMode = "default";   // "default" => reveal:false; "authorized" => reveal:true
let revealMode = "grant";     // "grant" => 200 value; "deny" => 403
let clickReveal = false;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/whoami") return json(res, whoamiMode === "authorized" ? { ok: true, authorized: true, reveal: true } : { ok: true, authorized: false, reveal: false });
  if (pathname === "/reveal") {
    if (revealMode === "grant") return json(res, { ok: true, repo: "agent-1", ref: "main", path: "config/.env2", key: "DATABASE_URL", value: FIXTURE_REVEAL_VALUE });
    return json(res, { ok: false, error: "reveal-not-authorized" }, 403);
  }
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/merge") {
    const u = new URL(req.url, "http://127.0.0.1");
    if (mergeMode === "error") { json(res, { ok: false, error: "merge-backend exploded" }, 500); return; }
    const fixtures = {
      clean: CLEAN_MERGE,
      conflict: CONFLICT_MERGE,
      withheld: WITHHELD_MERGE,
      empty: EMPTY_MERGE,
    };
    json(res, fixtures[mergeMode] || CLEAN_MERGE);
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(`window.__CLICK_REVEAL__ = ${clickReveal === true};\n` + clientScript);
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs
// ---------------------------------------------------------------------------
function legClean(dom) {
  const R = parse(dom);
  if (!R) return check("1 clean: scenario output present", false, "no #test-out");
  if (R.err) return check("1 clean: scenario threw", false, R.err);
  const c = R.s;
  check("1 clean: modal opened", c.modalOpen === true);
  check("1 clean: title 'Merge preview: agent-1'", c.title === "Merge preview: agent-1", `title=${c.title}`);
  check("1 clean: badge text 'clean'", c.badgeText === "clean", `badge=${c.badgeText}`);
  check("1 clean: badge class badge-clean", String(c.badgeClass || "").includes("badge-clean"), `cls=${c.badgeClass}`);
  check("1 clean: exactly one .merge-pane", c.mergePane === 1, `count=${c.mergePane}`);
  check("1 clean: merged content 'export const store = 42;'", c.mergePaneText.some((t) => t.includes("export const store = 42;")), `text=${JSON.stringify(c.mergePaneText)}`);
  check("1 clean: no .merge-pane.has-conflict", c.mergePaneHasConflict === 0);
  check("1 clean: no .empty-state-title", c.emptyStateTitle.length === 0);
}

function legConflict(dom) {
  const R = parse(dom);
  if (!R) return check("2 conflict: scenario output present", false, "no #test-out");
  if (R.err) return check("2 conflict: scenario threw", false, R.err);
  const c = R.s;
  check("2 conflict: modal opened", c.modalOpen === true);
  check("2 conflict: badge text 'conflict'", c.badgeText === "conflict", `badge=${c.badgeText}`);
  check("2 conflict: badge class badge-red", String(c.badgeClass || "").includes("badge-red"), `cls=${c.badgeClass}`);
  check("2 conflict: one .merge-pane.has-conflict", c.mergePaneHasConflict === 1, `count=${c.mergePaneHasConflict}`);
  const mergedText = c.mergePaneText.join("");
  check("2 conflict: diff3 markers present (<<<<<<<)", mergedText.includes("<<<<<<< ours"), `text=${mergedText}`);
  check("2 conflict: diff3 markers present (=======)", mergedText.includes("======="), `text=${mergedText}`);
  check("2 conflict: diff3 markers present (>>>>>>>)", mergedText.includes(">>>>>>> theirs"), `text=${mergedText}`);
  check("2 conflict: ours text present", mergedText.includes("...ours text..."), `text=${mergedText}`);
  check("2 conflict: theirs text present", mergedText.includes("...theirs text..."), `text=${mergedText}`);
  check("2 conflict: no .empty-state-title", c.emptyStateTitle.length === 0);
}

function legWithheld(dom) {
  const R = parse(dom);
  if (!R) return check("3 withheld: scenario output present", false, "no #test-out");
  if (R.err) return check("3 withheld: scenario threw", false, R.err);
  const c = R.s;
  check("3 withheld: modal opened", c.modalOpen === true);
  check("3 withheld: .empty-state present", c.emptyState === 1, `count=${c.emptyState}`);
  check("3 withheld: no .merge-pane", c.mergePane === 0, `count=${c.mergePane}`);
  check("3 withheld: title 'Secret content withheld'", c.emptyStateTitle.some((t) => t.includes("Secret content withheld")), `title=${JSON.stringify(c.emptyStateTitle)}`);
  check("3 withheld: desc includes withheld notice", c.emptyStateDesc.some((d) => d.includes("Secret-class file contents are withheld from merge previews.")), `desc=${JSON.stringify(c.emptyStateDesc)}`);
  check("3 withheld: NO .btn-reveal in the default posture (reveal:false)", c.hasBtnReveal === false, `hasReveal=${JSON.stringify(c.hasBtnReveal)}`);
}

function legWithheldCapable(dom) {
  const R = parse(dom);
  if (!R) return check("6 withheld-capable: scenario output present", false, "no #test-out");
  if (R.err) return check("6 withheld-capable: scenario threw", false, R.err);
  const c = R.s;
  check("6 withheld-capable: modal opened", c.modalOpen === true);
  check("6 withheld-capable: .btn-reveal present on the secret row (reveal:true)", c.hasBtnReveal === true, JSON.stringify(c.hasBtnReveal));
  check("6 withheld-capable: #reveal-value hidden before click", c.revealValueHiddenBefore === true && c.beforeValueInDom === true, JSON.stringify({ h: c.revealValueHiddenBefore, clean: c.beforeValueInDom }));
}

function legWithheldGranted(dom) {
  const R = parse(dom);
  if (!R) return check("7 withheld-granted: scenario output present", false, "no #test-out");
  if (R.err) return check("7 withheld-granted: scenario threw", false, R.err);
  const c = R.s;
  check("7 withheld-granted: .btn-reveal present and clicked", c.hasBtnReveal === true && c.afterClickValueHidden === false, JSON.stringify({ has: c.hasBtnReveal, h: c.afterClickValueHidden }));
  check("7 withheld-granted: #reveal-value carries 'DATABASE_URL = <value>' from the /reveal 200 body",
    (c.afterClickValueText || "").includes("DATABASE_URL") && (c.afterClickValueText || "").includes(FIXTURE_REVEAL_VALUE),
    JSON.stringify(c.afterClickValueText));
  check("7 withheld-granted: #reveal-value data-reveal-decision=revealed", c.revealValueDecision === "revealed", JSON.stringify(c.revealValueDecision));
  check("7 withheld-granted: value is HTML-escaped (no raw markup injection)",
    !/<script/.test(c.afterClickInnerHTML || "") && (c.afterClickInnerHTML || "").includes(FIXTURE_REVEAL_VALUE),
    JSON.stringify(c.afterClickInnerHTML));
}

function legWithheldDenied(dom) {
  const R = parse(dom);
  if (!R) return check("8 withheld-denied: scenario output present", false, "no #test-out");
  if (R.err) return check("8 withheld-denied: scenario threw", false, R.err);
  const c = R.s;
  check("8 withheld-denied: denial notice renders",
    (c.afterClickValueText || "").includes("Secret content withheld") && (c.afterClickValueText || "").includes("reveal not authorized"),
    JSON.stringify(c.afterClickValueText));
  check("8 withheld-denied: #reveal-value data-reveal-decision=denied", c.revealValueDecision === "denied", JSON.stringify(c.revealValueDecision));
  check("8 withheld-denied: NO fixture value in the modal DOM",
    !(c.bodyInnerHTMLAfter || "").includes(FIXTURE_REVEAL_VALUE) && c.beforeValueInDom === true,
    "fixture leaked into the modal DOM");
}

function legEmpty(dom) {
  const R = parse(dom);
  if (!R) return check("4 empty: scenario output present", false, "no #test-out");
  if (R.err) return check("4 empty: scenario threw", false, R.err);
  const c = R.s;
  check("4 empty: modal opened", c.modalOpen === true);
  check("4 empty: no .merge-pane", c.mergePane === 0, `count=${c.mergePane}`);
  check("4 empty: .empty-state-title 'No files changed in merge'", c.emptyStateTitle.length === 1 && c.emptyStateTitle[0] === "No files changed in merge", `title=${JSON.stringify(c.emptyStateTitle)}`);
}

function legError(dom) {
  const R = parse(dom);
  if (!R) return check("5 error: scenario output present", false, "no #test-out");
  if (R.err) return check("5 error: scenario threw", false, R.err);
  const c = R.s;
  check("5 error: modal opened", c.modalOpen === true);
  check("5 error: badge text 'error'", c.badgeText === "error", `badge=${c.badgeText}`);
  check("5 error: badge class badge-red", String(c.badgeClass || "").includes("badge-red"), `cls=${c.badgeClass}`);
  check("5 error: .empty-state-title 'Failed to compute merge'", c.emptyStateTitle.some((t) => t.includes("Failed to compute merge")), `title=${JSON.stringify(c.emptyStateTitle)}`);
  check("5 error: .empty-state-desc includes 'merge-backend exploded'", c.emptyStateDesc.some((d) => d.includes("merge-backend exploded")), `desc=${JSON.stringify(c.emptyStateDesc)}`);
}

const scenarios = [
  { m: "clean", leg: legClean },
  { m: "conflict", leg: legConflict },
  { m: "withheld", leg: legWithheld },
  { m: "empty", leg: legEmpty },
  { m: "error", leg: legError },
  { m: "withheld", whoami: "authorized", leg: legWithheldCapable },
  { m: "withheld", whoami: "authorized", reveal: "grant", click: true, leg: legWithheldGranted },
  { m: "withheld", whoami: "authorized", reveal: "deny", click: true, leg: legWithheldDenied },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  for (const [i, s] of scenarios.entries()) {
    mergeMode = s.m;
    whoamiMode = s.whoami ?? "default";
    revealMode = s.reveal ?? "grant";
    clickReveal = s.click === true;
    try {
      const dom = await dumpDom(url);
      s.leg(dom);
    } catch (e) {
      check(`${i + 1} ${s.m}: scenario threw`, false, String(e?.stack ?? e));
    }
  }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2000);
    server.close(() => { clearTimeout(t); resolve(); });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
