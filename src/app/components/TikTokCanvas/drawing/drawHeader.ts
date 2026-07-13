import {
  CANVAS_W,
  CAPTION_LINE_HEIGHT,
  SONOTRADE_PADDING_X,
  HEADER_PADDING_TOP,
  SONOTRADE_AVATAR_SIZE,
  VERIFIED_TICK_SVG,
} from '../constants';
import type { DrawHeaderOptions } from '../types';
import type { TwitterTemplateSettings } from '../../twitterTemplateTypes';
import { countSonotradeCaptionLines } from './countCaptionLines';

// The framed-photo "image" icon (the rail Image-chip glyph: rounded frame + sun + mountain), drawn from
// its 24×24 viewBox into a box of `size` at top-left (x, y). The SINGLE source for this icon — shared by
// the avatar skeleton and the image-cell placeholder so they're always identical.
export function drawPictureIcon(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, size: number, color: string,
): void {
  const sc = size / 24;
  const px = (vx: number) => x + vx * sc;
  const py = (vy: number) => y + vy * sc;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9 * sc;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();   // frame
  ctx.roundRect(px(3), py(4), 18 * sc, 16 * sc, 2 * sc);
  ctx.stroke();
  ctx.beginPath();   // sun
  ctx.arc(px(8.5), py(9.5), 1.5 * sc, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();   // mountain
  ctx.moveTo(px(21), py(16));
  ctx.lineTo(px(16), py(11));
  ctx.lineTo(px(5), py(20));
  ctx.stroke();
  ctx.restore();
}

const LIBRE = '"Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// ── Authentic-Twitter defaults (used when a template hasn't overridden the matching layout knob) ──
const AVATAR_RADIUS = 16;            // rounded-square corner at the default 108px avatar (≈ X's 40% rx)
const NAME_SIZE = 42;                // display-name size, scaled from Twitter's 15px @ ~390px → 1080px
const HANDLE_SIZE = 40;              // @handle size
const NAME_HANDLE_EXTRA = 10;        // baseline gap above the name size (the default 52 − 42)
const CAP_GAP = 24;                  // gap from the @handle baseline down to the caption
const AVATAR_TEXT_GAP = 28;          // gap from avatar right edge to the name/handle column
const AVATAR_BOTTOM_MARGIN = 22;     // space below the avatar with no caption (148 − 18 top − 108 avatar)
const CAPTION_BOTTOM_PAD = 39;       // space below the last caption baseline (the original 223 − 184)
const DEFAULT_CAPTION_RATIO = CAPTION_LINE_HEIGHT / 42;   // 55/42 ≈ 1.31

// The default (42px) caption uses a 55px line; keep that ratio (or the template's override) so a
// resized caption stays legible.
export const sonotradeCaptionFont = (s: TwitterTemplateSettings) => `400 ${s.captionFontSize}px ${LIBRE}`;
export const sonotradeCaptionLineHeight = (s: TwitterTemplateSettings) =>
  Math.round(s.captionFontSize * (s.captionLineHeight ?? DEFAULT_CAPTION_RATIO));

// Resolve the configurable layout geometry, falling back to the authentic-Twitter defaults so
// untouched templates render pixel-identically. Single source of truth shared by the height calc
// AND the draw, so they can never desync.
function sonotradeGeom(cx: number, cy: number, s: TwitterTemplateSettings) {
  const paddingX   = s.headerPaddingX   ?? SONOTRADE_PADDING_X;    // 65
  const paddingTop = s.headerPaddingTop ?? HEADER_PADDING_TOP;     // 18
  const avatarSize = s.avatarSize       ?? SONOTRADE_AVATAR_SIZE;  // 108
  const nameSize   = s.nameFontSize     ?? NAME_SIZE;              // 42
  const handleSize = s.handleFontSize   ?? HANDLE_SIZE;            // 40
  const capGap     = s.captionGap       ?? CAP_GAP;                // 24

  const nameHandleGap = s.nameHandleGap ?? NAME_HANDLE_EXTRA;      // 10 default — space between the rows
  const offX = s.nameHandleOffsetX ?? 0;                           // move the joined block horizontally
  const offY = s.nameHandleOffsetY ?? 0;                           // …and vertically
  const nameHandleLineH = nameSize + nameHandleGap;               // 52 at the defaults
  const blockH = nameHandleLineH + handleSize;                    // 92 default
  const avatarX = cx + paddingX;
  const avatarY = cy + paddingTop;
  const textX   = cx + paddingX + avatarSize + AVATAR_TEXT_GAP + offX;   // 201 default
  const blockTop = avatarY + (avatarSize - blockH) / 2 + offY;
  const nameBaseline   = blockTop + nameSize;
  const handleBaseline = nameBaseline + (nameHandleLineH - nameSize) + handleSize;
  const captionBaseline = handleBaseline + capGap + s.captionFontSize;
  const captionMaxW = CANVAS_W - paddingX * 2;

  return {
    paddingX, paddingTop, avatarSize, nameSize, handleSize,
    avatarX, avatarY, textX, nameBaseline, handleBaseline, captionBaseline, captionMaxW,
  };
}

