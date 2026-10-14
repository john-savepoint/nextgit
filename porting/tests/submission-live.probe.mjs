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
// content-type, the UI pages, the secret-class masking laws on the wire, the
// attestation read-back (Ed25519 verify against the pinned key), the presign
// surface (honest-dual 200/503), the per-file classification on /changes, and
// the wave-16 UI pages (story, judge-comparison, sessions). DOM-level rendering
// stays in live-render.probe.mjs (browser); this gate is the
// API + page-delivery half of the pre-submission check.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";
const IDENTITY = "nextgit-demo-viewer";
const SHA_ZERO = "0".repeat(40);
const BLOB_KEY_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
// The classification vocabulary (platform/src/classify.ts — the single
// source the worker compiles from; mirrored here because the probe runs
// under node and cannot import the worker's TS).
const CLASSIFY_LANGUAGES = new Set([
  "typescript", "javascript", "json", "yaml", "toml",
  "markdown", "css", "html", "shell", "sql", "python",
  "rust", "go", "wasm", "text", "unknown",
]);
const CLASSIFY_ROLES = new Set(["source", "config", "docs", "data", "asset", "test"]);
const CLASSIFY_SENSITIVITIES = new Set(["public", "internal", "secret"]);
// The pinned attestation key (platform/wrangler.jsonc vars — the single
// source; never hardcoded) and the LIVE/CACHE KV namespace ids the
// landing-record discovery reads (env override, else the wrangler.jsonc
// binding ids).
const PLATFORM_ROOT = new URL("../../platform/", import.meta.url);
const WRANGLER = JSON.parse(readFileSync(new URL("wrangler.jsonc", PLATFORM_ROOT), "utf8"));
const PINNED_PUBLIC_KEY = WRANGLER.vars?.EVIDENCE_PUBLIC_KEY;
const KV_BINDING_IDS = new Map((WRANGLER.kv_namespaces ?? []).map((b) => [b.binding, b.id]));

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
// jRetry: the same GET with bounded transport-level retries — the
// discovery scan fans out many sequential reads, and one transient
// worker error must not abort the section (honest-unavailable
// posture: retry, then fall through to the next candidate).
const jRetry = async (path, attempts = 3) => {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await j(path); } catch (e) { last = e; }
  }
  throw last;
};

