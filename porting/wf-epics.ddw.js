// porting/wf-epics.ddw.js — NextGit epics/story compiler (DDW, handle era).
//
// RUN VIA ONE-LINER IMPORT — never transcribe this file:
//   const { main } = await import("./porting/wf-epics.ddw.js");
//   await main({ upto: "design" });          // extract → design → plan (+packs) — fast
//   await main({ phase: "author-start" });    // push the author pool; return immediately
//   //  ... hub wait ids:["epics-author"] until drained ...
//   await main({ phase: "author-collect" });  // validate slice files on disk
//   await main({ phase: "verify-start" });    // push the verifier pool (separate = maker-checker)
//   //  ... hub wait ids:["story-verifier"] ...
//   await main({ phase: "verify-collect" });  // persist verdicts + deterministic lint
//   await main({ phase: "compile" });         // stage rows (blocked) + backfill report
//
// Disk is the truth: every artifact lands in porting/compile/runs/<compileId>/; the run
// resumes from disk (a valid slice file is skipped; a SHIP verdict is kept). Workers never
// commit; the orchestrator (session) commits at green. Staged rows stay `blocked` until the
// activation gate: `bun porting/tasks.mjs activate compile:<compileId>`.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------- helpers ----
const readJSON = (p, orNull = false) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { if (orNull) return null; throw new Error(`cannot parse ${p}: ${e.message}`); }
};
const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const STOP = new Set(["with", "that", "this", "from", "into", "over", "under", "when", "then", "than", "they", "them", "their", "have", "has", "the", "and", "for", "not", "are", "was", "will", "its", "all", "per", "via", "may", "must", "should", "each", "other", "same", "only", "also", "more", "most", "some", "such", "use", "used", "using", "make", "made", "need", "needs", "without"]);
const tokens = (s) => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((t) => t.length > 3 && !STOP.has(t)))];

const spawnTasks = (root, args) =>
  execFileSync("bun", [`${root}/porting/tasks.mjs`, ...args], { cwd: root, encoding: "utf8", timeout: 30000 }).trim();

function openRun({ root, compileId }) {
  const latestPath = `${root}/porting/compile/LATEST.json`;
  if (!compileId) {
    const latest = readJSON(latestPath, true);
    if (!latest?.runDir) throw new Error("no compile run yet — start with main({ upto: 'design' })");
    return latest;
  }
  const runDir = `${root}/porting/compile/runs/${compileId}`;
  for (const d of ["packs", "slices", "verdicts"]) mkdirSync(`${runDir}/${d}`, { recursive: true });
  const state = { compileId, runDir, root, phase: "init", updatedAt: new Date().toISOString() };
  writeJSON(latestPath, state);
  return state;
}
function touchRun(state, phaseName, extra = {}) {
  state.phase = phaseName;
  state.updatedAt = new Date().toISOString();
  Object.assign(state, extra);
  writeJSON(`${state.root}/porting/compile/LATEST.json`, state);
}

const DESIGN_SCHEMA = {
  type: "object",
  required: ["epics", "coverage", "notes"],
  properties: {
    epics: {
      type: "array", items: {
        type: "object", required: ["id", "title", "goal", "milestone"], properties: {
          id: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, milestone: { type: "string" }
        }
      }
    },
    coverage: {
      type: "array", items: {
        type: "object", required: ["req", "epic"], properties: {
          req: { type: "string" }, epic: { type: "string" }, note: { type: "string" }
        }
      }
    },
    notes: { type: "array", items: { type: "string" } },
  },
};

const AUTHOR_CONTEXT = [
  "You are one instance of the epics-author role in the NextGit story compile.",
  "Your pack is your contract; the frozen schema is law. Write exactly one slice file; never touch anything else; never git.",
  "Status-aware coverage: built requirements get verification stories (prove + evidence, never rebuild); unbuilt get implementation stories; roadmap → milestone 'unsequenced'.",
  "check_cmd must be real and runnable from the repo root (jaq on this box: use -ec). Stable ids. Minimal deps.",
].join(" ");

const VERIFIER_CONTEXT = [
  "You are one instance of the story-verifier role in the NextGit story compile (maker-checker — you did not author this slice).",
  "Read the slice, its pack, and the frozen schema; check coverage per kind, ids, check_cmd reality, acceptance testability, deps validity, dedupe.",
  "Write exactly one verdict file; SHIP requires 0 critical + 0 high. Never edit the slice.",
].join(" ");

