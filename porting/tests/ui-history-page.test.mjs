#!/usr/bin/env bun
// Contract suite: commit history page (nextgit-e15-impl-history-page).
// Run: bun porting/tests/ui-history-page.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (history.html +
// js/history-page.js + styles.css) is served VERBATIM from a Node
// loopback origin into real headless Chrome — including
// /js/history-page.js served from disk under its real path (the
// wave-9 module-graph lesson: a module loaded from any other
// path is a different module and the suite would prove nothing).
// The only scripted pieces are the API fixtures (/proposals,
// /commits, /changes) and an error observer injected BEFORE
// js/history-page.js (the PAGE_TAG replace idiom) — no module
// mocks, no source grep, no mock.module. The shipped module runs
// for real.
//
// Unlike the files page, a commit row is a REAL anchor: clicking
// it navigates (?repo=…&ref=<sha>) and the panel loads from the
// URL at boot — so the driver navigates and reads the emitted
// DOM, and the deep-link leg is a fresh load with zero clicks.
//
// Fixture shapes (pinned: GET /commits = the L1 sibling's §GET
// /commits; GET /changes = CONTRACT.md §GET /changes):
//   /proposals?base=demo -> 2 repos (agent-1 head b…40)
//   /commits?repo=agent-1 -> sha3 -> sha2 -> sha1(root) chain, newest-first
//   /changes?repo=agent-1&base=agent-1&baseRef=<sha2>&ref=<sha3> -> src/main.ts (modified +4/-1),
//                         config/.env (secret + keys, leak canaries injected),
//                         assets/sprite.png.asset.json (asset pointer)
//   /changes (non-allowlisted base) -> 403 repo-not-allowed;
//                         (allowlisted base, no match) -> ok:false not-found
//
// Nine observable legs (each fails loudly on a plausible regression):
//   1. picker has >= 2 options incl. agent-1 (from /proposals)
//   2. commit list renders 3 rows: shortSha + message + author + at,
//      newest-first, each a real ?repo&ref=<sha> anchor
//   3. click a commit row -> navigation -> #commit-detail un-hidden +
//      the src/main.ts row (+4/-1); the /changes request carried
//      base=<repo> & baseRef=<parents[0]> & ref=<sha>
//   4. secret leg: key names present, the value + patch canaries
//      absent from the DOM (masking acceptance — the fixture server
//      deliberately sends both)
//   5. asset-pointer leg: the pointer chip (path + image/png + 2048 +
//      sha256 prefix); blobId is NOT an href (opaque key law)
//   6. root-commit leg: the root note renders and NO /changes request
//      is issued for it (request counter)
//   7. back-link a[href="/"] + files cross-link a[href="files.html"]
//   8. deep-link leg: a fresh load of ?repo&ref=<sha3> renders BOTH the
//      list and the changed-files panel (reload survival)
//   9. zero uncaught page errors (observer + Chrome stderr scan)
//
// A box without a Chrome binary skips the suite (precedent:
// ui-files-page / ui-tour-steps); full-suite-safe: no network
// beyond loopback, no live worker, no Artifacts.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const PAGE_TAG = `<script type="module" src="js/history-page.js"></script>`;

// Fixture canaries — values a buggy server would leak. The masking
// law requires neither to reach the DOM.
const SECRET_VALUE = "sk-live-fixture-supersecret-value-42";
const PATCH_CANARY = "PATCH_CANARY_LEAK_9f3d2b7a";

// Deterministic sha chain: sha3 -> sha2 -> sha1 (the root).
const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const SHA3 = "3".repeat(40);
const HEAD = "b".repeat(40);
const AUTHOR = "fixture <fixture@test>";
const AT1 = "2026-10-11T00:00:00.000Z";
const AT2 = "2026-10-12T00:00:00.000Z";
const AT3 = "2026-10-13T00:00:00.000Z";
const BLOB_ID = "0x" + "a".repeat(62);
const SHA256 = "d".repeat(64);

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
  console.log("SKIP  UI history page — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-historypage-"));

