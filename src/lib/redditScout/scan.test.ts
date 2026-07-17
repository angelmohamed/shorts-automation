import { describe, it, expect } from 'vitest';
import { runScan } from './scan';
import type { RedditScoutSource } from './source';
import type { ScoutSubreddit } from './config';

// Expectations derived from the spec (§4.1 fetch + politeness + skip-on-fail, §3.4 loud-fail on a broken
// ledger, §4.5 session assembly) — the stub source lets every property be asserted without network.

const SUBS: ScoutSubreddit[] = [
  { name: 'AskReddit', category: 'A', minScore: 5000 },
  { name: 'tifu', category: 'B', minScore: 800 },
  { name: 'rareinsults', category: 'C', minScore: 1, image: true },   // must never be fetched (v1)
  { name: 'wouldyourather', category: 'D', minScore: 300 },
];

/** A minimal real-shaped listing for `sub` with the given (id, score) posts. */
const listingFor = (sub: string, posts: [string, number][]) => ({
  kind: 'Listing',
  data: {
    children: posts.map(([id, score]) => ({
      kind: 't3',
      data: { id, subreddit: sub, title: id, selftext: '', score, num_comments: 1, created_utc: 1, permalink: `/r/${sub}/comments/${id}/t/` },
    })),
  },
});

function stubSource(listings: Record<string, unknown>, failFor: string[] = []) {
  const calls: string[] = [];
  const events: string[] = [];                                  // interleaved fetch/sleep timeline
  const args: { sub: string; timeframe: string; limit: number }[] = [];
  const source: RedditScoutSource = {
    fetchTopRaw: async (sub, timeframe, limit) => {
      calls.push(sub);
      events.push(`fetch:${sub}`);
      args.push({ sub, timeframe, limit });
      if (failFor.includes(sub)) throw new Error(`boom ${sub}`);
      return listings[sub] ?? listingFor(sub, []);
    },
    fetchCommentsRaw: async () => { throw new Error('scan must not fetch comments'); },
  };
  return { source, calls, events, args };
}

const okDeps = (over: Partial<Parameters<typeof runScan>[1]> = {}) => ({
  getSeenIds: async () => new Set<string>(),
  sleep: async () => {},
  subs: SUBS,
  sessionSize: 25,
  ...over,
});

describe('runScan — fetch discipline', () => {
  it('fetches every non-image sub in config order and NEVER the image subs', async () => {
    const { source, calls } = stubSource({});
    await runScan(source, okDeps());
    expect(calls).toEqual(['AskReddit', 'tifu', 'wouldyourather']);   // rareinsults absent
  });

  it('sleeps the politeness gap BETWEEN requests only — exact placement, not just count', async () => {
    const { source, events } = stubSource({});
    await runScan(source, okDeps({ sleep: async () => { events.push('sleep'); }, gapMs: 1234 }));
    // No gap before the first fetch, one between each pair, none after the last.
    expect(events).toEqual(['fetch:AskReddit', 'sleep', 'fetch:tifu', 'sleep', 'fetch:wouldyourather']);
  });

  it('the gap still applies around a FAILED sub (failure must not skip the politeness pause)', async () => {
    const { source, events } = stubSource({}, ['tifu']);
    await runScan(source, okDeps({ sleep: async () => { events.push('sleep'); } }));
    expect(events).toEqual(['fetch:AskReddit', 'sleep', 'fetch:tifu', 'sleep', 'fetch:wouldyourather']);
  });

  it('excludes an image sub even when it is FIRST in config (no active-filter/gap off-by-one)', async () => {
    const subsImageFirst: ScoutSubreddit[] = [
      { name: 'rareinsults', category: 'C', minScore: 1, image: true },
      { name: 'AskReddit', category: 'A', minScore: 1 },
      { name: 'tifu', category: 'B', minScore: 1 },
    ];
    const { source, events } = stubSource({});
    await runScan(source, okDeps({ subs: subsImageFirst, sleep: async () => { events.push('sleep'); } }));
    expect(events).toEqual(['fetch:AskReddit', 'sleep', 'fetch:tifu']);
  });

  it('passes the configured timeframe and postsPerSub through to the source', async () => {
    const { source, args } = stubSource({});
    await runScan(source, okDeps({ timeframe: 'month', postsPerSub: 77 }));
    expect(args.every(a => a.timeframe === 'month' && a.limit === 77)).toBe(true);
    expect(args).toHaveLength(3);
  });

  it('a failing sub is skipped and recorded; the OTHERS still land (never crash the scan)', async () => {
    const { source, calls } = stubSource(
      { AskReddit: listingFor('AskReddit', [['aaa', 9000]]), wouldyourather: listingFor('wouldyourather', [['ddd', 400]]) },
      ['tifu'],
    );
    const r = await runScan(source, okDeps());
    expect(calls).toEqual(['AskReddit', 'tifu', 'wouldyourather']);   // still attempted all three
    expect(r.failedSubs).toEqual(['tifu']);
    expect(r.candidates.map(c => c.id).sort()).toEqual(['aaa', 'ddd']);
    expect(r.stats.subsScanned).toBe(2);
  });
});

