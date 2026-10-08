#!/usr/bin/env bun
// Contract suite: phone-width touch targets — every listed control presents a >=44x44px hit
// area at <=720px viewports (EXPERIENCE.md Accessibility Floor "To build": touch targets
// >=44px at phone widths; PRD NFR-9).
// Run: bun porting/tests/ui-touch-targets.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is served
// from a loopback origin into real headless Chrome; the only scripted pieces are the worker
// HTTP surface, device-metrics emulation, and trusted input dispatched over CDP (mouse
// clicks, a touch tap). No module mocks, no source grep, no in-page observer. Legs:
//   T0 fixture sanity — the states T1–T4 measure really rendered (exactly 2 .btn-file-diff
//      controls on the card; >=2 .merge-file-tab in the open modal)
//   T1 phone base surface (360/390/720) — .toggle-label, #btn-manual-refresh (.btn-refresh),
//      .btn-tour-header, .btn-tour-help, .btn-card-action, .btn-file-diff
//   T2 phone modal (390/720) — .merge-file-tab + .btn-close-modal
//   T3 phone connection banner (390/720) — .connection-banner-action
//   T4 phone action banner (390/720) — .action-banner-close after a real failed land
//   T5 pill invariance (390/720) — .toggle-input keeps computed min "auto" and stays shorter
//      than 20px; at 720 exactly its authored 26x14.625 (the 2rem pill is not resized)
//   T6 breakpoint boundary — floor active at 720, inert at 721 (all ten classes across the
//      base, modal, and banner surfaces)
//   T7 desktop unchanged (1280) — all ten computed "auto", authored .btn-tour-help 19.5x19.5,
//      every measured height <44
//   T8 touch operability (390) — a mouse click and a touch tap at the label edge (inside the
//      enlarged label box, outside the pill) each flip the toggle; no hover precondition
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible /
// ui-first-load-panels); the order's acceptance gate hard-requires Chrome separately.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 320; // transitions on .btn-tour-help/.btn-card-action/.toggle-input must settle before reads
const FLOOR = 44;
const TOL = 0.5; // border-box rect tolerance at the acceptance boundary
const PHONE_WIDTHS = [360, 390, 720];
const MODAL_WIDTHS = [390, 720];

// The ten control classes the touch register covers, in the states that render them.
const BASE_SELS = [
  ".toggle-label",
  "#btn-manual-refresh",
  ".btn-tour-header",
  ".btn-tour-help",
  "#card-agent-1 .btn-card-action",
  "#card-agent-1 .btn-file-diff",
];
const MODAL_SELS = [".merge-file-tab", ".btn-close-modal"];
const CONNECTION_SELS = ["#connection-banner-retry"];
const ACTION_SELS = ["#action-banner-close"];
const ALL_SELS = [...BASE_SELS, ...MODAL_SELS, ...CONNECTION_SELS, ...ACTION_SELS];

// Fixture: one landable proposal with two readable files (two .btn-file-diff controls) and
// the reviewed-state anchors (FR-16) the land guard binds to — base.head + row.head.
const BASE_HEAD = "1a".repeat(20);
const AGENT1_HEAD = "2b".repeat(20);
const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 2, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      head: AGENT1_HEAD,
      intent: "fixture intent",
      landing: { status: "ready" },
      stats: { files: 2, additions: 4, deletions: 1 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false },
        { path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false },
      ],
    },
  ],
  conflicts: [],
};
// Two merge files is what renders .merge-file-tab buttons in the modal.
const MERGE = {
  ok: true,
  merge: {
    status: "clean",
    files: [
      { path: "src/auth.ts", action: "write", result: "merged", merged: "export const auth = true;" },
      { path: "README.md", action: "write", result: "merged", merged: "# fixture readme" },
    ],
  },
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
  console.log("SKIP  UI touch targets — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-touch-"));

// Loopback worker surface: mode selects what /proposals does; /merge renders the two-tab
// modal and /land fails through the real error path (generic 'Failed to land' copy).
let mode = "ok";
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    if (mode === "fail") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "fixture-down" }));
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(FIXTURE));
    }
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "judge unavailable in fixture" }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(MERGE));
    return;
  }
  if (pathname === "/land") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "fixture-down" }));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
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

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking exec
// would deadlock the very fetch the page is waiting on.
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

// Computed min-height/min-width + border-box rect for every element a selector matches.
const measureExpr = (sels) => `(() => {
  const els = {};
  for (const sel of ${JSON.stringify(sels)}) {
    els[sel] = [...document.querySelectorAll(sel)].map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { w: +r.width.toFixed(2), h: +r.height.toFixed(2), minH: cs.minHeight, minW: cs.minWidth };
    });
  }
  return { vw: document.documentElement.clientWidth, mq: matchMedia("(max-width: 720px)").matches, els };
})()`;

