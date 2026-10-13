// nextgit — commit history page (vanilla ES module)
// Adheres strictly to platform/CONTRACT.md
//
// Contract being consumed (pinned shapes):
//   GET /proposals?base=demo
//     -> { ok, base:{repo,ref,head}, proposals:[{repo, head, ...}] }
//   GET /commits?repo=&ref=
//     -> { ok, repo, ref, commits:[{sha, shortSha, message, author, at, parents}] }
//        newest-first first-parent chain; `at` is ISO-8601 UTC (NOT Unix
//        seconds); parents[] are 40-hex ids in git order, [] for a root
//        commit, parents[0] the first parent. The response carries no
//        `limit` field — the page must not read one.
//   GET /changes?repo=&base=&ref=&baseRef=
//     -> { ok, changeSet:{ base:{repo,ref,treeHash,sha}, head:{repo,ref,treeHash},
//          stats:{files,added,modified,removed,additions,deletions},
//          commits:[{hash,message,author,timestamp}],
//          files:[{path,status,additions,deletions,intent?,secret?,keys?,
//                  patch?,asset?}] } }
//
// Deep-link law (acceptance): /history.html?repo=<repo>&ref=<sha> resolves
// repo/ref from URLSearchParams at boot and re-runs the same two fetches
// (list + changed-files panel) — reload survival by construction, no client
// state. A commit row is a REAL anchor (?repo=&ref=<sha>), so navigation IS
// the deep link; the panel for the selected commit is loaded from the URL at
// boot. On /changes, `base` is the baseline repo and `baseRef` its ref; the
// page pins base=<repo> and baseRef=<parents[0]>, so the fork point is the
// first parent and the change-set is exactly this commit's delta; a root
// commit (parents === []) renders an honest empty state and issues NO
// /changes request.
//
// Secret-class law (CONTRACT masking law): /changes is the server-side
// authority — a secret-class file carries secret:true + a key-names-only
// keys[] and NO patch. This page renders key names only and never a patch,
// value or blob, so a buggy server that leaked a value/patch into the payload
// still cannot reach the DOM (the masking law holds client-side too). The
// asset pointer is metadata-only: blobId is an opaque content-addressed key
// (AD-10) and is NEVER rendered as a link.

/**
 * State container. repo/ref/sha resolve from the URL at boot (deep links).
 * `sha` is the selected commit — accepted only when the ?ref= param is a
 * 40-hex id (any other ref is a list-only view).
 */
const params = new URLSearchParams(window.location.search);
const SHA_RE = /^[0-9a-f]{40}$/;
const urlRef = params.get("ref") || "";
const state = {
 proposals: null, // last /proposals payload (head resolution for picker changes)
 commits: [], // last /commits payload (parents[] resolution — no second fetch)
 repo: params.get("repo") || "", // deep-linked repo ("" -> first proposal)
 ref: urlRef, // deep-linked ref ("" -> the repo's proposal head)
 sha: SHA_RE.test(urlRef) ? urlRef : "", // the selected commit (list-only when "")
 lastError: null, // last fetch error (surfaces in #history-banner)
};

// Monotonic load tokens: commits and detail fetches can overlap (fast clicks,
// slow edge); only the LATEST request may write the DOM (stale responses drop).
const loadSeq = { commits: 0, detail: 0 };

// UI selectors
const el = {
 picker: document.getElementById("repo-picker"),
 breadcrumb: document.getElementById("history-breadcrumb"),
 list: document.getElementById("commit-list"),
 banner: document.getElementById("history-banner"),
 bannerMsg: document.getElementById("history-banner-msg"),
 detail: document.getElementById("commit-detail"),
 detailMeta: document.getElementById("commit-detail-meta"),
 files: document.getElementById("commit-files"),
};

/**
 * fetchJson — same idiom as app.js / files-page.js: 20s timeout,
 * AbortController, `ok === false` -> throw with err.status / err.response;
 * a single retry on timeout only.
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
 * URL builders — encodeURIComponent on every param in EVERY URL.
 * /changes requires `repo` too (CONTRACT §GET /changes); on /changes `base`
 * is the baseline repo and `baseRef` its ref, so the page pins base=<repo>
 * and baseRef=<parents[0]> — the fork point is the first parent and the
 * change-set is exactly this commit's delta (the CONTRACT baseRef-follows-ref
 * law, materialized).
 */
const commitsUrl = (repo, ref) =>
 `/commits?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}`;
const changesUrl = (repo, ref, baseRef) =>
 `/changes?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&baseRef=${encodeURIComponent(baseRef)}`;

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
 * shortRef — a 40-hex id renders as its 7-char short form; any other ref
 * (branch name) renders verbatim; absent renders as an em dash.
 */
function shortRef(ref) {
 const value = String(ref ?? "");
 if (SHA_RE.test(value)) return value.slice(0, 7);
 return value || "—";
}

