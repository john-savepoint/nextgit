# Cloud-Native Development Environments - Reconnaissance Brief

**Scope:** Prior art, technology, feasibility, and Cloudflare primitive mapping for a "work directly from the platform" dev environment. Read-only web research. Date: 2026-10-02.

---

## 1. Landscape of Cloud Development Environments

### Human-Centric CDEs

| Platform | Model | Pricing/Quotas | Adoption / Status | Known Limits |
|---|---|---|---|---|
| **GitHub Codespaces** | Devcontainer-backed VM in Azure, VS Code/Web/CLI | Personal free: 120 hrs compute + 15 GB-mo storage; orgs billed per use (vCPU-hr + storage) | Dominant; widely adopted | Cold starts; compute-hour caps; slow clone on large repos; no offline; egress-locked |
| **Coder** | Open-source (AGPL) self-hosted workspace orchestrator; K8s or Docker; devcontainer-compatible | Free self-hosted; enterprise license | 16.7k stars, active; partners with Cursor for self-hosted cloud agents | Self-managed infra burden; needs K8s or Docker cluster |
| **Gitpod -> Ona** | Cloud-hosted dev environments; rebranded Sep 2025 to AI agent platform | Freemium then usage | Gitpod Classic sunset Oct 15 2025; acquired by OpenAI Jun 2026 to run Codex agents in customer clouds | Original product dead; now OpenAI-internal Codex infra |
| **DevPod** | Open-source devcontainer-compatible; Docker/K8s; local+remote | Free | Lighter alternative to Coder; no managed cloud | Less mature orchestration |
| **Replit** | Browser IDE + Agent + deploy; full platform workspace | Starter free; Core ~0/mo; Pro ~00/mo (10 parallel agents) | High Agent usage; effort-based AI pricing caused cost surprises (single builds -> tens of $) | Agent cost unpredictability; vendor lock-in; GPU limited |
| **StackBlitz / WebContainers / Bolt** | WebAssembly micro-OS in browser (Node.js); Bolt.new builds on it | Freemium; Bolt Pro | Bolt is "first professional vibe coding tool" | **Node.js only** (WASM sandbox); no native binaries/modules; no GPU; no filesystem persistence beyond browser storage; no offline for full features; polyfilled syscalls |
| **JetBrains Gateway / Fleet** | Thin client -> remote backend (SSH, VM, devcontainer) | License + infra | devcontainer.json support tracked as IJPL-65918 (partial) | Remote dev historically "afterthought" vs VS Code; Fleet is separate IDE |
| **VS Code Remote / Tunnels / devcontainers spec** | Open spec for containerized dev envs; VS Code, Coder, GitHub implement | Free spec | Dominant open standard; workspaceMount, features, forwardPorts, custom Dockerfiles | Fragmented IDE support; JetBrains partial |
| **code-server / openvscode-server / Eclipse Theia** | VS Code (or Theia) running in browser on remote server | Free/self-hosted | Widely used for bring-your-own-server web IDEs | Manual provisioning; no managed lifecycle |

### Failure Modes & Limits (cross-cutting)

- **Latency:** Cloud editing adds 50-150ms round-trip; typing latency >100ms is noticeable. IDE responsiveness degrades on high-latency links.
- **Cost:** Cloud compute for always-on workstations is expensive; Codespaces free quota exhausted quickly in orgs; cloud agent cost surprises (Replit, Cursor).
- **Offline:** Pure cloud CDEs (Codespaces, Coder-hosted, Gitpod) fail without connectivity. WebContainers work offline but are limited.
- **Large-repo performance:** Full clone of monorepo/game repo is slow. Partial clone, sparse checkout, or lazy FS needed.
- **Lock-in:** Proprietary workspace configs; hard to migrate between CDEs.

---

## 2. Agent-Native Development Environments

### Platforms and Workspace Provisioning

