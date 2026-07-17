import { describe, it, expect } from 'vitest';
import { remainingBufferAfterBuild, buildOutcomeNotice } from './buffer';

// Expectations derived from the invariants (REQUIREMENTS §4.7 + the Phase-6 review's B1/B2):
// consumed = the FIRST `built` snapshot entries (addReels consumes the prefix, truncates at the cap);
// cap-truncated entries STAY buffered (else: used-marked posts orphaned); built entries LEAVE the buffer
// even on a retry (else: duplicate reels); mid-build additions survive.

const E = (id: string) => ({ candidate: { id } });
const idOf = (e: { candidate: { id: string } }) => e.candidate.id;

describe('remainingBufferAfterBuild', () => {
  const snapshot = ['a', 'b', 'c', 'd'];

  it('full build consumes everything', () => {
    expect(remainingBufferAfterBuild(snapshot.map(E), snapshot, 4, idOf)).toEqual([]);
  });

  it('CAP TRUNCATION: only the built prefix leaves; the surplus stays buffered (no orphaned used-posts)', () => {
    const out = remainingBufferAfterBuild(snapshot.map(E), snapshot, 2, idOf);
    expect(out.map(idOf)).toEqual(['c', 'd']);
  });

  it('zero built (grid already full) keeps the whole buffer', () => {
    expect(remainingBufferAfterBuild(snapshot.map(E), snapshot, 0, idOf).map(idOf)).toEqual(snapshot);
  });

  it('an entry added MID-BUILD (in prev, not in the snapshot) always survives', () => {
    const prev = [...snapshot.map(E), E('fresh')];
    const out = remainingBufferAfterBuild(prev, snapshot, 4, idOf);
    expect(out.map(idOf)).toEqual(['fresh']);
  });

  it('a failed-card reel still counts as consumed — retrying must NOT rebuild it (duplicate reel)', () => {
    // built=4 includes reels whose card render failed; all four leave the buffer regardless.
    const out = remainingBufferAfterBuild(snapshot.map(E), snapshot, 4, idOf);
    expect(out).toEqual([]);
  });

  it('negative/garbage built clamps to consuming nothing', () => {
    expect(remainingBufferAfterBuild(snapshot.map(E), snapshot, -3, idOf).map(idOf)).toEqual(snapshot);
  });
});

describe('buildOutcomeNotice', () => {
  it('null on a clean full build (panel closes silently)', () => {
    expect(buildOutcomeNotice(5, 5, 0, 50)).toBeNull();
  });
  it('reports cap truncation with the still-buffered reassurance', () => {
    expect(buildOutcomeNotice(5, 3, 0, 50)).toMatch(/2 approved posts didn't fit the 50-reel cap — still buffered/);
  });
  it('reports failed cards with the reel-exists hint', () => {
    expect(buildOutcomeNotice(5, 5, 2, 50)).toMatch(/2 cards failed to render/);
  });
  it('combines both, singular forms correct', () => {
    const n = buildOutcomeNotice(5, 4, 1, 50)!;
    expect(n).toMatch(/1 approved post didn't fit/);
    expect(n).toMatch(/1 card failed/);
  });
});
