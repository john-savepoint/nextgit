# Trajectory Report: Verification Round 1

Scope: resolve the three most decision-critical open claims for John's Cloudflare "Next-Gen Git Platform" entry. Read-only; primary sources preferred. Today = 2026-10-02.

## 1. Methods & Pivots

| # | Cycle | Method | Key outcome / pivot |
|---|-------|--------|---------------------|
| 1 | OpenHands + Liveblocks breadth | firecrawl_scrape (openhands.dev, liveblocks.io/pricing) + 2 searches | Got homepage FAQ + pricing. Pivot: the "$18.8M 2026-05" claim looked wrong; split funding vs. Agent Control Plane. |
| 2 | OpenHands primary docs | scrape product/sdk, /pricing, GitHub README; search funding + Cloud pricing | README Option 3 revealed the actual concurrency mechanism (per-conversation Docker sandboxes) and the explicit "share those files" caveat. Funding pinned to 2025-11-18 via BusinessWire. |
| 3 | Q2 breadth | 6 searches (Agent HQ, Cursor, multi-agent merge, CodeCRDT, coordination layer) | Found sigbound, clash, Superset, Sourcegraph Agentic Batch Changes, Factory Missions. Pivot: search the *named* candidates + merge drivers. |
| 4 | Q2 candidate depth | scrape Factory Missions, sigbound README, clash README; searches Devin/Kiro/CodeMender | Factory's "coordination is hard" quote and sigbound's full feature set (model conflict resolution + human parking) are the closest hits. |
| 5 | Q2 counterpoint + forges | scrape Cognition "Multi-Agents: What's Actually Working"; search Cursor Origin, Agent HQ docs | Cognition explicitly argues parallel-writer swarms don't work (writes stay single-threaded). Cursor Origin + sigbound reference it. |
| 6 | Q2 final sweep | 3 searches (Origin, Agent HQ docs, conflict-aware product) | Surfaced ataraxy-labs "weave" entity-level merge driver, CodeRabbit Triage, and the 2026 arXiv cluster (CAID/grite/AgenticFlict/merge-replay). |
| 7 | Synthesis | — | Forced synthesis; stopped searching. |

## 2. Q1 — OpenHands (highest priority)

**Verdict: OpenHands does NOT implement our premise in the strong sense. It offers orchestration + isolation + dependency-ordered *prevention* for migrations, plus governance — but no semantic merge, no locking, no shared-repo conflict detection, and no visual triage UX for reconciling many parallel proposals.** Confidence: **high** (all from primary docs/repo/pricing).

### What it actually provides for multiple concurrent agents on one repo

1. **Concurrent conversations, each in its own sandbox.** README "Option 3: With Multiple Docker Sandboxes": *"Run each new conversation in its own Docker container, with its own Agent Server and tools. This is useful for running several agents concurrently."* Crucially: *"Each container mounts its conversation's workspace and persisted state… Conversations using the same host workspace still share those files; **choose separate directories or worktrees to avoid conflicting edits**."* → **Isolation-based avoidance.** There is no shared-working-tree locking or merge engine; the docs tell the *user* to use worktrees/dirs.
2. **Sub-agent delegation (within one conversation).** Agent delegates to sub-agents that *"run independently… return consolidated results"*; `tool_concurrency_limit` enables parallel tool execution and *"parallel sub-agent delegation"* (docs.openhands.dev/sdk/guides/parallel-tool-execution, /agent-delegation). This is fan-out inside one orchestrated conversation, not independent agents contending on one repo.
3. **Large Codebase SDK = static-analysis sequencing (conflict *prevention*).** Homepage FAQ: *"With its Large Codebase SDK, it maps dependencies across the system and orchestrates changes in the correct order, allowing multiple agents to safely work in parallel without conflicts."* Whitepaper: *"By combining AI coding agents with static analysis, it maps the full dependency structure of your codebase and orchestrates migration work in the right order so agents can run in parallel **without producing conflicting changes**…"* → "Without conflicts" means **dependency-ordered orchestration avoids producing conflicting changes during legacy migrations**, not detection/merge/lock. No public mechanism doc exists beyond FAQ/whitepaper copy.
4. **Agent Control Plane (governance, not conflict handling).** May 6 2026 launch; homepage: *"centralized control over who can run agents, what they can access, where they execute, what they spend, and what they change."* RBAC/guardrails/budget — orthogonal to code-conflict coordination.

