#!/usr/bin/env bun
// Pure unit suite: the reveal authorization rule (FR-31).
// Run: bun porting/tests/reveal-authorize.test.mjs   (exit 0 = pass)
//
// Imports ONLY from platform/src/auth.ts — no worker, no fetch, no
// mocks, no source grep. Pins parseRevealAllowlist (fail-closed
// parsing, duplicate-id collapse, repos normalization) and
// authorizeReveal (identity allowlist, repo scope, purity).

import {
 parseRevealAllowlist,
 authorizeReveal,
} from "../../platform/src/auth.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------
// parseRevealAllowlist — fail-closed parsing.
// ---------------------------------------------------------------------------

// absent / undefined / garbage / non-array ⇒ [] (deny-all).
check("parse: undefined → []", parseRevealAllowlist(undefined).length === 0, J(parseRevealAllowlist(undefined)));
check("parse: null → []", parseRevealAllowlist(null).length === 0, J(parseRevealAllowlist(null)));
check("parse: number → []", parseRevealAllowlist(42).length === 0, J(parseRevealAllowlist(42)));
check("parse: object (not array) → []", parseRevealAllowlist({ id: "x" }).length === 0, J(parseRevealAllowlist({ id: "x" })));
check("parse: garbage JSON string → []", parseRevealAllowlist("not-json{").length === 0, J(parseRevealAllowlist("not-json{")));
check("parse: JSON non-array string → []", parseRevealAllowlist('{"id":"x"}').length === 0, J(parseRevealAllowlist('{"id":"x"}')));

// JSON string (Worker var canonical form) parses.
const jsonString = JSON.stringify([{ id: "a", repos: ["agent-5"] }]);
check("parse: JSON string → 1 entry", parseRevealAllowlist(jsonString).length === 1, J(parseRevealAllowlist(jsonString)));

// Pre-parsed array (test fake form) parses identically.
const preParsed = [{ id: "a", repos: ["agent-5"] }];
check("parse: pre-parsed array → 1 entry", parseRevealAllowlist(preParsed).length === 1, J(parseRevealAllowlist(preParsed)));

// Malformed entries are dropped, never thrown: non-object, blank id.
const mixed = [{ id: "good" }, "not-an-object", 7, { id: "" }, { id: "   " }, { repos: ["x"] }, null];
const parsedMixed = parseRevealAllowlist(mixed);
check("parse: malformed entries dropped", parsedMixed.length === 1 && parsedMixed[0].id === "good", J(parsedMixed));

// Duplicate ids collapse LAST-WINS (Q2): the later entry wins.
const dupes = [{ id: "a", repos: ["agent-1"] }, { id: "b", repos: ["agent-2"] }, { id: "a", repos: ["agent-9"] }];
const parsedDupes = parseRevealAllowlist(dupes);
check("parse: duplicate ids collapse (2 entries)", parsedDupes.length === 2, J(parsedDupes));
const lastA = parsedDupes.find((e) => e.id === "a");
check("parse: duplicate id is last-wins", lastA?.repos?.[0] === "agent-9", J(lastA));

// repos normalization: non-array ⇒ undefined (any repo); non-string
// entries dropped; remainder de-duplicated.
const norm = parseRevealAllowlist([{ id: "x", repos: "not-an-array" }]);
check("parse: repos non-array → undefined", norm[0]?.repos === undefined, J(norm[0]));
const norm2 = parseRevealAllowlist([{ id: "x", repos: ["agent-5", 7, null, "agent-5", "agent-6"] }]);
check("parse: repos deduped + non-strings dropped",
 norm2[0]?.repos?.length === 2 && norm2[0]?.repos?.[0] === "agent-5" && norm2[0]?.repos?.[1] === "agent-6",
 J(norm2[0]));

// ---------------------------------------------------------------------------
// authorizeReveal — identity allowlist + repo scope.
// ---------------------------------------------------------------------------

const deny = { ok: false };

// No allowlist (absent/undefined/garbage) ⇒ deny-all.
check("authz: absent allowlist → deny", J(authorizeReveal({}, { identity: "a", repo: "agent-5" })) === J(deny));
check("authz: undefined REVEAL_ALLOW → deny", J(authorizeReveal({ REVEAL_ALLOW: undefined }, { identity: "a", repo: "agent-5" })) === J(deny));
check("authz: garbage REVEAL_ALLOW → deny", J(authorizeReveal({ REVEAL_ALLOW: "not-json{" }, { identity: "a", repo: "agent-5" })) === J(deny));

// Empty identity ⇒ deny (even when allowlisted).
check("authz: empty identity → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { identity: "", repo: "agent-5" })) === J(deny));
check("authz: missing identity → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { repo: "agent-5" })) === J(deny));
check("authz: whitespace identity → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { identity: "   ", repo: "agent-5" })) === J(deny));

// Identity not in allowlist ⇒ deny.
check("authz: unknown identity → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { identity: "b", repo: "agent-5" })) === J(deny));

// Identity in allowlist, repos absent ⇒ any demo repo.
const anyRepo = authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { identity: "a", repo: "agent-5" });
check("authz: repos absent → any repo grant", anyRepo.ok === true && anyRepo.identity === "a", J(anyRepo));
check("authz: repos absent → other repo grant", authorizeReveal({ REVEAL_ALLOW: [{ id: "a" }] }, { identity: "a", repo: "demo" }).ok === true);

// repos:[] ⇒ none.
check("authz: empty repos → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a", repos: [] }] }, { identity: "a", repo: "agent-5" })) === J(deny));

// repos:["agent-5"] ⇒ only agent-5.
const scoped = authorizeReveal({ REVEAL_ALLOW: [{ id: "a", repos: ["agent-5"] }] }, { identity: "a", repo: "agent-5" });
check("authz: scoped grant", scoped.ok === true && scoped.identity === "a", J(scoped));
check("authz: scoped mismatch → deny", J(authorizeReveal({ REVEAL_ALLOW: [{ id: "a", repos: ["agent-5"] }] }, { identity: "a", repo: "agent-6" })) === J(deny));

// JSON-string form behaves identically to the pre-parsed form.
check("authz: JSON-string allowlist grants", authorizeReveal({ REVEAL_ALLOW: JSON.stringify([{ id: "a", repos: ["agent-5"] }]) }, { identity: "a", repo: "agent-5" }).ok === true);

// ---------------------------------------------------------------------------
// Purity: authorizeReveal never throws across shape permutations —
// it must return {ok:false}, not throw, so the route's audit-then-deny
// path is always reachable.
// ---------------------------------------------------------------------------
const permutations = [
 undefined, null, 0, 1, "", "not-json{", "[]", "{}", "[]",
 [], [null], [42], ["str"], [{}], [{ id: null }], [{ id: 5 }],
 [{ id: "a", repos: "garbage" }], [{ id: "a", repos: [null] }],
 { id: "a" }, true, false,
];
let threw = null;
let allDenyOrGrant = true;
for (const raw of permutations) {
 for (const identity of [undefined, "", "a", "b"]) {
  try {
   const d = authorizeReveal({ REVEAL_ALLOW: raw }, { identity, repo: "agent-5" });
   if (!d || typeof d.ok !== "boolean") allDenyOrGrant = false;
  } catch (e) {
   threw = `${J(raw)} / ${J(identity)} threw ${String(e)}`;
  }
 }
}
check("purity: authorizeReveal never throws", threw === null, threw ?? "");
check("purity: always returns a decision object", allDenyOrGrant);

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
