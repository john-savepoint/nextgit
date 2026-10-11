// One-shot: tail deployed worker, fire a land that mints/revokes a token, dump raw tail bytes.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "bb7d292ca65ba01cbdfbdabcace0c3d0";
const NAMESPACE = "nextgit";
const PLATFORM = "https://nextgit-platform.john-b7d.workers.dev";
const WRANGLER = join(process.cwd(), "platform", "node_modules", ".bin", "wrangler");
const gitBase = `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/${NAMESPACE}`;
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/${NAMESPACE}`;
const TS = Date.now();
const BASE = `demo-ta-base-${TS}`;
const PROP = "agent-ta-1";

let cachedToken = null;
function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (cachedToken) return cachedToken;
  const candidates = [
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return (cachedToken = m[1]);
    }
  }
  throw new Error("No API token: set CLOUDFLARE_API_TOKEN or run `wrangler login`.");
}
async function api(method, path, body) {
  let last;
  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiToken()}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && !refreshed && !process.env.CLOUDFLARE_API_TOKEN) {
        refreshed = true;
        cachedToken = null;
        console.log(`  auth 401 on ${method} ${path} -> wrangler whoami refresh, retrying`);
        try { execFileSync(WRANGLER, ["whoami"], { stdio: "ignore", timeout: 60_000 }); } catch (refreshErr) {
          last = new Error(`api ${method} ${path} -> 401 and 'wrangler whoami' could not refresh: ${refreshErr?.message ?? refreshErr}`);
          break;
        }
        continue;
      }
      return { status: res.status, success: data.success === true, result: data.result, raw: data };
    } catch (err) {
      last = err;
      if (attempt < 3) await new Promise((x) => setTimeout(x, 500 * (attempt + 1)));
    }
  }
  throw last;
}
async function fork(src, name) {
  for (let a = 0; a < 6; a++) {
    const r = await api("POST", `/repos/${src}/fork`, { name });
    if (r.status === 200 || r.status === 201) return r;
    if (r.status === 403 || r.status === 404 || r.status >= 500 || /already exists/i.test(JSON.stringify(r.raw))) { await new Promise((x) => setTimeout(x, 1500 * (a + 1))); continue; }
    throw new Error(`fork ${src}->${name}: ${r.status} ${JSON.stringify(r.raw)}`);
  }
  throw new Error("fork retry exhausted");
}
async function mintToken(repo) {
  const r = await api("POST", "/tokens", { repo, scope: "write", ttl: 3600 });
  if (r.status !== 200 && r.status !== 201) throw new Error(`mint: ${r.status} ${JSON.stringify(r.raw)}`);
  return r.raw.result ?? r.raw;
}
async function deleteRepo(name) { return api("DELETE", `/repos/${name}`); }

const tail = spawn(WRANGLER, ["tail", "nextgit-platform", "--format", "json", "--search", "token-"], { cwd: join(process.cwd(), "platform"), stdio: ["ignore", "pipe", "pipe"] });
let raw = "";
tail.stdout.on("data", (d) => (raw += d.toString()));
tail.stderr.on("data", (d) => (raw += d.toString()));

await deleteRepo(PROP); await deleteRepo(BASE);
await new Promise((x) => setTimeout(x, 1200));
await fork("demo", BASE);
await fork(BASE, PROP);
const bt = await mintToken(BASE);
const pt = await mintToken(PROP);
const dir = mkdtempSync(join(tmpdir(), "ta-shape-"));
const git = (...args) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${pt.plaintext}` }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git("clone", `${gitBase}/${PROP}.git`, dir);
git("config", "user.name", "ta"); git("config", "user.email", "ta@x.dev");
writeFileSync(join(dir, "x.txt"), `shape ${new Date().toISOString()}\n`);
git("add", "-A"); git("commit", "-m", "shape probe"); git("push", "origin", "HEAD:refs/heads/main");
const res = await fetch(`${PLATFORM}/land`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "ta-shape/1.0" }, body: JSON.stringify({ base: BASE, repos: [PROP], baseRef: "main", ref: "main" }), signal: AbortSignal.timeout(120000) });
console.error("land ->", res.status);
await new Promise((x) => setTimeout(x, 8000));
tail.kill("SIGTERM");
console.log("=====RAW_TAIL_BEGIN=====");
console.log(raw);
console.log("=====RAW_TAIL_END=====");
for (const n of [PROP, BASE]) { try { await deleteRepo(n); } catch { } }
rmSync(dir, { recursive: true, force: true });
