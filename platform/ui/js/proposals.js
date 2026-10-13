// nextgit — proposals + header/judge render domain (wave-13
// module split from app.js). Owns the proposals fetch, the set
// view render passes, the header/chips render, the connection
// state render, and the advisory judge layer.
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";
import { getConflictSeverity, renderConflicts } from "./conflicts.js";
import { renderLandVerdict } from "../land-verdict.js";
import { checksStripHtml } from "./checks.js";

/**
 * Fetch and render proposals + conflicts
 */
export async function loadProposals() {
 try {
  const data = await fetchJson("/proposals");
  state.proposalsData = data;
  state.connectionError = false;
  state.lastError = null;
  state.lastSyncTime = new Date();
  renderProposalsView();
  maybeJudge(); // advisory layer — unawaited, never blocks the render
 } catch (err) {
  state.connectionError = true;
  state.lastError = err.message || "Failed to fetch /proposals";
  renderConnectionState();
 }
}

/**
 * Elevated-reveal capability probe — run once at boot. Reads the
 * viewer's OWN reveal capability from GET /whoami (the same decision
 * POST /reveal makes). Fail-open to the DEFAULT posture (reveal:false)
 * on any error — an unreachable /whoami must never surface an affordance.
 */
export async function loadRevealCapability() {
 try {
  const data = await fetchJson("/whoami");
  state.revealCapability = { authorized: Boolean(data?.authorized), reveal: Boolean(data?.reveal) };
 } catch { state.revealCapability = { authorized: false, reveal: false }; }
}

/**
 * Advisory judge layer (setId v1): at most one /judge call per payload change
 * AND per JUDGE_MIN_INTERVAL_MS. Failures are silent — a judge outage must
 * never color the connection state or block landing.
 */
const JUDGE_MIN_INTERVAL_MS = 30000;

function judgeSignatureOf(data) {
 return JSON.stringify({ base: data?.base, ref: data?.ref, proposals: data?.proposals });
}

async function maybeJudge() {
 const data = state.proposalsData;
 if (!data || state.judgeInFlight) return;
 const signature = judgeSignatureOf(data);
 if (signature === state.judgeSignature) return;
 const now = Date.now();
 if (now - state.judgeLastAttempt < JUDGE_MIN_INTERVAL_MS) return;

 const repos = (data.proposals || []).map((p) => p.repo).slice(0, 16);
 if (!repos.length) {
  state.judgeData = {};
  state.judgeSignature = signature;
  renderProposals();
  return;
 }

 state.judgeInFlight = true;
 state.judgeLastAttempt = now;
 try {
  const result = await fetchJson("/judge", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({
    setId: "v1",
    target: { base: data.base?.repo || "demo", repos, refs: [data.ref || "main"] },
   }),
  });
  state.judgeData = Object.fromEntries((result.judgments || []).map((j) => [j.repo, j]));
  state.judgeSignature = signature;
  renderProposals();
 } catch {
  // Silent by design: chips are advisory; the signature stays untouched so a
  // later refresh retries.
 } finally {
  state.judgeInFlight = false;
 }
}

/**
 * Render Header & Summary Chips
 */
export function renderHeader() {
 const data = state.proposalsData;
 if (!data) return;

 const baseRepo = data.base?.repo || "demo";
 const ref = data.ref || data.base?.ref || "main";
 if (el.baseVal) el.baseVal.textContent = baseRepo;
 if (el.refVal) el.refVal.textContent = ref;

 const summary = data.summary || {};
 const proposalsCount = summary.proposals != null ? summary.proposals : (data.proposals?.length || 0);
 const sharedCount = summary.sharedFiles || 0;
 const conflictPairsCount = summary.conflictingPairs || 0;
 const changedCount = summary.changedFiles || 0;
 const cleanPairsCount = summary.cleanPairs || 0;

 if (el.valProposals) el.valProposals.textContent = proposalsCount;
 if (el.valShared) el.valShared.textContent = sharedCount;
 if (el.valConflicts) el.valConflicts.textContent = conflictPairsCount;
 if (el.valChanged) el.valChanged.textContent = changedCount;
 if (el.valClean) el.valClean.textContent = cleanPairsCount;

 if (el.chipConflicts) {
  if (conflictPairsCount > 0) {
   el.chipConflicts.classList.add("is-alert");
  } else {
   el.chipConflicts.classList.remove("is-alert");
  }
 }

 if (el.chipShared) {
  if (sharedCount > 0) {
   el.chipShared.classList.add("is-warn");
  } else {
   el.chipShared.classList.remove("is-warn");
  }
 }

 if (el.chipClean) {
  if (cleanPairsCount > 0) {
   el.chipClean.classList.add("is-clean");
  } else {
   el.chipClean.classList.remove("is-clean");
  }
 }
 if (el.lastSyncTime && state.lastSyncTime) {
  el.lastSyncTime.textContent = `synced ${formatTime(state.lastSyncTime)}`;
 }
}