const isValidSliceFile = (p, planned) => {
  const j = readJSON(p, true);
  return !!(j && j.slice === planned.id && j.kind === planned.kind && Array.isArray(j.stories));
};

// ------------------------------------------------------------- phase: extract --
export async function extract({ root = process.cwd(), compileId } = {}) {
  const state = openRun({ root, compileId });
  const out = execFileSync("bun", [`${root}/porting/compile/extract.mjs`, "--root", root], { cwd: root, encoding: "utf8", timeout: 30000 }).trim();
  const req = readJSON(`${root}/porting/compile/requirements.json`);
  touchRun(state, "extracted", { counts: req.counts });
  log(`extract: ${out.split("\n").pop()}`);
  return { phase: "extract", compileId: state.compileId, counts: req.counts };
}

// -------------------------------------------------------------- phase: design --
export async function design({ root = process.cwd(), compileId, force = false } = {}) {
  const state = openRun({ root, compileId });
  const runDir = state.runDir;
  const proposedPath = `${runDir}/epics.proposed.json`;
  const reqPath = `${root}/porting/compile/requirements.json`;
  const req = readJSON(reqPath);

  if (!force && existsSync(proposedPath)) {
    log("design: reusing existing epics.proposed.json (force:true to redesign)");
  } else {
    phase("epics-designer");
    const prompt =
      `Design the epic list for the NextGit compile (working root: ${root}).\n` +
      `Requirements extract — read IN FULL first: ${reqPath}\n` +
      `Source of record (read the FR sections you group):\n` +
      `- PRD: ${root}/_bmad-output/planning-artifacts/prds/prd-cloudflare-git-comp-2026-10-06/prd.md (§4 features, §13 milestones)\n` +
      `- UX spines: ${root}/_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/DESIGN.md + EXPERIENCE.md\n` +
      `- Architecture spine: ${root}/_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md\n` +
      `Scale: ${req.counts.frs} FRs (${req.counts.frs_needing_implementation} need implementation, ${req.counts.frs_needing_verification} need verification) + ${req.counts.nfrs} NFRs + ${req.counts.ux_drs} UX-DRs.\n` +
      `Milestone bands: M1 competition (Oct 14), M2 identity+data, M3 asset tier, M4 fork community+clients.\n` +
      `Every requirement id must appear EXACTLY ONCE in coverage. Return ONLY the schema JSON.`;
    const h = await agent(prompt, { agent: "epics-designer", label: "epics-designer", schema: DESIGN_SCHEMA });
    const res = await h.wait();
    const epics = res.epics ?? [];
    const coverage = res.coverage ?? [];
    const validIds = new Set([...req.frs, ...req.nfrs, ...req.ux_drs].map((r) => r.id));
    const seen = new Map();
    const problems = [];
    for (const c of coverage) {
      if (!validIds.has(c.req)) problems.push(`coverage references unknown requirement ${c.req}`);
      if (seen.has(c.req)) problems.push(`coverage duplicate for ${c.req}`);
      seen.set(c.req, c.epic);
      if (!epics.some((e) => e.id === c.epic)) problems.push(`coverage ${c.req} → unknown epic ${c.epic}`);
    }
    for (const id of validIds) if (!seen.has(id)) problems.push(`coverage missing ${id}`);
    if (epics.length < 6 || epics.length > 16) problems.push(`epic count ${epics.length} outside 6..16`);
    if (problems.length) {
      writeJSON(`${runDir}/design.problems.json`, problems);
      throw new Error(`design failed validation (${problems.length} problems) — see ${runDir}/design.problems.json`);
    }
    writeJSON(proposedPath, { generatedAt: new Date().toISOString(), epics, coverage });
  }

  const d = readJSON(proposedPath);
  const source = `compile:${state.compileId}`;
  for (const e of d.epics) {
    spawnTasks(root, ["epic-upsert", "--id", e.id, "--title", e.title, "--goal", e.goal ?? "", "--milestone", e.milestone ?? "", "--source", source]);
  }
  touchRun(state, "designed", { epics: d.epics.length });
  return { phase: "design", compileId: state.compileId, epics: d.epics.length, coverage: d.coverage.length };
}

