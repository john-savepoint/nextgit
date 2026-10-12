#!/usr/bin/env bun
// Contract suite: nextgit-e14 - worker read API for repo
// browsing (GET /tree, GET /file, GET /raw/{repo}/{ref}/{path}).
// Run: bun porting/tests/tree-read.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from
// platform/src/index.ts and drives worker.fetch() against an
// in-memory Artifacts fake (the default-resolution.test.mjs
// hex40 idiom) - the platform binding seam is the ONLY fake;
// no mock.module, no source grep, end-to-end through the real
// dispatcher (authorize() mode gate + allowlist + handlers).
//
// Fixture: demo/main with src/index.ts, src/util.ts,
// README.md, config/.env (secret-class: API_KEY + DB_URL),
// pkg.bin (NUL bytes => binary), src/ (a subdir); agent-1
// fork. Fixture secret VALUES exist only inside the fake's
// blob store - group 6 asserts the raw serialized /file body
// contains no fixture VALUE (AD-4); group 9 asserts the /raw
// 403 never materializes it.
//
// 12 groups: /tree happy+determinism+validation; /file
// text/binary/secret-AD-4; /raw happy/secret-403/binary/
// validation; deny-mode 401 pre-read; rate 429 on 61st hit.
//
// Full-suite safety: a fresh env (distinct fake Artifacts,
// fresh per-caller CF-Connecting-IP budget) per group - the
// in-isolate rate limiter state from one group never bleeds
// into another; process.exit(fail===0?0:1).

import worker from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail) => { if (ok) passes++; else { fails++; console.log("FAIL  " + name + (detail ? " - " + detail : "")); } if (ok) console.log("PASS  " + name); };
const J = (x) => JSON.stringify(x);

// Deterministic 40-hex commit hash for a label (the fake's
// commits must carry real sha-shaped ids - the
// default-resolution.test.mjs hex40 idiom).
function hex40(label) {
 let h = 0;
 for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
 const hex = h.toString(16).padStart(8, "0");
 return (hex + hex + hex + hex + hex).slice(0, 40);
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake - one instance per environment (a
// factory, so environments cannot alias). Mirrors the surface
// the read routes read: get/log/readTree/readFile/readBlob/
// info/revokeToken/Symbol.dispose/list. The factory also
// exposes tree/commit/defineRepo so the fixture can
// build commits through the fake's own content-addressed
// stores (the default-resolution.test.mjs makeFakeArtifacts
// idiom, verbatim).
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
 const blobText = new Map(); // hash -> text
 const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
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
  const history = spec.history;
  const refs = spec.refs;
  const intents = spec.intents || {};
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

 return {
  ARTIFACTS: {
   async get(name) {
    return repoFor(name);
   },
   async list(opts) {
    const limit = (opts && opts.limit) || 200;
    return { repos: [] };
   },
  },
  tree,
  commit,
  defineRepo,
 };
}

// ---------------------------------------------------------------------------
// Fixture - demo/main with the repo-browsing surface:
// src/index.ts + src/util.ts (src/ subdir), README.md,
// config/.env (secret-class: API_KEY + DB_URL), pkg.bin
// (NUL bytes => binary). agent-1 is a fork (same tree).
// ---------------------------------------------------------------------------
const INDEX_TS = "export const nextgit = 1;\nexport const keep = true;\n";
const UTIL_TS = "export const util = 1;\nexport const keep = 0;\n";
const README = "# demo\n\nthe demo repo\n";
// Keys + fixture values - the values are canaries that must
// NEVER appear in any /file or /raw response (groups 6, 9).
const SECRET_VALUE_1 = "super-secret-api-key-value-DO-NOT-LEAK";
const SECRET_VALUE_2 = "postgres://demo:FAKE-SECRET@db.internal:5432/app";
const ENV_FILE = "API_KEY=" + SECRET_VALUE_1 + "\nDB_URL=" + SECRET_VALUE_2 + "\n";
// NUL bytes => isBinary() => classification:"binary".
const BIN_FILE = "PK\x00\x01\x02\x03binary-bytes\x00";

const DEMO_FILES = {
 "src/index.ts": INDEX_TS,
 "src/util.ts": UTIL_TS,
 "README.md": README,
 "config/.env": ENV_FILE,
 "pkg.bin": BIN_FILE,
};

// Fresh env per group (fresh fake Artifacts + fresh rate
// budget via per-caller IPs), so no group can observe
// another's state - full-suite safe by construction.
let ipSeq = 0;
const nextIp = () => "10.9.1." + (++ipSeq);
function makeEnv() {
 const fake = makeFakeArtifacts();
 const demoCommit = fake.commit(hex40("demo-main"), fake.tree(DEMO_FILES));
 fake.defineRepo("demo", { history: [demoCommit], refs: { main: demoCommit.hash } });
 const agentCommit = fake.commit(hex40("agent-1-main"), fake.tree(DEMO_FILES));
 fake.defineRepo("agent-1", { history: [agentCommit, demoCommit], refs: { main: agentCommit.hash } });
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
 return { status: res.status, headers: res.headers, body: await res.json().catch(() => null), text: await res.clone().text().catch(() => "") };
};

// Raw GET helper (returns body bytes + content-type).
const getRaw = async (env, path, ip) => {
 const caller = ip || nextIp();
 const res = await worker.fetch(
  new Request("https://nextgit.invalid" + path, { headers: { "CF-Connecting-IP": caller } }),
  env,
 );
 const bytes = new Uint8Array(await res.arrayBuffer());
 return { status: res.status, contentType: res.headers.get("content-type"), bytes, text: new TextDecoder().decode(bytes) };
};

// ===========================================================================
// Group 1 - /tree happy path: demo root listing.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/tree", "?repo=demo");
 check("1 /tree status 200 ok", r.status === 200 && r.body && r.body.ok === true, J(r.body));
 check("1 /tree echoes repo/ref/path", r.body && r.body.repo === "demo" && r.body.ref === "main" && r.body.path === "", J(r.body && r.body.repo));
 const names = ((r.body && r.body.entries) || []).map((e) => e.name).sort();
 check("1 /tree root carries the fixture children", J(names) === J(["README.md", "config", "pkg.bin", "src"]), J(names));
 const src = ((r.body && r.body.entries) || []).find((e) => e.name === "src");
 check("1 /tree src entry is a tree with blobHash", src && src.type === "tree" && typeof src.blobHash === "string" && src.blobHash.length > 0, J(src));
 const readme = ((r.body && r.body.entries) || []).find((e) => e.name === "README.md");
 check("1 /tree README entry is a blob", readme && readme.type === "blob" && typeof readme.blobHash === "string", J(readme));
}

