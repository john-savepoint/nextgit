#!/usr/bin/env bun
// Contract suite for the signed validation-evidence layer
// (FR-18 authenticity; CONTRACT.md §Attestations).
// Run: bun porting/tests/attestation.test.mjs   (exit 0 = pass)
//
// Idiom: fork-upstream.test.mjs — the REAL worker
// (worker.fetch) against an in-memory Artifacts fake whose
// base repo's `info()` returns a remote served by an
// in-process `git http-backend` smart-HTTP server, so the
// /land path — clone, fold, commit, push, KV record — runs
// for real. An INSTRUMENTED R2 fake (its `put` records,
// its `get` replays) is the EVIDENCE_BLOB binding. Real
// WebCrypto key generation. No mock.module, no source grep,
// no network, full-suite safe.
//
// Groups (each defends an observable contract):
//   1. Canonicalization — key order, nesting, arrays,
//      code-unit order, no whitespace
//   2. Round-trip — real generateKey → signAttestation →
//      verifyAttestation true; keyId = sha256(raw)[0..16]
//   3. Tamper (the acceptance) — 6 independent signed-field
//      flips → verifyAttestation false for every one
//   4. Wrong key — signed by key A, verified with key B → false
//   5. End-to-end POST /land — 200 carries attestation.status
//      "signed"; the sig verifies; the KV record's attestation
//      deep-equals the 200's; the R2 fake saw exactly one put
//      at attestations/<commit>.json deep-equal to it
//   6. Honest-unavailable — env without EVIDENCE_SIGNING_KEY →
//      land 200, attestation.status "unavailable" + reason,
//      the KV record carries the same, ZERO R2 puts
//   7. Read-back — GET /landings/<commit> returns the same
//      attestation; a hand-written pre-feature KV record reads
//      attestation: null
//   8. Verifier fail-closed — malformed inputs → false,
//      never a throw
//   9. Cross-copy — R2 copy tampered while the served copy is
//      intact (and vice-versa) → the comparison leg fails

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import fs from "node:fs";
import os from "node:os";

