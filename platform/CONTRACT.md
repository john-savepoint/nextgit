# nextgit-platform — frozen API contract

Version: v3.10 (2026-10-14). Additive changes only; if you change a shape, bump this file first.
Namespace: `nextgit` · baseline repo: `demo` (branch `main`) · demo proposals: `agent-1` … `agent-4`


## Route defaults (AD-8 — single source)

Every route that accepts `base`, `ref`, or `baseRef` (query or body) resolves an absent parameter through ONE code-owned seam (`resolveRouteBase` in `platform/src/index.ts`) — no route carries a private default:

- `base` — default `demo`
- `ref` — default `main`
- `baseRef` — default **follows `ref`** (i.e. `main` when `ref` is also absent; `baseRef=X&ref=Y` keeps `X`)

**Equivalence rule:** a request with `base`/`ref`/`baseRef` omitted resolves to exactly `base=demo, ref=main, baseRef=main` on **every** route — `/changes`, `/proposals`, `/merge` (GET, query params), `/land` (POST body), and `/judge` (`target.base` / `target.refs[0]`). Omitted == explicit. Pinned behaviorally by `porting/tests/default-resolution.test.mjs` (47 checks: per-route omission, negative control, `baseRef`-follows-`ref` coupling, seam single-source, GET empty-param 400).

**Normalization rule:** the seam (`resolveRouteBase`) defaults only on *absence* (`undefined`). A present value — including the empty string `""` — passes through untouched to the caller's `REPO_NAME_RE`/`REF_RE` validation (an empty base/ref is a 400 on every route, not the default — pinned by `judge.test.mjs` case 5). The only caller that defaults an empty string is the `/land` POST body (truthy guard, pre-existing behavior). Non-string `ref`/`baseRef` values are rejected with a 400 by the caller's validation, never a 500.

**The single documented exception:** `GET /changes` additionally requires `repo` (no default — absent `repo` -> `400 {ok:false,error:"repo parameter required"}`). All other params of `/changes` follow the defaults above.

Routes with no default (unchanged, listed for completeness): `/reveal` requires `repo`, `ref`, `path`, `key`; `/land` requires `repos`; `/judge` requires `setId` and `target.repos`; `/events`, `/events/stream`, `/health`, `/landings/{commit}` take no base/ref params.

## GET /asset/{blobId}

Download a raw asset blob from the R2 asset tier (AD-10; FR-47). The path
param is the **64-hex content-addressed key** — the blob's own sha256 (the
pointer-less content-addressed read: the key IS the content hash, so the
download route carries the expectation in the key itself).

- **200** — the exact blob bytes, verified **before** they egress, served
  `content-type: application/octet-stream` (the binary default — the
  pointer-less download carries no pointer, so no `contentType` is in
  scope; the pointer-mediated materialization path passes the pointer's
  `contentType` at its caller layer).
- **Integrity failure (non-2xx)** — `{ok:false,error:"integrity"}` (422).
  Thrown as `BlobIntegrityError` by the `readVerifiedBlob` chokepoint
  (`platform/src/assets.ts`) and mapped at the route seam: the stored bytes
  hash to a different digest than the blobId key (substitution), the object
  is missing at a content-addressed key (a missing object **is** an integrity
  failure — the route does not oracle key existence), or the binding is
  unbound. Error detail carries digests only, never blob bytes (AD-4).
- **400** — `bad-request`: the blobId is not `/^[0-9a-f]{64}$/`.

The chokepoint verifies **both directions** on every read: `actualSha256 ===
expectedSha256` (pointer/content divergence — for the pointer-mediated
variant the caller passes the pointer's recorded `sha256` as the expectation)
**and** `actualSha256 === blobId` (content-addressed key != stored digest —
the substitution case). Either mismatch fails closed: zero bytes materialize,
no fallback to another key, no cache.

## GET /asset/{blobId}/presign

Mint a short-lived **presigned URL** for one content-addressed blob, so a
large download travels **client-direct to R2** and never through the Worker
(AD-10; FR-47; `nextgit-serve-blobs-via-presigned-direct-to-r2-transfers`).
The path param is the same 64-hex content-addressed key as the download
route, and the presign surface **rides that route's registration** (a suffix
dispatch in the `/asset/` GET handler — one registration, no second route,
no dispatcher change).

Why this exists: a Workers request body caps at 100 MiB (Free/Pro) / 5 GiB
(Enterprise), so the Worker cannot proxy a multi-GB asset. R2 holds objects
to 5 TiB with 5 GiB parts and honours presigned URLs for 1 s–7 d. The Worker
therefore mints URLs and never carries an asset byte.

- **200** — `{ ok:true, blobId, url, expiresAt, expiresIn, range }`.
  `url` is a SigV4-signed URL for the bucket's S3 endpoint
  (`https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>`, path-style);
  it is a **bearer token** — returned in this response only, never stored,
  never logged.
- **400** — `bad-request`: the blobId is not `/^[0-9a-f]{64}$/`; `expires` is
  present but not a positive integer; or `range` is present and not one S3
  range (`bytes=<start>-<end>` / `bytes=<start>-` / `bytes=-<suffix>`).
- **429** — `{ok:false,error:"rate-limited"}`, cap 60/min per caller
  (`ROUTE_RATE_LIMITS["/asset/presign"]`).

Query parameters:

- `expires` — optional lifetime in seconds. Absent → **300** (the default).
  Clamped into **[1, 604800]** (R2's documented minimum and maximum): a
  smaller value floors, a larger caps. A non-integer or non-positive value is
  a **400**, never silently rounded. The emitted `X-Amz-Expires` is the
  clamped value, so `expiresAt` = mint time + `expiresIn`.
- `range` — optional S3 byte range. When present it folds into the **SigV4
  signed-headers set** (`X-Amz-SignedHeaders` includes `range`), so the byte
  range is tamper-evident: the client **must** send that exact `Range`
  header. A different range is a different signature. The response echoes the
  signed value in `range` (`null` when absent).

Precondition order: `400` (blobId, then `expires`, then `range`) → `429`
(rate) → `503` (credentials absent) → `200`. The `authorize()` chokepoint
runs first in the dispatcher, so deny mode 401s before any mint.

**No key-existence oracle:** the route deliberately does **not** head the
object. A blobId's presence is not disclosed by a mint — a presigned URL for
an absent key is useless, not informative (the same property §GET
/asset/{blobId} protects by mapping a missing object to the integrity 422
rather than a 404).

**Fail-closed credentials:** SigV4 signing needs the account id plus the S3
API key pair (`ASSET_ACCOUNT_ID`; `ASSET_S3_ACCESS_KEY_ID` /
`ASSET_S3_SECRET_ACCESS_KEY` as wrangler secrets). ANY of the three missing →
`503 {ok:false,error:"presign-unavailable"}` — never a silent empty-string
credential and never a fallback path.

## POST /asset/uploads

Mint the **direct-to-R2 upload grant**: the URLs a client uploads an asset
with, so the asset bytes never traverse the Worker.

Body (closed schema — any unknown field → `400 {ok:false,error:"bad-request"}`):

```json
{ "repo": "agent-1", "path": "assets/hero.asset.json",
  "sha256": "<hex-64 content hash>", "size": 3221225472,
  "contentType": "image/png", "partSize": 67108864 }
```

- `repo` — required, the `REPO_NAME_RE` charset plus the AD-9 demo allowlist.
- `path` — required, the **asset-pointer path** that will reference the blob
  (`assets/<name>.asset.json`, the tier's own single-source classifier
  `isAssetPointer`) — carrying the change-set path law (non-empty, no `..`
  segment, no leading/trailing `/`, ≤1024 chars). A grant exists to serve a
  pointer; the mint is therefore never scoped to an arbitrary path.
- `sha256` — required, hex-64. **The R2 object key IS this value**
  (content-addressed — the `upload-asset.mjs` convention), so two callers
  declaring the same bytes converge on one object, and the key doubles as the
  integrity anchor the pointer records.
- `size` — required, integer, `0..5 TiB` (`R2_MAX_OBJECT_BYTES`).
- `contentType` — optional, 1..255 chars, no CR/LF.
- `partSize` — optional, integer, 5 MiB..5 GiB. A value below the S3
  multipart minimum is a **400**, never silently clamped (the platform
  refuses to mint a part plan the bucket would reject).

Response `200` — single-part (`size` fits one part):

```json
{ "ok": true, "repo": "agent-1", "path": "assets/hero.asset.json",
  "key": "<hex-64>",
  "upload": { "mode": "single", "url": "<presigned PUT>",
              "expiresAt": "<iso-8601-utc>", "expiresIn": 300 } }
```

Multipart (`size` exceeds one part):

```json
{ "ok": true, "repo": "agent-1", "path": "assets/hero.asset.json",
  "key": "<hex-64>",
  "upload": { "mode": "multipart", "uploadId": "<R2 upload id>",
              "partSize": 67108864, "partCount": 48,
              "parts": [{ "partNumber": 1, "url": "<presigned PUT>" }],
              "expiresAt": "<iso-8601-utc>", "expiresIn": 300 } }
```

- The client PUTs the bytes **directly to the bucket**: one PUT to `url`
  (single) or one PUT per `parts[]` entry (multipart). The Worker issues only
  the **control frames** — `CreateMultipartUpload` here, and
  `CompleteMultipartUpload` on the complete route — so no asset byte ever
  reaches the Worker (the 128 MB Worker memory is never approached).
- Part plan (derived, never hand-added): single when `size <= partSize`,
  else `ceil(size / partSize)` parts; the part count is clamped to
  **10,000** by *growing* the part size (`ceil(size / 10000)`), which keeps a
  5 TiB object addressable without ever exceeding the S3 part limits.
- A declared `contentType` folds into the presigned PUT's signed headers: the
  client **must** send that exact `content-type` on the PUT, so the stored
  object's media type cannot be swapped after minting. Per-part PUTs sign the
  `partNumber`/`uploadId` query instead (the object's content type comes from
  `CreateMultipartUpload`).
- `expiresIn` is 300 s (`DEFAULT_PRESIGN_EXPIRY_SECONDS`); every URL in one
  grant shares one expiry instant.
- Demo-mode allowlist (AD-9): `repo` must match
  `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false,
  error:"repo-not-allowed", detail}` **before any mint** — a repo outside the
  demo namespace never receives a bearer URL. The check runs in the handler
  (the body-carried repo cannot be adjudicated by the query-only
  `extractScope`, the `/raw` carve-out posture).
- Rate limit (AD-9): cap 20/min per caller →
  `429 {ok:false,error:"rate-limited"}` (`ROUTE_RATE_LIMITS["/asset-uploads:write"]`,
  shared with the complete route — see Rate limits).
- Precondition order: `400` (shape) → `403` (allowlist) → `429` (rate) →
  `503` (credentials absent) → `200`.
- `404` — the path remainder after `/asset/uploads` is not empty (the
  handler-side path discipline: this prefix owns exactly that path).
- `502 {ok:false,error:"upload-init-failed", detail:"s3 status <n>"}` — the
  S3 control frame failed. **A control-frame refusal is never a 500**: the
  request was well-formed and the upstream said no. `detail` carries the S3
  status only — never an S3 error body, endpoint, or credential.
- `503 {ok:false,error:"presign-unavailable"}` — credentials absent.

Residual risk (accepted, documented): a presigned URL is a bearer token, so
anyone holding it can perform the one signed operation until it expires.
Mitigations: 300 s default lifetime, 7 d hard cap, the allowlist check and
rate cap before any mint, and CSRF on the minting POST.

## POST /asset/uploads/{uploadId}/complete

Close a client-direct multipart upload. The client returns the part ETags it
collected from R2, and the Worker forwards them to S3
`CompleteMultipartUpload` (still no asset byte in the Worker).

Body (closed schema):

```json
{ "repo": "agent-1", "sha256": "<hex-64>",
  "parts": [{ "partNumber": 1, "etag": "\"<md5 hex>\"" }] }
```

- `repo` — required; AD-9 demo allowlist, enforced before any S3 call.
- `sha256` — required, hex-64: the content-addressed key, which is also how
  the object key is re-derived here (the route stores no session state, so a
  complete is stateless apart from `uploadId`).
- `parts` — required, 1..10,000 entries, **strictly ascending** and therefore
  duplicate-free `{partNumber, etag}` (partNumber `1..10000`). `etag` must be
  the hex part ETag R2 returned (quotes optional, hex/hyphen only, ≤128
  chars) — the shape guard that keeps the value XML-safe in the Complete body.

- `uploadId` (path) — required; the value `CreateMultipartUpload` returned in
  the grant.

Response `200`:

```json
{ "ok": true, "repo": "agent-1", "key": "<hex-64>",
  "etag": "\"<composite etag>\"", "size": 3221225472 }
```

- `etag` — the composite object ETag S3 returned (empty string when the
  response carried none).
- `size` — **measured**, not declared: the object's stored size read from the
  bucket's metadata (`ASSET_BLOB.head` — a metadata read, never a byte read,
  so the §R2 integrity chokepoint's "single byte-returning `get`" property is
  untouched). The typed-null law applies: `null` when the asset tier is
  unreadable, and never the client's declared number.

- `400` — bad shape (unknown key, bad `repo`/`sha256`, empty/oversized/
  non-ascending `parts`, malformed `etag`).
- `403` — allowlist (before any S3 call).
- `429` — `ROUTE_RATE_LIMITS["/asset-uploads:write"]` (shared with the grant).
- `404` — the path remainder is not exactly `<uploadId>/complete`.
- `502 {ok:false,error:"upload-complete-failed", detail:"s3 status <n>"}` —
  S3 refused the complete (e.g. `409` for a bad part list or an unknown
  uploadId). Never a 500, never an S3 error body.
- `503 {ok:false,error:"presign-unavailable"}` — credentials absent.
- Precondition order: `400` (shape) → `403` (allowlist) → `429` (rate) →
  `503` (credentials absent) → `200` / `502`.

