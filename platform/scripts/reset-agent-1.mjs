#!/usr/bin/env node
// reset-agent-1.mjs — one-off: restore the live demo fixture agent-1 to its canonical
// scripted state (E1 collision pair with agent-2 on src/auth.ts).
//
// Why: a wave-6 verify suite (events-queue-consumes-live) pushed `e4-test:` commits into
// agent-1 — the LIVE demo fork — destroying its change-set + intent note. This mirrors
// platform/scripts/agents.mjs's agent-1 fixture (same change, same note) against the
// CURRENT demo head, and pushes main + the notes mirror (nextgit-notes).
//
// Run: node platform/scripts/reset-agent-1.mjs   (idempotent: rebuilds the fork)

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { bustProposalsCache } from "./lib/bust-cache.mjs";
import { gitAuthEnv } from "./lib/tokens.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const BASE = process.env.RESET_BASE ?? "demo";
const REPO = process.env.RESET_REPO ?? "agent-1";
const NOTE = "Refactor: session refresh with TTL";
const ANCHOR = "  return now > session.expiresAt;";
const INSERT = `

/** Extend a live session, returning a new session with the same identity. */
export function refreshSession(session: Session, ttlMs = DEFAULT_TTL_MS): Session {
  return createSession(session.userId, ttlMs);
}`;

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
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`reset ${REPO} from ${BASE} …`);
let r = await api("DELETE", `${base}/repos/${REPO}`);
console.log(`  delete: HTTP ${r.status}`);
if (r.status === 202) await sleep(1500);

r = await api("POST", `${base}/repos/${BASE}/fork`, { name: REPO, default_branch_only: true });
if (!r.data.success) throw new Error(`fork: ${JSON.stringify(r.data.errors)}`);
const remote = r.data.result.remote;
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

const dir = mkdtempSync(join(tmpdir(), "reset-a1-"));
// The token rides GIT_CONFIG_VALUE_0 (env), never argv — invisible to
// ps / /proc/<pid>/cmdline (FR-36 argv law).
const gitEnv = { ...process.env, ...gitAuthEnv(repoToken) };
const git = (...args) =>
  execFileSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8", timeout: 120000 });

try {
  execFileSync("git", ["clone", "-q", remote, dir], { cwd: dir, env: gitEnv, encoding: "utf8", timeout: 120000 });
  git("config", "user.email", "agent-1@nextgit.dev");
  git("config", "user.name", "agent-1");

  const authPath = join(dir, "src/auth.ts");
  const src = readFileSync(authPath, "utf8");
  if (!src.includes(ANCHOR)) throw new Error(`anchor not found in src/auth.ts — demo baseline drifted`);
  if (!src.includes("export function refreshSession")) {
    const idx = src.indexOf(ANCHOR) + ANCHOR.length;
    // insert after the isExpired return, then a blank line, preserving the tail newline
    const next = src.indexOf("\n", idx);
    const patched = src.slice(0, next) + INSERT + src.slice(next);
    writeFileSync(authPath, patched, "utf8");
  }

  git("add", "-A");
  git("commit", "-q", "-m", `${REPO}: session refresh with TTL`);
  git("notes", "add", "-f", "-m", NOTE, "HEAD");
  execFileSync("git", ["-C", dir, "push", "-q", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes"], { cwd: dir, env: gitEnv, encoding: "utf8", timeout: 180000, stderr: "pipe" });
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
await bustProposalsCache("reset-agent-1");
console.log("done");
