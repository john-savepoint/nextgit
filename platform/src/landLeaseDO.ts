// nextgit-platform — DO lease serializing /land per base repo across isolates (FR-17).
//
// `withLandGate` serializes within one isolate. When concurrent POST /land calls
// hit different isolates (Workers autoscale), only the timing-dependent AD-3
// base-moved push-rejection fallback catches the race. This DO provides a
// deterministic lease per base: the winner acquires, lands, releases; losers
// are refused with the same 409 base-moved loser shape. Surgical: lands on
// different bases proceed concurrently (keyed by `lease:<base>`).
//
// Internal HTTPS surface only — no new public route. The lease result carries
// no secrets; leaseId is server-generated via crypto.randomUUID().

const LEASE_TTL_SECONDS = 30; // spans a land (clone+fold+push) + lazy expiry + DO hibernation

export interface LandLeaseResult {
 acquired: boolean;
 leaseId: string | null;
}

interface LeaseRecord {
 leaseId: string;
 expiresAt: number; // epoch seconds
}

interface LeaseRequest {
 method: "acquire" | "release";
 base: string;
 leaseId?: string;
 ttlSeconds?: number;
}

/** Minimal env surface for lease helpers: only needs the LAND_LEASE binding. */
interface LandLeaseEnv {
 LAND_LEASE: DurableObjectNamespace | undefined;
}

/** Single DurableObject instance: JSON-RPC fetch handler keyed by base repo name. */
export class LandLeaseDO implements DurableObject {
 readonly #storage: DurableObjectStorage;

 constructor(ctx: DurableObjectState, env: LandLeaseEnv) {
  void ctx;
  void env;
  this.#storage = ctx.storage;
 }

 async fetch(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as LeaseRequest;
  const base = String(body?.base ?? "");
  if (!base) return Response.json({ error: "missing base" }, { status: 400 });

  if (body.method === "acquire") {
   const ttl = Math.min(body.ttlSeconds ?? LEASE_TTL_SECONDS, LEASE_TTL_SECONDS);
   const key = `lease:${base}`;
   const existing = await this.#storage.get<LeaseRecord>(key);
   const now = Date.now() / 1000;
   if (existing && existing.expiresAt > now) {
    return Response.json({ acquired: false, leaseId: null } as LandLeaseResult);
   }
   const leaseId = crypto.randomUUID();
   const record: LeaseRecord = { leaseId, expiresAt: now + ttl };
   await this.#storage.put(key, record);
   console.log("lease-acquired", JSON.stringify({ base, leaseId }));
   return Response.json({ acquired: true, leaseId } as LandLeaseResult);
  }

  if (body.method === "release") {
   const key = `lease:${base}`;
   const leaseId = body.leaseId;
   if (!leaseId) return new Response(null, { status: 204 });
   const existing = await this.#storage.get<LeaseRecord>(key);
   if (existing && existing.leaseId === leaseId) {
    await this.#storage.delete(key);
    console.log("lease-released", JSON.stringify({ base, leaseId }));
   }
   return new Response(null, { status: 204 });
  }

  return Response.json({ error: "unknown method" }, { status: 400 });
 }
}

/**
 * Acquire a per-base lease. Returns `null` when `env.LAND_LEASE` is undefined
 * (fallback to AD-3 push-rejection). Otherwise returns `{ acquired, leaseId }`.
 */
export async function acquireLandLease(
 env: LandLeaseEnv,
 base: string,
 ttlSeconds: number = LEASE_TTL_SECONDS,
): Promise<LandLeaseResult | null> {
 if (!env.LAND_LEASE) return null;
 const stub = env.LAND_LEASE.idFromName(base);
 const obj = env.LAND_LEASE.get(stub);
 const res = await obj.fetch(
  "https://internal/lease",
  {
   method: "POST",
   headers: { "content-type": "application/json" },
   body: JSON.stringify({ method: "acquire", base, ttlSeconds }),
  },
 );
 if (!res.ok) return null;
 const json = (await res.json().catch(() => null)) as LandLeaseResult | null;
 return json;
}

/**
 * Release a per-base lease. Best-effort: swallows errors (the TTL bounds exposure
 * even if release fails). Only deletes when `leaseId` matches.
 */
export async function releaseLandLease(env: LandLeaseEnv, base: string, leaseId: string): Promise<void> {
 if (!env.LAND_LEASE || !leaseId) return;
 try {
  const stub = env.LAND_LEASE.idFromName(base);
  const obj = env.LAND_LEASE.get(stub);
  await obj.fetch(
   "https://internal/lease",
   {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "release", base, leaseId }),
   },
  );
 } catch {
  // Best-effort; TTL still bounds the lease lifetime.
 }
}
