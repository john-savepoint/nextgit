#!/usr/bin/env bun
// Contract suite: incremental land under the push budget
// (order nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap).
// Run: bun porting/tests/land-incremental.test.mjs   (exit 0 = pass)
//
// Real construction: pushLand is imported and called directly against an
// in-process git smart-HTTP server (git http-backend, the asset-gc.test.mjs
// idiom), so the clone / commit / push run for real over the wire protocol
// and the landed history is read back with the git CLI. No module mocks, no
// source grep, no live Artifacts fixtures (demo/agent-1..5 are never
// touched). Full-suite safe: temp dirs only, ephemeral ports.
//
// The contract this suite pins (platform/src/land.ts pushLand):
//   (a) the fold lands in bounded increments — a 3-proposal fold of
//       10 files (4 + 4 + 2, one group per proposal) produces exactly
//       3 incremental commits, each carrying the pinned land message;
//   (b) the landed TREE is the fold's tree whatever the incrementing —
//       deep-equal (same git tree sha) to the same fold applied in ONE
//       CLI commit, and identical across two independently landed repos;
//   (c) a fold over the push budget throws PushBudgetError and performs
//       ZERO wire calls (the instrumented server counts requests and the
//       suite fails if one arrives) — fail closed, never a 64 MiB push;
//   (d) AD-3 is intact with increments: a moved base head refuses the
//       land (BaseMovedError) before the first push, and a stale
//       expectedBaseHead is refused by the per-increment push witness;
//   (e) the landing-decision note is attached to the FINAL commit and
//       mirrored, and the push-budget log line is content-free
//       (byte counts only — STRIDE-I1/NFR-3);
//   (f) the land stays all-or-nothing across increments: a failure from
//       increment 2 on — the push dies on the wire, or the per-increment
//       witness refuses it after the pack already reached the remote —
//       rewinds the base ref to the head the land found, so no partial
//       fold survives without an evidence record. When the rewind itself
//       cannot land, the ORIGINAL error still propagates and the failure
//       is logged content-free (`land-revert-failed`, hashes only — AD-4).
//
// Budget/per-increment seam: platform/src/push-budget.ts
// (PUSH_BUDGET_BYTES = 16 MiB), LAND_INCREMENT_GROUP = 4.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { pushLand, LAND_INCREMENT_GROUP } from "../../platform/src/land.ts";
import { PUSH_BUDGET_BYTES, PushBudgetError } from "../../platform/src/push-budget.ts";

