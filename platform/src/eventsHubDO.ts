// nextgit-platform — SSE hub fanning validated platform events into open streams.
//
// Single Durable Object instance (`idFromName("events")`) owns the SSE fan-out for
// the namespace event feed. The queue consumer (`recordEvent` in index.ts) writes
// the durable feed to KV (GET /events) and best-effort publishes each validated
// LiveEvent here; the hub in turn pushes it to every open SSE stream as an
// `event:` frame. New subscribers receive a connection confirmation comment, then
// the ring-buffer tail (the most recent MAX_EVENTS records), then live frames.
//
// The producer is best-effort: a hub failure is swallowed by recordEvent so the
// KV write (the durable source of truth) stands and queue messages are acked.
// Per-repo / per-base subscription is deferred; this is one namespace-wide feed.

// Duplicated from index.ts (lines ~738-781) to avoid a circular import — the hub
// must re-validate on publish so a future caller bypassing recordEvent still
// cannot inject a bad frame. Canonical copies live in platform/src/index.ts.
const MAX_EVENTS = 50; // ring-buffer cap, matches KV feed cap (index.ts:45)
const AFTER_RE = /^[0-9a-f]{40}$/;
const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;
const REF_RE = /^[\w./-]+$/;

const VALID_EVENT_TYPES: Record<string, true> = {
 "cf.artifacts.repo.pushed": true, "cf.artifacts.repo.forked": true, "cf.artifacts.repo.created": true,
 "cf.artifacts.repo.cloned": true, "cf.artifacts.repo.fetched": true,
 "repo.pushed": true, "repo.forked": true, "repo.created": true, "repo.cloned": true, "repo.fetched": true,
};

export interface LiveEvent {
 type?: string;
 repo?: string;
 ref?: string;
 after?: string;
 at: string;
}

/** Minimal env surface: only needs the EVENTS_HUB binding. */
export interface EventsHubEnv {
 EVENTS_HUB: DurableObjectNamespace | undefined;
}

interface HubRequest {
 method: "subscribe" | "publish";
 event?: LiveEvent;
}

/** A single writable SSE sink for one subscriber. */
interface SseSink {
 write(frame: Uint8Array): void;
 close(): void;
}

const HEARTBEAT_INTERVAL_MS = 25_000; // <= 30s requirement (CONTRACT § GET /events/stream)

// Canonical in index.ts:779 — strips the `cf.artifacts.` prefix.
function normalizeEventType(type: string): string {
 return type.replace(/^cf\.artifacts\./, "");
}

// Canonical in index.ts:749 — the SSE `id:` dedup key per CONTRACT § GET /events/stream.
function eventDedupKey(event: LiveEvent): string {
 const t = event.type ? normalizeEventType(event.type) : "";
 return t + "|" + (event.repo || "") + "|" + (event.ref ?? "") + "|" + (event.after ?? "");
}

function sseFrame(type: string, id: string, data: LiveEvent): string {
 return [
  `event: ${type}`,
  `retry: 30000`,
  `id: ${id}`,
  `data: ${JSON.stringify(data)}`,
 ].join("\n");
}

/** Single DurableObject instance: SSE fan-out hub for the namespace event feed. */
export class EventsHubDO implements DurableObject {
 readonly #storage: DurableObjectStorage;
 // In-memory subscriber registry, discarded on hibernation. Subscription filtering
 // is deferred (one namespace feed), so there is a single channel.
 readonly #sinks: Set<SseSink> = new Set();
 // Ring buffer of the most recent events; storage-backed so the snapshot tail
 // survives hibernation and reconnects.
 readonly #ringKey = "ring";
 readonly #textEncoder = new TextEncoder();

 constructor(ctx: DurableObjectState, env: EventsHubEnv) {
  void ctx;
  void env;
  this.#storage = ctx.storage;
 }

 async fetch(request: Request): Promise<Response> {
  if (request.method === "GET") {
   try {
    return this.#subscribe();
   } catch {
    return Response.json({ ok: false, error: "events-unavailable" }, { status: 503 });
   }
  }
  const body = (await request.json().catch(() => ({}))) as HubRequest;

  if (body.method === "publish") {
   const event = body.event;
   if (!event || !validateEvent(event)) {
    return Response.json({ ok: false, error: "invalid-event" }, { status: 400 });
   }
   const norm = { ...event, type: normalizeEventType(event.type!) };
   await this.#publish(norm);
   return new Response(null, { status: 204 });
  }

  if (body.method === "subscribe") {
   return this.#subscribe();
  }

  return Response.json({ ok: false, error: "unknown-method" }, { status: 400 });
 }

