#!/usr/bin/env bun
// Contract suite: the convergence rail (nextgit-e17,
// wave-17 lane L4) — a horizontal per-repo timeline
// rendered from data the page ALREADY fetched.
// Run: bun porting/tests/ui-rail.test.mjs
// (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html +
// app.js + the module graph incl. js/rail.js) is served
// VERBATIM from a loopback origin into real headless
// Chrome via --dump-dom; the only scripted pieces are the
// worker's HTTP surface (JSON fixtures per mode) and a tiny
// observer/driver injected before app.js. No module mocks,
// no source grep, no in-page observer of the module's
// internals. Legs:
//   1. the full governance story — 3 repos (ready /
//      conflict / landed), a genuine text-conflict pair +
//      a clean mergeable pair (the clean pair must NOT
//      count as a collision), /checks with one fail + one
//      unknown, /agents policy + one unrecorded repo, a
//      mixed newest-first event trail with real ISO `at`,
//      and the attestation badge on the landed band ONLY
//   2. the empty set (0 proposals → honest empty, meta 0)
//   3. no-timestamp honesty (absent `at` → em-dash, never
//      a fabricated time)
//   4. typed-absent attestation (landed repo whose record
//      carries `attestation: null` → NO badge, never a
//      fabricated signature)
//   5. unknown-never-pass (no /checks payload → five
//      unknown dots, none styled check-pass)
//   6. untrusted content renders escaped (AD-4)
//   7. zero uncaught errors across every dump
// A box without a Chrome binary skips the suite (precedent:
// ui-sessions-panel, ui-issues-panel).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = '<script type="module" src="app.js"></script>';
// Injected before app.js: records every uncaught error/rejection on <html>.
const ERR_COLLECTOR =
  '<script>document.documentElement.setAttribute("data-page-errors","0");window.__errs=[];' +
  'addEventListener("error",(e)=>{window.__errs.push(String((e&&e.message)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});' +
  'addEventListener("unhandledrejection",(e)=>{window.__errs.push(String((e&&e.reason)||e));document.documentElement.setAttribute("data-page-errors",String(window.__errs.length));});</script>';

// --- The proposal set: three repos, three landing states.
// agent-1 ready (a live fold target); agent-2 conflict
// (a genuine text-conflict pair with agent-3); agent-3
// landed (a settled band that carries a signed
// attestation). agent-2 additionally shares a CLEAN
// mergeable file with agent-1 — the clean pair must NOT
// surface as a collision on agent-1's band.
const BASE = "demo";
const PROPOSALS_OK = {
  ok: true,
  base: { repo: BASE, ref: "main", head: "b".repeat(40) },
  ref: "main",
  proposals: [
    {
      repo: "agent-1",
      head: "a1".repeat(20),
      intent: "ship the rail",
      stats: { additions: 3, deletions: 1, files: 2 },
      landing: { status: "ready", files: 2 },
      files: [
        { path: "src/one.ts", status: "modified", additions: 3, deletions: 1, classification: { language: "typescript", role: "source", sensitivity: "internal" } },
        { path: "src/shared.ts", status: "modified", additions: 1, deletions: 0, classification: { language: "typescript", role: "source", sensitivity: "internal" } },
      ],
    },
    {
      repo: "agent-2",
      head: "a2".repeat(20),
      intent: "bump the schema",
      stats: { additions: 2, deletions: 2, files: 1 },
      landing: { status: "conflict", files: 1 },
      files: [
        { path: "src/shared.ts", status: "modified", additions: 2, deletions: 2, classification: { language: "typescript", role: "source", sensitivity: "internal" } },
      ],
    },
    {
      repo: "agent-3",
      head: "a3".repeat(20),
      intent: "land the fix",
      stats: { additions: 0, deletions: 0, files: 0 },
      landing: { status: "landed", files: 0, attestation: { status: "signed", v: 1, keyId: "k1", algo: "ed25519", env: { worker: "w", deploy: "d" }, subject: { commit: "c".repeat(40) }, sig: "s".repeat(64) } },
      files: [],
    },
  ],
  conflicts: [
    {
      file: "src/shared.ts",
      repos: ["agent-2", "agent-3"],
      kind: "text-conflict",
      pairs: [
        { a: "agent-2", b: "agent-3", kind: "text-conflict", conflict: true, region: { baseLines: 1, aLines: 1, bLines: 1 } },
      ],
    },
    {
      file: "src/clean.ts",
      repos: ["agent-1", "agent-2"],
      kind: "mergeable",
      pairs: [
        { a: "agent-1", b: "agent-2", kind: "mergeable", conflict: false, region: { baseLines: 1, aLines: 1, bLines: 1 } },
      ],
    },
  ],
  summary: { proposals: 3, changedFiles: 3, sharedFiles: 2, conflictingPairs: 1, cleanPairs: 1 },
};

