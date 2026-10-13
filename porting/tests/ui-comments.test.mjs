#!/usr/bin/env bun
// Contract suite: inline review comments (merge preview modal) — the L8 surface.
// Five legs, all read from the REAL rendered DOM / the REAL HTTP log:
//   C1  thread renders, GET is scoped to (repo,ref,path), payload is escaped
//   C2  POST round-trip + synchronous optimistic append + reconcile + tab scope
//   C3  POST failure surfaces honestly (the row stays, marked, typed text kept)
//   C4  secret-row refusal — no composer, no thread, no GET for the secret path
//   C5  GET failure is contained — error row renders, no uncaught error/rejection
// Run: bun porting/tests/ui-comments.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui is served VERBATIM over a loopback
// origin into real headless Chrome; the only scripted pieces are the HTTP surface
// (which fixture /merge + /comments serve per scenario) and an observer module
// injected BEFORE app.js that drives the real modal and reads the real DOM — no
// product mocks (no mock.module), no source grep. Each scenario resets the
// loopback worker's state and spawns one fresh browser. A box without a Chrome
// binary skips the suite (precedent: ui-contrast-register, ui-merge-modal-states).
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
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;
if (!CHROME) { console.log("SKIP  inline review comments — no Chrome binary on PATH"); process.exit(0); }

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-comments-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 20000) =>
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
// Fixture data
// ---------------------------------------------------------------------------

// The proposals fixture: one proposal card for agent-1 with a preview-merge
// control, top-level ref "main" (the comment ref derives from it).
const PROPOSALS = {
  ok: true, base: { repo: "fixture", ref: "main", head: "d0".repeat(20) }, ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1", head: "a0".repeat(20), landing: { status: "ready" }, stats: { files: 2, additions: 2, deletions: 0 },
      files: [
        { path: "src/store.ts", status: "modified", additions: 1, deletions: 0 },
        { path: "src/auth.ts", status: "modified", additions: 1, deletions: 0 },
      ],
    },
  ],
  conflicts: [],
};

// Two readable merge files → two .merge-file-tab buttons; tab 0 is the primary
// comment path (src/store.ts), tab 1 (src/auth.ts) is the path-scope witness.
const MERGE = {
  ok: true, merge: {
    base: "fixture", repos: ["agent-1"], status: "clean",
    files: [
      { path: "src/store.ts", action: "write", result: "merged", merged: "export const store = 42;\n" },
      { path: "src/auth.ts", action: "write", result: "merged", merged: "export const auth = true;\n" },
    ],
    conflicted: [],
  },
};

