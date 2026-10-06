#!/usr/bin/env node
// land.mjs — land agent proposals by delegating to the platform.
//
// POSTs to the worker's /land endpoint, which folds the proposals against the
// baseline (diff3, fork-point ancestor) and pushes ONE commit server-side.
// This script never pushes anything itself: the worker is the only writer of
// base-ref branches (architecture spine AD-1/AD-7 — landing replays prohibited).
//
// Usage:  node platform/scripts/land.mjs agent-3 [agent-1,agent-2]
//
// Exit codes:
//   0  landed — the baseline advanced
//   1  refused — conflict, withheld-secret, or no-changes (details printed)
//   2  worker unreachable or returned an unusable response

const WORKER = process.env.NEXTGIT_PLATFORM ?? process.env.NEXTGIT_WORKER ?? "https://nextgit-platform.john-b7d.workers.dev";
const BASELINE = process.env.NEXTGIT_BASELINE ?? "demo";

const raw = (process.argv[2] ?? "").trim();
if (!raw) {
  console.error("usage: node platform/scripts/land.mjs <repo[,repo2,...]>");
  process.exit(2);
}
const repos = raw.split(",").map((s) => s.trim()).filter(Boolean);
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n  land ${repos.join(", ")} → ${BASELINE}`);
console.log(`  ${"-".repeat(60)}`);

let res;
try {
  res = await fetch(`${WORKER}/land`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base: BASELINE, repos }),
  });
} catch (err) {
  console.error(`  ${pad("unreachable", 16)} ${err?.cause?.code ?? err?.message ?? err}`);
  process.exit(2);
}

let body;
try {
  body = await res.json();
} catch {
  console.error(`  ${pad("unusable", 16)} HTTP ${res.status}`);
  process.exit(2);
}

if (res.ok && body.ok) {
  const { commit, files } = body.landed;
  console.log(`  ${pad("landed", 16)} ${commit}`);
  for (const f of files) console.log(`  ${pad("file", 16)} ${f}`);
  console.log(`\n  done — baseline advanced to ${String(commit).slice(0, 12)}\n`);
  process.exit(0);
}

const err = body.error ?? `HTTP ${res.status}`;
console.log(`  ${pad("refused", 16)} ${err}`);
if (Array.isArray(body.conflicted) && body.conflicted.length) {
  console.log(`  ${pad("conflicted", 16)} ${body.conflicted.join(", ")}`);
}
if (Array.isArray(body.files) && body.files.length && typeof body.files[0] === "string") {
  console.log(`  ${pad("withheld", 16)} ${body.files.join(", ")}`);
}
if (body.detail) console.log(`  ${pad("detail", 16)} ${String(body.detail).slice(0, 200)}`);
console.log();
process.exit(res.status >= 500 ? 2 : 1);