| Platform | Agent Workspace Model | Sandbox/Isolation | Human Review/Supervision |
|---|---|---|---|
| **Cursor Cloud Agents** | One isolated VM per agent; full desktop environment (computer use: mouse+keyboard+browser); multi-repo environments; Builds for fast startup; Snapshots; Artifacts (screenshots/videos/logs) | VM per agent (Linux + macOS workers); egress restricted; Tailscale/private net; OIDC metadata socket | Kanban in cursor.com/agents; remote desktop takeover/handoff; MCP tools; PR artifacts; subscriptions (GitHub/Slack/Linear/timers) |
| **Devin / Devin Desktop** | ACP-compatible agent host; runs Claude Agent, Codex, OpenCode, in-house agents; long-running with organizational context | Desktop-class; Harvey rebuilt Devin pricing Apr 2026 (Free/Pro/Max/Teams/Enterprise) | Kanban view; desktop per agent |
| **OpenAI Codex Cloud** | Isolated cloud workspaces; worktrees; reusable cloud environments follow developer across device (Sep 2026 relaunch); ona acquisition runs Codex in customer's own cloud | Sandboxed containers; self-hosted sandbox option | Cloud Tasks in IDE; limits/always-on options |
| **Claude Code Web** | Fresh Ubuntu 24.04 x86_64 VM per session; cloud environments configure network (None/Trusted/Full/Custom), env vars, setup scripts, API credentials; gVisor container isolation; GitHub proxy; security proxy; per-session ephemeral FS | gVisor (default; memory-safe userspace kernel, nvproxy for GPU), Firecracker, Docker available | claude.ai/code web UI, Desktop, mobile, CLI; transcripts; Remote Control bridges to local machine; self-hosted environments; Cloud Sandboxes on Platform API |
| **OpenHands** | Open-source agent platform; Agent Canvas + SDK; ACP support for any coding agent; cloud/CLI/enterprise | Configurable sandboxes | Canvas UI for multi-agent |
| **Daytona** | "Full composable computers" - stateful sandboxes with dedicated kernel/FS/network; 90ms creation; pause and fork (microVM); snapshots for persistence; unlimited persistence; OCI/Docker compatible | Firecracker microVM per sandbox (strong isolation, own kernel) | Programmatic SDK/API/CLI; persistent agent operations across sessions; first-native cloud for AI agents |

### Emerging "Agent Workspace" Patterns

1. **Per-task VM sandbox** (Firecracker/gVisor/Docker): Cursor, Claude Code, E2B, Daytona. Ephemeral or snapshotted.
2. **Worktree isolation** (Codex): cheap parallel branches per task.
3. **Desktop/computer-use** (Cursor): agent drives built app in browser to verify.
4. **Event subscriptions** (Cursor): agent waits on GitHub/Slack/timers, wakes to continue.
5. **Snapshot / pause / resume** (Daytona, CF Sandbox, Firecracker): freeze idle VM, restore <200ms; critical for cost.
6. **Stateful persistent sandboxes** (Daytona, Coder): long-running agent workspace with memory.
7. **Multi-root / multi-repo** (Cursor): agent reasons across repos.
8. **Human co-presence:** remote desktop handoff (Cursor), transcript review (Claude Code, Cursor), Kanban (Devin).

### Sandbox Isolation Tiers (2026 standard)

- **Containers (shared kernel):** cheap but CVE escape risk (NVescape CVE-2025-23266 CVSS 9.0).
- **gVisor (userspace kernel, syscall interception):** memory-safe, lower compat, higher per-call overhead; GPU via nvproxy. Used by Anthropic, GKE.
- **Firecracker microVM:** own kernel, KVM, ~125ms boot, snapshot restore <200ms; **no GPU**. Used by Lambda, Daytona (for non-GPU), CF Workers Builds.
- **QEMU / cloud-hypervisor (VFIO GPU passthrough):** full GPU, larger codebase; cloud-hypervisor written in Rust (rust-vmm), supports vhost-user-net/blk. CF evaluating.

---

## 3. Local-Dev Reality Checks and Hybrid Models

### Why Local Persists