const flatEls = (...results) => Object.assign({}, ...results.map((r) => r.els));
const only = (els, sel) => (els[sel] ?? [])[0] ?? null;
const near = (a, b, tol = TOL) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

// The acceptance-floor predicate: min-height/min-width computed to 44px AND a border-box
// rect at or above 44x44 (0.5px tolerance).
const floorBad = (els, sels) => {
  const bad = [];
  for (const sel of sels) {
    const rows = els[sel] ?? [];
    if (rows.length === 0) bad.push(`${sel}: no elements`);
    for (const r of rows) {
      if (r.minH !== "44px" || r.minW !== "44px") bad.push(`${sel}: min=${r.minH}/${r.minW} rect=${r.w}x${r.h}`);
      else if (r.w < FLOOR - TOL || r.h < FLOOR - TOL) bad.push(`${sel}: rect=${r.w}x${r.h}`);
    }
  }
  return bad;
};

// Above the breakpoint the register must be inert: computed min back to "auto" AND every
// measured height below the floor (a missing/miswritten @media wrapper trips both).
const inertBad = (els, sels) => {
  const bad = [];
  for (const sel of sels) {
    const rows = els[sel] ?? [];
    if (rows.length === 0) bad.push(`${sel}: no elements`);
    for (const r of rows) {
      if (r.minH !== "auto" || r.minW !== "auto") bad.push(`${sel}: min=${r.minH}/${r.minW}`);
      if (r.h >= FLOOR) bad.push(`${sel}: h=${r.h}`);
    }
  }
  return bad;
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
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
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

  const navigate = async (path) => {
    const priorOrigin = await evl("performance.timeOrigin");
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitFor(
      `performance.timeOrigin !== ${priorOrigin} && location.pathname === ${JSON.stringify(path)} && document.readyState === "complete"`,
    );
    await send("Page.bringToFront");
  };

  // Device-metrics emulation is the acceptance boundary itself: max-width:720px must match.
  const setViewport = async (width, height = 900) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await sleep(120);
  };

  const measure = (sels) => evl(measureExpr(sels));

  const rectOf = (sel) =>
    evl(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);

  const clickEl = async (sel) => {
    const pt = await rectOf(sel);
    if (!pt) throw new Error(`clickEl: no element matches ${sel}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(SETTLE_MS);
  };

  // A real user action — flipping the toggle off stops the 8 s /proposals poll so the
  // measured surface is frozen. Determinism aid only; measurement already happened.
  const freezeToggle = async () => {
    try {
      await clickEl("#auto-refresh-toggle");
      await waitFor(`document.getElementById("auto-refresh-toggle").checked === false`, 2000);
    } catch {
      /* not part of the contract */
    }
  };

  const openBase = async (width) => {
    mode = "ok";
    await setViewport(width);
    await navigate("/index.html");
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
  };

  const openModal = async (width) => {
    await openBase(width);
    await freezeToggle();
    await clickEl("#card-agent-1 .btn-preview-merge");
    await waitFor(`!document.getElementById("inspector-modal").hidden && document.querySelectorAll(".merge-file-tab").length >= 2`);
    await sleep(SETTLE_MS);
  };

  const openConnectionBanner = async (width) => {
    mode = "fail";
    await setViewport(width);
    await navigate("/index.html");
    await waitFor(`!document.getElementById("connection-banner").hidden`);
    await sleep(SETTLE_MS);
  };

  // Real failed land: start-land -> confirm-land -> the /land 500 renders the action banner.
  const openActionBanner = async (width) => {
    mode = "ok";
    await setViewport(width);
    await navigate("/index.html");
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
    await clickEl('[data-action="start-land"]');
    await waitFor(`document.querySelector('[data-action="confirm-land"]') !== null`);
    await clickEl('[data-action="confirm-land"]');
    await waitFor(
      `!document.getElementById("action-banner").hidden && document.getElementById("action-banner-msg").textContent.includes("Failed to land")`,
    );
    await sleep(SETTLE_MS);
  };

  // Every one of the ten classes in the state that renders it, at one width.
  const measureAllStates = async (width) => {
    const base = { els: {} };
    await openBase(width);
    await freezeToggle();
    const baseRes = await measure(BASE_SELS);
    await clickEl("#card-agent-1 .btn-preview-merge");
    await waitFor(`!document.getElementById("inspector-modal").hidden && document.querySelectorAll(".merge-file-tab").length >= 2`);
    await sleep(SETTLE_MS);
    const modalRes = await measure(MODAL_SELS);
    await clickEl("#btn-close-modal");
    await openActionBanner(width);
    const actionRes = await measure(ACTION_SELS);
    await openConnectionBanner(width);
    const connectionRes = await measure(CONNECTION_SELS);
    base.els = flatEls(baseRes, modalRes, actionRes, connectionRes);
    base.mq = baseRes.mq;
    base.vw = baseRes.vw;
    return base;
  };

  // --- T0: fixture sanity -----------------------------------------------------------
  try {
    await openBase(390);
    const fdCount = await evl(`document.querySelectorAll("#card-agent-1 .btn-file-diff").length`);
    check("T0 fixture: the proposal card carries exactly 2 file-diff controls", fdCount === 2, `count=${fdCount}`);
    await clickEl("#card-agent-1 .btn-preview-merge");
    await waitFor(`!document.getElementById("inspector-modal").hidden && document.querySelectorAll(".merge-file-tab").length >= 2`);
    const tabCount = await evl(`document.querySelectorAll(".merge-file-tab").length`);
    check("T0 fixture: the modal opens with >=2 merge file tabs", tabCount >= 2, `tabs=${tabCount}`);
  } catch (e) {
    check("T0 fixture-sanity walk threw", false, String(e?.message ?? e));
  }

  // --- T1: phone base surface (360/390/720) -----------------------------------------
  for (const width of PHONE_WIDTHS) {
    try {
      await openBase(width);
      const res = await measure(BASE_SELS);
      const bad = floorBad(res.els, BASE_SELS);
      check(
        `T1 phone base surface @${width}px: label, refresh, tour header/help, card actions and file diffs present >=44×44 with computed min 44px`,
        bad.length === 0 && res.mq === true,
        bad.length ? JSON.stringify(bad.slice(0, 4)) : `mq=${res.mq} vw=${res.vw}`,
      );
      await freezeToggle();
    } catch (e) {
      check(`T1 phone base surface @${width}px walk threw`, false, String(e?.message ?? e));
    }
  }

  // --- T2: phone modal (390/720) ----------------------------------------------------
  for (const width of MODAL_WIDTHS) {
    try {
      await openModal(width);
      const res = await measure(MODAL_SELS);
      const bad = floorBad(res.els, MODAL_SELS);
      check(
        `T2 phone modal @${width}px: every merge file tab and the close control present >=44×44 with computed min 44px`,
        bad.length === 0 && res.mq === true,
        bad.length ? JSON.stringify(bad.slice(0, 4)) : `mq=${res.mq}`,
      );
    } catch (e) {
      check(`T2 phone modal @${width}px walk threw`, false, String(e?.message ?? e));
    }
  }

  // --- T3: phone connection banner (390/720) ----------------------------------------
  for (const width of MODAL_WIDTHS) {
    try {
      await openConnectionBanner(width);
      const res = await measure(CONNECTION_SELS);
      const bad = floorBad(res.els, CONNECTION_SELS);
      check(
        `T3 phone connection banner @${width}px: the retry action presents >=44×44 with computed min 44px`,
        bad.length === 0 && res.mq === true,
        bad.length ? JSON.stringify(bad.slice(0, 4)) : `mq=${res.mq}`,
      );
    } catch (e) {
      check(`T3 phone connection banner @${width}px walk threw`, false, String(e?.message ?? e));
    }
  }

  // --- T4: phone action banner (390/720) --------------------------------------------
  for (const width of MODAL_WIDTHS) {
    try {
      await openActionBanner(width);
      const res = await measure(ACTION_SELS);
      const bad = floorBad(res.els, ACTION_SELS);
      check(
        `T4 phone action banner @${width}px: the dismiss control presents >=44×44 with computed min 44px`,
        bad.length === 0 && res.mq === true,
        bad.length ? JSON.stringify(bad.slice(0, 4)) : `mq=${res.mq}`,
      );
    } catch (e) {
      check(`T4 phone action banner @${width}px walk threw`, false, String(e?.message ?? e));
    }
  }

  // --- T5: pill invariance (390/720) -------------------------------------------------
  for (const width of MODAL_WIDTHS) {
    try {
      await openBase(width);
      const res = await measure([".toggle-input"]);
      const pill = only(res.els, ".toggle-input");
      const sized = width === 720 ? near(pill?.w, 26) && near(pill?.h, 14.625) : true;
      check(
        `T5 pill invariance @${width}px: .toggle-input keeps computed min "auto" and height <20${width === 720 ? ", exactly 26×14.625 authored" : ""}`,
        pill && pill.minH === "auto" && pill.minW === "auto" && pill.h < 20 && sized,
        JSON.stringify(pill),
      );
    } catch (e) {
      check(`T5 pill invariance @${width}px walk threw`, false, String(e?.message ?? e));
    }
  }

  // --- T6: breakpoint boundary (720 active / 721 inert, all ten classes) -------------
  try {
    const at720 = await measureAllStates(720);
    const bad720 = floorBad(at720.els, ALL_SELS);
    const help720 = only(at720.els, ".btn-tour-help");
    const label720 = only(at720.els, ".toggle-label");
    check(
      "T6 breakpoint boundary @720px: floor active — all ten controls >=44×44 with computed min 44px; .btn-tour-help exactly 44×44",
      bad720.length === 0 && at720.mq === true && near(help720?.w, 44) && near(help720?.h, 44) && label720?.minH === "44px" && label720?.minW === "44px",
      bad720.length ? JSON.stringify(bad720.slice(0, 4)) : `help=${help720?.w}×${help720?.h} mq=${at720.mq}`,
    );
  } catch (e) {
    check("T6 breakpoint boundary @720px walk threw", false, String(e?.message ?? e));
  }
  try {
    const at721 = await measureAllStates(721);
    const bad721 = inertBad(at721.els, ALL_SELS);
    const help721 = only(at721.els, ".btn-tour-help");
    check(
      "T6 breakpoint boundary @721px: floor inert — all ten controls computed min auto, help back to author 19.5×19.5, every height <44",
      bad721.length === 0 && at721.mq === false && near(help721?.w, 19.5) && near(help721?.h, 19.5),
      bad721.length ? JSON.stringify(bad721.slice(0, 4)) : `help=${help721?.w}×${help721?.h} mq=${at721.mq}`,
    );
  } catch (e) {
    check("T6 breakpoint boundary @721px walk threw", false, String(e?.message ?? e));
  }

  // --- T7: desktop unchanged (1280) ---------------------------------------------------
  try {
    const at1280 = await measureAllStates(1280);
    const bad = inertBad(at1280.els, ALL_SELS);
    const help = only(at1280.els, ".btn-tour-help");
    check(
      "T7 desktop unchanged @1280px: all ten controls computed min auto with every height <44; help at its authored 19.5×19.5",
      bad.length === 0 && at1280.mq === false && near(help?.w, 19.5) && near(help?.h, 19.5),
      bad.length ? JSON.stringify(bad.slice(0, 4)) : `help=${help?.w}×${help?.h} mq=${at1280.mq}`,
    );
  } catch (e) {
    check("T7 desktop unchanged @1280px walk threw", false, String(e?.message ?? e));
  }

  // --- T8: touch operability / no hover precondition (390) ---------------------------
  try {
    await openBase(390);
    const before = await evl(`document.getElementById("auto-refresh-toggle").checked`);
    const geom = await evl(`(() => {
      const label = document.querySelector(".toggle-label");
      label.scrollIntoView({ block: "center", inline: "center" });
      const lr = label.getBoundingClientRect();
      const pr = document.querySelector(".toggle-input").getBoundingClientRect();
      const x = Math.round(lr.right - 8);
      const y = Math.round(lr.top + 4);
      return {
        x,
        y,
        insideLabel: x >= lr.left && x <= lr.right && y >= lr.top && y <= lr.bottom,
        insidePill: x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom,
        label: { w: +lr.width.toFixed(1), h: +lr.height.toFixed(1) },
        pill: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) },
      };
    })()`);
    check(
      "T8 touch operability: the dispatch point sits inside the enlarged label box but outside the pill",
      geom.insideLabel === true && geom.insidePill === false,
      JSON.stringify(geom),
    );
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: geom.x, y: geom.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geom.x, y: geom.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(SETTLE_MS);
    const afterMouse = await evl(`document.getElementById("auto-refresh-toggle").checked`);
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: geom.x, y: geom.y }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(SETTLE_MS);
    const afterTouch = await evl(`document.getElementById("auto-refresh-toggle").checked`);
    check(
      "T8 touch operability: the label edge activates by mouse click and by touch tap — no hover precondition",
      before === true && afterMouse === false && afterTouch === true,
      `before=${before} afterMouse=${afterMouse} afterTouch=${afterTouch}`,
    );
  } catch (e) {
    check("T8 touch-operability walk threw", false, String(e?.message ?? e));
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

console.log(fails === 0 ? `ALL PASS (cases=${cases})` : `${fails} FAILURES (cases=${cases})`);
process.exit(fails === 0 ? 0 : 1);