let chrome = null;
let browser = null;
let chromeStderr = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Async spawn: the loopback server runs on THIS process's event
// loop, so a blocking exec would deadlock the very fetch the page
// is waiting on. CDP mode (remote debugging + websocket).
const launchChrome = () =>
  new Promise((resolve, reject) => {
    chrome = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1100,900",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const timer = setTimeout(() => reject(new Error("Chrome did not announce a DevTools endpoint within 30s")), 30000);
    chrome.stderr.on("data", (d) => {
      chromeStderr += d;
      const m = chromeStderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });

// Minimal CDP client: one browser websocket, flat sessions,
// command/response plus event forwarding.
const connectCdp = (wsUrl, onEvent) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;

    const send = (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`${method}: CDP command timed out`));
        }, 30000);
        pending.set(id, { res, rej, timer, method });
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
      });

    ws.addEventListener("open", () => resolve({ send, close: () => ws.close() }));
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed to connect")));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (typeof msg.id === "number") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
        else p.res(msg.result);
        return;
      }
      if (typeof msg.method === "string" && onEvent) onEvent(msg.method, msg.params, msg.sessionId);
    });
  });

// ---------------------------------------------------------------------------
// Observer: injected BEFORE js/history-page.js. Accumulates uncaught
// errors into sessionStorage so they survive the commit-row navigation
// (the zero-page-errors contract).
// ---------------------------------------------------------------------------
const clientScript = `(function () {
  var KEY = "__nextgit_hist_errs";
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(a) { try { sessionStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  window.addEventListener("error", function (e) {
    var a = load();
    a.push(String((e && e.message) || (e && e.type) || "error"));
    save(a);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var a = load();
    a.push("unhandledrejection: " + String((e && e.reason && e.reason.message) || (e && e.reason) || "unknown"));
    save(a);
  });
})();`;

// ---------------------------------------------------------------------------
// Loopback worker surface: serves the shipped history page and
// /js/history-page.js VERBATIM from disk (module-graph survival),
// plus scripted API fixtures. No fixture is served from any path
// other than its real one.
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PROPOSALS = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "a".repeat(40) },
  proposals: [
    { repo: "agent-1", head: HEAD },
    { repo: "agent-2", head: "c".repeat(40) },
  ],
};

const COMMITS = [
  { sha: SHA3, shortSha: SHA3.slice(0, 7), message: "commit 3 fixture", author: AUTHOR, at: AT3, parents: [SHA2] },
  { sha: SHA2, shortSha: SHA2.slice(0, 7), message: "commit 2 fixture", author: AUTHOR, at: AT2, parents: [SHA1] },
  { sha: SHA1, shortSha: SHA1.slice(0, 7), message: "commit 1 fixture", author: AUTHOR, at: AT1, parents: [] },
];

const CHANGES = {
  ok: true,
  changeSet: {
    base: { repo: "agent-1", ref: SHA2, treeHash: "a".repeat(40), sha: SHA2 },
    head: { repo: "agent-1", ref: SHA3, treeHash: "b".repeat(40) },
    stats: { files: 3, added: 1, modified: 2, removed: 0, additions: 4, deletions: 1 },
    commits: [{ hash: SHA3, message: "commit 3 fixture", author: AUTHOR, timestamp: 1760313600 }],
    files: [
      { path: "src/main.ts", status: "modified", additions: 4, deletions: 1 },
      // A buggy server leaking the value AND a patch on the secret row — the
      // masking acceptance is that neither reaches the DOM (key names only).
      {
        path: "config/.env",
        status: "modified",
        secret: true,
        keys: ["STRIPE_SECRET_KEY", "DATABASE_URL"],
        text: SECRET_VALUE,
        patch: PATCH_CANARY,
      },
      {
        path: "assets/sprite.png.asset.json",
        status: "added",
        asset: { v: 1, blobId: BLOB_ID, sha256: SHA256, size: 2048, contentType: "image/png" },
      },
    ],
  },
};

// Every /changes request the page issues (the root-commit leg asserts the
// page never asks for one, and the click leg pins base=<repo>&baseRef=<parents[0]>&ref=<sha>).
const changesLog = [];

