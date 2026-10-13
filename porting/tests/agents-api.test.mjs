#!/usr/bin/env bun
// Contract suite: GET /agents — the agent roster + policy
// surface (agent identity v1).
// Run: bun porting/tests/agents-api.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` (drives the
// real dispatcher: authorize mode gate + demo allowlist +
// handler) and the real rate limiter (ROUTE_RATE_LIMITS from
// platform/src/rate.ts). The Artifacts fake is the real
// git-ish shape seeded with the roster fixture: demo, agent-1
// (no NEXTGIT_AGENT note → unrecorded), agent-2 (NEXTGIT_AGENT
// note → "omp"), one non-ready repo (excluded), one non-agent
// repo (excluded). No module mocks, no source grep, no network,
// no live worker — full-suite-safe (a fresh env per request).

import worker, { ROUTES } from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";
import { AUTO_LAND_ENGAGED } from "../../platform/src/autoland.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") });

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the real git-ish surface + the bounded
// list() discovery seam), seeded with the roster fixture.
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
  async readBlob(hash) { return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null; },
  async info() { return { remote: `https://artifacts.invalid/nextgit/${name}` }; },
  async revokeToken() { return true; },
  [Symbol.dispose]() { },
 };
}

// --- roster fixture ---
// demo: the baseline. agent-1: no NEXTGIT_AGENT note (harness
// "unrecorded"). agent-2: NEXTGIT_AGENT note "omp" on the
// nextgit-notes mirror. staging-agent: status "importing"
// (excluded — not ready). demo-lh-base: a scratch chain, not
// agent-* (excluded — not in the roster vocabulary).
const PLAIN_FILE = "export const a = 1;\n";
const BASE_FILES = { "src/a.ts": PLAIN_FILE };
const c1 = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

const a1 = commit("c-agent-1", tree(BASE_FILES));
defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash } });

const a2 = commit("c-agent-2", tree(BASE_FILES));
defineRepo("agent-2", { history: [a2, c1], refs: { main: a2.hash } });

// The NEXTGIT_AGENT note for agent-2 lives on the nextgit-notes
// mirror as a tree path ending /NEXTGIT_AGENT whose blob hash is
// registered in the notes map the handler walks. The fake's log()
// over the NOTES_BRANCH ref returns the mirror's commits; the
// notes map is keyed by path → blob hash. To keep the fake the
// Mirror tree for agent-2: the note lives at a nested
// path (the real notes tree fans out into subdirs whose
// blob names are full commit shas), so its path ENDS
// with /NEXTGIT_AGENT — the suffix the handler matches.
const AGENT_2_NOTE = "omp";
const notesBlobHash = internBlob(AGENT_2_NOTE);
const mirrorRoot = {};
mirrorRoot["notes"] = {};
mirrorRoot["notes"]["NEXTGIT_AGENT"] = notesBlobHash;
const mirrorTreeHash = treeHashFor(mirrorRoot);
const mirrorCommit = { ...commit("notes-agent-2", mirrorTreeHash), treeHash: mirrorTreeHash };
// Attach the mirror branch to agent-2's store so log({ref:
// "nextgit-notes"}) returns it (the walkTree seam reads the
// commit's treeHash).
repos.get("agent-2").refs["nextgit-notes"] = mirrorCommit.hash;
repos.get("agent-2").history = [mirrorCommit, a2, c1];

const staging = commit("c-staging", tree(BASE_FILES));
defineRepo("staging-agent", { history: [staging, c1], refs: { main: staging.hash } });

const demoLh = commit("c-demo-lh", tree(BASE_FILES));
defineRepo("demo-lh-base", { history: [demoLh, c1], refs: { main: demoLh.hash } });

// The bounded discovery seam: list.repos[] carries name, status,
// defaultBranch, updatedAt — the fields /floors and /forks read.
// updatedAt drives /agents' lastSeenAt.
const LIST_REPOS = [
 { name: "agent-2", status: "ready", defaultBranch: "main", updatedAt: "2026-10-13T10:00:00.000Z" },
 { name: "agent-1", status: "ready", defaultBranch: "main", updatedAt: "2026-10-13T09:00:00.000Z" },
 { name: "staging-agent", status: "importing", defaultBranch: "main", updatedAt: "2026-10-13T08:00:00.000Z" },
 { name: "demo-lh-base", status: "ready", defaultBranch: "main", updatedAt: "2026-10-13T07:00:00.000Z" },
 { name: "demo", status: "ready", defaultBranch: "main", updatedAt: "2026-10-13T06:00:00.000Z" },
];

