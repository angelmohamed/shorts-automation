import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_TRACKS,
  DEFAULT_MUSIC_ID,
  DEFAULT_MUSIC_VOLUME,
  resolveMusicId,
  trackById,
  trackStreamSrc,
  type BackgroundTrack,
} from './music';

// -----------------------------------------------------------------------------
// Expectations here are derived from the module's documented spec (the JSDoc on
// resolveMusicId), from how the pipeline count consumes it (src/lib/pipelineStatus.ts
// line 26: `resolveMusicId(...) !== null` decides "has music"), and from the
// WEB-VERIFIED semantics of encodeURIComponent (MDN: escapes everything except
// A-Z a-z 0-9 - _ . ! ~ * ' ( ) ; ":" -> %3A, "/" -> %2F, " " -> %20, "&" -> %26).
// Nothing here is copied from the implementation's output.
// -----------------------------------------------------------------------------

describe('DEFAULT_MUSIC_VOLUME', () => {
  it('is exactly 0.05 (the documented default bed gain)', () => {
    expect(DEFAULT_MUSIC_VOLUME).toBe(0.05);
  });

  it('is a music-bed gain quieter than the narration (which plays at 1)', () => {
    // Spec: "Default music-bed volume relative to narration (which plays at 1)".
    // A bed must be > 0 (audible) and < 1 (quieter than the voice it sits under).
    expect(typeof DEFAULT_MUSIC_VOLUME).toBe('number');
    expect(Number.isFinite(DEFAULT_MUSIC_VOLUME)).toBe(true);
    expect(DEFAULT_MUSIC_VOLUME).toBeGreaterThan(0);
    expect(DEFAULT_MUSIC_VOLUME).toBeLessThan(1);
  });
});

