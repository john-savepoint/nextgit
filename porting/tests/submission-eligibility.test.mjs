#!/usr/bin/env bun
// submission-eligibility.test.mjs — the pre-submission eligibility gate
// (nextgit-automate-competition-pre-submission-eligibility-checks; judge-layer
// idea #29, docs/judge-layer-ideas.md:78).
//
// Automates the competition's own requirement sentence (SPEC.md:50 §Constraints):
//   "Workers + Artifacts mandatory; multiple agents working concurrently; 5–10 min
//    video + OSI license (MIT/Apache/BSD + LICENSE file) + run instructions;
//    due 2026-10-14; ... single entry."
//
// One command verifies the SUBMISSION PACKAGE against every checkable requirement.
// The repo checks are deterministic filesystem reads — zero network calls, zero
// tree mutation (demo-safety law, .omp/agents.md:11: nothing is pushed, forked or
// deleted). The live-worker confirmation is the opt-in --live flag, because a gate
// that sometimes-hallucinates or sometimes-times-out cannot gate a deadline.
//
// Run: bun porting/tests/submission-eligibility.test.mjs             (offline, exit 0 = pass)
//      bun porting/tests/submission-eligibility.test.mjs --live      (+ live-worker confirmation)
//      bun porting/tests/submission-eligibility.test.mjs --selftest  (self-test the parsers)
//
// Exit contract: 0 = every requirement met; 1 = N requirements unmet (each failed
// check names its requirement id R1..R8); 2 = unknown flag (fail closed).
// Fail-closed posture: any thrown read (missing file, unparseable JSONC) is a
// FAILED check carrying the error in its detail — never a skip, never a crash.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLATFORM_URL = process.env.NEXTGIT_PLATFORM ?? "https://nextgit-platform.john-b7d.workers.dev";

// --- arg parsing (fail-closed: an unknown flag exits 2, never silently ignored)
const KNOWN_FLAGS = new Set(["--live", "--selftest"]);
const unknownFlags = process.argv.slice(2).filter((a) => !KNOWN_FLAGS.has(a));
if (unknownFlags.length) {
  console.error(`unknown flag(s): ${unknownFlags.join(", ")}`);
  console.error("usage: bun porting/tests/submission-eligibility.test.mjs [--live] [--selftest]");
  process.exit(2);
}
const LIVE = process.argv.includes("--live");
const SELFTEST = process.argv.includes("--selftest");

let fails = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${String(detail).slice(0, 200)}`}`);
};

// Same accumulator, for checks whose body can throw (fail-closed, never a skip).
const checkFn = (name, fn) => {
  try {
    const { ok, detail } = fn();
    check(name, ok, detail ?? "");
  } catch (err) {
    check(name, false, `threw: ${err?.message ?? err}`);
  }
};

const readText = (rel) => readFileSync(join(ROOT, rel), "utf8");

// --- Helper: strip JSONC comments (// and /* */), then parse JSON ---
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ===========================================================================
// Parsers (pure — the --selftest mode exercises each one on synthetic input,
// which is the red-leg proof that none of these is a vacuous-green no-op)
// ===========================================================================

// SPDX id of a license text: the family marker lives in the first ~10 lines;
// MIT additionally requires the grant sentence in the body.
const licenseSpdx = (text) => {
  const head = text.split("\n").slice(0, 10).join("\n");
  if (/MIT License/i.test(head) && /Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Apache License/i.test(head) && /Version 2\.0/.test(head)) return "Apache-2.0";
  // BSD-3 before BSD-2: the third clause ("Neither the name ...") is the discriminator.
  if (/BSD 3-Clause/i.test(head) || (/Redistribution and use in source and binary forms/i.test(text) && /Neither the name/i.test(text))) {
    return "BSD-3-Clause";
  }
  if (/BSD 2-Clause/i.test(head) || /Redistribution and use in source and binary forms/i.test(text)) return "BSD-2-Clause";
  return null;
};

// The competition window: 5–10 minutes, inclusive.
const WINDOW_SECONDS = [300, 600];
const inWindow = (seconds) => Number.isFinite(seconds) && seconds >= WINDOW_SECONDS[0] && seconds <= WINDOW_SECONDS[1];

