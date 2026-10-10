#!/usr/bin/env node
// Test suite for platform/scripts/workspace-manifest.mjs.
// Run: node porting/tests/workspace-manifest.test.mjs   (exit 0 = pass)
//
// Guards the Law 3 manifest contract: --print emits the schema, --ensure
// materializes + git-ignores + leaves no pollution, idempotency holds, role
// classification is correct, and excluded dirs are absent.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PLATFORM = process.env.NEXTGIT_PLATFORM_ROOT
 ? join(process.env.NEXTGIT_PLATFORM_ROOT)
 : join(process.cwd(), "platform");

let fails = 0;
const check = (name, ok, detail = "") => {
 if (!ok) fails++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// Helper: spawn the script synchronously.
function runScript(args, cwd = process.cwd()) {
 return spawnSync("node", ["platform/scripts/workspace-manifest.mjs", ...args], {
  cwd,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
 });
}

// 1. --print schema contract
{
 const res = runScript(["--repo", "platform", "--print"], process.cwd());
 check("1 --print exits 0", res.status === 0, res.stderr?.slice(0, 200));
 let manifest;
 try {
  manifest = JSON.parse(res.stdout);
 } catch (e) {
  check("1 --print stdout is valid JSON", false, e.message);
  manifest = null;
 }
 if (manifest) {
  check("1 schema === nextgit.workspace-manifest/v1", manifest.schema === "nextgit.workspace-manifest/v1", manifest.schema);
  check("1 tools.length > 0", Array.isArray(manifest.tools) && manifest.tools.length > 0, `tools=${manifest.tools?.length}`);
  check("1 structure.files.length > 0", Array.isArray(manifest.structure?.files) && manifest.structure.files.length > 0, `files=${manifest.structure?.files?.length}`);
  check("1 push recipe contains refs/notes/commits", manifest.push?.recipe?.includes("refs/notes/commits") === true, manifest.push?.recipe);
  check("1 push recipe contains all three refspecs (forced notes+mirror)",
   manifest.push?.recipe?.includes("+refs/notes/commits") &&
   manifest.push?.recipe?.includes("+refs/notes/commits:refs/heads/nextgit-notes") &&
   manifest.push?.recipe?.includes("main"),
   manifest.push?.recipe);
  check("1 push.refspecs has exactly 3 entries",
   Array.isArray(manifest.push?.refspecs) && manifest.push.refspecs.length === 3,
   `refspecs=${JSON.stringify(manifest.push?.refspecs)}`);
  const expectedRefspecs = ["main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes"];
  check("1 push.refspecs matches expected three refspecs (main bare, notes+mirror forced)",
   JSON.stringify(manifest.push?.refspecs) === JSON.stringify(expectedRefspecs),
   `refspecs=${JSON.stringify(manifest.push?.refspecs)}`);

  const entryPoints = manifest.structure?.entry_points || [];
  const expectedScripts = ["scripts/agents.mjs", "scripts/demo-verify.mjs", "scripts/fanout.mjs", "scripts/land.mjs", "scripts/real-agents.mjs", "scripts/reset-agent-1.mjs", "scripts/secret-fixture.mjs", "scripts/seed.mjs", "scripts/workspace-manifest.mjs"];
  const foundScripts = expectedScripts.filter((s) => entryPoints.includes(s));
  check("1 entry_points includes all harness scripts",
   foundScripts.length === expectedScripts.length,
   `found ${foundScripts.length}/${expectedScripts.length}: ${JSON.stringify(foundScripts)}`);
  check("1 workspace.repo === platform", manifest.workspace?.repo === "platform", manifest.workspace?.repo);
  check("1 workspace.branch === main", manifest.workspace?.branch === "main", manifest.workspace?.branch);
 } else {
  check("1 manifest parsed", false, "manifest was null");
 }
}

// 4. Role classification
{
 const res = runScript(["--repo", "platform", "--print"], process.cwd());
 let manifest;
 try {
  manifest = JSON.parse(res.stdout);
 } catch {
  check("4 role: parse manifest", false, "JSON parse failed");
  manifest = null;
 }
 if (manifest) {
  const find = (suffix) => manifest.structure.files.find((f) => f.path.endsWith(suffix));
  const idxFile = find("src/index.ts");
  check("4 role: src/index.ts is 'source'", idxFile?.role === "source", idxFile?.role);

  const seedFile = find("scripts/seed.mjs");
  check("4 role: scripts/seed.mjs is 'script'", seedFile?.role === "script", seedFile?.role);

  const tsconfigFile = find("tsconfig.json");
  check("4 role: tsconfig.json is 'config'", tsconfigFile?.role === "config", tsconfigFile?.role);

  const contractFile = find("CONTRACT.md");
  check("4 role: CONTRACT.md is 'docs'", contractFile?.role === "docs", contractFile?.role);

  const wranglerFile = find("wrangler.jsonc");
  check("4 role: wrangler.jsonc is 'config'", wranglerFile?.role === "config", wranglerFile?.role);

  const pkgFile = find("package.json");
  check("4 role: package.json is 'entry'", pkgFile?.role === "entry", pkgFile?.role);
 } else {
  check("4 roles: manifest parse", false);
 }
}

// 5. Exclusion: no .git/ or node_modules/ paths
{
 const res = runScript(["--repo", "platform", "--print"], process.cwd());
 let manifest;
 try {
  manifest = JSON.parse(res.stdout);
 } catch {
  check("5 exclusion: parse manifest", false);
  manifest = null;
 }
 if (manifest) {
  const badGit = manifest.structure.files.some((f) => f.path.startsWith(".git/"));
  check("5 exclusion: no .git/ paths", !badGit, badGit ? "found .git/ entries" : "");

  const badNodeModules = manifest.structure.files.some((f) => f.path.includes("node_modules/"));
  check("5 exclusion: no node_modules/ paths", !badNodeModules, badNodeModules ? "found node_modules entries" : "");
 }
}

// 2. --ensure materializes + ignores + no pollution
{
 const d = mkdtempSync(join(tmpdir(), "wm-test-"));
 try {
  // Initialize an empty git repo so .git/info/exclude can be written.
  const gitRes = spawnSync("git", ["init", "-q"], { cwd: d, encoding: "utf8" });
  check("2 git init", gitRes.status === 0, gitRes.stderr?.slice(0, 200));

  const res = runScript(["--ensure", d], process.cwd());
  check("2 --ensure exits 0", res.status === 0, res.stderr?.slice(0, 200));

  const manifestExists = existsSync(join(d, ".nextgit", "manifest.json"));
  check("2 .nextgit/manifest.json exists", manifestExists, manifestExists ? "" : "file not found");

  const mapExists = existsSync(join(d, ".nextgit", "structure-map.json"));
  check("2 .nextgit/structure-map.json exists", mapExists, mapExists ? "" : "file not found");

  // git check-ignore: .nextgit/manifest.json should be ignored
  const ignoreRes = spawnSync("git", ["check-ignore", "-q", ".nextgit/manifest.json"], { cwd: d, encoding: "utf8" });
  check("2 .nextgit/manifest.json is git-ignored", ignoreRes.status === 0, `exit=${ignoreRes.status}`);

  // git status --porcelain should be empty (no pollution)
  const statusRes = spawnSync("git", ["status", "--porcelain"], { cwd: d, encoding: "utf8" });
  check("2 no git pollution (status porcelain empty)", statusRes.stdout.trim() === "", `status=${JSON.stringify(statusRes.stdout.slice(0, 200))}`);

  // 6. Structure map schema
  if (mapExists) {
   let structureMap;
   try {
    structureMap = JSON.parse(readFileSync(join(d, ".nextgit", "structure-map.json"), "utf8"));
   } catch (e) {
    check("6 structure-map: parse JSON", false, e.message);
    structureMap = null;
   }
   if (structureMap) {
    check("6 structure-map schema === nextgit.structure-map/v1", structureMap.schema === "nextgit.structure-map/v1", structureMap.schema);
    check("6 structure-map files.length > 0", structureMap.structure?.files?.length > 0, `files=${structureMap.structure?.files?.length}`);
   }
  }
 } finally {
  rmSync(d, { recursive: true, force: true });
 }
}

// 3. --ensure idempotency
{
 const d = mkdtempSync(join(tmpdir(), "wm-idem-"));
 try {
  const gitRes = spawnSync("git", ["init", "-q"], { cwd: d, encoding: "utf8" });
  check("3 git init", gitRes.status === 0, gitRes.stderr?.slice(0, 200));

  const res1 = runScript(["--ensure", d], process.cwd());
  check("3 first --ensure exits 0", res1.status === 0, res1.stderr?.slice(0, 200));

  let manifest1;
  try {
   manifest1 = JSON.parse(readFileSync(join(d, ".nextgit", "manifest.json"), "utf8"));
  } catch (e) {
   check("3 first manifest parse", false, e.message);
   manifest1 = null;
  }

  const res2 = runScript(["--ensure", d], process.cwd());
  check("3 second --ensure exits 0", res2.status === 0, res2.stderr?.slice(0, 200));

  let manifest2;
  try {
   manifest2 = JSON.parse(readFileSync(join(d, ".nextgit", "manifest.json"), "utf8"));
  } catch (e) {
   check("3 second manifest parse", false, e.message);
   manifest2 = null;
  }

  if (manifest1 && manifest2) {
   const files1 = JSON.stringify(manifest1.structure?.files || []);
   const files2 = JSON.stringify(manifest2.structure?.files || []);
   check("3 idempotency: structure.files identical", files1 === files2, files1 !== files2 ? "files differ between runs" : "");

   const excludeRes = spawnSync("git", ["check-ignore", "-q", ".nextgit/manifest.json"], { cwd: d, encoding: "utf8" });
   check("3 idempotency: .nextgit still git-ignored", excludeRes.status === 0, `exit=${excludeRes.status}`);
  }
 } finally {
  rmSync(d, { recursive: true, force: true });
 }
}

// 7. Every file entry has {path: string, bytes: number>0, role: string}
{
 const res = runScript(["--repo", "platform", "--print"], process.cwd());
 let manifest;
 try {
  manifest = JSON.parse(res.stdout);
 } catch {
  check("7 file entries: parse manifest", false);
  manifest = null;
 }
 if (manifest) {
  const allValid = manifest.structure.files.every(
   (f) => typeof f.path === "string" && f.path.length > 0 &&
    typeof f.bytes === "number" && f.bytes > 0 &&
    typeof f.role === "string" && f.role.length > 0
  );
  check("7 every file entry has {path, bytes>0, role}", allValid, allValid ? "" : "invalid entry found");
 }
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
