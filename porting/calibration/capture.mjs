#!/usr/bin/env node
// capture.mjs — Capture real proposal change-sets into proposals/<id>.json.
//
// Reads live git clones from /tmp/real-agents/ (or --clones-dir), extracts the
// diff against the fork point (parent commit), reads intent from git notes, and
// writes JudgeRepoInput-shaped JSON fixtures.
//
// Secret-class paths (per isSecretPath in index.ts:249-254) are masked:
// no patch, no intent, keys[] only — never values.
//
// Usage: node porting/calibration/capture.mjs [--clones-dir <path>] [--limit <n>]
//   --clones-dir  directory containing git clone subdirectories (default: /tmp/real-agents)
//   --limit       cap the number of clones to process (default: all found)
//
// Output: porting/calibration/judge-v1/proposals/*.json + capture-manifest.json
//
// No model calls, no network. Pure git + file I/O.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAX_PATCH_CHARS = 30_000;

// Mirror of isSecretPath from platform/src/index.ts:249-254.
// Path matches: basename .env*, *.pem, *.key, *.p12, credentials.json,
// secrets.json, .dev.vars, or any path containing "secrets/".
const SECRET_BASENAMES = new Set(["credentials.json", "secrets.json", ".dev.vars"]);

function isSecretPath(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.startsWith(".env")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) return true;
  if (SECRET_BASENAMES.has(base)) return true;
  return path.includes("secrets/");
}

const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function secretKeys(text) {
  const keys = [];
  for (const line of text.split("\n")) {
    if (!SECRET_KEY_RE.test(line)) continue;
    const key = line.slice(0, line.indexOf("="));
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Run git, return stdout (trimmed). Throws on error.
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

// Run git, return stdout (trimmed) or "" on failure.
function gitSafe(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}

// Check if a path exists at a given git ref using ls-tree.
function fileExistsAt(ref, path, cwd) {
  try {
    const output = execFileSync("git", ["ls-tree", "-r", ref, "--name-only"], {
      cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return output.split("\n").filter(Boolean).includes(path);
  } catch {
    return false;
  }
}

// Parse additions/deletions from a git diff output.
function parseDiffStats(diffText) {
  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("--")) deletions++;
  }
  return { additions, deletions };
}

// Truncate patch at MAX_PATCH_CHARS with the same note as index.ts:532-533.
function truncatePatch(patch) {
  if (patch.length > MAX_PATCH_CHARS) {
    return patch.slice(0, MAX_PATCH_CHARS) + `\n... [patch truncated at ${MAX_PATCH_CHARS} chars]`;
  }
  return patch;
}

function captureClone(cloneDir, repoName) {
  const headSha = gitSafe(["rev-parse", "HEAD"], cloneDir);
  if (!headSha) return null;

  // Fork point = parent of HEAD (each clone has exactly one agent commit on top
  // of the baseline, so HEAD~1 is the fork point — same as the real agent clones).
  const forkSha = gitSafe(["rev-parse", "HEAD~1"], cloneDir);
  if (!forkSha) return null;

  // Intent from git notes on HEAD.
  const intentRaw = gitSafe(["notes", "show", "HEAD"], cloneDir);
  const intent = intentRaw ? (intentRaw.length > 500 ? intentRaw.slice(0, 500) + "…" : intentRaw) : undefined;

  // Changed files between fork point and HEAD.
  const nameOnly = gitSafe(["diff", "--name-only", forkSha, "HEAD"], cloneDir);
  const paths = nameOnly ? nameOnly.split("\n").filter(Boolean).sort() : [];

  // Sort files by path (localeCompare) — mirrors index.ts:473.
  paths.sort((a, b) => a.localeCompare(b));

  const files = [];
  for (const path of paths) {
    // Determine status: added if absent at fork, removed if absent at HEAD, modified.
    const atHead = fileExistsAt("HEAD", path, cloneDir);
    const atFork = fileExistsAt(forkSha, path, cloneDir);
    let status;
    if (!atFork) status = "added";
    else if (!atHead) status = "removed";
    else status = "modified";

    // Get the diff for this file.
    const diff = gitSafe(["diff", forkSha, "HEAD", "--", path], cloneDir);
    const { additions, deletions } = parseDiffStats(diff);

    if (isSecretPath(path)) {
      // Secret-class: no patch, no intent, keys only.
      // Read the file content to extract keys (from the surviving side).
      let secretText = "";
      if (status !== "removed") {
        secretText = gitSafe(["show", `HEAD:${path}`], cloneDir);
      } else {
        secretText = gitSafe(["show", `${forkSha}:${path}`], cloneDir);
      }
      const keys = secretKeys(secretText);
      files.push({ path, status, additions, deletions, secret: true, keys });
    } else {
      const patch = truncatePatch(diff);
      const fileInput = { path, status, additions, deletions, patch };
      files.push(fileInput);
    }
  }

  const repoInput = { repo: repoName };
  if (intent) repoInput.intent = intent;
  repoInput.files = files;

  return { repoInput, forkSha, headSha, intent };
}

// ---- Main ----
const clonesDir = process.argv.includes("--clones-dir")
  ? process.argv[process.argv.indexOf("--clones-dir") + 1]
  : "/tmp/real-agents";

const limit = process.argv.includes("--limit")
  ? Number(process.argv[process.argv.indexOf("--limit") + 1])
  : undefined;

const outDir = join(process.cwd(), "porting/calibration/judge-v1");
const proposalsDir = join(outDir, "proposals");
mkdirSync(proposalsDir, { recursive: true });

// Find all git clone directories (directories that are git repos).
const entries = readdirSync(clonesDir, { withFileTypes: true });
const cloneDirs = entries
  .filter((e) => e.isDirectory())
  .filter((e) => existsSync(join(clonesDir, e.name, ".git")))
  .map((e) => e.name)
  .sort();

const toProcess = limit ? cloneDirs.slice(0, limit) : cloneDirs;

const manifest = [];
let captured = 0;
const errors = [];

for (const name of toProcess) {
  const cloneDir = join(clonesDir, name);
  try {
    const result = captureClone(cloneDir, name);
    if (!result) {
      errors.push({ name, error: "no HEAD or fork point" });
      continue;
    }

    const id = `${name}-${result.headSha.slice(0, 8)}`;
    const fixturePath = join(proposalsDir, `${id}.json`);
    writeFileSync(fixturePath, JSON.stringify(result.repoInput, null, 2) + "\n");

    manifest.push({
      id,
      repo: name,
      headSha: result.headSha,
      forkSha: result.forkSha,
      source: cloneDir,
      capturedAt: new Date().toISOString(),
      intent: result.intent || null,
      fileCount: result.repoInput.files.length,
    });

    captured++;
  } catch (e) {
    errors.push({ name, error: e.message });
  }
}

writeFileSync(
  join(proposalsDir, "capture-manifest.json"),
  JSON.stringify({ proposals: manifest, errors }, null, 2) + "\n"
);

console.log(`Captured: ${captured} proposals`);
if (errors.length > 0) {
  console.error(`Errors: ${errors.length}`);
  for (const e of errors) console.error(`  ${e.name}: ${e.error}`);
}
console.log(`Output: ${proposalsDir}/`);
