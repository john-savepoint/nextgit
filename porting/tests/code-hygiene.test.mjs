#!/usr/bin/env bun
// Contract suite: nextgit-e18-impl-hygiene-mediums — four code-hygiene
// mediums, one leg per finding (real construction only; no mock.module,
// no source grep). Run: bun porting/tests/code-hygiene.test.mjs (exit 0).
//
// Legs (each names the finding it closes):
//   a. /floors enumeration leak — non-allowlist repos (evil-repo,
//      scratch-tmp-9) must NOT egress in floors[]. The floor
//      enumeration publishes repo NAMES, so it runs through the
//      demo allowlist (DEMO_REPO_RE) like every other discovery route.
//   b. /proposals/{repo} honest errors — an unknown repo (the compute
//      seam's first env.ARTIFACTS.get fails "not found") -> 404
//      {ok:false,error:"not-found"}; ANY other read fault -> 500
//      {ok:false,error:"read-fault"} with a string detail (a blanket
//      404 would misreport a binding fault as "no such proposal").
//   c. landingVerdict single source — the ONE helper (exported from
//      index.ts) carries the four landing arms; both served surfaces
//      (GET /proposals card + GET /proposals/{repo} detail) derive
//      through it, so the card's landing verdict deep-equals the
//      detail's merge-derived verdict (the drift guard: a re-inlined
//      ternary would pass the arm tests but break two-surface equality).
//   d. fanout read-token revoke — the lineage read token is revoked
//      (DELETE /tokens/:id) in a finally, whether recordLineage lands
//      (success path) OR fails (failure path — the finally proof).
//
// Full-suite safe: fresh env per leg (factory fakes, fresh rate budget
// via per-caller IPs), no network (leg d uses an in-process node:http
// server pointed at via ARTIFACTS_API_BASE), no Chrome.

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import worker, { landingVerdict } from "../../platform/src/index.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else {
    fails++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
  if (ok) console.log(`PASS  ${name}`);
};
const J = (x) => JSON.stringify(x);

// Per-caller IP budget (the tree-read discipline): the in-isolate rate
// limiter state never bleeds between legs.
let ipSeq = 0;
const nextIp = () => "10.21.1." + ++ipSeq;

