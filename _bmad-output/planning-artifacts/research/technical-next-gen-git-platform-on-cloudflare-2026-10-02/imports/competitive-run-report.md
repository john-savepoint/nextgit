---
title: 'competitive research: multi-agent git platform landscape'
type: 'competitive'
topic: 'multi-agent git platform landscape'
decision: 'Differentiation and whitespace for a multi-agent concurrent software collaboration platform (Cloudflare Workers + Artifacts) — verify what already exists, what to beat, and where originality is defensible.'
source: 'native run'
status: complete
preset: 'standard'
validation: 'normal'
claims: 'verified 10 / unverified 3 (bounded absences)'
created: '2026-10-02'
updated: '2026-10-02'
---

# competitive research: multi-agent git platform landscape

**Decision this research serves:** Differentiation and whitespace for a multi-agent concurrent software collaboration platform (Cloudflare Workers + Artifacts) — verify what already exists, what to beat, and where originality is defensible.

## Executive summary

**What to do:** Build the **convergence layer** — the surface where multiple agents' concurrent changes are reviewed, compared, and integrated as one set — and make it the submission's hero flow. Every part of this field is commoditized *except* that layer; the rubric's 50% originality weight and 25% concurrency weight both point directly at it.

**Three findings drive that:**
1. **No set-level review exists anywhere.** Six independent search efforts (three R1 threads, a fresh-context falsification pass, R2 chases, lead freshness scans) across incumbents (GitHub, GitLab, Cursor/Graphite, OpenAI, Anthropic, Google, Sourcegraph, Entire), review vendors (CodeRabbit, Greptile, Qodo, Macroscope), and workbenches (Conductor, Sculptor, Superset, GitGhost) found only per-PR or per-agent review [2][3][31][58][78]. Merge queues reason about sets only as CI batches.
2. **Isolation is solved; reconciliation is not.** Worktrees/containers/cloud VMs per agent are standard [10][18][45][50][47]; the cross-agent reconciliation surface is missing — and practitioners name the exact gaps: overwrites, visibility, concurrent-modification conflicts [41][42][43].
3. **The sharpest overlap risks: Whiteboard, GitGhost, Entire.** Whiteboard (/dev/fast) already ships cross-platform, open-source AST-diff visual review with agent-trajectory auditing — one branch at a time, local [67]. GitGhost AI (beta) is the closest live commercial adjacent platform ("multiplayer agent work," per-change trails) [58]. Entire ($60M, ex-GitHub CEO) has announced an overlapping context-graph platform — the platform is unshipped, though the company ships weekly [20][21][22]. Differentiation must be **set-level concurrency + platform multiplayer**, not visuals alone.

**Biggest caveat:** the absence claim is *un-falsified, not proven* — bounded by search coverage and stealth/private products; GitGhost appearing in beta is the cautionary example. Re-check before submission; watch GitHub Universe (Oct 28–29) [7] and Entire.

**Secondary wins available:** the unclaimed trust bundle (typed secret files + signed agent identity + per-change rationale) [59][62][65] and the unclaimed Cloudflare substrate (Artifacts + Workers/Durable Objects/Queues) that no surveyed competitor builds on [78].

_Full evidence: dimension sections below; independent verification record in `verification-r1.md`; raw digests in `digests/`._

## Method & scope

- **Rounds:** 2 (standard preset): R1 = 3 parallel research threads (incumbent platforms; AI review/merge tooling; multi-agent workbenches) + independent verification; R2 = 3 parallel threads (security/provenance prior-art; visual/semantic review prior-art; chases + sentiment closeout), plus lead-level freshness scans (GitHub changelog; GitLab release; GitGhost AI).
- **Evidence rules:** external web sources only; every claim carries a source; freshness bars 3/6/12 months (features+pricing / trajectory / sentiment). Load-bearing claims independently verified in a fresh-context pass (`verification-r1.md`). Absence claims are bounded by documented searches — "no counterexample found", never proof.
- **Access date:** 2026-10-02 (all sources).

## The field on one screen

