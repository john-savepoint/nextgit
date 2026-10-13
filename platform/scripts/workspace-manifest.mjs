#!/usr/bin/env node
// workspace-manifest.mjs — Law 3 (self-describing platform): ship a workspace
// manifest + structure map into every agent clone so no agent is ever
// context-blind.
//
// Two CLI modes:
//   --repo <dir> --print   Offline tree walk of a repo; emits JSON to stdout.
//   --ensure <dir>         Idempotent writer for clone dirs (writes .nextgit/).
//
// Imports: Node stdlib only.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

const SCHEMA = "nextgit.workspace-manifest/v1";
const STRUCTURE_MAP_SCHEMA = "nextgit.structure-map/v1";
const CONTRACT_VERSION_LINE = /^Version:\s*(\S+)/m;
const PUSH_RECIPE = "git push origin main +refs/notes/commits +refs/notes/commits:refs/heads/nextgit-notes";
const NOTES_REF = "refs/notes/commits";
const NOTES_BRANCH = "nextgit-notes";
const BRANCH_REF = "main";
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Derive the file role from its path suffix. */
function roleForFile(relPath) {
 const lower = relPath.toLowerCase();
 if (lower === "package.json") return "entry";
 if (lower === "tsconfig.json") return "config";
 if (lower.endsWith("wrangler.jsonc") || lower.endsWith(".dev.vars")) return "config";
 if (lower.endsWith(".ts") && (relPath.startsWith("src/") || relPath.includes("/src/"))) return "source";
 if (lower.endsWith(".mjs") || lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".mts")) {
  return (relPath.startsWith("scripts/") || relPath.includes("/scripts/")) ? "script" : "source";
 }
 if (lower.endsWith(".md")) return "docs";
 if (lower.endsWith(".html") || lower.endsWith(".css")) return "ui";
 if (lower.endsWith(".lock") || lower.endsWith("package-lock.json") || lower.endsWith("yarn.lock") || lower.endsWith("bun.lock")) return "lockfile";
 return "data";
}

/** Read a JSON file safely, returning null on failure. */
function readJSON(path) {
 try {
  return JSON.parse(readFileSync(path, "utf8"));
 } catch {
  return null;
 }
}

/** Recursively walk `dir`, returning [{path, bytes, role}]. */
function walkTree(dir) {
 const files = [];

 function walk(currentDir, relPrefix) {
  let entries;
  try {
   entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
   return;
  }
  for (const entry of entries) {
   if (SKIP_DIRS.has(entry.name)) continue;

   const fullPath = join(currentDir, entry.name);
   const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

   if (entry.isDirectory()) {
    walk(fullPath, relPath);
   } else if (entry.isFile()) {
    let bytes = 0;
    try {
     bytes = statSync(fullPath).size;
    } catch {
     bytes = 0;
    }
    if (bytes > 0) {
     files.push({ path: relPath, bytes, role: roleForFile(relPath) });
    }
   }
  }
 }
 walk(dir, "");
 return files;
}

/** Collect direct subdirectory names under the repo root (non-recursive). */
function collectDirs(dir) {
 const dirs = [];
 const entries = readdirSync(dir, { withFileTypes: true });
 for (const entry of entries) {
  if (entry.isDirectory()) {
   dirs.push(entry.name);
  }
 }
 return dirs;
}

/** Collect entry points: files that bootstrap execution. */
function collectEntryPoints(files) {
 const entryPoints = [];
 for (const f of files) {
  if (f.path === "src/index.ts") entryPoints.push(f.path);
  if (f.path === "ui/index.html") entryPoints.push(f.path);
  if (f.path === "package.json") entryPoints.push(f.path);
  if ((f.path.startsWith("scripts/") || f.path.includes("/scripts/")) && (f.path.endsWith(".mjs") || f.path.endsWith(".js"))) {
   entryPoints.push(f.path);
  }
 }
 return entryPoints.sort();
}

/** Read the contract version from CONTRACT.md header. */
function readContractVersion(contractPath) {
 try {
  const text = readFileSync(contractPath, "utf8");
  const match = text.match(CONTRACT_VERSION_LINE);
  return match ? match[1] : "unknown";
 } catch {
  return "unknown";
 }
}

