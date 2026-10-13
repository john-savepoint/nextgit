#!/usr/bin/env bun
// Contract suite: the forks/signals triage panel (wave-14 L3) — the
// six-cluster fork signals are surfaced from GET /forks on the shipped
// triage page.
// Run: bun porting/tests/ui-forks-panel.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + app.js + the
// module graph incl. js/forks-panel.js) is served from a loopback origin
// into real headless Chrome via --dump-dom; the only scripted pieces are
// the worker's HTTP surface (JSON fixtures per mode) and a tiny inline
// error collector injected before app.js. No module mocks, no source
// grep, no in-page observer of the module's internals. Legs:
//   1. the section renders and a fixture fork card #fork-agent-3 exists
//      with its repo name (loader gone)
//   2. the card shows `base:` — the recorded lineage parent for a fork
//      with upstream, the echoed queried base for an upstream:null fork
//   3. exactly six .fork-signal-chip per card, one per CONTRACT key
//      (data-signal set equality)
//   4. a null cluster renders the literal "unmeasured" (typed-null law,
//      never a fabricated 0) — the peopleTrust case
//   5. a measured cluster renders its numeric value
//   6. untrusted name/base carrying markup renders escaped (no raw <img>)
//   7. fail-soft: a 500 on /forks leaves a quiet unavailable line, the
//      loader gone, and the connection banner STILL hidden (a secondary
//      panel must not trip the banner)
//   8. zero uncaught page errors and no Chrome "Uncaught" on stderr
//      across every dump
// A box without a Chrome binary skips the suite (precedent:
// ui-first-load-panels).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = '<script type="module" src="app.js"></script>';
// Injected before app.js: records every uncaught error/rejection on <html>.
const ERR_COLLECTOR =
  '<script>document.documentElement.setAttribute("data-page-errors","0");window.__errs=[];' +
  'addEventListener("error",(e)=>{window.__errs.push(String((e&&e.message)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});' +
  'addEventListener("unhandledrejection",(e)=>{window.__errs.push(String((e&&e.reason)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});</script>';

const EM_DASH = "\u2014";
const SIX = ["fitOverlap", "peopleTrust", "liveness", "proof", "distance", "costToAdoptVsRegenerate"];

// The fixture ecosystem: base "base-echo" so the two base paths are
// distinguishable — agent-3 carries a recorded lineage parent ("demo"),
// agent-7 is upstream:null and must fall back to the echoed base.
const FIXTURE = {
  ok: true,
  base: "base-echo",
  forks: [
    {
      repo: "agent-3",
      signals: { fitOverlap: 0.9, peopleTrust: null, liveness: 0.7, proof: null, distance: 0.2, costToAdoptVsRegenerate: 0.4 },
      upstream: { repo: "demo", forkPoint: "c-base" },
    },
    {
      repo: "agent-7",
      signals: { fitOverlap: 0.5, peopleTrust: null, liveness: 0, proof: 0.1, distance: 0, costToAdoptVsRegenerate: 0.8 },
      upstream: null,
    },
  ],
};

// Untrusted repo content (AD-4): both the repo name and the base carry markup.
const XSS_REPO = "<img src=x onerror=alert(1)>";
const XSS_BASE = "<script>alert(2)</script>";
const XSS_FIXTURE = {
  ok: true,
  base: XSS_BASE,
  forks: [
    {
      repo: XSS_REPO,
      signals: { fitOverlap: 0.1, peopleTrust: null, liveness: 0, proof: null, distance: 0, costToAdoptVsRegenerate: 0.5 },
      upstream: null,
    },
  ],
};

