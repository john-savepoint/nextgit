# Judge-layer ideas — decision models (Clef / Jev) for NextGit

Recorded 2026-10-04. Standing catalog — revisit before designing any feature that needs a judgment, a score, a route, or a verification.

**Context:** Clef (`@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash`) is Cloudflare's open-source decision model family on Workers AI — same programming model and API family as TypeSafe's Jev (state + typed questions → typed probabilities). Verified callable live from this account on 2026-10-04. It runs **inside** our Cloudflare stack: our worker can call it directly via the `AI` binding.

## The primitive (what these models do)

- One call: a `state` (string or structured JSON, plus up to 4 images for Clef) and up to **64 typed questions**. Independent questions run in parallel.
- Three question types:
  - `noul` — probability of *yes* (no separate confidence; 0.5 = coin flip).
  - `choice` — one option from a set you define; returns the chosen option + per-option probabilities + confidence.
  - `score` — probability-weighted level index over an ordered rubric + per-level probabilities + confidence.
- **Code owns control flow, arithmetic, and policy. The model owns the snap judgment.** Weights live in code. Thresholds come from our data. Never ask for prose.
- Latency / cost: clef ≈ 209 ms median (verified ~1.3 s over REST incl. cold path), clef-flash ≈ 39 ms median. $0.24 / $0.09 per M input tokens. 64K context. A typical judgment here cost ~520 tokens ≈ **$0.00012**.
- Same questions run on Jev in our harness (`jev_judge` / `jev_verify` / `jev_rerank`) — **drop-in**: switch endpoint + model id.

## Live proof (2026-10-04, real NextGit data)

Request (trimmed): state = agent-1's `refreshSession` vs agent-2's `isExpired` change to `src/auth.ts`; questions = collision noul + auto-merge risk score + change-kind choice.

Response:

```json
{
  "change_kind":    { "choice": "feature", "probabilities": {"feature": 0.82, "bugfix": 0.06, "refactor": 0.10, "other": 0.02}, "confidence": 0.59 },
  "auto_merge_risk":{ "score": 1.57, "probabilities": {"0": 0.06, "1": 0.40, "2": 0.45, "3": 0.09}, "confidence": 0.17 },
  "same_behavior_zone": { "noul": 0.17 }
}
```

Note the calibration nuance it exposed: the noul correctly says the two changes don't share the *same function* — the collision diff3 caught is adjacency, a different (real) signal. Keep the lenses distinct.

## Ideas (36)

### A. On every proposal card — wire now

1. **Review-risk score** — score: Routine / Focused / Senior-security. → risk chip on each card; policy in code. (TypeSafe catalog has this recipe.)
2. **Intent-vs-diff verification** — verify: does the diff do what the intent claims? (supports / contradicts / insufficient + overclaim noul). → "intent verified / mismatch" badge; catches drifted or bluffing agents.
3. **Change kind** — choice: feature / bugfix / refactor / docs / test / chore. → card label; feeds changelog + policy.
4. **Semantic collision detection** — noul per proposal pair: do they change the same behavior, even in different files? → "soft collision" warnings diff3 cannot see.

### B. Landing & the set view

5. **Auto-land eligibility** — confidence-gated routing: ACT / CONFIRM / ESCALATE over the other answers. → behind the Land button; safe proposals land themselves.
6. **Conflict resolution strategy** — choice per conflicted pair: take-A / take-B / combine / needs-human. → pre-fills the resolution UI.
7. **Landing-subset risk** — score: how safe is landing *this combination* (A+B vs A+C) together?
8. **Duplication check** — noul: is this behavior already covered by another proposal/fork? → merge-it recommendation.
9. **Stale-proposal detection** — noul: obsolete because the base moved or another proposal landed the behavior?
10. **Post-merge behavioral verification** — verify: expected vs observed behavior after landing (test output / screenshots).

### C. Trust & security

11. **Content-based secret detection** — noul over diff + notes *regardless of file path* → closes the hole path-based masking can't (secret hidden in `data.json`).
12. **File typing & sensitivity** — choice language/role + choice public/internal/secret per file → the cheap classify-every-file pass feeding masking, policy, and the index.
13. **Supply-chain sniff** — choice benign / suspicious / malicious (new deps, obfuscated blobs, network calls, CI edits) → security queue; block on high confidence.
14. **Public-contribution screening** — nouls: author↔change mismatch, task-scope violation, spam signals → triage public PRs before a human sees them.
15. **Intent/notes leak scan** — noul: does the provenance text itself leak secrets/PII before we publish it?

### D. Review routing & quality

16. **Breaking-change flag** — noul + choice major/minor/patch → release gating.
17. **Scope check** — nouls: touches_auth / public_api / billing / schema / ci → escalate when the diff exceeds the stated task.
18. **Review-effort estimate** — score: skim / focused / deep → sort the human queue by risk × effort.
19. **Reviewer assignment** — choice over reviewer profiles/expertise → specialist routing for the proposal.
20. **Test-sufficiency gate** — noul: behavior change without a matching test?
21. **Doc-completeness** — noul: public API change without a docs update?
22. **Commit-message quality** — choice: conventional / vague / misleading.
23. **Dependency intent check** — noul: was the new dependency actually needed for the stated task?

### E. Platform ops (mostly invisible)

24. **Mega-proposal splitting** — score per hunk: independent? → suggest reviewable splits.
25. **Issue triage** — choice bug/feature/question + priority score + component choice (for the issues module).
26. **Changelog classification** — choice breaking/feat/fix/perf per landed commit → release notes rendered from code templates.
27. **CI failure triage** — choice flake/infra/real/timeout + retry-safe noul → retry policy.
28. **Release-readiness gate** — nouls per release checklist.
29. **Eligibility/pre-submission checklist** — nouls per competition requirement (license file, README, run instructions, Workers+Artifacts usage) → pre-submit automation.

### F. Fork community & agents

30. **Intent-to-fork matching (rerank)** — listwise ranking of candidate forks against a declared intent (measured on the pattern: recall@1 0.94 listwise vs 0.87 per-candidate at 1/30th the calls) → the "someone already did this" radar.
31. **Claim-overlap check** — noul before an agent starts: does an active claim cover this task? (enforces swarm rule R4, join-don't-restart).
32. **Which agent gets the task** — choice over harness capabilities + complexity score → route work to codex / omp / claude.

### G. Vision (Clef's multimodal encoder)

33. **UI-diff visual review** — before/after screenshots; nouls: visual regression? layout broken? unreadable text?
34. **Design-system compliance** — score: does the change match the design tokens/palette/spacing?
35. **Demo-video QA** — sample frames from the recording; nouls: UI readable at 1080p? the collision moment visible?
36. **Asset classification (game pipeline)** — choice texture/audio/model/level/video + nouls: needs exclusive lock? needs preview? (roadmap track).

## How we wire it into NextGit

1. `platform/wrangler.jsonc`: add `"ai": { "binding": "AI" }`.
2. Worker: `POST /judge` — passthrough `{ state, questions }` → answers; restrict question types/sizes; pin model id; log the returned `model`.
3. First three card fields: **risk score + intent verification + semantic collision**; render as chips; then the auto-land gate behind the Land button.
4. Question sets live in code (versioned with the platform); thresholds tuned on our own labeled proposals — never copied from a cookbook.

## Rules that keep it honest

- Pin the versioned model id; log the `model` field each response returns.
- Typed output guarantees the interface, not truth — validate on our data before gating anything real.
- The judge advises; code decides; humans still own irreversible acts.
- Keep inferred values distinct from observed facts; re-observe before acting on changed state.
