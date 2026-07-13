'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, GripIcon } from '@/lib/icons';

export interface SectionDrag {
  onGripPointerDown: (e: React.PointerEvent) => void;   // pointer-based drag; the grip is the handle
  isDragging?: boolean;
}

// The carousel/reels "floating island" settings row: a rounded card with an expand/collapse chevron,
// a CSS-grid 1fr/0fr height animation, and per-section open/closed persistence in localStorage.
// Shared so the carousel and reels editors look + persist identically.
export function CollapsibleSection({
  title, children, defaultOpen, open: controlledOpen, onToggle, grip, leftIcons, drag, rowRef, dimmed, noToggle,
  storeKeyPrefix = 'de:sec:',
}: {
  title: string; children?: ReactNode; defaultOpen?: boolean; open?: boolean;
  onToggle?: (next: boolean) => void;  // controlled open: header click reports the desired state instead of flipping internal/localStorage state
  grip?: boolean;             // show a 6-dot drag handle in the header (draggable layer section)
  leftIcons?: ReactNode;      // floating controls (show/hide, lock) in the gutter left of the card
  drag?: SectionDrag;         // drag-to-reorder wiring; the grip is the drag handle, the card the drop target
  rowRef?: (el: HTMLDivElement | null) => void;   // the whole row (gutter + card) — measured for FLIP reflow
  dimmed?: boolean;           // layer is hidden → fade the card to match its eye island
  noToggle?: boolean;         // static row: no chevron, no content (a draggable layer with no settings, e.g. the Video band)
  storeKeyPrefix?: string;    // namespace for the localStorage key, so two editors with same-titled sections don't clobber each other
}) {
  // Remember the manual open/closed state per section (localStorage) so e.g. Canvas Colour stays
  // closed across refreshes instead of re-opening from defaultOpen.
  const storeKey = `${storeKeyPrefix}${title}`;
  const [internalOpen, setInternalOpen] = useState(() => {
    if (typeof window !== 'undefined') { const v = localStorage.getItem(storeKey); if (v != null) return v === '1'; }
    return defaultOpen ?? false;
  });
  const toggleOpen = () => setInternalOpen(o => { const n = !o; try { localStorage.setItem(storeKey, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  // When `open` is supplied (a selection is active) it controls the section; otherwise manual toggle.
  const open = controlledOpen ?? internalOpen;
  // If a consumer drives the section via `onToggle` (the canvas-selection binding), report the
  // desired state on header click instead of flipping the internal/localStorage state.
  const handleToggle = onToggle ? () => onToggle(!open) : toggleOpen;
  return (
    <div ref={rowRef} className="relative">
      {drag?.isDragging ? (
        /* Placeholder underneath the lifted card — an empty card spanning the full row. */
        <div className="w-full h-8 rounded-lg border border-line bg-surface-1" />
      ) : (
        <div
          className={`min-w-0 rounded-lg bg-surface-1 border border-line transition-opacity duration-[var(--dur-base)] ${dimmed ? 'opacity-45' : ''}`}
        >
          <div className="w-full flex items-center gap-1 pl-2 pr-2 py-2">
            {grip && (
              <span
                onPointerDown={drag?.onGripPointerDown}
                title="Drag to reorder"
                style={{ touchAction: 'none' }}
                className="shrink-0 flex items-center cursor-grab active:cursor-grabbing text-fg-4 hover:text-fg-3 transition-colors"
              >
                <GripIcon size={11} aria-hidden />
              </span>
            )}
            {noToggle ? (
              // Static layer (e.g. the Video band): a plain, non-clickable title — no chevron, no content.
              <span className="flex-1 min-w-0 flex items-center text-[11px] font-semibold text-fg-3 uppercase tracking-wider truncate">{title}</span>
            ) : (
              <button
                onClick={handleToggle}
                className="flex-1 min-w-0 flex items-center text-left focus-ring rounded"
              >
                <span className="text-[11px] font-semibold text-fg-3 uppercase tracking-wider truncate">{title}</span>
              </button>
            )}
            {/* Show/hide eye — left of the chevron, inside the section header */}
            {leftIcons}
            {!noToggle && (
              <button
                onClick={handleToggle}
                aria-label={open ? 'Collapse' : 'Expand'}
                className="shrink-0 flex items-center justify-center size-4 rounded text-fg-3 hover:text-fg transition-colors focus-ring"
              >
                <ChevronDownIcon size={11} className={`transition-transform duration-[var(--dur-base)] ${open ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            )}
          </div>
          {!noToggle && (
            <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
              <div style={{ overflow: 'hidden' }}>
                <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
