// nextgit — issues triage domain (nextgit-e16, wave-15).
// Owns the GET /issues triage section: the /issues read
// and the per-issue row render. Imports the shared
// state/el singletons and the API client only.
// FAIL-SOFT: this secondary panel never touches connection
// state — a failed /issues fetch must not raise the
// connection banner (the forks-panel precedent).
import { state, el } from "./state.js";
import { fetchJson, escapeHtml } from "./api.js";

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
 * Pure helper: one issue row — the kind badge, the escaped
 * repo/title/detail, and the links anchors. Repo names,
 * titles and details are platform state (paths, counts,
 * verdict tokens), but repo content is untrusted (AD-4):
 * every string passes through escapeHtml before markup.
 */
export function issueRowHtml(issue) {
 const kind = String(issue?.kind ?? "");
 const repo = String(issue?.repo ?? "");
 const title = String(issue?.title ?? "");
 const detail = String(issue?.detail ?? "");
 const severity = String(issue?.severity ?? "info");
 const links = Array.isArray(issue?.links) ? issue.links : [];
 const kindLabel = Object.prototype.hasOwnProperty.call(ISSUE_KIND_LABELS, kind)
  ? ISSUE_KIND_LABELS[kind]
  : kind;
 const severityClass = Object.prototype.hasOwnProperty.call(ISSUE_SEVERITY_CLASS, severity)
  ? ISSUE_SEVERITY_CLASS[severity]
  : "info";
 const linksHtml = links
  .map((href) => `<a class="issue-link" href="${escapeHtml(String(href))}">${escapeHtml(String(href))}</a>`)
  .join("");
 return `
      <div class="issue-row issue-severity-${severityClass}" id="issue-${escapeHtml(kind)}-${escapeHtml(repo)}-${escapeHtml(detail)}">
        <div class="issue-row-header">
          <span class="issue-kind-badge">${escapeHtml(kindLabel)}</span>
          <span class="issue-repo">${escapeHtml(repo)}</span>
        </div>
        <div class="issue-title">${escapeHtml(title)}</div>
        <div class="issue-detail">${escapeHtml(detail)}</div>
        ${linksHtml ? `<div class="issue-links">${linksHtml}</div>` : ""}
      </div>
    `;
}

/**
 * Fetch the derived issue list from /issues. Fail-soft: a
 * failed fetch flips the panel's own error flag and renders
 * the quiet unavailable state — it never touches connection
 * state, so the connection banner stays the /proposals
 * fetch's to raise.
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
 * the count meta, the empty state, or one row per issue.
 */
export function renderIssues() {
 if (!el.issuesList || !el.issuesMeta) return;

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

 if (issues.length === 0) {
  el.issuesList.innerHTML = `
        <div class="issues-empty">
          <div class="issues-empty-title">No open issues for ${escapeHtml(base)}</div>
        </div>
      `;
  return;
 }

 el.issuesList.innerHTML = issues.map((issue) => issueRowHtml(issue)).join("");
}
