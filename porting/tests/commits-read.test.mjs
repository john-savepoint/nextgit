#!/usr/bin/env bun
// Contract suite: nextgit-e15 - worker read API for commit history
// (GET /commits). Run: bun porting/tests/commits-read.test.mjs  (exit 0 = pass)
//
// Real construction: imports the real `worker` from
// platform/src/index.ts and drives worker.fetch() against an
// in-memory Artifacts fake (the tree-read.test.mjs factory idiom) -
// the platform binding seam is the ONLY fake; no mock.module, no
// source grep, end-to-end through the real dispatcher (authorize()
// mode gate + allowlist + the handler).
//
// Fixtures: demo/main = a 3-commit first-parent chain c0 -> c1 -> c2
// (real parent links + real author dates) plus a divergent dev branch
// d0 -> d1; agent-1/main = a 25-commit chain; agent-2/main = a
// 120-commit chain (the clamp repo). The fake's log() walks the
// first-parent chain from the ref tip (newest-first), exactly the
// binding contract; it records every log() opts (the clamp is
// observable there) and records-and-throws on any readTree/readFile/
// readBlob call (the log-only seam).
//
// 10 groups: shape+ordering+parent links; determinism; ref default +
// ref selection; limit legs (default/clamp/400-no-read); 400 repo/ref
// legs; 403 allowlist; 401 deny mode; uniform 404; log-only invariant;
// unbound rate posture.
//
// Full-suite safety: a fresh env (distinct fake Artifacts + fresh
// per-caller CF-Connecting-IP budget) per group - the in-isolate rate
// limiter state from one group never bleeds into another;
// process.exit(fails === 0 ? 0 : 1).

import worker from "../../platform/src/index.ts";
import { ROUTE_RATE_LIMITS } from "../../platform/src/rate.ts";

let passes = 0;
let fails = 0;
const check = (name, ok, detail) => { if (ok) passes++; else { fails++; console.log("FAIL  " + name + (detail ? " - " + detail : "")); } if (ok) console.log("PASS  " + name); };
const J = (x) => JSON.stringify(x);

// Deterministic 40-hex commit hash (the default-resolution.test.mjs
// hex40 idiom) with a per-run index prefix so the 120-commit fixture
// cannot collide on the 32-bit hash.
function hex40(label) {
 let h = 0;
 for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
 const hex = h.toString(16).padStart(8, "0");
 return (hex + hex + hex + hex + hex).slice(0, 40);
}
let shaSeq = 0;
function sha(label) {
 const seq = (++shaSeq).toString(16).padStart(8, "0");
 return (seq + hex40(label)).slice(0, 40);
}

// ---------------------------------------------------------------------------
// In-memory Artifacts fake - one instance per environment (a factory, so
// environments cannot alias). Mirrors the surface the read routes read;
// log() performs the binding's newest-first first-parent walk from the
// ref tip, records every opts, and any tree/blob read records AND throws
// (the log-only invariant). The factory also exposes commit/defineRepo so
// the fixture builds commits through the fake's own surface (the
// tree-read.test.mjs makeFakeArtifacts idiom).
// ---------------------------------------------------------------------------
function makeFakeArtifacts() {
 const repos = new Map(); // name -> { history, refs }
 const logCalls = []; // every log() opts, in call order
 const contentCalls = []; // every readTree/readFile/readBlob call
 let logThrows = false;
 const defaultAuthor = { name: "fixture", email: "fixture@test" };

 // The tree-read commit() shape extended with the metadata /commits
 // projects: real parent links + a real author date.
 function commit(hash, treeHash, opts = {}) {
  const author = opts.author ?? { ...defaultAuthor };
  const authoredAt = opts.authoredAt ?? 0;
  return {
   hash,
   treeHash,
   message: opts.message ?? hash,
   author,
   committer: author,
   parents: opts.parents ?? [],
   authoredAt,
   committedAt: authoredAt,
  };
 }

 function defineRepo(name, spec) {
  repos.set(name, { history: spec.history, refs: spec.refs });
 }

 function repoFor(name) {
  const store = repos.get(name);
  if (!store) throw new Error("fixture: no repo " + name);
  const byHash = new Map(store.history.map((c) => [c.hash, c]));
  return {
   async log(opts) {
    logCalls.push(opts);
    if (logThrows) throw new Error("fixture: log failure");
    const ref = (opts && opts.ref) || "HEAD";
    const limit = (opts && opts.limit) || 50;
    const tipHash = store.refs[ref] ?? ref;
    const out = [];
    let cur = byHash.get(tipHash);
    while (cur && out.length < limit) {
     out.push(cur);
     const first = (cur.parents ?? [])[0];
     cur = first ? byHash.get(first) : undefined;
    }
    return out;
   },
   async readTree(hash) { contentCalls.push(["readTree", hash]); throw new Error("fixture: readTree must not be reached by /commits"); },
   async readFile(args) { contentCalls.push(["readFile", args]); throw new Error("fixture: readFile must not be reached by /commits"); },
   async readBlob(hash) { contentCalls.push(["readBlob", hash]); throw new Error("fixture: readBlob must not be reached by /commits"); },
   async info() { return { remote: "https://artifacts.invalid/nextgit/" + name }; },
   async revokeToken() { return true; },
   [Symbol.dispose]() { },
  };
 }

 return {
  ARTIFACTS: {
   async get(name) { return repoFor(name); },
   async list() { return { repos: [] }; },
  },
  commit,
  defineRepo,
  logCalls,
  contentCalls,
  setLogThrows(v) { logThrows = v; },
 };
}