// Single source of truth for the sonotrade header height — used by the live draw loop, the
// center-everything helper, AND the export path, so they can never desync.
export function computeSonotradeHeaderHeight(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  caption: string,
  s: TwitterTemplateSettings,
): number {
  const g = sonotradeGeom(0, 0, s);
  if (!caption) return Math.round(g.avatarY + g.avatarSize + AVATAR_BOTTOM_MARGIN);   // = paddingTop + avatarSize + 22
  const lines = countSonotradeCaptionLines(ctx, caption, sonotradeCaptionFont(s), g.captionMaxW);
  const capLineH = sonotradeCaptionLineHeight(s);
  const lastBaseline = g.captionBaseline + (lines - 1) * capLineH;
  return Math.round(lastBaseline + CAPTION_BOTTOM_PAD);
}

// The box that HUGS a standalone free 'banner' element exactly — just the avatar's own square, with NO top
// padding and NO bottom margin (the name/handle are vertically centred within the avatar, so the avatar is
// the full content extent). `topInset` is the gap from the header origin (cy) down to the avatar's top: a
// caller draws the header at cy = boxTop − topInset so the avatar's top lands ON the box's top edge, then
// sizes the box to `height` (the avatar's height) so its bottom lands on the avatar's bottom.
export function sonotradeBannerBox(s: TwitterTemplateSettings): { topInset: number; leftInset: number; height: number } {
  const g = sonotradeGeom(0, 0, s);
  // Enclose the avatar's outer stroke ring (drawn a full `strokeW` beyond the avatar edge on every side — the
  // ring path is offset by strokeW/2 and the line adds another strokeW/2):
  //  - topInset:  the header origin sits `topInset` above the box top, so the ring's outer top lands ON el.y.
  //  - leftInset: when the ring is wider than the left padding it would poke past the box's left edge, so shift
  //               the header right by the overflow (max(0, strokeW - paddingX)) to keep the ring inside.
  //  - height:    avatar + ring on top and bottom.
  // No stroke → pad 0 (box = the bare avatar, no shift).
  const strokeW = s.avatarStrokeWidth ?? 3;
  const pad = (s.avatarStroke && strokeW > 0) ? strokeW : 0;
  return {
    topInset: Math.round(g.avatarY - pad),
    leftInset: Math.round(Math.max(0, pad - g.paddingX)),
    height: Math.round(g.avatarSize + 2 * pad),
  };
}

// The avatar's rect (canvas coords) within a banner cell of the given region — so an editor drop overlay can
// land exactly on the rendered avatar. Banners use an empty caption, so no ctx/measurement is needed; this
// mirrors drawReelCell's banner branch (header centred in the cell) + sonotradeGeom's avatar position.
export function bannerAvatarRectInCell(cellX: number, cellY: number, cellH: number, s: TwitterTemplateSettings): { x: number; y: number; size: number } {
  const g0 = sonotradeGeom(0, 0, s);
  const headerH = Math.round(g0.avatarY + g0.avatarSize + AVATAR_BOTTOM_MARGIN);
  const cy = cellY + Math.max(0, (cellH - headerH) / 2);
  const g = sonotradeGeom(cellX, cy, s);
  return { x: g.avatarX, y: g.avatarY, size: g.avatarSize };
}

