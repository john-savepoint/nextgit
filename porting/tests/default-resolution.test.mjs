#!/usr/bin/env bun
// Contract suite: FR-42 / NFR-11 — base/ref/baseRef default resolution
// is pinned to demo/main on every route.
// Run: bun porting/tests/default-resolution.test.mjs   (exit 0 = pass)
//
// Real construction: every route is exercised through the REAL worker
// module (worker.fetch) against an in-memory Artifacts fake — the platform
// binding seam is the only fake (pattern per merge-fold-api.test.mjs /
// judge.test.mjs / param-validation.test.mjs); no module mocks, no
// mock.module, no source grep. The fixture constructs the demo base +
// agent-1..agent-5 so each default-resolved read computes a real
// change-set / fold / proposal set, and the /land refusal path is driven
// to a real 409 stale against the fixture's current heads.
//
// What this pins (the FR-42/NFR-11 defaults-pinned law, previously
// implemented but unpinned behaviorally — param-validation.test.mjs only
// covers the 400 rejection path; proposals-cache-key.test.mjs case 9 only
// asserts status !== 400; judge.test.mjs case 1 passes base:"demo"
// explicitly, never omitting it; the GET empty-param 400 was unpinned,
// per case 9):
//
//   1. GET /changes?repo=agent-5   (base/ref/baseRef OMITTED)
//      -> changeSet.base.repo=="demo", .base.ref=="main" (baseRef default
//         follows ref default), .head.repo=="agent-5", .head.ref=="main".
//   2. GET /merge?repos=agent-1    (omitted) -> merge.base.repo=="demo",
//      merge.base.ref=="main".
//   3. GET /proposals?repos=agent-1 (omitted, explicit subset so no
//      auto-discover) -> base.repo=="demo", base.ref=="main", base.head is
//      the 40-hex base head (read at the RESOLVED baseRef via repoHead).
//   4. POST /judge {setId:"v1",target:{repos:["agent-1"]}} (base/refs
//      OMITTED) -> model=="@cf/cloudflare/clef" (pinned), ok==true, one
//      judgment for agent-1, and the fake AI.run was called with
//      PINNED_MODEL_ID — proving parseJudgeBody resolved base->demo and
//      refs->[main] and the route consumed them.
//   5. POST /land {repos:["agent-1"],reviewed:{baseHead:<STALE>}} (base/
//      baseRef/ref OMITTED, stale baseHead) -> 409 {ok:false,error:"stale"};
//      base head byte-identical before/after (the default path never
//      silently lands — a refusal must not have pushed).
//   6. Negative control: GET /changes?repo=agent-5&base=demo&ref=main
//      &baseRef=main (all EXPLICIT) returns the SAME base/head identity as
//      case 1 — omitted == explicit, so the defaults ARE demo/main, not
//      merely some valid value.
//   7. baseRef-follows-ref coupling: GET /changes?repo=agent-5&ref=dev
//      (base+baseRef omitted; `dev` a second fixture branch) ->
//      .base.ref=="dev", .head.ref=="dev" — pins the
//      baseRef=get("baseRef",ref) chain, not just a hardcoded "main".
//   9. GET empty-param 400: GET /changes?repo=agent-5&base=&ref=
//      &baseRef= -> 400 "invalid base repo: \"\"" (the GET parser
//      passes a PRESENT "" through raw; only ABSENCE defaults).
//
// Full-suite safety: a fresh env (distinct fake Artifacts + fresh AI call
// log) per case; /land makes exactly ONE refused POST; /judge makes
// exactly ONE call. process.exit(fail===0?0:1); "ALL PASS (N checks)".

import worker, { DEFAULT_BASE_REPO, DEFAULT_REF, resolveRouteBase } from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const J = (x) => JSON.stringify(x);

