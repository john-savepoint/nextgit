#!/usr/bin/env bun
// Contract suite: inspector-dialog focus management (NFR-9 / UX-DR-5 / UX-DR-4;
// EXPERIENCE.md Accessibility Floor "Modal focus management": move focus into the dialog on
// open, trap it while open, return it to the triggering control on close).
// Run: bun porting/tests/ui-modal-focus.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui is served from a loopback origin into real
// headless Chrome; the only scripted pieces are the worker HTTP surface and trusted input
// dispatched over CDP (Tab / Shift+Tab / Enter / Escape, mouse clicks). No module mocks,
// no source grep, no in-page observer. Legs:
//   M0  shell invariants — one dialog element, hidden at rest, fixture shape
//   M1  keyboard open — focus lands on the close control while the diff is still fetching,
//       and the second (content) open leaves it there
//   M2  diff dialog (one focusable) — Tab and Shift+Tab never leave the close control
//   M3  merge dialog — Tab walks close → tab0 → tab1 → close → tab0 (wrap, never leaves)
//   M4  Shift+Tab wrap — from the first focusable to the last; mid-cycle stays inside
//   M5  focus recovery — a re-rendering tab click drops focus to body; next Tab lands inside
//   M6/M7/M8  Escape, backdrop click, close control → exact trigger regains focus
//   M9  sequential opens capture their own trigger; one dialog exists throughout
//   M10 closed dialog — the trap is inert; Tab continues through the page
//   M11 stale trigger — a re-render while open detaches it; close stays safe
//   M12 merge preview title content — modal-title reads "Merge preview: {repo}", badge clean
//   M13 in-place replacement / one-level depth — opening again while open swaps content
//       in place (no second modal); Escape returns focus to the original diff trigger
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible); the order's
// acceptance gate hard-requires Chrome separately.

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

