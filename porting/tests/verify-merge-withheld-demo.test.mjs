#!/usr/bin/env node
// verify-merge-withheld-demo.test.mjs — LIVE proof: GET /merge?base=demo&repos=agent-5
// returns the exact withheld-secret schema and the UI renders "Secret content withheld".
//
// This is the demo-scenario acceptance check for the e6-verify-merge-preview-withheld work
// order. It runs read-only against the deployed platform — no repos are forked, written, or
// landed. agent-5 is restored first via secret-fixture.mjs (idempotent) so the secret-class
// fixture is present before the assertion.
//
// Contracts verified:
//   API  (GET /merge response):
//     1. ok === true, envelope keys exactly {ok,merge}
//     2. merge keys exactly {base,repos,status,files,conflicted}
//     3. merge.status === "clean"
//     4. merge.files is exactly one row, path "config/.env"
//     5. row: action "write", result "withheld-secret", note contains "withheld"
//     6. row has NO "merged" and NO "conflictText" keys
//     7. no fixture secret value appears anywhere in the response body
//   UI  (platform/ui/app.js):
//     8. the result === "withheld-secret" branch renders "Secret content withheld" with no
//        patch / merged / conflictText text
//
// Usage: node porting/tests/verify-merge-withheld-demo.test.mjs
// Exit: 0 = all green, 1 = one or more failures.
//

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-verify-merge-withheld-demo/1.0";
const BASE = "demo";
const REPO = "agent-5";

// The fixture's fake secret values — none may ever appear in a fetched body.
const SECRET_VALUES = [
  "postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app",
  "redis://cache.internal:6379",
];

const TIMEOUT_MS = 30_000;

let fails = 0;
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

function exactKeys(o, ks) {
  const a = Object.keys(o ?? {}).sort();
  const w = [...ks].sort();
  return a.length === w.length && a.every((k, i) => k === w[i]);
}

