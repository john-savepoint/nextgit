#!/usr/bin/env bun
// Contract suite: tour steps 0-2 teach with core terms and simulations 1-2.
// Run: bun porting/tests/ui-tour-steps.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (tour.html + tour.js + tour.css) is
// served from a loopback origin into real headless Chrome; the only scripted
// pieces are trusted input dispatched over CDP (clicks, a hover). Steps 0-2 make
// no server calls (the step-6 loadRealProposals fetch is caught internally and
// falls back to the offline snapshot), so the loopback server is static-only.
// No module mocks, no source grep, no in-page observer. Legs:
//   S0 step 0 — #step-0.is-active; exactly 4 .term-card (NextGit, Convergence,
//      Proposal, Collision); hover a .glossary-term → nested .glossary-tooltip
//      computed opacity "1" + visibility "visible"
//   S1 step 1 — #step-1.is-active; GitHub default renders 4 .gh-tab; clicking
//      tab [data-sim1-tab="1"] selects PR #102 in .gh-pr-title; #btn-view-fleet
//      renders 4 .fleet-card naming the agent-1/agent-2 collision both ways;
//      #btn-view-github toggles back to the 4-tab GitHub view
//   S2 step 2 — #step-2.is-active; empty state ("No active workspaces");
//      #btn-spawn-workspaces renders 4 .sim2-branch-card (agent-1..4);
//      #btn-reset-workspaces restores the empty state
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible /
// action-banner-states); the order's acceptance gate hard-requires Chrome.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 320; // sim-card enter transitions (translateY/opacity) must finish before reads

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
  console.log("SKIP  UI tour steps 0-2 — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-tour-steps-"));

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const file = join(UI, pathname === "/" ? "tour.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

let chrome = null;
let browser = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal CDP client: one browser websocket, flat sessions, command/response only.
const connectCdp = (wsUrl) =>
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
      if (typeof msg.id !== "number") return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
      else p.res(msg.result);
    });
  });

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking exec
// would deadlock the very fetch the page is waiting on.
const launchChrome = () =>
  new Promise((resolve, reject) => {
    chrome = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1500,1400",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not announce a DevTools endpoint within 30s")), 30000);
    chrome.stderr.on("data", (d) => {
      stderr += d;
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
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

  const evl = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text || "Runtime.evaluate threw");
    return result.value;
  };

  const waitFor = async (expression, timeout = 20000) => {
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

  const navigate = async (path) => {
    const priorOrigin = await evl("performance.timeOrigin");
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitFor(
      `performance.timeOrigin !== ${priorOrigin} && location.pathname === ${JSON.stringify(path)} && document.readyState === "complete"`,
    );
    await send("Page.bringToFront");
  };

  const centerOf = async (sel) =>
    evl(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);

  const clickEl = async (sel) => {
    const pt = await centerOf(sel);
    if (!pt) throw new Error(`clickEl: no element matches ${sel}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(SETTLE_MS);
  };

  const hoverEl = async (sel) => {
    const pt = await centerOf(sel);
    if (!pt) throw new Error(`hoverEl: no element matches ${sel}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, buttons: 0 });
    await sleep(SETTLE_MS);
  };

  // --- S0: step 0 — core term cards + glossary tooltips ----------------------
  try {
    await navigate("/tour.html");
    await waitFor(`document.querySelector("#step-0.is-active") !== null`);
    check("S0 step 0 starts active", (await evl(`document.querySelectorAll("#step-0.is-active").length`)) === 1);

    const termCount = await evl(`document.querySelectorAll(".terms-grid .term-card").length`);
    const termNames = await evl(`Array.from(document.querySelectorAll(".terms-grid .term-card .term-name")).map(n => n.textContent.trim())`);
    check(
      "S0 step 0 renders exactly 4 core term cards: NextGit, Convergence, Proposal, Collision",
      termCount === 4 &&
      JSON.stringify(termNames) === JSON.stringify(["NextGit", "Convergence", "Proposal", "Collision"]),
      `count=${termCount} names=${JSON.stringify(termNames)}`,
    );

    const termsHeading = await evl(`document.querySelector("#step-0 .sim-title")?.textContent.trim() || ""`);
    check(
      "S0 step 0 term heading matches the four cards",
      termsHeading === "Four core terms decoded",
      `heading="${termsHeading}"`,
    );

    const glossaryCount = await evl(`document.querySelectorAll(".glossary-term .glossary-tooltip").length`);
    check("S0 glossary tooltips are present in the DOM (>= 3)", glossaryCount >= 3, `count=${glossaryCount}`);

    // Hover the first .glossary-term; the nested tooltip must become visible.
    await hoverEl(".glossary-term");
    const tooltip = await evl(`(() => {
      const term = document.querySelector(".glossary-term");
      if (!term) return null;
      const tip = term.querySelector(".glossary-tooltip");
      if (!tip) return null;
      const cs = getComputedStyle(tip);
      return { opacity: cs.opacity, visibility: cs.visibility };
    })()`);
    check(
      "S0 hovering a glossary term shows its tooltip (opacity 1, visible)",
      tooltip && tooltip.opacity === "1" && tooltip.visibility === "visible",
      JSON.stringify(tooltip),
    );
  } catch (e) {
    check("S0 step-0 leg threw", false, String(e?.message ?? e));
  }

  // --- S1: step 1 — GitHub ⇄ Fleet toggle, tab selection, collision naming --
  try {
    await clickEl('.step-btn[data-step="1"]');
    await waitFor(`document.querySelector("#step-1.is-active") !== null`);
    check("S1 step 1 activates via the stepper", (await evl(`document.querySelectorAll("#step-1.is-active").length`)) === 1);

    // Default GitHub view: 4 PR tabs.
    const ghCount = await evl(`document.querySelectorAll(".view-github-mode .gh-tab").length`);
    check("S1 sim 1 starts in GitHub view with 4 PR tabs", ghCount === 4, `count=${ghCount}`);

    // Click the second tab (index 1) ⇒ PR #102.
    await clickEl('[data-sim1-tab="1"]');
    const prTitle = await evl(`document.querySelector(".gh-pr-title")?.textContent || ""`);
    check("S1 clicking the second tab selects PR #102", prTitle.includes("#102"), `title=${JSON.stringify(prTitle)}`);

    // Toggle to Fleet view: 4 cards, agent-1/agent-2 collision named both ways.
    await clickEl("#btn-view-fleet");
    const fleetCount = await evl(`document.querySelectorAll(".view-fleet-mode .fleet-card").length`);
    const fleetTexts = await evl(`Array.from(document.querySelectorAll(".view-fleet-mode .fleet-card")).map(c => c.textContent)`);
    check(
      "S1 fleet view renders 4 agent cards",
      fleetCount === 4,
      `count=${fleetCount}`,
    );
    check(
      "S1 fleet view names the agent-1/agent-2 collision both ways",
      fleetTexts[0]?.includes("Collides with agent-2") && fleetTexts[1]?.includes("Collides with agent-1"),
      JSON.stringify(fleetTexts.slice(0, 2)),
    );
    const sim1Expl = await evl(`document.getElementById("sim1-explanation")?.textContent || ""`);
    check("S1 fleet explanation names the Fleet View", sim1Expl.includes("Fleet View"), `text=${JSON.stringify(sim1Expl)}`);

    // Toggle back to GitHub view.
    await clickEl("#btn-view-github");
    const backCount = await evl(`document.querySelectorAll(".view-github-mode .gh-tab").length`);
    check("S1 toggling back restores the GitHub view with 4 PR tabs", backCount === 4, `count=${backCount}`);
  } catch (e) {
    check("S1 step-1 leg threw", false, String(e?.message ?? e));
  }

  // --- S2: step 2 — spawn / reset workspace lifecycle ------------------------
  try {
    await clickEl('.step-btn[data-step="2"]');
    await waitFor(`document.querySelector("#step-2.is-active") !== null`);
    check("S2 step 2 activates via the stepper", (await evl(`document.querySelectorAll("#step-2.is-active").length`)) === 1);

    // Empty state: no spawned branch cards, "No active workspaces" copy.
    const initialCards = await evl(`document.querySelectorAll(".sim2-branch-card").length`);
    const initialText = await evl(`document.getElementById("sim2-branches")?.textContent || ""`);
    check(
      "S2 sim 2 starts with no workspaces and the empty-state copy",
      initialCards === 0 && initialText.includes("No active workspaces"),
      `cards=${initialCards} text=${JSON.stringify(initialText)}`,
    );

    // Spawn: 4 isolated-workspace cards for agent-1..4.
    await clickEl("#btn-spawn-workspaces");
    const spawnedCount = await evl(`document.querySelectorAll(".sim2-branch-card.is-spawned").length`);
    const agentNames = await evl(`Array.from(document.querySelectorAll(".sim2-branch-card .agent-title")).map(n => n.textContent.trim())`);
    check(
      "S2 spawning renders 4 workspace cards for agent-1..4",
      spawnedCount === 4 && JSON.stringify(agentNames) === JSON.stringify(["agent-1", "agent-2", "agent-3", "agent-4"]),
      `count=${spawnedCount} agents=${JSON.stringify(agentNames)}`,
    );
    const sim2Expl = await evl(`document.getElementById("sim2-explanation")?.textContent || ""`);
    check("S2 spawn explanation reports 4 workspaces spawned", sim2Expl.includes("4 workspaces spawned"), `text=${JSON.stringify(sim2Expl)}`);

    // Reset: back to the empty state.
    await clickEl("#btn-reset-workspaces");
    const resetCards = await evl(`document.querySelectorAll(".sim2-branch-card").length`);
    const resetText = await evl(`document.getElementById("sim2-branches")?.textContent || ""`);
    check(
      "S2 reset clears the workspaces back to the empty state",
      resetCards === 0 && resetText.includes("No active workspaces"),
      `cards=${resetCards} text=${JSON.stringify(resetText)}`,
    );
  } catch (e) {
    check("S2 step-2 leg threw", false, String(e?.message ?? e));
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
