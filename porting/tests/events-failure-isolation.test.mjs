#!/usr/bin/env bun
// Contract suite: FR-6b — /events failure isolation without disturbing the proposals surface.
// Run: bun porting/tests/events-failure-isolation.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is loaded
// in real headless Chrome over a loopback origin via CDP. The only scripted surface is the
// worker HTTP layer: /proposals always 200; /events serves real events for polls 1-2 then
// flips to 500 for poll 3+; /land, /judge, /merge are 200 stubs. An observer module injected
// BEFORE app.js wraps (never replaces) window.fetch and records observations. No module mocks,
// no source grep, no response-body tampering of product code.
//
// The scenario: /events succeeds twice (ticker renders), then fails. The app must:
//   - go stale (is-stale on ticker-pulse) but never throw
//   - retain the last rendered events in the ticker DOM
//   - never surface the connection-error banner (that belongs to /proposals only)
//   - never show an action banner
//   - keep proposal cards rendered (>= 5)
//   - keep polling /events after the failure (>= 3 fetches)
//   - keep polling /proposals on its 8s cadence (fetches after retry > fetches before)
//   - keep cards present after the /proposals reload still >= 5
//   - keep the connection banner hidden after the /proposals reload
//
// A box without a Chrome binary skips the suite (precedent: connection-error-surface).

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
 console.log("SKIP  FR-6b events-failure isolation — no Chrome binary on PATH (contract unverified in this environment)");
 process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-events-fail-"));

// --- Fixture: five proposals so `cards >= 5` is discriminative (same shape as connection-error-surface) ---
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

/* Events served on polls 1-2. Both use repo "agent-2" (matching the
   plan's assertion tickerText.includes("agent-2")) but distinct `at`/`after`
   so the composite key ${type}:${repo}:${at}:${after} genuinely differs —
   proving the ticker retained the last-successfully-fetched event. */
const EVENT_A = { type: "push", repo: "agent-2", at: "2026-10-07T10:00:01Z", after: "aaa001" };
const EVENT_B = { type: "push", repo: "agent-2", at: "2026-10-07T10:00:02Z", after: "bbb002" };

// Observer/driver injected BEFORE app.js. It wraps window.fetch (recording URLs + timestamps),
// uses a MutationObserver on #connection-banner for hidden transitions, and serializes
// observations into #test-out. The driver waits long enough for 2 success /events polls,
// then 1 failing poll, then observes the isolation state, then waits for a /proposals reload.
const clientScript = `const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { const s = performance.now(); R.f.push(String(u)); return of(u, o).then((r) => { r.__ts = performance.now() - s; return r; }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x === u).length;
const q = (id) => document.getElementById(id);

// MutationObserver: did the connection banner EVER become visible?
const banner = q("connection-banner");
let bannerEverShown = false;
const mo = new MutationObserver((_mut) => {
  try { if (banner.hidden !== true) bannerEverShown = true; } catch { /* */ }
});
mo.observe(banner, { attributes: true, attributeFilter: ["hidden"] });

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Phase 1: let /events succeed twice (polls 1-2), then fail (poll 3+).
    // The app polls /events every 2s, so wait 4.5s to capture 2 successes,
    // then another 2.5s for the 3rd (failing) poll to fire.
    await sleep(4500);
    // Phase 2: capture isolation observations after events have gone stale.
    R.c.pulseStale = q("ticker-pulse").classList.contains("is-stale");
    R.c.tickerRows = document.querySelectorAll("#ticker-events .ticker-event").length;
    R.c.tickerText = q("ticker-events").textContent.trim();
    R.c.bannerHidden = q("connection-banner").hidden === true;
    R.c.bannerEverShown = bannerEverShown;
    R.c.actionBannerHidden = q("action-banner").hidden === true;
    R.c.cards = document.querySelectorAll(".proposal-card").length;
    R.c.eventsFetches = hits("/events");
    R.c.propsFetches = hits("/proposals");

    // Phase 3: wait for a /proposals reload on its 8s cadence (after events failed).
    await sleep(9500);
    R.c.propsFetchesAfterRetry = hits("/proposals");
    R.c.cardsAfterRetry = document.querySelectorAll(".proposal-card").length;
    R.c.bannerStillHidden = q("connection-banner").hidden === true;
    R.c.eventsFetchesAfter = hits("/events");
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

const parseScenario = (dom) => {
 const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
 return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// --- Loopback worker surface ---
// /events: polls 1-2 succeed; poll 3+ returns 500.
// /proposals: always 200 with the 5-proposal fixture.
// /land, /judge, /merge: 200 stubs.
let eventsServed = 0;
let proposalsServed = 0;
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
 const { pathname } = new URL(req.url, "http://127.0.0.1");

 if (pathname === "/events") {
  eventsServed++;
  if (eventsServed <= 2) {
   res.writeHead(200, { "content-type": "application/json" });
   res.end(JSON.stringify({ ok: true, events: [eventsServed === 1 ? EVENT_A : EVENT_B] }));
   return;
  }
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "events-down" }));
  return;
 }

 if (pathname === "/proposals") {
  proposalsServed++;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(FIXTURE));
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
  res.end(clientScript);
  return;
 }

 const rel = pathname === "/" ? "index.html" : pathname.slice(1);
 const file = join(UI, rel);
 if (!file.startsWith(UI) || !existsSync(file)) {
  res.writeHead(404);
  res.end("not found");
  return;
 }

 if (rel === "index.html") {
  const html = readFileSync(file, "utf8");
  const body = html.replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(body);
  return;
 }

 res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
 res.end(readFileSync(file));
});

const launchChrome = () =>
 new Promise((resolve, reject) => {
  const chrome = spawn(
   CHROME,
   [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=1500,1400",
    "--remote-debugging-port=0",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
   ],
   { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  const timer = setTimeout(() => reject(new Error("Chrome did not announce a DevTools endpoint within 30s")), 30000);
  chrome.stderr.on("data", (d) => {
   stderr += d;
   const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
   if (m) {
    clearTimeout(timer);
    resolve({ wsUrl: m[1], kill: () => chrome.kill("SIGKILL") });
   }
  });
  chrome.on("error", (e) => { clearTimeout(timer); reject(e); });
  chrome.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early with code ${code}`)); });
 });

