# Digest — D2: Architecture patterns in practice (round 1)

- **Assistant:** D2Patterns (scout) · Round 1 · 2026-10-02 · Sources listed: 12
- **Format:** as returned (summary + sources + synthesis)

## Summary

D2 Architecture Patterns digest: Concurrent multi-agent code-change coordination. Four axes covered: (1) Coordination topologies — worktree-isolated fork-per-agent (CAID, CMU) dominates; stacked diffs/patch-series is the proven human-scale workflow (Meta Phabricator ~100% adoption, Google chained CLs, Uber/Twitter/Rubrik production); excess parallelism degrades stability (4 agents optimal, 8 hurts). (2) Merge & conflict — line-based merge inadequate for agents; AST-aware merge (Mergiraf/GumTree, tree-sitter) and entity-level merge (Weave + CRDT advisory claims) are emerging; CRDTs for *code* remain research-grade (no production account found). Three named failures: GitHub merge queue silent code deletion (Apr 23 2026, 2092 PRs/230 repos, 3h33m undetected), Autonoma subagent feature-deletion pattern (5+ parallel agents, silent drops), CAID soft-isolation failure (shared workspace dropped PaperBench below single-agent). (3) Edge/serverless fit — Cloudflare Artifacts (Durable Objects + Zig/WASM git engine, 1GB/repo, 32MB/file, 2k req/10s, no server-side merge/diff/conflict API) is the storage layer; no public production account of multi-agent merge coordination on Workers/DOs found — evidence is thin. (4) Landing at scale — merge-queue CI batching math is unforgiving (BuildPulse: 3% flake × 8-deep batch = 21.6% disruption; 10% = 41%); Trunk.io's "commit must equal human merge" bar validated by GitHub Apr 23 incident; Uber iOS mainline was green only 52% pre-queue.

## Sources

| # | URL | Notes |
|---|---|---|
| 1 | https://newsletter.pragmaticengineer.com/p/stacked-diffs | Stacked diffs at Meta (Phabricator ~100%), Google chained CLs, Uber/Twitter/Rubrik; 15M PR analysis |
| 2 | https://arxiv.org/html/2603.21489 | CAID (CMU, Jul 2026): worktree-isolated branch-and-merge; +25.6% PaperBench; soft-isolation failure; 4-agent optimum, 8 degrades |
| 3 | https://dev.to/varshithvhegde/github-broke-git-the-merge-queue-bug-that-silently-deleted-your-code-4f7i | GitHub merge queue silent deletion post-mortem (Apr 23 2026): 2092 PRs/230 repos, 3h33m undetected |
| 4 | https://trunk.io/blog/what-happens-if-a-merge-queue-builds-on-the-wrong-commit | Trunk.io on same incident; "commit must equal human merge" bar |
| 5 | https://getautonoma.com/blog/ai-subagent-merge-conflicts | Autonoma: silent feature drops from 5+ parallel agents; no error/test signal; 2-day debug |
| 6 | https://mergiraf.org/architecture.html | Mergiraf: tree-sitter + GumTree structured merge; line-merge-first fast mode |
| 7 | https://ataraxy-labs.github.io/weave/docs.html | Weave: entity-level merge + CRDT advisory claims; 22 MCP tools; reactive + proactive merge |
| 8 | https://buildpulse.io/blog/github-merge-queue-flaky-test-amplification | Flake amplification math: P=1-(1-f)^k; 3%×8-deep=21.6%; 10%=41% |
| 9 | https://blog.cloudflare.com/artifacts-git-for-agents-beta | Artifacts internals: Durable Objects + Zig/WASM git engine, ~128MB/DO, SQLite-backed, R2 snapshots, KV tokens, git-notes |
| 10 | https://developers.cloudflare.com/artifacts/platform/limits | Artifacts limits: 1GB/repo, 32MB/file, 2k git req/10s/repo, unlimited repos, 1TB/account |
| 11 | https://graphite.com/blog/bors-google-tap-merge-queue | Bors → Google TAP → GitHub merge queue lineage; Not Rocket Science Rule |
| 12 | https://newsletter.systemdesign.one/p/stacked-diffs | Stacked diff production patterns; unit-of-review = commit not PR |

## Synthesis (verbatim from digest)

