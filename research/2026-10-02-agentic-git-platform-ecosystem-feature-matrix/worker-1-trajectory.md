# Trajectory Report: Worker 1

**Areas:** (1) AI Code Review & PR Automation SaaS; (2) Stacked Diffs, Merge Queues & Next-Gen Git Workflows
**Date:** 2026-10-02 · **Source count:** 69 catalogued, 22 scraped

---

## 1. Solution Planning — decomposition, strategy, expected vs actual

**Decomposition.** Area 1 split four ways: (a) codebase-aware LLM reviewers (CodeRabbit, Greptile, Macroscope); (b) enforcement/review tools (Codacy, Qodo, Sourcery, Kodus, Reviewpad, Ellipsis); (c) host-native reviewers (Cursor Bugbot, GitHub Copilot, Graphite AI); (d) independent evidence (benchmarks, arXiv study, security exploit). Area 2 split into stacked-diff clients (Graphite, Sapling, ghstack, git-branchless, Jujutsu, GitButler), merge-queue servers (Trunk, Aviator, Mergify, Bors-NG, Graphite), review forge (Gerrit), and hyperscale mechanics (Meta Sapling, Google Piper/Critique).

**Strategy.** firecrawl search + scrape. Several vendor pages are SPA shells whose search snippets held the substance, so snippets were used as evidence and flagged. Rival-authored comparison pages were paired (Macroscope-vs-Greptile with Greptile docs; Mergify's matrix with Trunk docs and Aviator's Graphite page) to cancel marketing bias.

**Expected vs actual.** Expected 10–12 cycles; ran 12. Pricing was messier than expected — models differ by cadence and meter (seat/credit/KB/file), and CodeRabbit and Qodo each repackaged within 12 months, so every price carries its reading date. Area 1 yielded stronger independent evidence than expected; Area 2's hyperscale side yielded older, thinner primary material.

---

## 2. Methods & Pivots

| Cycle | Query | Tool | Results | Scraped | Pivot Reason |
|---|---|---|---|---|---|
| 1 | "best AI code review tools 2026 comparison CodeRabbit Greptile Macroscope" | search | 10 | Codacy 14-tool; Qodex 10-tool | Vendor SERP → go to vendors' own docs |
| 2 | "CodeRabbit vs Greptile vs Macroscope pricing"; "Greptile codebase indexing architecture" | search ×2 | 16 | Greptile graph-context docs | Need architecture not price |
| 3 | "Kodus Reviewpad Ellipsis Sourcery comparison pricing" | search | 8 | Sourcery-vs-Ellipsis | Sparse → per-tool follow-ups |
| 4 | "CodeRabbit review HN criticism"; "Graphite Diamond AI reviewer pricing" | search ×2 | 16 | arXiv 2607.03316 | Found independent study |
| 5 | "stacked diffs workflow 2026"; "merge queue Trunk Aviator Mergify" | search ×2 | 16 | Macroscope-vs-Greptile; Mergify matrix | Crossed into Area 2 |
| 6 | "Aviator/Graphite pricing"; "Google Piper Critique stacked changes at scale" | search ×2 | 16 | Trunk MQ docs; version-control-bench | Queue mechanics + hyperscale |
| 7 | "Reviewpad features"; "Bors-NG"; "Graphite funding" | search ×3 | 18 | — (snippets) | Confirmed acquisition/deprecation |
| 8 | "Ellipsis shut down"; "ghstack Gerrit"; "GitButler vs git-branchless vs jj" | search ×3 | 18 | Aviator-vs-Graphite | Ellipsis alive; pivot to native stacking |
| 9 | "Gerrit stacked changes"; "Trunk pricing"; "stacked PRs criticism HN" | search ×3 | 18 | Aviator pricing | Quantify + criticism |
| 10 | "Kodus pricing"; "CodeRabbit funding valuation" | search ×2 | 12 | Graphite pricing; gh-stack | Funding + native GitHub stacks |
| 11 | "git-branchless branchless workflow" | search | 6 | — (snippets) | Area 2 gap-fill |
| 12 | "Sapling adoption outside Meta criticism" | search | 6 | — (snippets) | Confirmed weak external traction |

---

## 3. Evidence Collection

### Area 1 — AI Code Review & PR Automation SaaS

