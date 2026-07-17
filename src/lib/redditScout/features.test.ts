import { describe, it, expect } from 'vitest';
import { sanitizeDecisionFeatures, cleanText, MAX_BODY_CHARS, MAX_TITLE_CHARS } from './features';

// Expectations from verified facts (Reddit selftext caps at 40,000 chars, titles at 300; scores CAN be
// negative; Postgres text rejects lone UTF-16 surrogates and U+0000 — a poisoned string would 500 the
// ledger write and leave the post permanently undecidable) and from the no-fabrication rule: JSON junk
// must become ABSENT, never a fake value (Number(null)=0 would mint a bogus "0 upvotes" training row).

describe('cleanText (Postgres-safe strings)', () => {
  it('caps length', () => {
    expect(cleanText('x'.repeat(MAX_BODY_CHARS + 999), MAX_BODY_CHARS)).toHaveLength(MAX_BODY_CHARS);
    expect(cleanText('abc', 300)).toBe('abc');
  });

  it('a cap that bisects an astral emoji leaves NO lone surrogate (Postgres would reject the write)', () => {
    // '💀' is two UTF-16 units; cap 3 slices through the second emoji → lone high surrogate.
    const sliced = cleanText('💀💀', 3);
    expect(sliced.isWellFormed()).toBe(true);
    expect(sliced).toBe('💀�');   // toWellFormed maps the orphan to the replacement char
  });

  it('strips U+0000 (fatal to Postgres text columns)', () => {
    expect(cleanText('a\u0000b\u0000', 100)).toBe('ab');
  });

  it('non-strings become empty, never coerced', () => {
    expect(cleanText(42, 100)).toBe('');
    expect(cleanText(null, 100)).toBe('');
    expect(cleanText(['x'], 100)).toBe('');
  });
});

describe('sanitizeDecisionFeatures', () => {
  it('passes through a normal candidate', () => {
    expect(sanitizeDecisionFeatures({ body: 'story', score: 1234, numComments: 56, createdUtc: 1_700_000_000 }, 'B'))
      .toEqual({ body: 'story', score: 1234, numComments: 56, createdUtc: 1_700_000_000, category: 'B' });
  });

  it('clamps body to Reddit’s 40k ceiling and drops empty/non-string bodies', () => {
    expect(sanitizeDecisionFeatures({ body: 'x'.repeat(MAX_BODY_CHARS + 500) }, undefined)!.body).toHaveLength(MAX_BODY_CHARS);
    expect(sanitizeDecisionFeatures({ body: '' }, 'A')).toEqual({ category: 'A' });
    expect(sanitizeDecisionFeatures({ body: 42 }, 'A')).toEqual({ category: 'A' });
  });

  it('a body that is ONLY NULs scrubs to absent, not an empty-string row', () => {
    expect(sanitizeDecisionFeatures({ body: '\u0000\u0000' }, undefined)).toBeUndefined();
  });

  it('keeps NEGATIVE scores (downvoted posts are legal)', () => {
    expect(sanitizeDecisionFeatures({ score: -17 }, undefined)).toEqual({ score: -17 });
  });

  it('NO FABRICATION: null/true/[]/"" junk becomes absent — never 0/1/7', () => {
    expect(sanitizeDecisionFeatures({ score: null, numComments: true, createdUtc: '' }, undefined)).toBeUndefined();
    expect(sanitizeDecisionFeatures({ score: [7] }, undefined)).toBeUndefined();
    expect(sanitizeDecisionFeatures({ score: '123' }, undefined)).toBeUndefined();   // strict: no string coercion
  });

  it('floors floats; drops NaN/Infinity', () => {
    expect(sanitizeDecisionFeatures({ score: 12.9, numComments: 3.7, createdUtc: 1.5e9 }, undefined))
      .toEqual({ score: 12, numComments: 3, createdUtc: 1_500_000_000 });
    expect(sanitizeDecisionFeatures({ score: NaN, numComments: Infinity }, undefined)).toBeUndefined();
  });

  it('range-clamps: int4 overflow, negative comment counts, epoch-MILLISECOND timestamps all dropped', () => {
    expect(sanitizeDecisionFeatures({ score: 3e9 }, undefined)).toBeUndefined();           // > int4
    expect(sanitizeDecisionFeatures({ numComments: -5 }, undefined)).toBeUndefined();
    expect(sanitizeDecisionFeatures({ createdUtc: 0 }, undefined)).toBeUndefined();
    expect(sanitizeDecisionFeatures({ createdUtc: 1_784_300_000_000 }, undefined)).toBeUndefined();   // ms, not s
  });

  it('category comes only from the server-side arg — never invented, absent stays absent', () => {
    expect(sanitizeDecisionFeatures({}, 'C')).toEqual({ category: 'C' });
    expect(sanitizeDecisionFeatures({ category: 'FAKE-CLIENT-VALUE' }, undefined)).toBeUndefined();
  });

  it('returns undefined (not {}) when nothing survives — so mark-used keeps its no-clobber write path', () => {
    expect(sanitizeDecisionFeatures({}, undefined)).toBeUndefined();
  });
});

describe('constants', () => {
  it('title cap matches Reddit’s 300-char limit', () => {
    expect(MAX_TITLE_CHARS).toBe(300);
  });
});
