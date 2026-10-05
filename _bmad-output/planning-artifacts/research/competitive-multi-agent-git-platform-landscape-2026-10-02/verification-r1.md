# Independent Verification — R1 Competitive Landscape (round 1)

Verifier: fresh-context, external sources only. Access date: 2026-10-02. Tool budget: 12 calls.

**Summary.** V1, V3 verified against primary + independent sources. V6 verified (four publishers). V4 and V5 verified against vendor primaries only — no cheap independent outlet found (V4/V5 were "if cheap"). V2 falsification attempt failed to find any counterexample after 3 searches. One minor internal inconsistency noted in Imbue's own pages (V5).

---

## V1 — GitHub concurrent agent sessions + Agents tab + PR-routed review
VERDICT: verified
EVIDENCE:
- https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/agent-management (GitHub Docs; undated)
- https://github.blog/news-insights/company-news/welcome-home-agents/ (The GitHub Blog; 2025-10, Universe)
NOTES: Docs verbatim: "You can run multiple agent sessions concurrently"; "Agents tab within a repository"; "Agents page" (github.com/copilot/agents); and "*Review and merge agent code*: … jump to the pull request to review the changes … approve and merge." So concurrent sessions, Agents tab/page, and PR-routed review-and-merge are all confirmed by the cited primary. Cross-checked github.blog (Agent HQ / "mission control", 2025-10) which confirms the multi-session orchestration framing. Publisher + month recorded; docs page itself undated.

## V2 — FALSIFICATION: does any product compare/integrate multiple concurrent agent changes AS A SET?
VERDICT: unverified (original claim not falsified; no counterexample found within 3 searches)
EVIDENCE (queries tried, all via Firecrawl general web):
1. "tool compares multiple concurrent AI agent pull requests as a set review and merge together"
2. "review multiple agent branches simultaneously side by side merge all agent changes at once platform"
3. "multi-agent code review fleet compare agent diffs and integrate as one review 2026 product"
Candidate surfaces seen and rejected as non-set-level: runfleet.dev ("Fleet — Your agents. One cockpit.", "One-Click Review" — per-agent, review/commit/push); agentfleet.live/docs/review-merge-cleanup (steers/reviews after "an agent finishes" — per-agent); augmux (per-agent branch/worktree + "two-phase review" flow); mergeshield (per-PR risk + auto-merge); mergewatch.ai (reviews "every pull request"). None presents a single surface to compare/select/integrate N independent concurrent agent-produced diffs as a set.

Extended round-2 searches (lead addendum):
4. "compare agent proposals fleet review AI agents multiple agent PRs review dashboard"
5. "multi-agent code review tool 2026 review multiple AI branches agent proposal comparison merge together"
6. "site:news.ycombinator.com OR site:producthunt.com review multiple AI agent branches compare merge 2026"
Round-2 near-misses: GitGhost AI (Product Hunt, ~2026-09) "Make AI-built software reviewable before it ships … Connect Claude Code, Codex, Cursor, Gemini CLI, or OpenCode; capture session evidence; review branches and diffs; approve risky actions" — the closest thing to a multi-branch review surface, but its blurb does not establish comparing/selecting/integrating concurrent agent changes AS A SET, so it is a candidate, not a confirmed counterexample. Others remain non-set-level: Conductor (Product Hunt — "review and merge their changes", per-agent), agents-fleet (parallel design proposals picked by a critic, not code diffs), diffray/alanchn31/c-CRAB (multi-agent review of a single diff/PR), manzia/agentery (agent-marketplace comparisons, not code).
NOTES: No product found that falsifies the digest claim that human set-level compare/integrate of multiple concurrent agent changes does not exist; nearest candidates remain per-PR or per-agent review. GitGhost AI is the strongest potential counterexample encountered and should be followed up directly if budget allows. Absence of evidence, not proof — marked unverified rather than verified.

## V3 — Entire (Thomas Dohmke): launch, funding, Checkpoints CLI, unshipped platform
VERDICT: verified
EVIDENCE:
- https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round (Entire; "February 10, 2026")
- https://finance.yahoo.com/news/former-github-ceo-raises-record-143000554.html (Yahoo Finance / TechCrunch, Julie Bort; 2026-02-10) — independent
- https://www.geekwire.com/2026/former-github-ceo-launches-new-developer-platform-with-huge-60m-seed-round/ (GeekWire; 2026) — independent
- https://www.felicis.com/blog/entire-the-worlds-next-developer-platform (Felicis; lead backer)
- https://sdtimes.com/softwaredev/startup-entire-launches-distributed-git-network-for-the-agent-era (SD Times; ~mid-2026)
NOTES: Entire's own release states launch "February 10, 2026", "$60 million seed round at $300 million valuation", first OSS product "Checkpoints … captures AI agent context—reasoning, prompts, and decisions—on every Git commit". Independent Yahoo/TechCrunch and GeekWire confirm the $60M-at-$300M figure and "largest seed in dev-tools history" (attributed to Felicis), naming Madrona, Microsoft's M12, Basis Set. SD Times (~5 months later) reports Entire launching its distributed Git network, consistent with the "platform announced for later 2026 / not shipped as of launch" framing.

