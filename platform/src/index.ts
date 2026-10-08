// nextgit-platform — platform worker.
// 1) Artifacts event consumer: logs push/fork/create events off the queue and
//    records the recent feed in KV (GET /events).
// 2) Change-set API: reads concurrent agent proposals server-side (no clones).
//    A proposal's change-set is measured against its FORK POINT — the most
//    recent commit shared with the base — not the base's current head, so the
//    set is "what the agent changed" and stays stable as the baseline moves.
// 3) Proposal set + conflict map: pairwise 3-way merge simulation (diff3) across
//    concurrent proposals — real conflict detection, no clones — plus a per-
//    proposal `landing` verdict from folding that proposal onto the base head.
// 4) Fold merge: applies proposals onto the baseline in order (diff3), per file,
//    with the fork point as the 3-way ancestor.
// 5) Landing: the same fold pushed to the base repo as one commit, server-side
//    (POST /land) — the browser's one-click "ship it", no CLI.

import { createTwoFilesPatch, diffLines } from "diff";
import { diff3Merge } from "node-diff3";
import { BaseMovedError, mintWriteToken, pushLand, type LandFile } from "./land";
import { LandLeaseDO, acquireLandLease, releaseLandLease } from "./landLeaseDO";
export { LandLeaseDO };
import {
  JUDGE_SET_ID,
  PINNED_MODEL_ID,
  MODEL_SELECTOR,
  buildJudgeRequest,
  validateJudgeResponse,
  judgeRateAllow,
  type JudgeRepoInput,
} from "./judge";
interface Env {
  ARTIFACTS: Artifacts;
  LIVE: KVNamespace;
  ASSETS: Fetcher;
  AI: Ai;
  LAND_LEASE: DurableObjectNamespace;
}

const MAX_DIFF_FILE_CHARS = 200_000; // skip line-diff above this (per side)
const MAX_PATCH_CHARS = 30_000; // truncate inline patches
const MAX_FILES_WITH_PATCH = 50; // patch budget per change-set
const NOTES_REF = "refs/notes/commits"; // git-notes for commit intent
const EVENTS_KEY = "recent"; // KV key: recent event feed
const MAX_EVENTS = 50; // event feed cap

// FR-18 validation evidence bounds (POST /land `validation` request field).
const MAX_VALIDATION_CHECKS = 32;
const MAX_VALIDATION_TEXT = 256;
const MAX_ARTIFACT_REF = 512;
const MERGED_SHA_CHECK = "merged-sha-equals-tested-sha"; // reserved ledger check name
const LANDING_KEY_PREFIX = "landing:"; // KV LIVE: landing record keyed by commit

type FileMap = Map<string, string>; // path -> blob hash

interface ChangeFile {
  path: string;
  status: "added" | "modified" | "removed";
  baseHash?: string;
  headHash?: string;
  binary?: boolean;
  additions?: number;
  deletions?: number;
  intent?: string;
  secret?: boolean;
  keys?: string[];
  note?: string;
  patch?: string;
}
interface CommitMeta {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
}


interface FileTexts {
  base: string | null;
  head: string | null;
}

async function walkTree(repo: ArtifactsRepo, treeHash: string, prefix: string, out: FileMap): Promise<void> {
  const entries = await repo.readTree(treeHash);
  if (!entries) return;
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "tree") {
      await walkTree(repo, entry.hash, path, out);
    } else if (entry.type === "blob" || entry.type === "exec") {
      out.set(path, entry.hash);
    }
  }
}

async function snapshot(repo: ArtifactsRepo, ref: string): Promise<{ treeHash: string; files: FileMap; headSha: string }> {
  const commits = await repo.log({ ref, limit: 1 });
  if (!commits.length) throw new Error(`cannot resolve ref "${ref}"`);
  const treeHash = commits[0].treeHash;
  const files: FileMap = new Map();
  await walkTree(repo, treeHash, "", files);
  return { treeHash, files, headSha: commits[0].hash };
}

// ---------------------------------------------------------------------------
// Fork point — the commit a proposal branched off the base at.
//
// A proposal's change-set is "what the agent changed", so it must be measured
// against the fork point, not the base's CURRENT head. Once anything lands on
// the base, diffing a still-pending proposal against the new head shows the
// landed change in reverse (an apparent deletion of work that is already
// there) — noise that disappears entirely when the baseline moves.
//
// The fork point is the most recent commit shared by both first-parent
// histories: walk each log, intersect the hashes, and take the newest member
// of that intersection in the PROPOSAL's log (newest by position, since
// `log` is newest-first). No shared commit → fall back to the base head, which
// is the legacy "everything is new relative to the base" behaviour.
// ---------------------------------------------------------------------------

const FORK_LOG_LIMIT = 200;

interface CommitHead {
  hash: string;
  treeHash: string;
  files: FileMap;
  sha: string;
  ref: string;
  proposalLog: ArtifactsCommitMetadata[];
}

async function commitHead(repo: ArtifactsRepo, sha: string, ref: string): Promise<CommitHead> {
  const commits = await repo.log({ ref: sha, limit: 1 });
  const commit = commits[0];
  if (!commit || commit.hash !== sha) throw new Error(`cannot resolve commit "${sha}"`);
  const files: FileMap = new Map();
  await walkTree(repo, commit.treeHash, "", files);
  return { hash: commit.hash, treeHash: commit.treeHash, files, sha, ref, proposalLog: [] };
}

async function forkPoint(
  baseRepo: ArtifactsRepo,
  baseRef: string,
  proposalRepo: ArtifactsRepo,
  proposalRef: string,
): Promise<CommitHead> {
  const baseHead = await snapshot(baseRepo, baseRef);
  try {
    const [baseLog, proposalLog] = await Promise.all([
      baseRepo.log({ ref: baseRef, limit: FORK_LOG_LIMIT }),
      proposalRepo.log({ ref: proposalRef, limit: FORK_LOG_LIMIT }),
    ]);
    const baseShas = new Set(baseLog.map((c) => c.hash));
    // Newest-first in the proposal's own log, so the first hit is the fork point.
    const shared = proposalLog.find((c) => baseShas.has(c.hash));
    if (shared) {
      const head = await commitHead(proposalRepo, shared.hash, proposalRef);
      head.proposalLog = proposalLog;
      return head;
    }
  } catch {
    // Fall through to the base head — the legacy behaviour.
  }
  return { hash: baseHead.headSha, treeHash: baseHead.treeHash, files: baseHead.files, sha: baseHead.headSha, ref: baseRef, proposalLog: [] };
}


function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

interface FileContent {
  text: string | null;
  size: number;
  binary: boolean;
}

async function readContent(repo: ArtifactsRepo, ref: string, path: string): Promise<FileContent | null> {
  const blob = await repo.readFile({ ref, path });
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (isBinary(bytes)) return { text: null, size: bytes.length, binary: true };

  return { text: new TextDecoder().decode(bytes), size: bytes.length, binary: false };
}

