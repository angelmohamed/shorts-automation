'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/Button';

// Bulk pipeline view — a fixed left→right flow of stage nodes on a pan/zoom dotted canvas, styled after the
// digital-estate automations section (square node cards, animated dashed connectors, --canvas-dot bg that
// scales+offsets with the view). Purely presentational: CanvasGrid computes the per-stage status and passes
// the run/config callbacks. Clicking a node opens a right-side config drawer that DOES that stage's work.

export type StageKey = 'scout' | 'import' | 'pick' | 'footage' | 'music' | 'narrate' | 'copy' | 'export';

export interface StageInfo {
  key: StageKey;
  done: number;
  total: number;
  running: boolean;
  progress?: { done: number; total: number } | null;
  /** Overrides the derived "n/m reels" line (the Scout node shows "N new · M buffered" instead). */
  statusLine?: string;
}

export interface PipelineViewProps {
  stages: StageInfo[];                 // in ORDER
  totalReels: number;
  runningAll: boolean;
  busy: boolean;                       // exportBusy || runningAll → disables the run actions
  onRunAll: () => void;
  onRunStage: (key: StageKey) => void; // footage / narrate / copy / export
  onOpenBulkBuilder: () => void;       // import / pick
  onOpenScout: () => void;             // the scout node opens the wide review panel, not the drawer
  musicTracks: { id: string; name: string }[];
  currentMusicId: string | null;       // representative selection (common across reels), or null
  onPickMusic: (id: string | null) => void;   // apply to all reddit reels
  narrationSpeeds: readonly number[];
  narrationSpeed: number;
  onNarrationSpeed: (s: number) => void;
}

const ORDER: StageKey[] = ['scout', 'import', 'pick', 'footage', 'music', 'narrate', 'copy', 'export'];

const svg = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

const META: Record<StageKey, { type: string; title: string; sub: string; icon: ReactNode }> = {
  scout:   { type: 'Source',    title: 'Scout',        sub: 'Discover Reddit posts',           icon: svg(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>) },
  import:  { type: 'Trigger',   title: 'Import',       sub: 'Paste & fetch Reddit threads',   icon: svg(<><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>) },
  pick:    { type: 'Transform', title: 'Pick comments', sub: 'Choose comments & paragraphs',   icon: svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>) },
  footage: { type: 'Source',    title: 'Footage',      sub: 'Assign background clips',         icon: svg(<><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></>) },
  music:   { type: 'Source',    title: 'Music',        sub: 'Add a background track',          icon: svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>) },
  narrate: { type: 'Action',    title: 'Narrate',      sub: 'ElevenLabs voice-over',           icon: svg(<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" /></>) },
  copy:    { type: 'Action',    title: 'Copy',         sub: 'YouTube title & description',     icon: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>) },
  export:  { type: 'Output',    title: 'Export',       sub: 'Render MP4s',                     icon: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>) },
};

