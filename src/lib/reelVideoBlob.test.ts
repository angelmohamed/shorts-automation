import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// reelVideoBlob.ts is a singleton module: it holds a module-level `cache` Map
// and `inflight` Map plus a concurrency counter. To keep every test hermetic we
// reset the module registry before each test and re-import a FRESH copy (fresh
// empty cache / counters). We never touch the source module — only the mocked
// global `fetch`.
//
// Expectations here are derived from the module's stated spec (LRU-by-insertion,
// dedup, size caps) and from web-verified platform semantics:
//   - Map iterates in insertion order; `delete(k)` + `set(k,v)` re-appends k as
//     the NEWEST entry, so `cache.keys().next().value` is the LRU victim.
//     (MDN Map; confirmed by a node run.)
//   - `new Blob(parts).size` === sum of the parts' byte lengths. (MDN Blob.)
//   - The module trusts ACTUAL streamed bytes for blob.size, which may legally
//     differ from a Content-Length header. (MDN Content-Length.)
// ---------------------------------------------------------------------------

const MAX_BYTES = 512 * 1024 * 1024; // 536870912 — module's per-file cap
const LIMIT = 4;                     // module's dedup count cap

type ModShape = typeof import('./reelVideoBlob');

async function freshModule(): Promise<ModShape> {
  vi.resetModules();
  return import('./reelVideoBlob');
}

interface RespOpts {
  ok?: boolean;
  status?: number;
  contentLength?: number | string; // omit => header absent
  contentType?: string;            // omit => header absent
  chunks?: unknown[];              // ReadableStream chunks (Uint8Array, or {length} to simulate size)
  body?: null;                     // pass null to force a null body
}

/**
 * Build a minimal but faithful Response-shaped object. The module only reads
 * `.ok`, `.status`, `.body`, `.headers.get(...)`, and `.body.getReader()`.
 * We use a real Headers and a real ReadableStream so `.get()` and `.getReader()`
 * behave exactly like the platform's.
 */
function makeResponse(opts: RespOpts = {}) {
  const { ok = true, status = 200, contentLength, contentType, chunks = [], body } = opts;
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  if (contentType !== undefined) headers.set('content-type', contentType);

  const getReader = vi.fn(() => {
    const rs = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c as Uint8Array);
        controller.close();
      },
    });
    return rs.getReader();
  });

  const respBody = body === null ? null : { getReader };
  return { ok, status, headers, body: respBody, _getReaderSpy: getReader };
}

function stubFetch(impl: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => impl(url));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const enc = (s: string) => new TextEncoder().encode(s);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ===========================================================================
describe('getCachedBlob', () => {
  it('returns undefined for a URL that was never downloaded (cache miss)', async () => {
    const { getCachedBlob } = await freshModule();
    stubFetch(() => makeResponse());
    expect(getCachedBlob('https://cdn/never.mp4')).toBeUndefined();
  });

  it('is synchronous and never triggers a network fetch on a miss', async () => {
    const { getCachedBlob } = await freshModule();
    const fetchMock = stubFetch(() => makeResponse());
    getCachedBlob('https://cdn/a.mp4');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the exact same Blob instance after getVideoBlob has cached it (hit)', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch(() => makeResponse({ contentType: 'video/mp4', chunks: [enc('hello')] }));
    const downloaded = await getVideoBlob('https://cdn/hit.mp4');
    expect(downloaded).toBeInstanceOf(Blob);
    // Must be the identical object reference the cache holds — the whole point is
    // to hand back the already-downloaded blob, not a copy.
    expect(getCachedBlob('https://cdn/hit.mp4')).toBe(downloaded);
  });
});

