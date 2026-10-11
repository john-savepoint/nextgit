#!/usr/bin/env bun
// Contract suite: AD-14 client protocol — the entity surface boundary
// (e11-impl-entity-surface-boundary). Pins the two served routes that
// close the Floor/Project and Pull/Proposal+detail entities:
//   GET /floors            — one floor per namespace repo
//   GET /proposals/{repo}  — the proposal card + detail
// Run: bun porting/tests/client-protocol.test.mjs   (exit 0 = pass)
//
// Real construction: the real worker module is imported and exercised
// through worker.fetch against an in-memory Artifacts fake (the
// masking-posture / one-set-one-response fixture surface: `demo` base +
// `agent-1`/`agent-2` with intents + a colliding file). The platform
// binding seam is the only fake; no module mocking, no source grep.
// Full-suite safe: fresh env per case, no network, no Chrome.
//
// Legs:
//   1. Floor conformance — exact {id,name,repo,branch,cloning,counts};
//      branch from the list entry's defaultBranch; non-ready ->
//      cloning:true; counts = {workers,busy,waiting} with the
//      busy=0/waiting=count client-local split.
//   2. Proposal+detail conformance — exact card keys; title === intent;
//      state ∈ landing vocabulary; headRef/baseRef === "main";
//      detail.commits[0] === /changes commit shape; the colliding
//      fixture (base moved under the pending proposal) ->
//      state:"conflict" + non-empty detail.merge.conflicted.
//   3. Client-protocol field coverage — every pinned client-readable
//      field present per platform-served entity (Floor, Pull, detail).
//   4. AD-14 negative scan — deep key scan (not substring) over every
//      response body: no field NAMED reviewDecision / mergeStateStatus
//      / mergeable ever leaves the worker (the enum VALUE "mergeable"
//      in conflicts[].kind is pre-existing and pinned; the scan
//      targets keys, not values).
//   5. Boundary discipline — bad repo charset -> 400 before any repo
//      read; unknown repo -> 404; POST /floors -> 405; static
//      /proposals envelope unchanged ({base,conflicts,ok,proposals,ref,summary}).

import worker from "../../platform/src/index.ts";

