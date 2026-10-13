#!/usr/bin/env bun
// Contract suite: nextgit judge idea 12 — classify every file
// by language role and sensitivity.
// Run: bun porting/tests/classify-every-file.test.mjs   (exit 0 = pass)
//
// Real construction: imports the REAL worker from
// platform/src/index.ts (and the real classify module) and
// drives worker.fetch() against an in-memory Artifacts fake
// + a scripted AI binding — the platform binding seams are
// the ONLY fakes; no mock.module, no source grep.
//
// 6 groups:
//   1. pure classifier table (>=20 paths) + negative control
//      (KEY=VALUE at a non-secret path => internal, never secret);
//   2. GET /file carries the `file` triple + legacy
//      `classification` storage field intact;
//   3. GET /changes + GET /proposals rows carry `classification`;
//   4. AD-4 canary — a secret VALUE never appears in any body;
//   5. judge state carries `classification` on non-secret rows,
//      secret rows carry {path,status,secret,keys} only
//      (fake-AI capture);
//   6. sensitivityOf(p)==="secret" <=> isSecretPath(p) drift-guard
//      sweep over a mixed corpus.
//
// Full-suite safety: a fresh env (distinct fake Artifacts +
// fresh per-caller IP rate budget) per group;
// process.exit(fail===0?0:1).

import worker from "../../platform/src/index.ts";
import { classifyFile, sensitivityOf } from "../../platform/src/classify.ts";
// The worker re-exports isSecretPath from ./classify (the
// classification authority); the judge layer receives the
// same rule as an injected param.
import { isSecretPath } from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail) => {
  if (ok) passes++; else { fails++; console.log("FAIL  " + name + (detail ? " - " + detail : "")); }
  if (ok) console.log("PASS  " + name);
};
const J = (x) => JSON.stringify(x);

