#!/usr/bin/env node
// agents.mjs — drive the four demo agent proposals.
//
// write token, clone, apply the agent's change, attach a git note carrying its
// intent, and commit + push main and both note refspecs.
//
// Usage:  node platform/scripts/agents.mjs [baseline] [ttlSeconds]
// Output: /tmp/nextgit-agents.json — [{ name, remote, token, scope, expires_at }]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bustProposalsCache } from "./lib/bust-cache.mjs";
import { resolveTtl, mintRepoToken, writeAgentManifest, gitAuthEnv } from "./lib/tokens.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const OUT_FILE = process.env.AGENTS_OUT ?? "/tmp/nextgit-agents.json";

const baseline = process.argv[2] ?? "demo";
const ttl = resolveTtl(process.argv[3]);

function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const apiHeaders = { Authorization: `Bearer ${apiToken()}` };

async function call(method, url, body, headers = apiHeaders) {
  const res = await fetch(url, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
}

/** Insert text after the first line that matches `anchor`. */
function insertAfter(source, anchor, addition) {
  const lines = source.split("\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) throw new Error(`anchor not found in baseline: ${anchor}`);
  lines.splice(i + 1, 0, addition);
  return lines.join("\n");
}

/** Replace the first exact occurrence of a possibly multi-line block. */
function replaceOnce(source, needle, replacement) {
  const i = source.indexOf(needle);
  if (i < 0) throw new Error(`text not found in baseline: ${needle.split("\n")[0]}`);
  return source.slice(0, i) + replacement + source.slice(i + needle.length);
}

// Each change is expressed as pure text transforms over the cloned baseline so a
// drifted baseline fails loudly instead of silently producing a no-op commit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fork `name` from the baseline, tolerating the post-delete consistency lag. */
async function forkFresh(name) {
  const url = `${apiBase}/repos/${baseline}/fork`;
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await call("POST", url, { name, default_branch_only: true });
    } catch (err) {
      last = err;
      if (!/already exists/i.test(err.message)) throw err;
      await sleep(1500 * attempt);
    }
  }
  throw last;
}
const AGENTS = [
  {
    name: "agent-1",
    note: "Refactor: session refresh with TTL",
    apply(files) {
      // Anchored to the isExpired block that agent-2 rewrites, so the demo pair
      // conflicts (both agents change the same region) instead of merging.
      files["src/auth.ts"] = insertAfter(
        files["src/auth.ts"],
        "  return now > session.expiresAt;",
        `

/** Extend a live session, returning a new session with the same identity. */
export function refreshSession(session: Session, ttlMs = DEFAULT_TTL_MS): Session {
  return createSession(session.userId, ttlMs);
}`,
      );

      return { written: ["src/auth.ts"], deleted: [] };
    },
  },
  {
    name: "agent-2",
    note: "Fix: clock-skew leeway for expiry",
    apply(files) {
      files["src/auth.ts"] = replaceOnce(
        files["src/auth.ts"],
        "export function isExpired(session: Session, now = Date.now()): boolean {\n  return now > session.expiresAt;\n}",
        "export function isExpired(session: Session, leewayMs = 0, now = Date.now()): boolean {\n  return now > session.expiresAt + leewayMs;\n}",
      );
      return { written: ["src/auth.ts"], deleted: [] };
    },
  },
  {
    name: "agent-3",
    note: "Perf: memoize store reads",
    apply(files) {
      files["src/store.ts"] = insertAfter(
        files["src/store.ts"],
        "const rows = new Map<string, Row<unknown>>();",
        `
/** Read-through cache so repeated reads of a hot row skip the map lookup. */
const cache = new Map<string, Row<unknown>>();

export function getCached<T>(id: string): Row<T> | undefined {
  const hit = cache.get(id);
  if (hit) return hit as Row<T>;
  const row = get<T>(id);
  if (row) cache.set(id, row as Row<unknown>);
  return row;
}

export function invalidateCache(id?: string): void {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}`,
      );
      return { written: ["src/store.ts"], deleted: [] };
    },
  },
  {
    name: "agent-4",
    note: "Feature: checkout flags + env template",
    apply(files) {
      files["src/feature.ts"] = `// Feature flag lookup for checkout. Values come from config at deploy time.
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
`;
      // agent-4 is the tour's "clean & ready to ship" proposal: a single
      // isolated file (src/feature.ts) that collides with no other agent.
      // A config/.env here would add/add-collide with agent-5's secret
      // fixture and break the 2-conflict / 2-clean grid the tour teaches.
      return { written: ["src/feature.ts"], deleted: [] };
    },
  },
];

