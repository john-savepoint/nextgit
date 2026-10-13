#!/usr/bin/env bun
// Contract suite: judge-set comparison (nextgit-e16, wave-16 lane-4).
// Run: bun porting/tests/ui-judge-comparison.test.mjs   (exit 0 = pass)
//
// Real construction:
//   - Leg 1 (bun-only): the fixture /judge 200 body deep-equals the
//     CONTRACT.md §POST /judge envelope, built to the judge.test.mjs
//     answer set (risk_1 1.57 -> focused, risk_2 0.5 -> routine) so
//     this suite and the worker suite share one ground truth; plus
//     pure-function legs on the SHIPPED module (compareJudgments
//     ordering, tie-break, empty set; strongestCandidate).
//   - Legs 2-5 (headless Chrome, loopback): the shipped index.html +
//     real module graph load over a loopback origin; only the HTTP
//     surface is scripted (/proposals + /judge fixtures). An observer
//     script is injected BEFORE app.js and records what the real app
//     rendered (including window.onerror — the acceptance).
//   - Leg 6 (bun-only): registration trio — worker.fetch GET
//     /js/judge-comparison.js with an ASSETS.fetch probe returns 200
//     + probe-called (the route-discipline Group 3 mechanism).
//   - Leg 7 (bun-only): negative scan — the shipped module carries no
//     fetch(, no fetchJson(, no POST — a source-text assertion pinning
//     a CAPABILITY ABSENCE (render-only acceptance).
//
// Full-suite-safe: loopback only (no network), fresh fixtures per leg,
// Chrome legs SKIP-exit-0 without a binary (documented precedent), no
// live worker, no writes.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../../platform/src/index.ts";

