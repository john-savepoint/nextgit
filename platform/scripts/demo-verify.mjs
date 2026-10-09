#!/usr/bin/env node
// demo-verify.mjs — live-state acceptance check for the demo scenario reset.
//
// Read-only against the platform: GET /proposals, GET /changes, and one
// POST /judge (advisory — the route writes nothing and lands nothing).
// Idempotent and re-runnable; exits non-zero with a clear message per failure.
//
// Checks:
//   1. GET /proposals → ok:true, base.repo "demo"
//   2. ≥5 proposals; all expected repos agent-1..agent-5 present (tolerant of scratch)
//   3. ≥1 conflicting pair, incl. the deliberate agent-1 × agent-2 src/auth.ts
//   4. ≥4 proposals with a non-empty intent
//   5. no proposal landing.status === "landed" (the recording needs all-pending)
//   6. agent-5 schema-only surface: config/.env, secret:true, keys exactly
//      {DATABASE_URL, REDIS_URL}, no patch, no intent; no fixture value in any
//      fetched raw body (the masking law, executable)
//   7. POST /judge: agent-5 skipped reason "secret-class", never judged;
//      agent-1..4 all judged (no empty-change-set skips)
//
// Usage: node platform/scripts/demo-verify.mjs
// Output: PASS/FAIL report; exit code 1 on any failed check.

const PLATFORM = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";
const BASE = "demo";
const EXPECTED_REPOS = ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"];
const EXPECTED_KEYS = ["DATABASE_URL", "REDIS_URL"];
// The fixture's fake values — none may ever appear in a fetched body.
const LEAK_MARKERS = ["FAKE-SECRET-DO-NOT-USE", "postgres://demo", "db.internal", "cache.internal"];
const TIMEOUT_MS = 120_000; // observed /proposals latency up to ~40s

const checks = [];
const rawBodies = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