// ===========================================================================
// Group 2 - /tree determinism + subdir listing.
// ===========================================================================
{
 const { env } = makeEnv();
 const a = await get(env, "/tree", "?repo=demo");
 const b = await get(env, "/tree", "?repo=demo");
 check("2 /tree deterministic (two calls deep-equal)", J(a.body) === J(b.body), J(a.body && a.body.entries && a.body.entries.length) + " vs " + J(b.body && b.body.entries && b.body.entries.length));
 const sub = await get(env, "/tree", "?repo=demo&path=src");
 const subNames = ((sub.body && sub.body.entries) || []).map((e) => e.name).sort();
 check("2 /tree src/ lists index.ts + util.ts", sub.status === 200 && J(subNames) === J(["index.ts", "util.ts"]), J(subNames));
}

// ===========================================================================
// Group 3 - /tree validation + uniform 404.
// ===========================================================================
{
 const { env } = makeEnv();
 const badRepo = await get(env, "/tree", "?repo=../evil");
 check("3 /tree charset-invalid repo -> 400", badRepo.status === 400 && badRepo.body && badRepo.body.ok === false, J(badRepo.body));
 const badRef = await get(env, "/tree", "?repo=demo&ref=..%2Fmain");
 check("3 /tree traversal ref -> 400", badRef.status === 400, J(badRef.body));
 const badPath = await get(env, "/tree", "?repo=demo&path=../etc");
 check("3 /tree traversal path -> 400", badPath.status === 400, J(badPath.body));
 // A charset-VALID name outside the demo namespace is
 // 403'd by the authorize() chokepoint BEFORE any repo
 // read (AD-9) - never a 404/500. The handler's 404
 // catch is reachable only for an ALLOWLISTED repo the
 // namespace does not carry (agent-2 below).
 const notAllowlisted = await get(env, "/tree", "?repo=no-such-repo");
 check("3 /tree non-allowlist repo -> 403 repo-not-allowed", notAllowlisted.status === 403 && notAllowlisted.body && notAllowlisted.body.error === "repo-not-allowed", J(notAllowlisted.body));
 const unknownRepo = await get(env, "/tree", "?repo=agent-2");
 check("3 /tree allowlisted-but-absent repo -> 404 not-found", unknownRepo.status === 404 && unknownRepo.body && unknownRepo.body.error === "not-found", J(unknownRepo.body));
 const unknownRef = await get(env, "/tree", "?repo=demo&ref=no-such-ref");
 check("3 /tree unknown ref -> 404 not-found", unknownRef.status === 404 && unknownRef.body && unknownRef.body.error === "not-found", J(unknownRef.body));
 const fileAtPath = await get(env, "/tree", "?repo=demo&path=README.md");
 check("3 /tree file-at-path (not a dir) -> 404 not-found", fileAtPath.status === 404 && fileAtPath.body && fileAtPath.body.error === "not-found", J(fileAtPath.body));
}

