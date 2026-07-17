import { describe, it, expect } from 'vitest';
import { sanitizeDecisionFeatures, MAX_BODY_CHARS } from './features';

// Expectations from the spec of the training row (verified facts: Reddit selftext caps at 40,000 chars;
// scores CAN be negative; category comes from config server-side, never the client) — the sanitizer must
// never let junk into the ledger nor drop legitimate values.

describe('sanitizeDecisionFeatures', () => {
  it('passes through a normal candidate', () => {
    expect(sanitizeDecisionFeatures({ body: 'story', score: 1234, numComments: 56, createdUtc: 1_700_000_000 }, 'B'))
      .toEqual({ body: 'story', score: 1234, numComments: 56, createdUtc: 1_700_000_000, category: 'B' });
  });

  it('clamps body to Reddit’s 40k ceiling and drops empty/non-string bodies', () => {
    const huge = 'x'.repeat(MAX_BODY_CHARS + 500);
    expect(sanitizeDecisionFeatures({ body: huge }, undefined)!.body).toHaveLength(MAX_BODY_CHARS);
    expect(sanitizeDecisionFeatures({ body: '' }, 'A')).toEqual({ category: 'A' });
    expect(sanitizeDecisionFeatures({ body: 42 }, 'A')).toEqual({ category: 'A' });
  });

  it('keeps NEGATIVE scores (downvoted posts are legal, and a informative label context)', () => {
    expect(sanitizeDecisionFeatures({ score: -17 }, undefined)).toEqual({ score: -17 });
  });

  it('floors floats and drops NaN/Infinity/junk numerics', () => {
    expect(sanitizeDecisionFeatures({ score: 12.9, numComments: 3.7, createdUtc: 1.5e9 }, undefined))
      .toEqual({ score: 12, numComments: 3, createdUtc: 1_500_000_000 });
    expect(sanitizeDecisionFeatures({ score: NaN, numComments: Infinity, createdUtc: 'zzz' }, undefined)).toBeUndefined();
  });

  it('rejects negative comment counts and non-positive timestamps', () => {
    expect(sanitizeDecisionFeatures({ numComments: -5, createdUtc: 0 }, undefined)).toBeUndefined();
  });

  it('category comes only from the server-side arg — never invented, absent stays absent', () => {
    expect(sanitizeDecisionFeatures({}, 'C')).toEqual({ category: 'C' });
    expect(sanitizeDecisionFeatures({ category: 'FAKE-CLIENT-VALUE' }, undefined)).toBeUndefined();
  });

  it('returns undefined (not {}) when nothing survives — so mark-used keeps its no-clobber write path', () => {
    expect(sanitizeDecisionFeatures({}, undefined)).toBeUndefined();
  });
});
