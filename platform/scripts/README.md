## Operator runbook — Demo scripts

Reproducible operator path for the end-to-end NextGit demo on **real** Cloudflare Workers + Artifacts — no mocks, no stubs. Every script pushes to live branches and lands against the live platform worker. This is the operator's companion to the high-level "Run it yourself" section in the repo root [`README.md`](../../README.md); this document is the detailed operations manual.

**Heads up — prerequisites first.** This runbook operates on a live, paid Cloudflare account with Artifacts enabled. Each step mints repo-scoped tokens from your wrangler OAuth session (see [Authentication](#authentication)). Never commit or paste those tokens.

---

## Prerequisite environment

Six environment variables drive the script chain. All have sensible defaults pointing at the **competition demo environment** (account `bb7d292ca65ba01cbdfbdabcace0c3d0`, worker `nextgit-platform.john-b7d`). Override both to redirect the entire chain to your own account.

| Variable | Default | Purpose | Scripts |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `bb7d292ca65ba01cbdfbdabcace0c3d0` | The Cloudflare account hosting the Artifacts namespace | all |
| `NEXTGIT_PLATFORM` | `https://nextgit-platform.john-b7d.workers.dev` | The live platform worker base URL | demo-verify.mjs L23, land.mjs L16, real-agents.mjs L23 |
| `CLOUDFLARE_API_TOKEN` | _(unset — falls back to wrangler OAuth)_ | Explicit API token; if unset, scripts read the wrangler OAuth config at `~/.config/.wrangler/config/default.toml` or `~/.wrangler/config/default.toml` | all |
| `ARTIFACTS_NAMESPACE` | `nextgit` | The Artifacts namespace name | all |
| `NEXTGIT_BASELINE` | `demo` | The baseline repo each proposal forks from | land.mjs L17 |
| `AGENTS_OUT` | `/tmp/nextgit-agents.json` | Shared fleet manifest (fork tokens + remotes) | all |

Operational knobs (real-agents.mjs only):

- `REAL_AGENTS_ROOT` — default `/tmp/real-agents` (clones + per-agent logs + `report.md`).
- `AGENT_TIMEOUT_MS` — default `480000` (8 min per agent CLI).
- `SERIAL_RETRY` — default `1` (enabled). Set `SERIAL_RETRY=0` to disable serial retry of starved agents.

**Portability law.** A fresh runner must set the first two (`CLOUDFLARE_ACCOUNT_ID` + `NEXTGIT_PLATFORM`) to redirect the whole chain to their own account before running. `land.mjs` reads `NEXTGIT_PLATFORM` first, falling back to `NEXTGIT_WORKER` for backwards compat.

---

## Authentication & token handling

All scripts resolve the Cloudflare API token via the same `apiToken()` helper:

1. If `CLOUDFLARE_API_TOKEN` is set in the environment, use it directly.
2. Otherwise, read the wrangler OAuth config file (`~/.config/.wrangler/config/default.toml`, then `~/.wrangler/config/default.toml`) and extract the `oauth_token`.
3. If neither yields a token, throw `Error("No API token: set CLOUDFLARE_API_TOKEN or run wrangler login.")`.

**Token scope.** The API token is used only for two control-plane operations: (a) forking and deleting repos, and (b) minting short-lived **repo-scoped write tokens** via `POST …/artifacts/namespaces/{namespace}/tokens`. Those repo tokens ride an HTTP extra-header (`http.extraHeader`), never argv — a wrangler OAuth refresh on 401 is attempted by `real-agents.mjs` (L83-94) via `wrangler whoami` before retrying; the other scripts (seed, secret-fixture, land, demo-verify) do **not** auto-refresh and will surface a token-expiry error for the operator to re-authenticate.

**Security reminder (spoofing law).** Tokens are single-use-scoped (`{ repo, scope: "write", ttl }`), minted per run, and never committed. If you see a token in a transcript or log, treat it as exposed and revoke it.

---

## The corrected run order

The canonical demo chain is a strict 4-step gate sequence (`docs/CHECKPOINT.md:51`, root `README.md:37-43`):

```
node platform/scripts/seed.mjs            # (0) baseline
node platform/scripts/real-agents.mjs     # (1) REAL CLI agents
node platform/scripts/secret-fixture.mjs  # (2) agent-5 secret fixture
node platform/scripts/demo-verify.mjs     # (3) TERMINAL pre-recording gate
```

| Step | Script | What it does |
|---|---|---|
| 0 | `seed.mjs` | Writes the 4-file TS service skeleton to `demo` |
| 1 | `real-agents.mjs` | Forks `agent-1..4`, dispatches real CLI agents |
| 2 | `secret-fixture.mjs` | Drops + re-forks `agent-5`, writes `config/.env` |
| 3 | `demo-verify.mjs` | 25-check live-state acceptance gate (25/25) |

**`agents.mjs` is NOT in this chain.** It is a scripted alternative that applies deterministic text transforms — useful for dry runs when no agent CLIs are available, but the canonical demo uses real CLI agents via `real-agents.mjs`.

---

## Step 0 — Deploy the platform worker

Before any demo script can run, the platform worker must be live and reachable at `NEXTGIT_PLATFORM`.

```bash
cd platform
npx wrangler login
npx wrangler deploy
```

The worker requires all of the following bindings (configured in `platform/wrangler.jsonc`):

- `ARTIFACTS` binding — namespace `nextgit` (the versioned-storage substrate for `demo` + `agent-1..5`).
- `AI` binding — for the Clef judge layer (`POST /judge`).
- `LIVE` and `CACHE` — two KV namespaces.
- `LAND_LEASE` — Durable Object (`LandLeaseDO` class) serializing concurrent `/land` calls per base repo.
- `nextgit-events` — the Queues consumer that fans push events into the live UI.
- `./ui` — static assets directory (triage canvas + tour).

**Verify the deploy before proceeding:**

```bash
curl -sS "$NEXTGIT_PLATFORM/health" | jq .
```

Expected response:

```json
{ "ok": true, "service": "nextgit-platform", "namespace": "nextgit" }
```

If any of `ok`, `service`, or `namespace` is missing or non-200, the worker is not correctly bound. Re-check `wrangler.jsonc`, run `wrangler tail`, and resolve the deploy error before continuing.

---

## Step 1 — seed.mjs (baseline)

Establishes the `demo` baseline that every proposal forks from and diffs against.

```bash
node platform/scripts/seed.mjs
```

- Writes four files to the `demo` repo's `main` branch: `src/auth.ts`, `src/store.ts`, `src/api.ts`, `src/server.ts` — a coherent, dependency-free TS service skeleton.
- Commit message: `baseline v3: service skeleton`.
- **Idempotent:** if the current `demo/main` already matches (no porcelain output from `git status`), it prints `no change in demo — baseline already current (<sha>)` and exits 0.
- **Safety:** this is the **only** script that writes to `demo`. All other scripts fork from `demo` and write only to `agent-*` repos.

**Expected output:**

```
wrote  src/auth.ts
wrote  src/store.ts
wrote  src/api.ts
wrote  src/server.ts

baseline v3: service skeleton -> demo/main @ <7-hex-sha>
```

---

## Step 2 — real-agents.mjs (REAL CLI agents)

Drives up to four real AI coding-agent CLIs (codex, omp, etc.) in independent forks of `demo`.

```bash
node platform/scripts/real-agents.mjs
```

**CLI validation.** Before dispatch, each candidate CLI is probed: it must create a `hello.txt` file in a throwaway scratch dir. The probe checks the artifact **on disk**, not the CLI's self-reported exit code — a CLI that cannot write files is marked `unusable` and never dispatched.

**The four tasks** (deliberately overlapping — agent-1 and agent-2 both rewrite `src/auth.ts`):

| Agent | Preferred CLI | Task |
|---|---|---|
| `agent-1` | codex | Add `refreshSession(session, ttlMs)` to `src/auth.ts` |
| `agent-2` | omp | Give `isExpired` an optional `leewayMs` parameter |
| `agent-3` | omp | Add `getCached(key, compute)` memo cache to `src/store.ts` |
| `agent-4` | codex | Add `src/feature.ts` with `isEnabled(flag)` |

**Fallback behavior.** If a task's preferred CLI is unavailable, the task is reassigned to any proven-usable CLI rather than being skipped — a codex usage limit degrades the run, it does not halve it.

**Exit code.** The script exits 0 if **≥2** agents pushed a proposal; exits 1 otherwise. This threshold accepts a degraded run (e.g., one CLI fully unavailable) while requiring at least a pair to exercise the conflict-detection path.

**Scratch outputs:**

- `/tmp/real-agents/report.md` — merged report with CLI status table, per-agent results, patches, and platform verification.
- `/tmp/real-agents/<agent>.log` and `.log.err` — per-agent stdout/stderr.
- `/tmp/real-agents/runs.json` — last-known result per agent (for `--only` retries).
- `/tmp/nextgit-agents.json` — fleet manifest (`[{ name, remote, token, ... }]`).

---

## Step 3 — secret-fixture.mjs (agent-5)

The secret-class fixture. Drops and re-forks `agent-5` from the current `demo` head, writes exactly one file (`config/.env`) with two fake placeholder lines, and commits with an intent note.

```bash
node platform/scripts/secret-fixture.mjs
```

**The fixture content** (`config/.env`):

```
DATABASE_URL=postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app
REDIS_URL=redis://cache.internal:6379
```

These values are fake by design. The platform's path-driven masking law (CONTRACT "Secret classes") must ensure they **never** appear in any response body — only the key names (`DATABASE_URL`, `REDIS_URL`) surface.

**Idempotent/deterministic.** The script pins commit metadata via `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` (`PINNED_DATE` in source), so the same `demo` head + same content + same metadata yields the same commit SHA.

**MUST NOT:**

- Push to `demo` or any repo other than `agent-5`.
- Call `POST /land`.
- Print repo tokens.

**What it pushes.** Three refspecs in one git push: `main`, `refs/notes/commits`, and `refs/heads/nextgit-notes` — the notes mirror that carries the commit's intent record (CONTRACT "Notes mirror"). The `agent-5` row must render **schema-only** (keys only, no intent, no patch) on every platform route.

**Expected output:**

```
forked agent-5 <- demo
wrote  config/.env (2 lines, keys: DATABASE_URL, REDIS_URL)
pushed  main + refs/notes/commits + refs/heads/nextgit-notes @ <8-hex>
note    "Config: add local dev environment file" (must NOT surface as intent — secret-class law)
manifest -> /tmp/nextgit-agents.json (5 agents)
```

---

## Step 4 — demo-verify.mjs (TERMINAL pre-recording gate)

The state gate. Read-only against the platform: `GET /proposals`, `GET /changes`, and one advisory `POST /judge`.

```bash
node platform/scripts/demo-verify.mjs
```

**Exit 0 (PASS)** = the demo state is correct and ready for recording. **Exit 1 (FAIL)** = at least one of 25 checks failed.

### The 25 checks

The 25 checks break down as **22 explicit `check()` calls** + **3 loop-generated checks** (one per fetched raw body, for the leak-marker scan):

**Set view — `/proposals` (L70-73, 3 checks):**

1. `GET /proposals → 200`
2. `GET /proposals → ok:true`
3. `base repo is demo`

**Proposal set (L76-97, 7 checks):**

4. `≥5 proposals`
5. `exactly agent-1..agent-5 discovered (6 repos incl. demo)`
6. `≥1 conflicting pair`
7. `deliberate collision present: agent-1 × agent-2 on src/auth.ts`
8. `≥4 proposals with a non-empty intent`

**All-pending gate (L106-108, 1 check):**

9. `no landed proposal — all pending (recording requirement)`

**Agent-5 schema-only surface (L116-133, 6 checks):**

10. `agent-5 present`
11. `agent-5 touches exactly config/.env`
12. `agent-5 row is secret-class`
13. `agent-5 keys are exactly DATABASE_URL + REDIS_URL`
14. `agent-5 proposal carries no intent (secret-class law)`

**Agent-5 change-set masking (L135-137, 3 checks):**

15. `GET /changes (agent-5) → ok:true`
16. `agent-5 change-set has no patch (masking law)`
17. `agent-5 change-set file carries no intent`

**The judge (L150-158, 5 checks):**

18. `POST /judge → 200`
19. `judge model pinned @cf/cloudflare/clef`

**Agent-5 judge skip (L159-170, 3 checks):**

20. `agent-5 skipped with reason secret-class`
21. `agent-5 never judged`
22. `agent-1..4 all judged (no empty-change-set skips)`

**Masking law — leak-marker scan (L172-176, 3 loop checks):**

23–25. One per fetched body (`/proposals`, `/changes?repo=agent-5&base=demo`, `/judge`): `no fixture value in <path>`.

The `LEAK_MARKERS` tested are: `FAKE-SECRET-DO-NOT-USE`, `postgres://demo`, `db.internal`, `cache.internal` — if any of these four strings appears in any fetched response body, the corresponding check fails.

### Transport flake retry

`/proposals` latency is observed up to ~40s against the Cloudflare edge. The `fetchJson` helper retries transient failures 3 times with backoff (`1500 * attempt` ms) — a connect stall must never masquerade as a demo-state failure. If all 3 attempts fail, the check reports the connection error rather than aborting silently.

### NOT re-run after a landing beat

This gate enforces the **all-pending** requirement: `L106-108` filters `landing?.status === "landed"` and fails by design if any proposal has been landed. After a landing, demo state has changed and `demo-verify` will fail — that is expected. Post-landing verification is done via `GET /changes?repo=demo` (merged file visible), `GET /events` (look for `repo.pushed`), and `GET /landings/<sha>` (evidence record), not by re-running this gate. To reset for another recording pass, re-run `seed.mjs` + `real-agents.mjs` + `secret-fixture.mjs` (all idempotent/re-forking).

---

## Step 5+ — Recording & landing beats

**Tour/UI.** Open the worker URL:

- `\$NEXTGIT_PLATFORM/` — the triage canvas (all proposals as cards, conflict map, judge chips).
- `\$NEXTGIT_PLATFORM/tour.html` — the guided 10-step walkthrough with 4 live-data simulations.

Both are verified by the live-page gate (`porting/tests/live-render.probe.mjs`): cards rendered, no error banner, chips populated.

**Landing.** To ship a proposal:

```bash
node platform/scripts/land.mjs agent-3
```

The script delegates to `POST /land` (CONTRACT:47). The worker is the **only** base-ref writer — it folds the proposal(s) onto `demo` via 3-way diff3 and pushes exactly one commit server-side. The script never pushes anything itself.

`land.mjs` exit codes (L11-14, L58-67):

| Code | Meaning |
|---|---|
| 0 | `landed` — the baseline advanced |
| 1 | `refused` — conflict, withheld-secret, or no-changes (details printed) |
| 2 | `unreachable` — worker returned an unusable response |

**Expected land success:**

```
land agent-3 -> demo
------------------------------------------------------------
  landed        <40-hex-sha>
  file          src/store.ts
  done — baseline advanced to <12-hex>
```

**Post-landing verification** (the landing record is served verbatim from KV):

```bash
# 1. the merged file is visible on the baseline
curl -sS "$NEXTGIT_PLATFORM/changes?repo=demo&base=demo" | jq .

# 2. a repo.pushed event was emitted
curl -sS "$NEXTGIT_PLATFORM/events" | jq '.events[] | select(.type=="repo.pushed")'

# 3. the landing evidence record (ancestor, heads, foldHash, checks)
curl -sS "$NEXTGIT_PLATFORM/landings/<40-hex-sha>" | jq .
```

The evidence object's `checks[].results[].passed` must all be `true`, and `testedSha` must equal `mergedSha` — the merged file equals what was tested.

---

## Retry playbook

**Retry a single agent.** The `--only` flag re-runs specific agents without re-running the whole fleet:

```bash
node platform/scripts/real-agents.mjs --only agent-1,agent-3
```

- Reads `/tmp/real-agents/runs.json` for prior results — earlier rows are preserved, not erased.
- Preserves the shared fleet manifest at `/tmp/nextgit-agents.json` (does not drop other agents' tokens).
- The full `--only` agent set is still platform-verified (all four repos checked).

**Resume semantics.** `KEEP_CLONES=true` (L37, hardcoded). The resume path checks the kept clone at `/tmp/real-agents/<agent>/`:

- **Resume** the clone only if it has uncommitted paths **or** unpushed commits (L324-341). This prevents a dead-loop on a fully-pushed clone that would report "agent produced no file changes."
- A **fully-pushed** clone is re-provisioned fresh — the fork is re-created and the agent runs anew.
- Stale-agent recovery: if a clone has uncommitted/unpushed work from a killed agent, re-run `--only <repo>` to collect it; the clone is reused.

**Disable serial retry** (agents run truly concurrently):

```bash
SERIAL_RETRY=0 node platform/scripts/real-agents.mjs
```

**Override the agent timeout** (default 480s):

```bash
AGENT_TIMEOUT_MS=120000 node platform/scripts/real-agents.mjs
```

**Idempotent resets.** `secret-fixture.mjs` and `seed.mjs` are always safe to re-run — `secret-fixture` drops+reforks `agent-5`; `seed` is a no-op if `demo` is already current.

---

## No-mocks rule

Every script operates on **live Workers + Artifacts**. No mocks, no stubs, no synthetic fixtures. The worker must be deployed and reachable at `NEXTGIT_PLATFORM` — `demo-verify.mjs` and `real-agents.mjs` both `fetch` the live platform.

**`fanout.mjs` is NOT part of the canonical demo chain.** It is a dev utility that forks N scratch repos and writes a token file — useful for stress-testing concurrency or ad-hoc agent spawning, but it is never invoked by the 4-step gate sequence and is not verified by `demo-verify.mjs`.

This is mandated by SPEC.md:55 ("Real platform only: built on live Workers + Artifacts end to end — no mocks.").

---

## Demo-safety law

Per `.omp/agents.md:11` — the live demo fixtures are exactly `demo` + `agent-1..agent-5`. **Tests, probes, and orders MUST NEVER push commits, add branches, or delete these repos.**

- `seed.mjs` writes only to `demo` (the baseline).
- `real-agents.mjs` writes only to `agent-1..4` (fresh forks).
- `secret-fixture.mjs` writes only to `agent-5` (drop + refork).
- `demo-verify.mjs` is read-only (`GET` + one advisory `POST /judge` that writes nothing and lands nothing).

**Fixture pollution fails the gate.** `demo-verify.mjs` enforces exactly `agent-1..5` in `/proposals` — any extra repo (e.g. a scratch fork left behind by a live-push test) causes check #5 to fail with the unexpected repo list. Treat that as a fixture-mutation incident, not a flake.

**Live-push test hygiene.** Any test that needs to push commits forks a scratch repo (`agent-<name>-<ts>` from `demo`), pushes there, verifies, and **deletes it** (the delete-confirmation is handled via the Artifacts control-plane API). Never push to `demo` or `agent-1..5` from a test.

**Repairing agent-1.** If agent-1's live change-set + intent is destroyed (e.g., by a wave that pushed stray commits into the live fork), repair it with:

```bash
node platform/scripts/reset-agent-1.mjs
```

This rebuilds `agent-1` from the current `demo` head with its canonical collision fixture (the `src/auth.ts` edit + `Refactor: session refresh with TTL` intent), and verifies via the live platform's `/changes` endpoint.

---

## Secrets & masking law

Secret-class file paths (CONTRACT.md:212):

- basename matches `.env*`
- basename matches `*.pem`, `*.key`, `*.p12`
- exact names `credentials.json`, `secrets.json`
- basename is `.dev.vars`
- path **contains** `secrets/`

**Masking is path-driven by design** (CONTRACT.md:216). For a secret-class file:

- **Values must never appear in any response body** — no `patch`, no merged text, no intent. Only key names surface, as `keys[]`.
- The row carries **no `intent`** and **no `patch`** — `keys[]` is the complete schema surface for secret-class rows.

The `agent-5` fixture (`config/.env`, which matches `.env*`) exercises this end-to-end: `demo-verify.mjs` checks (12–17) that the row is `secret: true`, keys are exactly `DATABASE_URL` + `REDIS_URL`, no intent, no patch, and the four `LEAK_MARKERS` never appear in any fetched body (checks 23–25).

**Content-detected secrets** (CONTRACT.md:218-227): if the judge-layer detector finds a value-pattern in *any* non-secret-class file content (diff or intent/notes, regardless of file path), it surfaces **only** as a `POST /judge` skip reason (`reason: "secret-class"`). No content detection ships as an additive status value — this is recorded in the contract as the single decision point. The `agent-5` path is skipped on `secret-class` in the judge; agent-1..4 are all judged (check #22 confirms no other repo is skipped).

---

## Verification of correctness

- `git cat-file -e HEAD:platform/scripts/README.md` → fatal at prior HEAD, confirming absence; this file is the new addition.
- `git ls-files platform/scripts/` → all 8 scripts tracked: `seed.mjs`, `agents.mjs`, `real-agents.mjs`, `land.mjs`, `fanout.mjs`, `demo-verify.mjs`, `secret-fixture.mjs`, `reset-agent-1.mjs`.
- The run order (`seed → real-agents → secret-fixture → demo-verify`) is asserted by the order- check embedded in the run command below.
- `platform/wrangler.jsonc`: all bindings present (`ARTIFACTS`, `AI`, `LIVE`, `CACHE`, `LAND_LEASE`, `nextgit-events`, `./ui`).
- `platform/package.json`: `wrangler` devDependency pinned `^4.147.0` (artifacts queue-subscription source flag present).
