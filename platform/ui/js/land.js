// nextgit — land + action-banner domain (wave-13
// module split from app.js). Owns the FR-16 fail-closed
// land flow and the action banner manager.
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";
import { renderLandVerdict, landVerdictFromLandResponse, landVerdictFromErrorEnvelope } from "../land-verdict.js";
import { renderProposals, loadProposals } from "./proposals.js";
import { loadEvents } from "./ticker.js";

/**
 * Action banner manager
 */
export function showActionBanner(type, badgeText, messageHtml) {
 if (!el.actionBanner || !el.actionBannerMsg) return;
 el.actionBanner.className = `action-banner banner-${type}`;
 el.actionBanner.hidden = false;
 if (el.actionBannerBadge) {
  if (badgeText) {
   let badgeClass = "badge-neutral";
   if (type === "success") badgeClass = "badge-clean";
   else if (type === "error") badgeClass = "badge-red";
   else if (type === "warn") badgeClass = "badge-amber";
   el.actionBannerBadge.className = `badge ${badgeClass}`;
   el.actionBannerBadge.textContent = badgeText;
   el.actionBannerBadge.hidden = false;
  } else {
   el.actionBannerBadge.hidden = true;
  }
 }
 el.actionBannerMsg.innerHTML = messageHtml;
}

export function hideActionBanner() {
 if (!el.actionBanner) return;
 el.actionBanner.hidden = true;
 if (el.actionBannerMsg) el.actionBannerMsg.innerHTML = "";
}

/**
 * Action: Land proposal into baseline
 */
