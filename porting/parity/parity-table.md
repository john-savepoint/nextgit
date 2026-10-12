# Capability parity — NextGit vs GitHub baseline

Generated: 2026-10-12T23:45:27Z — derived by `bun porting/parity/compare.mjs` (verdicts are computed, never hand-authored).

Verdicts: **exceeds** = NextGit shipped where GitHub has none · **parity** = both sides (or both absent) · **below** = GitHub shipped/partial where NextGit has none (or only a partial capability).

| Verdict | Dimension | GitHub | NextGit |
|---|---|---|---|
| below | Steer/track individual agent sessions live | shipped | none |
| parity | N isolated workspaces from one baseline | shipped | shipped |
| parity | Per-change diffs vs baseline, server-side | shipped | shipped |
| exceeds | Conflict map across concurrent changes | none | shipped |
| exceeds | N concurrent proposals as one comparable set | none | shipped |
| exceeds | Per-change intent record, durable across rebases | none | shipped |
| parity | Push-style event feed driving the UI | shipped | shipped |
| parity | Land a chosen change with validation evidence | shipped | shipped |
| exceeds | Secret-class files as typed objects, masked by default | none | shipped |
| below | Agent access policies managed like developers | shipped | partial |
| exceeds | Typed advisory judgments over the set | none | shipped |
| below | Inline per-line review comments on a change | shipped | none |
| below | Third-party agents hosted inside the platform | shipped | partial |
| below | File/repo browser | shipped | none |
| below | Issue tracker | shipped | none |
| below | CI/CD pipeline integration | shipped | none |
| parity | Ordered merge queue | shipped | shipped |
| parity | Native stacked diffs | none | none |

Summary: 5 exceeds · 6 parity · 7 below (of 18 dimensions).
