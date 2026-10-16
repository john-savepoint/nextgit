#!/usr/bin/env bun
// Contract suite: FR-events-contract — canonical /events endpoint shape.
//
// Replaces the inline `bun -e` one-liner check_cmd with a permanent test file.
// HTTP-only read of the live deployment: GET /events with 3-attempt retry +
// 30s AbortSignal. 5 assertions: envelope (ok+array), cap (<=50), newest-first
// (non-increasing at), entry fields (type+at strings), evidence line.
//
// Run: bun porting/tests/events-contract.test.mjs  (exit 0 = pass)
// ENV:  PLATFORM=https://nextgit-platform.john-b7d.workers.dev (default)

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLATFORM = process.env.PLATFORM || "https://nextgit-platform.john-b7d.workers.dev";
// Live gate (the route-discipline.test.mjs idiom): this suite is an
// HTTP-only read of the DEPLOYED platform — it runs in the post-deploy
// postflight (where PLATFORM/NEXTGIT_PLATFORM is set) and SKIPS (exit 0)
// inside hermetic batteries, where a live read tests deployment state,
// not the tree under test.
if (!process.env.PLATFORM && !process.env.NEXTGIT_PLATFORM) {
  console.log("SKIP  events-contract: live deployment leg — PLATFORM/NEXTGIT_PLATFORM not set (post-deploy postflight runs it live)");
  process.exit(0);
}

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// 3-attempt retry with 30s AbortSignal per attempt.
const fetchWithRetry = async (url, maxAttempts = 3) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      return { data, attempt };
    } catch (e) {
      clearTimeout(timeout);
      if (attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("exhausted");
};

try {
  const url = `${PLATFORM}/events`;
  const { data, attempt } = await fetchWithRetry(url);

  // 1. Envelope: ok + events array
  check("1 envelope: ok=true", data.ok === true, `ok=${data.ok}`);
  check("2 envelope: events is an array", Array.isArray(data.events), `type=${typeof data.events}`);

  // 3. Cap: <= 50 events (MAX_EVENTS=50)
  check("3 cap: events.length <= 50", data.events.length <= 50, `n=${data.events.length}`);

  // 4. Newest-first: non-increasing at timestamps
  if (data.events.length >= 2) {
    const ats = data.events.map((e) => e.at).filter((a) => typeof a === "string");
    const newestFirst = ats.every((a, i) => i === 0 || a <= ats[i - 1]);
    check("4 newest-first: at timestamps non-increasing", newestFirst, `ats=${JSON.stringify(ats.slice(0, 5))}`);
  } else {
    check("4 newest-first: at timestamps non-increasing", true, `n=${data.events.length} (trivial)`);
  }

  // 5. Entry fields: each event has type+at as strings
  const allFieldsOk = data.events.every((e) => typeof e.type === "string" && typeof e.at === "string");
  check("5 entry fields: type+at are strings on every event", allFieldsOk, `sample=${JSON.stringify(data.events[0])}`);

  // 6. Evidence line
  console.log(`evidence: ${url} responded (attempt ${attempt}) with ${data.events.length} events`);
} catch (e) {
  check("events-contract harness run", false, String((e && e.stack) || e));
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
