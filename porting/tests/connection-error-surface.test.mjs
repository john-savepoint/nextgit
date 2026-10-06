#!/usr/bin/env bun
// Contract suite: FR-6 — one degradation surface: the Connection banner + "Retry now", silent
// ticker degradation, and a footer sync line that never dresses failure as success.
// Run: bun porting/tests/connection-error-surface.test.mjs   (exit 0 = pass)
// Live leg: PROPS_FIXTURE=<path to a /proposals capture> bun porting/tests/connection-error-surface.test.mjs
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in a real
// headless Chrome over a loopback origin. The only scripted pieces are the worker's HTTP
// surface (which fetch fails, and when) and an observer module injected BEFORE app.js that
// records what the real app rendered and clicks the real "Retry now" control — no product
// mocks, no source grep. Legs:
//   1. at-rest copy (app.js unreachable): the banner ships hidden with the fallback copy
//      "Disconnected from platform worker. Retrying..." plus the "Retry now" control, and
//      the footer reads exactly "not synced yet" without error styling — the initial state
//      of the single error surface. (The reconnect-loop copy is the templated form;
//      loadProposals always supplies a message, so this at-rest copy is the shipped
//      fallback the acceptance names.)
//   2. failed /proposals once + /events always (the order's harness, fixture payload): the
//      banner shows exactly "Connection error: fixture-down. Retrying..." (message threading
//      proven against the harness's own error string) with a "Retry now" BUTTON; the ticker
//      pulse goes stale and its content is retained without ever touching the banner; the
//      retry click re-fetches and the banner hides on that success; the footer advances
//      "not synced yet" -> "synced HH:MM:SS" and never carries error styling; the surface
//      keeps rendering (cards present) and the ticker keeps polling.
//   3. ticker-only failure (events render once, then fail): degradation is silent — pulse
//      stale, the last events stay rendered, the banner is never shown (attribute-observed),
//      no action banner, cards keep rendering, ticker keeps polling.
//   4. live capture (PROPS_FIXTURE): leg 2's battery verbatim over the live payload; unset ->
//      one SKIP line. The live set must carry >= 5 proposals (the order's fixture gate).
// A box without a Chrome binary skips the suite (precedent: conflict-map-render /
// ui-first-load-panels; the order's acceptance gate hard-requires Chrome).

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
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  FR-6 degradation surface — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-degrade-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking exec
// would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 6000) =>
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
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

const tagFor = (dom, id) => (dom.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`)) || [null])[0];
const isHidden = (dom, id) => {
  const tag = tagFor(dom, id);
  return tag !== null && /\shidden(=|\s|>)/.test(tag);
};
const domValue = (dom, id) => {
  const m = dom.match(new RegExp(`id=${JSON.stringify(id)}[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
};
const classOf = (dom, id) => {
  const tag = tagFor(dom, id);
  if (!tag) return null;
  const m = tag.match(/\sclass="([^"]*)"/);
  return m ? m[1] : null;
};
const parseScenario = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// The banner copy the harness must produce: the app threads the worker's error message
// verbatim into "Connection error: {msg}. Retrying...".
const HARNESS_MSG = "fixture-down";
const EXPECTED_BANNER = `Connection error: ${HARNESS_MSG}. Retrying...`;
const TICKER_REST = "listening for convergence events...";
const SYNC_REST = "not synced yet";
const SYNC_OK = /^synced \d{2}:\d{2}:\d{2}$/;
const ERROR_STYLED = /error|stale|warn|alert/;

// The fixture payload: five proposals so `cards >= 5` is discriminative (same shape the
// first-load suites use; the live capture supplies the real set in leg 4).
const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main" },
  ref: "main",
  summary: { proposals: 5, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 },
  proposals: [
    { repo: "agent-1", files: [], stats: {} },
    { repo: "agent-2", files: [], stats: {} },
    { repo: "agent-3", files: [], stats: {} },
    { repo: "agent-4", files: [], stats: {} },
    { repo: "agent-5", files: [], stats: {} },
  ],
  conflicts: [],
  landing: {},
};

// The event the ticker must retain in leg 3 (distinct repo so a wipe is visible).
const EVENT_A = { type: "push", repo: "agent-2", at: "2026-10-07T10:00:01Z" };