## V4 — Macroscope Murmur (2026-09-03): per-agent cloud VMs; self-driving PR lifecycle; Director CLI control plane
VERDICT: verified (vendor primary); independent corroboration NOT obtained
EVIDENCE:
- https://www.macroscope.com/blog/introducing-murmur (Macroscope, Kayvon Beykpour, dated "September 3, 2026")
- https://macroscope.com/content/why-we-built-murmur-coding-agent-orchestration (Macroscope — same vendor)
- https://macroscope.com/murmur and https://macroscope.com/mts (Macroscope — same vendor)
NOTES: Primary confirms "every coding agent its own cloud VM", "self-driving pull requests", and the "Director" concept: "A Director is an interactive local coding session, with the Murmur CLI and MCP server attached … Your local session becomes the control plane for a fleet." Date 2026-09-03 confirmed by author/date on the post. Only same-vendor pages corroborate cheaply; no independent non-vendor outlet retrieved within budget, so the capability claim rests on the vendor's own docs (and the digest cited them as such).

## V5 — Sculptor (Imbue): per-agent containers; "merge without conflicts"; full session preservation
VERDICT: verified (vendor primary); independent corroboration NOT obtained
EVIDENCE:
- https://imbue.com/blog/sculptor-announce (Imbue; page dated 2025-09-26, updated 2026-04-30)
- https://imbue.com/sculptor and https://imbue.com/product/sculptor (Imbue)
- https://github.com/imbue-ai/sculptor/blob/main/README.md (Imbue OSS README)
NOTES: Primary confirms: "Every agent runs in its own container … Unlike git worktrees—which share your local environment"; section "Merge without conflicts" ("Sculptor will flag potential merge conflicts automatically … you can hand them back to the agent to resolve"); and "Sculptor saves every agent session with its plans, chats, tool calls, and code changes all intact." CAVEAT: Imbue's own product page snippet states "Each agent gets its own Git worktree, its own branch" — apparently inconsistent with the blog's worktree-vs-container contrast (likely stale/marketing copy); flag as an internal vendor-doc inconsistency, not a falsification of the container claim. Bones of the claim (containers, conflict flagging + hand-back, session preservation) are all on the cited primary.

## V6 — Cursor acquired Graphite (Dec 2025)
VERDICT: verified
EVIDENCE:
- https://fortune.com/2025/12/19/cursor-ai-coding-startup-graphite-competition-heats-up/ (Fortune; 2025-12-19)
- https://techcrunch.com/2025/12/19/cursor-continues-acquisition-spree-with-graphite-deal/ (TechCrunch; 2025-12-19)
- https://www.axios.com/pro/enterprise-software-deals/2025/12/19/cursor-buys-code-review-platform-graphite (Axios Pro; 2025-12-19) — original scoop
- https://cursor.com/blog/graphite and https://stg.graphite.com/blog/graphite-joins-cursor (Cursor / Graphite; announced 2025-12-19)
NOTES: Fortune headline/date confirmed ("Exclusive: Cursor acquires code review startup Graphite…", 2025-12-19); meta description confirms the "$29 billion" Cursor valuation. Axios independently reports the deal (cash + stock, priced "way over" Graphite's ~$290M last valuation); TechCrunch and InfoWorld repeat it; Cursor's and Graphite's own blogs confirm a definitive agreement. Multiple independent publishers agree on date and fact.

## Absence check (V2 falsification)
No product was found, within 6 general-web searches (3 initial + 3 extended per the lead's addendum), that lets a human compare/select/integrate multiple concurrent agent-produced changes as a set on one surface. Candidates surfaced (runfleet.dev, agentfleet.live, augmux, mergeshield, mergewatch.ai, Conductor, agents-fleet, diffray, and the Product Hunt/HN sweep) all operate at per-agent or per-PR granularity. The one near-miss worth a direct follow-up is GitGhost AI (Product Hunt, ~2026-09; "review branches and diffs"), whose blurb hints at multi-branch review but does not confirm set-level compare/integrate. The digest's set-level-absence claim therefore stands un-falsified; remaining uncertainty is genuine (searches may have missed a niche or unindexed tool), so V2 is marked unverified rather than verified.