const parseWrangler = (text) => JSON.parse(stripComments(text));

// The Artifacts binding — the competition's mandatory substrate — from a parsed config.
const artifactsBinding = (config) => {
  if (!Array.isArray(config?.artifacts)) return null;
  return config.artifacts.find((a) => a && typeof a.binding === "string" && typeof a.namespace === "string") ?? null;
};

// The AGENTS array literal's declared names. Terminated by a line that is exactly
// `];` (agents.mjs:191) rather than by bracket counting, so `[`/`]` inside the
// entries' template literals cannot truncate the block.
const extractAgentNames = (src) => {
  const start = src.indexOf("const AGENTS = [");
  if (start < 0) return null;
  const lines = src.slice(start).split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "];") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const block = lines.slice(0, end + 1).join("\n");
  return [...block.matchAll(/name:\s*"([^"]*)"/g)].map((m) => m[1]);
};

const AGENT_NAME_RE = /^agent-\d+$/;

// Duration from an mp4 `mvhd` box — the fallback used when ffprobe is absent.
// Reads the box, not the file: `mvhd` is the first child of `moov`, and `moov`
// sits at either end of the file (this demo's is at the tail, byte 6740055 —
// no faststart), so the caller hands in the whole asset buffer.
const mvhdSecondsFromBuffer = (buf) => {
  const i = buf.indexOf("mvhd");
  if (i < 0) return null;
  const version = buf[i + 4]; // 4-byte type, then 1-byte version + 3-byte flags
  let timescale;
  let duration;
  if (version === 1) {
    if (buf.length < i + 36) return null;
    timescale = buf.readUInt32BE(i + 24);
    duration = Number(buf.readBigUInt64BE(i + 28));
  } else {
    if (buf.length < i + 24) return null;
    timescale = buf.readUInt32BE(i + 16);
    duration = buf.readUInt32BE(i + 20);
  }
  if (!timescale) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

const mvhdSeconds = (absPath) => mvhdSecondsFromBuffer(readFileSync(absPath));

// ffprobe first (authoritative); the box parser is the fallback for a box
// without it. Both paths are measurements — if neither yields a duration the
// check fails, because an unmeasurable video cannot prove the 5–10 min requirement.
const measureDuration = (absPath) => {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const seconds = Number.parseFloat(out);
    if (Number.isFinite(seconds) && seconds > 0) return { seconds, via: "ffprobe" };
    return { seconds: null, via: "ffprobe", why: `unparseable output ${JSON.stringify(out.trim().slice(0, 60))}` };
  } catch (err) {
    const ffprobeWhy = err?.code === "ENOENT" ? "ffprobe not on PATH" : String(err?.message ?? err);
    try {
      const boxed = mvhdSeconds(absPath);
      if (boxed != null) return { seconds: boxed, via: "mvhd-box" };
    } catch (readErr) {
      return { seconds: null, via: "none", why: `${ffprobeWhy}; mvhd-box read failed: ${readErr?.message ?? readErr}` };
    }
    return { seconds: null, via: "none", why: `${ffprobeWhy}; mvhd-box yielded no duration` };
  }
};

