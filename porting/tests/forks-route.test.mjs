#!/usr/bin/env bun
// Contract suite: GET /forks — the fork ecosystem read route (CAP-10).
// Run: bun porting/tests/forks-route.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` and the real
// `computeSixClusterSignals` and drives worker.fetch() with an
// in-memory Artifacts fake (the fork-signals.test.mjs harness shape;
// fresh env per case, no network, no Chrome, no mock.module, no
// source grep). The route is exercised through the real dispatcher:
// the authorize() chokepoint, the handler, and the compute seams.
//
// Groups (each defends an observable contract):
//   1. Typed shape — {ok,base,forks}; each fork {repo,signals,upstream};
//      six clusters, number|null, finite in [0,1]
//   2. Discovery — only agent-* ready repos appear (non-agent and
//      non-ready fixtures are excluded)
//   3. Lineage — a recorded fork:<name> serves upstream {repo,forkPoint};
//      an unrecorded fork serves upstream null
//   4. Ordering — strongest-first by rankSignals
//   5. Allowlist — a non-demo base is 403 repo-not-allowed with zero
//      ARTIFACTS reads
//   6. Bad input — a charset-invalid base is 400 before any repo read
//   7. Rate — the 61st in-window call is 429 (60/60s)
//   8. Secret law — a secret-class-only fork leaks no fixture secret
//      value into the serialized body (AD-4)
//   9. One computation — route signals deep-equal a direct
//      computeSixClusterSignals call

import worker from "../../platform/src/index.ts";
import { computeSixClusterSignals } from "../../platform/src/fork-signals.ts";

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
 if (ok) pass++;
 else fails++;
 console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (fork-signals.test.mjs shape) — the bounded
// `list()` the discovery seam reads and the `get()` the compute seams read.
// READS counts the binding touches so group 5 can prove zero reads.
// ---------------------------------------------------------------------------
const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

const READS = { list: 0, get: 0 };

function internBlob(text) {
 if (!blobHashByText.has(text)) {
  const hash = `blob-${blobHashByText.size + 1}`;
  blobHashByText.set(text, hash);
  blobText.set(hash, text);
 }
 return blobHashByText.get(text);
}

function entriesFor(node) {
 return Object.entries(node).map(([name, child]) => {
  if (typeof child === "string") return { name, mode: "100644", hash: child, type: "blob" };
  return { name, mode: "40000", hash: treeHashFor(child), type: "tree" };
 });
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
  for (const part of parts.slice(0, -1)) {
   node[part] = node[part] || {};
   node = node[part];
  }
  node[parts[parts.length - 1]] = internBlob(text);
 }
 return treeHashFor(root);
}

function commit(hash, treeHash, authoredAt = 0) {
 const identity = { name: "fixture", email: "fixture@test" };
 return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt, committedAt: authoredAt };
}

function defineRepo(name, { history, refs, intents = {} }) {
 repos.set(name, { history, refs, intents });
}

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
  async readTree(hash) {
   return treeEntries.get(hash) ?? null;
  },
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
  async readBlob(hash) {
   return blobText.has(hash) ? new Blob([blobText.get(hash)]) : null;
  },
  async info() {
   return { remote: `https://artifacts.invalid/nextgit/${name}` };
  },
  async revokeToken() {
   return true;
  },
  [Symbol.dispose]() { },
 };
}

// The discovered fork set — the discovery seam's source. Fresh per
// environment so mutation probes cannot alias across cases.
const LISTED = [];
function listFor(entries) {
 LISTED.length = 0;
 for (const e of entries) LISTED.push(e);
}
const READY = (name) => ({ name, status: "ready", defaultBranch: "main" });

function makeArtifacts() {
 return {
  async get(name) {
   READS.get++;
   return repoFor(name);
  },
  async list() {
   READS.list++;
   return { repos: LISTED.slice() };
  },
 };
}

