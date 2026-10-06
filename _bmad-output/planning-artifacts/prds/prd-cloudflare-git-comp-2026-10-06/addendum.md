# Addendum — NextGit PRD (evidence pack + corpus index)

Companion to `prd.md` in this folder. Reference-heavy by design: this file stores the sourced numbers the PRD cites, the alternatives that were parked, and the index to every upstream artifact. It does not introduce new canon — where this file and an upstream spine disagree, the upstream spine wins (`ARCHITECTURE-SPINE.md`, `CONTRACT.md`, `SPEC.md` + companions are the hierarchy of record).

Working date: 2026-10-06.

## 1. Corpus index (PRD sources of record)

- **Brief (final):** `_bmad-output/planning-artifacts/briefs/brief-cloudflare-git-comp-2026-10-06/brief.md` + `addendum.md` — vision, audience, success criteria, scope, voice reference for the PRD.
- **SPEC (frozen contract):** `_bmad-output/specs/spec-next-git-platform/SPEC.md` — capabilities CAP-1 … CAP-10, constraints, success signal. Companions: `demo-scope.md` (MoSCoW, the five MUSTs, story, rubric mapping), `engineering-laws.md` (12 design laws + swarm rules), `stack.md`, `interface-contract.md` (11-entity client protocol), `fork-community.md` (CAP-10, post-demo).
- **Platform API of record:** `platform/CONTRACT.md` — frozen route shapes, v2 (2026-10-03); `/judge` shapes + card-signal vocabulary pinned 2026-10-06.
- **Architecture spine (final, 15 ADs):** `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`; reviews in `reviews/` (rubric / adversarial / security / reality); session record `.memlog.md`; walkthrough deck `walkthrough.html`. Implementation detail lives here — the PRD references AD-1 … AD-15, it does not restate them.
- **UX spines (draft — 4 adjudications pending):** `_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/DESIGN.md` + `EXPERIENCE.md`; reconciliation record `.working/reconcile-brief.md`; PRD working extracts `.working/` (in the PRD run folder).
- **Judge-layer catalog (36 ideas; 1–25 = first-wave source):** `docs/judge-layer-ideas.md`.
- **Research dossiers:** `_bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md` (feasibility, stack, Clef); `_bmad-output/planning-artifacts/research/competitive-multi-agent-git-platform-landscape-2026-10-02/research.md` (whitespace verification); `research/2026-10-02-agentic-git-platform-ecosystem-feature-matrix/report.md` (493-source feature matrix); `research/2026-10-02-platform-recon-briefs/`.
- **Brainstorm (narrative rationale):** `_bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/`.
- **State spine / loop records:** `docs/STATE.md`, `docs/CHECKPOINT.md`, `docs/NEXT-ACTIONS.md`, `docs/BUILD-LOG.md`; certification `porting/certifications/`.
- **Work registry (machine-readable):** `porting/tasks.db` — SQLite/WAL task store (~506 rows); the work queue derives from it. Next in the queue: this PRD → epics → the demo chain.

## 2. Evidence pack (sourced numbers used in the PRD)

Problem scale (why the convergence layer):
- **~41.7% cross-agent conflict rate across 33,596 agent-authored PRs** — feature-matrix dossier (arXiv study).
- **Frontier models detect 15–31% of human-flagged issues** — SWE-PRBench; technical dossier.
- **GitHub merge-queue silent-deletion incident: 2,092 PRs across 230 repos, 3 h 33 m undetected** — supports the attach-evidence thesis (brief addendum).
- **Cloudflare internal review system: 131,246 runs / 48,095 MRs in 30 days, ~3 m 39 s median** — the borrowable judgment pattern (technical dossier).
- **GitHub's own concurrency guidance** pushes partitioning to humans — "be thoughtful about partitioning work" (feature-matrix dossier [77]).

Whitespace (why this position):
- **No shipping product presents N concurrent agent change-sets as one comparable set with real conflict computation — no counterexample across six independent search efforts** (competitive dossier). Nearest alternatives: GitGhost (private beta), Whiteboard (single-branch, local), Entire (announced, unshipped).
- **Typed secret files unclaimed at platform level** — bounded absence, medium confidence (competitive dossier [59]; mechanics proven by git-crypt/SOPS).

Substrate + economics (why now):
- **Clef decision model:** median **209 ms** (`@cf/cloudflare/clef`) / **39 ms** (`clef-flash`); **$0.24 / $0.09 per M input tokens**; Apache-2.0 weights; System One API (Jev-compatible); measured cost ≈ **$0.00012 per judgment** (typical ≈520-token judgment; recorded 2026-10-05). Verified callable live from this account 2026-10-04; REST cold path ~1.3 s measured.
- **Artifacts envelope:** 1 GB/repo · 32 MB/file · 2k git req/10 s/repo; ~64 MiB push cap; push protocol v1-only; no server-side merge/diff/conflict/branch-protection — the platform builds them (SPEC constraints).
- **Workers envelope:** CPU 30 s default / 5 min max per request (SPEC constraints; AD-2).

