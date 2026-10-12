// api-token.mjs — the ONE operator API-token resolver (AD-7).
//
// Every script that talks to the Cloudflare REST control
// plane authenticates with the operator's token. The
// resolution rule lives here once (AD-8 single-source):
//
//   1. CLOUDFLARE_API_TOKEN, when set.
//   2. The wrangler OAuth config (~/.config/.wrangler/config/default.toml,
//      then ~/.wrangler/config/default.toml) — the `wrangler login`
//      session.
//   3. Otherwise throw — never a silent empty token.
//
// Shared by fanout.mjs, upload-asset.mjs and r2-orphan-sweep.mjs
// (the e12 cutover: the per-script copies were deleted, not
// duplicated).

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function apiToken() {
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
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}
