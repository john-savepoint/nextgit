#!/usr/bin/env bun
// Scope-floor guard — nextgit-e10-impl-scope-floor-guard
// Run: bun porting/tests/scope-floor.test.mjs   (exit 0 = pass)
//
// Asserts the concerns-floor (PRD NFR-10) is satisfied: dark-only, desktop-web,
// English-only, no PWA/offline surface. Static filesystem reads + text assertions;
// guards the *file surface*, not runtime behavior. Fail-closed on any violation.
//
// Covers four guards:
//   1. PWA/offline surface (no manifest webmanifest, no rel=manifest link,
//      no service-worker registration, no sw.js / service-worker.js files)
//   2. Light-mode path (no prefers-color-scheme media query; dark --bg-app
//      token present in styles.css)
//   3. i18n surface (no i18n deps in package.json; lang="en" on HTML; no
//      data-i18n attributes; no i18n import/require in .js files)
//   4. Native wrapper (no capacitor/tauri/electron config files; wrangler.jsonc
//      has no manifest/service_worker/pwa/capacitor/electron/tauri top-level keys)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// --- Helper: strip JSONC comments (// and /* */), then parse JSON ---
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

// ===========================================================================
// 1. PWA / offline surface guard
// ===========================================================================

check("1a no manifest.webmanifest in platform/ui", !readdirSync(join(ROOT, "platform/ui")).some((f) => f === "manifest.webmanifest" || f === "manifest.json"));

const indexHtml = read("platform/ui/index.html");
const tourHtml = read("platform/ui/tour.html");

check("1b index.html has no rel=manifest link", !/rel\s*=\s*["']?manifest["']?/i.test(indexHtml));
check("1c tour.html has no rel=manifest link", !/rel\s*=\s*["']?manifest["']?/i.test(tourHtml));

const appJs = read("platform/ui/app.js");
const tourJs = read("platform/ui/tour.js");

check("1d app.js has no service-worker registration", !/navigator\.serviceWorker|\.register\(|sw\.js|service-worker\.js/.test(appJs));
check("1e tour.js has no service-worker registration", !/navigator\.serviceWorker|\.register\(|sw\.js|service-worker\.js/.test(tourJs));

// Recursive scan for sw.js / service-worker.js / *-sw.js under platform/ui
const findJs = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      findJs(p, acc);
    } else if (entry.isFile() && /\.js$/.test(entry.name)) {
      acc.push(entry.name);
    }
  }
  return acc;
};
const uiJsFiles = findJs(join(ROOT, "platform/ui"));
const swFiles = uiJsFiles.filter((f) => f === "sw.js" || f === "service-worker.js" || /-sw\.js$/.test(f));
check("1f no service-worker files under platform/ui", swFiles.length === 0, `found: ${swFiles.join(", ")}`);

// ===========================================================================
// 2. Light-mode guard
// ===========================================================================

const cssFiles = ["styles.css", "tour.css"]
  .map((f) => {
    try {
      return read(`platform/ui/${f}`);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

for (const [i, css] of cssFiles.entries()) {
  const name = i === 0 ? "styles.css" : "tour.css";
  check(`2a ${name} has no prefers-color-scheme`, !/prefers-color-scheme/i.test(css));
}

const stylesCss = read("platform/ui/styles.css");
check("2b styles.css :root defines --bg-app dark token", /:root\s*\{[^}]*--bg-app\s*:\s*#[0-9a-fA-F]{6}/.test(stylesCss));
check("2b styles.css --bg-app is in #0a0e14-range", /--bg-app\s*:\s*#0a0e14/.test(stylesCss));

// ===========================================================================
// 3. i18n surface guard
// ===========================================================================

const pkg = JSON.parse(read("platform/package.json"));
const i18nDepRe = /i18n|intl|react-i18next|next-intl|formatjs/i;
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const i18nDeps = Object.keys(allDeps).filter((k) => i18nDepRe.test(k));
check("3a no i18n dependencies in package.json", i18nDeps.length === 0, `found: ${i18nDeps.join(", ")}`);

check("3b index.html lang=en", /<html lang="en">/.test(indexHtml));
check("3c tour.html lang=en", /<html lang="en">/.test(tourHtml));
check("3d index.html no data-i18n", !/\bdata-i18n\b/.test(indexHtml));
check("3e tour.html no data-i18n", !/\bdata-i18n\b/.test(tourHtml));

for (const jsFile of ["app.js", "tour.js"]) {
  const src = read(`platform/ui/${jsFile}`);
  check(`3f ${jsFile} no data-i18n`, !/\bdata-i18n\b/.test(src));
  check(`3g ${jsFile} no i18n import/require`, !/\bi18n\b/.test(src) && !/\bintl\b/.test(src) && !/\.i18n\b/.test(src) && !/react-i18next/.test(src) && !/next-intl/.test(src) && !/formatjs/.test(src));
}

// ===========================================================================
// 4. Native wrapper guard
// ===========================================================================

const platformFiles = readdirSync(join(ROOT, "platform"), { withFileTypes: true });
const nativeConfigNames = [
  "capacitor.config.json", "capacitor.config.ts",
  "tauri.conf.json",
  "electron-builder.json", "electron-builder.config.js", "electron-builder.config.ts",
  "electron.json", "electron.vite.config.ts",
];
const foundFiles = platformFiles
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .filter((n) => nativeConfigNames.includes(n));
check("4a no native wrapper config files at platform/", foundFiles.length === 0, `found: ${foundFiles.join(", ")}`);

const wranglerSrc = read("platform/wrangler.jsonc");
const wranglerJson = JSON.parse(stripComments(wranglerSrc));
const forbiddenKeys = ["manifest", "service_worker", "pwa", "capacitor", "electron", "tauri"];
const foundKeys = forbiddenKeys.filter((k) => k in wranglerJson);
check("4b wrangler.jsonc has no native/PWA keys", foundKeys.length === 0, `found: ${foundKeys.join(", ")}`);

// ===========================================================================
// Summary
// ===========================================================================
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
