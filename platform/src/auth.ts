// nextgit-platform — auth seam (FR-45 / AD-9).
//
// One authorize() chokepoint: AUTH_MODE absent or anything other than "demo"
// ⇒ default-deny (every route returns 401 before any repo read); "demo" ⇒
// the demo repo allowlist is enforced (repo/base/repos names outside the
// demo namespace return 403 before any repo read). The full auth seam
// (identity resolution, rate limits, CSRF, reveal path) is sequenced M2;
// this slice ships the chokepoint + default-deny + the demo allowlist.
/** Action vocabulary — pinned in platform/CONTRACT.md (v2.4). */
export type ActionType = "read" | "write" | "judge" | "reveal";

export interface AuthEnv {
 AUTH_MODE?: string;
 /**
  * Explicit reveal allowlist (FR-31): JSON string (Worker var) or a
  * pre-parsed array of { id, repos? } — who may read a secret-class
  * value through POST /reveal. Optional: absent ⇒ no identity is
  * authorized (default-deny, fail-closed). Parsed defensively by
  * parseRevealAllowlist — both a string and a pre-parsed array are
  * accepted; garbage denies.
  */
 REVEAL_ALLOW?: unknown;
}

/** Opaque token carrier — Bearer prefix is stripped by handlers, never here. */
export const IDENTITY_HEADER = "Authorization";

/**
 * AUTH_MODE resolution: returns "demo" ONLY when env.AUTH_MODE === "demo";
 * absent or any other value ⇒ "deny" (default-deny, fail-closed).
 */
export function resolveAuthMode(env: AuthEnv): "deny" | "demo" {
 return env.AUTH_MODE === "demo" ? "demo" : "deny";
}

