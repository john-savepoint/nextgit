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

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveTtl, mintRepoToken, writeAgentManifest, formatAgentRow } from "./lib/tokens.mjs";
export { resolveTtl };

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const OUT_FILE = process.env.AGENTS_OUT ?? "/tmp/nextgit-agents.json";
const CACHE_ID = process.env.CACHE_NAMESPACE_ID ?? "55d973240e2d4770a07ddc0faedf757c"; // platform/wrangler.jsonc CACHE

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

  // Lineage seam (CAP-10): after a successful fork, record the
  // baseline head at fork time — the fork point — as the fork's
  // `fork:<name>` record in the CACHE KV namespace (the
  // script-writable durable namespace, the bust-cache.mjs
  // precedent; LIVE is worker-single-writer, NFR-7).
  // {repo, forkPoint} is verbatim the contract's GET /forks
  // `upstream` payload, so /forks serves the record as-is and
  // POST /upstream reads lineage.repo as the parent.
  //
  // Fork-point resolution: a `default_branch_only` fork copies
  // the baseline's default-branch tip, so the baseline head at
  // fork time IS the fork point. `git ls-remote` runs with a
  // READ-scoped repo token (narrowest scope) over the git-over-
  // HTTPS remote — the real-agents.mjs/agents.mjs spawnSync
  // idiom; the token rides GIT_CONFIG_VALUE_0, invisible to
  // ps (the FR-36 argv law: credentials ride GIT_CONFIG_*, never argv).
  const recordLineage = async (repoName, readToken) => {
    try {
      const baselineRemote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${baseline}.git`;
      const ls = spawnSync(
        "git",
        ["ls-remote", baselineRemote, `refs/heads/main`],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraheader",
            GIT_CONFIG_VALUE_0: `Authorization: Bearer ${readToken}`,
          },
        },
      );
      if (ls.status !== 0) throw new Error(`ls-remote: ${ls.stderr}`);
      const m = ls.stdout.match(/^([0-9a-f]{40})\trefs\/heads\/main$/m);
      if (!m) throw new Error(`ls-remote: no main ref in ${JSON.stringify(ls.stdout)}`);
      const forkPoint = m[1];
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${CACHE_ID}/values/${encodeURIComponent(`fork:${repoName}`)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ repo: baseline, forkPoint }),
        },
      );
      if (!res.ok) throw new Error(`KV PUT HTTP ${res.status}`);
      console.log(`lineage  ${repoName} -> ${baseline}@${forkPoint.slice(0, 12)}`);
    } catch (e) {
      // Best-effort: a resolution/write failure never fails the fork.
      console.log(`lineage-record-failed  ${repoName} (${e?.message ?? e})`);
    }
  };

  const agents = [];
  for (let i = 1; i <= count; i++) {
    const name = `agent-${i}`;
    let forked = false;
    let remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${name}.git`;

    if (!existing.has(name)) {
      const res = await call("POST", `${base}/repos/${baseline}/fork`, { name, default_branch_only: true });
      remote = res.remote;
      forked = true;
      // Record the lineage seam: the baseline head at fork time is
      // the fork point (a default_branch_only fork copies the
      // default-branch tip). A read-scoped token resolves it; the
      // record itself PUTs over the KV REST API with the account
      // token (repo tokens never authenticate the control plane).
      const readTok = await call("POST", `${base}/tokens`, { repo: baseline, scope: "read", ttl });
      await recordLineage(name, readTok.plaintext);
    }

    const tok = await mintRepoToken(call, { base, repo: name, ttl, headers });
    agents.push({ name, remote, token: tok.plaintext, scope: tok.scope, expires_at: tok.expires_at });
    console.log(`${forked ? "forked" : "exists"}  ${name}`);
  }

  writeAgentManifest(OUT_FILE, agents);
  console.log(`\n${agents.length} agent workspaces -> ${OUT_FILE}`);
  for (const a of agents) console.log(`  ${formatAgentRow(a)}`);
}
