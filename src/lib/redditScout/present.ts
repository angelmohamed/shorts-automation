import type { ScoutCandidate } from './types';
import { estimateNarrationSeconds } from '@/lib/reelDuration';
import { SCOUT_LONG_STORY_SECONDS } from './config';

// Pure presentation helpers for the Scout review panel. No I/O — unit-tested.

/** Compact post age from a created-utc epoch: "45m" · "7h" · "3d" · "2w". `nowUtc` injectable for tests.
    Clock skew / future timestamps clamp to "0m". */
export function fmtAge(createdUtc: number, nowUtc: number): string {
  const s = Math.max(0, nowUtc - createdUtc);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/** Long-story flag (§4.3): estimated narration of title+body would exceed the Shorts ceiling. Speed 1.0
    (the slowest the app uses) so the flag errs toward WARNING — surfaced only, never auto-removed. */
export function isLongStory(c: Pick<ScoutCandidate, 'title' | 'body'>): boolean {
  if (!c.body.trim()) return false;   // no body → the flag is about long STORY posts (Category B)
  return estimateNarrationSeconds(`${c.title} ${c.body}`, 1) > SCOUT_LONG_STORY_SECONDS;
}
