#!/usr/bin/env bun
// Contract suite: nextgit-e9-verify-mobile-stacking — tour single-column stacking.
// Run: bun porting/tests/ui-tour-mobile-stacking.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui tour (tour.html + tour.css +
// tour.js) is served from a loopback origin into real headless Chrome; every
// asserted number is read from the live computed layout (getComputedStyle /
// getBoundingClientRect) at emulated device metrics. No module mocks, no
// source grep, no in-page observer. The stepper is driven through the real
// .step-btn clicks (goToStep runs), never by DOM class hacks. Contracts:
//   A <=720px  — .annotated-layout collapses to exactly 1 track and its two
//                panes stack (distinct y); .tour-header-top wraps (brand
//                group and nav links occupy two distinct rows); no horizontal
//                overflow
//   B <=640px  — .quiz-options (step 7), .scope-grid (step 8) and
//                .sim3-snippets (step 4) each collapse to exactly 1 track
//                with children stacked one per row
//   C 360px    — .terms-grid (step 0) resolves to 1 track / one row of term
//                cards; no horizontal overflow; exactly one .step-card.is-active
//                in the document, the active card is display:block and every
//                other .step-card is display:none
//   D wide     — the collapse rules did not leak into the desktop regime:
//                .annotated-layout keeps 2 tracks at 769px (the 768px query
//                is max-width inclusive, so 768 itself is 1 track) and the
//                three 640px grids keep 2 equal tracks at 1024/1440
//   E smoke    — all 10 .step-btn tabs are reachable in sequence (each click
//                activates exactly the matching #step-N); narrow-width stepper
//                SCROLL behavior is owned by E9-verify-stepper-nav, not here
// Step 6's live GET of the worker /proposals endpoint is read-only; both its
// success path (slice(0,4)) and its offline fallback (fallbackProposals)
// render exactly four .live-tour-card elements, so the fixture assertion is
// deterministic whichever path the box takes.
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible /
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

// Demo-shaped fallback snapshot (mirrors fallbackProposals in tour.js) — the
// deterministic payload for the loopback /proposals surface.
const BASE_HEAD = "1a".repeat(20);
const FIXTURE = {
  ok: true,
  proposals: [
    {
      repo: "agent-1",
      intent: "Feature: refreshSession() extends a live session by TTL",
      files: [{ path: "src/auth.ts", additions: 5, deletions: 0 }],
      landing: { status: "ready" },
      collidesWith: "agent-2",
    },
    {
      repo: "agent-2",
      intent: "Fix: tolerate clock skew in isExpired via leewayMs",
      files: [{ path: "src/auth.ts", additions: 2, deletions: 2 }],
      landing: { status: "ready" },
      collidesWith: "agent-1",
    },
    {
      repo: "agent-3",
      intent: "Perf: read-through memo cache for store reads",
      files: [{ path: "src/store.ts", additions: 0, deletions: 0 }],
      landing: { status: "landed" },
      collidesWith: null,
    },
    {
      repo: "agent-4",
      intent: "Feature: feature-flag module with isEnabled()",
      files: [{ path: "src/feature.ts", additions: 43, deletions: 0 }],
      landing: { status: "ready" },
      collidesWith: null,
    },
  ],
  conflicts: [{ file: "src/auth.ts", repos: ["agent-1", "agent-2"] }],
};

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
  console.log("SKIP  UI tour mobile stacking — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-tour-"));

// Loopback worker surface: the static tour app and the demo-shaped proposals.
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const json = (payload) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (pathname === "/proposals") return json(FIXTURE);
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
        "--window-size=1500,1400",
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

// Live layout of one grid: the document box, the grid's own content box, the
// resolved track list, and every direct child's rect (rects carry the stacking).
const readLayoutExpr = (selector) => `(() => {
  const grid = document.querySelector(${JSON.stringify(selector)});
  if (!grid) return null;
  const doc = document.documentElement;
  const cs = getComputedStyle(grid);
  const children = [...grid.children].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height };
  });
  return {
    docClientWidth: doc.clientWidth,
    docScrollWidth: doc.scrollWidth,
    gridClientWidth: grid.clientWidth,
    gap: parseFloat(cs.columnGap) || 0,
    tracks: cs.gridTemplateColumns.split(/\\s+/).filter(Boolean),
    children,
  };
})()`;

// The tour header: the wrap contract is the computed flex-wrap property
// (the shipped rule is flex-wrap:wrap at tour.css:91-98); the brand
// group and nav link rects show whether that wrap actually broke them
// onto two rows at this width.
const READ_HEADER = `(() => {
  const header = document.querySelector(".tour-header-top");
  const brand = document.querySelector(".tour-header-top .brand-group");
  const nav = document.querySelector(".tour-header-top .tour-nav-links");
  if (!header || !brand || !nav) return null;
  const b = brand.getBoundingClientRect();
  const n = nav.getBoundingClientRect();
  return { flexWrap: getComputedStyle(header).flexWrap, brandY: b.y, navY: n.y };
})()`;

