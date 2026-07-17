import { describe, it, expect } from 'vitest';
import { assembleSession, compareCandidates } from './rank';
import type { ScoutCandidate } from './types';
import type { ScoutSubreddit } from './config';

// Expectations derived from the spec (§4.5: best-first by popularity, interleaved "so no single SUB
// dominates", capped per session) and the standard round-robin diversity re-ranker applied
// hierarchically (categories rotate; subs rotate WITHIN a category; best-first within each sub;
// exhausted queues skipped) — never from the implementation's own output.

const SUBS: ScoutSubreddit[] = [
  { name: 'AskReddit', category: 'A', minScore: 1 },
  { name: 'TooAfraidToAsk', category: 'A', minScore: 1 },
  { name: 'tifu', category: 'B', minScore: 1 },
  { name: 'Showerthoughts', category: 'C', minScore: 1 },
  { name: 'wouldyourather', category: 'D', minScore: 1 },
];

const cand = (id: string, subreddit: string, score: number, createdUtc = 0): ScoutCandidate => ({
  id, subreddit, title: id, body: '', score, numComments: 0, createdUtc,
  over18: false, stickied: false, isImage: false, permalink: 'https://x/' + id, author: 'a',
});

describe('compareCandidates (deterministic order)', () => {
  it('higher score first', () => {
    expect(compareCandidates(cand('a', 'tifu', 100), cand('b', 'tifu', 200))).toBeGreaterThan(0);
  });
  it('equal score → newer (higher createdUtc) first', () => {
    expect(compareCandidates(cand('a', 'tifu', 100, 5), cand('b', 'tifu', 100, 9))).toBeGreaterThan(0);
  });
  it('equal score + age → id ascending (total order: NO pair compares equal unless identical id)', () => {
    expect(compareCandidates(cand('aaa', 'tifu', 100, 5), cand('bbb', 'tifu', 100, 5))).toBeLessThan(0);
    expect(compareCandidates(cand('aaa', 'tifu', 100, 5), cand('aaa', 'tifu', 100, 5))).toBe(0);
  });
});