const j = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");

  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }

  // --- API fixtures -------------------------------------------------------
  if (pathname === "/proposals") { j(res, PROPOSALS); return; }

  if (pathname === "/commits") {
    const repo = searchParams.get("repo");
    if (repo === "agent-1") {
      j(res, { ok: true, repo, ref: searchParams.get("ref") || "main", commits: COMMITS });
      return;
    }
    j(res, { ok: false, error: "not-found" });
    return;
  }

  if (pathname === "/changes") {
    const repo = searchParams.get("repo");
    const base = searchParams.get("base");
    const ref = searchParams.get("ref");
    const baseRef = searchParams.get("baseRef");
    changesLog.push({ repo, base, ref, baseRef });
    // Mirror the deployed authorize() chokepoint (platform/src/auth.ts
    // DEMO_REPO_RE): on /changes `base` is REPO-scoped, so a non-allowlisted
    // value — e.g. a 40-hex sha in the base slot — is a 403 BEFORE the handler.
    if (!/^(demo|agent)(-[A-Za-z0-9._-]+)?$/.test(String(base))) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "repo-not-allowed", detail: `repo "${base}" is outside the demo allowlist` }));
      return;
    }
    if (repo === "agent-1" && base === "agent-1" && ref === SHA3 && baseRef === SHA2) {
      j(res, CHANGES);
      return;
    }
    // An allowlisted base that does not match (any other repo) is the
    // server's uniform not-found (the root-commit leg proves the page never
    // issues this request).
    j(res, { ok: false, error: "not-found" });
    return;
  }

  // --- Shipped UI, verbatim from disk ------------------------------------
  const rel = pathname === "/" ? "history.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  if (rel === "history.html") {
    // Inject the observer BEFORE the shipped module — the page's own
    // script tag stays last, exactly as shipped.
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      readFileSync(file, "utf8").replace(
        PAGE_TAG,
        `<script type="module" src="/__client.js"></script>` + PAGE_TAG,
      ),
    );
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs
// ---------------------------------------------------------------------------
function legPicker(options) {
  check("1 picker has >= 2 options from /proposals", options.length >= 2, `options=${JSON.stringify(options)}`);
  check("1 picker includes agent-1", options.includes("agent-1"), `options=${JSON.stringify(options)}`);
}

function legList(rows) {
  check("2 commit list renders 3 rows", rows.length === 3, `rows=${rows.length}`);
  check(
    "2 newest-first order preserved",
    rows.map((r) => r.sha).join(",") === [SHA3, SHA2, SHA1].join(","),
    `order=${JSON.stringify(rows.map((r) => r.sha))}`,
  );
  const expect = [
    { sha: SHA3, at: AT3, msg: "commit 3 fixture" },
    { sha: SHA2, at: AT2, msg: "commit 2 fixture" },
    { sha: SHA1, at: AT1, msg: "commit 1 fixture" },
  ];
  for (let i = 0; i < expect.length; i++) {
    const row = rows[i] || { text: "", href: "" };
    const want = expect[i];
    check(`2 row ${i} shows shortSha`, row.text.includes(want.sha.slice(0, 7)), `text=${JSON.stringify(row.text)}`);
    check(`2 row ${i} shows the message`, row.text.includes(want.msg), `text=${JSON.stringify(row.text)}`);
    check(`2 row ${i} shows the author`, row.text.includes(AUTHOR), `text=${JSON.stringify(row.text)}`);
    check(`2 row ${i} shows the ISO at`, row.text.includes(want.at), `text=${JSON.stringify(row.text)}`);
    check(
      `2 row ${i} is a real ?repo&ref=<sha> anchor`,
      row.href === `?repo=agent-1&ref=${want.sha}`,
      `href=${JSON.stringify(row.href)}`,
    );
  }
}

function legDetail(search, meta, rows, crumb, bannerHidden, log) {
  check(
    "3 click navigated to the deep-link URL (?repo=agent-1&ref=<sha3>)",
    String(search).includes("repo=agent-1") && String(search).includes(`ref=${SHA3}`),
    `search=${JSON.stringify(search)}`,
  );
  check("3 panel is un-hidden with a heading", String(meta).includes(SHA3.slice(0, 7)), `meta=${JSON.stringify(meta)}`);
  const row = rows.find((r) => r.text.includes("src/main.ts")) || { cls: "", text: "" };
  check("3 changed-files row lists src/main.ts", row.text.includes("src/main.ts"), `rows=${JSON.stringify(rows)}`);
  check("3 changed-files row shows the status word", row.text.includes("modified"), `row=${JSON.stringify(row.text)}`);
  check("3 changed-files row shows +4/-1", row.text.includes("+4") && row.text.includes("-1"), `row=${JSON.stringify(row.text)}`);
  check(
    "3 breadcrumb shows repo / ref / shortSha",
    String(crumb).includes("agent-1") && String(crumb).includes(SHA3.slice(0, 7)),
    `crumb=${JSON.stringify(crumb)}`,
  );
  check("3 no error banner surfaced", bannerHidden === true, `hidden=${JSON.stringify(bannerHidden)}`);
  const hit = log.find((e) => e.ref === SHA3);
  check("3 /changes carried a repo-valid base (not a sha) & ref=<sha>", !!hit && hit.base === "agent-1", `log=${JSON.stringify(log)}`);
  check(
    "3 /changes carried repo + baseRef=<parents[0]>",
    !!hit && hit.repo === "agent-1" && hit.baseRef === SHA2,
    `hit=${JSON.stringify(hit)}`,
  );
}

