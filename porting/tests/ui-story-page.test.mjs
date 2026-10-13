#!/usr/bin/env bun
// Contract suite: the game-industry story page (nextgit-e16-impl-story-page).
// Run: bun porting/tests/ui-story-page.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (story.html +
// js/story-page.js + styles.css) is served VERBATIM from a Node
// loopback origin into real headless Chrome — including
// /js/story-page.js served from disk under its real path (the
// wave-9 module-graph lesson: a module loaded from any other
// path is a different module and the suite would prove nothing).
// The only scripted pieces are the /proposals fixture and an
// observer injected BEFORE js/story-page.js that captures
// uncaught errors — no module mocks, no source grep, no
// mock.module. The shipped module runs for real.
//
// Fixture shapes (pinned CONTRACT.md):
//   /proposals?base=demo -> { ok, base, proposals: 2 rows }
//     agent-1 files[] carries the R2 asset-pointer row exactly
//     per CONTRACT §R2 rendering law:
//       { path: "assets/hero.png",
//         asset: { v:1, blobId:<64-hex>, sha256:<64-hex>, size:12345, contentType:"image/png" } }
//     agent-2 files[] carries an ordinary text row (control).
//
// Eight observable DOM legs (each fails loudly on a plausible
// regression):
//   1. static narrative: three storage-class tiers render
//      (.story-tier count === 3; semantic/work/provenance names
//      + SPEC-derived holding words present)
//   2. pointer chip renders: #asset-chip carries the fixture
//      path, size, contentType and truncated sha256 prefix
//   3. blobId renders as opaque key text (mono class) + the
//      chip carries the CONTRACT citation (GET /asset/{blobId})
//   4. no-URL-egress: #asset-chip a count === 0 and no
//      nextgit-asset-blobs URL string in the DOM
//   5. fallback leg (scenario switch): no proposal carries a
//      pointer -> the honest fallback line renders, no chip
//   6. error leg (scenario switch): /proposals 500 -> banner
//      un-hidden, static narrative still rendered
//   7. back-link a[href="/"] present
//   8. zero uncaught page errors (window listener + stderr scan)
//
// A box without a Chrome binary skips the suite (precedent:
// ui-tour-steps / ui-tour-fetch-fallback); full-suite-safe:
// no network beyond loopback, no live worker, no Artifacts.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const PAGE_TAG = `<script type="module" src="js/story-page.js"></script>`;

