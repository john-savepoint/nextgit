#!/usr/bin/env node
// capture-rig/capture.mjs — real captures of the live NextGit platform.
//
// Produces the video's featured assets ("the real UI reads as proof"):
//   2x DPR pass — page heroes, sections, modals, files/history/parity/tour states
//   3x DPR pass — component macros (one card / rail row / pipeline row / reveal)
//
// Read-only against the platform. Canonical demo state (demo-verify PASS 25/25):
//   proposals=5, conflict pair agent-1 x agent-2 on src/auth.ts,
//   agent-5 withheld-secret (reveal is repo-scoped; POST /reveal is the
//   audited demo action beat 5 sanctions).
//
// Usage:  node capture-rig/capture.mjs
// Output: assets/screens/*.png + capture-rig/rig-manifest.json

import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "assets");
const RIG = join(ROOT, "capture-rig");
const BASE = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";
const CSS_W = 1440;
const CSS_H = 900;
const DPR = 2;
const DPR3 = 3;

mkdirSync(OUT, { recursive: true });
mkdirSync(RIG, { recursive: true });

const manifest = [];
const warnings = [];

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function waitFor(page, selector, ms = 90000, critical = false, state = "visible") {
  try {
    await page.waitForSelector(selector, { state, timeout: ms });
    return true;
  } catch {
    const msg = `wait failed: ${selector} @ ${page.url()}`;
    warnings.push(msg);
    console.warn(`[warn] ${msg}`);
    if (critical) throw new Error(msg);
    return false;
  }
}

async function shot(page, name, opts = {}) {
  const { selector = null, fullPage = false, settle = 350 } = opts;
  try {
    await page.evaluate(() => document.fonts.ready);
  } catch { }
  if (settle) await page.waitForTimeout(settle);
  let target = page;
  let box = null;
  if (selector) {
    target = page.locator(selector).first();
    try {
      box = await target.boundingBox();
    } catch { }
  }
  const buf = await target.screenshot({ type: "png", fullPage: selector ? false : fullPage });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, buf);
  const { width, height } = pngSize(buf);
  const scaleBase = box && box.width ? box.width : CSS_W;
  manifest.push({
    name,
    rel: `assets/${name}.png`,
    url: page.url(),
    selector,
    fullPage: selector ? false : fullPage,
    cssBox: box,
    dpr: Math.round(width / scaleBase),
    px: { width, height },
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  });
  console.log(`[shot] ${name}  ${width}x${height}  ${(buf.length / 1024).toFixed(0)}KB`);
}

// ---------------------------------------------------------------- triage

async function openTriage(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, "#proposals-grid .proposal-card", 120000, true);
  await waitFor(page, "#conflicts-list .conflict-card", 90000);
  await waitFor(page, "#forks-list .fork-card", 90000);
  await waitFor(page, "#judge-comparison-list .judge-comparison-row", 90000);
  await waitFor(page, "#pipelines-list .pipeline-row", 90000);
  await waitFor(page, "#rail-list .rail-row", 90000);
  // NOTE: /issues currently exceeds the UI's own 20s fetchJson timeout (26-29s
  // observed) so the panel renders "Issues unavailable." — captured as-is.
  // Stop the 8s poller so element handles stay stable through the set.
  await page.uncheck("#auto-refresh-toggle").catch(() => { });
  await page.waitForTimeout(600);
}

async function captureTriage(page) {
  const audit = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const un = (s) => Boolean(document.querySelector(s));
    return {
      proposalCards: q("#proposals-grid .proposal-card"),
      conflictCards: q("#conflicts-list .conflict-card"),
      forkCards: q("#forks-list .fork-card"),
      judgeRows: q("#judge-comparison-list .judge-comparison-row"),
      pipelineRows: q("#pipelines-list .pipeline-row"),
      railRows: q("#rail-list .rail-row"),
      issuesRows: q("#issues-list .issue-row"),
      issuesUnavailable: un(".issues-unavailable"),
      sessionsEmpty: un(".sessions-empty"),
      forksUnavailable: un(".forks-unavailable"),
    };
  });
  console.log("[audit]", JSON.stringify(audit));
  manifest.push({ name: "_audit_triage", kind: "audit", url: page.url(), audit });
  await shot(page, "triage-viewport");
  await shot(page, "triage-full", { fullPage: true, settle: 800 });
  await shot(page, "sec-header", { selector: ".app-header" });
  await shot(page, "sec-ticker", { selector: "#ticker-section" });
  await shot(page, "sec-conflicts", { selector: "#conflicts-section" });
  await shot(page, "sec-proposals", { selector: "#proposals-section" });
  await shot(page, "sec-card-agent1", { selector: "#card-agent-1" });
  await shot(page, "sec-card-agent5", { selector: "#card-agent-5" });
  await shot(page, "sec-forks", { selector: "#forks-section" });
  await shot(page, "sec-issues", { selector: "#issues-section" });
  await shot(page, "sec-judge", { selector: "#judge-comparison-section" });
  await shot(page, "sec-pipelines", { selector: "#pipelines-section" });
  await shot(page, "sec-rail", { selector: "#rail-section" });
  await shot(page, "sec-sessions-empty", { selector: "#sessions-section" });
}

