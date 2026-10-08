#!/usr/bin/env bun
// Contract suite: FR-5b — event debounce + land-triggered reload + card convergence.
// Run: bun porting/tests/event-debounce-land-reload.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is
// loaded in real headless Chrome over a loopback origin (no virtual-time budget, so
// real wall-clock timing governs the 500ms debounce and the 2s/8s polls). The only
// scripted surface is the worker HTTP layer — a loopback Node http server whose /events
// flips its top-event key on the 2nd poll, whose /proposals serves a pre-land payload
// until POST /land is served then returns the landed variant, and whose /land answers
// 200. An observer module is injected BEFORE app.js: it wraps (never replaces)
// window.fetch, recording each fetch URL + performance.now() timestamp into R.f, then
// drives the real controls (start-land -> confirm-land) and snapshots the landed card.
// No module mocks, no source grep, no response-body tampering of the product code.
//
// Temporal segmentation (remedies the false-green / window-collision findings):
//   • debounce observation window is CLOSED (flipTs+1500ms) BEFORE any land interaction
//     is driven, so the land-triggered /proposals fetch can never be counted as the
//     debounced refresh;
//   • land-reload checks are anchored to the /land fetch timestamp and assert an
//     *immediate* fetch (delta < 300ms, smaller than the 2s poll period) — the first
//     /events fetch strictly after /land — so removing `await loadEvents()` from the
//     success path makes the assertion go red (the periodic tick is ~1.2s+ later and
//     is the SECOND post-land fetch, not the first);
//   • event keys use a distinct `repo` per poll so app.js's composed
//     `${type}:${repo}:${at}:${after}` key genuinely differs (the observer never
//     parses the key, so ISO-timestamp colons cannot collapse it).
//
// A box without a Chrome binary skips the suite (precedent: ui-auto-refresh-cycle /
// ui-first-load-panels; the order's acceptance gate hard-requires Chrome).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;
const COMMIT = "0123456789abcdef";

// Fixture payloads. Two proposals: agent-1 (landable, gets landed) and agent-2 (already
// landed, scopes the reset). Reviewed-state anchors are present so the canvas binds the
// land to the rendered revision (FR-16), mirroring action-banner-states / ui-land-reviewed-heads.
const BASE_HEAD = "1a".repeat(20);
const AGENT1_HEAD = "2b".repeat(20);
const AGENT2_HEAD = "3c".repeat(20);

const PRE_LAND = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 2, sharedFiles: 0, conflictingPairs: 0, changedFiles: 2, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      head: AGENT1_HEAD,
      intent: "harden the auth flow",
      landing: { status: "ready" },
      stats: { files: 1, additions: 3, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }],
    },
    {
      repo: "agent-2",
      head: AGENT2_HEAD,
      intent: "document the baseline",
      landing: { status: "landed" },
      stats: { files: 1, additions: 1, deletions: 0 },
      files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }],
    },
  ],
  conflicts: [],
  landing: {},
};

