#!/usr/bin/env node
// seed.mjs — write a coherent baseline TS service into the `demo` Artifacts repo.
//
// Establishes the state every demo proposal diffs against: a four-file service
// (auth / store / api / server) with imports wired, no external dependencies.
//
// Usage:  node platform/scripts/seed.mjs [repo]        (repo default "demo")
// Output: one commit "baseline v3: service skeleton" pushed to main, or a
//         no-op when the baseline already matches.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bustProposalsCache } from "./lib/bust-cache.mjs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const TTL = 3600;
const COMMIT_MESSAGE = "baseline v3: service skeleton";

const FILES = {
  "src/auth.ts": `// Authentication module — sessions, expiry, refresh.
export interface Session {
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export const DEFAULT_TTL_MS = 3600_000;

export function createSession(userId: string, ttlMs = DEFAULT_TTL_MS): Session {
  const now = Date.now();
  return { userId, createdAt: now, expiresAt: now + ttlMs };
}

export function isExpired(session: Session, now = Date.now()): boolean {
  return now > session.expiresAt;
}

export function remainingMs(session: Session, now = Date.now()): number {
  return Math.max(0, session.expiresAt - now);
}

export function validate(session: Session): string | null {
  if (!session.userId) return "session is missing userId";
  if (!Number.isFinite(session.expiresAt)) return "session has a non-numeric expiresAt";
  if (session.expiresAt <= session.createdAt) return "session expires before it was created";
  return null;
}

export function describeSession(session: Session, now = Date.now()): string {
  const seconds = Math.round(remainingMs(session, now) / 1000);
  return \`\${session.userId} expires in \${seconds}s\`;
}
`,

  "src/store.ts": `// In-memory row store keyed by string id. Single process, no persistence.
import type { Session } from "./auth.js";

export interface Row<T> {
  id: string;
  value: T;
  updatedAt: number;
}

const rows = new Map<string, Row<unknown>>();

export function put<T>(id: string, value: T): Row<T> {
  const row: Row<T> = { id, value, updatedAt: Date.now() };
  rows.set(id, row as Row<unknown>);
  return row;
}

export function get<T>(id: string): Row<T> | undefined {
  return rows.get(id) as Row<T> | undefined;
}

export function del(id: string): boolean {
  return rows.delete(id);
}

export function has(id: string): boolean {
  return rows.has(id);
}

export function keys(): string[] {
  return [...rows.keys()].sort();
}

export function size(): number {
  return rows.size;
}

export function clear(): void {
  rows.clear();
}

export function sessions(): Session[] {
  return keys()
    .filter((id) => id.startsWith("session:"))
    .map((id) => get<Session>(id)?.value)
    .filter((s): s is Session => Boolean(s));
}
`,

  "src/api.ts": `// Request routing table. Handlers are pure functions over the row store.
import { createSession, isExpired, validate, describeSession } from "./auth.js";
import { del, get, keys, put, sessions } from "./store.js";

export interface ApiRequest {
  method: string;
  route: string;
  body?: Record<string, unknown>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export type Handler = (req: ApiRequest) => ApiResponse;

const sessionId = (userId: string): string => \`session:\${userId}\`;

const handlers: Record<string, Record<string, Handler>> = {
  auth: {
    POST(req): ApiResponse {
      const userId = String(req.body?.userId ?? "");
      const problem = userId ? null : "userId is required";
      if (problem) return { status: 400, body: { error: problem } };
      const session = createSession(userId);
      put(sessionId(userId), session);
      return { status: 201, body: { session } };
    },
    GET(req): ApiResponse {
      const userId = String(req.body?.userId ?? "");
      const row = get<ReturnType<typeof createSession>>(sessionId(userId));
      if (!row) return { status: 404, body: { error: "no such session" } };
      const session = row.value;
      const problem = validate(session);
      if (problem) return { status: 422, body: { error: problem } };
      const body = {
        session,
        expired: isExpired(session),
        summary: describeSession(session),
      };
      return { status: body.expired ? 401 : 200, body };
    },
    DELETE(req): ApiResponse {
      const userId = String(req.body?.userId ?? "");
      return { status: del(sessionId(userId)) ? 204 : 404, body: {} };
    },
  },
  users: {
    GET(): ApiResponse {
      return { status: 200, body: { users: sessions().map((s) => s.userId) } };
    },
    DELETE(): ApiResponse {
      const ids = keys().filter((id) => id.startsWith("session:"));
      for (const id of ids) del(id);
      return { status: 200, body: { removed: ids.length } };
    },
  },
};

export function handle(req: ApiRequest): ApiResponse {
  const group = handlers[req.route];
  if (!group) return { status: 404, body: { error: \`unknown route: \${req.route}\` } };
  const handler = group[req.method];
  if (!handler) {
    return { status: 405, body: { error: \`\${req.method} not allowed on \${req.route}\` } };
  }
  return handler(req);
}
`,

  "src/server.ts": `// Wires the api handler table to a transport. No framework, no dependencies.
import { handle, type ApiRequest, type ApiResponse } from "./api.js";
import { clear, size } from "./store.js";

export interface Transport {
  listen(path: string, dispatch: (req: ApiRequest) => ApiResponse): void;
  close(): void;
}

export interface ServerHandle {
  port: number;
  transport: Transport;
  close(): void;
}

export function createDispatcher() {
  return (req: ApiRequest): ApiResponse => {
    try {
      return handle(req);
    } catch (err) {
      return { status: 500, body: { error: (err as Error).message } };
    }
  };
}

export function start(transport: Transport, port = 8787): ServerHandle {
  const dispatch = createDispatcher();
  transport.listen("/api/:route", dispatch);
  return {
    port,
    transport,
    close(): void {
      clear();
      transport.close();
    },
  };
}

export function stats(): { rows: number } {
  return { rows: size() };
}
`,
};

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

const repo = process.argv[2] ?? "demo";
const namespace = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const headers = { Authorization: `Bearer ${apiToken()}` };

const minted = await call("POST", `${namespace}/tokens`, { repo, scope: "write", ttl: TTL }, headers);
const authEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraheader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${minted.plaintext}`,
};

const dir = mkdtempSync(join(tmpdir(), "nextgit-seed-"));
const git = (...args) =>
  execFileSync("git", args, {
    cwd: dir,
    env: authEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  git("clone", `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}/${repo}.git`, dir);
  git("config", "user.name", "platform-bot");
  git("config", "user.email", "bot@nextgit.dev");

  for (const [rel, content] of Object.entries(FILES)) {
    const abs = join(dir, rel);
    rmSync(abs, { force: true });
    writeFileSync(abs, content, "utf8");
    console.log(`wrote  ${rel}`);
  }

  const status = git("status", "--porcelain");
  if (!status) {
    console.log(`\nno change in ${repo} — baseline already current (${git("rev-parse", "--short", "HEAD")})`);
    process.exit(0);
  }

  git("add", "-A");
  git("commit", "-m", COMMIT_MESSAGE);
  git("push", "origin", "HEAD:refs/heads/main");
  console.log(`\n${COMMIT_MESSAGE} -> ${repo}/main @ ${git("rev-parse", "--short", "HEAD")}`);
  console.log(status.split("\n").map((l) => `  ${l}`).join("\n"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
await bustProposalsCache("seed");
