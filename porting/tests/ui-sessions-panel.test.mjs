#!/usr/bin/env bun
// Contract suite: the sessions panel + steer composer
// (nextgit-e16, wave-16) — the honest v1 session list
// is surfaced from GET /sessions and the per-repo
// steer composer POSTs /sessions/{repo}/steer.
// Run: bun porting/tests/ui-sessions-panel.test.mjs
// (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html +
// app.js + the module graph incl. js/sessions-panel.js) is
// served VERBATIM from a loopback origin into real headless
// Chrome via --dump-dom; the only scripted pieces are the
// worker's HTTP surface (JSON fixtures per mode) and a tiny
// observer/driver injected before app.js. No module mocks,
// no source grep, no in-page observer of the module's
// internals. Legs:
//   1. the section renders one row per fixture session with
//      the state chip (loader gone)
//   2. the empty fixture renders "No session activity" and
//      the loader is gone
//   3. the steer round-trip: the real composer is driven
//      (type + click), the optimistic `sent` marker appears,
//      the loopback worker records the POST (route + wire
//      body), and the refreshed feed carries the
//      session.steered evidence (row flips to working)
//   4. a 403 repo-not-allowed surfaces via the action
//      banner (banner-error) and the sent marker is removed
//   5. a 500 on /sessions renders the quiet unavailable line
//      with the connection banner STILL hidden (fail-soft)
//      and untrusted repo/intent renders escaped (AD-4)
//   6. zero uncaught page errors across every dump
//   7. the per-repo instructions subsection renders the
//      recorded feed newest-first, and a repo with no
//      recorded instruction renders the honest empty state
//   8. the cursor advances: the first poll sends no since,
//      the next sends the served cursor, the newer page
//      renders and the replaced page does not
//   9. a re-poll reconciles duplicate-free (each recorded
//      instruction renders exactly once)
//  10. a failing instructions read stays quiet — rows still
//      render, no banner, no fabricated row (fail-soft)
//  11. untrusted instruction text renders escaped (AD-4)
//  12. the typed steer draft survives the 2s
//      ambient sessionsTimer tick (value,
//      focus and caret preserved across the
//      innerHTML swap)
// A box without a Chrome binary skips the suite (precedent:
// ui-issues-panel, ui-comments).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = '<script type="module" src="app.js"></script>';
// Injected before app.js: records every uncaught error/rejection on <html>.
const ERR_COLLECTOR =
  '<script>document.documentElement.setAttribute("data-page-errors","0");window.__errs=[];' +
  'addEventListener("error",(e)=>{window.__errs.push(String((e&&e.message)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});' +
  'addEventListener("unhandledrejection",(e)=>{window.__errs.push(String((e&&e.reason)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});</script>';

// The fixture session set — one row per server-derived
// state (the CONTRACT §GET /sessions shape): a working
// row with intent+lastEvent+lastActivityAt, an idle row
// with lastEvent only, a blocked row.
const FIXTURE = {
  ok: true,
  base: "demo",
  sessions: [
    {
      repo: "agent-1",
      state: "working",
      intent: "fix the login bug",
      lastEvent: "session.started",
      lastActivityAt: "2026-10-14T10:00:00.000Z",
    },
    { repo: "agent-2", state: "idle", lastEvent: "session.idle" },
    { repo: "agent-3", state: "blocked" },
  ],
};

// The post-steer fixture: agent-1 flipped to working with
// the session.steered evidence (the reconcile-on-refresh
// observable — the refreshed feed carries the event).
const STEERED_FIXTURE = {
  ok: true,
  base: "demo",
  sessions: [
    {
      repo: "agent-1",
      state: "working",
      lastEvent: "session.steered",
      lastActivityAt: "2026-10-14T10:01:00.000Z",
    },
    { repo: "agent-2", state: "idle", lastEvent: "session.idle" },
    { repo: "agent-3", state: "blocked" },
  ],
};

const EMPTY = { ok: true, base: "demo", sessions: [] };

// Untrusted repo/intent content (AD-4): both carry markup.
const XSS_REPO = "<img src=x onerror=alert(1)>";
const XSS_INTENT = "<script>alert(2)</script>";
const XSS_FIXTURE = {
  ok: true,
  base: "demo",
  sessions: [{ repo: XSS_REPO, state: "working", intent: XSS_INTENT }],
};

