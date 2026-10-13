// nextgit — judge-set comparison domain (nextgit-e16, wave-16 lane-4).
// Owns the triage comparison section + the strongest-candidate
// badge. RENDER-ONLY: reads the LIVE /judge artifacts the
// platform already records in `state.judgeData`; never fetches,
// never re-derives, never decides. FAIL-SOFT: a judge outage
// never touches connection state.
import { state, el } from "./state.js";
import { escapeHtml } from "./api.js";

/**
 * CONTRACT.md §POST /judge card-signal vocabulary: the ordered
 * 3-level risk rubric (routine < focused < senior-security).
 * The comparison order is a code-owned presentation heuristic —
 * NOT a model verdict and NOT a decision (AD-11: "The judge
 * advises; code decides; humans still own irreversible acts").
 */
export const RISK_RANK = { routine: 0, focused: 1, "senior-security": 2 };

/**
 * Pure helper: the judge's risk score for one judgment —
 * `Number(judgment.risk.score)` clamped to the rubric range
 * [0,2] when finite. Typed-null posture: a malformed or absent
 * score is `null` (renders `unmeasured`), never a fabricated 0.
 */
export function riskScoreOf(judgment) {
 const raw = Number(judgment?.risk?.score);
 if (!Number.isFinite(raw)) return null;
 return Math.min(2, Math.max(0, raw));
}

/**
 * Pure set-comparison over `state.judgeData`'s values
 * ({repo, risk, intent, collision}). Returns one
 * { repo, riskScore, riskLabel, intentVerdict, intentOverclaim,
 *   collision } entry per repo in a stable, documented order:
 *   (a) intent tier — `supports` first, `insufficient` middle,
 *       `contradicts` last;
 *   (b) within a tier, ascending riskScore (nulls last);
 *   (c) ties broken by repo name (localeCompare).
 * Deterministic from deterministic input — no model call.
 *
 * The UI RENDERS this order; it never decides it (the
 * land-verdict.js posture). The order is a presentation
 * heuristic over server-typed signals, not a verdict.
 */
export function compareJudgments(judgments) {
 const entries = Object.values(judgments || {});
 const INTENT_TIER = { supports: 0, insufficient: 1, contradicts: 2 };
 return entries
  .map((j) => {
   const risk = j?.risk || {};
   const intent = j?.intent || {};
   return {
    repo: String(j?.repo ?? ""),
    riskScore: riskScoreOf(j),
    riskLabel: String(risk.label ?? ""),
    intentVerdict: String(intent.verdict ?? ""),
    intentOverclaim: intent.overclaim ?? null,
    collision: j?.collision === true,
   };
  })
  .sort((a, b) => {
   const tierA = Object.prototype.hasOwnProperty.call(INTENT_TIER, a.intentVerdict) ? INTENT_TIER[a.intentVerdict] : 1;
   const tierB = Object.prototype.hasOwnProperty.call(INTENT_TIER, b.intentVerdict) ? INTENT_TIER[b.intentVerdict] : 1;
   if (tierA !== tierB) return tierA - tierB;
   if (a.riskScore !== b.riskScore) {
    if (a.riskScore === null) return 1;
    if (b.riskScore === null) return -1;
    return a.riskScore - b.riskScore;
   }
   return a.repo.localeCompare(b.repo);
  });
}

/**
 * Pure: the strongest candidate — the first entry of
 * `compareJudgments`' order, or `null` for an empty set.
 * The badge is render-only (order acceptance): no button, no
 * click target, no land affordance.
 */
export function strongestCandidate(comparison) {
 if (!Array.isArray(comparison) || comparison.length === 0) return null;
 return comparison[0];
}

/**
 * Pure helper: one comparison row — the escaped repo title,
 * the risk badge (the SAME badge-class mapping as
 * `judgeChipsHtml`, so strip + chips read as one system),
 * the typed-null risk score, the intent badge (the same
 * vocabulary as the chips), and the soft-collision chip.
 * Judgment payloads are model output — untrusted (AD-4):
 * every interpolated string passes through escapeHtml.
 */
