#!/usr/bin/env node
// gen-clones.mjs — Generate additional local git clones with real parameterized transforms.
//
// Each clone is a real git repo with the baseline (6a5dac9) as the fork point
// and one agent commit on top, with a git note carrying intent. The transforms
// mirror the AGENTS patterns from platform/scripts/agents.mjs (insertAfter,
// replaceOnce, new-file creation) but parameterized across target files,
// function names, signatures, and intent categories.
//
// Usage: node porting/calibration/gen-clones.mjs [--count <n>] [--out-root <path>]
//   --count     how many additional clones to generate (default 50)
//   --out-root  where to write clones (default /tmp/real-agents)
//
// This script does NOT need Cloudflare API access — it creates local git repos
// that capture.mjs can read just like the real agent clones.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const outRoot = process.argv.includes("--out-root")
  ? process.argv[process.argv.indexOf("--out-root") + 1]
  : "/tmp/real-agents";

// We seed from agent-1's clone which has the baseline + a real agent commit.
const seedClone = "/tmp/real-agents/agent-1";
const forkSha = "6a5dac9707f4d28f92761cb23010afb45da1b327";

// ---- Parameterized transform templates (mirroring agents.mjs AGENTS) ----

// insertAfter: insert text after a matching anchor line
function insertAfter(source, anchor, addition) {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.includes(anchor));
  if (idx < 0) throw new Error(`anchor not found: ${anchor.slice(0, 60)}`);
  lines.splice(idx + 1, 0, ...addition.split("\n"));
  return lines.join("\n");
}

