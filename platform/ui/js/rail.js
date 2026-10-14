// nextgit — convergence rail (nextgit-e17, wave-17 lane L4).
// A horizontal per-repo timeline built from data the page has
// ALREADY fetched — zero new fetches, no new route. Each row
// is one proposal repo: its landing status, its genuine
// conflict-map pairs, the five checks (the /checks consumer's
// server-computed Check[] when present), the /agents policy
// chips, and the repo's event trail (newest-first, as served).
// RENDER-ONLY: no affordances, no data-action — the rail reads
// state, it never writes it.
//
// Honesty law (the acceptance, end to end):
//  - a check is styled pass ONLY from the literal "pass"; a
//    missing /checks payload renders five UNKNOWN dots, never
//    a green row (the checks-strip honesty law carries over);
//  - an attestation badge renders ONLY where the served
//    landing record carries one — `attestation: null` (the
//    typed-absent path) renders NO badge, never a fabricated
//    signature;
//  - every `at` renders through formatTime, which returns ""
//    on a falsy/absent timestamp — the row then shows the
//    em-dash, never a fabricated time;
//  - every interpolated string passes escapeHtml (AD-4):
//    repo names, intents, event types, policy values are
//    agent-/server-authored and untrusted.
import { state, el } from "./state.js";
import { escapeHtml, formatTime } from "./api.js";
import { agentPolicyMap } from "./forks-panel.js";
import { CHECK_IDS } from "./checks.js";

/** The landing-status vocabulary (GET /proposals landing.status). */
export const LANDING_STATUS_LABEL = {
 ready: "ready",
 conflict: "conflict",
 landed: "landed",
 "withheld-secret": "withheld-secret",
};

/**
 * Pure helper: the landing chip class for a proposal's
 * status. An unrecognized status renders as the neutral
 * `unknown` chip — never as `ready` (honest styling: the
 * chip text is the served status verbatim, not a guess).
 */
function landingChipClass(status) {
 return Object.prototype.hasOwnProperty.call(LANDING_STATUS_LABEL, status)
  ? `rail-chip-${status}`
  : "rail-chip-unknown";
}

/**
 * Pure helper: the repo's event trail, newest-first AS SERVED
 * (the /events wire is already newest-first; the rail does not
 * re-sort). Repo-filtered; absent events yield []. The trail is
 * capped by the wire's own ≤50 newest-first bound — the rail
 * renders what the payload carries, never more.
 */
export function railEvents(repo, ctx = {}) {
 const events = Array.isArray(ctx.events) ? ctx.events : [];
 return events.filter((ev) => ev && String(ev.repo ?? "") === repo);
}

/**
 * Pure helper: one repo's check dots. The server-computed
 * Check[] (ctx.checksByRepo[repo]) is the authority and renders
 * verbatim; when absent (route unreachable / the payload carries
 * none), each of the five checks renders `unknown` — the
 * state->class map reaches `check-pass` only from the literal
 * "pass", so an unknown can never be styled green.
 */
function railCheckDots(repo, ctx = {}) {
 const serverChecks = ctx.checksByRepo && typeof ctx.checksByRepo === "object"
  ? (ctx.checksByRepo[repo] ?? null)
  : null;
 const checks = Array.isArray(serverChecks) && serverChecks.length
  ? serverChecks
  : CHECK_IDS.map((id) => ({ id, label: id, state: "unknown", detail: "not in payload" }));
 return CHECK_IDS.map((id) => {
  const check = checks.find((c) => c && c.id === id) || { id, label: id, state: "unknown", detail: "not in payload" };
  const cls = check.state === "pass" ? "check-pass" : check.state === "fail" ? "check-fail" : "check-unknown";
  const title = `${check.label}: ${check.detail}`;
  return (
   `<span class="check ${cls}" data-check="${escapeHtml(check.id)}" title="${escapeHtml(title)}">` +
   `<span class="check-label">${escapeHtml(check.label)}</span>` +
   `</span>`
  );
 }).join("");
}

/**
 * Pure helper: the /agents policy chips for one repo. The
 * roster is keyed by repo via agentPolicyMap(); an absent
 * roster yields an empty map, so every repo renders the
 * "unrecorded" chip (the typed-null posture — never a
 * fabricated policy).
 */
function railPolicyChips(repo) {
 const policy = agentPolicyMap().get(repo) ?? null;
 const chips = policy
  ? Object.entries(policy)
   .map(([key, value]) => {
    const label = escapeHtml(key);
    const chip = escapeHtml(value ?? "unmeasured");
    return `<span class="rail-chip rail-policy" data-policy="${label}"><span class="rail-chip-label">${label}</span><span class="rail-chip-value">${chip}</span></span>`;
   })
   .join("")
  : "";
 const unrecorded = policy ? "" : '<span class="rail-chip rail-chip-unrecorded">unrecorded</span>';
 return chips + unrecorded;
}

