'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface ElementSize { width: number; height: number; }

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Observe an EXISTING ref's content-box size (so callers that already hold a scroll-area ref can
// measure it without a second ref). Measures synchronously before first paint, then stays live via
// a ResizeObserver.
export function useObservedSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  // Synchronous content-box measure before the first paint, so consumers (e.g. the canvas fit-scale)
  // have the real size on frame one. Without this, size starts {0,0} → the canvas renders at the
  // fallback zoom and then visibly zooms to the correct fit once the ResizeObserver fires next frame.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setSize({
      width:  el.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      height: el.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom),
    });
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      // Ignore a collapsed (0×0) measurement — a display:none consumer (e.g. the reel canvas hidden in
      // Pipeline view) would otherwise zero out the fit-scale and jump the pan on the way back.
      if (box && (box.width > 0 || box.height > 0)) setSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Measures an element's content-box size via ResizeObserver. Used by the editors to size the
// canvas to the available lane (viewport minus the fixed side panels) so it fits any desktop.
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      // Ignore a collapsed (0×0) measurement — a display:none consumer (e.g. the reel canvas hidden in
      // Pipeline view) would otherwise zero out the fit-scale and jump the pan on the way back.
      if (box && (box.width > 0 || box.height > 0)) setSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}

// Compute the canvas display scale that fits a base WxH preview into the measured lane, capped so it
// neither balloons on 4K nor collapses on tiny screens. Fits BOTH dimensions (min) so a tall canvas
// doesn't overflow a short laptop viewport. Returns 1 until the lane is measured (avoids a flash).
export const FIT_MIN = 0.62;   // ~254px min card width before the lane scrolls instead
export const FIT_MAX = 1.6;    // cap: a single 410px card tops out at ~655px wide
export const LANE_GUTTER = 32; // the editors' px-4 ×2
export const LANE_VPAD = 56;   // py-6 ×2 + a little breathing room

export function fitScaleFor(lane: ElementSize, baseW: number, baseH: number): number {
  if (lane.width <= 0) return 1;
  const widthFit = (lane.width - LANE_GUTTER) / baseW;
  const heightFit = lane.height > 0 ? (lane.height - LANE_VPAD) / baseH : Infinity;
  const fit = Math.min(widthFit, heightFit, FIT_MAX);
  return Math.max(FIT_MIN, fit);
}
