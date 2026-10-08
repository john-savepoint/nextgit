#!/usr/bin/env bun
// Contract suite: FR-8 — diff viewer renders all five modal states through the
// real browser harness: (1) patch rows, (2) no-patch placeholder, (3) secret
// content withheld, (4) not-found in changeSet, (5) error on fetch failure.
// Run: bun porting/tests/ui-diff-viewer-states.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js)
// is loaded in real headless Chrome over a loopback origin. The only scripted
// pieces are the HTTP surface (which fixture /changes serves per scenario) and
// an observer module injected BEFORE app.js that clicks the real view-diff
// controls and reads the real rendered modal DOM — no product mocks, no source
// grep. Each scenario resets the loopback worker's /changes response.
// A box without a Chrome binary skips the suite (precedent: ui-contrast-register).
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
if (!CHROME) { console.log("SKIP  diff viewer states — no Chrome binary on PATH"); process.exit(0); }

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-diffview-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 8000) =>
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

// A realistic diff patch with all line types: 3 meta lines (Index/---/+++),
// 1 hunk header, 1 deletion, 2 additions. Includes HTML-special chars to prove
// escapeHtml runs on + and - lines.
const PATCH = [
  "Index: src/auth.ts",
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -1,3 +1,3 @@",
  "-const TOKEN = '<skulker&co>';",
  "+const TOKEN = '<skulker&co>' || '';",
  "+const TOKEN_VERSION = 2;",
].join("\n");

// changeSet for the patch leg: agent-1 owns src/auth.ts WITH a patch
const PATCH_CHANGES = {
  ok: true, changeSet: {
    base: { repo: "fixture", ref: "main", treeHash: "d1" },
    head: { repo: "agent-1", ref: "main", treeHash: "a1" },
    stats: { files: 1, added: 1, modified: 0, removed: 0, additions: 2, deletions: 1 },
    files: [{ path: "src/auth.ts", status: "modified", additions: 2, deletions: 1, intent: "rotate token", patch: PATCH }]
  }
};

// changeSet for the no-patch leg: agent-1 owns src/auth.ts but patch is absent
const NOPATCH_CHANGES = {
  ok: true, changeSet: {
    base: { repo: "fixture", ref: "main", treeHash: "d2" },
    head: { repo: "agent-1", ref: "main", treeHash: "a2" },
    stats: { files: 1, added: 0, modified: 1, removed: 0, additions: 3, deletions: 0 },
    files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 0 }]
  }
};

// changeSet for the secret leg: agent-1 owns config/.env as a secret-typed file
const SECRET_CHANGES = {
  ok: true, changeSet: {
    base: { repo: "fixture", ref: "main", treeHash: "d3" },
    head: { repo: "agent-1", ref: "main", treeHash: "a3" },
    stats: { files: 1, added: 0, modified: 1, removed: 0, additions: 0, deletions: 0 },
    files: [{ path: "config/.env", status: "modified", secret: true, keys: ["DATABASE_URL", "API_KEY"] }]
  }
};

// changeSet for the not-found leg: agent-1 has src/session.ts (NOT src/auth.ts),
// so clicking src/auth.ts → file not present in changeSet
const NOTFOUND_CHANGES = {
  ok: true, changeSet: {
    base: { repo: "fixture", ref: "main", treeHash: "d4" },
    head: { repo: "agent-1", ref: "main", treeHash: "a4" },
    stats: { files: 1, added: 0, modified: 1, removed: 0, additions: 1, deletions: 0 },
    files: [{ path: "src/session.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n const x = 1;\n+const y = 2;" }]
  }
};

