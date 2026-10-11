#!/usr/bin/env bun
// Contract suite: NFR-9 (contrast-register confinement) — state/content text renders in the
// AA register; --text-muted/--text-dim stay on meta/ambient chrome only; the four token
// values are unchanged. Run: bun porting/tests/ui-contrast-register.test.mjs (exit 0 = pass)
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is loaded in
// real headless Chrome over a loopback origin; the only scripted pieces are the HTTP surface
// and the observer injection, which reads getComputedStyle() of the real rendered elements.
// No mocks, no source grep. Legs: 1 cold statics + meta boundary + token freeze; 2 empty
// states; 3 full payload + real diff clicks (landed banner, diff placeholder, diff meta rows,
// timestamp, pair region); 4 degraded ticker (events 500 → stale pulse). No Chrome → SKIP.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = join(fileURLToPath(new URL("../../", import.meta.url)), "platform/ui");
const APP_TAG = '<script type="module" src="app.js"></script>';
const AA = 4.5;
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const CHROME = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
  .map((b) => String(spawnSync("which", [b], { encoding: "utf8" }).stdout ?? "").trim()).find(Boolean) || process.env.CHROME_BIN || null;
if (!CHROME) { console.log("SKIP  NFR-9 contrast register — no Chrome binary on PATH"); process.exit(0); }
const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-contrast-"));

const dumpDom = (url, budget = 8000) => new Promise((resolve, reject) => {
  const child = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("chrome timed out after 60s")); }, 60000);
  child.stdout.on("data", (d) => (out += d));
  child.on("error", (e) => { clearTimeout(timer); reject(e); });
  child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`chrome exited with ${code}`)); });
});
const parse = (dom) => { const m = dom.match(/id="test-out"[^>]*>([^<]*)</); return m ? JSON.parse(decodeURIComponent(m[1])) : null; };

// WCAG 2.x relative-luminance contrast from computed-style rgb() strings.
const hexToRgb = (hex) => { const h = hex.replace("#", ""); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
const lum = (s) => { const [r, g, b] = s.match(/\d+/g).map(Number); const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (hi + 0.05) / (lo + 0.05); };

const expectCount = (label, arr, n) => check(label, Array.isArray(arr) && arr.length === n, `count=${Array.isArray(arr) ? arr.length : "none"}`);
const register = (label, s, rgb) => { // exact register + AA contrast vs the effective background
  if (!s) return check(`${label} present`, false, "element missing");
  check(`${label} resolves to the secondary register`, s.color === rgb, `color=${s.color} expected=${rgb}`);
  const r = contrast(s.color, s.bg);
  check(`${label} contrast vs its surface >= ${AA}:1`, r >= AA, `${s.color} on ${s.bg} = ${r.toFixed(2)}:1`);
};
const expectColor = (label, s, rgb) => { if (!s) return check(`${label} present`, false, "element missing"); check(label, s.color === rgb, `color=${s.color} expected=${rgb}`); };

const TOKENS = { "--text-primary": "#e6edf3", "--text-secondary": "#8b9bb0", "--text-muted": "#57657a", "--text-dim": "#3d4959" };
const EMPTY = { ok: true, base: { repo: "fixture", ref: "main" }, ref: "main", summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 }, proposals: [], conflicts: [] };
// CONTRACT.md: "patch absent for secret/binary/oversized files" — the patch-less row is the
// contract-legal trigger for .diff-placeholder through the real control; the patched row's
// Index:/---/+++ lines drive .diff-line.line-meta.
const SESSION_PATCH = ["Index: src/session.ts", "--- a/src/session.ts", "+++ b/src/session.ts", "@@ -1,3 +1,3 @@", "-const TTL = 60;", "+const TTL = 300;", " const store = memo();"].join("\n");
const FULL = {
  ok: true, base: { repo: "fixture", ref: "main", head: "1a".repeat(20) }, ref: "main",
  summary: { proposals: 2, sharedFiles: 1, conflictingPairs: 1, changedFiles: 2, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1", head: "2b".repeat(20), landing: { status: "ready" }, stats: { files: 2 },
      files: [{ path: "src/auth.ts", status: "modified" }, { path: "src/session.ts", status: "modified" }]
    },
    {
      repo: "agent-2", head: "3c".repeat(20), landing: { status: "landed", commit: "abc1234" }, stats: { files: 1 },
      files: [{ path: "README.md", status: "modified" }]
    },
  ],
  conflicts: [{
    file: "src/auth.ts", kind: "text-conflict", repos: ["agent-1", "agent-2"],
    pairs: [{ a: "agent-1", b: "agent-2", kind: "text-conflict", region: { baseLines: 2, aLines: 3, bLines: 3 } }]
  }]
};
const EVENTS = { ok: true, events: [{ type: "change", repo: "agent-1", at: "2026-10-07T12:34:56Z" }] };
const CHANGES = {
  ok: true, changeSet: {
    base: { repo: "fixture", ref: "main" }, head: { repo: "agent-1", ref: "main" },
    stats: { files: 2, added: 0, modified: 2, removed: 0, additions: 4, deletions: 1 },
    files: [{ path: "src/auth.ts", status: "modified" }, { path: "src/session.ts", status: "modified", patch: SESSION_PATCH }]
  }
};

