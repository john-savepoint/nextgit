# Story compile schema — frozen contract v1 (2026-10-06)

The contract every `epics-author` writes to and every `story-verifier` checks against. Frozen meaning:
changes require a version bump here first; authors never invent shapes.

## Pipeline (who writes what)

```
requirements.json        ← porting/compile/extract.mjs (deterministic; FRs+NFRs+UX-DRs+arch)
epics.proposed.json      ← epics-designer (agent; persisted by the orchestrator)
slices.json              ← wf-epics.ddw.js planSlices (deterministic)
packs/<sliceId>.md       ← wf-epics.ddw.js (deterministic; each author's full context)
slices/<sliceId>.json    ← epics-author (ONE author per slice; the only writer)
verdicts/<sliceId>.json  ← story-verifier (ONE verifier per slice; maker-checker)
lint.json                ← wf-epics.ddw.js lint (deterministic)
backfill-review.md       ← wf-epics.ddw.js compileIn (deterministic)
compile-report.{md,json} ← wf-epics.ddw.js compileIn
```

## Slice file (author output)

```json
{
  "slice": "<sliceId>",
  "epic": "<epicId>",
  "kind": "implementation | verification",
  "stories": [ /* Story rows — see below */ ]
}
```

## Story row

| Field | Rule |
|---|---|
| `id` | Stable slug, ≤60 chars, **LOWERCASE ONLY**: `<epic-lowercased>-<impl\|verify>-<short-slug>` (e.g. `e13-impl-declare-intent`). Unique within the compile; must not collide with an existing store row of a different source (verifier checks). Same title → same id on re-compile (idempotent upsert). The compiler runs a deterministic normalize pass (lowercases ids + deps) after authoring, before verify. |
| `title` | Imperative, specific ("Render withheld-secret card state"), not a topic. |
| `kind` | `implementation` (build it) or `verification` (prove a built behavior + attach evidence). **A built requirement NEVER gets a rebuild story.** |
| `epic` | The epic id from `epics.proposed.json`. |
| `milestone` | `M1` \| `M2` \| `M3` \| `M4` \| `unsequenced`. Use the requirement's status hint; `roadmap` → `unsequenced`. |
| `priority` | `P0` (competition critical path: M1 demo/reland/submission) · `P1` (other M1 + M2) · `P2` (M3) · `P3` (M4 / unsequenced). |
| `fr_refs` | Array of requirement ids this story covers (`FR-*`, `NFR-*`, `UX-DR-*`). Every assigned requirement must appear in ≥1 story's refs. |
| `scope` | What/where: files, seams, endpoint refs, pointers (CONTRACT.md sections, AD refs). Enough that an implementer plans without re-reading everything. |
| `acceptance` | Observable + testable — exact copy where the PRD gives it; otherwise Given/When/Then. Never "works correctly". |
| `check_cmd` | A REAL executable command, runnable from the repo root, that proves the acceptance. No placeholders/TBD. Prefer the repo's suites: `bun porting/tests/*.test.mjs`, `node --check`, `curl`+`jq` patterns. With this box's jaq: use `-ec` (never `-c`). |
| `deps` | Array of story ids (same compile) or existing store row ids, verified to exist. Prefer `[]`; deps are a scheduling cost. No cycles. |
| `notes` | Optional: overlap notes, dedupe rationale. |

## Status-aware coverage (the law)

| Requirement status (raw) | Required coverage |
|---|---|
| `built …` (incl. compound "built (…) / …") | ≥1 **verification** story (prove + evidence). Never a rebuild. |
| `build-gap` / `required-M1` / `planned` / `not started` / `pending` / `sequenced (Mn)` / `roadmap` | ≥1 **implementation** story (staged; roadmap → `unsequenced`). |
| NFRs, UX-DRs | ≥1 story of the appropriate kind (implementation when the behavior is missing; verification when it exists and needs proof). |

Coverage is checked by the deterministic lint (`lint.json`) across ALL slices — not per-slice. The verifier checks that the slice's own assignments are covered.

## IDs & idempotent re-compile

- Deterministic slugs; the compile is re-runnable — same id upserts in place (content fields update; **status/evidence are preserved** by `tasks.mjs upsert`; a done story is never demoted).
- A NEW compile never deletes rows. Rows that lose coverage in a re-compile are listed in the report for review.

## Registry mapping (compile-in)

- Epics → `epics` table (`id, title, goal, milestone, status, source`).
- Stories → `tasks` rows: `status='blocked'` (staged), `source='compile:<compileId>'`, `epic_id`, `fr_refs` (comma-joined), `check_cmd`, `deps`, `acceptance`, `scope`, `priority`.
- **Activation gate**: staged rows stay `blocked` until explicitly activated (`bun porting/tasks.mjs activate compile:<compileId>`) after the batch consumer contract (acceptance/deps reads) is confirmed. Blocked rows are never picked by a batch.

## Verdict file (story-verifier output)

```json
{
  "slice": "<sliceId>",
  "verdict": "SHIP | BLOCK",
  "findings": [ { "severity": "critical|high|medium|low", "story": "<id?>", "note": "..." } ],
  "summary": "≤3 lines"
}
```

`SHIP` requires 0 critical + 0 high. Anything else blocks the slice; blocked slices are repaired by the same author role with findings attached, then re-verified (≤2 rounds).

## Dedupe vs existing rows

Each pack lists existing store rows overlapping the slice (token overlap, deterministic). Authors:
- do not recreate equivalent work — reference it in `notes` and author only the delta;
- still ensure requirement coverage (the existing row reference goes in notes; coverage is judged against compiled stories — if the existing row genuinely IS the coverage, author a minimal verification-style story that closes it with evidence).
