#!/usr/bin/env bun
// Contract suite: NFR-9 / UX-DR-7 prefers-reduced-motion honor across the
// triage app (platform/ui/styles.css). Reduced-motion active → no transition
// or animation runs anywhere; normal mode unchanged. Run:
//   bun porting/tests/ui-reduced-motion.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js)
// is served from a loopback origin into real headless Chrome; the only scripted
// pieces are the HTTP fixture surface and the browser-level media-feature
// override dispatched over CDP. No module mocks, no source grep, no in-page
// observer. Legs:
//   R1 reduced-motion active: no transition/anim anywhere (all * elements)
//   R2 reduced-motion active: the 6 sampled 0.15s/0.12s transitions read 0s
//   R3 reduced-motion active: ticker-pulse stays a static tint (status-green)
//   R4 normal mode (unset): the same 6 transitions restored to 0.15s/0.12s
//   R5 normal mode (unset): ticker-pulse identical to R3
//   R6 pointer parity: click still focuses the card action (no focus-visible)
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible);
// the order's acceptance gate hard-requires Chrome separately.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 320; // matches focus-visible; no transitions run under reduced motion, kept for consistency

const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main", head: "1a".repeat(20) },
  ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 2, cleanPairs: 0 },
  proposals: [{
    repo: "agent-1", head: "2b".repeat(20), intent: "fixture intent",
    landing: { status: "ready" }, stats: { files: 2, additions: 4, deletions: 1 },
    files: [
      { path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false },
      { path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false },
    ],
  }],
  conflicts: [],
};
const EVENTS = { ok: true, events: [] };
const MERGE = { ok: true, merge: { status: "clean", files: [] } };

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
  console.log("SKIP  UI reduced-motion — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-rmotion-"));

// Loopback worker surface: same one-proposal fixture shape as focus-visible.
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
    res.end(JSON.stringify(EVENTS));
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

