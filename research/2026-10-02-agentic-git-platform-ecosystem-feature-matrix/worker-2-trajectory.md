# Trajectory Report: Worker 2 (Areas 3 & 4)

Scope: **Area 3 — Autonomous Coding Agents** (Devin, OpenAI Codex cloud, Google Jules, Factory, Sourcegraph Amp, Zencoder, Sweep, OpenHands, Aider, Claude Code, Cursor background agents, Replit Agent) and **Area 4 — Git Hosting & Forge Ecosystem** (GitHub, GitLab, Bitbucket, Gitea, Forgejo, Codeberg, Sourcehut, Tangled, Radicle). Read-only; one file written.

---

## 1. Solution Planning

**Decomposition.** Area 3 by archetype: cloud/VM async agents (Devin, Codex cloud, Jules, Factory, Replit); terminal/editor agents (Claude Code, Cursor, Amp, Aider, OpenHands); repositioned players (Sweep, Zencoder); orchestration workspaces (Superset, Agent Orchestrator, Parallel Code) that emerged from the "many agents on one repo" question. Area 4 by centralization: centralized majors (GitHub, GitLab, Bitbucket), self-hosted open forges (Gitea, Forgejo, Codeberg, Sourcehut), decentralized challengers (Tangled, Radicle).

**Strategy.** Lead Area 3 with primary/quantitative evidence — an arXiv study on concurrent agentic PRs found in cycle 1 anchored the area — then triangulate each vendor's pricing/limits page against 2+ secondary comparisons. For Area 4, use vendor docs/press for features and pricing and independent news (InfoQ, developer-tech) for policy/sentiment. Vendor marketing is labeled as claims.

**Expected vs actual.** Official docs (GitHub agent management, GitLab Duo Agent Platform, Jules limits, Amp pricing) were less marketing-heavy than expected and stated concurrency limits explicitly — the highest-value sources. Pivot: "Sweep" is two products (ex-GitHub issue-to-PR bot now JetBrains-only; unrelated Salesforce doc agent at sweep.io) — disambiguated, not dropped. Failure: `firecrawl_scrape` on sourcegraph.com hit anti-bot; recovered via snippets + Business Wire mirrors.

---

## 2. Methods & Pivots

| Cycle | Query | Tool | Results | Scraped | Pivot Reason |
|---|---|---|---|---|---|
| 1 | autonomous coding agents comparison 2026 … SWE-bench | search | sdd.sh, arXiv 2604.00917 | No | 400 on `sources`/`highlights` → arg-minimal retry |
| 2 | GitHub Agent HQ mission control 2026 | search | Agent HQ blog, docs, guide | No | GitHub = Area 4 anchor |
| 3–5 | Devin/Jules/Factory/Amp; OpenHands/Aider/Sweep/Zencoder; Claude/Cursor/Replit/Codex | search ×12 | Devin plans, Jules limits, OpenHands "one to thousands", Sweep pivot, Cursor 3.2, Replit 10-parallel | No | Vendors publish concurrency; Sweep ambiguous → pivot to docs/multi-agent |
| 6 | "multiple agents" same repo merge conflicts | search | **arXiv 2607.04697**, Superset, Agent Orchestrator | No | Paper decisive → scrape first |
| 7 | GitLab Duo / Tangled / Radicle | search ×4 | GitLab 19.4, Duo docs, Tangled, Radicle | Partly | Area 4 lead-in |
| 8 | Bitbucket / Forgejo-Gitea / Codeberg / Sourcehut | search ×4 | Rovo pricing, ForgeFed, Codeberg vote, "No AI" | No | AI-policy contrast found |
| 9–11 | Scrape batches A–C | scrape ×12 | arXiv study, Agent HQ, Superset, Tangled, Jules limits, Cognition plans, Cursor 3.2, GitLab Duo, Amp pricing, sdd.sh, GitHub agent docs | Yes | Core evidence + matrix cells |
| 12 | Copilot pricing / GitLab credits / Codeberg / Radicle | search ×4 | Copilot plans, $12/$24 credits, ban, vuln | No | Pricing + trust |
| 13 | SWE-bench / triage crisis / Batch Changes / AGENTS.md | search ×4 | Leaderboards, thenewstack, outcome pricing, agents.md | No | Benchmarks + need |
| 14 | Scrape batch D | scrape ×4 | thenewstack, InfoQ, OpenHands, mission-control | Yes (1×403) | sourcegraph.com anti-bot |
| 15 | Gitea / Universe 2026 / forge federation | search ×3 | Gitea pricing, Universe, Forgejo FAQ | No | Gap closure |
| 16 | Scrape batch E | scrape ×4 | OpenHands, GitHub guide, GitLab GA, Codeberg vote | Yes | Last pass |

13 search rounds, 5 scrape batches (18 OK, 1 blocked).

---

## 3. Evidence Collection

### Area 3 — Autonomous Coding Agents

