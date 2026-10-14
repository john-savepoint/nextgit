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
 deriveAutoLandVerdict,
 buildJudgeRequest,
 validateJudgeResponse,
 scrubFreeText,
 stripInstructionLike,
 CONTENT_SECRET_MIN,
 isNoulAnswer,
 isPlainObject,
 type JudgeRepoInput,
 type AutoLandVerdict,
} from "./judge";
import { AUTO_LAND_ENGAGED, autoLandEligible, hasCleanCorroboratingSignal } from "./autoland";

import { rateAllow, rateGate, rateLimitedResponse } from "./rate";
import federationHarnesses from "../harnesses.json";

import { isAssetPointer, parseAssetPointer, readVerifiedBlob, BlobIntegrityError, type AssetPointer } from "./assets";
import {
 signAttestation,
 storeAttestation,
 type Attestation,
 type AttestationEnvironment,
 type AttestationSubject,
} from "./attest";
import {
 DEFAULT_PRESIGN_EXPIRY_SECONDS,
 MAX_MULTIPART_PARTS,
 MAX_MULTIPART_PART_BYTES,
 MIN_MULTIPART_PART_BYTES,
 R2_MAX_OBJECT_BYTES,
 S3ControlError,
 completeMultipartSession,
 createMultipartSession,
 parsePresignExpiry,
 planUpload,
 presignGetUrl,
 presignPutUrl,
 resolvePresignCredentials,
 type PresignedPart,
} from "./r2-presign";
import { computeSixClusterSignals, type SixClusterSignals } from "./fork-signals";
import { authorize, DEMO_REPO_RE, REPO_NAME_RE, csrfGate, assertSeamEnabled, authorizeReveal, revealCapability, revealDenial, revealAuditRecord, unauthorizedResponse, type ActionType, type AuthorizeScope, type RevealAuditRecord } from "./auth";

export interface Env {
 ARTIFACTS: Artifacts;
 LIVE: KVNamespace;
 CACHE: KVNamespace;
 ASSETS: Fetcher;
 AI: Ai;
 SKIP_RECORD?: KVNamespace;
 LAND_LEASE: DurableObjectNamespace;
 EVENTS_HUB: DurableObjectNamespace;
 /** R2 asset-blob bucket (AD-10; FR-47). Declared here; read only by
  * the upload path and the round-trip test — change-set/merge/fork-point
  * paths never fetch blob bytes (blob materialization is e12's
  * readVerifiedBlob chokepoint). */
 ASSET_BLOB?: R2Bucket;
 /** Off-binding SigV4 credentials for presigned direct-to-R2 transfers
  * (nextgit-serve-blobs-via-presigned-direct-to-r2-transfers). The
  * account id is a var; the key pair are wrangler secrets
  * (platform/wrangler.jsonc documents the three provisions). ANY
  * missing value fails the presign surface closed (503
  * presign-unavailable — never a silent empty-string credential). */
 ASSET_ACCOUNT_ID?: string;
 ASSET_S3_ACCESS_KEY_ID?: string;
 ASSET_S3_SECRET_ACCESS_KEY?: string;
 AUTH_MODE?: string;
 /** Explicit reveal allowlist (FR-31) — absent ⇒ default-deny. */
 REVEAL_ALLOW?: unknown;
 /** Best-effort KV audit sink for POST /reveal decisions (content-free). */
 REVEAL_AUDIT?: KVNamespace;
 /** Signed-validation-evidence R2 bucket (FR-18 authenticity
  * layer). Durable, exportable, indefinitely retained archival
  * copy of each landing's attestation — the opposite of the
  * asset bucket: no lifecycle expiry (retention IS the
  * feature). Absent ⇒ attestation degrades to the honest-
  * unavailable shape (§2.3), never a failed land. */
 EVIDENCE_BLOB?: R2Bucket;
 /** base64url PKCS#8 Ed25519 private key (Worker secret,
  * provisioned by the piped `wrangler secret put` — never
  * argv). Absent/malformed ⇒ attestation is the honest-
  * unavailable shape, never a 500 (§2.3). */
 EVIDENCE_SIGNING_KEY?: unknown;
 /** base64url RAW public key (Worker var, non-secret, pinned in
  * CONTRACT.md §Attestations). Used to derive the envelope's
  * keyId and to verify — WebCrypto cannot export the public
  * half from an imported private key. */
 EVIDENCE_PUBLIC_KEY?: unknown;
 /** CF version metadata (deploy id/tag) for the attestation
  * environment block. Absent ⇒ `environment.deploy = null`
  * (honest-unavailable). */
 CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
}

// ---------------------------------------------------------------------------
// Federation harness manifest (GET /harnesses) — the BYO onboarding
// surface. The manifest is a bundled, deploy-time artifact
// (platform/harnesses.json), validated fail-closed at module load:
// a malformed entry throws before the first request is served, so
// a bad registry can never ship a response shape. The wire schema
// is closed — exactly {name, kind, capabilities, docs} — and every
// entry is a read-only declaration: dispatch internals (bin, args,
// env, notes, probeBudgetMs) live ONLY in platform/scripts/harnesses.json
// and never egress through this surface (CONTRACT.md §GET /harnesses,
// egress law).
// ---------------------------------------------------------------------------

/**
 * One federation harness entry — the wire shape of GET /harnesses.
 * `capabilities` is the closed capability vocabulary; `docs` is the
 * harness vendor's own documentation URL (operator-facing pointer,
 * never a platform-internal path).
 */
export interface FederationHarness {
 name: string;
 kind: "byo-cli";
 capabilities: string[];
 docs: string;
}

/** The capability vocabulary — the closed set a federation entry may declare. */
const FEDERATION_CAPABILITIES: Record<string, true> = {
 "workspace-edit": true,
 "prompt-args": true,
 "probe": true,
};

/**
 * Fail-closed validator for the federation manifest (CONTRACT.md
 * §GET /harnesses). Runs once at module load over the bundled JSON;
 * ANY violation throws — the worker must not boot with a registry
 * that would serve an unvalidated shape. Closed-schema laws:
 * exactly {name, kind, capabilities, docs}; name/kind non-blank
 * strings (kind must be "byo-cli"); capabilities a non-empty array
 * of unique vocabulary members; docs an http(s) URL. Duplicate
 * names are rejected. An `endpoint` key (or any other unknown key)
 * is rejected — hosted entries are reserved and ship zero-populated.
 */
export function validateFederationRegistry(
 entries: unknown,
): FederationHarness[] {
 if (!Array.isArray(entries)) {
  throw new Error("federation manifest must be a JSON array");
 }
 const seen = new Set<string>();
 return entries.map((entry, index) => {
  if (!isPlainObject(entry)) {
   throw new Error(`federation entry ${index} must be an object`);
  }
  const keys = Object.keys(entry).sort();
  if (keys.join(",") !== "capabilities,docs,kind,name") {
   throw new Error(
    `federation entry ${index} must carry exactly {name,kind,capabilities,docs} (got ${keys.join(",")})`,
   );
  }
  const { name, kind, capabilities, docs } = entry;
  if (typeof name !== "string" || name.trim() === "") {
   throw new Error(`federation entry ${index} name must be a non-blank string`);
  }
  if (seen.has(name)) {
   throw new Error(`federation entry ${index} duplicates name "${name}"`);
  }
  seen.add(name);
  if (kind !== "byo-cli") {
   throw new Error(`federation entry ${index} kind must be "byo-cli" (got ${JSON.stringify(kind)})`);
  }
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
   throw new Error(`federation entry ${index} capabilities must be a non-empty array`);
  }
  const caps = new Set<string>();
  for (const cap of capabilities) {
   if (typeof cap !== "string" || !Object.hasOwn(FEDERATION_CAPABILITIES, cap)) {
    throw new Error(`federation entry ${index} capability ${JSON.stringify(cap)} is not in the vocabulary`);
   }
   if (caps.has(cap)) {
    throw new Error(`federation entry ${index} capability "${cap}" is duplicated`);
   }
   caps.add(cap);
  }
  if (typeof docs !== "string" || !/^https:\/\//.test(docs)) {
   throw new Error(`federation entry ${index} docs must be an https URL`);
  }
  return { name, kind, capabilities: [...capabilities], docs };
 });
}

/**
 * The validated federation manifest — the exact payload GET
 * /harnesses serves. Constructed once at module load; a malformed
 * manifest throws here (the process fails to boot, never serves
 * an unvalidated registry).
 */
const FEDERATION_HARNESSES: FederationHarness[] = validateFederationRegistry(federationHarnesses);

async function handleHarnesses(_request: Request, _env: Env): Promise<Response> {
 return Response.json({ ok: true, harnesses: FEDERATION_HARNESSES });
}



const MAX_DIFF_FILE_CHARS = 200_000; // skip line-diff above this (per side)
const MAX_PATCH_CHARS = 30_000; // truncate inline patches
export const MAX_FILES_WITH_PATCH = 50; // patch budget per change-set
// Compute-time guard (Worker CPU budget, nextgit-e16): the number of
// per-file diffs a single change-set computes before the O(size)
// stats + patch work is skipped. diffLines + createTwoFilesPatch are
// linear in the file's char count, so a change-set of many large
// files can threaten the 30s wall even when every file passes the
// MAX_DIFF_FILE_CHARS size gate. MAX_COMPUTE_PATCH_DIFFS is a
// deterministic work-unit proxy for that compute cost: it must stay
// <= MAX_FILES_WITH_PATCH so the compute budget fires BEFORE the
// patch budget exhausts. A file the compute budget skips renders an
// honest `compute-downgraded` note — degradation is visible, never a
// silent drop — and keeps its metadata row; computeMerge tolerates a
// missing `cs.texts` entry (`cs.texts[f.path]?.base ?? ""`), so a
// downgraded file folds as an empty-ancestor merge (no crash, no
// fabricated text).
export const MAX_COMPUTE_PATCH_DIFFS = 40;
const NOTES_REF = "refs/notes/commits"; // git-notes for commit intent
const EVENTS_KEY = "recent"; // KV key: recent event feed
const MAX_EVENTS = 50; // event feed cap

// FR-18 validation evidence bounds (POST /land `validation` request field).
const MAX_VALIDATION_CHECKS = 32;
const MAX_VALIDATION_TEXT = 256;
const MAX_ARTIFACT_REF = 512;
const MERGED_SHA_CHECK = "merged-sha-equals-tested-sha"; // reserved ledger check name
const LANDING_KEY_PREFIX = "landing:"; // KV LIVE: landing record keyed by commit

// Repo-browsing read API bounds (CONTRACT.md §GET /tree, §GET /raw,
// §GET /commits). MAX_TREE_DEPTH caps the resolved subdirectory depth
// of a /tree path (a deeper path is a 400, never a walk). MAX_RAW_BYTES
// caps /raw byte egress — a blob above the cap is a 413 before the body
// is assembled. §GET /commits reuses the same read seam: MAX_COMMIT_LIMIT
// caps the commit-log page (a present `limit` above it clamps, never walks).
const MAX_TREE_DEPTH = 32;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const DEFAULT_COMMIT_LIMIT = 20;   // §GET /commits page size when `limit` is absent
const MAX_COMMIT_LIMIT = 100;      // §GET /commits hard cap — the walk's resource bound

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
 /** R2 asset pointer (AD-10) — pointer rows render metadata only. */
 asset?: AssetPointer;
 /** Per-file classification (judge idea 12) — language/role/sensitivity. */
 classification?: FileClassification;
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

export const FORK_LOG_LIMIT = 200;

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

/**
 * The pure fork-point walk core: given two newest-first logs
 * (base first, proposal second), return the newest hash shared
 * by both — the first hit in the PROPOSAL's log (newest by
 * position, since `log` is newest-first). `undefined` when
 * nothing is shared. Extracted from `forkPoint` verbatim (the
 * `baseShas` Set + `proposalLog.find` walk) so the walk is
 * directly testable — pointer files in either tree cannot
 * change the walk's input (the logs are commit metadata,
 * never tree contents), which is the G3 invariance proof.
 */
export function findSharedFirstParent(
 baseLog: ArtifactsCommitMetadata[],
 proposalLog: ArtifactsCommitMetadata[],
): string | undefined {
 const baseShas = new Set(baseLog.map((c) => c.hash));
 // Newest-first in the proposal's own log, so the first hit is the fork point.
 return proposalLog.find((c) => baseShas.has(c.hash))?.hash;
}