| Player | Concurrency model (what ships) | Review granularity | Context / provenance |
|---|---|---|---|
| GitHub | Agent HQ: many concurrent sessions; agents inside paid Copilot [1] | One PR per review [2][3] | Agent identity (roles/policies); no per-change rationale |
| GitLab | Duo Agent Platform GA: agents + flows across the SDLC [8][9] | Per MR [8] | Governance dashboard; audit events [8] |
| Cursor / Graphite | /multitask subagents; Projects: thousands of subagents; Cloud Agents [10][13] | Per PR; stacked PRs sequential [12] | Agent-thread context preserved across tools [12] |
| OpenAI Codex | Parallel cloud tasks; subagents consolidate into one result [14] | Per PR [14][15] | — |
| Anthropic Claude Code | Agent teams (experimental); cloud sessions GA [16][17] | Per change; same-file overwrites conceded [16] | Task list + mailbox (session-scoped) [16] |
| Google Antigravity | Subagents with automatic worktree isolation [18] | Per change [18] | — |
| Sourcegraph Amp | Agents spawning agents across machines (orbs) [19] | Per result [19] | — |
| Entire | Distributed Git network; per-commit checkpoints; per-branch multi-agent review [20][21][22] | Per branch [21] | Checkpoint trailer + session store [22][64] |
| Macroscope | Murmur: per-agent cloud VMs; "Director" fleet control [29] | Per PR [29][30] | Enterprise audit/event logs [29] |
| CodeRabbit / Greptile / Qodo | Single-agent review as a product [26][27][28] | Per PR (credit/usage metered) [26][27][28] | Learnings, custom rules [26][28] |
| Trunk / Mergify (merge queues) | Batch reasoning over concurrent changes at CI level [31][32] | Set-aware at merge only [31][32] | — |
| Conductor / Superset | Parallel agents; isolated workspaces/worktrees [45][50] | One at a time from a single pane [45][50] | — |
| Sculptor | Containers per agent; conflict flag + hand-back [47] | Per agent [47] | Full session history preserved [47] |
| GitGhost AI (beta) | Multiplayer agent workspace; hosted repos [58] | Per change trail [58] | Sessions/checkpoints/approvals attached [58] |
| Whiteboard (dev/fast) | Local AST-diff visual review [67] | One branch/diff at a time [67] | Agent-trajectory audit [67] |
| Git AI / gitsign | Attribution + signing layers (not platforms) | — | Notes-based authorship [62][63]; OIDC signing [65] |
| **The gap** | — | **No one: compare/integrate N concurrent change-sets as one set** | **No one: intent as a reviewable artifact** |

## D1 — Incumbent platforms: what multi-agent work actually ships

**GitHub.** "Agent HQ" (Universe, Oct 2025) is a mission-control layer for assigning, steering, and tracking multiple agents from GitHub, VS Code, mobile, and CLI, with third-party agents (Anthropic, OpenAI, Google, Cognition, xAI) delivered inside paid Copilot [1]. Shipped today: concurrent agent sessions; an Agents tab per repo plus an Agents page; session logs and mid-session steering; and "review and merge agent code" — which routes to **one pull request at a time** [2] (verified). Mid-2026 additions stayed agent-level: Claude + Codex in public preview (2026-02-04) [4], agent apps (2026-06-02) [5], requestable/configurable Copilot reviews (2026-09-23) [6], and an async merge API GA (2026-10-01) — per-PR automation, not set-level review [3]. GitHub Universe 2026 runs Oct 28–29 [7].

**GitLab.** Duo Agent Platform reached GA in 18.8 (announced 2026-01-15) [8][9]: custom/external/foundational agents, Developer/Code-Review/Fix-CI flows, MR-scoped interactions, Duo merge-conflict resolution, plus an AI governance dashboard and audit events. Coordination is flow/task-level; review remains per-MR [8].

**Cursor (+ Graphite).** Cursor 3.2 (2026-04-24) shipped `/multitask` async subagents and worktree isolation [10][11]; Cursor Projects (2026-09-10) coordinates "thousands of subagents" — isolated on their own machines [13]. Graphite (Cursor-owned since 2025-12-19 [33][34][35]) integrates Cloud Agents with an Agents tab and preserves agent-thread context across tools [12] — the closest incumbent review surface, but per-PR and sequential across stacked PRs.

**OpenAI / Anthropic / Google / Sourcegraph.** Codex: parallel cloud tasks + subagents that consolidate into one result; review per-PR [14][15]. Claude Code: parallel modes including experimental agent teams with shared task list and mailbox — docs concede "two teammates editing the same file leads to overwrites"; Claude Code on the web GA Sept 2026 [16][17]. Antigravity 2.0: subagents with autonomous worktree creation/cleanup [18]. Amp: agents spawning agents across machines [19]. All execution-layer; none ships a set-level review surface.

**Entire (entrant).** The one to watch: Dohmke's $60M seed (2026-02-10; independently verified [20][24][25]) shipped only a Checkpoints CLI (per-commit agent context via trailer) and a distributed Git network; the announced coordination/context-graph platform remains **not shipped** as of 2026-09-28 despite a weekly shipping cadence [20][21][22][23].

