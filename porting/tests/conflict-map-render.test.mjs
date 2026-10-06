#!/usr/bin/env bun
// Contract suite: FR-4 — the collision map renders every conflict with its evidence.
// Run: bun porting/tests/conflict-map-render.test.mjs   (exit 0 = pass)
//
// Real construction: the shipped platform/ui (index.html + app.js) is loaded in a
// real headless Chrome over a loopback origin — the only thing scripted is the
// worker's HTTP surface (the /proposals payload); no module mocks, no source grep.
// Legs:
//   1. full-enum fixture — one conflict per kind in the wire enum (CONTRACT.md),
//      a multi-pair file, pairs with and without regions: a per-file card for
//      EVERY conflict carrying the file path, the kind badge, the severity class
//      from the kind mapping, the repo tags, and one pair row per pair (a ↔ b,
//      pair kind, region text exactly when the pair carries one); the map is
//      read-only, #conflicts-meta reads exactly "N detected", and the map is
//      visible at rest with #inspector-modal still hidden.
//   2. empty-conflicts fixture — meta reads exactly "0 detected", the
//      explanatory empty state renders (title + copy) inside the panel, and no
//      conflict card exists: never a blank panel.
//   3. live capture — when PROPS_FIXTURE points at a /proposals capture (the
//      order's check_cmd writes one), the same battery runs over it verbatim;
//      unset -> one SKIP line. The live set must carry >= 1 conflict (this
//      order's acceptance predicate).
// A box without a Chrome binary skips the suite (precedent: ui-first-load-panels;
// the order's acceptance gate hard-requires Chrome).

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = join(ROOT, "platform/ui");
const ARROW = "\u2194";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const CHROME =
  ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map((bin) => String(spawnSync("which", [bin], { encoding: "utf8" }).stdout ?? "").trim())
    .find(Boolean) || process.env.CHROME_BIN || null;

if (!CHROME) {
  console.log("SKIP  FR-4 conflict map — no Chrome binary on PATH (contract unverified in this environment)");
  process.exit(0);
}

const userDataDir = mkdtempSync(join(tmpdir(), "nextgit-conflictmap-"));

// Async spawn: the loopback server runs on THIS process's event loop, so a
// blocking exec would deadlock the very fetch the page is waiting on.
const dumpDom = (url) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=8000", `--user-data-dir=${userDataDir}`, "--dump-dom", url],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("chrome timed out after 60s"));
    }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`chrome exited with ${code}`));
    });
  });

// Mirror of app.js escapeHtml — the expected strings below must equal exactly
// what the render produces for payload text.
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// The kind -> severity mapping the acceptance pins (app.js getConflictSeverity).
const severityOf = (kind) =>
  ["text-conflict", "modify/delete", "add/add"].includes(kind) ? "severity-red" : kind === "undetermined" ? "severity-amber" : "severity-neutral";
// The kind -> badge-class mapping (app.js getConflictSeverity.badgeClass) — pinned
// so the badge span's class is asserted, not merely its text somewhere in the card.
const badgeOf = (kind) =>
  ["text-conflict", "modify/delete", "add/add"].includes(kind) ? "badge-red" : kind === "undetermined" ? "badge-amber" : "badge-neutral";

