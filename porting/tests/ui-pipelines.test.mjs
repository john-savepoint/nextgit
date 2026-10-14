#!/usr/bin/env bun
// Contract suite: the pipelines panel RENDER layer (nextgit-e17).
// Run: bun porting/tests/ui-pipelines.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + the real
// module graph) is loaded in real headless Chrome over a loopback
// origin. The only scripted pieces are the worker's HTTP surface
// (which fixture /pipelines serves) and an observer module injected
// BEFORE app.js that records fetch calls and sniffs the rendered DOM
// — no product mocks, no module mock, no source grep.
//
// Fixture /pipelines payloads drive the render:
//   1. Rows carry id / repos / at / status / attestation / link
//      verbatim; an XSS-probe fixture value containing <img onerror>
//      renders as escaped text (the parity-dashboard leg).
//   2. Status chips carry the server's status verbatim; an unknown
//      status value renders the neutral `unknown` class, never
//      `passed` (honesty leg).
//   3. Attestation badges: signed / unavailable / null render
//      distinctly; a null badge is never the clean/green class.
//   4. Each row's landing-record link hrefs /landings/<id> exactly.
//   5. Fail-soft: a fixture where /pipelines 404s renders the honest
//      error row and the connection banner stays down (the sessions
//      fail-soft posture).
//   6. An empty payload renders the pipelines-empty element naming
//      the base.
//
// A box without a Chrome binary skips the suite (SKIP-exit-0
// precedent: ui-judge-fail-closed / connection-error-surface).

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
  console.log("SKIP  ui-pipelines — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-pipelines-"));

// ---------------------------------------------------------------------------
// Fixture /pipelines payloads. The XSS probe carries an <img onerror>
// in the repo name; the honesty leg carries an unknown status; the
// attestation leg carries signed / unavailable / null.
// ---------------------------------------------------------------------------
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);
const XSS_PROBE = `agent-1"><img src=x onerror=alert(1)>`;
const AT = "2026-10-14T00:00:00.000Z";

const FIXTURE = {
  ok: true,
  base: "demo",
  pipelines: [
    {
      id: SHA,
      repos: ["agent-1"],
      at: AT,
      checks: ["unit-tests", "merged-sha-equals-tested-sha"],
      results: ["pass", "pass"],
      status: "passed",
      attestation: "signed",
    },
    {
      id: SHA2,
      repos: [XSS_PROBE],
      at: AT,
      checks: ["merged-sha-equals-tested-sha"],
      results: ["mismatch"],
      status: "failed",
      attestation: "unavailable",
    },
    {
      id: SHA3,
      repos: ["agent-3"],
      at: AT,
      checks: ["merged-sha-equals-tested-sha"],
      results: [],
      status: "not-recorded",
      attestation: null,
    },
    // Honesty leg: an unknown status value renders neutral, never passed.
    {
      id: "d".repeat(40),
      repos: ["agent-4"],
      at: AT,
      checks: ["merged-sha-equals-tested-sha"],
      results: ["pass"],
      status: "weird-status",
      attestation: "signed",
    },
  ],
};

const EMPTY_FIXTURE = { ok: true, base: "demo", pipelines: [] };

const PROPOSALS = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "1a".repeat(20) },
  ref: "main",
  summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 },
  proposals: [],
  conflicts: [],
  landing: {},
};

const EVENTS = { ok: true, events: [] };