// A linear first-parent chain: chain[i].parents === [chain[i-1]] ([] at
// the root). Oldest-first; returns the commits.
function buildChain(fake, label, n, baseAuthored) {
 const chain = [];
 for (let i = 0; i < n; i++) {
  const c = fake.commit(sha(label + "-" + i), "tree-" + label + "-" + i, {
   message: label + " commit " + i,
   parents: i === 0 ? [] : [chain[i - 1].hash],
   authoredAt: baseAuthored + i,
  });
  chain.push(c);
 }
 return chain;
}

// ---------------------------------------------------------------------------
// Fixture + fresh env per group (fresh fake Artifacts + fresh rate budget
// via per-caller IPs), so no group observes another's state.
// ---------------------------------------------------------------------------
const AUTHORED_C0 = 1700000000;
const AUTHORED_C1 = 1700000100;
const AUTHORED_C2 = 1700000200;

function makeEnv() {
 const fake = makeFakeArtifacts();
 const chain3 = buildChain(fake, "demo", 3, AUTHORED_C0); // c0 -> c1 -> c2
 const d0 = fake.commit(sha("dev-0"), "tree-dev-0", { message: "dev root", parents: [], authoredAt: 1690000000 });
 const d1 = fake.commit(sha("dev-1"), "tree-dev-1", { message: "dev head", parents: [d0.hash], authoredAt: 1690000100 });
 const chain25 = buildChain(fake, "a1", 25, 1600000000);
 const chain120 = buildChain(fake, "a2", 120, 1500000000);
 fake.defineRepo("demo", { history: [...chain3.slice().reverse(), d1, d0], refs: { main: chain3[2].hash, dev: d1.hash } });
 fake.defineRepo("agent-1", { history: chain25.slice().reverse(), refs: { main: chain25[24].hash } });
 fake.defineRepo("agent-2", { history: chain120.slice().reverse(), refs: { main: chain120[119].hash } });
 return {
  fake,
  fixtures: { chain3, d0, d1, chain25, chain120 },
  env: {
   ARTIFACTS: fake.ARTIFACTS,
   LIVE: { get: async () => undefined },
   CACHE: { get: async () => undefined, put: async () => { } },
   ASSETS: { fetch: async () => new Response("") },
   AI: { run: async () => null },
   AUTH_MODE: "demo",
  },
 };
}

// Probe env: ARTIFACTS.get records + throws, so a route that reads the
// namespace before validation/authorize proves it by a nonzero count.
function makeProbeEnv(authMode) {
 const probe = { calls: 0 };
 return {
  probe,
  env: {
   ARTIFACTS: {
    get: async () => { probe.calls++; throw new Error("probe: Artifacts.get must not be reached pre-validation/pre-authorize"); },
    list: async () => { throw new Error("probe: list must not be reached"); },
   },
   LIVE: { get: async () => undefined },
   CACHE: { get: async () => undefined, put: async () => { } },
   ASSETS: { fetch: async () => new Response("") },
   AI: { run: async () => null },
   AUTH_MODE: authMode,
  },
 };
}

