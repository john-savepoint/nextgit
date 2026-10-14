#!/usr/bin/env bun
// Contract suite: the proposals grid never overflows a narrow viewport — EXPERIENCE.md:259
// build gap ("360px track floor + 2rem container padding overflows below ~424px viewports").
// Run: bun porting/tests/ui-grid-overflow.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + styles.css + app.js) is served
// from a loopback origin into real headless Chrome; every asserted number is read from the
// live computed layout (getComputedStyle / getBoundingClientRect) at emulated device
// metrics. No module mocks, no source grep, no in-page observer. Legs:
//   fixture — the real grid renders the 4-proposal demo-shaped set (judge chips + conflict)
//   A narrow (320 / 375 / 423 / 424) — the page does not scroll horizontally; the grid is a
//     single column whose one track spans the grid's whole content box (the fluid floor);
//     every card stays inside the viewport and the four cards stack as four rows
//   B floor regime (768 / 1024 / 1440) — the 360px-floor arithmetic still yields 1/2/3
//     equal tracks and 4/2/2 packed card rows: wide behavior is unchanged
//   C mobile pass (390; the rail also at 320) — the wave-17/19 sections (rail, sessions,
//     issues, pipelines) reflow at phone widths: the document still does not scroll
//     horizontally, EVERY element in the document stays inside the viewport (the
//     element-level walk, not just the document box), the rail's per-repo bands STACK
//     (each band >=60% of the section width, >1 distinct y) instead of holding the
//     desktop 20rem horizontal scroller, the four sections render their rows (4 sessions
//     / 2 issues / 1 pipeline / 4 rail bands), and the new-section touch controls
//     (.steer-send / .issue-close / .issue-composer-submit / .steer-input) hold the
//     44x44 floor
// A box without a Chrome binary skips the suite (precedent: ui-focus-visible /
// ui-first-load-panels); the order's acceptance gate hard-requires Chrome separately.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const SETTLE_MS = 350; // re-layout after a device-metrics override must settle before reads
const NARROW = [320, 375, 423, 424];
const WIDE = [768, 1024, 1440];
const WIDE_TRACKS = { 768: 1, 1024: 2, 1440: 3 };
const CARDS = 4;
const MOBILE = [390]; // the order's named phone width
const RAIL = [320, 390]; // the rail is also asserted at 320px
// The touch register's new-section controls (owner: the <=720px register in styles.css).
const TOUCH_SELS = [".steer-send", ".issue-close", ".issue-composer-submit", ".steer-input"];

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// Demo-shaped set (mirrors the live demo): a ready pair conflicting on src/auth.ts, one
// landed change-set, one secret-typed one — the four card shapes the grid must carry.
const BASE_HEAD = "1a".repeat(20);
const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 4, sharedFiles: 1, conflictingPairs: 1, changedFiles: 5, cleanPairs: 1 },
  proposals: [
    {
      repo: "agent-1",
      head: "2b".repeat(20),
      intent: "Rotate session tokens per request in the auth middleware",
      landing: { status: "ready" },
      stats: { files: 2, additions: 42, deletions: 7 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 12, deletions: 3, secret: false },
        { path: "src/platform/lib/token-store-adapter.ts", status: "modified", additions: 30, deletions: 4, secret: false },
      ],
    },
    {
      repo: "agent-2",
      head: "3c".repeat(20),
      intent: "Harden the auth guards around the session cookie",
      landing: { status: "ready" },
      stats: { files: 1, additions: 18, deletions: 2 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 18, deletions: 2, secret: false }],
    },
    {
      repo: "agent-3",
      head: "4d".repeat(20),
      intent: "Document the merge-preview flow",
      landing: { status: "landed", commit: "abc1234" },
      stats: { files: 1, additions: 6, deletions: 0 },
      files: [{ path: "README.md", status: "modified", additions: 6, deletions: 0, secret: false }],
    },
    {
      repo: "agent-4",
      head: "5e".repeat(20),
      intent: "Wire the secret broker into the token store",
      landing: { status: "ready" },
      stats: { files: 1, additions: 9, deletions: 1 },
      files: [
        { path: "src/auth.ts", status: "modified", additions: 9, deletions: 1, secret: true, keys: ["AUTH_TOKEN", "SESSION_SECRET"] },
      ],
    },
  ],
  conflicts: [
    {
      file: "src/auth.ts",
      kind: "text-conflict",
      repos: ["agent-1", "agent-2"],
      pairs: [{ a: "agent-1", b: "agent-2", kind: "text-conflict", region: { baseLines: 2, aLines: 3, bLines: 3 } }],
    },
  ],
};
// Advisory chips for two of the four cards (a landed card never wears stale chips), so the
// measured rows carry the real chip layout rather than a bare-card approximation.
const JUDGE = {
  ok: true,
  judgments: [
    { repo: "agent-1", risk: { label: "senior-security", score: 0.71 }, intent: { verdict: "contradicts", overclaim: 0.42 }, collision: true },
    { repo: "agent-4", risk: { label: "routine", score: 0.12 }, intent: { verdict: "supports", overclaim: 0.05 } },
  ],
};
const EVENTS = { ok: true, events: [{ type: "change", repo: "agent-1", at: "2026-10-08T10:00:00Z" }] };