/**
 * Advisory judge chips for one proposal card (setId v1 vocabulary).
 * Renders nothing when there is no judgment (never judged / skipped) or when
 * the card is landed — a landed card never wears stale chips.
 */
export function judgeChipsHtml(repo, isLanded) {
 const judgment = state.judgeData ? state.judgeData[repo] : null;
 if (!judgment || isLanded) return "";

 const chips = [];
 const risk = judgment.risk || {};
 if (risk.label) {
  const riskClass =
   risk.label === "routine" ? "badge-clean" : risk.label === "senior-security" ? "badge-red" : "badge-amber";
  chips.push(
   `<span class="badge ${riskClass}" title="risk score ${escapeHtml(risk.score)}"><span class="chip-label">risk:</span> ${escapeHtml(risk.label)}</span>`,
  );
 }

 const intent = judgment.intent || {};
 if (intent.verdict) {
  const intentClass =
   intent.verdict === "supports" ? "badge-clean" : intent.verdict === "contradicts" ? "badge-red" : "badge-neutral";
  const intentLabel =
   intent.verdict === "supports" ? "intent verified" : intent.verdict === "contradicts" ? "intent mismatch" : "insufficient";
  chips.push(`<span class="badge ${intentClass}">${intentLabel}</span>`);
  if (intent.overclaim != null) {
   chips.push(
    `<span class="judge-overclaim" title="overclaim probability">overclaim ${escapeHtml(intent.overclaim)}</span>`,
   );
  }
 }

 if (judgment.collision === true) {
  chips.push(
   `<span class="badge badge-amber" title="semantic collision — same behavior as another proposal (distinct from the diff3 conflict map)">soft collision</span>`,
  );
 }

 return chips.join("");
}

/**
 * Auto-land verdict badge (AD-11): the ESCALATE advisory
 * chip next to Land on the proposal card. Pure render of
 * the last recorded verdict for this repo — the verdict is
 * decided server-side; this only renders it (never a
 * decision, never a bypass affordance). Absent verdict →
 * no chip ("a skip is not a verdict").
 */
export function landVerdictBadgeHtml(repo) {
 const verdict = state.landVerdictByRepo[repo];
 if (!verdict) return "";
 const render = renderLandVerdict(verdict);
 if (!render || render.kind !== "escalate" || !render.badgeText) return "";
 return `<span class="badge ${escapeHtml(render.badgeClass)}" title="auto-land verdict: escalate">${escapeHtml(render.badgeText)}</span>`;
}

/**
 * Land confirm sheet (AD-11 decision point): while the card sits in its
 * inline `confirm land?` state, state what the land will do and what the
 * judge last said for this repo. Render-only: the verdict is read from
 * state.landVerdictByRepo — written ONLY by a server /land response
 * (js/land.js:108 200 evidence.autoLand, :165 409 autoland-escalate) —
 * and mapped through renderLandVerdict. Nothing here fetches, stores,
 * or decides, and the sheet NEVER gates the action: `confirm land?`
 * stays enabled under every posture (the two-step confirm state itself
 * is the fallback when no verdict was carried — a skip is not a
 * verdict).
 *
 * Both arguments arrive HTML-escaped by the caller: the card `repo` is
 * the escaped local from renderProposals, and the base repo is escaped
 * at the call site (mirrors js/land.js's banner sinks). The judge-owned
 * parts (chip label + notice copy, including every blocking code) are
 * escaped inside land-verdict.js; the what-line interpolates only
 * already-escaped values.
 */
