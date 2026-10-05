# nextgit-platform — frozen API contract

Version: v2 (2026-10-03). Additive changes only; if you change a shape, bump this file first.
Dev base URL: `https://nextgit-platform.john-b7d.workers.dev`
Namespace: `nextgit` · baseline repo: `demo` (branch `main`) · demo proposals: `agent-1` … `agent-4`

All endpoints JSON. Errors: `{ "ok": false, "error": "..." }` with 4xx/5xx.

## GET /health

`{ ok, service, namespace }`

## GET /changes?repo=...&base=demo&ref=main&baseRef=main

Per-proposal change-set (server-side; no clones).

```json
{ "ok": true, "changeSet": {
  "base": {"repo","ref","treeHash"}, "head": {"repo","ref","treeHash"},
  "stats": {"files","added","modified","removed","additions","deletions"},
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

## GET /proposals?base=demo&repos=a,b (repos optional → auto-discover `agent-*`)

The set view + conflict map.

```json
{ "ok": true, "base": {...}, "ref": "main",
  "proposals": [ {"repo","intent?","stats","landing":{"status":"ready|conflict|landed|withheld-secret","files":N},"files":[{"path","status","additions","deletions","secret?","keys?"}]} ],
  "conflicts": [ {"file","repos":["agent-1","agent-2"],"kind":"text-conflict",
                  "pairs":[{"a":"agent-1","b":"agent-2","kind":"text-conflict","conflict":true,"region":{"baseLines","aLines","bLines"}}]} ],
  "summary": {"proposals":4,"changedFiles":4,"sharedFiles":1,"conflictingPairs":1,"cleanPairs":0}
}
```

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
- After landing, a `repo.pushed` event for the base repo flows through `/events` — the UI refreshes itself.
- `400` bad input; `500` unexpected.

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
