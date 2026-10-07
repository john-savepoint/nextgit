#!/usr/bin/env bun
// Contract suite: first-load panels loading treatment (FR-7 consequence 2 / NFR-8 / UJ-2).
// Run: bun porting/tests/ui-first-load-panels.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/index.html + app.js are loaded in a
// real headless Chrome over a loopback origin — the only thing scripted is the
// worker's HTTP surface (a 404 for app.js, a 500, an empty payload, or a data
// payload), never the UI itself; no module mocks, no source grep. Four
// observable contracts:
//   1. cold document (app.js unreachable): both panels show exactly
//      "Loading the set from /proposals..." and both section metas read exactly
//      "—" — the shipped treatment, standing before any script or payload
//   2. failed first fetch (/proposals -> 500): the treatment stays in both
//      panels AND the connection banner offers "Retry now" (the banner proves
//      app.js ran and took the failure path, so the treatment is the app's
//      behavior, not an artifact of dead JS)
//   3. first successful payload: the loaders are gone and both panels show the
//      payload (conflict card + proposal cards) with recomputed metas
//   4. first successful EMPTY payload: the loaders are gone and both empty
//      states are shown — the swap, not the treatment
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
const LOADER_TEXT = "Loading the set from /proposals...";
const PANELS = ["conflicts-list", "proposals-grid"];

// Empty-state copy contract (order e1-impl-empty-state-awaited-copy): exact
// title + description per panel, both rendered only after an observed payload.
const EMPTY_COPY = [
  { id: "conflicts-list", title: "No convergence conflicts", desc: "Waiting for concurrent proposals to compare on shared files." },
  { id: "proposals-grid", title: "No active proposals", desc: "Waiting for agent branches to propose changes against base." },
];