// ---------------------------------------------------------------- phase: plan --
export function plan({ root = process.cwd(), compileId, force = false } = {}) {
  const state = openRun({ root, compileId });
  const runDir = state.runDir;
  const req = readJSON(`${root}/porting/compile/requirements.json`);
  const d = readJSON(`${runDir}/epics.proposed.json`);
  const epicOf = new Map(d.coverage.map((c) => [c.req, c.epic]));

  const byEpic = new Map(d.epics.map((e) => [e.id, { epic: e, impl: [], verify: [], extras: [] }]));
  for (const f of req.frs) {
    const epic = epicOf.get(f.id);
    if (!byEpic.has(epic)) throw new Error(`FR ${f.id} → unknown epic ${epic}`);
    if (f.needs.implementation) byEpic.get(epic).impl.push(f);
    if (f.needs.verification) byEpic.get(epic).verify.push(f);
  }
  for (const x of [...req.nfrs, ...req.ux_drs]) {
    const epic = epicOf.get(x.id);
    if (!byEpic.has(epic)) throw new Error(`${x.id} → unknown epic ${epic}`);
    byEpic.get(epic).extras.push(x);
  }

  const slices = [];
  for (const [eid, g] of byEpic) {
    // NFR/UX-DR rule: to the implementation slice when the epic has one, else the verification slice.
    if (g.impl.length) g.impl.push(...g.extras);
    else g.verify.push(...g.extras);
    const mk = (kind, items) => {
      if (!items.length) return;
      const chunks = [];
      for (let i = 0; i < items.length; i += 12) chunks.push(items.slice(i, i + 12));
      chunks.forEach((chunk, idx) => {
        const id = `${eid}-${kind}${chunks.length > 1 ? `-${String.fromCharCode(97 + idx)}` : ""}`;
        slices.push({
          id,
          epic: eid,
          kind: kind === "impl" ? "implementation" : "verification",
          reqIds: chunk.map((x) => x.id),
          items: chunk,
          pack: `${runDir}/packs/${id}.md`,
          output: `${runDir}/slices/${id}.json`,
          verdict: `${runDir}/verdicts/${id}.json`,
        });
      });
    };
    mk("impl", g.impl);
    mk("verify", g.verify);
  }

  // existing rows for dedupe awareness (deterministic token overlap; one store read)
  let existing = [];
  try {
    existing = JSON.parse(spawnTasks(root, ["list", "--status", "pending", "--json"]));
  } catch (e) {
    log(`plan: store read failed (${e.message}) — packs will omit the dedupe list`);
  }
  const existingTok = existing.map((r) => ({ id: r.id, title: r.title, status: r.status, toks: tokens(r.title) }));

  for (const s of slices) {
    const epic = byEpic.get(s.epic).epic;
    const itemTexts = s.items.map((x) => `${x.id} ${x.title ?? ""} ${x.text ?? ""}`);
    const want = tokens(s.id + " " + epic.title + " " + epic.goal + " " + itemTexts.join(" "));
    const wantSet = new Set(want);
    const overlaps = existingTok
      .map((r) => ({ ...r, score: r.toks.filter((t) => wantSet.has(t)).length }))
      .filter((r) => r.score >= 2)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 25);

    const blocks = s.items.map((it) =>
      it.id.startsWith("FR-")
        ? `### ${it.id} — ${it.title}\n- status: \`${it.status_raw}\`\n- needs: implementation=${it.needs.implementation}, verification=${it.needs.verification}${it.milestone_hint ? `\n- milestone hint: ${it.milestone_hint}` : ""}\n- description: ${it.description}\n- consequences (testable):\n${it.consequences.map((c) => `  - ${c}`).join("\n")}`
        : `### ${it.id}\n- ${it.text}`,
    );

    const pack = [
      `# Slice pack — ${s.id}`,
      ``,
      `**Kind:** ${s.kind} · **Epic:** ${s.epic} — ${epic.title} · **Milestone:** ${epic.milestone}`,
      `**Epic goal:** ${epic.goal}`,
      `**Your output file (write exactly this one file):** ${s.output}`,
      ``,
      `## Law (frozen — read ${root}/porting/compile/SCHEMA.md IN FULL)`,
      `- built requirements → verification stories (prove + evidence; NEVER rebuild); unbuilt (build-gap/required-M1/planned/pending/sequenced/roadmap) → implementation stories (roadmap → milestone "unsequenced").`,
      `- Every story: id (stable slug, LOWERCASE ONLY \`${s.epic.toLowerCase()}-${s.kind === "verification" ? "verify" : "impl"}-<short-slug>\`), title, kind, epic="${s.epic}", milestone, priority (P0 critical path / P1 / P2 / P3), fr_refs, scope, acceptance (observable), check_cmd (REAL + runnable from repo root; jaq → use -ec), deps ([] unless verified), notes optional.`,
      `- Cover EVERY requirement below. Slice kind = ${s.kind}: ${s.kind === "verification" ? "author verification stories for the built requirements here." : "author implementation stories for the unbuilt requirements here (plus any NFR/UX-DR items that need building)."}`,
      ``,
      `## Your requirements (${s.reqIds.join(", ")})`,
      ...blocks,
      ``,
      `## Existing store rows overlapping this slice (do NOT recreate; reference in notes and author only the delta)`,
      ...(overlaps.length ? overlaps.map((o) => `- \`${o.id}\` [${o.status}] ${o.title} (overlap ${o.score})`) : ["- (none)"]),
      ``,
      `## Architecture context`,
      `Constraints:`,
      ...req.arch_constraints.map((c) => `- ${c.text}`),
      `Near-term capabilities:`,
      ...req.arch_capabilities.map((c) => `- ${c.text}`),
      ``,
      `## Source refs`,
      `- PRD: ${root}/_bmad-output/planning-artifacts/prds/prd-cloudflare-git-comp-2026-10-06/prd.md`,
      `- Platform contract: ${root}/platform/CONTRACT.md · SPEC: ${root}/_bmad-output/specs/spec-next-git-platform/SPEC.md`,
      `- UX spines: ${root}/_bmad-output/planning-artifacts/ux-designs/ux-cloudflare-git-comp-2026-10-05/`,
      `- Arch spine: ${root}/_bmad-output/planning-artifacts/architecture/architecture-cloudflare-git-comp-2026-10-05/ARCHITECTURE-SPINE.md`,
    ].join("\n");
    writeFileSync(s.pack, pack + "\n");
    delete s.items; // slices.json keeps the plan, not the payload
  }

  writeJSON(`${runDir}/slices.json`, { generatedAt: new Date().toISOString(), slices });
  touchRun(state, "planned", { slices: slices.length });
  log(`plan: ${slices.length} slices, ${slices.filter((s) => s.kind === "implementation").length} impl / ${slices.filter((s) => s.kind === "verification").length} verify`);
  return { phase: "plan", compileId: state.compileId, slices: slices.length };
}

