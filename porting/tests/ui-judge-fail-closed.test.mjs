#!/usr/bin/env bun
// Contract suite: verify pinned-model fail-closed 503s surface as silent UI
// degradation — zero judge chips, no banners, land actions remain enabled.
// Run: bun porting/tests/ui-judge-fail-closed.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in real
// headless Chrome over a loopback origin. The only scripted pieces are the worker's
// HTTP surface (which fixture /proposals serves, and /judge returning 503) and an
// observer module injected BEFORE app.js that records fetch calls and sniffs the
// rendered DOM — no product mocks, no source grep.
//
// Fixture: 5 proposal cards matching the live demo shape per CHECKPOINT.md:
//   agent-1 / agent-2 — collide on src/auth.ts (landing.status=conflict)
//   agent-3            — identical to base, no files (stats.files=0 → isLanded)
//   agent-4            — secret-class config/.env (landing.status=withheld-secret)
//   agent-5            — intent-less, landable (landing.status=ready)
//
// Assertions (6 checks):
//   1. judge 503: cards still render (>= 5 proposal-card elements)
//   2. judge 503: zero judge chips (no .badge inside any proposal-card contains
//      judge chip text: "risk:", "intent verified", "intent mismatch", "insufficient",
//      "soft collision")
//   3. judge 503: connection banner stays hidden
//   4. judge 503: action banner stays hidden
//   5. judge 503: land buttons enabled on ready cards (every non-landed,
//      non-conflict, non-withheld-secret card has .btn-land without disabled)
//   6. judge 503: maybeJudge attempted (at least 1 fetch to /judge recorded)
//
// A box without a Chrome binary skips the suite (precedent: ui-card-contract-states /
// connection-error-surface; the order's acceptance gate hard-requires Chrome).


import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

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
  console.log("SKIP  judge-fail-closed — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-judgefail-"));

// ---------------------------------------------------------------------------
// Fixture: 5 proposals matching the live demo shape.
// agent-1 + agent-2 collide on src/auth.ts → landing.status=conflict
// agent-3 has no files → stats.files=0 → isLanded (landed, no btn-land)
// agent-4 has a secret-class config/.env → landing.status=withheld-secret
// agent-5 is intent-less and ready → has an enabled btn-land
// ---------------------------------------------------------------------------
const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "1a".repeat(20) },
  ref: "main",
  summary: { proposals: 5, sharedFiles: 1, conflictingPairs: 1, changedFiles: 3, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      intent: "harden the auth flow",
      landing: { status: "conflict", files: 1 },
      stats: { files: 1, additions: 8, deletions: 2 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 8, deletions: 2, secret: false }],
    },
    {
      repo: "agent-2",
      intent: "update auth middleware",
      landing: { status: "conflict", files: 1 },
      stats: { files: 1, additions: 5, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 5, deletions: 1, secret: false }],
    },
    {
      repo: "agent-3",
      intent: "no changes",
      landing: { status: "landed", commit: "abc1234", files: 0 },
      stats: { files: 0, additions: 0, deletions: 0 },
      files: [],
    },
    {
      repo: "agent-4",
      intent: "rotate secret config",
      landing: { status: "withheld-secret", files: 1 },
      stats: { files: 1, additions: 3, deletions: 0 },
      files: [{ path: "config/.env", status: "modified", additions: 3, deletions: 0, secret: true, keys: ["API_TOKEN"] }],
    },
    {
      repo: "agent-5",
      stats: { files: 1, additions: 2, deletions: 1 },
      files: [{ path: "src/util.ts", status: "modified", additions: 2, deletions: 1, secret: false }],
    },
  ],
  conflicts: [
    {
      file: "src/auth.ts",
      kind: "text-conflict",
      repos: ["agent-1", "agent-2"],
      pairs: [{ a: "agent-1", b: "agent-2", kind: "text-conflict", region: { baseLines: 2, aLines: 8, bLines: 5 } }],
    },
  ],
  landing: {},
};