// The recorded-instruction fixtures (the CONTRACT
// §GET /sessions/{repo}/instructions shape): the first page
// carries two rows newest-first with the newest id as its
// cursor, the advance page carries only the row newer than
// that cursor, the empty page carries cursor:null, and the
// untrusted page carries markup in the instruction text.
const INSTRUCTIONS_FIXTURE = {
  ok: true,
  repo: "agent-1",
  instructions: [
    { id: "c4", text: "newer instruction", at: "2026-10-14T10:00:04.000Z" },
    { id: "c3", text: "older instruction", at: "2026-10-14T10:00:03.000Z" },
  ],
  cursor: "c4",
};

const INSTRUCTIONS_PAGE2_FIXTURE = {
  ok: true,
  repo: "agent-1",
  instructions: [{ id: "c5", text: "newest instruction", at: "2026-10-14T10:00:05.000Z" }],
  cursor: "c5",
};

const INSTRUCTIONS_EMPTY_FIXTURE = { ok: true, repo: "agent-1", instructions: [], cursor: null };

const INSTRUCTIONS_XSS_TEXT = "<img src=x onerror=alert(3)>";
const INSTRUCTIONS_XSS_FIXTURE = {
  ok: true,
  repo: "agent-1",
  instructions: [{ id: "x1", text: INSTRUCTIONS_XSS_TEXT, at: "2026-10-14T10:00:09.000Z" }],
  cursor: "x1",
};

const PROPOSALS = { ok: true, base: { repo: "fixture", ref: "main" }, ref: "main", summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 }, proposals: [], conflicts: [] };

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI sessions panel — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

