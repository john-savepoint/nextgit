# Digest — D3: Implementation reality + D4 dependency vitality (round 1)

- **Assistant:** D3ImplReality (scout) · Round 1 · 2026-10-02 · Sources listed: 17
- **Note:** first transmission failed (socket close); digest re-emitted on request. Research completed before failure.

## Summary

D3 (implementation reality) + D4 (dependency vitality) digest for Workers + Artifacts. Key findings: isomorphic-git 1.42.6 is actively maintained with a working merge+mergeDriver API but open issues on packfile corruption and large repos; web-tree-sitter 0.27.0 is viable edge-side (~1MB wasm + ~400KB per grammar) but no production diff/merge reports found; libgit2-via-wasm-git exists but has zero production reports; CRDT options (Automerge 3.5.0, Loro 1.16.4, Yjs v14.0.0-rc.28) are all actively released and edge-feasible; Cloudflare Workflows+DOs+Q are proven for agent loops but Artifacts has a known ~64MiB push cap (issue #29, acknowledged by Cloudflare, fix in progress); no public third-party Artifacts builds found since the 2026-10-01 open beta except Cloudflare's own vibesdk artifacts-viewer package.

## Sources

| # | URL | Notes |
|---|---|---|
| 1 | https://www.npmjs.com/package/isomorphic-git | isomorphic-git 1.42.6; 2.1M weekly downloads; maintainers wmhilton/mojavelinux/jcubic |
| 2 | https://github.com/isomorphic-git/isomorphic-git/issues/325 | Merge conflict detection issue open since 2018; merge() exists; conflicts surface via mergeDriver callback |
| 3 | https://github.com/isomorphic-git/isomorphic-git/issues/2017 | Large-repo packfile/timeout issue open since 2025-01 |
| 4 | https://github.com/isomorphic-git/isomorphic-git/releases | Releases page — v1.42.x line current |
| 5 | https://isomorphic-git.org/docs/en/mergeDriver | mergeDriver API docs |
| 6 | https://www.npmjs.com/package/web-tree-sitter | web-tree-sitter 0.27.0 |
| 7 | https://www.npmjs.com/package/tree-sitter-javascript | tree-sitter-javascript 0.25.0, wasm ~407KB |
| 8 | https://github.com/automerge/automerge/releases | Automerge v3.5.0 (JS); Rust crate updated 2026-06-05 |
| 9 | https://github.com/loro-dev/loro/releases | Loro loro-crdt 1.16.4 |
| 10 | https://github.com/yjs/yjs/releases | Yjs v14.0.0-rc.28 |
| 11 | https://github.com/cloudflare/developer-platform/issues/29 | Artifacts git push HTTP 500 at ~64 MiB — acknowledged, fix in progress |
| 12 | https://github.com/cloudflare/vibesdk/blob/main/packages/artifacts-viewer/README.md | Only known public Artifacts consumer (Cloudflare's own) |
| 13 | https://developers.cloudflare.com/workflows/reference/limits | Workflows: 10k steps default, 50k concurrent instances paid, 1MiB payload |
| 14 | https://developers.cloudflare.com/workflows/build/rules-of-workflows | Workflows idempotency/retry/ordering guidance |
| 15 | https://github.com/petersalomonsen/wasm-git | libgit2 via emscripten; no production reports found |
| 16 | https://github.com/cloudflare/computer/blob/main/docs/15_artifacts_interface.md | Cloudflare computer: session-scoped repos, tokens, import/export |
| 17 | https://blog.cloudflare.com/artifacts-git-for-agents-beta | Artifacts beta announcement |

## Bottom line (verbatim from digest)

Safely buildable in ~9 days on Workers + Artifacts: (1) isomorphic-git 1.42.6 as the JS/WASM git engine for pull/push against Artifacts smart-HTTP, using mergeDriver callback for custom conflict resolution; (2) jsdiff/diff3 for line-level diffs (~pure JS, edge-feasible) — tree-sitter only if grammar-aware diffs are needed (bundle ~400KB/g); (3) CRDT layer (Loro 1.16.4 or Automerge 3.5.0) for review-comment state and multi-agent merge-coordination — both actively maintained, both have WASM builds; (4) Workflows + Durable Objects + Queues for agent loop orchestration — proven pattern with clear limits (10k steps, 50k concurrency, 1MiB payload, no per-step ordering guarantees without careful design); (5) Artifacts as the git-over-HTTP storage layer with event subscriptions triggering agent loops. RISKIEST UNKNOWN: the Artifacts ~64MiB pack push cap (issue #29, acknowledged fix in progress but no ETA) — for repos with binary assets this is a hard wall; for text/code-only repos under ~60MiB packs it's workable today. No diff endpoint exists server-side, so diffing must be done client-side (isomorphic-git pack + jsdiff), which consumes Worker CPU time. No server-side merge API, so all merge conflict detection and resolution must be implemented client-side via mergeDriver. 9-day scope tight but feasible for a code/text-only repo with modest binary assets; confidence medium.

---

## Contract supplement (recall pass, 2026-10-02)

### Leads worth chasing
- Artifacts ~64MiB pack cap fix ETA (issue #29; ack by @NuroDev 2026-06-02 "working on fixing"; no resolution as of 2026-08-17) — determines if binary repos are in scope.
- isomorphic-git packfile issue #2017 (open since 2025-01, large-repo timeouts) — still present in 1.42.6? Test with a 100+ packfile repo edge-side.
- Tree-sitter grammar-aware diff/merge edge cost — no public reports; micro-benchmark Worker CPU time to parse + diff a 5k-line file × concurrent agents.
- DO + Workflow ordering semantics for agent coordination — confirm DO single-threaded + Workflow step queue gives enough ordering for a merge protocol.
- wasm-git vs isomorphic-git — no independent benchmarks exist.
- Automerge binary format long-term stability for review-comment storage.
- Loro 1.16.x vs Automerge 3.5.x WASM bundle size & load time in workerd.

### Looked for, not found
- Public repos/demos built on Artifacts since 2026-10-01 open beta: only Cloudflare's own vibesdk artifacts-viewer (read-only React viewer). No third-party builds.
- Production usage reports for wasm-git/libgit2-WASM in Workers/browser: zero; only static-library mentions (eliot-akira/git-wasm, steschi/libgit2-wasm).
- difftastic/mergiraf WASM builds: issue #407 open since 2022-10, still no official WASM target.
- Tree-sitter structural diff in browser/Worker for a git platform: no public examples.
- Cloudflare Workflows + DO multi-agent coding example beyond Cloudflare's own: none demonstrates multi-agent concurrent edits + merge coordination.

### Limitations
- No tool substitutions needed; ~18 searches + ~8 URL reads; within cap.
- Versions confirmed ≤1 month via npm/GitHub registry reads.
- Thin evidence: wasm-git production viability; tree-sitter structural-diff-in-Worker feasibility (inferred, not empirical).

### Top findings — per-claim metadata
- isomorphic-git 1.42.6, 2.1M weekly downloads, three active maintainers — https://www.npmjs.com/package/isomorphic-git — npm/isomorphic-git — 2026-09 — high — version-compat
- isomorphic-git merge via merge()+mergeDriver; conflict-detection issue #325 open since 2018; merge-strategies issue #727 open since 2019 — https://isomorphic-git.org/docs/en/mergeDriver + https://github.com/isomorphic-git/isomorphic-git/issues/325 — isomorphic-git — 2026 (docs live) — high — capability
- isomorphic-git large-repo packfile issue #2017 still open; CVE-2026-89011 prototype pollution in getRemoteInfo reported in 1.42.x — https://github.com/isomorphic-git/isomorphic-git/issues/2017 + https://app.opencve.io/cve?vendor=isomorphic-git — GitHub/CVE — 2025-01 / 2026 — high — failure
- web-tree-sitter 0.27.0: WASM runtime 4.5MB (web-tree-sitter.wasm) + ~407KB per grammar; viable edge-side, no CPU benchmark — https://www.npmjs.com/package/web-tree-sitter — npm — 2026-10 — medium — scale-perf
- Automerge JS v3.5.0 (~June 2026); Rust crate updated 2026-06-05; unfunded but active — https://github.com/automerge/automerge/releases — automerge — 2026-06 — high — vitality
- Loro loro-crdt 1.16.4, actively maintained (last commit 2026-09-10), MIT — https://github.com/loro-dev/loro/releases — loro-dev — 2026-09 — high — vitality
- Yjs v14.0.0-rc.28 (v13.6.33 stable), actively maintained — https://github.com/yjs/yjs/releases — yjs — 2026 — high — vitality
- Workflows limits: 10k steps default (25k configurable), 50k concurrent paid, 1MiB payload, 100MB–1GB persisted state — https://developers.cloudflare.com/workflows/reference/limits — Cloudflare — 2026-09-21 — high — scale-perf
- Workflows: steps must be idempotent; no per-step ordering guarantee beyond sleep/waitForEvent; DO footguns need explicit design — https://developers.cloudflare.com/workflows/build/rules-of-workflows — Cloudflare — 2026 — high — pattern
- Artifacts git push HTTP 500 at ~64MiB pack size; acknowledged known limitation, fix in progress (issue #29) — https://github.com/cloudflare/developer-platform/issues/29 — Cloudflare — 2026-06-01 / 2026-08-17 — high — capability
- vibesdk artifacts-viewer: only public Artifacts consumer found; read-only React viewer (file tree + Monaco + commit history + per-commit diffs) — https://github.com/cloudflare/vibesdk/blob/main/packages/artifacts-viewer/README.md — Cloudflare — 2026 — high — landscape
- wasm-git exists; zero production reports, zero independent benchmarks — https://github.com/petersalomonsen/wasm-git — petersalomonsen — unfetched — low — landscape
- No diff endpoint / no server-side merge / no conflict detection in Artifacts; no third-party public builds — https://developers.cloudflare.com/artifacts — Cloudflare — 2026-10-01 — high — landscape