// Intent carriers. The Artifacts binding resolves branches, tags and commit
// shas, but never `refs/notes/*`, so the note pushed to refs/notes/commits is
// read from a branch mirroring that ref; an `.intent` file on the branch itself
// is the fallback. Notes trees may fan out into subdirs whose blob names are
// full commit shas, so blobs are matched by path suffix.
const NOTES_BRANCH = "nextgit-notes";
const INTENT_FILE = "NEXTGIT_INTENT";
const MAX_INTENT_CHARS = 500; // intent is free text — cap before it reaches a body

async function readNotes(repo: ArtifactsRepo): Promise<Map<string, string>> {
  const notes = new Map<string, string>();
  for (const commit of await repo.log({ ref: NOTES_BRANCH, limit: 20 })) {
    await walkTree(repo, commit.treeHash, "", notes);
    if (notes.size) return notes;
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Intent — the note attached to the head commit.
// ---------------------------------------------------------------------------

// Branch-reachable intent file.
async function readIntentFile(repo: ArtifactsRepo, ref: string, headSha: string): Promise<string | undefined> {
  for (const path of [`${INTENT_FILE}/${headSha}.txt`, `${INTENT_FILE}/intent.txt`]) {
    const blob = await repo.readFile({ ref, path }).catch(() => null);
    if (!blob) continue;
    const text = (await blob.text()).trim();
    if (text) return text;
  }
  return undefined;
}

// A note is attacker-controlled text — cap it once, here, so no response body can
// ever carry an unbounded intent string.
function capIntent(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > MAX_INTENT_CHARS ? `${text.slice(0, MAX_INTENT_CHARS)}…` : text;
}

async function readIntent(repo: ArtifactsRepo, ref: string, headSha: string): Promise<string | undefined> {
  try {
    const notes = await readNotes(repo);
    const hash = notes.get(headSha) ?? Array.from(notes).find(([p]) => p.endsWith(`/${headSha}`))?.[1];
    if (hash) {
      const blob = await repo.readBlob(hash);
      const text = blob ? capIntent((await blob.text()).trim()) : undefined;
      if (text) return text;
    }
    return capIntent(await readIntentFile(repo, ref, headSha));
  } catch {
    return undefined; // intent is best-effort — never fail a change-set on it
  }
}

// ---------------------------------------------------------------------------
// Secret classes (CONTRACT masking law) — values must never leave the worker.
// ---------------------------------------------------------------------------

const SECRET_BASENAMES = new Set(["credentials.json", "secrets.json", ".dev.vars"]);
const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isSecretPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.startsWith(".env")) return true;
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) return true;
  if (SECRET_BASENAMES.has(base)) return true;
  return path.includes("secrets/");
}

function secretKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    if (!SECRET_KEY_RE.test(line)) continue;
    const key = line.slice(0, line.indexOf("="));
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Fold merge — apply proposals onto the baseline in the given order (diff3).
// ---------------------------------------------------------------------------

interface MergeFile {
  path: string;
  action: "write" | "delete";
  result: "merged" | "conflict" | "withheld-secret";
  merged?: string;
  conflictText?: string;
  note?: string;
}

function renderMerge(ours: string, ancestor: string, theirs: string): { text: string; conflict: boolean } {
  const regions = diff3Merge(ours.split("\n"), ancestor.split("\n"), theirs.split("\n"));
  const parts: string[] = [];
  let conflict = false;
  for (const r of regions) {
    if (r.ok) {
      parts.push(r.ok.join("\n"));
    } else if (r.conflict) {
      conflict = true;
      parts.push(
        `<<<<<<< ours\n${r.conflict.a.join("\n")}\n=======\n${r.conflict.b.join("\n")}\n>>>>>>> theirs`,
      );
    }
  }
  return { text: parts.join("\n"), conflict };
}

async function computeMerge(
  env: Env,
  baseName: string,
  baseRef: string,
  repoList: string[],
  ref: string,
  ancestorOut?: Record<string, string>,
) {
  using baseRepo = await env.ARTIFACTS.get(baseName);
  interface Fold {
    ancestor: string;
    ours: string;
    // The base head's own text for this path, plus whether the base has it at
    // all. A proposal whose merge result reproduces the base byte-for-byte is
    // not a change — which is what "already landed" actually means.
    baseText: string | null;
    binary: boolean;
    deleted: boolean;
    conflicted: boolean;
    conflictText?: string;
    secretKeys?: string[];
    note?: string;
  }
  const folds = new Map<string, Fold>();

  for (const repoName of repoList) {
    using headRepo = await env.ARTIFACTS.get(repoName);
    const cs = await computeChangeSet(env, baseName, baseRef, repoName, ref, { includeTexts: true });
    if (ancestorOut) ancestorOut[repoName] = cs.base.sha; // the fork point the fold used
    for (const f of cs.files) {
      let fold = folds.get(f.path);
      if (!fold) {
        // 3-way: ancestor = fork-point text (carried on the change-set, already
        // masked for secret paths), ours = the CURRENT base head, theirs =
        // proposal head. Using the fork point as ancestor is what keeps a
        // proposal mergeable against a baseline that moved under it.
        const ancestorText = f.status === "added" ? "" : (cs.texts[f.path]?.base ?? "");
        const baseBlob = await readContent(baseRepo, baseRef, f.path);
        const oursText = baseBlob?.text ?? "";
        fold = {
          ancestor: ancestorText,
          ours: oursText,
          baseText: baseBlob?.text ?? null,
          binary: false,
          deleted: false,
          conflicted: false,
        };
        folds.set(f.path, fold);
      }
      if (isSecretPath(f.path)) {
        // Secret text never enters `cs.texts`, so read the surviving side straight
        // from its repo: the base repo for a removal, the proposal for anything
        // else — the same text /proposals derives its keys from.
        const repo = f.status === "removed" ? baseRepo : headRepo;
        const at = f.status === "removed" ? cs.base.sha : ref;
        fold.secretKeys = secretKeys((await readContent(repo, at, f.path))?.text ?? "");
        continue;
      }
      if (f.binary) {
        fold.binary = true;
        continue;
      }

      if (f.status === "removed") {
        fold.deleted = true;
        fold.conflicted = false;
        fold.note = `removed by ${repoName}`;
        continue;
      }

      const merged = renderMerge(fold.ours, fold.ancestor, cs.texts[f.path]?.head ?? "");
      if (merged.conflict) {
        fold.conflicted = true;
        fold.conflictText = merged.text;
        fold.note = `conflicts with ${repoName}`;
        continue; // a conflicted file stops absorbing later proposals
      }
      fold.ours = merged.text;
      fold.deleted = false;
    }
  }

  const files: MergeFile[] = [];
  const conflicted: string[] = [];
  for (const path of Array.from(folds.keys()).sort()) {
    const fold = folds.get(path)!;
    const action: "write" | "delete" = fold.deleted ? "delete" : "write";

    if (fold.secretKeys) {
      files.push({
        path,
        action,
        result: "withheld-secret",
        note: `secret-class file; ${fold.secretKeys.length} key(s) withheld`,
      });
      continue;
    }
    if (fold.deleted) {
      // Removing a file the base no longer has is also a no-op.
      if (fold.baseText === null) continue;
      files.push({ path, action, result: "merged", note: fold.note ?? "removed by a proposal" });
      continue;
    }
    if (fold.binary) {
      files.push({ path, action, result: "merged", note: "binary file; text merge skipped" });
      continue;
    }
    if (fold.conflicted) {
      conflicted.push(path);
      files.push({ path, action, result: "conflict", conflictText: fold.conflictText ?? "", note: fold.note });
      continue;
    }
    // A merged result identical to the base head is not a change — this is what
    // an already-landed proposal folds to. Dropping it here is what makes
    // /land's `no-changes` and /proposals' `landed` agree: both count the same
    // surviving file list.
    if (fold.ours === fold.baseText) continue;
    files.push({ path, action, result: "merged", merged: fold.ours });
  }

  return {
    base: { repo: baseName, ref: baseRef },
    repos: repoList,
    status: conflicted.length ? "conflict" : "clean",
    files,
    conflicted,
  };
}