export function drawHeaderOnContext({
  ctx,
  cx,
  cy,
  cw,
  overlayCaption,
  overlayLogoSrc,
  overlayDisplayName,
  overlayHandle,
  overlayVerified,
  logoImgRef,
  verifiedImgRef,
  avatarImg,
  s,
  placeholder,
  fillBg,
}: DrawHeaderOptions): number {
  const g = sonotradeGeom(cx, cy, s);
  const headerHeight = computeSonotradeHeaderHeight(ctx, overlayCaption, s);

  // ── Background ──────────────────────────────────────────────────────────────
  // Skipped for free banner elements (fillBg === false) so they float over the video/content instead of
  // blanking it with an opaque box. Premade banner cells keep filling (the canvas bg is the same colour
  // underneath, so it's visually identical).
  if (fillBg !== false) {
    ctx.fillStyle = s.headerBgColor;
    ctx.fillRect(cx, cy, cw, headerHeight);
  }

  // ── Avatar ──────────────────────────────────────────────────────────────────
  const { avatarX, avatarY, avatarSize, textX, nameBaseline, handleBaseline, nameSize, handleSize } = g;

  if (s.showAvatar) {
    // A per-cell dropped avatar (avatarImg) takes precedence over the brand logo (logoImgRef/overlayLogoSrc).
    let logo = avatarImg ?? logoImgRef.current;
    if (!avatarImg && !logo && overlayLogoSrc) {
      logo = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = overlayLogoSrc;
      logoImgRef.current = logo;
    }

    // Keep the rounded-square corner proportional to the avatar size (16px at the default 108).
    const radius = s.avatarShape === 'circle'
      ? avatarSize / 2
      : Math.round(avatarSize * AVATAR_RADIUS / SONOTRADE_AVATAR_SIZE);

    if (logo && logo.complete && logo.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, radius);
      ctx.closePath();
      ctx.clip();
      // object-fit: cover with pan + zoom (driven by the Adjust-avatar popup).
      const iw = logo.naturalWidth;
      const ih = logo.naturalHeight;
      const zoom = s.avatarImageScale ?? 1;
      const oX = Math.max(-1, Math.min(1, s.avatarOffsetX ?? 0));
      const oY = Math.max(-1, Math.min(1, s.avatarOffsetY ?? 0));

      if (zoom === 1 && oX === 0 && oY === 0) {
        // Untouched avatar → exact original centre-crop cover (byte-identical to before).
        const region = Math.min(iw, ih);
        ctx.drawImage(logo, (iw - region) / 2, (ih - region) / 2, region, region, avatarX, avatarY, avatarSize, avatarSize);
      } else {
        // Draw the whole image at cover × zoom, centred + panned, clipped to the frame. zoom > 1 crops
        // tighter; zoom < 1 shrinks the pfp inside the frame so the header bg shows around it.
        const coverScale = Math.max(avatarSize / iw, avatarSize / ih);
        const dispW = iw * coverScale * zoom;
        const dispH = ih * coverScale * zoom;
        const dx = avatarX + (avatarSize - dispW) / 2 + (oX * Math.abs(dispW - avatarSize)) / 2;
        const dy = avatarY + (avatarSize - dispH) / 2 + (oY * Math.abs(dispH - avatarSize)) / 2;
        ctx.drawImage(logo, dx, dy, dispW, dispH);
      }
      ctx.restore();
    } else if (placeholder) {
      // No avatar image → an editor-only image skeleton: gray box + the shared picture icon.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, radius);
      ctx.fillStyle = '#52525b';
      ctx.fill();
      ctx.clip();
      const iconSize = avatarSize * 0.5;
      drawPictureIcon(ctx, avatarX + (avatarSize - iconSize) / 2, avatarY + (avatarSize - iconSize) / 2, iconSize, '#d4d4d8');
      ctx.restore();
    }

    // Optional stroke ring — sits entirely OUTSIDE the avatar (added around it, never over the image).
    // Canvas strokes centre on the path, so expand the path outward by half the width to push it fully out.
    const strokeW = s.avatarStrokeWidth ?? 3;
    if (s.avatarStroke && strokeW > 0) {
      const off = strokeW / 2;
      ctx.save();
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = s.avatarStrokeColor ?? '#00CD40';
      ctx.beginPath();
      ctx.roundRect(avatarX - off, avatarY - off, avatarSize + strokeW, avatarSize + strokeW, radius + off);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Right column: Name + Handle (stacked, vertically centered in avatar) ────
  // Display name — 700 weight (skipped when hidden; nameWidth stays 0 so the badge sits at the text start)
  let nameWidth = 0;
  if (s.showName) {
    ctx.font = `700 ${nameSize}px ${LIBRE}`;
    ctx.fillStyle = s.nameColor;
    ctx.fillText(overlayDisplayName, textX, nameBaseline);
    nameWidth = ctx.measureText(overlayDisplayName).width;
  }

  // Gold verified badge — inline immediately after name, centered on cap-height. Scales with the name.
  if (overlayVerified && s.showVerified) {
    const BADGE = Math.round(34 * nameSize / NAME_SIZE);
    const badgeX = textX + nameWidth + 6;
    // Cap-height ≈ 70% of font size; center badge on that visual midpoint
    const capMid = nameBaseline - Math.round(nameSize * 0.35);
    const badgeY = capMid - BADGE / 2;
    let img = verifiedImgRef.current;
    if (!img) {
      img = new Image();
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(VERIFIED_TICK_SVG)}`;
      verifiedImgRef.current = img;
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, badgeX, badgeY, BADGE, BADGE);
    }
  }

  // @handle — 400 weight, gray
  if (s.showHandle) {
    ctx.font = `400 ${handleSize}px ${LIBRE}`;
    ctx.fillStyle = s.handleColor;
    ctx.fillText(overlayHandle, textX, handleBaseline);
  }

  // ── Tweet body (caption) — full width, starts at avatar left edge ──────────
  if (overlayCaption) {
    const captionX = avatarX;
    const capLineH = sonotradeCaptionLineHeight(s);
    const captionMaxW = g.captionMaxW;

    ctx.font = sonotradeCaptionFont(s);
    ctx.fillStyle = s.captionColor;

    let y = g.captionBaseline;
    for (const userLine of overlayCaption.split('\n')) {
      if (!userLine) { y += capLineH; continue; }
      let line = '';
      for (const word of userLine.split(' ')) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > captionMaxW && line) {
          ctx.fillText(line.trimEnd(), captionX, y);
          line = word + ' ';
          y += capLineH;
        } else {
          line = test;
        }
      }
      ctx.fillText(line.trimEnd(), captionX, y);
      y += capLineH;
    }
  }

  return headerHeight;
}