let ipSeq = 0;
const nextIp = () => "10.9.2." + (++ipSeq);
const get = async (env, path, query, ip) => {
 const caller = ip || nextIp();
 const res = await worker.fetch(
  new Request("https://nextgit.invalid" + path + (query || ""), { headers: { "CF-Connecting-IP": caller } }),
  env,
 );
 const text = await res.clone().text().catch(() => "");
 return { status: res.status, body: await res.json().catch(() => null), text };
};

// ===========================================================================
// Group 1 - shape + ordering + parent links (the projection law).
// ===========================================================================
{
 const { env, fixtures } = makeEnv();
 const [c0, c1, c2] = fixtures.chain3;
 const r = await get(env, "/commits", "?repo=demo");
 check("1 status 200 ok", r.status === 200 && r.body && r.body.ok === true, J(r.body));
 check("1 echoes repo/ref", r.body && r.body.repo === "demo" && r.body.ref === "main", J(r.body && { repo: r.body.repo, ref: r.body.ref }));
 check("1 body keys exactly [commits, ok, ref, repo]", J(Object.keys(r.body || {}).sort()) === J(["commits", "ok", "ref", "repo"]), J(Object.keys(r.body || {})));
 const commits = (r.body && r.body.commits) || [];
 check("1 commits.length === 3", commits.length === 3, String(commits.length));
 check("1 order is newest-first [c2, c1, c0]", J(commits.map((c) => c.sha)) === J([c2.hash, c1.hash, c0.hash]), J(commits.map((c) => c.sha)));
 const keysOk = commits.length === 3 && commits.every((c) => J(Object.keys(c).sort()) === J(["at", "author", "message", "parents", "sha", "shortSha"]));
 check("1 commit key set exactly [at, author, message, parents, sha, shortSha] (projection law)", keysOk, J(commits.map((c) => Object.keys(c).sort())));
 check("1 shortSha === sha.slice(0, 7)", commits.length === 3 && commits.every((c) => c.shortSha === c.sha.slice(0, 7)), J(commits.map((c) => [c.sha.slice(0, 7), c.shortSha])));
 check("1 author flattened to \"Name <email>\"", commits.length === 3 && commits.every((c) => c.author === "fixture <fixture@test>"), J(commits.map((c) => c.author)));
 const expectedAt = [c2, c1, c0].map((c) => new Date(c.authoredAt * 1000).toISOString());
 check("1 at equals the ISO literal for the fixture authoredAt (seconds->ISO conversion)", J(commits.map((c) => c.at)) === J(expectedAt), J(commits.map((c) => c.at)));
 check("1 at is ISO-8601 UTC (not the raw seconds passthrough)", commits.length === 3 && commits.every((c) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.at)), J(commits.map((c) => c.at)));
 check("1 message is the fixture subject", J(commits.map((c) => c.message)) === J([c2.message, c1.message, c0.message]), J(commits.map((c) => c.message)));
 check("1 parents links [c1] / [c0] / []", J(commits.map((c) => c.parents)) === J([[c1.hash], [c0.hash], []]), J(commits.map((c) => c.parents)));
}

// ===========================================================================
// Group 2 - determinism: two identical GETs deep-equal.
// ===========================================================================
{
 const { env } = makeEnv();
 const a = await get(env, "/commits", "?repo=demo");
 const b = await get(env, "/commits", "?repo=demo");
 check("2 two identical GETs deep-equal commits", J(a.body && a.body.commits) === J(b.body && b.body.commits), J(a.body && a.body.commits && a.body.commits.length) + " vs " + J(b.body && b.body.commits && b.body.commits.length));
}

