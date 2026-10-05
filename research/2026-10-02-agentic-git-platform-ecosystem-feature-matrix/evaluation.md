# Phase 3 Evaluation — Cross-Report Assessment

**Date:** 2026-10-02
**Mode:** UltraDeep — 5 trajectory reports + 1 Artifacts recon + targeted verification round

---

## 1. Report Scores (1–5)

| Worker | Areas | Source diversity | Evidence depth | Coverage | Flags |
|--------|-------|-----------------|----------------|----------|-------|
| W1 ReviewAndWorkflow | 1–2 | 5 | 5 | 5 | G2/Capterra bot-walled; vendor benchmarks conflict; several enterprise prices unlisted |
| W2 AgentsAndForges | 3–4 | 5 | 5 | 5 | OpenHands claim unverified; Sourcegraph anti-bot; some vendor claims unverified |
| W3 ContextAndCanvas | 5–6 | 5 | 5 | 5 | Liveblocks pricing contradiction; several single-source adoption numbers; firecrawl 400s (tooling) |
| W4 CloudflareAndRuntime | 7–8 | 5 | 5 | 5 | Modal/scale claims vendor-only; Fly pricing approximate |
| W5 TrustAndMarket | 9–10 | 5 | 5 | 5 | DORA PDF unscrapable (headline only); HN partially blocked; bottleneck multipliers secondary |

**All areas score ≥4 across all dimensions → UltraDeep saturation threshold met (≥3).** No worker requires a depth-repair round; one targeted verification round dispatched for pivotal claims.

## 2. Contradiction Register

| # | Contradiction | Sources | Resolution |
|---|---------------|---------|------------|
| 1 | firecrawl_search rejects `limit`/`highlights` (HTTP 400) vs works fine | W3 vs W1/W4 | Tooling variance (likely parameter combination). Use `{query}`-only in future calls. No research impact. |
| 2 | Review-benchmark winners (Greptile 82% vs Macroscope 24% in each other's studies) | Vendor benchmarks W1 | Both vendor-run, opposite winners → present both, trust neither (report both sides). |
| 3 | Liveblocks free tier: 100 MAU vs 10k MAU | W3 internal | Unresolved → verification round Q3. |
| 4 | OpenHands "conflict-free parallel agents at thousands scale" vs consensus "no shipping product coordinates many agents on one repo" | W2 | Unverified → verification round Q1/Q2 (highest priority; affects whitespace claim + originality positioning). |
| 5 | Agent product concurrency caps (Jules 60, Replit 10) vs Cloudflare substrate capacity (50k workflows, 1.5k vCPU) | W2 vs W4 | Complementary, not conflicting: vendor caps are product/billing choices; substrate can exceed them. Frame accordingly. |
| 6 | AST merge "unsolved" (Difftastic) vs CodeCRDT convergence research | W3 internal | Consistent: CRDTs converge text/structures; semantic correctness (5–10% residual) unsolved → human review load-bearing. |

## 3. Confidence Aggregation

**High-confidence consensus (weight heavily in synthesis):**
- Review/validation is the binding constraint (DORA, GitLab, Octoverse, Stack Overflow; W2/W5 corroborated).
- Concurrency is already default and uncoordinated; agents are mutually blind (arXiv 33.6k-PR study; ~42% cross-agent structural collision rate).
- Cloudflare stack (Artifacts + Workflows + DO + Sandboxes) is sufficient end-to-end; scale ceiling = sandbox capacity (1.5k vCPU/account).
- Merge queue canon: predictive testing, merged-SHA == tested-SHA; build-graph-keyed lanes (Aviator affected-targets) closest analogue for agent fleets.
- Codebase-indexed review + deterministic fail-closed gates are the rarest valuable review capabilities; most LLM reviewers silently pass on error.
- Secret-typed files: mechanism proven in fragments (git-crypt/git-sops/SOPS + Gerrit per-file ACLs), no agent-aware policy layer exists → white space.
- Agent identity standardising (SPIFFE/WIMSE + OAuth client assertions for N concurrent instances); differentiate on policy, not identity.
- Conflict-aware task placement + review-triage UX = unfilled whitespace (pending verification round for the last-mile claim).

**Medium/flagged (→ uncorroborated-claims treatment in references.md):**
- OpenHands claims; adoption numbers (AGENTS.md ~20k/60k repos; MCP 10k–18k servers); GitClear maintainability correlations; bottleneck multipliers (98%/91%/4.6x); vendor ROI claims; benchmark scores across aggregators.

## 4. Follow-Up Decision

- UltraDeep rule: follow-up rounds until all areas ≥3 OR 3 rounds. Saturation met; **one verification round dispatched** for the decision-critical claims (OpenHands/multi-agent whitespace + Liveblocks pricing).
- Round targets: (Q1) OpenHands primary-source verification; (Q2) final whitespace sweep (products + research prototypes); (Q3) Liveblocks pricing.
- Output: `verify-round-1-trajectory.md` + compressed verdicts. If whitespace claim flips, one more targeted round follows; otherwise proceed to synthesis.

## 5. Cumulative Stats (pre-verification)

- Workers: 5 (+1 recon +1 verification); search cycles: ~82; deep-read pages: 130+.
- Sources: W1 69, W2 75, W3 78, W4 73, W5 76, recon 21 docs → ~390+ seen, 300+ unique expected after dedup.
- Tools profiled with quick-reference rows: ~100+ across workers.
