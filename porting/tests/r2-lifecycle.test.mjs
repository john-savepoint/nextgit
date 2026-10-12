#!/usr/bin/env bun
// Contract suite (the ORDER's focused check): nextgit-e12-impl-
// lifecycle-safe-deletes-no-orphans — "Delete asset pointers
// lifecycle-safely with bucket rules and no orphan blobs".
//
// Run: bun porting/tests/r2-lifecycle.test.mjs   (exit 0 = pass)
//
// Altitude: this suite pins the ORDER's acceptance legs at the
// artifact/rule/CLI altitude. The end-to-end land wiring (a real
// push through the real worker, then the post-push GC) is proven
// by porting/tests/asset-gc.test.mjs; the sweep's full REST seam
// and exit-code matrix by porting/tests/r2-orphan-sweep.test.mjs.
// Here we prove the legs the order names, without a git server:
//
//   Leg 4 — the committed bucket lifecycle rules
//           (platform/r2-lifecycle.json + the documented apply
//           command).
//   Leg 1 — a pointer whose only reference is removed drops out
//           of the manifest union -> blob deleted.
//   Leg 2 — a blob still referenced by ANY repo/path survives.
//   NFR-1 — no request path performs an unbounded bucket scan
//           (the delete seam's binding has no `list` at all).
//   Leg 3 — an old orphan is deleted (audit then zero); a fresh
//           orphan is reported but NOT deleted; the grace boundary
//           is exact; the CLI's usage error exits 2.
//
// No mock.module, no source grep, no network; full-suite safe.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { collectReferencedBlobIds, deleteUnreferenced, refcount } from "../../platform/src/asset-gc.ts";
import { assetPointerFor } from "../../platform/src/assets.ts";
import { planSweep } from "../../platform/scripts/r2-orphan-sweep.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DAY = 86400e3;
const NOW = 1_800_000_000_000;

let fails = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
 if (!ok) fails++;
 else passes++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Leg 4 — the committed lifecycle rule + its documentation.
// ---------------------------------------------------------------------------
{
 const rulePath = join(ROOT, "platform/r2-lifecycle.json");
 let doc = null;
 try {
  doc = JSON.parse(readFileSync(rulePath, "utf8"));
 } catch (e) {
  check("4a platform/r2-lifecycle.json parses", false, String(e?.message ?? e));
 }
 if (doc) {
  const rule = doc.rules?.[0];
  check("4a exactly one committed rule", Array.isArray(doc.rules) && doc.rules.length === 1, JSON.stringify(doc.rules));
  check("4b the rule is the expire-orphaned-asset-blobs rule, enabled, all prefixes", rule?.name === "expire-orphaned-asset-blobs" && rule?.enabled === true && rule?.conditions?.prefix === "", JSON.stringify(rule));
  const cond = rule?.deleteObjectsTransition?.condition;
  check("4c the rule expires objects by Age at 90 days (7,776,000 s)", cond?.type === "Age" && cond?.maxAge === 7776000, JSON.stringify(cond));
  check("4d the lifecycle layer is later than any sweep grace window (90d > 7d)", cond?.maxAge > 7 * 86400, String(cond?.maxAge));
 }
 const readme = readFileSync(join(ROOT, "platform/scripts/README.md"), "utf8");
 check("4e the runbook names the bucket + the committed rule file", readme.includes("nextgit-asset-blobs") && readme.includes("r2-lifecycle.json"), "readme missing the bucket/rule reference");
 check("4f the runbook documents the apply + list commands", readme.includes("wrangler r2 bucket lifecycle set") && readme.includes("wrangler r2 bucket lifecycle list"), "readme missing the lifecycle commands");
 check("4g the runbook documents the 90-day expiry semantics", /90 days/.test(readme), "readme missing the 90-day semantics");
}

