#!/usr/bin/env bun
// Contract suite: the issues triage panel (nextgit-e16,
// wave-15) — the derived issue list is surfaced from
// GET /issues on the shipped triage page.
// Run: bun porting/tests/ui-issues-panel.test.mjs
// (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html +
// app.js + the module graph incl. js/issues-panel.js) is
// served from a loopback origin into real headless Chrome
// via --dump-dom; the only scripted pieces are the worker's
// HTTP surface (JSON fixtures per mode) and a tiny inline
// error collector injected before app.js. No module mocks,
// no source grep, no in-page observer of the module's
// internals. Legs:
//   1. the section renders one row per fixture issue with
//      the kind badge (loader gone)
//   2. the empty fixture renders "No open issues" and the
//      loader is gone
//   3. untrusted repo/title carrying <img onerror> renders
//      escaped (no raw markup in the DOM)
//   4. a 500 on /issues renders a quiet unavailable line
//      with the connection banner STILL hidden (fail-soft —
//      a secondary panel must not trip the banner)
//   5. zero uncaught page errors across every dump
// A box without a Chrome binary skips the suite (precedent:
// ui-forks-panel).

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

// The fixture issue set — one row per derivation kind,
// with a link per row (the CONTRACT §GET /issues shape).
const FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    {
      id: "conflict:agent-conflict:src/a.ts",
      kind: "conflict",
      repo: "agent-conflict",
      severity: "high",
      title: "Merge conflict in src/a.ts",
      detail: "src/a.ts",
      links: ["/merge?base=demo&repos=agent-conflict"],
    },
    {
      id: "withheld-secret:agent-secret:config/.env",
      kind: "withheld-secret",
      repo: "agent-secret",
      severity: "medium",
      title: "Secret-class file withheld: config/.env",
      detail: "config/.env: 2 key(s) withheld",
      links: ["/merge?base=demo&repos=agent-secret"],
    },
    {
      id: "stale-base:agent-stale",
      kind: "stale-base",
      repo: "agent-stale",
      severity: "low",
      title: "Fork agent-stale shares no history with demo",
      detail: 'no shared first-parent commit with base "demo" within the 200-commit walk',
      links: ["/forks?base=demo"],
    },
    {
      id: "blocked-intent:agent-nonaligned",
      kind: "blocked-intent",
      repo: "agent-nonaligned",
      severity: "info",
      title: 'Matcher verdict "ignore" for agent-nonaligned',
      detail: "matcher verdict ignore over 1 candidate fork(s)",
      links: ["/intents"],
    },
  ],
};

const EMPTY = { ok: true, base: "demo", issues: [] };

// Untrusted repo content (AD-4): the repo name and the
// title carry markup.
const XSS_REPO = "<img src=x onerror=alert(1)>";
const XSS_TITLE = "<script>alert(2)</script>";
const XSS_FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    {
      id: "conflict:<img>:x",
      kind: "conflict",
      repo: XSS_REPO,
      severity: "high",
      title: XSS_TITLE,
      detail: "src/a.ts",
      links: ["/merge?base=demo&repos=x"],
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
  console.log("SKIP  UI issues panel — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-issues-"));

