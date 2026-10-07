#!/usr/bin/env bun
// Contract suite: FR-6 (action-banner clause) — the action banner state machine and card reset.
// Run: bun porting/tests/action-banner-states.test.mjs   (exit 0 = pass)
// Live leg: PROPS_FIXTURE=<path to a /proposals capture> bun porting/tests/action-banner-states.test.mjs
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in a real
// headless Chrome over a loopback origin. The only scripted pieces are the worker's HTTP
// surface (which /land attempts fail, and how they fail) and an observer module injected
// BEFORE app.js that records what the real app rendered and clicks the real controls —
// no product mocks, no source grep. Legs:
//   1. one real cycle with /land failing once then succeeding: the in-flight warn banner
//      ('landing' + "Landing proposal {repo} into {base}...") with the acted card in its
//      landing state; the failure turns the SAME element into banner-error/badge 'failed'
//      and returns the card to default in the same cycle (no confirm anywhere, no other
//      card touched); a following land replaces the banner on the SAME element (error →
//      warn in flight → success/badge 'landed' with the commit chip) and resets the card
//      again; the banner then survives a full /events (2 s) + /proposals (8 s) poll window
//      untouched — dismiss-only, never auto-hiding — and the dismiss control hides it
//      without removing the element. Exactly one #action-banner element exists throughout.
//   2. error vocabulary on the single element: a conflict 409 → banner-error/badge
//      'conflict'; a withheld-secret 409 → banner-error/badge 'blocked', each naming its
//      evidence, each returning the acted card to default.
//   3. FR-15 outcomes 6/8/9: three sequential failed lands on the one banner element —
//      409 no-changes / stale / base-moved each render banner-error with the exact dedicated
//      copy and its badge, each returns the acted card to default; an unmapped 409 keeps the
//      generic 'Failed to land {repo}: {msg}' fallback + badge 'failed'.
//   4. live capture (PROPS_FIXTURE): leg 1's battery verbatim over the live payload; unset
//      -> one SKIP line. The live set must carry >= 1 landable proposal (this order's
//      acceptance predicate) plus base.repo and base.ref.
// A box without a Chrome binary skips the suite (precedent: conflict-map-render /
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
  console.log("SKIP  FR-6 action banner — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-banner-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking exec
// would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 30000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

const parseScenario = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// The fixture payload: two proposals, exactly one landable (agent-1) and one already
// landed (agent-2) — the landed card lets the contract prove the reset is SCOPED to the
// acted card. The live leg swaps in the real capture.
const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main" },
  ref: "main",
  summary: { proposals: 2, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      intent: "harden the auth flow",
      landing: { status: "ready" },
      stats: { files: 1, additions: 3, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }],
    },
    {
      repo: "agent-2",
      intent: "document the baseline",
      landing: { status: "landed" },
      stats: { files: 1, additions: 1, deletions: 0 },
      files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }],
    },
  ],
  conflicts: [],
};

