// nextgit-platform — an in-memory file system shaped for isomorphic-git.
//
// Workers have no filesystem, and the off-the-shelf memfs package pulls in
// `node:` builtins that cannot be bundled for the Workers runtime. isomorphic-git
// only ever calls twelve methods, all listed below, so the whole requirement is
// small enough to implement directly: a flat Map of path -> Uint8Array plus
// directory bookkeeping for readdir.

type Entry = { data: Uint8Array; mode: number; isDirectory: boolean };

const MODE_FILE = 0o100644;
const MODE_DIR = 0o040000;

/** The stat shape isomorphic-git reads: numeric fields plus the predicates it probes with. */
interface MemStat {
  ctimeSeconds: number;
  ctimeNanoseconds: number;
  mtimeSeconds: number;
  mtimeNanoseconds: number;
  dev: number;
  ino: number;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

/**
 * A stat as isomorphic-git reads it. `ino` is fabricated from the path so the
 * racy-git staleness check compares like with like across calls.
 */
function statFor(path: string, entry: Entry, mtimeMs: number): MemStat {
  return {
    ctimeSeconds: Math.floor(mtimeMs / 1000),
    ctimeNanoseconds: (mtimeMs % 1000) * 1e6,
    mtimeSeconds: Math.floor(mtimeMs / 1000),
    mtimeNanoseconds: (mtimeMs % 1000) * 1e6,
    dev: 1,
    ino: hashPath(path),
    mode: entry.mode,
    uid: 0,
    gid: 0,
    size: entry.isDirectory ? 0 : entry.data.byteLength,
    isFile: () => !entry.isDirectory,
    isDirectory: () => entry.isDirectory,
    isSymbolicLink: () => entry.mode === 0o120000,
  };
}

/** A stable small integer per path, standing in for an inode number. */
function hashPath(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/** POSIX-ish normalisation: strip duplicate and trailing slashes, no `..` climbing. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of String(path).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

export interface MemFs {
  readFile(path: string, options?: { encoding?: string }): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string, options?: { mode?: number }): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readdirDeep(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  lstat(path: string): Promise<MemStat>;
  stat(path: string): Promise<MemStat>;
  readlink(path: string): Promise<Uint8Array>;
  symlink(target: string, path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  files(): string[];
}

export function createMemFs(): MemFs {
  const files = new Map<string, Entry>();
  const dirs = new Set<string>(["/"]);
  const times = new Map<string, number>();

  const ensureDirs = (path: string): void => {
    let cur = "";
    for (const seg of path.split("/")) {
      if (!seg) continue;
      cur += `/${seg}`;
      dirs.add(cur);
    }
  };

  const touch = (path: string): void => {
    times.set(path, Date.now());
  };

  const get = (path: string): Entry | undefined => files.get(path);

  return {
    async readFile(path: string, options?: { encoding?: string }): Promise<Uint8Array | string> {
      const key = normalize(path);
      const entry = get(key);
      if (!entry) {
        const err = new Error(`ENOENT: no such file or directory, open '${key}'`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      // isomorphic-git reads config/refs with `{encoding:'utf8'}` and treats a
      // Uint8Array there as a corrupt file.
      return options?.encoding ? new TextDecoder().decode(entry.data) : entry.data;
    },

    async writeFile(path: string, data: Uint8Array | string, options?: { mode?: number }): Promise<void> {
      const key = normalize(path);
      ensureDirs(key.slice(0, key.lastIndexOf("/")) || "/");
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const existing = get(key);
      files.set(key, {
        data: bytes,
        // `git.writeBlob`-era callers pass an explicit mode; a rewrite that omits
        // it must keep the mode the index already recorded or the index goes
        // stale on every write.
        mode: options?.mode ?? existing?.mode ?? MODE_FILE,
        isDirectory: false,
      });
      touch(key);
    },

    // Idempotent on purpose: isomorphic-git clears `.git/shallow` on every
    // non-shallow fetch and treats a missing file as success.
    async unlink(path: string): Promise<void> {
      const key = normalize(path);
      if (!files.delete(key)) dirs.delete(key);
    },

    async readdir(path: string): Promise<string[]> {
      const key = normalize(path);
      const prefix = key === "/" ? "/" : `${key}/`;
      if (!dirs.has(key) && !files.has(key)) {
        throw new Error(`ENOENT: no such file or directory, scandir '${key}'`);
      }
      const names = new Set<string>();
      for (const p of files.keys()) {
        if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.add(p.slice(prefix.length));
      }
      for (const d of dirs) {
        if (d === key) continue;
        if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) names.add(d.slice(prefix.length));
      }
      return Array.from(names).sort();
    },

    async readdirDeep(path: string): Promise<string[]> {
      const key = normalize(path);
      const prefix = key === "/" ? "/" : `${key}/`;
      const deep: string[] = [];
      for (const p of files.keys()) if (p.startsWith(prefix)) deep.push(p);
      for (const d of dirs) if (d !== key && d.startsWith(prefix)) deep.push(`${d}/`);
      return deep.sort();
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const key = normalize(path);
      if (dirs.has(key)) {
        if (!options?.recursive) throw new Error(`EEXIST: file already exists, mkdir '${key}'`);
        return;
      }
      if (files.has(key)) throw new Error(`EEXIST: file already exists, mkdir '${key}'`);
      ensureDirs(key);
    },

    async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const key = normalize(path);
      if (!options?.recursive) {
        const empty = (await this.readdir(key)).length === 0;
        if (!empty) throw new Error(`ENOTEMPTY: directory not empty, rmdir '${key}'`);
      } else {
        const prefix = `${key}/`;
        for (const p of Array.from(files.keys())) if (p === key || p.startsWith(prefix)) files.delete(p);
        for (const d of Array.from(dirs)) if (d === key || d.startsWith(prefix)) dirs.delete(d);
        dirs.delete(key);
        ensureDirs(key);
      }
      touch(key);
    },

    async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
      await this.unlink(path);
      if (options?.recursive) await this.rmdir(path, { recursive: true });
    },

    // A missing path must throw with `code: "ENOENT"`: FileSystem.exists() reads
    // that code to report false, and discoverGitdir catches the throw to treat
    // an absent `.git` as "not initialised yet".
    async lstat(path: string): Promise<MemStat> {
      const key = normalize(path);
      const entry = get(key);
      if (entry) return statFor(key, entry, times.get(key) ?? Date.now());
      if (dirs.has(key)) return statFor(key, { data: new Uint8Array(0), mode: MODE_DIR, isDirectory: true }, times.get(key) ?? Date.now());
      const err = new Error(`ENOENT: no such file or directory, lstat '${key}'`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },

    // No symlinks are ever created in this fs, so stat and lstat are the same
    // walk; isomorphic-git requires both to exist on the client object.
    async stat(path: string): Promise<MemStat> {
      return this.lstat(path);
    },

    async readlink(path: string): Promise<Uint8Array> {
      const key = normalize(path);
      const entry = get(key);
      // isomorphic-git only calls this on symlinks; a plain read keeps the
      // working-tree walker correct on filesystems without them.
      return entry ? entry.data : new TextEncoder().encode("");
    },

    async symlink(target: string, path: string): Promise<void> {
      const key = normalize(path);
      ensureDirs(key.slice(0, key.lastIndexOf("/")) || "/");
      files.set(key, { data: new TextEncoder().encode(target), mode: 0o120000, isDirectory: false });
      touch(key);
    },

    async exists(path: string): Promise<boolean> {
      const key = normalize(path);
      return files.has(key) || dirs.has(key);
    },

    files(): string[] {
      return Array.from(files.keys()).sort();
    },
  };
}