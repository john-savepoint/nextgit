// nextgit — sessions domain (nextgit-e16, wave-16).
// Owns the GET /sessions list + the per-repo steer
// composer (POST /sessions/{repo}/steer). Imports
// the shared state/el singletons and the API client
// only.
// FAIL-SOFT: this secondary panel never touches
// connection state — a failed /sessions fetch must
// not raise the connection banner (the forks/issues
// precedent).
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";
import { showActionBanner } from "./land.js";

/**
 * Announce a steer failure into the section's own
 * live region (WCAG 4.1.3): the failure token is
 * visible via the action banner, but a screen reader
 * only hears it if it lands in an aria-live slot
 * (the reveal.js dedicated-slot precedent, the
 * issues-panel announceIssuesStatus posture).
 * renderSessions() clears the slot on every
 * successful render, so a stale announcement never
 * outlives its recovery (the action-banner
 * hidden-clear precedent, land.js).
 */
function announceSessionsStatus(text) {
 if (!el.sessionsStatus) return;
 el.sessionsStatus.textContent = text;
}


/** The closed session-state vocabulary the server derives. */
export const SESSION_STATES = { working: "working", idle: "idle", blocked: "blocked" };

/**
 * Pure helper: the state chip class for a session's
 * server-derived state. An unknown state value renders
 * as `unknown` with the neutral class — never as
 * `working` (honest styling: the chip text is the
 * server-derived state verbatim, not a guess).
 */
function sessionStateClass(rawState) {
 return Object.prototype.hasOwnProperty.call(SESSION_STATES, rawState)
  ? SESSION_STATES[rawState]
  : "unknown";
}

/**
 * Pure helper: one session row. Repo names and the
 * intent/lastEvent text are agent-authored and
 * untrusted (AD-4): every string passes through
 * escapeHtml before markup. Optional fields
 * (intent / lastEvent / lastActivityAt) are omitted
 * from the row when the server omits them — the row
 * renders only what the /sessions projection carries.
 */
export function sessionRowHtml(session) {
 const repo = String(session?.repo ?? "");
 const rawState = String(session?.state ?? "");
 const stateLabel = sessionStateClass(rawState);
 const stateClass = stateLabel;
 const intent = typeof session?.intent === "string" ? session.intent : "";
 const lastEvent = typeof session?.lastEvent === "string" ? session.lastEvent : "";
 const lastActivityAt = session?.lastActivityAt;
 const intentHtml = intent ? `<div class="session-intent">${escapeHtml(intent)}</div>` : "";
 const lastEventParts = [];
 if (lastEvent) lastEventParts.push(escapeHtml(lastEvent));
 if (lastActivityAt) lastEventParts.push(formatTime(lastActivityAt));
 const lastEventHtml = lastEventParts.length
  ? `<div class="session-last-event">${lastEventParts.join(" · ")}</div>`
  : "";
 return `
      <div class="session-row" id="session-${escapeHtml(repo)}">
        <div class="session-row-header">
          <span class="session-repo">${escapeHtml(repo)}</span>
          <span class="session-state session-state-${stateClass}">${escapeHtml(stateLabel)}</span>
        </div>
        ${intentHtml}
        ${lastEventHtml}
        <div class="steer-composer">
          <textarea class="steer-input" data-steer-repo="${escapeHtml(repo)}" rows="2" maxlength="500" aria-label="Steer ${escapeHtml(repo)}" placeholder="Steer ${escapeHtml(repo)} (1–500 chars)"></textarea>
          <button class="steer-send" type="button">send</button>
        </div>
      </div>
    `;
}

/**
 * Pure helper: the honest empty state. The contract's
 * absent-rows posture — a repo with no feed evidence
 * is ABSENT (never a fabricated `idle` row), so the
 * empty state says there is no session activity; it
 * does not claim "all idle".
 */
export function sessionEmptyHtml(base) {
 return `
      <div class="sessions-empty">
        <div class="sessions-empty-title">No session activity for ${escapeHtml(base)}</div>
      </div>
    `;
}

