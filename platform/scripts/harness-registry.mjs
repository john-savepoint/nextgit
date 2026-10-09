// harness-registry.mjs — declarative harness route registry.
//
// Loads and validates a shipped harness registry (harnesses.json) and merges
// an operator-supplied NEXTGIT_HARNESSES file (additive, same-id override).
// Pure loader: no probing, no network, no spawn.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIPPED = join(__dirname, "harnesses.json");

/**
 * Validate a parsed registry array.
 * @param {unknown} data — the parsed JSON
 * @param {string} sourceFile — for error messages
 * @throws {Error} on first validation violation
 */
export function validateRegistry(data, sourceFile) {
 if (!Array.isArray(data)) {
  throw new Error(`${sourceFile}: registry root must be a JSON array`);
 }
 const seen = new Set();
 for (const [i, entry] of data.entries()) {
  if (typeof entry !== "object" || entry === null) {
   throw new Error(`${sourceFile}[${i}]: entry must be an object`);
  }
  if (typeof entry.id !== "string" || !entry.id) {
   throw new Error(`${sourceFile}[${i}]: missing or non-string 'id'`);
  }
  if (seen.has(entry.id)) {
   throw new Error(`${sourceFile}[${i}]: duplicate id '${entry.id}'`);
  }
  seen.add(entry.id);
  if (typeof entry.bin !== "string" || !entry.bin) {
   throw new Error(`${sourceFile}[${i}]: missing or non-string 'bin'`);
  }
  if (entry.stdinPrompt === true) {
   if (Array.isArray(entry.args)) {
    throw new Error(`${sourceFile}[${i}]: id '${entry.id}' has both 'args' and 'stdinPrompt: true'`);
   }
  } else {
   if (!Array.isArray(entry.args)) {
    throw new Error(`${sourceFile}[${i}]: id '${entry.id}' missing 'args' array (or set stdinPrompt: true)`);
   }
   for (const [j, a] of entry.args.entries()) {
    if (typeof a !== "string") {
     throw new Error(`${sourceFile}[${i}]: id '${entry.id}' args[${j}] is not a string`);
    }
   }
  }
  if (entry.env !== undefined) {
   if (typeof entry.env !== "object" || entry.env === null) {
    throw new Error(`${sourceFile}[${i}]: id '${entry.id}' env must be an object`);
   }
   for (const [k, v] of Object.entries(entry.env)) {
    if (typeof v !== "string") {
     throw new Error(`${sourceFile}[${i}]: id '${entry.id}' env['${k}'] is not a string`);
    }
   }
  }
  if (entry.probeBudgetMs !== undefined) {
   if (typeof entry.probeBudgetMs !== "number" || !Number.isFinite(entry.probeBudgetMs) || entry.probeBudgetMs < 0) {
    throw new Error(`${sourceFile}[${i}]: id '${entry.id}' probeBudgetMs must be a non-negative number`);
   }
  }
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
 * Build the args array for a harness entry by substituting {prompt}/{cwd}
 * placeholders. If stdinPrompt is true, returns [] — the caller must feed
 * the prompt on stdin.
 */
export function buildArgs(entry, prompt, cwd) {
 if (entry.stdinPrompt === true) return [];
 return entry.args.map((a) => a.replace(/{prompt}/g, () => prompt).replace(/{cwd}/g, () => cwd));
}