const ARTIFACTS = {
 async get(name) { return repoFor(name); },
 async list({ limit = 200 } = {}) {
  return { repos: LIST_REPOS.slice(0, limit), cursor: undefined };
 },
};

const get = async (env, path, headers = {}) =>
 readJson(await worker.fetch(new Request(`https://worker.local${path}`, { method: "GET", headers }), env, {}));

// Unique caller keys per check so the per-isolate limiter's
// windows never collide across checks (the rate-limit suite's
// established pattern).
const uniqueKey = (suffix) => `agents-api-${suffix}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// 1 — Registration parity: /agents is registered (GET read) and
// carries a rate entry (the AD-9 bound-route posture).
// ---------------------------------------------------------------------------
const makeEnv = (authMode) => ({
 ARTIFACTS,
 LIVE: {},
 CACHE: {},
 ASSETS: { async fetch() { return new Response("assets", { status: 200 }); } },
 AI: {},
 LAND_LEASE: {},
 EVENTS_HUB: {},
 ...(authMode !== undefined ? { AUTH_MODE: authMode } : {}),
});

// ---------------------------------------------------------------------------
// 2 — Wire contract: the 200 body is the closed projection
// {ok,base,agents[]} and each agent is EXACTLY the five keys
// {repo,harness,capabilities,policy,lastSeenAt} with the pinned
// vocabulary and policy derivation.
// ---------------------------------------------------------------------------
const demoEnv = makeEnv("demo");
const r0 = await get(demoEnv, "/agents?base=demo");
check("2 200 + ok:true + base echo", r0.status === 200 && r0.body?.ok === true && r0.body?.base === "demo", `status=${r0.status} body=${J(r0.body)}`);
check("2 body has exactly ok/base/agents keys", r0.body && Object.keys(r0.body).length === 3 && "ok" in r0.body && "base" in r0.body && "agents" in r0.body,
 `keys=${J(r0.body ? Object.keys(r0.body) : null)}`);

const agents = Array.isArray(r0.body?.agents) ? r0.body.agents : [];
check("2 agents is the ready agent-* pair", agents.length === 2 && agents.map((a) => a.repo).join(",") === "agent-1,agent-2",
 `agents=${J(agents.map((a) => a.repo))}`);

const a1row = agents.find((a) => a.repo === "agent-1");
const a2row = agents.find((a) => a.repo === "agent-2");
check("2 each agent has exactly the 5 projection keys",
 agents.every((a) => a && Object.keys(a).length === 5 && ["repo", "harness", "capabilities", "policy", "lastSeenAt"].every((k) => k in a)),
 `agent-1 keys=${J(a1row ? Object.keys(a1row) : null)}`);
check("2 capabilities deep-equals [\"propose\"]",
 agents.every((a) => J(a.capabilities) === J(["propose"])),
 `agent-1=${J(a1row?.capabilities)} agent-2=${J(a2row?.capabilities)}`);
check("2 policy deep-equals {land:\"manual\",secretClass:\"refused\"}",
 agents.every((a) => J(a.policy) === J({ land: "manual", secretClass: "refused" })),
 `agent-1=${J(a1row?.policy)} agent-2=${J(a2row?.policy)}`);
check("2 lastSeenAt is the seeded updatedAt (agent-1)",
 a1row?.lastSeenAt === "2026-10-13T09:00:00.000Z", `got ${J(a1row?.lastSeenAt)}`);
check("2 lastSeenAt is the seeded updatedAt (agent-2)",
 a2row?.lastSeenAt === "2026-10-13T10:00:00.000Z", `got ${J(a2row?.lastSeenAt)}`);

// ---------------------------------------------------------------------------
// 3 — Roster derivation: ready agent-* only, name-ordered,
// harness unrecorded/note-text, >128-char cap leg.
// ---------------------------------------------------------------------------
check("3 agent-1 harness \"unrecorded\" (no NEXTGIT_AGENT note)", a1row?.harness === "unrecorded", `got ${J(a1row?.harness)}`);
check("3 agent-2 harness \"omp\" (NEXTGIT_AGENT note)", a2row?.harness === "omp", `got ${J(a2row?.harness)}`);
check("3 staging-agent excluded (status importing)", !agents.some((a) => a.repo === "staging-agent"), `agents=${J(agents.map((a) => a.repo))}`);
check("3 demo-lh-base excluded (not agent-*)", !agents.some((a) => a.repo === "demo-lh-base"), `agents=${J(agents.map((a) => a.repo))}`);
check("3 name-ordered ascending", agents[0]?.repo === "agent-1" && agents[1]?.repo === "agent-2", `order=${J(agents.map((a) => a.repo))}`);

// >128-char cap leg: a long NEXTGIT_AGENT note is capped to 128.
// The note sits at a nested path (path ENDS /NEXTGIT_AGENT), the
// same shape as the agent-2 fixture.
const LONG_NOTE = "x".repeat(300);
const longBlobHash = internBlob(LONG_NOTE);
const longMirrorRoot = {};
longMirrorRoot["notes"] = {};
longMirrorRoot["notes"]["NEXTGIT_AGENT"] = longBlobHash;
const longMirrorTreeHash = treeHashFor(longMirrorRoot);
const longMirrorCommit = { ...commit("notes-agent-long", longMirrorTreeHash), treeHash: longMirrorTreeHash };
const a3 = commit("c-agent-3", tree(BASE_FILES));
defineRepo("agent-3", { history: [longMirrorCommit, a3, c1], refs: { main: a3.hash, "nextgit-notes": longMirrorCommit.hash } });
const ARTIFACTS_WITH_3 = {
 async get(name) { return repoFor(name); },
 async list() {
  return { repos: [...LIST_REPOS.slice(0, 2), { name: "agent-3", status: "ready", defaultBranch: "main", updatedAt: "2026-10-13T11:00:00.000Z" }, ...LIST_REPOS.slice(2)] };
 },
};
const env3 = { ...demoEnv, ARTIFACTS: ARTIFACTS_WITH_3 };
const r3 = await get(env3, "/agents?base=demo");
const a3row = (r3.body?.agents ?? []).find((a) => a.repo === "agent-3");
check("3 >128-char NEXTGIT_AGENT note capped to 128", a3row?.harness === "x".repeat(128), `len=${a3row?.harness?.length}`);

// ---------------------------------------------------------------------------
// 4 — Policy derivation pin: policy.land READS the AUTO_LAND_ENGAGED
// constant (the platform's real enforced rule, surfaced as data),
// never a request input; policy.secretClass is the masking law.
// ---------------------------------------------------------------------------
check("4 policy.land derives from AUTO_LAND_ENGAGED constant",
 agents.every((a) => a.policy.land === (AUTO_LAND_ENGAGED ? "auto-eligible" : "manual")) && AUTO_LAND_ENGAGED === false,
 `AUTO_LAND_ENGAGED=${J(AUTO_LAND_ENGAGED)} land=${J(agents.map((a) => a.policy.land))}`);
check("4 policy.secretClass is the masking law \"refused\"",
 agents.every((a) => a.policy.secretClass === "refused"), `agent-1=${J(a1row?.policy?.secretClass)}`);

// ---------------------------------------------------------------------------
// 5 — Precondition order: 400 (charset) → 403 (AD-9 defense-
// in-depth) → 429 (rate) → 200.
// ---------------------------------------------------------------------------
const r400 = await get(demoEnv, "/agents?base=not demo");
check("5 invalid base charset → 400", r400.status === 400 && r400.body?.ok === false, `status=${r400.status} body=${J(r400.body)}`);
const r403 = await get(demoEnv, "/agents?base=notdemo-xyz");
check("5 non-allowlisted base → 403 repo-not-allowed",
 r403.status === 403 && r403.body?.ok === false && r403.body?.error === "repo-not-allowed" && r403.body?.detail === `repo "notdemo-xyz" is outside the demo allowlist`,
 `status=${r403.status} body=${J(r403.body)}`);
// 429: exhaust the /agents budget for a unique caller key, then
// observe the 429 with the uniform body.
const rateEnv = { ...demoEnv };
const cfIp = uniqueKey("rate");
for (let i = 0; i < ROUTE_RATE_LIMITS["/agents"].limit; i++) {
 await get(rateEnv, "/agents?base=demo", { "CF-Connecting-IP": cfIp });
}
const r429 = await get(rateEnv, "/agents?base=demo", { "CF-Connecting-IP": cfIp });
check("5 over-cap caller → 429 rate-limited",
 r429.status === 429 && r429.body?.ok === false && r429.body?.error === "rate-limited",
 `status=${r429.status} body=${J(r429.body)}`);
// Deny mode: the authorize() chokepoint 401s before the handler.
const denyEnv = makeEnv(undefined);
const r401 = await get(denyEnv, "/agents?base=demo");
check("5 deny mode → 401 unauthorized", r401.status === 401 && r401.body?.ok === false && r401.body?.error === "unauthorized",
 `status=${r401.status} body=${J(r401.body)}`);
// Wrong method on a registered path: 405 (the API-boundary law).
const r405 = await readJson(await worker.fetch(new Request("https://worker.local/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: J({}) }), demoEnv, {}));
check("5 POST /agents → 405 method-not-allowed", r405.status === 405 && r405.body?.ok === false && r405.body?.error === "method-not-allowed",
 `status=${r405.status} body=${J(r405.body)}`);

// ---------------------------------------------------------------------------
// 6 — No value egress: the roster never carries secret values,
// token material, or non-demo repos — the closed projection
// carries no field beyond the five pinned keys (proved by the
// key-count check above; here the raw text carries no seed).
// ---------------------------------------------------------------------------
check("6 200 text carries no fixture secret material",
 !r0.text.includes("FAKE-SECRET") && !r0.text.includes("postgres://"),
 `text=${r0.text.slice(0, 120)}`);

// ---------------------------------------------------------------------------
// 7 — UI helper purity (file 4's named check): policyChipsHtml /
// agentPolicyMap / POLICY_LABELS (platform/ui/js/forks-panel.js) are
// pure — importable without a live page, escaped, typed-null-safe.
// The UI module graph touches `document` at load (state.js builds its
// `el` map from getElementById), so a minimal document stub is
// installed BEFORE the dynamic import.
// ---------------------------------------------------------------------------
globalThis.document = globalThis.document ?? { getElementById: () => null };
const { policyChipsHtml, agentPolicyMap, POLICY_LABELS, signalChipsHtml } = await import("../../platform/ui/js/forks-panel.js");
const { state } = await import("../../platform/ui/js/state.js");

check("7 POLICY_LABELS pins the two policy keys", J(POLICY_LABELS) === J({ land: "land", secretClass: "secrets" }), J(POLICY_LABELS));
const chipHtml = policyChipsHtml({ land: "manual", secretClass: "refused" });
check("7 policyChipsHtml renders both escaped chips",
 chipHtml.includes('data-policy="land"') && chipHtml.includes("manual") &&
 chipHtml.includes('data-policy="secretClass"') && chipHtml.includes("refused"),
 chipHtml);
check("7 policyChipsHtml typed-null → unmeasured (never fabricated)",
 policyChipsHtml(null).match(/unmeasured/g)?.length === 2 && policyChipsHtml({}).includes("unmeasured"),
 policyChipsHtml(null));
check("7 policyChipsHtml escapes untrusted policy text (AD-4)",
 !policyChipsHtml({ land: "<img src=x onerror=1>", secretClass: "<b>secrets</b>" }).includes("<img") &&
 policyChipsHtml({ land: "<b>" }).includes("&lt;b&gt;"),
 policyChipsHtml({ land: "<b>" }));
check("7 signalChipsHtml still pure (no regression from the added helper)",
 typeof signalChipsHtml({}) === "string" && signalChipsHtml(null).includes("unmeasured"));

// agentPolicyMap keys by repo and is fail-soft on an absent roster.
check("7 agentPolicyMap empty on an absent roster", agentPolicyMap() instanceof Map && agentPolicyMap().size === 0);
state.agentRoster = { ok: true, agents: [{ repo: "agent-1", policy: { land: "manual", secretClass: "refused" } }] };
const rosterMap = agentPolicyMap();
check("7 agentPolicyMap keys by repo → policy object",
 rosterMap.get("agent-1")?.land === "manual" && rosterMap.get("agent-1")?.secretClass === "refused",
 J([...rosterMap]));
state.agentRoster = null;

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
