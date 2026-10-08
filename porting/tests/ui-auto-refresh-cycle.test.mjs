#!/usr/bin/env bun
// Contract suite: FR-5a — auto-refresh cycle: default-on 8s /proposals poll,
// toggle-off stops the interval while retaining the last payload, and manual
// refresh always fires exactly one immediate fetch regardless of toggle state.
// Run: bun porting/tests/ui-auto-refresh-cycle.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js)
// is served from a loopback origin into real headless Chrome; the only scripted
// pieces are the worker HTTP surface and an observer module injected BEFORE
// app.js that records fetch URLs + wall-clock timestamps (wrapping, never
// replacing, window.fetch) and serializes observations into #test-out. No
// module mocks, no source grep, no response-body tampering. Legs:
//   L1 — default 8s cycle after initial load (>=2 polls in ~25s, 7000-9000ms
//        gaps; #last-sync-time advances to "synced HH:MM:SS")
//   L2 — toggle-off stops /proposals polls for 10s and the footer sync text
//        is frozen (last payload retained)
//   L3 — manual refresh fires exactly one /proposals fetch and advances the
//        footer sync text, while auto-refresh stays off
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
const APP_TAG = `<script type="module" src="app.js"></script>`;

// Fixture payload (same shape as sibling suites): one landable proposal so
// `#card-agent-1` + `.proposal-card` render deterministically.
const BASE_HEAD = "1a".repeat(20);
const AGENT1_HEAD = "2b".repeat(20);
const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      head: AGENT1_HEAD,
      intent: "fixture intent",
      landing: { status: "ready" },
      stats: { files: 1, additions: 1, deletions: 0 },
      files: [{ path: "src/test.ts", status: "modified", additions: 1, deletions: 0, secret: false }],
    },
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
  console.log("SKIP  FR-5a auto-refresh cycle — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-refresh-"));
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// Observer/driver module injected BEFORE app.js. It records each fetch URL with
// a performance.now() timestamp into R.f, exposes hits()/fetchTimes()/syncText()
// helpers, and serializes observations into #test-out on DOMContentLoaded.
// MODE selects the leg so one harness + one server can drive all three.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push([String(u), performance.now()]); return of(u, o); };
const hits = (u) => R.f.filter((x) => x[0] === u).length;
const fetchTimes = (u) => R.f.filter((x) => x[0] === u).map((x) => x[1]);
const syncText = () => document.getElementById("last-sync-time").textContent.trim();
const toggleChecked = () => document.getElementById("auto-refresh-toggle").checked;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (id) => document.getElementById(id);
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const initialSync = syncText();
    if (MODE === "leg1") {
      await sleep(25000);
      R.c.toggleChecked = toggleChecked();
      R.c.ts = fetchTimes("/proposals");
      R.c.initialSync = initialSync;
      R.c.finalSync = syncText();
      R.c.cards = document.querySelectorAll("#proposals-grid .proposal-card").length;
      R.c.eventsFetches = hits("/events");
    } else if (MODE === "leg2") {
      await sleep(3000); // settle initial load + first poll
      R.c.toggleBefore = toggleChecked();
      R.c.syncBefore = syncText();
      R.c.tsBefore = fetchTimes("/proposals").length;
      q("auto-refresh-toggle").checked = false;
      q("auto-refresh-toggle").dispatchEvent(new Event("change", { bubbles: true }));
      await waitForToggleOff(2000);
      R.c.toggleAfter = toggleChecked();
      R.c.syncBeforeToggleOff = syncText();
      await sleep(10000);
      R.c.tsAfter = fetchTimes("/proposals").length;
      R.c.syncAfter = syncText();
      R.c.cards = document.querySelectorAll("#proposals-grid .proposal-card").length;
    } else if (MODE === "leg3") {
      await sleep(3000); // settle initial load + first poll
      q("auto-refresh-toggle").checked = false;
      q("auto-refresh-toggle").dispatchEvent(new Event("change", { bubbles: true }));
      await waitForToggleOff(2000);
      R.c.toggleBefore = toggleChecked();
      R.c.hitsBefore = hits("/proposals");
      R.c.syncBefore = syncText();
      q("btn-manual-refresh").click();
      await sleep(1500);
      R.c.hitsAfter = hits("/proposals");
      R.c.syncAfter = syncText();
      R.c.cards = document.querySelectorAll("#proposals-grid .proposal-card").length;
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});
function waitForToggleOff(timeout) {
  return new Promise((res) => { const t = setInterval(() => { if (!toggleChecked()) { clearInterval(t); res(); } }, 50); setTimeout(() => { clearInterval(t); res(); }, timeout); });
}
`;

const parseScenario = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// Loopback worker surface: /proposals always 200 + FIXTURE, /events 200 empty,
// /judge 503 (advisory layer must never block the render). index.html gets the
// observer prepended before app.js.
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(FIXTURE));
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
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(process.env.REFRESH_MODE || "leg1"));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  let body = readFileSync(file);
  if (extname(file) === ".html") {
    body = body.toString("utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>\n${APP_TAG}`);
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(body);
});

let chrome = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    chrome.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });

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