function legSecret(rows, dom) {
  const row = rows.find((r) => r.cls.includes("commit-secret")) || { cls: "", text: "" };
  check("4 secret row carries the word 'secret'", row.text.includes("secret"), `row=${JSON.stringify(row.text)}`);
  check("4 secret row lists STRIPE_SECRET_KEY", row.text.includes("STRIPE_SECRET_KEY"), `row=${JSON.stringify(row.text)}`);
  check("4 secret row lists DATABASE_URL", row.text.includes("DATABASE_URL"), `row=${JSON.stringify(row.text)}`);
  check("4 secret VALUE canary never reaches the DOM (masking law)", !dom.includes(SECRET_VALUE), "fixture secret value found in DOM");
  check("4 patch canary never reaches the DOM (masking law)", !dom.includes(PATCH_CANARY), "fixture patch canary found in DOM");
}

function legAsset(rows, html, blobHrefCount) {
  const row = rows.find((r) => r.cls.includes("commit-asset")) || { cls: "", text: "" };
  check("5 asset row renders the pointer chip (path)", row.text.includes("assets/sprite.png.asset.json"), `row=${JSON.stringify(row.text)}`);
  check("5 asset row shows contentType image/png", row.text.includes("image/png"), `row=${JSON.stringify(row.text)}`);
  check("5 asset row shows size 2048", row.text.includes("2048"), `row=${JSON.stringify(row.text)}`);
  check("5 asset row shows the pointer note", row.text.includes("asset pointer"), `row=${JSON.stringify(row.text)}`);
  check("5 asset row shows the sha256 prefix", row.text.includes(SHA256.slice(0, 12)), `row=${JSON.stringify(row.text)}`);
  check("5 blobId is NOT rendered as an href (opaque key law)", blobHrefCount === 0, `blobHrefs=${blobHrefCount}`);
  check("5 asset pointers are chips, not links", !/<a[\s>]/.test(html), `html~=${html.slice(0, 160)}`);
}

function legRoot(note, before, after) {
  check(
    "6 root commit renders the root-commit note",
    note.includes("root commit") && note.includes("no parent"),
    `note=${JSON.stringify(note)}`,
  );
  check("6 no /changes request issued for the root commit", after === before, `root /changes: before=${before} after=${after}`);
}

function legLinks(back, files) {
  check("7 back-link a[href=\"/\"] present", back === true, `back=${JSON.stringify(back)}`);
  check("7 files cross-link a[href=\"files.html\"] present", files === true, `files=${JSON.stringify(files)}`);
}

function legDeepLink(count, text, meta) {
  check("8 deep link re-renders the commit list", count === 3, `rows=${count}`);
  check("8 deep link re-renders the changed-files panel", text.includes("src/main.ts"), `text=${JSON.stringify(text.slice(0, 120))}`);
  check("8 deep link panel heading names the shortSha", String(meta).includes(SHA3.slice(0, 7)), `meta=${JSON.stringify(meta)}`);
}