async function fetchJson(path, init = {}) {
  // This WSL2 box's connect latency to the Cloudflare edge occasionally
  // exceeds undici's ~10s connect budget (measured: ~7 transient failures in
  // one day, all pre-response). Retry before failing the gate — a connect
  // stall must never masquerade as a demo-state failure.
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${PLATFORM}${path}`, {
        ...init,
        headers: { "User-Agent": "nextgit-demo-verify/1", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      rawBodies.push({ path, text });
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // non-JSON — the status/ok checks report it
      }
      return { status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.log(`  (transient fetch failure on ${path} — attempt ${attempt}/3: ${err?.cause?.code ?? err?.message}; retrying)`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

async function main() {
  // ---- the set view ------------------------------------------------------
  const props = await fetchJson(`/proposals?base=${BASE}`);
  check("GET /proposals → 200 + ok:true", props.status === 200 && props.body?.ok === true, `status ${props.status} ${JSON.stringify(props.body?.error ?? "")}`);
  check("base repo is demo", props.body?.base?.repo === BASE, JSON.stringify(props.body?.base ?? null));

  const proposals = Array.isArray(props.body?.proposals) ? props.body.proposals : [];
  check("≥5 proposals", proposals.length >= 5, `got ${proposals.length}`);

  const repos = proposals.map((p) => p.repo).sort();
  // Tolerant of concurrent sibling-test scratch repos (agent-e4s-*, agent-lh-*, demo-lh-*):
  // verify all expected repos are present (subset) rather than an exact match.
  check(
    "expected agent-1..agent-5 all present",
    EXPECTED_REPOS.every((r) => repos.includes(r)),
    `got ${JSON.stringify(repos)}`,
  );

  // ---- each workspace head served independently, per-repo ------------------
  check(
    "every workspace head served independently, per-repo (/proposals)",
    Boolean(props.body?.base?.head) &&
    /^[0-9a-f]{40}$/.test(props.body.base.head) &&
    proposals.every((p) => typeof p.head === "string" && /^[0-9a-f]{40}$/.test(p.head)),
    `base.head=${String(props.body?.base?.head)} missing or malformed; ` +
    `proposals missing head: ${proposals.filter((p) => !p.head || !/^[0-9a-f]{40}$/.test(p.head)).map((p) => p.repo).join(",") || "none"}`,
  );

  const conflicts = Array.isArray(props.body?.conflicts) ? props.body.conflicts : [];
  const pairs = conflicts.flatMap((c) => (c.pairs ?? []).map((p) => ({ ...p, file: c.file })));
  const conflicting = pairs.filter((p) => p.conflict === true);
  check("≥1 conflicting pair", conflicting.length >= 1, `got ${conflicting.length}`);
  check(
    "deliberate collision present: agent-1 × agent-2 on src/auth.ts",
    conflicting.some(
      (p) =>
        p.file === "src/auth.ts" &&
        ((p.a === "agent-1" && p.b === "agent-2") || (p.a === "agent-2" && p.b === "agent-1")),
    ),
    JSON.stringify(conflicting.map((p) => `${p.file} ${p.a}×${p.b}`)),
  );

  const withIntent = proposals.filter((p) => typeof p.intent === "string" && p.intent.trim().length > 0);
  check(
    "≥4 proposals with a non-empty intent",
    withIntent.length >= 4,
    `got ${withIntent.length} (${withIntent.map((p) => p.repo).join(", ") || "none"})`,
  );

  const landed = proposals.filter((p) => p.landing?.status === "landed");
  check(
    "no landed proposal — all pending (recording requirement)",
    landed.length === 0,
    landed.map((p) => p.repo).join(", ") || "none landed",
  );

  // ---- agent-5: the schema-only surface ----------------------------------
  const a5 = proposals.find((p) => p.repo === "agent-5");
  const a5files = a5?.files ?? [];
  check("agent-5 present", Boolean(a5), "missing from /proposals");
  check(
    "agent-5 touches exactly config/.env",
    a5files.length === 1 && a5files[0]?.path === "config/.env",
    JSON.stringify(a5files.map((f) => f.path)),
  );
  const envRow = a5files.find((f) => f.path === "config/.env");
  check("agent-5 row is secret-class", envRow?.secret === true, JSON.stringify(envRow ?? null));
  check(
    "agent-5 keys are exactly DATABASE_URL + REDIS_URL",
    Array.isArray(envRow?.keys) && [...envRow.keys].sort().join() === [...EXPECTED_KEYS].sort().join(),
    JSON.stringify(envRow?.keys ?? null),
  );
  check(
    "agent-5 proposal carries no intent (secret-class law)",
    a5?.intent === undefined,
    JSON.stringify(a5?.intent ?? null),
  );

  const chg = await fetchJson(`/changes?repo=agent-5&base=${BASE}`);
  check("GET /changes (agent-5) → ok:true", chg.status === 200 && chg.body?.ok === true, `status ${chg.status} ${JSON.stringify(chg.body?.error ?? "")}`);
  const chgEnv = (chg.body?.changeSet?.files ?? []).find((f) => f.path === "config/.env");
  check(
    "agent-5 change-set has no patch (masking law)",
    Boolean(chgEnv) && !("patch" in chgEnv),
    JSON.stringify(Object.keys(chgEnv ?? {})),
  );
  check(
    "agent-5 change-set file carries no intent",
    Boolean(chgEnv) && !("intent" in chgEnv),
    JSON.stringify(chgEnv?.intent ?? null),
  );

  // ---- the judge ---------------------------------------------------------
  const judge = await fetchJson("/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setId: "v1", target: { base: BASE, repos: EXPECTED_REPOS, refs: ["main"] } }),
  });
  check("POST /judge → 200", judge.status === 200, `status ${judge.status} ${JSON.stringify(judge.body?.error ?? "")}`);
  check("judge model pinned @cf/cloudflare/clef", judge.body?.model === "@cf/cloudflare/clef", String(judge.body?.model));
  const skipped = Array.isArray(judge.body?.skipped) ? judge.body.skipped : [];
  const judgments = Array.isArray(judge.body?.judgments) ? judge.body.judgments : [];
  check(
    "agent-5 skipped with reason secret-class",
    skipped.some((s) => s.repo === "agent-5" && s.reason === "secret-class"),
    JSON.stringify(skipped),
  );
  check("agent-5 never judged", !judgments.some((j) => j.repo === "agent-5"), JSON.stringify(judgments.map((j) => j.repo)));
  check(
    "agent-1..4 all judged (no empty-change-set skips)",
    EXPECTED_REPOS.slice(0, 4).every((r) => judgments.some((j) => j.repo === r)) &&
    !skipped.some((s) => s.repo !== "agent-5"),
    JSON.stringify(skipped),
  );

  // ---- masking law: no fixture value in any fetched body -----------------
  for (const { path, text } of rawBodies) {
    const found = LEAK_MARKERS.filter((m) => text.includes(m));
    check(`no fixture value in ${path}`, found.length === 0, found.join(", "));
  }

  // ---- report ------------------------------------------------------------
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`);
  console.log("");
  console.log(`repos:      ${repos.join(", ")}`);
  console.log(`landings:   ${proposals.map((p) => `${p.repo}=${p.landing?.status ?? "?"}`).join(" ")}`);
  console.log(`conflicts:  ${conflicting.map((p) => `${p.file} ${p.a}×${p.b}`).join("; ") || "none"}`);
  console.log(`intents:    ${withIntent.length}/${proposals.length} (${withIntent.map((p) => p.repo).join(", ")})`);
  console.log(`judge:      judged=${judgments.map((j) => j.repo).join(",")} skipped=${JSON.stringify(skipped)}`);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\nDEMO VERIFY: FAIL — ${failed.length}/${checks.length} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nDEMO VERIFY: PASS — ${checks.length}/${checks.length} checks`);
  }
}

main().catch((err) => {
  console.error(`DEMO VERIFY: FAIL — ${err?.stack ?? err}`);
  process.exitCode = 1;
});
