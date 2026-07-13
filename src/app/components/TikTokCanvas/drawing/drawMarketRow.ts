import type { MutableRefObject } from 'react';
import type { SparkPoint } from '../types';

// ── Colors exactly as in pauv-the-app (globals.css + MobileTradeList.tsx) ───────
const COLOR_WHITE           = '#ffffff';
const COLOR_SECONDARY       = '#71717a'; // artist.industry subtitle (hardcoded in ArtistRow)
const COLOR_POSITIVE        = '#04df9d'; // --st-positive
const COLOR_NEGATIVE        = '#FF4B4B'; // --st-chart-negative
const COLOR_AVATAR_BG       = '#1e1e1e';
const COLOR_AVATAR_BORDER   = '#2a2a2a';
const COLOR_AVATAR_INITIALS = '#52525b';
const COLOR_SEPARATOR       = '#1a1a1a'; // borderBottom in ArtistRow

// Fonts — must match what next/font/google loads in layout.tsx:
//   Geist → --font-geist-sans, Geist Mono → --font-geist-mono
const SANS = 'Geist, system-ui, -apple-system, sans-serif';
const MONO = '"Geist Mono", monospace';

// DISPLAY_SCALE = 0.38 → multiply any UI px by (1/0.38) to get canvas px
const S = 1 / 0.38;

const PADDING_X = 65; // left/right margin — matches SONOTRADE_PADDING_X

// ArtistRow: padding '14px 0', avatar 42×42, total row height ~70px at UI scale
export const MARKET_ROW_H = Math.round(70 * S); // ≈ 184px

const AVATAR_D = Math.round(42 * S); // ≈ 110px
const AVATAR_R = AVATAR_D / 2;

// gap: 12 between avatar → text column, text column → right column
const GAP    = Math.round(12 * S); // ≈ 32px
const TEXT_X = PADDING_X + AVATAR_D + GAP; // left edge of name/industry text

// Fonts: 15px name/price, 12px industry/change (from ArtistRow spans)
const NAME_SIZE   = Math.round(15 * S); // ≈ 39px
const SUB_SIZE    = Math.round(12 * S); // ≈ 32px
const NAME_GAP    = Math.round(3  * S); // gap: 3 between name and industry spans ≈ 8px

const PRICE_SIZE  = Math.round(15 * S); // ≈ 39px
const CHANGE_SIZE = Math.round(12 * S); // ≈ 32px
const PRICE_GAP   = Math.round(4  * S); // gap: 4 between price and change ≈ 11px

// ListTrendArrow: SVG viewBox="0 0 24 18" displayed at 13×13px UI
const ARROW_W   = Math.round(13 * S);           // ≈ 34px
const ARROW_H   = Math.round(13 * S * 18 / 24); // ≈ 26px (preserves 24:18 aspect)
const ARROW_GAP = Math.round(3  * S);            // gap: 3 between arrow and % text ≈ 8px

// Sparkline: 80×30px UI → 211×79px canvas, marginRight 8px UI → 21px canvas
const SPARK_W          = Math.round(80 * S); // ≈ 211px
const SPARK_H          = Math.round(30 * S); // ≈ 79px
const SPARK_MARGIN_R   = Math.round(8  * S); // ≈ 21px (marginRight before price column)
const SPARK_LINE_W     = Math.round(1.5 * S);// stroke width ≈ 4px

export interface DrawMarketRowOptions {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cx: number;
  videoBottomY: number;
  cw: number;
  name: string;
  subtitle: string;        // industry ?? subcategory ?? '—'
  photo_url: string | null;
  priceUsd: number | null;
  lifetimeChangePct: number | null;
  sparkline?: SparkPoint[] | null;
  avatarImgRef: MutableRefObject<HTMLImageElement | null>;
  lastPhotoUrlRef: MutableRefObject<string | null>;
}

