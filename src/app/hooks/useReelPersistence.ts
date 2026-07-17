'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveState } from '../components/AutosaveChip';
import type { Framing } from '../components/TikTokCanvas/types';

// One saved reel = one grid row, persisted as plain numbers/strings (never the video bytes). The whole
// grid is stored as a single JSON array in localStorage — fully client-side, no backend involved.
export interface SavedReel {
  id: string;
  name: string;                  // optional user label ('' = unnamed)
  mode: 'twitter' | 'caption';
  url: string;                   // pasted link (re-fetched on load); empty for uploads
  videoUrl: string;              // kept for shape-compat with the original schema (always '' here)
  posterUrl: string;             // ditto
  caption: string;
  templateId: string | null;     // inherited reel template → text boxes / pfp / positions
  framing: Framing;              // crop / pan / zoom / trim
}

const STORAGE_KEY = 'reels:grid';
const DEBOUNCE_MS = 800;

export function useReelPersistence(userId: string | null | undefined) {
  const [fetched, setFetched] = useState(false);
  const [initialRows, setInitialRows] = useState<SavedReel[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRows = useRef<SavedReel[] | null>(null);   // latest pending rows, flushed on unmount

  const loaded = fetched || !userId;

  // localStorage can't transiently fail the way a network read can, so load errors don't happen here.
  const retryLoad = useCallback(() => {}, []);

  useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const rows = (Array.isArray(parsed) ? parsed : []).map(normalizeReel).filter((r): r is SavedReel => r !== null);
      setInitialRows(rows);
    } catch {
      setInitialRows([]);
    }
    setFetched(true);
  }, [userId]);

  const flush = useCallback((rows: SavedReel[]) => {
    setSaveState('saving');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
    if (revert.current) clearTimeout(revert.current);
    revert.current = setTimeout(() => setSaveState(prev => (prev === 'saved' ? 'idle' : prev)), 1500);
  }, []);

  // Debounced autosave — call on any change (link/caption/mode/template/framing).
  const scheduleSave = useCallback((rows: SavedReel[]) => {
    if (!userId) return;
    lastRows.current = rows;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { debounce.current = null; flush(rows); }, DEBOUNCE_MS);
  }, [userId, flush]);

  // Flush a pending (still-debounced) save synchronously — safe outside React.
  const flushPending = useCallback(() => {
    if (!debounce.current) return;
    clearTimeout(debounce.current);
    debounce.current = null;
    const rows = lastRows.current;
    if (rows) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
    }
  }, []);

  // Flush on unmount and on tab-close / backgrounding.
  useEffect(() => () => {
    if (revert.current) clearTimeout(revert.current);
    flushPending();
  }, [flushPending]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPending(); };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushPending]);

  return { loaded, loadError: false, retryLoad, initialRows, saveState, scheduleSave };
}

function normalizeReel(r: unknown): SavedReel | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name : '',
    mode: o.mode === 'caption' ? 'caption' : 'twitter',
    url: typeof o.url === 'string' ? o.url : '',
    videoUrl: typeof o.videoUrl === 'string' ? o.videoUrl : '',
    posterUrl: typeof o.posterUrl === 'string' ? o.posterUrl : '',
    caption: typeof o.caption === 'string' ? o.caption : '',
    templateId: typeof o.templateId === 'string' ? o.templateId : null,
    framing: normalizeFraming(o.framing),
  };
}

