# Submission Notes — nextgit-e10-impl-submission-license

## Section A — Credential-scan evidence

**Scope:** all 581 tracked files at HEAD `324a24c`.

**Method:** 3 scans:
1. Path-class (CONTRACT.md:212 patterns: .env*, *.pem, *.key, *.p12, credentials.json, secrets.json, .dev.vars, secrets/)
2. Literal-assignment (platform/scripts/*.mjs + platform/src/*.ts for api_key/secret_key/access_token/private_key/password = literal, excluding process.env/Bearer/oauth_token/comments)
3. Config (wrangler.jsonc for embedded tokens/keys)

**Commands + results (verbatim):**
```bash
# 1. Path-class scan (empty output = clean)
git ls-files | grep -iE '\.env*|\.(pem|key|p12)$|credentials\.json|secrets\.json|\.dev\.vars|secrets/' | grep -vE '\.(md|html)$'
# → (no output)

# 2. Literal credential assignment scan (empty output = clean)
git ls-files 'platform/scripts/*.mjs' 'platform/src/*.ts' \
  | xargs grep -nE '(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|password)\s*=\s*["x][a-zA-Z0-9]' \
  | grep -v 'process\.env|Bearer|oauth_token|^\s*//'
# → (no output)

# 3. Wrangler config scan (empty output = clean)
git grep -l 'api_token|api_key|secret.*=' -- 'platform/wrangler.jsonc'
# → (no output)
```

**Result: CLEAN** — zero credential-class files, zero literal assignments, wrangler.jsonc has only KV namespace IDs (public identifiers).

**License:** `platform/package.json` now declares `"license": "MIT"`, matching root LICENSE (commit `8169aa2`).

## Section A addendum — re-scan at integration HEAD (2026-10-10)

**Scope:** all tracked files at HEAD `49a81e9` (post wave-7 integration + seam hygiene; the original scan was at `324a24c`, before 65 files changed).

**Method:** the same three scans, rerun at the new HEAD (path-class via `git ls-files` filter; literal-assignment over `platform/` sources; `platform/wrangler.jsonc`).

**Result: CLEAN** — zero credential-class files, zero literal credential assignments, `wrangler.jsonc` carries only KV namespace IDs + the `AUTH_MODE` var (public identifiers).

**Video vintage (for the freeze call):** `submission/nextgit-demo.mp4` (f3fd213, recorded 2026-10-09) predates the wave-7 integration and the `31f75bb4` deploy; it also carries recording-session blemishes (Chrome `--no-sandbox` bar, scratch-repo traffic in the ticker). Re-record is a deliberate choice, recommended in the wave-7 close-out.

## Section B — Single-entry filing

**Eligibility:** US-resident teammate will file (CHECKPOINT.md:95 — "eligibility RESOLVED"; SPEC.md:50 §3 residency).

**Constraint:** One entry per person/team; no duplicates.

**Deadline:** **2026-10-14** (SPEC.md:50; STATE.md:3).

**Pending act:** `submission-repo-location-single-entry-registered-by-oct-14` (not performed here).

**Ready artifacts:** README.md, LICENSE (8169aa2), platform/package.json (license field), CONTRACT.md (v2.3), index.ts, demo-verify.mjs (25/25), submission/NOTES.md (this file).

## Section C — Public repository (repo location)

**Repo:** https://github.com/john-savepoint/nextgit — public, MIT.

Pushed 2026-10-15 from local HEAD `d217015` (wave-19 integrated tree +
wave-20 plan commit). This performs the `submission-repo-location` half of
`nextgit-submission-repo-location-single-entry-registered-by-oct-14`;
the single-entry filing itself remains with the US-resident teammate.

- Submission-eligibility gate re-run at push time: **ALL PASS (19 checks)**,
  including R3.9–R3.11 on `submission/nextgit-demo.mp4` (482.76 s measured).
  The demo-video vintage note in Section A stands (re-record optional; the
  promo cut in `video/nextgit-promo/` is a separate short-form artifact).
- The push includes `video/nextgit-promo/` — the promo film's brief,
  storyboard, locked script, capture rig, and 37 fresh 2×/3× captures of the
  live deployed platform (canonical demo state, demo-verify PASS 25/25).
- Wave-20 in-flight lane work (proposals-warm, sessions-mediums, api-hygiene,
  pipeline-notify, mobile-pass, docs-refresh) is **not** in this push — the
  lane branches live in local refs and the working-tree edits were stashed
  (`wave20 main leaks (round 13)`) so the public tree stays a coherent,
  gate-green state.
- Pre-push secrets sweep: tracked tree + 300-commit history scanned for
  key-shaped strings; the only match is the intentional fake-key fixture in
  `porting/tests/masking-posture.test.mjs` (`MIIByKEY` — a masking-test dummy).

## License

MIT
