# NextGit — the convergence layer for agent-era software collaboration

Agents write code faster than anyone can review it — and they write it in parallel. Across 33,596 agent-authored pull requests, **41.7% of cross-agent pairs conflict** (arXiv:2607.04697) — twice the intra-agent rate. Today's tools review one change at a time; you find the collision at the second merge. NextGit shows **every concurrent agent proposal as one set** — intents, diffs, real conflict detection, typed judgments — and lands the one you choose with a **single click, server-side**.

**Live:** https://nextgit-platform.john-b7d.workers.dev/ · guided tour: [`/tour.html`](https://nextgit-platform.john-b7d.workers.dev/tour.html)

Built for Cloudflare's *Build the Next-Gen Git Platform on Cloudflare* competition — on Workers + Artifacts, with no mocks: the demo runs on the real platform.

## What the demo shows

| | |
|---|---|
| **Concurrent workspaces** | Each agent works in its own fork of the baseline — no shared checkout, no locks |
| **Change-sets** | Read server-side through the Artifacts binding — the reviewer never clones |
| **The set view** | All proposals plus a conflict map **computed by actually attempting the merge** (3-way diff3) |
| **Judge layer** | Cloudflare **Clef** (Workers AI) scores risk, verifies intent-vs-diff, flags semantic collisions — typed answers, advisory only |
| **Landing** | One click; concurrency-safe (stale/base-moved → 409); every landing carries an evidence record (ancestor, heads, fold hash) |
| **Trust** | Secret-class files render schema-only — key names, never values — and the judge skips them rather than judging blind |

## Run it yourself

Requirements: Node 22+, a Cloudflare account with **Artifacts** (open beta) + Workers, and the repo's pinned `wrangler` (devDependency of `platform/`).

Point the scripts at **your** account and worker — they default to the competition demo environment otherwise:

```bash
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
export NEXTGIT_PLATFORM=https://<your-worker>.workers.dev
```

(`CLOUDFLARE_API_TOKEN` is honored if set; otherwise the scripts use your `wrangler login` session.)

```bash
# 1. deploy the platform worker (Artifacts binding + Workers AI binding)
cd platform && npx wrangler login && npx wrangler deploy

# 2. seed the baseline, run the real agent fleet, add the secret fixture
cd .. && node platform/scripts/seed.mjs
node platform/scripts/real-agents.mjs       # real CLI agents work in their own forks
node platform/scripts/secret-fixture.mjs    # agent-5 — the secret-class fixture (idempotent)

# 3. the state gate — expects 25/25
node platform/scripts/demo-verify.mjs
```

## Signed validation evidence (attestations)

Every successful landing carries a **signed attestation** —
what ran, on which inputs, in which environment, with what
result — stored in two places (the landing record and the
`nextgit-evidence` R2 bucket) and **verifiable later** by
anyone with the pinned public key. Details:
`platform/CONTRACT.md` §Attestations. Provision it once:

```bash
cd platform
npx wrangler r2 bucket create nextgit-evidence    # NO lifecycle rule — retention is the feature
node scripts/attestation-keygen.mjs --keep           # → public key + staging file
printf '%s' "$(cat .attest-key.b64)" | npx wrangler secret put EVIDENCE_SIGNING_KEY   # piped; never argv
# add EVIDENCE_PUBLIC_KEY to wrangler.jsonc vars + the CONTRACT.md pin; rm the staging file
npx wrangler deploy
```

Verify any landing later:

```bash
node platform/scripts/attest-verify.mjs --commit <sha> --base https://nextgit-platform.john-b7d.workers.dev --r2-copy
```

Open the worker URL: `/` for the triage app, `/tour.html` for the guided tour. To ship one: click **Land into demo** on a clean card (the platform commits and pushes it for you).

The full step-by-step sequence — env prerequisites, per-step expected observables, and the retry playbook — lives in the operator runbook: [`platform/scripts/README.md`](platform/scripts/README.md).

## Repo map

- `platform/` — the platform: worker (`src/`), triage UI (`ui/`), demo scripts (`scripts/`), **API contract (`CONTRACT.md`)**, wrangler config
- `docs/` — the working spine: `STATE.md`, `CHECKPOINT.md`, `judge-layer-ideas.md` (36 decision-model use-cases)
- `_bmad-output/` — product artifacts: spec, brief, PRD, research dossiers, demo video script
- `porting/` — the build loop: work-order runners, live probes (`tests/`), certifications

## Scope, honestly

This is the **convergence layer** — the piece today's hosts don't have. Repo browsing, issues, CI, and the game-asset pipeline (huge binaries, locking, per-file ACLs) are roadmap by design: the competition asks for the layer GitHub lacks, not GitHub rebuilt. The **API is the product** (`platform/CONTRACT.md`); the web UI — and, later, any client (IDE, CLI, a 3D office) — is a surface on it.

## License

MIT — see [`LICENSE`](LICENSE).
