// Ambient augmentation of the stale generated Artifacts binding surface.
// The wrangler-bundled workerd (<=1.20260630.1) predates the git-object methods;
// these declarations merge with the generated `ArtifactsRepo` / `ArtifactsRepoInfo`
// in worker-configuration.d.ts so tsc sees the live runtime API.
// Regenerate worker-configuration.d.ts from a newer wrangler (>=1.20260901) to
// retire this file — it then declares nothing new and becomes dead.

// Tree entry returned by repo.readTree(): name, hash, and type.
interface ArtifactsTreeEntry {
  name: string;
  hash: string;
  type: "tree" | "blob" | "exec";
}

// Augment the generated ArtifactsRepoInfo: the live REST/listing API attaches
// `status` to each repo in a list result (Omit<info,"remote"> used at index.ts:614).
interface ArtifactsRepoInfo {
  status?: "ready" | "importing" | "forking";
}

// Commit metadata returned by repo.log(): the runtime supplies hash, treeHash,
// message, an author object with name+email, and a numeric author timestamp.
// Note: the runtime field is `authoredAt`, NOT `timestamp`; the source maps
// repo.log() output onto its own CommitMeta (which flattens author to a string
// and calls the field `timestamp`) at index.ts:449-453.
interface ArtifactsCommitMetadata {
  hash: string; // 40-hex SHA-1
  treeHash: string; // tree SHA-1 (read at index.ts:98/136/200)
  message: string; // commit subject
  author: { name: string; email: string }; // author identity
  authoredAt: number; // Unix seconds (author date)
}

// Augment the generated ArtifactsRepo: merge the git-object methods the source
// calls and that are absent from the stale bundled workerd declarations.
interface ArtifactsRepo {
  info(): Promise<ArtifactsRepoInfo>;
  log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<ArtifactsCommitMetadata[]>;
  readTree(hash: string): Promise<ArtifactsTreeEntry[] | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
  readBlob(hash: string): Promise<Blob | null>;
  readCommit(hash: string): Promise<ArtifactsCommitMetadata | null>;
}
