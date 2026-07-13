'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useWheelZoom } from './useWheelZoom';

export const EDITOR_ZOOM_MIN = 0.5;
export const EDITOR_ZOOM_MAX = 2.5;

/**
 * Shared zoom/pan scaffolding for the canvas editors (Carousels, Reels template editor, Reels
 * posting): focal-point-anchored zoom driven by trackpad pinch / Ctrl+scroll, with a one-shot
 * default landing at ABSOLUTE 100% (viewScale = 1/fitFactor, so the rendered scale is exactly
 * native size) once the lane is measured.
 *
 * The caller owns the fit factor (live vs frozen-at-first-measure) and renders with
 * `zoom: fitFactor * viewScale`; this hook owns viewScale, the focal math, and the wheel binding.
 */
export function useEditorZoomPan({
  scrollRef,
  contentRef,
  fitFactor,
  laneWidth,
  initialViewScale = 1,
  skipAutoInit = false,
  refocusKey,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;   // the scrollable lane
  contentRef: RefObject<HTMLDivElement | null>;  // the zoomed content inside it
  fitFactor: number;                             // fit-to-lane scale (caller decides live vs frozen)
  laneWidth: number;                             // 0 until the lane measures — gates the one-shot init
  initialViewScale?: number;                     // e.g. the pinned automations overlay's smaller default
  skipAutoInit?: boolean;                        // keep initialViewScale instead of landing at 100%
  refocusKey?: unknown;                          // bump to re-centre (e.g. the active template id)
}) {
  const [viewScale, setViewScale] = useState(initialViewScale);
  // Content-fraction (0..1 per axis) currently under the viewport centre — the zoom focal point.
  const zoomFocalRef = useRef({ fx: 0.5, fy: 0.5 });

  // Land the default at ABSOLUTE 100% once the lane is measured. One-shot — after that the user
  // owns the zoom.
  const zoomInitRef = useRef(false);
  useEffect(() => {
    if (zoomInitRef.current || skipAutoInit || laneWidth <= 0) return;
    zoomInitRef.current = true;
    setViewScale(Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, 1 / fitFactor)));
  }, [laneWidth, fitFactor, skipAutoInit]);

  // Capture the focal point (content-fraction under the viewport centre) from the LIVE DOM. Called
  // right before every zoom change so it always reflects the current pan. Reading it live (rather than
  // tracking it on scroll) avoids staleness when an axis doesn't overflow — with no scroll events the
  // tracked value would keep a stale fraction and the next zoom would slam the scroll toward it.
  const captureFocal = useCallback(() => {
    const el = scrollRef.current, content = contentRef.current;
    if (!el || !content) return;
    const vr = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) {
      zoomFocalRef.current = {
        fx: (vr.left + vr.width / 2 - cr.left) / cr.width,
        fy: (vr.top + vr.height / 2 - cr.top) / cr.height,
      };
    }
  }, [scrollRef, contentRef]);

  // On every zoom / fit change (and refocusKey bump), keep the focal point under the viewport
  // centre — but as the canvas approaches "fits" (remaining overflow shrinking), EASE the target
  // toward the centred position so it lands exactly centred at the boundary instead of snapping.
  // Zoom-in stays anchored to your point; zoom-out glides smoothly to centre right as the canvas
  // fits. useLayoutEffect = no flash.
  useLayoutEffect(() => {
    const el = scrollRef.current, content = contentRef.current;
    if (!el || !content) return;
    const vr = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    if (cr.width <= 0 || cr.height <= 0) return;
    // Per-axis scroll that would centre the focal point.
    const focalX = el.scrollLeft + (cr.left + zoomFocalRef.current.fx * cr.width)  - (vr.left + vr.width / 2);
    const focalY = el.scrollTop  + (cr.top  + zoomFocalRef.current.fy * cr.height) - (vr.top + vr.height / 2);
    // Blend the focal target toward the centred position as the REMAINING overflow shrinks below
    // `soft` (half a viewport), reaching fully-centred exactly when the canvas fits. This guarantees
    // we arrive centred at the fit boundary (no snap), while staying fully anchored to the focal point
    // whenever there's more than `soft` of overflow left to pan through.
    const ease = (focal: number, max: number, soft: number) => {
      if (max <= 0) return 0;                                   // axis fits → centred
      const clamped = Math.max(0, Math.min(max, focal));
      const w = soft > 0 ? Math.max(0, Math.min(1, 1 - max / soft)) : 1;
      return clamped * (1 - w) + (max / 2) * w;
    };
    el.scrollLeft = ease(focalX, el.scrollWidth - el.clientWidth, el.clientWidth / 2);
    el.scrollTop  = ease(focalY, el.scrollHeight - el.clientHeight, el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewScale, fitFactor, refocusKey]);

  // Trackpad pinch / Ctrl+scroll zooms the preview (arrives as a wheel event with ctrlKey set).
  // Plain two-finger scroll is left to the browser, which scrolls the canvas natively — that's the
  // ONLY way pure-horizontal swipes pan reliably: a manual wheel handler never receives those events
  // because Chrome reserves a pure-horizontal swipe for back/forward navigation. overscroll-contain
  // on the scroll area (+ overscroll-x:none on <html>/<body>) keeps that navigation suppressed.
  // Ref callback (attachScroll → ref on the scroll div), NOT useEffect: the effect-based
  // addEventListener('wheel', …, {passive:false}) doesn't reliably bind in production builds, so
  // ctrl/pinch zoom fell through to the browser's page zoom. Exponential zoom (smooth + symmetric);
  // delta clamped so a coarse wheel notch doesn't jump while a fine trackpad pinch stays responsive.
  const attachScroll = useWheelZoom<HTMLDivElement>(scrollRef, e => {
    if (!e.ctrlKey) return;   // normal two-finger / wheel scroll → let the browser scroll natively
    e.preventDefault();
    captureFocal();   // anchor the zoom on the current view centre (read live, never stale)
    const dy = Math.max(-10, Math.min(10, e.deltaY));   // clamp: a mouse-wheel notch is a gentle ~16% step, not a 2× jump (pinch deltas are < 10, so unaffected)
    setViewScale(v => Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, v * Math.exp(-dy * 0.015))));
  });

  return { viewScale, setViewScale, captureFocal, attachScroll };
}
