#!/usr/bin/env bun
// Contract suite: the auto-land (AD-11) verdict RENDER layer —
// ACT / CONFIRM / ESCALATE / fail-closed surface behind the Land button.
// Run: bun porting/tests/autoland-ui.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + app.js +
// land-verdict.js) is loaded in real headless Chrome over a loopback
// origin. The only scripted pieces are the worker's HTTP surface
// (which fixture /proposals serves and what /land returns) and an
// observer module injected BEFORE app.js that records fetch calls and
// sniffs the rendered DOM — no product mocks, no module mock, no
// source grep.
//
// Harness shape mirrors ui-judge-fail-closed.test.mjs: the shipped
// platform/ui is served VERBATIM (the contentTypes map serves
// land-verdict.js — the module graph dies if the dispatcher 404s it,
// the wave-9 lesson), with the observer script injected before app.js.
//
// Legs (real two-step land: start-land → is-confirming → confirm-land):
//   1. ACT      — 200 evidence.autoLand act    → receipt "landed", no advisory
//   2. CONFIRM  — 200 evidence.autoLand confirm → amber advisory + the
//                 two-step "confirm land?" anatomy (start-land →
//                 is-confirming → confirm-land)
//   3. ESCALATE — 409 autoland-escalate         → red "escalate" banner
//                 carrying blocking codes + a badge-red chip next to Land;
//                 Land stays enabled but NEVER auto-fires (fetch ledger
//                 proves no second /land without a human click)
//   4. FAIL-CLOSED — 503 judge-unavailable      → "blocked" banner with the
//                 server reason, zero bypass affordances, grid still renders
//   5. PURE MAPPING — direct import of renderLandVerdict: the full
//                 five-input table from server-shaped inputs only
//
// A box without a Chrome binary skips legs 1-4 (SKIP-exit-0 precedent:
// ui-judge-fail-closed / connection-error-surface); leg 5 (pure mapping,
// bun-only) always runs.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLandVerdict, landVerdictFromLandResponse, landVerdictFromErrorEnvelope } from "../../platform/ui/land-verdict.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "  ok " : "FAIL "}${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Leg 5 — pure mapping (bun-only, no Chrome). Direct import of the shipped
// land-verdict.js; the full five-input table from server-shaped inputs only.
// ---------------------------------------------------------------------------
{
  // ACT: badge-clean, normal flow, no notice.
  const act = renderLandVerdict({ verdict: "act", setId: "v1", blocking: [] });
  check("pure: act -> kind act", act.kind === "act", JSON.stringify(act));
  check("pure: act -> badge-clean", act.badgeClass === "badge-clean", act.badgeClass);
  check("pure: act -> no notice", act.noticeHtml === null, String(act.noticeHtml));

  // CONFIRM: badge-amber advisory; the notice names the two-step surface.
  const confirm = renderLandVerdict({ verdict: "confirm", setId: "v1", blocking: [] });
  check("pure: confirm -> kind confirm", confirm.kind === "confirm", JSON.stringify(confirm));
  check("pure: confirm -> badge-amber", confirm.badgeClass === "badge-amber", confirm.badgeClass);
  check("pure: confirm -> names confirm land?", (confirm.noticeHtml || "").includes("confirm land?"), (confirm.noticeHtml || "").slice(0, 90));

  // ESCALATE: badge-red advisory carrying escaped blocking codes; never a bypass.
  const esc = renderLandVerdict({ verdict: "escalate", setId: "v1", blocking: ["risk:senior-security:agent-1", "intent:contradicts:agent-1"] });
  check("pure: escalate -> kind escalate", esc.kind === "escalate", JSON.stringify(esc));
  check("pure: escalate -> badge-red", esc.badgeClass === "badge-red", esc.badgeClass);
  check("pure: escalate -> carries blocking codes", (esc.noticeHtml || "").includes("risk:senior-security:agent-1"), (esc.noticeHtml || "").slice(0, 90));
  check("pure: escalate -> never auto-fires / no bypass", (esc.noticeHtml || "").includes("no bypass") && (esc.noticeHtml || "").includes("never auto-fires"), (esc.noticeHtml || "").slice(0, 160));

  // FAIL-CLOSED: judge-unavailable -> blocked banner w/ server reason, no bypass.
  const blocked = renderLandVerdict({ error: "judge-unavailable" });
  check("pure: judge-unavailable -> kind blocked", blocked.kind === "blocked", JSON.stringify(blocked));
  check("pure: judge-unavailable -> badge-red", blocked.badgeClass === "badge-red", blocked.badgeClass);
  check("pure: judge-unavailable -> carries the reason", (blocked.noticeHtml || "").includes("judge-unavailable"), (blocked.noticeHtml || "").slice(0, 90));
  check("pure: judge-unavailable -> fail-closed fact", (blocked.noticeHtml || "").toLowerCase().includes("failed closed"), (blocked.noticeHtml || "").slice(0, 140));

  // Absent verdict -> none ("a skip is not a verdict", CONTRACT.md:266).
  const none = renderLandVerdict({});
  check("pure: absent verdict -> kind none", none.kind === "none", JSON.stringify(none));
  check("pure: absent verdict -> no badge", none.badgeClass === "", JSON.stringify(none.badgeClass));
  check("pure: absent verdict -> no notice", none.noticeHtml === null, String(none.noticeHtml));

  // 200-response reader: evidence.autoLand present -> object; absent -> null.
  const okRes = { ok: true, landed: { commit: "abc" }, evidence: { autoLand: { setId: "v1", verdict: "act", blocking: [] } } };
  check("pure: landVerdictFromLandResponse reads evidence.autoLand", landVerdictFromLandResponse(okRes)?.verdict === "act", JSON.stringify(landVerdictFromLandResponse(okRes)));
  check("pure: landVerdictFromLandResponse absent -> null", landVerdictFromLandResponse({ ok: true }) === null);

  // Error-envelope reader: 409 escalate + 503 judge-unavailable + other -> null.
  const escEnv = { ok: false, error: "autoland-escalate", verdict: "escalate", setId: "v1", blocking: ["collision:agent-1"] };
  check("pure: landVerdictFromErrorEnvelope 409 escalate", landVerdictFromErrorEnvelope(escEnv)?.verdict === "escalate", JSON.stringify(landVerdictFromErrorEnvelope(escEnv)));
  check("pure: landVerdictFromErrorEnvelope 503 judge-unavailable", landVerdictFromErrorEnvelope({ error: "judge-unavailable" })?.error === "judge-unavailable");
  check("pure: landVerdictFromErrorEnvelope other -> null", landVerdictFromErrorEnvelope({ error: "conflict" }) === null);
}

