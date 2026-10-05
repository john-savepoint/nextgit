// nextgit-platform — the HTTP transport isomorphic-git pushes through.
//
// isomorphic-git's stock clients cannot carry an Artifacts write token: it is a
// bearer token, not a username/password pair, so there is nothing to hand to
// `onAuth`. This client wraps `fetch` and injects `Authorization` on every
// request, which is the same mechanism platform/scripts/agents.mjs uses from the
// CLI side.

interface GitHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Uint8Array;
  signal?: AbortSignal;
}

interface GitHttpResponse {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: AsyncIterableIterator<Uint8Array>;
  statusCode: number;
  statusMessage: string;
}

interface GitHttpClient {
  request(req: GitHttpRequest): Promise<GitHttpResponse>;
}

/** A one-shot async iterator over a single buffer. */
function singleChunk(value: Uint8Array): AsyncIterableIterator<Uint8Array> {
  let done = false;
  return {
    next: (): Promise<IteratorResult<Uint8Array>> =>
      Promise.resolve(done ? { done: true, value: undefined } : ((done = true), { done: false, value })),
    return: (): Promise<IteratorResult<Uint8Array>> => Promise.resolve({ done: true, value: undefined }),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * isomorphic-git hands the request body as an async iterator; fetch wants a
 * single buffer. Git packs for a proposal repo are small, so concatenating in
 * memory is cheaper than streaming a multipart upload.
 */
async function collectBody(body: GitHttpRequest["body"]): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  if (body instanceof Uint8Array) return body;
  const parts: Uint8Array[] = [];
  for await (const chunk of body) parts.push(chunk);
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Adapt a web ReadableStream to the async-iterator shape isomorphic-git wants. */
function streamToIterator(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  // workerd's ReadableStream is already async-iterable; the reader path exists
  // for runtimes that do not implement it.
  if (Symbol.asyncIterator in stream) return stream as unknown as AsyncIterableIterator<Uint8Array>;
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  return {
    next: (): Promise<IteratorResult<Uint8Array>> =>
      reader.read() as Promise<IteratorResult<Uint8Array>>,
    return: (): Promise<IteratorResult<Uint8Array>> => {
      reader.releaseLock();
      return Promise.resolve({ done: true, value: undefined });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

export function createGitHttpClient(token: string): GitHttpClient {
  return {
    async request({ url, method = "GET", headers = {}, body, signal }: GitHttpRequest): Promise<GitHttpResponse> {
      const res = await fetch(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: (await collectBody(body)) as BodyInit | undefined,
        signal,
      });
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        url: res.url,
        method,
        headers: responseHeaders,
        body: res.body ? streamToIterator(res.body) : singleChunk(new Uint8Array(0)),
        statusCode: res.status,
        statusMessage: res.statusText,
      };
    },
  };
}