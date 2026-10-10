#!/usr/bin/env bun
// Contract guard — nextgit-e11-verify-contract-single-source
// Run: bun porting/tests/contract-single-source.test.mjs   (exit 0 = pass)
//
// CONTRACT.md is the single source of route truth: the set of routes
// implemented in platform/src/index.ts (ROUTES `path:` + DYNAMIC_ROUTES
// `prefix:` registration tables) must equal the set of documented
// `## GET|POST <route>` headings — a route added in code without a
// same-slice CONTRACT.md entry (or a documented route the worker does
// not implement) fails the check. Also guards the version line and the
// additive-only law, and per-route method agreement between the tables
// and the doc headings.
//
// Static filesystem reads only; guards the file surface, not runtime
// behavior. No mock.module, no live worker, no env deps — full-suite
// safe (the battery discovers *.test.mjs and classifies by exit code).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const contract = read("platform/CONTRACT.md");
const source = read("platform/src/index.ts");

// --- 1. Implemented set: ROUTES path: + DYNAMIC_ROUTES prefix: ---
// Static entries are literal paths. Dynamic entries are prefixes;
// normalize `/landings/` to the doc's route form `/landings/{commit}`.
const staticRoutes = Array.from(source.matchAll(/\{ path: "([^"]+)", method: "(GET|POST)"/g)).map((m) => ({
  route: m[1],
  method: m[2],
}));
const dynamicRoutes = Array.from(source.matchAll(/\{ prefix: "([^"]+)", method: "(GET|POST)"/g)).map((m) => ({
  route: m[1].replace(/\/$/, "/{commit}"),
  method: m[2],
}));
const implemented = [...staticRoutes, ...dynamicRoutes];

// Registration completeness — the authorize()-coverage lesson: every
// implemented route carries method AND action (routes without an
// action silently skip the authorize() chokepoint).
const registered = Array.from(
  source.matchAll(/\{ (?:path|prefix): "[^"]+", method: "(GET|POST)", action: "[a-z]+"/g)
).length;
check(
  "1 every implemented route carries method+action (registration completeness)",
  registered === implemented.length,
  `${registered}/${implemented.length} entries complete`
);

const implList = implemented.map((r) => `${r.method} ${r.route}`).sort();

// --- 2. Documented set: `## GET|POST <route>` headings ---
// Strip `?query`, keep `{...}` params (e.g. /landings/{commit}),
// drop trailing descriptors (e.g. "(repos optional …)").
const docRoutes = Array.from(contract.matchAll(/^## (GET|POST) (\/[^\s?]+)/gm)).map((m) => ({
  method: m[1],
  route: m[2],
}));
const docList = docRoutes.map((r) => `${r.method} ${r.route}`).sort();

// --- 3. Set equality (route+method pairs) ---
const implJson = JSON.stringify(implList);
const docJson = JSON.stringify(docList);
const equal = implJson === docJson;
const implOnly = implList.filter((r) => !docList.includes(r));
const docOnly = docList.filter((r) => !implList.includes(r));
check(
  "2 implemented routes == documented headings (single source)",
  equal,
  `code-only: [${implOnly.join(", ")}] doc-only: [${docOnly.join(", ")}]`
);
console.log(`impl: ${JSON.stringify(implList)}`);
console.log(`doc:  ${JSON.stringify(docList)}`);

// --- 4. Version law: `Version: vN(.N) (` ---
const versioned = /^Version: v[0-9]+(\.[0-9]+)? \(/m.test(contract);
check("3 CONTRACT.md carries a Version: vN line", versioned);

// --- 5. Additive law, verbatim ---
const additive = /Additive changes only; if you change a shape, bump this file first/.test(contract);
check("4 CONTRACT.md carries the additive-only law", additive);

// --- 6. Method agreement per route (verb drift the set check misses) ---
const docByRoute = new Map(docRoutes.map((r) => [r.route, r.method]));
const methodDrift = implemented.filter((r) => docByRoute.get(r.route) !== r.method);
check(
  "5 doc verb == table method for every route",
  methodDrift.length === 0,
  methodDrift.map((r) => `${r.route}: code=${r.method} doc=${docByRoute.get(r.route)}`).join(", ")
);

// --- Summary ---
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
