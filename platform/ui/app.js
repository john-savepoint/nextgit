// nextgit — convergence triage UI (vanilla ES module)
// Adheres strictly to platform/CONTRACT.md
import { decideSecretSurface } from "./reveal-decision.js";
import { renderLandVerdict, landVerdictFromLandResponse, landVerdictFromErrorEnvelope } from "./land-verdict.js";

/**
 * State container
 */
const state = {
 proposalsData: null,
 events: [],
 autoRefresh: true,
 proposalsTimer: null,
 eventsTimer: null,
 connectionError: false,
 lastError: null,
 lastSyncTime: null,
 activeInspector: null, // { type: 'diff' | 'merge', data: ... }
 modalReturnFocus: null, // element that opened the inspector — focus returns here on close
 landingRepo: null,     // repo currently being landed
 confirmingRepo: null,  // repo in inline confirmation state
 lastEventSeenAt: null, // timestamp/id of newest event seen
 debounceRefreshTimer: null, // timer for event-triggered refresh
 judgeData: null,        // repo -> advisory judgment from /judge (setId v1)
 judgeSignature: null,   // payload signature the last judge call answered
 judgeLastAttempt: 0,    // ms clock of the last judge attempt (cheap-path throttle)
 judgeInFlight: false,   // a judge request is in flight
 stream: null,           // active EventSource for /events/stream (one per page)
 streamHealthy: false,   // SSE open and receiving -> pollers stay down
 streamTimer: null,      // reconnect backoff timer for the SSE stream
 streamBackoffMs: 1000,  // SSE reconnect backoff, doubles to a 30s cap
 streamSeenKeys: new Set(), // SSE `id:` dedup keys seen this page
 revealCapability: { authorized: false, reveal: false }, // /whoami probe — drives the reveal affordance
 landVerdictByRepo: {}, // repo -> last auto-land advisory (AD-11 verdict, rendered never decided). Last VERDICT, not last error: only a server-carried verdict replaces the entry — an unrelated /land error leaves the last verdict standing, and a later act/confirm overwrites it.
};

// UI Selectors
const el = {
 connectionBanner: document.getElementById("connection-banner"),
 connectionMsg: document.getElementById("connection-banner-msg"),
 btnRetry: document.getElementById("connection-banner-retry"),
 baseVal: document.getElementById("base-val"),
 refVal: document.getElementById("ref-val"),
 autoRefreshToggle: document.getElementById("auto-refresh-toggle"),
 btnRefresh: document.getElementById("btn-manual-refresh"),
 valProposals: document.getElementById("val-proposals"),
 valShared: document.getElementById("val-shared"),
 valConflicts: document.getElementById("val-conflicts"),
 valChanged: document.getElementById("val-changed"),
 valClean: document.getElementById("val-clean"),
 chipConflicts: document.getElementById("chip-conflicts"),
 chipShared: document.getElementById("chip-shared"),
 chipClean: document.getElementById("chip-clean"),
 tickerEvents: document.getElementById("ticker-events"),
 tickerPulse: document.getElementById("ticker-pulse"),
 conflictsList: document.getElementById("conflicts-list"),
 conflictsMeta: document.getElementById("conflicts-meta"),
 proposalsGrid: document.getElementById("proposals-grid"),
 proposalsMeta: document.getElementById("proposals-meta"),
 inspectorModal: document.getElementById("inspector-modal"),
 modalTitle: document.getElementById("modal-title"),
 modalBadge: document.getElementById("modal-badge"),
 modalBody: document.getElementById("modal-body"),
 btnCloseModal: document.getElementById("btn-close-modal"),
 lastSyncTime: document.getElementById("last-sync-time"),
 actionBanner: document.getElementById("action-banner"),
 actionBannerMsg: document.getElementById("action-banner-msg"),
 actionBannerBadge: document.getElementById("action-banner-badge"),
 actionBannerClose: document.getElementById("action-banner-close"),
};

/**
 * Pure helper: Escape HTML to avoid XSS
 */
function escapeHtml(str) {
 if (str == null) return "";
 return String(str)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
}

/**
 * Pure helper: Format relative or local time
 */
function formatTime(isoOrTimestamp) {
 if (!isoOrTimestamp) return "";
 try {
  const d = new Date(isoOrTimestamp);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
 } catch {
  return "";
 }
}

/**
 * Pure helper: Map conflict kind to severity category
 * kind ∈ text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed
 */