// ---------------------------------------------------------------------------
// In-memory Artifacts fake (the client-protocol / proposals-auto-discover
// factory shape): get() + list() over a content-addressed blob/tree store.
// A factory, so environments cannot alias. `getThrows` lets a leg make
// get() throw a chosen error shape (the leg-b fault injector).
// ---------------------------------------------------------------------------
function makeFakeArtifacts(opts = {}) {
  const blobText = new Map();
  const blobHashByText = new Map();
  const treeEntries = new Map();
  const repos = new Map();
  const discovered = [];
  const getThrows = opts.getThrows ?? new Map(); // name -> Error thrown from get()

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
        : { name, mode: "40000", hash: treeHashFor(child), type: "tree" },
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
  function defineRepo(name, spec) {
    repos.set(name, { history: spec.history, refs: spec.refs, intents: spec.intents || {} });
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
    if (!store) throw new Error(`repo not found: ${name}`); // the binding's not-found family
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
        const t = getThrows.get(name);
        if (t) throw t;
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

function makeKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// Fresh env per leg (fresh fake Artifacts + fresh KV), so no leg can
// observe another's state — full-suite safe by construction.
function makeEnvironment(opts = {}) {
  const fake = makeFakeArtifacts(opts);
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

const get = async (env, path, ip) => {
  const res = await worker.fetch(
    new Request(`https://nextgit.invalid${path}`, { headers: ip ? { "cf-connecting-ip": ip } : {} }),
    env,
  );
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

// ===========================================================================
// Leg a — /floors enumeration leak (finding a: the only unfiltered mapper
// published every namespace repo name, including non-allowlist repos a
// caller cannot otherwise discover — an Information Disclosure surface).
// ===========================================================================
{
  const { env, fake } = makeEnvironment();
  // The fake's list() carries four repos: two allowlisted (demo, agent-1),
  // two NOT (evil-repo, scratch-tmp-9).
  fake.discovered.push(
    { name: "demo", status: "ready", defaultBranch: "main" },
    { name: "agent-1", status: "ready", defaultBranch: "main" },
    { name: "evil-repo", status: "ready", defaultBranch: "main" },
    { name: "scratch-tmp-9", status: "ready", defaultBranch: "main" },
  );
  let listCalls = 0;
  const realList = env.ARTIFACTS.list.bind(env.ARTIFACTS);
  env.ARTIFACTS.list = async (o) => {
    listCalls++;
    return realList(o);
  };

  const r = await get(env, "/floors", nextIp());
  const floorRepos = Array.isArray(r.body?.floors) ? r.body.floors.map((f) => f.repo) : [];

  check(
    "a1 /floors 200 ok:true",
    r.status === 200 && r.body?.ok === true,
    `status=${r.status} error=${r.body?.error ?? ""}`,
  );
  check(
    "a2 /floors carries exactly the allowlist (demo, agent-1)",
    J(floorRepos) === J(["demo", "agent-1"]),
    J(floorRepos),
  );
  check("a3 evil-repo absent from floors[]", !floorRepos.includes("evil-repo"), J(floorRepos));
  check("a4 scratch-tmp-9 absent from floors[]", !floorRepos.includes("scratch-tmp-9"), J(floorRepos));
  check("a5 list() called exactly once (bounded discovery)", listCalls === 1, `calls=${listCalls}`);
  const serialized = J(r.body);
  check(
    "a6 no non-allowlist name leaks through any stray field",
    !serialized.includes("evil-repo") && !serialized.includes("scratch-tmp-9"),
  );
}

// ===========================================================================
// Leg b — /proposals/{repo} honest errors (finding b: one blanket catch
// mapped EVERY read fault to 404, so a binding fault mid-compute masqueraded
// as "no such proposal" — corrupting client retry/classification).
// ===========================================================================

// b-variant 1: get("agent-unknown") throws a not-found-shaped error —
// the honest 404 (the compute seam's first repo read fails for a name the
// namespace does not carry).
{
  const { env } = makeEnvironment({
    getThrows: new Map([["agent-unknown", new Error("repo not found: agent-unknown")]]),
  });
  const r = await get(env, "/proposals/agent-unknown", nextIp());
  check(
    "b1 unknown repo -> 404 {ok:false,error:not-found}",
    r.status === 404 && r.body?.ok === false && r.body?.error === "not-found",
    `status=${r.status} body=${J(r.body)}`,
  );
}

// b-variant 2: get("agent-1") succeeds but a deeper read throws a NON
// not-found fault — the read fault must be a 500 with a string detail,
// never a blanket 404.
{
  const { env, fake } = makeEnvironment();
  // A real repo the compute seam can open, but make a read inside the fold
  // throw a connection-style fault (not the not-found family). The demo
  // base + agent-1 fixture mirrors client-protocol.test.mjs.
  const BASE_FILES = { "src/auth.ts": "export const auth = 1;\n" };
  const cFork = fake.commit("c-fork", fake.tree(BASE_FILES));
  const cLand = fake.commit("c-land", fake.tree({ ...BASE_FILES, "src/auth.ts": "export const auth = 3;\n" }));
  fake.defineRepo("demo", { history: [cLand, cFork], refs: { main: cLand.hash } });
  fake.discovered.push({ name: "demo", status: "ready", defaultBranch: "main" });
  const cA1 = fake.commit("c-agent-1", fake.tree({ ...BASE_FILES, "src/auth.ts": "export const auth = 2;\n" }));
  fake.defineRepo("agent-1", { history: [cA1, cFork], refs: { main: cA1.hash } });
  fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

  // Inject a non-not-found fault at a deeper read: make readTree throw a
  // binding-connection error. computeChangeSet -> forkPoint walks the tree,
  // so a readTree fault surfaces as a read fault (not the not-found family).
  const realReadTree = fake.ARTIFACTS;
  const origGet = realReadTree.get.bind(realReadTree);
  realReadTree.get = async (name) => {
    const repo = await origGet(name);
    if (name === "agent-1") {
      return {
        ...repo,
        async readTree() {
          throw new Error("binding connection reset");
        },
      };
    }
    return repo;
  };

  const r = await get(env, "/proposals/agent-1", nextIp());
  check(
    "b2 read fault -> 500 {ok:false,error:read-fault} (not a blanket 404)",
    r.status === 500 && r.body?.ok === false && r.body?.error === "read-fault" && typeof r.body?.detail === "string",
    `status=${r.status} body=${J(r.body)}`,
  );
}

// ===========================================================================
// Leg c — landingVerdict single source (finding c: a byte-identical 4-arm
// ternary was duplicated across computeProposals + handleProposalDetail —
// a drift hazard on the next edit).
// ===========================================================================

// c-arm 1..4: the helper's four arms directly, with real MergeFile-shaped rows.
check(
  "c1 withheld-secret arm",
  J(landingVerdict([{ path: "a.ts", action: "write", result: "withheld-secret" }], "merged", [])) ===
  J({ status: "withheld-secret", files: 1 }),
);
check(
  "c2 conflict arm",
  J(landingVerdict([{ path: "a.ts", action: "write", result: "merged" }], "conflict", ["a.ts"])) ===
  J({ status: "conflict", files: 1 }),
);
check("c3 landed arm (empty fold)", J(landingVerdict([], "merged", [])) === J({ status: "landed", files: 0 }));
check(
  "c4 ready arm",
  J(landingVerdict([{ path: "a.ts", action: "write", result: "merged" }], "merged", [])) ===
  J({ status: "ready", files: 1 }),
);

// c two-surface equality (the drift guard): the card's landing verdict
// (GET /proposals, auto-discovered agent-*) must deep-equal the detail's
// merge-derived verdict (GET /proposals/agent-1). Both route through the
// ONE helper; a re-inlined ternary on either surface would still pass the
// arm tests but break this equality.
{
  const { env, fake } = makeEnvironment();
  const BASE_FILES = { "src/auth.ts": "export const auth = 1;\n" };
  const cFork = fake.commit("c-fork", fake.tree(BASE_FILES));
  const cLand = fake.commit("c-land", fake.tree(BASE_FILES)); // base head == fork point -> fold changes nothing? No: base advanced.
  // Base head advanced past the fork onto the SAME lines the agent changed
  // -> a real text conflict (the client-protocol collision fixture).
  const cLand2 = fake.commit("c-land2", fake.tree({ ...BASE_FILES, "src/auth.ts": "export const auth = 3;\n" }));
  fake.defineRepo("demo", { history: [cLand2, cFork], refs: { main: cLand2.hash } });
  fake.discovered.push({ name: "demo", status: "ready", defaultBranch: "main" });
  const AUTH_A1 = "export const auth = 2;\nexport const keep = true;\n";
  const cA1 = fake.commit("c-agent-1", fake.tree({ ...BASE_FILES, "src/auth.ts": AUTH_A1 }));
  fake.defineRepo("agent-1", { history: [cA1, cFork], refs: { main: cA1.hash } });
  fake.discovered.push({ name: "agent-1", status: "ready", defaultBranch: "main" });

  const card = await get(env, "/proposals?base=demo&ref=main", nextIp());
  const detail = await get(env, "/proposals/agent-1?base=demo&ref=main", nextIp());

  const cardProposal = Array.isArray(card.body?.proposals) ? card.body.proposals.find((p) => p.repo === "agent-1") : null;
  const cardLanding = cardProposal?.landing;
  // The detail's merge-derived verdict: detail.merge.{status,conflicted} is
  // exactly the (status, conflicted) pair landingVerdict consumes; the
  // detail's proposal.state is the helper's derived status.
  const detailMerge = detail.body?.proposal?.detail?.merge;
  const detailState = detail.body?.proposal?.state;

  check(
    "c5 card + detail both 200 ok:true",
    card.status === 200 && card.body?.ok === true && detail.status === 200 && detail.body?.ok === true,
    `card=${card.status}/${J(card.body?.error ?? "")} detail=${detail.status}/${J(detail.body?.error ?? "")}`,
  );
  check(
    "c6 card landing.status === detail proposal.state (single-source verdict)",
    cardLanding?.status === detailState,
    `card=${cardLanding?.status} detail=${detailState}`,
  );
  // Re-derive the detail's verdict from its OWN merge fields through the
  // helper, then assert the card agrees — the drift guard.
  const redetail = landingVerdict(
    (detail.body?.proposal?.detail?.files ?? []).map((f) => ({ path: f.path, action: f.action, result: f.result })),
    detailMerge?.status ?? "",
    detailMerge?.conflicted ?? [],
  );
  check(
    "c7 card landing deep-equals helper(detail.merge) — two-surface equality",
    J(cardLanding) === J(redetail),
    `card=${J(cardLanding)} rederived=${J(redetail)}`,
  );
}

// ===========================================================================
// Leg d — fanout read-token revoke in a finally (finding d: the lineage
// read token was minted and NEVER revoked — a live read-scoped credential
// left in the namespace until TTL expiry).
// ===========================================================================

// The in-process fake control plane (the makeGitServer discipline):
// answers the exact REST surface fanout.mjs drives — GET /repos,
// POST /repos/:b/fork, POST /tokens (mint, returns
// {id, plaintext, scope, expires_at}), DELETE /tokens/:id (revoke,
// recorded), and the KV PUT /storage/kv/.../values/fork:<name>.
// It ALSO serves the baseline repo over git smart-HTTP (git
// http-backend, the makeGitServer precedent) so `git ls-remote`
// inside recordLineage resolves a real main ref on the success
// path. `kvMode` selects the KV failure leg; `lsRemoteMode`
// selects the ls-remote failure leg (a second fault-injection
// axis for the finally proof).
function makeFakeControlPlane(opts = {}) {
  const wire = { deletes: [], mints: [], kvPuts: 0, lsRemoteHits: 0 };
  const kvMode = opts.kvMode ?? "ok"; // "ok" | "fail"
  const lsRemoteMode = opts.lsRemoteMode ?? "ok"; // "ok" | "fail"
  let tokN = 0;

  // A real bare repo served via git http-backend (the makeGitServer
  // discipline): `git ls-remote` resolves its main ref.
  const dir = mkdtempSync(join(tmpdir(), "code-hygiene-git-"));
  const bareDir = join(dir, "demo.git");
  spawnSync("git", ["init", "--bare", "-b", "main", bareDir]);
  spawnSync("git", ["-C", bareDir, "config", "http.receivepack", "true"]);
  // Seed one commit on main so ls-remote sees a real ref.
  const workDir = join(dir, "work");
  spawnSync("git", ["init", "-b", "main", workDir]);
  writeFileSync(join(workDir, "README.md"), "demo\n");
  spawnSync("git", ["-C", workDir, "add", "."]);
  spawnSync("git", ["-C", workDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"]);
  spawnSync("git", ["-C", workDir, "push", bareDir, "main"]);

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const pathname = u.pathname;
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // git smart-HTTP: /git/<namespace>/<repo>.git/... ->
    // http-backend. The namespace is a host-level mount in
    // real Artifacts git-over-HTTPS, NOT a directory level,
    // so PATH_INFO drops it: /git/<ns>/<repo>.git/x ->
    // /<repo>.git/x under GIT_PROJECT_ROOT.
    if (pathname.startsWith("/git/") && (pathname.endsWith("/info/refs") || pathname.includes("/git-"))) {
      wire.lsRemoteHits++;
      if (lsRemoteMode === "fail") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [{ code: 1000, message: "git down" }] }));
        return;
      }
      // Collect the request body (POST git-* packets carry a body).
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const reqBody = Buffer.concat(chunks);
      // /git/<ns>/<repo>.git/... -> PATH_INFO /<repo>.git/...
      const pathInfo = pathname.replace(/^\/git\/[^/]+\//, "/");
      const backend = spawnSync("git", ["http-backend"], {
        cwd: dir,
        encoding: "buffer",
        input: reqBody,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: dir,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: pathInfo,
          REQUEST_METHOD: req.method,
          QUERY_STRING: u.searchParams.toString(),
          CONTENT_TYPE: req.headers["content-type"] ?? "",
        },
      });
      // http-backend emits headers as "Key: Value"
      // lines; Node's writeHead wants an object (an
      // array of "Key: Value" strings is rejected —
      // the ERR_INVALID_ARG_VALUE trap).

      const out = backend.stdout ?? Buffer.alloc(0);
      const sep = out.indexOf("\r\n\r\n");
      const head = out.slice(0, sep).toString();
      const body = out.slice(sep + 4);
      const lines = head.split("\r\n").filter(Boolean);
      const statusLine = lines[0] ?? "";
      const m = statusLine.match(/^Status:\s*(\d+)/i);
      const headers = {};
      for (const l of lines.slice(1)) {
        const ci = l.indexOf(":");
        if (ci > 0) headers[l.slice(0, ci).trim()] = l.slice(ci + 1).trim();
      }
      res.writeHead(m ? Number(m[1]) : 200, headers);
      res.end(body);
      return;
    }
    // KV PUT: /accounts/:a/storage/kv/namespaces/:k/values/:key
    if (req.method === "PUT" && pathname.includes("/storage/kv/namespaces/") && pathname.includes("/values/")) {
      wire.kvPuts++;
      if (kvMode === "fail") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [{ code: 1000, message: "kv down" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, result: {} }));
      return;
    }
    // Token mint: POST /accounts/:a/artifacts/namespaces/:n/tokens
    if (req.method === "POST" && pathname.endsWith("/tokens")) {
      tokN++;
      const id = `tok-${tokN}`;
      wire.mints.push({ id, path: pathname });
      json(200, {
        success: true,
        result: { id, plaintext: `art_v1_fake_${tokN}`, scope: "read", expires_at: new Date(Date.now() + 60_000).toISOString() },
      });
      return;
    }
    // Token revoke: DELETE /accounts/:a/artifacts/namespaces/:n/tokens/:id
    const delMatch = pathname.match(/\/tokens\/([^/]+)$/);
    if (req.method === "DELETE" && delMatch) {
      wire.deletes.push(decodeURIComponent(delMatch[1]));
      json(200, { success: true, result: {} });
      return;
    }
    // Fork: POST /accounts/:a/artifacts/namespaces/:n/repos/:baseline/fork
    const forkMatch = pathname.match(/\/repos\/([^/]+)\/fork$/);
    if (req.method === "POST" && forkMatch) {
      json(200, { success: true, result: { remote: `http://127.0.0.1:${server.address()?.port ?? 0}/git/x.git` } });
      return;
    }
    // Repo list: GET /accounts/:a/artifacts/namespaces/:n/repos
    if (req.method === "GET" && pathname.endsWith("/repos")) {
      json(200, { success: true, result: [{ name: "demo" }] }); // agent-1 NOT present -> fanout forks it
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: false, errors: [{ code: 404, message: "no such route" }] }));
  });
  return { server, wire, dir };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FANOUT = join(__dirname, "..", "..", "platform", "scripts", "fanout.mjs");

