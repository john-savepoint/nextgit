#!/usr/bin/env bun
// Contract suite: repo files page (nextgit-e14-impl-files-page).
// Run: bun porting/tests/ui-files-page.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (files.html +
// js/files-page.js + styles.css) is served VERBATIM from a Node
// loopback origin into real headless Chrome — including
// /js/files-page.js served from disk under its real path (the
// wave-9 module-graph lesson: a module loaded from any other
// path is a different module and the suite would prove nothing).
// The only scripted pieces are the API fixtures (/proposals,
// /tree, /file) and an observer injected BEFORE js/files-page.js
// that captures uncaught errors — no module mocks, no source
// grep, no mock.module. The shipped module runs for real.
//
// Fixture shapes (pinned CONTRACT.md):
//   /proposals?base=demo -> { ok, base, proposals: 2 repos }
//   /tree (root)         -> src/ dir, README.md, config/.env
//   /tree (src/)         -> main.ts
//   /file README.md      -> classification:'text' + text
//   /file logo.png       -> classification:'binary' (no body fields — the live shape)
//   /file config/.env    -> classification:'secret' + keys (key names only)
//   /file missing.md     -> ok:false 404 shape
//
// Eight observable DOM legs (each fails loudly on a plausible
// regression):
//   1. picker has >= 2 options incl. agent-1 (from /proposals)
//   2. tree rows for src/, README.md, config/.env
//   3. dir click -> breadcrumb "agent-1 / src" + main.ts row
//   4. file click -> #file-content text + #raw-link href
//      "/raw/agent-1/main/README.md" (built from encoded tuple)
//   5. secret leg: key names present, fixture secret VALUE
//      absent from the DOM (masking acceptance — the value never
//      reaches the DOM even though the fixture server COULD send it)
//   6. binary leg: metadata panel is the (metadata only) posture, #file-content
//      stays empty (no binary body inlined)
//   7. back-link a[href="/"] present (back to triage)
//   8. zero uncaught page errors (window listener + stderr scan)
//
// A box without a Chrome binary skips the suite (precedent:
// ui-tour-steps / ui-tour-fetch-fallback); full-suite-safe:
// no network beyond loopback, no live worker, no Artifacts.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const PAGE_TAG = `<script type="module" src="js/files-page.js"></script>`;