// -------------------------------------------------------- phase: author pool ----
async function startAuthorPool({ root, state, poolName, only, force, findings }) {
  const runDir = state.runDir;
  const planData = readJSON(`${runDir}/slices.json`);
  const pool = await workpool("epics-author", { name: poolName, context: AUTHOR_CONTEXT });
  const items = [];
  let skipped = 0;
  for (const s of planData.slices) {
    if (only && !only.includes(s.id)) continue;
    if (!force && isValidSliceFile(s.output, s)) { skipped++; continue; }
    const findingBlock = findings?.[s.id]?.length
      ? `\nREPAIR ROUND — the verifier/lint found these problems in your previous slice; fix them:\n- ${findings[s.id].join("\n- ")}\n`
      : "";
    items.push(
      `AUTHOR SLICE ${s.id} (kind: ${s.kind}) for the NextGit compile.${findingBlock}\n` +
      `1. Read your pack IN FULL: ${s.pack}\n` +
      `2. Read the frozen schema: ${root}/porting/compile/SCHEMA.md\n` +
      `3. Author the stories for every requirement in the pack; write EXACTLY ONE file: ${s.output}\n` +
      `4. Validate it parses (bun -e with JSON.parse); then reply with {"slicePath","storyCount","summary"}.`,
    );
  }
  if (items.length) await pool.push(...items);
  return { pool, pushed: items.length, skipped };
}

export async function authorStart({ root = process.cwd(), compileId, poolName = "epics-author", only, force = false } = {}) {
  const state = openRun({ root, compileId });
  const { pushed, skipped } = await startAuthorPool({ root, state, poolName, only, force });
  touchRun(state, `authoring:${poolName}`, { authorPool: poolName, authorPushed: pushed, authorSkipped: skipped });
  log(`author pool ${poolName}: pushed ${pushed}, skipped ${skipped}`);
  return { phase: "author-start", compileId: state.compileId, pool: poolName, pushed, skipped };
}

