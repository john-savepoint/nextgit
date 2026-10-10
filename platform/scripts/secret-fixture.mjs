#!/usr/bin/env node
// secret-fixture.mjs — put the secret-class beat on the demo canvas (agent-5).
//
// Forks `agent-5` fresh from the `demo` baseline, writes exactly one file —
// `config/.env` with two fake placeholder lines — commits it with an intent
// note, and pushes main + the notes-mirror refspec, exactly like the real
// agents do (CONTRACT "Notes mirror"). The platform must then render the row
// schema-only (keys[] only, no patch, no intent) and POST /judge must skip
// the repo as secret-class.
//
// Deterministic + idempotent: agent-5 is dropped and re-forked from the
// current demo head on every run, so re-running converges to the same state
// (same commit sha while the demo head is unchanged — metadata is pinned).
//
// Usage:  node platform/scripts/secret-fixture.mjs
// Output: /tmp/nextgit-agents.json — agent-5 entry merged in (fleet manifest)
//
// MUST NOT: push to `demo` or any repo other than `agent-5`; call /land;
// print tokens. The two values in config/.env are fake by design — the
// platform's masking law (CONTRACT "Secret classes") is what keeps them out
// of every response body.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const OUT_FILE = process.env.AGENTS_OUT ?? "/tmp/nextgit-agents.json";

const BASE = "demo";   // fork source (read-only for this script)
const REPO = "agent-5"; // the only repo this script writes
const TTL = 604800;

const ENV_PATH = "config/.env";
const ENV_LINES = [
  "DATABASE_URL=postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app",
  "REDIS_URL=redis://cache.internal:6379",
];
const ENV_CONTENT = `${ENV_LINES.join("\n")}\n`;
const NOTE = "Config: add local dev environment file";
const COMMIT_MESSAGE = `${REPO}: add config/.env (secret fixture)`;
// Pinned metadata: same demo head + same content + same metadata => same sha.
const PINNED_DATE = "2026-10-06T00:00:00Z";

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
const headers = { Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" };

async function call(method, url, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fork `name` fresh; the post-delete lag can still answer "already exists". */
async function forkFresh(name) {
  const url = `${apiBase}/repos/${BASE}/fork`;
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

async function main() {
  // Drop a stale agent-5 so every run is a pristine fork of the current demo
  // head (reset semantics, exactly like real-agents prepareFork).
  const repos = await call("GET", `${apiBase}/repos?limit=200`);
  const dropped = repos.some((r) => r.name === REPO);
  if (dropped) {
    await call("DELETE", `${apiBase}/repos/${REPO}`);
    await sleep(1200); // deletes are eventually consistent
  }
  const fork = await forkFresh(REPO);
  // Wait for the fork to MATERIALIZE before cloning: cloning mid-fork can yield an empty
  // repo → the fixture commit becomes a root commit → push rejected non-ff against the
  // demo-head main (observed 2026-10-10). Pattern: fanout.mjs / agents.mjs prep.
  for (let i = 0; i < 30; i++) {
    const page = await call("GET", `${apiBase}/repos?limit=200`);
    const row = page.find((r) => r.name === REPO);
    if (row && row.status === "ready") break;
    await sleep(1000);
  }
  const tok = await call("POST", `${apiBase}/tokens`, { repo: REPO, scope: "write", ttl: TTL });

  // The token rides an env header, never argv.
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: PINNED_DATE,
    GIT_COMMITTER_DATE: PINNED_DATE,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tok.plaintext}`,
  };
  const dir = mkdtempSync(join(tmpdir(), "nextgit-secret-fixture-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const one = (...args) => git(...args).trim();

  try {
    one("clone", fork.remote, dir);
    one("config", "user.name", REPO);
    one("config", "user.email", "agent5@nextgit.dev");
    // The host's global gitignore excludes .env; ignore rules must come from
    // the repo alone so `git add -A` cannot silently skip the fixture.
    one("config", "core.excludesFile", "/dev/null");

    const abs = join(dir, ENV_PATH);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, ENV_CONTENT, "utf8");

    // Fail closed at three seams: written bytes, staged path, committed bytes.
    if (readFileSync(abs, "utf8") !== ENV_CONTENT) throw new Error(`${ENV_PATH}: bytes differ after write`);
    if (ENV_CONTENT.replace(/\n$/, "").split("\n").length !== 2) throw new Error(`${ENV_PATH}: not exactly two lines`);

    const changed = git("status", "--porcelain").split("\n").filter(Boolean);
    if (!changed.length) throw new Error(`no change in ${REPO} — fixture already current`);

    one("add", "-A");
    const staged = new Set(one("diff", "--cached", "--name-only", "--diff-filter=ACMRT").split("\n").filter(Boolean));
    if (!staged.has(ENV_PATH)) throw new Error(`git ignored intended path: ${ENV_PATH}`);

    one("commit", "-m", COMMIT_MESSAGE);
    if (git("show", `HEAD:${ENV_PATH}`) !== ENV_CONTENT) throw new Error(`HEAD:${ENV_PATH}: committed bytes differ`);

    // Intent travels as a git note mirrored to a branch (CONTRACT "Notes
    // mirror"). The row must NOT surface this note — secret-class law.
    one("notes", "add", "-m", NOTE, "HEAD");
    // Forced mirror (derived state: mirror := refs/notes/commits). Forks inherit stale
    // mirrors from the base; an unforced push is rejected non-ff (2026-10-10).
    one("push", "origin", "main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes");

    const head = one("rev-parse", "HEAD");
    const remoteHead = one("ls-remote", "origin", "refs/heads/main").split("\t")[0];
    if (remoteHead !== head) throw new Error(`remote main ${remoteHead} != local ${head}`);

    // Fleet manifest, merged by name (seed/fanout/real-agents convention).
    const prev = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")) : [];
    const merged = [
      ...new Map(
        [...prev, { name: REPO, remote: fork.remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at }].map(
          (m) => [m.name, m],
        ),
      ).values(),
    ];
    writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));

    console.log(`${dropped ? "dropped + " : ""}forked ${REPO} <- ${BASE}`);
    console.log(`wrote   ${ENV_PATH} (2 lines, keys: ${ENV_LINES.map((l) => l.slice(0, l.indexOf("="))).join(", ")})`);
    console.log(`pushed  main + refs/notes/commits + refs/heads/nextgit-notes @ ${head.slice(0, 8)}`);
    console.log(`note    ${JSON.stringify(NOTE)} (must NOT surface as intent — secret-class law)`);
    console.log(`manifest -> ${OUT_FILE} (${merged.length} agents)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  const stderr = err.stderr ? String(err.stderr).trim().split("\n").filter(Boolean) : [];
  console.error(`secret-fixture: FAILED — ${stderr.length ? stderr.slice(-2).join(" ") : err.message}`);
  process.exitCode = 1;
});
