# D5 — Visual / Semantic Review Cluster (Round 2, final)

Scope: prior art for (a) semantic/AST-aware diff & merge; (b) visual, code-linked review (diagram→code navigation); (c) spatial/infinite-canvas interfaces for code. External web research only.
Accessed: 2026-10-02. All claims below retrieved this run.

---

## Findings

### Area 1 — Whiteboard (/dev/fast): SHIPPED, OPEN SOURCE, CROSS-PLATFORM (corrects R1 assumption)

- CLAIM: Whiteboard by /dev/fast is active; the homepage is a working product surface ("Updated just now") and states directly: "whiteboard runs on macOS, Windows, and Linux" — the Round-1 assumption that it is macOS-only is now FALSE. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown (page self-reports "Updated just now"; no dated changelog on page) | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: Whiteboard is source-available/open: homepage links source at github.com/devdotfast/whiteboard (license not verified this run). Distribution is via emailed install link, not an app store. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: No published pricing. Hosted Whiteboard is explicitly "COMING SOON" with a "Get in touch" CTA; there is no SaaS tier or price today — it is a free local OSS app with a hosted tier announced but not shipped. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: pricing
- CLAIM: Whiteboard's core is AST-based semantic diffing via its own Rust library "diffr" (github.com/devdotfast/diffr), rendering long algorithms as pseudocode and always showing function signatures, "fully extensible with plugins." | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: Whiteboard already ships "Audit agent trajectories" ("Understand if the decisions you made were completed correctly, and if the decisions the agent made make sense") and a "Copy for Agent" action (⧉ ⌘C) that copies a canvas selection for pasting into a coding agent — a bidirectional human↔agent review loop. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: Whiteboard's illustrated workflow is single-PR/single-diff oriented (one branch, e.g. `codex/search-on-main · 77 files · +4.7k −446`, one PR at a time) — no evidence of reviewing multiple concurrent agents' change-sets as a set. This is the closest prior art in the field and the sharpest overlap risk for the target differentiator. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability

### Area 2 — Semantic diff: CLUSTER IS SHIPPED AND ACTIVE; NO PLATFORM-NATIVE FEATURE FOUND

- CLAIM: Difftastic is active and maintained in 2026: manual documents v0.72.0; release 0.70.0 (Aug 7, 2026) added Dockerfile/Fish support and improved directory-diff performance; 0.71.0 packaged Sept 2026. tree-sitter-based, 30+ languages, MIT, ~14.5k stars class. | SOURCE: https://difftastic.wilfred.me.uk/introduction.html ; https://whatsnew.fyi/product/difftastic/releases/0.70.0 ; https://tools.uniget.dev/tools/difft/ | PUBLISHER: Wilfred (Difftastic) / whatsnew.fyi / uniget | PUB_DATE: 2026-08 (0.70.0), 2026-09 (0.71.0 packaging) | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: diffsitter is a maintained tree-sitter AST difftool on GitHub (2,401 stars, MIT, created 2020-06, 781 commits) — a second OSS AST-diff building block. | SOURCE: https://github.com/afnanenayet/diffsitter | PUBLISHER: afnanenayet (GitHub) | PUB_DATE: unknown (repo listing) | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: SemanticDiff is a commercial language-aware diff product: VS Code extension + GitHub App + browser PR viewer (app.semanticdiff.com), SaaS-hosted in the EU or on-prem, free for open-source; it hides style-only changes and detects moved code inside GitHub's review UI. | SOURCE: https://semanticdiff.com/github ; https://semanticdiff.com/github/faq/ ; https://app.semanticdiff.com/ | PUBLISHER: SemanticDiff | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability/pricing
- CLAIM: No native AST/semantic diff found on any major forge (GitHub, GitLab, Bitbucket). Searches surfaced only conventional-commit tooling (e.g. `bitbucket-semantic-pull-requests`) and generic diff docs; platform review remains line-oriented. | SOURCE: https://docs.gitlab.com/development/merge_request_concepts/diffs ; https://github.com/maxbrunet/bitbucket-semantic-pull-requests ; https://docs.github.com/github/collaborating-with-issues-and-pull-requests/reviewing-changes-in-pull-requests | PUBLISHER: GitLab / maxbrunet / GitHub | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: medium | CLASS: capability
- CLAIM: SemanticMerge no longer appears as a standalone sold product; Plastic SCM has been rebranded Unity Version Control (UVCS), and Unity's semantic merge is scoped to engine assets via UnityYAMLMerge ("Smart merge" for scene/prefab YAML), not general source code. | SOURCE: https://docs.unity3d.com/6000.0/Documentation/Manual/SmartMerge.html ; https://www.plasticscm.com/documentation | PUBLISHER: Unity | PUB_DATE: unknown (Unity 6000.x docs) | ACCESSED: 2026-10-02 | CONFIDENCE: medium | CLASS: positioning
- CLAIM (unverified): GumTree classical AST-diff (research tool) — no product/vendor surfaced this run; treat the OSS AST-diff space as Difftastic + diffsitter + diffr rather than GumTree products. | SOURCE: (none retrieved) | PUBLISHER: n/a | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: low | CLASS: capability

