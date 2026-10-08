#!/usr/bin/env bun
// Contract suite: FR-16 (UI half) — the canvas binds every land to the revision
// the reviewer saw. handleLandProposal must send POST /land with
// reviewed.baseHead === the rendered base head and reviewed.heads[repo] === the
// rendered proposal-row head; a 409 stale shows the dedicated banner, returns the
// card to default, and refreshes the set so the reviewer re-reviews before the
// next confirm; a land whose anchors are absent is refused fail-closed (never a
// silent unbound land). Story: e3-impl-ui-reviewed-precondition.
// Run: bun porting/tests/ui-land-reviewed-heads.test.mjs   (exit 0 = pass)
// Live leg: REVIEWED_FIXTURE=<path to a captured /proposals body> bun porting/tests/ui-land-reviewed-heads.test.mjs
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in a
// real headless Chrome over a loopback origin. The only scripted pieces are the
// worker's HTTP surface (the /proposals payload generations and how /land answers,
// with every /land request body recorded as received) and an observer module
// injected BEFORE app.js that records what the real app rendered and clicks the
// real controls — no product mocks, no source grep. Legs:
//   1. binding: one confirm cycle over a heads-carrying payload — the single
//      recorded /land body carries reviewed.baseHead exactly the rendered base
//      head and reviewed.heads[repo] exactly the rendered row head (exact key
//      sets), and the success path is today's (banner + chip + default card).
//   2. stale: the first /land answers 409 stale and the set moves (H1 -> H2); the
//      dedicated stale banner shows, the card returns to default, the set is
//      refetched and re-rendered (canvas stats +3 -> +5), and confirming again
//      sends the REFRESHED anchors and succeeds.
//   3. fail-closed: a heads-less payload (the pre-deploy /proposals shape) —
//      confirming sends NO /land at all, the refusal banner shows, the card
//      returns to default, the set is refetched.
//   4. live capture (REVIEWED_FIXTURE): the anchoring battery over the live
//      payload; unset -> one SKIP line; a capture without base.head (the live
//      worker pre-deploy) -> one SKIP line — the anchors ship with the wave
//      deploy.
// A box without a Chrome binary skips the suite (precedent: action-banner-states /
// conflict-map-render / ui-first-load-panels).

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
const J = (x) => JSON.stringify(x);
const sha = (b) => String(b).repeat(20); // 40 hex chars
const BASE_H1 = sha("1a");
const BASE_H2 = sha("1b");
const A1_H1 = sha("2a");
const A1_H2 = sha("2b");
const STALE_COPY = "This proposal is stale — rebase and re-push to land.";
const GUARD_COPY = "Failed to land agent-1: reviewed heads unavailable — refresh and re-review.";

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  FR-16 reviewed-heads land binding — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-reviewed-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a blocking
// exec would deadlock the very fetch the page is waiting on.
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
const exactKeys = (obj, keys) => !!obj && J(Object.keys(obj).sort()) === J([...keys].sort());
const defaultShape = (s) => s && s.start === true && s.preview === true && s.confirm === false && s.disabled === false;

// ---------------------------------------------------------------------------
// Payload generations. v2 moves BOTH anchors and changes the additions count so
// the refreshed render is distinguishable on the canvas.
// ---------------------------------------------------------------------------
const payloadWith = (baseHead, rowHead, additions) => ({
  ok: true,
  base: { repo: "demo", ref: "main", head: baseHead },
  ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      head: rowHead,
      intent: "harden the auth flow",
      landing: { status: "ready", files: 1 },
      stats: { files: 1, added: 0, modified: 1, removed: 0, additions, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions, deletions: 1, secret: false }],
    },
  ],
  conflicts: [],
});
const FIXTURE_H1 = payloadWith(BASE_H1, A1_H1, 3);
const FIXTURE_H2 = payloadWith(BASE_H2, A1_H2, 5);
// Post-land variant: after a successful /land, the next /proposals fetch must
// reflect landing.status === "landed" so renderProposals shows the landed-banner.
// Immutable sibling to FIXTURE_H1 (mirrors event-debounce-land-reload.test.mjs:80-105).
const POST_LAND = (() => {
  const c = JSON.parse(JSON.stringify(FIXTURE_H1));
  c.proposals[0].landing = { status: "landed", files: 1 };
  return c;
})();

