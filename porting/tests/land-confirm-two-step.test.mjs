#!/usr/bin/env bun
// Contract suite: FR-15 outcomes 1-2 — the card's two-step confirm (Land into demo ->
// inline confirm land?/cancel -> landing... plus the in-flight warn banner copy).
// Story: e3-verify-card-confirm-in-flight.
// Run: bun porting/tests/land-confirm-two-step.test.mjs   (exit 0 = pass)
// Live leg: PROPS_FIXTURE=<path to a /proposals capture> bun porting/tests/land-confirm-two-step.test.mjs
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in a real
// headless Chrome over a loopback origin. The only scripted pieces are the worker's HTTP
// surface (the /proposals payload and how /land answers; every request URL is recorded)
// and an observer module injected BEFORE app.js that records what the real app rendered
// and clicks the real controls — no product mocks, no source grep. Legs:
//   1. the two-step on a real canvas (fixture: agent-1 ready + agent-2 landed):
//      rest -> `preview merge` + `Land into demo`; clicking `Land into demo` flips the
//      acted card to exactly one `confirm land?` + `cancel` (exact labels, the acted
//      repo), the default pair replaced, every other card unchanged, the modal hidden,
//      no dialog, and ZERO /land requests (start-land only sets state and re-renders);
//      `cancel` returns the card to its default pair with still zero /land requests;
//      `confirm land?` leaves the acted card with exactly ONE control — a disabled
//      `landing...` button — and the single action banner visible on `banner-warn`,
//      badge `landing`, copy exactly "Landing proposal {repo} into {base}...", with
//      exactly ONE /land request sent (confirm-land is the sole branch that calls
//      handleLandProposal) that stays one after the response settles.
//   2. live capture (PROPS_FIXTURE): leg 1's battery verbatim over the live payload —
//      card-count independent (exactly one card changes shape; counts are relative);
//      requires >= 1 landable proposal + the reviewed anchors; unset -> one SKIP line.
// A box without a Chrome binary skips the suite (precedent: action-banner-states /
// ui-land-reviewed-heads / conflict-map-render; the order's acceptance gate hard-requires
// Chrome).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = `<script type="module" src="app.js"></script>`;
const COMMIT = "0123456789abcdef";

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
  console.log("SKIP  FR-15 two-step confirm — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-confirm-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking exec
// would deadlock the very fetch the page is waiting on.
const dumpDom = (url, budget = 30000) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", `--virtual-time-budget=${budget}`, `--user-data-dir=${userDataDir}`, "--dump-dom", url],
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

const parseScenario = (dom) => {
  const m = dom.match(/id="test-out"[^>]*>([^<]*)</);
  return m ? JSON.parse(decodeURIComponent(m[1])) : null;
};

// The fixture payload: two proposals, exactly one landable (agent-1) and one already
// landed (agent-2). The landed card lets the contract prove the flip is SCOPED to the
// acted card (its shape must be byte-identical before/after). Reviewed-state anchors
// (FR-16): the canvas binds each land to base.head + the row head, so a heads-less
// payload is refused by the canvas by design — the fixture carries them.
const BASE_HEAD = "1a".repeat(20);
const AGENT1_HEAD = "2b".repeat(20);
const AGENT2_HEAD = "3c".repeat(20);

const FIXTURE = {
  ok: true,
  base: { repo: "demo", ref: "main", head: BASE_HEAD },
  ref: "main",
  summary: { proposals: 2, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      head: AGENT1_HEAD,
      intent: "harden the auth flow",
      landing: { status: "ready" },
      stats: { files: 1, additions: 3, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }],
    },
    {
      repo: "agent-2",
      head: AGENT2_HEAD,
      intent: "document the baseline",
      landing: { status: "landed" },
      stats: { files: 1, additions: 1, deletions: 0 },
      files: [{ path: "README.md", status: "modified", additions: 1, deletions: 0, secret: false }],
    },
  ],
  conflicts: [],
};

