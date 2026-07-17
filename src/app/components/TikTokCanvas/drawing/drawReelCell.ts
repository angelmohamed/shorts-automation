import type { MutableRefObject } from 'react';
import type { ReelsCell, TwitterTemplateSettings, ImageStyle, TextStyle, BannerStyle, FreeElement } from '../../twitterTemplateTypes';
import { resolveCarouselFont } from '../../customFonts';
import { ensureFontLoaded } from '../../TemplateEditorCanvas/drawing/helpers';
import { CANVAS_W, CANVAS_H } from '../constants';
import { drawHeaderOnContext, computeSonotradeHeaderHeight, sonotradeBannerBox, drawPictureIcon } from './drawHeader';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SAMPLE_TEXT = 'This is how your caption will look on every reel you brand with this template.';
const PADDING_DEFAULT = 60;   // default OUTER padding: cells + video inset from the canvas edges (settings.cellMargin)
const CELL_GAP = 40;      // fixed gap between the two stacked cells (not affected by the padding)
const VIDEO_GAP = 40;     // fixed gap between the cells and the video band (not affected by the padding)
const CELL_RADIUS = 24;   // rounded corners on cell image/placeholder boxes
const TEXT_PAD = 0;       // horizontal inset for text: 0 = spans the full element width; left/right align sit flush to the edges
export const DEFAULT_TEXT_FONT = 'Libre Franklin';   // default font family for a text cell with no per-cell fontLabel

// ── Feature flag ────────────────────────────────────────────────────────────────────────────────────
// The four premade cell drop-zones + their settings islands are DISABLED while we trial a purely free-form
// canvas (drag items anywhere). Flip this to `true` to bring cells back — ALL the cell machinery is kept
// intact behind this one flag (rendering here, the drop-zones in TwitterTemplateEditor, the settings
// islands in TwitterSettingsPanel, and the cell defaults). Nothing was deleted, only gated.
export const REELS_CELLS_ENABLED: boolean = false;

// Canonical per-cell style defaults — what "Reset to defaults" stamps onto a cell, so the result is the
// authentic default look regardless of the template-level settings. These mirror the fallbacks used by
// drawCellText / drawCellImage / drawHeader exactly.
export function defaultBannerStyle(): BannerStyle {
  return {
    showAvatar: true, avatarShape: 'circle',
    avatarStroke: true, avatarStrokeColor: '#ffffff', avatarStrokeWidth: 3,
    avatarImageScale: 1, avatarOffsetX: 0, avatarOffsetY: 0, avatarSize: 108,
    showName: true, nameColor: '#e7e9ea', nameFontSize: 42,
    showHandle: true, handleColor: '#71767b', handleFontSize: 40,
    showVerified: true,
    defaultDisplayName: null, defaultHandle: null,
    headerPaddingX: 40, headerPaddingTop: 18, nameHandleGap: 10, nameHandleOffsetX: 0, nameHandleOffsetY: -5,
  };
}
export function defaultTextStyle(): TextStyle {
  return {
    fontLabel: DEFAULT_TEXT_FONT, fontSize: 42, fontWeight: 600, italic: false, allCaps: false,
    color: '#ffffff', align: 'center', letterSpacing: 0, lineHeight: 15, opacity: 100,
  };
}
export function defaultImageStyle(): ImageStyle {
  return {
    fit: 'cover', cornerRadius: 24, imageScale: 1, offsetX: 0, offsetY: 0,
    border: false, borderColor: '#ffffff', borderWidth: 8,
  };
}

// Defaults for a newly-dropped "Banner + text" free element specifically — matches the house style
// already in use across existing reel templates (tighter avatar stroke/gap, left-aligned Inter body
// text). Kept separate from defaultBannerStyle/defaultTextStyle above (which back the standalone
// Banner/Text elements and the legacy per-cell "Reset to defaults") so this doesn't change those.
export function defaultBannerTextBannerStyle(): BannerStyle {
  return {
    showAvatar: true, avatarShape: 'circle',
    avatarStroke: false, avatarStrokeColor: '#ffffff', avatarStrokeWidth: 1,
    avatarImageScale: 1, avatarOffsetX: 0, avatarOffsetY: 0, avatarSize: 107,
    showName: true, nameColor: '#e7e9ea', nameFontSize: 40,
    showHandle: true, handleColor: '#71767b', handleFontSize: 40,
    showVerified: true,
    defaultDisplayName: null, defaultHandle: null,
    headerPaddingX: 0, headerPaddingTop: 18, nameHandleGap: 7, nameHandleOffsetX: 0, nameHandleOffsetY: 0,
  };
}
export function defaultBannerTextTextStyle(): TextStyle {
  return {
    fontLabel: 'Inter', fontSize: 40, fontWeight: 500, italic: false, allCaps: false,
    color: '#ffffff', align: 'left', letterSpacing: 0, lineHeight: 21, opacity: 100,
  };
}
export const DEFAULT_BANNER_TEXT_GAP = 37;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// The reel layout: a centred video band with two equal cells above and below it. Shared by the
// editor preview AND the real reel pipeline so they can't diverge.
export interface ReelLayout { bandX: number; bandY: number; bandW: number; bandH: number; cellH: number; pad: number; }
export function reelLayout(s: TwitterTemplateSettings): ReelLayout {
  const bandH = s.videoBandHeight ?? 900;
  const pad = s.cellMargin ?? PADDING_DEFAULT;   // one outer padding for cells AND the video band
  const cellH = Math.max(0, (CANVAS_H - bandH) / 2);
  return { bandX: pad, bandY: cellH, bandW: CANVAS_W - pad * 2, bandH, cellH, pad };
}

