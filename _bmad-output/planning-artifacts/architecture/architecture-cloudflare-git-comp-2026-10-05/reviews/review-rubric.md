# Review — Rubric walker (good-spine checklist)

**Artifact:** `ARCHITECTURE-SPINE.md` — NextGit architecture spine, draft 2026-10-05
(`_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/`)
**Lens:** rubric walker — the 7-point good-spine checklist
**Date:** 2026-10-06 · **Reviewer:** ReviewRubric (read-only; no edits outside this file)
**Evidence read:** spine (all 254 lines); `platform/CONTRACT.md`; `SPEC.md` + `demo-scope.md` + `interface-contract.md`; `docs/STATE.md`; `docs/judge-layer-ideas.md`; `docs/NEXT-ACTIONS.md`; `/tmp/arch-sweep/platform.md`; `/tmp/arch-sweep/spec.md`; `platform/src/index.ts`, `land.ts`, `githttp.ts`, `memfs.ts`; `platform/wrangler.jsonc`; `platform/package.json`; `platform/ui/app.js`.

**Overall verdict — sound substrate with three fix-before-handoff gaps.** The spine ratifies the brownfield system almost everywhere it speaks, and every AD reads as an enforceable rule (three need precision notes). It fails the checklist on: (a) land atomicity — a real same-repo write race that AD-1 claims to prevent is not actually prevented; (b) CAP-7 and CAP-8 coverage — two spec success criteria have no decision, no deferral, and no open question; (c) the verification dimension — nothing decides how the frozen contract is checked, and existing drift was found by manual sweep, not by any gate. Five low findings are precision issues. No critical findings.

---

## Checklist 1 — divergence points for the level below

Fixed (verified against code, not just intent):

| Divergence the spine fixes | Cross-check |
| --- | --- |
| Fork-point change-set + 3-way ancestor | AD-3 ↔ CONTRACT.md:50-54 ↔ index.ts forkPoint (94-133), FORK_LOG_LIMIT=200 |
| Secret masking law (paths, keys[], withheld-secret 409) | AD-4 ↔ CONTRACT.md:104-110 ↔ index.ts:216-235, secret rows carry no intent/patch (index.ts:418) |
| Notes mirror + `NEXTGIT_INTENT/<sha>.txt` fallback | AD-5 ↔ index.ts:162-210 |
| Events: one consumer, KV single writer, ≤50 newest | AD-6 ↔ wrangler.jsonc:13-27 ↔ index.ts:660-676, 868-894 |
| Control plane mints forks/tokens; worker's only push is /land | AD-7 ↔ fanout.mjs:54-70; real-agents.mjs:280-411 |
| Single shape source, additive-only | AD-8 ↔ CONTRACT.md:3 |
| Runtime pin (compat date, no nodejs_compat, deps) | AD-13 ↔ wrangler.jsonc:5; package.json |
| Loop rules (gate block, fail-closed normalization, disk-is-truth, per-invocation heal budget) | AD-12 ↔ wf-template.ddw.js per sweep §2 |
| `landing.status` derived from the same fold /land performs (zero-change → `landed`) | AD-3 ↔ index.ts computeProposals fold block; /land `no-changes` shares the condition |

Missed divergence points:

- **Concurrent lands are not serialized or preconditioned** (finding H1). AD-1's stated prevention — "two write paths racing the same repo" — covers two *paths*, not two invocations of the one path.
- **API-edge semantics are unpinned** (finding L2): method enforcement, asset fallthrough, and `baseRef` defaulting differ per route today and appear nowhere in the spine.
- Minor, not a divergence: `worker-configuration.d.ts` is stale today (declares only `ARTIFACTS`) while AD-13 asserts it "is kept in sync"; and `/proposals` fully recomputes per poll with no scale envelope beyond AD-2's CPU-budget sentence (the queue's P2 cache item is the implicit home).

## Checklist 2 — rule enforceability

All 15 AD rules are stated as enforceable constraints and match the system's mechanisms. Three precision issues:

