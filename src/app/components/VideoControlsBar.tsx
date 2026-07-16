'use client';

import { useRef, useEffect, useLayoutEffect, useState, useCallback, memo } from 'react';
import type { ImageOverlay, RecordingState } from './TikTokCanvas/types';
import { Button, IconButton, Slider, ProgressBar, Tooltip } from '@/app/components/ui';
import { TrashIcon, PlayIcon, PauseIcon, PlusIcon, MinusIcon, DownloadIcon } from '@/lib/icons';
import { getVideoBlob } from '@/lib/reelVideoBlob';

export interface VideoCanvasRef {
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  resetBox: () => void;
  centerBox: () => void;
  getVideoElement: () => HTMLVideoElement | null;
  useLocalBlob?: () => void;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number };
  /** Clip list mirrored into the canvas so multi-cut edits persist with the framing (autosave). */
  setSegments?: (segs: Array<{ start: number; end: number }> | null) => void;
  getSegments?: () => Array<{ start: number; end: number }> | null;
  /** Image-overlay editing (timeline lane): retime / delete an overlay by id. */
  updateOverlay?: (id: string, patch: Partial<Omit<ImageOverlay, 'id' | 'src'>>) => void;
  removeOverlay?: (id: string) => void;
  startDownload: () => Promise<void>;
  cancelExport: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const FPS         = 30;     // reels render at 30fps in the exporter — keep the frame grid consistent
const RULER_H     = 22;
const STRIP_H     = 58;
const OV_H        = 22;     // image-overlay lane height (shown only when the reel has overlays)
const AUD_H       = 16;     // narration audio-channel lane height (shown when a narration exists)
const MIN_OV      = 0.1;    // minimum overlay duration (seconds, output time)
const NAMEBAR_H   = 15;
const SNAP_PX     = 8;
const EDGE_PX     = 36;
const ZOOM_MAX    = 24;     // max zoom relative to fit
const MIN_CLIP    = 1 / FPS;
const HISTORY_LIMIT = 100;

type Thumb = { t: number; url: string };
const thumbCache = new Map<string, { w: number; frames: Thumb[] }>();   // w = natural thumbnail width (px @ STRIP_H)

// Nearest extracted frame to a source time (frames are sorted ascending by t).
function frameAt(frames: Thumb[], t: number): string {
  if (!frames.length) return '';
  let best = frames[0], bestD = Math.abs(frames[0].t - t);
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].t - t);
    if (d < bestD) { bestD = d; best = frames[i]; }
    if (frames[i].t > t) break;
  }
  return best.url;
}

// A clip = a kept piece of the single source, in source-time seconds.
interface Segment { id: string; start: number; end: number; }

