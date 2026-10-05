---
title: 'technical research: next-gen git platform on Cloudflare'
type: 'technical'
topic: 'next-gen git platform on Cloudflare'
decision: 'Which concept and technical approach to commit to for the Cloudflare next-gen Git platform competition entry — validated for originality (prior art), feasibility (~9-day edge build), and architectural pattern fit.'
source: 'native run (2 rounds + verification) + competitive-run import'
status: 'complete'
preset: 'standard'
validation: 'normal'
claims: 'verified 14 / unverified 0'
created: '2026-10-02'
updated: '2026-10-02'
---

# technical research: next-gen git platform on Cloudflare

**Decision this research serves:** Which concept and technical approach to commit to for the Cloudflare next-gen Git platform competition entry — validated for originality (prior art), feasibility (~9-day edge build), and architectural pattern fit.

## Executive summary

**What to do:** Commit to building the **convergence layer** — a set-level triage surface where multiple agents' concurrent change-sets are compared, judged, and integrated as **one set** — as the submission's hero flow, on Workers + Artifacts. Anchor it with the unclaimed intent/trust bundle (git-notes decision records, typed secret files, signed agent identity), and demonstrate the substrate no surveyed competitor uses (Artifacts forks/events/tokens choreographed by Durable Objects, Queues, and Workflows).

**Three findings drive that:**