// ===========================================================================
describe('getVideoBlob — successful download', () => {
  it('assembles a Blob whose bytes and size match the streamed chunks', async () => {
    const { getVideoBlob } = await freshModule();
    // Two chunks: "foo" (3) + "bar!" (4) => 7 bytes total.
    stubFetch(() => makeResponse({ chunks: [enc('foo'), enc('bar!')] }));
    const blob = await getVideoBlob('https://cdn/v.mp4');
    expect(blob).toBeInstanceOf(Blob);
    // Blob.size === sum of part byte lengths (MDN-verified).
    expect(blob!.size).toBe(7);
    expect(await blob!.text()).toBe('foobar!');
  });

  it('uses the response content-type for the Blob type', async () => {
    const { getVideoBlob } = await freshModule();
    stubFetch(() => makeResponse({ contentType: 'video/webm', chunks: [enc('x')] }));
    const blob = await getVideoBlob('https://cdn/w.webm');
    expect(blob!.type).toBe('video/webm');
  });

  it('falls back to video/mp4 when no content-type header is present', async () => {
    const { getVideoBlob } = await freshModule();
    stubFetch(() => makeResponse({ chunks: [enc('x')] })); // no contentType
    const blob = await getVideoBlob('https://cdn/notype');
    expect(blob!.type).toBe('video/mp4');
  });

  it('trusts actual streamed bytes for size even when Content-Length disagrees (server lied)', async () => {
    const { getVideoBlob } = await freshModule();
    // Header claims 2 bytes, stream actually delivers 5. Blob must reflect reality.
    stubFetch(() => makeResponse({ contentLength: 2, chunks: [enc('12345')] }));
    const blob = await getVideoBlob('https://cdn/lies.mp4');
    expect(blob!.size).toBe(5);
  });
});

// ===========================================================================
describe('getVideoBlob — failure / rejection paths return null (never cache)', () => {
  it('returns null on a non-ok response and does NOT cache it', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch(() => makeResponse({ ok: false, status: 500, chunks: [enc('err')] }));
    const res = await getVideoBlob('https://cdn/bad.mp4');
    expect(res).toBeNull();
    // Failures must not poison the cache (no negative caching).
    expect(getCachedBlob('https://cdn/bad.mp4')).toBeUndefined();
  });

  it('re-fetches after a failure instead of returning a stale null', async () => {
    const { getVideoBlob } = await freshModule();
    let call = 0;
    const fetchMock = stubFetch(() => {
      call++;
      return call === 1
        ? makeResponse({ ok: false, status: 503 })
        : makeResponse({ chunks: [enc('ok')] });
    });
    expect(await getVideoBlob('https://cdn/retry.mp4')).toBeNull();
    const second = await getVideoBlob('https://cdn/retry.mp4');
    expect(second).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the response has a null body', async () => {
    const { getVideoBlob } = await freshModule();
    stubFetch(() => makeResponse({ body: null }));
    expect(await getVideoBlob('https://cdn/nobody.mp4')).toBeNull();
  });

  it('rejects (null) when Content-Length exceeds MAX_BYTES and never reads the body', async () => {
    const { getVideoBlob } = await freshModule();
    const resp = makeResponse({ contentLength: MAX_BYTES + 1, chunks: [enc('data')] });
    stubFetch(() => resp);
    expect(await getVideoBlob('https://cdn/huge.mp4')).toBeNull();
    // The whole point of the header gate is to bail BEFORE downloading.
    expect(resp._getReaderSpy).not.toHaveBeenCalled();
  });

  it('ACCEPTS Content-Length exactly equal to MAX_BYTES (cap is strict >, not >=)', async () => {
    const { getVideoBlob } = await freshModule();
    // Header says exactly MAX_BYTES; body is tiny so the streaming cap won't trip.
    // A boundary bug (>= instead of >) would wrongly reject this.
    stubFetch(() => makeResponse({ contentLength: MAX_BYTES, chunks: [enc('tiny')] }));
    const blob = await getVideoBlob('https://cdn/edge.mp4');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.size).toBe(4);
  });

  it('rejects (null) when cumulative streamed bytes exceed MAX_BYTES', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    // Simulate an oversized stream WITHOUT allocating 512MB: enqueue a chunk whose
    // `.length` (the exact field the module sums) reports MAX_BYTES+1 bytes.
    stubFetch(() => makeResponse({ chunks: [{ length: MAX_BYTES + 1 }] }));
    expect(await getVideoBlob('https://cdn/streambig.mp4')).toBeNull();
    expect(getCachedBlob('https://cdn/streambig.mp4')).toBeUndefined();
  });

  it('ignores a non-numeric Content-Length header and downloads normally', async () => {
    const { getVideoBlob } = await freshModule();
    // Number('garbage') is NaN, NaN is falsy => the `len && len > MAX` gate is skipped.
    stubFetch(() => makeResponse({ contentLength: 'garbage', chunks: [enc('ok')] }));
    const blob = await getVideoBlob('https://cdn/nan.mp4');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.size).toBe(2);
  });
});

