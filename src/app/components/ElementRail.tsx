'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from './ui/cn';
import { RAIL_VAR } from './ui/dimensions';

// useLayoutEffect on the client, useEffect on the server — avoids the SSR warning
// while still measuring before paint in the browser (so the flyout never flickers).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ── Layout constants ──────────────────────────────────────────────────────────
// The icon rail is a thin floating card pinned to the left edge of the canvas lane
// (Miro-style). Its flyout overlays the canvas, so the canvas only needs to reserve
// the rail's own footprint — far less than the old always-open Elements drawer.
const RAIL_GAP = 12;
export const EDITOR_RAIL_W = 52;
export const ELEMENT_RAIL_FOOTPRINT = RAIL_GAP + EDITOR_RAIL_W + RAIL_GAP; // 76px

export interface RailCategory {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

// One icon button + its hover tooltip (label pill to the right, Miro-style).
function RailButton({
  category, active, onToggle,
}: { category: RailCategory; active: boolean; onToggle: () => void }) {
  return (
    <div className="relative group/rail flex">
      <button
        type="button"
        onClick={onToggle}
        data-rail-id={category.id}
        aria-label={category.label}
        aria-pressed={active}
        className={cn(
          'flex items-center justify-center size-9 rounded-xl transition-colors focus-ring',
          active
            ? 'bg-accent-tint text-accent-text'
            : 'text-fg-2 hover:bg-hover hover:text-fg',
        )}
      >
        {category.icon}
      </button>
      {/* Tooltip — shows on hover even when this icon is active (its flyout open / green). */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-dropdown whitespace-nowrap
                   rounded-lg bg-surface-overlay border border-line shadow-2 px-2.5 py-1 text-caption text-fg
                   opacity-0 group-hover/rail:opacity-100 transition-opacity duration-[var(--dur-base)] motion-reduce:transition-none"
      >
        {category.label}
      </span>
    </div>
  );
}

// Icon-only action button for the undo/redo island (no toggle state, supports disabled).
// Exported so other islands (e.g. the reels Adjust island) reuse the exact rail-button chrome.
export function RailActionButton({
  label, icon, onClick, disabled, active,
}: { label: string; icon: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <div className="relative group/rail flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'flex items-center justify-center size-9 rounded-xl transition-colors focus-ring disabled:opacity-35 disabled:cursor-not-allowed',
          active
            ? 'bg-accent-tint text-accent-text'   // green "on" highlight, matching the rail category buttons
            : 'text-fg-2 enabled:hover:bg-hover enabled:hover:text-fg',
        )}
      >
        {icon}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-dropdown whitespace-nowrap
                   rounded-lg bg-surface-overlay border border-line shadow-2 px-2.5 py-1 text-caption text-fg
                   opacity-0 group-hover/rail:opacity-100 transition-opacity duration-[var(--dur-base)] motion-reduce:transition-none"
      >
        {label}
      </span>
    </div>
  );
}