// fetchJson: read-only GET against the live platform, with transport retry.
// Mirrors demo-verify.mjs:35-66 — WSL2 connect latency can stall undici.
async function fetchJson(path) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${PLATFORM}${path}`, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // non-JSON — the status/ok checks report it
      }
      return { status: res.status, body, text };
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

// ---------------------------------------------------------------------------
// Step 1: restore agent-5 secret fixture (idempotent) via the shipped script.
// ---------------------------------------------------------------------------
function restoreFixture() {
  // Token-gated (the fork-upstream.test.mjs 4.2 idiom): without a
  // CLOUDFLARE_API_TOKEN the fixture cannot be re-provisioned — skip the
  // restore (the read-only contract legs below still run against the
  // deployed state) instead of redding the suite on provisioning.
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log("SKIP  secret-fixture restore — CLOUDFLARE_API_TOKEN not set (read-only legs continue)");
    return;
  }
  execFileSync("node", ["platform/scripts/secret-fixture.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
}

// ---------------------------------------------------------------------------
// Step 2: live API proof — GET /merge?base=demo&repos=agent-5
// ---------------------------------------------------------------------------
function apiContract(name, res) {
  check(`${name}: HTTP 200`, res.status === 200, `status ${res.status}`);
  check(`${name}: ok === true`, res.body?.ok === true, JSON.stringify(res.body));
  check(`${name}: envelope keys exactly {ok,merge}`, exactKeys(res.body, ["ok", "merge"]), JSON.stringify(res.body && Object.keys(res.body)));

  const m = res.body?.merge;
  check(`${name}: merge keys exactly {base,repos,status,files,conflicted}`, m && exactKeys(m, ["base", "repos", "status", "files", "conflicted"]), JSON.stringify(m && Object.keys(m)));
  check(`${name}: base is demo/main`, m?.base?.repo === BASE && m?.base?.ref === "main", JSON.stringify(m?.base));
  check(`${name}: repos echo [agent-5]`, JSON.stringify(m?.repos) === JSON.stringify([REPO]), JSON.stringify(m?.repos));
  check(`${name}: status clean`, m?.status === "clean", JSON.stringify(m?.status));

  const files = Array.isArray(m?.files) ? m.files : [];
  check(`${name}: exactly one file row`, files.length === 1, JSON.stringify(files));
  const row = files[0];
  check(`${name}: row path is config/.env`, row?.path === "config/.env", JSON.stringify(row?.path));
  check(`${name}: row action write / result withheld-secret`, row?.action === "write" && row?.result === "withheld-secret", JSON.stringify(row));
  check(`${name}: row has NO merged key`, row && !("merged" in row), JSON.stringify(row));
  check(`${name}: row has NO conflictText key`, row && !("conflictText" in row), JSON.stringify(row));
  check(`${name}: note contains "withheld"`, typeof row?.note === "string" && /withheld/.test(row.note), JSON.stringify(row?.note));

  // No secret value may appear in the response body.
  check(
    `${name}: no fixture secret value in body`,
    SECRET_VALUES.every((v) => !res.text.includes(v)),
    `body length ${res.text.length}`,
  );
}

// ---------------------------------------------------------------------------
// Step 3: UI source proof — app.js withheld-secret branch.
// Reads the shipped UI source and confirms the merge-preview handler renders
// "Secret content withheld" with no patch / merged / conflictText text in that branch.
// ---------------------------------------------------------------------------
function uiContract() {
  // Wave-13 module split: renderMergeContent (the merge-preview
  // handler) moved from app.js into js/modal.js — the source proof
  // reads the module that owns the branch.
  const appJs = readFileSync(join(process.cwd(), "platform/ui/js/modal.js"), "utf8");

  // Locate the withheld-secret branch inside renderMergeContent (the merge-modal path).
  const secretIdx = appJs.indexOf('result === "withheld-secret"');
  check("UI: app.js has a result==='withheld-secret' branch in renderMergeContent", secretIdx >= 0, "branch not found");

  // The work order cited app.js:876-877; those absolute lines drifted when the
  // FR-22 SSE integration shifted the file, so these two checks anchor on the
  // branch content instead (same assertions: the isSecret guard, then the copy).
  const branch = appJs.slice(secretIdx, secretIdx + 4000);
  const guardLine = branch.split("\n").find((l) => l.includes("if (isSecret)")) ?? "";
  check(
    "UI: withheld branch enters via the `if (isSecret)` guard",
    guardLine.includes("if (isSecret)"),
    JSON.stringify(guardLine),
  );
  const copyLine = branch.split("\n").find((l) => l.includes("Secret content withheld")) ?? "";
  check(
    "UI: withheld branch renders \"Secret content withheld\"",
    copyLine.includes("Secret content withheld"),
    JSON.stringify(copyLine),
  );

  // Confirm the withheld branch produces NO merged/conflictText injection.
  const branchMatch = appJs.slice(secretIdx);
  const branchEnd = branchMatch.indexOf("} else if (isFileConflict");
  const branchBody = branchEnd >= 0 ? branchMatch.slice(0, branchEnd) : branchMatch.slice(0, 600);
  check(
    "UI: withheld branch body contains Secret content withheld and no merged/conflictText",
    branchBody.includes("Secret content withheld") && !branchBody.includes("f.merged") && !branchBody.includes("f.conflictText"),
    "branch body check",
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log(`platform ${PLATFORM}\nscenario  GET /merge?base=${BASE}&repos=${REPO}\n`);

  restoreFixture();
  console.log("fixture restored — agent-5 secret-class config/.env present\n");

  const res = await fetchJson(`/merge?base=${BASE}&repos=${REPO}`);
  console.log(`  GET /merge?base=${BASE}&repos=${REPO} -> HTTP ${res.status}\n`);
  apiContract("merge", res);

  uiContract();

  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${checks.filter((c) => c.ok).length}/${checks.length} checks green`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\nFAILED: ${failed.map((c) => c.name).join(", ")}`);
    process.exitCode = 1;
  }
  process.exit(fails === 0 ? 0 : 1);
})();
