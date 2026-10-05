# Intent — Next-Gen Git Platform

**Date:** 2026-10-02 · **Mode:** partner · **Submission:** 2026-10-14
**Source of truth:** `.memlog.md` (this directory). Full evidence base — 5 recon briefs + 3 research dossiers + source docs — is *not* reproduced here.

---

## 1. Locked concept

> **The convergence layer for concurrent agent change-sets.**

Software is being built by fleets of agents working in parallel, on the same code. The central act of this platform is **convergence**: multiple agents' change-sets arriving as *sets* on one surface, where they are reconciled, triaged, and merged — with provenance, not vibes.

The platform is the **heart**; clients are the **face**. Demo scope + vision roadmap together *are* the platform concept. The demo proves the convergence engine; the roadmap carries workspaces, trust, social, and the long arc.

**Job to be done (locked lens):** *"Watch my intent against everyone else's work and tell me when to join instead of build."* This makes join-don't-restart automatic rather than a habit.

**Future-state, 10-year rung:** humans stop writing code *and* stop discussing the build; agents handle both, humans orchestrate and monitor agent fleets. Companies merge at account level ("companies as a service").

**Ladder spine (holds at 1 / 10 / 100 years):** intent as primary input → always-on decision & coordination layer → inhabited (spatial) representation → convergence/merging as the central act.

---

## 2. Demo scope — LOCKED (MoSCoW)

| | Items |
|---|---|
| **MUST** | set-level triage canvas · concurrent agent workspaces · cross-proposal conflict map · per-proposal intent record · live push events to UI |
| **SHOULD** | secret-typed files · speculative validation · git-notes provenance · authoring lease · change-set identity |
| **COULD** | auto-changelog · GitLens-class parity · PM integration · pod/container visualization |
| **WON'T** | Agent Office 3D face · 10M-node mesh · full PM system · full binary pipeline |

The five MUSTs are the minimum shippable proof of the convergence layer. Everything else is roadmap or later increment.

---

## 3. Three storage classes

Every feature in this design lands in one of three tiers. Fast/cheap (System-1) tiers see **every** file; expensive reasoning reads only what needs judgment.

| Class | Holds | Serves |
|---|---|---|
| **1. Semantic / index tier** | per-file classification, type, security level, tags; vector index of the codebase | System-1 fast models (`e.g. Jev`) classify every file/directory near-instantly — per-file security levels without an expensive LLM read; semantic traversal so the architecture is *seen*, not grepped. Traversal = context maps + semantic index, not total reads. |
| **2. Work / state tier** | workspaces, task queue, presence, authoring leases, secret-typed files, stashes | Durable, expiring, frequently-written state. Stashing must not be difficult or feel losable. Locks are **surgical** — scope/entity-level, expiring, advisory-first; never fleet-wide serialization. |
| **3. Provenance / artifact tier** | git-notes, per-worker traces, receipts, live previews, screenshots/videos, native demos, push provenance (laptop vs production) | The repo answers for itself — no clone required. Previews, screenshots, videos, and demo links are built in, not bolted on. |

> Class boundaries are [derived] from the memlog's feature set; the memlog names the tiers implicitly (index, live/preview artifacts, presence/task state) rather than by name.

---

## 4. Trust bundle

A proposal is only as good as its evidence. The trust bundle is the set of things a viewer needs to believe a change-set — and the signals that make a fork worth joining.

**On a change-set:** per-proposal **intent record** (what it was trying to build) · **conflict map** across concurrent proposals · **provenance** (git-notes + per-worker trace, per-author, per-origin) · **receipts** · **test/proof** status · **speculative validation** · **authoring lease** (who holds it) · **change-set identity** · **secret-typed files** (never plaintext).

**On a fork card (six signal clusters — triggers investigation, never auto-decision; the verdict is "then we investigate"):**
1. **Fit / overlap** — semantic alignment between my declared intent and theirs
2. **People / trust** — signed identity, personal + community reputation
3. **Liveness** — velocity, recency, self-gardening
4. **Proof** — tests, receipts, session trail
5. **Distance** — drift from my base, conflict surface
6. **Cost-to-adopt vs regenerate** — LLM-merge estimate

The fork-card signal model maps 1:1 onto the proposal-card artifact from the technical dossier: intent summary, diff, risk, conflict map, provenance. Session ideas and verified research converge on the same card.

---

## 5. Fork community + intent router

The "siloed duplicate work" problem is the platform's social core.

- **Declare intent first.** The platform matches it against the fork ecosystem *before* work starts.
- **Intent router:** declares what you're about to build → platform replies **"80% done by fork X"** as a ping *before* the work begins. This automates join-don't-restart (R4) as a platform reflex rather than a social convention.
- **Active-fork radar:** surface active, relevant forks in context; see their unique diff vs yours; discover and talk to other forks' agents; fork-off-fork collaboration; more merge-back to upstream.
- **Background sub-agent comparison:** continuously diffs another fork's work against our PRD/prompt/implementation/goal.