const tagFor = (dom, id) => (dom.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`)) || [null])[0];
const isHidden = (dom, id) => {
  const tag = tagFor(dom, id);
  return tag !== null && /\shidden(=|\s|>)/.test(tag);
};
const domValue = (dom, id) => {
  const m = dom.match(new RegExp(`id=${JSON.stringify(id)}[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
};
// The conflicts section: from #conflicts-list's opening tag to the section close.
const conflictsRegion = (dom) => {
  const i = dom.indexOf('id="conflicts-list"');
  return i < 0 ? null : dom.slice(i, dom.indexOf("</section>", i));
};

// ---------------------------------------------------------------------------
// Fixtures — all seven conflict kinds of the wire enum (CONTRACT.md), one
// multi-pair file, pairs with and without regions. Distinct files and repos so
// a card/mapping/pair mix-up fails loudly.
// ---------------------------------------------------------------------------

const ENUM_FIXTURE = {
  ok: true,
  base: { repo: "fixture", ref: "main" },
  ref: "main",
  summary: { proposals: 3, changedFiles: 7, sharedFiles: 7, conflictingPairs: 5, cleanPairs: 4 },
  proposals: [
    { repo: "agent-1", intent: "fixture intent 1", stats: { files: 3, additions: 6, deletions: 2 }, files: [] },
    { repo: "agent-2", intent: "fixture intent 2", stats: { files: 3, additions: 4, deletions: 4 }, files: [] },
    { repo: "agent-3", intent: "fixture intent 3", stats: { files: 2, additions: 2, deletions: 2 }, files: [] },
  ],
  conflicts: [
    {
      file: "src/auth.ts",
      kind: "text-conflict",
      repos: ["agent-1", "agent-2", "agent-3"],
      pairs: [
        { a: "agent-1", b: "agent-2", kind: "text-conflict", conflict: true, region: { baseLines: 2, aLines: 8, bLines: 2 } },
        { a: "agent-1", b: "agent-3", kind: "modify/delete", conflict: true },
        { a: "agent-2", b: "agent-3", kind: "text-conflict", conflict: true, region: { baseLines: 4, aLines: 1, bLines: 3 } },
      ],
    },
    {
      file: "src/utils.ts",
      kind: "undetermined",
      repos: ["agent-1", "agent-3"],
      pairs: [{ a: "agent-1", b: "agent-3", kind: "undetermined", conflict: null }],
    },
    {
      file: "src/clean.ts",
      kind: "mergeable",
      repos: ["agent-1", "agent-2"],
      pairs: [{ a: "agent-1", b: "agent-2", kind: "mergeable", conflict: false }],
    },
    {
      file: "src/identical.ts",
      kind: "identical-add",
      repos: ["agent-2", "agent-3"],
      pairs: [{ a: "agent-2", b: "agent-3", kind: "identical-add", conflict: false }],
    },
    {
      file: "src/removed.ts",
      kind: "both-removed",
      repos: ["agent-1", "agent-2"],
      pairs: [{ a: "agent-1", b: "agent-2", kind: "both-removed", conflict: false }],
    },
    {
      file: "src/added.ts",
      kind: "add/add",
      repos: ["agent-2", "agent-3"],
      pairs: [{ a: "agent-2", b: "agent-3", kind: "add/add", conflict: true }],
    },
    {
      file: "src/legacy.ts",
      kind: "modify/delete",
      repos: ["agent-1", "agent-3"],
      pairs: [{ a: "agent-1", b: "agent-3", kind: "modify/delete", conflict: true }],
    },
  ],
};

const EMPTY_FIXTURE = {
  ...ENUM_FIXTURE,
  summary: { proposals: 3, changedFiles: 0, sharedFiles: 0, conflictingPairs: 0, cleanPairs: 0 },
  conflicts: [],
};

// ---------------------------------------------------------------------------
// The FR-4 render contract, checked against one dumped DOM + its payload.
// ---------------------------------------------------------------------------

function mapContract(label, payload, dom) {
  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : [];
  // Cards are split INSIDE the conflicts region only — a card slice can never
  // leak the proposals grid's controls into the per-card read-only assertion.
  const panel = conflictsRegion(dom) || "";
  const cards = panel.split(/class="conflict-card /).slice(1);
  check(`${label} one card per conflict (${conflicts.length})`, cards.length === conflicts.length, `cards=${cards.length} conflicts=${conflicts.length}`);

  for (const c of conflicts) {
    const card = cards.find((x) => x.includes(`conflict-file">${esc(c.file)}<`));
    if (!card) {
      check(`${label} card for ${c.file}`, false, "missing");
      continue;
    }
    const classRest = card.slice(0, card.indexOf('"'));
    check(
      `${label} ${c.file} severity class "${severityOf(c.kind)}"`,
      classRest === severityOf(c.kind),
      `class="${classRest}" kind=${c.kind}`,
    );
    check(
      `${label} ${c.file} kind badge "${c.kind}" (class="badge ${badgeOf(c.kind)}")`,
      card.includes(`class="badge ${badgeOf(c.kind)}">${esc(c.kind)}</span>`),
      "badge span must carry the pinned badge-class",
    );
    const repoTagCount = (card.match(/class="repo-tag"/g) || []).length;
    check(
      `${label} ${c.file} repo tags exactly [${c.repos.join(", ")}]`,
      c.repos.every((r) => card.includes(`repo-tag">${esc(r)}<`)) && repoTagCount === c.repos.length,
      `tags=${repoTagCount}`,
    );
    check(`${label} ${c.file} card is read-only (no buttons/actions)`, !/(<button|data-action=)/.test(card), "found a control");

    const rows = card.split('class="conflict-pair-row"').slice(1);
    check(`${label} ${c.file} pair-row count == pairs.length`, rows.length === c.pairs.length, `rows=${rows.length} pairs=${c.pairs.length}`);
    for (const p of c.pairs) {
      const label2 = `${label} ${c.file} ${p.a} ${ARROW} ${p.b}`;
      const row = rows.find((r) => r.includes(`${esc(p.a)} ${ARROW} ${esc(p.b)}<`));
      if (!row) {
        check(`${label2} pair row`, false, "missing");
        continue;
      }
      check(`${label2} pair kind "${p.kind || c.kind}"`, row.includes(`pair-kind">${esc(p.kind || c.kind)}<`), "pair-kind text");
      const expected = p.region
        ? `(base: ${p.region.baseLines ?? 0}L, ${esc(p.a)}: ${p.region.aLines ?? 0}L, ${esc(p.b)}: ${p.region.bLines ?? 0}L)`
        : null;
      const got = (row.match(/class="pair-region">([^<]*)</) || [null, null])[1];
      check(
        expected ? `${label2} region text "${expected}"` : `${label2} has no region span`,
        expected ? got === expected : got === null,
        `got=${JSON.stringify(got)}`,
      );
    }
  }

  check(
    `${label} #conflicts-meta reads exactly "${conflicts.length} detected"`,
    domValue(dom, "conflicts-meta") === `${conflicts.length} detected`,
    JSON.stringify(domValue(dom, "conflicts-meta")),
  );
  check(
    `${label} map visible at rest (section present, neither hidden)`,
    tagFor(dom, "conflicts-section") !== null && !isHidden(dom, "conflicts-section"),
    String(tagFor(dom, "conflicts-section")),
  );
  check(`${label} inspector modal hidden at rest`, isHidden(dom, "inspector-modal"), String(tagFor(dom, "inspector-modal")));
  check(`${label} map is read-only (no buttons in the panel)`, panel !== null && panel !== "" && !/<button/.test(panel), "found a button");
}

function emptyContract(label, dom) {
  check(
    `${label} #conflicts-meta reads exactly "0 detected"`,
    domValue(dom, "conflicts-meta") === "0 detected",
    JSON.stringify(domValue(dom, "conflicts-meta")),
  );
  check(
    `${label} empty-state title exactly "No convergence conflicts"`,
    dom.includes('class="empty-state-title">No convergence conflicts<'),
    "title",
  );
  check(
    `${label} empty-state explanation copy rendered`,
    dom.includes("All concurrent proposals merge cleanly or target orthogonal files."),
    "desc",
  );
  check(`${label} no conflict card in the empty set`, !/class="conflict-card /.test(dom), "card found");
  const region = conflictsRegion(dom);
  check(
    `${label} panel is not blank (empty state inside #conflicts-list)`,
    region !== null && region.includes("empty-state-title"),
    "panel content",
  );
  check(
    `${label} map visible at rest + modal hidden`,
    tagFor(dom, "conflicts-section") !== null && !isHidden(dom, "conflicts-section") && isHidden(dom, "inspector-modal"),
    "at-rest state",
  );
}

// ---------------------------------------------------------------------------
// Loopback worker surface: leg selects the /proposals payload.
// ---------------------------------------------------------------------------

let currentPayload = ENUM_FIXTURE;
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://127.0.0.1");
  if (pathname === "/proposals") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(currentPayload));
    return;
  }
  if (pathname === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, events: [] }));
    return;
  }
  if (pathname === "/judge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, judgments: [], skipped: [] }));
    return;
  }
  if (pathname === "/merge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, merge: { status: "clean", files: [] } }));
    return;
  }
  const file = join(UI, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(UI) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
  res.end(readFileSync(file));
});