// The wave-17/19 section payloads the C legs measure (shapes per CONTRACT.md: GET
// /sessions, GET /sessions/{repo}/instructions, GET /issues, GET /pipelines, GET
// /agents). Each carries at least one deliberately unbroken long string: the wrap
// registers the mobile pass adds are the contract being defended.
const SESSIONS = {
  ok: true,
  base: "demo",
  sessions: FIXTURE.proposals.map((p, i) => ({
    repo: p.repo,
    state: i === 0 ? "working" : "idle",
    intent: p.intent,
    lastEvent: "session.started",
    lastActivityAt: "2026-10-08T10:00:00Z",
  })),
};
// agent-1 carries the long recorded instruction; the rest carry the honest empty shape.
const INSTRUCTIONS = {
  ok: true,
  repo: "agent-1",
  instructions: [
    {
      id: "c4",
      text: "a very long recorded instruction string that must wrap inside the session-instruction register at 390px without pushing the row wider than the viewport",
      at: "2026-10-08T10:00:04Z",
    },
  ],
  cursor: "c4",
};
const ISSUES = {
  ok: true,
  base: "demo",
  issues: [
    {
      kind: "derived",
      id: "conflict:agent-conflict:src/a.ts",
      issue: "conflict",
      repo: "agent-conflict",
      severity: "high",
      title: "Merge conflict in src/a.ts with a deliberately long title that must wrap inside the issue-title register at 390px rather than widen the row",
      detail: "src/a.ts",
      links: ["/merge?base=demo&repos=agent-conflict"],
    },
    {
      kind: "stored",
      id: "a1b2c3d4e5f6",
      repo: "agent-1",
      title: "Login form posts to the wrong endpoint",
      body: "The login form POSTs to /api/v1/login instead of /api/v2/login on staging.",
      severity: "high",
      state: "open",
      assignee: null,
      at: "2026-10-08T10:00:00Z",
      closedAt: null,
    },
  ],
};
const PIPELINES = {
  ok: true,
  base: "demo",
  pipelines: [
    {
      id: "f".repeat(40),
      repos: ["agent-1", "agent-2", "agent-3", "agent-4"],
      at: "2026-10-08T10:00:00Z",
      checks: ["merged-sha-equals-tested-sha"],
      results: ["pass"],
      status: "passed",
      attestation: "signed",
    },
  ],
};
const AGENTS = {
  ok: true,
  base: "demo",
  agents: FIXTURE.proposals.map((p, i) => ({
    repo: p.repo,
    harness: "omp",
    capabilities: ["write"],
    policy: { land: i === 0 ? "enabled" : "disabled", secretClass: "withhold" },
    lastSeenAt: "2026-10-08T10:00:00Z",
  })),
};
const WHOAMI = { ok: true, authorized: false, reveal: false };
const FORKS = { ok: true, base: "demo", forks: [] };

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI grid overflow — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-grid-"));

