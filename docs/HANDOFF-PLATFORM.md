# HANDOFF — the NextGit platform (authoritative for the production build-out)

**From:** the platform orchestrator session (built the demo stack: judge layer, land hardening, demo fleet, submission compliance).
**Date:** 2026-10-06. **Companion:** `docs/HANDOFF.md` (general loop-machinery handoff by the parallel session — good, but its platform row predates `/judge`, land hardening, and the demo reset; **this file is the authority for the platform**).

**What the platform is, in one breath:** agents work concurrently, each in its own Artifacts fork; the platform shows all their proposals as one set (intents, diffs, conflicts computed by *actually attempting the merge*), runs typed judgments (Cloudflare **Clef** on Workers AI), and lands a chosen proposal **server-side in one click** — with a secret-class masking law and an evidence record on every landing.

**Live:** `https://nextgit-platform.john-b7d.workers.dev` — `/` triage UI · `/tour.html` interactive tutorial. Namespace `nextgit`; demo repos `{demo, agent-1…agent-5}` (recording-ready: all pending, one real collision, judge chips live).

---

## 1. Inventory — what exists, where

| Artifact | Path | Notes |
|---|---|---|
| Worker API | `platform/src/index.ts` | Router + all endpoints; queue consumer; land/change-set machinery inline |
| Judge layer | `platform/src/judge.ts` | MASK/strip/scrub, budgeted state assembly, typed question plan, fail-closed validation, `JUDGE_SET_ID="v1"`, `COLLISION_MIN=0.5` |
| Landing engine | `platform/src/land.ts` | `pushLand` (isomorphic-git v1 push), `BaseMovedError`, pre-push re-read |
| Worker platform shims | `platform/src/{githttp.ts, memfs.ts, globals.ts}` | Hand-built fs + HTTP client for isomorphic-git inside workerd (Workers have no fs) |
| UI + tour | `platform/ui/{index.html, app.js, styles.css, tour.html, tour.js, tour.css}` | Vanilla ES modules, no build step; triage UI + 10-step interactive tour |
| API contract (of record) | `platform/CONTRACT.md` | **Read fully before touching any endpoint** — v3: fork-point semantics, `/land` hardening, `/judge`, notes-mirror recipe, masking law |
| Config | `platform/wrangler.jsonc` | Bindings: `ARTIFACTS` (namespace `nextgit`) · `AI` · `LIVE` (KV) · `ASSETS` (`./ui`); queue consumer `nextgit-events` |
| Demo scripts | `platform/scripts/` | `seed.mjs` (baseline) · `agents.mjs` (scripted) · `real-agents.mjs` (real CLI agents, resume-guarded) · `secret-fixture.mjs` (agent-5) · `demo-verify.mjs` (**the canonical live-state gate — 25 checks**) · `fanout.mjs` (fork+token provisioning) · `land.mjs` (CLI landing) |
| Suites/probes | `porting/tests/` | `judge.test.mjs` (73 checks) · `normalize.test.mjs` · `tasks.test.mjs` · `batch.test.mjs` · `land-hardening.probe.mjs` (**live**: scratch-only concurrency race) |
| Run evidence | `porting/runs/<order>/` (gitignored) | plan/implement/verify/gate-\*/heal-\*/result.json per wave — point-in-time snapshots |
| Certification | `porting/certifications/bootstrap-health-sweep.md` | Supersession + fail-closed re-execution record |
| Records | `docs/{STATE,CHECKPOINT,LOG,BUILD-LOG,status-index.json}`, `.omp/`, `porting/tasks.db` | CHECKPOINT = the full story, append-only |

## 2. Live deployment

- Worker `nextgit-platform`, deploy from `platform/` with the **lockfile-pinned** wrangler: `npx wrangler deploy` (global wrangler 4.106 lacks Artifacts commands — use `npx wrangler@latest` only for Artifacts CLI work).
- Current deployed version: **`69b59673`** (land hardening; judge wave was `0518de12`).
- Queue `nextgit-events` + subscription `nextgit-repo-events` (`repo.pushed`, `repo.forked`, `repo.created`) → worker consumer → KV `LIVE` feed (`/events`).
- Artifacts namespace `nextgit`; repos exactly `{demo, agent-1…agent-5}` in the demo state. **Namespace hygiene:** anything else (`*-e2v-*`, `*-lh-*`, `race-*`…) is scratch — do not leave strays; the pre-recording gate fails on extra `agent-*` repos by design.
- Deploy anchors: judge wave `239174b` · land hardening `f155f5d` (probe green on deployed artifact) · demo reset `2f53214` · compliance `8169aa2`+`20b027b`.

