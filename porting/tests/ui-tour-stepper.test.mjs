#!/usr/bin/env bun
// Contract suite: the tour stepper — 10 tabs, progress fill, Next/Prev/Restart,
// and 360px horizontal scroll (nextgit-e9-verify-stepper-nav).
// Run: bun porting/tests/ui-tour-stepper.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (tour.html + tour.js + tour.css) is
// served from a loopback origin into real headless Chrome; every assertion reads
// the live DOM / computed style after real click()s (Runtime.evaluate +
// .click()), never a module mock or a source grep. The tour's only network call
// (step 6 loadRealProposals -> GET /proposals) is served by the loopback origin
// with a demo-shaped payload so the suite never leaves the box. Legs:
//   fixture — 10 .step-btn with exact labels, 10 .step-card panels, and the
//     progress/indicator/controls all present
//   tab-click — for N in 0..9: clicking .step-btn[data-step=N] activates
//     #step-N, marks the tab .is-active, and sets #progress-fill width to
//     (N+1)*10%
//   next-prev — Next reads "Next" at 0 and moves 0->1 (indicator "Step 2 of
//     10"); Prev moves 1->0 and is disabled at 0; at 9 Next reads "Finish
//     Tour" and the fill is 100%
//   restart — #btn-restart-tour returns to step 0, fill 10%, "Step 1 of 10"
//   narrow-scroll — at a 360px viewport #step-indicators scrolls horizontally
//     (scrollWidth > clientWidth, overflow-x auto), all 10 tabs remain, and
//     scrollLeft genuinely advances
// A box without a Chrome binary skips the suite (precedent: ui-grid-overflow /
// ui-first-load-panels); the order's acceptance gate hard-requires Chrome
// separately.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 350; // re-layout after a device-metrics override must settle before reads
const STEPS = 10;
const TAB_LABELS = [
  "0. Intro", "1. The Problem", "2. Workspaces", "3. Proposals", "4. Collisions",
  "5. Shipping", "6. Real Platform", "7. Exercise", "8. Scope", "9. Your Role",
];

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// Demo-shaped /proposals payload for step 6 ("Real Platform"): the tour fetches
// /proposals?base=demo and renders whatever it gets; a minimal ok-set keeps the
// leg hermetic without touching the deployed worker.
const PROPOSALS_FIXTURE = {
  ok: true,
  base: "demo",
  proposals: [
    {
      id: "demo-1",
      repo: "agent-1",
      title: "Demo proposal",
      head: "1a".repeat(20),
      base: "1b".repeat(20),
      status: "ready",
      secretType: null,
      conflictWith: null,
    },
  ],
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI tour stepper — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-tour-"));

// Loopback worker surface: the tour's one network call and the static UI app.
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...PROPOSALS_FIXTURE, base: searchParams.get("base") ?? "demo" }));
    return;
  }
  const file = join(UI, pathname === "/" ? "tour.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

let chrome = null;
let browser = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal CDP client: one browser websocket, flat sessions, command/response only.
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

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
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
    chrome.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  const wsUrl = await launchChrome();
  browser = await connectCdp(wsUrl);
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

  const waitFor = async (expression, timeout = 20000) => {
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

  // Real click: dispatches a trusted-ish click on the selector's first match.
  const click = async (selector) => {
    await evl(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await sleep(SETTLE_MS);
  };

  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${baseUrl}/tour.html` });
  await waitFor(`document.readyState === "complete" && location.origin === ${JSON.stringify(baseUrl)}`);
  await waitFor(`document.querySelectorAll(".step-btn").length === ${STEPS}`);
  await waitFor(`document.querySelectorAll(".step-card").length === ${STEPS}`);

  // Leg 1 — fixture
  const fixtureState = await evl(`(() => {
    const labels = [...document.querySelectorAll(".step-btn")].map((b) => b.textContent.trim());
    return {
      tabCount: labels.length,
      labels,
      cardCount: document.querySelectorAll(".step-card").length,
      hasFill: !!document.getElementById("progress-fill"),
      hasDisplay: !!document.getElementById("step-display-indicator"),
      hasPrev: !!document.getElementById("btn-prev"),
      hasNext: !!document.getElementById("btn-next"),
      hasRestart: !!document.getElementById("btn-restart-tour"),
    };
  })()`);
  check(
    "fixture renders 10 tabs with the exact 0..9 labels",
    fixtureState &&
    fixtureState.tabCount === STEPS &&
    JSON.stringify(fixtureState.labels) === JSON.stringify(TAB_LABELS),
    JSON.stringify(fixtureState),
  );
  check(
    "fixture renders 10 .step-card panels",
    fixtureState && fixtureState.cardCount === STEPS,
    `cards=${fixtureState && fixtureState.cardCount}`,
  );
  check(
    "fixture exposes progress fill, indicator, and Prev/Next/Restart controls",
    fixtureState &&
    fixtureState.hasFill &&
    fixtureState.hasDisplay &&
    fixtureState.hasPrev &&
    fixtureState.hasNext &&
    fixtureState.hasRestart,
    JSON.stringify(fixtureState),
  );

  // Leg 2 — tab-click: click tab N -> #step-N active, tab N active, fill (N+1)*10%
  for (let n = 0; n < STEPS; n++) {
    await click(`.step-btn[data-step="${n}"]`);
    const state = await evl(`(() => {
      const card = document.querySelector(".step-card.is-active");
      const tab = document.querySelector(".step-btn.is-active");
      const fill = document.getElementById("progress-fill");
      return {
        card: card ? card.id : null,
        tab: tab ? tab.getAttribute("data-step") : null,
        fillWidth: fill ? fill.style.width : null,
      };
    })()`);
    const expected = `${(n + 1) * 10}%`;
    check(
      `tab-click ${n}: clicking .step-btn[data-step=${n}] activates #step-${n}, the tab, and fills ${expected}`,
      state && state.card === `step-${n}` && state.tab === String(n) && state.fillWidth === expected,
      JSON.stringify(state),
    );
  }

  // Leg 3 — next-prev
  await click("#btn-restart-tour");
  const nextLabelAt0 = await evl(`document.getElementById("btn-next").textContent.trim()`);
  await click("#btn-next");
  const afterNext = await evl(`(() => ({
    card: document.querySelector(".step-card.is-active")?.id ?? null,
    display: document.getElementById("step-display-indicator").textContent.trim(),
  }))()`);
  await click("#btn-prev");
  const afterPrev = await evl(`(() => ({
    card: document.querySelector(".step-card.is-active")?.id ?? null,
    prevDisabled: document.getElementById("btn-prev").disabled,
  }))()`);
  for (let i = 0; i < STEPS - 1; i++) await click("#btn-next");
  const at9 = await evl(`(() => ({
    next: document.getElementById("btn-next").textContent.trim(),
    card: document.querySelector(".step-card.is-active")?.id ?? null,
    fill: document.getElementById("progress-fill").style.width,
  }))()`);

  check("Next reads 'Next' at step 0", nextLabelAt0 === "Next", `was "${nextLabelAt0}"`);
  check("Next moves step 0 -> 1", afterNext && afterNext.card === "step-1", JSON.stringify(afterNext));
  check("indicator reads 'Step 2 of 10' after Next", afterNext && afterNext.display === "Step 2 of 10", JSON.stringify(afterNext));
  check("Prev moves step 1 -> 0", afterPrev && afterPrev.card === "step-0", JSON.stringify(afterPrev));
  check("Prev is disabled at step 0", afterPrev && afterPrev.prevDisabled === true, JSON.stringify(afterPrev));
  check("Next reads 'Finish Tour' on step 9", at9 && at9.next === "Finish Tour", `was "${at9 && at9.next}"`);
  check("step 9 panel is active after walking Next to the end", at9 && at9.card === "step-9", JSON.stringify(at9));
  check("progress fill is 100% on step 9", at9 && at9.fill === "100%", `was "${at9 && at9.fill}"`);

  // Leg 4 — restart
  await click("#btn-restart-tour");
  const afterRestart = await evl(`(() => ({
    card: document.querySelector(".step-card.is-active")?.id ?? null,
    fill: document.getElementById("progress-fill").style.width,
    display: document.getElementById("step-display-indicator").textContent.trim(),
  }))()`);
  check("Restart returns to step 0", afterRestart && afterRestart.card === "step-0", JSON.stringify(afterRestart));
  check("progress fill is 10% after Restart", afterRestart && afterRestart.fill === "10%", JSON.stringify(afterRestart));
  check("indicator reads 'Step 1 of 10' after Restart", afterRestart && afterRestart.display === "Step 1 of 10", JSON.stringify(afterRestart));

  // Leg 5 — narrow-scroll at 360px
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(SETTLE_MS);
  const narrow = await evl(`(() => {
    const el = document.getElementById("step-indicators");
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
      tabCount: document.querySelectorAll(".step-btn").length,
    };
  })()`);
  check(
    "360px: #step-indicators overflows (scrollWidth > clientWidth)",
    narrow && narrow.scrollWidth > narrow.clientWidth,
    `scrollWidth=${narrow && narrow.scrollWidth} clientWidth=${narrow && narrow.clientWidth}`,
  );
  check(
    "360px: #step-indicators scrolls horizontally (overflow-x: auto)",
    narrow && narrow.overflowX === "auto",
    `was "${narrow && narrow.overflowX}"`,
  );
  check(
    "360px: all 10 tabs remain present",
    narrow && narrow.tabCount === STEPS,
    `found ${narrow && narrow.tabCount}`,
  );
  const maxScrollLeft = await evl(`(() => {
    const el = document.getElementById("step-indicators");
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  })()`);
  check(
    "360px: the stepper content genuinely scrolls (scrollLeft advances)",
    typeof maxScrollLeft === "number" && maxScrollLeft > 0,
    `max scrollLeft=${maxScrollLeft}`,
  );
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
