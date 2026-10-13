// nextgit — shared UI singletons (wave-13 module split from app.js).
// `state` and `el` are the two module-scope objects every domain
// module closes over. Imported one-directionally by all modules —
// no cycles. NOT frozen: `state` is mutated everywhere; freezing
// would be a behavior change.

/**
 * State container
 */
export const state = {
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
 forksData: null,        // /forks six-cluster + lineage payload (null until observed)
 forksError: false,      // a /forks fetch has failed (fail-soft: never trips the connection banner)
 agentRoster: null,      // /agents roster payload (identity v1 — the policy chips' source; null until observed, fail-soft)
 revealCapability: { authorized: false, reveal: false }, // /whoami probe — drives the reveal affordance
 landVerdictByRepo: {}, // repo -> last auto-land gate outcome (AD-11 verdict, rendered never decided). Last server-carried GATE OUTCOME, not last error: a verdict (act/confirm/escalate) OR the gate's own fail-closed answer (judge-unavailable -> blocked) replaces the entry — an unrelated /land error leaves it standing, and a later act/confirm overwrites it.
};

// UI Selectors
export const el = {
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
 forksSection: document.getElementById("forks-section"),
 forksList: document.getElementById("forks-list"),
 forksMeta: document.getElementById("forks-meta"),
};
