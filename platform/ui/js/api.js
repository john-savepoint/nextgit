// nextgit — pure helpers + the API client (wave-13 module split
// from app.js). No imports: every function here is self-contained
// (renderPatchLines closes over escapeHtml, defined above it).

/**
 * Pure helper: Escape HTML to avoid XSS
 */
export function escapeHtml(str) {
 if (str == null) return "";
 return String(str)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
}

/**
 * Pure helper: Format relative or local time
 */
export function formatTime(isoOrTimestamp) {
 if (!isoOrTimestamp) return "";
 try {
  const d = new Date(isoOrTimestamp);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
 } catch {
  return "";
 }
}

/**
 * Pure helper: Render diff patch text into line-colored HTML
 */
export function renderPatchLines(patch) {
 if (!patch || typeof patch !== "string") {
  return '<div class="diff-placeholder">No patch available for this file (omitted, withheld, or binary).</div>';
 }

 const lines = patch.split("\n");
 const rendered = lines.map((line) => {
  let lineClass = "";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("===") || line.startsWith("Index:")) {
   lineClass = "line-meta";
  } else if (line.startsWith("@@")) {
   lineClass = "line-hunk";
  } else if (line.startsWith("+")) {
   lineClass = "line-add";
  } else if (line.startsWith("-")) {
   lineClass = "line-del";
  }
  return `<div class="diff-line ${lineClass}">${escapeHtml(line) || " "}</div>`;
 });

 return `<div class="diff-viewer">${rendered.join("")}</div>`;
}

/**
 * API client with timeout
 *  - 20s default (worker cold-start after deploys exceeded the old 8s cap and left
 *    the canvas in its aborted state until a manual retry — observed 2026-10-08)
 *  - ONE automatic retry when the request was killed by its own timeout (AbortError);
 *    HTTP/4xx/5xx errors keep exact semantics and are never retried
 *  - callers may override via options.timeoutMs (POST /land uses 45s: it folds + pushes)
 */
export async function fetchJson(endpoint, options = {}) {
 const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000;
 const timeoutOpt = { ...options };
 delete timeoutOpt.timeoutMs;
 const attempt = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
   const res = await fetch(endpoint, {
    ...timeoutOpt,
    signal: controller.signal,
    headers: {
     Accept: "application/json",
     ...(timeoutOpt.headers || {}),
    },
   });
   clearTimeout(timeoutId);

   const json = await res.json().catch(() => null);
   if (!res.ok || (json && json.ok === false)) {
    const err = new Error(json?.error || `HTTP ${res.status}: ${res.statusText}`);
    err.status = res.status;
    err.response = json;
    throw err;
   }
   return json;
  } catch (err) {
   clearTimeout(timeoutId);
   throw err;
  }
 };
 try {
  return await attempt();
 } catch (err) {
  if (err && err.name === "AbortError") return await attempt(); // single retry: timeout only
  throw err;
 }
}