// ===========================================================================
// Group 3 - ref default (AD-8) + ref selection.
// ===========================================================================
{
 const { env, fixtures } = makeEnv();
 const { d0, d1 } = fixtures;
 const omitted = await get(env, "/commits", "?repo=demo");
 const explicit = await get(env, "/commits", "?repo=demo&ref=main");
 check("3 omitted ref deep-equals ref=main (AD-8 default resolution)", J(omitted.body) === J(explicit.body), J(omitted.body && omitted.body.ref) + " vs " + J(explicit.body && explicit.body.ref));
 const dev = await get(env, "/commits", "?repo=demo&ref=dev");
 check("3 ref=dev returns only the dev chain (ref honoured, not ignored)", dev.status === 200 && J((dev.body && dev.body.commits && dev.body.commits.map((c) => c.sha)) || null) === J([d1.hash, d0.hash]), J(dev.body && dev.body.commits && dev.body.commits.map((c) => c.sha)));
}

// ===========================================================================
// Group 4 - limit legs: default, clamp (reaches the binding), 400s.
// ===========================================================================
{
 const { env, fixtures, fake } = makeEnv();
 const { chain25, chain120 } = fixtures;

 const dflt = await get(env, "/commits", "?repo=agent-1");
 const newest20 = chain25.slice(5).reverse().map((c) => c.hash);
 check("4 absent limit => the 20 newest", (dflt.body && dflt.body.commits && dflt.body.commits.length) === 20 && J(dflt.body.commits.map((c) => c.sha)) === J(newest20), J(dflt.body && dflt.body.commits && dflt.body.commits.length));

 const five = await get(env, "/commits", "?repo=agent-1&limit=5");
 const newest5 = chain25.slice(20).reverse().map((c) => c.hash);
 check("4 limit=5 => the 5 newest", (five.body && five.body.commits && five.body.commits.length) === 5 && J(five.body.commits.map((c) => c.sha)) === J(newest5), J(five.body && five.body.commits && five.body.commits.map((c) => c.sha)));

 fake.logCalls.length = 0;
 const hundred = await get(env, "/commits", "?repo=agent-2&limit=100");
 check("4 limit=100 => 100 returned (120-commit repo)", (hundred.body && hundred.body.commits && hundred.body.commits.length) === 100, String(hundred.body && hundred.body.commits && hundred.body.commits.length));
 check("4 limit=100 reaches the binding as opts.limit=100", fake.logCalls.length === 1 && fake.logCalls[0].limit === 100, J(fake.logCalls));

 fake.logCalls.length = 0;
 const thousand = await get(env, "/commits", "?repo=agent-2&limit=1000");
 check("4 limit=1000 => clamped to 100 returned", (thousand.body && thousand.body.commits && thousand.body.commits.length) === 100, String(thousand.body && thousand.body.commits && thousand.body.commits.length));
 check("4 limit=1000 clamp reaches the binding as opts.limit=100", fake.logCalls.length === 1 && fake.logCalls[0].limit === 100, J(fake.logCalls));

 const { env: probeEnv, probe } = makeProbeEnv("demo");
 for (const bad of ["0", "-1", "abc", "", "1.5", "+5"]) {
  const before = probe.calls;
  const r = await get(probeEnv, "/commits", "?repo=demo&limit=" + bad);
  check(`4 limit=${JSON.stringify(bad)} => 400 invalid limit`, r.status === 400 && r.body && r.body.ok === false && typeof r.body.error === "string" && r.body.error.startsWith("invalid limit:"), `${r.status} ${J(r.body)}`);
  check(`4 limit=${JSON.stringify(bad)} => no Artifacts.get (validation gate pre-read)`, probe.calls === before, `get calls: ${probe.calls - before}`);
 }
}

// ===========================================================================
// Group 5 - 400 repo/ref legs, no pre-read (the validation gate).
// ===========================================================================
{
 const { env, probe } = makeProbeEnv("demo");
 const legs = [
  ["repo absent", "?ref=main"],
  ["charset-invalid repo", "?repo=bad repo!"],
  ["traversal ref (..)", "?repo=demo&ref=../etc"],
  ["leading-slash ref", "?repo=demo&ref=/main"],
 ];
 for (const [label, q] of legs) {
  const before = probe.calls;
  const r = await get(env, "/commits", q);
  check(`5 ${label} => 400`, r.status === 400 && r.body && r.body.ok === false, `${r.status} ${J(r.body)}`);
  check(`5 ${label} => no Artifacts.get (validation gate pre-read)`, probe.calls === before, `get calls: ${probe.calls - before}`);
 }
}

