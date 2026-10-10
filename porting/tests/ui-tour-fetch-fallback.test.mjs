#!/usr/bin/env bun
// Contract suite: tour fetch-degradation — offline fallback (work order
// nextgit-e9-verify-fetch-fallback / FR-38 consequence 1).
// Run: bun porting/tests/ui-tour-fetch-fallback.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (tour.html + tour.js + tour.css)
// is loaded in a real headless Chrome over a loopback origin. The only
// scripted pieces are network interception (every /proposals* request is
// aborted at the network layer via CDP Fetch interception — the offline
// condition: zero egress, zero live-worker dependency, deterministic even if
// the live worker ever adds Access-Control-Allow-Origin) and an observer
// injected BEFORE tour.js that wraps console.warn and captures window error
// events before the product code runs — no module mocks, no source grep.
// The shipped loadRealProposals() runs for real, its fetch fails, and it
// must take the shipped catch path.
//
// The fallback contract (platform/ui/tour.js:456-471):
//   catch path: console.warn("Could not fetch live proposals, using
//   fallback snapshot:", err); state.realProposals = fallbackProposals;
//   el.liveStatus.className = "callout callout-warn"; innerHTML announces
//   "Offline Fallback Snapshot"; then renderRealProposalsCards().
// The fallback fixture (tour.js:30-59): 4 proposals — agent-1/agent-2
// collide on src/auth.ts, agent-3 has landed, agent-4 is clean.
//
// Checks (each an observable contract, each fails loudly on a plausible
// regression):
//   1. exactly one console warning containing "Could not fetch live
//      proposals, using fallback snapshot"
//   2. #live-proposals-status className contains callout-warn and NOT
//      callout-danger; text contains "Offline Fallback Snapshot"
//   3. exactly 4 .live-tour-card in #live-proposals-grid
//   4. annotation counts: 2x "Collides on src/auth.ts",
//      1x "Already shipped to main", 1x "Clean & ready to ship"
//   5. zero uncaught page errors (window error listener + Chrome stderr scan)
//   6. #step-7.is-active present after clicking #btn-next — the tour
//      continues past the failed fetch instead of stalling
//   7. hermeticity: the offline condition is client-side — zero loopback
//      /proposals requests reach this server, because CDP Fetch interception
//      aborts the cross-origin fetch before it leaves the browser
// A box without a Chrome binary skips the suite (precedent: ui-diff-viewer-states).
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
  console.log("SKIP  tour fetch-fallback — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-tourfallback-"));

