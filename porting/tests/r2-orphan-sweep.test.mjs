#!/usr/bin/env bun
// Contract suite for the R2 asset-blob orphan sweep
// (platform/scripts/r2-orphan-sweep.mjs) — the
// nextgit-e12-impl-lifecycle-safe-deletes-no-orphans order's
// deliverable C, acceptance leg 3.
//
// Run: bun porting/tests/r2-orphan-sweep.test.mjs   (exit 0 = pass)
//
// Idiom: tasks.test.mjs/batch.test.mjs — the script is imported
// as a module (its pure core planSweep, and runSweep with the
// REST fetch seam + the manifest walk INJECTED), so no Cloudflare
// and no network are touched. The real CLI is exercised by
// subprocess only for the exit-2 usage/token contract. No
// mock.module, no source grep; full-suite safe.
//
// Groups (each defends an observable contract):
//   1. Zero-orphan bucket: all keys referenced -> report empty,
//      zero deletes, exit 0.
//   2. Old orphan deleted: unreferenced key older than grace ->
//      deleted, post-sweep audit zero, exit 0.
//   3. Fresh orphan reported, not deleted: unreferenced key
//      inside grace -> in the report, NOT deleted, exit 1.
//   4. Shared blob survives: key referenced by ANY manifest ->
//      never in the delete set.
//   5. Grace window boundary: exactly at the cutoff is
//      deletable; one second inside is not.
//   6. Dry-run never deletes: zero DELETE calls; the exit
//      classification is the hypothetical post-sweep state.
//   7. Exit-code contract: 0 clean / 1 remaining / 2 usage+token.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSweep, runSweep } from "../../platform/scripts/r2-orphan-sweep.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "platform/scripts/r2-orphan-sweep.mjs");

let fails = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  else passes++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const DAY = 86400e3;
const NOW = 1_800_000_000_000;

// ---------------------------------------------------------------------------
// A stubbed REST surface (bucket listing, cursor-paginated) plus
// a stubbed delete (the wrangler r2 object delete seam — the
// real delete is the operator's wrangler surface, not a REST
// route, so the suite injects it). Records every delete.
// ---------------------------------------------------------------------------
function makeRest({ objects, pageSize = 500 }) {
  const deletes = [];
  const live = new Map(objects.map((o) => [o.key, o]));
  const fetchImpl = async (url) => {
    const cursor = url.includes("cursor=") ? decodeURIComponent(url.split("cursor=")[1]) : null;
    const all = [...live.values()].filter((o) => typeof o.key === "string");
    const start = cursor ? all.findIndex((o) => o.key === cursor) + 1 : 0;
    const page = all.slice(start, start + pageSize);
    const next = start + pageSize < all.length ? page[page.length - 1].key : null;
    // The real REST returns an ISO 8601 `uploadedAt`.
    const rows = page.map((o) => ({ key: o.key, uploadedAt: new Date(o.uploadedAt).toISOString() }));
    return { json: async () => ({ success: true, result: { objects: rows, cursor: next } }) };
  };
  const deleteImpl = async (key) => {
    deletes.push(key);
    live.delete(key);
  };
  return { fetchImpl, deleteImpl, deletes, live };
}

const silent = () => { };

// ---------------------------------------------------------------------------
// 1. Zero-orphan bucket — all keys referenced -> no deletes, exit 0.
// ---------------------------------------------------------------------------
{
  const rest = makeRest({ objects: [{ key: "blobA", uploadedAt: NOW - 30 * DAY }, { key: "blobB", uploadedAt: NOW - 30 * DAY }] });
  const { report, exitCode } = await runSweep({
    token: "t",
    opts: { graceDays: 7, dryRun: false, json: false },
    fetchImpl: rest.fetchImpl,
    deleteImpl: rest.deleteImpl,
    readManifests: async () => new Set(["blobA", "blobB"]),
    log: silent,
    now: () => NOW,
  });
  check("1a zero orphans reported", report.orphans.length === 0, JSON.stringify(report.orphans));
  check("1b zero deletes", report.deleted === 0 && rest.deletes.length === 0, JSON.stringify(rest.deletes));
  check("1c exit 0", exitCode === 0, String(exitCode));
  check("1d reported referenced count", report.referenced === 2 && report.listed === 2, JSON.stringify({ r: report.referenced, l: report.listed }));
}