- **Latency:** local editing <1ms; cloud round-trip 50-150ms. Compiling, linting, indexing all degrade.
- **GPU / peripherals:** game dev (Unreal Editor, shader compilation, console dev kits), ML training, VR, USB/serial. Cloud GPU is expensive and high-latency to attach.
- **Offline:** travel, secure enclaves, unreliable networks.
- **Privacy / compliance:** regulated code (defense, health) cannot leave premises.
- **Cost:** always-on cloud workstation is expensive; free local.
- **IDE preference:** JetBrains, Vim/Neovim, Emacs users resist browser/VS Code lock-in.

### Remote-Dev + Local Sync Models

- **VS Code Remote SSH / Tunnels / Dev Containers:** local editor -> remote compute. Best latency balance; local UI, remote toolchain.
- **JetBrains Gateway:** thin client -> remote backend (Projector/Space).
- **Coder + local IDE:** workspace in cloud, IDE on laptop.
- **DevPod:** devcontainer anywhere; local client provisions remote.

### Virtual / Lazy Filesystems for Huge Repos

| FS | Vendor | Model | Notes |
|---|---|---|---|
| **VFSForGit / GVFS** | Microsoft | Virtual FS, placeholders hydrated on demand; 300 GB monorepo | Windows-focused; powered Microsoft's internal monorepo; succeeded by Scalar |
| **EdenFS (Sapling)** | Meta | Virtual FS for Sapling checkouts; on-demand population; process-state tracking | Linux/macOS; OSS |
| **ArtifactFS** | Cloudflare | FUSE daemon (Go) mounts git repos (Artifacts or any git remote) as working trees; blob contents hydrated on-the-fly; prioritizes manifests over binaries; async prep; hydration concurrency; 30-min prep timeout | Beta; pairs with CF Sandbox SDK; ideal for short-lived agent/sandbox envs |
| **Perforce + Git LFS** | Perforce / native | Locking model for binaries; LFS lazy-fetches large blobs | Game industry standard; not git-native |

### Latency Thresholds for Interactive Editing

- **<50ms:** imperceptible (Cloudflare claims 50ms to 95% of internet-connected population).
- **50-100ms:** tolerable for most; slight feel of lag.
- **>100ms:** noticeable typing delay; frustrating for fast typists.
- **>200ms:** unusable for real-time editing; OK for dispatch-and-wait agent tasks.
- **Agent tolerance:** agents do not feel latency the way humans do; 1-5s API round-trips are fine.

### Game Repos (target domain)

Game repos are large (100s GB-TB): binaries (textures, audio, meshes) dominate. Git LFS / Perforce standard. Full clone prohibitive. Lazy/hydration FS (ArtifactFS, EdenFS) + partial clone + locking (Perforce model, covered in BigAssetsRecon) are mandatory. Cloud CDEs that force full clone (naive Codespaces) fail here.

---

## 4. Cloudflare Primitive Mapping (Verified)

### Can Cloudflare Host Dev Environments? **YES** - proven by VibeSDK reference architecture

| Primitive | Dev-Env Role | Verified Specs / Limits | Source |
|---|---|---|---|
| **Containers** | Full Linux dev environment per user/session; any language; long-running processes | linux/amd64 only; instance types lite (1/16 vCPU, 256 MiB, 2 GB) -> standard-4 (4 vCPU, 12 GiB RAM, 20 GiB disk); custom types up to same max; concurrent per account: 6 TiB mem / 1500 vCPU / 30 TB disk / 50 GB image storage; snapshots 20 GB / 30-day TTL; scheduling: default, durable_object (public beta), off-peak | CF Containers limits docs |
| **Sandbox SDK** | Programmatic dev env / agent sandbox; per-session container + Worker lifecycle | Built on Containers;  1.0; exec(), readFile(), writeFile(), startProcess(), exposePort(); mount R2 buckets; Dynamic Workers (JS/Python/WASM) alternative; RPC transport to bypass 1000-subrequest limit; coding agent examples (Claude Code, Codex, Devin); sleep timeouts; heartbeat | CF Sandbox SDK docs |
| **Durable Objects** | Session identity and coordination; keep workspace alive across requests; alarms for heartbeat/pause/resume; DO scheduling policy boots container | Standard DO limits (concurrency, wall time); SQLite storage; alarms | CF Durable Objects docs |
| **Workers** | Preview proxy / routing / auth / anycast ingress; Workers Builds (off-peak CI/CD); AI Gateway | Standard Workers limits; global anycast; subrequest limits matter for SDK (use RPC) | CF Workers docs |
| **Artifacts** | Versioned project storage; one repo per user/session/task; Git-compatible; event subscriptions via Queues | Workers Paid only; pricing from Oct 14 2026: first 10k ops/mo + .15/1k; first 1 GB-mo + .50/GB-mo; event subscriptions (lifecycle hooks) | CF Artifacts pricing docs |
| **ArtifactFS** | Mount large repos fast in sandboxes/agents; lazy hydration; no full-clone wait | Beta; FUSE daemon (Go); Linux + macFUSE; mounts Artifact repos or any git remote; prioritizes code/manifests; hydration concurrency (default 4); 30-min prep timeout; async prep; overlay for dirty writes | cloudflare/artifact-fs GitHub repo |
| **R2** | Blob storage for images, templates, LFS objects, container layers | No egress to many regions; unlimited storage; used by CF container image registry | CF R2 docs |