// Observer/driver module injected BEFORE app.js. It records fetch calls (wrapping, never
// replacing, window.fetch), clicks the real retry control, and serializes one observation
// object into #test-out for the dumped DOM. MODE selects the scenario.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x === u).length;
const q = (id) => document.getElementById(id);
document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (MODE === "core") {
      await sleep(700);
      R.c.bannerShown = q("connection-banner").hidden !== true;
      R.c.bannerCount = document.querySelectorAll("#connection-banner").length;
      R.c.bannerText = q("connection-banner-msg").textContent.trim();
      R.c.retryLabel = q("connection-banner-retry").textContent.trim();
      R.c.retryTag = q("connection-banner-retry").tagName;
      R.c.actionBannerHidden = q("action-banner").hidden === true;
      R.c.pulseStale = q("ticker-pulse").classList.contains("is-stale");
      R.c.tickerText = q("ticker-events").textContent.trim();
      R.c.syncBefore = q("last-sync-time").textContent.trim();
      R.c.syncClassBefore = q("last-sync-time").className;
      q("connection-banner-retry").click();
      await sleep(800);
      R.c.cards = document.querySelectorAll(".proposal-card").length;
      R.c.propsFetches = hits("/proposals");
      R.c.bannerHidden = q("connection-banner").hidden === true;
      R.c.syncAfter = q("last-sync-time").textContent.trim();
      R.c.syncClassAfter = q("last-sync-time").className;
      R.c.pulseStaleAfter = q("ticker-pulse").classList.contains("is-stale");
      await sleep(2200);
      R.c.tickerText2 = q("ticker-events").textContent.trim();
      R.c.actionBannerHidden2 = q("action-banner").hidden === true;
      R.c.bannerHidden2 = q("connection-banner").hidden === true;
      R.c.eventsFetches = hits("/events");
    } else if (MODE === "ticker") {
      const banner = q("connection-banner");
      R.c.bannerEverShown = banner.hidden !== true;
      new MutationObserver(() => { if (banner.hidden !== true) R.c.bannerEverShown = true; })
        .observe(banner, { attributes: true, attributeFilter: ["hidden"] });
      await sleep(2600);
      R.c.tickerText = q("ticker-events").textContent.trim();
      R.c.tickerRows = document.querySelectorAll("#ticker-events .ticker-event").length;
      R.c.pulseStale = q("ticker-pulse").classList.contains("is-stale");
      R.c.bannerHidden = q("connection-banner").hidden === true;
      R.c.actionBannerHidden = q("action-banner").hidden === true;
      R.c.cards = document.querySelectorAll(".proposal-card").length;
      R.c.eventsFetches = hits("/events");
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// The FR-6 contract for the failure leg (observations from the injected driver).
// ---------------------------------------------------------------------------
function coreContract(label, dom, obs) {
  if (!obs) {
    check(`${label} scenario output present (chrome + driver ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  check(`${label} failed /proposals surfaces the banner`, c.bannerShown === true, `hidden!=true read: ${c.bannerShown}`);
  check(`${label} exactly one connection banner element`, c.bannerCount === 1, `count=${c.bannerCount}`);
  check(`${label} banner copy exact '${EXPECTED_BANNER}'`, c.bannerText === EXPECTED_BANNER, JSON.stringify(c.bannerText));
  check(`${label} retry control is a BUTTON labeled 'Retry now'`, c.retryTag === "BUTTON" && c.retryLabel === "Retry now", `${c.retryTag}/${c.retryLabel}`);
  check(`${label} no second error surface (action banner hidden)`, c.actionBannerHidden === true);
  check(`${label} ticker pulse stale after the failed /events`, c.pulseStale === true);
  check(`${label} ticker retains its render through failure`, c.tickerText === TICKER_REST, JSON.stringify(c.tickerText));
  check(`${label} footer reads '${SYNC_REST}' before any success`, c.syncBefore === SYNC_REST, JSON.stringify(c.syncBefore));
  check(`${label} footer not error-styled before any success`, !ERROR_STYLED.test(c.syncClassBefore || ""), String(c.syncClassBefore));
  check(`${label} Retry now re-fetches /proposals`, c.propsFetches >= 2, `fetches=${c.propsFetches}`);
  check(`${label} banner hides on the retry success`, c.bannerHidden === true);
  check(`${label} footer reads 'synced HH:MM:SS' after success`, SYNC_OK.test(String(c.syncAfter)), JSON.stringify(c.syncAfter));
  check(`${label} footer not error-styled after success`, !ERROR_STYLED.test(c.syncClassAfter || ""), String(c.syncClassAfter));
  check(`${label} surface keeps rendering (cards present)`, typeof c.cards === "number" && c.cards >= 5, `cards=${c.cards}`);
  check(`${label} pulse stays stale while the ticker keeps failing`, c.pulseStaleAfter === true);
  check(`${label} ticker content retained across further failures`, c.tickerText2 === TICKER_REST, JSON.stringify(c.tickerText2));
  check(`${label} no error surface surfaces late (action banner still hidden)`, c.actionBannerHidden2 === true);
  check(`${label} ticker failure never surfaces the banner`, c.bannerHidden2 === true);
  check(`${label} ticker keeps polling after failure`, c.eventsFetches >= 3, `fetches=${c.eventsFetches}`);
  check(`${label} dom keeps exactly one connection banner element`, (dom.match(/id="connection-banner"/g) || []).length === 1);
}

// ---------------------------------------------------------------------------
// The FR-6 contract for the ticker-only degradation leg.
// ---------------------------------------------------------------------------
function tickerContract(label, dom, obs) {
  if (!obs) {
    check(`${label} scenario output present (chrome + driver ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  check(`${label} ticker rendered the event before the failure`, c.tickerRows >= 1 && c.tickerText.includes("push") && c.tickerText.includes("agent-2"), JSON.stringify(c.tickerText));
  check(`${label} ticker content retained after the failed /events`, (dom.match(/class="ticker-event"/g) || []).length >= 1 && dom.includes('class="event-repo">agent-2<'), "event rows in dumped DOM");
  check(`${label} ticker pulse stale after the failed /events`, c.pulseStale === true);
  check(`${label} ticker failure never surfaces the banner`, c.bannerEverShown === false && c.bannerHidden === true, `everShown=${c.bannerEverShown} hidden=${c.bannerHidden}`);
  check(`${label} no second error surface (action banner hidden)`, c.actionBannerHidden === true);
  check(`${label} surface keeps rendering (cards present)`, c.cards >= 5, `cards=${c.cards}`);
  check(`${label} ticker keeps polling after failure`, c.eventsFetches >= 2, `fetches=${c.eventsFetches}`);
}

// ---------------------------------------------------------------------------
// Loopback worker surface: mode selects what each fetch does.
// ---------------------------------------------------------------------------
let mode = "core";         // core | ticker | nojs
let payload = FIXTURE;     // /proposals body
let proposalsFailures = 1; // first N /proposals requests answered 500
let eventsMode = "fail";   // ok | fail | ok-then-fail
let proposalsServed = 0;
let eventsServed = 0;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    proposalsServed++;
    if (proposalsServed <= proposalsFailures) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: HARNESS_MSG }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }
  if (pathname === "/events") {
    eventsServed++;
    const failing = eventsMode === "fail" || (eventsMode === "ok-then-fail" && eventsServed > 1);
    if (failing) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "events-down" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [EVENT_A] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, judgments: [], skipped: [] }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(mode === "ticker" ? "ticker" : "core"));
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  if (mode === "nojs" && rel === "app.js") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (rel === "index.html") {
    const html = readFileSync(file, "utf8");
    const body = mode === "nojs" ? html : html.replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(body);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

const resetServer = (next) => {
  mode = next.mode;
  payload = next.payload ?? FIXTURE;
  proposalsFailures = next.proposalsFailures ?? 0;
  eventsMode = next.eventsMode ?? "fail";
  proposalsServed = 0;
  eventsServed = 0;
};

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // --- 1. at rest: the shipped fallback copy + "not synced yet", before any script -----
  try {
    resetServer({ mode: "nojs" });
    const dom = await dumpDom(url);
    check("1 banner ships hidden at rest", isHidden(dom, "connection-banner"), String(tagFor(dom, "connection-banner")));
    check("1 dom ships exactly one connection banner element", (dom.match(/id="connection-banner"/g) || []).length === 1);
    check("1 fallback copy ships: 'Disconnected from platform worker. Retrying...'", domValue(dom, "connection-banner-msg") === "Disconnected from platform worker. Retrying...", JSON.stringify(domValue(dom, "connection-banner-msg")));
    check("1 banner offers 'Retry now'", domValue(dom, "connection-banner-retry") === "Retry now", JSON.stringify(domValue(dom, "connection-banner-retry")));
    check("1 footer ships 'not synced yet'", domValue(dom, "last-sync-time") === SYNC_REST, JSON.stringify(domValue(dom, "last-sync-time")));
    check("1 footer ships without error styling", !ERROR_STYLED.test(classOf(dom, "last-sync-time") || ""), String(classOf(dom, "last-sync-time")));
  } catch (e) {
    check("1 at-rest case threw", false, String(e?.stack ?? e));
  }

  // --- 2. failed /proposals once + /events always: banner, retry, sync, silent ticker --
  try {
    resetServer({ mode: "core", proposalsFailures: 1, eventsMode: "fail" });
    const dom = await dumpDom(url);
    coreContract("2", dom, parseScenario(dom));
  } catch (e) {
    check("2 failure-surface case threw", false, String(e?.stack ?? e));
  }

  // --- 3. ticker-only failure: silent degradation, content retained --------------------
  try {
    resetServer({ mode: "ticker", proposalsFailures: 0, eventsMode: "ok-then-fail" });
    const dom = await dumpDom(url);
    tickerContract("3", dom, parseScenario(dom));
  } catch (e) {
    check("3 ticker-degradation case threw", false, String(e?.stack ?? e));
  }

  // --- 4. live capture: the order's check_cmd writes /proposals to a file --------------
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  4 live capture — PROPS_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      const props = Array.isArray(live?.proposals) ? live.proposals : [];
      check("4 live capture carries >= 5 proposals", props.length >= 5, `proposals=${props.length}`);
      resetServer({ mode: "core", payload: live, proposalsFailures: 1, eventsMode: "fail" });
      const dom = await dumpDom(url);
      coreContract("4", dom, parseScenario(dom));
    } catch (e) {
      check("4 live-capture case threw", false, String(e?.stack ?? e));
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
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
