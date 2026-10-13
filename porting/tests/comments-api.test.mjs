#!/usr/bin/env bun
// Contract suite: inline review comments data plane (nextgit-e15-impl-comments-api).
// Run: bun porting/tests/comments-api.test.mjs   (exit 0 = pass)
//
// Real construction: imports the real `worker` from platform/src/index.ts and
// drives worker.fetch() over the REAL dispatcher (authorize() + csrfGate + the
// ROUTES table). The ONLY seam is an in-memory Map-backed CACHE KV fake (the
// judge.test.mjs fixture posture) — no mock.module, no source grep. A fresh env
// per group; the rate limiter is module-global, so every request carries a
// unique `CF-Connecting-IP` except the deliberate single-caller rate bursts.

import worker from "../../platform/src/index.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const J = (x) => JSON.stringify(x);

// In-memory KV fake — the only seam. `store` is exposed so a check can prove
// the store was NOT written (the secret-class refusal).
function makeFakeKV() {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : undefined),
    put: async (k, v) => { store.set(k, v); },
  };
}

// The comments data plane reads no Artifacts repo — its get/list throw so a
// stray binding read surfaces as a failure, never a silent pass. `deny: true`
// omits AUTH_MODE (absent ⇒ default-deny, the auth-seam posture).
const envFor = ({ cache = makeFakeKV(), deny = false } = {}) => ({
  ARTIFACTS: {
    get: async () => { throw new Error("comments data plane reads no Artifacts repo"); },
    list: async () => { throw new Error("comments data plane lists no repos"); },
  },
  LIVE: makeFakeKV(),
  CACHE: cache,
  ASSETS: { fetch: async () => new Response("") },
  AI: { run: async () => null },
  AUTH_MODE: deny ? undefined : "demo",
});

let ipSeq = 0;
const nextIp = () => `10.7.0.${++ipSeq}`;

const drive = async (env, method, path, { body, ip } = {}) => {
  const headers = {};
  if (ip) headers["CF-Connecting-IP"] = ip;
  if (body !== undefined) headers["content-type"] = "application/json";
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request(`https://nextgit.invalid${path}`, init), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// postComment: POST /comments, fresh caller IP unless one is given.
const postComment = (env, body, ip = nextIp()) => drive(env, "POST", "/comments", { body, ip });
// readThread: GET /comments for (repo, path, ref?) — `ref` omitted when undefined.
const readThread = (env, { repo, path, ref }, ip = nextIp()) => {
  const q = new URLSearchParams();
  q.set("repo", repo);
  if (ref !== undefined) q.set("ref", ref);
  if (path !== undefined) q.set("path", path);
  return drive(env, "GET", `/comments?${q.toString()}`, { ip });
};

const comment = (over = {}) => ({ repo: "demo", path: "src/a.ts", line: 3, body: "nit: rename", author: "reviewer", ...over });

// ---------------------------------------------------------------------------
// 1. Round-trip: POST appends, GET returns the same comment on the wire shape.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const created = await postComment(env, comment());
  check("1 POST /comments → 201", created.status === 201, `got ${created.status} ${J(created.body)}`);
  const c = created.body?.comment;
  check("1 201 body is {ok:true, comment}", created.body?.ok === true && c !== null && typeof c === "object", J(created.body));
  check("1 comment carries id(12-hex)/path/line/body/author/at",
    typeof c?.id === "string" && /^[0-9a-f]{12}$/.test(c.id) &&
    c.path === "src/a.ts" && c.line === 3 && c.body === "nit: rename" && c.author === "reviewer" &&
    typeof c.at === "string" && !Number.isNaN(Date.parse(c.at)),
    J(c));
  check("1 wire comment omits the stored ref", c !== null && !("ref" in c), J(c));
  const list = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" });
  check("1 GET returns the posted comment", list.status === 200 && list.body?.ok === true && list.body.comments.length === 1 && list.body.comments[0].id === c.id, J(list.body));
  check("1 GET echoes repo + ref", list.body?.repo === "demo" && list.body?.ref === "main", J(list.body));
}

// ---------------------------------------------------------------------------
// 2. Unique ids / no idempotence: two identical POSTs are two comments.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const a = await postComment(env, comment({ body: "same" }));
  const b = await postComment(env, comment({ body: "same" }));
  check("2 two identical POSTs both 201", a.status === 201 && b.status === 201, `${a.status}/${b.status}`);
  check("2 fresh id per POST (no idempotence)", typeof a.body?.comment?.id === "string" && a.body.comment.id !== b.body?.comment?.id, `${a.body?.comment?.id} vs ${b.body?.comment?.id}`);
  const list = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" });
  check("2 both appends persist (no dedupe)", list.body?.comments?.length === 2, J(list.body));
}