// The fixture pointer (the acceptance datum) — deterministic
// literals; no real blob is needed because the page renders
// pointer metadata only and must NOT fetch /asset/.
const BLOB_ID = "a".repeat(64);
const SHA256 = "b".repeat(64);
const FIXTURE_SIZE = 12345;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP no Chrome binary found (CHROME_BIN unset)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-storypage-"));

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
// Observer/driver: injected BEFORE js/story-page.js. Captures
// uncaught errors for the zero-page-errors contract and emits
// #test-out with structured observations read from the real
// rendered DOM.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { errors: [], legs: {} };
window.addEventListener("error", function (e) { try { R.errors.push(String(e.message || e.type)); } catch (e) {} });
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for the pointer chip to resolve (proposals -> chip).
    for (let i = 0; i < 200 && document.getElementById("asset-meta").textContent.includes("loading…"); i++) {
      await sleep(50);
    }
    await sleep(100);

    // Leg 1: static narrative — three storage-class tiers.
    R.legs.tierCount = document.querySelectorAll(".story-tier").length;
    R.legs.tierText = [...document.querySelectorAll(".story-tiers")].map((u) => u.textContent).join(" ");
    R.legs.sectionText = document.querySelector("main").textContent;

    // Leg 2 + 3: the live pointer chip.
    R.legs.chipText = document.getElementById("asset-chip").textContent;
    R.legs.blobClass = document.querySelector(".story-asset-blob") ? document.querySelector(".story-asset-blob").className : null;
    R.legs.chipAnchors = document.querySelectorAll("#asset-chip a").length;

    // Leg 4: no-URL-egress — the whole DOM is scanned for the
    // bucket name (a URL-form leak) and the canary below.
    R.legs.domHtml = document.documentElement.outerHTML;

    // Leg 7: back-link.
    R.legs.backLink = !!document.querySelector('a[href="/"]');

  } catch (e) { R.errors.push(String((e && e.stack) || e)); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface: serves the shipped story page and
// /js/story-page.js VERBATIM from disk (module-graph survival),
// plus a scripted /proposals fixture. No fixture is served from
// any path other than its real one.
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// Scenario selectors: fixtureMode drives GET /proposals —
// "pointer" (the default fixture), "none" (no pointer rows),
// "error" (500). Reset per leg.
let fixtureMode = "pointer";

const j = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const jCode = (res, body, code) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");

  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }

  // --- API fixture --------------------------------------------------------
  if (pathname === "/proposals") {
    if (fixtureMode === "error") {
      jCode(res, { ok: false, error: "fixture-internal-error" }, 500);
      return;
    }
    if (fixtureMode === "none") {
      // Control set: proposals exist, but NO row carries an
      // asset pointer (the honest-fallback posture).
      j(res, {
        ok: true,
        base: { repo: "demo", ref: "main", head: "a".repeat(40) },
        proposals: [
          { repo: "agent-1", head: "b".repeat(40), files: [{ path: "README.md", status: "modified", additions: 1, deletions: 1 }] },
        ],
      });
      return;
    }
    // The acceptance fixture: one proposal whose files[] carries
    // an asset-pointer row exactly per CONTRACT §R2 rendering law,
    // plus a second proposal with an ordinary text row (control).
    j(res, {
      ok: true,
      base: { repo: "demo", ref: "main", head: "a".repeat(40) },
      proposals: [
        {
          repo: "agent-1",
          head: "b".repeat(40),
          files: [
            { path: "src/main.ts", status: "modified", additions: 2, deletions: 1 },
            {
              path: "assets/hero.png",
              status: "added",
              asset: { v: 1, blobId: BLOB_ID, sha256: SHA256, size: FIXTURE_SIZE, contentType: "image/png" },
              note: "asset pointer; metadata only",
            },
          ],
        },
        { repo: "agent-2", head: "c".repeat(40), files: [{ path: "docs/guide.md", status: "added", additions: 12, deletions: 0 }] },
      ],
    });
    return;
  }

  // --- Shipped UI, verbatim from disk ------------------------------------
  const rel = pathname === "/" ? "story.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  if (rel === "story.html") {
    // Inject the observer BEFORE the shipped module — the page's
    // own script tag stays last, exactly as shipped.
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
function legTiers(R) {
  const count = R.legs?.tierCount ?? 0;
  const text = R.legs?.tierText ?? "";
  check("1 three storage-class tiers render", count === 3, `count=${count}`);
  check("1 tier names semantic/work/provenance present",
    text.includes("semantic") && text.includes("work") && text.includes("provenance"),
    `text=${JSON.stringify(text.slice(0, 160))}`);
  // SPEC stack.md-derived holding words (verbatim table cells).
  check("1 SPEC-derived holding words present (classification, task queue, git-notes)",
    text.includes("classification") && text.includes("task queue") && text.includes("git-notes"),
    `text=${JSON.stringify(text.slice(0, 240))}`);
}

function legChip(R) {
  const text = R.legs?.chipText ?? "";
  check("2 chip renders the fixture path assets/hero.png", text.includes("assets/hero.png"), `text=${JSON.stringify(text.slice(0, 200))}`);
  check("2 chip renders the fixture size 12345", text.includes("12345"), `text=${JSON.stringify(text.slice(0, 200))}`);
  check("2 chip renders the fixture contentType image/png", text.includes("image/png"), `text=${JSON.stringify(text.slice(0, 200))}`);
  // Truncated sha256 display: first 12 hex chars + ellipsis.
  check("2 chip renders the truncated sha256 prefix", text.includes(`${SHA256.slice(0, 12)}…`), `text=${JSON.stringify(text.slice(0, 200))}`);
}

function legBlobAndCitation(R) {
  const text = R.legs?.chipText ?? "";
  const blobClass = R.legs?.blobClass ?? "";
  check("3 blobId renders as opaque key text (mono class)", typeof blobClass === "string" && blobClass.includes("story-asset-blob"), `class=${JSON.stringify(blobClass)}`);
  check("3 chip carries the full opaque blobId", text.includes(BLOB_ID), "blobId not rendered");
  check("3 chip carries the CONTRACT citation (GET /asset/{blobId})",
    text.includes("GET /asset/{blobId}") && text.includes("CONTRACT.md"),
    `text=${JSON.stringify(text.slice(-160))}`);
}

