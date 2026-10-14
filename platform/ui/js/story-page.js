// nextgit — the story page (vanilla ES module, the files-page idiom)
// Adheres strictly to platform/CONTRACT.md
//
// Contract being consumed (pinned shape):
//   GET /proposals?base=demo
//     -> { ok, base:{repo,ref,head}, proposals:[{repo, head, ..., files:[{path, ...}]}] }
// The R2 rendering law (CONTRACT.md §R2): /proposals carries the parsed
// pointer on the file row as `asset: {v, blobId, sha256, size, contentType?}`.
// Pointer rows carry no patch, no additions/deletions; pointer metadata
// (blobId/sha256/size/contentType) is egress — blob bytes are not.

import { fetchJson } from "./api.js";

// UI selectors
const el = {
 banner: document.getElementById("story-banner"),
 bannerMsg: document.getElementById("story-banner-msg"),
 chip: document.getElementById("asset-chip"),
 meta: document.getElementById("asset-meta"),
};

/**
 * Error surface — the single place fetch failures render. The static
 * narrative stays rendered (honest degradation, never a blank page);
 * no row is ever fabricated (fail-closed).
 */
function showError(message) {
 el.bannerMsg.textContent = message;
 el.banner.hidden = false;
}

/**
 * The live R2 pointer chip — the only fetch the page makes.
 *
 * Pointer derivation: walk data.proposals[].files[] and take the FIRST
 * file row whose `asset` is present. Proposals are server-ordered, so
 * the first pointer row is deterministic (the demo set is stable per
 * HEAD); the choice is documented here rather than sorted or filtered.
 * A set with no pointer row renders the honest fallback line — never a
 * fabricated chip.
 */
function renderPointerChip(asset, path) {
 // The truncated digest is display-only; the full digest rides the
 // title attribute (metadata is egress-legal, the truncation is
 // readability — the same posture as the history page's shortSha).
 const shaPrefix = String(asset.sha256 ?? "").slice(0, 12);
 const contentType = asset.contentType ?? "unrecorded"; // typed-null posture

 el.meta.textContent = "";

 const pathLine = document.createElement("div");
 pathLine.className = "story-asset-row";
 const pathToken = document.createElement("span");
 pathToken.className = "story-asset-path";
 pathToken.textContent = path;
 pathLine.append("pointer ", pathToken);
 el.meta.append(pathLine);

 const fields = [
  ["v", String(asset.v)],
  ["size", `${String(asset.size)} bytes`],
  ["contentType", String(contentType)],
  ["sha256", `${shaPrefix}…`],
 ];
 const fieldLine = document.createElement("div");
 fieldLine.className = "story-asset-row";
 for (const [key, value] of fields) {
  const token = document.createElement("span");
  token.className = "story-asset-field";
  token.textContent = `${key}: ${value}`;
  if (key === "sha256") token.title = String(asset.sha256 ?? "");
  fieldLine.append(token);
 }
 el.meta.append(fieldLine);

 const blobLine = document.createElement("div");
 blobLine.className = "story-asset-row";
 const blobLabel = document.createElement("span");
 blobLabel.className = "story-asset-label";
 blobLabel.textContent = "blobId ";
 const blobToken = document.createElement("span");
 // machine-token mono regime (the .history-sha idiom) — the opaque
 // R2 key renders as text, never as a link (no URL egress).
 blobToken.className = "story-asset-blob";
 blobToken.title = String(asset.blobId);
 blobToken.textContent = String(asset.blobId);
 blobLine.append(blobLabel, blobToken);
 el.meta.append(blobLine);

 const caption = document.createElement("div");
 caption.className = "story-asset-caption";
 // The cited route, not an anchor: the download UX belongs to the
 // files-page family; the story page cites the CONTRACT route.
 caption.textContent = "download route: GET /asset/{blobId} — CONTRACT.md §GET /asset/{blobId}";
 el.meta.append(caption);
}

/**
 * Boot: exactly one fetch. Every fixture-derived string renders through
 * textContent (no HTML interpolation); failure shows
 * the banner, keeps the static narrative, and clears the loading
 * placeholder with the honest fallback line.
 */
async function boot() {
 try {
  const data = await fetchJson("/proposals?base=demo");
  let found = null;
  for (const proposal of data?.proposals ?? []) {
   for (const file of proposal?.files ?? []) {
    if (file?.asset) {
     found = { asset: file.asset, path: file.path };
     break;
    }
   }
   if (found) break;
  }
  if (found) {
   renderPointerChip(found.asset, found.path);
  } else {
   el.meta.textContent = "no asset pointer in the current demo set";
  }
 } catch (err) {
  el.meta.textContent = "live pointer unavailable";
  showError(
   `Could not load the story's live data (${err instanceof Error ? err.message : String(err)}).`,
  );
 }
}

// Module scripts are deferred — the tail call is the sibling idiom.
boot();