const POST_LAND_STALE = (() => {
  const c = JSON.parse(JSON.stringify(FIXTURE_H2));
  c.proposals[0].landing = { status: "landed", files: 1 };
  return c;
})();
// The pre-deploy read-surface shape (recorded live 2026-10-07): no anchors anywhere.
const FIXTURE_HEADLESS = {
  ok: true,
  base: { repo: "demo", ref: "main" },
  ref: "main",
  summary: { proposals: 1, sharedFiles: 0, conflictingPairs: 0, changedFiles: 1, cleanPairs: 0 },
  proposals: [
    {
      repo: "agent-1",
      intent: "harden the auth flow",
      landing: { status: "ready", files: 1 },
      stats: { files: 1, added: 0, modified: 1, removed: 0, additions: 3, deletions: 1 },
      files: [{ path: "src/auth.ts", status: "modified", additions: 3, deletions: 1, secret: false }],
    },
  ],
  conflicts: [],
};

// Observer + driver, injected BEFORE app.js. Every interaction is guarded so a
// broken state still yields per-clause observations instead of masking them.
const clientScript = (mode) => `const MODE = ${JSON.stringify(mode)};
const R = { f: [], c: {} };
const of = window.fetch.bind(window);
window.fetch = (u, o) => { R.f.push(String(u)); return of(u, o); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = (u) => R.f.filter((x) => x === u).length;
const q = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const banner = () => document.getElementById("action-banner");
const bannerHidden = () => { const b = banner(); return b ? b.hidden === true : null; };
const cardOf = (repo) => document.getElementById("card-" + CSS.escape(repo));
const SEL_START = '[data-action="start-land"]';
const SEL_CONF = '[data-action="confirm-land"]';
const readDefault = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  return {
    start: !!c.querySelector(SEL_START),
    preview: !!c.querySelector(".btn-preview-merge"),
    confirm: !!c.querySelector(SEL_CONF),
    disabled: !!c.querySelector(".btn-land[disabled]"),
  };
};
const readLanded = (repo) => {
  const c = cardOf(repo);
  if (!c) return null;
  return {
    isLanded: c.classList.contains("is-landed"),
    banner: c.querySelector(".landed-banner") ? c.querySelector(".landed-banner").textContent : null,
  };
};
const readBanner = () => ({
  shown: bannerHidden() === false,
  cls: banner().className,
  badge: q("action-banner-badge").textContent.trim(),
  msg: q("action-banner-msg").textContent.trim(),
  count: document.querySelectorAll("#action-banner").length,
});
const readStats = (repo) => {
  const c = cardOf(repo);
  const num = c && c.querySelector(".proposal-stats .stat-item.additions .stat-num");
  return num ? num.textContent.trim() : null;
};
const hasChip = () => !!document.querySelector("#action-banner-msg code.commit-sha");
const startLand = (repo) => {
  const b = cardOf(repo) && cardOf(repo).querySelector(SEL_START);
  if (!b) { R.c.actionMissing = true; return false; }
  b.click();
  return true;
};
const confirmLand = (repo) => {
  const b = cardOf(repo) && cardOf(repo).querySelector(SEL_CONF);
  if (!b) { R.c.actionMissing = true; return false; }
  b.click();
  return true;
};
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await sleep(600);
    const first = qs(SEL_START);
    if (!first) { R.c.noStart = true; } else {
      R.repo = first.getAttribute("data-repo");
      // Pin the refresh clock: auto-refresh off removes the 8 s /proposals poll, so
      // every later /proposals hit is attributable to the stale/guard refresh (also
      // robust under --virtual-time-budget, where page timers can fire fast).
      const toggle = q("auto-refresh-toggle");
      if (toggle && toggle.checked) toggle.click();
      await sleep(50);
      R.c.propsBefore = hits("/proposals");
      if (MODE === "happy") {
        if (startLand(R.repo) && confirmLand(R.repo)) {
          await sleep(1200);
          R.c.finalBanner = readBanner();
          R.c.commit = (() => {
            const el = document.querySelector("#action-banner-msg code.commit-sha");
            return el ? { text: el.textContent.trim(), title: el.getAttribute("title") } : null;
          })();
          R.c.finalLanded = readLanded(R.repo);
          R.c.landedCardFileCount = R.c.finalLanded?.banner ?? null;
        }
      } else if (MODE === "stale") {
        R.c.statsBefore = readStats(R.repo);
        if (startLand(R.repo) && confirmLand(R.repo)) {
          await sleep(1500);
          R.c.staleBanner = readBanner();
          R.c.staleHasChip = hasChip();
          R.c.staleDefault = readDefault(R.repo);
          R.c.statsAfter = readStats(R.repo);
          R.c.propsAfterStale = hits("/proposals");
          if (startLand(R.repo) && confirmLand(R.repo)) {
            await sleep(1200);
            R.c.retryBanner = readBanner();
            R.c.retryCommit = (() => {
              const el = document.querySelector("#action-banner-msg code.commit-sha");
              return el ? el.textContent.trim() : null;
            })();
            R.c.retryLanded = readLanded(R.repo);
          }
        }
      } else if (MODE === "headless") {
        if (startLand(R.repo) && confirmLand(R.repo)) {
          await sleep(1200);
          R.c.guardBanner = readBanner();
          R.c.guardDefault = readDefault(R.repo);
          R.c.propsAfterGuard = hits("/proposals");
        }
      }
    }
  } catch (e) { R.err = String((e && e.stack) || e); }
  const d = document.createElement("div");
  d.id = "test-out";
  d.textContent = encodeURIComponent(JSON.stringify(R));
  document.body.appendChild(d);
});`;

