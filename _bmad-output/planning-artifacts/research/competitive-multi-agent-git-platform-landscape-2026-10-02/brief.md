# Research plan — competitive sweep (2026-10-02)

**Run:** competitive · multi-agent git platform landscape · `competitive-multi-agent-git-platform-landscape-2026-10-02`
**Intent:** run (native) · **Preset:** standard — 3 subagents/round · 8–10 sources/dim/round · depth ≤2 · validation `normal` · red-team `off`
**Decision:** whitespace + differentiation verdict for the competition submission (originality 50% / multi-agent concurrency 25% / UX 25%); submission due 2026-10-14.

## Dimensions & topology (breadth-first, 2 rounds)

| Round | Dimension | Scope |
|---|---|---|
| R1-A | Incumbent platforms | GitHub (Agent HQ / Copilot / agents panel), GitLab, Cursor (+Graphite), Google, OpenAI, Anthropic, Sourcegraph; platform-scale "git for agents" entrants (e.g. Entire — verify) |
| R1-B | AI review & merge tooling | CodeRabbit, Greptile, Macroscope, Qodo, Ellipsis, Graphite, Aviator, Trunk, Bors-NG, Mergify, Reviewpad + 2026 entrants |
| R1-C | Multi-agent workbenches | Conductor, Sculptor, Vibe Kanban, Crystal, Terragon, Omnara, Claude Squad, Devin, Factory, All Hands, editor multi-agent features |
| R2-D | Differentiator prior-art | Secret-typed files · semantic/AST visual review (Whiteboard et al. current status) · agent provenance/attribution (Git AI et al.) · concurrent merge approaches (queues, CRDT, stacked flows) · plus load-bearing leads from R1 |

## Knobs (in force, source)
preset `standard` (config default) · subagents 3/round (preset) · sources ≤10 per assistant (preset 8, slack) · depth ≤2 (preset) · validation `normal` (config) · red_team `off` (config) · `use_workflows=offer` → direct parallel subagent fan-out chosen (reliability) · output_format `auto` → md only (skill-invoked run).

## Search surfaces
Harness `web_search` · Firecrawl MCP (search/scrape) · vendor docs, changelogs, pricing pages as primary sources.

## Estimate
R1 ~10 min · R2 ~10 min · synthesis & finalize ~15 min.

## Artifacts
`research.md` (canonical) · `digests/` · `.memlog.md` · `brief.md` (this file).

## Digest naming
`<dimension>-r<round>-<n>.md` — e.g. `d1-incumbents-r1-1.md`.

## Round 2 execution (2026-10-02)
- `d4-security-provenance-r2-1.md` — secret-typed files & provenance/attribution prior-art
- `d5-visual-semantic-review-r2-1.md` — semantic diff / visual review / spatial canvas prior-art
- `d6-chases-sentiment-r2-1.md` — Entire ship-state, GitHub latest, sentiment closeout
- `verification-r1.md` — independent verification of R1 load-bearing claims (VerifierR1)
