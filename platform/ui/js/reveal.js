// nextgit — reveal domain (wave-13 module split
// from app.js). Owns the elevated-reveal click handler.
import { fetchJson, escapeHtml } from "./api.js";
import { decideSecretSurface } from "../reveal-decision.js";

/**
 * Elevated-reveal click: read the value through the audited
 * POST /reveal seam. The value is rendered ONLY from the 200
 * response body (escaped); a denied/errored click renders the
 * withheld notice with no value. The affordance is never a
 * capability — the server re-runs the reveal rule on every click.
 */
export async function revealSecret(repo, path, keysCsv) {
 const valueSlot = document.getElementById("reveal-value");
 const key = keysCsv.split(",")[0];
 try {
  const data = await fetchJson("/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, ref: "main", path, key }) });
  if (data?.ok && typeof data.value === "string") {
   if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="reveal-value-line">${escapeHtml(key)} = ${escapeHtml(data.value)}</div>`; }
   return;
  }
  const decision = decideSecretSurface({ reveal: true, revealDenied: data?.error === "reveal-not-authorized", revealFailed: data?.error !== "reveal-not-authorized" });
  if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
 } catch (err) {
  // fetchJson throws on !res.ok but attaches the parsed body
  // as err.response — so a 403 reveal-not-authorized maps to
  // the DENIED cell (not the error cell); any other failure
  // (network/5xx) maps to the ERROR cell. Both render the
  // withheld notice with no value.
  const denied = err?.response?.error === "reveal-not-authorized";
  const decision = decideSecretSurface({ reveal: true, revealDenied: denied, revealFailed: !denied });
  if (valueSlot) { valueSlot.hidden = false; valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
 }
}
