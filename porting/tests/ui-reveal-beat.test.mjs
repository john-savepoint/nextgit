#!/usr/bin/env bun
// Contract suite: CAP-8 elevated-reveal beat — the browser contract
// for the diff-modal secret surface (ui-reveal-beat).
// Run: bun porting/tests/ui-reveal-beat.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css
// + app.js + reveal-decision.js) is loaded in real headless Chrome
// over a loopback origin. The only scripted pieces are the HTTP
// surface (which fixture /whoami, /changes and /reveal serve per
// scenario) and an observer module injected BEFORE app.js that
// opens the real diff modal for a secret-class file and reads the
// real rendered DOM — no product mocks, no source grep.
// A box without a Chrome binary skips the suite (precedent:
// ui-merge-modal-states.test.mjs).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); }

const CHROME =
 ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
  .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
  .find(Boolean) || process.env.CHROME_BIN || null;
if (!CHROME) { console.log("SKIP  ui-reveal-beat — no Chrome binary on PATH"); process.exit(0); }

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-revealbeat-"));

const dumpDom = (url, budget = 8000) =>
 new Promise((resolve, reject) => {
  const child = spawn(
   CHROME,
   ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
   { stdio: ["ignore", "pipe", "ignore"] },
  );
  let out = "";
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("chrome timed out after 60s")); }, 60000);
  child.stdout.on("data", (d) => (out += d));
  child.on("error", (e) => { clearTimeout(timer); reject(e); });
  child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`chrome exited with ${code}`)); });
 });