// Fixture secret — the value a buggy server would leak. The
// masking law requires it never to reach the DOM.
const SECRET_VALUE = "sk-live-fixture-supersecret-value-42";

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
  console.log("SKIP  UI files page — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-filespage-"));

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
// Observer/driver: injected BEFORE js/files-page.js. Captures
// uncaught errors for the zero-page-errors contract, drives the
// page (dir click, file clicks), and emits #test-out with
// structured observations read from the real rendered DOM.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { errors: [], legs: {} };
window.addEventListener("error", function (e) { try { R.errors.push(String(e.message || e.type)); } catch (e) {} });
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for the picker to populate (proposals -> tree load).
    for (let i = 0; i < 200 && document.querySelectorAll("#repo-picker option").length < 2; i++) {
      await sleep(50);
    }
    await sleep(100);

    // Leg 1: picker >= 2 options incl. agent-1.
    R.legs.pickerOptions = [...document.querySelectorAll("#repo-picker option")].map((o) => o.value);

    // Leg 2: tree rows for src/, README.md, config/.env.
    R.legs.treeText = document.getElementById("file-tree").textContent;

    // Leg 3: click the src/ dir row -> breadcrumb + main.ts.
    const dirRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent === "src/");
    if (dirRow) dirRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("main.ts"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.srcBreadcrumb = document.getElementById("breadcrumb").textContent;
    R.legs.srcTreeText = document.getElementById("file-tree").textContent;

    // Leg 3b: nested depth-2 navigation — enter src/sub/, then click the
    // MIDDLE "src" crumb (regression leg for the slice off-by-one blocker).
    const subRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent === "sub/");
    if (subRow) subRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("inner.ts"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.nestedBreadcrumb = document.getElementById("breadcrumb").textContent;
    const srcCrumb = [...document.querySelectorAll("#breadcrumb a")].find((a) => a.textContent === "src");
    if (srcCrumb) srcCrumb.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("main.ts"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.backBreadcrumb = document.getElementById("breadcrumb").textContent;
    R.legs.backTreeText = document.getElementById("file-tree").textContent;

    // Leg 4: back to root, click README.md -> #file-content text + raw link.
    const rootCrumb0 = [...document.querySelectorAll("#breadcrumb a")][0];
    if (rootCrumb0) rootCrumb0.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("README.md"); i++) {
      await sleep(50);
    }
    await sleep(100);
    const readmeRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent === "README.md");
    if (readmeRow) readmeRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-content").textContent.includes("README fixture body"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.readmeContent = document.getElementById("file-content").textContent;
    R.legs.readmeRawHref = document.getElementById("raw-link").getAttribute("href");

    // Leg 5: navigate back to root, click config/.env -> key names only.
    const rootCrumb = [...document.querySelectorAll("#breadcrumb a")][0];
    if (rootCrumb) rootCrumb.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("config"); i++) {
      await sleep(50);
    }
    await sleep(100);
    // The .env row sits under config/ — click config/ first, then .env.
    const configRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent === "config/");
    if (configRow) configRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes(".env"); i++) {
      await sleep(50);
    }
    await sleep(100);
    const envRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent.startsWith(".env"));
    if (envRow) envRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-meta").textContent.includes("secret"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.secretMeta = document.getElementById("file-meta").textContent;
    R.legs.secretContent = document.getElementById("file-content").textContent;
    R.legs.secretRawHidden = document.getElementById("raw-link").hidden || !document.getElementById("raw-link").getAttribute("href");
    // The visual law: author display:inline-block overrides the UA [hidden]
    // rule, so the hidden attribute alone can leave a DEAD raw affordance
    // visible — pin the computed display (.files-raw-link[hidden] companion).
    R.legs.secretRawDisplay = getComputedStyle(document.getElementById("raw-link")).display;
    R.legs.envRowText = envRow ? envRow.textContent : "";
    // Reveal affordance (files-page secret viewer): read the shipped
    // #file-reveal container + the decision marker before any click.
    const revealBox = document.getElementById("file-reveal");
    R.legs.secretRevealDecision = revealBox ? revealBox.getAttribute("data-reveal-decision") : null;
    R.legs.secretHasReveal = !!(revealBox && revealBox.querySelector(".btn-reveal"));
    const rvBefore = document.getElementById("reveal-value");
    R.legs.hasRevealValueEl = !!rvBefore;
    R.legs.revealValueBeforeHidden = rvBefore ? rvBefore.hidden : null;
    R.legs.revealValueBeforeText = rvBefore ? rvBefore.textContent.trim() : null;
    R.legs.domHtml = document.documentElement.outerHTML;

    // Authorized scenarios: click the REAL .btn-reveal and read the value.
    if (window.__CLICK_REVEAL__ && revealBox && revealBox.querySelector(".btn-reveal")) {
      revealBox.querySelector(".btn-reveal").click();
      for (let i = 0; i < 60; i++) {
        const cur = document.getElementById("reveal-value");
        if (cur && !cur.hidden) break;
        await sleep(50);
      }
      await sleep(100);
      const rv = document.getElementById("reveal-value");
      R.legs.revealValueHidden = rv ? rv.hidden : null;
      R.legs.revealValueText = rv ? rv.textContent.trim() : null;
      R.legs.revealValueInnerHtml = rv ? rv.innerHTML : null;
      R.legs.revealValueDecision = rv ? rv.getAttribute("data-reveal-decision") : null;
      R.legs.domHtmlAfterClick = document.documentElement.outerHTML;
    }

    // Leg 6: back to root, click logo.png -> binary metadata, no content.
    const rootCrumb2 = [...document.querySelectorAll("#breadcrumb a")][0];
    if (rootCrumb2) rootCrumb2.click();
    for (let i = 0; i < 100 && !document.getElementById("file-tree").textContent.includes("logo.png"); i++) {
      await sleep(50);
    }
    await sleep(100);
    const pngRow = [...document.querySelectorAll("#file-tree a")].find((a) => a.textContent === "logo.png");
    if (pngRow) pngRow.click();
    for (let i = 0; i < 100 && !document.getElementById("file-meta").textContent.includes("binary"); i++) {
      await sleep(50);
    }
    await sleep(100);
    R.legs.binaryMeta = document.getElementById("file-meta").textContent;
    R.legs.binaryContent = document.getElementById("file-content").textContent;
  } catch (e) { R.errors.push(String((e && e.stack) || e)); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface: serves the shipped files page and
// /js/files-page.js VERBATIM from disk (module-graph survival),
// plus scripted API fixtures. No fixture is served from any path
// other than its real one.
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PROPOSALS = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "a".repeat(40) },
  proposals: [
    { repo: "agent-1", head: "b".repeat(40) },
    { repo: "agent-2", head: "c".repeat(40) },
  ],
};