### Absence / Presence Matrix (verified)

| Capability | Present? | Detail |
|---|---|---|
| Linux containers | YES | linux/amd64 only, own VM/kernel |
| GPU in customer workloads | **UNVERIFIED** | CF's container platform has GPUs (used internally for Workers AI, Browser Rendering), but no productized GPU passthrough for customer containers yet. gVisor GPU via nvproxy works internally; cloud-hypervisor (VFIO) being evaluated. WebGPU is accessible from Durable Objects (experimental). |
| Windows | **ABSENT** | No Windows containers; no Windows server instances. linux/amd64 mandatory. |
| macOS | **ABSENT** | No macOS VMs/containers. No Apple hardware in CF network. |
| GPU passthrough (VFIO) | Evaluated (cloud-hypervisor) | Not yet customer-facing |
| GPU in Sandbox SDK | NO | Sandbox containers are microVMs without GPU |

### What Must Federate to Other Infra

- **GPU workloads:** game shader compilation, ML training, rendering -> federate to GPU cloud or self-hosted GPU rigs accessed via Tailscale.
- **Windows / macOS:** game console SDKs (PS5/Xbox require Windows), iOS/macOS builds -> federate to MacStadium, GitHub macOS runners, AWS EC2 Mac, on-prem Mac minis.
- **High memory (>12 GiB) / large disk (>20 GiB):** single-container limits -> split work across containers or federate to larger VMs elsewhere.
- **Proprietary peripherals:** dev kits, USB/serial, VR headsets -> local machine with remote attach.
- **Always-on heavy compute:** off-peak CF Containers help, but sustained high-CPU cheaper elsewhere for non-latency-sensitive batch.

---

## 5. Precedent for "The Platform Is the Workspace"

### Cloudflare Artifacts as Project Store (verified)

Cloudflare's VibeSDK blog (Sep 2025) explicitly frames vibe-coding platforms as storing user projects in Artifacts/Sandbox SDK. VibeSDK's architecture: Sandbox SDK per user session -> AI generates code -> sandbox preview -> Workers for Platforms deploys. Templates in R2. The project storage layer is Artifacts (implied; "one-click project export to user's Cloudflare account or GitHub").

Cloudflare's Artifacts landing page uses cases: "Storing versioned file trees instead of raw blobs; Powering a platform that needs to store and version customer code or projects at scale; Tracking agent sessions and history in separate repositories or branches; Forking sessions from a shared baseline."

### Other Platform-Hosted Workspace Precedents

| Platform | Model | Status |
|---|---|---|
| **Firebase Studio / Project IDX** | Google Cloud dev workspace; Code OSS-based; Nix-based dev.nix config; up to 30 workspaces; Gemini-integrated | **SUNSETTING Mar 22, 2027**; new signups disabled Jun 22 2026; migrate to Google AI Studio or "Antigravity" - **cautionary precedent** |
| **Replit** | Full browser IDE + agent + deploy; project lives entirely on Replit | Active; Agent 3 with effort-based pricing |
| **Bolt Cloud** | Built-in hosting + SEO + custom domains per project | Active vibe-coding |
| **GitHub Codespaces** | Widely adopted; hard public stats | Dominant cloud CDE |

