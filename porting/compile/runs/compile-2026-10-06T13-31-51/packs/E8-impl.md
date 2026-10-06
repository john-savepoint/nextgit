# Slice pack — E8-impl

**Kind:** implementation · **Epic:** E8 — Identity: auth seam, tokens & elevated reveal · **Milestone:** M2
**Epic goal:** The platform is auth-ready and demo-open with zero credential egress: one default-deny authorize() chokepoint, short-lived scoped audited tokens, and elevated reveal existing only behind the seam — enforced before any non-demo data enters.
**Your output file (write exactly this one file):** /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/runs/compile-2026-10-06T13-31-51/slices/E8-impl.json

## Law (frozen — read /home/johnzealanddoyle/projects/cloudflare-git-comp/porting/compile/SCHEMA.md IN FULL)
- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").
- Every story: id (stable slug `E8-impl-<short-slug>`), title, kind, epic="E8", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.
- Cover EVERY requirement below. Slice kind = implementation: author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building).

## Your requirements (FR-31, FR-36, FR-45, NFR-6, UX-DR-1)
### FR-31 — Elevated reveal
- status: `sequenced (M2) (requires the auth seam and the §7.5 auth decision gate; not demo-able before them)`
- needs: implementation=true, verification=false
- milestone hint: M2
- description: Masked-by-default holds everywhere until an authorization mechanism exists. [OQ-2 (retired) — sequenced to Milestone 2 behind the auth seam.] *[SEQUENCED: elevated reveal — Milestone 2, behind the auth seam and the §7.5 auth decision gate. The demo shows schema-only views and the withheld notice; no value-reveal surface ships before the seam is enforced.]*
- consequences (testable):
  - No route or view exposes secret-class values today; the schema-only view and the withheld notice are the complete surface.
  - Elevated reveal requires the auth seam plus an explicit authorization rule; until then it does not exist anywhere in the product.
### FR-36 — Token lifecycle
- status: `sequenced (M2) (auth seam wave)`
- needs: implementation=true, verification=false
- milestone hint: M2
- description: Credentials are short-lived, scoped, audited, and never rendered. Realizes UJ-1.
- consequences (testable):
  - Worker-minted access tokens: single-use, TTL ≤300 s, revoked in a `finally` (as-built today). Repo git tokens: 24 h default, 7 d max. [ASSUMPTION: repo git token TTLs proposed.]
  - Token values live mode 0600 outside repos/transcripts, never in logs or argv; mint/use/revoke are audited at two surfaces: Worker logs (observability) and Artifacts token events (`token.created` / `token.revoked`).
  - No response ever contains tokens or credentials (architecture AD-9; the law holds today even though the seam is sequenced (M2)).
### FR-45 — Auth seam
- status: `sequenced (M2) (seam wave; hard precondition before non-demo data; the §7.5 auth decision gate precedes it)`
- needs: implementation=true, verification=false
- milestone hint: M2
- description: The platform is auth-ready and demo-open, with zero credential egress.
- consequences (testable):
  - A single `authorize(request, env, action, {repo|base})` chokepoint is called by every route; `AUTH_MODE` defaults to deny; the demo opts in explicitly (`demo`).
  - While demo, a repo allowlist (`demo`, `agent-*`) is enforced on every `base`/`repos` param; edge rate limits cover `/land`, `/merge`, `/proposals`, `/judge`.
  - The seam is enforced before the first non-demo data exists in the namespace; CSRF protection is required for the future cookie-based SSO path.
### NFR-6
- No response ever contains tokens or credentials — no exception; failure paths return fold artifacts only; no response carries shell snippets containing repo content or paths (AD-9).
### UX-DR-1
- GAP #5 — CAP-8 "elevated reveal" beat not implemented (schema-only / withheld views only) (`EXPERIENCE.md:272`).

## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)
- `auth-seam-v1` [pending] Auth seam v1: AUTH_MODE default-deny + authorize() chokepoint + repo allowlist (AD-9) (overlap 7)
- `elevated-reveal-for-authorized-viewers-demo-beat` [pending] Elevated reveal for authorized viewers (demo beat) (overlap 3)
- `schema-only-decoupled-views-for-secret-files-demo-beat` [pending] Schema-only decoupled views for secret files (demo beat) (overlap 3)
- `downscope-agent-tokens-to-least-privilege-per-repo` [pending] Downscope agent tokens to least privilege per repo (overlap 2)
- `fan-out-artifacts-repo-events-through-queues` [pending] Fan out Artifacts repo events through Queues (overlap 2)
- `harden-ci-supply-chain-pinning-egress-control-scoped-creds` [pending] Harden CI supply chain: pinning, egress control, scoped creds (overlap 2)
- `implement-repo-lifecycle-over-binding-rest-and-git` [pending] Implement repo lifecycle over binding, REST and Git (overlap 2)
- `inject-secrets-via-oidc-with-short-lived-credentials` [pending] Inject secrets via OIDC with short-lived credentials (overlap 2)
- `speculative-validation-of-the-fold-result-before-landing-dem` [pending] Speculative validation of the fold result before landing (demo SHOULD) (overlap 2)
- `token-lifecycle` [pending] Token lifecycle: account-scoped control-plane token + 0600 storage + audit (AD-7) (overlap 2)
- `watch-artifacts-64-mib-push-cap-v1-protocol-before-oct-14` [pending] Watch Artifacts 64 MiB push cap + v1 protocol before Oct 14 (overlap 2)

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
