// nextgit-platform — runtime globals isomorphic-git expects but Workers lacks.
//
// isomorphic-git is built for Node and browsers and calls the global `Buffer`
// for blob/sha1/pack work. workerd provides `Buffer` only behind
// `nodejs_compat`, so the pure-JS `buffer` package is installed on
// globalThis here. This module must be imported *before* `isomorphic-git` so
// the global exists by the time a git command runs.
//
// Note: no top-level statement in isomorphic-git touches `Buffer`, so import
// order matters only for the runtime calls, not for module evaluation.

import { Buffer } from "buffer";

type MutableGlobal = typeof globalThis & { Buffer?: typeof Buffer };

(globalThis as MutableGlobal).Buffer ??= Buffer;

export {};