/** Uniform deny shape: 401 { ok: false, error: "unauthorized" }. */
export function unauthorizedResponse(): Response {
 return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/**
 * Repo-name charset (mirrors index.ts REPO_NAME_RE — imported
 * by index.ts from here so the charset guard lives in one
 * place): repo names are used in a remote path, so they are
 * kept to a safe charset. The allowlist below only adjudicates
 * charset-VALID names — a charset-invalid name is a 400
 * (shape) from the handler's own validation, and 400 precedes 403.
 */
export const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Demo allowlist (AD-9): the demo namespace is `demo` + `agent-*`, scratch
 * chains (`demo-lh-base` / `agent-lh-1`, `agent-e2s-*`, `agent-wh-*`,
 * `agent-in-*`, `agent-e4r-*`) included. The allowlist
 * is enforced at the authorize() chokepoint so every route rejects a
 * non-allowlisted name with 403 BEFORE any env.ARTIFACTS / env.AI read.
 */
export const DEMO_REPO_RE = /^(demo|agent)(-[A-Za-z0-9._-]+)?$/;

/** The repo-scope surface authorize() enforces the demo allowlist over. */
export interface AuthorizeScope {
 repo?: string;
 base?: string;
 repos?: string[];
}

/**
 * Uniform demo-allowlist denial: 403 { ok:false, error:"repo-not-allowed",
 * detail } for the first charset-valid name outside the demo namespace.
 * Returns null when every carried name is allowlisted (or none is carried).
 *
 * Precedence — 400 (charset/shape) precedes 403 (allowlist): when ANY
 * carried name is charset-invalid (fails REPO_NAME_RE) the whole scope
 * defers to the handler, whose own validation 400s first; the allowlist
 * only adjudicates scopes whose every name is charset-valid. The same
 * deferral applies to an over-cap repos list (>16 entries, the
 * platform's per-request cap): a 400 "at most 16 repos" is coming
 * from the handler, and 400 precedes 403. Demo-mode only by
 * construction: authorize() runs this after the mode gate, so
 * deny mode still 401s first.
 */
function demoRepoDenial(params?: AuthorizeScope): Response | null {
 const names = [params?.repo, params?.base, ...(params?.repos ?? [])].filter((n) => n !== undefined);
 if (names.some((n) => !REPO_NAME_RE.test(n))) return null; // a 400 is coming from the handler
 if ((params?.repos?.length ?? 0) > 16) return null; // over-cap: the handler 400s first
 for (const name of names) {
  if (!DEMO_REPO_RE.test(name)) {
   return Response.json(
    { ok: false, error: "repo-not-allowed", detail: `repo "${name}" is outside the demo allowlist` },
    { status: 403 },
   );
  }
 }
 return null;
}

/**
 * Single chokepoint — called by every route in the dispatcher.
 * - deny mode: returns unauthorizedResponse() before any repo read.
 * - demo mode: enforces the demo repo allowlist (403 repo-not-allowed
 *   for any repo/base/repos name outside the demo namespace) before any
 *   repo read, then returns null (authorized).
 *
 * action is accepted for contract shape and unused beyond mode gating;
 * params is the repo scope (query params for GET routes; POST /judge and
 * /land enforce the same allowlist inside their handlers, whose bodies
 * only they can parse).
 */
export function authorize(
 _request: Request,
 env: AuthEnv,
 _action: ActionType,
 params?: AuthorizeScope,
): Response | null {
 const denied = resolveAuthMode(env) === "demo" ? null : unauthorizedResponse();
 if (denied) return denied; // default-deny first (401)
 return demoRepoDenial(params); // null when allowlisted
}

// ---------------------------------------------------------------------------
// CSRF precondition (FR-45 / AD-9) — mutating routes (POST) run the
// CSRF gate after authorize() and before any handler read.
//
// Cookie-carried identity is assumed whenever the request carries any
// Cookie header: a browser-driven mutating request must then also
// present a matching `x-csrf-token` header. An unwired seam fails
// CLOSED: csrfExpectedToken() deliberately returns null until the SSO
// identity path lands, so a cookie-carrying POST is a hard deny (403
// csrf-required) rather than a silent pass. The suite pins that
// posture — the null must not be "fixed" into a real token source
// without the identity path it depends on.
// ---------------------------------------------------------------------------

/** Header the CSRF gate reads the double-submit token from. */
export const CSRF_HEADER = "x-csrf-token";

/**
 * Cookie-carried identity detector: any `Cookie:` header means the
 * request may be browser-driven (cookie-carried identity), so the
 * CSRF precondition applies. Header-only callers (no Cookie) are
 * unaffected — machine-to-machine traffic keeps working.
 */
export function hasCookieIdentity(request: Request): boolean {
 return request.headers.has("Cookie");
}

/**
 * Expected CSRF token for the caller's cookie identity.
 *
 * Deliberately returns null until the SSO/identity path lands: an
 * unwired expected-token source must be a HARD DENY (fail closed),
 * never a permissive default. The suite pins this.
 */
export function csrfExpectedToken(_request: Request): string | null {
 return null;
}

/** Uniform CSRF denial: 403 { ok: false, error: "csrf-required" } — no detail (NFR-3 posture). */
export function csrfRequiredResponse(): Response {
 return Response.json({ ok: false, error: "csrf-required" }, { status: 403 });
}

/**
 * Constant-time comparison of two equal-length strings. Used for the
 * presented-vs-expected token check so the compare is not a
 * timing oracle on the expected token.
 */
function constantTimeEqual(a: string, b: string): boolean {
 if (a.length !== b.length) return false;
 let diff = 0;
 for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
 return diff === 0;
}

/**
 * CSRF gate for the dispatcher — runs AFTER authorize() (so 401/403
 * repo-not-allowed keep precedence) and BEFORE the route handler.
 *
 * - No Cookie header ⇒ null (header-only identity; gate does not apply).
 * - Cookie present + absent / empty / non-matching `x-csrf-token`
 *   header ⇒ 403 { ok:false, error:"csrf-required" }.
 * - Cookie present + matching token ⇒ null (proceed).
 *
 * Only mutating methods reach this gate (the dispatcher applies it
 * to POST); GET routes are unaffected.
 */
export function csrfGate(request: Request): Response | null {
 if (!hasCookieIdentity(request)) return null;
 const expected = csrfExpectedToken(request);
 if (expected === null) return csrfRequiredResponse();
 const presented = request.headers.get(CSRF_HEADER) ?? "";
 if (presented === "") return csrfRequiredResponse();
 return constantTimeEqual(presented, expected) ? null : csrfRequiredResponse();
}

/**
 * Seam precondition (FR-45): no non-demo data path may run before
 * the full auth seam lands. Throws `seam-not-enabled` unless the
 * environment is the demo (AUTH_MODE === "demo"). Callers gate
 * non-demo work behind this so an unwired seam fails closed with a
 * throw — before any binding read.
 */
export function assertSeamEnabled(env: AuthEnv): "demo" {
 if (resolveAuthMode(env) !== "demo") throw new Error("seam-not-enabled");
 return "demo";
}

// ---------------------------------------------------------------------------
// Reveal authorization rule (FR-31) — the explicit allowlist that
// decides WHO may read a secret-class VALUE through POST /reveal.
//
// The mode gate (authorize) already decides WHETHER the route runs
// (deny mode 401s) and WHICH repos are in the demo namespace. This
// rule is a separate, defense-in-depth gate layered on top: even in
// demo mode, an identity may read a value ONLY when `env.REVEAL_ALLOW`
// (a JSON array of { id, repos? }) lists it. Absent / malformed config
// means NO identity is authorized — fail closed, matching the repo
// doctrine (csrfExpectedToken returns null ⇒ hard deny).
//
// Everything here is pure: no I/O beyond the REVEAL_ALLOW config, no
// repo reads, no value handling. The route handler composes these
// helpers; the audit record is content-free BY TYPE (RevealAuditRecord
// has no `value` field, so the stored JSON cannot carry the secret).
// ---------------------------------------------------------------------------

/** One allowlist entry: an opaque identity and the repos it may reveal. */
export interface RevealIdentity {
 /** Opaque identity — the normalized Bearer token (Authorization header). */
 id: string;
 /** Repos this identity may reveal. Absent ⇒ every demo-namespace repo; present ⇒ only those. */
 repos?: string[];
}

/**
 * Parse `env.REVEAL_ALLOW` (a JSON string Worker var, or a pre-parsed
 * array handed by a test fake) into a clean identity list.
 *
 * Fail-closed: a non-string/non-array input, or any malformed entry
 * (non-object, blank id), is DROPPED — never thrown, never granted.
 * Duplicate `id`s collapse LAST-WINS (map insertion order), so the
 * most specific configuration for an identity is the one that applies.
 * `repos` is normalized: a non-array becomes undefined (any repo);
 * non-string entries are dropped; the remainder is de-duplicated.
 */
export function parseRevealAllowlist(raw: unknown): RevealIdentity[] {
 let entries: unknown;
 if (typeof raw === "string") {
  try {
   entries = JSON.parse(raw);
  } catch {
   return []; // malformed JSON string ⇒ no identity is authorized
  }
 } else {
  entries = raw;
 }
 if (!Array.isArray(entries)) return [];
 // Last-wins dedup by id (Q2): a Map keeps insertion order, so a
 // re-set id overwrites its prior entry.
 const byId = new Map<string, RevealIdentity>();
 for (const entry of entries) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
  const e = entry as { id?: unknown; repos?: unknown };
  if (typeof e.id !== "string" || e.id.trim() === "") continue;
  let repos: string[] | undefined;
  if (Array.isArray(e.repos)) {
   repos = [];
   for (const r of e.repos) {
    if (typeof r === "string" && r.trim() !== "" && !repos.includes(r)) repos.push(r);
   }
  }
  byId.set(e.id, { id: e.id, repos });
 }
 return [...byId.values()];
}

