# Verification — round-1 load-bearing claims (2026-10-02)

- **Verifier:** VerifierV1 (scout), fresh context, research firewall (granted only the three round-1 digest files)
- **Validation level:** `normal` — spot-check of load-bearing claims only
- **Scope:** five claims from `digests/d1-landscape-r1-a.md`, `d2-patterns-r1-b.md`, `d3-impl-r1-c.md`

## Per-claim verdicts

**C1 (D1) — No shipping product publicly integrates multiple concurrent agent change-sets as ONE set for comparison/review/merge.**
- **Verdict: verified** (independent check; 3 distinct search phrasings)
- Sources: Tracxn MergeWatch AI profile; agentFleet docs; Reddit r/vibecoding multi-agent threads
- Note: No counterexample found. Nearest products checked and rejected: agentFleet (fleet orchestration, no proposal comparison), MergeWatch AI (merge review, not concurrent-agent-proposal comparison), Augment Intent (sequential merge, not N-proposals-on-one-baseline). The composition — N agents fork same baseline → concurrent work → proposals compared → review → merge — is not shipped.

**C2 (D3) — isomorphic-git 1.42.x supports merge operations (merge/mergeDriver) and is actively maintained.**
- **Verdict: verified**
- Sources: npm isomorphic-git (v1.42.6, 2.1M weekly downloads, MIT); isomorphic-git.org mergeDriver docs; merge API docs

**C3 (D3) — Artifacts has a known ~64 MiB git-push cap (cloudflare/developer-platform issue #29), acknowledged, fix in progress.**
- **Verdict: verified**
- Source: github.com/cloudflare/developer-platform/issues/29 (opened 2026-06-01, updated 2026-08-17)
- Note: Exact threshold confirmed (64.02/64.03 MiB → HTTP 500). Cloudflare @NuroDev: "current known limitation of Artifacts that we're currently working on fixing." Issue open.

**C4 (D2) — GitHub merge queue silently deleted code (April 2026): ~2092 PRs / 230 repos, ~3h33m undetected.**
- **Verdict: verified** (multiple independent sources)
- Sources: githubstatus.com/incidents/zsg1lk7w13cf (official; 2092 PRs, 230 repos; deploy 16:05, detected 19:38 UTC); GitHub community discussion 193645; Trunk.io coverage; Hacker News corroboration
- Note: Numbers match exactly.

**C5 (D2) — CAID paper (arXiv 2603.21489): ~4-agent optimum and shared-workspace (soft-isolation) failure mode.**
- **Verdict: verified** — with a wording caveat
- Source: arxiv.org/html/2603.21489v2 (paper text + Table 3)
- Note: Soft-isolation failure explicit: on PaperBench, soft isolation 55.5% vs single-agent 57.2% vs worktree (CAID) 63.3%; paper states "sharing a workspace causes miscoordination." **Caveat:** "~4-agent optimum" is shorthand — the sweet spot is task-dependent (4 engineers optimal on Commit0(-Lite); main PaperBench results use 2). Report wording uses "task-dependent optimum (4 on Commit0, 2 on PaperBench)."

## Cross-digest contradictions
- **None found.** D1 (landscape/gap), D2 (patterns), D3 (implementation) align where they overlap; the Artifacts coverage in D1/D2/D3 is mutually consistent.

## Limitations
- C1: English-language indexed web only; stealth/private tools could exist. Claim covers *shipping* products — research prototypes (grit, CoAgent) excluded by framing.
- C5: HTML version read; PDF tables not exhaustively cross-checked.
- General: non-load-bearing claims (star counts, download figures) not re-verified.
- Budget: 8 sources, ~11 tool calls (slightly above the 6-source guideline to secure independence on C4; warranted).

## Lead adjudication
- All five claims stand **verified**; none downgraded.
- Report applies the C5 wording caveat and keeps the absence framing for C1 ("un-falsified, not proven" — consistent with the imported competitive run's own caveat).
- **Post-verification correction (dependency security):** after this verification, a primary-source check corrected CVE-2026-89011's affected range to `<1.42.0` (fixed in 1.42.0) and added the advisory-window note (7 advisories Jun–Sep 2026, incl. checkout file-write/RCE-class issues) to `research.md` [31][48] — logged as an event in the memlog.
