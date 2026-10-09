#!/usr/bin/env bun
// Contract suite for path-driven masking posture + v1 limitation.
// Run: bun porting/tests/masking-posture.test.mjs  (exit 0 = pass)
//
// Verifies the masking law documented in CONTRACT.md: secret-class file values
// never leave the worker (keys[] only, no patch, no intent), across every
// documented class. Also documents the v1 path-driven limitation: a KEY=VALUE-
// shaped value in a non-secret-class path is NOT redacted.
//
// The real worker module is imported and exercised through worker.fetch with an
// in-memory Artifacts fake — the platform binding seam is the only thing stubbed;
// no module mocking, no source grep.

import worker from "../../platform/src/index.ts";

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

// --- fake KV + env -----------------------------------------------------------

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

function envFor({ ai = AI, artifacts = ARTIFACTS } = {}) {
  // AUTH_MODE:"demo" — auth.ts chokepoint is default-deny; demo opt-in (see judge.test.mjs).
  return { ARTIFACTS: artifacts, LIVE: makeFakeKV(), CACHE: makeFakeKV(), ASSETS: { fetch: async () => new Response("") }, AI: ai, AUTH_MODE: "demo" };
}

// --- minimal fake AI (not used by /changes, but Env requires AI) --------------

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

// --- request helpers ---------------------------------------------------------

async function getChanges(repo, env) {
  const url = `https://masking.test/changes?repo=${encodeURIComponent(repo)}`;
  return worker.fetch(new Request(url), env);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A sentinel canary value that must NEVER appear in any response body.
const SECRET_VALUE = "leaked_value_1UHP38UM17T1";
const ENV_SECRET_FILE = `API_TOKEN=${SECRET_VALUE}
DB_PASSWORD=also_${SECRET_VALUE}
`;

const BASE_FILES = { "src/base.ts": "export const base = true;\n" };

// demo: baseline repo
const cBase = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [cBase], refs: { main: cBase.hash } });

// agent-secret: forks demo, adds all 9 secret-class files in one commit.
// Fixture contents are text (no null bytes) so they pass isBinary and reach
// the path-driven masking branch.
const secretFixtures = {
  // .env* class — KEY=VALUE lines → keys extracted
  "config/.env": `API_TOKEN=${SECRET_VALUE}
DB_PASSWORD=also_${SECRET_VALUE}
`,
  // .env* variant → keys extracted
  "config/.env.local": `LOCAL_KEY=value_${SECRET_VALUE}
`,
  // *.pem — no KEY= lines → keys: []
  "certs/server.pem": `-----BEGIN CERTIFICATE-----
MIIBxAMPLE
-----END CERTIFICATE-----
`,
  // *.key — no KEY= lines → keys: []
  "tls/server.key": `-----BEGIN PRIVATE KEY-----
MIIByKEY
-----END PRIVATE KEY-----
`,
  // *.p12 — text placeholder (real .p12 is DER-binary; test proves path class)
  "cert.p12": `PKCS12-BLOB-NOT-BINARY-${SECRET_VALUE}
`,
  // credentials.json — JSON, no KEY= lines → keys: []
  "credentials.json": `{ "api_key": "${SECRET_VALUE}", "user": "demo" }
`,
  // secrets.json — JSON, no KEY= lines → keys: []
  "secrets.json": `{ "token": "${SECRET_VALUE}", "region": "us" }
`,
  // .dev.vars — KEY=VALUE lines → keys extracted
  ".dev.vars": `DB_URL=sqlite://${SECRET_VALUE}
SECRET=${SECRET_VALUE}
`,
  // secrets/ path — KEY=VALUE lines → keys extracted
  "config/secrets/api.txt": `KEY=api_secret
TOKEN=${SECRET_VALUE}
`,
};

const filesSecret = { ...BASE_FILES, ...secretFixtures };
const cSecret = commit("c-agent-secret", tree(filesSecret));
defineRepo("agent-secret", {
  history: [cSecret, cBase],
  refs: { main: cSecret.hash },
});

// agent-plain: forks demo, adds src/config.ts with KEY=VALUE value at a
// non-secret path — proving the v1 path-driven limitation (not redacted).
const PLAIN_VALUE = "leaked_value_$$1UHP38UM17T1\\M$$";
const plainFiles = {
  ...BASE_FILES,
  "src/config.ts": `export const TOKEN = "${PLAIN_VALUE}";
`,
};
const cPlain = commit("c-agent-plain", tree(plainFiles));
defineRepo("agent-plain", {
  history: [cPlain, cBase],
  refs: { main: cPlain.hash },
});

// ---------------------------------------------------------------------------
// Case (a): Table over every documented secret class
// 9 files × 6 assertions per file
// ---------------------------------------------------------------------------