/** Uniform reveal denial: 403 { ok:false, error:"reveal-not-authorized" } — no detail (NFR-3). */
export function revealDenial(): Response {
 return Response.json({ ok: false, error: "reveal-not-authorized" }, { status: 403 });
}

/** Input to the reveal authorization rule: the presented identity and the target repo. */
export interface RevealDecisionInput {
 identity?: string;
 repo: string;
}

/**
 * The explicit reveal rule: is `input.identity` authorized to reveal
 * `input.repo` under `env.REVEAL_ALLOW`?
 *
 * No identity ⇒ immediate deny. An allowlist entry matches when its
 * `id` equals the presented identity AND (its `repos` is absent — any
 * demo repo — OR it lists `input.repo`). Grant ⇒ { ok:true, identity };
 * otherwise { ok:false }.
 *
 * Pure function — no I/O beyond REVEAL_ALLOW, and it never throws
 * (parseRevealAllowlist is total), so the route's audit-then-deny path
 * is always reachable.
 */
export function authorizeReveal(
 env: AuthEnv & { REVEAL_ALLOW?: unknown },
 input: RevealDecisionInput,
): { ok: true; identity: string } | { ok: false } {
 const identity = typeof input.identity === "string" ? input.identity.trim() : "";
 if (identity === "") return { ok: false };
 for (const entry of parseRevealAllowlist(env.REVEAL_ALLOW)) {
  if (entry.id !== identity) continue;
  if (entry.repos === undefined || entry.repos.includes(input.repo)) {
   return { ok: true, identity };
  }
 }
 return { ok: false };
}

/**
 * Content-free audit record for a reveal decision. BY CONSTRUCTION
 * there is no `value` field — the stored JSON cannot carry the secret.
 * `at` is supplied by the caller so tests pin it.
 */
export interface RevealAuditRecord {
 identity: string;
 repo: string;
 path: string;
 key: string;
 decision: "granted" | "denied";
 at: string;
}

/** Pure builder for a RevealAuditRecord. */
export function revealAuditRecord(
 identity: string,
 repo: string,
 path: string,
 key: string,
 decision: "granted" | "denied",
 at: string,
): RevealAuditRecord {
 return { identity, repo, path, key, decision, at };
}

