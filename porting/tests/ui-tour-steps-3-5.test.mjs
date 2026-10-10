#!/usr/bin/env bun
// Contract suite: interactive tour steps 3-5 — annotated proposal card,
// collision sim (sim-3) and one-click shipping sim (sim-4).
// Run: bun porting/tests/ui-tour-steps-3-5.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/tour.html + tour.js are loaded
// in a REAL headless Chrome over a loopback origin — the only scripted piece
// is the HTTP surface (the page itself is never modified, only a driver
// script is appended; the live /proposals fetch is blocked so the suite is
// hermetic and the step-6 fetch never leaves the box). The real tour.js runs
// unmodified: stepper clicks, region clicks and button clicks all go through
// the shipped event listeners. No module mocks, no source grep, no mock.module.
//
// Contracts (each observable + mutation-provable):
//   1. Step-3 entry: exactly 5 .annotated-region; exactly one .is-inspected
//      and it is data-part=repo; pane badge = "Agent Identity"; title =
//      "Repository & State"
//   2. Step-3 inspection move: click the `actions` region → the .is-inspected
//      set is exactly {actions}; badge = "Action Controls"; title =
//      "Preview & Land Buttons"
//   3. Step-3 keyboard a11y: dispatch Enter on a region → same move as click
//   4. Step-4 entry: sim-3 renders the collision result header
//      "Collision Detected in src/auth.ts (agent-1 x agent-2)" with a
//      .conflict-region hunk (initial state.sim3Attempted = true)
//   5. Step-4 reset: click #btn-sim3-reset → pending copy
//      ("No merge attempted yet") and no .sim3-result-header
//   6. Step-4 ship-both: click #btn-sim3-merge → header + conflict hunk again
//   7. Step-5 entry: #btn-sim4-ship text = "Ship it", enabled; terminal shows
//      the idle copy
//   8. Step-5 ship: click → mid-state "Shipping..." + disabled + 3
//      .terminal-step lines; after settle (past the 900 ms timer) → "Landed",
//      .is-landed on #sim4-card, terminal contains "[OK] Push successful"
//   9. Step-5 reset: click #btn-sim4-reset → "Ship it" restored, .is-landed
//      gone, idle terminal copy restored
//  10. Zero uncaught errors across the whole drive (window.onerror +
//      unhandledrejection listeners)
//
// A box without a Chrome binary skips the suite (precedent:
// ui-card-contract-states.test.mjs); the fleet exports
// CHROME_BIN=porting/tests/chrome-slot.sh for slot-limited concurrency.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
// Driver is appended AFTER tour.js so init() has already run; the driver
// only observes and drives the live DOM.
const SCRIPT_TAG = `<script type="module" src="tour.js"></script>`;

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
  console.log("SKIP  ui-tour-steps-3-5 — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-toursteps-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 30000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 30s"));
    }, 30000);
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
// Driver: appended AFTER tour.js. Drives the REAL tour.js listeners —
// stepper buttons (the shipped delegated handler on #step-indicators),
// annotated regions (the shipped per-region click/keydown handlers) and
// sim buttons — then reads the rendered DOM after every interaction.
// The step-6 live fetch is blocked so the suite stays hermetic; the
// /__abort marker proves the block took effect.
// ---------------------------------------------------------------------------
const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { steps: {}, jsErrors: [], marker: null };
window.addEventListener("error", (e) => R.jsErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => R.jsErrors.push(String(e.reason)));
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const stepBtn = (n) => document.querySelector('.step-btn[data-step="' + n + '"]');
const goStep = async (n) => { stepBtn(n).click(); await sleep(120); };
// Read the step-3 annotation contract from the live DOM.
const readStep3 = () => {
  const regions = qa(".annotated-region");
  const inspected = regions.filter((r) => r.classList.contains("is-inspected"));
  return {
    regionCount: regions.length,
    regionParts: regions.map((r) => r.getAttribute("data-part")),
    inspectedParts: inspected.map((r) => r.getAttribute("data-part")),
    badge: q("#details-pane-badge") ? q("#details-pane-badge").textContent.trim() : null,
    title: q("#details-pane-title") ? q("#details-pane-title").textContent.trim() : null,
  };
};
// Read the sim-3 collision sim state from the live DOM.
const readSim3 = () => ({
  header: q("#sim3-result-container .sim3-result-header") ? q("#sim3-result-container .sim3-result-header").textContent.trim() : null,
  conflictHunks: qa("#sim3-result-container .conflict-region").length,
  hasResult: !!q("#sim3-result-container .sim3-result"),
  pendingCopy: q("#sim3-result-container") ? q("#sim3-result-container").textContent.replace(/\\s+/g, " ").trim() : null,
  explanation: q("#sim3-explanation") ? q("#sim3-explanation").textContent.replace(/\\s+/g, " ").trim() : null,
});
// Read the sim-4 shipping sim state from the live DOM.
const readSim4 = () => ({
  shipLabel: q("#btn-sim4-ship") ? q("#btn-sim4-ship").textContent.trim() : null,
  shipDisabled: q("#btn-sim4-ship") ? q("#btn-sim4-ship").disabled : null,
  terminalText: q("#sim4-terminal") ? q("#sim4-terminal").textContent.replace(/\\s+/g, " ").trim() : null,
  terminalSteps: qa("#sim4-terminal .terminal-step").length,
  cardLanded: q("#sim4-card") ? q("#sim4-card").classList.contains("is-landed") : null,
  explanation: q("#sim4-explanation") ? q("#sim4-explanation").textContent.replace(/\\s+/g, " ").trim() : null,
});
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(500); // tour.js init() has run: sims rendered, step 0 active
    // --- Contract 1: step-3 entry state ---
    await goStep(3);
    R.steps.s3entry = readStep3();
    // --- Contract 2: inspection move via click on the actions region ---
    qa(".annotated-region").find((r) => r.getAttribute("data-part") === "actions").click();
    await sleep(80);
    R.steps.s3ActionsClick = readStep3();
    // --- Contract 3: keyboard move (Enter on the files region) ---
    const filesRegion = qa(".annotated-region").find((r) => r.getAttribute("data-part") === "files");
    filesRegion.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(80);
    R.steps.s3Keyboard = readStep3();
    // --- Contract 4: step-4 entry (collision result on entry) ---
    await goStep(4);
    R.steps.s4entry = readSim3();
    // --- Contract 5: reset ---
    q("#btn-sim3-reset").click();
    await sleep(80);
    R.steps.s4reset = readSim3();
    // --- Contract 6: ship both ---
    q("#btn-sim3-merge").click();
    await sleep(80);
    R.steps.s4shipBoth = readSim3();
    // --- Contract 7: step-5 entry ---
    await goStep(5);
    R.steps.s5entry = readSim4();
    // --- Contract 8: ship (mid-state sampled immediately, then settle) ---
    q("#btn-sim4-ship").click();
    await sleep(60); // inside the 900 ms window → mid-state observable
    R.steps.s5shipMid = readSim4();
    await sleep(1500); // well past the 900 ms setTimeout → landed
    R.steps.s5shipLanded = readSim4();
    // --- Contract 9: reset ---
    q("#btn-sim4-reset").click();
    await sleep(80);
    R.steps.s5reset = readSim4();
    // --- Hermeticity marker: the step-6 live fetch must be blocked ---
    R.marker = window.__proposalsAborted === true ? "aborted" : "not-aborted";
  } catch (e) { R.jsErrors.push("driver: " + String((e && e.stack) || e)); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface
// ---------------------------------------------------------------------------
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript);
    return;
  }
  // Hermeticity: abort the step-6 live-platform fetch (and anything else
  // outbound) so no request leaves the box during the drive.
  if (/^https?:\/\/nextgit-platform\./.test(pathname) || pathname.startsWith("/proposals")) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("offline");
    return;
  }
  const rel = pathname === "/" ? "tour.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "tour.html") {
    res.writeHead(200, { "content-type": "text/html" });
    // The fetch override is installed BEFORE tour.js so the step-6
    // live /proposals fetch (fired inside tour.js init()) is cut
    // before any request leaves the box; the driver runs AFTER
    // tour.js so it observes the already-initialized live DOM.
    const fetchGuard = `<script type="module">
      const origFetch = window.fetch;
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.includes("/proposals")) { window.__proposalsAborted = true; return Promise.reject(new Error("offline")); }
        return origFetch(input, init);
      };
    </script>`;
    res.end(readFileSync(file, "utf8").replace(SCRIPT_TAG, fetchGuard + SCRIPT_TAG + `<script type="module" src="/__client.js"></script>`));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Contract legs — each asserts one observable contract from the plan