export async function authorCollect({ root = process.cwd(), compileId } = {}) {
  const state = openRun({ root, compileId });
  const planData = readJSON(`${state.runDir}/slices.json`);
  const report = { ok: [], bad: [] };
  for (const s of planData.slices) {
    try {
      const j = readJSON(s.output);
      const problems = [];
      if (j.slice !== s.id) problems.push("slice id mismatch");
      if (j.kind !== s.kind) problems.push(`kind ${j.kind} != planned ${s.kind}`);
      if (!Array.isArray(j.stories)) problems.push("stories not an array");
      else for (const st of j.stories) {
        for (const k of ["id", "title", "kind", "fr_refs", "scope", "acceptance", "check_cmd"]) if (!st[k]) problems.push(`story ${st.id ?? "?"} missing ${k}`);
      }
      problems.length ? report.bad.push({ slice: s.id, problems }) : report.ok.push(s.id);
    } catch (e) {
      report.bad.push({ slice: s.id, problems: [e.message] });
    }
  }
  writeJSON(`${state.runDir}/author-collect.json`, report);
  touchRun(state, "authored", { authoredOk: report.ok.length, authoredBad: report.bad.length });
  log(`author-collect: ok ${report.ok.length}, bad ${report.bad.length} (of ${planData.slices.length})`);
  return { phase: "author-collect", compileId: state.compileId, ok: report.ok, bad: report.bad };
}

// -------------------------------------------------------- phase: verify pool ----
export async function verifyStart({ root = process.cwd(), compileId, poolName = "story-verifier", only } = {}) {
  const state = openRun({ root, compileId });
  const planData = readJSON(`${state.runDir}/slices.json`);
  const pool = await workpool("story-verifier", { name: poolName, context: VERIFIER_CONTEXT });
  const items = [];
  let kept = 0;
  for (const s of planData.slices) {
    if (only && !only.includes(s.id)) continue;
    const prior = readJSON(s.verdict, true);
    if (!only && prior?.verdict === "SHIP") { kept++; continue; } // resume: SHIPs stay
    items.push(
      `VERIFY SLICE ${s.id} for the NextGit compile.\n` +
      `1. Read: slice ${s.output} · pack ${s.pack} · schema ${root}/porting/compile/SCHEMA.md.\n` +
      `2. Check coverage per kind, ids, check_cmd reality, acceptance testability, deps, dedupe (see your role rules).\n` +
      `3. Write EXACTLY ONE verdict file: ${s.verdict} — {"slice","verdict","findings":[{"severity","story","note"}],"summary"}.\n` +
      `4. Reply with the same verdict object.`,
    );
  }
  if (items.length) await pool.push(...items);
  touchRun(state, `verifying:${poolName}`, { verifyPool: poolName, verifyPushed: items.length, verifyKept: kept });
  log(`verify pool ${poolName}: pushed ${items.length}, kept(SHIP) ${kept}`);
  return { phase: "verify-start", compileId: state.compileId, pool: poolName, pushed: items.length, kept };
}

// -------------------------------------------------------------- phase: normalize --
// Deterministic post-authoring pass: lowercase story ids (and deps referencing compiled ids)
// so the frozen id law holds regardless of template drift. Runs after the author pool drains,
// before verify — one writer per file is respected (authors are complete by then).
export function normalize({ root = process.cwd(), compileId } = {}) {
  const state = openRun({ root, compileId });
  const planData = readJSON(`${state.runDir}/slices.json`);
  const files = [];
  for (const s of planData.slices) {
    const j = readJSON(s.output, true);
    if (j) files.push({ s, j });
  }
  const lower = new Map();
  for (const { j } of files) for (const st of j.stories ?? []) lower.set(st.id, String(st.id).toLowerCase());
  let changed = 0;
  for (const { s, j } of files) {
    let dirty = false;
    for (const st of j.stories ?? []) {
      const nid = lower.get(st.id);
      if (nid && nid !== st.id) { st.id = nid; dirty = true; }
      if (Array.isArray(st.deps)) for (let i = 0; i < st.deps.length; i++) {
        const nd = lower.get(st.deps[i]);
        if (nd && nd !== st.deps[i]) { st.deps[i] = nd; dirty = true; }
      }
    }
    if (dirty) { writeJSON(s.output, j); changed++; }
  }
  touchRun(state, "normalized", { normalized: changed });
  log(`normalize: ${changed} of ${files.length} slice files adjusted to lowercase ids`);
  return { phase: "normalize", compileId: state.compileId, changed, files: files.length };
}