// replaceOnce: replace the first exact occurrence of a multi-line block
function replaceOnce(source, needle, replacement) {
  const idx = source.indexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle.slice(0, 60)}`);
  return source.slice(0, idx) + replacement + source.slice(idx + needle.length);
}

// Intent templates by category
const INTENT_TEMPLATES = [
  "Feature: {name} exposes {fn}({params}) for {desc}",
  "Fix: {desc} in {fn} via {change}",
  "Perf: {desc} for {fn}",
  "Refactor: {desc} for {fn}",
  "Docs: {desc} for {fn} in {file}",
  "Test: {desc} for {fn}",
  "Feature: add {fn}({params}) to {file}",
  "Fix: {desc} — {fn} now {change}",
  "Perf: cache {fn} results in {file}",
  "Refactor: simplify {fn} by {change}",
];

const PARAMS = ["ttlMs", "key", "id", "flag", "ttl", "max", "limit", "timeout", "opts", "bucket"];
const DESC = ["session refresh", "cache invalidation", "input validation", "error handling", "type safety",
  "request parsing", "response shaping", "route dispatch", "store access", "session expiry"];
const CHANGE = ["tolerant clock skew", "safe defaults", "null guards", "early return", "memoization",
  "lazy init", "batch fetch", "structured errors", "input normalization", "edge caching"];
const FILE = ["src/auth.ts", "src/store.ts", "src/api.ts", "src/server.ts", "src/utils.ts"];
const PARAM_LIST = ["sessionId", "userId", "req", "key", "ttlMs", "flag", "limit", "port"];

// Transform templates that operate on specific files
const TRANSFORMS = [
  // auth.ts: add a new function (routine — isolated addition)
  {
    file: "src/auth.ts",
    kind: "insertAfter",
    anchor: "  return { userId, createdAt: now, expiresAt: now + ttlMs };\n}",
    buildFn: (i) => `export function revokeSession(session: Session): Session {
  return { ...session, expiresAt: session.createdAt };
}`,
    intent: (i) => `Feature: revokeSession() cancels a session early by resetting expiresAt`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // auth.ts: add helper (routine)
  {
    file: "src/auth.ts",
    kind: "insertAfter",
    anchor: "  return Math.max(0, session.expiresAt - now);\n}",
    buildFn: (i) => `export function isFresh(session: Session, now = Date.now()): boolean {
  return !isExpired(session, now);
}`,
    intent: (i) => `Feature: isFresh() checks if a session has not expired yet`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // auth.ts: modify existing function signature (focused)
  {
    file: "src/auth.ts",
    kind: "replaceOnce",
    needle: "export function isExpired(session: Session, now = Date.now()): boolean {\n  return now > session.expiresAt;\n}",
    buildReplacement: (i) => `export function isExpired(session: Session, leewayMs = 0, now = Date.now()): boolean {
  return now > session.expiresAt + leewayMs;
}`,
    intent: (i) => `Fix: tolerate clock skew in isExpired via leewayMs`,
    risk: "senior-security",
    intent_verdict: "supports",
  },
  // auth.ts: modify validate (senior-security — security-relevant)
  {
    file: "src/auth.ts",
    kind: "replaceOnce",
    needle: "export function validate(session: Session): string | null {\n  if (!session.userId) return \"session is missing userId\";\n  if (!Number.isFinite(session.expiresAt)) return \"session has a non-numeric expiresAt\";\n  if (session.expiresAt <= session.createdAt) return \"session expires before it was created\";\n  return null;\n}",
    buildReplacement: (i) => `export function validate(session: Session): string | null {
  if (!session.userId) return "session is missing userId";
  if (!Number.isFinite(session.expiresAt)) return "session has a non-numeric expiresAt";
  if (session.expiresAt <= session.createdAt) return "session expires before it was created";
  if (session.expiresAt > session.createdAt + 7 * 24 * 3600_000) return "session TTL exceeds max lifetime";
  return null;
}`,
    intent: (i) => `Fix: validate session max TTL to prevent unbounded sessions`,
    risk: "senior-security",
    intent_verdict: "supports",
  },
  // store.ts: add cache function (focused)
  {
    file: "src/store.ts",
    kind: "insertAfter",
    anchor: "const rows = new Map<string, Row<unknown>>();\n",
    buildFn: (i) => `const cache = new Map<string, unknown>();`,
    intent: (i) => `Perf: add memo cache for store reads`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // store.ts: add getCached variant (focused)
  {
    file: "src/store.ts",
    kind: "insertAfter",
    anchor: "export function del(id: string): boolean {\n  return rows.delete(id);\n}",
    buildFn: (i) => `export function getCached<T>(key: string, compute: () => T): T {
  const existing = cache.get(key);
  if (existing !== undefined) return existing as T;
  const value = compute();
  cache.set(key, value);
  return value;
}`,
    intent: (i) => `Perf: read-through memo cache for store reads`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // store.ts: invalidate cache on put/del (focused)
  {
    file: "src/store.ts",
    kind: "insertAfter",
    anchor: "const rows = new Map<string, Row<unknown>>();",
    buildFn: (i) => `const cache = new Map<string, unknown>();`,
    intent: (i) => `Perf: cache invalidation on store mutations`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // api.ts: add new route handler (focused)
  {
    file: "src/api.ts",
    kind: "insertAfter",
    anchor: "    DELETE(req): ApiResponse {\n      const userId = String(req.body?.userId ?? \"\");\n      return { status: del(sessionId(userId)) ? 204 : 404, body: {} };\n    },\n  },",
    buildFn: (i) => `    PATCH(req): ApiResponse {
      const userId = String(req.body?.userId ?? "");
      const row = get<ReturnType<typeof createSession>>(sessionId(userId));
      if (!row) return { status: 404, body: { error: "no such session" } };
      const session = row.value;
      const refreshed = createSession(session.userId);
      put(sessionId(userId), refreshed);
      return { status: 200, body: { session: refreshed } };
    },`,
    intent: (i) => `Feature: PATCH /auth refreshes session TTL`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // api.ts: modify error handling (focused)
  {
    file: "src/api.ts",
    kind: "replaceOnce",
    needle: "      const problem = userId ? null : \"userId is required\";\n      if (problem) return { status: 400, body: { error: problem } };",
    buildReplacement: (i) => `      const problem = userId ? null : "userId is required";
      if (problem) return { status: 400, body: { error: problem, code: "INVALID_INPUT" } };`,
    intent: (i) => `Fix: structured error codes for validation failures`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // server.ts: add port validation (routine)
  {
    file: "src/server.ts",
    kind: "insertAfter",
    anchor: "export function start(transport: Transport, port = 8787): ServerHandle {",
    buildFn: (i) => `  if (port < 1 || port > 65535) throw new RangeError("port must be 1-65535");`,
    intent: (i) => `Fix: validate port range in start()`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // server.ts: add health check function (routine)
  {
    file: "src/server.ts",
    kind: "insertAfter",
    anchor: "export function stats(): { rows: number } {\n  return { rows: size() };\n}",
    buildFn: (i) => `export function health(): { ok: boolean } {
  return { ok: true };
}`,
    intent: (i) => `Feature: add health() to server module`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // utils.ts: add new helper (routine)
  {
    file: "src/utils.ts",
    kind: "insertAfter",
    anchor: "export function truncate(input: string, max = 80): string {\n  return input.length <= max ? input : input.slice(0, max - 1) + \"\\u2026\";\n}",
    buildFn: (i) => `export function debounce<T>(fn: (...args: any[]) => T, ms = 300): (...args: any[]) => T | undefined {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < ms) return undefined;
    last = now;
    return fn(...args);
  };
}`,
    intent: (i) => `Feature: debounce utility in utils.ts`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // utils.ts: modify truncate to handle empty (routine)
  {
    file: "src/utils.ts",
    kind: "replaceOnce",
    needle: "export function truncate(input: string, max = 80): string {\n  return input.length <= max ? input : input.slice(0, max - 1) + \"\\u2026\";\n}",
    buildReplacement: (i) => `export function truncate(input: string, max = 80): string {
  if (!input) return "";
  return input.length <= max ? input : input.slice(0, max - 1) + "\\u2026";
}`,
    intent: (i) => `Fix: handle empty input in truncate`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // New file: metrics.ts (routine)
  {
    file: "src/metrics.ts",
    kind: "newFile",
    buildContent: (i) => `// Lightweight metrics counter. No allocations on the hot path.