export function landConfirmSheetHtml(repo, baseRepo) {
 const render = renderLandVerdict(state.landVerdictByRepo[repo] || {});
 const what = `Landing folds ${repo} into ${baseRepo} server-side (no clone) and pushes the result to the base branch.`;

 // Render table over renderLandVerdict's five postures: chip + copy.
 // `act` and `none` carry no judge notice of their own, so the sheet
 // states the posture in code-owned copy; blocked/confirm/escalate
 // render the notice verbatim (one entry per confirming card).
 let chipClass = "badge-neutral";
 let chipText = "recorded-evidence";
 let copy = "No auto-land verdict recorded for this proposal — recorded-evidence mode: your confirmation is the whole decision.";
 if (render.kind === "blocked") {
  chipClass = render.badgeClass; // badge-red
  chipText = render.badgeText;   // "blocked"
  copy = render.noticeHtml;      // the fail-closed 503 copy
 } else if (render.kind === "escalate") {
  chipClass = render.badgeClass;
  chipText = render.badgeText;
  copy = render.noticeHtml;
 } else if (render.kind === "confirm") {
  chipClass = render.badgeClass;
  chipText = render.badgeText;
  copy = render.noticeHtml;
 } else if (render.kind === "act") {
  chipClass = render.badgeClass; // badge-clean
  chipText = "act";
  copy = "Auto-land verdict: ACT — the gate cleared the previous land of this proposal; confirming folds and pushes it server-side.";
 }

 return `<div class="land-confirm-sheet" role="note" aria-live="polite"><div class="land-confirm-what">${what}</div><div class="land-confirm-verdict"><span class="badge ${escapeHtml(chipClass)}">${escapeHtml(chipText)}</span> <span class="action-hint">${copy}</span></div></div>`;
}

/**
 * Render Proposals Grid
 */