// Scenario selectors for the reveal legs: whoamiMode drives GET /whoami,
// revealMode drives POST /reveal, clickReveal arms the observer's click.
let whoamiMode = "default";   // "default" => reveal:false; "authorized" => reveal:true
let revealMode = "grant";     // "grant" => 200 {value}; "deny" => 403 reveal-not-authorized
let clickReveal = false;

const j = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const jCode = (res, body, code) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");

  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(`window.__CLICK_REVEAL__ = ${clickReveal === true};\n` + clientScript);
    return;
  }

  // --- API fixtures -------------------------------------------------------
  if (pathname === "/whoami") {
    j(res, whoamiMode === "authorized"
      ? { ok: true, authorized: true, reveal: true }
      : { ok: true, authorized: false, reveal: false });
    return;
  }

  if (pathname === "/reveal") {
    // The value a buggy surface would render — only the grant leg returns
    // it, and only ever from this 200 body.
    if (revealMode === "grant") {
      j(res, { ok: true, repo: "agent-1", ref: "b".repeat(40), path: "config/.env", key: "STRIPE_SECRET_KEY", value: SECRET_VALUE });
      return;
    }
    jCode(res, { ok: false, error: "reveal-not-authorized" }, 403);
    return;
  }

  if (pathname === "/proposals") { j(res, PROPOSALS); return; }

  if (pathname === "/tree") {
    const repo = searchParams.get("repo");
    const path = searchParams.get("path") ?? "";
    if (repo === "agent-1" && path === "") {
      j(res, {
        ok: true,
        entries: [
          { name: "src", type: "tree", size: 0, blobHash: "d".repeat(40) },
          { name: "README.md", type: "blob", size: 21, blobHash: "e".repeat(40) },
          { name: "logo.png", type: "blob", size: 128, blobHash: "f".repeat(40) },
          { name: "config", type: "tree", size: 0, blobHash: "0".repeat(40) },
        ],
      });
      return;
    }
    if (repo === "agent-1" && path === "src") {
      j(res, {
        ok: true,
        entries: [
          { name: "sub", type: "tree", size: 0, blobHash: "9".repeat(40) },
          { name: "main.ts", type: "blob", size: 9, blobHash: "1".repeat(40) },
        ],
      });
      return;
    }
    if (repo === "agent-1" && path === "src/sub") {
      j(res, { ok: true, entries: [{ name: "inner.ts", type: "blob", size: 7, blobHash: "8".repeat(40) }] });
      return;
    }
    if (repo === "agent-1" && path === "config") {
      j(res, { ok: true, entries: [{ name: ".env", type: "blob", size: 44, blobHash: "2".repeat(40) }] });
      return;
    }
    j(res, { ok: false, error: "not-found" });
    return;
  }

  if (pathname === "/file") {
    const repo = searchParams.get("repo");
    const path = searchParams.get("path") ?? "";
    if (repo === "agent-1" && path === "README.md") {
      j(res, { ok: true, classification: "text", text: "README fixture body" });
      return;
    }
    if (repo === "agent-1" && path === "src/main.ts") {
      j(res, { ok: true, classification: "text", text: "export const x = 1;" });
      return;
    }
    if (repo === "agent-1" && path === "logo.png") {
      j(res, { ok: true, classification: "binary" });
      return;
    }
    if (repo === "agent-1" && path === "config/.env") {
      // The server-side authority answers classification:'secret' +
      // key names only (contract keys[]). The fixture ALSO simulates a
      // buggy server that leaked the value into `text` — the
      // masking acceptance is that the UI never renders it.
      j(res, { ok: true, classification: "secret", keys: ["STRIPE_SECRET_KEY", "DATABASE_URL"], text: SECRET_VALUE });
      return;
    }
    j(res, { ok: false, error: "not-found" });
    return;
  }

  if (pathname.startsWith("/raw/")) { j(res, { ok: true, raw: true }); return; }

  // --- Shipped UI, verbatim from disk ------------------------------------
  const rel = pathname === "/" ? "files.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  if (rel === "files.html") {
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
function legPicker(R) {
  const opts = R.legs?.pickerOptions ?? [];
  check("1 picker has >= 2 options from /proposals", opts.length >= 2, `options=${JSON.stringify(opts)}`);
  check("1 picker includes agent-1", opts.includes("agent-1"), `options=${JSON.stringify(opts)}`);
}

