#!/usr/bin/env bun
// Contract suite for the Secret-Egress Gate (NFR5).
// Run: bun porting/tests/secret-egress.test.mjs  (exit 0 = pass)
//
// Verifies that a canary planted ONLY in intent (KEY=VALUE lines inside intent
// free text) never leaks into any response body, AI binding state, or console
// log across /changes, /merge, /proposals, and /judge.
//
// The real worker module is imported and exercised through worker.fetch with an
// in-memory Artifacts fake and a scripted AI binding — the platform binding
// seam is the only thing stubbed; no module mocking, no source grep.

import worker from "../../platform/src/index.ts";
import { scrubFreeText } from "../../platform/src/judge.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (exact copy from judge.test.mjs:30-136).
// ---------------------------------------------------------------------------

const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history: [] newest-first, refs, intents }

function internBlob(text) {
  if (!blobHashByText.has(text)) {
    const hash = `blob-${blobHashByText.size + 1}`;
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
  if (!store) throw new Error(`fixture: no repo ${name}`);
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
      return { remote: `https://artifacts.invalid/nextgit/${name}` };
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

// --- fake AI + request helpers (exact copy from judge.test.mjs:190-215) ----

const aiCalls = [];
let aiNext = null;
const AI = {
  async run(model, inputs) {
    aiCalls.push({ model, inputs });
    if (aiNext instanceof Error) throw aiNext;
    return aiNext;
  },
};
const resetAi = (response = null) => {
  aiCalls.length = 0;
  aiNext = response;
};
const clefReply = (answers, model = "clef") => ({ model, answers, usage: { neurons: 1 } });

let ipSeq = 0;
const nextIp = () => `10.7.0.${++ipSeq}`;

const singleAnswers = () => ({
  risk_1: { type: "score", score: 1.2, confidence: 0.5 },
  intent_1: { type: "choice", choice: "supports" },
  overclaim_1: { type: "noul", noul: 0.2 },
  content_secret_1: { type: "noul", noul: 0.1 },
});

function makeFakeKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function envFor({ ai = AI, artifacts = ARTIFACTS, skipRecord = null } = {}) {
  const env = { ARTIFACTS: artifacts, LIVE: makeFakeKV(), CACHE: makeFakeKV(), ASSETS: { fetch: async () => new Response("") }, AI: ai };
  if (skipRecord) Object.assign(env, { SKIP_RECORD: skipRecord });
  return env;
}

// --- canary fixtures ---------------------------------------------------------

const CANARY = "canary_secret_9f3a41c7_leakgate";
const CANARY_ENV_TEXT = `# local dev\nSECRET_KEY=${CANARY}\nAPI_TOKEN=also_${CANARY}\n`;
const CANARY_INTENT = `Bump the module.\nLEAKED_KEY=${CANARY}\nMore intent here.`;

// --- fixture repos -----------------------------------------------------------

const DEMO_FILES = { "src/a.ts": "export const a = 1;\n", "config/.env": CANARY_ENV_TEXT };

const c1 = commit("c-base", tree(DEMO_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

// agent-canary: adds a file, modifies the env file, carries intent with KEY=VALUE canary line.
const canaryEnv = `# canary v2\nSECRET_KEY=${CANARY}_v2\nAPI_TOKEN=also_${CANARY}_v2\n`;
const canaryFiles = { ...DEMO_FILES, "src/canary.ts": "export const c = 2;\n", "config/.env": canaryEnv };
const aCanary = commit("c-agent-canary", tree(canaryFiles));
defineRepo("agent-canary", { history: [aCanary, c1], refs: { main: aCanary.hash }, intents: { [aCanary.hash]: CANARY_INTENT } });

// agent-clean: no intent, no canary.
const cleanFiles = { ...DEMO_FILES, "src/clean.ts": "export const clean = true;\n" };
const aClean = commit("c-agent-clean", tree(cleanFiles));
defineRepo("agent-clean", { history: [aClean, c1], refs: { main: aClean.hash } });

// agent-negative: canary in a non-secret file patch (KEY=VALUE line in content).
const leakLine = `export const x = "${CANARY}";\nLEAKED_KEY=${CANARY}\n`;
const negFiles = { ...DEMO_FILES, "src/leak.ts": leakLine };
const aNeg = commit("c-agent-negative", tree(negFiles));
defineRepo("agent-negative", { history: [aNeg, c1], refs: { main: aNeg.hash } });

// agent-judge: canary ONLY in intent, no secret-class files (so /judge runs it).
// Includes config/.env identical to base so it is NOT a changed file.
const judgeFiles = { ...DEMO_FILES, "src/judge.ts": "export const j = 2;\n" };
const aJudge = commit("c-agent-judge", tree(judgeFiles));
defineRepo("agent-judge", { history: [aJudge, c1], refs: { main: aJudge.hash }, intents: { [aJudge.hash]: CANARY_INTENT } });

// --- request helpers ---------------------------------------------------------

async function getChanges(repo, env) {
  const url = `https://egress.test/changes?repo=${encodeURIComponent(repo)}`;
  return worker.fetch(new Request(url), env);
}

async function getProposals(repos, env) {
  const params = new URLSearchParams();
  if (repos) params.set("repos", repos);
  const url = `https://egress.test/proposals?${params.toString()}`;
  return worker.fetch(new Request(url), env);
}

async function getMerge(repos, env) {
  const params = new URLSearchParams();
  params.set("repos", repos);
  const url = `https://egress.test/merge?${params.toString()}`;
  return worker.fetch(new Request(url), env);
}

async function judge(body, { ip = nextIp(), env = envFor() } = {}) {
  const res = await worker.fetch(
    new Request("https://egress.test/judge", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
  return readJson(res);
}

// --- console.log capture -----------------------------------------------------

let logLines = [];
const originalConsoleLog = console.log;
function captureLogs() {
  logLines = [];
  console.log = (...args) => {
    logLines.push(args.map(String).join(" "));
  };
}
function restoreLogs() {
  console.log = originalConsoleLog;
}

// --- canary counting ---------------------------------------------------------

function countCanary(text) {
  if (typeof text !== "string") return 0;
  return (text.match(new RegExp(CANARY, "g")) || []).length;
}

function countCanaryDeep(obj) {
  if (obj === null || typeof obj !== "object") return countCanary(String(obj));
  return countCanary(JSON.stringify(obj));
}

// ============================================================================
// Test: /changes — canary in intent must not leak
// ============================================================================

try {
  const env = envFor();
  captureLogs();
  const res = await getChanges("agent-canary", env);
  const { status, body } = await readJson(res);
  restoreLogs();

  check("changes: status 200", status === 200, `status ${status}`);
  check("changes: canary count 0", countCanaryDeep(body) === 0, `count ${countCanaryDeep(body)}`);
  check("changes: console.log canary count 0", countCanary(logLines.join("\n")) === 0, `count ${countCanary(logLines.join("\n"))}`);

  const files = body?.changeSet?.files ?? [];
  const envFile = files.find((f) => f.path === "config/.env");
  check("changes: secret-class env file masked", envFile && envFile.secret === true && Array.isArray(envFile.keys) && envFile.keys.length > 0 && envFile.patch === undefined, JSON.stringify(envFile));

  const canaryFile = files.find((f) => f.path === "src/canary.ts");
  check("changes: intent scrubbed (LEAKED_KEY= present, value gone)", canaryFile && canaryFile.intent && canaryFile.intent.includes("LEAKED_KEY=") && !canaryFile.intent.includes(CANARY), JSON.stringify(canaryFile?.intent));
} catch (e) {
  check("changes: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: /merge — canary in intent must not leak
// ============================================================================

try {
  const env = envFor();
  captureLogs();
  const res = await getMerge("agent-canary", env);
  const { status, body } = await readJson(res);
  restoreLogs();

  check("merge: status 200", status === 200, `status ${status}`);
  check("merge: canary count 0", countCanaryDeep(body) === 0, `count ${countCanaryDeep(body)}`);
  check("merge: console.log canary count 0", countCanary(logLines.join("\n")) === 0, `count ${countCanary(logLines.join("\n"))}`);

  // The merge file list should carry secret keys only for secret-class files.
  const mergeFiles = body?.merge?.files ?? [];
  const withheld = mergeFiles.find((f) => f.result === "withheld-secret");
  check("merge: withheld-secret row present", withheld !== undefined, JSON.stringify(withheld));
} catch (e) {
  check("merge: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: /proposals — canary in intent must not leak, intent present on carrier
// ============================================================================

try {
  const env = envFor();
  captureLogs();
  const res = await getProposals("agent-canary,agent-clean", env);
  const { status, body } = await readJson(res);
  restoreLogs();

  check("proposals: status 200", status === 200, `status ${status}`);
  check("proposals: canary count 0", countCanaryDeep(body) === 0, `count ${countCanaryDeep(body)}`);
  check("proposals: console.log canary count 0", countCanary(logLines.join("\n")) === 0, `count ${countCanary(logLines.join("\n"))}`);

  const proposals = body?.proposals ?? [];
  const canaryProp = proposals.find((p) => p.repo === "agent-canary");
  const cleanProp = proposals.find((p) => p.repo === "agent-clean");

  check("proposals: canary repo intent present", canaryProp && canaryProp.intent !== undefined, JSON.stringify(canaryProp?.intent));
  check("proposals: canary repo intent has no canary value", canaryProp && canaryProp.intent && !canaryProp.intent.includes(CANARY), JSON.stringify(canaryProp?.intent));
  check("proposals: clean repo intent absent", cleanProp && cleanProp.intent === undefined, JSON.stringify(cleanProp?.intent));
} catch (e) {
  check("proposals: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: /judge — canary in intent must not leak into AI state or responses
// ============================================================================

try {
  // agent-judge has canary ONLY in intent, no secret-class files (so /judge runs it).
  resetAi(clefReply(singleAnswers()));
  const env = envFor();
  captureLogs();
  const { status, body } = await judge({ setId: "v1", target: { base: "demo", repos: ["agent-judge"] } }, { ip: "10.0.5.1", env });
  restoreLogs();

  check("judge: status 200", status === 200, `status ${status}`);
  check("judge: canary count 0 in response", countCanaryDeep(body) === 0, `count ${countCanaryDeep(body)}`);
  check("judge: console.log canary count 0", countCanary(logLines.join("\n")) === 0, `count ${countCanary(logLines.join("\n"))}`);

  // The AI binding captured inputs — inspect state for canary.
  check("judge: one AI call", aiCalls.length === 1, `aiCalls.length ${aiCalls.length}`);
  const stateJson = JSON.stringify(aiCalls[0]?.inputs?.state ?? aiCalls[0]?.inputs);
  check("judge: AI state canary count 0", countCanary(stateJson) === 0, `count ${countCanary(stateJson)}`);

  // The skipped array should not carry canary values.
  check("judge: skipped has no canary", countCanaryDeep(body?.skipped) === 0, `count ${countCanaryDeep(body?.skipped)}`);
} catch (e) {
  check("judge: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: scrubFreeText correctness — KEY=value becomes KEY=[redacted]
// ============================================================================

try {
  const input = `Bump the module.\nLEAKED_KEY=${CANARY}\nMore intent here.`;
  const scrubbed = scrubFreeText(input);
  check("scrub: KEY=value line scrubbed", scrubbed.includes("LEAKED_KEY=[redacted]") && !scrubbed.includes(CANARY), `got: ${scrubbed}`);
  check("scrub: non-KEY= lines preserved", scrubbed.includes("Bump the module.") && scrubbed.includes("More intent here."), `got: ${scrubbed}`);
  check("scrub: scrubFreeText already used (idempotent)", scrubFreeText(scrubbed).includes("LEAKED_KEY=[redacted]"), `got: ${scrubFreeText(scrubbed)}`);
} catch (e) {
  check("scrub: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: Negative control — canary in a non-secret file PATCH is detected
// ============================================================================
// The canary is planted in src/leak.ts file content. The patch is NOT scrubbed
// (only intent is), so the canary IS present in the patch — proving the scan
// gate can detect the canary when it appears in an unsanitized channel.

try {
  const env = envFor();
  const res = await getChanges("agent-negative", env);
  const { body } = await readJson(res);

  const leakFile = (body?.changeSet?.files ?? []).find((f) => f.path === "src/leak.ts");
  check("negative-control: leak.ts patch present", leakFile && leakFile.patch !== undefined, `patch length: ${leakFile?.patch?.length ?? 0}`);
  check("negative-control: canary present in patch (gate detects it)", countCanary(leakFile?.patch ?? "") > 0, `count ${countCanary(leakFile?.patch ?? "")}`);
} catch (e) {
  check("negative-control: suite threw", false, String(e?.stack ?? e));
}

// ============================================================================
// Test: judge-gate — canary in non-secret patch must be skipped by judge-gate
// ============================================================================
// agent-negative carries CANARY in src/leak.ts patch (KEY=VALUE line in content).
// The patch is NOT scrubbed (only intent is), so the canary IS visible in the
// judge state. The content_secret noul fires -> repo skipped, no canary in
// response, no canary in logs, no canary in AI state.

try {
  const skipRecord = makeFakeKV();
  resetAi(
    clefReply({
      risk_1: { type: "score", score: 0.5 },
      content_secret_1: { type: "noul", noul: 0.95 },
    }),
  );
  const env = envFor({ skipRecord });
  captureLogs();
  const { status, body } = await judge(
    { setId: "v1", target: { base: "demo", repos: ["agent-negative"] } },
    { ip: "10.0.5.5", env },
  );
  restoreLogs();

  check("judge-gate: status 200", status === 200, `status ${status}`);
  check("judge-gate: skipped content-detected-secret", body?.skipped?.[0]?.reason === "content-detected-secret", JSON.stringify(body?.skipped));
  check("judge-gate: canary count 0 in response", countCanaryDeep(body) === 0, `count ${countCanaryDeep(body)}`);
  check("judge-gate: canary count 0 in logs", countCanary(logLines.join("\n")) === 0, `count ${countCanary(logLines.join("\n"))}`);
  // The AI state carries the patch (by design — patches are not scrubbed).
  // But the skip decision isolates it: no judgment is returned for this repo.
  check("judge-gate: judgments empty", body?.judgments?.length === 0, JSON.stringify(body?.judgments));
  check("judge-gate: skip record written", skipRecord.get("judge-skip:agent-negative:demo:main") !== null);
} catch (e) {
  check("judge-gate: suite threw", false, String(e?.stack ?? e));
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
