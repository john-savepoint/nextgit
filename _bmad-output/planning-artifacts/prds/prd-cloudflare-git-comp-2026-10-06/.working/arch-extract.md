# Architecture extraction — PRD inputs

Source run: `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/` (status **final**, updated 2026-10-05; memlog updated 2026-10-06T12:02). Read in full: ARCHITECTURE-SPINE.md, .memlog.md, all four reviews.

Citation aliases (full paths; `NN` = line):
- **SPINE** = `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`
- **MEMLOG** = `.../architecture-cloudflare-git-comp-2026-10-05/.memlog.md`
- **RUB** = `.../reviews/review-rubric.md` · **ADV** = `.../reviews/review-adversarial.md` · **SEC** = `.../reviews/review-security.md` · **REAL** = `.../reviews/review-reality.md`
- **SPEC** = `_bmad-output/specs/spec-next-git-platform/SPEC.md` · **DEMO** = `.../demo-scope.md` · **BRIEF** = `_bmad-output/planning-artifacts/briefs/brief-cloudflare-git-comp-2026-10-06/brief.md`

---

## 1. Status + 15 decisions

Status final (SPINE:8); 15 ADs — 12 `[ADOPTED]`, AD-9/10/11 `[NEW]` (SPINE:59-147). Review gate ran 4 lenses; all findings accepted, no rejections; amendments applied to AD texts; several fixes shipped live (MEMLOG:31-33,38). Paradigm: read-mostly CQRS edge worker; one gated write path, binding-native reads, judgment delegated, convergence at set level (SPINE:6,20-25).

1. **AD-1** One gated write path: worker's only git write = single-commit fold+push in `POST /land`; base branches written ONLY by `/land`; control-plane pushes limited to provisioning baselines + proposal repos; landing replays prohibited (SPINE:59-63).
2. **AD-2** Binding-native reads; review never clones; reads use Artifacts bindings within Workers CPU budget; only in-memory clone is inside `/land` (SPINE:65-69).
3. **AD-3** Fork-point semantics (first-parent walk limit 200; base-head fallback), 3-way ancestor = fork point; `landing.status` content-derived (zero-change → `landed`; `/land` no-changes → 409); reviewed-state precondition → 409 `stale`; concurrency precondition → 409 `base-moved`; landing records ancestor + heads + fold hash (SPINE:71-75).
4. **AD-4** Secret masking law: secret-class paths render key-names-only in ANY egress (bodies, folds, intent, logs, judge state); folds touching them → `withheld-secret`/409; free-text (intent/notes/errors) scrubbed; content-detected secrets decided once in CONTRACT (additive status or judge gate) (SPINE:77-81).
5. **AD-5** Provenance: intent as git notes pushed to `refs/notes/commits` + mirror branch `nextgit-notes` in one 3-refspec push; readers use the mirror; exactly one pusher = runner/orchestrator, agents never push; FF-only mirror (SPINE:83-87).
6. **AD-6** Events/feed: one queue consumer = sole recorder, dedupe on `(type,repo,ref,after)`; payload validation; KV `LIVE` single writer; `/events` ≤50 newest; feed is a hint; UI event-driven, polling fallback (SPINE:89-93).
7. **AD-7** Control plane owns provisioning + tokens; worker push only `/land`; worker tokens single-use minutes-TTL revoked in `finally`; agent tokens hours-scale; 0600 outside repos; audited; account-scoped API token limited to Artifacts (SPINE:95-99).
8. **AD-8** `CONTRACT.md` single shape source; additive-only, bump-first; every new route/payload contract-pinned in the same slice (gate); `base`/`ref`/`baseRef` defaults identical + pinned; JSON 404 for unknown API paths; methods enforced (SPINE:101-105).
9. **AD-9** Auth seam `[NEW]`: no response ever carries tokens/credentials; `authorize(request, env, action, {repo|base})` chokepoint; `AUTH_MODE` default-deny, demo opts in explicitly; demo repo allowlist (`demo`, `agent-*`); edge rate limits on `/land`, `/merge`, `/proposals`, `/judge`; CSRF for future cookie SSO; seam enforced before first non-demo data (SPINE:107-111).
10. **AD-10** DO/Workflows/R2 in scope `[NEW]`: DO leases/locks (serialize lands when it arrives); Workflows provisioning + token minting; R2 blob/asset tier with manifests/pointers in Artifacts (first R2 slice owns format; pointers non-diffable; credential-adjacent values follow AD-4) (SPINE:113-117).
11. **AD-11** Judge contract `[NEW]`: one `POST /judge` via AI binding `@cf/cloudflare/clef` (id pinned; mismatched model ⇒ fail closed); request `{setId,target}`; state assembled server-side + masking-filtered; typed-schema validation; question sets versioned in code; auto-land gate inside `/land`, fails closed; auto-land off until injection spike + ≥1 non-model signal; per-caller budget/rate caps (SPINE:119-123).
12. **AD-12** Loop governance: queue → work orders → gates; 0 ship-blockers + 0 highs; disk truth (`run-state.json`); workers never commit (orchestrator on green); one writer per file per wave; resumed runs re-gate; platform VERIFY gates run contract smoke (six routes) (SPINE:125-129).
13. **AD-13** Runtime pinned: one Worker `nextgit-platform`, compat date 2026-09-01, no `nodejs_compat`; deps per stack; deploys lockfile-pinned wrangler, never `@latest`; logs never auth headers/bodies (SPINE:131-135).
14. **AD-14** Client contract: 11-entity protocol + contract-pinned push-event surface; GitHub semantics (`reviewDecision`, `mergeStateStatus`, `mergeable`) synthesized in the adapter (SPINE:137-141).
15. **AD-15** Federation boundary: orchestrates Windows/GPU/macOS runners, never hosts; federated runners publish only via worker-mediated events route; never consume `nextgit-events` (SPINE:143-147).

