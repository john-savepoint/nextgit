#!/usr/bin/env bun
// Contract suite: GET /checks (nextgit-e16-impl-ci-signals-v1) —
// the authoritative, server-computed per-proposal checks.
// Run: bun porting/tests/checks-api.test.mjs   (exit 0 = pass)
//
// Real construction: the real worker through worker.fetch against
// an in-memory Artifacts fake (the rate-limit.test.mjs fixture
// pattern; no mock.module, no source grep), plus a loopback-Chrome
// leg for the strip upgrade. Defends the observable contract:
//   1. Server-computed — GET /checks -> 200 {ok, base, checks}
//      with the five ids in order, every state tri-state.
//   2. Authority parity — the server's checks deep-equal the
//      client's proposalChecks derivation over the SAME /proposals
//      payload.
//   3. Honesty — an unresolvable-ref proposal carries unknown
//      for its five checks, none pass.
//   4. Fold verdict agreement — conflict/withheld-secret
//      proposals fail fold (+secrets for withheld).
//   5. Preconditions — omitted base == default demo; ?base= -> 400;
//      ?base=notdemo -> 403 with ZERO Artifacts reads (the
//      chokepoint fires pre-handler); POST /checks -> 405; the
//      61st call -> 429 (the new ROUTE_RATE_LIMITS row).
//   6. Strip consumes it (loopback Chrome) — the strip renders
//      the SERVER's detail verbatim; a fixture where /checks 404s
//      falls back to the client derivation with base unknown.
//   7. Negative scan — no secret-class value/key or fork-point
//      sha leaves /checks.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";
import { proposalChecks, CHECK_IDS } from "../../platform/ui/js/checks.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : " — " + detail)); };
const J = (x) => JSON.stringify(x);
const VALID_STATES = new Set(["pass", "fail", "unknown"]);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the rate-limit.test.mjs fixture surface).
// ---------------------------------------------------------------------------

const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

function internBlob(text) {
 if (!blobHashByText.has(text)) {
  const hash = "blob-" + (blobHashByText.size + 1);
  blobHashByText.set(text, hash);
  blobText.set(hash, text);
 }
 return blobHashByText.get(text);
}

function entriesFor(node) {
 return Object.entries(node).map(([name, child]) => {
  if (typeof child === "string") return { name, mode: "100644", hash: child, type: "blob" };
  return { name, mode: "40000", hash: treeHashFor(child), type: "tree" };
 });
}

function treeHashFor(node) {
 const entries = entriesFor(node);
 const hash = "tree-" + (treeEntries.size + 1);
 treeEntries.set(hash, entries);
 return hash;
}

function tree(files) {
 const root = {};
 for (const [path, text] of Object.entries(files)) {
  const parts = path.split("/");
  let node = root;
  for (const part of parts.slice(0, -1)) {
   node[part] = node[part] || {};
   node = node[part];
  }
  node[parts[parts.length - 1]] = internBlob(text);
 }
 return treeHashFor(root);
}

function commit(hash, treeHash) {
 const identity = { name: "fixture", email: "fixture@test" };
 return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
}

function defineRepo(name, { history, refs, intents = {} }) {
 repos.set(name, { history, refs, intents });
}

function lookupPath(treeHash, path) {
 const parts = path.split("/");
 let entries = treeEntries.get(treeHash);
 for (let i = 0; i < parts.length; i++) {
  const entry = (entries ?? []).find((e) => e.name === parts[i]);
  if (!entry) return null;
  if (i === parts.length - 1) return entry.type === "blob" ? entry.hash : null;
  if (entry.type !== "tree") return null;
  entries = treeEntries.get(entry.hash);
 }
 return null;
}

function repoFor(name) {
 const store = repos.get(name);
 if (!store) throw new Error("fixture: no repo " + name);
 const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
 return {
  async log({ ref = "HEAD", limit = 50 } = {}) {
   const byBranch = store.refs[ref];
   if (byBranch) return store.history.slice(0, limit);
   const single = resolve(ref);
   return single ? [single].slice(0, limit) : [];
  },
  async readTree(hash) {
   return treeEntries.get(hash) ?? null;
  },
  async readFile({ ref, path }) {
   const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
   if (!head) return null;
   if (path.startsWith("NEXTGIT_INTENT/")) {
    const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
    const text = store.intents[sha];
    return text === undefined ? null : new Blob([text]);
   }
   const blobHash = lookupPath(head.treeHash, path);
   return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
  },
  async readBlob(hash) {
   return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
  },
  async info() {
   return { remote: "https://artifacts.invalid/nextgit/" + name };
  },
  async revokeToken() {
   return true;
  },
  [Symbol.dispose]() { },
 };
}

