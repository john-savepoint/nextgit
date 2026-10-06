# Next actions

> Derived from porting/tasks.db via bun porting/tasks.mjs — never edit by hand; starting fresh? Read docs/STATE.md then docs/CHECKPOINT.md.

- [pending] P0 — Wire the Clef judge layer — add `"ai"` binding + `POST /judge` to the worker; put risk score + intent-vs-diff verification + semantic-collision chips on proposal cards; acceptance: chips render from live Clef answers in-browser; check: curl `/proposals` shows judge fields + the page renders them (ideas 1-4 in docs/judge-layer-ideas.md)
- [pending] P0 — Write the PRD (bmad-prd) — product requirements for platform + demo + submission, built from SPEC + dossiers; acceptance: PRD lands under `_bmad-output/planning-artifacts/` and upstream SPEC re-derives clean
- [pending] P0 — Demo scenario reset + fresh real-agent fleet — run `seed.mjs` → `real-agents.mjs` for a pristine 4-pending state; acceptance: `/proposals` = 4 real proposals, ≥1 conflict, intents present
- [pending] P0 — Video script + storyboard — the 5–10 min narrative: agents work → collision → judge chips → one click lands → done; acceptance: script reviewed by John before recording
- [pending] P0 — Record + edit the submission video — capture the live platform end-to-end (reset first); acceptance: 5–10 min video ready to submit
- [pending] P0 — Submission package — OSI LICENSE + README + run instructions + repo curation + eligibility resolution; acceptance: every submission requirement checked off; entry filed
- [pending] P0 — Land hardening: reviewed heads + base-moved preconditions + evidence record (AD-3) — Additive request fields for reviewed base/proposal heads (409 stale on mismatch); re-read base head after clone (409 base-moved); landing records ancestor + heads + foldHash and returns the commit as the evidence reference; contract bump first; includes the AD-9 demo allowlist + edge rate limits on /land.
- [pending] P0 — Write epics and stories (bmad-create-epics-and-stories) — Turn the PRD + registry into the buildable epic/story set; stories feed the store as schedulable items.
- [pending] P0 — Demo beat: visibly outrun the 90s poll baseline — Contract H6 requires the demo to visibly beat Agent Office's 90s polling; add an on-screen timing comparison (push latency vs the 90s poll reference) so the difference is legible to judges.
Ref: interface-contract.md What Agent Office lacks (H6); demo-scope.md story step 3
- [pending] P0 — Demo video: 5-10 min single take covering all three axes — Record the 5-10 minute demo as one uninterrupted story (workspaces, collision, conflict map, triage, landing, secret beat) exercising all three scored axes.
Ref: SPEC.md Constraints (competition); demo-scope.md Demo story
- [pending] P0 — Submission compliance: OSI license + LICENSE file + run instructions — Competition requires an OSI license (MIT/Apache/BSD) with a LICENSE file and run instructions in the submission.
Ref: SPEC.md Constraints (OSI license + run instructions)
- [pending] P0 — Submission: repo location + single entry registered by Oct 14 — Decide where the submission repo lives and register the single entry before the 2026-10-14 deadline.
Ref: SPEC.md Open Questions (submission repo); SPEC.md Constraints (single entry, deadline)
- [pending] P0 — Live-only E2E verification gate before submission (no mocks) — Constraint: built on live Workers + Artifacts end to end, no mocks. Run the full demo story against the deployed platform as the pre-submission gate.
Ref: SPEC.md Constraints (real platform only)
- [pending] P0 — Deliver events to canvas via true push (SSE/WebSocket) — (demo MUST, remaining half) Replace the current 2s/8s UI polling with server push so the triage canvas updates immediately on an agent push - the visible proof point the demo needs against Agent Office's 90s poll.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H6; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 11; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92
- [pending] P0 — Complete unified proposal card (intent, diff, risk, provenance) — (demo MUST) The proposal card must render intent, diff, risk, conflict map, and provenance, and serve simultaneously as fork-discovery surface, review surface, and Agent Office review-room entity. Base card exists with intent/stats/landing; risk and provenance facets are incomplete.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 11; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:59
- [pending] P0 — Build specialist judge scoring proposals for arbitration — (demo) A specialist judge scores proposals on the canvas while a human arbitrates - borrowing Cloudflare's internal review pattern. Research verified a live typed-answer call (~1.3s, ~$0.00012/call) and produced a 36-idea catalog; scoring is not yet integrated into the worker or canvas.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What we built for the demo' step 5; docs/BUILD-LOG.md judge research row; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92
- [pending] P0 — Enforce server-side exclusive file locks (binary+l semantics) — Per-file atomic first-writer-wins locks enforced server-side (not advisory), with soft and hard modes. A denied open returns lock owner identity; lock state is globally visible and released on submit/revert. This is the central AAA requirement for non-mergeable binaries.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §5 req#1 (L174) + §1 +l/f (L31,43)
- [pending] P0 — Store multi-GB binaries natively without LFS pointer rewriting — First-class versioned storage for .uasset/.umap/.pak/.bik/.fbx up to several GB, with no separate pointer tier that rewrites Git object IDs and no plan cap below multi-GB (GitHub LFS caps at 2-5 GB; non-LFS hard-blocks >100 MiB).
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §5 req#2 (L175) + §4 (L149-152)
- [pending] P0 — Build CDC chunk store for game assets in R2 — Content-defined chunking (GearHash/Rabin/FastCDC; target 64 KiB-8 MiB) stores content-addressed chunks in R2 so edits invalidate only nearby chunks. This is the core game-asset/R2 tier replacing LFS full-copy-per-revision storage.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §2.1 (L48-66) + §6 Pattern A/F (L175-198) + Open Q1/Q4 (L204-207)
- [pending] P0 — Write chunk manifests and Merkle integrity into repo — Manifest maps each blob to its ordered chunk hashes and is versioned with the repo; a Merkle tree gives integrity and partial verification, replacing LFS's fragile sha256+size pointer with no chunk-level integrity.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §1.6 (L41-42) + §2.10 (L104-105) + §6 Pattern F (L195-197)
- [pending] P0 — Serve blobs via presigned direct-to-R2 transfers — Client upload/download goes direct to R2 via presigned URLs (1s-7d) or multipart sessions, because Workers request bodies cap at 100 MB (5 GB Enterprise) and cannot proxy multi-GB assets. Chunks are immutable, so the path is CDN-friendly.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §4.1-4.2 (L132-142) + §6 Pattern D (L187-189)
- [pending] P0 — Implement lazy hydrated checkout for huge repos — Metadata-first (blobless) checkout with placeholder working tree, hydrate-on-read via FUSE-style mount, local blob cache, and priority for manifests over binaries; ArtifactFS-compatible (hydration concurrency, 30-min prep timeout, dirty overlay). Full clone of a multi-TB game repo is infeasible.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §2.6-2.9 (L88-103) + §6 Pattern C (L183-185)
- [pending] P0 — Split storage: source in Artifacts, big binaries in R2 — Artifacts caps (1 GB/repo, 32 MB/blob) force large files into R2 while Artifacts holds source, pointers, and manifests; enforce the size cutover automatically so repos stay within limits. Each primitive plays to its strength.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §4.4 (L149-152) + §6 Pattern E (L191-193); research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §6 Artifacts limits (L207-208)
- [pending] P0 — Orchestrate multi-tenant CI on Workflows and @cloudflare/ci — Per-repo/per-proposal durable pipeline instances driven by artifact-push events, with Dynamic Workflows loading tenant definitions at runtime. Respect the envelope: 1 MiB step payloads, 100 MB-1 GB persisted state, up to 25k steps, 50k concurrent instances.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §2 @cloudflare/ci + Dynamic Workflows (L54-66) + §5 req row 1 (L172)
- [pending] P0 — Validate every proposal with speculative execution — Each proposed change gets validation on speculative state before merge: push a speculative branch to Artifacts, trigger the pipeline, then attach the result to the proposal. No native speculative state exists, so this must be built.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §5 req rows 1-2 (L172-173)
- [pending] P0 — Fan out untrusted jobs into isolated sandboxes — Every job/agent executes in its own Linux container (fs/mem/net isolated from siblings), using RPC transport to dodge subrequest limits; no kernel modules or GPU. Account ceilings: 6 TiB memory, 1,500 vCPU, 30 TB disk.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §2 Sandbox SDK (L68-74) + §5 req row 4 (L175) + §6 (L202-205)
- [pending] P0 — Attach signed validation evidence to every change — SLSA-style attestations recording what ran, on which inputs, in which environment, with what result - signed and stored (Workflow state + R2) so evidence travels with the commit/proposal and is verifiable later. No native attestation primitive exists; must be built.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §5 req row 5 attestations (L177) + §3 (L112)
- [pending] P0 — Provision isolated workspaces with full lifecycle — Create -> pause -> resume -> GC lifecycle for per-user/session/task containers with DO identity, sleep timeouts, snapshot restore <200 ms, and a <5 s ready target; dirty overlay state must survive pause/resume. Cost control depends on aggressive idle reclamation.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §6 lifecycle (L167-174) + §2 patterns 1/5 (L48-52)
- [pending] P0 — Provide worktree-as-a-service for parallel agent tasks — Cheap parallel worktrees/branches per agent task with auto create/cleanup, each on its own working tree against the shared repo, provisioned with scoped tokens. Mirrors the Codex model of worktree isolation at platform level.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 pattern 2 + Codex row (L41,49) + §6 lifecycle (L167-174)
- [pending] P0 — Run coding agents in sandboxes with event wakeups — Execute Claude Code/Codex/custom agents in per-session sandboxes with exec/readFile/writeFile/startProcess/exposePort, R2 mounts, heartbeat and sleep timeouts; agents can subscribe to platform events and resume. This is the agent-native execution harness.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 Sandbox SDK row (L114) + §2 patterns 3-4 (L50-51)
- [pending] P0 — Ship pre/post-commit review with tracked approvals — Pre-commit review from shelves and post-commit review with tracked approvals that gate merges; AI-assisted review passes on top (Swarm model, 2026 AI review). Review is the competition's coordination surface.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 Swarm (L92-94)
- [pending] P0 — Ship set-level triage of N concurrent agent change-sets as hero flow — Make the convergence layer the submission's hero flow: multiple agents' concurrent change-sets compared, judged, and integrated as one set. It is the doubly-verified unclaimed intersection and maps to the rubric's originality (50%) and concurrency (25%) criteria.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:21,98; competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:21,137; agentic-git-platform-ecosystem-feature-matrix/report.md:382
- [pending] P0 — Build three-tier architecture: substrate, judge, triage UI — Structure the product as execution substrate (entity merge + symbol locks), judgment tier (coordinator -> specialists -> arbitration), and set-level triage UI; budget the novel effort on the UI and change-set semantics.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:27,81,99
- [pending] P0 — Win on triage/context layer, not merge mechanics — Whitespace is closing (sigbound ~80% overlap, CLI/local; Cursor Origin closed beta): the defensible slice is a real-time, multi-agent, single-repo coordination + triage console with preserved shared context, not conflict avoidance.
Ref: agentic-git-platform-ecosystem-feature-matrix/verify-round-1-trajectory.md:75; agentic-git-platform-ecosystem-feature-matrix/report.md:376,382
- [pending] P0 — Differentiate explicitly vs Whiteboard: set semantics + multiplayer — Sharpest overlap ships cross-platform open-source AST-diff visual review, one branch at a time, local: our line is concurrent set semantics + cross-change conflict graph + hosted platform multiplayer, not 'another visual reviewer'.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:29,76,139; competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:108,139
- [pending] P0 — Implement entity-level 3-way merge as pure function over base/ours/theirs — Borrow Weave's entity-level merge design: merge is a pure function over (base, ours, theirs) with CRDT claims decoupled as advisory only; verify fit in the build.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:49,73; agentic-git-platform-ecosystem-feature-matrix/report.md:165
- [pending] P0 — Implement claim->work->done lock queue for contested symbols — Borrow grit-style advisory locks: agents claim symbols before editing, work, then mark done; contested symbols route through a lock queue while non-conflicting work proceeds in parallel.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:37,73; agentic-git-platform-ecosystem-feature-matrix/report.md:165
- [pending] P0 — Compute cross-change conflict graph across concurrent change-sets — Show which proposals touch the same files/symbols and which conflict; this is the explicit differentiator ahead of Whiteboard's one-branch review.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:76,139; agentic-git-platform-ecosystem-feature-matrix/report.md:382
- [pending] P0 — Detect cross-worktree conflicts before writes land — Match clash's read-only detection: check each agent's pending writes against other worktrees' state (merge-tree style) so collisions are caught pre-commit, not at merge.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:96-104; agentic-git-platform-ecosystem-feature-matrix/verify-round-1-trajectory.md:53; agentic-git-platform-ecosystem-feature-matrix/report.md:165
- [pending] P0 — Issue per-review authoring lease and command receipts — Copy Whiteboard's concurrency interface: at most one writer per review at a time and every mutation recorded as a receipt so two agents (or human+agent) cannot silently clobber each other.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:101; agentic-git-platform-ecosystem-feature-matrix/report.md:169,383
- [pending] P0 — Give changes durable logical identity independent of branches — Gerrit Change-Id style: each logical change keeps a stable identity across patchsets/rebases so sets, reviews, and provenance bind to the change, not a branch name.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:163,383
- [pending] P0 — Scale Cloudflare's coordinator->specialists->arbitration judge to sets — Borrow the strongest existing pattern (7 specialists + coordinator, 131,246 runs, 3m39s median) and scale it from one PR to a set: specialists score each proposal, the coordinator aggregates one verdict, humans arbitrate disagreements.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:38,74; agentic-git-platform-ecosystem-feature-matrix/report.md:121,383
- [pending] P0 — Risk-tiered specialist review over shared cached context — Implement risk-tiered review (the $0.20/$0.67/$1.68 archetype) so cheap review covers low risk and deep specialist panels are reserved for high risk; share cached context (85.7% cache-hit archetype) across reviewers.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:74; agentic-git-platform-ecosystem-feature-matrix/report.md:121,255,383
- [pending] P0 — Post-merge behavioral verification (silent-drop guard) — Parallel agents silently drop features at merge with no error or test signal: verify behavior after merge (not just build) and surface any lost change; never let 'passed its own CI' mean safe to merge.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:50,83; agentic-git-platform-ecosystem-feature-matrix/report.md:75
- [pending] P0 — Build predictive validation so merged SHA equals tested SHA — Merge-queue canon: validate each change against main plus everything ahead of it so the merged commit is exactly the tested one; implement in-platform because Artifacts has no merge API.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:57,162,383
- [pending] P0 — Do binding-side diffing; no clones in review paths — readFile/readCommit/readTree/readBlob over arbitrary refs let review flows avoid clone/pack entirely and stay inside Worker CPU budgets; commit-sized diffs run well under a second.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:67,102; agentic-git-platform-ecosystem-feature-matrix/report.md:119
- [pending] P0 — One Durable Object per repo as realtime hub — Per-repo DO (embedded SQLite per instance) as the coordination hub for leases, the change map, the findings ledger, and hibernating WebSocket review rooms at near-zero idle cost.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:115,167
- [pending] P0 — Workflows durable job per agent task with human-approval wait — Durable per-task jobs (50k concurrent instances; waiting instances do not consume slots) with waitForEvent for human approval gates.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:115,167,386
- [pending] P0 — Fan out Artifacts repo events through Queues — Subscribe to repo.pushed/repo.forked (event subscriptions via Queues) so the change map and conflict graph update as agents push.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:141; agentic-git-platform-ecosystem-feature-matrix/report.md:119,386
- [pending] P0 — Repo-per-agent + fork-from-baseline isolation — Isolation is solved and commoditized: repo (or worktree) per agent forked from a baseline with one comparison view; reject shared-workspace soft isolation (PaperBench: soft 55.5% below single-agent 57.2%; worktree 63.3%).
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:48; agentic-git-platform-ecosystem-feature-matrix/report.md:164
- [pending] P0 — Downscope agent tokens to least privilege per repo — Artifacts best practices: repo-per-agent, fork-from-baseline, least-privilege repo-scoped tokens; never place broad credentials in agent workspaces.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:119,386; technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:60
- [pending] P0 — Build multiplayer triage canvas with proposal artifacts — The greenfield centerpiece: each proposal arrives as a reviewable artifact (intent summary, diff, risk score, conflict map, provenance) on a shared realtime canvas with presence.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:75,139; agentic-git-platform-ecosystem-feature-matrix/report.md:382,387
- [pending] P0 — Visualize the cross-change conflict map on the canvas — Cross-change conflict semantics must be visible, not just computed: render overlap/conflict visualization per file/symbol across proposals with drill-down.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:139; agentic-git-platform-ecosystem-feature-matrix/report.md:382,387
- [pending] P0 — Multiplayer review rooms as the platform-multiplayer differentiator — Differentiation vs local single-user tools: hosted, real-time, multi-user review of the same set, explicitly ahead of Whiteboard's local one-branch review; review rooms must survive at near-zero idle cost.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:139; technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:29,76
- [pending] P0 — Keep pushes small and incremental under the ~64 MiB cap — Artifacts' open ~64 MiB push cap (push-side only, no ETA or workaround; 63 MiB passes, 64 MiB returns HTTP 500) forces small incremental pushes; binary-heavy repos stay out of scope until fixed.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:65,83,102
- [pending] P0 — Pin isomorphic-git 1.42.x; never disk-checkout untrusted trees — CVE-2026-89011 is fixed in 1.42.0 and six further 2026 advisories include symlink/path-traversal file-write (one with potential RCE): pin latest 1.42.x, keep an advisory watch, and never check out untrusted trees to disk.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:56,102
- [pending] P0 — Demo: one repo, 3-5 agents, seeded collision, land one, scrub leak — Demo shape: one repo with 3-5 concurrent agents, an intentional cross-agent collision, the conflict map on the canvas, reviewer triage with provenance and risk, one proposal landing through predictive validation, and a secret-leak attempt scrubbed at commit - one uninterrupted story that touches every scored dimension.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:387,399
- [pending] P0 — Pin competition milestone calendar (deadline, finalists, finals) — Submission due Oct 14 11:59 PM PDT (single entry); finalists named Oct 16; finals Oct 21, live on stage at Cloudflare Connect, Moscone West SF — 10-minute presentation, up to 2 people flown out, winner must be present. Calendar must be treated as hard stops for every workstream.
Ref: session history 2026-10-05 competition-terms read summary (deadline/finalists/finals); SPEC.md Constraints (due 2026-10-14, Oct 21)
- [pending] P0 — Import registry harvest into the task store (dedupe + IDs) — Merge every porting/harvest/*.json (session, spec, memlog, research, judge, source-docs, ...) into porting/tasks.db through the CLI (layer/source columns), deduplicating cross-source rows, assigning canonical IDs, and preserving priority/layer/ref. This is the master itemized list John ordered: workflows then iterate over the DB ad nauseum.
Ref: session history 2026-10-06T02:30 user msg + assistant reply (master registry mandate); porting/harvest/*.json; porting/tasks.mjs cmdImport
- [pending] P0 — Production build chain: PRD → epics → registry → systematic build — John's directive: populate the DB with everything discussed — every item as a buildable row — so dynamic workflows iterate over it ad nauseum and create the entire production software in the allocated timeframe. Ordered chain: PRD (bmad-prd) → epics/stories (bmad-create-epics-and-stories) → master registry in the task store → systematic workflow build. PRD inputs (analysis, dossiers, brainstorm, SPEC+companions, judge catalog) are ready; the PRD artifact is not yet generated.
Ref: session history 2026-10-06T02:30 user msg + assistant reply ('PRD → epics → master registry → systematic build'); docs/NEXT-ACTIONS.md [pending] P0 — Write the PRD
- [pending] P0 — Non-MVP production-scope mandate: demo is a marked subset — Principal directive repeated three times: this is the entirety of the product, not an MVP. The registry must not be pruned to demo scope; the competition demo is a marked subset of the production registry, and demo-scope items are tagged, not used to filter the list.
Ref: session history 2026-10-06T01:27, 2026-10-06T01:55, 2026-10-06T02:30 user msgs ('we are not doing an MVP')
- [pending] P0 — Registry harvest wave: itemize every source into harvest JSONs — The 7-worker harvest itemizes every discussed capability from all sources — spec, memlog, research, judge catalog, source conversation docs, session history — into porting/harvest/<source>.json rows (title/priority/layer/scope/acceptance/check/ref) for DB import. Session coverage (this file) must capture conversation-only asks that files miss.
Ref: session history 2026-10-06T02:31 assistant ('7-worker harvest wave … itemize everything'); porting/harvest/
- [pending] P1 — Auto-land gate live (server-side, AD-11) — Server-side gate inside POST /land (AD-11): ACT/CONFIRM/ESCALATE from the judge question set; clients render verdicts only; fail closed when the judge is unavailable; off until the injection-testing spike passes and the question set is contract-pinned. Acceptance: a safe proposal lands itself with no client-side decision; check: curl /land with judge unavailable -> fail closed.
- [pending] P1 — Fleet-scale demo — 12–20 real agent runs (staggered tasks) through the platform; acceptance: fleet view at scale, collisions surfaced, page stays responsive
- [pending] P1 — Unlock marquee agents — `claude login` + gemini/opencode auth (John), then route tasks via harness-capability choice (idea 32)
- [pending] P1 — Trust beat: content-based secret detection — semantic secret flagging demoable on a proposal that hides a secret in a non-secret path (idea 11)
- [pending] P1 — Game-industry story page — storage classes + R2 asset tier rendered honestly for the video (SPEC `stack.md`)
- [pending] P1 — Auth seam v1: AUTH_MODE default-deny + authorize() chokepoint + repo allowlist (AD-9) — One authorize(request, env, action, {repo|base}) chokepoint on every route; AUTH_MODE env default deny (demo opts in); repo allowlist (demo, agent-*) while demo; edge rate limits on /land //merge /proposals /judge; CSRF note for the future cookie SSO path; identity carrier = opaque token header (CF Access JWT / Save Point SSO).
- [pending] P1 — Token lifecycle: account-scoped control-plane token + 0600 storage + audit (AD-7) — Replace the wrangler OAuth-file scrape in scripts with an account-scoped API token limited to Artifacts permissions; token values mode 0600 outside repos/transcripts and never in logs/argv; TTL bounds per principal class; mint/use/revoke audit events.
- [pending] P1 — Secret-class widening + free-text scrub (AD-4, contract bump) — Widen the class list (id_rsa, .netrc, .npmrc, .aws/credentials, *.p8/*.jks/*.keystore, *.token, case variants) additively via CONTRACT; scrub KEY=VALUE-shaped values from free-text channels (intent/notes/errors) before bodies; drop intent when the head commit touches a secret-class path.
- [pending] P1 — Event consumer: sole recorder + dedupe + payload validation (AD-6) — Consumer is the sole recorder of Artifacts events; dedupe on (type,repo,ref,after); /land optimistic record through the same helper; validate type/repo/ref/sha charsets; drop envelopes without repo identity; feed is a hint, never authority.
- [pending] P1 — DO lease serializes lands (AD-10; demo component) — Durable Object lease replacing the AD-3 base-moved precondition for landing serialization; surgical, expiring, advisory-first; lands only until lease exists.
- [pending] P1 — R2 asset tier + first-slice manifest/pointer format (AD-10; demo component) — Large files in R2 with manifests/pointers in Artifacts; the FIRST R2 slice owns the pointer format (later slices conform additively); pointer files non-diffable (metadata-only rendering); credential-adjacent pointer values follow AD-4.
- [pending] P1 — Workflows provisioning: token minting moves worker-side (AD-7/AD-10; demo component) — Replace script-side fanout with a Workflow: fork, mint tokens, guarantee discoverability (naming + status ready) before handoff; control-plane role moves intact.
- [pending] P1 — Worktree-as-a-service: platform provisioning API (create/list/push/PR/cleanup) — First-class platform path replacing the dev-only fanout script: create/list/cleanup workspaces, push branches, open proposals. The client architecture explicitly expects worktree-as-a-service.
Ref: platform/scripts/fanout.mjs:4-6; interface-contract.md API needs (worktree-as-a-service); SPEC.md CAP-1
- [pending] P1 — Change-set identity: stable per-proposal identity + fingerprint (demo SHOULD) — Give each change-set a durable identity (repo + ref + fork point + content fingerprint) so cards, notes and landing evidence reference the same set across refreshes and baseline movement.
Ref: demo-scope.md SHOULD map (change-set identity to CAP-2); SPEC.md CAP-2
- [pending] P1 — CPU-budget hardening: large change-sets within the 30s Worker envelope — Benchmark and harden /changes and /proposals for large trees and files: chunked tree walks, bounded diff sizes, explicit degradation for oversized inputs instead of silent omissions.
Ref: SPEC.md CAP-2 success and Constraints (Workers CPU 30s/5min); platform/src/index.ts:26-28
- [pending] P1 — Proposal card signal set: risk + provenance fields on every card — CAP-4 cards should carry intent, diff, risk, conflict map and provenance; built cards show intent, files/diffs, secret schema and landing state. Add risk scoring and provenance (author, trace, receipts).
Ref: SPEC.md CAP-4 success; SPEC.md Open Questions (card signals undecided); platform/ui/app.js:404-541
- [pending] P1 — Judge-agent set comparison + recommendation (demo story step 5) — Enable an agent (and/or the human reviewer) to compare the whole proposal set and recommend or land one with rationale on the same canvas; the demo story allows reviewer and/or judge agent.
Ref: demo-scope.md story step 5; SPEC.md Success signal
- [pending] P1 — Surgical authoring leases: scoped, expiring, advisory-first (demo SHOULD; law 6) — Declare-before-touch leases at file/entity scope with TTL and advisory semantics; never fleet-wide serialization. This is the demo-scope authoring lease and the enforcement of engineering law 6.
Ref: engineering-laws.md law 6; demo-scope.md SHOULD map (authoring lease); SPEC.md CAP-5
- [pending] P1 — Server-push channel to browsers (SSE/WebSocket) replacing the poll loop — The pipeline is push up to KV but the browser still polls /events on a timer. Add a real server-push channel so no-polling is true end to end.
Ref: SPEC.md CAP-6 (no polling); platform/ui/app.js:941-953
- [pending] P1 — Speculative validation of the fold result before landing (demo SHOULD) — Run the validation suite against the folded merge result pre-land so the decision carries evidence; demo-scope maps speculative validation to CAP-7.
Ref: demo-scope.md SHOULD map (speculative validation to CAP-7); SPEC.md CAP-7
- [pending] P1 — Landing evidence receipt: tested SHA equals merged SHA, recorded — CAP-7 success requires evidence recorded on the landing; /land currently returns only commit/files/at. Persist a receipt linking the tested revision to the merged revision (Tier 3 provenance).
Ref: SPEC.md CAP-7 success (merged SHA equals tested SHA); platform/src/index.ts:/land response
- [pending] P1 — Per-worker traces + git-notes records (H4 provenance gap) — Record per-worker traces (what the agent did, session trail) plus git-notes records; the interface contract names this as the provenance gap the platform must fill.
Ref: interface-contract.md What Agent Office lacks (H4)
- [pending] P1 — Law 2: two-tier intelligence - System-1 sees every file first — Fast/cheap models classify, type, tag and lint every file before expensive reasoning reads only what needs judgment; build the System-1 pass and the routing gate.
Ref: engineering-laws.md law 2
- [pending] P1 — Law 3: self-describing platform - tool manifest + structure map in workspaces — Ship a machine-readable tool manifest plus structure map into every agent workspace so no context-blind agents exist; the communication contract standardizes the interface, not the intelligence.
Ref: engineering-laws.md law 3; engineering-laws.md Communication contract
- [pending] P1 — Swarm R3: declare before touch, receipt when finished — Collision avoidance with zero global knowledge: declare before touching, emit a receipt when finished; no sandbox-escape attempts.
Ref: engineering-laws.md swarm R3
- [pending] P1 — Tier 1: per-file semantic index (classification/type/security/tags) — Semantic/index tier holding per-file classification, type, security level and tags; System-1 models classify every file cheaply and the index feeds agents and review.
Ref: stack.md Storage classes tier 1; engineering-laws.md law 2
- [pending] P1 — Tier 2: durable, expiring work/state store — Work/state tier holding workspaces, task queue, presence, authoring leases, secret-typed files and stashes: durable, expiring, frequently written, with surgical locking.
Ref: stack.md Storage classes tier 2
- [pending] P1 — Tier 3: provenance/artifact store (notes, traces, receipts, previews) — Provenance/artifact tier holding git-notes, per-worker traces, receipts, previews, screenshots/videos and push provenance so the repo answers for itself with no clone.
Ref: stack.md Storage classes tier 3; SPEC.md CAP-7
- [pending] P1 — Entity API: Pull / Proposal client entity (state, draft, checks, closes) — Full client-facing proposal entity: number, title, state, draft, reviewDecision, headRef, baseRef, checks, additions/deletions, closes[]. /proposals currently serves a change-set view only.
Ref: interface-contract.md Entities (Pull / Proposal); platform/src/index.ts:/proposals (partial)
- [pending] P1 — Entity API: Proposal detail (mergeable, commits, comments, reviews, checks) — Proposal detail surface: body, mergeable, mergeStateStatus, commits, comments, reviews and checks. /merge previews mergeability today; the rest is absent.
Ref: interface-contract.md Entities (PR / Proposal detail); platform/src/index.ts:/merge (partial)
- [pending] P1 — Events: normalized platform event bus across all families — One normalized push bus for worker, floor, issue/pull, queue, peer, chat and platform events, replacing polling as the client integration contract.
Ref: interface-contract.md Events; platform/src/index.ts:647-676 (repo events only today)
- [pending] P1 — Watch Artifacts 64 MiB push cap + v1 protocol before Oct 14 — Push cap is ~64 MiB push-side and the wire protocol is v1-only; monitor for changes and keep incremental pushes small before submission.
Ref: SPEC.md Open Questions (64 MiB fix ETA); stack.md Verified facts; platform/package.json (isomorphic-git)
- [pending] P1 — Pre-fill conflict resolution strategy per conflicted pair — Per conflicted pair, a choice among take-A / take-B / combine / needs-human. Pre-fills the resolution UI so reviewers start from a judgment instead of a blank merge.
Ref: docs/judge-layer-ideas.md:46 (#6)
- [pending] P1 — Classify every file by language, role, and sensitivity — A cheap classify-every-file pass: language/role choice plus public/internal/secret sensitivity choice per file. Feeds masking, policy, and the index without new infrastructure.
Ref: docs/judge-layer-ideas.md:55 (#12)
- [pending] P1 — Automate competition pre-submission eligibility checks — Nouls per competition requirement (license file, README, run instructions, Workers+Artifacts usage) to automate pre-submission checks ahead of the Oct 14 entry.
Ref: docs/judge-layer-ideas.md:78 (#29)
- [pending] P1 — Route work to the best-fit harness per task — Choice over harness capabilities plus a complexity score to route work to codex / omp / claude. Pairs with the marquee-agent unlock.
Ref: docs/judge-layer-ideas.md:84 (#32)
- [pending] P1 — QA demo-video frames for readability and key moments — Sample frames from the submission recording; nouls for UI readable at 1080p and the collision moment visible. Protects the P0 video deliverable.
Ref: docs/judge-layer-ideas.md:90 (#35)
- [pending] P1 — Version judge question sets in code with the platform — Question sets live in code, versioned with the platform, referenced by setId in every /judge call; responses carry the setId they answered. Prevents per-feature prompt policy drift.
Ref: docs/judge-layer-ideas.md:98 (wiring step 4)
- [pending] P1 — Tune judge thresholds on our own labeled proposals — Thresholds and weights live in code and are tuned on our own labeled proposals, never copied from a cookbook; typed output guarantees the interface, not truth. Required before any gate fires on real landings.
Ref: docs/judge-layer-ideas.md:98 (wiring step 4) + :102-103
- [pending] P1 — Store arbitration decision record as git notes on landed change — (demo SHOULD) Persist why the winning proposal was chosen, permanently linked to the merge commit via git-notes, so the decision travels with the change.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (SHOULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What we built for the demo' step 6
- [pending] P1 — Introduce first-class change-set identity — (demo SHOULD) Give a proposal a stable identity that survives re-pushes so cards, links, and provenance can reference it beyond a repo+ref pairing.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (SHOULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4
- [pending] P1 — Implement authoring lease per change-set — (demo SHOULD) Track who holds a change-set or entity so agents declare-before-touch under expiring, advisory-first leases; never fleet-wide serialization.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (SHOULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:36; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4
- [pending] P1 — Run speculative validation on proposals — (demo SHOULD) Show whether a proposal actually works (tests/checks), not just whether it merges; the current landing verdict proves mergeability only, not correctness.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (SHOULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What it does'
- [pending] P1 — Issue receipts when agents complete work — Every completed unit of work emits a receipt onto the shared artifact (swarm R3); receipts are evidence for the trust bundle and fork-card proof cluster.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:44-46; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4
- [pending] P1 — Classify every file with System-1 models at ingest — Engineering law 2: fast/cheap models classify every file and directory (type, security level, tags) near-instantly so per-file security levels do not require an expensive LLM read.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:14,30; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 3,8
- [pending] P1 — Route expensive reasoning only to files needing judgment — Two-tier intelligence routing: cheap classifiers cover every file while expensive reasoning reads only what needs judgment, feeding review, issue triage, and risk fields.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:30,37; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8 (law 2)
- [pending] P1 — Build semantic index and context maps for repos — Vector/semantic index of the codebase plus context maps so agents and the UI traverse by meaning and see architecture - grep alone is a fail; agents inspect just enough, never total reads.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:15,31,37; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 8.4-8.5
- [pending] P1 — Keep durable work/state tier (queue, presence, leases) — Storage class 2: durable, expiring, frequently-written state - task queue, presence, authoring leases, secret-typed flags, stashes - as the platform's coordination layer.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 3 (class 2); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:44-46
- [pending] P1 — Implement surgical expiring advisory locks — Locks are scope/entity-level, expiring, and advisory-first; never fleet-wide serialization. This backs declare-before-touch and lease semantics without blocking agent fleets.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:36; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 3,8.6
- [pending] P1 — Ship tool manifest and structure map into workspaces — Engineering law 3 (self-describing platform): deliver a machine-readable tool manifest plus structure map into every agent workspace so no agent is context-blind about available tools or platform structure.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:13,29; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.3
- [pending] P1 — Enforce denied paths: deny, close, redirect, escalate — Swarm R2 sharpened: a denial is a wall, not an obstacle - count retries on forbidden paths (e.g. bash-grep retried after 'use the grep tool'), close the path, force the sanctioned alternative, and escalate on repeat.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:43,45; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 6 (R2)
- [pending] P1 — Write claims, status, receipts onto the shared artifact — Swarm R1 sharpened: communicate through the work - claims, status, and receipts live on the shared artifact; any agent orients locally with no hub and no global truth.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:44; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 6 (R1)
- [pending] P1 — Require declare-before-touch and completion receipts — Swarm R3: collision avoidance with zero global knowledge - declare intent on the artifact before touching the work, write a receipt when finished.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:46; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 6 (R3)
- [pending] P1 — Standardize agent output: summary, detail, affordances — Communication contract: every agent output is summary + structured detail + affordances (clickable next actions that feed back as signals); standardize the interface, not the intelligence (BYO model/harness).
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:40,47; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 6
- [pending] P1 — Implement join-don't-restart with merge/refactor — Swarm R4: if someone already claimed or started the work, join instead of restarting; prefer LLM merge/refactor of theirs+ours over regenerating equivalent code, economically and socially.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:49; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 6 (R4)
- [pending] P1 — Declare intent: router pings before work starts — Intent router: declare what you are about to build and the platform matches it against the fork ecosystem, replying '80% done by fork X' before work begins - automating join-don't-restart as a platform reflex.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:58,74; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 5
- [pending] P1 — Return matcher verdicts: merge, context, or ignore — Three-state verdict for fork comparison: merge it (their work does the job), use as context (partial fit; build with their implementation in hand), or ignore (different goal).
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:64; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 5
- [pending] P1 — Run background matcher against the fork ecosystem — A background sub-agent continuously diffs other forks' work against our PRD/prompt/implementation/goal; when their work fulfills the goal it recommends direct merge or use-as-context, otherwise adapt.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:62; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 5
- [pending] P1 — Render fork cards with six signal clusters — Fork cards carry six signal clusters - fit/overlap, people/trust, liveness, proof, distance, cost-to-adopt - and signals trigger investigation, never auto-decision ('then we investigate'). Concrete card design remains open.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:52-57; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 4,5,10.3
- [pending] P1 — Surface active-fork radar in context — Critical social layer: surface active and relevant forks where the user is working so siloed duplicate work becomes visible; agents can discover other forks' agents.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:23,32; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 5
- [pending] P1 — Weave workspaces through the whole experience — Engineering law 12: workspaces are woven through the entire platform experience and merging feels transparent, seamless, and understandable - not a bolt-on.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:11; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.12
- [pending] P1 — Apply per-path storage policies (compressed/delta/head-only/keep-n) — Configurable revision storage per asset class: full-compressed (+C), RCS delta (+D), head-only (+S), keep-last-n (+Sn), uncompressed (+F), changeable thereafter. Studios tune this per asset class to trade size vs retrieval cost.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 file types (L26-45) + §5 req#3 (L176)
- [pending] P1 — Auto-classify files by extension with locked-binary defaults — Extension rules auto-assign storage/merge classes and default binary+l for art/level types (.uasset, .umap, .png, .fbx, ...), with type-change operations supported. Mirrors Perforce file-type defaults so artists need no per-file decisions.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 file types (L26-45) + §3 UE integration (L104-107)
- [pending] P1 — Provide partial sync via workspace views and sparse streams — Per-user workspace maps only the needed repo subtree; sparse/virtual streams give a read-only parent plus writable subset; per-file selective download so a 500 GB repo never needs 500 GB local. Maps to client-spec/stream and Gluon selective-sync prior art.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §5 req#4 (L177) + §1 workspaces (L16-20) + §4 partial sync (L154-159)
- [pending] P1 — Support atomic changelist commits and server-side shelves — Multi-file commits succeed or fail as a unit with numeric IDs, and unsubmitted changelists can be shelved server-side for review/test/resume. Shelving is the Perforce primitive feeding pre-commit review.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 changelists (L22-24) + §5 req#5 (L178)
- [pending] P1 — Review art assets visually: preview, annotate, approve/reject — Thumbnails/previews for 2D/3D/video/audio with annotation and approve/reject workflows; art assets reviewed separately from code but versioned in the same repo (Swarm + DAM model).
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §5 req#7 (L180) + §3 DAM (L96-98)
- [pending] P1 — Enforce per-file ACLs by path, user, group and IP — Protections down to file/depot-subtree granularity, per user/group/host (IP), with access levels (list/read/open/write/review/admin) and LDAP/SAML/OIDC identity. Contractors can be IP-restricted.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 protections (L55-57) + §5 req#8 (L181)
- [pending] P1 — Build transaction hooks for policy gating and notifications — Server-side hooks at submit/commit/push transaction points for policy enforcement, CI gating, and notifications, extensible by script or API. Same role as Perforce triggers in front of submissions.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 triggers (L51-53) + §5 req#11 (L184)
- [pending] P1 — Treat binaries as never-merge; keep 3-way text merge — Binary types are flagged to never merge (lock instead) while text gets 3-way merge; the platform detects and prevents binary merge attempts rather than silently last-push-wins. Complements the lock service.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §5 req#12 (L185) + §1 no-merge rationale (L47-49)
- [pending] P1 — Offer artist mode: download, lock, edit, check-in — Gluon-style simplified surface for artists - selective download, lock, edit, check-in - that hides branching and merge concepts entirely. Lowers the barrier for art teams who should never need to understand streams.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 UVCS/Gluon (L109-114) + §4 (L154-159)
- [pending] P1 — Deduplicate chunks across files and versions — Chunk reuse across assets and versions with a dedup-check API so clients skip uploading known chunks; three-tier dedup (session, local cache, global). Kills the LFS cost pathology where each push stores a full new copy.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §2.1 Xet (L52-58) + §6 Pattern A (L175-177)
- [pending] P1 — Support film-scale blobs via R2 multipart storage — Single assets of 2-8 GB and VFX plate stacks beyond 5 GB, using R2 multipart (4.995 TiB max) and single-part (5 GiB) mechanics so no plan cap blocks real production content.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §1.2-1.3 (L13-31) + §4.1 (L132-135)
- [pending] P1 — Harden transfers: resumable uploads, 413/429 backoff — Batch-style transfer client with resumable multipart uploads, rate-limit backoff (413 too-large, 429), retries and idempotency for interrupted transfers. Needed to move multi-GB assets over real networks.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §1.5 (L37-39) + §4.4 (L149-152)
- [pending] P1 — Federate Windows/GPU/macOS runners via queue bridge — Cloudflare cannot run Windows/GPU/macOS, so external runners register and receive jobs via Queues/webhooks while a Workflow waits for completion (waitForEvent). Requires idempotent dispatch, at-least-once delivery, runner health checks, and cancellation propagation.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §4 cannot-run table (L159-164) + §5 req row 8 (L180) + §6 federation risk (L210-213)
- [pending] P1 — Define pipelines as code: triggers, matrices, reuse — Declarative pipeline spec with push/PR/schedule/dispatch triggers, event chaining, matrix fan-out, concurrency groups, caching, artifact handling, and nested reusable workflows. Parity baseline is GitHub Actions' 30+ events and 256-cell matrices.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §1 triggers/matrix (L9-32) + §3 Dagger (L94-95)
- [pending] P1 — Run batch merge queues on speculative groups — Batch interdependent proposals against trunk speculatively, validating the combination before any merge, so main never breaks from a set-level interaction. No native merge queue exists; implement batch validation in a Workflow.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §3 merge queues (L118-125) + §5 req row 7 (L179)
- [pending] P1 — Inject secrets via OIDC with short-lived credentials — Repo/org/environment-scoped secrets plus auto-provisioned scoped automation tokens, with OIDC federation to cloud providers so no long-lived credentials persist; secrets inject into sandbox envs. No native OIDC-to-self-hosted-runner bridge exists - build one.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §1 secrets/OIDC (L24-25) + §6 secrets model (L197-200)
- [pending] P1 — Publish preview deployments per proposal branch — Branch push deploys a live preview URL while the production branch deploys to prod, via Workers Builds and Artifacts integration (deploy hooks, 20-min build timeout, 10 GB/project cache, 7-day LRU). Preview environments are the standard review surface.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §2 Workers Builds (L38-52) + §3 preview envs (L127-132)
- [pending] P1 — Add branch protection and defined concurrent-push semantics — Artifacts documents no branch protection and leaves concurrent-push semantics undefined; define and enforce protected refs and deterministic concurrent-push handling so races cannot corrupt base refs. Extends the shipped merge/conflict layer.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Critical gaps (L27-32)
- [pending] P1 — Fan out event subscriptions to CI and agents (deduped) — Extend the event feed into an at-least-once subscription bus for CI triggers and agent wakeups, with dedupe on (type,repo,ref,after), payload validation, and sole-recorder discipline. The feed is a hint, never authority.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Events (L16); research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §2 Queues (L83-85); pending hardening: docs/NEXT-ACTIONS.md AD-6
- [pending] P1 — Implement repo lifecycle over binding, REST and Git — Create/get/list/import/delete/fork a repo through three co-equal interfaces (Workers binding, REST, git-over-HTTPS), with fork-from-baseline for agent session branching and namespaces for isolation. Platform wiring is partial: scripts fork and seed (fanout.mjs, seed.mjs) but import/delete/namespace ops are not yet API surfaces.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Capabilities repo ops (L13); partial: platform/scripts/fanout.mjs:1-14, platform/scripts/seed.mjs:1-9
- [pending] P1 — Expose content read APIs (log/commit/tree/blob/file/raw) — Public read surface for history and blobs (log, commit, tree, blob, file, raw) so the UI and agents read without cloning. Artifacts provides the primitives; the platform must expose stable routes.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Capabilities content (L14)
- [pending] P1 — Issue least-privilege repo-scoped git and API tokens — Repo-scoped read/write git tokens plus control-plane API tokens (Artifacts Read/Edit), with token.created/revoked events and unique per-agent credentials. fanout.mjs mints scoped write tokens with TTL as a dev step; lifecycle hardening (account-scoped, audited, 0600) remains.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Tokens (L15) + best practices least-privilege (L20); partial: platform/scripts/fanout.mjs:2-6, docs/NEXT-ACTIONS.md AD-7
- [pending] P1 — Stream sandbox terminal output to the web UI — Live PTY/stdout/stderr streaming over a Worker proxy, reachable exposed ports, and RPC transport for high-frequency operations (bypassing the 1000-subrequest limit). Interactive attach complements dispatch-and-wait agent runs.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 Sandbox SDK row (L114) + §5 editor attach (L212-217)
- [pending] P1 — Enforce sandbox isolation tiers by trust level — Choose among containers (shared kernel), gVisor, and Firecracker microVMs (~125 ms boot, snapshot <200 ms, no GPU) based on workload trust, with documented trade-offs (container escape CVE-2025-23266 CVSS 9.0).
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 isolation tiers (L57-62)
- [pending] P1 — Federate GPU/Windows/macOS workspaces to providers — Single launch API that targets Cloudflare containers or external GPU clouds, MacStadium/EC2 Mac, and on-prem rigs over Tailscale, because CF has no GPU/Windows/macOS and devkits are on-prem. Also covers >12 GiB memory, >20 GiB disk, and peripherals.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 must-federate (L132-138)
- [pending] P1 — Enable human-agent co-presence and takeover — Human joins the same workspace/PR: remote-desktop-style takeover or async branch model, transcript review, and a task board of agent progress. Prefer the simpler async branch-based reconciliation for safety.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 pattern 8 (L55) + §6 co-presence (L204-210)
- [pending] P1 — Sync local and platform sides over standard git — Bidirectional sync where the platform mounts locally (ArtifactFS FUSE over Artifacts or any git remote) and local pushes go through standard git protocol; conflicts resolve with git merge plus locks for binaries. CRDT co-editing is explicitly deferred.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §6 bidirectional sync (L176-181)
- [pending] P1 — Bind identity, secrets and hierarchy per workspace — DO identity doubles as workspace identity; per-workspace secrets stay isolated; CF Access/WAF enforces per-route auth; multi-tenant one DO per user/session/task; org/workspace hierarchy and SSO federate to CF Access.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §6 identity/permissions (L189-194)
- [pending] P1 — Attribute costs per tenant, task and resource — Meter container compute (GiB-sec/vCPU-sec/GB-sec), Artifacts ops/storage ($0.15/1k ops; $0.50/GB-mo from Oct 14 2026), build minutes, and R2 usage per tenant/task; expose budgets/caps and reclaim idle workspaces (snapshot TTL 30 days) as the cost accumulator.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §6 cost model (L196-202) + research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §5 req row 8 cost (L178) + _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Pricing (L34-36)
- [pending] P1 — Unify code and art review in one surface — One review shows code diffs and binary art assets side by side with previews, plus conflict-prevention alerts before submission (Diversion-style unified reviews).
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 Diversion (L116-121) + §3 DAM (L96-98)
- [pending] P1 — Claim set-level spatial/AST review whitespace — No deployed product surfaces N competing code change-sets side-by-side for triage: claim set-level spatial/semantic review with cross-change overlap/conflict semantics.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:116,139; agentic-git-platform-ecosystem-feature-matrix/report.md:382
- [pending] P1 — Detect logical conflicts: clean merges that still break main — Match/beat Trunk's 'logical conflicts' claim: two proposals that textually merge cleanly but break main together must be caught by set-level evaluation, not only textual merge.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:80; agentic-git-platform-ecosystem-feature-matrix/report.md:162
- [pending] P1 — Support race-agents-on-one-task comparison — Superset precedent ('Race Agents on One Task'): run the same task through multiple agents and compare results as a set, the purest demo of comparative triage.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:88; agentic-git-platform-ecosystem-feature-matrix/report.md:164
- [pending] P1 — Provide coordination signals: change maps + task records — Make agents non-blind: leases, change maps, and AGENTS.md-compatible task records so each concurrent agent can see what others are doing before it writes.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:383; competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:82
- [pending] P1 — Match/beat incumbent conflict resolution at set level — GitLab ships autonomous merge-conflict resolution (edits files, pushes a resolution commit) and GitHub ships one-click resolution; resolve conflicts with set-level awareness of which proposals compete, not per-PR.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:66; agentic-git-platform-ecosystem-feature-matrix/report.md:166
- [pending] P1 — Build fail-closed deterministic gates — Rarest, most valuable capability in the review market: rule/threshold checks that reliably block a bad merge, where LLM reviewers by default only advise or silently pass on error.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:43,161
- [pending] P1 — Add team-configurable risk-score gating and auto-approve — The exact practitioner-requested capability GitHub lacks: agents output a risk score; teams configure thresholds so low-risk changes auto-approve and riskier ones require human sign-off.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:149,384
- [pending] P1 — Keep merge batches shallow (flake amplification law) — At 3% flake, 8-deep batches disrupt 21.6% of merges (P = 1-(1-f)^k): cap batch depth and prefer small speculative batches, tracking effective flake rate.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:50,83
- [pending] P1 — Enforce landed commit equals the human-mergeable state — Landing discipline: the landed commit must equal what a human would merge; GitHub's queue once silently deleted reviewed code across 2,092 PRs while undetected for 3h33m.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:51,83
- [pending] P1 — Never equate passed CI with safe-to-merge — Engineering law from the agent-platform survey: treat self-reported CI success as insufficient evidence; set-level verification (behavioral, deterministic gates) must independently clear a change.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:75
- [pending] P1 — Use Agents SDK fibers for session recovery — Model agent sessions as DO + SQLite + recoverable fibers: identity, sessions, WebSockets, scheduling, and crash recovery in one class.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:117,386
- [pending] P1 — Preserve full agent session as a first-class artifact — Sculptor-style: save every agent session with plans, chats, tool calls, and code changes intact and attached to the change; fleet semantics need session records (plan -> diffs -> checks -> decisions).
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:88; agentic-git-platform-ecosystem-feature-matrix/report.md:75
- [pending] P1 — Make Workflows steps idempotent; design ordering explicitly — Workflows requires idempotent steps, and ordering across DO/Queues must be designed rather than assumed; spike whether DO+Workflows ordering guarantees suffice for the merge protocol.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:59,108
- [pending] P1 — DO-room per review: throttled presence, snapshot sync, soft locks — PartyKit-on-Cloudflare path: a DO room per review with throttled presence, snapshot-from-R2 initial sync, and soft locks so sync stays viable at fleet scale.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:111,170
- [pending] P1 — Use CRDTs for review state only, never code text — Converge structure + annotations, not raw code: CodeCRDT shows convergence but 5-10% residual semantic conflicts, and Weave deliberately decouples merge from CRDT; use Yjs/Automerge/Loro for annotations/coordination only.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:111,170; technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:58
- [pending] P1 — Route models and cache through AI Gateway — AI Gateway provides caching, rate limiting, BYOK, and ZDR; use it for reviewer/fleet model cost control and the 85.7%-cache archetype.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:121,386
- [pending] P1 — Limit Sandboxes to Linux-necessary work under account ceiling — Sandboxes are real per-agent microVMs (own kernel/network) but cold-start 1-3s and the account ceiling is 1,500 concurrent vCPU / 6 TiB / 30 TB: use warm pools and only where a full Linux environment is needed; plan the demo below the ceiling.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:117,129,386
- [pending] P1 — Read/write AGENTS.md as cross-vendor task records — AGENTS.md is the de facto cross-vendor instruction format with 'closest file wins' nesting; platform task records must round-trip through it so agents arrive non-blind.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:89,133,383
- [pending] P1 — Enforce typed secret files: ciphertext + policy + schema-only view — Secret-typed file primitive (mechanism proven by git-crypt/SOPS/Gerrit; the agent-aware policy layer is unclaimed): files stay ciphertext, carry a policy record, render schema-only, and reveal only on elevation.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:98; agentic-git-platform-ecosystem-feature-matrix/report.md:139,172,385
- [pending] P1 — Add file-level read blocking and per-path grants for secrets — Gerrit-style per-path grants and ref-level ACLs: block reads of classified files from agents/humans without the grant instead of relying only on post-hoc scanning.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:98; agentic-git-platform-ecosystem-feature-matrix/report.md:139,172
- [pending] P1 — Mint signed agent identity per instance — No product binds commits to a verified agent identity: mint per-instance identity (SPIFFE/WIMSE-aligned, matching the active IETF agent-instance draft) and bind it to the agent's Durable Object.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:102; agentic-git-platform-ecosystem-feature-matrix/report.md:135,141,385
- [pending] P1 — Attach mandatory per-write provenance via Git Notes — Git-Notes attribution keyed to agent_session_id (Git AI precedent; rebase-safe), applied per write rather than post-commit: tool, model, session, line ranges.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:100; agentic-git-platform-ecosystem-feature-matrix/report.md:95,168,385
- [pending] P1 — Scrub secret leaks at commit time (prevention beat) — Ship the visible trust beat: a leak attempt is caught and scrubbed before it lands; leak scrubbing is the secondary wow after the typed-file reveal.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:101; competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:140; agentic-git-platform-ecosystem-feature-matrix/report.md:141,387
- [pending] P1 — Harden the MCP surface per spec — MCP OAuth 2.1 resource-server model: accept only tokens explicitly issued for this server and resist confused-deputy and tool-poisoning risks; apply the published checklist verbatim.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:141,385
- [pending] P1 — Choose canvas tech without license traps — React Flow is MIT with a separate Pro license; Excalidraw and PixiJS are MIT (PixiJS fastest 2D); tldraw's SDK is non-OSI (watermark unless paid): select an MIT-path renderer deliberately.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:105,398
- [pending] P1 — Attach a team-readable evidence trail per change — GitGhost's strongest overlap: sessions, transcripts, checkpoints, approvals, and security/pipeline evidence attached to each change, so every agent change gets a team-readable trail.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:92; agentic-git-platform-ecosystem-feature-matrix/verify-round-1-trajectory.md:53
- [pending] P1 — Keep pushes on the v1 protocol for Artifacts interop — Artifacts smart-HTTP is push v1-only (v2 receive-pack explicitly unsupported) while clone/fetch support v1+v2; keep client pushes on v1 via isomorphic-git's default so there is no protocol friction.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:66,26
- [pending] P1 — Respect Artifacts limits in design — 1 GB/repo, 32 MB/file, 2k git req/10s/repo, 2k control-plane req/10s/namespace, 1 TB/account, US/EU jurisdictions: design demo and prefetch behavior inside these.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:119; technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:60
- [pending] P1 — Maintain a pre-submission watch list — Re-check before submission: GitGhost beta semantics, Entire GA timing, GitHub Universe (Oct 28-29, post-submission), Artifacts cap-issue progress (no update since 2026-08-17), Macroscope Murmur, Whiteboard hosted tier, sigbound and Cursor Origin.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:103; competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:142
- [pending] P1 — Finals readiness: Oct 21 live 10-min stage presentation — If selected as a finalist, present live at Cloudflare Connect (Moscone West SF): 10 minutes, up to 2 people flown out, winner must be present. Prepare the stage version of the demo/pitch after the video lands.
Ref: session history 2026-10-05 competition-terms read (finals Oct 21, Moscone West, 10-min presentation, winner present)
- [pending] P1 — Human-facing architecture walkthrough (spine run deliverable) — John chose fast mode with deliverables = build substrate + human-facing walkthrough for the architecture run. The spine landed (23.8 KB, 4-lens gate, commits 857d0ce/d0d8b17) and a walkthrough build was dispatched 2026-10-06T02:25:49Z; no walkthrough artifact is on disk yet — land it next to the spine or into docs/ so the architecture is readable by humans, not just agents.
Ref: session history 2026-10-06T01:55 user msg (option choices: fast mode; spine + human-facing walkthrough); session history 2026-10-06T02:25:49Z task dispatch 'Dispatching architecture walkthrough build'; _bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/.memlog.md:10
- [pending] P1 — Unauthenticated demo, auth-ready seams; Save Point SSO future — Principal decision: the competition demo is documented-open (unauthenticated) for now, but everything must be built to support authenticated access + viewership later; Save Point SSO (internal, not complete) is the intended future identity layer, so the auth seam and authorize() chokepoint must land without being wired in the demo.
Ref: session history 2026-10-06T01:55 user msg; arch memlog 2026-10-06 ('documented-open demo; must support authenticated access + viewership; Save Point SSO intended future identity layer'); docs/NEXT-ACTIONS.md [pending] P1 — Auth seam v1
- [pending] P1 — DO / Workflows / R2 are in-scope for the demo (not post-demo) — Principal directive: Durable Objects, Workflows and R2 are production-ready components and must actually appear in the demo build — production-level posture, not an MVP. Queue rows: DO lease serializing lands; R2 asset tier + pointer format; Workflows provisioning moving token minting worker-side.
Ref: session history 2026-10-06T01:55 user msg; docs/NEXT-ACTIONS.md [pending] P1 — DO lease / R2 asset tier / Workflows provisioning
- [pending] P1 — Auto-merge commits that pass all parallel validation gates — A commit that clears cryptographic, performance and regression checks in the parallel pipeline merges to mainline automatically; humans review architectural intent only.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L52 (§3 Automated Mainline Triage); docs/STATE.md queue auto-land-gate-live
- [pending] P1 — Speculative validation on predicted edits (demo SHOULD) — The moment a branch or workspace appears, background Workers begin compiling and testing predicted edits so validation is complete by the time the commit lands.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L381 (§2 Speculative CI/CD Testing); L479; demo-scope.md SHOULD map (speculative validation)
- [pending] P1 — Secret-typed file primitives (cryptographic boundary nodes) — Add polymorphic file primitives to the Git object model: .env, credentials.json and certificates are typed secret objects with file-level access control, not uniform text blobs.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L536-538 (§1 Secret-Typed Object Primitives); L520 (user: per-file auth level); SPEC.md CAP-8
- [pending] P1 — Schema-only decoupled views for secret files (demo beat) — Clones and openness show only the schema definition of a secret file (for example DATABASE_URL: String); values are decoupled, encrypted with hardware-bound keys and stored in isolated KV.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L539 (§1 The Decoupled View: Zero-Trust Metadata); SPEC.md CAP-8; demo-scope.md story step 6
- [pending] P1 — Commit-time Wasm secret scrub with security isolation branch — A native WebAssembly scanner runs on incoming pushes; raw secrets committed into markdown or documentation are isolated at the edge, scrubbed, and routed to a security isolation branch.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L541 (§1 Automated Leak Scrapers); L589 (Edge-Scrubbing Wasm Hooks); L520 (user: scrape context docs); demo-scope.md story step 6
- [pending] P1 — Decision log appended to commit metadata — Every agentic modification appends an immutable decision log (autonomous choices that never reach commit messages) directly into commit metadata.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L551 (§2 Decision Logs & Trace Archaeology); L601 (Trace Archaeology Ledger); L520 (Whiteboard summary)
- [pending] P1 — Approvability score and check-run auto-approval of low-risk PRs — Codebase-aware review computes a plain-English Approvability score and auto-approves low-risk pull requests through check-run agents.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L50 (Macroscope)
- [pending] P1 — Per-line AI attribution surviving rebase, squash and cherry-pick — Link individual lines to the exact AI agent session, model and prompt that generated them, and keep that attribution metadata intact through rebases, squashes, merges and cherry-picks.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L58 (Git AI)
- [pending] P2 — Tour v2 — fold judge chips + auto-land language into `/tour.html` after the judge wave; acceptance: tour matches the live page
- [pending] P2 — Performance: cache `/proposals` — avoid full recompute on every poll; acceptance: <1 s responses at 20 proposals
- [pending] P2 — Corpus copies — fetch competition terms + launch blog into `docs/corpus/` for the submission audit
- [pending] P2 — tsc hygiene — install TypeScript in `platform/`, fix the 4 pre-existing errors; acceptance: `npx tsc --noEmit` clean
- [pending] P2 — Contract smoke in platform verify gates (AD-12) — Every platform work order's VERIFY gate curls all six routes asserting shapes/enums/status codes (ratify the bootstrap C2/C3 pattern); tsc joins when the hygiene item lands.
- [pending] P2 — Structural conflict detection: entity/AST-level, not just textual — CAP-3 calls for structural as well as textual conflict classification; current kinds are textual. Add entity/symbol-level overlap detection (same function/class touched by two proposals).
Ref: SPEC.md CAP-3 success (structural vs textual); platform/src/index.ts conflict kinds
- [pending] P2 — Elevated reveal for authorized viewers (demo beat) — The CAP-8 demo beat includes an elevated reveal; today values can never be revealed. Design an authorized, auditable reveal path (role or token plus audit trail) without weakening default masking.
Ref: SPEC.md CAP-8 success; platform/CONTRACT.md masking law
- [pending] P2 — Commit-time scrub of secrets leaked into non-secret paths — Masking is path-driven by design, so a secret committed into a normal file passes through. Add commit-time leak detection/scrub (pattern/entropy scan) and show the scrub in the demo beat.
Ref: SPEC.md CAP-8 success (commit-time scrub); platform/CONTRACT.md Secret classes note
- [pending] P2 — Per-worker secret API (H5) — Interface contract H5: a per-worker secrets API so agents get scoped secret access through the platform rather than the filesystem surface.
Ref: interface-contract.md What Agent Office lacks (H5)
- [pending] P2 — Client adapter parity: platform API replaces GitHub as the client store — CAP-9: an external client renders workspace/proposal state from the API alone; the office 11-entity protocol maps onto platform entities so a client adapter can drop-in replace GitHub as the backing store.
Ref: SPEC.md CAP-9; interface-contract.md Feasibility
- [pending] P2 — GitHub-semantics synthesis: reviewDecision / mergeStateStatus / mergeable — The client protocol needs GitHub-specific semantics synthesized from platform state so the adapter needs no GitHub; define derived values for the three fields.
Ref: interface-contract.md Feasibility (semantics to synthesize)
- [pending] P2 — Law 4: repo answers for itself - index, preview, demos, provenance — Semantic index + live preview + native demos + push provenance so comprehension needs no clone; push provenance is partially covered by the event feed.
Ref: engineering-laws.md law 4; SPEC.md Constraints (review path never clones)
- [pending] P2 — Law 5: agents inspect just enough - context maps over total reads — Context maps plus semantic index orient an agent without total reads; expose the orientation surface to agent harnesses.
Ref: engineering-laws.md law 5
- [pending] P2 — Law 7: contribution standard as a service (platform-side lint/conventions) — Platform-level contribution standards (lint, conventions, changelogs, commit rules) enforced platform-side with no per-repo scaffolding.
Ref: engineering-laws.md law 7
- [pending] P2 — Law 9: work-item to change-set linkage on one review surface — Work items and change-sets reference each other so review stays on one surface; ties into Task/Issue entities and proposal cards.
Ref: engineering-laws.md law 9
- [pending] P2 — Law 12: merge/workspace transparency woven through the experience — Merging feels transparent, seamless and understandable rather than a bolt-on; preview-merge and one-click land are early pieces, workspace lifecycle weaving is not yet built.
Ref: engineering-laws.md law 12; platform/ui/app.js:664-775
- [pending] P2 — Swarm R1: communicate through the work (claims/receipts on the artifact) — Simple standardized communication: claims, status and receipts are written onto the shared artifact so any agent orients locally with no hub and no global truth.
Ref: engineering-laws.md swarm R1
- [pending] P2 — Swarm R4: join-don't-restart as a platform reflex — Prefer reusing existing work (LLM merge/refactor) over regenerating equivalent code - socially and economically; the intent router is the mechanism, this is the reflex.
Ref: engineering-laws.md swarm R4; fork-community.md
- [pending] P2 — Communication contract: summary + structured detail + affordances — Every agent output is summary plus structured detail plus affordances (clickable next actions feeding back as signals); outputs are control surfaces, not dead reports.
Ref: engineering-laws.md Communication contract
- [pending] P2 — Tier 1: codebase vector index + semantic traversal — Codebase vector index serving semantic traversal rather than grep, so agents and reviewers reach relevant code without total reads.
Ref: stack.md Storage classes tier 1; engineering-laws.md law 5
- [pending] P2 — Entity API: Floor / Project (repo, branch, cloning, counts) — Client-readable floors/projects with id, name, repo, branch, cloning and worker counts (workers/busy/waiting).
Ref: interface-contract.md Entities (Floor / Project)
- [pending] P2 — Entity API: Worker (provider/model/effort, desk, status, worktree, pr, usage) — Worker entity exposing provider/model/effort, desk, status, worktree {branch,path,base}, pr, task, activity and usage.
Ref: interface-contract.md Entities (Worker)
- [pending] P2 — Entity API: Task / Queue (issue, title, prompt, status, outcome, pr) — Task/queue entity exposing provider/model/effort, issue, title, prompt, status, workerId, branch, outcome and pr.
Ref: interface-contract.md Entities (Task / Queue)
- [pending] P2 — Entity API: Issue (number, title, state, labels, assignees, body) — Issue entity with number, title, state, author, labels, assignees, taken flag and body.
Ref: interface-contract.md Entities (Issue)
- [pending] P2 — Entity API: Presence / Peer (position, voice, sharing, doing, floor) — Presence entity with id, name, position, voice, sharing, doing and floor.
Ref: interface-contract.md Entities (Presence / Peer)
- [pending] P2 — Entity API: Settings (limits, leave-on-merge, agent, prompts, theme) — Settings entity exposing limits, leave-on-merge, default agent, prompts and map/theme preferences.
Ref: interface-contract.md Entities (Settings)
- [pending] P2 — Events: worker lifecycle + worktree (spawn/update/remove, worktree) — worker.spawn/update/remove and worker.worktree events emitted on the normalized bus.
Ref: interface-contract.md Events
- [pending] P2 — Events: terminal streaming (term.data/snapshot/input) + screen — Terminal streaming protocol with snapshot plus per-row diffs plus scrollback plus input, and screen events for worker views.
Ref: interface-contract.md Events and API needs (terminal streaming protocol)
- [pending] P2 — Events: floor lifecycle (enter/added/removed) — floor.enter/added/removed events on the normalized bus.
Ref: interface-contract.md Events
- [pending] P2 — Events: issue/pull lifecycle (gh.* platform-native equivalents) — Issue and pull lifecycle events as platform-native equivalents of the gh.* events clients consume today.
Ref: interface-contract.md Events
- [pending] P2 — Events: queue state — Queue state events so clients see task queue movement live.
Ref: interface-contract.md Events
- [pending] P2 — Events: peer presence (join/update/leave/move/act/emote) — peer.join/update/leave/move/act/emote events for the presence surface.
Ref: interface-contract.md Events
- [pending] P2 — Provider-agnostic agent launch: unify 8 harness formats — Client architecture needs provider-agnostic agent launch that unifies the eight harness formats behind one platform contract.
Ref: interface-contract.md API needs (provider-agnostic agent launch)
- [pending] P2 — Cost attribution + budget enforcement — Attribute cost per worker/task and enforce budgets, as required by the client architecture.
Ref: interface-contract.md API needs (cost attribution + budget enforcement)
- [pending] P2 — Landing policy engine: branch protection and merge policy — Artifacts has no server-side merge/diff/conflict/branch-protection, so the platform builds policy: protected branches, required evidence, landing rules.
Ref: stack.md What the platform builds (policy); SPEC.md Constraints (no branch protection)
- [pending] P2 — Intent router: declare intent first, match before building — Declare intent first; the platform matches it against the fork ecosystem and pings '80% done by fork X' before work begins.
Ref: fork-community.md The intent router; SPEC.md CAP-10
- [pending] P2 — Fork-card six-cluster signals (fit, trust, liveness, proof, distance, cost) — Fork cards carry six signal clusters (fit/overlap, people/trust, liveness, proof, distance, cost-to-adopt vs regenerate) that trigger investigation, never auto-decision. Concrete card design is still undecided.
Ref: fork-community.md Fork-card signals; fork-community.md Deferred (card design)
- [pending] P2 — Score landing-subset risk for proposal combinations — Score how safe landing a chosen combination (A+B vs A+C) is, so reviewers can compare subsets before committing. Consumes collision and duplication answers where present.
Ref: docs/judge-layer-ideas.md:47 (#7)
- [pending] P2 — Detect duplicated behavior across proposals and forks — A noul across proposals and forks asking whether the behavior is already covered elsewhere. Drives a merge-it-instead recommendation instead of landing a duplicate.
Ref: docs/judge-layer-ideas.md:48 (#8)
- [pending] P2 — Detect stale proposals against moved bases — A noul asking whether a proposal is obsolete because the base moved or another proposal landed the same behavior. Keeps the pending set honest as the base advances.
Ref: docs/judge-layer-ideas.md:49 (#9)
- [pending] P2 — Verify post-merge behavior against expectations — A verify question comparing expected versus observed behavior after landing, using test output or screenshots as evidence. Surfaces a regression signal when the observed result contradicts the intent.
Ref: docs/judge-layer-ideas.md:50 (#10)
- [pending] P2 — Sniff new dependencies and CI edits for supply-chain risk — Choice benign / suspicious / malicious over new dependencies, obfuscated blobs, network calls, and CI edits. Routes suspicious changes to a security queue and blocks on high confidence.
Ref: docs/judge-layer-ideas.md:56 (#13)
- [pending] P2 — Screen public contributions before human triage — Nouls for author-change mismatch, task-scope violation, and spam signals, triaging public PRs before a human sees them.
Ref: docs/judge-layer-ideas.md:57 (#14)
- [pending] P2 — Scan intent and notes text for secrets and PII leaks — A noul asking whether the provenance text itself (intent, notes) leaks secrets or PII before publication. Complements the AD-4 free-text scrub by judging semantic leakage the regex scrub misses.
Ref: docs/judge-layer-ideas.md:58 (#15)
- [pending] P2 — Flag breaking changes with semver signal — A noul plus major/minor/patch choice over the diff. Feeds release gating and changelog semantics.
Ref: docs/judge-layer-ideas.md:62 (#16)
- [pending] P2 — Escalate proposals whose diffs exceed stated scope — Nouls for touches_auth / public_api / billing / schema / ci; escalate when the diff exceeds the stated task. Keeps narrowly-scoped agents from silently widening blast radius.
Ref: docs/judge-layer-ideas.md:63 (#17)
- [pending] P2 — Estimate review effort to order the human queue — Score skim / focused / deep so the human queue sorts by risk times effort. Reduces reviewer overload in the set view.
Ref: docs/judge-layer-ideas.md:64 (#18)
- [pending] P2 — Route proposals to reviewers by expertise match — Choice over reviewer profiles and expertise to route each proposal to a specialist. Consumes the platform's reviewer roster.
Ref: docs/judge-layer-ideas.md:65 (#19)
- [pending] P2 — Gate behavior changes without matching tests — A noul asking whether a behavior change lacks a matching test. Surfaces the gap on the card and to policy before landing.
Ref: docs/judge-layer-ideas.md:66 (#20)
- [pending] P2 — Flag public API changes missing docs updates — A noul asking whether a public API change lacks a docs update. Surfaces doc debt before merge.
Ref: docs/judge-layer-ideas.md:67 (#21)
- [pending] P2 — Check new dependencies against the stated task — A noul asking whether a newly added dependency was actually needed for the stated task. Catches dependency bloat and unnecessary supply-chain surface.
Ref: docs/judge-layer-ideas.md:69 (#23)
- [pending] P2 — Suggest reviewable splits for mega-proposals — Score per hunk whether changes are independent, then suggest reviewable splits for mega-proposals. Keeps large agent outputs reviewable in the set view.
Ref: docs/judge-layer-ideas.md:73 (#24)
- [pending] P2 — Triage issues by type, priority, and component — Choice bug/feature/question plus priority score plus component choice for the issues module. Automates first-pass triage.
Ref: docs/judge-layer-ideas.md:74 (#25)
- [pending] P2 — Classify landed commits for changelog generation — Choice breaking/feat/fix/perf per landed commit so release notes render from code templates. Never asks the model for prose.
Ref: docs/judge-layer-ideas.md:75 (#26)
- [pending] P2 — Triage CI failures and recommend retry policy — Choice flake/infra/real/timeout plus a retry-safe noul to drive retry policy. Avoids blind retries of real failures and manual triage of flakes.
Ref: docs/judge-layer-ideas.md:76 (#27)
- [pending] P2 — Evaluate release-readiness checklist with nouls — Nouls per release checklist item, aggregated in code into a readiness verdict. Advisory on the release surface.
Ref: docs/judge-layer-ideas.md:77 (#28)
- [pending] P2 — Check active claims before agents start tasks — A noul run before an agent starts: does an active claim already cover this task? Enforces swarm rule R4 (join, don't restart).
Ref: docs/judge-layer-ideas.md:83 (#31)
- [pending] P2 — Review UI diffs visually from before/after screenshots — Feed before/after screenshots (Clef's multimodal encoder, up to 4 images) with nouls for visual regression, layout breakage, and unreadable text. Extends review to rendered output.
Ref: docs/judge-layer-ideas.md:88 (#33)
- [pending] P2 — Check changes against design tokens and palette — Score whether the change matches design tokens, palette, and spacing. Advisory chip for UI-touching proposals.
Ref: docs/judge-layer-ideas.md:89 (#34)
- [pending] P2 — Sign agent identities for proposals — Signed identity per agent/author so the trust bundle and fork-card people/trust cluster can rely on verifiable provenance instead of reputation alone.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:57; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What it does' (signed identity)
- [pending] P2 — Persist provenance/artifact tier (traces, previews) — Storage class 3: git-notes, per-worker traces, receipts, live previews, screenshots/videos, and demo links - the artifacts that let the repo answer for itself without cloning.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 3 (class 3); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:17,31
- [pending] P2 — Make stashing simple and safe — Stashing must not be difficult or feel losable; expose a platform-level stash with durable state instead of a fragile local-only mechanism.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:18; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 3
- [pending] P2 — Enable interactive output pages with action buttons — An agent can emit a live web page whose buttons spur the conversation forward; outputs become control surfaces, not dead reports, sharing the review UI's whitespace.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:41,48
- [pending] P2 — Monitor and block sandbox-escape attempts — Agents must respect the boundaries of their box: the platform detects and records sandbox-escape attempts and enforces the boundary rather than trusting the agent.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:42
- [pending] P2 — Support BYO models and harnesses via launch abstraction — Provider-agnostic agent launch so teams bring their own model and harness; at minimum the platform standardizes agent output, plus MCP-style worker management tools.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:40,87; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 7
- [pending] P2 — Show unique fork-vs-fork diffs — See a fork's unique diff versus yours so overlap and divergence are obvious before deciding to join or merge back.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:23,32
- [pending] P2 — Enable agent-to-agent cross-fork conversations — Agents discover and talk to other forks' agents to coordinate work and reduce duplicate effort (collaboration initiation as a platform primitive).
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:23,32
- [pending] P2 — Facilitate merge-back to upstream — Drive more merge-back to upstream so fork work stops being siloed; upstream contribution from a fork becomes a supported flow with provenance.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:23
- [pending] P2 — Score fork people/trust signals — Fork cards carry trusted-developer signals: personal plus community reputation; diverse signals that trigger investigation rather than a single opaque score.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:53,57
- [pending] P2 — Collect liveness and automation evidence signals — Liveness cluster: velocity, recency, self-gardening; CI/CD presence and auto-fix harnesses count as liveness and quality evidence on a fork card.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:55,57
- [pending] P2 — Cluster feature types and tag commits via System-1 — System-1 clustering of feature types with commits carrying tags; an alignment test flags when planned work matches a tag aligned with another fork's work, prompting investigation.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:54
- [pending] P2 — Resolve and implement partial-fit handling policy — Open question: the operational policy for the 'otherwise' branch when a fork's work only partly fulfills the goal. The verdict 'use as context' exists; the policy for acting on it does not.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:63; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 5,10.1
- [pending] P2 — Auto-tag and classify issues with fast models — Fast-model structured auto-tagging/classification for issues with better differentiation than label free-for-alls; the idea is captured but not specced.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:24; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 10.8
- [pending] P2 — Model milestones and epics as first-class timeline objects — Milestones and epics speak project-management language as first-class, checkout-able timeline objects - version navigation in project language, not convoluted tags.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:12,28; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.10
- [pending] P2 — Make historical version checkout painless — Viewing and checking out old versions is currently painful; provide version navigation over the timeline so old states are easy to inspect and restore.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:12
- [pending] P2 — Link work items and change-sets bidirectionally — Engineering law 9: work items and change-sets reference each other so review stays on one surface, feeding both PM integration and the canvas.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:35; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.9
- [pending] P2 — Serve contribution standards platform-side — Engineering law 7: Husky-style contribution standards as a service - deterministic and non-deterministic rules enforced platform-side with no per-repo scaffolding; agents adhere immediately.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:19,33; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.7
- [pending] P2 — Auto-generate changelogs as a platform feature — (demo COULD) Platform-level auto-changelogs (git-cliff, semantic-release, release-drafter, conventional-changelog, changesets) for optimal speed and accuracy without per-repo tooling.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:20; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (COULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.7
- [pending] P2 — Lint commits as a platform feature — Platform-side commit linting with no per-repo config; agents adhere immediately to the platform standard.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:20; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.7
- [pending] P2 — Unify README and file-view repo navigation — Repo navigation is disjointed between README and file view; provide one coherent browsing surface over documentation and files.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:21
- [pending] P2 — Improve releases and tags navigation — Releases and tags navigation is poor; make release objects browsable and navigable in project language.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:21
- [pending] P2 — Reach GitLens-class parity, contextually woven — (demo COULD) GitLens feature parity at platform level while fixing its UI failure: features are woven contextually, discoverable in place, never buried in hundreds of tabs.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:22,34; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (COULD); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.8
- [pending] P2 — Build one continuous surface, no tab explosion — See cross-page information at a glance without leaving the page: SPA-like continuity, glanceable overlays, and work-item-to-change-set links instead of tab hops.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:27,35; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.8
- [pending] P2 — Answer for the repo without cloning — Engineering law 4: semantic index + live preview + native demos + push provenance deliver comprehension without cloning; previews, screenshots, videos, and demo links are built in, not bolted on.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:17,31; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.4
- [pending] P2 — Track push provenance (laptop vs production) — See the bigger ecosystem: per-commit push origin provenance (laptop versus production) as part of the trust and artifact surface.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:16
- [pending] P2 — Expose worktree-as-a-service API — From Agent Office's needs: worktree-as-a-service - the platform provisions and tears down per-worker worktrees server-side.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:87
- [pending] P2 — Normalize worker events across provider hook formats — Unify the eight provider hook formats into one normalized worker-event bus with push delivery, replacing Agent Office's 90s polling assumption.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:87 (unify 8 provider hook formats); _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:89
- [pending] P2 — Stream terminals: snapshot, row diffs, scrollback — Terminal streaming protocol: snapshot plus per-row diffs, scrollback, and input, mirroring the headless-xterm model Agent Office already uses.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:86,87
- [pending] P2 — Attribute worker cost and enforce budgets — Cost attribution and budget enforcement per worker, supporting always-on fleets and the platform's System-1 economics.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:87; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 7
- [pending] P2 — Publish global presence roster API — Gap H7: a global presence roster (who and what is active where) as an API entity for clients and coordination.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H7; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:81
- [pending] P2 — Expose per-worker secrets API — Gap H5: a secrets API per worker so secret-class values reach workers through a controlled channel and never enter change-sets or diffs.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H5
- [pending] P2 — Capture per-worker trace provenance — Gap H4: per-worker trace provenance - the session trail behind a change-set, feeding the trust bundle's proof cluster.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H4
- [pending] P2 — Support host git or native proposal model — Gap H2: remove the local-git assumption - the platform hosts git or provides a native proposal model so clients like Agent Office do not need a local repo.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H2
- [pending] P2 — Expose 3D-renderable entities: floors, workers, queues — The API must expose 3D-renderable entities and events - floors, workers, queues, boards, presence - so spatial clients can render the platform.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:81; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 7
- [pending] P2 — Wire remaining Cloudflare substrate (DO, Workflows, R2) — Artifacts, Workers, Queues, KV, and assets are in use; extend to Durable Objects (coordination), Workflows (orchestration), and R2 (blobs) as the product grows beyond the demo.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'Why this is buildable'; current bindings in platform/wrangler.jsonc
- [pending] P2 — Measure System-1 cost/accuracy vs expensive reads — Open question 10: the confidence-model claim that System-1 classification beats expensive-LLM reads on per-file security levels is asserted, not measured; validate the economic moat premise with numbers.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:97; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 10.10
- [pending] P2 — Replicate content to regional edges with central write authority — Regional edge/proxy servers serve file content locally while the commit server keeps central write authority, with delta-sync sending only changed bytes per revision. Needed for multi-continent studios.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §2 topology (L63-68) + §5 req#6 (L179)
- [pending] P2 — Hit big-repo performance envelope (10k tx/min, 10+TB) — Target sub-100 ms metadata operations, thousands of concurrent users, 10,000+ transactions/minute, 10+ TB repos and petabyte total data without sync/submit degradation; delta transfers for large files. These are Perforce's published capacity figures to match.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §2 capacity (L70-75) + §5 req#9 (L182)
- [pending] P2 — Ship lock-aware Unreal/Unity/Godot editor plugins — Editor plugins show lock status, prevent silent overwrites, and auto-lock on asset edit (UE already flags .uasset binary+l). Lock awareness must move into the tools artists actually use.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 UE integration (L104-107) + §5 req#10 (L183)
- [pending] P2 — Model policy-driven stream branches with derived views — Branching model with metadata (mainline -> release -> development): workspace views auto-derive from the stream spec, merges flow down then up, and sparse/virtual streams restrict the view. A branch-with-policy concept beyond plain Git refs.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §1 stream depots (L11-14)
- [pending] P2 — Add asset metadata, tagging and search (DAM features) — Custom metadata, AI-assisted tagging, high-res thumbnails and USD-native previews for art assets, with browse/search across the repo. The DAM layer on top of versioning that studios use to find assets.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 Helix DAM (L96-98)
- [pending] P2 — Import Git/LFS/Perforce/SVN with transitional sync — Migration importers for existing histories (including binary assets) with bi-directional sync during transition so teams can move incrementally. Competitors advertise automated migration; it is table stakes for displaced Perforce studios.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §3 Diversion migration (L116-121) + §3 SVN (L127-129)
- [pending] P2 — Add binary delta encoding for archive-like assets — Optional VCDIFF-style delta encoding (xdelta3/RFC 3284) where chunking alone is insufficient, storing per-revision deltas for near-incompressible archives and executables.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §2.2 (L68-77)
- [pending] P2 — Invalidate edge caches on mutable ref updates — Immutable chunks cache forever, but mutable refs (branch heads, latest pointers) must invalidate and propagate consistently at the edge; define the cache-invalidation contract for pointer objects.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §4.1-4.2 (L132-142) + §6 Pattern D + Open Q6 (L209)
- [pending] P2 — Add content-addressed registry for build outputs — Immutable build artifacts stored in R2 keyed by content hash while source and lockfiles stay in the repo (Nix-style); outputs dedupe across builds and cache forever. Completes the source-vs-package boundary.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §3.2-3.3 (L117-126) + §6 Pattern G (L199-201)
- [pending] P2 — Harden CI supply chain: pinning, egress control, scoped creds — Dependency locking, egress firewall for build jobs, and ephemeral least-privilege credentials to blunt tj-actions-style exfiltration attacks. GitHub is only adding these natively in its 2026 roadmap, so shipping them is differentiation.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §1 pain points supply chain (L31)
- [pending] P2 — Add poisoning-resistant remote build cache — Task-graph remote cache with authenticated per-repo/tenant writes (70-85% hit rates achievable) that defends against CREEP-style cache poisoning (CVE-2025-36852), where PR actors could poison production bucket caches.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §2 Workers Builds caching (L52) + §3 Nx/Turborepo CREEP (L112)
- [pending] P2 — Autoscale warm runner pools to kill cold starts — Elastic runner fleet with warm pools and burst autoscaling targeting sub-30 s job starts, versus GitHub's 30-60 s provisioning and manual concurrency groups. Off-peak scheduling can absorb non-latency-sensitive bursts.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §1 pain points queue/cold start (L27-29) + research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 scheduling (L113)
- [pending] P2 — Select affected tests with AST-aware analysis — Incremental test selection driven by static/AST analysis of the change, cutting fan-out cost on monorepos. Candidate tooling (testless-class) runs inside a sandbox; no native AST service exists.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §5 req row 3 (L174)
- [pending] P2 — Ensure hermetic, reproducible builds with pinned images — Hermetic build definitions with pinned container images and locked inputs so the same pipeline runs identically in dev and CI. No native Nix/Bazel exists on the stack; container images must be pinned manually.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §5 req row 5 hermetic (L176) + §3 Dagger/Nix (L95,116)
- [pending] P2 — Engineer around Artifacts size and rate limits — Platform-scale fan-out must respect 1 GB/repo, 32 MB/file, 1 TB/account (raiseable), 2k control-plane requests/10 s per namespace and 2k git requests/10 s per repo via sharding, caching, and backoff.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Limits (L22-25)
- [pending] P2 — Add observability for repo and agent event streams — Per-tenant metrics and event analytics (GraphQL dataset artifactsEventsAdaptiveGroups plus platform metrics) covering pushes, clones, locks, pipelines, and agent activity.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Observability (L18)
- [pending] P2 — Attach editors: devcontainers, VS Code Remote, web IDE — devcontainer.json-compatible workspace definitions so local editors attach over SSH/Remote, plus an optional hosted code-server/Theia proxied by a Worker. Latency budget: <100 ms for interactive editing; agent turns tolerate 1-5 s.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §1 devcontainers (L20) + §3 remote-dev (L77-82) + §6 interop (L212-217)
- [pending] P2 — Manage workspace sizing, snapshots and capacity — Instance types lite (1/16 vCPU, 256 MiB) through standard-4 (4 vCPU, 12 GiB, 20 GiB disk), account ceilings (6 TiB memory, 1,500 vCPU, 30 TB disk), snapshots (20 GB, 30-day TTL), and scheduling policies (default/durable_object/off-peak).
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 Containers row (L113)
- [pending] P2 — Fork stateful sandboxes for parallel what-ifs — Pause/fork a running workspace (microVM snapshot) to explore multiple paths from identical state; persistence outlives a single session. Targets ~90 ms creation and sub-200 ms restore where the platform allows.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 patterns 5-6 + Daytona row (L44,52-53)
- [pending] P2 — Support multi-repo workspaces for agent reasoning — Mount/checkout multiple repositories in one workspace so an agent reasons and edits across repos, with per-repo credentials and correct remotes for cross-repo commits.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 pattern 7 (L54)
- [pending] P2 — Add agent computer-use verification artifacts — Agents drive the built app in a browser (computer-use) and capture screenshots/video/log artifacts attached to the proposal for review. Cursor-style verification loop as a platform capability.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §2 pattern 3 + Cursor row (L39,50)
- [pending] P2 — Route agent LLM traffic through AI Gateway — Send agent model calls through Cloudflare AI Gateway for caching, rate limiting, observability, and per-tenant cost attribution. Turns opaque agent spend into an attributable stream.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 Workers row AI Gateway (L116)
- [pending] P2 — Offer Dynamic Workers tier for short jobs — JS/Python/WASM snippets run in Dynamic Workers as a cheap isolated alternative to containers for short tasks, with documented capability boundaries.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 Sandbox row Dynamic Workers (L114)
- [pending] P2 — Document boundaries and federation story for judges — Honest capability matrix: CF runs orchestration, web-native CI, and Linux sandboxes; GPU/Windows/macOS/console devkits federate to external runners. Avoid overclaiming; show the hybrid architecture explicitly in the submission.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §4 absence matrix (L121-138) + research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §4 (L159-164)
- [pending] P2 — Prove Workers + Artifacts compliance for judges — Competition rules require Workers and Artifacts as a minimum (additional primitives allowed); keep the usage demonstrable and record the $25k credits prize and Oct 14 2026 deadline in the submission checklist.
Ref: research/2026-10-02-platform-recon-briefs/bigassets-recon-brief.md §5 competition terms (L165-169)
- [pending] P2 — Adopt task-dependent fan-out; do not chase max agents — The agent optimum is task-dependent (four agents on Commit0, two on PaperBench): expose concurrency as a tunable with guidance rather than a race to maximum agents.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:48
- [pending] P2 — Ship a pre-write conflict-check hook for agents — clash-style hook so agents are stopped before writing into a known collision instead of discovering it at merge time.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:96-104; agentic-git-platform-ecosystem-feature-matrix/verify-round-1-trajectory.md:53
- [pending] P2 — Design review for acceptance, not raw detection — Published mining shows rejections are dominated by invalid, redundant, or out-of-scope suggestions: optimize suggestions for cheap evaluation (acceptance engineering).
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:51,53
- [pending] P2 — Run execution-backed review in sandboxes — Close the loop from 'suggests' to 'proves' (live probes against previews; tests written and run in a sandbox; autofix iterating until tests pass): offer execution results as review evidence.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:47
- [pending] P2 — Match review-UX table stakes per proposal — Match CodeRabbit/Greptile-class reviewer UX (summary, inline comments, one-click fixes, learnings, guideline files) so the set-level product is not weaker per change than single-change reviewers.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:53,161
- [pending] P2 — Add flaky quarantine and bisect-on-failure — After a batch failure, auto-bisect to the offending change and quarantine known flaky tests/agents instead of blocking the queue.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:80; agentic-git-platform-ecosystem-feature-matrix/report.md:162
- [pending] P2 — Echo stacked-diffs/patch-series landing workflow — Proven human-scale discipline (Meta ~100% adoption; Google chained CLs): support dependent stacks with per-change identity and defined submission order.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:51,40
- [pending] P2 — Scope replication per agent with predicate shapes — ElectricSQL predicate shapes and Jazz row-level permissions: replicate only permitted files/rows to each agent's view.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:109,170
- [pending] P2 — MCP server exposing set context to external agents — MCP grew 10k -> 18k+ servers and is LF/AAIF-hosted; provide an MCP surface so external agents can query the change map, conflict graph, and verdicts.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:93,168
- [pending] P2 — Sign landed commits and set attestations keylessly — Add gitsign/sigstore-style keyless signing of landed commits and set verdicts so provenance is verifiable, not just recorded (SLSA: provenance does nothing unless inspected).
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:102; agentic-git-platform-ecosystem-feature-matrix/report.md:141
- [pending] P2 — Add AI-restricted repository mode — The Codeberg/Sourcehut segment is real: an explicit per-repo mode that refuses agent-authored changes (and LLM training use) as a first-class trust feature.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:85,89,166
- [pending] P2 — Add code-linked diagrams with click-through to source — Whiteboard precedent: agent-drawn diagrams/annotations pinned to code line ranges, clickable through to source, beat text-only diffs for comprehension.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:108; agentic-git-platform-ecosystem-feature-matrix/report.md:169
- [pending] P2 — Surface decision logs per change (human vs agent) — A decision log separates human and agent decisions per change, giving a reviewable history of why the set looks as it does.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:169
- [pending] P2 — Add cognitive-debt reduction: fold tests and boilerplate — Fold test/boilerplate noise in review so humans see behavioral change; 2026 analytics show duplication +81% and refactoring -70%, so reviewers must not pay for churn.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:147,384
- [pending] P2 — Show cost-per-review transparency — The review/sandbox market's most confused axis: surface active-work-based cost per review/verdict in the UI rather than hiding it in credits.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:131,384
- [pending] P2 — Add copy-for-agent handoff from triage — Whiteboard's 'Copy for Agent' handoff: a reviewer decision/hunk can be handed back to an agent as a structured task rather than prose in chat.
Ref: competitive-multi-agent-git-platform-landscape-2026-10-02/research.md:108
- [pending] P2 — Budget for Artifacts billing start 2026-10-14 — Artifacts billing begins 2026-10-14 (10k ops/mo free, then $0.15/1k ops + $0.50/GB-month): the demo must fit the free tier or carry an explicit budget.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:119,365
- [pending] P2 — Instrument and export engineering-analytics metrics — The analytics market pivoted to proving AI impact (cycle time, revert rate, review lag; review/validation is the binding constraint): instrument queue/review latency and throughput, attribute them per agent, and export DX/LinearB-compatible metrics.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:151,384
- [pending] P2 — Tour v2: fold judge chips + auto-land language in — After the judge wave ships, update /tour.html so the tour matches the live page: judge chip explanations and auto-land/ACT-CONFIRM-ESCALATE language. Acceptance: tour steps describe chips that render live.
Ref: docs/NEXT-ACTIONS.md [pending] P2 — Tour v2; docs/CHECKPOINT.md:9 (Next: P0 judge wave)
- [pending] P2 — Per-task attempt/retry accounting in the task store — John asked for rich data (deps, owners, timestamps, evidence) to avoid markdown collision; claims/events exist but attempts/retries per task are not first-class. Add attempt counts/heal history surfaced by a view so batch selection and projections see retry cost.
Ref: session history 2026-10-06T01:27 user msg (rich data / standard queries); porting/tasks.mjs events table
- [pending] P2 — Fleet-scale performance budget + capacity model — Recorded unknown: define the latency/CPU budget for N concurrent proposals (target: /proposals stays under ~1 s at 20 proposals, ideally cached) and the per-repo Artifacts limits envelope; feed it into the fleet-scale demo acceptance.
Ref: session history 2026-10-05 ('fleet-scale performance budget' among five honest unknowns); docs/NEXT-ACTIONS.md [pending] P2 — Performance: cache /proposals
- [pending] P2 — Store platform state as Git repos (profiles, metadata, issues) — Make every user profile, repository metadata set, and issue tracker its own Git repository of JSON/Markdown files so platform state is forkable, diffable and auditable instead of living in SQL rows.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L19-25 (§1 The Core Paradigm: Everything is Git)
- [pending] P2 — Bind identity to SSH/GPG keypairs with signed profile repos — Identity is a cryptographic keypair, not a password or centralized OAuth: a user profile is a Git repo signed by that key.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L23-25 (§1 Cryptographic Identity)
- [pending] P2 — CRDT-backed concurrent review and comment merging — Store parallel reviews and simultaneous comments as CRDTs inside the Git tree so multiple humans or agents can comment offline with no centralized locking and merge seamlessly.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L41 (§2 Radical Parallelization)
- [pending] P2 — DAG-scheduled CI: run independent build tasks concurrently — Model CI/CD as a directed acyclic graph that executes every independent task concurrently across a serverless grid instead of a linear pipeline.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L40 (§2 DAG-Based CI/CD Execution)
- [pending] P2 — Self-healing agents: analyse, patch, test and open PRs — Autonomous agents continuously run static analysis, write patches for dependency and security flaws, test them, and open PRs unattended.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L50 (§3 Self-Healing Codebases)
- [pending] P2 — Native Git-hook WebAssembly micro-runners at pack arrival — Trigger Wasm micro-runners from server-side Git hooks the instant a push arrives, instead of waiting for a central server to parse a webhook and schedule CI.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L51 (§3 Event-Driven Webhooks via Git Hooks)
- [pending] P2 — Immutable content-addressable ledger of platform actions — Append every platform decision (why a runner failed, why a PR auto-merged) to an immutable, publicly verifiable log.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L70 (§5 Content-Addressable Platform Logs)
- [pending] P2 — Logic-aware AST diffs: moves and renames shown as moves — Diffs map how logic changed at AST level: a renamed or moved function renders as one visual move rather than a deletion plus an insertion; Tree-sitter parsing gives grammar-aware changes.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L60 (§4 AST Diffs); is-there-an-open-source-CodeRabbit-or-Graphite.md L74 (Difftastic)
- [pending] P2 — Interactive dependency-graph impact view per commit — Render how a single commit impacts internal architecture and external microservices as an interactive dependency graph.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L61 (§4 Dependency Web GL Graphs)
- [pending] P2 — Infinite spatial canvas for code, issues, diagrams and logs — Files, issue cards, architecture designs and live logs can be placed anywhere on an infinite spatial plane so tools group contextually around the code being changed.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L155 (§4 Infinite Spatial Canvases)
- [pending] P2 — Semantic zoom: continuous macro-to-micro through containers — Zooming all the way out shows a microservice as a single node; zooming in smoothly reveals packages, then files, then inner functions and code text.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L190-200 (§1 Semantic Zooming)
- [pending] P2 — Collapsible modules: expand inline or shrink to capsules — Any code block or subdirectory collapses into a small high-level capsule or expands its contents inline on the canvas without opening a new tab.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L202 (§1 Collapsible Modularity)
- [pending] P2 — Contextual clustering: trace affected code from an issue card — Pull an issue card onto the canvas, run Trace Affected Code, and physical elastic lines connect the issue to the code node and its test counterpart.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L206-228 (§2 Multi-Document Orchestration)
- [pending] P2 — Layered feature planes: branches as floating canvas layers — Main is the base layout; checking out a feature branch creates a semi-transparent floating layer, and modified cards lift up or highlight on that layer.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L232-236 (§3 Layered Feature Planes)
- [pending] P2 — Diff topography: merge ripples and conflict intersections — Pulling changes from main ripples through the bottom layer, showing exactly where top-layer modifications intersect or conflict with the base code.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L237 (§3 Visualizing the Diff Topography)
- [pending] P2 — Git+AST graph database feeds the canvas layout engine — A localised high-speed graph database indexes Git history and the AST and continuously feeds node data (dependencies, file paths, parent-child structures) into the canvas layout engine.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L247 (§4 The Git-as-a-Graph DB Interface)
- [pending] P2 — Zero-cold-start Wasm CI fan-out across edge Workers — Split compiling, linting and regression tests into granular fragments fanned across thousands of concurrent Workers with no container cold start.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L380 (§2 Zero-Cold-Start Wasm Runners); L478
- [pending] P2 — Run artefacts as commit sub-trees (logs, telemetry, crashes) — Append build logs, system telemetry and crash reports as sub-trees to the commit that caused them, unifying platform health with code history.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L382 (§2 Immutable Platform Logs); L480
- [pending] P2 — Git-native agent passports with cryptographically signed actions — Every human and AI agent has an unforgeable private-key passport embedded in the Git engine; every action, refactor or patch is a signed commit preserving an audit trail.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L396 (§4 Git-Native Agent Identification); L494 (§4 Git-Native Cryptographic Passports)
- [pending] P2 — Durable Objects as localised graph coordinates and consensus — Use Durable Objects as hyper-local coordinate systems for graph clusters so regional clusters self-heal and resolve their own consensus without a global database query.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L374 (§1 No Central Control Plane); L457-459 (Cloudflare Edge Foundation)
- [pending] P2 — Edge prompt caching for agent context and AST blueprints — Cache static AST graph representations and structural context files in regional KV so millions of agent polls hit a pre-computed semantic cache, cutting latency and token cost.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L669 (§2 Prompt Caching Economics); L697 (Edge Context Optimization Caching)
- [pending] P2 — AST-granular delta pipeline: test only impacted nodes — Use Tree-sitter to isolate the exact microscopic AST change and trigger only the validation modules for directly impacted downstream nodes instead of a full monolithic pipeline.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L668 (§2 AST-Granular Delta Pipelines); L691 (Incremental AST Testing Pipelines)
- [pending] P2 — Contextual MFA elevation to reveal or inject secret values — Revealing or injecting a secret node requires a runtime-evaluated cryptographic challenge: WebAuthn/passkey from a human or ephemeral mTLS from an authorised deployment runner.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L540 (§1 Contextual Multi-Factor Elevation)
- [pending] P2 — Inline streaming leak deflectors on every canvas and doc write — At 10M-entity scale, every code execution, visual node change and document adjustment passes through an inline edge-native Wasm scanner; a pasted credential is scrambled and isolated before it propagates.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L677 (§3 WebAssembly-Powered Leak Deflectors)
- [pending] P2 — Tree-sitter AST graph as the repository read model — Parse every commit with a native Rust/Tree-sitter engine into an AST; agents read structural node relations (Function X modifies Class Y) instead of raw strings and text greps.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L549 (§2 Native AST-Graph Architecture); L520 (user: stop grepping everything)
- [pending] P2 — Machine-readable repo context capsule (Repomix engine) — Every repository segment compiles its tree, dependency map and API interfaces into a dense deterministic JSON/Markdown context index so agents ingest a blueprint in milliseconds instead of raw source.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L550 (§2 The Markdown Context Layer Capsule); L593 (AST Context Maps); L675; is-there-an-open-source-CodeRabbit-or-Graphite.md L76 (Repomix / Gitingest)
- [pending] P2 — Trace archaeology: blame a line back to the agent session — Trace blame links a highlighted line to the exact conversation transcript, prompt and reasoning that produced it, for humans and other agents.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L551 (§2 Decision Logs & Trace Archaeology); L599; L520 (Whiteboard summary)
- [pending] P2 — Click-to-code interactive diagrams for agent change review — Agents emit structured interactive diagrams (sequence flows, flowcharts, call-stack diffs, database lenses) where clicking any step or box navigates to the exact function and line of code.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L575 (§3 Interactive Click-to-Code Diagrams); L520 (Whiteboard summary)
- [pending] P2 — Cognitive-debt filters: fold noise, summarise boilerplate — The review surface compresses boilerplate, hides repetitive configuration updates and folds tests and docs away, isolating core architectural logic into readable pseudocode summaries.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L576 (§3 Cognitive Debt Reduction Filters); L520 (Whiteboard AST semantic diff)
- [pending] P2 — Two-way linked canvas nodes and immutable commit hashes — Every node on the visual flow maps directly to an immutable verifiable Git commit hash and back, so visual claims are always traceable to code.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L595-597 (Two-Way Code-Linked Canvas)
- [pending] P2 — Local-first MCP privacy: no telemetry or hosted traces — Model interactions run through secure Model Context Protocol tunnels (local or worker-sandboxed); telemetry and hosted trace capture default off so private code memories never leak to external servers.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L577 (§3 Local-First Privacy with Global Edge Sync); L520 (Whiteboard privacy caveats)
- [pending] P2 — Agent-first plain-file conventions for config and context — Adopt the Vercel-style agent framework principle: agent configuration, skills and context are plain files in the repository that any agent can traverse, version and diff.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L520 (user: Vercel agent framework which is just files)
- [pending] P2 — Plain-English review rules with BYOK and self-hosting — Review configuration is written in natural language, supports bring-your-own-key models and plugins, and can be self-hosted so teams control their review data.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L15 (Kodus)
- [pending] P2 — Community-governed self-hosted AI PR review agent — The AI PR review workflow runs on the team's own infrastructure using their own LLM tokens, under community governance rather than a hosted vendor.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L16 (PR-Agent by Qodo)
- [pending] P2 — Rules-driven PR automation and review engine — A rules engine automates pull-request routing, checks and lifecycle actions for engineering teams.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L17 (Reviewpad)
- [pending] P2 — Repo-wide semantic review beyond the active diff — Index the whole repository like a vector database so review catches breaking changes, architectural drift and logical flaws in files that were not modified in the pull request.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L48 (Greptile)
- [pending] P2 — Branchless smartlog: manipulate commits directly in the DAG — Bring Mercurial-style smartlog and branchless workflows to large monorepos: manipulate individual commits in the DAG without manually creating local branch pointers.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L66 (Git-branchless)
- [pending] P2 — Chained incremental PR stacking engine with auto-restack — Manage incremental chained pull requests natively across GitHub and GitLab, restacking descendants automatically when a base change updates.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L68 (Git-gud gg)
- [pending] P2 — Stacked-branch sync and ship automation — Automate branch synchronisation, shipping and stacked change workflows with a CLI that keeps a stack in sync with its base.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L24 (Git Town)
- [pending] P2 — Merge queue with atomic batch validation and stacking — A merge queue groups chained branches, tests each batch atomically and lands only batches that pass, natively supporting stacked PR flows.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L82 (Trunk)
- [pending] P2 — Batch merge bot: temp branch, full CI, push only if green — Implement the Not Rocket Science rule: a bot builds a temporary branch containing a batch of approved changes, runs the full CI suite against that exact batch and pushes to main only if everything passes.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L84 (Bors-NG)
- [pending] P2 — Capability parity harness vs GitHub baseline — Systematic compare of our feature set vs GitHub's baseline (research dossiers); flag any area below baseline — 'if we're not exceeding GitHub, we're failing'. Extends the parity gate's competitor mode into a running dashboard.
- [pending] P3 — Post-submission roadmap — R2 asset tier, Agent Office integration, fork community, Clef RL fine-tune track
- [pending] P3 — Law 8: ambient capability + GitLens-class parity (demo COULD) — GitLens-class parity surfaced in context - discoverable in place, never buried in tabs, SPA-like continuity with no tab explosion.
Ref: engineering-laws.md law 8; demo-scope.md COULD (GitLens-class parity)
- [pending] P3 — Law 10: PM inspection via milestones as timeline objects (demo COULD) — Milestones/epics are first-class, checkout-able timeline objects in project language, not convoluted tags; PM integration (demo COULD) is the external half.
Ref: engineering-laws.md law 10; demo-scope.md COULD (PM integration)
- [pending] P3 — Law 11: always-on System-1 decision layer primed for agents and CI/CD — Cheap System-1 decision agents run continuously, prime the LLM agents doing code work and can drive CI/CD directly; affordability comes from the decision layer being cheap.
Ref: engineering-laws.md law 11
- [pending] P3 — Swarm R2: denial is a wall - count, close, force alternative, escalate — Forbidden paths are a wall, not an obstacle: counted, closed, the sanctioned alternative forced, escalation after N attempts.
Ref: engineering-laws.md swarm R2
- [pending] P3 — Entity API: Whiteboard (strokes + cursors per floor) — Whiteboard entity exposing strokes and cursors per floor.
Ref: interface-contract.md Entities (Whiteboard)
- [pending] P3 — Entity API: Services (worker, branch, page title, local port) — Services entity exposing worker, branch, page title and local port for running previews.
Ref: interface-contract.md Entities (Services)
- [pending] P3 — Entity API: Chat / Notifications (from, text, at) — Chat/notification entity with from, text and at timestamp.
Ref: interface-contract.md Entities (Chat / Notifications)
- [pending] P3 — Events: chat + toast — chat and toast events on the normalized bus.
Ref: interface-contract.md Events
- [pending] P3 — Active-fork radar: in-context relevant forks + unique diff — Surface active, relevant forks in context, show their unique diff versus ours, enable fork-off-fork collaboration and more merge-back to upstream.
Ref: fork-community.md Mechanisms (active-fork radar)
- [pending] P3 — Background comparison sub-agent: continuous fork-vs-goal diff — A background sub-agent continuously diffs another fork's work against our PRD/prompt/implementation/goal and returns the verdict shape.
Ref: fork-community.md Mechanisms (background comparison sub-agent)
- [pending] P3 — Partial-fit policy: use-as-context branch mechanics (deferred) — The operational policy for partial fits (how the use-as-context branch works mechanically) is explicitly deferred to build and needs trenches time.
Ref: fork-community.md Deferred (partial-fit operational policy); SPEC.md Open Questions
- [pending] P3 — Auto-changelog generation (demo COULD) — Auto-changelog from landed change-sets and their intent records; a demo COULD item.
Ref: demo-scope.md COULD (auto-changelog)
- [pending] P3 — Pod/container visualization (demo COULD) — Visualize worker pods/containers on the canvas; a demo COULD item.
Ref: demo-scope.md COULD (pod/container visualization)
- [pending] P3 — Classify commit messages as conventional, vague, or misleading — Choice conventional / vague / misleading over the commit message paired with the diff. Flag-only signal for review-quality metrics.
Ref: docs/judge-layer-ideas.md:68 (#22)
- [pending] P3 — Rank candidate forks against a declared intent — Listwise ranking of candidate forks against a declared intent (measured recall@1 0.94 listwise vs 0.87 per-candidate at 1/30th the calls). Powers the someone-already-did-this radar.
Ref: docs/judge-layer-ideas.md:82 (#30)
- [pending] P3 — Classify game assets by type and lock/preview needs — Choice texture/audio/model/level/video plus nouls for exclusive-lock and preview needs. Roadmap track for the game-asset storage story.
Ref: docs/judge-layer-ideas.md:91 (#36)
- [pending] P3 — Support fork-off-fork collaboration — Fork-off-fork cooperation as a first-class primitive, not just fork-versus-upstream: sibling forks can coordinate and share work.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:23,32
- [pending] P3 — Estimate cost-to-adopt vs regenerate for forks — Sixth signal cluster: an LLM-merge estimate comparing adopting a fork versus regenerating equivalent work - economics applied to join-don't-restart.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:57 cluster 6; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 4
- [pending] P3 — Integrate Linear-class PM via common API — (demo COULD) Integrate PM tools rather than imitating GitHub's half-baked milestones/labels: a common API for Linear-class systems, or flesh out projects fully.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:26,35; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.10
- [pending] P3 — Expose CI/CD interaction visibility — Show CI/CD interactions in the platform surface so users see automation acting on their change-sets; noted explicitly low priority.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:25; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 10.7
- [pending] P3 — Visualize containers/pods and running apps if authorized — (demo COULD) Container/pod visualization and running-app visibility when the viewer is authorized, connecting the repo to its runtime.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:16; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92 (COULD)
- [pending] P3 — Synthesize reviewDecision/mergeState for clients — Gap H1: Agent Office is tightly coupled to GitHub fields; synthesize reviewDecision and mergeState from platform state so a client adapter can be a drop-in.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H1; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:89
- [pending] P3 — Match 11-entity contract; offer GitHub drop-in adapter — Mirror Agent Office's 11-entity contract (Floor, Worker, Task/Queue, Issue, Pull, PR-detail, Presence, Whiteboard, Services, Settings, Chat) so a platform adapter can replace GitHub as the sole backing store.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:89,98; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 7
- [pending] P3 — Build toward Agent Office as flagship 3D client — (demo WON'T) Platform stays a web-first product plus API (the heart); Agent Office is the flagship 3D client (the face) to build toward - 3D worlds render platform entities; it is not the core UI and not demo scope.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:75; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 7,2 (WON'T)
- [pending] P3 — Run always-on System-1 decision agents — Rung-2 echo: cheap decision agents run continuously, priming the LLM agents that do code work; context-swapping between background subagents is constant and affordable because the decision layer is cheap.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:67,68,71; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 8.11
- [pending] P3 — Let decision agents drive CI/CD directly — Non-LLM decision frameworks feed and prime LLM agents and can directly drive CI/CD workflows when the decision is mechanical.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:68
- [pending] P3 — Prototype rung-2 echoes: agent memory, routing — Design for the echoes already visible at rungs 1-2: agents holding memory and compute between themselves and intelligent routing of even basic work - not the mind-uploading nebula.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:77,84
- [pending] P3 — Design account-level macro-merging — Long arc: mass-level mergers of company portfolios and their software - 'companies as a service', account-level ecosystem merging rather than individual applications.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:79
- [pending] P3 — Write competitive differentiation positioning — Open question 9: assert the convergence layer plus social layer as the differentiator with head-to-head positioning, grounded in the research that no shipping product does set-level proposal triage.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 10.9; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What the research says'
- [pending] P3 — Instrument fork-reuse decisions for merge policy — Fork-reuse and merge preferences cannot be fully decided in advance - they need trenches time; capture operational data so the policy can be derived later.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:50; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 10.2
- [pending] P3 — Implement binary asset locking (exclusive-open) — Git LFS has no locking while Perforce's exclusive-open model is the proven pattern for binary assets; bring asset lock semantics to the platform alongside the text merge model.
Ref: source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What the research says' (Git LFS no locking; Perforce exclusive-open)
- [pending] P3 — Position in market with seatless storage-based pricing — Respond to the March 2026 Unity VCS shift (unlimited seats, 25 GB free storage, usage-based overage) and Perforce cloud at $39/user/month; define our free tier and storage/egress metering model. Pricing is a competitive weapon for large studios.
Ref: research/2026-10-02-platform-recon-briefs/perforce-recon-brief.md §6 pricing (L189-216)
- [pending] P3 — Evaluate WASI-based hermetic CI steps — Spike WASI 1.0 capability-based isolation for hermetic CI steps (no network unless granted). Experimental: no production CI system uses Wasm natively yet, so this is a research track.
Ref: research/2026-10-02-platform-recon-briefs/cicd-recon-brief.md §3 Wasm-based CI (L134-135)
- [pending] P3 — Support us/eu jurisdictional data residency — Jurisdiction (us/eu) is immutable at namespace creation; relevant for EU studios and regulated content. Data-localization guarantees must be surfaced in provisioning.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Jurisdictions (L17)
- [pending] P3 — Queue changes offline and sync on reconnect — Graceful degradation when disconnected: local-first clone with periodic sync, agent work queued until reconnect, and optional CRDT (Automerge/Yjs) for edit-then-merge. Online-first is acceptable for v1; offline is a stated open question.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §6 offline (L183-187)
- [pending] P3 — Mitigate single-product sunset risk via composability — Firebase Studio/Project IDX sunsets Mar 2027 after Google disabled signups - a cautionary precedent; emphasize that Workers + Artifacts + Sandbox are substitutable layers, not a single-product bet.
Ref: research/2026-10-02-platform-recon-briefs/clouddev-recon-brief.md §5 caution (L159-161)
- [pending] P3 — Interop: act as a layer above GitHub/GitLab — Treat incumbents as integration targets: import/export changes, read AGENTS.md, and target alongside GitHub/GitLab rather than replacing hosting; GitHub is the best integration target.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:89,166
- [pending] P3 — Evaluate structured merge (tree-sitter/GumTree) beyond line merge — Line-based merge is structurally inadequate at agent churn (41.7% cross-agent textual conflicts, ~42% structural): Mergiraf's tree-sitter+GumTree structured merge and grammar-aware diffs are borrowable future tiers; tree-sitter at the edge is viable but unmeasured.
Ref: technical-next-gen-git-platform-on-cloudflare-2026-10-02/research.md:49,57,91; agentic-git-platform-ecosystem-feature-matrix/report.md:164,168
- [pending] P3 — Route landings by build-graph blast radius — Aviator-style affected-target lanes (Bazel/Nx/Pants/Turborepo/Gradle): classify each change by impacted targets and parallelize landing lanes by blast radius.
Ref: agentic-git-platform-ecosystem-feature-matrix/report.md:59,162
- [pending] P3 — Agent Office 3D client — deferred/parked by principal (API-consumer only) — Deferred/parked by principal (API-consumer only): John explicitly stopped office effort — 'We want it working in the browser. It's just the 3D Office can be easily integrated into it because it has an API interface.' Zero build effort goes to the 3D client; it plugs in later for free or not at all; browser is the product. SPEC non-goal and queue P3 stand.
Ref: session history 2026-10-04T11:33 user msg; session history 2026-10-04T11:34-11:35 assistant ('office parked, permanently … browser is the product'); SPEC.md:61; docs/NEXT-ACTIONS.md [pending] P3 — Post-submission roadmap
- [pending] P3 — Agent Office adapter plan: 5 first integration changes (post-demo) — When/if unparked: (1) Building.add() takes an arbitrary clone URL; (2) a PlatformClient beside gh() constructs Floor.github from platform/CONTRACT.md REST returning the same GhState shape; (3) port the 5 GitHub-API-shaped REST helpers; (4) feed /proposals+conflicts into boards, keep MergeWatch verbatim; (5) map agent sessions to desks via a platform provider and neuter GitHub-only queue links. Zero-GitHub boot is verified.
Ref: /tmp/office-boot/report.md:265-296 (top 5 changes); /tmp/agent-office-analysis/integration-surface.md (H1-H7); /tmp/agent-office-analysis/system-map.md
- [pending] P3 — Signed social graph: follows, stars, permissions as commits — Follows, stars and permissions are signed commits that modify verifiable lists, so the social graph is auditable and forkable like code.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L24-25 (§1 Cryptographic Identity)
- [pending] P3 — Per-repo actor-model event loops (sharded, isolated actors) — Process repository events (pushes, hooks, actions) in an actor model where every repository is an isolated actor running its own parallel loop, so tenants never share one serialized event queue.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L42 (§2 Radical Parallelization)
- [pending] P3 — Federated mirror nodes (ActivityPub + Git), no walled garden — Because identity is cryptographic and data is Git-native, anyone can host a mirror node; if the main instance is down, code, issues and PR histories still push/pull across instances.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L71 (§5 Open Federation)
- [pending] P3 — Live pipeline heatmap for parallel test execution — Show parallel test execution in real time as a visual grid of streaming logs and node clusters so bottlenecks are instantly visible.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L62 (§4 Pipeline Heatmaps)
- [pending] P3 — Spatial codebase map: 3D volumes from code metrics — Render a repository as a three-dimensional architectural city: classes and modules are buildings/hubs, height maps to lines of code or complexity and width to function count.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L113-119 (§1 The Spatial Codebase)
- [pending] P3 — Volumetric call-graph traces with request-lifecycle pulses — Functions are nodes inside the 3D structures; calls are glowing volumetric links, and a request animates as a pulse of light traversing the codebase.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L118 (§1 Volumetric Flow)
- [pending] P3 — Structural 3D diff: fissures across dependent downstream models — A pull request isolates the affected 3D structures; breaking an interface shows a visible fissure running through dependent downstream models in real time.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L119 (§1 The Structural Diff)
- [pending] P3 — 3D volumetric commit history: helix with orbital branches — Turn git log into a navigable 3D timeline or helix: main is the central spine and feature branches spiral outward or orbit the core path.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L123-136 (§2 The 3D Git Commit History)
- [pending] P3 — Commit spheres: zoom from macro history into the snapshot — Each commit is an interactable sphere; entering it smoothly zooms from the high-level project history into the microscopic 3D code changes of that snapshot.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L136 (§2 Commit Topology)
- [pending] P3 — Visual merge blending with conflict glow at intersections — Merging two branches animates their geometric paths twisting, intersecting and fusing; conflicting vertices glow amber or red at the exact spatial intersection.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L137 (§2 Visual Merge Blending); L488 (§3 Visual Merge Blending)
- [pending] P3 — Kinetic pipeline trees: animated CI state on limbs — Visualise parallel CI/CD as an expanding tree whose limbs pulse blue while running, fracture on failure and turn solid green on pass.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L145 (§3 Kinetic Pipeline Trees)
- [pending] P3 — Live telemetry overlays: thermal code and traffic currents — Overlay real-time server telemetry onto the codebase model: heavily trafficked code glows like thermal imaging, and enterprise traffic flows render as moving colour-coded currents linking cards.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L146 (§3 Live Traffic Topography); L390; L487 (§3 Kinetic Heatmaps)
- [pending] P3 — Avatar-based walkthroughs with spatial audio and comments — Multiple distributed developers inhabit one 3D workspace; seniors walk juniors through the architecture with spatial audio and pin spatial comments directly onto modules.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L150-154 (§4 Immersive Collaborative Environments)
- [pending] P3 — Russian-doll nesting mirrors the import tree spatially — Dragging component B inside component A's visual boundary snaps it there, creating a spatial hierarchy that mirrors the actual import tree.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L201 (§1 The Russian Doll Metaphor)
- [pending] P3 — Inter-component portals synchronise linked views — Open a spatial portal between two related nodes (for example an API endpoint and its frontend consumer); edits made inside the portal sync back to the source node.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L228 (§2 Inter-component Portals)
- [pending] P3 — Drag-and-drop merging of modified block clusters — Merging a branch or commit is done by grabbing a cluster of modified code blocks from the feature plane and dropping it onto the production layer.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L238 (§3 Interactive Merging via Drag-and-Drop)
- [pending] P3 — WebGPU render loop: thousands of fluid cards at 120 FPS — A custom GPU-accelerated rendering loop treats cards as light graphic objects and keeps interactions at locked 120 FPS even with thousands of open files, bypassing DOM scaling limits.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L244-246 (§4 Rendering Layer)
- [pending] P3 — Embed 3D node widgets inside 2D flow nodes (R3F) — Use React Flow for the infinite 2D canvas, panning and edges, while custom nodes host React Three Fiber canvases so connecting nodes alters 3D content inside a flat node.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L290-295 (§1 React Flow + React Three Fiber)
- [pending] P3 — True 3D graph navigation via force-directed layout — For a graph that lives fully in XYZ space with an orbiting camera, use a physics-based 3D force graph as the navigation substrate.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L297-302 (§2 react-force-graph-3d)
- [pending] P3 — Nested infinite canvas on a WebGL engine (PixiJS/tldraw) — For an infinite nested canvas where documents physically wrap inside parents, use a WebGL canvas engine that computes camera projection, panning and depth manually.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L304-311 (§3 PixiJS / tldraw)
- [pending] P3 — Git as immutable ledger of intention for enterprise state — Every employee, agent, cluster and config string is a discrete node in one global Git graph; infrastructure is a self-evaluating graph rather than a separate hosting environment.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L345-360 (Paradigm Shift: Biological Git Graphs)
- [pending] P3 — Micro-state repositories: each infra element its own Git tree — A routing rule, secret key or isolated database instance is its own lightweight self-contained Git tree, so a single config change touches only its micro-repo.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L370-372 (§1 Micro-State Repositories); L470
- [pending] P3 — Cryptographic intention binding between dependent services — Applications declare dependencies through GPG/SSH key bindings and embed the signed hash of the resource they need, so upstream changes ripple only to bound consumers via edge event triggers.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L373 (§1 Cryptographic Mesh Network); L471 (§1 Cryptographic Intention Binding)
- [pending] P3 — Service mesh compiled to edge KV within milliseconds — Compile every routing-table change to deterministic key-value pairs propagated across Cloudflare's edge so network topology morphs as fast as agents commit.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L472 (§1 Decentralized Service Mesh via Cloudflare KV)
- [pending] P3 — Semantic zoom of the enterprise matrix — Top layer shows the company as interacting galaxies of business units; zooming in reveals regions, service meshes, applications, and finally the line being edited.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L388 (§3 Semantic Zooming of the Enterprise Matrix); L486
- [pending] P3 — Dynamic clustering of failing services on the canvas — Services under heavy traffic or security failure physically expand and highlight red, pulling spatial attention from automated agents or engineers.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L389 (§3 Dynamic Structural Clustering); L487
- [pending] P3 — Autonomous optimization swarms acting on live telemetry — Specialised agent swarms watch telemetry, fork the affected micro-state repo, optimise the logic, verify on the Wasm grid and auto-merge the patch.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L397 (§4 Autonomous Optimization Swarms); L495
- [pending] P3 — CRDT consensus with priority rules for overlapping agents — Thousands of concurrent overlapping edits merge mathematically by logical priority rules instead of branch locks, with deltas committed to regional nodes and resolved globally.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L398 (§4 Conflict Resolution via CRDT Consensus); L496; L667
- [pending] P3 — Unified distributed DAG of cryptographically signed nodes — Code, routing, compute limits, dependencies and agent intentions unify as signed nodes in one fluid distributed DAG that is the enterprise.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L435 (The Self-Synthesizing Enterprise)
- [pending] P3 — Account mesh: millions of Durable Object coordinate nodes — Treat an account as a self-routing, globally distributed mesh of Durable Object coordinate nodes rather than a row in a database.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L627-638 (§1 The Autonomous Account Mesh)
- [pending] P3 — Spatial sharding: run state nearest the active entity — Durable Objects distribute to the data centre closest to each active human or agent, so one account's state fractures and runs regionally in parallel with async mesh routing.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L638 (§1 The Spatial Sharding Engine)
- [pending] P3 — Ephemeral regional secret injection via authorization tree — Never replicate credentials to all nodes: inject keys at the regional edge layer transiently, single-session and need-to-know, validated by localised handshakes.
Ref: Redesigning-GitHub-With-Git-Architecture (2).md L639 (§1 Decoupled Multi-Tier Security Profiles)
- [pending] P3 — Revision-centric VCS with effortless stacking and rewriting — Adopt a jj-style revision-centric model where every working-copy change is automatically a commit, making stacking, reordering and splitting changes first-class operations without corruption risk.
Ref: is-there-an-open-source-CodeRabbit-or-Graphite.md L23, L64 (Jujutsu jj)
- [pending] P3 — Close agent-skill gaps (5 shadow skills) — Author skills the mapping proved missing: licensing/attribution review, git-internals (objects/diff3), browser visual-QA, test authoring, acceptance-vs-change gate. Each: SKILL.md with trigger phrases; register in .omp/agents.md packs.

- [done] P0 — SQLite task backbone — `porting/tasks.db` (WAL, claims, events) + `porting/tasks.mjs` CLI (init/import/add/next/claim/release/set/list/view/query) + tests incl. two-process claim contention; `docs/NEXT-ACTIONS.md` becomes a derived view; batch runner reads the DB; acceptance: `bun porting/tests/tasks.test.mjs` all-pass + view round-trip equal; check: bun porting/tests/tasks.test.mjs
- [done] P0 — Architecture doc (bmad-architecture) — freeze worker/Artifacts/DO/R2/federation boundaries + the `/judge` contract; acceptance: doc lands beside the spec and matches the deployed reality
- [done] P0 — Judge-layer research + live proof — Clef verified callable 2026-10-05; 36 ideas recorded in `docs/judge-layer-ideas.md`
- [done] P0 — Contract-pin /judge shapes + card signals before the judge wave (AD-8) — Pin request kinds, response envelope (setId/modelId), error cases, and the three card-chip fields in platform/CONTRACT.md before the judge wave ships; no undocumented shape reaches a producer or consumer; contract-first is a gate (spine AD-8).
- [done] P0 — Workspace fan-out: one command creates N forks with scoped tokens (demo MUST) — Provision N isolated Artifacts forks of the baseline in one command, each minted a repo-scoped write token, so concurrent agents work without stepping on each other. N=4 proven live 2026-10-03.
Ref: SPEC.md CAP-1; demo-scope.md MUST map; platform/scripts/fanout.mjs:1-40
- [done] P0 — Independent-push events: every fork push emits a platform event — Each workspace accepts pushes independently and every push emits an event (repo.pushed etc.) consumed from Queue nextgit-events and persisted to the KV feed.
Ref: SPEC.md CAP-1 success; platform/src/index.ts:863-889; platform/wrangler.jsonc queues.consumers
- [done] P0 — Change-set capture server-side (/changes) with no clones (demo-critical) — Per-fork commit, file and diff read via Artifacts binding reads (readFile/readCommit/readTree/readBlob) against the FORK POINT, never a clone. Patches are budgeted under the Worker CPU envelope.
Ref: SPEC.md CAP-2; platform/src/index.ts:100-560,818-826; platform/CONTRACT.md GET /changes
- [done] P0 — Cross-proposal conflict map: pairwise kinds + regions (demo MUST) — Maps overlap across N concurrent proposals before landing: conflicting file pairs with kinds (text-conflict, modify/delete, add/add, mergeable, identical-add, both-removed), per-pair regions and set summary counts, computed with in-worker diff3.
Ref: SPEC.md CAP-3; demo-scope.md MUST map; platform/src/index.ts:/proposals; platform/CONTRACT.md GET /proposals
- [done] P0 — Deliberate collision demo scenario: overlapping agent tasks — Both agent harnesses write deliberately overlapping changes (agent-1 and agent-2 both rewrite src/auth.ts) so the conflict map has a real collision to surface in the demo story.
Ref: platform/scripts/agents.mjs:241-260; platform/scripts/real-agents.mjs:240-260; demo-scope.md story step 2
- [done] P0 — Set-level triage canvas: all proposals on one page (demo MUST) — One canvas renders all concurrent proposals as cards with summary chips, a live event ticker, a conflict section, inspector modal, preview-merge and one-click land; no tab-hopping.
Ref: SPEC.md CAP-4; demo-scope.md MUST map; platform/ui/index.html; platform/ui/app.js:404-541
- [done] P0 — Per-proposal intent records on triage cards (demo MUST) — Each proposal carries its why: intent is attached as a git note, mirrored to a branch the binding can read, and rendered on the card before the diff. Missing notes fall back to NEXTGIT_INTENT/<sha>.txt.
Ref: SPEC.md CAP-5; demo-scope.md MUST map; platform/src/index.ts:157-206; platform/CONTRACT.md Notes mirror
- [done] P0 — Live push pipeline: push to queue to worker to UI (demo MUST) — Artifacts events flow Queue nextgit-events to the worker consumer, are recorded to KV and drive the UI ticker; a new event triggers an immediate proposals refresh (~2s tick with debounce, 8s fallback poll).
Ref: SPEC.md CAP-6; demo-scope.md MUST map; platform/src/index.ts:647-676,863-889; platform/ui/app.js:213-243,941-953
- [done] P0 — Landing path: /land folds proposals onto the baseline server-side — POST /land diff3-folds the chosen proposals onto the baseline and pushes ONE commit from inside the worker using a single-use scoped token; conflict, withheld-secret and no-changes are explicit 409s.
Ref: SPEC.md CAP-7; demo-scope.md story step 5; platform/src/index.ts:694-808,849-851; platform/src/land.ts; platform/CONTRACT.md POST /land
- [done] P0 — Demo agent harness: deterministic writers + real AI CLIs — Both harnesses exist: a deterministic text-transform writer set and a real-AI-CLI driver that hands tasks to actual agent binaries in real fork clones so proposals are what agents really wrote.
Ref: SPEC.md Assumptions (harness choice); platform/scripts/agents.mjs; platform/scripts/real-agents.mjs:1-40
- [done] P0 — Eligibility: resolve US/Canada residency before entering — Terms section 3 voids the entry unless the entrant (or teammate) is a legal US/Canada resident; unresolved open question.
Ref: SPEC.md Open Questions (eligibility); SPEC.md Constraints
- [done] P0 — Render concurrent proposals as one set-level triage canvas — (demo MUST) Present all concurrent agent change-sets as one comparable set on a single canvas; the human reviews the set, not one PR at a time. Base canvas is shipped with per-proposal cards, conflict panel, and summary counts.
Ref: built: platform/ui/app.js + platform/src/index.ts /proposals; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md section 2
- [done] P0 — Detect cross-proposal conflicts into a conflict map — (demo MUST) Pairwise diff3 simulation across concurrent proposals producing a per-file conflict map with kinds (text-conflict, modify/delete, add/add, undetermined, mergeable, identical-add, both-removed) and per-pair regions.
Ref: built: platform/src/index.ts conflict detection L499-658; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 2,4
- [done] P0 — Capture per-proposal intent record — (demo MUST) Record what each agent set out to build and attach it to the change-set; read from the git-notes mirror branch, with NEXTGIT_INTENT branch file as fallback, capped before reaching any response body.
Ref: built: platform/src/index.ts readNotes L157-213 + /changes; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-intent.md sections 2,4
- [done] P0 — Publish a live change-set event feed from pushes — (demo MUST, feed half) Artifacts queue consumer records push/fork/create events into KV; /events serves the newest 50; the UI ticker detects new events and debounces a /proposals refresh.
Ref: built: platform/src/index.ts event consumer + /events; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:90 H6
- [done] P0 — Compute platform-native diffs for change-sets — (demo MUST support) Server-side per-file line diffs and patches against the change-set fork point with no clones; a patch budget caps oversized change-sets.
Ref: built: platform/src/index.ts /changes; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'Why this is buildable' (no diff endpoint gap)
- [done] P0 — Provide merge API to fold proposals and one-click land — (demo MUST support) diff3 fold of proposals in order onto the baseline with the fork point as ancestor; POST /land pushes the result as one server-side commit with the same fold semantics as /merge.
Ref: built: platform/src/index.ts + land.ts; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'Why this is buildable' (no merge API gap)
- [done] P0 — Let humans land the chosen proposal from the canvas — (demo MUST support) The human clicks ship on one proposal; the platform folds and pushes it; failure paths explain conflict, secret withholding, or no-changes instead of handing out credentials.
Ref: built: platform/ui/app.js + /land; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What we built for the demo' step 6
- [done] P0 — Give every concurrent agent an isolated workspace — (demo MUST) Each agent works in its own isolated workspace rather than a shared branch; the demo uses separate Artifacts repos (agent-1..agent-4) driven by real CLI agents, with no cross-talk between change-sets.
Ref: built: per-agent Artifacts repos (demo, agent-1..4); source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What it does'
- [done] P0 — Run the scripted 3-5 agent collision demo — (demo) One repository, three to five real CLI agents working concurrently and colliding deliberately; the canvas maps the conflict, proposals render as one set, a judge scores, one lands, and the decision is recorded - the submission story end to end.
Ref: built: docs/BUILD-LOG.md wave1 + tour; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What we built for the demo (Oct 14)'; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92
- [done] P0 — Simulate concurrent proposals with server-side diff3 conflict maps — Server-side change-set computation (no clones) plus pairwise 3-way merge simulation across concurrent proposals with real conflict kinds (text-conflict, modify/delete, add/add, mergeable) and an ordered fold merge. Closes the Artifacts gaps: no server-side merge API, no diff endpoint, no conflict detection.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Critical gaps (L27-32); built: platform/src/index.ts:1-14, platform/CONTRACT.md §/proposals §/merge
- [done] P0 — Resolve competition eligibility: US/Canada residency (§3) — Entrants must be legal US/Canada residents (18+); entry is void outside those countries. The Cloudflare account is a .com.au address and this machine runs UTC+9 — flagged in-session; owner John must answer before submission completes, or name an eligible teammate.
Ref: session history 2026-10-02 competition-terms read (US/Canada §3); docs/STATE.md:38 standing-reds row; docs/NEXT-ACTIONS.md [pending] P0 — Submission package row
- [done] P0 — Browser-first hero loop verified: agents work → one click ships — The hero flow lives in the browser with no CLI and no clones: real agents push proposals, the set view shows them with intents, and clicking 'Land into demo' ships the chosen proposal server-side. Verified live: agent-3 landed (commit da120ab2), banner confirmed, card collapsed, live feed ticked.
Ref: session history 2026-10-04T12:36-12:38 (landed da120ab2); platform/src/index.ts:679-760; platform/ui/app.js:487-517; docs/BUILD-LOG.md:5-6
- [done] P0 — Fork-point change-set semantics + no-changes 409 gate — Change-sets are computed against each proposal's fork point, not the moving base head — this killed the false reverse-deletion noise after the first live land. Re-landing an unchanged proposal returns 409 no-changes, agreeing with /proposals' landed view.
Ref: platform/src/index.ts:113,297,379,407,746-751; session history 2026-10-04T12:37 ('fork point … fixing it now'); docs/BUILD-LOG.md:6 (wave3)
- [done] P0 — Land hardening: single-use tokens, no credential handout, no replays — Architecture-gate live fixes: the /land push-failure path no longer returns a working write token or ready-to-run shell snippets; tokens are single-use (300 s, revoked in finally); land.mjs replay path removed (delegates to /land); unused memfs dropped. Deployed and smoke-tested (version 87958c11).
Ref: docs/CHECKPOINT.md:5-9 (entry 2026-10-06; commit d0d8b17, worker 87958c11); session history 2026-10-06T02:16-02:19
- [done] P0 — SQLite task backbone: WAL, lease claims, events, CLI — porting/tasks.db via bun:sqlite: tasks + lease-based claims + append-only events, WAL + busy_timeout + BEGIN IMMEDIATE so concurrent agent processes never collide on task state; tasks.mjs CLI (init/import/add/next/claim/release/set/list/view/query). Landed GREEN through the loop: 52/52 tests including a two-process claim-contention race.
Ref: porting/tasks.db; porting/tasks.mjs; porting/tests/tasks.test.mjs; docs/CHECKPOINT.md:8; session history 2026-10-06T01:27 user msg
- [done] P0 — One canvas for the whole concurrent proposal set (demo MUST) — A single canvas presents all concurrent proposals as a comparable set: summary chips, live event ticker, conflict section, inspector and per-card actions, with no tab-hopping.
Ref: demo-scope.md MUST map (set-level triage canvas); platform/ui/index.html:103; platform/ui/app.js:163-236,404-541
- [done] P0 — Land security remediation (DONE): credential-free failure path + single-use tokens — Shipped d0d8b17 + deployed 87958c11: /land push-failure returns fold artifacts only (no token, no shell snippets); worker-minted tokens 300s TTL revoked in finally; land.mjs delegates to /land (no replays).
- [done] P1 — State spine + loop scaffolding — `docs/` spine, `porting/` runner, `.omp/commands/`, `scripts/status-index.mjs` (this bootstrap)
- [done] P1 — Write the product brief (bmad-product-brief) — Draft landed (fast path); finalize runs after John's content pass.
- [done] P1 — Git-notes provenance: intent durable across rebases (demo SHOULD) — Records persist as git notes (refs/notes/*) so intent survives rebases and baseline movement; the platform reads notes via the nextgit-notes branch mirror because the Artifacts binding cannot resolve refs/notes/* directly.
Ref: SPEC.md CAP-5 success; demo-scope.md SHOULD map (git-notes provenance); platform/src/index.ts:157-178
- [done] P1 — Secret-typed files: schema-only views + withheld land (demo SHOULD) — Path-driven secret classes (.env*, *.pem/*.key/*.p12, credentials/secrets json, secrets/) render as key schema only; patches never leave the worker; /land refuses to push affected files with 409 withheld-secret.
Ref: SPEC.md CAP-8; demo-scope.md SHOULD map; platform/src/index.ts:208-230,700-708; platform/CONTRACT.md Secret classes
- [done] P1 — Law 1: review is set-level by construction; no per-diff review track — Convergence is the central act: sets, not diffs. The platform exposes set-level proposal review (/proposals plus the canvas) and has no per-PR review core, enforcing the law architecturally.
Ref: engineering-laws.md law 1; platform/src/index.ts:/proposals; platform/ui/index.html
- [done] P1 — Type secret files and mask values (schema-only views) — (demo SHOULD) Path-driven secret classes; values never leave the worker and never appear in responses; API returns key names only; /land refuses folds that would touch secret files.
Ref: built: platform/src/index.ts + CONTRACT section Secret classes; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/.memlog.md:92; _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'What it does'
- [done] P1 — Enforce scoped, single-use write tokens for landing — Landing mints a repo-scoped write token, uses it once, and revokes it in a finally block; failure paths hand out no write credential (spine AD-9).
Ref: built: platform/src/land.ts; source: _bmad-output/brainstorming/brainstorm-next-git-platform-2026-10-02/brainstorm-pitch.md section 'Why this is buildable' (scoped tokens)
- [done] P1 — Consume Artifacts events over Queues into a live feed — Queue consumer records Artifacts push/fork/create events and exposes the newest 50 via GET /events. The event feed is a hint surface for the UI and automation.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Events (L16); built: platform/src/index.ts:1-3, platform/CONTRACT.md §/events
- [done] P1 — Surface commit intent via git-notes mirror refs — Agent intent is read from a branch mirroring refs/notes (the Artifacts binding cannot resolve refs/notes directly, measured) and surfaced on change-sets; fallback NEXTGIT_INTENT/<sha>.txt on that branch. Intent travels with commits as git notes.
Ref: _bmad-output/planning-artifacts/research/technical-next-gen-git-platform-on-cloudflare-2026-10-02/imports/artifacts-recon-brief.md Best practices git notes (L20); built: platform/src/index.ts NOTES_REF (L29), platform/CONTRACT.md §Notes mirror
- [done] P1 — Land UX semantics: two-state confirm, per-card hide, collapse — The land control is a two-state button ('Land into demo' → 'confirm land?'), hidden on empty proposals; landed cards collapse to 'landed — nothing pending'. These semantics surfaced during the live fire and are the shipped interaction contract.
Ref: platform/ui/app.js:487-517; session history 2026-10-04T12:34 ('confirm land? appears as the button's second state')
- [done] P1 — Tour deployed: 10-step interactive walkthrough with 4 sims — Answers John's request for an in-depth JS interactive tutorial: /tour.html walks a newcomer through what this is, a GitHub-view vs fleet-view toggle, workspace provisioning, and a collision sim ('try to ship both'), ending with a live-data step fed by real proposals. Browser-verified.
Ref: platform/ui/tour.html; platform/ui/tour.js; platform/ui/tour.css; docs/BUILD-LOG.md:7; session history 2026-10-05T09:38 (tutorial request)
- [done] P1 — Two-command reproducible demo (seed + real agents) — seed.mjs resets to baseline with scripted proposals; agents.mjs is scripted; real-agents.mjs drives real CLI agents; land.mjs lands or refuses. Reproducible two-command demo: `node platform/scripts/seed.mjs && node platform/scripts/real-agents.mjs`.
Ref: platform/scripts/{seed,agents,real-agents,land}.mjs; docs/STATE.md:23; docs/BUILD-LOG.md:3-5
- [done] P1 — Heterogeneous real-agent fleet runner (omp + codex verified) — real-agents.mjs runs real CLI agents headlessly; 4/4 real proposals landed from omp + codex with their own intents and a genuine src/auth.ts conflict; the runner survived a failed agent run (degraded-mode iteration and retry). Six CLIs exist on the box (claude, codex, opencode, pi, dsh, gemini).
Ref: platform/scripts/real-agents.mjs; docs/BUILD-LOG.md:4 (wave1); session history 2026-10-04T12:33 ('4/4 REAL agent proposals')
- [done] P1 — Derived queue view + never-hand-edit invariant — docs/NEXT-ACTIONS.md is regenerated by `bun porting/tasks.mjs view` from the DB; nobody hand-edits the queue markdown anymore (kills the multi-agent markdown-collision class outright). The rule is written into the working agreements.
Ref: .omp/agents.md:7 (Task store); porting/tasks.mjs cmdView; docs/NEXT-ACTIONS.md:3 derived header
- [done] P1 — Batch runner reads the SQLite store (authoritative queue source) — wf-batch.ddw.js now reads pending rows from tasks.db via execFileSync (space/metachar-safe, 10 s bound), skips live-claimed rows (claims are the collision guard), and falls back to the derived markdown only on store fault. Heal-aware resume and a loud implement guard landed with it.
Ref: porting/wf-batch.ddw.js:30-57; commit 05f4001; session history 2026-10-06T02:31-02:32
- [done] P2 — Certify bootstrap-health-sweep gates — round-4 BLOCK reports recorded superseded (each predates its own prescribed remedy); deterministic certification pass at HEAD: both cited fail-open inputs → BLOCK, suite 10/10; residue reconciled (no post-commit edits, no fresh reports); evidence: `porting/certifications/bootstrap-health-sweep.md`
- [done] P2 — Landed-state banner (commit sha) + live event feed tick — A successful land shows a banner naming the proposal and the resulting commit sha, and the /events ticker reflects the push in near-real-time — the visible proof that the ship happened server-side.
Ref: platform/ui/app.js:809; platform/src/index.ts:853; session history 2026-10-04T12:36 ('repo.pushed demo da120ab256')
- [done] P2 — NextGit brand + subtitle across the UI — The app is renamed NextGit with the subtitle 'your agents' work, all in one place'; a 'Start the tour' link plus '?' help link sit on the main page. Resolves the in-session naming confusion (convergence vs NextGit).
Ref: platform/ui/index.html; docs/BUILD-LOG.md:7 (deploy ab7d503b); session history 2026-10-05T09:38 (naming confusion)
- [done] P2 — Subagent model routing pinned to a live provider (spawn outage fix) — All 16 subagent types were pinned to dead commandcode/stealth/space-bunny-alpha:max endpoints — every spawn failed, blocking new work orders. Redirected all to commandcode/deepseek/deepseek-v4.1-flash:max (the session's working route); live spawn probe green (6.1 s); backup kept. Prevents a repeat of the week's worst outage.
Ref: docs/CHECKPOINT.md:23 (CORRECTIONS #6); session history 2026-10-05T23:50 user msg; commit 16bbbad
- [done] P2 — Deploy pinning policy: lockfile wrangler; Artifacts CLI flag >=4.147 — Deploys use the lockfile-pinned local wrangler (npx wrangler deploy), never @latest. `wrangler artifacts` repo commands exist since 4.92.0; the verified 4.106 vs 4.147 difference is the Artifacts queue-subscription source flag (present on 4.147, absent on 4.106). Last deploy ran on pinned 4.147.0.
Ref: .omp/agents.md:22 (project facts); docs/CHECKPOINT.md:41 (wrangler note); session history 2026-10-06T02:18 (deployed on pinned 4.147.0)
- [done] P2 — Pre-commit freshness enforcement re-armed repo-locally + proven — The bootstrap pre-commit freshness hook had never executed: global core.hooksPath (~/.githooks) shadowed .git/hooks. Re-armed repo-locally (core.hooksPath=.git/hooks) with the global commit-msg stripper copied in — no global edits; enforcement proven by a deliberately blocked stale-index commit.
Ref: docs/CHECKPOINT.md:24 (CORRECTIONS #7); commit 7ca477b; session history 2026-10-06T02:27-02:29
- [done] P2 — Workflow v3 self-test (specialist routing) — Machinery-only self-test: five-check battery through runner v3 specialist routing; GREEN 0 heals; found 3 routing defects → v3.1.
- [done] P2 — Agent-skill mapping (10 comparators, top-3 packs wired) — Rate skills 1-5 per routed agent; wire packs into runner SKILL_HINTS + .omp/agents.md; document aliases + plugin-cache paths.
- [done] P3 — Bootstrap health sweep — first loop order: 4/4 checks green across 5+ independent reproductions; gates caught real findings (NUL injection, fictional jaq guard, two fail-opens, heal-budget bug, citation rot); all gate-required caller remedies applied (runner committed `d5f6b5b`, fail-closed, 10-case test); stale gate reports certified superseded (`porting/certifications/bootstrap-health-sweep.md`); evidence: `porting/runs/bootstrap-health-sweep/`
- [partial] P0 — UX spec for the triage surface (bmad-ux) — canvas review flow, judge chips, land flow, recording needs; acceptance: DESIGN/EXPERIENCE docs exist and the video storyboard cites them

Grammar: `- [status] Pn — title`. Statuses: `pending|done|remediated|blocked|partial`.
