# Brief ↔ Spines Reconciliation — NextGit UX run

Sources: draft product brief (`brief.md` + `addendum.md`, status: draft; per `brief-extract.md:4` and `.memlog.md:23` a **draft peer, NOT canon**) against the finalized spines (`DESIGN.md`, `EXPERIENCE.md`, updated 2026-10-05). Spines carry reality; where the brief collides, this file records the collision — it does not adjudicate. Brief side cited `brief.md:NN` / `addendum.md:NN`; spine side `DESIGN.md:NN` / `EXPERIENCE.md:NN`; extract entries `brief-extract.md §6.N`.

## 1. Incorporated (16)

1. Set-level premise — everything on one canvas, no paging, whole set at a glance — `EXPERIENCE.md:28, :183, :224-225`; `DESIGN.md:393` ↔ `brief.md:14, :20, :24`.
2. One screen, every concurrent proposal as a card — `EXPERIENCE.md:43`; `DESIGN.md:538` ↔ `brief.md:24`.
3. Card anatomy: written intent / what it touched / where it came from — `EXPERIENCE.md:97`; `DESIGN.md:540, :582` ↔ `brief.md:24`.
4. Collision status computed by actually attempting the merge → conflict map (kinds, pairs, line regions) — `EXPERIENCE.md:42, :103, :212`; `DESIGN.md:549-557` ↔ `brief.md:24`.
5. Interaction set: compare the set / preview any landing / read any diff / ship — `EXPERIENCE.md:44-46, :127-149`; `DESIGN.md:577-579` ↔ `brief.md:24`.
6. One-click server-side landing; no clones, no CLI — `EXPERIENCE.md:24, :127-129`; `DESIGN.md:529` ↔ `brief.md:14, :24`.
7. Isolated workspaces per agent (fork-per-agent) — `EXPERIENCE.md:210` ↔ `brief.md:24`.
8. Live event flow (pushes appear in seconds) → events ticker + land-triggered reload — `EXPERIENCE.md:41, :104-105, :129` ↔ `brief.md:24` ("no polling" wording aside — §2.3).
9. Secret-typed files: key names visible, values never; blocked landing; schema-only views — `EXPERIENCE.md:98, :120, :130, :140, :148, :215`; `DESIGN.md:547, :630` ↔ `brief.md:24, :31`.
10. Provenance via git notes — `EXPERIENCE.md:214` ↔ `brief.md:45`.
11. Interactive tour — `EXPERIENCE.md:20, :50-65, :239-246` ↔ `brief.md:45`.
12. Judge layer as near-term extension in the chip language; "the judge advises; code decides" — `DESIGN.md:397, :606-614`; `EXPERIENCE.md:273` ↔ `brief.md:14, :24, :45` (planned framing corrected — §2.2).
13. API-first: platform is the heart, clients are surfaces — `EXPERIENCE.md:25` (cites `brief.md:30`) ↔ `brief.md:30`.
14. Stakes: competition gate Oct 14, 5–10-min video, UX 25% of score — `EXPERIENCE.md:27` ↔ `brief.md:39`.
15. Experience outcome "convergent"; triage on one screen in minutes — `DESIGN.md:399`; `EXPERIENCE.md:225` ↔ `brief.md:24, :35`.
16. Demo proof beats: ≥1 collision pre-land, one-click landing, secret masking + provenance visible — `EXPERIENCE.md:210-215` ↔ `brief.md:40`.

## 2. Deliberately not adopted / superseded (5)

1. **"fleet view" naming** — as-built labels stand ("Concurrent Proposals", "Convergence Conflicts"); coinage not canon — `EXPERIENCE.md:32, :275`; `DESIGN.md:399` ↔ `brief.md:24, :51`.
2. **Judge-layer-as-live framing** — chips are planned P0, not rendered; no live scoring/verification today — `EXPERIENCE.md:273`; `DESIGN.md:606, :614` ↔ `brief.md:14, :24, :45`.
3. **"no polling" wording** — as-built polls `/events` 2s and `/proposals` 8s; push-style is a product goal, delta flagged — `EXPERIENCE.md:41, :105, :182, :275` ↔ `brief.md:24`.
4. **"access-controlled" secrets wording** — masking is path-driven by design; elevated reveal (CAP-8) unbuilt; schema-only views — `EXPERIENCE.md:120, :273` (via `CONTRACT.md:110`) ↔ `brief.md:24, :31`.
5. **Landing "validation evidence attached"** — receipt is the short commit SHA only; `landed.files`/`at` unrendered — `EXPERIENCE.md:129, :269, :275`; `DESIGN.md:586` ↔ `brief.md:24, :40`.