// Cover-fit a video of (vw×vh) into the band, applying the manual zoom (scaleMul) + pan (ox/oy).
export function reelVideoRect(vw: number, vh: number, L: ReelLayout, scaleMul: number, ox: number, oy: number) {
  const scale = Math.max(L.bandW / vw, L.bandH / vh) * scaleMul;
  const dw = vw * scale, dh = vh * scale;
  return { dx: L.bandX + (L.bandW - dw) / 2 + ox, dy: L.bandY + (L.bandH - dh) / 2 + oy, dw, dh };
}

// Each side of the video splits into two stacked equal cells.
export type ReelCellKey = 'top' | 'top2' | 'bottom' | 'bottom2';

// The four cell rectangles. Each is its full slot inset by CELL_MARGIN on every side, so the cell IS
// the visible box and the margins are the gaps between cells. Single source of truth for editor +
// pipeline.
export function reelCellRegionRects(L: ReelLayout): { key: ReelCellKey; x: number; y: number; w: number; h: number }[] {
  // P (outer padding) insets the cells from the canvas top/bottom/sides only. The video gap and the
  // inter-cell gap are FIXED, so the two cells stay equal — they just resize as P changes.
  const P = L.pad;
  const bottomY = L.cellH + L.bandH;
  const x = P, w = Math.max(0, CANVAS_W - P * 2);
  const h = Math.max(0, (L.cellH - P - VIDEO_GAP - CELL_GAP) / 2);   // equal cell height
  return [
    { key: 'top',     x, y: P,                                  w, h },   // outer top
    { key: 'top2',    x, y: P + h + CELL_GAP,                   w, h },   // CELL_GAP below top, VIDEO_GAP above the band
    { key: 'bottom',  x, y: bottomY + VIDEO_GAP,                w, h },   // VIDEO_GAP below the band
    { key: 'bottom2', x, y: bottomY + VIDEO_GAP + h + CELL_GAP, w, h },   // CELL_GAP below bottom, outer bottom = P
  ];
}

// The cell a key resolves to (top defaults to a banner so the logo/name/handle still shows by default).
export function reelCellOf(s: TwitterTemplateSettings, key: ReelCellKey): ReelsCell | undefined {
  if (key === 'top') return s.cellTop ?? { type: 'banner' };
  if (key === 'top2') return s.cellTop2;
  if (key === 'bottom') return s.cellBottom;
  return s.cellBottom2;
}

// Ensure every text cell's font (family + weight + italic) is loaded so the canvas renders it instead of a
// fallback. Shared by the editor preview, the live canvas, and the export recorder. Resolves when all ready.
export async function ensureReelTextFontsLoaded(s: TwitterTemplateSettings): Promise<void> {
  const items = [s.cellTop, s.cellTop2, s.cellBottom, s.cellBottom2, ...(s.freeElements ?? [])];
  await Promise.all(items.map(c => {
    if (c?.type !== 'text' && c?.type !== 'bannerText') return Promise.resolve();
    const t = c.textStyle ?? {};
    return ensureFontLoaded(resolveCarouselFont(t.fontLabel ?? DEFAULT_TEXT_FONT), t.fontWeight ?? 600, !!t.italic);
  }));
}