// ---------------------------------------------------------------------------
// Legs 1-4: real headless Chrome (SKIP-exit-0 precedent when no binary).
// ---------------------------------------------------------------------------
const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP: no Chrome binary — legs 1-4 require real Chrome (precedent: ui-judge-fail-closed)");
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-autoland-"));

// ---------------------------------------------------------------------------
// Fixture: one ready/landable proposal (agent-1) + one landed (agent-2),
// matching the live demo shape per CHECKPOINT.md. All four /land legs
// target agent-1 — the only card with an enabled btn-land.
// ---------------------------------------------------------------------------
const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "f".repeat(40) },
  ref: "main",
  proposals: [
    {
      repo: "agent-1",
      head: "1".repeat(40),
      intent: "refactor auth flow",
      stats: { additions: 12, deletions: 3, files: 2 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 12, deletions: 3 },
        { path: "src/session.ts", status: "added", additions: 0, deletions: 0 },
      ],
      landing: { status: "ready" },
    },
    {
      repo: "agent-2",
      head: "2".repeat(40),
      stats: { additions: 0, deletions: 0, files: 0 },
      files: [],
      landing: { status: "landed", files: 0 },
    },
  ],
  conflicts: [],
  summary: { proposals: 2, shared: 0, conflicts: 0, changed: 2, clean: 1 },
};

const EVENTS = { ok: true, events: [] };

