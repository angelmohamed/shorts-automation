'use client';

import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { TikTokCanvas } from './TikTokCanvas';
import type { TikTokCanvasRef } from './TikTokCanvas';
import { CAROUSEL_PREVIEW_W } from './TemplateEditorCanvas/constants';
import { useTwitterTemplates } from '../hooks/useTwitterTemplates';
import { useReelPersistence, type SavedReel } from '../hooks/useReelPersistence';
import { makeEmptyEntry, MAX_REELS } from '@/lib/entry';
import { getCachedVideo, prioritizeVideoFetch } from '@/lib/reelVideoCache';
import { saveLocalVideo, getLocalVideo, saveOverlayImage } from '@/lib/localVideoStore';
import type { Framing, ImageOverlay } from './TikTokCanvas/types';
import { TemplatesEmptyState } from './TemplatesEmptyState';
import { defaultTwitterTemplateSettings } from './twitterTemplateTypes';
import type { VideoEntry, BrandProps } from '../types';
import type { RecordingState } from './TikTokCanvas/types';
import { VideoControlsBar } from './VideoControlsBar';
import { bestVideoUrl } from '@/lib/utils';
import { getVideoBlob } from '@/lib/reelVideoBlob';
import { Button, IconButton, Modal, HEADER_H } from './ui';
import { AutosaveChip } from './AutosaveChip';
import { ElementRail, RailActionButton } from './ElementRail';
import { ReelTemplatePreview } from './ReelTemplatePreview';
import { SlidesStrip } from './SlidesStrip';
import { EditorScrollBar } from './EditorScrollBar';
import { ZoomControl } from './ZoomControl';
import { useObservedSize, fitScaleFor } from '@/app/hooks/useElementSize';
import { useEditorZoomPan, EDITOR_ZOOM_MIN as ZOOM_MIN, EDITOR_ZOOM_MAX as ZOOM_MAX } from '@/app/hooks/useEditorZoomPan';
import {
  UploadIcon, ArrowRightIcon, SpinnerIcon,
  CloseIcon, DownloadIcon, VideoIcon, LinkIcon, ChevronDownIcon, TrashIcon,
} from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W; // 410 — same width as canvas preview

// Height of the flow spacer at the end of the scroll content, reserving room so the reel centres above
// the docked slides strip rather than behind it (matches the carousels editor's SLIDES_DOCK_CLEARANCE).
const SLIDES_DOCK_CLEARANCE = 120;


interface CanvasGridProps {
  entries: VideoEntry[];
  setEntries?: Dispatch<SetStateAction<VideoEntry[]>>;   // present in the Video Reels workspace (entries are page-owned)
  canvasRefsMap: MutableRefObject<Map<string, TikTokCanvasRef>>;
  brand: BrandProps;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onDuplicateRow: (id: string) => string | null;   // inserts a copy, returns the new id (null if at the reel cap)
  onDeleteAllReels?: () => void;                    // reset the grid to one empty reel + GC stored media
  onHandleVideoError: (id: string) => void;
  onUpdateEntry: (id: string, field: 'url' | 'caption', value: string) => void;
  onUpdateLocalVideo: (id: string, src: string, name: string) => void;
  onFetchVideo: (id: string) => void;
  userId: string | null;
  videoMode: 'twitter' | 'caption';                          // current overlay style (drives the Twitter template picker + rendering)
  onGoToTemplateEditor?: () => void;                         // reels posting: jump to the template editor when there are no reel templates
  viewToggle?: React.ReactNode;                              // Canvas ⇄ Sheet segmented control, rendered in the toolbar's left slot
  active?: boolean;                                          // false when the Sheet view is showing — suppresses the body-portalled scroll bar
  onRestored?: () => void;                                   // fires once the saved grid has been applied (Sheet sends wait for this)
  restored?: boolean;                                        // true on a nav-back remount (page-load restore already ran): re-seed maps, don't rebuild entries
}

