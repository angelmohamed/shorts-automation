import { proxyStreamUrl } from './utils';

// Preselected background-music library, served from the R2 bucket's music/ prefix (upload with
// `rclone copyto <file> r2:parkour-footage/music/<name>.mp3`, then add a row here). Tracks loop
// quietly under the narration — same gain in preview and export.
export interface BackgroundTrack {
  id: string;
  name: string;
  url: string;
}

export const BACKGROUND_TRACKS: BackgroundTrack[] = [
  {
    id: 'elevator-music',
    name: 'Elevator Music (Kevin MacLeod)',
    url: 'https://pub-63dabe78ed9342c5a94e50b584141711.r2.dev/music/elevator-music.mp3',
  },
];

/** Default music-bed volume relative to narration (which plays at 1); per-reel override in Framing. */
export const DEFAULT_MUSIC_VOLUME = 0.05;

export const trackById = (id?: string | null): BackgroundTrack | null =>
  BACKGROUND_TRACKS.find(t => t.id === id) ?? null;

/** Same-origin stream URL (r2.dev is proxied like the footage). */
export const trackStreamSrc = (t: BackgroundTrack): string => proxyStreamUrl(t.url);
