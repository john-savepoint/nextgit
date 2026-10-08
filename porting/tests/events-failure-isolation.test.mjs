#!/usr/bin/env bun
// Contract suite: NFR-4 / events-failure-isolation — /events failure must
// degrade the ticker to a stale pulse WITHOUT wiping retained events or
// corrupting the proposals UI; periodic /events polling must continue and
// /proposals must remain unaffected.
//
// Run: bun porting/tests/events-failure-isolation.test.mjs  (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js)
// is loaded in real headless Chrome over a loopback origin. The only scripted
// surface is the worker HTTP layer — /proposals always 200 (5-proposal fixture);
// /events poll 1-2 = 200 (distinct repos so app.js sees a key change + debounce),
// poll 3+ = 500; /judge 503. An observer module is injected BEFORE app.js that
// wraps (never replaces) window.fetch, recording each fetch URL + timestamp.
// No module mocks, no source grep, no response-body tampering.
//
// A box without a Chrome binary skips the suite (precedent: ui-auto-refresh-cycle;
// the order's acceptance gate hard-requires Chrome separately).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

// 5-proposal fixture so the "cards >= 5" contract has teeth.
const BASE_HEAD = "1a".repeat(20);
const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 5, sharedFiles: 0, conflictingPairs: 0, changedFiles: 5, cleanPairs: 0 },
  proposals: [
    { repo: "agent-1", head: "2b".repeat(20), intent: "harden auth", landing: { status: "ready" }, stats: { files: 1, additions: 3, deletions: 1 }, files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }] },
    { repo: "agent-2", head: "3c".repeat(20), intent: "docs baseline", landing: { status: "ready" }, stats: { files: 1, additions: 1, deletions: 0 }, files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }] },
    { repo: "agent-3", head: "4d".repeat(20), intent: "refactor utils", landing: { status: "ready" }, stats: { files: 2, additions: 5, deletions: 2 }, files: [{ path: "src/utils.ts", status: "modified", additions: 3, deletions: 1, secret: false }, { path: "src/types.ts", status: "modified", additions: 2, deletions: 1, secret: false }] },
    { repo: "agent-4", head: "5e".repeat(20), intent: "fix race", landing: { status: "ready" }, stats: { files: 1, additions: 2, deletions: 1 }, files: [{ path: "src/race.ts", status: "modified", additions: 2, deletions: 1, secret: false }] },
    { repo: "agent-5", head: "6f".repeat(20), intent: "type safety", landing: { status: "ready" }, stats: { files: 1, additions: 4, deletions: 0 }, files: [{ path: "src/types.ts", status: "modified", additions: 4, deletions: 0, secret: false }] },
  ],
  conflicts: [],
  landing: {},
};

