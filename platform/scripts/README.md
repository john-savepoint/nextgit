## Operator runbook — Demo scripts

Reproducible operator path for the end-to-end NextGit demo on **real** Cloudflare Workers + Artifacts — no mocks, no stubs. Every script pushes to live branches and lands against the live platform worker. This is the operator's companion to the high-level "Run it yourself" section in the repo root [`README.md`](../../README.md); this document is the detailed operations manual.

**Heads up — prerequisites first.** This runbook operates on a live, paid Cloudflare account with Artifacts enabled. Each step mints repo-scoped tokens from your wrangler OAuth session (see [Authentication](#authentication)). Never commit or paste those tokens.

---

## Prerequisite environment

Seven environment variables drive the script chain. All have sensible defaults pointing at the **competition demo environment** (account `bb7d292ca65ba01cbdfbdabcace0c3d0`, worker `nextgit-platform.john-b7d`). Override both to redirect the entire chain to your own account.

| Variable | Default | Purpose | Scripts |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `bb7d292ca65ba01cbdfbdabcace0c3d0` | The Cloudflare account hosting the Artifacts namespace | all |
| `NEXTGIT_PLATFORM` | `https://nextgit-platform.john-b7d.workers.dev` | The live platform worker base URL | demo-verify.mjs L23, land.mjs L16, real-agents.mjs L23 |
| `CLOUDFLARE_API_TOKEN` | _(unset — falls back to wrangler OAuth)_ | Explicit API token; if unset, scripts read the wrangler OAuth config at `~/.config/.wrangler/config/default.toml` or `~/.wrangler/config/default.toml` | all |
| `ARTIFACTS_NAMESPACE` | `nextgit` | The Artifacts namespace name | all |
| `NEXTGIT_BASELINE` | `demo` | The baseline repo each proposal forks from | land.mjs L17 |
| `REVEAL_ALLOW` | _(unset — default-deny, no one)_ | JSON-string Worker var: the reveal-grant list `[{id,repos?}]` consumed by `GET /whoami` + `POST /reveal` (platform worker, not a script env) |
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

**TTL policy (FR-36).** Repo-scoped write tokens are minted under the FR-36 TTL policy (24 h default / 7 d max / over-max rejected before the call), so operators passing a large `ttlSeconds` get a hard error instead of a silently-clamped token.

**Manifest hygiene (FR-36).** The agent manifest (`/tmp/nextgit-agents.json`) is written by exactly one helper — `writeAgentManifest` in `lib/tokens.mjs` — which writes mode `0600`, re-modes a pre-existing `0644` file to `0600` on rewrite (Node's `writeFileSync({mode})` applies only at create), and verifies the resulting mode. Manifest rows are printed via `formatAgentRow`, which destructures only `name`/`scope`/`expires_at` (a token is unprintable by construction). Repo tokens reach `git` only through `gitAuthEnv` — the `GIT_CONFIG_VALUE_0` env var, never a `-c http.extraHeader=…` argv (invisible to `ps`).

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
- `ASSET_BLOB` — R2 bucket `nextgit-asset-blobs` (the content-addressed asset tier, AD-10/FR-47).

**Verify the deploy before proceeding:**

```bash
curl -sS "$NEXTGIT_PLATFORM/health" | jq .
```

Expected response:

```json
{ "ok": true, "service": "nextgit-platform", "namespace": "nextgit" }
```

If any of `ok`, `service`, or `namespace` is missing or non-200, the worker is not correctly bound. Re-check `wrangler.jsonc`, run `wrangler tail`, and resolve the deploy error before continuing.

### Demo reveal grant (REVEAL_ALLOW)

The files page's Reveal affordance is gated by `GET /whoami`, which
adjudicates the presented identity against the `REVEAL_ALLOW` Worker
var. It is **unset by default = default-deny (no one)** — the
affordance correctly renders nothing until an operator provisions a
grant. To grant the demo viewer reveal on a repo (e.g. agent-5):

```bash
cd platform
# Piped secret put — persists across deploys, keeps the grant out of git.
printf '%s' '[{"id":"nextgit-demo-viewer","repos":["agent-5"]}]' | npx wrangler secret put REVEAL_ALLOW
# (alternative: add a REVEAL_ALLOW entry to the `vars` block of wrangler.jsonc and deploy —
#  committed grants are visible in git; prefer the secret pipe for anything non-public.)
npx wrangler deploy
```

Rules:

- `id` — the opaque Bearer the client presents. The UI's demo
  identity is `nextgit-demo-viewer` (`DEMO_IDENTITY` in
  `platform/ui/js/api.js`); the grant's `id` must match it.
- `repos` — optional repo scope. Absent ⇒ the identity may reveal
  any demo-namespace repo; present ⇒ only the listed repos. A
  repo-scoped grant is honored per-repo: the files page re-probes
  `GET /whoami?repo=<repo>` on every picker change, so browsing
  into a non-granted repo renders the honest denial.
- The `id` is an identity carrier, not a credential — the server
  re-runs `REVEAL_ALLOW` on every `POST /reveal`, so a revoked or
  narrowed var denies immediately. Never provision a real
  credential as the demo `id`.

Verify the grant took effect:

```bash
curl -sS -H "Authorization: Bearer nextgit-demo-viewer" \
  "$NEXTGIT_PLATFORM/whoami?repo=agent-5" | jq .
# -> { "ok": true, "authorized": true, "reveal": true }
```

### R2 asset bucket lifecycle

The asset bucket carries a committed lifecycle rule — the bucket-side
backstop for the reference-counted delete path (`platform/src/asset-gc.ts`):
a pointer removed without an immediate blob delete (a land that raced, or a
blob the sweep missed) still expires server-side.

- **Bucket:** `nextgit-asset-blobs` (the `ASSET_BLOB` binding).
- **Committed rule file:** `platform/r2-lifecycle.json` — rule `expire-orphaned-asset-blobs`,
  all prefixes (`""`), delete objects with no PUT/POST activity for **90 days** (7,776,000 s).
- **Apply:**

```bash
cd platform && ./node_modules/.bin/wrangler r2 bucket lifecycle set nextgit-asset-blobs --file r2-lifecycle.json
```

- **Verify:**

```bash
cd platform && ./node_modules/.bin/wrangler r2 bucket lifecycle list nextgit-asset-blobs
```

The 90-day expiry is far greater than the orphan sweep's grace window
(default 7 d — see [Orphan sweep](#orphan-sweep)), so the lifecycle rule never
deletes a blob the sweep would have kept inside its grace window: the two
reclamation layers are ordered (sweep at days, lifecycle at months), not
competing. No `storageClassTransitions` (no Infrequent Access tier this
phase). The rule carries no `abortMultipartUploadsTransition` — correct when
this rule was written (`upload-asset.mjs` PUTs a single object), but **no
longer sufficient (dated correction 2026-10-14)**: the presigned upload grant
below can open a client-direct **multipart** upload, and an abandoned one is
*not* an object, so this rule does not reclaim it (see the recipe below).

### Presigned direct-to-R2 transfers (ASSET_* credentials)

The presign surface (`GET /asset/{blobId}/presign`, `POST /asset/uploads`,
`POST /asset/uploads/{uploadId}/complete`) lets a client move asset bytes
**directly to the bucket** — the Worker only mints URLs and issues the
Create/Complete control frames, so a multi-GB asset never traverses a Worker
request body (which caps at 100 MiB Free/Pro). It needs **no new binding**:
the Workers R2 binding has no presign method, so the URLs are signed
off-binding with AWS SigV4 against the bucket's S3 endpoint. Three provisions:

| Name | Kind | Value |
|---|---|---|
| `ASSET_ACCOUNT_ID` | var | the Cloudflare account id (e.g. `bb7d292ca65ba01cbdfbdabcace0c3d0`) |
| `ASSET_S3_ACCESS_KEY_ID` | secret | an R2 **S3 API token** id |
| `ASSET_S3_SECRET_ACCESS_KEY` | secret | that token's secret |

```bash
# 1. Create an R2 S3 API token scoped to Object Read & Write on
#    `nextgit-asset-blobs` only (dashboard → R2 → Manage R2 API Tokens).
# 2. Provision into the worker (piped — persists across deploys, keeps the
#    key pair out of git):
cd platform
printf '%s' '<account-id>' | npx wrangler secret put ASSET_ACCOUNT_ID
printf '%s' '<access-key-id>' | npx wrangler secret put ASSET_S3_ACCESS_KEY_ID
printf '%s' '<secret-access-key>' | npx wrangler secret put ASSET_S3_SECRET_ACCESS_KEY
npx wrangler deploy
```

- **Fail-closed:** if any of the three is missing, every presign route answers
  `503 {ok:false,error:"presign-unavailable"}` — never a silent empty-string
  credential. A deploy without these provisions is safe (the asset *read*
  route `GET /asset/{blobId}` is unaffected).
- **Values never enter git, logs, or the manifest.** Only the account id is
  non-secret enough to be a var; prefer the secret pipe for all three.
- **Dry-run mint** (proves the credentials + the signer end to end without
  uploading anything):
  `node platform/scripts/provision-asset-presign.mjs` — see `--help`.
- **Never commit a URL:** presigned URLs are bearer tokens, minted per
  request, returned only in their mint response and never logged.

**Abandoned multipart uploads have no automated reclamation yet.** The
committed lifecycle rule (above) expires objects, not incomplete multipart
uploads, so a client that starts a multipart upload and stops leaves an
incomplete upload in the bucket until it is aborted. Either add an abort
transition to the rule (operator decision — it must be re-applied with
`wrangler r2 bucket lifecycle set`) or abort out-of-band:

```bash
# The module exposes abortMultipartSession for out-of-band use; a
# client-visible abort route is a recorded follow-up (CONTRACT.md
# §POST /asset/uploads/{uploadId}/complete, residual risk MEDIUM).
```

---

## Orphan sweep

The out-of-band bucket audit + sweep — the whole-bucket
complement to `/land`'s reference-counted delete path. `/land`
reclaims a removed pointer's blob at land time, only when the
union of every repo's pointer manifests no longer references it
(shared blobs are never deleted). This script audits the WHOLE
bucket against the same union, out-of-band.

**Run** (from the repo root):

```bash
node platform/scripts/r2-orphan-sweep.mjs [--grace-days N] [--dry-run] [--json]
```

**Semantics:**

**Surface per operation** (verified live 2026-10-12):

- **List** — the account REST API `GET
  …/r2/buckets/{bucket}/objects` (cursor-paginated),
  under the operator's API token. Live-verified on the
  demo account: `GET …/r2/buckets/nextgit-asset-blobs/objects`
  → `200 success:true` (wrangler has no `r2 object
  list` — workers-sdk #13008 is open, so list cannot
  follow delete/put onto the CLI).
- **Delete** — `wrangler r2 object delete <bucket>/<key>
  --remote` under the operator's wrangler auth — the
  proven surface `upload-asset.mjs` adopted in the
  `a14858e` hotfix (the direct api.cloudflare.com
  object routes answer `7000 "No route for that URI"`
  on this account, live-verified 2026-10-12). The
  unverified mutating REST `DELETE` route is NOT used.

- Every bucket key minus the manifest union is an **orphan**.
- An orphan **inside the grace window** (no PUT/POST activity
  within `--grace-days`, default 7, env `ORPHAN_GRACE_DAYS`)
  is **reported but not deleted** — a land that raced, or a
  blob whose delete lagged, must not be swept mid-flight.
- An orphan **older than the grace window** is **deleted**
  (batched at `SWEEP_BATCH_LIMIT`, default 500).
- **Exit codes:** `0` when the post-sweep audit reports zero
  orphans; `1` when any orphan remains after the sweep (delete
  failures, or fresh orphans awaiting grace — the sweep is
  fail-closed: it must never silently claim a clean bucket);
  `2` for usage/token errors. `--dry-run` reports without
  deleting (exit classification is the hypothetical
  post-sweep state). `--json` emits the machine-readable
  report (`{bucket, listed, referenced, orphans:[{key,
  ageDays, deleted|grace}], deleted, remaining}`).

**Env:** `CLOUDFLARE_ACCOUNT_ID` (default the demo account),
`ARTIFACTS_NAMESPACE` (default `nextgit`), `R2_BUCKET`
(default `nextgit-asset-blobs`), `ORPHAN_GRACE_DAYS`
(default 7), `SWEEP_BATCH_LIMIT` (default 500).

The grace window is far smaller than the [R2 asset bucket
lifecycle](#r2-asset-bucket-lifecycle) rule (90 days): the
sweep reclaims at days, the lifecycle rule at months — the
two layers are ordered, not competing.

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

**What it pushes.** Three refspecs in one git push: `main`, `+refs/notes/commits`, and `+refs/notes/commits:refs/heads/nextgit-notes` — the notes mirror that carries the commit's intent record (CONTRACT "Notes mirror"). Notes + mirror are **forced** (`+`): the mirror is derived single-writer state and forks inherit stale mirrors (unforced mirror pushes are rejected non-ff — root-caused 2026-10-10). The `agent-5` row must render **schema-only** (keys only, no intent, no patch) on every platform route.

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