// ---------------------------------------------------------------------------
function legStep3Entry(s) {
  check("1. step-3 entry: exactly 5 annotated regions", s.regionCount === 5, `regionCount=${s.regionCount} parts=${JSON.stringify(s.regionParts)}`);
  check("1. step-3 entry: regions are repo,intent,stats,files,actions", JSON.stringify(s.regionParts) === JSON.stringify(["repo", "intent", "stats", "files", "actions"]), JSON.stringify(s.regionParts));
  check("1. step-3 entry: exactly one .is-inspected and it is repo", s.inspectedParts.length === 1 && s.inspectedParts[0] === "repo", `inspected=${JSON.stringify(s.inspectedParts)}`);
  check("1. step-3 entry: pane badge = Agent Identity", s.badge === "Agent Identity", `badge=${JSON.stringify(s.badge)}`);
  check("1. step-3 entry: pane title = Repository & State", s.title === "Repository & State", `title=${JSON.stringify(s.title)}`);
}

function legStep3ActionsClick(s) {
  check("2. step-3 click actions: inspected set is exactly {actions}", JSON.stringify(s.inspectedParts) === JSON.stringify(["actions"]), `inspected=${JSON.stringify(s.inspectedParts)}`);
  check("2. step-3 click actions: badge = Action Controls", s.badge === "Action Controls", `badge=${JSON.stringify(s.badge)}`);
  check("2. step-3 click actions: title = Preview & Land Buttons", s.title === "Preview & Land Buttons", `title=${JSON.stringify(s.title)}`);
}

