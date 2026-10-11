#!/usr/bin/env node
// allowlist.probe.mjs — in-process probe for the demo repo allowlist
// enforced on EVERY base/repos param (FR-45 / AD-9).
//
// Run: node porting/tests/allowlist.probe.mjs   (exit 0 = pass)
//
// Self-contained: builds the real worker (platform/src/index.ts) to a
// temp .mjs via `bun build` (the source is TypeScript; plain node
// cannot import .ts, and the worker uses `using` declarations, so the
// bundle must be produced for a node-runnable target) then drives the
// REAL worker.fetch() through the real dispatcher against an in-memory
// env whose Artifacts get/list THROW ("should not be reached"). A 403
// that fails to fire therefore surfaces as 500 (the handler reached
// the binding), never as a silent pass — the probe asserts the per-route
// 403, the exact body, and zero Artifacts reads.
//
// This is the in-process form of auth-seam.test.mjs Group D: it carries
// the same observable contract and runs under plain `node` in any
// checkout, without a live worker. The live form is Group D re-run
// against NEXTGIT_PLATFORM_URL post-deploy (AUTH_MODE=demo):
//   GET /proposals?repos=notdemo-xyz  -> 403 repo-not-allowed (no proposals[])
//   same 403 for /changes, /merge, POST /judge, POST /land;
//   allowlisted demo / agent-* / demo-lh-* / agent-lh-* reads -> 200.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// Build the real worker to a node-runnable ESM bundle in a temp dir.
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..");
const workerTs = join(repoRoot, "platform", "src", "index.ts");
const tmp = mkdtempSync(join(tmpdir(), "nextgit-allowlist-probe-"));
const bundle = join(tmp, "worker.mjs");
try {
 execFileSync("bun", ["build", workerTs, "--target=node", "--outfile=" + bundle, "--format=esm"], { stdio: "pipe" });
} catch (e) {
 console.log(`FAIL  build worker via bun build — ${e.message}`);
 process.exit(1);
}

// Refuse to certify a stale bundle: the allowlist seam must be
// present in the ARTIFACT, not just in the source. A transient
// build-cache staleness once shipped HEAD's one-liner authorize()
// while the worktree carried the full chokepoint — every behavioral
// check would silently pass against the fresh source via bun's TS
// runtime, but the deployed bundle would lack the 403. Assert the
// seam markers are in the built bytes and that the as-built
// one-liner body is ABSENT before any behavioral check runs.
// (AuthorizeScope is a TS interface — erased at runtime by design;
// its presence is proven by `bun run type-check`, not by grepping
// the JS artifact.)
const bundleText = readFileSync(bundle, "utf8");
const seamOk =
 bundleText.includes("demoRepoDenial") &&
 (bundleText.match(/repo-not-allowed/g) ?? []).length >= 2 &&
 bundleText.includes("DEMO_REPO_RE") &&
 !bundleText.includes('resolveAuthMode(env)==="demo"?null:unauthorizedResponse()');
if (!seamOk) {
 console.log("FAIL  stale bundle: allowlist seam missing from build");
 process.exit(1);
}

const { default: worker } = await import(pathToFileURL(bundle).href);

// Throwing Artifacts: every allowlisted path that would read a repo 500s
// here, proving the 403 fired BEFORE any env.ARTIFACTS read. Reads are
// counted so the probe asserts "zero Artifacts reads" on the 403 paths.
let artifactReads = 0;
const ARTIFACTS = {
 get: async () => { artifactReads++; throw new Error("should not be reached — allowlist must reject before any repo read"); },
 list: async () => { artifactReads++; throw new Error("should not be reached"); },
};
const env = {
 ARTIFACTS,
 LIVE: { get: async () => undefined },
 CACHE: { get: async () => undefined, put: async () => { } },
 ASSETS: { fetch: async () => new Response("") },
 AI: { run: async () => null },
 AUTH_MODE: "demo",
};

const get = async (path, query = "") => {
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}${query}`), env, { waitUntil() { } });
 return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (path, body = null) => {
 const init = body === null ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env, { waitUntil() { } });
 return { status: res.status, body: await res.json().catch(() => null) };
};

const DENY403 = (r, name) =>
 r.status === 403 &&
 r.body?.ok === false &&
 r.body?.error === "repo-not-allowed" &&
 r.body?.detail === `repo "${name}" is outside the demo allowlist`;

// --- per-route 403 with the exact body, zero Artifacts reads -------------

{
 artifactReads = 0;
 const r = await get("/changes", "?repo=notdemo-xyz");
 check("/changes?repo=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("/changes 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await get("/changes", "?repo=agent-1&base=notdemo-base");
 check("/changes base variant → 403 names notdemo-base", DENY403(r, "notdemo-base"), `got ${r.status} ${J(r.body)}`);
 check("/changes base variant 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await get("/proposals", "?repos=notdemo-xyz");
 check("/proposals?repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("/proposals 403 body has no proposals key", r.body !== null && !("proposals" in r.body), `keys ${r.body ? Object.keys(r.body).join(",") : "null"}`);
 check("/proposals 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await get("/merge", "?base=demo&repos=notdemo-xyz");
 check("/merge?repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("/merge 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await post("/judge", { setId: "v1", target: { base: "demo", repos: ["notdemo-xyz"] } });
 check("POST /judge repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("POST /judge 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await post("/judge", { setId: "v1", target: { base: "notdemo", repos: ["agent-1"] } });
 check("POST /judge base=notdemo → 403 names notdemo", DENY403(r, "notdemo"), `got ${r.status} ${J(r.body)}`);
 check("POST /judge base-arm 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await post("/land", { base: "demo", repos: ["notdemo-xyz"], ref: "main", baseRef: "main" });
 check("POST /land repos=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("POST /land 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

{
 artifactReads = 0;
 const r = await post("/reveal", { repo: "notdemo-xyz", ref: "main", path: "config/.env", key: "DATABASE_URL" });
 check("POST /reveal repo=notdemo-xyz → 403 repo-not-allowed", DENY403(r, "notdemo-xyz"), `got ${r.status} ${J(r.body)}`);
 check("POST /reveal 403 fired with zero Artifacts reads", artifactReads === 0, `reads ${artifactReads}`);
}

// --- allowlisted names pass the chokepoint (reach the handler) -----------
// The throwing Artifacts fake then 500s — proving the 403 did NOT fire.
// Scratch chains demo-lh-* / agent-lh-* stay green.

{
 const r = await get("/changes", "?repo=agent-1");
 check("/changes?repo=agent-1 passes allowlist (not 403)", r.status !== 403, `got ${r.status} ${J(r.body)}`);
 const r2 = await get("/proposals", "?repos=demo-lh-base,agent-lh-1");
 check("/proposals scratch chain passes allowlist (not 403)", r2.status !== 403, `got ${r2.status} ${J(r2.body)}`);
}

// --- precedence: deny mode still 401s first (the 403 is demo-only) ------

{
 const denyEnv = { ...env, AUTH_MODE: undefined };
 const res = await worker.fetch(new Request("https://nextgit.invalid/changes?repo=notdemo-xyz"), denyEnv, { waitUntil() { } });
 const body = await res.json().catch(() => null);
 check("deny mode 401s before the allowlist (not 403)", res.status === 401 && body?.error === "unauthorized", `got ${res.status} ${J(body)}`);
}

rmSync(tmp, { recursive: true, force: true });

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
