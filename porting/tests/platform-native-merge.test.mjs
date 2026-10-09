#!/usr/bin/env bun
// Contract suite: FR-14 — platform-native merge/diff primitives are pinned in
// source and live through the real route. Run:
//   bun porting/tests/platform-native-merge.test.mjs   (exit 0 = pass)
//
// Two legs:
//   1. static config + import + primitive-usage source assertions (no execution):
//      isomorphic-git ^1.43.0; compat date 2026-09-01; no nodejs_compat;
//      diff3Merge imported from node-diff3 and used in renderMerge;
//      createTwoFilesPatch imported from diff and used in computeChangeSet;
//      `function classifyPair` defined and called in computeProposals;
//      one git.clone + one git.push call site in land.ts, zero in index.ts.
//   2. live route behavior through the REAL worker module (worker.fetch) against
//      an in-memory Artifacts fake (pattern per merge-fold-api.test.mjs):
//      /merge on colliding repos => {ok:true,merge:{status:"conflict"}} with
//        conflictText carrying <<<ours / === / >>>theirs AND both refreshSession
//        and isExpired side text;
//      /merge clean fold => {status:"clean",result:"merged"} with exact text;
//      /proposals => a conflict with kind "text-conflict" and pairs[].kind
//        "text-conflict" — proving classifyPair is live.
// No mock.module, no source-grep for behavioral assertions; real construction
// only. Follows worker-cpu-budget-structural.test.mjs (static) and
// merge-fold-api.test.mjs (live fake) conventions.

import { readFileSync } from "node:fs";
import worker from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// JSONC strip: remove // line comments and /* block */ comments, and trailing
// commas before JSON.parse (wrangler.jsonc uses // comments today).
function parseJsonc(text) {
  let s = text.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\/\/.*?$/gm, "");
  s = s.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(s);
}