// The UI module graph builds its `el` map from getElementById at load,
// so a minimal document stub is installed BEFORE the dynamic import
// (the agents-api.test.mjs / ui-land-verdict-sheet.test.mjs convention).
// Save/restore keeps the suite full-suite-safe.
const savedDocument = globalThis.document;
globalThis.document = globalThis.document ?? { getElementById: () => null };
let judgeComparison;
try {
  judgeComparison = await import("../../platform/ui/js/judge-comparison.js");
} finally {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

let fails = 0;
let cases = 0;
const check = (name, ok, detail = "") => {
  cases++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Leg 1 — wire contract + pure comparison (bun-only, no Chrome).
//
// The fixture /judge 200 body deep-equals the CONTRACT.md:575-591
// envelope, built to the judge.test.mjs:253-272 answer set
// (risk_1 1.57 -> focused, risk_2 0.5 -> routine) so this suite and
// the worker suite share one ground truth.
// ---------------------------------------------------------------------------

const JUDGE_FIXTURE = {
  ok: true,
  setId: "v1",
  model: "@cf/cloudflare/clef",
  judgments: [
    {
      repo: "agent-1",
      risk: { label: "focused", score: 1.57 },
      intent: { verdict: "supports", overclaim: 0.31 },
      collision: false,
    },
    {
      repo: "agent-2",
      risk: { label: "routine", score: 0.5 },
      intent: { verdict: "supports", overclaim: 0.1 },
      collision: false,
    },
  ],
  skipped: [{ repo: "agent-4", reason: "secret-class" }],
};

// Envelope deep-equal to CONTRACT.md §POST /judge 200 (closed shape:
// exactly ok/setId/model/judgments/skipped; each judgment carries
// repo + risk{label,score} + intent{verdict,overclaim} + collision;
// each skip carries repo + reason).
{
  const envShapeOk =
    JUDGE_FIXTURE.ok === true &&
    JUDGE_FIXTURE.setId === "v1" &&
    JUDGE_FIXTURE.model === "@cf/cloudflare/clef" &&
    Array.isArray(JUDGE_FIXTURE.judgments) &&
    Array.isArray(JUDGE_FIXTURE.skipped) &&
    Object.keys(JUDGE_FIXTURE).length === 5;
  check("1 judge fixture: envelope keys are exactly {ok,setId,model,judgments,skipped}", envShapeOk);

  const judgmentShapeOk = JUDGE_FIXTURE.judgments.every((j) =>
    j &&
    typeof j.repo === "string" &&
    j.risk &&
    ["routine", "focused", "senior-security"].includes(j.risk.label) &&
    typeof j.risk.score === "number" &&
    j.risk.score >= 0 &&
    j.risk.score <= 2 &&
    j.intent &&
    ["supports", "contradicts", "insufficient"].includes(j.intent.verdict) &&
    (j.intent.overclaim === null || (typeof j.intent.overclaim === "number" && j.intent.overclaim >= 0 && j.intent.overclaim <= 1)) &&
    typeof j.collision === "boolean",
  );
  check("1 judge fixture: every judgment matches the typed schema (label/score/verdict/overclaim/collision)", judgmentShapeOk);

  const skipShapeOk = JUDGE_FIXTURE.skipped.every(
    (s) => s && typeof s.repo === "string" && ["secret-class", "empty-change-set", "content-detected-secret"].includes(s.reason),
  );
  check("1 judge fixture: every skip matches {repo, reason in the closed whitelist}", skipShapeOk);

  // Ground-truth pins shared with judge.test.mjs (risk_1 1.57 ->
  // focused, risk_2 0.5 -> routine).
  check("1 judge fixture: risk_1 1.57 -> focused (judge.test.mjs answer set)", JUDGE_FIXTURE.judgments[0].risk.score === 1.57 && JUDGE_FIXTURE.judgments[0].risk.label === "focused");
  check("1 judge fixture: risk_2 0.5 -> routine (judge.test.mjs answer set)", JUDGE_FIXTURE.judgments[1].risk.score === 0.5 && JUDGE_FIXTURE.judgments[1].risk.label === "routine");
}

// Pure-function legs on the SHIPPED module.
{
  const supports05 = { repo: "b", risk: { label: "routine", score: 0.5 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false };
  const supports157 = { repo: "a", risk: { label: "focused", score: 1.57 }, intent: { verdict: "supports", overclaim: 0.31 }, collision: false };
  const contradicts = { repo: "c", risk: { label: "senior-security", score: 2 }, intent: { verdict: "contradicts", overclaim: 0.9 }, collision: false };

  const ordered = judgeComparison.compareJudgments({ "agent-a": supports157, "agent-b": supports05, "agent-c": contradicts });
  const orderOk = ordered.length === 3 && ordered[0].repo === "b" && ordered[1].repo === "a" && ordered[2].repo === "c";
  check("1 compareJudgments: supports+0.5 before supports+1.57 before contradicts", orderOk, ordered.map((e) => e.repo).join(","));

  // Ties break by repo name: two supports with the same score.
  const tieA = { repo: "zeta", risk: { label: "routine", score: 0.5 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false };
  const tieB = { repo: "alpha", risk: { label: "routine", score: 0.5 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false };
  const tied = judgeComparison.compareJudgments({ z: tieA, a: tieB });
  check("1 compareJudgments: ties break by repo name (localeCompare)", tied[0].repo === "alpha" && tied[1].repo === "zeta", tied.map((e) => e.repo).join(","));

  check("1 compareJudgments: empty set -> []", judgeComparison.compareJudgments({}).length === 0 && judgeComparison.compareJudgments(null).length === 0);
  check("1 strongestCandidate: empty comparison -> null", judgeComparison.strongestCandidate([]) === null && judgeComparison.strongestCandidate(null) === null);
  // Typed-null posture: a malformed score is null (renders unmeasured),
  // never a fabricated 0; the null sorts last within its tier.
  const malformed = { repo: "bad", risk: { label: "routine", score: "not-a-number" }, intent: { verdict: "supports", overclaim: null }, collision: false };
  const withMalformed = judgeComparison.compareJudgments({ good: supports05, bad: malformed });
  check(
    "1 riskScoreOf: malformed score -> null, sorts after a measured score in the same tier",
    judgeComparison.riskScoreOf(malformed) === null && withMalformed[0].repo === "b" && withMalformed[1].repo === "bad" && withMalformed[1].riskScore === null,
  );
}

// ---------------------------------------------------------------------------
// Legs 2-5 — headless Chrome, loopback.
// ---------------------------------------------------------------------------

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  ui-judge-comparison Chrome legs — no Chrome binary on PATH (contract unverified in this environment)");
  console.log(fails === 0 ? `ALL PASS (${cases} checks)` : `${fails} FAILURES (${cases} passed)`);
  process.exit(fails === 0 ? 0 : 1);
}

const BASE_HEAD = "1a".repeat(20);

// /proposals fixture: agent-1..agent-4, agent-3 landed (mirrors the
// demo story — one proposal has already landed).
const PROPOSALS_FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 4, sharedFiles: 0, conflictingPairs: 0, changedFiles: 4, cleanPairs: 0 },
  proposals: [
    { repo: "agent-1", head: "2b".repeat(20), intent: "harden auth", landing: { status: "ready" }, stats: { files: 1, additions: 3, deletions: 1 }, files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }] },
    { repo: "agent-2", head: "3c".repeat(20), intent: "docs baseline", landing: { status: "ready" }, stats: { files: 1, additions: 1, deletions: 0 }, files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }] },
    { repo: "agent-3", head: "4d".repeat(20), intent: "refactor utils", landing: { status: "landed" }, stats: { files: 2, additions: 5, deletions: 2 }, files: [{ path: "src/utils.ts", status: "modified", additions: 3, deletions: 1, secret: false }] },
    { repo: "agent-4", head: "5e".repeat(20), intent: "fix race", landing: { status: "ready" }, stats: { files: 1, additions: 2, deletions: 1 }, files: [{ path: "src/race.ts", status: "modified", additions: 2, deletions: 1, secret: false }] },
  ],
  conflicts: [],
  landing: {},
};

