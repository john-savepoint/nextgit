# Perforce Helix Core & Game-Industry VCS Landscape — Reconnaissance Brief

> Read-only research for the "Build the Next-Gen Git Platform on Cloudflare" design process.
> Six areas: Helix Core mechanics · Scale & operations · Ecosystem · Game-dev workflow reality · Requirements list · Pricing/market.
> Every claim carries a source URL; **[UNVERIFIED]** marks anything not directly confirmed against an official doc.

---

## 1. Helix Core Mechanics (server now branded "P4")

### Depots
- **Classic depots** — traditional file-versioning namespaces; each depot is a separate file tree under one server. Branching is done by hand with `p4 integrate` across depot paths. [Source: Perforce quickstart planning](https://help.perforce.com/helix-core/quickstart/current/Content/quickstart/admin-plan-deployment.html)
- **Stream depots** — enforce a branching model ("mainline → release → development") with metadata; the server auto-generates workspace Views from the stream spec. A stream is a branch-with-policy. Files inherit parents/children; merges flow "down (copy to less stable) then up (merge into more stable)." [Source: Perforce overview/stream docs](https://help.perforce.com/helix-core/server-apps/p4sag/2024.2/Content/P4SAG/depots.stream.html), [stream chapter (2026.1)](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/P4Guide/chapter.streams.html)
- A server can host multiple depots (classic + stream mixed).

### Workspaces (Client Specs)
- Each user has a **client spec** (workspace) mapping depot paths to local paths, e.g. `//depot/main/... //john-ws/...`.
- Stream clients auto-generate views from the stream.
- Sparse/virtual streams limit the view to a subset (read-only parent + writable child subset).
- `p4 sync`, `p4 submit`, `p4 edit`, `p4 add`, `p4 delete` operate on the workspace.

### Changelists
- The **unit of versioning**. A changelist = {file list, revision numbers, operation per file, description, author}. `p4 submit` commits a changelist atomically; it gets a numeric changelist ID. [Source: Perforce changelist docs](https://help.perforce.com/helix-core/server-apps/p4guide/2024.2/Content/P4Guide/basic-tasks.recurring-other.changelist.html)
- **Shelving** = store an unsubmitted changelist on the server (`p4 shelve`), letting others view/test/review or the owner resume later. Core to Swarm code review. [Source: Helix Swarm overview](https://www.perforce.com/products/helix-swarm)

### File Types (modifiers that matter)
Modifiers are applied to base types (`text`, `binary`, `unicode`, `utf16`, `symlink`, `resource`). Full modifier table lives in [P4 CLI File Type docs](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/file.types.synopsis.modifiers.html):

| Modifier | Effect |
|----------|--------|
| `+l` | **Exclusive open** — only one user can edit the file at a time. The standard binary-artist lock primitive. |
| `+C` | Store **full compressed** version of every revision. Default for binaries and text/Unicode files >10 MB. |
| `+D` | Store **deltas** in RCS format. Pre-2022.1 default for text; now auto-compressed by default. |
| `+F` | Store **full uncompressed** per revision (large binaries, PostScript). |
| `+S` | Keep **only the head** revision; older revisions purged on new submit. For `.obj`, executables. |
| `+Sn` | Keep **only most recent n revisions** (n = 1..10, 16, 32, 64, 128, 256, 512). |
| `+m` | Preserve original modtime. |
| `+X` | Archive trigger required to access. |
| `+k` | RCS keyword expansion (`$Id$`, `$Revision$`, `$DateTime$`, etc.). |
| `+w` | Always writable on client. |
| `+x` | Set execute bit on client. |

- **`binary+l`** — the canonical "artist-locking" type: one editor at a time, full compressed storage.
- **`binary+S`** — head-only binaries (compiled shaders, intermediates) save depot space.
- Type changes via `p4 edit -t` / `p4 reopen -t`; modifier add is partial, removal requires full type spec.

### Why binaries can't be merged, and locking replaces it
- Perforce is a **text-merge engine** (three-way diff/RCS). There is no binary merge semantics: two users who both `p4 edit` a `.png`/`.umap`/`.uasset` cannot auto-combine. The `+l` (exclusive-open) modifier **prevents the second user from opening the file** until the first submits/reverts — it turns a potential overwrite disaster into a queued wait, rather than Git LFS's silent "last-wins on push."
- This is the central reason AAA studios adopt Perforce: for non-mergeable binary assets, locking *prevents* the conflict instead of detecting it post-hoc. [Source: file types doc + Perforce exclusive locking behavior](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/file.types.synopsis.modifiers.html), [support article on exclusive locking behavior (requires login, may not render)](https://portal.perforce.com/s/article/3114)

### Triggers
- **Server-side hooks** (Perl/Python/bash) at transaction points: `change-submit`, `change-commit`, `push-submit`, `push-content`, `edge-submit`, `journal-rotate`, etc. Used for policy enforcement, commit validation, CI gating, notification. [Source: Helix Core Server Admin docs — scripting triggers](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/scripting-triggers-archiving.html)
- **Extensions** (2024.1+) are the newer trigger-like mechanism. [Source: What's New in Helix Core 2024.1](https://www.perforce.com/sites/default/files/pdfs/whats-new-helix-core-2024-1.pdf)

### Permission Model (Protections)
- Granular ACLs via `p4 protect` table. Five access levels: `list`, `read`, `open`, `write`, `super`, `admin`, `review`, `admin`+. Permissions can be set per-user, per-group, **per-depot-path or per-file-path**, per-host (IP address). [Source: P4 Server Administration — Set protections](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/protections.set.html), [Common Permissions article](https://portal.perforce.com/s/article/2490)
- LDAP + SAML/OIDC (via Helix Authentication Service / OpenID Connect). [Source: Perforce auth docs](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/security.authorizing.html)

---

## 2. Scale & Operations

### Global Studio Topology
- **Commit/Master server** — authoritative write source.
- **Edge servers** — regional servers with local write capability; only global admin commands forwarded to master. Reduce cross-ocean latency for studios. [Source: Perforce edge vs forwarding replica article via Assembla](https://get.assembla.com/blog/perforce-edge-server-vs-forwarding-replicas/), [AWS Helix Core deployment guide](https://docs.aws.amazon.com/solutions/building-perforce-helix-core-on-aws/)
- **Forwarding replicas** — read-only replicas that proxy writes to master; also used for build farms. [Source: P4 Server Replication docs](https://ftp.perforce.com/perforce/r19.1/doc/manuals/p4dist/Content/P4Dist/chapter.replication.html)
- **P4 Proxy** — caching proxy for file content (sync/submit acceleration), not metadata. [Source: P4 Proxy (2026.1)](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/chapter.proxy.html)
- Result: hundreds of seats per studio can span continents with local read/write servers. [Source: Helix Core product brief](https://www.perforce.com/sites/default/files/pdfs/pf-core-product-brief-web.pdf)

### Stated Capacity (from official product brief [PDF](https://www.perforce.com/sites/default/files/pdfs/pf-core-product-brief-web.pdf))
- Individual assets **over 100 MB**.
- Project repositories **over 10 TB**, total data **petabytes**.
- **Thousands of concurrent users**.
- **10,000+ transactions per minute**.
- Global multi-site topologies supported natively.

### Max limits / known thresholds
- RCS-file hard limit historically **1.5 GB** per file (now lifted for compressed storage, but +C/+F large assets bypass RCS). [Source: Perforce support article on RCS limit](https://portal.perforce.com/s/article/3198)
- "Maximum users/clients AND maximum files (1000)" warnings appear in free/trial editions. [Source: Perforce support article](https://portal.perforce.com/s/article/Resolve-a-Maximum-users-clients-AND-maximum-files-1000-exceeded-warning-in-Helix-Core) [UNVERIFIED — may be configurable in paid]
- Recommended hardware sizing guide (CPU cores, RAM, storage IOPS) in Perforce support. [Source: Recommended Server Hardware Configurations](https://portal.perforce.com/s/article/2957)

### Adoption Claims
- Perforce's public claim: **"trusted by 19 of the top 20 AAA game studios"**. Repeated across the [product page](https://www.perforce.com/products/p4), [product brief](https://www.perforce.com/sites/default/files/pdfs/pf-core-product-brief-web.pdf), [game-development page](https://www.perforce.com/solutions/game-development), [press releases](https://www.perforce.com/press-releases/helix-core-SaaS-azure), [resources page](https://www.perforce.com/resources/p4/game-dev-resources).
- **Ubisoft case study**: 2,000+ developers on P4. [Source: Ubisoft customer case study](https://www.perforce.com/customers/case-studies/vcs/ubisoft)
- Epic Games itself depends on P4 for Unreal Engine development (the Epic UE source depot is a well-known Perforce depot). [Source: Unreal Engine docs on Perforce setup](https://dev.epicgames.com/documentation/unreal-engine/using-perforce-as-source-control-for-unreal-engine), [Accessing Unreal Engine with Perforce](https://dev.epicgames.com/documentation/en-us/unreal-engine/accessing-unreal-engine-with-perforce)
- Firelight Technologies (FMOD), Supermassive Games, and others in [customer list](https://www.perforce.com/customers/case-studies). [UNVERIFIED: "19/20" claim is Perforce's marketing figure, not independently audited.]

---

## 3. Ecosystem

### Helix Swarm — Code Review
- Free web-based review tool. Pre-commit and post-commit review workflows; shelves trigger review; approvals tracked. [Source: Helix Swarm product page](https://www.perforce.com/products/helix-swarm), [TeamCity integration guide](https://www.jetbrains.com/help/teamcity/cloud/integrating-with-helix-swarm)
- AI-assisted code review added 2026. [Source: Systems Digest AI-assisted review video](https://www.systemsdigest.com/videos/ai-assisted-code-reviews-p4-code-review-helix-swarm)

### Helix DAM — Asset Management / Review
- Digital Asset Management on top of Helix Core for 2D/3D/video/audio art assets; AI-powered tagging, customizable metadata, high-res thumbnails, native USD support. [Source: Helix DAM product page](https://www.perforce.com/products/helix-dam), [What's New in Helix DAM 2024.3](https://www.perforce.com/sites/default/files/pdfs/whats-new-helix-dam-2024-3.pdf)
- Versioning + preview + review/approval workflow for art, separate from (but integrated with) Helix Core.

### Helix TeamHub / P4 Code Review
- **Helix TeamHub** = SaaS offering combining Git hosting + code review + DAM for smaller teams (positioned below Core).
- **P4 Code Review** = rebranded Helix Swarm (2026 rename).

### Unreal Engine Integration
- **Official Source Control Provider** for UE: supported, documented, and Epic uses P4 internally for UE development. [Source: Unreal Engine docs — Using Perforce as Source Control](https://dev.epicgames.com/documentation/unreal-engine/using-perforce-as-source-control-for-unreal-engine)
- P4 plugin is built-in to UE editor; `.uasset` files typically flagged `binary+l` to lock on edit. [Source: Perforce/Unreal integration page](https://www.perforce.com/integrations/perforce-and-unreal-integration)
- Self-hosting Perforce + Epic Horde (Unreal's build/distribution system) is a documented studio pattern. [Source: "Self-hosting Perforce and Horde" blog](https://hiddenstate.games/blog/self-hosting-perforce-horde/)

### Unity Version Control (formerly Plastic SCM) — Main Rival
- **Plastic SCM** acquired by Unity → **Unity Version Control (UVCS)**. Git-competitor VCS built for games. [Source: Unity Version Control overview](https://unity.com/features/version-control), [UVCS docs](https://docs.unity.com/unity-version-control)
- Mechanics: native large-binary handling (no separate LFS tier), branching/merging, **file locking via `lock.conf`**, web-based review, CLI. [Source: Unity VCS docs](https://docs.unity.com/unity-version-control/triggers/overview), [Plastic SCM integration in Unity](https://docs.unity3d.com/es/2020.2/Manual/plasticSCMIntegration.html)
- **Gluon** = Unity VCS's artist-friendly mode. Locks files, selective sync (download only the files you want), no branching/merge UI for artists — download → edit → check-in. [Source: Unity VCS Gluon docs](https://docs.unity.com/en-us/unity-version-control/gluon/gluon)
- Unity is pivoting DevOps pricing in **March 2026**: **unlimited seats** (no more per-seat cloud charges), free tier expanded to **25 GB storage** + **100 GB egress**, pay-as-you-go after that. [Source: Unity DevOps pricing changes — Support Help Center](https://support.unity.com/hc/en-us/articles/34748492914964-Understanding-of-New-Unity-DevOps-Pricing-starting-from-Mar-1-2026), [Unity pricing updates page](https://unity.com/products/pricing-updates)
- Was previously ~**$7/month/seat** for cloud. [Source: Unity Discussions — What is the price of a seat?](https://discussions.unity.com/t/what-is-the-price-of-a-seat/1616136)

### Diversion — Newer Cloud-Native Rival
- Cloud-native, officially **recognized by Epic Games as a VCS solution for Unreal Engine**. [Source: Diversion game-development page](https://www.diversion.dev/game-development), [Diversion vs Git LFS comparison](https://www.diversion.dev/compare-diversion-to-git-lfs)
- Features: native binary support with **no file size limits**, visual branching, soft + hard/exclusive locks, conflict-prevention alerts, Unified reviews (code + art side-by-side), REST API, automated migration from Perforce/Git LFS with bi-directional sync during transition.
- Benchmark claims: **400,000+ files committed in <30s**, **5M files cloned in <5 min**, **300 commits/minute** (vs 30 for GitHub in their test). [UNVERIFIED — self-published benchmarks.] [Source: Diversion homepage](https://www.diversion.dev/), [30 vs 300 blog](https://www.diversion.dev/blog/30-vs-300-benchmarking-github-against-diversion)
- "Up to 70% lower total cost of ownership vs Perforce." [UNVERIFIED — self-published.]
- Pricing: Indie free tier (5 users, 100 GB), Studio, Enterprise tiers (on-prem/private cloud/hybrid, Okta/AD). [Source: Diversion FAQ on pricing](https://www.diversion.dev/game-development)

### Lore — Epic's Open-Source VCS
- Epic Games open-source VCS ("Lore") designed for scalability and AI-agent fleets. Advisory-only locking, no built-in identity/permissions. [Source: Assembla blog — Lore vs Perforce](https://get.assembla.com/blog/lore-vs-perforce/)
- Early-stage; not a current production competitor but signals where Epic thinks VCS is heading.

### SVN Legacy in Games
- **Apache Subversion (SVN)** still present but declining. Advantages cited for games: cheap directory copies for branching, partial checkouts, path-based locking. Disadvantages vs Perforce: no native exclusive-open modifier at the file-type level, no stream branching model, no delta-sync, no edge server topology. [Source: Reddit r/gamedev — Why SVN isn't more mainstream](https://www.reddit.com/r/gamedev/comments/vgh0lt/why_is_subversion_not_more_mainstream_compared_to/), [Assembla — Is SVN Still Used In 2026?](https://get.assembla.com/blog/is-svn-still-used), [Anchorpoint — 5 SVN alternatives](https://www.anchorpoint.app/blog/svn-alternatives-for-game-development)
- Mostly superseded by Perforce/Unity VCS in studios that outgrew SVN.

### Why Studios Pick Each
- **Perforce (P4/Helix Core)**: when you need **enterprise ACLs, multi-continent edge servers, >10 TB repos, thousands of seats, integrated code review + DAM, and Epic-integrated UE workflows**. The AAA default for 20+ years.
- **Unity VCS / Plastic SCM**: when you want **modern Git-like branching + large-binary-native + artist Gluon mode** without per-seat costs post-2026, especially Unity-centric teams.
- **Diversion**: when you want **cloud-native, zero-ops, UE + Unity + Godot plugins, unified code/art reviews**, and a lower TCO.
- **Git + LFS**: when you're **indie or tooling-agnostic** and can tolerate LFS limitations (see §4).

---

## 4. Game-Dev Workflow Reality

### Binary Asset Pipelines
- A single game repo mixes **source code** (C++, C#, shaders, blueprints/scripts) with **binary art assets**: textures (`.png`/`.tga`/`.exr`/`.dds`), 3D models (`.fbx`/`.obj`/`.usd`/`.uasset`/`.umap`), audio (`.wav`/`.ogg`/`.bank`/FMOD), video/cinematics (`.mp4`/`.avi`/`.bik`), level data, compiled shaders. [Source: Diversion game-dev guide](https://www.diversion.dev/knowledge-center/version-control), [Gridly — VCS in game development](https://www.gridly.com/blog/version-control-in-game-development/)
- **Lock discipline**: studios typically `binary+l` all art files; artists must lock before editing. Merge is meaningless for these types. This is the workflow Perforce was designed around and that Git LFS cannot enforce natively.

### Build Automation
- CI/CD tools (Jenkins, TeamCity) integrate directly with P4 via shelves; Swarm reviews gate submissions. [Source: TeamCity + Helix Swarm](https://www.jetbrains.com/help/teamcity/cloud/integrating-with-helix-swarm)
- **Horde** (Epic's build/distribution system) is the standard Unreal CI + remote-execution platform, designed around Perforce depots.

### Repo Size Claims (credible range from official sources + community)
- Perforce's published capacity: **project repositories over 10 TB, total data petabytes**; **individual assets over 100 MB**; **thousands of concurrent users**. [Source: Helix Core product brief PDF](https://www.perforce.com/sites/default/files/pdfs/pf-core-product-brief-web.pdf)
- Community reports: AAA UE repos commonly **hundreds of GB to multi-TB**. [Source: Reddit r/gamedev — VCS for large game asset repos](https://www.reddit.com/r/gamedev/comments/1rrl0mg/is_version_control_for_large_game_asset_repos/) [UNVERIFIED: anecdotal.]
- Overwatch GDC 2017 talk shows Blizzard using **Perforce + custom data-building pipeline** for large binary data, custom branching, and game-data asset handling. [Source: GDC Vault — The Data Building Pipeline of Overwatch (2017)](https://media.gdcvault.com/gdc2017/Presentations/Clyde_David_TheDataBuilding.pdf)

### Partial / Selective Sync Needs
- Full sync of a multi-TB repo is infeasible for individual artists.
- Helix Core: **stream depots with sparse/virtual streams**, client spec Views that map only the needed depot subtree, `p4 sync` of partial paths.
- Unity VCS: **Gluon** lets artists pick individual files to download; partial workspace by design. [Source: Gluon docs](https://docs.unity.com/en-us/unity-version-control/gluon/gluon)
- Diversion: partial sync implicit in selective checkouts.
- Git LFS: "partial checkout" is not native; LFS fetch-all or manual `lfs fetch`/`lfs pull` scoping.

### Git + LFS Pain — Credible Industry Sources
- Perforce + GitLab/Microsoft public narrative: **Git LFS doesn't solve the large-asset gamedev problem**; the issue is fundamental (pointer rewriting, separate storage tier, no locking, bloat). [Source: Hacker News discussion citing Microsoft/Git LFS limits](https://news.ycombinator.com/item?id?id=15726250), [Atlassian — Git LFS for designers/game devs](https://www.atlassian.com/blog/development/git-lfs-for-designers-game-developers-architects)
- **Git LFS effective file-size limit ~5 GB**; large `.umap`/`.pak`/`.uasset` files routinely exceed this. [Source: Diversion vs Git LFS comparison](https://www.diversion.dev/compare-diversion-to-git-lfs)
- Git LFS requires **separate LFS storage tier**, bandwidth fees, pointer-file rewriting (rewrites all Git object IDs on history import). [Source: GitHub git-lfs repo](https://github.com/git-lfs/git-lfs)
- Studios migrating **Git → Perforce or Unity VCS** are a documented trend (Diversion advertises "Up to 70% lower TCO" migration from both). [Source: Diversion migration page](https://www.diversion.dev/game-development), [Anchorpoint — Best VCS for game dev 2026](https://www.anchorpoint.app/blog/version-control-for-game-development)
- No prominent public source documents a studio **migrating Perforce → Git+LFS for AAA** at scale (would be anomalous).

---

## 5. Requirements List (mechanics a replacement must provide)

These are **mechanics/behaviors**, not solution architectures. Any next-gen platform serving AAA game studios must implement:

1. **Exclusive file locking** (per-file, atomic, first-writer-wins, visible globally). `binary+l` semantics: if file is locked by user A, user B's open-edit fails with clear owner info. Must be enforced server-side, not advisory.
2. **Huge-blob storage** — native handling of files **>100 MB up to several GB** (`.uasset`, `.umap`, `.pak`, `.bik`, `.fbx`, compressed texture stacks). No per-file size cap in practice; no separate storage tier with pointer rewriting that bloats history.
3. **Binary storage efficiency** — configurable: **full-compressed per revision** (`+C`), **RCS delta** (`+D`), **head-only** (`+S`), **n-revision retention** (`+Sn`), **uncompressed** (`+F`). Studios tune this per asset class.
4. **Selective / partial sync** — per-user workspace views mapping only the needed depot/tree subset; sparse streams; per-file selective checkout. A 500 GB repo must not require a 500 GB local sync.
5. **Changelist-based atomic commits** — multi-file commits that succeed or fail as a unit; shelve for review/resume; numeric changelist IDs.
6. **Caching / proxying for global studios** — regional edge/proxy servers that serve file content locally with central write authority. WAN acceleration. Delta-sync (send only changed bytes per revision).
7. **Binary asset review / approval** — preview thumbnails for 2D/3D/video/audio, annotate, approve/reject workflows. Swarm + DAM model: art assets reviewed separately from code but versioned in the same repo.
8. **Per-file ACLs** — path-based and user/group-based permissions down to individual files or depot subtrees. IP-restricted access for contractors. LDAP/SAML/OIDC identity integration.
9. **Big-repo performance** — target: **10,000+ transactions/minute**, **thousands of concurrent users**, **10+ TB repos**, **petabyte-scale total data** without sync/submit degradation. Sub-100 ms meta operations; delta transfers for large files.
10. **Lock-aware editor integration** — UE/Unity/Godot/source plugins that show lock status, prevent silent overwrites, auto-lock on asset edit.
11. **Triggers / automation hooks** — server-side commit hooks for policy enforcement, CI gating, notifications; extensible (script or API).
12. **Merge for text + explicit non-merge for binary** — three-way text merge built-in; binary files flagged to *never* merge, always lock.

---

## 6. Pricing / Market Position

### Perforce (P4/Helix Core)
- **Free**: up to 5 users, 20 workspaces, 3 Git repos, 3 lifetime support cases. Includes P4 Code Review. [Source: P4 Pricing page](https://www.perforce.com/products/p4/pricing)
- **Cloud** (managed by Perforce, single-tenant, teams ≤100): **$39/user/month**, 64 GiB storage included, unlimited workspaces & support, automatic updates & backups, P4 Code Review for 3+ users. [Source: same P4 pricing page](https://www.perforce.com/products/p4/pricing)
- **Scale** (annual): unlimited seats, unlimited workspaces/repos, unlimited support, option to add P4 DAM. Custom pricing ("Let's Talk"). [Source: same P4 pricing page](https://www.perforce.com/products/p4/pricing)
- **Platform** (annual): Scale + P4 DAM + P4 Plan (Hansoft) + P4 One. Custom pricing. [Source: same P4 pricing page](https://www.perforce.com/products/p4/pricing)
- Premium add-ons: Remote Administration, Migration/Upgrade Support, Server Audits, 3rd-Party Integration. [Source: same page]
- Historical competitor analysis (third-party) suggests legacy per-seat pricing was the norm pre-cloud. [Source: ReleaseTeam — P4 Licensing Explained](https://www.releaseteam.com/perforce-p4-licensing-comparison/) [UNVERIFIED pricing specifics]
- **Note**: "19 of the top 20 AAA game studios" claim repeated on pricing and product pages. [Source: Perforce pricing/product pages]

### Unity Version Control (UVCS)
- **Pre-March 2026 (legacy)**: ~**$7/seat/month** for cloud hosting. [Source: Unity Discussions](https://discussions.unity.com/t/what-is-the-price-of-a-seat/1616136)
- **Post-March 2026** (new model, pay-as-you-go after free tiers): **Unlimited seats — no per-seat charges**. **25 GB free storage** per org/month (up from 5 GB). **100 GB free egress**. Storage overage ~**$0.14/GB/month** (or $0.00019/GB-hour). Egress overage **$0.10/GB**. Build concurrency 2 free, extra $10/machine. [Source: Unity Support — Understanding New DevOps Pricing (Mar 2026)](https://support.unity.com/hc/en-us/articles/34748492914964-Understanding-of-New-Unity-DevOps-Pricing-starting-from-Mar-1-2026), [Unity pricing updates page](https://unity.com/products/pricing-updates)
- Build minutes tiered (Windows MICRO $0.02/min … TURBO $0.37/min, Mac STANDARD–ULTRA). [Source: same support article]

### Diversion
- **Indie**: free for 5 users, 100 GB storage. **Studio**: paid, seats + reviews + hard locks + granular permissions + CI/CD. **Enterprise**: on-prem/private cloud/hybrid, Okta/AD. [Source: Diversion game-dev FAQ](https://www.diversion.dev/game-development)
- Storage-based pricing, no separate LFS fees; 100 GB included on all paid plans. [Source: Diversion vs Git LFS FAQ](https://www.diversion.dev/compare-diversion-to-git-lfs)
- TCO claims of **up to 70% lower vs Perforce**. [UNVERIFIED — self-published.]

### Market Signals
- Perforce is the **incumbent AAA standard** (20+ years, 19/20 claim). Deep UE integration.
- Unity VCS is the **fastest-growing rival** among Unity studios and any studio wanting modern branching + Gluon-mode artists; the 2026 pricing shift (unlimited seats) undercuts Perforce's per-seat cost for large studios.
- Diversion is a **newer cloud-native challenger** (officially Epic-recognized for UE); benchmarks and TCO claims target Perforce's ops overhead.
- Git + LFS is the **indie default** but self-evidently inadequate for AAA multi-TB binary workflows (per Atlassian, Microsoft/Git-LFS, and Hacker News discussions).
- **SVN** is legacy, declining in games, replaced by Perforce/UVCS/Diversion.
- Perforce acquired by **Francisco Partners** (PE) in 2019; based in Alameda, CA. [Source: Tracxn Perforce profile](https://platform.tracxn.com/a/d/company/531a984de4b0f7e16612d3cb/perforce)

---

## Open Caveats / UNVERIFIED Items

- **"19/20 top AAA studios"**: Perforce's marketing figure, not independently audited. *[UNVERIFIED exact current count.]*
- **Diversion benchmarks** (300 commits/min, 400K files/30s, 70% lower TCO): self-published. *[UNVERIFIED by third-party.]*
- **Perforce Cloud $39/user/month** is listed; enterprise Scale/Platform pricing is opaque ("Let's Talk"). *[No public per-seat $ for self-hosted Scale tier.]*
- **Unity VCS seatless pricing** is new (Mar 2026); actual adoption/behavior in production is not yet widely reported. *[UNVERIFIED in the wild.]*
- **AAA repo sizes of "5–500 GB" to "multi-TB"** are anecdotal from Reddit/forums. *[No public repo-size disclosure from major studios. Perforce's published capacity is 10 TB/repo, PB total.]*
- Several Perforce support articles (CSS-gated portal) did not render in this research; I cite their existence and summary where I could confirm via other sources. *[UNVERIFIED content of portal-only articles.]*
