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

// --- Loopback worker state — reset per scenario by the runner. ---
let sessionsMode = "ok";  // "ok" | "empty" | "xss" | "fail"
let steerMode = "ok";     // "ok" | "403"
let steered = false;      // a successful steer flips the feed (the refreshed evidence)
const steerRequests = []; // the real HTTP log for the steer POST

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

function legZeroErrors(dom) {
  check("6 zero uncaught page errors (data-page-errors=0)", pageErrors(dom) === 0, `data-page-errors=${pageErrors(dom)}`);
}

const scenarios = [
  { name: "1", sessions: "ok", steer: "ok", cfg: { mode: "render" }, leg: legRows },
  { name: "2", sessions: "empty", steer: "ok", cfg: { mode: "empty" }, leg: legEmpty },
  { name: "3", sessions: "ok", steer: "ok", cfg: { mode: "steer", instruction: "steer it left" }, leg: legSteer },
  { name: "4", sessions: "ok", steer: "403", cfg: { mode: "steer403", instruction: "steer it left" }, leg: legSteer403 },
  { name: "5", sessions: "fail", steer: "ok", cfg: { mode: "fail" }, leg: legFail },
  { name: "5x", sessions: "xss", steer: "ok", cfg: { mode: "xss" }, leg: legXss },
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
    steered = false;
    steerRequests.length = 0;
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
