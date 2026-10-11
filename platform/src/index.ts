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
import { BaseMovedError, foldHashOf, mintWriteToken, pushLand, TOKEN_TTL_SECONDS, type LandFile } from "./land";
import { LandLeaseDO, acquireLandLease, releaseLandLease } from "./landLeaseDO";
export { LandLeaseDO };
import { EventsHubDO, publishEventToHub } from "./eventsHubDO";
export { EventsHubDO };
import {
 JUDGE_SET_ID,
 PINNED_MODEL_ID,
 MODEL_SELECTOR,
 AUTO_LAND_ENGAGED,
 deriveAutoLandVerdict,
 buildJudgeRequest,
 validateJudgeResponse,
 scrubFreeText,
 CONTENT_SECRET_MIN,
 isNoulAnswer,
 isPlainObject,
 type JudgeRepoInput,
 type AutoLandVerdict,
} from "./judge";

import { rateAllow, rateGate, rateLimitedResponse } from "./rate";

import { authorize, DEMO_REPO_RE, REPO_NAME_RE, csrfGate, assertSeamEnabled, authorizeReveal, revealCapability, revealDenial, revealAuditRecord, unauthorizedResponse, type ActionType, type AuthorizeScope, type RevealAuditRecord } from "./auth";

interface Env {
 ARTIFACTS: Artifacts;
 LIVE: KVNamespace;
 CACHE: KVNamespace;
 ASSETS: Fetcher;
 AI: Ai;
 SKIP_RECORD?: KVNamespace;
 LAND_LEASE: DurableObjectNamespace;
 EVENTS_HUB: DurableObjectNamespace;
 AUTH_MODE?: string;
 /** Explicit reveal allowlist (FR-31) — absent ⇒ default-deny. */
 REVEAL_ALLOW?: unknown;
 /** Best-effort KV audit sink for POST /reveal decisions (content-free). */
 REVEAL_AUDIT?: KVNamespace;
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

 if (intent) for (const f of files) if (!isSecretPath(f.path)) f.intent = scrubFreeText(intent);

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
  const c = conflicted[0].conflict!;
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
   proposals.push({ repo: name, error: scrubFreeText(String((err as Error)?.message ?? err)) });
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

function validateEvent(event: LiveEvent): boolean {
 if (!event.type || typeof event.type !== "string") return false;
 const norm = normalizeEventType(event.type);
 if (!VALID_EVENT_TYPES[norm]) return false;
 if (!event.repo || typeof event.repo !== "string" || !REPO_NAME_RE.test(event.repo)) return false;
 if (event.ref !== undefined && (typeof event.ref !== "string" || !REF_RE.test(event.ref) || event.ref.includes("..") || event.ref.startsWith("/") || event.ref.endsWith("/"))) return false;
 if (event.after !== undefined && (typeof event.after !== "string" || !AFTER_RE.test(event.after))) return false;
 if (!event.at || typeof event.at !== "string") return false;
 return true;
}

function eventDedupKey(event: LiveEvent): string {
 const t = event.type ? normalizeEventType(event.type) : "";
 return t + "|" + (event.repo || "") + "|" + (event.ref ?? "") + "|" + (event.after ?? "");
}

async function recordEvent(env: Env, event: LiveEvent): Promise<void> {
 if (!validateEvent(event)) {
  console.log("feed-reject", JSON.stringify({ type: event?.type, repo: event?.repo, reason: "validation-failed" }));
  return;
 }
 const events = await readEvents(env);
 const key = eventDedupKey(event);
 if (events.some((e) => eventDedupKey(e) === key)) {
  console.log("feed-dedup", JSON.stringify({ type: event.type, repo: event.repo, ref: event.ref, after: event.after }));
  return;
 }
 const normType = event.type ? normalizeEventType(event.type) : "";
 await env.LIVE.put(EVENTS_KEY, JSON.stringify([{ ...event, type: normType }, ...events].slice(0, MAX_EVENTS)));
 if (CACHE_INVALIDATING_TYPES[normType]) {
  await env.CACHE.put("cache:gen", String(Date.now()));
 }
 // SSE fan-out: best-effort. A hub failure must not reject the queue message
 // or roll back the KV write (the queue consumer acks after this returns;
 // GET /events is the durable feed). Swallow and log.
 try { await publishEventToHub(env, { ...event, type: normType }); } catch (e) {
  console.log("events-hub-publisher", String(e));
 }
}

// GET /events/stream — reverse-proxy into the EVENTS_HUB Durable Object.
// The DO owns the streaming connection lifecycle (hibernation on disconnect);
// the Worker is a thin proxy. Matches the LandLeaseDO stub.fetch RPC shape
// (index.ts ~87-89). No caller input — one namespace-wide feed, unauthenticated,
// same auth model as GET /events (CONTRACT § GET /events/stream).
async function handleSSEStream(request: Request, env: Env): Promise<Response> {
 if (!env.EVENTS_HUB) {
  // Hub unbound (local-dev / staging without the DO binding). Degrade to a
  // connect comment so the client reconnects and falls back to GET /events.
  return new Response(": connected\n\n", {
   headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
   },
  });
 }
 const id = env.EVENTS_HUB.idFromName("events");
 const stub = env.EVENTS_HUB.get(id);
 // The DO returns a streaming Response (text/event-stream). We proxy it directly
 // so the connection is owned by the DO's hibernate-aware lifecycle — when all
 // consumers disconnect, the DO hibernates. No waitUntil.
 return stub.fetch(request);
}

// Event type whitelist + validation helpers for the queue consumer.
// Token events (FR-36): dual-listed like the five repo families.
// The Artifacts envelope carries the `cf.artifacts.` prefix;
// normalizeEventType strips only that prefix. Token events are
// accepted in BOTH documented and live-emitted forms: the docs
// show `cf.artifacts.repo.token.*` (normalized `repo.token.*`),
// while the live open-beta environment emits `cf.artifacts.token.*`
// (normalized `token.*`) — the consumer accepts both so a
// token event is never dropped as validation-failed. Not in
// CACHE_INVALIDATING_TYPES: token lifecycle never changes a
// change-set (same reasoning that keeps repo.cloned/fetched out).
const VALID_EVENT_TYPES: Record<string, true> = {
 "cf.artifacts.repo.pushed": true, "cf.artifacts.repo.forked": true, "cf.artifacts.repo.created": true,
 "cf.artifacts.repo.cloned": true, "cf.artifacts.repo.fetched": true,
 "cf.artifacts.repo.token.created": true, "cf.artifacts.repo.token.revoked": true,
 "cf.artifacts.token.created": true, "cf.artifacts.token.revoked": true,
 "repo.pushed": true, "repo.forked": true, "repo.created": true, "repo.cloned": true, "repo.fetched": true,
 "repo.token.created": true, "repo.token.revoked": true,
 "token.created": true, "token.revoked": true,
};

function normalizeEventType(type: string): string {
 return type.replace(/^cf\.artifacts\./, "");
}

const AFTER_RE = /^[0-9a-f]{40}$/;

const CACHE_INVALIDATING_TYPES: Record<string, true> = {
 "repo.pushed": true, "repo.forked": true, "repo.created": true,
};

// ---------------------------------------------------------------------------
// POST /land — fold proposals onto the base repo and push one commit, in-worker.
// ---------------------------------------------------------------------------

const MAX_LAND_REPOS = 16;

// Repo-name charset: imported from the auth seam (REPO_NAME_RE) so the
// charset guard lives in one place (the chokepoint defers charset-invalid
// names to the handlers' own 400s).