// ---------------------------------------------------------------------------
// A minimal Artifacts fake: repos with a default-branch tree.
// ---------------------------------------------------------------------------
function makeArtifacts({ repos }) {
 const blobByPath = new Map(); // `${repo}:${path}` -> pointer text
 for (const [repo, paths] of Object.entries(repos)) {
  for (const [path, text] of Object.entries(paths)) blobByPath.set(`${repo}:${path}`, text);
 }
 const repoOf = (name) => ({
  async log() {
   return [{ hash: `sha-${name}`, treeHash: `tree-${name}` }];
  },
  async readTree(hash) {
   const owner = hash.slice("tree-".length);
   return Object.keys(repos[owner] ?? {}).map((path) => ({ name: path, mode: "100644", hash: `blob:${owner}:${path}`, type: "blob" }));
  },
  async readBlob(hash) {
   const [, owner, ...rest] = hash.split(":");
   const text = blobByPath.get(`${owner}:${rest.join(":")}`);
   return text === undefined ? null : new Blob([text]);
  },
  async info() {
   return { remote: "http://unused.invalid" };
  },
  [Symbol.dispose]() { },
 });
 return {
  list: async () => ({ repos: Object.keys(repos).map((name) => ({ name, status: "ready", defaultBranch: "main" })) }),
  get: async (name) => repoOf(name),
 };
}

const BLOB_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const POINTER = await assetPointerFor(BLOB_BYTES, "application/octet-stream");
const POINTER_TEXT = `${JSON.stringify(POINTER, null, 2)}\n`;

/** An ASSET_BLOB stub with NO `list` method — an unbounded bucket scan is
 * impossible on this path (NFR-1): a stray `list()` call would throw. */
function makeBucket() {
 const store = new Map([[POINTER.blobId, BLOB_BYTES]]);
 const deletes = [];
 return {
  store,
  deletes,
  blob: {
   async get(key) {
    const bytes = store.get(key);
    return bytes ? { body: new Blob([bytes]), httpMetadata: {} } : null;
   },
   async delete(key) {
    deletes.push(key);
    store.delete(key);
   },
  },
 };
}

// ---------------------------------------------------------------------------
// Leg 1 / Leg 2 / NFR-1 — the reference-count rule.
// ---------------------------------------------------------------------------
{
 // The base carries the pointer; no other repo does (leg 1).
 const onlyBase = makeArtifacts({ repos: { demo: { "assets/hero.asset.json": POINTER_TEXT }, "agent-1": { "src/a.ts": "x" } } });
 const union1 = await collectReferencedBlobIds({ ARTIFACTS: onlyBase });
 check("1a the union is manifest-derived (contains the pointer's blob)", union1.has(POINTER.blobId), JSON.stringify([...union1]));
 check("1b refcount is 1 while the pointer survives", refcount(POINTER.blobId, union1) === 1, String(refcount(POINTER.blobId, union1)));
 // The pointer is removed from every manifest -> union empty -> the blob
 // has refcount zero and the seam deletes it.
 const dropped = makeArtifacts({ repos: { demo: { "src/a.ts": "x" }, "agent-1": { "src/a.ts": "x" } } });
 const union0 = await collectReferencedBlobIds({ ARTIFACTS: dropped });
 check("1c the removed pointer drops out of the union", union0.size === 0, JSON.stringify([...union0]));
 check("1d refcount is 0 once no manifest references the blob", refcount(POINTER.blobId, union0) === 0, String(refcount(POINTER.blobId, union0)));
 const bucket1 = makeBucket();
 const outcome1 = await deleteUnreferenced({ ASSET_BLOB: bucket1.blob }, POINTER.blobId, union0);
 check("1e the zero-reference blob is deleted", outcome1 === "deleted" && !bucket1.store.has(POINTER.blobId), JSON.stringify({ outcome1, keys: [...bucket1.store.keys()] }));

 // Leg 2: a SECOND repo still carries the pointer -> the blob survives.
 const shared = makeArtifacts({ repos: { demo: { "assets/hero.asset.json": POINTER_TEXT }, "agent-2": { "assets/b.asset.json": POINTER_TEXT } } });
 const unionShared = await collectReferencedBlobIds({ ARTIFACTS: shared });
 check("2a a second repo's pointer keeps the blob in the union", unionShared.has(POINTER.blobId), JSON.stringify([...unionShared]));
 check("2b refcount is 1 for the shared blob", refcount(POINTER.blobId, unionShared) === 1, String(refcount(POINTER.blobId, unionShared)));
 const bucket2 = makeBucket();
 const outcome2 = await deleteUnreferenced({ ASSET_BLOB: bucket2.blob }, POINTER.blobId, unionShared);
 check("2c the shared blob is retained, never deleted", outcome2 === "retained" && bucket2.store.has(POINTER.blobId) && bucket2.deletes.length === 0, JSON.stringify({ outcome2, deletes: bucket2.deletes }));

 // NFR-1: the union walk touches only the repo-discovery surface
 // (ONE bounded listing + one get per repo); never the bucket. The
 // delete seam's bucket binding has no list() at all.
 const counting = makeArtifacts({ repos: { demo: { "assets/hero.asset.json": POINTER_TEXT }, "agent-1": { "src/a.ts": "x" } } });
 const counts = { list: 0, get: 0 };
 await collectReferencedBlobIds({ ARTIFACTS: { list: async (o) => (counts.list++, counting.list(o)), get: async (n) => (counts.get++, counting.get(n)) } });
 check("nfr1a the union walk performs one bounded repo listing + one get per repo", counts.list === 1 && counts.get === 2, JSON.stringify(counts));
 check("nfr1b the bucket binding has no list() — an unbounded bucket scan is impossible on this path", typeof bucket1.blob.list === "undefined", typeof bucket1.blob.list);
}