// The refusal fixture: tab 0 is a secret-class file (withheld), tab 1 readable.
const MERGE_WITHHELD = {
  ok: true, merge: {
    base: "fixture", repos: ["agent-1"], status: "clean",
    files: [
      { path: "config/.env", action: "write", result: "withheld-secret", note: "Secret-class file contents are withheld from merge previews." },
      { path: "src/store.ts", action: "write", result: "merged", merged: "export const store = 42;\n" },
    ],
    conflicted: [],
  },
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// Seeded server-side comments. c-1 carries the XSS pair: an <img onerror> body
// and a <script> author — both must render as literal text, never as elements.
const SEED_COMMENTS = [
  { id: "c-1", repo: "agent-1", ref: "main", path: "src/store.ts", line: 3, body: '<img src=x onerror="window.__xss=1">', author: '<script>window.__xss=2</script>', at: "2026-10-13T10:00:00.000Z" },
  { id: "c-2", repo: "agent-1", ref: "main", path: "src/store.ts", line: 5, body: "looks good to me", author: "reviewer", at: "2026-10-13T10:01:00.000Z" },
];

// ---------------------------------------------------------------------------
// Loopback worker state — reset per scenario by the runner.
// ---------------------------------------------------------------------------
let mergeMode = "comments";     // "comments" | "withheld"
let commentsMode = "ok";        // "ok" | "postfail" | "getfail"
let commentStore = [];
let commentRequests = [];       // the real HTTP log
let commentSeq = 3;             // next server id after c-1,c-2
let clientCfg = {};

// Observer/driver: injected BEFORE app.js. Drives the real preview-merge
// control, arms a MutationObserver for the optimistic append, and reads the
// real rendered DOM. Emits #test-out.
const clientScript = (cfg) => `const CFG = ${JSON.stringify(cfg)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
let errCount = 0;
let rejCount = 0;
window.addEventListener("error", () => { errCount++; });
window.addEventListener("unhandledrejection", () => { rejCount++; });
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const texts = (els) => els.map((e) => e.textContent.trim());
const modalText = (sel) => texts(qs("#modal-body " + sel));
const items = () => qs("#modal-body .comment-item");
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    const btn = qs(".btn-preview-merge").find((b) => b.getAttribute("data-repo") === "agent-1");
    if (!btn) { R.err = "no preview-merge button for repo: agent-1"; }
    else { btn.click(); await sleep(1000); }

    if (CFG.mode === "refusal") {
      // Withheld file is tab 0; visit tab 1 (a readable file -> a real GET)
      // then return to tab 0, so the refusal is proven across a re-render and
      // the log proves no /comments request ever targets the secret path.
      const t1 = q('.merge-file-tab[data-merge-tab="1"]');
      if (t1) { t1.click(); await sleep(800); }
      const t0 = q('.merge-file-tab[data-merge-tab="0"]');
      if (t0) { t0.click(); await sleep(800); }
    }

    R.s.modalOpen = !!q("#inspector-modal") && q("#inspector-modal").hidden === false;
    R.s.badgeText = q("#modal-badge") ? q("#modal-badge").textContent.trim() : null;
    R.s.title = q("#modal-title") ? q("#modal-title").textContent.trim() : null;
    R.s.threadCount = qs("#modal-body [data-comment-thread]").length;
    R.s.refusedCount = qs("#modal-body [data-comment-refused]").length;
    R.s.submitCount = qs("#modal-body [data-comment-submit]").length;
    R.s.withheldNotice = modalText(".empty-state-title");

    const t = q("#modal-body [data-comment-thread]");
    if (t) {
      R.s.repo = t.getAttribute("data-repo");
      R.s.ref = t.getAttribute("data-ref");
      R.s.path = t.getAttribute("data-path");
      // Wave-14 mediums: the thread region is a named group.
      R.s.threadRole = t.getAttribute("role");
      R.s.threadLabel = t.getAttribute("aria-label");
    }
    // The empty-state guidance (.empty-state-desc) for the
    // zero-comment success path — read for every mode.
    R.s.emptyDesc = modalText(".empty-state-desc");
    R.s.emptyStateCount = qs("#modal-body .empty-state").length;

    if (CFG.mode === "render" || CFG.mode === "postfail") {
      R.s.itemCount = items().length;
      R.s.itemIds = items().map((i) => i.getAttribute("data-comment-id"));
      R.s.bodyTexts = items().map((i) => { const b = i.querySelector(".comment-body"); return b ? b.textContent : ""; });
      R.s.metaTexts = items().map((i) => { const m = i.querySelector(".comment-meta"); return m ? m.textContent : ""; });
      R.s.xssEls = qs("#modal-body .comment-thread img, #modal-body .comment-thread script").length;
      R.s.xss = window.__xss === undefined ? null : window.__xss;
    }

    if (CFG.mode === "post" || CFG.mode === "postfail") {
      const list = q("[data-comment-list]");
      const seen = { pending: false };
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.matches && node.matches(".comment-item.is-pending[data-pending='1']")) seen.pending = true;
          }
        }
      });
      if (list) mo.observe(list, { childList: true });
      const lineEl = q("[data-comment-line]");
      const bodyEl = q("[data-comment-body]");
      if (lineEl) lineEl.value = String(CFG.line);
      if (bodyEl) bodyEl.value = CFG.body;
      const submit = q("[data-comment-submit]");
      if (submit) submit.click();
      await sleep(1600);
      mo.disconnect();
      R.s.pendingAdded = seen.pending;
      R.s.itemCount = items().length;
      R.s.itemIdBodies = items().map((i) => {
        const b = i.querySelector(".comment-body");
        return { id: i.getAttribute("data-comment-id"), body: b ? b.textContent : "" };
      });
      R.s.pendingRemaining = qs("#modal-body .comment-item.is-pending, #modal-body [data-pending]").length;
      R.s.failedCount = qs("#modal-body .comment-item.is-failed").length;
      R.s.failedBodies = qs("#modal-body .comment-item.is-failed").map((i) => { const b = i.querySelector(".comment-body"); return b ? b.textContent : ""; });
      R.s.failedMeta = qs("#modal-body .comment-item.is-failed").map((i) => { const m = i.querySelector(".comment-meta"); return m ? m.textContent : ""; });
      const st = q("#modal-body .comment-item.is-failed .comment-state");
      const row = q("#modal-body .comment-item.is-failed");
      R.s.stateColor = st ? getComputedStyle(st).color : null;
      R.s.rowOpacity = row ? getComputedStyle(row).opacity : null;
      const after = q("#modal-body [data-comment-submit]");
      R.s.submitDisabled = after ? after.disabled : null;
      R.s.unmarkedRows = items().filter((i) => !i.getAttribute("data-comment-id") && !i.classList.contains("is-failed")).length;
    }

    if (CFG.mode === "post") {
      const t1 = q('.merge-file-tab[data-merge-tab="1"]');
      if (t1) { t1.click(); await sleep(800); }
      R.s.tab1Items = items().length;
      const t0 = q('.merge-file-tab[data-merge-tab="0"]');
      if (t0) { t0.click(); await sleep(800); }
      R.s.backItems = items().length;
    }

    if (CFG.mode === "getfail") {
      R.s.errRows = qs("#modal-body .comment-thread-error").length;
      R.s.errText = modalText(".comment-thread-error");
    }

    // C1 extension (zero-comment region on tab 1): the
    // populated tab (tab 0) renders no empty-state; the
    // zero-comment tab (tab 1) renders the guidance.
    // Tab 0 is read BEFORE the switch. The HTTP log
    // is snapshotted at initial-hydration settle
    // (before any tab visit) so the C1 exactly-one-GET
    // contract pins the initial hydration GET for the
    // tab-0 tuple; the tab-1 visit's own GET is
    // tab-scoped and lands after the snapshot.
    R.s.tab0EmptyStateCount = qs("#modal-body .empty-state").length;
    // The browser observer cannot read the Node-side
    // HTTP log, so the initial-hydration GET count is
    // fetched from the loopback server before any tab
    // visit (the C1 exactly-one-GET contract pins the
    // initial hydration GET for the tab-0 tuple).
    R.s.initialGets = await (await fetch("/__gets")).json();
    const t1pre = q('.merge-file-tab[data-merge-tab="1"]');
    if (t1pre) {
      t1pre.click();
      await sleep(800);
      R.s.tab1EmptyDesc = modalText(".empty-state-desc");
      R.s.tab1EmptyState = qs("#modal-body .empty-state").length;
      const t0 = q('.merge-file-tab[data-merge-tab="0"]');
      if (t0) { t0.click(); await sleep(800); }
    }

    R.s.errCount = errCount;
    R.s.rejCount = rejCount;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/whoami") return json(res, { ok: true, authorized: false, reveal: false });
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/merge") { json(res, mergeMode === "withheld" ? MERGE_WITHHELD : MERGE); return; }
  if (pathname === "/comments") {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { payload = {}; }
        commentRequests.push({ method: "POST", ...payload });
        if (commentsMode === "postfail") { json(res, { ok: false, error: "comment-store-unavailable" }, 500); return; }
        commentStore.push({ id: `c-${commentSeq++}`, at: "2026-10-13T10:02:00.000Z", ...payload });
        json(res, { ok: true });
      });
      return;
    }
    const repo = u.searchParams.get("repo");
    const ref = u.searchParams.get("ref");
    const path = u.searchParams.get("path");
    commentRequests.push({ method: "GET", repo, ref, path });
    if (commentsMode === "getfail") { json(res, { ok: false, error: "comment-store-unavailable" }, 500); return; }
    json(res, { ok: true, comments: commentStore.filter((c) => c.repo === repo && c.ref === ref && c.path === path) });
    return;
  }
  if (pathname === "/__gets") {
    json(res, { ok: true, gets: commentRequests.filter((r) => r.method === "GET").length });
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(clientCfg));
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
function legRender(dom) {
  const R = parse(dom);
  if (!R) return check("C1: scenario output present", false, "no #test-out");
  if (R.err) return check("C1: scenario threw", false, R.err);
  const c = R.s;
  check("C1: modal open on the agent-1 merge preview", c.modalOpen === true);
  check("C1: exactly one comment thread", c.threadCount === 1, `count=${c.threadCount}`);
  check("C1: thread scoped to (agent-1, main, src/store.ts)", c.repo === "agent-1" && c.ref === "main" && c.path === "src/store.ts", JSON.stringify({ repo: c.repo, ref: c.ref, path: c.path }));
  check("C1: 2 rows carrying the server ids c-1/c-2", c.itemCount === 2 && (c.itemIds || []).join(",") === "c-1,c-2", JSON.stringify(c.itemIds));
  check("C1: <img onerror> body rendered as literal text", (c.bodyTexts || []).some((t) => t.includes('<img src=x onerror="window.__xss=1">')), JSON.stringify(c.bodyTexts));
  check("C1: <script> author rendered as literal text", (c.metaTexts || []).some((t) => t.includes('<script>window.__xss=2</script>')), JSON.stringify(c.metaTexts));
  check("C1: no injected img/script element inside the thread", c.xssEls === 0, `els=${c.xssEls}`);
  check("C1: no XSS side effect (window.__xss undefined)", c.xss === null, `xss=${JSON.stringify(c.xss)}`);
  const gets = commentRequests.filter((r) => r.method === "GET" && r.repo === "agent-1" && r.ref === "main" && r.path === "src/store.ts");
  // Exactly ONE initial hydration GET for the tuple (the
  // /__gets snapshot fires before any tab visit); the
  // tab-1 round-trip re-hydrates tab 0 with a second
  // GET — that re-hydration is the C2 leg's witness.
  check("C1: exactly one initial GET /comments for the tuple", gets.length >= 1 && c.initialGets?.gets === 1, `initial=${JSON.stringify(c.initialGets)} total=${gets.length}`);
  // Wave-14 mediums: the populated tab renders no
  // empty-state; the zero-comment tab renders the
  // guidance via the .empty-state idiom. The GET
  // count pins the INITIAL hydration GET (snapshotted
  // before any tab visit), not the later tab-scoped reads.
  check("C1: the populated tab renders no empty-state", c.tab0EmptyStateCount === 0, `count=${c.tab0EmptyStateCount}`);
  check("C1: the zero-comment tab renders the empty-state guidance",
    (c.tab1EmptyDesc || []).some((t) => t.includes("no comments yet — start the review")),
    JSON.stringify(c.tab1EmptyDesc));
  check("C1: the guidance uses the .empty-state idiom", c.tab1EmptyState === 1, `count=${c.tab1EmptyState}`);
}

function legPost(dom) {
  const R = parse(dom);
  if (!R) return check("C2: scenario output present", false, "no #test-out");
  if (R.err) return check("C2: scenario threw", false, R.err);
  const c = R.s;
  check("C2: the optimistic pending row is appended synchronously", c.pendingAdded === true);
  check("C2: 3 rows after reconcile (2 seeded + 1 posted)", c.itemCount === 3, `count=${c.itemCount}`);
  check("C2: no pending row remains after reconcile", c.pendingRemaining === 0, `pending=${c.pendingRemaining}`);
  check("C2: the new row carries the server id c-3 and the typed text", (c.itemIdBodies || []).some((r) => r.id === "c-3" && r.body === "Tighten the boundary check"), JSON.stringify(c.itemIdBodies));
  check("C2: the composer is re-enabled after the in-flight window", c.submitDisabled === false, `disabled=${c.submitDisabled}`);
  check("C2: tab 1 (src/auth.ts) scopes the thread to 0 comments", c.tab1Items === 0, `tab1=${c.tab1Items}`);
  check("C2: returning to tab 0 re-hydrates 3 comments", c.backItems === 3, `back=${c.backItems}`);
  const posts = commentRequests.filter((r) => r.method === "POST");
  check("C2: exactly one POST /comments", posts.length === 1, `posts=${posts.length}`);
  const p = posts[0] || {};
  check("C2: the POST body is the pinned payload",
    p.repo === "agent-1" && p.ref === "main" && p.path === "src/store.ts" && p.line === 7 && p.body === "Tighten the boundary check" && p.author === "reviewer",
    JSON.stringify(p));
}

function legPostFail(dom) {
  const R = parse(dom);
  if (!R) return check("C3: scenario output present", false, "no #test-out");
  if (R.err) return check("C3: scenario threw", false, R.err);
  const c = R.s;
  check("C3: the optimistic pending row was appended", c.pendingAdded === true);
  check("C3: exactly one failed row remains", c.failedCount === 1, `failed=${c.failedCount}`);
  check("C3: the failed row keeps the typed text", (c.failedBodies || []).some((t) => t.includes("please fix this")), JSON.stringify(c.failedBodies));
  check("C3: the failed row's state text names the server error", (c.failedMeta || []).some((t) => t.includes("failed — comment-store-unavailable")), JSON.stringify(c.failedMeta));
  check("C3: the composer is re-enabled after failure", c.submitDisabled === false, `disabled=${c.submitDisabled}`);
  check("C3: no unmarked new row (every row is persisted or failed)", c.unmarkedRows === 0, `unmarked=${c.unmarkedRows}`);
  const posts = commentRequests.filter((r) => r.method === "POST");
  check("C3: exactly one POST attempt logged", posts.length === 1, `posts=${posts.length}`);
  const lum = (s) => { const [r, g, b] = s.match(/\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  check("C3: the failed state text is not the muted register (AA)",
    c.stateColor != null && c.stateColor !== "rgb(87, 101, 122)" && (lum(c.stateColor) + 0.05) / (lum("rgb(7, 10, 14)") + 0.05) >= 4.5,
    `color=${c.stateColor}`);
  check("C3: the failed row is not opacity-muted", c.rowOpacity === "1", `opacity=${c.rowOpacity}`);
}

function legEmpty(dom) {
  const R = parse(dom);
  if (!R) return check("C6: scenario output present", false, "no #test-out");
  if (R.err) return check("C6: scenario threw", false, R.err);
  const c = R.s;
  check("C6: the zero-comment thread renders the guidance",
    (c.emptyDesc || []).some((t) => t.includes("no comments yet — start the review")),
    JSON.stringify(c.emptyDesc));
  check("C6: the thread region carries role=group and an accessible name",
    c.threadRole === "group" && c.threadLabel === "review comments",
    JSON.stringify({ role: c.threadRole, label: c.threadLabel }));
  check("C6: the guidance uses the .empty-state idiom", c.emptyStateCount === 1, `count=${c.emptyStateCount}`);
}

function legRefusal(dom) {
  const R = parse(dom);
  if (!R) return check("C4: scenario output present", false, "no #test-out");
  if (R.err) return check("C4: scenario threw", false, R.err);
  const c = R.s;
  check("C4: exactly one refusal notice on the secret row", c.refusedCount === 1, `count=${c.refusedCount}`);
  check("C4: no submit control on the secret row", c.submitCount === 0, `submit=${c.submitCount}`);
  check("C4: no comment thread on the secret row", c.threadCount === 0, `thread=${c.threadCount}`);
  check("C4: the withheld notice still renders (shared branch intact)", (c.withheldNotice || []).some((t) => t.includes("Secret content withheld")), JSON.stringify(c.withheldNotice));
  const secretGets = commentRequests.filter((r) => r.method === "GET" && r.path === "config/.env");
  check("C4: zero /comments GETs for the secret path", secretGets.length === 0, `gets=${secretGets.length}`);
}

function legGetFail(dom) {
  const R = parse(dom);
  if (!R) return check("C5: scenario output present", false, "no #test-out");
  if (R.err) return check("C5: scenario threw", false, R.err);
  const c = R.s;
  check("C5: the thread error row renders", c.errRows === 1, `rows=${c.errRows}`);
  check("C5: the error row names the server error", (c.errText || []).some((t) => t.includes("comment-store-unavailable")), JSON.stringify(c.errText));
  check("C5: no uncaught page error", c.errCount === 0, `errCount=${c.errCount}`);
  check("C5: no unhandled rejection", c.rejCount === 0, `rejCount=${c.rejCount}`);
  check("C5: the modal is not replaced by the error branch", c.modalOpen === true && c.badgeText === "clean" && c.title === "Merge preview: agent-1", JSON.stringify({ open: c.modalOpen, badge: c.badgeText, title: c.title }));
}

const scenarios = [
  { name: "C1", merge: "comments", comments: "ok", cfg: { mode: "render" }, leg: legRender },
  { name: "C2", merge: "comments", comments: "ok", cfg: { mode: "post", line: 7, body: "Tighten the boundary check" }, leg: legPost },
  { name: "C3", merge: "comments", comments: "postfail", cfg: { mode: "postfail", line: 4, body: "please fix this" }, leg: legPostFail },
  { name: "C4", merge: "withheld", comments: "ok", cfg: { mode: "refusal" }, leg: legRefusal },
  { name: "C5", merge: "comments", comments: "getfail", cfg: { mode: "getfail" }, leg: legGetFail },
  { name: "C6", merge: "comments", comments: "ok", cfg: { mode: "empty" }, leg: legEmpty },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  for (const s of scenarios) {
    mergeMode = s.merge;
    commentsMode = s.comments;
    // C6 seeds an empty comment store (the zero-comment
    // success path); every other scenario seeds the two
    // fixture rows.
    commentStore = s.name === "C6" ? [] : SEED_COMMENTS.map((c) => ({ ...c }));
    commentRequests = [];
    commentSeq = 3;
    clientCfg = s.cfg;
    try {
      const dom = await dumpDom(url);
      s.leg(dom);
    } catch (e) {
      check(`${s.name}: scenario threw`, false, String(e?.stack ?? e));
    }
  }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2000);
    server.close(() => { clearTimeout(t); resolve(); });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
