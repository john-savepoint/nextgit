// nextgit — per-proposal checks strip (wave-14, lane L6).
// Derives a small, honest set of checks from payloads the page has ALREADY
// fetched: the GET /proposals set payload (fold state, conflict map,
// secret-class flags, current base head) and, when present, an observed
// GET /changes change-set (the fork point). No new fetch, no new route, no
// data-action — a pure render of already-fetched data.
//
// Honesty law (the acceptance): a check is `pass` ONLY when the payload
// carries the datum that proves it. A missing datum is `unknown`, and the
// state->class map below can only reach `check-pass` from the literal "pass"
// — an unknown can never be classified or styled as a pass.
import { escapeHtml } from "./api.js";

/** The five checks, in display order. */
export const CHECK_IDS = ["fold", "collision", "conflicts", "secrets", "base"];

/** Conflict-kind display order — index 0 is worst. A local, display-only approximation
 *  of the server's KIND_SEVERITY buckets (which tie kinds at equal severity); it only
 *  picks which kind NAME worstKind() shows and never affects the pass/fail class. */
const KIND_ORDER = ["text-conflict", "modify/delete", "add/add", "undetermined", "mergeable", "identical-add", "both-removed"];

/** state -> css class. The ONLY path to `check-pass` is the literal "pass". */
const STATE_CLASS = { pass: "check-pass", fail: "check-fail", unknown: "check-unknown" };

function unknown(id, label, detail) {
 return { id, label, state: "unknown", detail };
}

/** Conflict kinds that are NOT conflicts — a file the proposals share cleanly. */
const CLEAN_KINDS = new Set(["mergeable", "identical-add", "both-removed"]);

/** The conflict-map rows naming this repo that are GENUINE conflicts, or null when the
 *  map is absent. Rows for cleanly-merging shared files are excluded, mirroring the
 *  server's own conflict predicate (`pairs[].conflict === true`). */
function conflictRows(repo, conflicts) {
 if (!Array.isArray(conflicts) || typeof repo !== "string") return null;
 return conflicts.filter(
  (c) => c && Array.isArray(c.repos) && c.repos.includes(repo) && !CLEAN_KINDS.has(c.kind),
 );
}

/** The most severe ConflictKind among the rows (unknown kinds rank lowest). */
function worstKind(rows) {
 let worst = null;
 let worstRank = -1;
 for (const r of rows) {
  const k = r && typeof r.kind === "string" ? r.kind : null;
  if (!k) continue;
  const idx = KIND_ORDER.indexOf(k);
  const rank = idx === -1 ? 0 : KIND_ORDER.length - idx;
  if (rank > worstRank) { worstRank = rank; worst = k; }
 }
 return worst;
}

/**
 * Derive the five checks for one proposal. ctx = {
 *   base,      // the set payload's top-level base object ({repo,ref,head})
 *   conflicts, // the set payload's conflicts[] (may be undefined)
 *   changeSet, // an observed GET /changes changeSet for this repo (may be undefined)
 * }
 * Returns CHECK_IDS.length entries, in that order.
 */
export function proposalChecks(proposal, ctx = {}) {
 const p = proposal || {};
 const failed = Boolean(p.error);
 const landing = p.landing && typeof p.landing === "object" ? p.landing : null;
 const status = landing && typeof landing.status === "string" ? landing.status : null;
 const files = Array.isArray(p.files) ? p.files : null;
 const out = [];

 // 1. fold — can this proposal fold onto the CURRENT base head?
 if (failed || !status) {
  out.push(unknown("fold", "fold", failed ? "unavailable" : "fold state not in payload"));
 } else if (status === "ready") {
  out.push({ id: "fold", label: "fold", state: "pass", detail: "folds clean" });
 } else if (status === "landed") {
  out.push({ id: "fold", label: "fold", state: "pass", detail: "nothing to fold" });
 } else if (status === "conflict") {
  out.push({ id: "fold", label: "fold", state: "fail", detail: "conflicting fold" });
 } else if (status === "withheld-secret") {
  out.push({ id: "fold", label: "fold", state: "fail", detail: "secret-class blocks fold" });
 } else {
  out.push(unknown("fold", "fold", "unrecognized fold state"));
 }

 // 2. collision — cross-proposal collision severity (the CAP-3 map).
 const rows = conflictRows(p.repo, ctx.conflicts);
 if (failed) {
  out.push(unknown("collision", "collision", "unavailable"));
 } else if (rows === null) {
  out.push(unknown("collision", "collision", "conflict map not in payload"));
 } else if (rows.length === 0) {
  out.push({ id: "collision", label: "collision", state: "pass", detail: "none" });
 } else {
  const kind = worstKind(rows) || "shared";
  const file = rows.map((r) => (r && typeof r.file === "string" ? r.file : "")).filter(Boolean)[0] || "shared file";
  out.push({ id: "collision", label: "collision", state: "fail", detail: `${kind} · ${file}` });
 }

 // 3. conflicts — how many conflicting files touch this repo.
 if (failed) {
  out.push(unknown("conflicts", "conflicts", "unavailable"));
 } else if (rows === null) {
  out.push(unknown("conflicts", "conflicts", "unknown"));
 } else {
  out.push({ id: "conflicts", label: "conflicts", state: rows.length === 0 ? "pass" : "fail", detail: String(rows.length) });
 }

 // 4. secrets — secret-class PRESENCE only (never keys, never values).
 const withheld = status === "withheld-secret";
 if (failed) {
  out.push(unknown("secrets", "secrets", "unavailable"));
 } else if (files === null && !withheld) {
  out.push(unknown("secrets", "secrets", "file rows not in payload"));
 } else {
  const secretCount = files ? files.filter((f) => f && f.secret === true).length : 0;
  if (withheld || secretCount > 0) {
   out.push({ id: "secrets", label: "secrets", state: "fail", detail: withheld ? "withheld" : `${secretCount} secret-class file(s)` });
  } else {
   out.push({ id: "secrets", label: "secrets", state: "pass", detail: "none" });
  }
 }

 // 5. base — staleness: fork point (observed change-set) vs current base head.
 //    The set payload carries NO fork point => honestly `unknown` on the canvas.
 const cs = ctx.changeSet && typeof ctx.changeSet === "object" ? ctx.changeSet : null;
 const forkSha = cs && cs.base && typeof cs.base.sha === "string" ? cs.base.sha : null;
 const baseHead = ctx.base && typeof ctx.base.head === "string" && ctx.base.head ? ctx.base.head : null;
 if (!forkSha || !baseHead) {
  out.push(unknown("base", "base", "fork point not in set payload"));
 } else if (forkSha !== baseHead) {
  out.push({ id: "base", label: "base", state: "fail", detail: "base moved since fork" });
 } else {
  out.push({ id: "base", label: "base", state: "pass", detail: "in sync" });
 }

 return out;
}

/** Render the strip for one proposal card. Every interpolated value is escaped. */
export function checksStripHtml(proposal, ctx = {}) {
 const cells = proposalChecks(proposal, ctx)
  .map((c) => {
   const cls = STATE_CLASS[c.state] || STATE_CLASS.unknown;
   const title = `${c.label}: ${c.detail}`;
   return (
    `<span class="check ${cls}" data-check="${escapeHtml(c.id)}" title="${escapeHtml(title)}">` +
    `<span class="check-label">${escapeHtml(c.label)}</span>` +
    `<span class="check-detail">${escapeHtml(c.detail)}</span>` +
    `</span>`
   );
  })
  .join("");
 return `<div class="checks-strip" role="group" aria-label="proposal checks">${cells}</div>`;
}
