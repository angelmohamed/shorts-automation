'use client';

import { MinusIcon, PlusIcon } from '@/lib/icons';

// Bottom-left zoom readout with −/+ steppers (Figma/Miro-style). The display shows the ABSOLUTE
// canvas scale (100% = the canvas's native pixel size), so the same percentage means the same
// physical size in every editor — callers pass fit-adjusted values (fitFactor × viewScale) and
// convert back in onChange. Steppers move in 1% increments; clicking the percentage resets to the
// default view. Shares the view scale the trackpad pinch drives.
export function ZoomControl({
  value, min, max, resetTo, onChange,
}: { value: number; min: number; max: number; resetTo: number; onChange: (v: number) => void }) {
  const minPct = min * 100;
  const maxPct = max * 100;
  const fromPct = (p: number) => Math.min(maxPct, Math.max(minPct, p)) / 100;
  const pct = Math.round(value * 100);
  const step = (dir: 1 | -1) => onChange(fromPct(pct + dir));

  const btn = 'flex items-center justify-center size-7 rounded-lg text-fg-2 transition-colors focus-ring ' +
    'enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-35 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed bottom-4 z-40 flex items-center gap-0.5 rounded-xl bg-surface-1 border border-line shadow-2 p-1 select-none transition-[left] duration-[var(--dur-spatial)] ease-[var(--ease-emphasized)]"
      style={{ left: 'calc(var(--rail-w, 220px) + var(--ai-panel-w, 0px) + 1rem)' }}
    >
      <button type="button" onClick={() => step(-1)} disabled={pct <= Math.ceil(minPct)} aria-label="Zoom out" className={btn}>
        <MinusIcon size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onChange(resetTo)}
        aria-label="Reset zoom"
        title="Reset zoom"
        className="h-7 min-w-[3.25rem] px-1 rounded-lg text-label tabular-nums text-fg-2 transition-colors focus-ring hover:bg-hover hover:text-fg"
      >
        {pct}%
      </button>
      <button type="button" onClick={() => step(1)} disabled={pct >= Math.floor(maxPct)} aria-label="Zoom in" className={btn}>
        <PlusIcon size={14} aria-hidden />
      </button>
    </div>
  );
}
