import type { Framing } from '@/app/components/TikTokCanvas/types';

// ── Short-length model (also drives the reel duration badge + the bulk-builder live estimate) ──
// YouTube Shorts hard ceiling: a video longer than 3:00 can't be published as a Short (raised from 60s in
// Oct 2024). We only WARN at this line — never auto-trim. The reel's final length ≈ its narration audio + a
// ~1s tail of footage (POST_NARRATION_PAD_S in useRecording), so fold that pad into every duration we surface.
export const SHORTS_MAX_SECONDS = 180;
export const NARRATION_TAIL_PAD_S = 1;
// Approx spoken characters/second for the ElevenLabs narrator at speed 1.0 — used ONLY to estimate a reel's
// length from its text BEFORE narration exists (the exact audioDuration replaces the estimate once generated).
// ElevenLabs `speed` is 0.7–1.2 where >1 speeds up = SHORTER audio, so it divides. Slightly conservative so a
// borderline reel flags rather than slips past. Rough by nature; calibratable.
export const EST_CHARS_PER_SEC = 15;

/** Estimated final-video seconds for `text` narrated at `speed` (ElevenLabs' `speed` scales audio length). */
export function estimateNarrationSeconds(text: string, speed: number): number {
  const chars = text.trim().length;
  return chars ? chars / (EST_CHARS_PER_SEC * Math.max(0.5, speed)) + NARRATION_TAIL_PAD_S : 0;
}

/** Final-video duration for a reel: EXACT once narrated (audioDuration + tail pad), else an ESTIMATE from the
    card's enabled text lines. null when the reel has no Reddit narration overlay (nothing to measure). */
export function reelDurationInfo(framing: Framing | undefined, speed: number): { seconds: number; estimated: boolean } | null {
  const overlay = framing?.overlays?.find(o => o.name === 'Reddit thread');
  if (!overlay) return null;
  if ((overlay.audioDuration ?? 0) > 0) return { seconds: overlay.audioDuration! + NARRATION_TAIL_PAD_S, estimated: false };
  const text = (overlay.ocrLines ?? []).filter(l => l.enabled).map(l => l.text).join(' ');
  return text.trim() ? { seconds: estimateNarrationSeconds(text, speed), estimated: true } : null;
}
