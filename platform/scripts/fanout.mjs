#!/usr/bin/env node
// fanout.mjs — ensure N agent workspaces exist as forks of a baseline Artifacts repo,
// each minted with a fresh write token.
//
// Dev utility for building the demo. The platform will grow a first-class
// provisioning path (Worker API / Workflow) later; this script unblocks build steps.
//
// Usage:  node platform/scripts/fanout.mjs [count] [baseline] [ttlSeconds]
//         count      (default 4)       → forks agent-1 .. agent-N
//         baseline   (default "demo")
//         ttlSeconds (default 86400 = 24h, max 604800 = 7d - FR-36)
//
// Auth:   CLOUDFLARE_API_TOKEN if set, else the wrangler OAuth token on this machine.
// Output: /tmp/nextgit-agents.json — [{ name, remote, token, scope, expires_at }]

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const OUT_FILE = process.env.AGENTS_OUT ?? "/tmp/nextgit-agents.json";

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

// Resolve and validate ttlSeconds: default 86400 (24h), clamped to 604800 (7d max,
// FR-36), reject anything below 60s. Pure function for testability.
export function resolveTtl(raw) {
  const n = Number(raw ?? 86400);
  if (Number.isNaN(n)) throw new Error("ttlSeconds must be a number");
  if (n < 60) throw new Error("ttlSeconds must be >= 60 seconds");
  return Math.min(n, 604800);
}

const count = Number(process.argv[2] ?? 4);
const baseline = process.argv[3] ?? "demo";
const ttl = resolveTtl(process.argv[4]);

const isMain = () => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
};

if (isMain()) {
  const token = apiToken();
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method, url, body) {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
    return data.result;
  }

  const repos = await call("GET", `${base}/repos?limit=200`);
  const existing = new Set(repos.map((r) => r.name));

  const agents = [];
  for (let i = 1; i <= count; i++) {
    const name = `agent-${i}`;
    let forked = false;
    let remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${name}.git`;

    if (!existing.has(name)) {
      const res = await call("POST", `${base}/repos/${baseline}/fork`, { name, default_branch_only: true });
      remote = res.remote;
      forked = true;
    }

    const tok = await call("POST", `${base}/tokens`, { repo: name, scope: "write", ttl });
    agents.push({ name, remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at });
    console.log(`${forked ? "forked" : "exists"}  ${name}`);
  }

  writeFileSync(OUT_FILE, JSON.stringify(agents, null, 2), { mode: 0o600 });
  console.log(`\n${agents.length} agent workspaces -> ${OUT_FILE}`);
  for (const a of agents) console.log(`  ${a.name}  (token expires ${a.expires_at})`);
}