// ---------------------------------------------------------------------------
// Leg 3 — the orphan sweep's plan + CLI contract.
// ---------------------------------------------------------------------------
{
 const graceMs = 7 * DAY;
 const oldOrphan = planSweep({ bucketKeys: [{ name: "blobOld", uploadedAt: NOW - 10 * DAY }], manifests: [], nowMs: NOW, graceMs });
 check("3a an old orphan is deletable", oldOrphan.toDelete.includes("blobOld") && oldOrphan.toReport[0].outcome === "deleted", JSON.stringify(oldOrphan));
 // A post-sweep audit over the (now empty) bucket reports zero.
 const postAudit = planSweep({ bucketKeys: [], manifests: [], nowMs: NOW, graceMs });
 check("3b the follow-up audit reports zero orphans", postAudit.toReport.length === 0 && postAudit.toDelete.length === 0, JSON.stringify(postAudit));

 const freshOrphan = planSweep({ bucketKeys: [{ name: "blobFresh", uploadedAt: NOW - 1 * DAY }], manifests: [], nowMs: NOW, graceMs });
 check("3c a fresh orphan is reported, not deleted", freshOrphan.toReport.length === 1 && freshOrphan.toReport[0].outcome === "grace" && freshOrphan.toDelete.length === 0, JSON.stringify(freshOrphan));

 const boundary = planSweep({ bucketKeys: [{ name: "exact", uploadedAt: NOW - graceMs }], manifests: [], nowMs: NOW, graceMs });
 const inside = planSweep({ bucketKeys: [{ name: "inside", uploadedAt: NOW - graceMs + 1000 }], manifests: [], nowMs: NOW, graceMs });
 check("3d the grace boundary is exact (>= cutoff deletable, one second inside not)", boundary.toDelete.includes("exact") && inside.toDelete.length === 0, JSON.stringify({ boundary: boundary.toDelete, inside: inside.toDelete }));

 const referenced = planSweep({ bucketKeys: [{ name: "blobA", uploadedAt: NOW - 90 * DAY }, { name: "blobB", uploadedAt: NOW - 90 * DAY }], manifests: ["blobA"], nowMs: NOW, graceMs });
 check("3e a referenced key is never an orphan", !referenced.toReport.some((r) => r.key === "blobA") && referenced.toDelete.includes("blobB"), JSON.stringify(referenced));

 const badFlag = spawnSync("bun", [join(ROOT, "platform/scripts/r2-orphan-sweep.mjs"), "--nope"], { cwd: ROOT, encoding: "utf8" });
 check("3f a usage error exits 2", badFlag.status === 2, `status ${badFlag.status}`);
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