// ---------------------------------------------------------------------------
// Loopback worker surface: mode selects how /land answers; every /land body is
// recorded as received (the browser network panel, observed server-side).
// ---------------------------------------------------------------------------
let mode = "happy"; // happy | stale | headless
let payload = FIXTURE_H1;
let landServed = 0;
const landBodies = [];

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
    res.end(JSON.stringify({ ok: true, events: [{ type: "push", repo: "agent-1", at: "2026-10-07T10:00:01Z" }] }));
    return;
  }
  if (pathname === "/land") {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* recorded as null — assertions fail loudly */ }
      landBodies.push(parsed);
      landServed++;
      if (mode === "stale" && landServed === 1) {
        // The repo moves while the reviewer is deciding: the set the canvas
        // rendered no longer exists, so the reviewed anchors are stale.
        payload = FIXTURE_H2;
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "stale", detail: "reviewed head of agent-1 does not match the current proposal head" }));
        return;
      }
      // Retry success (happy mode) or stale-mode retry success: transition the
      // served payload to its landed variant so the post-land /proposals fetch
      // reflects landing.status === "landed" (mirrors the immutable
      // PRE_LAND/POST_LAND pattern from event-debounce-land-reload.test.mjs).
      if (mode === "stale") {
        payload = POST_LAND_STALE;
      } else {
        payload = POST_LAND;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, landed: { repos: ["agent-1"], commit: COMMIT, files: ["src/auth.ts", "README.md"], at: "2026-10-08T12:00:00Z" } }));
    });
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
    res.end(clientScript(mode));
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
  mode = next.mode ?? "happy";
  payload = next.payload ?? FIXTURE_H1;
  landServed = 0;
  landBodies.length = 0;
};

