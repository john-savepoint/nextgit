#!/usr/bin/env node
// land-hardening.probe.mjs — LIVE probe for the /land hardening (AD-3).
// Scratch chain ONLY: REST-fork demo -> demo-lh-base -> agent-lh-1; asserts:
//  (a) 200 happy path carries evidence {repos,commit,ancestor,heads,foldHash}
//      and the base remote's ref equals evidence.commit; (b) re-land with
//      refreshed reviewed heads -> 409 no-changes; (c) stale reviewed heads ->
//      409 stale (proposal-head + base-head variants); (d) concurrent
//      double-land, same reviewed heads -> exactly one 200 + one 409
//      base-moved; (e) both scratch repos deleted on exit. Never lands into
//      `demo`; never touches agent-1..4. Exit 0 = all green.
// Run: node porting/tests/land-hardening.probe.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = process.env.ARTIFACTS_NAMESPACE ?? "nextgit";
const PLATFORM = process.env.NEXTGIT_PLATFORM_URL ?? "https://nextgit-platform.john-b7d.workers.dev";
const UA = "nextgit-land-hardening-probe/1.0";
const BASE_REPO = "demo-lh-base";
const PROPOSAL_REPO = "agent-lh-1";
const SHA_ZERO = "0".repeat(40);

// Scratch-only guard: the probe must never operate outside its lh-* chain.
if (!BASE_REPO.startsWith("demo-lh-") || !PROPOSAL_REPO.startsWith("agent-lh-")) {
  throw new Error(`scratch-only probe: refusing ${BASE_REPO} / ${PROPOSAL_REPO}`);
}

let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : ` — ${d}`}`); };
const exactKeys = (o, ks) => { const a = Object.keys(o ?? {}).sort(); const w = [...ks].sort(); return a.length === w.length && a.every((k, i) => k === w[i]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// apiToken(): copy fanout.mjs:24-37 (CLOUDFLARE_API_TOKEN env, else wrangler OAuth toml).
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}

// api(method, path, body): fetch against `${apiBase}` with 3 transport retries, 30s timeout;
// returns { status, success: data.success===true, result, raw }. Never retried on HTTP status.
async function api(method, path, body) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers: apiHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err; // transport failure only — HTTP statuses are never retried
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

// fork(src, name): POST `/repos/${src}/fork` { name, default_branch_only: true }; 5 attempts
// with 1.5s*attempt backoff on "already exists"; other errors throw.
async function fork(src, name) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await api("POST", `/repos/${src}/fork`, { name, default_branch_only: true });
    if (r.success) return r.result;
    last = new Error(`fork ${src} -> ${name} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
    if (!/already exists/i.test(last.message)) throw last;
    await sleep(1500 * attempt);
  }
  throw last;
}