let fails = 0;
let cases = 0;
const check = (name, ok, detail = "") => {
  cases++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  NFR-4 events-failure-isolation — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(77); // POSIX skip: Chrome absent, not a failure
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-efiso-"));
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// Observer + driver injected BEFORE app.js. Records fetch URL + timestamp into
// R.f; waits for /events to fail (poll 3+ = 500), then snapshots DOM state and
// forces a /proposals reload to prove the proposals UI survives /events failure.
const makeClientScript = () => `
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push([String(u), performance.now()]); return of(u, o); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x[0] === u).length;
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Initial settle: init() calls loadEvents() synchronously, then 2s tick fires.
    // /events poll 1 (init) + poll 2 (2s tick) both succeed; poll 3+ (4s+ tick) fails.
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (hits("/events") >= 3) { clearInterval(iv); res(); }
      }, 200);
      setTimeout(() => { clearInterval(iv); res(); }, 12000);
    });
    await sleep(3000); // let the 500s propagate through a couple tick cycles
    // Snapshot DOM after events failure has been observed
    R.c.pulseClass = document.getElementById("ticker-pulse")?.className || "";
    R.c.pulseHasStale = !!document.getElementById("ticker-pulse")?.classList.contains("is-stale");
    const tickerEvents = document.getElementById("ticker-events");
    R.c.tickerHtml = tickerEvents ? tickerEvents.innerHTML : null;
    R.c.connectionBannerVisible = !document.getElementById("connection-banner")?.hasAttribute("hidden");
    R.c.actionBannerVisible = !document.getElementById("action-banner")?.hasAttribute("hidden");
    R.c.cardCountBefore = document.querySelectorAll("#proposals-grid .proposal-card").length;
    R.c.eventsFetchesBeforeFailure = hits("/events");
    R.c.proposalsFetchesBeforeFailure = hits("/proposals");
    R.c.tickerEmptyBefore = (R.c.tickerHtml || "").includes("ticker-empty");

    // Force a /proposals reload to prove the proposals UI is unaffected by /events failure
    document.getElementById("btn-manual-refresh")?.click();
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (hits("/proposals") > R.c.proposalsFetchesBeforeFailure) { clearInterval(iv); res(); }
      }, 200);
      setTimeout(() => { clearInterval(iv); res(); }, 5000);
    });
    await sleep(1000); // let render settle

    // Post-reload snapshot
    R.c.cardCountAfter = document.querySelectorAll("#proposals-grid .proposal-card").length;
    R.c.proposalsFetchesAfterFailure = hits("/proposals");
    R.c.eventsFetchesAfterFailure = hits("/events");
    R.c.connectionBannerVisibleAfter = !document.getElementById("connection-banner")?.hasAttribute("hidden");
    R.c.tickerHtmlAfter = document.getElementById("ticker-events") ? document.getElementById("ticker-events").innerHTML : null;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});
`;

const parseScenario = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// Loopback worker surface: /proposals always 200 + FIXTURE; /events poll 1-2 =
// 200, poll 3+ = 500.
let eventsPoll = 0;
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(FIXTURE));
    return;
  }
  if (pathname === "/events") {
    eventsPoll++;
    if (eventsPoll <= 2) {
      const ev = eventsPoll === 1
        ? { type: "push", repo: "agent-1", at: "2026-10-07T10:00:01Z", after: "aaa001" }
        : { type: "push", repo: "agent-2", at: "2026-10-07T10:00:02Z", after: "bbb002" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, events: [ev] }));
    } else {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "events service degraded" }));
    }
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "judge unavailable in fixture" }));
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(makeClientScript());
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (rel.indexOf("..") >= 0 || !file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = extname(file);
  if (ext === ".html") {
    const html = readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>\n${APP_TAG}`);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[ext] || "text/plain" });
  res.end(readFileSync(file));
});

let chrome = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const launchChrome = () =>
  new Promise((resolve, reject) => {
    chrome = spawn(
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
        resolve(m[1]);
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
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`${method}: CDP command timed out`));
        }, 30000);
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

const contract = (obs) => {
  if (!obs) { check("scenario output present (chrome + driver ran)", false, "no #test-out"); return; }
  if (obs.err) { check("scenario threw", false, obs.err); return; }
  const c = obs.c || {};

  // ---- 1. Stale pulse: ticker-pulse gains is-stale class on /events failure ----
  check("1 stale pulse: ticker-pulse has is-stale class", c.pulseHasStale === true, `pulseClass="${c.pulseClass}"`);

  // ---- 2. Retained events in DOM: ticker still shows the last-seen events ----
  check("2 retained events: ticker-events not empty after failure", c.tickerHtml !== null && !c.tickerEmptyBefore && c.tickerHtml.length > 0, `tickerHtml="${String(c.tickerHtml).slice(0, 100)}"`);

  // ---- 3. No connection banner: /events failure does not surface as connection error ----
  check("3 no connection banner visible", c.connectionBannerVisible === false, `hidden=${c.connectionBannerVisible}`);

  // ---- 4. No action banner: /events failure does not surface an action banner ----
  check("4 no action banner visible", c.actionBannerVisible === false, `hidden=${c.actionBannerVisible}`);

  // ---- 5. Cards >= 5: proposals UI renders fully despite /events failure ----
  check("5 cards >= 5 (proposals UI unaffected by /events failure)", c.cardCountBefore >= 5, `cards=${c.cardCountBefore}`);

  // ---- 6. /events keeps polling: at least 3 /events fetches (polls continue past failure) ----
  check("6 /events keeps polling >= 3 fetches", (obs.f || []).filter((x) => x[0] === "/events").length >= 3, `eventsFetches=${(obs.f || []).filter((x) => x[0] === "/events").length}`);

  // ---- 7. /proposals count increments after failure (manual refresh succeeds) ----
  check("7 /proposals fetch count incremented after failure", c.proposalsFetchesAfterFailure > c.proposalsFetchesBeforeFailure, `before=${c.proposalsFetchesBeforeFailure} after=${c.proposalsFetchesAfterFailure}`);

  // ---- 8. Cards >= 5 after reload: proposals UI still renders after failure ----
  check("8 cards >= 5 after reload post-failure", c.cardCountAfter >= 5, `before=${c.cardCountBefore} after=${c.cardCountAfter}`);

  // ---- 9. Banner still hidden after reload: clean state persists ----
  check("9 connection banner still hidden after reload post-failure", c.connectionBannerVisibleAfter === false, `hidden=${c.connectionBannerVisibleAfter}`);
};

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });

  const wsUrl = await launchChrome();
  const browser = await connectCdp(wsUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => browser.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");

  const evl = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text || "Runtime.evaluate threw");
    return result.value;
  };

  const waitFor = async (expression, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    for (; ;) {
      let ok = false;
      try {
        ok = await evl(`Boolean(${expression})`);
      } catch {
        ok = false;
      }
      if (ok) return;
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
      await sleep(100);
    }
  };

  await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
  await waitFor(`document.getElementById("test-out") !== null`, 45000);
  const dom = await evl("document.documentElement.outerHTML");
  const obs = parseScenario(dom);
  if (process.env.DEBUG) console.error("DEBUG obs =", JSON.stringify(obs));
  contract(obs);
} catch (e) {
  check("harness run", false, String((e && e.stack) || e));
} finally {
  try { if (chrome) chrome.kill("SIGKILL"); } catch { /* */ }
  try { if (typeof server.close === "function") server.close(); } catch { /* */ }
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