// Returns { transitionProperty, transitionDuration, animationName, backgroundColor } for a
// single element matching `sel`, read from the real rendered document.
const styleOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    animationName: cs.animationName,
    backgroundColor: cs.backgroundColor,
  };
})()`;

// Reads computed transition/animation state on EVERY element + pseudo. Returns an array of
// { sel, tp, td, an } violations — empty when the kill-switch is live.
const ALL_VIOLATIONS = `(() => {
  const out = [];
  const all = document.querySelectorAll('*');
  const push = (el, pseudo, label) => {
    const cs = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
    const tp = cs.transitionProperty;
    const an = cs.animationName;
    if (tp !== 'none' || an !== 'none') out.push({ sel: label || el.tagName + (el.id ? '#' + el.id : ''), tp, td: cs.transitionDuration, an });
  };
  for (const el of all) {
    const tag = el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(/\s+/).join('.') : '');
    push(el, null, tag);
    push(el, '::before', tag + '::before');
    push(el, '::after', tag + '::after');
  }
  return out;
})()`;

const SAMPLES = [
  { sel: '#auto-refresh-toggle', label: 'toggle-input' },     // .toggle-input  → 0.15s
  { sel: '#btn-manual-refresh', label: 'btn-refresh' },      // .btn-refresh    → 0.15s
  { sel: '.btn-tour-help', label: 'btn-tour-help' },          //                 → 0.15s
  { sel: '.summary-chip', label: 'summary-chip' },            //                 → 0.15s
  { sel: '.proposal-card', label: 'proposal-card' },          //                 → 0.15s
  { sel: '#card-agent-1 .btn-card-action', label: 'btn-card-action' }, // → 0.12s
];

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
  const send = (m, p = {}) => browser.send(m, p, sessionId);
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
        ok = false;
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

  const openPage = async () => {
    mode = "ok";
    await navigate("/index.html");
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
    await evl(`(() => { const t = document.getElementById("auto-refresh-toggle"); if (t) { t.checked = false; t.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  };

  const setReduced = async (reduce) =>
    await send("Emulation.setEmulatedMedia", {
      media: "",
      features: reduce ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
    });

  // --- R1: reduced-motion active — no transition/animation anywhere ----------------
  try {
    await openPage();
    await setReduced(true);
    await sleep(SETTLE_MS);
    const violations = await evl(ALL_VIOLATIONS);
    check(
      "R1 reduced-motion active: no element or pseudo has a transition/animation",
      Array.isArray(violations) && violations.length === 0,
      Array.isArray(violations) ? `violations=${violations.length} e.g. ${JSON.stringify(violations.slice(0, 3))}` : String(violations),
    );
  } catch (e) {
    check("R1 reduced-motion walk threw", false, String(e?.message ?? e));
  }

  // --- R2: the 6 sampled transitions read 0s under reduce -------------------------
  try {
    await setReduced(true);
    await sleep(SETTLE_MS);
    const pairs = [];
    for (const s of SAMPLES) {
      pairs.push({ sample: s, read: await evl(styleOf(s.sel)) });
    }
    const bad = pairs.filter((p) => !p.read || p.read.transitionDuration !== "0s");
    check(
      "R2 reduced-motion active: all 6 sampled transitions resolve to 0s",
      pairs.every((p) => p.read && p.read.transitionDuration === "0s"),
      bad.length ? `still animated: ${JSON.stringify(bad.map((p) => ({ name: p.sample.label, td: p.read.transitionDuration })))}` : `reads=${JSON.stringify(pairs.map((p) => p.read.transitionDuration))}`,
    );
  } catch (e) {
    check("R2 sampled-transitions walk threw", false, String(e?.message ?? e));
  }

  // --- R3: ticker-pulse is a static tint (status-green) under reduce ----------------
  try {
    await setReduced(true);
    await sleep(SETTLE_MS);
    const pulse = await evl(styleOf(".ticker-pulse"));
    check(
      "R3 reduced-motion active: ticker-pulse is the static status-green tint",
      pulse && pulse.transitionDuration === "0s" && pulse.animationName === "none" && pulse.backgroundColor === "rgb(46, 160, 67)",
      JSON.stringify(pulse),
    );
  } catch (e) {
    check("R3 ticker-pulse walk threw", false, String(e?.message ?? e));
  }

  // --- R4: normal mode (unset) — the 6 transitions restored to 0.15s/0.12s ----------
  try {
    await setReduced(false);
    await sleep(SETTLE_MS);
    const reads = [];
    for (const s of SAMPLES) reads.push(await evl(styleOf(s.sel)));
    const toggle = reads[0];
    const card = reads[5];
    check(
      "R4 normal mode: transitions preserved (toggle 0.15s, card action 0.12s, all 6 sampled)",
      reads.length === 6 && toggle && toggle.transitionDuration.includes("0.15s") && card && card.transitionDuration === "0.12s" && reads.slice(0, 5).every((r) => r && r.transitionDuration.includes("0.15s")),
      JSON.stringify(reads.map((r) => r.transitionDuration)),
    );
  } catch (e) {
    check("R4 normal-mode walk threw", false, String(e?.message ?? e));
  }

  // --- R5: normal mode (unset) — ticker-pulse identical to R3 -----------------------
  try {
    await setReduced(false);
    await sleep(SETTLE_MS);
    const pulse = await evl(styleOf(".ticker-pulse"));
    check(
      "R5 normal mode: ticker-pulse is the static status-green tint (unchanged)",
      pulse && pulse.transitionDuration === "0s" && pulse.backgroundColor === "rgb(46, 160, 67)",
      JSON.stringify(pulse),
    );
  } catch (e) {
    check("R5 ticker-pulse normal walk threw", false, String(e?.message ?? e));
  }

  // --- R6: pointer parity — click still focuses, no focus-visible outline -----------
  try {
    await setReduced(true);
    await sleep(SETTLE_MS);
    await evl(`(() => { const el = document.querySelector('#card-agent-1 .btn-card-action'); if (el) { el.scrollIntoView({block:'center'}); return true; } return false; })()`);
    const pt = await evl(`(() => {
      const el = document.querySelector('#card-agent-1 .btn-card-action');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()`);
    if (pt) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
      await sleep(SETTLE_MS);
    }
    const r = await evl(`(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { id: el.id, cls: el.className, fv: el.matches(':focus-visible'), outlineWidth: cs.outlineWidth };
    })()`);
    check(
      "R6 reduced-motion: click focuses the card action without a focus-visible outline",
      r && r.id === "btn-close-modal" && r.fv === false && r.outlineWidth === "0px",
      JSON.stringify(r),
    );
  } catch (e) {
    check("R6 pointer-parity walk threw", false, String(e?.message ?? e));
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