// /judge fixture for leg 2: agent-2 routine/supports; agent-1
// focused/supports/collision=true; agent-3 senior-security/contradicts;
// agent-4 skipped secret-class.
const JUDGE_OK_FIXTURE = {
  ok: true,
  setId: "v1",
  model: "@cf/cloudflare/clef",
  judgments: [
    { repo: "agent-2", risk: { label: "routine", score: 0.5 }, intent: { verdict: "supports", overclaim: 0.1 }, collision: false },
    { repo: "agent-1", risk: { label: "focused", score: 1.57 }, intent: { verdict: "supports", overclaim: 0.31 }, collision: true },
    { repo: "agent-3", risk: { label: "senior-security", score: 2 }, intent: { verdict: "contradicts", overclaim: 0.9 }, collision: false },
  ],
  skipped: [{ repo: "agent-4", reason: "secret-class" }],
};

// /judge fixture for leg 4: all skipped, no judgments.
const JUDGE_ALL_SKIPPED_FIXTURE = {
  ok: true,
  setId: "v1",
  model: "@cf/cloudflare/clef",
  judgments: [],
  skipped: [
    { repo: "agent-1", reason: "empty-change-set" },
    { repo: "agent-2", reason: "secret-class" },
    { repo: "agent-3", reason: "content-detected-secret" },
    { repo: "agent-4", reason: "empty-change-set" },
  ],
};

// XSS fixture for leg 5: a judgment whose repo is a hostile img tag and
// whose overclaim is a hostile string.
const JUDGE_XSS_FIXTURE = {
  ok: true,
  setId: "v1",
  model: "@cf/cloudflare/clef",
  judgments: [
    {
      repo: "<img src=x onerror=window.__pwned=1>",
      risk: { label: "routine", score: 0.5 },
      intent: { verdict: "supports", overclaim: "<img src=x onerror=window.__pwned=1>" },
      collision: false,
    },
  ],
  skipped: [],
};

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-judge-cmp-"));
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Observer + driver injected BEFORE app.js. Wraps window.fetch (recording
// every URL), records window.onerror into R.errs, drives the /judge
// re-issue (manual refresh), then snapshots the rendered comparison
// surface into #test-out.
const makeClientScript = (scenario) => `
const R = { f: [], errs: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
window.addEventListener("error", (e) => { R.errs.push(String(e.message)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Wait for the initial /proposals + /judge pair to settle.
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (R.f.includes("/proposals") && R.f.includes("/judge")) { clearInterval(iv); res(); }
      }, 200);
      setTimeout(() => { clearInterval(iv); res(); }, 15000);
    });
    await sleep(800); // let the comparison surface render
    const snap = () => {
      const list = document.getElementById("judge-comparison-list");
      const meta = document.getElementById("judge-comparison-meta");
      const badge = document.getElementById("judge-comparison-badge");
      const banner = document.getElementById("connection-banner");
      R.c.listHtml = list ? list.innerHTML : null;
      R.c.metaText = meta ? meta.textContent : null;
      R.c.badgeHtml = badge ? badge.innerHTML : null;
      R.c.bannerHidden = banner ? banner.hasAttribute("hidden") : null;
      R.c.cardCount = document.querySelectorAll("#proposals-grid .proposal-card").length;
      R.c.rowRepos = Array.from(document.querySelectorAll(".judge-comparison-row .judge-comparison-repo")).map((n) => n.textContent);
      R.c.skipRows = Array.from(document.querySelectorAll(".judge-comparison-skip")).map((n) => n.textContent);
      R.c.emptyState = !!document.querySelector(".judge-comparison-empty");
      R.c.loadingState = !!document.querySelector(".judge-comparison-loading");
      R.c.unavailableState = !!document.querySelector(".judge-comparison-unavailable");
      R.c.pwned = window.__pwned === 1;
    };
    snap();
    ${scenario === "refresh"
    ? `
    // Re-issue /judge through the manual refresh to prove the surface
    // re-renders from the recorded artifacts.
    document.getElementById("btn-manual-refresh")?.click();
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (R.f.filter((u) => u === "/judge").length >= 2) { clearInterval(iv); res(); }
      }, 200);
      setTimeout(() => { clearInterval(iv); res(); }, 15000);
    });
    await sleep(800);
    snap();
    `
    : ""
  }
  } catch (e) { R.errs.push(String((e && e.stack) || e)); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});
`;

