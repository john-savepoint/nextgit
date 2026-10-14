# SUBMISSION RUNBOOK — NextGit live platform (recording & submission day)

**Purpose:** the one command chain for the recording/submission day against the **live** NextGit platform. Each section is a gate: run the command, compare the output verbatim, and only proceed when it is green. Every expected output below was observed this session against the deployed worker; a drifted platform is detectable by diffing the actual output against these blocks.

**Scope:**

- Live worker: `https://nextgit-platform.john-b7d.workers.dev` (worker `nextgit-platform`; Artifacts namespace `nextgit`)
- Demo fixtures: baseline repo `demo` + proposals `agent-1..agent-5` (agent-1..4 scripted work; agent-5 the all-secret fixture)
- Env override (all probes): `NEXTGIT_PLATFORM` — set it to redirect every gate to another deployment.

**The two standing laws that govern the day** (from `.omp/agents.md` + `platform/CONTRACT.md`):

1. **Demo-safety law** — the live demo fixtures are exactly `demo` + `agent-1..agent-5`. Nothing ever pushes, forks, or deletes them except the reset chain in §4. A mutation is an **incident**: record it, repair via §4, and do not improvise writes to the demo namespace. Any test that needs to push commits forks a throwaway scratch repo (`agent-<name>-<ts>`), verifies, and deletes it.
2. **Masking law** — secret-class rows are **keys-only** in every response: no patch, no merged text, no intent. Values never leave the vault-side surface (the audited `/reveal`). Only key names surface, as `keys[]`.

**The ladder:** repo `README.md:75` → `platform/scripts/README.md` (the deep operator runbook: prerequisites, env vars, token mechanics) → **this file** (the recording-day gates + failure playbook).

---

## 1. Demo-state verification (the recording gate)

The terminal gate before pressing record. Read-only against the platform (`GET /proposals`, `GET /changes`, one advisory `POST /judge` — the route writes nothing and lands nothing).

```bash
node platform/scripts/demo-verify.mjs
```

**Expected (exit 0):**

```
DEMO VERIFY: PASS — 25/25 checks
```

**The 25 checks** (22 explicit + 3 loop-generated leak-marker scans):

| # | Check |
|---|---|
| 1 | `GET /proposals → 200 + ok:true` |
| 2 | base repo is `demo` |
| 3 | `≥5 proposals` |
| 4 | expected `agent-1..agent-5` all present |
| 5 | every workspace head served independently, per-repo (`/proposals`) |
| 6 | `≥1 conflicting pair` |
| 7 | deliberate collision present: `agent-1 × agent-2` on `src/auth.ts` |
| 8 | `≥4 proposals with a non-empty intent` |
| 9 | no landed proposal — all pending (recording requirement) |
| 10 | `agent-5 present` |
| 11 | `agent-5` touches exactly `config/.env` |
| 12 | `agent-5` row is secret-class |
| 13 | `agent-5` keys are exactly `DATABASE_URL + REDIS_URL` |
| 14 | `agent-5` proposal carries no intent (secret-class law) |
| 15 | `GET /changes (agent-5) → ok:true` |
| 16 | `agent-5` change-set has no patch (masking law) |
| 17 | `agent-5` change-set file carries no intent |
| 18 | `POST /judge → 200` |
| 19 | judge model pinned `@cf/cloudflare/clef` |
| 20 | `agent-5` skipped with reason `secret-class` |
| 21 | `agent-5` never judged |
| 22 | `agent-1..4` all judged (no empty-change-set skips) |
| 23–25 | one per fetched body (`/proposals?base=demo`, `/changes?repo=agent-5&base=demo`, `/judge`): `no fixture value in <path>` |
The `LEAK_MARKERS` that checks 23–25 scan for **absence** (any occurrence in any fetched body fails the gate — grep FOR these, never paste them into the platform): `FAKE-SECRET-DO-NOT-USE`, `postgres://demo`, `db.internal`, `cache.internal`.

The human-readable summary block that follows the checks is also part of the expected output — `repos:`, `landings:` (all `ready` + `agent-5=withheld-secret`), `conflicts:`, `intents:`, `judge:` lines.

**Failure action:** any red = state drift → go to **§4 reset chain** before recording. Transport flakes retry automatically (the helper retries 3× with backoff; measured `/proposals` latency up to ~40 s, `TIMEOUT_MS` 120 s). If all retries fail, treat it as a connectivity problem (§6, first class).