// ===========================================================================
// Group 6 - 403 allowlist: non-demo repo, pre-read.
// ===========================================================================
{
 const { env, probe } = makeProbeEnv("demo");
 const r = await get(env, "/commits", "?repo=notdemo-xyz");
 check("6 non-allowlist repo => 403 repo-not-allowed", r.status === 403 && r.body && r.body.error === "repo-not-allowed", `${r.status} ${J(r.body)}`);
 check("6 403 carries the detail string", typeof (r.body && r.body.detail) === "string" && r.body.detail.includes("notdemo-xyz"), J(r.body && r.body.detail));
 check("6 403 with zero Artifacts.get", probe.calls === 0, `get calls: ${probe.calls}`);
}

// ===========================================================================
// Group 7 - deny mode: 401 BEFORE any repo read (the authorize()
// chokepoint; proves ROUTES registration keeps the route covered).
// ===========================================================================
{
 const { env, probe } = makeProbeEnv(undefined);
 const r = await get(env, "/commits", "?repo=demo");
 check("7 deny mode => 401 unauthorized", r.status === 401 && r.body && r.body.error === "unauthorized", `${r.status} ${J(r.body)}`);
 check("7 401 with zero Artifacts.get (pre-read)", probe.calls === 0, `get calls: ${probe.calls}`);
}

// ===========================================================================
// Group 8 - uniform 404: absent repo / unresolvable ref / log failure.
// ===========================================================================
{
 const { env, fake } = makeEnv();
 const notFound = { ok: false, error: "not-found" };
 const ghost = await get(env, "/commits", "?repo=agent-ghost");
 check("8 allowlisted-but-absent repo => 404 not-found", ghost.status === 404 && J(ghost.body) === J(notFound), J(ghost.body));
 const badRef = await get(env, "/commits", "?repo=demo&ref=nope");
 check("8 unresolvable ref => 404 not-found", badRef.status === 404 && J(badRef.body) === J(notFound), J(badRef.body));
 fake.setLogThrows(true);
 const logFault = await get(env, "/commits", "?repo=demo");
 check("8 binding log() failure => 404 not-found", logFault.status === 404 && J(logFault.body) === J(notFound), J(logFault.body));
 check("8 all three 404 bodies byte-equal", J(ghost.body) === J(badRef.body) && J(badRef.body) === J(logFault.body), `${J(ghost.body)} | ${J(badRef.body)} | ${J(logFault.body)}`);
}

// ===========================================================================
// Group 9 - log-only invariant: happy path 200s with ZERO content reads
// (the instrumented fake records AND throws on readTree/readFile/readBlob).
// ===========================================================================
{
 const { env, fake } = makeEnv();
 const r = await get(env, "/commits", "?repo=demo");
 check("9 happy path 200 (log-only seam)", r.status === 200 && r.body && r.body.ok === true, `${r.status} ${J(r.body)}`);
 check("9 zero readTree/readFile/readBlob calls", fake.contentCalls.length === 0, J(fake.contentCalls));
}

// ===========================================================================
// Group 10 - unbound rate posture (the documented /tree posture): 61 hits
// from one caller all 200; ROUTE_RATE_LIMITS carries no /commits row.
// ===========================================================================
{
 const { env } = makeEnv();
 const ip = "10.9.3.3";
 let all200 = true;
 for (let i = 0; i < 61; i++) {
  const r = await get(env, "/commits", "?repo=demo", ip);
  if (r.status !== 200) { all200 = false; break; }
 }
 check("10 /commits unbound: 61 hits from one caller all 200", all200, "a hit was not 200");
 check("10 ROUTE_RATE_LIMITS carries no /commits row (documented unbound posture)", ROUTE_RATE_LIMITS["/commits"] === undefined, J(ROUTE_RATE_LIMITS["/commits"]));
}

console.log(fails === 0 ? "ALL PASS (" + passes + " checks)" : fails + " FAILURES (" + passes + " passed)");
process.exit(fails === 0 ? 0 : 1);
