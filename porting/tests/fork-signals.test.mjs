#!/usr/bin/env bun
// Contract suite: the six-cluster fork-signals computation
// (CAP-10) — platform/src/fork-signals.ts, the single
// computation surface POST /intents (and wave-11's GET /forks)
// consume.
// Run: bun porting/tests/fork-signals.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` and the real
// `computeSixClusterSignals` and drives worker.fetch() with
// the in-memory Artifacts fake (the intents-matcher.test.mjs
// harness; fresh env per case, no network, no Chrome). The
// computation is exercised through the real worker's read
// seams (computeChangeSet / computeMerge / the fork repo's
// log) — no mock.module, no source grep.
//
// Groups (each defends an observable contract):
//   1. Typed shape — six keys, number|null, finite, in [0,1]
//   2. Acceptance pair — near-total fit → merge-it; aligned-none → ignore
//   3. Flip property — flipping ONLY A's fit/distance inputs flips the verdict
//   4. No auto-select — an extreme single signal never yields merge-it
//   5. peopleTrust is null by contract (typed-null law)
//   6. Distance reuses classifyPair — concurrent edit → text-conflict distance
//   7. One computation — route and direct call deep-equal
//   8. Secret-class fork — no secret value in any signal (AD-4)
//   9. Advisory-only — zero KV writes (the computation is pure)

import worker, { ROUTES } from "../../platform/src/index.ts";
import { computeSixClusterSignals } from "../../platform/src/fork-signals.ts";

let fails = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else {
    fails++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
};
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (intents-matcher.test.mjs shape) — the bounded
// `list()` the /intents discovery seam reads (agent-* + status ready).
// ---------------------------------------------------------------------------

const blobText = new Map(); // hash -> text
const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
const treeEntries = new Map(); // tree hash -> entries
const repos = new Map(); // name -> { history, refs, intents }

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

// The discovered fork set — the /intents discovery seam's source.
// Fresh per environment (makeArtifacts) so mutation probes cannot
// alias across cases.
const LISTED = [];

