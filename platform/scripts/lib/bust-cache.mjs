// bust-cache.mjs — invalidate the live /proposals KV cache after fixture mutation.
//
// Why: /proposals is KV-cached (gen-keyed, `cache:proposals:<gen>:…`). Push-driven
// invalidation rides the Artifacts→Queues→consumer path, measured at 1.5–4 min
// latency — far too slow for the demo reset loop (reset → verify saw a STALE canvas:
// agent-5 rendered `landed` for minutes after its fixture restore, 2026-10-10).
// Fixture scripts therefore bump `cache:gen` directly via the KV API after their
// pushes; the next /proposals call recomputes fresh. The queue event still bumps it
// later — same key, harmless.
//
// Best-effort by design: a KV API hiccup must not fail a reseed — it warns and the
// queue's (slow) invalidation remains as backstop.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const CACHE_ID = process.env.CACHE_NAMESPACE_ID ?? "55d973240e2d4770a07ddc0faedf757c"; // platform/wrangler.jsonc CACHE

function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return null;
}

export async function bustProposalsCache(label = "reset") {
  const token = apiToken();
  if (!token) {
    console.log("cache  : gen bust skipped (no API token) — queue invalidation is the backstop");
    return false;
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${CACHE_ID}/values/cache:gen`,
      { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: `${label}-${Date.now()}` },
    );
    console.log(res.ok ? "cache  : /proposals gen busted (next call recomputes fresh)" : `cache  : gen bust HTTP ${res.status} — queue will catch up`);
    return res.ok;
  } catch (e) {
    console.log(`cache  : gen bust failed (${e?.name ?? "error"}) — queue will catch up`);
    return false;
  }
}