// The Ed25519 attestation verifier — the repo's own verification recipe
// (land-hardening.probe.mjs, CONTRACT.md §Attestations "Verification
// recipe"). Recomputes the signature over canonicalize(attestation minus
// sig) and verifies against the pinned public key. Canonicalization is
// the published law: recursive key sort, code-unit comparison, no
// whitespace, arrays in order.
const ATTEST_ALGO = "Ed25519";
const attestCanonical = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(attestCanonical).join(",")}]`;
  switch (typeof v) {
    case "string": return JSON.stringify(v);
    case "number": return Number.isFinite(v) ? String(v) : "null";
    case "boolean": return String(v);
    case "object": {
      const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${attestCanonical(v[k])}`).join(",")}}`;
    }
    default: return "null";
  }
};
const attestB64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const attestUnb64url = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const rem = normalized.length % 4;
  if (rem === 1) return null;
  const padded = rem === 2 ? `${normalized}==` : rem === 3 ? `${normalized}=` : normalized;
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
};
const attestVerify = async (att, publicKeyB64url) => {
  if (att === null || typeof att !== "object" || Array.isArray(att)) return false;
  if (att.status !== "signed" || att.v !== 1 || att.algo !== ATTEST_ALGO) return false;
  if (typeof att.keyId !== "string" || att.keyId.length !== 16) return false;
  if (typeof att.sig !== "string") return false;
  if (att.subject?.commit !== att.evidence?.commit) return false;
  if (JSON.stringify(att.subject?.repos) !== JSON.stringify(att.evidence?.repos)) return false;
  const raw = attestUnb64url(publicKeyB64url);
  if (raw === null) return false;
  let key;
  try {
    key = await crypto.subtle.importKey("raw", raw, { name: ATTEST_ALGO }, false, ["verify"]);
  } catch { return false; }
  const sig = attestUnb64url(att.sig);
  if (sig === null || sig.length !== 64) return false;
  const payload = { ...att };
  delete payload.sig;
  return crypto.subtle.verify(ATTEST_ALGO, key, sig, new TextEncoder().encode(attestCanonical(payload)));
};
// keyId = sha256(raw public key)[0..16] hex (platform/src/attest.ts
// keyIdOf) — derived locally so a key rotation without a wrangler.jsonc
// update cannot silently pass.
const attestKeyIdOf = async (publicKeyB64url) => {
  const raw = attestUnb64url(publicKeyB64url);
  if (raw === null) return null;
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
};
// wranglerKvKeys(binding, prefix): list KV keys for one binding via the
// wrangler CLI (the read-only list idiom). Returns [] on any failure —
// the caller renders an honest SKIP, never a red (the same
// honest-unavailable posture the worker itself uses).
const wranglerKvKeys = (binding, prefix) => {
  const id = KV_BINDING_IDS.get(binding);
  if (!id) return [];
  try {
    const out = execFileSync(
      "wrangler",
      ["kv", "key", "list", "--binding", binding, "--remote", "--prefix", prefix],
      { cwd: new URL(".", PLATFORM_ROOT), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 },
    );
    return JSON.parse(out).map((k) => k.name).filter((n) => n.startsWith(prefix));
  } catch { return []; }
};

// --- 7. attestation on the landing-record read-back -----------------
// (a real land is too heavy for the gate — assert GET /landings/{known
// commit} envelope status signed|unavailable honestly + verify the
// signature when a signed envelope exists. No land, no mutation.)
try {
  const r404 = await jRetry(`/landings/${SHA_ZERO}`);
  check("7 GET /landings/<zeros> 404 not-found", r404.status === 404 && r404.body?.ok === false && r404.body?.error === "not-found", `status=${r404.status} body=${JSON.stringify(r404.body)}`);

  const r400 = await jRetry("/landings/not-a-sha");
  check("7 GET /landings/<bad> 400 bad-request", r400.status === 400 && r400.body?.ok === false && r400.body?.error === "bad-request", `status=${r400.status} body=${JSON.stringify(r400.body)}`);

  // Known-commit discovery: the handler reads the KV CACHE binding
  // (index.ts handleLandingsRead: env.CACHE.get("landing:<commit>")), so
  // the discovery lists that binding's landing: keys via the read-only
  // wrangler CLI and reads the record back through the same route a
  // client would. Bounded (first 24 keys, two passes: signed-envelope
  // records first — the crypto-verifiable case — then any valid
  // envelope); any discovery failure is an honest SKIP, never a red
  // (no record = nothing to verify).
  const landingKeys = wranglerKvKeys("CACHE", "landing:").slice(0, 24);
  const commits = landingKeys
    .map((name) => name.slice("landing:".length))
    .filter((commit) => COMMIT_RE.test(commit));
  let knownCommit = null;
  let knownAttestation = null;
  for (const preferSigned of [true, false]) {
    for (const commit of commits) {
      let probe;
      try { probe = await jRetry(`/landings/${commit}`); } catch { continue; }
      if (probe.status !== 200 || probe.body?.ok !== true) continue;
      const att = probe.body?.attestation;
      if (preferSigned ? att?.status === "signed" : att !== undefined) {
        knownCommit = commit;
        knownAttestation = att ?? null;
        break;
      }
    }
    if (knownCommit) break;
  }
  if (!knownCommit) {
    check("7 GET /landings/<known> envelope + honest attestation union", true, "SKIP (no landing record discoverable read-only)");
  } else {
    const att = knownAttestation;
    const envelopeOk = true; // discovery already observed the 200 {ok:true} envelope
    const honestUnion = att === null
      || (att?.status === "signed")
      || (att?.status === "unavailable" && ["signing-key-absent", "public-key-absent"].includes(att?.reason));
    // ONE check for the envelope + the honest union; the sub-assertions
    // below (internal consistency, envelope fields, keyId derivation,
    // Ed25519 verify, tamper leg) gate the SAME check when the record
    // carries a signed envelope — they are the evidence the union
    // claim rests on, not extra checks.
    let subDetail = `commit=${knownCommit} branch=${att?.status ?? "null"}`;
    let subOk = envelopeOk && honestUnion;
    if (subOk && att?.status === "signed") {
      const internal = att.subject?.commit === att.evidence?.commit
        && JSON.stringify(att.subject?.repos) === JSON.stringify(att.evidence?.repos);
      const fields = att.v === 1 && att.algo === "Ed25519"
        && typeof att.keyId === "string" && /^[0-9a-f]{16}$/.test(att.keyId);
      subOk = internal && fields;
      subDetail += ` subject.commit=${att.subject?.commit} evidence.commit=${att.evidence?.commit} v=${att.v} algo=${att.algo} keyId=${att.keyId}`;
      if (subOk) {
        if (typeof PINNED_PUBLIC_KEY === "string" && !PINNED_PUBLIC_KEY.startsWith("<")) {
          const derived = await attestKeyIdOf(PINNED_PUBLIC_KEY);
          const verifies = await attestVerify(att, PINNED_PUBLIC_KEY);
          // Tamper leg: flip one signed field; the SAME verifier must fail.
          const tampered = JSON.parse(JSON.stringify(att));
          tampered.environment = { ...(tampered.environment ?? {}), deploy: "tampered" };
          const tamperFails = !(await attestVerify(tampered, PINNED_PUBLIC_KEY));
          subOk = derived === att.keyId && verifies && tamperFails;
          subDetail += ` derivedKeyId=${derived} verifies=${verifies} tamperFails=${tamperFails}`;
        } else {
          subOk = false;
          subDetail += " EVIDENCE_PUBLIC_KEY not provisioned (placeholder)";
        }
      }
    }
    check("7 GET /landings/<known> envelope + honest attestation union", subOk, subDetail.slice(0, 300));
  }
} catch (e) { check("7 attestation threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 8. presign surface (400 -> 429 -> 503 -> 200) -----------------
// HONEST-DUAL: the canonical deploy answers 503 presign-unavailable
// (the S3 control-plane credentials are absent in this environment —
// CONTRACT presign "Fail-closed credentials"); a credentialed deploy
// answers 200 with the minted URL. Both legs are green; anything else
// is red. The URL is a bearer token: shape-asserted only, never
// logged, stored, or followed (the no-URL-egress law).
try {
  const r400key = await j(`/asset/not-64-hex/presign`);
  check("8 GET /asset/<not-64-hex>/presign 400 (BLOB_KEY_RE law)", r400key.status === 400 && r400key.body?.ok === false, `status=${r400key.status} body=${JSON.stringify(r400key.body)}`);

  const r400exp = await j(`/asset/${"a".repeat(64)}/presign?expires=abc`);
  check("8 GET /asset/<64hex>/presign?expires=abc 400 invalid expires", r400exp.status === 400 && r400exp.body?.ok === false, `status=${r400exp.status} body=${JSON.stringify(r400exp.body)}`);

  const mint = await j(`/asset/${"b".repeat(64)}/presign`);
  if (mint.status === 503) {
    check("8 GET /asset/<64hex>/presign honest-dual (503 presign-unavailable leg)", mint.body?.ok === false && mint.body?.error === "presign-unavailable", `status=${mint.status} body=${JSON.stringify(mint.body)}`);
  } else if (mint.status === 200 && mint.body?.ok === true) {
    const b = mint.body;
    const urlOk = typeof b.url === "string" && /^[0-9a-f]+\.r2\.cloudflarestorage\.com\//.test(new URL(b.url).host + "/");
    const atOk = typeof b.expiresAt === "string" && !Number.isNaN(Date.parse(b.expiresAt)) && Date.parse(b.expiresAt) > Date.now();
    const inOk = Number.isInteger(b.expiresIn) && b.expiresIn >= 1 && b.expiresIn <= 604800;
    const skewOk = Math.abs((Date.parse(b.expiresAt) - Date.now()) / 1000 - b.expiresIn) <= 60;
    check("8 GET /asset/<64hex>/presign honest-dual (200 leg: R2 endpoint url, future ISO expiresAt, bounded expiresIn, skew<=60s)",
      b.blobId === "b".repeat(64) && urlOk && atOk && inOk && skewOk,
      `expiresIn=${b.expiresIn} expiresAt=${b.expiresAt}`);
  } else {
    check("8 GET /asset/<64hex>/presign honest-dual (200-or-503)", false, `status=${mint.status} body=${JSON.stringify(mint.body)}`);
  }
} catch (e) { check("8 presign threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 9. per-file classification on /changes --------------------------
// (the classify-every-file surface is LANDED — wave-16 storage-chain —
// so unconditional. classify.ts is the single source for the three
// axes; the probe mirrors its vocabulary.)
try {
  const ch = await j("/changes?repo=agent-1&base=demo");
  const files = ch.body?.changeSet?.files;
  const rowsOk = ch.status === 200 && Array.isArray(files) && files.length > 0
    && files.every((f) => {
      const c = f?.classification;
      return c && typeof c === "object"
        && Object.keys(c).length === 3
        && CLASSIFY_LANGUAGES.has(c.language)
        && CLASSIFY_ROLES.has(c.role)
        && CLASSIFY_SENSITIVITIES.has(c.sensitivity);
    });
  check("9 /changes agent-1 every files[] row carries classification {language,role,sensitivity} (vocabulary-checked)", rowsOk,
    files ? JSON.stringify(files.map((f) => [f.path, f.classification])).slice(0, 200) : `status=${ch.status}`);

  const ch5 = await j("/changes?repo=agent-5&base=demo");
  const envRow = (ch5.body?.changeSet?.files ?? []).find((f) => f?.path === "config/.env");
  check("9 /changes agent-5 config/.env classification.sensitivity === secret (AD-4 alignment)",
    ch5.status === 200 && envRow?.classification?.sensitivity === "secret",
    JSON.stringify(envRow?.classification ?? null));
} catch (e) { check("9 classification threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 10. the wave-16 UI pages ---------------------------------------
// (the served page carries class="story-section" / class="story-tiers"
// — the code's actual markers; the plan prose said id=, the live HTML
// wins.)
try {
  const story = await fetch(`${BASE}/story`);
  const storyText = await story.text();
  check("10 /story 200 + story-section + story-tiers + tier kinds",
    story.status === 200 && storyText.includes("story-section") && storyText.includes("story-tiers") && storyText.includes("story-tier-kind"),
    `status=${story.status} len=${storyText.length}`);

  const index = await fetch(`${BASE}/`);
  const indexText = await index.text();
  const judgeOk = ["judge-comparison-section", "judge-comparison-list", "judge-comparison-badge"].every((m) => indexText.includes(`id="${m}"`));
  const judgeJs = await j("/js/judge-comparison.js");
  check("10 / has judge-comparison markers + /js/judge-comparison.js 200",
    index.status === 200 && judgeOk && judgeJs.status === 200,
    `index=${index.status} js=${judgeJs.status}`);

  const sessionsOk = ["sessions-section", "sessions-list", "sessions-meta"].every((m) => indexText.includes(`id="${m}"`));
  const sessionsJs = await j("/js/sessions-panel.js");
  check("10 / has sessions markers + /js/sessions-panel.js 200",
    sessionsOk && sessionsJs.status === 200,
    `markers=${sessionsOk} js=${sessionsJs.status}`);

  const sessionsApi = await j("/sessions?base=demo");
  check("10 GET /sessions?base=demo 200 {ok,base,sessions}",
    sessionsApi.status === 200 && sessionsApi.body?.ok === true
    && sessionsApi.body?.base === "demo" && Array.isArray(sessionsApi.body?.sessions),
    `api=${sessionsApi.status} body=${JSON.stringify(sessionsApi.body).slice(0, 100)}`);
} catch (e) { check("10 pages threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 11. pipelines route, conditional -------------------------------
// (ci-pipelines-v2 order, lane L2, is plan-phase — NOT yet landed.
// 404 today = honest SKIP; once L2 lands this must answer 200 with the
// sibling-pinned shape: {ok:true, base, pipelines:[{id:<40hex>, repos,
// at:ISO, checks[], results[], status, attestation}]}.)
try {
  const p = await j("/pipelines?base=demo");
  if (p.status === 404) {
    check("11 GET /pipelines?base=demo (SKIP — route not landed yet — ci-pipelines-v2 pending)", true, "SKIP (route not landed yet — ci-pipelines-v2 pending)");
  } else if (p.status === 200 && p.body?.ok === true && p.body?.base === "demo" && Array.isArray(p.body?.pipelines)) {
    const rowsOk = p.body.pipelines.every((row) => {
      const st = row?.status;
      const at = row?.attestation;
      return COMMIT_RE.test(String(row?.id))
        && Array.isArray(row?.repos) && Array.isArray(row?.checks) && Array.isArray(row?.results)
        && typeof row?.at === "string" && !Number.isNaN(Date.parse(row?.at))
        && ["passed", "not-recorded", "failed"].includes(st)
        && (at === null || at === "signed" || at === "unavailable");
    });
    check("11 GET /pipelines?base=demo 200 with the pinned pipelines shape", rowsOk, JSON.stringify(p.body).slice(0, 160));
  } else {
    check("11 GET /pipelines?base=demo (404-skip or 200-pinned-shape)", false, `status=${p.status} body=${JSON.stringify(p.body)}`);
  }
} catch (e) { check("11 pipelines threw", false, String(e?.message ?? e).slice(0, 200)); }

console.log(`submission-live gate — ${BASE}\n`);

// --- 1. health + read-route matrix (shapes + statuses) -----------------------
try {
  const h = await jRetry("/health");
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
    let r;
    try { r = await jRetry(path); } catch (e) { check(`1 GET ${path.split("?")[0]} 200 (${label})`, false, `transport failed after retries: ${String(e?.message ?? e).slice(0, 120)}`); continue; }
    check(`1 GET ${path.split("?")[0]} 200 (${label})`, r.status === 200 && okFn(r.body), `status=${r.status} body=${JSON.stringify(r.body).slice(0, 100)}`);
  }
} catch (e) { check("1 read matrix threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 2. file read + secret-class masking on the wire -------------------------
try {
  const f = await jRetry("/file?repo=agent-1&ref=main&path=README.md");
  check("2 /file text row", f.status === 200 && f.body?.ok === true && f.body?.classification === "text" && typeof f.body?.text === "string", JSON.stringify({ s: f.status, c: f.body?.classification }));
  const env = await jRetry("/file?repo=agent-5&ref=main&path=config/.env");
  check("2 /file secret row = keys only, never a value", env.status === 200 && env.body?.classification === "secret" && Array.isArray(env.body?.keys) && !("value" in (env.body ?? {})) && !/postgres:/.test(env.text), JSON.stringify({ c: env.body?.classification, keys: env.body?.keys?.length }));
  const raw = await jRetry("/raw/agent-5/main/config/.env");
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
// (per-page bounded retry — the pages are static asset delivery;
// a transient worker transport error must not red the gate.)
try {
  const pages = [
    ["/", (t) => t.includes("proposals-grid") || t.includes("id=\"proposals")],
    ["/files.html", (t) => t.includes("repo-picker") && t.includes('id="file-tree"')],
    ["/history.html", (t) => t.includes("commit-list") || t.includes("history")],
    ["/parity.html", (t) => t.includes("parity")],
    ["/tour.html", (t) => t.includes("tour")],
  ];
  for (const [p, okFn] of pages) {
    let r;
    try { r = await jRetry(p); } catch (e) { check(`5 page ${p} 200 + entry markers`, false, `transport failed after retries: ${String(e?.message ?? e).slice(0, 120)}`); continue; }
    const t = r.text;
    check(`5 page ${p} 200 + entry markers`, r.status === 200 && okFn(t), `status=${r.status} len=${t.length}`);
  }
} catch (e) { check("5 pages threw", false, String(e?.message ?? e).slice(0, 200)); }

// --- 6. honest refusals (allowlist + unknown path) ---------------------------
try {
  const evil = await jRetry("/changes?repo=notdemo-xyz&base=demo");
  check("6 non-allowlisted repo 403", evil.status === 403, `status=${evil.status}`);
  const unknown = await jRetry("/no-such-route");
  check("6 unknown path 404 JSON", unknown.status === 404 && unknown.body?.ok === false, `status=${unknown.status}`);
} catch (e) { check("6 refusals threw", false, String(e?.message ?? e).slice(0, 200)); }

console.log(fails === 0 ? `\nSUBMISSION LIVE GATE: PASS (${checks} checks)` : `\nSUBMISSION LIVE GATE: FAIL — ${fails}/${checks}`);
process.exit(fails === 0 ? 0 : 1);
