#!/usr/bin/env bun
// submission-live.probe.mjs — the LIVE-ONLY pre-submission gate (nextgit-live-only-e2e-verification-gate-before-submission-no-mocks).
//
// Exercises the DEPLOYED worker end-to-end with NO mocks, NO fixtures, NO local
// server: every assertion is against https://nextgit-platform.john-b7d.workers.dev
// and the real demo namespace. Read-only except the audited POST /reveal (which
// never mutates). One command, exit 0 = the submission surface is live:
//
//   node porting/tests/submission-live.probe.mjs
//
// Coverage: the full read-route matrix (shapes + honest refusals), the audited
// reveal with the demo identity (grant + wrong-identity refusal), the SSE
// content-type, the UI pages, and the secret-class masking laws on the wire.
// DOM-level rendering stays in live-render.probe.mjs (browser); this gate is the
// API + page-delivery half of the pre-submission check.

const BASE = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";
const IDENTITY = "nextgit-demo-viewer";

let fails = 0, checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const j = async (path, init) => {
  const r = await fetch(`${BASE}${path}`, init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON (pages/SSE) */ }
  return { status: r.status, body, text, headers: r.headers };
};

console.log(`submission-live gate — ${BASE}\n`);

// --- 1. health + read-route matrix (shapes + statuses) -----------------------
try {
  const h = await j("/health");
  check("1 /health 200 {ok, service, namespace}", h.status === 200 && h.body?.ok === true && h.body?.service && h.body?.namespace, JSON.stringify(h.body).slice(0, 120));

  const matrix = [
    ["/changes?repo=agent-1&base=demo", (b) => b?.ok === true && b?.changeSet?.files?.length > 0, "change-set rows"],
    ["/proposals?base=demo", (b) => b?.ok === true && Array.isArray(b?.proposals) && b.proposals.length >= 4, ">=4 proposal rows"],
    ["/merge?base=demo&repos=agent-1", (b) => b?.ok === true && Array.isArray(b?.merge?.files), "merge rows"],
    ["/events", (b) => b?.ok === true && Array.isArray(b?.events), "event feed"],
    ["/floors", (b) => b?.ok === true && Array.isArray(b?.floors) && b.floors.length >= 1, "floors"],
    ["/forks?base=demo", (b) => b?.ok === true && Array.isArray(b?.forks) && b.forks.length >= 1 && b.forks[0].signals, "forks + six-cluster signals"],
    ["/sessions?base=demo", (b) => b?.ok === true && Array.isArray(b?.sessions), "sessions"],
    ["/agents?base=demo", (b) => b?.ok === true && Array.isArray(b?.agents) && b.agents.length >= 1 && b.agents[0].policy, "agents + policy"],
    ["/harnesses", (b) => b?.ok === true && Array.isArray(b?.harnesses) && b.harnesses.length >= 1, "harnesses"],
    ["/checks?repo=agent-1", (b) => b?.ok === true && Array.isArray(b?.checks), "checks"],
    ["/issues?base=demo", (b) => b?.ok === true && Array.isArray(b?.issues), "issues"],
    ["/tree?repo=agent-1&ref=main", (b) => b?.ok === true && Array.isArray(b?.entries) && b.entries.length >= 1, "tree entries"],
    ["/commits?repo=agent-1&ref=main&limit=5", (b) => b?.ok === true && Array.isArray(b?.commits) && b.commits.length >= 1, "commit log"],
    ["/comments?repo=agent-1&ref=main&path=src/auth.ts", (b) => b?.ok === true && Array.isArray(b?.comments), "comments read"],
  ];
  for (const [path, okFn, label] of matrix) {
    const r = await j(path);
    check(`1 GET ${path.split("?")[0]} 200 (${label})`, r.status === 200 && okFn(r.body), `status=${r.status} body=${JSON.stringify(r.body).slice(0, 100)}`);
  }
} catch (e) { check("1 read matrix threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 2. file read + secret-class masking on the wire -------------------------
try {
  const f = await j("/file?repo=agent-1&ref=main&path=README.md");
  check("2 /file text row", f.status === 200 && f.body?.ok === true && f.body?.classification === "text" && typeof f.body?.text === "string", JSON.stringify({ s: f.status, c: f.body?.classification }));
  const env = await j("/file?repo=agent-5&ref=main&path=config/.env");
  check("2 /file secret row = keys only, never a value", env.status === 200 && env.body?.classification === "secret" && Array.isArray(env.body?.keys) && !("value" in (env.body ?? {})) && !/postgres:/.test(env.text), JSON.stringify({ c: env.body?.classification, keys: env.body?.keys?.length }));
  const raw = await j("/raw/agent-5/main/config/.env");
  check("2 /raw refuses secret-class 403", raw.status === 403, `status=${raw.status}`);
} catch (e) { check("2 file/secrets threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 3. the audited reveal with the live demo grant --------------------------
try {
  const who = await j(`/whoami?repo=agent-5`);
  check("3 /whoami answers", who.status === 200 && who.body?.ok === true);
  const whoId = await j(`/whoami?repo=agent-5`, { headers: { Authorization: `Bearer ${IDENTITY}` } });
  check("3 /whoami + demo identity on the granted repo -> reveal:true", whoId.status === 200 && whoId.body?.reveal === true, JSON.stringify(whoId.body));
  const reveal = await j("/reveal", {
    method: "POST",
    headers: { Authorization: `Bearer ${IDENTITY}`, "content-type": "application/json" },
    body: JSON.stringify({ repo: "agent-5", ref: "main", path: "config/.env", key: "DATABASE_URL" }),
  });
  check("3 POST /reveal granted 200 with the value", reveal.status === 200 && reveal.body?.ok === true && typeof reveal.body?.value === "string" && reveal.body.value.length > 0, JSON.stringify({ s: reveal.status, k: reveal.body?.key }));
  const denied = await j("/reveal", {
    method: "POST",
    headers: { Authorization: "Bearer not-the-demo-viewer", "content-type": "application/json" },
    body: JSON.stringify({ repo: "agent-5", ref: "main", path: "config/.env", key: "DATABASE_URL" }),
  });
  check("3 POST /reveal wrong identity -> 403 (never a value)", denied.status === 403 && !/postgres:/.test(denied.text), `status=${denied.status}`);
} catch (e) { check("3 reveal threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 4. SSE stream delivers the event-stream content-type --------------------
try {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  let ct = "";
  try {
    const r = await fetch(`${BASE}/events/stream`, { signal: ctl.signal });
    ct = r.headers.get("content-type") ?? "";
    await r.body?.cancel?.();
  } catch (e) { ct = `aborted-or-error: ${String(e?.name)}`; }
  clearTimeout(t);
  check("4 /events/stream answers text/event-stream", ct.includes("text/event-stream"), ct.slice(0, 80));
} catch (e) { check("4 SSE threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 5. UI pages deliver (200 + expected entry tags) -------------------------
try {
  const pages = [
    ["/", (t) => t.includes("proposals-grid") || t.includes("id=\"proposals")],
    ["/files.html", (t) => t.includes("repo-picker") && t.includes('id="file-tree"')],
    ["/history.html", (t) => t.includes("commit-list") || t.includes("history")],
    ["/parity.html", (t) => t.includes("parity")],
    ["/tour.html", (t) => t.includes("tour")],
  ];
  for (const [p, okFn] of pages) {
    const r = await fetch(`${BASE}${p}`);
    const t = await r.text();
    check(`5 page ${p} 200 + entry markers`, r.status === 200 && okFn(t), `status=${r.status} len=${t.length}`);
  }
} catch (e) { check("5 pages threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 6. honest refusals (allowlist + unknown path) ---------------------------
try {
  const evil = await j("/changes?repo=notdemo-xyz&base=demo");
  check("6 non-allowlisted repo 403", evil.status === 403, `status=${evil.status}`);
  const unknown = await j("/no-such-route");
  check("6 unknown path 404 JSON", unknown.status === 404 && unknown.body?.ok === false, `status=${unknown.status}`);
} catch (e) { check("6 refusals threw", false, String(e?.message ?? e).slice(0, 200)); }

console.log(fails === 0 ? `\nSUBMISSION LIVE GATE: PASS (${checks} checks)` : `\nSUBMISSION LIVE GATE: FAIL — ${fails}/${checks}`);
process.exit(fails === 0 ? 0 : 1);