// ===========================================================================
// --selftest — the red legs, kept as permanent proof the parsers can fail
// ===========================================================================
if (SELFTEST) {
  console.log("submission-eligibility self-test — parsers against synthetic inputs\n");

  // R1 — the license parser discriminates families and rejects non-OSI text.
  checkFn("S1 license parser: real LICENSE → MIT", () => ({ ok: licenseSpdx(readText("LICENSE")) === "MIT", detail: String(licenseSpdx(readText("LICENSE"))) }));
  checkFn("S1 license parser: Apache text → Apache-2.0", () => ({
    ok: licenseSpdx("Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n") === "Apache-2.0",
  }));
  check("S1 license parser: proprietary text → null (not an OSI license)", licenseSpdx("Copyright Acme Inc.\nAll rights reserved. Proprietary and confidential.\n") === null);

  // R3 — the window logic rejects both sides of the boundary.
  check("S2 window: 482.76 s in-window", inWindow(482.76) === true);
  check("S2 window: 299.99 s out-of-window (below 5 min)", inWindow(299.99) === false);
  check("S2 window: 600.00 s in-window (boundary inclusive)", inWindow(600) === true);
  check("S2 window: 600.01 s out-of-window (above 10 min)", inWindow(600.01) === false);

  // R3 — the mvhd fallback parser on a synthetic version-0 box (timescale 1000,
  // duration 300000 → 300 s). The real box is only reachable when ffprobe is absent.
  const syntheticBox = Buffer.alloc(24);
  syntheticBox.write("mvhd", 0, "ascii");
  syntheticBox.writeUInt32BE(1000, 16);
  syntheticBox.writeUInt32BE(300000, 20);
  check("S2 mvhd parser: synthetic v0 box → 300 s", mvhdSecondsFromBuffer(syntheticBox) === 300, String(mvhdSecondsFromBuffer(syntheticBox)));
  check("S2 mvhd parser: buffer without mvhd → null", mvhdSecondsFromBuffer(Buffer.alloc(64)) === null);

  // R4 — stripping the Artifacts binding from an in-memory copy of the real
  // config must fail the parse-level check (no tree mutation).
  checkFn("S3 artifactsBinding: real config → ARTIFACTS/nextgit", () => {
    const b = artifactsBinding(parseWrangler(readText("platform/wrangler.jsonc")));
    return { ok: b?.binding === "ARTIFACTS" && b?.namespace === "nextgit", detail: JSON.stringify(b) };
  });
  checkFn("S3 artifactsBinding: artifacts key stripped → null", () => {
    const config = parseWrangler(readText("platform/wrangler.jsonc"));
    const stripped = JSON.parse(JSON.stringify(config));
    delete stripped.artifacts;
    return { ok: artifactsBinding(stripped) === null, detail: JSON.stringify(artifactsBinding(stripped)) };
  });

  // R5 — the agent extractor fails a shrunken fleet and a typo'd name.
  const twoAgentBlock = 'const AGENTS = [\n  { name: "agent-1" },\n  { name: "agent-2" },\n];\n';
  check("S4 agent extractor: synthetic 2-agent block → 2 names", (extractAgentNames(twoAgentBlock) ?? []).length === 2, JSON.stringify(extractAgentNames(twoAgentBlock)));
  check("S4 R5 floor rejects a 2-agent fleet", !((extractAgentNames(twoAgentBlock) ?? []).length >= 3));
  check("S4 agent extractor: missing AGENTS block → null", extractAgentNames("const OTHER = [];\n") === null);
  check("S4 charset guard rejects a typo'd name", AGENT_NAME_RE.test("agent-one") === false);

  console.log(fails === 0 ? `\nSUBMISSION ELIGIBILITY SELF-TEST: ALL PASS (${checks} checks)` : `\nSUBMISSION ELIGIBILITY SELF-TEST: FAIL — ${fails}/${checks}`);
  process.exit(fails === 0 ? 0 : 1);
}

// ===========================================================================
// 1 — R1 license surface (fail-closed)
// ===========================================================================
console.log(`submission-eligibility gate — ${ROOT}\n`);

checkFn("R1.1 LICENSE exists at repo root and is non-empty", () => {
  const abs = join(ROOT, "LICENSE");
  const size = existsSync(abs) ? statSync(abs).size : 0;
  return { ok: size > 0, detail: `${size} B` };
});

const licenseText = (() => {
  try {
    return readText("LICENSE");
  } catch {
    return null;
  }
})();
const spdx = licenseText === null ? null : licenseSpdx(licenseText);

checkFn("R1.2 LICENSE identifies an OSI-approved SPDX license", () => ({
  ok: spdx !== null,
  detail: spdx === null ? "no MIT / Apache-2.0 / BSD marker in the first 10 lines" : `spdx=${spdx}`,
}));

checkFn("R1.3 platform/package.json license field == LICENSE SPDX id", () => {
  const declared = JSON.parse(readText("platform/package.json")).license ?? null;
  return { ok: declared === spdx, detail: `package.json=${JSON.stringify(declared)} LICENSE=${JSON.stringify(spdx)}` };
});

checkFn("R1.4 no competing license files at root", () => {
  const competing = readdirSync(ROOT).filter((f) => /^COPYING(\.|$)/.test(f) || /^LICENSE\..+$/.test(f));
  return { ok: competing.length === 0, detail: `found: ${competing.join(", ")}` };
});