function legStep3Keyboard(s) {
  check("3. step-3 keyboard Enter on files: inspected set is exactly {files}", JSON.stringify(s.inspectedParts) === JSON.stringify(["files"]), `inspected=${JSON.stringify(s.inspectedParts)}`);
  check("3. step-3 keyboard Enter on files: badge = File Manifest", s.badge === "File Manifest", `badge=${JSON.stringify(s.badge)}`);
  check("3. step-3 keyboard Enter on files: title = Modified File List", s.title === "Modified File List", `title=${JSON.stringify(s.title)}`);
}

function legStep4Entry(s) {
  check("4. step-4 entry: collision header text", s.header === "Collision Detected in src/auth.ts (agent-1 x agent-2)", `header=${JSON.stringify(s.header)}`);
  check("4. step-4 entry: one .conflict-region hunk", s.conflictHunks === 1, `conflictHunks=${s.conflictHunks}`);
  check("4. step-4 entry: .sim3-result present", s.hasResult === true, `hasResult=${s.hasResult}`);
}

function legStep4Reset(s) {
  check("5. step-4 reset: pending copy 'No merge attempted yet'", (s.pendingCopy || "").includes("No merge attempted yet"), `pendingCopy=${JSON.stringify(s.pendingCopy)}`);
  check("5. step-4 reset: no .sim3-result-header", s.header === null, `header=${JSON.stringify(s.header)}`);
  check("5. step-4 reset: no .conflict-region", s.conflictHunks === 0, `conflictHunks=${s.conflictHunks}`);
}

function legStep4ShipBoth(s) {
  check("6. step-4 ship both: collision header restored", s.header === "Collision Detected in src/auth.ts (agent-1 x agent-2)", `header=${JSON.stringify(s.header)}`);
  check("6. step-4 ship both: conflict hunk restored", s.conflictHunks === 1, `conflictHunks=${s.conflictHunks}`);
  check("6. step-4 ship both: explanation says caught before merge", (s.explanation || "").includes("Collision caught before merge"), `explanation=${JSON.stringify(s.explanation)}`);
}