### Claim-by-claim

| Claim | Status | Evidence |
|---|---|---|
| "Scale from one to thousands of agents" | **Claim** (marketing hero copy) | Search snippet of openhands.dev hero: *"Scale from one to thousands of agents — open source, model-agnostic, and enterprise-ready."* Corroborated only by per-user concurrency, not a published fleet architecture. |
| Large Codebase SDK "without conflicts" | **Claim** (accurate as worded) | FAQ + whitepaper quotes above. |
| Agent Control Plane RBAC/guardrails/budget | **Verified** | openhands.dev/press (2026-05-06); homepage section. |
| MIT core | **Verified** | Homepage footer "MIT Core license"; pricing FAQ: *"OpenHands Open Source is a full, MIT licensed version."* |
| $18.8M Series A "2026-05" | **WRONG date** | BusinessWire (2025-11-18): *"$18.8M Series A led by Madrona, with participation from Menlo Ventures, Obvious Ventures, Fujitsu Ventures, and Alumni Ventures."* May 2026 = Agent Control Plane launch. (CBInsights: $23.8M/3 rounds total.) |

### Concurrency limits & Cloud pricing (openhands.dev/pricing, current)

- **Open Source / Local**: Free; "Max Daily Conversations: Unlimited"; 1 user.
- **Individual (SaaS)**: Free; **"Max Daily Conversations: 10"**; 1 user. (Older all-hands.dev/pricing listed a $20/mo Pro tier — legacy page, superseded.)
- **Enterprise**: Custom; **"Unlimited concurrent convos per user"**; Large Codebase SDK gated here; SAML/SSO, RBAC, VPC.
- → Paid Cloud concurrency is effectively an **Enterprise** feature; Individual caps 10/day.

## 3. Q2 — Whitespace Sweep (2025–2026)

**Premise under test**: many concurrent agents on **ONE repository** with (a) conflict detection/avoidance and (b) review/triage UX for parallel proposals.

### Candidates