// Refs go into a remote refspec; reject anything that could forge one. A
// `..` segment would escape the branch namespace on the push.
const REF_RE = /^[\w./-]+$/;
// Demo allowlist (AD-9): the demo namespace is `demo` + `agent-*`, scratch
// chains (`demo-lh-base` / `agent-lh-1`) included. The allowlist lives in
// the authorize() chokepoint (./auth, DEMO_REPO_RE) and is enforced on every
// route; /land re-checks it below (defense-in-depth — its body is parsed by
// parseLandBody, not extractScope). The full auth seam is its own work order;
// until it lands the edge rate limit's closest documented substitute (the
// in-isolate fixed window in ./rate) guards the write path.

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

function badRequest(error: string): Response {
 return Response.json({ ok: false, error }, { status: 400 });
}

/**
 * Content-free token-lifecycle audit (FR-36): one `console.log` line
 * per mint/revoke, matching the existing `console.log(event,
 * JSON.stringify(fields))` idiom (the "judge" log above). Every caller
 * passes a closed literal — `{repo,ttl}` or `{repo,phase}` — so the
 * token string and its request body can never reach Worker logs
 * (NFR-3); `fields` is `Record<string,unknown>` only to keep the seam
 * uniform, not to invite free-form payloads.
 */
function auditToken(event: "token-mint" | "token-revoke", fields: Record<string, unknown>): void {
 console.log(event, JSON.stringify(fields));
}

/** AD-8: the platform's route defaults — the ONE place base/ref/baseRef
 *  defaults live. Pinned in CONTRACT.md § Route defaults. baseRef defaults
 *  to ref (the read-path coupling pinned by default-resolution.test.mjs
 *  case 7), never to a second literal. */
export const DEFAULT_BASE_REPO = "demo";
export const DEFAULT_REF = "main";

/**
 * The single resolution point for base/ref/baseRef defaults (AD-8).
 * Every route parser (query, land body, judge body, startup warmup)
 * resolves absent params here, so no route carries a private default.
 * `undefined`/absent -> the pinned default; any supplied value passes
 * through untouched (the caller validates it against REPO_NAME_RE/REF_RE).
 * Only the /land body historically defaulted an EMPTY string to the
 * pinned default (its truthy guard, preserved); the GET query parser
 * did not (nullish `??` — an empty param is a 400, not the default).
 * The seam itself defaults only on absence.
 */
export function resolveRouteBase(opts: {
 base?: unknown;
 ref?: unknown;
 baseRef?: unknown;
}): { base: unknown; ref: unknown; baseRef: unknown } {
 const ref = opts.ref === undefined ? DEFAULT_REF : opts.ref;
 return {
  base: opts.base === undefined ? DEFAULT_BASE_REPO : opts.base,
  ref,
  baseRef: opts.baseRef === undefined ? ref : opts.baseRef,
 };
}

interface ProposalsQuery {
 base: string;
 ref: string;
 baseRef: string;
 repoList: string[] | null;
}

/**
 * Validates query params for the read-only /changes, /proposals, and /merge
 * GET handlers. Mirrors the same `REPO_NAME_RE` / `REF_RE` guards that
 * `parseLandBody` and `parseJudgeBody` already enforce on the write paths,
 * so every query-param consumer of computeChangeSet / computeMerge /
 * computeProposals is validated by the same pair of regexes.
 *
 * Returns a `ProposalsQuery` when valid, or a 400 `Response` (via `badRequest`)
 * when any param fails validation — matching the `| Response` contract the
 * POST handlers use via `parseLandBody`/`parseJudgeBody`.
 */
