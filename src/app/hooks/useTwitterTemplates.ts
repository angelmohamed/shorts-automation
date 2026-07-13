'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TwitterTemplateSettings } from '../components/twitterTemplateTypes';
import { defaultTwitterTemplateSettings, resolveTwitterTemplateSettings } from '../components/twitterTemplateTypes';
import type { SaveState } from '../components/AutosaveChip';

export interface TwitterTemplate {
  id: string;
  name: string;
  position: number;
  settings: TwitterTemplateSettings;
}

interface History { past: TwitterTemplateSettings[]; future: TwitterTemplateSettings[]; }
const HISTORY_LIMIT = 100;
const STORAGE_KEY = 'reels:templates';

// Client-side reel overlay templates, persisted to localStorage (same API surface as the original
// supabase-backed hook). First run seeds one default template so the reels canvas works immediately.

function readStored(): TwitterTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .filter(t => typeof t.id === 'string' && typeof t.name === 'string')
      .map((t, i) => ({
        id: t.id as string,
        name: t.name as string,
        position: typeof t.position === 'number' ? t.position : i,
        settings: resolveTwitterTemplateSettings(t.settings as Partial<TwitterTemplateSettings> | null),
      }));
  } catch {
    return [];
  }
}

function writeStored(templates: TwitterTemplate[]): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); return true; }
  catch { return false; }
}

