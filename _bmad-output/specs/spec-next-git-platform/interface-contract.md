# Interface Contract — platform API for clients (Agent Office-class)

The platform is web-first + API; 3D worlds (Agent Office = flagship client) render the same state. The API must expose these entities + events. (Derived from the Agent Office system map + integration analysis, 2026-10-02, repo @157b176.)

## Entities (minimal client-readable fields)

| Entity | Key fields |
|---|---|
| Floor / Project | id, name, repo, branch, cloning, counts (workers/busy/waiting) |
| Worker | id, name, provider/model/effort, desk, status, worktree{branch,path,base}, pr, task, activity, usage |
| Task / Queue | id, provider/model/effort, issue, title, prompt, status, workerId, branch, outcome, pr |
| Issue | number, title, state, author, labels, assignees, taken?, body |
| Pull / Proposal | number, title, state, draft, reviewDecision, headRef, baseRef, checks, additions/deletions, closes[] |
| PR / Proposal detail | body, mergeable, mergeStateStatus, commits, comments, reviews, checks |
| Presence / Peer | id, name, position, voice, sharing, doing, floor |
| Whiteboard | strokes + cursors per floor |
| Services | worker, branch, page title, local port |
| Settings | limits, leave-on-merge, default agent, prompts, map/theme |
| Chat / Notifications | from, text, at |

## Events (push-style — the platform replaces polling)

worker.spawn/update/remove · worker.worktree · screen · term.data/snapshot/input · floor.enter/added/removed · issue/pull lifecycle events (platform-native equivalents of gh.*) · queue state · peer.join/update/leave/move/act/emote · chat · toast.

## What Agent Office lacks that the platform provides

- **H3 — no cross-worker review** → platform-native proposal type *is* the convergence layer.
- **H4 — provenance gap** → per-worker trace + git-notes records.
- **H5 — secrets surface** → per-worker secret API; secret-typed files.
- **H6 — event gap** (90s polling) → push events replace it. *The demo should visibly beat the 90s poll.*

## Platform API needs (from the client's own architecture)

worktree-as-a-service (create/list/push/PR/cleanup) · provider-agnostic agent launch (unify 8 harness formats) · normalized worker-event bus · terminal streaming protocol (snapshot + per-row diffs + scrollback + input) · cost attribution + budget enforcement.

## Feasibility

The office's 11-entity protocol maps 1:1 onto platform entities — a platform API mirroring it can drop-in replace GitHub as the office's backing store via a client adapter. GitHub-specific semantics to synthesize: `reviewDecision` / `mergeStateStatus` / `mergeable`.