function StageNode({ info, selected, onSelect }: { info: StageInfo; selected: boolean; onSelect: () => void }) {
  const meta = META[info.key];
  const complete = info.total > 0 && info.done >= info.total;
  const pct = info.progress && info.progress.total ? info.progress.done / info.progress.total : 0;
  const statusLine = info.running && info.progress
    ? `${info.progress.done}/${info.progress.total}…`
    : info.statusLine ?? (info.total > 0 ? `${info.done}/${info.total} reels` : meta.sub);
  return (
    <button
      type="button"
      // Stop propagation so grabbing a node neither starts a canvas pan nor bubbles into the empty-canvas
      // "deselect" click handler.
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      aria-label={`${meta.title} — ${info.total > 0 ? `${info.done} of ${info.total} reels` : meta.sub}`}
      className={`focus-ring relative flex size-[168px] shrink-0 flex-col rounded-xl border p-3.5 text-left transition-colors ${
        selected ? 'border-accent-border bg-surface-2' : 'border-line bg-surface-1 hover:border-line-strong'
      }`}
    >
      <span aria-hidden className="absolute -left-1.5 top-1/2 -translate-y-1/2 size-3 rounded-full border-2 border-line-strong bg-surface-2" />
      <span aria-hidden className="absolute -right-1.5 top-1/2 -translate-y-1/2 size-3 rounded-full border-2 border-line-strong bg-surface-2" />
      <div className="flex items-center justify-between">
        <span className="shrink-0 text-fg-3">{meta.icon}</span>
        <span
          className={`size-1.5 rounded-full ${info.running ? 'bg-accent animate-pulse' : complete ? 'bg-accent' : 'bg-fg-4'}`}
          title={info.running ? 'Running' : complete ? 'Done' : 'Idle'}
        />
      </div>
      <div className="mt-auto">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">{meta.type}</span>
        <div className="mt-0.5 text-[13px] font-semibold leading-tight text-fg">{meta.title}</div>
        <div className="mt-1 text-[11px] leading-snug text-fg-3 tabular-nums">{statusLine}</div>
        {info.running && (
          <div className="mt-1.5 h-1 rounded-full bg-hover overflow-hidden">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(4, pct * 100)}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

function Connector() {
  return (
    <div className="relative z-10 flex w-[46px] shrink-0 items-center text-fg-4" aria-hidden>
      <svg width="46" height="12" viewBox="0 0 46 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="overflow-visible">
        <path d="M0 6 H40" strokeDasharray="3 3" className="dash-flow" />
        <path d="M39 1.5l7 4.5-7 4.5z" fill="currentColor" />
      </svg>
    </div>
  );
}

const INITIAL_VIEW = { x: 56, y: 56, scale: 1 };

export function PipelineView(props: PipelineViewProps) {
  const { stages, totalReels, runningAll, busy, onRunAll, onRunStage, onOpenBulkBuilder, onOpenScout,
    musicTracks, currentMusicId, onPickMusic, narrationSpeeds, narrationSpeed, onNarrationSpeed } = props;
  const [selected, setSelected] = useState<StageKey | null>(null);
  const byKey = Object.fromEntries(stages.map(s => [s.key, s])) as Record<StageKey, StageInfo>;
  const sel = selected ? byKey[selected] : null;
  const noReels = totalReels === 0;

  // ── Pan/zoom canvas (mirrors the digital-estate automations canvas: {x,y,scale}, cursor-anchored zoom,
  //    wheel-pan, drag-pan; the dotted bg scales + offsets with the view). ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(INITIAL_VIEW);
  const pan = useRef<{ x0: number; y0: number; vx: number; vy: number } | null>(null);
  const panMoved = useRef(false);
  const clampScale = (s: number) => Math.min(2, Math.max(0.3, s));
  const zoomAt = useCallback((factor: number, center?: { x: number; y: number }) => {
    setView(v => {
      const scale = clampScale(v.scale * factor);
      if (scale === v.scale) return v;
      const rect = canvasRef.current?.getBoundingClientRect();
      const cx = center?.x ?? (rect ? rect.width / 2 : 0);
      const cy = center?.y ?? (rect ? rect.height / 2 : 0);
      const wx = (cx - v.x) / v.scale, wy = (cy - v.y) / v.scale;
      return { scale, x: cx - wx * scale, y: cy - wy * scale };
    });
  }, []);
  const resetView = () => setView(INITIAL_VIEW);

  // Wheel: ctrl/⌘ zooms toward the cursor; otherwise pans. Non-passive so we can preventDefault (else the
  // browser page would scroll / pinch-zoom).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;                    // left-drag pans (nodes stopPropagation, so we're on the bg)
    panMoved.current = false;
    pan.current = { x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y };
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const { x0, y0, vx, vy } = pan.current;
    if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 2) panMoved.current = true;
    setView(v => ({ ...v, x: vx + (e.clientX - x0), y: vy + (e.clientY - y0) }));
  };
  const onCanvasPointerUp = () => {
    // Deselect only on a click that BEGAN on the empty background (pan started here) and didn't drag. Nodes and
    // the zoom controls stopPropagation on pointerdown, so pan.current stays null for them → they never
    // deselect (this is why the deselect lives here and not in a bubbling onClick, which the zoom buttons hit).
    if (pan.current && !panMoved.current) setSelected(null);
    pan.current = null;
  };

  // Per-stage config-drawer body.
  const controls = (key: StageKey): ReactNode => {
    switch (key) {
      case 'scout':
        return null;   // unreachable — the scout node opens the wide panel, never the drawer
      case 'import':
      case 'pick':
        return (
          <>
            <Button variant="primary" size="sm" fullWidth onClick={onOpenBulkBuilder}>
              {noReels ? 'Import Reddit threads' : 'Open bulk builder'}
            </Button>
            <p className="text-caption text-fg-4">Paste thread links, then tick the comments and paragraphs to narrate. Each thread becomes a reel.</p>
          </>
        );
      case 'footage':
        return (
          <>
            <Button variant="secondary" size="sm" fullWidth disabled={busy || noReels} onClick={() => onRunStage('footage')}>Shuffle footage (all reels)</Button>
            <p className="text-caption text-fg-4">Re-rolls a random background clip for every reel from your footage library.</p>
          </>
        );
      case 'music':
        return (
          <div className="flex flex-col gap-1">
            <MusicRow label="No music" active={currentMusicId === ''} onClick={() => onPickMusic(null)} disabled={busy || noReels} />
            {musicTracks.map(t => (
              <MusicRow key={t.id} label={t.name} active={currentMusicId === t.id} onClick={() => onPickMusic(t.id)} disabled={busy || noReels} />
            ))}
            <p className="mt-1 text-caption text-fg-4">Applies the chosen track to every reel.</p>
          </div>
        );
      case 'narrate':
        return (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-caption text-fg-3">Voice speed</span>
              <div className="flex gap-1">
                {narrationSpeeds.map(s => (
                  <button key={s} type="button" onClick={() => onNarrationSpeed(s)}
                    className={`focus-ring flex-1 rounded-md border px-1.5 py-1 text-caption tabular-nums transition-colors ${
                      s === narrationSpeed ? 'border-accent-border bg-accent-tint text-fg' : 'border-line text-fg-3 hover:bg-hover'}`}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <Button variant="primary" size="sm" fullWidth loading={sel?.running} disabled={busy || noReels} onClick={() => onRunStage('narrate')}>Narrate all</Button>
            <p className="text-caption text-fg-4">Generates ElevenLabs voice-over for every un-narrated reel.</p>
          </>
        );
      case 'copy':
        return (
          <>
            <Button variant="primary" size="sm" fullWidth loading={sel?.running} disabled={busy || noReels} onClick={() => onRunStage('copy')}>Generate copy (all)</Button>
            <p className="text-caption text-fg-4">Writes a YouTube title + description for every reel that still needs one.</p>
          </>
        );
      case 'export':
        return (
          <>
            <Button variant="primary" size="sm" fullWidth loading={sel?.running} disabled={busy || noReels} onClick={() => onRunStage('export')}>Export all</Button>
            <p className="text-caption text-fg-4">Renders every reel to MP4 with its title + description sidecar, zipped into one dated folder.</p>
          </>
        );
    }
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header: reel count + global Run all */}
        <div className="flex items-center justify-between gap-3 px-6 py-2.5 border-b border-line shrink-0">
          <div className="text-caption text-fg-3 tabular-nums">Bulk pipeline · {noReels ? 'no reels yet' : `${totalReels} reel${totalReels === 1 ? '' : 's'}`}</div>
          <Button variant="primary" size="sm" onClick={onRunAll} disabled={busy || runningAll || noReels} loading={runningAll}>
            {runningAll ? 'Running…' : 'Run all'}
          </Button>
        </div>

        {/* Pan/zoom dotted flow canvas — solid bg-page (so the page grid never shows through) + dots only. */}
        <div
          ref={canvasRef}
          className="relative flex-1 overflow-hidden touch-none select-none bg-page cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: `radial-gradient(var(--canvas-dot, rgba(255,255,255,0.16)) ${Math.max(0.6, 1.1 * view.scale)}px, transparent ${Math.max(0.6, 1.1 * view.scale)}px)`,
            backgroundSize: `${28 * view.scale}px ${28 * view.scale}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {/* World layer — nodes pan/zoom together. */}
          <div className="absolute inset-0 origin-top-left will-change-transform" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <div className="flex w-max items-center">
              {ORDER.map((key, i) => (
                <Fragment key={key}>
                  {i > 0 && <Connector />}
                  <StageNode info={byKey[key]} selected={selected === key} onSelect={() => (key === 'scout' ? onOpenScout() : setSelected(key))} />
                </Fragment>
              ))}
            </div>
          </div>

          {/* Zoom controls — bottom-left, matching the reel editor's ZoomControl theme. */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-xl border border-line bg-surface-1 p-1 shadow-2 select-none" onPointerDown={e => e.stopPropagation()}>
            <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out" title="Zoom out" className="focus-ring flex size-7 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
            </button>
            <button type="button" onClick={resetView} aria-label="Reset zoom" title="Reset zoom" className="focus-ring h-7 min-w-[3.25rem] rounded-lg px-1 text-caption tabular-nums text-fg-2 transition-colors hover:bg-hover hover:text-fg">
              {Math.round(view.scale * 100)}%
            </button>
            <button type="button" onClick={() => zoomAt(1.2)} aria-label="Zoom in" title="Zoom in" className="focus-ring flex size-7 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Config drawer */}
      {sel && (
        <aside className="w-[320px] shrink-0 border-l border-line bg-surface-1 flex flex-col">
          <div className="flex items-start justify-between px-4 py-3 border-b border-line">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">{META[sel.key].type}</span>
              <h3 className="text-subheading font-semibold text-fg">{META[sel.key].title}</h3>
              <span className="text-caption text-fg-3 tabular-nums">{sel.total > 0 ? `${sel.done}/${sel.total} reels done` : 'no reels yet'}</span>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="focus-ring -mr-1 rounded-md p-1 text-fg-3 hover:text-fg hover:bg-hover">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">{controls(sel.key)}</div>
        </aside>
      )}
    </div>
  );
}

function MusicRow({ label, active, onClick, disabled }: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`focus-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption transition-colors disabled:opacity-40 ${
        active ? 'bg-active text-fg' : 'text-fg-3 hover:bg-hover'}`}>
      <span className={`size-3 shrink-0 rounded-full border ${active ? 'border-accent bg-accent' : 'border-line-strong'}`} />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