async function closeModal(page) {
  await page.click("#btn-close-modal", { timeout: 4000 }).catch(async () => {
    await page.keyboard.press("Escape").catch(() => { });
  });
  await page.waitForTimeout(400);
}

async function captureMergeModals(page) {
  // (a) clean — solo agent-1
  await page.click("#card-agent-1 .btn-preview-merge");
  await waitFor(page, "#inspector-modal .merge-status-bar", 120000, true);
  await waitFor(page, "#inspector-modal .comment-item", 60000);
  await page.waitForTimeout(500);
  await shot(page, "modal-merge-clean", { selector: "#inspector-modal .modal-window" });
  await shot(page, "modal-comments", { selector: "#inspector-modal [data-comment-thread]" });
  await closeModal(page);

  // (b) conflict — the deliberate pair. The UI's own delegated handler is
  // driven by a synthetic trigger carrying the pair, so the modal is the
  // app's real render of the real /merge?repos=agent-1,agent-2 payload.
  await page.evaluate(() => {
    const grid = document.getElementById("proposals-grid");
    const b = document.createElement("button");
    b.className = "btn-preview-merge";
    b.setAttribute("data-repo", "agent-1,agent-2");
    grid.appendChild(b);
    b.click();
    b.remove();
  });
  await waitFor(page, "#inspector-modal .merge-pane.has-conflict", 120000, true);
  await page.waitForTimeout(500);
  await shot(page, "modal-merge-conflict", { selector: "#inspector-modal .modal-window" });
  await shot(page, "modal-conflict-pane", { selector: "#inspector-modal .merge-pane.has-conflict" });
  await closeModal(page);
}

// ---------------------------------------------------------------- files

async function captureFiles(page) {
  // The files page has no client retry: a boot fetch (loadRepos) lost to a
  // transient connect failure leaves the picker at "loading…" forever.
  // Reload re-runs loadRepos — retry the goto + picker wait as a pair.
  let ready = false;
  for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
    await page.goto(`${BASE}/files.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
    ready = await waitFor(page, '#repo-picker option[value="agent-5"]', attempt === 1 ? 45000 : 60000, false, "attached");
    if (!ready) console.warn(`[warn] files picker not ready — reload ${attempt}/3`);
  }
  if (!ready) throw new Error("files picker never populated after 3 attempts");

  // agent-5 — the secret-class surface + the audited, repo-scoped reveal.
  await page.selectOption("#repo-picker", "agent-5");
  await waitFor(page, "#file-tree .files-row", 90000);
  await page.waitForTimeout(300);
  await shot(page, "files-agent5-view", { selector: "main" });
  await page.click('#file-tree .files-dir:has-text("config")');
  await waitFor(page, '#file-tree .files-row:has-text(".env")', 90000);
  await page.click('#file-tree .files-row:has-text(".env")');
  await waitFor(page, "#file-viewer:not([hidden])", 90000);
  await waitFor(page, "#file-viewer .btn-reveal", 60000);
  await shot(page, "files-agent5-env-secret", { selector: "#file-viewer" });
  await page.click("#file-viewer .btn-reveal");
  await waitFor(page, "#reveal-value:not([hidden])", 60000, true);
  await page.waitForTimeout(400);
  await shot(page, "files-agent5-env-revealed", { selector: "#file-viewer" });

  // agent-1 — an ordinary text file in an agent workspace.
  await page.selectOption("#repo-picker", "agent-1");
  await waitFor(page, "#file-tree .files-row", 90000);
  await page.click('#file-tree .files-dir:has-text("src")');
  await waitFor(page, '#file-tree .files-row:has-text("auth.ts")', 90000);
  await page.click('#file-tree .files-row:has-text("auth.ts")');
  await waitFor(page, "#file-viewer:not([hidden])", 90000);
  await page.waitForTimeout(300);
  await shot(page, "files-agent1-auth", { selector: "#file-viewer" });
  await shot(page, "files-agent1-view", { selector: "main" });
}

// ---------------------------------------------------------------- history

async function captureHistory(page, headSha) {
  const ref = headSha ? `&ref=${headSha}` : "";
  await page.goto(`${BASE}/history.html?repo=agent-1${ref}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, "#commit-list a", 120000, true);
  if (headSha) await waitFor(page, "#commit-detail:not([hidden])", 90000);
  await page.waitForTimeout(400);
  await shot(page, "history-viewport");
  await shot(page, "history-detail", { selector: "#commit-detail" });
}

