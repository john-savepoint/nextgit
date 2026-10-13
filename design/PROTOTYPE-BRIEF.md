# NextGit — Prototype Coverage Brief (the contract for every prototype)

**Product**: NextGit — the agent-era software platform. Cloudflare-native: a judge-gated, evidence-backed convergence layer where agent fleets propose changes, humans decide, and every landing carries a receipt. Demo namespace: `demo` base + `agent-1..5` proposal repos.

**Your deliverable**: ONE self-contained `index.html` (inline CSS + JS, no network, no build) that renders the FULL product below with believable fake data and working interactions. It is a look-and-feel + interaction prototype, not a real app: no fetches — all data lives in an inline store. Every surface must be reachable from your prototype's own navigation. Modern, premium craft is the point: real hierarchy, real type, real motion, skeletons (never spinners-forever), snappy transitions. Judgment over literalism — you MAY adapt these screens to your design language, but EVERY feature below must be visible, demoable and interactive.

## Fake dataset (use these names/values; keep them consistent)

- Base repo `demo`; proposals `agent-1`..`agent-5`.
- agent-1 intent: “Refactor: session refresh with TTL”; changes `src/auth.ts` (+4/−1). agent-2 intent: “Add rotate-on-refresh to auth”; also touches `src/auth.ts` → **conflict with agent-1** (text-conflict, 1 pair). agent-3: “Docs: quickstart polish” (clean). agent-4: “CLI: tighter error surface” (clean). agent-5: “Config: move secrets to env” — touches `config/.env` (secret-class, withheld).
- Header chips: proposals 5 · shared 1 · conflicts 1 · changed 4 · clean 3.
- Events (ticker + SSE): `repo.pushed agent-1`, `session.steered agent-1`, `repo.pushed agent-3`, `token.minted`, `repo.pushed agent-2`, `repo.landed demo` …
- Commits (history): `550be50 baseline`, `804db99 agent-1: Refactor — session refresh with TTL`, `d924a70 agent-2: rotate-on-refresh`, `bd27fcf agent-3: docs`, `fcc4210 agent-4: CLI errors`.
- Six-cluster fork signals for agent-3: fit 0.98 · trust unmeasured · liveness 0.96 · proof 0.20 · distance 0.00 · cost 0.99.
- Checks strip per card: fold · collision · conflicts · secrets · base — each `pass|fail|unknown` (unknown renders neutral, NEVER green).
- Judge verdict (land sheet): ESCALATE with codes `risk:senior-security:agent-2`, `intent:contradicts:agent-2` (also show the CONFIRM and ACT variants).
- Land evidence receipt (12 keys): repos, commit `7c042f10`, ancestor, heads, foldHash, checks, results (+ `merged-sha-equals-tested-sha: pass`), mergedSha, testedSha, artifactRef, at, lease `{provider:"do", leaseId}`.
- Secret reveal: `config/.env` → keys `DATABASE_URL, REDIS_URL` → Reveal (audited) → `DATABASE_URL = postgres://demo:FAKE-SECRET-DO-NOT-USE@db.internal:5432/app`.
- Issues list: conflict (src/auth.ts, agent-1×agent-2, high) · withheld-secret (agent-5, block) · stale-base (agent-4, low) · blocked-intent (agent-3, medium).
- Sessions: agent-1 working (intent shown, last event repo.pushed, 2m ago) · agent-2 working · agent-3 idle (20m) · agent-4 idle.
- Agents roster: agent-1 harness omp · agent-2 omp · agent-3 unrecorded · agent-4 omp — capabilities `["propose"]`, policy `{land: manual, secrets: refused}`.
- Harnesses: codex, omp, pi — kind `byo-cli`, capabilities workspace-edit/prompt-args/probe.
- Parity dashboard: 18 rows — chips **5 exceeds · 8 parity · 5 below**; below rows: session-steering, agent-identity-policy, agent-federation, issues, ci (each with one-line verdict + evidence).
- Comments: on `src/auth.ts`: “john · line 3 — looks good, ship it” + one pending compose state.

## Surfaces + interactions (ALL must be present)