// Coerce a persisted `framing` blob into a shape the draw loop / effects can consume without throwing.
// The reel row itself is validated (normalizeReel), but framing was previously cast through with only a
// `typeof === 'object'` check — so a legacy/corrupt blob could feed a non-array `overlays`/`reveals`/
// `ocrLines` into `.map`, a NaN `musicVolume` into `<audio>.volume` (RangeError), or a wrong-typed
// `redditThread` into the flyout. This drops/repairs each internal so restore is total for any shape.
// Recognised fields are copied through unchanged when valid — a well-formed framing round-trips intact.
function num(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }
function normalizeFraming(f: unknown): Framing {
  if (!f || typeof f !== 'object') return {};
  const o = f as Record<string, unknown>;
  const out: Framing = {};
  if (o.box && typeof o.box === 'object') out.box = o.box as Framing['box'];
  if (o.videoOffset && typeof o.videoOffset === 'object') out.videoOffset = o.videoOffset as Framing['videoOffset'];
  const vs = num(o.videoScale); if (vs !== undefined) out.videoScale = vs;
  const ts = num(o.trimStart);  if (ts !== undefined) out.trimStart = ts;
  const te = num(o.trimEnd);    if (te !== undefined) out.trimEnd = te;
  if (typeof o.includeEdit === 'boolean') out.includeEdit = o.includeEdit;
  if (Array.isArray(o.segments)) {
    out.segments = (o.segments as unknown[]).filter((s): s is { start: number; end: number } =>
      !!s && typeof s === 'object' && Number.isFinite((s as { start?: unknown }).start) && Number.isFinite((s as { end?: unknown }).end));
  }
  if (Array.isArray(o.overlays)) {
    out.overlays = (o.overlays as unknown[])
      .filter((ov): ov is Record<string, unknown> => !!ov && typeof ov === 'object')
      .map(ov => {
        const n: Record<string, unknown> = { ...ov };   // keep id/name/geometry/audio fields as-is
        // Only the array-typed internals the draw loop / narration iterate are sanitised, so a
        // non-array (or array-with-holes) can never reach `.map`/index access at draw time.
        n.reveals = Array.isArray(ov.reveals)
          ? (ov.reveals as unknown[]).filter((r): r is { t: number; h: number } =>
              !!r && typeof r === 'object' && Number.isFinite((r as { t?: unknown }).t) && Number.isFinite((r as { h?: unknown }).h))
          : undefined;
        n.ocrLines    = Array.isArray(ov.ocrLines)    ? (ov.ocrLines as unknown[]).filter(l => !!l && typeof l === 'object') : undefined;
        n.blockAuthors= Array.isArray(ov.blockAuthors)? (ov.blockAuthors as unknown[]).filter(a => typeof a === 'string')     : undefined;
        n.audioTakes  = Array.isArray(ov.audioTakes)  ? (ov.audioTakes as unknown[]).filter(t => !!t && typeof t === 'object'): undefined;
        return n;
      }) as Framing['overlays'];
  }
  if (typeof o.musicId === 'string') out.musicId = o.musicId;
  const mv = num(o.musicVolume); if (mv !== undefined) out.musicVolume = Math.min(1, Math.max(0, mv));
  if (typeof o.ytTitle === 'string') out.ytTitle = o.ytTitle;
  if (typeof o.description === 'string') out.description = o.description;
  if (o.redditThread && typeof o.redditThread === 'object') {
    const rt = o.redditThread as Record<string, unknown>;
    if (typeof rt.url === 'string') {
      out.redditThread = {
        url: rt.url,
        comments: Array.isArray(rt.comments) ? (rt.comments as unknown[]).filter((n): n is number => Number.isFinite(n)) : undefined,
        paras:    Array.isArray(rt.paras)    ? (rt.paras as unknown[]).filter((n): n is number => Number.isFinite(n))    : undefined,
      };
      // Pick-stage TEXT edits: sanitise to non-empty-string-valued, non-negative-integer-keyed records
      // so a legacy/corrupt blob can never feed junk into the card/copy edit application.
      if (rt.edits && typeof rt.edits === 'object' && !Array.isArray(rt.edits)) {
        const ed = rt.edits as Record<string, unknown>;
        const rec = (v: unknown): Record<number, string> | undefined => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
          const r: Record<number, string> = {};
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            // Strict digit-key check — Number('') === 0 would smuggle an empty-string key in as index 0.
            if (/^\d+$/.test(k) && typeof val === 'string' && val.trim()) r[Number(k)] = val;
          }
          return Object.keys(r).length ? r : undefined;
        };
        const edits: NonNullable<Framing['redditThread']>['edits'] = {};
        if (typeof ed.title === 'string' && ed.title.trim()) edits.title = ed.title;
        const pe = rec(ed.paras);       if (pe) edits.paras = pe;
        const ce = rec(ed.comments);    if (ce) edits.comments = ce;
        const po = rec(ed.paraOrig);    if (po) edits.paraOrig = po;      // drift anchors ride along
        const co = rec(ed.commentOrig); if (co) edits.commentOrig = co;
        if (edits.title || edits.paras || edits.comments) out.redditThread.edits = edits;
      }
    }
  }
  return out;
}