async function computeChangeSet(
  env: Env,
  baseName: string,
  baseRef: string,
  headName: string,
  ref: string,
  opts: { includeTexts?: boolean; headShas?: Record<string, string> } = {},
) {
  using baseRepo = await env.ARTIFACTS.get(baseName);
  using headRepo = await env.ARTIFACTS.get(headName);

  // The change-set is measured against the FORK POINT, not the base's current
  // head: "what the agent changed" stays stable as the baseline moves.
  const fork = await forkPoint(baseRepo, baseRef, headRepo, ref);
  const base = { treeHash: fork.treeHash, files: fork.files };
  // The commits that make up "what the agent changed" — the proposal's first-parent
  // log from HEAD down to (and including) the fork point. Reuses the SAME
  // `limit: FORK_LOG_LIMIT` walk forkPoint already performed (returned via
  // fork.proposalLog), so the response body costs no extra bounded log call.
  // Walk newest-first, stopping at (and including) the fork point.
  const commits: CommitMeta[] = [];
  for (const c of fork.proposalLog) {
    commits.push({
      hash: c.hash,
      message: c.message,
      author: `${c.author.name} <${c.author.email}>`,
      timestamp: c.authoredAt,
    });
    if (c.hash === fork.sha) break;
  }
  const head = await snapshot(headRepo, ref);
  // The head of the revision this change-set describes — the reviewed-state
  // anchor GET /proposals publishes (CONTRACT.md §GET /proposals). An out-param
  // (same pattern as computeMerge's ancestorOut) leaves the change-set shape
  // unchanged for every other caller.
  if (opts.headShas) opts.headShas[headName] = head.headSha;
  const intent = await readIntent(headRepo, ref, head.headSha);

  const files: ChangeFile[] = [];
  for (const [path, headHash] of head.files) {
    const baseHash = base.files.get(path);
    if (baseHash === undefined) files.push({ path, status: "added", headHash });
    else if (baseHash !== headHash) files.push({ path, status: "modified", baseHash, headHash });
  }
  for (const [path, baseHash] of base.files) {
    if (!head.files.has(path)) files.push({ path, status: "removed", baseHash });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  if (intent) for (const f of files) if (!isSecretPath(f.path)) f.intent = intent;

  const stats = {
    files: files.length,
    added: files.filter((f) => f.status === "added").length,
    modified: files.filter((f) => f.status === "modified").length,
    removed: files.filter((f) => f.status === "removed").length,
    additions: 0,
    deletions: 0,
  };

  const texts: Record<string, FileTexts> = {};
  let patchBudget = MAX_FILES_WITH_PATCH;
  for (const f of files) {
    const [oldSide, newSide] = await Promise.all([
      f.status !== "added" ? readContent(baseRepo, fork.sha, f.path) : Promise.resolve({ text: "", size: 0, binary: false }),
      f.status !== "removed" ? readContent(headRepo, ref, f.path) : Promise.resolve({ text: "", size: 0, binary: false }),
    ]);

    if (oldSide?.binary || newSide?.binary) {
      f.binary = true;
      continue;
    }
    const o = oldSide?.text ?? "";
    const n = newSide?.text ?? "";

    if (isSecretPath(f.path)) {
      // Secret-class file: report key names only. Values never leave the worker,
      // so the patch is omitted and the text is withheld from merge inputs.
      f.secret = true;
      f.keys = secretKeys(f.status === "removed" ? o : n);
    }

    if (o.length + n.length > MAX_DIFF_FILE_CHARS || patchBudget <= 0) {
      f.note = "too large for inline diff";
      continue;
    }

    if (opts.includeTexts && !f.secret) texts[f.path] = { base: o, head: n };

    const parts = diffLines(o, n);
    let additions = 0;
    let deletions = 0;
    for (const p of parts) {
      const count = p.count ?? 0;
      if (p.added) additions += count;
      else if (p.removed) deletions += count;
    }
    f.additions = additions;
    f.deletions = deletions;
    stats.additions += additions;
    stats.deletions += deletions;

    // Secret-class text stops here: stats are kept, the patch never exists.
    if (f.secret) continue;

    let patch = createTwoFilesPatch(`a/${f.path}`, `b/${f.path}`, o, n, "", "", { context: 3 });
    if (patch.length > MAX_PATCH_CHARS) {
      patch = patch.slice(0, MAX_PATCH_CHARS) + `\n... [patch truncated at ${MAX_PATCH_CHARS} chars]`;
    }
    f.patch = patch;
    patchBudget--;
  }

  return {
    // `sha` is the fork point actually diffed against, so a caller can see
    // which baseline the change-set is pinned to.
    base: { repo: baseName, ref: baseRef, treeHash: base.treeHash, sha: fork.sha },
    head: { repo: headName, ref, treeHash: head.treeHash },
    stats,
    files,
    texts,
    commits,
  };
}

// ---------------------------------------------------------------------------
// Conflict detection — pairwise diff3 over concurrent proposals.
// ---------------------------------------------------------------------------

type ConflictKind =
  | "text-conflict"
  | "modify/delete"
  | "add/add"
  | "undetermined"
  | "mergeable"
  | "identical-add"
  | "both-removed";

interface ProposalEntry {
  repo: string;
  status: "added" | "modified" | "removed";
  texts: FileTexts | null;
}

const KIND_SEVERITY: Record<ConflictKind, number> = {
  "text-conflict": 4,
  "modify/delete": 4,
  "add/add": 4,
  undetermined: 3,
  mergeable: 1,
  "identical-add": 1,
  "both-removed": 1,
};

function classifyPair(a: ProposalEntry, b: ProposalEntry): {
  kind: ConflictKind;
  conflict: boolean | null;
  region?: { baseLines: number; aLines: number; bLines: number };
} {
  if (a.status === "removed" && b.status === "removed") return { kind: "both-removed", conflict: false };
  if ((a.status === "removed") !== (b.status === "removed")) return { kind: "modify/delete", conflict: true };
  if (a.status === "added" && b.status === "added") {
    if (a.texts && b.texts && a.texts.head === b.texts.head) return { kind: "identical-add", conflict: false };
    return { kind: "add/add", conflict: true };
  }
  if (!a.texts || !b.texts || a.texts.head === null || b.texts.head === null || a.texts.base === null) {
    return { kind: "undetermined", conflict: null };
  }
  try {
    const regions = diff3Merge(a.texts.head.split("\n"), a.texts.base.split("\n"), b.texts.head.split("\n"));
    const conflicted = regions.filter((r) => r.conflict);
    if (conflicted.length === 0) return { kind: "mergeable", conflict: false };
    const c = conflicted[0].conflict;
    return {
      kind: "text-conflict",
      conflict: true,
      region: { baseLines: c.o?.length ?? 0, aLines: c.a?.length ?? 0, bLines: c.b?.length ?? 0 },
    };
  } catch (err) {
    return { kind: "undetermined", conflict: null };
  }
}

async function computeProposals(env: Env, baseName: string, baseRef: string, ref: string, repoList: string[] | null) {
  let repos = repoList;
  if (!repos || !repos.length) {
    const list = await env.ARTIFACTS.list({ limit: 200 });
    repos = list.repos.filter((r) => r.name.startsWith("agent-") && r.status === "ready").map((r) => r.name).sort();
  }
  // Reviewed-state anchors (CONTRACT.md §GET /proposals, FR-16). base.head is
  // read BEFORE the per-proposal folds: it is the reviewer's frame of reference,
  // and reading it first means a base that moves mid-response yields a head older
  // than every fold — a client echoing it then gets 409 stale / base-moved from
  // POST /land instead of landing content the reviewer never saw. Same read /land
  // compares reviewed.baseHead against (repoHead).
  const baseHead = await repoHead(env, baseName, baseRef);
  const headShas: Record<string, string> = {};
  const proposals: Array<{
    repo: string;
    head?: string; // the change-set head; absent on error rows
    intent?: string;
    stats?: unknown;
    landing?: { status: "ready" | "conflict" | "landed" | "withheld-secret"; files: number };
    files?: Array<{
      path: string;
      status: string;
      additions?: number;
      deletions?: number;
      binary?: boolean;
      secret?: boolean;
      keys?: string[];
      note?: string;
    }>;
    error?: string;
  }> = [];

  const fileIndex = new Map<string, ProposalEntry[]>();

  for (const name of repos) {
    try {
      const cs = await computeChangeSet(env, baseName, baseRef, name, ref, { includeTexts: true, headShas });
      // `landing` folds THIS proposal alone onto the CURRENT base head — exactly
      // the operation POST /land would perform. The verdict the UI shows is
      // therefore computed by the same fold the landing uses, not a guess:
      //   landed          — the fold would change nothing (already in the base)
      //   ready (N files) — clean fold of N files
      //   conflict / withheld-secret — mirrors the 409 /land would return
      const fold = await computeMerge(env, baseName, baseRef, [name], ref);
      const landing = fold.files.some((f) => f.result === "withheld-secret")
        ? ({ status: "withheld-secret", files: fold.files.length } as const)
        : fold.status === "conflict"
          ? ({ status: "conflict", files: fold.conflicted.length } as const)
          : fold.files.length === 0
            ? ({ status: "landed", files: 0 } as const)
            : ({ status: "ready", files: fold.files.length } as const);
      proposals.push({
        repo: name,
        head: headShas[name],
        intent: cs.files.find((f) => f.intent)?.intent,
        stats: cs.stats,
        files: cs.files.map((f) => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          binary: f.binary,
          secret: f.secret,
          keys: f.keys,
          note: f.note,
        })),
        landing,
      });
      for (const f of cs.files) {
        const t = cs.texts[f.path] ?? null;
        const entries = fileIndex.get(f.path) ?? [];
        entries.push({ repo: name, status: f.status, texts: t });
        fileIndex.set(f.path, entries);
      }
    } catch (err) {
      proposals.push({ repo: name, error: String((err as Error)?.message ?? err) });
    }
  }

  const conflicts: Array<{
    file: string;
    repos: string[];
    kind: ConflictKind;
    pairs: Array<{ a: string; b: string; kind: ConflictKind; conflict: boolean | null; region?: unknown }>;
  }> = [];

  for (const [file, entries] of fileIndex) {
    if (entries.length < 2) continue;
    const pairs = [];
    let worst: ConflictKind = "mergeable";
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const r = classifyPair(entries[i], entries[j]);
        pairs.push({ a: entries[i].repo, b: entries[j].repo, kind: r.kind, conflict: r.conflict, region: r.region });
        if (KIND_SEVERITY[r.kind] > KIND_SEVERITY[worst]) worst = r.kind;
      }
    }
    conflicts.push({ file, repos: entries.map((e) => e.repo), kind: worst, pairs });
  }
  conflicts.sort((a, b) => a.file.localeCompare(b.file));

  const allPairs = conflicts.flatMap((c) => c.pairs);
  const summary = {
    proposals: proposals.length,
    changedFiles: fileIndex.size,
    sharedFiles: conflicts.length,
    conflictingPairs: allPairs.filter((p) => p.conflict === true).length,
    cleanPairs: allPairs.filter((p) => p.conflict === false).length,
  };

  return { base: { repo: baseName, ref: baseRef, head: baseHead }, ref, proposals, conflicts, summary };
}