// The diff path fetches /changes?repo=agent-1; README.md is the second (last) view-diff
// control on the card, so a stale-trigger re-render is unambiguous.
const PATCH_AUTH = [
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -1 +1 @@",
  "-export const auth = false;",
  "+export const auth = true;",
].join("\n");
const PATCH_README = [
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1 @@",
  "-# fixture readme",
  "+# fixture readme (edited)",
].join("\n");
const CHANGES = {
  ok: true,
  changeSet: {
    files: [
      { path: "src/auth.ts", status: "modified", patch: PATCH_AUTH, intent: "fixture intent" },
      { path: "README.md", status: "modified", patch: PATCH_README, intent: "fixture intent" },
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
// Delayed on demand: the diff-open leg must observe the dialog's loading phase.
let changesDelay = 0;
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
  if (pathname === "/changes") {
    const body = JSON.stringify(CHANGES);
    const reply = () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    };
    if (changesDelay > 0) setTimeout(reply, changesDelay);
    else reply();
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

  // Enter activates the focused control (rawKeyDown alone does not fire a button's
  // default action; the keyDown+text form is the canonical DevTools dispatch).
  const pressEnter = async () => {
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r", unmodifiedText: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(SETTLE_MS);
  };

  const pressTab = async (shift = false) => {
    const key = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(SETTLE_MS);
  };

  const pressEscape = async () => {
    const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(SETTLE_MS);
  };

  // Focus + dialog facts read fresh each time (element identity changes on re-render).
  const active = () =>
    evl(`(() => {
      const a = document.activeElement;
      const modal = document.getElementById("inspector-modal");
      return {
        tag: a ? a.tagName : null,
        id: a && a.id ? a.id : null,
        cls: a && typeof a.className === "string" ? a.className : "",
        probe: a && a.dataset ? a.dataset.probe || null : null,
        path: a && a.getAttribute ? a.getAttribute("data-path") : null,
        mergeTab: a && a.getAttribute ? a.getAttribute("data-merge-tab") : null,
        insideModal: Boolean(a && modal && modal.contains(a)),
        modalHidden: modal ? modal.hidden : null,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        modalCount: document.querySelectorAll("#inspector-modal").length,
      };
    })()`);

  // Keyboard-reach a page control by real Tab presses (the trap is inert while closed).
  const tabTo = async (sel, cap = TAB_CAP) => {
    for (let i = 0; i < cap; i++) {
      const hit = await evl(`!!document.activeElement && document.activeElement.matches(${JSON.stringify(sel)})`);
      if (hit) return true;
      await pressTab();
    }
    return false;
  };

  const stampProbe = (sel, probe) =>
    evl(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.dataset.probe = ${JSON.stringify(probe)};
      return true;
    })()`);

  // A point whose top element is the backdrop itself (the app closes only on e.target
  // === the backdrop) — found by hit-testing, never assumed.
  const backdropPoint = () =>
    evl(`(() => {
      const modal = document.getElementById("inspector-modal");
      if (!modal) return null;
      for (let x = 4; x < window.innerWidth; x += 8) {
        for (let y = 4; y < window.innerHeight; y += 8) {
          if (document.elementFromPoint(x, y) === modal) return { x, y };
        }
      }
      return null;
    })()`);

  const clickAt = async (pt) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(SETTLE_MS);
  };

  const openPage = async () => {
    await navigate("/index.html");
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
    await clickEl("#auto-refresh-toggle");
    await waitFor(`document.getElementById("auto-refresh-toggle").checked === false`);
  };

  // --- M0: shell invariants + fixture shape -------------------------------------
  try {
    await openPage();
    const rest = await evl(`({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      modals: document.querySelectorAll("#inspector-modal").length,
      hiddenAtRest: document.getElementById("inspector-modal").hidden === true,
      diffBtns: document.querySelectorAll("#card-agent-1 .btn-file-diff").length,
    })`);
    check(
      "M0 shell: exactly one dialog element, hidden at rest, with 2 view-diff controls",
      rest.dialogs === 1 && rest.modals === 1 && rest.hiddenAtRest === true && rest.diffBtns === 2,
      JSON.stringify(rest),
    );
  } catch (e) {
    check("M0 fixture walk threw", false, String(e?.message ?? e));
  }

  // --- M1: keyboard open moves focus into the dialog ----------------------------
  try {
    await openPage();
    changesDelay = 700;
    await stampProbe('#card-agent-1 [data-path="README.md"]', "opener-diff");
    const reached = await tabTo('#card-agent-1 [data-path="README.md"]');
    check("M1 keyboard reach: Tab reaches the view-diff control that will open the dialog", reached, "opener not reached");
    await pressEnter();
    await waitFor(`document.getElementById("inspector-modal").hidden === false`);
    const during = await active();
    const badgeDuring = await evl(`document.getElementById("modal-badge").textContent`);
    check(
      "M1 keyboard open: focus moves onto the dialog's close control while the diff is still fetching",
      during.id === "btn-close-modal" && during.insideModal === true && badgeDuring === "fetching diff...",
      JSON.stringify({ during, badgeDuring }),
    );
    await waitFor(`document.getElementById("modal-badge").textContent === "modified"`);
    const after = await active();
    check(
      "M1 content load: the dialog's second render (content) leaves focus on the close control",
      after.id === "btn-close-modal" && after.insideModal === true && after.dialogs === 1,
      JSON.stringify(after),
    );
  } catch (e) {
    check("M1 diff-open walk threw", false, String(e?.message ?? e));
  } finally {
    changesDelay = 0;
  }

  // --- M2: the diff dialog has one focusable; Tab both ways must stay -------------
  try {
    await openPage();
    await tabTo('#card-agent-1 [data-path="README.md"]');
    await pressEnter();
    await waitFor(`document.querySelectorAll("#inspector-modal .diff-viewer").length === 1`);
    const stops = [];
    for (let i = 0; i < 3; i++) {
      await pressTab();
      stops.push(await active());
    }
    for (let i = 0; i < 2; i++) {
      await pressTab(true);
      stops.push(await active());
    }
    const escaped = stops.filter((s) => !(s.id === "btn-close-modal" && s.insideModal === true));
    check(
      "M2 diff dialog (one control): Tab and Shift+Tab keep focus on the close control, never on the page behind",
      escaped.length === 0,
      JSON.stringify(escaped.slice(0, 3)),
    );
  } catch (e) {
    check("M2 diff-trap walk threw", false, String(e?.message ?? e));
  }

  // --- M3: merge dialog cycles the FULL derived focusable set, then wraps --------
  // Count-agnostic on purpose: the merge dialog carries the comment composer
  // (line input + textarea + submit) plus the close control and the two file
  // tabs, and L4's conditional reveal control may add another. The walk derives
  // the live focusable set exactly as modalFocusables() does and asserts the
  // real invariant — every stop inside the dialog, every element visited once,
  // wrap back to the first — never a hardcoded sequence.
  try {
    await openPage();
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const n = await evl(`(() => {
      const modal = document.getElementById("inspector-modal");
      const set = [...modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.getClientRects().length > 0);
      set.forEach((el, i) => { el.dataset.probe = "f" + i; });
      return set.length;
    })()`);
    const seq = [];
    for (let i = 0; i < n + 1; i++) {
      await pressTab();
      seq.push(await active());
    }
    const probes = seq.map((s) => s.probe);
    const distinct = [...new Set(probes.slice(0, n))];
    check(
      "M3 merge dialog cycle: Tab walks the full derived focusable set and wraps to the first stop, never leaving the dialog",
      n >= 3 &&
      probes.length === n + 1 &&
      distinct.length === n &&
      probes[n] === probes[0] &&
      seq.every((s) => s.insideModal === true) &&
      seq.some((s) => s.mergeTab === "0") &&
      seq.some((s) => s.mergeTab === "1"),
      JSON.stringify({ n, probes }),
    );
  } catch (e) {
    check("M3 merge-cycle walk threw", false, String(e?.message ?? e));
  }

  // --- M4: Shift+Tab wrap (derived last focusable) -------------------------------
  try {
    await openPage();
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const n = await evl(`(() => {
      const modal = document.getElementById("inspector-modal");
      const set = [...modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.getClientRects().length > 0);
      set.forEach((el, i) => { el.dataset.probe = "f" + i; });
      return set.length;
    })()`);
    const firstIsClose = await evl(`!!document.activeElement && document.activeElement.id === "btn-close-modal"`);
    await pressTab(true);
    const wrapped = await active();
    check(
      "M4 Shift+Tab wrap: from the first focusable (close) focus wraps to the last focusable of the derived set",
      firstIsClose === true && n >= 2 && wrapped.probe === `f${n - 1}` && wrapped.insideModal === true,
      JSON.stringify({ wrapped, n }),
    );
    // Backward walk stays inside the dialog and both merge tabs remain reachable.
    const seenTabs = new Set();
    let allInside = wrapped.insideModal === true;
    for (let i = 1; i < n; i++) {
      await pressTab(true);
      const stop = await active();
      allInside = allInside && stop.insideModal === true;
      if (stop.mergeTab !== null) seenTabs.add(stop.mergeTab);
    }
    check(
      "M4 Shift+Tab mid-cycle: the backward walk stays inside the dialog and both merge tabs remain reachable",
      allInside && seenTabs.has("0") && seenTabs.has("1"),
      JSON.stringify({ seen: [...seenTabs], allInside }),
    );
  } catch (e) {
    check("M4 shift-tab walk threw", false, String(e?.message ?? e));
  }

  // --- M5: focus recovery after a re-rendering tab click -------------------------
  try {
    await openPage();
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    await clickEl('#inspector-modal .merge-file-tab[data-merge-tab="1"]');
    const dropped = await evl(`document.activeElement === document.body`);
    const swapped = await evl(`!!document.querySelector('#inspector-modal .merge-file-tab[data-merge-tab="1"].active')`);
    await pressTab();
    const recovered = await active();
    check(
      "M5 focus recovery: a re-rendering tab click drops focus to body and the next Tab lands inside the dialog",
      dropped === true && swapped === true && recovered.insideModal === true && recovered.id === "btn-close-modal",
      JSON.stringify({ dropped, swapped, recovered }),
    );
  } catch (e) {
    check("M5 recovery walk threw", false, String(e?.message ?? e));
  }

  // --- M6: Escape returns focus to the exact trigger -----------------------------
  try {
    await openPage();
    await stampProbe('#card-agent-1 [data-path="README.md"]', "opener-diff");
    await tabTo('#card-agent-1 [data-path="README.md"]');
    await pressEnter();
    await waitFor(`document.querySelectorAll("#inspector-modal .diff-viewer").length === 1`);
    // Strengthened (plan Step 1.6): without this clause the leg passed pre-fix vacuously —
    // focus never left the trigger, so "returned to the trigger" was satisfied by inertia.
    const during = await active();
    check(
      "M6 Escape: focus is inside the dialog (on the close control) while it is open",
      during.id === "btn-close-modal" && during.insideModal === true,
      JSON.stringify(during),
    );
    await pressEscape();
    const closed = await evl(`document.getElementById("inspector-modal").hidden === true`);
    const back = await active();
    check(
      "M6 Escape: closes the dialog and returns focus to the exact view-diff control that opened it",
      closed === true && back.probe === "opener-diff" && back.path === "README.md" && back.dialogs === 1 && back.modalCount === 1,
      JSON.stringify({ closed, back }),
    );
  } catch (e) {
    check("M6 escape-return walk threw", false, String(e?.message ?? e));
  }

  // --- M7: backdrop click returns focus to the exact trigger ---------------------
  try {
    await openPage();
    await stampProbe("#card-agent-1 .btn-preview-merge", "opener-merge");
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const pt = await backdropPoint();
    check("M7 backdrop: a point whose top element is the backdrop exists", pt !== null, JSON.stringify(pt));
    await clickAt(pt);
    const closed = await evl(`document.getElementById("inspector-modal").hidden === true`);
    const back = await active();
    check(
      "M7 backdrop click: closes the dialog and returns focus to the exact preview-merge control",
      closed === true && back.probe === "opener-merge" && back.dialogs === 1 && back.modalCount === 1,
      JSON.stringify({ closed, back }),
    );
  } catch (e) {
    check("M7 backdrop walk threw", false, String(e?.message ?? e));
  }

  // --- M8: the close control returns focus to the exact trigger ------------------
  try {
    await openPage();
    await stampProbe("#card-agent-1 .btn-preview-merge", "opener-merge");
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    await clickEl("#btn-close-modal");
    const closed = await evl(`document.getElementById("inspector-modal").hidden === true`);
    const back = await active();
    check(
      "M8 close control: closes the dialog and returns focus to the exact preview-merge control",
      closed === true && back.probe === "opener-merge" && back.cls.includes("btn-preview-merge") && back.dialogs === 1,
      JSON.stringify({ closed, back }),
    );
  } catch (e) {
    check("M8 close-control walk threw", false, String(e?.message ?? e));
  }

  // --- M9: sequential opens capture their own trigger (never stacking) -----------
  try {
    await openPage();
    await stampProbe('#card-agent-1 [data-path="README.md"]', "opener-diff");
    await tabTo('#card-agent-1 [data-path="README.md"]');
    await pressEnter();
    await waitFor(`document.getElementById("inspector-modal").hidden === false`);
    await pressEscape();
    const firstReturn = await active();
    await stampProbe("#card-agent-1 .btn-preview-merge", "opener-merge");
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const stacked = await active();
    await clickEl("#btn-close-modal");
    const secondReturn = await active();
    check(
      "M9 sequential opens: each open captures its own trigger, one dialog exists throughout, each close returns to its own trigger",
      firstReturn.probe === "opener-diff" && stacked.dialogs === 1 && stacked.modalCount === 1 && secondReturn.probe === "opener-merge",
      JSON.stringify({ firstReturn, stacked, secondReturn }),
    );
  } catch (e) {
    check("M9 sequential-open walk threw", false, String(e?.message ?? e));
  }

  // --- M10: the trap is inert when the dialog is closed --------------------------
  // Repaired (plan Step 1.6 deviation report): the ASCII-diff trigger is the page's LAST
  // focusable, so a forward Tab there exits the document (activeElement=BODY) — the plan's
  // BUTTON/A clause was unsatisfiable. Opening from the mid-page preview-merge control
  // keeps the leg's intent and pins a real, deterministic next control (its DOM successor
  // is the .btn-land button).
  try {
    await openPage();
    await stampProbe("#card-agent-1 .btn-preview-merge", "opener-merge");
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    await pressEscape();
    await pressTab();
    const next = await active();
    check(
      "M10 closed dialog: Tab from the returned trigger advances to the next page control (the trap is inert when closed)",
      next.modalHidden === true && next.insideModal === false && next.tag === "BUTTON" && next.cls.includes("btn-land"),
      JSON.stringify(next),
    );
  } catch (e) {
    check("M10 closed-trap walk threw", false, String(e?.message ?? e));
  }

  // --- M11: stale trigger (re-render while open) ---------------------------------
  try {
    await openPage();
    await stampProbe('#card-agent-1 [data-path="README.md"]', "opener-diff");
    await tabTo('#card-agent-1 [data-path="README.md"]');
    await pressEnter();
    await waitFor(`document.querySelectorAll("#inspector-modal .diff-viewer").length === 1`);
    await evl(`(() => {
      window.__staleOpener = document.querySelector('[data-probe="opener-diff"]');
      document.getElementById("btn-manual-refresh").click();
      return true;
    })()`);
    await waitFor(`!document.contains(window.__staleOpener) && document.querySelectorAll('[data-probe="opener-diff"]').length === 0`);
    await pressEscape();
    const closed = await evl(`document.getElementById("inspector-modal").hidden === true`);
    const live = await evl(`document.contains(document.activeElement) && !document.getElementById("inspector-modal").contains(document.activeElement)`);
    await pressTab();
    const next = await active();
    check(
      "M11 stale trigger: a re-render while open detaches the trigger; closing stays safe, keeps focus live, and the trap does not stick",
      closed === true && live === true && next.modalHidden === true && next.insideModal === false,
      JSON.stringify({ closed, live, next }),
    );
  } catch (e) {
    check("M11 stale-trigger walk threw", false, String(e?.message ?? e));
  }

  // --- M12: merge preview title content -----------------------------------------
  // The merge fixture renders two .merge-file-tab buttons; the modal title must read
  // "Merge preview: {repo}" and the badge must carry the merge status — guarding the
  // tampering seam (a regression swapping the wrong repo's preview into the title).
  try {
    await openPage();
    await tabTo("#card-agent-1 .btn-preview-merge");
    await pressEnter();
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const merged = await evl(`({
      title: document.getElementById("modal-title").textContent,
      badge: document.getElementById("modal-badge").textContent,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      modalCount: document.querySelectorAll("#inspector-modal").length,
    })`);
    check(
      "M12 merge preview: modal-title reads 'Merge preview: agent-1', badge is clean, single modal",
      merged.title === "Merge preview: agent-1" && merged.badge === "clean" && merged.dialogs === 1 && merged.modalCount === 1,
      JSON.stringify(merged),
    );
  } catch (e) {
    check("M12 merge-preview-title walk threw", false, String(e?.message ?? e));
  }

  // --- M13: in-place replacement / one-level depth --------------------------------
  // Opening a second inspector while the first is still open must NOT stack a new modal:
  // openModal's wasHidden guard (app.js:703) skips the return-focus capture on the second
  // open and unconditionally overwrites title/badge/body, leaving the original modal open.
  // The Tab trap stays active while the modal is open, so the second opener is reached
  // via a programmatic .click() dispatch (the modal backdrop sits at z-index 1000 and
  // would intercept a real mouse click at the button geometry).
  try {
    await openPage();
    await stampProbe('#card-agent-1 [data-path="README.md"]', "opener-diff");
    await tabTo('#card-agent-1 [data-path="README.md"]');
    await pressEnter();
    await waitFor(`document.querySelectorAll("#inspector-modal .diff-viewer").length === 1`);
    const before = await evl(`({
      title: document.getElementById("modal-title").textContent,
      visible: document.getElementById("inspector-modal").hidden === false,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    })`);
    check(
      "M13 pre-replace: diff dialog title is 'agent-1 — README.md' and modal is visible",
      before.title === "agent-1 — README.md" && before.visible === true && before.dialogs === 1,
      JSON.stringify(before),
    );
    await evl(`document.querySelector("#card-agent-1 .btn-preview-merge").click()`);
    await waitFor(`document.querySelectorAll(".merge-file-tab").length === 2`);
    const after = await evl(`({
      title: document.getElementById("modal-title").textContent,
      badge: document.getElementById("modal-badge").textContent,
      visible: document.getElementById("inspector-modal").hidden === false,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      modalCount: document.querySelectorAll("#inspector-modal").length,
    })`);
    check(
      "M13 in-place: title switched to 'Merge preview: agent-1', badge clean, one modal still visible (no stacking)",
      after.title === "Merge preview: agent-1" && after.badge === "clean" && after.visible === true && after.dialogs === 1 && after.modalCount === 1,
      JSON.stringify(after),
    );
    await pressEscape();
    const closed = await evl(`document.getElementById("inspector-modal").hidden === true`);
    const back = await active();
    check(
      "M13 Escape: closes the in-place modal and returns focus outside the dialog to the original diff trigger",
      closed === true && back.modalHidden === true && back.insideModal === false && back.probe === "opener-diff" && back.path === "README.md",
      JSON.stringify({ closed, back }),
    );
  } catch (e) {
    check("M13 in-place-replacement walk threw", false, String(e?.message ?? e));
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
