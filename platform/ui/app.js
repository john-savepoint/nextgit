// nextgit — convergence triage UI (vanilla ES module)
// Adheres strictly to platform/CONTRACT.md
//
// Wave-13 module split: the domain code lives in ./js/* (state,
// api, conflicts, ticker, proposals, modal, land, reveal,
// interactions). This entry wires the module graph and runs the
// DOM-ready bootstrap — nothing else. `state`/`el` are the two
// shared singletons every module closes over; they cross module
// boundaries only via ESM imports (no window.* globals).
import { state, el } from "./js/state.js";
import { fetchJson, escapeHtml, formatTime, renderPatchLines } from "./js/api.js";
import { getConflictSeverity, renderConflicts } from "./js/conflicts.js";
import { loadEvents, renderEventsTicker, handleStreamFrame, noteEvent, openEventStream, startPollers, stopPollers, markStreamHealthy, markStreamDown } from "./js/ticker.js";
import { loadProposals, renderProposals, renderProposalsView, renderHeader, renderConnectionState, judgeChipsHtml, landVerdictBadgeHtml, loadRevealCapability } from "./js/proposals.js";
import { modalFocusables, openModal, closeModal, handleViewDiff, handlePreviewMerge } from "./js/modal.js";
import { handleLandProposal, showActionBanner, hideActionBanner } from "./js/land.js";
import { revealSecret } from "./js/reveal.js";
import { setupInteractions, setupTimers, init } from "./js/interactions.js";

// Run when DOM is ready
if (document.readyState === "loading") {
 document.addEventListener("DOMContentLoaded", init);
} else {
 init();
}