// Mutable per-leg server state: which /pipelines outcome serves.
let pipelinesOutcome = { status: 200, body: FIXTURE };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Wraps (never replaces)
// window.fetch to record every URL. After DOMContentLoaded + a
// 2500ms settle (lets the initial /proposals + /pipelines + /events
// cycle complete), reads the rendered pipelines section and
// serializes observations into #test-out.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(2500);
    R.c.pipelineFetches = R.f.filter((u) => u.startsWith("/pipelines")).length;
    R.c.sectionExists = !!q("#pipelines-section");
    R.c.listExists = !!q("#pipelines-list");
    R.c.metaExists = !!q("#pipelines-meta");
    R.c.rows = qs("#pipelines-list .pipeline-row").map((row) => {
      const sha = row.querySelector(".pipeline-sha");
      const status = row.querySelector(".pipeline-status");
      const attestation = row.querySelector(".pipeline-attestation");
      const repos = row.querySelector(".pipeline-repos");
      const link = row.querySelector(".pipeline-link");
      return {
        shaText: sha ? sha.textContent.trim() : "",
        shaTitle: sha ? sha.getAttribute("title") : "",
        shaClass: sha ? sha.className : "",
        statusText: status ? status.textContent.trim() : "",
        statusClass: status ? status.className : "",
        attestationText: attestation ? attestation.textContent.trim() : "",
        attestationClass: attestation ? attestation.className : "",
        reposText: repos ? repos.textContent.trim() : "",
        linkHref: link ? link.getAttribute("href") : "",
        linkText: link ? link.textContent.trim() : "",
        innerHTML: row.innerHTML,
      };
    });
    R.c.metaText = q("#pipelines-meta") ? q("#pipelines-meta").textContent.trim() : "";
    R.c.emptyTitle = q("#pipelines-list .pipelines-empty-title") ? q("#pipelines-list .pipelines-empty-title").textContent.trim() : "";
    R.c.connectionBannerHidden = q("#connection-banner") ? q("#connection-banner").hidden === true : true;
    R.c.pipelinesUnavailable = !!q("#pipelines-list .pipelines-unavailable");
    R.c.rawHtml = q("#pipelines-list") ? q("#pipelines-list").innerHTML : "";
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// CDP harness (mirrors ui-judge-fail-closed.test.mjs)
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
// Loopback worker surface — serves the shipped platform/ui VERBATIM.
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (pathname === "/proposals") return json(200, PROPOSALS);
  if (pathname === "/events") return json(200, EVENTS);
  if (pathname === "/whoami") return json(200, { ok: true, authorized: false, reveal: false });
  if (pathname === "/pipelines") return json(pipelinesOutcome.status, pipelinesOutcome.body);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    res.end(`window.__SCENARIO = {};\n${clientScript}`);
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") {
    const html = readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain", "cache-control": "no-store" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// The legs (server outcome + the assertions each defends).
