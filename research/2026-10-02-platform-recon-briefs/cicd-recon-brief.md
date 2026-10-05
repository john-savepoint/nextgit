# CI/CD Recon Brief: Agent-Native Platform on Cloudflare

> Generated: 2026-10-02 | Sources inline, UNVERIFIED flags where confirmation incomplete

---

## 1. GitHub Actions — The Incumbent to Replace

### Triggers & Events
GitHub Actions responds to 30+ event types: `push`, `pull_request`, `schedule`, `workflow_dispatch`, `repository_dispatch`, and issue/PR/comment events. Composite events via `workflow_run` enable pipeline chaining. [Source](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)

### Runners
- **Hosted runners**: Linux (x64), Windows, macOS (x64, arm64); GitHub Enterprise adds larger runners up to 64-core / 256 GB RAM. GPU runners available (max 100 concurrent at Enterprise). [Source](https://docs.github.com/en/actions/reference/limits)
- **Self-hosted runners**: 10,000 per runner group; per-repo/org/enterprise registration. Max 5 days job execution, 24-hour queue. Required for custom hardware, on-prem devkits, or private networks. [Source](https://docs.github.com/en/actions/reference/limits)

### Concurrency & Queue Limits
- **Queue**: 1500 events / 10s / repo; 500 workflow runs / 10s; concurrency group queue up to 100 (with `queue: max`). [Source](https://docs.github.com/en/actions/reference/limits)
- **Job concurrency**: Free 20, Team 60, Enterprise 500, Larger runner 1000. [Source](https://docs.github.com/en/actions/reference/limits)

### Caching & Artifacts
- Cache: 10 GB/repo, LRU eviction; 200 uploads/min, 1500 downloads/min. [Source](https://docs.github.com/en/actions/reference/limits)
- Artifacts: plan-tiered storage (500 MB Free → 50 GB Enterprise); billed hourly on hosted runners. [Source](https://docs.github.com/en/actions/reference/limits)

### Secrets & OIDC
- Encrypted secrets at repo/org/env scope; 1000 per repo. `GITHUB_TOKEN` auto-provisioned with scoped permissions. OIDC support for cloud provider federation (AWS, Azure, GCP, Vault). [Source](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect)

### Pain Points at Scale
- **Queue congestion**: no real-time runner autoscaling for bursty monorepo fan-out; concurrency groups help but are manual.
- **Cold starts**: ~30-60s runner provisioning; Docker image pulls dominate. Larger runners worsen this.
- **Cost model**: $0.008/min Linux, $0.016 Windows, $0.08 macOS (x64); per-minute self-hosted runner billing introduced March 2026 ($0.002/min). [Source](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions)
- **Supply-chain risk**: 2025-2026 high-profile attacks (tj-actions changed-files exfiltration, Cimon-detected egress). 2026 security roadmap adds native egress firewall, dependency locking, scoped secrets. [Source](https://github.com/orgs/community/discussions/190621)
- **Matrix**: max 256 jobs/workflow; reusable workflows max 10 nested depth (Nov 2025). [Source](https://github.blog/changelog/2025-11-06-new-releases-for-github-actions-november-2025)

---

## 2. Cloudflare CI/CD + Execution Primitives

### Workers Builds (@cloudflare/ci SDK)
Git-integrated CI: push → build → deploy. Integrates with GitHub, GitLab, **Cloudflare Artifacts**. [Source](https://developers.cloudflare.com/workers/ci-cd/builds)

| Metric | Free | Paid |
|---|---|---|
| Build minutes | 3,000/mo | 6,000/mo (+$0.005/min) |
| Concurrent builds | 1 | 6 |
| Build timeout | 20 min | 20 min |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 8 GB | 8 GB |
| Disk | 20 GB | 20 GB |

**Deploy Hooks**: 10/min per Worker, 100/min per account. [Source](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)

**Build Caching**: npm/yarn/pnpm/bun global dirs + framework caches (Next.js, Astro, etc.). 10 GB/project, 7-day LRU. [Source](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/)

### @cloudflare/ci SDK (Dynamic Workflows)
Blog announcement: "Run CI/CD for millions of repos on Cloudflare." Built on Workflows. Accepts `artifact push` events from Artifacts. **This is the key SDK for multi-tenant CI on Cloudflare** — replaces monolithic CI runners with per-repo Workflow instances. [Source](https://blog.cloudflare.com/ci-workflows/)

Dynamic Workflows (`@cloudflare/dynamic-workflows`) enables per-tenant/per-agent Workflow definitions loaded at runtime — one Workflow per tenant, agent, or user-defined plan. The dispatcher tags every `create()` with a tenant id. [Source](https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows)

### Workflows (Durable Execution)
- Per-step CPU: 10 ms Free / 30s default Paid (configurable to 5 min). Wall time **unlimited** per step (waits on I/O don't count). [Source](https://developers.cloudflare.com/workflows/reference/limits/)
- **Steps**: 1,024 Free / 10,000 default Paid (up to 25,000). `step.sleep` up to 365 days doesn't count toward step limit.
- **Concurrent instances**: 100 Free / 50,000 Paid. `waiting` instances don't count toward concurrency.
- **Payload/state**: 1 MiB event/step result; 100 MB Free / 1 GB Paid persisted state per instance.
- **Subrequests**: 50 Free / 10,000 default Paid (up to 10M).
- **Retention**: 3 days Free / 30 days Paid.
- **Pricing** (Workers Paid, from Aug 2026): 10M requests/mo included + $0.30/million; 30M CPU-ms included + $0.02/million; 1 GB-mo included + $0.20/GB-mo; 500K steps included + $0.80/100K. [Source](https://developers.cloudflare.com/workflows/reference/pricing/)

### Sandbox SDK + Containers
- **Runtime**: Linux containers (not V8 isolates) — isolated, custom Dockerfiles, Python/Node pre-installed. Supports `pip`, `npm`, `apt-get` at runtime.
- **Languages**: Python, JavaScript, TypeScript (via interpreter API); any binary via container image. **No GPU support.** No Windows/macOS.
- **Instance types**: lite (1/16 vCPU, 256 MiB) → standard-4 (4 vCPU, 12 GiB, 20 GB disk). Custom instances 1-4 vCPU, max 12 GiB/20 GB disk.
- **Account limits**: 6 TiB concurrent memory, 1,500 concurrent vCPU, 30 TB disk. [Source](https://developers.cloudflare.com/containers/platform/limits/)
- **Pricing**: Workers Paid includes 25 GiB-hr memory, 375 vCPU-min, 200 GB-hr disk. Then +$0.0000025/GiB-sec, +$0.000020/vCPU-sec, +$0.00000007/GB-sec disk. [Source](https://developers.cloudflare.com/containers/platform/pricing/)
- **Transport**: HTTP (each op = subrequest) or RPC (single persistent conn). RPC recommended for high-frequency ops to avoid subrequest limits. [Source](https://developers.cloudflare.com/sandbox/sdk/platform/limits/)

### Workers (V8 Isolates) — Hard Limits
- **CPU time**: 10 ms Free / 30s default Paid (configurable to 5 min). **CPU time = active compute only**; wall-clock can be unlimited while streaming.
- **Memory**: 128 MB per isolate (fixed). Includes JS heap + WASM.
- **Worker size**: 64 MiB uncompressed.
- **Startup**: 1 second max. **No cold starts** — V8 isolates pre-bundled globally.
- **No GPU, no Windows, no macOS.** Linux x64/arm64 only. [Source](https://developers.cloudflare.com/workers/platform/limits/)

### Queues
- Message size: 128 KB. Throughput: 5,000 msg/sec/queue. Backlog: 25 GB/queue. Retention: up to 14 days (24h Free).
- Consumer: 15 min wall-clock, CPU configurable to 5 min. Concurrent consumer invocations: 250 (push-based). [Source](https://developers.cloudflare.com/queues/platform/limits/)

### Artifacts Integration
Workers Builds can deploy directly from Artifacts repos (Git-compatible storage). Pushes to `main` → production deploy; preview branches → Preview URL. Event-driven: `artifact push` → Workers Build. [Source](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/)

---

## 3. Next-Gen CI Landscape

### CI-as-Code & Container-Native
**Dagger** — CI/CD as code (Go/TypeScript/Python/CUE). Pipeline defined as DAG of containerized actions; runs anywhere (local, GitHub Actions, CircleCI, self-hosted). Key fix vs Actions: **hermetic, reproducible builds** — same pipeline runs in dev and CI. Partnership with Depot for managed runners. [Source](https://docs.dagger.io/getting-started/ci-integrations/github-actions) [Source](https://dagger.io/blog/dagger-and-depot/)

**Depot** — Remote container build service + GitHub Actions runners. Caches Docker layers in dedicated infrastructure; builds up to 40x faster than vanilla. `depot` CLI injects into existing workflows. Also offers Depot CI (GA March 2026) — managed GitHub Actions runners with accelerated Docker layer caching. [Source](https://depot.dev/blog/now-available-depot-ci)

### Fast Runners (Linux-focused)
**Blacksmith** — Bare-metal GitHub Actions runners. 2x faster, half price of hosted. macOS (M2 ARM) support. Unlimited cache storage. Per-second billing, no 1-min minimum. `one-label` migration. [Source](https://docs.blacksmith.sh/blacksmith-runners/overview)

**Namespace** — ARM + x64 runners. Top single-thread CPU perf on arm64. Unlimited cache. [Source](https://github.com/neysofu/awesome-github-actions-runners)

**RunsOn** — Self-hosted runner infrastructure on own AWS account. Full egress control, no intermediary. Competitive on arm64. [Source](https://runs-on.com/alternatives-to/github-actions-runners/)

**BuildJet** — "Gaming CPUs" — high-frequency desktop chips. 4x faster, 2x cheaper claim. Free migration. UNVERIFIED: current status (YC-backed). [Source](https://buildjet.com/ci)

### Self-Hosted / Hybrid
**Actuated** — Runs GitHub Actions on your own infra via microVMs (Firecracker/KVM). Linux only. [Source](https://betterstack.com/community/comparisons/actuated-alternatives/)

### Remote Caching & Hermetic Builds
**Nx Cloud / Turborepo** — Task graph + remote cache (Nx Replay). Cache hit rates 70-85% achievable. **CREEP vulnerability (CVE-2025-36852)** in bucket-based self-hosted caches allows PR actors to poison production — orgs moving to authenticated caches. [Source](https://nx.dev/docs/guides/tasks--caching/self-hosted-caching)

**Bazel RBE** — Remote Build Execution. Content-addressable caching, distributed execution, fine-grained action graphs. Heavy setup but gold standard for large monorepos. [Source](https://bazel.build/remote/caching)

**Nix** — Pure functional package management. Reproducible builds via locked flake inputs + content-addressed store. NixOS packages for CI; `nix develop` gives hermetic dev envs. Steep learning curve but eliminates "works on my machine."

### Merge Queues
**GitHub Merge Queue** — native, speculatively checks PRs in batches against trunk before merge. Prevents broken main.

**Graphite** — Stack-based PRs + merge queue with automatic rebasing. Tracks dependency graphs between PRs. [Source](https://graphite.dev/docs/set-up-merge-queue)

**Bors** (Rust community) — oldest model; batch merging with `rollup`/`try` labels.

**Trunk** — Merge queue with test flake detection, parallelism, GitHub check integration.

### Preview Environments
**Vercel/Netlify** — automatic PR previews with unique URLs; deploys serverless functions. Gold standard for frontend.

**Fly.io** — per-Preview apps with real machines/global distribution. More infra-faithful.

**Okteto** — Kubernetes-native previews; spins up namespaces per PR. [Source](https://www.okteto.com/docs/previews/)

### Wasm-based CI Experiments
WASI 1.0 (2026) provides capability-based isolation — modules cannot make network calls unless granted. Potential for hermetic, sandboxed CI steps. Wasmtime/Cloudflare Workers already WASI-compatible. **Experimental**: no production CI system uses Wasm natively yet; mostly research-stage. [Source](https://tianpan.co/forum/t/webassembly-quietly-reached-41-production-adoption-wasi-1-0-lands-in-2026-and-nobodys-talking-about-it/567)

---

## 4. Game-Dev Build Constraints

### Unreal Engine Pipeline
**UBT (UnrealBuildTool)** — C++ compilation, linking, module dependency graph.
**Cooking** — Converts editor assets to platform-specific formats (texture compression, mesh optimization). Platform-specific (Windows cook for consoles).
**Shader Compilation** — Massive parallel job (thousands of shader permutations). GPU-agnostic but CPU-bound; can take hours.
**Lightbakes (Lightmass)** — CPU/GPU radiosity calculations. Extremely CPU-heavy, memory-bound (32+ GB typical).
**Packaging** — Staging builds, code signing, platform certification checks. [Source](https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine)

### Windows/GPU Requirements
- **Windows required** for cooking, packaging, most console builds (Xbox, PC).
- **GPU required** for shader compilation validation, lightmass GPU mode, rendering tests.
- **Console devkits** (PS5, Xbox Series, Switch) — **on-prem only**, NDAs require physical hardware, not virtualizable. No cloud alternative.

### Perforce + Horde Pattern
**Perforce Helix Core** — Large binary assets (terabytes of textures, meshes, audio). File locking for binary assets (Git LFS doesn't lock).
**Horde** (Epic's build automation) — Distributed compilation, remote execution, agent pooling. Open-source `UnrealBuildAccelerator`. Runs on AWS/on-prem hybrid.
- GDC Vault: "Building Games with Unreal Engine Horde on AWS" shows cloud hybrid for shader compiles, but devkits remain on-prem.
- **Why on-prem farms persist**: devkit NDAs, latency to cloud for huge assets, Windows/GPU hardware needs, Perforce WAN optimization for global studios. [Source](https://dev.epicgames.com/documentation/unreal-engine/horde-build-automation-for-unreal-engine)

### What Can/Cannot Run on Cloudflare
**CAN**: TypeScript/Rust/WASM CI, web game builds, CDN deploy, build orchestration via Workflows, status checks, artifact storage, AST analysis, test selection, fan-out validation.

**CANNOT**: Unreal C++ compilation (no Windows on CF), cooking, shader compilation (no GPU), lightbakes (no sustained 32GB+ CPU), console packaging (no devkits), Windows-native builds.

**Hybrid model required**: Cloudflare for orchestration + fan-out + status + caching + federation; self-hosted Windows/GPU runners for the actual game compilation. Perforce + Horde pattern maps to Cloudflare federation + external runners.

---

## 5. Agent-Native CI Requirements List

| Requirement | Cloudflare Primitive | Gap / Notes |
|---|---|---|
| **Per-proposal validation** (validate each PR/proposal) | Workflows + Dynamic Workflows per-tenant | `artifact push` triggers; Dynamic Workflows gives each proposal its own durable pipeline |
| **Speculative / early execution** (run tests on speculative state) | Workflows with `step.sleep` / event waits | No native speculative state; must push speculative branch to Artifacts and trigger |
| **Incremental AST-aware test selection** | Custom logic in Worker (CPU 5 min max) | Static analysis possible in Worker/Sandbox; no native AST service. Tool like `testless` (TS/Go/Rust) could run in Sandbox. [Source](https://github.com/itaywol/testless) |
| **Fan-out sandboxing of untrusted code** | Sandbox SDK (Containers) | Each agent/sandbox = isolated container. Linux only. RPC transport for perf. |
| **Hermetic / reproducible builds** | Sandbox SDK + pinned Dockerfile images | No native Nix/Bazel. Container images must be pinned manually. |
| **Attestations (evidence of validation)** | Workflow instance state + R2 artifact storage | SLSA-style attestations not native; must build custom (Workflow state → signed metadata in R2). Artifact attestations emerging industry-wide. [Source](https://docs.github.com/en/actions/how-tos/secure-your-work) |
| **Cost governance** | Workflows step/storage pricing + Workers CPU limits | Paid plan 6,000 build minutes included. Sub-second CPU billing possible. |
| **Merge-queue / fleet scheduling** | Custom logic in Workflow + Queues | No native merge queue; Workflow can implement batch validation. Queues for runner fan-out. |
| **Federated self-hosted runners (hybrid)** | No native federation | Must build custom: external runner signals via Queue/HTTP → Workflow waits for completion → status update. Webhooks bridge Cloudflare to on-prem Windows/GPU. |

---

## 6. Open Questions & Risks

### CF Limits vs Real CI Workloads
- **No Windows/GPU/macOS on Cloudflare**: Core constraint. Game-dev builds (Unreal cooking/shaders) cannot run natively. **Mitigation**: federation — Cloudflare orchestrates, external runners execute. Requires reliable webhook bridge + queue for results.
- **Worker CPU 5 min max**: Insufficient for heavy compilation. Sandbox Containers (up to 4 vCPU sustained) better for compute, but still Linux-only.
- **Sandbox no GPU**: Unreal shader compiles / ML model validation impossible without federation.

### Pricing at Scale
- Workflows: 500K steps/mo included; $0.80/100K additional. A busy CI system running 10K builds/mo with 100 steps each = 1M steps → ~$0.40/mo. Reasonable.
- Workers Builds: 6,000 build minutes/mo included; $0.005/min additional. 10K builds × 5 min avg = 50,000 min → $200/mo extra.
- Containers: CPU billed active-use only (good for burst). 1,500 vCPU account limit may constrain massive fan-out.
- **Verdict**: Pricing competitive for orchestration layer; expensive for sustained compute (vs bare metal Blacksmith/Actuated).

### Secrets Model
- Workers: env vars (max 5 KB each), Secrets Store (API), Durable Object storage.
- Sandbox: env injection into containers.
- **No native OIDC-to-self-hosted-runner bridge** for federation. Must manage tokens manually.

### Sandboxing Guarantees
- Sandbox SDK = separate Linux containers, full isolation (fs/mem/net between sandboxes). Same-sandbox processes share.
- **No kernel module loading**; no GPU passthrough. Acceptable for code execution, not for hardware-near workloads.
- RPC transport avoids subrequest limits for high-frequency ops.

### Artifacts Limits
- 1 GB/repo, 32 MB/blob. **32 MB blob limit is restrictive** for game assets / compiled binaries. UNVERIFIED: whether this is per-file or affects game-dev use cases directly; may push large binaries to R2 + Artifacts for metadata only.

### Federation Architecture Risk
- Webhook-based runner integration introduces latency, retry logic, partial failure handling.
- Must implement: idempotency, at-least-once delivery (Queues), runner health checks, cancellation propagation.
- Workflow steps can `step.waitForEvent` for external runner callback — natural fit but requires careful timeout/visibility config.

---

## Key Architectural Insight

The `@cloudflare/ci` SDK + Dynamic Workflows is purpose-built for exactly this use case: multi-tenant CI pipelines on Cloudflare. Combined with Artifacts (Git storage), Workers Builds (build/deploy), Sandbox SDK (untrusted code), and Workflows (durable orchestration), Cloudflare can host the **orchestration, validation, and web-native build** layer for an agent-native platform. The hard boundary is **sustained Windows/GPU compute** — that requires federation to self-hosted runners, which the platform does not natively support but can bridge via webhooks/Queues. Game-dev studios must adopt a hybrid Perforce+Horde-style pattern regardless of CI platform choice due to console devkit constraints.
