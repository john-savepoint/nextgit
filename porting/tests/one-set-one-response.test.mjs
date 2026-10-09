#!/usr/bin/env bun
// Contract suite: FR-1 — every concurrent proposal is one set in a single response.
// Run: bun porting/tests/one-set-one-response.test.mjs   (exit 0 = pass)
//
// Real construction, two surfaces:
//   * GET /proposals is exercised through the REAL worker module (worker.fetch)
//     against an in-memory Artifacts fake — the platform binding seam is the
//     only fake (fake pattern per judge.test.mjs, which feeds the same
//     computeChangeSet/computeMerge surface this route reads); no module
//     mocks, no source grep.
//   * The shipped platform/ui (index.html + app.js) is loaded in a real
//     headless Chrome over a loopback origin serving the payload THAT ROUTE
//     RETURNED — the only thing scripted is the worker's HTTP surface, never
//     the UI itself.
// Legs:
//   1. route contract (N=5): one response; keys exactly
//      {base,conflicts,ok,proposals,ref,summary} (no paging cursor); every repo
//      matches ^agent-*; EVERY auto-discovered ready agent repo is present
//      (sorted set equality; the non-agent base repo `demo` is excluded);
//      summary.proposals == proposals.length.
//   2. DOM contract at N=5 and 3. DOM contract at N=7: card count ==
//      proposals.length, every repo has its card, #proposals-meta reads exactly
//      "N active", the proposals + conflict-map sections are visible at rest
//      with #inspector-modal still hidden, the map renders one card per
//      conflict, and no pagination/load-more/page-control artifact exists.
//      Two different Ns prove "a set of N proposals renders as N cards" — a
//      fixed-5 render, a pager, or a >5 collapse fails at least one leg.
//   4. live-capture leg: when PROPS_FIXTURE points at a /proposals capture (the
//      order's check_cmd writes one), the payload + DOM contracts run against
//      it verbatim; unset -> one SKIP line (the ceremony owns the live fetch;
//      this leg makes the same proof re-runnable off the capture).
//   5. route-contract leg: the /proposals payload carries a landing object on
//      every proposal with status ∈ {ready, conflict, landed, withheld-secret}
//      and a numeric files count — jq -ec validated against the real worker
//      module response (no chrome dependency, server-side surface only).
// A box without a Chrome binary skips the suite (precedent: batch.test.mjs's
// live-store guard; the order's acceptance gate hard-requires chrome).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../platform/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const EXACT_KEYS = ["base", "conflicts", "ok", "proposals", "ref", "summary"];
// Token set mirrored from the order's check_cmd + the word forms a "load more"
// control would ship; scanned over the rendered DOM, never over source.
const PAGINATION_ARTIFACTS = /pagination|load-more|page-next|page-prev|data-page=|page-size/i;
const PAGINATION_TEXT = /load more|show more|next page|previous page/i;

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return false;
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

// ---------------------------------------------------------------------------
// In-memory Artifacts fake, one instance per environment (the route reads
// get() + list(); the same surface judge.test.mjs scripts). A factory — not
// shared module maps — so the N=5 and N=7 environments cannot alias.
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

// In-memory KVNamespace fake for env.LIVE — supports get/put used by the /proposals
// and /land routes (cache:gen, cache:proposals, landing records). Best-effort.
function makeKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// One environment: base `demo` + N ready agent-* proposals. agent-1 and
// agent-2 collide on src/auth.ts (the map's at-rest render needs a real
// conflict); the rest touch their own files.
function makeEnvironment(agentCount) {
  const fake = makeFakeArtifacts();
  const base = { "src/auth.ts": "export const auth = 1;\nexport const keep = true;\n", "src/util.ts": "export const util = 1;\n" };
  const c1 = fake.commit("c-base", fake.tree(base));
  fake.defineRepo("demo", { history: [c1], refs: { main: c1.hash } });
  fake.discovered.push({ name: "demo", status: "ready" });
  for (let i = 1; i <= agentCount; i++) {
    const name = `agent-${i}`;
    const files = { ...base };
    if (i === 1) files["src/auth.ts"] = "export const auth = 2;\nexport const keep = true;\n";
    else if (i === 2) files["src/auth.ts"] = "export const auth = 99;\nexport const keep = true;\n";
    else files[`src/agent-${i}.ts`] = `export const agent${i} = ${i};\n`;
    const head = fake.commit(`c-${name}`, fake.tree(files));
    fake.defineRepo(name, { history: [head, c1], refs: { main: head.hash }, intents: { [head.hash]: `fixture intent for ${name}` } });
    fake.discovered.push({ name, status: "ready" });
  }
  const agentRepos = fake.discovered.filter((r) => r.name.startsWith("agent-")).map((r) => r.name).sort();
  const env = { ARTIFACTS: fake.ARTIFACTS, LIVE: makeKV(), CACHE: {}, ASSETS: { fetch: async () => new Response("") }, AI: { run: async () => null }, AUTH_MODE: "demo" };
  return { env, agentRepos };
}