| Candidate | What it actually does | Closes whitespace? |
|---|---|---|
| **sigbound** (surya-koritala, Go, Apache-2.0, ~50★, created 2026-07) | Parallel agents in worktrees; **merges the work**; model conflict resolution that **flags low-confidence cases for review**; gates merge on build/test; self-repair; file lanes; repo-owned `sigbound.policy`; **"run parking" holds sensitive paths for human `sig ack`**; `sig serve` HTTP API + UI "for reviewing conflicts and acking parked landings"; multi-machine bundles. | **Closest to premise**, ~80%. Lacks real-time multi-agent coordination/context sharing and a polished multi-proposal visual triage console. CLI/local-first. |
| **Cursor Origin** (closed beta Aug 2026) | Git forge embedded in Cursor; cloud agents in isolated VMs; "Origin" hosting + PR subscription (agent monitors CI/fixes checks). sigbound's own compare table bills Origin as the closed hosted version of parallel+merge+AI-conflict-resolution+gated+self-repair. | **Claims the space**, closed beta, Pro/Teams/Enterprise. Not one-repo-many-agents triage per se; agent-native forge. |
| **clash** (clash-sh, Rust, MIT, ~65★, 2026-02) | **Read-only conflict detection across git worktrees** using `git merge-tree`; `clash check` fires as a Claude Code pre-write hook; conflict matrix TUI; watch mode; JSON for orchestrators. | **Partially (a) only.** Detects, never resolves. No review/triage UX, no agent coordination. |
| **Superset** (superset-sh, open-source, 14.8k downloads) | Agentic IDE running 100+ CLI agents in **isolated git worktrees**, with diff review, presets, PR feedback, orchestration APIs, "Race Agents on One Task." | **Partially.** Isolation + review, but conflict handling is *avoidance by worktree isolation*; no shared-repo conflict engine. |
| **Factory Missions** | Orchestrator decomposes a project into milestones/features → fresh worker sessions; parallelizes only where coordination overhead is low; validation workers; git as source of truth. Factory states: *"The natural instinct is to run multiple agents in parallel, but coordination is hard. Agents conflict, duplicate work, and drift without structure."* | **Partially.** One-repo multi-agent with coordination, but the answer is **serialization + targeted parallelism**, not conflict-aware merge or triage of parallel proposals. |
| **GitHub Agent HQ** (public preview 2026-02-04; mission control on github.com/VS Code/Mobile/CLI) | Unified control plane to assign tasks to Copilot/Claude/Codex/Jules/Devin/Grok, **run multiple sessions concurrently**, watch/steer logs, review via PRs. Supports 3rd-party agents; per-session premium-request billing. | **Partially (b).** Review = standard PR review. No cross-agent conflict detection/avoidance beyond git; no context preservation across agents. |
| **Sourcegraph Agentic Batch Changes** (GA 2026-09-14) | One coordination agent plans/executes a change across **hundreds–thousands of repositories**; Batch Changes UI shows changeset **mergeability ("mergeable, conflicting, or blocked")**. | **No** — many *repos*, not one repo; enterprise scale migration. |
| **Cognition Devin** | Manager Devin spawns child Devins coordinated via internal MCP; Devin Review generator-verifier loop. Cognition's own doctrine: multi-agent works *"when writes stay single-threaded and the additional agents contribute intelligence rather than actions."* | **No**, deliberately opposes parallel writers. |
| **Google Jules** | Launch multiple tasks simultaneously; each runs in its own hosted VM and returns a PR; approval-gated plans. | **No** — parallel *tasks*, PR-based; no conflict coordination. |
| **Google CodeMender** (DeepMind/Gemini Enterprise Agent Platform, v0.9.0 2026-09) | Security agent: find/verify/fix vulnerabilities; uses internal critique agent + multi-agent verification. | **No** — security patching, not repo coordination. |
| **Amazon Kiro / Kiro Crew** | Spec-driven IDE/CLI + autonomous background agent opening PRs; Kiro Crew = Apache-2.0 always-on agent workspace/gateway (sessions, memory, schedules). | **No** — single-agent workspace; scheduling, not conflict-aware multi-agent merge. |
| **ataraxy-labs "weave"** (MIT, npm `@ataraxy-labs/sem`) | **Entity-level Git merge driver**: replaces line-based 3-way merge; auto-resolves false conflicts when two agents edit the *same file* differently; surfaces real contextual conflicts. | **Partially (a) at the merge layer only.** No fleet coordination/triage. |
| **CodeCRDT** (arXiv 2510.18893, Oct 2025; repo spugachev/CodeCRDT) | Research prototype: observation-driven coordination over CRDTs → **lock-free, conflict-free concurrent code generation** with strong eventual consistency. | **Research only**, small scale. |
| **CAID** — "Effective Strategies for Asynchronous SWE Agents" (arXiv 2603.21489, Jul 2026) | Branch-and-merge coordination built on SWE primitives (git worktree/commit/merge); per-agent self-verification + **self conflict resolution at commit time**; benchmarks on Commit0/PaperBench. | **Research**, closest architectural match to premise. |
| **grite** — "Before the Pull Request: Mining Multi-Agent Coordination" (arXiv 2606.19616, Jun 2026) | Server-less, git-native coordination substrate storing a signed append-only log in git; **advisory leases + shared task state** reduce duplicate/conflicting work; pre-PR coordination dataset. | **Research**, directly on premise (coordination, not merge). |
| **GitHub PRs / PR-based runners** (claude-squad, Conductor, Claude Code/Codex worktrees) | Each agent gets a worktree + PR; human merges one at a time. | **No** — the status quo the premise improves on. |
| **CodeRabbit Triage / agent-reviews / mergepilot** | Cross-repo PR triage queues, PR review-comment automation, goal→merge-ready-PR workspaces. | **Partially (b)**, but review for human/agent PRs, not concurrent-agent reconciliation. |