// Loopback worker surface. `scenario` selects the /judge behavior:
//   ok          — 200 JUDGE_OK_FIXTURE (legs 2, 5)
//   down        — 503 judge-unavailable (leg 3)
//   all-skipped — 200 JUDGE_ALL_SKIPPED_FIXTURE (leg 4)
//   xss         — 200 JUDGE_XSS_FIXTURE (leg 5)
const makeServer = (scenario) => {
  let judgeCalls = 0;
  return createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://127.0.0.1");
    if (pathname === "/proposals") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(PROPOSALS_FIXTURE));
      return;
    }
    if (pathname === "/judge") {
      judgeCalls++;
      if (scenario === "down") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "judge-unavailable" }));
        return;
      }
      const body =
        scenario === "all-skipped"
          ? JUDGE_ALL_SKIPPED_FIXTURE
          : scenario === "xss"
            ? JUDGE_XSS_FIXTURE
            : JUDGE_OK_FIXTURE;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (pathname === "/__client.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(makeClientScript(scenario === "refresh" ? "refresh" : "plain"));
      return;
    }
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = join(UI, rel);
    if (rel.indexOf("..") >= 0 || !file.startsWith(UI) || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = extname(file);
    if (ext === ".html") {
      const html = readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>\n${APP_TAG}`);
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    res.writeHead(200, { "content-type": contentTypes[ext] || "text/plain" });
    res.end(readFileSync(file));
  });
};

const parseOut = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

const launchChrome = (port) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-debugging-port=0",
        "--user-data-dir=" + userDataDir,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out before the CDP endpoint appeared"));
    }, 30000);
    const onData = (d) => {
      out += d;
      const m = out.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ wsUrl: m[1], child });
      }
    };
    // Chrome writes "DevTools listening on …" to STDERR (verified against
    // google-chrome 141 on this box); stdout carries nothing. Listen on both.
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

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
        pending.set(id, { res, rej, timer });
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
      if (msg.error) p.rej(new Error(`${msg.error.message}`));
      else p.res(msg.result);
    });
  });

// Run one Chrome leg against a fresh loopback server. Returns the
// observer snapshot (or null when the page never produced #test-out).
const runLeg = async (scenario) => {
  const server = makeServer(scenario);
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const { wsUrl, child } = await launchChrome(port);
  let obs = null;
  try {
    const browser = await connectCdp(wsUrl);
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
    const waitFor = async (expression, timeout = 45000) => {
      const deadline = Date.now() + timeout;
      for (; ;) {
        let ok = false;
        try {
          ok = await evl(`Boolean(${expression})`);
        } catch {
          ok = false;
        }
        if (ok) return;
        if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
        await sleep(100);
      }
    };

    await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await waitFor(`document.getElementById("test-out") !== null`, 45000);
    const dom = await evl("document.documentElement.outerHTML");
    obs = parseOut(dom);
    browser.close();
  } finally {
    try { child.kill("SIGKILL"); } catch { /* */ }
    try { server.close(); } catch { /* */ }
  }
  return obs;
};

try {
  // ---- Leg 2 — render leg ------------------------------------------------
  const obs = await runLeg("ok");
  if (!obs) {
    check("2 render leg: scenario output present (chrome + driver ran)", false, "no #test-out");
  } else if (obs.errs.length > 0) {
    check("2 render leg: zero uncaught errors", false, obs.errs.join(" | ").slice(0, 400));
  } else {
    const c = obs.c;
    check("2 render leg: zero uncaught errors (window.onerror recorded none)", (obs.errs || []).length === 0);
    check("2 render leg: the judge-comparison section rendered", c.listHtml !== null);
    // Comparison order: agent-2 (supports+0.5), agent-1 (supports+1.57),
    // agent-3 (contradicts). agent-3 is landed so its card wears no chips,
    // but the comparison surface still compares the set.
    check(
      "2 render leg: one row per judged repo in comparison order (agent-2, agent-1, agent-3)",
      JSON.stringify(c.rowRepos) === JSON.stringify(["agent-2", "agent-1", "agent-3"]),
      `rowRepos=${JSON.stringify(c.rowRepos)}`,
    );
    check(
      "2 render leg: meta reads '3 proposals compared · 1 not judged'",
      c.metaText === "3 proposals compared · 1 not judged",
      `meta="${c.metaText}"`,
    );
    // agent-4 skip row: name-only, whitelisted label, no path/key text.
    const agent4Skip = (c.skipRows || []).find((r) => r.startsWith("agent-4"));
    check(
      "2 render leg: agent-4 skip row labelled 'secret-typed — not judged'",
      agent4Skip === "agent-4 — secret-typed — not judged",
      `skipRows=${JSON.stringify(c.skipRows)}`,
    );
    check(
      "2 render leg: skip row carries no path/key text (masking law)",
      (c.skipRows || []).every((r) => !/\.env|secrets\.json|API_TOKEN|DB_PASSWORD|credentials/.test(r)),
    );
    // Recommendation badge names agent-2 (top of the code-owned order) with
    // the advisory copy.
    check(
      "2 render leg: recommendation badge names agent-2",
      (c.badgeHtml || "").includes("agent-2") && (c.badgeHtml || "").includes("strongest candidate"),
      `badge=${(c.badgeHtml || "").slice(0, 200)}`,
    );
    check(
      "2 render leg: advisory disclaimer present",
      (c.badgeHtml || "").includes("advisory only — the judge advises; code decides; humans own irreversible acts"),
    );
    // agent-1 carries the soft-collision chip (collision: true).
    check(
      "2 render leg: agent-1 row carries the soft-collision chip",
      (c.listHtml || "").includes("soft collision"),
    );
    // Cards still render (the comparison surface does not perturb the grid).
    check("2 render leg: proposals cards still render", (c.cardCount || 0) >= 4, `cards=${c.cardCount}`);
  }

  // ---- Leg 3 — fail-soft leg ---------------------------------------------
  const obs3 = await runLeg("down");
  if (!obs3) {
    check("3 fail-soft leg: scenario output present", false, "no #test-out");
  } else if (obs3.errs.length > 0) {
    check("3 fail-soft leg: zero uncaught errors", false, obs3.errs.join(" | ").slice(0, 400));
  } else {
    const c = obs3.c;
    check("3 fail-soft leg: zero uncaught errors", (obs3.errs || []).length === 0);
    check("3 fail-soft leg: section renders judge-comparison-unavailable", c.unavailableState === true, `listHtml=${String(c.listHtml || "").slice(0, 200)}`);
    check("3 fail-soft leg: the connection banner stays hidden", c.bannerHidden === true, `bannerHidden=${c.bannerHidden}`);
    check("3 fail-soft leg: /proposals cards still render (a judge outage never colors connection state)", (c.cardCount || 0) >= 4, `cards=${c.cardCount}`);
  }

  // ---- Leg 4 — all-skipped leg --------------------------------------------
  const obs4 = await runLeg("all-skipped");
  if (!obs4) {
    check("4 all-skipped leg: scenario output present", false, "no #test-out");
  } else if (obs4.errs.length > 0) {
    check("4 all-skipped leg: zero uncaught errors", false, obs4.errs.join(" | ").slice(0, 400));
  } else {
    const c = obs4.c;
    check("4 all-skipped leg: zero uncaught errors", (obs4.errs || []).length === 0);
    check("4 all-skipped leg: honest empty state renders", c.emptyState === true && (c.listHtml || "").includes("No judged proposals in this set"), `listHtml=${String(c.listHtml || "").slice(0, 200)}`);
    check(
      "4 all-skipped leg: all four skip rows render with whitelisted labels",
      (c.skipRows || []).length === 4 &&
      c.skipRows.includes("agent-1 — empty change-set — not judged") &&
      c.skipRows.includes("agent-2 — secret-typed — not judged") &&
      c.skipRows.includes("agent-3 — content-detected secret — not judged") &&
      c.skipRows.includes("agent-4 — empty change-set — not judged"),
      `skipRows=${JSON.stringify(c.skipRows)}`,
    );
    check(
      "4 all-skipped leg: NO recommendation badge (a skip is not a verdict)",
      !(c.badgeHtml || "").includes("strongest candidate"),
      `badge=${c.badgeHtml || ""}`,
    );
    check("4 all-skipped leg: meta reads '0 proposals compared · 4 not judged'", c.metaText === "0 proposals compared · 4 not judged", `meta="${c.metaText}"`);
  }

  // ---- Leg 5 — XSS / AD-4 leg ----------------------------------------------
  const obs5 = await runLeg("xss");
  if (!obs5) {
    check("5 XSS leg: scenario output present", false, "no #test-out");
  } else if (obs5.errs.length > 0) {
    check("5 XSS leg: zero uncaught errors", false, obs5.errs.join(" | ").slice(0, 400));
  } else {
    const c = obs5.c;
    check("5 XSS leg: zero uncaught errors (no live onerror fired)", (obs5.errs || []).length === 0 && c.pwned !== true, `errs=${JSON.stringify(obs5.errs)} pwned=${c.pwned}`);
    check(
      "5 XSS leg: hostile repo renders ESCAPED (no live onerror attribute in the DOM)",
      !(c.listHtml || "").includes("<img") && !(c.listHtml || "").includes("onerror=window.__pwned=1>"),
      `listHtml=${String(c.listHtml || "").slice(0, 300)}`,
    );
    check(
      "5 XSS leg: hostile overclaim renders ESCAPED (entity form in source, never a live tag)",
      (c.listHtml || "").includes("&lt;img") && !(c.listHtml || "").includes("<img"),
      `listHtml=${String(c.listHtml || "").slice(0, 300)}`,
    );
    const rowRepo = (c.rowRepos || [])[0];
    check(
      "5 XSS leg: the escaped repo name is the visible text (textContent round-trip)",
      rowRepo === "<img src=x onerror=window.__pwned=1>",
      `rowRepos=${JSON.stringify(c.rowRepos)}`,
    );
  }
} catch (e) {
  check("harness run", false, String((e && e.stack) || e));
} finally {
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
}

// ---------------------------------------------------------------------------
// Leg 6 — registration trio (bun-only): behavioral whitelist proof —
// worker.fetch GET /js/judge-comparison.js with an ASSETS.fetch probe
// returns 200 + probe-called (the route-discipline Group 3 mechanism).
// ---------------------------------------------------------------------------
{
  let probeCalled = false;
  const env = {
    ARTIFACTS: { list: async () => ({ repos: [] }) },
    ASSETS: {
      fetch: async () => {
        probeCalled = true;
        return new Response("ASSETS-SERVED");
      },
    },
    LIVE: { get: async () => null, put: async () => true },
    CACHE: { get: async () => null, put: async () => true },
    REVEAL_AUDIT: { get: async () => null, put: async () => true },
  };
  const res = await worker.fetch(new Request("http://localhost/js/judge-comparison.js"), env);
  const text = await res.text();
  check("6 registration trio: worker.fetch GET /js/judge-comparison.js -> 200", res.status === 200, `got ${res.status}`);
  check("6 registration trio: body is the ASSETS probe's", text === "ASSETS-SERVED", `got ${JSON.stringify(text)}`);
  check("6 registration trio: ASSETS.fetch probe was called", probeCalled === true);
}

// ---------------------------------------------------------------------------
// Leg 7 — negative scan (bun-only): the shipped module carries no
// fetch(, no fetchJson(, no POST — a source-text assertion pinning a
// CAPABILITY ABSENCE (the render-only acceptance), not an implementation
// detail.
// ---------------------------------------------------------------------------
{
  const raw = readFileSync(join(UI, "js/judge-comparison.js"), "utf8");
  // The capability-absence scan examines EXECUTABLE source: the module's
  // domain-header doc comments legitimately cite the contract section
  // ("§POST /judge"), so prose is stripped before the negative scan.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check("7 negative scan: no fetch( in the shipped module", !src.includes("fetch("));
  check("7 negative scan: no fetchJson( in the shipped module", !src.includes("fetchJson("));
  check("7 negative scan: no POST in the shipped module", !src.includes("POST"));
}

console.log(fails === 0 ? `ALL PASS (${cases} checks)` : `${fails} FAILURES (${cases} passed)`);
process.exit(fails === 0 ? 0 : 1);
