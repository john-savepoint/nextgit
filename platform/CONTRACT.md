# nextgit-platform — frozen API contract

Version: v3.0 (2026-10-11). Additive changes only; if you change a shape, bump this file first.
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
- Demo-mode allowlist (AD-9): `repo` and `base` must match the allowlist (`^(demo|agent)(-[A-Za-z0-9._-]+)?$`); anything else → `403 {ok:false,error:"repo-not-allowed",detail}` — enforced at the `authorize()` chokepoint before any repo read.

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
- Demo-mode allowlist (AD-9): `base` and every `repos` entry must match the allowlist (`^(demo|agent)(-[A-Za-z0-9._-]+)?$`); anything else → `403 {ok:false,error:"repo-not-allowed",detail}` — enforced at the `authorize()` chokepoint before any repo read.
- Rate limit (AD-9): per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).

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
- Rate limit (AD-9): per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).

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
                  "foldHashX": "<sha256 hex>",
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
- Rate limit (AD-9): per-caller cap 20/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).
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
- `target.repos` — required; non-empty unique array of proposal-repo names, ≤16 entries (the platform's per-request repo cap). Subject to the platform's repo rules (AD-9 allowlist, enforced in demo mode → `403 repo-not-allowed`).
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
- Errors: `400 {ok:false,error:"bad-request"}` malformed body/target; `400 {ok:false,error:"unknown-set"}` setId outside the whitelist; `503 {ok:false,error:"judge-unavailable"}` binding missing, model mismatch, or schema-invalid answers — fail closed; `429 {ok:false,error:"rate-limited"}` per-caller cap 30/min (AD-9, see Rate limits); `500` unexpected, platform envelope.
- The caller cannot name or choose a model — the pinned id lives in code. Judgments are advisory: the auto-land gate (when it exists) is evaluated inside `POST /land`, before fold and push (AD-11) — clients render verdicts, never decide them.

### Card-signal vocabulary (setId `v1`)

The three signals the card chips render — the complete judge vocabulary the UI consumes:

- **risk** — `risk.label` ∈ {`routine`, `focused`, `senior-security`} (thresholded in code) + `risk.score` = probability-weighted level index over the ordered 3-level rubric, range [0,2].
- **intent vs diff** — `intent.verdict` ∈ {`supports`, `contradicts`, `insufficient`} (insufficient = no intent / insufficient evidence) + `intent.overclaim` = noul probability [0,1], `null` when the verdict is insufficient.
- **semantic collision** — `collision` boolean: same-behavior collision between proposals; distinct lens from the diff3 adjacency map (`/proposals` conflicts) — both are true signals; render both.

Thresholds, weights, and labels live in code (AD-11): the wire carries typed answers, never prose. Cards for `skipped` proposals render no judge chips; a skip is not a verdict. **The judge advises; code decides; humans still own irreversible acts.**

## POST /reveal

Read a secret-class VALUE through the authorized, audited seam rule (FR-31) — the only route that returns a secret-class value, and only to an explicitly authorized identity, only for a secret-class path, only server-side from Artifacts.

Body:

```json
{ "repo": "agent-5", "ref": "main", "path": "config/.env", "key": "DATABASE_URL" }
```

- `repo` — proposal-repo name (charset rules, AD-9 allowlist). Invalid name → `400 {ok:false,error:"invalid repo name"}`.
- `ref` — the ref the repo is read at (same `REF_RE` + no `..` + no leading/trailing `/` rules as `/changes`). Invalid → `400 {ok:false,error:"invalid ref"}`.
- `path` — the file path: non-blank, no `..` segment, no leading `/`. Invalid → `400 {ok:false,error:"invalid path"}`.
- `key` — the `KEY=VALUE` key to read: `/^[A-Za-z_][A-Za-z0-9_]*$/`. Invalid → `400 {ok:false,error:"invalid key"}`.
- The request schema is **closed**: any unknown top-level field → `400 {ok:false,error:"bad-request"}`. Validation precedes authorization (400 precedes 403, the same precedence class as `POST /land`).

**Authorization** (defense-in-depth, two gates):

1. The dispatcher's `authorize()` mode gate — deny mode (`AUTH_MODE` absent/≠`demo`) → `401 {ok:false,error:"unauthorized"}` (the route's `repo` is body-carried, so the dispatcher's query-param-only scope cannot adjudicate it — the demo-namespace 403 below is enforced in the handler). Mutating route: the cookie-identity CSRF precondition applies (cookie without a matching `x-csrf-token` → `403 {ok:false,error:"csrf-required"}`), same as `/land` and `/judge`.
1a. Demo-namespace allowlist (AD-9) — `repo` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false,error:"repo-not-allowed",detail}` enforced **in the handler** (the POST body is the scope carrier, as with `/judge` and `/land`), before the reveal rule and before any Artifacts read.
2. The explicit reveal rule `env.REVEAL_ALLOW` — a JSON array of `{ "id": "<opaque bearer token>", "repos": ["agent-5"]? }`. `repos` absent ⇒ the identity may reveal any demo-namespace repo; present ⇒ only those. **Default = no one**: `REVEAL_ALLOW` absent, malformed, or an identity not listed (or listed but outside its `repos` scope) → `403 {ok:false,error:"reveal-not-authorized"}` — **no value** in the body.

**Identity carrier**: `Authorization: Bearer <token>` — the same opaque token every route carries (no SSO yet; the reveal rule IS the explicit authorization rule FR-31 required).

**Response (granted)** — `200`:

```json
{ "ok": true, "repo": "agent-5", "ref": "main", "path": "config/.env", "key": "DATABASE_URL", "value": "<raw text after = on the matching KEY=VALUE line>" }
```

- `value` = the raw substring after the first `=` on the matching `KEY=VALUE` line, read from the Artifacts blob **only when authorized** and **only for secret-class paths** (`isSecretPath`: basename `.env*`, `*.pem`, `*.key`, `*.p12`, `credentials.json`, `secrets.json`, `.dev.vars`, or any path containing `secrets/`).
- Non-secret-class path (authorized) → `400 {ok:false,error:"not-secret-class"}`; missing file → `404 {ok:false,error:"not-found"}`; binary file → `415 {ok:false,error:"binary"}`; key absent from the file → `404 {ok:false,error:"key-not-found"}`.

**Audit** — every grant **and** every denial writes a content-free record to `env.REVEAL_AUDIT` (KV, best-effort: a KV failure never fails the request):

```json
{ "identity": "<opaque token>", "repo": "agent-5", "path": "config/.env", "key": "DATABASE_URL", "decision": "granted|denied", "at": "<iso>" }
```

- The record carries **exactly** `{identity, repo, path, key, decision, at}` — **never the value**. By type there is no `value` field, so the stored JSON cannot carry the secret. The audit is written at the **authorization decision point**: a denial is audited before the 403; a grant is audited as soon as authorization succeeds, so a later `400 not-secret-class` / `404` still carries its `granted` record (the authorization event happened).
- The value appears in **exactly one place**: the authorized `200` response. It is never logged.

**Non-goal**: no other route or view gains a value surface; the schema-only view (the `secret`/`keys` fields and the withheld notice in §Secret classes) is unchanged and remains the complete default surface. `POST /reveal` reads values *in addition to*, not instead of, the masking law.

## GET /events

`{ "ok": true, "events": [{"type","repo","ref","after","at"}] }` — newest first, ≤50, from KV. Token events (`token.created`, `token.revoked` — the live open-beta Artifacts envelope, normalized from `cf.artifacts.token.*`; also accepted in the documented `repo.token.*` form) carry `{type,repo,at}` — `ref`/`after` are absent (token lifecycle has no ref; `validateEvent` allows absent ref/after). The `tokenId` never reaches KV — the consumer maps only `source.repoName`→`repo`, so the id is dropped at the consumer seam by construction.

## POST /intents

Declare an intent **before** building — the platform matches it against the fork ecosystem and returns a verdict plus the candidate forks that already carry the work (CAP-10, join-don't-restart). Advisory: the route writes nothing and lands nothing (mirrors `/judge`).

The matcher and its three verdicts are defined in the companion spec `fork-community.md` (the CAP-10 companion).

Body:

```json
{ "intent": "<text, ≤2048 chars>", "base": "demo" }
```

- `intent` — required, non-empty string, ≤2048 chars: what the caller is about to build.
- `base` — optional; the base repo to match against; default `"demo"`. Must match the AD-9 allowlist, else `403 {ok:false, error:"repo-not-allowed", detail}`.
- Closed schema: unknown body fields → `400 {ok:false, error:"bad-request"}` (same bucket and precedence as `/judge`).
- Untrusted text (AD-4): `intent` is untrusted caller content — it enters the matcher delimited and labeled as data; instruction-like text is stripped; the AD-4 masking filter applies — secret-class paths enter as key names only, and no secret-class value may enter matcher state or any log (mirrors `/judge`).

**Response (200)**:

```json
{ "ok": true, "verdict": "merge-it", "candidates": [
  { "repo": "agent-3", "rationale": "<platform-generated>", "signals": { … } }
] }
```

- `verdict` ∈ `merge-it | use-as-context | ignore` — one verdict per declared intent.
- `candidates` — the forks whose signals drove the verdict, ordered by the matcher's confidence; each carries `repo`, `rationale` (platform-generated, no caller echo), and the six-cluster `signals` object — `fitOverlap`, `peopleTrust`, `liveness`, `proof`, `distance`, `costToAdoptVsRegenerate` (typed numbers/null; thresholds in code per AD-11).

### Matcher verdict vocabulary (CAP-10)

The three verdicts, defined in the companion spec `fork-community.md` (the CAP-10 companion):

- **merge it** — their work does the job — direct merge recommendation
- **use as context** — partial fit — build with their implementation in hand; LLM-merge/refactor economics apply
- **ignore** — different goal

The wire tokens are the kebab forms `merge-it | use-as-context | ignore`; the definitions above are the canonical prose. Signals trigger investigation, never auto-decision.

- Demo-mode allowlist (AD-9): `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller cap 30/min → `429 {ok:false,error:"rate-limited"}` (see Rate limits).
- Precondition order: `400` (shape) → `429` → `403` → `200`.
- `400` bad input; `500` unexpected.