import worker from "../../platform/src/index.ts";
import {
  ATTESTATION_VERSION,
  ATTEST_ALGO,
  EVIDENCE_KEY_PREFIX,
  EVIDENCE_MAX_BYTES,
  canonicalize,
  keyIdOf,
  readAttestation,
  signAttestation,
  verifyAttestation,
} from "../../platform/src/attest.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// base64url helpers (the envelope's binary encoding)
// ---------------------------------------------------------------------------
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const rem = normalized.length % 4;
  if (rem === 1) return null;
  const padded = rem === 2 ? `${normalized}==` : rem === 3 ? `${normalized}=` : normalized;
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Real WebCrypto key material (the provisioning seam's output).
// ---------------------------------------------------------------------------
async function makeKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: ATTEST_ALGO }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKeyB64url: b64url(pkcs8), publicKeyB64url: b64url(rawPub) };
}

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (the push seam) — fork-upstream
// idiom: the base repo's remote is a real git server, so
// pushLand's clone/push run for real.
// ---------------------------------------------------------------------------
const repoDir = fs.mkdtempSync(join(os.tmpdir(), "attestation-"));
function sh(args, cwd = repoDir) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
function makeGitServer() {
  const dir = fs.mkdtempSync(join(repoDir, "srv-"));
  const bareDir = join(dir, "demo.git");
  const workDir = join(dir, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const w = (args) => sh(args, workDir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);
  fs.mkdirSync(join(workDir, "src"), { recursive: true });
  fs.writeFileSync(join(workDir, "src", "a.ts"), "export const a = 1;\n");
  w(["add", "-A"]);
  w(["commit", "-qm", "base"]);
  sh(["clone", "--bare", workDir, bareDir], dir);
  sh(["-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], dir);
  sh(["-C", bareDir, "config", "http.receivepack", "true"], dir);

  const server = createServer((req, res) => {
    const url = `http://localhost${req.url}`;
    const backend = spawn("git", ["http-backend"], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_PROJECT_ROOT: dir,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: new URL(url).pathname,
        REQUEST_METHOD: req.method,
        QUERY_STRING: new URL(url).searchParams.toString(),
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        REMOTE_ADDR: "127.0.0.1",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (req.method === "POST" || req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => backend.stdin.end(Buffer.concat(chunks)));
    } else {
      backend.stdin.end();
    }
    let headers = {};
    const body = [];
    let status = 200;
    backend.stdout.on("data", (d) => body.push(d));
    backend.on("close", () => {
      const buf = Buffer.concat(body);
      const idx = buf.indexOf("\r\n\r\n");
      const head = buf.slice(0, idx).toString();
      const payload = buf.slice(idx + 4);
      for (const line of head.split("\r\n")) {
        const m = line.match(/^([^:]+):\s*(.*)$/);
        if (m) {
          const k = m[1].toLowerCase();
          if (k === "status") status = parseInt(m[2].split(" ")[0], 10);
          else headers[m[1]] = m[2];
        }
      }
      res.writeHead(status, headers);
      res.end(payload);
    });
  });
  return { dir, bareDir, server };
}
async function startGitServer() {
  const g = makeGitServer();
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  g.port = g.server.address().port;
  g.remote = `http://127.0.0.1:${g.port}/demo.git`;
  return g;
}
function gitServerMain(g) {
  return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (fork-upstream shape) — info() points
// at the per-environment git server.
// ---------------------------------------------------------------------------
function makeFakeArtifacts(g) {
  const blobText = new Map();
  const blobHashByText = new Map();
  const treeEntries = new Map();
  const repos = new Map();
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
        const blobHash = lookupPath(head.treeHash, path);
        return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
      },
      async readBlob(hash) {
        return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
      },
      async info() {
        return { remote: g.remote };
      },
      async createToken(_scope, _ttl) {
        return { plaintext: `fake-write-token-${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }
  return {
    async get(name) {
      return repoFor(name);
    },
    async list() {
      return { repos: [] };
    },
    _fixture: { internBlob, tree, commit, defineRepo },
  };
}

function makeFakeKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// INSTRUMENTED R2 fake (the EVIDENCE_BLOB binding): put records,
// get replays. Records every put so the suite asserts exactly
// one attestation object per landing.
// ---------------------------------------------------------------------------
function makeInstrumentedR2() {
  const store = new Map(); // key -> Uint8Array
  const puts = []; // { key, value } in put order
  return {
    async get(key) {
      const bytes = store.get(key);
      if (!bytes) return null;
      const body = new Blob([bytes]);
      return {
        body,
        httpMetadata: {},
        // Real R2 objects expose arrayBuffer(); the read-back
        // surface (attest.ts readAttestation) calls it.
        async arrayBuffer() {
          return await body.arrayBuffer();
        },
      };
    },
    // The binding accepts a string body (storeAttestation puts
    // JSON.stringify(att)) — accept both strings and Blob-likes.
    async put(key, value) {
      const bytes = typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(await value.arrayBuffer());
      store.set(key, bytes);
      puts.push({ key, value: new TextDecoder().decode(bytes) });
    },
    _puts: puts,
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// The full /land environment: real git server + fake Artifacts +
// KV fakes + instrumented R2 + real key material.
// ---------------------------------------------------------------------------
async function makeEnvironment({ withKeys = true, withR2 = true } = {}) {
  const g = await startGitServer();
  const baseSha = gitServerMain(g);
  const artifacts = makeFakeArtifacts(g);
  const F = artifacts._fixture;
  const BASE_FILES = { "src/a.ts": "export const a = 1;\n" };
  const c1 = F.commit(baseSha, F.tree(BASE_FILES));
  F.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
  // agent-1 bumps src/a.ts 1 -> 2 (the happy-path change).
  const a1 = F.commit("c-agent-1", F.tree({ ...BASE_FILES, "src/a.ts": "export const a = 2;\n" }));
  F.defineRepo("agent-1", { history: [a1, c1], refs: { main: a1.hash } });

  const keys = withKeys ? await makeKeyPair() : null;
  const r2 = withR2 ? makeInstrumentedR2() : undefined;
  const env = {
    ARTIFACTS: artifacts,
    LIVE: makeFakeKV(),
    CACHE: makeFakeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: { async run() { return { model: "clef", answers: {}, usage: { neurons: 0 } }; } },
    AUTH_MODE: "demo",
    ...(r2 ? { EVIDENCE_BLOB: r2 } : {}),
    ...(keys ? {
      EVIDENCE_SIGNING_KEY: keys.privateKeyB64url,
      EVIDENCE_PUBLIC_KEY: keys.publicKeyB64url,
    } : {}),
    CF_VERSION_METADATA: { id: "deploy-42", tag: "v1.2.3" },
  };
  return { g, env, F, baseCommit: c1, keys, r2 };
}

const capturedWaitUntil = [];
const fakeCtx = {
  waitUntil(p) {
    capturedWaitUntil.push(p);
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

async function land(env, payload, ip = "10.9.0.1") {
  const res = await worker.fetch(
    new Request("https://nextgit.test/land", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(payload),
    }),
    env,
    fakeCtx,
  );
  return readJson(res);
}

async function readLanding(env, commit) {
  const res = await worker.fetch(
    new Request(`https://nextgit.test/landings/${commit}`, { method: "GET" }),
    env,
  );
  return readJson(res);
}

// ===========================================================================
// Group 1 — Canonicalization
// ===========================================================================
{
  // Two literals with different key order → identical bytes.
  const a = canonicalize({ x: 1, y: "two", z: [true, null] });
  const b = canonicalize({ z: [true, null], y: "two", x: 1 });
  check("1a key order does not matter", a === b, `${a} vs ${b}`);
  // Nesting + arrays in order.
  const nested = canonicalize({ b: [{ a: 1 }, { a: 2 }], a: { c: 3, b: 4 } });
  check("1b nested + arrays", nested === '{"a":{"b":4,"c":3},"b":[{"a":1},{"a":2}]}', nested);
  // Code-unit order proven against a locale-divergent pair:
  // localeCompare sorts case-insensitively in some locales;
  // code-unit sorts "B" (0x42) before "a" (0x61).
  const divergent = canonicalize({ a: 1, B: 2, b: 3 });
  check("1c code-unit order (B < a < b)", divergent === '{"B":2,"a":1,"b":3}', divergent);
  // No whitespace in the serialization SYNTAX (keys, braces,
  // colons, commas). String values may legitimately contain
  // spaces; the law pins the structural form, so a value-free
  // object proves it.
  check("1d no whitespace in structure", !/\s/.test(canonicalize({ a: 1, b: [true, false] })), canonicalize({ a: 1, b: [true, false] }));
}

// ===========================================================================
// Group 2 — Round-trip (real generateKey)
// ===========================================================================
{
  const { privateKeyB64url, publicKeyB64url } = await makeKeyPair();
  const env = {
    EVIDENCE_SIGNING_KEY: privateKeyB64url,
    EVIDENCE_PUBLIC_KEY: publicKeyB64url,
  };
  const evidence = {
    repos: ["agent-1"], commit: "a".repeat(40), ancestor: {}, heads: {},
    foldHash: "b".repeat(64), checks: ["node --check"], results: ["pass"],
    mergedSha: "b".repeat(64), testedSha: null, artifactRef: null, at: "2026-10-14T00:00:00.000Z",
  };
  const att = await signAttestation(env, {
    subject: { commit: evidence.commit, repos: evidence.repos, base: "demo", ref: "main", baseRef: "main" },
    environment: { worker: "nextgit-platform", deploy: "d1", tag: "t1", runtime: "workerd" },
    evidence,
  });
  check("2a status signed", att.status === "signed", JSON.stringify(att));
  if (att.status !== "signed") {
    check("2 round-trip (skipped)", false, "attestation unavailable");
  } else {
    check("2b v echoes", att.v === ATTESTATION_VERSION, String(att.v));
    check("2c algo echoes", att.algo === ATTEST_ALGO, att.algo);
    check("2d environment echoes", att.environment.deploy === "d1" && att.environment.tag === "t1", JSON.stringify(att.environment));
    // keyId = sha256(raw public key)[0..16]
    const rawPub = unb64url(publicKeyB64url);
    const expectedKeyId = await keyIdOf(rawPub);
    check("2e keyId === sha256(raw public)[0..16]", att.keyId === expectedKeyId, `${att.keyId} vs ${expectedKeyId}`);
    check("2f verifyAttestation true", await verifyAttestation(att, publicKeyB64url));
  }
}

// ===========================================================================
// Group 3 — Tamper (the acceptance): 6 independent flips → false
// ===========================================================================
{
  const { privateKeyB64url, publicKeyB64url } = await makeKeyPair();
  const env = { EVIDENCE_SIGNING_KEY: privateKeyB64url, EVIDENCE_PUBLIC_KEY: publicKeyB64url };
  const evidence = {
    repos: ["agent-1"], commit: "a".repeat(40), ancestor: {}, heads: {},
    foldHash: "b".repeat(64), checks: ["node --check"], results: ["pass"],
    mergedSha: "b".repeat(64), testedSha: null, artifactRef: null, at: "2026-10-14T00:00:00.000Z",
  };
  const att = await signAttestation(env, {
    subject: { commit: evidence.commit, repos: evidence.repos, base: "demo", ref: "main", baseRef: "main" },
    environment: { worker: "nextgit-platform", deploy: null, tag: null, runtime: "workerd" },
    evidence,
  });
  if (att.status !== "signed") {
    check("3 tamper (skipped)", false, "attestation unavailable");
  } else {
    const flips = [
      [(t) => { t.subject.commit = "b".repeat(40); }, "subject.commit flipped → false"],
      [(t) => { t.evidence.foldHash = "c".repeat(64); }, "evidence.foldHash flipped → false"],
      [(t) => { t.evidence.results[0] = "fail"; }, "evidence.results[0] flipped → false"],
      [(t) => { t.environment.deploy = "tampered"; }, "environment.deploy flipped → false"],
      [(t) => { t.at = "1999-01-01T00:00:00.000Z"; }, "at flipped → false"],
    ];
    // Foreign-key signature: sign the same envelope under a
    // different key, then splice that signature in.
    const foreign = await makeKeyPair();
    const foreignEnv = { EVIDENCE_SIGNING_KEY: foreign.privateKeyB64url, EVIDENCE_PUBLIC_KEY: foreign.publicKeyB64url };
    const foreignAtt = await signAttestation(foreignEnv, {
      subject: { commit: evidence.commit, repos: evidence.repos, base: "demo", ref: "main", baseRef: "main" },
      environment: { worker: "nextgit-platform", deploy: null, tag: null, runtime: "workerd" },
      evidence,
    });
    flips.push([
      (t) => { t.sig = foreignAtt.status === "signed" ? foreignAtt.sig : "x".repeat(86); },
      "sig replaced by another key's signature → false",
    ]);
    for (const [mutate, label] of flips) {
      const tampered = JSON.parse(JSON.stringify(att));
      mutate(tampered);
      const ok = await verifyAttestation(tampered, publicKeyB64url);
      check(`3 ${label}`, ok === false, `verify returned ${ok}`);
    }
  }
}


// ===========================================================================
// Group 4 — Wrong key
// ===========================================================================
{
  const a = await makeKeyPair();
  const b = await makeKeyPair();
  const env = { EVIDENCE_SIGNING_KEY: a.privateKeyB64url, EVIDENCE_PUBLIC_KEY: a.publicKeyB64url };
  const evidence = {
    repos: ["agent-1"], commit: "a".repeat(40), ancestor: {}, heads: {},
    foldHash: "b".repeat(64), checks: [], results: [],
    mergedSha: "b".repeat(64), testedSha: null, artifactRef: null, at: "2026-10-14T00:00:00.000Z",
  };
  const att = await signAttestation(env, {
    subject: { commit: evidence.commit, repos: evidence.repos, base: "demo", ref: "main", baseRef: "main" },
    environment: { worker: "nextgit-platform", deploy: null, tag: null, runtime: "workerd" },
    evidence,
  });
  if (att.status !== "signed") {
    check("4 wrong key (skipped)", false, "attestation unavailable");
  } else {
    const ok = await verifyAttestation(att, b.publicKeyB64url);
    check("4 signed by key A, verified with key B's public → false", ok === false, `verify returned ${ok}`);
  }
}

// ===========================================================================
// Group 5 — End-to-end POST /land (real worker, real push)
// ===========================================================================
{
  const { g, env, r2, keys } = await makeEnvironment();
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  check("5a land 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  const att = r.body?.attestation;
  check("5b 200 carries attestation.status === signed", att?.status === "signed", JSON.stringify(att ?? null));
  if (att?.status === "signed") {
    const ok = await verifyAttestation(att, keys.publicKeyB64url);
    check("5c attestation signature verifies against the test public key", ok === true, String(ok));
    check("5d attestation subject.commit === landed commit", att.subject?.commit === r.body?.landed?.commit, JSON.stringify(att.subject));
    check("5e attestation environment carries the deploy metadata", att.environment?.deploy === "deploy-42" && att.environment?.tag === "v1.2.3", JSON.stringify(att.environment));
    // The evidence inside the attestation deep-equals the 200's evidence.
    check("5f attestation.evidence deep-equals the 200's evidence", deepEqual(att.evidence, r.body?.evidence), JSON.stringify({ att: att.evidence, live: r.body?.evidence }));
    // The KV record carries the same attestation.
    const commit = r.body?.landed?.commit;
    const kvRecord = JSON.parse(env.CACHE._store.get(`landing:${commit}`) ?? "null");
    check("5g KV landing:<commit> record's attestation deep-equals the 200's", deepEqual(kvRecord?.attestation, att), JSON.stringify({ kv: kvRecord?.attestation ?? null }));
    // The R2 fake saw exactly one put at attestations/<commit>.json, deep-equal.
    const expectedKey = `${EVIDENCE_KEY_PREFIX}${commit}.json`;
    const matching = r2._puts.filter((p) => p.key === expectedKey);
    check("5h exactly one R2 put at attestations/<commit>.json", matching.length === 1, JSON.stringify(r2._puts.map((p) => p.key)));
    if (matching.length === 1) {
      check("5i the R2 put deep-equals the 200's attestation", deepEqual(JSON.parse(matching[0].value), att), matching[0].value.slice(0, 120));
    }
    // The 200 body's top-level keys are exactly {ok, landed, evidence, attestation}.
    check("5j 200 top-level keys exactly {ok,landed,evidence,attestation}",
      deepEqual(Object.keys(r.body).sort(), ["attestation", "evidence", "landed", "ok"]),
      JSON.stringify(Object.keys(r.body)));
  }
  // The base remote advanced (the land really pushed).
  const after = gitServerMain(g);
  check("5k the land really pushed (git server main === evidence.commit)", after === r.body?.landed?.commit, `${after} vs ${r.body?.landed?.commit}`);
}

// ===========================================================================
// Group 6 — Honest-unavailable (no signing key)
// ===========================================================================
{
  const { g, env, r2 } = await makeEnvironment({ withKeys: false });
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  check("6a land still 200 (attestation infra never breaks a land)", r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  const att = r.body?.attestation;
  check("6b attestation.status === unavailable", att?.status === "unavailable", JSON.stringify(att ?? null));
  check("6c attestation carries an honest reason", typeof att?.reason === "string" && att.reason.length > 0, JSON.stringify(att));
  const commit = r.body?.landed?.commit;
  const kvRecord = JSON.parse(env.CACHE._store.get(`landing:${commit}`) ?? "null");
  check("6d the KV record carries the same unavailable attestation", deepEqual(kvRecord?.attestation, att), JSON.stringify(kvRecord?.attestation));
  check("6e ZERO R2 puts (nothing signed, nothing stored)", r2._puts.length === 0, JSON.stringify(r2._puts.map((p) => p.key)));
}

// ===========================================================================
// Group 7 — Read-back
// ===========================================================================
{
  const { env, keys } = await makeEnvironment();
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  const commit = r.body?.landed?.commit;
  const rec = await readLanding(env, commit);
  check("7a GET /landings/<commit> 200", rec.status === 200, `got ${rec.status}`);
  check("7b read-back landed deep-equals the 200's", deepEqual(rec.body?.landed, r.body?.landed));
  check("7c read-back evidence deep-equals the 200's", deepEqual(rec.body?.evidence, r.body?.evidence));
  check("7d read-back attestation deep-equals the 200's", deepEqual(rec.body?.attestation, r.body?.attestation));
  if (rec.body?.attestation?.status === "signed") {
    check("7e read-back attestation verifies against the test public key", await verifyAttestation(rec.body.attestation, keys.publicKeyB64url) === true);
  }
  // A hand-written pre-feature KV record reads attestation: null.
  const preFeatureCommit = "d".repeat(40);
  await env.CACHE.put(`landing:${preFeatureCommit}`, JSON.stringify({
    landed: { repos: ["agent-1"], commit: preFeatureCommit, files: [], at: "2026-10-01T00:00:00.000Z" },
    evidence: { repos: ["agent-1"], commit: preFeatureCommit },
  }));
  const preRec = await readLanding(env, preFeatureCommit);
  check("7f pre-feature record reads attestation: null (typed-absent)", preRec.status === 200 && preRec.body?.attestation === null, JSON.stringify(preRec.body));
}

// ===========================================================================
// Group 8 — Verifier fail-closed (malformed inputs → false, never throw)
// ===========================================================================
{
  const { publicKeyB64url } = await makeKeyPair();
  const cases = [
    ["null", null],
    ["a string", "signed"],
    ["an array", [{ status: "signed" }]],
    ["missing sig", { status: "signed", v: 1, algo: ATTEST_ALGO, keyId: "k".repeat(16), at: "2026-10-14T00:00:00.000Z", subject: { commit: "a".repeat(40), repos: [] }, environment: {}, evidence: { commit: "a".repeat(40), repos: [] } }],
    ["algo mismatch", { status: "signed", v: 1, algo: "HS256", keyId: "k".repeat(16), at: "2026-10-14T00:00:00.000Z", sig: "s", subject: { commit: "a".repeat(40), repos: [] }, environment: {}, evidence: { commit: "a".repeat(40), repos: [] } }],
    ["wrong signature length", { status: "signed", v: 1, algo: ATTEST_ALGO, keyId: "k".repeat(16), at: "2026-10-14T00:00:00.000Z", sig: b64url(new Uint8Array(32)), subject: { commit: "a".repeat(40), repos: [] }, environment: {}, evidence: { commit: "a".repeat(40), repos: [] } }],
    ["subject/evidence commit mismatch (internal-consistency law)", { status: "signed", v: 1, algo: ATTEST_ALGO, keyId: "k".repeat(16), at: "2026-10-14T00:00:00.000Z", sig: b64url(new Uint8Array(64)), subject: { commit: "a".repeat(40), repos: [] }, environment: {}, evidence: { commit: "b".repeat(40), repos: [] } }],
  ];
  for (const [label, input] of cases) {
    let threw = false;
    let result = false;
    try {
      result = await verifyAttestation(input, publicKeyB64url);
    } catch {
      threw = true;
    }
    check(`8 ${label} → false, never a throw`, result === false && !threw, `result=${result} threw=${threw}`);
  }
}

// ===========================================================================
// Group 9 — Cross-copy tamper detection
// ===========================================================================
{
  const { env, r2, keys } = await makeEnvironment();
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  const commit = r.body?.landed?.commit;
  const served = r.body?.attestation;
  const r2Key = `${EVIDENCE_KEY_PREFIX}${commit}.json`;
  const stored = r2._store.get(r2Key);
  check("9 setup: the R2 copy exists", typeof stored === "object" || typeof stored === "string" ? true : false, String(typeof stored));
  if (stored) {
    // Tamper the R2 copy while the served copy is intact.
    const tampered = JSON.parse(new TextDecoder().decode(stored));
    tampered.environment = { ...tampered.environment, deploy: "tampered" };
    r2._store.set(r2Key, new TextEncoder().encode(JSON.stringify(tampered)));
    const r2Bytes = r2._store.get(r2Key);
    const r2Copy = JSON.parse(new TextDecoder().decode(r2Bytes));
    check("9a tampered R2 copy differs from the served copy", !deepEqual(r2Copy, served), "R2 copy === served (tamper did not land)");
    // And the served copy still verifies (the tamper is only in R2).
    check("9b the served copy still verifies", await verifyAttestation(served, keys.publicKeyB64url) === true);
    // Restore, then tamper the served copy instead (the read surface
    // serves the KV record — corrupt the KV record and observe the
    // served copy diverges from the intact R2 copy).
    r2._store.set(r2Key, stored);
    const kvRecord = JSON.parse(env.CACHE._store.get(`landing:${commit}`));
    kvRecord.attestation.environment = { ...kvRecord.attestation.environment, deploy: "tampered-served" };
    env.CACHE._store.set(`landing:${commit}`, JSON.stringify(kvRecord));
    const rec = await readLanding(env, commit);
    check("9c the tampered served copy differs from the intact R2 copy", !deepEqual(rec.body?.attestation, JSON.parse(new TextDecoder().decode(r2._store.get(r2Key)))), "served === R2 (served tamper did not land)");
    // The tampered served copy FAILS verification (the acceptance leg).
    check("9d the tampered served copy fails verification", await verifyAttestation(rec.body?.attestation, keys.publicKeyB64url) === false);
    // The intact R2 copy still verifies.
    const r2Att = JSON.parse(new TextDecoder().decode(r2._store.get(r2Key)));
    check("9e the intact R2 copy still verifies", await verifyAttestation(r2Att, keys.publicKeyB64url) === true);
  }
}

// ===========================================================================
// Group 10 — readAttestation fail-closed R2 read (the AD-6 port surface)
// ===========================================================================
{
  const { env, keys } = await makeEnvironment();
  const r = await land(env, { base: "demo", repos: ["agent-1"], baseRef: "main", ref: "main" });
  const commit = r.body?.landed?.commit;
  const stored = await readAttestation(env, commit);
  check("10a stored R2 copy reads back", stored !== null && deepEqual(stored, r.body?.attestation), JSON.stringify(stored));
  check("10b absent key → null", await readAttestation(env, "e".repeat(40)) === null);
  const bigKey = `${EVIDENCE_KEY_PREFIX}${"f".repeat(40)}.json`;
  env.EVIDENCE_BLOB._store.set(bigKey, new Uint8Array(EVIDENCE_MAX_BYTES + 1));
  check("10c oversized body → null", await readAttestation(env, "f".repeat(40)) === null);
  env.EVIDENCE_BLOB._store.set(`${EVIDENCE_KEY_PREFIX}${"1".repeat(40)}.json`, new TextEncoder().encode("[1,2,3]"));
  check("10d non-object body → null", await readAttestation(env, "1".repeat(40)) === null);
  env.EVIDENCE_BLOB._store.set(`${EVIDENCE_KEY_PREFIX}${"2".repeat(40)}.json`, new TextEncoder().encode('{"v":1}'));
  check("10e missing status → null", await readAttestation(env, "2".repeat(40)) === null);
  env.EVIDENCE_BLOB._store.set(`${EVIDENCE_KEY_PREFIX}${"3".repeat(40)}.json`, new TextEncoder().encode("{not json"));
  let threw = false;
  let malformed = "sentinel";
  try { malformed = await readAttestation(env, "3".repeat(40)); } catch { threw = true; }
  check("10f malformed JSON → null, never throws", malformed === null && !threw, `malformed=${String(malformed)} threw=${threw}`);
}

console.log(fails === 0 ? `ALL PASS` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