Abandoned sessions are not aborted by a route (the client simply stops). The
module carries `abortMultipartSession` for operator/out-of-band use. **Residual
risk (LOW, documented):** the committed bucket lifecycle rule (§R2 asset tier)
carries an `abortMultipartUploadsTransition` (age 604800 s) alongside the
object expiry, so an abandoned incomplete multipart upload **is** reclaimed by
the applied rule (live-verified 2026-10-14: `lifecycle list` shows both the
90-day expire and the 7-day abort actions). The residual is operational only —
a fresh bucket needs the rule applied (`platform/scripts/README.md`); no
client-visible abort route ships in this slice.

## GET /tree?repo=...&ref=main&path=...

Deterministic directory listing for one path of a repo at a ref
(repo browsing; the read API's tree half). `repo` (required, the
AD-9 charset + demo allowlist), `ref` (defaults to `main` via
`resolveRouteBase` — the AD-8 seam, so omitted == explicit) and
`path` (defaults to the repo root `""`; a directory walk rooted
at `path`, never a recursive walk).

- **200** — `{ ok:true, repo, ref, path, entries:[{name,type,size,blobHash}] }`.
  `entries` is the DIRECT child set of `path` at `ref`, in the
  tree's own order (deterministic: the same (repo, ref, path)
  always yields the same entries). `type` ∈ `tree | blob | exec`
  (the Artifacts tree-entry union); `blobHash` is the entry's
  content hash. `size` is `0` for `tree` entries — the Artifacts
  binding carries no size for subtrees, and the contract documents
  the zero rather than fabricating a value (no size oracle).
- **400** — `invalid repo name` / `invalid ref` / `invalid path`
  (charset guards: `REPO_NAME_RE`/`REF_RE`, and `path` rejecting
  `..` segments and leading/trailing `/` — the read-validation
  law every GET route enforces pre-read).
- **401 / 403** — the `authorize()` chokepoint (deny mode / demo
  allowlist), before any Artifacts read.
- **404** — `{ok:false,error:"not-found"}` — uniform existence
  posture: unknown repo, unresolvable ref, or a `path` that is
  not a directory (a FILE at `path` is not a tree) answer the
  same body.

Rate: deliberately UNBOUND (the `/changes` posture — a bounded
directory listing is a cheap read; `ROUTE_RATE_LIMITS` carries no
`/tree` row by design, documented here so the omission reads as
policy, not oversight).

## GET /file?repo=...&ref=main&path=...

One file's content, classified (repo browsing; the read API's
content half). Reads the EXISTING `readContent` seam (the same
`repo.readFile({ref,path})` read `/changes`/`/reveal` drive) —
no new binding method. `repo`/`ref`/`path` validation is the
`/tree` law above (`ref` defaults to `main` through
`resolveRouteBase`).

- **200** — `{ ok:true, repo, ref, path, classification, size }`
  with:
  - `classification:"text"` → `text` (the decoded UTF-8 content)
    and `size` (byte length);
  - `classification:"binary"` → NO `text` field (the content is
    not served inline; use `GET /raw` for the bytes);
  - `classification:"secret"` → `keys[]` ONLY (the AD-4 masking
    law: key names, never values — the existing `isSecretPath` +
    `secretKeys` seam decides the class and extracts the keys
    server-side; the raw value never leaves the worker).
  - `file` — the per-file classification (judge idea 12), present
    on every 200 shape: `{language, role, sensitivity}`. Pure
    path/extension law (`platform/src/classify.ts`); `sensitivity`
    is the AD-4 policy vocabulary (`public | internal | secret`).
- **400 / 401 / 403** — the `/tree` validation + authorize law.
- **404** — `{ok:false,error:"not-found"}` (unknown repo/ref/path).
- **Rate:** 60 per 60 s per caller (`ROUTE_RATE_LIMITS["/file"]`
  — the `/merge`/`/proposals` compute-cost class).

## GET /commits?repo=...&ref=main&limit=20

Deterministic commit log for a repo at a ref (the history half of the
repo-browsing read API; the same read seam as §GET /tree). `repo`
(required, the AD-9 charset + demo allowlist), `ref` (defaults to
`main` via `resolveRouteBase` — the AD-8 seam, so omitted ==
explicit), `limit` (optional; default `20`, hard cap `100`).

Reads EXISTING state only: `repo.log({ref, limit})` — the newest-first
first-parent walk the fork-point computation already drives. No new
binding method, no clone, no tree/blob read, no `ASSET_BLOB` access.

- **200** — `{ ok:true, repo, ref, commits:[{sha, shortSha, message, author, at, parents}] }`.
  - `commits` — newest-first, the log's own order (first-parent chain,
    newest first). Deterministic: the same (repo, ref, limit) always
    yields the same array. Bounded by `limit` (<= 100).
  - `sha` — 40-hex commit id; `shortSha` — `sha.slice(0, 7)`.
  - `message` — commit subject.
  - `author` — `"Name <email>"` (the §GET /changes flattening — the
    same rendering `/changes` gives `commits[].author`).
  - `at` — ISO-8601 UTC **author date** (the platform's `at`
    convention: every other `at` on this wire — events, landings,
    evidence — is ISO-8601). The binding's `authoredAt` (Unix
    seconds) is converted at the projection and never exposed.
  - `parents` — array of 40-hex parent ids in git order; `[]` for a
    root commit. `parents[0]` is the first parent — the deep-link
    target for a per-commit view.
  - Field projection is EXPLICIT: `treeHash`, `committer` and
    `committedAt` from the binding's commit metadata are NOT served.
- **400** — `invalid repo name` / `invalid ref` (the §GET /tree
  charset law: `REPO_NAME_RE`/`REF_RE`, plus the `..` /
  leading-`/` / trailing-`/` refusal) / `invalid limit` (a present
  `limit` must be a positive integer — `0`, negatives, non-numerics
  and the empty string are 400s; the AD-8 normalization rule: a
  present bad value is never silently defaulted).
- **401 / 403** — the `authorize()` chokepoint (deny mode / demo
  allowlist), before any Artifacts read (`repo` is query-carried, so
  the chokepoint's `extractScope` adjudicates it — the §GET /tree
  posture).
- **404** — `{ok:false,error:"not-found"}` — uniform existence
  posture: unknown repo, unresolvable ref, an empty history, or any
  binding failure answers the same body (the §GET /tree mapping).
- **`limit` clamp:** absent => `20`; a present integer is clamped to
  `100` (`?limit=1000` reads the newest 100). The clamp is the
  resource bound — no request drives an unbounded history walk. The
  response carries no `limit` echo.

Metadata egress posture (AD-4): commit messages, author identities and
parent ids are EGRESS — the same commit-metadata family `/changes`
already publishes (`commits[]: hash/message/author/timestamp`). No file
content, patch, secret value or key ever reaches this route; it
performs zero `readFile`/`readBlob`/`ASSET_BLOB` reads by construction
(the log-only seam).

Rate: deliberately UNBOUND (the `/tree` posture — a bounded log read is
a cheap read; `ROUTE_RATE_LIMITS` carries no `/commits` row by design,
documented here so the omission reads as policy, not oversight; the
`limit` clamp bounds the work).

## GET /raw/{repo}

Raw file bytes, `application/octet-stream` (repo browsing; the
binary half of the content API). The path is split on the FIRST
TWO `/` separators only — `repo`, `ref` (which may itself contain
slashes, so a future `refs/heads/*` ref still routes), and the
remainder is the file path. `repo` and `ref` are validated with
the same `REPO_NAME_RE`/`REF_RE` guards as every other route.

Authorization: the path-carried `repo` cannot be adjudicated by
the dispatcher's query-only `extractScope` (the `/reveal`
carve-out), so the handler re-checks the AD-9 demo allowlist
(`DEMO_REPO_RE`) BEFORE any binding read — fail-closed, the
`/reveal` posture.

- **200** — the exact blob bytes, `content-type:
  application/octet-stream`, capped at 8 MiB (`MAX_RAW_BYTES`).
- **403** — secret-class path (`isSecretPath`) — REFUSED BEFORE
  any Artifacts read (fail-closed: a secret-class blob never
  materializes on this route; values surface only through the
  authorized, audited `POST /reveal` seam).
- **404** — `{ok:false,error:"not-found"}` (unknown repo/ref/path).
- **400** — charset-invalid repo/ref or a path violating the
  traversal law (`..` segment, leading/trailing `/`, empty).
- **413** — `{ok:false,error:"too-large"}` when the blob exceeds
  `MAX_RAW_BYTES` (the size is known from the binding's byte
  length; the cap is enforced before the body is assembled).
- **Rate:** 60 per 60 s per caller (`ROUTE_RATE_LIMITS["/raw"]`
  — the byte-egress cost class).

## POST /comments

Append one inline review comment to a repo's per-file review thread (the
data plane behind the merge-modal comment threads). Body:

`{ "repo": "demo", "ref": "main", "path": "src/a.ts", "line": 12, "body": "nit: rename", "author": "reviewer" }`

Closed schema (any unknown field → `400`): `repo` (required, `REPO_NAME_RE`);
`ref` (optional, `REF_RE`; absent → the pinned default `main` via
`resolveRouteBase` — the AD-8 seam, so an omitted `ref` and `ref=main` agree);
`path` (required — non-empty, no `..` segment, no leading/trailing `/`,
depth-capped); `line` (required — a non-negative integer); `body` (required —
1..2000 characters); `author` (required — non-empty; display text only, never
an identity claim).

Each POST appends a NEW comment (fresh 12-hex id, `at` server-set ISO-8601
instant) — the route is **not** idempotent; there is no update or delete.

- **201** — `{ ok:true, comment:{ id, path, line, body, author, at } }` (the `ref` is the read
  filter and is not echoed per row; the `201` carries the created comment).
- **403** — `{ok:false,error:"secret-class"}` — a secret-class `path`
  (`isSecretPath`) REFUSED BEFORE any store access (fail-closed: a secret-class
  comment can never enter the store; the UI layers a matching zero-GET notice
  — deliberate defense-in-depth).
- **403** — `{ok:false,error:"repo-not-allowed",detail}` — `repo` outside the
  AD-9 demo allowlist (the handler-side re-check, the `/land` / `/reveal`
  posture: the body-carried repo is adjudicated before any store access).
- **429** — `{ok:false,error:"rate-limited"}` — per-caller cap 20/60 s.
- **400** — `{ok:false,error}` — bad input: a non-object body or an unknown
  field answers `{ok:false,error:"bad-request"}`; a missing/invalid field
  carries a specific message.
- **Precondition order:** `400` (shape) → `403` (allowlist) → `403`
  (secret-class) → `429` → `201`.
- **Storage substrate (as-built):** comments live as repo-scoped JSONL in the
  CACHE KV namespace at `comments:<repo>` — the worker's established
  script-writable durable namespace (`landing:`, `fork:`, `cache:gen`), so
  threads survive worker restarts. The forward posture is the identical wire
  contract over a `comments.jsonl` tree entry in the Artifacts repo once the
  (read-only) binding exposes a write seam; the wire shape is unchanged under
  either substrate.
- **Rate:** 20 per 60 s per caller (`ROUTE_RATE_LIMITS["/comments:write"]` —
  the write cost class; a distinct key from the GET read budget).

## GET /comments?repo=...&ref=main&path=...

One repo's inline review comments for an exact (`ref`, `path`), in append
order (oldest-first; stable across reads). `repo` (required) is adjudicated
against the demo allowlist at the `authorize()` chokepoint pre-read (the
`/file` posture); `ref` is optional (absent → `main`, the AD-8 seam); `path`
is required (a thread is per-file).

- **200** — `{ ok:true, repo, ref, comments:[ { id, path, line, body, author, at } ] }`
  (append order, oldest-first; an empty store → `comments: []`).
- **400** — `{ok:false,error}` — invalid `repo`/`ref`/`path`, or a missing
  `path` (the message is specific per field).
- **403** — `{ok:false,error:"repo-not-allowed",detail}` — charset-valid
  `repo` outside the demo allowlist (chokepoint).
- **429** — `{ok:false,error:"rate-limited"}` — per-caller cap 60/60 s.
- **Precondition order:** `400` (param parse) → `429` → read.
- **XSS law:** comment `body` and `author` are opaque plain text; the worker
  performs no HTML escaping (the JSON body is exact bytes) — the client MUST
  render them as text (escaped), never as HTML.
- **Rate:** 60 per 60 s per caller (`ROUTE_RATE_LIMITS["/comments"]` — the read
  cost class).

## GET /checks?base=demo&ref=main&baseRef=main&repos=a,b (repos optional → auto-discover `agent-*`)

The authoritative per-proposal checks — the same five checks the
UI's checks strip renders, computed SERVER-side from the same
compute seam `/proposals` drives (`computeProposals` →
`computeChangeSet` + `computeMerge`). The worker is the authority:
the strip consumes this route verbatim and falls back to its own
client derivation ONLY when the route is unreachable (an absent
route never reads as green).