function makeArtifacts() {
  return {
    async get(name) {
      return repoFor(name);
    },
    async list() {
      return { repos: LISTED.slice() };
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture repos — the intents-matcher.test.mjs shape, extended with the
// fork-signals fixtures: a MOVED base (concurrent modification), a grown
// change-set (past the patch budget), and a fresh hot fork (extreme
// liveness).
// ---------------------------------------------------------------------------

const SECRET_VALUE = "fork_signals_fixture_secret_3f8a11c0";
const SECRET_ENV_TEXT = `# demo env\nAPI_TOKEN=${SECRET_VALUE}\nDB_PASSWORD=also_${SECRET_VALUE}\n`;

const A0 = "export const a = 1;\nexport const keep = true;\n";
// Fit fork's clean change (line 1) — against the STATIC base no pair
// exists (the base never moved), so the fold is clean.
const A1 = "export const a = 2;\nexport const keep = true;\n";
// Concurrent modification: the MOVED base changed line 1 one way…
const A_BASE = "export const a = 10;\nexport const keep = true;\n";
// …and the concurrent fork changed the SAME line another way — the
// exact pair classifyPair classifies text-conflict.
const A_FORK = "export const a = 20;\nexport const keep = true;\n";
const B0 = "export const b = 1;\n";
const B1 = "export const b = 2;\nexport const extra = 42;\n";

// Non-aligned fork: a LARGE change-set (many files) — low overlap.
const NONALIGNED_FILES = {};
for (let i = 1; i <= 40; i++) {
  NONALIGNED_FILES[`src/other-${String(i).padStart(2, "0")}.ts`] = `export const other${i} = ${i};\n`;
}
// Grown fork: the patch budget (MAX_FILES_WITH_PATCH = 50) plus one —
// fitOverlap falls to 0 (the fit-input flip).
const GROWN_FILES = {};
for (let i = 1; i <= 50; i++) {
  GROWN_FILES[`src/grown-${String(i).padStart(2, "0")}.ts`] = `export const grown${i} = ${i};\n`;
}

const BASE_FILES = { "src/a.ts": A0, "src/b.ts": B0, "config/.env": SECRET_ENV_TEXT };

// The static base — history stops at the fork point.
const c1 = commit("c-base", tree(BASE_FILES));
defineRepo("demo", { history: [c1], refs: { main: c1.hash } });

// The MOVED base — the fork point is still c1 (the shared commit),
// but the base head moved on, editing src/a.ts line 1.
const c2 = commit("c-base-moved", tree({ ...BASE_FILES, "src/a.ts": A_BASE }));
defineRepo("demo-moved", { history: [c2, c1], refs: { main: c2.hash } });

// Fork A — near-total fit: one-file change-set, no conflict.
const INTENT_FIT = "Bump src/a.ts for the demo.";
const f1 = commit("c-agent-fit", tree({ ...BASE_FILES, "src/a.ts": A1 }));
defineRepo("agent-fit", { history: [f1, c1], refs: { main: f1.hash }, intents: { [f1.hash]: INTENT_FIT } });

// Fork A grown — the SAME fork with its change-set past the patch
// budget (51 files): only the fit input changed.
const f2 = commit("c-agent-grown", tree({ ...BASE_FILES, "src/a.ts": A1, ...GROWN_FILES }));
defineRepo("agent-grown", { history: [f2, c1], refs: { main: f2.hash }, intents: { [f2.hash]: INTENT_FIT } });

// Fork A concurrent — the SAME one-file change-set, but the file is
// the one the MOVED base also edited: only the distance input
// changed (the pair classifies text-conflict via classifyPair).
const f3 = commit("c-agent-concurrent", tree({ ...BASE_FILES, "src/a.ts": A_FORK }));
defineRepo("agent-concurrent", { history: [f3, c1], refs: { main: f3.hash }, intents: { [f3.hash]: INTENT_FIT } });

// Fork B — aligned-none: a 40-file change-set, no shared intent.
const f4 = commit("c-agent-nonaligned", tree({ ...BASE_FILES, ...NONALIGNED_FILES }));
defineRepo("agent-nonaligned", { history: [f4, c1], refs: { main: f4.hash }, intents: { [f4.hash]: "A whole different feature." } });

// Partial fork — a moderate change-set against the base.
const PARTIAL_FILES = { ...BASE_FILES, "src/b.ts": B1 };
for (let i = 1; i <= 23; i++) {
  PARTIAL_FILES[`src/part-${String(i).padStart(2, "0")}.ts`] = `export const part${i} = ${i};\n`;
}
const f5 = commit("c-agent-partial", tree(PARTIAL_FILES));
defineRepo("agent-partial", { history: [f5, c1], refs: { main: f5.hash }, intents: { [f5.hash]: "Extend the b module." } });

// Hot fork — a fresh commit (liveness ≈ 1) on a 51-file change-set
// with a concurrent text-conflict: every extreme signal at once,
// still never merge-it (the aggregate rule is the only path).
const HOT_FILES = { ...BASE_FILES, "src/a.ts": A_FORK, ...GROWN_FILES };
const f6 = commit("c-agent-hot", tree(HOT_FILES), Date.now() / 1000);
defineRepo("agent-hot", { history: [f6, c1], refs: { main: f6.hash }, intents: { [f6.hash]: "Hot fork." } });

// Secret-class fork: the ONLY change is a secret-class file. Its
// signals must derive from key names only; no secret value may
// appear in any signal.
const fSecret = commit("c-agent-secret", tree({ ...BASE_FILES, "config/.env": `# demo env v2\nAPI_TOKEN=rotated_${SECRET_VALUE}\n` }));
defineRepo("agent-secret", { history: [fSecret, c1], refs: { main: fSecret.hash }, intents: { [fSecret.hash]: "Rotate the env keys." } });

// Add-only clean fork: adds a brand-new file, touches nothing
// else. A clean single-sided add folds without conflict —
// distance must be 0, never a fabricated add/add severity-4.
const fAdd = commit("c-agent-add", tree({ ...BASE_FILES, "src/new-file.ts": "export const fresh = 1;\n" }));
defineRepo("agent-add", { history: [fAdd, c1], refs: { main: fAdd.hash }, intents: { [fAdd.hash]: INTENT_FIT } });

// Remove-only clean fork: removes src/b.ts, touches nothing
// else. A clean single-sided remove folds without conflict —
// distance must be 0, never a fabricated modify/delete severity-4.
const fRem = commit("c-agent-remove", tree({ "src/a.ts": A0, "config/.env": SECRET_ENV_TEXT }));
defineRepo("agent-remove", { history: [fRem, c1], refs: { main: fRem.hash }, intents: { [fRem.hash]: INTENT_FIT } });

// ---------------------------------------------------------------------------
// Fake KV (CACHE — the advisory-only write probe) + env factory.
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
    AI: undefined, // the matcher is code-derived — no AI binding needed
    AUTH_MODE: authMode,
  };
}

// ---------------------------------------------------------------------------
// Request helpers. Each call uses a fresh env (fresh rate window,
// fresh KV probe) unless a caller passes one explicitly.
// ---------------------------------------------------------------------------

const readJson = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

let ipSeq = 0;
const nextIp = () => `10.9.0.${++ipSeq}`;

async function postIntents(body, { ip = nextIp(), env = makeEnv(), cookies = false, csrf = null } = {}) {
  const headers = { "content-type": "application/json", "CF-Connecting-IP": ip };
  if (cookies) headers["Cookie"] = "session=fixture";
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await worker.fetch(
    new Request("https://intents.test/intents", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : J(body),
    }),
    env,
  );
  return readJson(res);
}