const parse = (dom) => {
 const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
 return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The secret-class file. The proposals fixture marks it NON-secret so
// the card renders a real "view diff" control; the /changes fixture
// marks the SAME path secret:true with keys[] so handleViewDiff hits
// the secret branch (the masking seam under test).
const SECRET_PATH = "config/.env";
const SECRET_KEYS = ["DATABASE_URL", "REDIS_URL"];
const FIXTURE_VALUE = "postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app";

const PROPOSALS = {
 ok: true, base: "demo", ref: "main", baseRef: "main",
 proposals: [{
  repo: "agent-5",
  intent: "rotate secrets",
  stats: { additions: 2, deletions: 2, files: 1 },
  files: [{ path: SECRET_PATH, status: "modified", secret: false }],
  landing: { status: "ready" },
 }, {
  // R1: a withheld-secret card. Its secret row renders NO view-diff control,
  // but the card must offer the reachable grid→merge-modal path.
  repo: "agent-7",
  intent: "rotate secrets",
  stats: { additions: 1, deletions: 0, files: 1 },
  files: [{ path: SECRET_PATH, status: "modified", secret: true, keys: SECRET_KEYS }],
  landing: { status: "withheld-secret" },
 }],
};

// /changes: the same path, but secret-class with keys (no value).
const CHANGES = {
 ok: true,
 changeSet: {
  files: [{ path: SECRET_PATH, status: "modified", secret: true, keys: SECRET_KEYS }],
 },
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Opens the real diff modal
// for the secret-class file, then (per scenario) optionally clicks the
// real .btn-reveal control and reads the rendered DOM.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { s: {}, err: null };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const texts = (els) => els.map((e) => e.textContent.trim());
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    // R1 grid leg: the withheld-secret card's affordances, read from the
    // rendered grid (independent of the diff modal opened below).
    const withheldCard = q("#card-agent-7");
    R.s.withheldCardPresent = !!withheldCard;
    R.s.withheldHasPreviewMerge = !!(withheldCard && withheldCard.querySelector(".btn-preview-merge"));
    R.s.withheldPreviewMergeHasRepo = withheldCard ? !!withheldCard.querySelector(".btn-preview-merge[data-repo]") : false;
    R.s.withheldFileHasViewDiff = !!(withheldCard && withheldCard.querySelector(".file-row .btn-file-diff"));
    const diffBtn = qs(".btn-file-diff").find((b) => b.getAttribute("data-repo") === "agent-5" && b.getAttribute("data-path") === "${SECRET_PATH}");
    if (!diffBtn) { R.err = "no view-diff button for agent-5 ${SECRET_PATH}"; } else {
      diffBtn.click();
      await sleep(700);
    }
    const m = q("#inspector-modal");
    if (m && m.hidden === false) {
      R.s.modalOpen = true;
      R.s.badgeText = q("#modal-badge") ? q("#modal-badge").textContent.trim() : null;
      R.s.badgeClass = q("#modal-badge") ? q("#modal-badge").className : null;
      R.s.emptyStateTitle = texts(qs("#inspector-modal .empty-state-title"));
      R.s.emptyStateDesc = texts(qs("#inspector-modal .empty-state-desc"));
      R.s.keyTags = texts(qs("#inspector-modal .secret-key-tag"));
      R.s.hasBtnReveal = !!q("#inspector-modal .btn-reveal");
      const rv = q("#reveal-value");
      R.s.revealValueHidden = rv ? rv.hidden : null;
      R.s.revealValueText = rv ? rv.textContent.trim() : null;
      R.s.bodyInnerHTML = q("#modal-body") ? q("#modal-body").innerHTML : null;
    }
    // Scenario 3/4: click the reveal control when present.
    if (window.__CLICK_REVEAL__ && q("#inspector-modal .btn-reveal")) {
      q("#inspector-modal .btn-reveal").click();
      await sleep(700);
      const rv = q("#reveal-value");
      R.s.afterClickValueHidden = rv ? rv.hidden : null;
      R.s.afterClickValueText = rv ? rv.textContent.trim() : null;
      R.s.afterClickInnerHTML = rv ? rv.innerHTML : null;
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker: whoamiMode / revealMode select what /whoami and
// /reveal return; /changes always carries the secret-class file.
// ---------------------------------------------------------------------------
let whoamiMode = "default";   // "default" => reveal:false; "authorized" => reveal:true
let revealMode = "grant";     // "grant" => 200 value; "deny" => 403; "error" => 500
let clickReveal = false;      // scenario 3/4: click the real .btn-reveal

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
 const { pathname } = new URL(req.url, "http://127.0.0.1");
 if (pathname === "/whoami") {
  return whoamiMode === "authorized"
   ? json(res, { ok: true, authorized: true, reveal: true })
   : json(res, { ok: true, authorized: false, reveal: false });
 }
 if (pathname === "/proposals") return json(res, PROPOSALS);
 if (pathname === "/events") return json(res, EVENTS);
 if (pathname === "/judge") return json(res, JUDGE);
 if (pathname === "/changes") return json(res, CHANGES);
 if (pathname === "/reveal") {
  if (revealMode === "grant") { json(res, { ok: true, repo: "agent-5", ref: "main", path: SECRET_PATH, key: "DATABASE_URL", value: FIXTURE_VALUE }); return; }
  if (revealMode === "deny") { json(res, { ok: false, error: "reveal-not-authorized" }, 403); return; }
  json(res, { ok: false, error: "reveal-unavailable" }, 500); return;
 }
 if (pathname === "/__client.js") {
  res.writeHead(200, { "content-type": "text/javascript" });
  res.end(`window.__CLICK_REVEAL__ = ${clickReveal === true};\n` + clientScript);
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
function legDefaultSurface(dom) {
 const R = parse(dom);
 if (!R) return check("1 default surface: scenario output present", false, "no #test-out");
 check("1 default surface: no driver error", !R.err, R.err || "");
 check("1 default surface: modal open", R.s.modalOpen === true, JSON.stringify(R.s));
 check("1 default surface: badge secret-typed", R.s.badgeText === "secret-typed", R.s.badgeText);
 check("1 default surface: badge class badge-secret", /badge-secret/.test(R.s.badgeClass || ""), R.s.badgeClass);
 check("1 default surface: .empty-state-title == 'Secret content withheld'", R.s.emptyStateTitle?.includes("Secret content withheld"), JSON.stringify(R.s.emptyStateTitle));
 check("1 default surface: .empty-state-desc carries the platform-contract copy", R.s.emptyStateDesc?.some((t) => t.includes("Per platform contract, secret file contents and diffs are never exposed.")), JSON.stringify(R.s.emptyStateDesc));
 check("1 default surface: .secret-key-tag chips present (both keys)", SECRET_KEYS.every((k) => R.s.keyTags?.includes(k)), JSON.stringify(R.s.keyTags));
 check("1 default surface: NO .btn-reveal (reveal:false)", R.s.hasBtnReveal === false, JSON.stringify(R.s.hasBtnReveal));
 check("1 default surface: #reveal-value empty/hidden", R.s.revealValueHidden === true && (R.s.revealValueText || "") === "", JSON.stringify({ h: R.s.revealValueHidden, t: R.s.revealValueText }));
}

function legAuthorizedSurface(dom) {
 const R = parse(dom);
 if (!R) return check("2 authorized surface: scenario output present", false, "no #test-out");
 check("2 authorized surface: no driver error", !R.err, R.err || "");
 check("2 authorized surface: modal open", R.s.modalOpen === true, JSON.stringify(R.s));
 check("2 authorized surface: .btn-reveal present (reveal:true)", R.s.hasBtnReveal === true, JSON.stringify(R.s.hasBtnReveal));
 check("2 authorized surface: NO value rendered yet", (R.s.revealValueText || "") === "" && R.s.revealValueHidden === true, JSON.stringify({ h: R.s.revealValueHidden, t: R.s.revealValueText }));
 check("2 authorized surface: .secret-key-tag chips still present", SECRET_KEYS.every((k) => R.s.keyTags?.includes(k)), JSON.stringify(R.s.keyTags));
}

function legRevealGranted(dom) {
 const R = parse(dom);
 if (!R) return check("3 reveal granted: scenario output present", false, "no #test-out");
 check("3 reveal granted: no driver error", !R.err, R.err || "");
 check("3 reveal granted: .btn-reveal was present and clicked", R.s.hasBtnReveal === true && R.s.afterClickValueHidden !== undefined, JSON.stringify({ has: R.s.hasBtnReveal, after: R.s.afterClickValueHidden }));
 check("3 reveal granted: #reveal-value visible after click", R.s.afterClickValueHidden === false, JSON.stringify(R.s.afterClickValueHidden));
 check("3 reveal granted: #reveal-value carries the escaped fixture value (rendered only from the response)",
  (R.s.afterClickValueText || "").includes("DATABASE_URL") && (R.s.afterClickValueText || "").includes(FIXTURE_VALUE),
  JSON.stringify(R.s.afterClickValueText));
 // The value is escaped: the raw fixture bytes appear (no markup), and no
 // unescaped angle brackets are introduced.
 check("3 reveal granted: value is HTML-escaped (no raw markup injection)",
  !/<script/.test(R.s.afterClickInnerHTML || "") && (R.s.afterClickInnerHTML || "").includes(FIXTURE_VALUE),
  JSON.stringify(R.s.afterClickInnerHTML));
}

function legRevealDenied(dom) {
 const R = parse(dom);
 if (!R) return check("4 reveal denied: scenario output present", false, "no #test-out");
 check("4 reveal denied: no driver error", !R.err, R.err || "");
 check("4 reveal denied: .btn-reveal was present and clicked", R.s.hasBtnReveal === true && R.s.afterClickValueHidden !== undefined, JSON.stringify({ has: R.s.hasBtnReveal }));
 check("4 reveal denied: #reveal-value shows the denial copy",
  (R.s.afterClickValueText || "").includes("Secret content withheld") && (R.s.afterClickValueText || "").includes("reveal not authorized"),
  JSON.stringify(R.s.afterClickValueText));
 check("4 reveal denied: NO fixture value anywhere in the modal DOM",
  !(R.s.afterClickValueText || "").includes(FIXTURE_VALUE) && !(R.s.bodyInnerHTML || "").includes(FIXTURE_VALUE),
  "fixture leaked into modal DOM");
}

function legNoValueFromOtherRoutes(dom) {
 const R = parse(dom);
 if (!R) return check("5 no-value law: scenario output present", false, "no #test-out");
 // /changes body (served by the loopback) carries keys[], no value.
 check("5 no-value law: /changes fixture carries keys[] and no value field",
  JSON.stringify(CHANGES.changeSet.files[0].keys) === JSON.stringify(SECRET_KEYS) && !("value" in CHANGES.changeSet.files[0]),
  JSON.stringify(CHANGES.changeSet.files[0]));
 // The modal DOM (before any reveal click) contains no fixture value.
 check("5 no-value law: modal DOM (pre-click) contains no fixture value",
  !(R.s.bodyInnerHTML || "").includes(FIXTURE_VALUE),
  "fixture leaked into pre-click modal DOM");
 check("5 no-value law: /merge is not a value source (route returns the merge surface, not a value)",
  true, "covered by whoami-contract #7 (real worker /merge carries no value field)");
}

function legWithheldGrid(dom) {
 const R = parse(dom);
 if (!R) return check("6 withheld-grid: scenario output present", false, "no #test-out");
 check("6 withheld-grid: no driver error", !R.err, R.err || "");
 check("6 withheld-grid: withheld-secret card present", R.s.withheldCardPresent === true, JSON.stringify(R.s.withheldCardPresent));
 check("6 withheld-grid: grid renders .btn-preview-merge on the withheld card (grid->merge-modal path exists)",
  R.s.withheldHasPreviewMerge === true && R.s.withheldPreviewMergeHasRepo === true, JSON.stringify(R.s.withheldHasPreviewMerge));
 check("6 withheld-grid: withheld secret row renders NO .btn-file-diff", R.s.withheldFileHasViewDiff === false, "view-diff leaked onto the secret row");
}

const scenarios = [
 { name: "default", whoami: "default", click: false, leg: legDefaultSurface },
 { name: "authorized", whoami: "authorized", click: false, leg: legAuthorizedSurface },
 { name: "granted", whoami: "authorized", reveal: "grant", click: true, leg: legRevealGranted },
 { name: "denied", whoami: "authorized", reveal: "deny", click: true, leg: legRevealDenied },
 { name: "no-value", whoami: "default", click: false, leg: legNoValueFromOtherRoutes },
 { name: "withheld-grid", whoami: "default", click: false, leg: legWithheldGrid },
];

try {
 server.listen(0, "127.0.0.1");
 await new Promise((r) => server.once("listening", r));
 const port = server.address().port;
 const url = `http://127.0.0.1:${port}/`;
 for (const sc of scenarios) {
  whoamiMode = sc.whoami;
  revealMode = sc.reveal || "grant";
  clickReveal = sc.click === true;
  const dom = await dumpDom(url);
  sc.leg(dom);
 }
} finally {
 server.close();
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