function parseProposalsQuery(url: URL): ProposalsQuery | Response {
 const { base, ref, baseRef } = resolveRouteBase({
  // Absent (null) -> the pinned default; a present value —
  // including "" — passes through raw (nullish ??, the base GET
  // parser's own idiom) so the REPO_NAME_RE/REF_RE guards below
  // 400 it. The /land body alone historically defaulted "".
  base: url.searchParams.get("base") ?? undefined,
  ref: url.searchParams.get("ref") ?? undefined,
  baseRef: url.searchParams.get("baseRef") ?? undefined,
 });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 if (typeof baseRef !== "string" || !REF_RE.test(baseRef) || baseRef.includes("..") || baseRef.startsWith("/") || baseRef.endsWith("/")) {
  return badRequest(`invalid baseRef: ${JSON.stringify(baseRef)}`);
 }
 const reposParam = url.searchParams.get("repos");
 let repoList: string[] | null = null;
 if (reposParam) {
  repoList = reposParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (repoList.length > MAX_LAND_REPOS) return badRequest(`at most ${MAX_LAND_REPOS} repos`);
  for (const r of repoList) if (!REPO_NAME_RE.test(r)) return badRequest(`invalid repo name: ${JSON.stringify(r)}`);
  if (new Set(repoList).size !== repoList.length) return badRequest("duplicate repo in repos");
 }
 return { base, ref, baseRef, repoList };
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
 // INTENTIONAL, PRE-SEAM ASYMMETRY (trap for the next caller):
 // /land is the ONLY caller that historically defaulted an empty
 // string to the pinned default (this truthy guard, preserved for
 // base parity). parseProposalsQuery and parseJudgeBody default
 // ONLY on absence (?? / undefined-only — a present "" is a 400,
 // pinned by GET ?base= 400 and judge.test.mjs case 5). Do not
 // "unify" the idioms: restoring typeof === "string" here would
 // be a behavior change (base:123 would stop 400ing at the
 // DEMO_REPO_RE chokepoint), and the resilience gate already
 // classified the non-string drift as a safe tightening.
 const { base, ref, baseRef } = resolveRouteBase({
  base: body.base || undefined,
  ref: body.ref || undefined,
  baseRef: body.baseRef || undefined,
 });
 if (!Array.isArray(body.repos) || !body.repos.length) return badRequest("repos must be a non-empty array");
 if (body.repos.length > MAX_LAND_REPOS) return badRequest(`at most ${MAX_LAND_REPOS} repos per land`);
 const repos: string[] = [];
 for (const r of body.repos) {
  if (typeof r !== "string" || !REPO_NAME_RE.test(r)) return badRequest(`invalid repo name: ${JSON.stringify(r)}`);
  if (repos.includes(r)) return badRequest(`duplicate repo: ${r}`);
  repos.push(r);
 }
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 if (typeof baseRef !== "string" || !REF_RE.test(baseRef) || baseRef.includes("..") || baseRef.startsWith("/") || baseRef.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(baseRef)}`);
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
 if (!rateAllow("/land", caller)) return rateLimitedResponse();

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
 // Judge idea 11: content-detected-secret landing gate.
 // /judge may have flagged any repo as containing a secret-value pattern.
 // Such repos cannot land — the skip record persists across the review/land gap.
 const skipChecks = repos.map((name) => env.SKIP_RECORD?.get(`judge-skip:${name}:${base}:${ref}`).catch(() => null) ?? Promise.resolve(null));
 const skipHits = await Promise.all(skipChecks);
 const skipFlagged = repos.filter((_, i) => skipHits[i] !== null);
 if (skipFlagged.length) {
  return Response.json(
   { ok: false, error: "content-detected-secret", repos: skipFlagged, detail: "one or more repos were judge-skipped for content-detected secrets" },
   { status: 409 },
  );
 }
 // Auto-land gate (AD-11 / FR-26): the server-side ACT/CONFIRM/ESCALATE
 // verdict from the same pinned Clef question set the cards render.
 // Advisory-only upstream (POST /judge) becomes a gate HERE: when engaged,
 // every /land must be answered by the pinned model, and an unanswered
 // land fails CLOSED (503 judge-unavailable, no fold-derived work, no
 // push). The verdict is recorded on the landing — clients render it;
 // they never decide it (the decision is this code, the policy is in
 // judge.ts, the model is pinned and fail-closed).
 // The gate's verdict, threaded into the evidence record below.
 let autoLand: AutoLandVerdict | null = null;
 if (AUTO_LAND_ENGAGED) {
  const gate = await judgeLandGate(env, base, baseRef, repos, ref);
  if (gate instanceof Response) return gate; // 503 judge-unavailable (fail closed)
  if (gate.verdict === "escalate") {
   // Content-free log: counts and reason codes only — never state,
   // answers, or repo content (NFR-3, mirrors the /judge log idiom).
   console.log("autoland-escalate", JSON.stringify({ setId: gate.setId, blocking: gate.blocking.length }));
   return Response.json(
    { ok: false, error: "autoland-escalate", verdict: "escalate", setId: gate.setId, blocking: gate.blocking },
    { status: 409 },
   );
  }
  // ACT/CONFIRM: the verdict rides the evidence record below.
  autoLand = gate;
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
   auditToken("token-mint", { repo: base, ttl: TOKEN_TTL_SECONDS });
   const { commit } = await pushLand({
    remote: info.remote,
    token,
    baseRef,
    repos,
    files: writeable,
    expectedBaseHead: baseHeadNow,
    readBaseHead: () => repoHead(env, base, baseRef),
    landingNote: true,
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
    autoLand, // the AutoLandVerdict — additive, served verbatim by GET /landings/{commit}
   };
   // The landing record (FR-18) persists keyed by the returned commit — the
   // address the read surface serves. KV `LIVE` stays single-writer: this is
   // its only landing-record writer. The push already happened, so a storage
   // failure is logged and degraded, never reported as a failed land.
   try {
    await env.CACHE.put(`${LANDING_KEY_PREFIX}${commit}`, JSON.stringify({ landed, evidence }));
   } catch (e) {
    console.log("landing-record-write-failed", JSON.stringify({ commit, error: String(e) }));
   }
   // The queue consumer records the real repo.pushed event; this keeps the
   // feed useful even if queue delivery lags behind the push response.
   // Best-effort: fire AFTER the 200 is built so a KV write failure degrades
   // the feed, not the land (AD-6: the consumer is the sole recorder; this
   // call is a best-effort duplicate). Mirrors the queue consumer at line ~1174
   // where ack() commits progress.
   // ctx.waitUntil keeps the cache:gen bump alive past the Response boundary
   // (cache-invalidation-fireforget HIGH finding; matches the scheduled handler idiom).
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
   const detail = scrubFreeText(String((err as Error)?.message ?? err));
   // Credential-free failure: no token, no shell snippets. The caller may
   // retry, preview again, or land through the sanctioned control plane —
   // never via a handed-out write credential (spine AD-9).
   // NFR-6: strip `merged` (file-content payload) from the error-path `files`
   // projection — only path/action/result survive so a non-secret file
   // carrying credential-shaped content can never echo in a failure body.
   return Response.json(
    {
     ok: false,
     error: "push-failed",
     detail,
     repos,
     branch: baseRef,
     files: writeable.map((f) => ({ path: f.path, action: f.action, result: f.result })),
    },
    { status: 500 },
   );
  } finally {
   // Worker-minted tokens are single-use: revoke whether the push landed or failed.
   if (token) {
    try {
     if (baseRepo) {
      await baseRepo.revokeToken(token);
      auditToken("token-revoke", { repo: base, phase: "success" });
     }
    } catch {
     // Best-effort; the short TTL still bounds exposure.
     auditToken("token-revoke", { repo: base, phase: "failed" });
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
// POST /upstream — route a fork's work back to its upstream (CAP-10).
//
// The lineage record seam: the provisioning path (fanout) records
// {repo, forkPoint} per fork at fork time in the CACHE KV namespace
// (the script-writable durable namespace — the bust-cache.mjs
// precedent; NFR-7 pins LIVE as worker-single-writer). /upstream
// and /forks read it. {repo, forkPoint} is verbatim the contract's
// GET /forks `upstream` payload, so /forks serves the record as-is
// and /upstream reads lineage.repo as the parent.
// ---------------------------------------------------------------------------

/** KV key prefix for fork lineage records (the provisioning seam's write). */
const FORK_KEY_PREFIX = "fork:";

/** The recorded lineage of one fork: its parent repo and fork-point commit. */
interface ForkLineage {
 repo: string;
 forkPoint: string;
}

/**
 * The shared read seam for fork lineage: `fork:<name>` in env.CACHE,
 * `{repo, forkPoint}` JSON. Fail closed — absent or unparseable is
 * `null` (the caller's typed 400 no-lineage refusal), never a throw.
 */
async function readForkLineage(env: Env, name: string): Promise<ForkLineage | null> {
 try {
  const raw = await env.CACHE.get(`${FORK_KEY_PREFIX}${name}`);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<ForkLineage>;
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.repo !== "string" || typeof parsed.forkPoint !== "string") return null;
  return { repo: parsed.repo, forkPoint: parsed.forkPoint };
 } catch {
  return null;
 }
}

/** Closed request schema for POST /upstream (AD-9): exactly {repo, base?, reviewed?}. */
interface UpstreamRequestBody {
 repo?: unknown;
 base?: unknown;
 reviewed?: unknown;
}

/**
 * Validate the /upstream body — the closed-schema twin of
 * parseLandBody (unknown field → 400). `repo` is required and
 * REPO_NAME_RE-checked; `base` defaults to the pinned default via
 * resolveRouteBase (the AD-8 single-source seam); `reviewed` is
 * validated exactly as /land's. `ref`/`baseRef` are NOT body
 * params — both resolve to DEFAULT_REF ("main"), the parent's
 * default branch.
 */
function parseUpstreamBody(raw: unknown): { repo: string; base: string; reviewed?: ReviewedHeads } | Response {
 if (!raw || typeof raw !== "object") return badRequest("bad-request");
 const body = raw as UpstreamRequestBody;
 // Closed schema (AD-9): anything beyond {repo, base,
 // reviewed} is an unknown field — the uniform 400, the
 // parseJudgeBody/handleReveal idiom (the contract pins
 // `400 {ok:false, error:"bad-request"}`).
 if (!Object.keys(body).every((k) => k === "repo" || k === "base" || k === "reviewed")) {
  return badRequest("bad-request");
 }
 if (typeof body.repo !== "string" || !REPO_NAME_RE.test(body.repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(body.repo)}`);
 }
 const { base } = resolveRouteBase({ base: body.base });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 }
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
    if (name !== body.repo) return badRequest(`reviewed.heads names a repo that is not being landed: ${name}`);
    if (!isSha(sha)) return badRequest(`reviewed.heads.${name} must be a commit sha string`);
    heads[name] = sha;
   }
   if (!(body.repo in heads)) return badRequest(`reviewed.heads is missing repo: ${body.repo}`);
   reviewed.heads = heads;
  }
 }
 return { repo: body.repo, base, reviewed };
}

/**
 * POST /upstream — the merge-back-to-upstream write (CAP-10).
 *
 * Delegates to the SAME machinery as handleLand — computeMerge →
 * withLandGate → acquireLandLease → pushLand → foldHashOf → the
 * 12-key evidence → the `landing:<commit>` KV record — so there is
 * no second writer of the fold/push critical section (AD-1/NFR-4).
 *
 * Precondition order (contract-pinned): 400 (shape) → 429 → 403 →
 * 400 no-lineage → 409 stale → 409 withheld-secret → 409 conflict →
 * 409 no-changes → 409 base-moved → 200.
 */
