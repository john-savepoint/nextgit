## Trajectory Report: Worker 3

**Areas:** 5 (Context Engineering, Code Intelligence & Provenance) and 6 (Visual/Spatial Review UX + Collaborative Canvas & Sync Infrastructure). **Date:** 2026-10-02. **Sources seen:** 78 (52 read/scraped, 26 discovery-only).

### 1. Solution Planning

Each area was split into sub-buckets. **Area 5:** repo-context packagers (Repomix, Gitingest); code intelligence (Sourcegraph, DeepWiki); structural-AST tooling (tree-sitter, ast-grep, Semgrep, OpenRewrite/Moderne, Difftastic); context layers (Unblocked); standards (AGENTS.md, MCP); spec-driven development (spec-kit, Kiro, OpenSpec, Tessl); provenance (Git AI, agentblame). **Area 6:** visual review (Whiteboard, CodeSee, AppMap, Swimm); diagrams-in-PR (Mermaid, D2, ZenUML); canvas rendering (React Flow, tldraw, Excalidraw, PixiJS); CRDT engines (Yjs, Automerge, Loro); hosted sync (Liveblocks, PartyKit, tldraw sync); local-first DBs (Jazz, Convex, InstantDB, ElectricSQL); CRDT-for-code literature.

**Expected vs actual.** Expected mature packagers, a nascent AGENTS.md/MCP standards layer, and a crowded sync market — all matched. Three surprises reshaped the run: (1) **CodeCRDT (arXiv 2510.18893)** — an empirical 600-trial study of CRDT-coordinated multi-agent LLM coding; (2) **Git AI is now part of OpenAI** and publishes a line-level attribution *standard*; (3) **Whiteboard (YC W26, MIT, 1.7k★)** is near-exact prior art, complete with a JSON review API, authoring leases and a decision log. Strategy shifted from "list tools" to "extract the concurrency/provenance primitive each tool exposes" — what the 25% multi-agent criterion rewards.

### 2. Methods & Pivots

| Cycle | Query | Tool | Results | Scraped | Pivot Reason |
|---|---|---|---|---|---|
| 1 | Repomix vs Gitingest 2026 | firecrawl_search | 9 | — | Baseline packager landscape |
| 2 | AGENTS.md standard adoption 2026 | firecrawl_search | 10 | — | Revealed AAIF/Linux Foundation + 20k repos |
| 3 | spec-driven dev Kiro spec-kit OpenSpec Tessl | firecrawl_search | 10 | — | Found specdriven.com landscape |
| 4 | Git AI attribution git history | firecrawl_search | 10 | — | Found "now part of OpenAI" + spec v3.0.0 |
| 5 | Sourcegraph code intelligence DeepWiki | firecrawl_search | 10 | — | Confirmed context-layer + DeepWiki MCP |
| 6 | ast-grep vs Semgrep vs tree-sitter vs OpenRewrite | firecrawl_search | 10 | — | Structural tooling + star counts |
| 7 | Whiteboard dev.fast cognitive debt review | firecrawl_search | 9 | andrew.ooo review | **Pivot:** Whiteboard = direct prior art |
| 8 | CodeSee AppMap Swimm Unblocked visual review | firecrawl_search | 9 | — | Visual-review segment |
| 9 | Yjs vs Loro vs Automerge benchmark | firecrawl_search | 10 | — | crdt-benchmarks + secsync + zylos |
| 10 | Liveblocks vs PartyKit vs Convex pricing | firecrawl_search | 9 | youngju realtime deep-dive | Pricing conflict surfaced |
| 11 | tldraw sync pricing / React Flow license | firecrawl_search | 9 | — | Licensing risk (tldraw SDK license) |
| 12 | Jazz InstantDB ElectricSQL local-first | firecrawl_search | 9 | youngju CRDT deep-dive | Local-first quadrant filled |
| 13 | CRDT for source code multiplayer AST merge | firecrawl_search | 10 | arXiv 2510.18893 | **Pivot:** CodeCRDT + CoAST literature |
| 14 | MCP adoption / Unblocked / PixiJS WebGPU / Repomix stars | firecrawl_search ×4 | 40 | — | Adoption numbers + WebGPU |
| 15 | Difftastic / spec-kit adoption | firecrawl_search ×2 | 20 | — | Structural diff + spec-kit stars |
| 16 | DeepWiki / OpenRewrite / PartyKit-Cloudflare / diagrams-in-PR | firecrawl_search ×4 | 38 | — | PartyKit acquisition, ZenUML, Moderne |

**Tool note.** firecrawl_search returned HTTP 400 for payloads containing `limit`/`highlights`; retrying with `{query}` only succeeded. firecrawl_scrape worked throughout.

### 3. Evidence Collection

#### Area 5 — Context Engineering, Code Intelligence & Provenance

