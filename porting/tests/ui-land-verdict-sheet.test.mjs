#!/usr/bin/env bun
// Contract suite: the land CONFIRM SHEET (nextgit-e15-impl-land-verdict-sheet) —
// the render at the two-step land's decision point.
// Run: bun porting/tests/ui-land-verdict-sheet.test.mjs   (exit 0 = pass)
//
// The finding: the card's inline is-confirming state rendered only the two
// buttons — it stated nothing about what the land will do and never showed the
// judge's verdict at the moment of confirmation. The verdict render layer
// already shipped (platform/ui/land-verdict.js, wave 10); the missing render
// was the decision-point sheet.
//
// Real construction (mirrors autoland-ui.test.mjs): the shipped platform/ui
// (index.html + app.js + the ./js/* module graph + land-verdict.js) is served
// VERBATIM over a loopback origin into real headless Chrome; the module graph is
// served by the generic ".js" content-type mapping (a 404 on land-verdict.js
// kills the graph — the wave-9 lesson). The only scripted pieces are the
// worker's HTTP surface (the /proposals fixture and what /land answers) and an
// observer module injected BEFORE app.js that records every fetch URL, drives
// the real controls and sniffs the rendered DOM — no product mocks, no module
// mock, no source grep.
//
// The sheet renders only while the card sits in its confirming state, and it
// reads the last RECORDED verdict (state.landVerdictByRepo[repo]), which only a
// server /land response writes. Each browser leg therefore drives the real
// two-step land twice: cycle 1 is the human confirm (the only /land), cycle 2
// re-arms the card so the sheet renders what the judge said.
//
// Legs (every leg asserts `confirm land?` stays enabled and the ledger counts
// only human clicks — the sheet renders a verdict, it never decides one, AD-11):
//   1. ESCALATE    — 409 autoland-escalate: badge-red chip + both code-owned
//                    blocking codes; zero /land until the click.
//   2. CONFIRM     — 200 evidence.autoLand confirm: badge-amber chip + copy
//                    naming the two-step confirm surface.
//   3. ACT         — 200 evidence.autoLand act: badge-clean chip + ACT copy.
//   4. FAIL-CLOSED — 503 judge-unavailable: the fail-closed receipt copy, the
//                    human confirm enabled (never disabled by the gate), zero
//                    bypass affordances, grid still renders, and the gate error
//                    never becomes a defaulted verdict in the sheet.
//   5. UNENGAGED   — 200 with no evidence.autoLand (AUTO_LAND_ENGAGED=false
//                    posture): the what-the-land-will-do line + a neutral
//                    recorded-evidence note, never a defaulted verdict.
//   6. RENDER-ONLY — AD-11: the fetch ledger holds exactly the human click,
//                    nothing auto-fires, and the sheet exposes no control of any
//                    kind anywhere (no bypass element).
//   7. PURE TABLE  — direct import of the shipped js/proposals.js: the full
//                    posture table from server-shaped inputs, plus the XSS probe
//                    (a blocking entry carrying <img src=x onerror=...> must
//                    render escaped).
//
// A box without a Chrome binary skips legs 1-6 (SKIP-exit-0 precedent:
// autoland-ui / ui-judge-fail-closed / connection-error-surface); leg 7
// (bun-only) always runs.

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
  console.log(`${ok ? "  ok " : "FAIL "}${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Leg 7 — pure posture table (bun-only, no Chrome). Direct import of the
// shipped js/proposals.js (the module owning the sheet) and js/state.js (the
// singleton it reads). js/state.js builds its element cache off `document` at
// import time, so a null-returning document shim stands in for the browser
// document — the product modules themselves are untouched, and both the shim
// and the fetch spy are restored in the finally (no global leaks).
// ---------------------------------------------------------------------------
const WHATLINE =
  "Landing folds agent-1 into demo server-side (no clone) and pushes the result to the base branch.";
{
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  globalThis.document = { getElementById: () => null };
  let fetchCalls = 0;
  globalThis.fetch = (...args) => {
    fetchCalls++;
    return savedFetch(...args);
  };
  try {
    const { state } = await import("../../platform/ui/js/state.js");
    const { landConfirmSheetHtml } = await import("../../platform/ui/js/proposals.js");

    const sheetFor = (repo, base, verdict) => {
      state.confirmingRepo = repo;
      if (verdict === undefined) delete state.landVerdictByRepo[repo];
      else state.landVerdictByRepo[repo] = verdict;
      return landConfirmSheetHtml(repo, base);
    };
    const chipOf = (html) => {
      const m = /<span class="badge ([^"]*)">([^<]*)<\/span>/.exec(html);
      return m ? { cls: m[1], text: m[2] } : null;
    };
    const hintOf = (html) => {
      const m = /<span class="action-hint">([\s\S]*)<\/span>/.exec(html);
      return m ? m[1] : "";
    };
    const hasControl = (html) => /<(?:button|a|input|select|textarea|iframe|object|embed|script|img)\b/i.test(html) || /\bdata-action=/.test(html);

    state.landVerdictByRepo = {};

    // --- no verdict carried -> recorded-evidence posture (no defaulted verdict)
    const none = sheetFor("agent-1", "demo", undefined);
    check("pure: no verdict -> what-the-land-will-do line", none.includes(`<div class="land-confirm-what">${WHATLINE}</div>`), none.slice(0, 180));
    check("pure: no verdict -> neutral recorded-evidence chip", chipOf(none)?.text === "recorded-evidence" && chipOf(none)?.cls === "badge-neutral", JSON.stringify(chipOf(none)));
    check("pure: no verdict -> recorded-evidence note, never a defaulted verdict", /recorded-evidence/i.test(hintOf(none)) && !/ACT|CONFIRM|ESCALATE|blocked/.test(hintOf(none)), hintOf(none));
    check("pure: no verdict -> sheet is a role=note live region", /class="land-confirm-sheet" role="note" aria-live="polite"/.test(none), none.slice(0, 120));

    // --- ACT (200 evidence.autoLand act)
    const act = sheetFor("agent-1", "demo", { setId: "v1", verdict: "act", blocking: [] });
    check("pure: act -> badge-clean chip", chipOf(act)?.cls === "badge-clean" && chipOf(act)?.text === "act", JSON.stringify(chipOf(act)));
    check("pure: act -> ACT copy", /ACT/.test(hintOf(act)) && !/CONFIRM|ESCALATE/.test(hintOf(act)), hintOf(act));

    // --- CONFIRM (200 evidence.autoLand confirm)
    const confirm = sheetFor("agent-1", "demo", { setId: "v1", verdict: "confirm", blocking: [] });
    check("pure: confirm -> badge-amber chip", chipOf(confirm)?.cls === "badge-amber" && chipOf(confirm)?.text === "confirm", JSON.stringify(chipOf(confirm)));
    check("pure: confirm -> names the CONFIRM verdict + the two-step surface", /CONFIRM/.test(hintOf(confirm)) && /confirm land\?/.test(hintOf(confirm)), hintOf(confirm));

    // --- ESCALATE (409 autoland-escalate) — code-owned blocking codes
    const esc = sheetFor("agent-1", "demo", { verdict: "escalate", setId: "v1", blocking: ["risk:senior-security:agent-1", "intent:contradicts:agent-1"] });
    check("pure: escalate -> badge-red chip", chipOf(esc)?.cls === "badge-red" && chipOf(esc)?.text === "escalate", JSON.stringify(chipOf(esc)));
    check("pure: escalate -> carries both code-owned blocking codes", /risk:senior-security:agent-1/.test(hintOf(esc)) && /intent:contradicts:agent-1/.test(hintOf(esc)), hintOf(esc));
    check("pure: escalate -> states no bypass / never auto-fires", /no bypass/i.test(hintOf(esc)) && /never auto-fires/i.test(hintOf(esc)), hintOf(esc));

    // --- FAIL-CLOSED (503 judge-unavailable) — the sheet's blocked posture
    const blocked = sheetFor("agent-1", "demo", { error: "judge-unavailable" });
    check("pure: judge-unavailable -> badge-red blocked chip", chipOf(blocked)?.cls === "badge-red" && chipOf(blocked)?.text === "blocked", JSON.stringify(chipOf(blocked)));
    check("pure: judge-unavailable -> the fail-closed 503 copy", /judge-unavailable/.test(hintOf(blocked)) && /failed closed/i.test(hintOf(blocked)), hintOf(blocked));

    // --- XSS probe: a blocking entry carrying markup must render escaped
    const xss = sheetFor("agent-1", "demo", { verdict: "escalate", setId: "v1", blocking: ['<img src=x onerror="alert(1)">'] });
    check("pure: xss probe -> markup escaped, no live element", !/<img/i.test(xss) && /&lt;img src=x onerror=/.test(xss), xss.slice(0, 240));
    check("pure: xss probe -> the sheet still carries no control element", !hasControl(xss));

    // --- render-only by construction: no posture emits a control, none fetches
    const all = [none, act, confirm, esc, blocked, xss];
    check("pure: no posture emits a button/link/action (render-only, AD-11)", all.every((h) => !hasControl(h)), JSON.stringify(all.map(hasControl)));
    check("pure: rendering the sheet performs no fetch (render-only, AD-11)", fetchCalls === 0, `fetch=${fetchCalls}`);
    check("pure: the sheet writes no state (only reads the recorded verdict)", JSON.stringify(Object.keys(state.landVerdictByRepo)) === '["agent-1"]', JSON.stringify(Object.keys(state.landVerdictByRepo)));
  } catch (e) {
    check("pure posture table threw", false, String(e?.stack ?? e));
  } finally {
    globalThis.fetch = savedFetch;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
}

// ---------------------------------------------------------------------------
// Legs 1-6: real headless Chrome (SKIP-exit-0 precedent when no binary).
// ---------------------------------------------------------------------------
const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP: no Chrome binary — legs 1-6 require real Chrome (precedent: autoland-ui / ui-judge-fail-closed)");
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-sheet-"));

// ---------------------------------------------------------------------------
// Fixture: one ready/landable proposal (agent-1) + one landed (agent-2),
// matching the live demo shape. FR-16: the canvas binds each land to base.head
// + the row head, so the fixture carries both anchors — a heads-less payload is
// refused by the canvas by design (land.js), and then nothing would land.
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

// Mutable per-leg server state: the /land outcome. The scenario the observer
// reads from window.__SCENARIO is injected into /__client.js.
let landOutcome = {
  status: 200,
  body: { ok: true, landed: { commit: "c".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: {} },
};
let scenario = { repo: "agent-1" };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Wraps (never replaces) window.fetch
// to record every URL — the ledger that proves only a human click sends a
// /land. After DOMContentLoaded + settle it drives the real two-step land twice
// and sniffs the rendered DOM: the confirm sheet (what-line, chip, copy), the
// button states, the receipt banner, and the /land count (before the click and
// again after an extended settle). Guarded so a broken state still yields
// per-clause observations instead of one masked throw.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const qs = (sel) => [...document.querySelectorAll(sel)];
const landFetches = () => R.f.filter((u) => u === "/land").length;
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(1800);
    const S = window.__SCENARIO || {};
    const repo = S.repo;
    R.c.repo = repo;
    R.c.cardCount = document.querySelectorAll(".proposal-card").length;
    const cardOf = () => document.querySelector("#card-" + CSS.escape(repo));
    const sheetOf = () => (cardOf() ? cardOf().querySelector(".land-confirm-sheet") : null);
    const startOf = () => qs('[data-action="start-land"]').find((b) => b.getAttribute("data-repo") === repo) || null;
    const confirmOf = () => qs('[data-action="confirm-land"]').find((b) => b.getAttribute("data-repo") === repo) || null;
    const sniff = (tag) => {
      const s = sheetOf();
      const chip = s ? s.querySelector(".badge") : null;
      const what = s ? s.querySelector(".land-confirm-what") : null;
      const hint = s ? s.querySelector(".action-hint") : null;
      R.c["sheet" + tag + "Present"] = !!s;
      R.c["sheet" + tag + "Role"] = s ? s.getAttribute("role") : null;
      R.c["sheet" + tag + "Html"] = s ? s.outerHTML : null;
      R.c["sheet" + tag + "Text"] = s ? s.textContent.trim() : null;
      R.c["sheet" + tag + "What"] = what ? what.textContent.trim() : null;
      R.c["sheet" + tag + "ChipText"] = chip ? chip.textContent.trim() : null;
      R.c["sheet" + tag + "ChipClass"] = chip ? chip.className : null;
      R.c["sheet" + tag + "Hint"] = hint ? hint.textContent.trim() : null;
      R.c["sheet" + tag + "Buttons"] = s ? s.querySelectorAll("button").length : null;
      R.c["sheet" + tag + "Controls"] = s ? s.querySelectorAll("button, a, input, select, textarea, [data-action]").length : null;
      R.c["sheet" + tag + "RawTags"] = s ? [...s.querySelectorAll("img, script, iframe, object, embed")].map((e) => e.tagName) : null;
    };

    // --- cycle 1: arm the card, then the human confirm (the only /land) -------
    R.c.sheetAtRest = !!sheetOf();
    const start1 = startOf();
    R.c.hasStartBtn = !!start1;
    if (!start1) throw new Error("no start-land control for " + repo);
    start1.click();
    await sleep(300);
    sniff("Arm1");
    const conf1 = confirmOf();
    R.c.confirmPresentArm1 = !!conf1;
    R.c.confirmTextArm1 = conf1 ? conf1.textContent.trim() : null;
    R.c.confirmDisabledArm1 = conf1 ? conf1.hasAttribute("disabled") : null;
    R.c.landFetchesBeforeClick = landFetches();
    if (conf1) conf1.click();
    await sleep(900);
    R.c.landFetchesAfterConfirm = landFetches();
    const banner = document.querySelector("#action-banner");
    R.c.bannerHidden = banner ? banner.hidden === true : true;
    R.c.bannerClass = banner ? banner.className : "";
    R.c.bannerBadgeText = (document.querySelector("#action-banner-badge") || {}).textContent || "";
    R.c.bannerBadgeClass = (document.querySelector("#action-banner-badge") || {}).className || "";
    R.c.bannerMsgText = (document.querySelector("#action-banner-msg") || {}).textContent || "";

    // --- cycle 2: re-arm; the sheet now renders the recorded verdict ----------
    await sleep(800);
    const start2 = startOf();
    R.c.hasStartBtn2 = !!start2;
    if (start2) start2.click();
    await sleep(300);
    sniff("Arm2");
    const conf2 = confirmOf();
    R.c.confirmPresentArm2 = !!conf2;
    R.c.confirmDisabledArm2 = conf2 ? conf2.hasAttribute("disabled") : null;
    R.c.bypassBtns = qs("button").map((b) => b.textContent.trim().toLowerCase()).filter((t) => /bypass|force land|override|skip gate/.test(t));
    // The render never fires the action: the ledger must not move on its own.
    await sleep(1500);
    R.c.landFetchesLate = landFetches();
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// CDP harness (mirrors autoland-ui.test.mjs / ui-judge-fail-closed.test.mjs)
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
// contentTypes map covers every extension the module graph uses; land-verdict.js
// and ./js/*.js are served by the generic ".js" mapping.
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
// The six browser legs (server outcome + the assertions each defends). Every
// /land shape is the CONTRACT shape: 200 {ok,landed,evidence(.autoLand?)},
// 409 {ok:false,error:"autoland-escalate",verdict,setId,blocking[]},
// 503 {ok:false,error:"judge-unavailable"}.
// ---------------------------------------------------------------------------
const ACT_LAND = { setId: "v1", verdict: "act", blocking: [] };
const CONFIRM_LAND = { setId: "v1", verdict: "confirm", blocking: [] };
const BLOCKING = ["risk:senior-security:agent-1", "intent:contradicts:agent-1"];
const ESCALATE_OUTCOME = { status: 409, body: { ok: false, error: "autoland-escalate", verdict: "escalate", setId: "v1", blocking: BLOCKING } };

const LEGS = [
  {
    name: "escalate",
    outcome: ESCALATE_OUTCOME,
    assert(c) {
      check("escalate: the pre-verdict arm claims no verdict (recorded-evidence)", c.sheetArm1Present === true && c.sheetArm1ChipText === "recorded-evidence", `${c.sheetArm1Present} ${c.sheetArm1ChipText}`);
      check("escalate: sheet rendered at the decision point after the verdict was recorded", c.sheetArm2Present === true);
      check("escalate: sheet is a role=note region", c.sheetArm2Role === "note", String(c.sheetArm2Role));
      check("escalate: sheet states what the land will do", c.sheetArm2What === WHATLINE, String(c.sheetArm2What));
      check("escalate: badge-red / escalate chip", c.sheetArm2ChipText === "escalate" && String(c.sheetArm2ChipClass || "").includes("badge-red"), `${c.sheetArm2ChipClass} ${c.sheetArm2ChipText}`);
      check("escalate: sheet carries both code-owned blocking codes", BLOCKING.every((k) => (c.sheetArm2Hint || "").includes(k)), (c.sheetArm2Hint || "").slice(0, 160));
      check("escalate: codes rendered escaped — no live element in the sheet", (c.sheetArm2RawTags || []).length === 0 && !/<(?:img|script)\b/i.test(String(c.sheetArm2Html || "")), JSON.stringify(c.sheetArm2RawTags));
      check("escalate: sheet states no bypass / never auto-fires", /no bypass/i.test(c.sheetArm2Hint || "") && /never auto-fires/i.test(c.sheetArm2Hint || ""), (c.sheetArm2Hint || "").slice(0, 200));
      check("escalate: the sheet exposes no control (no bypass affordance)", c.sheetArm2Controls === 0 && c.sheetArm2Buttons === 0, `controls=${c.sheetArm2Controls} buttons=${c.sheetArm2Buttons}`);
      check("escalate: confirm land? still enabled at the decision point", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
      check("escalate: zero /land until the human click", c.landFetchesBeforeClick === 0, `posts=${c.landFetchesBeforeClick}`);
      check("escalate: exactly one /land (the human click)", c.landFetchesAfterConfirm === 1, `posts=${c.landFetchesAfterConfirm}`);
      check("escalate: no auto-fired second /land after extended settle", c.landFetchesLate === 1, `posts=${c.landFetchesLate}`);
    },
  },
  {
    name: "confirm",
    outcome: { status: 200, body: { ok: true, landed: { commit: "b".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: { autoLand: CONFIRM_LAND } } },
    assert(c) {
      check("confirm: sheet rendered at the decision point", c.sheetArm2Present === true);
      check("confirm: sheet states what the land will do", c.sheetArm2What === WHATLINE, String(c.sheetArm2What));
      check("confirm: badge-amber / confirm chip", c.sheetArm2ChipText === "confirm" && String(c.sheetArm2ChipClass || "").includes("badge-amber"), `${c.sheetArm2ChipClass} ${c.sheetArm2ChipText}`);
      check("confirm: sheet names the CONFIRM verdict", (c.sheetArm2Hint || "").includes("CONFIRM"), (c.sheetArm2Hint || "").slice(0, 140));
      check("confirm: sheet names the two-step confirm surface", (c.sheetArm2Hint || "").includes("confirm land?"), (c.sheetArm2Hint || "").slice(0, 160));
      check("confirm: confirm land? still enabled", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
      check("confirm: exactly one /land (the human click), none auto-fired", c.landFetchesAfterConfirm === 1 && c.landFetchesLate === 1, `after=${c.landFetchesAfterConfirm} late=${c.landFetchesLate}`);
    },
  },
  {
    name: "act",
    outcome: { status: 200, body: { ok: true, landed: { commit: "a".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: { autoLand: ACT_LAND } } },
    assert(c) {
      check("act: sheet rendered at the decision point", c.sheetArm2Present === true);
      check("act: sheet states what the land will do", c.sheetArm2What === WHATLINE, String(c.sheetArm2What));
      check("act: badge-clean / act chip", c.sheetArm2ChipText === "act" && String(c.sheetArm2ChipClass || "").includes("badge-clean"), `${c.sheetArm2ChipClass} ${c.sheetArm2ChipText}`);
      check("act: sheet carries the ACT copy, no other verdict", /ACT/.test(c.sheetArm2Hint || "") && !/CONFIRM|ESCALATE/.test(c.sheetArm2Hint || ""), (c.sheetArm2Hint || "").slice(0, 160));
      check("act: confirm land? still enabled", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
      check("act: exactly one /land (the human click), none auto-fired", c.landFetchesAfterConfirm === 1 && c.landFetchesLate === 1, `after=${c.landFetchesAfterConfirm} late=${c.landFetchesLate}`);
    },
  },
  {
    name: "fail-closed",
    outcome: { status: 503, body: { ok: false, error: "judge-unavailable" } },
    assert(c) {
      check("fail-closed: fail-closed receipt shown", c.bannerHidden === false, `hidden=${c.bannerHidden}`);
      check("fail-closed: receipt is an error banner with a red blocked badge", String(c.bannerClass || "").includes("banner-error") && c.bannerBadgeText === "blocked" && String(c.bannerBadgeClass || "").includes("badge-red"), `${c.bannerClass} ${c.bannerBadgeText} ${c.bannerBadgeClass}`);
      check("fail-closed: receipt carries the server reason", (c.bannerMsgText || "").includes("judge-unavailable"), (c.bannerMsgText || "").slice(0, 140));
      check("fail-closed: receipt states the fail-closed fact", /failed closed/i.test(c.bannerMsgText || ""), (c.bannerMsgText || "").slice(0, 180));
      check("fail-closed: the human confirm was enabled (never disabled by the gate)", c.confirmPresentArm1 === true && c.confirmDisabledArm1 === false && c.confirmTextArm1 === "confirm land?", `disabled=${c.confirmDisabledArm1} text=${c.confirmTextArm1}`);
      check("fail-closed: zero bypass affordances anywhere", (c.bypassBtns || []).length === 0, JSON.stringify(c.bypassBtns));
      check("fail-closed: grid still renders", (c.cardCount || 0) >= 2, `cards=${c.cardCount}`);
      check("fail-closed: exactly one /land (the human click)", c.landFetchesAfterConfirm === 1, `posts=${c.landFetchesAfterConfirm}`);
      check("fail-closed: the recorded gate failure renders the blocked posture in the sheet", c.sheetArm2Present === true && c.sheetArm2ChipText === "blocked" && String(c.sheetArm2ChipClass || "").includes("badge-red"), `${c.sheetArm2ChipText} ${c.sheetArm2ChipClass}`);
      check("fail-closed: the sheet carries the fail-closed 503 copy on the live path (not only the pure leg)", /judge-unavailable/.test(c.sheetArm2Hint || "") && /failed closed/i.test(c.sheetArm2Hint || ""), (c.sheetArm2Hint || "").slice(0, 180));
      check("fail-closed: the recorded error is not a fabricated verdict (no ACT/CONFIRM/ESCALATE)", !/ACT|CONFIRM|ESCALATE/.test(c.sheetArm2Text || ""), (c.sheetArm2Text || "").slice(0, 160));
      check("fail-closed: confirm land? enabled after the failed gate", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
    },
  },
  {
    name: "unengaged",
    outcome: { status: 200, body: { ok: true, landed: { commit: "d".repeat(40), files: FIXTURE.proposals[0].files, at: "2026-10-12T00:00:00Z" }, evidence: {} } },
    assert(c) {
      check("unengaged: sheet rendered before any verdict (first arm)", c.sheetArm1Present === true, `present=${c.sheetArm1Present}`);
      check("unengaged: sheet rendered after the verdict-less land (second arm)", c.sheetArm2Present === true);
      check("unengaged: sheet states what the land will do", c.sheetArm2What === WHATLINE, String(c.sheetArm2What));
      check("unengaged: neutral recorded-evidence chip", c.sheetArm2ChipText === "recorded-evidence" && String(c.sheetArm2ChipClass || "").includes("badge-neutral"), `${c.sheetArm2ChipClass} ${c.sheetArm2ChipText}`);
      check("unengaged: recorded-evidence note, never a defaulted verdict", /recorded-evidence/i.test(c.sheetArm2Hint || "") && !/ACT|CONFIRM|ESCALATE|blocked/.test(c.sheetArm2Text || ""), (c.sheetArm2Hint || "").slice(0, 160));
      check("unengaged: confirm land? still enabled", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
      check("unengaged: exactly one /land (the human click), none auto-fired", c.landFetchesAfterConfirm === 1 && c.landFetchesLate === 1, `after=${c.landFetchesAfterConfirm} late=${c.landFetchesLate}`);
    },
  },
  {
    name: "render-only",
    outcome: ESCALATE_OUTCOME,
    assert(c) {
      check("render-only: zero /land until the human click", c.landFetchesBeforeClick === 0, `posts=${c.landFetchesBeforeClick}`);
      check("render-only: exactly one /land — the human click, never a render", c.landFetchesAfterConfirm === 1, `posts=${c.landFetchesAfterConfirm}`);
      check("render-only: no second /land after extended settle (nothing auto-fires)", c.landFetchesLate === 1, `posts=${c.landFetchesLate}`);
      check("render-only: confirm land? enabled under the withhold verdict", c.confirmPresentArm2 === true && c.confirmDisabledArm2 === false, `present=${c.confirmPresentArm2} disabled=${c.confirmDisabledArm2}`);
      check("render-only: the sheet exposes no control anywhere (no bypass element)", c.sheetArm2Controls === 0 && c.sheetArm2Buttons === 0 && (c.sheetArm2RawTags || []).length === 0, `controls=${c.sheetArm2Controls} buttons=${c.sheetArm2Buttons}`);
      check("render-only: no bypass affordance anywhere on the canvas", (c.bypassBtns || []).length === 0, JSON.stringify(c.bypassBtns));
      check("render-only: the sheet renders the recorded verdict without re-deriving it", c.sheetArm2ChipText === "escalate" && (c.sheetArm2Hint || "").includes("risk:senior-security:agent-1"), `${c.sheetArm2ChipText} ${(c.sheetArm2Hint || "").slice(0, 120)}`);
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
  check("ui-land-verdict-sheet case threw", false, String(e?.stack ?? e));
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