function getConflictSeverity(kind) {
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
 * Pure helper: Render diff patch text into line-colored HTML
 */
function renderPatchLines(patch) {
 if (!patch || typeof patch !== "string") {
  return '<div class="diff-placeholder">No patch available for this file (omitted, withheld, or binary).</div>';
 }

 const lines = patch.split("\n");
 const rendered = lines.map((line) => {
  let lineClass = "";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("===") || line.startsWith("Index:")) {
   lineClass = "line-meta";
  } else if (line.startsWith("@@")) {
   lineClass = "line-hunk";
  } else if (line.startsWith("+")) {
   lineClass = "line-add";
  } else if (line.startsWith("-")) {
   lineClass = "line-del";
  }
  return `<div class="diff-line ${lineClass}">${escapeHtml(line) || " "}</div>`;
 });

 return `<div class="diff-viewer">${rendered.join("")}</div>`;
}

/**
 * API client with timeout
 *  - 20s default (worker cold-start after deploys exceeded the old 8s cap and left
 *    the canvas in its aborted state until a manual retry — observed 2026-10-08)
 *  - ONE automatic retry when the request was killed by its own timeout (AbortError);
 *    HTTP/4xx/5xx errors keep exact semantics and are never retried
 *  - callers may override via options.timeoutMs (POST /land uses 45s: it folds + pushes)
 */
async function fetchJson(endpoint, options = {}) {
 const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000;
 const timeoutOpt = { ...options };
 delete timeoutOpt.timeoutMs;
 const attempt = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
   const res = await fetch(endpoint, {
    ...timeoutOpt,
    signal: controller.signal,
    headers: {
     Accept: "application/json",
     ...(timeoutOpt.headers || {}),
    },
   });
   clearTimeout(timeoutId);

   const json = await res.json().catch(() => null);
   if (!res.ok || (json && json.ok === false)) {
    const err = new Error(json?.error || `HTTP ${res.status}: ${res.statusText}`);
    err.status = res.status;
    err.response = json;
    throw err;
   }
   return json;
  } catch (err) {
   clearTimeout(timeoutId);
   throw err;
  }
 };
 try {
  return await attempt();
 } catch (err) {
  if (err && err.name === "AbortError") return await attempt(); // single retry: timeout only
  throw err;
 }
}

/**
 * Fetch and render proposals + conflicts
 */