export async function handleLandProposal(repo) {
 const data = state.proposalsData;
 const baseRepo = data?.base?.repo || "demo";
 const baseHead = typeof data?.base?.head === "string" ? data.base.head : "";
 const row = (data?.proposals || []).find((p) => p.repo === repo) || null;
 const rowHead = typeof row?.head === "string" ? row.head : "";

 // FR-16 fail-closed guard: a land may only leave the canvas bound to the
 // revision the reviewer saw — both anchors present. Without them, refuse
 // (never fall back to an unbound land) and refresh the set so the anchors
 // can appear before the reviewer retries.
 if (!baseHead || !rowHead) {
  state.landingRepo = null;
  state.confirmingRepo = null;
  renderProposals();
  showActionBanner(
   "error",
   "failed",
   `Failed to land <strong>${escapeHtml(repo)}</strong>: reviewed heads unavailable — refresh and re-review.`
  );
  await loadProposals();
  return;
 }

 state.landingRepo = repo;
 state.confirmingRepo = null;
 renderProposals();

 showActionBanner(
  "warn",
  "landing",
  `Landing proposal <strong>${escapeHtml(repo)}</strong> into <strong>${escapeHtml(baseRepo)}</strong>...`
 );

 try {
  const payload = {
   base: baseRepo,
   repos: [repo],
   baseRef: data?.base?.ref || "main",
   ref: data?.ref || "main",
   reviewed: { baseHead, heads: { [repo]: rowHead } },
  };

  const res = await fetchJson("/land", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(payload),
   timeoutMs: 45000, // server-side fold + push takes ~10s live; cold can be slower
  });

  const commitSha = res.landed?.commit || res.commit || "";
  const shortSha = commitSha ? commitSha.slice(0, 8) : "";
  const shaHtml = commitSha ? `<code class="commit-sha" title="${escapeHtml(commitSha)}">${escapeHtml(shortSha)}</code>` : "";

  const landedFiles = Array.isArray(res.landed?.files) ? res.landed.files.length : 0;
  const landedAt = typeof res.landed?.at === "string" && res.landed.at ? formatTime(res.landed.at) : "";
  const receiptExtra = `${landedFiles ? ` · ${landedFiles} files` : ""}${landedAt ? ` · ${landedAt}` : ""}`;

  // Auto-land verdict (AD-11): ACT/CONFIRM ride the 200
  // evidence record (evidence.autoLand). The verdict is
  // RENDERED here, never decided: it is recorded so the
  // card re-render carries the advisory, and a CONFIRM
  // adds the amber advisory to the receipt.
  const autoLand = landVerdictFromLandResponse(res);
  const verdictRender = autoLand ? renderLandVerdict(autoLand) : null;
  if (autoLand) {
   state.landVerdictByRepo[repo] = autoLand;
  }
  const receiptAdvisory =
   verdictRender && verdictRender.kind === "confirm"
    ? ` <span class="badge badge-amber">${escapeHtml(verdictRender.badgeText)}</span> <span class="action-hint">${verdictRender.noticeHtml}</span>`
    : "";

  showActionBanner(
   "success",
   "landed",
   `Successfully landed proposal <strong>${escapeHtml(repo)}</strong> into <strong>${escapeHtml(baseRepo)}</strong>. Commit ${shaHtml}${receiptExtra}${receiptAdvisory}`
  );

  // Auto-refresh proposals immediately
  await loadProposals();
  await loadEvents();
 } catch (err) {
  const resp = err.response || {};
  const errorCode = resp.error || "";

  if (err.status === 409 && errorCode === "withheld-secret") {
   const files = Array.isArray(resp.files) ? resp.files : [];
   const filesStr = files.map((f) => escapeHtml(f)).join(", ") || "secret files";
   showActionBanner(
    "error",
    "blocked",
    `Withheld-secret file — landing blocked (${filesStr}).`
   );
  } else if (err.status === 409 && errorCode === "conflict") {
   const conflicted = Array.isArray(resp.conflicted)
    ? resp.conflicted.map((f) => (typeof f === "string" ? f : f.file || f.path || JSON.stringify(f)))
    : [];
   const conflictList = conflicted.length ? conflicted.map(escapeHtml).join(", ") : "conflicts detected";
   showActionBanner(
    "error",
    "conflict",
    `Conflicted files: <strong>${conflictList}</strong>. <span class="action-hint">(preview merge first)</span>`
   );
  } else if (err.status === 409 && errorCode === "no-changes") {
   showActionBanner("error", "no-changes", "Nothing to land — fold produced zero changes.");
  } else if (err.status === 409 && errorCode === "stale") {
   showActionBanner("error", "stale", "This proposal is stale — rebase and re-push to land.");
   // The set the reviewer saw no longer describes the repo: refresh it so the
   // next confirm carries exactly the anchors the refreshed canvas renders.
   state.landingRepo = null;
   await loadProposals();
  } else if (err.status === 409 && errorCode === "base-moved") {
   showActionBanner("error", "base-moved", "Nothing to land — the baseline moved since this proposal was made.");
  } else if (err.status === 409 && errorCode === "autoland-escalate") {
   // Auto-land gate (AD-11): the judge ESCALATED — a red
   // advisory banner carrying the code-owned blocking
   // reason codes. No auto-fire, no bypass: the button
   // stays a human act. The verdict is recorded so the
   // card re-render (finally) carries the red advisory
   // chip next to Land.
   const verdict = landVerdictFromErrorEnvelope(resp) || { verdict: "escalate", setId: resp.setId, blocking: Array.isArray(resp.blocking) ? resp.blocking : [] };
   const render = renderLandVerdict(verdict);
   state.landVerdictByRepo[repo] = verdict;
   showActionBanner("error", render.badgeText || "escalate", render.noticeHtml || "Auto-land verdict: ESCALATE — landing held for human review.");
  } else if (err.status === 503 && errorCode === "judge-unavailable") {
   // Fail-closed gate: the judge could not answer, so the
   // land was blocked server-side. Render the blocked
   // fact with the server's reason — no bypass exists.
   const verdict = landVerdictFromErrorEnvelope(resp) || { error: "judge-unavailable" };
   // Record the gate's server-carried fail-closed answer so the
   // next armed state renders the fail-closed copy (the confirm
   // sheet). Not a decision: symmetric with the 409 autoland-escalate
   // recording above; a later act/confirm overwrites it.
   state.landVerdictByRepo[repo] = verdict;
   const render = renderLandVerdict(verdict);
   showActionBanner("error", render.badgeText || "blocked", render.noticeHtml || "Auto-land gate unavailable — landing blocked (judge-unavailable).");
  } else {
   const msg = err.message || resp.error || "Unexpected landing failure";
   showActionBanner(
    "error",
    "failed",
    `Failed to land <strong>${escapeHtml(repo)}</strong>: ${escapeHtml(msg)}`
   );
  }
 } finally {
  state.landingRepo = null;
  renderProposals();
 }
}
