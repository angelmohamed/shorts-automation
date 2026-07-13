import type { ImageOverlay } from '../types';

// Image overlays with an optional progressive "reveal": the image un-crops downward step by step
// (a step per narrated line), with a short eased transition between steps. Shared by the live
// preview draw loop and the exporter so both composite identically.

const TRANSITION_S = 0.35;   // seconds one reveal step takes to ease open
const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Visible fraction (0..1, top-anchored) of an overlay at source time `t`. No reveal steps = fully visible. */
export function overlayRevealFraction(o: ImageOverlay, t: number): number {
  const steps = o.reveals;
  if (!steps || steps.length === 0) return 1;
  let k = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].t <= t) k = i; else break;
  }
  // Before the first step fires, the first block is already visible — a narrated meme opens on its
  // first row, not on a blank card.
  if (k < 0) return clamp01(steps[0].h);
  const cur = steps[k];
  const prev = k > 0 ? steps[k - 1].h : cur.h;
  const u = clamp01((t - cur.t) / TRANSITION_S);
  return clamp01(prev + (cur.h - prev) * easeOutCubic(u));
}

/** Draw every overlay visible at source time `t`, applying its reveal crop. Topmost layer. */
export function drawImageOverlays(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlays: ImageOverlay[],
  imgs: Map<string, HTMLImageElement>,
  t: number,
): void {
  for (const o of overlays) {
    if (t < o.start || t > o.end) continue;
    const img = imgs.get(o.id);
    if (!img || !img.complete || img.naturalWidth <= 0) continue;
    const f = overlayRevealFraction(o, t);
    if (f <= 0.001) continue;
    ctx.drawImage(
      img,
      0, 0, img.naturalWidth, Math.max(1, img.naturalHeight * f),
      o.x, o.y, o.w, Math.max(1, o.h * f),
    );
  }
}