// Observer + driver, injected BEFORE app.js. Every interaction is guarded so a broken
// state still yields per-clause observations instead of masking them behind one throw.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x === u).length;
const q = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const banner = () => document.getElementById("action-banner");
const bannerHidden = () => { const b = banner(); return b ? b.hidden === true : null; };
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const SEL_START = '[data-action="start-land"]';
const SEL_CONF = '[data-action="confirm-land"]';
const readDefault = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  return {
    start: !!c.querySelector(SEL_START),
    preview: !!c.querySelector(".btn-preview-merge"),
    confirm: !!c.querySelector(SEL_CONF),
    disabled: !!c.querySelector(".btn-land[disabled]"),
  };
};
const startLand = (repo) => {
  const b = cardOf(repo) && cardOf(repo).querySelector(SEL_START);
  if (!b) { R.c.actionMissing = true; return false; }
  b.click();
  return true;
};
const confirmLand = (repo) => {
  const b = cardOf(repo) && cardOf(repo).querySelector(SEL_CONF);
  if (!b) { R.c.actionMissing = true; return false; }
  b.click();
  return true;
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(600);
    if (MODE === "errors") {
      const first = qs(SEL_START);
      if (!first) { R.c.noStart = true; } else {
        R.repo = first.getAttribute("data-repo");
        banner().__probe = 1;
        first.click();
        qs(SEL_CONF).click();
        await sleep(1200);
        R.c.conflictShown = bannerHidden() === false;
        R.c.conflictClass = banner().className;
        R.c.conflictBadge = q("action-banner-badge").textContent.trim();
        R.c.conflictMsg = q("action-banner-msg").textContent.trim();
        R.c.conflictCount = document.querySelectorAll("#action-banner").length;
        R.c.conflictSameEl = banner().__probe === 1;
        R.c.conflictDefault = readDefault(R.repo);
        if (startLand(R.repo)) {
          confirmLand(R.repo);
          await sleep(1200);
          R.c.blockedShown = bannerHidden() === false;
          R.c.blockedClass = banner().className;
          R.c.blockedBadge = q("action-banner-badge").textContent.trim();
          R.c.blockedMsg = q("action-banner-msg").textContent.trim();
          R.c.blockedCount = document.querySelectorAll("#action-banner").length;
          R.c.blockedSameEl = banner().__probe === 1;
          R.c.blockedDefault = readDefault(R.repo);
        }
      }
    } else if (MODE === "outcomes") {
      const first = qs(SEL_START);
      if (!first) { R.c.noStart = true; } else {
        R.repo = first.getAttribute("data-repo");
        banner().__probe = 1;
        const cycle = async (key) => {
          if (!startLand(R.repo)) return;
          confirmLand(R.repo);
          await sleep(1200);
          R.c[key + "Shown"] = bannerHidden() === false;
          R.c[key + "Class"] = banner().className;
          R.c[key + "Badge"] = q("action-banner-badge").textContent.trim();
          R.c[key + "Msg"] = q("action-banner-msg").textContent.trim();
          R.c[key + "SameEl"] = banner().__probe === 1;
          R.c[key + "Count"] = document.querySelectorAll("#action-banner").length;
          R.c[key + "Default"] = readDefault(R.repo);
        };
        await cycle("noChanges");
        await cycle("stale");
        await cycle("baseMoved");
        await cycle("unknown");
      }
    } else {
      const first = qs(SEL_START);
      if (!first) { R.c.noStart = true; } else {
        R.repo = first.getAttribute("data-repo");
        R.c.landedCardsBefore = document.querySelectorAll(".proposal-card.is-landed").length;
        banner().__probe = 1;
        if (startLand(R.repo)) {
          confirmLand(R.repo);
          // The click prefix of handleLandProposal is synchronous: the in-flight banner
          // and the card's landing state are readable before any await.
          R.c.warnShown = bannerHidden() === false;
          R.c.warnClass = banner().className;
          R.c.warnBadge = q("action-banner-badge").textContent.trim();
          R.c.warnMsg = q("action-banner-msg").textContent.trim();
          R.c.warnCount = document.querySelectorAll("#action-banner").length;
          R.c.warnSameEl = banner().__probe === 1;
          R.c.landingBtn = (cardOf(R.repo).querySelector(".btn-land[disabled]") || {}).textContent;
          R.c.landingScope = { start: !!cardOf(R.repo).querySelector(SEL_START), preview: !!cardOf(R.repo).querySelector(".btn-preview-merge") };
          await sleep(1200);
          R.c.errShown = bannerHidden() === false;
          R.c.errClass = banner().className;
          R.c.errBadge = q("action-banner-badge").textContent.trim();
          R.c.errMsg = q("action-banner-msg").textContent.trim();
          R.c.errCount = document.querySelectorAll("#action-banner").length;
          R.c.errSameEl = banner().__probe === 1;
          R.c.confirmsAnywhere = document.querySelectorAll(SEL_CONF).length;
          R.c.errDefault = readDefault(R.repo);
          R.c.landedCardsAfterFail = document.querySelectorAll(".proposal-card.is-landed").length;
          if (startLand(R.repo)) {
            confirmLand(R.repo);
            R.c.warn2Class = banner().className;
            R.c.warn2Badge = q("action-banner-badge").textContent.trim();
            R.c.warn2SameEl = banner().__probe === 1;
            R.c.warn2Count = document.querySelectorAll("#action-banner").length;
            await sleep(1200);
            R.c.okShown = bannerHidden() === false;
            R.c.okClass = banner().className;
            R.c.okBadge = q("action-banner-badge").textContent.trim();
            R.c.okMsg = q("action-banner-msg").textContent.trim();
            R.c.okCount = document.querySelectorAll("#action-banner").length;
            R.c.okSameEl = banner().__probe === 1;
            R.c.okCommit = (() => {
              const el = document.querySelector("#action-banner-msg code.commit-sha");
              return el ? { text: el.textContent.trim(), title: el.getAttribute("title") } : null;
            })();
            R.c.okDefault = readDefault(R.repo);
            // Dismiss-only: wait until the /proposals poll (8 s) has fired at least once
            // with the banner up - no timer anywhere may hide it.
            const before = hits("/proposals");
            for (let i = 0; i < 40 && hits("/proposals") <= before; i++) await sleep(400);
            R.c.propsPolls = hits("/proposals") - before;
            R.c.eventsFetches = hits("/events");
            R.c.stillShown = bannerHidden() === false;
            R.c.stillSameEl = banner().__probe === 1;
            R.c.stillCount = document.querySelectorAll("#action-banner").length;
            const close = q("action-banner-close");
            if (close) close.click();
            R.c.dismissed = bannerHidden() === true;
            R.c.dismissCount = document.querySelectorAll("#action-banner").length;
          }
        }
      }
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// The FR-6 action-banner contract (observations from the injected driver).
// ---------------------------------------------------------------------------
const defaultShape = (s) => s && s.start === true && s.preview === true && s.confirm === false && s.disabled === false;

function coreContract(label, dom, obs, payload) {
  if (!obs) {
    check(`${label} scenario output present (chrome + observer ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  const repo = obs.repo;
  const baseRepo = (payload.base || {}).repo;
  const runner = `${label} `;
  check(`${runner}driver found a landable card`, c.noStart !== true && typeof repo === "string", `repo=${repo}`);
  check(`${runner}every land was reachable (no control went missing)`, c.actionMissing !== true);
  // In-flight (warn) state.
  check(`${runner}in-flight banner is visible`, c.warnShown === true);
  check(`${runner}in-flight class is banner-warn`, String(c.warnClass || "").includes("banner-warn"), `class=${c.warnClass}`);
  check(`${runner}in-flight badge is 'landing'`, c.warnBadge === "landing", String(c.warnBadge));
  check(`${runner}in-flight copy exact`, c.warnMsg === `Landing proposal ${repo} into ${baseRepo}...`, JSON.stringify(c.warnMsg));
  check(`${runner}exactly one action banner while in flight`, c.warnCount === 1, `count=${c.warnCount}`);
  check(`${runner}banner element identity holds in flight (same node, not re-created)`, c.warnSameEl === true);
  check(`${runner}acted card shows its landing state`, c.landingBtn === "landing...", JSON.stringify(c.landingBtn));
  check(`${runner}landing state is scoped to the action (no default controls on that card)`, c.landingScope && c.landingScope.start === false && c.landingScope.preview === false, JSON.stringify(c.landingScope));
  // Error outcome + card reset (same cycle).
  check(`${runner}error banner is visible after the failed land`, c.errShown === true);
  check(`${runner}error class is banner-error`, String(c.errClass || "").includes("banner-error"), `class=${c.errClass}`);
  check(`${runner}error badge is 'failed'`, c.errBadge === "failed", String(c.errBadge));
  check(`${runner}error copy names the repo and the failure`, String(c.errMsg || "").includes(repo) && String(c.errMsg || "").includes("boom"), JSON.stringify(c.errMsg));
  check(`${runner}exactly one action banner after the failure`, c.errCount === 1, `count=${c.errCount}`);
  check(`${runner}banner element identity holds across in-flight -> error`, c.errSameEl === true);
  check(`${runner}no lingering confirm control anywhere after the failure`, c.confirmsAnywhere === 0, `count=${c.confirmsAnywhere}`);
  check(`${runner}acted card returned to default in the same cycle`, defaultShape(c.errDefault), JSON.stringify(c.errDefault));
  const landedInPayload = (payload.proposals || []).filter((p) => ((p.landing || {}).status || "") === "landed").length;
  check(`${runner}no other card changed state through the cycle`, c.landedCardsBefore === c.landedCardsAfterFail, `before=${c.landedCardsBefore} after=${c.landedCardsAfterFail}`);
  if (landedInPayload >= 1) check(`${runner}the reset was scoped - the already-landed card stayed landed`, c.landedCardsAfterFail >= 1, `landed=${c.landedCardsAfterFail}`);
  // A new action replaces the previous banner (same element, error -> warn).
  check(`${runner}second action replaced the banner back in flight on the same element`, c.warn2SameEl === true && String(c.warn2Class || "").includes("banner-warn") && c.warn2Badge === "landing", `${c.warn2Class}/${c.warn2Badge}`);
  check(`${runner}still exactly one action banner after the replacement`, c.warn2Count === 1, `count=${c.warn2Count}`);
  // Success outcome.
  check(`${runner}success banner is visible`, c.okShown === true);
  check(`${runner}success class is banner-success and no longer banner-error`, String(c.okClass || "").includes("banner-success") && !String(c.okClass || "").includes("banner-error"), `class=${c.okClass}`);
  check(`${runner}success badge is 'landed'`, c.okBadge === "landed", String(c.okBadge));
  check(`${runner}success copy exact`, c.okMsg === `Successfully landed proposal ${obs.repo2 ?? repo} into ${baseRepo}. Commit ${COMMIT.slice(0, 8)}`, JSON.stringify(c.okMsg));
  check(`${runner}success banner carries the commit chip (short text + full title)`, !!c.okCommit && c.okCommit.text === COMMIT.slice(0, 8) && c.okCommit.title === COMMIT, JSON.stringify(c.okCommit));
  check(`${runner}exactly one action banner after the success`, c.okCount === 1, `count=${c.okCount}`);
  check(`${runner}banner element identity holds across error -> success`, c.okSameEl === true);
  check(`${runner}acted card returned to default after the success`, defaultShape(c.okDefault), JSON.stringify(c.okDefault));
  // Dismiss-only, across a full poll window.
  check(`${runner}a /proposals poll fired while the banner was up (the window is real)`, c.propsPolls >= 1, `polls=${c.propsPolls}`);
  check(`${runner}surface kept polling while the banner persisted`, c.eventsFetches >= 2, `events=${c.eventsFetches}`);
  check(`${runner}banner never auto-hid across the poll window (dismiss-only)`, c.stillShown === true);
  check(`${runner}banner stayed one element through the poll window`, c.stillSameEl === true && c.stillCount === 1, `same=${c.stillSameEl} count=${c.stillCount}`);
  check(`${runner}dismiss control hid the banner`, c.dismissed === true);
  check(`${runner}dismiss hid without removing the element`, c.dismissCount === 1, `count=${c.dismissCount}`);
  check(`${runner}dom dump holds exactly one action-banner element`, (dom.match(/id="action-banner"/g) || []).length === 1);
}

function errorVocabularyContract(label, dom, obs) {
  if (!obs) {
    check(`${label} scenario output present (chrome + observer ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  const runner = `${label} `;
  check(`${runner}driver found a landable card`, c.noStart !== true);
  check(`${runner}both 409 lands were reachable`, c.actionMissing !== true);
  check(`${runner}conflict outcome: banner-error class`, String(c.conflictClass || "").includes("banner-error"), `class=${c.conflictClass}`);
  check(`${runner}conflict outcome: badge 'conflict'`, c.conflictBadge === "conflict", String(c.conflictBadge));
  check(`${runner}conflict outcome: visible with the conflict evidence named`, c.conflictShown === true && String(c.conflictMsg || "").includes("src/auth.ts") && String(c.conflictMsg || "").includes("Conflicted files"), JSON.stringify(c.conflictMsg));
  check(`${runner}conflict outcome: same single element`, c.conflictSameEl === true && c.conflictCount === 1, `same=${c.conflictSameEl} count=${c.conflictCount}`);
  check(`${runner}conflict outcome: card returned to default`, defaultShape(c.conflictDefault), JSON.stringify(c.conflictDefault));
  check(`${runner}blocked outcome: banner-error class`, String(c.blockedClass || "").includes("banner-error"), `class=${c.blockedClass}`);
  check(`${runner}blocked outcome: badge 'blocked'`, c.blockedBadge === "blocked", String(c.blockedBadge));
  check(`${runner}blocked outcome: visible with the withheld secret file named`, c.blockedShown === true && String(c.blockedMsg || "").includes("config/.env") && String(c.blockedMsg || "").includes("Withheld-secret"), JSON.stringify(c.blockedMsg));
  check(`${runner}blocked outcome: same single element`, c.blockedSameEl === true && c.blockedCount === 1, `same=${c.blockedSameEl} count=${c.blockedCount}`);
  check(`${runner}blocked outcome: card returned to default`, defaultShape(c.blockedDefault), JSON.stringify(c.blockedDefault));
  check(`${runner}dom dump holds exactly one action-banner element`, (dom.match(/id="action-banner"/g) || []).length === 1);
}

// The dedicated FR-15 outcome copies (PRD FR-15 consequences 6/8/9) — exact strings.
const OUTCOME_COPY = {
  noChanges: "Nothing to land — fold produced zero changes.",
  stale: "This proposal is stale — rebase and re-push to land.",
  baseMoved: "Nothing to land — the baseline moved since this proposal was made.",
};

function outcomeVocabularyContract(label, dom, obs) {
  if (!obs) {
    check(`${label} scenario output present (chrome + observer ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  const runner = `${label} `;
  check(`${runner}driver found a landable card`, c.noStart !== true && typeof obs.repo === "string", `repo=${obs.repo}`);
  check(`${runner}every land was reachable (no control went missing)`, c.actionMissing !== true);
  for (const [key, code] of [["noChanges", "no-changes"], ["stale", "stale"], ["baseMoved", "base-moved"]]) {
    check(`${runner}${code}: banner visible`, c[key + "Shown"] === true);
    check(`${runner}${code}: banner-error class`, String(c[key + "Class"] || "").includes("banner-error"), `class=${c[key + "Class"]}`);
    check(`${runner}${code}: badge`, c[key + "Badge"] === code, String(c[key + "Badge"]));
    check(`${runner}${code}: exact dedicated copy`, c[key + "Msg"] === OUTCOME_COPY[key], JSON.stringify(c[key + "Msg"]));
    check(`${runner}${code}: never the generic copy`, !String(c[key + "Msg"] || "").includes("Failed to land"));
    check(`${runner}${code}: same single element`, c[key + "SameEl"] === true && c[key + "Count"] === 1, `same=${c[key + "SameEl"]} count=${c[key + "Count"]}`);
    check(`${runner}${code}: card returned to default`, defaultShape(c[key + "Default"]), JSON.stringify(c[key + "Default"]));
  }
  check(`${runner}unknown 409: banner-error class`, String(c.unknownClass || "").includes("banner-error"), `class=${c.unknownClass}`);
  check(`${runner}unknown 409 keeps the generic fallback`, c.unknownMsg === `Failed to land ${obs.repo}: unknown-refusal`, JSON.stringify(c.unknownMsg));
  check(`${runner}unknown 409 keeps badge 'failed'`, c.unknownBadge === "failed", String(c.unknownBadge));
  check(`${runner}unknown 409: card returned to default`, defaultShape(c.unknownDefault), JSON.stringify(c.unknownDefault));
  check(`${runner}dom dump holds exactly one action-banner element`, (dom.match(/id="action-banner"/g) || []).length === 1);
}

// ---------------------------------------------------------------------------
// Loopback worker surface: mode selects how /land answers.
// ---------------------------------------------------------------------------
let mode = "core"; // core | errors | outcomes
let payload = FIXTURE;
let landServed = 0;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [{ type: "push", repo: "agent-2", at: "2026-10-07T10:00:01Z" }] }));
    return;
  }
  if (pathname === "/land") {
    landServed++;
    if (mode === "outcomes") {
      const outcome = {
        1: { status: 409, body: { ok: false, error: "no-changes", detail: "fold of agent-1 onto demo:main changes nothing" } },
        2: { status: 409, body: { ok: false, error: "stale", detail: "reviewed base head does not match the current base head" } },
        3: { status: 409, body: { ok: false, error: "base-moved", detail: "base head moved between review and land" } },
        4: { status: 409, body: { ok: false, error: "unknown-refusal", detail: "an unmapped 409 the dedicated arms must not swallow" } },
      }[landServed];
      if (outcome) {
        res.writeHead(outcome.status, { "content-type": "application/json" });
        res.end(JSON.stringify(outcome.body));
        return;
      }
    } else if (mode === "errors") {
      if (landServed === 1) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "conflict", conflicted: [{ file: "src/auth.ts", kind: "text-conflict" }] }));
        return;
      }
      if (landServed === 2) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "withheld-secret", files: ["config/.env"] }));
        return;
      }
    } else if (landServed === 1) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "boom" }));
      return;
    }
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
    res.end(clientScript(mode));
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (rel === "index.html") {
    const html = readFileSync(file, "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html.replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

const resetServer = (next) => {
  mode = next.mode ?? "core";
  payload = next.payload ?? FIXTURE;
  landServed = 0;
};

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // --- 1. in-flight -> error/reset -> success/replacement -> dismiss-only -------------
  try {
    resetServer({ mode: "core" });
    const dom = await dumpDom(url);
    coreContract("1", dom, parseScenario(dom), FIXTURE);
  } catch (e) {
    check("1 banner cycle case threw", false, String(e?.stack ?? e));
  }

  // --- 2. error vocabulary: conflict + withheld-secret 409s on the one element --------
  try {
    resetServer({ mode: "errors" });
    const dom = await dumpDom(url);
    errorVocabularyContract("2", dom, parseScenario(dom));
  } catch (e) {
    check("2 error-vocabulary case threw", false, String(e?.stack ?? e));
  }

  // --- 3. FR-15 outcomes 6/8/9: dedicated no-changes / stale / base-moved banners ---
  try {
    resetServer({ mode: "outcomes" });
    const dom = await dumpDom(url);
    outcomeVocabularyContract("3", dom, parseScenario(dom));
  } catch (e) {
    check("3 outcome-vocabulary case threw", false, String(e?.stack ?? e));
  }

  // --- 4. live capture: the order's check_cmd writes /proposals to a file -------------
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  4 live capture - PROPS_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      const props = Array.isArray(live?.proposals) ? live.proposals : [];
      const landable = props.filter((p) => (p?.landing?.status ?? "ready") !== "landed");
      check("4 live capture carries >= 1 landable proposal", landable.length >= 1, `landable=${landable.length}`);
      check("4 live capture carries base.repo + base.ref", typeof live?.base?.repo === "string" && live.base.repo.length > 0 && typeof live?.base?.ref === "string" && live.base.ref.length > 0, JSON.stringify(live?.base));
      resetServer({ mode: "core", payload: live });
      const dom = await dumpDom(url);
      coreContract("4", dom, parseScenario(dom), live);
    } catch (e) {
      check("4 live-capture case threw", false, String(e?.stack ?? e));
    }
  }
} finally {
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
