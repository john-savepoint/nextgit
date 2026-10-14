#!/usr/bin/env bun
// Contract suite: the issues triage panel (nextgit-e16,
// wave-15; issues-v2 composer + close affordances,
// wave-18) — the derived+stored issue list is surfaced
// from GET /issues, the composer POSTs /issues, and the
// stored-row close affordance PATCHes /issues/{id}.
// Run: bun porting/tests/ui-issues-panel.test.mjs
// (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html
// + app.js + the module graph incl. js/issues-panel.js)
// is served VERBATIM from a loopback origin into real
// headless Chrome via --dump-dom; the only scripted
// pieces are the worker's HTTP surface (JSON fixtures
// per mode, plus recorded POST/PATCH seams) and a tiny
// observer/driver injected before app.js. No module
// mocks, no source grep, no in-page observer of the
// module's internals. Legs:
//   1. the section renders one row per fixture issue
//      with the origin badge (derived rows badge their
//      leg, stored rows badge "stored") + the composer
//      (title maxlength 128, body maxlength 2000, the
//      4-option severity select, submit)
//   2. the empty fixture renders "No open issues", the
//      composer still renders beneath the empty state,
//      and the loader is gone
//   3. untrusted repo/title/body carrying <img onerror>
//      / <script> renders escaped (no raw markup in the
//      DOM) — derived + stored legs
//   4. a 500 on /issues renders a quiet unavailable line
//      with the connection banner STILL hidden
//      (fail-soft — a secondary panel must not trip the
//      banner); the composer does NOT render on the
//      fail-soft path
//   5. composer happy path: the REAL composer is driven
//      (type + submit), the optimistic .is-pending row
//      appends synchronously with the submit disabled,
//      exactly ONE POST /issues carries the pinned
//      4-key wire body {repo,title,body,severity}, and
//      the refetch reconciles to the new stored row
//      (meta +1, pending gone)
//   6. composer honest 403: the .is-failed row names
//      repo-not-allowed, the submit re-enables, the
//      draft is retained, and the connection banner
//      stays hidden
//   7. close 200: exactly ONE PATCH /issues/<id>?base=
//      demo carries {state:"closed"}; the refetch
//      renders the closed chip and NO close button
//   8. close 409: the button is restored naming
//      already-closed; the refetch reconciles to closed
//      (the row is closed server-side — that is the
//      409's cause)
//   9. close 404: the honest not-found token, the
//      button restored
//   10. derived-rows-no-affordances: with a derived-only
//      fixture, querySelectorAll("#issues-list .issue-
//      close") is empty by construction (the EoP leg —
//      a derived row can never PATCH a derived id)
//   11. zero uncaught page errors across every dump
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

// The v3.8 union fixture: the derived prefix (kind:
// "derived", the leg on `issue`) followed by the stored
// suffix (kind:"stored", the server-minted 12-hex id,
// the closedAt set on closed rows). One open stored row
// + one closed stored row exercise the close affordance
// gating (open => button, closed => chip, no button).
const FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    {
      kind: "derived",
      id: "conflict:agent-conflict:src/a.ts",
      issue: "conflict",
      repo: "agent-conflict",
      severity: "high",
      title: "Merge conflict in src/a.ts",
      detail: "src/a.ts",
      links: ["/merge?base=demo&repos=agent-conflict"],
    },
    {
      kind: "derived",
      id: "withheld-$$B0T2SBW4WUP2:L$$:config/.env",
      issue: "withheld-secret",
      repo: "agent-secret",
      severity: "medium",
      title: "Secret-class file withheld: config/.env",
      detail: "config/.env: 2 key(s) withheld",
      links: ["/merge?base=demo&repos=agent-secret"],
    },
    {
      kind: "derived",
      id: "stale-base:agent-stale",
      issue: "stale-base",
      repo: "agent-stale",
      severity: "low",
      title: "Fork agent-stale shares no history with demo",
      detail: 'no shared first-parent commit with base "demo" within the 200-commit walk',
      links: ["/forks?base=demo"],
    },
    {
      kind: "derived",
      id: "blocked-intent:agent-nonaligned",
      issue: "blocked-intent",
      repo: "agent-nonaligned",
      severity: "info",
      title: 'Matcher verdict "ignore" for agent-nonaligned',
      detail: "matcher verdict ignore over 1 candidate fork(s)",
      links: ["/intents"],
    },
    {
      kind: "stored",
      id: "a1b2c3d4e5f6",
      repo: "agent-1",
      title: "Login form posts to the wrong endpoint",
      body: "The login form POSTs to /api/v1/login instead of /api/v2/login on staging.",
      severity: "high",
      state: "open",
      assignee: null,
      at: "2026-10-14T10:00:00.000Z",
      closedAt: null,
    },
    {
      kind: "stored",
      id: "0f9e8d7c6b5a",
      repo: "agent-1",
      title: "Docs typo in the README quickstart",
      body: "The quickstart says `bun run dev` but the script is `bun run start`.",
      severity: "info",
      state: "closed",
      assignee: "nextgit-demo-viewer",
      at: "2026-10-14T09:00:00.000Z",
      closedAt: "2026-10-14T09:30:00.000Z",
    },
  ],
};