### Area 3 — Click-to-code diagram review: EXISTS; LEADER ABSORBED BY GITKRAKEN

- CLAIM: CodeSee was acquired by GitKraken (announced 2024-05-14) and folded into GitKraken's DevEx platform; codesee.io still operates in 2026 (acquisition banner + "Maps for Teams — 6 months, no cost" offer). CodeSee Maps are auto-generated, self-updating interactive diagrams of directories/file dependencies. | SOURCE: https://www.gitkraken.com/press/gitkraken-acquires-codesee-launches-devex-platform ; https://www.codesee.io/ ; https://docs.codesee.io/docs/explore-your-map | PUBLISHER: GitKraken / CodeSee | PUB_DATE: 2024-05-14 | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: trajectory/capability
- CLAIM: Swimm is alive but repositioned: it now markets itself as an "AI coding assistant" for understanding large codebases and capturing knowledge (docs-as-code, `sw.md`), with a GitHub Marketplace app (1,395 installs) and Copilot integration "coming soon" — it did NOT shut down. | SOURCE: https://www.swimm.io/ ; https://docs.swimm.io/ ; https://github.com/marketplace/swimm-io | PUBLISHER: Swimm | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: positioning
- CLAIM: Diagram→source navigation is shipped in Whiteboard: sequence-diagram steps expand from a pseudocode summary into the full source, and diagram selections can be sent to an agent. | SOURCE: https://dev.fast/ | PUBLISHER: /dev/fast | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability

### Area 4 — Spatial canvas for code: INFRASTRUCTURE MATURE; "FIGMA FOR CODE" IS FIGMA ITSELF

- CLAIM: tldraw is a maintained infinite-canvas SDK for React; the "make real" experiment showed drawing a UI on the canvas → GPT-4V → working website rendered back onto the canvas. | SOURCE: https://tldraw.dev/blog/make-real-the-story-so-far | PUBLISHER: tldraw | PUB_DATE: unknown (make real era ~2023) | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: React Flow (@xyflow/react) is the standard OSS library for node-based UIs / workflow builders / visualizers — a ready-made spatial graph substrate. | SOURCE: https://reactflow.dev/ ; https://reactflow.dev/api-reference/react-flow | PUBLISHER: xyflow | PUB_DATE: unknown | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: Figma now explicitly positions its infinite canvas across "design, code, and AI": Feb 17, 2026 blog "The future of design is code and canvas" (by CEO Dylan Field), plus a remote MCP server with write-to-canvas and code-to-canvas, and marketing stating "Teammates and AI agents work in the same space with shared context." | SOURCE: https://www.figma.com/blog/the-future-of-design-is-code-and-canvas/ ; https://developers.figma.com/docs/figma-mcp-server/write-to-canvas | PUBLISHER: Figma | PUB_DATE: 2026-02-17 | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: positioning
- CLAIM: No live standalone "Figma for code" product found; the space is served by adjacent incumbents (Whiteboard/dev.fast, Figma extending toward code, tldraw-based experiments) rather than a dedicated winner. | SOURCE: https://dev.fast/ ; https://www.figma.com/blog/the-future-of-design-is-code-and-canvas/ | PUBLISHER: /dev/fast, Figma | PUB_DATE: unknown / 2026-02 | ACCESSED: 2026-10-02 | CONFIDENCE: medium | CLASS: positioning