function mkSeg(start: number, end: number, prefix = 'seg'): Segment {
  return { id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, start, end };
}
function segsKey(segs: Segment[]): string {
  return segs.map(s => `${s.id}:${s.start.toFixed(3)}:${s.end.toFixed(3)}`).join('|');
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const qf    = (t: number) => Math.round(t * FPS) / FPS;

// Initial clip list for a (re)opened reel: restore the saved multi-cut clips if the canvas has them,
// else a single clip spanning the saved trim range, else the full source. Keeps timeline edits from a
// previous session/section-switch instead of silently resetting to one full-length clip.
function seedSegments(ref: VideoCanvasRef, d: number): Segment[] {
  const saved = ref.getSegments?.() ?? null;
  if (saved && saved.length) {
    const segs = saved
      .map(s => mkSeg(clamp(s.start, 0, d), clamp(s.end, 0, d)))
      .filter(s => s.end - s.start >= MIN_CLIP);
    if (segs.length) return segs;
  }
  const t = ref.getTrimState();
  const t0 = clamp(t.trimStart || 0, 0, d);
  const t1 = t.trimEnd > t0 ? clamp(t.trimEnd, t0, d) : d;
  return [mkSeg(t0, t1 > t0 ? t1 : d)];
}

function fmtTC(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const total = Math.round(t * FPS);
  const f = total % FPS, secs = Math.floor(total / FPS);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

const TICKS = [1 / FPS, 2 / FPS, 5 / FPS, 10 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

// ── Output (sequence) layout ─────────────────────────────────────────────────
// Clips are packed contiguously from output time 0; the timeline is the OUTPUT video,
// not the source — so trimming never leaves blank margins. Each item maps a source
// window [src0,src1] to an output window [out0,out1].
type LItem = { seg: Segment; src0: number; src1: number; out0: number; out1: number; dur: number };
type Layout = { items: LItem[]; total: number };

function buildLayout(segs: Segment[]): Layout {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  let acc = 0;
  const items = sorted.map(seg => {
    const dur = Math.max(0, seg.end - seg.start);
    const it: LItem = { seg, src0: seg.start, src1: seg.end, out0: acc, out1: acc + dur, dur };
    acc += dur;
    return it;
  });
  return { items, total: acc };
}
function srcToOut(srcT: number, L: Layout): number {
  if (!L.items.length) return 0;
  if (srcT <= L.items[0].src0) return 0;
  for (const it of L.items) if (srcT <= it.src1) return it.out0 + Math.max(0, srcT - it.src0);
  return L.total;
}
function outToSrc(outT: number, L: Layout): number {
  if (!L.items.length) return 0;
  outT = clamp(outT, 0, L.total);
  for (const it of L.items) if (outT <= it.out1) return it.src0 + (outT - it.out0);
  return L.items[L.items.length - 1].src1;
}

// ── Clip ──────────────────────────────────────────────────────────────────────
// The filmstrip is a FIXED-density strip: each thumbnail keeps a constant on-screen
// width (thumbW) and is placed by its source time. The clip is just a window onto it,
// so trimming/resizing reveals or hides whole frames instead of squishing them.
// Tiles are virtualised to the visible scroll window (viewLeft..viewRight, content px).
const Clip = memo(function Clip({
  segId, index, leftPx, widthPx, frames, thumbW, srcIn, effPps, viewLeft, viewRight, selected, settling, onBodyDown, onTrimDown,
}: {
  segId: string; index: number; leftPx: number; widthPx: number;
  frames: Thumb[]; thumbW: number; srcIn: number; effPps: number;
  viewLeft: number; viewRight: number; selected: boolean; settling: boolean;
  onBodyDown: (e: React.PointerEvent, segId: string) => void;
  onTrimDown: (e: React.PointerEvent, segId: string, side: 'start' | 'end') => void;
}) {
  const showLabel = widthPx >= 56;
  const tw = thumbW > 0 ? thumbW : STRIP_H;
  const nTiles = Math.max(1, Math.ceil(widthPx / tw));
  const i0 = Math.max(0, Math.floor((viewLeft - leftPx) / tw) - 1);
  const i1 = Math.min(nTiles, Math.ceil((viewRight - leftPx) / tw) + 1);
  const tiles: { i: number; url: string }[] = [];
  for (let i = i0; i < i1; i++) {
    const srcT = srcIn + (i * tw + tw / 2) / (effPps || 1);
    tiles.push({ i, url: frameAt(frames, srcT) });
  }
  return (
    <div
      className={`group absolute top-0 bottom-0 overflow-hidden rounded-md bg-surface-3 ${selected ? 'z-20' : 'z-10'} ${settling ? 'transition-[left,width] duration-150 ease-out' : ''}`}
      style={{ left: leftPx, width: Math.max(2, widthPx) }}
      onPointerDown={e => onBodyDown(e, segId)}
    >
      {tiles.map(({ i, url }) => url && (
        <img key={i} src={url} alt="" draggable={false}
          className="absolute top-0 bottom-0 object-cover block pointer-events-none"
          style={{ left: i * tw, width: tw }} />
      ))}
      {showLabel && (
        <>
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/65 to-transparent pointer-events-none" style={{ height: NAMEBAR_H + 4 }} />
          <div className="absolute inset-x-0 top-0 px-1.5 flex items-center justify-between gap-2 pointer-events-none" style={{ height: NAMEBAR_H }}>
            <span className="text-[10px] tabular-nums leading-none text-white/85 truncate">Clip {index + 1}</span>
            <span className="text-[10px] tabular-nums leading-none text-white/65 shrink-0">{fmtTC(effPps > 0 ? widthPx / effPps : 0)}</span>
          </div>
        </>
      )}
      <div className={`absolute inset-0 rounded-md ring-inset pointer-events-none transition-all ${selected ? 'ring-2 ring-accent' : 'ring-1 ring-line-faint'}`} />
      {selected && <div className="absolute inset-0 rounded-md pointer-events-none" style={{ boxShadow: '0 0 0 1px var(--accent-border), 0 0 14px var(--accent-tint)' }} />}
      <div className="absolute inset-y-0 left-0 w-2.5 z-30 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={e => onTrimDown(e, segId, 'start')}>
        <div className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-danger" />
      </div>
      <div className="absolute inset-y-0 right-0 w-2.5 z-30 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={e => onTrimDown(e, segId, 'end')}>
        <div className="absolute inset-y-1.5 right-0 w-[3px] rounded-l-sm bg-danger" />
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
interface VideoControlsBarProps {
  entryId:        string | null;
  activeRef:      VideoCanvasRef | null;
  recordingState: RecordingState | null;
  videoSrc:       string | null;
  /** Image overlays on the current reel — rendered as their own lane above the clips. */
  overlays?:      ImageOverlay[];
  /** voiceId → color / display name, for the narration audio-channel lane. */
  voiceColors?:   Record<string, string>;
  voiceNames?:    Record<string, string>;
  onHistory?:     (api: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) => void;
  // Free-tier export quota gate, threaded from the host so its "N left" counter stays the single
  // source of truth (FREE_TIER_PLAN.md). Resolves false (and shows the upgrade prompt) when the
  // export must not run; absent = export freely.
  guardExport?:   (run: () => void | Promise<void>) => Promise<boolean>;
}

export function VideoControlsBar({ entryId, activeRef, recordingState, videoSrc, overlays, voiceColors, voiceNames, onHistory, guardExport }: VideoControlsBarProps) {
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);   // SOURCE time (from the <video>)
  const [duration,    setDuration]    = useState(0);   // SOURCE duration
  const [segments,    setSegments]    = useState<Segment[]>([]);
  const [frames,      setFrames]      = useState<Thumb[]>([]);
  const [thumbW,      setThumbW]      = useState(0);       // natural thumbnail width (px @ STRIP_H)
  const [selection,   setSelection]   = useState<string | null>(null);

  const [pps,       setPps]       = useState(0);        // pixels per OUTPUT second (zoom state)
  const [viewportW, setViewportW] = useState(0);
  const [scrollX,   setScrollX]   = useState(0);

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapLineT,   setSnapLineT]   = useState<number | null>(null);   // output time of the snap line
  const [readout,     setReadout]     = useState<{ t: number; text: string } | null>(null);   // t = OUTPUT time
  const [trimEdge,    setTrimEdge]    = useState<{ segId: string; side: 'start' | 'end'; out: number; src: number } | null>(null);
  const [settling,    setSettling]    = useState(false);

  // Live mirrors for handlers
  const durRef         = useRef(0);
  const outDurRef      = useRef(0);
  const ppsRef         = useRef(0);
  const fitPpsRef      = useRef(0);
  const curTimeRef     = useRef(0);
  const segmentsRef    = useRef<Segment[]>([]);
  const layoutRef      = useRef<Layout>({ items: [], total: 0 });
  const selectionRef   = useRef<string | null>(null);
  const snapEnabledRef = useRef(true);
  const trimStartRef   = useRef(0);
  const trimEndRef     = useRef(0);

  // Drag machinery
  const dragRef        = useRef<{ kind: 'playhead' | 'trim'; segId?: string; side?: 'start' | 'end'; frozen?: Layout; item?: LItem; lo?: number; hi?: number } | null>(null);
  const pendingSrcRef  = useRef<{ start?: number; end?: number } | null>(null);
  const lastClientXRef = useRef(0);
  const autoRafRef     = useRef(0);
  const autoDirRef     = useRef(0);
  const scrollRafRef   = useRef(0);
  const pendingScrollRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuttleRef     = useRef<{ raf: number; rate: number; last: number } | null>(null);

  // Undo / redo
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const pastRef   = useRef<Segment[][]>([]);
  const futureRef = useRef<Segment[][]>([]);

  const wrapperRef  = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const roRef       = useRef<ResizeObserver | null>(null);
  const activeRefRef = useRef(activeRef);

  useEffect(() => { activeRefRef.current = activeRef; });
  useEffect(() => { segmentsRef.current  = segments;  }, [segments]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);
  useEffect(() => { curTimeRef.current   = currentTime; }, [currentTime]);
  // Sync the output layout + fit/pps into refs so pointer/keyboard handlers read
  // current values without touching refs during render.
  useEffect(() => {
    const L = buildLayout(segments);
    layoutRef.current = L; outDurRef.current = L.total;
    fitPpsRef.current = viewportW > 0 && L.total > 0 ? viewportW / L.total : 0;
  }, [segments, viewportW]);
  useEffect(() => {
    const total = buildLayout(segments).total;
    const fp = viewportW > 0 && total > 0 ? viewportW / total : 0;
    ppsRef.current = pps > 0 ? clamp(pps, fp, fp * ZOOM_MAX) : fp;
  }, [pps, segments, viewportW]);

  const hasRef = !!activeRef;

  const setViewportNode = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    roRef.current?.disconnect();
    if (node) {
      setViewportW(node.clientWidth);
      const ro = new ResizeObserver(() => setViewportW(node.clientWidth));
      ro.observe(node); roRef.current = ro;
    }
  }, []);
  useEffect(() => () => { roRef.current?.disconnect(); if (settleTimerRef.current) clearTimeout(settleTimerRef.current); }, []);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp && pendingScrollRef.current != null) {
      vp.scrollLeft = clamp(pendingScrollRef.current, 0, vp.scrollWidth - vp.clientWidth);
      pendingScrollRef.current = null;
      setScrollX(vp.scrollLeft);
    }
  }, [pps, viewportW]);

  // ── Entry change ────────────────────────────────────────────────────────────
  // Synchronous setState is intentional: resync all local state to the new reel.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const ref = activeRefRef.current;
    if (!ref) return;
    const state = ref.getTrimState();
    setPps(0); setSelection(null); setFrames([]); setThumbW(0); setSnapLineT(null); setReadout(null); setTrimEdge(null);
    setSegments([]); segmentsRef.current = [];
    pastRef.current = []; futureRef.current = [];
    setUndoDepth(0); setRedoDepth(0);
    setDuration(0); setCurrentTime(0); setIsPlaying(false);

    const v = ref.getVideoElement();
    const d = (v && v.duration && isFinite(v.duration)) ? v.duration : state.duration > 0 ? state.duration : 0;
    if (d > 0) {
      durRef.current = d;
      setDuration(d);
      const s = seedSegments(ref, d);
      const sorted = [...s].sort((a, b) => a.start - b.start);
      trimStartRef.current = sorted[0].start; trimEndRef.current = sorted[sorted.length - 1].end;
      setSegments(s); segmentsRef.current = s;
    }
    if (v) { setIsPlaying(!v.paused); setCurrentTime(v.currentTime); curTimeRef.current = v.currentTime; }
  }, [entryId, hasRef]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Live <video> events ─────────────────────────────────────────────────────
  useEffect(() => {
    const ref = activeRefRef.current;
    if (!ref) return;
    const v = ref.getVideoElement();
    if (!v) return;
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime  = () => {
      const ct = v.currentTime;
      curTimeRef.current = ct; setCurrentTime(ct);
      if (!v.paused) {
        const sorted = [...segmentsRef.current].sort((a, b) => a.start - b.start);
        if (sorted.length > 0) {
          const inSeg = sorted.some(s => ct >= s.start - 0.02 && ct < s.end);
          if (!inSeg) {
            const next = sorted.find(s => s.start > ct);
            if (next) v.currentTime = next.start;
            else if (ct < sorted[0].start) v.currentTime = sorted[0].start;
          }
        }
        const vp = viewportRef.current, p = ppsRef.current;
        if (vp && p > 0) {
          const x = srcToOut(ct, layoutRef.current) * p;
          if (x < vp.scrollLeft || x > vp.scrollLeft + vp.clientWidth)
            vp.scrollLeft = clamp(x - vp.clientWidth * 0.15, 0, vp.scrollWidth - vp.clientWidth);
        }
      }
    };
    const onDur = () => {
      if (!v.duration || !isFinite(v.duration)) return;
      const d = v.duration;
      const prevD = durRef.current;
      durRef.current = d;
      setDuration(d);
      const segs = segmentsRef.current;
      if (segs.length === 0) {
        const s = seedSegments(ref, d);
        const sorted = [...s].sort((a, b) => a.start - b.start);
        trimStartRef.current = sorted[0].start; trimEndRef.current = sorted[sorted.length - 1].end;
        setSegments(s); segmentsRef.current = s;
      } else if (segs.length === 1 && segs[0].start === 0 && Math.abs(segs[0].end - prevD) < 0.001) {
        // A full-length placeholder seeded before the real duration was known — stretch it. A restored
        // trim (end ≠ old duration) is deliberate and stays put.
        const s = [{ ...segs[0], end: d }];
        trimEndRef.current = d;
        setSegments(s); segmentsRef.current = s;
      }
    };
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime); v.addEventListener('durationchange', onDur);
    if (v.readyState >= 1 && v.duration && isFinite(v.duration)) onDur();
    return () => {
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime); v.removeEventListener('durationchange', onDur);
    };
  }, [entryId, hasRef]);

  // ── Filmstrip thumbnails (lazy, cached, DPR-aware, letterbox-cropped) ────────
  useEffect(() => {
    if (!videoSrc || duration <= 0) return;
    const src = videoSrc;
    const vpW = viewportRef.current?.clientWidth ?? 0;
    let cancelled = false;
    let blobUrl = '';
    const vid = document.createElement('video');
    vid.muted = true; vid.preload = 'auto'; vid.playsInline = true;
    const seekDraw = (t: number) => new Promise<void>(res => {
      const onS = () => { vid.removeEventListener('seeked', onS); res(); };
      vid.addEventListener('seeked', onS);
      vid.currentTime = t;
    });

    (async () => {
      const cached = thumbCache.get(src);
      if (cached) { if (!cancelled) { setThumbW(cached.w); setFrames(cached.frames); } return; }
      // Download once via the shared blob cache (the canvas reuses the same Blob for
      // fast, network-free scrubbing). Fall back to a direct (CORS) src if it fails.
      // A blob: src is ALREADY a local upload — seeking hits memory — so never re-download it into a
      // second Blob or swap the canvas (both pure waste, and the double-buffer ~2x's memory for a big file).
      const isLocal = src.startsWith('blob:');
      const blob = isLocal ? null : await getVideoBlob(src);
      if (cancelled) return;
      if (blob) {
        blobUrl = URL.createObjectURL(blob);
        vid.src = blobUrl;
        activeRefRef.current?.useLocalBlob?.();   // file is now local — tell the canvas to swap for fast seeks
      } else if (isLocal) {
        vid.src = src;   // already a local blob: URL — use directly (same-origin, no crossOrigin, no swap)
      } else { vid.crossOrigin = 'anonymous'; vid.src = src; }
      await new Promise<void>((res, rej) => {
        const onErr = () => rej(new Error('load failed'));
        if (vid.readyState >= 1) { vid.removeEventListener('error', onErr); res(); return; }
        vid.addEventListener('loadedmetadata', () => { vid.removeEventListener('error', onErr); res(); }, { once: true });
        vid.addEventListener('error', onErr, { once: true });
      }).catch(() => null);
      if (cancelled || !vid.videoWidth) return;
      const vW = vid.videoWidth, vH = vid.videoHeight;

      let bandTop = 0, bandBot = 1;
      try {
        const aw = 24, ah = 192;
        const ac = document.createElement('canvas'); ac.width = aw; ac.height = ah;
        const actx = ac.getContext('2d', { willReadFrequently: true })!;
        let uTop = 1, uBot = 0, ok = false;
        for (const frac of [0.25, 0.5, 0.75]) {
          if (cancelled) break;
          await seekDraw(duration * frac);
          actx.drawImage(vid, 0, 0, aw, ah);
          const data = actx.getImageData(0, 0, aw, ah).data;
          let t0 = -1, t1 = -1;
          for (let y = 0; y < ah; y++) {
            let s = 0;
            for (let x = 0; x < aw; x++) { const i = (y * aw + x) * 4; s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
            if (s / aw > 14) { if (t0 < 0) t0 = y; t1 = y; }
          }
          if (t0 >= 0) {
            const top = t0 / ah, bot = (t1 + 1) / ah;
            if (bot - top >= 0.25) { uTop = Math.min(uTop, top); uBot = Math.max(uBot, bot); ok = true; }
          }
        }
        if (ok && (uTop > 0.04 || uBot < 0.96)) { bandTop = uTop; bandBot = uBot; }
      } catch { /* tainted → keep full frame */ }
      if (cancelled) return;

      const sx = 0, sw = vW, sy = Math.round(bandTop * vH), sh = Math.max(1, Math.round((bandBot - bandTop) * vH));
      const thumbCssW = STRIP_H * (sw / sh);
      if (!cancelled) setThumbW(thumbCssW);
      // Denser than "just fill the viewport at fit" so the fixed-width strip still has
      // distinct frames when zoomed in or split into small clips (bounded for decode cost).
      const fitTiles = (vpW || thumbCssW * 16) / thumbCssW;
      const count = Math.max(24, Math.min(64, Math.round(Math.max(fitTiles * 2.5, duration / 10))));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement('canvas');
      off.width  = Math.round(thumbCssW * dpr);
      off.height = Math.round(STRIP_H * dpr);
      const ctx = off.getContext('2d')!;
      const results: Thumb[] = [];
      for (let i = 0; i < count; i++) {
        if (cancelled) break;
        const t = (i / (count - 1)) * duration;
        await seekDraw(t);
        try { ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, off.width, off.height); results.push({ t, url: off.toDataURL('image/jpeg', 0.72) }); }
        catch { /* tainted */ }
        if (!cancelled && (i % 6 === 5 || i === count - 1)) setFrames([...results]);
      }
      if (!cancelled && results.length) { thumbCache.set(src, { w: thumbCssW, frames: results }); setFrames(results); }
      vid.src = ''; if (blobUrl) URL.revokeObjectURL(blobUrl);
    })();

    return () => { cancelled = true; vid.src = ''; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [entryId, videoSrc, duration]);

  // ── Coordinate transforms (OUTPUT time) ─────────────────────────────────────
  const timeOfX = useCallback((clientX: number) => {
    const vp = viewportRef.current, p = ppsRef.current;
    if (!vp || p <= 0) return 0;
    const r = vp.getBoundingClientRect();
    return clamp((clientX - r.left + vp.scrollLeft) / p, 0, outDurRef.current);
  }, []);

  const snapOut = useCallback((targetOut: number, excludeSegId?: string) => {
    if (!snapEnabledRef.current) return { t: targetOut, at: null as number | null };
    const p = ppsRef.current;
    const cands: number[] = [0, outDurRef.current, srcToOut(curTimeRef.current, layoutRef.current)];
    for (const it of layoutRef.current.items) { if (it.seg.id === excludeSegId) continue; cands.push(it.out0, it.out1); }
    let best: number | null = null, bestD = Infinity;
    for (const c of cands) { const d = Math.abs(targetOut - c) * p; if (d <= SNAP_PX && d < bestD) { bestD = d; best = c; } }
    return best == null ? { t: targetOut, at: null } : { t: best, at: best };
  }, []);

  const seek = useCallback((srcT: number) => {
    const tq = clamp(qf(srcT), 0, durRef.current);
    curTimeRef.current = tq; setCurrentTime(tq);
    activeRefRef.current?.seekTo(tq);
  }, []);

  // ── Drag application ────────────────────────────────────────────────────────
  const applyDrag = useCallback((clientX: number) => {
    const drag = dragRef.current; if (!drag) return;
    const raw = timeOfX(clientX);

    if (drag.kind === 'playhead') {
      const { t, at } = snapOut(raw);
      setSnapLineT(at); setReadout({ t, text: fmtTC(t) });
      const srcT = qf(outToSrc(t, layoutRef.current));
      curTimeRef.current = srcT; setCurrentTime(srcT);
      activeRefRef.current?.seekTo(srcT);
      return;
    }

    // Trim — pure preview (no segment mutation until pointer-up); the OPPOSITE edge
    // stays fixed so the dragged edge follows the cursor and nothing reflows mid-drag.
    const it = drag.item!;
    const { t: snapped, at } = snapOut(raw, drag.segId);
    if (drag.side === 'start') {
      let ns = it.src0 + (snapped - it.out0);
      ns = clamp(qf(ns), drag.lo!, it.src1 - MIN_CLIP);
      const edgeOut = it.out0 + (ns - it.src0);
      pendingSrcRef.current = { start: ns };
      setTrimEdge({ segId: drag.segId!, side: 'start', out: edgeOut, src: ns });
      setReadout({ t: edgeOut, text: fmtTC(edgeOut) });
    } else {
      let ne = it.src0 + (snapped - it.out0);
      ne = clamp(qf(ne), it.src0 + MIN_CLIP, drag.hi!);
      const edgeOut = it.out0 + (ne - it.src0);
      pendingSrcRef.current = { end: ne };
      setTrimEdge({ segId: drag.segId!, side: 'end', out: edgeOut, src: ne });
      setReadout({ t: edgeOut, text: fmtTC(edgeOut) });
    }
    setSnapLineT(at);
  }, [timeOfX, snapOut]);

  const stopAutoScroll = useCallback(() => {
    if (autoRafRef.current) cancelAnimationFrame(autoRafRef.current);
    autoRafRef.current = 0; autoDirRef.current = 0;
  }, []);
  const updateAutoScroll = useCallback((clientX: number) => {
    const vp = viewportRef.current; if (!vp) return;
    const r = vp.getBoundingClientRect();
    autoDirRef.current = clientX < r.left + EDGE_PX ? -1 : clientX > r.right - EDGE_PX ? 1 : 0;
    if (autoDirRef.current !== 0 && !autoRafRef.current) {
      const loop = () => {
        const dir = autoDirRef.current;
        if (dir === 0 || !dragRef.current) { autoRafRef.current = 0; return; }
        vp.scrollLeft = clamp(vp.scrollLeft + dir * 16, 0, vp.scrollWidth - vp.clientWidth);
        setScrollX(vp.scrollLeft);
        applyDrag(lastClientXRef.current);
        autoRafRef.current = requestAnimationFrame(loop);
      };
      autoRafRef.current = requestAnimationFrame(loop);
    }
  }, [applyDrag]);

  // ── Editing ops ──────────────────────────────────────────────────────────────
  const pushHistory = useCallback((prev: Segment[]) => {
    pastRef.current = [...pastRef.current, prev].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    setUndoDepth(pastRef.current.length); setRedoDepth(0);
  }, []);
  const applySegments = useCallback((segs: Segment[]) => {
    setSegments(segs); segmentsRef.current = segs;
    if (segs.length === 0) return;
    const sorted = [...segs].sort((a, b) => a.start - b.start);
    trimStartRef.current = sorted[0].start; trimEndRef.current = sorted[sorted.length - 1].end;
    activeRefRef.current?.setTrimRange(trimStartRef.current, trimEndRef.current);
    // Mirror the clip list into the canvas so multi-cut edits persist (a single clip is just the trim
    // range above — store null to keep the saved framing lean).
    activeRefRef.current?.setSegments?.(
      sorted.length > 1 ? sorted.map(s => ({ start: s.start, end: s.end })) : null
    );
    setSelection(sel => (sel && segs.some(s => s.id === sel)) ? sel : null);
    const v = activeRefRef.current?.getVideoElement();
    if (v && !sorted.some(s => v.currentTime >= s.start && v.currentTime <= s.end)) {
      const next = sorted.find(s => s.start > v.currentTime);
      activeRefRef.current?.seekTo(next ? next.start : sorted[0].start);
    }
  }, []);
  const commit = useCallback((newSegs: Segment[]) => {
    const prev = segmentsRef.current;
    if (segsKey(prev) === segsKey(newSegs)) return;
    pushHistory(prev);
    applySegments(newSegs);
    setSettling(true);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => setSettling(false), 170);
  }, [pushHistory, applySegments]);
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, segmentsRef.current];
    setUndoDepth(pastRef.current.length); setRedoDepth(futureRef.current.length);
    applySegments(prev);
  }, [applySegments]);
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const nxt = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, segmentsRef.current];
    setUndoDepth(pastRef.current.length); setRedoDepth(futureRef.current.length);
    applySegments(nxt);
  }, [applySegments]);

  // ── Global pointer move/up ──────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      lastClientXRef.current = e.clientX;
      applyDrag(e.clientX);
      updateAutoScroll(e.clientX);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      stopAutoScroll();
      dragRef.current = null;
      setSnapLineT(null); setReadout(null);
      if (drag.kind === 'trim' && pendingSrcRef.current) {
        const p = pendingSrcRef.current; pendingSrcRef.current = null;
        const segs = segmentsRef.current;
        const newSegs = segs.map(s => s.id === drag.segId
          ? { ...s, ...(p.start != null ? { start: p.start } : {}), ...(p.end != null ? { end: p.end } : {}) }
          : s);
        commit(newSegs);
      }
      setTrimEdge(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyDrag, updateAutoScroll, stopAutoScroll, commit]);

  // ── Pointer-down entry points ───────────────────────────────────────────────
  const onRulerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); wrapperRef.current?.focus();
    dragRef.current = { kind: 'playhead' };
    lastClientXRef.current = e.clientX;
    applyDrag(e.clientX); updateAutoScroll(e.clientX);
  }, [applyDrag, updateAutoScroll]);
  const onTrackBgDown = useCallback((e: React.PointerEvent) => { setSelection(null); onRulerDown(e); }, [onRulerDown]);
  const onClipBodyDown = useCallback((e: React.PointerEvent, segId: string) => { e.stopPropagation(); wrapperRef.current?.focus(); setSelection(segId); }, []);
  const onTrimDown = useCallback((e: React.PointerEvent, segId: string, side: 'start' | 'end') => {
    e.stopPropagation(); wrapperRef.current?.focus(); setSelection(segId);
    const L = layoutRef.current;
    const idx = L.items.findIndex(it => it.seg.id === segId); if (idx < 0) return;
    const item = L.items[idx];
    const lo = idx > 0 ? L.items[idx - 1].src1 : 0;
    const hi = idx < L.items.length - 1 ? L.items[idx + 1].src0 : durRef.current;
    dragRef.current = { kind: 'trim', segId, side, frozen: L, item, lo, hi };
    pendingSrcRef.current = null;
    lastClientXRef.current = e.clientX;
    updateAutoScroll(e.clientX);
  }, [updateAutoScroll]);

  // ── Image-overlay lane ──────────────────────────────────────────────────────
  // Overlays live in SOURCE time on the canvas (like clip segments); the lane maps them through the
  // output layout so they sit correctly between cuts. Dragging previews in output px and commits a
  // source-time patch through the canvas ref on pointer-up.
  const ovList = overlays ?? [];
  const [ovSelection, setOvSelection] = useState<string | null>(null);
  const ovSelectionRef = useRef<string | null>(null);
  useEffect(() => { ovSelectionRef.current = ovSelection; }, [ovSelection]);
  useEffect(() => { setOvSelection(null); }, [entryId]);
  const [ovPreview, setOvPreview] = useState<{ id: string; leftPx: number; widthPx: number } | null>(null);
  const ovPendingRef = useRef<{ id: string; n0: number; n1: number } | null>(null);

  const onOverlayDown = useCallback((e: React.PointerEvent, id: string, mode: 'move' | 'start' | 'end') => {
    e.preventDefault(); e.stopPropagation(); wrapperRef.current?.focus();
    setOvSelection(id); setSelection(null);
    const o = (overlays ?? []).find(x => x.id === id); if (!o) return;
    const L = layoutRef.current;
    const out0 = srcToOut(o.start, L);
    const out1 = Math.max(out0 + MIN_OV, srcToOut(o.end, L));
    const startX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const p = ppsRef.current; if (p <= 0) return;
      const d = (ev.clientX - startX) / p;
      let n0 = out0, n1 = out1;
      if (mode === 'move') {
        const len = out1 - out0;
        n0 = clamp(out0 + d, 0, Math.max(0, outDurRef.current - len));
        n1 = n0 + len;
      } else if (mode === 'start') {
        n0 = clamp(out0 + d, 0, out1 - MIN_OV);
      } else {
        n1 = clamp(out1 + d, out0 + MIN_OV, outDurRef.current);
      }
      ovPendingRef.current = { id, n0, n1 };
      setOvPreview({ id, leftPx: n0 * p, widthPx: (n1 - n0) * p });
      setReadout({ t: mode === 'end' ? n1 : n0, text: fmtTC(mode === 'end' ? n1 : n0) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setOvPreview(null); setReadout(null);
      const pend = ovPendingRef.current; ovPendingRef.current = null;
      if (pend && pend.id === id) {
        const L2 = layoutRef.current;
        activeRefRef.current?.updateOverlay?.(id, {
          start: qf(outToSrc(pend.n0, L2)),
          end:   qf(outToSrc(pend.n1, L2)),
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [overlays]);

  const removeOverlayById = useCallback((id: string) => {
    setOvSelection(prev => (prev === id ? null : prev));
    activeRefRef.current?.removeOverlay?.(id);
  }, []);

  // ── Zoom (px per output second) ─────────────────────────────────────────────
  const zoomTo = useCallback((nextPps: number, anchorOut: number) => {
    const vp = viewportRef.current;
    const np = clamp(nextPps, fitPpsRef.current, fitPpsRef.current * ZOOM_MAX);
    if (!vp) { setPps(np); return; }
    const oldPps = ppsRef.current;
    pendingScrollRef.current = anchorOut * np - (anchorOut * oldPps - vp.scrollLeft);
    setPps(np);
  }, []);
  const zoomBy  = useCallback((f: number) => zoomTo(ppsRef.current * f, srcToOut(curTimeRef.current, layoutRef.current)), [zoomTo]);
  const zoomFit = useCallback(() => { pendingScrollRef.current = 0; setPps(fitPpsRef.current); }, []);
  const onViewportScroll = useCallback(() => {
    const vp = viewportRef.current; if (!vp || scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => { scrollRafRef.current = 0; setScrollX(vp.scrollLeft); });
  }, []);
  useEffect(() => {
    const vp = viewportRef.current; if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      zoomTo(ppsRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), timeOfX(e.clientX));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [viewportW, zoomTo, timeOfX]);

  const cutAtPlayhead = useCallback(() => {
    const v = activeRefRef.current?.getVideoElement();
    const t = qf(v ? v.currentTime : curTimeRef.current);
    const segs = segmentsRef.current;
    const idx = segs.findIndex(s => t > s.start + MIN_CLIP && t < s.end - MIN_CLIP);
    if (idx < 0) return;
    const seg = segs[idx];
    commit([
      ...segs.slice(0, idx),
      { id: `${seg.id}a`, start: seg.start, end: t },
      { id: `${seg.id}b`, start: t, end: seg.end },
      ...segs.slice(idx + 1),
    ]);
  }, [commit]);
  const removeSegment = useCallback((segId: string) => {
    const segs = segmentsRef.current;
    if (segs.length <= 1) return;
    setSelection(null);
    commit(segs.filter(s => s.id !== segId));
  }, [commit]);
  const trimToPlayhead = useCallback((side: 'in' | 'out') => {
    const t = qf(curTimeRef.current);
    const segs = segmentsRef.current;
    const idx = segs.findIndex(s => t > s.start && t < s.end);
    if (idx < 0) return;
    const seg = segs[idx];
    commit(segs.map(s => s.id === seg.id
      ? (side === 'in' ? { ...s, start: Math.min(t, s.end - MIN_CLIP) } : { ...s, end: Math.max(t, s.start + MIN_CLIP) })
      : s));
  }, [commit]);

  // Step through the OUTPUT (skips removed source ranges)
  const stepFrames = useCallback((n: number) => {
    const out = srcToOut(curTimeRef.current, layoutRef.current) + n / FPS;
    seek(outToSrc(clamp(out, 0, outDurRef.current), layoutRef.current));
  }, [seek]);
  const gotoEdit = useCallback((dir: 1 | -1) => {
    const edges = new Set<number>([0, outDurRef.current]);
    for (const it of layoutRef.current.items) { edges.add(it.out0); edges.add(it.out1); }
    const sorted = [...edges].sort((a, b) => a - b);
    const cur = srcToOut(curTimeRef.current, layoutRef.current);
    const target = dir > 0 ? sorted.find(e => e > cur + 1e-4) : [...sorted].reverse().find(e => e < cur - 1e-4);
    if (target != null) seek(outToSrc(target, layoutRef.current));
  }, [seek]);

  const stopShuttle = useCallback(() => {
    if (shuttleRef.current?.raf) cancelAnimationFrame(shuttleRef.current.raf);
    shuttleRef.current = null;
    const v = activeRefRef.current?.getVideoElement();
    if (v) v.playbackRate = 1;
  }, []);
  const shuttleFwd = useCallback(() => {
    const v = activeRefRef.current?.getVideoElement(); if (!v) return;
    stopShuttle();
    v.playbackRate = v.paused || v.playbackRate >= 4 ? 1 : Math.min(4, v.playbackRate * 2);
    activeRefRef.current?.play();
  }, [stopShuttle]);
  const shuttleRev = useCallback(() => {
    const v = activeRefRef.current?.getVideoElement(); if (!v) return;
    const rate = Math.min(8, (shuttleRef.current?.rate ?? 1) * 2);
    if (shuttleRef.current?.raf) cancelAnimationFrame(shuttleRef.current.raf);
    v.pause();
    const st = { raf: 0, rate, last: performance.now() };
    shuttleRef.current = st;
    const loop = (ts: number) => {
      if (shuttleRef.current !== st) return;
      const dt = (ts - st.last) / 1000; st.last = ts;
      const t = curTimeRef.current - st.rate * dt;
      if (t <= trimStartRef.current) { seek(trimStartRef.current); stopShuttle(); return; }
      seek(t);
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  }, [seek, stopShuttle]);
  useEffect(() => () => stopShuttle(), [stopShuttle]);

  // ── Keyboard (scoped to the timeline) ───────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey) return;
    const ref = activeRefRef.current; if (!ref) return;
    const v = ref.getVideoElement();
    const hit = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case ' ':         hit(); stopShuttle(); if (v) { if (v.paused) ref.play(); else ref.pause(); } break;
      case 'ArrowLeft': hit(); stepFrames(e.shiftKey ? -5 : -1); break;
      case 'ArrowRight':hit(); stepFrames(e.shiftKey ? 5 : 1); break;
      case 'ArrowUp':   hit(); gotoEdit(-1); break;
      case 'ArrowDown': hit(); gotoEdit(1); break;
      case 'Home':      hit(); seek(trimStartRef.current); break;
      case 'End':       hit(); seek(trimEndRef.current); break;
      case 'c': case 'C': case 'b': case 'B': hit(); cutAtPlayhead(); break;
      case 's': case 'S': hit(); setSnapEnabled(x => !x); break;
      case 'i': case 'I': hit(); trimToPlayhead('in'); break;
      case 'o': case 'O': hit(); trimToPlayhead('out'); break;
      case 'l': case 'L': hit(); shuttleFwd(); break;
      case 'k': case 'K': hit(); stopShuttle(); ref.pause(); break;
      case 'j': case 'J': hit(); shuttleRev(); break;
      case '\\':        hit(); zoomFit(); break;
      case '=': case '+': hit(); zoomBy(1.5); break;
      case '-': case '_': hit(); zoomBy(1 / 1.5); break;
      case 'Delete': case 'Backspace':
        if (ovSelectionRef.current) { hit(); removeOverlayById(ovSelectionRef.current); }
        else if (selectionRef.current && segmentsRef.current.length > 1) { hit(); removeSegment(selectionRef.current); } break;
      case 'Escape': if (ovSelectionRef.current) { hit(); setOvSelection(null); } else if (selectionRef.current) { hit(); setSelection(null); } break;
    }
  }, [seek, stepFrames, gotoEdit, cutAtPlayhead, removeSegment, removeOverlayById, trimToPlayhead, shuttleFwd, shuttleRev, stopShuttle, zoomFit, zoomBy]);

  useEffect(() => {
    onHistory?.({ undo, redo, canUndo: undoDepth > 0, canRedo: redoDepth > 0 });
    return () => onHistory?.({ undo: () => {}, redo: () => {}, canUndo: false, canRedo: false });
  }, [onHistory, undo, redo, undoDepth, redoDepth]);

  if (!activeRef || duration <= 0) return null;

  // ── Derived layout / geometry (OUTPUT time) ─────────────────────────────────
  // Segments are NOT mutated mid-trim (trim is a pure preview via trimEdge), so the
  // committed layout is also the "frozen" layout during a drag — no extra state needed.
  const committed = buildLayout(segments);
  const totalOut  = committed.total;
  const fitPps    = viewportW > 0 && totalOut > 0 ? viewportW / totalOut : 0;
  const effPps    = pps > 0 ? clamp(pps, fitPps, fitPps * ZOOM_MAX) : fitPps;

  const isRecording = recordingState?.isRecording ?? false;
  const recProgress = recordingState?.recProgress ?? 0;
  const recStatus   = recordingState?.recStatus   ?? '';

  const contentW = totalOut * effPps;
  const X        = (outT: number) => outT * effPps;

  // Clip rects + the source in-point the strip should start from. The in-progress trim
  // edge is applied as a pure visual override (srcIn shifts for a head-trim preview).
  const renderItems = committed.items.map(it => {
    let o0 = it.out0, o1 = it.out1, srcIn = it.src0;
    if (trimEdge && it.seg.id === trimEdge.segId) {
      if (trimEdge.side === 'start') { o0 = trimEdge.out; srcIn = trimEdge.src; }
      else o1 = trimEdge.out;
    }
    return { seg: it.seg, srcIn, leftPx: X(o0), widthPx: X(o1 - o0) };
  });

  const hasOvLane = ovList.length > 0;
  // Narration voices as audio-channel blocks (below the clips, where audio tracks live in editors).
  const audioTakes = ovList.flatMap(o =>
    (o.audioTakes ?? []).map(t => ({ ...t, audioStart: o.audioStart ?? o.start, audioRate: o.audioRate ?? 1 })));
  const hasAudLane = audioTakes.length > 0;
  const laneH     = RULER_H + (hasOvLane ? OV_H + 2 : 0) + STRIP_H + (hasAudLane ? AUD_H + 2 : 0);
  const clipTop   = RULER_H + (hasOvLane ? OV_H + 2 : 0);
  const audTop    = clipTop + STRIP_H + 2;

  const playOut  = srcToOut(currentTime, committed);
  const trimStart = committed.items[0]?.src0 ?? 0;
  const trimEnd   = committed.items[committed.items.length - 1]?.src1 ?? duration;
  const atFit     = effPps <= fitPps * 1.0001;

  // Ruler ticks (virtualised to the visible window) in OUTPUT time
  const visStart = effPps > 0 ? (scrollX - 80) / effPps : 0;
  const visEnd   = effPps > 0 ? (scrollX + viewportW + 80) / effPps : totalOut;
  const majInt   = TICKS.find(iv => iv * effPps >= 76) ?? TICKS[TICKS.length - 1];
  const minInt   = majInt / (majInt < 1 ? 1 : 5);
  const ticks: { t: number; major: boolean }[] = [];
  if (effPps > 0) {
    const first = Math.max(0, Math.floor(visStart / minInt) * minInt);
    for (let t = first; t <= Math.min(totalOut, visEnd); t += minInt) {
      const tt = +t.toFixed(4);
      ticks.push({ t: tt, major: Math.abs(tt / majInt - Math.round(tt / majInt)) < 0.001 });
    }
  }

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="shrink-0 mx-3 mb-3 rounded-lg border border-line bg-surface-1 px-4 py-3 flex flex-col gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent-border"
    >
      {/* ── Transport row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center">
        <div className="flex-1 flex items-center gap-1.5">
          <Tooltip content="Split at playhead (C)">
            <IconButton size="sm" label="Split at playhead" onClick={cutAtPlayhead}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>
                </svg>
              } />
          </Tooltip>
          <Tooltip content={ovSelection ? 'Delete image (Del)' : 'Delete clip (Del)'}>
            <IconButton size="sm" variant="danger" label={ovSelection ? 'Delete image' : 'Delete clip'} disabled={ovSelection === null && (selection === null || segments.length <= 1)}
              onClick={() => { if (ovSelection) removeOverlayById(ovSelection); else if (selection && segments.length > 1) removeSegment(selection); }}
              icon={<TrashIcon size={14} strokeWidth={1.8} />} />
          </Tooltip>
          <div className="mx-1 h-4 w-px bg-line" />
          <Tooltip content={`Snapping ${snapEnabled ? 'on' : 'off'} (S)`}>
            <IconButton size="sm" label="Toggle snapping" active={snapEnabled} onClick={() => setSnapEnabled(x => !x)}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 4H3v7a9 9 0 0 0 18 0V4h-4v7a5 5 0 0 1-10 0z"/><line x1="3" y1="8" x2="7" y2="8"/><line x1="17" y1="8" x2="21" y2="8"/>
                </svg>
              } />
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip content="Go to start (Home)">
            <IconButton size="sm" label="Go to start" onClick={() => seek(trimStart)}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="2.5" height="16" rx="1"/><polygon points="20,4 8,12 20,20"/></svg>} />
          </Tooltip>
          <IconButton size="sm" label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={() => isPlaying ? activeRef.pause() : activeRef.play()}
            icon={isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} />} />
          <Tooltip content="Go to end (End)">
            <IconButton size="sm" label="Go to end" onClick={() => seek(trimEnd)}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="17.5" y="4" width="2.5" height="16" rx="1"/><polygon points="4,4 16,12 4,20"/></svg>} />
          </Tooltip>
          <span className="ml-1.5 text-caption tabular-nums leading-none">
            <span className="text-fg">{fmtTC(playOut)}</span>
            <span className="text-fg-4"> / {fmtTC(totalOut)}</span>
          </span>
        </div>

        <div className="flex-1 flex items-center justify-end gap-1.5">
          <Tooltip content="Zoom to fit (\\)">
            <IconButton size="sm" label="Zoom to fit" disabled={atFit} onClick={zoomFit}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>} />
          </Tooltip>
          <Tooltip content="Zoom out (-)">
            <IconButton size="sm" label="Zoom out" disabled={atFit} onClick={() => zoomBy(1 / 1.5)} icon={<MinusIcon size={12} />} />
          </Tooltip>
          <Slider min={0} max={100} step={1} neutral showValue={false} className="w-24"
            value={fitPps > 0 ? Math.round(clamp(100 * Math.log(effPps / fitPps) / Math.log(ZOOM_MAX), 0, 100)) : 0}
            onChange={v => zoomTo(fitPps * Math.pow(ZOOM_MAX, v / 100), srcToOut(curTimeRef.current, committed))} />
          <Tooltip content="Zoom in (=)">
            <IconButton size="sm" label="Zoom in" disabled={effPps >= fitPps * ZOOM_MAX - 0.001} onClick={() => zoomBy(1.5)} icon={<PlusIcon size={12} />} />
          </Tooltip>
        </div>
      </div>

      {/* ── Timeline viewport (scrolls horizontally when zoomed in) ───────────── */}
      <div
        ref={setViewportNode}
        onScroll={onViewportScroll}
        className="relative w-full overflow-x-auto overflow-y-hidden rounded-md bg-page select-none"
        style={{ height: laneH }}
      >
        <div className="relative" style={{ width: Math.max(contentW, viewportW), height: laneH }}>

          {/* Ruler band */}
          <div className="absolute top-0 left-0 right-0 bg-surface-2 border-b border-line cursor-col-resize" style={{ height: RULER_H }} onPointerDown={onRulerDown}>
            {ticks.map(({ t, major }) => {
              const edge = t < majInt * 0.5 ? 'start' : t > totalOut - majInt * 0.5 ? 'end' : 'mid';
              return (
                <div key={t} className="absolute bottom-0" style={{ left: X(t), transform: 'translateX(-50%)' }}>
                  {major && (
                    <span className="absolute bottom-[7px] text-[10px] tabular-nums leading-none text-fg-3 whitespace-nowrap"
                      style={{ left: 0, transform: edge === 'start' ? 'translateX(0)' : edge === 'end' ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                      {fmtTC(t)}
                    </span>
                  )}
                  <div className={major ? 'w-px bg-line-strong' : 'w-px bg-line'} style={{ height: major ? 7 : 4 }} />
                </div>
              );
            })}
          </div>

          {/* Image-overlay lane (above the clips — overlays draw on top of the video) */}
          {hasOvLane && (
            <div className="absolute left-0 right-0 bg-surface-2/60 border-b border-line/60" style={{ top: RULER_H, height: OV_H }} onPointerDown={e => { setOvSelection(null); onTrackBgDown(e); }}>
              {ovList.map(o => {
                const out0 = srcToOut(o.start, committed);
                const out1 = Math.max(out0 + MIN_OV, srcToOut(o.end, committed));
                const pv = ovPreview && ovPreview.id === o.id ? ovPreview : null;
                const leftPx = pv ? pv.leftPx : X(out0);
                const widthPx = Math.max(8, pv ? pv.widthPx : X(out1 - out0));
                const sel = ovSelection === o.id;
                return (
                  <div
                    key={o.id}
                    className={`group absolute inset-y-[3px] rounded-[4px] overflow-hidden cursor-grab active:cursor-grabbing ${sel ? 'z-20' : 'z-10'}`}
                    style={{ left: leftPx, width: widthPx, background: 'var(--blue-tint)', boxShadow: sel ? 'inset 0 0 0 1.5px var(--blue-400)' : 'inset 0 0 0 1px var(--blue-border)' }}
                    onPointerDown={e => onOverlayDown(e, o.id, 'move')}
                    title={o.name}
                  >
                    <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] leading-none text-fg-2 truncate pointer-events-none">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                      <span className="truncate">{o.name || 'Image'}</span>
                    </span>
                    <div className="absolute inset-y-0 left-0 w-2 z-30 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={e => onOverlayDown(e, o.id, 'start')}>
                      <div className="absolute inset-y-1 left-0 w-[3px] rounded-r-sm" style={{ background: 'var(--blue-400)' }} />
                    </div>
                    <div className="absolute inset-y-0 right-0 w-2 z-30 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={e => onOverlayDown(e, o.id, 'end')}>
                      <div className="absolute inset-y-1 right-0 w-[3px] rounded-l-sm" style={{ background: 'var(--blue-400)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Clip lane */}
          <div className="absolute left-0 right-0 bg-surface-2" style={{ top: clipTop, height: STRIP_H }} onPointerDown={e => { setOvSelection(null); onTrackBgDown(e); }}>
            {renderItems.map((it, i) => (
              <Clip key={it.seg.id} segId={it.seg.id} index={i} leftPx={it.leftPx} widthPx={it.widthPx}
                frames={frames} thumbW={thumbW} srcIn={it.srcIn} effPps={effPps}
                viewLeft={scrollX} viewRight={scrollX + viewportW} selected={selection === it.seg.id}
                settling={settling} onBodyDown={onClipBodyDown} onTrimDown={onTrimDown} />
            ))}
          </div>

          {/* Narration audio-channel lane (voices as colored blocks, mapped to source time) */}
          {hasAudLane && (
            <div className="absolute left-0 right-0 bg-surface-2/60 border-t border-line/60" style={{ top: audTop, height: AUD_H }}>
              {audioTakes.map((t, i) => {
                const s0 = t.audioStart + t.start * t.audioRate;
                const s1 = s0 + t.duration * t.audioRate;
                const out0 = srcToOut(s0, committed);
                const out1 = Math.max(out0 + 0.05, srcToOut(s1, committed));
                const color = voiceColors?.[t.voiceId] ?? 'var(--blue-400)';
                const name = voiceNames?.[t.voiceId] ?? 'Voice';
                return (
                  <div
                    key={i}
                    className="absolute inset-y-[2px] rounded-[3px] overflow-hidden pointer-events-auto"
                    style={{ left: X(out0), width: Math.max(6, X(out1 - out0)), background: `${color}38`, boxShadow: `inset 0 0 0 1px ${color}` }}
                    title={`${name} — ${t.duration.toFixed(1)}s`}
                  >
                    <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 text-[9px] leading-none truncate pointer-events-none" style={{ color }}>
                      {name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Snap indicator (green) */}
          {snapLineT != null && <div className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-40" style={{ left: X(snapLineT) }} />}

          {/* Playhead / CTI — flag head grabbable in the ruler; the line never blocks clips */}
          <div className="absolute top-0 bottom-0 z-50 -translate-x-1/2 pointer-events-none" style={{ left: X(playOut), width: 14 }}>
            <div className="absolute top-0 left-0 right-0 pointer-events-auto cursor-grab active:cursor-grabbing" style={{ height: RULER_H }} onPointerDown={onRulerDown}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid var(--white)' }} />
            </div>
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1.5px] bg-white/90 shadow-1" />
          </div>

          {readout && (
            <div className="absolute z-50 -translate-x-1/2 pointer-events-none rounded-md bg-surface-overlay border border-line shadow-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg whitespace-nowrap"
              style={{ left: X(readout.t), top: RULER_H + 3 }}>
              {readout.text}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="text-caption tabular-nums text-fg-3">{segments.length > 1 ? `${segments.length} clips · ` : ''}{fmtTC(totalOut)}</span>
        <div className="flex-1" />
        {isRecording ? (
          <div className="flex items-center gap-3 shrink-0">
            <ProgressBar tone="accent" value={Math.round(recProgress * 100)} className="w-28 h-1" />
            <span className="text-caption text-fg-3 tabular-nums">{recStatus || `${Math.round(recProgress * 100)}%`}</span>
            <button onClick={() => activeRef.cancelExport()} className="text-caption text-danger-text hover:brightness-110 transition-colors focus-ring rounded-sm">Cancel</button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => { (guardExport ? guardExport(() => activeRef.startDownload()) : activeRef.startDownload())?.catch((err: unknown) => console.error('[reel export]', err)); }} leadingIcon={<DownloadIcon size={14} />} className="rounded-full shrink-0">
            Export
          </Button>
        )}
      </div>
    </div>
  );
}
