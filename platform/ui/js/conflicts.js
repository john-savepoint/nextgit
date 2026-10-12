// nextgit — conflicts domain (wave-13 module split from app.js).
// Owns conflict-severity classification and the conflicts panel render.
import { state, el } from "./state.js";
import { escapeHtml } from "./api.js";

/**
 * Pure helper: Map conflict kind to severity category
 * kind ∈ text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed
 */
export function getConflictSeverity(kind) {
 switch (kind) {
  case "text-conflict":
  case "modify/delete":
  case "add/add":
   return { class: "severity-red", badgeClass: "badge-red" };
  case "undetermined":
   return { class: "severity-amber", badgeClass: "badge-amber" };
  case "mergeable":
  case "identical-add":
  case "both-removed":
  default:
   return { class: "severity-neutral", badgeClass: "badge-neutral" };
 }
}

/**
 * Render Conflicts Panel
 */
export function renderConflicts() {
 if (!el.conflictsList || !el.conflictsMeta) return;

 const data = state.proposalsData;
 if (!data) {
  // First-load treatment (FR-7): no payload observed yet — cold load or a
  // failed first fetch while the 8s poll retries. Never assert counts or
  // emptiness for a set we have not seen.
  el.conflictsMeta.textContent = "—";
  el.conflictsList.innerHTML = '<div class="loading-indicator">Loading the set from /proposals...</div>';
  return;
 }

 const conflicts = data?.conflicts || [];
 el.conflictsMeta.textContent = `${conflicts.length} detected`;

 if (conflicts.length === 0) {
  el.conflictsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No convergence conflicts</div>
        <div class="empty-state-desc">Waiting for concurrent proposals to compare on shared files.</div>
      </div>
    `;
  return;
 }

 const html = conflicts
  .map((c) => {
   const file = escapeHtml(c.file);
   const kind = escapeHtml(c.kind || "text-conflict");
   const severity = getConflictSeverity(c.kind);
   const repos = Array.isArray(c.repos) ? c.repos : [];
   const pairs = Array.isArray(c.pairs) ? c.pairs : [];

   const reposTags = repos.map((r) => `<span class="repo-tag">${escapeHtml(r)}</span>`).join("");

   const pairsHtml = pairs.length
    ? `<div class="conflict-pairs">
            ${pairs
     .map((p) => {
      const a = escapeHtml(p.a);
      const b = escapeHtml(p.b);
      const pairKind = escapeHtml(p.kind || kind);
      const region = p.region;
      const regionDesc = region
       ? `(base: ${region.baseLines ?? 0}L, ${a}: ${region.aLines ?? 0}L, ${b}: ${region.bLines ?? 0}L)`
       : "";
      return `
                  <div class="conflict-pair-row">
                    <span class="pair-endpoints">${a} ↔ ${b}</span>
                    <span class="pair-kind">${pairKind}</span>
                    ${regionDesc ? `<span class="pair-region">${regionDesc}</span>` : ""}
                  </div>
                `;
     })
     .join("")}
          </div>`
    : "";

   return `
        <div class="conflict-card ${severity.class}">
          <div class="conflict-card-header">
            <span class="conflict-file">${file}</span>
            <div class="conflict-badge-group">
              <span class="badge ${severity.badgeClass}">${kind}</span>
            </div>
          </div>
          <div class="conflict-repos-involved">
            <span>proposals:</span>
            ${reposTags}
          </div>
          ${pairsHtml}
        </div>
      `;
  })
  .join("");

 el.conflictsList.innerHTML = html;
}