let fails = 0;
const check = (name, ok, detail = "") => {
 if (!ok) fails++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const J = (x) => JSON.stringify(x);
const exactKeys = (obj, keys) => {
 if (!obj || typeof obj !== "object") return false;
 const actual = Object.keys(obj).sort();
 const wanted = [...keys].sort();
 return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the one-set-one-response fixture surface).
// `discovered` carries the list() entries with defaultBranch + status.
// ---------------------------------------------------------------------------

function makeFakeArtifacts() {
 const blobText = new Map();
 const blobHashByText = new Map();
 const treeEntries = new Map();
 const repos = new Map();
 const discovered = [];

 function internBlob(text) {
  if (!blobHashByText.has(text)) {
   const hash = `blob-${blobHashByText.size + 1}`;
   blobHashByText.set(text, hash);
   blobText.set(hash, text);
  }
  return blobHashByText.get(text);
 }
 function entriesFor(node) {
  return Object.entries(node).map(([name, child]) =>
   typeof child === "string"
    ? { name, mode: "100644", hash: child, type: "blob" }
    : { name, mode: "40000", hash: treeHashFor(child), type: "tree" }
  );
 }
 function treeHashFor(node) {
  const entries = entriesFor(node);
  const hash = `tree-${treeEntries.size + 1}`;
  treeEntries.set(hash, entries);
  return hash;
 }
 function tree(files) {
  const root = {};
  for (const [path, text] of Object.entries(files)) {
   const parts = path.split("/");
   let node = root;
   for (const part of parts.slice(0, -1)) { node[part] = node[part] || {}; node = node[part]; }
   node[parts[parts.length - 1]] = internBlob(text);
  }
  return treeHashFor(root);
 }
 function commit(hash, treeHash) {
  const identity = { name: "fixture", email: "fixture@test" };
  return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
 }
 function defineRepo(name, { history, refs, intents = {} }) { repos.set(name, { history, refs, intents }); }
 function lookupPath(treeHash, path) {
  const parts = path.split("/");
  let entries = treeEntries.get(treeHash);
  for (let i = 0; i < parts.length; i++) {
   const entry = (entries ?? []).find((e) => e.name === parts[i]);
   if (!entry) return null;
   if (i === parts.length - 1) return entry.type === "blob" ? entry.hash : null;
   if (entry.type !== "tree") return null;
   entries = treeEntries.get(entry.hash);
  }
  return null;
 }
 function repoFor(name) {
  const store = repos.get(name);
  if (!store) throw new Error(`fixture: no repo ${name}`);
  const resolve = (ref) => store.history.find((c) => c.hash === ref) ?? null;
  return {
   async log({ ref = "HEAD", limit = 50 } = {}) {
    const byBranch = store.refs[ref];
    if (byBranch) return store.history.slice(0, limit);
    const single = resolve(ref);
    return single ? [single].slice(0, limit) : [];
   },
   async readTree(hash) { return treeEntries.get(hash) ?? null; },
   async readFile({ ref, path }) {
    const head = store.refs[ref] ? store.history.find((c) => c.hash === store.refs[ref]) : resolve(ref);
    if (!head) return null;
    if (path.startsWith("NEXTGIT_INTENT/")) {
     const sha = path.slice("NEXTGIT_INTENT/".length).replace(/\.txt$/, "");
     const text = store.intents[sha];
     return text === undefined ? null : new Blob([text]);
    }
    const blobHash = lookupPath(head.treeHash, path);
    return blobHash === null ? null : new Blob([blobText.get(blobHash)]);
   },
   async readBlob(hash) { return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null; },
   async info() { return { remote: `https://artifacts.invalid/nextgit/${name}` }; },
   async revokeToken() { return true; },
   [Symbol.dispose]() { },
  };
 }
 return {
  discovered,
  ARTIFACTS: {
   async get(name) { return repoFor(name); },
   async list({ limit = 200 } = {}) { return { repos: discovered.slice(0, limit) }; },
  },
  tree, commit, defineRepo,
 };
}

function makeKV() {
 const store = new Map();
 return {
  async get(key) { return store.get(key) ?? null; },
  async put(key, value) { store.set(key, value); },
 };
}

// ---------------------------------------------------------------------------
// Fixture: `demo` base + `agent-1`/`agent-2` with intents + a colliding
// file. The collision is the base MOVING under the pending proposals:
// demo's head advanced past the shared fork onto the same lines the
// agents changed, so each proposal's 3-way fold (ancestor = fork point,
// ours = current base head, theirs = proposal head) is a real text
// conflict — the same shape POST /land's 409 conflicted carries.
// agent-2's list entry is non-ready (importing) with a non-main
// defaultBranch, so the floor conformance leg sees cloning:true.
// ---------------------------------------------------------------------------

const AUTH_V0 = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_A1 = "export const auth = 2;\nexport const keep = true;\n";
const AUTH_A2 = "export const auth = 99;\nexport const keep = true;\n";
const AUTH_LAND = "export const auth = 3;\nexport const keep = true;\n";
const BASE_FILES = { "src/auth.ts": AUTH_V0 };

function makeEnvironment() {
 const fake = makeFakeArtifacts();
 const cFork = fake.commit("c-fork", fake.tree(BASE_FILES));
 // demo's DEFAULT branch advanced (cLand) after the agents forked.
 const cLand = fake.commit("c-land", fake.tree({ ...BASE_FILES, "src/auth.ts": AUTH_LAND }));
 fake.defineRepo("demo", { history: [cLand, cFork], refs: { main: cLand.hash } });
 fake.discovered.push({ name: "demo", status: "ready", defaultBranch: "main" });

 const cA1 = fake.commit("c-agent-1", fake.tree({ ...BASE_FILES, "src/auth.ts": AUTH_A1 }));
 fake.defineRepo("agent-1", { history: [cA1, cFork], refs: { main: cA1.hash }, intents: { [cA1.hash]: "Bump the auth module for agent-1." } });
 fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

 const cA2 = fake.commit("c-agent-2", fake.tree({ ...BASE_FILES, "src/auth.ts": AUTH_A2 }));
 fake.defineRepo("agent-2", { history: [cA2, cFork], refs: { main: cA2.hash }, intents: { [cA2.hash]: "Rewrite the auth constants for agent-2." } });
 fake.discovered.push({ name: "agent-2", status: "importing", defaultBranch: "trunk" });

 const env = {
  ARTIFACTS: fake.ARTIFACTS,
  LIVE: makeKV(),
  CACHE: makeKV(),
  ASSETS: { fetch: async () => new Response("") },
  AI: { run: async () => null },
  AUTH_MODE: "demo",
 };
 return { env, fake };
}

const get = async (env, path) => {
 const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`), env);
 const body = await res.json().catch(() => null);
 return { status: res.status, body };
};

// Deep key scan: collect every object key reachable in `value`.
function deepKeys(value, out = new Set()) {
 if (Array.isArray(value)) { for (const v of value) deepKeys(v, out); return out; }
 if (value && typeof value === "object") {
  for (const [k, v] of Object.entries(value)) { out.add(k); deepKeys(v, out); }
 }
 return out;
}

const LANDING_VOCAB = new Set(["ready", "conflict", "landed", "withheld-secret"]);
const CHANGES_COMMIT_KEYS = ["hash", "message", "author", "timestamp"];

// ---------------------------------------------------------------------------
// Leg 1 — floor conformance
// ---------------------------------------------------------------------------
{
 const { env } = makeEnvironment();
 const { status, body } = await get(env, "/floors");
 check("1 /floors -> 200 ok:true", status === 200 && body?.ok === true, `status ${status}`);
 check("1 /floors envelope exact {ok,floors}", exactKeys(body, ["ok", "floors"]), J(body && Object.keys(body)));
 check("1 /floors: one floor per namespace repo (3)", Array.isArray(body?.floors) && body.floors.length === 3, J(body?.floors?.length));
 const byRepo = Object.fromEntries((body?.floors ?? []).map((f) => [f.repo, f]));
 for (const [repo, want] of [
  ["demo", { branch: "main", cloning: false }],
  ["agent-1", { branch: "main", cloning: false }],
  ["agent-2", { branch: "trunk", cloning: true }],
 ]) {
  const f = byRepo[repo];
  check(`1 floor ${repo}: exact keys {id,name,repo,branch,cloning,counts}`,
   f && exactKeys(f, ["id", "name", "repo", "branch", "cloning", "counts"]),
   f ? J(Object.keys(f)) : "missing");
  check(`1 floor ${repo}: branch === list defaultBranch (${want.branch})`,
   f?.branch === want.branch, `got ${J(f?.branch)}`);
  check(`1 floor ${repo}: cloning === ${want.cloning} (status !== ready)`,
   f?.cloning === want.cloning, `got ${J(f?.cloning)}`);
  check(`1 floor ${repo}: id === name === repo`,
   f?.id === repo && f?.name === repo && f?.repo === repo, J([f?.id, f?.name, f?.repo]));
  check(`1 floor ${repo}: counts exact {workers,busy,waiting}`,
   f?.counts && exactKeys(f.counts, ["workers", "busy", "waiting"]),
   f?.counts ? J(Object.keys(f.counts)) : "missing");
  check(`1 floor ${repo}: counts.workers === 2 (agent-* fleet), busy === 0, waiting === 2`,
   f?.counts?.workers === 2 && f?.counts?.busy === 0 && f?.counts?.waiting === 2,
   J(f?.counts));
 }
}

// ---------------------------------------------------------------------------
// Leg 2 — proposal + detail conformance
// ---------------------------------------------------------------------------
{
 const { env } = makeEnvironment();
 const { status, body } = await get(env, "/proposals/agent-1");
 check("2 /proposals/agent-1 -> 200 ok:true", status === 200 && body?.ok === true, `status ${status}`);
 check("2 envelope exact {ok,proposal}", exactKeys(body, ["ok", "proposal"]), J(body && Object.keys(body)));
 const p = body?.proposal;
 check("2 card exact keys {repo,number,title,state,headRef,baseRef,additions,deletions,stats,checks,detail}",
  p && exactKeys(p, ["repo", "number", "title", "state", "headRef", "baseRef", "additions", "deletions", "stats", "checks", "detail"]),
  p ? J(Object.keys(p)) : "missing");
 check("2 repo === 'agent-1'", p?.repo === "agent-1", J(p?.repo));
 check("2 number === 'agent-1' (repo name)", p?.number === "agent-1", J(p?.number));
 check("2 title === intent text", p?.title === "Bump the auth module for agent-1.", J(p?.title));
 check("2 state ∈ landing vocabulary", LANDING_VOCAB.has(p?.state), J(p?.state));
 check("2 state === 'conflict' (colliding fixture: base moved under the proposal)",
  p?.state === "conflict", J(p?.state));
 check("2 headRef === 'main'", p?.headRef === "main", J(p?.headRef));
 check("2 baseRef === 'main'", p?.baseRef === "main", J(p?.baseRef));
 check("2 additions/deletions are the change-set stats (1/1)",
  p?.additions === 1 && p?.deletions === 1, J([p?.additions, p?.deletions]));
 check("2 stats === change-set stats shape {files,added,modified,removed,additions,deletions}",
  p?.stats && exactKeys(p.stats, ["files", "added", "modified", "removed", "additions", "deitions"]).valueOf() === true || (p?.stats && exactKeys(p.stats, ["files", "added", "modified", "removed", "additions", "deletions"])),
  p?.stats ? J(Object.keys(p.stats)) : "missing");
 check("2 checks is an array", Array.isArray(p?.checks), J(p?.checks));

 const d = p?.detail;
 check("2 detail exact keys {body,commits,merge,files}",
  d && exactKeys(d, ["body", "commits", "merge", "files"]),
  d ? J(Object.keys(d)) : "missing");
 check("2 detail.body === intent text", d?.body === "Bump the auth module for agent-1.", J(d?.body));
 check("2 detail.commits is a non-empty array", Array.isArray(d?.commits) && d.commits.length > 0, J(d?.commits?.length));
 check("2 detail.commits[0] === /changes commit shape {hash,message,author,timestamp}",
  Array.isArray(d?.commits) && d.commits.every((c) => exactKeys(c, CHANGES_COMMIT_KEYS)),
  d?.commits?.[0] ? J(Object.keys(d.commits[0])) : "missing");
 check("2 detail.commits newest-first (commits[0].hash === proposal head)",
  Array.isArray(d?.commits) && d.commits[0]?.hash === "c-agent-1", J(d?.commits?.[0]?.hash));
 check("2 detail.merge exact keys {status,conflicted}",
  d?.merge && exactKeys(d.merge, ["status", "conflicted"]),
  d?.merge ? J(Object.keys(d.merge)) : "missing");
 check("2 detail.merge.status === 'conflict'", d?.merge?.status === "conflict", J(d?.merge?.status));
 check("2 detail.merge.conflicted non-empty (the colliding file)",
  Array.isArray(d?.merge?.conflicted) && d.merge.conflicted.length > 0, J(d?.merge?.conflicted));
 check("2 detail.merge.conflicted carries src/auth.ts",
  (d?.merge?.conflicted ?? []).includes("src/auth.ts"), J(d?.merge?.conflicted));
 check("2 detail.files is a non-empty array (the fold's file list)",
  Array.isArray(d?.files) && d.files.length > 0, J(d?.files?.length));

 // agent-2: same shape, its own intent, same conflict verdict.
 const a2 = await get(env, "/proposals/agent-2");
 check("2 /proposals/agent-2 -> 200 with the same card shape",
  a2.status === 200 && exactKeys(a2.body?.proposal, ["repo", "number", "title", "state", "headRef", "baseRef", "additions", "deletions", "stats", "checks", "detail"]),
  `status ${a2.status}`);
 check("2 agent-2 title === its own intent", a2.body?.proposal?.title === "Rewrite the auth constants for agent-2.", J(a2.body?.proposal?.title));
 check("2 agent-2 state === 'conflict'", a2.body?.proposal?.state === "conflict", J(a2.body?.proposal?.state));
}

// ---------------------------------------------------------------------------
// Leg 3 — client-protocol field coverage per platform-served entity
// ---------------------------------------------------------------------------
{
 const { env } = makeEnvironment();
 const floors = await get(env, "/floors");
 const detail = await get(env, "/proposals/agent-1");
 const changes = await get(env, "/changes?repo=agent-1");
 const proposals = await get(env, "/proposals");

 // Entity 1 (Floor / Project): id, name, repo, branch, cloning, counts{workers,busy,waiting}
 const floorKeys = deepKeys(floors.body?.floors?.[0]);
 check("3 Floor entity: every pinned client-readable field present",
  ["id", "name", "repo", "branch", "cloning", "counts", "workers", "busy", "waiting"].every((k) => floorKeys.has(k)),
  J([...floorKeys]));

 // Entity 5 (Pull / Proposal): number, title, state, headRef, baseRef, additions, deletions
 const cardKeys = deepKeys(detail.body?.proposal).difference(deepKeys(detail.body?.proposal?.detail));
 check("3 Pull entity: every pinned client-readable field present",
  ["number", "title", "state", "headRef", "baseRef", "additions", "deletions", "repo"].every((k) => cardKeys.has(k)),
  J([...cardKeys]));

 // Entity 6 (PR / Proposal detail): body, commits, merge state, files
 const detailKeys = deepKeys(detail.body?.proposal?.detail);
 check("3 PR-detail entity: every pinned client-readable field present",
  ["body", "commits", "merge", "status", "conflicted", "files", "hash", "message", "author", "timestamp", "path"].every((k) => detailKeys.has(k)),
  J([...detailKeys]));

 // The set view still auto-discovers the ready fleet the floors serve
 // (auto-discovery law: status === "ready" — agent-2 is importing, so
 // the set view carries the ready subset; the floor surface carries all).
 check("3 /proposals set view auto-discovers the ready agent-* fleet (agent-1)",
  proposals.body?.proposals?.length === 1 && proposals.body?.proposals?.[0]?.repo === "agent-1", J(proposals.body?.proposals?.map((p) => p.repo)));

 // Cross-route agreement: detail.commits[0] is the /changes commit shape,
 // and the card's additions/deletions agree with /changes stats.
 const cs = changes.body?.changeSet;
 check("3 detail.commits[0] deep-equals /changes commits[0]",
  J(detail.body?.proposal?.detail?.commits?.[0]) === J(cs?.commits?.[0]),
  J([detail.body?.proposal?.detail?.commits?.[0], cs?.commits?.[0]]));
 check("3 card additions/deletions agree with /changes stats",
  detail.body?.proposal?.additions === cs?.stats?.additions && detail.body?.proposal?.deletions === cs?.stats?.deletions,
  J([detail.body?.proposal?.additions, cs?.stats?.additions]));

}

// ---------------------------------------------------------------------------
// Leg 4 — AD-14 negative scan: no field NAMED reviewDecision /
// mergeStateStatus / mergeable leaves the worker, on ANY route.
// Deep key scan (not substring): the pre-existing enum VALUE
// "mergeable" in conflicts[].kind is fine; a key named `mergeable`
// is not.
// ---------------------------------------------------------------------------
{
 const { env } = makeEnvironment();
 const bodies = [];
 for (const path of [
  "/floors",
  "/proposals/agent-1",
  "/proposals/agent-2",
  "/proposals",
  "/changes?repo=agent-1",
  "/merge?base=demo&repos=agent-1",
  "/events",
  "/health",
 ]) {
  const { status, body } = await get(env, path);
  bodies.push({ path, status, body });
 }
 const FORBIDDEN = ["reviewDecision", "mergeStateStatus", "mergeable"];
 const offenders = [];
 for (const { path, body } of bodies) {
  const keys = deepKeys(body);
  for (const bad of FORBIDDEN) if (keys.has(bad)) offenders.push(`${path}:${bad}`);
 }
 check("4 AD-14 negative scan: no reviewDecision/mergeStateStatus/mergeable KEY on any served route",
  offenders.length === 0, J(offenders));
 // Key-vs-value discipline: the scan asserts KEYS. A naive
 // substring scan over the serialized bodies would also flag the
 // pre-existing enum VALUE "mergeable" (conflicts[].kind, pinned
 // by classifyPair) — assert no forbidden token is ever serialized
 // as a JSON key, while values may legally carry them.
 const serialized = bodies.map((b) => J(b.body)).join("\n");
 check("4 no forbidden token appears as a serialized KEY (only values may carry them)",
  offenders.length === 0 && !FORBIDDEN.some((bad) => new RegExp(`"${bad}"\\s*:`).test(serialized)),
  J(offenders));
}

// ---------------------------------------------------------------------------
// Leg 5 — boundary discipline
// ---------------------------------------------------------------------------
{
 const { env } = makeEnvironment();
 const bad = await get(env, "/proposals/bad%20repo");
 check("5 /proposals/<bad-charset> -> 400 {ok:false}", bad.status === 400 && bad.body?.ok === false, `status ${bad.status} ${J(bad.body)}`);
 const unknown = await get(env, "/proposals/agent-unknown");
 check("5 /proposals/<unknown-repo> -> 404 {ok:false}", unknown.status === 404 && unknown.body?.ok === false, `status ${unknown.status} ${J(unknown.body)}`);
 const post = await worker.fetch(new Request("https://nextgit.invalid/floors", { method: "POST" }), env);
 check("5 POST /floors -> 405 method-not-allowed", post.status === 405 && (await post.json()).error === "method-not-allowed", `status ${post.status}`);
 const postDetail = await worker.fetch(new Request("https://nextgit.invalid/proposals/agent-1", { method: "POST" }), env);
 check("5 POST /proposals/{repo} -> 405 method-not-allowed", postDetail.status === 405, `status ${postDetail.status}`);
 // Static /proposals wins for the bare path: envelope unchanged (the
 // one-set-one-response pin).
 const bare = await get(env, "/proposals");
 check("5 static /proposals envelope unchanged {base,conflicts,ok,proposals,ref,summary}",
  exactKeys(bare.body, ["base", "conflicts", "ok", "proposals", "ref", "summary"]),
  bare.body ? J(Object.keys(bare.body)) : J(bare.body));
 // Deny-by-default holds on the new routes (the authorize() chokepoint).
 const denyEnv = { ...env, AUTH_MODE: undefined };
 const denied = await get(denyEnv, "/floors");
 check("5 /floors in deny mode -> 401 unauthorized", denied.status === 401 && denied.body?.error === "unauthorized", `status ${denied.status} ${J(denied.body)}`);
 const deniedDetail = await get(denyEnv, "/proposals/agent-1");
 check("5 /proposals/{repo} in deny mode -> 401 unauthorized", deniedDetail.status === 401 && deniedDetail.body?.error === "unauthorized", `status ${deniedDetail.status} ${J(deniedDetail.body)}`);
 // Demo-mode allowlist (AD-9): the path-carried {repo} is the
 // scope carrier this route cannot get from the query string,
 // so the handler re-checks DEMO_REPO_RE before any compute
 // read (the /land and /judge precedent). A charset-valid
 // non-allowlisted repo -> 403 {ok:false,error:"repo-not-allowed",detail}
 // with zero Artifacts reads (the binding throws if reached).
 const noReadEnv = {
  ...env,
  ARTIFACTS: {
   async get() { throw new Error("should not be reached"); },
   async list() { throw new Error("should not be reached"); },
  },
 };
 const notAllowed = await get(noReadEnv, "/proposals/notdemo-xyz");
 check("5 /proposals/<non-allowlisted> -> 403 repo-not-allowed (handler allowlist, zero Artifacts reads)",
  notAllowed.status === 403 &&
  notAllowed.body?.ok === false &&
  notAllowed.body?.error === "repo-not-allowed" &&
  notAllowed.body?.detail === `repo "notdemo-xyz" is outside the demo allowlist`,
  `status ${notAllowed.status} ${J(notAllowed.body)}`);
 const control = await get(noReadEnv, "/changes?repo=notdemo-xyz");
 check("5 /changes?repo=<non-allowlisted> -> 403 repo-not-allowed (control)",
  control.status === 403 && control.body?.error === "repo-not-allowed",
  `status ${control.status} ${J(control.body)}`);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
