# Slice pack — E7-verify

**Kind:** verification · **Epic:** E7 — Agent workspaces & harness onboarding · **Milestone:** M1
**Epic goal:** An operator provisions N isolated agent workspaces from one baseline in one command and onboards real agent CLIs — omp, codex, and BYO harnesses — through a machine-legible standard; each workspace pushes independently and emits events.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E7-verify.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E7-verify-<short-slug>`), title, kind, epic="E7", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = verification: author verification stories for the built requirements here.

## Your requirements (FR-34, FR-35)
### FR-34 — Provision N isolated workspaces
- status: `built (N≥4 proven live 2026-10-03)`
- needs: implementation=false, verification=true
- description: An operator can provision N isolated agent workspaces from one baseline in one command. Realizes UJ-1.
- consequences (testable):
  - One command creates N forks with scoped tokens; each accepts independent pushes; each push emits an event.
  - Provisioning guarantees discoverability before tokens are handed off (conventions naming, status ready); auto-discovery semantics are documented in the contract.
  - Demo floor: N≥4 real agents proven concurrently.
### FR-35 — Harness onboarding and routing
- status: `built (omp + codex verified) / pending (more harnesses via routing)`
- needs: implementation=true, verification=true
- description: An operator can onboard real agent CLIs — starting with omp and codex — and bring their own harness. Realizes UJ-1.
- consequences (testable):
  - omp and codex routes produce real proposals against the baseline (verified; claude/gemini/opencode are standing auth items, not blockers).
  - BYO harness is supported through the standard interface: agents edit their own clones; the runner/orchestrator commits and performs the single three-refspec push; agents never push refs.
  - The platform ships a machine-readable tool manifest + structure map into every workspace (engineering law: no context-blind agents).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `provision-isolated-workspaces-with-full-lifecycle` [pending] Provision isolated workspaces with full lifecycle (overlap 3)
- `capability-parity-vs-github` [pending] Capability parity harness vs GitHub baseline (overlap 2)
- `fan-out-artifacts-repo-events-through-queues` [pending] Fan out Artifacts repo events through Queues (overlap 2)
- `law-12-merge-workspace-transparency-woven-through-the-experi` [pending] Law 12: merge/workspace transparency woven through the experience (overlap 2)
- `prototype-rung-2-echoes-agent-memory-routing` [pending] Prototype rung-2 echoes: agent memory, routing (overlap 2)
- `provider-agnostic-agent-launch-unify-8-harness-formats` [pending] Provider-agnostic agent launch: unify 8 harness formats (overlap 2)
- `route-agent-llm-traffic-through-ai-gateway` [pending] Route agent LLM traffic through AI Gateway (overlap 2)
- `support-multi-repo-workspaces-for-agent-reasoning` [pending] Support multi-repo workspaces for agent reasoning (overlap 2)
- `weave-workspaces-through-the-whole-experience` [pending] Weave workspaces through the whole experience (overlap 2)

## Architecture context
Constraints:
- CPU budget: Workers CPU 30 s default / 5 min max per HTTP request; all change-set/conflict work in-Worker diffs, no server-side git (SPINE:69; SPEC:53).
- Artifacts limits: 1 GB/repo · 32 MB/file · 2k git req/10 s/repo; no server-side merge/diff/conflict/branch-protection — the platform builds them (SPEC:51); 32 MB/blob wall stands (MEMLOG:21). Push ~64 MiB cap → small incremental pushes; push protocol v1-only (SPEC:52).
- Runtime pin: compat 2026-09-01, no `nodejs_compat` (in-tree fs/Buffer shims) (SPINE:162,135); isomorphic-git ^1.43.0 (v1 wire; SPEC names 1.42.x — verified compatible REAL:53).
- Environments: one environment (live demo `nextgit-platform.john-b7d.workers.dev`); no staging split until auth seam + non-demo data (SPINE:177,251).
- Fork walk limit 200 on change-set diffing; landing preconditions `stale`/`base-moved` (SPINE:75).
- Events/polling plan: `/events` ≤50 newest; KV single writer; queue single consumer; dedupe `(type,repo,ref,after)`; polling only as fallback (SPINE:93); live-feed transport (SSE/WS) deferred until polling latency is real at scale (SPINE:253).
- Scale budget unresolved: `/proposals` fully recomputes per poll; only AD-2's CPU sentence bounds it; a P2 cache item is the implicit home (RUB:33); brief flags the 20–50-proposal fleet view as a known engineering budget item (BRIEF:64).
- Token lifecycle: worker tokens minutes-TTL, single-use, revoked in `finally`; agent tokens hours-scale; 0600 outside repos/transcripts; never logs/argv; mint/use/revoke audited (SPINE:99).
- Auth/demo: `AUTH_MODE` default deny; demo allowlist `demo`/`agent-*`; rate limits on `/land`,`/merge`,`/proposals`,`/judge`; seam enforced before first non-demo data (SPINE:111).
- Judge: pinned model, fail-closed, per-caller budget/rate caps, auto-land requires injection-spike pass + non-model corroboration (SPINE:123).
- Deploy/log hygiene: lockfile-pinned wrangler only; worker logs never Authorization headers or request bodies (SPINE:135).
- Gate rule: 0 ship-blockers + 0 highs; contract smoke in each platform VERIFY (SPINE:129).
- Write protection is ours to enforce: CF `read_only:true` flag does NOT constrain binding-level writes (probe landed on a read-only fork) — never assumed as a guard (MEMLOG:39).
- No Windows/GPU/macOS hosting; no servers to run; only local dependency is the loop host (SPINE:147,177).
Near-term capabilities:
- Judge layer wiring (P0): `POST /judge` + `AI` binding + typed envelope + card-signal vocabulary, contract-pinned before the wave (SPINE:119-123; MEMLOG:34 `judge-contract-pin` P0).
- Landing path hardening (P0): reviewed-heads fields + evidence object + `base-moved` preconditions + AD-9 allowlist/rate rules as one work order, contract bump first (SPINE:244; MEMLOG:34).
- Event pipeline: Queues → worker (sole recorder, validation, dedupe) → KV → `/events` → UI (SPINE:89-93; `event-consumer-validation-dedupe` P1 MEMLOG:34).
- Store choices in scope: Artifacts (repos/forks/notes-mirror), KV `LIVE`, Queues `nextgit-events`, DO leases (`do-lease-serializes-lands` P1), Workflows provisioning (`workflows-provisioning` P1), R2 asset tier owning manifest/pointer format (`r2-asset-tier-manifest-format` P1) (SPINE:42-56,113-117; MEMLOG:34).
- Auth seam v1 + token lifecycle (P1) (SPINE:107-111; MEMLOG:34).
- Secret-class widening + scrub (P1) and the content-scan decision landing in CONTRACT before its unit ships (SPINE:81).
- Contract smoke in VERIFY gates + `tsc --noEmit` type gate (`contract-smoke-verify-gates` P2) (SPINE:129; MEMLOG:34).
- Client contract: CONTRACT.md + 11-entity protocol + push-event surface; adapter synthesizes GitHub semantics (SPINE:137-141; capability map SPINE:226-237: CAP-1..10, CAP-10 deferred).
- Deferred (post-competition unless noted): game-asset pipeline internals, federation runners, fork community + intent router, staging/SSO split, jurisdiction, SSE/WS transport, macro-merging + SHOULD/COULD list (SPINE:248-254).
- Demo incorporation requirement: DO/Workflows/R2 introduction slices scheduled as work orders immediately after the spine (user requires demo incorporation) (SPINE:241; MEMLOG:9).

## Source refs
- PRD: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/prds/prd-cloudflare-git-comp-2026-10-06/prd.md
- Platform contract: /home/johnzealanddoyle/projects/cloudflare-git-comp/platform/CONTRACT.md · SPEC: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/specs/spec-next-git-platform/SPEC.md
- UX spines: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/
- Arch spine: /home/johnzealanddoyle/projects/cloudflare-git-comp/_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md
