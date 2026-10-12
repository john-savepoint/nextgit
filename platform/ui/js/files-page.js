// nextgit — repo files page (vanilla ES module)
// Adheres strictly to platform/CONTRACT.md
//
// Contract being consumed (pinned shapes):
//   GET /proposals?base=demo
//     -> { ok, base:{repo,ref,head}, proposals:[{repo, head, ...}] }
//   GET /tree?repo=&ref=&path=
//     -> { ok, entries:[{name, type:'file'|'dir', size, blobHash}] }
//   GET /file?repo=&ref=&path=
//     -> { ok, classification:'text'|'binary'|'secret', text?|keys? }
//   GET /raw/{repo}/{ref}/{path}  (raw bytes, linked not fetched here)
//
// Secret-class law (CONTRACT masking law): /file is the server-side
// authority — it answers classification:'secret' + a key-names-only keys[] and
// NEVER the value. The isSecretPath() mirror below is display-only
// defense-in-depth (identical to the worker's classifier); the page
// renders secret-class paths as key names only regardless, so the law
// holds client-side too.

/**
 * State container
 */
const state = {
 proposals: null, // last /proposals payload (head resolution for picker changes)
 repo: "", // currently selected repo
 ref: "", // ref for the selected repo (proposal head, "main" fallback)
 path: "", // directory path currently listed ("")
 lastError: null, // last fetch error (surfaces in #files-banner)
};

// UI selectors
const el = {
 picker: document.getElementById("repo-picker"),
 breadcrumb: document.getElementById("breadcrumb"),
 tree: document.getElementById("file-tree"),
 banner: document.getElementById("files-banner"),
 bannerMsg: document.getElementById("files-banner-msg"),
 viewer: document.getElementById("file-viewer"),
 meta: document.getElementById("file-meta"),
 content: document.getElementById("file-content"),
 rawLink: document.getElementById("raw-link"),
};

/**
 * Secret-class classifier — EXACT mirror of the worker's
 * isSecretPath (platform/src/index.ts). Defense-in-depth only:
 * /file is the authority; this mirror drives display posture
 * (the secret row's marker class) so the law holds client-side.
 */
const SECRET_BASENAMES = new Set(["credentials.json", "secrets.json", ".dev.vars"]);
const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isSecretPath(path) {
 const base = path.slice(path.lastIndexOf("/") + 1);
 if (base.startsWith(".env")) return true;
 if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) return true;
 if (SECRET_BASENAMES.has(base)) return true;
 return path.includes("secrets/");
}

/**
 * fetchJson — same idiom as app.js: 20s timeout, AbortController,
 * `ok === false` -> throw with err.status / err.response.
 */