const PROPOSALS = { ok: true, base: { repo: "fixture", ref: "main" }, ref: "main", summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 }, proposals: [], conflicts: [] };

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI forks panel — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-forks-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ dom: out, stderr: err });
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// --- DOM readers over the dumped markup ---
const forksRegion = (dom) => {
  const m = dom.match(/id="forks-section"[^>]*>([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
};
const cardsOf = (dom) => (forksRegion(dom) || "").split('<div class="fork-card"').slice(1);
const cardFor = (dom, repo) => cardsOf(dom).find((c) => c.trimStart().startsWith(`id="fork-${repo}"`)) ?? null;
const forkNames = (dom) => [...(forksRegion(dom) || "").matchAll(/class="fork-repo-title">([^<]*)</g)].map((m) => m[1]);
const chipSignals = (card) => [...card.matchAll(/class="fork-signal-chip" data-signal="([^"]+)"/g)].map((m) => m[1]);
const chipValue = (card, key) => {
  const m = card.match(new RegExp(`data-signal="${key}"><span class="fork-signal-label">[^<]*</span><span class="fork-signal-value">([^<]*)</span>`));
  return m ? m[1] : null;
};
const baseText = (card) => {
  const m = card.match(/class="fork-base"[^>]*>([^<]*)</);
  return m ? m[1].trim() : null;
};
const pageErrors = (dom) => {
  const m = dom.match(/<html[^>]*data-page-errors="(\d+)"/);
  return m ? Number(m[1]) : null;
};
const bannerVisible = (dom) => !/<div id="connection-banner"[^>]*\shidden(=|\s|>)/.test(dom);

// --- Loopback worker surface: mode selects what /forks does. ---
let mode = "ok";
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/forks") {
    if (mode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    return json(res, mode === "xss" ? XSS_FIXTURE : FIXTURE);
  }
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, { ok: true, events: [] });
  if (pathname === "/judge") return json(res, { ok: true, judgments: [], skipped: [] });
  if (pathname === "/whoami") return json(res, { ok: true, authorized: false, reveal: false });
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (file.endsWith("index.html")) {
    const html = readFileSync(file, "utf8").replace(APP_TAG, ERR_COLLECTOR + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

const dumps = [];
try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  // --- 1. the panel renders the fixture cards ---
  let ok = null;
  try {
    mode = "ok";
    ok = await dumpDom(url);
    dumps.push(["ok", ok]);
    const region = forksRegion(ok.dom);
    check("1 #forks-section renders", region !== null, "section missing");
    check("1 the first-load loader is gone", region !== null && !region.includes("Loading fork signals from /forks..."), (region ?? "").slice(0, 200));
    const card = cardFor(ok.dom, "agent-3");
    check("1 card #fork-agent-3 exists", card !== null, JSON.stringify(forkNames(ok.dom)));
    check("1 card shows its repo name", card !== null && /class="fork-repo-title">agent-3</.test(card), card === null ? "no card" : card.slice(0, 160));
    check("1 the section meta counts the forks", (ok.dom.match(/id="forks-meta"[^>]*>([^<]*)</) || [null, null])[1] === "2 forks", String((ok.dom.match(/id="forks-meta"[^>]*>([^<]*)</) || [null, null])[1]));
  } catch (e) {
    check("1 ok-mode case threw", false, String(e?.message ?? e));
  }

  // --- 2. base: lineage parent vs echoed base ---
  try {
    const lineage = ok ? cardFor(ok.dom, "agent-3") : null;
    const echoed = ok ? cardFor(ok.dom, "agent-7") : null;
    check("2 recorded-lineage fork shows its upstream parent", lineage !== null && baseText(lineage) === "base: demo", String(lineage === null ? "no card" : baseText(lineage)));
    check("2 upstream:null fork shows the echoed queried base", echoed !== null && baseText(echoed) === "base: base-echo", String(echoed === null ? "no card" : baseText(echoed)));
    check("2 base is served on the data-base attribute", lineage !== null && /class="fork-base" data-base="demo"/.test(lineage), lineage === null ? "no card" : lineage.slice(0, 160));
  } catch (e) {
    check("2 base case threw", false, String(e?.message ?? e));
  }

  // --- 3/4/5. chips: six per card, one per key; null -> unmeasured; measured -> numeric ---
  try {
    const card = ok ? cardFor(ok.dom, "agent-3") : null;
    if (card === null) {
      check("3 card present", false, "no #fork-agent-3 card");
    } else {
      const signals = chipSignals(card).slice().sort();
      check("3 exactly six signal chips on the card", (card.match(/class="fork-signal-chip"/g) || []).length === 6, `count=${(card.match(/class="fork-signal-chip"/g) || []).length}`);
      check("3 chips are exactly the six CONTRACT keys", JSON.stringify(signals) === JSON.stringify(SIX.slice().sort()), JSON.stringify(signals));
      check("4 a null cluster renders literal \"unmeasured\"", chipValue(card, "peopleTrust") === "unmeasured", String(chipValue(card, "peopleTrust")));
      check("5 a measured cluster renders its numeric value", chipValue(card, "fitOverlap") === "0.90", String(chipValue(card, "fitOverlap")));
      const second = cardFor(ok.dom, "agent-7");
      check("3 every card carries six chips", second !== null && (second.match(/class="fork-signal-chip"/g) || []).length === 6, second === null ? "no agent-7 card" : `count=${(second.match(/class="fork-signal-chip"/g) || []).length}`);
    }
  } catch (e) {
    check("3 chips case threw", false, String(e?.message ?? e));
  }

  // --- 6. XSS: untrusted name/base renders escaped ---
  try {
    mode = "xss";
    const xss = await dumpDom(url);
    dumps.push(["xss", xss]);
    const region = forksRegion(xss.dom) || "";
    check("6 the untrusted repo name renders escaped", region.includes("&lt;img src=x onerror=alert(1)&gt;"), region.slice(0, 240));
    check("6 the echoed base renders escaped", region.includes("base: &lt;script&gt;alert(2)&lt;/script&gt;"), region.slice(0, 240));
    check("6 no raw element injected from repo content", !region.includes("<img") && !region.includes("<script>"), region.slice(0, 240));
  } catch (e) {
    check("6 xss case threw", false, String(e?.message ?? e));
  }

  // --- 7. fail-soft: /forks 500 -> quiet unavailable, loader gone, banner hidden ---
  try {
    mode = "fail";
    const fail = await dumpDom(url);
    dumps.push(["fail", fail]);
    const region = forksRegion(fail.dom) || "";
    check("7 the panel shows the quiet unavailable line", region.includes("Fork signals unavailable."), region.slice(0, 240));
    check("7 the loader is gone", !region.includes("Loading fork signals from /forks..."), region.slice(0, 240));
    check("7 a /forks failure does NOT trip the connection banner", !bannerVisible(fail.dom));
    check("7 metas stay em-dash on the unobserved panel", (fail.dom.match(/id="forks-meta"[^>]*>([^<]*)</) || [null, null])[1] === EM_DASH, String((fail.dom.match(/id="forks-meta"[^>]*>([^<]*)</) || [null, null])[1]));
  } catch (e) {
    check("7 fail-soft case threw", false, String(e?.message ?? e));
  }

  // --- 8. zero uncaught page errors across every dump ---
  try {
    for (const [label, d] of dumps) {
      check(`8 ${label}: zero uncaught page errors`, pageErrors(d.dom) === 0, `data-page-errors=${pageErrors(d.dom)}`);
      check(`8 ${label}: no Chrome "Uncaught" on stderr`, !/Uncaught/.test(d.stderr), d.stderr.split("\n").filter((l) => /Uncaught/.test(l)).slice(0, 2).join(" | "));
    }
  } catch (e) {
    check("8 error-scan case threw", false, String(e?.message ?? e));
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

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
