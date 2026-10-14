#!/usr/bin/env node
// land-hardening.probe.mjs — LIVE probe for the /land hardening (AD-3).
// Scratch chain ONLY: REST-fork demo -> demo-lh-base -> agent-lh-1; asserts:
//  (a) 200 happy path carries evidence {repos,commit,ancestor,heads,foldHash,checks,results,mergedSha,testedSha,artifactRef,at,lease}
//      (the 12 pre-gate keys) plus the posture-conditional autoLand (present only while the deployed worker is engaged); the 200 body is
//      {ok,landed,evidence,attestation} — the signed validation-evidence envelope
//      (CONTRACT.md §Attestations); and the base remote's ref equals evidence.commit; (a-note) fetch the nextgit-notes mirror and assert the landing-decision note payload {repos,commit,foldHash,at}; (a-read) GET /landings/<evidence.commit> returns the record landed
//      in that call and GET /landings/<zeros> -> 404 not-found; (b) re-land with
//      refreshed reviewed heads -> 409 no-changes; (c) stale reviewed heads ->
//      409 stale (proposal-head + base-head variants); (d) four-way concurrent
//      land, identical reviewed heads -> exactly one 200, every loser 409
//      (base-moved | stale) with no success payload, and the base ref advances
//      exactly once to the winner's evidence.commit (fetched parent = the
//      reviewed head) and never regresses — no silent overwrite; (d-lease) the
//      winner's evidence carries the DO lease record (provider=do, leaseId=uuid),
//      losers carry no success payload, and a second land after the winner
//      succeeds (lease released); (e) both
//      scratch repos deleted on exit; (f)-(j) the
//      fork-point ancestor proof: the proposal edits a baseline file, a third
//      party advances the base on the same file, then GET /merge and POST
//      /land must fold with the FORK POINT as the 3-way ancestor — evidence
//      .ancestor[repo] stays the fork point while evidence.heads.base is the
//      moved head, and the landed text keeps BOTH the baseline-side and the
//      proposal-side change (a moved-base-anchored fold silently drops the
//      baseline-side change). Never lands into `demo`; never touches
//      agent-1..5. Exit 0 = all green.
// Run: node porting/tests/land-hardening.probe.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-land-hardening-probe/1.0";
const BASE_REPO = "demo-lh-base";
const PROPOSAL_REPO = "agent-lh-1";
const SHA_ZERO = "0".repeat(40);

// KV LIVE namespace id for the landing-record read-back: env override, else the
// binding id in platform/wrangler.jsonc (single source of truth).
const LIVE_KV_ID = process.env.NEXTGIT_LIVE_KV_ID
 ?? JSON.parse(readFileSync(new URL("../../platform/wrangler.jsonc", import.meta.url), "utf8")).kv_namespaces.find((b) => b.binding === "LIVE")?.id;
const ARTIFACT_REF = "porting/runs/e3-impl-land-record-evidence";

// (f)-(j): the baseline file both sides advance, and the markers that make
// the moved-base fold outcome visible (a wrong ancestor drops the baseline
// marker while keeping the proposal marker).
const ANCESTOR_FILE = "src/server.ts";
const BASE_MARKER = "// e2-verify-fork-point-ancestor: baseline-side change";
const PROP_MARKER = "// e2-verify-fork-point-ancestor: proposal-side change";