interface LiveEvent {
  type?: string;
  repo?: string;
  ref?: string;
  after?: string;
  at: string;
}

async function readEvents(env: Env): Promise<LiveEvent[]> {
  const raw = await env.LIVE.get(EVENTS_KEY, "json");
  return Array.isArray(raw) ? (raw as LiveEvent[]) : [];
}

async function recordEvent(env: Env, event: LiveEvent): Promise<void> {
  const events = await readEvents(env);
  await env.LIVE.put(EVENTS_KEY, JSON.stringify([event, ...events].slice(0, MAX_EVENTS)));
  // Invalidate the /proposals KV cache generation on push-shaped events: key change makes
  // every cached set unreachable (perf fix 2026-10-08; see the /proposals handler).
  if (event.type === "repo.pushed" || event.type === "repo.forked" || event.type === "repo.created") {
    await env.LIVE.put("cache:gen", String(Date.now()));
  }
}

// ---------------------------------------------------------------------------
// POST /land — fold proposals onto the base repo and push one commit, in-worker.
// ---------------------------------------------------------------------------

const MAX_LAND_REPOS = 16;

/** Repo names are used in a remote path, so keep them to a safe charset. */
const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

// Refs go into a remote refspec; reject anything that could forge one. A
// `..` segment would escape the branch namespace on the push.
const REF_RE = /^[\w./-]+$/;

// Demo allowlist (AD-9): the demo namespace is `demo` + `agent-*`, scratch
// chains (`demo-lh-base` / `agent-lh-1`) included. The full auth seam is its
// own work order; until it lands the allowlist is enforced unconditionally on
// /land, and the edge rate limit's closest documented substitute (the
// in-isolate fixed window /judge already uses) guards the write path.
const DEMO_REPO_RE = /^(demo|agent)(-[A-Za-z0-9._-]+)?$/;
const LAND_RATE_LIMIT = 20; // requests per caller...
const LAND_RATE_WINDOW_MS = 60_000; // ...per minute (AD-9 per-caller cap; makes 429 reachable)