// Async spawn: the loopback server runs on THIS process's
// event loop, so a blocking exec would deadlock the very
// fetch the page is waiting on.
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
const issuesRegion = (dom) => {
  const m = dom.match(/id="issues-section"[^>]*>([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
};
// A rendered row opens with `issue-row issue-severity-…`;
// the split delimiter must be the full class pair so it
// does not also match the nested `issue-row-header` div.
const rowsOf = (dom) => (issuesRegion(dom) || "").split('<div class="issue-row issue-severity-').slice(1);
const rowKinds = (dom) => [...(issuesRegion(dom) || "").matchAll(/class="issue-kind-badge">([^<]*)</g)].map((m) => m[1]);
const rowRepos = (dom) => [...(issuesRegion(dom) || "").matchAll(/class="issue-repo">([^<]*)</g)].map((m) => m[1]);
const pageErrors = (dom) => {
  const m = dom.match(/<html[^>]*data-page-errors="(\d+)"/);
  return m ? Number(m[1]) : null;
};
const bannerVisible = (dom) => !/<div id="connection-banner"[^>]*\shidden(=|\s|>)/.test(dom);


// --- Loopback worker surface: mode selects what /issues does. ---
let mode = "ok";
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/issues") {
    if (mode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    return json(res, mode === "xss" ? XSS_FIXTURE : mode === "empty" ? EMPTY : FIXTURE);
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

  // --- 1. the panel renders one row per fixture issue with the kind badge ---
  let ok = null;
  try {
    mode = "ok";
    ok = await dumpDom(url);
    dumps.push(["ok", ok]);
    const region = issuesRegion(ok.dom);
    check("1 #issues-section renders", region !== null, "section missing");
    check("1 the first-load loader is gone", region !== null && !region.includes("Loading issues from /issues..."), (region ?? "").slice(0, 200));
    const rows = rowsOf(ok.dom);
    check("1 one row per fixture issue (4)", rows.length === 4, `count=${rows.length}`);
    const kinds = rowKinds(ok.dom);
    check("1 every row carries its kind badge", JSON.stringify(kinds) === JSON.stringify(["conflict", "withheld secret", "stale base", "blocked intent"]), JSON.stringify(kinds));
    const repos = rowRepos(ok.dom);
    check("1 every row carries its repo", repos.length === 4 && repos[0] === "agent-conflict", JSON.stringify(repos));
    check("1 the section meta counts the issues", (ok.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1] === "4 issues", String((ok.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1]));
  } catch (e) {
    check("1 ok-mode case threw", false, String(e?.message ?? e));
  }

  // --- 2. the empty fixture renders "No open issues" and the loader is gone ---
  try {
    mode = "empty";
    const empty = await dumpDom(url);
    dumps.push(["empty", empty]);
    const region = issuesRegion(empty.dom) || "";
    check("2 the empty state renders", region.includes("No open issues for demo"), region.slice(0, 240));
    check("2 the loader is gone", !region.includes("Loading issues from /issues..."), region.slice(0, 240));
    check("2 the meta counts zero issues", (empty.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1] === "0 issues", String((empty.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1]));
  } catch (e) {
    check("2 empty-mode case threw", false, String(e?.message ?? e));
  }

  // --- 3. XSS: untrusted repo/title renders escaped ---
  try {
    mode = "xss";
    const xss = await dumpDom(url);
    dumps.push(["xss", xss]);
    const region = issuesRegion(xss.dom) || "";
    check("3 the untrusted repo name renders escaped", region.includes("&lt;img src=x onerror=alert(1)&gt;"), region.slice(0, 240));
    check("3 the untrusted title renders escaped", region.includes("&lt;script&gt;alert(2)&lt;/script&gt;"), region.slice(0, 240));
    check("3 no raw element injected from repo content", !region.includes("<img") && !region.includes("<script>"), region.slice(0, 240));
  } catch (e) {
    check("3 xss case threw", false, String(e?.message ?? e));
  }

  // --- 4. fail-soft: /issues 500 -> quiet unavailable, loader gone, banner hidden ---
  try {
    mode = "fail";
    const fail = await dumpDom(url);
    dumps.push(["fail", fail]);
    const region = issuesRegion(fail.dom) || "";
    check("4 the panel shows the quiet unavailable line", region.includes("Issues unavailable."), region.slice(0, 240));
    check("4 the loader is gone", !region.includes("Loading issues from /issues..."), region.slice(0, 240));
    check("4 a /issues failure does NOT trip the connection banner", !bannerVisible(fail.dom));
    check("4 metas stay em-dash on the unobserved panel", (fail.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1] === "—", String((fail.dom.match(/id="issues-meta"[^>]*>([^<]*)</) || [null, null])[1]));
  } catch (e) {
    check("4 fail-soft case threw", false, String(e?.message ?? e));
  }

  // --- 5. zero uncaught page errors across every dump ---
  try {
    for (const [label, d] of dumps) {
      check(`5 ${label}: zero uncaught page errors`, pageErrors(d.dom) === 0, `data-page-errors=${pageErrors(d.dom)}`);
      check(`5 ${label}: no Chrome "Uncaught" on stderr`, !/Uncaught/.test(d.stderr), d.stderr.split("\n").filter((l) => /Uncaught/.test(l)).slice(0, 2).join(" | "));
    }
  } catch (e) {
    check("5 error-scan case threw", false, String(e?.message ?? e));
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
