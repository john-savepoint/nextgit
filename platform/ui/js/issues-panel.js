// nextgit — issues triage domain (nextgit-e16, wave-15;
// issues-v2: composer + close affordances,
// wave-18).
// Owns the GET /issues triage section: the /issues read,
// the per-issue row render, the issue composer (POST
// /issues) and the stored-row close affordance (PATCH
// /issues/{id}). Imports the shared state/el singletons
// and the API client only.
// FAIL-SOFT: this secondary panel never touches connection
// state — a failed /issues fetch must not raise the
// connection banner (the forks-panel precedent), and a
// failed composer submit or close must not either (the
// sessions steer posture).
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";

/** CONTRACT.md §GET /issues issue kinds → concise badge labels. */
export const ISSUE_KIND_LABELS = {
 conflict: "conflict",
 "withheld-secret": "withheld secret",
 "stale-base": "stale base",
 "blocked-intent": "blocked intent",
};

export const ISSUE_SEVERITY_CLASS = {
 high: "high",
 medium: "medium",
 low: "low",
 info: "info",
};

/**
 * Announce a composer/close failure into the section's
 * own live region (WCAG 4.1.3): the failure token is
 * visible on the failed row / button, but a screen
 * reader only hears it if it lands in an aria-live
 * slot (the reveal.js dedicated-slot precedent).
 * renderIssues() clears the slot on every successful
 * render, so a stale announcement never outlives its
 * recovery (the action-banner hidden-clear precedent,
 * land.js).
 */
function announceIssuesStatus(text) {
 if (!el.issuesStatus) return;
 el.issuesStatus.textContent = text;
}

/**
 * Pure helper: one issue row. The v3.8 wire carries the
 * origin discriminator `kind` ("derived"|"stored") and the
 * derivation leg on `issue` (the v1 row shape). Derived rows
 * badge the leg label; stored rows badge "stored", render the
 * escaped `body`, carry the server-minted 12-hex `id` in the
 * row id + a `data-issue-id` hook, render the closed chip
 * (`closed` + `closedAt`) when closed, and carry the
 * close affordance ONLY while open (derived and closed
 * rows render zero `.issue-close` elements by
 * construction). The affordance's `data-issue-repo`
 * carries the BASE repo (the store key the PATCH
 * targets), not the row's filer repo. Repo names,
 * titles, bodies and details are repo content —
 * untrusted (AD-4): every string passes through
 * escapeHtml before markup.
 * `base` is the section's base repo (the close
 * affordance's target).
 */
export function issueRowHtml(issue, base = "") {
 const origin = String(issue?.kind ?? "");
 const repo = String(issue?.repo ?? "");
 const title = String(issue?.title ?? "");
 const detail = String(issue?.detail ?? "");
 const severity = String(issue?.severity ?? "info");
 const links = Array.isArray(issue?.links) ? issue.links : [];
 const leg = String(issue?.issue ?? "");
 const body = String(issue?.body ?? "");
 const issueState = String(issue?.state ?? "");
 const closedAt = issue?.closedAt;
 const isStored = origin === "stored";
 const isClosed = isStored && issueState === "closed";
 // The kind badge labels the ORIGIN leg for derived rows
 // (the derivation issue kind) and "stored" for stored rows.
 const kindLabel = isStored
  ? "stored"
  : Object.prototype.hasOwnProperty.call(ISSUE_KIND_LABELS, leg)
   ? ISSUE_KIND_LABELS[leg]
   : leg;
 const severityClass = Object.prototype.hasOwnProperty.call(ISSUE_SEVERITY_CLASS, severity)
  ? ISSUE_SEVERITY_CLASS[severity]
  : "info";
 const linksHtml = links
  .map((href) => `<a class="issue-link" href="${escapeHtml(String(href))}">${escapeHtml(String(href))}</a>`)
  .join("");
 // Stored rows carry the server-minted id (the close
 // affordance's target); derived rows keep the leg-derived
 // v1 row id (the row's identity within the derived set —
 // the leg, repo and detail).
 const rowId = isStored ? String(issue?.id ?? "") : `${leg}-${repo}-${detail}`;
 const bodyHtml = isStored && body ? `<div class="issue-body">${escapeHtml(body)}</div>` : "";
 const stateHtml = isClosed
  ? `<span class="issue-state closed">closed${closedAt ? ` ${escapeHtml(String(formatTime(closedAt)))}` : ""}</span>`
  : "";
 const closeHtml = isStored && !isClosed
  ? `<button class="issue-close" type="button" data-issue-id="${escapeHtml(String(issue?.id ?? ""))}" data-issue-repo="${escapeHtml(base)}">close</button>`
  : "";
 return `
      <div class="issue-row issue-severity-${severityClass}" id="issue-${escapeHtml(rowId)}">
        <div class="issue-row-header">
          <span class="issue-kind-badge">${escapeHtml(kindLabel)}</span>
          <span class="issue-repo">${escapeHtml(repo)}</span>
          ${stateHtml}
        </div>
        <div class="issue-title">${escapeHtml(title)}</div>
        <div class="issue-detail">${escapeHtml(detail)}</div>
        ${bodyHtml}
        ${linksHtml ? `<div class="issue-links">${linksHtml}</div>` : ""}
        ${closeHtml}
      </div>
    `;
}

