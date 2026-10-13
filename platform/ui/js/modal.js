// nextgit — inspector modal domain (wave-13 module
// split from app.js). Owns the modal lifecycle, the
// focus trap, and the view-diff / preview-merge actions.
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, renderPatchLines } from "./api.js";
import { decideSecretSurface } from "../reveal-decision.js";
import { commentThreadHtml, commentRefusedHtml, hydrateCommentThreads } from "./comments.js";
/**
 * Focusable controls inside the inspector dialog, in DOM order.
 * Recomputed per call: the dialog body re-renders on merge-tab clicks, so a cached
 * list would point at detached nodes. Non-rendered controls never trap.
 */
export function modalFocusables() {
 if (!el.inspectorModal) return [];
 return Array.from(
  el.inspectorModal.querySelectorAll(
   'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ),
 ).filter((node) => node.getClientRects().length > 0);
}

/**
 * Show inspector modal
 */
export function openModal(title, badgeText, badgeClass, bodyHtml) {
 if (!el.inspectorModal) return;
 const wasHidden = el.inspectorModal.hidden;
 if (wasHidden) {
  // The dialog renders in place (loading → content); only a fresh open captures the
  // trigger — a second render would otherwise store the dialog's own close control.
  state.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
 }
 if (el.modalTitle) el.modalTitle.textContent = title;
 if (el.modalBadge) {
  if (badgeText) {
   el.modalBadge.textContent = badgeText;
   el.modalBadge.className = `badge ${badgeClass || "badge-neutral"}`;
   el.modalBadge.hidden = false;
  } else {
   el.modalBadge.hidden = true;
  }
 }
 if (el.modalBody) el.modalBody.innerHTML = bodyHtml;
 el.inspectorModal.hidden = false;
 if (wasHidden && el.btnCloseModal) el.btnCloseModal.focus();
}

/**
 * Close inspector modal
 */
export function closeModal() {
 if (!el.inspectorModal) return;
 el.inspectorModal.hidden = true;
 if (el.modalBody) el.modalBody.innerHTML = "";
 state.activeInspector = null;
 const returnFocus = state.modalReturnFocus;
 state.modalReturnFocus = null;
 if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
  returnFocus.focus();
 }
}

/**
 * Action: View file diff
 */
export async function handleViewDiff(repo, path) {
 openModal(
  `${repo} — ${path}`,
  "fetching diff...",
  "badge-neutral",
  '<div class="loading-indicator">Loading change-set from /changes...</div>'
 );

 try {
  const data = await fetchJson(`/changes?repo=${encodeURIComponent(repo)}`);
  const changeSet = data.changeSet || {};
  const files = changeSet.files || [];
  const targetFile = files.find((f) => f.path === path);

  if (!targetFile) {
   openModal(
    `${repo} — ${path}`,
    "not found",
    "badge-amber",
    `<div class="empty-state"><div class="empty-state-title">File not present in changeSet</div></div>`
   );
   return;
  }

  if (targetFile.secret) {
   const keys = (targetFile.keys || []).map((k) => `<span class="secret-key-tag">${escapeHtml(k)}</span>`).join(" ");
   const decision = decideSecretSurface({ reveal: state.revealCapability.reveal });
   const control = decision.showControl
    ? `<button class="btn-reveal" type="button" data-reveal-repo="${escapeHtml(repo)}" data-reveal-path="${escapeHtml(path)}" data-reveal-keys="${escapeHtml((targetFile.keys || []).join(","))}">reveal</button>`
    : "";
   openModal(
    `${repo} — ${path}`,
    "secret-typed",
    "badge-secret",
    `
          <div class="empty-state">
            <div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>
            <div class="empty-state-desc">Per platform contract, secret file contents and diffs are never exposed.</div>
            ${keys ? `<div style="margin-top: 1rem;">Keys referenced: ${keys}</div>` : ""}
            ${control ? `<div style="margin-top: 1rem;">${control}</div>` : ""}
          </div>
          <div class="reveal-value" id="reveal-value" hidden></div>
        `
   );
   return;
  }

  const patchHtml = renderPatchLines(targetFile.patch);
  const intentHtml = targetFile.intent ? `<div class="proposal-intent" style="margin-bottom: 1rem;">"${escapeHtml(targetFile.intent)}"</div>` : "";

  openModal(
   `${repo} — ${path}`,
   targetFile.status || "diff",
   targetFile.status === "added" ? "badge-clean" : "badge-neutral",
   `${intentHtml}${patchHtml}`
  );
 } catch (err) {
  openModal(
   `${repo} — ${path}`,
   "error",
   "badge-red",
   `<div class="empty-state"><div class="empty-state-title">Failed to load diff</div><div class="empty-state-desc">${escapeHtml(err.message)}</div></div>`
  );
 }
}

