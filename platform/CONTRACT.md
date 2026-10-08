# nextgit-platform — frozen API contract

Version: v2.1 (2026-10-08). Additive changes only; if you change a shape, bump this file first.
Dev base URL: `https://nextgit-platform.john-b7d.workers.dev`
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
- `skipped[]` — proposals not judged: `{repo, reason}` with `reason` ∈ `secret-class` (the change-set touches a secret-class path — its content cannot enter state, AD-4; the repo is listed by **name only** — no paths, no keys, no content) | `empty-change-set` (nothing to judge — the fold produces zero changes). Both arrays are always present.
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

## UI

`GET /` serves the triage UI (`platform/ui/` via wrangler assets). API routes fall through to the worker.

## Notes mirror (intent plumbing)

The Artifacts binding cannot resolve `refs/notes/*` (server-side limitation, measured). Intent is read from a branch mirroring the notes ref. Agent push recipe — one command, three refspecs:

```
git push origin main refs/notes/commits refs/notes/commits:refs/heads/nextgit-notes
```

Fallback source: `NEXTGIT_INTENT/<sha>.txt` (or `NEXTGIT_INTENT/intent.txt`) on that branch. Response shape unchanged (`intent` string, omitted when absent).

## Secret classes (masking law)

Path matches: basename `.env*`, `*.pem`, `*.key`, `*.p12`, `credentials.json`, `secrets.json`, `.dev.vars`, or any path containing `secrets/`.

**Secret file values must never appear in any response body** — no patch, no merged text; only key names (`keys[]`).

Masking is **path-driven by design** in this version: a secret value placed in a non-secret-class path is not redacted — values must live in secret-class paths. Secret-class rows carry no `intent` and no patch; `keys[]` is the complete schema surface for them.
