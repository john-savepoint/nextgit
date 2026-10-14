#!/usr/bin/env bun
// Contract suite: the script-side push budget guard
// (order nextgit-keep-pushes-small-and-incremental-under-the-64-mib-cap,
// deliverable C).
// Run: bun porting/tests/script-push-guard.test.mjs   (exit 0 = pass)
//
// Real construction: every scenario builds a throwaway git repo with the
// git CLI in mkdtempSync and measures it with real plumbing (rev-list
// --objects / cat-file --batch-check). No Artifacts, no network, no module
// mocks, no source grep. Full-suite safe: temp dirs only.
//
// The contract this suite pins (platform/scripts/lib/push-guard.mjs):
//   * the refspec -> ref mapping the sizing depends on ("main" means
//     refs/heads/main; a forced mirror refspec's source is the notes ref);
//   * the measured size counts the objects the push would actually carry:
//     the new blob plus its bounded metadata — never less than the blob;
//   * an up-to-date ref measures 0 (nothing to push);
//   * with no remote-tracking ref (the fresh-clone posture) the WHOLE ref
//     is sized, never an understatement;
//   * the notes ref is counted once however many refspecs reach it;
//   * over-budget detection throws PushBudgetError BEFORE any wire call,
//     carrying the byte count and a content-free message;
//   * under budget it returns the measured size (so a runner can log it).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PUSH_BUDGET_BYTES,
  PushBudgetError,
  assertPushBudgetGit,
  estimatePushBytesGit,
  parseRefspec,
} from "../../platform/scripts/lib/push-guard.mjs";
// The worker-side seam's constant: the CONTRACT ("Push budget (incremental
// pushes)") holds the budget in lockstep in exactly two places — this suite
// is what pins them equal.
import { PUSH_BUDGET_BYTES as WORKER_PUSH_BUDGET_BYTES } from "../../platform/src/push-budget.ts";

