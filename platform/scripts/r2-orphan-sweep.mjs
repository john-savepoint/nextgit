#!/usr/bin/env node
// r2-orphan-sweep.mjs — out-of-band R2 asset-blob orphan audit
// + sweep (e12 lifecycle).
//
// The bucket-side complement to /land's reference-counted delete
// path (platform/src/asset-gc.ts). /land reclaims a removed
// pointer's blob at land time, only when the union of every
// repo's pointer manifests no longer references it. This script
// audits the WHOLE bucket against the same union, out-of-band:
//
//   1. List every key in the R2 bucket (account REST API,
//      cursor-paginated).
//   2. Walk every repo's default-branch tree (the same
//      manifest definition as the worker's
//      collectReferencedBlobIds — pinned by the shared tests)
//      and union every *.asset.json pointer's blobId.
//   3. Bucket keys minus the union = orphans. An orphan
//      INSIDE the grace window (no PUT/POST activity within
//      graceDays) is REPORTED but never deleted — a land that
//      raced, or a blob whose delete lagged, must not be
//      swept mid-flight. An orphan OLDER than the grace
//      window is deleted (batched at SWEEP_BATCH_LIMIT).
//   4. Post-sweep audit: re-list and subtract again.
//      Exit 0 iff zero orphans remain; exit 1 when any orphan
//      remains (delete failures, or fresh orphans inside the
//      grace window — "reported, awaiting grace"). Exit 2 for
//      usage/token errors.
//
// The asymmetry is deliberate (STRIDE elevation-of-privilege
// note): the LAND's GC is fail-open (best-effort, never fails a
// land that already pushed) but the SWEEP is fail-closed (a
// sweep must never silently claim a clean bucket).
//
// Usage:  node platform/scripts/r2-orphan-sweep.mjs [--grace-days N] [--dry-run] [--json]
//
// Env:  CLOUDFLARE_ACCOUNT_ID (default the demo account)
//       ARTIFACTS_NAMESPACE  (default nextgit)
//       R2_BUCKET            (default nextgit-asset-blobs)
//       ORPHAN_GRACE_DAYS    (default 7)
//       SWEEP_BATCH_LIMIT    (default 500)

import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apiToken } from "./lib/api-token.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const BUCKET = process.env.R2_BUCKET ?? "nextgit-asset-blobs";
const GRACE_DAYS = Number(process.env.ORPHAN_GRACE_DAYS ?? 7);
const SWEEP_BATCH_LIMIT = Number(process.env.SWEEP_BATCH_LIMIT ?? 500);
const REST = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

/**
 * Parse the argv. Pure; returns the resolved options or exits 2
 * on a usage error (the documented usage-error code).
 */
export function parseArgs(argv, fallbackGraceDays = GRACE_DAYS) {
 const opts = { graceDays: fallbackGraceDays, dryRun: false, json: false };
 for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--grace-days") {
   const n = Number(argv[++i]);
   if (!Number.isFinite(n) || n < 0) {
    console.error("usage: --grace-days must be a non-negative number");
    process.exit(2);
   }
   opts.graceDays = n;
  } else if (a === "--dry-run") {
   opts.dryRun = true;
  } else if (a === "--json") {
   opts.json = true;
  } else {
   console.error(`usage: node platform/scripts/r2-orphan-sweep.mjs [--grace-days N] [--dry-run] [--json] (unknown arg: ${a})`);
   process.exit(2);
  }
 }
 return opts;
}

/**
 * Plan the sweep: bucket keys minus the manifest-referenced
 * union, split by the grace window. `manifests` is the union of
 * every repo's referenced blobIds (the same definition as the
 * worker's collectReferencedBlobIds). `bucketKeys` rows carry
 * the R2 object's last-modified time (`uploadedAt`, ms epoch)
 * so the grace window is judged against `nowMs`.
 *
 * Age is measured against `uploadedAt` (the object's last
 * PUT/POST activity — "no PUT/POST activity for N days").
 * Boundary: an orphan whose age in ms is >= graceMs is
 * deletable; one second inside is not.
 *
 * Returns { toDelete, toReport } — toDelete: the orphan keys
 * older than the grace window; toReport: every orphan (the full
 * audit row set), each classified deleted|grace.
 */
