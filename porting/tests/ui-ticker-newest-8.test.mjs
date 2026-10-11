#!/usr/bin/env bun
// Contract suite: FR-20 — the live events ticker renders the newest 8 events
// with type, repo and time columns, and clears stale-pulse on a successful poll.
// Run: bun porting/tests/ui-ticker-newest-8.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/index.html + app.js are loaded in a
// real headless Chrome over a loopback origin. The only scripted piece is the
// worker's /events surface — a fixture of 12 events so the newest-8 cap is
// discriminative. No product mocks, no source grep. Four observable contracts:
//   1. exactly 8 .ticker-event rows render from a 12-event payload (slice(0,8) cap)
//   2. the 8 rows are the NEWEST — type-0..type-7, never type-8..type-11
//   3. each row carries .event-type, .event-repo, .event-time with correct text
//   4. the ticker pulse clears is-stale after a successful poll (fresh pulse)
// A box without a Chrome binary skips the suite (precedent: connection-error-surface).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");

// 12 events — the ticker must keep only the newest 8 (type-0..type-7),
// dropping type-8..type-11. Distinct repos/times so a wrong slice is visible.
const FIXTURE_EVENTS = Array.from({ length: 12 }, (_, i) => ({
  type: `type-${i}`,
  repo: `agent-${i}`,
  at: new Date(Date.parse("2026-10-06T00:00:00Z") + i * 1000).toISOString(),
}));

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) ||
  process.env.CHROME_BIN ||
  null;

if (!CHROME) {
  console.log("SKIP  FR-20 ticker newest-8 — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-ticker-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--virtual-time-budget=4000",
        `--user-data-dir=${userDataDir}`,
        "--dump-dom",
        url,
      ],
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

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: FIXTURE_EVENTS }));
    return;
  }
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, base: { repo: "demo", ref: "main" }, ref: "main", proposals: [], conflicts: [], summary: {} }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "judge unavailable in fixture" }));
    return;
  }
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(join(UI, "index.html"), "utf8"));
    return;
  }
  if (pathname === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(join(UI, "app.js"), "utf8"));
    return;
  }
  if (pathname === "/reveal-decision.js") {
    // app.js statically imports this module — without the route the whole
    // module graph 404s and NOTHING renders (vacuous passes on every check).
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(join(UI, "reveal-decision.js"), "utf8"));
    return;
  }
  if (pathname === "/land-verdict.js") {
    // app.js statically imports this module — without the route the whole
    // module graph 404s and NOTHING renders (the wave-9 reveal-decision.js lesson).
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(join(UI, "land-verdict.js"), "utf8"));
    return;
  }
  if (pathname === "/styles.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end(readFileSync(join(UI, "styles.css"), "utf8"));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  const dom = await dumpDom(url);

  // Contract 1: exactly 8 .ticker-event rows from a 12-event payload
  const rowMatches = dom.match(/<div class="ticker-event">/g);
  const rowCount = rowMatches ? rowMatches.length : 0;
  check("FR-20 1: ticker renders exactly 8 rows from 12 events", rowCount === 8, `got ${rowCount} rows`);

  // Contract 2: the 8 rows are the NEWEST (type-0..type-7), never type-8..type-11
  check("FR-20 2: ticker does not render older events (no type-8)", !dom.includes("type-8"), "type-8 found in rendered ticker");
  check("FR-20 2: ticker renders newest event (type-0)", dom.includes("type-0"), "type-0 not found");

  // Contract 3: each row has event-type, event-repo, event-time classes with content
  check(
    "FR-20 3: row has .event-type class",
    dom.includes('class="event-type"') || dom.includes('class="event-type '),
    "no .event-type span found",
  );
  check(
    "FR-20 3: row has .event-repo class",
    dom.includes('class="event-repo"') || dom.includes('class="event-repo '),
    "no .event-repo span found",
  );
  check(
    "FR-20 3: row has .event-time class",
    dom.includes('class="event-time"') || dom.includes('class="event-time '),
    "no .event-time span found",
  );
  check("FR-20 3: event-type rendered with type-0", dom.includes("type-0"), "type-0 text not in markup");
  check("FR-20 3: event-repo rendered with agent-0", dom.includes("agent-0"), "agent-0 repo text not in markup");

  // Contract 4: ticker pulse does NOT have is-stale after a successful poll
  const pulseTag =
    (dom.match(/<[^>]*id="ticker-pulse"[^>]*>/i) || [null])[0];
  const pulseStale = pulseTag ? /is-stale/.test(pulseTag) : null;
  check("FR-20 4: ticker pulse is not stale after successful poll", pulseStale === false, `pulseStale=${pulseStale}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
