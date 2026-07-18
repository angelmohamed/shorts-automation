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
import { extractMemeLines } from '@/lib/memeOcr';
import type { Framing, ImageOverlay } from './TikTokCanvas/types';
import { TemplatesEmptyState } from './TemplatesEmptyState';
import { defaultTwitterTemplateSettings } from './twitterTemplateTypes';
import type { VideoEntry, BrandProps } from '../types';
import type { RecordingState } from './TikTokCanvas/types';
import { VideoControlsBar } from './VideoControlsBar';
import { bestVideoUrl, proxyStreamUrl, fmtTime } from '@/lib/utils';
import { getVideoBlob } from '@/lib/reelVideoBlob';
import { Button, IconButton, Modal, HEADER_H } from './ui';
import { AutosaveChip } from './AutosaveChip';
import { ElementRail, RailActionButton } from './ElementRail';
import { ReelTemplatePreview } from './ReelTemplatePreview';
import { SlidesStrip } from './SlidesStrip';
import { EditorScrollBar } from './EditorScrollBar';
import { ZoomControl } from './ZoomControl';
import { ThemeToggle } from './ThemeToggle';
import { PipelineView, type StageKey } from './PipelineView';
import { SHORTS_MAX_SECONDS, estimateNarrationSeconds, reelDurationInfo } from '@/lib/reelDuration';
import { computePipelineStages, computePipelineMusicId } from '@/lib/pipelineStatus';
import { markRedditUsed } from '@/lib/redditScout/markUsed';
import { ScoutPanel } from './ScoutPanel';
import { canonicalThreadKey, partitionImportUrls, releaseByUrls, migrateScoutBuffer, postIdFromUrl } from '@/lib/redditScout/handoff';
import { parseStoredThreads, serializeThreads } from '@/lib/redditScout/bulkPersist';
import { applyThreadEdits, hasThreadEdits, remapCommentEdits, depth0IndexOf, writeCommentEdit, readCommentEdit, splitParagraphs } from '@/lib/redditThreadEdits';
import type { RedditThreadEdits } from './TikTokCanvas/types';
import type { ScoutCandidate } from '@/lib/redditScout/types';
import { useObservedSize, fitScaleFor } from '@/app/hooks/useElementSize';
import { useEditorZoomPan, EDITOR_ZOOM_MIN as ZOOM_MIN, EDITOR_ZOOM_MAX as ZOOM_MAX } from '@/app/hooks/useEditorZoomPan';
import {
  UploadIcon, ArrowRightIcon, SpinnerIcon,
  CloseIcon, DownloadIcon, VideoIcon, LinkIcon, ChevronDownIcon, ChevronUpIcon, TrashIcon, CheckIcon,
} from '@/lib/icons';
import { fetchFootageManifest, isFootageUrl, type FootageSegment } from '@/lib/footage';
import { renderRedditCard, type RedditCardData, type RedditComment } from '@/lib/redditCard';
import type { MemeLine } from '@/lib/memeOcr';
import { BACKGROUND_TRACKS, DEFAULT_MUSIC_VOLUME, resolveMusicId } from '@/lib/music';

const CARD_W = CAROUSEL_PREVIEW_W; // 410 — same width as canvas preview

// Height of the flow spacer at the end of the scroll content, reserving room so the reel centres above
// the docked slides strip rather than behind it (matches the carousels editor's SLIDES_DOCK_CLEARANCE).
const SLIDES_DOCK_CLEARANCE = 120;


