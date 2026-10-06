# NextGit — demo video script (single take)

| | |
|---|---|
| Status | ready to record |
| Date | 2026-10-06 |
| Target | Cloudflare next-gen Git platform competition entry — submitted 2026-10-14, winner presents at Cloudflare Connect SF (Oct 21) |
| Live URL | `https://nextgit-platform.john-b7d.workers.dev/` |
| Format | one uninterrupted take — screen capture of the live app, narration spoken over it |
| Register | every number is either sourced (footnote 1) or read off the live screen at record time. `{braces}` = read the value off the screen while recording; never say a value the screen isn't showing. |

Spoken lines below are the words to say; stage directions are in *[brackets]*. Total 7:30 nominal — inside the 5–10 min window with ~2:30 of pause/point slack.

| # | Beat | Time | Window |
|---|---|---|---|
| 1 | Cold open | 30s | 0:00–0:30 |
| 2 | The fleet | 90s | 0:30–2:00 |
| 3 | The collision | 90s | 2:00–3:30 |
| 4 | The judge | 90s | 3:30–5:00 |
| 5 | The click | 90s | 5:00–6:30 |
| 6 | The close | 60s | 6:30–7:30 |

## PRE-FLIGHT (start T-25 min; agents can take a while)

Reset the world — baseline, then the agent fleet + the secret fixture:

```bash
cd <repo root>
node platform/scripts/seed.mjs             # restores demo @ main to the baseline skeleton (no-op if already current)
node platform/scripts/real-agents.mjs      # deletes + re-forks agent-1…4, runs real CLI agents, pushes, attaches intent notes
node platform/scripts/secret-fixture.mjs   # ensures agent-5 (the secret-class fixture) — idempotent
```