// Loopback worker surface: the demo set, the judge chips, and the static UI app.
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  const json = (payload) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (pathname === "/proposals") return json(FIXTURE);
  if (pathname === "/judge") return json(JUDGE);
  if (pathname === "/events") return json(EVENTS);
  if (pathname === "/sessions") return json(SESSIONS);
  // The per-repo instructions poll: agent-1 carries the long recorded instruction, every
  // other repo the honest empty shape (cursor null -> the next poll re-reads).
  if (pathname.startsWith("/sessions/") && pathname.endsWith("/instructions")) {
    return json(pathname === "/sessions/agent-1/instructions" ? INSTRUCTIONS : { ok: true, instructions: [], cursor: null });
  }
  if (pathname === "/issues") return json(ISSUES);
  if (pathname === "/pipelines") return json(PIPELINES);
  if (pathname === "/agents") return json(AGENTS);
  if (pathname === "/whoami") return json(WHOAMI);
  if (pathname === "/forks") return json(FORKS);
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
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

// Live layout of the proposal grid: the document box, the grid's own content box, the
// resolved track list, and every card rect.
const READ_LAYOUT = `(() => {
  const grid = document.getElementById("proposals-grid");
  if (!grid) return null;
  const doc = document.documentElement;
  const cs = getComputedStyle(grid);
  const cards = [...grid.querySelectorAll(".proposal-card")].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, width: r.width };
  });
  return {
    docClientWidth: doc.clientWidth,
    docScrollWidth: doc.scrollWidth,
    gridClientWidth: grid.clientWidth,
    gap: parseFloat(cs.columnGap) || 0,
    tracks: cs.gridTemplateColumns.split(/\\s+/).filter(Boolean),
    cards,
  };
})()`;

// Live layout of the wave-17/19 mobile surface: the document box, an element-level
// overflow walk over EVERY body descendant (the same law the document box carries, but
// attributed to the offending element), the four sections' rects, the rail band rects,
// the touch register's computed minima + rects, and the rendered row counts.
const READ_MOBILE = `(() => {
  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const overflowing = [];
  for (const node of [document.body, ...document.body.querySelectorAll("*")]) {
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > clientWidth + 0.5) {
      overflowing.push({
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        cls: typeof node.className === "string" ? node.className : "",
        right: +r.right.toFixed(2),
      });
    }
  }
  const sectionRect = (id) => {
    const node = document.getElementById(id);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { width: +r.width.toFixed(2), right: +r.right.toFixed(2) };
  };
  const railRows = [...document.querySelectorAll("#rail-list .rail-row")].map((node) => {
    const r = node.getBoundingClientRect();
    return { id: node.id || "", y: +r.y.toFixed(2), width: +r.width.toFixed(2), right: +r.right.toFixed(2) };
  });
  const touch = {};
  for (const sel of ${JSON.stringify(TOUCH_SELS)}) {
    touch[sel] = [...document.querySelectorAll(sel)].map((node) => {
      const cs = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return { w: +r.width.toFixed(2), h: +r.height.toFixed(2), minH: cs.minHeight, minW: cs.minWidth };
    });
  }
  return {
    docClientWidth: clientWidth,
    docScrollWidth: doc.scrollWidth,
    overflowing,
    sections: {
      sessions: sectionRect("sessions-section"),
      issues: sectionRect("issues-section"),
      pipelines: sectionRect("pipelines-section"),
      rail: sectionRect("rail-section"),
    },
    railRows,
    touch,
    counts: {
      sessions: document.querySelectorAll("#sessions-list .session-row").length,
      issues: document.querySelectorAll("#issues-list .issue-row").length,
      pipelines: document.querySelectorAll("#pipelines-list .pipeline-row").length,
      rail: railRows.length,
    },
  };
})()`;