async function fetchJson(endpoint, options = {}) {
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

/**
 * URL builders — encodeURIComponent on repo/ref/path in EVERY URL.
 */
const treeUrl = (repo, ref, path) =>
 `/tree?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;
const fileUrl = (repo, ref, path) =>
 `/file?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;
const rawUrl = (repo, ref, path) =>
 `/raw/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodeURIComponent(path)}`;

/**
 * Error surface — the single place failures render.
 */
function showError(message) {
 state.lastError = message;
 if (el.banner && el.bannerMsg) {
  el.bannerMsg.textContent = message;
  el.banner.hidden = false;
 }
}
function clearError() {
 state.lastError = null;
 if (el.banner) el.banner.hidden = true;
 if (el.bannerMsg) el.bannerMsg.textContent = "";
}

/**
 * Path join for the display classifier (never used in a URL — URLs
 * always go through the encodeURIComponent builders above).
 */
function joinPath(dir, name) {
 return dir ? `${dir}/${name}` : name;
}

/**
 * Repo picker — fills from GET /proposals?base=demo (deduped, sorted).
 * Options come from the server-side allowlist; repo names are never
 * hand-entered.
 */
async function loadRepos() {
 try {
  const data = await fetchJson("/proposals?base=demo");
  const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
  state.proposals = proposals;
  const repos = [...new Set(proposals.map((p) => p.repo))].sort();
  if (!repos.length) {
   showError("No proposals available for the demo base.");
   return;
  }
  el.picker.textContent = "";
  for (const repo of repos) {
   const option = document.createElement("option");
   option.value = repo;
   option.textContent = repo;
   el.picker.appendChild(option);
  }
  const first = repos[0];
  state.repo = first;
  state.ref = proposals.find((p) => p.repo === first)?.head || "main";
  state.path = "";
  await loadTree();
 } catch (err) {
  showError(`Could not load repos: ${err.message || "unknown error"}`);
 }
}

/**
 * Tree listing — dirs render as breadcrumb-able links, files as
 * clickable rows. Every injected string goes through textContent.
 */
async function loadTree() {
 clearError();
 el.tree.textContent = "";
 el.viewer.hidden = true;
 el.content.textContent = "";
 el.meta.textContent = "";
 el.rawLink.removeAttribute("href");
 renderBreadcrumb();
 if (!state.repo) return;

 try {
  const data = await fetchJson(treeUrl(state.repo, state.ref, state.path));
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  if (!entries.length) {
   const li = document.createElement("li");
   li.className = "files-empty";
   li.textContent = "(empty directory)";
   el.tree.appendChild(li);
   return;
  }
  // Stable order: directories first, then files, each alphabetical.
  const sorted = [...entries].sort((a, b) => {
   if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
   return String(a.name).localeCompare(String(b.name));
  });
  for (const entry of sorted) {
   const name = String(entry?.name ?? "");
   const li = document.createElement("li");
   if (entry?.type === "dir") {
    const link = document.createElement("a");
    link.href = "javascript:void 0"; // SPA-style; the click handler navigates
    link.className = "files-row files-dir";
    link.textContent = `${name}/`;
    link.addEventListener("click", () => {
     state.path = state.path ? `${state.path}/${name}` : name;
     loadTree();
    });
    li.appendChild(link);
   } else {
    const fullPath = joinPath(state.path, name);
    const secret = isSecretPath(fullPath);
    const link = document.createElement("a");
    link.href = "javascript:void 0";
    link.className = secret ? "files-row files-file files-secret" : "files-row files-file";
    // Status is never color-alone: the word carries the secret-typed state too.
    link.textContent = secret ? `${name} — secret` : name;
    link.addEventListener("click", () => loadFile(fullPath));
    li.appendChild(link);
   }
   el.tree.appendChild(li);
  }
 } catch (err) {
  showError(`Could not load tree: ${err.message || "unknown error"}`);
 }
}

/**
 * Breadcrumb — one segment per directory level; every segment above
 * the leaf is a clickable link back to that directory.
 */
function renderBreadcrumb() {
 el.breadcrumb.textContent = "";
 const crumbs = [`${state.repo || "—"} / ${state.ref || "—"}`];
 if (state.path) {
  for (const seg of state.path.split("/")) {
   if (seg) crumbs.push(seg);
  }
 }
 crumbs.forEach((crumb, i) => {
  if (i > 0) {
   const sep = document.createElement("span");
   sep.className = "files-crumb-sep";
   sep.textContent = " / ";
   el.breadcrumb.appendChild(sep);
  }
  const isLeaf = i === crumbs.length - 1;
  const part = document.createElement(isLeaf ? "span" : "a");
  if (isLeaf) {
   part.className = "files-crumb-current";
   part.setAttribute("aria-current", "location");
  } else {
   part.className = "files-crumb";
   part.href = "javascript:void 0";
   // Segment i > 0 maps to path segments 0..i-1 (crumb 0 is repo / ref).
   const target = crumbs.slice(1, i + 1).join("/");
   part.addEventListener("click", () => {
    state.path = target;
    loadTree();
   });
  }
  part.textContent = crumb;
  el.breadcrumb.appendChild(part);
 });
}

/**
 * File viewer — branches on the contract's `classification`:
 *   text    -> <pre> body + raw link built from the encoded tuple
 *   binary  -> metadata panel + note, no content
 *   secret  -> key-names-only panel from `note` — the value never
 *              reaches the DOM (masking law; /file never sends it)
 */
async function loadFile(path) {
 clearError();
 el.viewer.hidden = false;
 el.content.textContent = "";
 el.meta.textContent = "";
 el.rawLink.removeAttribute("href");
 el.rawLink.textContent = "raw";
 renderBreadcrumb();
 if (!state.repo) return;

 try {
  const data = await fetchJson(fileUrl(state.repo, state.ref, path));
  const classification = data?.classification;
  // Raw link: built from the encoded tuple, never echoed from input.
  // Secret-class paths get NO raw link — the page must not hand out a URL
  // that fetches the unmasked value (and /raw refuses them server-side).
  if (classification === "secret") {
   el.rawLink.hidden = true;
  } else {
   el.rawLink.hidden = false;
   el.rawLink.href = rawUrl(state.repo, state.ref, path);
   el.rawLink.textContent = "raw";
  }

  if (classification === "text" && typeof data.text === "string") {
   el.meta.textContent = `text — ${path}`;
   el.content.textContent = data.text;
   return;
  }
  if (classification === "binary") {
   // Metadata panel only — binary bodies are never inlined
   // (and #file-content stays empty: no content renders here).
   el.meta.textContent =
    `binary — ${path} (metadata only)${typeof data.note === "string" ? ` · ${data.note}` : ""}`;
   return;
  }
  if (classification === "secret") {
   // Key names only (contract: `keys[]`; the server never sends the
   // value — the panel renders keys alone even if a future bug put a
   // value in `text`).
   el.meta.textContent = `secret — ${path} (key names only)`;
   const keys = Array.isArray(data.keys) ? data.keys : [];
   el.content.textContent = keys.length
    ? keys.join(", ")
    : "Secret-class file — values never leave the worker.";
   return;
  }
  // Unknown shape — do not invent content.
  el.meta.textContent = `${classification || "unknown"} — ${path}`;
  el.content.textContent = "";
 } catch (err) {
  showError(`Could not load file: ${err.message || "unknown error"}`);
 }
}

// Event wiring (declared before boot — the picker change must resolve
// the new repo's head from the cached /proposals payload).
el.picker.addEventListener("change", () => {
 state.repo = el.picker.value;
 state.ref = state.proposals?.find((p) => p.repo === state.repo)?.head || "main";
 state.path = "";
 loadTree();
});

// Boot: picker first — it selects the repo whose tree loads next.
loadRepos();