/**
 * Action: Preview 3-way merge
 */
export async function handlePreviewMerge(repo) {
 openModal(
  `Merge preview: ${repo}`,
  "computing diff3...",
  "badge-neutral",
  '<div class="loading-indicator">Computing merge projection from /merge...</div>'
 );

 try {
  const data = await fetchJson(`/merge?repos=${encodeURIComponent(repo)}`);
  const merge = data.merge || {};
  const isConflict = merge.status === "conflict";
  const statusChip = isConflict
   ? { text: "conflict", badgeClass: "badge-red" }
   : { text: "clean", badgeClass: "badge-clean" };

  const files = merge.files || [];
  if (files.length === 0) {
   openModal(
    `Merge preview: ${repo}`,
    statusChip.text,
    statusChip.badgeClass,
    `
          <div class="merge-status-bar">
            <span>Status: <span class="badge ${statusChip.badgeClass}">${statusChip.text}</span></span>
          </div>
          <div class="empty-state">
            <div class="empty-state-title">No files changed in merge</div>
          </div>
        `
   );
   return;
  }

  // Build tabs or stacked file views for merge files
  let activeIndex = 0;
  // In-progress composer drafts, keyed by file path, so a tab switch (which
  // re-renders the modal body and destroys the composer) never silently
  // discards typed-but-unsubmitted comment text.
  const drafts = new Map();

  function renderMergeContent(idx) {
   const f = files[idx];
   if (!f) return "";
   const path = escapeHtml(f.path);
   const action = escapeHtml(f.action || "write");
   const result = escapeHtml(f.result || "merged");
   const isFileConflict = result === "conflict";
   const isSecret = result === "withheld-secret";

   let bodyContent = "";
   if (isSecret) {
    bodyContent = `<div class="empty-state"><div class="empty-state-title">Secret content withheld</div><div class="empty-state-desc">Secret-class file contents are withheld from merge previews.</div></div>`;
   } else if (isFileConflict) {
    bodyContent = `<div class="merge-pane has-conflict">${escapeHtml(f.conflictText || "Conflict detected, but conflict text was not provided.")}</div>`;
   } else {
    bodyContent = `<div class="merge-pane">${escapeHtml(f.merged || "(empty file)")}</div>`;
   }

   const tabsHtml = files.length > 1
    ? `<div class="merge-files-tabs">
            ${files
     .map((fileObj, i) => {
      const tabClass = i === idx ? "merge-file-tab active" : "merge-file-tab";
      const icon = fileObj.result === "conflict" ? " [!]" : "";
      return `<button class="${tabClass}" type="button" data-merge-tab="${i}">${escapeHtml(fileObj.path)}${icon}</button>`;
     })
     .join("")}
           </div>`
    : "";

   return `
        <div class="merge-status-bar">
          <div>
            <span>Overall status: <span class="badge ${statusChip.badgeClass}">${statusChip.text}</span></span>
            <span style="margin-left: 1rem; color: var(--text-muted);">action: ${action} · result: ${result}</span>
          </div>
        </div>
        ${tabsHtml}
        <div style="margin-bottom: 0.5rem; font-weight: 600; color: var(--text-primary);">${path}</div>
        ${bodyContent}
        ${isSecret ? commentRefusedHtml() : commentThreadHtml(repo, f.path)}
      `;
  }

  openModal(
   `Merge preview: ${repo}`,
   statusChip.text,
   statusChip.badgeClass,
   renderMergeContent(activeIndex)
  );
  await hydrateCommentThreads(el.modalBody);

  // Bind tab clicks inside the modal
  if (el.modalBody) {
   el.modalBody.onclick = (e) => {
    const tabBtn = e.target.closest("[data-merge-tab]");
    if (tabBtn) {
     const tabIdx = parseInt(tabBtn.getAttribute("data-merge-tab"), 10);
     if (!isNaN(tabIdx) && files[tabIdx]) {
      // Stash the outgoing tab's draft before the re-render destroys it…
      const cur = el.modalBody.querySelector("[data-comment-body]");
      if (cur) drafts.set(files[activeIndex].path, cur.value);
      activeIndex = tabIdx;
      el.modalBody.innerHTML = renderMergeContent(activeIndex);
      // …and restore the incoming tab's draft into the fresh composer.
      const next = el.modalBody.querySelector("[data-comment-body]");
      if (next) next.value = drafts.get(files[activeIndex].path) || "";
      hydrateCommentThreads(el.modalBody);
     }
    }
   };
  }
 } catch (err) {
  openModal(
   `Merge preview: ${repo}`,
   "error",
   "badge-red",
   `<div class="empty-state"><div class="empty-state-title">Failed to compute merge</div><div class="empty-state-desc">${escapeHtml(err.message)}</div></div>`
  );
 }
}