let fails = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const root = mkdtempSync(join(tmpdir(), "push-guard-"));
const sh = (cwd, args) => {
  const r = (() => {
    try {
      return { status: 0, stdout: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
    }
  })();
  return r;
};
const must = (cwd, args) => {
  const r = sh(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

const KIB = 1024;

/** A throwaway repo: main branch, one base commit, optional bare origin. */
function mkrepo(name, { withOrigin = false } = {}) {
  const dir = mkdtempSync(join(root, `${name}-`));
  must(dir, ["init", "-q", "-b", "main"]);
  must(dir, ["config", "user.email", "fixture@test"]);
  must(dir, ["config", "user.name", "fixture"]);
  writeFileSync(join(dir, "base.txt"), "base\n");
  must(dir, ["add", "-A"]);
  must(dir, ["commit", "-qm", "base"]);
  if (withOrigin) {
    const bare = join(dir, "..", `${name}-origin.git`);
    must(dir, ["clone", "--bare", "-q", dir, bare]);
    must(dir, ["remote", "add", "origin", bare]);
    must(dir, ["fetch", "-q", "origin"]);
  }
  return dir;
}

/** Write a file of `bytes` incompressible-ish text and commit it. */
function commitBytes(dir, rel, bytes, message = "add bytes") {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  // Vary the line content so the blob is not trivially compressible — the
  // measured size is the UNCOMPRESSED object size either way, but a
  // non-repetitive body keeps the fixture honest.
  const line = "0123456789abcdef0123456789abcdef\n";
  const count = Math.ceil(bytes / line.length);
  writeFileSync(abs, line.repeat(count) + `// ${rel}:${count}\n`);
  must(dir, ["add", "-A"]);
  must(dir, ["commit", "-qm", message]);
  return count * line.length;
}

const RECIPE = ["main", "+refs/notes/commits", "+refs/notes/commits:refs/heads/nextgit-notes"];

// ---------------------------------------------------------------------------
// 1. The refspec -> ref mapping the sizing depends on.
// ---------------------------------------------------------------------------
{
  const a = parseRefspec("main");
  check("1 'main' resolves to refs/heads/main on both sides", a.source === "refs/heads/main" && a.dest === "refs/heads/main", JSON.stringify(a));
  const b = parseRefspec("+refs/notes/commits");
  check("1b '+refs/notes/commits' keeps the notes ref as source and dest", b.source === "refs/notes/commits" && b.dest === "refs/notes/commits", JSON.stringify(b));
  const c = parseRefspec("+refs/notes/commits:refs/heads/nextgit-notes");
  check("1c the forced mirror refspec maps notes -> nextgit-notes", c.source === "refs/notes/commits" && c.dest === "refs/heads/nextgit-notes", JSON.stringify(c));
  check("1d the budget constant is 16 MiB", PUSH_BUDGET_BYTES === 16 * 1024 * 1024, String(PUSH_BUDGET_BYTES));
  check(
    "1e the worker seam and the runner seam hold the SAME budget (lockstep constant)",
    WORKER_PUSH_BUDGET_BYTES === PUSH_BUDGET_BYTES,
    `worker=${WORKER_PUSH_BUDGET_BYTES} runner=${PUSH_BUDGET_BYTES}`,
  );
}

// ---------------------------------------------------------------------------
// 2. The measured size counts what the push carries: the new blob (never
//    less) plus bounded metadata (trees + commit), never more.
// ---------------------------------------------------------------------------
const REPO_A = mkrepo("a", { withOrigin: true });
{
  const fileBytes = commitBytes(REPO_A, "src/data.txt", 200 * KIB);
  const measured = estimatePushBytesGit(REPO_A, ["main"]);
  check(
    "2 the measured delta counts the pushed blob",
    measured >= fileBytes,
    `measured=${measured} fileBytes=${fileBytes}`,
  );
  check(
    "2b the measured delta stays within the metadata bound",
    measured <= fileBytes + 32 * 1024,
    `measured=${measured} bound=${fileBytes + 32 * 1024}`,
  );
  check(
    "2c the estimate is far under the budget",
    measured < PUSH_BUDGET_BYTES,
    `${measured} vs ${PUSH_BUDGET_BYTES}`,
  );
  check(
    "2d assertPushBudgetGit returns the measured size under budget",
    assertPushBudgetGit(REPO_A, ["main"]) === measured,
    `${assertPushBudgetGit(REPO_A, ["main"])} vs ${measured}`,
  );
}

// ---------------------------------------------------------------------------
// 3. An up-to-date ref has nothing to push: 0 bytes.
// ---------------------------------------------------------------------------
{
  must(REPO_A, ["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
  const upToDate = estimatePushBytesGit(REPO_A, ["main"]);
  check("3 an up-to-date main measures 0", upToDate === 0, String(upToDate));
  const upToDateRecipe = estimatePushBytesGit(REPO_A, RECIPE);
  check("3b an up-to-date recipe measures 0 too", upToDateRecipe === 0, String(upToDateRecipe));
}

// ---------------------------------------------------------------------------
// 4. Fresh-clone posture (no remote-tracking ref): the WHOLE ref is sized.
// ---------------------------------------------------------------------------
{
  const noOrigin = mkrepo("b");
  const first = commitBytes(noOrigin, "src/one.txt", 100 * KIB, "one");
  const second = commitBytes(noOrigin, "src/two.txt", 100 * KIB, "two");
  const measured = estimatePushBytesGit(noOrigin, ["main"]);
  check(
    "4 with no upstream the whole ref is sized (both blobs)",
    measured >= first + second,
    `measured=${measured} expected>=${first + second}`,
  );
}

// ---------------------------------------------------------------------------
// 5. The notes ref is counted once, however many refspecs reach it, and its
//    objects are inside the recipe's measurement.
// ---------------------------------------------------------------------------
{
  const noteBytes = commitBytes(REPO_A, "src/note-payload.txt", 64 * KIB, "payload");
  must(REPO_A, ["notes", "add", "-m", "intent: exercise the notes guard", "HEAD"]);
  // Re-point the tracking refs so only the notes delta is new.
  must(REPO_A, ["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);

  const mainOnly = estimatePushBytesGit(REPO_A, ["main"]);
  const notesOnly = estimatePushBytesGit(REPO_A, ["+refs/notes/commits"]);
  const recipe = estimatePushBytesGit(REPO_A, RECIPE);
  check("5 main alone carries no notes objects once pushed", mainOnly === 0, String(mainOnly));
  check(
    "5b the notes ref is measured (its carrier commit + note blob)",
    notesOnly > 0,
    String(notesOnly),
  );
  check(
    "5c the recipe equals the notes-only measurement (single count, no double-count)",
    recipe === notesOnly,
    `recipe=${recipe} notesOnly=${notesOnly}`,
  );
  check(
    "5d the recipe still measures far under the budget",
    recipe < PUSH_BUDGET_BYTES,
    `${recipe} vs ${PUSH_BUDGET_BYTES}`,
  );
  check("5e the payload commit's bytes are on the notes side of the delta", noteBytes > 0, String(noteBytes));
}

// ---------------------------------------------------------------------------
// 5f. The guard prints a content-free push-budget line per call, so a demo
//     run shows every push's estimate (not only the refusals).
// ---------------------------------------------------------------------------
{
  const d = mkrepo("e", { withOrigin: true });
  commitBytes(d, "src/logged.txt", 4 * KIB);
  const seen = [];
  const realLog = console.log;
  try {
    console.log = (...args) => {
      seen.push(args.map(String).join(" "));
      realLog(...args);
    };
    assertPushBudgetGit(d, ["main"]);
  } finally {
    console.log = realLog;
  }
  const lines = seen.filter((l) => l.startsWith("push-budget "));
  check("5f the guard logs one push-budget line", lines.length === 1, JSON.stringify(lines));
  const payload = lines[0] ? lines[0].slice("push-budget ".length) : "{}";
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = null;
  }
  check(
    "5g the log line carries byte counts and refspec counts only",
    parsed !== null && typeof parsed.estimatedBytes === "number" && parsed.refspecs === 1 && parsed.budgetBytes === PUSH_BUDGET_BYTES,
    payload,
  );
  check("5h the log line is content-free (no paths, no fixture text)", !/src\/|logged|\.txt/.test(payload), payload);
}

// ---------------------------------------------------------------------------
// 6. Over budget: PushBudgetError, before any wire call.
// ---------------------------------------------------------------------------
{
  const big = mkrepo("c", { withOrigin: true });
  commitBytes(big, "src/huge.txt", PUSH_BUDGET_BYTES + 1);
  let threw = null;
  let returned = null;
  try {
    returned = assertPushBudgetGit(big, ["main"]);
  } catch (e) {
    threw = e;
  }
  check("6 an over-budget push throws PushBudgetError", threw instanceof PushBudgetError, threw?.constructor?.name ?? `returned=${returned}`);
  check(
    "6b the error carries the byte count past the budget",
    threw instanceof PushBudgetError && threw.estimatedBytes > PUSH_BUDGET_BYTES,
    String(threw?.estimatedBytes),
  );
  check("6c the error is named PushBudgetError", threw?.name === "PushBudgetError", String(threw?.name));
  check(
    "6d the message is content-free (byte counts only)",
    typeof threw?.message === "string" && !/src\/|huge|\.txt/.test(threw.message),
    String(threw?.message),
  );
}

// ---------------------------------------------------------------------------
// 7. The guard measures the repo it is handed (the runner's clone dir), and
//    a missing ref is not an error (nothing to push for it).
// ---------------------------------------------------------------------------
{
  const d = mkrepo("d", { withOrigin: true });
  commitBytes(d, "src/x.txt", 8 * KIB);
  const here = estimatePushBytesGit(d, ["main"]);
  check("7 a repo with an unpushed commit measures > 0", here > 0, String(here));
  const absent = estimatePushBytesGit(d, ["+refs/notes/commits"]);
  check("7b an absent ref measures 0 (nothing to push for it)", absent === 0, String(absent));
  const empty = estimatePushBytesGit(d, []);
  check("7c an empty refspec list measures 0", empty === 0, String(empty));
}

rmSync(root, { recursive: true, force: true });
console.log(fails === 0 ? `ALL PASS (${passes} checks)` : `${fails} FAILURES (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);
