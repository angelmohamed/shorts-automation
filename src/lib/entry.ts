import type { VideoEntry, VideoMode } from '../app/types';

// Hard cap on reels per user's grid. Enforced client-side (block adds) AND server-side by the
// enforce_reel_cap trigger on video_reels (see supabase/migrations). The trigger only blocks GROWING
// past 50 — an existing over-cap grid (one user already has 486) still saves/shrinks fine — so this
// limit never destroys or rejects existing reels; it only stops new ones being added past 50.
export const MAX_REELS = 50;

export function makeEmptyEntry(id: string, mode: VideoMode = 'twitter'): VideoEntry {
  return {
    id, url: '', caption: '',
    mode,
    data: null, loading: false, error: '', videoFailed: false,
  };
}