async function main() {
  const repos = await call("GET", `${apiBase}/repos?limit=200`);
  const existing = new Set(repos.map((r) => r.name));

  const results = [];
  const minted = [];

  for (const agent of AGENTS) {
    const row = { agent: agent.name, note: agent.note, status: "pending", files: "", head: "", detail: "" };
    results.push(row);
    let dir = null;
    try {
      if (existing.has(agent.name)) {
        await call("DELETE", `${apiBase}/repos/${agent.name}`);
        row.detail = `dropped stale ${agent.name}`;
      }

      // Deleting a repo is eventually consistent — a same-name fork right after
      // the delete can still hit "repo already exists" (10201).
      const fork = await forkFresh(agent.name);
      const tok = await mintRepoToken(call, { base: apiBase, repo: agent.name, ttl, headers: apiHeaders });
      minted.push({ name: agent.name, remote: fork.remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at });

      const env = {
        ...process.env,
        ...gitAuthEnv(tok.plaintext),
      };

      dir = mkdtempSync(join(tmpdir(), `nextgit-${agent.name}-`));
      // git() returns raw stdout — porcelain output is position-sensitive and
      // must not be trimmed.
      const git = (...args) =>
        execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const one = (...args) => git(...args).trim();

      one("clone", fork.remote, dir);
      one("config", "user.name", agent.name);
      one("config", "user.email", `${agent.name.replace("-", "")}@nextgit.dev`);

      const files = {};
      for (const rel of one("ls-files").split("\n").filter(Boolean)) {
        files[rel] = readFileSync(join(dir, rel), "utf8");
      }

      const { written, deleted } = agent.apply(files);
      for (const rel of written) {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, files[rel], "utf8");
      }
      for (const rel of deleted) rmSync(join(dir, rel), { force: true });

      // The host's global gitignore excludes .env (and friends), which would make
      // `git add -A` silently skip a file this script promised to commit. Ignore
      // rules must come from the repo alone so the staged tree is deterministic.
      one("config", "core.excludesFile", "/dev/null");

      // `one` would eat the leading space of the first porcelain line, so the
      // status column is parsed from the raw stdout instead.
      const changed = git("status", "--porcelain")
        .split("\n")
        .filter(Boolean);
      if (!changed.length) throw new Error("change produced no diff — baseline already contains it");

      one("add", "-A");

      // Fail closed if any intended path did not actually reach the index.
      const staged = new Set(
        one("diff", "--cached", "--name-only", "--diff-filter=ACMRT").split("\n").filter(Boolean),
      );
      const missing = [...written, ...deleted].filter((rel) => !staged.has(rel) && !deleted.includes(rel));
      if (missing.length) throw new Error(`git ignored intended path(s): ${missing.join(", ")}`);

      one("commit", "-m", `${agent.name}: ${agent.note}`);
      one("notes", "add", "-m", agent.note, "HEAD");

      // The Artifacts binding cannot resolve refs/notes/*, so intent is served
      // from a `nextgit-notes` branch mirroring the notes ref. Push main and
      // both note refspecs in one command. The mirror is DERIVED state (always :=
      // refs/notes/commits) and forks inherit stale mirrors from the base — without
      // `+` the mirror push is rejected non-ff and intent goes dark (2026-10-10).
      one("push", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes");

      row.status = "ok";
      row.files = changed.map((l) => `${l.slice(0, 2).trim() || "M"} ${l.slice(3).trim()}`).join(", ");
      row.head = one("rev-parse", "--short", "HEAD");
      row.detail = [row.detail, `forked from ${baseline}`, `note → ${agent.note}`].filter(Boolean).join("; ");
    } catch (err) {
      row.status = "fail";
      const stderr = err.stderr ? String(err.stderr).trim().split("\n").filter(Boolean) : [];
      row.detail = (stderr.length ? stderr.slice(-2).join(" ") : err.message).slice(0, 200);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }

  writeAgentManifest(OUT_FILE, minted);

  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n  agent    status  head     note / files");
  console.log(`  ${"-".repeat(72)}`);
  for (const r of results) {
    console.log(`  ${pad(r.agent, 8)} ${pad(r.status, 7)} ${pad(r.head || "-", 8)} ${r.note}`);
    console.log(`  ${" ".repeat(23)} ${r.files || r.detail}`);
    if (r.status !== "ok") console.log(`  ${" ".repeat(23)} ! ${r.detail}`);
  }
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\n  ${ok}/${results.length} agents applied -> ${OUT_FILE}`);

  console.log(`\n  ${minted.length}/${results.length} tokens minted -> ${OUT_FILE} (mode 0600)`);

  await bustProposalsCache("agents");

  if (ok !== results.length) process.exitCode = 1;
}

await main();
