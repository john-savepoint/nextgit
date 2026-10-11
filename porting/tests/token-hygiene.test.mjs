#!/usr/bin/env bun
// Contract suite: FR-36 — token storage hygiene.
//   1. Agent manifests are written 0600 — INCLUDING a pre-existing
//      0644 file, which must be re-moded on rewrite (Node's
//      `writeFileSync({mode})` applies only at create).
//   2. The manifest printer destructures only name/scope/expires_at —
//      a token field is unprintable by construction.
//   3. Runtime-pin fence: the four /tmp/nextgit-agents.json writers
//      route through writeAgentManifest; no script logs token
//      material; no git exec carries the token in argv.
//   3e. Import-integrity fence: every helper each touched script's
//      body references is present in its imported bindings (node
//      --check is parse-only and cannot catch a used-but-unimported
//      identifier — the heal-1 defect class).
//
// Run: bun porting/tests/token-hygiene.test.mjs   (exit 0 = pass)
//
// Pattern: real construction only, no module mocks, no mock.module.
// The fence reads the script sources from disk (like scope-floor's
// filesystem guards) — it pins the wiring convention, not a mock.

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAgentManifest, formatAgentRow, gitAuthEnv } from "../../platform/scripts/lib/tokens.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
 if (ok) pass++; else fail++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Leg 1 — mode law: fresh write 0600; pre-existing 0644 RE-MODED to 0600.
