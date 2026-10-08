#!/usr/bin/env bun
// Contract suite: card contract states — withheld-secret and conflict card states render
// through the real browser harness with the shipped platform/ui (index.html + styles.css +
// app.js). Run: bun porting/tests/ui-card-contract-states.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui is loaded in real headless Chrome over a
// loopback origin. The only scripted pieces are the HTTP surface (which fixture /proposals
// serves) and an observer module injected BEFORE app.js that reads the real rendered DOM —
// no product mocks, no source grep.
//
// Fixture: 3 proposal cards:
//   agent-withheld — landing.status=withheld-secret, config/.env secret file
//   agent-conflict — landing.status=conflict, src/auth.ts
//   agent-ready    — landing.status=ready, README.md
//
// Checks:
//   1. withheld-secret card renders amber blocked state, disabled Land, schema-only secret rows
//   2. conflict card renders red state, disabled Land, preview-merge still works
//   3. ready card unchanged
//   4. disabled Land buttons are inert (no data-action)
//   5. card class exclusivity (only one state class per card)
// A box without a Chrome binary skips the suite (precedent: ui-diff-viewer-states).

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
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  ui-card-contract-states — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-cardstate-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 10000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 10s"));
    }, 10000);
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
// Fixture data: 3 proposal cards with different landing statuses
// ---------------------------------------------------------------------------

const PROPOSALS = {
  ok: true,
  base: { repo: "demo", ref: "main", head: "1a".repeat(20) },
  ref: "main",
  summary: { proposals: 3, sharedFiles: 0, conflictingPairs: 0, changedFiles: 3, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-withheld",
      head: "2b".repeat(20),
      intent: "add secret config",
      landing: { status: "withheld-secret", files: 1 },
      stats: { files: 1, additions: 3, deletions: 0 },
      files: [
        { path: "config/.env", status: "modified", additions: 3, deletions: 0, secret: true, keys: ["DATABASE_URL"] },
      ],
    },
    {
      repo: "agent-conflict",
      head: "3c".repeat(20),
      intent: "harden auth flow",
      landing: { status: "conflict", files: 1 },
      stats: { files: 1, additions: 12, deletions: 3 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 12, deletions: 3, secret: false },
      ],
    },
    {
      repo: "agent-ready",
      head: "4d".repeat(20),
      intent: "update docs",
      landing: { status: "ready", files: 1 },
      stats: { files: 1, additions: 6, deletions: 0 },
      files: [
        { path: "README.md", status: "modified", additions: 6, deletions: 0, secret: false },
      ],
    },
  ],
  conflicts: [],
};

const EVENTS = { ok: true, events: [] };
const JUDGE = { ok: true, judgments: [], skipped: [] };

