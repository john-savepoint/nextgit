#!/usr/bin/env bun
// Contract suite for the R2 asset tier (AD-10; FR-47) — the
// nextgit-r2-asset-tier-manifest-format order's check.
//
// Run: bun porting/tests/r2-asset-tier.test.mjs   (exit 0 = pass)
//
// Idiom: judge.test.mjs — the real worker module is imported and
// exercised through worker.fetch with an in-memory Artifacts fake
// and a stubbed ASSET_BLOB binding (the platform binding seam is
// the only thing stubbed; no mock.module, no source grep; exit 0
// = pass; full-suite safe, no network).
//
// Groups (each defends an observable contract):
//   1. Format parse — pure, direct import of assets.ts
//   2. Round-trip — upload → pointer visible in /changes
//   3. /changes shows metadata-only (no patch/texts/stats)
//   4. /merge renders the pointer row (no merged text)
//   5. Hostile pointer (NUL bytes) still classifies
//   6. Unparseable pointer → visible note, never a 500
//   7. Invariance — non-pointer repos unchanged

import worker from "../../platform/src/index.ts";
import {
  ASSET_POINTER_VERSION,
  MAX_POINTER_CHARS,
  isAssetPointer,
  parseAssetPointer,
  assetPointerFor,
} from "../../platform/src/assets.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (only the surface the read paths touch).
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

// Stubbed ASSET_BLOB — in-memory R2 (the platform binding seam
// is the only thing stubbed). get(key) returns a
// { body, httpMetadata }-shaped object, the binding's shape.
const r2Store = new Map(); // key -> Uint8Array
const ASSET_BLOB = {
  async get(key) {
    const bytes = r2Store.get(key);
    if (!bytes) return null;
    return { body: new Blob([bytes]), httpMetadata: {} };
  },
  async put(key, value) {
    r2Store.set(key, new Uint8Array(await value.arrayBuffer()));
  },
};

// --- fixture repos -----------------------------------------------------------

const BASE_FILES = { "src/a.ts": "export const a = 1;\nexport const keep = true;\n" };

const c1 = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

// A real asset: blob bytes content-addressed into the stubbed
// R2, a pointer file committed into the proposal repo.
const ASSET_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const ASSET_POINTER = await assetPointerFor(ASSET_BYTES, "application/octet-stream");
r2Store.set(ASSET_POINTER.blobId, ASSET_BYTES);

// The pointer file's text (what git carries).
const POINTER_TEXT = `${JSON.stringify(ASSET_POINTER, null, 2)}\n`;
const PROPOSAL_FILES = {
  ...BASE_FILES,
  "assets/hero.asset.json": POINTER_TEXT,
  "src/b.ts": "export const b = 2;\n",
};
const c2 = commit("c-agent-1", tree(PROPOSAL_FILES));
defineRepo("agent-1", { history: [c2, c1], refs: { main: c2.hash }, intents: { [c2.hash]: "Add the hero asset and bump b." } });

// A hostile pointer with NUL bytes (must still classify as a
// pointer row, never be misread as binary and skipped).
const HOSTILE_POINTER = `{ "v": 1, "blobId": "${"a".repeat(64)}", "sha256": "${"b".repeat(64)}", "size": 5 }\0\0\0`;
const c3 = commit("c-agent-2", tree({ ...BASE_FILES, "assets/hostile.asset.json": HOSTILE_POINTER }));
defineRepo("agent-2", { history: [c3, c1], refs: { main: c3.hash }, intents: { [c3.hash]: "Hostile pointer." } });

// An unparseable pointer (format violation — visible note, never a 500).
const BAD_POINTER = `{ "v": 2, "blobId": "x" }`;
const c4 = commit("c-agent-3", tree({ ...BASE_FILES, "assets/broken.asset.json": BAD_POINTER }));
defineRepo("agent-3", { history: [c4, c1], refs: { main: c4.hash }, intents: { [c4.hash]: "Broken pointer." } });

// A plain repo with no pointer files (invariance control).
const c5 = commit("c-agent-4", tree({ ...BASE_FILES, "src/c.ts": "export const c = 3;\n" }));
defineRepo("agent-4", { history: [c5, c1], refs: { main: c5.hash }, intents: { [c5.hash]: "Plain change." } });

// --- env -------------------------------------------------------------------

function envFor() {
  return {
    ARTIFACTS,
    LIVE: {},
    CACHE: {},
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    ASSET_BLOB,
    AUTH_MODE: "demo",
  };
}