// ---------------------------------------------------------------------------
// 3. Stable order: append order preserved, identical across reads.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  for (const b of ["first", "second", "third"]) await postComment(env, comment({ body: b }));
  const one = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" });
  const two = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" });
  check("3 append order oldest-first", J(one.body?.comments?.map((c) => c.body)) === J(["first", "second", "third"]), J(one.body?.comments?.map((c) => c.body)));
  check("3 read order is stable across calls", J(one.body?.comments) === J(two.body?.comments), `${J(one.body?.comments)} vs ${J(two.body?.comments)}`);
}

// ---------------------------------------------------------------------------
// 4. Ref scoping + AD-8 default equivalence (omitted ref == ref=main).
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const feature = await postComment(env, comment({ ref: "feature", body: "on feature" }));
  const implicit = await postComment(env, comment({ body: "on default" }));
  const byFeature = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "feature" });
  const byMain = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" });
  const implicitRef = await readThread(env, { repo: "demo", path: "src/a.ts" });
  check("4 ref scoping: feature sees only the feature comment", byFeature.body?.comments?.length === 1 && byFeature.body.comments[0].id === feature.body?.comment?.id, J(byFeature.body));
  check("4 ref scoping: main sees only the default comment", byMain.body?.comments?.length === 1 && byMain.body.comments[0].id === implicit.body?.comment?.id, J(byMain.body));
  check("4 AD-8: omitted ref == ref=main", implicitRef.body?.comments?.length === 1 && J(implicitRef.body?.comments) === J(byMain.body?.comments), `${J(implicitRef.body)} vs ${J(byMain.body)}`);
}

// ---------------------------------------------------------------------------
// 5. Restart survival: a fresh env reading the shared durable CACHE sees it.
// ---------------------------------------------------------------------------
{
  const cache = makeFakeKV();
  const env1 = envFor({ cache });
  const created = await postComment(env1, comment({ body: "survives" }));
  const env2 = envFor({ cache }); // a fresh worker isolate / restart
  const list = await readThread(env2, { repo: "demo", path: "src/a.ts", ref: "main" });
  check("5 comment survives a fresh env (shared CACHE)", list.status === 200 && list.body?.comments?.length === 1 && list.body.comments[0].id === created.body?.comment?.id, J(list.body));
}

// ---------------------------------------------------------------------------
// 6. Body cap: 2000 chars ok, 2001 rejected.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const at2000 = await postComment(env, comment({ body: "x".repeat(2000) }));
  const at2001 = await postComment(env, comment({ body: "x".repeat(2001) }));
  check("6 body of 2000 chars → 201", at2000.status === 201, `got ${at2000.status} ${J(at2000.body)}`);
  check("6 body of 2001 chars → 400", at2001.status === 400 && at2001.body?.ok === false && typeof at2001.body?.error === "string", `got ${at2001.status} ${J(at2001.body)}`);
}

// ---------------------------------------------------------------------------
// 7. Line guard: a non-negative integer only.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const zero = await postComment(env, comment({ line: 0 }));
  const neg = await postComment(env, comment({ line: -1 }));
  const frac = await postComment(env, comment({ line: 1.5 }));
  const str = await postComment(env, comment({ line: "12" }));
  check("7 line 0 → 201", zero.status === 201, `got ${zero.status}`);
  check("7 line -1 → 400", neg.status === 400, `got ${neg.status}`);
  check("7 line 1.5 → 400", frac.status === 400, `got ${frac.status}`);
  check("7 line \"12\" → 400", str.status === 400, `got ${str.status}`);
}

// ---------------------------------------------------------------------------
// 8. Path gate: empty / traversal / leading / trailing slash → 400.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  for (const bad of ["", "..", "a/../b", "/leading", "trailing/", "../up"]) {
    const r = await postComment(env, comment({ path: bad }));
    check(`8 path ${JSON.stringify(bad)} → 400`, r.status === 400, `got ${r.status} ${J(r.body)}`);
  }
}