The dominant reliable pattern for concurrent multi-agent code changes is worktree-isolated fork-per-agent with branch-and-merge integration (CAID), NOT shared-workspace soft isolation. Stacked diffs/patch-series (Phabricator/Gerrit/Jujutsu/GitButler) is the proven human-scale multi-PR workflow. For merge itself, line-based merge is structurally inadequate for agents — AST-aware (Mergiraf/GumTree) and entity-level (Weave) merge reduce false conflicts, but CRDTs for code remain research-grade (Weave uses CRDT only for advisory claims). Under Cloudflare constraints (Artifacts = git storage on Durable Objects, no server-side merge API, 32MB/file, 128MB/DO memory), merge must happen client-side or in a coordinator Worker/DO — no public production account of this exists yet. Landing at scale requires merge-queue semantics with strict CI-batching math (flakes compound with queue depth) and the invariant that the landed commit equals what a human would produce (validated by GitHub's Apr 23 silent-deletion incident). Key risk: subagent merges silently drop features with no error signal — behavioral/post-merge verification is the recommended gate.

---

## Contract supplement (recall pass, 2026-10-02)

### Leads worth chasing
- **Production account of multi-agent merge coordination on Durable Objects / Cloudflare Workers / Queues / state-machine orchestration (Temporal etc.)** — searched 4 query variants, none found. Gap is genuine.
- **Stacked-diffs-for-agents production metrics from Graphite** (ex-Meta Phabricator engineers; real customers) — agents vs humans conflict-rate measurement worth requesting.
- **Jujutsu (jj) concurrent-agent production metrics** — the jj team markets directly to agents; real conflict-rate numbers on HN/threads.
- **Mergiraf / Weave production adoption** — repo metrics to quantify whether AST/entity merge has crossed to "default."
- **GitHub Engineering formal post-mortem of the Apr 23 merge-queue incident** — acknowledged by Vlad Fedorov Apr 28; formal writeup would add root-cause depth.

### Looked for, not found
- **CRDT-based code merge at agent-scale production** — none found; Weave uses CRDT only for advisory claims.
- **Production system using Durable Objects as a multi-agent merge coordinator** — none found.
- **Server-side merge implementation in WASM/Workers** — none in public docs; Artifacts' WASM git engine does not expose merge resolution.
- **ctx agent merge queue** — GitHub URL 404; tool may have moved.

### Limitations
- Artifacts evidence is vendor-authored; no independent production user account read. "No merge API" inferred from API surface.
- Autonoma post is vendor marketing; failure scenario treated as named mode at medium confidence.
- ~12 primary sources read; ~18 tool calls.
- Public blogs/papers/docs only; no named-team interviews.
- Recency: GitHub bug (Apr 2026), CAID (Jul 2026), Artifacts changelog (Oct 2026) fresh; stacked-diffs article (2023) confirmed still current by GitHub shipping native stacked diffs in 2026.

### Top findings — per-claim metadata
1. CAID: 4 agents optimal, 8 degrade (worktree isolation mandatory) — https://arxiv.org/html/2603.21489 — CMU (Geng & Neubig) — 2026-07 — high — pattern
2. Stacked diffs: ~100% adoption at Meta, ~decade of chained CLs at Google, Uber/Twitter/Rubrik production — https://newsletter.pragmaticengineer.com/p/stacked-diffs — Pragmatic Engineer — 2023-10-17 — high — pattern
3. GitHub Apr 23 2026 merge-queue silent deletion: 2092 PRs/230 repos, +29/-34 → +245/-1137, 3h33m undetected, incomplete feature-flag root cause — https://dev.to/varshithvhegde/github-broke-git-the-merge-queue-bug-that-silently-deleted-your-code-4f7i — DEV Community (Varshith V Hegde) — 2026-05-03 — high — failure
4. Autonoma: 5+ parallel subagents silently drop features at merge (no error/test/log) — https://getautonoma.com/blog/ai-subagent-merge-conflicts — Autonoma (Tom Piaggio) — 2026-04-16 — medium — failure
5. Mergiraf: tree-sitter + GumTree classic, PCS-triple structured merge, line-merge-first fast mode, parse-error fallback — https://mergiraf.org/architecture.html — Mergiraf/Codeberg — 2024+ — high — capability
6. Weave: entity-level merge + Automerge CRDT advisory claims only (not enforced); 22 MCP tools; reactive driver + proactive coordination — https://ataraxy-labs.github.io/weave/docs.html — Ataraxy Labs — 2026 — high — capability
7. Flake math: P(disruption) = 1-(1-f)^k; 3% × 8-deep = 21.6%; 10% = 41%; flake-aware queue at Brex/Ramp/Supabase/Zillow — https://buildpulse.io/blog/github-merge-queue-flaky-test-amplification — BuildPulse — 2026-09-25 — high — scale-perf
8. Artifacts: Durable Objects + Zig/WASM git engine; 1GB/repo, 32MB/file, 2k git req/10s/repo; no server-side merge/diff/conflict API — https://blog.cloudflare.com/artifacts-git-for-agents-beta + https://developers.cloudflare.com/artifacts/platform/limits — Cloudflare — 2026-10-01 — high — scale-perf
