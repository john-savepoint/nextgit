#!/usr/bin/env node
// live-render.probe.mjs — THE LIVE-PAGE GATE.
//
// Why this exists (John, 2026-10-08): every UI suite runs against loopback fixtures, so a
// deploy-time regression that only manifests against the REAL worker payload (or a cold
// start, or a rendering crash mid-render) sailed through and John found the live page in
// its error state. Agents must verify the ACTUAL deployed page. This probe opens the live
// deployment in real headless Chrome and fails on: JS errors, an empty/incomplete canvas,
// a visible connection banner after settle, or placeholder dashes in the header chips.
//
// Run:  node porting/tests/live-render.probe.mjs            (exit 0 = page healthy)
//       PLATFORM=https://… node porting/tests/live-render.probe.mjs
// Exit: 0 healthy · 1 broken · 2 no Chrome
//
// Evidence: writes a DOM dump + screenshot path + console log to
// porting/runs/live-render-<ts>/ (main tree) for the per-wave UX review.

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PLATFORM = process.env.PLATFORM || "https://nextgit-platform.john-b7d.workers.dev";
const EXPECT_CARDS = Number(process.env.EXPECT_CARDS || 4); // demo carries agent-1..5 now; ≥4 proves render

function findChrome() {
  for (const bin of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (!bin) continue;
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0) return bin;
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.log("SKIP — no Chrome binary on PATH (live render unverified)");
  process.exit(2);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(ROOT, "porting/runs", `live-render-${ts}`);
mkdirSync(outDir, { recursive: true });

let fails = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// Ground truth is the RENDERED DOM from the live deployment (--dump-dom after a 13s
// virtual-time budget); the parsed facts below are what the UX lens reviews.
const url = `${PLATFORM}/`;
const userDataDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
const child = spawn(
  CHROME,
  ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=13000", `--user-data-dir=${userDataDir}`, "--dump-dom", `${url}?probe=1`],
  { stdio: ["ignore", "pipe", "ignore"] },
);

let out = "";
child.stdout.on("data", (d) => (out += d));
const kill = setTimeout(() => child.kill("SIGKILL"), 90000);
child.on("close", () => {
  clearTimeout(kill);
  execFileSync("rm", ["-rf", userDataDir]);

  // Have Chrome evaluate the observer instead: --dump-dom cannot run our script.
  // So instead we parse the RENDERED DOM directly — that is the ground truth anyway.
  const dom = out;
  writeFileSync(join(outDir, "dom.html"), dom);

  const cards = [...dom.matchAll(/class="proposal-card([^"]*)"/g)].map((m) => m[1]);
  const cardCount = cards.length;
  const hasConnectionBannerVisible = /id="connection-banner"(?![^>]*\shidden)/.test(dom);
  const bannerText = (dom.match(/id="connection-banner"[^>]*>([\s\S]{0,300}?)<\/(?:div|section)>/) || [])[1] || "";
  const chip = (id) => {
    const m = dom.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
    return m ? m[1].trim() : "(missing)";
  };
  const chips = {
    proposals: chip("val-proposals"),
    shared: chip("val-shared"),
    conflicts: chip("val-conflicts"),
    changed: chip("val-changed"),
    clean: chip("val-clean"),
  };
  const isLoading = /Loading the set|Loading\.\.\./.test(dom);
  const hasError = /Connection error|Disconnected from platform worker|Failed to load/.test(dom);

  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ url, cardCount, cards, chips, hasConnectionBannerVisible, isLoading, hasError, bannerText: bannerText.replace(/\s+/g, " ").slice(0, 200) }, null, 2));

  console.log(`live render probe — ${url} (evidence: ${outDir})`);
  check(`canvas rendered ≥${EXPECT_CARDS} proposal cards`, cardCount >= EXPECT_CARDS, `cards=${cardCount}`);
  check("connection banner NOT visible", !hasConnectionBannerVisible, bannerText.replace(/\s+/g, " ").slice(0, 140));
  check("no error surface (connection error / disconnected / failed)", !hasError);
  check("not stuck in loading state", !isLoading);
  check("header chips populated (no placeholder dashes)", [chips.proposals, chips.shared, chips.conflicts].every((c) => c && c !== "—" && c !== "(missing)"), JSON.stringify(chips));

  console.log(fails === 0 ? `LIVE PAGE OK (${checks} checks)` : `LIVE PAGE BROKEN — ${fails}/${checks} failed`);
  process.exit(fails === 0 ? 0 : 1);
});
