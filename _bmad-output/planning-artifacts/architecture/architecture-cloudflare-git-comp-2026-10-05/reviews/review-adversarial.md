# Review — adversarial divergence attack

**Artifact:** `ARCHITECTURE-SPINE.md` (status: draft, 2026-10-05) — NextGit platform spine
**Lens:** adversarial — construct two units one level down that each obey every AD to the letter, yet still build incompatibly; every surviving pair names the AD to add or amend and its Rule.
**Reviewer:** ReviewAdversarial · 2026-10-06
**Evidence read:** `platform/src/index.ts`, `platform/src/land.ts`, `platform/scripts/{land,agents,real-agents}.mjs`, `platform/CONTRACT.md`, `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions, `docs/judge-layer-ideas.md`, `docs/STATE.md`, `/tmp/arch-sweep/{platform,spec}.md`.

## Verdict

The AD set is strong on single-unit discipline and weak exactly where the next wave builds. Twelve adversarial pairs survive: five high, four medium, three low. The load-bearing holes: (1) the judge surface ships next as P0 with **no contract-pinned shape**, while AD-8 only governs *changes* to shapes, not new routes; (2) the masking law stops at response bodies — **judge states/logs are an unguarded egress** for secret-class values; (3) the auto-land gate has **no server-side enforcement point**; (4) the base ref has **two sanctioned writers with divergent landing semantics** (`/land` vs the control-plane replay); (5) `/land` **silently re-folds** the reviewed set (no reviewed-state precondition), breaking CAP-7's "merged SHA equals tested SHA". Every pair closes by amending existing ADs — no new AD required.

## Pair summary

| # | Pair (unit × unit) | Incompatibility | Amend | Tier |
|---|---|---|---|---|
| F1 | judge wave (worker+UI) × second client (adapter) | `/judge`, card-signal, and push-event shapes unpinned; AD-8 covers changes, not new routes | AD-8 | High |
| F2 | judge state builder × masking filter | secret-class values can enter model state/logs — AD-4 binds only responses + folds | AD-4 (+ AD-11) | High |
| F3 | UI gate × direct API caller | fail-closed auto-land gate exists only client-side; `/land` has no gate branch | AD-11 | High |
| F4 | worker `/land` × control-plane replay (`land.mjs`) | two base-ref writers with divergent withheld/commit/evidence semantics | AD-1 + AD-7 | High |
| F5 | `/merge` preview × `/land` recompute | no reviewed-state precondition; silent re-fold lands untested content | AD-3 | High |
| F6 | queue consumer × `/land` event record | one logical push recorded twice; no dedupe; ≤50 window evicts real events | AD-6 | Medium |
| F7 | worker single-consumer × federated runner | "same queue/event surface" reads as 2nd consumer or non-conforming producer | AD-15 (+ AD-6) | Medium |
| F8 | agent-push workflow × runner-push workflow | two pushers for `main` + `nextgit-notes`; non-fast-forward / lost intent | AD-5 (+ AD-7) | Medium |
| F9 | read routes × `/land` | `baseRef` defaults differ (`main` vs `ref`); preview and land target different branches | AD-8 | Medium |
| F10 | provisioning (Workflows) × discovery (`agent-*`, ready, limit 200) | discoverability is implicit; renamed/async/oversized fleets vanish silently | AD-7/AD-10 | Low |
| F11 | fold (path law) × content-based secret detection | no fold/status semantics for content-detected secrets; enum reused or invented | AD-4/AD-8 | Low |
| F12 | asset-pipeline writer × `/changes` diff reader | R2 pointer/manifest typing unpinned; pointer contents can enter patches | AD-10 | Low |

## Findings

### F1 — [HIGH] Judge surface ships without a pinned shape; AD-8 governs changes, not new routes
**Construction.** Unit A: the judge wave — `AI` binding + `POST /judge` + card chips (recorded next P0, `docs/judge-layer-ideas.md:93-98`). Unit B: any second consumer of judge output (Agent Office adapter per CAP-9/AD-14, or the next UI slice).
**Why both comply.** AD-11 constrains *semantics* (three typed kinds, size caps, model id pinned/logged) but never the wire shape. AD-8's rule — "Changes are additive-only; a shape change bumps the contract first" — covers modifications to existing shapes; a brand-new route is not a change, and nothing requires pre-registration. `platform/CONTRACT.md` v2 has no `/judge` section, no card-signal keys, no push-event vocabulary.
**Incompatibility.** Request body, question keying, response envelope, error case, `setVersion`/`modelId` placement, and the three chip fields are all free to diverge — the exact silent-drift failure AD-8 exists to prevent, scheduled for the very next wave. AD-14 additionally declares "the push-event surface is THE client contract" while `/events` serves only `{type,repo,ref,after,at}` repo events (`index.ts:660-676`) against `interface-contract.md`'s `worker.*/term.*/floor.*` vocabulary; SPEC records card signals as explicitly undecided.
**Fix — amend AD-8.** Rule: "Every new route or payload lands its shape in `platform/CONTRACT.md` in the same slice that adds it; no producer or consumer ships an undocumented shape; contract-first is a gate. `/judge` request kinds, response envelope (including `setVersion` and model id), and the card-signal vocabulary are contract-pinned before the judge wave; the client push-event vocabulary is contract-pinned before a second client consumes it."

### F2 — [HIGH] The masking law covers response bodies and folds, not model egress
**Construction.** Unit A: a judge state builder that assembles `state` from the proposal change-set (binding reads are legal under AD-2; `judge-layer-ideas.md` asks questions over diff + notes). Unit B: the masking unit that redacts secret-class paths in responses and folds per AD-4.
**Why both comply.** AD-4's bound surface is "every response body, every fold" — a judge state sent to the `AI` binding is neither; a worker log line is neither. AD-11 restricts kinds and caps but says nothing about which content may enter `state`.
**Incompatibility.** A `.env` / `*.key` value read via binding reads can enter the Clef call (and `console.log` diagnostics) while both units are letter-perfect. CAP-8's stated intent — "never plaintext to unauthorized viewers; leak attempts scrubbed at commit" — is defeated at the platform boundary, not at a viewer.
**Fix — amend AD-4 (and add a clause to AD-11).** Rule: "Secret-class values never leave the worker in any form — response bodies, folds, intent fields, logs, or any model/judge state. Every outbound judgment state is constructed through the masking filter: secret-class paths enter as key names only; no AI call may receive secret-class content."

### F3 — [HIGH] Auto-land gate has no server-side enforcement point
**Construction.** Unit A: the UI, implementing the fail-closed gate behind the Land button ("then the auto-land gate behind the Land button", `judge-layer-ideas.md:98`). Unit B: a direct API client — the Agent Office adapter (AD-14/CAP-9) or curl — calling `POST /land` because AD-9 keeps every route demo-open.
**Why both comply.** AD-11 says "when the judge is unavailable, gates fail closed — no silent pass", but the gate is described as living behind the button; `/land` (`index.ts:725-813`) has no judge branch and no AD places one there. AD-9 explicitly ships routes open.
**Incompatibility.** For Unit B the gate does not exist: the fail-closed law binds a client-side ornament. A demo that shows fail-closed behavior through the UI and an unguarded mutation path via the API is two incompatible products under one contract.
**Fix — amend AD-11.** Rule: "The auto-land gate is evaluated inside `POST /land`, before fold and push; when the gate is engaged and the judge cannot answer, `/land` fails closed (5xx `judge-unavailable`, no push). Clients render the verdict; they never decide it. The gate's question set id and thresholds are part of the versioned set."

### F4 — [HIGH] Two base-ref writers with divergent landing semantics
**Construction.** Unit A: `POST /land` (single-commit fold+push, AD-1/AD-3 with withheld→409, conflict→409, no-changes→409). Unit B: the control-plane replay (`platform/scripts/land.mjs:119-134,159-161`) — asks the worker `/merge`, mints its own repo write token, replays locally, pushes `demo/main` directly.
**Why both comply.** AD-1 permits mutations that "live in the control plane"; AD-7 explicitly tolerates control-plane pushes. Neither AD limits *which refs* the control plane may write.
**Incompatibility (concrete divergence).** (a) Withheld semantics: `/land` refuses the whole set when any fold row is `withheld-secret`; `land.mjs` prints withheld files and **proceeds to land the remainder** — the same instruction means "refuse" vs "partial land". (b) Identity: worker authors `nextgit-platform <platform@nextgit.dev>` with message `land(<repos>): fold proposal(s)`; replay authors `platform-bot <bot@nextgit.dev>` with `merge into baseline`. (c) Evidence: the worker records a KV event; the replay records nothing, so "landed" state and the feed diverge by path. (d) Concurrency: both writers race the base ref with no lease (AD-10's DO tier is not consulted by either); the loser escalates into the token-handout fallback, which is itself a third base-ref writer.
**Fix — amend AD-1 and AD-7.** Rule (AD-1): "The base repo's branches are written only by `POST /land`." Rule (AD-7): "Control-plane pushes are provisioning-time baseline content and proposal repos only; landing replays are prohibited; the `/land` push-failure token handout is removed (AD-9)."

### F5 — [HIGH] `/land` silently re-folds the reviewed set — no tested-equals-landed guarantee
**Construction.** Unit A: the reviewer's `/merge` preview (what the human saw and what the UI labels "ready"). Unit B: `POST /land`, which recomputes the fold at call time from live refs (`index.ts:731`).
**Why both comply.** AD-3 pins the ancestor (fork point) and the fold algorithm; nothing pins the *state* the fold is computed against. `parseLandBody` (`index.ts:698-723`) accepts no expected head of any kind.
**Incompatibility.** If the base moves between preview and land (another landing, a control-plane push), `/land` silently pushes content the reviewer never saw — different file set / merged text at the same "ready" verdict. CAP-7's success criterion "merged SHA equals tested SHA" cannot hold when the tested artifact is the preview and the landed artifact is a recompute.
**Fix — amend AD-3.** Rule: "`/land` accepts the reviewed base head and proposal heads; on mismatch it returns 409 `stale` and refuses — no silent re-fold. The landing records the ancestor and heads used, and landing evidence references the commit `/land` returns."

### F6 — [MEDIUM] One logical push recorded twice; no dedupe in the feed
**Construction.** Unit A: the queue consumer, recording every Artifacts event (`index.ts:868-894`). Unit B: the `/land` handler, recording its own `repo.pushed` "even if queue delivery lags" (`index.ts:780-782`).
**Why both comply.** AD-6 requires "exactly one queue consumer" and "exactly one KV writer" — both code paths are the worker, so both hold.
**Incompatibility.** Every successful `/land` can yield two entries for the same push (consumer + handler), and at-least-once queue delivery duplicates even without the handler write. The ≤50 ring then evicts genuine events from other repos; UI freshness (AD-6's purpose) degrades exactly during the multi-agent demo. Consumer mapping also writes partial records for non-push Artifacts types (`token.*`, `fetched`) whose `payload.ref/after` are absent.
**Fix — amend AD-6.** Rule: "The queue consumer is the sole recorder of Artifacts events; records dedupe on `(type,repo,ref,after)`; `/land` may record optimistically only through the same dedupe helper; envelopes without repo identity are logged and dropped, never recorded partially."

### F7 — [MEDIUM] "Same queue/event surface" for federated runners is two incompatible topologies
**Construction.** Unit A: the worker as the single `nextgit-events` consumer (AD-6). Unit B: a federated Windows/GPU runner joining "through the same queue/event surface as everything else" (AD-15).
**Why both comply.** AD-6 says one consumer (of Artifacts events); AD-15 says the runner joins the same surface. Neither says *which* surface "queue/event surface" denotes, nor whether joining means consuming or publishing.
**Incompatibility.** Reading 1 (consume `nextgit-events`) makes the runner a second consumer — AD-6 violation by construction. Reading 2 (publish results into the queue) feeds the consumer non-Artifacts envelopes, recorded as partial KV records (see F6). Reading 3 (the docs/NEXT-ACTIONS loop queue, AD-12) is a third, unrelated mechanism. Three compliant designs, one keyword.
**Fix — amend AD-15 (and one sentence in AD-6).** Rule: "Federated runners publish results only through [the worker-mediated events route / a dedicated federation queue consumed by the worker]; they never consume `nextgit-events`; the event envelope is contract-pinned; one consumer per queue."

### F8 — [MEDIUM] Two pushers per proposal repo — agent-push vs runner-push
**Construction.** Unit A: the CONTRACT-documented "Agent push recipe — one command, three refspecs" (`CONTRACT.md:96-100`) with the agent pushing its own commits + notes. Unit B: the runner workflow — agents edit, "the runner/orchestrator commits" (AD-7), scripts push all three refspecs after the agent exits (`real-agents.mjs:408-411`; agent push is explicitly forbidden in the prompt).
**Why both comply.** AD-5 defines the three-refspec push but not its owner; AD-7 defines commit ownership but never says who pushes. Both readings are inside the letter.
**Incompatibility.** If both run for one repo, the second push non-fast-forwards `main` and/or `nextgit-notes`; intent can be lost or the proposal abandoned mid-run. The mirror branch has no fast-forward-only rule, so a stale writer can also silently rewind it.
**Fix — amend AD-5 (consistent with AD-7).** Rule: "Exactly one pusher per proposal repo: the orchestrator/runner performs the single three-refspec push after commit; agents never push refs (the CONTRACT recipe is rewritten as runner-executed); the mirror branch is fast-forward-only; the fallback carrier lives only on the mirror branch."

### F9 — [MEDIUM] `baseRef` default differs between read and write routes
**Construction.** Unit A: read routes defaulting `baseRef` to `"main"` (`index.ts:828,836,846`). Unit B: `/land` defaulting `baseRef := ref` (`index.ts:703`).
**Why both comply.** The spine pins route shapes and the fold ancestor but never default resolution; CONTRACT examples always pass every parameter explicitly, so both defaults are "undocumented behavior".
**Incompatibility.** A client that passes `ref=feature` and omits `baseRef` previews the fold against `main` and lands it onto `feature` — the previewed target and the mutated target differ, contradicting AD-3's own claim that `/merge` and `/land` share semantics.
**Fix — amend AD-8.** Rule: "Default resolution of `base`/`ref`/`baseRef` is identical on every route and pinned in CONTRACT.md; no route may resolve defaults privately."

### F10 — [LOW] Provisioning→discovery visibility is an implicit contract
**Construction.** Unit A: the provisioning unit (scripts now; Workflows per AD-10/AD-7). Unit B: the discovery unit: `agent-*` names with `status === "ready"`, `list({limit: 200})` (`index.ts:556-561`).
**Why both comply.** The spine's naming convention (`agent-N`) and AD-7/AD-10 provisioning rules never pin a discoverability handshake; discovery semantics live only in worker code.
**Incompatibility.** A fork created but not yet `ready` when tokens are handed off, a renamed fleet, or >200 repos makes proposals vanish from `/proposals` with no error — the demo set silently shrinks. A Workflows migration can change naming/timing without violating any AD.
**Fix — amend AD-7/AD-10.** Rule: "Provisioning guarantees discoverability before tokens are handed off (naming per conventions, status ready); auto-discovery semantics, including pagination, are documented in CONTRACT.md — discovery is a platform promise, not an implementation detail."

### F11 — [LOW] Content-detected secrets have no fold/status semantics
**Construction.** Unit A: the fold, path-driven by design, with frozen enums (`ready|conflict|landed|withheld-secret`). Unit B: the P1 content-based secret detection — "regardless of file path" (`judge-layer-ideas.md` idea 11).
**Why both comply.** AD-4 forbids weaker rules; it does not classify stronger ones. Detection is judge-advisory under AD-11, so it need not reuse the fold enum.
**Incompatibility.** A secret in a non-secret-class path yields three compliant behaviors: fold lands it (path law), fold reuses `withheld-secret` (dissolving the law's path meaning), or a gate blocks it with an undocumented status/error — the same card shows different badges depending on which unit ran.
**Fix — amend AD-4/AD-8.** Rule: "Content-detected secrets are either a contract-bumped status value (additive enum extension) or a judge gate only — never both, never implicit. The chosen semantics and its error surface land in CONTRACT.md before the detection unit ships."

### F12 — [LOW] R2 pointer/manifest typing unpinned before the asset tier lands
**Construction.** Unit A: the asset pipeline writing manifests/pointers into Artifacts (per AD-10). Unit B: `/changes`/`/merge`, which render every non-binary text file as a patch or merged text.
**Why both comply.** AD-10 keeps merge/conflict/diff "on Artifacts, never on R2 blobs" — pointer files *are* Artifacts files, so the diff unit renders them; nothing classifies them.
**Incompatibility.** Pointer contents (object keys, presigned URLs, hashes) become patch/merged text in responses; budget classes (patch caps) and masking are unpinned for them. Two units, both correct by the letter, one leaks metadata class the masking law never considered.
**Fix — amend AD-10.** Rule: "The pointer/manifest format is contract-pinned before the tier lands; pointer files are non-diffable (metadata-only rendering); credential-adjacent values (URLs, keys) follow the masking law."

## Pairs considered that held

- `/proposals` vs `/land` verdict consistency: verified aligned (withheld > conflict > no-changes↔landed; `index.ts:530-548` vs `733-753`) — no divergence.
- Masking between `/merge` preview and `/land`: both consume the same `computeMerge` rows — holds.
- Queue single-consumer, KV single-writer today: one consumer binding, one writer codebase — holds until the federation/judge waves, where F6/F7 bite.
- Event/timestamp/error-envelope conventions: consistent across current routes.

## Verdict summary

Spine is directionally right but not yet a build substrate for the judge/DO/Workflows wave: 5 high-tier divergence pairs sit directly on the next planned work (judge shape, judge egress, gate enforcement, landing ownership, landing preconditions). All are closable by Rule amendments to AD-1, AD-3, AD-4, AD-6, AD-7, AD-8, AD-10, AD-11, AD-15 as specified above.
