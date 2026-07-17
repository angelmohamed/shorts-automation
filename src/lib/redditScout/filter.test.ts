import { describe, it, expect } from 'vitest';
import { filterUnseen, applyThresholds } from './filter';
import type { ScoutCandidate } from './types';
import type { ScoutSubreddit } from './config';

// Expectations derived from the spec (§3.4 no-repeat, §4.2 per-sub score, §4.3 safety), not from output.

const cand = (over: Partial<ScoutCandidate>): ScoutCandidate => ({
  id: 'x', subreddit: 'AskReddit', title: 't', body: '', score: 9999, numComments: 0, createdUtc: 0,
  over18: false, stickied: false, isImage: false, permalink: 'https://x', author: 'a', ...over,
});

describe('filterUnseen (the permanent no-repeat gate)', () => {
  it('removes candidates whose id is in the seen set, keeps the rest, preserves order', () => {
    const cs = [cand({ id: 'a' }), cand({ id: 'b' }), cand({ id: 'c' })];
    expect(filterUnseen(cs, new Set(['b'])).map(c => c.id)).toEqual(['a', 'c']);
  });
  it('empty seen set keeps everything; all-seen keeps nothing', () => {
    const cs = [cand({ id: 'a' }), cand({ id: 'b' })];
    expect(filterUnseen(cs, new Set()).map(c => c.id)).toEqual(['a', 'b']);
    expect(filterUnseen(cs, new Set(['a', 'b']))).toEqual([]);
  });
  it('empty candidate list → empty', () => {
    expect(filterUnseen([], new Set(['a']))).toEqual([]);
  });
  it('is exact-match (a seen id must not accidentally suppress a different id that contains it)', () => {
    const cs = [cand({ id: 'abc' }), cand({ id: 'ab' })];
    expect(filterUnseen(cs, new Set(['ab'])).map(c => c.id)).toEqual(['abc']);   // 'ab' seen, 'abc' is NOT
  });
});

describe('applyThresholds', () => {
  const subs: ScoutSubreddit[] = [
    { name: 'AskReddit', category: 'A', minScore: 5000 },       // huge sub, high floor
    { name: 'TwoSentenceHorror', category: 'C', minScore: 800 },// small sub, low floor
    { name: 'rareinsults', category: 'C', minScore: 1500, image: true },
  ];

  it('THE per-sub point: a small-sub post BELOW the big sub floor is kept; the same score in the big sub is dropped', () => {
    const cs = [
      cand({ id: 'small', subreddit: 'TwoSentenceHorror', score: 1200 }),  // ≥ its 800 floor → keep
      cand({ id: 'big',   subreddit: 'AskReddit',         score: 1200 }),  // < its 5000 floor → drop
    ];
    expect(applyThresholds(cs, subs, false).map(c => c.id)).toEqual(['small']);
  });

  it('score exactly at the floor is KEPT (drop is strictly below)', () => {
    expect(applyThresholds([cand({ subreddit: 'TwoSentenceHorror', score: 800 })], subs, false)).toHaveLength(1);
    expect(applyThresholds([cand({ subreddit: 'TwoSentenceHorror', score: 799 })], subs, false)).toHaveLength(0);
  });

  it('drops image subs entirely AND stray image posts in a non-image sub', () => {
    const cs = [
      cand({ id: 'imgsub', subreddit: 'rareinsults', score: 9999 }),                 // sub.image → drop
      cand({ id: 'strayimg', subreddit: 'AskReddit', score: 9999, isImage: true }),  // c.isImage → drop
      cand({ id: 'text', subreddit: 'AskReddit', score: 9999 }),                     // keep
    ];
    expect(applyThresholds(cs, subs, false).map(c => c.id)).toEqual(['text']);
  });

  it('drops stickied posts regardless of score', () => {
    expect(applyThresholds([cand({ score: 9_000_000, stickied: true })], subs, false)).toHaveLength(0);
  });

  it('NSFW: dropped by default, kept when includeNsfw is true', () => {
    const nsfw = [cand({ over18: true, score: 9999 })];
    expect(applyThresholds(nsfw, subs, false)).toHaveLength(0);
    expect(applyThresholds(nsfw, subs, true)).toHaveLength(1);
  });

  it('matches the sub name case-insensitively (Reddit sub names vary in case across urls/api)', () => {
    expect(applyThresholds([cand({ subreddit: 'askreddit', score: 9999 })], subs, false)).toHaveLength(1);
  });

  it('drops candidates whose subreddit is not in the config (defensive — never surface an unconfigured sub)', () => {
    expect(applyThresholds([cand({ subreddit: 'SomeRandomSub', score: 9999 })], subs, false)).toHaveLength(0);
  });

  it('preserves input order of the survivors', () => {
    const cs = [
      cand({ id: '1', subreddit: 'AskReddit', score: 6000 }),
      cand({ id: '2', subreddit: 'AskReddit', score: 100 }),      // dropped
      cand({ id: '3', subreddit: 'TwoSentenceHorror', score: 900 }),
    ];
    expect(applyThresholds(cs, subs, false).map(c => c.id)).toEqual(['1', '3']);
  });
});