/**
 * Fetch the session list from /sessions. Fail-soft:
 * a failed fetch flips the panel's own error flag and
 * renders the quiet unavailable state — it never
 * touches connection state, so the connection banner
 * stays the /proposals fetch's to raise.
 */
export async function loadSessions() {
 try {
  state.sessionsData = await fetchJson("/sessions");
  state.sessionsError = false;
 } catch {
  state.sessionsData = null;
  state.sessionsError = true;
 }
 renderSessions();
}

/**
 * Render the sessions section. First-load treatment
 * (the forks/issues FR-7 posture): with no payload
 * and no observed failure the loader stands; an
 * observed failure renders the quiet unavailable
 * line; a payload renders the count meta, the empty
 * state, or one row per session.
 */
export function renderSessions() {
 if (!el.sessionsList || !el.sessionsMeta) return;

 // A successful render is the recovery: clear any
 // standing failure announcement so it never
 // outlives the refetch that reconciles it (the
 // renderIssues issues-status posture).
 if (el.sessionsStatus) el.sessionsStatus.textContent = "";

 const data = state.sessionsData;
 if (!data) {
  el.sessionsMeta.textContent = "—";
  el.sessionsList.innerHTML = state.sessionsError
   ? '<div class="sessions-unavailable">Sessions unavailable.</div>'
   : '<div class="sessions-loading">Loading sessions from /sessions...</div>';
  return;
 }

 const sessions = Array.isArray(data.sessions) ? data.sessions : [];
 const base = typeof data.base === "string" ? data.base : "";
 el.sessionsMeta.textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;

 if (sessions.length === 0) {
  el.sessionsList.innerHTML = sessionEmptyHtml(base);
  return;
 }

 el.sessionsList.innerHTML = sessions.map((session) => sessionRowHtml(session)).join("");
}

/**
 * Submit a steer composer: POST the instruction as a
 * session.steered event, keep the optimistic `sent`
 * marker on success (the row's state reconciles when
 * loadSessions() next runs), or surface the failure
 * via the action banner — never silently (the
 * comments.js submitComment posture). The response
 * carries no instruction text (AD-4), so nothing is
 * echoed back into the DOM.
 */
export async function submitSteer(control) {
 try {
  const row = control.closest(".session-row");
  if (!row) return;
  const textarea = row.querySelector(".steer-input[data-steer-repo]");
  if (!textarea) return;
  const repo = String(textarea.getAttribute("data-steer-repo") || "");
  const instruction = textarea.value;
  if (!repo || !instruction) return;

  // Optimistic `sent` state: the send button carries the
  // sent marker (data-steer-sent="1"), disabled, "sent".
  control.disabled = true;
  control.setAttribute("data-steer-sent", "1");
  control.textContent = "sent";

  try {
   await fetchJson("/sessions/" + encodeURIComponent(repo) + "/steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
   });
   // Success: the sent marker stays; the session row's
   // state reconciles when loadSessions() next runs (the
   // refreshed feed carries the session.steered evidence).
  } catch (err) {
   // Honest failure: surface the server's error token via
   // the action banner (never silent) and remove the sent
   // marker so the composer retries honestly.
   const token = err?.response?.error || err?.message || "unknown error";
   showActionBanner(
    "error",
    "steer-failed",
    `Steer failed for <strong>${escapeHtml(repo)}</strong>: <strong>${escapeHtml(String(token))}</strong>`
   );
   // The banner is the visible token; the live
   // region is the announcement (WCAG 4.1.3 —
   // the issues-panel announceIssuesStatus
   // posture). textContent keeps the copy
   // injection-safe.
   announceSessionsStatus(`Steer failed for ${repo}: ${String(token)}`);
   control.disabled = false;
   control.removeAttribute("data-steer-sent");
   control.textContent = "send";
  }
 } catch {
  // A failed submit must never reject into the caller's trap.
 }
}