`real-agents` launches the four agent runs; today all four run on **omp** (Codex was usage-limited at reset — if it's back, prefer two Codex / two omp and say what you see). Starved agents are retried serially and can take up to 8 min each — budget 10–15 min. Scratch output: `/tmp/real-agents/report.md`, `/tmp/nextgit-agents.json`. A retry for one agent: `node platform/scripts/real-agents.mjs --only agent-3`.

Wait criteria before rolling:
- **Namespace exactly `{demo, agent-1…agent-5}`** — a stray `agent-*` repo (e.g. another session's scratch) shows up as a junk card and fails the gate. Wait for any concurrent producer to go quiet.
- `demo` head = the seeded baseline `6a5dac97` (no landings yet — beat 5 does the landing live).
- Then take the full gate to green:

```bash
node platform/scripts/demo-verify.mjs   # 25/25 PASS — the pre-recording gate; transient connect stalls self-retry
```

Target chip numbers: `proposals 5 · shared files 1 · conflicting pairs 1 · changed files 4 · clean pairs 0` — read the live values on the take.

Browser, before rolling:

- Open `https://nextgit-platform.john-b7d.workers.dev/` — one tab, URL bar visible, auto-refresh (8s) checked, no devtools, notifications off.
- Window ≥1080p (1920×1080, zoom 100%) — the triage app is desktop-first.
- Wait until judge chips render on the cards (first `/judge` takes a few seconds) — then **do not reload**; a reload restarts the 30s judge throttle.
- Confirm the `conflicting pairs 1` chip is alert-tinted. That chip is beat 3's cue.

During the take, narrate live or record clean and dub the lines — the pacing below assumes spoken-over-screen.

---

## BEAT 1 — COLD OPEN — 0:00–0:30 (30s)

**On screen:** the live app, full page, cards and ticker visible; no interaction. Keep the URL bar in frame.

**Spoken:**
> Four agents just changed the same repository — at the same time, each in its own isolated workspace. None of this is a mockup: real CLI agents, real pushes, minutes ago.
> Here's the problem it addresses. Agents write code faster than anyone can review it, and they write it in parallel. A July 2026 study replayed the three-way merges on agent-authored pull requests: **41.7% of cross-agent pairs conflict** — twice the rate within a single agent.¹ On today's tools you find that out at the second merge. Here, you find out before the first.

**Live data:** `GET /health` → `{ok:true}` (platform reachable); the on-screen fleet proves the claim — four agent cards plus the secret fixture, no spoken number unsourced.

## BEAT 2 — THE FLEET — 0:30–2:00 (90s)

**On screen:** header summary chips (`proposals 5 · shared files 1 · conflicting pairs 1 · changed files 4 · clean pairs 0` — read live), then pan across the five cards in **Concurrent Proposals**; the **events** ticker sits just below the header — keep its pulse dot visible.

**Spoken:**
> This is the set view — every proposal at once. One repo, `demo`. Four agents — all omp in this take; each ran in its own isolated fork, no shared checkout, no locks, no coordination between them.
> Every card carries the task that agent was given, read straight off the commit's git note. agent-1: add `refreshSession`. agent-2: tolerate clock skew in `isExpired`. agent-3: a read-through memo cache for the store. agent-4: a feature-flag module. The fifth card is the fixture: agent-5 — a config file the platform types as secret-class on sight.
> Those cards arrived on their own, as pushes came in — that ticker is the platform's event stream. Nothing on this page was typed in by hand. Five proposals, one screen — triage the set, not one item at a time.

*[Point at each card's intent line as you read it. If a chip count differs, say the count you see.]*

**Live data:** `GET /proposals?base=demo` → `.proposals[]` length 5 — four with those `intent` strings, plus the secret fixture; `GET /events` → newest events are the agent-repo pushes.

## BEAT 3 — THE COLLISION — 2:00–3:30 (90s)

**On screen:** scroll from the chips to the **Convergence Conflicts** panel (meta `1 detected`): file `src/auth.ts`, badge `text-conflict`, `proposals: agent-1 agent-2`, pair row `agent-1 ↔ agent-2 · text-conflict · (base: 2L, agent-1: 7L, agent-2: 2L)`. Let it sit; this panel is read-only.

**Spoken:**
> Look at the top of the set. agent-1 and agent-2 both edited `src/auth.ts` — different functions, adjacent lines, and the merge still doesn't apply. Nobody declared this conflict. The platform found it by actually attempting the merge: three-way, shared ancestor, diff3 — and it fails. One file, one pair, and you can see the regions: two base lines, seven from agent-1, two from agent-2.
> That's the point — this isn't a warning someone typed into a dashboard. It's a failed merge, surfaced early.
> Compare the normal flow. GitHub shows you two pull requests; each one looks fine on its own. They collide when you merge the second one. This is the same information, computed before either change lands.

**Live data:** `GET /proposals` → `summary.conflictingPairs: 1`, `conflicts[0] = {file:"src/auth.ts", repos:["agent-1","agent-2"], kind:"text-conflict", pairs[0].region {baseLines:2, aLines:7, bLines:2}}`.

## BEAT 4 — THE JUDGE — 3:30–5:00 (90s)

**On screen:** the chips on the cards: `risk: {label}`, `intent verified` / `intent mismatch` / `insufficient`, `overclaim {value}`. Point at each card; the values differ per card — read them as shown. (An already-landed or skipped card shows no chips — that's correct.)

**Spoken:**
> Every card also carries a judgment — three typed signals, computed inside the platform. Risk: routine, focused, or senior-security — the thresholds live in code, not in the model. Intent: does the diff actually do what the note claims — verified, mismatch, or insufficient. And an overclaim probability — how much the change talks bigger than it acts. Here: {read the chips as rendered}.
> This is Clef, Cloudflare's open decision model, running on Workers AI through the platform's own binding — the judgment is one call, typed answers, no prose. The judge writes nothing and lands nothing. **The judge advises; code decides; humans still own irreversible acts.**
> And the semantics stay honest: if a proposal is skipped — a secret-class file, or nothing left to merge — it shows no chips at all, because a skip is not a verdict. agent-5 is the case in point: its card shows the file is secret-typed — you can see the key names, never the values — and the judge skips it outright. Once a card lands, it drops its chips — no stale opinions on merged code.

**Live data:** the rendered chips themselves (from `POST /judge`, `model: @cf/cloudflare/clef`); skipped repos render no chips by design — `POST /judge` → `skipped:[{repo:"agent-5",reason:"secret-class"}]`. Numbers jitter between runs — never pre-commit to one on camera.

## BEAT 5 — THE CLICK — 5:00–6:30 (90s)

**On screen, in order:** click `preview merge` on agent-3 → modal computes diff3, status `clean` on `src/store.ts` → `close` → `Land into demo` → `confirm land?` → `landing...` → success banner `Successfully landed proposal agent-3 into demo. Commit {8-char sha}` → card dims with `landed` badge and banner `landed — nothing pending` / `All changes from this branch have been merged into baseline.` → ticker gains a push event for `demo`.

**Spoken:**
> Let's ship one. agent-3 — the memo cache in `store.ts`; no one else is near that file. First, preview the landing: the platform computes the real merge, per file — diff3 again — and it projects clean.
> Now land it. One click, one confirm … and it's in. That commit was created and pushed by the platform itself, server-side — there is no clone on this machine and no terminal.
> The card collapses: landed — nothing pending. And there's the evidence: the commit on the banner, and the push event down in the ticker. That's what landed code looks like on the set view — done, receipted, out of the queue.

**Live data:** `POST /land {base:"demo", repos:["agent-3"]}` → `200 {landed:{repos,commit,files,at}}`; the banner shows the commit's first 8 chars; `/events` gains `repo.pushed` for `demo`.

## BEAT 6 — THE CLOSE — 6:30–7:30 (60s)

**On screen:** the full app, static — conflict panel, remaining cards, ticker. Stop moving the mouse.

**Spoken:**
> What you've seen is one repo, four agents, five proposals, one collision, one landing. The layer underneath is the point: proposals carry intent and provenance; collisions are computed by attempting the merge; judgments are typed, cheap, and advisory; landing is an API call.
> The same API that renders this page can serve an IDE, a CLI — and, later, the 3D office: clients are surfaces, the platform is the heart. This is our entry in Cloudflare's next-gen Git platform competition, built on Workers, Artifacts, and Clef — and it is running at this URL right now.
> Convergence is the missing layer of the agent era. This is our first cut at it.

---

## SHOT-RISK

| Risk | Early signal | Fallback |
|---|---|---|
| An agent run comes back empty or times out (CLIs starve each other; retries are serial) | `report.md` row `fail`; `/proposals` count < 4 | Re-run `node platform/scripts/real-agents.mjs --only agent-N`. If a second agent still fails, record with 3 proposals — but only if the agent-1×agent-2 conflict exists; spoken counts are read off the chips, so say the count you see. |
| Judge chips missing (fail-closed 503, or a reload reset the 30s throttle) | cards render without chips | Wait ~30s; reload once and wait for chips; if still absent, record the judge beat narrating the contract as the UI honestly shows it — never fake or retouch chips. Re-shoot when the layer is available. |
| Chip values differ from rehearsal (sampling jitter; risk labels can flip) | values on screen ≠ rehearsal notes | Read every value off the screen mid-sentence — the script uses `{…}` placeholders exactly for this. No spoken number is fixed in advance. |
| Land fails live | banner: `conflict` / `no-changes` / `push-failed` | `conflict` → land agent-4 instead; `no-changes` → the card was already empty, land agent-4; `500` → retry once (a single pre-confirmed land is the hardened path). If it still fails, keep the take — the failure banner is honest product behavior — and use the retry as the final shot. |
| Ticker clutter: scratch-repo events (`racebase`, `robase2`, …) from earlier test sessions | non-demo repo names in the ticker | Ignore them on camera; this run's agent pushes are newest. Don't narrate repo names that aren't in the story. |
| Connection banner appears (any fetch failed) | red bar + `Retry now` | Click `Retry now`; all state is server-side — nothing is lost. Resume the sentence. |
| Window wrong for capture (sub-1080p, zoom ≠ 100%) | cramped cards, clipped chips | Fix before rolling; verify the header chips and a full card fit in frame. |

## Secret beat — now IN the take (folded)

agent-5 (the reset's secret fixture) makes the secret-class path live and demoable: its card renders schema-only — key names visible, values never — and `/judge` skips it (`reason: secret-class`). Delivered via BEAT 2's fifth card + BEAT 4's closing lines. Still NOT demoable: scrub-on-land for secret files (agent-5 never lands in this take) — don't claim it on camera.

## Sources

1. Xu, G., Subramanian, A., Karthik, N. — *AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates*, arXiv:2607.04697, 2026-07-06. AIDev-pop: 33,596 agent-authored PRs across 2,807 repositories; 747 co-active pairs replayed through three-way git merges → 41.7% textual conflict cross-agent vs 19.8% intra-agent. Abstract verified 2026-10-06; the project's feature-matrix dossier [11] carries the same figures.
