import type { MutableRefObject } from 'react';
import type { TwitterTemplateSettings } from '../twitterTemplateTypes';

export type Handle = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'move';

export interface Box { x: number; y: number; w: number; h: number }

export interface RecordingState {
  isRecording: boolean;
  recProgress: number;
  recStatus: string;
}

export interface VideoTrimState {
  trimStart: number;
  trimEnd: number;
  duration: number;
  includeEdit: boolean;
  videoScale: number;
}

// The full per-reel framing — the only numbers that, together with the video link + template, let a
// reel re-render identically. Persisted (as plain JSON) by the Video Reels workspace; re-applied after
// the video reloads. All optional so a partial/legacy blob still restores what it can.
/** One kept span of the source video, in source-time seconds (a timeline clip). */
export interface ClipSegment { start: number; end: number }

/** An image layered on top of the reel video. Position/size are canvas px (1080×1920); start/end are
    SOURCE-time seconds (like clip segments) — the overlay is visible while the playhead is inside them.
    `src` is a runtime object URL and is NOT persisted; the blob lives in IndexedDB keyed by `id`. */
export interface ImageOverlay {
  id: string;
  name: string;
  x: number; y: number; w: number; h: number;
  start: number; end: number;
  src?: string;
}

export interface Framing {
  box?: Box;
  videoOffset?: { x: number; y: number };
  videoScale?: number;
  trimStart?: number;
  trimEnd?: number;
  includeEdit?: boolean;
  /** Timeline clips when the video was split/cut into more than one span. Absent = simple trim
      (trimStart/trimEnd describe the single span). Kept alongside trim so legacy blobs restore. */
  segments?: ClipSegment[];
  /** Image layers on top of the video (src stripped — blobs re-hydrate from IndexedDB by id). */
  overlays?: Omit<ImageOverlay, 'src'>[];
}

export interface TikTokCanvasProps {
  videoSrc: string;
  videoId?: string;
  rowNumber?: number;
  onVideoError?: () => void;
  /** 'sonotrade' = Twitter/X header template, 'clean' = caption-only template */
  brand?: 'sonotrade' | 'clean';
  overlayLogoSrc?: string;
  overlayDisplayName?: string;
  overlayHandle?: string;
  overlayVerified?: boolean;
  overlayCaption?: string;
  marketData?: MarketData | null;
  /** Twitter/X overlay style (colors, caption size, avatar shape, toggles). Defaults reproduce the original look. */
  twitterSettings?: TwitterTemplateSettings;
  onRecordingStateChange?: (state: RecordingState) => void;
  /** Saved framing to restore once the video has (re)loaded — crop/pan/zoom/trim of a saved reel. */
  initialFraming?: Framing | null;
  /** Fired whenever the user changes framing (crop/pan/zoom/trim) so the workspace can autosave it. */
  onFramingChange?: () => void;
  /** Fired with the current overlay list whenever it changes (add/move/resize/retime/remove/restore),
      so the workspace can hand it to the timeline. */
  onOverlaysChange?: (overlays: ImageOverlay[]) => void;
}

export interface TikTokCanvasRef {
  startDownload: () => Promise<void>;
  /** Bake the reel (crop/overlay/trim) to an MP4 Blob instead of downloading — used by the Post scheduler. */
  exportBlob: () => Promise<Blob | null>;
  cancelExport: () => void;
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (scale: number) => void;
  resetBox: () => void;
  centerBox: () => void;
  setIncludeEdit: (v: boolean) => void;
  getVideoElement: () => HTMLVideoElement | null;
  useLocalBlob: () => void;   // swap playback to the downloaded local blob (fast seeking)
  getTrimState: () => VideoTrimState;
  /** Timeline clip list, held here so it persists with the framing. null = simple trim (≤1 clip). */
  setSegments: (segs: ClipSegment[] | null) => void;
  getSegments: () => ClipSegment[] | null;
  /** Image overlays: add (src = object URL; sized/centred when the image loads), retime/replace fields,
      and remove (also GC's the stored blob). */
  addImageOverlay: (id: string, src: string, name: string) => void;
  updateOverlay: (id: string, patch: Partial<Omit<ImageOverlay, 'id' | 'src'>>) => void;
  removeOverlay: (id: string) => void;
  getOverlays: () => ImageOverlay[];
  /** Snapshot the current framing (crop/pan/zoom/trim) for persistence. Returns null while a saved
   *  reel's video is still loading (framing not yet applied) so callers keep the known-good value. */
  getFraming: () => Framing | null;
  /** Re-apply a saved framing immediately (used after a reload to restore the exact crop). */
  applyFraming: (f: Framing) => void;
}

export interface SparkPoint { value: number; timestamp: number }

export interface MarketData {
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  sparkline?: SparkPoint[] | null;
  price: {
    usd: number | null;
    lifetimeChangePct: number | null;
  };
}

export interface DrawHeaderOptions {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cx: number;
  cy: number;
  cw: number;
  overlayCaption: string;
  overlayLogoSrc: string;
  overlayDisplayName: string;
  overlayHandle: string;
  overlayVerified: boolean;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  avatarImg?: HTMLImageElement | null;   // pre-loaded per-cell avatar image; overrides the brand logo when set
  s: TwitterTemplateSettings;   // resolved overlay style (colors, caption size, avatar shape, toggles)
  placeholder?: boolean;        // editor-only: draw an image skeleton for the avatar when no logo image
  fillBg?: boolean;             // paint the opaque header-bg rect behind the banner (default true). Free
                                // banner elements pass false so they overlay the video/content transparently.
}
