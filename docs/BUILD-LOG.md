# Build log — NextGit (one line per batch)

- 2026-10-04 | buildout v1 (worker/UI/scripts) | green | deploys 21365402 + earlier | worker API + triage UI + demo scripts shipped | verify 7/8 → fix → all green; 1 latent leak channel fixed
- 2026-10-04 | wave1 real agents | green | — | 4/4 REAL CLI-agent proposals (omp + codex) with intents, 1 genuine conflict | 3 runner bugs fixed
- 2026-10-04 | wave2 landing | green | deploy ca61a095 | `POST /land` server-side push end-to-end | 200/409/400 paths verified; minimal fs hand-built for workerd
- 2026-10-04 | wave3 fork-point | green | deploy 9ef6c02e | change-sets vs fork point + `landing.status` | reverse-diff noise eliminated; re-land → 409 no-changes proven
- 2026-10-05 | clarity: tour + rebrand | green | deploy ab7d503b | `/tour.html` (10 steps, 4 sims) + NextGit branding | browser-verified interactive; live step pulls real proposals
- 2026-10-05 | judge research | verified | — | Clef live call (typed answers, real data) + 36-idea catalog | ~1.3 s REST; ~$0.00012/call
- 2026-10-05 | bootstrap (project-init) | green | b324b73 + f001a1f | spine + loop + commands + status index | idempotent
- 2026-10-05 | bootstrap acceptance — health sweep (first loop order) | subject green (4/4 across 5+ independent reproductions); apparatus findings remedied by caller (runner commit d5f6b5b + fail-closed + 9-case test); same-lens re-adjudication pending spawn restoration | d5f6b5b | gates caught: 7 NUL bytes in plan.md, fictional jaq guard (`-c` exits 0 on dead input → fixed to `-ec`), two fail-open branches, heal-budget-on-resume bug, citation rot | evidence: porting/runs/bootstrap-health-sweep/