// Template/skeleton preview: the overlay (placeholder content) drawn over a "▶ Your video" band
// placeholder — what an empty reel looks like before a video is dropped in. Shared by the Reels
// template editor's live preview and the Reels grid's empty cards so the two can't diverge. The
// caller sets up the ctx scaling (it draws in 1080×1920 coordinates).
export function drawReelTemplatePreview(
  ctx: Ctx,
  s: TwitterTemplateSettings,
  o: {
    name: string; handle: string; logoSrc: string;
    logoImgRef: MutableRefObject<HTMLImageElement | null>;
    verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
    getCellImg: (url?: string) => HTMLImageElement | null;
    overlayCaption?: string;   // when set, caption text elements render it (else the editor sample shows)
    // Optional theme override for the EMPTY-state chrome only (base fill + "▶ Your video" band + label).
    // The default reel is full-bleed, so headerBgColor/#18181b never appear in a real reel — only in this
    // placeholder — so tinting them to the app theme keeps an empty reel cohesive without touching exports.
    chrome?: { bg?: string; band?: string; text?: string };
  },
): void {
  const L = reelLayout(s);
  ctx.fillStyle = o.chrome?.bg ?? s.headerBgColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawReelCells({ ctx, s, L, logoSrc: o.logoSrc, name: o.name, handle: o.handle, logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef, getCellImg: o.getCellImg, placeholder: true, overlayCaption: o.overlayCaption });
  const videoLayer = s.videoLayer ?? 0;
  drawFreeElements({ ctx, s, logoSrc: o.logoSrc, name: o.name, handle: o.handle, logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef, getCellImg: o.getCellImg, placeholder: true, overlayCaption: o.overlayCaption, to: videoLayer });
  // Centred video-band placeholder.
  ctx.fillStyle = o.chrome?.band ?? '#18181b';
  ctx.beginPath();
  ctx.roundRect(L.bandX, L.bandY, L.bandW, L.bandH, s.videoCornerRadius ?? 24);
  ctx.fill();
  ctx.fillStyle = o.chrome?.text ?? '#52525b';
  ctx.font = `500 40px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('▶  Your video', CANVAS_W / 2, L.bandY + L.bandH / 2);
  ctx.textAlign = 'left';
  drawFreeElements({ ctx, s, logoSrc: o.logoSrc, name: o.name, handle: o.handle, logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef, getCellImg: o.getCellImg, placeholder: true, overlayCaption: o.overlayCaption, from: videoLayer });
}

// Draw all four cells. Shared by the editor preview, the live canvas, and the recorder so their
// geometry can never diverge. `getCellImg(url)` returns a ready image for an 'image' cell (or null).
export function drawReelCells(o: {
  ctx: Ctx;
  s: TwitterTemplateSettings;
  L: ReelLayout;
  logoSrc: string; name: string; handle: string;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  getCellImg: (url?: string) => HTMLImageElement | null;
  placeholder?: boolean;
  overlayCaption?: string;   // per-post caption → overrides text cells' own text (see drawReelCell)
}): void {
  if (!REELS_CELLS_ENABLED) return;   // cells disabled → canvas is free-form only (free elements still draw)
  for (const reg of reelCellRegionRects(o.L)) {
    const cell = reelCellOf(o.s, reg.key);
    drawReelCell({
      ctx: o.ctx, cell, x: reg.x, y: reg.y, w: reg.w, h: reg.h, s: o.s,
      logoSrc: o.logoSrc, name: o.name, handle: o.handle,
      logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef,
      cellImg: o.getCellImg(cell?.type === 'image' ? cell.imageUrl : undefined),
      avatarImg: o.getCellImg((cell?.type === 'banner' || cell?.type === 'bannerText') ? cell.banner?.avatarUrl : undefined),
      placeholder: o.placeholder,
      overlayCaption: o.overlayCaption,
    });
  }
}

// When a reel's video is cropped vertically (the visible window `box` differs from the layout band), shift
// the free elements so their spacing to the video is preserved: elements ABOVE the band follow the TOP crop
// edge (box.y vs band top), elements BELOW follow the BOTTOM edge (box bottom vs band bottom). Classified by
// each element's centre relative to the band centre. Visual-only (per-reel crop) — the template is unchanged;
// when the box equals the layout band (no crop) the original array is returned untouched.
export function shiftFreeElementsForReelCrop(elements: FreeElement[], L: ReelLayout, box: { y: number; h: number }, s: TwitterTemplateSettings): FreeElement[] {
  const bandTop = L.bandY, bandBot = L.bandY + L.bandH;
  const topDelta = box.y - bandTop;                 // top edge moved down (+) / up (−)
  const botDelta = (box.y + box.h) - bandBot;       // bottom edge moved down (+) / up (−)
  if (!topDelta && !botDelta) return elements;
  const center = (bandTop + bandBot) / 2;
  return elements.map(el => {
    // Classify by the element's TEMPLATE-time centre (effectiveFreeElementHeight = the editor/sample height,
    // not the stale stored el.height the crop used to read). Which crop edge an element follows is a
    // template-level property, so it must stay stable across posts — we deliberately do NOT use the per-post
    // caption height here, or the same caption box could follow the top edge on a short post and the bottom
    // edge on a long one. (A banner has no per-post variance, so this is also its exact rendered centre.)
    const dy = (el.y + effectiveFreeElementHeight(el, s) / 2) < center ? topDelta : botDelta;
    return dy ? { ...el, y: el.y + dy } : el;
  });
}

// The element's height AS POSITIONED IN THE EDITOR — auto-fit for text/banner/bannerText (text/bannerText
// measure the editor SAMPLE via placeholder:true; a banner has no per-post variance so this is also its exact
// rendered height), the stored height otherwise. This is exactly what the editor's selection box uses, so the
// overlay and this can't drift. Callers reasoning about an element's TEMPLATE box (the editor overlay, the
// crop-edge classification) use this instead of the possibly-stale el.height. Banner/bannerText need `s` for
// the {...s, ...el.banner} merge. NOTE: the live draw (drawFreeElements) uses the per-post caption height for
// the actual render — this is intentionally the STABLE template height, not that.
export function effectiveFreeElementHeight(el: FreeElement, s: TwitterTemplateSettings): number {
  if (el.type === 'text') return measureReelTextBoxHeight(reelTextContent(el, { placeholder: true }).text, el.width, el.textStyle);
  if (el.type === 'bannerText') return measureReelBannerTextHeight(el, el.width, s);
  if (el.type === 'banner') return sonotradeBannerBox(el.banner ? { ...s, ...el.banner } : s).height;
  return el.height;
}

// The EXACT rect drawFreeElements draws a free element into — auto-height for text/banner/bannerText (with
// growDir + the banner stroke offsets), the stored rect otherwise. Single source of truth so callers that need
// the on-screen extent (e.g. the reels Center button) match the render EXACTLY, INCLUDING the actual per-post
// caption's wrapped line count: pass { overlayCaption, placeholder:false } and a text element measures the real
// caption (not the editor sample). A text element whose rendered text is empty returns h:0 (it isn't drawn).
export function reelFreeElementDrawnRect(
  ctx: Ctx,
  el: FreeElement,
  s: TwitterTemplateSettings,
  opts: { overlayCaption?: string; placeholder?: boolean },
): { x: number; y: number; w: number; h: number } {
  const w = el.width;
  if (el.type === 'text') {
    const text = reelTextContent(el, opts).text;
    if (!text.trim()) return { x: el.x, y: el.y, w, h: 0 };   // empty → not drawn
    const h = reelTextBoxHeight(ctx, text, w, el.textStyle);
    let y = el.y;
    if (el.textStyle?.growDir === 'up') {   // bottom-anchored: the box bottom stays put, grows upward
      const refH = reelTextBoxHeight(ctx, reelTextContent(el, { placeholder: true }).text, w, el.textStyle);
      y = el.y + refH - h;
    }
    return { x: el.x, y, w, h };
  }
  if (el.type === 'bannerText') {
    const bs: TwitterTemplateSettings = el.banner ? { ...s, ...el.banner } : s;
    const bbox = sonotradeBannerBox(bs);
    const h = reelBannerTextHeight(ctx, el, w, s, opts);
    let boxTop = el.y;
    if (el.textStyle?.growDir === 'up') {   // bottom-anchored: the box bottom stays put, grows upward
      const refH = reelBannerTextHeight(ctx, el, w, s, { placeholder: true });
      boxTop = el.y + refH - h;
    }
    // Shift the draw origin up/right so the avatar's stroke ring lands ON the box's top-left edge (same as a
    // standalone banner), so the selection box encloses the stroke. The text is placed below in the draw branch.
    return { x: el.x + bbox.leftInset, y: boxTop - bbox.topInset, w, h };
  }
  if (el.type === 'banner') {
    const bs: TwitterTemplateSettings = el.banner ? { ...s, ...el.banner } : s;
    const box = sonotradeBannerBox(bs);
    return { x: el.x + box.leftInset, y: el.y - box.topInset, w, h: box.height };
  }
  return { x: el.x, y: el.y, w, h: el.height };   // image
}

// Draw all free-form overlay elements (s.freeElements) on top, in array order. A FreeElement IS a ReelsCell
// (+ a rect), so each renders via drawReelCell at its own rect. Shared by the editor, live canvas, recorder.
export function drawFreeElements(o: {
  ctx: Ctx;
  s: TwitterTemplateSettings;
  logoSrc: string; name: string; handle: string;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  getCellImg: (url?: string) => HTMLImageElement | null;
  placeholder?: boolean;
  // Draw only freeElements[from..to) — lets the caller split the array so the video band can be drawn
  // BETWEEN two slices (the band as a reorderable z-layer). Defaults to the whole array.
  from?: number;
  to?: number;
  overlayCaption?: string;   // per-post caption → overrides text elements' own text (see drawReelCell)
}): void {
  const all = o.s.freeElements ?? [];
  for (const el of all.slice(o.from ?? 0, o.to ?? all.length)) {
    if (el.hidden) continue;   // hidden via the Layers panel → skip drawing (still listed in the panel to un-hide)
    // A text element auto-fits its height to its wrapped content (≥ 1 line) so the box hugs the text; every
    // other element uses its stored height. This MUST match the selection overlay's measurement (both go
    // through reelTextBoxHeight) so the box on canvas and the box you drag line up exactly.
    // The per-type rect (auto-height + growDir + banner stroke offsets) lives in reelFreeElementDrawnRect so
    // the Center button can measure the identical on-screen extent (incl. the actual caption's line count).
    const isAutoH = el.type === 'text' || el.type === 'bannerText' || el.type === 'banner';   // auto-fits its height
    const rect = reelFreeElementDrawnRect(o.ctx, el, o.s, { overlayCaption: o.overlayCaption, placeholder: o.placeholder });
    const drawX = rect.x, drawY = rect.y, h = rect.h;
    o.ctx.save();
    // Clip an image draw to its rect so an overflow can't paint over neighbours. Auto-height elements
    // (text, banner, bannerText) fit their box exactly, so they're left UNCLIPPED — otherwise a drop shadow
    // below the last line, or the avatar's outer stroke, would be sliced off by the tight box.
    if (!isAutoH) {
      o.ctx.beginPath();
      o.ctx.rect(drawX, drawY, el.width, h);
      o.ctx.clip();
    }
    drawReelCell({
      ctx: o.ctx, cell: el, x: drawX, y: drawY, w: el.width, h, s: o.s,
      logoSrc: o.logoSrc, name: o.name, handle: o.handle,
      logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef,
      cellImg: o.getCellImg(el.type === 'image' ? el.imageUrl : undefined),
      avatarImg: o.getCellImg((el.type === 'banner' || el.type === 'bannerText') ? el.banner?.avatarUrl : undefined),
      placeholder: o.placeholder,
      // A free banner floats over arbitrary content, so it must NOT paint its own opaque header-bg box.
      fillBg: false,
      overlayCaption: o.overlayCaption,
    });
    o.ctx.restore();
  }
}

export interface DrawReelCellOpts {
  ctx: Ctx;
  cell: ReelsCell | undefined;
  x: number; y: number; w: number; h: number;
  s: TwitterTemplateSettings;
  // Banner content (shared with the header overlay):
  logoSrc: string;
  name: string;
  handle: string;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  // Pre-loaded image for an 'image' cell (caller owns loading); null until ready.
  cellImg?: HTMLImageElement | null;
  // Pre-loaded custom avatar image for a 'banner' cell (overrides the brand logo); null until ready.
  avatarImg?: HTMLImageElement | null;
  // Editor-only: draw a dashed outline + label for empty/awaiting-image cells.
  placeholder?: boolean;
  // Banner only: paint the opaque header-bg rect (default true for cells; false for free banner elements).
  fillBg?: boolean;
  // Per-post caption text: when set (non-empty) it OVERRIDES every text element's own text, so the typed
  // reel caption renders on the reel. Empty/undefined → the element shows its own text (or the sample).
  overlayCaption?: string;
}

// Render one reel cell (banner / text / image / empty) into the given region. Vertically centres its
// content. Shared by the editor preview and the real reel pipeline so they can never diverge.
export function drawReelCell(o: DrawReelCellOpts): void {
  const { ctx, cell, x, y, w, h, s } = o;
  const type = cell?.type ?? 'empty';

  if (type === 'banner') {
    // Per-cell banner styling: merge this cell's overrides over the template defaults so each banner
    // cell can be styled independently, while any unset field inherits the template-level value. The
    // identity overrides layer on top of the already-resolved name/handle the caller passed in.
    const bs: TwitterTemplateSettings = cell?.banner ? { ...s, ...cell.banner } : s;
    const name = cell?.banner?.defaultDisplayName ?? o.name;
    const handle = cell?.banner?.defaultHandle ?? o.handle;
    // Draw the header at the passed origin (x, y) directly. The caller (drawFreeElements) positions it so the
    // box hugs the avatar + its stroke ring for ANY stroke width — there's nothing to centre (a free banner's
    // box is sized to the content; the only other caller, the cell path, is disabled behind REELS_CELLS_ENABLED).
    drawHeaderOnContext({
      ctx, cx: x, cy: y, cw: w,
      overlayCaption: '', overlayLogoSrc: o.logoSrc,
      overlayDisplayName: name, overlayHandle: handle, overlayVerified: true,
      logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef, avatarImg: o.avatarImg, s: bs, placeholder: o.placeholder,
      fillBg: o.fillBg,
    });
    return;
  }

  if (type === 'text') {
    // The text + whether it's an editor-only placeholder (caption vs custom) live in one helper so the
    // draw, the auto-height, and the selection overlay always agree. The box height auto-fits these lines
    // (see drawFreeElements), so the text always hugs its content — top-anchored, no vertical alignment.
    const { text } = reelTextContent(cell, { overlayCaption: o.overlayCaption, placeholder: o.placeholder });
    if (text) drawCellText(ctx, text, x, y, w, cell?.textStyle);
    return;
  }

  if (type === 'bannerText') {
    // Banner (avatar/name/handle) anchored at the TOP, then the rich text directly below it. The element's
    // height auto-fits banner + text (see reelBannerTextHeight / drawFreeElements), so it hugs its content.
    // The caller (reelFreeElementDrawnRect) already shifted (x, y) so the banner's stroke ring lands on the
    // box's top-left edge (like a standalone banner); the text then sits at the box's true left (x − leftInset),
    // below the banner box (whose bottom is y + topInset + height).
    const bs: TwitterTemplateSettings = cell?.banner ? { ...s, ...cell.banner } : s;
    const name = cell?.banner?.defaultDisplayName ?? o.name;
    const handle = cell?.banner?.defaultHandle ?? o.handle;
    const bbox = sonotradeBannerBox(bs);
    drawHeaderOnContext({
      ctx, cx: x, cy: y, cw: w,
      overlayCaption: '', overlayLogoSrc: o.logoSrc,
      overlayDisplayName: name, overlayHandle: handle, overlayVerified: true,
      logoImgRef: o.logoImgRef, verifiedImgRef: o.verifiedImgRef, avatarImg: o.avatarImg, s: bs, placeholder: o.placeholder,
      fillBg: o.fillBg,
    });
    const { text } = reelTextContent(cell, { overlayCaption: o.overlayCaption, placeholder: o.placeholder });
    if (text) drawCellText(ctx, text, x - bbox.leftInset, y + bbox.topInset + bbox.height + (cell?.bannerTextGap ?? 0), w, cell?.textStyle);
    return;
  }

  if (type === 'image') {
    const st = cell?.imageStyle;
    if (o.cellImg && o.cellImg.complete && o.cellImg.naturalWidth > 0) {
      drawCellImage(ctx, o.cellImg, x, y, w, h, st);
    } else if (o.placeholder) {
      drawImagePlaceholder(ctx, x, y, w, h, st?.cornerRadius ?? CELL_RADIUS);
    }
    return;
  }

  // empty
  if (o.placeholder) drawPlaceholder(ctx, x, y, w, h, 'Empty cell');
}

// The text a text cell/element renders, plus whether it's an editor-only placeholder. Centralizing the
// caption-vs-custom choice here keeps the draw, the auto-height, and the selection overlay in lockstep:
//  - caption element (default): the per-post caption; in the editor (placeholder) the sample sentence.
//  - custom element: its own typed text; in the editor (placeholder) a "Your text" stub when empty.
export function reelTextContent(
  cell: ReelsCell | undefined,
  opts: { overlayCaption?: string; placeholder?: boolean },
): { text: string; isPlaceholder: boolean } {
  const isCaption = cell?.isCaption ?? true;
  if (isCaption) {
    if (opts.overlayCaption?.trim()) return { text: opts.overlayCaption, isPlaceholder: false };
    return { text: opts.placeholder ? SAMPLE_TEXT : '', isPlaceholder: true };
  }
  if (cell?.text?.trim()) return { text: cell.text, isPlaceholder: false };
  return { text: opts.placeholder ? 'Your text' : '', isPlaceholder: true };
}

// Line height for a text style (font size scaled by the line-spacing setting). Shared by wrap + min height.
function reelTextLineHeight(st?: TextStyle): number {
  const fontSize = st?.fontSize ?? st?.captionFontSize ?? 42;
  return fontSize * (1 + ((st?.lineHeight ?? 15) / 100) * 1.2);
}

// Wrap `text` into lines for width `w` with style `st`. Sets the matching font + letter-spacing on `ctx` so
// measurement and drawing can never disagree; self-contained (save/restore) so callers needn't pre-set.
export function wrapReelText(ctx: Ctx, text: string, w: number, st?: TextStyle): { lines: { line: string; last: boolean }[]; lineH: number } {
  const font     = resolveCarouselFont(st?.fontLabel ?? DEFAULT_TEXT_FONT);
  const fontSize = st?.fontSize ?? st?.captionFontSize ?? 42;
  const weight   = st?.fontWeight ?? 600;
  const italic   = st?.italic ?? false;
  const lineH    = reelTextLineHeight(st);
  const maxW     = w - TEXT_PAD * 2;
  const sp = ctx as unknown as { letterSpacing?: string; wordSpacing?: string };
  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${font.css}`;
  sp.letterSpacing = `${st?.letterSpacing ?? 0}px`;   // measureText reflects this
  sp.wordSpacing = '0px';
  const src = st?.allCaps ? text.toUpperCase() : text;
  const lines: { line: string; last: boolean }[] = [];
  for (const para of src.split('\n')) {
    if (para === '') { lines.push({ line: '', last: true }); continue; }
    let cur = '';
    const wrapped: string[] = [];
    for (const word of para.split(' ')) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > maxW && cur) { wrapped.push(cur); cur = word; }
      else cur = test;
    }
    wrapped.push(cur);
    wrapped.forEach((wl, k) => lines.push({ line: wl, last: k === wrapped.length - 1 }));
  }
  sp.letterSpacing = '0px';
  sp.wordSpacing = '0px';
  ctx.restore();
  return { lines, lineH };
}