// Observer, injected BEFORE app.js. Reads computed styles + the effective background
// (nearest non-transparent ancestor fill) and emits #test-out for --dump-dom.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bgOf = (el) => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b; n = n.parentElement; } return null; };
const read = (el) => (el ? { color: getComputedStyle(el).color, bg: bgOf(el), text: (el.textContent || "").trim().slice(0, 120), cls: el.className } : null);
const reads = (sel) => [...document.querySelectorAll(sel)].map(read);
const vars = {};
for (const k of ["--text-primary", "--text-secondary", "--text-muted", "--text-dim", "--status-amber"]) vars[k] = getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const R = { mode: MODE, vars, s: {} };
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(MODE === "cold" ? 50 : 900);
    if (MODE === "cold") {
      R.s.loading = reads(".loading-indicator"); R.s.chipLabel = reads(".summary-chip .chip-label");
      R.s.sectionMeta = reads(".section-meta"); R.s.tickerEmpty = reads(".ticker-empty"); R.s.footer = read(document.querySelector(".app-footer"));
    } else if (MODE === "empty") {
      R.s.empty = reads(".empty-state"); R.s.emptyTitle = reads(".empty-state-title"); R.s.emptyDesc = reads(".empty-state-desc");
      R.s.tickerEmpty = reads(".ticker-empty"); R.s.sectionMeta = reads(".section-meta");
    } else if (MODE === "degraded") {
      R.s.pulse = read(document.querySelector(".ticker-pulse")); R.s.tickerEmpty = reads(".ticker-empty"); R.s.empty = reads(".empty-state");
    } else {
      R.s.landed = reads(".landed-banner"); R.s.landedSpans = reads(".landed-banner > span");
      R.s.eventTime = reads(".ticker-event .event-time"); R.s.pairRegion = reads(".pair-region");
      R.s.diffButtons = document.querySelectorAll(".btn-file-diff").length;
      const first = document.querySelector('#proposals-grid [data-path="src/auth.ts"]');
      R.s.firstBtn = !!first; if (first) { first.click(); await sleep(700); }
      R.s.placeholder = reads("#inspector-modal .diff-placeholder");
      R.s.modalOpen1 = document.getElementById("inspector-modal").hidden === false;
      const close = document.getElementById("btn-close-modal"); if (close) { close.click(); await sleep(150); }
      const second = document.querySelector('#proposals-grid [data-path="src/session.ts"]');
      R.s.secondBtn = !!second; if (second) { second.click(); await sleep(700); }
      R.s.lineMeta = reads("#inspector-modal .diff-line.line-meta");
      R.s.modalOpen2 = document.getElementById("inspector-modal").hidden === false;
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

function legCold(dom) {
  const R = parse(dom); if (!R) return check("1 cold: scenario output present", false, "no #test-out");
  if (R.err) return check("1 cold: scenario threw", false, R.err);
  const secondary = hexToRgb(R.vars["--text-secondary"]), muted = hexToRgb(R.vars["--text-muted"]), dim = hexToRgb(R.vars["--text-dim"]);
  check("1 loaders: both static panels show the first-load treatment", (R.s.loading || []).length === 2 && R.s.loading.every((x) => (x.text || "").includes("Loading the set from /proposals")), JSON.stringify((R.s.loading || []).map((x) => x.text)));
  (R.s.loading || []).forEach((s, i) => register(`1 loader[${i}]`, s, secondary));
  for (const [k, v] of Object.entries(TOKENS)) check(`1 token ${k} unchanged (${v})`, R.vars[k] === v, `got ${R.vars[k]}`);
  expectCount("1 meta boundary: chip labels rendered x5", R.s.chipLabel, 5);
  (R.s.chipLabel || []).forEach((s, i) => expectColor(`1 chip-label[${i}] stays muted`, s, muted));
  expectCount("1 meta boundary: section metas rendered x2", R.s.sectionMeta, 2);
  (R.s.sectionMeta || []).forEach((s, i) => expectColor(`1 section-meta[${i}] stays muted`, s, muted));
  expectCount("1 meta boundary: ticker empty rendered x1", R.s.tickerEmpty, 1);
  (R.s.tickerEmpty || []).forEach((s, i) => expectColor(`1 ticker-empty[${i}] stays dim`, s, dim));
  check("1 meta boundary: footer rendered", !!R.s.footer, "element missing");
  if (R.s.footer) expectColor("1 footer stays dim", R.s.footer, dim);
}
function legEmpty(dom) {
  const R = parse(dom); if (!R) return check("2 empty: scenario output present", false, "no #test-out");
  if (R.err) return check("2 empty: scenario threw", false, R.err);
  const secondary = hexToRgb(R.vars["--text-secondary"]), muted = hexToRgb(R.vars["--text-muted"]), dim = hexToRgb(R.vars["--text-dim"]);
  expectCount("2 empty: both panels render an empty state", R.s.empty, 2);
  (R.s.empty || []).forEach((s, i) => register(`2 empty[${i}]`, s, secondary));
  expectCount("2 empty: titles rendered x2", R.s.emptyTitle, 2);
  (R.s.emptyTitle || []).forEach((s, i) => register(`2 empty-title[${i}]`, s, secondary));
  expectCount("2 empty: descs rendered x2", R.s.emptyDesc, 2);
  (R.s.emptyDesc || []).forEach((s, i) => register(`2 empty-desc[${i}]`, s, secondary));
  const colors = (R.s.empty || []).map((s) => s.color);
  check("2 empty: none sits in a below-AA register", colors.length === 2 && colors.every((c) => c !== muted && c !== dim), JSON.stringify(colors));
  check("2 meta boundary: section metas stay muted after the payload", (R.s.sectionMeta || []).length === 2 && R.s.sectionMeta.every((s) => s.color === muted), JSON.stringify((R.s.sectionMeta || []).map((s) => s.color)));
  check("2 meta boundary: ticker empty stays dim", (R.s.tickerEmpty || []).length === 1 && R.s.tickerEmpty.every((s) => s.color === dim), JSON.stringify((R.s.tickerEmpty || []).map((s) => s.color)));
}
function legFull(dom) {
  const R = parse(dom); if (!R) return check("3 full: scenario output present", false, "no #test-out");
  if (R.err) return check("3 full: scenario threw", false, R.err);
  const secondary = hexToRgb(R.vars["--text-secondary"]), muted = hexToRgb(R.vars["--text-muted"]);
  expectCount("3 landed banner rendered x1 for the landed proposal", R.s.landed, 1);
  if ((R.s.landed || []).length === 1) { check("3 landed banner shows the landed copy", (R.s.landed[0].text || "").includes("All changes from this branch have been merged into baseline."), JSON.stringify(R.s.landed[0].text)); register("3 landed banner", R.s.landed[0], secondary); }
  expectCount("3 landed banner spans rendered x2", R.s.landedSpans, 2);
  (R.s.landedSpans || []).forEach((s, i) => register(`3 landed span[${i}]`, s, secondary));
  expectCount("3 meta boundary: ticker timestamp rendered x1", R.s.eventTime, 1);
  (R.s.eventTime || []).forEach((s, i) => expectColor(`3 event-time[${i}] stays muted`, s, muted));
  expectCount("3 meta boundary: pair region rendered x1", R.s.pairRegion, 1);
  (R.s.pairRegion || []).forEach((s, i) => expectColor(`3 pair-region[${i}] stays muted`, s, muted));
  check("3 the real view-diff controls rendered x2", R.s.diffButtons === 2, `count=${R.s.diffButtons}`);
  check("3 the real view-diff control opened the modal", R.s.firstBtn === true && R.s.modalOpen1 === true, `btn=${R.s.firstBtn} modal=${R.s.modalOpen1}`);
  check("3 patch-less change-set renders exactly one diff placeholder", (R.s.placeholder || []).length === 1 && (R.s.placeholder[0].text || "").includes("No patch available"), JSON.stringify((R.s.placeholder || []).map((x) => x.text)));
  if ((R.s.placeholder || []).length === 1) register("3 diff placeholder", R.s.placeholder[0], secondary);
  expectCount("3 patched change-set rendered its diff meta rows x3", R.s.lineMeta, 3);
  check("3 the second view-diff control opened the modal", R.s.secondBtn === true && R.s.modalOpen2 === true, `btn=${R.s.secondBtn} modal=${R.s.modalOpen2}`);
  (R.s.lineMeta || []).forEach((s, i) => expectColor(`3 diff line-meta[${i}] stays muted`, s, muted));
}
function legDegraded(dom) {
  const R = parse(dom); if (!R) return check("4 degraded: scenario output present", false, "no #test-out");
  if (R.err) return check("4 degraded: scenario threw", false, R.err);
  const dim = hexToRgb(R.vars["--text-dim"]);
  // FR-22 pulse machine (e4): a down stream carries is-fallback → the amber
  // register; is-stale (dim) is the quiet poll-failure register. This fixture
  // trips both and the cascade resolves to amber — pin the visible register.
  const amber = hexToRgb(R.vars["--status-amber"]);
  check("4 stale pulse rendered (ticker degraded on /events failure)", !!R.s.pulse && String(R.s.pulse.cls || "").includes("is-stale"), JSON.stringify(R.s.pulse));
  if (R.s.pulse) check("4 degraded pulse resolves to the fallback (amber) register", R.s.pulse.bg === amber, `bg=${R.s.pulse.bg} expected=${amber}`);
  expectCount("4 ticker empty rendered x1", R.s.tickerEmpty, 1);
  (R.s.tickerEmpty || []).forEach((s, i) => expectColor(`4 ticker-empty[${i}] stays dim`, s, dim));
  expectCount("4 empty states still render while degraded", R.s.empty, 2);
}

let mode = "cold";
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, mode === "full" ? FULL : EMPTY);
  if (pathname === "/events") return mode === "degraded" ? json(res, { ok: false, error: "fixture" }, 500) : json(res, mode === "full" ? EVENTS : { ok: true, events: [] });
  if (pathname === "/judge") return json(res, { ok: true, judgments: [], skipped: [] });
  if (pathname === "/changes") return json(res, CHANGES);
  if (pathname === "/__client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(clientScript(mode)); return; }
  if (mode === "cold" && pathname === "/app.js") { res.writeHead(404); res.end("not found"); return; }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG)); return; }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});
try {
  const port = await new Promise((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); });
  const url = `http://127.0.0.1:${port}/`;
  try { mode = "cold"; legCold(await dumpDom(url, 4000)); } catch (e) { check("1 cold case threw", false, String(e?.stack ?? e)); }
  try { mode = "empty"; legEmpty(await dumpDom(url)); } catch (e) { check("2 empty case threw", false, String(e?.stack ?? e)); }
  try { mode = "full"; legFull(await dumpDom(url)); } catch (e) { check("3 full case threw", false, String(e?.stack ?? e)); }
  try { mode = "degraded"; legDegraded(await dumpDom(url)); } catch (e) { check("4 degraded case threw", false, String(e?.stack ?? e)); }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => { const t = setTimeout(resolve, 2000); server.close(() => { clearTimeout(t); resolve(); }); });
  rmSync(userDataDir, { recursive: true, force: true });
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
