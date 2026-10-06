#!/usr/bin/env bun
// Contract suite: first-load summary chips (FR-7 consequence 1 / NFR-8 / UX-DR-4).
// Run: bun porting/tests/ui-first-load-chips.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/index.html + app.js are loaded in a
// real headless Chrome over a loopback origin — the only thing scripted is the
// worker's HTTP surface (a 404 for app.js, a 500, or a payload), never the UI
// itself; no module mocks, no source grep. Three observable contracts:
//   1. cold document (app.js unreachable): the five chips read exactly "—" —
//      the shipped placeholder, standing before any script or payload
//   2. failed first fetch (/proposals -> 500): chips still read "—" AND the
//      connection banner offers "Retry now" (the banner proves app.js ran and
//      took the failure path, so "—" is not an artifact of dead JS)
//   3. first successful payload (/proposals -> fixture): the five chips show
//      that payload's five summary counts, in label order
// A box without a Chrome binary skips the suite (same precedent as
// batch.test.mjs's live-store guard); the order's acceptance gate hard-requires
// Chrome separately.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const EM_DASH = "\u2014";
const CHIPS = ["val-proposals", "val-shared", "val-conflicts", "val-changed", "val-clean"];

// Five DISTINCT counts so a wrong chip/field mapping fails loudly.
const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main" },
  ref: "main",
  summary: { proposals: 4, sharedFiles: 2, conflictingPairs: 1, changedFiles: 7, cleanPairs: 3 },
  proposals: [
    { repo: "agent-1", files: [], stats: {} },
    { repo: "agent-2", files: [], stats: {} },
    { repo: "agent-3", files: [], stats: {} },
    { repo: "agent-4", files: [], stats: {} },
  ],
  conflicts: [{ files: [], pairs: [] }, { files: [], pairs: [] }],
  landing: {},
};
const EXPECTED_COUNTS = ["4", "2", "1", "7", "3"];

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => spawnSync("which", [bin], { encoding: "utf8" }).stdout.trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI first-load chips — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-chips-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

const domValue = (dom, id) => {
  const m = dom.match(new RegExp(`id=${JSON.stringify(id)}[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
};
const chipsOf = (dom) => CHIPS.map((id) => domValue(dom, id));
const bannerVisible = (dom) => !/<div id="connection-banner"[^>]*\shidden(=|\s|>)/.test(dom);

// Loopback worker surface: mode selects what /proposals (and app.js) do.
let mode = "ok";
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    if (mode === "fail") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "fixture-down" }));
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(FIXTURE));
    }
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "judge unavailable in fixture" }));
    return;
  }
  if (mode === "no-js" && pathname === "/app.js") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  // --- 1. cold document: the shipped placeholder, before any script runs ----
  try {
    mode = "no-js";
    const dom = await dumpDom(url);
    const chips = chipsOf(dom);
    check("1 cold document ships em-dash on all five chips", chips.length === 5 && chips.every((v) => v === EM_DASH), JSON.stringify(chips));
    check("1 no script ran yet (banner still hidden)", !bannerVisible(dom));
  } catch (e) {
    check("1 cold-document case threw", false, String(e?.message ?? e));
  }

  // --- 2. failed first fetch: chips stay em-dash, banner offers Retry now ---
  try {
    mode = "fail";
    const dom = await dumpDom(url);
    const chips = chipsOf(dom);
    check("2 chips stay em-dash through a failed first fetch", chips.length === 5 && chips.every((v) => v === EM_DASH), JSON.stringify(chips));
    check("2 failed fetch surfaced (connection banner visible, app.js ran)", bannerVisible(dom));
    check("2 banner offers Retry now", domValue(dom, "connection-banner-retry") === "Retry now", String(domValue(dom, "connection-banner-retry")));
  } catch (e) {
    check("2 failed-first-fetch case threw", false, String(e?.message ?? e));
  }

  // --- 3. first successful payload: chips recompute to the payload counts ---
  try {
    mode = "ok";
    const dom = await dumpDom(url);
    const chips = chipsOf(dom);
    check("3 chips recompute to the payload summary counts", JSON.stringify(chips) === JSON.stringify(EXPECTED_COUNTS), JSON.stringify(chips));
    check("3 no banner on a successful first payload", !bannerVisible(dom));
  } catch (e) {
    check("3 first-successful-payload case threw", false, String(e?.message ?? e));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
