// nextgit — auto-land verdict render matrix (pure, no DOM).
//
// The whole render policy of the AD-11 auto-land gate, in one
// extractable/testable module: given the server's ACT/CONFIRM/
// ESCALATE verdict (or the gate's fail-closed error), what does
// the land surface show? The UI RENDERS verdicts; it never
// decides them — no client-side thresholds, weights, or decision
// logic exist here by construction (the mapping is a pure table
// over server-owned inputs; judge.ts owns the policy).
//
// INVARIANT (security spine, mirrors reveal-decision.js): the
// verdict arrives ONLY on the already-authenticated POST /land
// response — either the 200 evidence record (evidence.autoLand)
// or the error envelope (err.response). Blocking codes are
// code-owned literals from the server; every interpolated string
// is escaped at the app.js sink. Nothing here fetches, stores,
// or decides; a rendered advisory never auto-fires the Land
// button ("the judge advises; code decides; humans still own
// irreversible acts" — CONTRACT.md:266).

/**
 * Map a server auto-land verdict to the render posture.
 *
 * ctx:
 *   verdict  — "act" | "confirm" | "escalate" (server-owned,
 *              from judge.ts deriveAutoLandVerdict; absent means
 *              no verdict was carried — "a skip is not a verdict")
 *   setId    — the pinned question-set id the judge consulted
 *   blocking — code-owned reason codes (escalate only)
 *   error    — the gate's fail-closed error code
 *              ("judge-unavailable")
 *
 * Returns { kind, badgeClass, badgeText, noticeHtml }:
 *   kind       — "act" | "confirm" | "escalate" | "blocked" | "none"
 *   badgeClass — the badge tint class for the advisory chip
 *                ("" when no badge renders)
 *   badgeText  — the advisory chip label ("" when none renders)
 *   noticeHtml — escaped banner copy (null when no notice)
 */
export function renderLandVerdict({ verdict, setId, blocking, error } = {}) {
 // Fail-closed gate error: the judge could not answer, so the
 // land was blocked SERVER-side (503). Render the blocked fact
 // with the server's reason — never a bypass action.
 if (error === "judge-unavailable") {
  return {
   kind: "blocked",
   badgeClass: "badge-red",
   badgeText: "blocked",
   noticeHtml:
    "Auto-land gate unavailable — landing blocked by the platform (judge-unavailable). The platform failed closed: no fold, no push. No bypass exists — retry when the gate answers.",
  };
 }

 // Absent verdict: nothing was carried (an unpinned/unanswered
 // judgment is a skip, not a verdict) — render nothing at all.
 if (verdict !== "act" && verdict !== "confirm" && verdict !== "escalate") {
  return { kind: "none", badgeClass: "", badgeText: "", noticeHtml: null };
 }

 if (verdict === "act") {
  // Normal flow: the receipt stands on its own, no advisory.
  return { kind: "act", badgeClass: "badge-clean", badgeText: "", noticeHtml: null };
 }

 if (verdict === "confirm") {
  // Amber advisory: the human still owns the irreversible act —
  // the existing two-step "confirm land?" inline confirming
  // state (btn-land.is-confirming) is the confirmation surface.
  return {
   kind: "confirm",
   badgeClass: "badge-amber",
   badgeText: "confirm",
   noticeHtml:
    "Auto-land verdict: CONFIRM — review before landing. Confirming is a human act: press <strong>confirm land?</strong> on the proposal card.",
  };
 }

 // verdict === "escalate": red advisory. The blocking codes are
 // code-owned literals; they are escaped by the caller's sink
 // (escapeHtml) — never trusted as HTML.
 const codes = Array.isArray(blocking) ? blocking : [];
 const codesHtml = codes
  .map((code) => escapeHtml(String(code)))
  .join(", ");
 const setHtml = setId ? ` (question set ${escapeHtml(String(setId))})` : "";
 return {
  kind: "escalate",
  badgeClass: "badge-red",
  badgeText: "escalate",
  noticeHtml:
   `Auto-land verdict: ESCALATE${setHtml} — landing is held for human review. Blocking: ${codesHtml || "escalated"}. The Land button stays manual: it never auto-fires, and there is no bypass.`,
 };
}

/**
 * Read the auto-land verdict off a successful POST /land 200
 * body: the ACT/CONFIRM verdict rides the evidence record
 * (evidence.autoLand). Returns the verdict object or null when
 * the response carries none (absent verdict → render nothing).
 */
export function landVerdictFromLandResponse(res) {
 const autoLand = res?.evidence?.autoLand;
 if (!autoLand || typeof autoLand !== "object") return null;
 return autoLand;
}

/**
 * Read the auto-land verdict off a thrown /land error envelope
 * (fetchJson throws err = { status, response }). The 409
 * autoland-escalate envelope carries the verdict + blocking
 * codes; the 503 fail-closed envelope carries the
 * judge-unavailable reason. Returns
 * { error } for the 503, { verdict, setId, blocking } for the
 * 409, or null for any other error.
 */
export function landVerdictFromErrorEnvelope(resp) {
 if (!resp || typeof resp !== "object") return null;
 if (resp.error === "judge-unavailable") {
  return { error: resp.error };
 }
 if (resp.error === "autoland-escalate" && resp.verdict === "escalate") {
  return {
   verdict: resp.verdict,
   setId: resp.setId,
   blocking: Array.isArray(resp.blocking) ? resp.blocking : [],
  };
 }
 return null;
}

/**
 * Local HTML escaper (module-private; app.js escapes at its own
 * sinks too — defense in depth: a caller that forgets to escape
 * still gets escaped code here).
 */
function escapeHtml(str) {
 return String(str)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
}