// ---------------------------------------------------------------------------
// The binding battery (legs 1 and 4): the recorded /land body binds exactly the
// anchors the canvas rendered, and the success path is today's.
// ---------------------------------------------------------------------------
function bindingContract(label, obs, expected) {
  if (!obs) {
    check(`${label} scenario output present (chrome + observer ran)`, false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check(`${label} scenario threw`, false, obs.err);
    return;
  }
  const c = obs.c || {};
  const runner = `${label} `;
  const repo = obs.repo;
  check(`${runner}driver found a landable card`, c.noStart !== true && typeof repo === "string", `repo=${repo}`);
  check(`${runner}every control was reachable`, c.actionMissing !== true);
  check(`${runner}exactly one land attempt was made`, landBodies.length === 1, `count=${landBodies.length}`);
  const body = landBodies[0];
  check(`${runner}land body keeps today's shape (base/repos/baseRef/ref)`, body && body.base === expected.baseRepo && J(body.repos) === J([repo]) && body.baseRef === "main" && body.ref === "main", J(body));
  check(`${runner}reviewed keys are exactly {baseHead, heads}`, exactKeys(body && body.reviewed, ["baseHead", "heads"]), J(body && body.reviewed));
  check(`${runner}reviewed.baseHead === the rendered base head`, body?.reviewed?.baseHead === expected.baseHead, J({ got: body?.reviewed?.baseHead, want: expected.baseHead }));
  check(`${runner}reviewed.heads keys are exactly the landed repo`, exactKeys(body?.reviewed?.heads, [repo]), J(body?.reviewed?.heads));
  check(`${runner}reviewed.heads[${repo}] === the rendered proposal head`, body?.reviewed?.heads?.[repo] === expected.rowHead, J({ got: body?.reviewed?.heads?.[repo], want: expected.rowHead }));
  check(`${runner}success banner is visible with badge 'landed'`, c.finalBanner?.shown === true && c.finalBanner?.badge === "landed", J(c.finalBanner));
  check(`${runner}success class is banner-success`, String(c.finalBanner?.cls || "").includes("banner-success"), c.finalBanner?.cls);
  check(`${runner}success copy starts with commit chip + file count`, c.finalBanner?.msg.startsWith(`Successfully landed proposal ${repo} into ${expected.baseRepo}. Commit ${COMMIT.slice(0, 8)} · 2 files · `) && c.commit?.text === COMMIT.slice(0, 8) && c.commit?.title === COMMIT, J({ msg: c.finalBanner?.msg, chip: c.commit }));
  check(`${runner}success banner shows file count in receipt`, c.finalBanner?.msg.includes(" · 2 files · "), J({ msg: c.finalBanner?.msg }));
  check(`${runner}landed card shows landing.files count`, c.landedCardFileCount && c.landedCardFileCount.includes("files"), J({ landedCardFileCount: c.landedCardFileCount }));
  check(`${runner}card shows landed-banner after the success`, c.finalLanded?.isLanded === true && c.finalLanded?.banner?.includes("files"), J(c.finalLanded));
  check(`${runner}exactly one action-banner element`, c.finalBanner?.count === 1, `count=${c.finalBanner?.count}`);
}

// ---------------------------------------------------------------------------
// Leg 2 — stale: banner + default card + refetch + re-render + fresh anchors.
// ---------------------------------------------------------------------------
function staleContract(obs) {
  if (!obs) {
    check("2 scenario output present (chrome + observer ran)", false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check("2 scenario threw", false, obs.err);
    return;
  }
  const c = obs.c || {};
  const repo = obs.repo;
  check("2 driver found a landable card", c.noStart !== true && typeof repo === "string", `repo=${repo}`);
  check("2 every control was reachable", c.actionMissing !== true);
  check("2 exactly two land attempts were made (stale, then retry)", landBodies.length === 2, `count=${landBodies.length}`);
  check("2 the first attempt carried the anchors the canvas rendered (H1)", landBodies[0]?.reviewed?.baseHead === BASE_H1 && landBodies[0]?.reviewed?.heads?.[repo] === A1_H1, J(landBodies[0]?.reviewed));
  check("2 stale banner shows on banner-error with the dedicated copy + badge", c.staleBanner?.shown === true && String(c.staleBanner?.cls || "").includes("banner-error") && c.staleBanner?.badge === "stale" && c.staleBanner?.msg === STALE_COPY, J(c.staleBanner));
  check("2 nothing landed: the stale banner carries no commit chip", c.staleHasChip === false, `hasChip=${c.staleHasChip}`);
  check("2 card returned to default on stale", defaultShape(c.staleDefault), J(c.staleDefault));
  check("2 the set was refetched exactly once after the stale (poll is off)", typeof c.propsBefore === "number" && c.propsAfterStale === c.propsBefore + 1, J({ before: c.propsBefore, after: c.propsAfterStale }));
  check("2 the refreshed set was re-rendered on the canvas (+3 -> +5)", c.statsBefore === "+3" && c.statsAfter === "+5", J({ before: c.statsBefore, after: c.statsAfter }));
  check("2 the retry carried the REFRESHED anchors (H2) — the reviewer re-reviewed", landBodies[1]?.reviewed?.baseHead === BASE_H2 && landBodies[1]?.reviewed?.heads?.[repo] === A1_H2, J(landBodies[1]?.reviewed));
  check("2 the retry kept today's success path", c.retryBanner?.badge === "landed" && String(c.retryBanner?.cls || "").includes("banner-success") && c.retryCommit === COMMIT.slice(0, 8) && c.retryLanded?.isLanded === true, J({ banner: c.retryBanner, chip: c.retryCommit, landed: c.retryLanded }));
}

// ---------------------------------------------------------------------------
// Leg 3 — fail-closed: a heads-less payload never reaches /land.
// ---------------------------------------------------------------------------
function guardContract(obs) {
  if (!obs) {
    check("3 scenario output present (chrome + observer ran)", false, "no #test-out in DOM");
    return;
  }
  if (obs.err) {
    check("3 scenario threw", false, obs.err);
    return;
  }
  const c = obs.c || {};
  const repo = obs.repo;
  check("3 driver found a landable card", c.noStart !== true && typeof repo === "string", `repo=${repo}`);
  check("3 every control was reachable", c.actionMissing !== true);
  check("3 NO land request was attempted — an unbound land is refused", landBodies.length === 0, `count=${landBodies.length}`);
  check("3 refusal banner on banner-error with badge 'failed' + exact copy", c.guardBanner?.shown === true && String(c.guardBanner?.cls || "").includes("banner-error") && c.guardBanner?.badge === "failed" && c.guardBanner?.msg === GUARD_COPY, J(c.guardBanner));
  check("3 card returned to default", defaultShape(c.guardDefault), J(c.guardDefault));
  check("3 the set was refetched after the refusal", typeof c.propsBefore === "number" && c.propsAfterGuard >= c.propsBefore + 1, J({ before: c.propsBefore, after: c.propsAfterGuard }));
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // --- 1. binding: the recorded body is exactly the rendered anchors -----------
  try {
    resetServer({ mode: "happy", payload: FIXTURE_H1 });
    const dom = await dumpDom(url);
    bindingContract("1", parseScenario(dom), { baseRepo: "demo", baseHead: BASE_H1, rowHead: A1_H1 });
  } catch (e) {
    check("1 binding case threw", false, String(e?.stack ?? e));
  }

  // --- 2. stale: banner + default + refetch + re-render + refreshed anchors ----
  try {
    resetServer({ mode: "stale", payload: FIXTURE_H1 });
    const dom = await dumpDom(url);
    staleContract(parseScenario(dom));
  } catch (e) {
    check("2 stale case threw", false, String(e?.stack ?? e));
  }

  // --- 3. fail-closed: a heads-less payload never reaches /land ----------------
  try {
    resetServer({ mode: "headless", payload: FIXTURE_HEADLESS });
    const dom = await dumpDom(url);
    guardContract(parseScenario(dom));
  } catch (e) {
    check("3 fail-closed case threw", false, String(e?.stack ?? e));
  }

  // --- 4. live capture: REVIEWED_FIXTURE = a captured /proposals body ----------
  const fixturePath = process.env.REVIEWED_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  4 live capture - REVIEWED_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      const props = Array.isArray(live?.proposals) ? live.proposals : [];
      const landable = props.filter((p) => (p?.landing?.status ?? "ready") !== "landed");
      check("4 live capture carries >= 1 landable proposal", landable.length >= 1, `landable=${landable.length}`);
      check("4 live capture carries base.repo + base.ref", typeof live?.base?.repo === "string" && live.base.repo.length > 0 && typeof live?.base?.ref === "string" && live.base.ref.length > 0, J(live?.base));
      if (typeof live?.base?.head !== "string") {
        console.log("SKIP  4 live capture lacks base.head - deploy-gated (the reviewed-heads read ships with the wave deploy)");
      } else {
        check("4 live base.head is 40-hex", /^[0-9a-f]{40}$/.test(live.base.head), String(live.base.head));
        check("4 every readable live row carries a 40-hex head", props.filter((p) => !p.error).every((p) => /^[0-9a-f]{40}$/.test(String(p.head))), J(props.map((p) => [p.repo, p.head, p.error])));
        resetServer({ mode: "happy", payload: live });
        const dom = await dumpDom(url);
        const obs = parseScenario(dom);
        const row = obs ? props.find((p) => p.repo === obs.repo) : null;
        bindingContract("4", obs, { baseRepo: live.base.repo, baseHead: live.base.head, rowHead: row?.head });
      }
    } catch (e) {
      check("4 live-capture case threw", false, String(e?.stack ?? e));
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