function legTree(R) {
  const text = R.legs?.treeText ?? "";
  check("2 tree lists src/ dir", text.includes("src/"), `tree=${JSON.stringify(text)}`);
  check("2 tree lists README.md", text.includes("README.md"), `tree=${JSON.stringify(text)}`);
  check("2 tree lists config/.env (config dir)", text.includes("config/"), `tree=${JSON.stringify(text)}`);
}

function legDirClick(R) {
  const crumb = R.legs?.srcBreadcrumb ?? "";
  const tree = R.legs?.srcTreeText ?? "";
  check("3 dir click updates breadcrumb to agent-1 / src", crumb.includes("agent-1") && crumb.includes("src"), `crumb=${JSON.stringify(crumb)}`);
  check("3 dir click lists main.ts", tree.includes("main.ts"), `tree=${JSON.stringify(tree)}`);
}

function legNested(R) {
  // Depth-2 breadcrumb regression: the middle "src" crumb must target
  // path "src" (not the repo root — the slice(2, i+1) off-by-one).
  const nested = R.legs?.nestedBreadcrumb ?? "";
  const back = R.legs?.backBreadcrumb ?? "";
  const tree = R.legs?.backTreeText ?? "";
  check("3b nested dir click reaches src/sub", nested.includes("src") && nested.includes("sub"), `crumb=${JSON.stringify(nested)}`);
  check("3b middle crumb returns to src (not root)", back.endsWith("src") && tree.includes("main.ts"), `crumb=${JSON.stringify(back)} tree=${JSON.stringify(tree.slice(0, 120))}`);
}

function legFileClick(R) {
  const content = R.legs?.readmeContent ?? "";
  const href = R.legs?.readmeRawHref ?? "";
  check("4 file click renders #file-content text", content.includes("README fixture body"), `content=${JSON.stringify(content)}`);
  // The raw link is built from the encoded tuple with the
  // RESOLVED ref — agent-1's proposal head ("b…40"), not a
  // literal "main".
  check("4 raw link href uses the encoded agent-1/ref/README.md tuple",
    href === `/raw/agent-1/${"b".repeat(40)}/README.md`, `href=${JSON.stringify(href)}`);
}

function legSecret(R) {
  const meta = R.legs?.secretMeta ?? "";
  const content = R.legs?.secretContent ?? "";
  const dom = R.legs?.domHtml ?? "";
  // The key names (contract keys[]) render in the
  // key-names-only panel (#file-content); #file-meta carries the posture.
  check("5 secret leg shows key names (STRIPE_SECRET_KEY)", content.includes("STRIPE_SECRET_KEY"), `content=${JSON.stringify(content)}`);
  check("5 secret leg shows key names (DATABASE_URL)", content.includes("DATABASE_URL"), `content=${JSON.stringify(content)}`);
  check("5 secret VALUE never reaches the DOM (masking law)", !dom.includes(SECRET_VALUE), "fixture secret value found in DOM");
  check("5 secret panel is key-names-only posture", meta.includes("secret"), `meta=${JSON.stringify(meta)}`);
  check("5 secret row carries the word, not color alone", (R.legs?.envRowText ?? "").includes("secret"), `row=${JSON.stringify(R.legs?.envRowText)}`);
  check("5 no raw link on secret-class paths", R.legs?.secretRawHidden === true, `hidden=${JSON.stringify(R.legs?.secretRawHidden)}`);
  check("5 secret-class raw link is visually gone (computed display none)", R.legs?.secretRawDisplay === "none", `display=${JSON.stringify(R.legs?.secretRawDisplay)}`);
}