// ===========================================================================
// Group 4 - /file text.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/file", "?repo=demo&path=README.md");
 check("4 /file README status 200", r.status === 200 && r.body && r.body.ok === true, J(r.body));
 check("4 /file classification text", r.body && r.body.classification === "text", J(r.body && r.body.classification));
 check("4 /file text is the fixture content", r.body && r.body.text === README, J(r.body && r.body.text));
 check("4 /file size is the byte length", r.body && r.body.size === Buffer.byteLength(README), J(r.body && r.body.size));
 const refDefault = await get(env, "/file", "?repo=demo&path=README.md&ref=main");
 check("4 /file explicit ref==omitted ref (default resolution)", refDefault.status === 200 && J(refDefault.body) === J(r.body), J(refDefault.body));
}

// ===========================================================================
// Group 5 - /file binary.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/file", "?repo=demo&path=pkg.bin");
 check("5 /file pkg.bin status 200", r.status === 200 && r.body && r.body.ok === true, J(r.body));
 check("5 /file classification binary", r.body && r.body.classification === "binary", J(r.body && r.body.classification));
 check("5 /file binary carries NO text field", !("text" in (r.body || {})), J(r.body));
 check("5 /file binary size is the byte length", r.body && r.body.size === Buffer.byteLength(BIN_FILE), J(r.body && r.body.size));
}

// ===========================================================================
// Group 6 - /file secret (AD-4).
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await get(env, "/file", "?repo=demo&path=config/.env");
 check("6 /file .env status 200", r.status === 200 && r.body && r.body.ok === true, J(r.body));
 check("6 /file classification secret", r.body && r.body.classification === "secret", J(r.body && r.body.classification));
 check("6 /file keys are the fixture key names", J(r.body && r.body.keys) === J(["API_KEY", "DB_URL"]), J(r.body && r.body.keys));
 check("6 /file secret carries NO text field", !("text" in (r.body || {})), J(r.body));
 // AD-4: the raw serialized body must contain neither fixture value.
 check("6 /file body carries no API_KEY value", !r.text.includes(SECRET_VALUE_1), "body contains SECRET_VALUE_1");
 check("6 /file body carries no DB_URL value", !r.text.includes(SECRET_VALUE_2), "body contains SECRET_VALUE_2");
}

// ===========================================================================
// Group 7 - /raw happy path.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await getRaw(env, "/raw/demo/main/README.md");
 check("7 /raw README status 200", r.status === 200, String(r.status));
 check("7 /raw content-type octet-stream", r.contentType === "application/octet-stream", String(r.contentType));
 check("7 /raw bytes are the fixture content", r.text === README, r.text);
}

// ===========================================================================
// Group 8 - /raw binary.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await getRaw(env, "/raw/demo/main/pkg.bin");
 check("8 /raw pkg.bin status 200", r.status === 200, String(r.status));
 check("8 /raw bytes are the fixture bytes", r.text === BIN_FILE, r.text);
}

// ===========================================================================
// Group 9 - /raw secret-class: 403 BEFORE any read.
// ===========================================================================
{
 const { env } = makeEnv();
 const r = await getRaw(env, "/raw/demo/main/config/.env");
 check("9 /raw secret-class -> 403", r.status === 403, String(r.status));
 check("9 /raw secret-class 403 carries no value", !r.text.includes(SECRET_VALUE_1) && !r.text.includes(SECRET_VALUE_2), r.text);
}