// Observer + driver, injected BEFORE app.js. Every interaction is guarded so a broken
// state still yields per-clause observations instead of masking them behind one throw.
// No interpolation markers in the body — this string is itself template-interpolated once.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const dialogs = { confirm: false, alert: false, prompt: false };
window.confirm = () => { dialogs.confirm = true; return true; };
window.alert = () => { dialogs.alert = true; };
window.prompt = () => { dialogs.prompt = true; return ""; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const banner = () => document.getElementById("action-banner");
const bannerHidden = () => { const b = banner(); return b ? b.hidden === true : null; };
const SEL_START = '[data-action="start-land"]';
const SEL_CONF = '[data-action="confirm-land"]';
const SEL_CANCEL = '[data-action="cancel-land"]';
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const actionsOf = (card) => (card ? card.querySelector(".proposal-actions") : null);
const shapeOf = (card) => {
  const a = actionsOf(card);
  if (!a) return null;
  const bs = [...a.querySelectorAll("button")];
  const badge = a.querySelector("span.badge");
  return {
    count: bs.length,
    texts: bs.map((b) => b.textContent.trim()),
    repos: bs.map((b) => b.getAttribute("data-repo")),
    disabled: bs.map((b) => b.disabled === true),
    badge: badge ? badge.textContent.trim() : null,
  };
};
const allShapes = () => {
  const out = {};
  for (const c of document.querySelectorAll(".proposal-card")) out[c.id] = JSON.stringify(shapeOf(c));
  return out;
};
const landPosts = () => R.f.filter((x) => x === "/land").length;
const clickSel = (repo, sel) => {
  const c = cardOf(repo);
  const b = c && c.querySelector(sel);
  if (!b) { R.c.missing = (R.c.missing || []).concat(sel + " on " + repo); return null; }
  b.click();
  return b;
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(600);
    const start = qs(SEL_START);
    if (!start) { R.c.noStart = true; } else {
      R.repo = start.getAttribute("data-repo");
      R.c.startText = start.textContent.trim();
      R.c.restShape = shapeOf(cardOf(R.repo));
      R.c.restShapes = allShapes();
      R.c.restBannerHidden = bannerHidden();
      R.c.restModalHidden = q("inspector-modal").hidden === true;
      R.c.restStarts = document.querySelectorAll(SEL_START).length;
      R.c.restConfs = document.querySelectorAll(SEL_CONF).length;
      R.c.restCancels = document.querySelectorAll(SEL_CANCEL).length;
      R.c.restLands = landPosts();
      start.click();
      const conf = cardOf(R.repo) && cardOf(R.repo).querySelector(SEL_CONF);
      const cancel = cardOf(R.repo) && cardOf(R.repo).querySelector(SEL_CANCEL);
      R.c.armedShape = shapeOf(cardOf(R.repo));
      R.c.armedConfText = conf ? conf.textContent.trim() : null;
      R.c.armedCancelText = cancel ? cancel.textContent.trim() : null;
      R.c.armedConfRepo = conf ? conf.getAttribute("data-repo") : null;
      R.c.armedCancelRepo = cancel ? cancel.getAttribute("data-repo") : null;
      R.c.armedShapes = allShapes();
      R.c.armedStarts = document.querySelectorAll(SEL_START).length;
      R.c.armedConfs = document.querySelectorAll(SEL_CONF).length;
      R.c.armedCancels = document.querySelectorAll(SEL_CANCEL).length;
      R.c.armedBannerHidden = bannerHidden();
      R.c.armedModalHidden = q("inspector-modal").hidden === true;
      R.c.armedLands = landPosts();
      if (cancel) cancel.click();
      R.c.cancelShape = shapeOf(cardOf(R.repo));
      R.c.cancelBannerHidden = bannerHidden();
      R.c.cancelModalHidden = q("inspector-modal").hidden === true;
      R.c.cancelLands = landPosts();
      if (clickSel(R.repo, SEL_START)) clickSel(R.repo, SEL_CONF);
      // The click prefix of handleLandProposal is synchronous: the in-flight card state
      // and the warn banner are readable before any await.
      R.c.liveShape = shapeOf(cardOf(R.repo));
      R.c.liveBannerHidden = bannerHidden();
      R.c.liveBannerClass = banner().className;
      R.c.liveBadge = q("action-banner-badge").textContent.trim();
      R.c.liveMsg = q("action-banner-msg").textContent.trim();
      R.c.liveBannerCount = document.querySelectorAll("#action-banner").length;
      R.c.liveModalHidden = q("inspector-modal").hidden === true;
      R.c.liveLands = landPosts();
      await sleep(900);
      R.c.settledLands = landPosts();
      R.c.settledConfs = document.querySelectorAll(SEL_CONF).length;
      R.c.settledCancels = document.querySelectorAll(SEL_CANCEL).length;
    }
    R.c.dialogs = dialogs;
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// The FR-15 two-step contract (observations from the injected driver).
// ---------------------------------------------------------------------------
const DEFAULT_PAIR = ["preview merge", "Land into demo"];
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function twoStepContract(label, dom, obs, payload) {
  const runner = `${label} `;
  if (!obs) {
    check(`${runner}scenario output present (chrome + observer ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${runner}scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  const repo = obs.repo;
  const baseRepo = (payload && payload.base && payload.base.repo) || "demo";
  const rest = c.restShape;
  const armed = c.armedShape;
  const live = c.liveShape;

  check(`${runner}driver found a landable card`, c.noStart !== true && typeof repo === "string", `repo=${repo}`);
  check(`${runner}every control the flow needs was reachable`, !c.missing, JSON.stringify(c.missing));

  // --- rest ------------------------------------------------------------------
  check(`${runner}rest: acted card offers exactly preview merge + Land into demo (exact labels)`,
    !!rest && rest.count === 2 && jsonEq(rest.texts, DEFAULT_PAIR) && jsonEq(rest.disabled, [false, false]),
    JSON.stringify(rest));
  check(`${runner}rest: clicked control is the Land into demo action`, c.startText === "Land into demo", JSON.stringify(c.startText));
  check(`${runner}rest: no card carries a confirm/cancel control`, c.restConfs === 0 && c.restCancels === 0, `conf=${c.restConfs} cancel=${c.restCancels}`);
  check(`${runner}rest: no /land request went out before any action`, c.restLands === 0, `posts=${c.restLands}`);
  check(`${runner}rest: no action banner, modal hidden`, c.restBannerHidden === true && c.restModalHidden === true, `bannerHidden=${c.restBannerHidden} modalHidden=${c.restModalHidden}`);

  // --- armed (after `Land into demo`) ----------------------------------------
  check(`${runner}armed: exactly one confirm land? + cancel pair on the canvas`,
    c.armedConfs === 1 && c.armedCancels === 1, `conf=${c.armedConfs} cancel=${c.armedCancels}`);
  check(`${runner}armed: the pair sits in the acted card with the exact labels`,
    !!armed && armed.count === 2 && jsonEq(armed.texts, ["confirm land?", "cancel"]),
    JSON.stringify(armed));
  check(`${runner}armed: both armed controls carry the acted repo`,
    c.armedConfText === "confirm land?" && c.armedCancelText === "cancel" && c.armedConfRepo === repo && c.armedCancelRepo === repo,
    `${c.armedConfText}/${c.armedCancelText} repos=${c.armedConfRepo},${c.armedCancelRepo}`);
  check(`${runner}armed: the acted card's default pair is replaced`,
    !!armed && !armed.texts.includes("preview merge") && !armed.texts.includes("Land into demo") && c.armedStarts === c.restStarts - 1,
    `texts=${JSON.stringify(armed && armed.texts)} starts=${c.armedStarts} rest=${c.restStarts}`);
  const changed = Object.keys(c.armedShapes || {}).filter((k) => c.armedShapes[k] !== c.restShapes[k]);
  check(`${runner}armed: no other card changed shape`, jsonEq(changed, ["card-" + repo]), JSON.stringify(changed));
  check(`${runner}armed: inline — modal hidden, banner not shown`,
    c.armedModalHidden === true && c.armedBannerHidden === true,
    `modal=${c.armedModalHidden} bannerHidden=${c.armedBannerHidden}`);
  check(`${runner}armed: start-land sent no /land request (it only sets state and re-renders)`,
    c.armedLands === 0, `posts=${c.armedLands}`);

  // --- cancel ----------------------------------------------------------------
  check(`${runner}cancel: the acted card returns to its default pair`, jsonEq(c.cancelShape, rest), JSON.stringify(c.cancelShape));
  check(`${runner}cancel: zero /land requests were sent`, c.cancelLands === 0, `posts=${c.cancelLands}`);
  check(`${runner}cancel: no banner, modal hidden`, c.cancelBannerHidden === true && c.cancelModalHidden === true, `banner=${c.cancelBannerHidden} modal=${c.cancelModalHidden}`);

  // --- confirmed (after `confirm land?`) -------------------------------------
  check(`${runner}confirm: the acted card holds exactly one control — a disabled landing... button`,
    !!live && live.count === 1 && live.texts[0] === "landing..." && live.disabled[0] === true,
    JSON.stringify(live));
  check(`${runner}confirm: no default control remains on the acted card`,
    !!live && !live.texts.includes("preview merge") && !live.texts.includes("Land into demo"),
    JSON.stringify(live && live.texts));
  check(`${runner}confirm: warn banner visible with badge 'landing'`,
    c.liveBannerHidden === false && String(c.liveBannerClass || "").includes("banner-warn") && c.liveBadge === "landing",
    `${c.liveBannerClass} badge=${c.liveBadge}`);
  check(`${runner}confirm: in-flight copy exact`, c.liveMsg === `Landing proposal ${repo} into ${baseRepo}...`, JSON.stringify(c.liveMsg));
  check(`${runner}confirm: exactly one action banner element`, c.liveBannerCount === 1, `count=${c.liveBannerCount}`);
  check(`${runner}confirm: modal hidden through the click-through`, c.liveModalHidden === true, `modal=${c.liveModalHidden}`);
  check(`${runner}confirm-land sent exactly one /land request (the only POST branch)`, c.liveLands === 1, `posts=${c.liveLands}`);
  check(`${runner}still exactly one /land request after the response settled`, c.settledLands === 1, `posts=${c.settledLands}`);
  check(`${runner}no card left armed after the confirm`, c.settledConfs === 0 && c.settledCancels === 0, `conf=${c.settledConfs} cancel=${c.settledCancels}`);
  const d = c.dialogs || {};
  check(`${runner}no browser dialog was invoked during the click-through`, d.confirm !== true && d.alert !== true && d.prompt !== true, JSON.stringify(d));
  check(`${runner}dom dump holds exactly one action-banner element`, (String(dom).match(/id="action-banner"/g) || []).length === 1);
}

// ---------------------------------------------------------------------------
// Loopback worker surface: serves the payload and answers /land with the success
// envelope (the success/error banner vocabulary is action-banner-states' territory).
// ---------------------------------------------------------------------------
let payload = FIXTURE;
let landServed = 0;

const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [{ type: "push", repo: "agent-2", at: "2026-10-07T10:00:01Z" }] }));
    return;
  }
  if (pathname === "/land") {
    landServed++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, landed: { commit: COMMIT } }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, judgments: [], skipped: [] }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  if (pathname === "/__client.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(clientScript("two-step"));
    return;
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (rel === "index.html") {
    const html = readFileSync(file, "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html.replace(APP_TAG, `<script type="module" src="/__client.js"></script>` + APP_TAG));
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

const resetServer = (next) => {
  payload = (next && next.payload) || FIXTURE;
  landServed = 0;
};

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // --- 1. the two-step on the deterministic fixture ---------------------------
  try {
    resetServer({ payload: FIXTURE });
    const dom = await dumpDom(url);
    twoStepContract("1", dom, parseScenario(dom), FIXTURE);
  } catch (e) {
    check("1 two-step case threw", false, String((e && e.stack) || e));
  }

  // --- 2. live capture: the order's ceremony writes /proposals to a file ------
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  2 live capture - PROPS_FIXTURE unset (pass a /proposals capture from the ceremony)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      const props = Array.isArray(live?.proposals) ? live.proposals : [];
      const landable = props.filter((p) => ((p?.landing?.status ?? "ready") !== "landed"));
      const baseOk = typeof live?.base?.repo === "string" && live.base.repo.length > 0 && typeof live?.base?.ref === "string" && live.base.ref.length > 0;
      const anchorsPresent = typeof live?.base?.head === "string" && landable.some((p) => typeof p?.head === "string");
      if (landable.length < 1) {
        console.log("SKIP  2 live capture has no landable proposal - the live demo is fully landed");
      } else if (!baseOk) {
        check("2 live capture carries base.repo + base.ref", false, JSON.stringify(live?.base));
      } else if (!anchorsPresent) {
        console.log("SKIP  2 live capture lacks the reviewed anchors (base.head / row heads) - deploy-gated");
      } else {
        check("2 live capture carries >= 1 landable proposal", true, `landable=${landable.length}`);
        check("2 live capture carries base.repo + base.ref", true, JSON.stringify(live?.base));
        resetServer({ payload: live });
        const dom = await dumpDom(url);
        twoStepContract("2", dom, parseScenario(dom), live);
      }
    } catch (e) {
      check("2 live-capture case threw", false, String((e && e.stack) || e));
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
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