**A3-1. Concurrency is normal and agents are mutually blind.** *Rationale:* core market need. *Evidence:* "79.4% of all pull requests submitted by agents (26691 of 33596) are open concurrently with another pull request authored by another agent… 40.2% of all repositories"; "textual conflict rate for identical agent instances was 19.8%… [cross-agent] 41.7%" ([arXiv:2607.04697v2](https://arxiv.org/html/2607.04697v2), 2026-07). *Summary:* 1 in 5 same-agent pairs conflict; cross-vendor pairs double that. *Confidence:* **High** (33,596 PRs, 2,807 repos, merge-tree replay).

**A3-2. Conflicts live in source code and are often structural.** *Rationale:* tells the platform what to detect. *Evidence:* "84.4% of the files involved in conflicts are source files… dependency manifests and lockfiles (3.9%)"; "modify/delete 26.8%… add/add 15.1%" ([arXiv:2607.04697v2](https://arxiv.org/html/2607.04697v2)). *Summary:* Agents disagree over file existence, not just lines. *Confidence:* **High**.

**A3-3. Concurrency is single-vendor today.** *Rationale:* scopes the competitor set. *Evidence:* "only 2,896 of 580,913 co-active pairs represent cross-agent interactions (only 0.50%)… among only 122 of the 2,807 repositories." Co-activity: Devin 82.5%, Codex 80.9%, Copilot 76.7%, Cursor 69.8%, Claude Code 39.7% ([arXiv:2607.04697v2](https://arxiv.org/html/2607.04697v2)). *Summary:* Target many agents from *one* orchestrator on one repo. *Confidence:* **High**.

**A3-4. GitHub's concurrency design = manual partition + triage.** *Rationale:* best-documented competitor behavior. *Evidence:* "You can run multiple agent sessions concurrently… assign, steer, and track the work of multiple agents" ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/agent-management)); "Agents working in parallel can create merge conflicts if they touch the same files. Be thoughtful about partitioning work" ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/), 2025-12). *Summary:* Conflict avoidance is pushed to humans. *Confidence:* **High**.

**A3-5. Published concurrency ceilings are small.** *Rationale:* feature-matrix column. *Evidence:* Jules 15/100/300 daily tasks and **3/15/60 concurrent** ([Jules Limits](https://jules.google/docs/usage-limits)); Replit **1/2/10 parallel agents** ([AISO](https://aisotools.com/replit-pricing)), Enterprise "parallel tasks across isolated micro-VMs" ([Replit](https://replit.com/enterprise)); Cursor 3.2 `/multitask` + worktrees ([Cursor](https://cursor.com/changelog/04-24-26)). *Summary:* Peers cap at single/low-double digits. *Confidence:* **High** (docs); **Medium** for enterprise "custom".

**A3-6. Orchestration is a separate market; review is the bottleneck.** *Rationale:* validates prioritization. *Evidence:* "reliably manage 5-7 coding agents in parallel… goal… 100… **the real limit is not how many agents your tooling can run, it is how many independent, well-scoped tasks you can produce and review**" ([Superset Roadmap](https://superset.sh/blog/roadmap-to-100-agents), 2026-02; [guide](https://superset.sh/parallel-coding-agents), 2026-09). Worktree-per-task is the isolation primitive. *Summary:* Bottleneck is review. *Confidence:* **High**.

**A3-7. Outcome-based pricing has appeared.** *Rationale:* differentiation idea. *Evidence:* "you only pay for changesets that merge," across "hundreds or thousands of repositories" ([Sourcegraph](https://sourcegraph.com/blog/agentic-batch-changes-pricing), 2026-09; [Business Wire](https://www.businesswire.com/news/home/20260701185004/en/)). *Summary:* Billing on merged work is live. *Confidence:* **High** existence, **Low** rates.

**A3-8. Trust/limits recur across vendors.** *Rationale:* risk column. *Evidence:* "On Terminal-Bench 2.0, the harness delta can reach thirty to fifty percentage points" ([Codex KB](https://codex.danielvaughan.com/2026/06/14/beyond-model-chasing-benchmark-convergence-codex-cli-configuration-competitive-advantage/)); Claude Code "unusable" on limits ([dev.to](https://dev.to/sangrokjung/claude-code-vs-codex-2026-what-500-reddit-developers-really-think-31pb), 2026-03); Cursor "Not truly autonomous" ([sdd.sh](http://sdd.sh/agents), 2026-05). *Confidence:* **Medium**.

**A3-9. OpenHands is the only scale-conflict-free claim.** *Rationale:* closest prior art. *Evidence:* "Scale from one to thousands of agents"; Large Codebase SDK "allows **multiple agents to safely work in parallel without conflicts**"; "Agent Control Plane" ([OpenHands](https://www.openhands.dev/); [Business Wire](https://www.businesswire.com/news/home/20260506314667/en/), 2026-05-06). MIT core, self-hostable, $18.8M Series A. *Confidence:* **Medium** (claim unverified).

**A3-10. Sweep abandoned the agentic-PR model.** *Rationale:* avoid stale competitor. *Evidence:* "Sweep is not the GitHub issue-to-PR bot you may remember. In 2026 it is an AI assistant built exclusively for JetBrains IDEs" ([AISO](https://aisotools.com/blog/sweep-review-2026), 2026-09). *Confidence:* **High**.

### Area 4 — Git Hosting & Forge Ecosystem

**A4-1. GitHub made agents a platform primitive.** *Rationale:* main competitor. *Evidence:* Agent HQ "unites every agent on a single platform"; partners Anthropic/OpenAI/Google/Cognition/xAI; shipped mission control, branch controls, agent identity, "one-click merge conflict resolution," agentic code review, control plane, metrics ([GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/), 2025-10-28); third-party agents are **GitHub Apps** ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/agent-management)). *Summary:* Moat = ecosystem + governance. *Confidence:* **High**.

**A4-2. GitHub's multi-agent UX is instruction-only.** *Rationale:* identifies the whitespace. *Evidence:* "specific prompts… custom agents in agents.md… early steering when session logs show drift… batching reviews" ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/), 2025-12). *Confidence:* **High**.

**A4-3. GitLab GA'd flows + native conflict resolution.** *Rationale:* strongest competing feature set. *Evidence:* Duo Agent Platform GA with Agentic Chat, Planner/Security/Data Analyst agents, custom agents (AI Catalog), external agents (Claude Code, Codex CLI), flows incl. issue→MR, code review, Fix CI/CD, SAST, and "Resolve merge conflicts… autonomously analyze merge conflicts, edit conflicting files, and push a resolution commit" ([GitLab Docs](https://docs.gitlab.com/user/duo_agent_platform/); [GitLab IR](https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-the-General-Availability-of-GitLab-Duo-Agent-Platform), 2026-01-15); credits "$12 and $24… per user" for Premium/Ultimate ([GitLab IR](https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-the-General-Availability-of-GitLab-Duo-Agent-Platform)). *Confidence:* **High**.

**A4-4. Bitbucket couples agents to Atlassian context.** *Rationale:* feature matrix. *Evidence:* "Rovo Dev is a context-aware AI agent… planning, coding, reviews"; AI review; agentic CI/CD; Teamwork Graph ([Atlassian](https://www.atlassian.com/software/bitbucket/features/ai)); Rovo Dev "**$20 per developer/month… 2,000 Rovo Dev credits**" ([Atlassian](https://www.atlassian.com/software/rovo-dev/pricing)); Bitbucket Standard $3.65/user, Free ≤5 ([Bitbucket](https://bitbucket.org/product/pricing)). *Confidence:* **Medium**.

**A4-5. Open forges split on AI: adoption vs. refusal.** *Rationale:* opt-out design requirement. *Evidence:* Forgejo implements "forge federation using ForgeFed… an extension of ActivityPub," JWT federated Actions identities in v15 ([Forgejo FAQ](https://forgejo.org/faq/); [report](https://forgejo.org/2026-05-monthly-report)). Codeberg members voted **358–144 (14 abstentions)** to restrict "vibe-coded" projects and reject LLM training on hosted data ([developer-tech](https://www.developer-tech.com/news/codeberg-members-vote-reject-llm-training-vibe-coding/), 2026-07-24). Sourcehut: "**No AI features whatsoever**" ([sourcehut.org](https://sourcehut.org/), 2026-08-27). *Confidence:* **High**.

**A4-6. Decentralized challengers: patterns yes, trust not yet.** *Rationale:* assess borrowable patterns. *Evidence:* Tangled (ATProto) has "knots" (headless Git hosts), "spindles" (MicroVM CI), appview, seven XRPC webhook methods, stacked PRs; "€3.8M seed… 7,000+ users" ([Tangled docs](https://docs.tangled.org/git), 2025-12-21; [Antler](https://www.antler.co/blog/why-we-invested-in-tangled)). Radicle is "peer-to-peer… no single entity controlling the network" ([GitHub](https://github.com/radicle-dev)) but disclosed "two critical security vulnerabilities in its core wire protocol" — cleartext private repos + node impersonation — fix requires Iroh (QUIC/TLS) with a backward-compat break ([InfoQ](https://www.infoq.com/news/2026/09/radicle-network-vulnerabilities), 2026-09-28). *Summary:* Borrow Tangled's split; avoid Radicle's unversioned protocol. *Confidence:* **High** facts, **Medium** viability.

**A4-7. Scale favors a complementary layer — with a quality crisis attached.** *Rationale:* market sizing. *Evidence:* "180 million developers," "80% of new developers are using Copilot in their first week" ([GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/)); Gartner: "**by 2028, more than 70% of enterprise software engineers will rely on AI coding agents**" ([GitHub whitepaper](https://github.com/resources/whitepapers/gartner-magic-quadrant-for-enterprise-ai-coding-agents), 2026-05-22). Against: "PRs from AI coding agents jumped from **four million in September 2025 to seventeen million by March 2026**… only **one in ten** … is legitimate" ([Codex KB](https://codex.danielvaughan.com/2026/06/11/codex-cli-open-source-maintainers-automated-triage-pr-review-release-notes-workflows/), 2026-06). *Confidence:* **Medium** (vendor/analyst/secondary).

**A4-8. Review/validation is the consensus pain point.** *Rationale:* prioritization weight. *Evidence:* "code generation dramatically cheaper and faster… review, validation, and integration… have not gotten any faster"; "Sixty percent of unpaid volunteer maintainers already struggle to keep up"; Agoda: experienced devs "19 percent slower" ([The New Stack](https://thenewstack.io/ai-generated-code-crisis/), 2026-04-09). GitLab's "**AI paradox**" — "only about 20% of a developer's time is spent writing code" ([GitLab IR](https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-the-General-Availability-of-GitLab-Duo-Agent-Platform)). GitHub: "**'LGTM' doesn't always mean the code is healthy**" ([GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/)). *Confidence:* **High**.

**A4-9. A portable agent-instruction file already exists.** *Rationale:* reuse, don't reinvent. *Evidence:* AGENTS.md is "a simple, open format for guiding coding agents," from "OpenAI Codex, Amp, Jules… Cursor, and Factory" ([agents.md](https://agents.md/)); one tracker says "~60,000+ GitHub repos" ([agent-notes](https://github.com/genno-whittlery/agent-notes/blob/main/2026-agents-md-standard.md)); another indexes 1,538 files / 442 repos (58.1%) ([RuleStack](https://rulestack.kynth.studio/format/agents-md), 2026-08-22). *Confidence:* **Medium** (adoption counts third-party).

**A4-10. Extensibility surfaces are generous.** *Rationale:* integration feasibility. *Evidence:* GitHub REST/GraphQL + Apps + webhooks + MCP Registry ([GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/)); GitLab MCP clients/servers + custom agents/flows ([GitLab 19.4](https://ir.gitlab.com/news/news-details/2026/GitLab-19-4-Brings-New-Agentic-Automation-at-a-Lower-Cost/default.aspx), 2026-09-17; [Duo docs](https://docs.gitlab.com/user/duo_agent_platform/)); Tangled XRPC webhooks ([tangled.org/core](https://tangled.org/tangled.org/core)). *Confidence:* **High**.

---

## 4. Synthesis & Confidence

### Area 3

The market has crossed a threshold that makes the competition premise necessary. A merge-replay study over 33,596 agentic PRs shows concurrency is already default (79.4% of agent PRs overlap another; 95% within ±7 days) and integration is failing: 19.8% of same-agent co-active pairs conflict textually, 41.7% cross-agent, 42% of collisions structural (add/add, modify/delete). Its framing — agents "do not have even the most basic level of horizontal awareness" — names the gap a Workers + Artifacts platform could own.

Every major vendor shipped *surfaces* for parallel agents without *coordination*: GitHub mission control (with a manual-partition warning), Cursor `/multitask` + worktrees, Jules 3/15/60, Replit 1/2/10, Devin's multi-repo "fleet." Only OpenHands claims conflict-free parallel agents (Large Codebase SDK + Agent Control Plane) — unverified. Orchestration workspaces (Superset et al.) converge on **worktree-per-task** and all hit the same wall: review bandwidth, not compute — matching thenewstack's finding that generation is cheap and validation is not.

Benchmarks and pricing are weaker signals. Comparison tables put Claude Code (Opus 4.7) at 87.6% SWE-bench Verified and Codex at 82.7% Terminal-Bench 2.0 ([sdd.sh](http://sdd.sh/agents)); aggregators put Claude 4.5 Opus at 79.2% and note near-saturation; several vendors publish nothing; harness alone swings Terminal-Bench 30–50 pts. Pricing converges on **usage credits** — Devin ($20/$200/$80-min), Amp (free/$20 + BYOC + orbs), Zencoder ($40–45 + 30k credits), Replit ($20/$100), Copilot (Free/$10/$39 + usage-based agent billing from 2026-06). Sourcegraph's per-merged-changeset pricing is the outlier worth copying.

### Area 4

The centralized forges are converging on one architecture — agent control plane, governed identities, first-pass AI review, metrics — differing in ecosystem and coupling. GitHub Agent HQ is the most open and thus the best platform to build on, but its multi-agent experience is deliberately manual. GitLab is the most opinionated, shipping a native "resolve merge conflicts and push a resolution commit" action and credit pricing ($12/$24 per user/month). Bitbucket leans on Atlassian graph. All three leave the review/merge UX gap open: GitHub admitted LGTM ≠ healthy and shipped Code Quality; GitLab names the AI paradox; thenewstack documents a 4M→17M PR flood at ~1-in-10 legitimacy. That is the whitespace.

Self-hosted/decentralized forges offer patterns, not competition. Forgejo builds ForgeFed/ActivityPub federation and federated CI identities; Gitea sells an Enterprise edition on an MIT base. Codeberg and Sourcehut represent a values segment that **rejects** AI (358–144 vote; "No AI features whatsoever") — so opt-out repositories must be first-class. Tangled is the most architecturally interesting decentralized model (identity = ATProto, hosting = knots, CI = spindles, documented webhook API) and the one pattern worth borrowing. Radicle is a cautionary tale: a P2P forge shipped critical plaintext-transport and node-impersonation flaws, requiring a breaking migration to Iroh. Decentralization does not by itself buy trust.

### Conclusions

1. **Concurrency is ubiquitous and uncoordinated; conflict-aware placement is an unfilled need.** High; corroboration 3+.
2. **Human review/validation, not model capability or compute, is the binding constraint.** High; corroboration 4.
3. **No shipping product coordinates *many* agents on *one* repo with automatic conflict avoidance.** Medium; 5 docs + 1 unverified claim.
4. **GitHub Agent HQ is the best integration target and best-documented competitor; its multi-agent UX is instruction-only.** High; corroboration 4.
5. **Outcome-based (per-merged-changeset) pricing is a live differentiator.** Medium; corroboration 2.
6. **Benchmarks are not a durable differentiator; harness and usage limits dominate.** Medium; corroboration 3.
7. **A significant organized segment of the forge ecosystem rejects AI; opt-out must be designed in.** High; corroboration 3.
8. **AGENTS.md is the de facto cross-vendor agent-instruction format.** Medium; corroboration 3.
9. **Decentralized forges offer useful patterns (Tangled) but not proven trust (Radicle).** High (Radicle vuln) / Medium (Tangled).
10. **Worktree/sandbox-per-agent is the established isolation primitive; Artifacts should make it cheap and server-side.** High; corroboration 4.

### What to borrow for a multi-agent-concurrency platform on Cloudflare Workers + Artifacts

- **Make conflict-awareness a first-class artifact, not a prompt.** Maintain a live per-repo "change map" (files/symbols each agent intends to touch) at dispatch and push; serialize overlapping agents and warn on structural collisions (42% of observed conflicts) via the Artifacts API so any harness can query before editing.
- **Adopt worktree/sandbox-per-agent with server-side isolation** (Workers + Artifacts + ephemeral compute per branch) so isolation is a platform guarantee, and pair each agent with a durable session record (plan → diffs → logs → checks) so context survives handoffs.
- **Design review as the product, not a page:** prepared briefing, evidence of tests run, conflict map, batch decisions, outcome-based accounting billed per *merged* changeset (mirroring Sourcegraph), plus an explicit AI-restricted repository mode for the Codeberg/Sourcehut segment.

---

## 5. Sources Consulted

| # | Title | URL | Type | Date | Scraped? | Tier |
|---|---|---|---|---|---|---|
| 1 | AI Agent PRs on GitHub (arXiv:2607.04697v2) | https://arxiv.org/html/2607.04697v2 | Paper | 2026-07 | Yes | 92 |
| 2 | GitHub — Agent HQ | https://github.blog/news-insights/company-news/welcome-home-agents/ | Official | 2025-10 | Yes | 78 |
| 3 | GitHub Docs — agent management | https://docs.github.com/en/copilot/concepts/agents/coding-agent/agent-management | Docs | current | Yes | 85 |
| 4 | GitHub — mission control guide | https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/ | Official | 2025-12 | Yes | 78 |
| 5 | Superset — Parallel Coding Agents | https://superset.sh/parallel-coding-agents | Vendor | 2026-09 | Yes | 55 |
| 6 | Superset — Roadmap to 100 Agents | https://superset.sh/blog/roadmap-to-100-agents | Vendor | 2026-02 | Yes | 55 |
| 7 | Jules — Limits and Plans | https://jules.google/docs/usage-limits | Docs | current | Yes | 88 |
| 8 | Cognition — Devin plans | https://cognition.com/blog/new-self-serve-plans-for-devin | Vendor | 2026-04 | Yes | 72 |
| 9 | Cursor — 3.2 changelog | https://cursor.com/changelog/04-24-26 | Changelog | 2026-04 | Yes | 85 |
| 10 | GitLab — Duo Agent Platform | https://docs.gitlab.com/user/duo_agent_platform/ | Docs | current | Yes | 85 |
| 11 | GitLab IR — Duo GA | https://ir.gitlab.com/news/news-details/2026/GitLab-Announces-the-General-Availability-of-GitLab-Duo-Agent-Platform | Press | 2026-01 | Yes | 82 |
| 12 | GitLab IR — 19.4 | https://ir.gitlab.com/news/news-details/2026/GitLab-19-4-Brings-New-Agentic-Automation-at-a-Lower-Cost/default.aspx | Press | 2026-09 | No | 82 |
| 13 | Amp — Pricing | https://ampcode.com/docs/pricing | Docs | 2026-09 | Yes | 80 |
| 14 | sdd.sh — agents compared | http://sdd.sh/agents | Blog | 2026-05 | Yes | 42 |
| 15 | OpenHands — Home | https://www.openhands.dev/ | Vendor | 2026 | Yes | 60 |
| 16 | OpenHands — Enterprise | https://openhands.dev/enterprise | Vendor | 2026 | No | 60 |
| 17 | Business Wire — OpenHands Control Plane | https://www.businesswire.com/news/home/20260506314667/en/ | Press | 2026-05 | No | 65 |
| 18 | Tangled — docs | https://docs.tangled.org/git | Docs | 2025-12 | Yes | 72 |
| 19 | The New Stack — AI PR crisis | https://thenewstack.io/ai-generated-code-crisis/ | Analysis | 2026-04 | Yes | 55 |
| 20 | InfoQ — Radicle vulns | https://www.infoq.com/news/2026/09/radicle-network-vulnerabilities | News | 2026-09 | Yes | 68 |
| 21 | developer-tech — Codeberg LLM vote | https://www.developer-tech.com/news/codeberg-members-vote-reject-llm-training-vibe-coding/ | News | 2026-07 | Yes | 55 |
| 22 | GitHub — Copilot plans | https://github.com/features/copilot/plans | Official | 2026 | Yes | 80 |
| 23 | GitHub — Copilot billing changes | https://github.blog/changelog/2026-08-28-upcoming-changes-to-github-copilot-policies-and-billing | Changelog | 2026-08 | No | 78 |
| 24 | GitHub — AI credit session limits | https://github.blog/changelog/2026-07-01-set-ai-credit-session-limits-in-copilot-cli-and-sdk | Changelog | 2026-07 | No | 78 |
| 25 | GitHub — Gartner MQ | https://github.com/resources/whitepapers/gartner-magic-quadrant-for-enterprise-ai-coding-agents | Whitepaper | 2026-05 | No | 70 |
| 26 | Atlassian — AI & Bitbucket | https://www.atlassian.com/software/bitbucket/features/ai | Vendor | 2026 | No | 72 |
| 27 | Atlassian — Rovo Dev pricing | https://www.atlassian.com/software/rovo-dev/pricing | Pricing | 2026 | No | 72 |
| 28 | Bitbucket — Pricing | https://bitbucket.org/product/pricing | Pricing | 2026 | No | 72 |
| 29 | Gitea — Pricing | https://about.gitea.com/pricing/ | Pricing | 2026 | No | 70 |
| 30 | Gitea Enterprise | https://about.gitea.com/products/gitea-enterprise | Vendor | 2026 | No | 70 |
| 31 | Forgejo — FAQ | https://forgejo.org/faq/ | Docs | 2026 | No | 75 |
| 32 | Forgejo — May 2026 report | https://forgejo.org/2026-05-monthly-report | Release notes | 2026-06 | No | 78 |
| 33 | Sourcehut — Home/TOS | https://sourcehut.org/ ; https://sourcehut.org/blog/2026-08-27-tos-changes-and-llms | Official | 2026-08 | No | 75 |
| 34 | Sourcehut — Pricing | https://sourcehut.org/pricing | Pricing | 2026 | No | 75 |
| 35 | Tangled — Home | https://tangled.org/ | Vendor | 2026 | No | 60 |
| 36 | Tangled core repo | https://tangled.org/tangled.org/core | Source | 2026 | No | 68 |
| 37 | Antler — Tangled investment | https://www.antler.co/blog/why-we-invested-in-tangled | VC | 2026 | No | 45 |
| 38 | radicle.dev — disclosure | https://radicle.dev/2026/09/23/disclosure-of-vulnerability-in-network-protocol | Disclosure | 2026-09 | No | 85 |
| 39 | Radicle — GitHub org | https://github.com/radicle-dev | Profile | 2026 | No | 68 |
| 40 | Sourcegraph — outcome pricing | https://sourcegraph.com/blog/agentic-batch-changes-pricing | Vendor | 2026-09 | No (403) | 55 |
| 41 | Business Wire — Sourcegraph GA | https://www.businesswire.com/news/home/20260701185004/en/ | Press | 2026-06 | No | 65 |
| 42 | Factory — Enterprise | https://factory.ai/enterprise | Vendor | 2026 | No | 70 |
| 43 | Factory 2.0 | https://factory.com/news/software-factory | Vendor | 2026-06 | No | 72 |
| 44 | Factory — Series C | https://factory.ai/news/series-c | Vendor | 2026-04 | No | 70 |
| 45 | Factory — Docs | https://docs.factory.ai/ | Docs | 2026 | No | 78 |
| 46 | Zencoder — Pricing | https://zencoder.ai/pricing | Pricing | 2026 | No | 70 |
| 47 | Zencoder — Universal AI Platform | https://zencoder.ai/product/universal-ai-platform | Vendor | 2026 | No | 68 |
| 48 | AISO — Sweep Review 2026 | https://aisotools.com/blog/sweep-review-2026 | Review | 2026-09 | No | 40 |
| 49 | Aider — GitHub repo | https://github.com/aider-ai/aider | Source | 2026 | No | 70 |
| 50 | Claude — Subagents | https://claude.com/blog/subagents-in-claude-code | Official | 2026 | No | 75 |
| 51 | Claude Code — best practices | https://www.anthropic.com/engineering/claude-code-best-practices | Docs | 2026 | No | 80 |
| 52 | Replit — Enterprise | https://replit.com/enterprise | Vendor | 2026 | No | 70 |
| 53 | Replit — Pricing | https://replit.com/pricing | Pricing | 2026 | No | 70 |
| 54 | AISO — Replit pricing | https://aisotools.com/replit-pricing | Review | 2026 | No | 40 |
| 55 | Agent Orchestrator — docs | https://orchestrator.inc/llms.txt ; https://docs.orchestrator.inc/ | Docs | 2026 | No | 50 |
| 56 | Parallel Code | https://parallelcode.app/ | Vendor | 2026 | No | 40 |
| 57 | nimblegate — parallel overlap | https://nimblegate.com/blog/parallel-ai-coding-agents | Blog | 2026 | No | 35 |
| 58 | Codex KB — maintainer triage | https://codex.danielvaughan.com/2026/06/11/codex-cli-open-source-maintainers-automated-triage-pr-review-release-notes-workflows/ | Blog | 2026-06 | No | 40 |
| 59 | agents.md | https://agents.md/ | Standard | 2026 | No | 75 |
| 60 | RuleStack — AGENTS.md stats | https://rulestack.kynth.studio/format/agents-md | Tracker | 2026-08 | No | 35 |
| 61 | Axis Intelligence — GitHub stats | https://axis-intelligence.com/github-statistics | Aggregator | 2026 | No | 40 |
| 62 | GitHub Universe 2026 | https://githubuniverse.com/ | Official | 2026-10 | No | 72 |
| 63 | Octoverse 2025 | https://octoverse.github.com/ | Report | 2025-10 | No | 85 |
| 64 | TechTarget — Agent HQ | https://www.techtarget.com/it-infrastructure/news/366633584/ | News | 2025-10 | No | 60 |
| 65 | InfoQ/Agoda — comprehension debt | https://www.infoq.com/news/2026/03/agoda-ai-code-bottleneck/ | News | 2026-03 | No | 62 |
| 66 | Armin Ronacher — Codeberg Divides | https://lucumr.pocoo.org/2026/7/24/codeberg-divides/ | Blog | 2026-07 | No | 40 |
| 67 | Hackaday — Codeberg bans | https://hackaday.com/2026/07/24/codeberg-bans-cryptocurrency-and-llm-generated-code-projects/ | News | 2026-07 | No | 45 |
| 68 | DevToolLab — background agents | https://devtoollab.com/blog/best-background-coding-agents | Blog | 2026-08 | No | 35 |
| 69 | dev.to — Claude vs Codex survey | https://dev.to/sangrokjung/claude-code-vs-codex-2026-what-500-reddit-developers-really-think-31pb | Survey | 2026-03 | No | 35 |
| 70 | llm-tier — Devin vs Jules | https://www.llm-tier.com/compare/devin-vs-jules | Benchmark | 2026 | No | 35 |
| 71 | Metatext — SWE-bench leaderboard | https://www.metatext.io/benchmarks/swe-bench-verified | Leaderboard | 2026-09 | No | 40 |
| 72 | CodeSOTA — SWE-bench | https://www.codesota.com/browse/agentic/swe-bench | Leaderboard | 2026 | No | 40 |
| 73 | ForgeFed — spec | https://forgefed.org/ ; https://github.com/forgefed/forgefed | Spec | 2026 | No | 65 |
| 74 | Gentoo on Codeberg | https://www.gentoo.org/news/2026/02/16/codeberg.html | Project news | 2026-02 | No | 65 |
| 75 | Linux Journal — Debian AI triage | https://www.linuxjournal.com/content/debian-experiments-ai-assisted-bug-triage | News | 2026-05 | No | 45 |

---

## 6. Gaps, Uncertainties & Inaccessible Sources

- **Blocked scrape.** sourcegraph.com returned anti-bot; Sourcegraph facts rest on snippets + Business Wire mirrors. Copilot-plans and thenewstack pages scraped but truncated; key passages recovered from head/tail.
- **Unverified vendor claims (labeled as claims):** OpenHands conflict-free parallel agents; Sourcegraph changeset rates; Factory ROI stats; Zencoder "2000+ integrations"; GitHub "180M devs"/"80% Copilot adoption"; "~60,000 repos use AGENTS.md"; Claude Code "up to 15 parallel subagents" (sdd.sh only).
- **Benchmark ambiguity.** SWE-bench Verified near-saturated; aggregators disagree (79.2% vs 87.6% for comparable Claude models); several vendors publish nothing; harness can swing Terminal-Bench 30–50 pts.
- **Pricing volatility.** Devin retired Core/Team (2026-04); GitHub moved to usage-based agent billing (2026-06) and upfront seat charges (2026-10-01). Figures are point-in-time.
- **Radicle.** Iroh migration announced; no shipped release locatable as of 2026-10-02.
- **No product doing conflict-aware many-agents-on-one-repo found** after 13 search rounds — treated as evidence of absence, Medium confidence.
- **Forge market-share** for Gitea/Forgejo/Codeberg/Tangled unpublished; only qualitative signals found.

## 7. Tool Quick-Reference

| Tool | Category | Standout/unique features | Pricing (entry→enterprise) | Target segment | Notable stack/architecture (if found) | Source refs |
|---|---|---|---|---|---|---|
| **Devin** (Cognition) | Cloud autonomous agent | "Fleet of agents to migrate all repos in parallel"; Devin Review; DeepWiki; ACU ≈ 15 min work | Free → $20 Pro → $200 Max → Teams $80 min → Enterprise custom | Enterprise, migrations, long-horizon | Cloud VM; event-driven workflows; owns Windsurf→Devin Desktop | 8, 42 |
| **OpenAI Codex (cloud)** | Cloud + CLI + IDE agent | GPT-5.x-Codex; parallel cloud tasks; 90+ MCP plugins (claim); subagent delegation; OS-native sandbox | Bundled in ChatGPT ($0 entry) / API $1.75/$14 per M | Broad | Cloud sandbox + CLI; Code review | 5, 19, 23 |
| **Google Jules** | Cloud async agent | **Concurrency 3/15/60**; 15/100/300 tasks/day; REST API (alpha); GitHub App | Free → AI Pro $19.99 → AI Ultra $99.99+ | Individual devs, PR async | Gemini; GitHub PR workflow; jules.googleapis.com | 7 |
| **Factory (Droids)** | Agent platform | Subagents, Missions, Droid Computers, Connectors, Skills, Hooks; "Agent Readiness" | ~$20–$200/mo → Enterprise custom (air-gapped) | Enterprise SDLC | Model-agnostic harness; CLI/desktop/web/IDE (ACP); $5B val., $420M raised | 42, 43, 45 |
| **Sourcegraph Amp** | Terminal/editor agent + orchestrator | BYO-key at-cost; "orbs" (per-minute, auto-pause); **outcome pricing per merged changeset** | Hobby free → $20 → Gigawatt → Teams $0 → Enterprise custom | Enterprise "big code" | Multi-model routing; MCP; own runners; Batch Changes | 13, 40, 41 |
| **Zencoder** | Agent platform / IDE plugin | Zen Agents (bug/dep fixes via CI/CD); Zenflow Work; air-gapped; BYOK | Trial → $45/mo ($40 annual) + credits → Enterprise | Teams consolidating tooling | VS Code/JetBrains plugin; any CLI; per-seat credits | 46, 47 |
| **Sweep** (sweep.dev) | IDE assistant (ex issue-to-PR bot) | **Pivoted**: no longer GitHub issue-to-PR; JetBrains-only; next-edit autocomplete | Free trial → ~$10 → $120 Pro → Enterprise | JetBrains devs | JetBrains plugin; API credits | 48 |
| **OpenHands** | Open-source agent platform | "**one to thousands of agents**"; Large Codebase SDK claims **conflict-free parallel agents**; Agent Control Plane; MIT core | Free OSS → $20 Pro (at-cost LLM) → Enterprise/self-hosted VPC | Platform teams, enterprise, legacy codebases | Agent Canvas + CLI + Cloud; ACP; MCP; automations | 15, 16, 17 |
| **Aider** | OSS terminal pair programmer | Model-agnostic; auto-commit every change; repo map; **single agent only** | Free (BYO key) | Individual devs, OSS | Python, Apache-2.0, 49k stars; git-first | 49 |
| **Claude Code** | Terminal agent | Subagents (isolated contexts); parallel sessions; Agent Teams (≤15 subagents, claim); MCP | No free → Max $100/$200; API | Power devs, autonomy | Terminal-native; Agent SDK; hooks/skills/subagents | 50, 51 |
| **Cursor (background agents)** | IDE + async agents | Cursor 3 Agents Window; `/multitask`; worktrees + multi-root; cloud agents; Bugbot | Free → $20 Pro → $60 Pro+ → Ultra → $40/user Teams | Editor-centric teams | VS Code fork; Composer 2; cloud agents GA | 9, 14 |
| **Replit Agent** | Browser IDE + app builder | Agent 4 parallel tasks "across isolated micro-VMs"; **1/2/10 parallel agents** | Free → $20 Core → $100 Pro → Enterprise | Non-devs, MVPs | Browser workspace; per-task micro-VMs; credits | 52, 53, 54 |
| **Orchestration workspaces** (Superset, Agent Orchestrator, Parallel Code) | Multi-agent orchestration layer | Worktree-per-task; fleet dashboard; port handling; persistent sessions; MCP | Free OSS → commercial | Devs running many agents daily | git worktree isolation; any CLI agent; overlap webhooks | 5, 6, 55, 56, 57 |
| **GitHub** | Centralized forge + agent platform | Agent HQ; mission control (multi-repo); agent identity; **one-click merge conflict resolution**; agentic review; Code Quality; control plane; metrics; agent apps (GitHub Apps); MCP Registry | Free → Copilot Pro $10 → Pro+ $39 → Max → Business/Enterprise (usage-based from 2026-06) | Everyone; enterprise governance | REST/GraphQL + Apps + webhooks + MCP; Actions; 180M devs | 2, 3, 4, 22, 25 |
| **GitLab** | Centralized forge + agent platform | Duo Agent Platform GA; Agentic Chat; Planner/Security agents; custom agents (AI Catalog); external agents (Claude Code/Codex CLI); flows incl. issue→MR, code review, Fix CI/CD, SAST, **autonomous merge-conflict resolution**; governance dashboard; MCP tools | Free → Premium $29/user → Ultimate; Duo Pro $19/user; **Credits $12/$24 per user/mo** | Enterprises, governed agentic SDLC | Self-managed/Dedicated/self-hosted models; Claude Sonnet 4; LDAP/SAML | 10, 11, 12 |
| **Bitbucket** | Centralized forge (Atlassian) | Rovo Dev (planning/coding/review); AI code review; agentic CI/CD; Teamwork Graph | Free ≤5 → Standard $3.65/user → Premium; Rovo Dev **$20/dev/mo (2,000 credits)** | Jira/Atlassian shops | Atlassian platform; Rovo CLI with Claude/Codex | 26, 27, 28 |
| **Gitea** | Self-hosted open forge | MIT core; Gitea Actions, packages, projects; Enterprise adds branch-protection inheritance | OSS free → Cloud-managed → Enterprise custom | Self-hosters SMB→enterprise | Go+TS; v1.27.3 (2026-08) | 29, 30 |
| **Forgejo** | Self-hosted open forge | **ForgeFed/ActivityPub federation**; Forgejo Actions; v15 JWT federated identities; Pagure migration | Free OSS | Non-profit/community, federation | Go; self-hosted runners; federation docs | 31, 32, 74 |
| **Codeberg** | Non-profit public forge | **Member vote rejects LLM training on hosted data** + restricts "vibe-coded" projects; crawler defenses; Gentoo mirror | Free (donations) | FLOSS, AI-skeptical maintainers | Forgejo instance, Berlin, Codeberg e.V. | 21, 66, 67, 74 |
| **Sourcehut** | Minimalist forge | "No AI features whatsoever"; works without JS; no tracking; mailing-list review | $4 / $8 / $12 per month (mean-based, all features) | FOSS purists, email workflow | sr.ht; Aug 2026 TOS re LLMs | 33, 34 |
| **Tangled** | Decentralized forge (ATProto) | **knots** (headless Git hosts), **spindles** (MicroVM CI), appview; stacked PRs; XRPC webhook API | Free hosting + self-host | Decentralization-curious; 7,000+ users; €3.8M seed | AT Protocol identity; Go/TS components | 18, 35, 36, 37 |
| **Radicle** | P2P decentralized forge | Sovereign/P2P, no central entity; Heartwood (3rd-gen); delegate-based canonical branch | Free OSS + seeds | Sovereignty maximalists | Rust; Noise→**Iroh (QUIC/TLS)** migration; **critical 2026 wire-protocol vulns** | 38, 39 |