// A compact island of mutually-exclusive icon options (e.g. the Carousel ↔ Twitter/X
// template-type switch). Same 52px chrome + active styling as the rail buttons, so it
// stacks seamlessly on top of the element rail (and works standalone elsewhere).
export function ModeToggleIsland<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: ReactNode }[];
}) {
  return (
    <div
      className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl bg-surface-1 border border-line shadow-2 p-1.5"
      style={{ width: EDITOR_RAIL_W }}
    >
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <div key={opt.value} className="relative group/rail flex">
            <button
              type="button"
              onClick={() => onChange(opt.value)}
              aria-label={opt.label}
              aria-pressed={active}
              className={cn(
                'flex items-center justify-center size-9 rounded-xl transition-colors focus-ring',
                active
                  ? 'bg-accent-tint text-accent-text'
                  : 'text-fg-2 hover:bg-hover hover:text-fg',
              )}
            >
              {opt.icon}
            </button>
            {/* Tooltip — shows on hover even when this option is the active (selected / green) one. */}
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-dropdown whitespace-nowrap
                         rounded-lg bg-surface-overlay border border-line shadow-2 px-2.5 py-1 text-caption text-fg
                         opacity-0 group-hover/rail:opacity-100 transition-opacity duration-[var(--dur-base)] motion-reduce:transition-none"
            >
              {opt.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Vertical icon rail + on-demand flyout that replaces the old always-open Elements drawer.
// `categories` carry their own draggable content (built by the parent so all the existing
// drag/upload handlers stay in the parent's scope) — this component only owns the chrome.
// A separate undo/redo island sits beneath the rail (Miro-style) when handlers are supplied.
export function ElementRail({
  categories, onUndo, onRedo, canUndo, canRedo, topIsland, extraIsland, extraIslandOpen, collapseMiddle, bottomSlot,
}: {
  categories: RailCategory[];
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  topIsland?: ReactNode;   // optional island stacked on top of the rail (e.g. the template-type toggle)
  extraIsland?: ReactNode; // optional island below the icon rail, above undo/redo (e.g. the reels Adjust panel)
  extraIslandOpen?: boolean;  // when false, the extra island collapses to 0 height + fades out (animated); default open
  collapseMiddle?: boolean;   // animate the middle (categories) island shut — the page collapses it, then swaps editors
  bottomSlot?: ReactNode;  // optional element pinned below undo/redo, at the rail width (e.g. a Delete-all pill)
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  // Measured top (viewport px) that vertically centres the flyout on its own icon.
  const [flyoutTop, setFlyoutTop] = useState<number | null>(null);
  const active = categories.find(c => c.id === openId) ?? null;

  // Middle (categories) island open/shut. It animates open on mount (enter) and shut when
  // collapseMiddle flips true — that's how the Carousel⇄Reels toggle slides the middle island
  // in/out (the page swaps editors once it's collapsed). We animate an explicit pixel `height`
  // (measured here) rather than grid-template-rows `fr`: `fr` interpolation forces a grid
  // re-layout every frame and is choppy (especially Safari), whereas a plain length lerp stays
  // smooth. The rAF defers the first paint so the 0→height transition runs instead of snapping.
  const middleContentRef = useRef<HTMLDivElement>(null);
  const [middleH, setMiddleH] = useState(0);
  const [middleOpen, setMiddleOpen] = useState(false);
  // On collapse the pill animates its height all the way down to 0 and fades out — the Carousel⇄Reels
  // toggle fully closes the outgoing rail, then the incoming rail grows back up from 0 and fades in.
  // We measure the open height (middleH, the natural buttons-stack height) so the transition has a
  // concrete pixel target to lerp between (0 ↔ middleH); offsetHeight reads the true content height
  // even while the container is collapsed, since the buttons stack overflows the clipped box.
  useIsoLayoutEffect(() => {
    const content = middleContentRef.current;
    if (!content) return;
    setMiddleH(content.offsetHeight);
  }, [categories.length]);
  // `ready` gates the transition: it stays false through the first measured paint so the collapsed
  // start state (height 0, opacity 0) is set without animating, then the rAF flips it true on the
  // next frame and opens the rail — so a freshly-mounted rail (e.g. the incoming one after a swap)
  // grows up from 0 and fades in, rather than snapping straight to full height.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { setReady(true); setMiddleOpen(!collapseMiddle); });
    return () => cancelAnimationFrame(id);
  }, [collapseMiddle]);

  // Extra island (e.g. the reels Adjust panel): measured + height/opacity-animated the same way as the
  // middle island, so it expands in / collapses out when extraIslandOpen flips (gated on a loaded video).
  const extraContentRef = useRef<HTMLDivElement>(null);
  const [extraH, setExtraH] = useState(0);
  useIsoLayoutEffect(() => {
    const el = extraContentRef.current;
    if (!el) return;
    const measure = () => setExtraH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // If the open category disappears (e.g. a conditional one), drop the selection. Deferred so it isn't a
  // synchronous setState in the effect body.
  useEffect(() => {
    if (!openId || categories.some(c => c.id === openId)) return;
    const id = setTimeout(() => setOpenId(null), 0);
    return () => clearTimeout(id);
  }, [categories, openId]);

  // Close on outside click + Escape (matches the toolbar dropdown's behaviour).
  useEffect(() => {
    if (!openId) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Don't hijack Escape while typing in a flyout field (e.g. the link input).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setOpenId(null);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  // Vertically centre the flyout on the icon it opened from (not the viewport),
  // clamped with a small margin so a tall flyout never spills off-screen. Re-runs on
  // window resize (the rail itself is viewport-centred so it moves) and whenever the
  // flyout's own height changes (e.g. images loading into the logos/uploads gallery).
  useIsoLayoutEffect(() => {
    if (!openId) { setFlyoutTop(null); return; }
    const measure = () => {
      const btn = wrapRef.current?.querySelector<HTMLElement>(`[data-rail-id="${openId}"]`);
      const flyout = flyoutRef.current;
      if (!btn || !flyout) return;
      const r = btn.getBoundingClientRect();
      const h = flyout.offsetHeight;
      const margin = 12;
      const centre = r.top + r.height / 2;
      setFlyoutTop(Math.max(margin, Math.min(centre - h / 2, window.innerHeight - h - margin)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (flyoutRef.current) ro.observe(flyoutRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [openId]);

  return (
    <div
      ref={wrapRef}
      className="fixed top-0 bottom-0 z-30 flex items-center pointer-events-none transition-[left] duration-[var(--dur-spatial)] ease-[var(--ease-emphasized)]"
      style={{ left: `calc(${RAIL_VAR} + var(--ai-panel-w, 0px) + ${RAIL_GAP}px)` }}
    >
      {/* Stacked islands: optional top island (the template-type toggle), then the element
          rail, then undo/redo (Miro-style) — all the same EDITOR_RAIL_W width. */}
      <div className="flex flex-col items-center">
        {topIsland}
        {/* Icon rail card. Omitted when there are no categories (the Reels editor passes none).
            It resizes by animating its HEIGHT (0 ↔ middleH) and fading its opacity, so it fully
            collapses away on the Carousel⇄Reels swap. Two layers so the corners stay round while it
            resizes: (1) a rounded pill background that is NEVER clipped, and
            (2) a clip-path'd layer holding the buttons. The clip is vertical-only — inset 0 on
            top/bottom, -9999px left/right — so the buttons clip to the pill height while each
            button's hover tooltip can still overflow to the right. mt-2 is the (constant) gap. */}
        {categories.length > 0 && (
          <div
            className="mt-2"
            style={{
              height: middleOpen ? middleH : 0,
              opacity: middleOpen ? 1 : 0,
              width: EDITOR_RAIL_W,
              transition: ready ? 'height var(--rail-dur, 360ms) var(--ease-emphasized), opacity var(--rail-dur, 360ms) var(--ease-standard)' : 'none',
            }}
          >
            <div className="relative h-full w-full">
              {/* Rounded pill — fills the animated height, never clipped, so corners stay round. */}
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-surface-1 border border-line shadow-2" />
              {/* Buttons — top-pinned, clipped to the pill height; tooltips overflow horizontally. */}
              <div className="absolute inset-0" style={{ clipPath: 'inset(0 -9999px)' }}>
                <div ref={middleContentRef} className="pointer-events-auto flex flex-col items-center gap-1 p-1.5">
                  {categories.map(cat => (
                    <RailButton
                      key={cat.id}
                      category={cat}
                      active={openId === cat.id}
                      onToggle={() => setOpenId(id => (id === cat.id ? null : cat.id))}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Extra island (e.g. the reels Adjust panel) — below the icon rail, above undo/redo. Animated
            (height 0↔measured + opacity) exactly like the icon-rail card and gated by extraIslandOpen.
            We own the pill chrome + vertical clip so the corners stay round mid-animation; the caller
            passes just the island's content (e.g. a column of buttons). */}
        {extraIsland && (
          <div
            className="mt-2"
            style={{
              height:  (extraIslandOpen ?? true) ? extraH : 0,
              opacity: (extraIslandOpen ?? true) ? 1 : 0,
              width: EDITOR_RAIL_W,
              transition: ready ? 'height var(--rail-dur, 360ms) var(--ease-emphasized), opacity var(--rail-dur, 360ms) var(--ease-standard)' : 'none',
            }}
          >
            <div className="relative h-full w-full">
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-surface-1 border border-line shadow-2" />
              <div className="absolute inset-0" style={{ clipPath: 'inset(0 -9999px)' }}>
                <div ref={extraContentRef} className="pointer-events-auto flex flex-col items-center gap-1 p-1.5">
                  {extraIsland}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Undo / redo island */}
        {(onUndo || onRedo) && (
          <div
            className="mt-2 pointer-events-auto flex flex-col items-center gap-1 rounded-2xl bg-surface-1 border border-line shadow-2 p-1.5"
            style={{ width: EDITOR_RAIL_W }}
          >
            <RailActionButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo} icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" />
              </svg>
            } />
            <RailActionButton label="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo} icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h4" />
              </svg>
            } />
          </div>
        )}
        {bottomSlot && (
          <div className="mt-2 pointer-events-auto" style={{ width: EDITOR_RAIL_W }}>
            {bottomSlot}
          </div>
        )}
      </div>

      {/* Flyout — overlays the canvas, doesn't push it (Miro-style). Absolutely
          positioned + JS-measured so it's vertically centred on the icon it opened
          from, not the viewport. Hidden until measured to avoid a position flash. */}
      {active && (
        <div
          ref={flyoutRef}
          className="absolute pointer-events-auto flex flex-col gap-3 w-[268px] max-h-[80vh] overflow-y-auto scrollbar-none
                     rounded-2xl bg-surface-1 border border-line-strong shadow-3 p-3"
          style={{ left: EDITOR_RAIL_W + 8, top: flyoutTop ?? 0, visibility: flyoutTop == null ? 'hidden' : undefined }}
        >
          <div className="flex items-center justify-between shrink-0">
            <span className="text-caption font-semibold text-fg-3 uppercase tracking-wider">{active.label}</span>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              aria-label="Close"
              className="flex items-center justify-center size-6 -mr-1 rounded-md text-fg-3 hover:text-fg hover:bg-hover transition-colors focus-ring"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {active.content}
        </div>
      )}
    </div>
  );
}

// ── Rail icons (stroke-based, match the app's 2px round style) ─────────────────
const ICON = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const RailIcons = {
  logos: (
    <svg {...ICON}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.4" /><path d="m21 15-4.5-4.5L6 21" /></svg>
  ),
  images: (
    <svg {...ICON}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>
  ),
  text: (
    <svg {...ICON}><path d="M5 5h14M12 5v14M9 19h6" /></svg>
  ),
  tags: (
    <svg {...ICON}><path d="M3.5 12.5 11 5a2 2 0 0 1 1.4-.6H19a1 1 0 0 1 1 1v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-6.3-6.3a1.5 1.5 0 0 1 0-2.1Z" /><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" /></svg>
  ),
  swipe: (
    // Centred at y=12 (the chevron pair spans y=7..17) so it sits mid-frame.
    <svg {...ICON}><path d="m7 17 5-5 5 5M7 12l5-5 5 5" /></svg>
  ),
  dividers: (
    // Nudged a hair below mathematical centre (optical centring for the horizontal rule).
    <svg {...ICON}><path d="M3 12.6h6M15 12.6h6" /><circle cx="12" cy="12.6" r="1.4" fill="currentColor" stroke="none" /></svg>
  ),
  quotes: (
    <svg {...ICON} width="23" height="23"><path d="M9.5 7C7 8 5.8 9.8 5.8 12.4V17H10v-5H7.6c0-1.6.9-2.9 2.6-3.6L9.5 7Zm8.5 0c-2.5 1-3.7 2.8-3.7 5.4V17h4.2v-5h-2.4c0-1.6.9-2.9 2.6-3.6L18 7Z" fill="currentColor" stroke="none" /></svg>
  ),
  overlays: (
    <svg {...ICON}><circle cx="9" cy="12" r="6.5" /><circle cx="15" cy="12" r="6.5" /></svg>
  ),
  // Template-type toggle icons (used by ModeToggleIsland in the editor).
  carousel: (
    <svg {...ICON}><rect x="7" y="5" width="10" height="14" rx="2" /><path d="M4 8v8M20 8v8" /></svg>
  ),
  twitter: (
    // X (Twitter) brand mark — a filled glyph, so it doesn't use the stroke ICON spec.
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  reels: (
    // Reels mark: rounded frame + clapper strip (seam + two diagonals) + a filled play triangle.
    <svg {...ICON}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M3 8h18M7.5 3 10 8M13 3 15.5 8" />
      <path d="M10.5 11.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  ),
};