const landWindows = new Map<string, { start: number; count: number }>();

/** True when the caller may land now; false when over LAND_RATE_LIMIT/min. */
function landRateAllow(key: string, now = Date.now()): boolean {
  if (landWindows.size > 500) {
    for (const [k, w] of landWindows) {
      if (now - w.start >= LAND_RATE_WINDOW_MS) landWindows.delete(k);
    }
  }
  const window = landWindows.get(key);
  if (!window || now - window.start >= LAND_RATE_WINDOW_MS) {
    landWindows.set(key, { start: now, count: 1 });
    return true;
  }
  if (window.count >= LAND_RATE_LIMIT) return false;
  window.count++;
  return true;
}

// Concurrency posture for POST /land (BF-1): one clone+push at a time per
// isolate. isomorphic-git funnels every operation through one module-wide
// AsyncLock keyed by path and ref; with a single LAND_WORKDIR all concurrent
// /land calls in this isolate share those keys, and a waiter left with no I/O
// can be cancelled by the runtime as hung. Serializing the critical section
// removes that promise intermingling; cross-isolate races keep AD-3's
// correctness (reviewed-heads 409 stale, pre-push re-read, push-rejection
// conversion) — no contract or response shape changes.
let landInFlight: Promise<void> = Promise.resolve();

