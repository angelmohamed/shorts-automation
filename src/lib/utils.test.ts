import { describe, it, expect } from 'vitest';
import { proxyStreamUrl, bestVideoUrl, clampZoom, fmtTime } from './utils';

/**
 * Expectations here are derived from first principles / specs, NOT copied from the
 * implementation's output:
 *  - encodeURIComponent escaping set: ECMAScript / MDN — leaves A-Z a-z 0-9 - _ . ! ~ * ' ( )
 *    unescaped; escapes reserved chars (: / ? & = space #, etc). Verified via MDN + Node.
 *  - M:SS convention: minutes with NO leading zero, seconds zero-padded to 2 digits, seconds 0-59.
 *  - YouTube Shorts max length = 180s (3:00).
 *  - Math.min/Math.max propagate NaN and treat +/-Infinity as the extremes (ECMAScript spec).
 */

const PREFIX = '/api/proxy?stream=1&url=';

describe('proxyStreamUrl', () => {
  it('uses the exact proxy prefix and percent-encodes the url param', () => {
    // encodeURIComponent("https://ex.com/v.mp4") -> https%3A%2F%2Fex.com%2Fv.mp4
    expect(proxyStreamUrl('https://ex.com/v.mp4')).toBe(
      `${PREFIX}https%3A%2F%2Fex.com%2Fv.mp4`,
    );
  });

  it('escapes each reserved character exactly per encodeURIComponent', () => {
    // These escapes are the whole point: an unescaped & or = would break the query string.
    expect(proxyStreamUrl(':')).toBe(`${PREFIX}%3A`);
    expect(proxyStreamUrl('/')).toBe(`${PREFIX}%2F`);
    expect(proxyStreamUrl('?')).toBe(`${PREFIX}%3F`);
    expect(proxyStreamUrl('&')).toBe(`${PREFIX}%26`);
    expect(proxyStreamUrl('=')).toBe(`${PREFIX}%3D`);
    expect(proxyStreamUrl(' ')).toBe(`${PREFIX}%20`); // space -> %20 (NOT '+')
    expect(proxyStreamUrl('#')).toBe(`${PREFIX}%23`);
  });

  it('does NOT escape a raw apostrophe (it is in the unreserved set)', () => {
    // encodeURIComponent leaves ' untouched, so it must survive literally (never %27).
    const out = proxyStreamUrl("https://ex.com/o'brien.mp4");
    expect(out).toBe(`${PREFIX}https%3A%2F%2Fex.com%2Fo'brien.mp4`);
    expect(out).toContain("o'brien");
    expect(out).not.toContain('%27');
  });

  it('does NOT escape ( ) ! * ~ - _ . (unreserved marks)', () => {
    expect(proxyStreamUrl("v(1)!*~-_.mp4")).toBe(`${PREFIX}v(1)!*~-_.mp4`);
  });

  it('fully escapes an embedded query string so it cannot leak into ours', () => {
    // "a b?c=1&d=2" -> a%20b%3Fc%3D1%26d%3D2 ; the ? & = space are all escaped.
    const out = proxyStreamUrl('a b?c=1&d=2');
    expect(out).toBe(`${PREFIX}a%20b%3Fc%3D1%26d%3D2`);
    // Everything after url= must contain no raw query delimiters.
    const encoded = out.slice(PREFIX.length);
    expect(encoded).not.toMatch(/[ ?&=]/);
  });

  it('handles an empty url -> empty encoded value, prefix intact', () => {
    expect(proxyStreamUrl('')).toBe(PREFIX);
  });

  it('escapes unicode as UTF-8 percent bytes', () => {
    // é (U+00E9) UTF-8 = 0xC3 0xA9 -> %C3%A9 ; 🎬 (U+1F3AC) = F0 9F 8E AC.
    expect(proxyStreamUrl('café')).toBe(`${PREFIX}caf%C3%A9`);
    expect(proxyStreamUrl('🎬')).toBe(`${PREFIX}%F0%9F%8E%AC`);
  });
});

