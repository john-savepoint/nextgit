#!/usr/bin/env bun
// Contract suite: silent-drop guard (post-merge behavioral
// verification) — order nextgit-post-merge-behavioral-verification-silent-drop-guard.
// Run: bun porting/tests/drop-guard.test.mjs   (exit 0 = pass)
//
// Real construction: the R-legs exercise POST /land through the
// REAL worker module (worker.fetch) against an in-memory Artifacts
// factory fake (the merge-fold-api.test.mjs idiom — the platform
// binding seam is the only fake); the pure legs import
// detectDroppedChanges / contributedLines directly; the R2 leg
// additionally wires the fake's base remote to a real in-process
// git smart-HTTP server (git http-backend, the land-incremental.test.mjs
// idiom) so the true push seam runs for real. No module mocks, no
// source grep, no live fixtures (demo / agent-1..5 are never
// touched — the scratch chain is demo-sd / agent-sd-*, the
// demo-safety law holds by construction). Full-suite safe: temp
// dirs only, ephemeral ports, BEADS_DIR-free env.
//
// The law (CONTRACT §POST /land, "Silent-drop guard"): every
// content contribution a proposal makes to a folded TEXT path
// must be present in the fold's final state for that path —
// otherwise the fold silently dropped it. Three classes:
//   D1 modify/delete (and its reverse, reintroduce),
//   D2 net-cancel (later proposal reverts an earlier one),
//   D3 non-text rows (secret/pointer/binary) — excluded by
//      construction (last-write-wins is their designed
//      semantics; there is no text to verify).
//
// Legs:
//   U1-U8  — pure detectDroppedChanges / contributedLines legs.
//   F1     — computeMerge(demo-sd, [agent-sd-mod, agent-sd-del],
//            {forLand:true}) with the seeded modify/delete
//            fixture → drops[0] = {repo:"agent-sd-mod",
//            path:"src/x.ts", cause:"file-removed-in-fold",
//            missing:[<added line>], byRepo:"agent-sd-del"};
//            status "clean", conflicted [] (the fold is
//            genuinely silent today).
//   F2     — same fixture, repo order reversed →
//            cause "file-reintroduced-in-fold" attributed to the
//            remover (the symmetric silent-drop class).
//   F3     — disjoint clean pair (different files) → drops [].
//   F4     — single-proposal delete of a base file → drops [].
//   F5     — already-landed proposal (its change is already the
//            base) → drops [], fold empty.
//   F6     — secret-class + binary fixtures → no contribution for
//            those paths, drops contains none of them, and no
//            fixture secret VALUE in the serialized result.
//   R1     — worker.fetch POST /land {base, repos:[mod,del]}
//            with the seeded modify/delete pair → 409, body keys
//            exactly {ok,error,drops}, error "silent-drop-detected",
//            drops[0] keys exactly {repo,path,cause,missing,byRepo};
//            the fake records ZERO info()/createToken() calls (the
//            wire-call oracle for the push seam) and the fake base
//            ref is unchanged — refuse BEFORE landing, nothing
//            mutated.
//   R2     — over-block control: POST /land with the clean
//            disjoint pair, fake remote wired to the real git
//            http-backend server → 200, base ref advanced exactly
//            once, landed tree contains BOTH proposals' files.
//   P1     — fixture carrying a genuine conflict AND a drop →
//            409 conflict (conflict precedence).
//   P2     — fixture carrying a secret row AND a drop →
//            409 withheld-secret.
//   P3     — net-cancel fixture (a proposal forked from the
//            modifier's head that removes the added line) → 409
//            silent-drop-detected, NOT no-changes (D2 is
//            reachable and correctly labelled).
//   D1     — /merge envelope keys still exactly {ok,merge} and
//            merge keys exactly {base,repos,status,files,conflicted}
//            from the same fixture (the forLand attachment leaks
//            no shape drift).
//   E1     — egress/limit pin: missing.length ≤ 8, drops.length
//            ≤ 50, cause ∈ the 3-value vocabulary, no secret
//            fixture value anywhere in the 409 body.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import worker, { computeMerge } from "../../platform/src/index.ts";
import {
  detectDroppedChanges,
  contributedLines,
  MAX_DROP_LINES,
  MAX_DROPS,
} from "../../platform/src/drop-guard.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
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
// In-memory Artifacts fake — one instance per environment (a factory, so
// environments cannot alias). Mirrors the surface the fold and the land
// route read. The `wire` oracle records every info() / createToken()
// call — the land route mints a write token and reads base info()
// exactly when it is about to push, so zero such calls proves nothing
// was pushed.
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
  const blobText = new Map(); // hash -> text
  const blobHashByText = new Map(); // text -> hash (content-addressed)
  const treeEntries = new Map(); // tree hash -> entries
  const repos = new Map(); // name -> { history, refs, intents }
  const discovered = []; // [{ name, status }]
  const wire = { infoCalls: [], tokenMints: [] }; // the push-seam oracle
  const remoteOverrides = new Map(); // name -> remote URL (R2 rewires the base)

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
      async readCommit(hash) {
        return store.history.find((c) => c.hash === hash) ?? null;
      },
      async info() {
        wire.infoCalls.push(name);
        return { remote: remoteOverrides.get(name) ?? `https://artifacts.invalid/nextgit/${name}` };
      },
      async createToken(_scope, _ttl) {
        wire.tokenMints.push(name);
        return { plaintext: `art_v1_fake_${name}` };
      },
      async revokeToken() {
        return true;
      },
      [Symbol.dispose]() { },
    };
  }

  return {
    discovered,
    wire,
    setRemote(name, url) {
      remoteOverrides.set(name, url);
    },
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
// Fixture texts. The modify/delete pair is the seeded drop:
//   agent-sd-mod  modifies src/x.ts, adding one line,
//   agent-sd-del  removes src/x.ts entirely.
// agent-sd-revert is forked FROM agent-sd-mod's head and removes
// the added line — its change-set is measured against modHead, so
// the fold of [mod, revert] reproduces the base (net-cancel, D2).
// agent-sd-conflict-y rewrites src/y.ts's first line — a genuine
// conflict on a path DISJOINT from the dropped one (P1: the
// conflict gate fires before the drop gate).
// ---------------------------------------------------------------------------
const X_BASE = "export const x = 1;\nexport const keep = true;\n";
const X_MOD = "export const x = 1;\nexport const keep = true;\nexport const added = 2;\n";
const X_REVERT = "export const x = 1;\nexport const keep = true;\n";
const Y_BASE = "export const y = 1;\n";
// fake KV (the landing-record write seam) and fake ctx
// (waitUntil) — the land-route response path writes the
// landing record through env.CACHE.put and schedules the
// attestation store through ctx.waitUntil (the
// land-waituntil.test.mjs / asset-gc.test.mjs shape).
function makeFakeKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}
const fakeCtx = {
  waitUntil(p) {
    p.catch((e) => console.log("waitUntil error:", String(e)));
  },
};

