# Digest — R2: Design precedents for the convergence layer (round 2)

- **Assistant:** R2DesignPrecedents (scout) · Round 2 · 2026-10-02
- **Note:** output schema omitted source URLs; a source-list supplement was requested (pending at filing time).

## Summary (verbatim)

Round-2 design-precedent research complete. Read Cloudflare's AI code review blog post in full, rtk-ai/grit's README, Ataraxy-Labs Weave's README + full docs site, and GitGhost AI's public docs. Then searched for set-level multi-candidate review UX precedents across three domains: LLM output comparators, stacked-diff workflows, and legal redline tools. Key finding: Cloudflare's coordinator→specialist→risk-tier→verdict-aggregation pipeline is the strongest existing model for judging change-sets at scale; Weave and grit are execution substrates (entity-merge and conflict-prevention locks respectively) that a convergence layer would sit above; and there is a genuine design gap — no widely-deployed tool surfaces N *competing* code change-sets for side-by-side triage and convergence. GitGhost provides session evidence + approval gates but no set-level convergence semantics.

## Architecture (verbatim)

A convergence layer for N concurrent agent change-sets would stack three tiers: (1) an **execution substrate tier** — entity-level semantic merge (Weave-style, reactive, stateless, pure-function over base/ours/theirs) combined with advisory live coordination claims via CRDT (Automerge-backed heartbeat + claim/release), optionally augmented by function-level lock queues (grit-style claim→work→done) for contested symbols; (2) a **judgment tier** — a Cloudflare-style coordinator that fans out specialist reviewers (security, performance, correctness, policy, doc-coverage), each producing tiered findings, aggregated into a single structured verdict with developer-reply arbitration ('won't fix' vs 'I disagree' loops); and (3) a novel **set-level triage UI tier** — a side-by-side comparison surface for N competing change-sets, synthesizing patterns from LLM output comparators (side-by-side layout + human/LLM-as-judge scoring), stacked diffs (sequential cascading review), and legal redline (per-change accept/reject with consolidated merge). The triage UI is the primary UX greenfield — no existing precedent covers it for code. GitGhost's session-evidence + approval-gate model is the closest human-review bridge pattern.

## Open items
- Source URLs per item (supplement requested).

---

## Sources supplement (recall pass, 2026-10-02)

### Sources actually read
**Item 1 — Cloudflare AI code review orchestration**
- https://blog.cloudflare.com/ai-code-review — Cloudflare Blog — pub 2026-04-20, modified 2026-07-15 — **high**
- Mechanics: coordinator → 7 specialist reviewers (Code Quality, Security, Performance, Documentation, AGENTS.md materiality, Release, Codex-compliance); risk tiers (trivial/lite/full) gate orchestration depth; verdicts combined via coordinator; developer replies ('won't fix'/'I disagree') re-enter arbitration; ships as GitLab CI component; local `/fullreview` via `@opencode-reviewer/local`; median review 3m39s / $0.98; 131,246 runs / 48,095 MRs / 5,169 repos in first 30 days; 85.7% cache hit rate.
- No official Cloudflare open-source release of the reviewer code found (third-party reimplementations exist, e.g. nilesh32236/opencode-ai-reviewer, FelixNg1022/cf_ai_code_review).

**Item 2 — rtk-ai/grit** — https://github.com/rtk-ai/grit — GitHub (RTK AI) — accessed 2026-10-02 — **high**
- Mechanism: tree-sitter AST function-level locks; claim→work→done; per-agent worktrees under `.grit/worktrees/`; serialized merges via file lock; backends SQLite WAL (default), Azure Blob (atomic If-None-Match), S3/R2/MinIO; 13 languages; lock modes write/read/`--with-deps`; queue for contested symbols; `grit session pr`. Apache-2.0. 119 stars, 14 forks, 48 commits.
- Does NOT do: no review/compare/merge surface; no semantic quality understanding — purely conflict prevention via serialization.

**Item 3 — Weave** — https://github.com/Ataraxy-Labs/weave + https://ataraxy-labs.github.io/weave/docs.html — **high**
- Entity-level 3-way merge (tree-sitter via `sem-core`, pure function base/ours/theirs); CRDT advisory claims via Automerge at `.weave/state.automerge` (git-excluded); MCP server with 22 tools; `weave-driver` registered as git merge driver; `weave preview`; `weave patch extract/apply`; 23 languages + 5 data formats; fallback to line-merge for >1MB/binary/unsupported. Merge algorithm and CRDT coordination deliberately decoupled.
- Maturity: 1.3k stars, 45 forks, 15 contributors, 31 releases, latest v0.5.4 (2026-09-01). Dual MIT/Apache-2.0. No production deployment reports found.

**Item 4 — GitGhost AI** — https://docs.gitghost.ai/ai-agents + /ai-chat-and-agent-pairing — docs only; private beta — **medium**
- Hosted chat + local agent sync (Codex, Claude Code, Gemini CLI, Cursor, OpenCode, Copilot CLI); built-in roles; session evidence, checkpoints, action requests, merge requests; approval gates; budget/retention controls. Set-level comparison semantics: NOT FOUND.

**Item 5 — Set-level UX precedents (search-surfaced only — low-confidence signal, no pages fetched)**
- LLM output comparators: ai.google.dev/responsible/docs/evaluation/llm_comparator (Google PAIR); github.com/PAIR-code/llm-comparator; forkbench (llm-bench-psi.vercel.app); braintrust.dev; labelstud.io/templates/llm_side_by_side.
- Stacked-diff workflows: Graphite PRs; docs.github.com stacked PRs (public preview); docs.gitlab.com stacked diffs (experiment); github.com/adilp/git-stacked-diffs; github.com/andyrewlee/stacked.
- Legal redline: draftable.com legal compare; support.ironcladapp.com document versions; Microsoft Word legal blackline.

### Leads worth chasing
- Weave's `weave_github` crate (publish=false) — hosted analysis-as-comment pattern.
- Cloudflare's `internal-ai-engineering-stack` post (referenced in the blog).
- GitGhost `ai-sessions-and-evidence` / `ai-approvals-and-guarantees` doc pages.
- `sem-core` (Ataraxy-Labs/sem) entity taxonomy — shared entity vocabulary.

### Looked for, not found
- No open-sourced Cloudflare reviewer code.
- No production deployment reports or benchmarks for Weave or grit beyond own READMEs.
- No public GitGhost capability beyond docs/marketing; set-level convergence absent.
- No single widely-deployed UX surfacing N competing *code* change-sets: LLM comparators compare outputs; stacked diffs compare sequential versions of one proposal; legal redline compares documents.

### Limitations
- Firecrawl scrape for all primary sources (may miss dynamic content); no fallback reads.
- UX precedents search-surfaced only — weakly evidenced, treat as low-confidence signal.
- grit/Weave activity via GitHub metadata only (no issues/Discord/adoption threads).
- GitGhost private beta limits evidence.
