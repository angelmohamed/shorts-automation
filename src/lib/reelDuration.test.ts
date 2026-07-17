import { describe, it, expect } from 'vitest';
import type { Framing } from '@/app/components/TikTokCanvas/types';
import {
  SHORTS_MAX_SECONDS,
  NARRATION_TAIL_PAD_S,
  EST_CHARS_PER_SEC,
  estimateNarrationSeconds,
  reelDurationInfo,
} from './reelDuration';

// ─────────────────────────────────────────────────────────────────────────────
// Ground truth used to DERIVE (not copy) the expectations below:
//
//  • YouTube Shorts hard ceiling = 180s (3:00), raised from 60s on 2024-10-15.
//    (support.google.com/youtube/answer/15424877) → SHORTS_MAX_SECONDS must be 180.
//  • ElevenLabs `speed` ∈ [0.7, 1.2], default 1.0; >1.0 speeds speech up = SHORTER
//    audio, <1.0 slows it = LONGER audio (elevenlabs.io/docs .../voice/speed-control).
//    So estimate = chars / (EST_CHARS_PER_SEC · speed) + pad is monotonically
//    DECREASING in speed.
//  • JS String.prototype.trim() strips every ECMAScript White_Space / line-terminator
//    code point — including U+00A0 NBSP and U+FEFF (Zs / ZWNBSP) — but NOT U+200B
//    ZERO WIDTH SPACE (category Cf, not White_Space). Verified against V8/Node, the
//    engine Vitest's node env runs on.
//  • String#length counts UTF-16 code units, so an astral emoji (surrogate pair) and a
//    base-letter+combining-mark pair each count as 2.
//
// Spec of the module under test (from its own doc-comments / the task brief):
//   estimateNarrationSeconds(text, speed) =
//       trimmed.length ? trimmed.length / (EST_CHARS_PER_SEC · max(0.5, speed)) + PAD : 0
//   reelDurationInfo(framing, speed):
//       overlay = framing.overlays.find(name === 'Reddit thread')
//       no overlay                     → null
//       overlay.audioDuration > 0      → { seconds: audioDuration + PAD, estimated:false }
//       else enabled ocrLines joined " " has text → { estimate, estimated:true }
//       else                           → null
// ─────────────────────────────────────────────────────────────────────────────

const EST = 15; // EST_CHARS_PER_SEC per spec
const PAD = 1; // NARRATION_TAIL_PAD_S per spec

/** First-principles reference computation — independent of the implementation. */
function expected(chars: number, speed: number): number {
  const rate = EST * Math.max(0.5, speed);
  return chars / rate + PAD;
}

/** Build a minimal Framing-shaped object; the real type carries much more, so cast. */
function mk(overlays: unknown[]): Framing {
  return { overlays } as unknown as Framing;
}

describe('exported constants', () => {
  it('SHORTS_MAX_SECONDS is the 180s YouTube Shorts ceiling', () => {
    expect(SHORTS_MAX_SECONDS).toBe(180);
  });
  it('NARRATION_TAIL_PAD_S is a 1s footage tail', () => {
    expect(NARRATION_TAIL_PAD_S).toBe(1);
  });
  it('EST_CHARS_PER_SEC is 15', () => {
    expect(EST_CHARS_PER_SEC).toBe(15);
  });
});

describe('estimateNarrationSeconds — empty / whitespace → 0 (no pad)', () => {
  it('empty string → 0, and crucially NOT the pad', () => {
    expect(estimateNarrationSeconds('', 1)).toBe(0);
  });
  it('spaces only → 0', () => {
    expect(estimateNarrationSeconds('     ', 1)).toBe(0);
  });
  it('mixed ASCII whitespace (tab/newline/CR/FF/VT/space) → 0', () => {
    expect(estimateNarrationSeconds('\t\n\r\f\v ', 1)).toBe(0);
  });
  it('U+00A0 NBSP is whitespace → trimmed away → 0', () => {
    // NBSP is Unicode category Zs, part of ECMAScript White_Space → trim removes it.
    expect(estimateNarrationSeconds('  ', 1)).toBe(0);
  });
  it('U+FEFF ZWNBSP/BOM is whitespace → trimmed away → 0', () => {
    expect(estimateNarrationSeconds('﻿', 1)).toBe(0);
  });
  it('speed is irrelevant when there is no text → still 0', () => {
    expect(estimateNarrationSeconds('   ', 0.7)).toBe(0);
    expect(estimateNarrationSeconds('   ', 1.2)).toBe(0);
  });
});