export function renderProposals() {
 if (!el.proposalsGrid || !el.proposalsMeta) return;

 const data = state.proposalsData;
 if (!data) {
  // First-load treatment (FR-7): same contract as renderConflicts — the
  // treatment stands until the first observed payload.
  el.proposalsMeta.textContent = "—";
  el.proposalsGrid.innerHTML = '<div class="loading-indicator">Loading the set from /proposals...</div>';
  return;
 }

 const proposals = data?.proposals || [];
 el.proposalsMeta.textContent = `${proposals.length} active`;

 if (proposals.length === 0) {
  el.proposalsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-title">No active proposals</div>
        <div class="empty-state-desc">Waiting for agent branches to propose changes against base.</div>
      </div>
    `;
  return;
 }

 const html = proposals
  .map((p) => {
   const repo = escapeHtml(p.repo);
   const intent = p.intent ? escapeHtml(p.intent) : null;
   const stats = p.stats || { additions: 0, deletions: 0, files: 0 };
   const files = Array.isArray(p.files) ? p.files : [];
   const landing = p.landing || null;
   const landingStatus = landing ? landing.status : "ready";
   const isLanded = landing ? landingStatus === "landed" : stats.files === 0;
   const isWithheldSecret = landing?.status === "withheld-secret";
   const isConflict = landing?.status === "conflict";
   const isLanding = state.landingRepo === p.repo;
   const isConfirming = state.confirmingRepo === p.repo;

   const filesHtml = files
    .map((f) => {
     const path = escapeHtml(f.path);
     const status = escapeHtml(f.status || "modified");
     const statusClass = `status-${status.toLowerCase()}`;
     const isSecret = Boolean(f.secret);
     // R2 asset pointer (AD-10): pointer rows carry no
     // patch to view — same condition as isSecret/binary.
     const isAsset = Boolean(f.asset);
     const keys = Array.isArray(f.keys) ? f.keys : [];
     const additions = f.additions != null ? `+${f.additions}` : "";
     const deletions = f.deletions != null ? `-${f.deletions}` : "";

     return `
            <div class="file-row">
              <div class="file-path-col">
                <span class="file-status-indicator ${statusClass}">${status}</span>
                <span class="file-path" title="${path}">${path}</span>
                ${isSecret
       ? `<span class="badge badge-secret">secret-typed</span>`
       : ""
      }
              </div>
              <div class="file-actions-col">
                ${isSecret && keys.length
       ? `<div class="secret-keys-list">
                        ${keys.map((k) => `<span class="secret-key-tag">${escapeHtml(k)}</span>`).join("")}
                       </div>`
       : ""
      }
                <div class="file-counts">
                  ${additions ? `<span class="adds">${additions}</span>` : ""}
                  ${deletions ? `<span class="dels">${deletions}</span>` : ""}
                </div>
                ${!isSecret && !isAsset
       ? `<button class="btn-file-diff" type="button" data-repo="${repo}" data-path="${path}">view diff</button>`
       : ""
      }
              </div>
            </div>
          `;
    })
    .join("");

   let actionButtonsHtml = "";
   if (isLanded) {
    actionButtonsHtml = `
          <span class="badge badge-neutral">landed</span>
        `;
   } else if (isLanding) {
    actionButtonsHtml = `
          <button class="btn-card-action btn-land" type="button" disabled>landing...</button>
        `;
   } else if (isConfirming) {
    actionButtonsHtml = `
          <button class="btn-card-action btn-land is-confirming" type="button" data-action="confirm-land" data-repo="${repo}">confirm land?</button>
          <button class="btn-card-action btn-cancel-land" type="button" data-action="cancel-land" data-repo="${repo}">cancel</button>
        `;
   } else if (isWithheldSecret) {
    actionButtonsHtml = `
          <span class="badge badge-amber">blocked</span>
          <button class="btn-card-action btn-preview-merge" type="button" data-repo="${repo}">preview merge</button>
          <button class="btn-card-action btn-land" type="button" disabled>withheld-secret file — landing blocked</button>
        `;
   } else if (isConflict) {
    actionButtonsHtml = `
          <button class="btn-card-action btn-preview-merge" type="button" data-repo="${repo}">preview merge</button>
          <button class="btn-card-action btn-land" type="button" disabled>(preview merge first)</button>
        `;
   } else {
    actionButtonsHtml = `
          <button class="btn-card-action btn-preview-merge" type="button" data-repo="${repo}">preview merge</button>
          <button class="btn-card-action btn-land" type="button" data-action="start-land" data-repo="${repo}">Land into demo</button>
        `;
   }

   const cardClasses = ["proposal-card", isLanded ? "is-landed" : "", isWithheldSecret ? "is-withheld-secret" : "", isConflict ? "is-conflict" : ""].filter(Boolean).join(" ");

   return `
        <div class="${cardClasses}" id="card-${repo}">
          <div class="proposal-card-header">
            <span class="proposal-repo-title">${repo}</span>
            <div class="proposal-badges">${judgeChipsHtml(p.repo, isLanded)}${landVerdictBadgeHtml(p.repo)}</div>
            <div class="proposal-actions">
              ${actionButtonsHtml}
            </div>
          </div>

          ${checksStripHtml(p, { base: data.base, conflicts: data.conflicts })}
          ${isConfirming ? landConfirmSheetHtml(repo, escapeHtml(data?.base?.repo || "demo")) : ""}
          ${intent
     ? `<div class="proposal-intent"><span class="intent-label">intent:</span>${intent}</div>`
     : ""
    }

          ${isLanded
     ? `<div class="landed-banner">
                   <span class="landed-status">landed — nothing pending</span>
                   <span>${landing?.files ?? 0} files · All changes from this branch have been merged into baseline.</span>
                 </div>`
     : `
                <div class="proposal-stats">
                  <span class="stat-item"><span class="stat-num">${stats.files ?? files.length}</span> files</span>
                  <span class="stat-item additions"><span class="stat-num">+${stats.additions ?? 0}</span></span>
                  <span class="stat-item deletions"><span class="stat-num">-${stats.deletions ?? 0}</span></span>
                </div>

                <div class="proposal-files-list">
                  ${filesHtml || '<div class="diff-placeholder">No modified files.</div>'}
                </div>
              `
    }
        </div>
      `;
  })
  .join("");

 el.proposalsGrid.innerHTML = html;
}

/**
 * Full proposals render pass
 */
export function renderProposalsView() {
 renderConnectionState();
 renderHeader();
 renderConflicts();
 renderProposals();
}

/**
 * Render connection error state
 */
export function renderConnectionState() {
 if (!el.connectionBanner) return;

 if (state.connectionError) {
  el.connectionBanner.hidden = false;
  if (el.connectionMsg) {
   el.connectionMsg.textContent = state.lastError
    ? `Connection error: ${state.lastError}. Retrying...`
    : "Disconnected from platform worker. Retrying...";
  }
  if (el.btnRefresh) el.btnRefresh.disabled = false;
 } else {
  el.connectionBanner.hidden = true;
 }
}