// The proposals fixture: always the same set of proposals across scenarios.
// agent-1 owns src/auth.ts (normal file, has view-diff button) and config/.env
// (secret-typed file, NO view-diff button in app.js due to isSecret guard).
const PROPOSALS = {
  ok: true, base: { repo: "fixture", ref: "main", head: "d0".repeat(20) }, ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1", head: "a0".repeat(20), landing: { status: "ready" }, stats: { files: 2, additions: 2, deletions: 1 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 2, deletions: 1 },
        { path: "config/.env", status: "modified", secret: true, keys: ["DATABASE_URL", "API_KEY"] },
      ],
    },
  ],
  conflicts: [],
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Clicks the real view-diff control
// for a given data-path, waits for the modal, then reads the real rendered DOM
// inside #inspector-modal and emits #test-out. CLICK_PATH is the data-path
// attribute value to click on a .btn-file-diff button.
// ---------------------------------------------------------------------------
const clientScript = (clickPath, isSecret) => `const CLICK_PATH = ${JSON.stringify(clickPath)};
const IS_SECRET = ${JSON.stringify(!!isSecret)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const innerHTMLs = (els) => els.map((e) => e.innerHTML);
const texts = (els) => els.map((e) => e.textContent.trim());
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for app.js to load proposals and render the grid
    await sleep(900);

    // For the secret scenario, app.js omits the view-diff button on secret-typed
    // files (isSecret guard in renderProposals). Inject a synthetic button so we
    // can exercise handleViewDiff → /changes and prove the secret modal state
    // renders correctly. This mirrors how a user might reach the secret path
    // (the proposal card row is present; only the button is intentionally
    // suppressed in the production UI for safety).
    if (IS_SECRET) {
      const row = qs("#proposals-grid .file-row").find((e) => e.querySelector(".file-path") && e.querySelector(".file-path").textContent === CLICK_PATH);
      if (!row) {
        R.err = "secret: no file-row for " + CLICK_PATH;
      } else {
        const synth = document.createElement("button");
        synth.className = "btn-file-diff";
        synth.type = "button";
        synth.setAttribute("data-repo", "agent-1");
        synth.setAttribute("data-path", CLICK_PATH);
        synth.textContent = "view diff";
        row.querySelector(".file-actions-col").appendChild(synth);
      }
    }

    // Click the real view-diff control for the target path
    const btn = qs(".btn-file-diff").find((b) => b.getAttribute("data-path") === CLICK_PATH);
    if (!btn) { R.err = "no view-diff button for path: " + CLICK_PATH; } else {
      btn.click();
      await sleep(900);
    }

    const m = q("#inspector-modal");
    const b = q("#modal-badge");
    const body = q("#modal-body");

    if (m && m.hidden === false) {
      R.s.modalOpen = true;
      R.s.badgeText = b ? b.textContent.trim() : null;
      R.s.badgeClass = b ? b.className : null;
      R.s.title = q("#modal-title") ? q("#modal-title").textContent.trim() : null;
      R.s.diffViewer = qs("#inspector-modal .diff-viewer").length;
      R.s.diffPlaceholder = texts(qs("#inspector-modal .diff-placeholder"));
      R.s.lineMeta = qs("#inspector-modal .diff-line.line-meta").length;
      R.s.lineHunk = qs("#inspector-modal .diff-line.line-hunk").length;
      // Capture both innerHTML (for XSS-tampering check) and textContent
      R.s.lineAdd = innerHTMLs(qs("#inspector-modal .diff-line.line-add"));
      R.s.lineDel = innerHTMLs(qs("#inspector-modal .diff-line.line-del"));
      R.s.secretKeyTags = texts(qs("#inspector-modal .secret-key-tag"));
      R.s.emptyStateTitle = texts(qs("#inspector-modal .empty-state-title"));
      R.s.emptyStateDesc = texts(qs("#inspector-modal .empty-state-desc"));
      R.s.bodyInnerHTML = body ? body.innerHTML : null;
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker: mode selects what /changes returns.
// ---------------------------------------------------------------------------
let mode = "patch";
let changesFixture = PATCH_CHANGES;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/changes") {
    if (mode === "error") { json(res, { ok: false, error: "diff-backend down" }, 500); return; }
    json(res, changesFixture);
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    const s = scenarios.find((x) => x.m === mode);
    res.end(clientScript(s ? s.path : "src/auth.ts", mode === "secret"));
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
function legPatch(dom) {
  const R = parse(dom);
  if (!R) return check("1 patch: scenario output present", false, "no #test-out");
  if (R.err) return check("1 patch: scenario threw", false, R.err);
  const c = R.s;
  check("1 patch: modal opened", c.modalOpen === true);
  check("1 patch: badge class is badge-neutral", String(c.badgeClass || "").includes("badge-neutral"), `cls=${c.badgeClass}`);
  check("1 patch: diff-viewer present", c.diffViewer === 1);
  check("1 patch: line-meta count === 3", c.lineMeta === 3, `count=${c.lineMeta}`);
  check("1 patch: line-hunk count === 1", c.lineHunk === 1, `count=${c.lineHunk}`);
  check("1 patch: line-add count === 2", c.lineAdd.length === 2, `count=${c.lineAdd.length}`);
  check("1 patch: line-del count === 1", c.lineDel.length === 1, `count=${c.lineDel.length}`);
  check("1 patch: no diff-placeholder in patch body", c.diffPlaceholder.length === 0);
  // XSS-tampering contract: < > & on + and - lines must be HTML-escaped (innerHTML has entities)
  const addHtml = c.lineAdd.join("|");
  check("1 patch: + line HTML-escaped (< > &)", addHtml.includes("&lt;") && addHtml.includes("&gt;") && addHtml.includes("&amp;"), `html=${addHtml}`);
  const delHtml = c.lineDel.join("|");
  check("1 patch: - line HTML-escaped (< > &)", delHtml.includes("&lt;") && delHtml.includes("&gt;") && delHtml.includes("&amp;"), `html=${delHtml}`);
}

function legNoPatch(dom) {
  const R = parse(dom);
  if (!R) return check("2 nopatch: scenario output present", false, "no #test-out");
  if (R.err) return check("2 nopatch: scenario threw", false, R.err);
  const c = R.s;
  check("2 nopatch: modal opened", c.modalOpen === true);
  check("2 nopatch: single diff-placeholder", c.diffPlaceholder.length === 1, `count=${c.diffPlaceholder.length}`);
  check("2 nopatch: placeholder text exact", c.diffPlaceholder[0] === "No patch available for this file (omitted, withheld, or binary).", JSON.stringify(c.diffPlaceholder[0]));
  check("2 nopatch: no diff-viewer", c.diffViewer === 0);
  check("2 nopatch: no diff-line rows", c.lineMeta === 0 && c.lineAdd.length === 0 && c.lineDel.length === 0);
}

function legSecret(dom) {
  const R = parse(dom);
  if (!R) return check("3 secret: scenario output present", false, "no #test-out");
  if (R.err) return check("3 secret: scenario threw", false, R.err);
  const c = R.s;
  check("3 secret: modal opened", c.modalOpen === true);
  check("3 secret: badge text 'secret-typed'", c.badgeText === "secret-typed", `badge=${c.badgeText}`);
  check("3 secret: badge class badge-secret", String(c.badgeClass || "").includes("badge-secret"), `cls=${c.badgeClass}`);
  check("3 secret: title 'Secret content withheld'", c.emptyStateTitle.includes("Secret content withheld"), JSON.stringify(c.emptyStateTitle));
  check("3 secret: desc present", c.emptyStateDesc.includes("Per platform contract, secret file contents and diffs are never exposed."), JSON.stringify(c.emptyStateDesc));
  check("3 secret: exactly 2 secret-key-tag chips", c.secretKeyTags.length === 2, `count=${c.secretKeyTags.length}`);
  check("3 secret: key chips match DATABASE_URL + API_KEY", c.secretKeyTags.includes("DATABASE_URL") && c.secretKeyTags.includes("API_KEY"), JSON.stringify(c.secretKeyTags));
  check("3 secret: no diff-viewer in modal", c.diffViewer === 0);
  check("3 secret: no diff-line rows in modal", c.lineMeta === 0 && c.lineAdd.length === 0 && c.lineDel.length === 0);
  check("3 secret: no diff-placeholder in modal", c.diffPlaceholder.length === 0);
}

function legNotFound(dom) {
  const R = parse(dom);
  if (!R) return check("4 notfound: scenario output present", false, "no #test-out");
  if (R.err) return check("4 notfound: scenario threw", false, R.err);
  const c = R.s;
  check("4 notfound: modal opened", c.modalOpen === true);
  check("4 notfound: badge text 'not found'", c.badgeText === "not found", `badge=${c.badgeText}`);
  check("4 notfound: badge class badge-amber", String(c.badgeClass || "").includes("badge-amber"), `cls=${c.badgeClass}`);
  check("4 notfound: title 'File not present in changeSet'", c.emptyStateTitle.includes("File not present in changeSet"), JSON.stringify(c.emptyStateTitle));
  check("4 notfound: no diff-viewer", c.diffViewer === 0);
  check("4 notfound: no diff-line rows", c.lineMeta === 0 && c.lineAdd.length === 0 && c.lineDel.length === 0);
}

function legError(dom) {
  const R = parse(dom);
  if (!R) return check("5 error: scenario output present", false, "no #test-out");
  if (R.err) return check("5 error: scenario threw", false, R.err);
  const c = R.s;
  check("5 error: modal opened", c.modalOpen === true);
  check("5 error: badge text 'error'", c.badgeText === "error", `badge=${c.badgeText}`);
  check("5 error: badge class badge-red", String(c.badgeClass || "").includes("badge-red"), `cls=${c.badgeClass}`);
  check("5 error: title 'Failed to load diff'", c.emptyStateTitle.includes("Failed to load diff"), JSON.stringify(c.emptyStateTitle));
  check("5 error: error message in desc", c.emptyStateDesc.some((d) => d.includes("diff-backend down")), JSON.stringify(c.emptyStateDesc));
  check("5 error: no diff-viewer", c.diffViewer === 0);
  check("5 error: no diff-line rows", c.lineMeta === 0 && c.lineAdd.length === 0 && c.lineDel.length === 0);
}

const scenarios = [
  { m: "patch", path: "src/auth.ts", fixture: PATCH_CHANGES, leg: legPatch },
  { m: "nopatch", path: "src/auth.ts", fixture: NOPATCH_CHANGES, leg: legNoPatch },
  { m: "secret", path: "config/.env", fixture: SECRET_CHANGES, leg: legSecret },
  { m: "notfound", path: "src/auth.ts", fixture: NOTFOUND_CHANGES, leg: legNotFound },
  { m: "error", path: "src/auth.ts", fixture: null, leg: legError },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  for (const [i, s] of scenarios.entries()) {
    mode = s.m;
    changesFixture = s.fixture;
    try {
      const dom = await dumpDom(url);
      s.leg(dom);
    } catch (e) {
      check(`${i + 1} ${s.m}: scenario threw`, false, String(e?.stack ?? e));
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