async function loadProposals() {
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
async function loadRevealCapability() {
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
 * Action banner manager
 */
function showActionBanner(type, badgeText, messageHtml) {
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

function hideActionBanner() {
 if (!el.actionBanner) return;
 el.actionBanner.hidden = true;
 if (el.actionBannerMsg) el.actionBannerMsg.innerHTML = "";
}
/**
 * Record the newest event and debounce one /proposals refresh (~500ms)
 * when a NEW event is detected. Shared verbatim by both transports —
 * the /events poller (loadEvents) and the SSE stream (handleStreamFrame) —
 * so the composed key logic (identical 500ms, exactly-one refresh) holds
 * regardless of which transport delivered the event.
 */
function noteEvent(topEvent) {
 if (!topEvent) return;
 const topEventKey = `${topEvent.type || ""}:${topEvent.repo || ""}:${topEvent.at || ""}:${topEvent.after || ""}`;

 if (state.lastEventSeenAt !== null && state.lastEventSeenAt !== topEventKey) {
  // A new event arrived! Debounce one /proposals refresh (~500ms)
  clearTimeout(state.debounceRefreshTimer);
  state.debounceRefreshTimer = setTimeout(() => {
   state.debounceRefreshTimer = null;
   loadProposals();
  }, 500);
 }
 state.lastEventSeenAt = topEventKey;
}

/**
 * Fetch and render live event ticker
 * Event-driven refresh: debounces a /proposals refresh (~500ms) when a NEW event is detected.
 */
async function loadEvents() {
 try {
  const data = await fetchJson("/events");
  if (data && Array.isArray(data.events)) {
   const newEvents = data.events;
   if (newEvents.length > 0) {
    noteEvent(newEvents[0]);
   }
   state.events = newEvents.slice(0, 8);
  }
  renderEventsTicker();
 } catch {
  // Events failing quietly should not break main proposals UI, but pulse indicator shows stale
  if (el.tickerPulse) el.tickerPulse.classList.add("is-stale");
 }
}

/**
 * Handle one frame from the /events/stream SSE feed.
 * Shape-guards the parsed payload, dedups by the DO's `id:` key, then
 * prepends + sorts newest-first + caps at 8 (the ticker contract) and
 * reuses the exact debounce key logic via noteEvent. Malformed frames
 * are dropped silently — one bad frame never breaks the stream.
 */
function handleStreamFrame(ev) {
 if (!ev || typeof ev !== "object" || typeof ev.at !== "string") return;

 const dedupKey = `${ev.type || ""}|${ev.repo || ""}|${ev.ref ?? ""}|${ev.after ?? ""}`;
 if (state.streamSeenKeys.has(dedupKey)) return;
 state.streamSeenKeys.add(dedupKey);

 state.events = [ev, ...state.events]
  .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  .slice(0, 8);
 renderEventsTicker();
 noteEvent(ev);
}

// EventSource lifecycle — the stream is the primary transport; polling is the
// degraded fallback. One EventSource per page load; reconnects back off
// exponentially (1s -> 30s cap) and re-arm the pollers while down.
const STREAM_RECONNECT_MAX_MS = 30000;

function startPollers() {
 // Idempotent: an already-armed poller is left running so a
 // reconnect (markStreamDown -> startPollers) never resets its
 // interval — otherwise the 8s /proposals deadline is never
 // reached during rapid reconnects and the fallback starves.
 // stopPollers() nulls the timers, so a toggle re-arm still
 // re-creates them.
 if (!state.eventsTimer) {
  state.eventsTimer = setInterval(loadEvents, 2000);
 }
 if (state.autoRefresh && !state.proposalsTimer) {
  state.proposalsTimer = setInterval(loadProposals, 8000);
 }
}

function stopPollers() {
 if (state.proposalsTimer) {
  clearInterval(state.proposalsTimer);
  state.proposalsTimer = null;
 }
 if (state.eventsTimer) {
  clearInterval(state.eventsTimer);
  state.eventsTimer = null;
 }
}

function markStreamHealthy() {
 state.streamHealthy = true;
 state.streamBackoffMs = 1000;
 if (el.tickerPulse) {
  el.tickerPulse.classList.remove("is-stale");
  el.tickerPulse.classList.remove("is-fallback");
 }
 stopPollers();
}

function markStreamDown() {
 state.streamHealthy = false;
 if (el.tickerPulse) el.tickerPulse.classList.add("is-fallback");
 if (state.stream) {
  state.stream.close();
  state.stream = null;
 }
 startPollers();
 clearTimeout(state.streamTimer);
 state.streamTimer = setTimeout(openEventStream, state.streamBackoffMs);
 state.streamBackoffMs = Math.min(state.streamBackoffMs * 2, STREAM_RECONNECT_MAX_MS);
}

function openEventStream() {
 if (state.stream) return; // one EventSource per page load
 // Live-render probe (`?probe=1`): the probe dumps the DOM under
 // --virtual-time-budget, which never settles while the never-ending SSE
 // fetch is open (Chrome waits for network quiet; the dump only fires after
 // the budget elapses). In probe mode stay on the deterministic polling
 // path — the gate reads the RENDERED page; SSE behavior is covered
 // end-to-end by the loopback suite (ui-event-stream-consume).
 if (new URLSearchParams(location.search).has("probe")) return;
 const source = new EventSource("/events/stream");
 state.stream = source;
 // : connected — the hub's first frame is a comment, never an event frame
 source.addEventListener("open", markStreamHealthy);
 const onFrame = (e) => {
  try {
   handleStreamFrame(JSON.parse(e.data));
  } catch {
   // malformed frame dropped — the stream stays open
  }
 };
 source.addEventListener("repo.pushed", onFrame);
 source.addEventListener("repo.forked", onFrame);
 source.addEventListener("repo.created", onFrame);
 source.addEventListener("repo.cloned", onFrame);
 source.addEventListener("repo.fetched", onFrame);
 source.addEventListener("error", markStreamDown);
}
/**
 * Render Header & Summary Chips
 */
function renderHeader() {
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
 * Render Live Ticker
 */
function renderEventsTicker() {
 if (!el.tickerEvents) return;

 if (el.tickerPulse) {
  el.tickerPulse.classList.remove("is-stale");
 }

 const events = state.events;
 if (!events || events.length === 0) {
  el.tickerEvents.innerHTML = '<span class="ticker-empty">listening for convergence events...</span>';
  return;
 }

 const html = events
  .map((ev) => {
   const type = escapeHtml(ev.type || "event");
   const repo = escapeHtml(ev.repo || "");
   const time = ev.at ? formatTime(ev.at) : "";
   return `
        <div class="ticker-event">
          <span class="event-type">${type}</span>
          ${repo ? `<span class="event-repo">${repo}</span>` : ""}
          ${time ? `<span class="event-time">${time}</span>` : ""}
        </div>
      `;
  })
  .join("");

 el.tickerEvents.innerHTML = html;
}

/**
 * Render Conflicts Panel
 */
function renderConflicts() {
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

/**
 * Advisory judge chips for one proposal card (setId v1 vocabulary).
 * Renders nothing when there is no judgment (never judged / skipped) or when
 * the card is landed — a landed card never wears stale chips.
 */
function judgeChipsHtml(repo, isLanded) {
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
function landVerdictBadgeHtml(repo) {
 const verdict = state.landVerdictByRepo[repo];
 if (!verdict) return "";
 const render = renderLandVerdict(verdict);
 if (!render || render.kind !== "escalate" || !render.badgeText) return "";
 return `<span class="badge ${escapeHtml(render.badgeClass)}" title="auto-land verdict: escalate">${escapeHtml(render.badgeText)}</span>`;
}

/**
 * Render Proposals Grid
 */
function renderProposals() {
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
                ${!isSecret
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
function renderProposalsView() {
 renderConnectionState();
 renderHeader();
 renderConflicts();
 renderProposals();
}

/**
 * Render connection error state
 */
function renderConnectionState() {
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

/**
 * Focusable controls inside the inspector dialog, in DOM order.
 * Recomputed per call: the dialog body re-renders on merge-tab clicks, so a cached
 * list would point at detached nodes. Non-rendered controls never trap.
 */
function modalFocusables() {
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
function openModal(title, badgeText, badgeClass, bodyHtml) {
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
function closeModal() {
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
async function handleViewDiff(repo, path) {
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
async function handlePreviewMerge(repo) {
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
      `;
  }

  openModal(
   `Merge preview: ${repo}`,
   statusChip.text,
   statusChip.badgeClass,
   renderMergeContent(activeIndex)
  );

  // Bind tab clicks inside the modal
  if (el.modalBody) {
   el.modalBody.onclick = (e) => {
    const tabBtn = e.target.closest("[data-merge-tab]");
    if (tabBtn) {
     const tabIdx = parseInt(tabBtn.getAttribute("data-merge-tab"), 10);
     if (!isNaN(tabIdx) && files[tabIdx]) {
      activeIndex = tabIdx;
      el.modalBody.innerHTML = renderMergeContent(activeIndex);
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
/**
 * Action: Land proposal into baseline
 */
async function handleLandProposal(repo) {
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
   const render = renderLandVerdict(landVerdictFromErrorEnvelope(resp) || { error: "judge-unavailable" });
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

/**
 * Event delegation for proposals grid (view diff, preview merge, and landing)
 */
/**
 * Elevated-reveal click: read the value through the audited
 * POST /reveal seam. The value is rendered ONLY from the 200
 * response body (escaped); a denied/errored click renders the
 * withheld notice with no value. The affordance is never a
 * capability — the server re-runs the reveal rule on every click.
 */
async function revealSecret(repo, path, keysCsv) {
 const valueSlot = document.getElementById("reveal-value");
 const key = keysCsv.split(",")[0];
 try {
  const data = await fetchJson("/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, ref: "main", path, key }) });
  if (data?.ok && typeof data.value === "string") {
   if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="reveal-value-line">${escapeHtml(key)} = ${escapeHtml(data.value)}</div>`; }
   return;
  }
  const decision = decideSecretSurface({ reveal: true, revealDenied: data?.error === "reveal-not-authorized", revealFailed: data?.error !== "reveal-not-authorized" });
  if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
 } catch (err) {
 // fetchJson throws on !res.ok but attaches the parsed body
 // as err.response — so a 403 reveal-not-authorized maps to
 // the DENIED cell (not the error cell); any other failure
 // (network/5xx) maps to the ERROR cell. Both render the
 // withheld notice with no value.
 const denied = err?.response?.error === "reveal-not-authorized";
 const decision = decideSecretSurface({ reveal: true, revealDenied: denied, revealFailed: !denied });
 if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
}}

function setupInteractions() {
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

 // Manual refresh
 if (el.btnRefresh) {
  el.btnRefresh.addEventListener("click", () => {
   loadProposals();
   loadEvents();
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
function setupTimers() {
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
function init() {
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
 loadProposals();
 loadEvents();
}


// Run when DOM is ready
if (document.readyState === "loading") {
 document.addEventListener("DOMContentLoaded", init);
} else {
 init();
}
