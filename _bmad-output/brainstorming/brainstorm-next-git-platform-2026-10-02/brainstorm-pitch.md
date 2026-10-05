# The Platform — One-Pager

## What Git was built for

Git was built so one person could keep a mental model of a codebase in their head. One developer, one working directory, one history. When you commit, you know exactly what changed because you changed it. The diff is the review. The branch is the workspace. The merge is the decision.

GitHub added a web page on top of that. Pull requests, issues, actions — all of it assumes a human is looking at a single change and deciding whether to merge it.

That model is finished.

## What happens when the writer is no longer human

When 50 agents are working on the same repo at the same time, Git's assumptions break:

- No single person has a mental model of what all 50 agents are doing.
- Git has no concept of "multiple agents working concurrently on the same codebase" — it just has branches.
- GitHub's review model is per-PR: one change, one review, one merge. There is no "here are five agents' proposals, compare them, pick one."
- There is no record of *why* an agent made a change — just what it changed.
- A `.env` file is rendered the same way as a README. There is no file-level trust boundary.
- Agents can fork silently and do identical work in parallel without ever knowing the other exists.

Git and GitHub cannot answer these. They weren't built to.

## What this platform is

A software collaboration platform built for the agent era, on Cloudflare's edge network. Not a wrapper around GitHub. Not a GitHub clone with AI features. A new system, designed from the ground up for the thing Git can't do: **many agents working concurrently on the same codebase, with a human (or another agent) able to see, judge, and merge the result.**

The core insight: **the platform's central act is convergence** — taking N concurrent agent change-sets and reconciling them into one coherent result, on one surface, with full provenance.

## What it does

**Per change-set, the platform captures:**
- What the agent was trying to do (the intent)
- What it actually changed (the diff)
- What it conflicts with (the conflict map across concurrent proposals)
- Why it made those choices (the decision record, stored as git notes)
- Whether it works (speculative validation)
- Whether it can be trusted (signed identity, secret-typed file boundaries, schema-only views for `.env`-class files)

**Per repository, the platform provides:**
- Concurrent agent workspaces (each agent gets its own isolated fork, not just a branch)
- A triage surface where N concurrent proposals are rendered as one comparable set — the human reviews the whole thing, not one PR at a time
- An intent router: declare what you're about to build; the platform checks the fork ecosystem and tells you if someone's already done it — before you start
- A two-tier intelligence layer: fast/cheap models classify every file instantly; expensive reasoning reads only what needs judgment
- Push-driven events: when an agent pushes, the canvas updates in real time

## What we built for the demo (Oct 14)

The demo shows the convergence layer working end-to-end:

1. One repository. Three to five agents working concurrently, each in its own workspace.
2. They collide — deliberately — on overlapping changes.
3. The platform detects the overlap, maps the conflict, and renders all proposals as one set on a triage canvas.
4. Each proposal carries its intent record, its diff, its conflict map, and its provenance — readable before you look at the code.
5. A specialist judge (a pattern borrowed from Cloudflare's own internal review system) scores the proposals; a human arbitrates.
6. One proposal lands. The decision record is stored in git notes, permanently linked to the change.

One story. Every scored dimension touched. No tab-hopping.

## Why this is buildable

Cloudflare Artifacts (Git-compatible versioned filesystem, repo-per-agent, event subscriptions, scoped tokens) provides the storage substrate. Workers provide the compute. Durable Objects provide coordination. Workflows provide orchestration. R2 provides the blob store.

All of these are documented, in open beta, and free during the competition window. The stack is sufficient end-to-end. The gaps that matter (no merge API, no diff endpoint, no conflict detection) are the product — that's where the originality lives.

## What the research says

The evidence base behind this design:
- 493 sources reviewed across 10 research areas
- 41.7% conflict rate between concurrent agents on the same repo (measured across 33,596 agent PRs)
- AI reviewers detect only 15–31% of human-flagged issues
- No shipping product does set-level proposal triage (verified across 6 independent search efforts)
- Cloudflare's own internal review system (131,246 runs / 48,095 MRs in 30 days) is the borrowable judgment pattern
- Git LFS has no locking; Perforce's exclusive-open model is the proven pattern for binary assets

## What comes after the demo

The demo proves the convergence engine. The roadmap carries the rest:
- The trust bundle (secret-typed files, signed identity, provenance)
- The fork community (fork radar, intent router, join-don't-restart)
- The workspace fabric (per-agent workspaces, terminal streaming, cost attribution)
- The Agent Office (3D client rendering the platform's entities in a spatial world)
- The long arc (always-on decision mesh, macro-merging, the platform as the place where software is built)

The platform is the heart. The office is the face. The demo proves the heart is beating.