// Deterministic 40-hex commit id (the fake's commits must
// carry real sha-shaped ids — the tree-read.test.mjs hex40
// idiom).
function hex40(label) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return (hex + hex + hex + hex + hex).slice(0, 40);
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (one instance per environment — a
// factory, so environments cannot alias). Mirrors the surface
// the read, change-set and judge paths read: get/log/readTree/
// readFile/readBlob/info/revokeToken/Symbol.dispose/list.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed)
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

  function defineRepo(name, spec) {
    repos.set(name, { history: spec.history, refs: spec.refs, intents: spec.intents || {} });
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
      async log(opts) {
        const ref = (opts && opts.ref) || "HEAD";
        const limit = (opts && opts.limit) || 50;
        const byBranch = store.refs[ref];
        if (byBranch) return store.history.slice(0, limit);
        const single = resolve(ref);
        return single ? [single].slice(0, limit) : [];
      },
      async readTree(hash) {
        return treeEntries.get(hash) ?? null;
      },
      async readFile(args) {
        const ref = args.ref;
        const path = args.path;
        const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
        if (!head) return null;
        // Git-notes intent seam: NEXTGIT_INTENT/<sha>.txt
        // is served from the repo's intents map (the same
        // seam judge.test.mjs wires), never from the tree.
        if (path.startsWith("NEXTGIT_INTENT/")) {
          const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
          const text = store.intents[sha];
          return text === undefined ? null : new Blob([text]);
        }
        const blobHash = lookupPath(head.treeHash, path);
        return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
      },
      async readBlob(hash) {
        return blobText.has(hash) ? new Blob([blobText.get(blobHash)]) : null;
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

  return {
    ARTIFACTS: {
      async get(name) {
        return repoFor(name);
      },
      async list() {
        return { repos: [] };
      },
    },
    tree,
    commit,
    defineRepo,
  };
}

// ---------------------------------------------------------------------------
// Fixture — demo/main carries the classification corpus; agent-1
// forks it (one modified source file) so /changes and /proposals
// have a real change-set; agent-secret carries a secret-class
// file next to a source file (the mixed-repo judge posture).
// ---------------------------------------------------------------------------
const SOURCE_TS = "export const nextgit = 1;\nexport const keep = true;\n";
const SOURCE_TS_V2 = "export const nextgit = 2;\nexport const keep = true;\n";
const README = "# demo\n\nthe demo repo\n";
const SECRET_VALUE_1 = "super-secret-api-key-value-DO-NOT-LEAK";
const SECRET_VALUE_2 = "postgres://demo:FAKE-SECRET@db.internal:5432/app";
const ENV_FILE = "API_KEY=" + SECRET_VALUE_1 + "\nDB_URL=" + SECRET_VALUE_2 + "\n";
const BIN_FILE = "PK\x00\x01\x02\x03binary-bytes\x00";
const PLAIN_ENV = "KEY=VALUE\nOTHER=also-value\n"; // KEY=VALUE at a NON-secret path

const DEMO_FILES = {
  "src/index.ts": SOURCE_TS,
  "README.md": README,
  "config/.env": ENV_FILE,
  "pkg.bin": BIN_FILE,
  "package.json": '{"name":"demo"}\n',
  "docs/guide.md": "guide\n",
  "data/rows.csv": "a,b\n1,2\n",
  "test/unit.test.ts": "test('x', () => {});\n",
  "plain.txt": PLAIN_ENV,
};

// agent-1: one modified source file + a modified secret-class
// file (a real change-set; the secret row must appear in
// /changes with sensitivity "secret").
const AGENT1_ENV = "API_KEY=" + SECRET_VALUE_1 + "\nDB_URL=" + SECRET_VALUE_2 + "\nREDIS_URL=redis://cache.internal\n";
const AGENT1_FILES = { ...DEMO_FILES, "src/index.ts": SOURCE_TS_V2, "config/.env": AGENT1_ENV };
// agent-secret: one ADDED source file + a MODIFIED
// secret-class file (mixed repo — judged: the secret
// row masked to keys, the source row classified).
const AGENT_SECRET_ENV = "API_KEY=" + SECRET_VALUE_1 + "\nDB_URL=" + SECRET_VALUE_2 + "\nREDIS_URL=redis://cache.internal\n";
const AGENT_SECRET_FILES = { ...DEMO_FILES, "src/mix.ts": "export const mix = 1;\n", "config/.env": AGENT_SECRET_ENV };

let ipSeq = 0;
const nextIp = () => "10.8.1." + (++ipSeq);
function makeEnv() {
  const fake = makeFakeArtifacts();
  const demoCommit = fake.commit(hex40("demo-main"), fake.tree(DEMO_FILES));
  fake.defineRepo("demo", { history: [demoCommit], refs: { main: demoCommit.hash } });
  const agentCommit = fake.commit(hex40("agent-1-main"), fake.tree(AGENT1_FILES));
  fake.defineRepo("agent-1", { history: [agentCommit, demoCommit], refs: { main: agentCommit.hash } });
  const agentSecretCommit = fake.commit(hex40("agent-secret-main"), fake.tree(AGENT_SECRET_FILES));
  // Git-notes intent (the NEXTGIT_INTENT/<sha>.txt read seam) so
  // the judge route asks intent_1/overclaim_1 for this repo.
  fake.defineRepo("agent-secret", { history: [agentSecretCommit, demoCommit], refs: { main: agentSecretCommit.hash }, intents: { [agentSecretCommit.hash]: "Add a mix module next to the env config" } });
  return {
    env: {
      ARTIFACTS: fake.ARTIFACTS,
      LIVE: { get: async () => undefined },
      CACHE: { get: async () => undefined, put: async () => { } },
      ASSETS: { fetch: async () => new Response("") },
      AI: { run: async () => null },
      AUTH_MODE: "demo",
    },
    fake,
  };
}

// JSON GET helper (query routes).
const get = async (env, path, query, ip) => {
  const q = query || "";
  const caller = ip || nextIp();
  const res = await worker.fetch(
    new Request("https://nextgit.invalid" + path + q, { headers: { "CF-Connecting-IP": caller } }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") };
};

// POST /judge helper with a scripted AI binding (fake-AI capture).
const aiCalls = [];
let aiNext = null;
const AI = {
  async run(model, inputs) {
    aiCalls.push({ model, inputs });
    if (aiNext instanceof Error) throw aiNext;
    return aiNext;
  },
};
const clefReply = (answers) => ({ model: "clef", answers, usage: { neurons: 1 } });
const judgePost = async (env, body, ip) => {
  const caller = ip || nextIp();
  const res = await worker.fetch(
    new Request("https://nextgit.invalid/judge", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": caller },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ===========================================================================
// Group 1 — pure classifier table (>= 20 paths) + negative control.
// ===========================================================================
{
  const cases = [
    // [path, language, role, sensitivity]
    ["src/index.ts", "typescript", "source", "internal"],
    ["src/util.ts", "typescript", "source", "internal"],
    ["lib/mod.mjs", "javascript", "source", "internal"],
    ["lib/legacy.cjs", "javascript", "source", "internal"],
    ["ui/app.jsx", "javascript", "source", "internal"],
    ["types/global.d.ts", "typescript", "source", "internal"],
    ["package.json", "json", "config", "internal"],
    ["wrangler.jsonc", "json", "config", "internal"],
    ["wrangler.toml", "toml", "config", "internal"],
    ["tsconfig.json", "json", "config", "internal"],
    ["config/deploy.yaml", "yaml", "config", "internal"],
    ["docs/guide.md", "markdown", "docs", "internal"],
    ["README.md", "markdown", "docs", "internal"],
    ["CHANGELOG.md", "markdown", "docs", "internal"],
    ["assets/logo.png", "unknown", "asset", "internal"],
    ["static/img/pic.jpg", "unknown", "asset", "internal"],
    ["dist/bundle.js", "javascript", "asset", "internal"],
    ["data/rows.csv", "unknown", "data", "internal"],
    ["__tests__/helper.js", "javascript", "test", "internal"],
    ["scripts/run.sh", "shell", "source", "internal"],
    ["migrations/001.sql", "sql", "source", "internal"],
    ["tools/scan.py", "python", "source", "internal"],
    ["notes.txt", "text", "source", "internal"],
    ["config/.env", "unknown", "config", "secret"],
    ["config/.env.local", "unknown", "config", "secret"],
    ["deploy/host.pem", "unknown", "source", "secret"],
    ["keys/id.key", "unknown", "source", "secret"],
    ["certs/pair.p12", "unknown", "source", "secret"],
    ["config/credentials.json", "json", "config", "secret"],
    ["config/secrets.json", "json", "config", "secret"],
    ["config/.dev.vars", "unknown", "config", "secret"],
    ["secrets/token.txt", "text", "source", "secret"],
  ];
  let tablePass = 0;
  const tableFails = [];
  for (const [path, language, role, sensitivity] of cases) {
    const got = classifyFile(path);
    const ok = got.language === language && got.role === role && got.sensitivity === sensitivity;
    if (ok) tablePass++; else tableFails.push(`${path} => ${J(got)} (want ${language}/${role}/${sensitivity})`);
  }
  check("1 classifier table (>=20 paths, all exact)", tablePass >= 20 && tableFails.length === 0, tableFails.join("; "));
  // Negative control: a KEY=VALUE body at a NON-secret path is
  // path-driven — sensitivity stays internal, never secret
  // (judge idea 11's content detection is a different lane).
  const plain = classifyFile("plain.txt");
  check("1 negative control: KEY=VALUE at non-secret path => internal", plain.sensitivity === "internal", J(plain));
  // The binary flag does not alter the three axes.
  const bin = classifyFile("pkg.bin", { binary: true });
  check("1 binary flag does not alter the axes", bin.sensitivity === "internal" && bin.role === "source", J(bin));
}

// ===========================================================================
// Group 2 — GET /file carries the `file` triple + legacy
// `classification` storage field intact.
// ===========================================================================
{
  const { env } = makeEnv();
  const text = await get(env, "/file", "?repo=demo&path=src/index.ts");
  check("2 /file text status 200", text.status === 200 && text.body?.ok === true, J(text.body));
  check("2 /file legacy classification storage field intact", text.body?.classification === "text", J(text.body?.classification));
  check("2 /file file triple (text)", J(text.body?.file) === J({ language: "typescript", role: "source", sensitivity: "internal" }), J(text.body?.file));

  const bin = await get(env, "/file", "?repo=demo&path=pkg.bin");
  check("2 /file binary legacy classification intact", bin.body?.classification === "binary", J(bin.body?.classification));
  check("2 /file file triple (binary)", J(bin.body?.file) === J({ language: "unknown", role: "source", sensitivity: "internal" }), J(bin.body?.file));

  const secret = await get(env, "/file", "?repo=demo&path=config/.env");
  check("2 /file secret legacy classification intact", secret.body?.classification === "secret", J(secret.body?.classification));
  check("2 /file file triple (secret)", J(secret.body?.file) === J({ language: "unknown", role: "config", sensitivity: "secret" }), J(secret.body?.file));
  check("2 /file secret keys are the fixture key names", J(secret.body?.keys) === J(["API_KEY", "DB_URL"]), J(secret.body?.keys));
}

// ===========================================================================
// Group 3 — GET /changes + GET /proposals rows carry `classification`.
// ===========================================================================
{
  const { env } = makeEnv();
  const changes = await get(env, "/changes", "?repo=agent-1&base=demo&ref=main&baseRef=main");
  check("3 /changes status 200", changes.status === 200 && changes.body?.ok === true, J(changes.body));
  const srcRow = (changes.body?.changeSet?.files ?? []).find((f) => f.path === "src/index.ts");
  check("3 /changes row carries classification", J(srcRow?.classification) === J({ language: "typescript", role: "source", sensitivity: "internal" }), J(srcRow));
  const secretRow = (changes.body?.changeSet?.files ?? []).find((f) => f.path === "config/.env");
  check("3 /changes secret row carries classification (sensitivity secret)", secretRow?.classification?.sensitivity === "secret" && secretRow?.secret === true, J(secretRow));

  const proposals = await get(env, "/proposals", "?base=demo&repos=agent-1&ref=main&baseRef=main");
  check("3 /proposals status 200", proposals.status === 200 && proposals.body?.ok === true, J(proposals.body));
  const prop = (proposals.body?.proposals ?? []).find((p) => p.repo === "agent-1");
  const propRow = (prop?.files ?? []).find((f) => f.path === "src/index.ts");
  check("3 /proposals row carries classification", J(propRow?.classification) === J({ language: "typescript", role: "source", sensitivity: "internal" }), J(propRow));
  // Regression guard (heal-1 F1): the /proposals wire
  // row must carry the secret row's keys[] — the
  // ChangeFile source stamps both f.classification and
  // f.keys, and the wire projection copies BOTH (the
  // idea-12 edit once dropped keys here). agent-1's
  // config/.env carries exactly these three key names.
  const propSecretRow = (prop?.files ?? []).find((f) => f.path === "config/.env");
  check("3 /proposals secret-class row carries keys[]",
    !!propSecretRow && propSecretRow.secret === true
    && Array.isArray(propSecretRow.keys) && propSecretRow.keys.length > 0
    && J(propSecretRow.keys) === J(["API_KEY", "DB_URL", "REDIS_URL"]),
    JSON.stringify(propSecretRow));
}

// ===========================================================================
// Group 4 — AD-4 canary: a secret VALUE never appears in any body.
// ===========================================================================
{
  const { env } = makeEnv();
  const bodies = [];
  bodies.push(await get(env, "/file", "?repo=demo&path=config/.env"));
  bodies.push(await get(env, "/file", "?repo=demo&path=src/index.ts"));
  bodies.push(await get(env, "/changes", "?repo=agent-1&base=demo&ref=main&baseRef=main"));
  bodies.push(await get(env, "/proposals", "?base=demo&repos=agent-1&ref=main&baseRef=main"));
  const allText = bodies.map((b) => b.text ?? J(b.body)).join("\n");
  check("4 canary value 1 absent from every body", !allText.includes(SECRET_VALUE_1), "SECRET_VALUE_1 present");
  check("4 canary value 2 absent from every body", !allText.includes(SECRET_VALUE_2), "SECRET_VALUE_2 present");
  // The secret row's /file carries no text field: the triple
  // is path-derived, so it cannot echo content.
  const secretFile = await get(env, "/file", "?repo=demo&path=config/.env");
  check("4 secret row /file carries no text field", !("text" in (secretFile.body || {})), J(secretFile.body));
}

// ===========================================================================
// Group 5 — judge state carries `classification` on non-secret
// rows; secret rows carry {path,status,secret,keys} only
// (fake-AI capture).
// ===========================================================================
{
  const { env } = makeEnv();
  // Wire the scripted AI binding into this group's env.
  env.AI = AI;
  // Single-repo plan: risk_1, intent_1, overclaim_1,
  // content_secret_1 (collision_<i> is asked only when
  // >= 2 repos are under review).
  const answers = {
    risk_1: { type: "score", score: 0.5, confidence: 0.5 },
    intent_1: { type: "choice", choice: "supports" },
    overclaim_1: { type: "noul", noul: 0.1 },
    content_secret_1: { type: "noul", noul: 0.1 },
  };
  aiNext = clefReply(answers);
  aiCalls.length = 0;
  const res = await judgePost(env, { setId: "v1", target: { base: "demo", repos: ["agent-secret"] } });
  check("5 POST /judge status 200", res.status === 200 && res.body?.ok === true, J(res.body));
  check("5 one AI call captured", aiCalls.length === 1, J(aiCalls.length));
  const state = aiCalls[0]?.inputs?.state;
  check("5 state captured", !!state && Array.isArray(state.proposals) && state.proposals.length === 1, J(state && state.proposals?.length));
  const files = state?.proposals?.[0]?.files ?? [];
  const mixRow = files.find((f) => f.path === "src/mix.ts");
  const envRow = files.find((f) => f.path === "config/.env");
  check("5 non-secret row carries classification", J(mixRow?.classification) === J({ language: "typescript", role: "source", sensitivity: "internal" }), J(mixRow));
  check("5 secret row carries {path,status,secret,keys} only", !!envRow && envRow.secret === true && J(Object.keys(envRow).sort()) === J(["keys", "path", "secret", "status"]) && envRow.classification === undefined, J(envRow));
  check("5 secret row keys are the fixture key names", J(envRow?.keys) === J(["API_KEY", "DB_URL", "REDIS_URL"]), J(envRow?.keys));
  // The captured state must not contain the secret values.
  const stateText = J(state);
  check("5 captured state carries no canary value", !stateText.includes(SECRET_VALUE_1) && !stateText.includes(SECRET_VALUE_2), "canary in state");
}

// ===========================================================================
// Group 6 — sensitivityOf(p)==="secret" <=> isSecretPath(p) drift guard.
// ===========================================================================
{
  const corpus = [
    "src/index.ts", "README.md", "package.json", "wrangler.toml",
    "docs/guide.md", "data/rows.csv", "test/unit.test.ts", "assets/x.png",
    "config/.env", "config/.env.local", "config/.env.production",
    "deploy/host.pem", "keys/id.key", "certs/pair.p12",
    "config/credentials.json", "config/secrets.json", "config/.dev.vars",
    "secrets/token.txt", "secrets/nested/key.json", "a/secrets/b/c.txt",
    "plain.txt", "src/secrets.ts", "SECRETS.md", "config/keys.json",
    ".envrc", "env.txt", "mykeys.pem.txt", "notes/about-keys.md",
  ];
  let agree = 0;
  const mismatches = [];
  for (const p of corpus) {
    const viaSensitivity = sensitivityOf(p) === "secret";
    const viaIsSecretPath = isSecretPath(p);
    if (viaSensitivity === viaIsSecretPath) agree++;
    else mismatches.push(`${p}: sensitivityOf=${viaSensitivity} isSecretPath=${viaIsSecretPath}`);
  }
  check("6 equivalence sweep (sensitivityOf <=> isSecretPath, all corpus)", agree === corpus.length && mismatches.length === 0, mismatches.join("; "));
  // The re-export seam: index.ts's isSecretPath IS classify.ts's
  // (behavioral identity over the corpus).
  check("6 re-export seam behavioral identity", corpus.every((p) => isSecretPath(p) === (sensitivityOf(p) === "secret")), "identity broken");
}

// ---------------------------------------------------------------------------
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