## 3. API surface (details in `platform/CONTRACT.md`)

| Endpoint | Method | Behavior / status codes |
|---|---|---|
| `/health` | GET | `{ok, service, namespace}` |
| `/changes?repo&base&ref&baseRef` | GET | Fork-point change-set per proposal: files + diffs computed **server-side via the binding (no clones)**; `intent` from the notes mirror; secret-class rows → `secret:true`+`keys[]`, **no patch, no intent** |
| `/proposals?base&repos` | GET | The set view: per-proposal stats/landing verdict + **conflict map** (pairwise diff3) + summary. Auto-discovers `agent-*` |
| `/merge?base&repos` | GET | Fold preview (diff3, in order) → clean/conflict per file; secret files `withheld-secret` |
| `/land` | POST | Fold + commit + push server-side. `409 stale` (reviewed heads mismatch), `409 base-moved` (pre-push re-read **and** push-rejection conversion), `409 conflict/withheld-secret/no-changes`, `403` allowlist, `429` rate limit; `200` carries **evidence** `{repos, commit, ancestor, heads, foldHash}` |
| `/judge` | **POST only** (GET → 404 by design) | `{setId:"v1", target:{base,repos,refs}}` → pinned `@cf/cloudflare/clef`, typed judgments `risk{label,score}` / `intent{verdict,overclaim}` / `collision` ; `skipped[]` (secret-class, empty-change-set) ; **fail-closed 503** (binding missing / model mismatch / schema invalid) ; 429 |
| `/events` | GET | Last 50 pushes from KV (queue consumer writes it) |
| `/harnesses` | GET | Federation manifest: the BYO harness table `{name,kind:"byo-cli",capabilities,docs}` — dispatch internals (bin/args/env/notes) never egress (egress law); namespace-wide, no params, `authorize()`-gated, deliberately unbound; `hosted` reserved (zero populated — no marketplace) |

## 4. Invariants the production build MUST preserve (each has an enforcement point + an evidence run)

1. **Fork-point change-sets** — a proposal's change-set is vs its *fork point* (first shared commit), not the moving base head. Enforced in `computeChangeSet`; regression story: `2f53214` era fork-point fix + `demo-verify` checks.
2. **Concurrency closure = server ref witness, not client timing.** Stale non-ff pushes are rejected by Artifacts itself (verified empirically, `race-witness` test); the push catch re-reads the head and converts rejection → `409 base-moved` (`index.ts:936–956`). The `500 push-failed` branch is for non-race failures only — **do not "fix" it to 409**. Live proof: `land-hardening.probe.mjs` (two parallel lands → exactly one 200 + one 409, winner verified on the ref).
3. **Secret law:** path-based classification (`.env*`/`*.pem`/`*.key`/`credentials.json`/`secrets.json`/`.dev.vars`/`secrets/`); values must never appear in any response — no patch, no merged text, no judge state; key names only. Judge egress passes the same mask law. Scope is *deliberately* path-driven; content-based detection is idea #11 in `docs/judge-layer-ideas.md`.
4. **Intent plumbing:** Artifacts' binding cannot resolve `refs/notes/*` — intents are read from a mirror branch. Push recipe (in CONTRACT): `git push origin main refs/notes/commits refs/notes/commits:refs/heads/nextgit-notes`. Watch the Artifacts changelog for native notes support.
5. **Evidence on every land** — `{repos, commit, ancestor, heads, foldHash}`; `commit` is the evidence reference. Keep it.
6. **Judge is advisory-only and fail-closed** — pinned model id echoed/normalized; mismatch → 503; question sets versioned by `setId` in `judge.ts`; no side effects ever. **Calibrate before gating actions on it**: measured sampling jitter ≈ ±0.4 on risk scores across identical calls; typed ≠ true.
7. **No clones in the review path** — UI and API read via bindings only. Keep it that way.
8. **Demo-grade guards are not auth.** The `/land` allowlist + in-isolate rate limits are demo guards (documented deviations). Production needs real authn/z + edge rate limiting + the trust-bundle work (SPEC CAP-8).
9. **UI cadences** — proposals 8 s, events 2 s, judge 30 s throttle. No SSE/WebSocket yet (the `poll-beat` row).
10. **Process:** one writer per file; commits only from the orchestrator at green gates; `bun scripts/status-index.mjs` must be current at commit (pre-commit hook enforces); never let a *masked* view get written back to disk (see §7 lesson).

## 5. How to verify everything (run these, in order)