// The post-composer fixture: the freshly-posted stored
// row follows the derived prefix and the pre-existing
// stored rows (append order — the reconcile-on-refresh
// observable).
const POSTED_FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    ...FIXTURE.issues,
    {
      kind: "stored",
      id: "112233445566",
      repo: "demo",
      title: "The typed title",
      body: "The typed body",
      severity: "medium",
      state: "open",
      assignee: null,
      at: "2026-10-14T10:05:00.000Z",
      closedAt: null,
    },
  ],
};

// The closed fixture: the open stored row flipped to
// closed (the close-200 / close-409 reconcile
// observable — the refetch renders the chip, no button).
const CLOSED_FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    ...FIXTURE.issues.slice(0, 4),
    { ...FIXTURE.issues[4], state: "closed", closedAt: "2026-10-14T10:06:00.000Z" },
    FIXTURE.issues[5],
  ],
};

// The derived-only fixture (the affordance-gating leg):
// zero stored rows, so zero .issue-close elements by
// construction.
const DERIVED_ONLY_FIXTURE = { ok: true, base: "demo", issues: FIXTURE.issues.slice(0, 4) };

const EMPTY = { ok: true, base: "demo", issues: [] };

// Untrusted repo content (AD-4): the repo name and the
// title carry markup (derived leg); the stored body
// carries markup too (the v2 render leg).
const XSS_REPO = "<img src=x onerror=alert(1)>";
const XSS_TITLE = "<script>alert(2)</script>";
const XSS_FIXTURE = {
  ok: true,
  base: "demo",
  issues: [
    {
      kind: "derived",
      id: "conflict:<img>:x",
      issue: "conflict",
      repo: XSS_REPO,
      severity: "high",
      title: XSS_TITLE,
      detail: "src/a.ts",
      links: ["/merge?base=demo&repos=x"],
    },
    {
      kind: "stored",
      id: "xssstored001",
      repo: XSS_REPO,
      title: "Stored row with markup body",
      body: "<img src=x onerror=alert(3)>",
      severity: "low",
      state: "open",
      assignee: null,
      at: "2026-10-14T10:00:00.000Z",
      closedAt: null,
    },
  ],
};

const PROPOSALS = { ok: true, base: { repo: "fixture", ref: "main" }, ref: "main", summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 }, proposals: [], conflicts: [] };

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fails++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI issues panel — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