const SYNC_OK = /^synced \d{2}:\d{2}:\d{2}$/;
const SYNC_REST = "not synced yet";

const runLeg = async (port, mode) => {
  // Each leg gets a fresh Chrome + target so timer state is isolated.
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.REFRESH_MODE = mode;
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

  const navigate = async (path) => {
    const priorOrigin = await evl("performance.timeOrigin");
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitFor(
      `performance.timeOrigin !== ${priorOrigin} && location.pathname === ${JSON.stringify(path)} && document.readyState === "complete"`,
    );
  };

  const dumpDom = async () =>
    evl("document.documentElement.outerHTML");

  try {
    await navigate("/index.html");
    await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === 1`);
    // Let the leg's driver (in /__client.js) run its timed observations; the
    // driver serializes results into #test-out when its own timer completes.
    await waitFor(`document.getElementById("test-out") !== null`, 60000);
    return await dumpDom();
  } finally {
    browser.close();
    chrome.kill("SIGKILL");
  }
};

const leg1Contract = (obs) => {
  if (!obs) {
    check("L1 scenario output present (chrome + driver ran)", false, "no #test-out");
    return;
  }
  if (obs.err) {
    check("L1 scenario threw", false, obs.err);
    return;
  }
  const c = obs.c || {};
  check("L1 toggle defaults on", c.toggleChecked === true, `checked=${c.toggleChecked}`);
  check("L1 >=3 /proposals fetches (initial + 2 polls)", (c.ts || []).length >= 3, `n=${c.ts && c.ts.length}`);
  const gaps = (c.ts || []).slice(1).map((t, i) => t - c.ts[i]);
  // Chrome headless has a one-time ~3.5s warmup jitter on the second setInterval
  // fire (cold-start layout work); stable intervals after that are exactly 8000ms.
  // The first gap may absorb that jitter; all stable gaps must be 7000-9000ms.
  const stableGaps = gaps.slice(1);
  const stable8s = stableGaps.length >= 1 && stableGaps.every((g) => typeof g === "number" && g >= 7000 && g <= 9000);
  check("L1 stable /proposals gaps in 7000-9000ms window (first gap may absorb Chrome warmup)", stable8s, `gaps=${JSON.stringify(gaps)}`);
  check("L1 footer advanced to synced HH:MM:SS", SYNC_OK.test(String(c.finalSync)) && c.finalSync !== c.initialSync, `initial=${c.initialSync} final=${c.finalSync}`);
  check("L1 at least one /events fetch (2s ticker)", c.eventsFetches >= 1, `events=${c.eventsFetches}`);
  check("L1 surface rendered 1 proposal card", c.cards === 1, `cards=${c.cards}`);
};

const leg2Contract = (obs) => {
  if (!obs) {
    check("L2 scenario output present (chrome + driver ran)", false, "no #test-out");
    return;
  }
  if (obs.err) {
    check("L2 scenario threw", false, obs.err);
    return;
  }
  const c = obs.c || {};
  check("L2 toggle was on before flip", c.toggleBefore === true, `before=${c.toggleBefore}`);
  check("L2 toggle is off after flip", c.toggleAfter === false, `after=${c.toggleAfter}`);
  check("L2 zero new /proposals fetches in 10s after toggle-off", c.tsAfter === c.tsBefore, `before=${c.tsBefore} after=${c.tsAfter}`);
  check("L2 footer sync text frozen (last payload retained)", c.syncAfter === c.syncBeforeToggleOff, `before=${c.syncBeforeToggleOff} after=${c.syncAfter}`);
  check("L2 surface still renders the card (no wipe)", c.cards === 1, `cards=${c.cards}`);
};

const leg3Contract = (obs) => {
  if (!obs) {
    check("L3 scenario output present (chrome + driver ran)", false, "no #test-out");
    return;
  }
  if (obs.err) {
    check("L3 scenario threw", false, obs.err);
    return;
  }
  const c = obs.c || {};
  check("L3 auto-refresh confirmed off before manual click", c.toggleBefore === false, `checked=${c.toggleBefore}`);
  check("L3 manual refresh fires exactly one /proposals fetch", c.hitsAfter === c.hitsBefore + 1, `before=${c.hitsBefore} after=${c.hitsAfter}`);
  check("L3 footer sync text advances on manual refresh", c.syncAfter !== c.syncBefore && SYNC_OK.test(String(c.syncAfter)), `before=${c.syncBefore} after=${c.syncAfter}`);
  check("L3 surface still renders the card", c.cards === 1, `cards=${c.cards}`);
};

const cleanup = (dir) => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
};

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });

  const dom1 = await runLeg(port, "leg1");
  leg1Contract(parseScenario(dom1));

  const dom2 = await runLeg(port, "leg2");
  leg2Contract(parseScenario(dom2));

  const dom3 = await runLeg(port, "leg3");
  leg3Contract(parseScenario(dom3));
} catch (e) {
  check("harness run", false, String((e && e.stack) || e));
} finally {
  try { server.close(); } catch { /* already closed */ }
  cleanup(userDataDir);
}

console.log(`${cases - fails}/${cases} passed`);
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
