/** Navigation sections in the sidebar */
export type AppSection = 'template-editor' | 'posts' | 'branding' | 'schedule' | 'analytics' | 'video-reels' | 'account' | 'automations';

export interface BrandLogo {
  id: string;
  url: string;
  label?: string;
  position: number;
}

export interface BrandFont {
  id: string;
  label: string;   // family name shown in the font picker
  url: string;     // public URL of the uploaded font file
}

/** Brand-kit data passed to canvas templates */
export interface BrandProps {
  logoSrc: string;
  logos: BrandLogo[];
  fonts: BrandFont[];
  displayName: string;
  handle: string;
  colors: string[];   // ordered brand palette (hex strings) — copilot grounding + brand lint
}

export interface Author {
  uniqueId: string;
  nickname: string;
  avatarThumb: string;
}

export interface VideoData {
  id: string;
  title: string;
  cover: string;
  author: Author;
  play: string;
  wmplay: string;
  hdplay: string;
  duration: number;
  size: number;
  images?: string[];
}

export type VideoMode = 'twitter' | 'caption';

export interface VideoEntry {
  id: string;
  url: string;
  caption: string;
  mode: VideoMode;
  data: VideoData | null;
  loading: boolean;
  error: string;
  videoFailed: boolean;
  // local video upload (twitter/caption templates)
  localVideoSrc?: string;
  localVideoName?: string;
  // Durable public URL of the reel's video in the post-videos bucket (Video Reels persistence). Set
  // after an uploaded local file OR a pasted LINK is stored (see storeReel) — so a stored reel loads
  // from our bucket on reload instead of re-fetching the (rot-prone) source. Cleared when the reel's
  // upload or link changes.
  videoUrl?: string;
  // Durable public URL of a poster/thumbnail (post-images bucket), generated at store time. Lets the
  // grid show a frame without instantiating a <video> (loading strategy). Cleared with videoUrl.
  posterUrl?: string;
}
