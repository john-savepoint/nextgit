#!/usr/bin/env bun
// Contract suite: API route discipline (e11-impl-api-route-discipline).
// Run: bun porting/tests/route-discipline.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker`, `ROUTES`, `DYNAMIC_ROUTES`
// from platform/src/index.ts and drives worker.fetch() with an in-memory env
// whose ASSETS.fetch is a PROBE (`async () => new Response("ASSETS-SERVED")`)
// so each check proves the asset handler was or was not reached. No
// mock.module, no source grep — the boundary is exercised end-to-end through
// the real dispatcher. Full-suite-safe: no network, no Chrome, no live
// worker; a fresh envFor() per request; the live group is gated on
// NEXTGIT_PLATFORM and otherwise prints one SKIP line.

import { readFile, readdir } from "node:fs/promises";
import worker, { ROUTES, DYNAMIC_ROUTES } from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; return; }
  fail++;
  const line = detail ? name + " — " + detail : name;
  console.log("FAIL  " + line);
};
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// envFor: in-memory fake env. ASSETS.fetch is a PROBE that records whether
// it was reached and answers 200 "ASSETS-SERVED" so the tests can prove the
// asset handler fired (UI-serve law) or did not (405/404 law).
// ---------------------------------------------------------------------------
const envFor = () => {
  const probe = { called: false };
  const ASSETS = {
    fetch: async () => { probe.called = true; return new Response("ASSETS-SERVED", { status: 200 }); },
  };
  const env = {
    ARTIFACTS: { get: async () => { throw new Error("should not be reached"); }, list: async () => { throw new Error("should not be reached"); } },
    LIVE: { get: async () => undefined },
    CACHE: { get: async () => undefined, put: async () => { } },
    ASSETS,
    AI: { run: async () => null },
    AUTH_MODE: undefined, // deny mode — the 405/404 boundary fires before authorize()
    EVENTS_HUB: undefined,
    LAND_LEASE: undefined,
    REVEAL_AUDIT: undefined,
  };
  return { env, probe };
};

const B405 = { ok: false, error: "method-not-allowed" };
const B404 = { ok: false, error: "not-found" };

// Drive the real dispatcher. Returns { status, contentType, body, probe }.
const drive = async (method, path) => {
  const { env, probe } = envFor();
  const init = method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: "{}" };
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, contentType: res.headers.get("content-type"), body, text, probe };
};

// ---------------------------------------------------------------------------
// Group 1 — 405 law: wrong method on every registered path -> 405 + exact
// body + ASSETS not reached.
// ---------------------------------------------------------------------------
{
  // Wrong method (POST) on every GET ROUTES entry.
  for (const route of ROUTES) {
    const wrong = route.method === "GET" ? "POST" : "GET";
    const r = await drive(wrong, route.path);
    check(`405: ${wrong} ${route.path} -> 405`, r.status === 405, `got ${r.status}`);
    check(`405: ${wrong} ${route.path} body exact`, J(r.body) === J(B405), `got ${J(r.body)}`);
    check(`405: ${wrong} ${route.path} ASSETS not called`, r.probe.called === false);
    check(`405: ${wrong} ${route.path} content-type json`, (r.contentType ?? "").includes("application/json"), `got ${r.contentType}`);
  }
  // Wrong method on the dynamic route prefix.
  const sha = "a".repeat(40);
  const dyn = await drive("DELETE", `/landings/${sha}`);
  check("405: DELETE /landings/<sha> -> 405", dyn.status === 405, `got ${dyn.status}`);
  check("405: DELETE /landings/<sha> body exact", J(dyn.body) === J(B405), `got ${J(dyn.body)}`);
  check("405: DELETE /landings/<sha> ASSETS not called", dyn.probe.called === false);
}

// ---------------------------------------------------------------------------
// Group 2 — 404 law: unknown paths -> 404 + exact body + ASSETS not reached.
// ---------------------------------------------------------------------------
{
  for (const p of ["/no-such-route", "/api/no-such-route", "/changes/extra"]) {
    const r = await drive("GET", p);
    check(`404: GET ${p} -> 404`, r.status === 404, `got ${r.status}`);
    check(`404: GET ${p} body exact`, J(r.body) === J(B404), `got ${J(r.body)}`);
    check(`404: GET ${p} ASSETS not called`, r.probe.called === false);
    check(`404: GET ${p} content-type json`, (r.contentType ?? "").includes("application/json"), `got ${r.contentType}`);
  }
}

// ---------------------------------------------------------------------------
// Group 3 — UI-serve law: whitelisted UI documents -> 200 + ASSETS-SERVED.
// ---------------------------------------------------------------------------
{
  for (const p of ["/", "/index.html", "/styles.css", "/app.js", "/reveal-decision.js", "/land-verdict.js", "/tour.html", "/tour.css", "/tour.js", "/files.html", "/js/files-page.js", "/js/state.js", "/js/api.js", "/js/conflicts.js", "/js/ticker.js", "/js/proposals.js", "/js/modal.js", "/js/land.js", "/js/reveal.js", "/js/interactions.js", "/parity.html", "/parity.js", "/parity-data.js", "/js/forks-panel.js"]) {
    const r = await drive("GET", p);
    check(`UI: GET ${p} -> 200`, r.status === 200, `got ${r.status}`);
    check(`UI: GET ${p} body ASSETS-SERVED`, r.text === "ASSETS-SERVED", `got ${JSON.stringify(r.text)}`);
    check(`UI: GET ${p} ASSETS called`, r.probe.called === true);
  }
}