/**
 * Pure helper: the issue composer (POST /issues). The caps
 * mirror the wire contract (title 1..128, body 1..2000, the
 * 4-value severity) — the client clamp is UX; the server's
 * 400 remains the authority. `base` is the target repo.
 */
export function issueComposerHtml(base) {
 return `
        <form class="issue-composer" data-issue-base="${escapeHtml(base)}">
          <input class="issue-composer-title" type="text" name="title" maxlength="128" aria-label="Issue title (1–128 chars)" placeholder="Issue title (1–128 chars)" required>
          <textarea class="issue-composer-body" name="body" rows="3" maxlength="2000" aria-label="Issue body (1–2000 chars)" placeholder="Issue body (1–2000 chars)" required></textarea>
          <select class="issue-composer-severity" name="severity" aria-label="Severity">
            <option value="high">high</option>
            <option value="medium" selected>medium</option>
            <option value="low">low</option>
            <option value="info">info</option>
          </select>
          <button class="issue-composer-submit" type="submit">file issue</button>
        </form>
      `;
}

/**
 * Fetch the derived + stored issue list from /issues.
 * Fail-soft: a failed fetch flips the panel's own error flag
 * and renders the quiet unavailable state — it never touches
 * connection state, so the connection banner stays the
 * /proposals fetch's to raise.
 */
export async function loadIssues() {
 try {
  state.issuesData = await fetchJson("/issues");
  state.issuesError = false;
 } catch {
  state.issuesData = null;
  state.issuesError = true;
 }
 renderIssues();
}

/**
 * Render the issues triage section. First-load treatment
 * (the forks-panel FR-7 posture): with no payload and no
 * observed failure the loader stands; an observed failure
 * renders the quiet unavailable line; a payload renders
 * the count meta, the rows, and (always, under the rows or
 * the empty state) the composer.
 */
export function renderIssues() {
 if (!el.issuesList || !el.issuesMeta) return;

 // A successful render is the recovery: clear any standing
 // failure announcement so it never outlives the refetch
 // that reconciles it.
 if (el.issuesStatus) el.issuesStatus.textContent = "";

 const data = state.issuesData;
 if (!data) {
  el.issuesMeta.textContent = "—";
  el.issuesList.innerHTML = state.issuesError
   ? '<div class="issues-unavailable">Issues unavailable.</div>'
   : '<div class="issues-loading">Loading issues from /issues...</div>';
  return;
 }

 const issues = Array.isArray(data.issues) ? data.issues : [];
 const base = typeof data.base === "string" ? data.base : "";
 el.issuesMeta.textContent = `${issues.length} issue${issues.length === 1 ? "" : "s"}`;

 const composer = issueComposerHtml(base);

 if (issues.length === 0) {
  el.issuesList.innerHTML = `
        <div class="issues-empty">
          <div class="issues-empty-title">No open issues for ${escapeHtml(base)}</div>
        </div>
        ${composer}
      `;
  return;
 }

 el.issuesList.innerHTML = issues.map((issue) => issueRowHtml(issue, base)).join("") + composer;
}

/**
 * Submit the issue composer: POST {repo, title, body,
 * severity} to /issues. Optimistic: an `.issue-row.is-pending`
 * row appends under the composer with the submit disabled;
 * success reconciles by refetch (loadIssues renders the new
 * stored row); failure renders an `.issue-row.is-failed` row
 * naming the server's error token, re-enables the submit, and
 * retains the draft (the composer is re-rendered from state,
 * so the operator's text is not silently dropped). Never
 * touches connection state (the steer/posture fail-soft
 * posture); a failed submit never rejects into the caller's
 * trap.
 */