// Mutable per-leg server state: the /land outcome and the scenario the
// observer reads from window.__SCENARIO (injected into /__client.js).
let landOutcome = { status: 200, body: { ok: true, landed: { commit: "a".repeat(40), files: FIXTURE.proposals[0].files, at: new Date().toISOString() }, evidence: { autoLand: { setId: "v1", verdict: "act", blocking: [] } } } };
let scenario = { repo: "agent-1" };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Wraps (never replaces)
// window.fetch to record every URL (the ledger that proves no second
// /land without a human click). After DOMContentLoaded + settle it
// drives the two-step land (start-land -> confirm-land) and sniffs the
// rendered DOM: action-banner state, card badges, button anatomy, and
// the /land fetch count (early, and again after an extended settle).
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(1800);
    const S = window.__SCENARIO || {};
    R.c.repo = S.repo;
    R.c.cardCount = document.querySelectorAll(".proposal-card").length;
    const landFetches = () => R.f.filter((u) => u === "/land").length;
    // Two-step land anatomy: click start-land on the target card.
    const startBtn = qs('[data-action="start-land"]').find((b) => b.getAttribute("data-repo") === S.repo);
    R.c.hasStartBtn = !!startBtn;
    if (startBtn) startBtn.click();
    await sleep(250);
    const confirmBtn = qs('[data-action="confirm-land"]').find((b) => b.getAttribute("data-repo") === S.repo);
    R.c.startBtnDisabled = startBtn ? startBtn.hasAttribute("disabled") : null;
    R.c.isConfirmingAfterStart = !!confirmBtn;
    R.c.confirmBtnText = (confirmBtn || {}).textContent || "";
    R.c.confirmBtnClass = (confirmBtn || {}).className || "";
    // The human act: click "confirm land?" — the single /land request.
    if (confirmBtn && S.clickConfirm !== false) confirmBtn.click();
    await sleep(900);
    R.c.landFetchesEarly = landFetches();
    const banner = q("#action-banner");
    R.c.bannerHidden = banner ? banner.hidden === true : true;
    R.c.bannerClass = banner ? banner.className : "";
    R.c.bannerBadgeText = (q("#action-banner-badge") || {}).textContent || "";
    R.c.bannerBadgeClass = (q("#action-banner-badge") || {}).className || "";
    const msgEl = q("#action-banner-msg");
    R.c.bannerMsgText = (msgEl || {}).textContent || "";
    R.c.bannerMsgBadges = msgEl ? [...msgEl.querySelectorAll(".badge")].map((b) => ({ text: b.textContent.trim(), cls: b.className })) : [];
    const cardAfter = q("#card-" + CSS.escape(S.repo));
    R.c.cardBadges = cardAfter ? [...cardAfter.querySelectorAll(".proposal-badges .badge")].map((b) => ({ text: b.textContent.trim(), cls: b.className })) : [];
    R.c.landBtnAfter = (() => {
      const btn = cardAfter ? [...cardAfter.querySelectorAll(".btn-land")].find((b) => b.getAttribute("data-repo") === S.repo) : null;
      return { exists: !!btn, disabled: btn ? btn.hasAttribute("disabled") : null, text: btn ? btn.textContent.trim() : "" };
    })();
    R.c.bypassBtns = qs("button").map((b) => b.textContent.trim().toLowerCase()).filter((t) => /bypass|force land|override|skip gate/.test(t));
    // Extended settle: prove the land never auto-fires (ledger unchanged).
    await sleep(1500);
    R.c.landFetchesLate = landFetches();
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
// Loopback worker surface — serves the shipped platform/ui VERBATIM. The
// contentTypes map covers every extension the module graph uses, including
// land-verdict.js (served by the generic .js mapping).
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (pathname === "/proposals") return json(200, FIXTURE);
  if (pathname === "/events") return json(200, EVENTS);
  if (pathname === "/judge") return json(200, { ok: true, judgments: [] });
  if (pathname === "/whoami") return json(200, { ok: true, authorized: false, reveal: false });
  if (pathname === "/merge") return json(200, { ok: true, merge: { status: "clean", files: [] } });
  if (pathname === "/land") return json(landOutcome.status, landOutcome.body);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    res.end(`window.__SCENARIO = ${JSON.stringify(scenario)};\n${clientScript}`);
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
// The four /land legs (server outcome + the assertions each defends).
// ---------------------------------------------------------------------------
const ACT_LAND = { setId: "v1", verdict: "act", blocking: [] };
const CONFIRM_LAND = { setId: "v1", verdict: "confirm", blocking: [] };
const BLOCKING = ["risk:senior-security:agent-1", "intent:contradicts:agent-1"];