/** Queue fn behind any in-flight land: one /land critical section per isolate. */
async function withLandGate<T>(fn: () => Promise<T>): Promise<T> {
  const prev = landInFlight;
  const { promise: next, resolve: release } = Promise.withResolvers<void>();
  landInFlight = next;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** The head commit sha a repo's ref resolves to (throws when unresolvable). */
async function repoHead(env: Env, name: string, ref: string): Promise<string> {
  using repo = await env.ARTIFACTS.get(name);
  const commits = await repo.log({ ref, limit: 1 });
  if (!commits.length) throw new Error(`cannot resolve ref "${ref}"`);
  return commits[0].hash;
}

/** Stable SHA-256 (hex) over the folded result: action + path + content, path-sorted. */
async function foldHashOf(files: LandFile[]): Promise<string> {
  const canonical = [...files]
    // Code-unit order (not localeCompare): the contract publishes this
    // serialization (CONTRACT.md POST /land) and clients recompute it from a
    // /merge preview — ICU collation must never enter the digest.
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.action}\n${f.path}\n${f.action === "write" ? f.merged ?? "" : ""}\n\x00`)
    .join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 });
}

interface LandRequestBody {
  base?: unknown;
  repos?: unknown;
  baseRef?: unknown;
  ref?: unknown;
  reviewed?: unknown;
  validation?: unknown;
}

/** Reviewed-state precondition (AD-3): heads as the caller saw them. */
interface ReviewedHeads {
  baseHead?: string;
  heads?: Record<string, string>;
}

/** FR-18 recorded validation evidence: the caller's checks/results and the fold hash they ran against. Self-attested; handleLand verifies content identity, not execution. */
interface LandValidation {
  checks: string[];
  results: string[];
  testedSha: string;
  artifactRef?: string;
}

function parseLandBody(raw: unknown): { base: string; repos: string[]; baseRef: string; ref: string; reviewed?: ReviewedHeads; validation?: LandValidation } | Response {
  if (!raw || typeof raw !== "object") return badRequest("JSON body required");
  const body = raw as LandRequestBody;
  const base = typeof body.base === "string" && body.base ? body.base : "demo";
  const ref = typeof body.ref === "string" && body.ref ? body.ref : "main";
  const baseRef = typeof body.baseRef === "string" && body.baseRef ? body.baseRef : ref;

  if (!Array.isArray(body.repos) || !body.repos.length) return badRequest("repos must be a non-empty array");
  if (body.repos.length > MAX_LAND_REPOS) return badRequest(`at most ${MAX_LAND_REPOS} repos per land`);
  const repos: string[] = [];
  for (const r of body.repos) {
    if (typeof r !== "string" || !REPO_NAME_RE.test(r)) return badRequest(`invalid repo name: ${JSON.stringify(r)}`);
    if (repos.includes(r)) return badRequest(`duplicate repo: ${r}`);
    repos.push(r);
  }
  if (!REPO_NAME_RE.test(base)) return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
  for (const r of [ref, baseRef]) {
    if (!REF_RE.test(r) || r.includes("..") || r.startsWith("/") || r.endsWith("/")) {
      return badRequest(`invalid ref: ${JSON.stringify(r)}`);
    }
  }
  // Optional reviewed-state precondition (AD-3). Shape violations are 400;
  // well-formed values are compared against the current heads in handleLand.
  let reviewed: ReviewedHeads | undefined;
  if (body.reviewed !== undefined) {
    const rawReviewed = body.reviewed;
    if (!rawReviewed || typeof rawReviewed !== "object" || Array.isArray(rawReviewed)) {
      return badRequest("reviewed must be an object");
    }
    const r = rawReviewed as { baseHead?: unknown; heads?: unknown };
    const isSha = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
    reviewed = {};
    if (r.baseHead !== undefined) {
      if (!isSha(r.baseHead)) return badRequest("reviewed.baseHead must be a commit sha string");
      reviewed.baseHead = r.baseHead;
    }
    if (r.heads !== undefined) {
      if (!r.heads || typeof r.heads !== "object" || Array.isArray(r.heads)) return badRequest("reviewed.heads must be an object");
      const heads: Record<string, string> = {};
      for (const [name, sha] of Object.entries(r.heads as Record<string, unknown>)) {
        if (!REPO_NAME_RE.test(name)) return badRequest(`invalid repo name in reviewed.heads: ${JSON.stringify(name)}`);
        if (!repos.includes(name)) return badRequest(`reviewed.heads names a repo that is not being landed: ${name}`);
        if (!isSha(sha)) return badRequest(`reviewed.heads.${name} must be a commit sha string`);
        heads[name] = sha;
      }
      for (const name of repos) {
        if (!(name in heads)) return badRequest(`reviewed.heads is missing repo: ${name}`);
      }
      reviewed.heads = heads;
    }
  }
  // Optional recorded validation evidence (FR-18). Shape violations are 400;
  // the testedSha↔fold relation is checked and recorded in handleLand — never
  // silently dropped and never a refusal of the fold.
  let validation: LandValidation | undefined;
  if (body.validation !== undefined) {
    const rawValidation = body.validation;
    if (!rawValidation || typeof rawValidation !== "object" || Array.isArray(rawValidation)) {
      return badRequest("validation must be an object");
    }
    const v = rawValidation as { checks?: unknown; results?: unknown; testedSha?: unknown; artifactRef?: unknown };
    const isText = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
    if (!Array.isArray(v.checks) || !v.checks.length || v.checks.length > MAX_VALIDATION_CHECKS) {
      return badRequest(`validation.checks must be a non-empty array of at most ${MAX_VALIDATION_CHECKS} entries`);
    }
    if (!v.checks.every((c) => isText(c, MAX_VALIDATION_TEXT))) return badRequest("validation.checks entries must be non-empty strings ≤256 chars");
    // The server's own equality check is appended to the ledger; the name is reserved.
    if (v.checks.includes(MERGED_SHA_CHECK)) return badRequest(`validation.checks must not use the reserved check name ${MERGED_SHA_CHECK}`);
    if (!Array.isArray(v.results) || v.results.length !== v.checks.length) return badRequest("validation.results must pair one-to-one with validation.checks");
    if (!v.results.every((r) => isText(r, MAX_VALIDATION_TEXT))) return badRequest("validation.results entries must be non-empty strings ≤256 chars");
    if (typeof v.testedSha !== "string" || !/^[0-9a-f]{64}$/.test(v.testedSha)) return badRequest("validation.testedSha must be a sha256 hex string");
    if (v.artifactRef !== undefined && !isText(v.artifactRef, MAX_ARTIFACT_REF)) return badRequest("validation.artifactRef must be a non-empty string ≤512 chars");
    validation = {
      checks: v.checks as string[],
      results: v.results as string[],
      testedSha: v.testedSha,
      artifactRef: v.artifactRef as string | undefined,
    };
  }
  return { base, repos, baseRef, ref, reviewed, validation };
}

async function handleLand(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = parseLandBody(await request.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const { base, repos, baseRef, ref, reviewed, validation } = parsed;

  const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!landRateAllow(caller)) return Response.json({ ok: false, error: "rate-limited" }, { status: 429 });

  // Demo allowlist (AD-9): only the demo namespace is landable while the
  // platform is demo-open; the full auth seam ships as its own work order.
  for (const name of [base, ...repos]) {
    if (!DEMO_REPO_RE.test(name)) {
      return Response.json(
        { ok: false, error: "repo-not-allowed", detail: `repo "${name}" is outside the demo allowlist` },
        { status: 403 },
      );
    }
  }

  // Pre-fold heads: the reviewed-state precondition compares against them, and
  // the evidence record + base-moved check use the same values.
  const baseHeadNow = await repoHead(env, base, baseRef);
  const proposalHeads: Record<string, string> = {};
  for (const name of repos) proposalHeads[name] = await repoHead(env, name, ref);
  if (reviewed?.heads) {
    for (const name of repos) {
      if (reviewed.heads[name] !== proposalHeads[name]) {
        return Response.json(
          { ok: false, error: "stale", detail: `reviewed head of ${name} does not match the current proposal head` },
          { status: 409 },
        );
      }
    }
  }
  if (reviewed?.baseHead !== undefined && reviewed.baseHead !== baseHeadNow) {
    return Response.json(
      { ok: false, error: "stale", detail: "reviewed base head does not match the current base head" },
      { status: 409 },
    );
  }
  // One fold, identical semantics to GET /merge. `ancestors` records each
  // repo's fork point (the 3-way ancestor) for the evidence record.
  const ancestors: Record<string, string> = {};
  const merge = await computeMerge(env, base, baseRef, repos, ref, ancestors);


  const secretFiles = merge.files.filter((f) => f.result === "withheld-secret").map((f) => f.path);
  if (secretFiles.length) {
    // Values must never leave the worker and must never be pushed by it.
    return Response.json({ ok: false, error: "withheld-secret", files: secretFiles }, { status: 409 });
  }
  if (merge.status === "conflict") {
    const detail = merge.files
      .filter((f) => f.result === "conflict")
      .map((f) => `${f.path}: ${f.note ?? "conflict"}`)
      .join("; ");
    return Response.json({ ok: false, error: "conflict", conflicted: merge.conflicted, detail }, { status: 409 });
  }
  // Nothing to land. The fold produced no files at all, so a commit would be an
  // empty change on the base. This is the same condition /proposals reads as
  // "landed", so the button and the endpoint can never disagree. The fold reads
  // the base at fold time, so an empty fold can also mean a concurrent land
  // already applied this change: re-read the head and report the AD-3 loser
  // outcome (base-moved), never no-changes, when the base moved since the
  // reviewed-heads check — the same conversion the push path applies.
  if (merge.files.length === 0) {
    const afterFold = await repoHead(env, base, baseRef).catch(() => null);
    if (afterFold !== null && afterFold !== baseHeadNow) {
      return Response.json(
        { ok: false, error: "base-moved", detail: "base head moved between review and land" },
        { status: 409 },
      );
    }
    return Response.json(
      { ok: false, error: "no-changes", detail: `fold of ${repos.join(",")} onto ${base}:${baseRef} changes nothing` },
      { status: 409 },
    );
  }

  const writeable: LandFile[] = merge.files
    .filter((f) => f.action === "write" && typeof f.merged === "string")
    .map((f) => ({ path: f.path, action: "write", result: f.result, merged: f.merged }));
  for (const f of merge.files) {
    if (f.action === "delete") writeable.push({ path: f.path, action: "delete", result: f.result });
  }
  const foldHash = await foldHashOf(writeable);

  // Per-isolate single-flight around the clone+push critical section (withLandGate).
  // Cross-isolate DO lease (FR-17) acquired inside withLandGate so the finally
  // block always releases it — no leak on early-return paths (no-changes,
  // conflicts, secrets) that sit between the reviewed-head gate and here.
  let leaseId: string | null = null;
  return await withLandGate(async () => {
    const lease = await acquireLandLease(env, base, 30);
    if (lease && !lease.acquired) {
      console.log("lease-denied", JSON.stringify({ base, by: caller }));
      return Response.json(
        { ok: false, error: "base-moved", detail: "base head moved between review and land" },
        { status: 409 },
      );
    }
    if (lease?.leaseId) leaseId = lease.leaseId;

    let baseRepo: ArtifactsRepo | null = null;
    let token: string | null = null;

    try {
      baseRepo = await env.ARTIFACTS.get(base);
      const info = await baseRepo.info();
      token = await mintWriteToken(baseRepo);
      const { commit } = await pushLand({
        remote: info.remote,
        token,
        baseRef,
        repos,
        files: writeable,
        expectedBaseHead: baseHeadNow,
        readBaseHead: () => repoHead(env, base, baseRef),
      });
      const at = new Date().toISOString();
      const landed = {
        repos,
        commit,
        files: writeable.map((f) => f.path).sort(),
        at,
      };
      // The evidence record (AD-3/FR-18): the commit is the evidence reference.
      // `mergedSha` is the fold hash of exactly what this landing pushed (the
      // same digest as `foldHash`, under FR-18's name); `testedSha` is the fold
      // hash the caller's recorded validation ran against. Their relation is
      // checked here, against the fold that actually landed: a mismatch — or no
      // recorded validation — is RECORDED in the ledger, never claimed as
      // validation, never silently dropped, never a refusal of the fold.
      const equalityResult = !validation ? "not-recorded" : validation.testedSha === foldHash ? "pass" : "mismatch";
      const evidence = {
        repos,
        commit,
        ancestor: ancestors,
        heads: { base: baseHeadNow, repos: proposalHeads },
        foldHash,
        checks: [...(validation?.checks ?? []), MERGED_SHA_CHECK],
        results: [...(validation?.results ?? []), equalityResult],
        mergedSha: foldHash,
        testedSha: validation?.testedSha ?? null,
        artifactRef: validation?.artifactRef ?? null,
        at,
        lease: leaseId ? { provider: "do", leaseId } : null,
      };
      // The landing record (FR-18) persists keyed by the returned commit — the
      // address the read surface serves. KV `LIVE` stays single-writer: this is
      // its only landing-record writer. The push already happened, so a storage
      // failure is logged and degraded, never reported as a failed land.
      try {
        await env.LIVE.put(`${LANDING_KEY_PREFIX}${commit}`, JSON.stringify({ landed, evidence }));
      } catch (e) {
        console.log("landing-record-write-failed", JSON.stringify({ commit, error: String(e) }));
      }
      // The queue consumer records the real repo.pushed event; this keeps the
      // feed useful even if queue delivery lags behind the push response.
      // Best-effort: fire AFTER the 200 is built so a KV write failure degrades
      // the feed, not the land (AD-6: the consumer is the sole recorder; this
      // call is a best-effort duplicate). Mirrors the queue consumer at line ~1174
      // ctx.waitUntil keeps the cache:gen bump alive past the Response boundary
      // (cache-invalidation-fireforget HIGH finding). Matches the scheduled
      // handler idiom at L1360-1373.
      ctx.waitUntil(
        (async () => {
          try {
            await recordEvent(env, { type: "repo.pushed", repo: base, ref: baseRef, after: commit, at: landed.at });
          } catch (e) {
            console.log("feed-lag", String(e));
          }
        })(),
      );
      return Response.json({ ok: true, landed, evidence });
    } catch (err) {
      if (err instanceof BaseMovedError) {
        return Response.json(
          { ok: false, error: "base-moved", detail: "base head moved between review and land" },
          { status: 409 },
        );
      }
      // A push rejected because a concurrent land advanced the ref is the
      // base-moved loser path, not a server error: re-read and convert. Ref
      // reads can briefly lag a git push — retry once before classifying.
      let after = await repoHead(env, base, baseRef).catch(() => null);
      if (after === baseHeadNow) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 400);
        await promise;
        after = await repoHead(env, base, baseRef).catch(() => null);
      }
      if (after !== null && after !== baseHeadNow) {
        return Response.json(
          { ok: false, error: "base-moved", detail: "base head moved between review and land" },
          { status: 409 },
        );
      }
      const detail = String((err as Error)?.message ?? err);
      // Credential-free failure: no token, no shell snippets. The caller may
      // retry, preview again, or land through the sanctioned control plane —
      // never via a handed-out write credential (spine AD-9).
      return Response.json(
        {
          ok: false,
          error: "push-failed",
          detail,
          repos,
          branch: baseRef,
          files: writeable,
        },
        { status: 500 },
      );
    } finally {
      // Worker-minted tokens are single-use: revoke whether the push landed or failed.
      if (token) {
        try {
          if (baseRepo) { await baseRepo.revokeToken(token); }
        } catch {
          // Best-effort; the short TTL still bounds exposure.
        }
      }
      // Release the per-base DO lease (FR-17): best-effort, only by owner.
      // AWAITED so the lease is released before withLandGate resolves — a fire-
      // and-forget release would let the next /land see a stale lease and 409.
      if (leaseId) {
        try {
          await releaseLandLease(env, base, leaseId);
        } catch {
          // Best-effort; the 30s TTL still bounds exposure.
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// POST /judge — typed advisory judgments for a target set of proposals (AD-11).
// Advisory only: the route writes nothing and lands nothing.
// ---------------------------------------------------------------------------

const MAX_JUDGE_REPOS = 16; // the platform's per-request repo cap

/** Judge error bodies are exactly { ok, error } — no message sentences. */
function judgeError(error: "bad-request" | "unknown-set" | "judge-unavailable", status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function judgeUnavailable(): Response {
  return judgeError("judge-unavailable", 503);
}

interface JudgeRequestBody {
  setId?: unknown;
  target?: unknown;
}

interface JudgeTargetBody {
  base?: unknown;
  repos?: unknown;
  refs?: unknown;
}

function parseJudgeBody(raw: unknown): { base: string; repos: string[]; ref: string } | Response {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return judgeError("bad-request", 400);
  const body = raw as JudgeRequestBody;
  if (!Object.keys(body).every((k) => k === "setId" || k === "target")) return judgeError("bad-request", 400);

  const setId = body.setId;
  if (typeof setId !== "string" || !setId) return judgeError("bad-request", 400);
  if (setId !== JUDGE_SET_ID) return judgeError("unknown-set", 400);

  if (!body.target || typeof body.target !== "object" || Array.isArray(body.target)) {
    return judgeError("bad-request", 400);
  }
  const target = body.target as JudgeTargetBody;
  if (!Object.keys(target).every((k) => k === "base" || k === "repos" || k === "refs")) {
    return judgeError("bad-request", 400);
  }

  const base = target.base === undefined ? "demo" : target.base;
  if (typeof base !== "string" || !REPO_NAME_RE.test(base)) return judgeError("bad-request", 400);

  const requested = target.repos;
  if (!Array.isArray(requested) || !requested.length || requested.length > MAX_JUDGE_REPOS) {
    return judgeError("bad-request", 400);
  }
  const repos: string[] = [];
  for (const name of requested) {
    if (typeof name !== "string" || !REPO_NAME_RE.test(name)) return judgeError("bad-request", 400);
    if (repos.includes(name)) return judgeError("bad-request", 400);
    repos.push(name);
  }

  // v1 accepts exactly one ref: base and proposals are read at it.
  const refs = target.refs === undefined ? ["main"] : target.refs;
  if (!Array.isArray(refs) || refs.length !== 1) return judgeError("bad-request", 400);
  const ref = refs[0];
  if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
    return judgeError("bad-request", 400);
  }
  return { base, repos, ref };
}

async function handleJudge(request: Request, env: Env): Promise<Response> {
  const parsed = parseJudgeBody(await request.json().catch(() => null));
  if (parsed instanceof Response) return parsed;

  const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!judgeRateAllow(caller)) return Response.json({ ok: false, error: "rate-limited" }, { status: 429 });
  if (!env.AI || typeof env.AI.run !== "function") return judgeUnavailable();

  const skipped: Array<{ repo: string; reason: "secret-class" | "empty-change-set" }> = [];
  const judged: JudgeRepoInput[] = [];
  for (const name of parsed.repos) {
    // The same fork-point reads /proposals uses, with texts for the fold below.
    const changeSet = await computeChangeSet(env, parsed.base, parsed.ref, name, parsed.ref, { includeTexts: true });
    if (changeSet.files.some((f) => isSecretPath(f.path))) {
      // Secret-class content cannot enter state: the repo is listed by name only.
      skipped.push({ repo: name, reason: "secret-class" });
      continue;
    }
    // The fold /proposals reads as `landed`: zero files means nothing to judge.
    const fold = await computeMerge(env, parsed.base, parsed.ref, [name], parsed.ref);
    if (fold.files.length === 0) {
      skipped.push({ repo: name, reason: "empty-change-set" });
      continue;
    }
    judged.push({ repo: name, intent: changeSet.files.find((f) => f.intent)?.intent, files: changeSet.files });
  }

  if (judged.length === 0) {
    // Nothing to ask: the pinned model requires at least one question, and no
    // model was served — the envelope echoes the pinned id without a call.
    return Response.json({ ok: true, setId: JUDGE_SET_ID, model: PINNED_MODEL_ID, judgments: [], skipped });
  }

  const { state, questions, plan } = buildJudgeRequest(judged, isSecretPath);
  const raw = await env.AI.run(PINNED_MODEL_ID, { model: MODEL_SELECTOR, state, questions }).catch(() => null);
  const validated = validateJudgeResponse(raw, plan);
  if (!validated.ok) {
    console.log("judge-unavailable", JSON.stringify({ reason: validated.reason }));
    return judgeUnavailable();
  }
  // Content-free log: counts only — never state, answers, or repo content.
  console.log(
    "judge",
    JSON.stringify({ setId: JUDGE_SET_ID, model: validated.model, judged: judged.length, skipped: skipped.length }),
  );
  return Response.json({
    ok: true,
    setId: JUDGE_SET_ID,
    model: PINNED_MODEL_ID,
    judgments: validated.judgments,
    skipped,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "nextgit-platform", namespace: "nextgit" });
      }

      if (url.pathname === "/changes" && request.method === "GET") {
        const repo = url.searchParams.get("repo");
        if (!repo) return Response.json({ ok: false, error: "repo parameter required" }, { status: 400 });
        const base = url.searchParams.get("base") ?? "demo";
        const ref = url.searchParams.get("ref") ?? "main";
        const baseRef = url.searchParams.get("baseRef") ?? "main";
        const changeSet = await computeChangeSet(env, base, baseRef, repo, ref);
        return Response.json({ ok: true, changeSet });
      }

      if (url.pathname === "/proposals" && request.method === "GET") {
        const base = url.searchParams.get("base") ?? "demo";
        const ref = url.searchParams.get("ref") ?? "main";
        const baseRef = url.searchParams.get("baseRef") ?? "main";
        const reposParam = url.searchParams.get("repos");
        const repoList = reposParam ? reposParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
        // Validate every cacheKey segment against the same charset guards used by
        // POST /land (parseLandBody L869-878) and POST /judge (parseJudgeBody L1211-1231).
        // Without this, raw query params could inject key-segment metacharacters or
        // craft cache-key collisions (cache-key-cachepoison HIGH finding).
        if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
          return Response.json({ ok: false, error: "invalid base repo" }, { status: 400 });
        }
        if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
          return Response.json({ ok: false, error: "invalid ref" }, { status: 400 });
        }
        if (typeof baseRef !== "string" || !REF_RE.test(baseRef) || baseRef.includes("..") || baseRef.startsWith("/") || baseRef.endsWith("/")) {
          return Response.json({ ok: false, error: "invalid baseRef" }, { status: 400 });
        }
        if (repoList) {
          for (const r of repoList) {
            if (!REPO_NAME_RE.test(r)) {
              return Response.json({ ok: false, error: "invalid repo name" }, { status: 400 });
            }
          }
        }
        // Perf (measured 2026-10-08: full recompute = 13–17s live at 5 forks — the UI's
        // 20s cap kept aborting John's browser). Generation-keyed KV cache: every pushed
        // event bumps `cache:gen` (see recordEvent), so any push/land invalidates every
        // cached set by key change; TTL bounds staleness if invalidation is ever missed.
        const gen = (await env.LIVE.get("cache:gen").catch(() => null)) ?? "0";
        const cacheKey = `cache:proposals:${gen}:${base}:${baseRef}:${ref}:${repoList ? repoList.join(",") : "*"}`;
        try {
          const hit = await env.LIVE.get(cacheKey);
          if (hit) return new Response(hit, { headers: { "content-type": "application/json", "x-nextgit-cache": "hit" } });
        } catch { /* cache read is best-effort — fall through to compute */ }
        const result = await computeProposals(env, base, baseRef, ref, repoList);
        const body = JSON.stringify({ ok: true, ...result });
        try { await env.LIVE.put(cacheKey, body, { expirationTtl: 360 }); } catch { /* serve regardless */ }
        return new Response(body, { headers: { "content-type": "application/json", "x-nextgit-cache": "miss" } });
      }


      if (url.pathname === "/merge" && request.method === "GET") {
        const base = url.searchParams.get("base") ?? "demo";
        const ref = url.searchParams.get("ref") ?? "main";
        const baseRef = url.searchParams.get("baseRef") ?? "main";
        const reposParam = url.searchParams.get("repos");
        const repoList = reposParam ? reposParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
        if (!repoList || !repoList.length) return Response.json({ ok: false, error: "repos parameter required" }, { status: 400 });
        const merge = await computeMerge(env, base, baseRef, repoList, ref);
        return Response.json({ ok: true, merge });
      }

      if (url.pathname === "/land" && request.method === "POST") {
        return await handleLand(request, env, ctx);
      }

      if (url.pathname === "/judge" && request.method === "POST") {
        return await handleJudge(request, env);
      }

      if (url.pathname === "/events" && request.method === "GET") {
        return Response.json({ ok: true, events: await readEvents(env) });
      }
      // Everything else is the triage UI from platform/ui via wrangler assets.
      return env.ASSETS.fetch(request);
    } catch (err) {
      return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
    }
  },

  // Cron warm-up (every 5 min): keeps the /proposals KV cache hot for the demo base so
  // visitors get a <1s first paint instead of paying the 13–17s recompute (2026-10-08).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const gen = (await env.LIVE.get("cache:gen")) ?? "0";
          const cacheKey = `cache:proposals:${gen}:demo:main:main:*`;
          const result = await computeProposals(env, "demo", "main", "main", null);
          await env.LIVE.put(cacheKey, JSON.stringify({ ok: true, ...result }), { expirationTtl: 360 });
          console.log("warmup", JSON.stringify({ proposals: result.proposals.length }));
        } catch (e) {
          console.log("warmup-failed", JSON.stringify({ error: e instanceof Error ? e.name : "error" }));
        }
      })(),
    );
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const event = message.body as {
        type?: string;
        source?: { namespace?: string; repoName?: string };
        payload?: { ref?: string; after?: string };
      };
      console.log(
        "artifacts-event",
        JSON.stringify({
          type: event?.type,
          namespace: event?.source?.namespace,
          repo: event?.source?.repoName,
          ref: event?.payload?.ref,
          after: event?.payload?.after,
          at: new Date().toISOString(),
        }),
      );
      await recordEvent(env, {
        type: event?.type,
        repo: event?.source?.repoName,
        ref: event?.payload?.ref,
        after: event?.payload?.after,
        at: new Date().toISOString(),
      });
      message.ack();
    }
  },
};
