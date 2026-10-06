---
title: "NextGit — Product Brief (working name)"
status: final
created: 2026-10-06
updated: 2026-10-06
---

# Product Brief: NextGit (working name)

## Executive Summary

AI agents now write code at volume — often many at once, on the same codebase. The bottleneck has moved from *writing* changes to *converging* them: seeing what a whole fleet of agents did, understanding why, spotting where they collide, and deciding what ships. Today's tools review one change at a time and were built for human-authored pull requests; on real agent traffic they buckle, and collisions surface late — or in production. Across 33,596 agent-authored PRs, ~41.7% of concurrent agent pairs conflict; frontier models catch only 15–31% of human-flagged issues. Integration, not generation, is the crisis.

NextGit is the platform built for that moment. Agents work concurrently in isolated workspaces; every change-set arrives as a **proposal** carrying its intent, its diff, its collision status, and its provenance; all proposals are visible **as one set** on a single review surface; a platform-native judge layer (wiring next — the P0 build step) will score risk, verify that the diff does what its intent claims, and flag semantic collisions; and a chosen proposal **lands server-side in one click** — no clones, no CLI. The core bet: **the convergence layer** — the set-level surface where concurrent agent work is compared, judged, and merged — is the missing piece of the agent era, and nobody ships it today (no counterexample across six independent search efforts — see addendum).

Why now: the substrate just arrived. Cloudflare's Artifacts gives a programmable git-compatible repo fabric; Workers, Queues, and Durable Objects give orchestration; Clef — Cloudflare's open decision model, built for hot-path typed decisions (median 39 ms on clef-flash, 209 ms on clef) — makes judgment cheap enough to run on every change. NextGit is built end-to-end on that stack, works today (real agents, real proposals, real collisions, real one-click landings), and is the entry in Cloudflare's next-gen Git platform competition — due October 14, with adoption ambitions far beyond it.

## The Problem

Teams running agent fleets hit the same wall: **concurrent work is invisible until it is expensive.** Each agent's output arrives as yet another branch or pull request; a reviewer facing ten of them cannot hold the set in their head, cannot see which two collide, cannot compare proposals side by side, and often cannot reconstruct *why* each change was made. Duplicated effort compounds the waste — the same fix attempted across several forks. Trust gaps (who wrote this? did the diff do what it claimed? is that file a secret?) have no first-class answers. The status quo's costs: review queues as the binding constraint on shipping velocity, late-discovered conflicts, silent context loss, wasted agent compute. GitHub's own guidance — "be thoughtful about partitioning work" — admits the platform doesn't solve this: the human is asked to pre-partition the fleet.

## The Solution

One screen — the fleet view — where every concurrent proposal sits as a card: what the agent was trying to do (written intent), what it touched, whether it collides (computed by actually attempting the merge), and where it came from. Compare the whole set; preview any landing; read any diff; ship any proposal with one click, server-side, its validation evidence attached. Behind the cards: isolated workspaces per agent (fork-per-agent on Artifacts), live event flow (pushes appear in seconds — no manual refresh), decision-model judgments per proposal (risk, intent-vs-diff verification, semantic collisions — landing with the judge layer, P0), and a trust layer that treats secret-class files as typed objects — key names visible, values never. What users feel: *convergence* — fleet work becomes tractable at the surface where it matters.

## What Makes This Different

- **The convergence layer itself.** No shipping product presents N concurrent agent change-sets as one comparable set with real conflict computation (six independent search efforts; nearest alternatives — GitGhost (private beta), Whiteboard (single-branch, local), Entire (announced, unshipped)). This is the unoccupied position, and the one the rubric weights most heavily.
- **Native to the stack that makes it possible.** Artifacts (repo fabric) + Workers/Queues/Durable Objects (orchestration) + Clef (hot-path decisions) in one platform — decision models run *inside* the platform, not bolted on. [ASSUMPTION] The honest moat is timing, execution speed, and the unclaimed category — not a proprietary algorithm; competitors would need substantial platform work to match the integration.
- **API-first by construction.** The same platform state renders to the web UI and, later, to any client — a 3D office, an IDE, a CLI. The platform is the heart; clients are surfaces.
- **Trust as a first-class layer.** Secret-typed files, provenance, intent records — not a compliance add-on. No surveyed code host treats secret files as typed, access-controlled objects (no counterexample found).

## Who This Serves

Primary: **teams already running agent fleets** — platform and dev teams at AI-forward companies, agencies, OSS projects receiving machine-authored PRs — and the **reviewer/conductor** who decides what ships. Their success: triage a fleet's work on one screen in minutes, ship with confidence, never re-discover a collision late. Secondary: game studios (asset scale — roadmap), agent-harness builders (API consumers), and the agents themselves — the platform is designed to be machine-legible first. [ASSUMPTION] The ordering of primary segments is inferred from the competitive research's early-adopter read; validate with first design partners.

## Success Criteria

- **Gate (Oct 14):** the submitted entry — 5–10 minute video + open-source repo + run instructions — demonstrating all three rubric axes on real infrastructure (originality/prototype 50%, multi-agent concurrency 25%, UX 25%).
- **Demo-scale proof (now):** N≥4 real agents working concurrently, ≥1 genuine collision surfaced pre-land, one-click server-side landing with evidence, secret masking and provenance visible; reproducible end-to-end from committed scripts. [ASSUMPTION] The fleet-scale target is 12–50 agents.
- **Adoption signals (beyond):** a team uses the API for real work; a second client (e.g., the office) renders live platform state; the team tracks proposals landed per week with attached evidence.

## Scope

**In (first version):**
- the platform worker API (proposals, changes, merge/land, events)
- the fleet-view UI + interactive tour
- real-agent onboarding (omp, codex; more via harness routing)
- the judge layer (risk, intent verification, semantic collision)
- secret-typed files
- provenance via git notes
- reproducible demo scripts

**Explicitly out (roadmap — named so nobody assumes otherwise):** repo browsing / issues / CI / profiles (the classic GitHub surface), the game-industry binary-asset tier (R2, locking, per-file ACLs), the 3D office client (a future API consumer), PM integrations, multi-tenant hardening, billing.

## Vision

If this works, the fleet view becomes how software teams *think* about concurrent agent work — the default surface for deciding what ships. Year 1: adopted by agent-heavy teams as the convergence layer over their existing repos. Year 2–3: the platform absorbs the rest — workspaces become the default home for agent work (local optional), the asset tier opens the game industry (the hardest case: huge binaries, locking, studios), and clients multiply (web, IDE, office). The endgame is the original thesis, unchanged: **make GitHub irrelevant** — not by cloning it, but by making the layer it lacks *the* layer everyone uses. [ASSUMPTION] "Make GitHub irrelevant" is the founder's stated ambition, retained as directional; near-term metrics stay demo- and adoption-scale.

## Open Questions / Honest Unknowns

- **Name:** "NextGit" is a working title.
- **Business model:** not yet defined — usage credits, seats, or platform-API pricing; deliberately deferred past the competition.
- **Fleet-scale performance:** the fleet view at 20–50 proposals is a known engineering budget item (caching, incremental change-sets).
- **Judge-layer calibration:** thresholds must be tuned on our own labeled proposals before any gating is trusted.

---

*Supporting depth — evidence pack + corpus index: `addendum.md` (this folder).*