describe('bestVideoUrl', () => {
  it('prefers hdplay over play and wmplay when all present', () => {
    expect(bestVideoUrl({ hdplay: 'H', play: 'P', wmplay: 'W' })).toBe(`${PREFIX}H`);
  });

  it('falls back to play when hdplay is missing', () => {
    expect(bestVideoUrl({ play: 'P', wmplay: 'W' })).toBe(`${PREFIX}P`);
  });

  it('falls back to wmplay when hdplay and play are missing', () => {
    expect(bestVideoUrl({ wmplay: 'W' })).toBe(`${PREFIX}W`);
  });

  it('returns the proxied empty url when the object is empty', () => {
    expect(bestVideoUrl({})).toBe(PREFIX);
  });

  it('treats an empty-string hdplay as absent (|| falsy) and uses play', () => {
    // hdplay:'' is falsy, so the || chain skips it -> play wins.
    expect(bestVideoUrl({ hdplay: '', play: 'P', wmplay: 'W' })).toBe(`${PREFIX}P`);
  });

  it('proxies (percent-encodes) the chosen url, not just returns it raw', () => {
    expect(bestVideoUrl({ hdplay: 'https://cdn.x/a b.mp4' })).toBe(
      `${PREFIX}https%3A%2F%2Fcdn.x%2Fa%20b.mp4`,
    );
  });
});

describe('clampZoom', () => {
  it('returns the value unchanged when inside the default [0.5, 3] range', () => {
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(2)).toBe(2);
  });

  it('clamps up to the default min', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(-100)).toBe(0.5);
  });

  it('clamps down to the default max', () => {
    expect(clampZoom(10)).toBe(3);
  });

  it('is inclusive at both boundaries', () => {
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(3)).toBe(3);
  });

  it('respects custom min/max bounds', () => {
    expect(clampZoom(5, 1, 4)).toBe(4);
    expect(clampZoom(0, 1, 4)).toBe(1);
    expect(clampZoom(2.5, 1, 4)).toBe(2.5);
  });

  it('maps +Infinity to max and -Infinity to min', () => {
    expect(clampZoom(Infinity)).toBe(3);
    expect(clampZoom(-Infinity)).toBe(0.5);
  });

  it('propagates NaN (Math.min/Math.max NaN semantics)', () => {
    // ECMAScript: Math.min/Math.max return NaN if any argument is NaN.
    expect(Number.isNaN(clampZoom(NaN))).toBe(true);
  });

  it('with reversed bounds (min>max) collapses to min', () => {
    // Degenerate/empty interval: Math.max(min, Math.min(max, x)) === min for any x<=max<min.
    expect(clampZoom(3, 5, 1)).toBe(5);
    expect(clampZoom(0, 5, 1)).toBe(5);
    expect(clampZoom(10, 5, 1)).toBe(5);
  });
});

describe('fmtTime', () => {
  it('formats sub-minute durations as 0:SS with zero-padded seconds', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(5)).toBe('0:05');
    expect(fmtTime(59)).toBe('0:59');
  });

  it('rolls into minutes at 60s and keeps seconds zero-padded', () => {
    expect(fmtTime(60)).toBe('1:00');
    expect(fmtTime(65)).toBe('1:05');
  });

  it('formats the YouTube Shorts max (180s) as 3:00 and 185s as 3:05', () => {
    expect(fmtTime(180)).toBe('3:00');
    expect(fmtTime(185)).toBe('3:05');
  });

  it('formats large durations without a leading zero on minutes', () => {
    expect(fmtTime(3599)).toBe('59:59');
    expect(fmtTime(3600)).toBe('60:00');
  });

  it('floors fractional seconds (does not round up)', () => {
    expect(fmtTime(5.99)).toBe('0:05');
    expect(fmtTime(65.9)).toBe('1:05');
    expect(fmtTime(59.999)).toBe('0:59');
  });

  it('never emits leading zero on the minutes field', () => {
    expect(fmtTime(65)).not.toMatch(/^0\d/);
    expect(fmtTime(600)).toBe('10:00');
  });

  it('always emits a valid two-digit SS (0-59) field, even for negative input', () => {
    // Spec contract "M:SS": the seconds field is always 0-59, zero-padded to 2 digits.
    // A duration formatter must never produce a negative/garbled seconds field.
    // NOTE: this is expected to FAIL — fmtTime(-5) currently returns "-1:-5".
    const ss = fmtTime(-5).split(':')[1];
    expect(ss).toMatch(/^[0-5][0-9]$/);
  });

  it('does not throw on NaN and returns a string', () => {
    // No spec value for NaN; assert only robustness (no exception, string out).
    expect(typeof fmtTime(NaN)).toBe('string');
  });
});
