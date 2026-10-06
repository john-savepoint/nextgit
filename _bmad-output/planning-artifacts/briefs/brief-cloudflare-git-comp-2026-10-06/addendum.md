# Addendum — NextGit brief (supporting depth)

Depth that belongs downstream (PRD, pitch, architecture) rather than in the brief. The corpus of record already exists in this repo; this is the index plus the evidence pack.

## Corpus index (read these before PRD / demo / pitch work)

- **Frozen contract:** `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions (`demo-scope.md`, `engineering-laws.md`, `stack.md`, `interface-contract.md`, `fork-community.md`)
- **Platform API of record:** `platform/CONTRACT.md`
- **Research dossiers:** `_bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md` · `_bmad-output/planning-artifacts/research/competitive-multi-agent-git-platform-landscape-2026-10-02/research.md` · feature matrix `research/2026-10-02-agentic-git-platform-ecosystem-feature-matrix/report.md` · recon briefs `research/2026-10-02-platform-recon-briefs/`
- **Judge-layer catalog (36 ideas):** `docs/judge-layer-ideas.md`
- **Architecture spine (final — 15 ADs + 4-lens reviews):** `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`
- **UX spines (draft — key-screen mock + 4 live conflicts await John's pass):** `_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/` (`DESIGN.md` + `EXPERIENCE.md`)
- **Loop spine & records:** `docs/{STATE,CHECKPOINT,NEXT-ACTIONS}.md` · certification `porting/certifications/bootstrap-health-sweep.md`

## Evidence pack (key numbers, sourced)

- 41.7% cross-agent conflict rate across 33,596 agent-authored PRs (feature-matrix dossier, arXiv study)
- Frontier models detect 15–31% of human-flagged issues (SWE-PRBench; technical dossier)
- No shipping product does set-level concurrent-proposal triage — no counterexample across six independent search efforts (competitive dossier)
- GitHub's own concurrency guidance pushes partitioning to humans — "be thoughtful about partitioning work" (feature-matrix dossier [77])
- Typed secret files unclaimed at platform level — bounded absence, medium confidence (competitive dossier [59]; mechanics proven by git-crypt/SOPS)
- Competition rubric: originality/prototype 50% · concurrency 25% · UX 25%; submissions due 2026-10-14; winner presents live at Cloudflare Connect SF (Oct 21); Workers + Artifacts mandatory. Logistics: single entry; §3 eligibility satisfied — filed by the team's US-resident member.
- Clef decision model: median 209 ms (clef) / 38.8 ms (clef-flash); $0.24 / $0.09 per M input tokens; Apache-2.0 weights; System One API (Jev-compatible); measured cost ≈ $0.00012/judgment (2026-10-05)
- GitHub merge-queue silent-deletion incident: 2,092 PRs across 230 repos, 3h33m undetected (supports the attach-evidence thesis)
- Cloudflare internal review system: 131,246 runs / 48,095 MRs in 30 days, ~3m39s median — the borrowable judgment pattern (technical dossier)

## Alternatives considered & parked (with why)

- **"GitHub with agents bolted on"** — rejected: explicitly not what the competition asks for, and the wrong shape for fleet work.
- **Office-first (3D client as the product)** — parked: the office is a client of the platform API, not the platform; kept as a future consumer.
- **Rebuild PM / issues** — parked: integrate rather than imitate; issues module arrives when user pull demands it.
- **Game-asset tier (R2 chunking, locking, per-file ACLs)** — roadmap, staged after the convergence layer proves itself.

## What is not in this brief by design

- Implementation architecture — finalized spine (see index); `stack.md` remains the spec companion.
- UX specification — DESIGN.md + EXPERIENCE.md (draft; see index).
- Competitive teardown detail — lives in the dossiers above.
