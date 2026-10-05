# Engineering Laws — the platform's design constitution

Every build decision answers to these. (Locked 2026-10-02; consume, don't re-litigate.)

1. **Convergence is the central act.** Sets, not diffs. Triage at set level.
2. **Two-tier intelligence.** Fast/cheap (System-1) models see *every* file first — classify, type, tag, lint. Expensive reasoning reads only what needs judgment.
3. **Self-describing platform.** A machine-readable tool manifest + structure map ships *into* every agent workspace. No context-blind agents. (Direct answer to R2/R3 below.)
4. **Repo answers for itself.** Semantic index + live preview + native demos + push provenance — comprehension without cloning.
5. **Agents inspect just enough.** Context maps + semantic index orient an agent without total reads.
6. **Locks are surgical.** Scope/entity-level, expiring, advisory-first. Never fleet-wide serialization.
7. **Contribution standard as a service.** Platform-level contribution standards (lint, conventions, changelogs, commit rules) enforced platform-side — no per-repo scaffolding.
8. **Ambient capability.** GitLens-class parity, but features surface in context — discoverable in place, never buried in tabs. No tab explosion; SPA-like continuity.
9. **Work-item ↔ change-set linkage.** Work items and change-sets reference each other; review stays on one surface.
10. **Integrate PM, don't imitate it.** Milestones/epics are first-class, checkout-able timeline objects in project language — not convoluted tags.
11. **Always-on decision layer.** Cheap System-1 decision agents run continuously, prime the LLM agents doing code work, and can drive CI/CD directly. Always-on is affordable *because* the decision layer is cheap.
12. **Workspaces woven through the experience.** Merging feels transparent, seamless, understandable — not a bolt-on.

## Swarm rules (agent behavior)

| # | Rule | Sharpened form |
|---|---|---|
| R1 | Simple, standardized communication | **Communicate through the work.** Claims, status, receipts are written onto the shared artifact; any agent orients locally — no hub, no global truth. |
| R2 | Agents respect their box | **A denial is a wall, not an obstacle.** Forbidden paths are counted, closed, the sanctioned alternative forced, escalation after N. |
| R3 | Agents obey tool directives | **Declare before you touch; receipt when you finish.** Collision avoidance with zero global knowledge. No sandbox-escape attempts. |
| R4 | Join instead of restarting | Prefer reusing existing work (LLM merge/refactor) over regenerating equivalent code — socially and economically. |

**Communication contract:** every agent output = summary + structured detail + affordances (clickable next actions that feed back as signals). Outputs are control surfaces, not dead reports. **Standardize the interface, not the intelligence** — BYO model / BYO harness.