**5.1 Repo-context packagers.** / *Rationale:* how a repo is packaged for LLMs today. / *Evidence:* Repomix "packages your entire codebase into a single AI-friendly file… Token Counting… plain text, XML, or Markdown"; 28,502★, MIT ([Guide](https://repomix.com/guide), [repo](https://github.com/yamadashy/repomix)). Gitingest: "Turn any Git repository into a simple text digest… PAT is never stored in the backend" ([gitingest.com](https://gitingest.com/)). / *Summary:* Whole-repo→single-file packing is table stakes; limits are server-side processing and context size. / *Confidence:* High.

**5.2 AGENTS.md.** / *Rationale:* repo-context convention. / *Evidence:* "the de facto open standard for guiding AI coding assistants, now adopted by over 20,000 repositories and formalized in August 2025 through collaboration between OpenAI, Google, Cursor, Factory, and Sourcegraph" ([gist](https://gist.github.com/mvandermeulen/98d63c53ccb0b161971fd479904952f5)); "Closest file wins — supports nested files for monorepos" ([ap0110](https://ap0110.org/docs/agents-md), [Meta](https://wearables.developer.meta.com/docs/develop/dat/ai-assisted-agents-md)). / *Summary:* Standardised Aug 2025, Linux Foundation-governed; static file, no runtime sync. / *Confidence:* High (adoption number Medium).

**5.3 MCP.** / *Rationale:* agent↔context transport. / *Evidence:* "we're donating the Model Context Protocol (MCP) to the Agentic AI Foundation (AAIF)… co-founded by Anthropic, Block and OpenAI, with support from Google, Microsoft, AWS, **Cloudflare**, and Bloomberg" (Dec 9 2025), "more than 10,000" servers ([Anthropic](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)); "over 18,000 community-indexed MCP servers" by 2026 ([SolidAITech](https://www.solidaitech.com/2026/06/agentic-ai.html)). / *Summary:* Vendor-neutral since Dec 2025 with Cloudflare as founding supporter — de-risks an MCP-native build. / *Confidence:* High.

**5.4 Spec-driven development.** / *Rationale:* decision-log/spec-as-source workflow. / *Evidence:* Spec Kit "an open source toolkit for building high-quality software with any AI coding agent" — **104,718★, MIT** ([repo](https://github.com/github/spec-kit)). Maturity tiers "spec-first, spec-anchored, and spec-as-source," with "tooling had not yet caught up with the ambition" ([danielvaughan](https://codex.danielvaughan.com/2026/04/27/spec-driven-development-tooling-codex-cli-spec-kit-cc-sdd-codex-spec/)). Kiro "turns a feature description into maintained requirements, design, and task documents" ([specdriven](https://specdriven.com/landscape/kiro)); OpenSpec is change-centric, MIT ([specdriven](https://specdriven.com/landscape/openspec)). Thoughtworks Radar: **Assess** ([Thoughtworks](https://www.thoughtworks.com/en-us/radar/languages-and-frameworks/github-spec-kit)). / *Summary:* Mainstream; useful ladder; no shared spec format across tools. / *Confidence:* High.

**5.5 Provenance / attribution.** / *Rationale:* AI authorship as first-class git data. / *Evidence:* "On commit, Git AI stores line-level attribution data in **Git Notes**, linking each line of AI-generated code to the agent, model, and session"; "survives rebases, merges, stash/pops, squashes, resets, cherry-picks"; **"Git AI is now part of OpenAI"** ([git-ai](https://github.com/git-ai-project/git-ai), [usegitai](https://usegitai.com/), [spec v3.0.0](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md), [blog](https://usegitai.com/blog/message-level-attribution)). / *Summary:* Line/session-level attribution in Git Notes (no history rewrite), rebase-safe, versioned spec — reusable provenance substrate. / *Confidence:* High.

**5.6 Code intelligence.** / *Evidence:* Sourcegraph "indexes all of your repositories… empowering agents with full context" + **Agentic Batch Changes** ([site](https://sourcegraph.com/)); Deep Search "shows you the sources behind every answer" ([blog](https://sourcegraph.com/blog/deep-search)). DeepWiki "indexes repos and produces wikis with architecture diagrams, links to sources," exposing a **remote no-auth MCP server with 3 tools** ([Cognition](https://cognition.com/blog/deepwiki), [MCP](https://github.com/mcp/cognitionai/deepwiki)). / *Summary:* Intelligence has moved to agent-consumable context layers; DeepWiki's 3-tool surface is a compact stealable interface. / *Confidence:* High.

**5.7 Structural AST tooling.** / *Evidence:* ast-grep "AST based tool to search code by pattern… uses tree-sitter," 15.8k★ MIT ([repo](https://github.com/ast-grep/ast-grep)); Semgrep "30+ languages… semantic grep," 16,816★ ([repo](https://github.com/semgrep/semgrep)). Moderne: "OpenRewrite plugins run on one repository at a time. Moderne pre-computes **LSTs** across every repo… then runs recipes against them **in parallel**… coordinated pull requests and full audit trail" ([moderne.ai](https://moderne.ai/solutions/scale-openrewrite)). Difftastic: "**AST merging is a hard problem that difftastic does not address**" ([repo](https://github.com/wilfred/difftastic)). / *Summary:* Clean split of search / multi-repo transform / structural diff; AST *merge* is explicitly unsolved. / *Confidence:* High.

**5.8 Context-layer products (Unblocked).** / *Evidence:* "reconciles conflicts between sources, enforces the access controls you already set in each tool, and delivers **ranked, compressed context** to any MCP-compatible" client; $19–$29/user/mo; ingestion rebuilt on **Temporal durable execution** ([pricing](https://getunblocked.com/pricing), [Temporal](https://temporal.io/blog/why-a-context-engine-needs-durable-execution-how-unblocked-rebuilt-its-ingestion-backbone-on-temporal)). / *Summary:* Commercial context layer = rank+compress+ACL-gate; ingestion is a durable-execution problem. / *Confidence:* Medium (vendor claims).

#### Area 6 — Visual & Spatial Review UX + Collaborative Canvas & Sync

**6.1 Whiteboard (dev.fast) — direct prior art.** / *Evidence:* "a canvas that your existing agent… draws on through an MCP server, so that a large agent-written change arrives as a structured 'whiteboard session' instead of a 40-file diff." Pillars: diagrams **linked to code** (pinned line ranges), a Rust **AST-aware semantic diff**, and a **decision log** ("records which decisions were your requirements and which the agent made alone"). Writes use "an **authoring lease per review**, so two agents cannot silently overwrite each other, and every saved version keeps the command inputs as receipts." Limits: single-repo, ~736 MB build, snapshot-only sharing, no editing. MIT, 1,589★; Show HN 412 pts ([review](https://andrew.ooo/posts/whiteboard-review-yc-open-source-design-canvas-ai-coding-agents/), [repo](https://github.com/devdotfast/whiteboard)). / *Summary:* Validates the visual-review premise and publishes a copyable concurrency interface; its snapshot/single-repo limits are the gap to fill. / *Confidence:* High.

**6.2 Visual-review incumbents.** / *Evidence:* CodeSee "Review Maps create diagrams from pull requests" ([docs](https://docs.codesee.io/docs/getting-started)); AppMap "**Runtime evidence** for AI-assisted development… calls, queries, exceptions, side effects" ([appmap.io](https://appmap.io/)); Swimm "Make legacy applications understandable" ([VS](https://marketplace.visualstudio.com/items?itemName=Swimm.swimm)). / *Summary:* Structural maps / runtime traces / living docs — all pre-agent, none with a concurrency story. / *Confidence:* Medium (stale pages).

**6.3 Diagrams-in-PR.** / *Evidence:* "ZenUML is JavaScript-based… requires no server… to help documentation catch up with development" ([zenuml-core](https://github.com/mermaid-js/zenuml-core)); Mermaid renders ZenUML sequence diagrams ([mermaid.js.org](https://mermaid.js.org/syntax/zenuml.html)); ZenUML ships "a visual modeling plugin for Codex and Claude Code" ([ZenUml/diagram](https://github.com/ZenUml/diagram)). Whiteboard contrasts: "Mermaid in Markdown: static diagrams… not linked to code." / *Summary:* Text diagrams dominate docs but fail review because they are not resolvable to code; trend is agent-authored, code-linked diagrams. / *Confidence:* Medium.

**6.4 Canvas rendering.** / *Evidence:* React Flow "xyflow **Pro License**… perpetual… non-transferable" ([xyflow](https://xyflow.com/pro-license)); tldraw 50.7k★, license "**adapted from the Scratch source code license**… preserve the 'Made with tldraw' watermark… purchase a business license," "Multiplayer sync included" ([pricing](https://tldraw.dev/pricing), [LICENSE](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)); PixiJS "**WebGL & WebGPU Renderers**… fastest, most lightweight 2D library" ([docs](https://pixijs.io/docs/), [renderers](https://pixijs.com/8.x/guides/components/renderers)). / *Summary:* Node-graph / infinite-canvas / hand-drawn / GPU-2D all covered; licensing is the real decision — only tldraw carries watermark/paid-production risk. / *Confidence:* High.

**6.5 CRDT engines.** / *Evidence:* Yjs "network agnostic (p2p!)… scales well with an unlimited number of users" ([Yjs](https://unpkg.com/yjs%4013.4.11/docs/index.html)); "Automerge 3 cut document size by roughly **10x** thanks to column-oriented storage" ([youngju](https://www.youngju.dev/blog/culture/2026-05-15-crdt-local-first-engines-2026-yjs-automerge-loro-replicache-liveblocks-deep-dive.en)); Loro "**Movable Tree as a first-class primitive**… implemented directly on top of Yjs, concurrent moves can produce cycles or orphaned nodes. Loro guarantees it at the algorithm level"; "WASM binary ~970KB gzipped," few adapters, no canonical server ([loro.dev](https://www.loro.dev/), [docs](https://www.loro.dev/docs)). / *Summary:* Yjs = text standard; Automerge 3 = JSON-tree with 10× smaller docs; Loro = movable-tree/Fugue correctness, thin ecosystem. For code-node canvases, tree/map models beat Yjs's text model. / *Confidence:* High.

**6.6 Hosted sync.** / *Evidence:* Liveblocks "Free… hard included cap," plans Free→Enterprise, meters "collaboration minutes, comments, storage, notifications," ships "**AI Copilots** (AI editors that join the room like collaborators)" ([pricing](https://liveblocks.io/pricing), [plans](https://liveblocks.io/docs/pricing/plans)). "**Cloudflare acquires PartyKit**" (Apr 2024); "deploy to your own Cloudflare account and pay for the resources you use"; runtime "built on top of the **workerd runtime by Cloudflare**"; Yjs via `y-partykit` ([Cloudflare](https://blog.cloudflare.com/cloudflare-acquires-partykit), [PartyKit](https://www.partykit.io/), [docs](https://docs.partykit.io/how-partykit-works)). / *Summary:* Liveblocks = fastest/polished + metered; **PartyKit is already Cloudflare** (DO-native, cheapest, Yjs-integrated) — the natural substrate. / *Confidence:* High.

**6.7 Local-first DBs.** / *Evidence:* Jazz "local-first relational database with row-level permissions, real-time sync… no separate API layer"; "uses the same Rust database engine core everywhere" ([docs](https://jazz.tools/docs), [site](https://jazz.tools/)). ElectricSQL syncs Postgres→SQLite in "**Shape** — a SQL where clause selects a partial dataset," written in Elixir ([Electric](https://electric-sql.com/docs/reference/alternatives), [youngju](https://www.youngju.dev/blog/culture/2026-05-15-crdt-local-first-engines-2026-yjs-automerge-loro-replicache-liveblocks-deep-dive.en)); Convex "database plus functions plus sync, bundled… Series B 2024"; InstantDB "reactive… optimistic… Series A 2025" ([youngju](https://www.youngju.dev/blog/culture/2026-05-16-realtime-collaboration-engines-sync-2026-liveblocks-partykit-yjs-automerge-electricsql-replicache-zero-jazz-tools-deep-dive.en)). / *Summary:* Jazz's client+server-same-engine + row-level permissions, and ElectricSQL's SQL-predicate *shape*, are directly reusable for per-file/per-agent ACL-scoped sync. / *Confidence:* Medium.

**6.8 CRDT-for-code precedents.** / *Evidence:* **CodeCRDT** (arXiv 2510.18893, Oct 2025): "enables **lock-free, conflict-free concurrent code generation with strong eventual consistency**… 600 trials… up to **21.1% speedup** on some tasks, up to **39.4% slowdown** on others, and **100% convergence with zero merge failures**… revealing **semantic conflict rates (5–10%)**" ([arXiv](https://arxiv.org/abs/2510.18893)). CoAST: "a real-time collaborative source-code editing system supported by an **abstract syntax tree (AST) CRDT**" ([SCITEPRESS](https://www.scitepress.org/Papers/2022/112788/112788.pdf)). Older: "CRDT solutions are rarely found in working co-editors, while OT solutions remain the choice" ([arXiv](https://arxiv.org/pdf/1810.02137)). / *Summary:* **The key finding:** CRDTs give 100% *character-level* convergence but 5–10% residual *semantic* conflicts; speedups are task-dependent. CRDTs solve transport, never correctness. / *Confidence:* High.

**6.9 Sync pitfalls at scale.** / *Evidence:* "**Awareness flooding**… with 50 people… 25,000 tiny messages per second. Fix: throttling + delta encoding." "**Sync storms**… 500KB Yjs document × 50 joiners = 25MB. Fix: rate limiting + **CDN caching** (initial sync from a static snapshot)." "**Conflict spikes**… soft lock + optimistic writes." ([youngju](https://www.youngju.dev/blog/culture/2026-05-16-realtime-collaboration-engines-sync-2026-liveblocks-partykit-yjs-automerge-electricsql-replicache-zero-jazz-tools-deep-dive.en)). / *Summary:* Three named failure modes with known fixes; for thousands of agents, snapshotting + soft locks beat CRDT cleverness. / *Confidence:* Medium.

### 4. Synthesis & Confidence

#### Area 5
Agent context today stacks three loosely-coupled layers: **static intent** (AGENTS.md, spec-driven artifacts), **queryable code intelligence** (Sourcegraph/DeepWiki MCP servers, AST tooling) and **provenance** (Git Notes attribution). Each is mature and standardising fast — AGENTS.md under the Linux Foundation, MCP donated to AAIF with Cloudflare a founding supporter, Git AI's attribution spec at v3.0.0 (now inside OpenAI). But none carries *runtime, mutable, concurrent* context: AGENTS.md is a file, spec artifacts are snapshots, Git Notes are written at commit time. A multi-agent platform must add a live coordination layer on top.

The ecosystem's own acknowledged gaps are the competition's opportunity: Difftastic's maintainer states "AST merging is a hard problem that difftastic does not address"; SDD analysts warn "the tooling had not yet caught up with the ambition"; CodeSee/Swimm/AppMap all predate agents; Git AI attributes *finished* commits, not in-flight concurrent edits. Context ingestion is itself a durable-execution problem (Unblocked rebuilt on Temporal).

**Conclusions (Area 5):** (1) Whole-repo packing (Repomix 28.5k★) is table stakes but insufficient alone. *(High; 4 sources.)* (2) AGENTS.md (~20k repos) + MCP (10k→18k servers; Linux Foundation) are the standards to be natively compatible with. *(High; 5.)* (3) SDD is mainstream (spec-kit 104.7k★) with a usable spec-first→anchored→as-source ladder; no shared format. *(High; 5.)* (4) Git-Notes line-level attribution is the mature, rebase-safe provenance precedent. *(High; 3.)* (5) AST-level merge remains unsolved. *(High; 2.)* (6) No standard exists for concurrent-agent context sync — the platform's whitespace. *(High; inference.)*

**Borrow for a multi-agent platform on Workers + Artifacts:** adopt **MCP** as the tool surface (Cloudflare is a founding AAIF supporter) and read AGENTS.md/spec artifacts as inputs, but keep live coordination state as MCP resources, not files; implement **Git-Notes-style per-line attribution** keyed to `agent_session_id`+model+prompt; use **tree-sitter/LST structural indexing** and treat AST-merge as a differentiator.

#### Area 6

The visual-review thesis is already validated by Whiteboard, which independently arrived at nearly the exact primitive set needed: agent-drawn code-linked diagrams, an AST-aware semantic diff, a decision log, and — critically — **an authoring lease per review with command receipts** so concurrent writers cannot clobber each other. That lease/receipt mechanism is a coordination primitive, not a UI feature. Whiteboard's admitted limits (snapshot-only sharing, single-repo, no editing, heavy local app) are the gap a Cloudflare-hosted, real-time, multi-repo platform fills.

The sync decision is unusually clear. **PartyKit is already Cloudflare** (2024), runs on workerd/Durable Objects, and integrates Yjs — the native, cheapest path. **Liveblocks** is fastest to a polished feature set (presence/comments/notifications/AI copilots) but adds MAU metering and a vendor. For engines: Yjs is the text default, but a *canvas of code nodes with movable parents and threads* is a JSON/block-tree problem where **Automerge 3 (10× smaller) or Loro (movable trees, Fugue)** fits better. Licensing must be checked: tldraw's SDK carries a watermark unless paid; React Flow has a separate Pro license; Excalidraw and PixiJS are MIT. The CodeCRDT result calibrates the whole design: CRDTs deliver 100% convergence with zero merge failures yet 5–10% residual semantic conflicts and task-dependent speedups (some tasks *slow down* 39%) — so human review and a decision log are load-bearing, not decorative.

**Conclusions (Area 6):** (1) Whiteboard is direct prior art; adopt+extend its lease/receipt/decision-log model to real-time multi-repo. *(High; 2.)* (2) CodeSee/AppMap/Swimm are pre-agent and leave the concurrency niche open. *(Medium; 3.)* (3) PartyKit-on-Cloudflare is lowest-friction sync; Liveblocks is fast-but-metered. *(High; 4.)* (4) Yjs for text; Automerge 3/Loro for tree-structured canvas state. *(High; 4.)* (5) CRDTs guarantee convergence, not correctness → human review + decision logs essential. *(High; 2.)* (6) **Conflict:** Liveblocks' free tier stated as both "100 MAU" and "10k MAU" in the same deep-dive; treat pricing as unverified. PartyKit follows Workers pricing ($0.30/1M req; $0.50/M GB-s DO). *(Medium.)*

**Borrow for a multi-agent platform on Workers + Artifacts:** ship **per-review authoring leases + immutable command receipts** as the conflict backbone, with state in **Durable Object rooms** (PartyKit pattern) rather than one global doc; use **partial/shape-based sync** (ElectricSQL's predicate *shape*, Jazz's row-level permissions) so each agent replicates only permitted files; mitigate scale with **throttled+delta presence**, **snapshot-from-R2/CDN initial sync**, and **soft locks**; converge *structure + annotations*, never raw code text.

### 5. Sources Consulted

| # | Title | URL | Type | Date | Scraped? | Tier |
|---|---|---|---|---|---|---|
| 1 | Repomix Guide | repomix.com/guide | Docs | 2026 | No | 70 |
| 2 | yamadashy/repomix | github.com/yamadashy/repomix | Repo | 2026 | No | 70 |
| 3 | Gitingest | gitingest.com | Site | 2026 | No | 50 |
| 4 | Repoprep — Gitingest alt | repoprep.com/gitingest-alternative | Marketing | 2026 | No | 40 |
| 5 | AGENTS.md | agents.md/index | Spec | 2025 | No | 85 |
| 6 | AGENTS.md best practices | gist.github.com/mvandermeulen/… | Gist | 2025 | No | 50 |
| 7 | AGENTS.md — AP0110 | ap0110.org/docs/agents-md | Wiki | 2026 | No | 55 |
| 8 | Meta AGENTS.md | wearables.developer.meta.com/… | Docs | 2026-05 | No | 80 |
| 9 | Anthropic — donating MCP/AAIF | anthropic.com/news/donating-… | Announcement | 2025-12-09 | No | 90 |
| 10 | MCP landscape & threats | dl.acm.org/doi/10.1145/3796519 | Paper | 2026 | No | 95 |
| 11 | SolidAITech — MCP stats | solidaitech.com/2026/06/agentic-ai.html | Blog | 2026-06 | No | 40 |
| 12 | github/spec-kit | github.com/github/spec-kit | Repo | 2025-08 | No | 85 |
| 13 | Spec Kit docs | github.github.io/spec-kit | Docs | 2026 | No | 85 |
| 14 | Spec Kit June newsletter | github.com/github/spec-kit/newsletters/2026-June.md | Repo doc | 2026-06 | No | 80 |
| 15 | Spec-Driven — Kiro | specdriven.com/landscape/kiro | Review | 2026-08 | No | 60 |
| 16 | Spec-Driven — Spec Kit | specdriven.com/landscape/github-spec-kit | Review | 2026-08 | No | 60 |
| 17 | Spec-Driven — OpenSpec | specdriven.com/landscape/openspec | Review | 2026-08 | No | 60 |
| 18 | Kiro Specs docs | kiro.dev/docs/specs.md | Docs | 2026 | No | 80 |
| 19 | Tessl — AWS backs Kiro | tessl.io/blog/…kiro | Blog | 2026 | No | 55 |
| 20 | Tessl SDD tile | github.com/tesslio/spec-driven-development-tile | Repo | 2025-12 | No | 60 |
| 21 | Thoughtworks Radar — Spec Kit | thoughtworks.com/…/github-spec-kit | Analyst | 2026-04 | No | 80 |
| 22 | danielvaughan — SDD tooling | codex.danielvaughan.com/2026/04/27/… | Blog | 2026-04 | No | 45 |
| 23 | git-ai-project/git-ai | github.com/git-ai-project/git-ai | Repo | 2026 | No | 80 |
| 24 | Git AI — how it works | usegitai.com/docs/get-started/how-git-ai-works | Docs | 2026 | No | 70 |
| 25 | Git AI — message-level attribution | usegitai.com/blog/message-level-attribution | Blog | 2026-05 | No | 70 |
| 26 | Git AI standard v3.0.0 | github.com/git-ai-project/git-ai/specs/… | Spec | 2026 | No | 85 |
| 27 | agentblame | github.com/mesa-dot-dev/agentblame | Repo | 2026-01 | No | 55 |
| 28 | Sourcegraph | sourcegraph.com | Marketing | 2026 | No | 65 |
| 29 | Sourcegraph Deep Search | sourcegraph.com/blog/deep-search | Blog | 2026-05 | No | 70 |
| 30 | Cognition — DeepWiki | cognition.com/blog/deepwiki | Blog | 2025-05 | No | 75 |
| 31 | DeepWiki MCP | github.com/mcp/cognitionai/deepwiki | Repo | 2026 | No | 70 |
| 32 | Devin DeepWiki docs | docs.devin.ai/work-with-devin/deepwiki | Docs | 2026 | No | 80 |
| 33 | ast-grep | github.com/ast-grep/ast-grep | Repo | 2026 | No | 75 |
| 34 | ast-grep comparison | ast-grep.github.io/advanced/tool-comparison.html | Docs | 2026 | No | 70 |
| 35 | semgrep | github.com/semgrep/semgrep | Repo | 2026 | No | 80 |
| 36 | openrewrite | github.com/openrewrite/rewrite | Repo | 2026 | No | 75 |
| 37 | Moderne — scale OpenRewrite | moderne.ai/solutions/scale-openrewrite | Marketing | 2026 | No | 60 |
| 38 | Difftastic | difftastic.com | Site | 2026 | No | 65 |
| 39 | Wilfred/difftastic | github.com/wilfred/difftastic | Repo | 2026 | No | 80 |
| 40 | Unblocked pricing | getunblocked.com/pricing | Pricing | 2026 | No | 60 |
| 41 | Unblocked × Temporal | temporal.io/blog/why-a-context-engine-… | Blog | 2026 | No | 65 |
| 42 | dev.fast Whiteboard | dev.fast | Product | 2026 | No | 60 |
| 43 | devdotfast/whiteboard | github.com/devdotfast/whiteboard | Repo | 2026-08 | No | 75 |
| 44 | Whiteboard review | andrew.ooo/posts/whiteboard-review-… | Blog | 2026-09-27 | **Yes** | 55 |
| 45 | Oflight — Whiteboard | oflight.co.jp/en/columns/… | Blog | 2026-09 | No | 40 |
| 46 | CodeSee docs | docs.codesee.io/docs/getting-started | Docs | 2025-05 | No | 70 |
| 47 | CodeSee Review Maps | marketplace.visualstudio.com/…codesee.maps | Marketplace | 2026 | No | 55 |
| 48 | AppMap | appmap.io | Product | 2026 | No | 65 |
| 49 | Swimm | marketplace.visualstudio.com/…Swimm.swimm | Marketplace | 2026 | No | 50 |
| 50 | Mermaid ZenUML | mermaid.js.org/syntax/zenuml.html | Docs | 2026 | No | 80 |
| 51 | zenuml-core | github.com/mermaid-js/zenuml-core | Repo | 2026 | No | 65 |
| 52 | ZenUml/diagram plugin | github.com/ZenUml/diagram | Repo | 2026-05 | No | 55 |
| 53 | tldraw pricing | tldraw.dev/pricing | Pricing | 2026 | No | 70 |
| 54 | tldraw sync | tldraw.dev/blog/announcing-tldraw-sync | Blog | 2024-08 | No | 75 |
| 55 | tldraw LICENSE | github.com/tldraw/tldraw/blob/main/LICENSE.md | License | 2026 | No | 85 |
| 56 | @tldraw/sync | npmjs.com/package/@tldraw/sync | Package | 2026 | No | 70 |
| 57 | xyflow Pro License | xyflow.com/pro-license | Legal | 2026-08 | No | 75 |
| 58 | PixiJS docs | pixijs.io/docs | Docs | 2026 | No | 75 |
| 59 | PixiJS renderers | pixijs.com/8.x/guides/components/renderers | Docs | 2026 | No | 75 |
| 60 | Liveblocks pricing | liveblocks.io/pricing | Pricing | 2026 | No | 65 |
| 61 | Liveblocks plans | liveblocks.io/docs/pricing/plans | Docs | 2026 | No | 65 |
| 62 | PartyKit | partykit.io | Product | 2026 | No | 65 |
| 63 | Cloudflare acquires PartyKit | blog.cloudflare.com/cloudflare-acquires-partykit | Blog | 2024-04 | No | 90 |
| 64 | PartyKit joining Cloudflare | blog.partykit.io/posts/partykit-is-joining-cloudflare | Blog | 2024-04 | No | 75 |
| 65 | PartyKit how it works | docs.partykit.io/how-partykit-works | Docs | 2026 | No | 70 |
| 66 | Jazz | jazz.tools | Product | 2026 | No | 60 |
| 67 | Jazz local-first model | jazz.tools/docs/concepts/local-first-data-model | Docs | 2026 | No | 65 |
| 68 | Jazz "What is Jazz" | jazz.tools/blog/what-is-jazz | Blog | 2026-04 | No | 65 |
| 69 | garden-co/jazz | github.com/garden-co/jazz | Repo | 2026 | No | 55 |
| 70 | ElectricSQL alternatives | electric-sql.com/docs/reference/alternatives | Docs | 2026 | No | 70 |
| 71 | youngju — CRDT/local-first 2026 | youngju.dev/blog/culture/2026-05-15-… | Blog | 2026-05-15 | **Yes** | 50 |
| 72 | youngju — realtime engines 2026 | youngju.dev/blog/culture/2026-05-16-… | Blog | 2026-05-16 | **Yes** | 50 |
| 73 | secsync benchmarks | secsync.com/docs/benchmarks | Docs | 2026 | No | 55 |
| 74 | Loro performance | loro.dev/docs/performance | Docs | 2026 | No | 65 |
| 75 | dmonad/crdt-benchmarks | github.com/dmonad/crdt-benchmarks | Repo | 2026 | No | 70 |
| 76 | CodeCRDT (Pugachev) | arxiv.org/abs/2510.18893 | Paper | 2025-10-18 | **Yes** | 95 |
| 77 | CoAST — CRDT for AST | scitepress.org/Papers/2022/112788/112788.pdf | Paper | 2022 | No | 85 |
| 78 | OT vs CRDT for co-editors | arxiv.org/pdf/1810.02137 | Paper | 2018–19 | No | 90 |

Discovery-only/off-topic (SEC filings, PitchBook, unrelated Reddit/Amazon, Yjs-mirror pages): excluded.

### 6. Gaps, Uncertainties & Inaccessible Sources

- **Liveblocks pricing contradiction:** the same author says "Free up to 100 MAU" and "Free up to 10k MAU"; Liveblocks' own pages omit the free cap. Verify before quoting.
- **Adoption numbers are single-source** (AGENTS.md ~20k repos; MCP 10k→18k servers; Repomix 28.5k★) — directional, not audited.
- **Whiteboard's decision-log capture is "off by default" and experimental** — provenance is aspirational.
- **DeepWiki index scale** appeared truncated; **D2** and **Convex/InstantDB/Jazz tier specifics** not captured.
- **No source solves concurrent *semantic* code merge**; CodeCRDT reports residual 5–10% semantic conflicts.
- **Tool access:** firecrawl_search returned HTTP 400 for `limit`/`highlights`; `{query}`-only worked.

### 7. Tool Quick-Reference

| Tool | Category | Standout features | Pricing (entry→enterprise) | Segment | Stack/architecture | Src |
|---|---|---|---|---|---|---|
| **Repomix** | Context packaging | Whole-repo→single XML/MD/JSON, token counts, split-output, gitignore-aware, MCP | Free (MIT) | Individual→team | TS/Node CLI | 1,2 |
| **Gitingest** | Context packaging | `hub`→`ingest` URL swap, browser ext, PAT never stored | Free | Individual | Python | 3 |
| **AGENTS.md** | Standard | Repo-root instructions; nested "closest file wins" | Free spec | All | Markdown; AAIF/LF | 5,7,8 |
| **MCP** | Standard | Universal agent↔tool protocol; donated to AAIF | Free spec | All | JSON-RPC; Cloudflare supporter | 9 |
| **Spec Kit** | Spec-driven | spec→plan→tasks; 20+ agents; 104.7k★ | Free (MIT) | Ind→enterprise | Markdown + CLI | 12,13 |
| **Kiro (AWS)** | Spec-driven IDE | specs + hooks; req/design/tasks tracking | Free tier→paid | Ind→enterprise | Agentic IDE + CLI | 18 |
| **OpenSpec** | Spec-driven | Change-centric, MIT | Free (MIT) | Teams | Fission AI | 17 |
| **Tessl** | Spec-driven | Spec/tile registry; SDD tile | Free→paid | Teams | Tiles/specs | 19,20 |
| **Git AI** | Provenance | Line-level attribution in Git Notes; rebase-safe; now part of OpenAI | Free CLI | Teams→ent | Git ext; spec v3.0.0 | 23–26 |
| **agentblame** | Provenance | AI-vs-human line tracking, Apache-2.0 | Free OSS | Individual | — | 27 |
| **Sourcegraph** | Code intelligence | Full-repo index + Deep Search + Agentic Batch Changes; MCP | Free→enterprise | Enterprise | Fleet/executors | 28,29 |
| **DeepWiki** | Code intelligence | Auto repo wikis + 3-tool MCP | Free; paid via Devin | OSS→ent | Devin indexing | 30–32 |
| **ast-grep** | Structural search | AST (tree-sitter) search/rewrite, Rust, 15.8k★ | Free (MIT) | Devs | Rust + tree-sitter | 33,34 |
| **Semgrep** | Static analysis | Semantic patterns, 30+ langs, 16.8k★ | Free OSS→paid | Devs→ent | OCaml + tree-sitter | 35 |
| **OpenRewrite/Moderne** | Auto-refactor | LST multi-repo parallel recipes + coordinated PRs + audit trail | Free (Apache)→ent | Enterprise | Java LST; recipe DSL | 36,37 |
| **Difftastic** | Structural diff | tree-sitter syntax diff; **no AST merge** | Free (MIT) | Devs | Rust + tree-sitter | 38,39 |
| **Unblocked** | Context layer | Code+chat+docs+prod context; ranked/compressed; MCP; SOC2 | $19→$29/user/mo | Teams→ent | Temporal ingestion | 40,41 |
| **Whiteboard (dev.fast)** | Visual review canvas | Agent-drawn code-linked diagrams, Rust semantic diff, decision log, authoring lease | Free local (MIT); hosted TBD | Tech leads | Electron/Code OSS + Rust WASM | 43,44 |
| **CodeSee** | Visual review | Auto maps; Review Maps from PRs | Free beta→paid | Enterprise | Multi-lang maps | 46,47 |
| **AppMap** | Visual review | Runtime-execution evidence | Free→paid | Devs | Runtime tracing | 48 |
| **Swimm** | Visual review | Living docs tied to code | Free→ent | Enterprise | VS Code ext | 49 |
| **Mermaid/D2/ZenUML** | Diagrams-in-PR | Text diagrams; ZenUML has Codex/Claude plugin | Free OSS | All | JS renderers | 50–52 |
| **React Flow (@xyflow)** | Canvas | Node-graph SDK; MIT core + Pro license | Free→Pro | Devs→teams | React | 57 |
| **tldraw** | Canvas | Infinite-canvas SDK + sync; 50.7k★ | Free w/ watermark→paid | Devs→teams | React; custom→Yjs | 53–56 |
| **Excalidraw** | Canvas | Hand-drawn, MIT, Yjs room server | Free (MIT) | All | React + Yjs | 71,72 |
| **PixiJS** | Canvas | WebGL/WebGPU 2D, fastest | Free (MIT) | Devs | WebGPU/WebGL | 58,59 |
| **Yjs** | CRDT | De-facto standard; rich adapters; p2p; offline | Free (MIT) | All | YATA | 71 |
| **Automerge 3** | CRDT | JSON-tree generalist; **~10× smaller** docs; strong TS | Free (MIT) | Devs | Rust; automerge-repo | 71 |
| **Loro 1.0** | CRDT | Movable-tree + Fugue; rich text; time travel; ~970KB WASM | Free (MIT) | Devs | Rust→WASM/NAPI | 71,74 |
| **Liveblocks** | Sync SaaS | Presence/comments/notifications/AI copilots | Free (capped)→metered tiers | Teams→ent | Managed Yjs | 60,61 |
| **PartyKit** | Sync SaaS | **Owned by Cloudflare**; DO rooms; `y-partykit` | Free→Workers usage ($0.30/1M req; $0.50/M GB-s) | Devs→teams | workerd/Durable Objects | 62–65 |
| **tldraw sync** | Sync SaaS | Canvas-specific realtime sync | Incl. w/ SDK license | tldraw users | WebSocket | 54,56 |
| **Jazz** | Local-first DB | Relational + row-level permissions; same Rust core client/server | Free→Cloud paid | Devs→teams | Rust→WASM/native | 66–69 |
| **Convex** | Local-first/backend | DB+functions+sync bundled; reactive | Free tier→paid | Teams | Series B 2024 | 72 |
| **InstantDB** | Local-first DB | Reactive queries; optimistic tx | Free tier→paid | Devs | Series A 2025 | 72 |
| **ElectricSQL** | Sync engine | Postgres→SQLite "**shapes**" by SQL predicate | Free OSS→cloud | Teams | Elixir; logical replication | 70,71 |
| **CodeCRDT** | Research | CRDT multi-agent codegen: 100% convergence, 5–10% semantic conflicts | N/A | Researchers | CRDT + LLM agents | 76 |
| **CoAST** | Research | AST-CRDT for collaborative source editing | N/A | Researchers | AST CRDT | 77 |