1. **Triage console** (default view)
   - Proposal grid of 5 cards; each: repo, intent, file/±/stats line, landing chip (`ready` / `withheld-secret`), the **checks strip** (5 tri-state chips with honest `unknown`), actions: `view diff`, `preview merge`, `land` (two-step).
   - **Conflict map**: at least one row — `src/auth.ts` — with the pair `agent-1 × agent-2`, kind `text-conflict`, and a “conflicts with agent-2” detail; visually distinct (not just red text).
   - Header: brand, stats chips, nav (Console · Files · History · Forks · Sessions · Issues · Parity · Tour), connection status (live/polling) that ANIMATES on toggle.
   - **Event ticker**: newest-8 feed, animates; new events slide in (simulate with a timer, ~2–4s cadence).
   - **Land flow**: clicking land arms a confirm step; the confirm sheet shows the judge verdict (ESCALATE + codes, with a toggle to CONFIRM/ACT/recorded-evidence/fail-closed variants) and stays render-only (never auto-fires).
   - **Withheld-secret card** (agent-5): blocked, explains key-names-only, offers the SECRET VIEW path.
2. **Merge modal** (from any card): file tabs, diff3 conflict rendering (<<<<<<< ours / ======= / >>>>>>> theirs) for src/auth.ts, a clean-file diff view for agent-3, the **withheld-secret state** for agent-5, the **reveal affordance** on secret rows, the **comments thread** (existing comment + compose box, optimistic append), close on Esc + button.
3. **Files browser** — repo picker (agent-1..5), breadcrumb, dir tree (dirs first: `config/`, `src/`, `README.md`…), viewer states: TEXT (mono, line numbers), BINARY (metadata-only posture), SECRET (`config/.env`: “secret-class — key names only”, keys listed, **Reveal** button → click → shows the granted value with the audit note `decision: granted`), raw link (hidden on secret), skeleton while “loading”.
4. **History** — commit list (sha, message, author, date), click → changed files (status word, ±, asset chips), root-commit note, back to files.
5. **Forks & signals** — fork cards w/ six-cluster chips (unmeasured shown as such) + policy chips (`land manual`, `secrets refused`) + lineage (`base: demo`).
6. **Sessions** — rows w/ state dots (working/idle), intent, last activity; **steer composer** (≤500 chars, sends → appears in the ticker as `session.steered`, honest v1 note: lands in the event stream the agents read).
7. **Issues** — derived list w/ kind chips (conflict / withheld-secret / stale-base / blocked-intent), severity, repo, links to the relevant card/file.
8. **Agents roster** + **Harnesses** — compact tables/lists from the dataset (policy chips; BYO kind chip).
9. **Parity dashboard** — chips (5/8/5) + 18-row table w/ verdict chips (exceeds/parity/below) and evidence column.
10. **Tour** — ≥8-step guided overlay/stepper that walks the console (Intro → the grid → checks → conflicts → judge & land → secrets & reveal → forks → evidence), with Next/Back + progress.
11. **Reveal audit note** + **evidence receipt view** — a land receipt panel rendering the 12-key evidence (incl. mergedSha==testedSha pass) and the audit record line for granted reveals.
12. **Judge panel** (inside the land sheet or a drawer) — risk/intent/collision verdict chips, skipped[] reasons (secret-class, content-secret), fail-closed 503 copy.
13. **Upstream/merge-back + floors + intents router** (light touch — one composite “platform pulse” strip or panel: floors count, intents router verdict `merge-it` for agent-3, upstream merge-back note) — include so nothing built is invisible.

## Craft requirements

- View switching < 100ms apparent (instant DOM toggle), skeleton shimmers on artificial “loads”, ticker animates, modal enters with a real transition, land confirm has staggered reveal.
- Typography: real scale + pairing per your design system; tabular numerals for stats/shas; mono for shas/paths/diffs only.
- Accessibility floor: focus-visible states, Esc closes modals, buttons are buttons, contrast AA.
- NO external fonts/CDN (system stacks or @font-face-free); no images (CSS-drawn glyphs/patterns ok); everything inline in ONE file.
- Follow your assigned design system's palette/typography/spacing rigorously — the ten prototypes must look like ten different products. Where the DS conflicts with the dataset (e.g. none), adapt the DS, keep the data.

**Self-check before finishing** (put results in a comment at the top of the file): every numbered surface present; every listed interaction wired; no console errors; single-file; opens from `file://`.