/** Build tools[] from the platform repo's dependency/bindings files. */
function buildTools(platformRoot) {
 const pkg = readJSON(join(platformRoot, "package.json"));
 const wrangler = readJSON(join(platformRoot, "wrangler.jsonc"));
 const tsconfig = readJSON(join(platformRoot, "tsconfig.json"));
 const contractPath = join(platformRoot, "CONTRACT.md");

 const tsTarget = (tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.target) || "ES2024";
 const contractVersion = readContractVersion(contractPath);
 const pushRecipe = PUSH_RECIPE;

 const tools = [];

 // Runtime pins derived from platform/package.json.
 if (pkg) {
  const deps = pkg.dependencies || {};
  for (const [name, version] of Object.entries(deps)) {
   tools.push({ category: "runtime", name, pin: String(version), source: "dependencies" });
  }
  const devDeps = pkg.devDependencies || {};
  for (const [name, version] of Object.entries(devDeps)) {
   tools.push({ category: "runtime", name, pin: String(version), source: "devDependencies" });
  }
 }

 // Platform surface bindings from wrangler.jsonc.
 if (wrangler) {
  if (wrangler.artifacts) {
   for (const a of wrangler.artifacts) {
    if (a.binding) tools.push({ category: "platform", name: a.binding.toLowerCase(), binding: a.binding, type: "artifacts" });
   }
  }
  if (wrangler.ai && wrangler.ai.binding) {
   tools.push({ category: "platform", name: "ai", binding: wrangler.ai.binding, type: "ai" });
  }
  if (wrangler.kv_namespaces) {
   for (const kv of wrangler.kv_namespaces) {
    if (kv.binding) tools.push({ category: "platform", name: kv.binding.toLowerCase(), binding: kv.binding, type: "kv" });
   }
  }
  if (wrangler.assets && wrangler.assets.binding) {
   tools.push({ category: "platform", name: "assets", binding: wrangler.assets.binding, type: "assets" });
  }
  if (wrangler.durable_objects && wrangler.durable_objects.bindings) {
   for (const d of wrangler.durable_objects.bindings) {
    tools.push({ category: "platform", name: d.name.toLowerCase(), binding: d.name, type: "durable_object" });
   }
  }
  if (wrangler.queues && wrangler.queues.consumers) {
   for (const c of wrangler.queues.consumers) {
    tools.push({ category: "platform", name: c.queue, queue: c.queue, type: "queue_consumer" });
   }
  }
 }

 // TS target as a runtime pin context entry.
 tools.push({ category: "runtime", name: "typescript-target", pin: tsTarget, target: tsTarget });

 return { tools, pushRecipe, contractVersion };
}

/**
 * Resolve the platform repo root relative to a starting directory.
 * Looks for `platform/package.json` by walking up the tree, or uses
 * `process.env.NEXTGIT_PLATFORM_ROOT` if set.
 */
function resolvePlatformRoot(startDir) {
 if (process.env.NEXTGIT_PLATFORM_ROOT) {
  return process.env.NEXTGIT_PLATFORM_ROOT;
 }

 // If startDir itself contains package.json, it IS the platform root.
 if (existsSync(join(startDir, "package.json"))) {
  return startDir;
 }

 // Walk up from startDir to find a directory containing platform/package.json.
 const absDir = startDir.startsWith("/") ? startDir : join(process.cwd(), startDir);
 let dir = absDir;
 const parts = dir.split("/");
 while (parts.length > 1) {
  const candidate = parts.join("/");
  if (existsSync(join(candidate, "platform", "package.json"))) {
   return join(candidate, "platform");
  }
  parts.pop();
 }
 throw new Error(`Could not resolve platform root from ${startDir}; set NEXTGIT_PLATFORM_ROOT`);
}

/**
 * Pure function: build the full manifest from pre-walked data.
 * @param {Object} opts - {repo, branch, files, dirs, tools, push, contract}
 * @returns {Object} the full manifest object
 */
function buildManifest({ repo, branch, files, dirs, tools, push, contract }) {
 return {
  schema: SCHEMA,
  generated_at: new Date().toISOString(),
  workspace: { repo, branch, root: repo },
  tools,
  structure: {
   files,
   dirs,
   entry_points: collectEntryPoints(files),
  },
  push,
  contract,
 };
}

