#!/usr/bin/env node
// reset-agent-4.mjs — restore the live demo fixture agent-4 to its canonical
// scripted state: the tour's "clean & ready to ship" proposal.
//
// Why: agents.mjs wrote an extra config/.env for agent-4, which add/add
// collides with agent-5's config/.env secret fixture — so the live /proposals
// grid rendered 3 conflicts + 1 clean instead of the 2+2 the tour teaches
// (fallbackProposals + quizAnswers both pin agent-4 as clean, isolated
// src/feature.ts only). This mirrors agents.mjs's agent-4 fixture (the
// src/feature.ts flag module ONLY) against the CURRENT demo head and pushes
// main + the notes mirror (nextgit-notes), then busts the /proposals KV gen.
//
// Run: node platform/scripts/reset-agent-4.mjs   (idempotent: rebuilds the fork)

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bustProposalsCache } from "./lib/bust-cache.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const BASE = process.env.RESET_BASE ?? "demo";
const REPO = process.env.RESET_REPO ?? "agent-4";
const NOTE = "Feature: checkout flags + env template";

function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const p of [join(homedir(), ".config/.wrangler/config/default.toml"), join(homedir(), ".wrangler/config/default.toml")]) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  throw new Error("no API token");
}

const TOKEN = apiToken();
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`reset ${REPO} from ${BASE} …`);
let r = await api("DELETE", `${base}/repos/${REPO}`);
console.log(`  delete: HTTP ${r.status}`);
// Post-delete consistency lag: a same-name fork immediately after
// the delete can transiently 10101. Wait it out, then forkFresh
// retries on top.
await sleep(4000);
// Fork `name` from the baseline, tolerating the post-delete consistency
// lag (a same-name fork right after the delete can hit "already exists"
// or a transient 10101) — mirrors agents.mjs's forkFresh.
async function forkFresh(name) {
  const url = `${base}/repos/${BASE}/fork`;
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { method: "POST", headers: H, body: JSON.stringify({ name, default_branch_only: true }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) return data.result;
    last = data;
    await sleep(1500 * attempt);
  }
  throw new Error(`fork: ${JSON.stringify(last?.errors ?? last)}`);
}
const remote = (await forkFresh(REPO)).remote;

console.log(`  forked: ${remote}`);

// wait ready
let row;
for (let i = 0; i < 30; i++) {
  const page = await api("GET", `${base}/repos?limit=100`);
  row = (page.data.result ?? []).find((x) => x.name === REPO);
  if (row && row.status === "ready") break;
  await sleep(2000);
}
if (!row) throw new Error(`fork ${REPO}: never reached 'ready' status after 30x2s polling`);

r = await api("POST", `${base}/tokens`, { repo: REPO, scope: "write", ttl: 3600 });
if (!r.data.success) throw new Error(`token: ${JSON.stringify(r.data.errors)}`);
const repoToken = r.data.result.plaintext;

const dir = mkdtempSync(join(tmpdir(), "reset-a4-"));
const git = (...args) =>
  execFileSync("git", ["-C", dir, "-c", `http.extraHeader=Authorization: Bearer ${repoToken}`, ...args], {
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  execFileSync("git", ["-c", `http.extraHeader=Authorization: Bearer ${repoToken}`, "clone", "-q", remote, dir], {
    encoding: "utf8",
    timeout: 120000,
  });
  git("config", "user.email", "agent-4@nextgit.dev");
  git("config", "user.name", "agent-4");

  // agent-4 = isolated src/feature.ts ONLY (no config/.env: that collides
  // with agent-5's secret fixture). Mirrors agents.mjs's agent-4 fixture.
  const featurePath = join(dir, "src/feature.ts");
  mkdirSync(dirname(featurePath), { recursive: true });
  writeFileSync(
    featurePath,
    `// Feature flag lookup for checkout. Values come from config at deploy time.
export interface Flag {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
}

const flags = new Map<string, Flag>([
  ["checkout-v2", { key: "checkout-v2", enabled: true, rolloutPercent: 25 }],
  ["express-pay", { key: "express-pay", enabled: false, rolloutPercent: 0 }],
]);

export function lookup(key: string): Flag | undefined {
  return flags.get(key);
}

export function isEnabled(key: string, bucket = 0): boolean {
  const flag = flags.get(key);
  if (!flag?.enabled) return false;
  return bucket >= 0 && bucket < flag.rolloutPercent;
}

export function setFlag(flag: Flag): void {
  flags.set(flag.key, flag);
}

export function listFlags(): Flag[] {
  return [...flags.values()].sort((a, b) => a.key.localeCompare(b.key));
}
`,
    "utf8",
  );

  // Ignore rules from the repo alone so the staged tree is deterministic.
  git("config", "core.excludesFile", "/dev/null");
  git("add", "-A");
  git("commit", "-q", "-m", `${REPO}: ${NOTE}`);
  git("notes", "add", "-f", "-m", NOTE, "HEAD");
  execFileSync(
    "git",
    ["-C", dir, "-c", `http.extraHeader=Authorization: Bearer ${repoToken}`, "push", "-q", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes"],
    { encoding: "utf8", timeout: 180000, stderr: "pipe" },
  );
  console.log("  pushed main + notes mirror");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// verify via the live platform
const changes = await (await fetch(`https://nextgit-platform.john-b7d.workers.dev/changes?repo=${REPO}`)).json();
const intent = changes?.changeSet?.files?.[0]?.intent ?? null;
const files = (changes?.changeSet?.files ?? []).map((f) => `${f.path} ${f.status} +${f.additions ?? 0}`);
console.log(`verify: intent=${JSON.stringify(intent)} files=${JSON.stringify(files)}`);
if (intent !== NOTE) {
  console.log("WARN: intent not yet visible (cache/queue lag?) — re-check /changes in ~10s");
}
await bustProposalsCache("reset-agent-4");
console.log("done");