// ---------------------------------------------------------------------------
// 2. Old orphan deleted — unreferenced + older than grace -> deleted,
//    post-sweep audit zero, exit 0.
// ---------------------------------------------------------------------------
{
  const rest = makeRest({ objects: [{ key: "blobOld", uploadedAt: NOW - 10 * DAY }] });
  const { report, exitCode } = await runSweep({
    token: "t",
    opts: { graceDays: 7, dryRun: false, json: false },
    fetchImpl: rest.fetchImpl,
    deleteImpl: rest.deleteImpl,
    readManifests: async () => new Set(),
    log: silent,
    now: () => NOW,
  });
  check("2a the old orphan is deleted", rest.deletes.includes("blobOld"), JSON.stringify(rest.deletes));
  check("2b report.deleted === 1", report.deleted === 1, String(report.deleted));
  check("2c post-sweep audit is zero", report.remaining === 0, String(report.remaining));
  check("2d report row classified deleted", report.orphans[0]?.outcome === "deleted" && report.orphans[0]?.ageDays === 10, JSON.stringify(report.orphans));
  check("2e exit 0", exitCode === 0, String(exitCode));
}

// ---------------------------------------------------------------------------
// 3. Fresh orphan reported, not deleted — inside grace -> reported,
//    NOT deleted, exit 1.
// ---------------------------------------------------------------------------
{
  const rest = makeRest({ objects: [{ key: "blobFresh", uploadedAt: NOW - 1 * DAY }] });
  const { report, exitCode } = await runSweep({
    token: "t",
    opts: { graceDays: 7, dryRun: false, json: false },
    fetchImpl: rest.fetchImpl,
    deleteImpl: rest.deleteImpl,
    readManifests: async () => new Set(),
    log: silent,
    now: () => NOW,
  });
  check("3a the fresh orphan is reported", report.orphans.length === 1 && report.orphans[0].key === "blobFresh" && report.orphans[0].outcome === "grace", JSON.stringify(report.orphans));
  check("3b NOT deleted", rest.deletes.length === 0 && report.deleted === 0, JSON.stringify(rest.deletes));
  check("3c orphan remains after the sweep", report.remaining === 1, String(report.remaining));
  check("3d exit 1 (fail-closed)", exitCode === 1, String(exitCode));
}

// ---------------------------------------------------------------------------
// 4. Shared blob survives — referenced by ANY manifest -> never deleted,
//    even when old enough.
// ---------------------------------------------------------------------------
{
  const rest = makeRest({ objects: [{ key: "blobShared", uploadedAt: NOW - 90 * DAY }, { key: "blobOrphan", uploadedAt: NOW - 90 * DAY }] });
  const { report, exitCode } = await runSweep({
    opts: { graceDays: 7, dryRun: false, json: false },
    fetchImpl: rest.fetchImpl,
    deleteImpl: rest.deleteImpl,
    readManifests: async () => new Set(["blobShared"]),
    log: silent,
    now: () => NOW,
  });
  check("4a the shared blob is never deleted", !rest.deletes.includes("blobShared"), JSON.stringify(rest.deletes));
  check("4b the unshared orphan IS deleted", rest.deletes.includes("blobOrphan"), JSON.stringify(rest.deletes));
  check("4c the shared blob is not in the orphan report", !report.orphans.some((r) => r.key === "blobShared"), JSON.stringify(report.orphans));
  check("4d exit 0 (only the deletable orphan existed)", exitCode === 0, String(exitCode));
}