function newId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// `_userId` is kept for call-site compatibility with the original hook; storage is browser-local.
export function useTwitterTemplates(_userId: string | null) {
  const [templates, setTemplates] = useState<TwitterTemplate[]>([]);
  const [loading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [, setHistTick] = useState(0);

  const templatesRef = useRef<TwitterTemplate[]>([]);
  useEffect(() => { templatesRef.current = templates; }, [templates]);

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const savedRevertRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<Map<string, History>>(new Map());
  const pendingBaseRef = useRef<Map<string, TwitterTemplateSettings>>(new Map());

  useEffect(() => {
    let stored = readStored();
    if (stored.length === 0) {
      // First run: seed one default template so the reels canvas has an overlay style to use.
      stored = [{ id: newId(), name: 'Reels Template 1', position: 0, settings: defaultTwitterTemplateSettings() }];
      writeStored(stored);
    }
    setTemplates(stored);
    setLoaded(true);
  }, []);

  // Persist the whole list, driving the autosave chip ('saving' → 'saved' → 'idle').
  const persist = useCallback((next: TwitterTemplate[]) => {
    setSaveState('saving');
    const ok = writeStored(next);
    setSaveState(ok ? 'saved' : 'error');
    if (!ok) setError('Could not save templates to browser storage.');
    if (savedRevertRef.current) clearTimeout(savedRevertRef.current);
    savedRevertRef.current = setTimeout(() => setSaveState(prev => (prev === 'saved' ? 'idle' : prev)), 1500);
  }, []);

  const commit = useCallback((next: TwitterTemplate[]) => {
    setTemplates(next);
    templatesRef.current = next;
    persist(next);
  }, [persist]);

  const createTemplate = useCallback(async (): Promise<TwitterTemplate | null> => {
    let max = 0;
    for (const t of templatesRef.current) {
      const m = /^Reels Template (\d+)$/.exec(t.name.trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
    const created: TwitterTemplate = {
      id: newId(),
      name: `Reels Template ${max + 1}`,
      position: templatesRef.current.length,
      settings: defaultTwitterTemplateSettings(),
    };
    commit([...templatesRef.current, created]);
    return created;
  }, [commit]);

  const duplicateTemplate = useCallback(async (id: string): Promise<TwitterTemplate | null> => {
    const src = templatesRef.current.find(t => t.id === id);
    if (!src) return null;
    const created: TwitterTemplate = {
      id: newId(),
      name: `${src.name} copy`,
      position: templatesRef.current.length,
      settings: src.settings,
    };
    commit([...templatesRef.current, created]);
    return created;
  }, [commit]);

  const renameTemplate = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (templatesRef.current.some(t => t.id !== id && t.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError('That name is already taken.');
      return;
    }
    commit(templatesRef.current.map(t => (t.id === id ? { ...t, name: trimmed } : t)));
  }, [commit]);

  const deleteTemplate = useCallback(async (id: string) => {
    const timer = saveTimers.current.get(id);
    if (timer) { clearTimeout(timer); saveTimers.current.delete(id); }
    historyRef.current.delete(id);
    pendingBaseRef.current.delete(id);
    commit(templatesRef.current.filter(t => t.id !== id));
  }, [commit]);

  const updateSettings = useCallback((id: string, partial: Partial<TwitterTemplateSettings>) => {
    // Start an undo burst: snapshot the pre-edit settings once, until the debounce commits it.
    if (!pendingBaseRef.current.has(id)) {
      const cur = templatesRef.current.find(t => t.id === id);
      if (cur) { pendingBaseRef.current.set(id, cur.settings); setHistTick(x => x + 1); }
    }
    const next = templatesRef.current.map(t => (t.id === id ? { ...t, settings: { ...t.settings, ...partial } } : t));
    setTemplates(next);
    templatesRef.current = next;
    const timers = saveTimers.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      // Commit the burst into history (the base captured at burst start) and clear the redo stack.
      const base = pendingBaseRef.current.get(id);
      pendingBaseRef.current.delete(id);
      const current = templatesRef.current.find(t => t.id === id);
      if (base && current) {
        const h = historyRef.current.get(id) ?? { past: [], future: [] };
        h.past.push(base);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
        h.future = [];
        historyRef.current.set(id, h);
      }
      persist(templatesRef.current);
    }, 500));
  }, [persist]);

  const applySettings = useCallback((id: string, settings: TwitterTemplateSettings) => {
    commit(templatesRef.current.map(t => (t.id === id ? { ...t, settings } : t)));
  }, [commit]);

  const undo = useCallback((id: string | null) => {
    if (!id) return;
    const timer = saveTimers.current.get(id);
    if (timer) { clearTimeout(timer); saveTimers.current.delete(id); }
    const current = templatesRef.current.find(t => t.id === id);
    if (!current) return;
    const h = historyRef.current.get(id) ?? { past: [], future: [] };
    const pendingBase = pendingBaseRef.current.get(id);
    if (pendingBase !== undefined) {
      // An uncommitted edit burst → revert to its base in a single step.
      pendingBaseRef.current.delete(id);
      h.future.push(current.settings);
      historyRef.current.set(id, h);
      applySettings(id, pendingBase);
      setHistTick(x => x + 1);
      return;
    }
    if (h.past.length === 0) return;
    const base = h.past.pop()!;
    h.future.push(current.settings);
    historyRef.current.set(id, h);
    applySettings(id, base);
    setHistTick(x => x + 1);
  }, [applySettings]);

  const redo = useCallback((id: string | null) => {
    if (!id) return;
    const current = templatesRef.current.find(t => t.id === id);
    if (!current) return;
    const h = historyRef.current.get(id);
    if (!h || h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push(current.settings);
    historyRef.current.set(id, h);
    applySettings(id, next);
    setHistTick(x => x + 1);
  }, [applySettings]);

  const canUndo = useCallback((id: string | null) => {
    if (!id) return false;
    if (pendingBaseRef.current.has(id)) return true;
    return (historyRef.current.get(id)?.past.length ?? 0) > 0;
  }, []);
  const canRedo = useCallback((id: string | null) => {
    if (!id) return false;
    return (historyRef.current.get(id)?.future.length ?? 0) > 0;
  }, []);

  return {
    templates, loading, loaded, error, setError, saveState,
    createTemplate, duplicateTemplate, renameTemplate, deleteTemplate, updateSettings,
    undo, redo, canUndo, canRedo,
  };
}
