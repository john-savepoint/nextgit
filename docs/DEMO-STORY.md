# NextGit — the demo story

The 5–10 minute recording shot-list for the live platform:
**https://nextgit-platform.john-b7d.workers.dev**

Every beat names its URL, its actions, the expected screen/state, the
talking points, and its seconds. Beat timings sum to **~8 minutes** —
inside the window with margin for latency (`/proposals` can take ~40s
cold; the client caps at 20s and shows an honest error).

**Prerequisite — record only from the canonical state.** The demo
namespace is reset with:

```bash
node platform/scripts/seed.mjs && \
node platform/scripts/agents.mjs && \
node platform/scripts/secret-fixture.mjs && \
node platform/scripts/demo-verify.mjs    # expects PASS 25/25
```

Do not record from any other state. **Never land, push, fork, or
delete `demo`/`agent-1..5`** — a fixture mutation is an incident
(a wave-6 suite once destroyed agent-1's demo change-set this way).
The only optional mutations are named on-screen in beats 4 and 9.

---

## Beat 1 — Triage grid: the conflict pair (~40s)

- **URL:** `/` (the triage app)
- **Actions:** load `/`; observe the header chips, the Convergence
  Conflicts section, and the Concurrent Proposals grid.
- **Expected:** header chips read proposals=5, conflicting pairs=1,
  shared files, changed files, clean pairs. Convergence Conflicts
  shows the deliberate `src/auth.ts` pair (agent-1×agent-2). Every
  proposal card carries the five-check strip — fold / collision /
  conflicts / secrets / base. Live `/checks` for agent-1 and
  agent-2 (verified): fold **pass** "folds clean", collision
  **fail** "text-conflict · src/auth.ts", conflicts **fail** "1",
  secrets **pass**, base **pass** "in sync".
- **Talking points:** N concurrent proposals read as ONE comparable
  set — the product's reason to exist. The strip is
  server-authoritative (`GET /checks`); the fail-soft client
  fallback never reads green.

## Beat 2 — Fork Signals (~40s)

- **URL:** `/` §Fork Signals
- **Actions:** scroll to the Fork Signals panel.
- **Expected:** per-fork six-cluster signal chips
  (fitOverlap/peopleTrust/… → fit/trust/…). The typed-null law:
  an unmeasured cluster renders the literal "unmeasured", never a
  fabricated 0. Policy chips come from `/agents`.
- **Talking points:** the fork-ecosystem read is a projection of
  the same bounded `list()` discovery seam — zero per-repo reads.

## Beat 3 — Convergence rail (~40s)

- **URL:** `/` §Convergence Rail
- **Actions:** observe the rail band (one row per proposal repo).
- **Expected:** render-only rail: repo header, landing chip,
  attestation badge where a landing record carries one, five check
  dots (unknown dots when the payload is absent — never styled
  green), policy chips, newest-first event trail. No affordances,
  no buttons.
- **Talking points:** the rail is the set-level summary. Honesty
  law: `attestation: null` (typed-absent) renders NO badge, never
  a fabricated signature.

## Beat 4 — Preview-merge: diff3 + comments (~60s)

- **URL:** modal on `/` — proposal card → "Preview 3-way merge"
  (`GET /merge?repos=<repo>`)
- **Actions:** open the merge preview for a solo repo (agent-1),
  then narrate the pair case.
- **Expected (verified live):** solo agent-1 = **clean**
  (`status: clean`, `src/auth.ts` result `merged`); the pair
  `agent-1,agent-2` = **conflict** with the diff3 `conflictText`
  pane (red badge, `[!]` tab marker). Per-file comment thread
  under the merge pane (`GET/POST /comments`): optimistic pending
  row, reconciled from server truth. Secret-class rows render the
  honest refusal ("Commenting is disabled for secret-class files").
- **Talking points:** diff3 3-way merge simulated server-side
  (fork point = ancestor). Comments are a write surface — the
  recording shows the thread read-only **unless** the optional
  mutation is taken: one review comment, named on-screen as a
  deliberate demo mutation.

## Beat 5 — The reveal on agent-5: the audited grant (~60s)

- **URL:** `/files.html` → repo picker `agent-5` → navigate to
  `config/.env`
- **Actions:** browse agent-5's tree, open `config/.env`, click
  Reveal.
- **Expected (verified live):** `/file` answers
  `classification:"secret"` with key names only (`DATABASE_URL`,
  `REDIS_URL`) — never a value; `/raw` refuses secret-class with
  403 (no raw link is rendered). `/whoami?repo=agent-5` with the
  demo identity → `{authorized:true, reveal:true}` — while
  agent-1 → `reveal:false`: **the grant is repo-scoped**. Reveal →
  `POST /reveal` → the value renders ONLY from the 200 body
  (escaped): `DATABASE_URL = postgres://demo:FAKE-SECRET-...`.
  A wrong identity gets 403, never a value.
- **Talking points:** secret-class files are typed objects —
  schema-only by default. The reveal is audited (REVEAL_AUDIT KV
  records every decision). The demo identity (`nextgit-demo-viewer`)
  is an **identity carrier, not a credential**. The affordance is
  never a capability — the server re-runs the reveal rule on every
  click. The fixture is fake (`FAKE-SECRET-DO-NOT-USE`); never
  paste a real secret.

## Beat 6 — Checks / pipelines: the attestation badge (~40s)

- **URL:** `/` §Pipelines
- **Actions:** observe the Pipelines panel.
- **Expected (verified live):** `/pipelines?base=demo` rows —
  e.g. id `81f05276…`, repos `["agent-r2i-1"]`, checks
  `["merged-sha-equals-tested-sha"]`, `attestation:"signed"`.
  Badge law: `signed` is the ONLY clean badge; `unavailable` and
  `null` (records predating the layer) render neutral — never
  green for a non-signed record.
- **Talking points:** every landing attaches a signed Ed25519
  attestation over the canonicalized envelope, stored in two
  independent copies (KV `landing:<commit>` + R2
  `attestations/<commit>.json`) for cross-copy tamper detection.
  The verification recipe is operator-runnable:
  `node platform/scripts/attest-verify.mjs --commit <sha>`.

## Beat 7 — History + files + classification (~50s)

- **URL:** `/history.html` (repo picker), `/files.html`
- **Actions:** pick a repo in the history page, select a commit,
  follow the changed-files panel; cross-link to the files page.
- **Expected:** `/commits?repo=&ref=` serves the newest-first
  first-parent chain; each commit row is a REAL anchor
  (`?repo=&ref=<sha>` — reload-surviving deep link). The
  per-commit changed-files panel drives `/changes` pinned
  `base=<repo>&baseRef=<parents[0]>` (the fork point); a root
  commit (`parents:[]`) renders an honest empty state and issues
  NO `/changes` request. On `/files.html`: `/tree` directory
  navigation, `/file` per-file classification triple
  (language/role/sensitivity), text/binary/secret rendering,
  secret rows key-names-only.
- **Talking points:** server-side reads, no clones — the review
  path never clones. Classification is pure path/extension law.

## Beat 8 — Sessions + steer (~40s)

- **URL:** `/` §Sessions
- **Actions:** observe the sessions list; narrate the steer
  composer — **do not send** unless a steer is wanted (prefer
  none).
- **Expected (verified live):** `/sessions` shows the agent-5
  session — state `idle`, intent "Config: add local dev
  environment file", lastEvent `repo.pushed`, lastActivityAt. The
  steer composer (1–500 char textarea + send,
  `POST /sessions/{repo}/steer`) renders per session; success
  carries an optimistic `sent` marker, failure surfaces via the
  action banner — never silently.
- **Talking points:** `/sessions` is deliberately UNBOUND (the
  `/changes` posture — documented in CONTRACT.md, not an
  oversight). Session steering is an honest v1 derived from the
  real event feed: the instruction lands in the event stream the
  agent CLIs read; live process injection is the documented
  limitation.

## Beat 9 — Issues create/close (~40s)

- **URL:** `/` §Issues
- **Actions:** observe the derived + stored issue rows; narrate
  the composer and the close affordance.
- **Expected:** derived rows badge the derivation leg (conflict /
  withheld-secret / …); stored rows badge "stored", render the
  escaped body, carry the server-minted 12-hex id and a closed
  chip when closed. Composer POSTs `{repo, title 1..128, body
  1..2000, severity}`; the stored-row close affordance PATCHes
  `/issues/{id}` with `{state:"closed"}` — optimistic `closing…`
  state, reconciled by refetch.
- **Talking points:** issues are DERIVED from existing platform
  state (merge folds, fork-point walk, matcher verdicts) — no new
  store. **Prefer recording the read surface only**; if a
  create/close is wanted for the record: one scratch issue on
  `demo`, created and closed in the same take, named on-screen as
  a deliberate demo mutation.

## Beat 10 — Parity dashboard: exceeds/parity/below honestly (~40s)

- **URL:** `/parity.html`
- **Actions:** load the dashboard; read the chips and the below
  rows.
- **Expected:** chips **5 exceeds · 8 parity · 5 below** (derived
  by `porting/parity/compare.mjs` from structured baselines —
  never hand-authored; `parity-data.js` generated
  2026-10-14T03:17:32Z). The below set: session-steering,
  agent-identity-policy, agent-federation, issues, ci. Exceeds
  include: cross-change conflict detection, set-level triage,
  intent provenance, secret typing, set-level advisory.
- **Talking points:** below rows are FILED AS STORE ROWS, not
  hidden — the honest-README posture the competition's UX axis
  rewards. The verdict rule is code-owned (`compare.mjs`): a
  partial NextGit capability is still below a shipped GitHub
  baseline; both-partial is parity.

## Beat 11 — Tour as the closer (~30s)

- **URL:** `/tour.html`
- **Actions:** step through the tour (or show the step rail and
  the live-data step).
- **Expected:** 10 steps — 1 Welcome → 2 Single-Threaded Review
  Is Broken → 3 Isolated Workspaces → 4 What a Proposal Is →
  5 What a Collision Is → 6 Shipping Clean Proposals → 7 The Real
  Thing: Live Proposals (fetches LIVE `/proposals` in-browser) →
  8 Exercise → 9 What Is Not Here (Yet) → 10 Where You Come In.
- **Talking points:** the tour is the self-serve onboarding; step
  7 is the live-data bridge between the narrated story and the
  product.

---

## Laws the recording must never break

1. **Read-only walkthrough discipline** — zero mutations by
   default; the only optional mutations (one comment in beat 4,
   one issue create+close in beat 9) are named on-screen as
   deliberate demo mutations.
2. **Record from the post-reset canonical state only** — the
   reset chain above is a prerequisite, not a suggestion.
3. **Honesty laws to narrate** — an absent `/checks` route never
   reads as green; `attestation: null` renders no badge;
   below-parity rows are shown, not hidden; agent-5 is never
   judged (the judge layer's typed secret-class skip).
4. **The reveal beat narrates the audited grant** — the value
   appears ONLY from the POST /reveal 200 body; the fixture is
   fake; never paste a real secret; the demo identity is an
   identity carrier, not a credential.
5. **Bounded waits** — `/proposals` can take ~40s cold; narrate
   the wait, never refresh-storm the worker.