---

## 2. Constraints the PRD must honor

- **CPU budget:** Workers CPU 30 s default / 5 min max per HTTP request; all change-set/conflict work in-Worker diffs, no server-side git (SPINE:69; SPEC:53).
- **Artifacts limits:** 1 GB/repo · 32 MB/file · 2k git req/10 s/repo; no server-side merge/diff/conflict/branch-protection — the platform builds them (SPEC:51); 32 MB/blob wall stands (MEMLOG:21). Push ~64 MiB cap → small incremental pushes; push protocol v1-only (SPEC:52).
- **Runtime pin:** compat 2026-09-01, no `nodejs_compat` (in-tree fs/Buffer shims) (SPINE:162,135); isomorphic-git ^1.43.0 (v1 wire; SPEC names 1.42.x — verified compatible REAL:53).
- **Environments:** one environment (live demo `nextgit-platform.john-b7d.workers.dev`); no staging split until auth seam + non-demo data (SPINE:177,251).
- **Fork walk limit 200** on change-set diffing; landing preconditions `stale`/`base-moved` (SPINE:75).
- **Events/polling plan:** `/events` ≤50 newest; KV single writer; queue single consumer; dedupe `(type,repo,ref,after)`; polling only as fallback (SPINE:93); live-feed transport (SSE/WS) deferred until polling latency is real at scale (SPINE:253).
- **Scale budget unresolved:** `/proposals` fully recomputes per poll; only AD-2's CPU sentence bounds it; a P2 cache item is the implicit home (RUB:33); brief flags the 20–50-proposal fleet view as a known engineering budget item (BRIEF:64).
- **Token lifecycle:** worker tokens minutes-TTL, single-use, revoked in `finally`; agent tokens hours-scale; 0600 outside repos/transcripts; never logs/argv; mint/use/revoke audited (SPINE:99).
- **Auth/demo:** `AUTH_MODE` default deny; demo allowlist `demo`/`agent-*`; rate limits on `/land`,`/merge`,`/proposals`,`/judge`; seam enforced before first non-demo data (SPINE:111).
- **Judge:** pinned model, fail-closed, per-caller budget/rate caps, auto-land requires injection-spike pass + non-model corroboration (SPINE:123).
- **Deploy/log hygiene:** lockfile-pinned wrangler only; worker logs never Authorization headers or request bodies (SPINE:135).
- **Gate rule:** 0 ship-blockers + 0 highs; contract smoke in each platform VERIFY (SPINE:129).
- **Write protection is ours to enforce:** CF `read_only:true` flag does NOT constrain binding-level writes (probe landed on a read-only fork) — never assumed as a guard (MEMLOG:39).
- **No Windows/GPU/macOS hosting**; no servers to run; only local dependency is the loop host (SPINE:147,177).

---

## 3. Capabilities the architecture commits to as near-term