describe('runScan — filter funnel', () => {
  it('applies per-sub thresholds then the seen-filter, and reports the funnel stats', async () => {
    const { source } = stubSource({
      AskReddit: listingFor('AskReddit', [['big', 9000], ['small', 100]]),   // small < 5000 floor
      tifu: listingFor('tifu', [['seen1', 2000], ['fresh', 1500]]),
    });
    const r = await runScan(source, okDeps({ getSeenIds: async () => new Set(['seen1']) }));
    expect(r.candidates.map(c => c.id).sort()).toEqual(['big', 'fresh']);
    expect(r.stats).toEqual({ subsScanned: 3, fetched: 4, afterThresholds: 3, afterSeen: 2 });
  });

  it('caps the session at sessionSize', async () => {
    const { source } = stubSource({
      AskReddit: listingFor('AskReddit', [['a1', 9000], ['a2', 8000], ['a3', 7000]]),
      tifu: listingFor('tifu', [['b1', 2000], ['b2', 1900]]),
    });
    const r = await runScan(source, okDeps({ sessionSize: 2 }));
    expect(r.candidates).toHaveLength(2);
  });

  it('all listings empty → empty candidates with zeroed funnel, not an error', async () => {
    const { source } = stubSource({});
    const r = await runScan(source, okDeps());
    expect(r.candidates).toEqual([]);
    expect(r.stats).toEqual({ subsScanned: 3, fetched: 0, afterThresholds: 0, afterSeen: 0 });
  });
});

describe('runScan — the no-repeat guarantee under failure', () => {
  it('REJECTS when the ledger read fails — scanning blind would re-surface used posts (§3.4)', async () => {
    const { source } = stubSource({ AskReddit: listingFor('AskReddit', [['aaa', 9000]]) });
    await expect(
      runScan(source, okDeps({ getSeenIds: async () => { throw new Error('supabase down'); } })),
    ).rejects.toThrow('supabase down');
  });

  it('fails FAST on a broken ledger — before any Reddit fetch is spent (preflight read)', async () => {
    const { source, calls } = stubSource({ AskReddit: listingFor('AskReddit', [['aaa', 9000]]) });
    await runScan(source, okDeps({ getSeenIds: async () => { throw new Error('down'); } })).catch(() => {});
    expect(calls).toEqual([]);                                    // zero listings fetched
  });

  it('filters with a FRESH post-loop ledger read — a decision recorded mid-scan is honoured (§3.4)', async () => {
    const { source } = stubSource({ AskReddit: listingFor('AskReddit', [['aaa', 9000], ['bbb', 8000]]) });
    let reads = 0;
    // First (preflight) read: empty. Second (filtering) read: 'aaa' was decided while listings fetched.
    const r = await runScan(source, okDeps({ getSeenIds: async () => (++reads === 1 ? new Set() : new Set(['aaa'])) }));
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(r.candidates.map(c => c.id)).toEqual(['bbb']);         // aaa filtered by the SECOND read
  });

  it('never calls the comments endpoint during a scan (comments are fetched on demand later)', async () => {
    const { source } = stubSource({ AskReddit: listingFor('AskReddit', [['aaa', 9000]]) });
    await expect(runScan(source, okDeps())).resolves.toBeTruthy();    // stub throws if fetchCommentsRaw is hit
  });
});
