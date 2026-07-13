import type { VideoData } from '@/app/types';

// Client-side cache + rate-limited fetch queue for Video Reels link fetches.
//
// • Cache (url → fetched VideoData): a fetched link survives section switches, so returning to the reels
//   section restores instantly with NO API call. Bounded to CACHE_LIMIT (LRU) so it stays light.
// • Queue: the download API is limited to ~1 req/sec, so when many reels need fetching we run them one at
//   a time with a minimum gap, instead of firing them all at once and tripping the limit.
//
// Module-level (singleton for the page session); cleared on a full reload.

const CACHE_LIMIT = 50;   // keep enough resolved reels cached that in-session nav past ~10 doesn't re-fetch
const cache = new Map<string, VideoData>();   // insertion order doubles as LRU recency

export function getCachedVideo(url: string): VideoData | undefined {
  const key = url.trim();
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }   // bump to most-recently-used
  return hit;
}

export function setCachedVideo(url: string, data: VideoData): void {
  const key = url.trim();
  cache.delete(key);
  cache.set(key, data);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;   // evict the least-recently-used
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface QueuedFetchResult { ok: boolean; json: unknown }

const MIN_GAP_MS = 1100;   // ≥1s between API calls to stay under the limit
const inflight = new Map<string, Promise<QueuedFetchResult>>();
const queue: Array<{ key: string; run: () => Promise<void> }> = [];
let running = false;
let lastAt = 0;

async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const { run } = queue.shift()!;
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    await run();
  }
  running = false;
}

// Run `doFetch` through the shared rate-limited queue. Concurrent calls for the same URL are coalesced
// into one request. The returned promise never rejects (network errors resolve to { ok: false }).
export function enqueueVideoFetch(url: string, doFetch: () => Promise<QueuedFetchResult>): Promise<QueuedFetchResult> {
  const key = url.trim();
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = new Promise<QueuedFetchResult>(resolve => {
    const run = async () => {
      try { resolve(await doFetch()); }
      catch { resolve({ ok: false, json: { error: 'Network error — please try again' } }); }
    };
    queue.push({ key, run });
  });
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  void runQueue();
  return p;
}

// Jump an already-queued fetch to the FRONT of the queue so the reel the user is currently viewing loads
// before the others. No-op if the url isn't waiting in the queue (already running/fetched, already at the
// front, or not yet enqueued — in which case the caller's own ordering handles it).
export function prioritizeVideoFetch(url: string): void {
  const key = url.trim();
  const i = queue.findIndex(item => item.key === key);
  if (i > 0) { const [item] = queue.splice(i, 1); queue.unshift(item); }
}