// Discovery roster per case — fresh LISTED content.
function listFor(entries) {
  LISTED.length = 0;
  for (const e of entries) LISTED.push(e);
}

const READY = (name) => ({ name, status: "ready", defaultBranch: "main" });

const SIX = ["fitOverlap", "peopleTrust", "liveness", "proof", "distance", "costToAdoptVsRegenerate"];

// A direct computation — the module seam the route consumes.
const directSignals = (base, name) => computeSixClusterSignals(makeEnv(), base, "main", name);

// ---------------------------------------------------------------------------
// 1. Typed shape: every cluster is number | null, all six keys
//    present, finite numbers in [0,1] — on the fit/partial/
//    nonaligned fixtures.
// ---------------------------------------------------------------------------
try {
  for (const [base, name] of [["demo", "agent-fit"], ["demo", "agent-partial"], ["demo", "agent-nonaligned"]]) {
    const signals = await directSignals(base, name);
    check(`1a ${name}: all six keys present`,
      SIX.every((k) => k in signals), J(Object.keys(signals)));
    const typed = SIX.every((k) =>
      signals[k] === null || (typeof signals[k] === "number" && Number.isFinite(signals[k])));
    check(`1b ${name}: every cluster is number|null (never prose)`, typed, J(signals));
    const ranged = SIX.every((k) => signals[k] === null || (signals[k] >= 0 && signals[k] <= 1));
    check(`1c ${name}: finite numbers in [0,1]`, ranged, J(signals));
  }
} catch (e) {
  check("1 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 2. Acceptance fixture pair (the order's named case): fork A
//    (near-total fit: one-file change-set, no conflict) →
//    merge-it with fitOverlap >= 0.6; fork B (aligned-none:
//    40-file change-set) alone → ignore with fitOverlap < 0.3.
// ---------------------------------------------------------------------------
try {
  listFor([READY("agent-fit")]);
  const fit = await postIntents({ intent: INTENT_FIT });
  check("2a fork A (near-total fit) → verdict merge-it", fit.body?.verdict === "merge-it", `verdict ${fit.body?.verdict}`);
  const fitCand = fit.body?.candidates?.find((c) => c.repo === "agent-fit");
  check("2b fork A's candidate carries fitOverlap >= 0.6",
    fitCand && fitCand.signals?.fitOverlap !== null && fitCand.signals.fitOverlap >= 0.6,
    J(fitCand?.signals));

  listFor([READY("agent-nonaligned")]);
  const non = await postIntents({ intent: "Start a wholly different feature." });
  check("2c fork B (aligned-none) alone → verdict ignore", non.body?.verdict === "ignore", `verdict ${non.body?.verdict}`);
  const nonCand = non.body?.candidates?.find((c) => c.repo === "agent-nonaligned");
  check("2d fork B's candidate carries fitOverlap < 0.3",
    nonCand && nonCand.signals?.fitOverlap !== null && nonCand.signals.fitOverlap < 0.3,
    J(nonCand?.signals));
} catch (e) {
  check("2 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 3. The flip property (the order's core acceptance): with A the
//    sole candidate the verdict is merge-it; mutate ONLY A's
//    fit/distance inputs — the change-set grows past the patch
//    budget, or the file pair classifies text-conflict — and the
//    verdict flips with no other input changed. Proves the verdict
//    is a function of the signals object.
// ---------------------------------------------------------------------------
try {
  // Baseline: A alone → merge-it.
  listFor([READY("agent-fit")]);
  const base0 = await postIntents({ intent: INTENT_FIT });
  check("3a baseline: A the sole candidate → merge-it", base0.body?.verdict === "merge-it", `verdict ${base0.body?.verdict}`);

  // Flip 1 (fit input): the SAME fork, change-set grown past the
  // patch budget — fitOverlap collapses, verdict flips to ignore.
  listFor([READY("agent-grown")]);
  const grown = await postIntents({ intent: INTENT_FIT });
  check("3b grown change-set (ONLY the fit input changed) → verdict flips off merge-it",
    grown.body?.verdict !== "merge-it", `verdict ${grown.body?.verdict}`);
  check("3c grown change-set → ignore (fitOverlap < 0.3)",
    grown.body?.verdict === "ignore", `verdict ${grown.body?.verdict}`);
  const grownCand = grown.body?.candidates?.find((c) => c.repo === "agent-grown");
  check("3d grown change-set → fitOverlap < 0.3",
    grownCand && grownCand.signals?.fitOverlap !== null && grownCand.signals.fitOverlap < 0.3,
    J(grownCand?.signals));

  // Flip 2 (distance input): the SAME one-file change-set, but the
  // file is the one the MOVED base also edited — the pair
  // classifies text-conflict, distance rises, verdict flips to
  // use-as-context while fitOverlap stays high.
  listFor([READY("agent-concurrent")]);
  const conc = await postIntents({ intent: INTENT_FIT, base: "demo-moved" });
  check("3e concurrent edit (ONLY the distance input changed) → verdict flips off merge-it",
    conc.body?.verdict !== "merge-it", `verdict ${conc.body?.verdict}`);
  check("3f concurrent edit → use-as-context (fit still high, distance rose)",
    conc.body?.verdict === "use-as-context", `verdict ${conc.body?.verdict}`);
  const concCand = conc.body?.candidates?.find((c) => c.repo === "agent-concurrent");
  check("3g concurrent edit → distance >= 0.5 with fitOverlap >= 0.6",
    concCand && concCand.signals?.distance !== null && concCand.signals.distance >= 0.5
    && concCand.signals?.fitOverlap !== null && concCand.signals.fitOverlap >= 0.6,
    J(concCand?.signals));
} catch (e) {
  check("3 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 4. No auto-select: a candidate with a single extreme signal
//    (liveness ≈ 1 but fitOverlap ≈ 0, distance ≈ 1) never
//    yields merge-it — the aggregate rule is the only path to
//    merge-it (pins deriveMatcherVerdict's non-singleton property).
// ---------------------------------------------------------------------------
try {
  listFor([READY("agent-hot")]);
  const hot = await postIntents({ intent: "Hot fork.", base: "demo-moved" });
  const hotCand = hot.body?.candidates?.find((c) => c.repo === "agent-hot");
  check("4a hot fork carries an extreme liveness (≈1)",
    hotCand && hotCand.signals?.liveness !== null && hotCand.signals.liveness > 0.9,
    J(hotCand?.signals));
  check("4b hot fork carries fitOverlap ≈ 0 and distance ≈ 1",
    hotCand && hotCand.signals?.fitOverlap !== null && hotCand.signals.fitOverlap < 0.3
    && hotCand.signals?.distance !== null && hotCand.signals.distance > 0.5,
    J(hotCand?.signals));
  check("4c extreme single signal never yields merge-it",
    hot.body?.verdict !== "merge-it", `verdict ${hot.body?.verdict}`);
  check("4d the aggregate rule ignores it (verdict ignore)",
    hot.body?.verdict === "ignore", `verdict ${hot.body?.verdict}`);
} catch (e) {
  check("4 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 5. peopleTrust is null by contract (typed-null law; the wave-10
//    carry pins): unmeasured is null, never a fabricated 0.
// ---------------------------------------------------------------------------
try {
  const signals = await directSignals("demo", "agent-fit");
  check("5 peopleTrust is strictly null (typed-null law)",
    signals.peopleTrust === null, J(signals.peopleTrust));
} catch (e) {
  check("5 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6. Distance reuses classifyPair: a fixture whose fork edits the
//    same file the base also edited (concurrent modification)
//    produces a text-conflict-derived distance >= 0.5 — observable
//    through the typed signal, proving the conflict-kind surface
//    feeds distance (the structural fix over the inline aggregate).
//    Control: the same fork against the STATIC base (no concurrent
//    edit) keeps distance 0 — the distance comes from the pair.
// ---------------------------------------------------------------------------
try {
  const moved = await directSignals("demo-moved", "agent-concurrent");
  check("6a concurrent modification → text-conflict-derived distance >= 0.5",
    moved.distance !== null && moved.distance >= 0.5, J(moved));
  const static_ = await directSignals("demo", "agent-concurrent");
  check("6b control: same fork, static base (no pair) → no conflict surface",
    static_.distance === 0 || static_.distance < 0.5, J(static_));
  check("6c the conflict-kind distance strictly exceeds the fold-share baseline",
    moved.distance > static_.distance, `${moved.distance} vs ${static_.distance}`);
} catch (e) {
  check("6 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 6b. Single-sided change-sets keep clean distance semantics: a
//     clean add-only or remove-only fork folds without conflict
//     (distance 0, merge-it eligible), never a fabricated
//     severity-4 add/add or modify/delete. Pins the flip property
//     for the shapes group 6 does not exercise.
// ---------------------------------------------------------------------------
try {
  const addOnly = await directSignals("demo", "agent-add");
  check("6b-i add-only clean fork → distance 0 (no phantom add/add)",
    addOnly.distance === 0, J(addOnly));
  check("6b-ii add-only clean fork stays merge-it eligible (fit high, distance 0)",
    addOnly.fitOverlap !== null && addOnly.fitOverlap >= 0.6 && addOnly.distance <= 0.4, J(addOnly));
  const remOnly = await directSignals("demo", "agent-remove");
  check("6b-iii remove-only clean fork → distance 0 (no phantom modify/delete)",
    remOnly.distance === 0, J(remOnly));
  check("6b-iv remove-only clean fork stays merge-it eligible",
    remOnly.fitOverlap !== null && remOnly.fitOverlap >= 0.6 && remOnly.distance <= 0.4, J(remOnly));
  // The concurrent fixture must STILL classify text-conflict through
  // the typed surface (the wave-10 carry, now genuinely load-bearing).
  const conc = await directSignals("demo-moved", "agent-concurrent");
  check("6b-v concurrent edit → text-conflict-derived distance >= 0.5",
    conc.distance !== null && conc.distance >= 0.5, J(conc));
} catch (e) {
  check("6b case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 7. One computation, no parallel path: POST /intents and a direct
//    computeSixClusterSignals call on the same fixture produce
//    deep-equal signals objects — the route consumes exactly the
//    module's object.
// ---------------------------------------------------------------------------
try {
  listFor([READY("agent-fit")]);
  const viaRoute = await postIntents({ intent: INTENT_FIT });
  const routeCand = viaRoute.body?.candidates?.find((c) => c.repo === "agent-fit");
  const direct = await directSignals("demo", "agent-fit");
  check("7 route signals deep-equal the module's computeSixClusterSignals output",
    J(routeCand?.signals) === J(direct), `${J(routeCand?.signals)} vs ${J(direct)}`);
} catch (e) {
  check("7 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 8. Secret-class fork (AD-4): the signals derive from key names
//    only — no secret-class value in any signal (carried from
//    intents-matcher case 8).
// ---------------------------------------------------------------------------
try {
  const signals = await directSignals("demo", "agent-secret");
  const serialized = J(signals);
  check("8a secret-class fork yields typed signals",
    SIX.every((k) => k in signals), serialized);
  check("8b no secret VALUE in any signal",
    !serialized.includes(SECRET_VALUE) && !serialized.includes("rotated_"),
    "secret value leaked into signals");
} catch (e) {
  check("8 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
// 9. Advisory-only: the computation writes nothing (the Tampering
//    law — pure over repo state; zero-mutation probe on the CACHE
//    fake, across both the route and the direct seam).
// ---------------------------------------------------------------------------
try {
  const cache = makeFakeKV();
  const env = makeEnv({ cache });
  listFor([READY("agent-fit")]);
  const headers = { "content-type": "application/json", "CF-Connecting-IP": nextIp() };
  await worker.fetch(
    new Request("https://intents.test/intents", {
      method: "POST",
      headers,
      body: J({ intent: INTENT_FIT }),
    }),
    env,
  );
  await computeSixClusterSignals(env, "demo", "main", "agent-fit");
  await computeSixClusterSignals(env, "demo-moved", "main", "agent-concurrent");
  check("9 advisory-only: zero KV writes across route + direct computation",
    cache._store.size === 0, `wrote ${Array.from(cache._store.keys()).join(",")}`);
} catch (e) {
  check("9 case threw", false, String(e?.stack ?? e));
}

// ---------------------------------------------------------------------------
console.log(fails === 0 ? `ALL PASS (${pass} checks)` : `${fails} FAILURES (${pass} passed)`);
process.exit(fails === 0 ? 0 : 1);