// ---------------------------------------------------------------------------
// 5. Grace window boundary — exactly at the cutoff is deletable;
//    one second inside is not.
// ---------------------------------------------------------------------------
{
  const graceMs = 7 * DAY;
  const atCutoff = planSweep({ bucketKeys: [{ name: "exact", uploadedAt: NOW - graceMs }], manifests: [], nowMs: NOW, graceMs });
  check("5a exactly at the cutoff is deletable", atCutoff.toDelete.includes("exact") && atCutoff.toReport[0].outcome === "deleted", JSON.stringify(atCutoff));
  const insideByOneSecond = planSweep({ bucketKeys: [{ name: "inside", uploadedAt: NOW - graceMs + 1000 }], manifests: [], nowMs: NOW, graceMs });
  check("5b one second inside is NOT deletable", insideByOneSecond.toDelete.length === 0 && insideByOneSecond.toReport[0].outcome === "grace", JSON.stringify(insideByOneSecond));
  const olderByOneSecond = planSweep({ bucketKeys: [{ name: "older", uploadedAt: NOW - graceMs - 1000 }], manifests: [], nowMs: NOW, graceMs });
  check("5c one second older IS deletable", olderByOneSecond.toDelete.includes("older"), JSON.stringify(olderByOneSecond));
}

// ---------------------------------------------------------------------------
// 6. Dry-run never deletes — zero DELETE calls; the exit
//    classification is the hypothetical post-sweep state.
// ---------------------------------------------------------------------------
{
  const rest = makeRest({ objects: [{ key: "blobOld", uploadedAt: NOW - 10 * DAY }] });
  const { report, exitCode } = await runSweep({
    token: "t",
    opts: { graceDays: 7, dryRun: true, json: false },
    fetchImpl: rest.fetchImpl,
    deleteImpl: rest.deleteImpl,
    readManifests: async () => new Set(),
    log: silent,
    now: () => NOW,
  });
  check("6a zero DELETE calls under --dry-run", rest.deletes.length === 0, JSON.stringify(rest.deletes));
  check("6b report.deleted is 0 under --dry-run", report.deleted === 0, String(report.deleted));
  check("6c the would-be-deleted orphan is still reported", report.orphans.some((r) => r.key === "blobOld"), JSON.stringify(report.orphans));
  check("6d exit 0 (a hypothetical sweep would leave zero orphans)", exitCode === 0, String(exitCode));

  // A fresh orphan under --dry-run: hypothetical sweep still leaves it -> 1.
  const rest2 = makeRest({ objects: [{ key: "blobFresh", uploadedAt: NOW - 1 * DAY }] });
  const dryFresh = await runSweep({
    token: "t",
    opts: { graceDays: 7, dryRun: true, json: false },
    fetchImpl: rest2.fetchImpl,
    deleteImpl: rest2.deleteImpl,
    readManifests: async () => new Set(),
    log: silent,
    now: () => NOW,
  });
  check("6e --dry-run exit 1 when a fresh orphan would remain", dryFresh.exitCode === 1 && rest2.deletes.length === 0, String(dryFresh.exitCode));
}

// ---------------------------------------------------------------------------
// 7. Exit-code contract — the real CLI: 2 for usage + token errors.
//    (0 clean / 1 remaining are pinned in groups 1/2/3 above.)
// ---------------------------------------------------------------------------
{
  const badFlag = spawnSync("bun", [SCRIPT, "--not-a-flag"], { cwd: ROOT, encoding: "utf8", env: { ...process.env } });
  check("7a unknown flag -> exit 2", badFlag.status === 2, `status ${badFlag.status} stderr ${badFlag.stderr?.slice(0, 120)}`);

  const emptyHome = mkdtempSync(join(tmpdir(), "sweep-nohome-"));
  const env = { ...process.env, HOME: emptyHome };
  delete env.CLOUDFLARE_API_TOKEN;
  const noToken = spawnSync("bun", [SCRIPT], { cwd: ROOT, encoding: "utf8", env });
  check("7b no token -> exit 2 with the token error", noToken.status === 2 && /No API token/.test(noToken.stderr ?? ""), `status ${noToken.status} stderr ${noToken.stderr?.slice(0, 140)}`);
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