function legBinary(R) {
  const meta = R.legs?.binaryMeta ?? "";
  const content = R.legs?.binaryContent ?? "";
  check("6 binary leg shows the (metadata only) posture", meta.includes("binary") && meta.includes("(metadata only)"), `meta=${JSON.stringify(meta)}`);
  check("6 binary leg leaves #file-content empty", content === "", `content=${JSON.stringify(content)}`);
}

function legBackLink(R) {
  const back = R.legs?.backLink ?? null;
  check("7 back-link a[href=\"/\"] present", back === true, `backLink=${JSON.stringify(back)}`);
}

function legNoErrors(R) {
  check("8 zero uncaught page errors (observer)", R.errors.length === 0, `errors=${JSON.stringify(R.errors)}`);
  const stderrBad = /(?:Uncaught|ReferenceError|SyntaxError|TypeError)\b/i.test(chromeStderr ?? "");
  check("8 zero uncaught errors in Chrome stderr", !stderrBad, `stderr~=${(chromeStderr ?? "").slice(0, 160)}`);
}

// --- Reveal reachability legs (9-13) ---------------------------------------

function legNotCapable(R) {
  check("9 not capable: NO #file-reveal .btn-reveal", R.legs?.secretHasReveal === false, `hasReveal=${JSON.stringify(R.legs?.secretHasReveal)}`);
  check("9 not capable: no #reveal-value element", R.legs?.hasRevealValueEl === false, `hasVal=${JSON.stringify(R.legs?.hasRevealValueEl)}`);
  check("9 not capable: #file-reveal data-reveal-decision=withheld", R.legs?.secretRevealDecision === "withheld", `decision=${JSON.stringify(R.legs?.secretRevealDecision)}`);
}

function legCapable(R) {
  check("10 capable: #file-reveal .btn-reveal present (reveal:true)", R.legs?.secretHasReveal === true, `hasReveal=${JSON.stringify(R.legs?.secretHasReveal)}`);
  check("10 capable: #file-reveal data-reveal-decision=control", R.legs?.secretRevealDecision === "control", `decision=${JSON.stringify(R.legs?.secretRevealDecision)}`);
  check("10 capable: #reveal-value hidden and empty before click",
    R.legs?.revealValueBeforeHidden === true && (R.legs?.revealValueBeforeText ?? "") === "",
    `h=${JSON.stringify(R.legs?.revealValueBeforeHidden)} t=${JSON.stringify(R.legs?.revealValueBeforeText)}`);
}

function legGranted(R) {
  check("11 granted: .btn-reveal was present and clicked", R.legs?.secretHasReveal === true && R.legs?.revealValueHidden === false, `has=${JSON.stringify(R.legs?.secretHasReveal)} h=${JSON.stringify(R.legs?.revealValueHidden)}`);
  check("11 granted: #reveal-value carries 'STRIPE_SECRET_KEY = <fixture value>' (from the /reveal 200 body)",
    (R.legs?.revealValueText ?? "").includes("STRIPE_SECRET_KEY") && (R.legs?.revealValueText ?? "").includes(SECRET_VALUE),
    `text=${JSON.stringify(R.legs?.revealValueText)}`);
  check("11 granted: #reveal-value data-reveal-decision=revealed", R.legs?.revealValueDecision === "revealed", `decision=${JSON.stringify(R.legs?.revealValueDecision)}`);
  check("11 granted: value is HTML-escaped (no raw markup injection)",
    !/<script/.test(R.legs?.revealValueInnerHtml ?? "") && (R.legs?.revealValueInnerHtml ?? "").includes(SECRET_VALUE),
    `html=${JSON.stringify(R.legs?.revealValueInnerHtml)}`);
}