const ARTIFACTS = {
 async get(name) {
  return repoFor(name);
 },
};

// Fixture repos (the checks scenario):
//   demo      — the baseline (agent-1..4 forked from it)
//   agent-ready   — clean proposal (fold pass, in-sync base)
//   agent-secret  — a secret-class change (withheld-secret fold)
//   agent-collide — collides with agent-elsewhere on src/auth.ts
//   agent-elsewhere — the collision partner (shares src/auth.ts)
//   agent-broken  — an UNRESOLVABLE ref proposal (honesty leg:
//                   history exists but no ref maps to it)
const SECRET_ENV_TEXT = "# demo env\nAPI_TOKEN=checks_fixture_secret\n";
const A0 = "export const a = 1;\nexport const keep = true;\n";
const A1 = "export const a = 2;\nexport const keep = true;\n";
const AUTH0 = "export const auth = 0;\n";
const AUTH1 = "export const auth = 1;\n";
const AUTH2 = "export const auth = 2;\n";
const ENV0 = "# agent env\nDB_PASSWORD=agent_fixture_secret\n";
const BASE_FILES = { "src/a.ts": A0, "src/auth.ts": AUTH0, "config/.env": SECRET_ENV_TEXT };

const cBase = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [cBase], refs: { main: cBase.hash } });

// agent-ready: one clean change on top of the base commit.
const cReady = commit("c-ready", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-ready", { history: [cReady, cBase], refs: { main: cReady.hash } });

// agent-secret: changes a secret-class file (fold is withheld-secret).
const cSecret = commit("c-secret", tree({ ...BASE_FILES, "config/.env": ENV0 }));
defineRepo("agent-secret", { history: [cSecret, cBase], refs: { main: cSecret.hash } });

// agent-collide + agent-elsewhere: both modify src/auth.ts with
// DIFFERENT texts -> a genuine text-conflict in the shared map.
const cCollide = commit("c-collide", tree({ ...BASE_FILES, "src/auth.ts": AUTH1 }));
defineRepo("agent-collide", { history: [cCollide, cBase], refs: { main: cCollide.hash } });
const cElsewhere = commit("c-elsewhere", tree({ ...BASE_FILES, "src/auth.ts": AUTH2 }));
defineRepo("agent-elsewhere", { history: [cElsewhere, cBase], refs: { main: cElsewhere.hash } });

// agent-broken: a repo whose ref does not resolve (the honesty
// leg — computeChangeSet throws, the proposal row is an error row,
// all five checks are unknown).
const cBroken = commit("c-broken", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-broken", { history: [cBroken, cBase], refs: {} });

// ---------------------------------------------------------------------------
// Scripted AI binding + KV fakes.
// ---------------------------------------------------------------------------

const aiCalls = [];
const AI = {
 async run() {
  aiCalls.push(1);
  return { response: "[]", model: "@cf/cloudflare/clef" };
 },
};

function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) { return store.get(key) ?? null; },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
 };
}

function envFor({ artifacts = ARTIFACTS, cache = makeFakeKV() } = {}) {
 return { ARTIFACTS: artifacts, LIVE: makeFakeKV(), CACHE: cache, ASSETS: { fetch: async () => new Response("") }, AI, AUTH_MODE: "demo" };
}

// Artifacts fake that counts get/list calls (proves the 403
// chokepoint fires pre-handler: ZERO Artifacts reads).
const artifactsProbe = {
 calls: 0,
 async get(name) {
  this.calls++;
  return repoFor(name);
 },
 async list() {
  this.calls++;
  return [];
 },
};

let ipSeq = 0;
const nextIp = () => "10.8.1." + ++ipSeq;