## GET /forks?base=demo

The fork ecosystem for a base repo — each fork's six-cluster signals and its upstream lineage (CAP-10).

**Response (200)**:

```json
{ "ok": true, "base": "demo", "forks": [
  { "repo": "agent-3", "signals": { "fitOverlap": 0.9, "peopleTrust": null, "liveness": 0.7, "proof": null, "distance": 0.2, "costToAdoptVsRegenerate": 0.4 },
    "upstream": { "repo": "demo", "forkPoint": "<sha>" } }
] }
```

- `base` — the queried base repo (echo of the allowlist-validated `base` param; default `"demo"`).
- `forks` — the fork set for `base`; `signals` is the six-cluster object — `fitOverlap`, `peopleTrust`, `liveness`, `proof`, `distance`, `costToAdoptVsRegenerate` — typed numbers or `null` (unmeasured); thresholds live in code (AD-11): the wire carries typed values, never prose.
- `upstream` — the recorded lineage `{repo, forkPoint}`: the repo this fork forked from and the fork-point SHA as of fork time. `null` when lineage is unrecorded.
- Demo-mode allowlist (AD-9): `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller cap 60/min → `429 {ok:false,error:"rate-limited"}` (see Rate limits).
- Fork-point walk limit: lineage resolution uses the same first-parent walk, limit 200, as the change-set fork point (§Change-set semantics — fork point).
- `400` bad input; `500` unexpected.

## POST /upstream

Route a fork's work back to the repository it forked from — merge-back-to-upstream with `/land`-shaped evidence (CAP-10).

Body:

```json
{ "repo": "agent-3", "base": "demo", "reviewed": { "baseHead": "<sha>", "heads": { "agent-3": "<sha>" } } }
```

- `repo` — required; the fork repo whose work is routed upstream. Must match the AD-9 allowlist, else `403 {ok:false, error:"repo-not-allowed", detail}`.
- `base` — optional; the upstream (the repo `repo` forked from); default `"demo"`. Must equal the **recorded** upstream for `repo` — a fork can never merge into a repo it is not a fork of (`base` ≠ recorded upstream → `409 {ok:false, error:"conflict", detail}`); unknown lineage → fail closed (`409 {ok:false, error:"conflict", detail}`).
- `reviewed` — the same optional reviewed-state precondition as `POST /land` (AD-3): `{baseHead, heads}`; same precedence (`400` shape → `409 stale`).
- Closed schema (AD-9): unknown body fields → `400 {ok:false, error:"bad-request"}`.
- Fold/merge semantics, the content-identity `foldHash`, and the validation ledger are identical to `POST /land` (diff3 fold, in order, server-side push over the v1 wire protocol).
- Secret-class files: if any affected file is secret-class → `409 {ok:false, error:"withheld-secret", files:[...]}` (same withholding law as `/land`).
- Conflict → `409 {ok:false, error:"conflict", conflicted:[...], detail}`.
- Fold produces zero changes → `409 {ok:false, error:"no-changes", detail}`.
- Concurrency precondition: after the in-memory clone and before the push, the worker re-reads the base head; if it no longer equals the head the fold was computed against → `409 {ok:false, error:"base-moved", detail}` (nothing is pushed).
- Success → `200` carrying the **same `evidence` object shape as `POST /land`** — mechanically key-set-identical: `repos, commit, ancestor, heads:{base,repos}, foldHash, checks, results, mergedSha, testedSha, artifactRef, at, lease` (`lease` is the advisory DO lease note or `null`, identical to `/land`'s 12-key evidence; plus the `landed` envelope, identical to `/land`).
  - `ancestor` maps the routed fork to the fork-point commit used as its 3-way ancestor; `heads` are the base and fork heads the fold was computed against.
  - `foldHash`/`mergedSha` and the `checks`/`results` ledger (reserved `merged-sha-equals-tested-sha` entry, `pass`/`mismatch`/`not-recorded`) follow the `/land` rules verbatim.
  - The record is persisted keyed by the returned commit — KV `LIVE`, key `landing:<commit>` (same single writer and read-back surface as `/land`: `GET /landings/{commit}`).
- Demo-mode allowlist (AD-9): `repo` and `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller cap 20/min → `429 {ok:false,error:"rate-limited"}` (see Rate limits).
- Precondition order: `400` (shape) → `429` → `403` → `409 stale` → `409 withheld-secret` → `409 conflict` → `409 no-changes` → `409 base-moved` → `200` (mirrors `/land`).
- After the upstream landing, a `repo.pushed` event for the base repo flows through `/events` — the UI refreshes itself.
- `400` bad input; `500` unexpected.