// Deterministic 40-hex commit hash for a label (the fake's commits
// must carry real sha-shaped ids: /proposals publishes base.head and
// /land compares reviewed.baseHead against repoHead, both 40-hex).
function hex40(label) {
  let out = "";
  for (let i = 0; out.length < 40; i++) {
    const s = `${label}:${i}`;
    let x = 0x811c9dc5;
    for (let c = 0; c < s.length; c++) {
      x ^= s.charCodeAt(c);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    out += x.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake — one instance per environment (a factory, so
// environments cannot alias). Mirrors the surface the routes read:
// get/log/readTree/readFile/readBlob/info/revokeToken/Symbol.dispose/list.
// (Identical pattern to makeFakeArtifacts in merge-fold-api.test.mjs.)
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed, shared)
  const treeEntries = new Map(); // tree hash -> entries
  const repos = new Map(); // name -> { history, refs, intents }
  const discovered = []; // [{ name, status }] — the list() surface

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

  function commit(hash, treeHash) {
    const identity = { name: "fixture", email: "fixture@test" };
    return { hash, treeHash, message: hash, author: identity, committer: identity, parents: [], authoredAt: 0, committedAt: 0 };
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

  return {
    discovered,
    ARTIFACTS: {
      async get(name) {
        return repoFor(name);
      },
      async list({ limit = 200 } = {}) {
        return { repos: discovered.slice(0, limit) };
      },
    },
    tree,
    commit,
    defineRepo,
  };
}

// ---------------------------------------------------------------------------
// Fixture — base `demo` + `agent-1`..`agent-5`, each head committed over
// the shared base commit (so the fork point is that base commit). agent-5
// adds the secret-class config/.env (matches the /changes acceptance repo
// shape). NO secret VALUES in fixture text — keys only.
// `dev` is a second branch on the base AND on agent-5 (case 7 pins
// baseRef-follows-ref: /changes?ref=dev must resolve the head at dev).
// ---------------------------------------------------------------------------
const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
const STORE_BASE = "export const store = 1;\nexport const keep = 0;\n";
// Keys only — no credential values ever enter the fixture.
const ENV_FILE = "API_TOKEN=\nREDIS_URL=\n";
const BASE_FILES = { "src/auth.ts": AUTH_BASE, "src/store.ts": STORE_BASE };
// agent-1 carries a stated intent so the judge plan asks risk_1,
// intent_1, overclaim_1 and content_secret_1 (the reply the scripted
// AI returns). Without an intent the plan asks only risk_1 +
// content_secret_1 and a 4-key reply fails the answer-count gate.
const AGENT_1_INTENT = "Bump the auth module for the demo.";

// repoHead(env, name, ref) — the same read /proposals publishes as
// base.head and /land compares reviewed.baseHead against: the head sha the
// RESOLVED (base, baseRef) pair actually points at.
const repoHead = async (env, name, ref) => {
  const repo = await env.ARTIFACTS.get(name);
  const commits = await repo.log({ ref, limit: 1 });
  return commits[0].hash;
};

function makeEnvironment() {
  const fake = makeFakeArtifacts();

  const base = fake.commit(hex40("base"), fake.tree(BASE_FILES));
  fake.defineRepo("demo", {
    history: [base],
    refs: { main: base.hash, dev: base.hash },
  });
  fake.discovered.push({ name: "demo", status: "ready" });

  const agents = {
    "agent-1": { ...BASE_FILES, "src/auth.ts": "export const auth = 2;\nexport const keep = true;\n" },
    "agent-2": { ...BASE_FILES, "src/store.ts": "export const store = 2;\nexport const keep = 0;\n" },
    "agent-3": { ...BASE_FILES, "src/new.ts": "export const fresh = 1;\n" },
    "agent-4": { ...BASE_FILES, "src/auth.ts": "export const auth = 4;\nexport const keep = true;\n" },
    // agent-5 adds the secret-class config/.env (keys only, no values).
    "agent-5": { ...BASE_FILES, "config/.env": ENV_FILE },
  };
  for (const [name, files] of Object.entries(agents)) {
    const head = fake.commit(hex40(name), fake.tree(files));
    // agent-5 also carries a `dev` branch (same head) so the head side
    // of /changes?ref=dev resolves; demo:dev and agent-5:dev share the
    // fork point, so the change-set is measured at the same tree.
    const refs = { main: head.hash };
    if (name === "agent-5") refs.dev = head.hash;
    const intents = name === "agent-1" ? { [head.hash]: AGENT_1_INTENT } : {};
    fake.defineRepo(name, { history: [head, base], refs, intents });
    fake.discovered.push({ name, status: "ready" });
  }

  return { fake, base };
}

// Scripted AI binding: records the model it was called with and returns a
// schema-valid Clef reply for the single-repo plan (risk_1, intent_1,
// overclaim_1, content_secret_1 — no collision_1 for one repo).
const aiCalls = [];
let aiNext = null;
const AI = {
  async run(model, inputs) {
    aiCalls.push({ model, inputs });
    if (aiNext instanceof Error) throw aiNext;
    return aiNext;
  },
};
const clefReply = (answers, model = "clef") => ({ model, answers, usage: { neurons: 1 } });
const singleRepoAnswers = () => ({
  risk_1: { type: "score", score: 1.2, confidence: 0.5 },
  intent_1: { type: "choice", choice: "supports" },
  overclaim_1: { type: "noul", noul: 0.2 },
  content_secret_1: { type: "noul", noul: 0.1 },
});

// Fresh env per case (fresh fake Artifacts + fresh AI call log), so no case
// can observe another case's state — full-suite safe by construction.
let ipSeq = 0;
const nextIp = () => `10.9.0.${++ipSeq}`;
function makeEnv() {
  const { fake, base } = makeEnvironment();
  return {
    env: {
      ARTIFACTS: fake.ARTIFACTS,
      LIVE: {},
      CACHE: {},
      ASSETS: { fetch: async () => new Response("") },
      AI: AI,
      AUTH_MODE: "demo",
    },
    fake,
    base,
  };
}

const get = async (env, path, query = "") => {
  const res = await worker.fetch(
    new Request(`https://nextgit.invalid/${path}${query}`, { headers: { "CF-Connecting-IP": nextIp() } }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};

const post = async (env, path, body) => {
  const res = await worker.fetch(
    new Request(`https://nextgit.invalid/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": nextIp() },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

// ---- case 1: GET /changes, all defaults omitted --------------------------
{
  const { env, base } = makeEnv();
  const r = await get(env, "changes", "?repo=agent-5");
  const cs = r.body?.changeSet;
  check("1 /changes status 200", r.status === 200 && r.body?.ok === true, J(r.body));
  check("1 base.repo == demo (default)", cs?.base?.repo === "demo", J(cs?.base));
  check("1 base.ref == main (baseRef default follows ref default)", cs?.base?.ref === "main", J(cs?.base));
  check("1 base.treeHash is the demo main tree", cs?.base?.treeHash === base.treeHash, J(cs?.base));
  check("1 head.repo == agent-5", cs?.head?.repo === "agent-5", J(cs?.head));
  check("1 head.ref == main (ref default)", cs?.head?.ref === "main", J(cs?.head));
  // agent-5's change-set is non-empty and carries the secret-class file keys.
  const envRow = cs?.files?.find((f) => f.path === "config/.env");
  check("1 agent-5 change-set carries config/.env", !!envRow && envRow.status === "added", J(cs?.files));
  check("1 config/.env is secret-class (keys only)", envRow?.secret === true && Array.isArray(envRow?.keys), J(envRow));
}

// ---- case 2: GET /merge, all defaults omitted ----------------------------
{
  const { env } = makeEnv();
  const r = await get(env, "merge", "?repos=agent-1");
  const m = r.body?.merge;
  check("2 /merge status 200", r.status === 200 && r.body?.ok === true, J(r.body));
  check("2 merge.base.repo == demo (default)", m?.base?.repo === "demo", J(m?.base));
  check("2 merge.base.ref == main (default)", m?.base?.ref === "main", J(m?.base));
  // The fold of agent-1 onto demo:main is a real merged file (non-empty).
  check("2 merge folded agent-1 files", Array.isArray(m?.files) && m.files.length > 0, J(m?.files?.length));
}

// ---- case 3: GET /proposals, defaults omitted (explicit subset) ----------
{
  const { env, base } = makeEnv();
  const r = await get(env, "proposals", "?repos=agent-1");
  const b = r.body?.base;
  check("3 /proposals status 200", r.status === 200 && r.body?.ok === true, J(r.body));
  check("3 base.repo == demo (default)", b?.repo === "demo", J(b));
  check("3 base.ref == main (default)", b?.ref === "main", J(b));
  // base.head is read at the RESOLVED (demo, main): the 40-hex base head.
  const expectedHead = await repoHead(env, "demo", "main");
  check("3 base.head == repoHead(demo, main)", typeof b?.head === "string" && /^[0-9a-f]{40}$/.test(b.head) && b.head === expectedHead, J(b));
  check("3 base.head is the fixture base commit", b?.head === base.hash, J({ got: b?.head, want: base.hash }));
}

// ---- case 4: POST /judge, base/refs omitted ------------------------------
{
  const { env } = makeEnv();
  aiCalls.length = 0;
  aiNext = clefReply(singleRepoAnswers());
  const r = await post(env, "judge", { setId: "v1", target: { repos: ["agent-1"] } });
  check("4 /judge status 200", r.status === 200 && r.body?.ok === true, J(r.body));
  check("4 model == pinned @cf/cloudflare/clef", r.body?.model === "@cf/cloudflare/clef", J(r.body?.model));
  check("4 setId echoed v1", r.body?.setId === "v1", J(r.body?.setId));
  check("4 one judgment for agent-1", Array.isArray(r.body?.judgments) && r.body.judgments.length === 1 && r.body.judgments[0].repo === "agent-1", J(r.body?.judgments));
  check("4 skipped empty", Array.isArray(r.body?.skipped) && r.body.skipped.length === 0, J(r.body?.skipped));
  // The route consumed the RESOLVED base->demo / refs->[main]: the fake AI
  // was called exactly once with the pinned model id.
  check("4 AI.run called once with PINNED_MODEL_ID", aiCalls.length === 1 && aiCalls[0].model === "@cf/cloudflare/clef", J(aiCalls.map((c) => c.model)));
  // The AI state carried agent-1's change-set measured at demo:main — the
  // resolved defaults, not some other baseline.
  const state = aiCalls[0]?.inputs?.state;
  const proposal = state?.proposals?.[0];
  check("4 AI state proposal[0].repo == agent-1", proposal?.repo === "agent-1", J(proposal?.repo));
  check("4 AI state proposal[0] has files", Array.isArray(proposal?.files) && proposal.files.length > 0, J(proposal?.files?.length));
}

// ---- case 5: POST /land, defaults omitted, stale baseHead -> 409 stale ----
{
  const { env, base } = makeEnv();
  const before = await repoHead(env, "demo", "main");
  check("5 pre: base head is the fixture base commit", before === base.hash, J({ got: before, want: base.hash }));
  // A stale baseHead (40 zeros — never the current head) on the DEFAULT
  // base path (base/baseRef/ref all omitted).
  const staleBaseHead = "0".repeat(40);
  const r = await post(env, "land", {
    repos: ["agent-1"],
    reviewed: { baseHead: staleBaseHead, heads: { "agent-1": await repoHead(env, "agent-1", "main") } },
  });
  check("5 /land status 409", r.status === 409, `status ${r.status}`);
  check("5 /land ok:false error:stale", r.body?.ok === false && r.body?.error === "stale", J(r.body));
  // The refusal must not have pushed: base head byte-identical before/after.
  const after = await repoHead(env, "demo", "main");
  check("5 base head unmoved by refused land", after === before, J({ before, after }));
}

// ---- case 6: negative control — explicit == omitted ----------------------
{
  const omittedEnv = makeEnv().env;
  const explicitEnv = makeEnv().env;
  const omitted = await get(omittedEnv, "changes", "?repo=agent-5");
  const explicit = await get(explicitEnv, "changes", "?repo=agent-5&base=demo&ref=main&baseRef=main");
  const o = omitted.body?.changeSet;
  const e = explicit.body?.changeSet;
  check("6 omitted and explicit both 200", omitted.status === 200 && explicit.status === 200, J([omitted.status, explicit.status]));
  check("6 base identity identical (omitted == explicit)", o?.base?.repo === e?.base?.repo && o?.base?.ref === e?.base?.ref && o?.base?.treeHash === e?.base?.treeHash, J([o?.base, e?.base]));
  check("6 head identity identical (omitted == explicit)", o?.head?.repo === e?.head?.repo && o?.head?.ref === e?.head?.ref && o?.head?.treeHash === e?.head?.treeHash, J([o?.head, e?.head]));
  check("6 change-set files identical", J(o?.files) === J(e?.files), "file sets differ");
}

// ---- case 7: baseRef-follows-ref coupling (ref=dev) ----------------------
{
  const { env, base } = makeEnv();
  const r = await get(env, "changes", "?repo=agent-5&ref=dev");
  const cs = r.body?.changeSet;
  check("7 /changes?ref=dev status 200", r.status === 200 && r.body?.ok === true, J(r.body));
  // base+baseRef omitted, ref=dev: baseRef defaults to ref => dev.
  check("7 base.ref == dev (baseRef follows ref)", cs?.base?.ref === "dev", J(cs?.base));
  check("7 head.ref == dev (ref consumed)", cs?.head?.ref === "dev", J(cs?.head));
  // demo:dev points at the same base commit as demo:main in the fixture,
  // so the change-set is measured at the same tree — proving the resolved
  // baseRef (not a hardcoded "main") drove the read.
  const devHead = await repoHead(env, "demo", "dev");
  check("7 demo:dev resolves to the base commit", devHead === base.hash, J({ devHead, base: base.hash }));
  check("7 base.treeHash == demo:dev tree", cs?.base?.treeHash === base.treeHash, J({ got: cs?.base?.treeHash, want: base.treeHash }));
}
// ---- case 8: the seam IS the single source (AD-8, no private defaults) --
// The exported resolver's values ARE the constants; every inlined call
// site (parseProposalsQuery / parseLandBody / parseJudgeBody / warmup)
// delegates to it, so a route cannot resolve a different default.
{
  check("8 DEFAULT_BASE_REPO == demo", DEFAULT_BASE_REPO === "demo", J(DEFAULT_BASE_REPO));
  check("8 DEFAULT_REF == main", DEFAULT_REF === "main", J(DEFAULT_REF));
  const r = resolveRouteBase({});
  check("8 resolver({}) -> {base:demo, ref:main, baseRef:main}",
    r.base === "demo" && r.ref === "main" && r.baseRef === "main", J(r));
  // baseRef-follows-ref through the seam (mirrors case 7's live behavior).
  const r2 = resolveRouteBase({ ref: "dev" });
  check("8 resolver({ref:dev}).baseRef == dev", r2.baseRef === "dev" && r2.ref === "dev" && r2.base === "demo", J(r2));
  // explicit values pass through untouched (omitted == explicit).
  const r3 = resolveRouteBase({ base: "agent-1", ref: "dev", baseRef: "prod" });
  check("8 resolver passes explicit values through",
    r3.base === "agent-1" && r3.ref === "dev" && r3.baseRef === "prod", J(r3));
  // The seam defaults only on ABSENCE (undefined): a present
  // value passes through untouched — an empty string is the
  // caller's to validate (a 400, not the default). Only the
  // /land body historically defaulted an empty string (truthy
  // guard); the GET parser did not (case 9 pins its 400).
  // The route-level cases 1-7 pin the live behaviors.
  const r4 = resolveRouteBase({ base: "", ref: "", baseRef: "" });
  check("8 resolver passes empty strings through (undefined-only defaults)",
    r4.base === "" && r4.ref === "" && r4.baseRef === "", J(r4));
  const r5 = resolveRouteBase({ base: undefined, ref: undefined, baseRef: undefined });
  check("8 resolver({undefined}) -> defaults",
    r5.base === "demo" && r5.ref === "main" && r5.baseRef === "main", J(r5));
}

// ---- case 9: GET empty params are 400s, not defaults --------
// Base parity: the GET query parser resolves absent (null) ->
// default but passes a PRESENT "" through raw, so ?base= (and
// ?ref= / ?baseRef=) hit the REPO_NAME_RE/REF_RE guards ->
// 400 "invalid base repo: \"\"". Pins the restored behavior
// (the parser's nullish `??` idiom) so the class cannot
// silently regress to a default again.
{
  const { env } = makeEnv();
  const r = await get(env, "changes", "?repo=agent-5&base=&ref=&baseRef=");
  check("9 GET ?base= (empty) -> 400", r.status === 400, `status ${r.status}`);
  check("9 400 invalid base repo: \"\"", r.body?.ok === false && r.body?.error === 'invalid base repo: ""', J(r.body));
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