const LEGS = [
  {
    name: "act",
    outcome: { status: 200, body: { ok: true, landed: { commit: "a".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: { autoLand: ACT_LAND } } },
    assert(c) {
      check("act: card grid rendered", (c.cardCount || 0) >= 2, `cards=${c.cardCount}`);
      check("act: two-step anatomy — start-land present", c.hasStartBtn === true);
      check("act: is-confirming after start-land", c.isConfirmingAfterStart === true);
      check("act: confirm button reads confirm land?", (c.confirmBtnText || "").includes("confirm land?"), c.confirmBtnText);
      check("act: receipt banner shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
      check("act: receipt is a success banner", (c.bannerClass || "").includes("banner-success"), c.bannerClass);
      check("act: receipt badge reads landed", c.bannerBadgeText === "landed", c.bannerBadgeText);
      check("act: receipt badge is clean", (c.bannerBadgeClass || "").includes("badge-clean"), c.bannerBadgeClass);
      check("act: receipt names the land", (c.bannerMsgText || "").includes("Successfully landed"), (c.bannerMsgText || "").slice(0, 90));
      check("act: no CONFIRM advisory on the receipt", !(c.bannerMsgText || "").includes("CONFIRM"), (c.bannerMsgText || "").slice(0, 90));
      check("act: no advisory badge appended to receipt", (c.bannerMsgBadges || []).length === 0, JSON.stringify(c.bannerMsgBadges));
      check("act: exactly one /land request (the human click)", c.landFetchesEarly === 1, `early=${c.landFetchesEarly}`);
      check("act: no auto-fired second /land", c.landFetchesLate === 1, `late=${c.landFetchesLate}`);
    },
  },
  {
    name: "confirm",
    outcome: { status: 200, body: { ok: true, landed: { commit: "b".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: { autoLand: CONFIRM_LAND } } },
    assert(c) {
      check("confirm: two-step anatomy — start-land present", c.hasStartBtn === true);
      check("confirm: is-confirming after start-land", c.isConfirmingAfterStart === true);
      check("confirm: confirm button reads confirm land?", (c.confirmBtnText || "").includes("confirm land?"), c.confirmBtnText);
      check("confirm: confirming button carries is-confirming", (c.confirmBtnClass || "").includes("is-confirming"), c.confirmBtnClass);
      check("confirm: receipt banner shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
      check("confirm: amber advisory appended to receipt", (c.bannerMsgBadges || []).some((b) => b.cls.includes("badge-amber")), JSON.stringify(c.bannerMsgBadges));
      check("confirm: advisory names the CONFIRM verdict", (c.bannerMsgText || "").includes("CONFIRM"), (c.bannerMsgText || "").slice(0, 140));
      check("confirm: exactly one /land request", c.landFetchesEarly === 1, `early=${c.landFetchesEarly}`);
      check("confirm: no auto-fired second /land", c.landFetchesLate === 1, `late=${c.landFetchesLate}`);
    },
  },
  {
    name: "escalate",
    outcome: { status: 409, body: { ok: false, error: "autoland-escalate", verdict: "escalate", setId: "v1", blocking: BLOCKING } },
    assert(c) {
      check("escalate: red advisory banner shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
      check("escalate: banner is an error banner", (c.bannerClass || "").includes("banner-error"), c.bannerClass);
      check("escalate: banner badge reads escalate", c.bannerBadgeText === "escalate", c.bannerBadgeText);
      check("escalate: banner badge is red", (c.bannerBadgeClass || "").includes("badge-red"), c.bannerBadgeClass);
      check("escalate: banner carries the blocking codes", (c.bannerMsgText || "").includes("risk:senior-security:agent-1"), (c.bannerMsgText || "").slice(0, 140));
      check("escalate: banner states no bypass", /no bypass/i.test(c.bannerMsgText || ""), (c.bannerMsgText || "").slice(0, 200));
      check("escalate: badge-red chip next to Land", (c.cardBadges || []).some((b) => b.cls.includes("badge-red") && b.text === "escalate"), JSON.stringify(c.cardBadges));
      check("escalate: Land stays enabled (never disabled by the verdict)", c.landBtnAfter?.exists === true && c.landBtnAfter?.disabled === false, JSON.stringify(c.landBtnAfter));
      check("escalate: Land never auto-fires — exactly one /land", c.landFetchesEarly === 1, `early=${c.landFetchesEarly}`);
      check("escalate: no auto-fired second /land after extended settle", c.landFetchesLate === 1, `late=${c.landFetchesLate}`);
      check("escalate: zero bypass affordances anywhere", (c.bypassBtns || []).length === 0, JSON.stringify(c.bypassBtns));
    },
  },
  {
    name: "fail-closed",
    outcome: { status: 503, body: { ok: false, error: "judge-unavailable" } },
    assert(c) {
      check("fail-closed: blocked banner shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
      check("fail-closed: banner is an error banner", (c.bannerClass || "").includes("banner-error"), c.bannerClass);
      check("fail-closed: banner badge reads blocked", c.bannerBadgeText === "blocked", c.bannerBadgeText);
      check("fail-closed: banner badge is red", (c.bannerBadgeClass || "").includes("badge-red"), c.bannerBadgeClass);
      check("fail-closed: banner carries the server reason", (c.bannerMsgText || "").includes("judge-unavailable"), (c.bannerMsgText || "").slice(0, 140));
      check("fail-closed: banner states the fail-closed fact", /failed closed/i.test(c.bannerMsgText || ""), (c.bannerMsgText || "").slice(0, 200));
      check("fail-closed: zero bypass affordances", (c.bypassBtns || []).length === 0, JSON.stringify(c.bypassBtns));
      check("fail-closed: grid still renders", (c.cardCount || 0) >= 2, `cards=${c.cardCount}`);
      check("fail-closed: exactly one /land request", c.landFetchesEarly === 1, `early=${c.landFetchesEarly}`);
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
    landOutcome = leg.outcome;
    scenario = { repo: "agent-1" };
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
  check("autoland-ui case threw", false, String(e?.stack ?? e));
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