// ---------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "token-hygiene-"));
try {
 // 1a. fresh write → 0600, content round-trips.
 {
  const p = join(tmp, "fresh.json");
  writeAgentManifest(p, [{ name: "agent-1", token: "art_v1_secret", scope: "write", expires_at: "2026-10-11" }]);
  const mode = statSync(p).mode & 0o777;
  check("1a fresh manifest written 0600", mode === 0o600, `mode=${mode.toString(8)}`);
  const round = JSON.parse(readFileSync(p, "utf8"));
  check("1a manifest content round-trips", round[0].name === "agent-1" && round[0].token === "art_v1_secret");
 }

 // 1b. PRE-EXISTING 0644 file → rewritten AND re-moded to 0600.
 //     This is the verified finding: Node's {mode} only applies at
 //     create, so a naive writer leaves the 0644 in place.
 {
  const p = join(tmp, "existing.json");
  writeFileSync(p, JSON.stringify([{ name: "stale" }]), { mode: 0o644 });
  chmodSync(p, 0o644); // guarantee the 0644 state regardless of umask
  writeAgentManifest(p, [{ name: "agent-2", token: "art_v1_secret2", scope: "write", expires_at: "2026-10-12" }]);
  const mode = statSync(p).mode & 0o777;
  check("1b existing 0644 manifest re-moded to 0600 on rewrite", mode === 0o600, `mode=${mode.toString(8)}`);
  check("1b re-moded manifest content round-trips",
   JSON.parse(readFileSync(p, "utf8"))[0].name === "agent-2");
 }
} finally {
 rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Leg 2 — printer: name/expires_at present, token NEVER emitted.
// ---------------------------------------------------------------------------
{
 const row = formatAgentRow({ name: "agent-1", scope: "write", expires_at: "2026-10-11T00:00:00Z", token: "SUPERSECRET-art_v1_x" });
 check("2a formatAgentRow emits name", row.includes("agent-1"));
 check("2b formatAgentRow emits expires_at", row.includes("2026-10-11T00:00:00Z"));
 check("2c formatAgentRow never emits the token", !row.includes("SUPERSECRET"));
 check("2d formatAgentRow emits no art_v1_ material", !row.includes("art_v1_"));
}

// ---------------------------------------------------------------------------
// Leg 3 — runtime-pin fence (scope-floor / runtime-pin convention).
// Reads the script sources from disk; pins the wiring, not a mock.
// ---------------------------------------------------------------------------
const WRITERS = [
 "platform/scripts/fanout.mjs",
 "platform/scripts/agents.mjs",
 "platform/scripts/real-agents.mjs",
 "platform/scripts/secret-fixture.mjs",
];
const srcs = Object.fromEntries(WRITERS.map((f) => [f, read(f)]));
const allWriters = WRITERS.map((f) => srcs[f]).join("\n");
const allScripts = WRITERS
 .concat(["platform/scripts/reset-agent-1.mjs", "platform/scripts/seed.mjs"])
 .map((f) => read(f)).join("\n");

// 3a. every manifest writer routes through the shared helper — no bare
//     writeFileSync(OUT_FILE …) remains in any of the four.
for (const [f, src] of Object.entries(srcs)) {
 check(`3a ${f.split("/").pop()} routes its manifest through writeAgentManifest`,
  /writeAgentManifest\(OUT_FILE/.test(src) && !/writeFileSync\(OUT_FILE/.test(src));
}

// 3b. no script logs token material (the agents.mjs:301-302 finding).
for (const [f, src] of Object.entries(srcs)) {
 check(`3b ${f.split("/").pop()} logs no token material`,
  !/\.token\.slice/.test(src) && !/console\.log\([^)]*\bm\.token\b/.test(src) && !/console\.log\([^)]*\btok\.plaintext\b/.test(src));
}

// 3c. no git exec carries the token in argv (-c …extraHeader…Bearer).
{
 const argvLeak = /execFileSync\(\s*"git"[^)]*\[\s*"[^"]*"-c"[^)]*extraHeader[^)]*Bearer/.test(allScripts)
  || /"-c"\s*,\s*`http\.extraHeader=Authorization: Bearer/.test(allScripts);
 check("3c no git exec passes the token via -c argv (reset-agent-1 finding)", !argvLeak);
}

// 3d. the argv-leak script now routes through gitAuthEnv.
{
 const src = read("platform/scripts/reset-agent-1.mjs");
 check("3d reset-agent-1.mjs builds its git env via gitAuthEnv",
  /gitAuthEnv\(repoToken\)/.test(src) && /env:\s*gitEnv/.test(src));
}

// 3e. import-integrity — every helper each script's body references is
//     present in its imported bindings. node --check is parse-only and
//     cannot catch a used-but-unimported identifier (the heal-1 defects:
//     dropped writeFileSync / gitAuthEnv / writeAgentManifest / homedir).
//     Deterministic, network-free, no module mocks.
{
 // Identifiers a script must have imported if its body references them.
 const REQUIRED = [
  "writeFileSync", "readFileSync", "existsSync", "mkdirSync",
  "mkdtempSync", "rmSync", "statSync", "chmodSync",
  "homedir", "tmpdir",
  "join", "dirname",
  "execFileSync", "spawn",
  "mintRepoToken", "resolveTtl", "writeAgentManifest",
  "gitAuthEnv", "formatAgentRow",
 ];
 const importedBindings = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*"/g)) {
   for (const part of m[1].split(",")) {
    const binding = part.trim().split(/\s+as\s+/).pop()?.trim();
    if (binding) names.add(binding);
   }
  }
  return names;
 };
 // Reject word-char prefixes and property accesses (`obj.gitAuthEnv`),
 // but allow the spread form `...gitAuthEnv(...)` — the char before
 // the identifier is a dot in both, so reject only when that dot is
 // itself preceded by a word char (property) vs another dot (spread).
 const referenced = (src, id) =>
  new RegExp(`(?<![\\w])(?<!\\w\\.)${id}\\b`).test(src);
 const TITLED = [
  "platform/scripts/fanout.mjs",
  "platform/scripts/agents.mjs",
  "platform/scripts/real-agents.mjs",
  "platform/scripts/secret-fixture.mjs",
  "platform/scripts/reset-agent-1.mjs",
  "platform/scripts/seed.mjs",
 ];
 for (const f of TITLED) {
  const imported = importedBindings(read(f));
  const missing = REQUIRED.filter((id) => referenced(read(f), id) && !imported.has(id));
  check(`3e ${f.split("/").pop()} imports every helper it references`,
   missing.length === 0, `missing: ${missing.join(", ")}`);
 }
}
// ---------------------------------------------------------------------------
// Leg 4 — gitAuthEnv returns exactly the three GIT_CONFIG_* keys.
// ---------------------------------------------------------------------------
{
 const env = gitAuthEnv("art_v1_x");
 const keys = Object.keys(env).sort();
 check("4a gitAuthEnv returns exactly 3 keys", keys.length === 3, `keys=${keys.join(",")}`);
 check("4b gitAuthEnv keys are the GIT_CONFIG_* triple",
  keys[0] === "GIT_CONFIG_COUNT" && keys[1] === "GIT_CONFIG_KEY_0" && keys[2] === "GIT_CONFIG_VALUE_0");
 check("4c gitAuthEnv VALUE_0 carries the Bearer header",
  env.GIT_CONFIG_VALUE_0 === "Authorization: Bearer art_v1_x");
 check("4d gitAuthEnv COUNT/KEY are the single-config pair",
  env.GIT_CONFIG_COUNT === "1" && env.GIT_CONFIG_KEY_0 === "http.extraheader");
}

// ---------------------------------------------------------------------------
// Leg 5 — live (gated on CLOUDFLARE_API_TOKEN): a real fanout.mjs run
// leaves the manifest 0600. Mirrors fanout-token-lifecycle leg 2.
// ---------------------------------------------------------------------------
if (!process.env.CLOUDFLARE_API_TOKEN) {
 console.log("SKIP  5 live fanout (CLOUDFLARE_API_TOKEN not set)");
} else {
 const out = join(tmpdir(), `token-hygiene-live-${process.pid}.json`);
 try {
  chmodSync(out, 0o644);
  writeFileSync(out, "[]", { mode: 0o644 });
  const proc = Bun.spawnSync(["bun", join(ROOT, "platform/scripts/fanout.mjs"), "1"], {
   env: { ...process.env, AGENTS_OUT: out },
   stdout: "pipe", stderr: "pipe",
  });
  const mode = statSync(out).mode & 0o777;
  check("5 live fanout.mjs writes the manifest 0600", mode === 0o600 && proc.exitCode === 0,
   `mode=${mode.toString(8)} exit=${proc.exitCode} stderr=${proc.stderr.toString().slice(0, 200)}`);
 } finally {
  rmSync(out, { force: true });
 }
}

// ---------------------------------------------------------------------------
console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