// ---------------------------------------------------------------------------
// 9. Charset legs: repo/ref charset + body/author non-empty.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const badRepo = await postComment(env, comment({ repo: "agent 1" }));
  const badRef = await postComment(env, comment({ ref: "bad ref" }));
  const emptyBody = await postComment(env, comment({ body: "" }));
  const emptyAuthor = await postComment(env, comment({ author: "" }));
  const wsAuthor = await postComment(env, comment({ author: "   " }));
  check("9 repo charset → 400", badRepo.status === 400, `got ${badRepo.status}`);
  check("9 ref charset → 400", badRef.status === 400, `got ${badRef.status}`);
  check("9 empty body → 400", emptyBody.status === 400, `got ${emptyBody.status}`);
  check("9 empty author → 400", emptyAuthor.status === 400, `got ${emptyAuthor.status}`);
  check("9 whitespace-only author → 400", wsAuthor.status === 400, `got ${wsAuthor.status}`);
}

// ---------------------------------------------------------------------------
// 10. Secret-class refusal: 403 BEFORE any store access (store unchanged).
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const secret = await postComment(env, comment({ path: "config/.env" }));
  check("10 secret-class path → 403 secret-class", secret.status === 403 && secret.body?.error === "secret-class", `got ${secret.status} ${J(secret.body)}`);
  check("10 secret refusal wrote NOTHING to the store", !env.CACHE.store.has("comments:demo"), J([...env.CACHE.store.keys()]));
  // Precedence: the allowlist re-check precedes the secret-class check.
  const nonDemoSecret = await postComment(env, comment({ repo: "notdemo-xyz", path: "config/.env" }));
  check("10 allowlist precedes secret-class (non-demo repo → repo-not-allowed)", nonDemoSecret.status === 403 && nonDemoSecret.body?.error === "repo-not-allowed", `got ${nonDemoSecret.status} ${J(nonDemoSecret.body)}`);
}

// ---------------------------------------------------------------------------
// 11. Unknown field → 400 (closed schema).
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const withId = await postComment(env, { ...comment(), id: "0123456789ab" });
  const withAt = await postComment(env, { ...comment(), at: "2026-01-01T00:00:00Z" });
  check("11 unknown field `id` → 400", withId.status === 400 && withId.body?.error === "bad-request", `got ${withId.status} ${J(withId.body)}`);
  check("11 unknown field `at` → 400", withAt.status === 400 && withAt.body?.error === "bad-request", `got ${withAt.status} ${J(withAt.body)}`);
}

// ---------------------------------------------------------------------------
// 12. Required fields + malformed bodies → 400.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  for (const field of ["repo", "path", "line", "body", "author"]) {
    const payload = comment();
    delete payload[field];
    const r = await postComment(env, payload);
    check(`12 missing ${field} → 400`, r.status === 400 && r.body?.ok === false && typeof r.body?.error === "string", `got ${r.status} ${J(r.body)}`);
  }
  const malformed = await postComment(env, "not json");
  check("12 malformed JSON → 400", malformed.status === 400 && malformed.body?.error === "bad-request", `got ${malformed.status} ${J(malformed.body)}`);
  const array = await postComment(env, [1, 2]);
  check("12 array body → 400", array.status === 400 && array.body?.error === "bad-request", `got ${array.status} ${J(array.body)}`);
}

// ---------------------------------------------------------------------------
// 13. Auth posture: deny mode 401; demo allowlist 403 on both verbs.
// ---------------------------------------------------------------------------
{
  const deny = envFor({ deny: true });
  const denyPost = await postComment(deny, comment());
  const denyGet = await readThread(deny, { repo: "demo", path: "src/a.ts" });
  check("13 deny mode: POST → 401 unauthorized", denyPost.status === 401 && denyPost.body?.error === "unauthorized", `got ${denyPost.status} ${J(denyPost.body)}`);
  check("13 deny mode: GET → 401 unauthorized", denyGet.status === 401 && denyGet.body?.error === "unauthorized", `got ${denyGet.status} ${J(denyGet.body)}`);

  const demo = envFor();
  const nonDemoPost = await postComment(demo, comment({ repo: "notdemo-xyz" }));
  const nonDemoGet = await readThread(demo, { repo: "notdemo-xyz", path: "src/a.ts" });
  check("13 non-allowlisted POST repo → 403 repo-not-allowed", nonDemoPost.status === 403 && nonDemoPost.body?.error === "repo-not-allowed", `got ${nonDemoPost.status} ${J(nonDemoPost.body)}`);
  check("13 non-allowlisted GET repo → 403 repo-not-allowed", nonDemoGet.status === 403 && nonDemoGet.body?.error === "repo-not-allowed", `got ${nonDemoGet.status} ${J(nonDemoGet.body)}`);
}