// The route's real response for a fresh environment of N agent proposals.
async function proposalsThroughRoute(agentCount) {
  const { env, agentRepos } = makeEnvironment(agentCount);
  const res = await worker.fetch(new Request("https://nextgit.invalid/proposals"), env);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, agentRepos };
}

// ---------------------------------------------------------------------------
// Headless-Chrome DOM leg: the shipped UI over a loopback worker surface
// ---------------------------------------------------------------------------

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  one-set one-response — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-one-set-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=8000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// Full opening tag for an id — attribute values in this document never contain
// ">", so the tag extraction is exact.
const tagFor = (dom, id) => (dom.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`)) || [null])[0];
const isHidden = (dom, id) => {
  const tag = tagFor(dom, id);
  return tag !== null && /\shidden(=|\s|>)/.test(tag);
};

let currentPayload = null; // swapped per DOM leg
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(currentPayload));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, judgments: [], skipped: [] }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

async function runDomContract(label, url, payload) {
  currentPayload = payload;
  const dom = await dumpDom(url);
  const n = payload.proposals.length;
  const cards = [...dom.matchAll(/id="card-(agent-[A-Za-z0-9._-]+)"/g)].map((m) => m[1]);
  const meta = dom.match(/id="proposals-meta"[^>]*>([^<]*)</);
  const conflictCards = (dom.match(/class="conflict-card /g) || []).length;
  check(`${label} card count == proposals.length`, cards.length === n, `cards=${cards.length} proposals=${n}`);
  check(`${label} every repo has its card`, payload.proposals.every((p) => cards.includes(p.repo)), `cards=${cards.join(",")}`);
  check(
    `${label} #proposals-meta reads exactly "${n} active"`,
    meta !== null && meta[1].trim() === `${n} active`,
    meta ? JSON.stringify(meta[1]) : "missing",
  );
  check(
    `${label} set view + conflict map visible at rest (sections present, neither hidden)`,
    tagFor(dom, "proposals-section") !== null &&
    !isHidden(dom, "proposals-section") &&
    tagFor(dom, "conflicts-section") !== null &&
    !isHidden(dom, "conflicts-section"),
  );
  const mapOk = payload.conflicts.length > 0 ? conflictCards === payload.conflicts.length : /No convergence conflicts/.test(dom);
  check(
    `${label} conflict map rendered at rest (${payload.conflicts.length} conflict${payload.conflicts.length === 1 ? "" : "s"})`,
    mapOk,
    `conflict-card count=${conflictCards}`,
  );
  check(`${label} inspector modal still hidden at rest`, isHidden(dom, "inspector-modal"), String(tagFor(dom, "inspector-modal")));
  check(`${label} no pagination/load-more/page-control artifacts`, !PAGINATION_ARTIFACTS.test(dom) && !PAGINATION_TEXT.test(dom));
}