### Searches run
"agent coordination layer git"; "multi-agent merge conflict" 2026; "concurrent coding agents same repository"; "agent fleet code review"; "multi-agent software engineering coordination"; plus targeted queries for Agent HQ, Cursor multitask/Origin, Devin, Jules, Kiro, CodeMender, Sourcegraph, Superset, Factory, CodeCRDT, CodeCRDT follow-ups / merge-replay study.

### Verdict on whitespace
**The whitespace is real but no longer open, and it is closing fast.** Every *individual* capability now exists in shipping or prototype form: conflict **avoidance** (worktree isolation — Cursor/Superset/OpenHands; dependency sequencing — OpenHands LCS; leases — grite/CAID), conflict **detection** (clash, AgentHQ-adjacent), semantic **merge/resolution** (sigbound, weave, Cursor Origin), **review/triage** (Superset, Agent HQ, CodeRabbit, sigbound's ack UI), and **research coordination** (CodeCRDT, grite, CAID). **No single shipping product integrates all of: many concurrent agents on ONE repo + conflict-aware coordination + context preservation + visual human triage of parallel proposals.** The last genuinely open slice is a *real-time, multi-agent, single-repo coordination + triage console with preserved shared context* (the Cognition "writes stay single-threaded" critique is the sharpest evidence that this is unsolved). Confidence: **moderate-high**. The key risk to John's 50% originality score: sigbound (open, closest) and Cursor Origin (closed, well-funded) already occupy the "parallel agents + smart merge" story; differentiation must be the **visual triage/context layer**, not conflict avoidance.

## 4. Q3 — Liveblocks Free-Tier MAU

**Resolved value: Unlimited. The "100" and "10k" figures are both stale/incorrect for the current docs; the current conflicts are with *rooms*, not MAU.** Confidence: **high**.

- Official pricing page (liveblocks.io/pricing), plan comparison: **"Monthly active users — Unlimited"** for Free, Pro, Team, Enterprise.
- Official Free plan docs (liveblocks.io/docs/pricing/plans/free), "Other limits": **"Monthly active users | Unlimited"**; **"Monthly active rooms | 500 included"**; "Simultaneous connections per room | 10".
- Exact quote (free plan docs): *"| [Monthly active users](…/faqs#What-is-a-monthly-active-user) | Unlimited |"*.

**Plan/region dependence:** MAU is Unlimited on **all** plans (not plan-dependent). The Free plan's real, metered caps are: 3,000 realtime collaboration minutes, 200 comments, 3M realtime data updates, 1 GB stored, 512 MB files, 3,000 monthly anonymous connections, 3 dashboard seats, 10 projects, 500 active rooms, 10 simultaneous connections/room, 24h version history/event logs. Multi-region hosting and self-hosting are Enterprise-only. (The Free plan offers "Free monthly credits" per pricing card; the docs table does not enumerate a credit amount — treat any specific credit number as unverified.) Likely origin of the "100" figure: an older Liveblocks free-tier MAU/room cap or third-party summaries; not current.

## 5. Sources Consulted

| Source | Type | Used for | Scraped? |
|---|---|---|---|
| openhands.dev/ | vendor primary | hero, FAQ quote, MIT, Agent Control Plane | ✅ |
| openhands.dev/product/sdk | vendor primary | Large Codebase SDK FAQ | ✅ |
| openhands.dev/pricing | vendor primary | plans, concurrency limits, MIT FAQ | ✅ |
| openhands.dev/press | vendor primary | Agent Control Plane 2026-05-06, Series A date | ❌ (search snippet) |
| github.com/OpenHands/OpenHands README | repo primary | Option 3 sandboxes; share-workspace caveat | ✅ |
| docs.openhands.dev/sdk/guides/{parallel-tool-execution,agent-delegation} | vendor docs | sub-agents, tool_concurrency_limit | ❌ (search snippets; delegation page 404 on direct scrape) |
| openhands.dev/whitepapers/modernize-legacy-systems-with-ai-agents | vendor primary | LCS whitepaper quote | ❌ (search snippet) |
| businesswire.com …20251118768131 | press primary | $18.8M Series A 2025-11-18, Madrona et al. | ❌ (search snippet) |
| liveblocks.io/pricing | vendor primary | MAU Unlimited | ✅ |
| liveblocks.io/docs/pricing/plans/free | vendor docs | MAU Unlimited; rooms 500 | ✅ |
| factory.com/news/missions | vendor primary | "coordination is hard" quote, orchestration model | ✅ |
| github.com/surya-koritala/sigbound README | repo primary | parallel merge, conflict resolution, parking, serve UI | ✅ |
| github.com/clash-sh/clash README | repo primary | read-only conflict detection, hook, matrix TUI | ✅ |
| cognition.com/blog/multi-agents-working | vendor primary | "writes stay single-threaded" doctrine | ✅ |
| cursor.com/changelog/{3-0,04-24-26,05-07-26,02-24-26}; prod.cursor.com/blog/agent-computer-use | vendor primary | parallel agents, isolation, PR review | ❌ (search snippets) |
| InfoQ/SiliconANGLE on Cursor Origin | press | Origin = agent-native git forge, beta Aug 2026 | ❌ (search snippets) |
| github.blog Agent HQ; docs.github.com agent-management; github.blog mission-control | vendor primary | concurrent sessions, mission control, PR review | ❌ (search snippets) |
| sourcegraph.com/blog + changelog Agentic Batch Changes | vendor primary | many-repos, mergeability status | ❌ (search snippets) |
| superset.sh; github.com/superset-sh/superset | vendor/repo | 100+ agents in worktrees + review | ❌ (search snippets) |
| arxiv.org/abs/{2510.18893, 2603.21489, 2606.19616, 2607.04697, 2604.03551, 2605.22534} | research primary | CodeCRDT, CAID, grite, merge-replay, AgenticFlict | ❌ (search snippets/abstracts) |
| ataraxy-labs.com/products | vendor primary | weave entity-level merge driver | ❌ (search snippet) |
| jules.google/docs/tasks-repos; aws.amazon.com/documentation-overview/kiro; cloud.google.com/security/codemender | vendor docs | Jules/Kiro/CodeMender posture | ❌ (search snippets) |
| github.com/{parallel-dev, sympozium-ai/sympozium, farol-team/gnap, ss-andrade/mergepilot, pbakaus/agent-reviews} | repo | fringe candidates | ❌ (search snippets) |

## 6. Gaps & Uncertainties

- **Large Codebase SDK mechanism is unverified.** No product/doc page beyond FAQ + whitepaper marketing; the "maps dependencies/sequences changes" mechanism (AST? graph? language support?) is a vendor claim. Direct doc scrape not located.
- **"Scale from one to thousands of agents"** rests on hero copy + per-user concurrency, not a published fleet/throughput spec.
- **OpenHands concurrency hard limits** for Cloud Individual beyond "10 daily conversations" are not documented; Enterprise "unlimited concurrent convos per user" is a plan bullet, not a tested ceiling.
- **Agent HQ / Cursor / Sourcegraph / Superset / Origin details** are from search snippets, not full page scrapes (firecrawl budget). Their *conflict-handling* claims specifically were not deep-verified; treat "no cross-agent conflict engine" as inference from architecture language.
- **CodeCRDT/CAID/grite follow-ups** beyond the 2026 arXiv cluster (2604.03551, 2605.22534, 2606.19616, 2607.04697, 2603.21489) not exhaustively enumerated; a dedicated follow-up sweep could surface more.
- **sigbound maturity**: ~50★, self-hosted, its own README claims 547 tests/84% coverage (self-reported, unverified).
- **Liveblocks free "monthly credits" amount** not found on the docs free-plan table; the "10k" conflict may reference credits or an older allowance — unresolved but immaterial to MAU.