// -------------------------------------------------------------- phase: lint ------
export function lint({ root = process.cwd(), compileId } = {}) {
  const state = openRun({ root, compileId });
  const runDir = state.runDir;
  const req = readJSON(`${root}/porting/compile/requirements.json`);
  const planData = readJSON(`${runDir}/slices.json`);
  const allStories = [];
  const gaps = [];
  for (const s of planData.slices) {
    const j = readJSON(s.output, true);
    if (!j) { gaps.push({ type: "missing-slice", slice: s.id, detail: `${s.output} missing or unparseable` }); continue; }
    for (const st of j.stories ?? []) allStories.push({ ...st, _slice: s.id });
  }
  // id uniqueness + format
  const ids = new Map();
  for (const st of allStories) {
    if (ids.has(st.id)) gaps.push({ type: "duplicate-id", id: st.id, detail: `in ${ids.get(st.id)} and ${st._slice}` });
    ids.set(st.id, st._slice);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(st.id)) gaps.push({ type: "bad-id", id: st.id });
    if (!["implementation", "verification"].includes(st.kind)) gaps.push({ type: "bad-kind", id: st.id, detail: st.kind });
    if (!/^P[0-3]$/.test(st.priority ?? "")) gaps.push({ type: "bad-priority", id: st.id, detail: st.priority });
    if (st.milestone && !/^(M[1-4]|unsequenced)$/.test(st.milestone)) gaps.push({ type: "bad-milestone", id: st.id, detail: st.milestone });
    const placeholderish = !st.check_cmd || /^\s*(tbd|placeholder|todo|fixme|n\/?a|\?+)\s*$/i.test(st.check_cmd) || /<(tbd|placeholder|fill[-_ ]?me|insert[-_ ]?here|your[-_ ]command)>/i.test(st.check_cmd);
    if (placeholderish) gaps.push({ type: "bad-check", id: st.id, detail: st.check_cmd ?? "(empty)" });
    for (const r of st.fr_refs ?? []) {
      const known = req.frs.some((f) => f.id === r) || req.nfrs.some((n) => n.id === r) || req.ux_drs.some((u) => u.id === r);
      if (!known) gaps.push({ type: "unknown-ref", id: st.id, detail: r });
    }
  }
  // coverage (status-aware) across all slices
  const refOfKind = (reqId, kind) => allStories.some((st) => st.kind === kind && (st.fr_refs ?? []).includes(reqId));
  for (const f of req.frs) {
    if (f.needs.implementation && !refOfKind(f.id, "implementation")) gaps.push({ type: "coverage", req: f.id, detail: "no implementation story" });
    if (f.needs.verification && !refOfKind(f.id, "verification")) gaps.push({ type: "coverage", req: f.id, detail: "no verification story" });
  }
  for (const x of [...req.nfrs, ...req.ux_drs]) if (!allStories.some((st) => (st.fr_refs ?? []).includes(x.id))) gaps.push({ type: "coverage", req: x.id, detail: "no story" });
  // deps validity (compile set ∪ store rows)
  let storeIds = new Set();
  try { storeIds = new Set(JSON.parse(spawnTasks(root, ["list", "--json"])).map((r) => r.id)); } catch { }
  for (const st of allStories) for (const dep of st.deps ?? []) if (!ids.has(dep) && !storeIds.has(dep)) gaps.push({ type: "bad-dep", id: st.id, detail: dep });
  // id collision vs foreign store rows
  try {
    const foreign = JSON.parse(spawnTasks(root, ["list", "--json"])).filter((r) => !(r.source ?? "").startsWith("compile:"));
    const foreignIds = new Set(foreign.map((r) => r.id));
    for (const st of allStories) if (foreignIds.has(st.id)) gaps.push({ type: "id-collision", id: st.id, detail: "existing store row with a different source" });
  } catch { }
  // warnings (non-blocking): known check_cmd hazards
  const warnings = [];
  for (const st of allStories) {
    if (/\bbun\s+-e\b/.test(st.check_cmd ?? "")) {
      warnings.push({ type: "bun-e-false-pass", id: st.id, note: "bun -e can exit 0 after a swallowed sync throw following a sync fs read; prefer node -e or explicit process.exit(1) — see .omp/agents.md flag 8" });
    }
  }
  const out = { generatedAt: new Date().toISOString(), stories: allStories.length, gaps, warnings, ok: gaps.length === 0 };
  writeJSON(`${runDir}/lint.json`, out);
  touchRun(state, "linted", { lintGaps: gaps.length });
  log(`lint: ${allStories.length} stories, ${gaps.length} gaps${gaps.length ? " (fix before compile-in)" : " — clean"}`);
  return out;
}