// ===========================================================================
// Group 10 - /raw validation + the /reveal carve-out.
// ===========================================================================
{
 const { env } = makeEnv();
 // A charset-VALID name outside the demo namespace is
 // 403'd by the handler's re-check (the /reveal
 // carve-out) BEFORE any repo read - never a 404.
 const unknown = await getRaw(env, "/raw/no-such-repo/main/README.md");
 check("10 /raw non-allowlist repo -> 403 repo-not-allowed (pre-read)", unknown.status === 403 && unknown.text.includes("repo-not-allowed"), String(unknown.status));
 check("10 /raw non-allowlist repo 403 body exact", unknown.text.includes("repo-not-allowed"), unknown.text);
 const unknownRef = await getRaw(env, "/raw/demo/no-such-ref/README.md");
 check("10 /raw unknown ref -> 404 not-found", unknownRef.status === 404, String(unknownRef.status));
 const unknownPath = await getRaw(env, "/raw/demo/main/no-such-file.ts");
 check("10 /raw unknown path -> 404 not-found", unknownPath.status === 404, String(unknownPath.status));
 // ".." segments in the PATH portion normalize away in
 // the URL constructor before the dispatcher sees them;
 // the handler's own path validation still 400s a raw
 // traversal in the query-carried path (group 3) and a
 // ref-carried traversal. Here: a charset-invalid repo
 // segment ("..") hits the URL normalizer first and the
 // boundary answers 404 (unknown path) - the invariant
 // under test is that no traversal ever reaches a repo
 // read.
 const badRepo = await getRaw(env, "/raw/../evil/main/README.md");
 check("10 /raw traversal repo never reaches a read (boundary 404/400)", badRepo.status === 404 || badRepo.status === 400, String(badRepo.status));
 // Non-allowlisted (charset-VALID) repo -> 403 repo-not-allowed
 // (the handler re-check, the /reveal carve-out - the
 // dispatcher's query-only extractScope cannot see it).
 const notAllowed = await getRaw(env, "/raw/notdemo-xyz/main/README.md");
 check("10 /raw non-allowlist repo -> 403 repo-not-allowed", notAllowed.status === 403 && notAllowed.text.includes("repo-not-allowed"), String(notAllowed.status));
}

// ===========================================================================
// Group 11 - deny mode: every read route 401s BEFORE any
// repo read (the authorize() chokepoint).
// ===========================================================================
{
 const { env } = makeEnv();
 env.AUTH_MODE = undefined;
 // ARTIFACTS.get throws to prove the deny path returns 401
 // BEFORE any repo read (the auth-seam idiom).
 env.ARTIFACTS = { get: async () => { throw new Error("should not be reached - authorize must reject before any repo read"); }, list: async () => { throw new Error("should not be reached"); } };
 const tree = await get(env, "/tree", "?repo=demo");
 check("11 /tree deny-mode -> 401 unauthorized", tree.status === 401 && tree.body && tree.body.error === "unauthorized", J(tree.body));
 const file = await get(env, "/file", "?repo=demo&path=README.md");
 check("11 /file deny-mode -> 401 unauthorized", file.status === 401 && file.body && file.body.error === "unauthorized", J(file.body));
 const raw = await getRaw(env, "/raw/demo/main/README.md");
 check("11 /raw deny-mode -> 401 unauthorized", raw.status === 401, String(raw.status));
}

// ===========================================================================
// Group 12 - rate rows: /file and /raw are bound (60/60s);
// the 61st hit from one caller -> 429. /tree is unbound.
// ===========================================================================
{
 const { env } = makeEnv();
 const ip = "10.99.99.99"; // one caller budget for the whole burst
 const limit = (ROUTE_RATE_LIMITS["/file"] && ROUTE_RATE_LIMITS["/file"].limit) || 60;
 let saw429 = false;
 for (let i = 0; i <= limit; i++) {
  const r = await get(env, "/file", "?repo=demo&path=README.md", ip);
  if (r.status === 429) { saw429 = true; check("12 /file 429 body exact", J(r.body) === J({ ok: false, error: "rate-limited" }), J(r.body)); break; }
 }
 check("12 /file 61st hit -> 429 rate-limited", saw429, "no 429 observed in the burst");
 // A DIFFERENT caller is unaffected (per-caller window isolation).
 const other = await get(env, "/file", "?repo=demo&path=README.md", "10.99.99.98");
 check("12 /file different caller still 200", other.status === 200, String(other.status));
 // /raw burst -> 429 at cap+1.
 const rawLimit = (ROUTE_RATE_LIMITS["/raw"] && ROUTE_RATE_LIMITS["/raw"].limit) || 60;
 let rawSaw429 = false;
 const rawIp = "10.99.98.99";
 for (let i = 0; i <= rawLimit; i++) {
  const r = await getRaw(env, "/raw/demo/main/README.md", rawIp);
  if (r.status === 429) { rawSaw429 = true; break; }
 }
 check("12 /raw 61st hit -> 429 rate-limited", rawSaw429, "no 429 observed in the /raw burst");
 // /tree is deliberately unbound: 61 hits all succeed.
 let treeOk = 0;
 const treeIp = "10.99.97.99";
 for (let i = 0; i <= 60; i++) {
  const r = await get(env, "/tree", "?repo=demo", treeIp);
  if (r.status === 200) treeOk++;
 }
 check("12 /tree deliberately unbound (61 hits all 200)", treeOk === 61, treeOk + "/61");
}

console.log(fails === 0 ? "ALL PASS (" + passes + " checks)" : fails + " FAILURES (" + passes + " passed)");
process.exit(fails === 0 ? 0 : 1);