**Matcher verdict shape (three states):**

| Verdict | Meaning |
|---|---|
| **merge it** | their work does the job — direct merge recommendation |
| **use as context** | partial fit — build with their implementation in hand; LLM-merge/refactor economics apply |
| **ignore** | different goal |

> The **partial-fit** branch of the background sub-agent was left open by the user and is **unresolved** (see §9).

---

## 6. Swarm rules (rulebook)

| # | Rule | Sharpened form |
|---|---|---|
| **R1** | Simple, standardized communication between agents | **Communicate *through the work*.** Claims, status, and receipts are written onto the shared artifact. Any agent orients locally — no hub, no global truth. |
| **R2** | Agents respect their box | **A denial is a wall, not an obstacle.** The platform counts retries on forbidden paths, closes them, forces the sanctioned alternative, and escalates. |
| **R3** | Agents obey tool directives | **Declare before you touch; receipt when you finish.** Collision avoidance with zero global knowledge. No sandbox-escape attempts. |
| **R4** | If someone already claimed it, join instead of starting over | Prefer reusing their code (LLM merge/refactor of theirs + ours) over regenerating equivalent code. Socially and economically. |

**Communication contract:** every agent output = **summary + structured detail + affordances** (clickable next actions that feed back as signals). An agent can emit a live web page whose buttons spur the conversation forward. Outputs are **control surfaces, not dead reports** — and they share the review UI's whitespace.

**Standardize the interface, not the intelligence.** BYO model / BYO harness. At minimum, standardize the *output* agents communicate to the user (verbose vs bullets vs visually conveyed).

---

## 7. Agent Office layering

**Locked:** platform = **web-first product + API (the heart)**. Agent Office = **flagship 3D client (the face)**, the target client to build toward — not a substitute for the traditional web interface. The API must be designed so 3D worlds can render it.

**Requirement on the API:** expose **3D-renderable entities and events** — floors, workers, queues, boards, presence.

**Building metaphor → platform mapping:**

| Building | Platform |
|---|---|
| Floors | projects |
| Workstations | workspaces |
| Task queue | swarm claim / receipt rules |
| Review room | set-level triage surface |
| Project floors | projects |
| Whiteboards / screen-share / VOIP | presence + board + chat entities |

**Platform API hypotheses derived from Agent Office's own needs:** worktree-as-a-service · provider-agnostic agent launch · normalized worker-event bus (unify 8 provider hook formats) · terminal streaming protocol (snapshot + per-row diffs + scrollback + input) · cost attribution + budget enforcement.

Upstream repo offered for analysis: `https://github.com/AgentSystemLabs/agent-office`.

---

## 8. Engineering laws

1. **Convergence is the central act.** Sets, not diffs. Triage at set level.
2. **Two-tier intelligence law.** Fast/cheap (System-1) models see *every* file first — classify, type, tag, lint. Expensive reasoning reads only what needs judgment.
3. **Self-describing platform.** A machine-readable tool manifest + structure map ships *into* every agent workspace. No context-blind agents: agents know every tool available to them and the platform's structure. (Also the direct answer to R2/R3 — denied `bash-grep` with an explicit "use the grep tool" must not be retried forever.)
4. **Repo answers for itself.** Semantic index + live preview + native demos + push provenance — comprehension without cloning.
5. **Agents inspect just enough.** Context maps + semantic index orient an agent without total reads.
6. **Locks are surgical.** Scope/entity-level, expiring, advisory-first. Never fleet-wide serialization.
7. **Contribution standard as a service.** Husky-style platform-level contribution standards: agents adhere immediately, deterministic and non-deterministic rules, enforced platform-side — *no per-repo scaffolding*. Auto-changelogs (git-cliff, semantic-release, release-drafter, conventional-changelog, changesets) and commit linting as platform features, not per-repo config.
8. **Ambient capability design law.** GitLens-class feature parity, but weave features contextually — discoverable *in place*, never buried in hundreds of tabs. Cross-page information at a glance without leaving the page. SPA-like continuity; no tab explosion.
9. **Work-item ↔ change-set linkage.** Work items and change-sets reference each other; review stays in one surface.
10. **Integrate PM, don't imitate it.** GitHub's milestones/labels feel half-baked. Either flesh out projects/PM fully or integrate Linear-class tools via a common API. Milestones/epics are first-class, checkout-able timeline objects speaking project language — not convoluted tags.
11. **Always-on decision layer.** Cheap System-1 decision agents run continuously, prime/feed the LLM agents doing code work, and can directly drive CI/CD. Always-on compute is affordable *because* the decision layer is cheap — cost-efficiency reinforces the design rather than contradicting it.
12. **Workspaces woven through the whole experience.** Merging feels transparent, seamless, and understandable — not a bolt-on.