async function handleUpstream(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
 const parsed = parseUpstreamBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;
 const { repo, base, reviewed } = parsed;

 const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
 if (!rateAllow("/upstream", caller)) return rateLimitedResponse();

 // Demo allowlist (AD-9, handler-side defense-in-depth): the body
 // carries repo/base, which the dispatcher's query-only
 // extractScope cannot adjudicate — the /land precedent re-checks
 // the allowlist here. Fires before any repo read.
 for (const name of [base, repo]) {
  if (!DEMO_REPO_RE.test(name)) {
   return Response.json(
    { ok: false, error: "repo-not-allowed", detail: `repo "${name}" is outside the demo allowlist` },
    { status: 403 },
   );
  }
 }

 // Lineage resolution — the seam both /upstream and /forks read.
 // No record: the caller forked outside the provisioning seam — a
 // client-state error (400, the order's typed refusal), distinct
 // from a recorded lineage whose parent differs (409 conflict).
 const lineage = await readForkLineage(env, repo);
 if (!lineage) {
  return Response.json({ ok: false, error: "no-lineage" }, { status: 400 });
 }

 // Parent identity: a fork can only merge into its RECORDED parent.
 if (base !== lineage.repo) {
  return Response.json(
   { ok: false, error: "conflict", detail: `recorded upstream of ${repo} is ${lineage.repo}, not ${base}` },
   { status: 409 },
  );
 }

 // Pre-fold heads: the reviewed-state precondition compares against
 // them, and the evidence record uses the same values.
 const baseHeadNow = await repoHead(env, base, DEFAULT_REF);
 const forkHead = await repoHead(env, repo, DEFAULT_REF);
 if (reviewed?.heads && reviewed.heads[repo] !== forkHead) {
  return Response.json(
   { ok: false, error: "stale", detail: `reviewed head of ${repo} does not match the current proposal head` },
   { status: 409 },
  );
 }
 if (reviewed?.baseHead !== undefined && reviewed.baseHead !== baseHeadNow) {
  return Response.json(
   { ok: false, error: "stale", detail: "reviewed base head does not match the current base head" },
   { status: 409 },
  );
 }

 // One fold, identical semantics to GET /merge / POST /land.
 // `ancestors` records the repo's fork point (the 3-way ancestor)
 // for the evidence record.
 const ancestors: Record<string, string> = {};
 const merge = await computeMerge(env, base, DEFAULT_REF, [repo], DEFAULT_REF, ancestors);

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

 // Nothing to route: the fold produced no files, so a commit would
 // be an empty change on the parent. The fold reads the parent at
 // fold time, so an empty fold can also mean a concurrent land
 // already applied this change: re-read the head and report the
 // AD-3 loser outcome (base-moved), never no-changes, when the
 // parent moved since the reviewed-heads check — the same
 // conversion the push path applies.
 if (merge.files.length === 0) {
  const afterFold = await repoHead(env, base, DEFAULT_REF).catch(() => null);
  if (afterFold !== null && afterFold !== baseHeadNow) {
   return Response.json(
    { ok: false, error: "base-moved", detail: "base head moved between review and land" },
    { status: 409 },
   );
  }
  return Response.json(
   { ok: false, error: "no-changes", detail: `fold of ${repo} onto ${base}:${DEFAULT_REF} changes nothing` },
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

 // Per-isolate single-flight around the clone+push critical section
 // (withLandGate) — the SAME gate as /land, so the two writes
 // serialize per isolate. Cross-isolate DO lease (FR-17) acquired
 // inside so the finally block always releases it.
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
   auditToken("token-mint", { repo: base, ttl: TOKEN_TTL_SECONDS });
   const { commit } = await pushLand({
    remote: info.remote,
    token,
    baseRef: DEFAULT_REF,
    repos: [repo],
    files: writeable,
    expectedBaseHead: baseHeadNow,
    readBaseHead: () => repoHead(env, base, DEFAULT_REF),
    landingNote: true,
   });
   const at = new Date().toISOString();
   const landed = {
    repos: [repo],
    commit,
    files: writeable.map((f) => f.path).sort(),
    at,
   };
   // The evidence record (AD-3/FR-18): mechanically the 12-key
   // /land evidence. /upstream carries no `validation` body field
   // (the closed schema rejects it as unknown), so the ledger is
   // the degenerate no-validation form — checks is the reserved
   // merged-sha check alone, results is its "not-recorded" entry,
   // testedSha/artifactRef are null. `autoLand` is /land-only (the
   // auto-land gate is not part of the /upstream contract).
   const evidence = {
    repos: [repo],
    commit,
    ancestor: ancestors,
    heads: { base: baseHeadNow, repos: { [repo]: forkHead } },
    foldHash,
    checks: [MERGED_SHA_CHECK],
    results: ["not-recorded"],
    mergedSha: foldHash,
    testedSha: null,
    artifactRef: null,
    at,
    lease: leaseId ? { provider: "do", leaseId } : null,
   };
   // The landing record (FR-18) persists keyed by the returned
   // commit — the address the read surface serves. KV `LIVE` stays
   // single-writer: this is its only landing-record writer. The
   // push already happened, so a storage failure is logged and
   // degraded, never reported as a failed land.
   try {
    await env.CACHE.put(`${LANDING_KEY_PREFIX}${commit}`, JSON.stringify({ landed, evidence }));
   } catch (e) {
    console.log("landing-record-write-failed", JSON.stringify({ commit, error: String(e) }));
   }
   // The queue consumer records the real repo.pushed event; this
   // keeps the feed useful even if queue delivery lags behind the
   // push response (the /land posture, AD-6).
   ctx.waitUntil(
    (async () => {
     try {
      await recordEvent(env, { type: "repo.pushed", repo: base, ref: DEFAULT_REF, after: commit, at: landed.at });
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
   // A push rejected because a concurrent land advanced the ref is
   // the base-moved loser path, not a server error: re-read and
   // convert. Ref reads can briefly lag a git push — retry once
   // before classifying (the /land posture).
   let after = await repoHead(env, base, DEFAULT_REF).catch(() => null);
   if (after === baseHeadNow) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 400);
    await promise;
    after = await repoHead(env, base, DEFAULT_REF).catch(() => null);
   }
   if (after !== null && after !== baseHeadNow) {
    return Response.json(
     { ok: false, error: "base-moved", detail: "base head moved between review and land" },
     { status: 409 },
    );
   }
   const detail = scrubFreeText(String((err as Error)?.message ?? err));
   // Credential-free failure (NFR-6): no token, no shell snippets;
   // the `files` projection carries only path/action/result — never
   // `merged` content.
   return Response.json(
    {
     ok: false,
     error: "push-failed",
     detail,
     repos: [repo],
     branch: DEFAULT_REF,
     files: writeable.map((f) => ({ path: f.path, action: f.action, result: f.result })),
    },
    { status: 500 },
   );
  } finally {
   // Worker-minted tokens are single-use: revoke whether the push
   // landed or failed (the /land posture).
   if (token) {
    try {
     if (baseRepo) {
      await baseRepo.revokeToken(token);
      auditToken("token-revoke", { repo: base, phase: "success" });
     }
    } catch {
     // Best-effort; the short TTL still bounds exposure.
     auditToken("token-revoke", { repo: base, phase: "failed" });
    }
   }
   // Release the per-base DO lease (FR-17): best-effort, only by
   // owner. AWAITED so the lease is released before withLandGate
   // resolves — a fire-and-forget release would let the next
   // /upstream see a stale lease and 409.
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

 // AD-8 seam: absent (undefined) -> the pinned default. A PRESENT value
 // (including "") passes through to the validation below, preserving the
 // pre-seam `target.base === undefined ? "demo" : target.base` semantics
 // (an empty base is a 400, not the default — pinned by judge.test.mjs
 // case 5 "base empty").
 const resolved = resolveRouteBase({
  base: target.base === undefined ? undefined : target.base,
  ref: (target.refs as unknown[] | undefined)?.[0],
 });
 const base = resolved.base;
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
 // Pre-seam semantics preserved: absent refs -> the DEFAULT_REF
 // (via the seam); a present value must be a ONE-ENTRY array —
 // the raw shape check runs on target.refs (400 on any other
 // shape or length), and the single entry flows through the
 // seam (whose ref default applies only when refs is absent).
 const refs = target.refs;
 if (refs !== undefined && (!Array.isArray(refs) || refs.length !== 1)) {
  return judgeError("bad-request", 400);
 }
 const ref = resolved.ref;
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return judgeError("bad-request", 400);
 }
 return { base, repos, ref };
}

async function handleJudge(request: Request, env: Env): Promise<Response> {
 const parsed = parseJudgeBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;

 const rateDenied = rateGate("/judge", request);
 if (rateDenied) return rateDenied;
 if (!env.AI || typeof env.AI.run !== "function") return judgeUnavailable();

 // Demo allowlist (AD-9) — the POST /judge body is the scope carrier,
 // readable only here. Same uniform 403 as the authorize() chokepoint,
 // before any computeChangeSet / computeMerge / env.AI.run read.
 for (const name of [parsed.base, ...parsed.repos]) {
  if (!DEMO_REPO_RE.test(name)) {
   return Response.json(
    { ok: false, error: "repo-not-allowed", detail: `repo "${name}" is outside the demo allowlist` },
    { status: 403 },
   );
  }
 }

 const skipped: Array<{ repo: string; reason: "secret-class" | "empty-change-set" | "content-detected-secret" }> = [];
 const judged: JudgeRepoInput[] = [];
 for (const name of parsed.repos) {
  // The same fork-point reads /proposals uses, with texts for the fold below.
  const changeSet = await computeChangeSet(env, parsed.base, parsed.ref, name, parsed.ref, { includeTexts: true });
  // Mixed repos (secret + non-secret files) are JUDGED with the secret file masked
  // (keys-only, folded by maskJudgeFile); only ALL-secret repos skip. (e10 fix, restored
  // 2026-10-09 — the original rule skipped any repo that merely CONTAINED a secret file.)
  if (changeSet.files.length > 0 && changeSet.files.every((f) => isSecretPath(f.path))) {
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
 // Judge idea 11: content-detected-secret skip conversion.
 // If the raw model response flags any repo's content_secret_<i> noul above
 // CONTENT_SECRET_MIN, that repo is moved to skipped — removed from judgments
 // and recorded in SKIP_RECORD so /land can refuse it.
 const rawUnknown: unknown = raw;
 const rawAnswers: Record<string, unknown> = isPlainObject(rawUnknown) && isPlainObject(rawUnknown.answers) ? rawUnknown.answers : {};
 for (const entry of plan) {
  if (!entry.isContentSecret) continue;
  const answer = rawAnswers[entry.id];
  if (isNoulAnswer(answer) && answer.noul > CONTENT_SECRET_MIN) {
   skipped.push({ repo: entry.repo, reason: "content-detected-secret" });
   if (env.SKIP_RECORD) {
    void env.SKIP_RECORD.put(`judge-skip:${entry.repo}:${parsed.base}:${parsed.ref}`, new Date().toISOString()).catch(() => { });
   }
  }
 }
 if (skipped.some((s) => s.reason === "content-detected-secret")) {
  const flagged = skipped.filter((s) => s.reason === "content-detected-secret").map((s) => s.repo);
  const remaining = validated.judgments.filter((j) => !flagged.includes(j.repo));
  // Content-free log: counts only — never state, answers, or repo content.
  console.log(
   "judge",
   JSON.stringify({ setId: JUDGE_SET_ID, model: validated.model, judged: remaining.length, skipped: skipped.length }),
  );
  return Response.json({
   ok: true,
   setId: JUDGE_SET_ID,
   model: PINNED_MODEL_ID,
   judgments: remaining,
   skipped,
  });
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

/**
 * The auto-land gate's one Clef call (AD-11). Reuses the /judge
 * assembly seam verbatim — same fork-point change-set reads, same
 * AD-4 masking filter, same typed question set (setId `v1`), same
 * pinned model — so the gate and the card chips can never diverge
 * in what they asked. Fails closed on every failure mode: no AI
 * binding, a thrown run, or any validation miss => 503
 * judge-unavailable with zero repos landed.
 */
async function judgeLandGate(env: Env, base: string, baseRef: string, repos: string[], ref: string): Promise<AutoLandVerdict | Response> {
 if (!env.AI || typeof env.AI.run !== "function") return judgeUnavailable();
 const judged: JudgeRepoInput[] = [];
 for (const name of repos) {
  const changeSet = await computeChangeSet(env, base, baseRef, name, ref, { includeTexts: true });
  // Mixed repos are judged with the secret file masked; all-secret
  // repos are named only (same law as /judge).
  if (changeSet.files.length > 0 && changeSet.files.every((f) => isSecretPath(f.path))) continue;
  judged.push({ repo: name, intent: changeSet.files.find((f) => f.intent)?.intent, files: changeSet.files });
 }
 // Nothing to ask (every repo all-secret or empty): there is no
 // model answer to gate on — fail closed like every other
 // unanswered gate (a no-op land cannot self-authorize).
 if (judged.length === 0) return judgeUnavailable();
 const { state, questions, plan } = buildJudgeRequest(judged, isSecretPath);
 const raw = await env.AI.run(PINNED_MODEL_ID, { model: MODEL_SELECTOR, state, questions }).catch(() => null);
 const validated = validateJudgeResponse(raw, plan);
 if (!validated.ok) {
  console.log("judge-unavailable", JSON.stringify({ reason: validated.reason, route: "/land" }));
  return judgeUnavailable();
 }
 return deriveAutoLandVerdict(validated.judgments);
}

// ---------------------------------------------------------------------------
// GET /landings/{commit} — read back the landing record persisted by POST /land.
// ---------------------------------------------------------------------------
// Read-only, credential-free (NFR-6). The KV value is the inner record
// `{ landed, evidence }` that POST /land persisted; the read response wraps
// it with `ok: true` so the 200 body deep-equals the landing's 200 payload
// (same `landed` / `evidence` sub-objects). No secret-class content reaches
// KV (secret files are withheld at fold), so the record never carries
// credentials (NFR-5).
const COMMIT_RE = /^[0-9a-f]{40}$/;

async function handleLandingsRead(commit: string, env: Env): Promise<Response> {
 if (!COMMIT_RE.test(commit)) {
  return badRequest("bad-request");
 }
 const record = await env.CACHE.get(`${LANDING_KEY_PREFIX}${commit}`);
 if (record === null) {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const parsed = JSON.parse(record) as { landed: object; evidence: object };
 return Response.json({ ok: true, landed: parsed.landed, evidence: parsed.evidence });
}

// ---------------------------------------------------------------------------
// POST /reveal — read a secret-class VALUE through the authorized,
// audited seam rule (FR-31).
//
// Defense-in-depth: the dispatcher already ran authorize() (mode gate:
// deny 401 / demo allowlist 403) and the CSRF gate before this handler.
// This handler layers the EXPLICIT reveal rule (authorizeReveal) on top,
// then — and only then — reads the value server-side from Artifacts for
// the secret-class path. The value appears in exactly one place: the
// authorized 200 response. Every decision (grant AND denial) writes a
// content-free audit record; the record type has no `value` field, so
// the stored JSON cannot carry the secret.
// ---------------------------------------------------------------------------

/**
 * Extract the value for `key` from `KEY=VALUE` env-style text: the
 * substring after the first `=` on the matching line. Shares
 * SECRET_KEY_RE with secretKeys(). Returns null when the key is absent.
 */
function revealKeyValue(text: string, key: string): string | null {
 for (const line of text.split("\n")) {
  if (!SECRET_KEY_RE.test(line)) continue;
  const eq = line.indexOf("=");
  if (line.slice(0, eq) === key) return line.slice(eq + 1);
 }
 return null;
}

/**
 * Best-effort audit write to env.REVEAL_AUDIT. The KV key is
 * content-free (decision metadata only) and the stored JSON is a
 * RevealAuditRecord — by type it carries no `value`, so the secret
 * cannot be persisted here. A KV failure never fails the request
 * (mirrors the SKIP_RECORD precedent, index.ts handleJudge).
 */
async function writeRevealAudit(env: Env, rec: RevealAuditRecord): Promise<void> {
 if (!env.REVEAL_AUDIT) return;
 const k = `reveal-audit:${rec.at}:${rec.identity}:${rec.repo}:${rec.path}:${rec.key}`;
 await env.REVEAL_AUDIT.put(k, JSON.stringify(rec)).catch(() => { });
}

/** Closed request schema for POST /reveal (mirrors parseJudgeBody's unknown-field 400). */
interface RevealRequestBody {
 repo?: unknown;
 ref?: unknown;
 path?: unknown;
 key?: unknown;
}

async function handleReveal(request: Request, env: Env): Promise<Response> {
 // Belt-and-braces seam precondition: non-demo is already 401 via the
 // dispatcher's authorize(); assert here so the handler cannot run
 // outside the demo seam (fail closed before any binding read).
 try {
  assertSeamEnabled(env);
 } catch {
  return unauthorizedResponse();
 }

 // Closed schema + field validation. 400 (shape) precedes 403
 // (authorization), the same precedence class as parseLandBody.
 const raw = await request.json().catch(() => null);
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
  return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
 }
 const body = raw as RevealRequestBody;
 if (!Object.keys(body).every((k) => k === "repo" || k === "ref" || k === "path" || k === "key")) {
  return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
 }
 const repo = body.repo;
 const ref = body.ref;
 const path = body.path;
 const key = body.key;
 if (typeof repo !== "string" || !REPO_NAME_RE.test(repo)) {
  return Response.json({ ok: false, error: "invalid repo name" }, { status: 400 });
 }

 // Demo allowlist (AD-9) — the POST /reveal body is the scope
 // carrier, readable only here (the dispatcher's extractScope
 // reads query params only). Same uniform 403 as /land and
 // /judge, before any Artifacts read.
 if (!DEMO_REPO_RE.test(repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return Response.json({ ok: false, error: "invalid ref" }, { status: 400 });
 }
 if (typeof path !== "string" || path === "" || path.startsWith("/") || path.split("/").includes("..")) {
  return Response.json({ ok: false, error: "invalid path" }, { status: 400 });
 }
 if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
  return Response.json({ ok: false, error: "invalid key" }, { status: 400 });
 }

 // Identity: the opaque Bearer token (Authorization header), normalized.
 const identity = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

 // THE explicit authorization rule. Denied ⇒ audit a denial, then 403
 // with NO value — the value is never read for an unauthorized caller.
 const decision = authorizeReveal(env, { identity, repo });
 if (!decision.ok) {
  await writeRevealAudit(env, revealAuditRecord(identity, repo, path, key, "denied", new Date().toISOString()));
  return revealDenial();
 }

 // Authorized. The grant is audited AT THE AUTHORIZATION DECISION
 // POINT (Q1): the authorization event happened, so a granted record
 // is written even when a later step 400s (non-secret-class) or 404s
 // (missing file / key). Denials are audited above; grants here.
 await writeRevealAudit(env, revealAuditRecord(identity, repo, path, key, "granted", new Date().toISOString()));

 // The reveal surface is secret-class only.
 if (!isSecretPath(path)) {
  return Response.json({ ok: false, error: "not-secret-class" }, { status: 400 });
 }

 // Value read — only now, only for an authorized caller, only server-side.
 using artifactsRepo = await env.ARTIFACTS.get(repo);
 const content = await readContent(artifactsRepo, ref, path);
 if (!content) {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 if (content.binary) {
  return Response.json({ ok: false, error: "binary" }, { status: 415 });
 }
 const value = revealKeyValue(content.text ?? "", key);
 if (value === null) {
  return Response.json({ ok: false, error: "key-not-found" }, { status: 404 });
 }

 // The grant was audited at the authorization decision point (Q1).
 return Response.json({ ok: true, repo, ref, path, key, value });
}
// ---------------------------------------------------------------------------
// GET /health — liveness probe.
// ---------------------------------------------------------------------------
async function handleHealth(_request: Request, env: Env): Promise<Response> {
 return Response.json({ ok: true, service: "nextgit-platform", namespace: "nextgit" });
}
// ---------------------------------------------------------------------------
// GET /whoami?repo=... — the viewer's elevated-reveal capability.
// Read-only; carries no secret content. Reuses the SAME decision as
// POST /reveal (revealCapability → authorizeReveal) so the UI and the
// seam can never disagree about who may reveal. The affordance is
// never a capability: POST /reveal re-runs the rule on every click.
// ---------------------------------------------------------------------------
async function handleWhoami(request: Request, env: Env): Promise<Response> {
 try { assertSeamEnabled(env); } catch { return unauthorizedResponse(); }
 const identity = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
 const repoParam = new URL(request.url).searchParams.get("repo");
 const repo = repoParam ?? "demo";
 const capability = revealCapability(env, { identity, repo });
 return Response.json({ ok: true, authorized: capability.authorized, reveal: capability.reveal });
}

// ---------------------------------------------------------------------------
// GET /changes?repo=...&base=demo&ref=main&baseRef=main
// ---------------------------------------------------------------------------
async function handleChanges(request: Request, env: Env): Promise<Response> {
 const url = new URL(request.url);
 const repo = url.searchParams.get("repo");
 if (!repo) return Response.json({ ok: false, error: "repo parameter required" }, { status: 400 });
 if (!REPO_NAME_RE.test(repo)) return badRequest(`invalid repo name: ${JSON.stringify(repo)}`);
 const parsed = parseProposalsQuery(url);
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef } = parsed;
 const changeSet = await computeChangeSet(env, base, baseRef, repo, ref);
 return Response.json({ ok: true, changeSet });
}

// ---------------------------------------------------------------------------
// GET /proposals?base=demo&repos=a,b&ref=main&baseRef=main
// ---------------------------------------------------------------------------
async function handleProposals(request: Request, env: Env): Promise<Response> {
 const url = new URL(request.url);
 const parsed = parseProposalsQuery(url);
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef, repoList } = parsed;
 const rateDenied = rateGate("/proposals", request);
 if (rateDenied) return rateDenied;
 // Perf (measured 2026-10-08: full recompute = 13–17s live at 5 forks — the UI's
 // 20s cap kept aborting John's browser). Generation-keyed KV cache: every pushed
 // event bumps `cache:gen` (see recordEvent), so any push/land invalidates every
 // cached set by key change; TTL bounds staleness if invalidation is ever missed.
 // Cache is best-effort by design: a missing/degraded CACHE binding must never
 // turn /proposals into a 500 (test fakes and partial deployments carry no CACHE).
 let gen = "0";
 try { gen = (await env.CACHE.get("cache:gen")) ?? "0"; } catch { /* no CACHE — compute */ }
 const cacheKey = `cache:proposals:${gen}:${base}:${baseRef}:${ref}:${repoList ? repoList.join(",") : "*"}`;
 try {
  const hit = await env.CACHE.get(cacheKey);
  if (hit) return new Response(hit, { headers: { "content-type": "application/json", "x-nextgit-cache": "hit" } });
 } catch { /* cache read is best-effort — fall through to compute */ }
 const result = await computeProposals(env, base, baseRef, ref, repoList);
 const body = JSON.stringify({ ok: true, ...result });
 try { await env.CACHE.put(cacheKey, body, { expirationTtl: 360 }); } catch { /* serve regardless */ }
 return new Response(body, { headers: { "content-type": "application/json", "x-nextgit-cache": "miss" } });
}

// ---------------------------------------------------------------------------
// GET /merge?base=demo&repos=agent-1,agent-2&ref=main&baseRef=main
// ---------------------------------------------------------------------------
async function handleMerge(request: Request, env: Env): Promise<Response> {
 const url = new URL(request.url);
 const parsed = parseProposalsQuery(url);
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef, repoList } = parsed;
 if (!repoList || !repoList.length) return Response.json({ ok: false, error: "repos parameter required" }, { status: 400 });
 const rateDenied = rateGate("/merge", request);
 if (rateDenied) return rateDenied;
 const merge = await computeMerge(env, base, baseRef, repoList, ref);
 return Response.json({ ok: true, merge });
}

// ---------------------------------------------------------------------------
// GET /events
// ---------------------------------------------------------------------------
async function handleEvents(_request: Request, env: Env): Promise<Response> {
 return Response.json({ ok: true, events: await readEvents(env) });
}

// ---------------------------------------------------------------------------
// GET /floors — the Floor / Project entity (AD-14 client protocol): one
// floor per namespace repo, served from the same bounded `list()` discovery
// seam /proposals auto-discovery uses. `branch` is the list entry's
// `defaultBranch` (ArtifactsRepoListResult.repos[] carries it — no per-repo
// info() call); `cloning` is `status !== "ready"` (importing/forking).
// `counts.workers` is the discovered `agent-*` fleet size; `busy`/`waiting`
// are served as 0/count — worker-lifecycle state is client-local (entity 2);
// the platform serves the observable fleet size, the client synthesizes the
// rest. Split recorded in CONTRACT.md § Client protocol.
// ---------------------------------------------------------------------------
async function handleFloors(request: Request, env: Env): Promise<Response> {
 const rateDenied = rateGate("/floors", request);
 if (rateDenied) return rateDenied;
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const agentRepos = list.repos.filter((r) => r.name.startsWith("agent-"));
 const floors = list.repos.map((r) => ({
  id: r.name,
  name: r.name,
  repo: r.name,
  branch: r.defaultBranch,
  cloning: r.status !== "ready",
  counts: {
   workers: agentRepos.length,
   busy: 0,
   waiting: agentRepos.length,
  },
 }));
 return Response.json({ ok: true, floors });
}
// ---------------------------------------------------------------------------
// GET /proposals/{repo} — the Pull / Proposal + detail entity (AD-14 client
// protocol): the proposal card + its detail, served by driving the SAME
// compute seam /changes and /merge use (computeChangeSet for the card's
// commits/stats/files, computeMerge for the merge simulation). The
// mergeable-class signal is served as merge.status/conflicted — never as a
// field named `mergeable` (AD-14: adapter-synthesized GitHub semantics are
// never platform fields). `title` is the intent text, `state` is the
// landing verdict from the fold, `number` is the repo name. Unknown repos
// 404 at the handler (the /landings/{commit} precedent); the repo name is
// re-validated REPO_NAME_RE before any repo read (/reveal precedent).
// ---------------------------------------------------------------------------
async function handleProposalDetail(request: Request, env: Env, repoParam: string): Promise<Response> {
 if (!REPO_NAME_RE.test(repoParam)) {
  return badRequest(`invalid repo name: ${JSON.stringify(repoParam)}`);
 }

 // Demo allowlist (AD-9): the path-carried repo is the scope
 // carrier, readable only here (the dispatcher's extractScope
 // reads query params only). Same uniform 403 as /land and
 // /judge, before any computeChangeSet / computeMerge read.
 if (!DEMO_REPO_RE.test(repoParam)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${repoParam}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const parsed = parseProposalsQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef } = parsed;
 const rateDenied = rateGate("/proposals", request);
 if (rateDenied) return rateDenied;

 let changeSet;
 let merge;
 try {
  // Unknown repo -> 404 (the /landings/{commit} precedent): the
  // compute seam's first repo read (env.ARTIFACTS.get) fails for
  // a name the namespace does not carry, and the handler maps that
  // to the contract 404 rather than a 500.
  changeSet = await computeChangeSet(env, base, baseRef, repoParam, ref);
  merge = await computeMerge(env, base, baseRef, [repoParam], ref);
 } catch {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const landing = merge.files.some((f) => f.result === "withheld-secret")
  ? ({ status: "withheld-secret", files: merge.files.length } as const)
  : merge.status === "conflict"
   ? ({ status: "conflict", files: merge.conflicted.length } as const)
   : merge.files.length === 0
    ? ({ status: "landed", files: 0 } as const)
    : ({ status: "ready", files: merge.files.length } as const);

 return Response.json({
  ok: true,
  proposal: {
   repo: repoParam,
   number: repoParam,
   title: changeSet.files.find((f) => f.intent)?.intent ?? "",
   state: landing.status,
   headRef: ref,
   baseRef,
   additions: changeSet.stats.additions,
   deletions: changeSet.stats.deletions,
   stats: changeSet.stats,
   checks: [],
   detail: {
    body: changeSet.files.find((f) => f.intent)?.intent ?? "",
    commits: changeSet.commits,
    merge: { status: merge.status, conflicted: merge.conflicted },
    files: merge.files,
   },
  },
 });
}

// Route table (AD-8: single registration point; every route authorizes).
// ---------------------------------------------------------------------------

/** A registered API route. `path` matches exact paths; `dynamicPrefix` matches a prefix (e.g. "/landings/"). */
interface RouteEntry {
 path: string;
 method: "GET" | "POST";
 action: ActionType;
 handler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

/**
 * Extract the repo scope (repo/base/repos) to authorize, for routes
 * that carry them. GET /changes, /proposals, /merge pass `repo`/`base`
 * query params; `repos` is the comma-split list parseProposalsQuery
 * also applies (trimmed, empties dropped) so the chokepoint allowlist
 * fires pre-handler with the same names the handler will read.
 */
function extractScope(request: Request): AuthorizeScope {
 const url = new URL(request.url);
 const repo = url.searchParams.get("repo") ?? undefined;
 const base = url.searchParams.get("base") ?? undefined;
 const reposParam = url.searchParams.get("repos");
 const repos = reposParam
  ? reposParam.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;
 return { repo, base, repos };
}

/** Static API routes — every entry authorizes before its handler runs. */
export const ROUTES: RouteEntry[] = [
 { path: "/health", method: "GET", action: "read", handler: handleHealth },
 { path: "/changes", method: "GET", action: "read", handler: handleChanges },
 { path: "/proposals", method: "GET", action: "read", handler: handleProposals },
 { path: "/floors", method: "GET", action: "read", handler: handleFloors },
 { path: "/merge", method: "GET", action: "read", handler: handleMerge },
 { path: "/land", method: "POST", action: "write", handler: handleLand },
 // Merge-back-to-upstream (CAP-10): a fork's work routed to its
 // recorded parent. Mutating route — authorize() + the CSRF gate
 // precede the handler like every POST; the handler re-checks
 // the AD-9 allowlist on the body-carried repo/base (the /land
 // defense-in-depth precedent).
 { path: "/upstream", method: "POST", action: "write", handler: handleUpstream },
 { path: "/judge", method: "POST", action: "judge", handler: handleJudge },
 // Reveal — secret-class value behind the explicit authorization rule.
 // The dispatcher runs authorize() (mode gate) + the CSRF gate first;
 // the handler layers authorizeReveal() on top (defense-in-depth).
 { path: "/reveal", method: "POST", action: "reveal", handler: handleReveal },
 { path: "/events", method: "GET", action: "read", handler: handleEvents },
 // SSE hub proxy — tabled like every other route so the authorize() chokepoint covers it
 // (it previously sat in an inline branch below the tables and bypassed authorize: in
 // AUTH_MODE=deny the stream still opened, contradicting CONTRACT.md. Fixed 2026-10-10.)
 { path: "/events/stream", method: "GET", action: "read", handler: handleSSEStream },
 // Whoami — the viewer's elevated-reveal capability probe (read-only,
 // no secret content; the reveal affordance renders only when reveal:true).
 { path: "/whoami", method: "GET", action: "read", handler: handleWhoami },
];

export const DYNAMIC_ROUTES: Array<{ prefix: string; method: "GET" | "POST"; action: ActionType; handler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> }> = [
 { prefix: "/landings/", method: "GET", action: "read", handler: (request, env) => handleLandingsRead(new URL(request.url).pathname.slice("/landings/".length), env) },
 // /proposals/{repo} — the proposal card + detail entity (AD-14 client
 // protocol). Static `/proposals` (the set view) wins for the bare
 // path; `/proposals/<repo>` falls to this prefix (static-before-
 // dynamic, the dispatcher's exact-then-prefix order).
 { prefix: "/proposals/", method: "GET", action: "read", handler: (request, env) => handleProposalDetail(request, env, new URL(request.url).pathname.slice("/proposals/".length)) },
];

// UI document set (AD-8 boundary discipline): the wrangler-assets
// binding (env.ASSETS) serves exactly platform/ui/'s documents.
// The dispatcher's terminal fallthrough hands a request to ASSETS
// only when the path is in this whitelist; anything else is a JSON
// contract error (405 method-not-allowed on a registered path, 404
// not-found otherwise). Additive-only: a new UI file is added here
// AND to the route-discipline parity check in the same commit.
const UI_ASSET_PATHS: Record<string, true> = {
 "/": true, "": true, "/index.html": true, "/styles.css": true,
 "/app.js": true, "/reveal-decision.js": true, "/tour.html": true, "/tour.css": true, "/tour.js": true,
};

export default {
 async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  try {
   // Static route table.
   for (const route of ROUTES) {
    if (url.pathname === route.path && request.method === route.method) {
     const denied = authorize(request, env, route.action, extractScope(request));
     if (denied) return denied;
     // CSRF precondition (FR-45): mutating routes run the cookie-identity
     // gate after authorize() (so 401 and 403 repo-not-allowed keep
     // precedence) and before the handler. GET routes are unaffected.
     if (request.method === "POST") {
      const csrf = csrfGate(request);
      if (csrf) return csrf;
     }
     return await route.handler(request, env, ctx);
    }
   }

   // Dynamic routes (prefix match).
   for (const route of DYNAMIC_ROUTES) {
    if (url.pathname.startsWith(route.prefix) && request.method === route.method) {
     const denied = authorize(request, env, route.action, extractScope(request));
     if (denied) return denied;
     if (request.method === "POST") {
      const csrf = csrfGate(request);
      if (csrf) return csrf;
     }
     return await route.handler(request, env, ctx);
    }
   }


   // API boundary discipline (AD-8): a known path with the wrong
   // method, and any unknown path, must not reach the asset layer —
   // they answer with the contract JSON error. 405-before-404: a
   // wrong method on a registered path is more specific than an
   // unknown path. Both fire before authorize()/CSRF, matching the
   // handler-level 400/404/409 precedent (a malformed request is
   // rejected at the boundary without reaching the auth chokepoint).
   const knownPath =
    ROUTES.some((r) => r.path === url.pathname) ||
    DYNAMIC_ROUTES.some((r) => url.pathname.startsWith(r.prefix));
   if (knownPath) {
    return Response.json({ ok: false, error: "method-not-allowed" }, { status: 405 });
   }
   if (UI_ASSET_PATHS[url.pathname]) {
    return env.ASSETS.fetch(request);
   }
   return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  } catch (err) {
   return Response.json({ ok: false, error: scrubFreeText(String((err as Error)?.message ?? err)) }, { status: 500 });
  }
 },

 // Cron warm-up (every 5 min): keeps the /proposals KV cache hot for the demo base so
 // visitors get a <1s first paint instead of paying the 13–17s recompute (2026-10-08).
 async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
   (async () => {
    try {
     // Defensive gen read (salvage 4fdeeba): a KV fault must not kill the warmup.
     let gen = "0";
     try { gen = (await env.CACHE.get("cache:gen")) ?? "0"; } catch { /* warm the stale gen anyway */ }
     const warmDefaults = resolveRouteBase({});
     const warmBase = warmDefaults.base as string;
     const warmBaseRef = warmDefaults.baseRef as string;
     const warmRef = warmDefaults.ref as string;
     const cacheKey = `cache:proposals:${gen}:${warmBase}:${warmBaseRef}:${warmRef}:*`;
     const subsetRepos = "agent-1,agent-2,agent-3,agent-4";
     const result = await computeProposals(env, warmBase, warmBaseRef, warmRef, null);
     await env.CACHE.put(cacheKey, JSON.stringify({ ok: true, ...result }), { expirationTtl: 360 });
     // Also warm the explicit-subset key for the demo repos (salvage 650a550): explicit
     // ?repos=agent-1,agent-2,agent-3,agent-4 requests key off their own subset string
     const subsetKey = `cache:proposals:${gen}:${warmBase}:${warmBaseRef}:${warmRef}:${subsetRepos}`;
     try {
      await env.CACHE.put(subsetKey, JSON.stringify({ ok: true, ...result }), { expirationTtl: 360 });
     } catch (e) {
      console.log("warmup-subset-failed", JSON.stringify({ error: e instanceof Error ? e.name : "error" }));
     }
     console.log("warmup", JSON.stringify({ proposals: result.proposals.length }));
    } catch (e) {
     console.log("warmup-failed", JSON.stringify({ error: e instanceof Error ? e.name : "error" }));
    }
   })(),
  );
 },

 async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
   const raw = message.body as {
    type?: string;
    source?: { namespace?: string; repoName?: string };
    payload?: { ref?: string; after?: string };
   };
   const repo = raw?.source?.repoName;
   const event: LiveEvent = {
    type: raw?.type,
    repo,
    ref: raw?.payload?.ref,
    after: raw?.payload?.after,
    at: new Date().toISOString(),
   };
   if (!repo) {
    console.log("feed-drop", JSON.stringify({ type: raw?.type, namespace: raw?.source?.namespace, reason: "no-repo-identity" }));
    message.ack();
    continue;
   }
   await recordEvent(env, event);
   message.ack();
  }
 },
};