try {
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const url = `http://127.0.0.1:${port}/`;

  // --- 1. full-enum fixture: every kind, every pair, every evidence field ----
  try {
    currentPayload = ENUM_FIXTURE;
    mapContract("1", ENUM_FIXTURE, await dumpDom(url));
  } catch (e) {
    check("1 full-enum case threw", false, String(e?.stack ?? e));
  }

  // --- 2. empty conflicts: the explanatory empty state, never a blank panel --
  try {
    currentPayload = EMPTY_FIXTURE;
    emptyContract("2", await dumpDom(url));
  } catch (e) {
    check("2 empty-set case threw", false, String(e?.stack ?? e));
  }

  // --- 3. live capture: the order's check_cmd writes /proposals to a file ----
  const fixturePath = process.env.PROPS_FIXTURE;
  if (!fixturePath) {
    console.log("SKIP  3 live capture — PROPS_FIXTURE unset (the order's check_cmd owns the live fetch)");
  } else {
    try {
      const live = JSON.parse(readFileSync(fixturePath, "utf8"));
      const conflicts = Array.isArray(live?.conflicts) ? live.conflicts : [];
      check(`3 live capture carries >= 1 conflict to map`, conflicts.length >= 1, `conflicts=${conflicts.length}`);
      currentPayload = live;
      mapContract("3", live, await dumpDom(url));
    } catch (e) {
      check("3 live-capture case threw", false, String(e?.stack ?? e));
    }
  }
} finally {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