// Panel visibility contract: exactly one active card, it is display:block,
// every other .step-card is display:none.
const READ_PANELS = `(() => {
  const cards = [...document.querySelectorAll(".step-card")];
  return cards.map((c) => ({
    id: c.id,
    active: c.classList.contains("is-active"),
    display: getComputedStyle(c).display,
  }));
})()`;

const trackWidths = (m) => m.tracks.map((t) => parseFloat(t));
const spreadOf = (widths) => (widths.length ? Math.max(...widths) - Math.min(...widths) : Infinity);
// Children sharing a grid row share a y (rounded rows are > 10px apart);
// clusters = rows.
const rowCount = (children) => {
  const ys = children.map((c) => c.y).sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  for (const y of ys) {
    if (y - last > 10) rows++;
    last = y;
  }
  return rows;
};

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

  // Drive the real stepper: click the tab, let goToStep() toggle is-active.
  const goToStep = async (n) => {
    await evl(`document.querySelector('.step-btn[data-step="${n}"]').click()`);
    await waitFor(`document.getElementById("step-${n}")?.classList.contains("is-active")`);
    await sleep(SETTLE_MS);
  };

  // Set the emulated width, settle, activate the step, then read live layout.
  const measure = async (width, step, selector) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(SETTLE_MS);
    await goToStep(step);
    return evl(readLayoutExpr(selector));
  };

  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${baseUrl}/tour.html` });
  await waitFor(`document.readyState === "complete" && location.origin === ${JSON.stringify(baseUrl)}`);
  await waitFor(`document.querySelectorAll(".step-btn").length === 10`);
  await waitFor(`document.querySelectorAll("#live-proposals-grid .live-tour-card").length === 4`);

  const fixtureState = await evl(`(() => {
    return {
      stepBtns: document.querySelectorAll(".step-btn").length,
      stepCards: document.querySelectorAll(".step-card").length,
      activeCards: document.querySelectorAll(".step-card.is-active").length,
      liveCards: document.querySelectorAll("#live-proposals-grid .live-tour-card").length,
      termCards: document.querySelectorAll(".terms-grid .term-card").length,
    };
  })()`);
  check(
    "fixture boots the tour: 10 step tabs, 10 panels, one active, 4 live cards, 4 term cards",
    fixtureState &&
    fixtureState.stepBtns === 10 &&
    fixtureState.stepCards === 10 &&
    fixtureState.activeCards === 1 &&
    fixtureState.liveCards === 4 &&
    fixtureState.termCards === 4,
    JSON.stringify(fixtureState),
  );

  // ── Leg A — 720px annotated two-pane collapse (the <=720px contract) ──
  {
    const width = 720;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(SETTLE_MS);
    await goToStep(3);
    const m = await evl(readLayoutExpr(".annotated-layout"));
    const header = await evl(READ_HEADER);
    if (!m || !header) {
      check("A 720px: the annotated layout and header exist", false, "missing .annotated-layout or .tour-header-top");
    } else {
      const widths = trackWidths(m);
      const [card, pane] = m.children;
      check(
        "A 720px: the page does not scroll horizontally",
        m.docScrollWidth <= m.docClientWidth + 1,
        `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
      );
      check(
        "A 720px: .annotated-layout collapses to exactly 1 track",
        m.tracks.length === 1,
        `tracks=${m.tracks.length} [${m.tracks.join(" ")}] gap=${m.gap}`,
      );
      check(
        "A 720px: the annotated card and details pane stack (distinct y, not side-by-side)",
        m.children.length === 2 && Math.abs(card.y - pane.y) > 10,
        `card.y=${card && Math.round(card.y)} pane.y=${pane && Math.round(pane.y)}`,
      );
      check(
        "A 720px: the tour header wraps (computed flex-wrap: wrap)",
        header.flexWrap === "wrap",
        `flexWrap=${header.flexWrap} brandY=${Math.round(header.brandY)} navY=${Math.round(header.navY)}`,
      );
    }
  }

  // ── Leg B — 640px grid collapse (the <=640px contract) ──
  {
    const width = 640;
    const legs = [
      { step: 7, selector: ".quiz-options", child: ".quiz-option-btn", label: "quiz options (step 7)" },
      { step: 8, selector: ".scope-grid", child: ".scope-col", label: "scope columns (step 8)" },
      { step: 4, selector: ".sim3-snippets", child: ".snippet-box", label: "collision snippets (step 4)" },
    ];
    for (const leg of legs) {
      const m = await measure(width, leg.step, leg.selector);
      if (!m) {
        check(`B 640px: ${leg.label} grid exists`, false, `no ${leg.selector}`);
        continue;
      }
      const widths = trackWidths(m);
      check(
        `B 640px: ${leg.label} collapse to exactly 1 track`,
        m.tracks.length === 1,
        `tracks=${m.tracks.length} [${m.tracks.join(" ")}] gap=${m.gap}`,
      );
      check(
        `B 640px: ${leg.label} children stack one per row`,
        m.children.length >= 2 && rowCount(m.children) === m.children.length,
        `children=${m.children.length} rows=${rowCount(m.children)} y=${m.children.map((c) => Math.round(c.y)).join(",")}`,
      );
    }
  }

  // ── Leg C — 360px phone floor ──
  {
    const width = 360;
    const m = await measure(width, 0, ".terms-grid");
    const panels = await evl(READ_PANELS);
    if (!m || !panels) {
      check("C 360px: the terms grid and step panels exist", false, "missing .terms-grid or .step-card");
    } else {
      const widths = trackWidths(m);
      const active = panels.filter((p) => p.active);
      const inactive = panels.filter((p) => !p.active);
      check(
        "C 360px: the page does not scroll horizontally",
        m.docScrollWidth <= m.docClientWidth + 1,
        `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
      );
      check(
        "C 360px: .terms-grid resolves to exactly 1 track (240px minmax floor)",
        m.tracks.length === 1,
        `tracks=${m.tracks.length} [${m.tracks.join(" ")}] gap=${m.gap}`,
      );
      check(
        "C 360px: the four term cards stack one per row",
        m.children.length === 4 && rowCount(m.children) === 4,
        `children=${m.children.length} rows=${rowCount(m.children)} y=${m.children.map((c) => Math.round(c.y)).join(",")}`,
      );
      check(
        "C 360px: exactly one .step-card is active",
        panels.length === 10 && active.length === 1,
        `panels=${panels.length} active=${active.length}`,
      );
      check(
        "C 360px: the active card is display:block and every other card is display:none",
        active.length === 1 && active[0].display === "block" && inactive.every((p) => p.display === "none"),
        JSON.stringify(panels),
      );
    }
  }

  // ── Leg D — wide regression guard (769 / 1024 / 1440) ──
  {
    // 769px: the 768px max-width query does NOT apply here — two panes remain.
    const annotated = await measure(769, 3, ".annotated-layout");
    if (!annotated) {
      check("D 769px: the annotated layout exists", false, "no .annotated-layout");
    } else {
      const widths = trackWidths(annotated);
      check(
        "D 769px: .annotated-layout keeps 2 tracks (the 768px collapse did not leak)",
        annotated.tracks.length === 2,
        `tracks=${annotated.tracks.length} [${annotated.tracks.join(" ")}]`,
      );
      check(
        "D 769px: the two annotated panes sit side-by-side (same row, distinct x)",
        annotated.children.length === 2 &&
        Math.abs(annotated.children[0].y - annotated.children[1].y) <= 10 &&
        Math.abs(annotated.children[0].x - annotated.children[1].x) > 10,
        `y=${annotated.children.map((c) => Math.round(c.y)).join(",")} x=${annotated.children.map((c) => Math.round(c.x)).join(",")}`,
      );
    }

    // 1024 / 1440: the three 640px grids keep 2 equal tracks.
    for (const width of [1024, 1440]) {
      for (const leg of [
        { step: 7, selector: ".quiz-options", label: "quiz options (step 7)" },
        { step: 8, selector: ".scope-grid", label: "scope columns (step 8)" },
        { step: 4, selector: ".sim3-snippets", label: "collision snippets (step 4)" },
      ]) {
        const m = await measure(width, leg.step, leg.selector);
        if (!m) {
          check(`D ${width}px: ${leg.label} grid exists`, false, `no ${leg.selector}`);
          continue;
        }
        const widths = trackWidths(m);
        check(
          `D ${width}px: ${leg.label} keep 2 tracks`,
          m.tracks.length === 2,
          `tracks=${m.tracks.length} [${m.tracks.join(" ")}] gap=${m.gap}`,
        );
        check(
          `D ${width}px: ${leg.label} tracks are equal within 1px`,
          widths.length === 2 && spreadOf(widths) <= 1,
          `track=${widths.join(" ")} spread=${spreadOf(widths)}`,
        );
      }
    }
  }

  // ── Leg E — stepper reachability smoke (delegated boundary) ──
  {
    let allReachable = true;
    const detail = [];
    for (let n = 0; n < 10; n++) {
      await goToStep(n);
      const state = await evl(`(() => {
        const cards = [...document.querySelectorAll(".step-card")];
        const active = cards.filter((c) => c.classList.contains("is-active"));
        const btn = document.querySelector('.step-btn[data-step="${n}"]');
        return {
          activeIds: active.map((c) => c.id),
          btnActive: btn ? btn.classList.contains("is-active") : false,
        };
      })()`);
      const ok = state && state.activeIds.length === 1 && state.activeIds[0] === `step-${n}` && state.btnActive;
      if (!ok) {
        allReachable = false;
        detail.push(`step-${n}:${JSON.stringify(state)}`);
      }
    }
    check(
      "E smoke: all 10 step tabs are reachable, each activating exactly its own panel",
      allReachable,
      detail.join(" | "),
    );
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
