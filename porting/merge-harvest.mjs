#!/usr/bin/env bun
// porting/merge-harvest.mjs — merge porting/harvest/*.json into the task store.
//
// Usage:  bun porting/merge-harvest.mjs --dry [--threshold 0.68] [--skip-file porting/harvest/manual-skips.json]
//         bun porting/merge-harvest.mjs --apply [--threshold 0.68] [--skip-file ...]
//
// Dedupe policy:
//  (a) vs every existing store row (any status) — live work wins; the harvest item is skipped
//      (near-dupes resolved by hand go in the skip file: [{source, titleRe}]);
//  (b) across harvest items — priority first (P0<P3), then source precedence order.
// Similarity: token-set Jaccard on normalized titles. Every skip is written to
// porting/harvest/dedupe-report.json for audit.
//
// Insert: via the sanctioned CLI (`tasks.mjs add`; `set --status done` when the item cites a
// built artifact). Ref provenance is appended to scope as "Ref: ...".

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const dry = !args.includes("--apply");
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const threshold = Number(opt("--threshold", "0.68"));
const skipFile = opt("--skip-file", `${root}porting/harvest/manual-skips.json`);
const dbPath = `${root}porting/tasks.db`;
const tasksCli = `${root}porting/tasks.mjs`;

const SOURCE_ORDER = ["spec", "judge", "memlog", "recon", "research", "session", "source-docs"];
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["add", "build", "write", "the", "a", "an", "for", "with", "and", "to", "of", "in", "on", "create", "implement", "item", "support"]);
const tokens = (t) => new Set(norm(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function cli(...a) {
  return execFileSync("bun", [tasksCli, ...a], { cwd: root, encoding: "utf8", timeout: 15000, env: { ...process.env, TASKS_DB: dbPath } });
}

const existing = JSON.parse(cli("list", "--json"));
const existingToks = existing.map((r) => ({ id: r.id, title: r.title, status: r.status, tok: tokens(r.title) }));
const manualSkips = existsSync(skipFile) ? JSON.parse(readFileSync(skipFile, "utf8")) : [];

let items = [];
for (const f of readdirSync(`${root}porting/harvest`).filter((f) => f.endsWith(".json") && f !== "dedupe-report.json")) {
  const data = JSON.parse(readFileSync(`${root}porting/harvest/${f}`, "utf8"));
  for (const it of data.items ?? []) items.push({ ...it, sourceName: f.replace(/\.json$/, "") });
}
const P = { P0: 0, P1: 1, P2: 2, P3: 3 };
items.sort((a, b) => (P[a.priority] ?? 2) - (P[b.priority] ?? 2) || SOURCE_ORDER.indexOf(a.sourceName) - SOURCE_ORDER.indexOf(b.sourceName));

const kept = [];
const skipped = [];
const usedIds = new Set(existing.map((r) => r.id));

// --review: show, per existing pending/partial row, its closest harvest items — for hand-crafted skips.
if (args.includes("--review")) {
  console.log("=== REVIEW: existing pending/partial rows x closest harvest items ===");
  for (const r of existing.filter((r) => r.status === "pending" || r.status === "partial")) {
    const rt = tokens(r.title);
    const scored = items
      .map((it) => ({ t: it.title, src: it.sourceName, s: jaccard(rt, tokens(it.title)) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .filter((c) => c.s > 0.15);
    console.log(`\n[${r.status}] ${r.id} — ${r.title}`);
    for (const c of scored) console.log(`    ${c.s.toFixed(2)}  [${c.src}] ${c.t.slice(0, 84)}`);
  }
  process.exit(0);
}

for (const it of items) {
  const tok = tokens(it.title);
  const manual = manualSkips.find((m) => m.source === it.sourceName && new RegExp(m.titleRe, "i").test(it.title));
  if (manual) { skipped.push({ title: it.title, source: it.sourceName, reason: `manual:${manual.reason ?? "listed"}` }); continue; }
  const vsExisting = existingToks.find((r) => (r.tok.size > 0 && jaccard(tok, r.tok) >= threshold) || norm(r.title) === norm(it.title));
  if (vsExisting) { skipped.push({ title: it.title, source: it.sourceName, reason: `existing:${vsExisting.id}`, sim: +jaccard(tok, vsExisting.tok).toFixed(2) }); continue; }
  const vsKept = kept.find((k) => jaccard(tok, k.tok) >= threshold || norm(k.title) === norm(it.title));
  if (vsKept) { skipped.push({ title: it.title, source: it.sourceName, reason: `kept:${vsKept.id}`, sim: +jaccard(tok, vsKept.tok).toFixed(2) }); continue; }
  let id = slug(it.title), n = 1; const base = id;
  while (usedIds.has(id)) { n++; id = `${base.slice(0, 58 - String(n).length)}-${n}`; }
  usedIds.add(id);
  kept.push({ ...it, id, tok });
}

writeFileSync(`${root}porting/harvest/dedupe-report.json`, JSON.stringify({ threshold, totals: { items: items.length, kept: kept.length, skipped: skipped.length }, keptBySource: kept.reduce((m, k) => ((m[k.sourceName] = (m[k.sourceName] ?? 0) + 1), m), {}), skippedItems: skipped }, null, 2));

// Committed audit trail (porting/harvest/ is gitignored — the DECISIONS must survive).
const day = new Date().toISOString().slice(0, 10);
const keptBySource = kept.reduce((m, k) => ((m[k.sourceName] = (m[k.sourceName] ?? 0) + 1), m), {});
mkdirSync(`${root}porting/certifications`, { recursive: true });
writeFileSync(`${root}porting/certifications/harvest-merge-${day}.md`,
  `# Harvest merge — registry population (${dry ? "DRY RUN — not applied" : "APPLIED"})\n\n` +
  `Date: ${new Date().toISOString()} · threshold: ${threshold} · items: ${items.length} → kept ${kept.length}, skipped ${skipped.length}\n\n` +
  `## Kept by source\n${Object.entries(keptBySource).map(([s, n]) => `- ${s}: ${n}`).join("\n")}\n\n` +
  `## Skipped (merged/retired — nothing silently dropped)\n${skipped.map((s) => `- [${s.source}] ${s.title} — ${s.reason}${s.sim != null ? ` (sim ${s.sim})` : ""}`).join("\n") || "(none)"}\n\n` +
  `## Audit\n- Kept items carry \`source: harvest:<src>\` + \`Ref: ...\` in scope: \`bun porting/tasks.mjs list --json | jq '[.[] | select(.source | startswith("harvest:"))] | length'\`\n- Raw harvest inputs: \`porting/harvest/*.json\` (gitignored, transient) — in-store provenance is authoritative.\n`);
console.log(`report → porting/certifications/harvest-merge-${day}.md (+ JSON in porting/harvest/)`);

console.log(`${dry ? "DRY" : "APPLY"}: ${items.length} items → keep ${kept.length}, skip ${skipped.length} (threshold ${threshold})`);
console.log("kept by source:", JSON.stringify(kept.reduce((m, k) => ((m[k.sourceName] = (m[k.sourceName] ?? 0) + 1), m), {})));
for (const s of skipped.slice(0, 30)) console.log(`  skip  ${s.source.padEnd(12)} ${(s.reason ?? "").padEnd(28)} ${s.title.slice(0, 64)}`);
if (skipped.length > 30) console.log(`  … ${skipped.length - 30} more skips in the report`);
console.log("report → porting/harvest/dedupe-report.json");

if (!dry) {
  let added = 0, markedDone = 0, failed = 0;
  for (const k of kept) {
    const scope = ((k.scope ?? "").slice(0, 500) + (k.ref ? `\nRef: ${k.ref}` : "")).trim();
    try {
      cli("add", "--id", k.id, "--title", (k.title ?? "").slice(0, 120), "--priority", k.priority ?? "P2", "--layer", k.layer ?? "core", "--source", `harvest:${k.sourceName}`, "--scope", scope, "--acceptance", (k.acceptance ?? "").slice(0, 300), "--check", (k.check ?? "").slice(0, 200));
      added++;
      if (k.status === "done") { cli("set", k.id, "--status", "done", "--evidence", k.ref ?? "cited in harvest"); markedDone++; }
    } catch (e) { failed++; console.error(`  add failed: ${k.id} — ${String(e.stdout ?? e.message).slice(0, 140)}`); }
  }
  console.log(`applied: +${added} rows (${markedDone} marked done, ${failed} failed)`);
  console.log("next: bun porting/tasks.mjs view && bun scripts/status-index.mjs");
}
