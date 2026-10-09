// nextgit-platform — auth seam (FR-45 / AD-9).
//
// One authorize() chokepoint: AUTH_MODE absent or anything other than "demo"
// ⇒ default-deny (every route returns 401 before any repo read); "demo" ⇒
// null (authorized, current demo behavior preserved). The full auth seam
// (identity resolution, rate limits, CSRF, reveal path) is sequenced M2; this
// slice ships the chokepoint + default-deny + the demo opt-in.

/** Action vocabulary — pinned in platform/CONTRACT.md (v2.4). */
export type ActionType = "read" | "write" | "judge" | "reveal";

/** Minimal env shape: AUTH_MODE is the only seam knob today. */
export interface AuthEnv {
 AUTH_MODE?: string;
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
 * Single chokepoint — called by every route in the dispatcher.
 * - deny mode: returns unauthorizedResponse() before any repo read.
 * - demo mode: returns null (authorized; current demo behavior preserved).
 *
 * params.scope is reserved for the demo-allowlist future slice; this wave
 * only needs mode gating, so action/params are accepted for contract shape
 * and ignored beyond mode resolution.
 */
export function authorize(
 _request: Request,
 env: AuthEnv,
 _action: ActionType,
 _params?: { repo?: string; base?: string },
): Response | null {
 return resolveAuthMode(env) === "demo" ? null : unauthorizedResponse();
}