const trackWidths = (m) => m.tracks.map((t) => parseFloat(t));
const spreadOf = (widths) => (widths.length ? Math.max(...widths) - Math.min(...widths) : Infinity);
// Cards sharing a grid row share a y (rounded rows are > 10px apart); clusters = rows.
const rowCount = (cards) => {
  const ys = cards.map((c) => c.y).sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  for (const y of ys) {
    if (y - last > 10) rows++;
    last = y;
  }
  return rows;
};
// The 360px track floor over the grid's own content box: below the floor this clamps to 1,
// above it counts the tracks the auto-fill arithmetic can place (gap included).
const expectedTracks = (m) => Math.max(1, Math.floor((m.gridClientWidth + m.gap) / (360 + m.gap)));

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

  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await waitFor(`document.readyState === "complete" && location.origin === ${JSON.stringify(baseUrl)}`);
  await waitFor(`document.querySelectorAll("#proposals-grid .proposal-card").length === ${CARDS}`);
  await waitFor(`document.querySelectorAll("#proposals-grid .judge-overclaim").length === 2`);

  const fixtureState = await evl(`(() => {
    const grid = document.getElementById("proposals-grid");
    return {
      cards: grid ? grid.querySelectorAll(".proposal-card").length : 0,
      chips: document.querySelectorAll("#proposals-grid .judge-overclaim").length,
      conflicts: document.querySelectorAll("#conflicts-list .conflict-card").length,
    };
  })()`);
  check(
    "fixture renders the 4-proposal set with judge chips and the conflict panel",
    fixtureState &&
    fixtureState.cards === CARDS &&
    fixtureState.chips === 2 &&
    fixtureState.conflicts === 1,
    JSON.stringify(fixtureState),
  );

  const measure = async (width) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(SETTLE_MS);
    return evl(READ_LAYOUT);
  };

  for (const width of NARROW) {
    const m = await measure(width);
    if (!m) {
      check(`A ${width}px: the proposals grid exists`, false, "no #proposals-grid");
      continue;
    }
    const expected = expectedTracks(m);
    const widths = trackWidths(m);
    check(
      `A ${width}px: the page does not scroll horizontally`,
      m.docScrollWidth <= m.docClientWidth + 1,
      `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
    );
    check(
      `A ${width}px: the grid renders exactly one column (360px-floor arithmetic)`,
      m.tracks.length === 1 && m.tracks.length === expected,
      `tracks=${m.tracks.length} expected=${expected} [${m.tracks.join(" ")}] gap=${m.gap}`,
    );
    check(
      `A ${width}px: the single track spans the grid's whole content box (fluid floor)`,
      widths.length === 1 && Math.abs(widths[0] - m.gridClientWidth) <= 1,
      `track=${widths[0]} gridClientWidth=${m.gridClientWidth}`,
    );
    check(
      `A ${width}px: every proposal card stays inside the viewport`,
      m.cards.length === CARDS && m.cards.every((c) => c.right <= m.docClientWidth + 0.5),
      `clientWidth=${m.docClientWidth} cards=${JSON.stringify(m.cards)}`,
    );
    check(
      `A ${width}px: all four cards stack as one row per card`,
      m.cards.length === CARDS && rowCount(m.cards) === CARDS,
      `cards=${m.cards.length} rows=${rowCount(m.cards)} y=${m.cards.map((c) => Math.round(c.y)).join(",")}`,
    );
  }

  for (const width of WIDE) {
    const m = await measure(width);
    if (!m) {
      check(`B ${width}px: the proposals grid exists`, false, "no #proposals-grid");
      continue;
    }
    const expected = expectedTracks(m);
    const pinned = WIDE_TRACKS[width];
    const widths = trackWidths(m);
    const rows = Math.ceil(CARDS / expected);
    check(
      `B ${width}px: the page does not scroll horizontally`,
      m.docScrollWidth <= m.docClientWidth + 1,
      `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
    );
    check(
      `B ${width}px: the track count matches the 360px floor (${pinned})`,
      m.tracks.length === expected && m.tracks.length === pinned,
      `tracks=${m.tracks.length} expected=${expected} pinned=${pinned} [${m.tracks.join(" ")}] gap=${m.gap}`,
    );
    check(
      `B ${width}px: the tracks are equal within 1px`,
      widths.length >= 1 && spreadOf(widths) <= 1,
      `track=${widths.join(" ")} spread=${spreadOf(widths)}`,
    );
    check(
      `B ${width}px: the ${CARDS} cards pack into ${rows} rows`,
      m.cards.length === CARDS && rowCount(m.cards) === rows,
      `cards=${m.cards.length} rows=${rowCount(m.cards)} expected=${rows} y=${m.cards.map((c) => Math.round(c.y)).join(",")}`,
    );
    check(
      `B ${width}px: every proposal card stays inside the viewport`,
      m.cards.length === CARDS && m.cards.every((c) => c.right <= m.docClientWidth + 0.5),
      `clientWidth=${m.docClientWidth} cards=${JSON.stringify(m.cards)}`,
    );
  }

  // --- C: mobile pass (390px; the rail also at 320px) --------------------------------
  const measureMobile = async (width) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(SETTLE_MS);
    await waitFor(`document.querySelectorAll("#rail-list .rail-row").length === 4`, 10000);
    return evl(READ_MOBILE);
  };

  // The rail predicate: every band is inside the viewport AND the bands read as real
  // bands — more than one distinct y (they stacked) and each at least 60% of the
  // section width (the fluid floor, not a shrink-to-unreadable column of slivers).
  const railBad = (m) => {
    const section = m.sections.rail;
    if (!section) return "no #rail-section rect";
    if (m.railRows.length !== 4) return `bands=${m.railRows.length}`;
    const right = Math.max(...m.railRows.map((r) => r.right));
    if (right > m.docClientWidth + 0.5) return `max right=${right} clientWidth=${m.docClientWidth}`;
    const ys = new Set(m.railRows.map((r) => Math.round(r.y)));
    if (ys.size < 2) return `distinct y=${ys.size} (bands did not stack)`;
    const narrow = m.railRows.filter((r) => r.width < section.width * 0.6);
    if (narrow.length) return `band widths=${m.railRows.map((r) => r.width).join(",")} section=${section.width}`;
    return "";
  };

  // The touch predicate: each register control computes min 44px AND presents a
  // >=44x44 border-box rect at the acceptance boundary.
  const touchBad = (m) => {
    const bad = [];
    for (const sel of TOUCH_SELS) {
      const rows = m.touch[sel] ?? [];
      if (rows.length === 0) {
        bad.push(`${sel}: no elements`);
        continue;
      }
      for (const r of rows) {
        if (r.minH !== "44px" || r.minW !== "44px") bad.push(`${sel}: min=${r.minH}/${r.minW}`);
        else if (r.w < 43.5 || r.h < 43.5) bad.push(`${sel}: rect=${r.w}x${r.h}`);
      }
    }
    return bad;
  };

  for (const width of MOBILE) {
    try {
      const m = await measureMobile(width);
      check(
        `C ${width}px: the page does not scroll horizontally`,
        m.docScrollWidth <= m.docClientWidth + 1,
        `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
      );
      check(
        `C ${width}px: every element in the document stays inside the viewport`,
        m.overflowing.length === 0,
        JSON.stringify(m.overflowing.slice(0, 6)),
      );
      check(
        `C ${width}px: the rail, sessions, issues and pipelines sections render their rows`,
        m.counts.sessions === 4 && m.counts.issues === 2 && m.counts.pipelines === 1 && m.counts.rail === 4,
        JSON.stringify(m.counts),
      );
      const rb = railBad(m);
      check(`C ${width}px: the rail bands stack inside the viewport as full-width bands`, rb === "", rb);
      const tb = touchBad(m);
      check(
        `C ${width}px: the new-section touch controls hold the 44x44 floor`,
        tb.length === 0,
        JSON.stringify(tb.slice(0, 4)),
      );
    } catch (e) {
      check(`C ${width}px: mobile walk threw`, false, String(e?.message ?? e));
    }
  }

  for (const width of RAIL) {
    try {
      const m = await measureMobile(width);
      check(
        `C rail @${width}px: the page does not scroll horizontally`,
        m.docScrollWidth <= m.docClientWidth + 1,
        `scrollWidth=${m.docScrollWidth} clientWidth=${m.docClientWidth}`,
      );
      check(
        `C rail @${width}px: every element in the document stays inside the viewport`,
        m.overflowing.length === 0,
        JSON.stringify(m.overflowing.slice(0, 6)),
      );
      const rb = railBad(m);
      check(`C rail @${width}px: the rail bands stack inside the viewport as full-width bands`, rb === "", rb);
    } catch (e) {
      check(`C rail @${width}px: rail walk threw`, false, String(e?.message ?? e));
    }
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