// ===========================================================================
describe('getVideoBlob — dedup', () => {
  it('collapses two concurrent calls for the same URL into ONE fetch and one shared promise', async () => {
    const { getVideoBlob } = await freshModule();
    const fetchMock = stubFetch(() => makeResponse({ chunks: [enc('dup')] }));
    // Called synchronously back-to-back: the 2nd sees the in-flight promise.
    const p1 = getVideoBlob('https://cdn/dup.mp4');
    const p2 = getVideoBlob('https://cdn/dup.mp4');
    expect(p1).toBe(p2); // same in-flight promise, not two downloads
    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toBe(b2); // same Blob instance
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a subsequent call for the same URL from cache without re-fetching', async () => {
    const { getVideoBlob } = await freshModule();
    const fetchMock = stubFetch(() => makeResponse({ chunks: [enc('cache')] }));
    const first = await getVideoBlob('https://cdn/same.mp4');
    const second = await getVideoBlob('https://cdn/same.mp4');
    expect(second).toBe(first);          // identical cached Blob
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second network hit
  });

  it('treats distinct URLs as distinct downloads (no false dedup)', async () => {
    const { getVideoBlob } = await freshModule();
    const fetchMock = stubFetch((url) => makeResponse({ chunks: [enc(url)] }));
    const a = await getVideoBlob('https://cdn/a.mp4');
    const b = await getVideoBlob('https://cdn/b.mp4');
    expect(a).not.toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
describe('getVideoBlob — LRU eviction (count cap = LIMIT)', () => {
  // Download N distinct small URLs sequentially so cache insertion order is
  // deterministic (= completion order = call order).
  async function downloadSequential(getVideoBlob: ModShape['getVideoBlob'], urls: string[]) {
    for (const u of urls) await getVideoBlob(u);
  }

  it('keeps only LIMIT entries and evicts the oldest (least-recently-inserted)', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch((url) => makeResponse({ chunks: [enc(url)] }));
    const urls = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => `https://cdn/${u}`);
    await downloadSequential(getVideoBlob, urls); // LIMIT=4, so u1 must be evicted

    expect(getCachedBlob(urls[0])).toBeUndefined();      // u1 evicted (oldest)
    for (let i = 1; i < urls.length; i++) {
      expect(getCachedBlob(urls[i])).toBeInstanceOf(Blob); // u2..u5 retained
    }
  });

  it('does not evict anything while at/below LIMIT', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch((url) => makeResponse({ chunks: [enc(url)] }));
    const urls = ['a', 'b', 'c', 'd'].map((u) => `https://cdn/${u}`); // exactly LIMIT
    await downloadSequential(getVideoBlob, urls);
    for (const u of urls) expect(getCachedBlob(u)).toBeInstanceOf(Blob);
  });

  it('a getCachedBlob() access BUMPS recency so a DIFFERENT (now-oldest) entry is evicted', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch((url) => makeResponse({ chunks: [enc(url)] }));
    const [u1, u2, u3, u4, u5] = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => `https://cdn/${u}`);
    await downloadSequential(getVideoBlob, [u1, u2, u3, u4]); // order: u1,u2,u3,u4

    // Touch u1 -> it becomes most-recent; u2 is now the oldest.
    expect(getCachedBlob(u1)).toBeInstanceOf(Blob);

    await getVideoBlob(u5); // pushes over LIMIT -> evicts current oldest = u2

    expect(getCachedBlob(u2)).toBeUndefined();     // the bumped-past victim
    expect(getCachedBlob(u1)).toBeInstanceOf(Blob); // survived because it was bumped
    expect(getCachedBlob(u3)).toBeInstanceOf(Blob);
    expect(getCachedBlob(u4)).toBeInstanceOf(Blob);
    expect(getCachedBlob(u5)).toBeInstanceOf(Blob);
  });

  it('a getVideoBlob() cache-hit also BUMPS recency', async () => {
    const { getVideoBlob, getCachedBlob } = await freshModule();
    stubFetch((url) => makeResponse({ chunks: [enc(url)] }));
    const [u1, u2, u3, u4, u5] = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => `https://cdn/${u}`);
    await downloadSequential(getVideoBlob, [u1, u2, u3, u4]);

    await getVideoBlob(u1); // cache hit -> bump u1, u2 becomes oldest
    await getVideoBlob(u5); // evicts oldest = u2

    expect(getCachedBlob(u2)).toBeUndefined();
    expect(getCachedBlob(u1)).toBeInstanceOf(Blob);
  });
});
