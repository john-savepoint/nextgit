# Stack & Platform Facts

## Composition (Cloudflare)

- **Artifacts** — the repo fabric: create/fork/import repos, scoped git tokens, git-over-HTTPS, events. Namespace `nextgit`.
- **Workers** — platform API + event consumers.
- **Queues** — delivers Artifacts events (repo.pushed / forked / created / cloned / fetched / token.*).
- Post-demo: Durable Objects (leases/coordination), Workflows (long flows), R2 (blobs/assets).

## Verified facts (2026-10-03)

- Limits: 1 GB/repo · 32 MB/file · 2k git req/10s/repo · 2k control-plane req/10s/namespace.
- **No server-side merge/diff/conflict/branch-protection** — build them in-platform.
- ~64 MiB git-push cap (push-side only; clone/fetch unaffected) → small incremental pushes.
- Push wire protocol **v1-only**; isomorphic-git 1.42.x (MIT) pushes v1 by default and supports merge + custom `mergeDriver`.
- `refs/notes/*` (git notes) supported — the provenance home.
- Binding-side reads (`readFile`/`readCommit`/`readTree`/`readBlob`) make diffs possible in-Worker (CPU 30s default / 5 min max) — **review never clones**.
- Auth: Cloudflare API token for the control plane; repo-scoped git tokens via `POST /artifacts/namespaces/:ns/tokens` (scope read|write, ttl ≤ 1 year).

## What the platform builds (Artifacts leaves these open)

merge · diff · conflict detection · review/triage · landing validation · provenance · policy.

## Storage classes (three tiers)

| Tier | Holds | Serves |
|---|---|---|
| 1 · Semantic/index | per-file classification, type, security level, tags; codebase vector index | System-1 models classify every file cheaply; semantic traversal, not grep |
| 2 · Work/state | workspaces, task queue, presence, authoring leases, secret-typed files, stashes | durable, expiring, frequently-written state; locks are surgical |
| 3 · Provenance/artifact | git-notes, per-worker traces, receipts, previews, screenshots/videos, push provenance | the repo answers for itself — no clone required |

## Federation boundary

Windows / GPU / macOS workloads (game builds, console toolchains) cannot run on Cloudflare → self-hosted runners, post-demo. The platform orchestrates; it does not host them.

## Live build state (spike, 2026-10-03)

- namespace `nextgit`: repos `demo` (baseline) + `agent-1..4` (forks, scoped write tokens).
- queue `nextgit-events` + subscription `nextgit-repo-events` (repo.pushed, repo.forked, repo.created).
- worker `nextgit-events` (in `platform/`) consuming the queue.
- `platform/scripts/fanout.mjs` — provisions N agent forks + tokens in one command.