/**
 * Pure helper: one rail row. Repo names, intents, event
 * types and policy values are untrusted (AD-4) — every
 * string passes escapeHtml before markup. The row is a
 * horizontal band: the repo header (name + landing chip +
 * attestation badge where a land exists), then the five
 * check dots, the policy chips, and the newest-first event
 * trail. A landed row carries the attestation badge ONLY
 * when the served landing record carries one (`attestation`
 * present and non-null); `attestation: null` (the
 * typed-absent path) renders no badge — never a fabricated
 * signature.
 */
export function railRowHtml(repo, ctx = {}) {
 const proposals = Array.isArray(ctx.proposals) ? ctx.proposals : [];
 const proposal = proposals.find((p) => p && String(p.repo ?? "") === repo) || {};
 const landing = proposal.landing && typeof proposal.landing === "object" ? proposal.landing : null;
 const status = landing && typeof landing.status === "string" ? landing.status : "";
 const chipClass = landingChipClass(status);
 const chipLabel = Object.prototype.hasOwnProperty.call(LANDING_STATUS_LABEL, status) ? status : status || "unknown";
 const intent = typeof proposal.intent === "string" ? proposal.intent : "";
 const attestation = landing && landing.attestation != null ? landing.attestation : null;
 const attestationBadge = attestation
  ? '<span class="rail-badge rail-badge-attestation" title="signed landing attestation">attested</span>'
  : "";

 const events = railEvents(repo, ctx);
 const eventsHtml = events.length
  ? events
   .map((ev) => {
    const type = escapeHtml(ev.type || "event");
    const time = ev.at ? formatTime(ev.at) : "";
    return (
     `<div class="rail-event">` +
     `<span class="rail-event-type">${type}</span>` +
     `${time ? `<span class="rail-event-time">${escapeHtml(time)}</span>` : '<span class="rail-event-time">—</span>'}` +
     `</div>`
    );
   })
   .join("")
  : '<div class="rail-event rail-event-empty">no events</div>';

 return `
      <div class="rail-row" id="rail-${escapeHtml(repo)}" role="listitem">
        <div class="rail-row-header">
          <span class="rail-repo">${escapeHtml(repo)}</span>
          <span class="rail-chip ${chipClass}">${escapeHtml(chipLabel)}</span>
          ${attestationBadge}
        </div>
        ${intent ? `<div class="rail-intent">${escapeHtml(intent)}</div>` : ""}
        <div class="rail-check-dots" role="group" aria-label="${escapeHtml(repo)} checks">${railCheckDots(repo, ctx)}</div>
        <div class="rail-policies">${railPolicyChips(repo)}</div>
        <div class="rail-events">${eventsHtml}</div>
      </div>
    `;
}

/**
 * Pure helper: the honest empty state. With no proposals the
 * rail has no repos to band — it says the set is empty; it
 * does not fabricate a row or claim a state.
 */
export function railEmptyHtml(base) {
 return `
      <div class="rail-empty">
        <div class="rail-empty-title">No convergence activity for ${escapeHtml(base)}</div>
      </div>
    `;
}

/**
 * Render the rail section. First-load treatment (the
 * sessions/forks/issues FR-7 posture): with no proposals
 * payload and no observed failure the loader stands; with a
 * payload the count meta plus one row per proposal repo
 * renders (the empty set renders the honest empty state).
 * The rail rides the payloads the page already fetched —
 * it never fetches of its own, so it has no error state of
 * its own: a failed /proposals fetch leaves the loader
 * standing (the proposals surface owns that failure).
 */
export function renderRail() {
 if (!el.railList || !el.railMeta) return;

 const data = state.proposalsData;
 if (!data || !Array.isArray(data.proposals)) {
  el.railMeta.textContent = "—";
  el.railList.innerHTML = '<div class="rail-loading">Loading the convergence rail from live data...</div>';
  return;
 }

 const proposals = data.proposals;
 const base = data.base && typeof data.base.repo === "string" ? data.base.repo : "";
 el.railMeta.textContent = `${proposals.length} repo${proposals.length === 1 ? "" : "s"}`;

 if (proposals.length === 0) {
  el.railList.innerHTML = railEmptyHtml(base);
  return;
 }

 const ctx = {
  proposals,
  conflicts: Array.isArray(data.conflicts) ? data.conflicts : undefined,
  events: Array.isArray(state.events) ? state.events : [],
  checksByRepo: state.checksByRepo,
 };
 el.railList.innerHTML = proposals
  .map((p) => (p && typeof p.repo === "string" ? railRowHtml(p.repo, ctx) : ""))
  .join("");
}

/**
 * Refresh-cycle wrapper, not a fetch: re-renders from the
 * payloads the page already holds. The rail has no loader of
 * its own to trip — the refresh handler and the pollers
 * re-render it whenever the underlying payloads land.
 */
export function loadRail() {
 renderRail();
}