// Distinct counts so a wrong panel/meta mapping fails loudly.
const FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main" },
  ref: "main",
  summary: { proposals: 3, sharedFiles: 1, conflictingPairs: 1, changedFiles: 2, cleanPairs: 0 },
  proposals: [
    { repo: "agent-1", intent: "fixture intent 1", files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1 }], stats: { files: 1, additions: 3, deletions: 1 } },
    { repo: "agent-2", intent: "fixture intent 2", files: [{ path: "src/auth.ts", status: "modified", additions: 2, deletions: 2 }], stats: { files: 1, additions: 2, deletions: 2 } },
    { repo: "agent-3", intent: "fixture intent 3", files: [{ path: "src/util.ts", status: "added", additions: 5, deletions: 0 }], stats: { files: 1, additions: 5, deletions: 0 } },
  ],
  conflicts: [
    {
      file: "src/auth.ts",
      kind: "text-conflict",
      repos: ["agent-1", "agent-2"],
      pairs: [{ a: "agent-1", b: "agent-2", kind: "text-conflict", region: { baseLines: 4, aLines: 3, bLines: 2 } }],
    },
  ],
};
const EMPTY_FIXTURE = {
  ...FIXTURE,
  summary: { proposals: 0, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 },
  proposals: [],
  conflicts: [],
};

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
  console.log("SKIP  UI first-load panels — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-panels-"));

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
const metasOf = (dom) => [domValue(dom, "conflicts-meta"), domValue(dom, "proposals-meta")];
const loaderCount = (dom) => (dom.match(/Loading the set from \/proposals\.\.\./g) || []).length;
// Panel region: from the container's opening tag to its section close — the
// treatment modes hold only the loader; the success modes hold the swapped render.
const panelRegion = (dom, id) => {
  const m = dom.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</section>`));
  return m ? m[1] : null;
};
const panelShowsLoader = (dom, id) => {
  const region = panelRegion(dom, id);
  return region !== null && region.includes(LOADER_TEXT);
};
// The ordering law (FR-7, prd.md:181-182): before the first observed payload a
// panel holds the loading treatment and NOTHING else — an empty state here
// would dress "not loaded yet" as "nothing to see".
const panelHasNoEmptyState = (dom) =>
  PANELS.every((id) => {
    const region = panelRegion(dom, id);
    return region !== null && !region.includes("empty-state");
  });
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
      res.end(JSON.stringify(mode === "empty" ? EMPTY_FIXTURE : FIXTURE));
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

  // --- 1. cold document: the shipped treatment, before any script runs ----
  try {
    mode = "no-js";
    const dom = await dumpDom(url);
    check(
      "1 cold document shows the loader in both panels",
      PANELS.every((id) => panelShowsLoader(dom, id)) && loaderCount(dom) === 2,
      `count=${loaderCount(dom)}`,
    );
    check("1 cold document metas read em-dash", metasOf(dom).every((v) => v === EM_DASH), JSON.stringify(metasOf(dom)));
    check("1 no script ran yet (banner still hidden)", !bannerVisible(dom));
    check("1 neither empty state renders in the cold document", panelHasNoEmptyState(dom));
  } catch (e) {
    check("1 cold-document case threw", false, String(e?.message ?? e));
  }

  // --- 2. failed first fetch: treatment stays, banner offers Retry now ----
  try {
    mode = "fail";
    const dom = await dumpDom(url);
    check(
      "2 loaders stay in both panels through a failed first fetch",
      PANELS.every((id) => panelShowsLoader(dom, id)) && loaderCount(dom) === 2,
      `count=${loaderCount(dom)}`,
    );
    check("2 failed fetch surfaced (connection banner visible, app.js ran)", bannerVisible(dom));
    check("2 banner offers Retry now", domValue(dom, "connection-banner-retry") === "Retry now", String(domValue(dom, "connection-banner-retry")));
    check("2 metas stay em-dash (never a false 0 detected / 0 active)", metasOf(dom).every((v) => v === EM_DASH), JSON.stringify(metasOf(dom)));
    check("2 neither empty state renders through the failed first fetch", panelHasNoEmptyState(dom));
  } catch (e) {
    check("2 failed-first-fetch case threw", false, String(e?.message ?? e));
  }

  // --- 3. first successful payload: panels swap to the live render ----
  try {
    mode = "ok";
    const dom = await dumpDom(url);
    check("3 loaders are gone after the first payload", !PANELS.some((id) => panelShowsLoader(dom, id)) && loaderCount(dom) === 0);
    check("3 conflicts meta recomputes to that payload's count", domValue(dom, "conflicts-meta") === "1 detected", String(domValue(dom, "conflicts-meta")));
    check("3 proposals meta recomputes to that payload's count", domValue(dom, "proposals-meta") === "3 active", String(domValue(dom, "proposals-meta")));
    check("3 conflict card rendered", (panelRegion(dom, "conflicts-list") || "").includes("src/auth.ts"));
    const grid = panelRegion(dom, "proposals-grid") || "";
    check("3 proposal cards rendered", ["card-agent-1", "card-agent-2", "card-agent-3"].every((cid) => grid.includes(cid)));
    check("3 no banner on a successful first payload", !bannerVisible(dom));
  } catch (e) {
    check("3 first-successful-payload case threw", false, String(e?.message ?? e));
  }

  // --- 4. first successful empty payload: swap to the empty states ----
  try {
    mode = "empty";
    const dom = await dumpDom(url);
    check("4 loaders are gone after the empty payload", !PANELS.some((id) => panelShowsLoader(dom, id)) && loaderCount(dom) === 0);
    check(
      "4 metas recompute to true zero counts",
      domValue(dom, "conflicts-meta") === "0 detected" && domValue(dom, "proposals-meta") === "0 active",
      JSON.stringify(metasOf(dom)),
    );
    for (const { id, title, desc } of EMPTY_COPY) {
      const region = panelRegion(dom, id) || "";
      check(
        `4 ${id} empty-state title exactly "${title}"`,
        region.includes(`<div class="empty-state-title">${title}</div>`),
        region.slice(0, 240),
      );
      check(
        `4 ${id} empty-state desc states what is awaited`,
        region.includes(`<div class="empty-state-desc">${desc}</div>`),
        region.slice(0, 240),
      );
    }
  } catch (e) {
    check("4 first-empty-payload case threw", false, String(e?.message ?? e));
  }
} finally {
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