### Area 5 — Borrowable OSS vs. what remains unclaimed

- CLAIM: A code-review canvas can be assembled today from OSS: canvas/graph layer = tldraw (infinite canvas), React Flow/@xyflow (node graph), react-three-fiber (3D); diff layer = Difftastic (tree-sitter, MIT), diffsitter (tree-sitter, MIT), and dev.fast's own Rust `diffr` AST-diff library (source-available). | SOURCE: https://dev.fast/ ; https://difftastic.wilfred.me.uk/introduction.html ; https://github.com/afnanenayet/diffsitter ; https://reactflow.dev/ ; https://tldraw.dev/blog/make-real-the-story-so-far | PUBLISHER: multiple | PUB_DATE: mixed | ACCESSED: 2026-10-02 | CONFIDENCE: high | CLASS: capability
- CLAIM: What appears unclaimed is the *combination*: a spatial/AST review surface that ingests MULTIPLE concurrent agents' change-sets and reviews/merges them as one integrated set with cross-change overlap and conflict semantics. Whiteboard (closest) reviews one branch/diff at a time plus agent trajectories; SemanticDiff and CodeSee are single-diff / single-map and host-agnostic; no product was found doing set-level multi-agent change review. | SOURCE: https://dev.fast/ ; https://semanticdiff.com/github ; https://docs.codesee.io/docs/explore-your-map | PUBLISHER: multiple | PUB_DATE: unknown/2024-05 | ACCESSED: 2026-10-02 | CONFIDENCE: medium | CLASS: positioning

---

## Leads

- github.com/devdotfast/whiteboard and github.com/devdotfast/diffr — read the source to confirm license and whether multi-branch/multi-agent ingestion exists (homepage suggests not).
- Whiteboard Discord (discord.gg/wYvd2cpMQg) — ask directly whether concurrent-agent change-set review is on the hosted roadmap.
- Figma MCP server docs (write-to-canvas / code-to-canvas) — check whether agent-authored code changes can be reviewed on the Figma canvas as a set.
- GitKraken DevEx platform — verify what happened to CodeSee Maps post-acquisition and whether it reviews agent changes.
- GumTree project page / SemDiff research — confirm whether any productized AST-merge exists (R1 had no evidence; only academic).
- react-three-fiber (r3f) — the 3D canvas option was not separately verified this run; likely relevant for spatial code rendering.

## Not found

- Any evidence of native semantic/AST diff on GitHub, GitLab, or Bitbucket (only third-party apps and conventional-commit linting).
- A standalone, currently-sold SemanticMerge product page; evidence points to it being folded into Unity Version Control / UnityYAMLMerge (asset-scoped).
- Any live, dedicated "Figma for code" product.
- Any product that reviews multiple concurrent agents' change-sets as an integrated set (the target differentiator) — but Whiteboard is a strong adjacent incumbent and must be differentiated explicitly.
- Publication dates for dev.fast/Whiteboard, SemanticDiff pages, tldraw blog, diffsitter, and CodeSee docs (pages carry no dates); flagged above as unknown.
- GumTree productization and react-three-fiber code-canvas prior art (not searched within budget).