```bash
# live-state gate (read-only; 25 checks; self-retrying fetch)
node platform/scripts/demo-verify.mjs                      # expect: DEMO VERIFY: PASS — 25/25

# concurrency probe (LIVE, scratch-only: creates+deletes demo-lh-base/agent-lh-1; never touches demo)
node porting/tests/land-hardening.probe.mjs                # expect: "PASS — land-hardening probe green"

# suites
bun porting/tests/judge.test.mjs                           # 73 checks
node porting/tests/normalize.test.mjs
bun porting/tests/tasks.test.mjs ; bun porting/tests/batch.test.mjs

# UI: open / and /tour.html in a browser; chips render ~7 s after load; no console errors
```

## 6. Known gaps / debt — the production TODO surface (ranked)

**HIGH — before any real-user exposure**
1. **No authn/z on the worker.** Everything is open; allowlist/rate limits are demo guards. Decide the identity model (SPEC CAP-8 trust bundle: signed agent identity, secret-typed files, provenance) before exposing.
2. **Rate limiting is in-isolate and advisory** (documented deviation mirroring `/judge`). Replace with the edge mechanism for production.
3. **No push transport** (polling only). SSE/WebSocket via Durable Objects is the next fidelity step (row: `poll-beat`).

**MEDIUM — before fleet scale**
4. `/proposals` recomputes full change-sets + conflicts per request. Cache/ETag/incremental before ~20 proposals.
5. Judge calibration: thresholds (`COLLISION_MIN`, risk labels) live in code and are un-calibrated on real data. Build a labeled sample before gating anything.
6. `tsc`: 4 pre-existing type errors in `platform/` (store row P2-4); `typescript` + `@types/node` devDeps are now installed.
7. Intent mirror fragility (see §4.4).
8. Runner semantics debt (store row `runner-standing-reds-block-semantics`): standing-red "highs" currently can't mechanically SHIP a gated wave.

**ROADMAP (spec'd, not built — do NOT assume they exist)**
9. Agent Office / any external client: the 11-entity client contract is `_bmad-output/specs/spec-next-git-platform/interface-contract.md`. Not implemented.
10. Game-asset tier: R2 chunking/locking/per-file ACLs (`stack.md`). Federation for Windows/GPU builds is a stated design boundary.
11. Fork community + intent router (design: `fork-community.md`). Repo browsing/issues/CI — explicitly out of scope by design.

## 7. Method + hard-won lessons (adopt these — they caught real bugs)

- **Waves:** freeze the contract first (AD-8) → one writer per file → run through the DDW runner (`porting/wf-template.ddw.js`: PLAN→IMPLEMENT→VERIFY→GATE(3 lenses)→HEAL≤3→REPORT) → orchestrator closes (deploy, probe, commit). Fresh-context verification is non-negotiable; it caught, across three waves: a NUL-injection in an artifact, **two fail-open verdict branches** in the runner (a "SHIP" carrying blockers could have shipped), and a **masked-write-back corruption** (below).
- **THE corruption lesson (tell every agent):** a heal agent read a file through the harness's *display masking*, then wrote its view back — baking mask-token bytes into `platform/src/index.ts`. Masked diffs hide exactly this (both sides render as tokens). Detect via `od`/blob-hash; repair from the git blob; never serialize a masked view to disk; when a diff touches security-relevant lines, verify bytes.
- **jq on this box is jaq:** `-c` exits 0 on empty/dead input — gate pipelines use `-ec`. Never ship a check whose failure-mode claim wasn't executed.
- **Scratch discipline:** probes create/delete their own scratch (`*-lh-*`); the demo namespace `{demo, agent-1…5}` is the recorded state. Namespace deletions happen only when the owner is known and quiet (one incident, recorded in CHECKPOINT).
- **Deploys:** lockfile wrangler from `platform/`; after any worker change re-run `demo-verify` + the land probe **on the deployed artifact** (the "reviewed tree = deployed tree" rule).

## 8. Read order for the production orchestrator

1. `platform/CONTRACT.md` — the API of record.
2. `platform/src/index.ts` → `judge.ts` → `land.ts` (the whole platform is ~this).
3. `docs/STATE.md` (spine) → this file → `docs/CHECKPOINT.md` (full story, newest first).
4. `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` — 15 ADs governing the build.
5. `_bmad-output/planning-artifacts/prds/...` — PRD FR-1..47 + milestones M1–M4 (what "production" means here).
6. `bun porting/tasks.mjs next` — the queue decides the next unit; claims guard collisions across sessions.