// ── Reels posting rail: Link + Caption flyouts (edit the SELECTED reel) + URL/caption undo history ─────
const linkGlyph = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const SVG_PROPS = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const zoomInGlyph  = (<svg {...SVG_PROPS}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></svg>);
const zoomOutGlyph = (<svg {...SVG_PROPS}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" /></svg>);
const resetGlyph   = (<svg {...SVG_PROPS}><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></svg>);
const centerGlyph  = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="2.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>);
const timelineGlyph = (<svg {...SVG_PROPS}><path d="M3 12h18" /><rect x="8" y="9" width="4" height="6" rx="1" /></svg>);
const removeVideoGlyph = (<svg {...SVG_PROPS}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5 21 8v8l-5-2.5" /><path d="m3 3 18 18" /></svg>);
const addImageGlyph = (<svg {...SVG_PROPS}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>);

// The selected reel's video source — paste a URL / upload a file / fetch. Ported from the old inline card.
function ReelLinkFlyout({ entry, onUpdateField, onUpdateLocalVideo, onFetch }: {
  entry: VideoEntry;
  onUpdateField: (field: 'url' | 'caption', value: string) => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
  onFetch: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasLocal = !!entry.localVideoSrc;
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpdateLocalVideo(URL.createObjectURL(file), file.name);
    onUpdateField('url', '');
    if (fileRef.current) fileRef.current.value = '';
  }
  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }
  return (
    <div className="flex flex-col gap-2">
      {hasLocal ? (
        <div className="flex items-center gap-2">
          <VideoIcon size={13} className="text-fg-2 shrink-0" />
          <span className="text-body text-fg-2 truncate flex-1 min-w-0">{entry.localVideoName || 'Uploaded video'}</span>
          <IconButton icon={<UploadIcon />} label="Change video" variant="secondary" onClick={() => fileRef.current?.click()} />
          <IconButton icon={<CloseIcon size={13} />} label="Remove video" variant="secondary" onClick={clearLocalVideo} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border border-line-strong rounded-md px-2.5 h-9">
            <LinkIcon size={13} className="text-fg-3 shrink-0" />
            <input
              type="url"
              value={entry.url}
              onChange={e => onUpdateField('url', e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onFetch(); }}
              placeholder="Paste TikTok, Instagram or X URL…"
              className="flex-1 min-w-0 bg-transparent text-body text-fg placeholder:text-fg-3 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <IconButton icon={<UploadIcon />} label="Upload video file" variant="secondary" onClick={() => fileRef.current?.click()} />
            <IconButton
              icon={entry.loading ? <SpinnerIcon style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightIcon />}
              label="Fetch video"
              variant="secondary"
              onClick={onFetch}
              disabled={entry.loading || !entry.url.trim() || (!!entry.data && !entry.videoFailed)}
            />
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
      {entry.error && !hasLocal && <span className="text-caption text-danger-text">{entry.error}</span>}
    </div>
  );
}

// The selected reel's video adjustments as a rail-island icon-button COLUMN (rail convention):
// zoom in, zoom out, reset (framing + trim + zoom back to defaults), center, and the timeline toggle.
function ReelAdjustFlyout({ zoom, onZoom, onResetTrim, onResetBox, onCenter, timelineOpen, onToggleTimeline, onRemoveVideo, onAddImage }: {
  zoom: number;
  onZoom: (z: number) => void;
  onResetTrim: () => void;
  onResetBox: () => void;
  onCenter: () => void;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  onRemoveVideo: () => void;
  onAddImage: (file: File) => void;
}) {
  const STEP = 0.05, MIN = 0.5, MAX = 3;
  const round2 = (z: number) => Math.round(z * 100) / 100;
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Just the button column — ElementRail provides the animated pill card (it expands in once a video
  // is loaded), so this renders only the content.
  return (
    <>
      <RailActionButton label={`Zoom in (${Math.round(zoom * 100)}%)`}  icon={zoomInGlyph}  disabled={zoom >= MAX} onClick={() => onZoom(Math.min(MAX, round2(zoom + STEP)))} />
      <RailActionButton label={`Zoom out (${Math.round(zoom * 100)}%)`} icon={zoomOutGlyph} disabled={zoom <= MIN} onClick={() => onZoom(Math.max(MIN, round2(zoom - STEP)))} />
      <RailActionButton label="Reset"  icon={resetGlyph}  onClick={() => { onResetBox(); onResetTrim(); onZoom(1); }} />
      <RailActionButton label="Center" icon={centerGlyph} onClick={onCenter} />
      <RailActionButton label="Add image overlay" icon={addImageGlyph} onClick={() => imageInputRef.current?.click()} />
      <input
        ref={imageInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAddImage(f); }}
      />
      <RailActionButton label={timelineOpen ? 'Hide timeline' : 'Open timeline'} icon={timelineGlyph} onClick={onToggleTimeline} active={timelineOpen} />
      <RailActionButton label="Remove video" icon={removeVideoGlyph} onClick={onRemoveVideo} />
    </>
  );
}

// Empty timeline strip — shown when the reels timeline is toggled open before a video is loaded.
// Matches VideoControlsBar's outer frame so the bottom strip looks consistent either way.
function EmptyTimeline() {
  return (
    <div className="shrink-0 mx-3 mb-3 rounded-lg border border-line bg-surface-1 px-4 py-3">
      <div className="h-14 rounded-md border border-dashed border-line bg-surface-2 flex items-center justify-center">
        <span className="text-caption text-fg-3">No video yet — paste a link or upload a clip to edit the timeline.</span>
      </div>
    </div>
  );
}

// Undo/redo history for the reels' URL + caption text edits. Snapshots the pre-edit state at the start of
// a typing burst and commits it on a 500ms debounce (coalescing the burst into one undo step), mirroring the
// template editor's history. Scope: the reels' url + caption only.
type ReelEditSnap = Record<string, { url: string; caption: string }>;
function useReelEditHistory(
  entries: VideoEntry[],
  onUpdateEntry: (id: string, field: 'url' | 'caption', value: string) => void,
) {
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  const snap = useCallback((): ReelEditSnap => {
    const m: ReelEditSnap = {};
    for (const e of entriesRef.current) m[e.id] = { url: e.url ?? '', caption: e.caption ?? '' };
    return m;
  }, []);
  const past = useRef<ReelEditSnap[]>([]);
  const future = useRef<ReelEditSnap[]>([]);
  const base = useRef<ReelEditSnap | null>(null);   // pre-burst snapshot, committed on debounce
  const burstId = useRef<string | null>(null);      // the reel id the current burst is editing
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // canUndo/canRedo are held in state (computed from the ref stacks via refresh()), so the render never
  // reads refs — refresh runs only from the mutation handlers below.
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const refresh = useCallback(() => {
    setFlags({ canUndo: past.current.length > 0 || base.current != null, canRedo: future.current.length > 0 });
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (base.current) { past.current.push(base.current); base.current = null; refresh(); }
  }, [refresh]);
  const apply = useCallback((target: ReelEditSnap) => {
    for (const e of entriesRef.current) {
      const t = target[e.id];
      if (!t) continue;
      if ((e.url ?? '') !== t.url) onUpdateEntry(e.id, 'url', t.url);
      if ((e.caption ?? '') !== t.caption) onUpdateEntry(e.id, 'caption', t.caption);
    }
  }, [onUpdateEntry]);
  const recordEdit = useCallback((id: string, field: 'url' | 'caption', value: string) => {
    if (base.current && burstId.current !== id) commit();   // editing a different reel → close the prior reel's burst
    if (!base.current) { base.current = snap(); burstId.current = id; future.current = []; }   // burst start → a new edit clears redo
    onUpdateEntry(id, field, value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 500);
    refresh();
  }, [snap, onUpdateEntry, commit, refresh]);
  const undo = useCallback(() => {
    commit();   // flush any in-progress burst so it's undoable
    if (!past.current.length) return;
    const prev = past.current.pop()!;
    future.current.push(snap());
    apply(prev);
    refresh();
  }, [commit, snap, apply, refresh]);
  const redo = useCallback(() => {
    commit();
    if (!future.current.length) return;
    const next = future.current.pop()!;
    past.current.push(snap());
    apply(next);
    refresh();
  }, [commit, snap, apply, refresh]);

  return { recordEdit, undo, redo, canUndo: flags.canUndo, canRedo: flags.canRedo };
}

// ── CanvasGrid ────────────────────────────────────────────────────────────────

// Remember the last-selected reel template per user so the Reels posting page reopens it instead of
// snapping back to the first one. The in-memory map survives section-switch remounts within a session;
// localStorage (read below) survives a full page reload. Mirrors the carousel editor's `de:tpl:` scheme.
const reelSelectionCache = new Map<string, string>();   // userId → reel-template id
const reelSelectionKey = (userId: string) => `de:reeltpl:${userId}`;

export function CanvasGrid({
  entries, setEntries, canvasRefsMap, brand,
  onAddRow, onRemoveRow, onDuplicateRow, onDeleteAllReels, onHandleVideoError,
  onUpdateEntry, onUpdateLocalVideo,
  onFetchVideo, userId,
  videoMode, onGoToTemplateEditor, viewToggle, active = true, onRestored, restored,
}: CanvasGridProps) {
  // No export quota in the client-only build — every export just runs.
  const exportGuard = useMemo(() => ({
    guard: async (_key: string, run: () => void | Promise<void>) => { await run(); return true; },
    consumeOne: async (_key: string) => true,
  }), []);
  // Export actions each drive a real-time canvas recording, so only ONE may run at a time — a second
  // would read a canvas that's already recording (exportBlob → null). `downloadingOne` covers the
  // single Download; Download-All has isDownloadingAll; every export button gates on both.
  const [downloadingOne, setDownloadingOne] = useState(false);
  // Saved Twitter/X overlay templates. The selected one's style applies to all twitter-mode rows
  // (defaults reproduce the original look when the user has none).
  const { templates: twitterTemplates, loaded: twitterLoaded } = useTwitterTemplates(userId);
  // Seed from the remembered selection (in-memory cache → localStorage) so a remount/reload reopens the
  // same template; falls back to the first one only when nothing is remembered.
  const [activeTwitterId, setActiveTwitterId] = useState<string | null>(() => {
    if (!userId) return null;
    const cached = reelSelectionCache.get(userId);
    if (cached) return cached;
    try { return localStorage.getItem(reelSelectionKey(userId)); } catch { return null; }
  });
  const activeTwitter = twitterTemplates.find(t => t.id === activeTwitterId) ?? twitterTemplates[0] ?? null;
  const twSettings = activeTwitter?.settings ?? defaultTwitterTemplateSettings();

  // If userId arrives after the initial render (the seed above ran with no user), restore then.
  useEffect(() => {
    if (activeTwitterId || !userId) return;
    let saved: string | null = reelSelectionCache.get(userId) ?? null;
    if (!saved) { try { saved = localStorage.getItem(reelSelectionKey(userId)); } catch { /* ignore */ } }
    if (saved) setActiveTwitterId(saved);
  }, [userId, activeTwitterId]);

  // Persist the selection: in-memory cache for fast remounts, localStorage for full reloads.
  useEffect(() => {
    if (!userId || !activeTwitterId) return;
    reelSelectionCache.set(userId, activeTwitterId);
    try { localStorage.setItem(reelSelectionKey(userId), activeTwitterId); } catch { /* ignore */ }
  }, [userId, activeTwitterId]);

  // Drop a remembered id whose template was since deleted, so it cleanly falls back to the first.
  useEffect(() => {
    if (!activeTwitterId || !twitterLoaded || twitterTemplates.length === 0) return;
    if (!twitterTemplates.some(t => t.id === activeTwitterId)) {
      setActiveTwitterId(null);
      if (userId) {
        reelSelectionCache.delete(userId);
        try { localStorage.removeItem(reelSelectionKey(userId)); } catch { /* ignore */ }
      }
    }
  }, [activeTwitterId, twitterLoaded, twitterTemplates, userId]);

  // ── Saved reels (autosave the whole grid) ──────────────────────────────────────────────────────
  // Each grid row is a saved reel: we persist only numbers/strings (link, caption, mode, inherited
  // template id, framing) and re-apply them on load. Re-fetching the link reloads the video; the canvas
  // then restores its exact crop/pan/zoom/trim via `initialFraming`. Only active in the Video Reels
  // workspace (where setEntries is provided).
  const { loaded: reelsLoaded, loadError: reelsLoadError, retryLoad: retryReelsLoad, initialRows, saveState: reelSaveState, scheduleSave } = useReelPersistence(setEntries ? userId : null);
  const [framingMap, setFramingMap] = useState<Record<string, Framing>>({});
  // entryId → live image-overlay list, reported by each canvas — feeds the timeline's overlay lane.
  const [overlaysMap, setOverlaysMap] = useState<Record<string, ImageOverlay[]>>({});
  const [reelTemplateMap, setReelTemplateMap] = useState<Record<string, string | null>>({}); // entryId → template id
  // entryId → user-given reel name (shown/edited in the bottom strip). Kept OUTSIDE VideoEntry — like
  // framing/template above — because entries model the video pipeline (fetch/upload state) while the name
  // is pure saved-grid metadata; it rides the same autosave rows. '' / absent = unnamed (number only).
  const [reelNameMap, setReelNameMap] = useState<Record<string, string>>({});
  const [framingDirty, setFramingDirty] = useState(0);   // bumped when a reel's crop/pan/zoom/trim changes
  const markFramingDirty = useCallback(() => setFramingDirty(n => n + 1), []);
  const reelsApplied = useRef(false);
  const autoFetched = useRef<Map<string, string>>(new Map());   // entryId → last URL we auto-fetched (no repeats)

  // Restore the saved grid once, after the saved rows have loaded.
  useEffect(() => {
    if (!setEntries || reelsApplied.current || !reelsLoaded) return;
    reelsApplied.current = true;
    onRestored?.();   // safe to append from the Content Sheet now — this restore won't clobber
    const fm: Record<string, Framing> = {};
    const tm: Record<string, string | null> = {};
    const nm: Record<string, string> = {};
    const loaded: VideoEntry[] = initialRows.map(r => {
      fm[r.id] = r.framing ?? {};
      tm[r.id] = r.templateId ?? null;
      if (r.name) nm[r.id] = r.name;
      // Reuse a cached fetch if we have it (client-side cache survives section switches) → restore the
      // video instantly with no API call and no skeleton flash.
      const cached = r.url.trim() && !r.videoUrl ? getCachedVideo(r.url.trim()) : undefined;
      return { ...makeEmptyEntry(r.id, r.mode), url: r.url, caption: r.caption, videoUrl: r.videoUrl || undefined, posterUrl: r.posterUrl || undefined, data: cached ?? null };
    });
    setFramingMap(fm);
    setReelTemplateMap(tm);
    setReelNameMap(nm);
    // On the FIRST restore this page-load, rebuild the grid from the saved rows. On a nav-back remount
    // the entries are already live in HomeClient (freshest — they include an upload that finished while
    // the grid was unmounted), so we only re-seed the maps above and must NOT overwrite entries.
    if (!restored) {
      // Reset even when there are NO saved rows (loaded is []) — to a single empty reel — so a same-tab
      // account switch can't leave the previous user's entries live (the autosave would otherwise capture
      // and write them into THIS user's row). setEntries also triggers a re-render that re-runs the
      // autosave with the reset entries, cancelling any transient debounce armed with the old user's rows.
      setEntries(loaded.length ? loaded : [makeEmptyEntry('1')]);
      // Cached links already carry their video (data set above) — mark them so the auto-fetch effect
      // skips them. UNCACHED links (e.g. after a full refresh clears the in-memory cache) are left
      // UNMARKED so the auto-fetch effect re-downloads them. Fetching there (on a debounced timer) is
      // what makes it work: an immediate fetch here races useVideoEntries' entriesRef, which isn't yet
      // updated with the restored reels, so fetchVideo can't find the entry and bails with "URL required".
      loaded.forEach(e => {
        if (!e.url.trim() || e.videoUrl) return;
        if (e.data) autoFetched.current.set(e.id, e.url.trim());
      });
    }
    // Adopt the first saved row's template as the active default for the picker.
    const firstTpl = initialRows.find(r => r.templateId)?.templateId;
    if (firstTpl) setActiveTwitterId(firstTpl);
    // Restore uploaded videos from IndexedDB: rows with no link get their stored blob back as a fresh
    // object URL. Marked in uploadedBlob first so the persist effect doesn't re-write the same bytes.
    if (!restored) {
      for (const r of initialRows) {
        if (r.url.trim()) continue;
        void getLocalVideo(r.id).then(hit => {
          if (!hit) return;
          const src = URL.createObjectURL(hit.blob);
          uploadedBlob.current.set(r.id, src);
          setEntries(prev => prev.map(e => (e.id === r.id && !e.localVideoSrc && !e.url.trim()
            ? { ...e, localVideoSrc: src, localVideoName: hit.name } : e)));
        });
      }
    }
  }, [setEntries, reelsLoaded, initialRows, onRestored, restored]);

  // Auto-fetch: in the reels section, a pasted/typed link fetches on its own (no Fetch button press).
  // Debounced via the effect's cleanup — while the URL keeps changing the timer resets; ~700ms after it
  // settles we fetch. Guarded so we never re-fetch the same URL or a row that's already loaded/uploading.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const e of entries) {
      if (e.loading || e.localVideoSrc || e.videoUrl) continue;
      if (e.data && !e.videoFailed) continue;                      // already fetched
      const url = e.url.trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) continue;             // wait for a complete-looking link
      if (autoFetched.current.get(e.id) === url) continue;         // already auto-fetched this exact URL
      const id = e.id;
      timers.push(setTimeout(() => { autoFetched.current.set(id, url); onFetchVideo(id); }, 700));
    }
    return () => timers.forEach(clearTimeout);
  }, [entries, onFetchVideo]);

  // Autosave: rebuild the rows from entries + live framing (read off each canvas ref) and debounce-save.
  useEffect(() => {
    if (!setEntries || !reelsApplied.current) return;
    const rows: SavedReel[] = entries
      .map(e => ({
        id: e.id,
        name: reelNameMap[e.id] ?? '',
        mode: e.mode === 'caption' ? 'caption' : 'twitter',
        url: e.url ?? '',
        videoUrl: e.videoUrl ?? '',
        posterUrl: e.posterUrl ?? '',
        caption: e.caption ?? '',
        templateId: reelTemplateMap[e.id] ?? activeTwitterId ?? null,
        // Only trust the live canvas framing once the video is actually loaded (readyState >= 2). A
        // mounted-but-not-loaded canvas (still buffering, or a failed/timed-out video) holds the
        // full-canvas placeholder box, not the band — persisting it made sheet-sent reels reload
        // full-canvas. getFraming() already nulls while loading; this also covers the errored case.
        framing: ((canvasRefsMap.current.get(e.id)?.getVideoElement()?.readyState ?? 0) >= 2
          ? canvasRefsMap.current.get(e.id)?.getFraming() : null) ?? framingMap[e.id] ?? {},
      }));
    scheduleSave(rows);
  }, [entries, reelTemplateMap, reelNameMap, activeTwitterId, framingDirty, setEntries, reelsLoaded, scheduleSave, framingMap, canvasRefsMap]);

  // Persist UPLOADED reel videos to IndexedDB so an uploaded reel survives reload — fully client-side.
  // (Pasted links stay re-fetched on load, matching the original behaviour.)
  const uploadedBlob = useRef<Map<string, string>>(new Map());   // entryId → the blob URL we've already persisted
  const persistUpload = useCallback(async (id: string, blobUrl: string, name?: string) => {
    if (!setEntries) return;
    try {
      const blob = await fetch(blobUrl).then(r => r.blob());
      await saveLocalVideo(id, blob, name || 'reel');
    } catch { uploadedBlob.current.delete(id); }
  }, [setEntries]);
  useEffect(() => {
    if (!setEntries) return;
    for (const e of entries) {
      if ((e.mode === 'twitter' || e.mode === 'caption')
        && e.localVideoSrc?.startsWith('blob:')
        && uploadedBlob.current.get(e.id) !== e.localVideoSrc) {   // (re)persist only when the blob is new
        uploadedBlob.current.set(e.id, e.localVideoSrc);
        void persistUpload(e.id, e.localVideoSrc, e.localVideoName);
      }
    }
  }, [entries, setEntries, persistUpload]);

  // URL + caption edit history (undo/redo via the rail + ⌘Z / ⌘⇧Z) for the reels posting page.
  const { recordEdit, undo, redo, canUndo, canRedo } = useReelEditHistory(entries, onUpdateEntry);

  // The video timeline (VideoControlsBar) keeps its own segment-edit history and reports it
  // up here, so the SAME rail island + ⌘Z drive it — no separate buttons in the bar. Timeline
  // edits take priority while the timeline is open and has history; otherwise we fall through
  // to the URL/caption history. The bar reports cleared state on unmount (timeline closed).
  const tlUndoRef = useRef<() => void>(() => {});
  const tlRedoRef = useRef<() => void>(() => {});
  const [tlCanUndo, setTlCanUndo] = useState(false);
  const [tlCanRedo, setTlCanRedo] = useState(false);
  const handleTimelineHistory = useCallback(
    (api: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) => {
      tlUndoRef.current = api.undo; tlRedoRef.current = api.redo;
      setTlCanUndo(api.canUndo); setTlCanRedo(api.canRedo);
    }, []);
  const mergedUndo = useCallback(() => { if (tlCanUndo) tlUndoRef.current(); else undo(); }, [tlCanUndo, undo]);
  const mergedRedo = useCallback(() => { if (tlCanRedo) tlRedoRef.current(); else redo(); }, [tlCanRedo, redo]);
  const mergedCanUndo = tlCanUndo || canUndo;
  const mergedCanRedo = tlCanRedo || canRedo;

  // Hold undo/redo in refs so the global keydown listener binds once (per videoMode), not every render.
  const undoRef = useRef(mergedUndo); const redoRef = useRef(mergedRedo);
  useEffect(() => { undoRef.current = mergedUndo; redoRef.current = mergedRedo; }, [mergedUndo, mergedRedo]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;   // let native text undo win in fields
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redoRef.current(); else undoRef.current(); }
      else if (k === 'y') { e.preventDefault(); redoRef.current(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Centered template dropdown (mirrors the Carousels toolbar) — open state, measured anchor, refs.
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);   // video-timeline editor — closed by default
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; left: number } | null>(null);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const templateTriggerRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const onDown = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) setShowTemplateDropdown(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowTemplateDropdown(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [showTemplateDropdown]);

  const videoRenderEntries = entries.filter(e =>
    !e.loading && (
      e.localVideoSrc || e.videoUrl || (e.data && !(e.data.images && e.data.images.length > 0))
    )
  );

  const [selectedId,                setSelectedId]                = useState<string>(entries[0]?.id ?? '');
  // Which reel is actually on screen — lags selectedId by one fade so the current reel can fade OUT
  // before we swap to (and fade IN) the next. reelVisible drives that fade's opacity.
  const [displayId,   setDisplayId]   = useState(selectedId);
  const [reelVisible, setReelVisible] = useState(true);
  const [recordingStateMap, setRecordingStateMap] = useState<Record<string, RecordingState>>({});

  const [canvasRefVersion,  setCanvasRefVersion]  = useState(0);
  const [videoZoomMap,      setVideoZoomMap]      = useState<Record<string, number>>({});

  const scrollRef  = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lane = useObservedSize(scrollRef);
  // Height-aware: video cards are 9:16 (tall), so fit to BOTH dims or a tall card overflows the viewport.
  const fitFactor = fitScaleFor(lane, CARD_W, Math.round(CARD_W * 16 / 9));
  // Focal-anchored pinch/Ctrl-scroll zoom with a one-shot absolute-100% default (shared editor scaffolding).
  const { viewScale, setViewScale, captureFocal, attachScroll } = useEditorZoomPan({
    scrollRef, contentRef, fitFactor, laneWidth: lane.width,
  });

  const prevLengthRef         = useRef(entries.length);
  const canvasRefRegistered   = useRef(new Set<string>());

  // Switching reels is instant — swap the rendered reel to the selection immediately, no fade. We don't
  // recenter: the reel centres on mount via the focal effect and the layout is identical, so scroll persists.
  // (A deleted selection is handled by the selectedId-validity effect below, which then re-runs this.)
  //
  // Only the DISPLAYED reel mounts a live <video>+canvas (see the render map) — a large grid must never
  // mount hundreds of videos (a 486-reel account would hang the browser). So before switching, snapshot
  // the OUTGOING reel's live framing into framingMap: its canvas is still mounted here (displayId hasn't
  // changed yet this render), getFraming() reads the current crop/pan/zoom/trim, and both autosave and the
  // reel's next mount read framingMap once the canvas ref is gone. getFraming() returns null mid-load
  // (framing not yet applied) — skip then, keeping the last-known value rather than a placeholder.
  const displayIdRef = useRef(displayId);
  const isDownloadingAllRef = useRef(false);   // set from isDownloadingAll below; read here (declared later)
  useEffect(() => { displayIdRef.current = displayId; }, [displayId]);
  useEffect(() => {
    const outgoing = displayIdRef.current;
    // Skip during Download-All: it cycles selectedId through every reel to export them, and capturing
    // each would materialize default framing + churn autosave for no user edit.
    if (outgoing && outgoing !== selectedId && !isDownloadingAllRef.current) {
      const outRef = canvasRefsMap.current.get(outgoing);
      // Only snapshot a reel whose video is actually LOADED (readyState ≥ 2). A mid-load canvas reports
      // a placeholder full-canvas box + zero-length trim, and getFraming() can't self-detect that for a
      // session-added reel (null initialFraming) — persisting it would corrupt the reel's crop/trim.
      if ((outRef?.getVideoElement()?.readyState ?? 0) >= 2) {
        const f = outRef?.getFraming();
        // Only commit when the framing actually changed, so merely navigating between reels doesn't
        // trigger an autosave (a whole-array upsert) on every switch.
        if (f) setFramingMap(prev => {
          const cur = prev[outgoing];
          return cur && JSON.stringify(cur) === JSON.stringify(f) ? prev : { ...prev, [outgoing]: f };
        });
      }
    }
    setDisplayId(selectedId);
    setReelVisible(true);
  }, [selectedId]);

  // Keep the active template tracking the reel currently on screen. A reel's effective template is
  // reelTemplateMap[id] ?? activeTwitterId, so syncing activeTwitterId to the selected reel's template
  // means template-less reels — freshly added, or SENT from the Content Sheet — inherit the band of the
  // reel you're actually looking at, not whatever template happened to be picked last. (If the selected
  // reel has no explicit template it's already using activeTwitterId, so leave it be.)
  useEffect(() => {
    const t = reelTemplateMap[selectedId];
    if (t) setActiveTwitterId(t);
  }, [selectedId, reelTemplateMap]);

  // Keep selectedId valid: if the selected reel is deleted, fall back to the first reel so the canvas
  // and the bottom strip's highlight stay coherent.
  useEffect(() => {
    if (selectedId && !entries.some(e => e.id === selectedId)) setSelectedId(entries[0]?.id ?? '');
  }, [entries, selectedId]);

  // Prioritise the reel you're looking at: when you switch to one whose video is still waiting in the
  // rate-limited fetch queue, bump it to the front so it loads next instead of behind the others. No-op
  // if it isn't queued (already fetched, or already downloading).
  useEffect(() => {
    const e = entries.find(x => x.id === selectedId);
    if (e && !e.data && !e.videoUrl && !e.localVideoSrc && e.url.trim()) prioritizeVideoFetch(e.url.trim());
  }, [selectedId, entries]);

  // When a new entry is added, select and scroll to it
  useEffect(() => {
    if (entries.length > prevLengthRef.current) {
      const newest = entries[entries.length - 1];
      if (newest) setTimeout(() => setSelectedId(newest.id), 30);
    }
    prevLengthRef.current = entries.length;
  }, [entries.length]);

  // Only the active reel plays: pause every other reel's video whenever the focus changes. Videos
  // never autoplay, so pausing the ones you flick away from keeps at most one playing at a time.
  useEffect(() => {
    canvasRefsMap.current.forEach((ref, id) => { if (id !== selectedId) ref.pause(); });
  }, [selectedId, canvasRefsMap]);


  // Paste-to-fill the selected row: ⌘/Ctrl+V a video file from the clipboard sets it as the
  // selected reel's media — the same as clicking that row's Upload button — so the user doesn't
  // have to. Ignored while typing so text / URL paste still works. Reels media are local object
  // URLs (no bucket upload), matching the Upload handlers; only video files are intercepted,
  // anything else falls through to default paste.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const sel = entries.find(en => en.id === selectedId) ?? entries[0];
      if (!sel) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind !== 'file' || !it.type.startsWith('video/')) continue;
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        if (sel.localVideoSrc?.startsWith('blob:')) URL.revokeObjectURL(sel.localVideoSrc);
        onUpdateLocalVideo(sel.id, URL.createObjectURL(file), file.name);
        onUpdateEntry(sel.id, 'url', '');
        return;
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [entries, selectedId, onUpdateLocalVideo, onUpdateEntry]);

  // Duplicate a reel: copy the entry, then carry over all id-keyed editor state (reel
  // framing/template/zoom/scale) to the new id, and select the copy. Framing prefers the LIVE value
  // off the canvas ref so the duplicate matches exactly what's on screen.
  const handleDuplicate = useCallback((id: string) => {
    const newId = onDuplicateRow(id);
    if (!newId) { setReelCapNotice(`You’ve hit the ${MAX_REELS}-reel limit — remove one to add another.`); return; }
    const carry = <T,>(set: Dispatch<SetStateAction<Record<string, T>>>) =>
      set(prev => (id in prev ? { ...prev, [newId]: prev[id] } : prev));
    carry(setVideoZoomMap);
    carry(setReelNameMap);   // the copy keeps the source's name (rename it apart afterwards)
    setReelTemplateMap(prev => ({ ...prev, [newId]: prev[id] ?? activeTwitterId ?? null }));
    setFramingMap(prev => ({ ...prev, [newId]: canvasRefsMap.current.get(id)?.getFraming() ?? prev[id] ?? {} }));
    setSelectedId(newId);
  }, [onDuplicateRow, activeTwitterId]);

  const getVideoZoom = useCallback((id: string) => videoZoomMap[id] ?? 1, [videoZoomMap]);

  // Add an image overlay to a reel: persist the blob (IndexedDB) so it survives reloads, then hand a
  // fresh object URL to the canvas, which sizes/centres it and selects it.
  const addOverlayImage = useCallback(async (id: string, file: File) => {
    const overlayId = `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await saveOverlayImage(overlayId, file, file.name);
    canvasRefsMap.current.get(id)?.addImageOverlay(overlayId, URL.createObjectURL(file), file.name);
  }, [canvasRefsMap]);

  const applyVideoZoom = useCallback((id: string, s: number) => {
    const clamped = Math.max(0.5, Math.min(3, s));
    setVideoZoomMap(prev => ({ ...prev, [id]: clamped }));
    canvasRefsMap.current.get(id)?.setZoom(clamped);
  }, [canvasRefsMap]);

  // ── Download (one reel, or all) ───────────────────────────────────────────────
  // Only the on-screen reel is mounted (canvasRefsMap holds a single ref), so "Download all" can't just
  // loop the refs — it cycles the selection to each reel, waits for it to mount + load, then exports.
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  useEffect(() => { isDownloadingAllRef.current = isDownloadingAll; }, [isDownloadingAll]);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });
  // Post-batch summary when a "download all" didn't produce every reel — otherwise the zip silently
  // omits failed/never-ready reels and the user thinks they got everything.
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  // Shown when an add/duplicate is blocked by the MAX_REELS cap.
  const [reelCapNotice, setReelCapNotice] = useState<string | null>(null);
  const atReelCap = entries.length >= MAX_REELS;
  // "Delete all reels" confirm. Only offered when there's actually something to clear (more than one
  // reel, or a single reel that isn't blank).
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const hasReelContent = entries.length > 1
    || (!!entries[0] && !!(entries[0].url?.trim() || entries[0].videoUrl || entries[0].localVideoSrc || entries[0].caption?.trim()));
  // Any export in flight — every export button disables while one runs, since they share the reel
  // canvases and only one recording can run at a time.
  const exportBusy = downloadingOne || isDownloadingAll;

  // Wait until reel `id`'s canvas has mounted (after the swap fade) and its video is ready enough to export.
  const waitForReelReady = useCallback(async (id: string, timeoutMs = 15000): Promise<TikTokCanvasRef | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ref = canvasRefsMap.current.get(id);
      const video = ref?.getVideoElement();
      if (ref && video && video.readyState >= 2) return ref;
      await new Promise(r => setTimeout(r, 80));
    }
    return canvasRefsMap.current.get(id) ?? null;
  }, [canvasRefsMap]);

  const downloadAllReels = useCallback(async () => {
    if (isDownloadingAll || downloadingOne) return;
    const toDownload = entries.filter(e => !e.loading
      && (e.localVideoSrc || e.videoUrl || (e.data && !(e.data.images && e.data.images.length > 0))));
    if (toDownload.length === 0) return;
    const original = selectedId;
    // Export in strip/number order (FIFO) so the files come out numbered 1→N. Only the displayed reel is
    // mounted (virtualized), so we flip each reel on-screen (setSelectedId) and waitForReelReady before
    // exporting it; each reel's crop/pan/zoom is restored from framingMap on that mount.
    const ordered = toDownload;
    // One dated folder for the whole batch (filesystem-safe, no colons): YYYY-MM-DD_HH-MM-SS.
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const folder = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}`;
    setIsDownloadingAll(true);
    setDownloadNotice(null);
    setDownloadProgress({ done: 0, total: ordered.length });
    // Collect every reel's export as bytes (in number order), then bundle into ONE zip named the folder,
    // with each file nested under `<folder>/` so it extracts to a single dated folder.
    const files: Record<string, Uint8Array> = {};
    let omitted = 0;              // reels that never rendered (canvas not ready, or export failed/empty)
    let stoppedForQuota = false;  // export quota ran out mid-batch
    try {
      for (let i = 0; i < ordered.length; i++) {
        const entry = ordered[i];
        // Pipeline: start downloading the NEXT reel's bytes while this one exports, so flipping to it
        // isn't gated on a fresh CDN fetch (its canvas then loads instantly from the blob cache).
        const next = ordered[i + 1];
        const nextSrc = next && !next.localVideoSrc ? (next.videoUrl ?? (next.data ? bestVideoUrl(next.data) : null)) : null;
        if (nextSrc) void getVideoBlob(nextSrc);
        let ref = canvasRefsMap.current.get(entry.id);
        const vid = ref?.getVideoElement();
        if (!ref || !vid || vid.readyState < 2) {
          setSelectedId(entry.id);
          ref = (await waitForReelReady(entry.id)) ?? undefined;
        }
        if (ref) {
          // Each finished reel is one export (FREE_TIER_PLAN.md), charged once the canvas is
          // actually ready — keyed by entry, so a failed export retries free and a spent quota
          // ends the batch (whatever exported before the stop still zips below).
          if (!(await exportGuard.consumeOne(`reel:${entry.id}`))) { stoppedForQuota = true; break; }
          try {
            const blob = await ref.exportBlob();
            if (blob) {
              const reelNo = entries.findIndex(x => x.id === entry.id) + 1;
              const cap = (entry.caption || '').replace(/[/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
              const stem = `${String(reelNo).padStart(2, '0')}_${cap || 'reel'}`;
              // Numbering is unique by construction, but a filename map silently drops an entry on a key
              // clash — so never let one reel overwrite another: suffix _2, _3, … if the name is taken.
              let name = `${stem}.mp4`;
              for (let n = 2; files[`${folder}/${name}`]; n++) name = `${stem}_${n}.mp4`;
              files[`${folder}/${name}`] = new Uint8Array(await blob.arrayBuffer());
            } else { omitted++; }   // exportBlob returned null → nothing rendered
          } catch (err) { omitted++; console.error(`Failed to export reel ${entry.id}:`, err); }
        } else { omitted++; }       // canvas never became ready within the timeout
        setDownloadProgress(p => ({ ...p, done: i + 1 }));
      }
      if (Object.keys(files).length > 0) {
        // Store-only (level 0) — the MP4s are already compressed, so this is just fast bundling.
        // fflate loads on demand: only this export path needs it, so it stays out of the initial bundle.
        const { zip } = await import('fflate');
        const zipped = await new Promise<Uint8Array>((resolve, reject) =>
          zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))));
        const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
        Object.assign(document.createElement('a'), { href: url, download: `${folder}.zip` }).click();
        URL.revokeObjectURL(url);
      }
      // Tell the user when the zip isn't the whole set (rendered count vs attempted), instead of
      // silently handing over a short zip.
      const got = Object.keys(files).length;
      // consumeOne returns false for BOTH a real quota-exhaustion and a transient quota-check failure,
      // so don't assert "limit reached" (a false paywall on a network blip) — point at the export-limit
      // chip, which shows the true remaining count, and stay accurate either way.
      if (stoppedForQuota) setDownloadNotice(`Stopped at ${got} of ${ordered.length} — check your export limit.`);
      else if (omitted > 0) setDownloadNotice(`Downloaded ${got} of ${ordered.length} — ${omitted} couldn’t be rendered.`);
    } finally {
      setSelectedId(original);   // restore the user's reel (no-op if already there)
      setReelVisible(true);
      setIsDownloadingAll(false);
    }
  }, [isDownloadingAll, downloadingOne, entries, selectedId, canvasRefsMap, waitForReelReady, exportGuard]);

  const selectedEntry = entries.find(e => e.id === selectedId) ?? entries[0];

  const showVideoControls = !!selectedEntry && (
    !!selectedEntry.localVideoSrc || !!selectedEntry.videoUrl || (!!selectedEntry.data && !selectedEntry.loading)
  );
  // The bottom timeline strip shows whenever it's toggled open AND either a video is loaded (the real
  // VideoControlsBar) or there's no video yet (an empty-timeline placeholder).
  const timelineStripShown = timelineOpen && !!selectedEntry;

  // canvasRefVersion forces re-derivation when refs populate
  const activeVideoRef = showVideoControls && canvasRefVersion >= 0
    ? (canvasRefsMap.current.get(selectedEntry!.id) ?? null)
    : null;

  const activeRecordingState = showVideoControls
    ? (recordingStateMap[selectedEntry!.id] ?? null)
    : null;

  // Source URL for the selected reel's video — fed to the timeline for filmstrip thumbnail extraction.
  // Byte-cache the active reel's video so export doesn't re-download the (short-lived) CDN URL — which
  // 403s once it expires. We fetch the full file through the proxy once, while the link is fresh, into a
  // blob and prefer that as the source; export then reads the blob directly instead of re-hitting the CDN.
  const [videoBlobUrls, setVideoBlobUrls] = useState<Record<string, string>>({});
  const blobFetchingRef = useRef<Set<string>>(new Set());
  // Revoke every cached blob URL on unmount — each one pins the full video bytes in memory, so
  // section-switching without this leaks the entire byte-cache every visit.
  const videoBlobUrlsRef = useRef(videoBlobUrls);
  useEffect(() => { videoBlobUrlsRef.current = videoBlobUrls; }, [videoBlobUrls]);
  useEffect(() => () => { for (const url of Object.values(videoBlobUrlsRef.current)) URL.revokeObjectURL(url); }, []);

  const activeVideoSrc = useMemo(() => {
    if (!showVideoControls) return null;
    // Prefer the in-session source (local blob → downloaded blob → the proxy stream we're already
    // playing) over videoUrl. A background store setting videoUrl mid-session must NOT flip the source,
    // which would reload the <video> and reset the user's live crop/pan/zoom/trim. videoUrl is only the
    // source on a fresh load, when data is null (auto-fetch skips already-stored reels).
    return selectedEntry!.localVideoSrc
      ?? videoBlobUrls[selectedEntry!.id]
      ?? (selectedEntry!.data ? bestVideoUrl(selectedEntry!.data) : selectedEntry!.videoUrl ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showVideoControls,
    selectedEntry?.id,
    selectedEntry?.localVideoSrc,
    selectedEntry?.videoUrl,
    selectedEntry?.data?.play,
    selectedEntry?.data?.hdplay,
    selectedEntry?.data?.wmplay,
    videoBlobUrls,
  ]);

  // Best-effort: download the selected link-fetched reel's bytes into a blob once it loads (uploads and
  // persisted reels are already stable, so they're skipped). If the download fails (e.g. the URL already
  // expired), we just fall back to the CDN URL and export may still 403 — but the common
  // fetch→edit→export flow caches the bytes while the link is fresh.
  useEffect(() => {
    const e = selectedEntry;
    if (!e) return;
    if (e.localVideoSrc || e.videoUrl || !e.data) return;
    if (videoBlobUrls[e.id] || blobFetchingRef.current.has(e.id)) return;
    const proxyUrl = bestVideoUrl(e.data);
    if (!proxyUrl) return;
    blobFetchingRef.current.add(e.id);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(proxyUrl);
        if (!res.ok || cancelled) return;
        const blobUrl = URL.createObjectURL(await res.blob());
        if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
        setVideoBlobUrls(prev => {
          if (prev[e.id]) { URL.revokeObjectURL(blobUrl); return prev; }
          return { ...prev, [e.id]: blobUrl };
        });
      } catch { /* best-effort */ }
      finally { blobFetchingRef.current.delete(e.id); }
    })();
    return () => { cancelled = true; };
  }, [selectedEntry, videoBlobUrls]);

  // First-run / empty state: reels posting in twitter mode with no reel templates → send to the editor.
  // While templates are still loading, render blank (not the posting UI) so it doesn't flash for a frame.
  // (Caption mode doesn't use a reel template, so it's unaffected.)
  if (videoMode === 'twitter' && twitterTemplates.length === 0) {
    return twitterLoaded ? (
      <TemplatesEmptyState
        title="No reel templates yet"
        description="You need a reel template before you can make a reel. Create one in the template editor first."
        actionLabel="Go to template editor"
        onAction={() => onGoToTemplateEditor?.()}
      />
    ) : <div className="h-full w-full" />;
  }

  return (
    <div className="relative w-full flex flex-col h-full overflow-hidden">

      {/* ── Element rail (mirrors the template editor): link + caption flyouts edit the SELECTED reel,
            with undo/redo for the URL/caption edits beneath. ── */}
      {selectedEntry && (
        <ElementRail
          categories={[
            { id: 'link', label: 'Video link', icon: linkGlyph, content: (
              <ReelLinkFlyout
                entry={selectedEntry}
                onUpdateField={(f, v) => recordEdit(selectedEntry.id, f, v)}
                onUpdateLocalVideo={(s, n) => onUpdateLocalVideo(selectedEntry.id, s, n)}
                onFetch={() => onFetchVideo(selectedEntry.id)}
              />
            ) },
          ]}
          extraIsland={(
            // Adjust island: per-reel framing/trim controls as a rail-style icon-button column.
            <ReelAdjustFlyout
              zoom={getVideoZoom(selectedEntry.id)}
              onZoom={z => applyVideoZoom(selectedEntry.id, z)}
              onResetTrim={() => canvasRefsMap.current.get(selectedEntry.id)?.resetTrim()}
              onResetBox={() => canvasRefsMap.current.get(selectedEntry.id)?.resetBox()}
              onCenter={() => canvasRefsMap.current.get(selectedEntry.id)?.centerBox()}
              timelineOpen={timelineOpen}
              onToggleTimeline={() => setTimelineOpen(o => !o)}
              onAddImage={file => void addOverlayImage(selectedEntry.id, file)}
              onRemoveVideo={() => {
                // Erase the loaded clip + its link → showVideoControls flips false, so the island
                // collapses back out. Clearing the URL too prevents an auto re-fetch.
                if (selectedEntry.localVideoSrc) URL.revokeObjectURL(selectedEntry.localVideoSrc);
                onUpdateLocalVideo(selectedEntry.id, '', '');
                recordEdit(selectedEntry.id, 'url', '');
                setTimelineOpen(false);   // close the timeline too — no video left to edit
              }}
            />
          )}
          extraIslandOpen={showVideoControls}
          onUndo={mergedUndo}
          onRedo={mergedRedo}
          canUndo={mergedCanUndo}
          canRedo={mergedCanRedo}
          bottomSlot={onDeleteAllReels && hasReelContent ? (
            // Its own rail island (matches the undo/redo card): a size-9 rounded-xl icon button,
            // danger-tinted, so it reads as a sibling of the rail's other action buttons.
            <div className="w-full flex flex-col items-center gap-1 rounded-2xl bg-surface-1 border border-line shadow-2 p-1.5">
              <button
                type="button"
                title="Delete all reels"
                aria-label="Delete all reels"
                disabled={exportBusy || isDownloadingAll}
                onClick={() => setConfirmDeleteAll(true)}
                className="flex items-center justify-center size-9 rounded-xl text-danger-text hover:bg-danger-tint transition-colors focus-ring disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ) : undefined}
        />
      )}

      {/* ── Toolbar (mirrors the Carousels toolbar: zoom · centred template dropdown · autosave + download) ── */}
      <div ref={toolbarRef} className="relative flex items-center justify-between gap-4 px-4 border-b border-line shrink-0 bg-surface-1" style={{ height: HEADER_H }}>
        {/* Left slot: the Canvas ⇄ Sheet toggle when the host provides one; otherwise an empty
            spacer keeping justify-between honest (autosave + download stay pinned right even when
            the absolutely-centred template dropdown is the only other child). Mirrors Carousels. */}
        <div className="flex items-center">{viewToggle}</div>

        {/* Centre: reel-template dropdown — mirrors the Carousels template dropdown. Selects which saved
            reel template (overlay style) is active; absolutely centred over the canvas. Only in twitter
            mode (where the templates apply). */}
        {videoMode === 'twitter' && (
          <div className="absolute inset-x-0 flex justify-center items-center pointer-events-none">
            <div ref={templateDropdownRef} className="pointer-events-auto relative flex items-center">
              <button
                ref={templateTriggerRef}
                onClick={() => setShowTemplateDropdown(v => {
                  if (!v && templateTriggerRef.current) {
                    const r = templateTriggerRef.current.getBoundingClientRect();
                    const headerBottom = toolbarRef.current?.getBoundingClientRect().bottom ?? r.bottom;
                    setDropdownAnchor({ top: headerBottom + 8, left: r.left + r.width / 2 });
                  }
                  return !v;
                })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-fg hover:bg-hover transition-colors focus-ring"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg-3 shrink-0">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                <span className="text-subheading text-fg max-w-[180px] truncate">
                  {activeTwitter?.name ?? 'Reels'}
                </span>
                <ChevronDownIcon size={12} className="text-fg-3 shrink-0" aria-hidden />
              </button>
              {showTemplateDropdown && dropdownAnchor && (
                <div
                  className="fixed w-[240px] bg-surface-2 border border-line rounded-xl shadow-3 z-modal py-1 overflow-hidden"
                  style={{ top: dropdownAnchor.top, left: dropdownAnchor.left, transform: 'translateX(-50%)' }}
                >
                  <div className="max-h-[320px] overflow-y-auto scrollbar-none">
                    {twitterTemplates.length === 0 ? (
                      <p className="text-caption text-fg-3 px-3 py-4 text-center">No reel templates yet</p>
                    ) : twitterTemplates.map(t => {
                      const isActive = t.id === (activeTwitter?.id ?? '');
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            setActiveTwitterId(t.id);
                            // Assign the chosen template to the selected reel (so rows can inherit different templates).
                            if (selectedId) setReelTemplateMap(prev => ({ ...prev, [selectedId]: t.id }));
                            setShowTemplateDropdown(false);
                          }}
                          className={`flex items-center gap-2 w-full py-2 px-3 text-subheading text-left rounded-sm focus-ring transition-colors ${isActive ? 'bg-active text-fg' : 'text-fg-2 hover:text-fg hover:bg-hover'}`}
                        >
                          <span className="flex-1 truncate">{t.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right: autosave + export quota + download (styled like Carousels). */}
        <div className="flex items-center gap-3">
          {/* Sustained load failure: the persistence guard keeps `loaded` false so autosave can't
              overwrite the saved grid with an empty one — but that also means edits made now won't
              save. Say so and offer a retry instead of a silently-empty, silently-unsaved canvas. */}
          {reelsLoadError && (
            <span className="flex items-center gap-1.5 text-caption text-danger-text whitespace-nowrap">
              Couldn&apos;t load your reels — edits won&apos;t save yet
              <button type="button" onClick={retryReelsLoad} className="underline underline-offset-2 hover:text-fg focus-ring rounded-xs">Retry</button>
            </span>
          )}
          {downloadNotice && (
            <span className="flex items-center gap-1.5 text-caption text-fg-2 whitespace-nowrap">
              {downloadNotice}
              <button type="button" onClick={() => setDownloadNotice(null)} aria-label="Dismiss" className="text-fg-4 hover:text-fg focus-ring rounded-xs">×</button>
            </span>
          )}
          {reelCapNotice && (
            <span className="flex items-center gap-1.5 text-caption text-fg-2 whitespace-nowrap">
              {reelCapNotice}
              <button type="button" onClick={() => setReelCapNotice(null)} aria-label="Dismiss" className="text-fg-4 hover:text-fg focus-ring rounded-xs">×</button>
            </span>
          )}
          <AutosaveChip state={reelSaveState} />
          {/* Download just the on-screen reel — keeps its live crop/pan/zoom. */}
          {showVideoControls && selectedEntry && (
            <Button
              variant="primary"
              size="sm"
              loading={downloadingOne}
              onClick={async () => {
                if (exportBusy) return;
                const id = selectedEntry.id;
                setDownloadingOne(true);
                // The render surfaces its own failure via the canvas status; swallow the rejection
                // here so it doesn't become an uncaught promise error.
                try { await exportGuard.guard(`reel:${id}`, () => canvasRefsMap.current.get(id)?.startDownload()); }
                catch (err) { console.error('[reel download]', err); }
                finally { setDownloadingOne(false); }
              }}
              disabled={exportBusy}
              leadingIcon={<DownloadIcon size={13} />}
              className="rounded-full"
            >
              Download
            </Button>
          )}
          {/* Download every reel (cycles through them); only shown when there's more than one. */}
          {videoRenderEntries.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadAllReels}
              disabled={exportBusy}
              leadingIcon={<DownloadIcon size={13} />}
              className="rounded-full"
            >
              {isDownloadingAll ? `Downloading ${downloadProgress.done}/${downloadProgress.total}…` : 'Download All'}
            </Button>
          )}
        </div>
      </div>

      {onDeleteAllReels && (
        <Modal
          open={confirmDeleteAll}
          onClose={() => setConfirmDeleteAll(false)}
          title="Delete all reels?"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => {
                onDeleteAllReels();
                // The reset reel reuses id '1', so the per-reel state maps (keyed by id) must be cleared
                // too — otherwise the deleted reel's template/framing/zoom/name/recording bleed onto the
                // fresh reel and get re-saved. Clearing gives a true clean slate.
                setFramingMap({}); setReelTemplateMap({}); setReelNameMap({}); setVideoZoomMap({}); setRecordingStateMap({}); setOverlaysMap({});
                setConfirmDeleteAll(false);
              }}>Delete all reels</Button>
            </>
          }
        >
          <p className="text-caption text-fg-3">
            This removes every reel from your workspace and permanently deletes their stored videos. It
            can&apos;t be undone. Download anything you want to keep first.
          </p>
        </Modal>
      )}

      {/* ── Reel canvas — one reel at a time, like the carousels editor (switch via the docked strip) ── */}
      <div
        ref={attachScroll}
        className="flex-1 overflow-auto overscroll-contain no-native-scrollbar flex flex-col [align-items:safe_center] [justify-content:safe_center]"
      >
        {/* World wrapper — width = lane × viewScale/ZOOM_MIN. At min zoom it exactly fills the view (whole
            reel visible, nothing to pan); zoom in and it overflows so you pan within that one reel. The
            pannable area is always just the min-zoom view scaled up — never an unbounded void. */}
        <div className="flex justify-center" style={{ minWidth: lane.width ? lane.width * viewScale / ZOOM_MIN : undefined }}>
        <div ref={contentRef} className="flex flex-col items-center py-6 px-4" style={{ zoom: fitFactor * viewScale, opacity: reelVisible ? 1 : 0 }}>
          {/* VIRTUALIZED: only the displayed reel mounts a live canvas — mounting every reel's <video>
              would hang the browser on a large grid (a real account has 486 reels). A reel's edits
              (crop/zoom/pan/trim) live inside its canvas while mounted, so before a switch unmounts the
              outgoing reel we snapshot its getFraming() into framingMap (see the [selectedId] effect
              above); its next mount replays that via initialFraming. Do NOT revert to keeping all reels
              mounted without also removing that capture, or edits are lost. displayId lags selectedId by
              one render, which is why the capture reads the still-mounted outgoing reel. */}
          {entries.map((entry, index) => {
            // Virtualized: only the displayed reel renders its (heavy) canvas + template compute. Every
            // other reel is a zero-cost hidden placeholder — navigation is the SlidesStrip below, and the
            // outgoing reel's framing was snapshotted into framingMap on the switch, so nothing is lost.
            if (entry.id !== displayId) return <div key={entry.id} className="hidden" aria-hidden />;
            // Each reel renders with ITS OWN inherited template (so a saved grid can mix templates);
            // falls back to the active picker selection, then the default look.
            const rowTemplateId = reelTemplateMap[entry.id] ?? activeTwitterId;
            const rowSettings = twitterTemplates.find(t => t.id === rowTemplateId)?.settings ?? twSettings;

            const hasRender = !entry.loading && (
              !!entry.localVideoSrc
              || !!entry.videoUrl
              || (!!entry.data && !(entry.data.images && entry.data.images.length > 0))
            );

            return (
              <div
                key={entry.id}
                className="flex flex-col gap-3"
                style={{ width: CARD_W }}
              >
                {/* URL + caption live in the left rail's link/caption flyouts. */}

                {/* Template + video skeleton — what the reel will look like, shown until a video is added. */}
                {!hasRender && entry.mode === 'twitter' && !entry.loading && (
                  <div className="mt-2">
                    <ReelTemplatePreview settings={rowSettings} brand={brand} width={CARD_W} overlayCaption={entry.caption} />
                  </div>
                )}
                {/* Canvas render (only when ready) */}
                {hasRender && (
                  <div className="flex flex-col gap-4 mt-2">
                    {/* Selection ring + canvas */}
                    <div
                      onClick={() => setSelectedId(entry.id)}
                      className="relative cursor-pointer transition-all duration-150 mt-1 ring-1 ring-line hover:ring-line-strong"
                    >
                      <TikTokCanvas
                          ref={r => {
                            if (r) {
                              canvasRefsMap.current.set(entry.id, r);
                              if (!canvasRefRegistered.current.has(entry.id)) {
                                canvasRefRegistered.current.add(entry.id);
                                setCanvasRefVersion(v => v + 1);
                              }
                            } else {
                              canvasRefsMap.current.delete(entry.id);
                            }
                          }}
                          videoSrc={entry.localVideoSrc ?? (entry.data ? bestVideoUrl(entry.data) : entry.videoUrl ?? '')}
                          videoId={entry.data?.id}
                          rowNumber={index}
                          onVideoError={() => onHandleVideoError(entry.id)}
                          brand={entry.mode === 'caption' ? 'clean' : 'sonotrade'}
                          overlayLogoSrc={brand.logoSrc || '/templatelogo.png'}
                          overlayDisplayName={rowSettings.defaultDisplayName || brand.displayName || 'Your Name'}
                          overlayHandle={rowSettings.defaultHandle || brand.handle || '@yourhandle'}
                          overlayVerified={rowSettings.showVerified}
                          overlayCaption={entry.caption}
                          twitterSettings={rowSettings}
                          initialFraming={framingMap[entry.id] ?? null}
                          onFramingChange={markFramingDirty}
                          onOverlaysChange={list => setOverlaysMap(prev => ({ ...prev, [entry.id]: list }))}
                          onRecordingStateChange={state =>
                            setRecordingStateMap(prev => ({ ...prev, [entry.id]: state }))
                          }
                        />
                      {/* Export progress — a bar across the bottom of the current reel while it downloads. */}
                      {(() => {
                        const rec = recordingStateMap[entry.id];
                        if (!rec?.isRecording) return null;
                        return (
                          <div className="absolute inset-x-0 bottom-0 z-20 h-2 bg-black/50 overflow-hidden">
                            <div
                              className="h-full bg-accent transition-[width] duration-200 ease-out"
                              style={{ width: `${Math.max(2, Math.round(rec.recProgress * 100))}%` }}
                            />
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
        {/* Spacer reserving room for the docked slides strip — a flow element (not container padding) so
            safe-centre can still scroll the reel to its top. */}
        <div aria-hidden className="shrink-0" style={{ height: SLIDES_DOCK_CLEARANCE }} />
      </div>

      {/* ── Video timeline — bottom panel; toggled from the on-canvas button. Sits in FRONT of the left
            rail (z-30) so the undo/redo island tucks behind the timeline instead of overlapping it. ── */}
      <div className="relative bg-surface-1" style={{ zIndex: 40 }}>
        {timelineStripShown && (
          showVideoControls ? (
            <VideoControlsBar
              entryId={selectedEntry!.id}
              activeRef={activeVideoRef}
              recordingState={activeRecordingState}
              videoSrc={activeVideoSrc}
              overlays={overlaysMap[selectedEntry!.id] ?? []}
              onHistory={handleTimelineHistory}
              guardExport={run => exportGuard.guard(`reel:${selectedEntry!.id}`, run)}
            />
          ) : (
            <EmptyTimeline />
          )
        )}
      </div>

      {/* Add-reel card — docked at the bottom of the lane (like the Carousels slides strip), so it's
          out of the spotlight carousel flow and never pushes the active reel off-centre. Click-through
          outer that tracks the rail; the centred card captures clicks and is capped to the canvas region.
          Hidden while the reel video timeline is open — the timeline takes over the bottom strip. */}
      {!timelineStripShown && (
      <div className="fixed bottom-4 z-30 flex justify-center pointer-events-none" style={{ left: 'var(--rail-w, 0px)', right: 0 }}>
        {/* Cap the strip to the canvas region so it stays centred under the reel. */}
        <div className="pointer-events-auto" style={{ maxWidth: 'calc(100% - 20%)' }}>
          <SlidesStrip
            slides={entries.map(e => {
              const rs = recordingStateMap[e.id];
              return { id: e.id, name: reelNameMap[e.id] ?? '', progress: rs?.isRecording ? rs.recProgress : undefined };
            })}
            activeSlideId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => { if (atReelCap) { setReelCapNotice(`You’ve hit the ${MAX_REELS}-reel limit — remove one to add another.`); return; } onAddRow(); }}
            // Renames land in the name map, which is an autosave-effect dep — so they persist onto the
            // reel's saved-grid row through the normal debounced save, no extra write path.
            onRename={(id, name) => setReelNameMap(prev => ({ ...prev, [id]: name }))}
            onDelete={onRemoveRow}
            onDuplicate={handleDuplicate}
            onReorder={() => {}}
            numbered
          />
        </div>
      </div>
      )}

      {/* Portals into <body>, so the wrapper's display:none (Sheet view) can't hide it — gate on active. */}
      {active && (
        <EditorScrollBar
          targetRef={scrollRef}
          zoom={fitFactor * viewScale}
          extent={Math.max(0, 1 - (viewScale - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN))}
          style={{ left: 'var(--rail-w, 0px)', right: 0 }}
        />
      )}

      {/* Bottom-left zoom box — hidden while the reel timeline is open (it would overlap the timeline). */}
      {!timelineStripShown && (
        <ZoomControl value={fitFactor * viewScale} min={fitFactor * ZOOM_MIN} max={fitFactor * ZOOM_MAX} resetTo={1} onChange={v => { captureFocal(); setViewScale(v / fitFactor); }} />
      )}
    </div>
  );
}