---

## 9. Evidence

### Verified from Agent Office analysis (repo cloned, read-only analysts dispatched)

| Fact | Value |
|---|---|
| Repo state analyzed | `@ 157b176`, **703 files** |
| Backing store | GitHub assumed as **sole** backing store |
| Integration style | **polls every 90s** — no inbound webhooks |
| Entity contract | **11 entities**: Floor, Worker, Task/Queue, Issue, Pull, PR-detail, Presence, Whiteboard, Services, Settings, Chat |
| Architecture | 3-tier |
| Isolation model | worktree-per-worker |
| Queue pump cadence | **10s** |
| Terminal streaming | headless-xterm — snapshot + per-row diffs |
| Worker management | MCP, **5 tools** |
| Provider hook formats to unify | **8** |

**Gap hypotheses (agent-office → platform):** H1 GitHub-tight coupling (synthesize `reviewDecision`/`mergeState`) · H2 local git assumed (host git or native proposal model) · H3 **no cross-worker review** → platform-native proposal type *is* the convergence layer · H4 provenance gap (per-worker trace) · H5 secrets API per worker · H6 event gap — push events replace 90s polling · H7 global presence roster.

**Synthesis:** Agent Office's missing pieces (H3 set-level proposals, H4 provenance, H5 secrets, H6 push events) are precisely the platform's planned core. **The client is already waiting for the heart** — and a platform API mirroring the 11-entity contract can drop in and replace GitHub via a client adapter.

### Session evidence base

- **5 recon briefs + 3 research dossiers + source docs** were in play. They are not in this directory.
- Techniques run: Worst Possible Idea → Swarm Logic → Job to Be Done → Time Horizon Ladder (batch complete).
- Fork-card signal model: **6 clusters**. Swarm rulebook: **4 rules**. Matcher verdicts: **3**. Time-horizon rungs: **3** (1 / 10 / 100 years).

### Not captured in the memlog

The **competition rubric** and **conflict-rate figures** are referenced by the wider evidence base but **no numbers for them appear in the memlog** — they were not restated in this session's record. A downstream brief/PRD/spec that needs rubric criteria or concurrency-conflict statistics must pull them from the recon briefs and research dossiers directly. Do not invent them.

---

## 10. Open questions & deferred items

| # | Item | Status |
|---|---|---|
| 1 | **Partial-fit handling** — the "otherwise" branch of the background sub-agent matcher (when a fork's work *partly* fulfills the goal) | Open. Verdict shape exists (`use as context`); the operational policy does not. |
| 2 | **Fork-reuse and merge preferences** | Cannot be fully decided in advance. Needs trenches time — revisit with operational data. |
| 3 | **Triage-surface card design** | Open question: *what signals on a fork's card make joining safer than regenerating?* Six-cluster model drafted; concrete card design not decided. |
| 4 | **Agent Office: integrate or build toward?** | **Resolved** — build toward it as the flagship 3D client; it is not the core UI. |
| 5 | **Rung 3 (100 years)** — mind uploading, personality weights, robotics | Beyond design reach. Design for the *echoes* already visible at rungs 1–2: intent-first input, flavored agent personas, self-maintaining infrastructure. Not for the nebula. |
| 6 | **Swarm rule mechanics** | Rules accepted; mechanics deferred to the build phase. |
| 7 | **CI/CD interaction visibility** | Noted, explicitly low priority. |
| 8 | **Issues classification** — fast-model structured auto-tagging with better differentiation | Idea captured, not yet specced. |
| 9 | **Competitive differentiation** | The session asserted the differentiator is the *convergence layer + social layer*; no head-to-head positioning has been written down. |
| 10 | **Confidence-model claim** — that System-1 classification can beat expensive-LLM reads on per-file security levels | Asserted as a design premise, not measured. |

---

## 11. Handoff instructions for the next skill

- Build the **heart** (convergence layer) to the five MUSTs. Everything else is roadmap.
- The **proposal card** is the central artifact — it must render intent, diff, risk, conflict map, and provenance, and it is simultaneously the fork-discovery surface, the review surface, and the Agent Office review-room entity.
- **Push events, not polling.** H6 is a proof point the demo should visibly beat Agent Office's 90s poll on.
- Do not re-litigate the locked decisions in §1, §2, §7, and the laws in §8. Consume them.
- For rubric criteria and conflict statistics, go to the recon briefs and research dossiers — they are not in the memlog.