// Spawn fanout.mjs against the fake control plane. Returns {
// status, stdout, wire, port } — the wire oracle for the
// revoke assertion. `lsRemoteMode` injects the ls-remote
// fault axis (a second finally-proof axis alongside kvMode).
//
// ASYNC spawn (not spawnSync): the parent's event loop must
// stay live to serve the fake control plane's HTTP while the
// fanout subprocess runs — a synchronous spawn would block
// the loop and the subprocess's fetches would hang (the
// in-process-server discipline the makeGitServer suites rely
// on, adapted for a REST control plane).
async function runFanout(kvMode, lsRemoteMode = "ok") {
  const g = makeFakeControlPlane({ kvMode, lsRemoteMode });
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  const port = g.server.address().port;
  const out = `/tmp/code-hygiene-agents-${port}-${kvMode}.json`;
  const child = spawn(
    "node",
    [FANOUT, "1", "demo", "60"],
    {
      env: {
        ...process.env,
        ARTIFACTS_API_BASE: `http://127.0.0.1:${port}`,
        ARTIFACTS_GIT_BASE: `http://127.0.0.1:${port}`,
        CLOUDFLARE_ACCOUNT_ID: "test-account",
        ARTIFACTS_NAMESPACE: "test-ns",
        CACHE_NAMESPACE_ID: "test-cache",
        AGENTS_OUT: out,
        CLOUDFLARE_API_TOKEN: "fake-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const status = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  g.server.close();
  rmSync(g.dir, { recursive: true, force: true });
  return { status, stdout, stderr, wire: g.wire, port };
}

// d success path: ls-remote + KV PUT succeed -> recordLineage
// resolves -> the finally STILL revokes the read token.
{
  const r = await runFanout("ok", "ok");
  // The read (lineage) token is the FIRST mint (the write
  // token for the agent fork is the second — it is NOT
  // revoked here; only the read token is revoked in the
  // finally, per the land.ts twin).
  const readTokId = r.wire.mints[0]?.id;
  check("d1 success path: fanout exit 0", r.status === 0, `exit=${r.status} stderr=${(r.stderr || "").slice(0, 2000)}`);
  check(
    "d2 success path: read token minted + ls-remote served",
    typeof readTokId === "string" && r.wire.lsRemoteHits >= 1,
    `mints=${J(r.wire.mints)} lsRemote=${r.wire.lsRemoteHits}`,
  );
  check(
    "d3 success path: read token revoked (DELETE /tokens/:id on success)",
    typeof readTokId === "string" && r.wire.deletes.includes(readTokId),
    `readTok=${readTokId} deletes=${J(r.wire.deletes)}`,
  );
}

// d failure path: ls-remote FAILS -> recordLineage's catch
// fires -> the finally STILL revokes the read token (the
// finally proof — a revoke placed only on the success path
// would NOT fire here).
{
  const r = await runFanout("ok", "fail");
  const readTokId = r.wire.mints[0]?.id;
  check(
    "d4 failure path: fanout exit 0 (a record failure never fails the fork)",
    r.status === 0,
    `exit=${r.status} stderr=${(r.stderr || "").slice(0, 400)}`,
  );
  check(
    "d5 failure path: read token revoked (DELETE recorded on failure — the finally proof)",
    typeof readTokId === "string" && r.wire.deletes.includes(readTokId),
    `readTok=${readTokId} deletes=${J(r.wire.deletes)}`,
  );
}

// d failure path 2: ls-remote succeeds but the KV PUT FAILS ->
// recordLineage's catch fires AFTER the ref resolves -> the
// finally STILL revokes (the record fault is at the KV write,
// not the ref resolution).
{
  const r = await runFanout("fail", "ok");
  const readTokId = r.wire.mints[0]?.id;
  check("d6 KV-fault path: fanout exit 0", r.status === 0, `exit=${r.status} stderr=${(r.stderr || "").slice(0, 400)}`);
  check(
    "d7 KV-fault path: read token revoked (DELETE recorded on KV-write failure)",
    typeof readTokId === "string" && r.wire.deletes.includes(readTokId),
    `readTok=${readTokId} deletes=${J(r.wire.deletes)}`,
  );
}

// d negative control: a fresh, never-driven wire records ZERO
// deletes — proves the delete-count assertion can fail (a
// no-revoke script would red d3/d5/d7, not pass vacuously).
{
  const g = makeFakeControlPlane({ kvMode: "ok" });
  check(
    "d8 negative control: a fresh wire records zero deletes (oracle can fail)",
    g.wire.deletes.length === 0,
    `deletes=${J(g.wire.deletes)}`,
  );
  g.server.close();
  rmSync(g.dir, { recursive: true, force: true });
}

console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