// Count call sites of `obj.prop` in source text — `member(` including optional
// whitespace before `(`. Excludes type-position uses like `typeof obj.prop`
// where no `(` follows the member expression.
function countCallSites(src, member) {
  const esc = member.replace(/\./g, "\\.");
  const re = new RegExp(esc + "\\s*\\(", "g");
  let count = 0;
  while (re.exec(src) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Leg 1 — static source assertions.
// ---------------------------------------------------------------------------
const pkgPath = new URL("../../platform/package.json", import.meta.url);
const wranglerPath = new URL("../../platform/wrangler.jsonc", import.meta.url);
const indexSrc = readFileSync(new URL("../../platform/src/index.ts", import.meta.url), "utf8");
const landSrc = readFileSync(new URL("../../platform/src/land.ts", import.meta.url), "utf8");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const wrangler = parseJsonc(readFileSync(wranglerPath, "utf8"));

check("isomorphic-git ^1.43.0 in package.json dependencies", pkg.dependencies?.["isomorphic-git"] === "^1.43.0", pkg.dependencies?.["isomorphic-git"]);
check("compatibility_date 2026-09-01 in wrangler.jsonc", wrangler.compatibility_date === "2026-09-01", wrangler.compatibility_date);
check("no nodejs_compat in wrangler.jsonc", !(wrangler.compatibility_flags || []).includes("nodejs_compat"));
check("diff3Merge imported from node-diff3 in index.ts", /import\s*\{[^}]*\bdiff3Merge\b[^}]*\}\s*from\s*"node-diff3"/.test(indexSrc));
check("diff3Merge used (renderMerge calls it)", indexSrc.includes("diff3Merge(") && indexSrc.includes("function renderMerge("));
check("createTwoFilesPatch imported from diff in index.ts", /import\s*\{[^}]*\bcreateTwoFilesPatch\b[^}]*\}\s*from\s*"diff"/.test(indexSrc));
check("createTwoFilesPatch used (computeChangeSet calls it)", indexSrc.includes("createTwoFilesPatch(") && indexSrc.includes("async function computeChangeSet("));
check("classifyPair defined in index.ts", /function\s+classifyPair\s*\(/.test(indexSrc));
check("classifyPair called in computeProposals", indexSrc.includes("classifyPair(") && /async function computeProposals/.test(indexSrc));
check("git.clone / git.push absent from index.ts", !/git\.clone/.test(indexSrc) && !/git\.push/.test(indexSrc));
check("exactly one git.clone call site in land.ts", countCallSites(landSrc, "git.clone") === 1, `found ${countCallSites(landSrc, "git.clone")}`);
check("exactly one git.push call site in land.ts", countCallSites(landSrc, "git.push") === 1, `found ${countCallSites(landSrc, "git.push")}`);

// ---------------------------------------------------------------------------
// Leg 2 — live /merge + /proposals behavior through the real route.
//
// Reuses the in-memory Artifacts fake + fixture shape from merge-fold-api.test.mjs:
// agent-1 and agent-2 collide on src/auth.ts (refreshSession vs isExpired).
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
      async log({ ref = "HEAD", limit = 200 } = {}) {
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

const AUTH_BASE = "export const auth = 1;\nexport const keep = true;\n";
const AUTH_1 = "export function refreshSession(ttl) {\n  return Date.now() + ttl;\n}\nexport const keep = true;\n";
const AUTH_2 = "export function isExpired(claims) {\n  return claims.exp < Date.now();\n}\nexport const keep = true;\n";
const STORE_BASE = "export const store = 1;\nexport const keep = 0;\n";
const STORE_3 = "export const store = 2;\nexport const keep = 0;\n";

const BASE_FILES = { "src/auth.ts": AUTH_BASE, "src/store.ts": STORE_BASE };

function makeEnvironment() {
  const fake = makeFakeArtifacts();
  const base = fake.commit("c-base", fake.tree(BASE_FILES));
  fake.defineRepo("demo", { history: [base], refs: { main: base.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });

  const agent1 = { ...BASE_FILES, "src/auth.ts": AUTH_1 };
  const agent2 = { ...BASE_FILES, "src/auth.ts": AUTH_2 };
  const agent3 = { ...BASE_FILES, "src/store.ts": STORE_3 };

  for (const [name, files] of [
    ["agent-1", agent1],
    ["agent-2", agent2],
    ["agent-3", agent3],
  ]) {
    const head = fake.commit(`c-${name}`, fake.tree(files));
    fake.defineRepo(name, { history: [head, base], refs: { main: head.hash } });
    fake.discovered.push({ name, status: "ready" });
  }

  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: {}, CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { env };
}

const J = (x) => JSON.stringify(x);
const get = async (env, query) => {
  const res = await worker.fetch(new Request(`https://nextgit.invalid${query}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

{
  const { env } = makeEnvironment();

  // /merge on colliding repos => real 3-way conflict with diff3Merge markers.
  const conflict = await get(env, "/merge?base=demo&repos=agent-1,agent-2");
  check("2a conflict: ok:true", conflict.body?.ok === true, conflict.body);
  const cm = conflict.body?.merge;
  check("2a conflict: merge.status === conflict", cm?.status === "conflict", cm?.status);
  const crow = (cm?.files ?? []).find((f) => f.path === "src/auth.ts" && f.result === "conflict");
  check("2a conflict: src/auth.ts write/conflict row present", !!crow && crow.action === "write", J(crow));
  const conflictText = crow?.conflictText ?? "";
  check("2a conflict: conflictText has <<<<<<< ours", conflictText.includes("<<<<<<< ours"), conflictText.slice(0, 120));
  check("2a conflict: conflictText has =======", conflictText.includes("======="), conflictText.slice(0, 120));
  check("2a conflict: conflictText has >>>>>>> theirs", conflictText.includes(">>>>>>> theirs"), conflictText.slice(0, 120));
  check("2a conflict: conflictText carries refreshSession (ours)", conflictText.includes("refreshSession"), conflictText.slice(0, 200));
  check("2a conflict: conflictText carries isExpired (theirs)", conflictText.includes("isExpired"), conflictText.slice(0, 200));
  check("2a conflict: conflicted lists src/auth.ts", (cm?.conflicted ?? []).includes("src/auth.ts"));

  // /merge clean fold => status clean, result merged, exact folded text.
  const clean = await get(env, "/merge?base=demo&repos=agent-3");
  const ccm = clean.body?.merge;
  check("2b clean: merge.status === clean", ccm?.status === "clean", ccm?.status);
  const crow3 = (ccm?.files ?? []).find((f) => f.path === "src/store.ts");
  check("2b clean: src/store.ts write/merged with exact text", crow3?.action === "write" && crow3?.result === "merged" && crow3?.merged === STORE_3, J(crow3));
  check("2b clean: no conflict markers in body", !JSON.stringify(clean.body).includes("<<<<<<<") && !JSON.stringify(clean.body).includes(">>>>>>>"), "conflict markers found");

  // /proposals => classifyPair live: the colliding pair is a text-conflict.
  const props = await get(env, "/proposals?base=demo&repos=agent-1,agent-2");
  check("2c proposals: ok:true", props.body?.ok === true, props.body);
  const conflicts = props.body?.conflicts ?? [];
  const authConflict = conflicts.find((c) => c.file === "src/auth.ts");
  check("2c proposals: src/auth.ts conflict row present", !!authConflict, J(conflicts));
  check("2c proposals: conflict kind is text-conflict", authConflict?.kind === "text-conflict", authConflict?.kind);
  const pairs = authConflict?.pairs ?? [];
  check("2c proposals: exactly one pair (agent-1 x agent-2)", pairs.length === 1, J(pairs));
  check("2c proposals: pair kind is text-conflict", pairs[0]?.kind === "text-conflict", pairs[0]?.kind);
  check("2c proposals: pair conflict is true", pairs[0]?.conflict === true, pairs[0]?.conflict);
}
console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