// ---------------------------------------------------------------- parity

async function captureParity(page) {
  await page.goto(`${BASE}/parity.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot(page, "parity-viewport");
  await shot(page, "parity-full", { fullPage: true, settle: 800 });
}

// ---------------------------------------------------------------- tour

async function captureTour(page) {
  await page.goto(`${BASE}/tour.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, "#step-indicators .step-btn", 120000, true);
  await page.waitForTimeout(800);
  await shot(page, "tour-step-01");
  for (const [idx, name] of [
    [3, "tour-step-04"],
    [6, "tour-step-07-live"],
    [8, "tour-step-09"],
  ]) {
    await page.click(`.step-btn[data-step="${idx}"]`).catch(() => { });
    if (idx === 6) {
      await page
        .waitForFunction(() => (document.getElementById("live-status")?.textContent || "").includes("Live connection"), { timeout: 90000 })
        .catch(() => warnings.push("tour live-connection status not observed"));
    }
    await page.waitForTimeout(1400);
    await shot(page, name);
  }
}

// ---------------------------------------------------------------- macros

async function captureMacros(p3) {
  await openTriage(p3);
  await shot(p3, "macro-card-agent1", { selector: "#card-agent-1" });
  await shot(p3, "macro-rail-agent1", { selector: "#rail-agent-1" });
  await shot(p3, "macro-pipeline-row", { selector: "#pipelines-list .pipeline-row" });
  await shot(p3, "macro-judge-row", { selector: "#judge-comparison-list .judge-comparison-row" });
  await shot(p3, "macro-fork-agent5", { selector: "#fork-agent-5" });

  await p3.goto(`${BASE}/files.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(p3, '#repo-picker option[value="agent-5"]', 120000, true, "attached");
  await p3.selectOption("#repo-picker", "agent-5");
  await waitFor(p3, "#file-tree .files-row", 90000);
  await p3.click('#file-tree .files-dir:has-text("config")');
  await waitFor(p3, '#file-tree .files-row:has-text(".env")', 90000);
  await p3.click('#file-tree .files-row:has-text(".env")');
  await waitFor(p3, "#file-viewer .btn-reveal", 90000);
  await p3.click("#file-viewer .btn-reveal");
  await waitFor(p3, "#reveal-value:not([hidden])", 60000, true);
  await p3.waitForTimeout(400);
  await shot(p3, "macro-env-revealed", { selector: "#file-viewer" });
}

// ---------------------------------------------------------------- main

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: CSS_W, height: CSS_H },
    deviceScaleFactor: DPR,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await openTriage(page);
  const state = await page.evaluate(async () => {
    const r = await fetch("/proposals?base=demo");
    const j = await r.json();
    return {
      ok: !!j.ok,
      base: j.base?.repo ?? null,
      repos: (j.proposals || []).map((p) => p.repo),
      conflicts: (j.conflicts || []).length,
      heads: Object.fromEntries((j.proposals || []).map((p) => [p.repo, p.head])),
    };
  });
  console.log("[state]", JSON.stringify(state));
  if (!(state.ok && state.repos.length >= 5)) warnings.push("demo state check degraded");
  if (!state.conflicts) warnings.push("no conflict pair observed");

  const stage = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      const m = `stage ${name} failed: ${e.message}`;
      warnings.push(m);
      console.warn(`[warn] ${m}`);
    }
  };

  await stage("triage", () => captureTriage(page));
  await stage("modals", () => captureMergeModals(page));
  await stage("files", () => captureFiles(page));
  await stage("history", () => captureHistory(page, state.heads["agent-1"]));
  await stage("parity", () => captureParity(page));
  await stage("tour", () => captureTour(page));

  const ctx3 = await browser.newContext({
    viewport: { width: CSS_W, height: CSS_H },
    deviceScaleFactor: DPR3,
  });
  const p3 = await ctx3.newPage();
  p3.setDefaultTimeout(90000);
  await captureMacros(p3);

  const run = {
    platform: BASE,
    capturedAt: new Date().toISOString(),
    viewport: { width: CSS_W, height: CSS_H },
    dpr: { hero: DPR, macros: DPR3 },
    chromium: browser.version(),
    demoState: state,
    shots: manifest.length,
    warnings,
    consoleErrors,
  };
  writeFileSync(join(RIG, "rig-manifest.json"), JSON.stringify({ run, shots: manifest }, null, 2));
  console.log(`\n[done] ${manifest.length} shots -> assets/screens/`);
  if (warnings.length) console.log(`[warnings] ${warnings.length}`);
  if (consoleErrors.length) console.log(`[console errors] ${consoleErrors.slice(0, 6).join(" | ")}`);
} finally {
  await browser.close();
}