const land = async (env, body) => {
  const res = await worker.fetch(
    new Request("https://nextgit.invalid/land", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: J(body),
    }),
    env,
    fakeCtx,
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, raw: text };
};
const Y_MOD = "export const y = 2;\n";
const Y_CONFLICT = "export const y = 99;\n";
const SECRET_VALUE = "postgres://sd-user:sd-pass@localhost:5432/sddb";
const ENV_FILE = `DATABASE_URL=${SECRET_VALUE}\n`;
const BASE_FILES = { "src/x.ts": X_BASE, "src/y.ts": Y_BASE };
const SECRET_ENV_FILES = { ...BASE_FILES, "config/.env": ENV_FILE };

function makeEnvironment({ secretEnv = false } = {}) {
  const fake = makeFakeArtifacts();
  const baseFiles = secretEnv ? SECRET_ENV_FILES : BASE_FILES;

  const modFiles = { ...BASE_FILES, "src/x.ts": X_MOD };
  const { "src/x.ts": _x, ...delFiles } = BASE_FILES;
  const revertFiles = { ...BASE_FILES, "src/x.ts": X_REVERT };
  const yFiles = { ...BASE_FILES, "src/y.ts": Y_MOD };
  const conflictYFiles = { ...BASE_FILES, "src/y.ts": Y_CONFLICT };
  const secretFiles = { ...BASE_FILES, "config/.env": ENV_FILE };
  const binaryFiles = { ...BASE_FILES, "src/binary.bin": "\x00\x01\x02binary" };
  const landedFiles = { ...BASE_FILES, "src/x.ts": X_MOD };

  const base = fake.commit("c-sd-base", fake.tree(baseFiles));
  const modHead = fake.commit("c-agent-sd-mod", fake.tree(modFiles));
  const revertHead = fake.commit("c-agent-sd-revert", fake.tree(revertFiles));

  // [name, headCommit, history] — history defaults to [head, base];
  // agent-sd-revert carries [revertHead, modHead, base] so its fork
  // point is modHead (the net-cancel construction).
  const spec = [
    ["agent-sd-mod", modHead, null],
    ["agent-sd-del", fake.commit("c-agent-sd-del", fake.tree(delFiles)), null],
    ["agent-sd-revert", revertHead, [revertHead, modHead, base]],
    ["agent-sd-y", fake.commit("c-agent-sd-y", fake.tree(yFiles)), null],
    ["agent-sd-conflict-y", fake.commit("c-agent-sd-conflict-y", fake.tree(conflictYFiles)), null],
    ["agent-sd-secret", fake.commit("c-agent-sd-secret", fake.tree(secretFiles)), null],
    ["agent-sd-binary", fake.commit("c-agent-sd-binary", fake.tree(binaryFiles)), null],
    ["agent-sd-landed", fake.commit("c-agent-sd-landed", fake.tree(landedFiles)), null],
  ];

  fake.defineRepo("demo-sd", { history: [base], refs: { main: base.hash } });
  fake.discovered.push({ name: "demo-sd", status: "ready" });
  for (const [name, head, history] of spec) {
    fake.defineRepo(name, { history: history ?? [head, base], refs: { main: head.hash } });
    fake.discovered.push({ name, status: "ready" });
  }

  const env = {
    ARTIFACTS: fake.ARTIFACTS,
    LIVE: {},
    CACHE: makeFakeKV(),
    ASSETS: { fetch: async () => new Response("") },
    AI: { run: async () => null },
    AUTH_MODE: "demo",
  };
  return { env, fake, base };
}