describe('estimateNarrationSeconds — core formula & the +1 tail', () => {
  it('30 chars @1.0 → 30/15 + 1 = 3 exactly', () => {
    expect(estimateNarrationSeconds('a'.repeat(30), 1.0)).toBe(3);
  });
  it('15 chars @1.0 → 1s speech + 1s pad = 2 exactly', () => {
    expect(estimateNarrationSeconds('a'.repeat(15), 1.0)).toBe(2);
  });
  it('the +1 tail is always present for non-empty text (result = speech + 1)', () => {
    const chars = 15;
    const speech = chars / (EST * 1.0); // = 1s of speech
    expect(estimateNarrationSeconds('a'.repeat(chars), 1.0)).toBeCloseTo(speech + PAD, 10);
  });
  it('1 char @1.0 → 1/15 + 1 (float, non-terminating)', () => {
    expect(estimateNarrationSeconds('a', 1.0)).toBeCloseTo(1 + 1 / 15, 10);
  });
  it('10 chars @1.0 → 10/15 + 1 (float)', () => {
    expect(estimateNarrationSeconds('a'.repeat(10), 1.0)).toBeCloseTo(1 + 10 / 15, 10);
  });
});

describe('estimateNarrationSeconds — speed direction (ElevenLabs semantics)', () => {
  const text = 'a'.repeat(30);
  it('faster speed yields a SHORTER estimate: est(1.2) < est(1.0) < est(0.7)', () => {
    const fast = estimateNarrationSeconds(text, 1.2);
    const base = estimateNarrationSeconds(text, 1.0);
    const slow = estimateNarrationSeconds(text, 0.7);
    expect(fast).toBeLessThan(base);
    expect(base).toBeLessThan(slow);
  });
  it('@1.2 → 30/(15·1.2) + 1 = 30/18 + 1 ≈ 2.6667', () => {
    expect(estimateNarrationSeconds(text, 1.2)).toBeCloseTo(30 / 18 + 1, 6);
  });
  it('@0.7 → 30/(15·0.7) + 1 = 30/10.5 + 1 ≈ 3.8571', () => {
    expect(estimateNarrationSeconds(text, 0.7)).toBeCloseTo(30 / 10.5 + 1, 6);
  });
});

describe('estimateNarrationSeconds — max(0.5, speed) clamp', () => {
  const text = 'a'.repeat(30);
  it('@0.5 (the clamp point) → 30/(15·0.5) + 1 = 30/7.5 + 1 = 5 exactly', () => {
    expect(estimateNarrationSeconds(text, 0.5)).toBe(5);
  });
  it('speeds below 0.5 are clamped to 0.5 (0.3, 0.1 all equal the 0.5 value)', () => {
    const at05 = estimateNarrationSeconds(text, 0.5);
    expect(estimateNarrationSeconds(text, 0.3)).toBe(at05);
    expect(estimateNarrationSeconds(text, 0.1)).toBe(at05);
    expect(at05).toBe(5);
  });
  it('speed 0 does NOT divide-by-zero: clamp → finite 5, never Infinity/NaN', () => {
    const r = estimateNarrationSeconds(text, 0);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(5);
  });
  it('negative speed is clamped, not propagated: est(-3) → finite 5 (never negative seconds)', () => {
    const r = estimateNarrationSeconds(text, -3);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(5);
  });
  it('there is NO upper clamp: @2.0 → 30/(15·2) + 1 = 2, and @3.0 is even shorter', () => {
    expect(estimateNarrationSeconds(text, 2.0)).toBe(2);
    expect(estimateNarrationSeconds(text, 3.0)).toBeCloseTo(30 / 45 + 1, 6);
    expect(estimateNarrationSeconds(text, 3.0)).toBeLessThan(estimateNarrationSeconds(text, 2.0));
  });
});