// POST-land payload: agent-1 now carries landing.status "landed" (the server-side fold
// reported zero net changes for it — already in base after the agent-2 land).
const POST_LAND = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 2, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 2 },
  proposals: [
    {
      repo: "agent-1",
      head: AGENT1_HEAD,
      intent: "harden the auth flow",
      landing: { status: "landed" },
      stats: { files: 2, additions: 3, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }],
    },
    {
      repo: "agent-2",
      head: AGENT2_HEAD,
      intent: "document the baseline",
      landing: { status: "landed" },
      stats: { files: 1, additions: 1, deletions: 0 },
      files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }],
    },
  ],
  conflicts: [],
  landing: { status: "landed", commit: COMMIT },
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
  console.log("SKIP  FR-5b event-debounce + land reload + card convergence — no Chrome binary on PATH");
  process.exit(77); // POSIX skip: Chrome absent, not a failure
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-debounce-"));
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// Observer + driver, injected BEFORE app.js. It records each fetch URL with a
// performance.now() timestamp into R.f (wrapping, never replacing window.fetch), then
// drives the land interaction and snapshots the converged card. Timing is real
// (no virtual-time budget) so the 500ms debounce is observable at wall-clock scale.
const makeClientScript = () => `
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push([String(u), performance.now()]); return of(u, o); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x[0] === u).length;
const fetchTimes = (u) => R.f.filter((x) => x[0] === u).map((x) => x[1]);
const waitHits = (u, min, budget) => new Promise((res) => {
  const end = performance.now() + (budget || 8000);
  const iv = setInterval(() => { if (hits(u) >= min) { clearInterval(iv); res(); } }, 40);
  const to = setTimeout(() => { clearInterval(iv); res(); }, Math.max(0, end - performance.now()));
});
const waitMin = async (target) => { const remain = target - performance.now(); if (remain > 0) await sleep(remain); };
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Phase 1 — debounce: wait for the 2nd /events poll (the flip) and the resulting
    // debounced /proposals. /events is polled every 2s; the flip lands on poll 2.
    await sleep(600); // initial load + init()'s synchronous loadEvents
    await waitHits("/events", 2, 5000);
    R.flipTs = fetchTimes("/events")[1]; // 2nd /events fetch = flipped top-event key
    R.flipped = true;
    await waitHits("/proposals", 2, 4000); // initial + debounced
    R.debouncePropTs = fetchTimes("/proposals")[1];
    R.debounced = true;
    // Close the debounce observation window before touching land, so the landing
    // reload can never be mistaken for the debounced refresh.
    await waitMin((R.flipTs || 0) + 1500);

    // Phase 2 — land: click start-land -> confirm-land on agent-1 (a real landable card).
    const start = document.querySelector('[data-action="start-land"]');
    R.repo = start ? start.getAttribute("data-repo") : null;
    if (!start) { R.actionMissing = true; }
    else {
      start.click();
      const conf = document.querySelector('[data-action="confirm-land"]');
      R.confirmShown = !!(conf && conf.textContent.trim() === "confirm land?");
      if (conf) conf.click();
      await waitHits("/land", 1, 5000);
      R.landTs = fetchTimes("/land")[0];
      await sleep(1500); // settle land-triggered reloads + at least one periodic tick
    }

    // Snapshot the converged card state.
    const card = R.repo ? cardOf(R.repo) : null;
    R.cardClasses = card ? card.getAttribute("class") : null;
    R.cardHasLandedClass = card ? card.classList.contains("is-landed") : false;
    const banner = card ? card.querySelector(".landed-banner") : null;
    const statusEl = card ? card.querySelector(".landed-status") : null;
    R.landedText = statusEl ? statusEl.textContent.trim() : null;
    R.hasLandedBanner = !!banner;
    const badge = card ? card.querySelector(".badge.badge-neutral") : null;
    R.badgeText = badge ? badge.textContent.trim() : null;
    R.landedBadgeCls = badge ? badge.className.trim() : null;
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

// Loopback worker surface: /events flips the top-event key on the 2nd poll via an
// independent poll counter (NOT gated on landServed, which would still be 0 on the
// 2nd poll and never produce a key change); /proposals serves PRE_LAND until POST /land
// is served once, then POST_LAND; /land 200.
let landServed = 0;
let eventsPoll = 0;
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(landServed >= 1 ? POST_LAND : PRE_LAND));
    return;
  }
  if (pathname === "/events") {
    eventsPoll++;
    res.writeHead(200, { "content-type": "application/json" });
    // Poll 1 (init): agent-2. Poll 2+ (the 2s tick): agent-3 — a distinct top-event key
    // that app.js's loadEvents detects (lastEventSeenAt changes) and debounces.
    const ev = eventsPoll <= 1
      ? { type: "push", repo: "agent-2", at: "2026-10-07T10:00:01Z", after: "aaa001" }
      : { type: "push", repo: "agent-3", at: "2026-10-07T10:00:02Z", after: "bbb002" };
    res.end(JSON.stringify({ ok: true, events: [ev] }));
    return;
  }
  if (pathname === "/land") {
    landServed++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, landed: { commit: COMMIT } }));
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

const contract = (obs) => {
  if (!obs) { check("scenario output present (chrome + driver ran)", false, "no #test-out"); return; }
  if (obs.err) { check("scenario threw", false, obs.err); return; }
  const f = obs.f || [];
  const propTimes = f.filter((x) => x[0] === "/proposals").map((x) => x[1]);
  const evTimes = f.filter((x) => x[0] === "/events").map((x) => x[1]);
  const landTimes = f.filter((x) => x[0] === "/land").map((x) => x[1]);

  // ---- Leg A: event debounce ----
  check("A1 flipped /events poll observed", evTimes.length >= 2, `evTimes.length=${evTimes.length}`);
  check("A2 debounced /proposals fetch observed", propTimes.length >= 2, `propTimes.length=${propTimes.length}`);
  check("A3 driver targeted a landable card", obs.repo === "agent-1", `repo=${obs.repo}`);
  if (obs.flipTs != null && obs.debouncePropTs != null) {
    const delta = obs.debouncePropTs - obs.flipTs;
    check("A4 exactly one debounced /proposals fetch in window (flip+300, flip+1200)",
      propTimes.filter((t) => t > obs.flipTs + 300 && t < obs.flipTs + 1200).length === 1,
      `delta=${delta}`);
    check("A5 debounced refresh is ~500ms (300-900ms) after the flipped /events poll",
      delta > 300 && delta < 900, `delta=${delta}`);
    // Mutation guard: no /land fetch occurred before the debounce window closed.
    check("A6 no /land fetch before the debounce window closed",
      landTimes.length === 0 || Math.min(...landTimes) > obs.flipTs + 1200);
  } else {
    check("A4 debounced /proposals timing (insufficient observations)", false, `flipTs=${obs.flipTs} debouncePropTs=${obs.debouncePropTs}`);
  }

  // ---- Leg B: land reloads both feeds (anchored, immediate-fetch predicate) ----
  check("B1 inline confirm appeared on the target card", obs.confirmShown === true);
  check("B2 land served exactly one /land request", landTimes.length === 1, `n=${landTimes.length}`);
  if (landTimes.length === 1) {
    const landTs = landTimes[0];
    const propAfter = propTimes.filter((t) => t > landTs);
    const evAfter = evTimes.filter((t) => t > landTs);
    check("B3 land triggered an immediate /proposals reload (first /proposals after /land < 300ms)",
      propAfter.length >= 1 && (propAfter[0] - landTs) < 300, `first=${propAfter.length ? propAfter[0] - landTs : "n/a"}`);
    // The first /events fetch strictly after /land is the land-triggered loadEvents() call;
    // the 2s periodic tick is the SECOND such fetch (~1.2s+ later), so this isolates the
    // success-path reload and fails if `await loadEvents()` is removed.
    // Guard against tick-coincidence: derive the predicted next tick from pre-land evTimes
    // and reject the first post-land /events fetch if it falls within 100ms of that tick.
    const preLandEv = evTimes.filter((t) => t < landTs);
    const tickGap = preLandEv.length >= 2 ? preLandEv[preLandEv.length - 1] - preLandEv[preLandEv.length - 2] : 2000;
    const predictedTick = preLandEv.length >= 1 ? preLandEv[preLandEv.length - 1] + tickGap : landTs + 2000;
    check("B4 land triggered an immediate /events reload (first /events after /land < 300ms, not a tick)",
      evAfter.length >= 1 && (evAfter[0] - landTs) < 300 && Math.abs(evAfter[0] - predictedTick) > 100,
      `first=${evAfter.length ? evAfter[0] - landTs : "n/a"} tickDelta=${Math.abs(evAfter[0] - predictedTick)}ms`);
  } else {
    check("B3 land /proposals reload (no /land observed)", false);
    check("B4 land /events reload (no /land observed)", false);
  }

  // ---- Leg C: card converges to server truth ----
  check("C1 card gained the is-landed class after the post-land payload", obs.cardHasLandedClass === true, `classes=${obs.cardClasses}`);
  check("C2 landed-banner renders", obs.hasLandedBanner === true);
  check("C3 landed-banner text exact ('landed — nothing pending')", obs.landedText === "landed — nothing pending", `text=${obs.landedText}`);
  check("C4 landed badge class is badge badge-neutral", obs.landedBadgeCls === "badge badge-neutral", `cls=${obs.landedBadgeCls}`);
  check("C5 landed badge text is 'landed'", obs.badgeText === "landed", `text=${obs.badgeText}`);
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
  const waitFor = async (expression, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (; ;) {
      let ok = false;
      try { ok = await evl(`Boolean(${expression})`); } catch { ok = false; }
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