 /** Append to the ring buffer + fan out to every open sink. */
 async #publish(event: LiveEvent): Promise<void> {
  // Persist to the ring buffer (append + cap at MAX_EVENTS).
  try {
   const ring = (await this.#storage.get<LiveEvent[]>(this.#ringKey)) ?? [];
   ring.unshift(event);
   await this.#storage.put(this.#ringKey, ring.slice(0, MAX_EVENTS));
  } catch {
   // Best-effort persistence; the durable KV feed in recordEvent is the record.
  }

  // Fan out to every open subscriber as an `event:` frame.
  // event.type is already normalized by the caller — no re-normalize here.
  const frame = this.#encodeSSE(sseFrame(event.type ?? "", eventDedupKey(event), event));
  const dead: SseSink[] = [];
  for (const sink of this.#sinks) {
   try {
    sink.write(frame);
   } catch {
    dead.push(sink);
   }
  }
  for (const sink of dead) {
   this.#sinks.delete(sink);
   sink.close();
  }
 }

 /** Serve one SSE stream: connect comment, ring tail, then live frames + heartbeat. */
 #subscribe(): Response {
  let heartbeatTimer: number | null = null;
  let sink: SseSink | null = null;

  const stream = new ReadableStream({
   start: (controller) => {
    // SSE comment as a connection confirmation (never an event frame on connect alone).
    controller.enqueue(this.#encodeSSE(": connected"));

    sink = {
     write(frame: Uint8Array) {
      controller.enqueue(frame);
     },
     close() {
      if (heartbeatTimer !== null) {
       clearInterval(heartbeatTimer);
       heartbeatTimer = null;
      }
     },
    };

    this.#sinks.add(sink);

    // Drain the ring-buffer snapshot (newest-first, as GET /events serves).
    void (async () => {
     try {
      const ring = (await this.#storage.get<LiveEvent[]>(this.#ringKey)) ?? [];
      for (const e of ring) {
       if (!sink || !this.#sinks.has(sink)) break;
       try {
        controller.enqueue(this.#encodeSSE(sseFrame(e.type ?? "", eventDedupKey(e), e)));
       } catch {
        // Controller closed during drain; stop.
        break;
       }
      }
     } catch {
      // Best-effort snapshot; the live stream still delivers.
     }
    })();

    // Heartbeat: every 25 s (≤30 s contract). Emits an SSE comment, no data.
    heartbeatTimer = setInterval(() => {
     if (sink && this.#sinks.has(sink)) {
      try {
       controller.enqueue(this.#encodeSSE(": heartbeat"));
      } catch {
       // Controller closed; the sink's close() will clear this timer.
      }
     }
    }, HEARTBEAT_INTERVAL_MS);
   },
   cancel: () => {
    // Client disconnected — drop only this sink, preserving other subscribers.
    if (sink) {
     this.#sinks.delete(sink);
     sink.close();
     sink = null;
    }
   },
  });

  return new Response(stream, {
   headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    // workerd DO streaming: when the last client disconnects, the DO may
    // hibernate — the in-memory sink registry is rebuilt on reconnect.
   },
  });
 }

 #encodeSSE(content: string): Uint8Array {
  return this.#textEncoder.encode(content + "\n\n");
 }
}

// --- Validation helpers (duplicated from index.ts to avoid a circular import) ---

/** Canonical in index.ts:738 — guards the feed against malformed queue messages. */
function validateEvent(event: LiveEvent): boolean {
 if (!event.type || typeof event.type !== "string") return false;
 const norm = normalizeEventType(event.type);
 if (!VALID_EVENT_TYPES[norm]) return false;
 if (!event.repo || typeof event.repo !== "string" || !REPO_NAME_RE.test(event.repo)) return false;
 if (event.ref !== undefined && (typeof event.ref !== "string" || !REF_RE.test(event.ref) || event.ref.includes("..") || event.ref.startsWith("/") || event.ref.endsWith("/"))) return false;
 if (event.after !== undefined && (typeof event.after !== "string" || !AFTER_RE.test(event.after))) return false;
 if (!event.at || typeof event.at !== "string") return false;
 return true;
}

/**
 * Publish a validated LiveEvent to the events hub for fan-out.
 * Best-effort: callers wrap this in try/catch (see recordEvent) so a hub failure
 * never rolls back the durable KV write or blocks queue ack.
 */
export async function publishEventToHub(env: EventsHubEnv, event: LiveEvent): Promise<void> {
 if (!env.EVENTS_HUB) return;
 const id = env.EVENTS_HUB.idFromName("events");
 const stub = env.EVENTS_HUB.get(id);
 const res = await stub.fetch(
  "https://internal/events/hub",
  {
   method: "POST",
   headers: { "content-type": "application/json" },
   body: JSON.stringify({ method: "publish", event }),
  },
 );
 if (!res.ok) {
  throw new Error(`hub publish -> HTTP ${res.status}`);
 }
}