/**
 * markPickerUnavailable — when the repo list cannot be resolved (an empty
 * proposal set or a /proposals failure), disable the picker and replace the
 * literal "loading…" placeholder with an explicit "(unavailable)" option so
 * the control is disabled/annotated rather than permanently stuck loading.
 */
function markPickerUnavailable() {
 el.picker.disabled = true;
 el.picker.textContent = "";
 const opt = document.createElement("option");
 opt.value = "";
 opt.textContent = "(unavailable)";
 el.picker.appendChild(opt);
}

/**
 * Repo picker — fills from GET /proposals?base=demo (deduped, sorted).
 * Options come from the server-side allowlist; repo names are never
 * hand-entered. A deep-linked repo is honored when it is on the allowlist.
 */
async function loadRepos() {
 try {
  const data = await fetchJson("/proposals?base=demo");
  const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
  state.proposals = proposals;
  const repos = [...new Set(proposals.map((p) => p.repo))].sort();
  if (!repos.length) {
   showError("No proposals available for the demo base.");
   markPickerUnavailable();
   return;
  }
  el.picker.textContent = "";
  for (const repo of repos) {
   const option = document.createElement("option");
   option.value = repo;
   option.textContent = repo;
   el.picker.appendChild(option);
  }
  const requested = state.repo;
  const selected = repos.includes(requested) ? requested : repos[0];
  state.repo = selected;
  el.picker.value = selected;
  // A non-sha ref (an absent param, or a branch name) resolves to the
  // repo's proposal head; a 40-hex ref stays the deep-linked commit.
  if (!SHA_RE.test(state.ref)) {
   state.ref = state.ref || proposals.find((p) => p.repo === selected)?.head || "main";
   state.sha = "";
  }
  await loadCommits();
  // A deep-linked ?repo= outside the allowlist was substituted above; surface
  // the substitution through the single error surface once the commit load
  // (which calls clearError first) has completed.
  if (requested && !repos.includes(requested)) {
   showError(`Repo "${requested}" is not in the demo allowlist — showing "${selected}".`);
  }
 } catch (err) {
  showError(`Could not load repos: ${err.message || "unknown error"}`);
  markPickerUnavailable();
 }
}

/**
 * Commit list — newest-first rows in contract order (deterministic; no
 * re-sort). Each row is a REAL anchor so the deep link survives reload.
 * Once the list is in hand, a deep-linked commit loads its changed files.
 */
async function loadCommits() {
 clearError();
 const token = ++loadSeq.commits; // overlapping loads must not interleave renders
 el.list.textContent = "";
 el.detail.hidden = true;
 el.files.textContent = "";
 el.detailMeta.textContent = "";
 renderBreadcrumb();
 if (!state.repo) return;

 try {
  const data = await fetchJson(commitsUrl(state.repo, state.ref));
  if (token !== loadSeq.commits) return; // a newer navigation won
  const commits = Array.isArray(data?.commits) ? data.commits : [];
  state.commits = commits; // cached for parents[] resolution (no second /commits)
  renderCommits(commits);
  if (state.sha) await loadDetail(state.sha);
 } catch (err) {
  if (token !== loadSeq.commits) return;
  showError(`Could not load commits: ${err.message || "unknown error"}`);
 }
}

/**
 * Commit rows — every injected string goes through textContent.
 */
function renderCommits(commits) {
 const frag = document.createDocumentFragment();
 if (!commits.length) {
  const li = document.createElement("li");
  li.className = "history-empty";
  li.textContent = "(no commits)";
  frag.appendChild(li);
  el.list.replaceChildren(frag);
  return;
 }
 for (const commit of commits) {
  const sha = String(commit?.sha ?? "");
  const li = document.createElement("li");
  const anchor = document.createElement("a");
  // A REAL anchor: navigating (and reloading) the resulting URL re-runs the
  // same two fetches — the deep link IS the navigation.
  anchor.href = `?repo=${encodeURIComponent(state.repo)}&ref=${encodeURIComponent(sha)}`;
  anchor.className = "history-row";
  anchor.setAttribute("data-sha", sha);
  const head = document.createElement("span");
  head.className = "history-sha";
  head.textContent = String(commit?.shortSha ?? shortRef(sha));
  anchor.appendChild(head);
  anchor.appendChild(document.createTextNode(` — ${commit?.message ?? ""}`));
  const meta = document.createElement("span");
  meta.className = "history-meta";
  meta.textContent = `${commit?.author ?? ""} · ${commit?.at ?? ""}`;
  anchor.appendChild(meta);
  li.appendChild(anchor);
  frag.appendChild(li);
 }
 el.list.replaceChildren(frag);
}

/**
 * Breadcrumb — repo / ref, plus / <shortSha> once a commit is selected.
 * The repo / ref crumb is a link back to the list-only view (?repo=… no ref).
 */