1. **The gap is real and doubly verified.** No shipping product presents N concurrent agent change-sets as one comparable set: absent across the imported competitive run's six search efforts [7] and independently re-checked for this report (see `verification-r1.md`). Nearest artifacts stop at one layer — per-PR review (GitHub [7], review vendors [7]), per-agent trails (GitGhost [7]), serialization-only locks (grit [8]), single-branch local visual review (Whiteboard [7]), execution-only fan-out (Warp [12]). The intersection is unoccupied.
2. **The stack is feasible today, with one designable risk.** isomorphic-git 1.42.x pushes over the v1 wire protocol — matching Artifacts' v1-only receive-pack — so interop is clean [4][27]. Review flows can bypass cloning entirely via Workers-binding reads and diff in-Worker inside the 5-minute CPU budget [3][38]. `refs/notes/*` provenance is explicitly supported [5], and the orchestration primitives (Workflows, Durable Objects, Queues) are proven [39][40]. The one open risk: the ~64 MiB push cap — unfixed, push-side only, avoidable by small incremental pushes [36].
3. **A buildable three-tier architecture already exists on paper.** Execution substrate (Weave-style entity merge [23][24], grit-style lock queues [8]) + judgment tier (Cloudflare's coordinator→7-specialists→arbitration pattern [9], scaled from one PR to N change-sets) + set-level triage UI (greenfield — the one piece with no precedent [45][46][47]). This maps directly onto the competition rubric's concurrency bucket — the 25% for multi-agent coordination, context preservation, review, and conflict handling — and gives the 50%-weighted originality criterion its target.

**Biggest caveat:** the absence claim is *unfalsified, not proven* — bounded by search coverage and stealth products (GitGhost's late beta is the cautionary example) [7]. The field moves weekly; GitHub Universe is Oct 28–29 — **after** submission [7]; Entire's overlapping platform is announced but unshipped [7]. Differentiation must be explicit against Whiteboard: set-level concurrency + cross-change conflict semantics + platform multiplayer, not "another visual reviewer" [7].

_Method: two research rounds (5 subagents) + fresh-context verification + a competitive-run import; all sources accessed 2026-10-02; raw digests and the claims ledger live beside this file._

## D1 — Landscape & prior art: the convergence layer is unoccupied

The field splits into four layers, and none composes into the target flow:

- **Execution / workspace isolation — solved and commoditized.** Worktree-per-agent fan-out (Warp's same-task-different-agents pattern [12], Claude Code/Cursor/Codex worktrees), GitButler's parallel branches in one worktree [13], grit's function-level AST locks [8], Augment's spec→tasks→sequential-merge [14].
- **Review — per-change only.** CodeRabbit/Greptile/Qodo/Macroscope review one PR [7]; Cloudflare's internal system runs **seven specialist reviewer agents plus a judge on a single PR** [9]; Greptile's "swarm" still reviews one PR [7].
- **Integration — ordered, not comparative.** Stacked diffs (GitHub public preview; Devin's stacks [16]) and merge queues (Trunk, Mergify, the Bors lineage [26]) sequence changes; they never compare competing proposals.
- **Research / infrastructure.** CoAgent's serializability protocol (MTPO; research prototype, ~1.4× speedup [10]); conflict-rate quantification — 41.7% cross-agent textual conflict across 33,596 agent PRs / 2,807 repos [11]; Artifacts as the intended substrate for "the layer above" [1].

Movement worth knowing: Factory raised $200M at $5B with no public evidence of a compare/merge flow [15]; Entire (ex-GitHub CEO, $60M) ships weekly but its coordination platform remains unshipped [7]; GitGhost's beta (per-change evidence trails) is the closest commercial adjacency [7].

**Verdict:** no system composes parallel agent proposals with review/judge while preserving intent and presenting N proposals for comparison before merge. The intersection is unoccupied — exactly what the competition brief asks for ("compare multiple changes at once") [1].

## D2 — Architecture patterns in practice: isolation wins, reconciliation is the frontier

- **Coordination topology:** worktree-isolated fork-per-agent dominates; shared-workspace soft isolation is a documented failure — on PaperBench, soft isolation (55.5%) scores *below* single-agent (57.2%) while worktree isolation reaches 63.3%; the agent optimum is task-dependent — four agents on Commit0, two on PaperBench [18].
- **Merge craft:** line-based merge is structurally inadequate at agent churn rates [11][22]; AST/entity-level merge is emerging and borrowable (Mergiraf's tree-sitter+GumTree structured merge [23]; Weave's entity-level 3-way merge [24]). CRDTs *for code* remain research-grade — Weave deliberately decouples merge from CRDT, using the latter only for advisory coordination [24].
- **Failure patterns to engineer against:** GitHub's merge queue silently deleted reviewed code — 2,092 PRs across 230 repos, 3h33m undetected [19][20][21]; parallel subagents silently drop features at merge with no error or test signal [22]; flake amplification makes deep CI batching fragile: at a 3% flake rate, 8-deep batches disrupt 21.6% of merges (P = 1 − (1 − f)^k) [25].
- **Landing discipline:** the landed commit must equal what a human would merge [21]; stacked-diffs/patch-series is the proven human-scale workflow to echo (Meta ~100% adoption; Google chained CLs) [17].
- **Thin spot (flagged):** no public production account of multi-agent merge coordination on Workers/Durable Objects was found in either run — genuinely unbuilt territory.

## D3 — Implementation reality & dependency vitality: a feasible stack in ~9 days

- **Git engine:** isomorphic-git 1.42.6 (MIT, 2.1M weekly downloads) supports merging with a custom `mergeDriver` for conflict resolution [27][28]. Security history is the caveat: CVE-2026-89011 (prototype pollution in `getRemoteInfo`) affects versions before 1.42.0 and is fixed in 1.42.0 [31]; six further advisories published June–September 2026 include symlink/path-traversal file-write on checkout (one with potential RCE) and DoS issues [48]. Pin the latest 1.42.x, never check out untrusted trees to disk, and keep an advisory watch. Other open risks: conflict-detection ergonomics (issue #325, open since 2018) [29] and large-repo packfile timeouts (issue #2017, open since 2025-01) [30].
- **Parsing/diffing:** `jsdiff`/`diff3` for line-level; `web-tree-sitter` 0.27.0 if grammar-aware diffs prove worthwhile — 4.5 MB runtime + ~407 KB per grammar, viable but unmeasured at the edge [32].
- **State:** CRDT options are all active — Automerge 3.5.0 [33], Loro 1.16.4 [34], Yjs v14 (RC) [35] — usable for review-comment / coordination state, never as the code-merge mechanism.
- **Choreography:** Workflows (10k steps default, 50k concurrent; idempotent steps required) + Durable Objects + Queues [39][40]; ordering must be designed explicitly, not assumed.
- **Storage:** Artifacts is a git-compatible versioned filesystem — 1 GB/repo, 32 MB/file, 2k git req/10s/repo [2]; event subscriptions via Queues [6]; `refs/notes/*` supported [5]. `wasm-git` (libgit2-WASM) exists but has zero production reports [41].
- **Bottom line:** buildable, confidence medium-high for code/text repos; the pack cap and the client-side merge engine are the two named build risks.

## D4 — Feasibility hardening (round 2): the risk surface, closed

- **~64 MiB push cap:** still **open, no ETA, no workaround posted**; threshold exact (63 MiB passes, 64 MiB → HTTP 500); **push-side only** — clone/fetch unaffected; the limits page does not list it [36]. Design response: small incremental pushes; review via binding reads.
- **Protocol interop:** Artifacts smart-HTTP = push **v1-only** (v2 receive-pack explicitly unsupported), clone/fetch v1+v2; isomorphic-git's default v1 push matches — compatible, no friction [4][27].
- **Binding-side diffing:** `readFile`/`readCommit`/`readTree`/`readBlob` work over arbitrary refs; Workers Paid CPU is 30 s default, configurable to 5 min — commit-sized diffs run well under a second, so review flows can avoid clone/pack entirely [3][38].
- **Provenance:** Cloudflare's own best-practices page says "use git notes for prompts and model output" and documents pushing `refs/notes/*` [5].
- **Ecosystem:** small but real — vibesdk's artifacts-viewer is the only *product* [37]; plus a cloudflare/ci example [42], a starter [43], and a tutorial [44]. No third-party commercial build yet: the substrate is unclaimed.

## D5 — Design precedents: substrate, judge, and the greenfield triage UI

- **Substrate — borrow.** Weave's entity-level merge as a pure function over base/ours/theirs, with CRDT advisory claims decoupled [24]; grit's claim→work→done lock queue for contested symbols [8]. Both are early-adopter tech with no production reports — borrow concepts, verify fit in the build.
- **Judge — borrow and scale.** Cloudflare's coordinator + seven specialist reviewers + risk tiers + developer-arbitration loop is the strongest existing pattern for judging change-sets: median review 3m39s, 131,246 runs across 48,095 MRs in its first 30 days — **on one PR** [9]. Scale it: specialists score each proposal in a set; the coordinator aggregates into one verdict; humans arbitrate disagreements.
- **Triage UI — greenfield.** No deployed product surfaces N competing *code* change-sets for side-by-side triage: borrow layout language from LLM output comparators [45], accept/reject mechanics from legal redlining [46], side-by-side annotation patterns from labeling tools [47], and GitGhost's session-evidence bridge as the closest human-review analogue [7].
- **Differentiation line:** set-level semantics + a cross-change conflict graph + platform multiplayer — explicitly ahead of Whiteboard's one-branch local review [7].

## Cross-dimension insights

1. **The verified gap and the verified substrate compose into one play:** the convergence layer is simultaneously the most original and the most practical submission — the rubric's originality criterion and its concurrency bucket both point at it.
2. **The missing layer decomposes into three sub-builds with asymmetric risk:** substrate (borrowable), judge (borrowable), triage UI (greenfield). Budget the novel effort on the UI and the change-set semantics around it.
3. **The trust bundle rides the same object.** Git-notes intent records + typed secret files + signed agent identity attach to the change-set; Cloudflare's notes guidance nudges the pattern [5] and the competitive prior-art survey found the bundle unclaimed at platform level [7].
4. **The constraint set dictates four engineering rules:** small incremental pushes (cap [36]); binding-side diffing, no clones in review [3]; client-side merge engines with **post-merge behavioral verification** (silent-drop guard [22]); shallow merge batches (flake math [25]).
5. **Timing favors shipping now:** the field before the deadline is quiet relative to what's coming (GitHub Universe Oct 28–29 post-dates submission [7]); the risk is a fast-follow, not an incumbent.

## Contrary evidence & disconfirmation log

- **Absence is unfalsified, not proven** — coverage limits: stealth/unlaunched products, non-indexed niches (imported run + the C1 absence check) [7]. Violation risk: GitGhost or Entire could shift the frame mid-build [7].
- **Whiteboard is the sharpest overlap and a moving target** (active development; hosted tier announced) [7].
- **Weave and grit carry no production deployment reports** — confidence limited to repo/doc evidence [8][24].
- **No edge benchmarks for tree-sitter diffing** — the "grammar-aware diffs" option is unproven at the edge [32].
- **UX precedents are search-surfaced only** — the weakest evidence in this run; treat as design inspiration, not verified precedent [45][46][47].
- **Sentiment evidence is directional** (Hacker News only; G2/Reddit blocked) [7].
- **The GitHub incident claim was verified against GitHub's own status page** — numbers match exactly; no dispute [19][20].

## Recommendations

1. **Commit to the convergence layer as the hero flow** — set-level triage of N concurrent agent change-sets as one surface. *(Basis: doubly-verified gap + rubric mapping; high confidence.)*
2. **Build the three-tier architecture into the demo's narrative:** substrate (Weave-style entity merge + grit-style locks) → judge (Cloudflare-pattern coordinator, scaled to sets) → triage UI (greenfield). *(Basis: borrowable pieces verified; UI greenfield; medium-high.)*
3. **Make intent first-class, stored as git notes** — per-change decision records (rationale, prompts, constraints) that are reviewable and mergeable. *(Basis: documented support [5]; unclaimed-bundle finding [7]; high on support, medium on differentiation.)*
4. **Ship one visible trust beat:** typed secret files with schema-only views and elevated reveal; leak-scrubbing secondary. *(Basis: competitive prior-art bundle unclaimed [7]; medium.)*
5. **Engineer within the constraints:** incremental pushes; binding-side diffing; client-side merge with behavioral post-merge verification; shallow batches; a pinned, advisory-watched git engine that never disk-checks-out untrusted trees. *(Basis: verified limits and failure patterns; high.)*
6. **Watch list, re-checked before submission:** GitGhost beta semantics; Entire launch state; GitHub changelog/Universe timing; cap-issue #29 progress (no update since 2026-08-17). *(Basis: trajectory signals; Refresh/Deepen lifecycle handles re-checks.)*

## Open questions

- Artifacts cap fix ETA — binary-heavy repos stay out of scope until fixed [36].
- Whether Durable Objects + Workflows provide sufficient ordering guarantees for a multi-agent merge protocol (design question, testable in the first build spike).
- Tree-sitter edge CPU cost for grammar-aware diffs — unmeasured [32].
- GitGhost's set-level semantics (private beta — verify or discount) [7].
- Whiteboard's hosted-tier/multi-branch roadmap [7].

## Source appendix

All sources accessed 2026-10-02.

| # | Supports | Publisher | Pub date | Access | Confidence |
|---|---|---|---|---|---|
| [1] | Competition brief; Artifacts as substrate; "compare multiple changes at once" | [Cloudflare Blog](https://blog.cloudflare.com/next-git-platform-on-cloudflare/) | 2026-10-01 | 2026-10-02 | high |
| [2] | Artifacts limits (1 GB/repo, 32 MB/file, 2k req/10s) | [Cloudflare Docs](https://developers.cloudflare.com/artifacts/platform/limits/) | 2026-10-01 | 2026-10-02 | high |
| [3] | Workers binding primitives for diffing | [Cloudflare Docs](https://developers.cloudflare.com/artifacts/api/workers-binding/) | 2026-10-01 | 2026-10-02 | high |
| [4] | Smart-HTTP protocol matrix (push v1-only) | [Cloudflare Docs](https://developers.cloudflare.com/artifacts/api/git-protocol/) | 2026-04-25 | 2026-10-02 | high |
| [5] | Git notes for prompts/model output; notes refs push/fetch | [Cloudflare Docs](https://developers.cloudflare.com/artifacts/concepts/best-practices/) | 2026-04-25 | 2026-10-02 | high |
| [6] | Event subscriptions via Queues | [Cloudflare Docs](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/) | 2026-10-01 | 2026-10-02 | high |
| [7] | Gap verification (6 searches); field map; Whiteboard/GitGhost/Entire; trust bundle unclaimed | [Competitive deep-recon run (import)](competitive-multi-agent-git-platform-landscape-2026-10-02/research.md) | 2026-10-02 | 2026-10-02 | high |
| [8] | grit: AST locks, claim-work-done, no review layer | [GitHub](https://github.com/rtk-ai/grit) | 2026-09 | 2026-10-02 | high |
| [9] | CF internal review: coordinator + 7 specialists; 131k runs/30d | [Cloudflare Blog](https://blog.cloudflare.com/ai-code-review/) | 2026-04-20 | 2026-10-02 | high |
| [10] | CoAgent MTPO concurrency control (~1.4×) | [arXiv](https://arxiv.org/abs/2606.15376) | 2026-06 | 2026-10-02 | high |
| [11] | 41.7% cross-agent conflict rate (33,596 PRs) | [arXiv](https://arxiv.org/abs/2607.04697) | 2026-07 | 2026-10-02 | high |
| [12] | Warp same-task-different-agents, manual compare | [Warp Docs](https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents) | 2026-09 | 2026-10-02 | high |
| [13] | GitButler parallel branches in one worktree | [GitHub](https://github.com/gitbutlerapp/gitbutler-docs/blob/main/content/docs/ai-agents/parallel-agents.mdx) | 2026 | 2026-10-02 | medium |
| [14] | Augment spec→tasks→sequential merge | [Augment Code](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace) | 2026 | 2026-10-02 | medium |
| [15] | Factory $200M/$5B; flow unverified | [Factory](https://factory.com/news/5-billion-valuation) | 2026-09-15 | 2026-10-02 | medium |
| [16] | Devin stacked PRs (ordered chains) | [Cognition](https://devin.ai/blog/introducing-pr-stacks) | 2026-07-30 | 2026-10-02 | high |
| [17] | Stacked diffs at Meta/Google/Uber scale | [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/stacked-diffs) | 2023-10-17 | 2026-10-02 | high |
| [18] | CAID: soft-isolation failure; task-dependent optimum | [arXiv](https://arxiv.org/html/2603.21489) | 2026-07 | 2026-10-02 | high |
| [19] | GitHub incident (official): 2092 PRs / 230 repos | [GitHub Status](https://www.githubstatus.com/incidents/zsg1lk7w13cf) | 2026-04 | 2026-10-02 | high |
| [20] | GitHub incident community thread | [GitHub Community](https://github.com/orgs/community/discussions/193645) | 2026-04 | 2026-10-02 | high |
| [21] | "Commit must equal human merge" lesson | [Trunk.io](https://trunk.io/blog/what-happens-if-a-merge-queue-builds-on-the-wrong-commit) | 2026 | 2026-10-02 | high |
| [22] | Silent feature-drop failure mode | [Autonoma](https://getautonoma.com/blog/ai-subagent-merge-conflicts) | 2026-04-16 | 2026-10-02 | medium |
| [23] | Mergiraf structured merge architecture | [Mergiraf](https://mergiraf.org/architecture.html) | 2024 | 2026-10-02 | high |
| [24] | Weave entity-merge + advisory CRDT; decoupled design | [Ataraxy Labs](https://ataraxy-labs.github.io/weave/docs.html) | 2026 | 2026-10-02 | high |
| [25] | Flake amplification math | [BuildPulse](https://buildpulse.io/blog/github-merge-queue-flaky-test-amplification) | 2026-09-25 | 2026-10-02 | high |
| [26] | Bors → TAP → merge-queue lineage | [Graphite](https://graphite.com/blog/bors-google-tap-merge-queue) | 2026 | 2026-10-02 | high |
| [27] | isomorphic-git 1.42.6; downloads; maintenance | [npm](https://www.npmjs.com/package/isomorphic-git) | 2026-09 | 2026-10-02 | high |
| [28] | mergeDriver API | [isomorphic-git](https://isomorphic-git.org/docs/en/mergeDriver) | 2026 | 2026-10-02 | high |
| [29] | Conflict-detection issue #325 (open since 2018) | [GitHub](https://github.com/isomorphic-git/isomorphic-git/issues/325) | 2018 | 2026-10-02 | high |
| [30] | Large-repo packfile issue #2017 | [GitHub](https://github.com/isomorphic-git/isomorphic-git/issues/2017) | 2025-01 | 2026-10-02 | high |
| [31] | CVE-2026-89011 detail: affects <1.42.0, fixed in 1.42.0 | [OpenCVE](https://app.opencve.io/cve/CVE-2026-89011) | 2026-09 | 2026-10-02 | high |
| [32] | web-tree-sitter 0.27.0; bundle sizes; no benchmarks | [npm](https://www.npmjs.com/package/web-tree-sitter) | 2026-10 | 2026-10-02 | medium |
| [33] | Automerge v3.5.0; funding status | [GitHub](https://github.com/automerge/automerge/releases) | 2026-06 | 2026-10-02 | high |
| [34] | Loro 1.16.4 | [GitHub](https://github.com/loro-dev/loro/releases) | 2026-09 | 2026-10-02 | high |
| [35] | Yjs v14-rc / v13 stable | [GitHub](https://github.com/yjs/yjs/releases) | 2026 | 2026-10-02 | high |
| [36] | ~64 MiB push cap (open, no ETA) | [GitHub Issue](https://github.com/cloudflare/developer-platform/issues/29) | 2026-06 | 2026-10-02 | high |
| [37] | vibesdk artifacts-viewer (only product) | [GitHub](https://github.com/cloudflare/vibesdk/blob/main/packages/artifacts-viewer/README.md) | 2026 | 2026-10-02 | high |
| [38] | Workers CPU limits (30 s → 5 min paid) | [Cloudflare Docs](https://developers.cloudflare.com/workers/platform/limits/) | 2026-09-05 | 2026-10-02 | high |
| [39] | Workflows limits (10k steps; 50k concurrent) | [Cloudflare Docs](https://developers.cloudflare.com/workflows/reference/limits/) | 2026-09-21 | 2026-10-02 | high |
| [40] | Workflows idempotency/ordering rules | [Cloudflare Docs](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) | 2026 | 2026-10-02 | high |
| [41] | wasm-git exists; zero production reports | [GitHub](https://github.com/petersalomonsen/wasm-git) | — | 2026-10-02 | low |
| [42] | Artifacts CI example | [GitHub](https://github.com/cloudflare/ci/tree/main/examples/cloudflare-artifacts) | 2026 | 2026-10-02 | medium |
| [43] | Artifacts starter | [GitHub](https://github.com/elithrar/artifacts-starter) | 2026 | 2026-10-02 | medium |
| [44] | Artifacts tutorial | [Flavio Copes](https://flaviocopes.com/cloudflare-artifacts) | 2026-08 | 2026-10-02 | medium |
| [45] | LLM comparator UX precedent | [Google PAIR](https://ai.google.dev/responsible/docs/evaluation/llm_comparator) | — | 2026-10-02 | low |
| [46] | Legal redline (accept/reject) UX precedent — search-surfaced, not fetched | [Draftable Legal Compare](https://www.draftable.com/draftable-legal-compare) | — | 2026-10-02 | low |
| [47] | Side-by-side annotation UX precedent | [Label Studio](https://labelstud.io/templates/llm_side_by_side) | — | 2026-10-02 | low |
| [48] | Advisory list: 7 advisories Jun–Sep 2026 (symlink writes, RCE-class checkout escape, DoS, path traversal) | [GitHub Security Advisories](https://github.com/isomorphic-git/isomorphic-git/security/advisories) | 2026-09 | 2026-10-02 | high |

## Staleness map

Computed with `recon_kit.py staleness` from the claims ledger (windows: version-compat 1 mo · capability/landscape 3 mo · vitality/scale-perf 6 mo · failure 12 mo · pattern 24 mo). **Earliest re-check: 2025-10-01 (already due — see notes).**

| Claim | Class | Source pub | Re-check |
|---|---|---|---|
| Stacked diffs proven at scale | pattern | 2023-10 | 2025-10-01 |
| Artifacts protocol matrix (v1 push) | capability | 2026-04 | 2026-07-01 |
| Git notes support | capability | 2026-04 | 2026-07-01 |
| CF internal review system | capability | 2026-04 | 2026-07-01 |
| ~64 MiB push cap status | capability | 2026-06 | 2026-09-01 |
| Whiteboard / GitGhost capability state | capability | 2026-09 | 2026-12-01 |
| isomorphic-git version + CVE | version-compat | 2026-10 | 2026-11-01 |

> Notes: (1) Live docs pages (protocol, notes, CF review) carry original pub dates but were accessed and revalidated 2026-10-02 — flags are mechanical. (2) The cap-issue flag is substantive: no update since 2026-08-17 — watch before submission. (3) The stacked-diffs article (2023) was confirmed still current via 2026 stacked-PR shipping — mechanical. (4) Refresh/Deepen on this folder handles all re-checks.