// ------------------------------------------------------- phase: verify-collect --
export function verifyCollect({ root = process.cwd(), compileId } = {}) {
  const state = openRun({ root, compileId });
  const planData = readJSON(`${state.runDir}/slices.json`);
  const out = { ship: [], block: [], missing: [] };
  for (const s of planData.slices) {
    const v = readJSON(s.verdict, true);
    if (!v) { out.missing.push(s.id); continue; }
    (v.verdict === "SHIP" && (v.findings ?? []).every((f) => !["critical", "high"].includes(f.severity)) ? out.ship : out.block).push(s.id);
  }
  writeJSON(`${state.runDir}/verify-collect.json`, out);
  touchRun(state, "verified", { verifiedShip: out.ship.length, verifiedBlock: out.block.length, verifiedMissing: out.missing.length });
  log(`verify-collect: ship ${out.ship.length}, block ${out.block.length}, missing ${out.missing.length}`);
  return { phase: "verify-collect", compileId: state.compileId, ...out };
}

// ------------------------------------------------------------- phase: repair ----
export async function repairStart({ root = process.cwd(), compileId, slices, poolName = "epics-author-r1" } = {}) {
  // slices: [{ id, findings: [string] }]
  const state = openRun({ root, compileId });
  if (!slices?.length) return { phase: "repair-start", compileId: state.compileId, pushed: 0 };
  const findings = Object.fromEntries(slices.map((s) => [s.id, s.findings ?? []]));
  const { pushed } = await startAuthorPool({ root, state, poolName, only: slices.map((s) => s.id), force: true, findings });
  touchRun(state, `repairing:${poolName}`, { repairPool: poolName, repairPushed: pushed });
  log(`repair pool ${poolName}: pushed ${pushed}`);
  return { phase: "repair-start", compileId: state.compileId, pool: poolName, pushed };
}