**Companion spec**: `fork-community.md` — the CAP-10 companion (intent router, matcher verdicts, fork-card signals, mechanisms).

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

- `event:` — the normalized event type (`repo.pushed`, `repo.forked`, `repo.created`, `token.created`, `token.revoked`; normalized via the same `normalizeEventType` as the queue consumer — `cf.artifacts.` prefix stripped). Token events carry `{type,repo,at}` only — no `ref`/`after` (token lifecycle has no ref). The live open-beta environment emits `cf.artifacts.token.*` (normalized `token.*`); the documented `cf.artifacts.repo.token.*` (normalized `repo.token.*`) form is also accepted.
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

## Client protocol (AD-14)

The 11-entity protocol + the contract-pinned push-event surface below is THE client contract — authored from the authoritative list in `_bmad-output/specs/spec-next-git-platform/interface-contract.md`. GitHub-specific semantics (`reviewDecision`, `mergeStateStatus`, `mergeable`) are synthesized in the adapter — never in the client, never in the core.

### Entities (interface-contract.md order)

1. **Floor / Project** — `id, name, repo, branch, cloning, counts (workers/busy/waiting)` — **Served by the platform (partial)**: namespace repos, branch, proposal counts render from `GET /proposals` (`base`, `proposals[].repo`, `summary`); `cloning`/worker counts client-local until `e11-impl-entity-surface-boundary` lands its route.
2. **Worker** — `id, name, provider/model/effort, desk, status, worktree{branch,path,base}, pr, task, activity, usage` — **Client-local** (Agent Office owns worker state; harness dispatch is control-plane, AD-7; no server-side shape invented).
3. **Task / Queue** — `id, provider/model/effort, issue, title, prompt, status, workerId, branch, outcome, pr` — **Client-local** (task store = bd/beads at `.beads/`, outside the platform API).
4. **Issue** — `number, title, state, author, labels, assignees, taken?, body` — **Client-local** (GitHub-owned; no platform issue API yet — roadmap).
5. **Pull / Proposal** — `number, title, state, draft, reviewDecision, headRef, baseRef, checks, additions/deletions, closes[]` — **Served by the platform (partial)**: title/state/stats/checks from `GET /proposals` (`proposals[]`: `repo, head, intent?, stats, landing, files[]`); `reviewDecision`/`draft`/`closes[]` are adapter-synthesized GitHub semantics (AD-14) derived from `landing.status` + `stats`.
6. **PR / Proposal detail** — `body, mergeable, mergeStateStatus, commits, comments, reviews, checks` — **Served by the platform (partial)**: `commits` from `GET /changes` (`commits[]`: `hash, message, author, timestamp`); merge simulation from `GET /merge` (`status`, `files[]`, `conflicted[]`); `body/comments/reviews` adapter-synthesized or client-local.
7. **Presence / Peer** — `id, name, position, voice, sharing, doing, floor` — **Client-local** (peer presence is a client overlay; the platform's peer surface is the `peer.*` event family below).
8. **Whiteboard** — `strokes + cursors per floor` — **Client-local** (per-floor whiteboard state; not persisted by the platform).
9. **Services** — `worker, branch, page title, local port` — **Client-local** (per-worker preview services; no platform route).
10. **Settings** — `limits, leave-on-merge, default agent, prompts, map/theme` — **Client-local** (client preferences; platform-side limits live in code as AD-8 pinned defaults).
11. **Chat / Notifications** — `from, text, at` — **Client-local** (the platform's notification surface is the `chat`/`toast` event families below).

Each row carries an explicit **Served by the platform (partial)** / **Client-local** marker; client-local rows state no server-side shape is defined for the entity in this contract (the sibling story `e11-impl-entity-surface-boundary` is the only order that adds served routes, and it must land its shapes here first — it depends on this story).

### Push-event vocabulary (pinned push surface)

Transport: `GET /events` durable read + `GET /events/stream` SSE hub — the `{type, repo, ref, after, at}` frame (§GET /events / §GET /events/stream). The vocabulary names the families; the wire shapes stay the pinned frame; no new event types are invented:

- `worker.spawn` / `worker.update` / `worker.remove` — fleet membership lifecycle.
- `worker.worktree` — worktree create/ready/dispose.
- `term.data` / `term.snapshot` / `term.input` — terminal streaming protocol (snapshot + per-row diffs + scrollback + input).
- `screen` — screen/view state.
- `floor.enter` / `floor.added` / `floor.removed` — floor membership.
- `peer.join` / `peer.update` / `peer.leave` / `peer.move` / `peer.act` / `peer.emote` — presence/peer activity.
- `chat` — chat messages (`from, text, at`).
- `toast` — transient notifications.
- `queue` state — queue depth/status transitions.
- Issue/pull lifecycle events — platform-native equivalents of `gh.*`, served today as the repo-event families already on the wire: `repo.pushed`, `repo.forked`, `repo.created` (+ token lifecycle `token.created` / `token.revoked`), the normalized `GET /events` vocabulary.

## API boundary

The dispatcher matches a request against the route tables (`ROUTES` + `DYNAMIC_ROUTES`, the single registration point — AD-8) and then classifies the remainder at the boundary, before `authorize()`/CSRF:

- **Known path, wrong method** → `405 { "ok": false, "error": "method-not-allowed" }`. A registered path addressed with a method no route accepts is a client error, more specific than an unknown path (405-before-404 precedence).
- **Unknown path** → `404 { "ok": false, "error": "not-found" }`.
- **UI document** (`/`, `/index.html`, `/styles.css`, `/app.js`, `/tour.html`, `/tour.css`, `/tour.js`) → served by the wrangler-assets binding (`env.ASSETS`), which serves exactly `platform/ui/`'s documents. This whitelist is closed and additive-only: a new UI file is added to the whitelist AND the route-discipline parity check in the same commit.

The 405/404 envelopes are static literals (no user input reflected) and fire before the auth chokepoint, matching the handler-level 400/404/409 precedent — a malformed or mis-addressed request is rejected at the boundary without reaching `authorize()`. This replaces the previous behaviour where a known path with the wrong method and any unknown path both fell through to the asset layer (an information-shaping defect: an undocumented surface answered requests the contract says must be JSON errors).

## Notes mirror (intent plumbing)

The Artifacts binding cannot resolve `refs/notes/*` (server-side limitation, measured). Intent is read from a branch mirroring the notes ref. Runner push recipe — one command, three refspecs, executed by the runner after the agent exits (agents never push refs; AD-5 — see "Harness onboarding (BYO)" below):

```
git push origin main +refs/notes/commits +refs/notes/commits:refs/heads/nextgit-notes
```

The notes ref and its mirror are **derived, single-writer state** — the `+` (force) prefix is deliberate: forks inherit a stale mirror from the base, and an unforced mirror push is rejected non-fast-forward, leaving intent dark (root-caused 2026-10-10). The mirror is always `:= refs/notes/commits`.

Fallback source: `NEXTGIT_INTENT/<sha>.txt` (or `NEXTGIT_INTENT/intent.txt`) on that branch. Response shape unchanged (`intent` string, omitted when absent).

## Harness onboarding (BYO)

Agents are dispatched through a **declarative harness registry** — onboarding a new agent CLI is a declaration, not a code edit. Four contracts pin the whole surface:

**1. Declaration schema.** The registry is a JSON array; each entry declares: `id` (required, non-blank, unique), `bin` (required, non-blank, resolvable on `PATH`), `args` (string array, required unless `stdinPrompt: true`; must carry the `{prompt}` placeholder and may carry `{cwd}`), `stdinPrompt` (optional boolean — when `true`, `args` is omitted and the runner feeds the prompt on stdin), `env` (optional string→string map merged into the agent subprocess env), `probeBudgetMs` (optional non-negative number), `notes` (optional free text). The shipped registry lives at `platform/scripts/harnesses.json`; operators overlay a BYO file via `NEXTGIT_HARNESSES` (additive, same-id override). Validate any registry — shipped or BYO — with `node platform/scripts/real-agents.mjs --check-harness <registry-file>`, which exits 0 with `{ok: true, harnesses, errors: []}` on a valid file and non-zero with a per-entry `{id, field, detail}` error report otherwise.

**2. Probe contract.** A route is dispatched only after a scratch-dir edit test proves the harness can authenticate and write the filesystem: the runner clones a throwaway git repo, asks the agent to create `hello.txt`, and judges by the **on-disk artifact** — never the CLI's self-reported success. Budget: `probeBudgetMs ?? 4 min`. A harness that fails the probe is never dispatched a task.

**3. Dispatch lifecycle.** The control plane forks an isolated clone per task and mints a repo-scoped write token (AD-7). The agent edits its own clone. When the agent exits, the runner commits leftover work (`git add -A` + `git commit`), adds the intent note (`git notes add -m`), and performs the single three-refspec push. **Agents never push refs** — the agent prompt explicitly forbids `git push` ("Do not run `git push` — the runner pushes for you."). The push recipe:

```
git push origin main +refs/notes/commits +refs/notes/commits:refs/heads/nextgit-notes
```

**4. Credential rule.** The agent subprocess env carries **no push credential**. The minted token lives only in the runner's `git` wrapper — `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` carrying `Authorization: Bearer …`, applied per-call in `runAgent`'s `git()` helper — while the agent subprocess inherits only ambient env plus the entry's `env` map.

**Validation contract.** `--check-harness` validates exactly the named file (ambient `NEXTGIT_HARNESSES` can neither pollute the verdict nor the exit code): a missing argument exits 2; a file that cannot be read or parsed reports `{field: "file"}`; structural violations (schema above) and semantic violations (no `{prompt}` placeholder with no `stdinPrompt`, unresolvable `bin`) are all collected and reported, fail-closed with exit 1.

## Authorization (FR-45 / AD-9)

A single `authorize(request, env, action, {repo|base})` chokepoint is called by every route; `AUTH_MODE` defaults to deny; the demo opts in explicitly (`demo`).
- **Demo mode** (`AUTH_MODE="demo"`): routes run; the demo repo allowlist (`demo`, `agent-*`, scratch chains `demo-lh-*` / `agent-lh-*` / `agent-e2s-*` / `agent-e4r-*`) is enforced at the `authorize()` chokepoint on **every** route — any `repo`/`base`/`repos` name outside the namespace → `403 {ok:false,error:"repo-not-allowed",detail}` before any repo read. POST `/judge`, `/land`, `/intents`, `/upstream` **and `/reveal`** carry the allowlist in their handlers (their bodies are parsed only there) with the identical 403; on `/judge` the 403 interleaves after the per-IP 429 rate-limit and the AI-availability 503 (neither reads a repo, so the no-repo-read-before-rejection invariant still holds).
- **Deny mode** (default): every API route returns `401 { ok: false, error: "unauthorized" }` before any repo read (no `env.ARTIFACTS.get()` is reached on a denial).
- **Identity carrier:** opaque token in the `Authorization` header (Bearer prefix stripped by handlers). In demo mode any non-empty token is accepted (no identity resolution yet — the reveal-behind-seam story adds it later).
- **CSRF precondition (mutating routes):** every `POST` route runs the CSRF gate after `authorize()` and before the handler — a request carrying any `Cookie:` header (cookie-carried identity) must also present a matching `x-csrf-token` header, else `403 {ok:false,error:"csrf-required"}`. Header-only callers are unaffected; GET routes are unaffected. The expected-token source (`csrfExpectedToken`) deliberately returns `null` until the SSO identity path lands, so a cookie-carrying POST is a hard deny — fail closed.
- **Seam precondition (FR-45):** `assertSeamEnabled(env)` throws `seam-not-enabled` unless `AUTH_MODE === "demo"` — no non-demo data path may run before the full auth seam lands; callers gate non-demo work behind it so an unwired seam fails closed before any binding read.
- **Reveal authorization rule (FR-31):** `POST /reveal` layers a second, explicit gate on top of the mode gate — `env.REVEAL_ALLOW` (JSON array of `{ id, repos? }`) decides WHO may read a secret-class VALUE. Default = no one: absent/malformed/unknown identity ⇒ `403 {ok:false,error:"reveal-not-authorized"}`, value never read. Every grant AND denial writes a content-free audit record to `env.REVEAL_AUDIT` (never the value). See §POST /reveal.

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

### Token audit log lines (FR-36)

Every worker-minted token is audited at two surfaces: the Worker logs (observability) and the Artifacts token events (`token.created` / `token.revoked`, delivered through the queue subscription and surfaced in `GET /events`). The log surface emits exactly two content-free lines via the `console.log(event, JSON.stringify(fields))` idiom:

```
token-mint {"repo":"<base>","ttl":300}
token-revoke {"repo":"<base>","phase":"success|failed"}
```

- `token-mint` — one line per mint, immediately after `createToken` in `POST /land`'s critical section. `repo` is the base repo name; `ttl` is the mint TTL in seconds (`TOKEN_TTL_SECONDS`, 300).
- `token-revoke` — one line per revoke attempt in the land `finally`. `phase` ∈ {`success` (revoke returned), `failed` (revoke threw)} — a failed revoke is audited, never silent (best-effort posture unchanged; the short TTL still bounds exposure).

**No secret content:** the token string, its plaintext, and its request body never appear in any log line — `auditToken` call sites pass closed literals (`{repo,ttl}` / `{repo,phase}`) only (NFR-3). The token `id` never reaches the feed: the queue consumer maps only `source.repoName`→`repo`, so token events surface as `{type,repo,at}` entries. The live open-beta Artifacts environment emits the token events as `cf.artifacts.token.created` / `cf.artifacts.token.revoked` (normalized `token.created` / `token.revoked`); the consumer accepts both that form and the documented `cf.artifacts.repo.token.*` (`repo.token.*`) form.

## Rate limits (AD-9)

Edge rate limits cover the seven bound routes in the table below (`/land`, `/merge`, `/proposals`, `/judge`, `/forks`, `/intents`, `/upstream`). AD-9 says "edge" rate limits; the as-built substitute is an in-isolate fixed window (per-Workers-isolate, not global), the documented closest substitute until the edge limiter ships — an N-isolate deployment has N x the cap. The limiter deliberately fails OPEN for unbound routes (only the bound routes in the table below are limited).
| Route | Cap | Window |
|---|---|---|
| `POST /land` | 20 | 60 s |
| `GET /merge` | 60 | 60 s |
| `GET /proposals` | 60 | 60 s |
| `POST /judge` | 30 | 60 s |
| `GET /forks` | 60 | 60 s |
| `POST /intents` | 30 | 60 s |
| `POST /upstream` | 20 | 60 s |

- **Caller key:** `CF-Connecting-IP` (set by Cloudflare's edge in production; client-supplied in local dev), fallback `"unknown"` when absent. Each route's window is independent per caller — a flood on one route cannot evict another route's windows.
- **Uniform 429 body:** `{ok:false,error:"rate-limited"}` — no caller echo, no remaining-count leak (NFR-3 posture preserved).
- **Per-isolate bound:** each route's key-space is capped at 500 entries; expired windows are swept only when a route's map exceeds 500 keys (O(500) amortized).
- **Precondition order:** POST routes run `400` (shape) → `429` → `403` (handler-side allowlist) → `409`... → `200`. GET routes run the `authorize()` chokepoint first, so a charset-valid non-allowlisted `repos` param 403s at the chokepoint before the limiter; inside the handler the order is `400` (param parse) → `429` → compute. The limiter is therefore mode-agnostic by construction — reachability is mode-gated by the chokepoint that already precedes every handler.
- **Key-space discipline:** the limiter is a gate, not an auth primitive — it cannot grant access, and it runs after `authorize()` for GET routes. IP-keyed caps are evaded by IP rotation (known IP-keyed-limiter limitation; the M2 identity seam layers a real identity). 429 denials are not audited (no denial-audit surface exists; reveal-audit is a separate seam).
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

`POST /land` uses a Durable Object lease (`LAND_LEASE` binding, `LandLeaseDO` class) to serialize concurrent lands per base repo across Workers isolates. The lease is advisory-first and internal: `acquire` returns `{ acquired: boolean, leaseId: string | null }`; on `!acquired`, the caller is refused with the existing `409 {ok:false, error:"base-moved", detail:"..."}` shape (no new response fields). The lease key is `lease:<base>` — single key per base — with a 30-second TTL and lazy expiry (plus native DO hibernation). When `env.LAND_LEASE` is undefined (e.g. local dev), `acquireLandLease` returns `null` and the route falls back to AD-3's push-rejection conversion. The winner acquires the lease, lands, and releases on completion; losers are refused deterministically.


## Platform VERIFY gate

Every platform deploy runs two live probes as a non-negotiable VERIFY gate. Both are read-only against the live worker — they never land/push/fork/delete `demo` or `agent-1..5`:

- `node porting/tests/land-hardening.probe.mjs` — AD-3 fold-merge + landing correctness across success and induced-failure paths.
- `node porting/tests/egress-guard.probe.mjs` — AD-9 E8 credential egress guard: scans every route's raw response body across success and induced-failure paths (200/500/400/403/404) for `Bearer` tokens, `Authorization:` headers, Artifacts token shapes, and shell snippets. Includes a self-test that injects a synthetic token into a body and asserts the scanner detects it (proving the scanner is not a no-op). The probe also structurally verifies that the 500 push-failed path's `files` projection strips `merged` content — only `{path, action, result}` survive, so file-content payloads can never echo in a failure response.

A deploy is not "done" until both probes exit 0.