// ---------------------------------------------------------------------------
const LEGS = [
  {
    name: "render",
    outcome: { status: 200, body: FIXTURE },
    assert(c) {
      check("render: the pipelines section renders (section/list/meta exist)", c.sectionExists === true && c.listExists === true && c.metaExists === true, JSON.stringify({ section: c.sectionExists, list: c.listExists, meta: c.metaExists }));
      check("render: four rows rendered", (c.rows || []).length === 4, `rows=${(c.rows || []).length}`);
      // Row 1: id / repos / at / status / attestation / link verbatim.
      const r1 = (c.rows || [])[0] || {};
      check("render: row 1 id chip carries the sha (title = full sha)", r1.shaTitle === SHA && r1.shaText === SHA.slice(0, 7), JSON.stringify({ title: r1.shaTitle, text: r1.shaText }));
      check("render: row 1 repos verbatim", r1.reposText === "agent-1", r1.reposText);
      check("render: row 1 status chip carries passed verbatim", r1.statusText === "passed" && (r1.statusClass || "").includes("pipeline-status-passed"), JSON.stringify({ text: r1.statusText, cls: r1.statusClass }));
      check("render: row 1 attestation badge carries signed", r1.attestationText === "signed" && (r1.attestationClass || "").includes("pipeline-attestation-signed"), JSON.stringify({ text: r1.attestationText, cls: r1.attestationClass }));
      check("render: row 1 landing-record link hrefs /landings/<id> exactly", r1.linkHref === `/landings/${SHA}` && r1.linkText === "landing record", JSON.stringify({ href: r1.linkHref, text: r1.linkText }));
      // XSS leg: the probe repo renders as escaped text, never as markup.
      const r2 = (c.rows || [])[1] || {};
      check("render: the XSS-probe repo renders as escaped text (no <img> element)", !(r2.innerHTML || "").includes("<img"), (r2.innerHTML || "").slice(0, 160));
      check("render: the XSS probe renders the escaped entity", (r2.innerHTML || "").includes("&lt;img"), (r2.innerHTML || "").slice(0, 160));
      // Honesty leg: the unknown status renders neutral, never passed.
      const r4 = (c.rows || [])[3] || {};
      check("render: an unknown status renders the neutral unknown class, never passed", (r4.statusClass || "").includes("pipeline-status-unknown") && !(r4.statusClass || "").includes("pipeline-status-passed"), JSON.stringify({ text: r4.statusText, cls: r4.statusClass }));
      // Attestation leg: unavailable and null render distinctly, never clean.
      check("render: row 2 attestation unavailable badge", r2.attestationText === "unavailable" && (r2.attestationClass || "").includes("pipeline-attestation-unavailable"), JSON.stringify({ text: r2.attestationText, cls: r2.attestationClass }));
      const r3 = (c.rows || [])[2] || {};
      check("render: row 3 (null attestation) renders the unrecorded badge, never the clean/green class", r3.attestationText === "unrecorded" && (r3.attestationClass || "").includes("pipeline-attestation-unrecorded") && !(r3.attestationClass || "").includes("signed"), JSON.stringify({ text: r3.attestationText, cls: r3.attestationClass }));
      // Meta: count + base.
      check("render: meta reads the count and the base", c.metaText === "4 runs · demo", c.metaText);
      // The panel fetched /pipelines.
      check("render: the panel fetched /pipelines", (c.pipelineFetches || 0) >= 1, `fetches=${c.pipelineFetches}`);
      // The connection banner stayed down (fail-soft posture).
      check("render: the connection banner stays down", c.connectionBannerHidden === true, `hidden=${c.connectionBannerHidden}`);
    },
  },
  {
    name: "fail-soft",
    outcome: { status: 404, body: { ok: false, error: "not-found" } },
    assert(c) {
      check("fail-soft: the honest unavailable row renders", c.pipelinesUnavailable === true, `unavailable=${c.pipelinesUnavailable}`);
      check("fail-soft: no rows rendered", (c.rows || []).length === 0, `rows=${(c.rows || []).length}`);
      check("fail-soft: the connection banner stays down (the sessions fail-soft posture)", c.connectionBannerHidden === true, `hidden=${c.connectionBannerHidden}`);
    },
  },
  {
    name: "empty",
    outcome: { status: 200, body: EMPTY_FIXTURE },
    assert(c) {
      check("empty: the pipelines-empty element renders", (c.emptyTitle || "").length > 0, `title=${c.emptyTitle}`);
      check("empty: the empty state names the base", (c.emptyTitle || "").includes("demo"), c.emptyTitle);
      check("empty: meta reads 0 runs", c.metaText === "0 runs · demo", c.metaText);
      check("empty: the connection banner stays down", c.connectionBannerHidden === true, `hidden=${c.connectionBannerHidden}`);
    },
  },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const baseUrl = `http://127.0.0.1:${port}/index.html`;

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

  for (const leg of LEGS) {
    pipelinesOutcome = leg.outcome;
    await send("Page.navigate", { url: `${baseUrl}?leg=${leg.name}` });
    await waitFor(`document.getElementById("test-out") !== null`, 60000);
    const obs = await evl(`(function(){ const d = document.getElementById("test-out"); return d ? JSON.parse(decodeURIComponent(d.textContent)) : null; })()`);
    if (!obs) {
      check(`${leg.name}: scenario output present (chrome + driver ran)`, false, "no #test-out in DOM");
      continue;
    }
    if (obs.err) {
      check(`${leg.name}: scenario threw`, false, obs.err);
      continue;
    }
    leg.assert(obs.c || {});
  }
} catch (e) {
  check("ui-pipelines case threw", false, String(e?.stack ?? e));
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => { clearTimeout(timer); resolve(); });
  });
  if (chrome) chrome.kill("SIGKILL");
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? `ALL PASS (${LEGS.reduce((n, l) => n + 1, 0)} legs)` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
