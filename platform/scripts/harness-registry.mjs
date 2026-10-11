// harness-registry.mjs — declarative harness route registry.
//
// Loads and validates a shipped harness registry (harnesses.json) and merges
// an operator-supplied NEXTGIT_HARNESSES file (additive, same-id override).
// Pure loader: no probing, no network, no spawn.

import { readFileSync, accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIPPED = join(__dirname, "harnesses.json");

/**
 * Collect all structural violations in a parsed registry array.
 * @param {unknown} data — the parsed JSON
 * @param {string} sourceFile — for error messages
 * @returns {Array<{id: string|null, field: string, detail: string}>}
 */
export function collectRegistryErrors(data, sourceFile) {
 const errors = [];
 if (!Array.isArray(data)) {
  errors.push({ id: null, field: "root", detail: `${sourceFile}: registry root must be a JSON array` });
  return errors;
 }
 const seen = new Set();
 for (const [i, entry] of data.entries()) {
  const id = (typeof entry === "object" && entry !== null && typeof entry.id === "string" && entry.id) ? entry.id : null;
  if (typeof entry !== "object" || entry === null) {
   errors.push({ id: null, field: "entry", detail: `${sourceFile}[${i}]: entry must be an object` });
   continue;
  }
  if (typeof entry.id !== "string" || !entry.id) {
   errors.push({ id: null, field: "id", detail: `${sourceFile}[${i}]: missing or non-string 'id'` });
  }
  if (seen.has(entry.id)) {
   errors.push({ id: entry.id, field: "id", detail: `${sourceFile}[${i}]: duplicate id '${entry.id}'` });
  }
  seen.add(entry.id);
  if (typeof entry.bin !== "string" || !entry.bin) {
   errors.push({ id: entry.id, field: "bin", detail: `${sourceFile}[${i}]: missing or non-string 'bin'` });
  }
  if (entry.stdinPrompt === true) {
   if (Array.isArray(entry.args)) {
    errors.push({ id: entry.id, field: "args", detail: `${sourceFile}[${i}]: id '${entry.id}' has both 'args' and 'stdinPrompt: true'` });
   }
  } else {
   if (!Array.isArray(entry.args)) {
    errors.push({ id: entry.id, field: "args", detail: `${sourceFile}[${i}]: id '${entry.id}' missing 'args' array (or set stdinPrompt: true)` });
   } else {
    for (const [j, a] of entry.args.entries()) {
     if (typeof a !== "string") {
      errors.push({ id: entry.id, field: "args", detail: `${sourceFile}[${i}]: id '${entry.id}' args[${j}] is not a string` });
     }
    }
   }
  }
  if (entry.env !== undefined) {
   if (typeof entry.env !== "object" || entry.env === null) {
    errors.push({ id: entry.id, field: "env", detail: `${sourceFile}[${i}]: id '${entry.id}' env must be an object` });
   } else {
    for (const [k, v] of Object.entries(entry.env)) {
     if (typeof v !== "string") {
      errors.push({ id: entry.id, field: "env", detail: `${sourceFile}[${i}]: id '${entry.id}' env['${k}'] is not a string` });
     }
    }
   }
  }
  if (entry.probeBudgetMs !== undefined) {
   if (typeof entry.probeBudgetMs !== "number" || !Number.isFinite(entry.probeBudgetMs) || entry.probeBudgetMs < 0) {
    errors.push({ id: entry.id, field: "probeBudgetMs", detail: `${sourceFile}[${i}]: id '${entry.id}' probeBudgetMs must be a non-negative number` });
   }
  }
 }
 return errors;
}

/**
 * Validate a parsed registry array.
 * @param {unknown} data — the parsed JSON
 * @param {string} sourceFile — for error messages
 * @throws {Error} on first validation violation
 */
export function validateRegistry(data, sourceFile) {
 const errors = collectRegistryErrors(data, sourceFile);
 if (errors.length) {
  throw new Error(errors[0].detail);
 }
}

/**
 * Read, parse, and validate a JSON file at the given path.
 * @param {string} path
 * @returns {Array} validated array
 * @throws {Error} on read, parse, or validation failure
 */
export function loadFile(path) {
 let raw;
 try {
  raw = readFileSync(path, "utf8");
 } catch (e) {
  throw new Error(`Cannot read registry file '${path}': ${e.message}`);
 }
 let data;
 try {
  data = JSON.parse(raw);
 } catch (e) {
  throw new Error(`Cannot parse registry file '${path}': ${e.message}`);
 }
 validateRegistry(data, path);
 return data;
}

/**
 * Normalize an entry: defaults stdinPrompt=false, env={}.
 */
function normalize(entry) {
 return {
  ...entry,
  stdinPrompt: entry.stdinPrompt === true,
  env: entry.env ?? {},
 };
}

/**
 * Load the shipped harnesses.json.
 */
export function loadShipped() {
 const data = loadFile(SHIPPED);
 return data.map(normalize);
}

/**
 * Load shipped registry + merge NEXTGIT_HARNESSES (additive, same-id override).
 * @returns {{harnesses: Array, errors: string[]}}
 */
export function loadRegistry() {
 const errors = [];
 let shipped;
 try {
  shipped = loadShipped();
 } catch (e) {
  errors.push(e.message);
  return { harnesses: [], errors };
 }

 const byId = new Map();
 for (const h of shipped) byId.set(h.id, h);

 const extraPath = process.env.NEXTGIT_HARNESSES;
 if (extraPath) {
  try {
   const extra = loadFile(extraPath);
   for (const h of extra) {
    byId.set(h.id, normalize(h));
   }
  } catch (e) {
   errors.push(e.message);
  }
 }

 return { harnesses: [...byId.values()], errors };
}

/**
 * Resolve a `bin` against the filesystem: an absolute or path-relative
 * spec is checked directly; a bare name walks PATH. Pure filesystem
 * (accessSync + X_OK), no subprocess.
 * @param {string} bin
 * @returns {boolean} true when an executable was found
 */
export function resolveBin(bin) {
 if (isAbsolute(bin) || bin.includes("/")) {
  try {
   accessSync(bin, constants.X_OK);
   return true;
  } catch {
   return false;
  }
 }
 for (const dir of (process.env.PATH ?? "").split(pathDelimiter())) {
  if (!dir) continue;
  try {
   accessSync(join(dir, bin), constants.X_OK);
   return true;
  } catch {
   // keep walking
  }
 }
 return false;
}

function pathDelimiter() {
 return process.platform === "win32" ? ";" : ":";
}

/**
 * Semantic checks the structural validator cannot express: prompt
 * delivery ({prompt} placeholder or stdinPrompt) and bin resolvability.
 * @param {Array} entries — parsed registry entries
 * @param {string} sourceFile — for error messages
 * @returns {Array<{id: string|null, field: string, detail: string}>}
 */
export function semanticRegistryErrors(entries, sourceFile) {
 const errors = [];
 entries.forEach((entry, i) => {
  if (typeof entry !== "object" || entry === null) return;
  if (entry.stdinPrompt !== true && Array.isArray(entry.args) && !entry.args.some((a) => typeof a === "string" && a.includes("{prompt}"))) {
   errors.push({ id: entry.id ?? null, field: "args", detail: `${sourceFile}[${i}]: id '${entry.id ?? ""}' args has no '{prompt}' placeholder and no 'stdinPrompt: true'` });
  }
  if (typeof entry.bin === "string" && entry.bin && !resolveBin(entry.bin)) {
   errors.push({ id: entry.id ?? null, field: "bin", detail: `${sourceFile}[${i}]: id '${entry.id ?? ""}' unresolvable bin '${entry.bin}'` });
  }
 });
 return errors;
}

/**
 * Validate a registry file end-to-end: read, parse, collect structural
 * AND semantic errors. Never throws — the report always carries the
 * exact {ok, harnesses, errors} shape.
 * @param {string} path — registry file to check
 * @returns {{ok: boolean, harnesses: Array, errors: Array<{id: string|null, field: string, detail: string}>}}
 */
export function checkRegistry(path) {
 let raw;
 try {
  raw = readFileSync(path, "utf8");
 } catch (e) {
  return { ok: false, harnesses: [], errors: [{ id: null, field: "file", detail: `Cannot read/parse registry file '${path}': ${e.message}` }] };
 }
 let data;
 try {
  data = JSON.parse(raw);
 } catch (e) {
  return { ok: false, harnesses: [], errors: [{ id: null, field: "file", detail: `Cannot read/parse registry file '${path}': ${e.message}` }] };
 }
 const errors = [...collectRegistryErrors(data, path), ...semanticRegistryErrors(Array.isArray(data) ? data : [], path)];
 if (errors.length) {
  return { ok: false, harnesses: [], errors };
 }
 return { ok: true, harnesses: data.map(normalize), errors: [] };
}

/**
 * Build the args array for a harness entry by substituting {prompt}/{cwd}
 * placeholders. If stdinPrompt is true, returns [] — the caller must feed
 * the prompt on stdin.
 */
export function buildArgs(entry, prompt, cwd) {
 if (entry.stdinPrompt === true) return [];
 return entry.args.map((a) => a.replace(/{prompt}/g, () => prompt).replace(/{cwd}/g, () => cwd));
}
