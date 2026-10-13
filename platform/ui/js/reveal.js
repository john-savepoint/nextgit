// nextgit — reveal domain (wave-13 module split
// from app.js). Owns the elevated-reveal click handler.
import { fetchJson, escapeHtml, demoIdentityHeaders } from "./api.js";
import { decideSecretSurface } from "../reveal-decision.js";

/**
 * Elevated-reveal click: read the value through the audited
 * POST /reveal seam. The value is rendered ONLY from the 200
 * response body (escaped); a denied/errored click renders the
 * withheld notice with no value. The affordance is never a
 * capability — the server re-runs the reveal rule on every click.
 */
export async function revealSecret(repo, path, keysCsv, ref = "main") {
 const valueSlot = document.getElementById("reveal-value");
 const key = keysCsv.split(",")[0];
 try {
  const data = await fetchJson("/reveal", { method: "POST", headers: { "content-type": "application/json", ...demoIdentityHeaders() }, body: JSON.stringify({ repo, ref, path, key }) });
  if (data?.ok && typeof data.value === "string") {
   if (valueSlot) { valueSlot.hidden = false; valueSlot.setAttribute("data-reveal-decision", "revealed"); valueSlot.innerHTML = `<div class="reveal-value-line">${escapeHtml(key)} = ${escapeHtml(data.value)}</div>`; }
   return;
  }
  const decision = decideSecretSurface({ reveal: true, revealDenied: data?.error === "reveal-not-authorized", revealFailed: data?.error !== "reveal-not-authorized" });
  if (valueSlot) { valueSlot.hidden = false; valueSlot.setAttribute("data-reveal-decision", decision.kind); valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
 } catch (err) {
  // fetchJson throws on !res.ok but attaches the parsed body
  // as err.response — so a 403 reveal-not-authorized maps to
  // the DENIED cell (not the error cell); any other failure
  // (network/5xx) maps to the ERROR cell. Both render the
  // withheld notice with no value.
  const denied = err?.response?.error === "reveal-not-authorized";
  const decision = decideSecretSurface({ reveal: true, revealDenied: denied, revealFailed: !denied });
  if (valueSlot) { valueSlot.hidden = false; valueSlot.setAttribute("data-reveal-decision", decision.kind); valueSlot.innerHTML = `<div class="empty-state-title">${escapeHtml(decision.noticeHtml ?? "Secret content withheld")}</div>`; }
 }
}

/**
 * Secret-surface affordance markup — ONE definition shared by the
 * merge modal and the files page (no markup drift). Pure and fully
 * escaped: every attribute goes through escapeHtml and NO value is
 * ever rendered here. `revealSecret` stays the single value sink —
 * the value is injected only from the audited POST /reveal 200 body.
 */
export function revealControlHtml({ repo, path, keys }) {
 const keysCsv = (Array.isArray(keys) ? keys : []).join(",");
 return `<button class="btn-reveal" type="button" data-reveal-repo="${escapeHtml(repo)}" data-reveal-path="${escapeHtml(path)}" data-reveal-keys="${escapeHtml(keysCsv)}">reveal</button>
<div class="reveal-value" id="reveal-value" data-reveal-decision="control" hidden></div>`;
}
