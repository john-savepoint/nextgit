// nextgit — interaction wiring + boot (wave-13
// module split from app.js). Owns event delegation,
// the modal keydown trap, the manual-refresh and
// connection-banner handlers, and init().
import { state, el } from "./state.js";
import { loadProposals, renderProposals, loadRevealCapability } from "./proposals.js";
import { loadEvents, openEventStream, startPollers, stopPollers } from "./ticker.js";
import { openModal, closeModal, modalFocusables, handleViewDiff, handlePreviewMerge } from "./modal.js";
import { handleLandProposal, hideActionBanner } from "./land.js";
import { revealSecret } from "./reveal.js";
import { loadForks } from "./forks-panel.js";
import { loadIssues } from "./issues-panel.js";
import { loadSessions, submitSteer } from "./sessions-panel.js";
import { loadRail } from "./rail.js";
import { submitComment } from "./comments.js";

/**
 * Event delegation for proposals grid (view diff, preview merge, and landing)
 */
export function setupInteractions() {
 if (el.proposalsGrid) {
  el.proposalsGrid.addEventListener("click", (e) => {
   const diffBtn = e.target.closest(".btn-file-diff");
   if (diffBtn) {
    const repo = diffBtn.getAttribute("data-repo");
    const path = diffBtn.getAttribute("data-path");
    if (repo && path) handleViewDiff(repo, path);
    return;
   }

   const mergeBtn = e.target.closest(".btn-preview-merge");
   if (mergeBtn) {
    const repo = mergeBtn.getAttribute("data-repo");
    if (repo) handlePreviewMerge(repo);
    return;
   }

   const landBtn = e.target.closest("[data-action]");
   if (landBtn) {
    const action = landBtn.getAttribute("data-action");
    const repo = landBtn.getAttribute("data-repo");
    if (!repo) return;

    if (action === "start-land") {
     state.confirmingRepo = repo;
     renderProposals();
    } else if (action === "cancel-land") {
     state.confirmingRepo = null;
     renderProposals();
    } else if (action === "confirm-land") {
     handleLandProposal(repo);
    }
    return;
   }
  });
 }
 // Modal close handlers
 if (el.btnCloseModal) {
  el.btnCloseModal.addEventListener("click", closeModal);
 }
 if (el.inspectorModal) {
  el.inspectorModal.addEventListener("click", (e) => {
   // Elevated-reveal affordance: the control lives in the modal
   // body (#modal-body), not in the proposals grid, so the
   // delegation is attached here. The affordance is never a
   // capability — revealSecret re-runs POST /reveal, which
   // re-runs the server-side reveal rule on every click.
   const revealBtn = e.target.closest("[data-reveal-repo]");
   if (revealBtn) {
    const repo = revealBtn.getAttribute("data-reveal-repo");
    const path = revealBtn.getAttribute("data-reveal-path");
    const keys = revealBtn.getAttribute("data-reveal-keys") || "";
    if (repo && path) revealSecret(repo, path, keys);
    return;
   }
   // Comment composer: the submit control lives in the modal body
   // (the comment thread), so the delegation is attached here — the
   // same seam as the reveal affordance. One listener, bound to
   // #inspector-modal, survives every modal re-render.
   const commentBtn = e.target.closest("[data-comment-submit]");
   if (commentBtn) { submitComment(commentBtn); return; }
   if (e.target === el.inspectorModal) closeModal();
  });
 }
 window.addEventListener("keydown", (e) => {
  if (!el.inspectorModal || el.inspectorModal.hidden) return;
  if (e.key === "Escape") {
   closeModal();
   return;
  }
  if (e.key === "Tab") {
   const focusables = modalFocusables();
   if (focusables.length === 0) return;
   const first = focusables[0];
   const last = focusables[focusables.length - 1];
   const active = document.activeElement;
   const inside = active instanceof HTMLElement && el.inspectorModal.contains(active);
   if (e.shiftKey) {
    if (!inside || active === first) {
     e.preventDefault();
     last.focus();
    }
   } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
   }
  }
 });

 // Session steer composer: the send control lives inside the
 // rendered session rows (#sessions-section), so the delegation
 // is attached to the section — the proposals-grid delegation
 // precedent. One listener, bound to #sessions-section, survives
 // every session re-render.
 if (el.sessionsSection) {
  el.sessionsSection.addEventListener("click", (e) => {
   const steerSend = e.target.closest(".steer-send");
   if (steerSend) { submitSteer(steerSend); return; }
  });
 }

 // Connection banner retry
 // Manual refresh
 if (el.btnRefresh) {
  el.btnRefresh.addEventListener("click", () => {
   loadProposals();
   loadEvents();
   loadSessions();
   loadRail();
  });
 }

 // Connection banner retry
 if (el.btnRetry) {
  el.btnRetry.addEventListener("click", () => {
   loadProposals();
   loadEvents();
  });
 }

 // Auto-refresh toggle
 if (el.autoRefreshToggle) {
  el.autoRefreshToggle.addEventListener("change", (e) => {
   state.autoRefresh = Boolean(e.target.checked);
   setupTimers();
  });
 }

 // Action banner dismiss
 if (el.actionBannerClose) {
  el.actionBannerClose.addEventListener("click", hideActionBanner);
 }
}

/**
 * Polling timers setup — degraded-fallback manager.
 * While the SSE stream is healthy the pollers stay down;
 * otherwise (stream down / never opened) the pollers run:
 * - /events every 2s
 * - /proposals every 8s (when autoRefresh is enabled)
 */
export function setupTimers() {
 if (state.streamHealthy) {
  stopPollers();
  return;
 }
 stopPollers();
 startPollers();
}

/**
 * Initial boot
 */
export function init() {
 setupInteractions();
 openEventStream();
 // Degraded-fallback pollers run from boot. The stream is the
 // primary transport, but a stream that cannot establish (404 /
 // DO-hibernate / network blip) must not leave the UI unpolled:
 // a 404 EventSource sits in CONNECTING without firing "error"
 // for an extended period, so waiting for markStreamDown() to
 // arm the pollers starves /proposals. markStreamHealthy() stops
 // them the moment the stream opens, so a healthy stream polls
 // zero times.
 startPollers();
 loadRevealCapability();
 // The rail derives from /proposals, /events and /agents, so it
 // renders on the refresh cycle and again once every source has
 // settled — `agentRoster` lands LAST (forks-panel's second
 // fetch, after /checks), so the settle re-render is what makes
 // the first paint carry the roster's policy chips.
 const railSources = [loadProposals(), loadEvents(), loadForks()];
 loadIssues();
 loadSessions();
 loadRail();
 Promise.allSettled(railSources).then(loadRail);
}