`Check = { id in fold|collision|conflicts|secrets|base, label, state in pass|fail|unknown, detail }` —
the strip's exact tri-state vocabulary, one `Check[]` per proposal
(five entries, in display order). `label` is the chip's display
text (identical to `id` — the five id/label sets are identical,
matching the strip's own render). `detail` is a display string
(`"folds clean"`, `"none"`, `"withheld"`, a conflict count, a
kind/file pair, `"in sync"` / `"base moved since fork"` /
`"fork point not in set payload"`) — NEVER a secret-class path,
key, value, or the fork-point sha itself (the masking law; the
`secrets` check carries state + a count/`"withheld"` only).

**Honesty law (the acceptance):** a check is `pass` ONLY when the
compute seam carries the datum that proves it; a missing datum is
`unknown`, and `unknown` is never rendered or styled as `pass`.
A proposal whose compute throws contributes `unknown` for its five
checks (the `/forks` per-candidate posture) — never a 500.

- **200** — `{ ok:true, base:{repo,ref,head}, checks: Array<{repo, checks: Check[]}> }`,
  one entry per proposal, mirroring `/proposals`' `proposals[]`.
  `base.head` is the same fork-comparison datum the `base` check
  consumes; the comparison result (`in sync` / `base moved since
  fork`) is egress, the sha itself is not.
- **400** — the `parseProposalsQuery` law (empty `base`/`ref`/`baseRef`,
  bad charset — the same charset guards every `/proposals`-family route).
- **403** — the AD-9 demo allowlist at the `authorize()` chokepoint
  (`base`/`repos` are query-carried, like `/proposals`, so the
  allowlist fires pre-handler — zero Artifacts reads before it).
- **429** — the `/proposals` compute-cost class (`ROUTE_RATE_LIMITS["/checks"]`).

Rate: 60/60s (`/proposals`' compute-cost class — the route drives
the same fold).

Read-only; no write/clone/push surface, no `ASSET_BLOB`/`LIVE`/
`EVENTS_HUB` access, no caller identity (credential-free). The
route is a pure projection of the `/proposals` compute — no caller
input enters the derivation beyond the validated `base`/`repos`/
`ref`/`baseRef` params (the cache-key-poisoning law).

### GET /checks — GitHub check-runs export (?format=github)

`?format=github` (optional; absent or any other value = the internal
shape above, unchanged). Pure projection — the same `computeChecks`
output, remapped; no new compute, no new precondition.

- **200** — `{ ok:true, repo, check_runs:[{ name, status:"completed", conclusion:"success"|"failure"|"neutral", output:{ title, summary } }] }`.
  Mapping law (published so a CI consumer recomputes it):
  - `name` = the check `id` (`fold|collision|conflicts|secrets|base`).
  - `state` pass→`conclusion:"success"`, fail→`conclusion:"failure"`, unknown→`conclusion:"neutral"` — the closed set; no other conclusion ever emits.
  - `output.title` = the check `label`; `output.summary` = the check `detail` (the honest serialized detail — the SAME string the internal shape serves; the masking law travels to the projection unchanged: NEVER a secret-class path/key/value, never a fork-point sha).
  - One `check_runs` entry per check per proposal, grouped per proposal by a `repo` echo on the envelope (a 5-proposal set emits 25 check-runs, 5×5).
- `status:"completed"` is constant (the checks are computed post-hoc, never queued/pending).
- **400/403/429** preconditions UNCHANGED (the `parseProposalsQuery` law, the AD-9 chokepoint, the `/proposals` compute-cost class) — the projection adds no precondition and no new failure mode.
- Rate: still 60/60s (`ROUTE_RATE_LIMITS["/checks"]` — the same compute-cost class; no new row).
- **No-cache-poisoning law:** the KV cache stores ONLY the internal body under the format-agnostic key; the github projection is computed AFTER the cache read/hit, so a `format=github` request and a plain request over the same generation share one cache entry and can never poison each other (a cached internal body is re-projected per request).

## GET /health

`{ ok, service, namespace }`

## GET /changes?repo=...&base=demo&ref=main&baseRef=main

Per-proposal change-set (server-side; no clones).

```json
{ "ok": true, "changeSet": {
  "base": {"repo","ref","treeHash","sha"}, "head": {"repo","ref","treeHash","sha"}, "identity": {"fingerprint": "<64-hex sha256>"},
  "stats": {"files","added","modified","removed","additions","deletions"},
  "commits": [{"hash","message","author","timestamp"}],
  "files": [{
    "path": "src/auth.ts", "status": "added|modified|removed",
    "additions": 4, "deletions": 0,
    "classification": {"language":"typescript","role":"source","sensitivity":"internal"},
    "intent": "git-notes text of the head commit, when present",
    "secret": true, "keys": ["DATABASE_URL"],
    "patch": "--- a/src/auth.ts ..."
  }]
}}
```

- `intent` — git-notes text of the head commit, when present.
- `secret`, `keys` — secret-class files only; `patch` omitted for them.
- `classification` — per-file classification (judge idea 12), stamped
  server-side on every row: `{language, role, sensitivity}` (pure
  path/extension law; `platform/src/classify.ts`).
- `patch` — absent for secret/binary/oversized files.
- `note` (compute-downgraded) — a change-set computes at most `MAX_COMPUTE_PATCH_DIFFS` (40) per-file diffs; once that budget is spent, every further file in the set keeps its metadata row and `additions`/`deletions` stay unset, the inline `patch` is omitted, and the row carries `note: "compute-downgraded: patch omitted at the change-set compute budget (40 diffs)"`. This is the honest-degradation law: a file the compute budget skips is never silently dropped — it renders a row naming the budget. The cap is a deterministic work-unit proxy for the O(size) per-file compute (`diffLines` stats + patch construction), which a set of many large files would otherwise drive toward the 30s wall even when each file individually passes the `MAX_DIFF_FILE_CHARS` size gate. `MAX_COMPUTE_PATCH_DIFFS` (40) ≤ `MAX_FILES_WITH_PATCH` (50), so the compute budget fires before the patch budget exhausts. Residual: the counter is a deterministic proxy, not a wall-clock sample (per-isolate CPU time is non-deterministic).
- `commits` — newest-first list of the proposal's first-parent commits from HEAD down to (and including) the fork point (`base.sha`). Each entry: `hash` (40-hex SHA-1), `message` (commit subject string), `author` (string, rendered as `Name <email>`), and `timestamp` (Unix seconds of the author date). Bounded by the fork-point walk (`limit: 200`); empty when the walk yields no commits. Never includes commits past the fork point.
- `identity.fingerprint` (v3.9) — the change-set's stable content identity: sha256 over the deterministic serialization of exactly what the change-set MEANS — the identity block `base.repo\nbase.ref\nbase.sha\nhead.repo\nhead.ref\nhead.sha\n` followed, for each file in CODE-UNIT path order (`a < b ? -1 : a > b ? 1 : 0`, never ICU collation), by one record `${status}\n${path}\n${headHash-or-""}\n${baseHash-or-""}\x00` (the head hash is emitted only when the row is not `removed`; the base hash only when the row is not `added`; missing hashes serialize as empty strings). `head.sha` is the proposal head's 40-hex commit sha (served on both `/changes` `changeSet.head` and `/proposals` rows; identical to `commits[0].hash` — the first-parent log is newest-first). **Never** timestamps, intent, stats, or notes: identical for identical re-materializations, distinct for any content delta (any path, status, blob-hash, or base/head sha change). The pure function is `platform/src/identity.ts` (`changeSetFingerprint`); clients recompute it (the `canonicalize`/`foldHashOf` discipline). The fingerprint is an unsigned content digest — it proves identity, not authenticity (a signed variant would ride §Attestations, out of scope). Serialization assumes NUL-free paths (git tree paths cannot contain NUL); the `\n` field separators are unambiguous for all paths the Artifacts substrate can carry.
- Demo-mode allowlist (AD-9): `repo` and `base` must match the allowlist (`^(demo|agent)(-[A-Za-z0-9._-]+)?$`); anything else → `403 {ok:false,error:"repo-not-allowed",detail}` — enforced at the `authorize()` chokepoint before any repo read.

## GET /proposals?base=demo&repos=a,b (repos optional → auto-discover `agent-*`)

The set view + conflict map.

```json
{ "ok": true, "base": {"repo","ref","head"}, "ref": "main",
  "proposals": [ {"repo","head","forkSha?","intent?","stats","landing":{"status":"ready|conflict|landed|withheld-secret","files":N},"files":[{"path","status","additions","deletions","classification","secret?","keys?"}],"identity":{"fingerprint"}} ],
  "conflicts": [ {"file","repos":["agent-1","agent-2"],"kind":"text-conflict",
                  "pairs":[{"a":"agent-1","b":"agent-2","kind":"text-conflict","conflict":true,"region":{"baseLines","aLines","bLines"}}]} ],
  "summary": {"proposals":4,"changedFiles":4,"sharedFiles":1,"conflictingPairs":1,"cleanPairs":0}
}
```

- `base.head` — the base repo's current head SHA at `baseRef` (40-hex). A client echoes it to `POST /land` as `reviewed.baseHead`.
- `proposals[].head` — that proposal repo's head SHA at `ref` (40-hex): the head of the revision the row's change-set describes. A client echoes it to `POST /land` as `reviewed.heads[repo]`; omitted on rows that carry `error` (the repo could not be read).
- `proposals[].identity.fingerprint` — the row's change-set fingerprint — identical to the same proposal's `/changes` `changeSet.identity.fingerprint` (the stable content identity: sha256 over the deterministic serialization; see §GET /changes).
- These are the values `POST /land` compares its optional `reviewed` fields against (§POST /land): a head that moves after this read makes a land carrying it answer `409 stale` — nothing is folded or pushed (FR-16). Distinct from `/changes`' `base.sha`, which is the fork point.
- Demo-mode allowlist (AD-9): `base` and every `repos` entry must match the allowlist (`^(demo|agent)(-[A-Za-z0-9._-]+)?$`); anything else → `403 {ok:false,error:"repo-not-allowed",detail}` — enforced at the `authorize()` chokepoint before any repo read.
- Rate limit (AD-9): per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).
- Per-file diff compute is bounded by `MAX_COMPUTE_PATCH_DIFFS` (40) per proposal's change-set; a proposal row beyond the budget renders files with `note: "compute-downgraded: …"` (see §GET /changes). The fold's `texts` input tolerates a missing entry, so a downgraded file folds as an empty-ancestor merge rather than crashing or fabricating text.

`kind` ∈ `text-conflict | modify/delete | add/add | undetermined | mergeable | identical-add | both-removed`

## GET /floors

The Floor / Project entity (AD-14 client protocol, entity 1): one floor per namespace repo, served from the same bounded `list()` discovery seam `/proposals` auto-discovery uses (`env.ARTIFACTS.list({limit:200})`). One bounded `list()` call, zero per-repo reads — `branch` is the list entry's `defaultBranch` (`ArtifactsRepoListResult.repos[]` carries it; no `info()` call), `cloning` is `status !== "ready"` (`importing`/`forking`).

```json
{ "ok": true, "floors": [ {"id","name","repo","branch","cloning","counts":{"workers","busy","waiting"}} ] }
```

- `id`/`name`/`repo` — the repo name (the floor's identity is its namespace repo).
- `branch` — the repo's default branch, straight off the list entry.
- `cloning` — `true` when the repo's `status` is not `ready`.
- `counts.workers` — the discovered `agent-*` fleet size (the observable fleet).
- `counts.busy` — always `0`; `counts.waiting` — the fleet size. Worker-lifecycle state is client-local (entity 2): the platform serves the observable fleet size, the client synthesizes busy/waiting. Split recorded in § Client protocol.
- Demo-mode allowlist (AD-9): enforced at the `authorize()` chokepoint (the route carries no repo scope, so the mode gate alone applies).
- Rate limit (AD-9): per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).

## GET /agents?base=demo

The agent roster + policy surface (agent identity v1): every
discovered `agent-*` repo (status `ready`), name-ordered,
each carrying the closed projection `{repo, harness,
capabilities, policy, lastSeenAt}`. Derived from the same
bounced `list()` discovery seam `/floors` and `/forks` use
(`env.ARTIFACTS.list({limit:200})`) — ZERO per-repo
`info()` calls; `lastSeenAt` is the list entry's own
`updatedAt`. `harness` is the repo's declared harness, read
from the `NEXTGIT_AGENT` note on the `nextgit-notes` mirror
(the intent-plumbing seam; `"unrecorded"` when absent — the
typed-null posture, never a fabricated harness). No new store,
no new binding: the roster is a projection of repos the
platform already discovers plus the notes it already mirrors.

**Response (200)**:

```json
{ "ok": true, "base": "demo", "agents": [ {"repo","harness","capabilities":["propose"],"policy":{"land","secretClass"},"lastSeenAt"} ] }
```

