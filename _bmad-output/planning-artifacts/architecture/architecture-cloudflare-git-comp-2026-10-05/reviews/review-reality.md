# Reality & version verification review — NextGit architecture spine

Lens: version/reality — every committed decision must be web-researched or reality-checked, not asserted from training data.
Reviewer: ReviewReality · Date: 2026-10-06 · Read-only (no repo edits; checks reproduced or cited)
Target: `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`

Evidence base: `platform/package.json` + installed `platform/node_modules/*/package.json` · `platform/wrangler.jsonc` · `platform/src/*` · `platform/worker-configuration.d.ts` · `docs/CHECKPOINT.md` · `docs/STATE.md` · `docs/judge-layer-ideas.md` · spec package (`stack.md`, `SPEC.md`) · research dossier (`technical-next-gen-git-platform-on-cloudflare-2026-10-02/`, incl. `staleness-claims.json`, `verification-r1.md`) · npm registry (`npm view … version time`) · `npm audit` · live worker smoke (`/health`, `/proposals`) · Cloudflare docs + blog + wrangler CLI/changelog · isomorphic-git release notes · Workers AI model pages.

---

## Verdict

**PASS with corrections.** Every pinned dependency version in the Stack table is the current npm `latest` as of 2026-10-06; Artifacts is confirmed in open beta with the `ARTIFACTS`/`nextgit` binding matching `wrangler.jsonc`; Queues, KV, Durable Objects, Workflows and R2 all exist and fit their assigned roles; the Clef model ids are exact and current; the compat-date / no-`nodejs_compat` choice matches platform code exactly; the harness model route is confirmed in `task.agentModelOverrides`. One factual error (MEDIUM) and one stale stack-table entry (LOW) are worth fixing before this spine is frozen.

---

## Findings

### MEDIUM — Stack table's wrangler parenthetical is false: "Artifacts commands require ≥4.147"

**Where:** `ARCHITECTURE-SPINE.md:162` — `| wrangler | ^4.147.0 (Artifacts commands require ≥4.147) |`