- **AD-9:111** — the rule's absolute "No response ever contains tokens or credentials" is false of the shipped code: the `/land` push-failed path returns a one-time write token + ready-to-run commands (index.ts:784-812). The spine records this, but ties removal to an unrelated milestone ("when the judge wave lands") instead of an owner/trigger (finding L1).
- **AD-2:69** — "No route shells out to git or clones" is contradicted by `/land`, which clones in-memory to push (land.ts:47-63), and is broader than the AD's binds (`/changes`, `/proposals`, `/merge`) (finding L4).
- **AD-13:135** — "kept in sync with wrangler.jsonc" is aspirational against the checked-in stale generated types; no owner or trigger is recorded (the queue's tsc-hygiene P2 row is the implicit home).

## Checklist 3 — Deferred review

No deferred item leaves a shared interface both undefined and needed by two concurrent units, with one watch item and one mislabel:

- **Watch:** "Game-asset pipeline internals — waits for the R2 tier's shape" — fine, but AD-10's "manifests/pointers in Artifacts" is a shared interface the first R2 work order will freeze. Recommend one sentence: the first R2 slice owns the manifest format; later slices conform additively.
- **Mislabel:** Deferred line 254 calls the parenthetical "(auto-changelog, GitLens parity, PM integration, pod visualization)" the "SHOULD/COULD demo list" — those are the four COULD items. Of the five SHOULDs, git-notes provenance (AD-5) and change-set identity (AD-2/3) are covered, authoring lease maps to AD-10, while **speculative validation (CAP-7) has no home** (M1) and **secret-typed files (CAP-8) are only partially covered** (H2).

## Checklist 4 — named-tech verification

| Claim | Verdict | Source |
| --- | --- | --- |
| Workers runtime compat 2026-09-01, no `nodejs_compat` | verified | wrangler.jsonc:5 (no `compatibility_flags`) |
| wrangler ^4.147.0 | verified as a repo pin | platform/package.json — **note:** the deploy path is `npx wrangler@latest` (spine:177), not the pinned version; deploys are not reproducible and can drift past the pin |
| Artifacts `ARTIFACTS` · namespace `nextgit` | verified | wrangler.jsonc:7-12 |
| Queues `nextgit-events` single consumer | verified | wrangler.jsonc:13-21 |
| KV `LIVE` single writer | verified | wrangler.jsonc:22-27; index.ts single writer |
| Clef ids `@cf/cloudflare/clef` · `clef-flash` | verified from provided sources | judge-layer-ideas.md:5 (verified callable 2026-10-04); STATE.md:25. Not in repo code — consistent with "not yet wired" |
| isomorphic-git ^1.43.0; node-diff3 ^3.2.1; diff ^9.0.0; memfs ^4.80.0; buffer ^6.0.3 | verified | platform/package.json |
| Node ≥20 (host scripts); bun for scripts/status-index.mjs | **unverifiable** | No `engines`, `.nvmrc`, or README pin in the repo; bun use confirmed (STATE test baseline, `scripts/status-index.mjs` exists) — see L5 |
| Loop agent route `commandcode/deepseek/deepseek-v4.1-flash` (agentModelOverrides) | verified | STATE.md:16-overrides note |

## Checklist 5 — ratification vs brownfield

Spot-checks all pass except the recorded exceptions: fork point (code ↔ CONTRACT ↔ AD-3); secret basenames incl. `credentials.json`, `secrets.json`, `.dev.vars` (index.ts:219 ↔ AD-4); notes refspecs (three-refspec push ↔ AD-5); events ≤50 newest (MAX_EVENTS=50 ↔ AD-6); queue consumer `nextgit-events` (wrangler.jsonc ↔ AD-6); one commit per land, author/message (land.ts:17-20,76 ↔ AD-3/AD-12); enums (KIND_SEVERITY ↔ conventions table); dependencies (package.json ↔ Stack). Recorded exceptions: `/land` fallback token handout (L1); route method asymmetry + asset fallthrough (L2); stale generated types (note above). AD-9's "demo-open" posture is accurately ratified (no auth checks anywhere in index.ts).

## Checklist 6 — CAP-1..CAP-10 coverage

- CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-9, CAP-10 — covered; map rows verified against code and CONTRACT. CAP-10 correctly deferred (spec: post-demo).
- **CAP-7 — partial.** The landing push is covered (AD-1/AD-3), but "land safely with validation evidence attached — merged SHA equals tested SHA" (SPEC CAP-7) has no decision, deferral, or open question anywhere in the spine; demo beat 5 and the submission success signal both rely on it (M1).
- **CAP-8 — partial.** Masking (schema-only views) is covered; "elevated reveal" and "a commit-time scrub" (SPEC CAP-8 success criteria; demo beat 6) are undecided — and AD-4's absolute "never values in ANY response body" forecloses the reveal without a recorded resolution. Content-based secret detection (judge idea 11, NEXT-ACTIONS P1) is absent from the spine (H2).

## Checklist 7 — dimension inventory

- **Decided:** deployment/environment (one env, deploy path), security (AD-4/AD-9), data & storage roles (AD-2/5/6/10), interfaces (AD-8/AD-14), judge policy (AD-11), loop governance (AD-12), performance envelope (AD-2 CPU budget only).
- **Deferred:** staging split, jurisdiction, federation, CAP-10, live transport, R2 internals.
- **Open:** auth timing, DO/Workflows/R2 slices, judge question sets, loop parallelism.
- **Silent — verification of the frozen contract (M2).** AD-8 makes CONTRACT.md the single shape source, but nothing decides how conformance is checked: `platform/` has no tests, `tsc` is red (4 errors, not installed), and the drift this review found (L2, L1) was discovered by manual sweep. Recommend a decision: a contract-smoke step (curl the six routes; assert shapes/enums) executed in each platform work order's VERIFY gate or as a `porting/` certification — ratifying the live C2/C3 smoke practice already in STATE.
- **Thin (recorded, but one-line):** observability — "logs to Workers observability" is the only clause; no decision for queue-failure visibility (no DLQ configured), KV feed loss, or deploy rollback. Suggest one Deferred line each, or a one-sentence AD-6 extension.

---

## Findings

### HIGH

**H1 — Concurrent `/land` calls can silently overwrite each other; no precondition exists.**
*Where: AD-1:59-63 / AD-3:71-75 (rules); code path index.ts:725-813, land.ts:47-93.*
Trigger: two lands overlap. `/land` folds against the current base head H1 (fold at request time); `pushLand` then clones the remote fresh and applies the folded content. If the other land pushed C_A between fold and clone, this clone fetches C_A, writes stale fold content (computed against H1), commits on C_A, and pushes fast-forward — **200 `landed` with the overlapping files overwritten** (lost update; a concurrently deleted file can also be resurrected when the fold still writes it). If the base instead moves between clone and push, the push is rejected and the unratified token-handout fallback fires (L1). AD-3's zero-change detection cannot catch this: it is evaluated against the fold-time head. AD-1's stated prevention ("two write paths racing the same repo") covers two paths, not two invocations of the one path; AD-10's DO leases are deferred/advisory. Plausibility rises next cycle with auto-land (AD-11), fleet-scale land-all, and scripted lands (`platform/scripts/land.mjs`).
**Fix (pin one in AD-1/AD-3):** `/land` re-reads the base head after the clone and returns 409 `base-moved` when it differs from the folded-against head (the change-set already exposes the fork `sha`/`treeHash`); or an additive `expectedBaseHead` body field with mismatch → 409; or state that a DO lease (AD-10) serializes lands and, until it exists, the precondition applies.

**H2 — CAP-8's "elevated reveal" and "commit-time scrub" have no decision; AD-4 forecloses the reveal.**
*Where: capability map row CAP-8:235; AD-4:77-81.*
SPEC CAP-8 success: "Demo shows schema-only view + elevated reveal + a commit-time scrub"; demo-scope story beat 6 repeats the scrub; the spine claims CAP-8 covered by AD-4/AD-11 but neither decides a reveal path, an authorization model for it, or content-based leak detection (path-driven masking explicitly cannot see secrets placed in non-secret paths — CONTRACT.md:110). Meanwhile AD-4's absolute "never values in ANY response body" means no elevated reveal is possible until the auth seam (AD-9) lands, and AD-9 does not name reveal as its payload. Result: the CAP-8 beat gets re-decided ad hoc by the first work order that touches it.
**Fix:** add the decision (AD-4 extension or an Open Question with trigger): reveal requires AD-9's auth seam and an explicit authorization rule — remain masked-by-default everywhere until then; commit-time scrub = content-based secret detection (judge idea 11, already P1) with AD-11's fail-closed rule; or explicitly defer both beats.

### MEDIUM

**M1 — CAP-7's "validation evidence attached — merged SHA equals tested SHA" has no architectural home.**
*Where: capability map row CAP-7:234; AD-3:71-75.*
The spine never mentions evidence or SHA-equality (zero hits for "evidence"); CONTRACT v2's `/land` 200 payload has no evidence field; demo beat 5 and the submission success signal both say "one proposal lands with its validation evidence". The fold recomputes against the current base head at land time, so what was previewed is not guaranteed to be what lands when the base moves (see H1). Two work orders (land flow + judge/auto-land) will otherwise invent incompatible carriers or drop the beat.
**Fix:** decide one carrier — additive `evidence` on `/land` 200 (contract bump first) and/or a notes-mirror note — and pin SHA-equality: `/merge` returns the fold's content/tree hash and `/land` returns the landed commit whose tree must match; or land with a base-head precondition. If neither ships for the demo, record it as deferred with the revisit trigger.

**M2 — Verification/conformance of the frozen contract is a silent dimension.**
*Where: Open Questions:239-244 (nothing to add here is missing); AD-8:101-105.*
AD-8 freezes shapes and promises additive versioning, but the spine decides no mechanism that checks the worker against CONTRACT.md. Reality: no tests/CI in `platform/`, `tsc` red (4 errors, not installed), and the drift L1/L2 records was found by manual sweep. The bootstrap's live C2/C3 smokes are the de-facto practice and are not ratified or carried forward.
**Fix:** add a decision — a contract-smoke step (curl `/health|/changes|/proposals|/merge|/land|/events`; assert shapes/enums/status codes) run in each platform work order's VERIFY gate or as a `porting/` certification; adopt `npx tsc --noEmit` as the type gate when the P2 hygiene item lands.

### LOW

**L1 — The `/land` token handout's removal is tied to the judge wave, not to an owner/trigger.** *AD-9:111, index.ts:784-812.* The rule cannot hold until the handout is gone; it is a 3-line change independent of the judge layer, and it lets an unauthenticated caller obtain a live write token by racing a push failure. Fix: make removal its own queue row (owner) in the same work order that next touches `/land`; keep the 500 error but drop `token`/`commands`.

**L2 — API-edge drift is unrecorded: method handling, asset fallthrough, `baseRef` defaults.** *Conventions:151-155.* `/health` accepts any method (no check; index.ts:816-818) while `/events`/`/changes`/`/proposals`/`/merge` require GET and `/land` requires POST; wrong-method/unknown API paths fall through to static assets (e.g. `GET /land` → asset 404, not 405/JSON 404) (index.ts:816-866); readers default `baseRef ?? "main"` (828, 836, 846) while `/land` defaults `baseRef := ref` (703) — a client sending `ref=dev` gets two different base refs. Fix: add a convention line (every API route enforces its method; unknown API paths return JSON 404; baseRef defaulting pinned in CONTRACT) or record as standing divergences.

**L3 — The client contract names 10 entities while asserting 11.** *AD-14:141.* interface-contract.md lists 11 rows; the spine's parenthetical omits "PR / Proposal detail", so a unit enumerating from the spine builds 10. Fix: add `Pull-detail` (or reference interface-contract.md as the list).

**L4 — AD-2's "No route shells out to git or clones" contradicts `/land`'s in-memory clone.** *AD-2:69, land.ts:47-63.* Fix: scope the sentence — "No read route shells out to git or clones; cloning happens only inside the `/land` write path."

**L5 — "Node ≥20" is unverifiable from the repo.** *Stack:172.* No `engines`, `.nvmrc`, or README pin found (bun use is confirmed). Fix: add `"engines": {"node": ">=20"}` to `platform/package.json` (or annotate the actual floor).

---

*Method note: every code claim above was checked against the files listed in "Evidence read"; sweep claims were re-verified against source where they influence a finding (e.g. the sweep's "/health and /events accept any method" is half-wrong — `/events` requires GET).*
