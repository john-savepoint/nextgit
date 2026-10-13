#!/usr/bin/env bun
// Contract suite: per-proposal checks strip (nextgit-e15-impl-checks-strip).
// Run: bun porting/tests/ui-checks-strip.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui/js/checks.js is (A) imported
// directly in-process for the pure derivation + honesty law, and (B) exercised
// through the shipped UI in real headless Chrome over a loopback origin. The
// only scripted piece is the worker's HTTP surface (which fixture /proposals
// serves) plus an observer injected BEFORE app.js. No mock.module, no source
// grep. A box without a Chrome binary still runs Part A and exits 0.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { proposalChecks, checksStripHtml, CHECK_IDS } from "../../platform/ui/js/checks.js";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const byId = (arr) => Object.fromEntries(arr.map((c) => [c.id, c]));
const VALID_STATES = new Set(["pass", "fail", "unknown"]);

// ---------------------------------------------------------------------------
// Part A — pure derivation (no Chrome, no network). Direct import of the
// shipped module; every leg constructs real proposal/ctx objects.
// ---------------------------------------------------------------------------
{
  const ctx = (over = {}) => ({ base: { repo: "demo", ref: "main", head: "1a".repeat(20) }, conflicts: [], ...over });

  // A1 fold matrix
  {
    const f = (p, c) => byId(proposalChecks(p, c)).fold;
    check("A1 fold ready -> pass", f({ repo: "a", landing: { status: "ready" } }, ctx()).state === "pass");
    check("A1 fold landed -> pass", f({ repo: "a", landing: { status: "landed" } }, ctx()).state === "pass");
    check("A1 fold conflict -> fail", f({ repo: "a", landing: { status: "conflict" } }, ctx()).state === "fail");
    check("A1 fold withheld-secret -> fail", f({ repo: "a", landing: { status: "withheld-secret" } }, ctx()).state === "fail");
    check("A1 fold landing absent -> unknown (never pass)", f({ repo: "a" }, ctx()).state === "unknown");
    check("A1 fold error -> unknown (never pass)", f({ repo: "a", error: "boom", landing: { status: "ready" } }, ctx()).state === "unknown");
  }

  // A2 collision matrix
  {
    const c = (p, conf) => byId(proposalChecks(p, ctx({ conflicts: conf }))).collision;
    check("A2 collision map absent -> unknown", c({ repo: "a" }, undefined).state === "unknown");
    check("A2 no rows -> pass/none", c({ repo: "a" }, []).state === "pass" && c({ repo: "a" }, []).detail === "none");
    const collide = c({ repo: "a" }, [{ file: "src/x.ts", kind: "add/add", repos: ["a", "b"] }]);
    check("A2 member -> fail with kind", collide.state === "fail" && collide.detail.includes("add/add"), JSON.stringify(collide));
    const worst = c({ repo: "a" }, [
      { file: "f1", kind: "mergeable", repos: ["a", "b"] },
      { file: "f2", kind: "text-conflict", repos: ["a", "c"] },
    ]);
    check("A2 worst kind wins", worst.detail.includes("text-conflict"), JSON.stringify(worst));
    const clean = c({ repo: "a" }, [{ file: "src/clean.ts", kind: "mergeable", repos: ["a", "b"] }]);
    check("A2 clean-only shared file -> pass/none (clean kinds are never a conflict)", clean.state === "pass" && clean.detail === "none", JSON.stringify(clean));
  }

  // A3 conflicts count
  {
    const c = (p, conf) => byId(proposalChecks(p, ctx({ conflicts: conf }))).conflicts;
    check("A3 map absent -> unknown", c({ repo: "a" }, undefined).state === "unknown" && c({ repo: "a" }, undefined).detail === "unknown");
    check("A3 zero -> pass detail 0", c({ repo: "a" }, []).state === "pass" && c({ repo: "a" }, []).detail === "0");
    const two = c({ repo: "a" }, [
      { file: "f1", kind: "add/add", repos: ["a", "b"] },
      { file: "f2", kind: "text-conflict", repos: ["a", "c"] },
    ]);
    check("A3 two -> fail detail 2", two.state === "fail" && two.detail === "2", JSON.stringify(two));
    const cleanOnly = c({ repo: "a" }, [{ file: "src/clean.ts", kind: "mergeable", repos: ["a", "b"] }]);
    check("A3 clean-only shared file -> pass detail 0", cleanOnly.state === "pass" && cleanOnly.detail === "0", JSON.stringify(cleanOnly));
  }

  // A4 secrets
  {
    const s = (p, c) => byId(proposalChecks(p, c)).secrets;
    check("A4 files absent -> unknown", s({ repo: "a" }, ctx()).state === "unknown");
    check("A4 no secret rows -> pass/none", s({ repo: "a", files: [{ path: "r.md", secret: false }] }, ctx()).state === "pass");
    check("A4 secret row -> fail", s({ repo: "a", files: [{ path: "c/.env", secret: true, keys: ["K"] }] }, ctx()).state === "fail");
    check("A4 withheld -> fail/withheld", s({ repo: "a", landing: { status: "withheld-secret" } }, ctx()).detail === "withheld");
  }

  // A5 base staleness
  {
    const b = (p, c) => byId(proposalChecks(p, c)).base;
    check("A5 no change-set -> unknown", b({ repo: "a" }, ctx()).state === "unknown");
    check("A5 no base.head -> unknown", b({ repo: "a" }, ctx({ base: { repo: "demo" }, changeSet: { base: { sha: "x" } } })).state === "unknown");
    const fresh = b({ repo: "a" }, ctx({ changeSet: { base: { sha: "1a".repeat(20) } } }));
    check("A5 fork == base head -> pass", fresh.state === "pass", JSON.stringify(fresh));
    const stale = b({ repo: "a" }, ctx({ changeSet: { base: { sha: "9z".repeat(20) } } }));
    check("A5 fork != base head -> fail", stale.state === "fail", JSON.stringify(stale));
  }

  // A6 HONESTY REGISTRY — the acceptance as an invariant.
  {
    const bare = proposalChecks({}, { base: {}, conflicts: undefined });
    check("A6 strip always returns exactly CHECK_IDS", bare.length === CHECK_IDS.length && bare.map((c) => c.id).join(",") === CHECK_IDS.join(","));
    check("A6 every state is in the tri-state set", bare.every((c) => VALID_STATES.has(c.state)));
    check("A6 absent payload -> every check is `unknown`, none `pass`", bare.every((c) => c.state === "unknown"), JSON.stringify(bare.map((c) => [c.id, c.state])));
    const errd = proposalChecks({ repo: "a", error: "x" }, { conflicts: undefined });
    check("A6 errored proposal -> no check is `pass`", errd.every((c) => c.state !== "pass"), JSON.stringify(errd.map((c) => [c.id, c.state])));
  }

  // A7 escaping + display-only (conflict file / repo are attacker-influenced)
  {
    const evil = '<img src=x onerror="window.__xss=1">';
    const html = checksStripHtml(
      { repo: "agent-1", landing: { status: "ready" }, files: [{ path: "config/.env", secret: true, keys: ["DATABASE_URL"] }] },
      { base: { head: "1a".repeat(20) }, conflicts: [{ file: evil, kind: "text-conflict", repos: ["agent-1", "agent-2"] }] },
    );
    check("A7 raw tag is escaped (no live <img>)", !/<img/i.test(html) && html.includes("&lt;img"));
    check("A7 no <button> / data-action (display-only)", !/<button/i.test(html) && !/data-action/.test(html));
    check("A7 no secret key/value leaks", !html.includes("DATABASE_URL") && !html.includes("config/.env"));
    check("A7 unknown maps to check-unknown only", (() => {
      const h = checksStripHtml({ repo: "a" }, { conflicts: undefined });
      return /class="check check-unknown"/.test(h) && !/check-pass/.test(h);
    })());
  }
}