### Caution: Firebase Studio Sunset

Google built a credible cloud workspace (Project IDX, then Firebase Studio) and is shutting it in 9 months. Key lesson: cloud workspace platforms require sustained investment and ecosystem lock-in to survive. For our competition submission, emphasize that the Cloudflare stack (Workers + Artifacts + Sandbox SDK) is *composable* - avoids single-product sunsetting risk.

---

## 6. Requirements + Open Questions for a Platform-Native Workspace Model

### Workspace Lifecycle

| Phase | Cloudflare Mechanism | Open Question |
|---|---|---|
| **Create** | Worker provisions Container via DO or Sandbox SDK; ArtifactFS mounts repo; DO identity binds workspace | Cold-start latency: Container boot ~seconds (prewarmed Firecracker <10s; snapshot <200ms). Target: <5s workspace ready. |
| **Pause** | Container idle -> snapshot -> VM reclaimed; DO alarm can force sleep | Auto-pause threshold? Cursor pauses after "few minutes." |
| **Resume** | Restore snapshot <200ms; or fresh mount + ArtifactFS hydration | State integrity across pause: dirty overlay (ArtifactFS overlay_dirty) must persist. |
| **GC** | Explicit delete (Artifacts); snapshots TTL 30 days; no auto-GC of DOs | How long to keep abandoned workspaces? Cost accumulator. |

### Bidirectional Sync Semantics (local client <-> platform)

- **Direction 1 (platform -> local):** ArtifactFS can mount platform repos locally (FUSE). isomorphic-git + git remote protocol (Artifacts speaks git). Standard git pull works.
- **Direction 2 (local -> platform):** Push via git protocol to Artifacts; Workers Builds auto-deploy on push.
- **Conflict model:** Git's native merge; Perforce-style locks for binaries (BigAssetsRecon). CRDTs for real-time co-editing (out of v1 scope).
- **Open question:** Can ArtifactFS run on the laptop to give a local FS view backed by platform hydration? (OSS daemon exists; laptop packaging TBD.)

### Offline Mode

- **Fundamental tension:** cloud workspace = needs network. WebContainers-style WASM-in-browser works offline but is Node.js-only.
- **Mitigation:** local-first git clone + periodic sync to platform; platform does agent work when online, queues for when client reconnects. CRDT (Automerge, Yjs) for offline edit-then-merge.
- **Open question:** Is offline a v1 requirement, or v2? For a competition demo, online-first with graceful degradation is defensible.

### Identity / Permissions per Workspace

- DO identity = workspace identity. Cloudflare Access / WAF / per-route auth at Worker layer.
- Per-workspace secrets: env vars in Cloudflare secrets; DO storage; NOT env vars visible to others.
- Multi-tenant: one Workspace DO per user/session/task; scoped to account namespace.
- Open question: org/workspace hierarchy (Replit Teams, Cursor Teams) and SSO/SAML - federate to CF Access.

### Cost Model of Always-On Workspaces

- **Containers:** billed per compute time. Always-on 4 vCPU/12 GiB = continuous compute -> expensive. Mitigations: pause/snapshot when idle (sleep timeouts), off-peak scheduling, "lite" instance types for idle warm standby.
- **DOs:** cheap when idle (only storage); wake on request.
- **Artifacts:** .50/GB-mo + ops. Millions of repos -> significant at scale; event subscriptions add Queue costs.
- **Sandbox SDK subrequests:** RPC transport mitigates; still need to bound ops/session.
- **Open question:** can we make an "always-on" workspace free-tier-viable via aggressive sleep + ArtifactFS + DO wake? Likely yes for light dev; no for heavy builds.

### Human + Agent Co-Presence in One Workspace

