---
id: SPEC-next-git-platform
companions: [demo-scope.md, engineering-laws.md, stack.md, interface-contract.md, fork-community.md]
sources: ["../../brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md"]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Next-Gen Git Platform — Convergence Layer for Concurrent Agent Change-Sets

## Why

Code generation became cheap; code integration did not. Fleets of agents now work on the same codebases simultaneously and blind to each other — cross-agent pairs conflict at ~42% across 33,596 agent PRs, and frontier models catch only 15–31% of human-flagged issues — while every incumbent (GitHub, GitLab, review vendors, agent workbenches) still reviews one change at a time. No shipping product presents N concurrent agent change-sets as one comparable set (verified across multiple independent sweeps, Oct 2026). Cloudflare's competition — submission 2026-10-14, judged 50% originality/prototype · 25% multi-agent concurrency · 25% UX, Workers + Artifacts mandatory — is the beachhead to claim the unoccupied layer: **convergence** — the set-level surface where concurrent proposals are compared, judged, and landed. The substrate just became available (Artifacts open beta, Oct 2026). The platform is web-first + API for the agent era; clients (e.g. Agent Office) are its face.

## Capabilities

- **CAP-1 — Concurrent agent workspaces**
  - **intent:** Provision N isolated workspaces (Artifacts forks) from one baseline so concurrent agents work without stepping on each other.
  - **success:** One command creates N workspaces with scoped tokens; each accepts independent pushes; each push emits an event. (N=4 proven live 2026-10-03.)
- **CAP-2 — Change-set capture**
  - **intent:** Read each proposal's commits, changed files, and diffs vs baseline server-side — no clones.
  - **success:** Per-fork commit list + per-file diffs returned within a Worker CPU budget (30s default).
- **CAP-3 — Cross-proposal conflict detection**
  - **intent:** Detect and map overlap between concurrent proposals before landing.
  - **success:** A conflict map (conflicting file pairs; structural vs textual) produced for N proposals; demonstrated with a deliberate collision.
- **CAP-4 — Set-level triage surface**
  - **intent:** Present N concurrent proposals as one comparable set, each as a proposal card (intent, diff, risk, conflict map, provenance).
  - **success:** A reviewer compares the whole set on one canvas and selects one to land — no tab-hopping; shown live in the demo.
- **CAP-5 — Intent records (context preservation)**
  - **intent:** Every change-set carries its why — a decision record reviewable before the diff and durable across rebases.
  - **success:** Per-proposal rationale visible on the card; records persist as git notes (`refs/notes/*`) through rebase.
- **CAP-6 — Live event pipeline**
  - **intent:** Pushes, forks, and creates flow push-style and drive the UI in real time — no polling.
  - **success:** A push appears as a live UI update in seconds (push → event → queue → worker → UI), visibly beating a 90s poll. (Pipeline proven live 2026-10-03.)
- **CAP-7 — Landing path**
  - **intent:** Land a chosen proposal safely with validation evidence attached — merged SHA equals tested SHA.
  - **success:** The chosen proposal merges to baseline through the platform with evidence recorded on the landing.
- **CAP-8 — Trust layer**
  - **intent:** Secret-class files (.env, credentials, certs) are typed objects — schema-only views by default, never plaintext to unauthorized viewers; leak attempts scrubbed at commit.
  - **success:** Demo shows schema-only view + elevated reveal + a commit-time scrub.
- **CAP-9 — Platform API for clients**
  - **intent:** Expose 3D-renderable entities and events (floors/projects, workers, tasks, issues, proposals, presence, whiteboards, services, settings, chat) so any client — including a 3D world — can render and act on platform state.
  - **success:** An external client renders workspace/proposal state from the API alone; the Agent Office adapter can replace GitHub as its backing store (see interface-contract.md).
- **CAP-10 — Fork community + intent router**
  - **intent:** Declare intent before building; match it against the fork ecosystem; make join-don't-restart a platform reflex.
  - **success:** Given a declared intent and a fork set, the matcher returns merge-it / use-as-context / ignore verdicts with six-cluster signals. (Post-demo.)

## Constraints

- **Competition:** Workers + Artifacts mandatory; multiple agents working concurrently; 5–10 min video + OSI license (MIT/Apache/BSD + LICENSE file) + run instructions; due **2026-10-14**; judged 50% originality/prototype · 25% concurrency · 25% UX; single entry; winner presents at Cloudflare Connect SF (Oct 21). Eligibility requires US/Canada residency — unresolved (see Open Questions).
- **Artifacts limits:** 1 GB/repo · 32 MB/file · 2k git req/10s/repo; **no server-side merge, diff, conflict detection, or branch protection** — the platform builds them.
- **Artifacts push:** ~64 MiB push cap (push-side) → small incremental pushes; push protocol v1-only (isomorphic-git 1.42.x matches); `refs/notes/*` supported; events via Queues subscriptions.
- **Cloudflare compute:** Workers CPU 30s default / 5 min max; no Windows/GPU/macOS (game builds federate, post-demo); **review path never clones** — binding-side reads + in-Worker diffs.
- **Demo sprint:** ships exactly the five MUSTs (demo-scope.md); ~10 days to submission; everything else roadmap.
- **Real platform only:** built on live Workers + Artifacts end to end — no mocks.
- **Design constitution:** every build decision answers to the twelve engineering laws (engineering-laws.md).

## Non-goals

- No GitHub-clone / per-PR-review core — the per-change review model is explicitly rejected as the platform's center.
- No 3D office work in the demo sprint — Agent Office is the flagship *client*, post-demo.
- No full project-management system — integrate PM tools via API instead.
- No binary/game-asset pipeline this phase (R2 chunking, exclusive locks, per-file ACLs) — game-industry support is roadmap.
- No 10M-node mesh, macro-merging, or always-on decision-mesh infrastructure this phase.
- No from-scratch merge algorithm — borrow entity-level merge concepts (stack.md).

## Success signal

Submit by Oct 14 a live 5–10 minute demo in which one repository runs 3–5 concurrent agents, a deliberate cross-agent collision surfaces as a conflict map, every proposal sits on one triage canvas with intent and provenance, one proposal lands with its validation evidence, and a secret-typed file is shown schema-only — all on real Workers + Artifacts, exercising all three scored axes in one uninterrupted story. Beyond the submission: teams running agent fleets choose this platform because concurrent work finally converges.

## Assumptions

- Artifacts open beta remains usable through Oct 14 without breaking changes.
- The account's Artifacts access persists (verified working 2026-10-03).
- Demo agents can be driven by CLI harnesses and/or scripted writers — a build-time choice.
- Judges accept the demonstrated concurrent workspaces + triage flow as satisfying "multiple agents working on changes concurrently."

## Open Questions

- Eligibility: are you (or a teammate) a legal US/Canada resident? Terms §3 voids the entry otherwise.
- Where does the submission repo live? (This project directory is not a git repo yet.)
- Demo agent harness: real CLI agents, scripted writers, or both?
- Triage card signals: exact fields per card (six-cluster model drafted; not decided).
- Partial-fit matcher policy (use-as-context rules) — deferred to build.
- 64 MiB push cap fix ETA — watch before submission.
