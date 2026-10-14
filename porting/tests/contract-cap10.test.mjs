#!/usr/bin/env bun
// Contract suite: CAP-10 contract pin — intent/matcher, fork signals, upstream route.
//
// Parses platform/CONTRACT.md text directly (no live endpoint exists yet —
// probes arrive with the implementation orders). Idiom: events-contract.test.mjs
// check() accumulator; exit 0 = pass. No network, no mock.module, full-suite safe.
//
// 8 assertion groups (per plan nextgit-e13-impl-cap10-contract-pin):
//   1. three CAP-10 sections exist + their json blocks parse
//   2. exact verdict vocabulary — three verbatim definition strings + kebab tokens, no fourth token
//   3. all seven v2 route sections survive with v2 body-shape fragments verbatim
//   4. six-cluster keys in both /forks and /intents + lineage fields
//   5. /upstream vs /land evidence key-set parity (mechanical)
//   6. /upstream status-ordering sequence equals /land's
//   7. fork-community.md referenced
//   8. header declares Version: v3
//
// Run: bun porting/tests/contract-cap10.test.mjs  (exit 0 = pass)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONTRACT_PATH = join(ROOT, "platform/CONTRACT.md");

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

let text = "";
try {
  text = readFileSync(CONTRACT_PATH, "utf8");
} catch (e) {
  check("contract file read", false, String((e && e.stack) || e));
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

// Section index: every `## <title>` heading with its byte offset.
const sectionRe = /^## (.+)$/gm;
const sections = [];
{
  let m;
  while ((m = sectionRe.exec(text)) !== null) {
    sections.push({ title: m[1], index: m.index });
  }
}
// Body of one section = from its heading to the next `## ` heading.
const sectionBody = (title) => {
  const start = sections.find((s) => s.title === title);
  if (!start) return null;
  let end = text.length;
  for (const s of sections) {
    if (s.index > start.index && s.index < end) end = s.index;
  }
  return text.slice(start.index, end);
};
// All ```json fence payloads in a section body.
const jsonFences = (body) => {
  const out = [];
  const re = /```json\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(body || "")) !== null) out.push(m[1]);
  return out;
};

// ---- Group 1: three CAP-10 sections exist + their json blocks parse ----
const intentsBody = sectionBody("POST /intents");
const forksBody = sectionBody("GET /forks?base=demo");
const upstreamBody = sectionBody("POST /upstream");
check("1a section exists: ## POST /intents", intentsBody !== null);
check("1b section exists: ## GET /forks?base=demo", forksBody !== null);
check("1c section exists: ## POST /upstream", upstreamBody !== null);

// intents carries two json fences (request body, then response); the response
// fence contains the `{ … }` signals ellipsis, so assert the *body* fence parses.
let intentsJson = null, forksJson = null, upstreamJson = null;
try { intentsJson = JSON.parse(jsonFences(intentsBody)[0]); } catch { intentsJson = null; }
try { forksJson = JSON.parse(jsonFences(forksBody)[0]); } catch { forksJson = null; }
try { upstreamJson = JSON.parse(jsonFences(upstreamBody)[0]); } catch { upstreamJson = null; }
check("1d POST /intents json body block parses", intentsJson !== null);
check("1e GET /forks json block parses", forksJson !== null);
check("1f POST /upstream json block parses", upstreamJson !== null);

// ---- Group 2: exact verdict vocabulary ----
const V1 = "their work does the job — direct merge recommendation";
const V2 = "partial fit — build with their implementation in hand; LLM-merge/refactor economics apply";
const V3 = "different goal";
check("2a verbatim def 'merge it'", intentsBody && intentsBody.includes(`**merge it** — ${V1}`), "merge-it definition");
check("2b verbatim def 'use as context'", intentsBody && intentsBody.includes(`**use as context** — ${V2}`), "use-as-context definition");
check("2c verbatim def 'ignore'", intentsBody && intentsBody.includes(`**ignore** — ${V3}`), "ignore definition");
const kebabTokens = ["merge-it", "use-as-context", "ignore"];
const allKebabPresent = kebabTokens.every((t) => intentsBody && intentsBody.includes(t));
check("2d kebab tokens present", allKebabPresent);
// the verdict enum line names exactly the three tokens
const enumLine = (intentsBody || "").match(/`verdict` ∈ `([^`]+)`/);
check("2e verdict enum exactly merge-it | use-as-context | ignore", enumLine !== null && enumLine[1] === "merge-it | use-as-context | ignore", enumLine && enumLine[1]);
// no fourth token anywhere in the vocabulary subsection
const vocabIdx = (intentsBody || "").indexOf("### Matcher verdict vocabulary");
const vocabSection = vocabIdx >= 0 ? intentsBody.slice(vocabIdx) : "";
// the /intents intro (heading → vocabulary subsection) is the span the
// companion-reference plan pins first; refs[0] is scoped to it (HIGH-2 fix).
const introEnd = (intentsBody || "").indexOf("### Matcher verdict vocabulary");
const introSection = introEnd >= 0 ? intentsBody.slice(0, introEnd) : "";
const fourthToken = /\b(merge-its|use-as-contexts|ignores|reject|accept|maybe|partial-merge)\b/.test(vocabSection);
check("2f no fourth token in the enum", !fourthToken);

// ---- Group 3: all seven v2 route sections survive with v2 body-shape fragments verbatim ----
const v2Sections = [
  ["GET /health", "`{ ok, service, namespace }`"],
  ["GET /changes?repo=...&base=demo&ref=main&baseRef=main", "Per-proposal change-set (server-side; no clones)"],
  ["GET /proposals?base=demo&repos=a,b (repos optional → auto-discover `agent-*`)", "The set view + conflict map"],
  ["GET /merge?base=demo&repos=agent-3[,agent-1,...]&ref=main&baseRef=main", "Fold proposals in order onto the baseline — per-file 3-way merge (diff3)"],
  ["POST /land", "This is the browser's one-click \"ship it\""],
  ["POST /judge", "advisory only: the route writes nothing and lands nothing"],
  ["GET /events", "newest first, ≤50, from KV"],
];
for (const [title, fragment] of v2Sections) {
  const body = sectionBody(title);
  check(`3 v2 section survives: ## ${title}`, body !== null && body.includes(fragment), fragment);
}

// ---- Group 4: six-cluster keys in both /forks and /intents + lineage fields ----
const SIX = ["fitOverlap", "peopleTrust", "liveness", "proof", "distance", "costToAdoptVsRegenerate"];
const forksHasSix = SIX.every((k) => forksBody && forksBody.includes(k));
const intentsMentionsSix = SIX.every((k) => intentsBody && intentsBody.includes(k));
check("4a six-cluster keys in GET /forks", forksHasSix, SIX.filter((k) => !(forksBody || "").includes(k)).join(","));
check("4b six-cluster keys referenced in POST /intents", intentsMentionsSix, SIX.filter((k) => !(intentsBody || "").includes(k)).join(","));
check("4c /forks lineage upstream {repo, forkPoint}", forksBody && forksBody.includes('"upstream"') && forksBody.includes("forkPoint"));
check("4d /forks upstream null when unrecorded", forksBody && forksBody.includes("null") && forksBody.includes("unrecorded"));

// ---- Group 5: /upstream vs /land evidence key-set parity (mechanical) ----
const LAND_EVIDENCE_KEYS = ["repos", "commit", "ancestor", "heads", "foldHash", "checks", "results", "mergedSha", "testedSha", "artifactRef", "at"];
const landEvidenceBlock = sectionBody("POST /land") || "";
const upstreamKeysDeclared = upstreamBody || "";
const parityOk = LAND_EVIDENCE_KEYS.every((k) => landEvidenceBlock.includes(k) && upstreamKeysDeclared.includes(k));
check("5 /upstream evidence key-set parity with /land (mechanical)", parityOk, LAND_EVIDENCE_KEYS.filter((k) => !upstreamKeysDeclared.includes(k)).join(","));
// Extract the backtick-quoted status tokens from each "Precondition order:"
// line, cutting at the terminal `200` (prose after it — e.g. "(mirrors
// `/land`)" — is commentary, not part of the sequence).
const statusSeq = (body) => {
  const m = (body || "").match(/Precondition order:(.*)/);
  if (!m) return null;
  const toks = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  const i = toks.indexOf("200");
  return i >= 0 ? toks.slice(0, i + 1) : toks;
};
// The /land sequence carries the AD-11 auto-land gate's codes
// (409 content-detected-secret / 503 judge-unavailable / 409
// autoland-escalate / 409 autoland-blocked) between the
// withheld-secret and conflict steps — that gate lives INSIDE
// POST /land only; /upstream has no model gate, so 6d compares /upstream
// against the /land sequence MINUS the gate codes.
const LAND_ORDER = ["400", "429", "403", "409 stale", "409 withheld-secret", "409 content-detected-secret", "503 judge-unavailable", "409 autoland-escalate", "409 autoland-blocked", "409 conflict", "409 silent-drop-detected", "409 no-changes", "409 base-moved", "200"];
const LAND_ONLY_GATE_CODES = new Set(["409 content-detected-secret", "503 judge-unavailable", "409 autoland-escalate", "409 autoland-blocked"]);
const landSeq = statusSeq(landEvidenceBlock);
const upstreamSeq = statusSeq(upstreamKeysDeclared);
check("6a /land precondition order line present", landSeq !== null && landSeq.length > 0);
check("6b /upstream precondition order line present", upstreamSeq !== null && upstreamSeq.length > 0);
check("6c /land order matches the pinned sequence", landSeq !== null && LAND_ORDER.every((v, i) => landSeq[i] === v), `land=[${(landSeq || []).join(",")}]`);
const landCore = landSeq === null ? null : landSeq.filter((v) => !LAND_ONLY_GATE_CODES.has(v));
check("6d /upstream status-ordering sequence equals /land's (minus the /land-only auto-land gate codes)", landCore !== null && upstreamSeq !== null && landCore.length === upstreamSeq.length && landCore.every((v, i) => v === upstreamSeq[i]), `land-core=[${(landCore || []).join(",")}] upstream=[${(upstreamSeq || []).join(",")}]`);

// ---- Group 7: fork-community.md referenced ----
const refs = [
  Boolean(introSection && introSection.includes("fork-community.md")),
  vocabSection.includes("fork-community.md"),
  upstreamKeysDeclared.includes("fork-community.md"),
];
check("7 fork-community.md referenced (intents intro, vocabulary, upstream companion)", refs.every(Boolean), `refs=${refs.join(",")}`);

// ---- Group 8: header declares Version: v3 ----
const versionLine = text.split("\n").find((l) => l.startsWith("Version:"));
check("8 header declares Version: v3", versionLine !== null && /^Version:\s*v3/.test(versionLine), versionLine || "no Version line");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