// ---------------------------------------------------------------------------
// Group 4 — method-enforcement completeness: the CORRECT method on every
// route returns a contract status that is neither 405 nor 404 (it may be
// 401 in deny mode, or a handler status — the point is the boundary does
// not reject a correctly-addressed request).
// ---------------------------------------------------------------------------
{
  for (const route of ROUTES) {
    const r = await drive(route.method, route.path);
    check(`OK: ${route.method} ${route.path} not 405/404`, r.status !== 405 && r.status !== 404, `got ${r.status}`);
  }
  const sha = "a".repeat(40);
  const dyn = await drive("GET", `/landings/${sha}`);
  check("OK: GET /landings/<sha> not 405/404", dyn.status !== 405 && dyn.status !== 404, `got ${dyn.status}`);
}

// ---------------------------------------------------------------------------
// Group 5 — route-set parity (three-way set equality):
//   registry set (ROUTES + DYNAMIC_ROUTES) vs CONTRACT set (parsed
//   `## (GET|POST) /path` headings) vs UI-consumed set (parsed
//   fetchJson("/x") / fetch("/x"...) in app.js + tour.js).
// Asserts: UI-API-paths ⊆ registry ⊆ CONTRACT.
// ---------------------------------------------------------------------------
{
  const registry = new Set(ROUTES.map((r) => r.path));
  for (const d of DYNAMIC_ROUTES) {
    // Dynamic prefixes register as their prefix form ("/landings/").
    registry.add(d.prefix);
  }

  // CONTRACT set: "## GET /path..." / "## POST /path..." headings. Path
  // may carry query/template suffixes ("?repo=...", "/{commit}") — strip
  // them so the comparison is on the route root.
  const contractRaw = await readFile(new URL("../../platform/CONTRACT.md", import.meta.url), "utf8");
  const contract = new Set();
  for (const m of contractRaw.matchAll(/^## (?:GET|POST) (\/\S*)/gm)) {
    contract.add(m[1].split("?")[0].replace(/\/[^/]*$/, (seg) => (seg.includes("{") ? "/" : seg)));
  }
  // /landings/{commit} normalizes to its prefix "/landings/".
  contract.add("/landings/");

  // UI-consumed set: fetchJson("/x") and fetch(".../x"...) across the
  // module graph — app.js + tour.js + every ./js/*.js module (the split
  // moved all app.js fetch sites into ./js/*; a future module calling
  // an undocumented route is the regression this set guards).
  const uiApi = new Set();
  const jsDir = new URL("../../platform/ui/js/", import.meta.url);
  const uiFiles = ["app.js", "tour.js", ...(await readdir(jsDir)).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`)];
  for (const f of uiFiles) {
    const text = await readFile(new URL(`../../platform/ui/${f}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/fetch(?:Json)?\(\s*["'`]([^"'`]+)["'`]/g)) {
      let p = m[1];
      // Absolute URL (tour.js hits the live worker) — keep only the path.
      try { p = new URL(p, "https://nextgit.invalid").pathname; } catch { /* keep raw */ }
      // Strip query string; a bare "/" is a UI document, not an API path.
      p = p.split("?")[0];
      if (p === "/" || p === "") continue;
      uiApi.add(p);
    }
  }

  const missingInRegistry = [...uiApi].filter((p) => !registry.has(p));
  check("parity: every UI-consumed API path is registered", missingInRegistry.length === 0, `missing: ${J(missingInRegistry)}`);

  const missingInContract = [...registry].filter((p) => !contract.has(p) && !p.endsWith("/"));
  check("parity: every registered route is documented in CONTRACT", missingInContract.length === 0, `missing: ${J(missingInContract)}`);
}

// ---------------------------------------------------------------------------
// Group 6 — live-gated (NEXTGIT_PLATFORM set): prove the deployed worker
// answers 405/404 JSON and 200 text/html for the UI shell. Otherwise SKIP.
// ---------------------------------------------------------------------------
{
  const base = process.env.NEXTGIT_PLATFORM;
  if (!base) {
    console.log("SKIP  live group (NEXTGIT_PLATFORM not set)");
  } else {
    const ua = "nextgit-route-discipline/1.0";
    const live = async (method, path) => {
      const init = method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: "{}" };
      const res = await fetch(`${base}${path}`, { ...init, headers: { "user-agent": ua, ...(init.headers ?? {}) } });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* non-JSON */ }
      return { status: res.status, contentType: res.headers.get("content-type"), body, text };
    };

    const postHealth = await live("POST", "/health");
    check("live: POST /health -> 405 JSON", postHealth.status === 405 && J(postHealth.body) === J(B405), `got ${postHealth.status} ${J(postHealth.body)}`);

    const unknown = await live("GET", "/no-such-route");
    check("live: GET /no-such-route -> 404 JSON", unknown.status === 404 && J(unknown.body) === J(B404), `got ${unknown.status} ${J(unknown.body)}`);
    check("live: GET /no-such-route content-type json", (unknown.contentType ?? "").includes("application/json"), `got ${unknown.contentType}`);

    const ui = await live("GET", "/");
    check("live: GET / -> 200 text/html", ui.status === 200 && (ui.contentType ?? "").includes("text/html"), `got ${ui.status} ${ui.contentType}`);
  }
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