/**
 * Assemble manifest + structure map from a platform repo root.
 */
function assembleManifest(platformRoot) {
 const files = walkTree(platformRoot);
 const dirs = collectDirs(platformRoot);
 const { tools, pushRecipe, contractVersion } = buildTools(platformRoot);

 const push = {
  policy: "runner-executed",
  recipe: pushRecipe,
  // Notes + mirror forced (`+`): mirror is derived single-writer state; forks inherit
  // stale mirrors and unforced mirror pushes are rejected non-ff (2026-10-10).
  // Budget: this push is guarded before the wire call — the runner measures the
  // actual git objects it would carry and refuses past 16 MiB (4x under the
  // ~64 MiB Artifacts cap; CONTRACT "Push budget (incremental pushes)").
  refspecs: [BRANCH_REF, `+${NOTES_REF}`, `+refs/notes/commits:refs/heads/${NOTES_BRANCH}`],
 };
 const contract = {
  path: "platform/CONTRACT.md",
  version: contractVersion,
 };

 const manifest = buildManifest({
  repo: "platform",
  branch: "main",
  files,
  dirs,
  tools,
  push,
  contract,
 });

 const structureMap = {
  schema: STRUCTURE_MAP_SCHEMA,
  generated_at: manifest.generated_at,
  workspace: manifest.workspace,
  structure: manifest.structure,
 };

 return { manifest, structureMap };
}

/**
 * Ensure .nextgit/manifest.json and .nextgit/structure-map.json exist in the
 * clone dir, and that .nextgit/ is git-ignored in that clone.
 * @param {string} cloneDir - the clone directory
 */
function ensureWorkspaceFiles(cloneDir) {
 const platformRoot = resolvePlatformRoot(process.cwd());
 const { manifest, structureMap } = assembleManifest(platformRoot);

 const nextgitDir = join(cloneDir, ".nextgit");
 mkdirSync(nextgitDir, { recursive: true });
 writeFileSync(join(nextgitDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
 writeFileSync(join(nextgitDir, "structure-map.json"), JSON.stringify(structureMap, null, 2), "utf8");

 // Verify files were written (throws if missing).
 const manifestPath = join(nextgitDir, "manifest.json");
 const structureMapPath = join(nextgitDir, "structure-map.json");
 if (!existsSync(manifestPath) || !existsSync(structureMapPath)) {
  throw new Error(`Failed to write .nextgit files in ${cloneDir}`);
 }

 // Append .nextgit/ to .git/info/exclude (idempotent — checks if already present).
 const excludePath = join(cloneDir, ".git", "info", "exclude");
 const excludeDir = dirname(excludePath);
 mkdirSync(excludeDir, { recursive: true });

 let excludeContent = "";
 try {
  excludeContent = readFileSync(excludePath, "utf8");
 } catch {
  // File doesn't exist yet — that's fine.
 }

 if (!excludeContent.includes(".nextgit/")) {
  if (excludeContent && !excludeContent.endsWith("\n")) {
   appendFileSync(excludePath, "\n");
  }
  appendFileSync(excludePath, ".nextgit/\n");
 }
}

// CLI entry.
const args = process.argv.slice(2);

if (args.includes("--print")) {
 const repoIdx = args.indexOf("--repo");
 if (repoIdx === -1 || !args[repoIdx + 1]) {
  console.error("--repo <dir> is required for --print");
  process.exit(1);
 }
 const repoDir = args[repoIdx + 1];
 const platformRoot = resolvePlatformRoot(repoDir);
 const { manifest } = assembleManifest(platformRoot);
 process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
} else if (args.includes("--ensure")) {
 const dirIdx = args.indexOf("--ensure");
 if (dirIdx === -1 || !args[dirIdx + 1]) {
  console.error("--ensure <dir> is required");
  process.exit(1);
 }
 const ensureDir = args[dirIdx + 1];
 try {
  ensureWorkspaceFiles(ensureDir);
  process.exit(0);
 } catch (err) {
  console.error(err.message);
  process.exit(1);
 }
}

export { buildManifest, ensureWorkspaceFiles };