// ------------------------------------------------------------ phase: compile ----
export function compileIn({ root = process.cwd(), compileId, allowGaps = false } = {}) {
  const state = openRun({ root, compileId });
  const runDir = state.runDir;
  const req = readJSON(`${root}/porting/compile/requirements.json`);
  const planData = readJSON(`${runDir}/slices.json`);
  const lintRes = lint({ root, compileId: state.compileId });
  if (!lintRes.ok && !allowGaps) {
    log(`compile-in BLOCKED: ${lintRes.gaps.length} lint gaps — repair first (or allowGaps:true for a staged draft)`);
    return { phase: "compile", compileId: state.compileId, blocked: true, gaps: lintRes.gaps.length };
  }
  const design = readJSON(`${runDir}/epics.proposed.json`);
  const source = `compile:${state.compileId}`;
  for (const e of design.epics) spawnTasks(root, ["epic-upsert", "--id", e.id, "--title", e.title, "--goal", e.goal ?? "", "--milestone", e.milestone ?? "", "--source", source]);

  const stories = [];
  for (const s of planData.slices) {
    const j = readJSON(s.output, true);
    for (const st of j?.stories ?? []) stories.push(st);
  }
  let staged = 0;
  for (const st of stories) {
    const args = ["upsert", "--id", st.id, "--title", st.title, "--status", "blocked", "--priority", st.priority ?? "P2",
      "--scope", st.scope ?? "", "--acceptance", st.acceptance ?? "", "--check", st.check_cmd ?? "",
      "--source", source, "--epic-id", st.epic ?? "", "--fr-refs", (st.fr_refs ?? []).join(",")];
    if ((st.deps ?? []).length) args.push("--deps", st.deps.join(","));
    spawnTasks(root, args);
    staged++;
  }

  // backfill candidates: compiled stories vs existing pending rows (token overlap)
  let candidates = { high: [], medium: [], totals: { compiled: stories.length, existing: 0 } };
  try {
    const existing = JSON.parse(spawnTasks(root, ["list", "--status", "pending", "--json"])).filter((r) => !(r.source ?? "").startsWith("compile:"));
    candidates.totals.existing = existing.length;
    const existingTok = existing.map((r) => ({ id: r.id, title: r.title, toks: tokens(r.title) }));
    for (const st of stories) {
      const stTok = new Set(tokens(st.title));
      const scored = existingTok.map((r) => ({ id: r.id, title: r.title, score: r.toks.filter((t) => stTok.has(t)).length }))
        .filter((r) => r.score >= 2).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
      for (const hit of scored) {
        const rec = { story: st.id, storyTitle: st.title, row: hit.id, rowTitle: hit.title, score: hit.score };
        (hit.score >= 4 ? candidates.high : candidates.medium).push(rec);
      }
    }
  } catch (e) { log(`compile: backfill scan failed (${e.message})`); }
  writeJSON(`${runDir}/backfill-candidates.json`, candidates);

  const byKind = { implementation: stories.filter((s) => s.kind === "implementation").length, verification: stories.filter((s) => s.kind === "verification").length };
  const report = {
    compileId: state.compileId,
    generatedAt: new Date().toISOString(),
    epics: design.epics.length,
    slices: planData.slices.length,
    stories: stories.length,
    byKind,
    lint: { ok: lintRes.ok, gaps: lintRes.gaps.length },
    staged,
    activation: `bun porting/tasks.mjs activate ${source}`,
    backfill: { high: candidates.high.length, medium: candidates.medium.length, existingPending: candidates.totals.existing },
  };
  writeJSON(`${runDir}/compile-report.json`, report);
  const md = [
    `# Compile report — ${state.compileId}`,
    ``,
    `Epics: ${report.epics} · slices: ${report.slices} · stories: ${report.stories} (impl ${byKind.implementation} / verify ${byKind.verification})`,
    `Lint: ${lintRes.ok ? "clean" : `${lintRes.gaps.length} gaps (staged as draft)`} · staged rows: ${staged} (status=blocked)`,
    ``,
    `**Activation (after the batch consumer contract is confirmed):** \`${report.activation}\``,
    ``,
    `Backfill candidates: ${candidates.high.length} high / ${candidates.medium.length} medium vs ${candidates.totals.existing} existing pending rows — review ` + "`backfill-candidates.json`" + `.`,
    ``,
    `Artifacts: epics.proposed.json · slices.json · packs/ · slices/ · verdicts/ · lint.json · author-collect.json · verify-collect.json`,
  ].join("\n");
  writeFileSync(`${runDir}/compile-report.md`, md + "\n");
  touchRun(state, "compiled", { staged, stories: stories.length });
  log(`compile: staged ${staged} rows (blocked) · lint ${lintRes.ok ? "clean" : lintRes.gaps.length + " gaps"} · backfill ${candidates.high.length}H/${candidates.medium.length}M`);
  return { phase: "compile", compileId: state.compileId, ...report };
}

// --------------------------------------------------------------- phase: main ----
const PHASES = {
  extract,
  design,
  plan,
  normalize,
  lint,
  "repair-start": repairStart,
  "author-start": authorStart,
  "author-collect": authorCollect,
  "verify-start": verifyStart,
  "verify-collect": verifyCollect,
  compile: compileIn,
};

export async function main({ root = process.cwd(), phase: ph, upto = "plan", compileId, ...opts } = {}) {
  if (ph) return await PHASES[ph]({ root, compileId, ...opts });
  const cid = compileId ?? `compile-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const seq = [["extract", extract], ["design", design], ["plan", plan]];
  const out = [];
  for (const [name, fn] of seq) {
    out.push(await fn({ root, compileId: cid }));
    if (name === upto) break;
  }
  return {
    phase: "prep",
    compileId: cid,
    upto,
    results: out,
    next: "author-start → hub wait ids:['epics-author'] → author-collect → verify-start → hub wait ids:['story-verifier'] → verify-collect → compile",
  };
}
