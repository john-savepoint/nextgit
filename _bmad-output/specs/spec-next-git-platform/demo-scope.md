# Demo Scope — locked; submission 2026-10-14

## MoSCoW

| | Items |
|---|---|
| **MUST** | set-level triage canvas · concurrent agent workspaces · cross-proposal conflict map · per-proposal intent record · live push events to UI |
| **SHOULD** | secret-typed files · speculative validation · git-notes provenance · authoring lease · change-set identity |
| **COULD** | auto-changelog · GitLens-class parity · PM integration · pod/container visualization |
| **WON'T** | Agent Office 3D face · 10M-node mesh · full PM system · full binary pipeline |

The five MUSTs are the minimum shippable proof of the convergence layer. Everything else is roadmap or a later increment.

## MUST → capability map

| MUST | CAP |
|---|---|
| set-level triage canvas | CAP-4 |
| concurrent agent workspaces | CAP-1 |
| cross-proposal conflict map | CAP-3 |
| per-proposal intent record | CAP-5 |
| live push events to UI | CAP-6 |

SHOULD map: secret-typed files → CAP-8 · speculative validation → CAP-7 · git-notes provenance → CAP-5 · authoring lease → CAP-5 · change-set identity → CAP-2.

## Demo story (one uninterrupted take)

1. One repository; 3–5 agents provisioned as isolated workspaces (CAP-1).
2. A deliberate cross-agent collision on the same files.
3. The platform detects the overlap and renders the conflict map (CAP-3); pushes flow live (CAP-6).
4. Every proposal routes to the triage canvas as a card — intent, diff, risk, conflict map, provenance (CAP-4, CAP-5).
5. The reviewer (and/or a judge agent) compares the set; one proposal lands with validation evidence (CAP-7); the decision record persists as a git note (CAP-5).
6. Secret-typed file beat: schema-only view; a leak is scrubbed at commit (CAP-8).

## Rubric mapping

| Axis | Weight | What the demo shows |
|---|---|---|
| Originality & prototype quality | 50% | the set-level reconciliation layer itself — verified absent in the market |
| Multi-agent concurrency | 25% | simultaneous workspaces · coordination signals · context preservation · conflict handling |
| Ease of use / UX | 25% | one canvas; the whole set at a glance; no tab-hopping |
