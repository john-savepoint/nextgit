# Big Assets & Dependency Versioning — Reconnaissance Brief

> Read-only research for Cloudflare "Next-Gen Git Platform" design inputs. All claims sourced inline; UNVERIFIED flags where confirmation failed.

---

## 1. Why Git LFS Breaks at Studio Scale

### 1.1 LFS Protocol Basics
- LFS replaces large files with **pointer files** (version URL + `oid sha256` + `size`) stored in the normal Git tree. Actual file bytes live on a separate LFS server (batched HTTP API). Git client hooks translate checkout ↔ LFS object store via the [batch API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md).
- Source: [GitHub LFS docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)

### 1.2 Hosting Per-File Size Caps (verified, current as of 2026-10)
| Plan | Max LFS file size |
|------|-------------------|
| GitHub Free | **2 GB** |
| GitHub Pro | **2 GB** |
| GitHub Team | **4 GB** |
| GitHub Enterprise Cloud | **5 GB** |

- Hard block above the plan cap → error. Individual file ≥5 GB always rejected.
- **Non-LFS file cap**: normal files >100 MiB are hard-blocked (warning at 50 MiB). Browser uploads limited to 25 MiB.
- Sources: [GitHub LFS docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage), [GitHub large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

**Studio-scale implication:** a single Unreal/Unity asset (e.g., a compressed 4K texture or megatexture, often 2–8 GB) exceeds GitHub Team GB cap and requires Enterprise Cloud. A film VFX plate stack can exceed 5 GB → no plan supports it.

### 1.3 LFS Bandwidth & Storage Costs
- Each push of a modified LFS file stores a **new full copy of the entire file** (no binary diff/delta). A 1-byte change to a 4 GB asset = +4 GB storage + new-version bandwidth.
- **Free quota**: 10 GiB bandwidth + 10 GiB storage/month (Free/Pro); 250 GiB/250 GiB (Team/Ent).
- Billing is metered: storage = GiB-hours accrued (hourly usage rate), bandwidth = per-GiB downloaded. Over-quota with budget= → LFS blocked for the month.
- Sources: [GitHub LFS billing](https://docs.github.com/en/billing/managing-billing-for-git-large-file-storage/about-billing-for-git-lfs), [GitHub LFS storage/bandwidth](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-storage-and-bandwidth-usage)

### 1.4 Absence of Binary Merge
- LFS has no merge semantics. Concurrent edits to a binary asset result in **last-push-wins**. Perforce three-way binary merge and exclusive checkout are the industry norm for assets; Git/LFS cannot do this.
- UNVERIFIED: no official GitHub doc explicitly states "no binary merge" for LFS.

### 1.5 Batch API Limits
- [Batch API spec](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md) returns `413` (too many objects / too large) and `429` (rate limit).
- GitHub REST API: 5,000 req/hour authenticated. GitLab imposes explicit [LFS rate limits](https://docs.gitlab.com/administration/settings/git_lfs_rate_limits).

### 1.6 Pointer-file fragility
- Pointers record only SHA-256 + size. No chunk-level integrity. No dedup across files.

---

## 2. Alternatives & Current-State Techniques

### 2.1 Content-Defined Chunking (CDC) + Dedup

**Core idea:** variable-sized chunks via rolling hash → chunk-level dedup. Insertions/deletions only invalidate nearby chunks.

#### Xet (Hugging Face)
- Replaces Git LFS on HF Hub. Same pointer-file pattern, CDC backing store.
- Chunks: variable-length, target **64 KiB** (range 8–128 KiB), GearHash + Blake3 MerkleHash.
- Xorbs: aggregate up to **64 MB / 8,192 chunks**.
- Shards: up to **64 MB** lists of xorbs in CAS.
- Three-tier dedup: (1) in-memory session, (2) local disk cache, (3) **global dedup API** (async, HMAC-protected).
- Sources: [Xet index](https://huggingface.co/docs/hub/en/xet/index), [Xet dedup spec](https://huggingface.co/docs/xet/main/deduplication), [Xet chunking](https://huggingface.co/docs/xet/chunking)

#### restic / borg / rustic
- **restic**: Rabin fingerprint (64-byte window), lowest 21 bits = 0 → mean ~4 MiB chunk. SHA-256 per chunk. Inter-file + inter-backup dedup. Source: [restic CDC](https://restic.net/blog/2015-09-12/restic-foundation1-cdc/), [restic chunker](https://github.com/restic/chunker)
- **borg**: CDC (Rabin/Buzhash), 0.5–8 MiB chunks, HMAC-SHA256(key,data) IDs. UNVERIFIED exact current params.
- **rustic**: Rust rewrite of restic CDC.

#### casync
- Content-addressable snapshotting. CDC into chunks, content-addressable index. UNVERIFIED details — blog 404 on re-fetch.

### 2.2 Delta Encoding

#### xdelta3
- Implements **VCDIFF (RFC 3284)** binary diff. Source: [xdelta3 GitHub](https://github.com/jmacd/xdelta), [man page](https://man.archlinux.org/man/extra/xdelta3/xdelta3.1.en)

#### bsdiff / bspatch
- Suffix-array diff, optimized for executables. UNVERIFIED current status.

#### detools
- Modern binary delta encoding (Python/C). Source: [detools GitHub](https://github.com/eerimoq/detools)

### 2.3 git-annex
- Git without checking contents in. Key-value store + symlinks. Special remotes (S3, SSH, B2). Locking support. No native CDC. Source: [git-annex](https://git-annex.branchable.com/git-annex/)

### 2.4 DVC
- ML/data-centric. `.dvc` pointers in Git, content in remotes (S3, GCS, Azure, SSH, HDFS, HTTP, WebDAV). Content-addressable cache. Source: [DVC remote storage](https://dvc.org/doc/user-guide/data-management/remote-storage)

### 2.5 lakeFS
- Git-like versioning on object storage. Metadata-only branching, presigned direct data path. Sources: [lakeFS architecture](https://docs.lakefs.io/concepts/architecture), [docs](https://docs.lakefs.io/)

### 2.6 Sapling / EdenFS (Meta/Facebook)
- EdenFS: FUSE/NFSv3/ProjectedFS virtual FS for huge monorepos. Lazy materialization, blobless clone. Source: [EdenFS Overview](https://github.com/facebook/sapling/blob/main/eden/fs/docs/Overview.md)

### 2.7 Microsoft GVFS / VFS for Git
- Lazy hydration via placeholders. Windows source tree (~300 GB). Sources: [GVFS announcement](https://devblogs.microsoft.com/devops/announcing-gvfs-git-virtual-file-system/), [Largest Git repo](https://devblogs.microsoft.com/bharry/the-largest-git-repo-on-the-planet)

### 2.8 Cloudflare ArtifactFS
- FUSE-based, blobless clone, hydrate-on-demand. Prioritizes manifests; deprioritizes binaries. Source: [ArtifactFS guide](https://developers.cloudflare.com/artifacts/guides/artifact-fs/)

### 2.9 Virtual / Lazy Hydration Patterns
1. Metadata-first checkout (commits/trees/refs only).
2. Placeholder/sparse working tree.
3. On-demand fetch via read intercept (FUSE/ProjFS/VFS).
4. Local blob cache.
5. Priority queue — manifests before binaries.

### 2.10 CAS Economics
- Hash-addressed content → dedup, integrity, immutability. CDN-friendly. Sources: [LLVM CAS](https://llvm.org/docs/ContentAddressableStorage.html), [stonefly CAS](https://stonefly.com/blog/content-addressable-storage-enterprise-guide/)


---

## 3. Dependencies vs Source - Boundaries & Models

### 3.1 Immutable Package Artifacts vs Source Control
- Source control tracks text diffs, branches, history. Package artifacts (compiled binaries, tarballs, wheels, jars) are immutable outputs - once published, they never change.
- Conventional boundary: repo = source, registry = built artifacts.
- Source: [Nix reference manual](https://nix.dev/manual/nix/2.34/)

### 3.2 Nix Model
- Purely functional package manager. Packages in /nix/store/<hash>-<name>-<version>.
- Content-addressed store objects, binary cache (.nar archives).
- Immutable artifacts = CDN-cacheable forever.
- Sources: [Nix intro](https://nix.dev/manual/nix/2.34/), [CA store](https://nix.dev/manual/nix/2.34/store/store-object/content-address.html)

### 3.3 Registry vs Repo Boundary
- npm/Go/Rust: source + lockfile in repo, compiled packages in registry.
- Nix: derivations in repo, built paths in binary cache.
- Perforce (game industry): source + assets often in same depot.

---

## 4. Cloudflare Primitives Mapping

### 4.1 R2 (Object Storage)
- Object size: 5 TiB, Single-part: 5 GiB, Multipart: 4.995 TiB
- Buckets: 1,000,000/account, Zero egress, Presigned URLs (1s-7 days)
- Source: [R2 limits](https://developers.cloudflare.com/r2/platform/limits), [R2 presigned](https://developers.cloudflare.com/r2/api/s3/presigned-urls)

### 4.2 Workers (Compute)
- Daily requests: 100K (Free), Unlimited (Paid)
- CPU: 10ms (Free), 5min (Paid default 30s), Memory: 128 MB
- Worker size: 64 MiB, Request body: 100 MB (Free/Pro), 5 GB (Ent)
- Response body: NO enforced limit (stream R2 without buffering)
- Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits)

### 4.3 Durable Objects (Lock Coordination)
- Objects: Unlimited, Storage per DO (SQLite): 10 GB, Key+Value: 2 MB
- CPU: 30s default, ~1,000 req/sec/DO, Dynamic Workers: 10 concurrent
- Source: [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits), [DO workers](https://developers.cloudflare.com/changelog/post/2026-08-28-durable-objects-dynamic-workers-limit/)

### 4.4 Artifacts (Versioned Git Storage)
- Per repo: 1 GB, Per blob: 32 MB, Per account: 1 TB (unlimited repos)
- Rates: 2,000 req/10s (control + git per artifact)
- Source: [Artifacts limits](https://developers.cloudflare.com/artifacts/platform/limits)

### 4.5 ArtifactFS (Lazy Hydration)
- Blobless clone + on-demand hydration via FUSE
- Source: [ArtifactFS guide](https://developers.cloudflare.com/artifacts/guides/artifact-fs/)

### 4.6 KV / D1 / Cache / Images / Stream
- KV: 128 KiB value (read), good for manifests/metadata
- D1: edge SQLite for metadata/indexes
- Images: 10-20 MB, Stream: video - not suitable for game assets

---

## 5. Competition Terms Check
- Section 4: Entrants must use Cloudflare Workers and Artifacts (minimum).
- Additional Cloudflare products (R2, DOs, KV, D1) NOT prohibited - "including" sets floor not ceiling.
- Prize: $25,000 Cloudflare credits, deadline Oct 14 2026.
- Source: [Competition terms](https://cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf)

---

## 6. Pattern Catalog

### Pattern A: Chunked Blob Store + Manifest in Repo
- CDC chunks in R2, manifest in Git repo. Dedup across assets/versions.
- Tradeoff: Chunk index size, no native Git chunk semantics.

### Pattern B: Lock Service (Durable Object) + Pointer Files
- DO per repo/branch for exclusive checkout. Pointers in Artifacts.
- Tradeoff: ~1,000 req/sec/DO contention.

### Pattern C: Lazy Hydration (ArtifactFS-style)
- Blobless clone, hydrate on read.
- Tradeoff: FUSE driver complexity, mass hydration risk.

### Pattern D: CDN-Cached Immutables (R2 + Cloudflare Cache)
- Immutable assets in R2, edge cached, presigned URLs.
- Tradeoff: No versioning semantics.

### Pattern E: Hybrid - Source in Artifacts, Assets/Deps in R2
- Each primitive to its strength. DOs for locks.
- Tradeoff: System complexity.

### Pattern F: Content-Addressed Chunk Store with Merkle Tree
- Merkle tree of chunks for integrity + dedup + partial verification.
- Tradeoff: Overhead vs simpler chunk list.

### Pattern G: Registry Model (Nix-style)
- Build outputs in R2 keyed by content hash, source in Artifacts.
- Tradeoff: Requires build system integration.

### Open Questions
1. Chunk size: 64 KiB vs 4-8 MiB?
2. Lock granularity: per-file vs per-directory?
3. Manifest format: JSON vs protobuf?
4. CDC algorithm: GearHash vs Rabin vs FastCDC?
5. DO sharding strategy?
6. Cache invalidation on latest pointer?
7. Partial checkout (specific mip levels)?
