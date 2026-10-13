// nextgit — inline review comments (wave-15 module).
// Owns the comment-thread domain for the merge preview modal:
// the thread skeleton, the per-file comment list (GET /comments),
// the composer (POST /comments), and the secret-row refusal.
// Renders ONLY from the GET shape; POST is success/failure and
// reconciles by re-fetching (the pinned L7 contract).
import { state } from "./state.js";
import { fetchJson, escapeHtml, formatTime } from "./api.js";

/**
 * Fixed author for UI-posted comments. The platform exposes no
 * identity surface beyond the opaque bearer token (/whoami returns
 * capability booleans only), so the surface posts a documented
 * constant rather than faking a provenance it cannot verify.
 * Deriving an authenticated author belongs to the data plane.
 */
export const REVIEWER_AUTHOR = "reviewer";

/**
 * The comment-thread skeleton for one merge file. Every interpolated
 * value goes through escapeHtml (attribute context included); repo
 * and path are passed RAW and escaped here, never pre-escaped.
 * The ref derives with the codebase's existing idiom
 * (state.proposalsData?.ref || "main" — what proposals.js/land.js
 * and the modal's own merge call already use).
 */
export function commentThreadHtml(repo, path) {
 const ref = state.proposalsData?.ref || "main";
 return `
      <div class="comment-thread" data-comment-thread data-repo="${escapeHtml(repo)}" data-ref="${escapeHtml(ref)}" data-path="${escapeHtml(path)}">
        <div class="comment-thread-header">review comments</div>
        <div class="comment-list" data-comment-list>
          <div class="loading-indicator">Loading comments…</div>
        </div>
        <div class="comment-compose" data-comment-form>
          <label class="comment-line-label">line
            <input class="comment-line-input" type="number" min="0" step="1" value="1" data-comment-line>
          </label>
          <textarea class="comment-body-input" rows="2" maxlength="2000" data-comment-body
                    aria-label="comment" placeholder="comment on this file…"></textarea>
          <button class="btn-comment-submit" type="button" data-comment-submit>comment</button>
        </div>
      </div>
    `;
}

/**
 * Secret-class rows: no list, no composer, no GET. Commenting is
 * unconditionally refused for withheld files — no capability can
 * un-refuse it (display-level defense-in-depth over the data plane's
 * server-side 403).
 */
export function commentRefusedHtml() {
 return `<div class="comment-thread is-refused" data-comment-refused="1">Commenting is disabled for secret-class files.</div>`;
}

/**
 * One comment row. Only comment fields render — never patch /
 * merged / any file content (information-disclosure boundary).
 */
export function commentItemHtml(c) {
 if (!c) return "";
 const id = c.id != null ? ` data-comment-id="${escapeHtml(c.id)}"` : "";
 const meta = `${escapeHtml(c.author)} · line ${escapeHtml(c.line)} · ${formatTime(c.at)}`;
 return `
          <div class="comment-item"${id}>
            <div class="comment-meta">${meta}</div>
            <div class="comment-body">${escapeHtml(c.body)}</div>
          </div>
        `;
}

/**
 * Hydrate every unhydrated comment thread under root. Marker-guarded
 * (data-comment-loaded is set BEFORE the await) so a re-entrant call
 * never double-fetches. Never rejects: an uncaught rejection here
 * would replace the whole modal through the caller's try/catch.
 * Returns true when every targeted thread hydrated, false when a GET
 * failed (the forced-reconcile caller then repurposes the pending row).
 */