// mint(repo): POST `/tokens` { repo, scope: "write", ttl: 3600 } -> result.plaintext.
async function mint(repo) {
  const r = await api("POST", `/tokens`, { repo, scope: "write", ttl: 3600 });
  if (!r.success) throw new Error(`mint ${repo} -> HTTP ${r.status} ${JSON.stringify(r.raw?.errors ?? r.raw)}`);
  return r.result.plaintext;
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const apiHeaders = { Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" };
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const gitAuthEnv = (token) => ({ ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });

async function land(body) {
  const res = await fetch(`${PLATFORM}/land`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  /land -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, json };
}

let dir;
try {
  console.log(`platform ${PLATFORM}\nscratch  ${BASE_REPO} (base) / ${PROPOSAL_REPO} (proposal)\n`);
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    const r = await api("DELETE", `/repos/${name}`);
    console.log(`pre-clean DELETE ${name}: HTTP ${r.status}`);
  }
  await fork("demo", BASE_REPO);
  await fork(BASE_REPO, PROPOSAL_REPO);

  const proposalToken = await mint(PROPOSAL_REPO);
  const baseEnv = gitAuthEnv(await mint(BASE_REPO));
  const lsBase = () => execFileSync("git", ["ls-remote", `${gitBase}/${BASE_REPO}.git`, "refs/heads/main"], { env: baseEnv, encoding: "utf8" }).trim().split("\t")[0];

  dir = mkdtempSync(join(tmpdir(), "nextgit-lh-probe-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: gitAuthEnv(proposalToken), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("clone", `${gitBase}/${PROPOSAL_REPO}.git`, dir);
  git("config", "user.name", "land-hardening-probe");
  git("config", "user.email", "probe@nextgit.dev");
  const H0 = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "lh-probe-1.txt"), `land-hardening probe ${new Date().toISOString()}\n`);
  git("add", "-A"); git("commit", "-m", "probe: edit 1"); git("push", "origin", "HEAD:refs/heads/main");
  const C1 = git("rev-parse", "HEAD");
  console.log(`H0 ${H0}\nC1 ${C1}\n`);

  // (a) happy path: 200 carries evidence; the commit is a real reference.
  console.log("(a) land with reviewed heads");
  const a = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], baseRef: "main", ref: "main", reviewed: { baseHead: H0, heads: { [PROPOSAL_REPO]: C1 } } });
  const ev = a.json?.evidence ?? {};
  check("(a) 200 ok", a.status === 200 && a.json?.ok === true);
  check("(a) evidence keys", exactKeys(ev, ["repos", "commit", "ancestor", "heads", "foldHash"]), JSON.stringify(Object.keys(ev)));
  check("(a) evidence.repos", JSON.stringify(ev.repos) === JSON.stringify([PROPOSAL_REPO]));
  check("(a) evidence.commit === landed.commit", !!ev.commit && ev.commit === a.json?.landed?.commit);
  check("(a) ancestor = fork point H0", ev.ancestor?.[PROPOSAL_REPO] === H0, JSON.stringify(ev.ancestor));
  check("(a) heads = fold inputs", ev.heads?.base === H0 && ev.heads?.repos?.[PROPOSAL_REPO] === C1, JSON.stringify(ev.heads));
  check("(a) foldHash sha256 hex", /^[0-9a-f]{64}$/.test(String(ev.foldHash)), String(ev.foldHash));
  check("(a) landed.files has lh-probe-1.txt", Array.isArray(a.json?.landed?.files) && a.json.landed.files.includes("lh-probe-1.txt"));
  const C2 = ev.commit;
  check("(a) base remote ref === evidence.commit", (await lsBase()) === C2);

  // (b) re-land same proposal, refreshed reviewed heads -> no-changes.
  console.log("(b) re-land (refreshed reviewed heads)");
  const b = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1 } } });
  check("(b) 409 no-changes", b.status === 409 && b.json?.error === "no-changes", JSON.stringify(b.json));

  // (c) stale reviewed heads refuse before any fold (two variants).
  console.log("(c) stale reviewed heads");
  const c1 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { heads: { [PROPOSAL_REPO]: SHA_ZERO } } });
  const c2 = await land({ base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: SHA_ZERO, heads: { [PROPOSAL_REPO]: C1 } } });
  check("(c) stale proposal head -> 409 stale", c1.status === 409 && c1.json?.error === "stale", JSON.stringify(c1.json));
  check("(c) stale base head -> 409 stale", c2.status === 409 && c2.json?.error === "stale", JSON.stringify(c2.json));
  check("(c) base unmoved by refusals", (await lsBase()) === C2);

  // (d) concurrent double-land: same reviewed heads, two requests in flight.
  writeFileSync(join(dir, "lh-probe-2.txt"), `land-hardening probe 2 ${new Date().toISOString()}\n`);
  git("add", "-A"); git("commit", "-m", "probe: edit 2"); git("push", "origin", "HEAD:refs/heads/main");
  const C1b = git("rev-parse", "HEAD");
  console.log(`C1b ${C1b}\n(d) concurrent double-land`);
  const raceBody = { base: BASE_REPO, repos: [PROPOSAL_REPO], reviewed: { baseHead: C2, heads: { [PROPOSAL_REPO]: C1b } } };
  const [d1, d2] = await Promise.all([land(raceBody), land(raceBody)]);
  const winners = [d1, d2].filter((r) => r.status === 200 && r.json?.ok === true);
  const losers = [d1, d2].filter((r) => !(r.status === 200 && r.json?.ok === true));
  check("(d) exactly one 200", winners.length === 1, JSON.stringify([d1.status, d2.status]));
  check("(d) exactly one loser", losers.length === 1, JSON.stringify([d1.status, d2.status]));
  check("(d) loser is 409 base-moved", losers[0]?.status === 409 && losers[0]?.json?.error === "base-moved", JSON.stringify(losers[0]?.json));
  const C3 = winners[0]?.json?.evidence?.commit;
  check("(d) base advanced to the winner", !!C3 && C3 !== C2 && (await lsBase()) === C3);
} catch (err) {
  fails++;
  console.error(`PROBE ERROR — ${err?.stack ?? err}`);
} finally {
  for (const name of [PROPOSAL_REPO, BASE_REPO]) {
    try {
      const r = await api("DELETE", `/repos/${name}`);
      console.log(`cleanup DELETE ${name}: HTTP ${r.status}`);
      // 202 = deletion accepted (the Artifacts API answers 202 async); 404 = already gone.
      check(`(e) deleted ${name}`, r.status === 200 || r.status === 202 || r.status === 404, `HTTP ${r.status}`);
    } catch (err) {
      check(`(e) deleted ${name}`, false, String(err));
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPASS — land-hardening probe green" : `\nFAIL — ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