function legNoErrors(errors, observerPresent) {
  check("9 observer injected before the module (PAGE_TAG idiom)", observerPresent === true, `present=${JSON.stringify(observerPresent)}`);
  check("9 zero uncaught page errors (observer)", Array.isArray(errors) && errors.length === 0, `errors=${JSON.stringify(errors)}`);
  const stderrBad = /(?:Uncaught|ReferenceError|SyntaxError|TypeError)\b/i.test(chromeStderr ?? "");
  check("9 zero uncaught errors in Chrome stderr", !stderrBad, `stderr~=${(chromeStderr ?? "").slice(0, 160)}`);
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  const wsUrl = await launchChrome();
  browser = await connectCdp(wsUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => browser.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  const evl = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text || "Runtime.evaluate threw");
    return result.value;
  };

  const waitFor = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    for (; ;) {
      let ok = false;
      try {
        ok = await evl(`Boolean(${expression})`);
      } catch {
        ok = false; // execution context destroyed mid-navigation — keep polling
      }
      if (ok) return;
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
      await sleep(100);
    }
  };

  // ---- List-only view ----------------------------------------------------
  await send("Page.navigate", { url: `${baseUrl}/history.html` });
  await waitFor(`document.querySelectorAll("#commit-list li").length === 3`);
  await sleep(150);

  const pickerOptions = await evl(`[...document.querySelectorAll("#repo-picker option")].map((o) => o.value)`);
  const listRows = await evl(
    `[...document.querySelectorAll("#commit-list li")].map((li) => { const a = li.querySelector("a"); return { sha: a ? a.getAttribute("data-sha") : "", href: a ? a.getAttribute("href") : "", text: li.textContent }; })`,
  );
  const backLink = await evl(`!!document.querySelector('a[href="/"]')`);
  const filesLink = await evl(`!!document.querySelector('a[href="files.html"]')`);

  // ---- Leg 3: click the sha3 row (a real anchor -> navigation) -----------
  const clicked = await evl(
    `(() => { const a = document.querySelector('#commit-list a[data-sha="${SHA3}"]'); if (!a) return false; a.click(); return true; })()`,
  );
  check("3 commit row is a real anchor (clicked)", clicked === true);
  await waitFor(
    `(() => { const d = document.getElementById("commit-detail"); return !!d && !d.hidden && document.getElementById("commit-files").textContent.includes("src/main.ts"); })()`,
  );
  await sleep(200);

  const afterClickSearch = await evl(`location.search`);
  const panelMeta = await evl(`document.getElementById("commit-detail-meta").textContent`);
  const panelRows = await evl(
    `[...document.querySelectorAll("#commit-files li")].map((li) => ({ cls: li.className, text: li.textContent }))`,
  );
  const panelHtml = await evl(`document.getElementById("commit-files").outerHTML`);
  const domHtml = await evl(`document.documentElement.outerHTML`);
  const crumbText = await evl(`document.getElementById("history-breadcrumb").textContent`);
  const bannerHidden = await evl(`document.getElementById("history-banner").hidden`);
  const blobHrefCount = await evl(
    `[...document.querySelectorAll("#commit-files a")].filter((a) => String(a.getAttribute("href") || "").includes("${BLOB_ID}")).length`,
  );

  // ---- Leg 6: root commit (fresh load; must NOT issue /changes) ----------
  const rootBefore = changesLog.filter((e) => e.ref === SHA1).length;
  await send("Page.navigate", { url: `${baseUrl}/history.html?repo=agent-1&ref=${SHA1}` });
  await waitFor(
    `(() => { const d = document.getElementById("commit-detail"); return !!d && !d.hidden && document.getElementById("commit-files").textContent.includes("root commit"); })()`,
  );
  await sleep(200);
  const rootNote = await evl(`document.getElementById("commit-files").textContent`);
  const rootAfter = changesLog.filter((e) => e.ref === SHA1).length;

  // ---- Leg 8: deep link, fresh load, no clicks ---------------------------
  await send("Page.navigate", { url: `${baseUrl}/history.html?repo=agent-1&ref=${SHA3}` });
  await waitFor(
    `(() => { const d = document.getElementById("commit-detail"); return !!d && !d.hidden && document.getElementById("commit-files").textContent.includes("src/main.ts"); })()`,
  );
  await sleep(200);
  const deepListCount = await evl(`document.querySelectorAll("#commit-list li").length`);
  const deepPanelText = await evl(`document.getElementById("commit-files").textContent`);
  const deepPanelMeta = await evl(`document.getElementById("commit-detail-meta").textContent`);

  // ---- Leg 9: uncaught errors (the observer must have been wired) --------
  // The PAGE_TAG injection is proven live so this leg can never pass by
  // accident (a missing observer would otherwise read as "zero errors").
  const observerPresent = await evl(`!!document.querySelector('script[src="/__client.js"]')`);
  const pageErrors = await evl(`JSON.parse(sessionStorage.getItem("__nextgit_hist_errs") || "[]")`);

  legPicker(pickerOptions);
  legList(listRows);
  legDetail(afterClickSearch, panelMeta, panelRows, crumbText, bannerHidden, changesLog);
  legSecret(panelRows, domHtml);
  legAsset(panelRows, panelHtml, blobHrefCount);
  legRoot(rootNote, rootBefore, rootAfter);
  legLinks(backLink, filesLink);
  legDeepLink(deepListCount, deepPanelText, deepPanelMeta);
  legNoErrors(pageErrors, observerPresent);
} catch (e) {
  check("harness setup failed", false, String(e?.message ?? e));
} finally {
  if (browser) browser.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGKILL");
    await Promise.race([exited, sleep(3000)]);
  }
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