- `base` — the queried base repo (echo of the allowlist-validated `base` param; default `"demo"`).
- `agents[]` — the discovered `agent-*` repos with status `ready`, name-ordered (`repo` ascending).
- `agents[].repo` — the repo name (the agent's identity in the namespace).
- `agents[].harness` — the declared harness (`NEXTGIT_AGENT` note, capped 128 chars) or `"unrecorded"`.
- `agents[].capabilities` — the fixed vocabulary `["propose"]` (every agent repo in the namespace proposes; the vocabulary is platform-owned, never client-extended).
- `agents[].policy.land` — the REAL auto-land rule surfaced as data: `"manual"` while the `AUTO_LAND_ENGAGED` interlock is off (the platform's enforced constant), `"auto-eligible"` when it is on. Read from the constant — never an aspirational field, never a request input (AD-11).
- `agents[].policy.secretClass` — the CONTRACT masking law surfaced as data: `"refused"` — secret-class values never leave the worker on this route (they surface only through the authorized, audited `POST /reveal` seam).
- `agents[].lastSeenAt` — the list entry's own `updatedAt` (ISO-8601), or `null` when the entry carries none.
- Demo-mode allowlist (AD-9): `base` must match the allowlist; anything else → `403 {ok:false,error:"repo-not-allowed",detail}` — enforced at the `authorize()` chokepoint before any repo read, re-checked in the handler (the `/forks` defense-in-depth precedent).
- Rate limit (AD-9): per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).
- Precondition order: `400` (charset) → `403` (AD-9 defense-in-depth) → `429` → `200`.

## GET /proposals/{repo}

The Pull / Proposal + detail entity (AD-14 client protocol, entities 5 + 6): the proposal card and its detail, served by driving the SAME compute seam `/changes` and `/merge` use — `computeChangeSet` (commits/stats/files/intent) + `computeMerge` (the merge simulation). The mergeable-class signal is served as `detail.merge.status`/`detail.merge.conflicted` — never as a field named `mergeable` (AD-14: adapter-synthesized GitHub semantics are never platform fields).

```json
{ "ok": true, "proposal": {
  "repo","number","title","state","headRef","baseRef","additions","deletions","stats","checks",
  "detail": {"body","commits":[{"hash","message","author","timestamp"}],"merge":{"status","conflicted"},"files":[]}
}}
```

- `number` — the repo name (the proposal's identity in the demo namespace).
- `title` — the intent text (git-notes of the head commit; `""` when absent).
- `state` — the landing verdict from the fold, ∈ `ready | conflict | landed | withheld-secret` (the same vocabulary `/proposals`' `landing.status` publishes).
- `headRef`/`baseRef` — the change-set refs (the resolved `ref`/`baseRef`, default `main`).
- `additions`/`deletions`/`stats` — the change-set stats; `checks` — `[]` (checks are adapter-synthesized, AD-14).
- `detail.body` — the intent text (the PR body analog); `detail.commits` — the pinned `/changes` commit shape (`hash, message, author, timestamp`), newest-first; `detail.merge` — the `/merge` simulation for this repo alone (`status` ∈ `clean|conflict`, `conflicted` — the conflicting paths); `detail.files` — the fold's file list.
- No `comments`/`reviews` (adapter-synthesized or client-local).
- `{repo}` is validated `REPO_NAME_RE` before any repo read (400 on charset-invalid names); a repo the namespace does not carry → `404 {ok:false,error:"not-found"}`.
- Demo-mode allowlist (AD-9): `{repo}` must match the allowlist — enforced **in the handler** (the path-carried `{repo}` is the scope carrier, as with `/judge` and `/land`), before any repo read.
- Rate limit (AD-9): shares the `/proposals` budget (one compute-cost class) — per-caller cap 60/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).

## Change-set semantics — fork point

Each proposal's change-set is computed against its **fork point** — the most recent commit shared between the proposal repo and the base repo (first-parent walk, limit 200). This is "what the agent changed": stable while the baseline moves. If no common commit is found, the base head is used (legacy fallback).

`/merge` and `/land` use the fork point as the 3-way merge ancestor: ancestor = fork-point texts, ours = current base head, theirs = proposal head.

## Set semantics — explicit intent sets vs whiteboards

The platform serves TWO set semantics, and the difference is normative:

**Explicit intent sets** — typed, landable, evidence-carrying. The carrier is the
`reviewed` object on `POST /land` (`reviewed.baseHead` + `reviewed.heads`, above):
a closed schema where every value is a head sha compared by exact equality, the key
set must cover exactly the requested `repos`, and a violation refuses the fold
(`409 stale` / `400 bad-request`) before anything is folded or pushed. An explicit
set may also carry `validation` evidence (FR-18) — the checks that ran, position-
paired results, and the `testedSha` of the fold they ran against, recorded on the
landing. Only an explicit set can land: the reviewed-state precondition (AD-3) is
what makes a landing a reviewed landing.

**Whiteboard sets** — loose grouping, never landable. A whiteboard is the client-
local overlay (interface-contract entity 8: strokes + cursors per floor; not
persisted by the platform). Grouping proposals on a whiteboard — or any other
ad-hoc selection, including a bare `repos` list with no `reviewed` object —
records no intent, carries no evidence, and creates no reviewed state. **A
whiteboard set is never landable as such**: landing it requires the same explicit
`reviewed` carrier as any other set, and `POST /land` with no `reviewed` present
defaults to legacy behavior (no precondition checks) — which is the absence of
reviewed state, not a weaker form of it.

**Precedence rule:** a set's semantics are determined by its carrier, not by where
it was displayed. The explicit typed carrier (`reviewed` / `validation`) always
wins: a proposal shown on a whiteboard and then landed through `/land` lands under
explicit-set rules (with whatever `reviewed` object the caller supplied — none,
partial, or complete). No display surface, grouping, or client-side selection ever
upgrades a whiteboard set to an explicit one; the upgrade path is exactly one
thing — supplying the typed `reviewed` (and optionally `validation`) fields.

**UI labeling:** the triage proposals card header carries one copy line
("proposals — explicit intent sets land; whiteboard groupings never land") so a
reviewer sees the two semantics side by side at the point of landing. The label is
copy only — it never alters, gates, or extends any route behavior.

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
- Per-file diff compute is bounded by `MAX_COMPUTE_PATCH_DIFFS` (40) per proposal's change-set; a file beyond the budget folds from an empty ancestor (its `texts` entry is absent) rather than fabricating text (see §GET /changes).

## POST /land

Body: `{ "base": "demo", "repos": ["agent-3"], "baseRef": "main", "ref": "main" }` — fold the given proposals (in order) onto the base repo and **push the result to its default branch, server-side** (no clones on the caller's side). This is the browser's one-click "ship it".

- Merge semantics identical to /merge (diff3 fold, in order).
- Secret-class files: if any affected file is secret-class → `409 {ok:false, error:"withheld-secret", files:[...]}` — values never leave the worker and are never pushed by it.
- Conflict → `409 {ok:false, error:"conflict", conflicted:[...], detail}`.
- Clean → the worker creates **one commit** on top of `baseRef` (`land(<repos>): fold proposal(s)`) and pushes it (repo-scoped write token minted via the binding; push performed in-worker over the v1 wire protocol).
- Fold produces **zero changes** → `409 {ok:false, error:"no-changes", detail}` (nothing to land).
- Success → `200 { "ok": true, "landed": { "repos": [...], "commit": "<sha>", "files": [...], "at": "<iso>" } }`.
  The `200` additionally carries `"attestation": {…}` — the signed validation-evidence envelope (see **Attestations (signed validation evidence)** below).
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
- Auto-land gate (AD-11 / FR-26) — **record-gated and OFF
  by default** (`AUTO_LAND_ENGAGED=false` in
  `platform/src/autoland.ts`). Engagement requires the
  calibration record to pass
  `porting/calibration/engagement-check.mjs` (which runs
  `record-check.mjs`). While unengaged, `/land` makes **no
  judge call** (zero AI binding use) and behaves exactly as
  the pre-gate route (the `autoLand` evidence key is absent).
  When engaged, the gate consults the same pinned question
  set the cards render (`setId: "v1"`) for the requested
  `repos` **before** any fold-derived work:
  - `ESCALATE` — any judgment carries a ship-blocking signal (`risk.label =
    senior-security`, a corroborated `intent.verdict = contradicts`, or
    `collision = true`) => `409 {ok:false, error:"autoland-escalate", verdict,
    setId, blocking[]}`. `blocking[]` carries code-owned reason codes
    (`risk:senior-security:<repo>` / `intent:contradicts:<repo>` /
    `collision:<repo>`), never model prose. Nothing is folded or pushed.
  - `CONFIRM` / `ACT` — the land proceeds; the verdict rides the landing:
    `evidence.autoLand = {setId, verdict, blocking[]}` (and the `200` body
    carries the same `evidence`), served verbatim by `GET /landings/{commit}`.
    Clients render the verdict; they never decide it.
  - **Non-model corroboration interlock:** a favorable judge verdict
    (`ACT`/`CONFIRM`) alone never auto-lands — the non-model corroborating
    signal (fold status `clean` + an empty conflict map from `computeMerge`)
    must also be clean. A non-empty conflict map or an unclean fold status
    => `409 {ok:false, error:"autoland-blocked", verdict, setId, foldStatus,
    conflicted[]}` (nothing folded or pushed), regardless of the judge's
    answers.
  - **Fail closed:** when the judge cannot answer (no `AI` binding, a thrown
    run, a response off the pinned schema, a wrong model echo, or nothing to
    ask) => `503 {ok:false, error:"judge-unavailable"}` — the same envelope as
    `POST /judge`, nothing folded or pushed.
  - **`gate` is not a client-supplied field** — engagement is server-side and
    record-gated; a body carrying `gate` => `400 {ok:false, error:"bad-request"}`
    (same bucket and precedence as `reviewed`/`validation`).
- **Silent-drop guard (post-merge behavioral verification):** every
  content contribution a proposal makes to a folded **text** path
  must be present in the fold's final state for that path —
  otherwise the fold silently dropped it. The guard runs server-side
  after the fold and before anything is pushed (deterministic,
  CI-independent): a build/CI signal is not a merge-correctness
  signal, so a green build can never mask a lost change. Detection
  law (`platform/src/drop-guard.ts`): for each proposal
  contribution to a text path (the lines it adds over the 3-way
  ancestor, blank lines ignored, de-duplicated), if the fold's
  final state for that path does not carry those lines, the change
  was dropped. `DropCause` vocabulary (closed):
  `file-removed-in-fold` (a modifying proposal's file is deleted
  by a later proposal), `file-reintroduced-in-fold` (a removing
  proposal's file is resurrected by a later proposal's
  modification), `lines-absent-in-fold` (specific contributed
  lines missing from the folded text).
  - Drop evidence row: `{ repo, path, cause, missing[], byRepo }`
    — `repo` is the proposal whose change was dropped, `byRepo`
    the proposal that absorbed it (`null` when no single writer is
    attributable); `missing` is the dropped lines (whole-file
    causes carry the added lines, `≤8` entries).
  - Any drop => `409 {ok:false, error:"silent-drop-detected", drops:[{repo,path,cause,missing,byRepo}]}`
    (`drops` `≤50` entries, sorted `(path, repo, cause)`).
    **Nothing is folded or pushed** — the gate sits after `conflict`
    and before `no-changes`, ahead of the clone/token/push critical
    section, and the base ref is untouched.
  - Log line is content-free (`silent-drop-detected` with counts
    and repo names only — never file text, NFR-3).
  - Egress: text-class rows only. Secret-class, asset-pointer and
    binary rows are excluded by construction (last-write-wins is
    their designed semantics; there is no text to verify). The
    net-cancel class (a later proposal reverts an earlier one's
    contribution, so the fold reproduces the base) is detected here
    and reported as `silent-drop-detected`, never as the
    misleading `no-changes`.
- Concurrency precondition: after the in-memory clone and before the push, the worker re-reads the base head; if it no longer equals the head the fold was computed against → `409 {ok:false, error:"base-moved", detail}` (the concurrent double-land loser path; a push rejected because the ref moved is reported as `base-moved` too). Nothing is pushed.
- `200` carries `evidence` in addition to `landed` — the landing record (AD-3/FR-18); the returned `commit` is the evidence reference:

  ```json
  { "evidence": { "repos": ["agent-3"], "commit": "<sha>",
                  "ancestor": { "agent-3": "<sha>" },
                  "heads": { "base": "<sha>", "repos": { "agent-3": "<sha>" } },
                  "foldHash": "<sha256 hex>",
                  "checks": ["<check>", "..."], "results": ["<outcome>", "..."],
                  "mergedSha": "<sha256 hex>", "testedSha": "<sha256 hex> | null",
                  "artifactRef": "<string> | null", "at": "<iso>",
                  "autoLand": { "setId": "v1", "verdict": "act" | "confirm" | "escalate", "blocking": ["<reason-code>", ...] } } }
  ```

  - `ancestor` maps each landed repo to the fork-point commit used as its 3-way ancestor; `heads` are the base and proposal heads the fold was computed against.
  - `foldHash` and `mergedSha` are the same digest under two pinned names (fold identity / FR-18's merged-SHA): SHA-256 over the writeable folded set — the files the landing pushes (action `write` entries carrying `merged` text, plus action `delete` entries) — ordered by path (JavaScript string order, `<` — code-unit, deterministic across runtimes; byte order for ASCII paths) and serialized per file as `` `${action}\n${path}\n${action === "write" ? merged : ""}\n\0` ``, concatenated, UTF-8, hex lowercase. `foldHash === mergedSha` always.
  - `checks`/`results` are the landing's validation ledger, position-paired (equal lengths): the recorded validation entries, then the server's content-identity check — reserved name `merged-sha-equals-tested-sha`, last in both arrays, with result `pass` (`testedSha === mergedSha`), `mismatch` (a validation was recorded but its testedSha does not equal the fold hash — a fold that changed after validation cannot claim validation), or `not-recorded` (no `validation` supplied). A mismatch never refuses the fold and never silently passes; it is visible in `results`.
  - `testedSha` — the fold hash the recorded validation ran against, or `null` when none was recorded. `artifactRef` — the caller's evidence-artifact reference, or `null`.
  - `at` — the landing time; identical to `landed.at`.
  - The record is persisted keyed by the returned commit — KV `LIVE`, key `landing:<commit>` (single writer: this route). The write is attempted before the response; a storage failure is logged, never reported as a failed land (the response still carries the record). The persisted record carries a third key, `attestation`, byte-identical to the `200`'s envelope. Served by `GET /landings/{commit}` (pinned with its own bump).
- Demo-mode allowlist (AD-9): `base` and every `repos` entry must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$` (the `demo` / `agent-*` namespace); anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller cap 20/min -> 429 {ok:false,error:"rate-limited"} (see Rate limits).
- Precondition order: `400` (shape) → `429` → `403` → `409 stale` → `409 withheld-secret` → `409 content-detected-secret` → `503 judge-unavailable` / `409 autoland-escalate` / `409 autoland-blocked` (the auto-land gate, engaged posture only) → `409 conflict` → `409 silent-drop-detected` → `409 no-changes` → `409 base-moved` → `200`.
- After landing, a `repo.pushed` event for the base repo flows through `/events` — the UI refreshes itself.
- `400` bad input; `500` unexpected.
## GET /landings/{commit}

Path parameter `commit` is a 40-character lowercase hex SHA-1 (required). Non-matching → `400 { ok: false, error: "bad-request" }`.
Read back the landing record persisted by `POST /land`, served verbatim from KV keyed by `landing:<commit>` — the same JSON string the landing wrote (the `landed` and `evidence` sub-objects are byte-identical to what `POST /land` returned in its `200` body).

- Known commit → `200` with the persisted record: `{ "ok": true, "landed": { "repos": [...], "commit": "<sha>", "files": [...], "at": "<iso>" }, "evidence": { "repos": [...], "commit": "<sha>", "ancestor": {...}, "heads": {...}, "foldHash": "<hex>", "checks": [...], "results": [...], "mergedSha": "<hex>", "testedSha": "<hex | null>", "artifactRef": "<string | null>", "at": "<iso>", "lease": {... | null} } }`. The response body is the KV value served with `content-type: application/json` — no transformation, so `landed` and `evidence` deep-equal the landing's `200` payload. A post-feature record also carries `attestation`, byte-identical to the landing's `200` envelope; a record written before the attestation layer (no `attestation` key) serves `"attestation": null` — the typed-absent path, never a fabricated signature.

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

## GET /whoami

The viewer's elevated-reveal capability probe — read-only, carries no secret content. Reports whether the CALLER'S OWN presented identity may reveal secret-class values for the queried repo, so the UI knows whether to render the reveal affordance.

`GET /whoami?repo=...` → `{ ok: true, authorized, reveal }`.

- `reveal` — the viewer's elevated-reveal capability: **default `false`**; `true` only when the presented identity (Bearer token, the same carrier as `/reveal`) is authorized under `REVEAL_ALLOW` for `repo` (the same rule as `POST /reveal` — `revealCapability` reuses `authorizeReveal`, the single source of truth). Absent/blank identity or absent/malformed `REVEAL_ALLOW` ⇒ `false`.
- `authorized` — the same decision (alias; one canonical boolean).
- `repo` — the demo-namespace repo the capability is adjudicated for (default `demo`); the dispatcher's demo allowlist (403) applies to it like every `read` route.
- Runs through the `authorize()` mode gate (deny ⇒ `401 {ok:false,error:"unauthorized"}`) and the demo allowlist (`403 {ok:false,error:"repo-not-allowed"}`), same as every route. GET ⇒ no CSRF gate.
- Relationship: the UI renders the reveal affordance only when `reveal:true`; `POST /reveal` remains the only route that returns a value. The affordance is never a capability — the server re-runs the rule on every `POST /reveal` click.

**Provisioning** — `REVEAL_ALLOW` is a JSON-string Worker var. Provision it with `printf '%s' '[{"id":"nextgit-demo-viewer","repos":["agent-5"]}]' | npx wrangler secret put REVEAL_ALLOW` (piped — persists across deploys, keeps the grant out of git) or via a `REVEAL_ALLOW` entry in the `vars` block of `wrangler.jsonc`. `repos` absent ⇒ the identity may reveal any demo-namespace repo; present ⇒ only those. The `id` must match the client's Bearer (the UI's `DEMO_IDENTITY`, `platform/ui/js/api.js`). Unset = default-deny = no one.

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

**Provisioning** — `REVEAL_ALLOW` is a JSON-string Worker var. Provision it with `printf '%s' '[{"id":"nextgit-demo-viewer","repos":["agent-5"]}]' | npx wrangler secret put REVEAL_ALLOW` (piped — persists across deploys, keeps the grant out of git) or via a `REVEAL_ALLOW` entry in the `vars` block of `wrangler.jsonc`. `repos` absent ⇒ the identity may reveal any demo-namespace repo; present ⇒ only those. The `id` must match the client's Bearer (the UI's `DEMO_IDENTITY`, `platform/ui/js/api.js`). Unset = default-deny = no one.

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

`{ "ok": true, "events": [{"type","repo","ref","after","at"}] }` — newest first, ≤50, from KV. Token events (`token.created`, `token.revoked` — the live open-beta Artifacts envelope, normalized from `cf.artifacts.token.*`; also accepted in the documented `repo.token.*` form) carry `{type,repo,at}`; session-steering events (`session.steered` — §POST /sessions/{repo}/steer) carry `{type,repo,instruction,at,id?}` where `instruction` is the scrubbed (never raw) form — `ref`/`after` are absent (token lifecycle has no ref; `validateEvent` allows absent ref/after). `session.steered` additionally carries a per-event `id` (fresh 12-hex, the /comments `newCommentId` precedent) so every steer is a distinct feed entry — the feed-dedup key (`type|repo|ref|after|id`) never collides between two steers to one repo. The `tokenId` never reaches KV — the consumer maps only `source.repoName`→`repo`, so the id is dropped at the consumer seam by construction.

## GET /sessions?base=demo

The honest v1 session list — derived from the platform's REAL observability (the Artifacts queue event feed `GET /events` serves), never fabricated rows.

Response `200`:

```json
{ "ok": true, "base": "demo", "sessions": [
  { "repo": "agent-1", "state": "working", "intent": "<intent text>", "lastActivityAt": "<iso-8601-utc>", "lastEvent": "repo.pushed" }
] }
```

- `base` — allowlist-validated query param, default `demo` via `resolveRouteBase` (AD-8 seam, omitted == explicit).
- `sessions[]` — one row per `agent-*` repo the platform's event feed evidences (the fleet discovered via the same bounded `list({limit:200})` seam `/forks` uses, `status === "ready"`). **A repo with no feed evidence is ABSENT** — never a fabricated `state:"idle"` row (the honest-unavailable posture).
- `state` ∈ `working | idle | blocked` — derived from the feed: **working** = the repo's newest event (`repo.pushed`/`repo.created`/`repo.forked` — any feed event) is within `SESSION_WORKING_WINDOW_MS` (15 min, code constant) of now; **blocked** = the newest activity is older than the window AND a recorded landing/landing-failure touched it (honest v1: blocked derives from landing evidence in the feed; absent evidence -> idle); **idle** = otherwise (evidence older than the window, or none).
- `intent` — the repo's intent text read through the EXISTING `readIntent` seam (the same notes-mirror + `NEXTGIT_INTENT` fallback `/changes` drives; absent -> the field is omitted).
- `lastActivityAt` / `lastEvent` — the newest feed event's `at` / normalized type for that repo (absent -> omitted).
- Demo-mode allowlist (AD-9): `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}` (enforced at the `authorize()` chokepoint, re-checked in the handler — the `/forks` defense-in-depth precedent).
- Rate: deliberately UNBOUND (the `/changes` posture — a bounded read over <=200 discovered repos; documented so the omission reads as policy). No `ROUTE_RATE_LIMITS["/sessions"]` GET row.
- Precondition order: `400` (param) → `403` (allowlist) → `200`.

**Client protocol note:** Session/SessionActivity rows remain Client-local — the platform serves the honest v1 read + the steer write; live per-agent process state is client-local (the same split the Floors row documents for busy/waiting).

**Honest v1 limitation:** session state is feed-evidence-derived, never process-observed. A long-running agent that pushes nothing for >15 min reads as `idle` even while working. See §POST /sessions/{repo}/steer residual risks.

## GET /pipelines?base=demo&limit=20

Landed runs as pipeline records — a projection of the landing
records `POST /land` / `POST /upstream` already persist
(`landing:<commit>` in KV `CACHE`), indexed by the single
`landing-registry` key those writers append. **No new store, no
new binding, no new KV namespace** — the pipeline list is a
projection of records the platform already keeps.

Response `200`:

```json
{ "ok": true, "base": "demo", "pipelines": [
  { "id": "<40-hex commit>", "repos": ["agent-1"], "at": "<iso-8601-utc>",
    "checks": ["merged-sha-equals-tested-sha"], "results": ["pass"],
    "status": "passed", "attestation": "signed" }
] }
```

- `id` — the landed commit sha (40-hex). The pipeline run's identity; `landing:<id>` is the record key, and the same id `GET /landings/{commit}` addresses.
- `repos` — the proposal repos folded into the run (`evidence.repos` verbatim).
- `at` — the landing instant, ISO-8601 (`landed.at` verbatim).
- `checks` / `results` — the recorded validation-evidence ledger verbatim (`evidence.checks[]` / `evidence.results[]`, position-paired), including the platform-appended `merged-sha-equals-tested-sha` row.
- `status` ∈ `passed | not-recorded | failed` — derived from `evidence.results`: **failed** when the ledger contains `mismatch` or `fail` (a red recorded check is a red run — a failure token dominates a pass token, position-independent); else **passed** when it contains `pass`; else **not-recorded** (a land with no recorded validation is honestly `not-recorded`, never `passed`).
- `attestation` ∈ `signed | unavailable | null` — the §Attestations tagged union projected: `attestation.status === "signed"` → `signed`; `"unavailable"` → `unavailable`; a record that predates the attestation layer (no `attestation` key — the typed-absent path `GET /landings/{commit}` already serves) → `null`.
- Order: newest-first (registry order). `limit` — optional, default `20`, hard cap `100`: a present `limit` above it **clamps** (never walks — the `/commits` law). An absent/empty namespace answers `200 {ok:true, base, pipelines:[]}` — **not 404** (the list is legitimately empty).
- Demo-mode allowlist (AD-9): `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}` (enforced at the `authorize()` chokepoint — the `/changes` posture, **zero KV reads** — and re-checked in the handler, the `/forks` defense-in-depth precedent).
- Rate: 60/min → `429 {ok:false,error:"rate-limited"}` (`ROUTE_RATE_LIMITS["/pipelines"]` — the `/checks` compute-cost class: a projection over caller-shaped records, deliberately BOUND unlike `/tree`//`/commits`).
- Precondition order: `400` (non-string base; `limit` present but not an integer ≥1) → `403` (allowlist, pre-read) → `429` (rate) → `200`. An omitted/empty `base` resolves through `resolveRouteBase` to the pinned default `demo` (AD-8) → `200`, the `/sessions`/`/changes`-family posture (dated correction, v3.8: an earlier draft mis-stated this as a `400`).
- `405` on any other method (the API-boundary method law).
- Egress (AD-4): rows carry only repo names, commit sha, ISO instant, and check/result **names** — the `/changes` egress family. No file content, no patch, no secret-class path/key/value, no fork-point sha.
- Derivation honesty: a registry entry whose `landing:<commit>` key vanished (KV eviction) is **skipped** — the row is never fabricated, never a 500. A malformed registry reads as `[]` (fail-closed).

**Honest v1 limitation:** the registry is a single KV key — cross-isolate writes are last-writer-wins (the documented as-built posture of every KV read-modify-write in this worker; a repo-keyed Durable Object is the deferred multi-isolate fix). A land whose registry append fails (a KV blip) leaves a landing record the list does not show — honest absence, self-heals on the next land, log-observable via `landing-registry-write-failed`. The registry caps the list at 200 runs; older records remain readable at `GET /landings/{commit}` but leave the list.

## POST /sessions/{repo}/steer

Record a steer instruction as a `session.steered` event in the SAME event store `GET /events` serves (the platform's real observability) — the honest v1 of "steer mid-session": the instruction lands in the event stream the agent CLIs read. **The platform does not inject it into a live agent process** — that is the documented v1 limitation.

Body:

```json
{ "instruction": "<text, ≤500 chars>" }
```

- Closed schema: any unknown body field → `400 {ok:false, error:"bad-request"}`.
- `instruction` — required, non-empty string, ≤500 chars (`MAX_STEER_INSTRUCTION_CHARS`); else `400`.
- Appends a `session.steered` event to the durable feed (the queue-consumer `recordEvent` validation path — an invalid frame can never enter the feed). The instruction text is scrubbed at the seam (`stripInstructionLike(scrubFreeText(...))`, the `/intents` AD-4 wire) before it enters the event record; the stored frame carries only the scrubbed form (KEY=value lines render `KEY=[redacted]`, instruction-like lines `[stripped]`).
- Demo-mode allowlist (AD-9): `{repo}` must match the allowlist — enforced **in the handler** (the path-carried repo cannot be adjudicated by the query-only `extractScope`, the `/raw` carve-out posture) BEFORE any store access.
- Rate limit (AD-9): per-caller cap 30/min → `429 {ok:false,error:"rate-limited"}` (`ROUTE_RATE_LIMITS["/sessions:write"]`, see Rate limits).
- Precondition order: `400` (shape) → `429` (rate) → `403` (allowlist) → `200`.

**Response (200)** — the recorded event frame; the instruction text is NEVER echoed in any response field (AD-4):

```json
{ "ok": true, "repo": "agent-1", "event": { "type": "session.steered", "repo": "agent-1", "at": "<iso-8601-utc>" } }
```

- `400` bad input; `404` unknown steer target (the path remainder is not `<repo>/steer`); `503 {ok:false,error:"event-not-recorded"}` if recordEvent rejected/dedup-dropped the frame (the fail-closed backstop — the response never asserts an event the feed does not evidence; unreachable in practice with the per-event `id` above); `500` unexpected.
- Residual risks (MEDIUM, documented): cross-isolate steer races are last-writer-wins on the recent KV key (the append gate is per-isolate, the comments as-built posture; a repo-keyed Durable Object is the deferred multi-isolate fix); SSE steer fan-out is best-effort (a hub failure logs `events-hub-publisher` and the KV write stands — `GET /events` remains correct).

## GET /sessions/{repo}/instructions

The poll half of session steering (nextgit-e19): the
`session.steered` frames `POST /sessions/{repo}/steer`
recorded, served back to the caller. A pure projection of
the SAME event store `GET /events` serves — **no new store,
no new binding**; the read never re-scrubs (the frame is
already the scrubbed form the steer seam stored, the AD-4
single-scrub-point law).

Response `200`:

```json
{ "ok": true, "repo": "agent-1", "instructions": [
  { "id": "<12-hex>", "at": "<iso-8601-utc>",
    "instruction": "<scrubbed text>", "cursor": "<iso-8601-utc>" }
] }

- `instructions[]` — the repo's `session.steered` frames,
  **oldest-first**. Each row carries the recorded frame
  verbatim: `id` (the per-event 12-hex, absent only on a
  pre-e16 frame), `at`, and `instruction` (the scrubbed
  form — `KEY=value` lines render `KEY=[redacted]`,
  instruction-like lines `[stripped]`; the raw text is
  never served).
- `cursor` — the NEWEST served frame's `at` (the poll
  discipline: pass it back as `?since=` to receive only
  frames recorded strictly newer). Typed-absent when the
  list is empty.
- `since` — optional query param, an ISO-8601 instant;
  only frames with `at` STRICTLY newer than `since` are
  served (equality → excluded, the advance discipline: a
  cursor already served never re-serves itself). Absent =
  all frames. A present-but-unparseable `since` → `400`.
- Empty feed (no steer ever recorded for the repo) →
  `200 {ok:true, repo, instructions:[]}` — **never 404**
  (the list is legitimately empty, the /pipelines law).
- Demo-mode allowlist (AD-9): `{repo}` must match the
  allowlist — enforced **in the handler** (the path-carried
  repo cannot be adjudicated by the query-only
  `extractScope`, the `/raw` carve-out posture) BEFORE any
  store access. Secret-class repo names are REFUSED (403,
  the §POST /issues posture) before any read.
- Rate limit (AD-9): per-caller cap 60/min →
  `429 {ok:false,error:"rate-limited"}`
  (`ROUTE_RATE_LIMITS["/sessions:read"]`, see Rate limits).
- Precondition order: `403` (allowlist) → `403`
  (secret-class) → `429` (rate) → `400` (shape;
  non-string/unparseable `since`) → `200`. Dated correction
  (2026-10-14): the `since`-shape `400` fires AFTER the
  auth/rate gates — auth-first fail-closed; an earlier draft
  listed shape first. The only divergence is on compound
  faults (a bad `since` from a denied caller answers `403`).
- Cap: the 50 NEWEST frames when a repo has been steered
  more than 50 times (`MAX_SESSION_INSTRUCTIONS`, the
  feed-cap honest-absence posture — `cursor` still advances
  monotonically); older frames leave the list.
- `405` on any other method (the API-boundary method law).
- Egress (AD-4): rows carry only the recorded frame —
  repo name, ISO instants, the scrubbed instruction text.
  No raw text, no secret-class value.
- Residual risks (documented): cross-isolate KV
  last-writer-wins is inherited from the steer write (the
  same as-built posture of every KV read-modify-write in
  this worker); a malformed frame in the feed is SKIPPED
  (never a 500 — the frame-typed guard); >50-steer repos
  serve the 50 newest (the Cap clause above is the detail,
  verified empirically: 55 steers → exactly the newest 50
  served, oldest evicted first by the feed cap); strict
  `since` equality returns empty (the documented
  advance discipline).

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
- `candidates` — the forks whose signals drove the verdict, ordered by the matcher's confidence; each carries `repo`, `rationale` (platform-generated, no caller echo), and the six-cluster `signals` object — `fitOverlap`, `peopleTrust`, `liveness`, `proof`, `distance`, `costToAdoptVsRegenerate` (typed numbers/null; thresholds in code per AD-11). The `signals` are computed by `platform/src/fork-signals.ts` — the single computation surface both `/intents` and the future `/forks` consume (one writer, no divergence): `distance` derives from the `classifyPair` conflict kinds (L71 vocabulary) over the fork-point change-set, aggregated as the MAX over the fork's changed files; `peopleTrust` is `null` until a signed-identity seam exists (the typed-null law: unmeasured is `null`, never a fabricated `0`).

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

## GET /issues?base=demo

The derived triage issue list for a base repo — issues surfaced from EXISTING platform state only (no new store, no new binding method, no new KV key). Four derivation kinds per discovered candidate fork (the `/forks` roster: `agent-*` + `status === "ready"`):

**Response (200)**:

```json
{ "ok": true, "base": "demo", "issues": [
  { "id": "conflict:agent-1:src/a.ts", "kind": "conflict", "repo": "agent-1", "severity": "high",
    "title": "Merge conflict in src/a.ts", "detail": "src/a.ts", "links": ["/merge?base=demo&repos=agent-1"] }
] }
```

- `base` — the queried base repo (echo of the allowlist-validated `base` param; default `"demo"`).
- `issues` — the derived issue set, deterministically ordered by `(severity, kind, repo, detail)` with severity rank high=0, medium=1, low=2, info=3, then lexicographic — a pure comparator, no timestamps, no Map-iteration order. Two consecutive reads are byte-identical.
- Each issue carries all seven fields: `id` (stable `<kind>:<repo>:<detail>`), `kind`, `repo` (the platform-discovered candidate whose change-set produced the issue — never caller-supplied), `severity`, `title`, `detail`, `links` (same-worker read-only references, constructed from validated params only).
- `kind: "conflict"` (severity `high`) — the candidate's merge fold has a file row with `result === "conflict"`; one issue per conflicting path; `detail` is the PATH only (conflict text stays off the wire — it is a merge input, and diff text could carry secret-adjacent content).
- `kind: "withheld-secret"` (severity `medium`) — the same fold's `result === "withheld-secret"` rows; `detail` is `"<path>: <n> key(s) withheld"` — key NAMES only, never values (the masking law, §Secret classes).
- `kind: "stale-base"` (severity `low`) — the candidate shares NO first-parent commit with the base within the 200-commit fork-point walk (`findSharedFirstParent` returns `undefined`); `detail` names the base.
- `kind: "blocked-intent"` (severity `info`) — the structural intent matcher (`POST /intents` verdict derivation over the candidate's six-cluster signals) scores the candidate `ignore`. ADVISORY ONLY — the verdict is named, never an auto-decision; nothing is merged, landed, or skipped on its basis.
- Per-candidate fail-closed: a candidate the base cannot read (unresolvable ref, missing repo) contributes no issues — it is skipped, never fails the whole request (the `GET /forks` precedent).
- The derivation reads only `env.ARTIFACTS` (`get`/`list`/`log`/`readFile`/`readTree`/`readBlob`) — zero writes; read-only, credential-free (NFR-6).
- **Merge semantics (v3.8)**: the served `issues` array is the DERIVED set (deterministic order above) followed by the STORED set (append order — §POST /issues). Every row carries `kind: "derived" | "stored"`; the legacy derivation tag moves to `issue` (dated correction, v3.8): derived rows carry `issue: "conflict" | "withheld-secret" | "stale-base" | "blocked-intent"` where v1 carried `kind` — the value set and severity map are unchanged; the field rename is the only wire delta, and `kind` is now the provenance discriminator. Stored rows carry `state: "open" | "closed"` + `closedAt?` + the stored fields (title/body/assignee/at); derived rows have no `state` (implicitly open, read-only — they gain NO write affordances).
- Demo-mode allowlist (AD-9): `base` must match `^(demo|agent)(-[A-Za-z0-9._-]+)?$`; anything else → `403 {ok:false, error:"repo-not-allowed", detail}`.
- Rate limit (AD-9): per-caller cap 60/min → `429 {ok:false,error:"rate-limited"}` (see Rate limits) — the per-candidate merge simulation is the `/merge` compute-cost class, unlike the deliberately unbound single-repo bounded reads (`/tree`, `/commits`).
- `400` bad input; `500` unexpected.

## POST /issues

Append a stored issue to the repo-scoped issues store (v3.8) — CACHE KV JSONL at `issues:<repo>` (the `/comments` store pattern; per-repo append gate serializes the read-modify-write in-isolate; cross-isolate last-writer-wins is the documented as-built posture).

**Request**: `{ "repo": "agent-1", "title": "…", "body": "…", "severity": "high|medium|low|info", "assignee"?: "…" }` — closed schema (any unknown field → `400`); `title` required ≤128 chars; `body` ≤2000; `assignee` display text ≤128 (never an identity claim, NFR-3).

**Response (201)**: `{ "ok": true, "issue": { "id": "<12-hex>", "kind": "stored", "repo", "title", "body", "severity", "assignee"?, "state": "open", "at": "<iso>" } }` — the server-minted id + timestamp.

- Secret-class repos refused `403` BEFORE any store access (the `/comments` secret-class posture).
- Rate limit: `POST /issues` 20/60s (`/issues:write` — the write class).
- Precondition order: `400` → `429` → `403` → `201`.

## PATCH /issues/{id}

Close a stored issue once (v3.8). Body: `{ "state": "closed", "assignee"?: "…" }` — closed schema; close-only semantics (setting `state: "open"` against a closed issue → `409`).

- `200` `{ "ok": true, "issue": <the rewritten stored row with state:"closed" + closedAt> }`.
- `404 {ok:false,error:"not-found"}` — unknown id (or a derived id — derived rows are never writable).
- `409 {ok:false,error:"already-closed"}` — repeat close (idempotence is NOT silent: the second close is an explicit conflict).
- CSRF: `PATCH` is gated by `csrfGate` exactly like `POST` (the dispatcher's mutating-verb set is POST+PATCH; CONTRACT §Authorization).
- Precondition order: `400` → `429` → `403` → `404` → `409` → `200`.

## POST /upstream

Route a fork's work back to the repository it forked from — merge-back-to-upstream with `/land`-shaped evidence (CAP-10).

Body:

```json
{ "repo": "agent-3", "base": "demo", "reviewed": { "baseHead": "<sha>", "heads": { "agent-3": "<sha>" } } }
```

- `repo` — required; the fork repo whose work is routed upstream. Must match the AD-9 allowlist, else `403 {ok:false, error:"repo-not-allowed", detail}`.
- `base` — optional; the upstream (the repo `repo` forked from); default `"demo"`. Lineage is recorded per fork by the provisioning seam (`fork:<name>` → `{repo, forkPoint}` in the CACHE KV namespace — the same record `GET /forks` serves as `upstream`). Two distinct cases: no recorded lineage → `400 {ok:false, error:"no-lineage"}` (the caller forked outside the provisioning seam — a client-state error); a recorded lineage whose `repo` differs from `base` → `409 {ok:false, error:"conflict", detail}` (a fork can never merge into a repo it is not a fork of).
- `reviewed` — the same optional reviewed-state precondition as `POST /land` (AD-3): `{baseHead, heads}`; same precedence (`400` shape → `409 stale`).
- Closed schema (AD-9): unknown body fields → `400 {ok:false, error:"bad-request"}`.
- Fold/merge semantics, the content-identity `foldHash`, and the validation ledger are identical to `POST /land` (diff3 fold, in order, server-side push over the v1 wire protocol).
- Secret-class files: if any affected file is secret-class → `409 {ok:false, error:"withheld-secret", files:[...]}` (same withholding law as `/land`).
- Conflict → `409 {ok:false, error:"conflict", conflicted:[...], detail}`.
- Fold produces zero changes → `409 {ok:false, error:"no-changes", detail}`.
- Success → `200` carrying the **same `evidence` object shape as `POST /land`** — mechanically key-set-identical: `repos, commit, ancestor, heads:{base,repos}, foldHash, checks, results, mergedSha, testedSha, artifactRef, at, lease` (`lease` is the advisory DO lease note or `null`, identical to `/land`'s 12-key evidence; plus the `landed` envelope, identical to `/land`). The `200` additionally carries `"attestation": {…}` — the same signed validation-evidence envelope as `POST /land` (same single writer; see **Attestations (signed validation evidence)**).

  - `ancestor` maps the routed fork to the fork-point commit used as its 3-way ancestor; `heads` are the base and fork heads the fold was computed against.
  - The record is persisted keyed by the returned commit — KV `LIVE`, key `landing:<commit>` (same single writer and read-back surface as `/land`: `GET /landings/{commit}`). The persisted record carries the `attestation` key, byte-identical to the `200`'s envelope.

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

- `event:` — the normalized event type (`repo.pushed`, `repo.forked`, `repo.created`, `token.created`, `token.revoked`, `session.steered`; normalized via the same `normalizeEventType` as the queue consumer — `cf.artifacts.` prefix stripped). Token events carry `{type,repo,at}` only — no `ref`/`after` (token lifecycle has no ref). The live open-beta environment emits `cf.artifacts.token.*` (normalized `token.*`); the documented `cf.artifacts.repo.token.*` (normalized `repo.token.*`) form is also accepted.
- `retry:` — `30000` (30 s); instructs the client to reconnect after this interval on disconnect.
- `id:` — the event's dedup key (`type|repo|ref|after`, same as `eventDedupKey` in index.ts:749-752) so a reconnecting client can resume via `Last-Event-ID`.
- `data:` — JSON object `{ type, repo, ref, after, at }` — the exact `LiveEvent` shape (CONTRACT.md:194, `type?|repo?|ref?|after?` nullable; `at` always present).

**Heartbeat**: every ≤30 s (implemented at ≤25 s) the server emits `: heartbeat\n\n` — an SSE comment, no `data:`. A client that has not received *any* line (event or heartbeat) within 45 s should reconnect with `Last-Event-ID` set to the most recent `id:` it received; the server re-drains the snapshot tail from its ring buffer (no server-side resume cursor is maintained).

**Live broadcast**: every validated event that the queue consumer writes to KV (`recordEvent`, index.ts:754) is simultaneously published to the hub; open streams receive the matching `event:` frame. The producer is best-effort: a hub failure logs `events-hub-publisher` and is swallowed — the KV write stands and `GET /events` remains correct.

**Relationship to GET /events**: `/events/stream` is derived — it never writes, never alters KV, never acks Queue messages. The queue consumer (`async queue`, index.ts:1496) is the single recorder; the SSE hub is a fan-out mirror. `GET /events/stream` degrades gracefully to the `: connected` + snapshot tail if the hub is unbound or empty.

**Errors**: HTTP 200 for the stream. A hub dispatch error that precedes any SSE frame written is `503 { ok: false, error: "events-unavailable" }`.

## GET /harnesses

**Federation manifest** — the BYO (bring-your-own) onboarding read surface: the table of third-party agent harnesses the platform can dispatch, served as a static, deploy-time-bundled declaration (`platform/harnesses.json`). Companion to the internal dispatch registry (`platform/scripts/harnesses.json`), which carries the dispatch internals this surface deliberately omits. Read-only, credential-free (NFR-6).

**Request**: `GET /harnesses` (no query parameters; namespace-wide, like `/health`).

**Response**: `200` with `{ "ok": true, "harnesses": [{ "name", "kind", "capabilities", "docs" }] }`.

- `name` — the harness's identifier (the dispatch registry's `id` for the same harness: `codex`, `omp`, `pi`).
- `kind` — `"byo-cli"`: the harness is brought by the operator and dispatched through the declarative registry (§Harness onboarding (BYO)); the platform does not host it.
- `capabilities` — the closed capability vocabulary the harness declares: `workspace-edit` (edits files in its own isolated clone), `prompt-args` (accepts the task prompt as a CLI argument), `probe` (empirically proven by the probe contract — judged by the on-disk artifact, never the CLI's self-report).
- `docs` — the harness vendor's own documentation URL (an operator-facing pointer; never a platform-internal path).

**Egress law (AD-9 / NFR-3):** dispatch internals NEVER egress through this surface. The internal registry's `bin`, `args`, `env`, `notes`, `probeBudgetMs` live only in `platform/scripts/harnesses.json` and are never served here; a caller wanting to dispatch must read the registry file, not this API. No secret-class content is constructible: the manifest ships no credentials, and push tokens are minted per-dispatch inside the runner's `git` wrapper (§Harness onboarding (BYO), contract 4).

**Validation:** the manifest is validated fail-closed at module load (`validateFederationRegistry` in `platform/src/index.ts`): exactly the closed schema `{name, kind, capabilities, docs}` per entry (any unknown key — including a reserved `endpoint` — is rejected), non-blank unique names, `kind === "byo-cli"`, a non-empty unique capability set drawn from the vocabulary, and an `https://` docs URL. A malformed manifest throws before the first request is served — the worker never boots with an unvalidated registry.

**Posture:** the route is tabled in `ROUTES` (`GET`, `read`), so the `authorize()` chokepoint gates it: deny mode ⇒ `401 {ok:false,error:"unauthorized"}`; demo mode runs with no repo/base/repos to adjudicate (the `/health` posture). Deliberately UNBOUND: no `ROUTE_RATE_LIMITS` row (the `/tree` `/commits` posture — the payload is a fixed static array, cheaper than an unbound `/changes`). The `hosted` kind is reserved for a future hosted-agent surface and ships ZERO populated entries (no marketplace).

**Errors:** `200` is the only success shape. Wrong method ⇒ `405 {ok:false,error:"method-not-allowed"}` (the API boundary law); the route takes no input, so there is no `400`.

## UI

`GET /` serves the triage UI (`platform/ui/` via wrangler assets). API routes fall through to the worker.

## Client protocol (AD-14)

The 11-entity protocol + the contract-pinned push-event surface below is THE client contract — authored from the authoritative list in `_bmad-output/specs/spec-next-git-platform/interface-contract.md`. GitHub-specific semantics (`reviewDecision`, `mergeStateStatus`, `mergeable`) are synthesized in the adapter — never in the client, never in the core.

### Entities (interface-contract.md order)

1. **Floor / Project** — `id, name, repo, branch, cloning, counts (workers/busy/waiting)` — **Served by the platform**: `GET /floors` — one floor per namespace repo; `branch` from the list entry's `defaultBranch`, `cloning` = `status !== "ready"`; `counts.workers` = the discovered `agent-*` fleet size, `busy` = 0 / `waiting` = the fleet size (worker-lifecycle state is client-local, entity 2 — the platform serves the observable fleet size, the client synthesizes busy/waiting).
2. **Worker** — `id, name, provider/model/effort, desk, status, worktree{branch,path,base}, pr, task, activity, usage` — **Client-local** (Agent Office owns worker state; harness dispatch is control-plane, AD-7; no server-side shape invented).
3. **Task / Queue** — `id, provider/model/effort, issue, title, prompt, status, workerId, branch, outcome, pr` — **Client-local** (task store = bd/beads at `.beads/`, outside the platform API).
4. **Issue** — `number, title, state, author, labels, assignees, taken?, body` — **Client-local** (GitHub-owned; no platform issue API yet — roadmap).
5. **Pull / Proposal** — `number, title, state, draft, reviewDecision, headRef, baseRef, checks, additions/deletions, closes[]` — **Served by the platform**: `GET /proposals/{repo}` — the card (`repo, number, title, state, headRef, baseRef, additions, deletions, stats, checks`) plus its detail; `title` = the intent text, `state` = the landing verdict (∈ `ready | conflict | landed | withheld-secret`); `draft`/`reviewDecision`/`closes[]` are adapter-synthesized GitHub semantics (AD-14) derived from `state` + `stats` — never platform fields.
6. **PR / Proposal detail** — `body, mergeable, mergeStateStatus, commits, comments, reviews, checks` — **Served by the platform**: `GET /proposals/{repo}`'s `detail` — `body` = the intent text; `commits` from the change-set (`commits[]`: `hash, message, author, timestamp`); the merge simulation as `detail.merge` (`status` ∈ `clean|conflict`, `conflicted[]`) — served as merge.status/conflicted, never as a field named `mergeable`; `mergeStateStatus` is adapter-synthesized (AD-14); `comments`/`reviews` adapter-synthesized or client-local.
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
- `session.steered` — a recorded steer instruction (§POST /sessions/{repo}/steer); the frame carries the scrubbed instruction, never the raw text (AD-4).

## API boundary

The dispatcher matches a request against the route tables (`ROUTES` + `DYNAMIC_ROUTES`, the single registration point — AD-8) and then classifies the remainder at the boundary, before `authorize()`/CSRF:

- **Known path, wrong method** → `405 { "ok": false, "error": "method-not-allowed" }`. A registered path addressed with a method no route accepts is a client error, more specific than an unknown path (405-before-404 precedence).
- **Unknown path** → `404 { "ok": false, "error": "not-found" }`.
- **UI document** (`/`, `/index.html`, `/styles.css`, `/app.js`, `/reveal-decision.js`, `/land-verdict.js`, `/tour.html`, `/tour.css`, `/tour.js`, `/files.html`, `/js/files-page.js`, `/js/state.js`, `/js/api.js`, `/js/conflicts.js`, `/js/ticker.js`, `/js/proposals.js`, `/js/modal.js`, `/js/land.js`, `/js/reveal.js`, `/js/interactions.js`, `/js/checks.js`, `/js/comments.js`, `/parity.html`, `/parity.js`, `/parity-data.js`, `/history.html`, `/js/history-page.js`, `/js/forks-panel.js`, `/js/issues-panel.js`, `/story.html`, `/js/story-page.js`, `/js/judge-comparison.js`, `/js/sessions-panel.js`, `/js/pipelines.js`, `/js/rail.js`) → served by the wrangler-assets binding (`env.ASSETS`), which serves exactly `platform/ui/`'s documents. This whitelist is closed and additive-only: a new UI file is added to the whitelist AND the route-discipline parity check in the same commit.
The 405/404 envelopes are static literals (no user input reflected) and fire before the auth chokepoint, matching the handler-level 400/404/409 precedent — a malformed or mis-addressed request is rejected at the boundary without reaching `authorize()`. This replaces the previous behaviour where a known path with the wrong method and any unknown path both fell through to the asset layer (an information-shaping defect: an undocumented surface answered requests the contract says must be JSON errors).

## Notes mirror (intent plumbing)

The Artifacts binding cannot resolve `refs/notes/*` (server-side limitation, measured). Intent is read from a branch mirroring the notes ref. Runner push recipe — one command, three refspecs, executed by the runner after the agent exits (agents never push refs; AD-5 — see "Harness onboarding (BYO)" below):

```
git push origin main +refs/notes/commits +refs/notes/commits:refs/heads/nextgit-notes
```

The notes ref and its mirror are **derived, single-writer state** — the `+` (force) prefix is deliberate: forks inherit a stale mirror from the base, and an unforced mirror push is rejected non-fast-forward, leaving intent dark (root-caused 2026-10-10). The mirror is always `:= refs/notes/commits`.

Fallback source: `NEXTGIT_INTENT/<sha>.txt` (or `NEXTGIT_INTENT/intent.txt`) on that branch. Response shape unchanged (`intent` string, omitted when absent).

## Push budget (incremental pushes)

Artifacts enforces a **~64 MiB push cap** (push-side only, no ETA and no workaround posted): 63 MiB passes, 64 MiB returns HTTP 500 (research.md:65, 2026-10-02 — `research/2026-10-02-platform-recon-briefs/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:65`). No platform path may approach it, so every push seam measures its payload and **fails closed BEFORE the wire call**:

- **Budget:** `PUSH_BUDGET_BYTES = 16 MiB` — 4x under the measured pass threshold. Held in lockstep in two places (the worker cannot import a script module, nor the reverse): `platform/src/push-budget.ts` and `platform/scripts/lib/push-guard.mjs`; `porting/tests/script-push-guard.test.mjs` pins the two constants equal. If the platform lifts the cap, the constant moves in exactly those two places.
- **Worker land seam:** `pushLand` estimates the fold's own text (`estimatePushBytes`: text length × 2, a documented upper bound — never a fabricated measurement) and refuses an over-budget fold with a typed `PushBudgetError` **before the clone**, so an over-budget land never reaches the remote. The caller maps it to the existing 500-class error surface; the message carries the byte count only (content-free metadata, AD-4), and the refusal is logged content-free at the seam (`push-budget`).
- **Incremental land:** the fold lands in **increments of at most `LAND_INCREMENT_GROUP = 4` folded files** — each increment its own commit and its own push, so the pushed history is chunked by construction and no single push carries the whole fold. The landed **tree is unchanged** (the same fold either way; only the history between the base head and the landed tip differs), `pushLand` still returns the **final** commit, and the landing-decision note is attached to that final commit.
- **AD-3 with increments:** each increment re-validates the ref it is based on — the reviewed base head for the first, our own last commit after that — from the push's server discovery (`onPrePush`), the lag-free witness. The binding-side `readBaseHead` re-check runs once, before the first wire call: that read can lag our own push, so re-reading it per increment would false-refuse the second increment.
- **All-or-nothing across increments:** when an increment fails with earlier ones already pushed — a wire error, a rejected ref update, or the witness refusing a stale head after that increment's pack reached the remote — `pushLand` best-effort rewinds `baseRef` to the head the land found *before* it rethrows, so no partial fold survives without the landing-decision note that references it (FR-18; the "same tree either way" claim above therefore holds on the failure path too). A foreign base move is never rewound (it is not ours to move; the caller's 409 classification owns that path), and a revert that cannot land is logged content-free as `land-revert-failed` (commit + base hashes and the error only, AD-4) while the **original** error still propagates.
- **Runner (CLI) seam:** `assertPushBudgetGit(dir, refspecs)` (`platform/scripts/lib/push-guard.mjs`) measures the **actual git objects** the push would carry via real plumbing (`rev-list --objects <source> --not <remote-tracking>`; the whole ref when no upstream exists, the conservative posture) and throws `PushBudgetError` before the push. Called by `agents.mjs`, `real-agents.mjs` and `secret-fixture.mjs` immediately before their single three-refspec push (above); a refusal fails that agent's row as `push-budget-exceeded` (content-free — byte counts only).
- **Unmeasurable ⇒ refused:** a seam that cannot size its payload refuses the push rather than attempting one blind (fail closed).

This bounds the pushes; it does not chunk binaries — binary-heavy repos stay out of scope until the platform fixes the cap (§Non-goals).

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

**5. End-to-end onboarding (the third-party flow).** Onboarding a new agent CLI is a declaration, not a code edit, and completes in three steps — all on the operator's machine, none inside the platform worker:

1. **Declare** the harness in the dispatch registry (`platform/scripts/harnesses.json`, or a BYO overlay via `NEXTGIT_HARNESSES`) per contract 1's schema.
2. **Prove** it: `--check-harness <file>` exits 0 and the probe contract (contract 2) passes — the harness created `hello.txt` in a throwaway clone, judged by the on-disk artifact.
3. **Advertise** it: add the federation entry (`{name, kind:"byo-cli", capabilities, docs}`) to `platform/harnesses.json`, which `GET /harnesses` serves after fail-closed module-load validation (§GET /harnesses).

The agent itself pushes its work via git-over-HTTPS per contract 3's three-refspec push (the runner performs it after the agent exits; agents never push). An onboarded harness may call the platform's **read API** (the tabled `GET` routes) and the runner's push — **nothing else**: no write route, no secret-class read, and no credential. No push credential ever appears in the agent's environment (contract 4) — the token lives only in the runner's `git` wrapper.

**No marketplace.** The federation surface is a BYO declaration table, not a hosted-agent catalog: the `hosted` kind is reserved and ships ZERO populated entries. A hosted third-party agent surface would be a separate contract (its own route family, auth model, and lifecycle) and is deliberately NOT defined here.

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

The note write is best-effort: a failure is logged as `landing-note-push-failed` and does not fail the land or alter any response shape. No secret-class content reaches the note — withheld-secret files are excluded at fold (CONTRACT §Secret classes). The note rides inside `pushLand` within `withLandGate`, using the same single-use worker token and the same critical section — it is not a separate control-plane push to base branches. This is the only code path that writes `refs/heads/nextgit-notes`; `refs/heads/<baseRef>` is written by the land's own `git.push` calls — the base-branch push of each fold increment (§Push budget (incremental pushes)), the last one being the commit this note is attached to.

Reader surface: `GET /changes` intent and `GET /proposals` card read intent from the mirror branch per the recipe above; the landing-decision note is readable via standard git-notes readers (e.g. `git notes --ref=refs/notes/commits show <commit>` after fetching the mirror).

The land also performs the reference-counted blob reclamation for the
removed asset-pointer paths it carried (see §R2 asset tier — Lifecycle):
after the base-branch push, each fold-touched pointer whose blob is no
longer referenced by any repo's manifests is deleted via the `ASSET_BLOB`
binding. It is best-effort and log-observable (`asset-blob-deleted` /
`asset-blob-retained` / `asset-blob-delete-failed`), never fails the land,
and changes no response field — the 12-key evidence record is unchanged.

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

Edge rate limits cover the twenty-four bound routes in the table below (`/land`, `/merge`, `/proposals`, `/floors`, `/proposals/{repo}`, `/judge`, `/forks`, `/intents`, `/upstream`, `/file`, `/raw`, `POST /comments`, `GET /comments`, `GET /issues`, `POST /issues`, `PATCH /issues/{id}`, `GET /checks`, `GET /pipelines`, `GET /sessions/{repo}/instructions`, `POST /sessions/{repo}/steer`, `GET /agents`, `POST /asset/uploads`, `POST /asset/uploads/{uploadId}/complete`, `GET /asset/{blobId}/presign`). `GET /sessions` is deliberately unbound (a bounded read over <=200 discovered repos — the `/changes` posture, documented in §GET /sessions). AD-9 says "edge" rate limits; the as-built substitute is an in-isolate fixed window (per-Workers-isolate, not global), the documented closest substitute until the
| Route | Cap | Window |
|---|---|---|
| `POST /land` | 20 | 60 s |
| `GET /merge` | 60 | 60 s |
| `GET /proposals` | 60 | 60 s |
| `GET /floors` | 60 | 60 s |
| `GET /proposals/{repo}` | 60 | 60 s (shares the `/proposals` budget — one compute-cost class) |
| `POST /judge` | 30 | 60 s |
| `GET /forks` | 60 | 60 s |
| `POST /intents` | 30 | 60 s |
| `POST /upstream` | 20 | 60 s |
| `GET /agents` | 60 | 60 s |
| `GET /file` | 60 | 60 s |
| `GET /raw/{repo}/{ref}/{path}` | 60 | 60 s |
| `POST /comments` | 20 | 60 s |
| `GET /comments` | 60 | 60 s |
| `GET /issues` | 60 | 60 s |
| `POST /issues` | 20 | 60 s (the `/issues:write` class — also covers `PATCH /issues/{id}`, the store's only two writes) |
| `GET /checks` | 60 | 60 s |
| `GET /pipelines` | 60 | 60 s |
| `GET /sessions/{repo}/instructions` | 60 | 60 s |
| `POST /sessions/{repo}/steer` | 30 | 60 s |
| `POST /asset/uploads` | 20 | 60 s (shared with `POST /asset/uploads/{uploadId}/complete` — one write class: both mint or extend a client-direct upload session) |
| `GET /asset/{blobId}/presign` | 60 | 60 s |

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

## R2 asset tier — pointer format (AD-10; FR-47)

Large/binary assets live as content-addressed blobs in the R2 bucket
`nextgit-asset-blobs` (`ASSET_BLOB` binding, `platform/wrangler.jsonc`);
git carries a **pointer** file in Artifacts. The pointer format is owned
by this first slice — later R2 slices conform additively (`v` is the
format generation).

**Pointer path convention:** `assets/<name>.asset.json` carries the
asset `assets/<name>`. A file whose path ends in `.asset.json` is an
asset pointer (single classifier: `isAssetPointer`).

**Pointer file shape** (JSON, ≤ 1 MiB; all fields REQUIRED unless `?`):
```json
{ "v": 1, "blobId": "<R2 object key — opaque, never a URL>",
  "sha256": "<hex-64 content hash of the blob bytes>",
  "size": 0, "contentType": "<mime>" }
```

**Rendering law (non-diffable):** pointer files render **metadata only** —
`/changes` and `/proposals` carry the parsed pointer on the file row
(`asset: {v, blobId, sha256, size, contentType?}`) with a `note`; pointer
rows carry **no** `patch`, **no** `additions`/`deletions`, and never enter
merge text (`/merge` renders `result:"merged"`, `note:"asset pointer;
metadata only"`, no `merged` field). Pointer contents never enter judge
state, folds, or logs (AD-4 — pointer metadata is egress).

**Integrity:** `sha256` is the content anchor — blob bytes must hash to it
at every materialization path (the e12 integrity row owns the verified-read
chokepoint; fail-closed `BlobIntegrityError` / `{ok:false,error:"integrity"}`).
The chokepoint serves the asset download route (`GET /asset/{blobId}` above)
and is the only byte-returning `ASSET_BLOB.get` in `platform/src/**`.

**Presigned direct transfers (T2/T3 — no asset byte in the Worker):** the
tier's large-asset paths are `GET /asset/{blobId}/presign` (download),
`POST /asset/uploads` (upload grant) and
`POST /asset/uploads/{uploadId}/complete` (multipart close). The Worker
**mints URLs** and issues only the Create/Complete S3 control frames; the
bytes travel client-direct to the bucket's S3 endpoint. Two facts are
load-bearing and replaced an earlier, now-incorrect note (dated correction
2026-10-14): the Workers R2 binding has **no** presign method
(`head/get/put/delete/list/createMultipartUpload/resumeMultipartUpload`
only), and AWS SDK v3 does not run in Workers — so the URLs are signed
**off-binding** by the in-house SigV4 signer in
`platform/src/r2-presign.ts` with an S3 API token, using WebCrypto only.
Presigning is "credentials + SigV4" with no R2 round trip.

**No URL egress (corrected 2026-10-14):** `blobId` is an opaque R2 key; a
presigned URL is a bearer token and is **never stored** — not in pointers,
not in events, not in KV — and **never logged**. It is rendered in **exactly
one place**: the mint response that created it (the `/reveal` shape: the
value appears only in the response that minted it). `blobId`/`key` values
are logged; URL values are not.

**Credentials:** SigV4 signing needs `ASSET_ACCOUNT_ID` (var) plus
`ASSET_S3_ACCESS_KEY_ID` / `ASSET_S3_SECRET_ACCESS_KEY` (wrangler secrets).
Any of the three missing → every presign route answers
`503 {ok:false,error:"presign-unavailable"}` (fail closed — never a silent
empty-string credential, never a fallback path).

**Fail-closed parse:** a pointer whose `v`, `sha256`, `size`, or `blobId`
violates the shape (or whose text is not JSON, or exceeds 1 MiB) parses to
`null`; the row stays visible with the note `asset pointer; unparseable
metadata (format violation)` — never a 500, never the raw text.

**Git surfaces are pointer-blind (invariance law):** clone/checkout,
change-set computation, fork-point selection, and the `/changes` +
`/proposals` read paths operate on Artifacts only and perform
**zero** `ASSET_BLOB` reads — pointer metadata is the complete
egress (AD-4). Blob bytes materialize only at the e12
materialization chokepoint (`readVerifiedBlob`), never in a git
path. The zero-read property is pinned by the instrumented-bucket
suite `porting/tests/r2-git-invariance.test.mjs` (a stub whose
`get()` records and fails the suite if any git read path calls
it), which also proves a cloned pointer file round-trips
byte-identically and that a pointer-only change-set renders file
rows with stats and fork point identical to the same tree with an
ordinary text file — the tier adds a pointer layer, never drift
(FR-47).

**Integrity chokepoint:** `readVerifiedBlob` (`platform/src/assets.ts`)
re-fetches and re-verifies on every call — no cache, no fallback, no second
key ever tried. Pointer-mediated reads pass the pointer's recorded hash as
the expectation: `readVerifiedBlob(env, pointer.blobId, pointer.sha256)`.
Any future materialization path that needs bytes MUST call it (the
zero-outside-reads gate is pinned by `porting/tests/r2-integrity.test.mjs`
and the instrumented-bucket suite `porting/tests/r2-git-invariance.test.mjs`).

**Lifecycle (reference-counted reclamation):** the bucket carries a
committed lifecycle rule — `platform/r2-lifecycle.json`, rule
`expire-orphaned-asset-blobs`, all prefixes, delete objects with no
PUT/POST activity for **90 days** — applied with the lockfile-pinned
wrangler (`cd platform && ./node_modules/.bin/wrangler r2 bucket
lifecycle set nextgit-asset-blobs --file r2-lifecycle.json`; verified by
`wrangler r2 bucket lifecycle list`). It is the bucket-side backstop for
the reference-counted delete path. `POST /land` (and `/upstream`)
reclaims a removed pointer's blob **only** when the union of every repo's
surviving `*.asset.json` pointer manifests no longer references its
`blobId` (shared blobs are never deleted) — best-effort, log-observable
(`asset-blob-deleted` / `asset-blob-retained` / `asset-blob-delete-failed`),
never failing a land that already pushed. Bulk reclamation is the
out-of-band audit/sweep `platform/scripts/r2-orphan-sweep.mjs`
(grace-window default 7 days; an orphan inside the window is reported,
never deleted; non-zero exit while any orphan remains). The 90-day rule
is strictly later than the sweep's grace window, so the two layers are
ordered, not competing. Additive to the shapes above — no existing field
changes.

## Attestations (signed validation evidence)

Every successful landing (`POST /land` and `POST /upstream`, the `200`
paths only) attaches a **signed attestation** to the response and
persists it with the landing record. This is the FR-18 authenticity
layer: the ledger above answers SLSA's *content* questions (what ran,
on which inputs, with what result); the attestation answers
*authenticity* — who recorded it, in which environment, and that it
has not been altered since.

**Envelope** (`attestation`, the third key of the landing record and
of the `200` body; the tag is stable either way):

```json
{ "status": "signed",
  "v": 1,
  "algo": "Ed25519",
  "keyId": "<16 hex chars — sha256(raw public key)[0..16]>",
  "at": "<iso>",
  "subject": { "commit": "<40hex>", "repos": ["agent-3"], "base": "demo", "ref": "main", "baseRef": "main" },
  "environment": { "worker": "nextgit-platform", "deploy": "<version id | null>", "tag": "<version tag | null>", "runtime": "workerd" },
  "evidence": { /* the EXACT 12-key FR-18 evidence object, verbatim — never re-shaped */ },
  "sig": "<base64url(signature)>" }
```

Honest-unavailable shape (same key set discipline — a tagged union,
stable either way): `{ "status": "unavailable", "reason":
"signing-key-absent" | "public-key-absent" }`. An absent or
malformed signing key **never fails a land that already pushed** —
the land still returns `200` and the record carries the
unavailable envelope (the landing-note / asset-gc best-effort
posture). A record written before this feature (no `attestation`
key) reads back `"attestation": null` (the typed-absent path — the
`unmeasured` precedent), never a fabricated signature.

**Canonicalization law** (published so clients recompute it):
recursive key sort, **code-unit (`<`) comparison — never
localeCompare**, no whitespace, arrays in order — exactly the
`foldHashOf` discipline (`platform/src/land.ts:71-81`).
`canonicalize` is the ONE serializer for signed objects
(`platform/src/attest.ts`); nothing else stringifies a signed
envelope.

**Signing law:** `sig = sign( canonicalize( attestation minus the
"sig" key ) )` — Ed25519 over the canonicalized envelope with every
field but `sig`. Every other field is covered, so adding a field to
the envelope is automatically covered: tampering invalidates the
signature *totally*, not by enumeration.

**Internal-consistency law** (verified, not merely signed):
`subject.commit === evidence.commit` and `subject.repos` equals
`evidence.repos` — a spliced subject is detectable even when the
signature is valid.

**Key material:** `EVIDENCE_SIGNING_KEY` — a Worker **secret**
(base64url PKCS#8 Ed25519), provisioned by the *piped*
`wrangler secret put` (never argv — the repo's secrets law).
`EVIDENCE_PUBLIC_KEY` — a Worker **var** (public, non-secret,
base64url **raw** public key), pinned here so a third party
verifies with nothing from the platform:

```
EVIDENCE_PUBLIC_KEY = NaeMa_MfByjaOYtxToomB9IJZzf6aliKOFZJQf2Vc4Y
keyId = 1da5bb06bbb8f3a5 (sha256(raw public key)[0..16])
```

`keyId` (sha256 of the raw public key, first 16 hex chars) rides
the signed envelope, so a rotation is a data change, not a format
change. v1 = one key.

**Storage — two independent copies:** the KV `LIVE` record
`landing:<commit>` (existing, serving state) and the R2 bucket
`nextgit-evidence` (`EVIDENCE_BLOB` binding), key
`attestations/<commit>.json`. The R2 copy is durable, exportable,
and **indefinitely retained** — deliberately NO lifecycle expiry,
the opposite of the asset bucket (retention IS the feature). Both
writes are best-effort inside the land's existing critical section;
a failure logs `attestation-store-failed` and never alters the
response. Two copies + one signature give cross-copy tamper
detection.

**Verification recipe** (operator / CI — "verifiable later"):

```bash
node platform/scripts/attest-verify.mjs --commit <sha> [--base <url>] [--public-key <b64url>] [--r2-copy]
```

re-derives the canonical bytes locally and verifies against the
pinned public key (`--public-key` overrides the `EVIDENCE_PUBLIC_KEY`
from `platform/wrangler.jsonc`); `--r2-copy` additionally fetches
the R2 copy (`attestations/<commit>.json`) and asserts
deep-equality with the served copy — the cross-copy leg.
`--self-test` runs the verifier over a deliberately tampered copy
and asserts a non-zero exit (a no-op verifier cannot green-pass).
The pure primitive `verifyAttestation` (`platform/src/attest.ts`)
is the in-process surface — it recomputes from the SUPPLIED object,
never trusting a stored copy of the payload, and returns `false`
on ANY defect (never a throw).

**SLSA mapping:** what ran → `evidence.checks`/`results`; which
inputs → `evidence.heads`/`ancestor`/`foldHash`; which environment
→ `environment`; what result → `evidence.mergedSha`/`testedSha`
and the `merged-sha-equals-tested-sha` verdict. The signature
attests what the platform **recorded** — the `evidence` sub-fields
a caller supplied (`validation`) remain self-attested content, the
honest label the ledger already carries. **No new egress class:**
the envelope adds only commit/heads/repo names (the `/changes`
egress family, AD-4) — the 12-key evidence is already
secret-free by construction (secret files are withheld at fold).

**Provisioning** (operator, once):

```bash
cd platform
npx wrangler r2 bucket create nextgit-evidence    # NO lifecycle rule — retention is the feature
node scripts/attestation-keygen.mjs --keep             # → public key + staging file
printf '%s' "$(cat .attest-key.b64)" | npx wrangler secret put EVIDENCE_SIGNING_KEY   # piped; never argv
# add EVIDENCE_PUBLIC_KEY to wrangler.jsonc vars + the pin above; rm the staging file
npx wrangler deploy
```


## Land lease (DO coordination)

`POST /land` uses a Durable Object lease (`LAND_LEASE` binding, `LandLeaseDO` class) to serialize concurrent lands per base repo across Workers isolates. The lease is advisory-first and internal: `acquire` returns `{ acquired: boolean, leaseId: string | null }`; on `!acquired`, the caller is refused with the existing `409 {ok:false, error:"base-moved", detail:"..."}` shape (no new response fields). The lease key is `lease:<base>` — single key per base — with a 30-second TTL and lazy expiry (plus native DO hibernation). When `env.LAND_LEASE` is undefined (e.g. local dev), `acquireLandLease` returns `null` and the route falls back to AD-3's push-rejection conversion. The winner acquires the lease, lands, and releases on completion; losers are refused deterministically.


## Platform VERIFY gate

Every platform deploy runs two live probes as a non-negotiable VERIFY gate. Both are read-only against the live worker — they never land/push/fork/delete `demo` or `agent-1..5`:

- `node porting/tests/land-hardening.probe.mjs` — AD-3 fold-merge + landing correctness across success and induced-failure paths.
- `node porting/tests/egress-guard.probe.mjs` — AD-9 E8 credential egress guard: scans every route's raw response body across success and induced-failure paths (200/500/400/403/404) for `Bearer` tokens, `Authorization:` headers, Artifacts token shapes, and shell snippets. Includes a self-test that injects a synthetic token into a body and asserts the scanner detects it (proving the scanner is not a no-op). The probe also structurally verifies that the 500 push-failed path's `files` projection strips `merged` content — only `{path, action, result}` survive, so file-content payloads can never echo in a failure response.

A deploy is not "done" until both probes exit 0. The
`land-hardening` probe carries a verify leg for the signed
attestation layer (Attestations section): the served
envelope's signature verifies against the pinned public key
and the R2 copy deep-equals the served copy. Probe count
unchanged (two).