function legStep5Entry(s) {
  check("7. step-5 entry: ship button label = Ship it", s.shipLabel === "Ship it", `shipLabel=${JSON.stringify(s.shipLabel)}`);
  check("7. step-5 entry: ship button enabled", s.shipDisabled === false, `shipDisabled=${s.shipDisabled}`);
  check("7. step-5 entry: terminal idle copy", (s.terminalText || "").includes("Ready to ship agent-4 into demo:main. No conflicts detected."), `terminalText=${JSON.stringify(s.terminalText)}`);
  check("7. step-5 entry: card not .is-landed", s.cardLanded === false, `cardLanded=${s.cardLanded}`);
}

function legStep5Ship(s5Mid, s5Landed) {
  check("8. step-5 ship mid: label = Shipping...", s5Mid.shipLabel === "Shipping...", `shipLabel=${JSON.stringify(s5Mid.shipLabel)}`);
  check("8. step-5 ship mid: button disabled", s5Mid.shipDisabled === true, `shipDisabled=${s5Mid.shipDisabled}`);
  check("8. step-5 ship mid: 3 .terminal-step lines", s5Mid.terminalSteps === 3, `terminalSteps=${s5Mid.terminalSteps}`);
  check("8. step-5 ship mid: terminal shows POST /land", (s5Mid.terminalText || "").includes("POST /land"), `terminalText=${JSON.stringify(s5Mid.terminalText)}`);
  check("8. step-5 ship settled: label = Landed", s5Landed.shipLabel === "Landed", `shipLabel=${JSON.stringify(s5Landed.shipLabel)}`);
  check("8. step-5 ship settled: #sim4-card.is-landed", s5Landed.cardLanded === true, `cardLanded=${s5Landed.cardLanded}`);
  check("8. step-5 ship settled: terminal has [OK] Push successful", (s5Landed.terminalText || "").includes("[OK] Push successful"), `terminalText=${JSON.stringify(s5Landed.terminalText)}`);
  check("8. step-5 ship settled: terminal has [OK] Commit: e7f8a12 landed.", (s5Landed.terminalText || "").includes("[OK] Commit: e7f8a12 landed."), `terminalText=${JSON.stringify(s5Landed.terminalText)}`);
  check("8. step-5 ship settled: explanation says Landed!", (s5Landed.explanation || "").includes("Landed!"), `explanation=${JSON.stringify(s5Landed.explanation)}`);
}

function legStep5Reset(s) {
  check("9. step-5 reset: ship label restored to Ship it", s.shipLabel === "Ship it", `shipLabel=${JSON.stringify(s.shipLabel)}`);
  check("9. step-5 reset: ship button re-enabled", s.shipDisabled === false, `shipDisabled=${s.shipDisabled}`);
  check("9. step-5 reset: .is-landed removed", s.cardLanded === false, `cardLanded=${s.cardLanded}`);
  check("9. step-5 reset: idle terminal copy restored", (s.terminalText || "").includes("Ready to ship agent-4 into demo:main. No conflicts detected."), `terminalText=${JSON.stringify(s.terminalText)}`);
}

function legNoErrors(R) {
  check("10. zero uncaught errors across the drive", Array.isArray(R.jsErrors) && R.jsErrors.length === 0, `jsErrors=${JSON.stringify(R.jsErrors)}`);
}
try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  const dom = await dumpDom(url);
  const R = parse(dom);
  if (!R) {
    check("harness emitted #test-out", false, "driver script did not run; domTail=" + dom.slice(-400));
  } else {
    legStep3Entry(R.steps.s3entry || {});
    legStep3ActionsClick(R.steps.s3ActionsClick || {});
    legStep3Keyboard(R.steps.s3Keyboard || {});
    legStep4Entry(R.steps.s4entry || {});
    legStep4Reset(R.steps.s4reset || {});
    legStep4ShipBoth(R.steps.s4shipBoth || {});
    legStep5Entry(R.steps.s5entry || {});
    legStep5Ship(R.steps.s5shipMid || {}, R.steps.s5shipLanded || {});
    legStep5Reset(R.steps.s5reset || {});
    legNoErrors(R);
    // Hermeticity self-check: the live /proposals fetch was intercepted.
    check("hermetic: step-6 live /proposals fetch was blocked in-page", R.marker === "aborted", `marker=${JSON.stringify(R.marker)}`);
  }
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