export function comparisonRowHtml(entry) {
 const riskClass =
  entry.riskLabel === "routine" ? "badge-clean" : entry.riskLabel === "senior-security" ? "badge-red" : "badge-amber";
 const intentClass =
  entry.intentVerdict === "supports" ? "badge-clean" : entry.intentVerdict === "contradicts" ? "badge-red" : "badge-neutral";
 const intentLabel =
  entry.intentVerdict === "supports" ? "intent verified" : entry.intentVerdict === "contradicts" ? "intent mismatch" : "insufficient";
 const score = entry.riskScore === null ? "unmeasured" : escapeHtml(entry.riskScore);
 const collisionChip = entry.collision
  ? `<span class="badge badge-amber" title="semantic collision — same behavior as another proposal (distinct from the diff3 conflict map)">soft collision</span>`
  : "";
 return `
      <div class="judge-comparison-row">
        <span class="judge-comparison-repo">${escapeHtml(entry.repo)}</span>
        <span class="judge-comparison-badges">
          <span class="badge ${riskClass}">risk: ${escapeHtml(entry.riskLabel)}</span>
          <span class="judge-comparison-score">${score}</span>
          <span class="badge ${intentClass}">${escapeHtml(intentLabel)}</span>
          ${collisionChip}
        </span>
      </div>
    `;
}

/**
 * CONTRACT.md §POST /judge skip-reason whitelist → concise
 * labels. Closed vocabulary: an unknown reason renders the raw
 * escaped token — never a fabricated label, never a dropped row.
 * Skip rows render BY NAME ONLY — no paths, keys, or content
 * (the masking law, verbatim).
 */
export const SKIP_LABELS = {
 "secret-class": "secret-typed — not judged",
 "empty-change-set": "empty change-set — not judged",
 "content-detected-secret": "content-detected secret — not judged",
};

/**
 * Pure helper: one muted skip row — `{repo, reason}` with the
 * whitelisted reason label (or the raw escaped token for an
 * unlisted reason).
 */
export function skipRowHtml(skip) {
 const repo = String(skip?.repo ?? "");
 const reason = String(skip?.reason ?? "");
 const label = Object.prototype.hasOwnProperty.call(SKIP_LABELS, reason) ? SKIP_LABELS[reason] : reason;
 return `<div class="judge-comparison-skip">${escapeHtml(repo)} — ${escapeHtml(label)}</div>`;
}

/**
 * Render the judge-set comparison section. First-load posture
 * (the renderIssues/renderForks FR-7 treatment): with no
 * payload and no observed failure the loader stands; an
 * observed failure renders the quiet unavailable line (fail-soft
 * — never the connection banner); a payload renders the count
 * meta, the comparison rows in `compareJudgments` order, the
 * skip rows, and the recommendation strip (strongest-candidate
 * badge + advisory disclaimer). An empty set renders the honest
 * empty state and NO recommendation badge — a skip is not a
 * verdict (CONTRACT.md §POST /judge).
 */
export function renderJudgeComparison() {
 if (!el.judgeComparisonList || !el.judgeComparisonMeta) return;

 const data = state.judgeData;
 if (!data) {
  el.judgeComparisonMeta.textContent = "—";
  if (el.judgeComparisonBadge) el.judgeComparisonBadge.innerHTML = "";
  el.judgeComparisonList.innerHTML = state.judgeComparisonError
   ? '<div class="judge-comparison-unavailable">Judge comparison unavailable.</div>'
   : '<div class="judge-comparison-loading">Loading judge-set comparison…</div>';
  return;
 }

 const judgments = {};
 for (const [repo, judgment] of Object.entries(data)) {
  if (judgment && typeof judgment === "object") {
   judgments[repo] = judgment;
  }
 }
 const skipped = Array.isArray(state.judgeSkipped) ? state.judgeSkipped : [];
 const comparison = compareJudgments(judgments);
 const strongest = strongestCandidate(comparison);

 el.judgeComparisonMeta.textContent = `${comparison.length} proposals compared · ${skipped.length} not judged`;

 const skipRows = skipped.map((skip) => skipRowHtml(skip)).join("");

 if (comparison.length === 0) {
  if (el.judgeComparisonBadge) el.judgeComparisonBadge.innerHTML = "";
  el.judgeComparisonList.innerHTML = `
        <div class="judge-comparison-empty">No judged proposals in this set</div>
        ${skipRows}
      `;
  return;
 }

 const recommendation = strongest
  ? `<span class="judge-comparison-badge">strongest candidate: <span class="judge-comparison-repo">${escapeHtml(strongest.repo)}</span></span>`
  : "";
 if (el.judgeComparisonBadge) {
  el.judgeComparisonBadge.innerHTML = `
        ${recommendation}
        <span class="judge-comparison-disclaimer">advisory only — the judge advises; code decides; humans own irreversible acts</span>
      `;
 }

 el.judgeComparisonList.innerHTML = `
        ${comparison.map((entry) => comparisonRowHtml(entry)).join("")}
        ${skipRows}
      `;
}

/**
 * The re-render hook `maybeJudge`'s success/empty/failure
 * paths call. Pure render of current `state` — no fetch, no
 * derivation, no decision.
 */
export function refreshJudgeComparison() {
 renderJudgeComparison();
}