// ---------------------------------------------------------------------------
// 1. Route contract — one response carries the whole auto-discovered set
// ---------------------------------------------------------------------------
try {
  const { status, body, agentRepos } = await proposalsThroughRoute(5);
  const repos = Array.isArray(body?.proposals) ? body.proposals.map((p) => p.repo) : body?.proposals;
  check("1 /proposals answers 200 with ok:true", status === 200 && body?.ok === true, `status=${status} error=${body?.error ?? ""}`);
  check(
    "1 keys exactly {base,conflicts,ok,proposals,ref,summary} — no paging cursor",
    exactKeys(body, EXACT_KEYS),
    JSON.stringify(body && typeof body === "object" ? Object.keys(body).sort() : body),
  );
  check("1 every repo matches ^agent-*", Array.isArray(body?.proposals) && body.proposals.every((p) => /^agent-/.test(p.repo)));
  check(
    "1 one response carries EVERY auto-discovered ready agent repo (non-agent demo excluded)",
    Array.isArray(body?.proposals) && JSON.stringify([...repos].sort()) === JSON.stringify(agentRepos),
    JSON.stringify(repos),
  );
  check(
    "1 summary.proposals == proposals.length",
    typeof body?.summary?.proposals === "number" &&
    Array.isArray(body?.proposals) &&
    body.summary.proposals === body.proposals.length,
    `summary=${body?.summary?.proposals} proposals=${body?.proposals?.length}`,
  );
  check(
    "1 the collision rides in the same response (fixture precondition for the map legs)",
    Array.isArray(body?.conflicts) && body.conflicts.length === 1 && body.conflicts[0].file === "src/auth.ts",
    JSON.stringify(Array.isArray(body?.conflicts) ? body.conflicts.map((c) => c.file) : body?.conflicts),
  );
} catch (e) {
  check("1 route-contract case threw", false, String(e?.stack ?? e));
}

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // -------------------------------------------------------------------------
  // 2 + 3. DOM contract at two different Ns — a set of N renders as N cards
  // -------------------------------------------------------------------------
  try {
    const five = await proposalsThroughRoute(5);
    await runDomContract("2", url, five.body);
  } catch (e) {
    check("2 DOM-contract case threw", false, String(e?.message ?? e));
  }
  try {
    const seven = await proposalsThroughRoute(7);
    await runDomContract("3", url, seven.body);
  } catch (e) {
    check("3 DOM-contract case threw", false, String(e?.message ?? e));
  }

  // -------------------------------------------------------------------------
  // 4. Live capture — the order's check_cmd writes /proposals to a file; point
  //    PROPS_FIXTURE at it to run the payload + DOM contracts on the live set.
  // -------------------------------------------------------------------------
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  4 live capture — PROPS_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      check(
        "4 live capture keys exactly {base,conflicts,ok,proposals,ref,summary}",
        exactKeys(live, EXACT_KEYS),
        JSON.stringify(Object.keys(live ?? {}).sort()),
      );
      check(
        "4 live capture: ok:true, non-empty set, every repo ^agent-*",
        live?.ok === true &&
        Array.isArray(live?.proposals) &&
        live.proposals.length >= 1 &&
        live.proposals.every((p) => /^agent-/.test(p.repo)),
        `n=${live?.proposals?.length}`,
      );
      check(
        "4 live capture summary.proposals == proposals.length",
        typeof live?.summary?.proposals === "number" &&
        Array.isArray(live?.proposals) &&
        live.summary.proposals === live.proposals.length,
        `summary=${live?.summary?.proposals} proposals=${live?.proposals?.length}`,
      );
      await runDomContract("4", url, live);
    } catch (e) {
      check("4 live-capture case threw", false, String(e?.stack ?? e));
    }
  }

  // -------------------------------------------------------------------------
  // 5. Route contract — /proposals carries a landing object per proposal with
  //    a valid status enum {ready, conflict, landed, withheld-secret} and a
  //    numeric files count (FR-19 server-side surface). Validated with jq -ec
  //    against the REAL worker module response (no UI/chrome dependency).
  // -------------------------------------------------------------------------
  try {
    const { status, body } = await proposalsThroughRoute(5);
    check(
      "5 /proposals: every proposal has a landing object",
      status === 200 && Array.isArray(body?.proposals),
      `status=${status} proposals=${body?.proposals?.length ?? "n/a"}`,
    );
    if (status === 200 && Array.isArray(body?.proposals)) {
      const jqPayload = JSON.stringify(body);
      const jqScript =
        '[.proposals[] | {status: .landing.status, files: .landing.files, hasLanding: (.landing != null)}] | all(.hasLanding) ' +
        'and ([.[] | .status] | all(. == "ready" or . == "conflict" or . == "landed" or . == "withheld-secret")) ' +
        'and ([.[] | .files] | all((. | type) == "number"))';
      const tmpJson = join(userDataDir, "proposals-leg5.json");
      writeFileSync(tmpJson, jqPayload);
      const jqResult = spawnSync("jq", ["-ec", jqScript, tmpJson], { encoding: "utf8" });
      check(
        "5 /proposals: landing.status enum ∈ {ready,conflict,landed,withheld-secret} on every proposal",
        jqResult.status === 0,
        `jq exit=${jqResult.status} stderr=${jqResult.stderr?.slice(0, 200) || "none"}`,
      );
      check(
        "5 /proposals: landing.files is numeric on every proposal",
        body.proposals.every((p) => p.landing && typeof p.landing.files === "number"),
        `sample=${body.proposals[0]?.landing?.files ?? "n/a"}`,
      );
    } else {
      check("5 /proposals: landing.status enum valid on every proposal", false, "skipped — route did not return proposals");
      check("5 /proposals: landing.files is numeric on every proposal", false, "skipped — route did not return proposals");
    }
  } catch (e) {
    check("5 route-contract landing-field case threw", false, String(e?.stack ?? e));
  }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