function legNoUrlEgress(R) {
  const dom = R.legs?.domHtml ?? "";
  check("4 chip has zero anchors (no URL egress)", (R.legs?.chipAnchors ?? -1) === 0, `anchors=${R.legs?.chipAnchors}`);
  check("4 no bucket URL string in the DOM", !dom.includes("nextgit-asset-blobs/") && !/nextgit-asset-blobs[?&#]/.test(dom), "bucket URL leaked into DOM");
}

function legBackLink(R) {
  check("7 back-link a[href=\"/\"] present", R.legs?.backLink === true, `backLink=${JSON.stringify(R.legs?.backLink)}`);
}

function legNoErrors(R) {
  check("8 zero uncaught page errors (observer)", (R?.errors ?? []).length === 0, `errors=${JSON.stringify(R?.errors ?? [])}`);
  const stderrBad = /(?:Uncaught|ReferenceError|SyntaxError|TypeError)\b/i.test(chromeStderr ?? "");
  check("8 zero uncaught errors in Chrome stderr", !stderrBad, `stderr~=${(chromeStderr ?? "").slice(0, 160)}`);
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

  // Fresh-document scenario runner: blank first so a stale #test-out from
  // the previous scenario can never be mistaken for the new one.
  const runScenario = async () => {
    fixtureMode = runScenario.mode;
    await send("Page.navigate", { url: "about:blank" });
    await waitFor(`location.href === "about:blank" && !document.getElementById("test-out")`);
    await send("Page.navigate", { url: `${baseUrl}/` });
    await waitFor(`document.getElementById("test-out")`);
    const raw = await evl(`document.getElementById("test-out").textContent`);
    return raw ? JSON.parse(decodeURIComponent(raw)) : null;
  };

  // Default fixture (pointer present): legs 1-4 + 7 + 8.
  runScenario.mode = "pointer";
  const pointerR = await runScenario();
  if (!pointerR) {
    check("harness: observer output present", false, "no #test-out in rendered DOM");
  } else if (pointerR.errors.length && !pointerR.legs) {
    check("harness: observer ran without throwing", false, pointerR.errors.join(" | "));
  } else {
    legTiers(pointerR);
    legChip(pointerR);
    legBlobAndCitation(pointerR);
    legNoUrlEgress(pointerR);
    legBackLink(pointerR);
    legNoErrors(pointerR);
  }

  // Fallback fixture (no pointer row): leg 5 — the honest fallback
  // line renders and no fabricated chip appears.
  runScenario.mode = "none";
  const noneR = await runScenario();
  if (noneR?.legs) {
    const meta = await evl(`document.getElementById("asset-meta").textContent`);
    check("5 no-pointer set renders the honest fallback line",
      String(meta).includes("no asset pointer in the current demo set"),
      `meta=${JSON.stringify(String(meta))}`);
    check("5 no fabricated chip (no blobId text)", !(noneR.legs.chipText ?? "").includes(BLOB_ID), "fixture blobId rendered from nowhere");
    check("5 static narrative still rendered", (noneR.legs.tierCount ?? 0) === 3, `count=${noneR.legs?.tierCount}`);
    check("5 zero uncaught page errors (fallback scenario)", noneR.errors.length === 0, `errors=${JSON.stringify(noneR.errors)}`);
  } else {
    check("5 fallback scenario output present", false, "no #test-out");
  }

  // Error fixture (/proposals 500): leg 6 — the banner un-hides
  // with the error text; the static narrative stays rendered.
  runScenario.mode = "error";
  const errorR = await runScenario();
  if (errorR?.legs) {
    const bannerHidden = await evl(`document.getElementById("story-banner").hidden`);
    const bannerMsg = await evl(`document.getElementById("story-banner-msg").textContent`);
    check("6 /proposals 500 un-hides #story-banner", bannerHidden === false, `hidden=${JSON.stringify(bannerHidden)}`);
    check("6 banner carries the error text", String(bannerMsg).includes("Could not load the story's live data"), `msg=${JSON.stringify(String(bannerMsg))}`);
    check("6 static narrative still rendered (honest degradation)", (errorR.legs.tierCount ?? 0) === 3, `count=${errorR.legs?.tierCount}`);
    check("6 zero uncaught page errors (error scenario)", errorR.errors.length === 0, `errors=${JSON.stringify(errorR.errors)}`);
  } else {
    check("6 error scenario output present", false, "no #test-out");
  }
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
