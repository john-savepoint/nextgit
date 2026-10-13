// nextgit — forks domain (wave-14). Owns the six-cluster fork-signals
// triage section: the /forks read and the signal-chip render. Imports
// the shared state/el singletons and the API client only. FAIL-SOFT:
// this secondary panel never touches connection state — a failed
// /forks fetch must not raise the connection banner.
import { state, el } from "./state.js";
import { fetchJson, escapeHtml } from "./api.js";

/** CONTRACT.md §GET /forks six-cluster keys → concise chip labels. */
export const SIGNAL_LABELS = {
 fitOverlap: "fit",
 peopleTrust: "trust",
 liveness: "liveness",
 proof: "proof",
 distance: "distance",
 costToAdoptVsRegenerate: "cost",
};

/**
 * Pure helper: format one cluster value. Typed-null law — an
 * unmeasured cluster is the literal word "unmeasured", never a
 * fabricated 0; a non-finite value degrades to an em-dash.
 */
export function signalValue(v) {
 if (v === null || v === undefined) return "unmeasured";
 return Number.isFinite(v) ? v.toFixed(2) : "\u2014";
}

/**
 * Pure helper: the six signal chips for one fork — one per CONTRACT
 * key, every value escaped (repo content is untrusted — AD-4).
 */
export function signalChipsHtml(signals) {
 const s = signals || {};
 return Object.keys(SIGNAL_LABELS)
  .map((key) => {
   const label = escapeHtml(SIGNAL_LABELS[key]);
   const value = escapeHtml(signalValue(s[key]));
   return `<span class="fork-signal-chip" data-signal="${key}"><span class="fork-signal-label">${label}</span><span class="fork-signal-value">${value}</span></span>`;
  })
  .join("");
}

/** CONTRACT.md §GET /agents policy keys → concise chip labels. */
export const POLICY_LABELS = {
 land: "land",
 secretClass: "secrets",
};

/**
 * Pure helper: the policy chips for one roster agent — one
 * per CONTRACT policy key, every value escaped (repo content
 * is untrusted — AD-4). Typed-null law: an agent with no
 * policy object renders "unmeasured", never a fabricated
 * value.
 */
export function policyChipsHtml(policy) {
 const p = policy || {};
 return Object.keys(POLICY_LABELS)
  .map((key) => {
   const label = escapeHtml(POLICY_LABELS[key]);
   const value = escapeHtml(p[key] ?? "unmeasured");
   return `<span class="fork-policy-chip" data-policy="${key}"><span class="fork-policy-label">${label}</span><span class="fork-policy-value">${value}</span></span>`;
  })
  .join("");
}


/**
 * Pure helper: the /agents roster as a repo-keyed Map
 * of policy objects — the lookup the fork-card policy
 * chips consume. An absent roster yields an empty Map
 * (every fork renders unmeasured).
 */
export function agentPolicyMap() {
 const agents = state.agentRoster?.agents;
 if (!Array.isArray(agents)) return new Map();
 return new Map(agents.map((a) => [String(a?.repo ?? ""), a?.policy ?? null]));
}
/**
 * Fetch the fork ecosystem from /forks. Fail-soft: a failed fetch
 * flips the panel's own error flag and renders the quiet unavailable
 * state — it never touches connection state, so the connection banner
 * stays the /proposals fetch's to raise.
 */
export async function loadForks() {
 try {
  state.forksData = await fetchJson("/forks");
  state.forksError = false;
 } catch {
  state.forksData = null;
  state.forksError = true;
 }
 // Agent roster (identity v1): the policy chips on each
 // fork card derive from /agents, keyed by repo. Fail-soft
 // like the /forks fetch itself — an absent roster just
 // renders unmeasured chips; it never raises the
 // connection banner.
 const rosterBase = state.forksData?.base ?? "demo";
 try {
  state.agentRoster = await fetchJson("/agents?base=" + encodeURIComponent(rosterBase));
 } catch {
  state.agentRoster = null;
 }
 renderForks();
}

/**
 * Render the forks triage section. First-load treatment (FR-7): with
 * no payload and no observed failure the loader stands; an observed
 * failure renders the quiet unavailable line; a payload renders the
 * count meta, the empty state, or one card per fork.
 */
export function renderForks() {
 if (!el.forksList || !el.forksMeta) return;

 const data = state.forksData;
 if (!data) {
  el.forksMeta.textContent = "\u2014";
  el.forksList.innerHTML = state.forksError
   ? '<div class="forks-unavailable">Fork signals unavailable.</div>'
   : '<div class="forks-loading">Loading fork signals from /forks...</div>';
  return;
 }

 const forks = Array.isArray(data.forks) ? data.forks : [];
 el.forksMeta.textContent = `${forks.length} forks`;

 if (forks.length === 0) {
  el.forksList.innerHTML = `
      <div class="forks-empty">
        <div class="forks-empty-title">No forks yet</div>
        <div class="forks-empty-desc">Fork signals appear when an agent branch forks the base repo.</div>
      </div>
    `;
  return;
 }

 el.forksList.innerHTML = forks
  .map((fork) => {
   const repo = String(fork?.repo ?? "");
   const upstream = fork && fork.upstream ? fork.upstream : null;
   // Prefer the recorded lineage parent; else the echoed queried base
   // (the live demo case, where lineage is unrecorded).
   const base = upstream && typeof upstream.repo === "string" ? upstream.repo : data.base ?? "";
   // Policy chips derive from the /agents roster (identity v1),
   // keyed by repo; an unlisted fork renders unmeasured.
   const policy = agentPolicyMap().get(repo) ?? null;
   return `
        <div class="fork-card" id="fork-${escapeHtml(repo)}">
          <div class="fork-card-header">
            <span class="fork-repo-title">${escapeHtml(repo)}</span>
            <span class="fork-base" data-base="${escapeHtml(base)}">base: ${escapeHtml(base)}</span>
          </div>
          <div class="fork-signals">${signalChipsHtml(fork && fork.signals)}</div>
          <div class="fork-policy">${policyChipsHtml(policy)}</div>
        </div>
      `;
  })
  .join("");
}
