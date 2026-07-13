// Shared cache of fully-downloaded reel video files, so a proxied/remote reel can be
// played from local memory (fast, network-free seeking) instead of range-fetching the
// CDN through /api/proxy on every scrub.
//
// We cache the Blob (not an object URL): each consumer makes its OWN URL.createObjectURL
// from it. That way evicting a Blob from this cache can never revoke a URL a mounted
// <video> is still using — the consumer's URL keeps its own blob alive until the consumer
// revokes it. Consumers: the filmstrip extractor and the canvas's playback <video>.

const LIMIT     = 4;                       // how many reels' blobs to keep deduped
const MAX_BYTES = 512 * 1024 * 1024;       // skip very large files to bound memory (the filmstrip already downloads them)
// Cumulative cap: LIMIT × MAX_BYTES alone allows ~2GB pinned — evict LRU past this total instead.
const TOTAL_MAX_BYTES = 768 * 1024 * 1024;

const cache    = new Map<string, Blob>();              // src URL → Blob (insertion order = LRU)
const inflight = new Map<string, Promise<Blob | null>>();

/** Synchronous: the cached Blob if `src` has already been fully downloaded, else undefined. */
export function getCachedBlob(src: string): Blob | undefined {
  const hit = cache.get(src);
  if (hit) { cache.delete(src); cache.set(src, hit); }   // bump LRU
  return hit;
}

/** Download `src` once and cache the Blob (deduped). Resolves null on failure or if too large. */
export function getVideoBlob(src: string): Promise<Blob | null> {
  const hit = cache.get(src);
  if (hit) { cache.delete(src); cache.set(src, hit); return Promise.resolve(hit); }   // bump LRU
  const inf = inflight.get(src);
  if (inf) return inf;

  const p = (async () => {
    // IDLE (stall) timeout, not a total one: abort only if NO bytes arrive for IDLE_MS. This keeps a long
    // but steadily-downloading video alive (the timer resets on every chunk) while still recovering from a
    // genuinely stalled stream — which otherwise hangs forever, stays pinned in `inflight`, and makes every
    // retry return the same never-resolving promise. A fixed total timeout would wrongly kill a big/slow
    // download; this only fires when the stream actually stops making progress.
    const controller = new AbortController();
    const IDLE_MS = 20_000;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => controller.abort(), IDLE_MS); };
    try {
      bump();
      const resp = await fetch(src, { signal: controller.signal });
      const len = Number(resp.headers.get('content-length') || 0);
      if (!resp.ok || !resp.body || (len && len > MAX_BYTES)) { controller.abort(); return null; }
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();                                  // progress → reset the stall timer (a slow download is fine)
        if (!value) continue;
        total += value.length;
        if (total > MAX_BYTES) { controller.abort(); return null; }
        chunks.push(value);
      }
      const blob = new Blob(chunks as BlobPart[], { type: resp.headers.get('content-type') || 'video/mp4' });
      cache.set(src, blob);
      const totalBytes = () => { let t = 0; for (const b of cache.values()) t += b.size; return t; };
      while (cache.size > LIMIT || totalBytes() > TOTAL_MAX_BYTES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined || oldest === src) break;
        cache.delete(oldest);   // drop the cache ref; consumers' object URLs keep their blobs alive
      }
      return blob;
    } catch {
      return null;
    } finally {
      if (idle) clearTimeout(idle);
      inflight.delete(src);
    }
  })();

  inflight.set(src, p);
  return p;
}