// ---------------------------------------------------------------------------
// Observer/driver: injected BEFORE app.js. Waits for the card grid to render,
// then reads the real rendered DOM for each card's state class, action buttons,
// and file rows. Emits #test-out with structured observations.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { cards: {}, err: null };
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const readCard = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  return {
    class: c.className || "",
    hasWithheldSecret: c.classList.contains("is-withheld-secret"),
    hasConflict: c.classList.contains("is-conflict"),
    hasLanded: c.classList.contains("is-landed"),
    // Action buttons inside the card
    startLandBtn: !!c.querySelector('[data-action="start-land"]'),
    previewMergeBtnHasRepo: c.querySelector(".btn-preview-merge") ? c.querySelector(".btn-preview-merge").hasAttribute("data-repo") : false,
    confirmLandBtn: c.querySelector('[data-action="confirm-land"]'),
    disabledLandBtn: !!c.querySelector(".btn-land[disabled]"),
    disabledLandBtnText: c.querySelector(".btn-land[disabled]") ? c.querySelector(".btn-land[disabled]").textContent.trim() : null,
    disabledLandBtnHasAction: c.querySelector(".btn-land[disabled]") ? c.querySelector(".btn-land[disabled]").hasAttribute("data-action") : false,
    previewMergeBtn: !!c.querySelector(".btn-preview-merge"),
    // Badge text
    badges: [...c.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
    // File rows
    fileRows: [...c.querySelectorAll('.file-row')].map((r) => {
      const pathEl = r.querySelector(".file-path");
      const secretBadge = r.querySelector(".badge-secret");
      const keyTags = r.querySelectorAll(".secret-key-tag");
      const diffBtn = r.querySelector(".btn-file-diff");
      return {
        path: pathEl ? pathEl.textContent.trim() : null,
        isSecretBadge: secretBadge ? secretBadge.textContent.trim() : null,
        keyCount: keyTags.length,
        hasViewDiff: !!diffBtn,
        keyTexts: [...keyTags].map((k) => k.textContent.trim()),
      };
    }),
  };
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    R.cards["agent-withheld"] = readCard("agent-withheld");
    R.cards["agent-conflict"] = readCard("agent-conflict");
    R.cards["agent-ready"] = readCard("agent-ready");
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
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

function legWithheld(dom) {
  const R = parse(dom);
  if (!R) return check("1 withheld: scenario output present", false, "no #test-out");
  if (R.err) return check("1 withheld: scenario threw", false, R.err);

  const c = R.cards["agent-withheld"];
  if (!c) return check("1 withheld: card present", false, "card not found");

  check("1 withheld: card present", true);
  check("1 withheld: is-withheld-secret class", c.hasWithheldSecret === true, `classes=${c.class}`);
  check("1 withheld: no is-conflict class", c.hasConflict === false);
  check("1 withheld: no is-landed class", c.hasLanded === false);
  check("1 withheld: disabled Land button present", c.disabledLandBtn === true);
  check("1 withheld: disabled Land text mentions withheld-secret file",
    c.disabledLandBtnText && c.disabledLandBtnText.includes("withheld-secret file — landing blocked"),
    c.disabledLandBtnText || "none");
  check("1 withheld: no actionable land (no data-action=start-land)",
    c.hasWithheldSecret && !c.startLandBtn);
  check("1 withheld: secret file row has secret-typed badge",
    c.fileRows.length > 0 && c.fileRows[0].isSecretBadge === "secret-typed",
    JSON.stringify(c.fileRows));
  check("1 withheld: secret file row has key chips",
    c.fileRows.length > 0 && c.fileRows[0].keyCount === 1 && c.fileRows[0].keyTexts[0] === "DATABASE_URL",
    JSON.stringify(c.fileRows[0]?.keyTexts));
  check("1 withheld: secret file row has NO view-diff button",
    c.fileRows.length > 0 && c.fileRows[0].hasViewDiff === false);
}

function legConflict(dom) {
  const R = parse(dom);
  if (!R) return check("2 conflict: scenario output present", false, "no #test-out");
  if (R.err) return check("2 conflict: scenario threw", false, R.err);

  const c = R.cards["agent-conflict"];
  if (!c) return check("2 conflict: card present", false, "card not found");

  check("2 conflict: card present", true);
  check("2 conflict: is-conflict class", c.hasConflict === true, `classes=${c.class}`);
  check("2 conflict: no is-withheld-secret class", c.hasWithheldSecret === false);
  check("2 conflict: no is-landed class", c.hasLanded === false);
  check("2 conflict: disabled Land button present", c.disabledLandBtn === true);
  check("2 conflict: disabled Land text mentions preview merge first",
    c.disabledLandBtnText && c.disabledLandBtnText.includes("preview merge first"),
    c.disabledLandBtnText || "none");
  check("2 conflict: preview-merge button still present and actionable",
    c.previewMergeBtn === true && c.previewMergeBtnHasRepo === true);
  check("2 conflict: no actionable land (no data-action=start-land)",
    c.startLandBtn === false);
}

function legReady(dom) {
  const R = parse(dom);
  if (!R) return check("3 ready: scenario output present", false, "no #test-out");
  if (R.err) return check("3 ready: scenario threw", false, R.err);

  const c = R.cards["agent-ready"];
  if (!c) return check("3 ready: card present", false, "card not found");

  check("3 ready: card present", true);
  check("3 ready: no is-withheld-secret class", c.hasWithheldSecret === false);
  check("3 ready: no is-conflict class", c.hasConflict === false);
  check("3 ready: no is-landed class", c.hasLanded === false);
  check("3 ready: actionable start-land button present",
    c.startLandBtn === true);
  check("3 ready: preview-merge button present",
    c.previewMergeBtn === true && c.previewMergeBtnHasRepo === true);
  check("3 ready: no disabled land button", c.disabledLandBtn === false);
}

function legDisabledInertness(dom) {
  const R = parse(dom);
  if (!R) return check("4 inert: scenario output present", false, "no #test-out");
  if (R.err) return check("4 inert: scenario threw", false, R.err);

  const w = R.cards["agent-withheld"];
  const c = R.cards["agent-conflict"];
  if (!w || !c) return check("4 inert: cards present", false, "missing cards");

  check("4 inert: withheld card has no [data-action] on disabled land",
    w.disabledLandBtn === true && w.disabledLandBtnHasAction === false);
  check("4 inert: conflict card has no [data-action] on disabled land",
    c.disabledLandBtn === true && c.disabledLandBtnHasAction === false);
}

function legClassExclusivity(dom) {
  const R = parse(dom);
  if (!R) return check("5 exclusivity: scenario output present", false, "no #test-out");
  if (R.err) return check("5 exclusivity: scenario threw", false, R.err);

  const w = R.cards["agent-withheld"];
  const c = R.cards["agent-conflict"];
  const r = R.cards["agent-ready"];
  if (!w || !c || !r) return check("5 exclusivity: cards present", false, "missing cards");

  // Count how many state classes each card has
  const stateClasses = (cls) => {
    const states = ["is-landed", "is-withheld-secret", "is-conflict"];
    return states.filter((s) => cls.includes(s)).length;
  };

  check("5 exclusivity: withheld card has exactly 1 state class", stateClasses(w.class) === 1, `classes=${w.class}`);
  check("5 exclusivity: conflict card has exactly 1 state class", stateClasses(c.class) === 1, `classes=${c.class}`);
  check("5 exclusivity: ready card has 0 state classes", stateClasses(r.class) === 0, `classes=${r.class}`);
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  const dom = await dumpDom(url);
  legWithheld(dom);
  legConflict(dom);
  legReady(dom);
  legDisabledInertness(dom);
  legClassExclusivity(dom);
} catch (e) {
  check("harness setup failed", false, String(e?.message ?? e));
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 1000);
    server.close(() => { clearTimeout(t); resolve(); });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