async function get(path) {
  const res = await worker.fetch(new Request(`https://nextgit.test${path}`), envFor());
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 1. Format parse (pure, direct import of assets.ts)
// ---------------------------------------------------------------------------
{
  const good = parseAssetPointer(POINTER_TEXT);
  check("1a valid pointer parses to exact shape",
    good !== null && good.v === 1 && good.blobId === ASSET_POINTER.blobId && good.sha256 === ASSET_POINTER.sha256 && good.size === ASSET_POINTER.size && good.contentType === "application/octet-stream",
    JSON.stringify(good));
  check("1b isAssetPointer classifier", isAssetPointer("assets/hero.asset.json") && !isAssetPointer("assets/hero.json") && !isAssetPointer("src/a.ts"));
  check("1c assetPointerFor is content-addressed", (await assetPointerFor(ASSET_BYTES)).blobId === ASSET_POINTER.blobId);
  check("1d MAX_POINTER_CHARS is 1 MiB", MAX_POINTER_CHARS === 1_048_576 && ASSET_POINTER_VERSION === 1);

  const badV = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, v: 2 }));
  const badSha = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, sha256: "not-hex" }));
  const negSize = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, size: -1 }));
  const floatSize = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, size: 1.5 }));
  const missingSize = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, size: undefined }));
  const missingBlob = parseAssetPointer(JSON.stringify({ ...ASSET_POINTER, blobId: undefined }));
  const tooBig = parseAssetPointer(`{ "v": 1, "blobId": "k", "sha256": "${"a".repeat(64)}", "size": 1, "pad": "${"x".repeat(MAX_POINTER_CHARS)}" }`);
  const nonJson = parseAssetPointer("not json at all");
  const nonObj = parseAssetPointer("[1,2,3]");
  check("1e wrong v -> null", badV === null);
  check("1f non-hex-64 sha256 -> null", badSha === null);
  check("1g negative size -> null", negSize === null);
  check("1h float size -> null", floatSize === null);
  check("1i missing size -> null", missingSize === null);
  check("1j missing blobId -> null", missingBlob === null);
  check("1k JSON > 1 MiB -> null", tooBig === null);
  check("1l non-JSON text -> null", nonJson === null);
  check("1m non-object JSON -> null", nonObj === null);
}

// ---------------------------------------------------------------------------
// 2. Round-trip — upload -> pointer visible in /changes
// ---------------------------------------------------------------------------
{
  const { status, body } = await get("/changes?repo=agent-1&base=demo&ref=main&baseRef=main");
  check("2a /changes 200", status === 200 && body?.ok === true, JSON.stringify(body?.error ?? body));
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "assets/hero.asset.json");
  check("2b pointer row visible in /changes", row !== undefined, JSON.stringify(files.map((f) => f.path)));
  check("2c pointer row carries parsed asset", row?.asset?.v === 1 && row?.asset?.blobId === ASSET_POINTER.blobId && row?.asset?.sha256 === ASSET_POINTER.sha256 && row?.asset?.size === ASSET_POINTER.size, JSON.stringify(row?.asset));
  check("2d pointer row carries the metadata note", typeof row?.note === "string" && row.note.includes(ASSET_POINTER.blobId) && row.note.includes(`${ASSET_POINTER.size} bytes`), row?.note);
}

// ---------------------------------------------------------------------------
// 3. /changes shows metadata-only (no patch, no texts, no stats)
// ---------------------------------------------------------------------------
{
  const { body } = await get("/changes?repo=agent-1&base=demo&ref=main&baseRef=main");
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "assets/hero.asset.json");
  check("3a pointer row has no patch", row?.patch === undefined, JSON.stringify(row?.patch));
  check("3b pointer row has no additions/deletions", row?.additions === undefined && row?.deletions === undefined, JSON.stringify({ a: row?.additions, d: row?.deletions }));
  check("3c pointer row is not binary-flagged", row?.binary === undefined, JSON.stringify(row?.binary));
  check("3d pointer row has no secret flag", row?.secret === undefined, JSON.stringify(row?.secret));
  const stats = body?.changeSet?.stats;
  // src/b.ts is the only text diff: 1 file, +1 addition.
  check("3e stats exclude the pointer row", stats?.files === 2 && stats?.additions === 1 && stats?.deletions === 0, JSON.stringify(stats));
  check("3f pointer row absent from texts", body?.changeSet?.texts?.["assets/hero.asset.json"] === undefined, JSON.stringify(Object.keys(body?.changeSet?.texts ?? {})));
}