**What is actually true (primary sources, checked 2026-10-06):**
- `wrangler artifacts` commands were added long before 4.147: workers-sdk PR #13670, changelog section `## 4.92.0`, npm publish **2026-05-15**.
- The only 4.14x Artifacts change is the *label*: PR #15992 (changelog `## 4.146.0`, npm 2026-10-01) marks `wrangler artifacts` as open beta — "no longer display a 'private beta' label in help output and warnings".
- **4.147.0 (2026-10-02) contains no Artifacts-related changes at all** (containers/workflows fixes only).
- The Artifacts *binding* in `wrangler.jsonc` has been supported since 4.84.0 (PR #13326) — the live worker deploys on that binding today.
- Direct counter-evidence to the "needs ≥4.147" idea: the host's global wrangler **4.106.0** already carries the commands (`wrangler artifacts --help` → "Manage Artifacts namespaces and repos [private beta]").

**Corroborating context:** the same confusion is recorded in `docs/CHECKPOINT.md:34` and `.omp/agents.md:20` ("global wrangler 4.106 lacks them") — which the 4.106.0 CLI itself disproves; the carry was evidently about the open-beta *label* / a stale global at the time, not about command availability.

**Impact:** the frozen stack table overstates the minimum version and misattributes the 4.147.0 pin; anyone preparing an environment or reproducing the toolchain from the spine would wrongly believe 4.92–4.146 cannot run Artifacts commands.

**Suggested fix:** replace the parenthetical with the verified statement — e.g. "latest; `wrangler artifacts` commands since 4.92.0, marked open beta since 4.146.0" — and correct the carry note in `docs/CHECKPOINT.md` / `.omp/agents.md`.

### LOW — `memfs ^4.80.0` is listed as a pinned runtime dependency but no code imports it

**Where:** `ARCHITECTURE-SPINE.md:170` — `| memfs | ^4.80.0 |` (also `platform/package.json:16`)

**Evidence:** an exhaustive search across `platform/` (`src/`, `scripts/`, `ui/`) finds **no import of the npm `memfs` package anywhere**. The worker's filesystem is the hand-rolled in-tree shim `platform/src/memfs.ts` (imported by `land.ts:14`), whose header states the off-the-shelf package "pulls in `node:` builtins that cannot be bundled for the Workers runtime". The dependency is installed (4.80.0, current) and dead.

**Impact:** AD-13 pins dependencies "per the Stack table"; the table asserts a runtime component the runtime does not use, and a future unit following the stack table could import `memfs` and hit exactly the bundling failure the module header warns about.

**Suggested fix:** drop the `memfs` row from the Stack table and the dependency from `platform/package.json`, or annotate it explicitly as unused / superseded by the in-tree shim.

---

## Verified claims (reproduced or cited; checked 2026-10-06)

| Spine claim (line) | Status | Evidence |
|---|---|---|
| wrangler ^4.147.0 (L162) | ✅ version | npm `latest` = 4.147.0 (publ. 2026-10-02); installed 4.147.0 — the *parenthetical* is wrong (finding above) |
| isomorphic-git ^1.43.0, "v1 wire protocol" (L167) | ✅ | npm latest = 1.43.0 (2026-10-03); `_push` discovers receive-pack with `protocolVersion: 1`; Artifacts docs: push = v1 only, clone/fetch = v1+v2, v2 receive-pack "Not supported"; `npm audit` = 0 vulnerabilities |
| node-diff3 ^3.2.1 (L168) | ✅ | npm latest = 3.2.1 (2026-06-03); imported in `src/index.ts:17` |
| diff ^9.0.0 (L169) | ✅ | npm latest = 9.0.0 (2026-04-13); imported in `src/index.ts:16` |
| memfs ^4.80.0 (L170) | ⚠️ | npm latest = 4.80.0 (2026-09-29) but unused (finding above) |
| buffer ^6.0.3 (L171) | ✅ | npm latest (2023-07-22, stable); installed as the Worker `Buffer` global in `src/globals.ts` |
| Artifacts open beta · binding `ARTIFACTS` · namespace `nextgit` (L163) | ✅ | Cloudflare blog "build the next Git platform" (Artifacts open beta, Workers bindings, event subscriptions); `wrangler artifacts --help` = "[open beta]"; `wrangler.jsonc` binding/namespace match; live `/health` → `namespace:"nextgit"` |
| Queues `nextgit-events`, KV `LIVE` (L164–165) | ✅ | `wrangler.jsonc` consumer + KV namespace; docs live; live worker serving |
| DO / Workflows / R2 exist and fit AD-10 roles (AD-10) | ✅ | product docs live (200s); in-scope-not-yet-bound, exactly as the spine records |
| Clef ids `@cf/cloudflare/clef` · `@cf/cloudflare/clef-flash` (L166) | ✅ | Workers AI launch 2026-10-01; model pages name both ids exactly; `docs/judge-layer-ideas.md` records a live call 2026-10-04; `AI` binding not yet configured (judge is queue P0 — as the spine records) |
| Compose: compat date 2026-09-01, no `nodejs_compat`, shims in-tree (L161, AD-13) | ✅ | `wrangler.jsonc`: `compatibility_date: "2026-09-01"`, no `compatibility_flags`; zero `node:` imports in `platform/src`; Buffer shim (`globals.ts`) + fs shim (`memfs.ts`); bundled workerd 1.20261001.1 accepts the date; deployed live |
| CPU budget "30 s default, 5 min max" (AD-2) | ✅ | Cloudflare Workers limits: "CPU time per HTTP request … 5 min (default: 30 seconds)" |
| Binding reads `readFile`/`readCommit`/`readTree`/`readBlob` (AD-2) | ✅ | present in generated `worker-configuration.d.ts:11107-11182` (ArtifactsRepo, workerd types); used by the live worker |
| Node ≥20 host; bun for `scripts/status-index.mjs` (L172) | ✅ | host Node v22.14.0; bun 1.3.14; `status-index.mjs` shebang `#!/usr/bin/env bun` |
| Loop agent route `commandcode/deepseek/deepseek-v4.1-flash` (L173) | ✅ (note) | `task.agentModelOverrides`: 16/16 agents = `commandcode/deepseek/deepseek-v4.1-flash:max` (model present in catalog; this session runs on it). Spine records the base route; `:max` is the configured thinking-level modifier |
| Live demo `nextgit-platform.john-b7d.workers.dev` (L177) | ✅ | `/health` → `{ok:true,service:"nextgit-platform",namespace:"nextgit"}`; `/proposals` → HTTP 200 |
| Artifacts events → single queue consumer; KV ≤50 events (AD-6) | ✅ | `wrangler.jsonc` consumer `nextgit-events` (max_batch 10); spec `stack.md` records queue + subscription; KV single key `recent` |

---

## Notes / watch list (not findings)

- **Deploy procedure vs pin:** the spine records deployment via `npx wrangler@latest deploy` while the repo pins `wrangler ^4.147.0`; deploys are therefore not pinned to the stack's CLI. Deliberate and documented, but worth one line about which CLI produced the live version if reproducibility matters.
- **Research dossier staleness:** the dossier's own staleness map flags an already-due mechanical re-check (earliest window 2025-10-01); nothing in the spine uniquely depends on the expired claims, but the re-check is still outstanding.
- **Judge layer is target-state:** "logged per response", fail-closed, and the `AI` binding are rules for the not-yet-wired judge (P0 queue) — consistent with the spine marking AD-11 as `[NEW]`.
- **Save Point SSO** is internal-only and not externally verifiable; recorded as the future IdP at the auth seam (fine at this altitude).
- Version set re-check cadence: all six packages moved within the last 30 days except buffer/diff; if the spine is frozen for the competition window, no re-pin is currently required (checked 2026-10-06).