// ---------------------------------------------------------------------------
// Fixture repos — the fork-signals.test.mjs shape, trimmed to the
// discovery/lineage/ordering cases this route must serve.
// ---------------------------------------------------------------------------
const SECRET_VALUE = "forks_route_fixture_secret_6b1e77a2";
const SECRET_ENV_TEXT = `# demo env\nAPI_TOKEN=${SECRET_VALUE}\nDB_PASSWORD=also_${SECRET_VALUE}\n`;

const A0 = "export const a = 1;\nexport const keep = true;\n";
const A1 = "export const a = 2;\nexport const keep = true;\n";
const B0 = "export const b = 1;\n";
const BASE_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": SECRET_ENV_TEXT };

// The static base — history stops at the fork point.
const c1 = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

// Fork A — near-total fit: one-file change-set, no conflict.
const fit = commit("c-agent-fit", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-fit", { history: [fit, c1], refs: { main: fit.hash }, intents: { [fit.hash]: "Bump src/a.ts for the demo." } });

// Fork B — low fit: a 40-file change-set, no shared intent.
const NONALIGNED_FILES = {};
for (let i = 1; i <= 40; i++) {
 NONALIGNED_FILES[`src/other-${String(i).padStart(2, "0")}.ts`] = `export const other${i} = ${i};\n`;
}
const nonaligned = commit("c-agent-nonaligned", tree({ ...BASE_FILES, ...NONALIGNED_FILES }));
defineRepo("agent-nonaligned", { history: [nonaligned, c1], refs: { main: nonaligned.hash }, intents: { [nonaligned.hash]: "A whole different feature." } });

// Secret-class-only fork — the ONLY change is a secret-class file.
const secret = commit("c-agent-secret", tree({ ...BASE_FILES, "config/.env": `# demo env v2\nAPI_TOKEN=rotated_${SECRET_VALUE}\n` }));
defineRepo("agent-secret", { history: [secret, c1], refs: { main: secret.hash }, intents: { [secret.hash]: "Rotate the env keys." } });

// Non-candidate fixtures: a non-agent repo and a non-ready agent fork.
defineRepo("demo-2", { history: [c1], refs: { main: c1.hash } });
defineRepo("agent-pending", { history: [c1], refs: { main: c1.hash } });

// ---------------------------------------------------------------------------
// Fake KV (CACHE): the fork-lineage seam + the compute caches.
// ---------------------------------------------------------------------------
function makeFakeKV() {
 const store = new Map();
 return {
  async get(key) {
   return store.get(key) ?? null;
  },
  async put(key, value) {
   store.set(key, value);
  },
  _store: store,
 };
}

function makeEnv({ artifacts = null, cache = null, authMode = "demo" } = {}) {
 const CACHE = cache ?? makeFakeKV();
 return {
  ARTIFACTS: artifacts ?? makeArtifacts(),
  LIVE: {},
  CACHE,
  ASSETS: { fetch: async () => new Response("") },
  AI: undefined,
  AUTH_MODE: authMode,
 };
}

/** An env whose CACHE carries the recorded lineage for `agent-fit`. */
function makeLineageEnv() {
 const cache = makeFakeKV();
 cache._store.set("fork:agent-fit", JSON.stringify({ repo: "demo", forkPoint: "c-base" }));
 return makeEnv({ cache });
}

// The full discovery roster the route must filter.
listFor([
 READY("agent-fit"),
 READY("agent-nonaligned"),
 READY("agent-secret"),
 { name: "demo-2", status: "ready", defaultBranch: "main" },
 { name: "agent-pending", status: "importing", defaultBranch: "main" },
]);

// ---------------------------------------------------------------------------
// Request helper — GET /forks through the real dispatcher.
// ---------------------------------------------------------------------------
const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

let ipSeq = 0;
const nextIp = () => `10.11.0.${++ipSeq}`;

async function getForks({ base, ip = nextIp(), env = makeEnv() } = {}) {
 const suffix = base === undefined ? "" : `?base=${encodeURIComponent(base)}`;
 const res = await worker.fetch(
  new Request(`https://forks.test/forks${suffix}`, { headers: { "CF-Connecting-IP": ip } }),
  env,
 );
 return readJson(res);
}

const SIX = ["fitOverlap", "peopleTrust", "liveness", "proof", "distance", "costToAdoptVsRegenerate"];
const byRepo = (body, repo) => (body?.forks ?? []).find((f) => f.repo === repo) ?? null;

// ---------------------------------------------------------------------------
// 1. Typed shape: 200 {ok,base,forks}; each fork {repo,signals,upstream};
//    six clusters, number|null, finite in [0,1].
// ---------------------------------------------------------------------------
try {
 READS.list = 0;
 READS.get = 0;
 const { status, body } = await getForks({ base: "demo", env: makeEnv() });
 check("1 status 200", status === 200, `got ${status} ${J(body)}`);
 check("1 envelope keys exact {ok,base,forks}", J(Object.keys(body ?? {}).sort()) === J(["base", "forks", "ok"]), J(body && Object.keys(body)));
 check("1 ok:true", body?.ok === true);
 check("1 base echoes the queried base", body?.base === "demo", J(body?.base));
 check("1 forks is a non-empty array", Array.isArray(body?.forks) && body.forks.length > 0, J(body?.forks?.length));
 for (const fork of body?.forks ?? []) {
  check(`1 ${fork.repo}: fork keys exact {repo,signals,upstream}`, J(Object.keys(fork).sort()) === J(["repo", "signals", "upstream"]), J(Object.keys(fork)));
  const six = SIX.every((k) => k in (fork.signals ?? {}));
  check(`1 ${fork.repo}: signals carries exactly the six clusters`, six && Object.keys(fork.signals).length === 6, J(Object.keys(fork.signals ?? {})));
  const typed = SIX.every((k) => fork.signals[k] === null || (typeof fork.signals[k] === "number" && Number.isFinite(fork.signals[k])));
  check(`1 ${fork.repo}: every cluster is number|null (never prose)`, typed, J(fork.signals));
  const ranged = SIX.every((k) => fork.signals[k] === null || (fork.signals[k] >= 0 && fork.signals[k] <= 1));
  check(`1 ${fork.repo}: finite numbers in [0,1]`, ranged, J(fork.signals));
 }
} catch (e) {
 check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. Discovery: only agent-* ready repos are candidates — the non-agent
//    repo (demo-2) and the non-ready fork (agent-pending) never appear.
// ---------------------------------------------------------------------------
try {
 const { body } = await getForks({ base: "demo", env: makeEnv() });
 const names = (body?.forks ?? []).map((f) => f.repo).sort();
 check("2 only agent-* ready forks appear", J(names) === J(["agent-fit", "agent-nonaligned", "agent-secret"]), J(names));
 check("2 non-agent repo excluded", byRepo(body, "demo-2") === null);
 check("2 non-ready agent fork excluded", byRepo(body, "agent-pending") === null);
} catch (e) {
 check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. Lineage: a recorded fork:<name> serves upstream {repo,forkPoint};
//    an unrecorded fork serves upstream null.
// ---------------------------------------------------------------------------
try {
 const { body } = await getForks({ base: "demo", env: makeLineageEnv() });
 const recorded = byRepo(body, "agent-fit");
 check("3 recorded lineage served as upstream {repo,forkPoint}", J(recorded?.upstream) === J({ repo: "demo", forkPoint: "c-base" }), J(recorded?.upstream));
 const unrecorded = byRepo(body, "agent-nonaligned");
 check("3 unrecorded lineage serves upstream null", unrecorded !== null && unrecorded.upstream === null, J(unrecorded?.upstream));
} catch (e) {
 check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. Ordering: strongest-first by rankSignals — the near-total-fit fork
//    outranks the low-fit one (the same ordering /intents serves).
// ---------------------------------------------------------------------------
try {
 const { body } = await getForks({ base: "demo", env: makeEnv() });
 const names = (body?.forks ?? []).map((f) => f.repo);
 const fitIdx = names.indexOf("agent-fit");
 const nonalignedIdx = names.indexOf("agent-nonaligned");
 check("4 both ordering fixtures present", fitIdx !== -1 && nonalignedIdx !== -1, J(names));
 check("4 high-fit fork ranks ahead of the low-fit fork", fitIdx !== -1 && nonalignedIdx !== -1 && fitIdx < nonalignedIdx, J(names));
} catch (e) {
 check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. Allowlist: a non-demo base is 403 repo-not-allowed, and the refusal
//    happens before any ARTIFACTS read (a throwing fake never fires).
// ---------------------------------------------------------------------------
try {
 let calls = 0;
 const throwing = {
  async get() { calls++; throw new Error("ARTIFACTS.get reached on a denied scope"); },
  async list() { calls++; throw new Error("ARTIFACTS.list reached on a denied scope"); },
 };
 const { status, body } = await getForks({ base: "notdemo-xyz", env: makeEnv({ artifacts: throwing }) });
 check("5 non-demo base is 403", status === 403, `got ${status} ${J(body)}`);
 check("5 refusal is repo-not-allowed", body?.ok === false && body?.error === "repo-not-allowed", J(body));
 check("5 zero ARTIFACTS reads on the denied scope", calls === 0, `calls=${calls}`);
} catch (e) {
 check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Bad input: a charset-invalid base is 400 before any repo read.
// ---------------------------------------------------------------------------
try {
 for (const bad of ["demo;evil", "no/slash", "sp ace", "demo%00evil"]) {
  READS.list = 0;
  READS.get = 0;
  const { status, body } = await getForks({ base: bad, env: makeEnv() });
  check(`6 ?base=${J(bad)} is 400`, status === 400 && body?.ok === false, `got ${status} ${J(body)}`);
  check(`6 ?base=${J(bad)} reads no ARTIFACTS`, READS.list === 0 && READS.get === 0, `list=${READS.list} get=${READS.get}`);
 }
} catch (e) {
 check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7. Rate: 60/60s per caller — the 61st in-window call is 429.
//    Cheap roster (no candidates) so the window is filled without compute.
// ---------------------------------------------------------------------------
try {
 listFor([]);
 const ip = "10.42.0.1";
 let last = null;
 for (let i = 0; i < 61; i++) last = await getForks({ base: "demo", ip, env: makeEnv() });
 check("7 the 61st in-window call is 429", last?.status === 429 && last?.body?.error === "rate-limited", `got ${last?.status} ${J(last?.body)}`);
 listFor([
  READY("agent-fit"),
  READY("agent-nonaligned"),
  READY("agent-secret"),
  { name: "demo-2", status: "ready", defaultBranch: "main" },
  { name: "agent-pending", status: "importing", defaultBranch: "main" },
 ]);
} catch (e) {
 check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. Secret law (AD-4): a secret-class-only fork appears, but no
//    fixture secret value reaches the serialized body.
// ---------------------------------------------------------------------------
try {
 const { status, body } = await getForks({ base: "demo", env: makeEnv() });
 check("8 status 200", status === 200, `got ${status}`);
 check("8 secret-class fork is discovered", byRepo(body, "agent-secret") !== null, J((body?.forks ?? []).map((f) => f.repo)));
 check("8 no secret value in the serialized body", !J(body).includes(SECRET_VALUE));
} catch (e) {
 check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. One computation, no parallel path: the route's signals for a fork
//    deep-equal a direct computeSixClusterSignals call on the same state.
// ---------------------------------------------------------------------------
try {
 const { body } = await getForks({ base: "demo", env: makeEnv() });
 const routed = byRepo(body, "agent-fit");
 const direct = await computeSixClusterSignals(makeEnv(), "demo", "main", "agent-fit");
 check("9 route signals deep-equal the direct computation", routed !== null && J(routed.signals) === J(direct), `${J(routed?.signals)} vs ${J(direct)}`);
} catch (e) {
 check("9 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 10. Default base: an omitted ?base resolves to the pinned default "demo".
// ---------------------------------------------------------------------------
try {
 const { status, body } = await getForks({ env: makeEnv() });
 check("10 omitted base defaults to demo", status === 200 && body?.base === "demo", `got ${status} ${J(body?.base)}`);
} catch (e) {
 check("10 case threw", false, String(e?.stack ?? e));
}

console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
