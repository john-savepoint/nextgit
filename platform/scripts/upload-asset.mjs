#!/usr/bin/env node
// upload-asset.mjs — upload one asset to the R2 asset tier (AD-10; FR-47).
//
// Control-plane path (AD-7): the R2 write runs under the OPERATOR's
// wrangler auth — never minted into any subprocess env; only the git
// push uses a repo-scoped token, riding GIT_CONFIG_* (fanout.mjs
// precedent, FR-36 argv law).
//
// 1. Read the local file; compute sha256 + size (node:crypto).
// 2. PUT the blob to the R2 bucket (`nextgit-asset-blobs`, pinned
//    by the first slice) under the content-addressed key
//    (blobId = sha256 hex) via the wrangler R2 API, operator auth.
// 3. Write the pointer file `assets/<name>.asset.json` into the
//    scratch `agent-r2e-*` repo over git-over-HTTPS (one commit,
//    repo-scoped write token).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveTtl, mintRepoToken } from "./lib/tokens.mjs";
export { resolveTtl };

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const BUCKET = process.env.R2_BUCKET ?? "nextgit-asset-blobs";

const [localFile, assetName, agentRepo = "agent-r2e-1"] = process.argv.slice(2);
if (!localFile || !assetName) {
  console.error("usage: node platform/scripts/upload-asset.mjs <local-file> <asset-name> [agent-repo]");
  process.exit(2);
}

function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    `${process.env.HOME ?? ""}/.config/.wrangler/config/default.toml`,
    `${process.env.LOCALAPPDATA ?? ""}\\.wrangler\\config\\default.toml`,
  ];
  for (const p of candidates) {
    try {
      const toml = readFileSync(p, "utf8");
      const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch { /* next candidate */ }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

const isMain = () => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
};

if (isMain()) {
  const token = apiToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method, url, body) {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(`${method} ${url} -> ${JSON.stringify(data.errors ?? data)}`);
    return data.result;
  }

  // 1. Local file -> blob bytes + sha256 + size.
  const blob = new Uint8Array(readFileSync(localFile));
  const sha256 = createHash("sha256").update(blob).digest("hex");
  const size = blob.length;
  const contentType = (() => {
    const ext = basename(localFile).split(".").pop()?.toLowerCase() ?? "";
    const table = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", json: "application/json", txt: "text/plain" };
    return table[ext];
  })();
  const pointer = { v: 1, blobId: sha256, sha256, size, ...(contentType ? { contentType } : {}) };

  // 2. R2 PUT under the operator's account auth (control plane
  //    owns credentials, AD-7). The blob key is the
  //    content-addressed sha256 hex — never a URL, never a
  //    presigned target.
  const putUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/r2/buckets/${BUCKET}/objects/${encodeURIComponent(sha256)}`;
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    body: blob,
  });
  if (!putRes.ok) throw new Error(`R2 PUT HTTP ${putRes.status}: ${await putRes.text()}`);
  console.log(`r2-put  ${BUCKET}/${sha256} (${size} bytes)`);

  // 3. Commit the pointer file into the scratch repo over
  //    git-over-HTTPS. The repo-scoped write token rides
  //    GIT_CONFIG_* (invisible to ps; the FR-36 argv law)
  //    and is the ONLY credential handed to a subprocess —
  //    the R2 write above ran under the operator's own auth.
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
  const tok = await mintRepoToken(call, { base, repo: agentRepo, ttl: resolveTtl(3600), headers });
  const remote = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${agentRepo}.git`;
  const pointerPath = `assets/${assetName}.asset.json`;
  const pointerText = `${JSON.stringify(pointer, null, 2)}\n`;

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tok.plaintext.split("?expires=")[0]}`,
  };
  const workDir = await mkdtemp(`${process.env.TMPDIR ?? "/tmp"}/nextgit-upload-`);
  const run = (args) => spawnSync("git", args, { cwd: workDir, encoding: "utf8", env: gitEnv });
  const step = (label, res) => {
    if (res.status !== 0) throw new Error(`${label}: ${res.stderr}`);
  };

  step("git init", run(["init", "--initial-branch=main"]));
  step("git remote add", run(["remote", "add", "origin", remote]));
  step("git fetch", run(["fetch", "--depth=1", "origin", "main"]));
  step("git checkout", run(["checkout", "-B", "main", "FETCH_HEAD"]));
  await mkdir(`${workDir}/assets`, { recursive: true });
  await writeFile(`${workDir}/${pointerPath}`, pointerText);
  step("git add", run(["add", pointerPath]));
  const commit = run(["commit", "-m", `asset: ${assetName} → R2 ${sha256.slice(0, 12)} (${size} bytes)`]);
  if (commit.status !== 0 && !commit.stdout.includes("nothing to commit")) throw new Error(`git commit: ${commit.stderr}`);
  step("git push", run(["push", "origin", "main"]));

  console.log(`pointer ${pointerPath} committed to ${agentRepo}@main`);
  console.log(JSON.stringify(pointer, null, 2));
}