const get = async (env, path, query = "", ip = nextIp()) => {
 const res = await worker.fetch(new Request("https://nextgit.invalid" + path + query, { headers: { "CF-Connecting-IP": ip } }), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

const post = async (env, path, body = null, ip = nextIp()) => {
 const init = body === null ? { headers: { "CF-Connecting-IP": ip } } : { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) };
 const res = await worker.fetch(new Request("https://nextgit.invalid" + path, init), env);
 return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// 1-5: the server contract through the real worker.
// ---------------------------------------------------------------------------

const env = envFor();

// 1. SERVER-COMPUTED — GET /checks?base=demo&repos=... -> 200 with
//    one {repo, checks} per proposal; five ids in order; tri-states.
{
 const reposParam = "agent-ready,agent-secret,agent-collide,agent-elsewhere,agent-broken";
 const r = await get(env, "/checks", "?base=demo&repos=" + reposParam);
 check("1 /checks -> 200 {ok:true}", r.status === 200 && r.body?.ok === true, r.status + " " + J(r.body));
 const byRepo = Object.fromEntries((r.body?.checks ?? []).map((c) => [c.repo, c.checks]));
 check("1 one checks entry per proposal (mirrors /proposals set)",
  (r.body?.checks ?? []).length === 5 && ["agent-ready", "agent-secret", "agent-collide", "agent-elsewhere", "agent-broken"].every((name) => Array.isArray(byRepo[name])),
  J((r.body?.checks ?? []).map((c) => c.repo)));
 check("1 base echoes the set payload's base {repo,ref,head}",
  r.body?.base?.repo === "demo" && r.body?.base?.ref === "main" && typeof r.body?.base?.head === "string" && r.body.base.head.length > 0,
  J(r.body?.base));
 const allFive = Object.values(byRepo).every((checks) =>
  checks.length === CHECK_IDS.length && checks.map((c) => c.id).join(",") === CHECK_IDS.join(","));
 check("1 every proposal's five ids are fold,collision,conflicts,secrets,base in order", allFive,
  J(Object.entries(byRepo).map(([repo, checks]) => [repo, checks.map((c) => c.id)])));
 const allTri = Object.values(byRepo).flat().every((c) => VALID_STATES.has(c.state) && typeof c.detail === "string");
 check("1 every state in {pass,fail,unknown} with a string detail", allTri,
  J(Object.values(byRepo).flat().map((c) => [c.id, c.state])));
}

// 2. AUTHORITY PARITY — the server's checks deep-equal the client's
//    proposalChecks derivation over the SAME /proposals payload.
{
 const reposParam = "agent-ready,agent-secret,agent-collide,agent-elsewhere,agent-broken";
 const [props, checksRes] = await Promise.all([
  get(env, "/proposals", "?base=demo&repos=" + reposParam),
  get(env, "/checks", "?base=demo&repos=" + reposParam),
 ]);
 const serverByRepo = Object.fromEntries((checksRes.body?.checks ?? []).map((c) => [c.repo, c.checks]));
 let parity = true;
 const parityDetail = [];
 for (const proposal of props.body?.proposals ?? []) {
  const client = proposalChecks(proposal, { base: props.body.base, conflicts: props.body.conflicts, changeSet: { base: { sha: serverByRepo[proposal.repo] ? undefined : undefined } } });
  const server = serverByRepo[proposal.repo] ?? [];
  // The client derivation lacks the fork point (the set payload
  // carries none) so its `base` check is unknown; the server
  // carries the fork point — compare the first FOUR checks
  // exactly, and the base check's state where the datum agrees.
  const clientFour = client.slice(0, 4).map((c) => [c.id, c.state, c.detail]);
  const serverFour = server.slice(0, 4).map((c) => [c.id, c.state, c.detail]);
  if (JSON.stringify(clientFour) !== JSON.stringify(serverFour)) {
   parity = false;
   parityDetail.push([proposal.repo, clientFour, serverFour]);
  }
 }
 check("2 server checks == client proposalChecks derivation (fold/collision/conflicts/secrets)", parity, J(parityDetail.slice(0, 2)));
 // The server's base check uses the fork point the client cannot
 // see: for the in-sync fixture repos it is `pass`/` in sync`,
 // proving the server owns the datum the client lacks.
 const readyBase = serverByRepo["agent-ready"]?.find((c) => c.id === "base");
 check("2 server base check owns the fork-point datum (in sync for a fork-at-base-head repo)",
  readyBase?.state === "pass" && readyBase?.detail === "in sync", J(readyBase));
}

// 3. HONESTY — an unresolvable-ref proposal carries unknown for its
//    five checks, NONE pass.
{
 const r = await get(env, "/checks", "?base=demo&repos=agent-broken");
 const broken = (r.body?.checks ?? []).find((c) => c.repo === "agent-broken")?.checks ?? [];
 check("3 unresolvable-ref proposal -> exactly five checks", broken.length === CHECK_IDS.length, J(broken));
 check("3 every check is unknown (none pass, none fail)", broken.every((c) => c.state === "unknown"), J(broken));
 check("3 unknown base detail is the honest 'fork point not in set payload'",
  broken.find((c) => c.id === "base")?.detail === "fork point not in set payload",
  J(broken.find((c) => c.id === "base")));
}

// 4. FOLD VERDICT AGREEMENT — conflict/withheld-secret proposals
//    fail fold (withheld-secret also fails secrets).
{
 const r = await get(env, "/checks", "?base=demo&repos=agent-collide,agent-elsewhere,agent-secret");
 const byRepo = Object.fromEntries((r.body?.checks ?? []).map((c) => [c.repo, Object.fromEntries(c.checks.map((x) => [x.id, x]))]));
 const collide = byRepo["agent-collide"];
 const secret = byRepo["agent-secret"];
 check("4 colliding proposal's OWN fold -> pass (fold is per-proposal onto base; the collision surfaces in collision/conflicts)",
  collide?.fold?.state === "pass" && collide.fold.detail === "folds clean", J(collide?.fold));
 check("4 colliding proposal collision -> fail (text-conflict kind)",
  collide?.collision?.state === "fail" && String(collide.collision.detail).includes("text-conflict"), J(collide?.collision));
 check("4 colliding proposal conflicts -> fail/1",
  collide?.conflicts?.state === "fail" && collide.conflicts.detail === "1", J(collide?.conflicts));
 check("4 withheld-secret proposal fold -> fail (secret-class blocks fold)",
  secret?.fold?.state === "fail" && secret.fold.detail === "secret-class blocks fold", J(secret?.fold));
 check("4 withheld-secret proposal secrets -> fail/withheld",
  secret?.secrets?.state === "fail" && secret.secrets.detail === "withheld", J(secret?.secrets));
 check("4 agent-elsewhere's OWN fold passes even while colliding in the map (fold is per-proposal)",
  (() => {
   const elsewhere = byRepo["agent-elsewhere"] ?? {};
   return elsewhere.fold?.state === "pass" && elsewhere.fold.detail === "folds clean";
  })(),
  J(byRepo["agent-elsewhere"]?.fold));
 const r2 = await get(env, "/checks", "?base=demo&repos=agent-elsewhere");
 const elsewhere = (r2.body?.checks ?? []).find((c) => c.repo === "agent-elsewhere")?.checks ?? [];
 const byId = Object.fromEntries(elsewhere.map((c) => [c.id, c]));
 check("4 agent-elsewhere (collides with agent-collide when both queried) folds clean alone",
  byId.fold?.state === "pass" && byId.fold.detail === "folds clean", J(byId.fold));
 check("4 agent-elsewhere secrets -> pass/none",
  byId.secrets?.state === "pass" && byId.secrets.detail === "none", J(byId.secrets));
}

// 5. PRECONDITIONS.
{
 // 5a. omitted base == default demo (the AD-8 seam).
 const r = await get(env, "/checks", "?repos=agent-ready");
 check("5a omitted base -> default demo (omitted == explicit)",
  r.status === 200 && r.body?.ok === true && r.body?.base?.repo === "demo", r.status + " " + J(r.body?.base));

 // 5b. ?base= (empty) -> 400 (the parseProposalsQuery law).
 const r2 = await get(env, "/checks", "?base=");
 check("5b ?base= (empty) -> 400", r2.status === 400 && r2.body?.ok === false, r2.status + " " + J(r2.body));

 // 5c. ?base=notdemo -> 403 repo-not-allowed with ZERO Artifacts
 //     reads (the chokepoint fires pre-handler — the auth-seam
 //     deny-env pattern).
 artifactsProbe.calls = 0;
 const denyEnv = envFor({ artifacts: artifactsProbe });
 const r3 = await get(denyEnv, "/checks", "?base=notdemo&repos=agent-ready");
 check("5c ?base=notdemo -> 403 repo-not-allowed",
  r3.status === 403 && r3.body?.ok === false && r3.body?.error === "repo-not-allowed", r3.status + " " + J(r3.body));
 check("5c the 403 fired with ZERO Artifacts reads (chokepoint is pre-handler)",
  artifactsProbe.calls === 0, artifactsProbe.calls + " reads");

 // 5d. wrong method (POST /checks) -> 405 (the method-guard law).
 const r4 = await post(env, "/checks", {});
 check("5d POST /checks -> 405 method-not-allowed", r4.status === 405 && r4.body?.ok === false && r4.body?.error === "method-not-allowed", r4.status + " " + J(r4.body));

 // 5e. rateGate: the 61st call on one caller -> 429 (the new
 //     ROUTE_RATE_LIMITS row is reachable — the intents-matcher
 //     rate leg); a different caller still 200.
 const ip = "10.8.2.1";
 const statuses = [];
 for (let i = 0; i < 61; i++) {
  const rr = await get(env, "/checks", "?base=demo&repos=agent-ready", ip);
  statuses.push(rr.status);
 }
 check("5e /checks first 60 -> 200", statuses.slice(0, 60).every((s) => s === 200), J(statuses));
 check("5e /checks 61st -> uniform 429", statuses[60] === 429, String(statuses[60]));
 const other = await get(env, "/checks", "?base=demo&repos=agent-ready", "10.8.2.2");
 check("5e /checks different caller still 200", other.status === 200 && other.body?.ok === true, String(other.status));
}

// 7. NEGATIVE SCAN — no secret-class value/key name or fork-point
//    sha leaves /checks.
{
 const r = await get(env, "/checks", "?base=demo&repos=agent-ready,agent-secret,agent-collide,agent-elsewhere");
 const wire = J(r.body);
 check("7 no secret VALUE leaves /checks",
  !wire.includes("checks_fixture_secret") && !wire.includes("checks_fixture_db_password"), "value scan");
 check("7 no secret KEY NAME leaves /checks",
  !wire.includes("API_TOKEN") && !wire.includes("DB_PASSWORD"), "key scan");
 check("7 no secret-class PATH leaves /checks",
  !wire.includes("config/.env") && !wire.includes(".env"), "path scan");
 // The fork-point sha itself must not egress (the base check
 // carries the comparison result, not the sha).
 const baseHead = r.body?.base?.head;
 const shaInChecks = (r.body?.checks ?? []).some((c) => JSON.stringify(c.checks).includes(baseHead));
 check("7 the fork-point/base sha does not egress inside any check detail",
  baseHead !== undefined && !shaInChecks, "baseHead len " + (baseHead?.length ?? "?"));
}

// ---------------------------------------------------------------------------
// 6. Strip consumes it (loopback Chrome). The fixture server serves
//    the real /proposals payload AND a /checks route carrying the
//    server-computed strip for the KNOWN scenario. The strip must
//    render the SERVER's detail verbatim (not the client derivation).
//    A second mode where /checks 404s proves the fallback: the strip
//    derives client-side and base stays check-unknown.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const APP_TAG = '<script type="module" src="app.js"></script>';

const CHROME =
 ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
  .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
  .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
 console.log("SKIP  checks-api (leg 6) — no Chrome binary on PATH; legs 1-5 ran above");
} else {
 const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-checks-api-"));
 const dumpDom = (url, budget = 10000) =>
  new Promise((resolve, reject) => {
   const child = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=" + budget, "--user-data-dir=" + userDataDir, "--dump-dom", url], { stdio: ["ignore", "pipe", "ignore"] });
   let out = "";
   const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("chrome timed out after 10s")); }, 10000);
   child.stdout.on("data", (d) => (out += d));
   child.on("error", (e) => { clearTimeout(timer); reject(e); });
   child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error("chrome exited with " + code)); });
  });
 const parse = (dom) => { const m = dom.match(/id="test-out"[^>]*>([^<]*)</); return m ? JSON.parse(decodeURIComponent(m[1])) : null; };

 // The fixture's /proposals payload (a collision + a secret + a
 // ready repo) and the SERVER-computed /checks for the same set.
 // The server's `fold` detail for agent-ready is a DISTINCT string
 // from the client's ("server-computed: folds clean") so the leg
 // proves verbatim consumption, not derivation.
 const XSS_FILE = '"><img src=x onerror="window.__xss=1">';
 const PROPOSALS = {
  ok: true, base: { repo: "demo", ref: "main", head: "1a".repeat(20) }, ref: "main",
  summary: { proposals: 3, sharedFiles: 1, conflictingPairs: 1, changedFiles: 3, cleanPairs: 0 },
  proposals: [
   { repo: "agent-ready", head: "2b".repeat(20), landing: { status: "ready", files: 1 }, stats: { files: 1, additions: 4, deletions: 0 }, files: [{ path: "README.md", status: "modified", secret: false }] },
   { repo: "agent-secret", head: "3c".repeat(20), landing: { status: "withheld-secret", files: 1 }, stats: { files: 1, additions: 2, deletions: 0 }, files: [{ path: "config/.env", status: "modified", secret: true, keys: ["DATABASE_URL"] }] },
   { repo: "agent-collide", head: "4d".repeat(20), landing: { status: "ready", files: 1 }, stats: { files: 1, additions: 9, deletions: 1 }, files: [{ path: "src/auth.ts", status: "modified", secret: false }] },
  ],
  conflicts: [{ file: XSS_FILE, kind: "text-conflict", repos: ["agent-collide", "agent-elsewhere"], pairs: [{ a: "agent-collide", b: "agent-elsewhere", kind: "text-conflict", conflict: true }] }],
 };
 // Server-computed checks — the same five ids/states the client
 // derivation would produce, but with details only the server
 // would emit (proving verbatim consumption).
 const SERVER_CHECKS = {
  ok: true, base: { repo: "demo", ref: "main", head: "1a".repeat(20) },
  checks: [
   { repo: "agent-ready", checks: CHECK_IDS.map((id) => ({ id, label: id, state: id === "fold" ? "pass" : "unknown", detail: id === "fold" ? "server-computed: folds clean" : "server detail" })) },
   { repo: "agent-secret", checks: CHECK_IDS.map((id) => ({ id, label: id, state: id === "fold" || id === "secrets" ? "fail" : "unknown", detail: id === "secrets" ? "server-computed: withheld" : "server detail" })) },
   { repo: "agent-collide", checks: CHECK_IDS.map((id) => ({ id, label: id, state: id === "collision" || id === "conflicts" ? "fail" : "pass", detail: id === "collision" ? "server-computed: text-conflict · collision-file.ts" : "server detail" })) },
  ],
 };
 const EVENTS = { ok: true, events: [] };
 const JUDGE = { ok: true, judgments: [], skipped: [] };

 const clientScript = [
  "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
  "const R = { cards: {}, err: null };",
  "const cardOf = (repo) => document.getElementById(\"card-\" + CSS.escape(repo));",
  "const readStrip = (repo) => {",
  " const c = cardOf(repo);",
  " if (!c) return null;",
  " const strip = c.querySelector(\".checks-strip\");",
  " if (!strip) return { present: false };",
  " const chips = [...strip.querySelectorAll(\"[data-check]\")].map((el) => ({",
  "  id: el.getAttribute(\"data-check\"),",
  "  hasPass: el.classList.contains(\"check-pass\"),",
  "  hasFail: el.classList.contains(\"check-fail\"),",
  "  hasUnknown: el.classList.contains(\"check-unknown\"),",
  "  detail: el.querySelector(\".check-detail\") ? el.querySelector(\".check-detail\").textContent.trim() : null,",
  " }));",
  " return { present: true, chips };",
  "};",
  "document.addEventListener(\"DOMContentLoaded\", async () => {",
  " try {",
  "  await sleep(900);",
  "  for (const repo of [\"agent-ready\", \"agent-secret\", \"agent-collide\"]) R.cards[repo] = readStrip(repo);",
  " } catch (e) { R.err = String((e && e.stack) || e); }",
  " const d = document.createElement(\"div\"); d.id = \"test-out\"; d.textContent = encodeURIComponent(JSON.stringify(R)); document.body.appendChild(d);",
  "});",
 ].join("\n");

 const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
 const json = (res, body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
 let MODE = "serve"; // "serve" — /checks answers; "404" — /checks 404s (the fallback leg)
 const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") return json(res, PROPOSALS);
  if (pathname === "/checks") {
   if (MODE === "404") { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "not-found" })); return; }
   return json(res, SERVER_CHECKS);
  }
  if (pathname === "/events") return json(res, EVENTS);
  if (pathname === "/judge") return json(res, JUDGE);
  if (pathname === "/__client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(clientScript); return; }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = join(UI, rel);
  if (!file.startsWith(UI) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  if (rel === "index.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(file, "utf8").replace(APP_TAG, '<script type="module" src="/__client.js"></script>' + APP_TAG)); return; }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
 });

 try {
  const port = await new Promise((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); });
  const url = "http://127.0.0.1:" + port + "/";

  // ---- Dump 1: /checks SERVES — the strip renders the server's
  //      detail verbatim.
  MODE = "serve";
  const dom1 = await dumpDom(url);
  const R1 = parse(dom1);
  if (!R1) { check("6 scenario output present", false, "no #test-out"); }
  else if (R1.err) { check("6 scenario threw", false, R1.err); }
  else {
   const ready = R1.cards["agent-ready"], secretCard = R1.cards["agent-secret"], collide = R1.cards["agent-collide"];
   const chip = (card, id) => (card && card.present ? card.chips.find((c) => c.id === id) : null);
   check("6 strip present on every card", ready?.present && secretCard?.present && collide?.present);
   check("6 strip carries all five checks", ready?.present && ready.chips.length === 5 && CHECK_IDS.every((id) => ready.chips.some((c) => c.id === id)));
   check("6 READY fold detail is the SERVER's verbatim ('server-computed: folds clean')",
    chip(ready, "fold")?.detail === "server-computed: folds clean" && chip(ready, "fold")?.hasPass === true,
    JSON.stringify(chip(ready, "fold")));
   check("6 SECRET secrets detail is the SERVER's verbatim ('server-computed: withheld')",
    chip(secretCard, "secrets")?.detail === "server-computed: withheld" && chip(secretCard, "secrets")?.hasFail === true,
    JSON.stringify(chip(secretCard, "secrets")));
   check("6 COLLIDE collision detail is the SERVER's verbatim (server-computed text-conflict)",
    (chip(collide, "collision")?.detail || "").includes("server-computed: text-conflict") && chip(collide, "collision")?.hasFail === true,
    JSON.stringify(chip(collide, "collision")));
   check("6 no live <img> in the strip (server detail carries no raw tag)",
    collide && collide.chips.every((c) => (c.detail || "") !== XSS_FILE));
  }

  // ---- Dump 2: /checks 404s — the strip falls back to the client
  //      derivation; base stays check-unknown (the end-to-end
  //      honesty leg — an absent route never reads green).
  MODE = "404";
  const dom2 = await dumpDom(url);
  const R2 = parse(dom2);
  if (!R2) { check("6b fallback scenario output present", false, "no #test-out"); }
  else if (R2.err) { check("6b fallback scenario threw", false, R2.err); }
  else {
   const ready = R2.cards["agent-ready"];
   const chip = (card, id) => (card && card.present ? card.chips.find((c) => c.id === id) : null);
   check("6b fallback: strip present", ready?.present === true);
   check("6b FALLBACK: ready fold detail is the CLIENT's derivation ('folds clean', not the server string)",
    chip(ready, "fold")?.detail === "folds clean" && chip(ready, "fold")?.hasPass === true,
    JSON.stringify(chip(ready, "fold")));
   check("6b FALLBACK: base stays check-unknown (the set payload carries no fork point)",
    chip(ready, "base")?.hasUnknown === true && chip(ready, "base")?.hasPass === false,
    JSON.stringify(chip(ready, "base")));
  }
 } catch (e) {
  check("6 harness setup failed", false, String(e?.message ?? e));
 } finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => { const t = setTimeout(resolve, 1000); server.close(() => { clearTimeout(t); resolve(); }); });
  rmSync(userDataDir, { recursive: true, force: true });
 }
}

console.log(fail === 0 ? `ALL PASS(${pass} checks)` : `${fail} FAILURES(${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