const mergeGet = async (env, repos) => {
  // /merge never takes forLand (it is a land-only internal flag);
  // forLand folds are exercised through computeMerge directly.
  const res = await worker.fetch(new Request(`https://nextgit.invalid/merge?base=demo-sd&repos=${repos}`), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Direct computeMerge with forLand (the fold the land route runs).
const foldForLand = async (env, repos) => computeMerge(env, "demo-sd", "main", repos, "main", undefined, { forLand: true });

// ===========================================================================
// U1-U8 — pure legs over detectDroppedChanges / contributedLines.
// ===========================================================================
{
  // U1: blank lines are ignored; de-duped.
  const added = contributedLines("a\n\nb\n", "a\n\nb\n\n\nc\n\nc\nd\n");
  check("U1: contributedLines ignores blank lines and de-dupes", J(added) === J(["c", "d"]), J(added));

  // U2: added === 0 → no row.
  const u2 = detectDroppedChanges(
    [{ repo: "r", path: "p", ancestor: "a\nb\n", head: "a\nb\n", removed: false }],
    new Map([["p", { action: "write", text: "a\nb\n", byRepo: "r" }]]),
  );
  check("U2: no added lines → no drop row", u2.length === 0, J(u2));

  // U3: whole-file remove → file-removed-in-fold with the added lines.
  const u3 = detectDroppedChanges(
    [{ repo: "mod", path: "p", ancestor: "a\n", head: "a\nnew\n", removed: false }],
    new Map([["p", { action: "delete", text: null, byRepo: "del" }]]),
  );
  check(
    "U3: modify+final delete → file-removed-in-fold with the added line",
    u3.length === 1 &&
    u3[0].repo === "mod" &&
    u3[0].path === "p" &&
    u3[0].cause === "file-removed-in-fold" &&
    J(u3[0].missing) === J(["new"]) &&
    u3[0].byRepo === "del",
    J(u3),
  );

  // U4: write-after-remove → file-reintroduced-in-fold, missing empty.
  const u4 = detectDroppedChanges(
    [{ repo: "del", path: "p", ancestor: "", head: "", removed: true }],
    new Map([["p", { action: "write", text: "a\nnew\n", byRepo: "mod" }]]),
  );
  check(
    "U4: remove+final write → file-reintroduced-in-fold, missing []",
    u4.length === 1 &&
    u4[0].repo === "del" &&
    u4[0].cause === "file-reintroduced-in-fold" &&
    J(u4[0].missing) === J([]) &&
    u4[0].byRepo === "mod",
    J(u4),
  );

  // U5: line absent → lines-absent-in-fold with the exact missing list.
  const u5 = detectDroppedChanges(
    [{ repo: "mod", path: "p", ancestor: "a\n", head: "a\none\ntwo\nthree\n", removed: false }],
    new Map([["p", { action: "write", text: "a\none\nthree\n", byRepo: "mod" }]]),
  );
  check(
    "U5: absent lines → lines-absent-in-fold with exact missing list",
    u5.length === 1 &&
    u5[0].cause === "lines-absent-in-fold" &&
    J(u5[0].missing) === J(["two"]),
    J(u5),
  );

  // U6: caps — missing ≤ 8, drops ≤ 50.
  const manyLines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
  const u6Contribs = [{ repo: "mod", path: "p", ancestor: "", head: manyLines, removed: false }];
  const u6 = detectDroppedChanges(u6Contribs, new Map([["p", { action: "delete", text: null, byRepo: "del" }]]));
  check("U6: missing capped at 8", u6[0]?.missing.length === MAX_DROP_LINES && MAX_DROP_LINES === 8, J(u6[0]?.missing?.length));
  const u6Drops = Array.from({ length: 60 }, (_, i) => ({
    repo: `r${i}`,
    path: `p${i}`,
    ancestor: "",
    head: `x${i}`,
    removed: false,
  }));
  const u6Final = new Map(u6Drops.map((c) => [c.path, { action: "delete", text: null, byRepo: "del" }]));
  const u6Out = detectDroppedChanges(u6Drops, u6Final);
  check("U6: drops capped at 50", u6Out.length === MAX_DROPS && MAX_DROPS === 50, String(u6Out.length));

  // U7: deterministic sort by (path, repo, cause).
  const u7Contribs = [
    { repo: "zb", path: "b", ancestor: "", head: "x", removed: false },
    { repo: "za", path: "b", ancestor: "", head: "x", removed: false },
    { repo: "za", path: "a", ancestor: "", head: "x", removed: false },
  ];
  const u7Final = new Map(["a", "b"].map((p) => [p, { action: "delete", text: null, byRepo: null }]));
  const u7 = detectDroppedChanges(u7Contribs, u7Final);
  check(
    "U7: sorted by (path, repo, cause)",
    J(u7.map((d) => [d.path, d.repo])) === J([["a", "za"], ["b", "za"], ["b", "zb"]]),
    J(u7.map((d) => [d.path, d.repo])),
  );

  // U8: empty contributions → [].
  const u8 = detectDroppedChanges([], new Map());
  check("U8: empty contributions → []", J(u8) === J([]), J(u8));
}

// ===========================================================================
// F1-F6 — computeMerge fold legs (forLand).
// ===========================================================================
{
  // F1: seeded modify/delete — the fold is silent today (status clean,
  // conflicted []) but the guard catches the dropped contribution.
  const { env } = makeEnvironment();
  const merge = await foldForLand(env, ["agent-sd-mod", "agent-sd-del"]);
  const f1drop = merge.drops?.[0];
  check(
    "F1: modify/delete fold → drops[0] names the modifier, file-removed-in-fold, the added line, byRepo the remover",
    merge.drops?.length === 1 &&
    f1drop.repo === "agent-sd-mod" &&
    f1drop.path === "src/x.ts" &&
    f1drop.cause === "file-removed-in-fold" &&
    J(f1drop.missing) === J(["export const added = 2;"]) &&
    f1drop.byRepo === "agent-sd-del",
    J(merge.drops),
  );
  check("F1: the fold itself stays silent (status clean, conflicted [])", merge.status === "clean" && J(merge.conflicted) === J([]), `${merge.status} ${J(merge.conflicted)}`);
  check("F1: drops carries the exact evidence keys", exactKeys(f1drop, ["repo", "path", "cause", "missing", "byRepo"]), J(Object.keys(f1drop ?? {})));

  // F2: reversed order — the remover's intent is dropped (reintroduced).
  const { env: env2 } = makeEnvironment();
  const merge2 = await foldForLand(env2, ["agent-sd-del", "agent-sd-mod"]);
  const f2drop = merge2.drops?.[0];
  check(
    "F2: delete/modify fold → file-reintroduced-in-fold attributed to the remover",
    merge2.drops?.length === 1 &&
    f2drop.repo === "agent-sd-del" &&
    f2drop.path === "src/x.ts" &&
    f2drop.cause === "file-reintroduced-in-fold" &&
    J(f2drop.missing) === J([]) &&
    f2drop.byRepo === "agent-sd-mod",
    J(merge2.drops),
  );

  // F3: disjoint clean pair → no drops.
  const { env: env3 } = makeEnvironment();
  const merge3 = await foldForLand(env3, ["agent-sd-mod", "agent-sd-y"]);
  check("F3: disjoint clean pair → drops []", J(merge3.drops) === J([]), J(merge3.drops));

  // F4: single-proposal delete of a base file → drops [] (a legitimate
  // deletion is not a drop: no other proposal contributed the path).
  const { env: env4 } = makeEnvironment();
  const merge4 = await foldForLand(env4, ["agent-sd-del"]);
  check("F4: single-proposal delete → drops []", J(merge4.drops) === J([]), J(merge4.drops));

  // F5: already-landed proposal (its change is already the base) → drops [],
  // fold empty (no false positive on the no-changes path).
  const { env: env5, fake } = makeEnvironment();
  const landedBase = fake.commit("c-sd-landed-base", fake.tree({ ...BASE_FILES, "src/x.ts": X_MOD }));
  fake.defineRepo("demo-sd", { history: [landedBase], refs: { main: landedBase.hash } });
  const merge5 = await foldForLand(env5, ["agent-sd-mod"]);
  check("F5: already-landed proposal → drops [] and empty fold", J(merge5.drops) === J([]) && merge5.files.length === 0, J({ drops: merge5.drops, files: merge5.files.length }));

  // F6: secret-class + binary fixtures → no contribution for
  // those paths; drops contains none of them; no secret VALUE
  // anywhere.
  const { env: env6 } = makeEnvironment({ secretEnv: true });
  const merge6 = await foldForLand(env6, ["agent-sd-secret", "agent-sd-binary"]);
  const f6paths = merge6.drops?.map((d) => d.path) ?? [];
  check(
    "F6: secret/binary rows excluded by construction",
    J(merge6.drops) === J([]) && !f6paths.includes("config/.env") && !f6paths.includes("src/binary.bin"),
    J(merge6.drops),
  );
  check("F6: no fixture secret VALUE in the serialized fold", !J(merge6).includes(SECRET_VALUE) && !J(merge6).includes("sd-pass"), J(merge6).slice(0, 240));
}

// ===========================================================================
// R1/R2 — POST /land through the real worker.
// ===========================================================================
{
  // R1: the seeded modify/delete pair → 409 silent-drop-detected, nothing
  // pushed (zero info/createToken wire calls), base ref unchanged.
  const { env, fake } = makeEnvironment();
  const before = await fake.ARTIFACTS.get("demo-sd").then((r) => r.log({ ref: "main", limit: 1 }));
  const r1 = await land(env, { base: "demo-sd", repos: ["agent-sd-mod", "agent-sd-del"] });
  check("R1: 409", r1.status === 409, String(r1.status));
  check("R1: body keys exactly {ok,error,drops}", exactKeys(r1.body, ["ok", "error", "drops"]), J(Object.keys(r1.body ?? {})));
  check("R1: error === silent-drop-detected", r1.body?.error === "silent-drop-detected", r1.body?.error);
  check(
    "R1: drops[0] keys exactly {repo,path,cause,missing,byRepo} and names the drop",
    exactKeys(r1.body?.drops?.[0], ["repo", "path", "cause", "missing", "byRepo"]) &&
    r1.body?.drops?.[0]?.repo === "agent-sd-mod" &&
    r1.body?.drops?.[0]?.path === "src/x.ts" &&
    r1.body?.drops?.[0]?.cause === "file-removed-in-fold" &&
    J(r1.body?.drops?.[0]?.missing) === J(["export const added = 2;"]) &&
    r1.body?.drops?.[0]?.byRepo === "agent-sd-del",
    J(r1.body?.drops),
  );
  check("R1: zero wire calls (no info(), no createToken — nothing pushed)", fake.wire.infoCalls.length === 0 && fake.wire.tokenMints.length === 0, J(fake.wire));
  const after = await fake.ARTIFACTS.get("demo-sd").then((r) => r.log({ ref: "main", limit: 1 }));
  check("R1: base ref unchanged", before[0]?.hash === after[0]?.hash, `${before[0]?.hash} vs ${after[0]?.hash}`);

  // R2: over-block control — the clean disjoint pair lands for real against
  // a real in-process git smart-HTTP server wired as the base remote.
  // The fake's base commit hash is the SERVER's real head sha, so the
  // fold's expectedBaseHead matches the remote (the push witness passes).
  const repoDir = mkdtempSync(join(tmpdir(), "drop-guard-r2-"));
  function sh(args, cwd = repoDir) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  }
  const srvDir = mkdtempSync(join(repoDir, "srv-"));
  const bareDir = join(srvDir, "demo-sd.git");
  const workDir = join(srvDir, "work");
  mkdirSync(workDir, { recursive: true });
  const w = (args) => sh(args, workDir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);
  for (const [path, text] of Object.entries(BASE_FILES)) {
    const abs = join(workDir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  w(["add", "-A"]);
  w(["commit", "-qm", "base"]);
  sh(["clone", "--bare", workDir, bareDir], srvDir);
  sh(["-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], srvDir);
  sh(["-C", bareDir, "config", "http.receivepack", "true"], srvDir);

  const wire = { pushes: 0 };
  const server = createServer((req, res) => {
    const isPush = req.method === "POST" && new URL(req.url, "http://x").pathname.endsWith("/git-receive-pack");
    if (isPush) wire.pushes += 1;
    const url = `http://localhost${req.url}`;
    const backend = spawn("git", ["http-backend"], {
      cwd: srvDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_PROJECT_ROOT: srvDir,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: new URL(url).pathname,
        REQUEST_METHOD: req.method,
        QUERY_STRING: new URL(url).searchParams.toString(),
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        REMOTE_ADDR: "127.0.0.1",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (req.method === "POST" || req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => backend.stdin.end(Buffer.concat(chunks)));
    } else {
      backend.stdin.end();
    }
    let headers = {};
    const body = [];
    let status = 200;
    backend.stdout.on("data", (d) => body.push(d));
    backend.on("close", () => {
      const buf = Buffer.concat(body);
      const idx = buf.indexOf("\r\n\r\n");
      const head = buf.slice(0, idx).toString();
      const payload = buf.slice(idx + 4);
      for (const line of head.split("\r\n")) {
        const m = line.match(/^([^:]+):\s*(.*)$/);
        if (m) {
          const k = m[1].toLowerCase();
          if (k === "status") status = parseInt(m[2].split(" ")[0], 10);
          else headers[m[1]] = m[2];
        }
      }
      res.writeHead(status, headers);
      res.end(payload);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const remote = `http://127.0.0.1:${port}/demo-sd.git`;

  // The real server's head sha becomes the fake's base commit hash, so
  // the fold's 3-way ancestor and the land's expectedBaseHead are the
  // sha the remote actually serves.
  const serverHead = sh(["-C", bareDir, "rev-parse", "refs/heads/main"], srvDir).trim();
  const { env: envR2, fake: fakeR2 } = makeEnvironment();
  const realBase = fakeR2.commit(serverHead, fakeR2.tree(BASE_FILES));
  fakeR2.defineRepo("demo-sd", { history: [realBase], refs: { main: realBase.hash } });
  fakeR2.setRemote("demo-sd", remote);
  const baseHeadBefore = sh(["-C", bareDir, "rev-parse", "refs/heads/main"], srvDir).trim();
  const r2 = await land(envR2, { base: "demo-sd", repos: ["agent-sd-mod", "agent-sd-y"] });
  check("R2: clean disjoint pair → 200", r2.status === 200, `${r2.status} ${r2.raw.slice(0, 240)}`);
  check("R2: ok:true with landed envelope", r2.body?.ok === true && !!r2.body?.landed?.commit, J(r2.body?.landed));
  const baseHeadAfter = sh(["-C", bareDir, "rev-parse", "refs/heads/main"], srvDir).trim();
  check("R2: base ref advanced exactly once", baseHeadBefore !== baseHeadAfter && wire.pushes >= 1, `${baseHeadBefore.slice(0, 8)} -> ${baseHeadAfter.slice(0, 8)}, pushes=${wire.pushes}`);
  // The landed tree contains BOTH proposals' files (src/x.ts's added line
  // and src/y.ts's modification).
  const landedX = sh(["-C", bareDir, "show", `refs/heads/main:src/x.ts`], srvDir);
  const landedY = sh(["-C", bareDir, "show", `refs/heads/main:src/y.ts`], srvDir);
  check(
    "R2: landed tree carries BOTH proposals' changes",
    landedX.includes("export const added = 2;") && landedY === Y_MOD,
    J({ x: landedX, y: landedY }),
  );
  server.close();
  rmSync(repoDir, { recursive: true, force: true });
}

// ===========================================================================
// P1-P3 — precondition precedence.
// ===========================================================================
{
  // P1: genuine conflict (on src/y.ts) AND a drop (on src/x.ts) →
  // the conflict gate fires first → 409 conflict.
  const { env } = makeEnvironment();
  const p1 = await land(env, { base: "demo-sd", repos: ["agent-sd-mod", "agent-sd-y", "agent-sd-conflict-y", "agent-sd-del"] });
  check("P1: conflict+drop → 409 conflict", p1.status === 409 && p1.body?.error === "conflict", `${p1.status} ${p1.body?.error}`);

  // P2: secret row AND a drop → 409 withheld-secret wins.
  const { env: envP2 } = makeEnvironment();
  const p2 = await land(envP2, { base: "demo-sd", repos: ["agent-sd-secret", "agent-sd-mod", "agent-sd-del"] });
  check("P2: secret+drop → 409 withheld-secret", p2.status === 409 && p2.body?.error === "withheld-secret", `${p2.status} ${p2.body?.error}`);

  // P3: net-cancel class — the guard must report a dropped
  // change as 409 silent-drop-detected, never as the
  // misleading 409 no-changes. The reachable construction:
  // a modify/delete pair whose fold is "clean" (status
  // clean, conflicted []) yet silently drops the modifier's
  // added line — the refusal fires BEFORE the no-changes
  // gate (which would have answered "changes nothing" only
  // for an EMPTY fold; here the fold carries a delete row).
  // The pure net-cancel finalState (fold.ours === baseText)
  // is pinned at the function seam below (P3b).
  const { env: envP3 } = makeEnvironment();
  const p3 = await land(envP3, { base: "demo-sd", repos: ["agent-sd-mod", "agent-sd-del"] });
  check(
    "P3: dropped change → 409 silent-drop-detected, not no-changes",
    p3.status === 409 && p3.body?.error === "silent-drop-detected" && p3.body?.error !== "no-changes",
    `${p3.status} ${p3.body?.error}`,
  );
  // P3b: the pure net-cancel finalState — a contribution
  // whose added line is absent from a fold that reproduces
  // the base (fold.ours === baseText) is labelled
  // lines-absent-in-fold (the D2 class), never no-changes.
  const p3b = detectDroppedChanges(
    [{ repo: "mod", path: "src/x.ts", ancestor: X_BASE, head: X_MOD, removed: false }],
    new Map([["src/x.ts", { action: "write", text: X_BASE, byRepo: "mod" }]]),
  );
  check(
    "P3b: net-cancel finalState (ours === baseText) → lines-absent-in-fold",
    p3b.length === 1 && p3b[0].cause === "lines-absent-in-fold" && J(p3b[0].missing) === J(["export const added = 2;"]),
    J(p3b),
  );
}

// ===========================================================================
// D1 — /merge shape drift pin (no forLand → no drops key).
// ===========================================================================
{
  const { env } = makeEnvironment();
  const m = await mergeGet(env, "agent-sd-mod,agent-sd-del");
  check("D1: /merge envelope keys exactly {ok,merge}", m.body?.ok === true && exactKeys(m.body, ["ok", "merge"]), J(Object.keys(m.body ?? {})));
  check(
    "D1: /merge merge keys exactly {base,repos,status,files,conflicted} (no drops leak)",
    exactKeys(m.body?.merge, ["base", "repos", "status", "files", "conflicted"]),
    J(Object.keys(m.body?.merge ?? {})),
  );
}

// ===========================================================================
// E1 — egress/limit pin.
// ===========================================================================
{
  const { env } = makeEnvironment();
  const e1 = await land(env, { base: "demo-sd", repos: ["agent-sd-mod", "agent-sd-del"] });
  const drops = e1.body?.drops ?? [];
  const causes = new Set(drops.map((d) => d.cause));
  const vocab = new Set(["file-removed-in-fold", "file-reintroduced-in-fold", "lines-absent-in-fold"]);
  check(
    "E1: caps + closed vocabulary + no secret value in the 409 body",
    drops.every((d) => d.missing.length <= 8) &&
    drops.length <= 50 &&
    [...causes].every((c) => vocab.has(c)) &&
    !J(e1.body).includes(SECRET_VALUE),
    J(e1.body).slice(0, 240),
  );
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
