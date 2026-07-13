'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject, CSSProperties } from 'react';

// Miro-style overview bar pinned to the bottom of the canvas workspace. Transparent with an outline.
// Its WIDTH is a CSS percentage of its track driven by the zoom level (`extent`, 0..1 from the parent):
// 1 = fully zoomed out → 100% (fills the track edge-to-edge, can't overflow); →0 as you zoom in,
// bottoming out as a small ball (minWidth). POSITION + drag-to-pan follow the canvas's horizontal
// scroll. Rendered through a portal into document.body so no ancestor transform/contain/overflow can
// act as its containing block — left/right resolve against the viewport exactly. `zoom` is passed so
// scroll geometry recomputes after a zoom (no scroll event fires for that).
const BALL = 7; // px — equals the thumb height, so the minimum width renders as a circle.

export function EditorScrollBar({
  targetRef, zoom, extent = 1, style,
}: { targetRef: RefObject<HTMLElement | null>; zoom?: number; extent?: number; style?: CSSProperties }) {
  const [{ pos, hOverflow }, setState] = useState({ pos: 0.5, hOverflow: false });
  const [mounted, setMounted] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);

  // Deferred (not a synchronous setState in the effect body) — flips the SSR-hydration guard after mount.
  useEffect(() => { const id = setTimeout(() => setMounted(true), 0); return () => clearTimeout(id); }, []);

  const recompute = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const hMax = el.scrollWidth - el.clientWidth;
    setState({ pos: hMax > 1 ? el.scrollLeft / hMax : 0.5, hOverflow: hMax > 1 });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    recompute();
    el.addEventListener('scroll', recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', recompute); ro.disconnect(); };
  }, [targetRef, recompute]);

  // Recompute scroll geometry after a zoom change (content size changed; no scroll event fires).
  useEffect(() => { const id = requestAnimationFrame(recompute); return () => cancelAnimationFrame(id); }, [zoom, recompute]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const el = targetRef.current, track = trackRef.current, btn = btnRef.current, d = dragRef.current;
      if (!el || !track || !btn || !d) return;
      const travel = Math.max(1, track.clientWidth - btn.clientWidth);
      el.scrollLeft = d.startScroll + ((e.clientX - d.startX) / travel) * (el.scrollWidth - el.clientWidth);
    }
    function onUp() { dragRef.current = null; document.body.style.userSelect = ''; }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [targetRef]);

  const e = Math.max(0, Math.min(1, extent));
  const widthPct = e * 100;             // 100% at full zoom-out → fills the track edge-to-edge
  const leftPct = pos * (1 - e) * 100;  // 0 when full; tracks horizontal scroll as it shrinks

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-0.5 z-30" style={style}>
      <div ref={trackRef} className="relative w-full h-[7px]">
        <button
          ref={btnRef}
          type="button"
          aria-label="Canvas overview — drag to pan"
          disabled={!hOverflow}
          onPointerDown={ev => {
            if (!hOverflow) return;
            dragRef.current = { startX: ev.clientX, startScroll: targetRef.current?.scrollLeft ?? 0 };
            document.body.style.userSelect = 'none';
          }}
          className="pointer-events-auto absolute bottom-0 h-[7px] rounded-full bg-transparent border border-line-strong enabled:hover:border-fg-3 enabled:cursor-grab enabled:active:cursor-grabbing transition-[border-color] duration-[var(--dur-base)] motion-reduce:transition-none focus-ring"
          style={{ width: `${widthPct}%`, minWidth: BALL, left: `${leftPct}%` }}
        />
      </div>
    </div>,
    document.body,
  );
}
