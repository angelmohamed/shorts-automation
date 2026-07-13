'use client';

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';

import {
  CANVAS_W, CANVAS_H, DISPLAY_SCALE,
  BASE_HEADER_HEIGHT, CAPTION_LINE_HEIGHT, HEADER_PADDING_X,
} from './constants';
import type { Box, ClipSegment, Framing, ImageOverlay, TikTokCanvasProps, TikTokCanvasRef } from './types';
import { getOverlayImage, deleteOverlayImage } from '@/lib/localVideoStore';
import { drawHeaderOnContext, computeSonotradeHeaderHeight } from './drawing/drawHeader';
import { drawReelCells, drawFreeElements, reelLayout, reelVideoRect, ensureReelTextFontsLoaded, shiftFreeElementsForReelCrop, reelFreeElementDrawnRect } from './drawing/drawReelCell';
import { drawMarketRow } from './drawing/drawMarketRow';
import { resolveTwitterTemplateSettings } from '../twitterTemplateTypes';
import { VideoOverlays } from './ui/VideoOverlays';
import { useVideoLoading } from './hooks/useVideoLoading';
import { useRecording } from './hooks/useRecording';

export type { TikTokCanvasRef, MarketData, SparkPoint } from './types';

export const TikTokCanvas = forwardRef<TikTokCanvasRef, TikTokCanvasProps>(function TikTokCanvas({
  videoSrc,
  videoId,
  rowNumber = 0,
  onVideoError,
  brand = 'sonotrade',
  overlayLogoSrc = '/templatelogo.png',
  overlayDisplayName = 'Sonotrade',
  overlayHandle = '@SonotradeHQ',
  overlayVerified = true,
  overlayCaption = '',
  marketData = null,
  twitterSettings,
  onRecordingStateChange,
  initialFraming = null,
  onFramingChange,
  onOverlaysChange,
}: TikTokCanvasProps, ref) {
  // Resolved overlay style (defaults reproduce the original look). twKey lets the draw loop restart
  // only when the style actually changes, not on every render.
  const tw = resolveTwitterTemplateSettings(twitterSettings);
  const twKey = JSON.stringify(twitterSettings ?? null);
  // The video is fit to this width (CANVAS_W − 2·padding); the outer padding insets cells + video alike.
  const videoTargetW = CANVAS_W - 2 * (tw.cellMargin ?? 60);
  const videoBandHeight = tw.videoBandHeight ?? 900;
  // Reel cell layout for normal Twitter reels; market reels keep the old header-above-video layout.
  const cellMode = brand !== 'clean' && !marketData;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);   // latest scrub target while a seek is in flight
  const blobSwapRef = useRef(false);                    // true while swapping the <video> to a local blob
  const raf = useRef(0);

  const verifiedImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const marketAvatarImgRef = useRef<HTMLImageElement | null>(null);
  const cellImgRef = useRef<Map<string, HTMLImageElement>>(new Map());   // lazy cache of cell images by url
  const marketAvatarUrlRef = useRef<string | null>(null);

  const videoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const videoScaleRef = useRef<number>(1);
  const [videoScale, setVideoScale] = useState(1);

  const boxRef = useRef<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });

  const [includeEdit, setIncludeEdit] = useState(false);
  const includeEditRef = useRef(false);

  // Timeline clip list (multi-cut edits), owned by the canvas so it persists with the framing and
  // survives the timeline panel unmounting. null = simple trim; the timeline seeds itself from this.
  const timelineSegmentsRef = useRef<ClipSegment[] | null>(null);

  // ── Image overlays — layers drawn on top of the video, visible inside their [start,end] window ──
  const [overlays, setOverlays] = useState<ImageOverlay[]>([]);
  const overlaysRef = useRef<ImageOverlay[]>([]);
  const overlayImgsRef = useRef<Map<string, HTMLImageElement>>(new Map());   // id → decoded image
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => { logoImgRef.current = null; }, [overlayLogoSrc]);

  // Reel text cells may use Google/custom fonts; ensure they're loaded so the draw loop renders them (not a fallback).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cellMode) void ensureReelTextFontsLoaded(tw); }, [twKey, cellMode]);

  // ── Hooks ────────────────────────────────────────────────────────────────────

  const {
    isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef, swapToLocalBlob,
  } = useVideoLoading({
    videoRef, videoSrc, brand, rowNumber, videoId, videoTargetW, videoBandHeight, cellMode,
    boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError, blobSwapRef,
  });

  // Video zoom is controlled ONLY by the Adjust flyout's Zoom slider (TikTokCanvasRef.setZoom). The old
  // canvas gesture-zoom (two-finger pinch / Ctrl+wheel → usePanZoom) was removed so a stray scroll or
  // trackpad pinch over a reel can't change its framing — Ctrl+wheel now falls through to the page view-zoom.

  // Notify the workspace when framing changes (crop resize, zoom, trim, OR panning the video inside the
  // crop). Panning only mutates videoOffsetRef, so useDrag's onChange (drag-end) is the signal for it.
  const onFramingChangeRef = useRef(onFramingChange);
  useEffect(() => { onFramingChangeRef.current = onFramingChange; });
  const notifyFraming = useCallback(() => onFramingChangeRef.current?.(), []);

  const onOverlaysChangeRef = useRef(onOverlaysChange);
  useEffect(() => { onOverlaysChangeRef.current = onOverlaysChange; });
  // Single write path for the overlay list: refs for the draw/export loops, state for the editing UI,
  // the workspace callback for the timeline, and (usually) a framing notification for autosave.
  const commitOverlays = useCallback((next: ImageOverlay[], opts: { silent?: boolean } = {}) => {
    overlaysRef.current = next;
    setOverlays(next);
    onOverlaysChangeRef.current?.(next);
    if (!opts.silent) notifyFraming();
  }, [notifyFraming]);

  // Re-hydrate restored overlays: a saved overlay comes back without `src` (object URLs don't survive
  // a reload) — load its blob from IndexedDB and mint a fresh URL.
  useEffect(() => {
    for (const o of overlays) {
      if (o.src) continue;
      void getOverlayImage(o.id).then(hit => {
        if (!hit) return;
        const src = URL.createObjectURL(hit.blob);
        if (!overlaysRef.current.some(x => x.id === o.id && !x.src)) { URL.revokeObjectURL(src); return; }
        commitOverlays(overlaysRef.current.map(x => (x.id === o.id && !x.src ? { ...x, src } : x)), { silent: true });
      });
    }
  }, [overlays, commitOverlays]);

  // Lazily decode an overlay's image for the draw loops.
  const getOverlayImg = useCallback((o: ImageOverlay): HTMLImageElement | null => {
    if (!o.src) return null;
    let img = overlayImgsRef.current.get(o.id);
    if (!img) { img = new Image(); img.src = o.src; overlayImgsRef.current.set(o.id, img); }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }, []);

  // ── Overlay canvas interactions: drag to move, corner handle to resize (aspect kept) ──
  const overlayDragRef = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; base: ImageOverlay } | null>(null);
  const startOverlayDrag = useCallback((e: React.PointerEvent, id: string, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    const o = overlaysRef.current.find(x => x.id === id);
    if (!o) return;
    setSelectedOverlayId(id);
    overlayDragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, base: { ...o } };
    isDraggingRef.current = true;   // draw loop: full framerate while the gesture is live
    const onMove = (ev: PointerEvent) => {
      const drag = overlayDragRef.current; if (!drag) return;
      const rect = canvasRef.current?.getBoundingClientRect(); if (!rect || rect.width === 0) return;
      const scale = rect.width / CANVAS_W;   // includes DISPLAY_SCALE and the page's CSS zoom
      const dx = (ev.clientX - drag.startX) / scale;
      const dy = (ev.clientY - drag.startY) / scale;
      const b = drag.base;
      let patch: Partial<ImageOverlay>;
      if (drag.mode === 'move') {
        patch = {
          x: Math.max(-b.w + 40, Math.min(CANVAS_W - 40, b.x + dx)),
          y: Math.max(-b.h + 40, Math.min(CANVAS_H - 40, b.y + dy)),
        };
      } else {
        const w = Math.max(60, b.w + dx);
        patch = { w, h: w * (b.h / b.w) };
      }
      commitOverlays(overlaysRef.current.map(x => (x.id === drag.id ? { ...x, ...patch } : x)), { silent: true });
    };
    const onUp = () => {
      overlayDragRef.current = null;
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      notifyFraming();   // one autosave signal per gesture, not per pointermove
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [commitOverlays, notifyFraming]);

  const removeOverlayFn = useCallback((id: string) => {
    const doomed = overlaysRef.current.find(x => x.id === id);
    if (doomed?.src) URL.revokeObjectURL(doomed.src);
    overlayImgsRef.current.delete(id);
    commitOverlays(overlaysRef.current.filter(x => x.id !== id));
    setSelectedOverlayId(prev => (prev === id ? null : prev));
    void deleteOverlayImage(id);
  }, [commitOverlays]);

  // Crop editing was removed (the video always fills the canvas), so nothing drags any more.
  const isDraggingRef = useRef(false);

  const { isRecording, recProgress, recStatus, startRecording, cancelRecording } = useRecording({
    canvasRef, videoRef, brand, rowNumber, videoId,
    boxRef, videoOffsetRef, videoScaleRef,
    trimStartRef, trimEndRef, includeEditRef,
    logoImgRef, verifiedImgRef,
    overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
    marketData, marketAvatarImgRef, marketAvatarUrlRef,
    twitterSettings: tw,
    overlaysRef, overlayImgsRef,
  });

  // Re-apply a saved framing (crop/pan/zoom/trim). Setters from useState/useVideoLoading are stable.
  const applyFramingFn = useCallback((f: Framing) => {
    // Saved crop boxes are deliberately IGNORED: cropping was removed, so the box always stays the
    // full-canvas band that calcVideoBox seeds — including for reels saved before the change.
    if (f.videoOffset) videoOffsetRef.current = { ...f.videoOffset };
    if (typeof f.videoScale === 'number') {
      const c = Math.max(0.5, Math.min(3, f.videoScale));
      videoScaleRef.current = c; setVideoScale(c);
    }
    if (typeof f.trimStart === 'number') { trimStartRef.current = f.trimStart; setTrimStart(f.trimStart); }
    if (typeof f.trimEnd === 'number') { trimEndRef.current = f.trimEnd; setTrimEnd(f.trimEnd); }
    if (typeof f.includeEdit === 'boolean') { includeEditRef.current = f.includeEdit; setIncludeEdit(f.includeEdit); }
    timelineSegmentsRef.current = Array.isArray(f.segments) && f.segments.length
      ? f.segments.map(s => ({ start: s.start, end: s.end }))
      : null;
    if (Array.isArray(f.overlays)) {
      commitOverlays(f.overlays.map(o => ({ ...o })), { silent: true });   // src re-hydrates from IndexedDB
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useVideoLoading resets framing whenever a video (re)loads. So restore a saved reel's framing only
  // AFTER loading finishes, once per source — otherwise the reset would clobber it.
  const framingAppliedSrcRef = useRef<string | null>(null);
  // Current source + saved-framing prop, readable from getFraming() without a stale imperative closure.
  const videoSrcRef = useRef(videoSrc); videoSrcRef.current = videoSrc;
  const initialFramingRef = useRef(initialFraming); initialFramingRef.current = initialFraming;
  // Readable from getFraming(): while true, boxRef is still the full-canvas placeholder, not the band.
  const isVideoLoadingRef = useRef(isVideoLoading); isVideoLoadingRef.current = isVideoLoading;
  useEffect(() => {
    if (isVideoLoading || !initialFraming || !videoSrc) return;
    if (framingAppliedSrcRef.current === videoSrc) return;
    framingAppliedSrcRef.current = videoSrc;
    applyFramingFn(initialFraming);
  }, [isVideoLoading, initialFraming, videoSrc, applyFramingFn]);

  // Also fire on state-backed framing changes (crop resize / zoom / trim / include-edit). Pan is covered
  // by useDrag's onChange above. Skips the initial mount.
  const framingMountedRef = useRef(false);
  useEffect(() => {
    if (!framingMountedRef.current) { framingMountedRef.current = true; return; }
    notifyFraming();
  }, [box, videoScale, trimStart, trimEnd, includeEdit, notifyFraming]);

  useImperativeHandle(ref, () => ({
    startDownload: () => (!isRecording ? startRecording().then(() => undefined) : Promise.resolve()),
    exportBlob: async () => (!isRecording ? ((await startRecording({ returnBlob: true })) ?? null) : null),
    cancelExport: cancelRecording,
    play: () => { const v = videoRef.current; if (v) v.play(); },
    pause: () => { const v = videoRef.current; if (v) v.pause(); },
    // Coalesce rapid scrub seeks: only one seek in flight, always re-target to the
    // latest position when it completes (drops intermediate targets) — see onSeeked.
    seekTo: (t: number) => {
      const v = videoRef.current; if (!v) return;
      if (v.seeking) { pendingSeekRef.current = t; }
      else { pendingSeekRef.current = null; v.currentTime = t; }
    },
    setTrimRange: (start: number, end: number) => {
      trimStartRef.current = start; trimEndRef.current = end;
      setTrimStart(start); setTrimEnd(end);
    },
    resetTrim: () => {
      trimStartRef.current = 0; trimEndRef.current = videoDuration;
      setTrimStart(0); setTrimEnd(videoDuration);
      timelineSegmentsRef.current = null;   // cuts are part of the trim — reset clears them too
      const v = videoRef.current; if (v) v.currentTime = 0;
    },
    zoomIn, zoomOut, resetZoom,
    setZoom: (s: number) => { const c = Math.max(0.5, Math.min(3, s)); videoScaleRef.current = c; setVideoScale(c); },
    resetBox,
    centerBox: centerEverything,
    setIncludeEdit: (v: boolean) => { setIncludeEdit(v); includeEditRef.current = v; },
    getVideoElement: () => videoRef.current,
    useLocalBlob: swapToLocalBlob,   // timeline asks us to swap to the downloaded blob (fast seeking)
    getTrimState: () => ({ trimStart, trimEnd, duration: videoDuration, includeEdit, videoScale }),
    setSegments: (segs: ClipSegment[] | null) => {
      timelineSegmentsRef.current = segs && segs.length ? segs.map(s => ({ ...s })) : null;
      // Trim-range changes already notify via state; interior cuts (same outer bounds) need this one.
      notifyFraming();
    },
    getSegments: () => timelineSegmentsRef.current,
    addImageOverlay: (id: string, src: string, name: string) => {
      const img = new Image();
      img.onload = () => {
        overlayImgsRef.current.set(id, img);
        const w = Math.round(CANVAS_W * 0.6);
        const h = Math.round(w * (img.naturalHeight / Math.max(1, img.naturalWidth)));
        const end = trimEndRef.current > 0 ? trimEndRef.current : (videoRef.current?.duration || 5);
        const o: ImageOverlay = {
          id, name, src,
          x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h,
          start: trimStartRef.current || 0, end,
        };
        commitOverlays([...overlaysRef.current, o]);
        setSelectedOverlayId(id);
      };
      img.src = src;
    },
    updateOverlay: (id: string, patch: Partial<Omit<ImageOverlay, 'id' | 'src'>>) => {
      commitOverlays(overlaysRef.current.map(x => (x.id === id ? { ...x, ...patch } : x)));
    },
    removeOverlay: removeOverlayFn,
    getOverlays: () => overlaysRef.current,
    getFraming: (): Framing | null =>
      // Return null while boxRef is still the placeholder (NOT the reel's band), so the autosave/capture
      // never persist it: (a) while the video is loading — boxRef is the full-canvas placeholder until
      // loadedmetadata runs calcVideoBox (this is why sheet-SENT reels reloaded as a full-canvas crop:
      // an autosave fired mid-load and saved the placeholder); (b) a saved reel whose framing hasn't been
      // applied for the current source yet. Once loaded, boxRef holds the real band/crop and we return it.
      (isVideoLoadingRef.current || (initialFramingRef.current && framingAppliedSrcRef.current !== videoSrcRef.current)) ? null : ({
        box: { ...boxRef.current },
        videoOffset: { ...videoOffsetRef.current },
        videoScale: videoScaleRef.current,
        trimStart: trimStartRef.current,
        trimEnd: trimEndRef.current,
        includeEdit: includeEditRef.current,
        segments: timelineSegmentsRef.current ?? undefined,
        overlays: overlaysRef.current.length
          ? overlaysRef.current.map(({ src: _src, ...rest }) => rest)
          : undefined,
      }),
    applyFraming: applyFramingFn,
  }), [isRecording, startRecording, cancelRecording, videoDuration, trimStart, trimEnd, includeEdit, videoScale, zoomIn, zoomOut, resetZoom, applyFramingFn, swapToLocalBlob, commitOverlays, removeOverlayFn]);

  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  useEffect(() => { onRecordingStateChangeRef.current = onRecordingStateChange; });

  useEffect(() => {
    onRecordingStateChangeRef.current?.({ isRecording, recProgress, recStatus });
  }, [isRecording, recProgress, recStatus]);

  // ── Main draw loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas || !v) return;
    const video = v;
    const ctx = canvas.getContext('2d')!;
    let active = true;

    const drawOpts = {
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      logoImgRef, verifiedImgRef, s: tw,
    };

    // ── Pre-compute caption layout once per effect (caption text doesn't change mid-loop) ──
    const CAPTION_PAD_X   = HEADER_PADDING_X + 43;
    const CAPTION_MAX_W   = CANVAS_W - CAPTION_PAD_X * 2;
    const CAPTION_BOT_OFF = 18;
    const CLEAN_PAD_TOP   = 44;
    const CLEAN_PAD_BOT   = 40;

    // Groups of pre-wrapped lines; null entry = blank user-line (paragraph break)
    const captionGroups: (string[] | null)[] = [];
    if (overlayCaption && brand === 'clean') {
      ctx.font = '400 42px "Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      for (const userLine of overlayCaption.split('\n')) {
        if (!userLine) { captionGroups.push(null); continue; }
        const words = userLine.split(' ');
        const wrapped: string[] = [];
        let cur = '';
        for (const word of words) {
          const test = cur + word + ' ';
          if (ctx.measureText(test).width > CAPTION_MAX_W && cur) {
            wrapped.push(cur); cur = word + ' ';
          } else { cur = test; }
        }
        if (cur) wrapped.push(cur);
        captionGroups.push(wrapped);
      }
    }
    const captionLineCount = captionGroups.reduce((n, g) => n + (g === null ? 1 : g.length), 0);
    const captionAreaH = captionLineCount > 0
      ? CLEAN_PAD_TOP + (captionLineCount * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOT_OFF
      : 0;

    // Pre-compute sonotrade header height (depends only on caption + style, not on box position)
    const sonotradeHeaderHeight = brand !== 'clean'
      ? computeSonotradeHeaderHeight(ctx, overlayCaption, tw)
      : BASE_HEADER_HEIGHT;

    // ── Draw loop — throttled to ~10 fps when paused to spare CPU ──────────────
    let lastDrawTime = 0;
    // Force an immediate redraw whenever the video seeks (timeline scrub, frame-step,
    // J/K/L) so the preview tracks the playhead at full framerate even while paused.
    const onSeeked = () => {
      lastDrawTime = 0;   // redraw at full framerate the instant a frame decodes
      // Drain the coalesced scrub target: chase the latest cursor position.
      const p = pendingSeekRef.current;
      if (p != null) { pendingSeekRef.current = null; if (Math.abs(p - video.currentTime) > 0.001) video.currentTime = p; }
    };
    video.addEventListener('seeked', onSeeked);

    function draw() {
      if (!active) return;
      raf.current = requestAnimationFrame(draw);

      // Hold the last frame while the <video> is mid-swap to a local blob (avoids a flash).
      if (blobSwapRef.current) return;

      // Hold the last frame while a seek is in flight with no decoded frame ready — drawing
      // it would paint black/garbage. We repaint on 'seeked' the moment the frame lands.
      // (readyState >= 3 means the current frame IS available, so a fast local seek still draws.)
      if (video.seeking && video.readyState < 3) return;

      // Throttle to ~10fps when paused and idle; bypass throttle while dragging for smooth 60fps
      if (video.paused && !isDraggingRef.current) {
        const now = performance.now();
        if (now - lastDrawTime < 100) return;
        lastDrawTime = now;
      }

      if (brand === 'clean') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const { x, y, w, h } = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;

          if (captionGroups.length > 0) {
            const captionAreaY = Math.max(0, y - captionAreaH + 4);
            ctx.font = '400 42px "Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = '#000';
            let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;
            for (let gi = 0; gi < captionGroups.length; gi++) {
              const group = captionGroups[gi];
              const isLastGroup = gi === captionGroups.length - 1;
              if (group === null) { cy += CAPTION_LINE_HEIGHT; continue; }
              for (let wi = 0; wi < group.length; wi++) {
                ctx.fillText(group[wi], CAPTION_PAD_X, cy);
                if (wi < group.length - 1) cy += CAPTION_LINE_HEIGHT;
              }
              if (!isLastGroup) cy += CAPTION_LINE_HEIGHT;
            }
          }

          const scale = (CANVAS_W / video.videoWidth) * videoScaleRef.current;
          const drawW = video.videoWidth * scale;
          const drawH = video.videoHeight * scale;
          const dx = (CANVAS_W - drawW) / 2 + ox;
          const dy = (CANVAS_H - drawH) / 2 + oy;

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.drawImage(video, dx, dy, drawW, drawH);
          ctx.restore();
        }
        return;
      }

      // sonotrade (Twitter/X header template)
      ctx.fillStyle = tw.headerBgColor;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (cellMode) {
        // ── Reel cell layout: [top · top2] · centred video band · [bottom · bottom2] ──
        const L = reelLayout(tw);
        const getCellImg = (url?: string): HTMLImageElement | null => {
          if (!url) return null;
          let img = cellImgRef.current.get(url);
          if (!img) { img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; cellImgRef.current.set(url, img); }
          return img.complete && img.naturalWidth > 0 ? img : null;
        };
        // The video band is a reorderable z-layer: free elements before `videoLayer` draw BEHIND it, so
        // they must be painted before the video frame; the rest paint on top afterwards.
        const videoLayer = tw.videoLayer ?? 0;
        // When the video is cropped, the free elements follow the crop edges so spacing to the video holds
        // (elements above ← top edge, below ← bottom edge). No crop → same array, identical render.
        const cropTw = { ...tw, freeElements: shiftFreeElementsForReelCrop(tw.freeElements ?? [], L, boxRef.current, tw) };
        drawFreeElements({ ctx, s: cropTw, logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle, logoImgRef, verifiedImgRef, getCellImg, placeholder: false, overlayCaption, to: videoLayer });
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const { x: ox, y: oy } = videoOffsetRef.current;
          // The tc/bc handles CROP the video vertically: the video is cover-fit + positioned by the LAYOUT
          // band (so it never moves or rescales while cropping), and only the CLIP window changes to boxRef's
          // y/h. Shrinking the box hides the top/bottom; growing it reveals more (up to the video's extent).
          // boxRef seeds to the layout band, so an untouched reel looks identical; the recorder clips the same.
          const r = reelVideoRect(video.videoWidth, video.videoHeight, L, videoScaleRef.current, ox, oy);
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(L.bandX, boxRef.current.y, L.bandW, boxRef.current.h, tw.videoCornerRadius ?? 24);
          ctx.clip();
          ctx.drawImage(video, r.dx, r.dy, r.dw, r.dh);
          ctx.restore();
        }
        drawReelCells({ ctx, s: tw, L, logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle, logoImgRef, verifiedImgRef, getCellImg, placeholder: false, overlayCaption });
        drawFreeElements({ ctx, s: cropTw, logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle, logoImgRef, verifiedImgRef, getCellImg, placeholder: false, overlayCaption, from: videoLayer });
        // Image overlays — topmost layer, visible while the playhead is inside their time window.
        const ct = video.currentTime;
        for (const o of overlaysRef.current) {
          if (ct < o.start || ct > o.end) continue;
          const img = getOverlayImg(o);
          if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
        }
        return;
      }

      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const { x, y, w, h } = boxRef.current;
        const { x: ox, y: oy } = videoOffsetRef.current;

        const headerY = Math.max(0, y - sonotradeHeaderHeight + 4);
        drawHeaderOnContext({ ctx, cx: 0, cy: headerY, cw: CANVAS_W, ...drawOpts });

        const scale = Math.min(videoTargetW / video.videoWidth, CANVAS_H / video.videoHeight) * videoScaleRef.current;
        const drawW = video.videoWidth * scale;
        const drawH = video.videoHeight * scale;
        const dx = (CANVAS_W - drawW) / 2 + ox;
        const dy = (CANVAS_H - drawH) / 2 + oy;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(video, dx, dy, drawW, drawH);
        ctx.restore();

        if (marketData) {
          drawMarketRow({
            ctx, cx: 0, videoBottomY: y + h, cw: CANVAS_W,
            name: marketData.name,
            subtitle: marketData.industry ?? marketData.subcategory ?? '—',
            photo_url: marketData.photo_url,
            priceUsd: marketData.price.usd,
            lifetimeChangePct: marketData.price.lifetimeChangePct,
            sparkline: marketData.sparkline,
            avatarImgRef: marketAvatarImgRef,
            lastPhotoUrlRef: marketAvatarUrlRef,
          });
        }
      }
    }

    draw();
    return () => { active = false; cancelAnimationFrame(raf.current); video.removeEventListener('seeked', onSeeked); };
  // videoScale intentionally omitted: the draw loop reads videoScaleRef.current directly,
  // so including it would restart the RAF loop on every zoom step causing a visible frame drop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, overlayDisplayName, overlayHandle, overlayVerified, overlayCaption, brand, overlayLogoSrc, marketData, twKey, cellMode]);

  // ── Interaction handlers ──────────────────────────────────────────────────────

  function resetBox() {
    const video = videoRef.current;
    if (cellMode) {
      const L = reelLayout(tw);
      const b = { x: L.bandX, y: L.bandY, w: L.bandW, h: L.bandH };
      boxRef.current = b;
      setBox(b);
    } else if (video && video.videoWidth && video.videoHeight) {
      const scale = Math.min(videoTargetW / video.videoWidth, CANVAS_H / video.videoHeight);
      const b = {
        x: (CANVAS_W - video.videoWidth * scale) / 2,
        y: (CANVAS_H - video.videoHeight * scale) / 2,
        w: video.videoWidth * scale,
        h: video.videoHeight * scale,
      };
      boxRef.current = b;
      setBox(b);
    } else {
      const b = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
      boxRef.current = b;
      setBox(b);
    }
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }

  function centerEverything() {
    const currentBox = boxRef.current;
    if (cellMode) {
      // Reels: centre the WHOLE composition vertically — the free overlay elements (banner / caption / image)
      // PLUS the visible video band — not just the bare video crop (centring only the crop left the banner +
      // caption too high). Measure the current on-screen extent, mirroring shiftFreeElementsForReelCrop so a
      // cropped video and its shifted elements are accounted for, then move the crop window + pan the video by
      // the same delta so banner, video and caption travel together. Re-centring an already-centred reel is a
      // no-op (idempotent).
      // Crop-shift the elements EXACTLY as the draw does, then measure each one's ACTUAL drawn rect — so a
      // multi-line per-post caption's real height is counted (reelFreeElementDrawnRect with placeholder:false
      // reads overlayCaption), not the ~2-line editor sample. Skip empty (undrawn) text elements (h <= 0).
      const L = reelLayout(tw);
      const ctx = canvasRef.current?.getContext('2d');
      const shifted = shiftFreeElementsForReelCrop(tw.freeElements ?? [], L, currentBox, tw);
      let compTop = currentBox.y, compBot = currentBox.y + currentBox.h;   // the visible (clipped) video band
      if (ctx) {
        for (const el of shifted) {
          if (el.hidden) continue;
          const r = reelFreeElementDrawnRect(ctx, el, tw, { overlayCaption, placeholder: false });
          if (r.h <= 0) continue;
          compTop = Math.min(compTop, r.y);
          compBot = Math.max(compBot, r.y + r.h);
        }
      }
      const dy = (CANVAS_H - (compBot - compTop)) / 2 - compTop;
      boxRef.current = { x: currentBox.x, y: currentBox.y + dy, w: currentBox.w, h: currentBox.h };
      videoOffsetRef.current = { x: videoOffsetRef.current.x, y: videoOffsetRef.current.y + dy };
      setBox({ ...boxRef.current });
      return;
    }
    let headerHeight = BASE_HEADER_HEIGHT;
    if (brand !== 'clean') {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) headerHeight = computeSonotradeHeaderHeight(ctx, overlayCaption, tw);
    }
    const totalHeight = headerHeight + currentBox.h;
    const newY = (CANVAS_H - totalHeight) / 2 - 60 + headerHeight;
    const b = { x: currentBox.x, y: newY, w: currentBox.w, h: currentBox.h };
    boxRef.current = b;
    setBox({ ...b });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }

  function zoomIn() { const n = Math.min(3, videoScaleRef.current + 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function zoomOut() { const n = Math.max(0.5, videoScaleRef.current - 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function resetZoom() { videoScaleRef.current = 1; setVideoScale(1); }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative"
      style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, overflow: 'visible' }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
        className="block border border-zinc-700"
      />
      <VideoOverlays isVideoLoading={isVideoLoading} videoError={videoError} />
      {/* Image-overlay editing chrome: one positioned div per overlay (drag = move, corner = resize,
          × = delete). Shown only while the playhead is inside the overlay's window — matching what the
          canvas is actually drawing. Coordinates are canvas px × DISPLAY_SCALE. */}
      {overlays.map(o => {
        if (!o.src || currentTime < o.start || currentTime > o.end) return null;
        const sel = selectedOverlayId === o.id;
        return (
          <div
            key={o.id}
            role="button"
            aria-label={`Image overlay ${o.name}`}
            onPointerDown={e => startOverlayDrag(e, o.id, 'move')}
            className={`absolute ${sel ? 'ring-2 ring-accent' : 'ring-1 ring-transparent hover:ring-accent-border'} cursor-move`}
            style={{
              left: o.x * DISPLAY_SCALE, top: o.y * DISPLAY_SCALE,
              width: o.w * DISPLAY_SCALE, height: o.h * DISPLAY_SCALE,
              touchAction: 'none',
            }}
          >
            {sel && (
              <>
                <div
                  onPointerDown={e => startOverlayDrag(e, o.id, 'resize')}
                  className="absolute -right-1.5 -bottom-1.5 size-3 rounded-full bg-accent cursor-nwse-resize"
                  style={{ touchAction: 'none' }}
                  aria-label="Resize overlay"
                />
                <button
                  type="button"
                  aria-label="Remove overlay"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); removeOverlayFn(o.id); }}
                  className="absolute -right-2.5 -top-2.5 grid size-5 place-items-center rounded-full bg-surface-overlay border border-line text-fg-2 hover:text-danger-text"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </>
            )}
          </div>
        );
      })}
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        preload="auto"
        loop playsInline
        onPlay={() => {
          setIsPlaying(true);
          const v = videoRef.current;
          if (v && v.currentTime < trimStartRef.current) v.currentTime = trimStartRef.current;
        }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrentTime(v.currentTime);
          if (trimEndRef.current > 0 && v.currentTime >= trimEndRef.current) {
            v.currentTime = trimStartRef.current;
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.duration > 1) v.currentTime = 1;
        }}
        onError={(e) => {
          const v = e.target as HTMLVideoElement;
          const errorCode = v.error?.code;
          if (!errorCode) return;
          const msgs: Record<number, string> = {
            4: 'Video format not supported. Try refreshing the page.',
            3: 'Video decode error. The file may be corrupted.',
            2: 'Network error. Check your internet connection.',
          };
          setVideoError(msgs[errorCode] ?? 'Failed to load video. The link may be invalid.');
          onVideoError?.();
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
});