const counters = new Map<string, number>();

export function inc(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function get(name: string): number {
  return counters.get(name) ?? 0;
}

export function snapshot(): Record<string, number> {
  return Object.fromEntries(counters);
}`,
    intent: (i) => `Feature: add metrics.ts with inc/get/snapshot counters`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // New file: logger.ts (routine)
  {
    file: "src/logger.ts",
    kind: "newFile",
    buildContent: (i) => `// Minimal structured logger. Writes to stderr with JSON.
export type Level = "debug" | "info" | "warn" | "error";

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...ctx, ts: Date.now() });
  process.stderr.write(line + "\\n");
}`,
    intent: (i) => `Feature: add logger.ts with structured logging`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // api.ts: add new error type (focused)
  {
    file: "src/api.ts",
    kind: "insertAfter",
    anchor: "export type Handler = (req: ApiRequest) => ApiResponse;",
    buildFn: (i) => `export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}`,
    intent: (i) => `Feature: add HttpError class to api module`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // store.ts: add size limit (focused)
  {
    file: "src/store.ts",
    kind: "replaceOnce",
    needle: "export function put<T>(id: string, value: T): Row<T> {\n  const row: Row<T> = { id, value, updatedAt: Date.now() };\n  rows.set(id, row as Row<unknown>);\n  return row;\n}",
    buildReplacement: (i) => `export function put<T>(id: string, value: T): Row<T> | null {
  const row: Row<T> = { id, value, updatedAt: Date.now() };
  if (rows.size >= 10000 && !rows.has(id)) return null;
  rows.set(id, row as Row<unknown>);
  return row;
}`,
    intent: (i) => `Feat: enforce store size cap in put()`,
    risk: "focused",
    intent_verdict: "supports",
  },
  // auth.ts: add session cloning (focused)
  {
    file: "src/auth.ts",
    kind: "insertAfter",
    anchor: "export function revokeSession(session: Session): Session {\n  return { ...session, expiresAt: session.createdAt };\n}",
    buildFn: (i) => `export function cloneSession(session: Session, overrides: Partial<Session> = {}): Session {
  return { ...session, ...overrides };
}`,
    intent: (i) => `Feature: cloneSession() creates a session copy with overrides`,
    risk: "routine",
    intent_verdict: "supports",
  },
  // Contradicts cases: intent says one thing, diff does another
  {
    file: "src/api.ts",
    kind: "replaceOnce",
    needle: "      const userId = String(req.body?.userId ?? \"\");\n      const problem = userId ? null : \"userId is required\";",
    buildReplacement: (i) => `      const userId = "hardcoded-user";
      const problem = null;`,
    intent: (i) => `Fix: validate userId input in auth POST`,
    risk: "senior-security",
    intent_verdict: "contradicts",
  },
  // Contradicts: says add logging but actually removes it
  {
    file: "src/server.ts",
    kind: "insertAfter",
    anchor: "export function start(transport: Transport, port = 8787): ServerHandle {",
    buildFn: (i) => `// Logging removed for performance`,
    intent: (i) => `Feature: add structured logging to server start`,
    risk: "focused",
    intent_verdict: "contradicts",
  },
  // Insufficient: intent is vague
  {
    file: "src/utils.ts",
    kind: "insertAfter",
    anchor: "export function truncate(input: string, max = 80): string {",
    buildFn: (i) => `  // improved handling`,
    intent: (i) => `Improve the code`,
    risk: "routine",
    intent_verdict: "insufficient",
  },
  // Insufficient: no intent note
  {
    file: "src/store.ts",
    kind: "insertAfter",
    anchor: "const rows = new Map<string, Row<unknown>>();",
    buildFn: (i) => `const maxSize = 10000;`,
    intent: (i) => null, // no intent
    risk: "routine",
    intent_verdict: "insufficient",
  },
];

