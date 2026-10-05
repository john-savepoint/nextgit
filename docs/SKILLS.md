# Skills — NextGit loop

Load-path notes: OMP's skill router resolves many skills by name; entries marked **path-pinned** must be loaded from the given path (verified present 2026-10-04).

| Skill | Load | Use for |
|---|---|---|
| project-init | path: `/home/johnzealanddoyle/.claude/skills/project-init` | re-running/extending the bootstrap; refs `references/{skeletons,loop-and-gates}.md` + `status-index.mjs` |
| workflow-authoring | path: `/home/johnzealanddoyle/.claude/skills/workflow-authoring` | DDW handle API before authoring or changing `porting/` runner code |
| workflow-patterns | path: `/home/johnzealanddoyle/.claude/skills/workflow-patterns` | pattern selection (pools, diamonds, verify recipes, farms) |
| typesafe-ai | path: `/home/johnzealanddoyle/skills/skills/typesafe-ai` | decision-model patterns; refs `references/{harness-tools,composition-patterns,use-case-catalog,prompting-craft}.md` |
| bmad suite | path: `/home/johnzealanddoyle/projects/cloudflare-git-comp/.claude/skills/bmad-*` | planning artifacts P0 (prd, ux, architecture, spec), deep-recon, brainstorming, build |
| verification-before-completion | router | before claiming done — evidence discipline |
| typescript-professional | router | platform TS edits |
| security-audit | router | trust-layer / auth-surface reviews |
| omp-dev | router | harness internals, workflows, hook debugging |
| cloudflare · wrangler · workers-best-practices | router | Workers/Artifacts work when deeper CF docs are needed |

Rules: never hand-place a skill outside a declared root; if a router skill fails to resolve, record it here with a path instead.
