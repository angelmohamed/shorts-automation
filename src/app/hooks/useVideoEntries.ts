'use client';

import { useState, useRef, useEffect } from 'react';
import type { TikTokCanvasRef } from '../components/TikTokCanvas';
import type { VideoEntry, VideoData, VideoMode } from '../types';
import { makeEmptyEntry, MAX_REELS } from '@/lib/entry';
import { getCachedVideo, setCachedVideo, enqueueVideoFetch } from '@/lib/reelVideoCache';
import { isFootageUrl, footageVideoData } from '@/lib/footage';
import { proxyStreamUrl } from '@/lib/utils';
import { deleteLocalVideo, pruneLocalVideos, clearOverlayImages } from '@/lib/localVideoStore';

// The exporter demuxes H.264 only, but TikWM's HD stream is sometimes H.265 (hvc1). Sniff the first
// bytes of a stream for an AVC sample entry so a non-exportable HD variant can be dropped in favour of
// the H.264 SD stream. Best-effort: a failed sniff keeps the stream (don't degrade on a network blip).
async function looksH264(streamUrl: string): Promise<boolean> {
  try {
    const res = await fetch(proxyStreamUrl(streamUrl), { headers: { Range: 'bytes=0-300000' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return true;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const has = (fourcc: string) => {
      const t = [...fourcc].map(c => c.charCodeAt(0));
      outer: for (let i = 0; i + t.length <= bytes.length; i++) {
        for (let j = 0; j < t.length; j++) if (bytes[i + j] !== t[j]) continue outer;
        return true;
      }
      return false;
    };
    if (has('avc1') || has('avc3')) return true;
    if (has('hvc1') || has('hev1') || has('av01') || has('vp09')) return false;
    return true;   // no codec marker in the probed range — keep the stream
  } catch {
    return true;
  }
}

export function useVideoEntries() {
  const [entries, setEntries] = useState<VideoEntry[]>([makeEmptyEntry('1')]);
  const canvasRefsMap = useRef<Map<string, TikTokCanvasRef>>(new Map());

  // Always-current snapshot used inside async callbacks to avoid stale closures
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // Add a blank reel, capped at MAX_REELS. Guarded inside the updater too so no path can ever push the
  // grid past the cap (which the server trigger would reject, breaking the save). The UI disables the
  // add affordance at the cap; this is the safety net.
  // initialUrl seeds the new reel's link (e.g. auto-assigned random footage); the auto-fetch
  // effect loads it just like a pasted link.
  function addRow(initialUrl?: string) {
    setEntries(prev => {
      if (prev.length >= MAX_REELS) return prev;
      const e = makeEmptyEntry(Date.now().toString(), prev[0]?.mode ?? 'twitter');
      if (initialUrl) e.url = initialUrl;
      return [...prev, e];
    });
  }

  function removeRow(id: string) {
    // Allow deleting any row, including the last — the grid tolerates zero entries (every entries[0]
    // access is guarded) and always shows the "add row" ghost card to recover. Previously this no-op'd
    // when only one row remained, so the Delete button silently did nothing on a single-reel workspace.
    setEntries(prev => prev.filter(e => e.id !== id));
    // GC the reel's stored upload from IndexedDB (nothing else references it — ids are unique).
    void deleteLocalVideo(id);
  }

  // Duplicate a row: insert a copy (new id) right after the source. Returns the new id so the caller can
  // copy the id-keyed editor state (framing / template / settings) and select the duplicate — or null
  // when the grid is at the cap (nothing added, so the caller must not carry state to a phantom id).
  function duplicateRow(id: string): string | null {
    if (entriesRef.current.length >= MAX_REELS) return null;
    const newId = Date.now().toString();
    setEntries(prev => {
      if (prev.length >= MAX_REELS) return prev;
      const idx = prev.findIndex(e => e.id === id);
      if (idx < 0) return prev;
      const copy: VideoEntry = { ...prev[idx], id: newId };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    return newId;
  }

  function resetEverything() {
    setEntries([makeEmptyEntry('1')]);
  }

  // Delete EVERY reel: reset the grid to a single empty reel and GC all stored uploads.
  function deleteAllReels() {
    const fresh = makeEmptyEntry('1');
    setEntries([fresh]);
    void pruneLocalVideos([]);   // drop every stored upload — nothing survives a delete-all
    void clearOverlayImages();   // ...and every stored overlay image
  }

  function handleVideoError(id: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, videoFailed: true } : e));
  }

  function setMode(id: string, mode: VideoMode) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, mode } : e));
  }

  function updateEntry(id: string, field: 'url' | 'caption', value: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  function updateLocalVideo(id: string, src: string, name: string) {
    // Clear any previously-stored bucket URL + poster: a changed/removed local file (or a link being
    // replaced by an upload) must be re-stored, so the persistence layer re-derives them from the new blob.
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, localVideoSrc: src || undefined, localVideoName: name || undefined, videoUrl: undefined, posterUrl: undefined, data: null, error: '', videoFailed: false } : e
    ));
    // The replaced/removed clip's stored upload is now unreferenced — GC it from IndexedDB. (When a
    // NEW upload replaces it, CanvasGrid re-persists the new blob right after this.)
    if (!src) void deleteLocalVideo(id);
  }

  async function fetchVideo(id: string) {
    const currentEntry = entriesRef.current.find(e => e.id === id);
    if (!currentEntry || !currentEntry.url.trim()) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, error: 'URL is required' } : e));
      return;
    }
    // A caption is NOT required to fetch a video — the link/upload comes first and the caption can be
    // added (or left empty) afterwards. Only the URL is needed here (the caption isn't sent to the API).
    const url = currentEntry.url.trim();

    // Cache hit → restore instantly with NO API call. This is what makes returning to the reels section
    // (after switching away) not re-hit the download API for already-fetched links.
    const cached = getCachedVideo(url);
    if (cached) {
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: '', data: cached, videoFailed: false } : e
      ));
      return;
    }

    // Footage-library URLs point at our own R2 bucket — no resolver, no rate-limit queue, no codec
    // sniff (the library is H.264 by construction). Synthesize the VideoData directly.
    if (isFootageUrl(url)) {
      const data = footageVideoData(url);
      setCachedVideo(url, data);
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: '', data, videoFailed: false } : e
      ));
      return;
    }

    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, loading: true, error: '', data: null, videoFailed: false } : e
    ));

    // Route through the shared rate-limited queue so many reels fetch one-by-one (≥1s apart) instead of
    // all at once and tripping the API's 1/sec limit.
    const result = await enqueueVideoFetch(url, async () => {
      // A hung request must NOT freeze the shared fetch queue: reelVideoCache.runQueue awaits this serially,
      // so one stalled /api/download (slow upstream, flaky network) otherwise left EVERY queued reel stuck
      // on "loading" forever. A client-side timeout guarantees it settles; AbortSignal.timeout covers both
      // the response and the body read.
      try {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(30_000),
        });
        return { ok: res.ok, json: await res.json() };
      } catch (e) {
        const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
        return { ok: false, json: { error: timedOut ? 'The download timed out — please try again.' : 'Network error — please try again.' } };
      }
    });

    // The reel may have been deleted or its URL changed while queued — drop a stale result.
    const latest = entriesRef.current.find(e => e.id === id);
    if (!latest || latest.url.trim() !== url) return;

    const json = result.json as { error?: string; play?: string; hdplay?: string; wmplay?: string; images?: string[] };

    // Hard failure: the route returned a non-2xx with an error message (bad/unsupported/private
    // link, upstream error, timeout, etc.). Surface it verbatim.
    if (!result.ok) {
      const errorMsg = typeof json.error === 'string' ? json.error : 'Something went wrong';
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: errorMsg, data: null, videoFailed: false } : e
      ));
      return;
    }

    // Soft failure: the route can return 200 with NO usable video — a TikTok photo slideshow, an
    // Instagram/X photo-only post, or an otherwise empty payload. Without this the card would sit
    // empty with no explanation; instead tell the user what went wrong.
    const hasVideo = !!(json.play || json.hdplay || json.wmplay);
    if (!hasVideo) {
      const errorMsg = (json.images && json.images.length > 0)
        ? 'That link is a photo post — there’s no video to fetch.'
        : 'Couldn’t fetch a video from that link. Make sure it’s a public TikTok, Instagram, or X post that has a video.';
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: errorMsg, data: null, videoFailed: false } : e
      ));
      return;
    }

    // Drop an H.265 HD stream (export would fail) as long as an H.264 fallback exists.
    const data = { ...(json as VideoData) };
    if (data.hdplay && (data.play || data.wmplay) && !(await looksH264(data.hdplay))) data.hdplay = '';

    // Re-check staleness after the sniff (it awaits a network read).
    const fresh = entriesRef.current.find(e => e.id === id);
    if (!fresh || fresh.url.trim() !== url) return;

    setCachedVideo(url, data);   // cache for instant restore on the next visit
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, loading: false, error: '', data, videoFailed: false } : e
    ));
  }

  async function fetchAllVideos() {
    // Caption optional here too — fetch every entry that has a URL and isn't already fetched/loading.
    const toFetch = entriesRef.current.filter(e => e.url.trim() && !e.data && !e.loading);
    for (const entry of toFetch) {
      await fetchVideo(entry.id);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // NOTE: "Download all" lives in CanvasGrid now — only the on-screen reel is mounted, so it must cycle the
  // selection to each reel before exporting (which this hook can't drive). A loop over canvasRefsMap here
  // would only ever find the displayed reel's ref.

  return {
    entries, setEntries, canvasRefsMap,
    addRow, removeRow, duplicateRow, resetEverything, deleteAllReels, updateEntry, updateLocalVideo, setMode, handleVideoError,
    fetchVideo, fetchAllVideos,
  };
}