**Verdict.** Every checked incumbent solves concurrency at the *execution* layer; review/integration remains one change at a time. No incumbent ships a surface that compares/integrates multiple concurrent agent-produced changes together. (High confidence on shipped capabilities — vendor primaries; the negative is un-falsified across six independent search efforts — see Contrary evidence.)

## D2 — AI review & merge tooling: single-change reviewers, batch-level queues

**Review products — all single-change.** CodeRabbit: Essentials $24 / Team $48 / Advanced $72 per dev/mo (annual billing) plus a metered agent at $0.40/agent-minute; agentic reviews on PRs + CLI [26]. Greptile: free tier; Pro $30/seat/mo with credit-metered depth (Base 1 / Plus 3 / Apex 10 credits) [27]. Qodo: $0.012/credit pooled, positioning as "Quality Control for the Agentic Software Factory" [28]. Macroscope: launched Murmur (2026-09-03) — per-agent cloud VMs, self-driving PR lifecycle (review comments, CI repair, rebase, conflict resolution), a CLI + MCP "Director" making a local session "the control plane for a fleet" [29] (verified vendor-primary); detection modes priced $0.025–$0.20/KB; MacroscopeBench public [30]. Every product reviews **one change at a time**; Murmur coordinates a fleet but still lands each change as its own PR [29][30].

**Merge automation — the only set-level reasoning, at the CI layer.** Trunk explicitly targets agent churn and "logical conflicts, where two PRs merge cleanly but still break main," with parallel queues, batching, and auto-bisection (claims 60–90% CI-cost cuts) [31]. Mergify adds batching, bisect, flake quarantine, and merge protections; its 2026 comparison shortlists GitHub-native MQ, Graphite, Trunk, Aviator, Mergify [32]. This layer reasons about sets only as CI batches — it never reviews semantic intent or competing proposals.

**Effectiveness & discourse.** SWE-PRBench (350 annotated PRs): eight frontier models detect only 15–31% of human-flagged issues [36]. Practitioner threads document doubled PR volume turning seniors into full-time reviewers, and "the rate of code generation >> the rate of effective code review" [37][38][39][40]. Three 2026 comments name the exact gap: "a stateful file-writing layer … prevents agents from overwriting each others work" [41]; "the biggest gap isn't prompting — it's visibility" [42]; "how do you prevent conflicts when agents are making concurrent modifications" [43]; CRDTs are speculated as a fix [44].

**Verdict.** No fleet-review category exists; the nearest live product (Murmur) is per-PR orchestration. High confidence (vendor primaries); sentiment directional (G2/Reddit blocked → Hacker News).

## D3 — Multi-agent workbenches: isolation solved, reconciliation not