// Async spawn: the loopback server runs on THIS process's
// event loop, so a blocking exec would deadlock the very
// fetch the page is waiting on. Each scenario gets its
// own fresh browser profile: a shared user-data-dir lets
// Chrome's disk cache serve a previous scenario's
// document, which races the async loadSessions() and
// swaps two dumps.
const dumpDom = (url, scenarioDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", `--user-data-dir=${scenarioDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ dom: out, stderr: err });
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// --- DOM readers over the dumped markup ---
const sessionsRegion = (dom) => {
  const m = dom.match(/id="sessions-section"[^>]*>([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
};
// A rendered row opens with `session-row`; the split
// delimiter is the full class so it does not also match
// the nested `session-row-header` div.
const rowsOf = (dom) => (sessionsRegion(dom) || "").split('<div class="session-row"').slice(1);
const rowStates = (dom) => [...(sessionsRegion(dom) || "").matchAll(/class="session-state session-state-([^"]+)">([^<]*)</g)].map((m) => ({ cls: m[1], text: m[2] }));
const rowRepos = (dom) => [...(sessionsRegion(dom) || "").matchAll(/class="session-repo">([^<]*)</g)].map((m) => m[1]);
const pageErrors = (dom) => {
  const m = dom.match(/<html[^>]*data-page-errors="(\d+)"/);
  return m ? Number(m[1]) : null;
};
const bannerVisible = (dom) => !/<div id="connection-banner"[^>]*\shidden(=|\s|>)/.test(dom);

// The agent-1 (or named) session row's own block: rowsOf()
// splits on the row delimiter, so each chunk stops before the
// next row — a row's instruction rows are read in isolation.
const rowChunkOf = (dom, repo) =>
  rowsOf(dom).find((chunk) => chunk.includes(`id="session-${repo}"`)) || "";
const instructionTextsIn = (chunk) => [...chunk.matchAll(/class="session-instruction-text">([^<]*)</g)].map((m) => m[1]);
const instructionTimesIn = (chunk) => [...chunk.matchAll(/class="session-instruction-time">([^<]*)</g)].map((m) => m[1]);
const hasEmptyStateIn = (chunk) => /class="session-instructions-empty"/.test(chunk);

// --- Loopback worker state — reset per scenario by the runner. ---
let sessionsMode = "ok";  // "ok" | "empty" | "xss" | "fail"
let steerMode = "ok";     // "ok" | "403"
let steered = false;      // a successful steer flips the feed (the refreshed evidence)
let instructionsMode = "ok"; // "ok" | "mixed" | "advance" | "fail" | "xss"
const steerRequests = []; // the real HTTP log for the steer POST
const instructionRequests = []; // the real HTTP log for the instructions poll (repo + since)

// Observer/driver: injected BEFORE app.js. For the steer
// legs it drives the REAL composer (types into the row's
// textarea, clicks the real send button, then triggers the
// manual refresh that reconciles the row). Emits #test-out.
const clientScript = (cfg) => `const CFG = ${JSON.stringify(cfg)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
let errCount = 0;
let rejCount = 0;
window.addEventListener("error", () => { errCount++; });
window.addEventListener("unhandledrejection", () => { rejCount++; });
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    R.s.rowCount = qs("#sessions-list .session-row").length;
    R.s.chips = qs("#sessions-list .session-row .session-state").map((c) => c.textContent.trim());
    R.s.intents = qs("#sessions-list .session-row .session-intent").map((e) => e.textContent.trim());
    R.s.lastEvents = qs("#sessions-list .session-row .session-last-event").map((e) => e.textContent.trim());
    R.s.meta = q("#sessions-meta") ? q("#sessions-meta").textContent.trim() : null;
    R.s.loaderGone = !qs("#sessions-list .sessions-loading").length;
    R.s.unavailable = qs("#sessions-list .sessions-unavailable").map((e) => e.textContent.trim());
    R.s.emptyTitle = qs("#sessions-list .sessions-empty-title").map((e) => e.textContent.trim());
    // The instructions subsection (the poll evidence surface):
    // agent-1's recorded rows and the repos' honest empty state.
    R.s.instrTexts = qs("#session-agent-1 .session-instruction .session-instruction-text").map((e) => e.textContent.trim());
    R.s.instrTimes = qs("#session-agent-1 .session-instruction .session-instruction-time").map((e) => e.textContent.trim());
    R.s.instrEmpty1 = qs("#session-agent-1 .session-instructions-empty").map((e) => e.textContent.trim());
    R.s.instrEmpty2 = qs("#session-agent-2 .session-instructions-empty").map((e) => e.textContent.trim());

    if (CFG.mode === "steer" || CFG.mode === "steer403") {
      const row = q("#sessions-list .session-row#session-agent-1");
      const input = row ? row.querySelector(".steer-input[data-steer-repo]") : null;
      const btn = row ? row.querySelector(".steer-send") : null;
      if (input) input.value = CFG.instruction;
      if (btn) btn.click();
      await sleep(1200);
      R.s.sentMarker = btn ? btn.getAttribute("data-steer-sent") : null;
      R.s.sentDisabled = btn ? btn.disabled : null;
      R.s.sendLabel = btn ? btn.textContent.trim() : null;
      // The section's dedicated live region right after
      // the steer (the issues #issues-status posture):
      // the failure leg announced into it; the success
      // leg left it empty.
      R.s.statusText = q("#sessions-status") ? q("#sessions-status").textContent.trim() : null;
      // Reconcile on refresh: the manual-refresh control
      // re-runs loadSessions() (the refreshed feed carries
      // the session.steered evidence).
      const refresh = q("#btn-manual-refresh");
      if (refresh) refresh.click();
      await sleep(1200);
      const row2 = q("#sessions-list .session-row#session-agent-1");
      const chip2 = row2 ? row2.querySelector(".session-state") : null;
      const last2 = row2 ? row2.querySelector(".session-last-event") : null;
      R.s.agent1Chip = chip2 ? chip2.textContent.trim() : null;
      R.s.agent1ChipClass = chip2 ? chip2.className : null;
      R.s.agent1LastEvent = last2 ? last2.textContent.trim() : null;
      const banner = q("#action-banner");
      R.s.bannerClass = banner ? banner.className : null;
      R.s.bannerHidden = banner ? banner.hidden : null;
      R.s.bannerMsg = q("#action-banner-msg") ? q("#action-banner-msg").textContent.trim() : null;
      R.s.bannerBadge = q("#action-banner-badge") ? q("#action-banner-badge").textContent.trim() : null;
      const btn2 = row2 ? row2.querySelector(".steer-send") : null;
      R.s.sentMarkerAfterRefresh = btn2 ? btn2.getAttribute("data-steer-sent") : null;
      R.s.sendDisabledAfterRefresh = btn2 ? btn2.disabled : null;
      // The post-refresh live-region state: the refetch
      // re-renders the section, so renderSessions()
      // clears any standing announcement (the
      // clear-on-success discipline).
      R.s.statusTextAfterRefresh = q("#sessions-status") ? q("#sessions-status").textContent.trim() : null;
    }

    // Leg 12 driver: type into the REAL steer composer,
    // focus it, set the caret, then wait past one full
    // 2s sessionsTimer tick. The ambient tick re-runs
    // loadSessions -> renderSessions (the innerHTML swap);
    // the draft, the focus and the caret must survive it.
    if (CFG.mode === "composer-survive") {
      const row = q("#sessions-list .session-row#session-agent-1");
      const input = row ? row.querySelector(".steer-input[data-steer-repo]") : null;
      if (input) {
        input.value = CFG.instruction;
        input.focus();
        input.setSelectionRange(CFG.instruction.length, CFG.instruction.length);
      }
      await sleep(2600); // one full 2s sessionsTimer tick lands here
      const late = q("#sessions-list .session-row#session-agent-1 .steer-input[data-steer-repo]");
      R.s.draftValueLate = late ? late.value : null;
      R.s.draftFocusedLate = document.activeElement === late;
      R.s.draftRepoFocused = document.activeElement ? document.activeElement.getAttribute("data-steer-repo") : null;
      R.s.draftCaretLate = late ? { start: late.selectionStart, end: late.selectionEnd } : null;
    }

    // The instructions poll rides the 2s sessions cadence, so a
    // second read past that tick is the reconcile surface: a
    // re-poll re-renders the served page wholesale (never a
    // duplicate) and a cursor-advanced poll shows only the newer
    // page. Read late, never mid-flight.
    if (String(CFG.mode).startsWith("instructions")) {
      await sleep(2600);
      R.s.instrTextsLate = qs("#session-agent-1 .session-instruction .session-instruction-text").map((e) => e.textContent.trim());
      R.s.instrEmpty1Late = qs("#session-agent-1 .session-instructions-empty").map((e) => e.textContent.trim());
      R.s.rowsLate = qs("#sessions-list .session-row").length;
      const bannerLate = q("#action-banner");
      R.s.bannerClassLate = bannerLate ? bannerLate.className : null;
      R.s.bannerHiddenLate = bannerLate ? bannerLate.hidden : null;
      const connLate = q("#connection-banner");
      R.s.connHiddenLate = connLate ? connLate.hidden : null;
    }

    R.s.errCount = errCount;
    R.s.rejCount = rejCount;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/issues") return json(res, { ok: true, base: "demo", issues: [] });
  if (pathname === "/forks") return json(res, { ok: true, base: "demo", clusters: [], lineage: [] });
  if (pathname === "/checks") return json(res, { ok: true, checks: [] });
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, { ok: true, events: [] });
  if (pathname === "/judge") return json(res, { ok: true, judgments: [], skipped: [] });
  if (pathname === "/whoami") return json(res, { ok: true, authorized: false, reveal: false });
  // GET /sessions — mode selects the fixture; a successful
  // steer flips the feed to the steered evidence.
  if (pathname === "/sessions" && req.method === "GET") {
    if (sessionsMode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    if (sessionsMode === "xss") return json(res, XSS_FIXTURE);
    if (sessionsMode === "empty") return json(res, EMPTY);
    return json(res, steered ? STEERED_FIXTURE : FIXTURE);
  }
  // GET /sessions/{repo}/instructions — the instructions read's
  // poll seam. instructionsMode selects the fixture; every request
  // is recorded with its repo and since param (the server-side log
  // is the cursor-advance evidence surface).
  const instr = pathname.match(/^\/sessions\/(.+)\/instructions$/);
  if (instr && req.method === "GET") {
    const repo = decodeURIComponent(instr[1]);
    const since = new URL(req.url, "http://127.0.0.1").searchParams.get("since");
    instructionRequests.push({ method: "GET", repo, since });
    if (instructionsMode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    if (instructionsMode === "xss") return json(res, { ...INSTRUCTIONS_XSS_FIXTURE, repo });
    if (instructionsMode === "mixed" && repo !== "agent-1") return json(res, { ...INSTRUCTIONS_EMPTY_FIXTURE, repo });
    if (instructionsMode === "advance") {
      return json(res, since ? { ...INSTRUCTIONS_PAGE2_FIXTURE, repo } : { ...INSTRUCTIONS_FIXTURE, repo });
    }
    return json(res, { ...INSTRUCTIONS_FIXTURE, repo });
  }
  // POST /sessions/{repo}/steer — the steer composer's
  // mutating seam. The worker records the real request
  // (route + wire body) and answers per steerMode.
  const steer = pathname.match(/^\/sessions\/(.+)\/steer$/);
  if (steer && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { payload = {}; }
      steerRequests.push({ method: "POST", repo: decodeURIComponent(steer[1]), body: payload });
      if (steerMode === "403") { json(res, { ok: false, error: "repo-not-allowed" }, 403); return; }
      steered = true;
      json(res, { ok: true, repo: decodeURIComponent(steer[1]), event: { type: "session.steered", repo: decodeURIComponent(steer[1]), at: "2026-10-14T10:01:00.000Z" } });
    });
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(clientCfg));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (file.endsWith("index.html")) {
    const html = readFileSync(file, "utf8").replace(APP_TAG, ERR_COLLECTOR + `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

let clientCfg = {};
const parse = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// --- Contract legs ---
function legRows(dom) {
  const R = parse(dom);
  if (!R) return check("1: scenario output present", false, "no #test-out");
  if (R.err) return check("1: scenario threw", false, R.err);
  const c = R.s;
  const region = sessionsRegion(dom);
  check("1 #sessions-section renders", region !== null, "section missing");
  check("1 the first-load loader is gone", c.loaderGone === true, "loader still present");
  const rows = rowsOf(dom);
  check("1 one row per fixture session (3)", rows.length === 3, `count=${rows.length}`);
  const states = rowStates(dom);
  check("1 every row carries its state chip verbatim",
    JSON.stringify(states) === JSON.stringify([{ cls: "working", text: "working" }, { cls: "idle", text: "idle" }, { cls: "blocked", text: "blocked" }]),
    JSON.stringify(states));
  const repos = rowRepos(dom);
  check("1 every row carries its repo", JSON.stringify(repos) === JSON.stringify(["agent-1", "agent-2", "agent-3"]), JSON.stringify(repos));
  check("1 the working row renders its intent", (c.intents || []).some((t) => t === "fix the login bug"), JSON.stringify(c.intents));
  check("1 the working row renders its last event + time", (c.lastEvents || []).some((t) => t.includes("session.started")), JSON.stringify(c.lastEvents));
  check("1 the section meta counts the sessions", c.meta === "3 sessions", String(c.meta));
}

function legEmpty(dom) {
  const R = parse(dom);
  if (!R) return check("2: scenario output present", false, "no #test-out");
  if (R.err) return check("2: scenario threw", false, R.err);
  const c = R.s;
  const region = sessionsRegion(dom) || "";
  check("2 the empty state renders", (c.emptyTitle || []).some((t) => t === "No session activity for demo"), JSON.stringify(c.emptyTitle));
  check("2 the loader is gone", c.loaderGone === true, "loader still present");
  check("2 the meta counts zero sessions", c.meta === "0 sessions", String(c.meta));
  check("2 no row renders", rowsOf(dom).length === 0, `count=${rowsOf(dom).length}`);
}

function legSteer(dom) {
  const R = parse(dom);
  if (!R) return check("3: scenario output present", false, "no #test-out");
  if (R.err) return check("3: scenario threw", false, R.err);
  const c = R.s;
  check("3 the optimistic sent marker appears", c.sentMarker === "1", `marker=${c.sentMarker}`);
  check("3 the send button is disabled while in flight", c.sentDisabled === true, `disabled=${c.sentDisabled}`);
  check("3 the send button reads 'sent'", c.sendLabel === "sent", `label=${c.sendLabel}`);
  const posts = steerRequests.filter((r) => r.method === "POST");
  check("3 exactly one steer POST", posts.length === 1, `posts=${posts.length}`);
  const p = posts[0] || {};
  check("3 the POST targets /sessions/agent-1/steer", p.repo === "agent-1", `repo=${p.repo}`);
  check("3 the POST wire body is the pinned {instruction}", p.body && p.body.instruction === "steer it left" && Object.keys(p.body).length === 1, JSON.stringify(p.body));
  check("3 the refreshed row reconciles to working", c.agent1Chip === "working", `chip=${c.agent1Chip}`);
  check("3 the reconciled chip carries the working class", (c.agent1ChipClass || "").includes("session-state-working"), String(c.agent1ChipClass));
  check("3 the refreshed row carries the session.steered evidence", (c.agent1LastEvent || "").includes("session.steered"), String(c.agent1LastEvent));
  check("3 the sent marker survives the success path (no failure branch)", c.bannerHidden !== false || c.bannerClass == null || !String(c.bannerClass).includes("banner-error"), `banner=${c.bannerClass}`);
  // Clear-on-success discipline (the issues
  // renderIssues posture): the successful steer never
  // announces into the section's live region and its
  // refetch leaves it empty.
  check("3 the sessions live region carries no announcement on the successful steer",
    (c.statusText || "") === "" && (c.statusTextAfterRefresh || "") === "",
    `statusText=${c.statusText} afterRefresh=${c.statusTextAfterRefresh}`);
  check("3 no uncaught page error", c.errCount === 0, `errCount=${c.errCount}`);
  check("3 no unhandled rejection", c.rejCount === 0, `rejCount=${c.rejCount}`);
}

function legSteer403(dom) {
  const R = parse(dom);
  if (!R) return check("4: scenario output present", false, "no #test-out");
  if (R.err) return check("4: scenario threw", false, R.err);
  const c = R.s;
  check("4 the optimistic sent marker appeared then was removed", c.sentMarkerAfterRefresh == null, `marker=${c.sentMarkerAfterRefresh}`);
  check("4 the composer is re-enabled after failure", c.sendDisabledAfterRefresh === false, `disabled=${c.sendDisabledAfterRefresh}`);
  check("4 the action banner is shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
  check("4 the action banner carries banner-error", String(c.bannerClass || "").includes("banner-error"), String(c.bannerClass));
  check("4 the banner badge names steer-failed", c.bannerBadge === "steer-failed", String(c.bannerBadge));
  check("4 the banner copy names the server's repo-not-allowed token", (c.bannerMsg || "").includes("repo-not-allowed"), String(c.bannerMsg));
  // The dedicated-slot leg (WCAG 4.1.3 — the issues
  // #issues-status posture): the section's own
  // aria-live region announces the steer failure,
  // naming the repo and the server's token.
  check("4 the sessions live region announces the steer failure",
    (c.statusText || "").toLowerCase().includes("steer failed") && (c.statusText || "").includes("agent-1") && (c.statusText || "").includes("repo-not-allowed"),
    `statusText=${c.statusText}`);
  check("4 no uncaught page error", c.errCount === 0, `errCount=${c.errCount}`);
  check("4 no unhandled rejection", c.rejCount === 0, `rejCount=${c.rejCount}`);
}

function legFail(dom) {
  const R = parse(dom);
  if (!R) return check("5: scenario output present", false, "no #test-out");
  if (R.err) return check("5: scenario threw", false, R.err);
  const c = R.s;
  check("5 the panel shows the quiet unavailable line", (c.unavailable || []).some((t) => t === "Sessions unavailable."), JSON.stringify(c.unavailable));
  check("5 the loader is gone", c.loaderGone === true, "loader still present");
  check("5 a /sessions failure does NOT trip the connection banner", !bannerVisible(dom), "connection banner is visible");
  check("5 the metas stay em-dash on the unobserved panel", c.meta === "—", String(c.meta));
}

function legXss(dom) {
  const R = parse(dom);
  if (!R) return check("5: scenario output present", false, "no #test-out");
  if (R.err) return check("5: scenario threw", false, R.err);
  const region = sessionsRegion(dom) || "";
  check("5 the untrusted repo name renders escaped", region.includes("&lt;img src=x onerror=alert(1)&gt;"), region.slice(0, 240));
  check("5 the untrusted intent renders escaped", region.includes("&lt;script&gt;alert(2)&lt;/script&gt;"), region.slice(0, 240));
  check("5 no raw element injected from session content", !region.includes("<img") && !region.includes("<script>"), region.slice(0, 240));
}

// Leg 7 — the instructions subsection renders the recorded feed
// newest-first inside its session row, and a repo with no
// recorded instruction renders the honest empty state.
function legInstructions(dom) {
  const R = parse(dom);
  if (!R) return check("7: scenario output present", false, "no #test-out");
  if (R.err) return check("7: scenario threw", false, R.err);
  const c = R.s;
  const chunk = rowChunkOf(dom, "agent-1");
  check("7 agent-1's row renders the instructions subsection", chunk.includes('class="session-instructions"'), "subsection missing");
  check("7 the newest recorded instruction renders first (newest-first)",
    (c.instrTexts || []).join("|") === "newer instruction|older instruction", JSON.stringify(c.instrTexts));
  check("7 every instruction row carries its recorded instant",
    (c.instrTimes || []).length === 2 && (c.instrTimes || []).every((t) => /^\d{2}:\d{2}:\d{2}$/.test(t)), JSON.stringify(c.instrTimes));
  check("7 the dumped row agrees with the driver read",
    instructionTextsIn(chunk).join("|") === "newer instruction|older instruction", JSON.stringify(instructionTextsIn(chunk)));
  check("7 a repo with no recorded instruction renders the honest empty state",
    (c.instrEmpty2 || []).some((t) => t === "No instructions recorded"), JSON.stringify(c.instrEmpty2));
  check("7 a repo WITH recorded instructions renders no empty state",
    (c.instrEmpty1 || []).length === 0 && !hasEmptyStateIn(chunk), JSON.stringify(c.instrEmpty1));
}

// Leg 8 — the cursor advance law: the first poll sends no since,
// the next sends the served cursor, the newer page renders and
// the replaced page does not re-render (the served page replaces
// the stored rows wholesale).
function legCursorAdvance(dom) {
  const R = parse(dom);
  if (!R) return check("8: scenario output present", false, "no #test-out");
  if (R.err) return check("8: scenario threw", false, R.err);
  const c = R.s;
  const polls = instructionRequests.filter((r) => r.repo === "agent-1");
  const sinces = polls.map((p) => p.since);
  check("8 the first instructions poll carries no since", polls.length >= 1 && polls[0].since === null, JSON.stringify(sinces));
  check("8 the next poll advances to the served cursor (since=c4)",
    polls.length >= 2 && polls[1].since === "c4", JSON.stringify(sinces));
  check("8 the cursor never rewinds (every later poll carries a since)",
    polls.length >= 2 && polls.slice(1).every((p) => typeof p.since === "string" && p.since.length > 0), JSON.stringify(sinces));
  check("8 the client driver saw the first page before the advance",
    (c.instrTexts || []).join("|") === "newer instruction|older instruction", JSON.stringify(c.instrTexts));
  const chunk = rowChunkOf(dom, "agent-1");
  check("8 the cursor-advanced page renders its newer instruction",
    instructionTextsIn(chunk).join("|") === "newest instruction", JSON.stringify(instructionTextsIn(chunk)));
  check("8 the replaced page's instructions do not re-render",
    !chunk.includes("newer instruction") && !chunk.includes("older instruction"), JSON.stringify(instructionTextsIn(chunk)));
  check("8 exactly one instruction row renders after the advance",
    instructionTextsIn(chunk).length === 1, `count=${instructionTextsIn(chunk).length}`);
  check("8 the client's late read shows only the advanced page",
    (c.instrTextsLate || []).join("|") === "newest instruction", JSON.stringify(c.instrTextsLate));
}

// Leg 9 — duplicate-free reconcile: the 2s re-poll re-serves the
// page and the panel replaces it wholesale (an append-style
// reconcile would render every row twice).
function legDuplicateFree(dom) {
  const R = parse(dom);
  if (!R) return check("9: scenario output present", false, "no #test-out");
  if (R.err) return check("9: scenario threw", false, R.err);
  const c = R.s;
  const polls = instructionRequests.filter((r) => r.repo === "agent-1").length;
  check("9 the poll actually re-ran (the reconcile surface)", polls >= 2, `polls=${polls}`);
  const chunk = rowChunkOf(dom, "agent-1");
  const texts = instructionTextsIn(chunk);
  check("9 the re-polled page renders exactly two rows (no duplicate append)", texts.length === 2, JSON.stringify(texts));
  check("9 each recorded instruction renders exactly once",
    texts.filter((t) => t === "newer instruction").length === 1 && texts.filter((t) => t === "older instruction").length === 1,
    JSON.stringify(texts));
  check("9 the client's late read agrees (each instruction once)",
    JSON.stringify(c.instrTextsLate) === JSON.stringify(["newer instruction", "older instruction"]), JSON.stringify(c.instrTextsLate));
  check("9 the re-polled repo still renders no empty state",
    (c.instrEmpty1Late || []).length === 0 && !hasEmptyStateIn(chunk), JSON.stringify(c.instrEmpty1Late));
}

// Leg 10 — fail-soft: a failing instructions read stays quiet.
// The rows keep rendering, no banner appears, and the subsection
// never fabricates a row (the maps stand untouched).
function legInstructionsFail(dom) {
  const R = parse(dom);
  if (!R) return check("10: scenario output present", false, "no #test-out");
  if (R.err) return check("10: scenario threw", false, R.err);
  const c = R.s;
  check("10 the instructions poll ran and failed server-side",
    instructionRequests.filter((r) => r.repo === "agent-1").length >= 1, `polls=${instructionRequests.length}`);
  check("10 the session rows still render when the instructions read fails",
    c.rowCount === 3 && rowsOf(dom).length === 3, `client=${c.rowCount} dom=${rowsOf(dom).length}`);
  check("10 a failed instructions read does NOT trip the connection banner",
    !bannerVisible(dom) && c.connHiddenLate === true, `domBanner=${bannerVisible(dom)} lateHidden=${c.connHiddenLate}`);
  check("10 no action banner surfaces for the quiet failure",
    c.bannerHiddenLate === true && !String(c.bannerClassLate || "").includes("banner-error"), `class=${c.bannerClassLate} hidden=${c.bannerHiddenLate}`);
  check("10 the subsection keeps its honest empty state (nothing fabricated)",
    hasEmptyStateIn(rowChunkOf(dom, "agent-1")) && instructionTextsIn(rowChunkOf(dom, "agent-1")).length === 0,
    JSON.stringify(c.instrEmpty1));
}

// Leg 11 — the untrusted instruction text renders escaped (AD-4).
function legInstructionsXss(dom) {
  const R = parse(dom);
  if (!R) return check("11: scenario output present", false, "no #test-out");
  if (R.err) return check("11: scenario threw", false, R.err);
  const chunk = rowChunkOf(dom, "agent-1");
  const region = sessionsRegion(dom) || "";
  check("11 the untrusted instruction text renders escaped",
    chunk.includes("&lt;img src=x onerror=alert(3)&gt;"), chunk.slice(0, 240));
  check("11 no raw element injected from instruction text", !chunk.includes("<img"), chunk.slice(0, 240));
  check("11 the instruction renders once inside its session row",
    chunk.includes('class="session-instruction"') && instructionTextsIn(chunk).length === 1, JSON.stringify(instructionTextsIn(chunk)));
  check("11 no raw instruction element leaks anywhere in the panel region", !region.includes("<img"), region.slice(0, 200));
}

// Leg 12 — the typed steer draft survives the 2s ambient tick.
function legComposerSurvive(dom) {
  const R = parse(dom);
  if (!R) return check("12: scenario output present", false, "no #test-out");
  if (R.err) return check("12: scenario threw", false, R.err);
  const c = R.s;
  const polls = instructionRequests.filter((r) => r.repo === "agent-1").length;
  check("12 the ambient tick re-ran the poll while typing", polls >= 1, `polls=${polls}`);
  check("12 the typed steer draft survives the 2s tick", c.draftValueLate === "draft survives the tick", `value=${JSON.stringify(c.draftValueLate)}`);
  check("12 the composer keeps focus across the tick", c.draftFocusedLate === true, `focused=${c.draftFocusedLate}`);
  check("12 focus stays on the typed repo composer", c.draftRepoFocused === "agent-1", `repo=${c.draftRepoFocused}`);
  check("12 the caret is preserved across the tick", c.draftCaretLate && c.draftCaretLate.start === "draft survives the tick".length && c.draftCaretLate.end === "draft survives the tick".length, JSON.stringify(c.draftCaretLate));
}

function legZeroErrors(dom) {
  check("6 zero uncaught page errors (data-page-errors=0)", pageErrors(dom) === 0, `data-page-errors=${pageErrors(dom)}`);
}

const scenarios = [
  { name: "1", sessions: "ok", steer: "ok", instructions: "ok", cfg: { mode: "render" }, leg: legRows },
  { name: "2", sessions: "empty", steer: "ok", instructions: "ok", cfg: { mode: "empty" }, leg: legEmpty },
  { name: "3", sessions: "ok", steer: "ok", instructions: "ok", cfg: { mode: "steer", instruction: "steer it left" }, leg: legSteer },
  { name: "4", sessions: "ok", steer: "403", instructions: "ok", cfg: { mode: "steer403", instruction: "steer it left" }, leg: legSteer403 },
  { name: "5", sessions: "fail", steer: "ok", instructions: "ok", cfg: { mode: "fail" }, leg: legFail },
  { name: "5x", sessions: "xss", steer: "ok", instructions: "ok", cfg: { mode: "xss" }, leg: legXss },
  { name: "7", sessions: "ok", steer: "ok", instructions: "mixed", cfg: { mode: "instructions" }, leg: legInstructions },
  { name: "8", sessions: "ok", steer: "ok", instructions: "advance", cfg: { mode: "instructions-cursor" }, leg: legCursorAdvance },
  { name: "9", sessions: "ok", steer: "ok", instructions: "ok", cfg: { mode: "instructions-static" }, leg: legDuplicateFree },
  { name: "10", sessions: "ok", steer: "ok", instructions: "fail", cfg: { mode: "instructions-fail" }, leg: legInstructionsFail },
  { name: "11", sessions: "ok", steer: "ok", instructions: "xss", cfg: { mode: "instructions-xss" }, leg: legInstructionsXss },
  { name: "12", sessions: "ok", steer: "ok", instructions: "ok", cfg: { mode: "composer-survive", instruction: "draft survives the tick" }, leg: legComposerSurvive },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  for (const s of scenarios) {
    sessionsMode = s.sessions;
    steerMode = s.steer;
    instructionsMode = s.instructions;
    steered = false;
    steerRequests.length = 0;
    instructionRequests.length = 0;
    clientCfg = s.cfg;
    // A fresh browser profile per scenario (see dumpDom).
    const scenarioDir = mkdtempSync(join(tmpdir(), "nextgit-sessions-scenario-"));
    try {
      const { dom, stderr } = await dumpDom(url, scenarioDir);
      s.leg(dom);
      legZeroErrors(dom);
      check(`${s.name}: no Chrome "Uncaught" on stderr`, !/Uncaught/.test(stderr), stderr.split("\n").filter((l) => /Uncaught/.test(l)).slice(0, 2).join(" | "));
    } catch (e) {
      check(`${s.name}: scenario threw`, false, String(e?.stack ?? e));
    } finally {
      rmSync(scenarioDir, { recursive: true, force: true });
    }
  }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
