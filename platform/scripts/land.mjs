#!/usr/bin/env node
// land.mjs — fold one or more agent proposals into the baseline.
//
// Asks the worker's /merge endpoint for a per-file 3-way fold against `demo`,
// then replays the result locally: writes merged files, deletes removed ones,
// commits, and pushes to demo/main.
//
// Usage:  node platform/scripts/land.mjs agent-3 [agent-1,agent-2]
//
// Exit codes:
//   0  merged clean, baseline advanced
//   1  conflicts — reports the conflicted files with a marker excerpt
//   2  worker unreachable or returned an unusable response

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const WORKER = process.env.NEXTGIT_WORKER ?? "https://nextgit-platform.john-b7d.workers.dev";
const BASELINE = process.env.NEXTGIT_BASELINE ?? "demo";

const raw = (process.argv[2] ?? "").trim();
if (!raw) {
  console.error("usage: node land.mjs <repo[,repo...]>");
  process.exit(2);
}
const repos = raw.split(",").map((s) => s.trim()).filter(Boolean);

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

async function call(method, url, body, headers) {
  const res = await fetch(url, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
}

/** Ask the worker for a folded merge of `repos` onto the baseline. */
async function foldMerge() {
  const url = `${WORKER}/merge?base=${encodeURIComponent(BASELINE)}&repos=${encodeURIComponent(repos.join(","))}`;
  const res = await fetch(url, { headers: { "User-Agent": "nextgit-land/1.0" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const detail = body?.error ?? `HTTP ${res.status}`;
    throw new Error(`worker /merge failed: ${detail}`);
  }
  if (!body.merge || !Array.isArray(body.merge.files)) throw new Error("worker /merge returned no merge object");
  return body.merge;
}

const merge = await foldMerge().catch((err) => {
  console.error(`\n  cannot reach ${WORKER} — ${err.message}`);
  console.error("  the baseline is untouched.\n");
  process.exit(2);
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  land ${repos.join(", ")} → ${BASELINE}`);
console.log(`  ${"-".repeat(60)}`);

for (const f of merge.files) {
  console.log(`  ${pad(f.result, 16)} ${pad(f.action ?? "-", 7)} ${f.path}${f.note ? `   (${f.note})` : ""}`);
}

if (merge.status === "conflict") {
  console.log(`\n  conflicts in: ${merge.conflicted.join(", ")}\n`);
  for (const f of merge.files.filter((x) => x.result === "conflict")) {
    const text = String(f.conflictText ?? "");
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith("<<<<<<<"));
    const from = at < 0 ? 0 : Math.max(0, at - 1);
    console.log(`  --- ${f.path} ---`);
    console.log(
      lines
        .slice(from, from + 9)
        .map((l) => `  | ${l}`)
        .join("\n"),
    );
    if (lines.length > from + 9) console.log(`  | … ${lines.length - from - 9} more lines`);
    console.log("");
  }
  console.error("  baseline unchanged — resolve the conflict before landing.\n");
  process.exit(1);
}

const withheld = merge.files.filter((f) => f.result === "withheld-secret");
if (withheld.length) {
  console.log(`\n  withheld (secret-class, never materialized): ${withheld.map((f) => f.path).join(", ")}`);
}

// ---- replay the merge locally ------------------------------------------------

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const headers = { Authorization: `Bearer ${apiToken()}` };

const minted = await call("POST", `${apiBase}/tokens`, { repo: BASELINE, scope: "write", ttl: 3600 }, headers).catch((err) => {
  console.error(`\n  could not mint a write token for ${BASELINE}: ${err.message}\n`);
  process.exit(2);
});

const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraheader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${minted.plaintext}`,
};

const dir = mkdtempSync(join(tmpdir(), "nextgit-land-"));
const git = (...args) =>
  execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const one = (...args) => git(...args).trim();

try {
  one("clone", `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${BASELINE}.git`, dir);
  const before = one("rev-parse", "--short", "HEAD");
  one("config", "user.name", "platform-bot");
  one("config", "user.email", "bot@nextgit.dev");
  one("config", "core.excludesFile", "/dev/null");

  let touched = 0;
  for (const f of merge.files) {
    if (f.action === "delete") {
      rmSync(join(dir, f.path), { force: true });
      touched++;
    } else if (f.action === "write" && typeof f.merged === "string") {
      const abs = join(dir, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.merged, "utf8");
      touched++;
    }
  }

  const changed = git("status", "--porcelain").split("\n").filter(Boolean);
  if (!changed.length) {
    console.log(`\n  no tree change — ${BASELINE} already at ${before}\n`);
    process.exit(0);
  }

  one("add", "-A");
  one("commit", "-m", `land(${merge.repos.join(",")}): merge into baseline`);
  one("push", "origin", "HEAD:refs/heads/main");

  console.log(`\n  land(${merge.repos.join(",")}): merge into baseline`);
  for (const l of changed) console.log(`  ${pad(l.slice(0, 2).trim() || "M", 3)} ${l.slice(3).trim()}`);
  console.log(`\n  ${BASELINE}/main ${before} → ${one("rev-parse", "--short", "HEAD")}  (${touched} file(s) applied)\n`);
} catch (err) {
  const stderr = err.stderr ? String(err.stderr).trim().split("\n").slice(-3).join(" ") : err.message;
  console.error(`\n  local replay failed: ${stderr}\n`);
  process.exit(2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