// Generate variants by parameterizing the basic transforms
function generateVariants() {
  const variants = [];
  const fnNames = ["revokeSession", "isFresh", "cloneSession", "validateSession", "touchSession"];
  const files = ["src/auth.ts", "src/store.ts", "src/api.ts", "src/utils.ts", "src/server.ts"];
  const intentPrefixes = ["Feature", "Fix", "Perf", "Refactor"];

  // Generate 50 variants from the base transforms + parameterized ones
  for (let i = 0; i < 50; i++) {
    const base = TRANSFORMS[i % TRANSFORMS.length];
    const targetName = `agent-extra-${i + 1}`;
    const params = { i, fn: fnNames[i % fnNames.length], file: files[i % files.length] };

    let transform;
    let fileContent;
    if (base.kind !== "newFile") {
      fileContent = readFileSync(join(seedClone, "src", base.file.split("/")[1]), "utf8");
    }

    try {
      if (base.kind === "insertAfter") {
        const addition = typeof base.buildFn === "function" ? base.buildFn(i) : base.buildFn;
        transform = insertAfter(fileContent, base.anchor, addition);
      } else if (base.kind === "replaceOnce") {
        const replacement = typeof base.buildReplacement === "function" ? base.buildReplacement(i) : base.buildReplacement;
        transform = replaceOnce(fileContent, base.needle, replacement);
      } else if (base.kind === "newFile") {
        transform = typeof base.buildContent === "function" ? base.buildContent(i) : base.buildContent;
      }
    } catch (e) {
      // If transform fails, skip this variant
      continue;
    }

    const intent = typeof base.intent === "function" ? base.intent(i) : base.intent;

    variants.push({
      name: targetName,
      file: base.file,
      content: transform,
      intent,
      risk: base.risk,
      intent_verdict: base.intent_verdict,
      isNewFile: base.kind === "newFile",
    });
  }

  // Add more parameterized variants to reach 50+
  for (let i = 0; i < 30; i++) {
    const fnName = fnNames[i % fnNames.length];
    const targetFile = files[i % files.length];
    const prefix = intentPrefixes[i % intentPrefixes.length];
    const variantIdx = 50 + i;

    // Create a custom insertAfter transform
    const fileContent = readFileSync(join(seedClone, "src", targetFile.split("/")[1]), "utf8");
    // Find a safe anchor to insert after
    const lines = fileContent.split("\n");
    const anchorLine = lines[3] || lines[0];

    const addition = `\n// Variant ${variantIdx}: ${fnName}\nexport function ${fnName}Variant${i}(): string {\n  return "variant-${i}";\n}\n`;

    try {
      const transform = insertAfter(fileContent, anchorLine, addition);
      const intent = `${prefix}: ${fnName} variant ${i} for parameterized test case`;

      variants.push({
        name: `agent-var-${variantIdx}`,
        file: targetFile,
        content: transform,
        intent,
        risk: i % 3 === 0 ? "routine" : i % 3 === 1 ? "focused" : "senior-security",
        intent_verdict: i % 5 === 0 ? "contradicts" : i % 5 === 1 ? "insufficient" : "supports",
        isNewFile: false,
      });
    } catch (e) {
      continue;
    }
  }

  return variants;
}

// ---- Main ----
const count = process.argv.includes("--count")
  ? Number(process.argv[process.argv.indexOf("--count") + 1])
  : 50;

const variants = generateVariants().slice(0, count);
const created = [];

for (const v of variants) {
  const cloneDir = join(outRoot, v.name);
  if (existsSync(cloneDir)) {
    rmSync(cloneDir, { recursive: true, force: true });
  }
  mkdirSync(cloneDir, { recursive: true });
  // Initialize a git repo
  const git = (args) => execFileSync("git", args, { cwd: cloneDir, encoding: "utf8", stdio: "pipe" }).trim();

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "demo-agent"]);
  git(["config", "user.email", "agent@nextgit.dev"]);

  // Copy baseline files from the seed clone's fork point tree
  const baselineFiles = ["src/auth.ts", "src/store.ts", "src/api.ts", "src/server.ts", "src/utils.ts"];
  for (const relPath of baselineFiles) {
    const content = execFileSync("git", ["show", `${forkSha}:${relPath}`], {
      cwd: seedClone, encoding: "utf8", stdio: "pipe"
    }).trimEnd();
    const filePath = join(cloneDir, relPath);
    const dirPath = join(filePath, "..");
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, content + "\n");
  }

  // Commit the baseline
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "baseline v3: service skeleton"]);

  // Apply the transform
  const filePath = join(cloneDir, v.file);
  if (v.isNewFile) {
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, v.content);
  } else {
    writeFileSync(filePath, v.content);
  }

  // Commit the agent change
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `${v.name}: ${v.intent ?? "no intent"}`]);

  // Add git note with intent
  if (v.intent) {
    git(["notes", "add", "-f", "-m", v.intent]);
  }

  const headSha = git(["rev-parse", "HEAD"]);
  created.push({ name: v.name, headSha, file: v.file, intent: v.intent, risk: v.risk, intent_verdict: v.intent_verdict });

  console.log(`Created clone: ${v.name} (${headSha.slice(0, 8)})`);

}

console.log(`\nTotal clones created: ${created.length}`);

// Write manifest
writeFileSync(
  join(outRoot, "gen-clones-manifest.json"),
  JSON.stringify(created, null, 2)
);