- **Cursor model:** one VM, remote desktop handoff between human and agent. Human can take back control.
- **Claude Code model:** cloud session VM; human dispatches tasks via UI; agent works; human reviews transcript/PR.
- **Daytona model:** stateful sandbox; both interact via SDK.
- **For a git-native platform:** the workspace is a repo branch; human edits locally/UI; agent works on same or forked branch; merge/PR reconciles. DO provides coordination (lock status, "agent working" flag).
- **Open question:** real-time co-editing (both typing at once) vs. async (human pauses while agent runs)? Async is far simpler and safer.

### Local Interop (CLI, Git Remote Compatibility, Editor Attach)

- **CLI:** wrangler for Workers/Containers; ArtifactFS CLI (artifact-fs daemon); Sandbox SDK programmatic.
- **Git remote compatibility:** Artifacts speaks git - standard git clone/push works; Workers Builds auto-deploy on push.
- **Editor attach:** VS Code Remote -> Container (via devcontainer spec or SSH); code-server running inside a Container (doable; not productized). Coder model: local IDE <-> remote workspace via agent protocol.
- **Open question:** is a web IDE (Theia/code-server hosted in a Container proxied by Worker) required for competition? Or is "git remote + your own IDE" sufficient?

### Summary of Key Open Questions for Architecture

1. **Cold-start latency target** - prewarm + snapshot + ArtifactFS to hit <5s.
2. **Offline strategy** - online-only v1, or CRDT/local-first v2?
3. **GPU/Windows/macOS gap** - federate via Tailscale to self-hosted runners; be honest in submission.
4. **Always-on cost** - DO + sleep/snapshot to keep warm standby cheap.
5. **Human+agent co-presence model** - async branch-based (git-native) vs. real-time desktop handoff.
6. **Binary/locking assets** - Perforce model (BigAssetsRecon) integrated or federated?
7. **Workspace hierarchy and identity** - flat per-session DOs vs. org/workspace tree.
8. **Web IDE requirement** - hosted Theia in Container (stronger demo) vs. git remote + local IDE (pragmatic).

---

## Sources

- Cloudflare Sandbox SDK: https://developers.cloudflare.com/sandbox/
- Cloudflare Containers limits: https://developers.cloudflare.com/containers/platform/limits/
- Cloudflare ArtifactFS: https://github.com/cloudflare/artifact-fs
- Cloudflare Artifacts: https://developers.cloudflare.com/artifacts/ + pricing: https://developers.cloudflare.com/artifacts/platform/pricing/
- Cloudflare VibeSDK blog: https://blog.cloudflare.com/deploy-your-own-ai-vibe-coding-platform/
- Cloudflare Container Platform (GPUs): https://blog.cloudflare.com/container-platform-preview/
- Cloudflare WebGPU in DOs: https://developers.cloudflare.com/durable-objects/api/webgpu/
- Cursor Cloud Agents: https://cursor.com/docs/cloud-agent/, https://cursor.com/docs/cloud-agent/capabilities
- Cursor + Coder partnership: https://coder.com/partners/cursor
- Claude Code Web: https://code.claude.com/docs/en/cloud-environments
- Anthropic sandboxing: https://www.anthropic.com/engineering/claude-code-sandboxing
- OpenAI Codex: https://developers.openai.com/codex/ide/cloud-tasks
- OpenAI acquires Ona (ex-Gitpod): https://thenextweb.com/news/openai-acquires-ona-codex
- Daytona: https://www.daytona.io/, https://www.daytona.io/docs/en/
- Coder: https://coder.com/, https://github.com/coder/coder
- GitHub Codespaces billing: https://docs.github.com/en/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces
- Firebase Studio (sunsetting): https://firebase.google.com/docs/studio/
- EdenFS: https://github.com/facebook/sapling/tree/main/eden/fs/docs
- VFSForGit/GVFS: https://github.com/microsoft/vfsforgit
- WebContainers/Bolt: https://webcontainers.io/
- Replit pricing: https://replit.com/pricing
- Devcontainers spec: https://github.com/devcontainers/spec
- MicroVM isolation 2026: https://emirb.github.io/blog/microvm-2026
- Best AI coding agents 2026: https://coursiv.io/blog/best-ai-agents-for-coding-2026