describe('assembleSession — round-robin interleave', () => {
  it('rotates A→B→C→D taking each category’s best, then each second-best', () => {
    const cs = [
      cand('a1', 'AskReddit', 900), cand('a2', 'AskReddit', 800),
      cand('b1', 'tifu', 500), cand('b2', 'tifu', 400),
      cand('c1', 'Showerthoughts', 90), cand('c2', 'Showerthoughts', 80),
      cand('d1', 'wouldyourather', 9), cand('d2', 'wouldyourather', 8),
    ];
    expect(assembleSession(cs, SUBS, 25).map(c => c.id))
      .toEqual(['a1', 'b1', 'c1', 'd1', 'a2', 'b2', 'c2', 'd2']);
  });

  it('THE point of interleaving: a low-scoring small-category post outranks a mid AskReddit post in session position', () => {
    const cs = [
      cand('a1', 'AskReddit', 90000), cand('a2', 'AskReddit', 80000), cand('a3', 'AskReddit', 70000),
      cand('d1', 'wouldyourather', 350),
    ];
    const ids = assembleSession(cs, SUBS, 25).map(c => c.id);
    expect(ids).toContain('d1');   // guard: indexOf would return -1 if d1 were dropped, passing vacuously
    expect(ids.indexOf('d1')).toBeLessThan(ids.indexOf('a2'));   // d1 (350) is surfaced before the 80k A post
  });

  it('skips exhausted categories and keeps rotating among the rest', () => {
    const cs = [
      cand('a1', 'AskReddit', 900), cand('a2', 'AskReddit', 800), cand('a3', 'AskReddit', 700),
      cand('b1', 'tifu', 500),
      cand('d1', 'wouldyourather', 9), cand('d2', 'wouldyourather', 8),
    ];
    // Round 1: a1, b1, (C empty), d1 · Round 2: a2, (B done), d2 · Round 3: a3
    expect(assembleSession(cs, SUBS, 25).map(c => c.id)).toEqual(['a1', 'b1', 'd1', 'a2', 'd2', 'a3']);
  });

  it('subs within a category rotate too, with the category’s best candidate leading its first slot', () => {
    const cs = [
      cand('ask', 'AskReddit', 500),
      cand('tata', 'TooAfraidToAsk', 900),      // category A's best → leads A's rotation
      cand('b1', 'tifu', 100),
    ];
    // A turn 1 = TATA's head (best in category) · B turn = b1 · A turn 2 rotates to AskReddit.
    expect(assembleSession(cs, SUBS, 25).map(c => c.id)).toEqual(['tata', 'b1', 'ask']);
  });

  it('SUB-level fairness (§4.5 "no single sub dominates"): a giant sub cannot monopolise its category', () => {
    const cs = [
      cand('ask1', 'AskReddit', 90000), cand('ask2', 'AskReddit', 80000),   // AskReddit scores dwarf TATA's
      cand('tata1', 'TooAfraidToAsk', 100),
    ];
    // Merged-by-raw-score would give A's slots as ask1, ask2, tata1 — the exact dominance §4.5 forbids.
    // Nested rotation: A turn 1 = ask1 (best overall), A turn 2 rotates to TATA, A turn 3 back to AskReddit.
    expect(assembleSession(cs, SUBS, 25).map(c => c.id)).toEqual(['ask1', 'tata1', 'ask2']);
  });

  it('back-fills to the cap from deep categories once shallow ones exhaust (no per-category quota)', () => {
    const cs = [
      cand('a1', 'AskReddit', 900), cand('a2', 'AskReddit', 800),
      cand('a3', 'AskReddit', 700), cand('a4', 'AskReddit', 600),
      cand('b1', 'tifu', 500),
    ];
    // Round 1: a1, b1 (C/D empty) · then A back-fills a2, a3 until the cap of 4 binds (a4 excluded).
    // A fair-share-quota mutant (max ceil(size/4) per category, no back-fill) would return only [a1, b1].
    expect(assembleSession(cs, SUBS, 4).map(c => c.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('caps at sessionSize mid-rotation', () => {
    const cs = [
      cand('a1', 'AskReddit', 900), cand('b1', 'tifu', 500),
      cand('c1', 'Showerthoughts', 90), cand('d1', 'wouldyourather', 9),
    ];
    expect(assembleSession(cs, SUBS, 3).map(c => c.id)).toEqual(['a1', 'b1', 'c1']);
  });

  it('no-dominance property: cap 8 with deep categories → exactly 2 per category', () => {
    const cs = ['A', 'B', 'C', 'D'].flatMap((cat, ci) => {
      const sub = ['AskReddit', 'tifu', 'Showerthoughts', 'wouldyourather'][ci];
      return [0, 1, 2, 3].map(i => cand(`${cat}${i}`, sub, 1000 - i));
    });
    const out = assembleSession(cs, SUBS, 8);
    const perCat = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>;
    for (const c of out) perCat[SUBS.find(s => s.name === c.subreddit)!.category]++;
    expect(perCat).toEqual({ A: 2, B: 2, C: 2, D: 2 });
  });

  it('returns everything (interleaved) when fewer candidates than the cap', () => {
    const cs = [cand('a1', 'AskReddit', 1), cand('b1', 'tifu', 2)];
    expect(assembleSession(cs, SUBS, 25)).toHaveLength(2);
  });

  it('empty input → []; sessionSize 0 or negative → []', () => {
    expect(assembleSession([], SUBS, 25)).toEqual([]);
    expect(assembleSession([cand('a1', 'AskReddit', 1)], SUBS, 0)).toEqual([]);
    expect(assembleSession([cand('a1', 'AskReddit', 1)], SUBS, -5)).toEqual([]);
  });

  it('drops candidates from unconfigured subs (defensive) and matches sub names case-insensitively', () => {
    const cs = [cand('x', 'NotConfigured', 9999), cand('a1', 'askreddit', 100)];
    expect(assembleSession(cs, SUBS, 25).map(c => c.id)).toEqual(['a1']);
  });

  it('does not mutate the input array (callers reuse the filtered candidate list)', () => {
    const cs = [cand('a2', 'AskReddit', 800), cand('a1', 'AskReddit', 900)];
    const before = cs.map(c => c.id);
    assembleSession(cs, SUBS, 25);
    expect(cs.map(c => c.id)).toEqual(before);
  });

  it('deterministic under equal scores: ties broken by recency then id, independent of input order', () => {
    const x = cand('xx', 'AskReddit', 500, 10);
    const y = cand('yy', 'AskReddit', 500, 10);    // same score+age → id asc: xx first
    const z = cand('zz', 'AskReddit', 500, 99);    // newer → first of the three
    expect(assembleSession([y, x, z], SUBS, 25).map(c => c.id)).toEqual(['zz', 'xx', 'yy']);
    expect(assembleSession([z, x, y], SUBS, 25).map(c => c.id)).toEqual(['zz', 'xx', 'yy']);
  });
});