describe('estimateNarrationSeconds — trimming & unicode length', () => {
  it('trims only the ends; leading/trailing spaces do not change the count', () => {
    expect(estimateNarrationSeconds('  ab  ', 1.0)).toBe(estimateNarrationSeconds('ab', 1.0));
    expect(estimateNarrationSeconds('  ab  ', 1.0)).toBeCloseTo(expected(2, 1.0), 10);
  });
  it('internal whitespace IS counted (not collapsed): "a b" = 3 chars ≠ "ab"', () => {
    expect(estimateNarrationSeconds('a b', 1.0)).toBeCloseTo(expected(3, 1.0), 10);
    expect(estimateNarrationSeconds('a b', 1.0)).not.toBe(estimateNarrationSeconds('ab', 1.0));
  });
  it('U+200B ZERO WIDTH SPACE is NOT whitespace → counts as 1 char (not trimmed)', () => {
    // Cf category, absent from ECMAScript White_Space → survives trim.
    expect(estimateNarrationSeconds('​', 1.0)).toBeCloseTo(expected(1, 1.0), 10);
  });
  it('astral emoji counts as 2 UTF-16 code units (length semantics), like "ab"', () => {
    expect(estimateNarrationSeconds('😀', 1.0)).toBeCloseTo(expected(2, 1.0), 10);
    expect(estimateNarrationSeconds('😀', 1.0)).toBe(estimateNarrationSeconds('ab', 1.0));
  });
});

describe('reelDurationInfo — overlay lookup / null cases', () => {
  it('undefined framing → null', () => {
    expect(reelDurationInfo(undefined, 1.0)).toBeNull();
  });
  it('framing with no overlays field → null', () => {
    expect(reelDurationInfo({} as unknown as Framing, 1.0)).toBeNull();
  });
  it('framing with empty overlays → null', () => {
    expect(reelDurationInfo(mk([]), 1.0)).toBeNull();
  });
  it('name match is exact & case-sensitive: "reddit thread" / "Reddit Thread" → null', () => {
    expect(reelDurationInfo(mk([{ name: 'reddit thread', audioDuration: 5 }]), 1.0)).toBeNull();
    expect(reelDurationInfo(mk([{ name: 'Reddit Thread', audioDuration: 5 }]), 1.0)).toBeNull();
  });
  it('find() returns the FIRST matching overlay by name, not by index', () => {
    const info = reelDurationInfo(
      mk([
        { name: 'Other', audioDuration: 99 },
        { name: 'Reddit thread', audioDuration: 5 },
      ]),
      1.0,
    );
    expect(info).toEqual({ seconds: 6, estimated: false });
  });
  it('with two "Reddit thread" overlays, the first wins', () => {
    const info = reelDurationInfo(
      mk([
        { name: 'Reddit thread', audioDuration: 5 },
        { name: 'Reddit thread', audioDuration: 50 },
      ]),
      1.0,
    );
    expect(info).toEqual({ seconds: 6, estimated: false });
  });
});

describe('reelDurationInfo — exact (audioDuration) branch', () => {
  it('audioDuration 5 → { seconds: 6, estimated:false } (audio + 1s pad)', () => {
    expect(reelDurationInfo(mk([{ name: 'Reddit thread', audioDuration: 5 }]), 1.0)).toEqual({
      seconds: 6,
      estimated: false,
    });
  });
  it('any positive audioDuration wins over text: exact branch beats the estimate', () => {
    const info = reelDurationInfo(
      mk([
        {
          name: 'Reddit thread',
          audioDuration: 0.001,
          ocrLines: [{ text: 'x'.repeat(500), enabled: true }],
        },
      ]),
      1.0,
    );
    expect(info).toEqual({ seconds: 0.001 + PAD, estimated: false });
  });
  it('audioDuration exactly 0 is NOT "> 0" → falls through to the estimate branch', () => {
    const info = reelDurationInfo(
      mk([{ name: 'Reddit thread', audioDuration: 0, ocrLines: [{ text: 'a'.repeat(15), enabled: true }] }]),
      1.0,
    );
    expect(info).toEqual({ seconds: 2, estimated: true });
  });
  it('undefined audioDuration (??0) → estimate branch', () => {
    const info = reelDurationInfo(
      mk([{ name: 'Reddit thread', ocrLines: [{ text: 'a'.repeat(15), enabled: true }] }]),
      1.0,
    );
    expect(info?.estimated).toBe(true);
    expect(info?.seconds).toBe(2);
  });
  it('negative audioDuration is not "> 0" → estimate branch (never a negative duration)', () => {
    const info = reelDurationInfo(
      mk([{ name: 'Reddit thread', audioDuration: -4, ocrLines: [{ text: 'a'.repeat(15), enabled: true }] }]),
      1.0,
    );
    expect(info).toEqual({ seconds: 2, estimated: true });
  });
  it('audioDuration 0 with no usable text → null', () => {
    expect(reelDurationInfo(mk([{ name: 'Reddit thread', audioDuration: 0 }]), 1.0)).toBeNull();
  });
});

