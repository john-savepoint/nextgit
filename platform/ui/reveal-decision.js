// nextgit — secret-surface render-decision matrix (pure, no DOM).
//
// The whole security policy of the CAP-8 elevated-reveal beat, in
// one extractable/testable module: given the viewer's reveal
// capability and the current reveal interaction state, what does
// the secret-class surface render?
//
// INVARIANT (security spine): a value is rendered ONLY in the
// "revealed" cell — and even there valueHtml is null. The value
// string is injected by app.js ONLY from the audited POST /reveal
// 200 response body, escaped, never from /changes, /merge, or
// card data. renderValue is the flag that says "the caller may now
// inject a value"; it is true in exactly one cell.

/**
 * Decide the secret-class surface for a diff/merge view.
 *
 * ctx:
 *   reveal       — the viewer's capability (state.revealCapability.reveal,
 *                  set ONLY from the /whoami response; never from card data)
 *   isSecret     — the file is secret-class (default true: this decides the
 *                  secret surface, so a non-secret file short-circuits to
 *                  the ordinary withheld posture)
 *   revealGranted — POST /reveal returned 200 { ok:true, value }
 *   revealDenied  — POST /reveal returned 403 reveal-not-authorized
 *   revealFailed  — POST /reveal errored (network/5xx/other)
 *
 * Returns { kind, renderValue, showControl, valueHtml, noticeHtml }:
 *   kind        — "withheld" | "control" | "revealed" | "denied" | "error"
 *   renderValue — the ONLY flag that permits a value sink (true ⟺ revealed)
 *   showControl — render the affordance (true only when reveal-capable)
 *   valueHtml   — always null (the value is injected by the caller, escaped)
 *   noticeHtml  — the withheld/denial/error copy (null when no notice)
 */
export function decideSecretSurface(ctx) {
 const { reveal = false, isSecret = true, revealGranted = false, revealDenied = false, revealFailed = false } = ctx ?? {};
 if (!isSecret) return { kind: "withheld", renderValue: false, showControl: false, valueHtml: null, noticeHtml: null };
 // Defense-in-depth: a grant/denial/failure is only honored for a
 // reveal-CAPABLE viewer (reveal:true, set solely from /whoami).
 // An unauthorized viewer's client-supplied interaction flag is
 // never trusted — it renders the withheld posture, no value.
 if (reveal && revealGranted) return { kind: "revealed", renderValue: true, showControl: false, valueHtml: null, noticeHtml: null };
 if (reveal && revealDenied) return { kind: "denied", renderValue: false, showControl: true, valueHtml: null, noticeHtml: "Secret content withheld — reveal not authorized." };
 if (reveal && revealFailed) return { kind: "error", renderValue: false, showControl: true, valueHtml: null, noticeHtml: "Secret content withheld — reveal unavailable." };
 return { kind: reveal ? "control" : "withheld", renderValue: false, showControl: reveal, valueHtml: null, noticeHtml: reveal ? null : "Secret content withheld" };
}