// Async spawn: the loopback server runs on THIS process's
// event loop, so a blocking exec would deadlock the very
// fetch the page is waiting on. Each scenario gets its
// own fresh browser profile: a shared user-data-dir lets
// Chrome's disk cache serve a previous scenario's
// document, which races the async loadIssues() and
// swaps two dumps.
const dumpDom = (url, scenarioDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", `--user-data-dir=${scenarioDir}`, "--dump-dom", url],
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

// --- Loopback worker surface: mode selects what /issues
// does; postMode/closeMode select what the mutating
// seams answer. The real HTTP requests are recorded.
// `closedStore` is the close-reconcile state: once a
// close PATCH lands (200) or is refused already-closed
// (409 — the row IS closed server-side, that is the
// 409's cause), the GET projection flips to the closed
// fixture so the module's refetch renders the chip. ---
let issuesMode = "ok"; // "ok" | "empty" | "xss" | "fail" | "derived-only" | "posted"
let postMode = "ok";   // "ok" | "403" | "400" | "429"
let closeMode = "ok";  // "ok" | "409" | "404"
let closedStore = false;
const postRequests = [];  // the real HTTP log for the composer POST
const closeRequests = []; // the real HTTP log for the close PATCH

// Observer/driver: injected BEFORE app.js. For the
// composer/close legs it drives the REAL composer (types
// into the inputs, submits the real form) and the REAL
// close button (clicks it), then triggers the manual
// refresh that reconciles the rows. Emits #test-out.
const clientScript = (cfg) => `const CFG = ${JSON.stringify(cfg)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
let errCount = 0;
let rejCount = 0;
window.addEventListener("error", () => { errCount++; });
window.addEventListener("unhandledrejection", () => { rejCount++; });
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    R.s.rowCount = qs("#issues-list .issue-row").length;
    R.s.kinds = qs("#issues-list .issue-kind-badge").map((e) => e.textContent.trim());
    R.s.repos = qs("#issues-list .issue-repo").map((e) => e.textContent.trim());
    R.s.meta = q("#issues-meta") ? q("#issues-meta").textContent.trim() : null;
    R.s.loaderGone = !qs("#issues-list .issues-loading").length;
    R.s.unavailable = qs("#issues-list .issues-unavailable").map((e) => e.textContent.trim());
    R.s.emptyTitle = qs("#issues-list .issues-empty-title").map((e) => e.textContent.trim());
    R.s.composerCount = qs("#issues-list .issue-composer").length;
    R.s.composerBase = qs("#issues-list .issue-composer").map((f) => f.getAttribute("data-issue-base"));
    R.s.titleMax = qs("#issues-list .issue-composer-title").map((i) => i.getAttribute("maxlength"));
    R.s.bodyMax = qs("#issues-list .issue-composer-body").map((i) => i.getAttribute("maxlength"));
    R.s.severityOptions = qs("#issues-list .issue-composer-severity option").map((o) => o.value);
    R.s.submitLabel = qs("#issues-list .issue-composer-submit").map((b) => b.textContent.trim());
    R.s.closeButtons = qs("#issues-list .issue-close").map((b) => ({ id: b.getAttribute("data-issue-id"), repo: b.getAttribute("data-issue-repo"), text: b.textContent.trim(), closing: b.getAttribute("data-closing"), disabled: b.disabled }));
    R.s.closeIds = qs("#issues-list .issue-close").map((b) => b.getAttribute("data-issue-id"));
    R.s.closedChips = qs("#issues-list .issue-state").map((e) => e.textContent.trim());
    R.s.bodies = qs("#issues-list .issue-body").map((e) => e.textContent.trim());
    R.s.rowIds = qs("#issues-list .issue-row").map((r) => r.id);

    if (CFG.mode === "composer" || CFG.mode === "composer403") {
      const form = q("#issues-list .issue-composer");
      const title = form ? form.querySelector(".issue-composer-title") : null;
      const body = form ? form.querySelector(".issue-composer-body") : null;
      const severity = form ? form.querySelector(".issue-composer-severity") : null;
      const submit = form ? form.querySelector(".issue-composer-submit") : null;
      if (title) title.value = CFG.title;
      if (body) body.value = CFG.body;
      if (severity) severity.value = CFG.severity;
      if (submit) submit.click();
      // The optimistic pending row appends and the
      // submit disables SYNCHRONOUSLY in the submit
      // handler (before the POST's await), so both are
      // observable immediately after the click — the
      // loopback POST + the module's own refetch then
      // reconcile them away within the tick budget.
      R.s.pendingRows = qs("#issues-list .issue-row.is-pending").length;
      R.s.pendingTitle = qs("#issues-list .issue-row.is-pending .issue-title").map((e) => e.textContent.trim());
      R.s.submitDisabledInFlight = submit ? submit.disabled : null;
      await sleep(1200);
      R.s.failedRows = qs("#issues-list .issue-row.is-failed").length;
      R.s.failedDetail = qs("#issues-list .issue-row.is-failed .issue-detail").map((e) => e.textContent.trim());
      R.s.submitDisabledAfter = submit ? submit.disabled : null;
      R.s.draftRetained = title ? title.value : null;
      // Reconcile on refresh: the manual-refresh control
      // re-runs loadIssues() (the refreshed feed carries
      // the newly-posted stored row).
      const refresh = q("#btn-manual-refresh");
      if (refresh) refresh.click();
      await sleep(1200);
      R.s.rowCountAfterRefresh = qs("#issues-list .issue-row").length;
      R.s.metaAfterRefresh = q("#issues-meta") ? q("#issues-meta").textContent.trim() : null;
      R.s.pendingAfterRefresh = qs("#issues-list .issue-row.is-pending").length;
      R.s.newRowTitle = qs("#issues-list .issue-row .issue-title").map((e) => e.textContent.trim());
      const banner = q("#connection-banner");
      R.s.bannerHidden = banner ? banner.hidden : null;
    }

    if (CFG.mode === "close" || CFG.mode === "close409" || CFG.mode === "close404") {
      const btn = q("#issues-list .issue-close[data-issue-id='a1b2c3d4e5f6']");
      if (btn) btn.click();
      await sleep(1200);
      R.s.closeTextAfter = btn ? btn.textContent.trim() : null;
      R.s.closeClosingAfter = btn ? btn.getAttribute("data-closing") : null;
      R.s.closeDisabledAfter = btn ? btn.disabled : null;
      R.s.closeCountAfter = qs("#issues-list .issue-close").length;
      R.s.closedChipsAfter = qs("#issues-list .issue-state").map((e) => e.textContent.trim());
      // Reconcile on refresh (the close leg's refetch is
      // inside the module; the manual refresh re-runs it).
      const refresh = q("#btn-manual-refresh");
      if (refresh) refresh.click();
      await sleep(1200);
      R.s.closeCountAfterRefresh = qs("#issues-list .issue-close").length;
      R.s.closedChipsAfterRefresh = qs("#issues-list .issue-state").map((e) => e.textContent.trim());
      R.s.chipRowTitles = qs("#issues-list .issue-row .issue-title").map((e) => e.textContent.trim());
      R.s.bannerHidden = q("#connection-banner") ? q("#connection-banner").hidden : null;
    }

    R.s.errCount = errCount;
    R.s.rejCount = rejCount;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");
  // GET /issues — mode selects the fixture (the v3.8
  // union: derived prefix + stored suffix). The
  // closedStore reconcile projection (the close legs'
  // refetch) takes precedence once a close landed.
  if (pathname === "/issues" && req.method === "GET") {
    if (issuesMode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    if (issuesMode === "xss") return json(res, XSS_FIXTURE);
    if (issuesMode === "empty") return json(res, EMPTY);
    if (issuesMode === "derived-only") return json(res, DERIVED_ONLY_FIXTURE);
    if (issuesMode === "posted") return json(res, POSTED_FIXTURE);
    if (closedStore) return json(res, CLOSED_FIXTURE);
    return json(res, FIXTURE);
  }
  // POST /issues — the composer's mutating seam. The
  // worker records the real request (route + wire body)
  // and answers per postMode.
  if (pathname === "/issues" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { payload = {}; }
      postRequests.push({ method: "POST", path: pathname, body: payload });
      if (postMode === "403") { json(res, { ok: false, error: "repo-not-allowed" }, 403); return; }
      if (postMode === "400") { json(res, { ok: false, error: "bad-request" }, 400); return; }
      if (postMode === "429") { json(res, { ok: false, error: "rate-limited" }, 429); return; }
      json(res, { ok: true, issue: { id: "112233445566", repo: payload.repo, title: payload.title, body: payload.body, severity: payload.severity, state: "open", assignee: null, at: "2026-10-14T10:05:00.000Z", closedAt: null } }, 201);
    });
    return;
  }
  // PATCH /issues/{id} — the close affordance's mutating
  // seam. The worker records the real request (the id
  // in the path, the base in the query, the wire body)
  // and answers per closeMode. A landed close (200) or
  // an already-closed refusal (409) both mean the row
  // is closed server-side, so the GET projection flips
  // (the refetch reconcile).
  const close = pathname.match(/^\/issues\/(.+)$/);
  if (close && req.method === "PATCH") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { payload = {}; }
      closeRequests.push({ method: "PATCH", id: decodeURIComponent(close[1]), base: searchParams.get("base"), body: payload });
      if (closeMode === "409") { closedStore = true; json(res, { ok: false, error: "already-closed" }, 409); return; }
      if (closeMode === "404") { json(res, { ok: false, error: "not-found" }, 404); return; }
      closedStore = true;
      json(res, { ok: true, issue: { id: decodeURIComponent(close[1]), repo: searchParams.get("base"), state: "closed", closedAt: "2026-10-14T10:06:00.000Z" } });
    });
    return;
  }
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, { ok: true, events: [] });
  if (pathname === "/judge") return json(res, { ok: true, judgments: [], skipped: [] });
  if (pathname === "/whoami") return json(res, { ok: true, authorized: false, reveal: false });
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(clientCfg));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (file.endsWith("index.html")) {
    const html = readFileSync(file, "utf8").replace(APP_TAG, ERR_COLLECTOR + `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

let clientCfg = {};
const parse = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// --- Contract legs ---
function legRows(dom) {
  const R = parse(dom);
  if (!R) return check("1: scenario output present", false, "no #test-out");
  if (R.err) return check("1: scenario threw", false, R.err);
  const c = R.s;
  const region = issuesRegion(dom);
  check("1 #issues-section renders", region !== null, "section missing");
  check("1 the first-load loader is gone", c.loaderGone === true, "loader still present");
  const rows = rowsOf(dom);
  check("1 one row per fixture issue (6: 4 derived + 2 stored)", rows.length === 6, `count=${rows.length}`);
  const kinds = rowKinds(dom);
  check("1 derived rows badge their leg + stored rows badge 'stored'",
    JSON.stringify(kinds) === JSON.stringify(["conflict", "withheld secret", "stale base", "blocked intent", "stored", "stored"]),
    JSON.stringify(kinds));
  const repos = rowRepos(dom);
  check("1 every row carries its repo", repos.length === 6 && repos[0] === "agent-conflict", JSON.stringify(repos));
  check("1 the section meta counts the issues", c.meta === "6 issues", String(c.meta));
  check("1 the composer renders under the rows", c.composerCount === 1, `composerCount=${c.composerCount}`);
  check("1 the composer pins the base", JSON.stringify(c.composerBase) === JSON.stringify(["demo"]), JSON.stringify(c.composerBase));
  check("1 the title input caps at 128", JSON.stringify(c.titleMax) === JSON.stringify(["128"]), JSON.stringify(c.titleMax));
  check("1 the body textarea caps at 2000", JSON.stringify(c.bodyMax) === JSON.stringify(["2000"]), JSON.stringify(c.bodyMax));
  check("1 the severity select carries the 4-value vocabulary",
    JSON.stringify(c.severityOptions) === JSON.stringify(["high", "medium", "low", "info"]),
    JSON.stringify(c.severityOptions));
  check("1 the submit button reads 'file issue'", JSON.stringify(c.submitLabel) === JSON.stringify(["file issue"]), JSON.stringify(c.submitLabel));
  check("1 exactly ONE close affordance (the open stored row)", c.closeIds.length === 1 && c.closeIds[0] === "a1b2c3d4e5f6", JSON.stringify(c.closeIds));
  check("1 the close affordance carries the base repo (the PATCH target)", JSON.stringify(c.closeButtons.map((b) => b.repo)) === JSON.stringify(["demo"]), JSON.stringify(c.closeButtons.map((b) => b.repo)));
  check("1 the closed stored row renders the closed chip", c.closedChips.some((t) => t.startsWith("closed")), JSON.stringify(c.closedChips));
  check("1 the stored row renders its escaped body", c.bodies.length === 2, `bodies=${c.bodies.length}`);
  check("1 the stored rows carry the server-minted ids in the row ids",
    c.rowIds.includes("issue-a1b2c3d4e5f6") && c.rowIds.includes("issue-0f9e8d7c6b5a"),
    JSON.stringify(c.rowIds));
}

function legEmpty(dom) {
  const R = parse(dom);
  if (!R) return check("2: scenario output present", false, "no #test-out");
  if (R.err) return check("2: scenario threw", false, R.err);
  const c = R.s;
  const region = issuesRegion(dom) || "";
  check("2 the empty state renders", (c.emptyTitle || []).some((t) => t === "No open issues for demo"), JSON.stringify(c.emptyTitle));
  check("2 the loader is gone", c.loaderGone === true, "loader still present");
  check("2 the meta counts zero issues", c.meta === "0 issues", String(c.meta));
  check("2 the composer renders beneath the empty state", c.composerCount === 1, `composerCount=${c.composerCount}`);
}

function legXss(dom) {
  const R = parse(dom);
  if (!R) return check("3: scenario output present", false, "no #test-out");
  if (R.err) return check("3: scenario threw", false, R.err);
  const region = issuesRegion(dom) || "";
  check("3 the untrusted repo name renders escaped", region.includes("&lt;img src=x onerror=alert(1)&gt;"), region.slice(0, 240));
  check("3 the untrusted title renders escaped", region.includes("&lt;script&gt;alert(2)&lt;/script&gt;"), region.slice(0, 240));
  check("3 the untrusted stored body renders escaped", region.includes("&lt;img src=x onerror=alert(3)&gt;"), region.slice(0, 240));
  check("3 no raw element injected from repo content", !region.includes("<img") && !region.includes("<script>"), region.slice(0, 240));
}

function legFail(dom) {
  const R = parse(dom);
  if (!R) return check("4: scenario output present", false, "no #test-out");
  if (R.err) return check("4: scenario threw", false, R.err);
  const c = R.s;
  const region = issuesRegion(dom) || "";
  check("4 the panel shows the quiet unavailable line", (c.unavailable || []).some((t) => t === "Issues unavailable."), JSON.stringify(c.unavailable));
  check("4 the loader is gone", c.loaderGone === true, "loader still present");
  check("4 a /issues failure does NOT trip the connection banner", !bannerVisible(dom));
  check("4 the metas stay em-dash on the unobserved panel", c.meta === "—", String(c.meta));
  check("4 the composer does NOT render on the fail-soft path", c.composerCount === 0, `composerCount=${c.composerCount}`);
}

function legComposer(dom) {
  const R = parse(dom);
  if (!R) return check("5: scenario output present", false, "no #test-out");
  if (R.err) return check("5: scenario threw", false, R.err);
  const c = R.s;
  check("5 exactly ONE POST /issues was issued", postRequests.length === 1, `count=${postRequests.length}`);
  check("5 the POST carries the pinned 4-key wire body",
    postRequests.length === 1 &&
    JSON.stringify(postRequests[0].body) === JSON.stringify({ repo: "demo", title: "The typed title", body: "The typed body", severity: "medium" }),
    JSON.stringify(postRequests.map((r) => r.body)));
  check("5 the optimistic pending row appears", c.pendingRows === 1 && (c.pendingTitle || []).some((t) => t === "The typed title"), `pendingRows=${c.pendingRows} title=${JSON.stringify(c.pendingTitle)}`);
  check("5 the submit is disabled in flight", c.submitDisabledInFlight === true, `submitDisabledInFlight=${c.submitDisabledInFlight}`);
  check("5 the refetch reconciles to the posted row (meta +1)", c.metaAfterRefresh === "7 issues", String(c.metaAfterRefresh));
  check("5 the pending row is gone after the refetch", c.pendingAfterRefresh === 0, `pendingAfterRefresh=${c.pendingAfterRefresh}`);
  check("5 the refreshed feed carries the new row's title", (c.newRowTitle || []).some((t) => t === "The typed title"), JSON.stringify(c.newRowTitle));
  check("5 the composer failure path never trips the connection banner", c.bannerHidden === true, "connection banner is visible");
}

function legComposer403(dom) {
  const R = parse(dom);
  if (!R) return check("6: scenario output present", false, "no #test-out");
  if (R.err) return check("6: scenario threw", false, R.err);
  const c = R.s;
  check("6 exactly ONE POST /issues was issued", postRequests.length === 1, `count=${postRequests.length}`);
  check("6 the honest failure row names repo-not-allowed",
    c.failedRows === 1 && (c.failedDetail || []).some((t) => t === "repo-not-allowed"),
    JSON.stringify(c.failedDetail));
  check("6 the submit is re-enabled after the failure", c.submitDisabledAfter === false, `submitDisabledAfter=${c.submitDisabledAfter}`);
  check("6 the draft is retained", c.draftRetained === "The typed title", String(c.draftRetained));
  check("6 the connection banner stays hidden (fail-soft)", c.bannerHidden === true, "connection banner is visible");
}

function legClose(dom) {
  const R = parse(dom);
  if (!R) return check("7: scenario output present", false, "no #test-out");
  if (R.err) return check("7: scenario threw", false, R.err);
  const c = R.s;
  check("7 exactly ONE PATCH was issued", closeRequests.length === 1, `count=${closeRequests.length}`);
  check("7 the PATCH targets /issues/<id> with the base query",
    closeRequests.length === 1 && closeRequests[0].id === "a1b2c3d4e5f6" && closeRequests[0].base === "demo",
    JSON.stringify(closeRequests.map((r) => ({ id: r.id, base: r.base }))));
  check("7 the PATCH carries the fixed literal {state:closed}",
    closeRequests.length === 1 && JSON.stringify(closeRequests[0].body) === JSON.stringify({ state: "closed" }),
    JSON.stringify(closeRequests.map((r) => r.body)));
  check("7 the button enters its closing state in flight", c.closeClosingAfter === "1", `closeClosingAfter=${c.closeClosingAfter}`);
  check("7 the refetch renders the closed chip", (c.closedChipsAfterRefresh || []).some((t) => t.startsWith("closed")), JSON.stringify(c.closedChipsAfterRefresh));
  check("7 the refetch leaves NO close button", c.closeCountAfterRefresh === 0, `closeCountAfterRefresh=${c.closeCountAfterRefresh}`);
  check("7 the close failure path never trips the connection banner", c.bannerHidden === true, "connection banner is visible");
}

function legClose409(dom) {
  const R = parse(dom);
  if (!R) return check("8: scenario output present", false, "no #test-out");
  if (R.err) return check("8: scenario threw", false, R.err);
  const c = R.s;
  check("8 exactly ONE PATCH was issued", closeRequests.length === 1, `count=${closeRequests.length}`);
  check("8 the button is restored naming already-closed",
    c.closeTextAfter === "close (already-closed)" && c.closeDisabledAfter === false,
    `text=${c.closeTextAfter} disabled=${c.closeDisabledAfter}`);
  check("8 the closing marker is removed", c.closeClosingAfter === null, `closeClosingAfter=${c.closeClosingAfter}`);
  check("8 the refetch reconciles to the closed chip", (c.closedChipsAfterRefresh || []).some((t) => t.startsWith("closed")), JSON.stringify(c.closedChipsAfterRefresh));
  check("8 the refetch leaves no close button on the reconciled row", c.closeCountAfterRefresh === 0, `closeCountAfterRefresh=${c.closeCountAfterRefresh}`);
}

function legClose404(dom) {
  const R = parse(dom);
  if (!R) return check("9: scenario output present", false, "no #test-out");
  if (R.err) return check("9: scenario threw", false, R.err);
  const c = R.s;
  check("9 exactly ONE PATCH was issued", closeRequests.length === 1, `count=${closeRequests.length}`);
  check("9 the button is restored naming not-found",
    c.closeTextAfter === "close (not-found)" && c.closeDisabledAfter === false,
    `text=${c.closeTextAfter} disabled=${c.closeDisabledAfter}`);
}

function legDerivedNoAffordances(dom) {
  const R = parse(dom);
  if (!R) return check("10: scenario output present", false, "no #test-out");
  if (R.err) return check("10: scenario threw", false, R.err);
  const c = R.s;
  const region = issuesRegion(dom) || "";
  check("10 derived-only fixture renders 4 rows", c.rowCount === 4, `rowCount=${c.rowCount}`);
  check("10 derived rows carry ZERO .issue-close elements (the EoP leg)", region.includes("issue-close") === false && c.closeButtons.length === 0, `closeButtons=${JSON.stringify(c.closeButtons)}`);
  check("10 derived rows carry no .issue-state chips", c.closedChips.length === 0, JSON.stringify(c.closedChips));
}

function legZeroErrors(dom) {
  check("11 zero uncaught page errors (data-page-errors=0)", pageErrors(dom) === 0, `data-page-errors=${pageErrors(dom)}`);
}

const scenarios = [
  { name: "1", issues: "ok", post: "ok", close: "ok", cfg: { mode: "render" }, leg: legRows },
  { name: "2", issues: "empty", post: "ok", close: "ok", cfg: { mode: "empty" }, leg: legEmpty },
  { name: "3", issues: "xss", post: "ok", close: "ok", cfg: { mode: "xss" }, leg: legXss },
  { name: "4", issues: "fail", post: "ok", close: "ok", cfg: { mode: "fail" }, leg: legFail },
  { name: "5", issues: "posted", post: "ok", close: "ok", cfg: { mode: "composer", title: "The typed title", body: "The typed body", severity: "medium" }, leg: legComposer },
  { name: "6", issues: "ok", post: "403", close: "ok", cfg: { mode: "composer403", title: "The typed title", body: "The typed body", severity: "medium" }, leg: legComposer403 },
  { name: "7", issues: "ok", post: "ok", close: "ok", cfg: { mode: "close" }, leg: legClose },
  { name: "8", issues: "ok", post: "ok", close: "409", cfg: { mode: "close409" }, leg: legClose409 },
  { name: "9", issues: "ok", post: "ok", close: "404", cfg: { mode: "close404" }, leg: legClose404 },
  { name: "10", issues: "derived-only", post: "ok", close: "ok", cfg: { mode: "derived" }, leg: legDerivedNoAffordances },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  for (const s of scenarios) {
    issuesMode = s.issues;
    postMode = s.post;
    closeMode = s.close;
    closedStore = false;
    postRequests.length = 0;
    closeRequests.length = 0;
    clientCfg = s.cfg;
    // A fresh browser profile per scenario (see dumpDom).
    const scenarioDir = mkdtempSync(join(tmpdir(), "nextgit-issues-scenario-"));
    try {
      const { dom, stderr } = await dumpDom(url, scenarioDir);
      s.leg(dom);
      legZeroErrors(dom);
      check(`${s.name}: no Chrome "Uncaught" on stderr`, !/Uncaught/.test(stderr), stderr.split("\n").filter((l) => /Uncaught/.test(l)).slice(0, 2).join(" | "));
    } catch (e) {
      check(`${s.name}: scenario threw`, false, String(e?.stack ?? e));
    } finally {
      rmSync(scenarioDir, { recursive: true, force: true });
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
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