describe('reelDurationInfo — estimate branch: enabled ocrLines joined by " "', () => {
  it('disabled lines are excluded from the estimate', () => {
    // disabled 20-char line must NOT be counted; only the enabled 5-char line is.
    const info = reelDurationInfo(
      mk([
        {
          name: 'Reddit thread',
          ocrLines: [
            { text: 'x'.repeat(20), enabled: false },
            { text: 'BBBBB', enabled: true },
          ],
        },
      ]),
      1.0,
    );
    expect(info?.estimated).toBe(true);
    expect(info?.seconds).toBeCloseTo(expected(5, 1.0), 10); // 5 chars only
  });
  it('all lines disabled → null', () => {
    expect(
      reelDurationInfo(
        mk([{ name: 'Reddit thread', ocrLines: [{ text: 'abc', enabled: false }] }]),
        1.0,
      ),
    ).toBeNull();
  });
  it('no ocrLines at all → null', () => {
    expect(reelDurationInfo(mk([{ name: 'Reddit thread' }]), 1.0)).toBeNull();
  });
  it('enabled but whitespace-only text → null (joined text trims to empty)', () => {
    expect(
      reelDurationInfo(mk([{ name: 'Reddit thread', ocrLines: [{ text: '   ', enabled: true }] }]), 1.0),
    ).toBeNull();
  });
  it('two enabled lines are joined with a SPACE: "ab"+"cd" → "ab cd" = 5 chars (not 4)', () => {
    // If join used '' this would be 4 chars → a different, detectable value.
    const info = reelDurationInfo(
      mk([
        {
          name: 'Reddit thread',
          ocrLines: [
            { text: 'ab', enabled: true },
            { text: 'cd', enabled: true },
          ],
        },
      ]),
      1.0,
    );
    expect(info?.seconds).toBeCloseTo(expected(5, 1.0), 10);
    expect(info?.seconds).not.toBeCloseTo(expected(4, 1.0), 10);
  });
  it('a leading empty enabled line is trimmed off: ["","abc"] → "abc" = 3 chars', () => {
    const info = reelDurationInfo(
      mk([
        {
          name: 'Reddit thread',
          ocrLines: [
            { text: '', enabled: true },
            { text: 'abc', enabled: true },
          ],
        },
      ]),
      1.0,
    );
    expect(info?.seconds).toBeCloseTo(expected(3, 1.0), 10);
  });
  it('estimate honours speed direction through the reel path too', () => {
    const lines = [{ text: 'a'.repeat(30), enabled: true }];
    const fast = reelDurationInfo(mk([{ name: 'Reddit thread', ocrLines: lines }]), 1.2);
    const slow = reelDurationInfo(mk([{ name: 'Reddit thread', ocrLines: lines }]), 0.7);
    expect(fast!.seconds).toBeLessThan(slow!.seconds);
  });
});

describe('reelDurationInfo — 180s Shorts ceiling boundary (strictly-greater at call sites)', () => {
  it('audioDuration 179 + 1s pad = exactly 180.0, which is NOT over (180 > 180 is false)', () => {
    const info = reelDurationInfo(mk([{ name: 'Reddit thread', audioDuration: 179 }]), 1.0);
    expect(info?.seconds).toBe(180);
    // Call sites flag with strict >, so a reel sitting exactly on the ceiling is allowed.
    expect((info!.seconds > SHORTS_MAX_SECONDS)).toBe(false);
  });
  it('audioDuration 179.5 + pad = 180.5 IS over the ceiling', () => {
    const info = reelDurationInfo(mk([{ name: 'Reddit thread', audioDuration: 179.5 }]), 1.0);
    expect(info?.seconds).toBeCloseTo(180.5, 10);
    expect(info!.seconds > SHORTS_MAX_SECONDS).toBe(true);
  });
  it('the 1s tail pad is what pushes a 179.5s narration over 180', () => {
    // 179.5s of raw audio is under the ceiling; the surfaced (padded) duration is over.
    expect(179.5 > SHORTS_MAX_SECONDS).toBe(false);
    const info = reelDurationInfo(mk([{ name: 'Reddit thread', audioDuration: 179.5 }]), 1.0);
    expect(info!.seconds > SHORTS_MAX_SECONDS).toBe(true);
  });
});
