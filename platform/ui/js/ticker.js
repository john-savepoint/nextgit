// nextgit — ticker + event-transport domain (wave-13 module
// split from app.js). Owns the /events poller, the /events/stream
// SSE lifecycle, and the ticker render.
import { state, el } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";
import { loadProposals } from "./proposals.js";

/**
 * Record the newest event and debounce one /proposals refresh (~500ms)
 * when a NEW event is detected. Shared verbatim by both transports —
 * the /events poller (loadEvents) and the SSE stream (handleStreamFrame) —
 * so the composed key logic (identical 500ms, exactly-one refresh) holds
 * regardless of which transport delivered the event.
 */
export function noteEvent(topEvent) {
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
export async function loadEvents() {
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
 * Render Live Ticker
 */
export function renderEventsTicker() {
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
 * Handle one frame from the /events/stream SSE feed.
 * Shape-guards the parsed payload, dedups by the DO's `id:` key, then
 * prepends + sorts newest-first + caps at 8 (the ticker contract) and
 * reuses the exact debounce key logic via noteEvent. Malformed frames
 * are dropped silently — one bad frame never breaks the stream.
 */
export function handleStreamFrame(ev) {
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

export function startPollers() {
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

export function stopPollers() {
 if (state.proposalsTimer) {
  clearInterval(state.proposalsTimer);
  state.proposalsTimer = null;
 }
 if (state.eventsTimer) {
  clearInterval(state.eventsTimer);
  state.eventsTimer = null;
 }
}

export function markStreamHealthy() {
 state.streamHealthy = true;
 state.streamBackoffMs = 1000;
 if (el.tickerPulse) {
  el.tickerPulse.classList.remove("is-stale");
  el.tickerPulse.classList.remove("is-fallback");
 }
 stopPollers();
}

export function markStreamDown() {
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

export function openEventStream() {
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