export function drawMarketRow({
  ctx, cx, videoBottomY, cw,
  name, subtitle, photo_url, priceUsd, lifetimeChangePct, sparkline,
  avatarImgRef, lastPhotoUrlRef,
}: DrawMarketRowOptions): void {
  const cy        = videoBottomY;
  const midY      = cy + MARKET_ROW_H / 2;
  const rightEdge = cx + cw - PADDING_X;

  // ── Separator — borderBottom: '1px solid #1a1a1a' from ArtistRow ─────────────
  ctx.fillStyle = COLOR_SEPARATOR;
  ctx.fillRect(cx + PADDING_X, cy, cw - PADDING_X * 2, Math.max(1, Math.round(1 * S)));

  // ── Avatar ────────────────────────────────────────────────────────────────────
  const avatarCX = cx + PADDING_X + AVATAR_R;
  const avatarCY = midY;

  if (photo_url !== lastPhotoUrlRef.current) {
    avatarImgRef.current = null;
    lastPhotoUrlRef.current = photo_url;
  }
  let img = avatarImgRef.current;
  if (!img && photo_url) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = photo_url;
    avatarImgRef.current = img;
  }

  // Background fill
  ctx.fillStyle = COLOR_AVATAR_BG;
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, AVATAR_R, 0, Math.PI * 2);
  ctx.fill();

  if (img && img.complete && img.naturalWidth > 0) {
    // Photo — object-fit: cover
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, AVATAR_R, 0, Math.PI * 2);
    ctx.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(AVATAR_D / iw, AVATAR_D / ih);
    const sw = AVATAR_D / scale, sh = AVATAR_D / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh,
      avatarCX - AVATAR_R, avatarCY - AVATAR_R, AVATAR_D, AVATAR_D);
    ctx.restore();
  } else {
    // Initials fallback — fontSize: 10 at UI scale
    const initialsSize = Math.round(10 * S);
    const initials = name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
    ctx.font = `600 ${initialsSize}px ${SANS}`;
    ctx.fillStyle = COLOR_AVATAR_INITIALS;
    const iw2 = ctx.measureText(initials).width;
    ctx.fillText(initials, avatarCX - iw2 / 2, avatarCY + initialsSize * 0.35);
  }

  // Border: '1px solid #2a2a2a'
  ctx.strokeStyle = COLOR_AVATAR_BORDER;
  ctx.lineWidth = Math.max(1, Math.round(1 * S));
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, AVATAR_R, 0, Math.PI * 2);
  ctx.stroke();

  // ── Name + Industry (center column, flex: 1) ─────────────────────────────────
  // Tailwind Preflight sets body line-height: 1.5, which spans inherit.
  // Each flex item's box height = fontSize * 1.5; baseline sits at ~78% of that.
  const NAME_LH = NAME_SIZE * 1.5;
  const SUB_LH  = SUB_SIZE  * 1.5;
  const textBlockH = NAME_LH + NAME_GAP + SUB_LH;
  const blockTop   = midY - textBlockH / 2;
  const nameBaseline = Math.round(blockTop + NAME_LH * 0.78);
  const subBaseline  = Math.round(blockTop + NAME_LH + NAME_GAP + SUB_LH * 0.78);

  // Name: fontWeight 600, color #fff, 15px
  ctx.font = `600 ${NAME_SIZE}px ${SANS}`;
  ctx.fillStyle = COLOR_WHITE;
  ctx.fillText(name, TEXT_X, nameBaseline);

  // Industry: normal weight, color #71717a, 12px
  ctx.font = `400 ${SUB_SIZE}px ${SANS}`;
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.fillText(subtitle || '—', TEXT_X, subBaseline);

  // ── Measure price column width first so sparkline can be placed flush left of it ──
  // In ArtistRow: [name/industry flex:1] [sparkline marginRight:8] [price shrink:0]
  // priceColWidth = max(priceTextWidth, changeRowWidth)
  const priceText   = priceUsd != null ? priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const changeText  = lifetimeChangePct != null ? `${Math.abs(lifetimeChangePct).toFixed(1)}%` : '';

  ctx.font = `600 ${PRICE_SIZE}px ${MONO}`;
  const priceTextW  = priceText  ? ctx.measureText(priceText).width  : 0;

  ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
  const changeTxtW  = changeText ? ctx.measureText(changeText).width  : 0;
  const changeRowW  = changeTxtW ? ARROW_W + ARROW_GAP + changeTxtW : 0;

  const priceColW   = Math.max(priceTextW, changeRowW);

  // ── Sparkline — sits immediately left of the price column with SPARK_MARGIN_R gap ──
  // This matches the CSS: [sparkline div marginRight:8][price+change shrink:0]
  if (sparkline && sparkline.length >= 2) {
    const isPos = sparkline[sparkline.length - 1]!.value >= sparkline[0]!.value;
    const sparkColor = isPos ? COLOR_POSITIVE : COLOR_NEGATIVE;

    const sparkRight = rightEdge - priceColW - SPARK_MARGIN_R;
    const sparkLeft  = sparkRight - SPARK_W;
    const sparkTop   = midY - SPARK_H / 2;
    const pad        = (2 / 32) * SPARK_H;

    const values = sparkline.map(p => p.value);
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const vRange = vMax - vMin;

    const pts = sparkline.map((p, i) => ({
      x: sparkLeft + (i / (sparkline.length - 1)) * SPARK_W,
      y: vRange === 0
        ? sparkTop + SPARK_H / 2
        : sparkTop + pad + (1 - (p.value - vMin) / vRange) * (SPARK_H - pad * 2),
    }));

    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.lineTo(pts[i + 1]!.x, pts[i]!.y); // H
      ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y); // V
    }
    ctx.strokeStyle = sparkColor;
    ctx.lineWidth   = SPARK_LINE_W;
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'miter';
    ctx.stroke();
  }

  // ── Price + Change (right column, alignItems: flex-end) ───────────────────────
  const PRICE_LH  = PRICE_SIZE  * 1.5;
  const CHANGE_LH = CHANGE_SIZE * 1.5;
  const priceBlockH   = PRICE_LH + PRICE_GAP + CHANGE_LH;
  const priceBlockTop = midY - priceBlockH / 2;
  const priceBaseline  = Math.round(priceBlockTop + PRICE_LH * 0.78);
  const changeBaseline = Math.round(priceBlockTop + PRICE_LH + PRICE_GAP + CHANGE_LH * 0.78);

  if (priceText) {
    ctx.font = `600 ${PRICE_SIZE}px ${MONO}`;
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillText(priceText, rightEdge - priceTextW, priceBaseline);
  }

  if (lifetimeChangePct != null) {
    const isPos      = lifetimeChangePct >= 0;
    const color      = isPos ? COLOR_POSITIVE : COLOR_NEGATIVE;

    ctx.font = `500 ${CHANGE_SIZE}px ${MONO}`;
    ctx.fillStyle = color;
    const aX     = rightEdge - ARROW_W - ARROW_GAP - changeTxtW;

    // Arrow center aligned on text cap-height (ListTrendArrow: 13×13, SVG viewBox 0 0 24 18)
    const arrowCY  = changeBaseline - CHANGE_SIZE * 0.35;
    const arrowTop = arrowCY - ARROW_H / 2;

    // Triangle matching SVG path: m12 0 10.392 14.25H1.608z in viewBox 24×18
    ctx.beginPath();
    if (isPos) {
      ctx.moveTo(aX + ARROW_W * 0.5,   arrowTop);
      ctx.lineTo(aX + ARROW_W * 0.933, arrowTop + ARROW_H * 0.792);
      ctx.lineTo(aX + ARROW_W * 0.067, arrowTop + ARROW_H * 0.792);
    } else {
      // rotate(180deg)
      ctx.moveTo(aX + ARROW_W * 0.5,   arrowTop + ARROW_H);
      ctx.lineTo(aX + ARROW_W * 0.933, arrowTop + ARROW_H * 0.208);
      ctx.lineTo(aX + ARROW_W * 0.067, arrowTop + ARROW_H * 0.208);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillText(changeText, aX + ARROW_W + ARROW_GAP, changeBaseline);
  }
}
