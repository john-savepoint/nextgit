## Trajectory Report: Worker 5

**Areas:** 9 (Trust Layer — security, identity, secrets, supply chain for agent workflows) and 10 (Market Needs, User Voice & Engineering Analytics). UltraDeep research for the Cloudflare "Next-Gen Git Platform" competition (Workers + Artifacts; multi-agent concurrency). Read-only on the world. Date 2026-10-02. Quotes verbatim; vendor claims labelled.

---

### 1. Solution Planning

**Decomposition.** Area 9 → secret scanning; secret managers; provenance/signing; agent identity (standards + vendors); MCP security; per-file access-control prior art; "secret-typed files" + commit-time scrubbing. Area 10 → quantified surveys (DORA, Stack Overflow, Octoverse, GitLab); code-quality empirics (GitClear, agentic-PR datasets); 8–12 practitioner excerpts; engineering-analytics platforms; AI dev-tool adoption.

**Strategy.** firecrawl_search discovery (2–4 parallel queries/cycle); firecrawl_scrape or `read`-on-URL for exact passages; prefer 2025–2026; record dates; triangulate pricing with ≥2 sources.

**Expected vs actual.** Expected standards + pricing; the highest-value material was actually quantified survey pages and organic practitioner threads — one arXiv study of 1,154 Reddit/HN "AI slop" posts and one Ask-HN thread yielded the most decision-relevant evidence. Vendor comparison pages gave feature deltas but each trashes competitors, so pricing needed third-party triangulation. Two sources failed (DORA infographic PDF; Microsoft MCP page, JS-only) — worked around via snippets.

---

### 2. Methods & Pivots

| Cycle | Query | Tool | Results | Scraped | Pivot Reason |
|---|---|---|---|---|---|
| 1 | agent identity standards 2026 SPIFFE OAuth + MCP security best practices | search ×2 | 16 | No | Launch Area 9 |
| 2 | gitleaks vs TruffleHog vs GitHub secret scanning + per-file ACL Gerrit | search ×2 | 16 | No | Found accuracy study + Gerrit |
| 3 | Infisical vs Doppler vs Vault pricing + sigstore SLSA | search ×2 | 16 | No | Pricing triangulation |
| 4 | commit-time secret scrubbing prior art + DORA 2025 | search ×2 | 16 | No | arXiv history-rewrite study |
| 5 | DORA report page + HN AI review fatigue | scrape+search | 1+8 | Yes | DORA thin; HN rich |
| 6 | DORA 2025 statistics + Octoverse 2025 | search ×2 | 16 | No | Stats via snippets |
| 7 | Stack Overflow 2025 AI trust + DORA PDF | search+scrape | 8+FAIL | Partial | PDF blocked → SO pages |
| 8 | engineering metrics comparison + Okta/Auth0/Descope | search ×2 | 16 | No | Analytics + identity vendors |
| 9 | HN PR review load + git-crypt/sops/sealed-secrets | scrape+search | FAIL(419)+8 | No | HN blocked → `read` |
| 10 | HN item via `read` + GitLab DevSecOps survey | read+search | 15+8 | Yes | Full thread; 6 excerpts |
| 11 | GitLab AI Paradox + GitClear | search ×2 | 16 | No | Quantified sources |
| 12 | GitLab press + GitClear maintainability | scrape ×2 | 2 | Yes | Exact statistics |
| 13 | GHAS pricing + Infisical/Doppler pricing | search ×2 | 16 | No | $19/$30; $8/$21; ~$18–23 |
| 14 | passkeys for non-human identity + AI tool adoption | search ×2 | 16 | No | Passkeys weak for agents |
| 15 | Reddit AI slop + DX research | search ×2 | 16 | No | arXiv slop study + DX |
| 16 | arXiv slop paper + DX AI metrics | scrape ×2 | 2 | Yes | Exact quotes |
| 17 | MCP security 2026 + agentic PR volume | search ×2 | 16 | No | AIDev 932k-PR dataset |
| 18 | PR-flood post + analytics pricing | scrape+search | 1+8 | Yes | 98%/91%/4.6x + pricing |

---

### 3. Evidence Collection

#### Area 9 — Trust Layer