**What ships.** Conductor runs parallel Claude Code/Codex/Cursor agents in isolated workspaces (macOS + cloud) with one view and a review-and-merge flow [45][46]. Sculptor (Imbue) runs each agent in its own container, flags merge conflicts and hands them back to the agent, and "saves every agent session with its plans, chats, tool calls, and code changes all intact" — the closest shipped instance of session context as a first-class artifact [47] (verified vendor-primary). Superset (2026): "Scale to 100+ agents," a worktree per task, monitor/review/merge from one place (Elastic License 2.0; ~14.8k stars claimed) [50]. Nimbalyst (Crystal's successor): MIT-licensed visual workspace unifying sessions/tasks/docs with agents-as-files [51][52]. VS Code 1.109: multi-agent sessions in one place [56]. Also present: Devin (cloud async, self-verification), Factory "Missions" (subtask fan-out), Omnara (durable agent hosting) [57][54][55].

**Churn signals.** Vibe Kanban (28.2k stars) shut down 2026-04-10 — "vast majority are free users and we couldn't find a business model"; Terragon shut down 2026-01-16; Crystal superseded [48][49][51][53]. Monetization is drifting to teams/scale (Superset, Nimbalyst).

**Closest live adjacent platform — GitGhost AI** (private beta): "Multiplayer workspace for AI coding agents" — connects Claude Code/Codex/Gemini/Cursor/OpenCode; hosts repos; attaches shared sessions, transcripts, checkpoints, approvals, and security/pipeline evidence to each change: "Every agent change gets a team-readable trail" [58]. Per-change review with session provenance — the strongest overlap found, but it does **not** present concurrent changes as a set to compare/select/integrate.

**Verdict.** Isolation-per-agent is commoditized (worktree/container/VM); cross-agent reconciliation exists only as per-agent conflict flagging. No workbench compares N agents' competing changes and recommends what ships.

## D4 — Differentiator prior-art: security & provenance

**Secrets — typed files unclaimed.** Shipped secret handling is either detection/blocking (GitHub secret scanning across history + push protection; 2026-09-09 added "block pull requests with exposed secrets from merging" [3][59]), content encryption with no revocation or per-user scoping (git-crypt: unkeyed collaborators see ciphertext; access is per-key, unrevocable [60]), or value encryption under an external KMS (SOPS [61]). No shipping code host treats files as **typed, access-controlled objects** — no file-level read blocking, schema-only views, or elevation-to-reveal [59][60][61].

**Provenance — emerging, fragmented.** Git AI (Apache-2.0) publishes an open standard v3.0.0: authorship attestations stored as Git Notes under `refs/notes/ai` (`agent_id` = {tool, id, model}; line-range attestation; transcripts stored externally, redacted); 14 agents named in its supported-agents table; a Teams product is in early access [62][63]. Entire stores sessions per commit behind an `Entire-Checkpoint` trailer [64]. Attribution is acknowledged as unsolved in current research (AgenTag, ~2026-08 [66]).

**Identity — no cryptographic agent IDs.** gitsign provides keyless OIDC-bound commit signing (workload/human identity), not a distinct agent identity; no product binds commits to a verified agent identity at platform level [65].

**Verdict.** Each leg exists separately in different tools; **the three-way bundle — typed secret files + signed agent identity + per-change rationale records — is unclaimed at platform level.** (High confidence on positives — primary sources; negatives are bounded absence, medium.)

## D5 — Differentiator prior-art: visual & semantic review

**Whiteboard (/dev/fast) — corrected, and it's close.** Not macOS-only: cross-platform (macOS/Windows/Linux), source-available (`devdotfast/whiteboard`), free local app with a hosted tier "coming soon" [67]. Ships AST-based semantic diffs via its own Rust `diffr` engine, agent-trajectory auditing, and a "Copy for Agent" handoff [67]. It reviews one branch/diff at a time — no multi-agent set-review surface is shown [67]. Sharpest overlap risk; differentiation must be explicit: set-level, platform-native, concurrent.

**Semantic diff.** Active OSS (Difftastic v0.72 — 0.70.0 released 2026-08-07; diffsitter) and one commercial product (SemanticDiff: VS Code extension + GitHub App) [68][69][70]. No native AST diff on GitHub/GitLab/Bitbucket; SemanticMerge no longer exists standalone (Unity's semantic merge is asset-scoped) [70][71].

**Diagram review.** CodeSee lives on inside GitKraken (acquired 2024-05-14) [72]; Swimm repositioned to AI code comprehension [73]. Whiteboard already ships diagram→source navigation [67].

**Spatial canvas.** Building blocks are mature and borrowable: tldraw, React Flow, react-three-fiber [74][75]. Figma is moving its canvas toward code + AI (Feb 2026 blog; MCP write-to-canvas) but no live "Figma for code" product exists [76][77].

**Verdict.** Every ingredient exists to borrow; the **set-level spatial/AST review surface for multiple concurrent agent change-sets — with cross-change overlap/conflict semantics — is unclaimed** (medium confidence; absence bounded by the search budget).

## Cross-dimension insights

1. **Execution is solved; convergence is missing.** The whole field standardized isolation (worktrees, containers, cloud VMs) and left the reconciliation layer open. That layer *is* the competition rubric's second bucket (coordination, context preservation, review, conflict handling) — and half the rubric is originality.
2. **Context preservation is being won at tool level, not platform level.** Sculptor sessions, Git AI notes, Entire checkpoints — none makes intent a *reviewable, mergeable* artifact. Entire's announced context graph is the only direct race; it is not shipped.
3. **Whiteboard validates the visual-review demand and sets the quality bar; GitGhost validates "multiplayer agent work" commercially.** Our differentiation cannot be "another visual reviewer" — it must be *set-level concurrent integration* + platform economics.
4. **Graveyard economics.** Free-user-only agent tooling dies (Vibe Kanban, Terragon); the monetizable layer is teams/scale/audit. A winning demo should show team-scale trust, not a solo toy.
5. **The trust bundle is unclaimed and cheap to demo.** Typed secret files + signed agent identity + per-change rationale — no vendor packages any two of these today.
6. **The substrate is a moat.** Artifacts (fork/token/events) + Workers/DO/Queues has no counterpart in any surveyed competitor; Entire's distributed Git network is the closest announced piece. Nobody in the survey builds on it.

## Contrary evidence & disconfirmation log

- **Falsification attempt (core claim):** six general-web searches across three phrasings, plus candidate review. Surfaces checked and rejected as non-set-level: runfleet.dev, agentfleet.live, augmux, mergeshield, mergewatch.ai (all per-agent/per-PR); Conductor, agents-fleet, diffray (per-agent or single-diff). Strongest near-miss: **GitGhost AI** — per-change review trails, not set-level; private beta [58]. No counterexample found; the absence is *un-falsified*, not proven. Coverage limits: stealth/unlaunched products, non-indexed niches, search coverage [78].
- **Whiteboard is the sharpest overlap** and a moving target (active development, hosted tier announced) [67].
- **Murmur (Macroscope) and Sculptor were verified against vendor primaries only** — no independent non-vendor corroboration obtained [29][47].
- **Sentiment evidence is directional** (Hacker News; G2 and Reddit blocked) — indicative, not representative [37][38][39][40][41][42][43][44].
- **Entrant risk:** Entire holds funding + cadence + an announced overlapping platform [20][21][22][23]; GitHub Universe (Oct 28–29) could shift the field mid-build [7].

## Recommendations

1. **Build the convergence layer — set-level review of N concurrent agent change-sets as one triage surface.** This is the unclaimed core; make it the hero flow of the submission. *(Basis: high-confidence absence + rubric mapping.)*
2. **Make intent first-class: a per-change decision ledger (rationale, prompts, constraints) that is reviewable and mergeable.** Borrow the notes/trailer mechanics (Git AI, Entire patterns) and leapfrog the prior art by integrating them into review rather than storage. *(Basis: medium-high; fragmented prior art, none integrated.)*
3. **Differentiate from Whiteboard explicitly: concurrent set semantics + cross-change conflict graph + platform multiplayer.** Adopt its AST-diff thinking, executed in Workers/WASM (tree-sitter-class parsing), not as a local app. *(Basis: medium-high.)*
4. **Ship a visible trust beat:** typed secret files (schema view + elevated reveal), signed agent identity, leak scrubbing as a secondary wow. *(Basis: medium; unclaimed three-way bundle.)*
5. **Anchor on the Cloudflare substrate:** Artifacts fork/events/tokens + Workers/DO/Queues choreography; demonstrate "N agents → one control tower → ship." *(Basis: high on documented capabilities; medium on beta limits — technical recon.)*
6. **Maintain a watch list:** Entire platform launch; GitHub Universe Oct 28–29; GitGhost AI beta; Macroscope Murmur evolution. Re-check before submission. *(Basis: trajectory signals ≤6 months.)*

## Open questions

- GitGhost AI's exact set-level semantics (private beta — register/verify directly) [58].
- Whiteboard's hosted-tier and multi-branch roadmap (Discord lead) [67].
- Entire platform GA timing ("later 2026") [20] and whether GitHub Universe 2026 ships anything set-level [7].
- Entity-level merge as borrowable prior art (for example, Weave) — not evaluated.
- No public visibility into other competition entrants.
- Artifacts open-beta limits under load (from the technical reconnaissance; separate brief).

## Source appendix

All sources accessed 2026-10-02.

| # | Supports | Publisher | Pub date | Access | Confidence |
|---|---|---|---|---|---|
| [1] | Agent HQ mission control; third-party agents | [The GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/) | 2025-10 | 2026-10-02 | high |
| [2] | Concurrent sessions; Agents tab/page; PR-routed review (verified) | [GitHub Docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/agent-management) | undated | 2026-10-02 | high |
| [3] | 2026 GitHub changelog scan; async merge API GA; secret-block merge | [GitHub Changelog](https://github.blog/changelog/) | 2026-10-01 | 2026-10-02 | high |
| [4] | Claude + Codex public preview on GitHub | [GitHub Changelog](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github) | 2026-02-04 | 2026-10-02 | high |
| [5] | Agent apps | [GitHub Changelog](https://github.blog/changelog/2026-06-02-extend-github-with-agent-apps) | 2026-06-02 | 2026-10-02 | high |
| [6] | Copilot review request/config changes | [GitHub Changelog](https://github.blog/changelog/2026-09-23-copilot-code-review-more-ways-to-request-and-configure-reviews) | 2026-09-23 | 2026-10-02 | high |
| [7] | GitHub Universe 2026 (Oct 28–29) | [GitHub Universe](https://githubuniverse.com/) | 2026 | 2026-10-02 | high |
| [8] | Duo Agent Platform features; per-MR scope | [GitLab Docs](https://docs.gitlab.com/user/duo_agent_platform/) | undated | 2026-10-02 | high |
| [9] | Duo Agent Platform GA announcement (18.8) | [GitLab Press](https://about.gitlab.com/press/releases/2026-01-15-gitlab-announces-duo-agent-platform-general-availability) | 2026-01-15 | 2026-10-02 | high |
| [10] | Cursor 3.2 /multitask subagents | [Cursor Changelog](https://cursor.com/changelog/04-24-26) | 2026-04-24 | 2026-10-02 | high |
| [11] | Cursor worktree isolation | [Cursor Docs](https://cursor.com/docs/configuration/worktrees.md) | undated | 2026-10-02 | high |
| [12] | Graphite Cloud Agents integration | [Graphite Blog](https://graphite.com/blog/cursor-cloud-agents) | 2026-03 | 2026-10-02 | high |
| [13] | Cursor Projects; subagent scale | [Cursor Changelog](https://cursor.com/changelog) | 2026-09-10 | 2026-10-02 | high |
| [14] | Codex subagents/multi-agent | [OpenAI Developers](https://developers.openai.com/codex/multi-agent) | undated | 2026-10-02 | high |
| [15] | Codex code review (per-PR) | [OpenAI Developers](https://developers.openai.com/codex/cloud/code-review) | undated | 2026-10-02 | high |
| [16] | Agent teams; same-file overwrite limitation | [Claude Code Docs](https://code.claude.com/docs/en/agent-teams.md) | undated | 2026-10-02 | high |
| [17] | Claude Code on the web GA | [Anthropic](https://www.anthropic.com/news/claude-code-on-the-web) | 2026-09 | 2026-10-02 | high |
| [18] | Antigravity 2.0 subagents/worktrees | [Google Antigravity Blog](https://antigravity.google/blog/google-io-2026-feature-deep-dive) | 2026-05 | 2026-10-02 | high |
| [19] | Amp agent-to-agent | [Amp](https://ampcode.com/news/from-agent-to-agent) | 2026-07 | 2026-10-02 | high |
| [20] | Entire launch; $60M seed; Checkpoints CLI (verified) | [Entire](https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round) | 2026-02-10 | 2026-10-02 | high |
| [21] | Entire shipped surface | [Entire](https://entire.io/) | 2026-09 | 2026-10-02 | high |
| [22] | Entire blog index (no coordination product) | [Entire Blog](https://entire.io/blog) | 2026-09-28 | 2026-10-02 | high |
| [23] | Entire distributed Git network | [SD Times](https://sdtimes.com/softwaredev/startup-entire-launches-distributed-git-network-for-the-agent-era) | ~2026-07 | 2026-10-02 | medium |
| [24] | Entire funding (independent) | [Yahoo Finance / TechCrunch](https://finance.yahoo.com/news/former-github-ceo-raises-record-143000554.html) | 2026-02-10 | 2026-10-02 | high |
| [25] | Entire funding (independent) | [GeekWire](https://www.geekwire.com/2026/former-github-ceo-launches-new-developer-platform-with-huge-60m-seed-round/) | 2026 | 2026-10-02 | high |
| [26] | CodeRabbit pricing/capabilities | [CodeRabbit](https://www.coderabbit.ai/pricing) | 2026-10 (live) | 2026-10-02 | high |
| [27] | Greptile pricing | [Greptile](https://www.greptile.com/pricing) | 2026-10 (live) | 2026-10-02 | high |
| [28] | Qodo pricing/positioning | [Qodo](https://www.qodo.ai/pricing/) | 2026-09 | 2026-10-02 | high |
| [29] | Murmur launch/specs (vendor-primary verified) | [Macroscope](https://www.macroscope.com/blog/introducing-murmur) | 2026-09-03 | 2026-10-02 | high (vendor; no independent) |
| [30] | Macroscope changelog; per-PR; detection pricing | [Macroscope Docs](https://docs.macroscope.com/changelog) | 2026-09-25 | 2026-10-02 | high |
| [31] | Trunk agentic merge queue | [Trunk](https://trunk.io/merge-queue) | undated | 2026-10-02 | medium (vendor) |
| [32] | Mergify comparison matrix | [Mergify](https://mergify.com/compare-mergify) | 2026 | 2026-10-02 | medium (competitor-authored) |
| [33] | Cursor acquires Graphite | [Fortune](https://fortune.com/2025/12/19/cursor-ai-coding-startup-graphite-competition-heats-up/) | 2025-12-19 | 2026-10-02 | high |
| [34] | Cursor acquires Graphite | [TechCrunch](https://techcrunch.com/2025/12/19/cursor-continues-acquisition-spree-with-graphite-deal/) | 2025-12-19 | 2026-10-02 | high |
| [35] | Cursor acquires Graphite (scoop) | [Axios Pro](https://www.axios.com/pro/enterprise-software-deals/2025/12/19/cursor-buys-code-review-platform-graphite) | 2025-12-19 | 2026-10-02 | high |
| [36] | SWE-PRBench detection rates | [arXiv](https://arxiv.org/abs/2603.26130) | ~2026-04 | 2026-10-02 | medium |
| [37] | HN: review-bottleneck quote | [Hacker News](https://news.ycombinator.com/item?id=47390389) | 2026-03 | 2026-10-02 | high |
| [38] | HN: generation>review rate | [Hacker News](https://news.ycombinator.com/item?id=36586248) | 2023-07 | 2026-10-02 | medium |
| [39] | HN: startup review bottleneck | [Hacker News](https://news.ycombinator.com/item?id=49182957) | 2026-08 | 2026-10-02 | high |
| [40] | HN: rubber-stamping | [Hacker News](https://news.ycombinator.com/item?id=49421554) | 2026-08 | 2026-10-02 | high |
| [41] | HN: stateful locking layer | [Hacker News](https://news.ycombinator.com/item?id=47866750) | 2026-04 | 2026-10-02 | high |
| [42] | HN: visibility gap | [Hacker News](https://news.ycombinator.com/item?id=47412156) | 2026-03 | 2026-10-02 | high |
| [43] | HN: concurrent-modification question | [Hacker News](https://news.ycombinator.com/item?id=47140322) | 2026-02 | 2026-10-02 | high |
| [44] | HN: CRDT speculation | [Hacker News](https://news.ycombinator.com/item?id=48791380) | 2026-07 | 2026-10-02 | medium |
| [45] | Conductor workbench | [Conductor](https://www.conductor.build/) | undated | 2026-10-02 | high |
| [46] | Conductor changelog (0.89.1) | [Conductor](https://www.conductor.build/changelog) | undated | 2026-10-02 | medium |
| [47] | Sculptor (vendor-primary verified) | [Imbue](https://imbue.com/blog/sculptor-announce) | 2025-09-26 (upd 2026-04-30) | 2026-10-02 | high (vendor) |
| [48] | Vibe Kanban repo | [GitHub](https://github.com/BloopAI/vibe-kanban) | live | 2026-10-02 | high |
| [49] | Vibe Kanban shutdown | [Bloop AI](https://www.vibekanban.com/blog/shutdown) | 2026-04-10 | 2026-10-02 | high |
| [50] | Superset (100+ agents; worktree per task) | [Superset](https://superset.sh/) | 2026 | 2026-10-02 | high (vendor) |
| [51] | Crystal superseded | [GitHub](https://github.com/stravu/crystal) | live | 2026-10-02 | high |
| [52] | Nimbalyst workspace | [Nimbalyst](https://nimbalyst.com/coding-agents-for-teams) | 2026 | 2026-10-02 | high |
| [53] | Terragon shutdown snapshot | [GitHub](https://github.com/terragon-labs/terragon-oss) | 2026-01-16 | 2026-10-02 | high |
| [54] | Factory Missions | [Factory AI](https://factory.ai/product/missions) | undated | 2026-10-02 | high (vendor) |
| [55] | Omnara | [Omnara](https://www.omnara.com/) | 2025–26 | 2026-10-02 | high |
| [56] | VS Code multi-agent home | [Microsoft](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) | 2026-02-05 | 2026-10-02 | high |
| [57] | Devin 2.2 | [Cognition](https://cognition.com/blog/introducing-devin-2-2) | 2026-02-24 | 2026-10-02 | high |
| [58] | GitGhost AI (lead-verified scrape) | [GitGhost](https://gitghost.ai) | 2026 (beta) | 2026-10-02 | medium (vendor; beta) |
| [59] | GitHub secret scanning (detection, not access control) | [GitHub Docs](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) | undated | 2026-10-02 | high |
| [60] | git-crypt (encryption, no revocation) | [AGWA/git-crypt](https://github.com/AGWA/git-crypt) | 2025-09-23 | 2026-10-02 | high |
| [61] | SOPS (KMS value encryption) | [getsops/sops](https://github.com/getsops/sops) | undated | 2026-10-02 | high |
| [62] | Git AI (notes-based attribution) | [git-ai-project](https://github.com/git-ai-project/git-ai) | 2026 | 2026-10-02 | high |
| [63] | Git AI Standard v3.0.0 | [git-ai-project](https://raw.githubusercontent.com/git-ai-project/git-ai/main/specs/git_ai_standard_v3.0.0.md) | undated | 2026-10-02 | high |
| [64] | Entire Checkpoints (commit trailer) | [Entire Docs](https://docs.entire.io/guides/checkpoints/inspect-in-entire-io) | undated | 2026-10-02 | high |
| [65] | gitsign (OIDC keyless signing) | [sigstore](https://github.com/sigstore/gitsign) | undated | 2026-10-02 | high |
| [66] | AgenTag (attribution unsolved) | [arXiv](https://arxiv.org/abs/2608.00966) | ~2026-08 | 2026-10-02 | medium |
| [67] | Whiteboard (cross-platform OSS; AST diff; one-branch workflow) | [/dev/fast](https://dev.fast/) | undated | 2026-10-02 | high |
| [68] | Difftastic v0.72 active | [Difftastic](https://difftastic.wilfred.me.uk/introduction.html) | 2026-08 | 2026-10-02 | high |
| [69] | diffsitter | [GitHub](https://github.com/afnanenayet/diffsitter) | undated | 2026-10-02 | high |
| [70] | SemanticDiff | [SemanticDiff](https://semanticdiff.com/github) | undated | 2026-10-02 | high |
| [71] | Unity semantic merge (asset-scoped) | [Unity Docs](https://docs.unity3d.com/6000.0/Documentation/Manual/SmartMerge.html) | undated | 2026-10-02 | medium |
| [72] | CodeSee → GitKraken | [GitKraken](https://www.gitkraken.com/press/gitkraken-acquires-codesee-launches-devex-platform) | 2024-05-14 | 2026-10-02 | high |
| [73] | Swimm repositioned | [Swimm](https://www.swimm.io/) | undated | 2026-10-02 | high |
| [74] | tldraw canvas | [tldraw](https://tldraw.dev/blog/make-real-the-story-so-far) | ~2023 | 2026-10-02 | high |
| [75] | React Flow | [xyflow](https://reactflow.dev/) | undated | 2026-10-02 | high |
| [76] | Figma code + canvas | [Figma](https://www.figma.com/blog/the-future-of-design-is-code-and-canvas/) | 2026-02-17 | 2026-10-02 | high |
| [77] | Figma MCP write-to-canvas | [Figma Developers](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas) | undated | 2026-10-02 | high |
| [78] | Verification record; candidate surfaces checked; absence bounding | this run | 2026-10-02 | 2026-10-02 | high |

## Staleness map

Computed with `recon_kit.py staleness` from the claims ledger (windows: capability/pricing 3 mo, trajectory 6 mo, sentiment 12 mo). **Earliest recheck: 2025-12-01 (already due).**

| Claim | Class | Source pub | Recheck |
|---|---|---|---|
| GitHub concurrent sessions/Agents review (refreshed via 2026 changelog scan) | capability | 2025-10 | 2026-01-01 ⚠ |
| Set-level review absence un-falsified | capability | 2026-10 | 2027-01-01 |
| Entire platform unshipped | capability | 2026-09 | 2026-12-01 |
| Macroscope Murmur (vendor-primary) | capability | 2026-09 | 2026-12-01 |
| Sculptor capabilities (vendor-primary) | capability | 2025-09 | 2025-12-01 ⚠ |
| Whiteboard cross-platform OSS | capability | 2026-10 | 2027-01-01 |
| GitLab Duo Agent Platform GA | capability | 2026-01 | 2026-04-01 ⚠ |
| CodeRabbit pricing | pricing | 2026-10 | 2027-01-01 |
| Greptile pricing | pricing | 2026-10 | 2027-01-01 |
| Vibe Kanban shutdown | trajectory | 2026-04 | 2026-10-01 ⚠ |
| Terragon shutdown | trajectory | 2026-01 | 2026-07-01 ⚠ |
| Cursor/Graphite acquisition | trajectory | 2025-12 | 2026-06-01 ⚠ |
| HN review-bottleneck sentiment | sentiment | 2026-08 | 2027-08-01 |

> Notes: (1) The GitHub finding's *base* source is 2025-10, but it was refreshed against the 2026 changelog during this run — its substance is current; the flag is mechanical. (2) Shutdowns are terminal facts; re-checks target adjacent claims (category economics). (3) Refresh/Deepen on this folder handles all of the above re-checks.
