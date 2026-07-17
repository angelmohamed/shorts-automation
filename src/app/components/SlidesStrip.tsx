'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, PlusIcon } from '@/lib/icons';

// Only id + name are needed, so any {id,name} works (carousel slides, reels, …). `progress` (0–1) drives a
// per-card export progress bar — set while that reel/slide is being downloaded, omitted otherwise. `duration`
// shows a length badge (reels): `label` is the m:ss (prefixed "~" when estimated), `over` reddens it past the
// 3:00 Shorts limit.
type StripItem = { id: string; name: string; progress?: number; duration?: { label: string; over: boolean } };

interface SlidesStripProps {
  slides: StripItem[];
  activeSlideId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  numbered?: boolean;   // reels: number-first cards (name is optional — hidden while empty) + reel-flavoured labels
}

const CARD_WIDTH_PX    = 130;
const CARD_HEIGHT_PX   = 72;

export function SlidesStrip({
  slides,
  activeSlideId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
  numbered,
}: SlidesStripProps) {
  // Drag-to-reorder state (HTML5 DnD)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);

  // Soft-fade the strip's edges when it overflows, so off-screen cards melt out instead of hard-cutting.
  // Only the side that actually has hidden content fades — at rest (everything fits) the mask is fully
  // opaque, a no-op. Tracks scroll position + size so the fades appear/disappear as you scroll/resize.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft >= max - 1 });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [slides.length]);
  const FADE_PX = 32;
  const edgeMask = `linear-gradient(to right, ${edges.atStart ? 'black' : 'transparent'} 0, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), ${edges.atEnd ? 'black' : 'transparent'} 100%)`;

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Decide if the drop should go before or after the target based on cursor X
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    setDropTarget({ id: targetId, before });
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) { resetDrag(); return; }
    const ids = slides.map(s => s.id);
    const fromIdx = ids.indexOf(draggingId);
    let toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { resetDrag(); return; }

    const before = dropTarget?.before ?? true;
    ids.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx -= 1;
    ids.splice(before ? toIdx : toIdx + 1, 0, draggingId);
    onReorder(ids);
    resetDrag();
  }

  function resetDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  return (
    // no-native-scrollbar hides the grey native horizontal scrollbar (matches the canvas
    // scroll area); the strip still scrolls via trackpad / shift+wheel / drag.
    <div
      ref={scrollerRef}
      className="flex items-center p-3 gap-2 overflow-x-auto overflow-y-visible no-native-scrollbar"
      style={{ maskImage: edgeMask, WebkitMaskImage: edgeMask }}
      onDragEnd={resetDrag}
    >
      {slides.map((s, i) => (
        <SlideCard
          key={s.id}
          slide={s}
          index={i}
          isActive={s.id === activeSlideId}
          isDragging={draggingId === s.id}
          dropTarget={dropTarget?.id === s.id ? dropTarget : null}
          numbered={numbered}
          onSelect={() => onSelect(s.id)}
          onRename={name => onRename(s.id, name)}
          onDelete={() => onDelete(s.id)}
          onDuplicate={onDuplicate ? () => onDuplicate(s.id) : undefined}
          onDragStart={e => handleDragStart(e, s.id)}
          onDragOver={e => handleDragOver(e, s.id)}
          onDrop={e => handleDrop(e, s.id)}
        />
      ))}

      <button
        onClick={onAdd}
        className="focus-ring shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-fg-3 hover:border-accent-border hover:text-fg transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)]"
        style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX }}
        title={numbered ? 'Add reel' : 'Add slide'}
      >
        <PlusIcon size={18} />
        <span className="text-caption font-medium">{numbered ? 'Add reel' : 'Add slide'}</span>
      </button>
    </div>
  );
}

// ── SlideCard ────────────────────────────────────────────────────────────────

