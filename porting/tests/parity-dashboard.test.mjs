#!/usr/bin/env bun
// Contract suite: parity dashboard render (nextgit-capability-parity-vs-github).
// Run: bun porting/tests/parity-dashboard.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/parity.html + parity.js +
// parity-data.js are loaded in a real headless Chrome over a loopback
// origin — no module mocks, no source grep. The only scripted thing is
// the HTTP surface (a static file server for platform/ui/), never the
// page itself. Four observable contracts:
//   1. the document renders all 18 dimension rows
//   2. exactly 7 rows carry the verdict-below class (the plan's
//      below-baseline set)
//   3. the summary chips read 5 exceeds / 6 parity / 7 below
//   4. XSS probe: a temp data module whose dimension name is
//      `<img src=x onerror=...>` renders ESCAPED — no live `onerror`
//      attribute in the DOM (every cell is inserted via textContent)
// A box without a Chrome binary skips the suite (same precedent as
// ui-first-load-panels.test.mjs).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  parity dashboard — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "parity-dash-"));

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
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// Loopback static server for platform/ui/ (the ?probe=1 seam needs
// nothing to settle: parity.js renders synchronously once the module
// loads — no timers on the page).
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const file = join(UI, pathname === "/" ? "parity.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

// The XSS probe: a temp copy of the UI dir whose parity-data.js
// carries a hostile dimension name. The page must render it escaped.
const XSS_DIMENSION = `<img src=x onerror=window.__pwned=1>`;
const xssServer = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  // Serve the real files, except parity-data.js which is replaced by
  // the hostile-injection fixture (one dimension, XSS payload as the
  // dimension name).
  if (pathname === "/parity-data.js") {
    const table = {
      generated: "2026-01-01T00:00:00Z",
      dimensions: [
        { id: "xss-probe", dimension: XSS_DIMENSION, github: { status: "shipped", evidence: "e", sources: ["s"] }, nextgit: { status: "none", evidence: "e", sources: ["s"] }, verdict: "below" },
      ],
    };
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(`export const PARITY_TABLE = ${JSON.stringify(table)};`);
    return;
  }
  const file = join(UI, pathname === "/" ? "parity.html" : pathname);
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
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const xssPort = await new Promise((resolve, reject) => {
    xssServer.once("error", reject);
    xssServer.listen(0, "127.0.0.1", () => resolve(xssServer.address().port));
  });

  // (1)-(3): the shipped dashboard over the real data module.
  const dom = await dumpDom(`http://127.0.0.1:${port}/parity.html`);
  // Scope the count to the tbody — the thead's header <tr> is not a
  // dimension row.
  const tbody = dom.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rowCount = (tbody.match(/<tr/g) || []).length;
  const belowRows = (tbody.match(/<tr class="verdict-below">/g) || []).length;
  check("1 document renders 18 dimension rows", rowCount === 18, `got ${rowCount}`);
  check("2 exactly 7 rows carry verdict-below", belowRows === 7, `got ${belowRows}`);

  const chip = (id) => {
    const m = dom.match(new RegExp(`id=${JSON.stringify(id)}[^>]*>([^<]*)<`));
    return m ? m[1].trim() : null;
  };
  check("3 summary chip exceeds = 5", chip("chip-exceeds") === "5", chip("chip-exceeds"));
  check("3 summary chip parity = 6", chip("chip-parity") === "6", chip("chip-parity"));
  check("3 summary chip below = 7", chip("chip-below") === "7", chip("chip-below"));

  // (4): XSS probe — the hostile dimension name renders escaped.
  const xssDom = await dumpDom(`http://127.0.0.1:${xssPort}/parity.html`);
  const liveImgWithOnerror = /<img[^>]*\sonerror\s*=/i.test(xssDom);
  // The escaped form is present as text (the payload's angle brackets
  // were entity-encoded, so the raw string appears in the dumped DOM
  // only in its escaped form).
  check("4 XSS payload present as escaped text", xssDom.includes("&lt;img") || xssDom.includes("&lt;"), "escaped dimension text not found");
  // The payload's onerror= appears only as escaped TEXT (the angle
  // brackets were entity-encoded), never as a live attribute — so no
  // <img> element with a real onerror handler exists in the DOM.
  check("4 no live <img onerror=...> element", !liveImgWithOnerror, "a live <img onerror=...> element exists");
} catch (e) {
  check("parity dashboard case threw", false, String(e?.stack ?? e).slice(0, 300));
} finally {
  server.close();
  xssServer.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
