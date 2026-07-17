'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import { CANVAS_W, CANVAS_H } from '../constants';
import type { Box } from '../types';
import { getCachedBlob } from '@/lib/reelVideoBlob';

function calcVideoBox(vw: number, vh: number, currentBrand: string, targetW: number, bandH: number, cellMode: boolean): Box {
  if (cellMode) {
    // Reel cell layout: a centred video band, independent of the clip's own dimensions.
    return { x: (CANVAS_W - targetW) / 2, y: (CANVAS_H - bandH) / 2, w: targetW, h: bandH };
  }
  if (currentBrand === 'clean') {
    const scale = CANVAS_W / vw;
    const drawH = vh * scale;
    const y = (CANVAS_H - drawH) / 2;
    return { x: 0, y, w: CANVAS_W, h: drawH };
  }
  const scale = Math.min(targetW / vw, CANVAS_H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const x = (CANVAS_W - drawW) / 2;
  const y = (CANVAS_H - drawH) / 2;
  return { x, y, w: drawW, h: drawH };
}

interface UseVideoLoadingParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  brand: string;
  rowNumber: number;
  videoId?: string;
  videoTargetW: number;   // CANVAS_W − 2·videoPaddingX — the width the video is fit to
  videoBandHeight: number; // cell layout: height of the centred video band
  cellMode: boolean;       // true → video sits in a fixed centred band (cells above/below)
  boxRef: MutableRefObject<Box>;
  setBox: (b: Box) => void;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  videoScaleRef: MutableRefObject<number>;
  setVideoScale: (s: number) => void;
  onVideoError?: () => void;
  // Set true while the <video> is being swapped to a local blob so the draw loop freezes
  // on the last frame (no flash) and the metadata handler skips its framing/trim reset.
  blobSwapRef: MutableRefObject<boolean>;
  // The src whose saved framing has already been restored. When it matches videoSrc, a (deferred) load's
  // loadedmetadata must NOT reset the user's pan/zoom/trim — restore happened before the video ever loaded.
  framingAppliedSrcRef?: MutableRefObject<string | null>;
}