---

## 2. Submission-live gate

The live-only end-to-end gate: the deployed worker, no mocks, no fixtures, no local server. Read-only except the audited `POST /reveal` (which never mutates).

```bash
node porting/tests/submission-live.probe.mjs        # ~80 s on this box (edge latency)
NEXTGIT_PLATFORM=https://<other-worker> node porting/tests/submission-live.probe.mjs   # override
```

**Expected (exit 0):**

```
SUBMISSION LIVE GATE: PASS (43 checks)
```

**The 43 checks, in 11 sections** (labels verbatim from `porting/tests/submission-live.probe.mjs`). Print order (observed, stable): **sections 7–11 print first** (the extension block runs eagerly before the banner), then the banner + sections 1–6.

**Section 1 — health + read-route matrix (15 checks):** `1 /health 200 {ok, service, namespace}`; then `1 GET <route> 200 (<label>)` for `/changes` (change-set rows), `/proposals` (≥4 proposal rows), `/merge` (merge rows), `/events` (event feed), `/floors` (floors), `/forks` (forks + six-cluster signals), `/sessions` (sessions), `/agents` (agents + policy), `/harnesses` (harnesses), `/checks` (checks), `/issues` (issues), `/tree` (tree entries), `/commits` (commit log), `/comments` (comments read).

**Section 2 — file read + secret-class masking on the wire (3 checks):** `2 /file text row` (classification `text`); `2 /file secret row = keys only, never a value` (agent-5 `config/.env` → classification `secret`, `keys[]`, no `value` key, no `postgres:` in the text); `2 /raw refuses secret-class 403`.

**Section 3 — the audited reveal with the live demo grant (4 checks):** `3 /whoami answers`; `3 /whoami + demo identity on the granted repo -> reveal:true`; `3 POST /reveal granted 200 with the value` (the demo-viewer grant, `Bearer nextgit-demo-viewer`); `3 POST /reveal wrong identity -> 403 (never a value)`.

> The reveal surface is the audited identity-gated exception to the masking law: `GET /whoami` adjudicates the presented Bearer against the `REVEAL_ALLOW` Worker var (default-deny when unset). Only the demo identity holds the grant on `agent-5`; a wrong identity gets 403 and never a value — verified live, check section 3.

**Section 4 — SSE (1 check):** `4 /events/stream answers text/event-stream`.

**Section 5 — UI pages deliver (5 checks):** `5 page <path> 200 + entry markers` for `/` (proposals-grid), `/files.html` (repo-picker + `id="file-tree"`), `/history.html` (commit-list/history), `/parity.html` (parity), `/tour.html` (tour).

**Section 6 — honest refusals (2 checks):** `6 non-allowlisted repo 403` (`/changes?repo=notdemo-xyz`); `6 unknown path 404 JSON` (`/no-such-route` → `{ok:false}`).

**Section 7 — attestation read-back (3 checks):** `7 GET /landings/<zeros> 404 not-found`; `7 GET /landings/<bad> 400 bad-request`; `7 GET /landings/<known> envelope + honest attestation union` — discovers a recorded landing in the CACHE KV and verifies the envelope against the pinned `EVIDENCE_PUBLIC_KEY` (keyId derivation guard + tamper negative-control); an honest `unavailable` envelope or no discoverable record passes the union leg (never a fabricated red).

**Section 8 — presign honest-dual (3 checks):** `8 GET /asset/<not-64-hex>/presign 400 (BLOB_KEY_RE law)`; `8 GET /asset/<64hex>/presign?expires=abc 400 invalid expires`; `8 GET /asset/<64hex>/presign honest-dual (503 presign-unavailable leg)` — a credentialed `200` (url/expiry shape asserted, never followed or stored) and the fail-closed `503` are both green; anything else reds.

**Section 9 — classification vocabulary (2 checks):** every `/changes` files[] row carries `classification {language, role, sensitivity}` (vocabulary-checked against `classify.ts`); agent-5 `config/.env` reads `sensitivity === "secret"` (AD-4 alignment).

**Section 10 — wave-16 UI surfaces (4 checks):** `/story` 200 + story-section/story-tiers/tier kinds; `/` carries judge-comparison markers + `/js/judge-comparison.js` 200; `/` carries sessions markers + `/js/sessions-panel.js` 200; `GET /sessions?base=demo` 200 `{ok,base,sessions}`.

