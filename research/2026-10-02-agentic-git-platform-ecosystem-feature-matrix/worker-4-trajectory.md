# Trajectory Report: Worker 4

**Areas:** Area 7 — Cloudflare Platform Primitives & Agent Runtime (overview); Area 8 — Durable Execution, Orchestration & Sandboxing (beyond Cloudflare). **Date:** 2026-10-02. Prices USD as published by vendors.

---

## 1. Solution Planning

**Decomposition.** Area 7 → compute (Workers, Durable Objects, Containers, Sandboxes, Dynamic Workers, Workflows); storage/coordination (Queues, R2, KV, D1, Hyperdrive, Vectorize, Artifacts); agent layer (Agents SDK, MCP, AI Gateway, Browser Run, Workers AI); real-world evidence (Cloudflare's own systems, Agents Week 2026). Area 8 → durable execution (Temporal, Inngest, Trigger.dev, Restate); sandboxes (E2B, Modal, Daytona, Fly Machines, Northflank + a 15-provider survey); frameworks (LangGraph, CrewAI, OpenAI Agents SDK, Claude Agent SDK); isolation (Firecracker, gVisor, Kata).

**Strategy.** Primary-source-first: Cloudflare primitives from `developers.cloudflare.com`; vendor prices from vendor pricing pages. Secondary comparisons (Upstash, bex.co, Arize, Inngest) used only for cross-vendor normalization, labelled.

**Expected vs actual.** Expected clean per-primitive limits plus a few scale blogs. Actual: richer — Agents Week 2026 (April) plus the Oct-1-2026 Artifacts/competition post gave a complete public picture of the intended agent architecture (Workflows at 50k concurrent; Sandboxes GA; a documented internal multi-agent code reviewer with cost data). On Area 8 the sandbox market converged on unit price and diverged sharply on *billing rules*. One dead end: `ai-gateway/platform/pricing/` 404s (correct: `/ai-gateway/reference/pricing/`). Read-only; only this file written.

---

## 2. Methods & Pivots

|#|Query / action|Tool|Results|Scraped|Pivot|
|---|---|---|---|---|---|
|1|Workers limits/pricing|search|limits, WfP, cost chapter|–|URLs|
|2|DO hibernation limits/pricing|search|DO limits/pricing/FAQ/WS|–|DO surface|
|3|Workflows durable execution|search|limits/pricing/changelog|–|Durable substrate|
|4|Sandbox SDK agents|search|docs, npm, AGENTS.md|–|Agent computers|
|5|Workers + DO limits/pricing|scrape ×4|full tables|4|Primary limits|
|6|Workflows, Sandbox, Agents, Containers|scrape ×4|4 pages|4|Compute + agent layer|
|7|Containers/Queues limits, AI GW, Browser|scrape ×4|4 pages|4|Coordination + tooling|
|8|Artifacts beta; case studies; Vectorize; MCP|search ×2 / scrape ×2|competition blog + leads|2|Artifacts substrate|
|9|Competition, Artifacts, fibers, AI GW pricing|scrape ×4|3 + 1×404|3|Framing; durable state|
|10|AI GW pricing; durable engines; sandboxes; orchestration|search ×4|Area 8 seeds|–|Begin Area 8|
|11|bex.co, Upstash, E2B formula, Inngest|scrape ×4|4 pages|4|Sandbox cost + taxonomy|
|12|Temporal/Trigger.dev pricing; frameworks; Fly|scrape ×2 / search ×2|2 pricing pages|2|Vendor prices|
|13|AI GW limits; Arize; Restate; isolation|scrape ×3 / search|3 pages|3|Framework + isolation|
|14|CF agents; Inngest; Modal|scrape ×2 / search|pricing, Modal rates|2|Case studies|
|15|Edera; Inngest; AI review; Workflows v2|scrape ×4|3 + 1×404|3|Deep architecture|
|16|Correct URLs|search ×2|corrected|–|Fix 404s|
|17|AI code review; Workflows v2|scrape ×2|both full|2|Case study|
|18|Fly pricing; DO scale; internal AI stack|search ×2 / scrape|Fly billing, stack|1|Gap-fill|

~18 cycles, 34 pages deeply read, ~73 sources seen.

---

## 3. Evidence Collection

### AREA 7 — Cloudflare Platform Primitives & Agent Runtime

**7.1 Workers: CPU-time is the binding constraint, not wall time.** *Evidence:* "CPU time per HTTP request | 10 ms | 5 min (default: 30 seconds)… up to 5 minutes (300,000 ms)." HTTP wall time "Unlimited" while connected. Paid: "10 million included per month +$0.30 per additional million"; "30 million CPU milliseconds included per month +$0.02 per additional million." [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) *Summary:* Cheap, duration-unbounded compute with CPU metering; 128 MB/isolate and 6 concurrent "waiting-for-headers" connections are the real ceilings; subrequests to 10,000 (10M configurable). *Confidence:* High.

**7.2 Durable Objects + realtime UI: hibernation makes stateful review rooms cheap.** *Evidence:* "soft limit of 1,000 requests per second… unlimited number of individual objects per namespace." SQLite-backed: 10 GB/object, value ≤2 MB, WS message ≤32 MiB. "recommended to use the WebSocket Hibernation API to avoid incurring duration charges"; hibernation "allows the Durable Object to hibernate without disconnecting clients when idle." Paid: 1M req + $0.15/M; 400,000 GB-s + $12.50/M GB-s. [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO WebSockets](https://developers.cloudflare.com/durable-objects/api/websockets) *Summary:* One globally-unique, single-threaded stateful actor with embedded SQLite per object; scale is horizontal. Worked example: 100 DOs × 100 hibernatable WS ≈ $20.65/mo vs ≈ $142.95/mo non-hibernating — the canonical shape is one DO per repo/room, Workers fan-out, Workflows for long jobs. *Confidence:* High.

**7.3 Workflows: durable execution for agent-triggered work, now 50k concurrency.** *Evidence:* ≤25,000 steps; `step.sleep` ≤365 days; 1 GB state/instance; limits raised to "50,000 concurrent instances… 300 instances/second created per account… 2 million queued instances." Control plane rebuilt with *SousChef* + *Gatekeeper*. Billing: "500,000 steps included/month + $0.80 per additional 100,000." [Workflows Limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workflows v2](https://blog.cloudflare.com/workflows-v2/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) *Summary:* Waiting instances don't consume concurrency slots — millions may sleep; the natural home for long-horizon agent jobs (billing starts 2026-08-10). *Confidence:* High.

**7.4 Sandboxes + Containers: a real Linux computer per agent, microVM-isolated.** *Evidence:* "Each instance is a microVM with its own kernel and network, so no other workload shares it." `lite` (1/16 vCPU, 256 MiB) → `standard-4` (4 vCPU, 12 GiB); account limits 6 TiB memory / 1,500 vCPU / 30 TB disk. Billing: "25 GiB-hours/month included +$0.0000025 per additional GiB-second; 375 vCPU-minutes/month + $0.000020 per additional vCPU-second." [Sandbox](https://developers.cloudflare.com/sandbox/), [Containers Limits](https://developers.cloudflare.com/containers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) *Summary:* Full-language Linux with per-task isolation; SDK 1.0 preview, 0.x stable, GA announced Agents Week; a DO starts the instance and Internet HTTP reaches it only via the Worker. *Confidence:* High.

**7.5 Agents SDK: agent = Durable Object + SQLite + fibers.** *Evidence:* "Each agent runs on a Durable Object — a stateful micro-server with its own SQL database, WebSocket connections, and scheduling… scaling to tens of millions of instances." `runFiber()` "persists the work in SQLite so it can be recovered"; `startFiber()` gives "durable acceptance… safe dedupe retries"; recovery via `onFiberRecovered()`. DO eviction: inactivity ~70–140 s, code updates "1–2x per day", alarm timeout 15 min. [Agents](https://developers.cloudflare.com/agents/), [Fibers](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/) *Summary:* Identity, state, sessions, routing, WebSockets, schedules and crash recovery as a TypeScript class; sub-agents share the parent alarm slot — the closest thing to a batteries-included agent workspace on any cloud. *Confidence:* High.

**7.6 Artifacts (overview): Git-compatible storage for tens of millions of repos.** *Evidence:* "create tens of millions of repos, fork from any remote, and hand off a URL to any Git client." Pushes publish `cf.artifacts.repo.pushed`; the Workers binding lets a Worker "fork the project for an agent, read the files it needs… and issue repo-scoped Git tokens"; US/EU jurisdiction is namespace-scoped. Billing starts 2026-10-15. [Artifacts](https://developers.cloudflare.com/artifacts/), [competition post](https://blog.cloudflare.com/next-git-platform-on-cloudflare/) *Summary:* Artifacts is the storage layer; the competition asks for "the layer above it: how agents coordinate their work, how changes are reviewed and merged" — so our product is that layer. *Confidence:* High on positioning, Low on pricing.

**7.7 Agent tooling is platform-native (MCP, AI Gateway, Browser Run).** *Evidence:* MCP "Remote MCP connections… Streamable HTTP… OAuth." AI Gateway: caching, rate-limit, retries, fallback, analytics; "Gateways free plan | 10 per account… paid plan | 20." Browser Run "Scale to thousands of browsers… 4x higher concurrency limits for AI agents," with Playwright/Puppeteer/CDP/Stagehand + MCP. [MCP](https://developers.cloudflare.com/agents/model-context-protocol/), [AI Gateway Limits](https://developers.cloudflare.com/ai-gateway/reference/limits/), [Browser Run](https://developers.cloudflare.com/browser-rendering/) *Summary:* Tool access, inference control plane, browser automation, search, memory and voice are first-party and Workers-bindable — a small integration surface for an 11-day build. *Confidence:* High.

**7.8 Proof at scale: Cloudflare's own multi-agent code reviewer.** *Evidence:* "131,246 review runs across 48,095 merge requests in 5,169 repositories," median "3 minutes and 39 seconds," mean cost "$1.19" (median $0.98, P99 $4.45); tiers trivial $0.20 / lite $0.67 / full $1.68; cache-hit "85.7%"; up to seven specialists; "break glass" only 0.6% of MRs. [AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/) *Summary:* The key precedent — coordinator + specialist sub-reviewers, risk-tiered fan-out, one shared cached context file, findings persisted across re-reviews via MCP — plus honest limits (architecture awareness, cross-system impact, concurrency bugs, cost scaling with diff size). *Confidence:* High.

**7.9 Composition for thousands of concurrent agent workspaces.** *Evidence:* unlimited DOs with hibernation [DO Limits]; Workflows 50,000 concurrency / 300 per s / 2M queued [Workflows v2]; Containers 1,500 concurrent vCPU + 6 TiB memory per account [Containers Limits]; Agents SDK "tens of millions of instances" [Agents]; Artifacts "tens of millions of repos" [Artifacts]. *Summary:* **Artifacts** (repo/branch per task) → **Workflows** (durable job per task, fan-out to sub-reviewers) → **DOs/Agents SDK** (session state, orchestration, realtime WS) → **Sandboxes** (only when a full Linux env is needed) → **AI Gateway** (routing/cost/ZDR) → **Queues** (event fan-out) → **R2/D1/KV**. Originality must live in coordination/review/UX. *Confidence:* Medium-High (synthesis; no single page states it).

**What to borrow**
- **One DO per repo/session as coordination hub, with hibernatable WebSockets** — a review room holds thousands of viewers while idle at zero duration cost; keep the change-set index, agent roster and finding ledger in its SQLite.
- **Model each agent task as a Workflow instance, not a Worker request** — per-step retries, `waitForEvent` human approval, million-scale sleeping instances free of concurrency slots, 50k concurrent running; keep the agent loop in the DO (fibers) and the long job in Workflows.
- **Fan out reviewers as risk-tiered sub-agents over one shared cached context file** — Cloudflare's reviewer reached 85.7% cache hits and $1.19/review this way; copy the trivial/lite/full tiering.

---

### AREA 8 — Durable Execution, Orchestration & Sandboxing (beyond Cloudflare)

**8.1 Four durable-execution models, four shapes.** *Evidence:* Inngest "durable functions split into steps, triggered by events, schedules, calls from other functions." Temporal "workflows and activities: sequential code whose history replays on crash. You run workers that poll." Restate "journals durable handlers and virtual objects (stateful entities keyed by ID) inside a compact runtime." Trigger.dev "named tasks in TypeScript… managed compute, warm workers, checkpoints." [Job queue alternatives](https://www.inngest.com/blog/best-job-queue-alternatives) *Summary:* Temporal = replay, polyglot, worker fleet you run (max durability/ops); Restate = journal + virtual objects, tiny runtime (good for per-agent-session state); Inngest = event+step on *your* compute; Trigger.dev = managed TS compute. *Confidence:* High.

**8.2 Pricing converges on per-action/per-step + storage.** *Evidence:* Temporal "$50 per million actions… $0.042/GBhr Active Storage" (to $25/M). Restate Free 100k actions → $75/mo (5M) → $300/mo (20M), $25/M overage. Inngest Free 50k executions → $99/mo (1M); "a multi-step AI agent… often 10+ executions per run." Trigger.dev Free $0 → $50/mo (200+ concurrent) + "$0.000025 per run" + per-second compute. [Temporal](https://temporal.io/pricing), [Restate](https://restate.dev/pricing/), [Inngest](https://www.inngest.com/pricing), [Trigger.dev](https://trigger.dev/pricing) *Summary:* Cost scales with step granularity, not wall time; Inngest's FAQ concedes "the ranking can flip depending on step count and compute duration." *Confidence:* High on numbers, Medium on ranking.

**8.3 Sandbox isolation is a three-way choice that maps to vendor.** *Evidence:* "Hardware VMs with their own kernel (E2B, Vercel, Tensorlake, Sprites, Koyeb, Blaxel, Namespace, Kata on Northflank), gVisor's userspace kernel (Modal, Beam), and hardened containers (Box, Daytona by default)." gVisor adds "Syscall interception overhead (10–30% on I/O heavy workloads)"; Firecracker "Boot in ~100–200ms… KVM for hardware-enforced isolation"; Kata "Runs each pod inside a VM." [Upstash](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026), [Edera](https://edera.dev/stories/kata-vs-firecracker-vs-gvisor-isolation-compared) *Summary:* For adversarial multi-tenant agent code a dedicated kernel per sandbox (Firecracker) is the defensible default; gVisor shares the host kernel; Kata layers microVMs under Kubernetes. *Confidence:* High.

**8.4 Rate-sheet parity is real; the billing *rule* differentiates.** *Evidence:* "E2B and Daytona now charge exactly the same price… $0.0504 per vCPU-hour plus $0.0162 per GiB-hour, billed per second… E2B and Daytona meter wall-clock: a sandbox that sits alive-but-idle for eight of its ten minutes… bills all ten. Modal meters provisioned resources while running and nothing while idle." Upstash: "An hour of agent work that mostly waits is about $0.017 on Box, and 2.6x to 19x that on the other providers." [bex.co](https://bex.co/blog/2026/09/09/e2b-daytona-modal-sandbox-pricing-self-hosted), [Upstash](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026) *Summary:* Since agents mostly wait on models, liveness billing is 3–19× costlier than active-CPU billing for the same task. *Confidence:* High.

**8.5 Concurrency ceilings are plan limits, not physics.** *Evidence:* E2B Hobby 20 concurrent, Pro 100 "expandable to 1,100," Enterprise "Tens of thousands of concurrent sandboxes." Modal "documents operation at 100,000+ concurrent sandboxes… up to 50,000 concurrent Sandboxes per customer." Daytona "vCPU pools 10 → 500 by tier." [E2B Pricing](https://e2b.dev/pricing), [Modal](https://modal.com/resources/best-serverless-platforms-rl-environment-compute), [Upstash](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026) *Summary:* Thousands concurrent is attainable but tiered; practical mid-tier ceilings are 100–1,100, tens of thousands on enterprise. *Confidence:* High (E2B), Medium (Modal's top figures).

**8.6 Cold start decides architecture: per-tool-call vs pooled.** *Evidence:* "Daytona boots sandboxes in under 90ms while E2B's Firecracker microVMs take ~150ms." Upstash: Blaxel "~25ms resume from standby," Cloudflare "1–3s." "at 90 ms you can spawn a fresh sandbox per tool call; at multi-second starts you must pool and reuse, which reintroduces state-leakage hygiene." [bex.co](https://bex.co/blog/2026/09/09/e2b-daytona-modal-sandbox-pricing-self-hosted), [Upstash](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026) *Summary:* Snapshot/resume in tens-to-150 ms enables ephemeral-per-task isolation; multi-second starts force warm pools and cross-task leakage risk. *Confidence:* High.

**8.7 Frameworks split into SDK / runtime / harness layers.** *Evidence:* Arize's 2026 taxonomy: SDK (OpenAI Agents SDK, CrewAI, Pydantic AI, Strands); orchestration runtime (LangGraph, LlamaIndex Workflows); harness (Claude Agent SDK, Microsoft Agent Framework, Mastra); managed platform (Bedrock AgentCore). LangGraph = "explicit nodes, edges, state transitions, and checkpoints"; OpenAI Agents SDK = "model-directed loop, handoffs, agents-as-tools"; CrewAI = "role-based crews combined with stateful flows"; Claude Agent SDK = "Claude-driven loop with built-in file, shell, MCP, hook, permission, and subagent capabilities." [Arize](https://arize.com/ai-agents/agent-frameworks/) *Summary:* 2026 direction is *harnesses* (loop + context + permissions + persistence + subagents) replacing bare frameworks; Claude-Agent-SDK shape is the closest match to a git platform. *Confidence:* High.

**8.8 Four canonical coordination patterns.** *Evidence:* Arize lists manager→workers, handoffs, agents-as-tools, graph routing, swarm and parallel workers→aggregator, warning "Multiple agents increase the number of model calls, handoffs, state transitions, and potential coordination failures." [Arize](https://arize.com/ai-agents/agent-frameworks/), [Microsoft Learn](https://learn.microsoft.com/sv-se/agents/architecture/multi-agent-orchestrator-sub-agent) *Summary:* Supervisor and handoff are the workhorses; parallel fan-out + aggregator suits reviewing many concurrent agent diffs; coordinate on artifacts (branches/diffs/findings), not shared conversation. *Confidence:* High.

**8.9 Managed-compute vs BYO-compute is the durable-engine fork.** *Evidence:* "Trigger.dev: tasks run on Trigger.dev's infrastructure on Cloud… Inngest: functions run on your infrastructure, full stop." Temporal "you still run workers." Restate "Orchestration managed; handlers on your infra." [Inngest comparison](https://www.inngest.com/blog/best-job-queue-alternatives) *Summary:* For a Workers-hosted platform, Inngest's orchestrate-only model maps cleanly; Temporal/Trigger.dev need a separate worker fleet, and Cloudflare Workflows already provides the Inngest shape natively. *Confidence:* High.

**8.10 Managed agent platforms now bundle identity/memory/gateways.** *Evidence:* "Amazon Bedrock AgentCore… includes services for runtime execution, identity, memory, tool gateways, browser use, code execution, observability, evaluation." [Arize](https://arize.com/ai-agents/agent-frameworks/) *Summary:* Hyperscalers ship the same primitives; Cloudflare's edge is global low-latency state (DOs) plus Git-compatible storage (Artifacts), not raw sandbox capacity. *Confidence:* Medium-High.

**What to borrow**
- **Use Cloudflare-native durability by default (Workflows + DO fibers); borrow Restate's virtual-object idea conceptually** — one single-writer entity per agent session/repo maps onto one DO per session ("per-key serialization… without hand-rolling locks"); the "orchestrate-only, compute-is-mine" split is simply what Workers are.
- **Make isolation a per-task property.** Default to dedicated-kernel microVMs for model-generated code (E2B/Firecracker), use snapshot-resume to keep starts low, and fall back to Dynamic Workers/isolates for pure-JS tool execution.
- **Budget on active work, not liveness, and surface cost-per-review in the UI** — instrument tier→cost the way Cloudflare's reviewer does.

---

## 4. Synthesis & Confidence

**Area 7.** Cloudflare has assembled a stack matching a multi-agent git platform almost exactly. Durable Objects give globally-unique single-writer state with embedded SQLite and *free-while-hibernating* WebSockets — the ideal one-hub-per-repo and realtime-review-room substrate. Workflows, re-architected in April 2026 for "agent-triggered workflows created at machine speed," gives durable multi-step execution at 50,000 concurrent instances with free waiting states. Sandboxes/Containers (GA Agents Week) give each agent an isolated Linux microVM when cloning/building/testing is required, while Dynamic Workers cover cheap pure-JS execution. Artifacts supplies the mandated Git-compatible, forkable storage; AI Gateway, Browser Run, MCP, AI Search, Workers AI and the Agents SDK remove most integration work.

The decisive evidence is Cloudflare's own CI-native reviewer: a coordinator + seven-specialist orchestrator over 5,169 repos, 131,246 runs, ~1.2 findings/review, $1.19 mean cost, 85.7% cache hits, 0.6% escalation — a production-proven template for many agents on one codebase. Differentiated work therefore lives in orchestration, context preservation, conflict handling and visual triage, not storage or compute. Binding constraints: 128 MB/isolate and 6 concurrent outbound connections per Worker (fan-out belongs in Workflows/Queues); DO soft cap ~1,000 req/s (one hub DO per repo); container capacity (1,500 concurrent vCPU / 6 TiB per account) is the hard ceiling on simultaneous heavy sandboxes — for thousands of concurrent workspaces, the sandbox budget binds first.

**Area 8.** Durable execution has consolidated into four shapes (Temporal replay+workers, Restate journal+virtual-objects, Inngest event+steps on your compute, Trigger.dev managed TS tasks), all billed per step/action and differing mainly in where compute runs. The most transferable concept is Restate's virtual object — a single-writer, ID-keyed entity — functionally identical to one Durable Object per agent session, so the Cloudflare-native path largely subsumes an external durable engine unless cross-cloud polyglot workflows are needed.

Sandboxing shows a market converged on unit price ($0.0504/vCPU-hr + $0.0162/GiB-hr at E2B and Daytona) but diverged on the axis that matters at fleet scale: liveness vs active-CPU billing. Because coding agents wait on models most of the time, liveness billing is 3–19× costlier for the same task. Isolation strength tracks vendor choice (E2B Firecracker dedicated kernel; Modal/Beam gVisor; Box/Daytona container), and for adversarial code the dedicated-kernel default is correct. Cold start decides whether isolation can be per-tool-call or must be pooled.

For coordination, 2026 is shifting from bare frameworks to *harnesses*, with four workhorse patterns: supervisor, handoff, agents-as-tools, and parallel-fan-out-with-aggregator. The strongest lesson is to coordinate on *artifacts* rather than shared conversation and to keep specialists few and risk-tiered — exactly what Cloudflare's reviewer does.

**Conclusions**
1. Cloudflare's native stack (Artifacts + Workflows + DOs/Agents SDK + Sandboxes + AI Gateway) is sufficient end-to-end; no external durable engine or sandbox vendor is required. (High; 12+ primary pages.)
2. Workflows' April-2026 re-architecture makes it the correct durable substrate at our target scale. (High; blog + changelog + limits.)
3. The binding constraint for thousands of concurrent agent workspaces is sandbox/container capacity, not Durable Objects or Workflows. (High.)
4. Hibernatable WebSockets + one DO per repo is the cheapest, most idiomatic realtime-review architecture. (High.)
5. Per-step/action billing makes agent cost scale with granularity, not wall time, across all four durable engines. (High.)
6. Sandbox unit prices have converged but effective cost diverges 3–19× on liveness-vs-active-CPU billing. (High.)
7. Dedicated-kernel microVMs are the defensible isolation default for agent-generated code. (High.)
8. The 2026 field consolidates on harnesses with supervisor/handoff/parallel patterns; the production template is a risk-tiered coordinator + few specialists. (High.)
9. Cloudflare's internal reviewer gives quotable benchmarks (131k runs, $1.19 avg, 85.7% cache hit, 0.6% escalation). (High.)
10. Artifacts is the mandated foundation and is designed to be composed upon; differentiation must be in coordination/review/UX. (High.)

---

## 5. Sources Consulted

|#|Title|URL|Type|Date|Scraped?|Tier|
|---|---|---|---|---|---|---|
|1|Workers Limits|developers.cloudflare.com/workers/platform/limits/|Docs|2026-09|✅|70|
|2|Workers Pricing|developers.cloudflare.com/workers/platform/pricing/|Docs|2026-08|✅|70|
|3|DO Limits|developers.cloudflare.com/durable-objects/platform/limits/|Docs|2026-06|✅|70|
|4|DO Pricing|developers.cloudflare.com/durable-objects/platform/pricing/|Docs|2026-09|✅|70|
|5|Workflows Limits|developers.cloudflare.com/workflows/reference/limits/|Docs|2026-09|✅|70|
|6|Workflows Pricing|developers.cloudflare.com/workflows/reference/pricing/|Docs|2026-09|✗|70|
|7|Sandboxes|developers.cloudflare.com/sandbox/|Docs|2026-09|✅|70|
|8|Agents|developers.cloudflare.com/agents/|Docs|2026-09|✅|70|
|9|Containers|developers.cloudflare.com/containers/|Docs|2026-09|✅|70|
|10|Containers Limits|developers.cloudflare.com/containers/platform/limits/|Docs|2026-09|✅|70|
|11|Queues Limits|developers.cloudflare.com/queues/platform/limits/|Docs|2026-04|✅|70|
|12|AI Gateway|developers.cloudflare.com/ai-gateway/|Docs|2026-04|✅|70|
|13|AI Gateway Limits|developers.cloudflare.com/ai-gateway/reference/limits/|Docs|2026-09|✅|70|
|14|Browser Run|developers.cloudflare.com/browser-rendering/|Docs|2026-08|✅|70|
|15|Vectorize|developers.cloudflare.com/vectorize/|Docs|2026-04|✅|70|
|16|MCP|developers.cloudflare.com/agents/model-context-protocol/|Docs|2026-06|✅|70|
|17|Durable execution (fibers)|developers.cloudflare.com/agents/runtime/execution/durable-execution/|Docs|2026-08|✅|70|
|18|Artifacts|developers.cloudflare.com/artifacts/|Docs|2026-10|✅|70|
|19|Next Git platform (competition)|blog.cloudflare.com/next-git-platform-on-cloudflare/|Blog|2026-10-01|✅|70|
|20|Agents Week recap|blog.cloudflare.com/agents-week-in-review/|Blog|2026-04-20|✅|70|
|21|AI Code Review at scale|blog.cloudflare.com/ai-code-review/|Blog|2026-04-20|✅|70|
|22|Workflows control plane v2|blog.cloudflare.com/workflows-v2/|Blog|2026-04-15|✅|70|
|23|Internal AI engineering stack|blog.cloudflare.com/internal-ai-engineering-stack/|Blog|2026-04-20|✅|70|
|24|Workflows limits raised|developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised|Changelog|2026-04|✗|70|
|25|15 agent sandboxes compared|upstash.com/blog/ai-agent-sandbox-providers-compared-2026|Comparison|2026-09-17|✅|50|
|26|Sandbox price parity|bex.co/blog/2026/09/09/e2b-daytona-modal-sandbox-pricing-self-hosted|Blog|2026-09-09|✅|50|
|27|E2B price formula|docs.e2b.dev/faq/calculate-sandbox-price|Docs|2026|✅|70|
|28|E2B Pricing|e2b.dev/pricing|Pricing|2026|✅|70|
|29|Job queue alternatives|inngest.com/blog/best-job-queue-alternatives|Blog|2026-08-26|✅|50|
|30|Inngest Pricing|inngest.com/pricing|Pricing|2026|✅|70|
|31|Temporal Pricing|temporal.io/pricing|Pricing|2026|✅|70|
|32|Trigger.dev Pricing|trigger.dev/pricing|Pricing|2026|✅|70|
|33|Restate Pricing|restate.dev/pricing/|Pricing|2026|✅|70|
|34|Modal Pricing|modal.com/pricing|Pricing|2026|✗|70|
|35|Modal RL environment compute|modal.com/resources/best-serverless-platforms-rl-environment-compute|Blog|2026|✗|50|
|36|Modal code-exec sandboxes|modal.com/resources/best-serverless-sandboxes-ai-code-execution|Blog|2026|✗|50|
|37|Agent frameworks (Arize)|arize.com/ai-agents/agent-frameworks/|Research|2026-10-01|✅|50|
|38|Kata vs Firecracker vs gVisor|edera.dev/stories/kata-vs-firecracker-vs-gvisor-isolation-compared|Blog|2026-01-30|✅|50|
|39|Northflank Pricing|northflank.com/pricing|Pricing|2026|✅|70|
|40|Fly.io Billing|docs.fly.io/about/billing|Docs|2026|✗|70|
|41|Fly.io Pricing|fly.io/pricing|Pricing|2026|✗|70|
|42|Fly Machine suspend/resume|docs.fly.io/reference/suspend-resume|Docs|2026|✗|70|
|43|LangGraph/CrewAI/OpenAI compare|langgraphjs.guide/comparison|Guide|2026|✗|50|
|44|LangGraph→CrewAI migration|docs.crewai.com/v1.15.2/en/guides/migration/migrating-from-langgraph|Docs|2026|✗|70|
|45|Deep Agents vs Claude Agent SDK|docs.langchain.com/oss/python/deepagents/comparison|Docs|2026|✗|70|
|46|Agent frameworks (Open.cx)|open.cx/blog/ai-agent-frameworks-langgraph-crewai-autogen-2026|Blog|2026-05-30|✗|50|
|47|Agent frameworks 2026|letsdatascience.com/blog/ai-agent-frameworks-compared|Blog|2026|✗|50|
|48|Orchestrator/subagent patterns|learn.microsoft.com/sv-se/agents/architecture/multi-agent-orchestrator-sub-agent|Docs|2026-05|✗|70|
|49|AI agent design patterns|github.com/microsoftdocs/architecture-center/.../ai-agent-design-patterns.md|Docs|2026-02|✗|70|
|50|OpenAI Swarm guide|splunk.com/en_us/blog/learn/openai-swarm-framework.html|Blog|2026-09-23|✗|50|
|51|Aixgo patterns|github.com/aixgo-dev/aixgo/blob/main/docs/PATTERNS.md|Repo|2026|✗|30|
|52|Sandbox GA|blog.cloudflare.com/sandbox-ga/|Blog|2026-04|✗|70|
|53|Project Think|blog.cloudflare.com/project-think/|Blog|2026-04|✗|70|
|54|Code Mode|blog.cloudflare.com/code-mode/|Blog|2026-04|✗|70|
|55|Enterprise MCP|blog.cloudflare.com/enterprise-mcp/|Blog|2026-04|✗|70|
|56|DO WebSockets API|developers.cloudflare.com/durable-objects/api/websockets|Docs|2026|✗|70|
|57|DO overview|developers.cloudflare.com/durable-objects/|Docs|2026-07|✗|70|
|58|DO control/data-plane|developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern|Docs|2026-08|✗|70|
|59|Workers for Platforms pricing|developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing|Docs|2026-04|✗|70|
|60|Agent Cloud press release|cloudflare.com/press/press-releases/2026/...|Press|2026-04-13|✗|70|
|61|Artifacts beta (InfoQ)|infoq.com/news/2026/05/cloudflare-artifacts-ai-agents|News|2026-05-08|✗|50|
|62|Workflows V2 (InfoQ)|infoq.com/news/2026/05/cloudflare-workflows-v2-release|News|2026-05-15|✗|50|
|63|Firecracker/gVisor study|par.nsf.gov/servlets/purl/10176031|Paper|2021|✗|90|
|64|RunC/gVisor/Kata analysis|dl.acm.org/doi/10.1007/s10586-021-03517-8|Paper|2021|✗|90|
|65|gVisor/Kata/Firecracker benchmark|johal.in/benchmark-gvisor-10-vs-kata-containers-30-vs|Blog|2026-04-28|✗|30|
|66|Cold-start comparison|eitt.academy/knowledge-base/container-cold-start-times-comparison-2024-2026|Reference|2026|✗|30|
|67|Firecracker repo|github.com/firecracker-microvm/firecracker|Repo|2026|✗|70|
|68|Cloudflare AI review analysis|0xgosu.dev/blog/cloudflare-ai-code-review-orchestration|Blog|2026-05-30|✗|30|
|69|Standards enforcement with AI|blog.cloudflare.com/engineering-standards-enforcement|Blog|2026-08-04|✗|70|
|70|E2B vs Fly Machines|withruntime.com/compare/e2b-vs-fly-machines|Comparison|2026-09|✗|30|
|71|Baseten vs Modal|truefoundry.com/ar/blog/baseten-vs-modal|Blog|2026|✗|30|
|72|AI Gateway cost analysis|mecanik.dev/en/posts/cloudflare-ai-gateway|Blog|2026|✗|30|
|73|Cloudflare pricing changes|blog.blazingcdn.com/en-us/cloudflares-pricing-changes-in-2025...|Blog|2026|✗|30|

---

## 6. Gaps, Uncertainties & Inaccessible Sources

- **Artifacts pricing/limits** deferred to the separate Artifacts recon; billing starts 2026-10-15.
- **Modal 50,000/1,000,000 concurrency** is vendor-stated only.
- **Daytona isolation default** (shared-kernel Docker, Kata/gVisor opt-in) is agreed across sources, but per-tier posture is undocumented in one place.
- **Fly Machines per-second rates** mixed/older ($0.00000292/s for shared-cpu-1x@1024MB in a 2024 thread); approximate only.
- **404s:** `ai-gateway/platform/pricing/` (→ `/ai-gateway/reference/pricing/`); `orchestrating-ai-code-review-at-scale/` (→ `/ai-code-review/`).
- **No independent benchmark** of a Workers+Artifacts platform running thousands of concurrent sandboxed agents; all scale claims are vendor-published.
- **Bias:** Inngest/Modal/Upstash comparisons are vendor-authored and self-favouring; cross-checked against primary docs where possible.

---

## 7. Tool Quick-Reference

|Tool|Category|Standout features|Pricing (entry→enterprise)|Segment|Stack|Refs|
|---|---|---|---|---|---|---|
|Workers|Serverless compute|5-min CPU; no HTTP duration limit; free static assets|Free → $5/mo + $0.30/M req, $0.02/M CPU-ms|All devs|V8 isolates, 128 MB|1,2|
|Durable Objects|Stateful coordination|Globally-unique single-writer; embedded SQLite; hibernating WS|Free → $0.15/M req, $12.50/M GB-s|Realtime/stateful|DO+SQLite, alarms, ~1,000 req/s|3,4|
|Workflows|Durable execution|50k concurrent; free wait-states; 365-day sleeps; 25k steps|Free → 500k steps/mo + $0.80/100k|Agent/backend|DO-based; SousChef+Gatekeeper|5,6,22,24|
|Queues|Message queue|5,000 msg/s/queue; 100 retries; DLQ; 14-day retention|Free → 1M ops/mo + $0.40/M|Async fan-out|Workers consumer, 15-min wall|11|
|Containers|Serverless containers|Linux microVM per instance; 6 types; snapshots|Paid → $0.0000025/GiB-s, $0.000020/vCPU-s|Heavy/any-language|DO-scheduled, Region:Earth|9,10,2|
|Sandbox SDK|Agent code sandbox|Linux per agent; PTY; R2 mounts; agent-CLI runners|Paid → container rates|Coding agents|Containers + DO|7,20|
|Agents SDK|Agent runtime/harness|Agent=DO; fibers durable execution; sub-agents; sessions|Paid|Agent builders|DO+SQLite+fibers|8,17|
|Artifacts|Git-compatible storage|Tens of millions of repos; forks; push events; Workers binding|Billing 2026-10-15|Platforms/agents|Git + REST + binding|18,19|
|R2|Object storage|Zero egress; S3-compatible|10 GB free → $0.015/GB-mo|Storage-heavy|S3 API|2|
|KV|Key-value|Edge-replicated|Free → $0.50/M read, $5/M write|Config/cache|Global KV|2|
|Hyperdrive|DB pooler|Pools+caches external Postgres/MySQL|Free → unlimited queries|External DB|Edge pooling|2|
|Vectorize|Vector DB|Workers-bindable embeddings|Paid → 50M dims free, $0.01/M|AI apps|Workers AI/R2/D1|15,2|
|AI Gateway|LLM gateway|Caching, rate-limit, retries, fallback, BYOK, ZDR|Free; 10M logs + $0.60/M|AI apps|1-line SDK, routing|12,13|
|Browser Run|Headless browser|Thousands of browsers; Playwright/CDP/MCP; Live View|Free & Paid|Automation/agents|Global Chromium|14|
|Remote MCP|Tool protocol host|Streamable HTTP + OAuth on Workers|Paid|Agent tooling|McpAgent + oauth-provider|16|
|Temporal|Durable execution|Replay, polyglot, 99.99% HA; you run workers|$150 credits → $50/M actions (→$25/M)|Enterprise polyglot|Workflows+Activities|31|
|Inngest|Durable execution|Event+step; flow control; compute stays yours|Free → $99/mo (1M) → $499/mo|Serverless apps|Durable steps over HTTP|29,30|
|Trigger.dev|Durable execution|Managed compute; no timeouts; Apache-2.0|Free → $50/mo + compute|TS teams|Tasks on managed workers|32|
|Restate|Durable execution|Journal + virtual objects; single binary|Free → $75 → $300 → $1k/mo|Durable services/agents|Handler+object journaling|33|
|E2B|Sandbox|Firecracker per sandbox; ~150 ms start; fork; Apache-2.0|$100 credit → $150/mo + $0.0504/vCPU-h|AI code exec|Firecracker, GCP, BYOC|26,27,28|
|Modal|Sandbox/serverless|gVisor; GPU sandboxes; 100k+ concurrent; scale-to-zero|$30 credit → 3× function rate|GPU/ML/sandbox|gVisor, per-second|34,35,36|
|Daytona|Sandbox|Sub-90 ms start; container default, Kata/gVisor opt-in|$200 credit → $0.0504/vCPU-h|Fast-start agents|Docker default|26,25|
|Fly Machines|MicroVM compute|Firecracker; suspend/resume keeps memory; 100–500 ms wake|Per-second by CPU/RAM|Apps/agents|Firecracker + cgroups|40,41,42|
|Northflank|PaaS/BYOC|Kata/Cloud Hypervisor or gVisor; GPU + BYOC|Free → $0.01667/vCPU-h, $0.00833/GB-h|Enterprise/BYOC|Kubernetes (Kata)|39|
|LangGraph|Orchestration runtime|Graph nodes/edges/checkpoints; HITL interrupts|OSS (+ paid platform)|Stateful workflows|Graph state machine|37,43|
|CrewAI|Multi-agent framework|Role-based crews + stateful Flows; delegation|OSS + Enterprise|Role-based teams|Crews/Flows|37,44|
|OpenAI Agents SDK|Agent SDK|Agents, handoffs, guardrails, sessions, Runner|OSS|OpenAI-first apps|Loop + handoffs|37,50|
|Claude Agent SDK|Agent harness|File/shell/MCP tools, hooks, permissions, subagents|OSS SDK|Coding/research|Claude loop + hooks|37,45|
|gVisor|Isolation|Userspace kernel (Go); no nested virt|OSS|Defense-in-depth|Sentry; 10–30% overhead|38,63,64|
|Firecracker|Isolation|Rust microVMs; ~100–200 ms boot; KVM isolation|OSS (AWS)|Multi-tenant|Minimal VMM + jailer|38,67,63|
|Kata Containers|Isolation|microVMs in Kubernetes via RuntimeClass|OSS|K8s multi-tenancy|Pod-in-VM|38,64,65|
