# NextGit — agent rules

**Corpus first:** `docs/STATE.md` (spine index) → `_bmad-output/specs/spec-next-git-platform/SPEC.md` + companions → `platform/CONTRACT.md` → the research dossiers under `_bmad-output/planning-artifacts/research/` and `research/` when evidence is needed. Read them before proposing work.

**The loop:** `docs/NEXT-ACTIONS.md` is the only place work is decided. Run work through `porting/wf-template.ddw.js` (single order) or `porting/wf-batch.ddw.js` (batch). State updates only at boundaries (green gate or recorded block). Commits only from the orchestrator (main thread) — workers never commit. Nothing starts a batch it cannot reconstruct from disk.

**Evidence:** every claim carries the command + its verbatim output. "Done" names the check that would red if it regressed.

**Secrets:** never in argv, records, or transcripts. The wrangler OAuth token lives at `~/.config/.wrangler/config/default.toml`; Artifacts repo tokens are minted per-run from it and never committed.

**Flags (read before touching these areas):**
1. **Crash-resume** — runner state is durable only because `porting/runs/<id>/run-state.json` is written every phase; never start a batch you cannot reconstruct from disk. `resume: true` skips phases whose artifacts exist and always re-runs gates; the heal budget counts per invocation (`healsThisRun`), so a resumed run can heal again; the in-flight phase restarts from scratch.
2. **Display masks vs corruption** — the harness redacts secret-shaped text in what you *see*; verify raw bytes on disk before "fixing" a file.
3. **Remote hosts** — none in this loop; the platform is Cloudflare-hosted and reached over HTTPS (no SSH route needed).
4. **Gate budget** — heal rounds: default 3 per order, then record, don't loop.
5. **Skills loading** — pinned load paths in `docs/SKILLS.md`; never hand-place a skill elsewhere and assume it loads.
6. **Redaction of inputs** — if harness display differs from disk bytes, trust disk; stage values via files and reference them by path.
7. **Probe tools before documenting guards** — `jq` on this box is **jaq**: `-c` exits 0 on empty *and* dead input; check pipelines use `-ec`. Never ship a check whose failure-mode claim was not executed.

**Project facts:** platform live at `https://nextgit-platform.john-b7d.workers.dev` (worker `nextgit-platform`; Artifacts namespace `nextgit`; baseline repo `demo`; proposals `agent-1..4`). Use `npx wrangler@latest` for Artifacts commands (global wrangler 4.106 lacks them). Demo reset: `node platform/scripts/seed.mjs && node platform/scripts/real-agents.mjs`. Judge layer: Clef — catalog at `docs/judge-layer-ideas.md`, plan is `AI` binding + `/judge`.