// ---------------------------------------------------------------------------
// 14. Rate rows: POST 20/60s, GET 60/60s, per-caller, independent keys.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const writeIp = "10.44.0.1";
  let first20 = 0;
  for (let i = 0; i < 20; i++) {
    const r = await postComment(env, comment({ body: `burst-${i}` }), writeIp);
    if (r.status === 201) first20++;
  }
  const over = await postComment(env, comment({ body: "burst-over" }), writeIp);
  check("14 POST: first 20 → 201", first20 === 20, `got ${first20}`);
  check("14 POST: 21st from the same caller → 429", over.status === 429 && over.body?.error === "rate-limited", `got ${over.status} ${J(over.body)}`);
  const otherCaller = await postComment(env, comment({ body: "other-caller" }), "10.44.0.2");
  check("14 POST: a different caller is unaffected", otherCaller.status === 201, `got ${otherCaller.status} ${J(otherCaller.body)}`);

  const readIp = "10.45.0.1";
  let ok60 = 0;
  for (let i = 0; i < 60; i++) {
    const r = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" }, readIp);
    if (r.status === 200) ok60++;
  }
  const getOver = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" }, readIp);
  check("14 GET: first 60 → 200", ok60 === 60, `got ${ok60}`);
  check("14 GET: 61st from the same caller → 429", getOver.status === 429 && getOver.body?.error === "rate-limited", `got ${getOver.status} ${J(getOver.body)}`);

  // Distinct keys: the write burst does not exhaust the read budget.
  const readAfterWriteBurst = await readThread(env, { repo: "demo", path: "src/a.ts", ref: "main" }, writeIp);
  check("14 write burst leaves the read budget independent", readAfterWriteBurst.status === 200, `got ${readAfterWriteBurst.status} ${J(readAfterWriteBurst.body)}`);
}

// ---------------------------------------------------------------------------
// 15. GET validation: repo/ref/path guards, geometry cap.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const noRepo = await drive(env, "GET", "/comments?path=src/a.ts", { ip: nextIp() });
  const noPath = await readThread(env, { repo: "demo" });
  const emptyRef = await drive(env, "GET", "/comments?repo=demo&ref=&path=src/a.ts", { ip: nextIp() });
  const traversalPath = await drive(env, "GET", "/comments?repo=demo&ref=main&path=a/../b", { ip: nextIp() });
  const deepPath = await postComment(env, comment({ path: Array.from({ length: 40 }, () => "d").join("/") }));
  check("15 GET without repo → 400", noRepo.status === 400, `got ${noRepo.status} ${J(noRepo.body)}`);
  check("15 GET without path → 400", noPath.status === 400 && noPath.body?.ok === false && typeof noPath.body?.error === "string", `got ${noPath.status} ${J(noPath.body)}`);
  check("15 GET with empty ref → 400", emptyRef.status === 400, `got ${emptyRef.status}`);
  check("15 GET with traversal path → 400", traversalPath.status === 400, `got ${traversalPath.status}`);
  check("15 POST over-depth path → 400 (path too deep)", deepPath.status === 400, `got ${deepPath.status} ${J(deepPath.body)}`);
}

// ---------------------------------------------------------------------------
// 16. Concurrent POSTs to one thread: N simultaneous posts → N persisted.
// appendComment is a read-modify-write of the whole `comments:<repo>` JSONL;
// without per-repo serialization the awaits inside it interleave and N-1
// comments are silently lost (the gate's 8→7 result). This defends the
// observable contract: N posts → N persisted comments with unique ids.
// ---------------------------------------------------------------------------
{
  const env = envFor();
  const N = 8;
  const results = await Promise.all(Array.from({ length: N }, () => postComment(env, comment())));
  check("16 concurrent posts all → 201", results.every((r) => r.status === 201),
    results.map((r) => r.status).join(","));
  const thread = await readThread(env, { repo: "demo", path: "src/a.ts" });
  check("16 concurrent posts all persisted", thread.body?.comments?.length === N,
    `persisted ${thread.body?.comments?.length ?? 0}/${N}`);
  const ids = new Set((thread.body?.comments ?? []).map((c) => c.id));
  check("16 concurrent post ids unique", ids.size === N, `${ids.size}/${N} unique`);
}

console.log(fail === 0 ? `ALL PASS (${pass} checks)` : `${fail} FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