## 3. Dropped qualitative ideas — no home in either spine (12)

Spine side for every row: no occurrence in `DESIGN.md` or `EXPERIENCE.md`; closest partial cited inline. Surface only, not fixed here.

1. Executive stats + competitive claims: "bottleneck moved to converging", 41.7% / 15–31%, six / 6+ sweeps, nearest-competitor list, timing-moat assumption — `brief.md:12, :14, :28, :29`; `addendum.md:15-17`.
2. Why-now substrate: Artifacts / Workers / Queues / Durable Objects + Clef characterization and costs — `brief.md:16`; `addendum.md:19`.
3. Secondary personas: game studios (asset scale), agent-harness builders, "machine-legible first" — `brief.md:35` (spines only note the office 3D client as a future API consumer, `EXPERIENCE.md:25`).
4. Adoption signals beyond the competition: API used in anger, second client rendering live state, proposals-landed-per-week metric — `brief.md:41`.
5. Vision/timeline: "make GitHub irrelevant", Year 1/2–3 roadmap, workspaces as default home, game-asset tier, clients multiply — `brief.md:51`.
6. Harness commitments: omp, codex, harness routing — `brief.md:45` (spines harness-agnostic: `EXPERIENCE.md:206` agent-1…4).
7. Reproducible-from-committed-scripts demo criterion — `brief.md:40`.
8. New non-goals + parked alternatives: multi-tenant hardening, billing; GitHub-bolted-on rejected, rebuild-PM parked — `brief.md:47`; `addendum.md:25-28` (office-first partially lands as out-of-scope API consumer, `EXPERIENCE.md:25`).
9. Scale framing: N≥4 floor, 12–50 target, 20–50-proposals budget item — `brief.md:40, :58` (interacts with all-cards set view, `EXPERIENCE.md:97, :183`; also §4.4).
10. Open unknowns: eligibility (US/Canada), working name, deferred business model — `brief.md:55-57`.
11. Evidence-pack incidents: GitHub merge-queue silent deletions; Cloudflare internal review stats — `addendum.md:20-21`.
12. Judge-layer calibration thresholds (tune on labeled proposals before gating) — `brief.md:59`.

## 4. Conflicts needing user adjudication (4 live; 7 resolved-by-spine noted)

**Live:**
1. Protagonist — brief primary = teams + reviewer/conductor (`brief.md:35`); spines keep **John, solo operator** as demo protagonist under `[ASSUMPTION]` pending intake (`EXPERIENCE.md:206, :264`; memlog `:18` "[confirm or correct]"; extract §6.3).
2. Concerns floor — brief silent on light mode / mobile / i18n / offline / accessibility; spines ship dark-only, English-only, web-only with WCAG 2.2 AA proposed, all `[ASSUMPTION]`/open (`DESIGN.md:401`; `EXPERIENCE.md:23, :187, :250, :264`; extract §6.17; memlog `:20`).
3. Connect presentation — addendum "3 finalists present live" (`addendum.md:18`) vs canon "winner presents" (`SPEC.md:50`); non-UX, no spine coverage (extract §6.10).
4. Scale framing — N≥4 / 12–50 target and 20–50-proposal budget (`brief.md:40, :58`) vs four-crew demo (`EXPERIENCE.md:206`) and the no-paging, all-cards set view (`EXPERIENCE.md:97, :183`; extract §6.8, §6.14).

**Resolved by the spines keeping reality as canon (no adjudication needed unless the user overturns):** judge layer → planned P0 (`EXPERIENCE.md:273`; `DESIGN.md:606`); "no polling" → 2s/8s polling (`EXPERIENCE.md:182`); "evidence attached" → short-SHA receipt (`EXPERIENCE.md:275`); "access-controlled" → path-driven masking (`EXPERIENCE.md:273`); "fleet view" → as-built labels (`EXPERIENCE.md:32`); visual-identity gap → codified in `DESIGN.md:391-401` (extract §6.4); draft-status posture → brief treated as draft peer (`DESIGN.md:399`; extract §6.16).

---
Counts: incorporated 16 · superseded 5 · dropped 12 · live conflicts 4 (7 more resolved by spines).