**A. Secret scanning**
1. **Accuracy differs by precision/recall axis.** "top three tools based on precision are: GitHub Secret Scanner (75%), Gitleaks (46%), and Commercial X (25%), and based on recall are: Gitleaks (88%), SpectralOps (67%) and TruffleHog (52%)" — [Comparative Study of Software Secrets Reporting, NSF](https://par.nsf.gov/servlets/purl/10505647). Compose detectors. *Confidence: Medium-High*.
2. **Gitleaks is the OSS baseline.** "most trusted open-source secret scanner" (16M→20M docker downloads, 17k→19k stars, MIT, regex+entropy) — [gitleaks.io](https://gitleaks.io/), [gitleaks.org](https://gitleaks.org/). *Confidence: High*.
3. **TruffleHog's edge is verification.** "classifies over 800 secret types… can also log in to confirm if that secret is live or not." — [trufflehog repo](https://github.com/trufflesecurity/trufflehog). *Confidence: High*.
4. **GHAS split into two products (Apr 2025).** "GitHub Advanced Security will be available as two standalone security products — GitHub Secret Protection and GitHub Code Security" — [i-programmer](https://www.i-programmer.info/news/149-security/17916-github-splits-advanced-security-into-separate-products.html). *Confidence: High*.
5. **$19 Secret Protection / $30 Code Security per active committer/month; 90-day billing window.** — [github.com/security/plans](https://github.com/security/plans); "first quotes ran 20 to 40 percent high" — [Redress](https://redresscompliance.com/microsoft-github-advanced-security-licensing). Per-committer billing punishes large agent fleets. *Confidence: High*.
6. **Push protection blocks pre-arrival.** "Prevent secret exposures by proactively blocking secrets before they reach your code" — [GHAS page](https://github.com/security/advanced-security). *Confidence: High*.

**B. Secret managers**
7. **Doppler pricing.** "Free for 3 users $8/mo per additional user… $21/mo per user" — [doppler.com/pricing](https://www.doppler.com/pricing); "capped at 25 users… Add-ons… $9 per seat per month each" — [envmanager](https://envmanager.com/blog/doppler-pricing-alternatives). *Confidence: High*.
8. **Infisical: MIT core + per-seat cloud, SPIFFE-aware.** "Infisical's open source core (MIT license) includes most of what a team needs… Secret scanning and leak prevention" — [infisical.com](https://infisical.com/blog/hashicorp-vault-alternatives); "$23/mo" entry — [outmano](https://outmano.com/compare/cookieyes-vs-infisical). *Confidence: Medium* (SEO/vendor).
9. **Vault SaaS retreats under IBM.** "HCP Vault Secrets… was sunsetted in mid-2025… Vault Enterprise pricing has zero transparency" — [infisical.com](https://infisical.com/blog/hashicorp-vault-pricing) (adversarial). *Confidence: Medium*.
10. **Secret managers converge on workload identity.** "Both platforms natively consume SPIFFE SVIDs without OIDC federation workarounds." — [infisical.com compare](https://infisical.com/compare/infisical-vs-hashicorp-vault). *Confidence: Medium*.

**C. Provenance / signing**
11. **SLSA = provenance + the act of verification.** "provenance doesn't do anything unless somebody inspects it. SLSA calls that inspection verification" — [SLSA spec](https://github.com/slsa-framework/slsa/blob/main/spec/verifying-artifacts.md). *Confidence: High*.
12. **sigstore/Fulcio/Rekor underpin keyless signing** used by the SLSA GitHub generator (`NewDefaultFulcio()`) — [pkg.go.dev](https://pkg.go.dev/github.com/jobroe10/slsa-github-generator/signing/sigstore). *Confidence: Medium*.

**D. Agent identity standards (2025–2026)**
13. **IETF is standardising "one client ID, many concurrent agent instances".** "a single OAuth client identifier represents an agent platform running many concurrent agent instances." — [draft-mcguinness-oauth-ai-agent-instance-00, 2026-07-04](https://www.ietf.org/archive/id/draft-mcguinness-oauth-ai-agent-instance-00.html). Companion: "AI Agents should leverage existing standards defined by SPIFFE, WIMSE, OAuth and OpenID SSF" — [draft-klrc-aiagent-auth-03](https://www.ietf.org/archive/id/draft-klrc-aiagent-auth-03.html); [draft-aip-agent-identity-protocol-00 (2026-03)](https://www.ietf.org/archive/id/draft-aip-agent-identity-protocol-00.html). *Confidence: High*.
14. **Hyperscalers ship SPIFFE-based agent identity.** "Agent Identity provides a strongly attested, cryptographic identity for each agent that is based on the SPIFFE standard… authenticate to MCP servers, cloud resources, endpoints, and other agents" — [Google Cloud IAM](https://docs.cloud.google.com/iam/docs/agent-identity-overview). *Confidence: High*.
15. **Identity vendors entered agent identity.** Auth0 "Auth for GenAI in Developer Preview" (2025-04) — [Okta press](https://www.okta.com/en-gb/newsroom/press-releases/auth0-platform-innovation); 2026: "Auth0 now secures MCP and autonomous agents as first-class identities… incl. Auth for MCP, Agent as Principal, On-Behalf-Of" — [Okta/Auth0](https://www.okta.com/en-gb/newsroom/articles/auth0-may-2026-product-innovations); Microsoft: "Why MCP, A2A, OAuth, and SPIFFE are the backbone of agentic identity" — [Entra blog, 2026-04-24](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/microsoft%E2%80%99s-perspective-on-agentic-identity-standards/2111910). *Confidence: High*.
16. **Passkeys are a human primitive, not an agent one.** "a passkey is a discoverable FIDO credential that is tied to a user account and a website or application" — [webauthn.me](https://www.webauthn.me/passkeys); [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys). Agent auth lands on SPIFFE SVIDs + OAuth client assertions. *Confidence: Medium-High*.

**E. MCP security**
17. **Spec mandates OAuth 2.1 resource-server model; forbids token passthrough.** "A protected MCP server acts as an OAuth 2.1 resource server" — [MCP spec 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx); "MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server itself… MUST NOT use sessions for authentication" — [mcp-for-beginners](https://github.com/microsoft/mcp-for-beginners/blob/main/02-Security/mcp-best-practices.md). *Confidence: High*.
18. **Tool poisoning is the signature attack; root cause = connect-time/runtime trust gap.** "Its tools look normal, but their responses contain hidden instructions… The root cause is a trust gap between connect-time and runtime." — [OWASP](https://community.owasp.org/attacks/MCP_Tool_Poisoning); "An agent treats everything in its context as trustworthy: tool descriptions, parameter schemas, and the data tools return." — [Microsoft, state of MCP security 2026](https://techcommunity.microsoft.com/blog/microsoft-security-blog/the-state-of-mcp-security-in-2026/4531327). *Confidence: High*.
19. **Confused deputy + command injection complete the taxonomy.** "creating 'confused deputy' vulnerabilities" — [modelcontextprotocol.io](http://modelcontextprotocol.io/docs/tutorials/security/security_best_practices); "MCP05:2025 – Command Injection & Execution" — [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/2025/MCP05-2025%E2%80%93Command-Injection&Execution). *Confidence: High*.

**F. Per-file access control & "secret-typed files" prior art**
20. **Gerrit is the canonical per-ref ACL platform.** "Gerrit will use the full set of access rights to determine if the user is allowed to perform a given action… Per-project access control lists are also supported." — [Gerrit access-control.txt](https://gerrit.googlesource.com/gerrit/+/refs/heads/master/Documentation/access-control.txt). *Confidence: High*.
21. **Gerrit OWNERS supports path-scoped grants.** "per-file <path-exp-1,…>=<access-grant> — The access grant applies only to the files that are…" — [code-owners docs](https://github.com/GerritCodeReview/plugins_code-owners/blob/master/resources/Documentation/backend-find-owners.md); syntax `per-file SPACE+ globs SPACE* "=" SPACE* owners` — [find-owners syntax](https://gerrit.googlesource.com/plugins/find-owners/+/master/src/main/resources/Documentation/syntax.md). *Confidence: High*.
22. **"Secret-typed files" already work as path-driven encryption with partial-key access.** "Files which you choose to protect are encrypted when committed, and decrypted when checked out… store your secret material… in the same repository as your code, without… lock down your entire repository." — [git-crypt README](https://github.com/AGWA/git-crypt/blob/master/README.md). git-sops: "decrypted in worktree but encrypted in… git index, commit blobs, on remote git server when branch is pushed" — [git-sops](https://github.com/ivandeex/git-sops). SOPS: "keys are stored in cleartext and only values are encrypted." — [getsops/sops](https://pkg.go.dev/github.com/getsops/sops/v3). Mechanism proven; no agent-aware policy layer exists. *Confidence: High*.
23. **Commit-time scrubbing is retrofit; history rewrites are studied.** "altered histories recurrently change licenses retroactively, or are used to remove 'secrets' (e.g., private keys) committed by mistake." — [Altered Histories (arXiv 2509.09294)](https://arxiv.org/pdf/2509.09294); Git 2.54 ships experimental `git-history reword/split` — [docs](https://git-scm.com/docs/git-history/2.54.0). Industry accepts leak→rotate→rewrite; prevention is differentiated. *Confidence: High*.

#### Area 10 — Market Needs, User Voice & Engineering Analytics

**A. Quantified surveys**
24. **DORA 2025: near-universal use; AI is an amplifier.** "90% of technology professionals report using AI at work… 80% report a perception that AI has increased their productivity" — [DORA Infographic PDF](https://dora.dev/research/2025/2025-DORA-Report-Infographic.pdf); "AI's primary role is as an amplifier, magnifying an organization's existing strengths and weaknesses" — [dora.dev](https://dora.dev/dora-report-2025); n≈5,000, 2025-09-23 — [Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report); "the question is not whether to adopt it but how to realize its value" — [The Register, 2025-09-24](https://www.theregister.com/software/2025/09/24/dora-report-reframes-ai-as-central-to-software-development/1122275). *Confidence: High*.
25. **Stack Overflow 2025: adoption up, trust down.** "84% of developers use or plan to use AI tools, up from 76%… only 29%… say they trust AI outputs to be accurate, down from 40% in 2024." — [SO for leaders](https://stackoverflow.co/internal/resources/2025-stack-overflow-developer-survey-for-leaders/ai-adoption); "Highly trust 3.1% Somewhat trust 29.6% Somewhat distrust 26.1% Highly distrust 19.6%" — [survey](https://survey.stackoverflow.co/2025); "51% of professional developers use AI tools daily" — [SO AI](https://survey.stackoverflow.co/2025/AI); n=49,000+ — [SO blog](https://stackoverflow.blog/2025/07/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here). ~46% distrust vs ~33% trust — the core wedge for verification tooling. *Confidence: High*.
26. **Octoverse 2025: volume + PR-merge rate exploding.** "180M+ developers… 630M total repositories with +121M new… 43.2 million pull requests merged per month (up 23% year over year)… 80% of new developers on GitHub use Copilot in their first week… 4.3M AI-related repositories, nearby double" — [GitHub Blog, 2025-10-28](https://github.blog/2025-10-28-octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1); GitHub staffer: "I think 'AI fatigue' is incredibly real (and valid)" — [github.blog, 2025-11-07](https://github.blog/news-insights/octoverse/what-986-million-code-pushes-say-about-the-developer-workflow-in-2025/). *Confidence: High*.
27. **GitLab 2025 (Harris Poll, n=3,266): 7 hrs/week lost; low trust in autonomous AI.** "organizations lose 7 hours per team member weekly to AI-related inefficiencies… 97% are using or planning to use AI… Only 37% would trust AI to handle daily work tasks without human review… 73% have experienced problems with code created by 'vibe coding'… 60% use more than 5 tools… 49% use more than 5 AI tools… 82% predict that by 2027, compliance will be built into code." — [GitLab press, 2025-11-10](https://about.gitlab.com/press/releases/2025-11-10-gitlab-survey-reveals-the-ai-paradox). *Confidence: High*.
28. **GitClear: maintainability erodes as AI authorship scales.** "cross-file function calls… are down 35%. Refactoring line moves are down 70%, and long-term legacy maintenance is down 74% vs 2022… copy/paste (+41%), code block duplication (+81%), error-masking constructs (+47%), and two-week code churn (+15%)… block duplication climbed from 40.3 in 2023 to 73.0… The headline is not 'AI writes bad code.' It is that today's default AI workflow is incentivized to deliver atomic code." — [GitClear Maintainability Gap, 623M changes, 2026](https://www.gitclear.com/the_ai_code_quality_maintainability_gap). *Confidence: Medium-High*.

**B. Agentic PR empirics**
29. **Agentic PRs studied at scale; merge worse than human.** "932,791 PRs written by five agentic systems (OpenAI Codex, Devin, GitHub Copilot, Cursor, and Claude Code), spanning 116,211 repositories" — [AIDev corpus](https://www.emergentmind.com/topics/aidev-dataset-corpus). *Confidence: Medium-High*.
30. **Rejections come from context fit, not code defects.** "most rejections stemmed from project context, such as alternative solutions or PR size, rather than flaws in AI-generated code." — [Why Agentic-PRs Get Rejected (arXiv 2602.04226)](https://arxiv.org/html/2602.04226v1); 11,048 closed agentic PRs analysed — [arXiv 2605.22534](https://arxiv.org/pdf/2605.22534v1). Context preservation + intent signalling is the core problem. *Confidence: Medium-High*.
31. **Agentic code review is an active direction.** "Rethinking Code Review in the Age of AI: A Vision for Agentic Code Review" (2026-05-17) — [arXiv 2605.17548](https://arxiv.org/abs/2605.17548). *Confidence: High*.

**C. Practitioner voice (quotes)**
32. **PR floods are the top complaint.** "We are facing flooding and surge in PRs across the teams. AI reviewer tools are good, but not exactly helping in efficiency… it's not resulting into eventual productivity or velocity in roadmap." — *meteor333*; "review time hasn't improved, so PR review has become the main bottleneck instead of coding." — *ZivenChang*, [HN 48329446, 2026-05-29](https://news.ycombinator.com/item?id=48329446).
33. **Reviewers disengage.** "Skipping most reviews and waiting for disasters to happen." — *antoineMoPa*, [HN 48329446](https://news.ycombinator.com/item?id=48329446); "the code review load… will gradually increase as fewer and fewer… supervise an ever-growing number of coding agents, and they will inevitably learn to become complacent… out of pure necessity for their sanity." — *palmotea*, [HN 47545748](https://news.ycombinator.com/item?id=47545748).
34. **Reported fix: automate deterministic checks; keep review signal independent of the generator.** "We pushed the trivial checks (style, obvious bugs, secret and other deterministic scanning) onto automation so humans only look at intent and design, and the trap to avoid is letting AI both write and 'review' the code, since you want the review signal independent of what generated it." — *niros_valtos*, [HN 48329446](https://news.ycombinator.com/item?id=48329446).
35. **Practitioners ask for the platform's feature set: risk-scored dynamic gating.** "we should be moving towards dynamic rules for when a human needs to be in the loop… an agent can output a risk score for how risky the change is. Teams can then configure to auto approve PRs for the risk level they are comfortable with… AFAIK Github doesn't support anything like this today." — *cloche*, [HN 48329446](https://news.ycombinator.com/item?id=48329446).
36. **Trust decay / "slop" are felt.** "the increase in PR review volume extremely exhausting… mind-numbing work." — *brailsafe*, [HN 46168091](https://news.ycombinator.com/item?id=46168091); "PRs piled up, causing review fatigue, and we had this sinking feeling that standards were slipping." — *sestinj*, [HN 47049848](https://news.ycombinator.com/item?id=47049848); "Multiple 5k+ line PR's that should be sub 100 lines… Very scary PR's where the AI did something extremely dangerous" — [r/ExperiencedDevs](https://www.reddit.com/r/ExperiencedDevs/comments/1kr8clp/); "I honestly didn't expect AI to blur the line between actual competence and just looking competent this much." — [r/ExperiencedDevs](https://www.reddit.com/r/ExperiencedDevs/comments/1vg0cx8/what_do_you_do_when_a_developer_submits_ai).
37. **Academic framing: AI slop is a tragedy of the commons; tools must support verification + provenance.** "1,154 Reddit and Hacker News posts… 15 codes… three thematic clusters: Review Friction…, Quality Degradation…"; "Tools should support the verification and review of generated code, not only its generation… surfacing uncertainty indicators, flagging changes to tests, security mechanisms, or external dependencies… make AI assistance visible through provenance." — ["Endless Stream of AI Slop" (arXiv 2603.27249)](https://arxiv.org/html/2603.27249v4). *Confidence: High*.
38. **Quantified bottleneck (secondary).** "Teams with high AI adoption merge 98% more PRs (Index.dev); PR review time increased 91% (Faros AI); AI-generated PRs wait 4.6x longer in review without governance (Opsera)"; "47 open reviews. Six months ago, we averaged 12"; "individual productivity is up 10-20%, but org-level metrics are flat." — *carlos_ml*, [10x.pub, 2026-03-16](https://tianpan.co/forum/t/we-ship-98-more-prs-with-ai-but-review-time-exploded-91-is-code-review-the-new-bottleneck/2132). *Confidence: Low-Medium*.

**D. Engineering analytics**
39. **DX sells a 4-dimension AI measurement framework.** "speed, effectiveness, quality, and impact… TrueThroughput… PR Cycle Time… PR Revert Rate… Developer Experience Index (DXI)… Percentage of Time Spent on New Feature Development" — [DX blog](https://getdx.com/blog/5-metrics-in-dx-to-measure-ai-impact/); 2026: "Defect ratio… improved by 16.9%… DXI… remained unchanged" — [DX benchmarks](https://getdx.com/blog/2026-dx-benchmarks-are-now-available/); "AI output explains 63% of developer time savings but shows a weak link to increased innovation ratio." — [DX Research, 2026-09-02](https://getdx.com/blog/insights/). *Confidence: High*.
40. **Vendors differ by layer: throughput (LinearB), exec/finance (Jellyfish), experience (DX), simplicity (Swarmia), deploy tracking (Sleuth).** LinearB: "benchmarks from 8.1+ million pull requests across 4,800+ organizations" — [linearb.io](https://linearb.io/compare/dx-vs-linearb); Swarmia "$45 per developer per month… [or] $23… per developer per month" — [swarmia.com/pricing](https://swarmia.com/pricing); Jellyfish "$50-100K/year… board-ready"; DX "$10-20/seat/month" — [PanDev, 2026](https://pandev-metrics.com/docs/blog/best-linearb-alternative-2026); Sleuth on "PR Review Lag Time" — [sleuth.io](https://www.sleuth.io/post/sleuth-jellyfish-swarmia). *Confidence: Medium-High*.

**E. AI dev-tool adoption**
41. **JetBrains 2026 (n>15,000): agents routine; Claude Code overtook Copilot.** "around 39% of professional developers worldwide were using Claude Code at work, up from 18% in January 2026" — [JetBrains Research, 2026-08](https://blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026); "90 percent… use AI coding agents at work at least weekly, while 68 percent use them daily" — [i-programmer, 2026-09-02](https://www.i-programmer.info/news/99-professional/19118-jetbrains-reveals-widespread-adoption-of-ai-coding-agents-.html). *Confidence: Medium-High*.
42. **Market sizing (low confidence).** "roughly $12.8 billion in 2026, up from $5.1 billion in 2024" — [nipralo.com](https://www.nipralo.com/blogs/best-ai-coding-tools-2026). Directional only. *Confidence: Low*.

---

### 4. Synthesis & Confidence

**Area 9.** Agent identity is standardising fast: four IETF drafts (July-2026 instance profile, March-2026 AIP, the klrc auth drafts, OAuth 2.1) converge on a workload identity (SPIFFE/WIMSE) speaking OAuth — the exact "one client id ⇒ N concurrent agent instances" shape. Google Cloud, Microsoft, and Okta/Auth0 shipped SPIFFE-based agent identity in 2025–2026, so identity is becoming commodity; differentiation must come from *policy over identity*. Secret detection is an accurate-enough commodity (gitleaks recall 88%, GitHub precision 75%, TruffleHog verification) yet entirely post-hoc: the secret already exists in the object store and the remedy is leak→rotate→(sometimes) rewrite history. Primitives for doing better exist in fragments: Gerrit ref/path ACLs and OWNERS `per-file` grants, git-crypt/git-sops (path-driven encryption, partial-key access), SOPS (value-only encryption). Nobody has combined them into a first-class "secret-typed file" whose plaintext never lands in a blob and which an agent can be structurally denied — a genuine white space. MCP guidance is mature enough to design against. Confidence: **High** on direction, **Medium-High** on pricing, **High** that "secret-typed files + per-file agent policy" is unsolved.

_Platform takeaways:_ (i) give each agent *instance* a SPIFFE/WIMSE identity bound to a Durable Object (matching draft-mcguinness) for independent scopes/revocation; (ii) implement a real secret-typed-file primitive — ciphertext in the repo + policy record, Gerrit-style path ACLs for authorization, git-crypt/git-sops as the encryption model; (iii) make provenance mandatory per write (SLSA-shaped, model-attributed) so "which agent wrote this line" is queryable; (iv) adopt the MCP hardening checklist (per-request verify, no token passthrough, per-client consent).

**Area 10.** Adoption is near-universal (DORA 90%, SO 84%, Octoverse 80% of new devs use Copilot week one, JetBrains 90% weekly) while trust and org-level throughput collapse: SO trust-in-accuracy 40%→29% in a year; GitLab 7 hrs/team-member/week lost and only 37% would trust AI without review; Octoverse 43.2M PRs merged/month (+23%) makes the review queue the constraint. DORA's "amplifier" framing is the strategic insight — AI multiplies whatever system exists. The practitioner corpus names the pain and the wanted product: dynamic, risk-scored, independent-tool gating with humans on intent/design, PR-size limits, provenance — and says GitHub doesn't offer it. Empirically, agentic PRs fail on *context*, not code quality (AIDev 932k PRs; arXiv 2602.04226), while GitClear quantifies the maintainability tax (duplication +81%, refactoring −70%, legacy maintenance −74%). The buyer-side is forming: DX, LinearB, Jellyfish, Swarmia, Sleuth have all pivoted to measuring AI impact. Confidence: **High** on pain/adoption, **Medium** on multipliers (vendor-sourced) and pricing.

_Platform takeaways:_ (i) ship risk-score → auto-approve/route gating as headline UX (teams set thresholds; humans see above-threshold + daily digest) — the exact feature practitioners say GitHub lacks; (ii) build a dedup/conflict radar over the concurrent fleet, targeting the GitClear duplication signal and the "alternative solution exists" rejection cause; (iii) surface provenance + uncertainty in review (agent/model, confidence, whether tests/security files were touched) and export DX/LinearB-compatible metrics.

**Conclusions (confidence + corroboration count):**
- Agent identity standardising on SPIFFE/WIMSE + OAuth client assertions for many concurrent instances — **High** (4+ IETF drafts, Google, Microsoft, Okta).
- Secret scanning is accurate-enough commodity; all major tools post-hoc — **High** (2 vendors + 1 study).
- "Secret-typed files" exist but no agent-aware policy layer — **High** (git-crypt, git-sops, SOPS, Gerrit per-file ACLs).
- Review is now the bottleneck and top practitioner pain — **High** (DORA, GitLab, Octoverse, HN/Reddit, arXiv).
- Practitioners want risk-scored dynamic gating; GitHub lacks it — **High** (multiple HN comments + arXiv).
- Agentic PRs fail on context, not code quality — **Medium-High** (2 papers + AIDev).
- AI erodes maintainability metrics — **Medium-High** (GitClear, large dataset, single firm).

---

### 5. Sources Consulted

| # | Title | URL | Type | Date | Scraped? | Tier |
|---|---|---|---|---|---|---|
| 1 | OAuth 2.0 AI Agent Instance Profile | ietf.org/archive/id/draft-mcguinness-oauth-ai-agent-instance-00.html | Spec | 2026-07 | No | 95 |
| 2 | AI Agent Auth & Authz (klrc) | ietf.org/archive/id/draft-klrc-aiagent-auth-03.html | Spec | 2026 | No | 95 |
| 3 | Agent Identity Protocol | ietf.org/archive/id/draft-aip-agent-identity-protocol-00.html | Spec | 2026-03 | No | 95 |
| 4 | OAuth 2.1 framework | ietf.org/archive/id/draft-ietf-oauth-v2-1-13.html | Spec | 2025–26 | No | 95 |
| 5 | MCP spec 2026-07-28 Authorization | github.com/modelcontextprotocol/.../authorization | Spec | 2026-07 | No | 95 |
| 6 | MCP Security Best Practices (MS) | github.com/microsoft/mcp-for-beginners/.../mcp-best-practices.md | Docs | 2026 | No | 85 |
| 7 | MCP Security Best Practices (official) | modelcontextprotocol.io/docs/tutorials/security/security_best_practices | Docs | 2026 | No | 88 |
| 8 | MCP Tool Poisoning (OWASP) | community.owasp.org/attacks/MCP_Tool_Poisoning | Docs | 2025–26 | No | 88 |
| 9 | OWASP MCP Top 10 — MCP05 | owasp.org/www-project-mcp-top-10/2025/MCP05... | Docs | 2025 | No | 88 |
| 10 | State of MCP security 2026 (MS) | techcommunity.microsoft.com/.../4531327 | Blog | 2026-06 | Scraped(noise) | 70 |
| 11 | MCP Server Security (WSO2) | wso2.com/api-platform/learn/mcp-server-security-best-practices | Blog | 2026 | No | 55 |
| 12 | MCP security authz (Red Hat) | redhat.com/en/blog/mcp-security-implementing-robust-authentication-and-authorization | Blog | 2025–26 | No | 70 |
| 13 | MongoDB MCP Server Security | mongodb.com/docs/mcp-server/local-mcp/security-best-practices | Docs | 2026 | No | 75 |
| 14 | Maryland DoIT MCP Guidance v2 | doit.maryland.gov/policies/ai/.../MCP-Guidance... | Policy | 2026-09 | No | 72 |
| 15 | Agent Identity (Google Cloud IAM) | docs.cloud.google.com/iam/docs/agent-identity-overview | Docs | 2026 | No | 90 |
| 16 | MS perspective on agentic identity | techcommunity.microsoft.com/.../2111910 | Blog | 2026-04 | No | 72 |
| 17 | Okta secure AI agent identity | okta.com/blog/ai/okta-helps-secure-ai-agent-identity | Vendor | 2025-06 | No | 60 |
| 18 | Auth0 for AI Agents (2026) | okta.com/en-gb/newsroom/articles/auth0-may-2026-product-innovations | Vendor | 2026-05 | No | 62 |
| 19 | Auth0 Auth for GenAI press | okta.com/en-gb/newsroom/press-releases/auth0-platform-innovation | Vendor | 2025-04 | No | 62 |
| 20 | Auth0 AI Agents whitepaper | auth0.com/resources/whitepapers/securing-ai-agents-the-new-identity-challenge | Vendor | 2025–26 | No | 58 |
| 21 | Secrets-scanning comparative study | par.nsf.gov/servlets/purl/10505647 | Paper | 2023–24 | No | 85 |
| 22 | gitleaks (site/mirror) | gitleaks.io/ ; gitleaks.org/ | Vendor/OSS | 2026 | No | 70 |
| 23 | trufflehog repo | github.com/trufflesecurity/trufflehog | OSS | 2026 | No | 85 |
| 24 | GitHub Advanced Security plans | github.com/security/plans | Vendor | 2026 | No | 80 |
| 25 | GHAS pricing (Redress) | redresscompliance.com/microsoft-github-advanced-security-licensing | Blog | 2026 | No | 55 |
| 26 | GHAS splits (i-programmer) | i-programmer.info/news/149-security/17916-... | News | 2025-03 | No | 60 |
| 27 | Doppler pricing | doppler.com/pricing | Vendor | 2026 | No | 70 |
| 28 | Doppler pricing explained | envmanager.com/blog/doppler-pricing-alternatives | Blog | 2026 | No | 45 |
| 29 | Doppler vs Vault | doppler.com/doppler-vs-vault | Vendor | 2026 | No | 50 |
| 30 | Infisical Vault alternatives | infisical.com/blog/hashicorp-vault-alternatives | Vendor | 2026 | No | 55 |
| 31 | Infisical vs Vault | infisical.com/compare/infisical-vs-hashicorp-vault | Vendor | 2026 | No | 52 |
| 32 | Infisical pricing (outmano) | outmano.com/compare/cookieyes-vs-infisical | Aggregator | 2026 | No | 35 |
| 33 | Infisical pricing (deployable) | deployable.sh/apps/infisical/pricing | Blog | 2026 | No | 40 |
| 34 | SLSA verifying artifacts | github.com/slsa-framework/slsa/.../verifying-artifacts.md | Spec | 2025–26 | No | 92 |
| 35 | SLSA provenance | slsa.dev/provenance | Spec | 2025–26 | No | 92 |
| 36 | SLSA generator sigstore pkg | pkg.go.dev/github.com/jobroe10/slsa-github-generator/signing/sigstore | Docs | 2022 | No | 55 |
| 37 | Gerrit access-control.txt | gerrit.googlesource.com/gerrit/+/refs/heads/master/Documentation/access-control.txt | Docs | Current | No | 92 |
| 38 | Gerrit code-owners backend | github.com/GerritCodeReview/plugins_code-owners/.../backend-find-owners.md | Docs | Current | No | 88 |
| 39 | Gerrit find-owners syntax | gerrit.googlesource.com/plugins/find-owners/.../syntax.md | Docs | Current | No | 85 |
| 40 | git-crypt README + manpage | github.com/AGWA/git-crypt/blob/master/README.md ; manpages.debian.org/testing/git-crypt/git-crypt.1.en.html | OSS/Docs | Current | No | 85 |
| 41 | getsops/sops | pkg.go.dev/github.com/getsops/sops/v3 | Docs | Current | No | 85 |
| 42 | ivandeex/git-sops | github.com/ivandeex/git-sops | OSS | Current | No | 55 |
| 43 | 4 secrets tools for Git | opensource.com/article/19/2/secrets-management-tools-git | Blog | 2019-02 | No | 50 |
| 44 | Altered Histories in VCS (arXiv) | arxiv.org/pdf/2509.09294 | Paper | 2025-09 | No | 88 |
| 45 | secret-history / secret-time-machine | github.com/raksbisht/secret-history ; github.com/LakshmiSravyaVedantham/secret-time-machine | OSS | 2026 | No | 32 |
| 46 | git-history docs (2.54) | git-scm.com/docs/git-history/2.54.0 | Docs | 2025–26 | No | 90 |
| 47 | WebAuthn/Passkeys (webauthn.me, MDN, Yubico, FIDO) | webauthn.me/passkeys ; developer.mozilla.org/.../Passkeys ; developers.yubico.com/WebAuthn/Passkeys.html ; fidoalliance.org/passkeys/ | Docs | Current | No | 78 |
| 48 | DORA 2025 report | dora.dev/dora-report-2025 | Report | 2025-09 | Scraped | 92 |
| 49 | DORA 2025 Infographic PDF | dora.dev/research/2025/2025-DORA-Report-Infographic.pdf | Report | 2025 | Failed | 88 |
| 50 | DORA 2025 announcement + Register + Thoughtworks | cloud.google.com/blog/.../announcing-the-2025-dora-report ; theregister.com/software/2025/09/24/dora-report-reframes-... ; thoughtworks.com/en-ca/insights/reports/the-2025-dora-report | Blog/News/Vendor | 2025-09 | No | 74 |
| 51 | SO Survey 2025 (results, AI, press, leaders) | stackoverflow.blog/2025/07/29/developers-remain-willing-... ; survey.stackoverflow.co/2025/AI ; stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey ; stackoverflow.co/internal/resources/.../ai-adoption | Survey | 2025 | No | 85 |
| 52 | Octoverse 2025 | github.blog/2025-10-28-octoverse-... | Blog | 2025-10 | No | 85 |
| 53 | 986M code pushes | github.blog/news-insights/octoverse/what-986-million-code-pushes-... | Blog | 2025-11 | No | 80 |
| 54 | GitHub Universe 2025 | azure.microsoft.com/.../github-universe-2025-... | Blog | 2025-10 | No | 70 |
| 55 | GitLab AI Paradox (press + IR) | about.gitlab.com/press/releases/2025-11-10-gitlab-survey-reveals-the-ai-paradox ; ir.gitlab.com/news/.../GitLab-Survey-Reveals-the-AI-Paradox... | Press | 2025-11 | Scraped | 82 |
| 56 | GitClear Maintainability Gap | gitclear.com/the_ai_code_quality_maintainability_gap | Report | 2026 | Scraped | 70 |
| 57 | GitClear Copilot Code Quality 2025 | gitclear-public.s3.../GitClear-AI-Copilot-Code-Quality-2025.pdf | Report | 2025-02 | No | 68 |
| 58 | GitClear press mentions | gitclear.com/press_mentions | Aggregator | 2026 | No | 50 |
| 59 | "Endless Stream of AI Slop" | arxiv.org/html/2603.27249v4 | Paper | 2026 | Scraped | 88 |
| 60 | Why Agentic-PRs Get Rejected | arxiv.org/html/2602.04226v1 | Paper | 2026 | No | 85 |
| 61 | Agentic PRs merged/rejected | arxiv.org/pdf/2605.22534v1 | Paper | 2026-05 | No | 85 |
| 62 | Where AI Coding Agents Fail | arxiv.org/pdf/2601.15195 | Paper | 2026-01 | No | 85 |
| 63 | Rethinking Code Review (arXiv) | arxiv.org/abs/2605.17548 | Paper | 2026-05 | No | 85 |
| 64 | AIDev dataset (Emergent Mind) | emergentmind.com/topics/aidev-dataset-corpus | Aggregator | 2026 | No | 55 |
| 65 | HN threads (PR load, truths, AI PRs, Continue, review) | news.ycombinator.com/item?id=48329446 ; =47545748 ; =46168091 ; =47049848 ; =43402136 | Forum | 2025–26 | Yes(one) | 45 |
| 66 | Reddit r/ExperiencedDevs threads | reddit.com/r/ExperiencedDevs/comments/1nx21xo/... ; /1kr8clp/ ; /1vg0cx8/... | Forum | 2025–26 | No | 40 |
| 67 | 10x.pub 98% more PRs | tianpan.co/forum/t/we-ship-98-more-prs-... | Forum | 2026-03 | Scraped | 35 |
| 68 | DX 5 AI metrics + 2026 benchmarks + research | getdx.com/blog/5-metrics-in-dx-to-measure-ai-impact/ ; getdx.com/blog/2026-dx-benchmarks-are-now-available/ ; getdx.com/blog/insights/ | Vendor | 2025–26 | Scraped(one) | 68 |
| 69 | LinearB vs DX | linearb.io/compare/dx-vs-linearb | Vendor | 2026 | No | 50 |
| 70 | Swarmia pricing | swarmia.com/pricing | Vendor | 2026 | No | 68 |
| 71 | Jellyfish vs DX | jellyfish.co/jellyfish-vs-dx/ | Vendor | 2026 | No | 50 |
| 72 | Sleuth vs Swarmia vs Jellyfish | sleuth.io/post/sleuth-jellyfish-swarmia | Vendor | 2025–26 | No | 48 |
| 73 | PanDev LinearB alternatives | pandev-metrics.com/docs/blog/best-linearb-alternative-2026 | Blog | 2026 | No | 40 |
| 74 | JetBrains agent adoption 2026 | blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026 | Research | 2026-08 | No | 75 |
| 75 | JetBrains coverage (i-programmer, GIGAZINE) | i-programmer.info/news/99-professional/19118-... ; gigazine.net/gsc_news/en/20260824-ai-coding-agent-adoption-trends | News | 2026-08/09 | No | 54 |
| 76 | AI coding market sizing | nipralo.com/blogs/best-ai-coding-tools-2026 | Blog | 2026 | No | 25 |

---

### 6. Gaps, Uncertainties & Inaccessible Sources
- **DORA infographic PDF** — all firecrawl PDF engines failed; headline stats recovered from snippets + The Register; full report body not scraped.
- **Hacker News** — firecrawl returned HTTP 419; rerouted via the `read` tool's HackerNews reader. One thread fully captured; others cited from search snippets.
- **Microsoft Tech Community MCP page** — JS-rendered; returned nav JSON. Only the search-snippet quote used.
- **GitHub artifact attestations / sigstore adoption statistics** — no quantified adoption found; mechanism only. Open gap.
- **Descope / OpenFGA / per-file authz products** — surfaced only tangentially; not profiled.
- **Pricing conflicts** — Infisical $18–23 across SEO pages; Doppler $8/$21 confirmed on primary; Jellyfish/DX/LinearB third-party-estimated. Non-primary figures approximate.
- **Bottleneck multipliers** (98%/91%/4.6×) are secondary citations of vendor benchmarks (Index.dev, Faros AI, Opsera); unverified — Low-Medium confidence.
- **Causation** — GitClear shows correlation, not causation. METR's 19% slowdown claim reached us only via a secondary blog → excluded.
- **Recency** — several 2026 vendor/SEO blogs have thin methodology; labelled Low confidence in-text.

---

### 7. Tool Quick-Reference

| Tool | Category | Standout/unique | Pricing (entry → enterprise) | Segment | Stack/architecture | Refs |
|---|---|---|---|---|---|---|
| gitleaks | Secret scanning | MIT; regex+entropy; top recall (88%); GitHub Action; 19k stars | Free → free self-host | Devs, security, CI | Go; `gitleaks.toml` rules | 21–23 |
| TruffleHog | Secret scanning | 800+ types; live-credential verification | Free OSS → enterprise | Security, CI | Go; per-provider verifiers | 23, 21 |
| GitHub Secret Protection | Secret scanning | Push protection; 75% precision; Apr 2025 GA split | $19/active committer/mo | GitHub orgs | Native; 90-day window | 24–26 |
| GitHub Code Security | SAST | CodeQL + AI remediation; attestations | $30/active committer/mo | GitHub orgs | CodeQL | 24, 26 |
| Infisical | Secret manager | MIT core; scanning; cert lifecycle; SPIFFE JWT-SVID; 27k stars | ~$18–23/mo → quote | Startup→enterprise | Per-seat; self/managed | 30–33 |
| Doppler | Secret manager | Per-seat simplicity; unlimited service accounts; "for Agents" | Free(3) → $8 → $21/user → custom | Dev teams | SaaS per-seat | 27–29 |
| HashiCorp Vault | Secret manager | Broadest engines; X.509+JWT SVIDs; KV v2 | Free CE → opaque enterprise | Large enterprise | Self/Dedicated; IBM-owned | 30, 31 |
| SOPS | Secret-in-repo crypto | Cleartext keys, encrypted values; KMS/age/PGP | Free OSS | Platform teams | YAML/JSON structure preserved | 41 |
| git-crypt | "Secret-typed files" | Transparent per-file encryption at commit; partial access | Free OSS | Platform teams | Path/attribute-driven; GPG | 40 |
| git-sops | "Secret-typed files" | Decrypted worktree, encrypted index/blobs/remote | Free OSS | Platform teams | git smudge/clean | 42 |
| sigstore | Signing/provenance | Keyless signing; transparency log | Free OSS | Supply chain | Fulcio + Rekor | 36 |
| SLSA | Provenance framework | Levels 1–4; in-toto attestations; verification spec | Free spec | Platform/security | Provenance predicate | 34, 35 |
| SPIFFE/SPIRE | Agent identity (OSS) | `spiffe://` SVIDs; the model IETF builds on | Free OSS | K8s, agent platforms | X.509+JWT; trust bundles | 1, 2, 15 |
| Okta/Auth0 for AI Agents | Agent identity | Auth for MCP; Agent as Principal; On-Behalf-Of; Token Vault | Free→paid→enterprise | SaaS builders | OAuth token exchange | 17–20 |
| Google Cloud Agent Identity | Agent identity | Attested SPIFFE identity per agent; 2-legged OAuth | GCP consumption | GCP enterprises | SPIFFE + IAM | 15 |
| Microsoft Entra Agent ID | Agent identity | MCP/A2A/OAuth/SPIFFE convergence | Entra licensing | MS enterprises | Entra | 16 |
| Gerrit (+code-owners) | Per-file access control | Ref-level ACLs; inheritance; `per-file` OWNERS grants | Free OSS | OSS/large enterprise | Group ACLs; in-repo OWNERS | 37–39 |
| DX | Engineering analytics | DXI linked to $; 4-dim AI framework; Core 4 | ~$10–20/seat → quote | 500+ orgs | Survey + telemetry | 68, 73 |
| LinearB | Engineering analytics | DORA + leading indicators; AI-aware automation; 8.1M-PR benchmarks | Custom (mid-range) | Mid→large orgs | PR/repo telemetry | 69, 73 |
| Jellyfish | Engineering analytics | Exec/finance: cost per feature, R&D capitalization | ~$50–100K/yr | Enterprise | Person/team metrics | 71, 73 |
| Swarmia | Engineering analytics | Balanced research-backed metrics; free <10 devs | Free → $23 → $45/dev/mo | Startup→enterprise | PR + issue telemetry | 70 |
| Sleuth | Engineering analytics | Delivery progress; PR Review Lag Time | Entry/custom | Simple-DORA teams | Deploy/PR analytics | 72 |
| GitClear | Code-quality analytics | Diff Delta per-model attribution; live industry charts | Free scorecard → paid | VPs eng, CTOs | Lineage-aware diff (600M+ commits) | 56–58 |