function SlideCard({
  slide, index, isActive, isDragging, dropTarget, numbered,
  onSelect, onRename, onDelete, onDuplicate,
  onDragStart, onDragOver, onDrop,
}: {
  slide: StripItem;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  dropTarget: { id: string; before: boolean } | null;
  numbered?: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(slide.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showX, setShowX]     = useState(false);
  // True while the pointer is over the delete X. The card is `draggable`, and HTML5 DnD starts a drag
  // from the nearest draggable *ancestor* — so a press on the X would otherwise drag the card (which
  // dims it to opacity-40 and eats the click). Suspending the card's draggability while over the X lets
  // the click through cleanly; the rest of the card still drags to reorder.
  const [overX, setOverX]     = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);
  const hoverTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevName, setPrevName] = useState(slide.name);
  if (slide.name !== prevName) {   // render-phase sync with external rename
    setPrevName(slide.name);
    setDraft(slide.name);
  }
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);

  function handleMouseEnter() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setShowX(true);
      hoverTimerRef.current = null;
    }, 250);
  }
  function handleMouseLeave() {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setShowX(false);
  }

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== slide.name) onRename(trimmed);
    else                                    setDraft(slide.name);
  }
  function cancel() { setDraft(slide.name); setEditing(false); }

  return (
    <>
      <div
        draggable={!editing && !overX}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => { if (!editing) onSelect(); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // Keyboard parity for the hover-revealed delete button: reveal it while focus is anywhere in the card,
        // hide it once focus leaves the card entirely (so tabbing can reach the otherwise mouse-only X).
        onFocus={() => setShowX(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowX(false); }}
        className={`relative shrink-0 rounded-lg cursor-pointer transition-all group ${
          isDragging ? 'opacity-40' : 'opacity-100'
        }`}
        style={{ width: CARD_WIDTH_PX }}
      >
        {/* Drop indicator line */}
        {dropTarget && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none"
            style={{ [dropTarget.before ? 'left' : 'right']: -4 }}
          />
        )}

        {/* Apple-style close button — top-left of thumbnail, visible on hover */}
        <button
          // While the pointer is over the X, suspend the card's drag (see `overX`) so this press isn't
          // hijacked into a card drag (which dims the card grey and eats the click). With the drag out of
          // the way a plain onClick opens the confirm — and it covers keyboard activation too.
          onPointerEnter={() => setOverX(true)}
          onPointerLeave={() => setOverX(false)}
          onClick={e => { e.stopPropagation(); setConfirmingDelete(true); }}
          className="focus-ring absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full bg-surface-3/85 backdrop-blur-sm flex items-center justify-center text-fg shadow-2 ring-1 ring-line-strong hover:bg-hover"
          style={{
            opacity: showX ? 1 : 0,
            transition: showX ? 'opacity 150ms ease-in-out' : 'none',
            pointerEvents: showX ? 'auto' : 'none',
          }}
          title={numbered ? 'Delete reel' : 'Delete slide'}
          aria-label={`Delete ${slide.name || `reel ${index + 1}`}`}
        >
          <CloseIcon size={10} strokeWidth={2.4} />
        </button>

        {/* Duplicate button — top-right, mirrors the delete button (hover/focus-revealed) */}
        {onDuplicate && (
          <button
            onPointerEnter={() => setOverX(true)}
            onPointerLeave={() => setOverX(false)}
            onClick={e => { e.stopPropagation(); onDuplicate(); }}
            className="focus-ring absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-surface-3/85 backdrop-blur-sm flex items-center justify-center text-fg shadow-2 ring-1 ring-line-strong hover:bg-hover"
            style={{
              opacity: showX ? 1 : 0,
              transition: showX ? 'opacity 150ms ease-in-out' : 'none',
              pointerEvents: showX ? 'auto' : 'none',
            }}
            title={numbered ? 'Duplicate reel' : 'Duplicate slide'}
            aria-label={`Duplicate ${slide.name || `reel ${index + 1}`}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          </button>
        )}

        {/* Card: slide number up top, name inside along the bottom */}
        <div
          className={`relative flex flex-col overflow-hidden rounded-lg border-2 transition-colors ${
            isActive
              ? 'border-accent-border bg-surface-3'
              : 'border-line bg-surface-1 group-hover:border-line-strong'
          }`}
          style={{ height: CARD_HEIGHT_PX }}
        >
          <div
            className="flex-1 min-h-0 flex items-center justify-center"
            // Numbered (reels) cards may have no visible name to click, so the rename entry point
            // mirrors the name div below: click the ACTIVE card's number again to (re)name the reel.
            onClick={numbered ? e => {
              if (!isActive) return;             // first click = select (bubbles to the card)
              e.stopPropagation();
              setEditing(true);
            } : undefined}
            title={numbered && isActive ? 'Rename' : undefined}
          >
            <span className={`text-2xl font-semibold tracking-tight ${isActive ? 'text-fg' : 'text-fg-4'}`}>
              {index + 1}
            </span>
          </div>

          {/* Name (inline-editable), centered along the bottom inside the card. In `numbered` mode
              (reels) the name is OPTIONAL: while empty (and not being edited) the row is omitted so an
              unnamed reel keeps its original number-only look; a named reel shows the name beneath the
              number exactly like a slide. */}
          {(!numbered || editing || slide.name !== '') && (
          <div className={`shrink-0 px-1.5 pb-1 min-w-0 ${slide.duration && !editing ? 'pr-9' : ''}`}>
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                }}
                className="focus-ring w-full bg-surface-1 border border-line-strong rounded-sm px-1 py-0.5 text-caption text-fg text-center"
              />
            ) : (
              <div
                onClick={e => {
                  if (!isActive) return;             // first click = select; click again on active card name = edit
                  e.stopPropagation();
                  setEditing(true);
                }}
                className={`truncate text-center text-caption font-medium ${isActive ? 'text-fg' : 'text-fg-3'}`}
                title={slide.name}
              >
                {slide.name}
              </div>
            )}
          </div>
          )}
          {/* Length badge (reels): m:ss of the final Short — estimated ("~") until narration is generated,
              exact after. Reddens + appends "!" past the 3:00 Shorts limit (colour alone isn't accessible) so
              an over-long reel is scannable at a glance. pointer-events-none so it never eats card drag/click —
              hence aria-label (not title, which an inert element can't surface) carries the reason. */}
          {slide.duration && (
            <div
              className={`absolute bottom-1 right-1 px-1 rounded text-[10px] leading-[14px] font-semibold tabular-nums pointer-events-none ${
                slide.duration.over ? 'bg-danger-tint text-danger-text' : 'bg-surface-3/85 text-fg-2'
              }`}
              aria-label={slide.duration.over
                ? `${slide.duration.label}, over the 3:00 Shorts limit`
                : `${slide.duration.label} estimated final length`}
            >
              {slide.duration.label}{slide.duration.over ? ' !' : ''}
            </div>
          )}
          {/* Export progress — a bar across the card's bottom edge while this reel is downloading. */}
          {slide.progress != null && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
              <div
                className="h-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(3, Math.round(slide.progress * 100))}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          slideName={numbered ? (slide.name || `Reel ${index + 1}`) : slide.name}
          kind={numbered ? 'reel' : 'slide'}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
        />
      )}
    </>
  );
}

// ── ConfirmDeleteDialog ──────────────────────────────────────────────────────
// iOS-style alert: frosted backdrop, centered card, side-by-side actions.

export function ConfirmDeleteDialog({
  slideName, kind = 'slide', onCancel, onConfirm,
}: {
  slideName: string;
  kind?: string;   // what is being deleted — 'slide' | 'template' | 'post'
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Play the exit animation, then run the action (cancel/confirm) — keeps the card mounted long enough to
  // fade + drop out, matching the shared Modal / login-signup card.
  const [closing, setClosing] = useState(false);
  const close = (action: () => void) => { setClosing(true); window.setTimeout(action, 170); };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(onCancel);
      if (e.key === 'Enter')  close(onConfirm);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, onConfirm]);

  if (typeof document === 'undefined') return null;
  // Portal to <body>: this dialog is sometimes rendered deep inside the slides strip — a `fixed`,
  // mask-clipped, pointer-events-gated wrapper that can clip or mis-place a fixed overlay or swallow
  // its clicks. Rendering at the document root keeps it reliably centered and interactive everywhere.
  return createPortal(
    <div
      className={`fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)] ${closing ? 'de-overlay-out' : 'de-overlay-in'}`}
      onClick={() => close(onCancel)}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-72 overflow-hidden rounded-2xl border border-line bg-page shadow-3 ${closing ? 'de-dialog-out' : 'de-dialog-in'}`}
      >
        <div className="px-5 pt-5 pb-4 text-center">
          <h3 className="text-body font-semibold text-fg mb-1.5">Delete {kind}?</h3>
          <p className="text-caption text-fg-3 leading-relaxed">
            &ldquo;{slideName}&rdquo; will be removed. This cannot be undone.
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-line">
          <button
            onClick={() => close(onCancel)}
            className="focus-ring py-3 text-label font-medium text-fg-2 hover:bg-hover transition-colors border-r border-line"
          >
            Cancel
          </button>
          <button
            onClick={() => close(onConfirm)}
            autoFocus
            className="focus-ring py-3 text-label font-semibold text-danger-text hover:bg-danger-tint transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
