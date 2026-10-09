# nextgit-platform — frozen API contract

Version: v2.4 (2026-10-09). Additive changes only; if you change a shape, bump this file first.
Namespace: `nextgit` · baseline repo: `demo` (branch `main`) · demo proposals: `agent-1` … `agent-4`

All endpoints JSON. Errors: `{ "ok": false, "error": "..." }` with 4xx/5xx.

## GET /health

`{ ok, service, namespace }`

## GET /changes?repo=...&base=demo&ref=main&baseRef=main

Per-proposal change-set (server-side; no clones).

```json
{ "ok": true, "changeSet": {
  "base": {"repo","ref","treeHash","sha"}, "head": {"repo","ref","treeHash"},
  "stats": {"files","added","modified","removed","additions","deletions"},
  "commits": [{"hash","message","author","timestamp"}],
  "files": [{
    "path": "src/auth.ts", "status": "added|modified|removed",
    "additions": 4, "deletions": 0,
    "intent": "git-notes text of the head commit, when present",
    "secret": true, "keys": ["DATABASE_URL"],
    "patch": "--- a/src/auth.ts ..."
  }]
}}
```

- `intent` — git-notes text of the head commit, when present.
- `secret`, `keys` — secret-class files only; `patch` omitted for them.
- `patch` — absent for secret/binary/oversized files.
- `commits` — newest-first list of the proposal's first-parent commits from HEAD down to (and including) the fork point (`base.sha`). Each entry: `hash` (40-hex SHA-1), `message` (commit subject string), `author` (string, rendered as `Name <email>`), and `timestamp` (Unix seconds of the author date). Bounded by the fork-point walk (`limit: 200`); empty when the walk yields no commits. Never includes commits past the fork point.

## GET /proposals?base=demo&repos=a,b (repos optional → auto-discover `agent-*`)

The set view + conflict map.

```json
{ "ok": true, "base": {"repo","ref","head"}, "ref": "main",
  "proposals": [ {"repo","head","intent?","stats","landing":{"status":"ready|conflict|landed|withheld-secret","files":N},"files":[{"path","status","additions","deletions","secret?","keys?"}]} ],
  "conflicts": [ {"file","repos":["agent-1","agent-2"],"kind":"text-conflict",
                  "pairs":[{"a":"agent-1","b":"agent-2","kind":"text-conflict","conflict":true,"region":{"baseLines","aLines","bLines"}}]} ],
  "summary": {"proposals":4,"changedFiles":4,"sharedFiles":1,"conflictingPairs":1,"cleanPairs":0}
}
```

- `base.head` — the base repo's current head SHA at `baseRef` (40-hex). A client echoes it to `POST /land` as `reviewed.baseHead`.
- `proposals[].head` — that proposal repo's head SHA at `ref` (40-hex): the head of the revision the row's change-set describes. A client echoes it to `POST /land` as `reviewed.heads[repo]`; omitted on rows that carry `error` (the repo could not be read).
- These are the values `POST /land` compares its optional `reviewed` fields against (§POST /land): a head that moves after this read makes a land carrying it answer `409 stale` — nothing is folded or pushed (FR-16). Distinct from `/changes`' `base.sha`, which is the fork point.

`kind` ∈ `text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed`

## Change-set semantics — fork point

Each proposal's change-set is computed against its **fork point** — the most recent commit shared between the proposal repo and the base repo (first-parent walk, limit 200). This is "what the agent changed": stable while the baseline moves. If no common commit is found, the base head is used (legacy fallback).

`/merge` and `/land` use the fork point as the 3-way merge ancestor: ancestor = fork-point texts, ours = current base head, theirs = proposal head.

## GET /merge?base=demo&repos=agent-3[,agent-1,...]&ref=main&baseRef=main

Fold proposals in order onto the baseline — per-file 3-way merge (diff3).