// ---------------------------------------------------------------------------
// Part B — loopback Chrome. Two payload dumps:
//   KNOWN — conflicts present (incl. an XSS-shaped file name); known legs.
//   BARE  — conflicts ABSENT; target card has no landing/files -> all 5 unknown.
// ---------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  ui-checks-strip (Part B) — no Chrome binary on PATH; Part A ran above");
} else {
  const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-checks-"));
  const dumpDom = (url, budget = 10000) =>
    new Promise((resolve, reject) => {
      const child = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("chrome timed out after 10s")); }, 10000);
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`chrome exited with ${code}`)); });
    });
  const parse = (dom) => { const m = dom.match(/id="test-out"[^>]*>([^<]*)</); return m ? JSON.parse(decodeURIComponent(m[1])) : null; };

  const XSS_FILE = '"><img src=x onerror="window.__xss=1">';
  const KNOWN = {
    ok: true, base: { repo: "demo", ref: "main", head: "1a".repeat(20) }, ref: "main",
    summary: { proposals: 3, sharedFiles: 1, conflictingPairs: 1, changedFiles: 3, cleanPairs: 0 },
    proposals: [
      { repo: "agent-ready", head: "2b".repeat(20), landing: { status: "ready", files: 1 }, stats: { files: 1, additions: 4, deletions: 0 }, files: [{ path: "README.md", status: "modified", secret: false }] },
      { repo: "agent-secret", head: "3c".repeat(20), landing: { status: "withheld-secret", files: 1 }, stats: { files: 1, additions: 2, deletions: 0 }, files: [{ path: "config/.env", status: "modified", secret: true, keys: ["DATABASE_URL"] }] },
      { repo: "agent-collide", head: "4d".repeat(20), landing: { status: "ready", files: 1 }, stats: { files: 1, additions: 9, deletions: 1 }, files: [{ path: "src/auth.ts", status: "modified", secret: false }] },
    ],
    conflicts: [{ file: XSS_FILE, kind: "text-conflict", repos: ["agent-collide", "agent-elsewhere"], pairs: [{ a: "agent-collide", b: "agent-elsewhere", kind: "text-conflict", conflict: true }] }],
  };
  const BARE = {
    ok: true, base: { repo: "demo", ref: "main" }, ref: "main",
    summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 0, cleanPairs: 0 },
    proposals: [{ repo: "agent-bare", head: "5e".repeat(20), stats: { files: 1, additions: 1, deletions: 0 } }],
    // conflicts deliberately ABSENT — the unknown leg.
  };
  // LONG — one unbreakable collision token in the conflict map (the card's file list
  // stays short, so the ONLY long token is the collision chip's detail). Constraining
  // the grid to the 320px reflow floor must then keep the card/chip inside its box.
  const LONG_FILE = "d".repeat(220);
  const LONG = {
    ok: true, base: { repo: "demo", ref: "main", head: "1a".repeat(20) }, ref: "main",
    summary: { proposals: 1, sharedFiles: 1, conflictingPairs: 1, changedFiles: 1, cleanPairs: 0 },
    proposals: [
      { repo: "agent-long", head: "6f".repeat(20), landing: { status: "ready", files: 1 }, stats: { files: 1, additions: 1, deletions: 0 }, files: [{ path: "README.md", status: "modified", secret: false }] },
    ],
    conflicts: [{ file: LONG_FILE, kind: "text-conflict", repos: ["agent-long", "agent-other"], pairs: [{ a: "agent-long", b: "agent-other", kind: "text-conflict", conflict: true }] }],
  };
  const EVENTS = { ok: true, events: [] };
  const JUDGE = { ok: true, judgments: [], skipped: [] };

  const clientScript = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { cards: {}, err: null };
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const readStrip = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  const strip = c.querySelector(".checks-strip");
  if (!strip) return { present: false };
  const chips = [...strip.querySelectorAll("[data-check]")].map((el) => ({
    id: el.getAttribute("data-check"),
    hasPass: el.classList.contains("check-pass"),
    hasFail: el.classList.contains("check-fail"),
    hasUnknown: el.classList.contains("check-unknown"),
    detail: el.querySelector(".check-detail") ? el.querySelector(".check-detail").textContent.trim() : null,
  }));
  return {
    present: true,
    role: strip.getAttribute("role"),
    chips,
    imgCount: strip.querySelectorAll("img").length,
    interactive: strip.querySelectorAll("[data-action],button").length,
    text: strip.textContent,
  };
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(900);
    for (const repo of ["agent-ready", "agent-secret", "agent-collide", "agent-bare", "agent-long"]) R.cards[repo] = readStrip(repo);
    // Reflow probe: constrain the proposals grid to the WCAG 1.4.10 320px floor, then
    // measure whether a long collision token forces the card/chip past that box.
    const grid = document.getElementById("proposals-grid");
    const longCard = cardOf("agent-long");
    if (grid && longCard) {
      grid.style.width = "320px";
      void grid.offsetWidth;
      const gr = grid.getBoundingClientRect();
      const cr = longCard.getBoundingClientRect();
      const chip = longCard.querySelector('.check[data-check="collision"]');
      R.layout = {
        gridScrollWidth: grid.scrollWidth, gridClientWidth: grid.clientWidth, gridRight: gr.right,
        cardRight: cr.right, cardWidth: cr.width,
        chipRight: chip ? chip.getBoundingClientRect().right : null,
        chipScrollWidth: chip ? chip.scrollWidth : null, chipClientWidth: chip ? chip.clientWidth : null,
      };
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div"); d.id = "test-out"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);
});`;

  const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const json = (res, body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  let MODE = "known";
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://127.0.0.1");
    if (pathname === "/proposals") return json(res, MODE === "bare" ? BARE : MODE === "long" ? LONG : KNOWN);
    if (pathname === "/events") return json(res, EVENTS);
    if (pathname === "/judge") return json(res, JUDGE);
    if (pathname === "/__client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(clientScript); return; }
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = join(UI, rel);
    if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    if (rel === "index.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(file, "utf8").replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG)); return; }
    res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
    res.end(readFileSync(file));
  });

  try {
    const port = await new Promise((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); });
    const url = `http://127.0.0.1:${port}/`;

    // ---- Dump 1 (KNOWN): strip visible + known legs + XSS
    MODE = "known";
    const dom1 = await dumpDom(url);
    const R1 = parse(dom1);
    if (!R1) { check("B1 scenario output present", false, "no #test-out"); }
    else if (R1.err) { check("B1 scenario threw", false, R1.err); }
    else {
      const ready = R1.cards["agent-ready"], secretCard = R1.cards["agent-secret"], collide = R1.cards["agent-collide"];
      const chip = (card, id) => (card && card.present ? card.chips.find((c) => c.id === id) : null);
      check("B1 strip present on every card", ready?.present && secretCard?.present && collide?.present);
      check("B1 strip carries all five checks", ready?.present && ready.chips.length === 5 && CHECK_IDS.every((id) => ready.chips.some((c) => c.id === id)));
      check("B1 no interactive affordance in the strip", ready?.interactive === 0 && collide?.interactive === 0);
      check("B2 ready card fold -> pass/folds clean", chip(ready, "fold")?.hasPass === true && chip(ready, "fold")?.detail === "folds clean");
      check("B2 ready card secrets -> pass/none", chip(ready, "secrets")?.hasPass === true && chip(ready, "secrets")?.detail === "none");
      check("B2 secret card fold -> fail", chip(secretCard, "fold")?.hasFail === true);
      check("B2 secret card secrets -> fail/withheld", chip(secretCard, "secrets")?.hasFail === true && chip(secretCard, "secrets")?.detail === "withheld");
      check("B3 colliding card collision -> fail (text-conflict)", chip(collide, "collision")?.hasFail === true && (chip(collide, "collision")?.detail || "").includes("text-conflict"));
      check("B3 colliding card conflicts count -> fail/1", chip(collide, "conflicts")?.hasFail === true && chip(collide, "conflicts")?.detail === "1");
      check("B3 non-colliding card collision -> pass/none", chip(ready, "collision")?.hasPass === true);
      check("B4 base is unknown on every card (set payload carries no fork point)",
        ["agent-ready", "agent-secret", "agent-collide"].every((r) => chip(R1.cards[r], "base")?.hasUnknown === true && chip(R1.cards[r], "base")?.hasPass === false));
      check("B5 every chip is exactly one tri-state (never pass+unknown)",
        [ready, secretCard, collide].every((card) => card.present && card.chips.every((c) => [c.hasPass, c.hasFail, c.hasUnknown].filter(Boolean).length === 1)));
      check("B6 XSS file name rendered escaped (no live <img> in the strip)", collide?.imgCount === 0 && (collide?.text || "").includes(XSS_FILE));
      check("B6 no secret key leaks into any strip", [ready, secretCard, collide].every((card) => !(card?.text || "").includes("DATABASE_URL")));
      check("B8 strip role is a labelled group (valid chip-group semantics, never role=list)",
        ready?.role === "group" && collide?.role === "group", JSON.stringify([ready?.role, collide?.role]));
    }

    // ---- Dump 2 (BARE): the pinned unknown-state leg
    MODE = "bare";
    const dom2 = await dumpDom(url);
    const R2 = parse(dom2);
    if (!R2) { check("B7 scenario output present", false, "no #test-out"); }
    else if (R2.err) { check("B7 scenario threw", false, R2.err); }
    else {
      const bare = R2.cards["agent-bare"];
      check("B7 bare card strip present", bare?.present === true);
      check("B7 UNKNOWN LEG: absent payload -> all five checks are check-unknown",
        bare?.present && bare.chips.length === 5 && bare.chips.every((c) => c.hasUnknown === true), JSON.stringify(bare?.chips));
      check("B7 UNKNOWN LEG: no check is rendered as pass",
        bare?.present && bare.chips.every((c) => c.hasPass === false));
      check("B7 unknown fold detail is not a pass phrase",
        (bare?.chips.find((c) => c.id === "fold")?.detail || "") !== "folds clean");
    }

    // ---- Dump 3 (LONG): grid constrained to the 320px reflow floor — a long unbroken
    //      collision token must not force the card/chip past its box (WCAG 1.4.10).
    MODE = "long";
    const dom3 = await dumpDom(url);
    const R3 = parse(dom3);
    if (!R3) { check("B9 scenario output present", false, "no #test-out"); }
    else if (R3.err) { check("B9 scenario threw", false, R3.err); }
    else {
      const long = R3.cards["agent-long"];
      check("B9 long-token card strip present", long?.present === true);
      check("B9 collision chip carries the long unbroken token",
        (long?.chips.find((c) => c.id === "collision")?.detail || "").includes(LONG_FILE));
      check("B9 REFLOW: grid does not overflow at the 320px floor",
        R3.layout && R3.layout.gridScrollWidth <= R3.layout.gridClientWidth + 1, JSON.stringify(R3.layout));
      check("B9 REFLOW: collision chip stays inside its card",
        R3.layout && R3.layout.chipRight !== null && R3.layout.chipRight <= R3.layout.cardRight + 1, JSON.stringify(R3.layout));
    }
  } catch (e) {
    check("harness setup failed", false, String(e?.message ?? e));
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve) => { const t = setTimeout(resolve, 1000); server.close(() => { clearTimeout(t); resolve(); }); });
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