**Section 11 — pipelines (1 check):** `GET /pipelines?base=demo` 200 with the pinned row shape (a `404` skips honestly if the route is ever reverted).

**Failure action:** re-run once — transient edge stalls happen (demo-verify documents ~7 transient connect failures/day, all pre-response). Still red → §6 (read-route class). A DOM-level rendering check lives in `porting/tests/live-render.probe.mjs` (browser gate) — §5 names it for UI-affecting deploys.

---

## 3. Eligibility automation

The competition-requirement gate (`porting/tests/submission-eligibility.test.mjs` — judge-layer idea #29, `docs/judge-layer-ideas.md:78`; automates SPEC.md:50 §Constraints). Offline checks are deterministic filesystem reads — zero network, zero tree mutation. `--live` adds the deployed-worker confirmation; `--selftest` proves the parsers can fail (red legs on synthetic inputs).

```bash
bun porting/tests/submission-eligibility.test.mjs               # offline, 19 checks
bun porting/tests/submission-eligibility.test.mjs --live        # + live-worker confirmation (R4-live /health, R5-live /proposals)
bun porting/tests/submission-eligibility.test.mjs --selftest    # parser proofs (S1–S4)
```

**Expected (exit 0 per mode):**


```
SUBMISSION ELIGIBILITY: ALL PASS (19 checks)          # offline
SUBMISSION ELIGIBILITY: ALL PASS (21 checks)          # --live adds R4-live + R5-live
SUBMISSION ELIGIBILITY SELF-TEST: ALL PASS (15 checks) # --selftest
```

**The 19 offline checks (R1–R8):**

| R-id | Check |
|---|---|
| R1.1 | LICENSE exists at repo root and is non-empty |
| R1.2 | LICENSE identifies an OSI-approved SPDX license |
| R1.3 | platform/package.json license field == LICENSE SPDX id |
| R1.4 | no competing license files at root |
| R2.5 | README.md exists, >= 1 KB |
| R2.6 | README carries the product + run-instruction sections |
| R2.7 | README has a fenced bash run block + the operator-runbook cross-link |
| R2.8 | README states the live demo URL |
| R3.9 | submission/nextgit-demo.mp4 exists |
| R3.10 | video duration inside the 5–10 min window (measured `482.76 s` via ffprobe) |
| R3.11 | video size >= 1 MB |
| R4.12 | wrangler.jsonc declares an Artifacts binding (binding + namespace) |
| R4.13 | worker main points at an existing file |
| R4.14 | Artifacts binding is actually read in source (env.ARTIFACTS) |
| R4.15 | wrangler.jsonc declares the Workers script entry (main) |
| R5.16 | agents.mjs declares >= 3 named agents |
| R5.17 | every declared agent name matches `^agent-\d+$` |
| R6.18 | README live-URL host matches the wrangler worker name |
| R7/R8.19 | submission/NOTES.md records the single-entry + eligibility attestations |

**Exit contract (fail-closed):** `0` = every requirement met · `1` = N requirements unmet (each failure prints its R-id) · `2` = unknown flag (never silently ignored). Any thrown read (missing file, unparseable JSONC) is a FAILED check carrying the error — never a skip, never a crash.

**Failure action:** the failing R-id names the artifact to repair — R1 → LICENSE, R2 → README.md, R3 → the video (re-verify duration if the mp4 is re-exported), R4 → `platform/wrangler.jsonc` / worker main, R5 → `agents.mjs` fleet, R6 → README URL, R7/R8 → `submission/NOTES.md` Sections A/B. Never hand-edit `NOTES.md` to pass — the checks verify real files.

**Standing gap (a human act, not a gate):** single-entry registration by **2026-10-14** (`submission-repo-location-single-entry-registered-by-oct-14`, recorded as pending in `submission/NOTES.md` Section B). The eligibility gate verifies the package; it does not and cannot perform the competition-side filing.

---

## 4. Demo reset chain (if recording after any mutation)

The canonical, e10-verified reproducible chain (`docs/STATE.md:27`, `.omp/agents.md` "Demo reset"). Run the four steps **in order**; each is idempotent/re-forking, so re-running converges. Each step ends by busting the `/proposals` cache (`bustProposalsCache`) — the queue invalidation is the backstop if the API token is absent.

**Pre-step:** `node platform/scripts/land.mjs` is **NOT** part of the reset. Any prior landing must be undone by this chain — landings advance the demo head, and the chain reforks everything against the new head. That is also the recovery for an accidental land.

1. **Baseline:**
   ```bash
   node platform/scripts/seed.mjs
   ```
   Observable: one commit `baseline v3: service skeleton` pushed to `demo` main (writes `src/auth.ts`, `src/store.ts`, `src/api.ts`, `src/server.ts`); a no-op when the baseline already matches.
2. **Agent fleet:**
   ```bash
   node platform/scripts/agents.mjs
   ```
   Observable: deletes + re-forks `agent-1..agent-4` from the current `demo` head, applies each agent's text transform + intent note, pushes `main` + both note refspecs; writes the fleet manifest `/tmp/nextgit-agents.json`.
3. **Secret fixture (agent-5):**
   ```bash
   node platform/scripts/secret-fixture.mjs
   ```
   Observable: drops + re-forks `agent-5`, writes exactly one file `config/.env` with the two fake placeholder lines (`DATABASE_URL`, `REDIS_URL` — fake by design; the values are the `LEAK_MARKERS` named in §1, which the masking law keeps out of every response body), commits with pinned metadata (deterministic sha while the demo head is unchanged), pushes `main` + the notes mirror; merges the agent-5 entry into `/tmp/nextgit-agents.json`.
4. **The gate that proves the reset:**
   ```bash
   node platform/scripts/demo-verify.mjs    →  DEMO VERIFY: PASS — 25/25 checks
   ```

**Host-gitignore trap (agents.md flag 10):** the host's `core.excludesFile` ignores `.env`, so a plain `git add config/.env` is a silent no-op (commit exits 1, the push no-ops, and the restore *looks* successful while nothing lands). The scripts already use the `git -c core.excludesFile=/dev/null` idiom. An operator manually committing a fixture must do the same (or `git add -f`) and check `git status --porcelain` before every fixture commit.

**Targeted repair (wave-6 incident class):** if a probe suite pushed stray commits into a demo fork, the idempotent fork-rebuilds are `node platform/scripts/reset-agent-1.mjs` (canonical E1 collision fixture: the `src/auth.ts` edit + `Refactor: session refresh with TTL` intent) and `node platform/scripts/reset-agent-4.mjs`. Follow with the full chain above if uncertain.

---

## 5. Deploy sanity

**Which binary:** the documented deploy tool is the **lockfile-pinned** wrangler (`platform/package.json`: `"wrangler": "^4.147.0"`):

```bash
cd platform && ./node_modules/.bin/wrangler --version    →  4.147.0
```

The Artifacts queue-subscription source flag requires ≥4.147 (verified: present on 4.147, absent on 4.106). **Recorded mismatch (expected, not a fault):** the PATH/`npx wrangler` binary on this box prints `4.106.0` — an operator seeing two different versions should check **which binary they invoked** (`./node_modules/.bin/wrangler` vs the PATH `wrangler`), not treat either as broken. Deploys run via `cd platform && npx wrangler deploy` (`README.md:35,64`), which resolves the local pin.

**Deploy verification pair** (after any deploy; read-only — the platform VERIFY gate, `platform/CONTRACT.md`):

```bash
node porting/tests/land-hardening.probe.mjs    # exit 0 (scratch chain demo-lh-base/agent-lh-1 only)
sleep 65                                        # — the probe-spacing law (see below)
node porting/tests/egress-guard.probe.mjs      # exit 0 = no credential material + self-test caught the injected token
```

> **Probe-spacing law (verified 2026-10-14, root-caused):** chained probe reds on this box come from TWO classes: (a) **rate windows** — land-touching probes share the box IP and the worker's 60 s in-isolate limiter gates `/land` + the token-mint class, so back-to-back land probes make the second one's calls answer `429`; (b) **connection stalls** — after a land-heavy probe, the next probe's Node/undici fetches can reuse a half-dead connection (transport `TimeoutError`, retry-immune because retries reuse the same socket) while `curl`/fresh dials answer fine in the same window. Fixes, both landed in the probes themselves: every land-touching probe (`land-hardening`, `egress-guard`, `r2-land-invariance`) now sends `connection: close` per request (fresh dial — the observed deterministic fix; the `land-hardening → egress-guard` pair passes on demand after it) plus bounded transport retries on reads; POST `/land` stays single-shot (non-idempotent). Residual operator law: still space consecutive land-touching probes by ≥ 65 s for the rate class, and if a probe reds in a chain, **re-run it alone** before treating it as a platform fault — standalone-green after a chained red is this environment class, not a regression. The platform answers all routes correctly throughout (the submission gate passed inside the same chained windows).

**UI-affecting deploys** add the live-page law pair:

```bash
node porting/tests/live-render.probe.mjs       # exit 0 = cards rendered, no error banner, judge chips populated (?probe=1 seam)
node platform/scripts/demo-verify.mjs          # 25/25
```

---

## 6. Failure playbook

Each class → its named recovery. One pass per class; if nothing recovers, escalate.

| Class | Symptom | Recovery |
|---|---|---|
| **Read-route / probe red** | any §1/§2/§5 probe fails | Check the probe-spacing law (§5) first — a land-touching probe run within 60 s of another land-touching probe reds on 429s; re-run it alone (green = that class). Otherwise re-run once (edge latency). Still red → check worker deploy state: `curl $NEXTGIT_PLATFORM/health` → `{ok, service, namespace}`; `wrangler tail` for runtime errors. |
| **Demo-state red** | `demo-verify` < 25/25 | Fixture drift → **§4 reset chain**. Wave-6 incident class (stray commits in a demo fork): targeted `reset-agent-1.mjs` / `reset-agent-4.mjs`, then the full chain if uncertain. |
| **Cache-stale red** | state looks right but `/proposals` serves old rows | `bustProposalsCache` runs automatically inside the fixture scripts; after a manual mutation the queue invalidation is the backstop (`platform/scripts/lib/bust-cache.mjs`) — wait one queue cycle or re-run the fixture script. |
| **Scratch pollution** | `demo-verify` check 4 fails with unexpected repos | Sweep throwaway dirs: `/tmp/nextgit-agents.json`, `/tmp/real-agents/`, `agent-*-<ts>` scratch repos (the `real-agents.mjs` idiom). Scratch repos must be deleted per the demo-safety law, or the exact `agent-1..5` assertion fails. |
| **Probe hang > 120 s** | `demo-verify` never returns | `TIMEOUT_MS` is 120 s by design (measured `/proposals` latency up to ~40 s). A genuine hang = worker unreachable → read-route class above. |
| **Eligibility red** | exit 1 with R-ids | Repair the named R-id artifact (§3), re-run. Never hand-edit `NOTES.md` — the checks verify real files. |
| **Escalation** | not recovered in one pass | Record the state (probe output verbatim) and hand to the orchestrator. Do not improvise writes to the demo namespace. |

---

## Cross-references

- [`platform/scripts/README.md`](../platform/scripts/README.md) — the deep operator runbook: prerequisites, the seven env vars (`CLOUDFLARE_ACCOUNT_ID`, `ARTIFACTS_NAMESPACE`, `NEXTGIT_PLATFORM`, …), token mechanics (repo-scoped write tokens, FR-36 TTL policy, manifest hygiene).
- [`platform/CONTRACT.md`](../platform/CONTRACT.md) — the masking law (§Secret classes, path-driven by design), the VERIFY gate, the notes-mirror push protocol.
- [`docs/HANDOFF-PLATFORM.md`](../docs/HANDOFF-PLATFORM.md) — verification recipes.
- [`submission/NOTES.md`](../submission/NOTES.md) — Section A credential-scan evidence (three scans, CLEAN) + Section B single-entry/eligibility attestations.
- [`docs/judge-layer-ideas.md`](../docs/judge-layer-ideas.md:78) — judge-layer idea #29, the eligibility automation this runbook's §3 cites.

## Residual risks (silence is not a clean bill)

1. **Point-in-time pins.** The counts (25 / 43 / 19 checks) pin to the merged wave-18 probe (43 = the extended gate incl. attestation/presign/classification/wave-16-UI/pipelines sections; 30 was the pre-extension count at plan-phase HEAD `121d7fe`); a future contract bump re-derives them. The verbatim expected outputs above are the diff surface for detecting drift.
2. **Wrangler dual-version hazard.** PATH `wrangler` 4.106.0 vs the lockfile pin 4.147.0 — §5's which-binary note is the mitigation; the Artifacts queue-subscription flag needs ≥4.147.
3. **Competition-side acts are not automated.** Single-entry registration by 2026-10-14 (`submission-repo-location-single-entry-registered-by-oct-14`) remains an open human act — §3 states it; the gate does not perform it.
4. **Video duration.** `482.76 s` verified via ffprobe this session — re-verify if `submission/nextgit-demo.mp4` is re-exported (R3.10).