// Auto-height for a text box: the wrapped block height (lines × lineH), never less than one line. This is
// what makes a text element hug its content — add a line and it grows, remove one and it shrinks.
export function reelTextBoxHeight(ctx: Ctx, text: string, w: number, st?: TextStyle): number {
  const lineH = reelTextLineHeight(st);
  if (!text.trim()) return lineH;
  return Math.max(1, wrapReelText(ctx, text, w, st).lines.length) * lineH;
}

// Overlay-side height (no draw ctx handy): measure on a shared offscreen canvas. Falls back to one line if
// the canvas API is unavailable (SSR) so the selection box still renders sensibly.
let _measureCtx: CanvasRenderingContext2D | null | undefined;
function ensureMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx === undefined) {
    _measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  return _measureCtx;
}
export function measureReelTextBoxHeight(text: string, w: number, st?: TextStyle): number {
  const ctx = ensureMeasureCtx();
  return ctx ? reelTextBoxHeight(ctx, text, w, st) : reelTextLineHeight(st);
}

// Auto-height for a 'bannerText' element: the banner header height (avatar/name/handle) + the rich text
// height below it. Shared by the draw (drawFreeElements passes its ctx) and the selection overlay
// (measureReelBannerTextHeight uses the offscreen ctx) so the on-canvas box and the drag box agree.
export function reelBannerTextHeight(ctx: Ctx, cell: ReelsCell | undefined, w: number, s: TwitterTemplateSettings, opts: { overlayCaption?: string; placeholder?: boolean }): number {
  const bs: TwitterTemplateSettings = cell?.banner ? { ...s, ...cell.banner } : s;
  // The banner part is sized like a standalone banner — the avatar + its stroke RING (stroke-aware), so the
  // box encloses the ring (NOT computeSonotradeHeaderHeight, which ignores the stroke and adds top padding).
  const bannerH = sonotradeBannerBox(bs).height;
  const { text } = reelTextContent(cell, opts);
  return bannerH + (text ? (cell?.bannerTextGap ?? 0) + reelTextBoxHeight(ctx, text, w, cell?.textStyle) : 0);
}
export function measureReelBannerTextHeight(cell: ReelsCell | undefined, w: number, s: TwitterTemplateSettings): number {
  const ctx = ensureMeasureCtx();
  if (!ctx) return reelTextLineHeight(cell?.textStyle);   // SSR fallback
  return reelBannerTextHeight(ctx, cell, w, s, { placeholder: true });
}
// Just the banner header height (avatar/name/handle, no caption). Used by the editor's avatar-drop hint on a
// bannerText element, where the banner sits at the TOP (not centred), to place the avatar highlight.
export function reelBannerHeight(s: TwitterTemplateSettings): number {
  const ctx = ensureMeasureCtx();
  return ctx ? computeSonotradeHeaderHeight(ctx, '', s) : 148;   // 148 = paddingTop 18 + avatar 108 + margin 22
}