export function planSweep({ bucketKeys, manifests, nowMs, graceMs }) {
 const referenced = new Set(manifests);
 const toDelete = [];
 const toReport = [];
 for (const key of bucketKeys) {
  if (referenced.has(key.name)) continue;
  const ageMs = nowMs - key.uploadedAt;
  const ageDays = Math.floor(ageMs / 86400e3);
  const deletable = ageMs >= graceMs;
  if (deletable) toDelete.push(key.name);
  toReport.push({ key: key.name, ageDays, outcome: deletable ? "deleted" : "grace" });
 }
 return { toDelete, toReport };
}

/**
 * The manifest union: every repo's default-branch tree, walked
 * for `*.asset.json` pointers. REST cannot read raw git objects,
 * so the walk falls back to a shallow `git clone --depth 1` with
 * a READ-scoped repo token (the fanout.mjs idiom), then
 * `git ls-tree -r`. The walk's definition (which paths count as
 * pointer manifests, how the union is defined) is the same as
 * the worker's collectReferencedBlobIds — pinned by the shared
 * tests, not shared code.
 */
export async function collectManifests({ token, fetchImpl }) {
 const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
 const get = async (path) => {
  const res = await fetchImpl(`${REST}${path}`, { method: "GET", headers });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(`GET ${path} -> ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
 };
 const manifests = new Set();
 const repos = await get(`/artifacts/namespaces/${NAMESPACE}/repos?limit=200`);
 const cloneRoot = await mkdtemp(join(tmpdir(), "r2-orphan-sweep-"));
 try {
  for (const entry of repos) {
   if (entry.status !== undefined && entry.status !== "ready") continue;
   const tok = await fetchImpl(`${REST}/artifacts/namespaces/${NAMESPACE}/tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify({ repo: entry.name, scope: "read", ttl: 600 }),
   }).then((r) => r.json());
   if (!tok.success) throw new Error(`token ${entry.name} -> ${JSON.stringify(tok.errors ?? tok)}`);
   const remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${entry.name}.git`;
   const dir = join(cloneRoot, entry.name);
   const gitEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tok.result.plaintext}`,
   };
   const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", entry.defaultBranch ?? "main", "--single-branch", remote, dir], { encoding: "utf8", env: gitEnv });
   if (clone.status !== 0) {
    // An unreadable manifest makes the union unsound — hard
    // failure (fail-closed), never a silent skip.
    throw new Error(`git clone ${entry.name}: ${clone.stderr}`);
   }
   const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8", env: gitEnv });
   if (ls.status !== 0) throw new Error(`git ls-tree ${entry.name}: ${ls.stderr}`);
   for (const path of (ls.stdout ?? "").split("\n").filter((p) => p.endsWith(".asset.json"))) {
    const show = spawnSync("git", ["show", `HEAD:${path}`], { cwd: dir, encoding: "utf8", env: gitEnv });
    if (show.status !== 0) throw new Error(`git show ${entry.name}:${path}: ${show.stderr}`);
    let pointer;
    try {
     pointer = JSON.parse(show.stdout);
    } catch {
     continue; // unparseable pointer contributes nothing (the worker's fail-closed parse posture)
    }
    if (pointer && typeof pointer.blobId === "string" && pointer.blobId.length > 0) manifests.add(pointer.blobId);
   }
  }
 } finally {
  await rm(cloneRoot, { recursive: true, force: true });
 }
 // A manifest may be a URL-encoded repo name in a clone dir; the
 // union is the blobIds only.
 return manifests;
}

