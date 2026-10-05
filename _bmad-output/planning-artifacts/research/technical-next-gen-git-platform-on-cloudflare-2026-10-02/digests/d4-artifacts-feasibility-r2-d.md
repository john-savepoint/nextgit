# Digest — R2: Artifacts feasibility hardening (round 2)

- **Assistant:** R2ArtifactsFeas (scout) · Round 2 · 2026-10-02
- **Note:** output schema omitted source URLs; a source-list supplement was requested (pending at filing time).

## Summary (verbatim)

Feasibility hardening for Artifacts + Workers (Round 2). Five questions closed: the ~64 MiB pack-push cap is still OPEN with no ETA and no linked PR (last Cloudflare reply June 2026); Artifacts smart-HTTP speaks v1 push + v2 clone/fetch, which matches isomorphic-git's v1-only push — interop verdict is compatible; binding primitives (log/readCommit/readTree/readBlob/readFile) exist and Workers Paid CPU extends to 5 min, making in-Worker diffing via binding reads (no clone) viable for review flows; git notes refs are explicitly documented as supported for harness metadata; small but real ecosystem post-open-beta.

## Architecture (verbatim)

isomorphic-git v1.42.x pushes over v1 wire protocol against Artifacts' v1 receive-pack; review/diffing bypasses git entirely via Artifacts Workers binding reads (readCommit→readTree→readBlob→readFile) running diffs (jsdiff/diff3) inside a 5 min CPU-budgeted Worker; git notes refs carry provenance metadata.

## Open items
- Source URLs per answer (supplement requested).
- Reconcile "small but real ecosystem" vs the sibling recon's "only vibesdk artifacts-viewer" finding.

---

## Sources supplement (recall pass, 2026-10-02)

**Q1 — ~64 MiB pack-cap status:** OPEN, no ETA, no linked PR, no workaround. Last Cloudflare reply 2026-06-02 ("known limitation… working on fixing", @NuroDev). Issue unchanged since 2026-08-17. Scope = any push whose *reachable pack* crosses ~64 MiB (63 MiB succeeds, 64 MiB → HTTP 500 send-pack disconnect). Push path only; clone/fetch unaffected. Limits page (2026-10-01) does NOT list a pack-size cap.
- Sources: github.com/cloudflare/developer-platform/issues/29 (Cloudflare, 2026-06-01/08-17) · developers.cloudflare.com/artifacts/platform/limits (Cloudflare, 2026-10-01) — HIGH

**Q2 — Protocol interop:** Artifacts smart-HTTP: clone/fetch = v1+v2; **push = v1 only** (v2 receive-pack explicitly "Not supported"); capabilities `filter`/`include-tag` unsupported. isomorphic-git 1.42.x push has no `protocolVersion` param (default v1); only getRemoteInfo2/listServerRefs accept protocolVersion. Verdict: compatible, no friction.
- Sources: developers.cloudflare.com/artifacts/api/git-protocol (Cloudflare, 2026-04-25) · isomorphic-git.org/docs/en/push · /fetch · /next/getRemoteInfo2 — HIGH

**Q3 — Binding primitives + CPU limits:** Binding exposes log(opts), readCommit(hash)→{tree,parents,message}, readTree(hash)→children, readBlob(hash), readFile({ref,path}). No generic "readRef" — ref reads via log/readCommit. Workers Paid CPU: default 30 s, configurable to 5 min via `limits.cpu_ms`; free plan 10 ms. Diffing via readFile→text→jsdiff fits in <1 s; whole-commit diff via readTree recursion well within 30 s. Binding-reads path (no clone) viable for review flows.
- Sources: developers.cloudflare.com/artifacts/api/workers-binding (Cloudflare, 2026-10-01) · developers.cloudflare.com/workers/platform/limits (Cloudflare, 2026-09-05) — HIGH

**Q4 — git notes refs:** SUPPORTED, explicitly documented. Best-practices page shows `git notes add/show/append`, states notes live on separate refs and must be pushed/fetched as `refs/notes/*`. No blocked-notes reports.
- Source: developers.cloudflare.com/artifacts/concepts/best-practices (Cloudflare, 2026-04-25, "Use git notes for prompts and model output") — HIGH

**Q5 — Ecosystem (tension reconciled):** Beyond vibesdk artifacts-viewer (still the only *product*): (a) cloudflare/ci example "cloudflare-artifacts" (deployable CI Worker); (b) elithrar/artifacts-starter; (c) Flavio Copes tutorial (flaviocopes.com/cloudflare-artifacts, 2026-08); (d) cloudflare/agents#1440 discussion (Think+Artifacts); (e) docs build-and-deploy-on-push guide; (f) lilting.ch deep-dive (2026-05). Ecosystem real but tiny; no large third-party app yet.
- Sources: github.com/cloudflare/ci/tree/main/examples/cloudflare-artifacts · github.com/elithrar/artifacts-starter · flaviocopes.com/cloudflare-artifacts · github.com/cloudflare/agents/issues/1440 — MEDIUM

**Bottom line:** Stack is feasible. Open risk = the 64 MiB pack cap (push-side only; review flows use binding reads, not big packs — design around it with small incremental pushes). Interop clean. Diffs viable in-Worker. Notes supported.
