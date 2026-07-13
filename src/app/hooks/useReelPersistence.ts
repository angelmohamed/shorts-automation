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
    framing: (o.framing && typeof o.framing === 'object' ? o.framing : {}) as Framing,
  };
}
