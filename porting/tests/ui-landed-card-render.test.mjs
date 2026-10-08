#!/usr/bin/env bun
// Contract suite: landed card initial render — a proposal with landing.status === "landed"
// (or the stats.files === 0 fallback) renders dimmed via .proposal-card.is-landed with the
// landed badge + landed-banner copy from the FIRST /proposals fetch — no land click, no
// post-land transition. Asserted on the shipped platform/ui over real headless Chrome.
// Run: bun porting/tests/ui-landed-card-render.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is loaded
// in real headless Chrome over a loopback origin. The only scripted pieces are the HTTP
// surface (which fixture /proposals serves) and an observer module injected BEFORE app.js
// that reads the real rendered DOM — no product mocks, no source grep.
//
// Fixture: 3 proposal cards in the first /proposals payload:
//   agent-landed-ss  — landing: { status: "landed", files: 1 }, stats: { files: 1 }
//                    → proves landing.status === "landed" renders the landed state
//   agent-landed-fallback — no landing field, stats: { files: 0 }
//                    → proves the stats.files === 0 fallback to isLanded (app.js:559)
//   agent-ready      — landing: { status: "ready", files: 1 }, stats: { files: 1 }
//                    → control: must NOT be landed
//
// Checks (initial render, no interaction):
//   1.  agent-landed-ss card has "is-landed" in its class list
//   2.  agent-landed-ss computed opacity is "0.55" (parsed as number)
//   3.  agent-landed-ss computed border-style is "dashed"
//   4.  agent-landed-ss has a .badge-neutral badge with text "landed"
//   5.  agent-landed-ss .landed-banner is present; .landed-status text is exactly
//       "landed — nothing pending"; the sibling span includes "All changes from this branch
//       have been merged into baseline." and "1 files"
//   6.  agent-landed-ss has NO [data-action="start-land"] button (Land is inert)
//   7.  agent-landed-ss renders no judge chips (landed cards never wear stale chips)
//   8.  agent-landed-fallback card has "is-landed" class (proves stats.files===0 fallback)
//   9.  agent-ready card does NOT have "is-landed" class (control)
//   10. Class exclusivity: each card has at most one state class
//   11. Both landed cards show the landed neutral badge, not in action buttons
// A box without a Chrome binary skips the suite (precedent: ui-card-contract-states.test.mjs).

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
  console.log("SKIP  ui-landed-card-render — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(77); // POSIX skip: Chrome absent, not a failure
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-landed-render-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 13000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 13s"));
    }, 13000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

const parse = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// ---------------------------------------------------------------------------
// Fixture data: 3 proposal cards — two landed (one via landing.status, one via
// stats.files===0 fallback) and one ready control.
// ---------------------------------------------------------------------------

