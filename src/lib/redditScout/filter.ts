import type { ScoutCandidate } from './types';
import type { ScoutSubreddit } from './config';

// Pure candidate filters: the permanent no-repeat gate + the quality gates. No I/O — unit-tested.

/** Remove every candidate already decided (used OR rejected) — the permanent no-repeat guarantee.
    `seenIds` holds base36 post ids exactly as `ScoutCandidate.id` and the ledger store them. */
export function filterUnseen(candidates: ScoutCandidate[], seenIds: Set<string>): ScoutCandidate[] {
  return candidates.filter(c => !seenIds.has(c.id));
}

/** Drop candidates that fail the quality gates: an unknown/image subreddit, an image post, a stickied
    (mod/announcement) post, NSFW (unless included), or a score below the subreddit's per-sub floor.
    Subs are matched case-insensitively; an unrecognised sub is dropped defensively (we only fetch
    configured subs, so this only bites on bad data). */
export function applyThresholds(
  candidates: ScoutCandidate[],
  subs: ScoutSubreddit[],
  includeNsfw: boolean,
): ScoutCandidate[] {
  const byName = new Map(subs.map(s => [s.name.toLowerCase(), s]));
  return candidates.filter(c => {
    const sub = byName.get(c.subreddit.toLowerCase());
    if (!sub) return false;
    if (sub.image || c.isImage) return false;      // v1: image subs + stray image posts excluded
    if (c.stickied) return false;                   // mod/pinned/announcement
    if (c.over18 && !includeNsfw) return false;     // NSFW gate
    if (c.score < sub.minScore) return false;       // per-sub popularity floor
    return true;
  });
}