- **Judge layer wiring (P0):** `POST /judge` + `AI` binding + typed envelope + card-signal vocabulary, contract-pinned before the wave (SPINE:119-123; MEMLOG:34 `judge-contract-pin` P0).
- **Landing path hardening (P0):** reviewed-heads fields + evidence object + `base-moved` preconditions + AD-9 allowlist/rate rules as one work order, contract bump first (SPINE:244; MEMLOG:34).
- **Event pipeline:** Queues → worker (sole recorder, validation, dedupe) → KV → `/events` → UI (SPINE:89-93; `event-consumer-validation-dedupe` P1 MEMLOG:34).
- **Store choices in scope:** Artifacts (repos/forks/notes-mirror), KV `LIVE`, Queues `nextgit-events`, DO leases (`do-lease-serializes-lands` P1), Workflows provisioning (`workflows-provisioning` P1), R2 asset tier owning manifest/pointer format (`r2-asset-tier-manifest-format` P1) (SPINE:42-56,113-117; MEMLOG:34).
- **Auth seam v1 + token lifecycle** (P1) (SPINE:107-111; MEMLOG:34).
- **Secret-class widening + scrub** (P1) and the content-scan decision landing in CONTRACT before its unit ships (SPINE:81).
- **Contract smoke in VERIFY gates + `tsc --noEmit` type gate** (`contract-smoke-verify-gates` P2) (SPINE:129; MEMLOG:34).
- **Client contract:** CONTRACT.md + 11-entity protocol + push-event surface; adapter synthesizes GitHub semantics (SPINE:137-141; capability map SPINE:226-237: CAP-1..10, CAP-10 deferred).
- **Deferred (post-competition unless noted):** game-asset pipeline internals, federation runners, fork community + intent router, staging/SSO split, jurisdiction, SSE/WS transport, macro-merging + SHOULD/COULD list (SPINE:248-254).
- **Demo incorporation requirement:** DO/Workflows/R2 introduction slices scheduled as work orders immediately after the spine (user requires demo incorporation) (SPINE:241; MEMLOG:9).

---

## 4. Open risks/questions from the four reviews (+ disposition)

Gate: rubric 2H/2M/5L; adversarial 5H/4M/3L; security **FAIL** 2H/4M/3L; reality PASS + 2 corrections; all accepted; amendments applied; live fixes shipped (MEMLOG:31-33).

- **[H] Concurrent `/land` overwrite race** (RUB:88-91; ADV:55-59). Disposition: AD-3 amended (reviewed-heads + `base-moved` preconditions); race live-reproduced (4 concurrent lands → 2×200, 2×500 credential-free); serialization to arrive via DO lease; `land-hardening` P0 (MEMLOG:32,36; SPINE:75,244).
- **[H] CAP-7 "merged SHA == tested SHA" had no architectural home** (RUB:100-103,71). Disposition: AD-3 amended — landing records ancestor+heads+fold hash; returned commit is the evidence reference; ships in `land-hardening` P0.
- **[H] CAP-8 elevated reveal + commit-time scrub undecided; AD-4 foreclosed reveal** (RUB:93-96,72). Disposition: AD-9 amended (reveal requires seam + explicit authorization; masked-by-default until then); AD-4 amended (content-detected secrets decided in CONTRACT before unit ships); `secret-class-widening-scrub` P1 (MEMLOG:32).
- **[M] Contract verification/conformance a silent dimension** (RUB:105-108). Disposition: AD-12 amended (contract smoke in VERIFY gates); `tsc` gate when hygiene lands; `contract-smoke-verify-gates` P2.
- **[H] Judge surface ships with no pinned shape (AD-8 covered changes, not new routes)** (ADV:31-35); **judge passthrough contradicts versioned question sets** (SEC:45-51). Disposition: AD-8/AD-11 amended (contract-first gate; server-side state assembly; caller-supplied state/questions prohibited; pinned-model check fails closed; injection spike before auto-land); `judge-contract-pin` P0.
- **[H] Masking law stopped at response bodies — model/log egress unguarded** (ADV:37-41); **intent free-text unmasked** (SEC:37-43). Disposition: AD-4 amended (all egress; `KEY=VALUE` scrub; intent dropped when head touches secret-class path); P1.
- **[H] Auto-land gate had no server-side enforcement point** (ADV:43-47). Disposition: AD-11 amended (gate evaluated inside `/land`, fails closed; clients render verdicts, never decide).
- **[H] Two base-ref writers with divergent semantics (`/land` vs control-plane replay)** (ADV:49-53). Disposition: AD-1/AD-7 amended (base refs only via `/land`; replays prohibited); `land.mjs` replay removed live (MEMLOG:33).
- **[H LIVE] `/land` push-failure handed anonymous callers a live write token + shell snippet (command injection)** (SEC:10-27). Disposition: FIXED LIVE — handout + `commands[]` removed; tokens single-use 300 s TTL + `finally` revoke (MEMLOG:33; commit d0d8b17).
- **[M] Auth seam declared, not enforced; demo boundary had no mechanism** (SEC:29-35). Disposition: AD-9 amended (chokepoint, `AUTH_MODE` deny default, allowlist, rate limits); `auth-seam-v1` P1.
- **[M] Token lifecycle contract missing (mint/revoke/storage/audit/least-privilege)** (SEC:53-59). Disposition: AD-7 amended (TTL classes, revoke-in-finally, 0600, audit); `token-lifecycle` P1.
- **[M] Feed double-record, no dedupe; unvalidated payloads → KV** (ADV:61-65; SEC:65-67). Disposition: AD-6 amended (sole recorder + dedupe + payload validation); `event-consumer-validation-dedupe` P1.
- **[M] Two pushers per proposal repo; mirror not FF-only** (ADV:73-77). Disposition: AD-5 amended (single runner/orchestrator pusher; agents never push; FF-only mirror).
- **[M] `baseRef` defaults diverge between read routes (`main`) and `/land` (`ref`)** (ADV:79-83). Disposition: AD-8 amended (defaults identical + pinned in CONTRACT).
- **[M] Federation "same queue/event surface" ambiguous (3 compliant readings)** (ADV:67-71). Disposition: AD-15 amended (publish-only, never consume `nextgit-events`); post-competition.
- **[L] Provisioning→discovery implicit** (ADV:85-89); **content-detected secrets enum semantics** (ADV:91-95); **R2 pointer typing** (ADV:97-101); **secret path-class gaps (`id_rsa`, `.netrc`, `.aws/credentials`, case variants)** (SEC:61-63); **deploy `@latest` vs pin** (SEC:69-71; RUB:55). Disposition: amendments landed in AD-7/AD-4/AD-10/AD-13; P1/P2 work orders cover scrub/widening.
- **Rubric LOWs:** token-handout removal owner/trigger (RUB:112 — now unconditional + shipped); API-edge drift (RUB:114 — AD-8 amended); 11-vs-10 entities (RUB:116 — AD-14 amended); AD-2 clone scope (RUB:118 — amended); Node ≥20 unverifiable (RUB:120 — engines pinned, MEMLOG:33).
- **Reality corrections:** wrangler parenthetical false (REAL:19-34) and unused `memfs` row (REAL:36-44). Both fixed in final stack table — verified text now "commands since 4.92.0…"; memfs row/dep dropped (SPINE:163; MEMLOG:33).
- **Remaining open questions (spine):** DO/Workflows/R2 slice order (demo incorporation required); judge question-set v1 contents + thresholds; loop parallelism (v1 sequential); `/land` hardening slice shape (SPINE:241-244).
- **Watch items:** 20–50-proposal fleet view + per-poll recompute have no scale envelope yet (BRIEF:64; RUB:33); workers.dev 403s Python-urllib UA — test scripts must set a UA; transient Cloudflare API blips observed (MEMLOG:37).

