// nextgit — sessions domain (nextgit-e16, wave-16;
// the instructions subsection is nextgit-e19).
// Owns the GET /sessions list, the per-repo steer
// composer (POST /sessions/{repo}/steer), and the
// per-repo instructions subsection
// (GET /sessions/{repo}/instructions, cursor-advanced).
// Imports the shared state/el singletons and the API
// client only.
// FAIL-SOFT: this secondary panel never touches
// connection state — a failed /sessions or
// /instructions fetch must not raise the connection
// banner (the forks/issues precedent).
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";
import { showActionBanner } from "./land.js";

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
        ${sessionInstructionsHtml(instructionRowsFrom(repo))}
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
 * Pure helper: one recorded instruction row. The text is
 * agent-authored and untrusted (AD-4): the text AND the
 * rendered instant pass through escapeHtml before markup —
 * the escape discipline is unconditional, never conditional
 * on a field looking safe.
 */
export function instructionRowHtml(instruction) {
 const text = typeof instruction?.text === "string" ? instruction.text : "";
 const at = instruction?.at;
 return `
        <div class="session-instruction">
          <div class="session-instruction-text">${escapeHtml(text)}</div>
          <div class="session-instruction-time">${escapeHtml(formatTime(at))}</div>
        </div>
      `;
}

/**
 * Pure helper: the instructions subsection for one repo.
 * The honest no-instructions state says exactly that — a
 * repo whose recorded feed carries no instruction reads
 * "No instructions recorded", never a fabricated row (the
 * sessionEmptyHtml absent-is-not-idle posture).
 */
export function sessionInstructionsHtml(rows) {
 const body = rows.length
  ? rows.map((instruction) => instructionRowHtml(instruction)).join("")
  : '<div class="session-instructions-empty">No instructions recorded</div>';
 return `
      <div class="session-instructions">
        ${body}
      </div>
    `;
}

/**
 * Pure selector: the recorded instructions for a repo,
 * newest-first. A repo the poll has not observed yet
 * selects [] — the subsection then renders the honest
 * empty state (never a fabricated row).
 */
export function instructionRowsFrom(repo) {
 const rows = state.sessionsInstructionsByRepo[String(repo)];
 return Array.isArray(rows) ? rows : [];
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
  // Fan out the per-repo instructions poll: every session the
  // feed evidences gets its own GET /sessions/{repo}/instructions.
  // This list refreshes at the events cadence (the 2s
  // sessionsTimer in ticker.js) and on every manual refresh, so
  // the subsections refresh with it. Fire-and-forget: each poll
  // re-renders itself on success and stays quiet on failure, so
  // this render never waits on the instructions read.
  const sessions = Array.isArray(state.sessionsData?.sessions) ? state.sessionsData.sessions : [];
  for (const session of sessions) {
   if (session && session.repo) loadSessionInstructions(session.repo);
  }
 } catch {
  state.sessionsData = null;
  state.sessionsError = true;
 }
 scheduleSessionsRender();
}

/**
 * Fetch one repo's recorded instructions from
 * GET /sessions/{repo}/instructions, newest-first, and
 * advance that repo's cursor. Success REPLACES the stored
 * rows wholesale — duplicate-free by construction, since a
 * cursor-advanced poll only ever carries rows newer than the
 * ones it replaces. The cursor advances whenever the server
 * serves the field (absent → the stored cursor stands; null
 * → no rows were served, so the next poll re-reads from the
 * beginning). Fail-soft, quietly: ANY failure leaves both
 * maps exactly as they were — no banner, no connection
 * state, no action banner (the ambient-failure precedent
 * this panel already keeps for /sessions).
 */
export async function loadSessionInstructions(repo) {
 const key = String(repo);
 try {
  const cursor = state.sessionsInstructionsCursor[key];
  const since = cursor ? `?since=${encodeURIComponent(cursor)}` : "";
  const data = await fetchJson("/sessions/" + encodeURIComponent(key) + "/instructions" + since);
  state.sessionsInstructionsByRepo[key] = Array.isArray(data?.instructions) ? data.instructions : [];
  if (data && Object.prototype.hasOwnProperty.call(data, "cursor")) {
   state.sessionsInstructionsCursor[key] = data.cursor == null ? null : String(data.cursor);
  }
  scheduleSessionsRender();
 } catch {
  // Quiet: the stored rows and cursor stand (never a fabricated row).
 }
}

// Render coalescing (the per-poll churn guard): loadSessions and
// every fire-and-forget loadSessionInstructions success each call
// renderSessions(); a single 2s tick with N sessions would otherwise
// perform up to N+1 full innerHTML swaps. Coalesce to one render
// per microtask — the swap happens once per tick, not once per poll.
let renderQueued = false;
function scheduleSessionsRender() {
 if (renderQueued) return;
 renderQueued = true;
 queueMicrotask(() => { renderQueued = false; renderSessions(); });
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

 // The 2s cadence re-renders this list wholesale while the
 // operator may be mid-type in a steer composer. Stash every
 // draft and the focused composer's caret BEFORE the swap,
 // re-apply after — an ambient tick must never silently
 // discard typed-but-unsubmitted steer text or drop focus
 // (the modal.js merge-composer drafts idiom, modal.js:243-250;
 // the issues-panel returnFocus idiom, issues-panel.js:246-259).
 const focused = document.activeElement;
 const focusedRepo =
  focused && focused.classList && focused.classList.contains("steer-input")
   ? focused.getAttribute("data-steer-repo")
   : null;
 const caret = focusedRepo ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
 const drafts = new Map();
 for (const input of el.sessionsList.querySelectorAll(".steer-input[data-steer-repo]")) {
  if (input.value) drafts.set(input.getAttribute("data-steer-repo"), input.value);
 }

 el.sessionsList.innerHTML = sessions.map((session) => sessionRowHtml(session)).join("");

 for (const input of el.sessionsList.querySelectorAll(".steer-input[data-steer-repo]")) {
  const draft = drafts.get(input.getAttribute("data-steer-repo"));
  if (draft) input.value = draft;
 }
 if (focusedRepo) {
  const restored = [...el.sessionsList.querySelectorAll(".steer-input[data-steer-repo]")]
   .find((input) => input.getAttribute("data-steer-repo") === focusedRepo);
  if (restored) {
   restored.focus();
   if (caret && typeof restored.setSelectionRange === "function") {
    restored.setSelectionRange(caret.start, caret.end);
   }
  }
 }
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
   control.disabled = false;
   control.removeAttribute("data-steer-sent");
   control.textContent = "send";
  }
 } catch {
  // A failed submit must never reject into the caller's trap.
 }
}