export function useVideoLoading({
  videoRef, videoSrc, brand, rowNumber, videoId, videoTargetW, videoBandHeight, cellMode,
  boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError, blobSwapRef, framingAppliedSrcRef,
}: UseVideoLoadingParams) {
  const ownedBlobUrlRef = useRef<string | null>(null);   // this canvas's blob: URL, revoked on src change
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);

  // Recalculate box on brand change (for already-loaded video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const b = calcVideoBox(video.videoWidth, video.videoHeight, brand, videoTargetW, videoBandHeight, cellMode);
    boxRef.current = b;
    setBox(b);
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }, [brand, videoTargetW, videoBandHeight, cellMode]);

  // Set box and duration on metadata load
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleLoadedMetadata = () => {
      if (blobSwapRef.current) return;   // same-file blob swap → keep the user's crop/zoom/trim
      // A deferred (preload="none") reel restores its saved framing on mount, BEFORE the clip ever loads;
      // when the user later plays it, this loadedmetadata fires — it must NOT reset the user's pan/zoom/trim
      // (that would clobber the restored framing and get autosaved). Recompute the band box + duration, but
      // skip the offset/scale/trim reset when framing is already applied for this source.
      const framingApplied = !!framingAppliedSrcRef?.current && framingAppliedSrcRef.current === videoSrc;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const b = calcVideoBox(vw, vh, brand, videoTargetW, videoBandHeight, cellMode);
        boxRef.current = b;
        setBox(b);
        if (!framingApplied) {
          videoOffsetRef.current = { x: 0, y: 0 };
          videoScaleRef.current = 1;
          setVideoScale(1);
        }
      }
      const dur = isFinite(video.duration) ? video.duration : 0;
      setVideoDuration(dur);
      if (!framingApplied) {
        setTrimStart(0);
        setTrimEnd(dur);
        trimStartRef.current = 0;
        trimEndRef.current = dur;
      }
      setCurrentTime(0);
    };
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [videoSrc, brand, videoTargetW, videoBandHeight, cellMode]);

  // Safety net: once loading finishes, if the box is STILL the full-canvas placeholder, force the band.
  // calcVideoBox in the loadedmetadata handler above can miss it (metadata that fired before the listener
  // attached, a cached/blob-swap load, etc.), which left sheet-sent reels rendering full-canvas until a
  // template switch (the brand-change effect) recomputed it — this makes that recompute happen on every
  // load. Only fires when the box is the untouched placeholder; a real band/crop is left alone.
  useEffect(() => {
    if (isVideoLoading) return;
    const b = boxRef.current;
    if (b.x !== 0 || b.y !== 0 || b.w !== CANVAS_W || b.h !== CANVAS_H) return;
    const video = videoRef.current;
    const nb = calcVideoBox(video?.videoWidth || CANVAS_W, video?.videoHeight || CANVAS_H, brand, videoTargetW, videoBandHeight, cellMode);
    boxRef.current = nb;
    setBox(nb);
  }, [isVideoLoading, videoSrc, brand, videoTargetW, videoBandHeight, cellMode]);

  // Loading/error state flips with the src during render; the effect below only
  // touches the <video> element.
  // A source is loadable if it's a DIRECT file — an uploaded blob: URL, or our own Supabase Storage
  // https URL for a persisted upload — OR a proxied link (`/api/proxy?...url=<target>`). The only
  // rejected non-empty case is the empty-proxy sentinel `/api/proxy?stream=1&url=` (bestVideoUrl of
  // not-yet-fetched data). This gate previously required the `url=` substring, so uploads (blob:/Storage,
  // which have none) never got their src assigned and rendered as a black crop box.
  const srcValid = !!videoSrc
    && !videoSrc.endsWith('url=')
    && (/^(blob:|data:|https?:)/i.test(videoSrc) || videoSrc.includes('url='));
  const [prevSrc, setPrevSrc] = useState<string | null>(null);
  if (videoSrc !== prevSrc) {
    setPrevSrc(videoSrc);
    if (srcValid) setVideoError(null);
    // Deferred loading: the <video> is preload="none", so a new src downloads nothing until play/export.
    // Never show the "Loading video…" spinner for it — the reel is usable immediately (card renders over a
    // black video band). It only becomes "loading" if the user actually plays it (handled in the effect).
    setIsVideoLoading(false);
  }

  // Load new video src
  useEffect(() => {
    blobSwapRef.current = false;   // a new source is loading — never stay frozen from a prior swap
    if (!srcValid) return;
    const video = videoRef.current;
    if (!video) {
      const t = setTimeout(() => setIsVideoLoading(false), 0);
      return () => clearTimeout(t);
    }

    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = videoSrc;

    // Clear any residual spinner once data actually arrives (only happens if the user plays the deferred
    // clip). No eager-load timeout/error: with preload="none" the element intentionally never downloads
    // until played or exported, so a "failed to load" timeout would be a false alarm — a genuinely bad
    // URL surfaces at export instead.
    const clearLoading = () => { if (video.readyState >= 1) setIsVideoLoading(false); };
    const handleError = () => setIsVideoLoading(false);

    video.addEventListener('loadedmetadata', clearLoading);
    video.addEventListener('loadeddata', clearLoading);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', clearLoading);
      video.removeEventListener('loadeddata', clearLoading);
      video.removeEventListener('error', handleError);
    };
  }, [videoSrc, srcValid]);

  // ── Local-blob swap ─────────────────────────────────────────────────────────
  // The proxy src streams quickly for initial playback, but seeking it range-fetches
  // the CDN (slow scrubbing). When the whole file is ALREADY downloaded (the active
  // reel's filmstrip does this), swap the <video> to a local blob so seeks hit memory.
  // Gated on the cache (no new download) so non-active mounted canvases don't download.
  // The swap is imperative (videoSrc state unchanged) and preserves framing/trim.
  // Triggered by the timeline (which downloads the file) via the canvas ref, plus a
  // one-shot attempt on mount for the already-cached case.
  const swapToLocalBlob = useCallback(() => {
    // A blob: src is already a local file (an upload) — seeking it hits memory, so swapping to yet
    // another blob is pure waste (and re-buffers the file). Only remote/proxy sources benefit.
    if (!srcValid || ownedBlobUrlRef.current || videoSrc.startsWith('blob:')) return;
    const v = videoRef.current;
    const blob = getCachedBlob(videoSrc);
    if (!v || !blob) return;
    const url = URL.createObjectURL(blob);
    ownedBlobUrlRef.current = url;
    const t = v.currentTime, wasPlaying = !v.paused;
    blobSwapRef.current = true;   // freeze the draw loop + skip the metadata reset
    const finish = () => {
      v.removeEventListener('seeked', finish);
      v.removeEventListener('loadeddata', finish);
      blobSwapRef.current = false;
      if (wasPlaying) v.play().catch(() => {});
    };
    const onMeta = () => {
      v.removeEventListener('loadedmetadata', onMeta);
      try { v.currentTime = t; } catch { /* ignore */ }
      v.addEventListener('seeked', finish, { once: true });
      v.addEventListener('loadeddata', finish, { once: true });   // covers t===0 (no 'seeked')
    };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.src = url;
    v.load();
    setTimeout(() => { blobSwapRef.current = false; }, 5000);   // safety: never freeze forever
  }, [videoSrc, srcValid, videoRef, blobSwapRef]);

  useEffect(() => { swapToLocalBlob(); }, [swapToLocalBlob]);   // already-cached (e.g. reopened reel)

  // Revoke this canvas's blob URL when the source changes or the canvas unmounts.
  useEffect(() => () => {
    if (ownedBlobUrlRef.current) { URL.revokeObjectURL(ownedBlobUrlRef.current); ownedBlobUrlRef.current = null; }
  }, [videoSrc]);

  return {
    isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef, swapToLocalBlob,
  };
}