const connectCdp = (wsUrl) =>
 new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const send = (method, params = {}, sessionId) =>
   new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method}: CDP command timed out`)); }, 30000);
    pending.set(id, { res, rej, timer, method });
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
   });
  ws.addEventListener("open", () => resolve({ send, close: () => ws.close() }));
  ws.addEventListener("error", () => reject(new Error("CDP websocket failed to connect")));
  ws.addEventListener("message", (ev) => {
   const msg = JSON.parse(ev.data);
   if (typeof msg.id !== "number") return;
   const p = pending.get(msg.id);
   if (!p) return;
   pending.delete(msg.id);
   clearTimeout(p.timer);
   if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
   else p.res(msg.result);
  });
 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Contract for /events failure isolation ---
const eventsFailureContract = (label, obs) => {
 if (!obs) { check(`${label} scenario output present (chrome + driver ran)`, false, "no #test-out in DOM"); return; }
 if (obs.err) { check(`${label} scenario threw`, false, obs.err); return; }
 const c = obs.c || {};

 check(`${label} stale pulse after /events failure`, c.pulseStale === true, `pulseStale=${c.pulseStale}`);
 check(`${label} retained events in ticker DOM`, typeof c.tickerRows === "number" && c.tickerRows >= 1 && typeof c.tickerText === "string" && c.tickerText.includes("agent-2"), `rows=${c.tickerRows} text=${JSON.stringify(c.tickerText)}`);
 check(`${label} connectionError not surfaced (banner hidden, never shown)`, c.bannerHidden === true && c.bannerEverShown === false, `hidden=${c.bannerHidden} everShown=${c.bannerEverShown}`);
 check(`${label} no action banner after /events failure`, c.actionBannerHidden === true, `actionBannerHidden=${c.actionBannerHidden}`);
 check(`${label} proposalsData untouched — cards still present`, typeof c.cards === "number" && c.cards >= 5, `cards=${c.cards}`);
 check(`${label} ticker keeps polling after failure`, typeof c.eventsFetches === "number" && c.eventsFetches >= 3, `eventsFetches=${c.eventsFetches}`);
 check(`${label} proposals reloaded after events failure`, typeof c.propsFetchesAfterRetry === "number" && typeof c.propsFetches === "number" && c.propsFetchesAfterRetry > c.propsFetches, `before=${c.propsFetches} after=${c.propsFetchesAfterRetry}`);
 check(`${label} cards still present after proposals reload`, typeof c.cardsAfterRetry === "number" && c.cardsAfterRetry >= 5, `cardsAfterRetry=${c.cardsAfterRetry}`);
 check(`${label} connection banner still hidden after proposals reload`, c.bannerStillHidden === true, `bannerStillHidden=${c.bannerStillHidden}`);
};

let chrome = null;
try {
 const port = await new Promise((resolve, reject) => {
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
 });

 const { wsUrl, kill } = await launchChrome();
 chrome = { kill };
 const browser = await connectCdp(wsUrl);
 const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
 const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
 const send = (method, params = {}) => browser.send(method, params, sessionId);
 await send("Page.enable");
 await send("Runtime.enable");
 await send("Page.bringToFront");

 await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
 // Wait for the observer to finish its phases (~4.5s + 9.5s + buffer = ~16s)
 await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(undefined), 30000);
 });
 // Give the page extra time to reach #test-out via CDP evaluation
 let dom = await new Promise((resolve) => {
  const poll = async () => {
   try {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
    if (exceptionDetails) { /* */ }
    else if (result && result.value && result.value.includes('id="test-out"')) {
     resolve(result.value);
    }
   } catch { /* */ }
   setTimeout(poll, 500);
  };
  const guard = setTimeout(() => resolve("TIMEOUT"), 30000);
  poll();
 });

 if (typeof dom === "string" && dom !== "TIMEOUT") {
  const obs = parseScenario(dom);
  eventsFailureContract("events-failure-isolation", obs);
 } else {
  check("events-failure-isolation scenario output present (chrome + driver ran)", false, "timed out waiting for #test-out");
 }
} catch (e) {
 check("harness run", false, String((e && e.stack) || e));
} finally {
 try { if (chrome) chrome.kill(); } catch { /* */ }
 try { if (typeof server.close === "function") server.close(); } catch { /* */ }
 try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