let chrome = null;
let browser = null;
let chromeStderr = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
// CDP mode (remote debugging + websocket), not --dump-dom: the offline
// condition needs request-level interception, which only a live DevTools
// session provides.
const launchChrome = () =>
  new Promise((resolve, reject) => {
    chrome = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1100,900",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const timer = setTimeout(() => reject(new Error("Chrome did not announce a DevTools endpoint within 30s")), 30000);
    chrome.stderr.on("data", (d) => {
      chromeStderr += d;
      const m = chromeStderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });

// Minimal CDP client: one browser websocket, flat sessions, command/response
// plus event forwarding (Fetch.requestPaused → the harness handler map).
const connectCdp = (wsUrl, onEvent) =>
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
      if (typeof msg.id === "number") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
        else p.res(msg.result);
        return;
      }
      // Event (method-bearing, no id) — e.g. Fetch.requestPaused.
      if (typeof msg.method === "string" && onEvent) onEvent(msg.method, msg.params, msg.sessionId);
    });
  });

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE tour.js. Wraps console.warn and captures
// window error events so the fallback path's warning and any uncaught error
// are captured, waits for the fallback grid to render, clicks #btn-next, then
// reads the real rendered DOM for the status callout, the card grid, and the
// annotation classes. Emits #test-out with structured observations.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { warnings: [], errors: [], fallback: null, afterNext: null };
// Wrap console.warn BEFORE tour.js loads so the fallback warning is captured.
const __origWarn = console.warn.bind(console);
console.warn = function (...args) {
  try { R.warnings.push(args.map((a) => (typeof a === "string" ? a : a && a.message != null ? a.message : JSON.stringify(a))).join(" ")); } catch (e) {}
  return __origWarn.apply(console, args);
};
// Capture uncaught errors for the zero-page-errors contract.
window.addEventListener("error", function (e) { try { R.errors.push(String(e.message || e.type)); } catch (e) {} });
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for the fallback grid to render (or time out — the fetch is
    // aborted, so the catch path must render within a few seconds).
    for (let i = 0; i < 200 && !document.querySelector("#live-proposals-grid .live-tour-card"); i++) {
      await sleep(50);
    }
    const status = document.getElementById("live-proposals-status");
    const grid = document.getElementById("live-proposals-grid");
    R.fallback = {
      statusClass: status ? (status.className || "") : null,
      statusText: status ? status.textContent.replace(/\\s+/g, " ").trim() : null,
      cardCount: grid ? grid.querySelectorAll(".live-tour-card").length : 0,
      annotations: grid ? [...grid.querySelectorAll(".live-card-annotation")].map((a) => a.textContent.trim()) : [],
    };
    // Prove the tour continues past the failed fetch. The stepper advances
    // one step per click, so jump to step 6 via its stepper tab (the same
    // tab the order's live check clicks), then click Next to reach step 7.
    const step6Tab = document.querySelector('.step-btn[data-step="6"]');
    if (step6Tab) step6Tab.click();
    await sleep(150);
    const next = document.getElementById("btn-next");
    if (next) next.click();
    await sleep(150);
    const step7 = document.getElementById("step-7");
    R.afterNext = {
      step7Active: !!(step7 && step7.classList.contains("is-active")),
      quizOptionCount: document.querySelectorAll(".quiz-option-btn").length,
    };
  } catch (e) { R.errors.push(String((e && e.stack) || e)); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface: serves the shipped tour files and injects the
// observer before tour.js. The offline condition is client-side: CDP Fetch
// interception aborts every /proposals* request at the network layer before
// it leaves the browser — so no /proposals request ever reaches this server
// (the counter below must stay 0; that is the hermeticity assertion).
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let proposalsHits = 0;

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname.includes("/proposals")) proposalsHits++; // must stay 0 — interception precedes the server
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
    res.end(readFileSync(file, "utf8").replace(TOUR_TAG, `<script type="module" src="/__client.js"></script>` + TOUR_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs
// ---------------------------------------------------------------------------

function legHermetic(loopbackHits, aborts) {
  check("7 offline condition is client-side (zero loopback /proposals hits)", loopbackHits === 0, `loopbackProposalsHits=${loopbackHits}`);
  check("7 the live /proposals* fetch was aborted via CDP Fetch interception", aborts >= 1, `fetchAborts=${aborts}`);
}

function legWarnings(R) {
  const wanted = R.warnings.filter((w) => w.includes("Could not fetch live proposals, using fallback snapshot"));
  check("1 exactly one console warning on fetch failure", wanted.length === 1, `warnings=${JSON.stringify(R.warnings)}`);
}

function legCallout(R) {
  const cls = R.fallback?.statusClass ?? "";
  const text = R.fallback?.statusText ?? "";
  check("2 status is a warning callout (callout-warn, not callout-danger)",
    cls.includes("callout-warn") && !cls.includes("callout-danger"), `class=${JSON.stringify(cls)}`);
  check("2 status announces the Offline Fallback Snapshot",
    text.includes("Offline Fallback Snapshot"), `text=${JSON.stringify(text)}`);
}

function legCards(R) {
  check("3 fallback snapshot renders exactly 4 cards", R.fallback?.cardCount === 4, `count=${R.fallback?.cardCount}`);
}

function legAnnotations(R) {
  const anns = R.fallback?.annotations ?? [];
  const collides = anns.filter((a) => a.includes("Collides on src/auth.ts")).length;
  const landed = anns.filter((a) => a.includes("Already shipped to main")).length;
  const clean = anns.filter((a) => a.includes("Clean & ready to ship")).length;
  check("4 fallback annotates 2 collisions on src/auth.ts", collides === 2, `collides=${collides}`);
  check("4 fallback annotates the landed change", landed === 1, `landed=${landed}`);
  check("4 fallback annotates a clean addition", clean === 1, `clean=${clean}`);
}

function legNoErrors(R) {
  // The window error listener (in the injected observer) is the authoritative
  // page-error signal; the Chrome stderr scan is a conservative backstop.
  check("5 zero uncaught page errors (observer)", R.errors.length === 0, `errors=${JSON.stringify(R.errors)}`);
  const stderrBad = /(?:Uncaught|ReferenceError|SyntaxError|TypeError)\b/i.test(chromeStderr ?? "");
  check("5 zero uncaught errors in Chrome stderr", !stderrBad, `stderr~=${(chromeStderr ?? "").slice(0, 160)}`);
}

function legTourContinues(R) {
  check("6 tour advances to step 7 after the fallback", R.afterNext?.step7Active === true, `afterNext=${JSON.stringify(R.afterNext)}`);
  check("6 step 7 quiz renders 4 options", R.afterNext?.quizOptionCount === 4, `quizOptions=${R.afterNext?.quizOptionCount}`);
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  // The offline condition: every /proposals* request is paused by the CDP
  // Fetch domain and failed at the network layer, so the shipped
  // loadRealProposals() fetch to the hardcoded live-worker URL rejects
  // deterministically ("Failed to fetch") — offline, zero egress, and with no
  // dependence on the live worker's CORS headers (a future
  // Access-Control-Allow-Origin: * on the worker cannot flip this suite red).
  const offlineAborts = { count: 0 };
  const wsUrl = await launchChrome();
  browser = await connectCdp(wsUrl, (method, params, sessionId) => {
    if (method !== "Fetch.requestPaused" || !sessionId) return;
    offlineAborts.count++;
    browser.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => { });
  });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => browser.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*proposals*" }] });
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  const evl = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text || "Runtime.evaluate threw");
    return result.value;
  };

  const waitFor = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    for (; ;) {
      let ok = false;
      try {
        ok = await evl(`Boolean(${expression})`);
      } catch {
        ok = false; // execution context destroyed mid-navigation — keep polling
      }
      if (ok) return;
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
      await sleep(100);
    }
  };

  await send("Page.navigate", { url: `${baseUrl}/` });
  // The observer/driver appends #test-out after the fallback renders and the
  // tour advances past it (worst case ~11s of in-page settling).
  await waitFor(`document.getElementById("test-out")`);

  const raw = await evl(`document.getElementById("test-out").textContent`);
  const R = raw ? JSON.parse(decodeURIComponent(raw)) : null;
  if (!R) {
    check("harness: observer output present", false, "no #test-out in rendered DOM");
  } else if (R.errors.length && !R.fallback) {
    check("harness: observer ran without throwing", false, R.errors.join(" | "));
  } else {
    legHermetic(proposalsHits, offlineAborts.count);
    legWarnings(R);
    legCallout(R);
    legCards(R);
    legAnnotations(R);
    legNoErrors(R);
    legTourContinues(R);
  }
} catch (e) {
  check("harness setup failed", false, String(e?.message ?? e));
} finally {
  if (browser) browser.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGKILL");
    await Promise.race([exited, sleep(3000)]);
  }
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