function renderBreadcrumb() {
 el.breadcrumb.textContent = "";
 const back = document.createElement("a");
 back.className = "history-crumb";
 back.href = `?repo=${encodeURIComponent(state.repo)}`;
 back.textContent = `${state.repo || "—"} / ${state.ref ? shortRef(state.ref) : "—"}`;
 el.breadcrumb.appendChild(back);
 if (state.sha) {
  const sep = document.createElement("span");
  sep.className = "history-crumb-sep";
  sep.textContent = " / ";
  el.breadcrumb.appendChild(sep);
  const current = document.createElement("span");
  current.className = "history-crumb-current";
  current.setAttribute("aria-current", "location");
  current.textContent = shortRef(state.sha);
  el.breadcrumb.appendChild(current);
 }
}

/**
 * Changed-files panel — GET /changes for the selected commit.
 *   base=<repo>          -> the baseline repo (allowlisted; CONTRACT §GET /changes)
 *   baseRef=<parents[0]> -> the fork point the change-set is measured against
 *   parents === []       -> the root-commit note; NO request is issued
 */
async function loadDetail(sha) {
 const token = ++loadSeq.detail; // overlapping selections must not interleave
 const commit = state.commits.find((c) => c?.sha === sha);
 const parents = Array.isArray(commit?.parents) ? commit.parents : [];
 el.detail.hidden = false;
 el.files.textContent = "";
 el.detailMeta.textContent = `Changed files in ${shortRef(sha)}`;

 if (!commit) {
  // Unknown sha — honest empty (no invented content), mirroring the styled
  // .history-empty idiom rather than leaving a visible, rowless box.
  const li = document.createElement("li");
  li.className = "history-empty";
  li.textContent = "unknown commit — no changed files to show";
  el.files.appendChild(li);
  return;
 }

 if (!parents.length) {
  // Root commit: there is no parent to diff against, so a /changes request
  // (base=<sha>) would be a broken/no-op diff — render the note instead.
  const li = document.createElement("li");
  li.className = "history-root-note";
  li.textContent = "root commit — no parent to diff against";
  el.files.appendChild(li);
  return;
 }

 try {
  const data = await fetchJson(changesUrl(state.repo, sha, parents[0]));
  if (token !== loadSeq.detail) return; // a newer selection won
  renderDetail(data?.changeSet, sha);
 } catch (err) {
  if (token !== loadSeq.detail) return;
  showError(`Could not load changed files: ${err.message || "unknown error"}`);
 }
}

/**
 * Changed-file rows — rendered like the files page:
 *   ordinary -> path + status word + +additions/-deletions
 *   secret   -> the word "secret" + keys[] names only (never a patch/value)
 *   asset    -> pointer chip: path + contentType + note + v/size + sha256 prefix
 *               (metadata only — blobId is opaque and never a link)
 */
function renderDetail(changeSet, sha) {
 const stats = changeSet?.stats || {};
 const files = Array.isArray(changeSet?.files) ? changeSet.files : [];
 el.detailMeta.textContent =
  `Changed files in ${shortRef(sha)} — ${stats.files ?? files.length} files (+${stats.additions ?? 0}/-${stats.deletions ?? 0})`;

 const frag = document.createDocumentFragment();
 if (!files.length) {
  const li = document.createElement("li");
  li.className = "history-empty";
  li.textContent = "(no changed files)";
  frag.appendChild(li);
  el.files.replaceChildren(frag);
  return;
 }
 for (const file of files) {
  const path = String(file?.path ?? "");
  const li = document.createElement("li");
  if (file?.asset) {
   const asset = file.asset;
   li.className = "commit-file-row commit-asset";
   const bits = [path, asset.contentType || "application/octet-stream", "asset pointer (metadata only)"];
   if (asset.v != null) bits.push(`v${asset.v}`);
   if (asset.size != null) bits.push(`${asset.size} bytes`);
   if (typeof asset.sha256 === "string") bits.push(`sha256 ${asset.sha256.slice(0, 12)}`);
   li.textContent = bits.join(" · ");
  } else if (file?.secret === true) {
   // Key names only — the value and patch never reach the DOM (masking law).
   const keys = Array.isArray(file.keys) ? file.keys : [];
   li.className = "commit-file-row commit-secret";
   li.textContent = `${path} · secret · ${keys.length ? keys.join(", ") : "values never leave the worker"}`;
  } else {
   li.className = "commit-file-row";
   li.textContent = `${path} · ${String(file?.status ?? "")} · +${file?.additions ?? 0} -${file?.deletions ?? 0}`;
  }
  frag.appendChild(li);
 }
 el.files.replaceChildren(frag);
}

// Event wiring (declared before boot — the picker change must resolve the new
// repo's head from the cached /proposals payload).
el.picker.addEventListener("change", () => {
 state.repo = el.picker.value;
 state.ref = state.proposals?.find((p) => p.repo === state.repo)?.head || "main";
 state.sha = "";
 loadCommits();
});

// Boot: picker first — it selects the repo whose commit log loads next. A
// deep-linked ?ref=<sha> resolves the panel once the list is in hand.
loadRepos();