// ===========================================================================
// 2 — R2/R6 README + run instructions
// ===========================================================================
checkFn("R2.5 README.md exists, >= 1 KB", () => {
  const size = statSync(join(ROOT, "README.md")).size;
  return { ok: size >= 1024, detail: `${size} B` };
});

const readme = (() => {
  try {
    return readText("README.md");
  } catch {
    return "";
  }
})();

checkFn("R2.6 README carries the product + run-instruction sections", () => {
  const anchors = ["## What the demo shows", "## Run it yourself", "## License"];
  const missing = anchors.filter((h) => !readme.includes(h));
  return { ok: missing.length === 0, detail: `missing: ${missing.join(", ")}` };
});

checkFn("R2.7 README has a fenced bash run block + the operator-runbook cross-link", () => {
  const problems = [];
  if (!/```bash/.test(readme)) problems.push("no ```bash fence");
  if (!readme.includes("platform/scripts/README.md")) problems.push("no platform/scripts/README.md cross-link");
  return { ok: problems.length === 0, detail: problems.join("; ") };
});

checkFn("R2.8 README states the live demo URL", () => ({
  ok: readme.includes("https://nextgit-platform.john-b7d.workers.dev"),
  detail: "the judge must be able to reach the demo",
}));

// ===========================================================================
// 3 — R3 video
// ===========================================================================
const VIDEO = "submission/nextgit-demo.mp4";

checkFn("R3.9 submission/nextgit-demo.mp4 exists", () => {
  const abs = join(ROOT, VIDEO);
  const size = existsSync(abs) ? statSync(abs).size : 0;
  return { ok: size > 0, detail: `${size} B` };
});

checkFn("R3.10 video duration inside the 5-10 min window", () => {
  const abs = join(ROOT, VIDEO);
  if (!existsSync(abs)) throw new Error(`${VIDEO} missing — duration unmeasurable`);
  const measured = measureDuration(abs);
  if (measured.seconds == null) {
    return { ok: false, detail: `unmeasurable — ${measured.why}` };
  }
  // Evidence line: the `detail` prints only on failure, so report the measured
  // value unconditionally (the operator's verbatim number).
  console.log(`      measured duration: ${measured.seconds.toFixed(2)} s via ${measured.via}`);
  return { ok: inWindow(measured.seconds), detail: `${measured.seconds.toFixed(2)} s (${measured.via}) outside [${WINDOW_SECONDS[0]}, ${WINDOW_SECONDS[1]}]` };
});

checkFn("R3.11 video size >= 1 MB", () => {
  const size = statSync(join(ROOT, VIDEO)).size;
  return { ok: size >= 1024 * 1024, detail: `${size} B` };
});

// ===========================================================================
// 4 — R4 Workers + Artifacts usage
// ===========================================================================
const WRANGLER = "platform/wrangler.jsonc";

const wranglerConfig = (() => {
  try {
    return parseWrangler(readText(WRANGLER));
  } catch {
    return null;
  }
})();

checkFn("R4.12 wrangler.jsonc declares an Artifacts binding (binding + namespace)", () => {
  if (wranglerConfig === null) throw new Error(`${WRANGLER} missing or unparseable`);
  const binding = artifactsBinding(wranglerConfig);
  return { ok: binding !== null, detail: JSON.stringify(wranglerConfig.artifacts ?? null) };
});

checkFn("R4.13 worker main points at an existing file", () => {
  if (wranglerConfig === null) throw new Error(`${WRANGLER} missing or unparseable`);
  const main = wranglerConfig.main;
  if (typeof main !== "string" || main.length === 0) return { ok: false, detail: `main=${JSON.stringify(main)}` };
  return { ok: existsSync(join(ROOT, "platform", main)), detail: `platform/${main}` };
});

checkFn("R4.14 Artifacts binding is actually read in source (env.ARTIFACTS)", () => {
  const src = readText("platform/src/index.ts");
  return { ok: src.includes("env.ARTIFACTS"), detail: "the binding must be used, not merely declared" };
});

checkFn("R4.15 wrangler.jsonc declares the Workers script entry (main)", () => {
  if (wranglerConfig === null) throw new Error(`${WRANGLER} missing or unparseable`);
  return { ok: typeof wranglerConfig.main === "string" && wranglerConfig.main.length > 0, detail: `main=${JSON.stringify(wranglerConfig.main ?? null)}` };
});

// ===========================================================================
// 5 — R5 multiple concurrent agents (declaration seam — never a live fork)
// ===========================================================================
const agentNames = (() => {
  try {
    return extractAgentNames(readText("platform/scripts/agents.mjs"));
  } catch {
    return null;
  }
})();

checkFn("R5.16 agents.mjs declares >= 3 named agents", () => {
  if (agentNames === null) throw new Error("AGENTS array literal not found in platform/scripts/agents.mjs");
  return { ok: agentNames.length >= 3, detail: `declared: ${agentNames.join(", ") || "none"}` };
});

checkFn("R5.17 every declared agent name matches ^agent-\\d+$", () => {
  if (agentNames === null) throw new Error("AGENTS array literal not found in platform/scripts/agents.mjs");
  const bad = agentNames.filter((n) => !AGENT_NAME_RE.test(n));
  return { ok: agentNames.length > 0 && bad.length === 0, detail: `offenders: ${bad.join(", ") || "none"}` };
});

// ===========================================================================
// 6 — cross-consistency + recorded attestations (the lockstep law)
// ===========================================================================
checkFn("R6.18 README live-URL host matches the wrangler worker name", () => {
  if (wranglerConfig === null) throw new Error(`${WRANGLER} missing or unparseable`);
  const url = readme.match(/https:\/\/([^/\s"')]+)/);
  const hostLabel = url === null ? null : url[1].split(".")[0];
  return { ok: hostLabel !== null && hostLabel === wranglerConfig.name, detail: `README host=${JSON.stringify(hostLabel)} wrangler name=${JSON.stringify(wranglerConfig.name)}` };
});

checkFn("R7/R8.19 submission/NOTES.md records the single-entry + eligibility attestations", () => {
  const notes = readText("submission/NOTES.md");
  const problems = [];
  if (!/##\s*Section B/.test(notes)) problems.push("no ## Section B");
  if (!/Eligibility/i.test(notes)) problems.push("no eligibility attestation");
  if (!/single[- ]entry|one entry per person/i.test(notes)) problems.push("no single-entry attestation");
  return { ok: problems.length === 0, detail: problems.join("; ") };
});

// ===========================================================================
// --live — the pre-filing confirmation against the deployed worker (opt-in)
// ===========================================================================
if (LIVE) {
  console.log(`\nlive confirmation — ${PLATFORM_URL}\n`);

  const getJson = async (path) => {
    const res = await fetch(`${PLATFORM_URL}${path}`);
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body };
  };

  try {
    const health = await getJson("/health");
    check(
      "R4-live GET /health → 200 {ok:true, namespace:nextgit}",
      health.status === 200 && health.body?.ok === true && health.body?.namespace === "nextgit",
      `status=${health.status} ${JSON.stringify(health.body ?? null).slice(0, 120)}`,
    );
  } catch (err) {
    check("R4-live GET /health → 200 {ok:true, namespace:nextgit}", false, `threw: ${err?.message ?? err}`);
  }

  try {
    const proposals = await getJson("/proposals?base=demo");
    const agents = Array.isArray(proposals.body?.proposals)
      ? proposals.body.proposals.map((p) => p?.repo).filter((r) => typeof r === "string" && r.startsWith("agent-"))
      : [];
    check(
      "R5-live GET /proposals lists >= 3 agent-* repos",
      proposals.status === 200 && proposals.body?.ok === true && agents.length >= 3,
      `status=${proposals.status} agents=[${agents.join(", ")}]`,
    );
  } catch (err) {
    check("R5-live GET /proposals lists >= 3 agent-* repos", false, `threw: ${err?.message ?? err}`);
  }
}

console.log(fails === 0 ? `\nSUBMISSION ELIGIBILITY: ALL PASS (${checks} checks)` : `\nSUBMISSION ELIGIBILITY: FAIL — ${fails}/${checks}`);
process.exit(fails === 0 ? 0 : 1);