let fails = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// In-process git smart-HTTP server (git http-backend) — the push seam.
// Each environment gets its OWN bare repo + port, and the handler counts
// every request (the wire-call oracle for the fail-closed group).
// ---------------------------------------------------------------------------
const repoDir = mkdtempSync(join(tmpdir(), "land-incremental-"));
function sh(args, cwd = repoDir) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function makeGitServer(files, opts = {}) {
  const dir = mkdtempSync(join(repoDir, "srv-"));
  const bareDir = join(dir, "demo.git");
  const workDir = join(dir, "work");
  mkdirSync(workDir, { recursive: true });
  const w = (args) => sh(args, workDir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);
  for (const [path, text] of Object.entries(files)) {
    const abs = join(workDir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  w(["add", "-A"]);
  w(["commit", "-qm", "base"]);
  sh(["clone", "--bare", workDir, bareDir], dir);
  sh(["-C", bareDir, "symbolic-ref", "HEAD", "refs/heads/main"], dir);
  sh(["-C", bareDir, "config", "http.receivepack", "true"], dir);

  const wire = { requests: [], pushes: 0 };
  const server = createServer((req, res) => {
    wire.requests.push(`${req.method} ${req.url}`);
    // Push gate: the receive-pack count is always kept (the wire oracle for the
    // revert tests, valid with or without a gate), and when a gate is supplied
    // the push it rejects never reaches git http-backend — so the push dies on
    // the wire exactly as an Artifacts 5xx would, leaving the client untouched.
    const isPush = req.method === "POST" && new URL(req.url, "http://x").pathname.endsWith("/git-receive-pack");
    if (isPush) wire.pushes += 1;
    if (isPush && opts.pushGate) {
      const status = opts.pushGate(wire.pushes);
      if (status) {
        res.writeHead(status, { "content-type": "text/plain" });
        res.end("injected-push-failure");
        return;
      }
    }
    const url = `http://localhost${req.url}`;
    const backend = spawn("git", ["http-backend"], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_PROJECT_ROOT: dir,
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
  return { dir, bareDir, server, wire };
}

async function startGitServer(files, opts) {
  const g = makeGitServer(files, opts);
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  g.port = g.server.address().port;
  g.remote = `http://127.0.0.1:${g.port}/demo.git`;
  return g;
}

/** Current tip of the served bare repo's main (the observable landed state). */
function serverMain(g) {
  return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main"], g.dir).trim();
}

/** Commits on the landed branch (the base commit included). */
function serverCommitCount(g) {
  return Number(sh(["-C", g.bareDir, "rev-list", "--count", "refs/heads/main"], g.dir).trim());
}

/** Subjects of the landed branch, newest first. */
function serverSubjects(g) {
  return sh(["-C", g.bareDir, "log", "--format=%s", "refs/heads/main"], g.dir).split("\n").filter(Boolean);
}

/** The landed tree's git tree sha (the fold's exact resulting tree). */
function serverTree(g) {
  return sh(["-C", g.bareDir, "rev-parse", "refs/heads/main^{tree}"], g.dir).trim();
}

/** A file's bytes on the landed branch. */
function serverShow(g, path) {
  const r = spawnSync("git", ["-C", g.bareDir, "show", `refs/heads/main:${path}`], { cwd: g.dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

// ---------------------------------------------------------------------------
// The single-commit oracle: apply the same fold with the git CLI in ONE
// commit and return that tree sha. PushLand's landed tree must equal it
// exactly, whatever the incrementing.
// ---------------------------------------------------------------------------
function cliFoldTree(baseFiles, foldFiles) {
  const dir = mkdtempSync(join(repoDir, "oracle-"));
  const w = (args) => sh(args, dir);
  w(["init", "-q", "-b", "main"]);
  w(["config", "user.email", "fixture@test"]);
  w(["config", "user.name", "fixture"]);
  for (const [path, text] of Object.entries(baseFiles)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  w(["add", "-A"]);
  w(["commit", "-qm", "base"]);
  for (const f of foldFiles) {
    const abs = join(dir, f.path);
    if (f.action === "delete") {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.merged);
  }
  w(["add", "-A"]);
  w(["commit", "-qm", "fold"]);
  return w(["rev-parse", "HEAD^{tree}"]).trim();
}

// ---------------------------------------------------------------------------
// Fixture: a 3-proposal fold. Each proposal contributes at most
// LAND_INCREMENT_GROUP files, so the increment plan is exactly one
// increment per proposal (4 + 4 + 2 = 10 files).
// ---------------------------------------------------------------------------
const BASE_FILES = { "src/a.ts": "export const a = 1;\nexport const keep = true;\n" };
const REPOS = ["agent-1", "agent-2", "agent-3"];

const PROPOSAL_FILES = [
  [ // agent-1 — 4 files
    { path: "src/p1/f1.ts", text: "export const p1f1 = 1;\n" },
    { path: "src/p1/f2.ts", text: "export const p1f2 = 2;\n" },
    { path: "src/p1/f3.ts", text: "export const p1f3 = 3;\n" },
    { path: "src/p1/f4.ts", text: "export const p1f4 = 4;\n" },
  ],
  [ // agent-2 — 4 files, plus a delete of the base file
    { path: "src/p2/g1.ts", text: "export const p2g1 = 1;\n" },
    { path: "src/p2/g2.ts", text: "export const p2g2 = 2;\n" },
    { path: "src/p2/g3.ts", text: "export const p2g3 = 3;\n" },
    { path: "src/a.ts", text: "export const a = 2;\nexport const keep = true;\n" },
  ],
  [ // agent-3 — 2 files
    { path: "src/p3/h1.ts", text: "export const p3h1 = 1;\n" },
    { path: "src/p3/h2.ts", text: "export const p3h2 = 2;\n" },
  ],
];

/** The folded file list the worker hands pushLand: proposals in order. */
const FOLD_FILES = PROPOSAL_FILES.flat().map((f) => ({
  path: f.path,
  action: "write",
  result: "merged",
  merged: f.text,
}));

console.log(
  `fixture: ${FOLD_FILES.length} folded files over ${REPOS.length} proposals, LAND_INCREMENT_GROUP=${LAND_INCREMENT_GROUP}`,
);

// ---------------------------------------------------------------------------
// 1. Incremental commits: the 3-proposal fold lands as 3 commits.
// ---------------------------------------------------------------------------
{
  const g = await startGitServer(BASE_FILES);
  const base = serverMain(g);
  check("1 server seeded at base", base.length === 40, base);
  check("1b base is a single commit", serverCommitCount(g) === 1, String(serverCommitCount(g)));

  try {
    const result = await pushLand({
      remote: g.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base,
      readBaseHead: async () => serverMain(g),
    });

    const count = serverCommitCount(g);
    check(
      "1c 10-file / 3-proposal fold lands 3 incremental commits on top of base",
      count === 4,
      `commits=${count} (expected base + 3: 4+4+2 files, LAND_INCREMENT_GROUP=${LAND_INCREMENT_GROUP})`,
    );
    check(
      "1d every landed commit carries the pinned land message",
      serverSubjects(g).filter((s) => s === `land(${REPOS.join(",")}): fold proposal(s)`).length === 3,
      JSON.stringify(serverSubjects(g)),
    );
    check("1e pushLand returns the FINAL commit", result.commit === serverMain(g), `${result.commit} vs ${serverMain(g)}`);
    check("1f pushLand returns the remote it pushed to", result.remote === g.remote, result.remote);

    // (b) tree parity with the single-commit CLI oracle.
    const expectedTree = cliFoldTree(BASE_FILES, FOLD_FILES);
    check(
      "2 landed tree deep-equals the same fold applied in ONE CLI commit",
      serverTree(g) === expectedTree,
      `${serverTree(g)} vs ${expectedTree}`,
    );
    check(
      "2b modified file carries the fold text",
      serverShow(g, "src/a.ts") === "export const a = 2;\nexport const keep = true;\n",
      JSON.stringify(serverShow(g, "src/a.ts")),
    );
    check(
      "2c added file from a later increment is present",
      serverShow(g, "src/p3/h2.ts") === "export const p3h2 = 2;\n",
      JSON.stringify(serverShow(g, "src/p3/h2.ts")),
    );
    check("2d base-only file survives the increments", serverShow(g, "src/a.ts") !== null, "src/a.ts");
  } catch (e) {
    check("1 land threw", false, String(e?.stack ?? e));
  }
}

// ---------------------------------------------------------------------------
// 2. Parity across independent lands: the same fold on a second repo
//    yields the same landed tree (increments are history, not result).
// ---------------------------------------------------------------------------
{
  const g2 = await startGitServer(BASE_FILES);
  const base2 = serverMain(g2);
  try {
    await pushLand({
      remote: g2.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base2,
      readBaseHead: async () => serverMain(g2),
    });
    const oracle = cliFoldTree(BASE_FILES, FOLD_FILES);
    check("3 second land's tree equals the CLI oracle too", serverTree(g2) === oracle, `${serverTree(g2)} vs ${oracle}`);
    check("3b second land is also 3 increments", serverCommitCount(g2) === 4, String(serverCommitCount(g2)));
  } catch (e) {
    check("3 land threw", false, String(e?.stack ?? e));
  }
}

// ---------------------------------------------------------------------------
// 3. A fold within one increment still lands as ONE commit (the
//    pre-existing single-commit behavior for small folds).
// ---------------------------------------------------------------------------
{
  const g3 = await startGitServer(BASE_FILES);
  const base3 = serverMain(g3);
  const small = FOLD_FILES.slice(0, LAND_INCREMENT_GROUP);
  try {
    await pushLand({
      remote: g3.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: ["agent-1"],
      files: small,
      expectedBaseHead: base3,
      readBaseHead: async () => serverMain(g3),
    });
    check("4 a <= LAND_INCREMENT_GROUP fold lands exactly one commit", serverCommitCount(g3) === 2, String(serverCommitCount(g3)));
    check("4b its tree equals the CLI oracle for that subset", serverTree(g3) === cliFoldTree(BASE_FILES, small), serverTree(g3));
  } catch (e) {
    check("4 land threw", false, String(e?.stack ?? e));
  }
}

// ---------------------------------------------------------------------------
// 4. Fail closed over the budget: PushBudgetError, ZERO wire calls.
//    The wire oracle is the instrumented server's request log — a push
//    that reached the remote would be recorded there.
// ---------------------------------------------------------------------------
{
  const g4 = await startGitServer(BASE_FILES);
  const base4 = serverMain(g4);
  // Estimated bytes = length x 2, so this single file estimates 2 bytes
  // over the budget.
  const overBudgetText = "x".repeat(PUSH_BUDGET_BYTES / 2 + 1);
  let threw = null;
  try {
    await pushLand({
      remote: g4.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: ["agent-1"],
      files: [{ path: "src/huge.bin.txt", action: "write", result: "merged", merged: overBudgetText }],
      expectedBaseHead: base4,
      readBaseHead: async () => serverMain(g4),
    });
  } catch (e) {
    threw = e;
  }
  check("5 an over-budget fold throws PushBudgetError", threw instanceof PushBudgetError, threw?.constructor?.name ?? "no throw");
  check("5b the error carries the estimate, not content", threw instanceof PushBudgetError && threw.estimatedBytes > PUSH_BUDGET_BYTES, String(threw?.estimatedBytes));
  check("5c no git request reached the remote (fail closed before the wire)", g4.wire.requests.length === 0, JSON.stringify(g4.wire.requests.slice(0, 4)));
  check("5d the remote ref never moved", serverMain(g4) === base4, `${serverMain(g4)} vs ${base4}`);
  check("5e no commit was created", serverCommitCount(g4) === 1, String(serverCommitCount(g4)));
}

// ---------------------------------------------------------------------------
// 5. AD-3 with increments.
// ---------------------------------------------------------------------------
{
  // (d1) the base head moved before the first push: readBaseHead reports a
  // different head than the reviewed one -> BaseMovedError, no push.
  const g5 = await startGitServer(BASE_FILES);
  const base5 = serverMain(g5);
  let threw = null;
  try {
    await pushLand({
      remote: g5.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base5,
      readBaseHead: async () => "f".repeat(40),
    });
  } catch (e) {
    threw = e;
  }
  check("6 a moved base head refuses the land (BaseMovedError)", threw?.name === "BaseMovedError", threw?.name ?? "no throw");

  // (d2) a stale expectedBaseHead that the binding read agrees with is
  // refused by the per-increment push witness (server discovery).
  const g6 = await startGitServer(BASE_FILES);
  const base6 = serverMain(g6);
  const stale = "0".repeat(40);
  let threw2 = null;
  try {
    await pushLand({
      remote: g6.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: stale,
      readBaseHead: async () => stale,
    });
  } catch (e) {
    threw2 = e;
  }
  check("6b a stale expected base head is refused by the push witness", threw2?.name === "BaseMovedError", threw2?.name ?? "no throw");
  // The witness fires AFTER the refused increment's pack reached the remote, so
  // the refusal has to rewind the base ref itself: the branch holds the head the
  // land found again, and exactly one revert push was attempted.
  check(
    "6c the refusal rewinds the base ref to the head the land found (no partial fold)",
    serverMain(g6) === base6 && serverCommitCount(g6) === 1,
    `main=${serverMain(g6)} vs ${base6}, commits=${serverCommitCount(g6)}`,
  );
  check("6d exactly one revert push followed the witness refusal", g6.wire.pushes === 2, `receive-pack requests=${g6.wire.pushes}`);
}

// ---------------------------------------------------------------------------
// 6. The landing-decision note + the content-free budget log.
// ---------------------------------------------------------------------------
{
  const g7 = await startGitServer(BASE_FILES);
  const base7 = serverMain(g7);
  const logged = [];
  const realLog = console.log;
  try {
    console.log = (...args) => {
      logged.push(args.map(String).join(" "));
      realLog(...args);
    };
    const result = await pushLand({
      remote: g7.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base7,
      readBaseHead: async () => serverMain(g7),
      landingNote: true,
    });
    // The note is attached to the FINAL commit and mirrored: the Artifacts
    // binding cannot resolve refs/notes/*, so the note travels on the
    // `nextgit-notes` branch (CONTRACT "Notes mirror") — read it there.
    const noteAt = (sha) => {
      for (const path of [sha, `${sha.slice(0, 2)}/${sha.slice(2)}`]) {
        const r = spawnSync("git", ["-C", g7.bareDir, "show", `refs/heads/nextgit-notes:${path}`], { cwd: g7.dir, encoding: "utf8" });
        if (r.status === 0) return r.stdout;
      }
      return null;
    };
    const note = noteAt(result.commit);
    const parsed = note === null ? null : JSON.parse(note);
    check("7 the landing note rides the mirror branch at the final commit", parsed !== null, String(note));
    check("7 landing note records the final commit", parsed?.commit === result.commit, `${parsed?.commit} vs ${result.commit}`);
    check("7b landing note records the repos", JSON.stringify(parsed?.repos) === JSON.stringify(REPOS), JSON.stringify(parsed?.repos));
    check("7c landing note carries a fold hash", typeof parsed?.foldHash === "string" && parsed.foldHash.length > 0, String(parsed?.foldHash));
    const mirror = spawnSync("git", ["-C", g7.bareDir, "rev-parse", "refs/heads/nextgit-notes"], { cwd: g7.dir, encoding: "utf8" });
    check("7d notes mirror branch exists on the remote", mirror.status === 0, mirror.stderr);
    check("7e landed tree is still the fold's tree with a note present", serverTree(g7) === cliFoldTree(BASE_FILES, FOLD_FILES), serverTree(g7));
  } catch (e) {
    check("7 land threw", false, String(e?.stack ?? e));
  } finally {
    console.log = realLog;
  }
  const budgetLines = logged.filter((l) => l.startsWith("push-budget "));
  check("8 the push-budget seam logs one line", budgetLines.length === 1, JSON.stringify(budgetLines));
  const payload = budgetLines[0] ? budgetLines[0].slice("push-budget ".length) : "{}";
  const parsedLog = JSON.parse(payload);
  check("8b the log line carries byte counts and counts only", typeof parsedLog.estimatedBytes === "number" && typeof parsedLog.increments === "number", payload);
  check("8c the estimate is under the budget", parsedLog.estimatedBytes <= PUSH_BUDGET_BYTES, String(parsedLog.estimatedBytes));
  check("8d the log is content-free (no paths, no fold text)", !/src\/|export const|x{8}/.test(payload), payload);
}

// ---------------------------------------------------------------------------
// 9. A mid-increment push failure is compensated — the all-or-nothing land.
//    The close is the gate: push 2 (the SECOND increment) dies on the wire
//    while increment 1 is already durable on the base branch. The suite proves
//    the ref comes back to the head the land found, so no partial fold survives
//    without the landing note that references it (FR-18).
// ---------------------------------------------------------------------------
{
  const g8 = await startGitServer(BASE_FILES, { pushGate: (n) => (n === 2 ? 500 : 0) });
  const base8 = serverMain(g8);
  let threw = null;
  try {
    await pushLand({
      remote: g8.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base8,
      readBaseHead: async () => serverMain(g8),
    });
  } catch (e) {
    threw = e;
  }
  check("9 a mid-increment push failure refuses the land", threw !== null, threw === null ? "no throw" : "");
  check("9b the base ref is back at the head the land found", serverMain(g8) === base8, `${serverMain(g8)} vs ${base8}`);
  check("9c the landed branch is base-only again (no partial fold)", serverCommitCount(g8) === 1, `commits=${serverCommitCount(g8)}`);
  check("9d exactly one revert push followed the refused increment", g8.wire.pushes === 3, `receive-pack requests=${g8.wire.pushes}`);
}

// ---------------------------------------------------------------------------
// 9e. A revert that cannot land: the partial fold stays put (the operator's
//     problem, reported honestly), the ORIGINAL wire error still propagates —
//     the revert must never mask the failure that caused it — and the revert
//     failure is logged content-free (AD-4/NFR-5).
// ---------------------------------------------------------------------------
{
  const g9 = await startGitServer(BASE_FILES, { pushGate: (n) => (n === 2 ? 500 : n === 3 ? 503 : 0) });
  const base9 = serverMain(g9);
  const logged = [];
  const realLog = console.log;
  let threw = null;
  try {
    console.log = (...args) => {
      logged.push(args.map(String).join(" "));
      realLog(...args);
    };
    await pushLand({
      remote: g9.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base9,
      readBaseHead: async () => serverMain(g9),
    });
  } catch (e) {
    threw = e;
  } finally {
    console.log = realLog;
  }
  const revertLines = logged.filter((l) => l.startsWith("land-revert-failed "));
  check("9e a revert that cannot land is logged", revertLines.length === 1, JSON.stringify(revertLines));
  check(
    "9f the revert log is content-free (no paths, no fold text)",
    revertLines[0] !== undefined && !/src\/|export const|x{8}/.test(revertLines[0].slice("land-revert-failed ".length)),
    String(revertLines[0]),
  );
  check(
    "9g the ORIGINAL wire error propagates, never the revert's",
    String(threw?.message ?? "").includes("500") && !String(threw?.message ?? "").includes("503"),
    String(threw?.message),
  );
  check(
    "9h the partial fold stays visible when the revert fails",
    serverMain(g9) !== base9 && serverCommitCount(g9) === 2,
    `main=${serverMain(g9)} vs ${base9}, commits=${serverCommitCount(g9)}`,
  );
  check("9i the failed revert was attempted exactly once", g9.wire.pushes === 3, `receive-pack requests=${g9.wire.pushes}`);
}

// ---------------------------------------------------------------------------
// 10. The revert is bounded to actual partial lands: when the FIRST increment's
//     push dies on the wire, nothing of the fold reached the remote, so the ref
//     is not touched — no revert push, no clobbering of a ref we never moved.
// ---------------------------------------------------------------------------
{
  const g10 = await startGitServer(BASE_FILES, { pushGate: (n) => (n === 1 ? 500 : 0) });
  const base10 = serverMain(g10);
  let threw = null;
  try {
    await pushLand({
      remote: g10.remote,
      token: "fake-write-token",
      baseRef: "main",
      repos: REPOS,
      files: FOLD_FILES,
      expectedBaseHead: base10,
      readBaseHead: async () => serverMain(g10),
    });
  } catch (e) {
    threw = e;
  }
  check("10 a first-increment wire failure still refuses the land", threw !== null, threw === null ? "no throw" : "");
  check("10b no revert push is attempted when nothing landed", g10.wire.pushes === 1, `receive-pack requests=${g10.wire.pushes}`);
  check("10c the base ref is untouched", serverMain(g10) === base10 && serverCommitCount(g10) === 1, `main=${serverMain(g10)} vs ${base10}, commits=${serverCommitCount(g10)}`);
}

rmSync(repoDir, { recursive: true, force: true });
console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
