// nextgit-platform — shared per-caller rate limiter (AD-9).
//
// One in-isolate fixed-window limiter, bound per route. AD-9 calls for
// EDGE rate limits on `/land`, `/merge`, `/proposals`, `/judge`; the
// as-built substitute (this module) is an in-isolate fixed window —
// the documented closest substitute until the edge limiter ships
// (CONTRACT.md "Rate limits (AD-9)" keeps the note). Per-isolate
// state means an N-isolate deployment has N x the cap.
//
// The limiter is mode-agnostic by construction: reachability is
// mode-gated by the authorize() chokepoint that already precedes
// every handler, and by the handler-side allowlist on the POST
// write paths. It deliberately fails OPEN for unbound routes —
// only the four routes with an entry in ROUTE_RATE_LIMITS are
// limited (documented in CONTRACT.md).
//
// The caller key is `CF-Connecting-IP` (set by Cloudflare's edge in
// production; client-supplied in local dev), extracted here so the
// M2 identity seam can later swap the key source without touching
// the limiter or the routes.

export interface RateLimit {
 limit: number;
 windowMs: number;
}

/** Per-route caps/windows — the single source of truth. */
export const ROUTE_RATE_LIMITS: Record<string, RateLimit> = {
 "/land": { limit: 20, windowMs: 60_000 },
 "/merge": { limit: 60, windowMs: 60_000 },
 "/proposals": { limit: 60, windowMs: 60_000 },
 "/floors": { limit: 60, windowMs: 60_000 },
 "/judge": { limit: 30, windowMs: 60_000 },
 "/upstream": { limit: 20, windowMs: 60_000 },
 "/intents": { limit: 30, windowMs: 60_000 },
 "/forks": { limit: 60, windowMs: 60_000 },
 "/file": { limit: 60, windowMs: 60_000 },
 "/raw": { limit: 60, windowMs: 60_000 },
 // nextgit-e16 (wave-15 lane-union marker): the issues triage read
 // runs the merge simulation per discovered candidate — the same
 // compute-cost class as /merge, so it shares the 60/60s cap
 // (CONTRACT.md §GET /issues §Rate limits).
 "/issues": { limit: 60, windowMs: 60_000 },
 // Inline review comments: the limiter is string-keyed, so the read
 // and write verbs carry distinct budgets at distinct keys.
 "/comments": { limit: 60, windowMs: 60_000 },
 "/comments:write": { limit: 20, windowMs: 60_000 },
 // Per-proposal checks (the authoritative, server-computed
 // strip): same compute-cost class as /proposals (it drives
 // the same fold), so the same 60/60s cap.
 "/checks": { limit: 60, windowMs: 60_000 },
 // Session steering (nextgit-e16): the steer write shares the
 // string-keyed write-verb idiom (/comments:write precedent).
 // GET /sessions is deliberately unbound (a bounded read over
 // <=200 discovered repos — the /changes posture), so only the
 // ":write" key exists; see CONTRACT.md §GET /sessions.
 "/sessions:write": { limit: 30, windowMs: 60_000 },
};

/** One fixed window per (route, caller). */
const windows = new Map<string, Map<string, { start: number; count: number }>>();

/**
 * True when the caller may hit `route` now; false when over the
 * route's per-caller cap for the current window. Unbound route ->
 * true (deliberate fail-open, documented). The sweep only runs when
 * the route's key-space exceeds 500 entries (matching the as-built
 * limiters exactly) — O(500) amortized.
 */
export function rateAllow(route: string, caller: string, now = Date.now()): boolean {
 const limit = ROUTE_RATE_LIMITS[route];
 if (!limit) return true;
 let routeWindows = windows.get(route);
 if (!routeWindows) {
  routeWindows = new Map();
  windows.set(route, routeWindows);
 }
 if (routeWindows.size > 500) {
  for (const [k, w] of routeWindows) {
   if (now - w.start >= limit.windowMs) routeWindows.delete(k);
  }
 }
 const window = routeWindows.get(caller);
 if (!window || now - window.start >= limit.windowMs) {
  routeWindows.set(caller, { start: now, count: 1 });
  return true;
 }
 if (window.count >= limit.limit) return false;
 window.count++;
 return true;
}

/** The uniform 429 — the one place the rate-limited body exists. */
export function rateLimitedResponse(): Response {
 return Response.json({ ok: false, error: "rate-limited" }, { status: 429 });
}

/**
 * Gate for a route: extracts the caller key
 * (`CF-Connecting-IP` ?? `"unknown"`), returns the 429 `Response`
 * when the caller is over the route's cap, `null` when allowed.
 * Handlers do `const denied = rateGate("<route>", request);
 * if (denied) return denied;`.
 */
export function rateGate(route: string, request: Request): Response | null {
 const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
 return rateAllow(route, caller) ? null : rateLimitedResponse();
}