// Scratch-only guard: the probe must never operate outside its lh-* chain.
if (!BASE_REPO.startsWith("demo-lh-") || !PROPOSAL_REPO.startsWith("agent-lh-")) {
 throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credRe = /token|plaintext|secret|credential|caller/i;

// apiToken(): copy fanout.mjs:24-37 + real-agents.mjs:45-67 (CLOUDFLARE_API_TOKEN env,
// else wrangler OAuth toml) — cached so api() can drop it after a 401 and re-read the
// toml `wrangler whoami` refreshes in place.
let cachedToken = null;
function apiToken() {
 if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
 if (cachedToken) return cachedToken;
 const candidates = [
  join(homedir(), ".config/.wrangler/config/default.toml"),
  join(homedir(), ".wrangler/config/default.toml"),
 ];
 for (const p of candidates) {
  if (existsSync(p)) {
   const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
   if (m) return (cachedToken = m[1]);
  }
 }
 throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

// api(method, path, body): fetch against `${apiBase}` with 3 transport retries, 30s timeout;
// returns { status, success: data.success===true, result, raw }. A 401 refreshes the wrangler
// OAuth token in place (`wrangler whoami`, real-agents.mjs:83-94) and retries once — a mid-run
// token expiry must not false-RED the probe (verify.md @ 2026-10-07).
async function api(method, path, body) {
 let last;
 let refreshed = false;
 for (let attempt = 0; attempt < 4; attempt++) {
  try {
   const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { ...apiHeaders(), connection: "close" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
   });
   const data = await res.json().catch(() => ({}));
   if (res.status === 401 && !refreshed && !process.env.CLOUDFLARE_API_TOKEN) {
    refreshed = true;
    cachedToken = null;
    console.log(`  auth 401 on ${method} ${path} -> wrangler whoami refresh, retrying`);
    try {
     execFileSync("wrangler", ["whoami"], { stdio: "ignore", timeout: 60_000 });
    } catch (refreshErr) {
     last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh the OAuth token: ${refreshErr?.message ?? refreshErr}`);
     break;
    }
    continue;
   }
   return { status: res.status, success: data.success === true, result: data.result, raw: data };
  } catch (err) {
   last = err; // transport failure only — HTTP statuses are never retried
   if (attempt < 3) await sleep(500 * (attempt + 1));
  }
 }
 throw last;
}

// fork(src, name): POST `/repos/${src}/fork` { name, default_branch_only: true }; 5 attempts
// with 1.5s*attempt backoff on the transient creation lag: "already exists" (10201) right
// after an async DELETE, 404 10200 "Repository not found" / 5xx while a just-forked repo
// settles, and the plan-recorded transient 403; other errors throw.
async function fork(src, name) {
 let last;
 for (let attempt = 1; attempt <= 5; attempt++) {
  const r = await api("POST", `/repos/${src}/fork`, { name, default_branch_only: true });
  if (r.success) return r.result;
  last = new Error(`fork ${src} -> ${name} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  const transient = /already exists/i.test(last.message) || r.status === 403 || r.status === 404 || r.status >= 500;
  if (!transient) throw last;
  await sleep(1500 * attempt);
 }
 throw last;
}

// mint(repo): POST `/tokens` { repo, scope: "write", ttl: 3600 } -> result.plaintext.
async function mint(repo) {
 const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
 if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
 return r.result.plaintext;
}

// deleteRepo(name): DELETE with bounded retry on 5xx — the post-delete lag class the siblings
// absorb (real-agents.mjs:293-297, secret-fixture.mjs:93-98): 200/202 = accepted, 404 = already
// gone; every other status returns as-is and the caller fails closed on it.
async function deleteRepo(name) {
 let last;
 for (let attempt = 1; attempt <= 3; attempt++) {
  const r = await api("DELETE", `/repos/${name}`);
  if (r.status < 500) return r;
  last = r;
  await sleep(1500 * attempt);
 }
 return last;
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const apiHeaders = () => ({ Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" });
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const gitAuthEnv = (token) => ({ ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });

async function land(body) {
 const res = await fetch(`${PLATFORM}/land`, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": UA, connection: "close" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120_000),
 });
 const json = await res.json().catch(() => null);
 console.log(`  /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
 return { status: res.status, json };
}

// getJson(path): read-only GET against the platform (the /merge arm).
async function getJson(path) {
 const res = await fetch(`${PLATFORM}${path}`, {
  headers: { "user-agent": UA, connection: "close" },
  signal: AbortSignal.timeout(120_000),
 });
 const json = await res.json().catch(() => null);
 console.log(`  GET ${path} -> HTTP ${res.status}`);
 return { status: res.status, json };
}

let dir;
let baseDir;
try {
 console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);
 let cleaned = false;
 for (const name of [PROPOSAL_REPO, BASE_REPO]) {
  const r = await deleteRepo(name);
  console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
  if (r.status === 200 || r.status === 202) cleaned = true;
 }
 // Deletes are eventually consistent (real-agents.mjs:295-296, secret-fixture.mjs:97):
 // forking right after an accepted DELETE can 500/404 while the namespace settles. fork()
 // retries the residual lag; the sleep applies only when something was actually deleted.
 if (cleaned) await sleep(1200);
 await fork("demo", BASE_REPO);
 await fork(BASE_REPO, PROPOSAL_REPO);

 const proposalToken = await mint(PROPOSAL_REPO);
 const baseEnv = gitAuthEnv(await mint(BASE_REPO));
 const lsBase = () => execFileSync("git", ["ls-remote", `${gitBase}/${BASE_REPO}.git`, "refs/heads/main"], { env: baseEnv, encoding: "utf8" }).trim().split("\t")[0];

 dir = mkdtempSync(join(tmpdir(), "nextgit-lh-probe-"));
 const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
 git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
 git("config", "user.name", "land-hardening-probe");
 git("config", "user.email", "probe@nextgit.dev");
 const H0 = git("rev-parse", "HEAD");
 writeFileSync(join(dir, "lh-probe-1.txt"), `land-hardening probe ${new Date().toISOString()}\n`);
 git("add", "-A"); git("commit", "-m", "probe: edit 1"); git("push", "origin", "HEAD:refs/heads/main");
 const C1 = git("rev-parse", "HEAD");
 console.log(`H0 ${H0}\nC1 ${C1}\n`);

 // (a) happy path: 200 carries evidence; the commit is a real reference.
 console.log("(a) land with reviewed heads");
 const a = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: H0, heads: { [PROPOSAL_REPO]: C1 } } });
 const ev = a.json?.evidence ?? {};
 check("(a) 200 ok", a.status === 200 && a.json?.ok === true);
 // (a) evidence keys — posture-aware (AD-11). autoLand rides the engaged
 // AD-11 gate (CONTRACT v3.1): ABSENT while AUTO_LAND_ENGAGED=false
 // (platform/src/autoland.ts — the deployed worker’s posture; the evidence
 // builder omits the key, index.ts:1342). The probe runs under node (no .ts
 // import), so posture is derived from the observed evidence: the 12 pre-gate
 // keys always; autoLand present only when the deployed worker is engaged.
 // exactKeys still fails on ANY key outside {12}∪{autoLand} (leak/stray).
 const EVIDENCE_KEYS = ["repos", "commit", "ancestor", "heads", "foldHash", "checks", "results", "mergedSha", "testedSha", "artifactRef", "at", "lease"];
 const expectedKeys = "autoLand" in ev ? [...EVIDENCE_KEYS, "autoLand"] : EVIDENCE_KEYS;
 check("(a) evidence keys", exactKeys(ev, expectedKeys), JSON.stringify(Object.keys(ev)));
 check("(a) evidence.repos", JSON.stringify(ev.repos) === JSON.stringify([PROPOSAL_REPO]));
 check("(a) evidence.commit === landed.commit", !!ev.commit && ev.commit === a.json?.landed?.commit);
 check("(a) ancestor = fork point H0", ev.ancestor?.[PROPOSAL_REPO] === H0, JSON.stringify(ev.ancestor));
 check("(a) heads = fold inputs", ev.heads?.base === H0 && ev.heads?.repos?.[PROPOSAL_REPO] === C1, JSON.stringify(ev.heads));
 check("(a) foldHash sha256 hex", /^[0-9a-f]{64}$/.test(String(ev.foldHash)), String(ev.foldHash));
 // (a) extended evidence (FR-18): the server's content-identity check is appended
 // to the validation ledger; with no `validation` supplied by the caller,
 // testedSha is null and the equality check result is "not-recorded".
 const MERGED_SHA_CHECK = "merged-sha-equals-tested-sha";
 check("(a) checks includes merged-sha-equals-tested-sha last", Array.isArray(ev.checks) && ev.checks[ev.checks.length - 1] === MERGED_SHA_CHECK, JSON.stringify(ev.checks));
 check("(a) results pairs one-to-one with checks", Array.isArray(ev.results) && ev.results.length === ev.checks.length, JSON.stringify(ev.results));
 check("(a) equality check result is not-recorded (no validation supplied)", ev.results[ev.results.length - 1] === "not-recorded", JSON.stringify(ev.results));
 check("(a) mergedSha === foldHash (sha256 hex)", typeof ev.mergedSha === "string" && ev.mergedSha === ev.foldHash && /^[0-9a-f]{64}$/.test(ev.mergedSha), String(ev.mergedSha));
 check("(a) testedSha is null (no validation supplied)", ev.testedSha === null, String(ev.testedSha));
 check("(a) artifactRef is null (no validation supplied)", ev.artifactRef === null, String(ev.artifactRef));
 check("(a) at is an ISO timestamp", typeof ev.at === "string" && !Number.isNaN(Date.parse(ev.at)), String(ev.at));
 check("(a) landed.files has lh-probe-1.txt", Array.isArray(a.json?.landed?.files) && a.json.landed.files.includes("lh-probe-1.txt"));
 const C2 = ev.commit;
 check("(a) base remote ref === evidence.commit", (await lsBase()) === C2);
 check("(a) landed commit is a new sha (≠ fork point)", !!C2 && C2 !== H0);
 // Exact key-set proof: 200 carries {ok, landed, evidence, attestation} only —
 // no token / plaintext / secret field anywhere in the success body.
 check("(a) success exact keys {ok,landed,evidence,attestation}", exactKeys(a.json, ["ok", "landed", "evidence", "attestation"]), JSON.stringify(Object.keys(a.json ?? {})));
 check("(a) success no credential field", !credRe.test(JSON.stringify(a.json)));

 // Exact key-set proof for the `landed` sub-object: the success body's inner
 // payload must be exactly {repos, commit, files, at} — no credential-shaped
 // field can hide inside landed even if the top-level regex sweep would pass it.
 check("(a) landed exact keys {repos,commit,files,at}", exactKeys(a.json?.landed, ["repos", "commit", "files", "at"]), JSON.stringify(a.json?.landed ?? null));
 check("(a) landed no credential field", !credRe.test(JSON.stringify(a.json?.landed ?? {})));

 // (a-note) Fetch the nextgit-notes mirror from the base repo and read the
 // landing-decision note for the landed commit. Asserts the 7 checks:
 // note exists, repos===[PROPOSAL_REPO], commit===C2, foldHash===ev.foldHash,
 // at is ISO, exact key-set, no secret-shaped content.
 console.log("(a-note) fetch nextgit-notes note for " + C2);
 const noteRef = "refs/notes/commits";
 // Fetch refs/heads/nextgit-notes from the base repo into the local notes ref.
 try {
  execFileSync("git", ["fetch", `${gitBase}/${BASE_REPO}.git`, "refs/heads/nextgit-notes:" + noteRef], { cwd: dir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
 } catch (e) {
  check("(a-note) nextgit-notes ref fetched from remote", false, String(e?.message ?? e));
 }
 let noteContent = "";
 try {
  noteContent = execFileSync("git", ["notes", "--ref=" + noteRef, "show", C2], { cwd: dir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
 } catch (e) {
  check("(a-note) note exists on landed commit", false, String(e?.message ?? e));
 }
 let note = {};
 try { note = JSON.parse(noteContent); } catch { check("(a-note) note is valid JSON", false, "parse error"); }
 check("(a-note) note exists on landed commit", !!noteContent, "empty note content");
 check("(a-note) note.repos === [PROPOSAL_REPO]", JSON.stringify(note.repos) === JSON.stringify([PROPOSAL_REPO]), JSON.stringify(note.repos));
 check("(a-note) note.commit === C2", note.commit === C2, note.commit);
 check("(a-note) note.foldHash === ev.foldHash", note.foldHash === ev.foldHash, note.foldHash);
 check("(a-note) note.at is ISO", typeof note.at === "string" && !Number.isNaN(Date.parse(note.at)), note.at);
 check("(a-note) note exact keys {repos,commit,foldHash,at}", exactKeys(note, ["repos", "commit", "foldHash", "at"]), JSON.stringify(Object.keys(note ?? {})));
 check("(a-note) no secret-shaped content in note", !credRe.test(noteContent), JSON.stringify(note));
 // (a-read) GET /landings/<evidence.commit> returns the record landed in that call.
 console.log("(a-read) GET /landings/" + C2);
 const r = await getJson(`/landings/${C2}`);
 check("(a-read) 200 from /landings/<commit>", r.status === 200, String(r.status));
 check("(a-read) exact keys {ok,landed,evidence,attestation}", exactKeys(r.json, ["ok", "landed", "evidence", "attestation"]), JSON.stringify(r.json));
 check("(a-read) landed deep-equals POST /land landed", JSON.stringify(r.json?.landed) === JSON.stringify(a.json?.landed));
 check("(a-read) evidence deep-equals POST /land evidence", JSON.stringify(r.json?.evidence) === JSON.stringify(a.json?.evidence));
 check("(a-read) attestation deep-equals POST /land attestation", JSON.stringify(r.json?.attestation) === JSON.stringify(a.json?.attestation));
 check("(a-read) no credential field in read-back", !credRe.test(JSON.stringify(r.json)));
 // GET /landings/<zeros> -> 404 not-found (all-zeros is not a real landing).
 const r404 = await getJson(`/landings/${SHA_ZERO}`);
 check("(a-read) 404 from /landings/<zeros>", r404.status === 404, String(r404.status));
 check("(a-read) 404 not-found body", r404.json?.ok === false && r404.json?.error === "not-found", JSON.stringify(r404.json));
 // GET /landings/<bad-input> -> 400 bad-request (non-40-hex).
 const r400 = await getJson(`/landings/not-a-sha`);
 check("(a-read) 400 from /landings/<bad>", r400.status === 400, String(r400.status));
 check("(a-read) 400 bad-request body", r400.json?.ok === false && r400.json?.error === "bad-request", JSON.stringify(r400.json));

 // (a-attest) the signed validation-evidence envelope
 // (CONTRACT.md §Attestations): the 200's attestation
 // verifies against the pinned public key, and the served
 // record's copy is byte-identical. Canonicalization is
 // the published law (recursive key sort, code-unit
 // comparison, no whitespace, arrays in order) — the same
 // discipline the operator verifier (platform/scripts/
 // attest-verify.mjs) recomputes locally.
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
 const att = a.json?.attestation;
 check("(a-attest) 200 attestation present and signed", att?.status === "signed", JSON.stringify(att ?? null));
 if (att?.status === "signed") {
  check("(a-attest) attestation subject.commit === evidence.commit", att.subject?.commit === att.evidence?.commit);
  check("(a-attest) attestation subject.commit === landed commit", att.subject?.commit === C2);
  const pinned = JSON.parse(readFileSync(new URL("../../platform/wrangler.jsonc", import.meta.url), "utf8")).vars?.EVIDENCE_PUBLIC_KEY;
  if (typeof pinned !== "string" || pinned.startsWith("<")) {
   check("(a-attest) EVIDENCE_PUBLIC_KEY provisioned in wrangler.jsonc", false, "placeholder — run attestation-keygen.mjs and provision");
  } else {
   check("(a-attest) attestation signature verifies against the pinned public key", await attestVerify(att, pinned));
   // Tamper leg (the acceptance: tampering invalidates the signature):
   // flip one signed field and assert the SAME verifier fails.
   const tampered = JSON.parse(JSON.stringify(att));
   tampered.environment = { ...tampered.environment, deploy: "tampered" };
   check("(a-attest) tampered attestation FAILS verification", !(await attestVerify(tampered, pinned)));
  }
 }

 // (b) re-land same proposal, refreshed reviewed heads -> no-changes.
 console.log("(b) re-land (refreshed reviewed heads)");
 const b = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1 } } });
 check("(b) 409 no-changes", b.status === 409 && b.json?.error === "no-changes", JSON.stringify(b.json));

 // (c) stale reviewed heads refuse before any fold (two variants).
 console.log("(c) stale reviewed heads");
 const c1 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { heads: { [PROPOSAL_REPO]: SHA_ZERO } } });
 const c2 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: SHA_ZERO, heads: { [PROPOSAL_REPO]: C1 } } });
 check("(c) stale proposal head -> 409 stale", c1.status === 409 && c1.json?.error === "stale", JSON.stringify(c1.json));
 check("(c) stale base head -> 409 stale", c2.status === 409 && c2.json?.error === "stale", JSON.stringify(c2.json));
 check("(c) base unmoved by refusals", (await lsBase()) === C2);
 // Exact key-set proof: 409 stale carries {detail, error, ok} only —
 // no token / plaintext / secret / auth / caller field anywhere in the envelope.
 check("(c) stale c1 exact keys {detail,error,ok}", exactKeys(c1.json, ["detail", "error", "ok"]), JSON.stringify(c1.json));
 check("(c) stale c2 exact keys {detail,error,ok}", exactKeys(c2.json, ["detail", "error", "ok"]), JSON.stringify(c2.json));
 check("(c) stale c1 no credential field", !credRe.test(JSON.stringify(c1.json)));
 check("(c) stale c2 no credential field", !credRe.test(JSON.stringify(c2.json)));

 // (c-replay) a re-land with the same reviewed heads is refused (no-changes) —
 // the base ref cannot be advanced again by replaying the same fold. This proves
 // refused lands push nothing and cannot be replayed.
 const replayRes = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1 } } });
 check("(c-replay) re-land with same reviewed heads -> 409 no-changes", replayRes.status === 409 && replayRes.json?.error === "no-changes", JSON.stringify(replayRes.json));
 check("(c-replay) base ref still === evidence.commit (no replay)", (await lsBase()) === C2);

 // (d) four-way land race: identical reviewed heads, four requests in flight.
 // Exactly one push may win; every loser must be refused with a 409
 // (base-moved — the pre-push re-read / push witness; or stale — the
 // reviewed-heads gate, when a request reads the base after the winner's
 // push) and must carry no success payload. The base ref advances exactly
 // once — to the winner's evidence.commit, one commit on top of the reviewed
 // head — and never regresses: no silent overwrite (FR-17).
 writeFileSync(join(dir, "lh-probe-2.txt"), `land-hardening probe 2 ${new Date().toISOString()}\n`);
 git("add", "-A"); git("commit", "-m", "probe: edit 2"); git("push", "origin", "HEAD:refs/heads/main");
 const C1b = git("rev-parse", "HEAD");
 console.log(`C1b ${C1b}\n(d) four-way land race`);
 const raceBody = { base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1b } } };
 const racers = await Promise.all([land(raceBody), land(raceBody), land(raceBody), land(raceBody)]);
 const isWinner = (r) => r.status === 200 && r.json?.ok === true;
 const winners = racers.filter(isWinner);
 const losers = racers.filter((r) => !isWinner(r));
 check("(d) exactly one 200", winners.length === 1, JSON.stringify(racers.map((r) => r.status)));
 check(
  "(d) every loser 409 base-moved|stale, no success payload",
  losers.length === 3 &&
  losers.every(
   (r) =>
    r.status === 409 &&
    (r.json?.error === "base-moved" || r.json?.error === "stale") &&
    r.json?.ok !== true &&
    r.json?.landed === undefined &&
    r.json?.evidence === undefined,
  ),
  JSON.stringify(losers.map((r) => [r.status, r.json?.error])),
 );
 const C3 = winners[0]?.json?.evidence?.commit;
 check("(d) winner evidence.commit is a new sha", /^[0-9a-f]{40}$/.test(String(C3)) && C3 !== C2 && C3 === winners[0]?.json?.landed?.commit, String(C3));
 const refAfterRace = await lsBase();
 check("(d) base ref === winner evidence.commit (advanced exactly once)", refAfterRace === C3, `ref ${refAfterRace}`);
 // Exactly-once witness: the base tip's parent is the reviewed head C2 — the
 // winner's single commit sits directly on the state all four racers
 // reviewed; no loser commit interleaves and nothing was overwritten.
 execFileSync("git", ["fetch", `${gitBase}/${BASE_REPO}.git`, "main"], { cwd: dir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
 const tip = execFileSync("git", ["rev-parse", "FETCH_HEAD"], { cwd: dir, encoding: "utf8" }).trim();
 const tipParent = execFileSync("git", ["rev-parse", "FETCH_HEAD^"], { cwd: dir, encoding: "utf8" }).trim();
 check("(d) fetched tip = winner commit, parent = reviewed head", tip === C3 && tipParent === C2, `tip ${tip} parent ${tipParent}`);
 // Never regresses: once every racer's response has settled, a delayed loser
 // push (the silent-overwrite class) would move the ref off the winner.
 await sleep(1200);
 check("(d) base ref never regresses (late loser push would move it)", (await lsBase()) === C3);
 const dEv = winners[0]?.json?.evidence ?? {};
 check("(d) winner ancestor = fork point, heads.base = moved head", dEv.ancestor?.[PROPOSAL_REPO] === H0 && dEv.heads?.base === C2 && C2 !== H0, JSON.stringify({ ancestor: dEv.ancestor, heads: dEv.heads }));

 // Lease hardening (FR-17): the winner's evidence carries the DO lease record;
 // losers carry no success payload. (Section (d) is forward-compatible — the
 // 4-way race already asserts all losers 409 with no success payload.)
 check("(d) winner evidence.lease.provider = do", dEv.lease?.provider === "do", JSON.stringify(dEv.lease));
 check("(d) winner evidence.lease.leaseId is a uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(dEv.lease?.leaseId)), String(dEv.lease?.leaseId));
 check("(d) losers have no evidence.lease field", losers.every((r) => r.json?.evidence === undefined), JSON.stringify(losers.map((r) => r.json?.evidence)));

 // Lease-release-on-winner: after the winner released the lease, a fresh land
 // on the same base should succeed (the lease did not leak). Reuses the
 // scratch repos: fresh proposal edit + refreshed reviewed heads.
 console.log("(d-lease) second land on winner's base succeeds (lease released)");
 writeFileSync(join(dir, "lh-probe-3.txt"), `land-hardening probe 3 ${new Date().toISOString()}\n`);
 git("add", "-A"); git("commit", "-m", "probe: edit 3 (lease release check)"); git("push", "origin", "HEAD:refs/heads/main");
 const C4 = git("rev-parse", "HEAD");
 const releaseBody = { base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C3, heads: { [PROPOSAL_REPO]: C4 } } };
 const releaseRes = await land(releaseBody);
 check("(d-lease) second land 200 ok (lease released by winner)", releaseRes.status === 200 && releaseRes.json?.ok === true, JSON.stringify(releaseRes.json));
 check("(d-lease) second land evidence.lease.provider = do", releaseRes.json?.evidence?.lease?.provider === "do", JSON.stringify(releaseRes.json?.evidence?.lease));
 const C5 = releaseRes.json?.evidence?.commit;
 check("(d-lease) second land advanced base to new commit", !!C5 && C5 !== C3 && (await lsBase()) === C5, `C5 ${C5}`);

 // (f)-(j) Fork-point ancestor proof. The proposal edits a baseline file;
 // a third party then advances the base on the same file. A fold anchored
 // at the moved base head would silently DISCARD the baseline-side change
 // (diff3 treats the base's own text as the ancestor); anchored at the fork
 // point it merges both sides. /merge and /land must agree — same fold.
 console.log("(f) proposal-side edit of a baseline file");
 const X0 = readFileSync(join(dir, ANCESTOR_FILE), "utf8");
 writeFileSync(join(dir, ANCESTOR_FILE), X0 + PROP_MARKER + "\n");
 git("add", "-A"); git("commit", "-m", `probe: edit ${ANCESTOR_FILE} (proposal side)`); git("push", "origin", "HEAD:refs/heads/main");
 const C_F = git("rev-parse", "HEAD");
 check("(f) proposal head advanced", C_F !== C1b);

 console.log("(g) base-side advance on the same file (third party)");
 baseDir = mkdtempSync(join(tmpdir(), "nextgit-lh-base-"));
 const gitBaseRepo = (...args) => execFileSync("git", args, { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
 gitBaseRepo("clone", `${gitBase}/${BASE_REPO}.git`, baseDir);
 gitBaseRepo("config", "user.name", "land-hardening-probe");
 gitBaseRepo("config", "user.email", "probe@nextgit.dev");
 const X1 = readFileSync(join(baseDir, ANCESTOR_FILE), "utf8");
 writeFileSync(join(baseDir, ANCESTOR_FILE), BASE_MARKER + "\n" + X1);
 gitBaseRepo("add", "-A"); gitBaseRepo("commit", "-m", `probe: edit ${ANCESTOR_FILE} (baseline side)`); gitBaseRepo("push", "origin", "HEAD:refs/heads/main");
 const C_B = gitBaseRepo("rev-parse", "HEAD");
 check("(g) base advanced by the baseline-side commit", C_B !== C3 && (await lsBase()) === C_B);

 console.log("(h) GET /merge folds with the fork point (same computeMerge)");
 const h = await getJson(`/merge?base=${BASE_REPO}&repos=${PROPOSAL_REPO}&ref=main&baseRef=main`);
 const hm = h.json?.merge ?? {};
 const hFiles = Array.isArray(hm.files) ? hm.files : [];
 const hRow = hFiles.find((f) => f.path === ANCESTOR_FILE);
 check("(h) 200 ok / clean", h.status === 200 && h.json?.ok === true && hm.status === "clean", JSON.stringify(hm.status));
 check("(h) file set is exactly the modified file", hFiles.length === 1 && hRow?.action === "write" && hRow?.result === "merged", JSON.stringify(hFiles.map((f) => f.path)));
 check("(h) merged keeps the baseline-side change", typeof hRow?.merged === "string" && hRow.merged.includes(BASE_MARKER), JSON.stringify(hRow?.merged ?? null).slice(0, 120));
 check("(h) merged keeps the proposal-side change", typeof hRow?.merged === "string" && hRow.merged.includes(PROP_MARKER));

 console.log("(i) POST /land folds with the fork point as the ancestor");
 const i = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: C_B, heads: { [PROPOSAL_REPO]: C_F } } });
 const iev = i.json?.evidence ?? {};
 const C_L = iev.commit;
 check("(i) 200 ok", i.status === 200 && i.json?.ok === true);
 check("(i) ancestor = fork point while the base head moved", iev.ancestor?.[PROPOSAL_REPO] === H0 && iev.heads?.base === C_B && H0 !== C_B, JSON.stringify({ ancestor: iev.ancestor, heads: iev.heads }));
 check("(i) landed commit is a new sha", !!C_L && C_L !== H0 && C_L !== C_B && C_L === i.json?.landed?.commit);
 check("(i) landed files include the modified file", Array.isArray(i.json?.landed?.files) && i.json.landed.files.includes(ANCESTOR_FILE));
 check("(i) base remote ref === evidence.commit", !!C_L && (await lsBase()) === C_L);

 console.log("(j) read-back: the landed text keeps both changes");
 execFileSync("git", ["fetch", "origin", "main"], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
 const landedX = execFileSync("git", ["show", `${C_L}:${ANCESTOR_FILE}`], { cwd: baseDir, env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
 check("(j) landed file keeps the baseline-side change", landedX.includes(BASE_MARKER), landedX.slice(0, 120));
 check("(j) landed file keeps the proposal-side change", landedX.includes(PROP_MARKER));
 check("(j) landed text === /merge merged text (one fold)", hRow?.merged === landedX);
} catch (err) {
 fails++;
 console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
 for (const name of [PROPOSAL_REPO, BASE_REPO]) {
  try {
   const r = await deleteRepo(name);
   console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
   // 202 = deletion accepted (the Artifacts API answers 202 async); 404 = already gone.
   check(`(e) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
  } catch (err) {
   check(`(e) deleted ${name}`, false, String(err));
  }
 }
 if (dir) rmSync(dir, { recursive: true, force: true });
 if (baseDir) rmSync(baseDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — land-hardening probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