---

## 5. Items contradicting the brief or SPEC (flag only — adjudicate in PRD)

1. **R2 scope:** AD-10 + user direction declare DO/Workflows/**R2** in scope for the competition build (SPINE:113-117; MEMLOG:9) vs brief "Explicitly out … the game-industry binary-asset tier (R2, locking, per-file ACLs)" (BRIEF:54) and SPEC non-goal "No binary/game-asset pipeline this phase (R2 chunking, exclusive locks, per-file ACLs)" (SPEC:63). Spine defers only pipeline internals, not the tier (SPINE:248). PRD must phrase the boundary precisely.
2. **CAP-8 demo beat:** SPEC requires the demo to show "schema-only view + elevated reveal + a commit-time scrub" (SPEC:40; DEMO:33) vs AD-9's masked-by-default posture with reveal gated behind a seam that "requires this seam plus an explicit authorization rule" (SPINE:111) — reveal is not demo-able as architected; commit-time scrub carrier still pending a CONTRACT decision (SPINE:81).
3. **CAP-6 "no polling"** (SPEC:33) vs AD-6 "polling only as fallback" + SSE/WS deferred until scale (SPINE:93,253). Event-driven path is committed; the absolute no-polling claim is not.
4. **CAP-7 evidence timing:** SPEC success requires evidence attached at landing (SPEC:36-37; DEMO:32) — spine commits (AD-3:75), but reviewed-heads/evidence ship with `land-hardening` P0, not yet live (MEMLOG:36; SPINE:244).
5. **Minor / non-contradicting (record only):** SPEC "isomorphic-git 1.42.x" vs spine ^1.43.0 — verified v1-compatible (SPEC:52; REAL:53); SPEC "records persist as git notes (`refs/notes/*`)" vs readers using the mirror branch because the binding cannot resolve `refs/notes/*` (SPEC:31; SPINE:87).