function legDenied(R) {
  check("12 denied: .btn-reveal was present and clicked", R.legs?.secretHasReveal === true && R.legs?.revealValueHidden === false, `has=${JSON.stringify(R.legs?.secretHasReveal)} h=${JSON.stringify(R.legs?.revealValueHidden)}`);
  check("12 denied: #reveal-value shows the denial copy",
    (R.legs?.revealValueText ?? "").includes("Secret content withheld") && (R.legs?.revealValueText ?? "").includes("reveal not authorized"),
    `text=${JSON.stringify(R.legs?.revealValueText)}`);
  check("12 denied: #reveal-value data-reveal-decision=denied", R.legs?.revealValueDecision === "denied", `decision=${JSON.stringify(R.legs?.revealValueDecision)}`);
  check("12 denied: NO fixture value in the post-click DOM", !(R.legs?.domHtmlAfterClick ?? "").includes(SECRET_VALUE), "fixture leaked into DOM");
}

function legMaskingLaw(passes) {
  for (const { name, R } of passes) {
    const pre = R?.legs?.domHtml;
    if (pre === undefined) {
      check(`13 masking law (${name}): DOM snapshot present`, false, "no domHtml in observer output");
      continue;
    }
    check(`13 masking law (${name}): fixture value absent from the DOM before any reveal`, !pre.includes(SECRET_VALUE), "fixture value found in pre-reveal DOM");
    const post = R.legs?.domHtmlAfterClick;
    if (post !== undefined) {
      const revealed = R.legs?.revealValueDecision === "revealed";
      check(`13 masking law (${name}): post-click DOM ${revealed ? "carries" : "omits"} the fixture value`,
        revealed ? post.includes(SECRET_VALUE) : !post.includes(SECRET_VALUE), `revealed=${revealed}`);
    }
  }
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
  const runScenario = async ({ whoami, reveal = "grant", click = false }) => {
    whoamiMode = whoami;
    revealMode = reveal;
    clickReveal = click;
    await send("Page.navigate", { url: "about:blank" });
    await waitFor(`location.href === "about:blank" && !document.getElementById("test-out")`);
    await send("Page.navigate", { url: `${baseUrl}/` });
    await waitFor(`document.getElementById("test-out")`);
    // Leg 7 (back-link) is a static markup fact — read it directly.
    const backLink = await evl(`!!document.querySelector('a[href="/"]')`);
    const raw = await evl(`document.getElementById("test-out").textContent`);
    const R = raw ? JSON.parse(decodeURIComponent(raw)) : null;
    if (R) R.legs.backLink = backLink;
    return R;
  };

  // Default posture (reveal:false): legs 1-9 + back-link/no-errors.
  const defaultR = await runScenario({ whoami: "default", click: false });
  if (!defaultR) {
    check("harness: observer output present", false, "no #test-out in rendered DOM");
  } else if (defaultR.errors.length && !defaultR.legs) {
    check("harness: observer ran without throwing", false, defaultR.errors.join(" | "));
  } else {
    legPicker(defaultR);
    legTree(defaultR);
    legDirClick(defaultR);
    legNested(defaultR);
    legFileClick(defaultR);
    legSecret(defaultR);
    legBinary(defaultR);
    legBackLink(defaultR);
    legNoErrors(defaultR);
    legNotCapable(defaultR);
  }

  // reveal:true, no click → the control renders, no value yet.
  const capableR = await runScenario({ whoami: "authorized", click: false });
  if (capableR?.legs) legCapable(capableR);
  else check("10 capable: scenario output present", false, "no #test-out");

  // reveal:true + grant → the real click renders the value from the 200 body.
  const grantedR = await runScenario({ whoami: "authorized", reveal: "grant", click: true });
  if (grantedR?.legs) legGranted(grantedR);
  else check("11 granted: scenario output present", false, "no #test-out");

  // reveal:true + deny → the denial notice renders, no value anywhere.
  const deniedR = await runScenario({ whoami: "authorized", reveal: "deny", click: true });
  if (deniedR?.legs) legDenied(deniedR);
  else check("12 denied: scenario output present", false, "no #test-out");

  // The masking law holds across every scenario.
  legMaskingLaw([
    { name: "not-capable", R: defaultR },
    { name: "capable", R: capableR },
    { name: "granted", R: grantedR },
    { name: "denied", R: deniedR },
  ]);
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
