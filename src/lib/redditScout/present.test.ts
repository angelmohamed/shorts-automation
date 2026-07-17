import { describe, it, expect } from 'vitest';
import { fmtAge, isLongStory } from './present';
import { SCOUT_LONG_STORY_SECONDS } from './config';
import { EST_CHARS_PER_SEC, NARRATION_TAIL_PAD_S } from '@/lib/reelDuration';

// Expectations derived by hand from the unit boundaries (60m, 24h, 7d) and the estimate model
// (chars / (CPS·speed) + tail) — not from implementation output.

describe('fmtAge', () => {
  const now = 1_800_000_000;
  it('minutes under an hour, hours under a day, days under a week, then weeks', () => {
    expect(fmtAge(now - 45 * 60, now)).toBe('45m');
    expect(fmtAge(now - 59 * 60, now)).toBe('59m');
    expect(fmtAge(now - 60 * 60, now)).toBe('1h');           // exactly one hour → hours unit
    expect(fmtAge(now - 23 * 3600, now)).toBe('23h');
    expect(fmtAge(now - 24 * 3600, now)).toBe('1d');         // exactly one day → days unit
    expect(fmtAge(now - 6 * 86400, now)).toBe('6d');
    expect(fmtAge(now - 7 * 86400, now)).toBe('1w');         // exactly one week → weeks unit
    expect(fmtAge(now - 21 * 86400, now)).toBe('3w');
  });
  it('clamps future/skewed timestamps to 0m (never negative)', () => {
    expect(fmtAge(now + 999, now)).toBe('0m');
  });
});

describe('isLongStory', () => {
  // Boundary from first principles: seconds = chars/(CPS·1) + pad > LIMIT  ⇔  chars > (LIMIT − pad)·CPS.
  const limitChars = (SCOUT_LONG_STORY_SECONDS - NARRATION_TAIL_PAD_S) * EST_CHARS_PER_SEC;

  it('flags a body pushing the estimate past the Shorts ceiling', () => {
    const title = 'T';
    const body = 'x'.repeat(limitChars);                     // title+space pushes chars past the boundary
    expect(isLongStory({ title, body })).toBe(true);
  });
  it('does not flag a comfortably short story', () => {
    expect(isLongStory({ title: 'TIFU', body: 'short story here' })).toBe(false);
  });
  it('never flags a body-less post, no matter how long the title (the flag is for story POSTS)', () => {
    expect(isLongStory({ title: 'q'.repeat(10_000), body: '' })).toBe(false);
    expect(isLongStory({ title: 'q'.repeat(10_000), body: '   ' })).toBe(false);
  });
});