interface CanvasGridProps {
  entries: VideoEntry[];
  setEntries?: Dispatch<SetStateAction<VideoEntry[]>>;   // present in the Video Reels workspace (entries are page-owned)
  canvasRefsMap: MutableRefObject<Map<string, TikTokCanvasRef>>;
  brand: BrandProps;
  onAddRow: (initialUrl?: string) => void;
  onAddReels?: (urls: (string | undefined)[]) => string[];
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
const micGlyph = (<svg {...SVG_PROPS}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" /></svg>);
const shuffleGlyph = (<svg {...SVG_PROPS} width={13} height={13}><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></svg>);
const redditGlyph = (<svg {...SVG_PROPS}><circle cx="12" cy="14" r="7" /><circle cx="9.5" cy="14" r="0.7" fill="currentColor" stroke="none" /><circle cx="14.5" cy="14" r="0.7" fill="currentColor" stroke="none" /><path d="M12 7c0-2.5 1.5-4 3.5-4" /><circle cx="16.5" cy="3" r="1.2" /></svg>);
const musicGlyph = (<svg {...SVG_PROPS}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>);
const ytCopyGlyph = (<svg {...SVG_PROPS}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></svg>);

// A canvas getFraming() snapshot doesn't carry the flyout-only fields (Reddit thread link, YouTube
// title/description) — they live only in framingMap. Re-attach them from the existing entry so a
// snapshot (on reel switch or duplicate) can never silently drop them.
function withFramingSidecars(snapshot: Framing, prev: Framing | undefined): Framing {
  if (!prev) return snapshot;
  const out: Framing = { ...snapshot };
  if (prev.redditThread) out.redditThread = prev.redditThread;
  if (prev.ytTitle) out.ytTitle = prev.ytTitle;
  if (prev.description) out.description = prev.description;
  return out;
}

// Browse the shared background-footage library (R2 bucket) and pick a segment for the reel.
function FootagePicker({ activeUrl, onPick }: { activeUrl: string; onPick: (seg: FootageSegment) => void }) {
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<FootageSegment[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || segments) return;
    fetchFootageManifest().then(setSegments).catch(() => setError('Couldn’t load the footage library.'));
  }, [open, segments]);
  // Pick a random segment (never the one already active) — loads the manifest on demand so the
  // shuffle works without opening the list first.
  async function pickRandom() {
    try {
      const segs = segments ?? await fetchFootageManifest();
      if (!segments) setSegments(segs);
      const pool = segs.filter(s => s.url !== activeUrl);
      if (pool.length) onPick(pool[Math.floor(Math.random() * pool.length)]);
    } catch {
      setError('Couldn’t load the footage library.');
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setError(''); setOpen(o => !o); }}
          className="flex items-center gap-2 h-7 flex-1 min-w-0 text-body text-fg-2 hover:text-fg transition-colors focus-ring rounded-sm"
        >
          <VideoIcon size={13} className="shrink-0" />
          <span className="flex-1 text-left">Background footage</span>
          {open ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />}
        </button>
        <button
          type="button"
          onClick={pickRandom}
          title="Pick random footage"
          aria-label="Pick random footage"
          className="flex items-center justify-center size-7 shrink-0 rounded-sm text-fg-2 hover:text-fg hover:bg-hover transition-colors focus-ring"
        >
          {shuffleGlyph}
        </button>
      </div>
      {open && (
        error ? <span className="text-caption text-danger-text">{error}</span>
        : !segments ? <span className="text-caption text-fg-3">Loading footage…</span>
        : segments.length === 0 ? <span className="text-caption text-fg-3">No footage uploaded yet.</span>
        : (
          <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5 pr-1">
            {segments.map(s => (
              <button
                key={s.name}
                type="button"
                onClick={() => onPick(s)}
                className={`flex items-center gap-2 px-1.5 h-7 rounded-sm text-caption text-left transition-colors focus-ring ${
                  activeUrl === s.url ? 'bg-active text-fg' : 'text-fg-2 hover:text-fg hover:bg-hover'
                }`}
              >
                <span className="flex-1 truncate">{s.name.replace(/\.mp4$/, '')}</span>
                <span className="text-fg-3 shrink-0">{Math.round(s.size / 1e6)} MB</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// The selected reel's video source — paste a URL / upload a file / pick library footage / fetch.
function ReelLinkFlyout({ entry, onUpdateField, onUpdateLocalVideo, onFetch, onPickFootage, autoRandom, onAutoRandomChange }: {
  entry: VideoEntry;
  onUpdateField: (field: 'url' | 'caption', value: string) => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
  onFetch: () => void;
  onPickFootage: (seg: FootageSegment) => void;
  autoRandom: boolean;
  onAutoRandomChange: (v: boolean) => void;
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
      <FootagePicker activeUrl={isFootageUrl(entry.url) ? entry.url : ''} onPick={onPickFootage} />
      <button
        type="button"
        role="switch"
        aria-checked={autoRandom}
        onClick={() => onAutoRandomChange(!autoRandom)}
        className="flex items-center gap-2 pt-1 text-left select-none"
      >
        <span
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
          style={{ background: autoRandom ? 'var(--color-accent, #46d160)' : 'var(--color-line-strong, #3a3a3a)' }}
        >
          <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${autoRandom ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </span>
        <span className="text-caption text-fg-2">Auto-add random footage to new reels</span>
      </button>
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
      {entry.error && !hasLocal && <span className="text-caption text-danger-text">{entry.error}</span>}
    </div>
  );
}

// ── Reddit thread flyout ─────────────────────────────────────────────────────────────────────────
// Paste a thread link → /api/reddit imports post + comments → tick the comments/replies to feature →
// the card renders (redditCard.ts) and lands on the canvas as a narratable image overlay whose
// ocrLines are synthetic (pixel-exact, no OCR pass).
interface ImportedRedditPost {
  user: { name: string; avatar?: string };
  timeAgo?: string; title: string; body?: string; score?: string; commentCount?: string;
}
interface ImportedRedditComment {
  user: { name: string; avatar?: string };
  body: string; timeAgo?: string; score?: string; depth: number; isOP?: boolean;
}

// splitParagraphs now lives in '@/lib/redditThreadEdits' — ONE canonical splitter, shared with the
// edit-application logic, so pick indices and edit indices can never drift apart.

/** Re-normalize depths for an arbitrary selection: a reply whose parent isn't selected is promoted
    to one level under its nearest SELECTED ancestor (or to top level) so connector rails on the
    card only ever point at comments that are actually there. The post body is opt-in per
    paragraph — long story posts would otherwise dwarf the card (title is always the header). */
function buildRedditCardData(post: ImportedRedditPost, comments: ImportedRedditComment[], selected: Set<number>, selectedParas: Set<number>): RedditCardData {
  const paras = splitParagraphs(post.body).filter((_, i) => selectedParas.has(i));
  const chain: (number | null)[] = [];   // chain[origDepth] = new depth of last SELECTED comment there
  const sel: RedditComment[] = [];
  comments.forEach((c, i) => {
    chain.length = c.depth;
    if (selected.has(i)) {
      let parentNew: number | null = null;
      for (let d = c.depth - 1; d >= 0; d--) { const v = chain[d]; if (v != null) { parentNew = v; break; } }
      const nd = parentNew == null ? 0 : parentNew + 1;
      sel.push({ user: c.user, body: c.body, timeAgo: c.timeAgo, score: c.score || undefined, depth: nd, isOP: c.isOP });
      chain[c.depth] = nd;
    } else {
      chain[c.depth] = null;
    }
  });
  return {
    user: post.user, timeAgo: post.timeAgo, title: post.title,
    body: paras.length ? paras.join('\n\n') : undefined,
    score: post.score || undefined, commentCount: post.commentCount || undefined, comments: sel,
  };
}

// YouTube copy generator — its own rail flyout. Reads the reel's saved Reddit thread link, imports
// the thread (cached for the mount), and generates title + description in one model call, or
// regenerates either individually. Fields persist per reel via Framing (ytTitle / description).
function YtCopyFlyout({ threadUrl, threadEdits, ytTitle, onYtTitleChange, description, onDescriptionChange }: {
  threadUrl: string | null;
  /** Pick-stage text edits for this reel — the copy must describe the tweaked thread, not the original. */
  threadEdits?: RedditThreadEdits;
  ytTitle: string;
  onYtTitleChange: (t: string) => void;
  description: string;
  onDescriptionChange: (d: string) => void;
}) {
  const [descBusy, setDescBusy] = useState<'both' | 'title' | 'description' | null>(null);
  const [descError, setDescError] = useState('');
  const [copied, setCopied] = useState<'title' | 'description' | null>(null);
  const threadCache = useRef<{ post: unknown; comments: unknown[] } | null>(null);

  async function generateCopy(only?: 'title' | 'description') {
    if (!threadUrl || descBusy) return;
    setDescBusy(only ?? 'both'); setDescError(''); setCopied(null);
    try {
      // Import the thread once per mount (cached), then reuse across regenerations.
      let thread = threadCache.current;
      if (!thread) {
        const imp = await fetch('/api/reddit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: threadUrl }),
          signal: AbortSignal.timeout(240_000),
        });
        const impJson = await imp.json();
        if (!imp.ok) throw new Error(impJson.error ?? 'Couldn’t load the thread.');
        thread = { post: impJson.post, comments: impJson.comments ?? [] };
        threadCache.current = thread;
      }
      // Apply the reel's Pick-stage text edits so the generated copy matches what's actually narrated.
      // remapCommentEdits: edit indices are authored in the flyout's depth-0-filtered universe; this raw
      // import is unfiltered, so keys must be translated onto actual array positions first.
      const rawComments = (thread.comments as ImportedRedditComment[]) ?? [];
      const eff = applyThreadEdits(
        thread.post as ImportedRedditPost,
        rawComments,
        remapCommentEdits(rawComments, threadEdits),
      );
      const res = await fetch('/api/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: threadUrl, thread: { post: eff.post, comments: eff.comments }, only }),
        signal: AbortSignal.timeout(90_000),
      });
      if (eff.skipped.length) setDescError(`Note: ${eff.skipped.length} text tweak${eff.skipped.length === 1 ? '' : 's'} no longer matched the thread and ${eff.skipped.length === 1 ? 'was' : 'were'} skipped.`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Generation failed.');
      if (json.title !== undefined) onYtTitleChange(json.title);
      if (json.description !== undefined) onDescriptionChange(json.description);
    } catch (e) {
      setDescError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setDescBusy(null);
    }
  }
  const copyText = (kind: 'title' | 'description', text: string) => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(kind); setTimeout(() => setCopied(null), 1500); });
  };

  if (!threadUrl) {
    return <p className="text-caption text-fg-3">Import a Reddit thread for this reel first (Reddit thread panel), then generate its YouTube title and description here.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="secondary" size="sm" loading={descBusy === 'both'} disabled={descBusy !== null} onClick={() => void generateCopy()}>
        {ytTitle || description ? 'Regenerate both' : 'Generate title & description'}
      </Button>
      {ytTitle && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-caption text-fg-3 flex-1">Title</span>
          <button type="button" disabled={descBusy !== null} onClick={() => void generateCopy('title')} className="text-caption text-fg-3 hover:text-fg underline underline-offset-2 disabled:opacity-40">
            {descBusy === 'title' ? 'Regenerating…' : 'Regenerate'}
          </button>
          <button type="button" onClick={() => copyText('title', ytTitle)} className="text-caption text-fg-3 hover:text-fg underline underline-offset-2">
            {copied === 'title' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      )}
      {ytTitle && (
        <>
          <input
            type="text"
            value={ytTitle}
            onChange={e => onYtTitleChange(e.target.value)}
            className="w-full rounded-md border border-line-strong bg-transparent px-2 h-8 text-caption text-fg outline-none"
          />
          <span className={`text-caption ${ytTitle.length > 100 ? 'text-danger-text' : 'text-fg-3'}`}>{ytTitle.length} / 100</span>
        </>
      )}
      {description && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-caption text-fg-3 flex-1">Description</span>
          <button type="button" disabled={descBusy !== null} onClick={() => void generateCopy('description')} className="text-caption text-fg-3 hover:text-fg underline underline-offset-2 disabled:opacity-40">
            {descBusy === 'description' ? 'Regenerating…' : 'Regenerate'}
          </button>
          <button type="button" onClick={() => copyText('description', description)} className="text-caption text-fg-3 hover:text-fg underline underline-offset-2">
            {copied === 'description' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      )}
      {description && (
        <>
          <textarea
            value={description}
            onChange={e => onDescriptionChange(e.target.value)}
            rows={7}
            className="w-full rounded-md border border-line-strong bg-transparent p-2 text-caption text-fg leading-snug outline-none resize-y"
          />
          <span className={`text-caption ${description.length > 5000 ? 'text-danger-text' : 'text-fg-3'}`}>{description.length} / 5000</span>
        </>
      )}
      {descError && <span className="text-caption text-danger-text">{descError}</span>}
    </div>
  );
}

function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

/** Inline editor for one thread text item (title / paragraph / comment). Cmd/Ctrl-Enter saves,
    Escape cancels; committing text identical to the original clears the override. */
function ThreadEditBox({ label, draft, setDraft, onSave, onCancel, rows = 4 }: {
  label: string; draft: string; setDraft: (s: string) => void; onSave: () => void; onCancel: () => void; rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-accent-border bg-surface-2 p-1.5">
      <span className="text-caption text-fg-3">Editing {label} — the card, narration and copy all use this text</span>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
        }}
        rows={rows}
        autoFocus
        className="focus-ring w-full resize-y rounded-sm border border-line bg-surface-1 px-1.5 py-1 text-caption text-fg"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onSave}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <span className="text-caption text-fg-4">⌘↵ save · esc cancel · matching the original clears the edit</span>
      </div>
    </div>
  );
}

function RedditFlyout({ hasVideo, saved, onSaveThread, onAdd }: {
  hasVideo: boolean;
  /** Persisted thread state for this reel (rides Framing, like music). */
  saved?: { url: string; comments?: number[]; paras?: number[]; edits?: RedditThreadEdits } | null;
  onSaveThread: (s: { url: string; comments?: number[]; paras?: number[]; edits?: RedditThreadEdits } | null) => void;
  onAdd: (blob: Blob, lines: MemeLine[], dims: { w: number; h: number }, blockAuthors: string[]) => Promise<void>;
}) {
  const [url, setUrl] = useState(saved?.url ?? '');
  const [busy, setBusy] = useState<'import' | 'add' | null>(null);
  const [error, setError] = useState('');
  const [post, setPost] = useState<ImportedRedditPost | null>(null);
  const [comments, setComments] = useState<ImportedRedditComment[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedParas, setSelectedParas] = useState<Set<number>>(new Set());
  // Pick-stage TEXT edits (title / paragraph / comment overrides, keyed by import index). Persisted on
  // redditThread so they survive reloads AND re-imports (text is re-fetched; overrides re-apply by index).
  const [edits, setEdits] = useState<RedditThreadEdits>({});
  const [editing, setEditing] = useState<{ kind: 't' | 'p' | 'c'; idx: number } | null>(null);
  const [draft, setDraft] = useState('');
  // The url the DISPLAYED post was imported from — the persist effect must save against this, never the
  // live input (typing a new url then toggling would otherwise attach the OLD thread's index-keyed
  // selections+edits to the NEW url).
  const importedUrlRef = useRef(saved?.url ?? '');

  async function importThread() {
    setBusy('import'); setError(''); setPost(null); setComments([]); setSelected(new Set()); setSelectedParas(new Set()); setEdits({}); setEditing(null);
    try {
      const res = await fetch('/api/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(240_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed.');
      setPost(json.post);
      // Depth-0 only — THIS filtered list is the universe comment-edit indices are authored in (the
      // copy paths remap onto their unfiltered arrays via remapCommentEdits).
      setComments((json.comments ?? []).filter((c: ImportedRedditComment) => (c.depth ?? 0) === 0));
      importedUrlRef.current = url.trim();
      // Persist the link with the reel; re-importing the saved link restores the saved selection + edits.
      if (saved?.url === url.trim()) {
        setSelected(new Set(saved.comments ?? []));
        setSelectedParas(new Set(saved.paras ?? []));
        setEdits(saved.edits ?? {});
      } else {
        onSaveThread({ url: url.trim() });   // new url → old selections AND edits are meaningless
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(null);
    }
  }

  const toggleIn = (setter: Dispatch<SetStateAction<Set<number>>>) => (i: number) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  const toggle = toggleIn(setSelected);
  const togglePara = toggleIn(setSelectedParas);
  // Selection + text edits persist alongside the IMPORTED link (never the live input — see importedUrlRef).
  useEffect(() => {
    if (post && importedUrlRef.current) {
      onSaveThread({
        url: importedUrlRef.current, comments: [...selected], paras: [...selectedParas],
        edits: hasThreadEdits(edits) ? edits : undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedParas, edits]);

  // ── Edit box helpers: open with the CURRENT (edited or original) text; commit trims; committing text
  //    identical to the ORIGINAL clears the override (so "undo my edit" is just retyping/clearing). ──
  const editedTitle = edits.title?.trim() ? edits.title : post?.title ?? '';
  const paragraphsRaw = post ? splitParagraphs(post.body) : [];
  const paraText = (i: number) => (edits.paras?.[i]?.trim() ? edits.paras![i] : paragraphsRaw[i]);
  const commentText = (i: number) => (edits.comments?.[i]?.trim() ? edits.comments![i] : comments[i]?.body ?? '');
  function openEdit(kind: 't' | 'p' | 'c', idx: number) {
    setEditing({ kind, idx });
    setDraft(kind === 't' ? editedTitle : kind === 'p' ? paraText(idx) : commentText(idx));
  }
  function commitEdit() {
    if (!editing) return;
    const { kind, idx } = editing;
    const t = draft.trim();
    setEdits(prev => {
      const next: RedditThreadEdits = {
        ...prev,
        paras: { ...prev.paras }, comments: { ...prev.comments },
        paraOrig: { ...prev.paraOrig }, commentOrig: { ...prev.commentOrig },
      };
      // Compare NORMALISED forms (what applyThreadEdits would actually produce) so a whitespace-only
      // "edit" doesn't stick around as a spurious override + badge.
      if (kind === 't') {
        if (!t || t.replace(/\s*\n+\s*/g, ' ') === post?.title) delete next.title; else next.title = t;
      } else if (kind === 'p') {
        if (!t || t.replace(/\n\s*\n/g, '\n') === paragraphsRaw[idx]) { delete next.paras![idx]; delete next.paraOrig![idx]; }
        else { next.paras![idx] = t; next.paraOrig![idx] = paragraphsRaw[idx]; }   // content anchor (drift guard)
      } else {
        if (!t || t === comments[idx]?.body) { delete next.comments![idx]; delete next.commentOrig![idx]; }
        else { next.comments![idx] = t; next.commentOrig![idx] = comments[idx]?.body ?? ''; }
      }
      for (const k of ['paras', 'comments', 'paraOrig', 'commentOrig'] as const) {
        if (!Object.keys(next[k]!).length) delete next[k];
      }
      return next;
    });
    setEditing(null);
  }

  const totalSelected = selected.size + selectedParas.size;

  async function addToReel() {
    if (!post) return;
    setBusy('add'); setError('');
    try {
      // Apply the text edits BEFORE the card render — the card, its ocrLines (narration + reveals) and
      // the copy stage (which reads edits from redditThread) all inherit the tweaked text. No remap here:
      // the flyout's own filtered list IS the universe the edit indices were authored in.
      const eff = applyThreadEdits(post, comments, hasThreadEdits(edits) ? edits : undefined);
      if (eff.skipped.length) setError(`Note: ${eff.skipped.length} tweak${eff.skipped.length === 1 ? '' : 's'} (${eff.skipped.join(', ')}) no longer matched the thread and ${eff.skipped.length === 1 ? 'was' : 'were'} skipped.`);
      const data = buildRedditCardData(eff.post, eff.comments, selected, selectedParas);
      const card = await renderRedditCard(data);
      // Author per narration block, aligned with MemeLine.blockIdx: 0/1 = post title/body,
      // 2+i = the i-th comment on the card. Lets the overlay arrive pre-painted per participant.
      const postAuthor = data.user.name.replace(/^u\//, '');
      const blockAuthors = [postAuthor, postAuthor, ...data.comments.map(c => c.user.name.replace(/^u\//, ''))];
      await onAdd(card.blob, card.lines, { w: card.width, h: card.height }, blockAuthors);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t render the card.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 border border-line-strong rounded-md px-2.5 h-9">
        <LinkIcon size={13} className="text-fg-3 shrink-0" />
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy) void importThread(); }}
          placeholder="Paste a Reddit thread link…"
          className="flex-1 min-w-0 bg-transparent text-body text-fg placeholder:text-fg-3 outline-none"
        />
        <IconButton
          icon={busy === 'import' ? <SpinnerIcon style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightIcon />}
          label="Import thread"
          variant="secondary"
          onClick={() => void importThread()}
          disabled={!url.trim() || busy !== null}
        />
      </div>
      {post && (
        <>
          {editing?.kind === 't' ? (
            <ThreadEditBox label="Title" draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={() => setEditing(null)} rows={2} />
          ) : (
            <div className="flex items-start gap-1 text-caption text-fg-2 leading-snug border-l-2 border-line-strong pl-2">
              <span className="min-w-0 flex-1">
                <span className="text-fg font-medium">{post.user.name}</span> · {editedTitle.length > 90 ? `${editedTitle.slice(0, 90)}…` : editedTitle}
                {edits.title?.trim() && <span className="text-accent-text"> · edited</span>}
              </span>
              <button type="button" onClick={() => openEdit('t', 0)} aria-label="Edit title" title="Tweak the title text"
                className="focus-ring shrink-0 rounded-sm p-0.5 text-fg-4 hover:text-fg hover:bg-hover">
                <PencilIcon size={11} />
              </button>
            </div>
          )}
          <div className="max-h-[48vh] overflow-y-auto overscroll-contain flex flex-col gap-0.5 pr-1">
            {paragraphsRaw.length > 0 && (
              <>
                <span className="text-caption text-fg-3 pt-0.5">Post text — tick the paragraphs to include:</span>
                {paragraphsRaw.map((_, i) => editing?.kind === 'p' && editing.idx === i ? (
                  <ThreadEditBox key={`p${i}`} label={`Paragraph ${i + 1}`} draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={() => setEditing(null)} />
                ) : (
                  <div key={`p${i}`} className={`flex items-start rounded-sm transition-colors ${selectedParas.has(i) ? 'bg-active' : 'hover:bg-hover'}`}>
                    <button
                      type="button"
                      onClick={() => togglePara(i)}
                      className="flex items-start gap-2 py-1.5 pl-1.5 min-w-0 flex-1 rounded-sm text-left focus-ring"
                    >
                      <span className={`mt-0.5 flex items-center justify-center size-3.5 shrink-0 rounded-[3px] border ${
                        selectedParas.has(i) ? 'bg-action border-action text-action-fg' : 'border-line-strong text-transparent'
                      }`}>
                        <CheckIcon size={9} />
                      </span>
                      <span className="min-w-0 flex-1 text-caption text-fg-3 truncate">
                        {edits.paras?.[i]?.trim() && <span className="text-accent-text">edited · </span>}{paraText(i)}
                      </span>
                    </button>
                    <button type="button" onClick={() => openEdit('p', i)} aria-label={`Edit paragraph ${i + 1}`} title="Tweak this paragraph's text"
                      className="focus-ring shrink-0 rounded-sm p-1 mt-1 mr-0.5 text-fg-4 hover:text-fg hover:bg-hover">
                      <PencilIcon size={11} />
                    </button>
                  </div>
                ))}
                <span className="text-caption text-fg-3 pt-1">Comments:</span>
              </>
            )}
            {comments.map((c, i) => editing?.kind === 'c' && editing.idx === i ? (
              <ThreadEditBox key={i} label={`${c.user.name}'s comment`} draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={() => setEditing(null)} />
            ) : (
              <div key={i} className={`flex items-stretch rounded-sm transition-colors ${selected.has(i) ? 'bg-active' : 'hover:bg-hover'}`}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="flex items-stretch pl-1.5 min-w-0 flex-1 rounded-sm text-left focus-ring"
                >
                  {/* thread rails: one vertical line per ancestor level, aligned across rows */}
                  {Array.from({ length: Math.min(c.depth, 4) }, (_, d) => (
                    <span key={d} aria-hidden className="w-3 shrink-0 border-l-2 border-line-strong ml-0.5" />
                  ))}
                  {c.depth > 0 && <span aria-hidden className="self-center mr-1 text-fg-3 text-caption leading-none">↳</span>}
                  <span className="flex items-start gap-2 py-1.5 min-w-0 flex-1">
                    <span className={`mt-0.5 flex items-center justify-center size-3.5 shrink-0 rounded-[3px] border ${
                      selected.has(i) ? 'bg-action border-action text-action-fg' : 'border-line-strong text-transparent'
                    }`}>
                      <CheckIcon size={9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-caption truncate">
                        <span className={c.depth === 0 ? 'text-fg font-medium' : 'text-fg'}>{c.user.name}</span>
                        {c.isOP && <span className="text-[#4d9df6] font-semibold"> OP</span>}
                        {c.timeAgo && <span className="text-fg-3"> · {c.timeAgo}</span>}
                        {c.depth > 0 && <span className="text-fg-3"> · reply</span>}
                        {edits.comments?.[i]?.trim() && <span className="text-accent-text"> · edited</span>}
                      </span>
                      <span className="block text-caption text-fg-3 truncate">{commentText(i)}</span>
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => openEdit('c', i)} aria-label={`Edit ${c.user.name}'s comment`} title="Tweak this comment's text"
                  className="focus-ring shrink-0 rounded-sm p-1 mt-1.5 mr-0.5 self-start text-fg-4 hover:text-fg hover:bg-hover">
                  <PencilIcon size={11} />
                </button>
              </div>
            ))}
            {comments.length === 0 && <span className="text-caption text-fg-3">No usable comments in that thread.</span>}
          </div>
          <Button
            variant="primary"
            onClick={() => void addToReel()}
            disabled={busy !== null || totalSelected === 0 || !hasVideo}
          >
            {busy === 'add' ? 'Adding…' : `Add to reel${totalSelected ? ` (${totalSelected})` : ''}`}
          </Button>
          {!hasVideo && <span className="text-caption text-fg-3">Add a video to the reel first — the card overlays it.</span>}
        </>
      )}
      {error && <span className="text-caption text-danger-text">{error}</span>}
    </div>
  );
}

// ── Narration flyout ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs narration for a meme overlay, straight off the image (OCR). Multiple voices: the first
// voice is the default narrator; arm another voice as a "brush" and click OCR line highlights on the
// overlay to paint paragraphs with it. Consecutive same-voice lines are spoken as one take; takes are
// stitched into one narration track, synced to the playhead in preview and mixed into the export,
// with the image un-cropping line by line as each line is read.
const LS_11L_KEY = 'reels:11labs-key';
const LS_11L_VOICE = 'reels:11labs-voice';       // legacy single-voice key, migrated into the list
const LS_11L_VOICES = 'reels:11labs-voices';
// Per-voice channel gain (0..1.5, 1 = as generated) — a mixer for the cast, since ElevenLabs
// voices vary in loudness. Applied when the takes are stitched, so changes need a regenerate.
const LS_VOICE_GAINS = 'reels:voice-gains';

// Fixed voice cast for Reddit thread cards (ElevenLabs voice IDs). The post always reads as Mark;
// each distinct commenter draws a random voice from the pool (stable per author on a card, no
// repeats until the pool is exhausted; an OP reply reuses Mark). Edit here to recast.
// Narration delivery speed via ElevenLabs' native `speed` setting (1 = natural, 1.2 = the API's
// max). Chosen in the Narration flyout, persisted per browser, applies to every generated take.
const LS_NARRATION_SPEED = 'reels:narration-speed';
const NARRATION_SPEEDS = [1, 1.05, 1.1, 1.15, 1.2] as const;
const DEFAULT_NARRATION_SPEED = 1.15;

// Short-length model (SHORTS_MAX_SECONDS / estimateNarrationSeconds / reelDurationInfo) lives in
// '@/lib/reelDuration' — imported at the top — so it's unit-testable in isolation.

const REDDIT_POST_VOICE = { id: 'UgBBYS2sOqTuMpoF3BR0', name: 'Mark' };          // Natural Conversations (US)
const REDDIT_COMMENT_VOICES = [
  { id: 'NNl6r8mD7vthiJatiJt1', name: 'Bradford' },   // Expressive and Articulate (British)
  { id: 'EkK5I93UQWFDigLMpZcX', name: 'James' },      // Husky, Engaging and Bold (US)
  { id: 'aMSt68OGf4xUZAnLpTU8', name: 'Juniper' },    // Grounded and Professional (US)
];
// Known but disabled voices: excluded from the auto-cast pool AND substituted out at narration time,
// so a persisted assignment from an old card never actually voices them. Kept here only so the
// timeline still shows their name for a not-yet-regenerated take.
const DISABLED_VOICES = [
  { id: 'Z3R5wn05IrDiVCyEkUrK', name: 'Arabella' },   // Mysterious and Emotive (US) — disabled for now
  { id: 'Bj9UqZbhQsanLzgalpEG', name: 'Austin' },     // Deep Raspy and Authentic (US Southern) — disabled for now
];
const DISABLED_VOICE_IDS = new Set(DISABLED_VOICES.map(v => v.id));
const DEFAULT_VOICE = 'TX3LPaxmHKxFdv7VOQHJ';   // ElevenLabs "Liam" — energetic social-media narrator, premade so free-tier keys can use it

// Fit a rendered Reddit card into the 1080x1920 frame (whole card visible pre-narration) and cast
// its lines. Shared by the single-add path and the bulk builder.
function redditOverlayLayout(lines: MemeLine[], dims: { w: number; h: number }, blockAuthors: string[]) {
  const blockVoice = castRedditVoices(blockAuthors);
  const ocrLines = lines.map(l => ({ ...l, enabled: true, voiceId: blockVoice[l.blockIdx] }));
  const w = Math.round(Math.min(0.8 * 1080, 1632 * (dims.w / dims.h)));
  const h = Math.round(w * (dims.h / dims.w));
  return { ocrLines, rect: { w, h, x: Math.round((1080 - w) / 2), y: Math.round((1920 - h) / 2) } };
}

// Cast a voice per narration block (indexed like blockAuthors / MemeLine.blockIdx). Fresh shuffle
// each call. Post + OP replies read as Mark; other commenters draw from the shuffled pool with the
// guarantee that no two consecutive blocks by DIFFERENT speakers share a voice (same speaker in a
// row keeps it; a voice may recur non-adjacently).
function castRedditVoices(blockAuthors: string[]): string[] {
  const pool = REDDIT_COMMENT_VOICES.map(v => v.id).sort(() => Math.random() - 0.5);
  const postAuthor = blockAuthors[0] ?? '';
  const authorVoice = new Map<string, string>();
  let poolIdx = 0;
  const nextPoolVoice = (avoid: string | null): string => {
    let v = pool[poolIdx % pool.length];
    if (v === avoid && pool.length > 1) { poolIdx++; v = pool[poolIdx % pool.length]; }
    poolIdx++;
    return v;
  };
  const blockVoice: string[] = [];
  let prev: string | null = null;
  for (let b = 0; b < blockAuthors.length; b++) {
    const author = blockAuthors[b] ?? '';
    let v: string;
    if (b > 0 && author === (blockAuthors[b - 1] ?? '')) v = blockVoice[b - 1];
    else if (author === postAuthor) v = REDDIT_POST_VOICE.id;
    else { const known = authorVoice.get(author); v = known && known !== prev ? known : nextPoolVoice(prev); authorVoice.set(author, v); }
    blockVoice[b] = v; prev = v;
  }
  return blockVoice;
}
const VOICE_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb7185'];

/** Mono 16-bit PCM WAV — used to stitch multiple ElevenLabs takes into one narration track that both
    the preview <audio> and the export's decodeAudioData handle without MP3-concatenation glitches. */
function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (o: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function loadSavedVoices(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_11L_VOICES) ?? 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved.map(String);
    return [localStorage.getItem(LS_11L_VOICE) ?? DEFAULT_VOICE];
  } catch {
    return [DEFAULT_VOICE];
  }
}

function NarrateFlyout({ overlays, voices, onVoicesChange, brushId, onBrushChange, voiceColors, speed, onSpeedChange, voiceGains, onVoiceGainsChange, onGenerate, onClearNarration, onShuffleVoices }: {
  overlays: ImageOverlay[];
  voices: string[];
  onVoicesChange: (v: string[]) => void;
  brushId: string | null;
  onBrushChange: (id: string | null) => void;
  voiceColors: Record<string, string>;
  speed: number;
  onSpeedChange: (s: number) => void;
  voiceGains: Record<string, number>;
  onVoiceGainsChange: (g: Record<string, number>) => void;
  onGenerate: (overlayId: string, apiKey: string, onStatus: (s: string) => void) => Promise<string | null>;
  onClearNarration: (overlayId: string) => void;
  onShuffleVoices: (overlayId: string) => void;
}) {
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem(LS_11L_KEY) ?? ''; } catch { return ''; } });
  const [targetId, setTargetId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const target = overlays.find(o => o.id === targetId) ?? overlays[0];

  if (overlays.length === 0) {
    return <p className="text-caption text-fg-3">Add an image overlay first — then narrate it here.</p>;
  }

  const generate = async () => {
    if (!target || busy) return;
    setBusy(true); setMsg('Preparing narration…');
    try {
      const err = await onGenerate(target.id, apiKey.trim(), setMsg);
      setMsg(err ?? 'Narration attached — press play to watch the reveal.');
    } catch {
      setMsg('Narration failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {overlays.length > 1 && (
        <select
          value={target?.id ?? ''}
          onChange={e => setTargetId(e.target.value)}
          aria-label="Overlay to narrate"
          className="h-8 rounded-md border border-line-strong bg-transparent px-2 text-body text-fg outline-none"
        >
          {overlays.map(o => <option key={o.id} value={o.id}>{o.name || 'Image'}</option>)}
        </select>
      )}
      <input
        type="password"
        value={apiKey}
        onChange={e => { setApiKey(e.target.value); try { localStorage.setItem(LS_11L_KEY, e.target.value); } catch { /* ignore */ } }}
        placeholder="ElevenLabs API key (blank = server key)"
        className="h-8 rounded-md border border-line-strong bg-transparent px-2 text-body text-fg placeholder:text-fg-3 outline-none"
      />
      {target?.name === 'Reddit thread' ? (
        <>
          {/* Reddit cards arrive auto-cast — show the fixed cast; dots arm a repaint brush. */}
          <p className="text-caption text-fg-3">Cast (auto-assigned) — arm a dot to repaint lines:</p>
          {[{ ...REDDIT_POST_VOICE, role: 'the post' }, ...REDDIT_COMMENT_VOICES.map(v => ({ ...v, role: 'commenter pool' }))].map(v => (
            <div key={v.id} className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={brushId === v.id ? `Disarm ${v.name} brush` : `Arm ${v.name} brush`}
                title={brushId === v.id ? 'Brush armed — click lines on the card; click here to disarm' : `Arm ${v.name}, then click lines on the card to paint them`}
                onClick={() => onBrushChange(brushId === v.id ? null : v.id)}
                className={`grid size-7 shrink-0 place-items-center rounded-md border transition-colors ${brushId === v.id ? 'border-accent bg-accent/15' : 'border-line-strong hover:border-accent-border'}`}
              >
                <span className="size-3 rounded-full" style={{ background: voiceColors[v.id] }} />
              </button>
              <span className="text-body text-fg truncate" title={`${v.name} — ${v.role}`}>{v.name}</span>
              {v.role === 'the post' && <span className="text-caption text-fg-3 shrink-0">post</span>}
              <input
                type="range" min={0} max={1.5} step={0.05}
                value={voiceGains[v.id] ?? 1}
                title={`Channel volume: ${Math.round((voiceGains[v.id] ?? 1) * 100)}% (applies on next Generate)`}
                onChange={e => onVoiceGainsChange({ ...voiceGains, [v.id]: Number(e.target.value) })}
                className="w-16 shrink-0 ml-auto"
              />
              <span className="text-caption text-fg-3 w-8 text-right shrink-0">{Math.round((voiceGains[v.id] ?? 1) * 100)}%</span>
            </div>
          ))}
        </>
      ) : (
        <>
          {/* Voice palette (meme/OCR overlays): row 0 is the default narrator; the colored dot arms
              that voice as a brush for painting lines on the overlay. */}
          {voices.map((v, i) => {
            const id = v.trim();
            return (
              <div key={i} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={id && brushId === id ? 'Disarm voice brush' : `Arm voice ${i + 1} brush`}
                  title={id && brushId === id ? 'Brush armed — click lines on the image; click here to disarm' : 'Arm this voice, then click lines on the image to paint them'}
                  onClick={() => { if (id) onBrushChange(brushId === id ? null : id); }}
                  className={`grid size-7 shrink-0 place-items-center rounded-md border transition-colors ${id && brushId === id ? 'border-accent bg-accent/15' : 'border-line-strong hover:border-accent-border'}`}
                >
                  <span className="size-3 rounded-full" style={{ background: VOICE_COLORS[i % VOICE_COLORS.length] }} />
                </button>
                <input
                  type="text"
                  value={v}
                  onChange={e => onVoicesChange(voices.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={i === 0 ? 'Default voice ID (Liam)' : 'Voice ID'}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-transparent px-2 text-body text-fg placeholder:text-fg-3 outline-none"
                />
                {id && (
                  <input
                    type="range" min={0} max={1.5} step={0.05}
                    value={voiceGains[id] ?? 1}
                    title={`Channel volume: ${Math.round((voiceGains[id] ?? 1) * 100)}% (applies on next Generate)`}
                    onChange={e => onVoiceGainsChange({ ...voiceGains, [id]: Number(e.target.value) })}
                    className="w-12 shrink-0"
                  />
                )}
                {i > 0 && (
                  <button
                    type="button"
                    aria-label="Remove voice"
                    onClick={() => { if (id && brushId === id) onBrushChange(null); onVoicesChange(voices.filter((_, j) => j !== i)); }}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:text-danger-text"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            );
          })}
          {voices.length < VOICE_COLORS.length && (
            <button
              type="button"
              onClick={() => onVoicesChange([...voices, ''])}
              className="self-start text-caption text-fg-3 hover:text-fg underline underline-offset-2"
            >
              + Add voice
            </button>
          )}
        </>
      )}
      <p className="text-caption text-fg-3">
        {brushId != null
          ? 'Brush armed — click lines on the image to give them this voice. Same-voice lines read as one paragraph.'
          : target?.name === 'Reddit thread'
            ? 'The post reads as Mark; each commenter gets a random cast voice, revealing line by line in sync.'
            : 'Reads the detected text as a hyped take, un-cropping line by line. Click lines on the overlay to skip them, or arm a voice dot to paint paragraphs.'}
      </p>
      {/* Delivery speed: ElevenLabs re-performs the read faster (1.2 is the API max) — reveal
          timing follows automatically. Applies to the next Generate. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-caption text-fg-3 mr-0.5">Speed</span>
        {NARRATION_SPEEDS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeedChange(s)}
            className={`h-6 px-1.5 rounded-md border text-caption transition-colors ${
              speed === s ? 'border-accent bg-accent/15 text-fg' : 'border-line-strong text-fg-2 hover:text-fg hover:border-accent-border'
            }`}
          >
            {s === 1 ? '1x' : `${s}x`}
          </button>
        ))}
      </div>
      {target?.name === 'Reddit thread' && target.blockAuthors && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (target) { onShuffleVoices(target.id); setMsg('Voices reshuffled — generate to hear them.'); } }}
          className="self-start text-caption text-fg-2 hover:text-fg underline underline-offset-2 disabled:opacity-40"
        >
          ⇄ Shuffle voices
        </button>
      )}
      <Button variant="primary" size="sm" loading={busy} onClick={generate}>
        {target?.audioId ? 'Regenerate narration' : 'Generate narration'}
      </Button>
      {target?.audioId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (target) { onClearNarration(target.id); setMsg('Narration removed.'); } }}
          className="self-start text-caption text-danger-text hover:underline underline-offset-2 disabled:opacity-40"
        >
          Remove narration
        </button>
      )}
      {msg && <span className="text-caption text-fg-3">{msg}</span>}
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

// ── Bulk builder ──────────────────────────────────────────────────────────────
// Paste many Reddit thread links, import them all, tick comments/paragraphs per thread on one page,
// then build a reel per thread (random footage + card). Keeps the human step (choosing comments)
// while automating the rest.
interface BulkThread {
  url: string;
  post: ImportedRedditPost;
  comments: ImportedRedditComment[];
  paragraphs: string[];
  selectedComments: Set<number>;
  selectedParas: Set<number>;
  // Pick-stage text edits. Comment keys are DEPTH-0 space (the stored convention shared with the flyout
  // + copy paths); paragraph keys are paragraph index; both carry *Orig anchors for drift-skip.
  edits: RedditThreadEdits;
}

// The bulk builder's picking state (imported threads + comment/paragraph selections + text edits) is
// PERSISTED so it survives a reload — and, critically, an HMR remount (adding a hook to this component
// makes Fast Refresh drop its state, which once wiped a user's in-progress picks). localStorage, not
// IndexedDB: a session's worth of threads is well under quota, and a QuotaExceededError degrades to
// "not persisted" via the caller's try/catch rather than breaking the build.
const BULK_STORE_KEY = 'bulk:threads';
function loadBulkThreads(): BulkThread[] {
  try {
    // parseStoredThreads (tested) validates per-entry and never throws; wrap arrays back into Sets here.
    const parsed = parseStoredThreads<ImportedRedditPost, ImportedRedditComment>(JSON.parse(localStorage.getItem(BULK_STORE_KEY) ?? '[]'));
    return parsed.map(t => ({ ...t, selectedComments: new Set(t.selectedComments), selectedParas: new Set(t.selectedParas) }));
  } catch { return []; }   // localStorage undefined on the server / parse error → fresh
}
const serializeBulkThreads = (threads: BulkThread[]): string => serializeThreads(threads);

function BulkBuilder({ open, onClose, onBuild, speed, queuedUrls, onQueueConsumed, onQueueDone }: {
  open: boolean;
  onClose: () => void;
  onBuild: (threads: Array<{ url: string; post: ImportedRedditPost; comments: ImportedRedditComment[]; selectedComments: number[]; selectedParas: number[]; edits?: RedditThreadEdits }>) => Promise<{ built: number; failed: number }>;
  speed: number;   // narration speed — scales the live length estimate shown while picking comments
  /** Scout → Import handoff: approved post urls to auto-import when the panel opens. */
  queuedUrls?: string[] | null;
  /** Fired the moment the queue is picked up (clears the parent's slot so the effect can't double-fire). */
  onQueueConsumed?: () => void;
  /** Fired when the queued import finishes (ALWAYS, even on failure), with every url now present in the
      builder — the parent uses it to clear its handoff indicator + surface import failures. The Scout
      buffer itself releases only at BUILD time (builder threads aren't reload-durable; reels are). */
  onQueueDone?: (presentUrls: string[]) => void;
}) {
  const [linksText, setLinksText] = useState('');
  const [threads, setThreads] = useState<BulkThread[]>(loadBulkThreads);
  // Restored threads land straight in the select phase (skip the empty paste screen).
  const [phase, setPhase] = useState<'input' | 'importing' | 'select' | 'building'>(() => (threads.length ? 'select' : 'input'));
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [activeThread, setActiveThread] = useState(0);              // which thread's tab is open
  const [visible, setVisible] = useState<Record<number, number>>({}); // per-thread # of comment groups shown (load-more)
  const [addOpen, setAddOpen] = useState(false);                   // "add more threads" input visible (select phase)
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);                     // importing appended threads
  const [reading, setReading] = useState<{ kind: 'c' | 'p'; idx: number } | null>(null);  // comment/para shown full-text in the reading pane
  const [editing, setEditing] = useState<{ kind: 't' | 'c' | 'p'; idx: number } | null>(null);  // which item's text box is open (idx = FULL comment index / para index)
  const [draft, setDraft] = useState('');
  const importGen = useRef(0);   // bumped by reset(); an in-flight import from a prior generation lands nothing
  const COMMENTS_PER_PAGE = 8;

  // Persist the picking state on every change. Same mount-echo guard as the Scout buffer: never write []
  // over stored threads until a non-empty set has been committed this mount (value-based, so a StrictMode
  // double-invoke or a failed read can't clobber). A genuine clear (Start over) writes [] after a real
  // commit. Threads are re-serialised whole — cheap for a session's worth, and always fully consistent.
  const bulkSawThreads = useRef(false);
  useEffect(() => {
    try {
      if (threads.length > 0) { bulkSawThreads.current = true; localStorage.setItem(BULK_STORE_KEY, serializeBulkThreads(threads)); return; }
      if (!bulkSawThreads.current) return;   // mount echo / failed read — don't clobber good data with []
      localStorage.setItem(BULK_STORE_KEY, '[]');
    } catch { /* quota exceeded / private mode — degrade to not-persisted, never break */ }
  }, [threads]);
  // Reset the reading pane + any open editor when the active thread changes (a stale index from another
  // thread must never show or commit).
  useEffect(() => { setReading(null); setEditing(null); }, [activeThread]);

  // ── Pick-stage text editing (parity with the per-reel flyout; both persist to redditThread.edits). ──
  const setActiveEdits = (fn: (e: RedditThreadEdits) => RedditThreadEdits) =>
    setThreads(prev => prev.map((t, i) => (i === activeThread ? { ...t, edits: fn(t.edits) } : t)));
  // Effective (edited-or-original) text getters. Comment edits are keyed by DEPTH-0 rank.
  const editedTitle = (t: BulkThread) => (t.edits.title?.trim() ? t.edits.title : t.post.title);
  const editedPara = (t: BulkThread, pi: number) => (t.edits.paras?.[pi]?.trim() ? t.edits.paras[pi] : t.paragraphs[pi]);
  const editedComment = (t: BulkThread, fullIdx: number) => readCommentEdit(t.comments, fullIdx, t.edits).text;
  const commentIsEdited = (t: BulkThread, fullIdx: number) => readCommentEdit(t.comments, fullIdx, t.edits).edited;
  const openEditBulk = (t: BulkThread, kind: 't' | 'c' | 'p', idx: number) => {
    setEditing({ kind, idx });
    setDraft(kind === 't' ? editedTitle(t) : kind === 'p' ? editedPara(t, idx) : editedComment(t, idx));
  };
  const commitEditBulk = () => {
    if (!editing) return;
    const t = threads[activeThread];
    if (!t) { setEditing(null); return; }
    const { kind, idx } = editing;
    setActiveEdits(prev => {
      // Comments go through the shared, tested depth-0 keying helper; title/paragraph are index-keyed.
      if (kind === 'c') return writeCommentEdit(t.comments, idx, draft, prev);
      const val = draft.trim();
      const next: RedditThreadEdits = { ...prev, paras: { ...prev.paras }, paraOrig: { ...prev.paraOrig } };
      if (kind === 't') {
        if (!val || val.replace(/\s*\n+\s*/g, ' ') === t.post.title) delete next.title; else next.title = val;
      } else {
        const orig = t.paragraphs[idx] ?? '';
        if (!val || val.replace(/\n\s*\n/g, '\n') === orig) { delete next.paras![idx]; delete next.paraOrig![idx]; }
        else { next.paras![idx] = val; next.paraOrig![idx] = orig; }
      }
      for (const key of ['paras', 'paraOrig'] as const) if (!Object.keys(next[key]!).length) delete next[key];
      return next;
    });
    setEditing(null);
  };

  // Import pasted links. append=false replaces the grid (initial import); append=true keeps the existing
  // threads and adds the new ones (dedup by URL) so more threads can be pulled in after the first fetch.
  // Returns every input url that is PRESENT in the builder afterwards (imported this run, or skipped by
  // dedup because its thread is already here) — the Scout handoff releases exactly these from its buffer.
  async function runImport(rawText: string, append: boolean): Promise<string[]> {
    // Partition via the canonical thread key (tested in lib/redditScout/handoff.ts) so www/trailing-slash/
    // ?utm variants of one thread never import twice; urls whose thread is already here count "present".
    const gen = importGen.current;   // a Start-over mid-import invalidates this run (see the post-await guard)
    const have = append ? new Set(threads.map(t => canonicalThreadKey(t.url))) : new Set<string>();
    const { toImport: urls, alreadyPresent } = partitionImportUrls(rawText, have);
    if (!urls.length) {
      setError(append && !alreadyPresent.length ? 'No new links to add (already imported, or none pasted).' : append ? '' : 'Paste at least one Reddit thread link.');
      return alreadyPresent;
    }
    setError('');
    setProgress({ done: 0, total: urls.length });
    if (append) setAdding(true); else setPhase('importing');
    // Native transport (skipping avatars) is fast AND carries the real comment tree incl. one reply
    // per comment; the avatar storm was the only thing that made it block, so skipAvatars keeps it
    // snappy. The route falls back to Apify automatically if native fails. Import a few at a time.
    const importOne = async (url: string): Promise<BulkThread | null> => {
      try {
        const res = await fetch('/api/reddit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, skipAvatars: true }), signal: AbortSignal.timeout(180_000),
        });
        const json = await res.json();
        if (res.ok && json.post) {
          // Keep the full tree (top-level + replies) so the picker can group each comment with its reply.
          return { url, post: json.post, comments: json.comments ?? [], paragraphs: splitParagraphs(json.post.body), selectedComments: new Set(), selectedParas: new Set(), edits: {} };
        }
      } catch { /* skip a failed thread */ }
      return null;
    };
    const CONCURRENCY = 3;
    const results: (BulkThread | null)[] = new Array(urls.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      for (let i = next++; i < urls.length; i = next++) {
        results[i] = await importOne(urls[i]);
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    }));
    // A Start-over while we awaited invalidated this run: the pre-reset thread state (and alreadyPresent,
    // computed against it) is gone. Land nothing, report NOTHING present — interrupted posts stay
    // buffered in the Scout for a clean re-send instead of being orphaned into hidden/replaced threads.
    if (gen !== importGen.current) {
      setAdding(false);
      if (!append) setPhase('input');
      return [];
    }
    const out = results.filter((t): t is BulkThread => !!t);
    const failedCount = urls.length - out.length;
    if (append) {
      setAdding(false);
      if (!out.length) { setError('None of those links could be added.'); return alreadyPresent; }
      const firstNew = threads.length;
      setThreads(prev => [...prev, ...out]);
      setActiveThread(firstNew);   // jump to the first newly-added thread
      setAddText(''); setAddOpen(false);
      if (failedCount) setError(`${failedCount} link${failedCount === 1 ? '' : 's'} failed to import — the rest were added.`);
    } else if (out.length) {
      setThreads(out);
      setActiveThread(0);
      setVisible({});
      setPhase('select');
      if (failedCount) setError(`${failedCount} link${failedCount === 1 ? '' : 's'} failed to import — the rest were added.`);
    } else {
      // Every link failed — return to the paste screen (phase is 'importing' right now) so the textarea +
      // "Import all" stay visible with the error, instead of stranding the user on a blank select screen.
      setPhase('input');
      setError('None of those links could be imported.');
    }
    return [...out.map(t => t.url), ...alreadyPresent];
  }

  // ── Scout → Import handoff: queued urls auto-import like pasted links (append when threads already
  // exist, initial import otherwise). The queue is consumed BEFORE the import starts (double-fire guard).
  // Deliberately NOT gated on `open`: the queue is only ever set together with opening the panel, the
  // component stays mounted while closed, and a busy-parked queue must still self-consume once phase/
  // adding settle — otherwise closing the panel at the wrong moment parks it (and the Scout node's
  // "running" pulse) forever. onQueueDone always fires (even on a rejection) so the parent's handoff
  // flag can't strand; it reports import failures — the buffer itself releases only at BUILD time.
  useEffect(() => {
    if (!queuedUrls?.length) return;
    if (phase === 'importing' || phase === 'building' || adding) return;   // busy — effect refires when phase/adding settle
    const urls = queuedUrls;
    onQueueConsumed?.();
    if (threads.length > 0) setAddOpen(true);   // surface the existing "Adding… x/y" progress strip
    void runImport(urls.join('\n'), threads.length > 0).then(
      present => onQueueDone?.(present),
      () => onQueueDone?.([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedUrls, phase, adding]);

  // Discard everything and return to the paste screen (persistence keeps state across close, so this is
  // the explicit way to start a fresh batch). Bumping importGen invalidates any in-flight import so its
  // results can't land into (or report "present" against) the discarded thread state.
  function reset() {
    importGen.current++;
    setThreads([]); setLinksText(''); setPhase('input');
    setActiveThread(0); setVisible({}); setError(''); setAddOpen(false); setAddText('');
  }

  const toggle = (ti: number, kind: 'c' | 'p', idx: number) => setThreads(prev => prev.map((t, i) => {
    if (i !== ti) return t;
    const set = new Set(kind === 'c' ? t.selectedComments : t.selectedParas);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    return kind === 'c' ? { ...t, selectedComments: set } : { ...t, selectedParas: set };
  }));

  const ready = threads.filter(t => t.selectedComments.size + t.selectedParas.size > 0);
  // Estimated final length of the reel a thread would build — title + its ticked paragraphs + ticked
  // comments, at the current narration speed. Rough (real duration lands once narrated), but enough to flag
  // a thread that would blow past the 3:00 Shorts limit BEFORE any TTS is spent.
  const threadEstSeconds = (t: BulkThread) => {
    // Estimate the EDITED text (what actually narrates), so the length warning matches the built reel.
    const parts = [editedTitle(t)];
    for (const pi of t.selectedParas) if (t.paragraphs[pi]) parts.push(editedPara(t, pi));
    for (const ci of t.selectedComments) if (t.comments[ci]) parts.push(editedComment(t, ci));
    return estimateNarrationSeconds(parts.join(' '), speed);
  };
  // Only estimate a thread that will actually build a reel (≥1 pick) — else a title-only phantom ~m:ss shows
  // for an untouched thread, disagreeing with the tab badge + Build button (both gated on picks).
  const at = threads[activeThread];
  const activeEst = at && at.selectedComments.size + at.selectedParas.size > 0 ? threadEstSeconds(at) : 0;

  async function build() {
    if (!ready.length) return;
    setPhase('building'); setError('');
    try {
      const r = await onBuild(ready.map(t => ({ url: t.url, post: t.post, comments: t.comments, selectedComments: [...t.selectedComments], selectedParas: [...t.selectedParas], edits: hasThreadEdits(t.edits) ? t.edits : undefined })));
      if (r.built >= ready.length && r.failed === 0) {
        // Clean full build: keep the imported threads (persistence) but clear their selections so
        // reopening the panel can't accidentally rebuild the same reels.
        setThreads(prev => prev.map(t => ({ ...t, selectedComments: new Set(), selectedParas: new Set() })));
        setPhase('select');
        onClose();
        return;
      }
      // Truncated (reel cap) or partial card failure: KEEP the selections so nothing is silently lost,
      // and say exactly what happened. (Rebuilding may duplicate the reels that DID build — the message
      // says so; the user chooses.)
      const parts: string[] = [];
      if (r.built < ready.length) parts.push(`${ready.length - r.built} thread${ready.length - r.built === 1 ? '' : 's'} didn't fit the reel cap`);
      if (r.failed) parts.push(`${r.failed} card${r.failed === 1 ? '' : 's'} failed to render`);
      setError(`Built ${r.built} of ${ready.length} — ${parts.join('; ')}. Selections kept (rebuilding may duplicate the built ones).`);
      setPhase('select');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Build failed.');
      setPhase('select');
    }
  }

  // Stay mounted while closed (parent always renders us) so the pasted links, imported threads, and
  // selections survive closing and reopening the panel — just render nothing until reopened.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4" onPointerDown={onClose}>
      <div className="flex flex-col w-full max-w-6xl max-h-[85vh] rounded-2xl bg-surface-1 border border-line-strong shadow-3" onPointerDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span className="text-subheading font-semibold text-fg">Bulk build reels from Reddit threads</span>
          <IconButton icon={<CloseIcon size={14} />} label="Close" variant="secondary" onClick={onClose} />
        </div>

        {phase === 'input' && (
          <div className="flex flex-col gap-2 p-4">
            <span className="text-caption text-fg-3">Paste Reddit thread links — one per line.</span>
            <textarea
              value={linksText}
              onChange={e => setLinksText(e.target.value)}
              rows={8}
              placeholder={'https://www.reddit.com/r/AskReddit/comments/…\nhttps://www.reddit.com/r/…'}
              className="w-full rounded-md border border-line-strong bg-transparent p-2 text-body text-fg placeholder:text-fg-3 outline-none resize-y"
            />
            <Button variant="primary" size="sm" onClick={() => void runImport(linksText, false)} disabled={!linksText.trim()}>Import all</Button>
            {error && <span className="text-caption text-danger-text">{error}</span>}
          </div>
        )}

        {phase === 'importing' && (
          <div className="p-6 text-center text-body text-fg-2">Importing threads… {progress.done}/{progress.total}</div>
        )}

        {(phase === 'select' || phase === 'building') && (
          <>
            {/* Thread tabs: one per imported thread (badge = items ticked in it), plus a "+ Add threads"
                tab that reveals an inline paste box to import & append more threads mid-session. */}
            {threads.length >= 1 && (
              <div className="shrink-0 border-b border-line">
                <div className="flex gap-1 px-3 pt-2 pb-2 overflow-x-auto">
                  {threads.map((t, ti) => {
                    const picks = t.selectedComments.size + t.selectedParas.size;
                    const over = picks > 0 && threadEstSeconds(t) > SHORTS_MAX_SECONDS;   // would exceed the Shorts limit
                    return (
                      <button key={ti} type="button" onClick={() => setActiveThread(ti)}
                        title={over ? 'Estimated over the 3:00 Shorts limit — untick some comments' : undefined}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-caption whitespace-nowrap shrink-0 ${ti === activeThread ? 'bg-active text-fg font-medium' : 'text-fg-3 hover:bg-hover'}`}>
                        <span className="opacity-60">{ti + 1}</span>
                        <span className="max-w-[150px] truncate">{t.post.title}</span>
                        {picks > 0 && <span className={`flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-none ${over ? 'bg-danger-tint text-danger-text' : 'bg-action text-action-fg'}`}>{picks}</span>}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setAddOpen(o => !o)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-caption whitespace-nowrap shrink-0 border border-dashed ${addOpen ? 'border-action text-fg' : 'border-line-strong text-fg-3 hover:bg-hover'}`}>
                    + Add threads
                  </button>
                </div>
                {addOpen && (
                  <div className="flex flex-col gap-2 px-3 pb-3">
                    <textarea value={addText} onChange={e => setAddText(e.target.value)} rows={2}
                      placeholder={'Paste more Reddit thread links to add to this batch…'}
                      className="w-full rounded-md border border-line-strong bg-transparent p-2 text-caption text-fg placeholder:text-fg-3 outline-none resize-y" />
                    <div className="flex items-center gap-2">
                      <Button variant="primary" size="sm" loading={adding} disabled={!addText.trim()} onClick={() => void runImport(addText, true)}>
                        {adding ? `Adding… ${progress.done}/${progress.total}` : 'Import & add'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { setAddOpen(false); setAddText(''); }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 flex">
              {/* LEFT — comment list. Rows stay tick-to-select; hovering/focusing (or clicking) a row also
                  streams its full text into the reading pane on the right. Bodies clamp to 2 lines here. */}
              <div className="w-2/5 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-1 border-r border-line">
                {(() => {
                  const t = threads[activeThread];
                  if (!t) return null;
                  // Group comments so each top-level comment shows AT MOST one reply (the first). The
                  // importer usually returns top-level comments only (no reply chains), in which case
                  // every comment is its own group; when replies ARE present (depth > 0) they nest here.
                  type Row = { c: ImportedRedditComment; idx: number };
                  const groups: { top: Row; reply: Row | null }[] = [];
                  t.comments.forEach((c, idx) => {
                    if ((c.depth ?? 0) === 0) groups.push({ top: { c, idx }, reply: null });
                    else {
                      const last = groups[groups.length - 1];
                      if (last) { if (!last.reply) last.reply = { c, idx }; /* extra replies hidden */ }
                      else groups.push({ top: { c, idx }, reply: null });   // orphan reply → treat as top-level
                    }
                  });
                  const shown = visible[activeThread] ?? COMMENTS_PER_PAGE;
                  const remaining = groups.length - shown;
                  const isReading = (kind: 'c' | 'p', idx: number) => reading?.kind === kind && reading.idx === idx;

                  const commentRow = (c: ImportedRedditComment, idx: number, isReply: boolean) => (
                    <button key={`c${idx}`} type="button"
                      onClick={() => { toggle(activeThread, 'c', idx); setReading({ kind: 'c', idx }); }}
                      onMouseEnter={() => setReading({ kind: 'c', idx })} onFocus={() => setReading({ kind: 'c', idx })}
                      className={`flex items-start gap-2 px-1.5 py-1 rounded-sm text-left w-full ${isReply ? 'ml-5' : ''} ${t.selectedComments.has(idx) ? 'bg-active' : isReading('c', idx) ? 'bg-hover' : 'hover:bg-hover'}`}>
                      <span className={`mt-0.5 flex items-center justify-center size-3.5 shrink-0 rounded-[3px] border ${t.selectedComments.has(idx) ? 'bg-action border-action text-action-fg' : 'border-line-strong text-transparent'}`}><CheckIcon size={9} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-caption text-fg truncate">
                          {isReply && <span aria-hidden className="text-fg-3 mr-1">↳</span>}
                          {c.user.name}{c.isOP ? ' · OP' : ''}{isReply ? ' · reply' : ''}
                          {commentIsEdited(t, idx) && <span className="text-accent-text"> · edited</span>}
                        </span>
                        <span className="text-caption text-fg-3 line-clamp-2">{editedComment(t, idx)}</span>
                      </span>
                    </button>
                  );

                  return (
                    <>
                      {editing?.kind === 't' ? (
                        <div className="pb-1"><ThreadEditBox label="Title" draft={draft} setDraft={setDraft} onSave={commitEditBulk} onCancel={() => setEditing(null)} rows={2} /></div>
                      ) : (
                        <div className="flex items-start gap-1 text-caption text-fg font-medium leading-snug pb-1">
                          <span className="min-w-0 flex-1">
                            {t.post.user.name} · {editedTitle(t)}
                            {t.edits.title?.trim() && <span className="text-accent-text"> · edited</span>}
                          </span>
                          <button type="button" onClick={() => openEditBulk(t, 't', 0)} aria-label="Edit title" title="Tweak the title text"
                            className="focus-ring shrink-0 rounded-sm p-0.5 text-fg-4 hover:text-fg hover:bg-hover"><PencilIcon size={11} /></button>
                        </div>
                      )}
                      {t.paragraphs.map((p, pi) => (
                        <button key={`p${pi}`} type="button"
                          onClick={() => { toggle(activeThread, 'p', pi); setReading({ kind: 'p', idx: pi }); }}
                          onMouseEnter={() => setReading({ kind: 'p', idx: pi })} onFocus={() => setReading({ kind: 'p', idx: pi })}
                          className={`flex items-start gap-2 px-1.5 py-1 rounded-sm text-left ${t.selectedParas.has(pi) ? 'bg-active' : isReading('p', pi) ? 'bg-hover' : 'hover:bg-hover'}`}>
                          <span className={`mt-0.5 flex items-center justify-center size-3.5 shrink-0 rounded-[3px] border ${t.selectedParas.has(pi) ? 'bg-action border-action text-action-fg' : 'border-line-strong text-transparent'}`}><CheckIcon size={9} /></span>
                          <span className="min-w-0 flex-1 text-caption text-fg-3 line-clamp-2">
                            {t.edits.paras?.[pi]?.trim() && <span className="text-accent-text">edited · </span>}Post: {editedPara(t, pi)}
                          </span>
                        </button>
                      ))}
                      {groups.slice(0, shown).map(g => (
                        <div key={g.top.idx} className="flex flex-col">
                          {commentRow(g.top.c, g.top.idx, false)}
                          {g.reply && commentRow(g.reply.c, g.reply.idx, true)}
                        </div>
                      ))}
                      {remaining > 0 && (
                        <button type="button" onClick={() => setVisible(v => ({ ...v, [activeThread]: shown + COMMENTS_PER_PAGE }))}
                          className="mt-1 self-center px-3 py-1.5 rounded-md text-caption text-fg-2 hover:bg-hover border border-line">
                          Load {Math.min(COMMENTS_PER_PAGE, remaining)} more comment{remaining === 1 ? '' : 's'} · {remaining} left
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* RIGHT — reading pane: full text of the hovered/focused (or first) comment, scrolls on its own. */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                {(() => {
                  const t = threads[activeThread];
                  if (!t) return null;
                  // While a comment/paragraph editor is open, PIN the pane to that item — else hovering a
                  // left-list row would swap the pane and silently unmount the open editor mid-edit.
                  const target = (editing && (editing.kind === 'c' || editing.kind === 'p'))
                    ? { kind: editing.kind, idx: editing.idx }
                    : reading ?? (t.comments.length ? { kind: 'c' as const, idx: 0 } : t.paragraphs.length ? { kind: 'p' as const, idx: 0 } : null);
                  if (!target) return <p className="text-caption text-fg-3">This thread has no comments to read.</p>;
                  if (target.kind === 'p') {
                    const p = t.paragraphs[target.idx];
                    if (p == null) return null;
                    const selected = t.selectedParas.has(target.idx);
                    const isEditing = editing?.kind === 'p' && editing.idx === target.idx;
                    return (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-caption text-fg font-medium">Post body{t.edits.paras?.[target.idx]?.trim() && <span className="text-accent-text"> · edited</span>}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isEditing && <button type="button" onClick={() => openEditBulk(t, 'p', target.idx)} className="px-2 py-1 rounded-md text-caption border border-line-strong text-fg-2 hover:bg-hover">Edit text</button>}
                            <button type="button" onClick={() => toggle(activeThread, 'p', target.idx)}
                              className={`px-2.5 py-1 rounded-md text-caption ${selected ? 'bg-action text-action-fg' : 'border border-line-strong text-fg-2 hover:bg-hover'}`}>
                              {selected ? 'Added ✓' : 'Add to reel'}
                            </button>
                          </div>
                        </div>
                        {isEditing
                          ? <ThreadEditBox label={`Paragraph ${target.idx + 1}`} draft={draft} setDraft={setDraft} onSave={commitEditBulk} onCancel={() => setEditing(null)} rows={6} />
                          : <p className="text-body text-fg-2 whitespace-pre-wrap break-words leading-relaxed">{editedPara(t, target.idx)}</p>}
                      </div>
                    );
                  }
                  const c = t.comments[target.idx];
                  if (!c) return null;
                  const isReply = (c.depth ?? 0) > 0;
                  const selected = t.selectedComments.has(target.idx);
                  const isEditing = editing?.kind === 'c' && editing.idx === target.idx;
                  return (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption text-fg font-medium min-w-0 truncate">
                          {isReply && <span aria-hidden className="text-fg-3 mr-1">↳</span>}
                          {c.user.name}{c.isOP ? ' · OP' : ''}{isReply ? ' · reply' : ''}{c.score ? ` · ${c.score}` : ''}{c.timeAgo ? ` · ${c.timeAgo}` : ''}
                          {commentIsEdited(t, target.idx) && <span className="text-accent-text"> · edited</span>}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Replies aren't editable — the edit key space is depth-0 only (parity with the flyout, which drops replies). */}
                          {!isEditing && !isReply && <button type="button" onClick={() => openEditBulk(t, 'c', target.idx)} className="px-2 py-1 rounded-md text-caption border border-line-strong text-fg-2 hover:bg-hover">Edit text</button>}
                          <button type="button" onClick={() => toggle(activeThread, 'c', target.idx)}
                            className={`px-2.5 py-1 rounded-md text-caption ${selected ? 'bg-action text-action-fg' : 'border border-line-strong text-fg-2 hover:bg-hover'}`}>
                            {selected ? 'Added ✓' : 'Add to reel'}
                          </button>
                        </div>
                      </div>
                      {isEditing
                        ? <ThreadEditBox label={`${c.user.name}'s comment`} draft={draft} setDraft={setDraft} onSave={commitEditBulk} onCancel={() => setEditing(null)} rows={6} />
                        : <p className="text-body text-fg-2 whitespace-pre-wrap break-words leading-relaxed">{editedComment(t, target.idx)}</p>}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line shrink-0">
              <Button variant="primary" size="sm" loading={phase === 'building'} disabled={!ready.length} onClick={() => void build()}>
                {phase === 'building' ? 'Building…' : `Build ${ready.length} reel${ready.length === 1 ? '' : 's'}`}
              </Button>
              <span className="text-caption text-fg-3">Ticked threads become reels with a card + random footage.</span>
              {/* Live length estimate for the OPEN thread — flags an over-limit reel before any TTS is spent. */}
              {activeEst > 0 && (
                <span className={`text-caption tabular-nums ${activeEst > SHORTS_MAX_SECONDS ? 'text-danger-text font-medium' : 'text-fg-3'}`}
                  title={activeEst > SHORTS_MAX_SECONDS ? 'Estimated over the 3:00 YouTube Shorts limit' : 'Estimated final length of this reel'}>
                  ~{fmtTime(activeEst > SHORTS_MAX_SECONDS ? Math.ceil(activeEst) : activeEst)}{activeEst > SHORTS_MAX_SECONDS ? ' · over 3:00 limit' : ''}
                </span>
              )}
              {error && <span className="text-caption text-danger-text">{error}</span>}
              <button type="button" onClick={reset} disabled={adding} className="ml-auto text-caption text-fg-3 hover:text-fg underline underline-offset-2 shrink-0 disabled:opacity-40 disabled:pointer-events-none">Start over</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── CanvasGrid ────────────────────────────────────────────────────────────────

// Remember the last-selected reel template per user so the Reels posting page reopens it instead of
// snapping back to the first one. The in-memory map survives section-switch remounts within a session;
// localStorage (read below) survives a full page reload. Mirrors the carousel editor's `de:tpl:` scheme.
const reelSelectionCache = new Map<string, string>();   // userId → reel-template id
const reelSelectionKey = (userId: string) => `de:reeltpl:${userId}`;

export function CanvasGrid({
  entries, setEntries, canvasRefsMap, brand,
  onAddRow, onAddReels, onRemoveRow, onDuplicateRow, onDeleteAllReels, onHandleVideoError,
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
  // Live mirror of framingMap for callbacks that run across a chain of setState updates (Run all: the copy
  // phase writes ytTitle/description, then downloadAllReels — invoked from a closure captured BEFORE that
  // write — must still read the fresh values for the export filenames + .txt sidecars). Mirrors isDownloadingAllRef.
  const framingMapRef = useRef(framingMap);
  useEffect(() => { framingMapRef.current = framingMap; }, [framingMap]);
  // Thread (post+comments) captured at bulk-build, keyed by reel id, so the copy phase can feed
  // /api/description WITHOUT re-importing via /api/reddit (the serialized-puppeteer step that caps copy
  // concurrency). In-memory / session-only — copy falls back to a re-import for reels from a prior reload.
  const threadCacheRef = useRef<Map<string, { url: string; post: ImportedRedditPost; comments: ImportedRedditComment[] }>>(new Map());
  // entryId → live image-overlay list, reported by each canvas — feeds the timeline's overlay lane.
  const [overlaysMap, setOverlaysMap] = useState<Record<string, ImageOverlay[]>>({});
  // Narration voice palette (voices[0] = default narrator) + the voice armed as a line-painting
  // brush on the OCR highlights. Persisted so the cast survives reloads.
  const [narrationVoices, setNarrationVoices] = useState<string[]>(loadSavedVoices);
  const [voiceBrushId, setVoiceBrushId] = useState<string | null>(null);
  const [voiceGains, setVoiceGains] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_VOICE_GAINS) ?? '{}') as Record<string, number>; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_VOICE_GAINS, JSON.stringify(voiceGains)); } catch { /* ignore */ }
  }, [voiceGains]);
  const [narrationSpeed, setNarrationSpeed] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(LS_NARRATION_SPEED));
      return NARRATION_SPEEDS.includes(saved as typeof NARRATION_SPEEDS[number]) ? saved : DEFAULT_NARRATION_SPEED;
    } catch { return DEFAULT_NARRATION_SPEED; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_NARRATION_SPEED, String(narrationSpeed)); } catch { /* ignore */ }
  }, [narrationSpeed]);
  useEffect(() => {
    try { localStorage.setItem(LS_11L_VOICES, JSON.stringify(narrationVoices)); } catch { /* ignore */ }
  }, [narrationVoices]);
  const narrationVoiceColors = useMemo(() => {
    const m: Record<string, string> = {};
    narrationVoices.forEach((v, i) => { const id = v.trim(); if (id && !(id in m)) m[id] = VOICE_COLORS[i % VOICE_COLORS.length]; });
    // The Reddit cast gets stable tints too, so auto-cast highlights are distinct out of the box.
    for (const { id } of [REDDIT_POST_VOICE, ...REDDIT_COMMENT_VOICES]) {
      if (!(id in m)) m[id] = VOICE_COLORS[Object.keys(m).length % VOICE_COLORS.length];
    }
    return m;
  }, [narrationVoices]);
  const castVoiceNames = useMemo(() => {
    const m: Record<string, string> = { [REDDIT_POST_VOICE.id]: REDDIT_POST_VOICE.name };
    for (const v of [...REDDIT_COMMENT_VOICES, ...DISABLED_VOICES]) m[v.id] = v.name;
    narrationVoices.forEach((v, i) => { const id = v.trim(); if (id && !(id in m)) m[id] = `Voice ${i + 1}`; });
    return m;
  }, [narrationVoices]);
  const voiceBrush = useMemo(() => {
    if (!voiceBrushId) return null;
    return { voiceId: voiceBrushId, color: narrationVoiceColors[voiceBrushId] ?? VOICE_COLORS[0] };
  }, [voiceBrushId, narrationVoiceColors]);
  const [reelTemplateMap, setReelTemplateMap] = useState<Record<string, string | null>>({}); // entryId → template id
  // entryId → user-given reel name (shown/edited in the bottom strip). Kept OUTSIDE VideoEntry — like
  // framing/template above — because entries model the video pipeline (fetch/upload state) while the name
  // is pure saved-grid metadata; it rides the same autosave rows. '' / absent = unnamed (number only).
  const [reelNameMap, setReelNameMap] = useState<Record<string, string>>({});
  const [framingDirty, setFramingDirty] = useState(0);   // bumped when a reel's crop/pan/zoom/trim changes
  // When on, "Add reel" seeds the new reel with a random footage segment. Persisted per browser.
  const [autoRandomFootage, setAutoRandomFootage] = useState(() => {
    try { return localStorage.getItem('reels:auto-random-footage') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('reels:auto-random-footage', autoRandomFootage ? '1' : '0'); } catch { /* ignore */ }
  }, [autoRandomFootage]);
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
        }).catch(() => {});
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
        // Live canvas framing wins when loaded, but redditThread lives only in framingMap
        // (the canvas doesn't know about it) — merge it so autosave never drops the thread link.
        framing: {
          ...(((canvasRefsMap.current.get(e.id)?.getVideoElement()?.readyState ?? 0) >= 2
            ? canvasRefsMap.current.get(e.id)?.getFraming() : null) ?? framingMap[e.id] ?? {}),
          ...(framingMap[e.id]?.redditThread ? { redditThread: framingMap[e.id].redditThread } : {}),
          ...(framingMap[e.id]?.description ? { description: framingMap[e.id].description } : {}),
          ...(framingMap[e.id]?.ytTitle ? { ytTitle: framingMap[e.id].ytTitle } : {}),
        },
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
          const merged = withFramingSidecars(f, cur);
          return cur && JSON.stringify(cur) === JSON.stringify(merged) ? prev : { ...prev, [outgoing]: merged };
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
    setFramingMap(prev => {
      const snap = canvasRefsMap.current.get(id)?.getFraming();
      return { ...prev, [newId]: snap ? withFramingSidecars(snap, prev[id]) : (prev[id] ?? {}) };
    });
    setSelectedId(newId);
  }, [onDuplicateRow, activeTwitterId]);

  const getVideoZoom = useCallback((id: string) => videoZoomMap[id] ?? 1, [videoZoomMap]);

  // Add an image overlay to a reel: persist the blob (IndexedDB) so it survives reloads, then hand a
  // fresh object URL to the canvas, which sizes/centres it and selects it. OCR runs in the background
  // right away so the click-to-toggle narration highlights appear on the overlay once the text is read.
  const addOverlayImage = useCallback(async (id: string, file: File) => {
    const overlayId = `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await saveOverlayImage(overlayId, file, file.name);
    const url = URL.createObjectURL(file);
    canvasRefsMap.current.get(id)?.addImageOverlay(overlayId, url, file.name);
    void extractMemeLines(url)
      .then(lines => {
        if (lines.length === 0) return;
        canvasRefsMap.current.get(id)?.updateOverlay(overlayId, { ocrLines: lines.map(l => ({ ...l, enabled: true })) });
      })
      .catch(e => console.error('[ocr] auto-detect failed:', e));
  }, [canvasRefsMap]);

  // Add a rendered Reddit card as an overlay. Same persistence path as an uploaded image, but the
  // narration lines are synthetic (from the renderer's layout) instead of OCR'd. addImageOverlay
  // commits the overlay inside img.onload, so the lines attach via a short retry loop; if they
  // somehow miss, generateNarration's OCR fallback still reads the card.
  const addRedditCard = useCallback(async (id: string, blob: Blob, lines: MemeLine[], dims: { w: number; h: number }, blockAuthors: string[]) => {
    const ref = canvasRefsMap.current.get(id);
    // Replace any existing Reddit card on this reel — re-adding updates the thread, never stacks a
    // second card (removeOverlay also GCs its stored image + narration audio).
    for (const o of ref?.getOverlays() ?? []) {
      if (o.name === 'Reddit thread') ref?.removeOverlay(o.id);
    }
    const overlayId = `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await saveOverlayImage(overlayId, blob, 'reddit-card.png');
    const url = URL.createObjectURL(blob);
    ref?.addImageOverlay(overlayId, url, 'Reddit thread');
    // Cast + fit the card (blockAuthors stored so Shuffle voices can re-cast later without re-import).
    const { ocrLines, rect } = redditOverlayLayout(lines, dims, blockAuthors);
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 150));
      canvasRefsMap.current.get(id)?.updateOverlay(overlayId, { ocrLines, blockAuthors, ...rect });
    }
  }, [canvasRefsMap]);

  // Reshuffle a Reddit card's voice cast on demand (uses the stored blockAuthors). Recolors the line
  // highlights immediately; the user then regenerates narration to hear the new cast.
  const shuffleRedditVoices = useCallback((entryId: string, overlayId: string) => {
    const ref = canvasRefsMap.current.get(entryId);
    const o = ref?.getOverlays().find(x => x.id === overlayId);
    if (!o?.ocrLines || !o.blockAuthors) return;
    const blockVoice = castRedditVoices(o.blockAuthors);
    ref?.updateOverlay(overlayId, { ocrLines: o.ocrLines.map(l => ({ ...l, voiceId: blockVoice[l.blockIdx] })) });
  }, [canvasRefsMap]);

  // Generate ElevenLabs narration for an overlay and attach it. The meme's text is read straight off
  // the image (OCR — nothing to type). Consecutive enabled lines with the same painted voice form one
  // paragraph, spoken as its own excited take; the takes are stitched into a single narration track.
  // The reveal is adapted to that audio: character timestamps (offset by each take's position in the
  // stitched track) say when each OCR text LINE is reached, and the image un-crops to that line's own
  // boundary just before its first word lands. Returns an error message, or null on success.
  const generateNarration = useCallback(async (entryId: string, overlayId: string, apiKey: string, onStatus?: (s: string) => void): Promise<string | null> => {
    const ref = canvasRefsMap.current.get(entryId);
    const overlay = ref?.getOverlays().find(o => o.id === overlayId);
    if (!ref || !overlay?.src) return 'The overlay image isn’t loaded yet — try again in a moment.';

    // The image was OCR'd when it was added; run it now only if that hasn't landed yet (e.g. the
    // user hit Generate immediately). Only lines the user left enabled get narrated.
    let ocrLines = overlay.ocrLines;
    if (!ocrLines?.length) {
      onStatus?.('Reading the meme text…');
      try {
        ocrLines = (await extractMemeLines(overlay.src)).map(l => ({ ...l, enabled: true }));
      } catch (e) {
        console.error('[narration] OCR failed:', e);
        return 'Couldn’t read the image — OCR failed to load.';
      }
      if (ocrLines.length === 0) return 'No readable text found in the image.';
      ref.updateOverlay(overlayId, { ocrLines });
    }
    const memeLines = ocrLines.filter(l => l.enabled);
    if (memeLines.length === 0) return 'Every text line is unselected — click lines on the image to include them.';

    // Consecutive same-voice lines form one spoken paragraph (one TTS take with that voice).
    const defaultVoice = (narrationVoices[0] ?? '').trim() || DEFAULT_VOICE;
    // A disabled voice (e.g. persisted on an old card) is revoiced to the first active pool voice,
    // so it's never actually spoken even after regeneration.
    const subst = REDDIT_COMMENT_VOICES[0]?.id ?? defaultVoice;
    const groups: { voiceId: string; lines: typeof memeLines }[] = [];
    for (const line of memeLines) {
      let vid = (line.voiceId ?? '').trim() || defaultVoice;
      if (DISABLED_VOICE_IDS.has(vid)) vid = subst;
      const g = groups[groups.length - 1];
      if (g && g.voiceId === vid) g.lines.push(line);
      else groups.push({ voiceId: vid, lines: [line] });
    }

    // One take per group. Within a take: lines joined with spaces, terminal punctuation added only at
    // block ends — the voice pauses between blocks but flows straight through mid-sentence line
    // wraps. Each take is decoded to PCM so the takes can be stitched into ONE narration track, with
    // per-line beat times = take offset + the line's first-character timestamp.
    const MIX_SR = 44100;
    const GROUP_GAP_S = 0.25;   // breath between voices
    const segments: { samples: Float32Array; beats: number[]; voiceId: string }[] = [];
    const ac = new AudioContext({ sampleRate: MIX_SR });
    try {
      // Build each voice group's text upfront (pure — join lines, add terminal punctuation at block ends,
      // record per-line char offsets for beat timing), then fire ALL the /api/tts calls CONCURRENTLY
      // (bounded). ElevenLabs round-trips dominate narration time, so a card with N voices generates ~N×
      // faster. Decode + stitch below stays strictly in group order, so the output WAV is byte-identical.
      const groupTexts = groups.map(g => {
        let joined = '';
        const offs: number[] = [];
        for (let i = 0; i < g.lines.length; i++) {
          const line = g.lines[i];
          const endsBlock = i === g.lines.length - 1 || g.lines[i + 1].blockIdx !== line.blockIdx;
          if (joined) joined += ' ';
          offs.push(joined.length);
          joined += endsBlock && !/[.!?…,:;]$/.test(line.text) ? `${line.text}.` : line.text;
        }
        return { joined, offs, voiceId: g.voiceId };
      });
      type TtsOut = { audioB64?: string; starts?: number[]; error?: string };
      const ttsResults = new Array<TtsOut>(groups.length);
      const TTS_ATTEMPTS = 4;         // 1 try + 3 retries — rides out transient ElevenLabs rate-limits (429→502)
      const fetchTts = async (gi: number): Promise<TtsOut> => {
        const gt = groupTexts[gi];
        let lastErr = 'Narration failed — the voice service is busy; try again in a moment.';
        for (let attempt = 0; attempt < TTS_ATTEMPTS; attempt++) {
          // Exponential backoff with jitter (0.6s → 1.2s → 2.4s) so concurrent groups that collide on a rate
          // limit don't re-fire in lockstep. The /api/tts route folds ElevenLabs' 429 into a 502 + a retryable hint.
          if (attempt) await new Promise(r => setTimeout(r, 600 * 2 ** (attempt - 1) + Math.random() * 400));
          let res: Response;
          try {
            res = await fetch('/api/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey, voiceId: gt.voiceId, text: gt.joined,
                // Excited meme-narrator delivery: low stability + high style = animated, hyped read. `speed`
                // is ElevenLabs' native pacing — reveal sync holds because the timestamps describe the sped audio.
                voiceSettings: { stability: 0.35, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true, speed: narrationSpeed },
              }),
            });
          } catch { lastErr = 'Could not reach the narration service.'; continue; }   // network blip → retry
          const json = await res.json().catch(() => ({})) as {
            audio_base64?: string; alignment?: { character_start_times_seconds?: number[] }; error?: string; retryable?: boolean;
          };
          if (res.ok) return { audioB64: json.audio_base64, starts: json.alignment?.character_start_times_seconds };
          if (json.error) lastErr = json.error;   // keep the ACTUAL message (bad key/plan/voice) to surface if we give up
          // Retry only rate-limits / transient upstream 5xx; a deterministic config failure (retryable:false)
          // won't improve, so surface its real message immediately instead of burning retries.
          const retryable = res.status === 502 ? json.retryable !== false : (res.status === 429 || res.status === 503);
          if (!retryable) return { error: lastErr };
        }
        return { error: lastErr };
      };
      // Cap at 2 — narrate-all is serial across cards, so this is the global ElevenLabs concurrency; 2 is the
      // free-tier ceiling (still ~2× faster than serial) and, with the backoff above, rides out brief 429s.
      const TTS_CONCURRENCY = 2;
      let nextGi = 0, doneGroups = 0, poolFailed = false;
      await Promise.all(Array.from({ length: Math.min(TTS_CONCURRENCY, groups.length) }, async () => {
        // Stop claiming NEW groups once any group has definitively failed (fetchTts already exhausted its
        // retries) — the whole card's narration fails on the first error anyway, so firing the rest just
        // burns TTS calls and slows Cancel. Claims are contiguous (nextGi++ is atomic in JS) and in-flight
        // groups still store their result, so the decode loop below never hits an undefined slot before the
        // first error. At most CONCURRENCY-1 extra groups finish after the failure — unavoidable with a pool.
        while (!poolFailed) {
          const gi = nextGi++;
          if (gi >= groups.length) break;
          const out = await fetchTts(gi);
          ttsResults[gi] = out;
          if (out.error) poolFailed = true;
          doneGroups++;
          onStatus?.(groups.length > 1 ? `Generating voices ${doneGroups}/${groups.length}…` : 'Generating narration…');
        }
      }));
      // Decode + gain + collect segments STRICTLY in group order — the stitched track must match serial output.
      for (let gi = 0; gi < groups.length; gi++) {
        const r = ttsResults[gi];
        // A slot is undefined only if the pool short-circuited before claiming this group, which happens
        // strictly AFTER a lower-gi group errored — so the r.error return below fires first. Guard anyway so
        // the loop can never deref undefined regardless of ordering.
        if (!r || r.error) return r?.error ?? 'Narration failed.';
        if (!r.audioB64 || !r.starts?.length) return 'ElevenLabs returned no audio.';
        const bytes = Uint8Array.from(atob(r.audioB64), c => c.charCodeAt(0));
        let decoded: AudioBuffer;
        try {
          decoded = await ac.decodeAudioData(bytes.buffer);
        } catch {
          return 'Couldn’t decode the narration audio.';
        }
        const starts = r.starts;
        const samples = Float32Array.from(decoded.getChannelData(0));   // ElevenLabs is mono
        // Channel gain: balance this voice against the rest of the cast (soft-clipped at ±1).
        const gain = voiceGains[groups[gi].voiceId] ?? 1;
        if (gain !== 1) {
          for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i] * gain));
        }
        segments.push({
          samples,
          beats: groupTexts[gi].offs.map(off => starts[Math.min(off, starts.length - 1)] ?? 0),
          voiceId: groups[gi].voiceId,
        });
      }
    } finally {
      void ac.close();
    }

    // Stitch the takes (with a breath of silence between voices) and WAV-encode the result.
    const gapSamples = Math.round(GROUP_GAP_S * MIX_SR);
    const totalSamples = segments.reduce((n, s) => n + s.samples.length, 0) + gapSamples * (segments.length - 1);
    const stitched = new Float32Array(totalSamples);
    const beatStarts: number[] = [];   // audio-time per enabled line, in memeLines order
    const audioTakes: { voiceId: string; start: number; duration: number }[] = [];   // timeline channel blocks
    let cursor = 0;
    for (const seg of segments) {
      for (const b of seg.beats) beatStarts.push(cursor / MIX_SR + b);
      audioTakes.push({ voiceId: seg.voiceId, start: cursor / MIX_SR, duration: seg.samples.length / MIX_SR });
      stitched.set(seg.samples, cursor);
      cursor += seg.samples.length + gapSamples;
    }
    const audioDuration = totalSamples / MIX_SR;
    const blob = encodeWavMono(stitched, MIX_SR);
    const audioId = `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await saveOverlayImage(audioId, blob, 'narration.wav');

    // Each OCR line carries its own crop boundary, so text↔reveal mapping is exact (monotonic —
    // never crop back up). Each line un-crops a breath BEFORE its first word so the text is on
    // screen as it's read. Reveal times live in SOURCE time: the background video runs VIDEO_RATE×
    // faster than the voice, so audio-time beats are scaled up onto the video's clock.
    const REVEAL_LEAD_S = 0.15;
    const VIDEO_RATE = 1.25;   // slight background speed-up, brainrot style
    let lastH = 0;
    const audioStart = overlay.start;
    const reveals: { t: number; h: number }[] = [];
    for (let i = 0; i < memeLines.length; i++) {
      const h = memeLines[i].bottomFrac;
      if (h <= lastH && i > 0) continue;
      lastH = Math.max(lastH, h);
      reveals.push({ t: audioStart + Math.max(0, beatStarts[i] - REVEAL_LEAD_S) * VIDEO_RATE, h: lastH });
    }

    onStatus?.(`Narrating ${memeLines.length} line${memeLines.length === 1 ? '' : 's'} in ${groups.length} voice${groups.length === 1 ? '' : 's'}…`);

    ref.setOverlayNarration(overlayId, { reveals, audioId, audioStart, audioDuration, audioSrc: URL.createObjectURL(blob), audioRate: VIDEO_RATE, audioTakes });

    // Reddit thread cards snap to the reading layout once narrated: readable width, top-anchored.
    // The teleprompter scroll in drawOverlays keeps the reveal front pinned on screen from there,
    // however long the thread is (reference: reddit-story shorts).
    if (overlay.name === 'Reddit thread') {
      const w = 886;   // ~82% of the 1080 canvas — comment text stays readable in the export
      ref.updateOverlay(overlayId, { x: Math.round((1080 - w) / 2), y: 110, w, h: Math.round(w * (overlay.h / overlay.w)) });
    }
    return null;
  }, [canvasRefsMap, narrationVoices, narrationSpeed, voiceGains]);

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
  // Batch generation across every reel — narration (cycles each reel on-screen) or YouTube copy (pure
  // API). Live progress + a cancel flag, since narrating many reels can take several minutes.
  const [batchOp, setBatchOp] = useState<null | 'narration' | 'copy'>(null);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, status: '' });
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const batchCancelRef = useRef(false);
  // Shown when an add/duplicate is blocked by the MAX_REELS cap.
  const [reelCapNotice, setReelCapNotice] = useState<string | null>(null);
  const atReelCap = entries.length >= MAX_REELS;

  // "Add reel": with the auto-random toggle on, seed the new reel with a random footage segment;
  // otherwise add a blank reel. Manifest load falls back to blank on error. NOTE: no blob pre-warm
  // here — firing a full-file download per add saturated the browser's ~6-connection-per-host limit
  // when several reels were added quickly, starving the on-screen reel's video stream. The selected
  // reel is pre-warmed instead (one at a time), and the timeline warms itself when opened.
  const handleAddRow = useCallback(async () => {
    if (atReelCap) { setReelCapNotice(`You’ve hit the ${MAX_REELS}-reel limit — remove one to add another.`); return; }
    if (!autoRandomFootage) { onAddRow(); return; }
    try {
      const segs = await fetchFootageManifest();
      const seg = segs.length ? segs[Math.floor(Math.random() * segs.length)] : null;
      onAddRow(seg?.url);
    } catch {
      onAddRow();
    }
  }, [atReelCap, autoRandomFootage, onAddRow]);

  // NOTE: no selected-reel video pre-warm. It existed to warm the timeline's scrub blob, but eagerly
  // full-downloading each selected reel's ~100MB clip (incl. every reel a batch narration cycles through)
  // stalled the build/narrate/copy flow. The clip now loads lazily (preload="metadata") and is fetched in
  // full only at export — see TikTokCanvas <video>. Re-add a size-gated warm here if the timeline returns.

  const [bulkOpen, setBulkOpen] = useState(false);
  const [pipelineView, setPipelineView] = useState(false);   // Canvas ⇄ Pipeline (bulk stages-as-nodes) view

  // Bulk build: turn a set of imported threads (each with its picked comments/paragraphs) into reels.
  // Each reel gets random footage + its Reddit card written straight into the saved framing +
  // IndexedDB — no canvas mount needed, so it scales to many reels at once. The card appears when
  // the reel is selected (or Download All cycles it); narration stays a per-reel/batch step.
  // Returns { built, failed }: `built` = threads that got a GRID REEL (addReels truncates at the reel cap,
  // so built < threads.length when the grid is full — callers must NOT treat the surplus as done);
  // `failed` = reels created whose card render failed (the reel exists; its card can be re-imported).
  // Deliberately does NOT throw on partial failure — callers need the counts to reconcile their state
  // (the Scout buffer keeps unbuilt entries; the bulk builder keeps selections + shows the error).
  const buildReelsFromThreads = useCallback(async (threads: Array<{
    url: string; post: ImportedRedditPost; comments: ImportedRedditComment[];
    selectedComments: number[]; selectedParas: number[]; edits?: RedditThreadEdits;
  }>): Promise<{ built: number; failed: number; builtUrls: string[] }> => {
    if (!onAddReels || !threads.length) return { built: 0, failed: 0, builtUrls: [] };
    const segs = await fetchFootageManifest().catch(() => [] as FootageSegment[]);
    const rand = () => (segs.length ? segs[Math.floor(Math.random() * segs.length)].url : undefined);
    const ids = onAddReels(threads.map(() => rand()));
    // allSettled: one reel's card-render failure (e.g. canvas.toBlob → null on iOS/Safari size limits) must
    // not abort its siblings' framing writes, the tail below, or their ledger marks.
    const results = await Promise.allSettled(ids.map(async (reelId, i) => {
      const t = threads[i];
      if (!t) return;
      // Apply the Pick-stage text edits (comment keys are depth-0 space; t.comments is the full tree, so
      // remap depth-0→full first — identical to the copy paths). Empty/absent edits = identity.
      const eff = applyThreadEdits(t.post, t.comments, remapCommentEdits(t.comments, t.edits));
      const data = buildRedditCardData(eff.post, eff.comments, new Set(t.selectedComments), new Set(t.selectedParas));
      const card = await renderRedditCard(data);
      const postAuthor = data.user.name.replace(/^u\//, '');
      const blockAuthors = [postAuthor, postAuthor, ...data.comments.map(c => c.user.name.replace(/^u\//, ''))];
      const { ocrLines, rect } = redditOverlayLayout(card.lines, { w: card.width, h: card.height }, blockAuthors);
      const overlayId = `ov-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      await saveOverlayImage(overlayId, card.blob, 'reddit-card.png');
      const overlay: Omit<ImageOverlay, 'src' | 'audioSrc'> = { id: overlayId, name: 'Reddit thread', ...rect, start: 0, end: 3600, ocrLines, blockAuthors };
      threadCacheRef.current.set(reelId, { url: t.url, post: t.post, comments: t.comments });   // url-tagged so copy skips the re-import ONLY while the thread is unchanged
      // Store the comment selection in DEPTH-0 space (the flyout — the sole reader of redditThread.comments
      // — restores it onto its depth-0-filtered list; storing full-tree indices would mis-highlight for
      // reply-heavy threads). Card + copy are unaffected (both use t.selectedComments / edits directly).
      const selDepth0 = t.selectedComments.map(fi => depth0IndexOf(t.comments, fi)).filter((k): k is number => k != null);
      setFramingMap(prev => ({ ...prev, [reelId]: { ...prev[reelId], overlays: [overlay], redditThread: { url: t.url, comments: selDepth0, paras: t.selectedParas, edits: hasThreadEdits(t.edits) ? t.edits : undefined } } }));
      // Shared no-repeat ledger — marked HERE, per reel, only after this reel actually framed: threads
      // truncated by the reel cap (addReels slices at MAX_REELS) or whose card failed to render must NOT
      // be recorded 'used' (§4.4: skipped ≠ decided), and one sibling's failure must not drop the others'
      // marks. Best-effort/fire-and-forget — a ledger blip never breaks building.
      void markRedditUsed(t.url, t.post.title);
    }));
    markFramingDirty();
    if (ids[0]) setSelectedId(ids[0]);
    const failed = results.filter(r => r.status === 'rejected').length;
    // builtUrls = threads that now HAVE a grid reel (addReels consumes the prefix) — the Scout buffer
    // releases exactly these (release-at-build: presence in the builder is not reload-durable, a reel is).
    return { built: ids.length, failed, builtUrls: threads.slice(0, ids.length).map(t => t.url) };
  }, [onAddReels, setFramingMap, markFramingDirty]);

  // "Delete all reels" confirm. Only offered when there's actually something to clear (more than one
  // reel, or a single reel that isn't blank).
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const hasReelContent = entries.length > 1
    || (!!entries[0] && !!(entries[0].url?.trim() || entries[0].videoUrl || entries[0].localVideoSrc || entries[0].caption?.trim()));
  // Any export in flight — every export button disables while one runs, since they share the reel
  // canvases and only one recording can run at a time.
  // Includes batchOp so a batch generate (which cycles selectedId + mutates each canvas) disables every
  // export/delete control — otherwise a single-reel Download recorded mid-batch yields a broken MP4, and
  // Delete-all mid-batch wipes the grid while the batch is still writing framing. (At batch entry batchOp
  // is still null, so this never self-locks the batch functions' own guards.)
  const exportBusy = downloadingOne || isDownloadingAll || !!batchOp;

  // Wait until reel `id`'s canvas has mounted (after the swap fade) and its video is ready enough to export.
  const waitForReelReady = useCallback(async (id: string, timeoutMs = 15000): Promise<TikTokCanvasRef | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ref = canvasRefsMap.current.get(id);
      const video = ref?.getVideoElement();
      // Export-ready = the canvas is mounted and its <video> has a src. The element is preload="none" so it
      // never loads on its own (readyState stays 0); export fetches the file bytes + reads dimensions from
      // the demux itself, so it doesn't need the element loaded — only its src (the URL) resolved.
      if (ref && video && (video.src || video.currentSrc)) return ref;
      await new Promise(r => setTimeout(r, 80));
    }
    return canvasRefsMap.current.get(id) ?? null;
  }, [canvasRefsMap]);

  // Wait until reel `id`'s canvas has mounted AND its overlay `overlayId` has re-hydrated its image blob
  // (object URL) from IndexedDB — narration reads the overlay's pixels, so it can't run before then.
  const waitForOverlay = useCallback(async (id: string, overlayId: string, timeoutMs = 15000): Promise<TikTokCanvasRef | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ref = canvasRefsMap.current.get(id);
      if (ref && ref.getOverlays().find(o => o.id === overlayId)?.src) return ref;
      await new Promise(r => setTimeout(r, 100));
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
        // Prefetch the SAME url the reel will mount + export from — activeVideoSrc resolves data-first
        // (data ? bestVideoUrl(data) : videoUrl), so this must match or the prefetch warms the wrong key
        // and export re-downloads. Skip if it already has a local/downloaded blob.
        const nextSrc = next && !next.localVideoSrc && !videoBlobUrlsRef.current[next.id]
          ? (next.data ? bestVideoUrl(next.data) : (next.videoUrl ?? null))
          : null;
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
              // Name from the generated YouTube title if present, else the caption.
              const rawName = framingMapRef.current[entry.id]?.ytTitle || entry.caption || '';
              const cap = rawName.replace(/[/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
              const stem = `${String(reelNo).padStart(2, '0')}_${cap || 'reel'}`;
              // Numbering is unique by construction, but a filename map silently drops an entry on a key
              // clash — so never let one reel overwrite another: suffix _2, _3, … if the name is taken.
              let name = `${stem}.mp4`;
              for (let n = 2; files[`${folder}/${name}`]; n++) name = `${stem}_${n}.mp4`;
              files[`${folder}/${name}`] = new Uint8Array(await blob.arrayBuffer());
              // Paired text file: the generated YouTube title + description if present, else blank.
              const ytTitle = framingMapRef.current[entry.id]?.ytTitle ?? '';
              const ytDesc = framingMapRef.current[entry.id]?.description ?? '';
              const txt = (ytTitle || ytDesc) ? `${ytTitle}\n\n${ytDesc}`.trim() + '\n' : '';
              files[`${folder}/${name.replace(/\.mp4$/, '.txt')}`] = new TextEncoder().encode(txt);
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

  // ── Batch generate (narration / YouTube copy for every reel) ─────────────────────────────────────
  // Narrate every un-narrated Reddit reel. Narration needs the reel's canvas mounted (it reads the card
  // pixels + ocrLines off the ref), so — like Download All — we flip each reel on-screen, wait for its
  // overlay image to hydrate, generate, then snapshot the result into framingMap so it survives cycling
  // away and reload. Serial (ElevenLabs is the bottleneck) with live per-reel status and cancel.
  const batchGenerateNarration = useCallback(async () => {
    if (batchOp || exportBusy) return;
    // Client key is optional: /api/tts falls back to the server's ELEVENLABS_API_KEY. If neither exists,
    // generateNarration surfaces a clear per-reel error and the run reports how many failed.
    let apiKey = '';
    try { apiKey = (localStorage.getItem(LS_11L_KEY) ?? '').trim(); } catch { /* ignore */ }
    const targets = entries.flatMap(e => {
      const ov = framingMap[e.id]?.overlays?.find(o => o.name === 'Reddit thread');
      if (!ov) return [];
      // Prefer the LIVE canvas audioId for the mounted reel — framingMap lags a reel the user just narrated
      // manually and hasn't switched away from, which would otherwise get re-narrated (wasted TTS + orphan blob).
      const liveAudioId = canvasRefsMap.current.get(e.id)?.getOverlays().find(o => o.id === ov.id)?.audioId;
      return (liveAudioId ?? ov.audioId) ? [] : [{ id: e.id, overlayId: ov.id }];
    });
    if (!targets.length) { setBatchNotice('No un-narrated Reddit reels found (build some in Bulk build, or they’re already narrated).'); return; }
    const original = selectedId;
    batchCancelRef.current = false;
    setBatchNotice(null); setBatchOp('narration');
    setBatchProgress({ done: 0, total: targets.length, status: 'Starting…' });
    let errors = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (batchCancelRef.current) break;
        const { id, overlayId } = targets[i];
        setBatchProgress(p => ({ ...p, status: `Reel ${i + 1}/${targets.length}: loading…` }));
        setSelectedId(id);
        const ref = await waitForOverlay(id, overlayId);
        if (!ref || !ref.getOverlays().find(o => o.id === overlayId)?.src) {
          errors++; setBatchProgress(p => ({ ...p, done: p.done + 1 })); continue;
        }
        const err = await generateNarration(id, overlayId, apiKey, s =>
          setBatchProgress(p => ({ ...p, status: `Reel ${i + 1}/${targets.length}: ${s}` })));
        if (err) { errors++; console.error('[batch narration]', id, err); }
        else {
          // Snapshot the fresh narration so it persists once we cycle off this reel. getFraming() returns
          // null while the video is still loading (so it'd silently drop the last reel's narration) —
          // capture the narrated overlays DIRECTLY instead, stripping the runtime-only object URLs.
          const ovs = canvasRefsMap.current.get(id)?.getOverlays();
          if (ovs) setFramingMap(prev => ({ ...prev, [id]: { ...prev[id], overlays: ovs.map(({ src, audioSrc, ...o }) => o) } }));
        }
        setBatchProgress(p => ({ ...p, done: p.done + 1 }));
      }
    } finally {
      setSelectedId(original);
      markFramingDirty();
      setBatchOp(null);
      setBatchProgress(p => ({ ...p, status: '' }));
    }
    setBatchNotice(batchCancelRef.current ? 'Narration cancelled.'
      : errors ? `Narration finished — ${errors} reel${errors === 1 ? '' : 's'} failed (open them to retry).`
      : 'Narration generated for every reel. ✓');
    return { errors };   // let Run all aggregate the outcome across phases (its own setBatchNotice would else hide this)
  }, [batchOp, exportBusy, entries, framingMap, selectedId, generateNarration, waitForOverlay, canvasRefsMap, setFramingMap, markFramingDirty]);

  // Generate a YouTube title + description for every Reddit reel that's missing one. Pure API (re-imports
  // the thread + hits /api/description), so no canvas mount needed — runs a couple in parallel.
  const batchGenerateCopy = useCallback(async () => {
    if (batchOp || exportBusy) return;
    const targets = entries.flatMap(e => {
      const f = framingMap[e.id];
      const url = f?.redditThread?.url;
      const needTitle = !f?.ytTitle, needDesc = !f?.description;
      // Only regenerate the field(s) actually missing — never clobber a title/description the user already
      // wrote. When both are missing, only=undefined regenerates both.
      return url && (needTitle || needDesc)
        ? [{ id: e.id, url, only: needTitle && needDesc ? undefined : (needTitle ? 'title' as const : 'description' as const) }]
        : [];
    });
    if (!targets.length) { setBatchNotice('No reels need copy — they either have no Reddit thread or already have a title & description.'); return; }
    batchCancelRef.current = false;
    setBatchNotice(null); setBatchOp('copy');
    setBatchProgress({ done: 0, total: targets.length, status: '' });
    let errors = 0;
    let skippedEdits = 0;   // drift-anchored text tweaks that no longer matched their thread
    const CONCURRENCY = 2;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      for (let i = next++; i < targets.length && !batchCancelRef.current; i = next++) {
        const { id, url, only } = targets[i];
        // Retry once (with a short backoff) — a transient rate-limit / re-import hiccup under concurrency
        // shouldn't silently leave a reel without copy.
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok && !batchCancelRef.current; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
          try {
            // Reuse the thread captured at bulk-build — /api/description only reads post.title/body +
            // comment bodies, so we skip re-importing via /api/reddit (avatars aren't read, and the native
            // transport's shared browser page serializes concurrent imports). Trust the cache ONLY when its
            // tagged url matches this reel's CURRENT url — if the reel was re-pointed to a different thread
            // (RedditFlyout) the cache is stale, so fall through to a re-import of the current url. Also
            // covers reels created before this / restored after a reload (no cache entry).
            const cached = threadCacheRef.current.get(id);
            let thread = cached && cached.url === url ? { post: cached.post, comments: cached.comments } : undefined;
            if (!thread) {
              const imp = await fetch('/api/reddit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, skipAvatars: true }), signal: AbortSignal.timeout(240_000),
              });
              const impJson = await imp.json();
              if (!imp.ok) throw new Error(impJson.error ?? 'thread load failed');
              thread = { post: impJson.post, comments: impJson.comments ?? [] };
            }
            // The user's Pick-stage text edits apply here too — the description must describe the
            // TWEAKED thread (the one actually narrated on the card), not Reddit's original. Read the
            // edits FRESH (framingMapRef, not the targets snapshot) so a tweak made mid-batch counts.
            // remapCommentEdits: edit indices live in the flyout's depth-0-filtered universe, but THIS
            // array is unfiltered (raw import / full-tree bulk cache) — translate or the override lands
            // on the wrong comment. Drift-anchored overrides skip when content no longer matches.
            const edits = framingMapRef.current[id]?.redditThread?.edits;
            const eff = applyThreadEdits(thread.post, thread.comments, remapCommentEdits(thread.comments, edits));
            if (eff.skipped.length) skippedEdits += eff.skipped.length;
            const res = await fetch('/api/description', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, thread: { post: eff.post, comments: eff.comments }, only }),
              signal: AbortSignal.timeout(90_000),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? 'copy generation failed');
            setFramingMap(prev => ({
              ...prev,
              [id]: {
                ...prev[id],
                ...(json.title !== undefined ? { ytTitle: json.title } : {}),
                ...(json.description !== undefined ? { description: json.description } : {}),
              },
            }));
            ok = true;
          } catch (e) { if (attempt === 1) { errors++; console.error('[batch copy]', e); } }
        }
        setBatchProgress(p => ({ ...p, done: p.done + 1 }));
      }
    }));
    markFramingDirty();
    setBatchOp(null);
    const skipNote = skippedEdits ? ` (${skippedEdits} text tweak${skippedEdits === 1 ? '' : 's'} no longer matched and ${skippedEdits === 1 ? 'was' : 'were'} skipped)` : '';
    setBatchNotice(batchCancelRef.current ? 'Copy generation cancelled.'
      : errors ? `Copy finished — ${errors} reel${errors === 1 ? '' : 's'} failed.${skipNote}`
      : `Title & description generated for every reel. ✓${skipNote}`);
    return { errors };
  }, [batchOp, exportBusy, entries, framingMap, setFramingMap, markFramingDirty]);

  // ── Run all: narrate every reel → write copy for every reel → download all, in one click ─────────
  // Continue-through-failures: each phase reports its own progress + count of failures (narration/copy
  // notices, Download-All's "N couldn't be rendered"), so a couple of bad reels never abort the batch.
  // Cancellable during the narrate/copy phases (the Cancel link sets batchCancelRef); once the export
  // phase starts it runs to completion. runningAll gates the individual batch buttons but is deliberately
  // NOT folded into exportBusy — the sub-functions guard on exportBusy and would otherwise self-block.
  const [runningAll, setRunningAll] = useState(false);
  const runAll = useCallback(async () => {
    if (runningAll || batchOp || exportBusy) return;
    setRunningAll(true);
    batchCancelRef.current = false;   // clear any STALE cancel from a prior batch, else the guards below would
                                      // silently skip copy+export whenever narration takes its no-targets return.
    try {
      const nar = await batchGenerateNarration();
      if (batchCancelRef.current) return;          // cancelled mid-narration → stop before copy
      const cp = await batchGenerateCopy();
      if (batchCancelRef.current) return;          // cancelled mid-copy → stop before export
      await downloadAllReels();
      // One combined summary owns the final notice, so a phase's transient message (incl. the "nothing to
      // do" no-op notices, and copy overwriting narration's failure count) never hides the real outcome.
      const parts: string[] = [];
      if (nar?.errors) parts.push(`narration ${nar.errors} failed`);
      if (cp?.errors) parts.push(`copy ${cp.errors} failed`);
      setBatchNotice(parts.length ? `Run all done — ${parts.join(', ')} (open those reels to retry).` : 'Run all complete. ✓');
    } finally {
      setRunningAll(false);
    }
  }, [runningAll, batchOp, exportBusy, batchGenerateNarration, batchGenerateCopy, downloadAllReels]);

  // ── Reddit Scout: approved-post buffer + panel state ──────────────────────────────────────────────
  // The buffer PERSISTS (localStorage): a Use marks the post 'used' in the permanent ledger immediately,
  // so losing the buffer on reload would orphan approved posts (used forever, never imported). Entries
  // leave the buffer only when their thread is actually PRESENT in the bulk builder (see the handoff).
  const [scoutOpen, setScoutOpen] = useState(false);
  const [scoutNewCount, setScoutNewCount] = useState(0);
  const [scoutBuffer, setScoutBuffer] = useState<ScoutCandidate[]>(() => {
    // Shape-validation + legacy migration live in the tested lib (migrateScoutBuffer).
    try { return migrateScoutBuffer(JSON.parse(localStorage.getItem('scout:buffer') ?? '[]')); }
    catch { return []; }
  });
  // Persist guards (the buffer was once lost to exactly this):
  // 1. MOUNT-ECHO / FAILED-READ CLOBBER: never write [] over storage until a NON-EMPTY buffer has been
  //    committed this mount. Value-based (not run-count) so it survives StrictMode's double effect-invoke
  //    — a persisted ref would leave the 2nd invoke "armed" and clobber anyway. A legitimate emptying
  //    (release-at-build/undo) is always preceded by a non-empty commit that sets the flag.
  // 2. TOMBSTONE: whenever we decline/replace a stored buffer with [], stash the old value under
  //    scout:buffer:prev first — including at the failed-read DIVERGENCE (state [], storage non-empty),
  //    before a later first add can overwrite it unguarded. A one-slot net beneath the ledger restore.
  const scoutSawNonEmpty = useRef(false);
  useEffect(() => {
    try {
      if (scoutBuffer.length > 0) {
        scoutSawNonEmpty.current = true;
        localStorage.setItem('scout:buffer', JSON.stringify(scoutBuffer));
        return;
      }
      const prev = localStorage.getItem('scout:buffer');
      if (prev && prev !== '[]') localStorage.setItem('scout:buffer:prev', prev);   // tombstone before any []
      if (!scoutSawNonEmpty.current) return;   // mount echo / failed read — do NOT write [] over good data
      localStorage.setItem('scout:buffer', '[]');   // genuine emptying after a real commit
    } catch { /* quota/private */ }
  }, [scoutBuffer]);
  const scoutBufferedIds = useMemo(() => new Set(scoutBuffer.map(c => c.id)), [scoutBuffer]);
  // Post ids that already have a workspace reel — excluded from a ledger restore (they're done).
  const scoutBuiltPostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) {
      const url = framingMap[e.id]?.redditThread?.url;
      const pid = url ? postIdFromUrl(url) : null;
      if (pid) ids.add(pid);
    }
    return ids;
  }, [entries, framingMap]);

  const scoutBufferAdd = useCallback((c: ScoutCandidate) => {
    setScoutBuffer(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c]));
  }, []);

  const scoutBufferRemove = useCallback((id: string) => {
    setScoutBuffer(prev => prev.filter(c => c.id !== id));
  }, []);

  // ── Scout → Import handoff. "Send N to Import" queues the approved urls for the bulk builder, which
  // auto-imports them (full comment trees — richer than anything the Scout captured). The buffer releases
  // a post only at BUILD time (release-at-build: builder threads are NOT reload-durable, a grid reel is) —
  // so a failed import, a reload before Build, or a Start-over all leave the post buffered for a clean
  // re-send (its ledger row already says 'used'; the builder dedups a re-sent thread that's still there).
  const [scoutImportQueue, setScoutImportQueue] = useState<string[] | null>(null);
  const [scoutHandoffRunning, setScoutHandoffRunning] = useState(false);
  const scoutQueuedCountRef = useRef(0);
  const sendScoutToImport = useCallback(() => {
    if (!scoutBuffer.length) return;
    scoutQueuedCountRef.current = scoutBuffer.length;
    setScoutImportQueue(scoutBuffer.map(c => c.permalink));
    setScoutOpen(false);
    setBulkOpen(true);
  }, [scoutBuffer]);
  // Import finished (or failed): clear the running pulse and surface failures — visible even if the
  // builder was closed mid-import (its internal error line wouldn't be).
  const onScoutQueueDone = useCallback((presentUrls: string[]) => {
    setScoutHandoffRunning(false);
    const failed = scoutQueuedCountRef.current - presentUrls.length;
    if (failed > 0) setBatchNotice(`${failed} approved post${failed === 1 ? '' : 's'} failed to import — still buffered in Scout for a re-send.`);
  }, []);
  // Release-at-build: exactly the threads that now HAVE a grid reel leave the buffer (tested lib fn).
  const releaseScoutForBuilt = useCallback((builtUrls: string[]) => {
    if (builtUrls.length) setScoutBuffer(prev => releaseByUrls(prev, builtUrls));
  }, []);

  // ── Bulk pipeline (stages-as-nodes) — pure status derivation lives in '@/lib/pipelineStatus' (tested) ──
  const pipelineStages = useMemo(
    () => [
      // The Scout source node — its status is the discovery funnel, not reel counts.
      {
        key: 'scout' as const,
        done: scoutBuffer.length,
        total: scoutBuffer.length,
        running: scoutImportQueue !== null || scoutHandoffRunning,   // handoff queued or importing
        statusLine: `${scoutNewCount} new · ${scoutBuffer.length} buffered`,
      },
      ...computePipelineStages(entries, framingMap, { batchOp, batchProgress, isDownloadingAll, downloadProgress }),
    ],
    [entries, framingMap, batchOp, batchProgress, isDownloadingAll, downloadProgress, scoutBuffer.length, scoutImportQueue, scoutNewCount],
  );
  const pipelineTotalReels = pipelineStages.find(s => s.key === 'import')?.total ?? 0;   // NOT [0] — scout leads now
  const pipelineMusicId = useMemo(() => computePipelineMusicId(entries, framingMap), [entries, framingMap]);

  const applyMusicToAll = useCallback((id: string | null) => {
    if (exportBusy) return;                              // don't change a reel's music mid-export
    setFramingMap(prev => {
      const next = { ...prev };
      for (const e of entries) {
        if ((prev[e.id]?.overlays ?? []).some(o => o.name === 'Reddit thread')) next[e.id] = { ...prev[e.id], musicId: id ?? '' };
      }
      return next;
    });
    markFramingDirty();
  }, [entries, setFramingMap, markFramingDirty, exportBusy]);

  // Re-roll a fresh random library clip for every Reddit reel (clear-then-set: drop data/videoUrl + set the
  // new footage url so the auto-fetch re-resolves it). No-op without setEntries (non-workspace host).
  const shuffleAllFootage = useCallback(async () => {
    if (!setEntries || exportBusy) return;                              // don't swap footage mid-export
    const segs = await fetchFootageManifest().catch(() => [] as FootageSegment[]);
    if (!segs.length) return;
    setEntries(prev => prev.map(e => {
      const isReddit = (framingMap[e.id]?.overlays ?? []).some(o => o.name === 'Reddit thread');
      if (!isReddit || e.localVideoSrc) return e;                       // skip uploaded reels (url='' → IndexedDB restore) + non-Reddit
      const pool = segs.filter(s => s.url !== e.url);                   // exclude the current clip → always a real change (no same-url no-op)
      const pick = (pool.length ? pool : segs)[Math.floor(Math.random() * (pool.length || segs.length))];
      autoFetched.current.delete(e.id);                                // clear the "already fetched this url" guard so it re-resolves
      return { ...e, url: pick.url, data: null, videoUrl: undefined };
    }));
  }, [setEntries, framingMap, exportBusy]);

  // The reel canvas stays mounted (just hidden) in Pipeline view, so pause it on entry — otherwise a reel
  // left playing (via the timeline) keeps its video/narration/music audio looping with no visible control.
  useEffect(() => { if (pipelineView) canvasRefsMap.current.get(displayId)?.pause(); }, [pipelineView, displayId, canvasRefsMap]);

  const runPipelineStage = useCallback((key: StageKey) => {
    if (key === 'footage') void shuffleAllFootage();
    else if (key === 'narrate') void batchGenerateNarration();
    else if (key === 'copy') void batchGenerateCopy();
    else if (key === 'export') void downloadAllReels();
  }, [shuffleAllFootage, batchGenerateNarration, batchGenerateCopy, downloadAllReels]);

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
    // Footage reels stream from our own R2 (URLs never expire) and are large ~100MB clips — eagerly
    // full-downloading one into a blob just to view/narrate stalls the pipeline (and a batch cycling every
    // reel would download them all). Skip: footage streams via <video> and is fetched in full only at
    // export. This pre-download stays ONLY for expiring TikTok/IG/X CDN links, where caching bytes early
    // guards against the link 403-ing before export.
    if (isFootageUrl(e.url) || isFootageUrl(e.data.hdplay || e.data.play || '')) return;
    if (videoBlobUrls[e.id] || blobFetchingRef.current.has(e.id)) return;
    const proxyUrl = bestVideoUrl(e.data);
    if (!proxyUrl) return;
    blobFetchingRef.current.add(e.id);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(proxyUrl);
        if (cancelled) return;
        // This is the only load a deferred LINK reel gets (footage/uploads early-return above). A dead
        // response = the TikTok/IG/X CDN URL expired — flag it so the reel goes videoFailed, which re-enables
        // the Fetch button + auto-fetch so the user can re-scrape. (Was a silent return before deferral.)
        if (!res.ok) { onHandleVideoError(e.id); return; }
        const blobUrl = URL.createObjectURL(await res.blob());
        if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
        setVideoBlobUrls(prev => {
          if (prev[e.id]) { URL.revokeObjectURL(blobUrl); return prev; }
          return { ...prev, [e.id]: blobUrl };
        });
      } catch { if (!cancelled) onHandleVideoError(e.id); }
      finally { blobFetchingRef.current.delete(e.id); }
    })();
    return () => { cancelled = true; };
  }, [selectedEntry, videoBlobUrls, onHandleVideoError]);

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
      {selectedEntry && !pipelineView && (
        <ElementRail
          categories={[
            { id: 'link', label: 'Video link', icon: linkGlyph, content: (
              <ReelLinkFlyout
                entry={selectedEntry}
                onUpdateField={(f, v) => recordEdit(selectedEntry.id, f, v)}
                onUpdateLocalVideo={(s, n) => onUpdateLocalVideo(selectedEntry.id, s, n)}
                onFetch={() => onFetchVideo(selectedEntry.id)}
                onPickFootage={seg => {
                  // Replace whatever the reel currently holds (upload or link) with the picked segment:
                  // clear the local video + data, drop the auto-fetch guard so re-picking a previously
                  // used segment still fetches, then set the URL — the auto-fetch effect does the rest.
                  onUpdateLocalVideo(selectedEntry.id, '', '');
                  autoFetched.current.delete(selectedEntry.id);
                  recordEdit(selectedEntry.id, 'url', seg.url);
                  // Pre-warm the blob cache so the timeline's filmstrip (which needs the whole file)
                  // opens instantly by the time the user gets there. Same key the canvas/timeline use:
                  // bestVideoUrl(footageVideoData(url)) resolves to proxyStreamUrl(url).
                  void getVideoBlob(proxyStreamUrl(seg.url));
                }}
                autoRandom={autoRandomFootage}
                onAutoRandomChange={setAutoRandomFootage}
              />
            ) },
            { id: 'reddit', label: 'Reddit thread', icon: redditGlyph, width: 420, content: (
              <RedditFlyout
                key={selectedEntry.id}
                saved={framingMap[selectedEntry.id]?.redditThread ?? null}
                onSaveThread={t => {
                  // Re-pointing the reel to a different thread invalidates the build-time thread cache (copy
                  // must re-import the new url). Read the prior url from the live ref, not a stale closure.
                  if (framingMapRef.current[selectedEntry.id]?.redditThread?.url !== t?.url) threadCacheRef.current.delete(selectedEntry.id);
                  setFramingMap(prev => ({ ...prev, [selectedEntry.id]: { ...prev[selectedEntry.id], redditThread: t ?? undefined } }));
                  markFramingDirty();
                }}
                hasVideo={!!(selectedEntry.localVideoSrc || selectedEntry.data || selectedEntry.videoUrl)}
                onAdd={(blob, lines, dims, blockAuthors) => addRedditCard(selectedEntry.id, blob, lines, dims, blockAuthors)}
              />
            ) },
            { id: 'yt-copy', label: 'YouTube copy', icon: ytCopyGlyph, width: 340, content: (
              <YtCopyFlyout
                key={selectedEntry.id}
                threadUrl={framingMap[selectedEntry.id]?.redditThread?.url ?? null}
                threadEdits={framingMap[selectedEntry.id]?.redditThread?.edits}
                ytTitle={framingMap[selectedEntry.id]?.ytTitle ?? ''}
                onYtTitleChange={t => {
                  setFramingMap(prev => ({ ...prev, [selectedEntry.id]: { ...prev[selectedEntry.id], ytTitle: t || undefined } }));
                  markFramingDirty();
                }}
                description={framingMap[selectedEntry.id]?.description ?? ''}
                onDescriptionChange={d => {
                  setFramingMap(prev => ({ ...prev, [selectedEntry.id]: { ...prev[selectedEntry.id], description: d || undefined } }));
                  markFramingDirty();
                }}
              />
            ) },
            { id: 'music', label: 'Background music', icon: musicGlyph, content: (
              <div className="flex flex-col gap-0.5">
                {[null, ...BACKGROUND_TRACKS].map(t => {
                  const active = resolveMusicId(framingMap[selectedEntry.id]?.musicId) === (t?.id ?? null);
                  return (
                    <button
                      key={t?.id ?? 'none'}
                      type="button"
                      onClick={() => {
                        // '' is the explicit "No music" choice (distinct from unset, which defaults to a track).
                        setFramingMap(prev => ({ ...prev, [selectedEntry.id]: { ...prev[selectedEntry.id], musicId: t?.id ?? '' } }));
                        markFramingDirty();
                      }}
                      className={`flex items-center gap-2 px-1.5 h-8 rounded-sm text-body text-left transition-colors focus-ring ${
                        active ? 'bg-active text-fg' : 'text-fg-2 hover:text-fg hover:bg-hover'
                      }`}
                    >
                      <span className="flex-1 truncate">{t?.name ?? 'No music'}</span>
                      {active && <CheckIcon size={11} className="shrink-0" />}
                    </button>
                  );
                })}
                {resolveMusicId(framingMap[selectedEntry.id]?.musicId) && (
                  <label className="flex items-center gap-2 pt-1.5">
                    <span className="text-caption text-fg-3 shrink-0">Volume</span>
                    <input
                      type="range" min={0} max={0.5} step={0.01}
                      value={framingMap[selectedEntry.id]?.musicVolume ?? DEFAULT_MUSIC_VOLUME}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setFramingMap(prev => ({ ...prev, [selectedEntry.id]: { ...prev[selectedEntry.id], musicVolume: v } }));
                        markFramingDirty();
                      }}
                      className="flex-1 min-w-0 accent-[var(--color-accent,#46d160)]"
                    />
                    <span className="text-caption text-fg-2 w-9 text-right">
                      {Math.round((framingMap[selectedEntry.id]?.musicVolume ?? DEFAULT_MUSIC_VOLUME) * 100)}%
                    </span>
                  </label>
                )}
                <span className="text-caption text-fg-3 pt-1">Loops quietly under the narration — in preview and in the export.</span>
              </div>
            ) },
            { id: 'narrate', label: 'Narration', icon: micGlyph, content: (
              <NarrateFlyout
                overlays={overlaysMap[selectedEntry.id] ?? []}
                voices={narrationVoices}
                onVoicesChange={setNarrationVoices}
                brushId={voiceBrushId}
                onBrushChange={setVoiceBrushId}
                voiceColors={narrationVoiceColors}
                speed={narrationSpeed}
                onSpeedChange={setNarrationSpeed}
                voiceGains={voiceGains}
                onVoiceGainsChange={setVoiceGains}
                onGenerate={(overlayId, apiKey, onStatus) => generateNarration(selectedEntry.id, overlayId, apiKey, onStatus)}
                onClearNarration={overlayId => canvasRefsMap.current.get(selectedEntry.id)?.clearOverlayNarration(overlayId)}
                onShuffleVoices={overlayId => shuffleRedditVoices(selectedEntry.id, overlayId)}
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
        <div className="flex items-center gap-2">
          {viewToggle}
          {/* Canvas ⇄ Pipeline (bulk stages-as-nodes) view switch */}
          <div className="flex items-center rounded-full border border-line p-0.5">
            {(['canvas', 'pipeline'] as const).map(m => (
              <button key={m} type="button" onClick={() => setPipelineView(m === 'pipeline')}
                className={`focus-ring rounded-full px-2.5 py-1 text-caption capitalize transition-colors ${
                  (m === 'pipeline') === pipelineView ? 'bg-active text-fg font-medium' : 'text-fg-3 hover:text-fg'}`}>
                {m}
              </button>
            ))}
          </div>
          <ThemeToggle />
        </div>

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
          {/* Live batch-generation status (detailed per-reel step) and post-run summary. */}
          {batchOp && (
            <span className="flex items-center gap-1.5 text-caption text-fg-2 whitespace-nowrap max-w-[440px] truncate" title={batchProgress.status}>
              {batchProgress.status || `${batchProgress.done}/${batchProgress.total}`}
            </span>
          )}
          {batchNotice && (
            <span className="flex items-center gap-1.5 text-caption text-fg-2 whitespace-nowrap">
              {batchNotice}
              <button type="button" onClick={() => setBatchNotice(null)} aria-label="Dismiss" className="text-fg-4 hover:text-fg focus-ring rounded-xs">×</button>
            </span>
          )}
          {reelCapNotice && (
            <span className="flex items-center gap-1.5 text-caption text-fg-2 whitespace-nowrap">
              {reelCapNotice}
              <button type="button" onClick={() => setReelCapNotice(null)} aria-label="Dismiss" className="text-fg-4 hover:text-fg focus-ring rounded-xs">×</button>
            </span>
          )}
          <AutosaveChip state={reelSaveState} />
          {/* Download just the on-screen reel — keeps its live crop/pan/zoom. (Canvas view only.) */}
          {showVideoControls && selectedEntry && !pipelineView && (
            <Button
              variant="primary"
              size="sm"
              loading={downloadingOne}
              onClick={async () => {
                if (exportBusy) return;
                const id = selectedEntry.id;
                setDownloadingOne(true);
                // Surface a failure in the toolbar: the canvas status only shows WHILE recording, so an
                // export that throws (e.g. the clip fetch 502s / a link URL expired) would otherwise fail
                // completely silently — no file, no message. setDownloadNotice paints a dismissible line.
                try { await exportGuard.guard(`reel:${id}`, () => canvasRefsMap.current.get(id)?.startDownload()); }
                catch (err) { console.error('[reel download]', err); setDownloadNotice(err instanceof Error ? err.message : 'Export failed — please try again.'); }
                finally { setDownloadingOne(false); }
              }}
              disabled={exportBusy}
              leadingIcon={<DownloadIcon size={13} />}
              className="rounded-full"
            >
              Download
            </Button>
          )}
          {onAddReels && !pipelineView && (
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)} className="rounded-full">
              Bulk build
            </Button>
          )}
          {/* One-click pipeline (Run all) + the individual batch steps for every Reddit reel, with live
              progress + cancel. Run all chains narrate → copy → download; each step reports its own count. */}
          {entries.some(e => framingMap[e.id]?.overlays?.some(o => o.name === 'Reddit thread')) && !pipelineView && (
            <>
              <Button variant="primary" size="sm" onClick={() => void runAll()} disabled={exportBusy || runningAll} className="rounded-full">
                {runningAll
                  ? (batchOp === 'narration' ? `Narrating ${batchProgress.done}/${batchProgress.total}…`
                    : batchOp === 'copy' ? `Writing copy ${batchProgress.done}/${batchProgress.total}…`
                    : isDownloadingAll ? `Exporting ${downloadProgress.done}/${downloadProgress.total}…`
                    : 'Running…')
                  : 'Run all'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void batchGenerateCopy()} disabled={exportBusy || !!batchOp || runningAll} className="rounded-full">
                {batchOp === 'copy' && !runningAll ? `Writing copy ${batchProgress.done}/${batchProgress.total}…` : 'Generate copy (all)'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void batchGenerateNarration()} disabled={exportBusy || !!batchOp || runningAll} className="rounded-full">
                {batchOp === 'narration' && !runningAll ? `Narrating ${batchProgress.done}/${batchProgress.total}…` : 'Generate narration (all)'}
              </Button>
              {/* Cancel is only meaningful in the narrate/copy phases (batchOp set); once Run all reaches the
                  export phase it runs to completion — show a static hint so the control slot doesn't just vanish. */}
              {batchOp ? (
                <button type="button" onClick={() => { batchCancelRef.current = true; }} className="text-caption text-fg-3 hover:text-fg underline underline-offset-2">Cancel</button>
              ) : runningAll && isDownloadingAll ? (
                <span className="text-caption text-fg-3">Export can’t be cancelled</span>
              ) : null}
            </>
          )}
          {/* Download every reel (cycles through them); only shown when there's more than one. (Canvas view only.) */}
          {videoRenderEntries.length > 1 && !pipelineView && (
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadAllReels}
              disabled={exportBusy || !!batchOp || runningAll}
              leadingIcon={<DownloadIcon size={13} />}
              className="rounded-full"
            >
              {isDownloadingAll && !runningAll ? `Downloading ${downloadProgress.done}/${downloadProgress.total}…` : 'Download All'}
            </Button>
          )}
        </div>
      </div>
      {/* Always mounted (renders null while closed) so pasted links, imported threads, and selections
          survive closing and reopening the panel. */}
      <BulkBuilder
        open={bulkOpen} onClose={() => setBulkOpen(false)} speed={narrationSpeed}
        onBuild={async ts => {
          const r = await buildReelsFromThreads(ts);
          releaseScoutForBuilt(r.builtUrls);   // release-at-build: reels exist for exactly these urls now
          return r;
        }}
        queuedUrls={scoutImportQueue}
        onQueueConsumed={() => { setScoutImportQueue(null); setScoutHandoffRunning(true); }}
        onQueueDone={onScoutQueueDone}
      />
      {/* Reddit Scout — the wide review panel opened from the pipeline's Scout node. */}
      <ScoutPanel
        open={scoutOpen}
        onClose={() => setScoutOpen(false)}
        bufferCount={scoutBuffer.length}
        bufferedIds={scoutBufferedIds}
        onBuffer={scoutBufferAdd}
        onUnbuffer={scoutBufferRemove}
        onSendToImport={sendScoutToImport}
        builtPostIds={scoutBuiltPostIds}
        onNewCount={setScoutNewCount}
      />

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

      {/* Bulk pipeline view (stages-as-nodes) — shown in place of the reel canvas while active. The reel
          canvas stays MOUNTED (just hidden) so the current reel's live framing isn't lost on the switch. */}
      {pipelineView && (
        <PipelineView
          stages={pipelineStages}
          totalReels={pipelineTotalReels}
          runningAll={runningAll}
          busy={exportBusy || runningAll}
          onRunAll={runAll}
          onRunStage={runPipelineStage}
          onOpenBulkBuilder={() => setBulkOpen(true)}
          onOpenScout={() => setScoutOpen(true)}
          musicTracks={BACKGROUND_TRACKS}
          currentMusicId={pipelineMusicId}
          onPickMusic={applyMusicToAll}
          narrationSpeeds={NARRATION_SPEEDS}
          narrationSpeed={narrationSpeed}
          onNarrationSpeed={setNarrationSpeed}
        />
      )}
      {/* ── Reel canvas — one reel at a time, like the carousels editor (switch via the docked strip) ── */}
      <div
        ref={attachScroll}
        className={`flex-1 overflow-auto overscroll-contain no-native-scrollbar flex flex-col [align-items:safe_center] [justify-content:safe_center]${pipelineView ? ' hidden' : ''}`}
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
                          exportTitle={framingMap[entry.id]?.ytTitle}
                          musicId={resolveMusicId(framingMap[entry.id]?.musicId)}
                          musicVolume={framingMap[entry.id]?.musicVolume ?? null}
                          onFramingChange={markFramingDirty}
                          onOverlaysChange={list => setOverlaysMap(prev => ({ ...prev, [entry.id]: list }))}
                          ocrBrush={voiceBrush}
                          ocrVoiceColors={narrationVoiceColors}
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
        {timelineStripShown && !pipelineView && (
          showVideoControls ? (
            <VideoControlsBar
              entryId={selectedEntry!.id}
              activeRef={activeVideoRef}
              recordingState={activeRecordingState}
              videoSrc={activeVideoSrc}
              overlays={overlaysMap[selectedEntry!.id] ?? []}
              voiceColors={narrationVoiceColors}
              voiceNames={castVoiceNames}
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
      {!timelineStripShown && !pipelineView && (
      <div className="fixed bottom-4 z-30 flex justify-center pointer-events-none" style={{ left: 'var(--rail-w, 0px)', right: 0 }}>
        {/* Cap the strip to the canvas region so it stays centred under the reel. */}
        <div className="pointer-events-auto" style={{ maxWidth: 'calc(100% - 20%)' }}>
          <SlidesStrip
            slides={entries.map(e => {
              const rs = recordingStateMap[e.id];
              // The on-screen reel's LIVE overlays (audioDuration once narrated, enabled ocrLines as toggled)
              // live in overlaysMap; framingMap is only re-snapshotted when you switch reels. Read the live copy
              // for the displayed reel so the badge reacts to narrate/clear + line toggles immediately; every
              // other reel (canvas unmounted) falls back to its already-fresh framingMap snapshot.
              // Trust the live list whenever it exists (arrays are truthy, so an empty [] — overlay removed —
              // correctly clears the badge instead of falling back to the stale snapshot). undefined (canvas
              // not mounted yet) falls back to framingMap.
              const live = e.id === displayId ? overlaysMap[e.id] : undefined;
              const framing = live ? ({ ...framingMap[e.id], overlays: live } as Framing) : framingMap[e.id];
              const dur = reelDurationInfo(framing, narrationSpeed);
              const over = !!dur && dur.seconds > SHORTS_MAX_SECONDS;
              return {
                id: e.id, name: reelNameMap[e.id] ?? '',
                progress: rs?.isRecording ? rs.recProgress : undefined,
                // Ceil an over-limit value so the red pill never prints "3:00" (a floored 180.4s) — that would
                // read as at-limit while colored over. In-limit values stay floored (179.6s → "2:59", not "3:00").
                duration: dur ? { label: (dur.estimated ? '~' : '') + fmtTime(over ? Math.ceil(dur.seconds) : dur.seconds), over } : undefined,
              };
            })}
            activeSlideId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => void handleAddRow()}
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
      {active && !pipelineView && (
        <EditorScrollBar
          targetRef={scrollRef}
          zoom={fitFactor * viewScale}
          extent={Math.max(0, 1 - (viewScale - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN))}
          style={{ left: 'var(--rail-w, 0px)', right: 0 }}
        />
      )}

      {/* Bottom-left zoom box — hidden while the reel timeline is open (it would overlap the timeline). */}
      {!timelineStripShown && !pipelineView && (
        <ZoomControl value={fitFactor * viewScale} min={fitFactor * ZOOM_MIN} max={fitFactor * ZOOM_MAX} resetTo={1} onChange={v => { captureFocal(); setViewScale(v / fitFactor); }} />
      )}
    </div>
  );
}