const PROPOSALS = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "1a".repeat(20) },
  ref: "main",
  summary: { proposals: 3, sharedFiles: 0, conflictingPairs: 0, changedFiles: 3, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-landed-ss",
      head: "2b".repeat(20),
      intent: "add feature flag",
      landing: { status: "landed", files: 1 },
      stats: { files: 1, additions: 5, deletions: 0 },
      files: [
        { path: "src/feature.ts", status: "modified", additions: 5, deletions: 0, secret: false },
      ],
    },
    {
      repo: "agent-landed-fallback",
      head: "3c".repeat(20),
      intent: "sync docs",
      stats: { files: 0, additions: 0, deletions: 0 },
      files: [],
    },
    {
      repo: "agent-ready",
      head: "4d".repeat(20),
      intent: "refactor util",
      landing: { status: "ready", files: 1 },
      stats: { files: 1, additions: 3, deletions: 1 },
      files: [
        { path: "src/util.ts", status: "modified", additions: 3, deletions: 1, secret: false },
      ],
    },
  ],
  conflicts: [],
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Waits for the card grid to render,
// then reads the real rendered DOM for each card's class list, computed styles
// (opacity, border-style), badge text, landed-banner text, and judge chips.
// Emits #test-out with structured observations.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { cards: {}, err: null };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const readCard = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  const computed = window.getComputedStyle(c);
  const landedBanner = c.querySelector(".landed-banner");
  const statusEl = landedBanner ? landedBanner.querySelector(".landed-status") : null;
  const bannerSecondSpan = landedBanner ? landedBanner.querySelector("span:nth-child(2)") : null;
  return {
    class: c.className || "",
    hasLanded: c.classList.contains("is-landed"),
    hasWithheldSecret: c.classList.contains("is-withheld-secret"),
    hasConflict: c.classList.contains("is-conflict"),
    computedOpacity: computed.opacity,
    computedBorderStyle: computed.borderStyle,
    // Action buttons inside the card
    startLandBtn: !!c.querySelector('[data-action="start-land"]'),
    // Badge: the neutral "landed" badge in the header actions
    landedBadge: (() => {
      const b = c.querySelector(".badge.badge-neutral");
      return b ? { text: b.textContent.trim(), cls: b.className.trim() } : null;
    })(),
    // Landed banner content
    hasLandedBanner: !!landedBanner,
    landedStatusText: statusEl ? statusEl.textContent.trim() : null,
    landedBannerSecondSpanText: bannerSecondSpan ? bannerSecondSpan.textContent.trim() : null,
    // Judge chips — the .proposal-badges div should contain no badge chips for landed cards
    judgeChips: [...c.querySelectorAll(".proposal-badges .badge")].map((b) => b.textContent.trim()),
    // File rows (should be absent for landed — the banner replaces the stats+files block)
    fileRows: [...c.querySelectorAll(".file-row")].map((r) => {
      const pathEl = r.querySelector(".file-path");
      return { path: pathEl ? pathEl.textContent.trim() : null };
    }),
  };
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    R.cards["agent-landed-ss"] = readCard("agent-landed-ss");
    R.cards["agent-landed-fallback"] = readCard("agent-landed-fallback");
    R.cards["agent-ready"] = readCard("agent-ready");
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs
// ---------------------------------------------------------------------------

function legLandedSS(dom) {
  const R = parse(dom);
  if (!R) return check("1 landed-ss: scenario output present", false, "no #test-out");
  if (R.err) return check("1 landed-ss: scenario threw", false, R.err);

  const c = R.cards["agent-landed-ss"];
  if (!c) return check("1 landed-ss: card present", false, "card not found");

  check("1 landed-ss: card present", true);
  check("1 landed-ss: has is-landed class", c.hasLanded === true, `classes=${c.class}`);
  check("1 landed-ss: no is-withheld-secret class", c.hasWithheldSecret === false);
  check("1 landed-ss: no is-conflict class", c.hasConflict === false);
  check("1 landed-ss: computed opacity is 0.55", Number(c.computedOpacity) === 0.55, `opacity=${c.computedOpacity}`);
  check("1 landed-ss: computed border-style is dashed", c.computedBorderStyle === "dashed", `border-style=${c.computedBorderStyle}`);
  check("1 landed-ss: landed badge is badge-neutral", c.landedBadge && c.landedBadge.cls === "badge badge-neutral", `cls=${c.landedBadge?.cls || "none"}`);
  check("1 landed-ss: landed badge text is 'landed'", c.landedBadge && c.landedBadge.text === "landed", `text=${c.landedBadge?.text || "none"}`);
  check("1 landed-ss: landed-banner present", c.hasLandedBanner === true);
  check("1 landed-ss: landed-status text exact ('landed — nothing pending')",
    c.landedStatusText === "landed — nothing pending", `text=${c.landedStatusText || "none"}`);
  check("1 landed-ss: banner second span includes 'All changes from this branch have been merged into baseline.'",
    c.landedBannerSecondSpanText && c.landedBannerSecondSpanText.includes("All changes from this branch have been merged into baseline."),
    `text=${c.landedBannerSecondSpanText || "none"}`);
  check("1 landed-ss: banner second span includes '1 files'",
    c.landedBannerSecondSpanText && c.landedBannerSecondSpanText.includes("1 files"),
    `text=${c.landedBannerSecondSpanText || "none"}`);
  check("1 landed-ss: no start-land action button (Land inert)", c.startLandBtn === false);
  check("1 landed-ss: no judge chips", c.judgeChips.length === 0, `chips=${JSON.stringify(c.judgeChips)}`);
  check("1 landed-ss: no file rows (banner replaces stats+files block)", c.fileRows.length === 0, `rows=${c.fileRows.length}`);
}

