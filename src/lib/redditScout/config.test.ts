import { describe, it, expect } from 'vitest';
import {
  SCOUT_SUBREDDITS,
  SCOUT_TIMEFRAME,
  SCOUT_POSTS_PER_SUB,
  SCOUT_COMMENTS_PER_POST,
  SCOUT_SESSION_SIZE,
  SCOUT_LONG_STORY_SECONDS,
  SCOUT_REQUEST_GAP_MS,
} from './config';

// Config sanity: these tests catch list typos and nonsense knob values (the kind of edit mistake a
// "tune it in the config file" workflow invites), not implementation behaviour.

describe('SCOUT_SUBREDDITS list', () => {
  it('has no duplicate names (a dup would double-fetch and double-count a sub)', () => {
    const names = SCOUT_SUBREDDITS.map(s => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('names are bare (no r/ prefix, no slashes, no spaces) — they are spliced into /r/<name>/top.json', () => {
    for (const s of SCOUT_SUBREDDITS) {
      expect(s.name).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it('every sub has a valid category', () => {
    for (const s of SCOUT_SUBREDDITS) expect(['A', 'B', 'C', 'D']).toContain(s.category);
  });

  it('every minScore is a positive integer (0 would disable popularity filtering silently)', () => {
    for (const s of SCOUT_SUBREDDITS) {
      expect(Number.isInteger(s.minScore)).toBe(true);
      expect(s.minScore).toBeGreaterThan(0);
    }
  });

  it('covers all four categories (the interleaver assumes a spread to balance)', () => {
    const cats = new Set(SCOUT_SUBREDDITS.map(s => s.category));
    expect([...cats].sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('the requirements-mandated image subs are flagged image (excluded in v1)', () => {
    for (const name of ['rareinsults', 'BrandNewSentence']) {
      const sub = SCOUT_SUBREDDITS.find(s => s.name === name);
      expect(sub, `${name} missing from list`).toBeDefined();
      expect(sub!.image).toBe(true);
    }
  });

  it('at least one NON-image sub exists per category (else a category can never be surfaced in v1)', () => {
    for (const cat of ['A', 'B', 'C', 'D'] as const) {
      expect(SCOUT_SUBREDDITS.some(s => s.category === cat && !s.image)).toBe(true);
    }
  });
});

describe('scout knobs', () => {
  it('timeframe is one of Reddit’s accepted t= values', () => {
    expect(['hour', 'day', 'week', 'month', 'year', 'all']).toContain(SCOUT_TIMEFRAME);
  });

  it('counts are positive and sane', () => {
    expect(SCOUT_POSTS_PER_SUB).toBeGreaterThan(0);
    expect(SCOUT_POSTS_PER_SUB).toBeLessThanOrEqual(100);   // Reddit listings cap at 100 per request
    expect(SCOUT_COMMENTS_PER_POST).toBeGreaterThan(0);
    expect(SCOUT_SESSION_SIZE).toBeGreaterThan(0);
  });

  it('long-story threshold matches the Shorts ceiling model (≤180s — warning must not exceed the platform cap)', () => {
    expect(SCOUT_LONG_STORY_SECONDS).toBeGreaterThan(0);
    expect(SCOUT_LONG_STORY_SECONDS).toBeLessThanOrEqual(180);
  });

  it('request gap is a real politeness pause (≥500ms)', () => {
    expect(SCOUT_REQUEST_GAP_MS).toBeGreaterThanOrEqual(500);
  });
});