/** List every bucket key (cursor-paginated). */
async function listBucketKeys(fetchImpl, token) {
 const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
 const keys = [];
 let cursor = undefined;
 do {
  const url = `${REST}/r2/buckets/${BUCKET}/objects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const data = await fetchImpl(url, { method: "GET", headers }).then((r) => r.json());
  if (!data.success) throw new Error(`GET ${url} -> ${JSON.stringify(data.errors ?? data)}`);
  for (const obj of data.result.objects ?? []) {
   keys.push({ name: obj.key, uploadedAt: Date.parse(obj.uploadedAt ?? obj.modified ?? 0) });
  }
  cursor = data.result.cursor;
 } while (cursor);
 return keys;
}

/**
 * The default delete: `wrangler r2 object delete <bucket>/<key>
 * --remote` under the OPERATOR's wrangler auth — the proven
 * surface (upload-asset.mjs's a14858e hotfix: the direct
 * api.cloudflare.com object routes answer 7000 "No route for
 * that URI" on this account, live-verified 2026-10-12). The
 * LIST stays on the REST GET (wrangler has no `r2 object
 * list`; workers-sdk #13008 open) — that route is live-verified
 * (2026-10-12: GET …/r2/buckets/{bucket}/objects → 200
 * success:true).
 */
const deleteObject = (key) => {
 const del = spawnSync("npx", ["wrangler", "r2", "object", "delete", `${BUCKET}/${key}`, "--remote"], {
  cwd: new URL("..", import.meta.url).pathname, // platform/ — the wrangler.jsonc home
  encoding: "utf8",
 });
 if (del.status !== 0) throw new Error(`R2 DELETE failed (rc=${del.status}): ${(del.stderr || del.stdout || "").slice(0, 400)}`);
};

/**
 * The sweep body, dependency-injected so the pure plan and the
 * seams are testable without Cloudflare (the plan's C2
 * contract). `readManifests` defaults to the git-clone walk;
 * `deleteImpl` defaults to the wrangler CLI delete above.
 * Returns the machine-readable report plus the exit code (0
 * clean / 1 orphans remain / 2 error) — the caller maps it to
 * process.exit after logging.
 */
export async function runSweep({ token, opts, fetchImpl = fetch, deleteImpl = deleteObject, readManifests = collectManifests, log = console.log, now = () => Date.now() }) {
 const manifests = await readManifests({ token, fetchImpl });
 const bucketKeys = await listBucketKeys(fetchImpl, token);
 const graceMs = opts.graceDays * 86400e3;
 const plan = planSweep({ bucketKeys, manifests: [...manifests], nowMs: now(), graceMs });

 let deleted = 0;
 if (!opts.dryRun) {
  for (let i = 0; i < plan.toDelete.length; i += SWEEP_BATCH_LIMIT) {
   for (const key of plan.toDelete.slice(i, i + SWEEP_BATCH_LIMIT)) {
    await deleteImpl(key);
    deleted++;
   }
  }
 }

 // Post-sweep audit: re-list and subtract again. Fail-closed.
 // Dry-run audits the HYPOTHETICAL post-sweep state (the
 // would-be-deleted keys removed) so the exit classification
 // matches what a real sweep would leave.
 const remainingKeys = opts.dryRun
  ? bucketKeys.filter((k) => !plan.toDelete.includes(k.name))
  : await listBucketKeys(fetchImpl, token);
 const audit = planSweep({ bucketKeys: remainingKeys, manifests: [...manifests], nowMs: now(), graceMs });

 const report = {
  bucket: BUCKET,
  listed: bucketKeys.length,
  referenced: manifests.size,
  orphans: plan.toReport,
  deleted,
  remaining: audit.toReport.length,
 };
 if (opts.json) {
  log(JSON.stringify(report));
 } else {
  for (const row of plan.toReport) log(`orphan  ${row.key}  ${row.ageDays}d  ${opts.dryRun && row.outcome === "deleted" ? "dry-run" : row.outcome}`);
  log(`sweep  deleted=${deleted} reported=${plan.toReport.length} remaining=${audit.toReport.length}`);
 }
 return { report, exitCode: audit.toReport.length === 0 ? 0 : 1 };
}

const isMain = () => {
 const argv1 = process.argv[1];
 if (!argv1) return false;
 return import.meta.url === pathToFileURL(argv1).href;
};

if (isMain()) {
 const opts = parseArgs(process.argv.slice(2));
 let token;
 try {
  token = apiToken();
 } catch (e) {
  console.error(String(e?.message ?? e));
  process.exit(2);
 }
 try {
  const { exitCode } = await runSweep({ token, opts });
  process.exit(exitCode);
 } catch (e) {
  console.error(`sweep failed: ${e?.message ?? e}`);
  process.exit(2);
 }
}
