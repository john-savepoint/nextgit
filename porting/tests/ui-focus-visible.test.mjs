#!/usr/bin/env bun
// Contract suite: keyboard focus visibility on every interactive control (NFR-9 / UX-DR-4;
// EXPERIENCE.md Accessibility Floor "To build": visible focus — the border-strong lift).
// Run: bun porting/tests/ui-focus-visible.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is served
// from a loopback origin into real headless Chrome; the only scripted pieces are the worker
// HTTP surface and trusted input dispatched over CDP (Tab traversal, mouse clicks/hovers).
// No module mocks, no source grep, no in-page observer. Legs:
//   W1 base-surface Tab walk — toggle, refresh, tour header/help, card preview+land, file
//      diffs: every keyboard stop matches :focus-visible and shows the 2px border-focus
//      outline at 2px offset
//   W2 inline-confirm state — .btn-land.is-confirming + .btn-cancel-land
//   W3 modal controls — .merge-file-tab + .btn-close-modal
//   W4 action banner — .action-banner-close after a real failed land
//   W5 connection banner — .connection-banner-action on the failed-fetch surface
//   W6 pointer parity — a trusted click focuses without matching :focus-visible (the
//      :focus-vs-:focus-visible discriminator) and really activates the control
//   W7 hover parity — the pre-existing hover registers are unchanged and show no outline
//   W8 no layout shift — focus adds the outline without moving the rect or the border
// A box without a Chrome binary skips the suite (precedent: ui-first-load-panels /
// action-banner-states); the order's acceptance gate hard-requires Chrome separately.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 320; // transitions on .btn-tour-help/.btn-card-action must finish before reads
const TAB_CAP = 40;
const INDICATOR = {
  outlineStyle: "solid",
  outlineWidth: "2px",
  outlineColor: "rgb(62, 84, 115)", // {colors.border-focus} #3e5473
  outlineOffset: "2px",
};
const hasIndicator = (s) =>
  s &&
  s.outlineStyle === INDICATOR.outlineStyle &&
  s.outlineWidth === INDICATOR.outlineWidth &&
  s.outlineColor === INDICATOR.outlineColor &&
  s.outlineOffset === INDICATOR.outlineOffset;

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
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI focus visibility — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-focus-"));

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

const READ_FOCUS = `(() => {
  const a = document.activeElement;
  if (!a) return null;
  const cs = getComputedStyle(a);
  const r = a.getBoundingClientRect();
  return {
    tag: a.tagName,
    id: a.id || null,
    cls: typeof a.className === "string" ? a.className : "",
    fv: a.matches(":focus-visible"),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    borderTopWidth: cs.borderTopWidth,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
})()`;

const styleOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    borderTopColor: cs.borderTopColor,
    borderTopWidth: cs.borderTopWidth,
    backgroundColor: cs.backgroundColor,
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    fv: el.matches(":focus-visible"),
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
})()`;

const rectEqual = (a, b) =>
  Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5 && Math.abs(a.w - b.w) <= 0.5 && Math.abs(a.h - b.h) <= 0.5;

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
  // Required: without focus emulation, Tab key events never traverse focus in headless.
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

  const pressTab = async () => {
    const key = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(SETTLE_MS);
  };

  const readFocus = () => evl(READ_FOCUS);
  const readStyle = (sel) => evl(styleOf(sel));

  const centerOf = async (sel) =>
    evl(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);

  const clickEl = async (sel) => {
    const pt = await centerOf(sel);
    if (!pt) throw new Error(`clickEl: no element matches ${sel}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(SETTLE_MS);
  };

  const hoverEl = async (sel) => {
    const pt = await centerOf(sel);
    if (!pt) throw new Error(`hoverEl: no element matches ${sel}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, buttons: 0 });
    await sleep(SETTLE_MS);
  };

  const tabUntil = async (sel, cap = TAB_CAP) => {
    for (let i = 0; i < cap; i++) {
      const hit = await evl(`!!document.activeElement && document.activeElement.matches(${JSON.stringify(sel)})`);
      if (hit) return readFocus();
      await pressTab();
    }
    throw new Error(`tabUntil: ${sel} not reached within ${cap} Tab presses`);
  };

  // A real user action — clicking the toggle off stops the 8 s /proposals poll so the
  // element identity of the walk is frozen for deterministic reads.
  const openPage = async ({ fail = false } = {}) => {
    mode = fail ? "fail" : "ok";
    await navigate("/index.html");
    if (fail) {
      await waitFor(`!document.getElementById("connection-banner").hidden`);
      return;
    }
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
    await clickEl("#auto-refresh-toggle");
    const frozen = await evl(`document.getElementById("auto-refresh-toggle").checked === false`);
    if (!frozen) throw new Error("auto-refresh toggle did not flip off");
  };

  // --- W1: base-surface Tab walk -------------------------------------------------
  try {
    await openPage();
    await evl(`(() => { if (document.activeElement) document.activeElement.blur(); return true; })()`);
    const stops = [];
    for (let i = 0; i < 12; i++) {
      await pressTab();
      const f = await readFocus();
      if (!f) break;
      if (f.tag === "BUTTON" || f.tag === "A" || f.tag === "INPUT") stops.push(f);
    }
    const bad = stops.filter((s) => !(s.fv === true && hasIndicator(s)));
    check(
      "W1 base-surface: every keyboard Tab stop matches :focus-visible with the 2px border-focus outline at 2px offset",
      bad.length === 0 && stops.length >= 6,
      bad.length ? JSON.stringify(bad.slice(0, 3)) : `stops=${stops.length}`,
    );
    const covered = new Set(stops.flatMap((s) => [...(s.cls || "").split(/\s+/).filter(Boolean), s.id].filter(Boolean)));
    const missing = ["toggle-input", "btn-refresh", "btn-tour-header", "btn-tour-help", "btn-preview-merge", "btn-land", "btn-file-diff"].filter(
      (c) => !covered.has(c),
    );
    check("W1 base-surface: the walk covers the toggle, refresh, tour and card controls", missing.length === 0, `missing=${missing.join(",")}`);
    const fdCount = await evl(`document.querySelectorAll("#card-agent-1 .btn-file-diff").length`);
    check("W1 fixture: the proposal card carries exactly 2 file-diff controls", fdCount === 2, `count=${fdCount}`);
  } catch (e) {
    check("W1 base-surface walk threw", false, String(e?.message ?? e));
  }

  // --- W2: inline-confirm state --------------------------------------------------
  try {
    await openPage();
    await clickEl('[data-action="start-land"]');
    await waitFor(`document.querySelector('[data-action="confirm-land"]') !== null`);
    const confirm = await tabUntil(".btn-land.is-confirming");
    check(
      "W2 inline confirm: the confirming land control shows the indicator",
      confirm.cls.includes("is-confirming") && confirm.fv === true && hasIndicator(confirm),
      JSON.stringify(confirm),
    );
    const cancel = await tabUntil(".btn-cancel-land");
    check("W2 inline confirm: the cancel control shows the indicator", cancel.fv === true && hasIndicator(cancel), JSON.stringify(cancel));
  } catch (e) {
    check("W2 inline-confirm walk threw", false, String(e?.message ?? e));
  }

  // --- W3: modal controls --------------------------------------------------------
  try {
    await openPage();
    await clickEl(".btn-preview-merge");
    await waitFor(`!document.getElementById("inspector-modal").hidden`);
    await waitFor(`document.querySelectorAll(".merge-file-tab").length >= 2`);
    const tab = await tabUntil(".merge-file-tab");
    check("W3 modal: the merge file tab shows the indicator", tab.cls.includes("merge-file-tab") && tab.fv === true && hasIndicator(tab), JSON.stringify(tab));
    const close = await tabUntil("#btn-close-modal");
    check("W3 modal: the close control shows the indicator", close.id === "btn-close-modal" && close.fv === true && hasIndicator(close), JSON.stringify(close));
  } catch (e) {
    check("W3 modal walk threw", false, String(e?.message ?? e));
  }

  // --- W4: action banner (real failed land) --------------------------------------
  try {
    await openPage();
    await clickEl('[data-action="start-land"]');
    await waitFor(`document.querySelector('[data-action="confirm-land"]') !== null`);
    await clickEl('[data-action="confirm-land"]');
    await waitFor(
      `!document.getElementById("action-banner").hidden && document.getElementById("action-banner-msg").textContent.includes("Failed to land")`,
    );
    const msg = await evl(`document.getElementById("action-banner-msg").textContent`);
    check("W4 action banner: the failed land renders the exact failure copy", msg.includes("Failed to land agent-1") && msg.includes("fixture-down"), msg);
    const f = await tabUntil("#action-banner-close");
    check("W4 action banner: the dismiss control shows the indicator", f.id === "action-banner-close" && f.fv === true && hasIndicator(f), JSON.stringify(f));
  } catch (e) {
    check("W4 action-banner walk threw", false, String(e?.message ?? e));
  }

  // --- W5: connection banner -----------------------------------------------------
  try {
    await openPage({ fail: true });
    await pressTab();
    const f = await readFocus();
    check(
      "W5 connection banner: the first Tab stop is the retry action with the indicator",
      f && f.id === "connection-banner-retry" && f.cls.includes("connection-banner-action") && f.fv === true && hasIndicator(f),
      JSON.stringify(f),
    );
  } catch (e) {
    check("W5 connection-banner walk threw", false, String(e?.message ?? e));
  }

  // --- W6: pointer parity (the :focus-vs-:focus-visible discriminator) -----------
  try {
    await openPage();
    await clickEl("#btn-manual-refresh");
    const r = await readFocus();
    check(
      "W6 pointer parity: a click focuses refresh without matching :focus-visible",
      r.id === "btn-manual-refresh" && r.fv === false && r.outlineStyle === "none" && r.outlineWidth === "0px",
      JSON.stringify(r),
    );
    const before = await evl(`document.getElementById("auto-refresh-toggle").checked`);
    await clickEl("#auto-refresh-toggle");
    const t = await readFocus();
    const after = await evl(`document.getElementById("auto-refresh-toggle").checked`);
    check(
      "W6 pointer parity: a click focuses the toggle and flips it, still without the indicator",
      t.id === "auto-refresh-toggle" && t.fv === false && t.outlineStyle === "none" && t.outlineWidth === "0px" && before === false && after === true,
      `before=${before} after=${after} ${JSON.stringify(t)}`,
    );
  } catch (e) {
    check("W6 pointer-parity walk threw", false, String(e?.message ?? e));
  }

  // --- W7: hover parity -----------------------------------------------------------
  try {
    await openPage();
    await evl(`(() => { if (document.activeElement) document.activeElement.blur(); return true; })()`);
    await hoverEl("#btn-manual-refresh");
    const r = await readStyle("#btn-manual-refresh");
    check(
      "W7 hover parity: refresh keeps its hover register and shows no outline",
      r.borderTopColor === "rgb(62, 84, 115)" && r.backgroundColor === "rgb(20, 27, 36)" && r.outlineStyle === "none",
      JSON.stringify(r),
    );
    await hoverEl(".btn-preview-merge");
    const c = await readStyle(".btn-preview-merge");
    check(
      "W7 hover parity: the card action keeps its hover register and shows no outline",
      c.borderTopColor === "rgb(37, 51, 70)" && c.backgroundColor === "rgb(20, 27, 36)" && c.outlineStyle === "none",
      JSON.stringify(c),
    );
  } catch (e) {
    check("W7 hover-parity walk threw", false, String(e?.message ?? e));
  }

  // --- W8: no layout shift --------------------------------------------------------
  try {
    await openPage();
    await pressTab(); // one real keyboard press flips the modality to keyboard
    for (const [label, sel] of [
      ["refresh", "#btn-manual-refresh"],
      ["card action", "#card-agent-1 .btn-preview-merge"],
    ]) {
      await evl(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: "center" }); return true; })()`);
      await sleep(80);
      const before = await readStyle(sel);
      await evl(`document.querySelector(${JSON.stringify(sel)}).focus()`);
      await sleep(SETTLE_MS);
      const after = await readStyle(sel);
      check(
        `W8 no layout shift: ${label} keeps its rect and border while focused, and shows the indicator`,
        before && after && rectEqual(before.rect, after.rect) && before.borderTopWidth === after.borderTopWidth && after.fv === true && hasIndicator(after),
        JSON.stringify({ before: before?.rect, after: after?.rect, borderTopWidth: [before?.borderTopWidth, after?.borderTopWidth], fv: after?.fv }),
      );
    }
  } catch (e) {
    check("W8 no-layout-shift walk threw", false, String(e?.message ?? e));
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