const SECRET_CLASS_CASES = [
  { path: "config/.env", expectKeys: ["API_TOKEN", "DB_PASSWORD"] },
  { path: "config/.env.local", expectKeys: ["LOCAL_KEY"] },
  { path: "certs/server.pem", expectKeys: [] },
  { path: "tls/server.key", expectKeys: [] },
  { path: "cert.p12", expectKeys: [] },
  { path: "credentials.json", expectKeys: [] },
  { path: "secrets.json", expectKeys: [] },
  { path: ".dev.vars", expectKeys: ["DB_URL", "SECRET"] },
  { path: "config/secrets/api.txt", expectKeys: ["KEY", "TOKEN"] },
];

try {
  const env = envFor();
  const res = await getChanges("agent-secret", env);
  const { status, body } = await readJson(res);

  check("case-a: status 200", status === 200, `status ${status}`);
  check("case-a: changeSet present", body?.changeSet !== undefined, `body keys: ${JSON.stringify(Object.keys(body ?? {}))}`);

  for (const { path: fixturePath, expectKeys } of SECRET_CLASS_CASES) {
    const f = (body?.changeSet?.files ?? []).find((f) => f.path === fixturePath);
    const label = `case-a: ${fixturePath}`;

    // 1. file row present
    check(`${label}: row present`, f !== undefined, `not found in files`);
    if (!f) continue;

    // 2. secret === true
    check(`${label}: secret===true`, f.secret === true, `secret is ${f.secret}`);

    // 3. keys is an array
    check(`${label}: keys is Array`, Array.isArray(f.keys), `type ${typeof f.keys}`);

    // 4. keys match expected (env-style >0, others 0)
    check(`${label}: keys[${expectKeys.length}]`,
      JSON.stringify(f.keys) === JSON.stringify(expectKeys),
      `got ${JSON.stringify(f.keys)}, expected ${JSON.stringify(expectKeys)}`);

    // 5. patch === undefined
    check(`${label}: patch undefined`, f.patch === undefined, `patch length ${f.patch?.length ?? 0}`);

    // 6. intent === undefined (suppressed at index.ts:477)
    check(`${label}: intent undefined`, f.intent === undefined, `intent: ${JSON.stringify(f.intent)}`);
  }

  // Deep canary sweep: SECRET_VALUE must not appear anywhere in the JSON body.
  check("case-a: SECRET_VALUE absent from response", JSON.stringify(body).indexOf(SECRET_VALUE) === -1, "leaked!");

  // Also confirm the secret files are NOT in texts (includeTexts defaults false here, but
  // even if it were true, secret-class rows are excluded by index.ts:515 `!f.secret`).
  check("case-a: secret files absent from texts",
    Object.keys(body?.changeSet?.texts ?? {}).every((p) => !Object.keys(secretFixtures).includes(p)),
    JSON.stringify(Object.keys(body?.changeSet?.texts ?? {})));
} catch (e) {
  check("case-a: suite threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// Case (b): v1 limitation — KEY=VALUE at non-secret path is NOT redacted
// ---------------------------------------------------------------------------

try {
  const env = envFor();
  const res = await getChanges("agent-plain", env);
  const { status, body } = await readJson(res);

  check("case-b: status 200", status === 200, `status ${status}`);

  const f = (body?.changeSet?.files ?? []).find((f) => f.path === "src/config.ts");
  check("case-b: config.ts row present", f !== undefined, "not found");
  if (f) {
    check("case-b: secret absent (non-secret path)", f.secret !== true, `secret=${f.secret}`);
    check("case-b: patch present", typeof f.patch === "string" && f.patch.length > 0, `patch length ${f.patch?.length ?? 0}`);
    check("case-b: value appears in patch (v1 limitation)", f.patch !== undefined && f.patch.indexOf(PLAIN_VALUE) !== -1, "value not in patch");
    check("case-b: intent absent", f.intent === undefined, `intent: ${JSON.stringify(f.intent)}`);
  }
} catch (e) {
  check("case-b: suite threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// Case (c): CONTRACT.md carries the class list + additive-widening rule
// ---------------------------------------------------------------------------

try {
  const contractPath = new URL("../../platform/CONTRACT.md", import.meta.url);
  const contractText = await Bun.file(contractPath).text();

  check("case-c: class list present",
    contractText.includes("`.env*`") &&
    contractText.includes("`*.pem`") &&
    contractText.includes("`*.key`") &&
    contractText.includes("`*.p12`") &&
    contractText.includes("`credentials.json`") &&
    contractText.includes("`secrets.json`") &&
    contractText.includes("`.dev.vars`") &&
    contractText.includes("`secrets/`"),
    "not all classes documented");

  check("case-c: v1 limitation documented",
    contractText.includes("path-driven by design") &&
    contractText.includes("non-secret-class path is not redacted"),
    "limitation not documented");

  check("case-c: additive-widening rule documented",
    contractText.includes("content-detected secrets") &&
    contractText.includes("judge-gate skip reason") &&
    contractText.includes("this CONTRACT decision is the deliverable"),
    "additive-widening rule not documented");
} catch (e) {
  check("case-c: suite threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
