'use client';

import { useRef, useReducer, useEffect, useLayoutEffect } from 'react';
import { CANVAS_W, CANVAS_H, VERIFIED_TICK_SVG } from './TikTokCanvas/constants';
import { drawReelTemplatePreview } from './TikTokCanvas/drawing/drawReelCell';
import type { TwitterTemplateSettings } from './twitterTemplateTypes';
import type { BrandProps } from '../types';

// Read-only "what an empty reel will look like" preview: the active reel template's overlay drawn over
// a video-band placeholder (▶ Your video), shown in the Reels grid until a real video is dropped in.
// Uses the shared drawReelTemplatePreview so it matches the template editor's live preview exactly.
// The canvas is supersampled 2× for crisp text and displayed at `width` (height derives from 9:16).
const PREVIEW_SS = 2;

export function ReelTemplatePreview({ settings, brand, width, overlayCaption }: {
  settings: TwitterTemplateSettings;
  brand: BrandProps;
  width: number;
  overlayCaption?: string;   // typed per-reel caption → replaces the sample on caption text elements
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);   // preview always renders the avatar as a skeleton
  const verifiedRef = useRef<HTMLImageElement | null>(null);
  const cellImgRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [tick, force] = useReducer(x => x + 1, 0);

  const name = settings.defaultDisplayName || brand.displayName || 'Your name';
  const handle = settings.defaultHandle || brand.handle || '@yourhandle';

  // Verified badge — redraw once it loads.
  useEffect(() => {
    const img = new Image();
    img.onload = force;
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(VERIFIED_TICK_SVG)}`;
    verifiedRef.current = img;
  }, []);

  // Header font (name/handle render in Libre Franklin) — a canvas won't lazy-load it, so load + redraw.
  useEffect(() => {
    let cancelled = false;
    document.fonts.load('700 40px "Libre Franklin"').then(() => { if (!cancelled) force(); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Preload any cell / free-element images so the overlay shows them (placeholder until they arrive).
  useEffect(() => {
    for (const cell of [settings.cellTop, settings.cellTop2, settings.cellBottom, settings.cellBottom2, ...(settings.freeElements ?? [])]) {
      const url = cell?.type === 'image' ? cell.imageUrl : (cell?.type === 'banner' || cell?.type === 'bannerText') ? cell.banner?.avatarUrl : undefined;
      if (!url || cellImgRef.current.has(url)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = force;
      img.src = url;
      cellImgRef.current.set(url, img);
    }
  }, [settings.cellTop, settings.cellTop2, settings.cellBottom, settings.cellBottom2, settings.freeElements]);

  // useLayoutEffect: draw before paint so a freshly-mounted card shows the reel on its first frame.
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(PREVIEW_SS, 0, 0, PREVIEW_SS, 0, 0);   // map 1080-space drawing onto the 2× buffer
    const getCellImg = (url?: string) => {
      const img = url ? cellImgRef.current.get(url) : undefined;
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    };
    drawReelTemplatePreview(ctx, settings, { name, handle, logoSrc: '', logoImgRef: logoRef, verifiedImgRef: verifiedRef, getCellImg, overlayCaption });
  }, [settings, name, handle, overlayCaption, tick]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W * PREVIEW_SS}
      height={CANVAS_H * PREVIEW_SS}
      style={{ width, height: width * CANVAS_H / CANVAS_W }}
      className="block border border-line shadow-2"
    />
  );
}