export async function submitIssue(form) {
 try {
  const base = String(form.getAttribute("data-issue-base") || "");
  const title = String(form.elements?.title?.value ?? "");
  const body = String(form.elements?.body?.value ?? "");
  const severity = String(form.elements?.severity?.value ?? "info");
  if (!base || !title || !body) return;

  const submit = form.querySelector(".issue-composer-submit");
  // Optimistic pending row: the row renders the submitted
  // title (escaped) with the is-pending marker; the submit
  // is disabled while the POST is in flight.
  const pendingRow = document.createElement("div");
  pendingRow.className = "issue-row issue-severity-medium is-pending";
  pendingRow.innerHTML = `
          <div class="issue-row-header">
            <span class="issue-kind-badge">pending</span>
            <span class="issue-repo">${escapeHtml(base)}</span>
          </div>
          <div class="issue-title">${escapeHtml(title)}</div>
        `;
  form.insertAdjacentElement("beforebegin", pendingRow);
  if (submit) submit.disabled = true;

  // The refetch re-renders #issues-list via innerHTML, which
   // would drop a keyboard operator's focus to <body> — capture
   // the active element and restore it after the reconcile (the
   // modal.js returnFocus idiom).
   const returnFocus = document.activeElement;
   try {
   await fetchJson("/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: base, title, body, severity }),
   });
   // Success: reconcile by refetch — loadIssues() renders
   // the new stored row (the meta counts +1, the pending
   // row is gone).
   await loadIssues();
   if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
    returnFocus.focus();
   }
  } catch (err) {
   // Honest failure: replace the pending row with an
   // is-failed row naming the server's token (never
   // silent), re-enable the submit, retain the draft.
   const token = err?.response?.error || err?.message || "unknown error";
   pendingRow.className = "issue-row issue-severity-medium is-failed";
   pendingRow.innerHTML = `
          <div class="issue-row-header">
            <span class="issue-kind-badge">failed</span>
            <span class="issue-repo">${escapeHtml(base)}</span>
          </div>
          <div class="issue-title">${escapeHtml(title)}</div>
          <div class="issue-detail">${escapeHtml(String(token))}</div>
        `;
   if (submit) submit.disabled = false;
   // The failed row is the visible token; the live region
   // is the announcement (WCAG 4.1.3).
   announceIssuesStatus(`Issue filing failed for ${base}: ${String(token)}`);
  }
 } catch {
  // A failed submit must never reject into the caller's trap.
 }
}

/**
 * Close one stored issue: PATCH /issues/{id} with the fixed
 * literal {state:"closed"}. Optimistic: the button enters its
 * data-closing state ("closing…"); success reconciles by
 * refetch (the row renders the closed chip, no button);
 * failure renders the server's token honestly (the already-
 * closed / not-found / allowlist / shape / rate-limit legs)
 * and restores the button. Never touches connection state.
 */
export async function closeIssue(button) {
 try {
  const id = String(button.getAttribute("data-issue-id") || "");
  const base = String(button.getAttribute("data-issue-repo") || "");
  if (!id || !base) return;

  button.setAttribute("data-closing", "1");
  button.textContent = "closing…";
  button.disabled = true;

  // The success refetch removes the focused button, so the
  // focused element cannot survive it — restore to the
  // section instead (the modal.js returnFocus idiom's
  // section-level fallback).
  const section = button.closest("#issues-section");
  try {
   await fetchJson("/issues/" + encodeURIComponent(id) + "?base=" + encodeURIComponent(base), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed" }),
   });
   // Success: reconcile by refetch — the row renders the
   // closed chip and no close button.
   await loadIssues();
   if (section && typeof section.focus === "function") {
    section.focus();
   }
  } catch (err) {
   // Honest failure: the server's token (409 already-closed,
   // 404 not-found, 403, 400, 429) is surfaced on the
   // button and the button is restored for a retry.
   const token = err?.response?.error || err?.message || "unknown error";
   button.removeAttribute("data-closing");
   button.textContent = `close (${String(token)})`;
   button.disabled = false;
   // The button text is the visible retry affordance; the
   // live region is the announcement (WCAG 4.1.3).
   announceIssuesStatus(`Close failed for ${id}: ${String(token)}`);
  }
 } catch {
  // A failed close must never reject into the caller's trap.
 }
}
