# Import: Cloudflare Artifacts — official docs reconnaissance

- **Collected:** 2026-10-02, by the project's ArtifactsRecon scout (read-only)
- **Scope:** `developers.cloudflare.com/artifacts/**` official documentation + the Workers Builds integration page
- **Status:** Filed as a **named import** for this research run. Treat as ONE publisher (Cloudflare official docs). Inadmissible as evidence for anything it does not itself state; claims below trace to the source pages listed at the end.

## Summary

Artifacts (open beta as of 2026-10-01) is a Git-compatible versioned filesystem built for agent/platform scale, exposed through three co-equal interfaces — Workers binding, REST API, Git-over-HTTPS smart HTTP — all pointing at the same underlying repository. Repos live in namespaces; each repo is an isolated Git service with its own refs, history, tokens, and remote URL; durable by default (synchronous multi-DC replication + async object storage). Events are delivered via Cloudflare Queues event subscriptions. Forking creates a new repo from existing history, then diverges.

## Capabilities confirmed

- **Repo ops:** create / get / list / import (public HTTPS remote) / delete / fork — via Workers binding, REST, and Wrangler CLI
- **Content:** `readFile`, `readCommit`, `readTree`, `readBlob`, `log`; REST content routes for log/commit/tree/blob/file/raw
- **Tokens:** repo-scoped git tokens (read/write); Cloudflare API tokens (Artifacts Read/Edit) for the control plane; token.created/revoked events
- **Events:** `repo.created/deleted/forked/imported`, `repo.pushed/cloned/fetched`, `token.created/revoked` — delivered via Cloudflare Queues event subscriptions
- **Jurisdictions:** `us` / `eu`, set at namespace creation, immutable
- **Observability:** GraphQL dataset `artifactsEventsAdaptiveGroups`
- **Ecosystem:** Workers Builds integration (production branch deploys; preview branches), ArtifactFS (FUSE, blobless lazy mount, on-demand hydration), `@cloudflare/ci` SDK for build-and-deploy-on-push via Workflows
- **Documented best practices:** repo-per-agent, unique names, fork-from-baseline, least-privilege tokens, git notes

## Limits (documented)

- Repo ≤ 1 GB · file ≤ 32 MB · account storage 1 TB (raiseable) · unlimited repos/namespaces
- 2k control-plane requests / 10 s / namespace; 2k git requests / 10 s / repo

## Critical gaps for a multi-agent concurrency platform (documented absences)

- **No server-side merge API. No diff endpoint. No conflict detection. No branch protection.**
- Concurrent-push semantics are undocumented.
- No webhook/push notification outside event subscriptions (Queues).
- Consequence: merge/review/conflict logic must be built client-side (isomorphic-git / libgit2 / git CLI) or as custom Worker-side tooling.

## Pricing

Workers Paid plan required. 10k ops/mo free, then $0.15/1k ops; 1 GB-mo free, then $0.50/GB-mo. Billing starts 2026-10-14 (docs page; the launch blog said Oct 15 — docs date treated as current).

## Source pages

- https://developers.cloudflare.com/artifacts/ (landing)
- https://developers.cloudflare.com/artifacts/api/workers-binding/
- https://developers.cloudflare.com/artifacts/api/rest-api/
- https://developers.cloudflare.com/artifacts/api/git-protocol/
- https://developers.cloudflare.com/artifacts/api/wrangler/
- https://developers.cloudflare.com/artifacts/api/errors/
- https://developers.cloudflare.com/artifacts/guides/event-subscriptions/
- https://developers.cloudflare.com/artifacts/guides/authentication/
- https://developers.cloudflare.com/artifacts/guides/import-repositories/
- https://developers.cloudflare.com/artifacts/guides/artifact-fs/
- https://developers.cloudflare.com/artifacts/guides/data-localization/
- https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
- https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/
- https://developers.cloudflare.com/artifacts/concepts/repositories/
- https://developers.cloudflare.com/artifacts/concepts/best-practices/
- https://developers.cloudflare.com/artifacts/platform/pricing/
- https://developers.cloudflare.com/artifacts/platform/limits/
- https://developers.cloudflare.com/artifacts/observability/metrics/
- https://developers.cloudflare.com/artifacts/platform/changelog/
- https://developers.cloudflare.com/artifacts/get-started/workers/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/
