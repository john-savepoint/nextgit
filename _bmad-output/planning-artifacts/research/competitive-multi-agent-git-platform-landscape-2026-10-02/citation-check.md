# Citation check — competitive-multi-agent-git-platform-landscape-2026-10-02

Summary: match 12 / partial 2 / mismatch 0 / fetch-failed 0. All sources retrieved this run (2026-10-02). Fresh-context verifier; no report edits.

---

[3] — VERDICT: match — EVIDENCE: https://github.blog/changelog/ — NOTE: (a) "GitHub async merge API generally available" listed Oct 01 2026 — confirmed; (b) no set-level/multi-agent-review changelog item visible in the fetched Oct + late-Sep window (page truncated at 300/702 lines), so the negative is bounded-but-consistent, not proven across the full history.

[7] — VERDICT: match — EVIDENCE: https://githubuniverse.com/ — NOTE: page states "october 28–29 / fort mason center, san francisco, CA" exactly as claimed.

[9] — VERDICT: match — EVIDENCE: https://about.gitlab.com/press/releases/2026-01-15-gitlab-announces-duo-agent-platform-general-availability — NOTE: press release dated Jan 15 2026 announces "general availability of GitLab Duo Agent Platform", available during the "GitLab 18.8 release cycle" — GA + 18.8 both confirmed.

[21] — VERDICT: match — EVIDENCE: https://entire.io/ — NOTE: homepage shows checkpoints ("creates a checkpoint for every commit") and the distributed Git network ("Fastest Git Network on Earth", regional mirrors) — both confirmed; no set-level coordination product; note homepage does offer "Send a branch to multiple agents in parallel for an intent-aware review", which is multi-agent but per-branch, not set-level compare/integrate (supports the claim).

[22] — VERDICT: match — EVIDENCE: https://entire.io/blog — NOTE: index's newest post is 2026-09-28 (Antigravity CLI integration); no coordination-product announcement through that date. Both flagged "notable" items present: ForgeMark benchmark (2026-07-13 dispatch: "ForgeMark, an open source Git push benchmark for many agents working at once") and review skills (2026-05-07 "run review skills against your branch").

[29] — VERDICT: match — EVIDENCE: https://www.macroscope.com/blog/introducing-murmur — NOTE: post (2026-09-03) states "Every Murmur agent runs inside its own dedicated cloud VM", self-driving PR lifecycle (respond to review, repair CI, rebase, resolve conflicts), and "Your local agent session becomes the control plane for a fleet of remote agents" — per-agent VM + self-driving PRs + Director control plane all confirmed.

[47] — VERDICT: match — EVIDENCE: https://imbue.com/blog/sculptor-announce — NOTE: "Every agent runs in its own container", merge section: "If conflicts do come up, you can hand them back to the agent to resolve", and "Sculptor saves every agent session with its plans, chats, tool calls, and code changes all intact" — containers, conflict hand-back, full session preservation all confirmed.

[58] — VERDICT: match — EVIDENCE: https://gitghost.ai/ — NOTE: homepage claims "Multiplayer workspace for AI coding agents", shared sessions/transcripts/checkpoints/approvals, "review branches and diffs", and "Every agent change gets a team-readable trail". Evidence is per-change (one merge request / one diff at a time); no surface presents multiple concurrent changes as a set to compare/select/integrate — the report's read that it is NOT set-level holds.

[59] — VERDICT: match — EVIDENCE: https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning — NOTE: page covers detection across history/branches, alerts, remediation, partner reporting, custom/generic patterns, validity checks, and public monitoring — detection/alerting scope only; nothing about file-level read access control. Minor: push protection is not discussed on this specific page (separate doc).

[62] — VERDICT: partial — EVIDENCE: https://github.com/git-ai-project/git-ai — NOTE: Apache-2.0 confirmed; Git-Notes-based attribution confirmed ("open standard for tracking AI-generated code with Git Notes"); agent_id {tool,id,model} confirmed in the standard. But "~20 agents claimed as supported" is not matched by the visible README: the supported-agents table names 14 (Claude Code, Codex, Cursor, Copilot, OpenCode, Pi, Windsurf, Droid, Amp, Gemini, Continue, Junie, Rovo Dev, Firebender) plus an "Add an Agent" link, and the v3 spec's tool list names 10 — count is overstated/unsupported by this source.

[63] — VERDICT: match — EVIDENCE: https://raw.githubusercontent.com/git-ai-project/git-ai/main/specs/git_ai_standard_v3.0.0.md — NOTE: standard v3.0.0 requires authorship logs under the `refs/notes/ai` namespace ("MUST be stored under the refs/notes/ai namespace") and defines line-range attestation entries (e.g. `s_<id>::t_<id> 1-10,15-20`) — both confirmed.

[64] — VERDICT: match — EVIDENCE: https://docs.entire.io/guides/checkpoints/inspect-in-entire-io — NOTE: page documents per-commit session store (checkpoint detail with Sessions + Changes per commit/branch) and the `Entire-Checkpoint: <id>` commit trailer — per-commit session store + trailer both confirmed.

[65] — VERDICT: match — EVIDENCE: https://github.com/sigstore/gitsign — NOTE: "Keyless Git signing using Sigstore … sign Git commits with your own GitHub / OIDC identity", OIDC keyless flow with Fulcio/Rekor — keyless OIDC-bound signing; it binds to a human/workload OIDC identity, not a distinct agent identity, matching the report's characterization.

[67] — VERDICT: partial — EVIDENCE: https://dev.fast/ — NOTE: page confirms cross-platform ("macOS · Windows · Linux"), open source ("open source, mit licensed" / github.com/devdotfast/whiteboard), AST diff ("Powered by our AST-based diffing library written in Rust" → diffr), and "Audit agent trajectories". The "single-branch workflow" element is only inferential: the page demonstrates one branch (`codex/search-on-main`) and one diff/PR at a time and exposes no multi-agent set-review surface, but it never explicitly states a single-branch limitation.

---
_Verifier: fresh-context semantic citation check; 16 tool calls; all pages fetched 2026-10-02._
