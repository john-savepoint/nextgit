// nextgit — pipelines domain (nextgit-e17, wave-17).
// Owns the GET /pipelines list — landed runs as
// pipeline records, the projection of the landing
// records POST /land / POST /upstream persist.
// Imports the shared state/el singletons and the
// API client only.
// FAIL-SOFT: this secondary panel never touches
// connection state — a failed /pipelines fetch must
// not raise the connection banner (the forks/issues/
// sessions precedent).
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";

/** The closed pipeline-status vocabulary the server derives. */
export const PIPELINE_STATES = { passed: "passed", "not-recorded": "not-recorded", failed: "failed" };

/**
 * Pure helper: the status chip class for a run's
 * server-derived status. An unknown status value
 * renders as `unknown` with the neutral class —
 * never as `passed` (honest styling: the chip text
 * is the server-derived status verbatim, not a
 * guess; the ONLY path to pipeline-status-passed
 * is the literal "passed").
 */
function pipelineStatusClass(rawStatus) {
 return Object.prototype.hasOwnProperty.call(PIPELINE_STATES, rawStatus)
  ? PIPELINE_STATES[rawStatus]
  : "unknown";
}

/**
 * Pure helper: the attestation badge class.
 * "signed" is the ONLY clean badge; "unavailable"
 * and a null/absent envelope (a record predating
 * the attestation layer) render neutral — never a
 * clean/green badge for a non-signed record.
 */
function attestationBadgeClass(rawAttestation) {
 return rawAttestation === "signed" ? "signed" : rawAttestation === "unavailable" ? "unavailable" : "unrecorded";
}

/**
 * Pure helper: one pipeline row. The commit sha,
 * repo names, the ISO instant, the check/result
 * names and the attestation projection are
 * server-derived and untrusted (AD-4): every
 * string passes through escapeHtml before markup.
 * The row links to the landing record
 * (GET /landings/{commit}) — the read surface the
 * order names.
 */
export function pipelineRowHtml(pipeline) {
 const id = String(pipeline?.id ?? "");
 const repos = Array.isArray(pipeline?.repos)
  ? pipeline.repos.filter((r) => typeof r === "string").join(", ")
  : "";
 const at = typeof pipeline?.at === "string" ? pipeline.at : "";
 const rawStatus = String(pipeline?.status ?? "");
 const statusClass = pipelineStatusClass(rawStatus);
 const rawAttestation = pipeline?.attestation === undefined ? null : pipeline.attestation;
 const attestationClass = attestationBadgeClass(rawAttestation);
 const attestationLabel = rawAttestation === "signed" || rawAttestation === "unavailable" ? rawAttestation : "unrecorded";
 return `
      <div class="pipeline-row" id="pipeline-${escapeHtml(id)}">
        <div class="pipeline-row-header">
          <code class="pipeline-sha" title="${escapeHtml(id)}">${escapeHtml(id.slice(0, 7))}</code>
          <span class="pipeline-status pipeline-status-${statusClass}">${escapeHtml(rawStatus)}</span>
          <span class="pipeline-attestation pipeline-attestation-${attestationClass}">${escapeHtml(attestationLabel)}</span>
        </div>
        <div class="pipeline-repos">${escapeHtml(repos)}</div>
        <div class="pipeline-row-footer">
          <span class="pipeline-at">${formatTime(at)}</span>
          <a class="pipeline-link" href="/landings/${encodeURIComponent(id)}">landing record</a>
        </div>
      </div>
    `;
}

/**
 * Pure helper: the honest empty state. The contract's
 * empty-namespace posture — a base with no landing
 * records is EMPTY, never a fabricated row.
 */
export function pipelineEmptyHtml(base) {
 return `
      <div class="pipelines-empty">
        <div class="pipelines-empty-title">No pipeline runs recorded for ${escapeHtml(base)}</div>
      </div>
    `;
}

/**
 * Fetch the pipeline list from /pipelines. Fail-soft:
 * a failed fetch flips the panel's own error flag and
 * renders the quiet unavailable state — it never
 * touches connection state, so the connection banner
 * stays the /proposals fetch's to raise.
 */
export async function loadPipelines() {
 try {
  const base = state.proposalsData?.base?.repo || "demo";
  state.pipelinesData = await fetchJson(`/pipelines?base=${encodeURIComponent(base)}`);
  state.pipelinesError = false;
 } catch {
  state.pipelinesData = null;
  state.pipelinesError = true;
 }
 renderPipelines();
}

/**
 * Render the pipelines section. First-load treatment
 * (the forks/issues/sessions FR-7 posture): with no
 * payload and no observed failure the loader stands;
 * an observed failure renders the quiet unavailable
 * line; a payload renders the count meta, the empty
 * state, or one row per run.
 */
export function renderPipelines() {
 if (!el.pipelinesList || !el.pipelinesMeta) return;

 const data = state.pipelinesData;
 if (!data) {
  el.pipelinesMeta.textContent = "—";
  el.pipelinesList.innerHTML = state.pipelinesError
   ? '<div class="pipelines-unavailable">Pipelines unavailable.</div>'
   : '<div class="pipelines-loading">Loading pipelines from /pipelines...</div>';
  return;
 }

 const pipelines = Array.isArray(data.pipelines) ? data.pipelines : [];
 const base = typeof data.base === "string" ? data.base : "";
 el.pipelinesMeta.textContent = `${pipelines.length} run${pipelines.length === 1 ? "" : "s"} · ${base}`;

 if (pipelines.length === 0) {
  el.pipelinesList.innerHTML = pipelineEmptyHtml(base);
  return;
 }

 el.pipelinesList.innerHTML = pipelines.map((pipeline) => pipelineRowHtml(pipeline)).join("");
}