export async function hydrateCommentThreads(root, { force } = {}) {
 try {
  if (!root || typeof root.querySelectorAll !== "function") return true;
  // The root may BE a single thread (the reconcile path in submitComment
  // passes the thread element), so collect a matching root plus every
  // descendant thread — querySelectorAll never matches its own root.
  const all = [];
  if (typeof root.matches === "function" && root.matches("[data-comment-thread]")) all.push(root);
  for (const t of root.querySelectorAll("[data-comment-thread]")) all.push(t);

  let ok = true;
  for (const thread of all) {
   if (force) thread.removeAttribute("data-comment-loaded");
   if (thread.hasAttribute("data-comment-loaded")) continue;
   // Mark BEFORE awaiting: a re-entrant call skips threads already
   // hydrated or in flight (one GET per thread per render).
   thread.setAttribute("data-comment-loaded", "1");
   const repo = thread.getAttribute("data-repo") || "";
   const ref = thread.getAttribute("data-ref") || "";
   const path = thread.getAttribute("data-path") || "";
   const list = thread.querySelector("[data-comment-list]");
   try {
    const params = `repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;
    const data = await fetchJson(`/comments?${params}`);
    const comments = Array.isArray(data?.comments) ? data.comments : [];
    // An INITIAL GET can resolve after a synchronous optimistic append
    // (submitComment), so it must not wipe a pending row; the forced
    // reconcile is what legitimately replaces it with server rows.
    if (list && (force || !list.querySelector("[data-pending]"))) {
     list.innerHTML = comments.map(commentItemHtml).join("");
    }
   } catch (err) {
    ok = false;
    // Never clobber an optimistic pending row with the error chrome — the
    // reconcile caller repurposes it (posted — refresh failed) instead.
    if (list && !list.querySelector("[data-pending]")) {
     list.innerHTML = `<div class="comment-thread-error" role="alert">Comments unavailable — ${escapeHtml(err?.message || "unknown error")}</div>`;
    }
   }
  }
  return ok;
 } catch {
  // Total containment: hydration is best-effort surface chrome.
  return false;
 }
}

/**
 * Submit a composer: optimistically append a pending row, POST, then
 * reconcile from server truth (re-hydrate) on success, or mark the
 * pending row failed on error (a failed post is never silently
 * dropped; the typed text is retained and the composer re-enabled).
 */
export async function submitComment(control) {
 try {
  const thread = control.closest("[data-comment-thread]");
  if (!thread) return;
  const repo = thread.getAttribute("data-repo") || "";
  const ref = thread.getAttribute("data-ref") || "";
  const path = thread.getAttribute("data-path") || "";
  const lineEl = thread.querySelector("[data-comment-line]");
  const bodyEl = thread.querySelector("[data-comment-body]");
  const line = Math.max(0, parseInt(lineEl?.value, 10) || 0);
  const body = (bodyEl?.value || "").trim();
  if (!body) return;

  const list = thread.querySelector("[data-comment-list]");
  if (!list) return;
  control.disabled = true;

  // Optimistic append — synchronous, so the pending row is
  // observable in the DOM before the POST resolves.
  const pendingRow = document.createElement("div");
  pendingRow.className = "comment-item is-pending";
  pendingRow.setAttribute("data-pending", "1");
  pendingRow.innerHTML = `
            <div class="comment-meta">${escapeHtml(REVIEWER_AUTHOR)} · line ${escapeHtml(line)} · <span class="comment-state" role="status" aria-live="polite">sending…</span></div>
            <div class="comment-body">${escapeHtml(body)}</div>
          `;
  list.appendChild(pendingRow);

  let reconciled = false;
  let postFailed = false;
  try {
   await fetchJson("/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, ref, path, line, body, author: REVIEWER_AUTHOR }),
   });
   // Reconcile from server truth: the pending row is replaced by
   // the persisted row carrying its server id/at.
   reconciled = await hydrateCommentThreads(thread, { force: true });
  } catch (err) {
   // Honest failure: the row stays, marked, with its state text.
   postFailed = true;
   pendingRow.classList.add("is-failed");
   const stateEl = pendingRow.querySelector(".comment-state");
   if (stateEl) stateEl.textContent = `failed — ${err?.message || "unknown error"}`;
  } finally {
   control.disabled = false; // in-flight window over — success or failure
  }

  // The optimistic row must never be silently dropped: on a failed POST it is
  // re-asserted into the live list if an in-flight hydrate detached it, and on
  // a POST that succeeded but whose reconcile GET failed it is repurposed to
  // "posted — refresh failed" rather than wiped (no duplicate re-post).
  if (!reconciled) {
   if (!postFailed) {
    pendingRow.classList.remove("is-pending");
    pendingRow.classList.add("is-failed");
    const stateEl = pendingRow.querySelector(".comment-state");
    if (stateEl) stateEl.textContent = "posted — refresh failed";
   }
   if (!pendingRow.isConnected && list.isConnected) list.appendChild(pendingRow);
  }
 } catch {
  // A failed submit must never reject into the caller's trap.
 }
}