export async function forkPoint(
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
  const shared = findSharedFirstParent(baseLog, proposalLog);
  if (shared) {
   const head = await commitHead(proposalRepo, shared, proposalRef);
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

// Session steering (nextgit-e16, CONTRACT.md §GET /sessions /
// §POST /sessions/{repo}/steer). The steer instruction is
// untrusted free text (AD-4) — capped before it reaches any
// state. SESSION_WORKING_WINDOW_MS is the feed-recency bound
// the state derivation uses: a repo whose newest feed event is
// younger than the window reads "working", older reads "idle"
// (honest v1 — the state is feed-evidence-derived, never
// process-observed; see CONTRACT §GET /sessions).
const SESSION_EVENT_TYPE = "session.steered";
const MAX_STEER_INSTRUCTION_CHARS = 500;
const SESSION_WORKING_WINDOW_MS = 15 * 60_000;

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
// Agent identity — the harness a repo declares as its agent.
// ---------------------------------------------------------------------------

/** Harness note cap — the NEXTGIT_AGENT note is agent-declared text (AD-4). */
const MAX_AGENT_HARNESS_CHARS = 128;

/**
 * Read the repo's declared harness from the `nextgit-notes` mirror:
 * the note whose path ends `/NEXTGIT_AGENT`. Unrecorded (no note,
 * unreadable notes tree) → "unrecorded" — the roster's typed-null
 * posture, never a fabricated harness. Best-effort like readIntent:
 * a note read failure degrades to "unrecorded", never fails the roster.
 */
async function readAgentHarness(repo: ArtifactsRepo): Promise<string> {
 try {
  const notes = await readNotes(repo);
  const hash = Array.from(notes).find(([p]) => p.endsWith("/NEXTGIT_AGENT"))?.[1];
  if (!hash) return "unrecorded";
  const blob = await repo.readBlob(hash);
  if (!blob) return "unrecorded";
  const text = (await blob.text()).trim();
  if (!text) return "unrecorded";
  return text.slice(0, MAX_AGENT_HARNESS_CHARS);
 } catch {
  return "unrecorded"; // harness is best-effort — never fail the roster on it
 }
}

// ---------------------------------------------------------------------------
// Secret classes (CONTRACT masking law) — values must never leave the worker.
// ---------------------------------------------------------------------------

// Secret-path rule (judge idea 12) — the classification
// authority moved to ./classify (single source); this
// re-export keeps every existing caller (route handlers,
// the judge injection seam, computeChangeSet) working.
export { isSecretPath } from "./classify";
import { classifyFile, isSecretPath } from "./classify";
import type { FileClassification } from "./classify";

// KEY=VALUE line shape for secret-value extraction —
// stays here with secretKeys()/revealKeyValue() (they
// read text; classification does not).
const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

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
 /** R2 asset pointer (AD-10) — pointer rows render metadata only. */
 asset?: AssetPointer;
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

export async function computeMerge(
 env: Env,
 baseName: string,
 baseRef: string,
 repoList: string[],
 ref: string,
 ancestorOut?: Record<string, string>,
 opts?: { forLand?: boolean },
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
  /** R2 asset pointer (AD-10) — pointer rows never merge text. */
  asset?: AssetPointer;
  /**
   * Raw pointer JSON bytes the land fold pushes (AD-10). Only the
   * forLand caller reads it — the /merge and /proposals callers keep
   * pointer rows `merged`-free (rendering law).
   */
  pointerText?: string;
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
   if (isAssetPointer(f.path)) {
    // Pointer row: mirror the `f.binary` precedent. The fold
    // carries the pointer so the emission loop renders metadata
    // only — pointer JSON can never leak into a merge response
    // body (the info-disclosure class adversarial-review F12
    // named).
    if (f.status === "removed") {
     // A removed pointer is a real deletion: the base carried the
     // pointer and the proposal dropped it, so the land removes it
     // from the base and reclaims its blob (the e12 lifecycle
     // seam). The deleted pointer is the BASE side's — the head
     // has no text for a removed path.
     fold.deleted = true;
     fold.conflicted = false;
     fold.asset = fold.baseText ? (parseAssetPointer(fold.baseText) ?? undefined) : undefined;
     fold.note = `removed by ${repoName}`;
     continue;
    }
    fold.asset = f.asset;
    // Land fold only: carry the raw pointer text so pushLand
    // writes the exact bytes. The /merge and /proposals callers
    // omit `merged` (rendering law) — see the emission's
    // `forLand` gate below.
    fold.pointerText = (await readContent(headRepo, ref, f.path))?.text ?? "";
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
   files.push({ path, action, result: "merged", ...(fold.asset ? { asset: fold.asset } : {}), note: fold.note ?? "removed by a proposal" });
   continue;
  }
  if (fold.binary) {
   files.push({ path, action, result: "merged", note: "binary file; text merge skipped" });
   continue;
  }
  if (fold.asset !== undefined || isAssetPointer(path)) {
   // Land fold only: a pointer whose bytes already match the base head is
   // not a change — an already-landed pointer must re-fold to no-changes,
   // not re-push (mirrors the text no-change drop below; the change-set is
   // fork-point-anchored, so it keeps listing the landed pointer). /merge
   // still renders the row: the metadata-only rendering law is unchanged.
   if (opts?.forLand && fold.pointerText === fold.baseText) continue;
   files.push({
    path,
    action,
    result: "merged",
    asset: fold.asset,
    ...(opts?.forLand ? { merged: fold.pointerText } : {}),
    note: "asset pointer; metadata only",
   });
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

export async function computeChangeSet(
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

 // Compute budget (Worker CPU budget, nextgit-e16): counts the
 // per-file diffs this change-set computes. The guard below
 // fires at MAX_COMPUTE_PATCH_DIFFS to keep a large change-set
 // inside the 30s wall; `computeDiffs` increments once per
 // iteration (no double-increment — that would fire the guard
 // at half the budget).
 let computeDiffs = 0;
 const texts: Record<string, FileTexts> = {};
 let patchBudget = MAX_FILES_WITH_PATCH;
 for (const f of files) {
  // Judge idea 12 — stamp the per-file classification
  // (language/role/sensitivity; pure path law, zero
  // extra reads) on every row of the projection.
  f.classification = classifyFile(f.path, { binary: !!f.binary });
  // text reads (the F12 fix): a pointer row never enters the
  // binary check, so a hostile pointer with NUL bytes still
  // renders its metadata row instead of being silently skipped.
  // No blob bytes are ever read: pointer metadata is egress
  // (AD-4), blob materialization is e12's chokepoint. The
  // secret-class check wins (CONTRACT §Secret classes: key
  // names only): a pointer planted at a secret-class path masks
  // to key names — no asset metadata egress (STRIDE-I1). Mirrors
  // the fold (computeMerge), which already checks isSecretPath
  // before isAssetPointer.
  if (!isSecretPath(f.path) && isAssetPointer(f.path)) {
   const pointerText = (await readContent(headRepo, ref, f.path))?.text ?? "";
   const parsed = parseAssetPointer(pointerText);
   f.asset = parsed ?? undefined;
   f.note = parsed
    ? `asset pointer → R2 ${parsed.blobId} (${parsed.size} bytes, sha256 ${parsed.sha256.slice(0, 12)}…)`
    : "asset pointer; unparseable metadata (format violation)";
   continue; // no binary read, no diff, no patch, no texts entry, no additions/deletions
  }
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
  // Compute budget guard (Worker CPU budget, nextgit-e16):
  // skip the O(size) stats + patch computation once the
  // change-set's computed-diff budget is spent, keeping a
  // large change-set inside the 30s wall. The row stays
  // (honest degradation, never a silent drop) with a note
  // naming the budget; computeMerge tolerates a missing
  // texts entry, so the file folds as an empty-ancestor
  // merge. The guard must fire before the patch
  // construction — the wall-threatening work.
  if (computeDiffs >= MAX_COMPUTE_PATCH_DIFFS) {
   f.note = "compute-downgraded: patch omitted at the change-set compute budget (40 diffs)";
   continue;
  }
  computeDiffs++;

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

export type ConflictKind =
 | "text-conflict"
 | "modify/delete"
 | "add/add"
 | "undetermined"
 | "mergeable"
 | "identical-add"
 | "both-removed";

export interface ProposalEntry {
 repo: string;
 status: "added" | "modified" | "removed";
 texts: FileTexts | null;
}

export const KIND_SEVERITY: Record<ConflictKind, number> = {
 "text-conflict": 4,
 "modify/delete": 4,
 "add/add": 4,
 undetermined: 3,
 mergeable: 1,
 "identical-add": 1,
 "both-removed": 1,
};

export function classifyPair(a: ProposalEntry, b: ProposalEntry): {
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
  forkSha?: string; // the change-set fork point (computeChangeSet's
  // base.sha — the out-param pattern: published for the /checks
  // projection's `base` check AND served on the row as commit
  // metadata (the same non-secret class as `head`, allowlist-gated;
  // CONTRACT documents it on the /proposals row shape).
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
   /** R2 asset pointer (AD-10) — pointer rows render metadata only. */
   asset?: AssetPointer;
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
    forkSha: cs.base.sha,
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
     classification: f.classification,
     note: f.note,
     asset: f.asset,
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
 // Session steering (nextgit-e16): the scrubbed steer
 // instruction rides the frame for session.steered events
 // (the AD-4 wire — stripInstructionLike(scrubFreeText(...))
 // at the seam, never the raw text). Absent on every other
 // event type (validateEvent does not require it).
 instruction?: string;
 // Per-event uniqueness (nextgit-e16 heal-1): a fresh id on
 // session.steered frames (the /comments newCommentId precedent)
 // so the feed-dedup key never collides between two client-
 // initiated steers to one repo. Absent on every other event
 // family — their type|repo|ref|after replay-dedup semantics
 // are unchanged (validateEvent does not require it).
 id?: string;
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
 // session.steered carries a per-event id (every steer is a
 // NEW event — the client-initiated write is not a queue
 // replay, so it must never share a key with an earlier
 // steer to the same repo). Absent on every other event
 // family, whose type|repo|ref|after replay-dedup
 // semantics are unchanged.
 return t + "|" + (event.repo || "") + "|" + (event.ref ?? "") + "|" + (event.after ?? "") + "|" + (event.id ?? "");
}

async function recordEvent(env: Env, event: LiveEvent): Promise<boolean> {
 if (!validateEvent(event)) {
  console.log("feed-reject", JSON.stringify({ type: event?.type, repo: event?.repo, reason: "validation-failed" }));
  return false;
 }
 const events = await readEvents(env);
 const key = eventDedupKey(event);
 if (events.some((e) => eventDedupKey(e) === key)) {
  console.log("feed-dedup", JSON.stringify({ type: event.type, repo: event.repo, ref: event.ref, after: event.after }));
  return false;
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
 return true;
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
 // Session steering (nextgit-e16): the steer write records a
 // session.steered event into the same feed GET /events serves.
 // Not in CACHE_INVALIDATING_TYPES: steering changes no
 // change-set (the token-event reasoning).
 "session.steered": true,
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
 gate?: unknown;
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
 // Engagement is a server-side, record-gated constant (AD-11 / FR-26) —
 // never a client-supplied flag. A `gate` field is rejected outright.
 if (body.gate !== undefined) {
  return badRequest("gate is not a client-supplied field (engagement is server-side and record-gated)");
 }
 return { base, repos, baseRef, ref, reviewed, validation };
}

/**
 * The attestation environment block (CONTRACT.md
 * §Attestations): the platform identity plus the deploy's
 * version metadata. `CF_VERSION_METADATA` is optional —
 * absent ⇒ `deploy`/`tag` are null (honest-unavailable,
 * never a fabricated version).
 */
function buildEnvironment(env: Env): AttestationEnvironment {
 const meta = env.CF_VERSION_METADATA;
 return {
  worker: "nextgit-platform",
  deploy: typeof meta?.id === "string" ? meta.id : null,
  tag: typeof meta?.tag === "string" ? meta.tag : null,
  runtime: "workerd",
 };
}

/**
 * ONE writer of the attestation for a landing: sign, then
 * best-effort store the durable R2 copy, then return the
 * envelope. Both POST /land and POST /upstream call only
 * this (AD-1: no second writer). A store failure logs
 * `attestation-store-failed` and never alters the
 * response — the land already pushed (§2.3/§2.4).
 */
async function attachAttestation(
 env: Env,
 input: { subject: AttestationSubject; evidence: Record<string, unknown> },
): Promise<Attestation> {
 const attestation = await signAttestation(env, {
  subject: input.subject,
  environment: buildEnvironment(env),
  evidence: input.evidence,
 });
 if (attestation.status === "signed") {
  const key = await storeAttestation(env, input.subject.commit, attestation);
  if (key === null) {
   console.log("attestation-store-failed", JSON.stringify({ commit: input.subject.commit }));
  }
 }
 return attestation;
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
 // forLand: pointer rows carry the raw pointer text so the push set
 // below includes them (the pointer rides the fold — STRIDE-I2). The
 // /merge and /proposals callers omit the flag, so their responses keep
 // pointer rows `merged`-free (rendering law).
 const ancestors: Record<string, string> = {};
 const merge = await computeMerge(env, base, baseRef, repos, ref, ancestors, { forLand: true });


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
 // Engagement is the record-gated switch in ./autoland (OFF by default);
 // while unengaged this route makes NO judge call and behaves exactly as
 // it did before the gate existed. When engaged, every /land must be
 // answered by the pinned model (fail closed), and a favorable verdict
 // alone never auto-lands — the non-model corroborating interlock below
 // (fold status / conflict map) must also be clean (AD-11: code decides).
 let autoLand: AutoLandVerdict | null = null;
 if (AUTO_LAND_ENGAGED) {
  // Eligibility: the calibration record must pass record-check. The
  // record is enforced at DEPLOY/VERIFICATION time by
  // porting/calibration/engagement-check.mjs (runs record-check.mjs
  // as a subprocess; fails the repo non-zero when AUTO_LAND_ENGAGED
  // is true and the record is absent/failing). Workers have no
  // filesystem (AD-11), so the runtime constant IS the gate — the
  // record outcome is not readable at request time; this guard is
  // fail-closed defense-in-depth should the predicate ever gain a
  // real record input.
  if (!autoLandEligible(true)) {
   console.log("autoland-ineligible", JSON.stringify({ route: "/land", reason: "calibration-record-failing" }));
   return judgeUnavailable();
  }
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
  // Non-model corroboration interlock: a favorable judge verdict (ACT/
  // CONFIRM) alone never auto-lands. The fold status and conflict map
  // (the non-model signals computeMerge already produced above at the
  // `merge` binding) must be clean — a non-empty conflict map or an
  // unclean fold status blocks the land regardless of the judge's
  // answers (AD-11). This refusal fires BEFORE the generic conflict 409
  // so the refusal is attributable to the interlock, not the fold.
  if (!hasCleanCorroboratingSignal(merge)) {
   console.log("autoland-blocked", JSON.stringify({ setId: gate.setId, foldStatus: merge.status, conflicted: merge.conflicted.length }));
   return Response.json(
    {
     ok: false,
     error: "autoland-blocked",
     verdict: gate.verdict,
     setId: gate.setId,
     foldStatus: merge.status,
     conflicted: merge.conflicted,
    },
    { status: 409 },
   );
  }
  // ACT/CONFIRM with a clean non-model signal: the verdict rides the
  // evidence record below.
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
 // R2 asset pointers carried by this fold's pointer rows (both
 // write and delete folds carry the parsed pointer — the
 // reference-counted reclamation set for the post-push GC
 // step). Bounded by the fold's own file count (NFR-1).
 const foldPointers: AssetPointer[] = merge.files
  .filter((f) => f.asset !== undefined)
  .map((f) => f.asset as AssetPointer);
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
    ...(foldPointers.length > 0 ? { assetPointers: foldPointers, env } : {}),
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
    ...(autoLand ? { autoLand } : {}), // engaged-only; unengaged evidence is byte-identical to the pre-gate 12-key shape
   };
   // The attestation (FR-18 authenticity layer): the signed envelope
   // covers every field above plus the land's subject. Signed after the
   // evidence is assembled, before the KV record is persisted, so the
   // persisted record carries the same envelope the 200 returns. Best-
   // effort: an absent key degrades to the honest-unavailable shape,
   // never a failed land (§2.3).
   const attestation = await attachAttestation(env, {
    subject: { commit, repos, base, ref, baseRef },
    evidence,
   });
   // The landing record (FR-18) persists keyed by the returned commit — the
   // address the read surface serves. KV `LIVE` stays single-writer: this is
   // its only landing-record writer. The push already happened, so a storage
   // failure is logged and degraded, never reported as a failed land.
   try {
    await env.CACHE.put(`${LANDING_KEY_PREFIX}${commit}`, JSON.stringify({ landed, evidence, attestation }));
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
   return Response.json({ ok: true, landed, evidence, attestation });
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
 // The same fold-pointer seam as /land — /upstream delegates to
 // the same pushLand critical section, so the reference-counted
 // reclamation must see the same set (no behavioral divergence
 // between the two land surfaces).
 const foldPointers: AssetPointer[] = merge.files
  .filter((f) => f.asset !== undefined)
  .map((f) => f.asset as AssetPointer);
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
    ...(foldPointers.length > 0 ? { assetPointers: foldPointers, env } : {}),
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
   // The attestation (FR-18 authenticity layer): mechanically the
   // /land envelope — the same single writer (`attachAttestation`),
   // the degenerate no-validation subject. Best-effort, honest-
   // unavailable on an absent key (§2.3) — the push already happened.
   const attestation = await attachAttestation(env, {
    subject: { commit, repos: [repo], base, ref: DEFAULT_REF, baseRef: DEFAULT_REF },
    evidence,
   });
   // The landing record (FR-18) persists keyed by the returned
   // commit — the address the read surface serves. KV `LIVE` stays
   // single-writer: this is its only landing-record writer. The
   // push already happened, so a storage failure is logged and
   // degraded, never reported as a failed land.
   try {
    await env.CACHE.put(`${LANDING_KEY_PREFIX}${commit}`, JSON.stringify({ landed, evidence, attestation }));
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
   return Response.json({ ok: true, landed, evidence, attestation });
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
 * pinned model — so the gate and the card chips can never diverge
 * in what they asked. Fails closed on every failure mode: no AI
 * binding, a thrown run, or any validation miss => 503
 * judge-unavailable with zero repos landed. Exported so the
 * engaged-posture suite drives the real gate at the seam.
 */
export async function judgeLandGate(env: Env, base: string, baseRef: string, repos: string[], ref: string): Promise<AutoLandVerdict | Response> {
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
// POST /intents — declare an intent before building; the platform
// matches it against the fork ecosystem and returns the CAP-10
// three-state verdict (merge-it | use-as-context | ignore) plus
// the candidate forks whose signals drove it (CONTRACT.md §POST
// /intents; companion fork-community.md). Advisory only: the route
// writes nothing and lands nothing (mirrors /judge).
// ---------------------------------------------------------------------------

/** Intent is untrusted caller text (AD-4) — cap it before it reaches any state. */
const MAX_INTENTS_CHARS = 2048; // the contract-pinned body cap

/** The matcher's three-state verdict vocabulary — the pinned wire tokens. */
type MatcherVerdict = "merge-it" | "use-as-context" | "ignore";

/** Closed request schema for POST /intents (AD-9): exactly {intent, base?}. */
interface IntentsRequestBody {
 intent?: unknown;
 base?: unknown;
}

/**
 * Validate the /intents body — the closed-schema twin of
 * parseJudgeBody / parseUpstreamBody (unknown field → 400).
 * `intent` is required, non-empty, ≤2048 chars; `base` resolves
 * through resolveRouteBase (the AD-8 single-source seam) and is
 * REPO_NAME_RE-checked. The AD-9 demo-allowlist check happens in
 * the handler (the body is parsed only there — the /judge
 * defense-in-depth precedent).
 */
function parseIntentsBody(raw: unknown): { intent: string; base: string } | Response {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("bad-request");
 const body = raw as IntentsRequestBody;
 if (!Object.keys(body).every((k) => k === "intent" || k === "base")) {
  return badRequest("bad-request");
 }
 const intent = body.intent;
 if (typeof intent !== "string" || !intent || intent.length > MAX_INTENTS_CHARS) {
  return badRequest("bad-request");
 }
 const { base } = resolveRouteBase({ base: body.base });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest("bad-request");
 }
 return { intent, base };
}

/**
 * The matcher-confidence rank (thresholds in code per AD-11) — the single
 * ordering function shared by deriveMatcherVerdict and the /intents
 * response order: CONTRACT.md §POST /intents pins the candidates
 * "ordered by the matcher's confidence".
 */
const rankSignals = (s: SixClusterSignals) =>
 (s.fitOverlap ?? 0) - (s.distance ?? 0) + (s.liveness ?? 0) * 0.1 + (s.proof ?? 0) * 0.1;

/**
 * The three-state derivation over the per-candidate cluster
 * vectors (thresholds in code per AD-11) — the pure-derivation
 * twin of deriveAutoLandVerdict: the strongest candidate drives
 * the verdict. Fit-driven (high overlap, low distance) →
 * merge-it; partial fit → use-as-context; non-aligned → ignore.
 * No single signal auto-selects: every cluster is advisory
 * (the flip property — the verdict is the aggregate, not one
 * signal).
 */
function deriveMatcherVerdict(
 candidates: Array<{ repo: string; signals: SixClusterSignals }>,
): MatcherVerdict {
 let best: { repo: string; signals: SixClusterSignals } | null = null;
 for (const candidate of candidates) {
  if (!best || rankSignals(candidate.signals) > rankSignals(best.signals)) best = candidate;
 }
 if (!best) return "ignore";
 const { fitOverlap, distance } = best.signals;
 // fitOverlap is null only on the zero-file change-set degenerate (the
 // /judge "empty-change-set" case — a change-set /proposals would have
 // skipped); distance is never null (conflictShare falls back to 0). The
 // null arm is single-source: keep it for that one degenerate, never as a
 // general path — wave-11's GET /forks consumes computeSixClusterSignals
 // directly and inherits this reasoning.
 if (fitOverlap === null || distance === null) return "use-as-context";
 if (fitOverlap >= 0.6 && distance <= 0.4) return "merge-it";
 if (fitOverlap >= 0.3) return "use-as-context";
 return "ignore";
}

/**
 * POST /intents — the intent matcher (CAP-10). Precondition
 * order mirrors /judge: 400 (shape) → 429 → 403 → 200. The
 * dispatcher's authorize() + csrfGate() precede this handler
 * for free (the same posture as /judge); the handler re-checks
 * the AD-9 allowlist on the body-carried base (the /judge
 * defense-in-depth precedent — the body is parsed only here).
 * Advisory-only: writes nothing, lands nothing. Content-free
 * log counts only — never the intent text.
 */
async function handleIntents(request: Request, env: Env): Promise<Response> {
 const parsed = parseIntentsBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;

 // AD-4 seam wire (CONTRACT.md §POST /intents): the untrusted intent is
 // stripped + scrubbed where it enters matcher state — the judge.ts
 // cleanUntrustedText twin (stripInstructionLike(scrubFreeText(...))).
 // The matcher is intent-structural today (the verdict is a pure function
 // of the discovered forks' structure, so the normalized intent does not
 // change it); wave-11's GET /forks inherits this wired seam.
 const intent = stripInstructionLike(scrubFreeText(parsed.intent));

 const rateDenied = rateGate("/intents", request);
 if (rateDenied) return rateDenied;

 // Demo allowlist (AD-9) — the POST /intents body is the scope
 // carrier, readable only here. Same uniform 403 as the
 // authorize() chokepoint, before any repo read.
 if (!DEMO_REPO_RE.test(parsed.base)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: "repo " + JSON.stringify(parsed.base) + " is outside the demo allowlist" },
   { status: 403 },
  );
 }

 // Candidate discovery: the same bounded list() seam /proposals
 // auto-discovery uses (agent-* forks, status ready).
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const candidates: Array<{ repo: string; signals: SixClusterSignals }> = [];
 for (const entry of list.repos) {
  if (!entry.name.startsWith("agent-") || entry.status !== "ready") continue;
  // A candidate the base cannot read (unresolvable ref, missing
  // repo) contributes no signals — the matcher skips it, never
  // fails the whole request (per-candidate fail-closed).
  let signals: SixClusterSignals;
  try {
   signals = await computeSixClusterSignals(env, parsed.base, DEFAULT_REF, entry.name);
  } catch {
   continue;
  }
  candidates.push({ repo: entry.name, signals });
 }

 // Wire order (CONTRACT.md §POST /intents): candidates are presented
 // strongest-first by the matcher's own confidence — the same rankSignals
 // the verdict derivation consumes (one ordering function, no divergence).
 candidates.sort((a, b) => rankSignals(b.signals) - rankSignals(a.signals));

 const verdict = deriveMatcherVerdict(candidates);
 // Platform-generated rationale only — the untrusted intent text
 // never echoes into any response field (AD-4).
 const rationale = "verdict " + verdict + " over " + candidates.length + " candidate fork(s)";
 // Content-free log: counts only — never the intent, never content.
 console.log("intents", JSON.stringify({ verdict, candidates: candidates.length }));
 return Response.json({
  ok: true,
  verdict,
  candidates: candidates.map((c) => ({
   repo: c.repo,
   rationale,
   signals: c.signals,
  })),
 });
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
 const parsed = JSON.parse(record) as { landed: object; evidence: object; attestation?: Attestation | null };
 // A record written before the attestation layer has no
 // `attestation` key: the typed-absent path serves
 // `attestation: null` (the `unmeasured` precedent) —
 // never a fabricated signature (§2.3). A post-feature
 // record serves its stored envelope verbatim.
 const attestation = "attestation" in parsed ? parsed.attestation : null;
 return Response.json({ ok: true, landed: parsed.landed, evidence: parsed.evidence, attestation });
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
 try { await env.REVEAL_AUDIT.put(k, JSON.stringify(rec)); } catch (e) { console.error("reveal-audit: write failed — " + String(e)); }
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
// GET /asset/{blobId} — the asset download route (e12 integrity row;
// FR-47). The pointer-less content-addressed read: the blobId key IS
// the content hash, so the expectation is the key itself. The
// readVerifiedBlob chokepoint verifies both directions before any byte
// egress; a BlobIntegrityError maps to the contract's non-2xx
// {ok:false,error:"integrity"} (422) — a digest-class failure, not a
// key-existence oracle and not an unexpected 500.
// ---------------------------------------------------------------------------
async function handleAssetDownload(request: Request, env: Env): Promise<Response> {
 // The prefix-stripped remainder of the path, the /landings/ idiom
 // (the registration below slices "/asset/".length).
 const remainder = new URL(request.url).pathname.slice("/asset/".length);
 // Suffix dispatch (CONTRACT.md §GET /asset/{blobId}/presign): the
 // presign surface rides THIS one /asset/ GET registration — no
 // dispatcher change, no second route, and the download route's
 // 400 law below is untouched (an "<x>/presign" remainder whose x is
 // not a 64-hex key is still a 400 bad-request).
 if (remainder.endsWith(ASSET_PRESIGN_SUFFIX)) {
  return await handleAssetPresign(request, env, remainder.slice(0, -ASSET_PRESIGN_SUFFIX.length));
 }
 const blobId = remainder;
 if (!BLOB_KEY_RE.test(blobId)) {
  return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
 }
 try {
  const bytes = await readVerifiedBlob(env, blobId, blobId);
  // readVerifiedBlob returned only verified bytes (actual ===
  // expectedSha256 === blobId) and is the single byte-returning
  // ASSET_BLOB.get in platform/src/** — the handler never
  // re-fetches (a second .get would break the chokepoint's
  // exactly-one-read property). The pointer-mediated variant
  // carries the pointer's contentType at the caller layer; the
  // pointer-less download serves the binary default. A fresh
  // ArrayBuffer-backed view makes the verified bytes a valid
  // BodyInit (the assetPointerFor:96-103 idiom).
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
 } catch (err) {
  if (err instanceof BlobIntegrityError) {
   return Response.json({ ok: false, error: "integrity" }, { status: 422 });
  }
  throw err;
 }
}

// ---------------------------------------------------------------------------
// Presigned direct-to-R2 transfers (AD-10; FR-47) — the asset tier's
// control/data-plane split (CONTRACT.md §GET /asset/{blobId}/presign,
// §POST /asset/uploads, §POST /asset/uploads/{uploadId}/complete).
//
// Measured constraint: a Worker request body caps at 100 MiB (Free/Pro)
// / 5 GiB (Enterprise), so the Worker cannot proxy a multi-GB asset. R2
// holds objects to 5 TiB with 5 GiB parts, and presigned URLs live 1 s to
// 7 d. The grant therefore mints URLs: the client's bytes travel DIRECTLY
// to the bucket (T2 — no Worker in the data path); the Worker issues only
// the Create/Complete control frames over the S3 API (T3) and never sees
// an asset byte (128 MB Worker memory is never approached).
//
// Precondition order: 400 (shape) -> 403 (AD-9 allowlist, BEFORE any
// mint — a repo outside the demo namespace must never receive a URL) ->
// 429 (rate, ROUTE_RATE_LIMITS["/asset-uploads:write"]) -> 503
// (credentials absent — fail-closed) -> 200. The dispatcher's authorize()
// + csrfGate() precede every handler for free (the /sessions/ dynamic-POST
// posture).
//
// Secret hygiene: a presigned URL is a bearer token (credential-
// adjacent). It is minted per request, returned ONLY in that mint
// response, never stored (the assets.ts no-URL-egress law: not in
// pointers, not in events), and never logged — the log lines below are
// content-free (key, mode, counts).
// ---------------------------------------------------------------------------

/** The R2 asset bucket the presign surface signs against — the bucket the
 *  ASSET_BLOB binding (`nextgit-asset-blobs`, platform/wrangler.jsonc)
 *  points at, and upload-asset.mjs's default R2_BUCKET. */
const ASSET_BUCKET_NAME = "nextgit-asset-blobs";

/** The path suffix that rides the existing /asset/ GET prefix. */
const ASSET_PRESIGN_SUFFIX = "/presign";

/** The content-addressed blob key shape: hex-64 sha256 (the blobId key
 *  IS the content hash — the tier's single key classifier). */
const BLOB_KEY_RE = /^[0-9a-f]{64}$/;

/** Asset-path cap (a declaration field, never a payload — the pointer
 *  file is ≤ 1 MiB by its own law, the path is far shorter). */
const MAX_ASSET_PATH_CHARS = 1024;

/** content-type cap (a header value, never free text). */
const MAX_ASSET_CONTENT_TYPE_CHARS = 255;

/** One S3 byte-range header value: a single range (S3 accepts no more). */
const RANGE_HEADER_RE = /^bytes=(?:\d+-\d*|-\d+)$/;

/** A part ETag: hex with optional quotes and the multipart `-N` suffix —
 *  the XML-injection guard for the value interpolated into the Complete
 *  body (S3 part ETags are md5 hex; nothing else is accepted). */
const PART_ETAG_RE = /^"?[0-9a-fA-F]+(?:-[0-9]+)?"?$/;

/** The closed POST /asset/uploads body (CONTRACT.md). */
interface AssetUploadGrantBody {
 repo?: unknown;
 path?: unknown;
 sha256?: unknown;
 size?: unknown;
 contentType?: unknown;
 partSize?: unknown;
}

/** The closed POST /asset/uploads/{uploadId}/complete body. */
interface AssetUploadCompleteBody {
 repo?: unknown;
 sha256?: unknown;
 parts?: unknown;
}

/** The uniform fail-closed answer when the presign credentials are absent
 *  (never a silent empty-string credential, never a fallback). */
function presignUnavailableResponse(): Response {
 return Response.json({ ok: false, error: "presign-unavailable" }, { status: 503 });
}

/**
 * Map an S3 control-plane failure to the contract's 502 — the S3 status
 * is the ONLY detail carried (never an S3 error body, endpoint, or
 * credential), and a transport failure is reported as unreachable. A
 * failed control frame is never a 500 (the S3-409-never-500 law): the
 * request was well-formed and the upstream said no.
 */
function s3ControlFailure(error: string, err: unknown): Response {
 const detail = err instanceof S3ControlError ? `s3 status ${err.status}` : "s3 unreachable";
 console.log(error, JSON.stringify({ detail }));
 return Response.json({ ok: false, error, detail }, { status: 502 });
}

/**
 * Parse the closed POST /asset/uploads body: exactly {repo, path, sha256,
 * size, contentType?, partSize?}. Every field is validated BEFORE any
 * mint, and unknown keys are refused (the /sessions closed-schema law).
 * `path` must be an asset-pointer path (`assets/<name>.asset.json`, the
 * tier's own single-source classifier): a grant exists to serve the
 * pointer that will reference the blob, so the mint can never be scoped
 * to an arbitrary path.
 */
function parseAssetUploadGrantBody(raw: unknown): {
 repo: string;
 path: string;
 sha256: string;
 size: number;
 contentType?: string;
 partSize?: number;
} | Response {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("bad-request");
 const body = raw as AssetUploadGrantBody;
 if (!Object.keys(body).every((k) => k === "repo" || k === "path" || k === "sha256" || k === "size" || k === "contentType" || k === "partSize")) {
  return badRequest("bad-request");
 }
 if (typeof body.repo !== "string" || !REPO_NAME_RE.test(body.repo)) {
  return badRequest(`invalid repo: ${JSON.stringify(body.repo)}`);
 }
 if (
  typeof body.path !== "string" ||
  body.path === "" ||
  body.path.length > MAX_ASSET_PATH_CHARS ||
  body.path.startsWith("/") ||
  body.path.endsWith("/") ||
  body.path.split("/").includes("..") ||
  !isAssetPointer(body.path)
 ) {
  return badRequest(`invalid path: ${JSON.stringify(body.path)}`);
 }
 if (typeof body.sha256 !== "string" || !BLOB_KEY_RE.test(body.sha256)) {
  return badRequest(`invalid sha256: ${JSON.stringify(body.sha256)}`);
 }
 if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 0 || body.size > R2_MAX_OBJECT_BYTES) {
  return badRequest(`invalid size: 0..${R2_MAX_OBJECT_BYTES}`);
 }
 let contentType: string | undefined;
 if (body.contentType !== undefined) {
  if (
   typeof body.contentType !== "string" ||
   body.contentType === "" ||
   body.contentType.length > MAX_ASSET_CONTENT_TYPE_CHARS ||
   /[\r\n]/.test(body.contentType)
  ) {
   return badRequest(`invalid contentType: 1..${MAX_ASSET_CONTENT_TYPE_CHARS} characters`);
  }
  contentType = body.contentType;
 }
 let partSize: number | undefined;
 if (body.partSize !== undefined) {
  if (
   typeof body.partSize !== "number" ||
   !Number.isInteger(body.partSize) ||
   body.partSize < MIN_MULTIPART_PART_BYTES ||
   body.partSize > MAX_MULTIPART_PART_BYTES
  ) {
   return badRequest(`invalid partSize: ${MIN_MULTIPART_PART_BYTES}..${MAX_MULTIPART_PART_BYTES}`);
  }
  partSize = body.partSize;
 }
 return { repo: body.repo, path: body.path, sha256: body.sha256, size: body.size, contentType, partSize };
}

/**
 * Parse the closed POST /asset/uploads/{uploadId}/complete body: exactly
 * {repo, sha256, parts}. `parts` is 1..MAX_MULTIPART_PARTS strictly
 * ascending, duplicate-free {partNumber, etag} entries — the ascending
 * law is also the duplicate law, and the etag shape guard closes XML
 * injection into the Complete body.
 */
function parseAssetUploadCompleteBody(raw: unknown): {
 repo: string;
 sha256: string;
 parts: Array<{ partNumber: number; etag: string }>;
} | Response {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("bad-request");
 const body = raw as AssetUploadCompleteBody;
 if (!Object.keys(body).every((k) => k === "repo" || k === "sha256" || k === "parts")) {
  return badRequest("bad-request");
 }
 if (typeof body.repo !== "string" || !REPO_NAME_RE.test(body.repo)) {
  return badRequest(`invalid repo: ${JSON.stringify(body.repo)}`);
 }
 if (typeof body.sha256 !== "string" || !BLOB_KEY_RE.test(body.sha256)) {
  return badRequest(`invalid sha256: ${JSON.stringify(body.sha256)}`);
 }
 if (!Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > MAX_MULTIPART_PARTS) {
  return badRequest(`invalid parts: 1..${MAX_MULTIPART_PARTS}`);
 }
 const parts: Array<{ partNumber: number; etag: string }> = [];
 let previous = 0;
 for (const entry of body.parts) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
   return badRequest("invalid parts: each entry must be {partNumber, etag}");
  }
  const part = entry as { partNumber?: unknown; etag?: unknown };
  if (!Object.keys(part).every((k) => k === "partNumber" || k === "etag")) return badRequest("bad-request");
  if (
   typeof part.partNumber !== "number" ||
   !Number.isInteger(part.partNumber) ||
   part.partNumber < 1 ||
   part.partNumber > MAX_MULTIPART_PARTS ||
   part.partNumber <= previous
  ) {
   return badRequest(`invalid partNumber: 1..${MAX_MULTIPART_PARTS} ascending and unique`);
  }
  if (typeof part.etag !== "string" || part.etag.length === 0 || part.etag.length > 128 || !PART_ETAG_RE.test(part.etag)) {
   return badRequest(`invalid etag: ${JSON.stringify(part.etag)}`);
  }
  previous = part.partNumber;
  parts.push({ partNumber: part.partNumber, etag: part.etag });
 }
 return { repo: body.repo, sha256: body.sha256, parts };
}

/**
 * GET /asset/{blobId}/presign — mint a short-lived presigned GET for one
 * content-addressed blob (CONTRACT.md §GET /asset/{blobId}/presign). The
 * key IS the content hash, so no repo is in scope and none is
 * adjudicated; the route deliberately does NOT head the object (a
 * key-existence oracle is exactly what §GET /asset/{blobId} refuses —
 * a presigned URL for an absent key is useless, not informative).
 *
 * Precondition order: 400 (blobId/key shape, then `expires`, then
 * `range`) -> 429 (rate) -> 503 (credentials absent) -> 200. authorize()
 * already ran at the dispatcher (deny mode 401s before any mint).
 *
 * `expires` is clamped into [1, 604800] (R2's documented range); absent
 * -> 300. A non-integer / non-positive value is a 400, never silently
 * rounded. `range` folds into the SigV4 signed headers, so the byte
 * range cannot be swapped after minting — the client MUST send the same
 * `Range` header.
 */
async function handleAssetPresign(request: Request, env: Env, blobId: string): Promise<Response> {
 if (!BLOB_KEY_RE.test(blobId)) return badRequest(`invalid blobId: ${JSON.stringify(blobId)}`);
 const url = new URL(request.url);
 const expiresIn = parsePresignExpiry(url.searchParams.get("expires"));
 if (expiresIn === null) return badRequest("invalid expires: positive integer seconds");
 const range = url.searchParams.get("range");
 if (range !== null && !RANGE_HEADER_RE.test(range)) return badRequest(`invalid range: ${JSON.stringify(range)}`);
 const rateDenied = rateGate("/asset/presign", request);
 if (rateDenied) return rateDenied;
 const creds = resolvePresignCredentials(env);
 if (!creds) return presignUnavailableResponse();
 const now = Date.now();
 const signedUrl = await presignGetUrl(creds, {
  bucket: ASSET_BUCKET_NAME,
  key: blobId,
  expiresInSeconds: expiresIn,
  now,
  range: range ?? undefined,
 });
 console.log("asset-presign", JSON.stringify({ key: blobId, expiresIn, ranged: range !== null }));
 return Response.json({
  ok: true,
  blobId,
  url: signedUrl,
  expiresAt: new Date(now + expiresIn * 1000).toISOString(),
  expiresIn,
  range,
 });
}

/**
 * POST /asset/uploads — mint the direct-to-R2 upload grant: one presigned
 * PUT for a single-part upload, or a CreateMultipartUpload session plus
 * one presigned PUT per part (CONTRACT.md §POST /asset/uploads). The key
 * is content-addressed (sha256 hex — the upload-asset.mjs convention), so
 * two callers declaring the same bytes converge on one object.
 *
 * The handler-side path discipline: the dynamic prefix is "/asset/uploads"
 * and NOTHING may follow it on this route (the complete route owns
 * "<uploadId>/complete" and is registered before this one) — any other
 * remainder is a 404, never a guess.
 */
async function handleAssetUploadGrant(request: Request, env: Env, remainder: string): Promise<Response> {
 if (remainder !== "") {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const parsed = parseAssetUploadGrantBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;
 // AD-9 allowlist BEFORE any mint: a repo outside the demo namespace
 // must never receive a bearer URL (the /raw carve-out posture — the
 // body-carried repo is adjudicated here, before any S3 call).
 if (!DEMO_REPO_RE.test(parsed.repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${parsed.repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const rateDenied = rateGate("/asset-uploads:write", request);
 if (rateDenied) return rateDenied;
 const creds = resolvePresignCredentials(env);
 if (!creds) return presignUnavailableResponse();

 const now = Date.now();
 const expiresIn = DEFAULT_PRESIGN_EXPIRY_SECONDS;
 const expiresAt = new Date(now + expiresIn * 1000).toISOString();
 const plan = planUpload(parsed.size, parsed.partSize);
 if (plan.mode === "single") {
  const url = await presignPutUrl(creds, {
   bucket: ASSET_BUCKET_NAME,
   key: parsed.sha256,
   expiresInSeconds: expiresIn,
   now,
   contentType: parsed.contentType,
  });
  console.log("asset-upload-grant", JSON.stringify({ repo: parsed.repo, key: parsed.sha256, mode: "single", bytes: parsed.size }));
  return Response.json({
   ok: true,
   repo: parsed.repo,
   path: parsed.path,
   key: parsed.sha256,
   upload: { mode: "single", url, expiresAt, expiresIn },
  });
 }
 try {
  const uploadId = await createMultipartSession(creds, {
   bucket: ASSET_BUCKET_NAME,
   key: parsed.sha256,
   contentType: parsed.contentType,
   now,
  });
  const parts: PresignedPart[] = [];
  for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
   parts.push({
    partNumber,
    url: await presignPutUrl(creds, {
     bucket: ASSET_BUCKET_NAME,
     key: parsed.sha256,
     expiresInSeconds: expiresIn,
     now,
     partNumber,
     uploadId,
    }),
   });
  }
  console.log("asset-upload-grant", JSON.stringify({ repo: parsed.repo, key: parsed.sha256, mode: "multipart", parts: parts.length }));
  return Response.json({
   ok: true,
   repo: parsed.repo,
   path: parsed.path,
   key: parsed.sha256,
   upload: {
    mode: "multipart",
    uploadId,
    partSize: plan.partSize,
    partCount: plan.partCount,
    parts,
    expiresAt,
    expiresIn,
   },
  });
 } catch (err) {
  return s3ControlFailure("upload-init-failed", err);
 }
}

/**
 * POST /asset/uploads/{uploadId}/complete — close a client-direct
 * multipart upload: the Worker forwards the client's
 * `[{partNumber, etag}]` list to S3 CompleteMultipartUpload and reports
 * the composite ETag (CONTRACT.md §POST /asset/uploads/{uploadId}/complete).
 *
 * `size` in the response is MEASURED from the bucket's object metadata
 * (an R2 head — a metadata read, never a byte read, so the e12
 * readVerifiedBlob chokepoint property holds). It is never the client's
 * declared number, and the typed-null law applies when the tier is
 * unreadable (null, never a guess).
 *
 * Handler-side path discipline: the remainder must be exactly
 * "<uploadId>/complete" (the /sessions/ steer idiom) — anything else is
 * a 404.
 */
async function handleAssetUploadComplete(request: Request, env: Env, remainder: string): Promise<Response> {
 if (!remainder.endsWith("/complete")) {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const uploadId = remainder.slice(0, -"/complete".length);
 if (uploadId === "" || uploadId.includes("/")) {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const parsed = parseAssetUploadCompleteBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;
 if (!DEMO_REPO_RE.test(parsed.repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${parsed.repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const rateDenied = rateGate("/asset-uploads:write", request);
 if (rateDenied) return rateDenied;
 const creds = resolvePresignCredentials(env);
 if (!creds) return presignUnavailableResponse();

 try {
  const etag = await completeMultipartSession(creds, {
   bucket: ASSET_BUCKET_NAME,
   key: parsed.sha256,
   uploadId,
   parts: parsed.parts,
  });
  let size: number | null = null;
  try {
   const object = env.ASSET_BLOB ? await env.ASSET_BLOB.head(parsed.sha256) : null;
   size = object?.size ?? null;
  } catch {
   // Typed-null law: an unreadable tier reports no size, never a guess.
  }
  console.log("asset-upload-complete", JSON.stringify({ repo: parsed.repo, key: parsed.sha256, parts: parsed.parts.length, measured: size !== null }));
  return Response.json({ ok: true, repo: parsed.repo, key: parsed.sha256, etag, size });
 } catch (err) {
  return s3ControlFailure("upload-complete-failed", err);
 }
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
// GET /checks?base=demo&repos=a,b&ref=main&baseRef=main
// The authoritative per-proposal checks, computed SERVER-side (CONTRACT.md
// §GET /checks). The handler is a pure projection of the /proposals compute
// — computeProposals already produces base.head, proposals[] (each with
// landing + files[].secret) and conflicts[]; the five checks per proposal
// are derived from exactly those, with the same derivation the UI strip
// owned (platform/ui/js/checks.js). The worker is the authority; the client
// consumes this verbatim and falls back to its own derivation only when the
// route is unreachable.
// ---------------------------------------------------------------------------

/**
 * One server-computed check (the strip's exact tri-state vocabulary).
 * `detail` is a display string only — never a secret-class path/key/value
 * and never the fork-point sha (the masking law; CONTRACT §GET /checks).
 */
interface ServerCheck {
 id: "fold" | "collision" | "conflicts" | "secrets" | "base";
 /** Display label — the strip renders it as the chip text and
  *  `"<label>: <detail>"` title. Identical to `id` (the five
  *  id/label sets are identical — the client twin's `unknown()`
  *  and every push use `label: "<id>"`). */
 label: string;
 state: "pass" | "fail" | "unknown";
 detail: string;
}

/** Conflict kinds that are NOT conflicts — a file the proposals share
 *  cleanly (the client strip's CLEAN_KINDS set; the server's own
 *  `classifyPair` conflict predicate is `pairs[].conflict === true`, and
 *  these kinds are exactly the ones classifyPair marks conflict:false).
 *  Static string-keyed lookup over the full ConflictKind union, so a
 *  Record (the Set/Map discipline). */
const CHECKS_CLEAN_KINDS: Record<ConflictKind, boolean> = {
 "text-conflict": false, "modify/delete": false, "add/add": false,
 undetermined: false, mergeable: true, "identical-add": true, "both-removed": true,
};

/** The genuine-conflict rows naming this repo, or null when the map is
 *  absent (the client strip's conflictRows mirror). */
function checksConflictRows(repo: string, conflicts: Array<{ file: string; repos: string[]; kind: ConflictKind }> | undefined): Array<{ file: string; kind: ConflictKind }> | null {
 if (!Array.isArray(conflicts) || typeof repo !== "string") return null;
 return conflicts
  .filter((c) => Array.isArray(c.repos) && c.repos.includes(repo) && !CHECKS_CLEAN_KINDS[c.kind])
  .map((c) => ({ file: c.file, kind: c.kind }));
}

/**
 * Derive the five checks for one proposal from the computeProposals
 * outputs — the server-side twin of the client strip's
 * proposalChecks(). `baseHead` is the base repo's current head at
 * baseRef (computeProposals' own read); `forkSha` is this proposal's
 * change-set fork point (computeChangeSet's base.sha), null when the
 * repo's compute failed.
 */
function checksForProposal(
 proposal: {
  repo: string;
  landing?: { status: "ready" | "conflict" | "landed" | "withheld-secret"; files: number };
  files?: Array<{ secret?: boolean }>;
  forkSha?: string; // the change-set fork point (the internal
  // compute result carries it; absent on error rows).
  error?: string;
 },
 ctx: {
  baseHead: string | null;
  forkSha: string | null;
  conflicts: Array<{ file: string; repos: string[]; kind: ConflictKind }> | undefined;
 },
): ServerCheck[] {
 const p = proposal;
 const failed = Boolean(p.error);
 const status = p.landing?.status ?? null;
 const files = Array.isArray(p.files) ? p.files : null;
 const out: ServerCheck[] = [];
 const unknown = (id: ServerCheck["id"], label: string, detail: string): ServerCheck => ({ id, label, state: "unknown", detail });

 // 1. fold — can this proposal fold onto the CURRENT base head?
 if (failed || !status) {
  out.push(unknown("fold", "fold", failed ? "unavailable" : "fold state not in payload"));
 } else if (status === "ready") {
  out.push({ id: "fold", label: "fold", state: "pass", detail: "folds clean" });
 } else if (status === "landed") {
  out.push({ id: "fold", label: "fold", state: "pass", detail: "nothing to fold" });
 } else if (status === "conflict") {
  out.push({ id: "fold", label: "fold", state: "fail", detail: "conflicting fold" });
 } else if (status === "withheld-secret") {
  out.push({ id: "fold", label: "fold", state: "fail", detail: "secret-class blocks fold" });
 } else {
  out.push(unknown("fold", "fold", "unrecognized fold state"));
 }

 // 2. collision — cross-proposal collision severity (the CAP-3 map).
 const rows = checksConflictRows(p.repo, ctx.conflicts);
 if (failed) {
  out.push(unknown("collision", "collision", "unavailable"));
 } else if (rows === null) {
  out.push(unknown("collision", "collision", "conflict map not in payload"));
 } else if (rows.length === 0) {
  out.push({ id: "collision", label: "collision", state: "pass", detail: "none" });
 } else {
  // Worst-severity kind over the rows (the client twin's
  // worstKind over KIND_ORDER; KIND_SEVERITY is the same
  // ordering the fold's conflict map ranks by). Rows are
  // already filtered to genuine-conflict kinds above.
  const kind = rows.reduce(
   (w, r) => (KIND_SEVERITY[r.kind] > KIND_SEVERITY[w] ? r.kind : w),
   rows[0]?.kind ?? "mergeable",
  );
  const file = rows[0]?.file || "shared file";
  out.push({ id: "collision", label: "collision", state: "fail", detail: `${kind} · ${file}` });
 }

 // 3. conflicts — how many conflicting files touch this repo.
 if (failed) {
  out.push(unknown("conflicts", "conflicts", "unavailable"));
 } else if (rows === null) {
  out.push(unknown("conflicts", "conflicts", "unknown"));
 } else {
  out.push({ id: "conflicts", label: "conflicts", state: rows.length === 0 ? "pass" : "fail", detail: String(rows.length) });
 }

 // 4. secrets — secret-class PRESENCE only (never keys, never values).
 const withheld = status === "withheld-secret";
 if (failed) {
  out.push(unknown("secrets", "secrets", "unavailable"));
 } else if (files === null && !withheld) {
  out.push(unknown("secrets", "secrets", "file rows not in payload"));
 } else {
  const secretCount = files ? files.filter((f) => f.secret === true).length : 0;
  if (withheld || secretCount > 0) {
   out.push({ id: "secrets", label: "secrets", state: "fail", detail: withheld ? "withheld" : `${secretCount} secret-class file(s)` });
  } else {
   out.push({ id: "secrets", label: "secrets", state: "pass", detail: "none" });
  }
 }

 // 5. base — staleness: change-set fork point vs current base head.
 //    No fork point (compute failed / not resolved) => honestly `unknown`.
 if (!ctx.forkSha || !ctx.baseHead) {
  out.push(unknown("base", "base", "fork point not in set payload"));
 } else if (ctx.forkSha !== ctx.baseHead) {
  out.push({ id: "base", label: "base", state: "fail", detail: "base moved since fork" });
 } else {
  out.push({ id: "base", label: "base", state: "pass", detail: "in sync" });
 }

 return out;
}

/**
 * The server-side projection: drive computeProposals (the EXISTING
 * compute seam — no new binding method, no new compute primitive).
 * The fork point each proposal's `base` check consumes is the one
 * computeProposals already paid for (published as `proposal.forkSha`,
 * the same out-param pattern as `headShas`) — no second change-set
 * walk. Per-proposal fail-closed: a repo whose compute throws
 * contributes `unknown` for its five checks (the /forks
 * per-candidate posture; its row carries no forkSha) — never a 500.
 */
async function computeChecks(
 env: Env,
 baseName: string,
 baseRef: string,
 ref: string,
 repoList: string[] | null,
): Promise<{ base: { repo: string; ref: string; head: string }; checks: Array<{ repo: string; checks: ServerCheck[] }> }> {
 const result = await computeProposals(env, baseName, baseRef, ref, repoList);
 return {
  base: result.base,
  checks: result.proposals.map((proposal) => ({
   repo: proposal.repo,
   checks: checksForProposal(proposal, {
    baseHead: result.base.head,
    forkSha: proposal.forkSha ?? null,
    conflicts: result.conflicts,
   }),
  })),
 };
}

/**
 * GET /checks — the authoritative checks route. 400 (parseProposalsQuery
 * law) → 429 (the /proposals compute-cost class) → 200. `base`/`repos`
 * are query-carried, so the dispatcher's authorize() chokepoint
 * (extractScope) already adjudicated them against the demo allowlist
 * pre-read (the /proposals posture) — the handler trusts the chokepoint.
 */
async function handleChecks(request: Request, env: Env): Promise<Response> {
 const parsed = parseProposalsQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef, repoList } = parsed;
 const rateDenied = rateGate("/checks", request);
 if (rateDenied) return rateDenied;
 // Generation-keyed KV cache — the same posture as /proposals
 // (the 2026-10-08 mitigation): every pushed event bumps
 // `cache:gen` (see recordEvent), so any push/land invalidates
 // BOTH caches atomically (the same gen keys both routes, so a
 // land between the two fetches cannot serve /checks from gen N
 // and /proposals from gen N+1 in one viewer tick). Distinct key
 // prefix, same generation + same params shape. Best-effort: a
 // missing/degraded CACHE binding must never turn /checks into a
 // 500 (test fakes and partial deployments carry no CACHE).
 let gen = "0";
 try { gen = (await env.CACHE.get("cache:gen")) ?? "0"; } catch { /* no CACHE — compute */ }
 const cacheKey = `cache:checks:${gen}:${base}:${baseRef}:${ref}:${repoList ? repoList.join(",") : "*"}`;
 try {
  const hit = await env.CACHE.get(cacheKey);
  if (hit) return new Response(hit, { headers: { "content-type": "application/json", "x-nextgit-cache": "hit" } });
 } catch { /* cache read is best-effort — fall through to compute */ }
 const { base: baseInfo, checks } = await computeChecks(env, base, baseRef, ref, repoList);
 const body = JSON.stringify({ ok: true, base: baseInfo, checks });
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
// GET /forks — the fork ecosystem for a base repo (CAP-10): every discovered
// `agent-*` fork's six-cluster signals plus its recorded upstream lineage. One
// bounded `list()` discovery run (the /intents and /floors precedent), the
// SAME computeSixClusterSignals seam /intents consumes (one writer, no
// divergence), and the same rankSignals ordering /intents serves. `upstream`
// is the `fork:<name>` lineage record served verbatim (`null` when unrecorded —
// the live demo forks carry no lineage). Read-only, credential-free (NFR-6).
// Precondition order: 400 (charset) → 403 (AD-9 defense-in-depth) → 429 → 200.
// ---------------------------------------------------------------------------
async function handleForks(request: Request, env: Env): Promise<Response> {
 const { base } = resolveRouteBase({ base: new URL(request.url).searchParams.get("base") ?? undefined });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 }
 // Demo allowlist (AD-9) defense-in-depth: the dispatcher's extractScope
 // already adjudicates the query-carried base, but the handler re-checks
 // before any repo read (the /proposals/{repo} precedent).
 if (!DEMO_REPO_RE.test(base)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${base}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const rateDenied = rateGate("/forks", request);
 if (rateDenied) return rateDenied;

 // Candidate discovery: the same bounded list() seam /proposals
 // auto-discovery and /intents use (agent-* forks, status ready).
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const forks: Array<{ repo: string; signals: SixClusterSignals; upstream: ForkLineage | null }> = [];
 for (const entry of list.repos) {
  if (!entry.name.startsWith("agent-") || entry.status !== "ready") continue;
  // A candidate the base cannot read (unresolvable ref, missing repo)
  // contributes no signals — skip it, never fail the whole request
  // (per-candidate fail-closed, the /intents precedent).
  let signals: SixClusterSignals;
  try {
   signals = await computeSixClusterSignals(env, base, DEFAULT_REF, entry.name);
  } catch {
   continue;
  }
  forks.push({ repo: entry.name, signals, upstream: await readForkLineage(env, entry.name) });
 }

 // Wire order (CONTRACT.md §GET /forks): strongest-first by the same
 // rankSignals confidence the matcher verdict derivation consumes.
 forks.sort((a, b) => rankSignals(b.signals) - rankSignals(a.signals));
 return Response.json({ ok: true, base, forks });
}
// ---------------------------------------------------------------------------
// GET /issues?base=demo — the triage issue list (nextgit-e16):
// issues derived from EXISTING platform state only — no new
// store, no new binding method, no new KV key. Four derivation
// legs per discovered candidate fork (the handleForks roster:
// `agent-*` + `status === "ready"`):
//   1. conflict       — the candidate's computeMerge fold rows
//      with result === "conflict" (one issue per conflicting path).
//   2. withheld-secret — the same fold's withheld-secret rows
//      (key NAMES only, never values — the masking law).
//   3. stale-base     — the fork-point walk finds NO shared
//      first-parent commit with the base within the 200-commit
//      walk (findSharedFirstParent === undefined).
//   4. blocked-intent — the structural matcher (deriveMatcherVerdict
//      over computeSixClusterSignals) scores the candidate "ignore"
//      (advisory only — the verdict is named, never an auto-decision).
// Deterministic order: (severityRank, kind, repo, detail), pure
// comparator — no timestamps, no Map-iteration order. Per-candidate
// compute failures skip that candidate (the handleForks
// per-candidate fail-closed precedent), never fail the request.
// Read-only (NFR-6); the derivation performs zero Artifacts writes.
// Precondition order: 400 (charset) → 403 (AD-9 defense-in-depth)
// → 429 → 200.
// ---------------------------------------------------------------------------

/** The derived issue row (CONTRACT.md §GET /issues response shape). */
interface DerivedIssue {
 id: string;
 kind: "conflict" | "withheld-secret" | "stale-base" | "blocked-intent";
 repo: string;
 severity: "high" | "medium" | "low" | "info";
 title: string;
 detail: string;
 links: string[];
}

/**
 * Severity rank for the deterministic order (high=0 … info=3):
 * a pure comparator input, never a wire field ordering.
 */
const ISSUE_SEVERITY_RANK: Record<DerivedIssue["severity"], number> = {
 high: 0,
 medium: 1,
 low: 2,
 info: 3,
};

/**
 * Validates the /issues query — the parseProposalsQuery
 * posture: `base`/`ref`/`baseRef` resolve through the AD-8
 * seam (absent → the pinned defaults), then the
 * REPO_NAME_RE/REF_RE charset guards → 400.
 */
function parseIssuesQuery(url: URL): { base: string; ref: string; baseRef: string } | Response {
 const { base, ref, baseRef } = resolveRouteBase({
  base: url.searchParams.get("base") ?? undefined,
  ref: url.searchParams.get("ref") ?? undefined,
  baseRef: url.searchParams.get("baseRef") ?? undefined,
 });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 }
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 if (typeof baseRef !== "string" || !REF_RE.test(baseRef) || baseRef.includes("..") || baseRef.startsWith("/") || baseRef.endsWith("/")) {
  return badRequest(`invalid baseRef: ${JSON.stringify(baseRef)}`);
 }
 return { base, ref, baseRef };
}

/**
 * The pure derivation core: fold the candidate's change into the
 * base (the exact three sides computeMerge drives), walk the fork
 * point, and score the matcher verdict — then emit the honest
 * issue rows. Every title/detail is built from platform state
 * (paths, counts, verdict tokens); untrusted repo names are
 * escaped at the UI only, never echoed raw into response fields.
 */
async function deriveIssues(
 env: Env,
 base: string,
 baseRef: string,
 ref: string,
 candidates: string[],
): Promise<DerivedIssue[]> {
 const issues: DerivedIssue[] = [];
 for (const repo of candidates) {
  // Per-candidate fail-closed: a candidate the base cannot read
  // (unresolvable ref, missing repo) contributes no issues — skip
  // it, never fail the whole request (the handleForks precedent).
  let fold;
  let staleBase: boolean;
  let matcherVerdict: MatcherVerdict;
  try {
   fold = await computeMerge(env, base, baseRef, [repo], ref);
   // The fork-point walk: the candidate shares NO first-parent
   // commit with the base within the FORK_LOG_LIMIT walk.
   using baseRepo = await env.ARTIFACTS.get(base);
   using headRepo = await env.ARTIFACTS.get(repo);
   const [baseLog, headLog] = await Promise.all([
    baseRepo.log({ ref: baseRef, limit: FORK_LOG_LIMIT }),
    headRepo.log({ ref: ref, limit: FORK_LOG_LIMIT }),
   ]);
   staleBase = findSharedFirstParent(baseLog, headLog) === undefined;
   const signals = await computeSixClusterSignals(env, base, baseRef, repo);
   matcherVerdict = deriveMatcherVerdict([{ repo, signals }]);
  } catch {
   continue;
  }

  // Leg 1 — conflict: one issue per conflicting path. The detail
  // is the PATH only — conflictText stays off the wire (it is a
  // merge input, and diff text could carry secret-adjacent content).
  for (const f of fold.files) {
   if (f.result !== "conflict") continue;
   issues.push({
    id: `conflict:${repo}:${f.path}`,
    kind: "conflict",
    repo,
    severity: "high",
    title: `Merge conflict in ${f.path}`,
    detail: f.path,
    links: [`/merge?base=${base}&repos=${repo}`],
   });
  }

  // Leg 2 — withheld-secret: the fold's withheld-secret rows.
  // Key NAMES only (the note's withheld count), never values.
  for (const f of fold.files) {
   if (f.result !== "withheld-secret") continue;
   const withheld = f.note?.match(/(\d+) key\(s\) withheld/);
   const keyCount = withheld ? Number(withheld[1]) : 0;
   issues.push({
    id: `withheld-secret:${repo}:${f.path}`,
    kind: "withheld-secret",
    repo,
    severity: "medium",
    title: `Secret-class file withheld: ${f.path}`,
    detail: `${f.path}: ${keyCount} key(s) withheld`,
    links: [`/merge?base=${base}&repos=${repo}`],
   });
  }

  // Leg 3 — stale-base: no shared first-parent commit with the base.
  if (staleBase) {
   issues.push({
    id: `stale-base:${repo}`,
    kind: "stale-base",
    repo,
    severity: "low",
    title: `Fork ${repo} shares no history with ${base}`,
    detail: `no shared first-parent commit with base "${base}" within the ${FORK_LOG_LIMIT}-commit walk`,
    links: [`/forks?base=${base}`],
   });
  }

  // Leg 4 — blocked-intent: the structural matcher scores "ignore".
  // Advisory only — the verdict is named, never an auto-decision.
  if (matcherVerdict === "ignore") {
   issues.push({
    id: `blocked-intent:${repo}`,
    kind: "blocked-intent",
    repo,
    severity: "info",
    title: `Matcher verdict "ignore" for ${repo}`,
    detail: `matcher verdict ignore over 1 candidate fork(s)`,
    links: [`/intents`],
   });
  }
 }

 // Deterministic order: (severityRank, kind, repo, detail) —
 // lexicographic, a pure comparator (no timestamps, no
 // Map-iteration order).
 issues.sort((a, b) =>
  ISSUE_SEVERITY_RANK[a.severity] - ISSUE_SEVERITY_RANK[b.severity] ||
  (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
  (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) ||
  (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0)
 );
 return issues;
}

/**
 * GET /issues handler. Read-only, credential-free (NFR-6).
 * The dispatcher's authorize() chokepoint (demo mode gate) +
 * extractScope adjudicate the query-carried `base` pre-read; the
 * handler re-checks the AD-9 allowlist before any repo read (the
 * handleForks defense-in-depth precedent).
 */
async function handleIssues(request: Request, env: Env): Promise<Response> {
 const parsed = parseIssuesQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { base, ref, baseRef } = parsed;

 // Demo allowlist (AD-9) defense-in-depth: the dispatcher's
 // extractScope already adjudicates the query-carried base, but
 // the handler re-checks before any repo read (the /proposals/{repo}
 // precedent).
 if (!DEMO_REPO_RE.test(base)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${base}" is outside the demo allowlist` },
   { status: 403 },
  );
 }

 const rateDenied = rateGate("/issues", request);
 if (rateDenied) return rateDenied;

 // Candidate discovery: the same bounded list() seam /forks,
 // /intents and /floors use (agent-* forks, status ready).
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const candidates = list.repos
  .filter((entry) => entry.name.startsWith("agent-") && entry.status === "ready")
  .map((entry) => entry.name);

 const issues = await deriveIssues(env, base, baseRef, ref, candidates);
 return Response.json({ ok: true, base, issues });
}

async function handleAgents(request: Request, env: Env): Promise<Response> {
 const { base } = resolveRouteBase({ base: new URL(request.url).searchParams.get("base") ?? undefined });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 }
 // Demo allowlist (AD-9) defense-in-depth: the dispatcher's
 // extractScope already adjudicates the query-carried base, but
 // the handler re-checks before any repo read (the /forks
 // precedent).
 if (!DEMO_REPO_RE.test(base)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${base}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const rateDenied = rateGate("/agents", request);
 if (rateDenied) return rateDenied;

 // Roster discovery: the same bounded list() seam /floors and
 // /forks use (agent-* repos, status ready). Per-candidate
 // fail-closed: a repo whose harness note cannot be read still
 // serves the row with harness "unrecorded" (readAgentHarness's
 // own best-effort law) — never skipped, never fails the roster.
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const agents: Array<{
  repo: string;
  harness: string;
  capabilities: string[];
  policy: { land: string; secretClass: string };
  lastSeenAt: string | null;
 }> = [];
 for (const entry of list.repos) {
  if (!entry.name.startsWith("agent-") || entry.status !== "ready") continue;
  const repo = await env.ARTIFACTS.get(entry.name).catch(() => null);
  const harness = repo ? await readAgentHarness(repo) : "unrecorded";
  agents.push({
   repo: entry.name,
   harness,
   capabilities: ["propose"],
   policy: { land: AUTO_LAND_ENGAGED ? "auto-eligible" : "manual", secretClass: "refused" },
   lastSeenAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
  });
 }

 // Wire order (CONTRACT.md §GET /agents): name-ordered.
 agents.sort((a, b) => a.repo.localeCompare(b.repo));
 return Response.json({ ok: true, base, agents });
}

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

// ---------------------------------------------------------------------------
// Repo-browsing read API (CONTRACT.md §GET /tree, §GET /file,
// §GET /raw) — the file tree + file content surface for the demo
// and agent repos, over HTTP. All three routes read through the
// EXISTING seams only: repo.log({ref,limit:1}) resolves a ref to
// its head commit, repo.readTree(hash) lists a directory level,
// repo.readFile({ref,path}) fetches one blob (via the readContent
// helper for /file). No new binding methods, no clone, no memfs
// write, no recursive walk.
// ---------------------------------------------------------------------------

interface ReadQuery {
 repo: string;
 ref: string;
 path: string;
}

interface CommitsQuery {
 repo: string;
 ref: string;
 limit: number;
}

/**
 * Validates the /tree + /file query params. Mirrors
 * parseProposalsQuery's REPO_NAME_RE / REF_RE guards (the same
 * pair every GET read route enforces) with resolveRouteBase
 * supplying the pinned ref default (absent -> main; the AD-8
 * seam, so omitted == explicit). `path` is optional ("" = the
 * repo root) and rejects .. segments plus leading/trailing "/"
 * — the traversal law POST /reveal's path validation enforces.
 * Returns a ReadQuery when valid, or the 400 Response.
 */
function parseReadQuery(url: URL): ReadQuery | Response {
 const { ref } = resolveRouteBase({ ref: url.searchParams.get("ref") ?? undefined });
 const repo = url.searchParams.get("repo");
 if (typeof repo !== "string" || !REPO_NAME_RE.test(repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(repo)}`);
 }
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 const path = url.searchParams.get("path") ?? "";
 if (path.startsWith("/") || path.endsWith("/") || path.split("/").includes("..")) {
  return badRequest(`invalid path: ${JSON.stringify(path)}`);
 }
 if (path.split("/").filter(Boolean).length > MAX_TREE_DEPTH) {
  return badRequest("path too deep");
 }
 return { repo, ref, path };
}

/**
 * Validates the /commits query params (CONTRACT.md §GET /commits).
 * Reuses the SAME resolveRouteBase default seam + REPO_NAME_RE/REF_RE
 * guards as parseReadQuery, plus the optional `limit`: absent -> the
 * pinned page size; a present value must match /^[1-9][0-9]*$/ (the
 * AD-8 normalization rule — a present bad value, including "", is a
 * 400, never silently defaulted) and is clamped to MAX_COMMIT_LIMIT
 * (the resource bound; no request drives an unbounded history walk).
 * Returns a CommitsQuery when valid, or the 400 Response.
 */
function parseCommitsQuery(url: URL): CommitsQuery | Response {
 const { ref } = resolveRouteBase({ ref: url.searchParams.get("ref") ?? undefined });
 const repo = url.searchParams.get("repo");
 if (typeof repo !== "string" || !REPO_NAME_RE.test(repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(repo)}`);
 }
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 const rawLimit = url.searchParams.get("limit");
 let limit = DEFAULT_COMMIT_LIMIT;
 if (rawLimit !== null) {
  if (!/^[1-9][0-9]*$/.test(rawLimit)) return badRequest(`invalid limit: ${JSON.stringify(rawLimit)}`);
  limit = Math.min(Number(rawLimit), MAX_COMMIT_LIMIT);
 }
 return { repo, ref, limit };
}

/**
 * GET /tree — one directory level of a repo at a ref. `entries`
 * is the direct child set of `path`, tree-order preserved
 * (deterministic: the same (repo, ref, path) always yields the
 * same entries). Every entry documents size:0 — the Artifacts
 * readTree surface carries no entry sizes (subtree or blob), and
 * the route documents the zero rather than fabricating a value
 * (no size oracle; CONTRACT §GET /tree). Unknown repo /
 * unresolvable ref / a file at `path` (not a directory) -> the
 * uniform 404.
 */
async function handleTree(request: Request, env: Env): Promise<Response> {
 const parsed = parseReadQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { repo, ref, path } = parsed;

 // The repo is query-carried, so the dispatcher's authorize()
 // chokepoint (extractScope) already adjudicated it against the
 // demo allowlist pre-read (the /changes posture) — the handler
 // trusts the chokepoint and reads.
 try {
  using artifactsRepo = await env.ARTIFACTS.get(repo);
  const commits = await artifactsRepo.log({ ref, limit: 1 });
  if (!commits.length) {
   return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  // Resolve the tree AT `path` (not the root): walk the head
  // tree's children down to the requested directory.
  let treeHash = commits[0].treeHash;
  if (path !== "") {
   for (const part of path.split("/")) {
    const entries = await artifactsRepo.readTree(treeHash);
    const child = entries?.find((e) => e.name === part && e.type === "tree");
    if (!child) {
     return Response.json({ ok: false, error: "not-found" }, { status: 404 });
    }
    treeHash = child.hash;
   }
  }
  const entries = await artifactsRepo.readTree(treeHash);
  if (!entries) {
   return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  return Response.json({
   ok: true,
   repo,
   ref,
   path,
   entries: entries.map((entry) => ({
    name: entry.name,
    type: entry.type,
    size: 0, // the readTree surface carries no entry sizes — documented zero, not fabricated
    blobHash: entry.hash,
   })),
  });
 } catch {
  // Unknown repo (the namespace does not carry it) -> 404, the
  // /proposals/{repo} mapping (a failed repo read is the
  // contract 404, never a 500).
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
}

/**
 * GET /commits — the commit log of a repo at a ref (CONTRACT.md
 * §GET /commits; the history half of the repo-browsing read API).
 * Drives the EXISTING repo.log({ref, limit}) seam — the newest-first
 * first-parent walk forkPoint already reads; no new binding method,
 * no tree/blob read. `commits` is the log's own order (deterministic
 * for a given (repo, ref, limit)), bounded by the clamped `limit`.
 * The projection is EXPLICIT — treeHash/committer/committedAt are
 * dropped, never spread. Unknown repo / unresolvable ref / an empty
 * history / any binding failure -> the uniform 404 (the /tree
 * mapping). The repo is query-carried, so the dispatcher's
 * authorize() chokepoint (extractScope) already adjudicated it
 * against the demo allowlist pre-read (the /tree posture) — the
 * handler trusts the chokepoint and reads.
 */
async function handleCommits(request: Request, env: Env): Promise<Response> {
 const parsed = parseCommitsQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { repo, ref, limit } = parsed;
 try {
  using artifactsRepo = await env.ARTIFACTS.get(repo);
  const log = await artifactsRepo.log({ ref, limit });
  if (!log.length) return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  return Response.json({
   ok: true,
   repo,
   ref,
   commits: log.map((c) => ({
    sha: c.hash,
    shortSha: c.hash.slice(0, 7),
    message: c.message,
    author: `${c.author.name} <${c.author.email}>`,
    at: new Date(c.authoredAt * 1000).toISOString(),
    parents: c.parents ?? [],
   })),
  });
 } catch {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
}

/**
 * GET /file — one file's content, classified. Drives the
 * EXISTING readContent seam (the same repo.readFile({ref,path})
 * read /reveal uses). The masking law (AD-4): a secret-class
 * path yields keys[] ONLY — the value is read server-side and
 * never egresses; a binary file yields no inline text (use
 * GET /raw for the bytes).
 */
async function handleFile(request: Request, env: Env): Promise<Response> {
 const parsed = parseReadQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { repo, ref, path } = parsed;
 if (path === "") {
  return badRequest("path required");
 }

 // Rate row (the compute-cost class; the contract's /file
 // 60/60s cap). GET precondition order: 400 (param parse) ->
 // 429 -> compute.
 const rateDenied = rateGate("/file", request);
 if (rateDenied) return rateDenied;

 try {
  using artifactsRepo = await env.ARTIFACTS.get(repo);
  const content = await readContent(artifactsRepo, ref, path);
  if (!content) {
   return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  // Secret class (AD-4 masking law): keys only, never values.
  // isSecretPath + secretKeys are the existing seam; the raw
  // text is read server-side for key extraction and never
  // leaves the worker.
  if (isSecretPath(path)) {
   const keys = content.text === null ? [] : secretKeys(content.text);
   return Response.json({
    ok: true,
    repo,
    ref,
    path,
    classification: "secret",
    file: classifyFile(path),
    size: content.size,
    keys,
   });
  }
  if (content.binary) {
   return Response.json({
    ok: true,
    repo,
    ref,
    path,
    classification: "binary",
    file: classifyFile(path),
    size: content.size,
   });
  }
  return Response.json({
   ok: true,
   repo,
   ref,
   path,
   classification: "text",
   file: classifyFile(path),
   size: content.size,
   text: content.text,
  });
 } catch {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
}

/**
 * GET /raw/{repo}/{ref}/{path...} — raw blob bytes,
 * application/octet-stream. The path is split on the FIRST TWO
 * "/" separators only (repo, ref, path), so a ref that itself
 * contains slashes (a future refs/heads/*) still routes.
 * Authorization: the path-carried repo cannot be adjudicated by
 * the dispatcher's query-only extractScope (the /reveal
 * carve-out), so this handler re-checks the AD-9 demo allowlist
 * (DEMO_REPO_RE) BEFORE any binding read — fail-closed.
 * Secret-class paths are REFUSED (403) before any binding read:
 * a secret blob never materializes on this route; values surface
 * only through the authorized, audited POST /reveal seam.
 */
async function handleRaw(request: Request, env: Env): Promise<Response> {
 const remainder = new URL(request.url).pathname.slice("/raw/".length);
 // Split on the first two "/" separators: [repo, ref, path...].
 const first = remainder.indexOf("/");
 if (first === -1) return badRequest("bad-request");
 const second = remainder.indexOf("/", first + 1);
 if (second === -1) return badRequest("bad-request");
 const repo = remainder.slice(0, first);
 const ref = remainder.slice(first + 1, second);
 const path = remainder.slice(second + 1);

 if (!REPO_NAME_RE.test(repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(repo)}`);
 }
 if (!REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 if (path === "" || path.startsWith("/") || path.endsWith("/") || path.split("/").includes("..")) {
  return badRequest(`invalid path: ${JSON.stringify(path)}`);
 }

 // Demo allowlist re-check (the /reveal carve-out): the
 // dispatcher's extractScope reads query params only, so the
 // path-carried repo is adjudicated HERE, before any read.
 if (!DEMO_REPO_RE.test(repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }

 // Secret-class refusal — fail-closed BEFORE any binding read
 // (the /reveal posture: a secret-class blob never egresses
 // through the raw route).
 if (isSecretPath(path)) {
  return Response.json({ ok: false, error: "secret-class" }, { status: 403 });
 }

 // Rate row (the byte-egress cost class; the contract's
 // /raw 60/60s cap).
 const rateDenied = rateGate("/raw", request);
 if (rateDenied) return rateDenied;

 try {
  using artifactsRepo = await env.ARTIFACTS.get(repo);
  const blob = await artifactsRepo.readFile({ ref, path });
  if (!blob) {
   return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_RAW_BYTES) {
   return Response.json({ ok: false, error: "too-large" }, { status: 413 });
  }
  return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
 } catch {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
}

// ---------------------------------------------------------------------------
// Inline review comments (CONTRACT.md §POST /comments, §GET /comments) —
// the worker data plane for per-file review threads. Storage is the
// worker's script-writable durable namespace (env.CACHE — the fork-lineage
// / landing-record precedent): repo-scoped JSONL at `comments:<repo>`,
// append order preserved (oldest-first). The forward posture (named in
// CONTRACT) is the same wire contract over a `comments.jsonl` tree entry
// in the Artifacts repo once the (read-only) binding exposes a write seam.
//
// POST appends one comment (no idempotence, fresh id each call); GET reads
// one repo's comments filtered to an exact (ref, path). The two verbs share
// the `/comments` path — the dispatcher matches path AND method exactly,
// and the API-boundary 405 law covers any third method.
// ---------------------------------------------------------------------------

/** Comment body cap in characters (CONTRACT §POST /comments). */
const MAX_COMMENT_CHARS = 2000;
/** CACHE KV key prefix for a repo's comment JSONL (`comments:<repo>`). */
const COMMENTS_KEY_PREFIX = "comments:";
/** Comment id length in hex characters (48 random bits). */
const COMMENT_ID_HEX = 12;

/**
 * One stored inline review comment. `ref` is the branch the comment was
 * filed against (the GET read filter); the per-row wire comment omits it.
 * `author` is display text only — never an identity claim (NFR-3).
 */
interface CommentRecord {
 id: string;
 ref: string;
 path: string;
 line: number;
 body: string;
 author: string;
 at: string;
}

/** A fresh comment id — 12 lowercase hex chars (48 random bits). */
function newCommentId(): string {
 const bytes = crypto.getRandomValues(new Uint8Array(COMMENT_ID_HEX / 2));
 return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Closed request schema for POST /comments (AD-9): exactly
 *  {repo, ref?, path, line, body, author}. `ref` resolves through the
 *  AD-8 seam (absent -> main), so a POST without it and a GET without it
 *  agree on the branch. */
interface CommentsRequestBody {
 repo?: unknown;
 ref?: unknown;
 path?: unknown;
 line?: unknown;
 body?: unknown;
 author?: unknown;
}

/**
 * Validate the POST /comments body — the closed-schema twin of
 * parseUpstreamBody (unknown field -> 400). `repo` REPO_NAME_RE; `ref`
 * REF_RE (absent -> the pinned default via resolveRouteBase); `path`
 * carries the traversal guards (non-empty, no `..` segment, no
 * leading/trailing `/`, depth-capped); `line` is a non-negative integer;
 * `body` is 1..MAX_COMMENT_CHARS chars; `author` is non-empty.
 */
function parseCommentsBody(raw: unknown): { repo: string; ref: string; path: string; line: number; body: string; author: string } | Response {
 if (!raw || typeof raw !== "object") return badRequest("bad-request");
 const body = raw as CommentsRequestBody;
 if (!Object.keys(body).every((k) => k === "repo" || k === "ref" || k === "path" || k === "line" || k === "body" || k === "author")) {
  return badRequest("bad-request");
 }
 if (typeof body.repo !== "string" || !REPO_NAME_RE.test(body.repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(body.repo)}`);
 }
 const { ref } = resolveRouteBase({ ref: body.ref });
 if (typeof ref !== "string" || !REF_RE.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
  return badRequest(`invalid ref: ${JSON.stringify(ref)}`);
 }
 if (typeof body.path !== "string" || body.path === "" || body.path.startsWith("/") || body.path.endsWith("/") || body.path.split("/").includes("..")) {
  return badRequest(`invalid path: ${JSON.stringify(body.path)}`);
 }
 if (body.path.split("/").filter(Boolean).length > MAX_TREE_DEPTH) return badRequest("path too deep");
 if (typeof body.line !== "number" || !Number.isInteger(body.line) || body.line < 0) {
  return badRequest(`invalid line: ${JSON.stringify(body.line)}`);
 }
 if (typeof body.body !== "string" || body.body.length < 1 || body.body.length > MAX_COMMENT_CHARS) {
  return badRequest(`invalid body: 1..${MAX_COMMENT_CHARS} characters`);
 }
 if (typeof body.author !== "string" || body.author.trim() === "") {
  return badRequest(`invalid author: ${JSON.stringify(body.author)}`);
 }
 return { repo: body.repo, ref, path: body.path, line: body.line, body: body.body, author: body.author };
}

/**
 * Validate the GET /comments query — the /file read query with `path`
 * made required (a comment thread is per-file). `repo` is query-carried,
 * so the dispatcher's extractScope adjudicates it against the demo
 * allowlist pre-read (the /file, /tree posture); `ref` absent -> the
 * pinned default via resolveRouteBase (AD-8), so an omitted ref and an
 * explicit `ref=main` are equivalent.
 */
function parseCommentsQuery(url: URL): ReadQuery | Response {
 const parsed = parseReadQuery(url);
 if (parsed instanceof Response) return parsed;
 if (parsed.path === "") return badRequest("path required");
 return parsed;
}

/**
 * Read one repo's comments from CACHE (JSONL at `comments:<repo>`).
 * Fail closed on absence OR corruption: a missing key, an unparseable
 * line, or a malformed record yields the empty list (the
 * readForkLineage posture — never a throw).
 */
async function readComments(env: Env, repo: string): Promise<CommentRecord[]> {
 try {
  const raw = await env.CACHE.get(`${COMMENTS_KEY_PREFIX}${repo}`);
  if (!raw) return [];
  const out: CommentRecord[] = [];
  for (const line of raw.split("\n")) {
   if (line === "") continue;
   const parsed = JSON.parse(line) as Partial<CommentRecord>;
   if (!parsed || typeof parsed !== "object") return [];
   if (
    typeof parsed.id !== "string" || typeof parsed.ref !== "string" ||
    typeof parsed.path !== "string" || typeof parsed.line !== "number" ||
    typeof parsed.body !== "string" || typeof parsed.author !== "string" ||
    typeof parsed.at !== "string"
   ) return [];
   out.push({
    id: parsed.id, ref: parsed.ref, path: parsed.path, line: parsed.line,
    body: parsed.body, author: parsed.author, at: parsed.at,
   });
  }
  return out;
 } catch {
  return [];
 }
}

// Concurrency posture for POST /comments (the withLandGate BF-1 pattern,
// keyed per repo): appendComment is a read-modify-write of the whole
// `comments:<repo>` JSONL, and the awaits inside readComments (CACHE.get)
// and before CACHE.put interleave concurrent POSTs WITHIN one isolate —
// N simultaneous posts each read the same pre-state and last-write-wins
// drops N-1 (verified: 8 posts -> 7 lost). One in-flight append chain per
// repo key, so different repos still append concurrently. Cross-isolate
// remains last-writer-wins (the documented as-built posture); a repo-keyed
// Durable Object is the multi-isolate fix (Proposal B).
const commentAppendChains = new Map<string, Promise<void>>();

/** Queue fn behind any in-flight append for the same repo: one comment
 *  append critical section per repo key, per isolate. */
async function withCommentAppendGate<T>(repo: string, fn: () => Promise<T>): Promise<T> {
 const prev = commentAppendChains.get(repo) ?? Promise.resolve();
 const { promise: next, resolve: release } = Promise.withResolvers<void>();
 commentAppendChains.set(repo, next);
 await prev;
 try {
  return await fn();
 } finally {
  release();
 }
}

/** Append one comment: read-modify-write the repo's JSONL in CACHE
 *  (append order preserved). Serialized per repo key by
 *  withCommentAppendGate — one in-isolate writer at a time, so
 *  concurrent POSTs cannot interleave the read-modify-write window.
 *  (Cross-isolate remains last-writer-wins, the documented as-built
 *  posture; a repo-keyed Durable Object is the multi-isolate fix —
 *  Proposal B.) */
async function appendComment(env: Env, repo: string, record: CommentRecord): Promise<void> {
 await withCommentAppendGate(repo, async () => {
  const existing = await readComments(env, repo);
  const jsonl = [...existing, record].map((c) => JSON.stringify(c)).join("\n");
  await env.CACHE.put(`${COMMENTS_KEY_PREFIX}${repo}`, jsonl);
 });
}

/**
 * POST /comments — append one inline review comment. A write action
 * behind authorize() + csrfGate (the dispatcher applies both), with the
 * handler-side AD-9 allowlist re-check (the /land, /reveal posture: the
 * body-carried repo is adjudicated before any store access). Secret-class
 * paths are REFUSED (403) before any store access (the /raw posture — a
 * secret-class comment can never enter the store). Order: 400 (shape) ->
 * 403 (allowlist) -> 403 (secret-class) -> 429 -> 201.
 */
async function handleCommentsPost(request: Request, env: Env): Promise<Response> {
 const parsed = parseCommentsBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;
 const { repo, ref, path, line, body, author } = parsed;

 if (!DEMO_REPO_RE.test(repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 if (isSecretPath(path)) {
  return Response.json({ ok: false, error: "secret-class" }, { status: 403 });
 }

 const rateDenied = rateGate("/comments:write", request);
 if (rateDenied) return rateDenied;

 const comment = { id: newCommentId(), path, line, body, author, at: new Date().toISOString() };
 await appendComment(env, repo, { ...comment, ref });
 return Response.json({ ok: true, comment }, { status: 201 });
}

/**
 * GET /comments — one repo's comments for an exact (ref, path), in append
 * order (oldest-first; stable across reads). The repo is query-carried,
 * so the chokepoint's extractScope already adjudicated it against the
 * demo allowlist pre-read (the /file posture — no handler re-check).
 * Order: 400 (param parse) -> 429 -> read.
 */
async function handleCommentsGet(request: Request, env: Env): Promise<Response> {
 const parsed = parseCommentsQuery(new URL(request.url));
 if (parsed instanceof Response) return parsed;
 const { repo, ref, path } = parsed;

 const rateDenied = rateGate("/comments", request);
 if (rateDenied) return rateDenied;

 const all = await readComments(env, repo);
 const comments = all
  .filter((c) => c.ref === ref && c.path === path)
  .map((c) => ({ id: c.id, path: c.path, line: c.line, body: c.body, author: c.author, at: c.at }));
 return Response.json({ ok: true, repo, ref, comments });
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

// ---------------------------------------------------------------------------
// Session steering (CONTRACT.md §GET /sessions, §POST /sessions/{repo}/steer)
// — the honest v1: the session LIST is derived from the platform's REAL
// observability (the Artifacts queue event feed GET /events serves), and the
// STEER write appends a session.steered event to that same durable feed. The
// platform does NOT inject the instruction into a live agent process — that is
// the documented v1 limitation (CONTRACT §POST /sessions/{repo}/steer).
// ---------------------------------------------------------------------------

/** Closed request schema for POST /sessions/{repo}/steer (AD-9):
 *  exactly {instruction}. `instruction` is required, non-empty,
 *  <=MAX_STEER_INSTRUCTION_CHARS chars (the untrusted-free-text
 *  cap, the /intents posture). */
interface SteerRequestBody {
 instruction?: unknown;
}

/**
 * Validate the steer body — the closed-schema twin of
 * parseIntentsBody (unknown field -> 400). The instruction
 * text is validated HERE but never echoed: it is scrubbed at
 * the seam (stripInstructionLike(scrubFreeText(...)), the
 * /intents AD-4 wire) before it enters the event record, and
 * the response carries only the recorded frame.
 */
function parseSteerBody(raw: unknown): { instruction: string } | Response {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("bad-request");
 const body = raw as SteerRequestBody;
 if (!Object.keys(body).every((k) => k === "instruction")) {
  return badRequest("bad-request");
 }
 const instruction = body.instruction;
 if (typeof instruction !== "string" || !instruction || instruction.length > MAX_STEER_INSTRUCTION_CHARS) {
  return badRequest(`invalid instruction: 1..${MAX_STEER_INSTRUCTION_CHARS} characters`);
 }
 return { instruction };
}

/**
 * Derive the session list from the platform's REAL event feed
 * (the honest v1 — no fabricated rows). One row per discovered
 * agent-* repo (the bounded list({limit:200}) seam /forks uses,
 * status === "ready") that the feed carries evidence for; a repo
 * with no feed evidence is ABSENT (never a fabricated
 * state:"idle"). State: working = a newest event within
 * SESSION_WORKING_WINDOW_MS of now; else idle (honest v1:
 * "blocked" derives only from recorded landing-failure evidence
 * in the feed — none recorded here, so it stays idle). `intent`
 * per repo comes through the EXISTING readIntent seam
 * (best-effort: an unresolvable read omits the field, the row
 * still renders — per-candidate fail-closed, the /forks
 * precedent). Ordering: newest-activity-first (the feed's own
 * order). Rate: deliberately UNBOUND (the /changes posture — a
 * bounded read over <=200 discovered repos; documented in
 * CONTRACT §GET /sessions).
 */
async function readSessionState(env: Env): Promise<Array<{
 repo: string;
 state: "working" | "idle";
 intent?: string;
 lastActivityAt?: string;
 lastEvent?: string;
}>> {
 const events = await readEvents(env);
 // Group by repo, preserving the feed's newest-first order per
 // repo (readEvents returns the feed newest-first, so the first
 // event seen for a repo is its newest).
 const newest = new Map<string, LiveEvent>();
 for (const event of events) {
  if (!event.repo) continue;
  if (!newest.has(event.repo)) newest.set(event.repo, event);
 }
 const list = await env.ARTIFACTS.list({ limit: 200 });
 const sessions: Array<{
  repo: string;
  state: "working" | "idle";
  intent?: string;
  lastActivityAt?: string;
  lastEvent?: string;
 }> = [];
 const now = Date.now();
 for (const entry of list.repos) {
  if (!entry.name.startsWith("agent-") || entry.status !== "ready") continue;
  const event = newest.get(entry.name);
  // No feed evidence -> ABSENT (never a fabricated row — the
  // honest-unavailable posture).
  if (!event) continue;
  const lastEvent = event.type ? normalizeEventType(event.type) : "";
  const lastActivityAt = event.at;
  const withinWindow = lastActivityAt
   ? now - Date.parse(lastActivityAt) <= SESSION_WORKING_WINDOW_MS
   : false;
  const state: "working" | "idle" = withinWindow ? "working" : "idle";
  // Intent through the EXISTING seam (best-effort). Resolve the
  // head sha via the snapshot idiom (repoHead — repo.log
  // limit 1); an unresolvable read omits the field, the row
  // still renders (per-candidate fail-closed, the /forks
  // precedent — never a 500).
  let intent: string | undefined;
  try {
   const headSha = await repoHead(env, entry.name, DEFAULT_REF);
   using artifactsRepo = await env.ARTIFACTS.get(entry.name);
   intent = await readIntent(artifactsRepo, DEFAULT_REF, headSha);
  } catch {
   intent = undefined;
  }
  const row: { repo: string; state: "working" | "idle"; intent?: string; lastActivityAt?: string; lastEvent?: string } = {
   repo: entry.name, state,
  };
  if (intent !== undefined) row.intent = intent;
  if (lastActivityAt !== undefined) row.lastActivityAt = lastActivityAt;
  if (lastEvent !== "") row.lastEvent = lastEvent;
  sessions.push(row);
 }
 return sessions;
}

/**
 * GET /sessions — the honest v1 session list (CONTRACT.md
 * §GET /sessions). `base` resolves through resolveRouteBase
 * (AD-8 — omitted == explicit) and is REPO_NAME_RE-checked;
 * the handler re-checks the demo allowlist (DEMO_REPO_RE)
 * before any read (the /forks defense-in-depth precedent —
 * the query-carried base was already adjudicated by the
 * dispatcher's extractScope, the re-check is belt-and-braces).
 * Deliberately UNBOUND (the /changes posture — no rateGate;
 * documented in CONTRACT). Order: 400 (param) -> 403 (allowlist)
 * -> 200.
 */
async function handleSessions(request: Request, env: Env): Promise<Response> {
 const { base } = resolveRouteBase({ base: new URL(request.url).searchParams.get("base") ?? undefined });
 if (typeof base !== "string" || !REPO_NAME_RE.test(base)) {
  return badRequest(`invalid base repo: ${JSON.stringify(base)}`);
 }
 // Demo allowlist (AD-9) defense-in-depth — the query-carried
 // base was adjudicated at the chokepoint; re-check before any
 // repo read (the /forks precedent).
 if (!DEMO_REPO_RE.test(base)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${base}" is outside the demo allowlist` },
   { status: 403 },
  );
 }
 const sessions = await readSessionState(env);
 return Response.json({ ok: true, base, sessions });
}

// Concurrency posture for the steer write (the
// withCommentAppendGate pattern, keyed on the single EVENTS_KEY):
// appendSessionEvent is a read-modify-write of the `recent` KV
// feed, and the awaits inside readEvents (LIVE.get) and before
// LIVE.put interleave concurrent steers WITHIN one isolate — N
// simultaneous steers each read the same pre-state and
// last-write-wins drops N-1. One in-flight append chain for the
// feed key, so steers serialize within the isolate. Cross-isolate
// remains last-writer-wins (the documented as-built posture — the
// comments precedent); a repo-keyed Durable Object is the
// deferred multi-isolate fix (CONTRACT §POST /sessions/{repo}/steer
// residual risks).
const sessionAppendChains = new Map<string, Promise<void>>();

/** Queue fn behind any in-flight steer append: one append
 *  critical section per feed key, per isolate. */
async function withSessionAppendGate<T>(fn: () => Promise<T>): Promise<T> {
 const prev = sessionAppendChains.get(EVENTS_KEY) ?? Promise.resolve();
 const { promise: next, resolve: release } = Promise.withResolvers<void>();
 sessionAppendChains.set(EVENTS_KEY, next);
 await prev;
 try {
  return await fn();
 } finally {
  release();
 }
}

/**
 * Append one session.steered event to the SAME durable feed GET
 * /events serves. Serialized by withSessionAppendGate (one
 * in-isolate writer at a time). Reuses recordEvent's validation
 * (validateEvent) so an invalid frame can never enter the feed —
 * recordEvent itself does the dedup/validation/publish; this
 * wrapper only serializes the read-modify-write window around it
 * (recordEvent's own LIVE.get/LIVE.put pair is the critical
 * section). Does NOT bump cache:gen (session.steered is not in
 * CACHE_INVALIDATING_TYPES — a steer changes no change-set, the
 * token-event reasoning). The SSE fan-out inside recordEvent is
 * best-effort (the recordEvent posture — a hub failure logs
 * events-hub-publisher and the KV write stands).
 */
async function appendSessionEvent(env: Env, event: LiveEvent): Promise<boolean> {
 let landed = false;
 await withSessionAppendGate(async () => {
  landed = await recordEvent(env, event); // true on store, false on reject/dedup
 });
 return landed;
}

/**
 * POST /sessions/{repo}/steer — record a steer instruction as a
 * session.steered event in the platform's real event feed (the
 * honest v1). Precondition order: 400 (shape) -> 429 (rate,
 * ROUTE_RATE_LIMITS["/sessions:write"] 30/60s) -> 403 (AD-9
 * allowlist — the path-carried repo cannot be adjudicated by
 * extractScope, so the handler re-checks DEMO_REPO_RE BEFORE any
 * store access, the /raw carve-out posture) -> 200. The
 * instruction is scrubbed at the seam
 * (stripInstructionLike(scrubFreeText(...)), the /intents AD-4
 * wire) before it enters the event record, and the response
 * carries only the recorded frame — NEVER the text (AD-4).
 * Content-free log line: counts only (the /intents precedent).
 */
async function handleSessionsSteer(request: Request, env: Env, repoParam: string): Promise<Response> {
 // Handler-side path discipline: the dynamic prefix is
 // "/sessions/" — the remainder must be exactly "<repo>/steer".
 // Anything else is the dispatcher's 404 not-found (the handler
 // returns it rather than guessing a repo).
 if (!repoParam.endsWith("/steer")) {
  return Response.json({ ok: false, error: "not-found" }, { status: 404 });
 }
 const repo = repoParam.slice(0, -"/steer".length);
 if (!REPO_NAME_RE.test(repo)) {
  return badRequest(`invalid repo name: ${JSON.stringify(repo)}`);
 }

 const parsed = parseSteerBody(await request.json().catch(() => null));
 if (parsed instanceof Response) return parsed;

 const rateDenied = rateGate("/sessions:write", request);
 if (rateDenied) return rateDenied;

 // Demo allowlist (AD-9) — the path-carried repo is adjudicated
 // HERE, before any store access (the /raw carve-out posture:
 // extractScope cannot see path params).
 if (!DEMO_REPO_RE.test(repo)) {
  return Response.json(
   { ok: false, error: "repo-not-allowed", detail: `repo "${repo}" is outside the demo allowlist` },
   { status: 403 },
  );
 }

 const event: LiveEvent = {
  type: SESSION_EVENT_TYPE,
  repo,
  // AD-4 wire: the untrusted instruction is stripped + scrubbed
  // where it enters the event record — the /intents seam. The
  // scrubbed form is stored as the frame's `instruction` field
  // (KEY=value lines render KEY=[redacted], instruction-like
  // lines [stripped]) — never the raw text.
  instruction: stripInstructionLike(scrubFreeText(parsed.instruction)),
  at: new Date().toISOString(),
  // Per-event uniqueness: every steer is a NEW client-initiated
  // write (not a queue replay), so the feed-dedup key includes
  // this fresh id and no two steers to one repo can collide
  // (the /comments newCommentId precedent — 12 lowercase hex).
  id: newCommentId(),
 };
 const landed = await appendSessionEvent(env, event);
 if (!landed) {
  // Dedup-dropped (or rejected) — the feed does not evidence
  // this event, so the response must not assert it (honest v1).
  // Content-free. With the per-event id above this is the
  // fail-closed backstop for a genuine store anomaly.
  return Response.json({ ok: false, error: "event-not-recorded" }, { status: 503 });
 }

 // Content-free log: counts only — never the instruction text
 // (the /intents precedent).
 console.log("steer", JSON.stringify({ repo, instructionLength: parsed.instruction.length }));
 return Response.json({
  ok: true,
  repo,
  event: { type: normalizeEventType(SESSION_EVENT_TYPE), repo, at: event.at },
 });
}

/** Static API routes — every entry authorizes before its handler runs. */
export const ROUTES: RouteEntry[] = [
 { path: "/health", method: "GET", action: "read", handler: handleHealth },
 { path: "/changes", method: "GET", action: "read", handler: handleChanges },
 { path: "/proposals", method: "GET", action: "read", handler: handleProposals },
 { path: "/floors", method: "GET", action: "read", handler: handleFloors },
 // Fork ecosystem (CAP-10): read-only six-cluster signals + lineage per
 // discovered agent-* fork. The authorize() chokepoint covers it (demo
 // mode gate; extractScope adjudicates the query-carried base pre-read).
 { path: "/forks", method: "GET", action: "read", handler: handleForks },
 // Issues triage (nextgit-e16): issues derived from existing
 // platform state (merge folds, fork-point walk, matcher
 // verdicts) — no new store. The authorize() chokepoint
 // covers it (demo mode gate; extractScope adjudicates the
 // query-carried base pre-read, the /forks posture). Capped
 // 60/60s (rateGate in the handler — the per-candidate merge
 // simulation is the /merge compute-cost class).
 { path: "/issues", method: "GET", action: "read", handler: handleIssues },
 // Agent roster + policy surface (identity v1): read-only
 // closed projection per discovered agent-* repo. The
 // authorize() chokepoint covers it (demo mode gate;
 // extractScope adjudicates the query-carried base
 // pre-read, the /forks posture).
 { path: "/agents", method: "GET", action: "read", handler: handleAgents },
 { path: "/merge", method: "GET", action: "read", handler: handleMerge },
 { path: "/land", method: "POST", action: "write", handler: handleLand },
 // Merge-back-to-upstream (CAP-10): a fork's work routed to its
 // recorded parent. Mutating route — authorize() + the CSRF gate
 // precede the handler like every POST; the handler re-checks
 // the AD-9 allowlist on the body-carried repo/base (the /land
 // defense-in-depth precedent).
 { path: "/upstream", method: "POST", action: "write", handler: handleUpstream },
 { path: "/judge", method: "POST", action: "judge", handler: handleJudge },
 // Intent matcher (CAP-10): advisory POST — the dispatcher's
 // authorize() (mode gate) + the CSRF gate precede the handler
 // for free (the /judge posture); the handler re-checks the AD-9
 // allowlist on the body-carried base (the /judge
 // defense-in-depth precedent).
 { path: "/intents", method: "POST", action: "judge", handler: handleIntents },
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
 // Repo-browsing read API (CONTRACT.md §GET /tree, §GET /file,
 // §GET /commits). GET, read-only: the authorize() chokepoint covers
 // them (demo mode gate; extractScope adjudicates the query-carried
 // repo against the demo allowlist pre-read, the /changes posture).
 // /tree and /commits are deliberately unbound (the /changes posture —
 // ROUTE_RATE_LIMITS carries no /tree or /commits row); /file is capped
 // 60/60s (rateGate inside the handler).
 { path: "/tree", method: "GET", action: "read", handler: handleTree },
 { path: "/file", method: "GET", action: "read", handler: handleFile },
 { path: "/commits", method: "GET", action: "read", handler: handleCommits },
 // Inline review comments (CONTRACT.md §POST /comments, §GET /comments):
 // the per-file review-thread data plane. Both verbs register at the same
 // path — the dispatcher matches path AND method exactly, so the API
 // boundary's 405 law still covers any third method. GET is query-carried
 // (the /file posture: authorize() adjudicates the repo via extractScope
 // pre-read); POST is body-carried (the /land /reveal posture: the handler
 // re-checks the AD-9 allowlist before any store access) and runs behind
 // authorize() + csrfGate.
 { path: "/comments", method: "GET", action: "read", handler: handleCommentsGet },
 { path: "/comments", method: "POST", action: "write", handler: handleCommentsPost },
 // Federation harness manifest (CONTRACT.md §GET /harnesses): the
 // BYO onboarding read surface. GET, read-only, parameter-free —
 // the authorize() chokepoint covers it (the /health posture:
 // namespace-wide, no repo/base/repos to adjudicate); deliberately
 // unbound (the /tree / /commits posture — ROUTE_RATE_LIMITS
 // carries no /harnesses row; the payload is a fixed static array).
 { path: "/harnesses", method: "GET", action: "read", handler: handleHarnesses },
 // GET /checks (CONTRACT.md §GET /checks): the authoritative
 // server-computed per-proposal checks — a pure projection of
 // the /proposals compute seam. GET, query-carried (the
 // /proposals posture: extractScope adjudicates base/repos at
 // the authorize() chokepoint pre-read), capped 60/60s
 // (rateGate inside the handler).
 { path: "/checks", method: "GET", action: "read", handler: handleChecks },
 // Session steering (nextgit-e16, CONTRACT.md §GET /sessions):
 // the honest v1 session list, derived from the platform's
 // real event feed. The authorize() chokepoint covers it
 // (demo mode gate; extractScope adjudicates the query-carried
 // base pre-read, the /forks posture). Deliberately unbound
 // (the /changes posture — ROUTE_RATE_LIMITS carries no
 // "/sessions" GET row; see §GET /sessions).
 { path: "/sessions", method: "GET", action: "read", handler: handleSessions },
];

export const DYNAMIC_ROUTES: Array<{ prefix: string; method: "GET" | "POST"; action: ActionType; handler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> }> = [
 { prefix: "/landings/", method: "GET", action: "read", handler: (request, env) => handleLandingsRead(new URL(request.url).pathname.slice("/landings/".length), env) },
 // /proposals/{repo} — the proposal card + detail entity (AD-14 client
 // protocol). Static `/proposals` (the set view) wins for the bare
 // path; `/proposals/<repo>` falls to this prefix (static-before-
 // dynamic, the dispatcher's exact-then-prefix order).
 { prefix: "/proposals/", method: "GET", action: "read", handler: (request, env) => handleProposalDetail(request, env, new URL(request.url).pathname.slice("/proposals/".length)) },
 // /asset/{blobId} — the asset download route (e12 integrity row;
 // FR-47). GET, read-only: the authorize() chokepoint covers it
 // (demo mode gate; `read` action, no repo param — extractScope
 // yields nothing to adjudicate). The handler validates the
 // 64-hex content-addressed key and funnels the byte fetch
 // through readVerifiedBlob, the single byte-returning
 // ASSET_BLOB.get (CONTRACT.md §GET /asset/{blobId}).
 { prefix: "/asset/", method: "GET", action: "read", handler: (request, env) => handleAssetDownload(request, env) },
 // /raw/{repo}/{ref}/{path} — the repo-browsing raw-byte read
 // (CONTRACT.md §GET /raw). GET, read-only: the authorize()
 // chokepoint covers the route, but its repo is PATH-carried,
 // which the query-only extractScope cannot adjudicate (the
 // /reveal carve-out) — the handler re-checks the demo
 // allowlist (DEMO_REPO_RE) and refuses secret-class paths (403)
 // BEFORE any binding read, fail-closed. Capped 60/60s
 // (rateGate in the handler).
 { prefix: "/raw/", method: "GET", action: "read", handler: (request, env) => handleRaw(request, env) },
 // /sessions/{repo}/steer — the session-steering write
 // (nextgit-e16, CONTRACT.md §POST /sessions/{repo}/steer).
 // POST, mutating: the dispatcher's dynamic branch applies
 // authorize() + csrfGate() to POSTs (the first dynamic POST
 // route — no dispatcher change needed). The path-carried repo
 // cannot be adjudicated by extractScope (query-only), so the
 // handler re-checks DEMO_REPO_RE BEFORE any store access (the
 // /raw carve-out posture) and rate-limits via
 // ROUTE_RATE_LIMITS["/sessions:write"]. The handler validates
 // the "/steer" suffix (repoParam.endsWith("/steer") -> strip;
 // anything else -> 404 not-found, the handler-side path
 // discipline).
 { prefix: "/sessions/", method: "POST", action: "write", handler: (request, env) => handleSessionsSteer(request, env, new URL(request.url).pathname.slice("/sessions/".length)) },
 // POST /asset/uploads/{uploadId}/complete — the client-direct multipart
 // control plane (nextgit-serve-blobs-via-presigned-direct-to-r2-
 // transfers; CONTRACT.md §POST /asset/uploads/{uploadId}/complete).
 // POST, mutating: the dispatcher's dynamic branch applies authorize()
 // + csrfGate() (no dispatcher change). Registered BEFORE the grant
 // prefix below — the dynamic loop is first-match-wins and
 // "/asset/uploads/<id>/complete" also starts with "/asset/uploads".
 // The handler validates the remainder (the /sessions/ steer idiom:
 // anything but "<uploadId>/complete" is a 404, never a guess).
 { prefix: "/asset/uploads/", method: "POST", action: "write", handler: (request, env) => handleAssetUploadComplete(request, env, new URL(request.url).pathname.slice("/asset/uploads/".length)) },
 // POST /asset/uploads — the direct-to-R2 upload grant (CONTRACT.md
 // §POST /asset/uploads). DYNAMIC rather than a static ROUTES entry:
 // the static form is unreachable-by-law. A static "POST
 // /asset/uploads" registers the path, so "GET /asset/uploads" would
 // be claimed by the "/asset/" GET prefix (handleAssetDownload's 400
 // bad-request) INSTEAD of the API boundary's 405 method-not-allowed —
 // breaking the route-discipline 405 law. As a POST prefix the GET
 // behaviour is unchanged (still the /asset/ GET route) and every
 // wrong method on "/asset/uploads" still 405s at the boundary.
 // The handler refuses any remainder (path discipline).
 { prefix: "/asset/uploads", method: "POST", action: "write", handler: (request, env) => handleAssetUploadGrant(request, env, new URL(request.url).pathname.slice("/asset/uploads".length)) },
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
 "/app.js": true, "/reveal-decision.js": true, "/land-verdict.js": true, "/tour.html": true, "/tour.css": true, "/tour.js": true,
 // Wave-13: the files page + the app.js module split + the parity pages.
 "/files.html": true, "/js/files-page.js": true,
 "/js/state.js": true, "/js/api.js": true, "/js/conflicts.js": true,
 "/js/ticker.js": true, "/js/proposals.js": true, "/js/modal.js": true,
 "/js/land.js": true, "/js/reveal.js": true, "/js/interactions.js": true,
 // Wave-14: the checks strip module + inline review comments.
 "/js/checks.js": true,
 "/js/comments.js": true,
 "/parity.html": true, "/parity.js": true, "/parity-data.js": true,
 // Wave-14: the commit-history page + the forks panel modules.
 "/history.html": true, "/js/history-page.js": true,
 "/js/forks-panel.js": true,
 // nextgit-e16 (wave-15 lane-union marker): the issues
 // triage panel module.
 "/js/issues-panel.js": true,
 // nextgit-e16 (wave-16): the story page + the judge-set comparison + sessions panel modules.
 "/story.html": true, "/js/story-page.js": true,
 "/js/judge-comparison.js": true,
 "/js/sessions-panel.js": true,
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
