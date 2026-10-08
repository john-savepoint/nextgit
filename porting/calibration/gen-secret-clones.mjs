#!/usr/bin/env node
// gen-secret-clones.mjs — Generate local git clones with secret-class files.
//
// Creates 5 clones that each add a secret-class file (config/.env, secrets.json,
// .env, src/secrets/db.ts, config/.dev.vars) to verify the masking law:
// capture.mjs must omit patches and intent for these, and only include keys[].

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const outRoot = "/tmp/real-agents";
const seedClone = "/tmp/real-agents/agent-1";
const forkSha = "6a5dac9707f4d28f92761cb23010afb45da1b327";
const baselineFiles = ["src/auth.ts", "src/store.ts", "src/api.ts", "src/server.ts", "src/utils.ts"];

const secretVariants = [
  {
    name: "agent-extra-secret-1",
    file: "config/.env",
    content: "# Production environment\nDATABASE_URL=postgres://demo:SECRET-PASSWORD-123@db.internal:5432/app\nREDIS_URL=redis://cache.internal:6379\nPORT=8787\n",
    intent: "Feature: add config/.env with database and redis URLs",
    risk: "routine",
    intent_verdict: "supports",
  },
  {
    name: "agent-extra-secret-2",
    file: "secrets.json",
    content: '{\n  "apiKey": "sk-secret-key-abc123",\n  "webhookSecret": "whsec-def456"\n}\n',
    intent: "Feature: add secrets.json with API key and webhook secret",
    risk: "senior-security",
    intent_verdict: "supports",
  },
  {
    name: "agent-extra-secret-3",
    file: ".env",
    content: "JWT_SECRET=jwt-secret-xyz789\nENCRYPTION_KEY=aes-256-key-12345\n",
    intent: "Feature: add .env with JWT and encryption keys",
    risk: "senior-security",
    intent_verdict: "supports",
  },
  {
    name: "agent-extra-secret-4",
    file: "src/secrets/db.ts",
    content: "// Database secrets provider\nexport const DB_PASSWORD = \"db-password-from-secrets\";\nexport const DB_HOST = \"db.internal\";\n",
    intent: "Feature: add database secrets module",
    risk: "senior-security",
    intent_verdict: "supports",
  },
  {
    name: "agent-extra-secret-5",
    file: "config/.dev.vars",
    content: "CF_API_TOKEN=cf-token-abc123\nGITHUB_TOKEN=ghp-def456\n",
    intent: "Feature: add .dev.vars with API tokens",
    risk: "senior-security",
    intent_verdict: "supports",
  },
];

const created = [];
for (const v of secretVariants) {
  const cloneDir = join(outRoot, v.name);
  if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true });
  mkdirSync(cloneDir, { recursive: true });

  const git = (args) => execFileSync("git", args, { cwd: cloneDir, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "demo-agent"]);
  git(["config", "user.email", "agent@nextgit.dev"]);

  // Copy baseline files
  for (const relPath of baselineFiles) {
    const content = execFileSync("git", ["show", `${forkSha}:${relPath}`], {
      cwd: seedClone, encoding: "utf8", stdio: "pipe"
    }).trimEnd();
    const filePath = join(cloneDir, relPath);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content + "\n");
  }

  // Commit baseline
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "baseline v3: service skeleton"]);

  // Add secret file
  const filePath = join(cloneDir, v.file);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, v.content);

  // Also add a non-secret file change so the proposal has both secret and non-secret files
  const authPath = join(cloneDir, "src/auth.ts");
  const auth = readFileSync(authPath, "utf8");
  const updated = auth + "\n// Helper added by " + v.name + "\nexport function helper(): string { return 'ok'; }\n";
  writeFileSync(authPath, updated);

  // Commit agent change — use -f to force-add gitignored secret files
  git(["add", "-A", "-f"]);
  git(["commit", "-q", "-m", `${v.name}: ${v.intent}`]);

  // Add git note with intent
  git(["notes", "add", "-f", "-m", v.intent]);

  const headSha = git(["rev-parse", "HEAD"]);
  created.push({ name: v.name, headSha, file: v.file, intent: v.intent, risk: v.risk, intent_verdict: v.intent_verdict });
  console.log(`Created: ${v.name} (${headSha.slice(0, 8)}) - ${v.file}`);
}

console.log(`\nTotal secret clones: ${created.length}`);