describe('BACKGROUND_TRACKS shape', () => {
  it('is a non-empty array (a library with zero tracks would break the default)', () => {
    expect(Array.isArray(BACKGROUND_TRACKS)).toBe(true);
    expect(BACKGROUND_TRACKS.length).toBeGreaterThan(0);
  });

  it('every track has a non-empty id, name, and url', () => {
    for (const t of BACKGROUND_TRACKS) {
      expect(typeof t.id).toBe('string');
      expect(t.id.trim().length).toBeGreaterThan(0);
      expect(typeof t.name).toBe('string');
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(typeof t.url).toBe('string');
      expect(t.url.trim().length).toBeGreaterThan(0);
    }
  });

  it('has unique ids (a dup id would make trackById ambiguous / silently pick the first)', () => {
    const ids = BACKGROUND_TRACKS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique urls', () => {
    const urls = BACKGROUND_TRACKS.map(t => t.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every url is an absolute http(s) URL (it is fed to encodeURIComponent + <audio>)', () => {
    for (const t of BACKGROUND_TRACKS) {
      expect(t.url).toMatch(/^https?:\/\//);
      // must parse as a real URL
      expect(() => new URL(t.url)).not.toThrow();
    }
  });
});

describe('DEFAULT_MUSIC_ID', () => {
  it('is the id of the first library entry', () => {
    // Spec: "Track new reels start with (first library entry)."
    expect(DEFAULT_MUSIC_ID).toBe(BACKGROUND_TRACKS[0].id);
  });

  it('current value is the elevator-music track', () => {
    expect(DEFAULT_MUSIC_ID).toBe('elevator-music');
  });

  it('resolves to a track that ACTUALLY EXISTS in the library (else the default is dead)', () => {
    // Core invariant: whatever the default points at must be a real, playable track.
    expect(DEFAULT_MUSIC_ID).not.toBeNull();
    expect(trackById(DEFAULT_MUSIC_ID)).not.toBeNull();
    expect(trackById(DEFAULT_MUSIC_ID)?.id).toBe(DEFAULT_MUSIC_ID);
  });
});

describe('resolveMusicId — the three documented cases', () => {
  it('undefined (never set) -> the DEFAULT track', () => {
    // Spec: "undefined = never set -> the default track".
    expect(resolveMusicId(undefined)).toBe(DEFAULT_MUSIC_ID);
  });

  it("empty string (explicit 'No music') -> null", () => {
    // Spec: "'' = the user explicitly chose 'No music'." -> effective track is null.
    expect(resolveMusicId('')).toBeNull();
  });

  it('a valid stored id -> that same id (identity for real tracks)', () => {
    expect(resolveMusicId('elevator-music')).toBe('elevator-music');
    for (const t of BACKGROUND_TRACKS) {
      expect(resolveMusicId(t.id)).toBe(t.id);
    }
  });

  it('resolving the default id is stable (default -> default, not null)', () => {
    // DEFAULT_MUSIC_ID is a non-empty string, so it must round-trip through resolve.
    expect(resolveMusicId(DEFAULT_MUSIC_ID as string)).toBe(DEFAULT_MUSIC_ID);
  });

  it('the resolved undefined value maps to a real, playable track', () => {
    const eff = resolveMusicId(undefined);
    expect(eff).not.toBeNull();
    expect(trackById(eff)).not.toBeNull();
  });
});

describe('resolveMusicId — adversarial / edge inputs', () => {
  it('undefined and empty-string are NOT interchangeable (default vs. no-music)', () => {
    // The whole point of the undefined/'' split: they must diverge.
    expect(resolveMusicId(undefined)).not.toBe(resolveMusicId(''));
    expect(resolveMusicId(undefined)).not.toBeNull();
    expect(resolveMusicId('')).toBeNull();
  });

  it('null is treated as "no music" (null !== undefined), NOT as the default', () => {
    // Type says string | undefined, but persisted JSON could yield null. `===` is strict,
    // so null misses the undefined branch and falls to `stored || null` -> null.
    // Documents the asymmetry: undefined -> default, but null -> null.
    expect(resolveMusicId(null as unknown as undefined)).toBeNull();
    expect(resolveMusicId(null as unknown as undefined)).not.toBe(DEFAULT_MUSIC_ID);
  });

  it('a whitespace-only id is truthy, so it passes through unchanged (documents current behavior)', () => {
    // '   ' is a truthy string -> `stored || null` returns it verbatim; it is NOT
    // coerced to null even though it is not a real "No music" choice.
    expect(resolveMusicId('   ')).toBe('   ');
  });

  it('an UNKNOWN id is passed through verbatim WITHOUT library validation (documents current behavior)', () => {
    // resolveMusicId does not check BACKGROUND_TRACKS; any non-empty string returns as-is.
    expect(resolveMusicId('no-such-track')).toBe('no-such-track');
    expect(resolveMusicId('ELEVATOR-MUSIC')).toBe('ELEVATOR-MUSIC'); // case-sensitive, no normalization
  });

  it('CONSISTENCY GAP: an unknown id resolves non-null yet maps to no track', () => {
    // This is the risky consequence of the no-validation pass-through:
    // pipelineStatus counts "has music" as (resolveMusicId(x) !== null), so a reel
    // holding a stale/removed id is COUNTED as having music, while trackById(x) is
    // null and no audio can actually play. Documented here as a factual mismatch.
    const stale = 'removed-track-id';
    expect(resolveMusicId(stale)).not.toBeNull(); // counted as "has music"
    expect(trackById(stale)).toBeNull();          // ...but nothing to play
  });

  it('preserves unicode / emoji ids verbatim (no trimming or normalization)', () => {
    expect(resolveMusicId('lo-fi été')).toBe('lo-fi été');
    expect(resolveMusicId('🎵')).toBe('🎵');
  });
});

describe('pipeline "has music" predicate (resolveMusicId(x) !== null)', () => {
  // Mirrors src/lib/pipelineStatus.ts:26 so the count semantics are pinned down.
  const hasMusic = (stored: string | undefined) => resolveMusicId(stored) !== null;

  it('unset (undefined) counts as HAS MUSIC (plays default track)', () => {
    expect(hasMusic(undefined)).toBe(true);
  });

  it("explicit '' counts as NO MUSIC", () => {
    expect(hasMusic('')).toBe(false);
  });

  it('a valid id counts as HAS MUSIC', () => {
    expect(hasMusic('elevator-music')).toBe(true);
  });
});

describe('trackById', () => {
  it('returns the exact track object for a known id', () => {
    const first = BACKGROUND_TRACKS[0];
    expect(trackById(first.id)).toBe(first); // reference identity, not a copy
  });

  it('round-trips every library id to its own track', () => {
    for (const t of BACKGROUND_TRACKS) {
      expect(trackById(t.id)).toBe(t);
    }
  });

  it('returns null for an unknown id', () => {
    expect(trackById('nope-not-here')).toBeNull();
  });

  it('returns null for undefined, null, and empty string', () => {
    expect(trackById(undefined)).toBeNull();
    expect(trackById(null)).toBeNull();
    expect(trackById('')).toBeNull();
  });

  it('is case-sensitive (ids are exact-match, no normalization)', () => {
    expect(trackById('ELEVATOR-MUSIC')).toBeNull();
  });
});

describe('trackStreamSrc — proxied, percent-encoded stream URL', () => {
  it('routes through the same-origin proxy with stream=1', () => {
    const t = BACKGROUND_TRACKS[0];
    expect(trackStreamSrc(t)).toMatch(/^\/api\/proxy\?stream=1&url=/);
  });

  it('percent-encodes a synthetic url exactly per encodeURIComponent rules (web-verified)', () => {
    // WEB-VERIFIED (MDN): ":" -> %3A, "/" -> %2F, " " -> %20, "&" -> %26; dots stay.
    const t: BackgroundTrack = { id: 'x', name: 'X', url: 'https://cdn.example.com/a b&c.mp3' };
    expect(trackStreamSrc(t)).toBe(
      '/api/proxy?stream=1&url=https%3A%2F%2Fcdn.example.com%2Fa%20b%26c.mp3',
    );
  });

  it('encodes the real elevator-music url to the expected literal', () => {
    // Hand-encoded from first principles; hyphens and dots are left intact.
    const t = trackById('elevator-music');
    expect(t).not.toBeNull();
    expect(trackStreamSrc(t as BackgroundTrack)).toBe(
      '/api/proxy?stream=1&url=https%3A%2F%2Fpub-63dabe78ed9342c5a94e50b584141711.r2.dev%2Fmusic%2Felevator-music.mp3',
    );
  });

  it("the encoded 'url' param decodes back to the track's original url (independent round-trip)", () => {
    // URLSearchParams decoding is independent of encodeURIComponent, so this catches
    // encoding bugs without reusing the same function.
    for (const t of BACKGROUND_TRACKS) {
      const src = trackStreamSrc(t);
      const params = new URLSearchParams(src.slice(src.indexOf('?') + 1));
      expect(params.get('stream')).toBe('1');
      expect(params.get('url')).toBe(t.url);
    }
  });

  it('does not leave a raw "://" in the output (proof the colon/slashes were encoded)', () => {
    const src = trackStreamSrc(BACKGROUND_TRACKS[0]);
    const afterPrefix = src.slice('/api/proxy?stream=1&url='.length);
    expect(afterPrefix).not.toContain('://');
    expect(afterPrefix).toContain('%3A%2F%2F');
  });
});
