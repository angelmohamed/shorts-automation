import type { MutableRefObject } from 'react';
import type { MemeLine } from '@/lib/memeOcr';
import type { TwitterTemplateSettings } from '../twitterTemplateTypes';

/** An OCR-detected text line on an overlay image, plus whether the user wants it narrated and,
    optionally, which ElevenLabs voice reads it (absent = the default voice). Consecutive enabled
    lines with the same voice are spoken as one paragraph/take. */
export interface OcrTextLine extends MemeLine { enabled: boolean; voiceId?: string }

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
  /** Progressive reveal steps: at source time `t` the visible (top-anchored) fraction eases to `h`.
      Sorted by t. Absent = the whole image is always visible. */
  reveals?: { t: number; h: number }[];
  /** Narration audio (ElevenLabs): blob lives in IndexedDB under `audioId`; starts playing at
      `audioStart` (source-time seconds) for `audioDuration` audio-seconds. `audioSrc` is runtime-only. */
  audioId?: string;
  audioStart?: number;
  audioDuration?: number;
  audioSrc?: string;
  /** Playback rate of the underlying video while this narration plays (baked into the reveal-step
      source times at generation). The video runs this much faster than the voice; absent = 1. */
  audioRate?: number;
  /** Text lines OCR'd off the image right after it's added (auto). Rendered as click-to-toggle
      highlights on the selected overlay; only `enabled` lines are narrated/revealed. */
  ocrLines?: OcrTextLine[];
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
  /** Image layers on top of the video (runtime object URLs stripped — blobs re-hydrate from IndexedDB). */
  overlays?: Omit<ImageOverlay, 'src' | 'audioSrc'>[];
  /** Background-music track id (lib/music.ts); absent = no music. */
  musicId?: string;
  /** Music bed volume 0..1 (absent = DEFAULT_MUSIC_VOLUME). */
  musicVolume?: number;
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
  /** Armed narration-voice brush: while set, clicking an OCR line highlight paints that line with
      this voice instead of toggling it in/out of the narration. */
  ocrBrush?: { voiceId: string; color: string } | null;
  /** Background-music track id (lib/music.ts): loops quietly under playback and mixes into the export. */
  musicId?: string | null;
  /** Music bed volume 0..1 (default DEFAULT_MUSIC_VOLUME) — same gain in preview and export. */
  musicVolume?: number | null;
  /** voiceId → display color for OCR line highlights (lines with no voice use the accent style). */
  ocrVoiceColors?: Record<string, string>;
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
  /** Attach generated narration to an overlay: reveal steps + audio (already persisted to IndexedDB).
      Extends the overlay's end so the narration finishes inside its window. */
  setOverlayNarration: (id: string, n: { reveals: { t: number; h: number }[]; audioId: string; audioStart: number; audioDuration: number; audioSrc: string; audioRate: number }) => void;
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