// The typed-absent attestation record: a landed repo whose
// landing record carries `attestation: null` (the pre-
// feature path) — the rail must render NO badge.
const PROPOSALS_NULL_ATTESTATION = JSON.parse(JSON.stringify(PROPOSALS_OK));
PROPOSALS_NULL_ATTESTATION.proposals = PROPOSALS_NULL_ATTESTATION.proposals.map((p) =>
  p.repo === "agent-3" ? { ...p, landing: { status: "landed", files: 0, attestation: null } } : p,
);

// The empty set: honest empty, meta 0.
const PROPOSALS_EMPTY = { ok: true, base: { repo: BASE, ref: "main", head: "b".repeat(40) }, ref: "main", proposals: [], conflicts: [], summary: { proposals: 0, changedFiles: 0, sharedFiles: 0, conflictingPairs: 0, cleanPairs: 0 } };

// Untrusted content (AD-4): repo name + intent carry markup.
const XSS_REPO = "<img src=x onerror=alert(1)>";
const XSS_INTENT = "<script>alert(2)</script>";
const PROPOSALS_XSS = JSON.parse(JSON.stringify(PROPOSALS_EMPTY));
PROPOSALS_XSS.proposals = [
  { repo: XSS_REPO, head: "x".repeat(40), intent: XSS_INTENT, stats: { additions: 1, deletions: 0, files: 1 }, landing: { status: "ready", files: 1 }, files: [] },
];

// The /checks payload — the worker is the authority. agent-1
// gets a fail (collision) + an unknown (base); agent-2 and
// agent-3 get all-pass. In leg 5 the route 500s so the rail
// falls back to five honest unknowns.
const CHECKS_OK = {
  ok: true,
  base: { repo: BASE, ref: "main", head: "b".repeat(40) },
  checks: [
    {
      repo: "agent-1",
      checks: [
        { id: "fold", label: "fold", state: "pass", detail: "folds clean" },
        { id: "collision", label: "collision", state: "fail", detail: "text-conflict · src/shared.ts" },
        { id: "conflicts", label: "conflicts", state: "pass", detail: "0" },
        { id: "secrets", label: "secrets", state: "pass", detail: "none" },
        { id: "base", label: "base", state: "unknown", detail: "fork point not in set payload" },
      ],
    },
    {
      repo: "agent-2",
      checks: [
        { id: "fold", label: "fold", state: "fail", detail: "conflicting fold" },
        { id: "collision", label: "collision", state: "fail", detail: "text-conflict · src/shared.ts" },
        { id: "conflicts", label: "conflicts", state: "fail", detail: "1" },
        { id: "secrets", label: "secrets", state: "pass", detail: "none" },
        { id: "base", label: "base", state: "unknown", detail: "fork point not in set payload" },
      ],
    },
    {
      repo: "agent-3",
      checks: [
        { id: "fold", label: "fold", state: "pass", detail: "nothing to fold" },
        { id: "collision", label: "collision", state: "pass", detail: "none" },
        { id: "conflicts", label: "conflicts", state: "pass", detail: "0" },
        { id: "secrets", label: "secrets", state: "pass", detail: "none" },
        { id: "base", label: "base", state: "pass", detail: "in sync" },
      ],
    },
  ],
};

// The /agents roster — agent-1 and agent-2 carry a policy;
// agent-3 is absent from the roster → the unrecorded chip.
const AGENTS_OK = {
  ok: true,
  base: BASE,
  agents: [
    { repo: "agent-1", harness: "claude-code", capabilities: ["propose"], policy: { land: "manual", secretClass: "refused" }, lastSeenAt: "2026-10-14T10:00:00.000Z" },
    { repo: "agent-2", harness: "codex", capabilities: ["propose"], policy: { land: "auto-eligible", secretClass: "refused" }, lastSeenAt: "2026-10-14T10:01:00.000Z" },
  ],
};

