'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Attach a non-passive `wheel` listener to a scroll element via a REF CALLBACK instead of a
 * `useEffect(() => el.addEventListener('wheel', …, { passive: false }), [])`. In optimized production
 * builds that effect-based pattern does not reliably bind the listener (it works in `next dev`), so
 * ctrl/pinch zoom falls through to the browser's own page zoom. A ref callback runs during commit — the
 * instant the node mounts — so the listener always tracks the live node.
 *
 * The node is also forwarded into `targetRef.current` so existing reads of that ref (size observers,
 * focal math, child `targetRef`s) keep working unchanged. Use the returned callback as the element's
 * `ref={…}` in place of the plain ref object.
 */
export function useWheelZoom<T extends HTMLElement>(
  targetRef: RefObject<T | null>,
  onWheel: (e: WheelEvent) => void,
): (node: T | null) => void {
  // Keep the latest handler without changing the ref-callback identity (so React doesn't detach/reattach
  // on every render). The listener always calls through to the current handler.
  const handlerRef = useRef(onWheel);
  useEffect(() => { handlerRef.current = onWheel; });   // keep the latest handler without re-binding
  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    // Detach from any previous node first (handles node swaps and React's null call on unmount).
    detachRef.current?.();
    detachRef.current = null;
    targetRef.current = node;
    if (!node) return;
    const listener = (e: WheelEvent) => handlerRef.current(e);
    node.addEventListener('wheel', listener, { passive: false });
    detachRef.current = () => node.removeEventListener('wheel', listener);
  }, [targetRef]);
}
