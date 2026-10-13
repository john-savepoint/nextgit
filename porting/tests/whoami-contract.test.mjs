#!/usr/bin/env bun
// Contract suite: GET /whoami — the elevated-reveal capability probe,
// plus the pure secret-surface decision matrix (CAP-8 beat).
// Run: bun porting/tests/whoami-contract.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` (drives the real
// dispatcher: authorize mode gate + demo allowlist + handler) and the
// real pure helpers `decideSecretSurface` (platform/ui/reveal-decision.js)
// and `revealCapability` (platform/src/auth.ts). The Artifacts fake is
// the real git-ish shape seeded with agent-5/config/.env. No module
// mocks, no source grep, no Chrome, no network, no live worker —
// full-suite-safe (a fresh env per request).

import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker, { ROUTES } from "../../platform/src/index.ts";
import { revealCapability } from "../../platform/src/auth.ts";
import { decideSecretSurface } from "../../platform/ui/reveal-decision.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") });

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the real git-ish surface), seeded with
// agent-5/config/.env so /changes and /merge carry a secret-class row.
// ---------------------------------------------------------------------------
const blobText = new Map();
const blobHashByText = new Map();
const treeEntries = new Map();
const repos = new Map();

function internBlob(text) {
 if (blobHashByText.has(text)) return blobHashByText.get(text);
 const hash = `blob-${blobText.size}`;
 blobText.set(hash, text);
 blobHashByText.set(text, hash);
 return hash;
}
function entriesFor(node) {
 return Object.entries(node).map(([name, child]) => {
  if (typeof child === "string") return { name, mode: "100644", hash: child, type: "blob" };
  return { name, mode: "40000", hash: treeHashFor(child), type: "tree" };
 });
}
function treeHashFor(node) {
 const entries = entriesFor(node);
 const hash = `tree-${treeEntries.size + 1}`;
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
function defineRepo(name, { history, refs, intents = {} }) { repos.set(name, { history, refs, intents }); }
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
 if (!store) throw new Error(`fixture: no repo ${name}`);
 const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
 return {
  async log({ ref = "HEAD", limit = 50 } = {}) {
   const byBranch = store.refs[ref];
   if (byBranch) return store.history.slice(0, limit);
   const single = resolve(ref);
   return single ? [single].slice(0, limit) : [];
  },
  async readTree(hash) { return treeEntries.get(hash) ?? null; },
  async readFile({ ref, path }) {
   const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
   if (!head) return null;
   const blobHash = lookupPath(head.treeHash, path);
   return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
  },
  async readBlob(hash) { return blobText.has(hash) ? new Blob([blobText.get(blobHash)]) : null; },
  async info() { return { remote: `https://artifacts.invalid/nextgit/${name}` }; },
  async revokeToken() { return true; },
  [Symbol.dispose]() { },
 };
}

// --- fixture: agent-5/config/.env (the two ENV_LINES from secret-fixture.mjs) ---
const ENV_LINES = ["DATABASE_URL=postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app", "REDIS_URL=redis://cache.internal:6379"];
const ENV_CONTENT = `${ENV_LINES.join("\n")}\n`;
const FIXTURE_VALUE = "postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app";
const PLAIN_FILE = "export const a = 1;\n";
const DEMO_ENV = "DATABASE_URL=demo-only-value\nREDIS_URL=redis://cache.internal:6379\n";

const BASE_FILES = { "src/a.ts": PLAIN_FILE };
const c1 = commit("c-base", tree({ ...BASE_FILES, "config/.env": DEMO_ENV }));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
const a5 = commit("c-agent-5", tree({ ...BASE_FILES, "config/.env": ENV_CONTENT }));
defineRepo("agent-5", { history: [a5, c1], refs: { main: a5.hash } });

const ARTIFACTS = { async get(name) { return repoFor(name); } };