function legLandedFallback(dom) {
  const R = parse(dom);
  if (!R) return check("2 landed-fallback: scenario output present", false, "no #test-out");
  if (R.err) return check("2 landed-fallback: scenario threw", false, R.err);

  const c = R.cards["agent-landed-fallback"];
  if (!c) return check("2 landed-fallback: card present", false, "card not found");

  check("2 landed-fallback: card present", true);
  check("2 landed-fallback: has is-landed class (stats.files===0 fallback)", c.hasLanded === true, `classes=${c.class}`);
  check("2 landed-fallback: computed opacity is 0.55", Number(c.computedOpacity) === 0.55, `opacity=${c.computedOpacity}`);
  check("2 landed-fallback: computed border-style is dashed", c.computedBorderStyle === "dashed", `border-style=${c.computedBorderStyle}`);
  check("2 landed-fallback: landed badge is badge-neutral", c.landedBadge && c.landedBadge.cls === "badge badge-neutral", `cls=${c.landedBadge?.cls || "none"}`);
  check("2 landed-fallback: landed badge text is 'landed'", c.landedBadge && c.landedBadge.text === "landed", `text=${c.landedBadge?.text || "none"}`);
  check("2 landed-fallback: landed-banner present", c.hasLandedBanner === true);
  check("2 landed-fallback: landed-status text exact ('landed — nothing pending')",
    c.landedStatusText === "landed — nothing pending", `text=${c.landedStatusText || "none"}`);
  check("2 landed-fallback: no start-land action button (Land inert)", c.startLandBtn === false);
  check("2 landed-fallback: no judge chips", c.judgeChips.length === 0, `chips=${JSON.stringify(c.judgeChips)}`);
  check("2 landed-fallback: no file rows", c.fileRows.length === 0, `rows=${c.fileRows.length}`);
}

function legReady(dom) {
  const R = parse(dom);
  if (!R) return check("3 ready: scenario output present", false, "no #test-out");
  if (R.err) return check("3 ready: scenario threw", false, R.err);

  const c = R.cards["agent-ready"];
  if (!c) return check("3 ready: card present", false, "card not found");

  check("3 ready: card present", true);
  check("3 ready: no is-withheld-secret class", c.hasWithheldSecret === false);
  check("3 ready: no is-conflict class", c.hasConflict === false);
  check("3 ready: no is-landed class (control)", c.hasLanded === false, `classes=${c.class}`);
  check("3 ready: actionable start-land button present", c.startLandBtn === true);
  check("3 ready: computed opacity is NOT 0.55 (not dimmed)", Number(c.computedOpacity) !== 0.55, `opacity=${c.computedOpacity}`);
  check("3 ready: computed border-style is NOT dashed", c.computedBorderStyle !== "dashed", `border-style=${c.computedBorderStyle}`);
}

function legClassExclusivity(dom) {
  const R = parse(dom);
  if (!R) return check("4 exclusivity: scenario output present", false, "no #test-out");
  if (R.err) return check("4 exclusivity: scenario threw", false, R.err);

  const stateClasses = (cls) => {
    const states = ["is-landed", "is-withheld-secret", "is-conflict"];
    return states.filter((s) => cls.includes(s)).length;
  };

  const ss = R.cards["agent-landed-ss"];
  const fb = R.cards["agent-landed-fallback"];
  const rd = R.cards["agent-ready"];
  if (!ss || !fb || !rd) return check("4 exclusivity: cards present", false, "missing cards");

  check("4 exclusivity: landed-ss has exactly 1 state class", stateClasses(ss.class) === 1, `classes=${ss.class}`);
  check("4 exclusivity: landed-fallback has exactly 1 state class", stateClasses(fb.class) === 1, `classes=${fb.class}`);
  check("4 exclusivity: ready has 0 state classes", stateClasses(rd.class) === 0, `classes=${rd.class}`);
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  const dom = await dumpDom(url);
  legLandedSS(dom);
  legLandedFallback(dom);
  legReady(dom);
  legClassExclusivity(dom);
} catch (e) {
  check("harness setup failed", false, String(e?.message ?? e));
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 1000);
    server.close(() => { clearTimeout(t); resolve(); });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