Competition gate:
- **Rubric:** originality/prototype **50%** · multi-agent concurrency **25%** · UX **25%**; submissions due **2026-10-14**; single entry; winner presents at Cloudflare Connect SF (Oct 21); Workers + Artifacts mandatory; 5–10 min video + OSI license + run instructions. Eligibility resolved 2026-10-06 — the US-resident teammate files the entry (STATE.md; SPEC open question closed).

Live-proven facts (as of 2026-10-06, per STATE.md and spines):
- **N=4 isolated workspaces proven live 2026-10-03** (CAP-1).
- **Event pipeline proven live 2026-10-03** (push → queue → worker → KV → UI).
- **Real agent fleet working with two CLIs:** omp + codex verified producing real proposals; claude/gemini/opencode need logins (standing reds, owner: John).
- **Four concurrent `/land` race live-reproduced** (4 concurrent lands → 2×200, 2×500 credential-free) — reason the `base-moved` precondition + DO lease exist (AD-3/AD-10; P0 land-hardening).
- **Cloudflare `read_only:true` does not constrain binding-level writes** — probe landed on a read-only fork; write protection is enforced by the platform's own gating, never assumed as a platform guard (AD-9 follow-through).

## 3. Canon discipline — draft-brief deltas the PRD carries in corrected form

The UX reconcile (`reconcile-brief.md`) superseded five draft-brief claims; spines keep reality as canon. The PRD reflects the corrected form:

1. **"Fleet view" naming** — not UI copy; as-built labels are **Concurrent Proposals** / **Convergence Conflicts**. "Fleet" survives only as market language ("teams running agent fleets").
2. **Judge-layer framing** — the judge layer is **built & live** (2026-10-06): `platform/src/judge.ts`, `POST /judge`, chips browser-verified, suite 73/73. The draft-brief "live" claim was carried as "planned P0" at draft time; that is superseded — the layer shipped 2026-10-06. The auto-land gate remains off pending calibration.
3. **"No polling" product claim** — as-built polling is real: `/events` 2 s, `/proposals` 8 s. Resolved 2026-10-06: real-time transport is REQUIRED for Milestone 1; polling is the degraded fallback only (OQ-3 retired).
4. **"Access-controlled" secrets wording** — masking is **path-driven** by design in this version; elevated reveal (CAP-8) is sequenced to Milestone 2 behind the auth seam and the §7.5 auth decision gate (OQ-2 retired).
5. **Landing "validation evidence attached"** — the receipt today is the **short commit SHA** (+ `files`/`at` contract-defined, unrendered); rich validation evidence (checks + results, merged-SHA == tested-SHA, artifact attached to the landing record) is REQUIRED and ships with the land-hardening workstream, Milestone 1 (OQ-4 retired).

Two live UX-state deltas the PRD carries as build gaps: the `withheld-secret` and `conflict` card states are contract-defined but not rendered; `no-changes` has no dedicated banner yet.

## 4. Parked alternatives (with why)

- **"GitHub with agents bolted on"** — rejected: explicitly not what the competition asks for, and the wrong shape for set-level work.
- **Office-first (3D client as the product)** — parked: the office is a client of the platform API, not the platform; the flagship future consumer (CAP-9's proof).
- **Rebuild PM / issues** — parked: integrate rather than imitate; issues arrive when user pull demands it.
- **Game-asset pipeline internals (R2 chunking, locking, per-file ACLs)** — staged per AD-10; the R2 tier itself is in product scope (sequenced to Milestone 3, FR-47 — OQ-1 resolved 2026-10-06).
- **Always-on decision mesh / macro-merging / 10M-node scale** — SPEC non-goals; not this phase.

## 5. Architecture deltas — adjudicated (2026-10-06, John)

Recorded by the architecture extraction; adjudicated (PRD §14 resolved decisions):

- **R2 in AD-10** vs brief/SPEC's "binary-asset tier out" — the R2 tier IS in product scope; sequenced to Milestone 3 (FR-47); pipeline internals staged per AD-10.
- **CAP-8 elevated reveal** — deferred behind the auth seam; sequenced to Milestone 2 under the §7.5 auth decision gate; masked-by-default until then.
- **CAP-6 push goal vs polling fallback** — real-time transport REQUIRED for Milestone 1; polling is the degraded fallback only.
- **CAP-7 evidence** — rich validation evidence REQUIRED: checks + results, merged-SHA == tested-SHA, evidence artifact attached to the landing record; ships with the land-hardening workstream (Milestone 1).

## 6. Where the PRD's status tags come from

- **Built** — verified in `platform/CONTRACT.md` + `docs/STATE.md` + UX spine Open Items (2026-10-06); the judge layer added 2026-10-06 (`platform/src/judge.ts`, `POST /judge`, suite 73/73).
- **required-M1 / sequenced (Mn) / pending / roadmap** — architecture spine Open Questions + the loop's scheduled work orders (`docs/NEXT-ACTIONS.md`; land-hardening required-M1; event-consumer validation/dedupe and content-detection widening sequenced M2; auth seam + token lifecycle M2; DO lease unsequenced; judge wiring done 2026-10-06). The PRD's status vocabulary is normalized to these tags plus the `build-gap` qualifier (§0).
- **Build-gap** — contract-defined behavior the UI does not render yet (UX spine Open Items): first-load states, `withheld-secret`/`conflict` card states, `landed.files`, dedicated `no-changes` copy, CAP-8 reveal.