const EVENTS = { ok: true, events: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Wraps (never replaces) window.fetch to
// record every URL fetched. After DOMContentLoaded + a 2000ms settle (lets the
// initial /proposals + /judge + /events cycle complete), reads the rendered DOM for:
//   - proposal card count
//   - any badge text containing judge chip vocabulary (risk:, intent verified, etc.)
//   - connection-banner hidden attribute
//   - action-banner hidden attribute
//   - btn-land buttons on ready (non-landed/conflict/withheld-secret) cards
//   - /judge fetch count
// Serializes observations into #test-out.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(2000);
    R.c.cardCount = document.querySelectorAll(".proposal-card").length;
    // Collect all badge texts inside proposal cards
    R.c.badgeTexts = qs(".proposal-card .badge").map((b) => b.textContent.trim());
    // Judge chip vocabulary words that must NEVER appear when /judge is 503
    R.c.judgeChipTexts = R.c.badgeTexts.filter((t) =>
      t.includes("risk:") || t === "intent verified" || t === "intent mismatch" ||
      t === "insufficient" || t === "soft collision"
    );
    // Check banners
    R.c.connectionBannerHidden = q("#connection-banner") ? q("#connection-banner").hidden === true : true;
    R.c.actionBannerHidden = q("#action-banner") ? q("#action-banner").hidden === true : true;
    // Check land buttons on ready cards: every .proposal-card that does NOT have
    // is-landed, is-withheld-secret, or is-conflict should have a .btn-land without
    // the disabled attribute.
    const cards = qs(".proposal-card");
    R.c.landingChecks = cards.map((c) => {
      const cls = c.className || "";
      const isLanded = cls.includes("is-landed");
      const isWithheld = cls.includes("is-withheld-secret");
      const isConflict = cls.includes("is-conflict");
      const landBtn = c.querySelector(".btn-land");
      const enabled = !!landBtn && !landBtn.hasAttribute("disabled");
      // A ready card is one that is NOT landed, NOT conflict, NOT withheld-secret
      const isReady = !isLanded && !isWithheld && !isConflict;
      return {
        repo: c.id.replace("card-", ""),
        isReady,
        hasLandBtn: !!landBtn,
        landBtnEnabled: enabled,
        classes: cls,
      };
    });
    // Count /judge fetches
    R.c.judgeFetches = R.f.filter((x) => x === "/judge").length;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// CDP harness (mirrors event-debounce-land-reload.test.mjs)
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let chrome = null;
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

// ---------------------------------------------------------------------------
// Loopback worker surface
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(FIXTURE));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(EVENTS));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "judge-unavailable" }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  if (pathname === "/land") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, landed: { status: "landed" } }));
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") {
    const html = readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

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

  await send("Page.navigate", { url });
  await waitFor(`document.getElementById("test-out") !== null`, 45000);
  const obs = await evl(`(function(){ const d = document.getElementById("test-out"); return d ? JSON.parse(decodeURIComponent(d.textContent)) : null; })()`);

  if (!obs) {
    check("scenario output present (chrome + driver ran)", false, "no #test-out in DOM");
  } else if (obs.err) {
    check("scenario threw", false, obs.err);
  } else {
    const c = obs.c || {};

    // 1. cards still render with judge unavailable
    check("judge 503: cards still render", (c.cardCount || 0) >= 5, `cards=${c.cardCount}`);

    // 2. zero judge chips when judge is unavailable
    check("judge 503: zero judge chips", c.judgeChipTexts.length === 0, JSON.stringify(c.judgeChipTexts));

    // 3. connection banner stays hidden
    check("judge 503: connection banner stays hidden", c.connectionBannerHidden === true, `hidden=${c.connectionBannerHidden}`);

    // 4. action banner stays hidden
    check("judge 503: action banner stays hidden", c.actionBannerHidden === true, `hidden=${c.actionBannerHidden}`);

    // 5. land buttons enabled on ready cards
    //    Ready cards are those that are NOT landed, NOT conflict, NOT withheld-secret.
    //    agent-5 is the only ready card in the fixture.
    const readyChecks = (c.landingChecks || []).filter((lc) => lc.isReady);
    const allReadyHaveEnabledLand = readyChecks.length > 0 && readyChecks.every((lc) => lc.hasLandBtn && lc.landBtnEnabled === true);
    check("judge 503: land buttons enabled on ready cards", allReadyHaveEnabledLand, JSON.stringify(readyChecks));

    // 6. maybeJudge attempted (at least 1 fetch to /judge)
    check("judge 503: maybeJudge attempted", (c.judgeFetches || 0) >= 1, `judgeFetches=${c.judgeFetches}`);
  }
} catch (e) {
  check("judge-fail-closed case threw", false, String(e?.stack ?? e));
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => { clearTimeout(timer); resolve(); });
  });
  if (chrome) chrome.kill("SIGKILL");
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