**F1.1 — Category split into three enforcement tiers.**
*Rationale:* defines table stakes vs differentiators. *Evidence:* "Tier A. Rule and threshold-based enforcement… Codacy, SonarQube, DeepSource, Semgrep, Snyk Code, Qlty… Tier B. LLM-judgment review… CodeRabbit, Greptile, Qodo, Cursor Bugbot, OpenAI Codex… Tier C. Advisory only… GitHub Copilot code review, Claude Code Review, Gemini Code Assist." ([Codacy, 2026-09-21](https://blog.codacy.com/ai-code-review-tools-compared-2026-why-most-cant-safely-block-a-merge-and-what-code-governance-fixes)) *Summary:* only rule/threshold tools reliably fail closed. *Confidence:* High.

**F1.2 — Codebase indexing (graph/AST) is the main non-diff differentiator.**
*Evidence:* Greptile "builds a complete graph of your codebase… Parses every file to extract directories, files, functions, classes, variables… Connects all elements: function calls, imports, dependencies." ([Greptile docs](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context)) Rival account: "Macroscope builds an Abstract Syntax Tree (AST) for every file … using language-specific codewalkers… Greptile … agentic search loop over an indexed code graph." ([Macroscope, 2026-04-09](https://macroscope.com/content/macroscope-vs-greptile-ai-code-review-comparison)) *Summary:* both index; Macroscope claims parser determinism, Greptile exploratory search. *Confidence:* High on architecture; Medium on superiority.

**F1.3 — Pricing forked into three incompatible meters.**
*Evidence:* Greptile Pro "$30 per seat per month including 50 credits per seat and $1 per additional credit"; TREX = 3 credits; Chat +"$20/user/month" ([Macroscope, 2026-04-09](https://macroscope.com/content/macroscope-vs-greptile-ai-code-review-comparison)). Macroscope "$0.05 per KB reviewed (10 KB minimum = $0.50 floor)… historical average $0.95 per review" (same). CodeRabbit Essentials "$24 per developer per month billed annually, or $30 monthly… Continued reviews cost $0.25 per reviewed file" ([Qodex, 2026-09-15](https://qodex.ai/blog/best-ai-code-review-tools)). Qodo "drops per-seat pricing and free tier for a pooled credit model" at $0.012/credit, "$30 pack carries 2,500 credits, an estimated 18 reviews" ([UsagePricing, 2026-06-30](https://www.usagepricing.com/blueprint/activity/qodo-2026-06-30-packaging)). *Summary:* effective per-review cost ~$0.50–$1.67. *Confidence:* High.

**F1.4 — Advisory reviewers do not natively gate merges.**
*Evidence:* Copilot "leaves a 'Comment' review rather than an 'Approve' review, so it does not satisfy a required-approval rule on its own" ([Qodex, 2026-09-15](https://qodex.ai/blog/best-ai-code-review-tools)); CodeRabbit "inconclusive result doesn't block"; "Claude Code Review's check run always completes with a neutral conclusion, even after an internal error or timeout" ([Codacy, 2026-09-21](https://blog.codacy.com/ai-code-review-tools-compared-2026-why-most-cant-safely-block-a-merge-and-what-code-governance-fixes)). *Summary:* default posture is comment-only and can silently pass on error. *Confidence:* High.

**F1.5 — Execution-backed review is the newest differentiator.**
*Evidence:* "Two [tools] run code… Qodex fires live probes against the pull request's preview deployment… Greptile's TREX agent writes and runs tests in a sandbox." Macroscope's Fix It For Me "Creates a new branch… Opens a pull request… Runs your CI pipeline… If CI fails, reads the failure logs and commits another fix attempt." ([Qodex, 2026-09-15](https://qodex.ai/blog/best-ai-code-review-tools); [Macroscope, 2026-04-09](https://macroscope.com/content/macroscope-vs-greptile-ai-code-review-comparison)) *Summary:* runtime validation + closed-loop autofix-with-CI is the frontier. *Confidence:* High for existence, Medium for reliability.

**F1.6 — Benchmarks are vendor-run and contradict each other.**
*Evidence:* Greptile's own 50-bug study: "Greptile 41/82% … Cursor Bugbot 29/58% … GitHub Copilot 27/54% … CodeRabbit 22/44% … Graphite 3/6%" ([Qodex, 2026-09-15](https://qodex.ai/blog/best-ai-code-review-tools)). Macroscope's 118-bug benchmark: "Macroscope 48%, CodeRabbit 46%, Cursor BugBot 42%, Greptile 24%, Graphite Diamond 18%" with "Greptile's access … revoked partway" ([Macroscope, 2026-04-09](https://macroscope.com/content/macroscope-vs-greptile-ai-code-review-comparison)). A third vendor ranks itself first on 122 bugs ([Tenki](https://tenki.cloud/benchmarks/code-reviewer)). *Summary:* each vendor wins its own; only Graphite scores low in all. *Confidence:* High that numbers are unreliable; Low on any absolute recall.

**F1.7 — Independent study: most agentic comments are not acted on.**
*Evidence:* "Rejections were primarily associated with invalid suggestions that were false positives, redundant, or out of scope… agentic reviews tend to focus more on functional concerns than evolvability-related comments, yet they were more likely to be invalid." ([arXiv 2607.03316v2, 2026-07-23](https://arxiv.org/html/2607.03316v2)) *Summary:* developer acceptance is the real bottleneck. *Confidence:* Medium-High.

**F1.8 — Scale is real: CodeRabbit $550M→$1.5B in 11 months.**
*Evidence:* "more than 2 million code reviews a week… raised $143 million … valued at $1.5 billion" ([Reuters, 2026-08-12](https://www.reuters.com/technology/ai-code-review-platform-coderabbit-valued-15-billion-latest-funding-round-2026-08-12)); prior Series B "$60 million … $550 million" ([TechCrunch, 2025-09-16](https://techcrunch.com/2025/09/16/coderabbit-raises-60m-valuing-the-2-year-old-ai-code-review-startup-at-550m/)). *Confidence:* High.

**F1.9 — Review-bot supply-chain risk was demonstrated.**
*Evidence:* "How we exploited CodeRabbit: From simple PR to RCE and write access on 1M repos" (687 points); "CodeRabbit would still review our pull request and post a comment… that it detected a critical security risk, yet the application would happily execute our code." ([HN, 2025-08-19](https://news.ycombinator.com/item?id=44953032)) *Confidence:* High.

**F1.10 — Open-source/self-host is a distinct segment.**
*Evidence:* Kodus "The open source alternative to CodeRabbit… AGPL licensed", "$10 per active developer per month, with token costs billed separately" ([kodus.io](https://kodus.io/); [docs.kodus.io](https://docs.kodus.io/how_to_use/en/pricing)). Reviewpad: "Temporarily Unavailable During Our Transition to Snyk" ([docs.reviewpad.com](https://docs.reviewpad.com/reviewpad-ai); [CBInsights: acquired, $1.1M](https://www.cbinsights.com/company/reviewpad)). *Confidence:* High.

### Area 2 — Stacked Diffs, Merge Queues & Next-Gen Git Workflows

**F2.1 — Merge queues use predictive testing against a projected head.**
*Evidence:* "the queue tests each PR against the head of `main` plus every PR ahead of it — so what merges is what was actually tested, even when ten PRs land in the same hour." ([Trunk docs](https://docs.trunk.io/merge-queue/merge-queue)) *Summary:* correctness = merged SHA equals tested SHA. *Confidence:* High.

**F2.2 — The queue feature checklist.**
*Evidence:* Mergify's matrix scores CI batching, bisect-on-batch-failure, speculative checks, multi-level priorities, monorepo scope-aware batching, flaky detection/quarantine, merge freezes, PR dependencies, merged-SHA-equals-tested-SHA, and CI insights across GitHub MQ/Graphite/Trunk/Aviator/Mergify ([Mergify](https://staging.mergify.com/compare-mergify)); Trunk adds priority merging and direct-merge-to-main ([Trunk](https://docs.trunk.io/merge-queue/merge-queue)). GitHub native has none of these. *Confidence:* High but vendor-authored.

**F2.3 — Monorepo routing keys off the build graph.**
*Evidence:* Aviator "Affected-targets routing for monorepos — Uses your build graph (Bazel, NX, Pants, Turborepo, Gradle)"; "Cross-repo coordination via ChangeSets." ([Aviator vs Graphite](https://www.aviator.co/aviator-vs-graphite)) *Summary:* queues route changes to dedicated lanes by blast radius. *Confidence:* Medium-High.

**F2.4 — Pricing anchors at $20/dev with scale tiers at $40–$50.**
*Evidence:* Aviator "Team $20/dev/mo … Scale $50/dev/mo … Enterprise Custom" ([Aviator](https://www.aviator.co/pricing)); Graphite "Starter $20 … Team $40" ([Graphite](https://graphite.com/pricing)); Trunk free ≤5 committers ([Trunk](https://docs.trunk.io/setup-and-administration/billing)). *Confidence:* High.

**F2.5 — Adoption signals.**
*Evidence:* Graphite "Shopify, Vercel, Snowflake, Duolingo, Figma, Ramp, Replit, X, Cursor"; funding "$72M over 2 funding rounds … Series B of $52M" ([Graphite](https://www.graphite.com/); [Tracxn](https://tracxn.com/d/companies/graphite/__EaYfnzIk42fkU06_bXD25Gaa-Qk3nGiKgt-McAYOaks/funding-and-investors); [blog, 2025-03-18](https://graphite.dev/blog/series-b-diamond-launch)). Trunk: "Brex, Retool, Zillow, Supabase, PostHog, Ramp, Cockroach Labs, Klaviyo" ([Trunk](https://trunk.io/trunk-vs-aviator)). Mergify: "2k+ organizations … merge 75k+ pull requests a month" ([Mergify](https://staging.mergify.com/compare-mergify)). *Confidence:* Medium-High.

**F2.6 — Bors-NG is deprecated.**
*Evidence:* "new features will not be accepted. If you want to implement a workflow like this, use GitHub's built-in merge queue." Repo archived Apr 2024, 1.5k stars, Elixir ([bors-ng README](https://github.com/bors-ng/bors-ng)). *Confidence:* High.

**F2.7 — Stacking is now native to GitHub.**
*Evidence:* "A stack is a series of pull requests … each pull request targets the branch of the pull request below it… Every pull request is evaluated against rules for the base of the stack — typically main" ([GitHub Docs, public preview](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)); `gh stack` CLI is MIT, 1.6k stars, requires `gh` v2+ and ships an AI-agent skill ([github/gh-stack](https://github.com/github/gh-stack)). Sapling: "first-class support for editing and manipulating stacks of commits" ([Sapling docs](https://sapling-scm.com/docs/overview/stacks/)). *Confidence:* High.

**F2.8 — Branchless/virtual-VCS decouple workspaces from branches.**
*Evidence:* jj: "No need for branch names… Whenever you rewrite a commit … all its descendants commits will automatically be rebased on top." ([jj docs](https://docs.jj-vcs.dev/starlight/git-comparison)) git-branchless: "you work in detached HEAD mode… git move … in-memory … snapshots of the working copy … to improve … git undo." ([wiki](https://github.com/arxanas/git-branchless/wiki/Concepts)) GitButler: "several virtual branches at the same time… you can drag each of the changes to a different virtual branch lane and commit and push them independently." ([GitButler docs](https://github.com/gitbutlerapp/docs/blob/master/docs/features/virtual-branches/README.md)) *Confidence:* High.

**F2.9 — Agents are faster on purpose-built VCS primitives (vendor-run).**
*Evidence:* "GitButler passed all 120 runs and was the clear efficiency winner: about 65% faster than plain git with 78% fewer version-control commands… Jujutsu was slower than git overall." Disclosed: "The benchmark is maintained by GitButler, one of the three tools measured." ([version-control-bench, 2026-07](https://github.com/gitbutlerapp/version-control-bench)) *Confidence:* Medium (deterministic grader; authorship conflict).

**F2.10 — Hyperscale: Google Piper/Critique, Meta Sapling, Gerrit.**
*Evidence:* "one billion files, 35 million commits, and tens of thousands of developers… Piper supports file-level access control lists" ([CACM, 2016-06](https://cacm.acm.org/research/why-google-stores-billions-of-lines-of-code-in-a-single-repository)); scale figures "86 TB … 2 Billion lines … 9 million files … 16,000 manual changes a day, 24,000 changes by automated systems" ([VT notes](https://courses.cs.vt.edu/cs3704/spring22/student_presentations/Group-4.pdf)); Sapling "scales to repositories with 10's of millions of files" ([Sapling docs](https://sapling-scm.com/docs/introduction/)); Gerrit "Change-Id line" gives a logical change a stable identity across patchsets ([Gerrit docs](https://gerrit.googlesource.com/gerrit/+/master/Documentation/user-changeid.txt)). *Summary:* big forges solve concurrency with identity, isolation, projection, and policy; Google's automation already outnumbers human changes. *Confidence:* High on published figures (2015–16 vintage).

---

## 4. Synthesis & Confidence

### Area 1
The category matured from "does it comment?" to "can you trust its verdict?" PR summaries, inline comments, chat, IDE/CLI review, guideline files, multi-host support, and no-training postures are now table stakes. Differentiators are (a) verdict semantics — deterministic fail-closed gates (Codacy, SonarQube, DeepSource, Semgrep, Snyk) vs nondeterministic LLM judgment (CodeRabbit, Greptile, Qodo, Cursor Bugbot) vs advisory host bots (Copilot, Claude Code Review, Gemini); (b) context depth — indexed graph/AST (Greptile, Macroscope) beats diff-only on coupled repos; (c) execution — Qodex probes and Greptile TREX convert predictions into reproduced facts.

Pricing is unstable, which is itself a finding: each major tool repriced within 12 months, effective per-PR cost spans ~3×, and sticker comparison is impossible. CodeRabbit's ~3× valuation jump to $1.5B signals a land-grab. The trust story is weakest: a demonstrated RCE through a review bot with write access plus an arXiv study finding most comments false-positive/redundant/out-of-scope mean the stated value is only partly proven. For agent consumers this inverts the value proposition — agents cannot skim, so deterministic per-policy verdicts outperform eloquent prose.

### Area 2
Stacked diffs and merge queues converge on one composite recipe: small atomic changes with explicit parent links; a queue that tests the projected head so merged SHA equals tested SHA; batching + bisect-on-failure; parallel lanes keyed to the build graph; flaky-test quarantine. Trunk, Aviator, Mergify, and Graphite each implement a superset, priced $20–$50/dev/mo. Graphite's edge is stacking-to-queue integration; Aviator's is monorepo affected-target routing plus real self-hosting; Mergify's is batching-with-bisect plus CI/test observability; Trunk's is CI-layer test analytics. But GitHub's native `gh stack` (public preview) and native merge queue are commoditizing exactly these features — the classic platform-squeeze.

Client-side, the notable shift is away from branches: jj (auto-rebasing descendants, operation-log undo), git-branchless (detached-HEAD patch stacks, in-memory rebase, snapshots), and GitButler (multiple virtual branches in one working tree, hunk-level assignment). The GitButler-run benchmark shows agents using such primitives issue ~78% fewer VCS commands and finish ~65% faster than with git, though jj underperformed in that harness. That is the most transferable result for an agent platform.

Hyperscale validates the same ideas: Google's Piper keeps ~1B files in one monorepo with file-level ACLs and trunk-based development, and automation already lands 24k changes/day vs 16k human changes/day; Meta's Sapling makes commit stacks first-class; Gerrit's Change-Id gives each logical change a stable identity across patchsets. The through-line: concurrency is solved with identity, isolation, projection, and policy.

### Conclusions
1. Codebase-indexed review beats diff-only on coupled repos, but every supporting benchmark is vendor-run — **Medium** (3+ vendor docs + 1 arXiv study).
2. Deterministic fail-closed checks are the rarest capability; most LLM reviewers silently pass on error — **High** (2).
3. Pricing is non-comparable; effective cost varies ~3× — **High** (3).
4. Adoption is real and fast-growing (CodeRabbit $550M→$1.5B; 2M reviews/wk) — **High** (3).
5. Predictive-testing merge queue is the canonical concurrency-safety mechanism — **High** (3).
6. Build-graph-keyed parallel lanes are state of the art for high-volume landing — **Medium-High** (1–2).
7. Host platforms are commoditizing stacking and queueing — **Medium-High** (2).
8. Branchless/virtual-branch models cut agent VCS-command count; GitButler leads, jj lagged in one vendor benchmark — **Medium** (1).
9. Logical change identity (Change-Id) and per-file ACLs (Piper) are provenance primitives agent tooling lacks — **Medium-High** (2).
10. Review-bot supply-chain risk is demonstrated, not theoretical — **High** (1 exploit write-up).

### What to borrow for a multi-agent-concurrency platform on Cloudflare Workers + Artifacts
- **Predictive/optimistic land queue**: compute a projected head including every change ahead of an agent's change, validate *that* SHA, land only the tested artifact — "passed its own CI" must never mean "safe to merge." (F2.1)
- **Durable logical change identity** (Gerrit Change-Id / jj operation-log style), independent of branch names, so a change can be amended, re-parented, and re-validated while humans and agents keep one stable handle. (F2.10, F2.8)
- **Isolated streams over one logical workspace** (GitButler virtual branches / Sapling stacks) with dependency edges, batching, flaky quarantine, and build-graph parallel lanes so hundreds of changes validate at once without one flaky test stalling the fleet. (F2.8, F2.2, F2.3)

---

## 5. Sources Consulted

| # | Title | URL | Type | Date | Scraped? | Tier |
|---|---|---|---|---|---|---|
| 1 | Codacy — AI Code Review Tools Compared | blog.codacy.com/ai-code-review-tools-compared-2026… | Vendor blog | 2026-09 | ✅ | 50 |
| 2 | Qodex — 10 Best AI Code Review Tools | qodex.ai/blog/best-ai-code-review-tools | Vendor blog | 2026-09 | ✅ | 50 |
| 3 | arXiv 2607.03316 — Is Agentic Code Review Helpful? | arxiv.org/html/2607.03316v2 | Paper | 2026-07 | ✅ | 90 |
| 4 | Greptile — Graph-based Codebase Context | greptile.com/docs/how-greptile-works/… | Docs | n.d. | ✅ | 80 |
| 5 | Greptile — Pricing | greptile.com/pricing | Official | 2026 | ❌ | 70 |
| 6 | Greptile — Best AI Code Review Tools | greptile.com/content-library/best-ai-code-review-tools | Blog | 2026 | ❌ | 50 |
| 7 | Macroscope — vs Greptile | macroscope.com/content/macroscope-vs-greptile… | Comparison | 2026-04 | ✅ | 50 |
| 8 | Macroscope — Usage-based pricing | macroscope.com/content/usage-based-pricing… | Blog | 2026 | ❌ | 50 |
| 9 | Kodus — site / self-hosted / BYO-LLM | kodus.io/ | Vendor | 2026 | ❌ | 60 |
| 10 | Kodus — GitHub repo | github.com/kodustech/kodus-ai | Repo | 2026 | ❌ | 60 |
| 11 | Kodus — Pricing Deep Dive | docs.kodus.io/how_to_use/en/pricing | Docs | 2026 | ❌ | 70 |
| 12 | UsagePricing — Qodo repackaging | usagepricing.com/blueprint/activity/qodo-2026-06-30 | Tracker | 2026-06 | ❌ | 55 |
| 13 | Reviewpad — Reviewpad AI docs | docs.reviewpad.com/reviewpad-ai | Docs | 2026 | ❌ | 70 |
| 14 | CBInsights — Reviewpad | cbinsights.com/company/reviewpad | Directory | 2026 | ❌ | 60 |
| 15 | Sourcery — Ellipsis alternative | sourcery.ai/comparisons/ellipsis-alternative | Comparison | 2026 | ✅ | 50 |
| 16 | Ellipsis — Code Review docs | ellipsis.dev/docs/code-review | Docs | 2026 | ❌ | 70 |
| 17 | Qodex — Qodo alternatives | qodex.ai/blog/qodo-alternatives | Blog | 2026 | ❌ | 45 |
| 18 | Cursor — Pricing | cursor.com/pricing | Official | 2026 | ❌ | 70 |
| 19 | GitHub — Copilot plans / code review docs | github.com/features/copilot/plans | Docs | 2026 | ❌ | 85 |
| 20 | Graphite — Pricing | graphite.com/pricing | Official | 2026 | ✅ | 80 |
| 21 | Graphite — Homepage | graphite.com/ | Official | 2026 | ❌ | 70 |
| 22 | Graphite — vs CodeRabbit | graphite.com/l/graphite-vs-coderabbit | Comparison | 2026 | ❌ | 45 |
| 23 | Graphite — Series B / Diamond | graphite.dev/blog/series-b-diamond-launch | Blog | 2025-03 | ❌ | 65 |
| 24 | Tracxn — Graphite funding | tracxn.com/d/companies/graphite/… | Directory | 2026 | ❌ | 55 |
| 25 | Diamond — agentic AI code review | diamond.graphite.dev/ | Product | 2026 | ❌ | 55 |
| 26 | Tenki — AI Code Review Benchmark | tenki.cloud/benchmarks/code-reviewer | Benchmark | 2026 | ❌ | 40 |
| 27 | CodeRabbit — Series B newsroom | coderabbit.ai/newsroom/coderabbit-series-b-60-million | Company | 2025-09 | ❌ | 70 |
| 28 | Reuters — CodeRabbit $1.5B | reuters.com/technology/ai-code-review-platform-coderabbit… | News | 2026-08 | ❌ | 85 |
| 29 | TechCrunch — CodeRabbit $60M | techcrunch.com/2025/09/16/coderabbit-raises-60m… | News | 2025-09 | ❌ | 80 |
| 30 | BusinessWire — CodeRabbit $143M | businesswire.com/news/home/20260812311754/… | PR | 2026-08 | ❌ | 70 |
| 31 | HN — CodeRabbit RCE exploit | news.ycombinator.com/item?id=44953032 | Forum | 2025-08 | ❌ | 45 |
| 32 | HN — CodeRabbit suggestions thread | news.ycombinator.com/item?id=46315359 | Forum | 2026 | ❌ | 35 |
| 33 | Bito — Pricing | bito.ai/pricing | Official | 2026 | ❌ | 65 |
| 34 | DeepSource — Pricing / joined Harness | deepsource.com/pricing | Official | 2026-09 | ❌ | 70 |
| 35 | SonarSource — Plans and pricing | sonarsource.com/plans-and-pricing/ | Official | 2026 | ❌ | 75 |
| 36 | Trunk — Merge Queue overview | docs.trunk.io/merge-queue/merge-queue | Docs | 2026 | ✅ | 80 |
| 37 | Trunk — vs Mergify/Aviator/GitHub MQ | trunk.io/trunk-vs-mergify | Comparison | 2026 | ❌ | 50 |
| 38 | Trunk — Billing and plans | docs.trunk.io/setup-and-administration/billing | Docs | 2026 | ❌ | 75 |
| 39 | Trunk — MQ metrics | docs.trunk.io/merge-queue/administration/metrics | Docs | 2026 | ❌ | 70 |
| 40 | Mergify — How does Mergify compare | staging.mergify.com/compare-mergify | Comparison | 2026 | ✅ | 55 |
| 41 | Aviator — Pricing | aviator.co/pricing | Official | 2026 | ✅ | 80 |
| 42 | Aviator — vs Graphite | aviator.co/aviator-vs-graphite | Comparison | 2026 | ✅ | 55 |
| 43 | Aviator — MergeQueue vs Mergify | aviator.co/aviator-mergequeue-mergify | Comparison | 2026 | ❌ | 50 |
| 44 | Aviator — Merge stacked PRs docs | docs.aviator.co/mergequeue/how-to-guides/merging-stacked-prs | Docs | 2026 | ❌ | 75 |
| 45 | Bors-NG — README | github.com/bors-ng/bors-ng | Repo | 2024-04 | ❌ | 65 |
| 46 | Jujutsu — Git comparison | docs.jj-vcs.dev/starlight/git-comparison | Docs | 2026 | ❌ | 85 |
| 47 | git-branchless — Concepts / README | github.com/arxanas/git-branchless | Repo | 2026 | ❌ | 70 |
| 48 | version-control-bench | github.com/gitbutlerapp/version-control-bench | Benchmark | 2026-07 | ✅ | 65 |
| 49 | GitButler — Virtual branches docs | github.com/gitbutlerapp/docs/…/virtual-branches | Docs | 2026 | ❌ | 70 |
| 50 | GitButler — AI agents overview | docs.gitbutler.com/ai-agents/overview | Docs | 2026 | ❌ | 70 |
| 51 | Sapling — Introduction / Stacks | sapling-scm.com/docs/introduction/ | Docs | 2026 | ❌ | 75 |
| 52 | facebook/sapling — README | github.com/facebook/sapling | Repo | 2026 | ❌ | 70 |
| 53 | LWN — Meta's Sapling SCM | lwn.net/Articles/915104 | News | 2022-11 | ❌ | 75 |
| 54 | GitHub — Stacked pull requests | docs.github.com/en/pull-requests/reference/stacked-pull-requests | Docs | 2026 | ❌ | 85 |
| 55 | github/gh-stack — README | github.com/github/gh-stack | Repo | 2026 | ✅ | 80 |
| 56 | slackhq/gh-stacked-diff | github.com/slackhq/gh-stacked-diff | Repo | 2026 | ❌ | 55 |
| 57 | Gerrit — How Gerrit Works / Change-Ids | gerrit-review.googlesource.com/Documentation/… | Docs | 2026 | ❌ | 80 |
| 58 | CACM — Why Google Stores Billions of Lines | cacm.acm.org/research/why-google-stores-billions-of-lines-of-code… | Article | 2016-06 | ❌ | 90 |
| 59 | ACM DL — Piper / trunk-based | dl.acm.org/doi/fullHtml/10.1145/2854146 | Paper | 2016 | ❌ | 90 |
| 60 | VT notes — Piper scale figures | courses.cs.vt.edu/cs3704/spring22/…/Group-4.pdf | Notes | 2022 | ❌ | 35 |
| 61 | HN — Google Piper thread | news.ycombinator.com/item?id=13563336 | Forum | 2017 | ❌ | 35 |
| 62 | HN — Stacked PRs Pros and Cons | news.ycombinator.com/item?id=35810324 | Forum | 2023 | ❌ | 35 |
| 63 | HN — In Praise of Stacked PRs | news.ycombinator.com/item?id=32214809 | Forum | 2022 | ❌ | 35 |
| 64 | HN — Theatre of Pull Requests | news.ycombinator.com/item?id=45371283 | Forum | 2025 | ❌ | 40 |
| 65 | HN — Sapling traction | news.ycombinator.com/item?id=34033040 | Forum | 2022–24 | ❌ | 35 |
| 66 | Arch manual — git-branchless(1) | man.archlinux.org/man/git-branchless.1.en | Manual | 2026 | ❌ | 60 |
| 67 | Graphite — Merge Queue docs | stg.graphite.com/docs/graphite-merge-queue | Docs | 2026 | ❌ | 75 |
| 68 | Macroscope — Budget Mode | macroscope.com/budget-code-review | Vendor | 2026 | ❌ | 40 |
| 69 | Qodex/GitHub — Copilot code review docs | docs.github.com/…/request-a-code-review | Docs | 2026 | ❌ | 85 |

---

## 6. Gaps, Uncertainties & Inaccessible Sources

- **G2/Capterra aggregates were bot-walled**, so independent user sentiment rests on HN + one arXiv study. **Macroscope's 98% precision and Qodex's detection rates are first-party only** — no neutral verification.
- **Greptile TREX** is beta and credit-priced; scale behavior and Greptile funding/ARR unknown.
- **Google landing evidence is 2016-vintage**; current internal practice unknowable publicly. Critique details came only from secondary summaries.
- **GitButler's benchmark discloses authorship** — treat as directional. `gh stack` is public preview and may change before 2026-10-14.
- **Enterprise pricing (Macroscope, Greptile, Graphite) is all "contact sales"** — no numbers.

---

## 7. Tool Quick-Reference

| Tool | Category | Standout features | Pricing (entry→enterprise) | Target segment | Stack/architecture |
|---|---|---|---|---|---|
| **CodeRabbit** | AI PR review | Most complete workflow: chat, one-click fixes, Triage, learnings, CLI/IDE, security+dependency scan | Free (public repos); Essentials $24/dev/mo annual ($30 mo); Team $48/$60; $0.25/file continued | Teams wanting polished default reviewer | LLM over diff + repo context; multi-host |
| **Greptile** | AI PR review | Full-codebase **graph** index + parallel review agents; learns from comments; TREX sandbox tests | Free (1 dev, 50 credits); Pro $30/seat/mo; $1/extra; TREX 3 credits; Chat +$20/user | Large coupled codebases; GitLab/self-host/Perforce | Graph of files/functions/deps + agentic multi-hop search |
| **Macroscope** | AI PR review | AST codewalkers + reference graph; **Check Run Agents** (named required checks, per-agent model routing, external tool calls); Fix It For Me CI loop; Approvability | $0.05/KB ($0.50 floor, ~$0.95 avg); $100 free; Agent included | GitHub-only teams wanting detection + auto-fix | Language parsers + deterministic check runs |
| **Kodus (Kody)** | OSS review | AGPLv3 self-host; BYO-LLM zero markup; per-repo/dir model choice | Community free (BYOK); Teams $10/dev/mo + tokens | Privacy/audit-bound; cost-sensitive | Self-hosted pipeline; any OpenAI-compatible endpoint |
| **Qodo Merge / PR-Agent** | Review + rules | Open-source PR-Agent; Rule System across devs/agents; Enterprise Gerrit/on-prem | Pooled credits $0.012; $30 pack ≈18 reviews; 14-day trial | Teams wanting rules + agent skills | Context engine + configurable rules |
| **Reviewpad** | PR automation | Open-source YML PR workflow automation; auto-label/summarize/policy | Free OSS engine | Former GitHub automation users | YML policy language + LLM summarize |
| **Ellipsis** | AI review + agents | Reviewers in own sandbox with repo checked out; dedupes findings; event triggers; agents can run tests | Tiered (contact) | Teams wanting autonomous PR agents | Sandboxed reviewer fleet + triggers |
| **Sourcery** | AI review | PR summaries, **review diagrams**, smart filtering, progressive learning, IDE reviews, daily full-repo security scans | Free tier; paid tiers | Teams wanting IDE + PR + security | Reviewer learning from interactions |
| **Codacy** | Governance | Deterministic gates that **fail closed**; Verity blocks on prompt-conformance (unique); MCP server | Free Developer; Team $18/dev/mo annual ($21 mo) | Regulated pipelines | Rule engine + gates + AI overlay |
| **Cursor Bugbot** | Host-native | Built into Cursor; auto on PR update or `/review-bugbot`; fail-on-unresolved org-gated | Cursor Pro $20/mo; Bugbot usage-based | Cursor-standardized teams | LLM diff+repo review in editor ecosystem |
| **GitHub Copilot code review** | Host-native | Zero-install; request as reviewer or ruleset auto-review; suggested changes | Copilot Pro $10/user/mo + credits; Actions minutes from 2026-06-01 | Existing GitHub teams | Diff-scoped LLM; comment (not approve) |
| **Graphite AI (ex-Diamond)** | Review + workflow | AI reviewer inside stacked-PR + merge-queue platform; MCP; Cursor Cloud Agents | Hobby free; Starter $20; Team $40; Enterprise custom | Stacked-PR adopters on GitHub | Platform-integrated LLM review |
| **Qodex** *(bonus)* | Runtime review | Reviews against **running preview** via live probes; 6 passes; code graph + 2 models | Free 20 PRs/mo; Pro $30/dev/mo | Auth/runtime bug teams | Probe harness + SSRF-guarded preview |
| **DeepSource** *(bonus)* | Static + AI | 5,000+ deterministic rules + AI Review; Autofix PRs | Team $24/user/mo; AI Review $8/10k lines; acquired by Harness 2026-09 | Analysis-first teams | Deterministic base + AI overlay |
| **SonarQube + Gitar** *(bonus)* | Quality gate | Long-standing quality gates; Gitar commits fixes and iterates to green CI | Sonar Team from $34/mo; Gitar Core $20/dev/mo | Sonar-standardized orgs | Rule engine + agentic fixer |
| **Bito** *(bonus)* | Budget review | Cheapest credible per-seat reviewer; codebase-indexed | Team $12/seat/mo annual (5k lines/seat) | Small teams | Diff + indexing |
| **Graphite** | Stacked diffs + MQ | Stack-aware merge queue; `gt` CLI; AI review; PR inbox; dev metrics; MCP | Hobby free; Starter $20; Team $40; Enterprise custom | GitHub teams wanting stacked workflow | Closed-source CLI + GitHub app + server queue |
| **Trunk** | Merge queue + CI | Predictive testing, parallel lanes, anti-flake, batching; CI-layer flaky detection; priority merging | Free ≤5 committers/5M spans; Team ≤50 committers; Enterprise | Teams with test-stability/CI pain | GitHub app + predictive/parallel queue |
| **Aviator** | Merge queue + verify | Parallel queues; **affected-targets** monorepo routing (Bazel/NX/Pants/Turborepo/Gradle); Changesets; FlexReview; self-host; MIT `av` CLI | Free; Team $20/dev/mo; Scale $50/dev/mo; Enterprise custom | Monorepos at 1,000+ PRs/day | Build-graph-aware queue; SOC 2 Type II |
| **Mergify** | Merge queue | Batching + bisect-on-failure; CI Insights; Test Insights (flaky quarantine); Merge Protections; YAML rules | 14-day trial; tiered (contact) | Monorepo/regulated teams outgrowing GitHub MQ | GitHub-only queue + CI ingestion |
| **Bors-NG** | Merge bot (deprecated) | Staging-branch continuous testing; ancestor of modern queues | OSS (archived) | Legacy/self-hosters | Elixir; GitHub staging branch |
| **Jujutsu (jj)** | Next-gen VCS | No staging area/current branch; auto-rebases descendants on rewrite; operation-log undo; Git-compatible | Free (Apache-2.0) | Power users; agent workspaces | DAG-first VCS over Git storage |
| **git-branchless** | Branchless Git | Detached-HEAD patch stacks; in-memory `git move`; smartlog; working-copy snapshots for undo | Free (MIT) | Linux/Git-style patch stacks | Git extension (Rust) |
| **GitButler** | Virtual-branch VCS | Multiple **virtual branches** in one working dir; drag hunks between branches; agents via `but` CLI | Free tier; paid (contact) | Devs + agents on parallel streams | Virtual-branch engine + GitHub remote |
| **Sapling** | Scalable VCS | First-class commit stacks; smartlog; amend/undo anywhere; Meta-proven at 10M+ files | Free (GPL-2.0) | Meta-scale monorepos | Mercurial-derived; Mononoke + EdenFS (internal) |
| **ghstack / gh stack** | Stacked PR CLI | Meta ghstack; Slack `gh-stacked-diff`; **GitHub native `gh stack`** with Stack UI + AI-agent skill | Free (MIT) | GitHub stacked-PR adopters | Go CLI + GitHub Stack API (preview) |
| **Gerrit** | Review forge | `refs/for/` upload + **Change-Id** stable identity; topics; ACLs; server-side submit queue | Free (Apache-2.0) | Android/Chromium-scale projects | Central repo + Pending Changes store |