// The /events feed — newest-first as served. agent-1 carries
// a real ISO `at`; agent-2 carries one event with NO `at`
// (the no-timestamp leg); agent-3's land event carries a
// real `at`.
const EVENTS_OK = {
  ok: true,
  events: [
    { type: "land.completed", repo: "agent-3", at: "2026-10-14T10:04:00.000Z" },
    { type: "proposal.conflict", repo: "agent-2" },
    { type: "proposal.created", repo: "agent-1", at: "2026-10-14T10:02:00.000Z" },
    { type: "session.started", repo: "agent-1", at: "2026-10-14T10:01:00.000Z" },
  ],
};

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  UI convergence rail — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

// Async spawn: the loopback server runs on THIS process's
// event loop, so a blocking exec would deadlock the very
// fetch the page is waiting on. Each scenario gets its own
// fresh browser profile (the sessions-panel precedent).
const dumpDom = (url, scenarioDir) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=10000", `--user-data-dir=${scenarioDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ dom: out, stderr: err });
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// --- DOM readers over the dumped markup ---
const railRegion = (dom) => {
  const m = dom.match(/id="rail-section"[^>]*>([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
};
// A rendered band opens with `rail-row`; the split delimiter
// is the full class so it does not also match the nested
// `rail-row-header` div.
const rowsOf = (dom) => (railRegion(dom) || "").split('<div class="rail-row"').slice(1);
const rowRepos = (dom) => [...(railRegion(dom) || "").matchAll(/class="rail-repo">([^<]*)</g)].map((m) => m[1]);
const rowChips = (dom) => [...(railRegion(dom) || "").matchAll(/class="rail-chip (rail-chip-[^"]+)">([^<]*)</g)].map((m) => ({ cls: m[1], text: m[2] }));
const rowBadges = (dom) => [...(railRegion(dom) || "").matchAll(/class="rail-badge rail-badge-attestation"[^>]*>([^<]*)</g)].map((m) => m[1]);
const checkDots = (dom, repo) => {
  const region = railRegion(dom) || "";
  const row = region.split(`id="rail-${repo}"`)[1];
  if (!row) return [];
  return [...row.matchAll(/class="check (check-[^"]+)" data-check="([^"]+)"/g)].map((m) => ({ cls: m[1], id: m[2] }));
};
const pageErrors = (dom) => {
  const m = dom.match(/<html[^>]*data-page-errors="(\d+)"/);
  return m ? Number(m[1]) : null;
};

// --- Loopback worker state — reset per scenario by the runner. ---
let proposalsMode = "ok";   // "ok" | "empty" | "xss" | "null-attestation"
let checksMode = "ok";      // "ok" | "fail" (the route 500s → the rail's honest unknowns)

// Observer/driver: injected BEFORE app.js. Reads the real
// rendered rail after the async payloads land. Emits #test-out.
const clientScript = (cfg) => `const CFG = ${JSON.stringify(cfg)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The rail settles across THREE async sources (/proposals + its
// /checks sibling, /events, and /agents via loadForks). A fixed
// sleep is a race, and "rows exist" can still be an INTERMEDIATE
// render (the roster lands last). Wait for the rail's markup to
// STABILIZE across consecutive polls instead — that is the
// settled state the real page converges to.
const waitSettled = async (budgetMs) => {
  const t0 = Date.now();
  let stable = 0;
  let last = null;
  while (Date.now() - t0 < budgetMs) {
    const list = q("#rail-list");
    const html = list ? list.innerHTML : "";
    const terminal = Boolean(list && list.querySelector(".rail-row, .rail-empty-title"));
    if (terminal && html === last) {
      stable++;
      if (stable >= 4) return true;
    } else {
      stable = 0;
    }
    last = html;
    await sleep(60);
  }
  return false;
};
const R = { s: {}, err: null };
let errCount = 0;
let rejCount = 0;
window.addEventListener("error", () => { errCount++; });
window.addEventListener("unhandledrejection", () => { rejCount++; });
const q = (sel) => document.querySelector(sel);
const qs = (sel) => [...document.querySelectorAll(sel)];
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await waitSettled(20000);
    R.s.rowCount = qs("#rail-list .rail-row").length;
    R.s.repos = qs("#rail-list .rail-row .rail-repo").map((e) => e.textContent.trim());
    R.s.chips = qs("#rail-list .rail-row .rail-chip").map((e) => ({ cls: e.className, text: e.textContent.trim() }));
    R.s.badges = qs("#rail-list .rail-row .rail-badge-attestation").map((e) => e.textContent.trim());
    R.s.meta = q("#rail-meta") ? q("#rail-meta").textContent.trim() : null;
    R.s.loaderGone = !qs("#rail-list .rail-loading").length;
    R.s.emptyTitle = qs("#rail-list .rail-empty-title").map((e) => e.textContent.trim());
    // Per-band detail: check dots, policy chips, event trail.
    R.s.bands = qs("#rail-list .rail-row").map((row) => {
      const repo = row.querySelector(".rail-repo") ? row.querySelector(".rail-repo").textContent.trim() : "";
      const dots = [...row.querySelectorAll(".rail-check-dots .check")].map((c) => ({ cls: c.className, id: c.getAttribute("data-check") }));
      const policies = [...row.querySelectorAll(".rail-policies .rail-chip")].map((c) => c.textContent.trim());
      const events = [...row.querySelectorAll(".rail-events .rail-event")].map((e) => e.textContent.trim());
      const intent = row.querySelector(".rail-intent") ? row.querySelector(".rail-intent").textContent.trim() : null;
      return { repo, dots, policies, events, intent };
    });
    R.s.errCount = errCount;
    R.s.rejCount = rejCount;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const json = (res, body, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/issues") return json(res, { ok: true, base: BASE, issues: [] });
  if (pathname === "/judge") return json(res, { ok: true, judgments: [], skipped: [] });
  if (pathname === "/whoami") return json(res, { ok: true, authorized: false, reveal: false });
  if (pathname === "/sessions" && req.method === "GET") return json(res, { ok: true, base: BASE, sessions: [] });
  // GET /forks — the forks panel's own fetch (the roster
  // rides loadForks' second call to /agents).
  if (pathname === "/forks") return json(res, { ok: true, base: BASE, clusters: [], lineage: [] });
  // GET /agents — the policy chips' source.
  if (pathname === "/agents") return json(res, AGENTS_OK);
  // GET /checks — the worker-authoritative five checks.
  if (pathname === "/checks") {
    if (checksMode === "fail") return json(res, { ok: false, error: "fixture-down" }, 500);
    return json(res, CHECKS_OK);
  }
  // GET /proposals — mode selects the fixture.
  if (pathname === "/proposals") {
    if (proposalsMode === "empty") return json(res, PROPOSALS_EMPTY);
    if (proposalsMode === "xss") return json(res, PROPOSALS_XSS);
    if (proposalsMode === "null-attestation") return json(res, PROPOSALS_NULL_ATTESTATION);
    return json(res, PROPOSALS_OK);
  }
  // GET /events — newest-first as served.
  if (pathname === "/events") return json(res, EVENTS_OK);
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript(clientCfg));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (file.endsWith("index.html")) {
    const html = readFileSync(file, "utf8").replace(APP_TAG, ERR_COLLECTOR + `<script type="module" src="/__client.js"></script>` + APP_TAG);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

let clientCfg = {};
const parse = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// --- Contract legs ---
function legGovernance(dom) {
  const R = parse(dom);
  if (!R) return check("1: scenario output present", false, "no #test-out");
  if (R.err) return check("1: scenario threw", false, R.err);
  const c = R.s;
  check("1 #rail-section renders", railRegion(dom) !== null, "section missing");
  check("1 the first-load loader is gone", c.loaderGone === true, "loader still present");
  check("1 one band per proposal repo (3)", c.rowCount === 3, `count=${c.rowCount}`);
  check("1 every band carries its repo", JSON.stringify(c.repos) === JSON.stringify(["agent-1", "agent-2", "agent-3"]), JSON.stringify(c.repos));
  check("1 the meta counts the repos", c.meta === "3 repos", String(c.meta));
  // Landing chips: ready / conflict / landed, verbatim.
  const chipsByRepo = {};
  for (const band of c.bands || []) {
    const chip = (band && band.dots) ? null : null;
  }
  const chipMap = {};
  for (const chip of c.chips || []) {
    const m = String(chip.cls || "").match(/rail-chip-(ready|conflict|landed|withheld-secret|unknown)/);
    if (m) chipMap[m[1]] = (chipMap[m[1]] || 0) + 1;
  }
  check("1 the ready chip renders", (chipMap.ready || 0) === 1, JSON.stringify(chipMap));
  check("1 the conflict chip renders", (chipMap.conflict || 0) === 1, JSON.stringify(chipMap));
  check("1 the landed chip renders", (chipMap.landed || 0) === 1, JSON.stringify(chipMap));
  // The genuine text-conflict pair counts on agent-2's band;
  // the clean mergeable pair must NOT count as a collision on
  // agent-1's band (agent-1's collision check is a server fail
  // only because the fixture says so — the clean pair never
  // surfaces as a collision).
  const agent1 = (c.bands || []).find((b) => b.repo === "agent-1");
  const agent1Dots = (agent1 && agent1.dots) || [];
  const agent1Collision = agent1Dots.find((d) => d.id === "collision");
  check("1 agent-1's collision dot carries the server fail state", (agent1Collision && agent1Collision.cls || "").includes("check-fail"), JSON.stringify(agent1Collision));
  // The five checks render in CHECK_IDS order.
  check("1 agent-1 renders exactly five check dots", agent1Dots.length === 5, `count=${agent1Dots.length}`);
  check("1 agent-1's check ids are the five, in order", JSON.stringify(agent1Dots.map((d) => d.id)) === JSON.stringify(["fold", "collision", "conflicts", "secrets", "base"]), JSON.stringify(agent1Dots.map((d) => d.id)));
  // agent-1's checks: one fail (collision) + one unknown (base),
  // the rest pass — the fail and unknown never read as pass.
  const agent1States = agent1Dots.map((d) => (String(d.cls || "").includes("check-fail") ? "fail" : String(d.cls || "").includes("check-unknown") ? "unknown" : String(d.cls || "").includes("check-pass") ? "pass" : "?"));
  check("1 agent-1's checks are pass/fail/pass/pass/unknown", JSON.stringify(agent1States) === JSON.stringify(["pass", "fail", "pass", "pass", "unknown"]), JSON.stringify(agent1States));
  // Policy chips: agent-1 + agent-2 carry policy; agent-3 is
  // unrecorded (absent from the roster).
  const agent3 = (c.bands || []).find((b) => b.repo === "agent-3");
  const agent3Policies = (agent3 && agent3.policies) || [];
  check("1 agent-3 (absent from the roster) renders the unrecorded chip", agent3Policies.some((p) => p === "unrecorded"), JSON.stringify(agent3Policies));
  const agent1Policies = (agent1 && agent1.policies) || [];
  check("1 agent-1 renders its land + secretClass policy", agent1Policies.some((p) => p.includes("land")) && agent1Policies.some((p) => p.includes("manual")), JSON.stringify(agent1Policies));
  // Event trail: agent-1 carries its two events newest-first;
  // agent-2's single event carries NO `at` → the em-dash.
  const agent1Events = (agent1 && agent1.events) || [];
  check("1 agent-1 renders its event trail", agent1Events.length === 2, `count=${agent1Events.length}`);
  check("1 agent-1's events render newest-first as served", agent1Events[0] && agent1Events[0].includes("session.started") === false && agent1Events.some((e) => e.includes("proposal.created")), JSON.stringify(agent1Events));
  const agent2 = (c.bands || []).find((b) => b.repo === "agent-2");
  const agent2Events = (agent2 && agent2.events) || [];
  check("1 agent-2's no-timestamp event renders the em-dash", agent2Events.some((e) => e.endsWith("—")), JSON.stringify(agent2Events));
  // Attestation badge: the landed band (agent-3) ONLY.
  check("1 exactly one attestation badge renders (the landed band)", (c.badges || []).length === 1, `count=${(c.badges || []).length}`);
  check("1 the attestation badge reads 'attested'", (c.badges || [])[0] === "attested", JSON.stringify(c.badges));
  check("1 no uncaught page error", c.errCount === 0, `errCount=${c.errCount}`);
  check("1 no unhandled rejection", c.rejCount === 0, `rejCount=${c.rejCount}`);
}

function legEmpty(dom) {
  const R = parse(dom);
  if (!R) return check("2: scenario output present", false, "no #test-out");
  if (R.err) return check("2: scenario threw", false, R.err);
  const c = R.s;
  check("2 the empty state renders", (c.emptyTitle || []).some((t) => t === `No convergence activity for ${BASE}`), JSON.stringify(c.emptyTitle));
  check("2 the loader is gone", c.loaderGone === true, "loader still present");
  check("2 the meta counts zero repos", c.meta === "0 repos", String(c.meta));
  check("2 no band renders", c.rowCount === 0, `count=${c.rowCount}`);
}

function legNoTimestamp(dom) {
  const R = parse(dom);
  if (!R) return check("3: scenario output present", false, "no #test-out");
  if (R.err) return check("3: scenario threw", false, R.err);
  const c = R.s;
  const agent2 = (c.bands || []).find((b) => b.repo === "agent-2");
  const agent2Events = (agent2 && agent2.events) || [];
  // The event with no `at` renders the em-dash — never a
  // fabricated clock time (which would be an HH:MM:SS span).
  const noAt = agent2Events.find((e) => !/\d{2}:\d{2}:\d{2}/.test(e));
  check("3 the absent-timestamp event renders the em-dash, never a clock time", Boolean(noAt) && noAt.endsWith("—"), JSON.stringify(agent2Events));
  // The events WITH a real `at` render a real clock time.
  const agent1 = (c.bands || []).find((b) => b.repo === "agent-1");
  const agent1Events = (agent1 && agent1.events) || [];
  check("3 the present-timestamp events render a real clock time", agent1Events.every((e) => /\d{2}:\d{2}:\d{2}/.test(e)), JSON.stringify(agent1Events));
}

function legNullAttestation(dom) {
  const R = parse(dom);
  if (!R) return check("4: scenario output present", false, "no #test-out");
  if (R.err) return check("4: scenario threw", false, R.err);
  const c = R.s;
  check("4 the typed-absent attestation renders NO badge", (c.badges || []).length === 0, `count=${(c.badges || []).length}`);
  check("4 the landed chip still renders (status is served)", (c.chips || []).some((ch) => String(ch.cls || "").includes("rail-chip-landed")), JSON.stringify(c.chips));
}

function legUnknownNeverPass(dom) {
  const R = parse(dom);
  if (!R) return check("5: scenario output present", false, "no #test-out");
  if (R.err) return check("5: scenario threw", false, R.err);
  const c = R.s;
  const agent1 = (c.bands || []).find((b) => b.repo === "agent-1");
  const agent1Dots = (agent1 && agent1.dots) || [];
  check("5 with no /checks payload every repo renders five dots", agent1Dots.length === 5, `count=${agent1Dots.length}`);
  check("5 none of the fallback dots is styled check-pass", agent1Dots.every((d) => String(d.cls || "").includes("check-unknown")), JSON.stringify(agent1Dots));
  check("5 every fallback dot is the unknown class", agent1Dots.every((d) => String(d.cls || "") === "check check-unknown"), JSON.stringify(agent1Dots));
}

function legXss(dom) {
  const R = parse(dom);
  if (!R) return check("6: scenario output present", false, "no #test-out");
  if (R.err) return check("6: scenario threw", false, R.err);
  const region = railRegion(dom) || "";
  check("6 the untrusted repo name renders escaped", region.includes("&lt;img src=x onerror=alert(1)&gt;"), region.slice(0, 240));
  check("6 the untrusted intent renders escaped", region.includes("&lt;script&gt;alert(2)&lt;/script&gt;"), region.slice(0, 240));
  check("6 no raw element injected from rail content", !region.includes("<img") && !region.includes("<script>"), region.slice(0, 240));
}

function legZeroErrors(dom) {
  check("7 zero uncaught page errors (data-page-errors=0)", pageErrors(dom) === 0, `data-page-errors=${pageErrors(dom)}`);
}

const scenarios = [
  { name: "1", proposals: "ok", checks: "ok", cfg: { mode: "governance" }, leg: legGovernance },
  { name: "2", proposals: "empty", checks: "ok", cfg: { mode: "empty" }, leg: legEmpty },
  { name: "3", proposals: "ok", checks: "ok", cfg: { mode: "no-timestamp" }, leg: legNoTimestamp },
  { name: "4", proposals: "null-attestation", checks: "ok", cfg: { mode: "null-attestation" }, leg: legNullAttestation },
  { name: "5", proposals: "ok", checks: "fail", cfg: { mode: "unknown-never-pass" }, leg: legUnknownNeverPass },
  { name: "6", proposals: "xss", checks: "ok", cfg: { mode: "xss" }, leg: legXss },
];

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  for (const s of scenarios) {
    proposalsMode = s.proposals;
    checksMode = s.checks;
    clientCfg = s.cfg;
    // A fresh browser profile per scenario (see dumpDom).
    const scenarioDir = mkdtempSync(join(tmpdir(), "nextgit-rail-scenario-"));
    try {
      const { dom, stderr } = await dumpDom(url, scenarioDir);
      s.leg(dom);
      legZeroErrors(dom);
      check(`${s.name}: no Chrome "Uncaught" on stderr`, !/Uncaught/.test(stderr), stderr.split("\n").filter((l) => /Uncaught/.test(l)).slice(0, 2).join(" | "));
    } catch (e) {
      check(`${s.name}: scenario threw`, false, String(e?.stack ?? e));
    } finally {
      rmSync(scenarioDir, { recursive: true, force: true });
    }
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
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
