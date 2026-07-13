'use client';

import { Badge } from '@/app/components/ui';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Persistent cloud autosave status used by the carousel + reels editors. Never disappears:
// three dots while saving, a check otherwise; idle and saved both read as "all changes saved".
export function AutosaveChip({ state }: { state: SaveState }) {
  if (state === 'error') return <Badge tone="danger" className="select-none">Save failed</Badge>;
  const saving = state === 'saving';
  const label = saving ? 'Saving…' : 'All changes saved';
  return (
    <div className="relative group/save flex">
      {/* Sidebar-style light hover square */}
      <div className="grid place-items-center size-9 rounded-lg group-hover/save:bg-hover transition-colors duration-[var(--dur-fast)] motion-reduce:transition-none">
        <svg width="34" height="34" viewBox="0 0 64 64" fill="none" role="img" aria-label={label} className="select-none shrink-0">
          <g stroke="#00CD40" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M21 43 C15.5 43 12 38.8 13.4 33.8 C14.3 30.4 17.6 28.3 21 28.8 C21.7 22.6 27.3 18.4 33.4 19.8 C38.1 20.9 41.4 25.2 41 30 C45.8 29.4 50 33.1 49.6 38 C49.3 41 46.6 43 43.6 43 Z" />
            {!saving && <path d="M25.7 33.9 L28.7 36.9 L34.6 29.2" />}
          </g>
          {saving && (
            <g fill="#00CD40" stroke="none">
              <circle cx="25.5" cy="35" r="1.9" />
              <circle cx="31.5" cy="35" r="1.9" />
              <circle cx="37.5" cy="35" r="1.9" />
            </g>
          )}
        </svg>
      </div>
      {/* Pill tooltip below, matching the sidebar / element-rail tooltips */}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-dropdown whitespace-nowrap
                   rounded-lg bg-surface-overlay border border-line shadow-2 px-2.5 py-1 text-caption text-fg
                   opacity-0 group-hover/save:opacity-100 transition-opacity duration-[var(--dur-base)] motion-reduce:transition-none"
      >
        {label}
      </span>
    </div>
  );
}