const makeEnv = ({ authMode, revealAllow } = {}) => ({
 ARTIFACTS,
 LIVE: {},
 CACHE: {},
 ASSETS: { async fetch() { return new Response("assets", { status: 200 }); } },
 AI: {},
 LAND_LEASE: {},
 EVENTS_HUB: {},
 ...(authMode !== undefined ? { AUTH_MODE: authMode } : {}),
 ...(revealAllow !== undefined ? { REVEAL_ALLOW: revealAllow } : {}),
});

const get = async (env, path, headers = {}) =>
 readJson(await worker.fetch(new Request(`https://worker.local${path}`, { method: "GET", headers }), env, {}));
const post = async (env, path, body, headers = {}) =>
 readJson(await worker.fetch(new Request(`https://worker.local${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: J(body) }), env, {}));

// ---------------------------------------------------------------------------
// 1 — Pure decision matrix (decideSecretSurface), every cell.
// ---------------------------------------------------------------------------
{
 const withheld = decideSecretSurface({ reveal: false });
 check("matrix: {reveal:false} → withheld, no control, no value, withheld notice",
  withheld.kind === "withheld" && withheld.showControl === false && withheld.renderValue === false && withheld.noticeHtml === "Secret content withheld" && withheld.valueHtml === null,
  J(withheld));

 const control = decideSecretSurface({ reveal: true });
 check("matrix: {reveal:true} → control, showControl, no value",
  control.kind === "control" && control.showControl === true && control.renderValue === false && control.valueHtml === null,
  J(control));

 const revealed = decideSecretSurface({ reveal: true, revealGranted: true });
 check("matrix: {reveal:true,revealGranted} → revealed, the ONLY renderValue:true cell, valueHtml null",
  revealed.kind === "revealed" && revealed.renderValue === true && revealed.showControl === false && revealed.valueHtml === null,
  J(revealed));

 const denied = decideSecretSurface({ reveal: true, revealDenied: true });
 check("matrix: {reveal:true,revealDenied} → denied, no value, denial copy, control kept",
  denied.kind === "denied" && denied.renderValue === false && denied.showControl === true && denied.noticeHtml === "Secret content withheld — reveal not authorized.",
  J(denied));

 const error = decideSecretSurface({ reveal: true, revealFailed: true });
 check("matrix: {reveal:true,revealFailed} → error, no value, error copy, control kept",
  error.kind === "error" && error.renderValue === false && error.showControl === true && error.noticeHtml === "Secret content withheld — reveal unavailable.",
  J(error));

 const defense = decideSecretSurface({ reveal: false, revealGranted: true });
 check("matrix: {reveal:false,revealGranted} → renderValue:false (grant to unauthorized viewer does not render — defense-in-depth)",
  defense.renderValue === false && defense.kind === "withheld" && defense.showControl === false,
  J(defense));

 const nonSecret = decideSecretSurface({ reveal: true, isSecret: false });
 check("matrix: {isSecret:false} → withheld, no control, no value, no notice (not a secret surface)",
  nonSecret.kind === "withheld" && nonSecret.showControl === false && nonSecret.renderValue === false && nonSecret.noticeHtml === null,
  J(nonSecret));

 // renderValue is true ONLY when the viewer is reveal-capable, the file
 // is secret-class, AND the reveal was granted — a single logical cell.
 // (The interaction flags are mutually exclusive in a real click stream;
 // the invariant that matters is renderValue ⟺ reveal && revealGranted && isSecret.)
 let renderValueTrueCount = 0;
 let renderValueTrueWithoutGrant = 0;
 for (const reveal of [false, true]) for (const revealGranted of [false, true]) for (const isSecret of [true, false]) {
  const d = decideSecretSurface({ reveal, revealGranted, isSecret });
  if (d.renderValue) renderValueTrueCount++;
  if (d.renderValue && !(reveal && revealGranted && isSecret)) renderValueTrueWithoutGrant++;
 }
 check("matrix: renderValue:true ⟺ (reveal && revealGranted && isSecret)",
  renderValueTrueCount === 1 && renderValueTrueWithoutGrant === 0,
  `count=${renderValueTrueCount} ungrounded=${renderValueTrueWithoutGrant}`);
}

// ---------------------------------------------------------------------------
// 2 — GET /whoami default: demo mode, no REVEAL_ALLOW/identity → 200
// {ok:true,authorized:false,reveal:false}.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo" });
 const r = await get(env, "/whoami?repo=agent-5");
 check("whoami default: 200 {ok:true,authorized:false,reveal:false}",
  r.status === 200 && r.body?.ok === true && r.body?.authorized === false && r.body?.reveal === false,
  `${r.status} ${J(r.body)}`);
}

// ---------------------------------------------------------------------------
// 3 — GET /whoami authorized: REVEAL_ALLOW lists "tok-a" for agent-5,
// Authorization: Bearer tok-a, ?repo=agent-5 → 200 {ok:true,authorized:true,reveal:true}.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: JSON.stringify([{ id: "tok-a", repos: ["agent-5"] }]) });
 const r = await get(env, "/whoami?repo=agent-5", { Authorization: "Bearer tok-a" });
 check("whoami authorized: 200 {ok:true,authorized:true,reveal:true}",
  r.status === 200 && r.body?.ok === true && r.body?.authorized === true && r.body?.reveal === true,
  `${r.status} ${J(r.body)}`);
}

// ---------------------------------------------------------------------------
// 4 — GET /whoami deny mode: AUTH_MODE absent → 401 {ok:false,error:"unauthorized"}.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({});
 const r = await get(env, "/whoami?repo=agent-5", { Authorization: "Bearer tok-a" });
 check("whoami deny mode: 401 {ok:false,error:\"unauthorized\"}",
  r.status === 401 && r.body?.ok === false && r.body?.error === "unauthorized",
  `${r.status} ${J(r.body)}`);
}

// ---------------------------------------------------------------------------
// 5 — GET /whoami wrong method: POST /whoami → 405 {ok:false,error:"method-not-allowed"}.
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo" });
 const r = await post(env, "/whoami", {});
 check("whoami wrong method: POST /whoami → 405 {ok:false,error:\"method-not-allowed\"}",
  r.status === 405 && r.body?.ok === false && r.body?.error === "method-not-allowed",
  `${r.status} ${J(r.body)}`);
}

// ---------------------------------------------------------------------------
// 6 — revealCapability purity (auth.ts): absent allowlist → both false;
// matching identity+repo → both true; identity present but repo outside
// its `repos` list → both false.
// ---------------------------------------------------------------------------
{
 const base = { AUTH_MODE: "demo" };
 const none = revealCapability(base, { identity: "tok-a", repo: "agent-5" });
 check("revealCapability: absent allowlist → {authorized:false,reveal:false}",
  none.authorized === false && none.reveal === false, J(none));

 const grant = revealCapability({ ...base, REVEAL_ALLOW: JSON.stringify([{ id: "tok-a", repos: ["agent-5"] }]) }, { identity: "tok-a", repo: "agent-5" });
 check("revealCapability: matching identity+repo → {authorized:true,reveal:true}",
  grant.authorized === true && grant.reveal === true, J(grant));

 const scoped = revealCapability({ ...base, REVEAL_ALLOW: JSON.stringify([{ id: "tok-a", repos: ["agent-9"] }]) }, { identity: "tok-a", repo: "agent-5" });
 check("revealCapability: identity present but repo outside its repos list → {authorized:false,reveal:false}",
  scoped.authorized === false && scoped.reveal === false, J(scoped));

 const blank = revealCapability({ ...base, REVEAL_ALLOW: JSON.stringify([{ id: "tok-a", repos: ["agent-5"] }]) }, { identity: "", repo: "agent-5" });
 check("revealCapability: blank identity → {authorized:false,reveal:false}",
  blank.authorized === false && blank.reveal === false, J(blank));
}

// ---------------------------------------------------------------------------
// 7 — No value from other routes: with the authorized env, GET /changes
// and GET /merge for the secret-class file (agent-5/config/.env) carry
// `keys[]` and NO `value` field anywhere (complements demo-verify 6).
// ---------------------------------------------------------------------------
{
 const env = makeEnv({ authMode: "demo", revealAllow: JSON.stringify([{ id: "tok-a", repos: ["agent-5"] }]) });
 const changes = await get(env, "/changes?repo=agent-5", { Authorization: "Bearer tok-a" });
 const changesText = J(changes.body);
 const envFile = (changes.body?.changeSet?.files || []).find((f) => f.path === "config/.env");
 check("no-value: /changes carries the secret-class file with keys[]",
  changes.status === 200 && !!envFile && Array.isArray(envFile.keys) && envFile.keys.length > 0,
  `${changes.status} ${J(envFile?.keys)}`);
 check("no-value: /changes body carries NO value field and NO fixture value",
  !changesText.includes(`"value"`) && !changesText.includes(FIXTURE_VALUE),
  `hasValueField=${changesText.includes(`"value"`)} hasFixture=${changesText.includes(FIXTURE_VALUE)}`);

 const merge = await get(env, "/merge?repos=agent-5", { Authorization: "Bearer tok-a" });
 const mergeText = J(merge.body);
 check("no-value: /merge body carries NO value field and NO fixture value",
  merge.status === 200 && !mergeText.includes(`"value"`) && !mergeText.includes(FIXTURE_VALUE),
  `${merge.status} hasValueField=${mergeText.includes(`"value"`)} hasFixture=${mergeText.includes(FIXTURE_VALUE)}`);

 // /proposals is the masked surface the merge modal sources keys from:
 // the secret row carries secret:true + keys[] and never a value.
 const proposals = await get(env, "/proposals?base=demo&repos=agent-5", { Authorization: "Bearer tok-a" });
 const proposalsText = J(proposals.body);
 const proposalEnv = (proposals.body?.proposals || []).flatMap((p) => p.files || []).find((f) => f.path === "config/.env");
 check("no-value: /proposals carries the secret-class file with secret:true + keys[]",
  proposals.status === 200 && !!proposalEnv && proposalEnv.secret === true && Array.isArray(proposalEnv.keys) && proposalEnv.keys.length > 0,
  `${proposals.status} ${J(proposalEnv)}`);
 check("no-value: /proposals body carries NO value field and NO fixture value",
  !proposalsText.includes(`"value"`) && !proposalsText.includes(FIXTURE_VALUE),
  `hasValueField=${proposalsText.includes(`"value"`)} hasFixture=${proposalsText.includes(FIXTURE_VALUE)}`);
}

// ---------------------------------------------------------------------------
// 8 — Registration parity: /whoami is registered (GET) and the UI
// consumes it (route-discipline parity precondition).
// ---------------------------------------------------------------------------
{
 check("registration: ROUTES registers GET /whoami",
  ROUTES.some((r) => r.path === "/whoami" && r.method === "GET" && r.action === "read"),
  J(ROUTES.filter((r) => r.path === "/whoami")));
 // Wave-13 module split: the /whoami fetch moved from app.js
 // into the ./js/* domain modules (loadRevealCapability in
 // js/proposals.js). Check the whole module graph — app.js plus
 // every ./js/*.js module — for the /whoami consumption.
 const uiDir = fileURLToPath(new URL("../../platform/ui/", import.meta.url));
 const jsDir = fileURLToPath(new URL("../../platform/ui/js/", import.meta.url));
 const graphFiles = ["app.js", ...readdirSync(jsDir).filter((f) => f.endsWith(".js")).map((f) => "js/" + f)];
 const graph = graphFiles.map((f) => readFileSync(uiDir + f, "utf8")).join("\n");
 check("registration: UI module graph consumes /whoami (fetchJson)",
  /fetch(?:Json)?\(\s*["'`]\/whoami["'`]/.test(graph));
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