// Render a text cell/element with the full carousel-style text styling (font family/weight/italic/caps,
// colour, letter + line spacing, alignment incl. justify, opacity, drop shadow). The box auto-fits the
// content (see reelTextBoxHeight), so the text is top-anchored — no vertical alignment. Shares the
// carousel's font list via resolveCarouselFont; the chosen font must be loaded (editor/live/recorder each
// ensureFontLoaded before drawing) or the canvas falls back to a system font.
function drawCellText(ctx: Ctx, text: string, x: number, y: number, w: number, st?: TextStyle): void {
  if (!text.trim()) return;
  const font     = resolveCarouselFont(st?.fontLabel ?? DEFAULT_TEXT_FONT);
  const fontSize = st?.fontSize ?? st?.captionFontSize ?? 42;
  const weight   = st?.fontWeight ?? 600;
  const italic   = st?.italic ?? false;
  const align    = st?.align ?? 'center';
  const maxW     = w - TEXT_PAD * 2;
  const sp = ctx as unknown as { letterSpacing?: string; wordSpacing?: string };

  // Wrap first — shared with the auto-height measurement so the box hugs exactly these lines.
  const { lines, lineH } = wrapReelText(ctx, text, w, st);

  ctx.save();
  ctx.globalAlpha = (st?.opacity ?? 100) / 100;
  if (st?.shadow?.enabled) {
    const sh = st.shadow;
    const hx = sh.color.replace('#', '');
    const r = parseInt(hx.slice(0, 2), 16), g = parseInt(hx.slice(2, 4), 16), b = parseInt(hx.slice(4, 6), 16);
    ctx.shadowColor = `rgba(${r},${g},${b},${(sh.opacity / 100).toFixed(3)})`;
    ctx.shadowBlur = sh.blur; ctx.shadowOffsetX = sh.offsetX; ctx.shadowOffsetY = sh.offsetY;
  }
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${font.css}`;
  // Sample/placeholder text (editor + posting preview) renders with the element's REAL styling — colour,
  // opacity AND drop shadow — so the chosen look is previewed faithfully, identical to a real reel.
  ctx.fillStyle = st?.color ?? st?.captionColor ?? '#ffffff';
  ctx.textBaseline = 'top';
  sp.letterSpacing = `${st?.letterSpacing ?? 0}px`;   // measureText below reflects this
  sp.wordSpacing = '0px';

  // The box auto-fits the content, so the text simply starts at the top edge (top-anchored, no vAlign).
  let ty = y;
  for (const { line, last } of lines) {
    if (align === 'justify' && !last) {
      // stretch word gaps to fill the width; a single-word line stays left-flush (gaps=0), like the carousel
      ctx.textAlign = 'left';
      const natural = ctx.measureText(line).width;
      const gaps = (line.match(/ /g) || []).length;
      sp.wordSpacing = gaps > 0 && maxW > natural ? `${((maxW - natural) / gaps).toFixed(2)}px` : '0px';
      ctx.fillText(line, x + TEXT_PAD, ty);
      sp.wordSpacing = '0px';
    } else {
      // justify's final (short) line is centred, matching the carousel
      const a = align === 'justify' ? 'center' : align;
      ctx.textAlign = a === 'center' ? 'center' : a === 'right' ? 'right' : 'left';
      const ax = a === 'center' ? x + w / 2 : a === 'right' ? x + w - TEXT_PAD : x + TEXT_PAD;
      ctx.fillText(line, ax, ty);
    }
    ty += lineH;
  }
  sp.letterSpacing = '0px';
  sp.wordSpacing = '0px';
  ctx.restore();
}

function drawCellImage(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number, st?: ImageStyle): void {
  if (w <= 0 || h <= 0) return;
  const radius = st?.cornerRadius ?? CELL_RADIUS;
  const fit = st?.fit ?? 'cover';
  const iw = img.naturalWidth, ih = img.naturalHeight;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);   // fill the whole cell region
  ctx.clip();
  // Cell background — shows wherever the image doesn't cover the cell (contain letterbox, or a cover image
  // zoomed below 1). When unset, the canvas headerBgColor already painted underneath shows through, so the
  // panel control + the Adjust cropper both default their swatch to headerBgColor to stay 1:1 with this.
  if (st?.bgColor) { ctx.fillStyle = st.bgColor; ctx.fillRect(x, y, w, h); }
  if (fit === 'contain') {
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    // object-fit: cover, with optional zoom + normalized pan (matches the Adjust cropper 1:1).
    const zoom = st?.imageScale ?? 1;
    const oX = Math.max(-1, Math.min(1, st?.offsetX ?? 0));
    const oY = Math.max(-1, Math.min(1, st?.offsetY ?? 0));
    const cover = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * cover, dh = ih * cover;
    const dx = x + (w - dw) / 2 + (oX * Math.abs(dw - w)) / 2;
    const dy = y + (h - dh) / 2 + (oY * Math.abs(dh - h)) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.restore();

  // Optional border ring — drawn just INSIDE the cell edge so it never bleeds into the inter-cell gaps.
  const bw = st?.borderWidth ?? 8;
  if (st?.border && bw > 0) {
    const off = bw / 2;
    ctx.save();
    ctx.lineWidth = bw;
    ctx.strokeStyle = st.borderColor ?? '#ffffff';
    ctx.beginPath();
    ctx.roundRect(x + off, y + off, w - bw, h - bw, Math.max(0, radius - off));
    ctx.stroke();
    ctx.restore();
  }
}

// Editor-only placeholder for an image cell with no URL yet — the SAME icon the avatar skeleton uses
// (drawPictureIcon, the single source) on a gray box, so the two are identical.
function drawImagePlaceholder(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number = CELL_RADIUS): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = '#18181b';
  ctx.fill();
  const size = Math.min(w, h) * 0.42;
  drawPictureIcon(ctx, x + (w - size) / 2, y + (h - size) / 2, size, '#d4d4d8');
  ctx.restore();
}

function drawPlaceholder(ctx: Ctx, x: number, y: number, w: number, h: number, label: string): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, CELL_RADIUS);   // fill the whole cell region
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#52525b';
  ctx.font = `500 38px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.restore();
}