// ---------------------------------------------------------------------------
// 4. /merge renders the pointer row (no merged text)
// ---------------------------------------------------------------------------
{
  const { status, body } = await get("/merge?base=demo&repos=agent-1&ref=main&baseRef=main");
  check("4a /merge 200", status === 200 && body?.ok === true, JSON.stringify(body?.error ?? body));
  const files = body?.merge?.files ?? [];
  const row = files.find((f) => f.path === "assets/hero.asset.json");
  check("4b pointer row renders in merge", row !== undefined, JSON.stringify(files.map((f) => f.path)));
  check("4c pointer row result is merged with metadata-only note", row?.result === "merged" && row?.note === "asset pointer; metadata only", JSON.stringify(row));
  check("4d pointer row carries the parsed asset", row?.asset?.blobId === ASSET_POINTER.blobId && row?.asset?.sha256 === ASSET_POINTER.sha256, JSON.stringify(row?.asset));
  check("4e pointer row NEVER carries merged text", row?.merged === undefined, JSON.stringify(row?.merged));
  // The text file still merges with content — the seam is surgical.
  const bRow = files.find((f) => f.path === "src/b.ts");
  check("4f text row still merges normally", bRow?.result === "merged" && typeof bRow?.merged === "string" && bRow.merged.includes("export const b = 2"), JSON.stringify(bRow));
}

// ---------------------------------------------------------------------------
// 5. Hostile pointer (NUL bytes) still classifies as a pointer row
// ---------------------------------------------------------------------------
{
  const { status, body } = await get("/changes?repo=agent-2&base=demo&ref=main&baseRef=main");
  check("5a hostile pointer /changes 200 (not 500)", status === 200 && body?.ok === true, `status ${status}`);
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "assets/hostile.asset.json");
  check("5b hostile pointer row classifies (not binary-skipped)", row !== undefined && row?.binary === undefined, JSON.stringify(row));
  check("5c hostile pointer fails closed (NUL trailing -> unparseable)", row?.asset === undefined && row?.note === "asset pointer; unparseable metadata (format violation)", JSON.stringify(row?.note));
  check("5d hostile pointer renders a visible note (never silent)", typeof row?.note === "string" && row.note.length > 0, row?.note);
}

// ---------------------------------------------------------------------------
// 6. Unparseable pointer -> visible note, never a 500
// ---------------------------------------------------------------------------
{
  const { status, body } = await get("/changes?repo=agent-3&base=demo&ref=main&baseRef=main");
  check("6a unparseable pointer /changes 200 (not 500)", status === 200 && body?.ok === true, `status ${status}`);
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "assets/broken.asset.json");
  check("6b unparseable pointer row visible", row !== undefined, JSON.stringify(files.map((f) => f.path)));
  check("6c unparseable pointer carries the violation note", row?.note === "asset pointer; unparseable metadata (format violation)", row?.note);
  check("6d unparseable pointer carries no asset", row?.asset === undefined, JSON.stringify(row?.asset));
  const { status: mStatus, body: mBody } = await get("/merge?base=demo&repos=agent-3&ref=main&baseRef=main");
  const mRow = (mBody?.merge?.files ?? []).find((f) => f.path === "assets/broken.asset.json");
  check("6e unparseable pointer merge row renders metadata-only", mStatus === 200 && mRow?.result === "merged" && mRow?.merged === undefined, JSON.stringify(mRow));
}

// ---------------------------------------------------------------------------
// 7. Invariance — non-pointer repos unchanged
// ---------------------------------------------------------------------------
{
  const { status, body } = await get("/changes?repo=agent-4&base=demo&ref=main&baseRef=main");
  check("7a plain repo /changes 200", status === 200 && body?.ok === true);
  const files = body?.changeSet?.files ?? [];
  const row = files.find((f) => f.path === "src/c.ts");
  check("7b plain text row keeps full diff surface", row?.additions === 1 && row?.deletions === 0 && typeof row?.patch === "string" && row.patch.includes("export const c = 3"), JSON.stringify(row));
  check("7c plain text row has no asset field", row?.asset === undefined, JSON.stringify(row?.asset));
  const { status: mStatus, body: mBody } = await get("/merge?base=demo&repos=agent-4&ref=main&baseRef=main");
  const mRow = (mBody?.merge?.files ?? []).find((f) => f.path === "src/c.ts");
  check("7d plain text row still merges with content", mStatus === 200 && mRow?.result === "merged" && mRow?.merged?.includes("export const c = 3"), JSON.stringify(mRow));
  // /proposals carries the pointer on the file row too (CONTRACT).
  const { status: pStatus, body: pBody } = await get("/proposals?base=demo&repos=agent-1&ref=main&baseRef=main");
  const pRow = (pBody?.proposals?.[0]?.files ?? []).find((f) => f.path === "assets/hero.asset.json");
  check("7e /proposals carries the pointer on the file row", pStatus === 200 && pRow?.asset?.blobId === ASSET_POINTER.blobId && pRow?.note !== undefined, JSON.stringify(pRow));
}

// ---------------------------------------------------------------------------
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
