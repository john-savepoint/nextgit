// nextgit-platform — per-file classification (judge idea 12).
//
// The single source for the three path/byte-driven axes every
// file carries: language (extension map), role (segment/basename
// rules) and sensitivity (the secret-path rule — the exact
// policy that decides AD-4 masking). Pure and dependency-free:
// O(1) string ops, no content reads. Sensitivity is path-driven
// ONLY — content-based detection is judge idea 11's lane and is
// deliberately absent here (the negative-control test pins it:
// a KEY=VALUE value at a non-secret path classifies `internal`).
//
// Seam law: `isSecretPath` + `SECRET_BASENAMES` live here (the
// classification authority); index.ts re-exports `isSecretPath`
// so every existing caller (route handlers, judge injection, the
// UI mirror) keeps working. `secretKeys` stays in index.ts — it
// reads text, it is not classification.

/** Language axis — extension-driven (judge idea 12). */
export type FileLanguage =
 | "typescript" | "javascript" | "json" | "yaml" | "toml"
 | "markdown" | "css" | "html" | "shell" | "sql" | "python"
 | "rust" | "go" | "wasm" | "text" | "unknown";

/** Role axis — segment/basename rules (judge idea 12). */
export type FileRole = "source" | "config" | "docs" | "data" | "asset" | "test";

/**
 * Sensitivity axis — the AD-4 policy vocabulary. `secret` is the
 * path-driven secret class (isSecretPath); everything else is
 * policy-only: `internal` for the repository's own content.
 */
export type FileSensitivity = "public" | "internal" | "secret";

export interface FileClassification {
 language: FileLanguage;
 role: FileRole;
 sensitivity: FileSensitivity;
}

/**
 * The secret-path rule — the single source the AD-4 masking law
 * keys off. Matches CONTRACT.md §Secret classes exactly:
 * basename `.env*`, `*.pem`, `*.key`, `*.p12`, the fixed
 * basenames (`credentials.json`, `secrets.json`, `.dev.vars`),
 * or any path containing `secrets/`.
 */
export const SECRET_BASENAMES = new Set(["credentials.json", "secrets.json", ".dev.vars"]);

export function isSecretPath(path: string): boolean {
 const base = path.slice(path.lastIndexOf("/") + 1);
 if (base.startsWith(".env")) return true;
 if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) return true;
 if (SECRET_BASENAMES.has(base)) return true;
 return path.includes("secrets/");
}

/** Sensitivity for a path (the policy axis of the same rule). */
export function sensitivityOf(path: string): FileSensitivity {
 return isSecretPath(path) ? "secret" : "internal";
}

// ---------------------------------------------------------------------------
// Language axis — extension map (lowercased; longest suffix
// first by table order, so `.d.ts`/`.test.ts` resolve before
// `.ts`).
// ---------------------------------------------------------------------------

const EXT_LANGUAGE: Record<string, FileLanguage> = {
 ".d.ts": "typescript",
 ".test.ts": "typescript",
 ".spec.ts": "typescript",
 ".ts": "typescript",
 ".tsx": "typescript",
 ".mts": "typescript",
 ".cts": "typescript",
 ".js": "javascript",
 ".mjs": "javascript",
 ".cjs": "javascript",
 ".jsx": "javascript",
 ".json": "json",
 ".jsonc": "json",
 ".yaml": "yaml",
 ".yml": "yaml",
 ".toml": "toml",
 ".md": "markdown",
 ".mdx": "markdown",
 ".css": "css",
 ".scss": "css",
 ".html": "html",
 ".htm": "html",
 ".sh": "shell",
 ".bash": "shell",
 ".sql": "sql",
 ".py": "python",
 ".rs": "rust",
 ".go": "go",
 ".wasm": "wasm",
 ".txt": "text",
};

const EXT_ROLE: Record<string, FileRole> = {
 ".d.ts": "source",
 ".test.ts": "test",
 ".spec.ts": "test",
 ".test.js": "test",
 ".test.mjs": "test",
 ".spec.js": "test",
 ".spec.mjs": "test",
};

function languageOf(path: string): FileLanguage {
 const lower = path.toLowerCase();
 for (const ext of Object.keys(EXT_LANGUAGE)) {
  if (lower.endsWith(ext)) return EXT_LANGUAGE[ext] ?? "unknown";
 }
 return "unknown";
}

// ---------------------------------------------------------------------------
// Role axis — segment/basename rules.
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /(?:^|[./-])(?:test|tests|spec|specs)(?:[.-]|$)/i;

/**
 * Role for a path. Test files win over their directory segment
 * (`__tests__/foo.ts` is a test); `test/`, `tests/` and
 * `__tests__/` segments classify every file under them as
 * test. `docs/` segments and README-ish basenames are docs;
 * `assets/`/`static/`/`public/`/`dist/` segments are assets;
 * config-ish basenames and dotfiles are config; tabular and
 * serialized extensions (csv/tsv/xml/json/yaml/toml that are
 * not known config files) are data; everything else is source.
 */
export function roleOf(path: string): FileRole {
 const segments = path.split("/");
 const base = segments[segments.length - 1] ?? "";
 const lower = base.toLowerCase();
 const ext = lower.slice(lower.lastIndexOf("."));

 // Test axis first: a test-named file is a test anywhere.
 if (EXT_ROLE[ext] === "test" || TEST_FILE_RE.test(base)) return "test";
 if (segments.some((s, i) => i < segments.length - 1 && (s === "test" || s === "tests" || s === "__tests__"))) {
  return "test";
 }
 // Docs: docs segments + README-ish basenames.
 if (segments.some((s, i) => i < segments.length - 1 && (s === "docs" || s === "doc"))) return "docs";
 if (lower === "readme" || lower.startsWith("readme.") || lower === "changelog" || lower.startsWith("changelog.")) {
  return "docs";
 }
 // Asset segments.
 if (segments.some((s, i) => i < segments.length - 1 && (s === "assets" || s === "static" || s === "public" || s === "dist" || s === "img" || s === "images"))) {
  return "asset";
 }
 // Config: dotfiles, fixed config basenames, config segments.
 if (base.startsWith(".")) return "config";
 if (["package.json", "package-lock.json", "tsconfig.json", "bunfig.toml", "wrangler.jsonc", "wrangler.toml"].includes(lower)) {
  return "config";
 }
 if (segments.some((s, i) => i < segments.length - 1 && s === "config")) return "config";
 // Data: tabular/serialized extensions, and any
 // json/yaml/toml that is not a known config basename.
 if ([".csv", ".tsv", ".xml"].includes(ext)) return "data";
 if ([".json", ".jsonc", ".yaml", ".yml", ".toml"].includes(ext)) return "data";
 return "source";
}

/**
 * Classify one file path. `binary` is accepted (the caller
 * stamps it from the byte-level read) but does not alter the
 * three axes — they are pure path law. Pure: O(1) string
 * ops, no I/O, no content reads.
 */
export function classifyFile(path: string, opts: { binary?: boolean } = {}): FileClassification {
 void opts;
 return {
  language: languageOf(path),
  role: roleOf(path),
  sensitivity: sensitivityOf(path),
 };
}
