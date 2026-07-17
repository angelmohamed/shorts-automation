import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class lists (shadcn-style helper, used by the landing components). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Build a proxied stream URL for cross-origin media playback */
export function proxyStreamUrl(url: string): string {
  return `/api/proxy?stream=1&url=${encodeURIComponent(url)}`;
}

/** Clamp a zoom/scale value to [min, max] */
export function clampZoom(val: number, min = 0.5, max = 3): number {
  return Math.max(min, Math.min(max, val));
}

/** Format seconds as M:SS. Clamps to 0 — a duration is never negative, and JS `%`/`floor` sign rules would
 *  otherwise emit a garbled field (e.g. -5 → "-1:-5"). */
export function fmtTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Pick the best-QUALITY video URL from a VideoData-like object, proxied.
 *  Order: hdplay (HD / 1080p, no watermark) → play (SD ~720p, no watermark) → wmplay (watermarked).
 *  Previously this preferred `play` first, so TikTok sources loaded as the 720p SD stream even though
 *  the HD stream was fetched (the download route sends hd=1 and tikwm returns both) — every reel then
 *  re-encoded from a 720p source and posted to Instagram at 720p. hdplay-first fixes that end to end. */
export function bestVideoUrl(data: { play?: string; hdplay?: string; wmplay?: string }): string {
  return proxyStreamUrl(data.hdplay || data.play || data.wmplay || '');
}