```json
{ "ok": true, "merge": {
  "base": {...}, "repos": ["agent-3"], "status": "clean|conflict",
  "files": [ {"path","action":"write|delete","result":"merged|conflict|withheld-secret","merged?","conflictText?","note?"} ],
  "conflicted": ["src/auth.ts"]
}}
```

- `status` — `conflict` when any file conflicts; `clean` otherwise.
- `merged` — full merged text when `action=write` and `result=merged`.
- `conflictText` — text with `<<<<<<< / ======= / >>>>>>>` markers when `result=conflict`.
- Secret-class files: `result=withheld-secret`, no text.

## POST /land

Body: `{ "base": "demo", "repos": ["agent-3"], "baseRef": "main", "ref": "main" }` — fold the given proposals (in order) onto the base repo and **push the result to its default branch, server-side** (no clones on the caller's side). This is the browser's one-click "ship it".

- Merge semantics identical to /merge (diff3 fold, in order).
- Secret-class files: if any affected file is secret-class → `409 {ok:false, error:"withheld-secret", files:[...]}` — values never leave the worker and are never pushed by it.
- Conflict → `409 {ok:false, error:"conflict", conflicted:[...], detail}`.
- Clean → the worker creates **one commit** on top of `baseRef` (`land(<repos>): fold proposal(s)`) and pushes it (repo-scoped write token minted via the binding; push performed in-worker over the v1 wire protocol).
- Fold produces **zero changes** → `409 {ok:false, error:"no-changes", detail}` (nothing to land).
- Success → `200 { "ok": true, "landed": { "repos": [...], "commit": "<sha>", "files": [...], "at": "<iso>" } }`.
- `reviewed` — **optional** reviewed-state precondition (AD-3); absent ⇒ legacy behaviour (no precondition checks). When present:

  ```json
  { "reviewed": { "baseHead": "<sha>", "heads": { "agent-3": "<sha>" } } }
  ```

  - `reviewed.baseHead` — optional base head sha; must equal the current head of `baseRef`, else `409 {ok:false, error:"stale", detail}` (nothing is folded or pushed).
  - `reviewed.heads` — optional map of proposal repo → head sha; must cover exactly the requested `repos` (unknown or missing key → `400 {ok:false,error:"bad-request"}`); every value must equal that repo's current head at `ref`, else `409 {ok:false, error:"stale", detail}`. Values are opaque sha strings (non-empty, ≤128 chars) compared by exact equality.
- `base-moved` — optional **advisory-only** DO lease note (FR-17): when cross-isolate contention is detected, a loser may be refused with the same `409 {ok:false, error:"base-moved", detail:"..."}` shape as AD-3; the response carries no new fields and the lease is purely internal coordination.
- `validation` — **optional** recorded validation evidence (FR-18); absent ⇒ the ledger records the server's content-identity check as `not-recorded`. When present:

  ```json
  { "validation": { "checks": ["node --check", "bun test"], "results": ["pass", "pass"],
                    "testedSha": "<sha256 hex>", "artifactRef": "porting/runs/<order>" } }
  ```

  - `checks` — 1..32 non-empty strings (≤256 chars): the checks that ran.
  - `results` — same length as `checks`, position-paired, non-empty strings (≤256 chars): their recorded outcomes.
  - `testedSha` — 64 lowercase hex chars: the SHA-256 of the fold the validation ran against (compute it from a `GET /merge` preview with the `foldHash` rule below).
  - `artifactRef` — optional non-empty string (≤512 chars): the evidence-artifact reference.
  - Self-attested: the server verifies content identity (`testedSha` vs the fold that lands), not execution.
  - Shape violations → `400 {ok:false, error:"bad-request"}` (same bucket and precedence as `reviewed`). The reserved check name `merged-sha-equals-tested-sha` must not appear in `checks`.
- Concurrency precondition: after the in-memory clone and before the push, the worker re-reads the base head; if it no longer equals the head the fold was computed against → `409 {ok:false, error:"base-moved", detail}` (the concurrent double-land loser path; a push rejected because the ref moved is reported as `base-moved` too). Nothing is pushed.
- `200` carries `evidence` in addition to `landed` — the landing record (AD-3/FR-18); the returned `commit` is the evidence reference:

  ```json
  { "evidence": { "repos": ["agent-3"], "commit": "<sha>",
                  "ancestor": { "agent-3": "<sha>" },
                  "heads": { "base": "<sha>", "repos": { "agent-3": "<sha>" } },
                  "foldHash": "<sha256 hex>",
                  "checks": ["<check>", "..."], "results": ["<outcome>", "..."],
                  "mergedSha": "<sha256 hex>", "testedSha": "<sha256 hex> | null",
                  "artifactRef": "<string> | null", "at": "<iso>" } }
  ```

  - `ancestor` maps each landed repo to the fork-point commit used as its 3-way ancestor; `heads` are the base and proposal heads the fold was computed against.
  - `foldHash` and `mergedSha` are the same digest under two pinned names (fold identity / FR-18's merged-SHA): SHA-256 over the writeable folded set — the files the landing pushes (action `write` entries carrying `merged` text, plus action `delete` entries) — ordered by path (JavaScript string order, `<` — code-unit, deterministic across runtimes; byte order for ASCII paths) and serialized per file as `` `${action}\n${path}\n${action === "write" ? merged : ""}\n\0` ``, concatenated, UTF-8, hex lowercase. `foldHash === mergedSha` always.
  - `checks`/`results` are the landing's validation ledger, position-paired (equal lengths): the recorded validation entries, then the server's content-identity check — reserved name `merged-sha-equals-tested-sha`, last in both arrays, with result `pass` (`testedSha === mergedSha`), `mismatch` (a validation was recorded but its testedSha does not equal the fold hash — a fold that changed after validation cannot claim validation), or `not-recorded` (no `validation` supplied). A mismatch never refuses the fold and never silently passes; it is visible in `results`.
  - `testedSha` — the fold hash the recorded validation ran against, or `null` when none was recorded. `artifactRef` — the caller's evidence-artifact reference, or `null`.
  - `at` — the landing time; identical to `landed.at`.
  - The record is persisted keyed by the returned commit — KV `LIVE`, key `landing:<commit>` (single writer: this route). The write is attempted before the response; a storage failure is logged, never reported as a failed land (the response still carries the record). Served by `GET /landings/{commit}` (pinned with its own bump).
- Demo-mode allowlist (AD-9): `base` and every `repos` entry must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$` (the `demo` / `agent-*` namespace); anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller caps → `429 {ok:false, error:"rate-limited"}`.
- Precondition order: `400` (shape) → `429` → `403` → `409 stale` → `409 withheld-secret` → `409 conflict` → `409 no-changes` → `409 base-moved` → `200`.
- After landing, a `repo.pushed` event for the base repo flows through `/events` — the UI refreshes itself.
- `400` bad input; `500` unexpected.
## GET /landings/{commit}

Path parameter `commit` is a 40-character lowercase hex SHA-1 (required). Non-matching → `400 { ok: false, error: "bad-request" }`.

Read back the landing record persisted by `POST /land`, served verbatim from KV keyed by `landing:<commit>` — the same JSON string the landing wrote (the `landed` and `evidence` sub-objects are byte-identical to what `POST /land` returned in its `200` body).

- Known commit → `200` with the persisted record: `{ "ok": true, "landed": { "repos": [...], "commit": "<sha>", "files": [...], "at": "<iso>" }, "evidence": { "repos": [...], "commit": "<sha>", "ancestor": {...}, "heads": {...}, "foldHash": "<hex>", "checks": [...], "results": [...], "mergedSha": "<hex>", "testedSha": "<hex | null>", "artifactRef": "<string | null>", "at": "<iso>", "lease": {... | null} } }`. The response body is the KV value served with `content-type: application/json` — no transformation, so `landed` and `evidence` deep-equal the landing's `200` payload.
- Unknown commit → `404 { ok: false, error: "not-found" }`.
- Credential-free (NFR-6): the route takes no caller identity and returns no token. No secret-class content is persisted in the record (secret files are withheld at fold), so the response carries no credentials (NFR-5).
- `400` bad input (`commit` not 40-hex); `500` unexpected.

## POST /judge

Typed judgments for a target set of proposals — advisory only: the route writes nothing and lands nothing.

Body:

```json
{ "setId": "v1",
  "target": { "base": "demo", "repos": ["agent-1", "agent-2"], "refs": ["main"] } }
```

- `setId` — required; the versioned question-set id. Whitelist at this bump: `v1` = the three card signals (risk, intent-vs-diff verification, semantic collision). Unknown id → `400 {ok:false, error:"unknown-set"}`. Sets are versioned in code; new ids are additive, existing ids never change meaning.
- `target.base` — base repo; default `"demo"` (the platform default, identical on every route).
- `target.repos` — required; non-empty unique array of proposal-repo names, ≤16 entries (the platform's per-request repo cap). Subject to the platform's repo rules (AD-9 allowlist when the auth seam lands).
- `target.refs` — the ref the target repos are read at; default `["main"]`; v1 accepts exactly one entry — the base and every proposal repo are read at that ref (the `/changes` `ref`/`baseRef` default equivalence). More than one entry → `400`.
- The request schema is closed: `state`, `questions`, `model`, or any other unknown field → `400 {ok:false, error:"bad-request"}`. State is assembled **server-side only**: binding-native reads (AD-2) over the same fork-point change-sets the set view uses (AD-3); untrusted repo content (diffs, intents, paths) enters the state delimited and labeled as data; instruction-like text is stripped; every outbound state passes the AD-4 masking filter — secret-class paths enter as key names only, and no secret-class value may enter any model state or log.

```json
{ "ok": true,
  "setId": "v1",
  "model": "@cf/cloudflare/clef",
  "judgments": [
    { "repo": "agent-1",
      "risk": { "label": "focused", "score": 1.57 },
      "intent": { "verdict": "supports", "overclaim": 0.31 },
      "collision": false }
  ],
  "skipped": [ { "repo": "agent-4", "reason": "secret-class" } ]
}
```

- `setId` — echo of the set that was answered. `model` — the id the model response carried; on 200 it is always the pinned `@cf/cloudflare/clef`. A model response whose `model` differs or is absent ⇒ judge-unavailable ⇒ `503`, fail closed (no judgments).
- `judgments[]` — one typed entry per judged proposal, in `target.repos` order: `repo` plus the three signals below. The model's raw answers are validated against this typed schema (kind whitelist, ranges; unknown answer fields rejected); any violation ⇒ `503 judge-unavailable`.
- `skipped[]` — proposals not judged: `{repo, reason}` with `reason` ∈ `secret-class` (the change-set touches a secret-class path — its content cannot enter state, AD-4; the repo is listed by **name only** — no paths, no keys, no content) | `empty-change-set` (nothing to judge — the fold produces zero changes) | `content-detected-secret` (a value-pattern was detected in non-secret-class file content — diff or intent/notes, regardless of file path — by the judge layer; the proposal is not judged and no value is emitted; see §Content-detected secrets). Both arrays are always present.
- Errors: `400 {ok:false,error:"bad-request"}` malformed body/target; `400 {ok:false,error:"unknown-set"}` setId outside the whitelist; `503 {ok:false,error:"judge-unavailable"}` binding missing, model mismatch, or schema-invalid answers — fail closed; `429 {ok:false,error:"rate-limited"}` per-caller caps (AD-9); `500` unexpected, platform envelope.
- The caller cannot name or choose a model — the pinned id lives in code. Judgments are advisory: the auto-land gate (when it exists) is evaluated inside `POST /land`, before fold and push (AD-11) — clients render verdicts, never decide them.

### Card-signal vocabulary (setId `v1`)

The three signals the card chips render — the complete judge vocabulary the UI consumes:

- **risk** — `risk.label` ∈ {`routine`, `focused`, `senior-security`} (thresholded in code) + `risk.score` = probability-weighted level index over the ordered 3-level rubric, range [0,2].
- **intent vs diff** — `intent.verdict` ∈ {`supports`, `contradicts`, `insufficient`} (insufficient = no intent / insufficient evidence) + `intent.overclaim` = noul probability [0,1], `null` when the verdict is insufficient.
- **semantic collision** — `collision` boolean: same-behavior collision between proposals; distinct lens from the diff3 adjacency map (`/proposals` conflicts) — both are true signals; render both.

Thresholds, weights, and labels live in code (AD-11): the wire carries typed answers, never prose. Cards for `skipped` proposals render no judge chips; a skip is not a verdict. **The judge advises; code decides; humans still own irreversible acts.**

## GET /events

`{ "ok": true, "events": [{"type","repo","ref","after","at"}] }` — newest first, ≤50, from KV.

## GET /events/stream

**Real-time transport** — server-sent events over a Durable Object hub (`EVENTS_HUB` binding, `EventsHubDO` class, single instance keyed via `idFromName("events")`). `GET /events` remains the durable read; this route is a push mirror of the same validated event frame.

**Request**: `GET /events/stream` (no query parameters; one namespace-wide feed — per-repo/per-base subscription is deferred).

**Response**: `200` with `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`.

**Initial frame**: within 5 s of connect, the server sends `: connected\n\n` (an SSE comment line) as a connection confirmation — never an event frame on connect alone.

**Snapshot on connect**: after `: connected`, the server drains the most recent 50 events (the ring buffer, same cap as `GET /events`) as `event:` frames, newest-first. The snapshot is a best-effort drain; if the buffer is empty, none are sent and the client enters the live heartbeat.

**SSE frame vocabulary** (identical to the `GET /events` event shape):

```
event: repo.pushed
retry: 30000
id: <dedup-key>
data: { "type": "repo.pushed", "repo": "agent-1", "ref": "main", "after": "<40-hex>", "at": "<iso-8601-utc>" }

```

- `event:` — the normalized event type (`repo.pushed`, `repo.forked`, `repo.created`; normalized via the same `normalizeEventType` as the queue consumer — `cf.artifacts.` prefix stripped).
- `retry:` — `30000` (30 s); instructs the client to reconnect after this interval on disconnect.
- `id:` — the event's dedup key (`type|repo|ref|after`, same as `eventDedupKey` in index.ts:749-752) so a reconnecting client can resume via `Last-Event-ID`.
- `data:` — JSON object `{ type, repo, ref, after, at }` — the exact `LiveEvent` shape (CONTRACT.md:194, `type?|repo?|ref?|after?` nullable; `at` always present).

**Heartbeat**: every ≤30 s (implemented at ≤25 s) the server emits `: heartbeat\n\n` — an SSE comment, no `data:`. A client that has not received *any* line (event or heartbeat) within 45 s should reconnect with `Last-Event-ID` set to the most recent `id:` it received; the server re-drains the snapshot tail from its ring buffer (no server-side resume cursor is maintained).

**Live broadcast**: every validated event that the queue consumer writes to KV (`recordEvent`, index.ts:754) is simultaneously published to the hub; open streams receive the matching `event:` frame. The producer is best-effort: a hub failure logs `events-hub-publisher` and is swallowed — the KV write stands and `GET /events` remains correct.

**Relationship to GET /events**: `/events/stream` is derived — it never writes, never alters KV, never acks Queue messages. The queue consumer (`async queue`, index.ts:1496) is the single recorder; the SSE hub is a fan-out mirror. `GET /events/stream` degrades gracefully to the `: connected` + snapshot tail if the hub is unbound or empty.

**Errors**: HTTP 200 for the stream. A hub dispatch error that precedes any SSE frame written is `503 { ok: false, error: "events-unavailable" }`.

**Additive only** — no existing route shape changes.

## UI

`GET /` serves the triage UI (`platform/ui/` via wrangler assets). API routes fall through to the worker.

## Notes mirror (intent plumbing)

The Artifacts binding cannot resolve `refs/notes/*` (server-side limitation, measured). Intent is read from a branch mirroring the notes ref. Agent push recipe — one command, three refspecs:

```
git push origin main refs/notes/commits refs/notes/commits:refs/heads/nextgit-notes
```

Fallback source: `NEXTGIT_INTENT/<sha>.txt` (or `NEXTGIT_INTENT/intent.txt`) on that branch. Response shape unchanged (`intent` string, omitted when absent).
## Authorization (FR-45 / AD-9)

A single `authorize(request, env, action, {repo|base})` chokepoint is called by every route; `AUTH_MODE` defaults to deny; the demo opts in explicitly (`demo`).

- `AUTH_MODE` (Worker var, defaults to deny when absent or any value other than `demo`): `resolveAuthMode(env)` returns `"demo"` only when `env.AUTH_MODE === "demo"`; absent or any other value ⇒ `"deny"`.
- **Deny mode** (default): every API route returns `401 { ok: false, error: "unauthorized" }` before any repo read (no `env.ARTIFACTS.get()` is reached on a denial).
- **Demo mode** (`AUTH_MODE="demo"`): current demo behavior is preserved — routes run unchanged; the `/land` demo-repolist allowlist (`demo`, `agent-*`) and its `403 {ok:false,error:"repo-not-allowed"}` shape are unchanged.
- **Action vocabulary:** `read` (GET endpoints + `/landings/{commit}`), `write` (`POST /land`), `judge` (`POST /judge`), `reveal` (reserved for elevated reveal — FR-31, behind the seam). Enforced per-route via the route table in `platform/src/index.ts`.
- **Identity carrier:** opaque token in the `Authorization` header (Bearer prefix stripped by handlers). In demo mode any non-empty token is accepted (no identity resolution yet — the reveal-behind-seam story adds it later).
- **Uniform deny shape:** `401 { ok: false, error: "unauthorized" }` — no detail, no token logging (NFR-3).

Exact copy (FR-45): "A single `authorize(request, env, action, {repo|base})` chokepoint is called by every route; `AUTH_MODE` defaults to deny; the demo opts in explicitly (`demo`)."


### Landing-decision note (after land)

After a successful `POST /land`, the worker attaches a landing-decision git note to the landed commit in `refs/notes/commits` and mirrors it to `refs/heads/nextgit-notes` inside the same `pushLand` critical section. The note payload is metadata-only:

`{ repos: string[], commit: string, foldHash: string, at: string (ISO timestamp) }`

- **repos** — the proposal repos folded into the landed commit.
- **commit** — the landed commit SHA-1 (40-hex).
- **foldHash** — SHA-256 over the folded result (action + path + content, path-sorted), identical to `evidence.foldHash` from the same land.
- **at** — ISO 8601 timestamp of the note write.

The note write is best-effort: a failure is logged as `landing-note-push-failed` and does not fail the land or alter any response shape. No secret-class content reaches the note — withheld-secret files are excluded at fold (CONTRACT §Secret classes). The note rides inside `pushLand` within `withLandGate`, using the same single-use worker token and the same critical section — it is not a separate control-plane push to base branches. This is the only code path that writes `refs/heads/nextgit-notes`; `refs/heads/<baseRef>` is written by exactly one `git.push` (the land commit push).

Reader surface: `GET /changes` intent and `GET /proposals` card read intent from the mirror branch per the recipe above; the landing-decision note is readable via standard git-notes readers (e.g. `git notes --ref=refs/notes/commits show <commit>` after fetching the mirror).
## Secret classes (masking law)

Path matches: basename `.env*`, `*.pem`, `*.key`, `*.p12`, `credentials.json`, `secrets.json`, `.dev.vars`, or any path containing `secrets/`.

**Secret file values must never appear in any response body** — no patch, no merged text; only key names (`keys[]`).

Masking is **path-driven by design** in this version: a secret value placed in a non-secret-class path is not redacted — values must live in secret-class paths. Secret-class rows carry no `intent` and no patch; `keys[]` is the complete schema surface for them.

### Content-detected secrets

**Decided (once):** content-detected secrets (a value-pattern found by the judge layer in non-secret-class file content — diff or intent/notes, *regardless of file path*) surface **only** as a **judge-gate skip reason** on `POST /judge`, never as an additive status value. This closes adversarial-review finding F11 (review-adversarial.md:91-95) and FR-30 consequence 3 (PRD:468): exactly one route, recorded here, never implicit.

- **Detector:** judge idea 11 (`docs/judge-layer-ideas.md:54`) — a `noul` over diff + notes regardless of file path. The detector is judge-advisory under AD-11 and feeds the gate only.
- **Arrives as:** a new `skipped[]` reason `content-detected-secret` on `POST /judge` (CONTRACT.md:168). The judge responds with the recorded skip reason and carries **no value** — no value enters judge state, no value enters any response body, no value enters logs. Fail-closed: if the judge cannot answer, the route returns `503 judge-unavailable` as already specified (CONTRACT.md:169).
- **Landing consequence:** a proposal whose change-set was skipped by the `content-detected-secret` gate is treated as judged-against-landing — `POST /land` fails closed (409 / 503, no push) for any such repo, per AD-11's auto-land gate rule (CONTRACT.md:170). The judge advises; code decides.
- **v1 path-driven limitation (unchanged):** the paragraph above states that a value in a non-secret-class *file path* is not redacted by path masking. Content-class secrets are a separate, judge-gated signal layered on top; they do not alter the path-driven masking behavior — secret-class paths continue to render `keys[]` only, and a content-detected secret in a non-secret-class path is caught by the judge gate, not by the path-masker. No value is ever emitted from a `content-detected-secret` skip.

**The detection unit ships only after this record exists in CONTRACT.md and never implicitly.** No code, no fixtures, no UI ships in this slice — this CONTRACT decision is the deliverable.

## Land lease (DO coordination)

`POST /land` uses a Durable Object lease (`LAND_LEASE` binding, `LandLeaseDO` class) to serialize concurrent lands per base repo across Workers isolates. The lease is advisory-first and internal: `acquire` returns `{ acquired: boolean, leaseId: string | null }`; on `!acquired`, the caller is refused with the existing `409 {ok:false, error:"base-moved", detail:"..."}` shape (no new response fields). The lease key is `lease:<base>` — single key per base — with a 30-second TTL and lazy expiry (plus native DO hibernation). When `env.LAND_LEASE` is undefined (e.g. local dev), `acquireLandLease` returns `null` and the route falls back to AD-3's push-rejection conversion. The winner acquires the lease, lands, and releases on completion; losers are refused deterministically rather than relying on push-rejection timing. The `lease` evidence field (additive-optional) records `{ provider: "do", leaseId }` on the winning land only.


## Platform VERIFY gate

Every platform deploy runs two live probes as a non-negotiable VERIFY gate. Both are read-only against the live worker — they never land/push/fork/delete `demo` or `agent-1..5`:

- `node porting/tests/land-hardening.probe.mjs` — AD-3 fold-merge + landing correctness across success and induced-failure paths.
- `node porting/tests/egress-guard.probe.mjs` — AD-9 E8 credential egress guard: scans every route's raw response body across success and induced-failure paths (200/500/400/403/404) for `Bearer` tokens, `Authorization:` headers, Artifacts token shapes, and shell snippets. Includes a self-test that injects a synthetic token into a body and asserts the scanner detects it (proving the scanner is not a no-op). The probe also structurally verifies that the 500 push-failed path's `files` projection strips `merged` content — only `{path, action, result}` survive, so file-content payloads can never echo in a failure response.

A deploy is not "done" until both probes exit 0.
