---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Many AI agents, one repo — every change triaged, proven, and signed."
destination: youtube
aspect: 1920x1080
language: en
length: 70s
audience: developers, engineering leads, and the agent-tooling crowd
angle: convergence-room flythrough — the agent floor's work lands in one triage view, then the proof layer, then shipping together
---

## Intent

Promote NextGit — the agentic git platform. Five AI agent workspaces
(`agent-1`..`agent-5`) propose into one repo at once; the platform makes
the whole set legible in one place: convergence conflicts, fork signals,
merge previews, secret-class files, signed attestations, sessions with
steer, derived issues, honest parity. Tone: punchy and fun, high-energy,
product-UI-forward with kinetic type. Sell three things, in this order
of emphasis: (1) the AI implementation agent (a whole floor of agents,
sessions you steer, proposals with intent), (2) the security model
(secret typing, audited repo-scoped reveal, Ed25519 attestations,
never-green honesty), (3) the social layer (review the set together,
comments, conflicts as a shared artifact).

## Assets

- Live platform, canonical demo state (demo-verify PASS 25/25):
  `https://nextgit-platform.john-b7d.workers.dev` — all product screens
  in the video are fresh real captures of this deployment.
- Source repo demo materials: `docs/DEMO-STORY.md` (surface list +
  honesty laws; the recording discipline this capture honors).

## Customizations

- Capture surfaces: `/` (proposal grid, convergence conflicts, fork
  signals, convergence rail, pipelines, judge-set comparison — the
  AI-judges-AI surface), merge preview modal (clean + conflicting),
  `/files.html` (agent-5 secret-class + audited reveal),
  `/history.html`, `/parity.html`, `/tour.html`.
- Component macros: lift the five-check strip, the attestation badge,
  the reveal grant, and a comment thread out of the product at hi-DPI
  for close-up beats.

## Notes

- Read-only walkthrough discipline: zero fixture mutations; never land,
  push, fork, or delete `demo`/`agent-1..5` (a fixture mutation is an
  incident).
- Honesty laws must remain true on screen: an absent check never reads
  green; `attestation: null` renders no badge; below-parity rows are
  shown, not hidden; `agent-5` is never judged (typed secret-class skip).
- Audio: not signed in to HeyGen → local engines plus the Higgsfield
  account (user-granted) for voice/music.
- Capture caveats (live state, 2026-10-15): `/sessions` is empty and the
  `/issues` panel cannot render (endpoint 26–29s > the UI's 20s fetch
  timeout; filed as nextgit-ayft) — the film carries collaboration via
  comments / conflicts / rail instead. The `/` ticker may show sibling
  suites' scratch repos; avoid featuring it.
- `submission/nextgit-demo.mp4` is a gated artifact (300–600s single
  take per submission-eligibility tests) — this promo is a NEW artifact,
  never a replacement of that path.
- User requirement: take fresh screenshots and incorporate them into the
  video and the demo materials.
