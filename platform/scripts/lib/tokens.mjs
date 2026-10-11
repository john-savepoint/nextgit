// tokens.mjs — repo git-token TTL policy + the one mint path (FR-36).
//
import { chmodSync, statSync, writeFileSync } from "node:fs";

/**
 * The ONE agent-manifest writer (FR-36 storage-hygiene law).
 * Node's `writeFileSync(path, json, { mode })` applies the mode only
 * at CREATE — a pre-existing 0644 file would stay world-readable.
 * So: chmod an existing file to 0600 BEFORE the rewrite, write with
 * mode 0600, then verify the resulting mode and throw on mismatch
 * (fail closed: a token manifest that cannot be proven 0600 never
 * silently stays 0644).
 */
export function writeAgentManifest(path, agents) {
 const json = JSON.stringify(agents, null, 2);
 if (statSync(path, { throwIfNoEntry: false })) chmodSync(path, 0o600);
 writeFileSync(path, json, { mode: 0o600 });
 if ((statSync(path).mode & 0o777) !== 0o600) {
  throw new Error(`${path}: manifest mode is not 0600 (FR-36)`);
 }
}

/**
 * The ONE agent-manifest printer. Destructures ONLY name / scope /
 * expires_at — the token is never accepted, so it is unprintable by
 * construction (a caller cannot leak what the signature refuses).
 */
export function formatAgentRow({ name, scope, expires_at }) {
 return `${name}  scope=${scope}  token expires ${expires_at}`;
}

/**
 * The ONE env shape that carries a repo token to `git` (FR-36 argv
 * law): the token rides GIT_CONFIG_VALUE_0 (invisible to ps /
 * /proc/<pid>/cmdline), never a `-c http.extraHeader=…` argv.
 * Mirrors the worker-side config injection (platform/src githttp).
 */
export function gitAuthEnv(token) {
 return {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraheader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
 };
}
// Policy: repo git tokens live 24 h by default and never longer than
// 7 d. An omitted ttl mints 86400 s; a ttl above 604800 s is REJECTED
// before any API call (fail closed — no silent clamp: a caller asking
// for more than the max must find out, not quietly receive the max).
// Explicit shorter TTLs are legal (seed.mjs mints 3600 s for its
// control-plane push).
//
// Class separation (FR-36): WORKER-minted access tokens (land.ts
// TOKEN_TTL_SECONDS=300) are a different class — single-use, ≤300 s,
// revoked in a finally. This module governs the SCRIPT-minted repo
// git tokens only.
//
// NOTE (AD-7/AD-10): this policy MUST travel to future Workflows-side
// minting. When Workflows take over token minting (AD-10), the same
// rule applies: default 86400, hard ceiling 604800, reject-above-max.

/** Resolve + validate a repo-token TTL. Pure function for testability. */
export function resolveTtl(raw) {
 const n = Number(raw ?? 86400);
 if (Number.isNaN(n)) throw new Error("ttlSeconds must be a number");
 if (n < 60) throw new Error("ttlSeconds must be >= 60 seconds");
 if (n > 604800) throw new Error("ttlSeconds must be <= 604800 seconds (7 d max, FR-36)");
 return n;
}

/**
 * Mint a repo-scoped write token via the Artifacts control plane.
 * `call(method, url, body, headers)` is the caller's fetch wrapper
 * (each script already has one); the helper never imports fetch itself,
 * keeping it offline-testable. Validation happens BEFORE the call —
 * an over-max ttl never reaches the API.
 */
export async function mintRepoToken(call, { base, repo, ttl, headers }) {
 const resolved = resolveTtl(ttl);
 return call("POST", `${base}/tokens`, { repo, scope: "write", ttl: resolved }, headers);
}

