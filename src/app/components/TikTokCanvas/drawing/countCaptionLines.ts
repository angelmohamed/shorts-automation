import {
  CANVAS_W, HEADER_PADDING_X,
  SONOTRADE_CAPTION_MAX_W, SONOTRADE_CAPTION_FONT,
} from '../constants';

const CLEAN_FONT = '400 42px "Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CLEAN_MAX_W = CANVAS_W - (HEADER_PADDING_X + 43) * 2;

export const SONOTRADE_CAP_FONT = `400 42px ${SONOTRADE_CAPTION_FONT}`;

export function countCaptionLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlayCaption: string,
  font = CLEAN_FONT,
  maxWidth = CLEAN_MAX_W,
): number {
  if (!overlayCaption) return 0;

  ctx.font = font;

  const userLines = overlayCaption.split('\n');
  let total = 0;

  for (const userLine of userLines) {
    if (!userLine) { total++; continue; }
    let line = '';
    let lineCount = 1;
    for (const word of userLine.split(' ')) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line) {
        lineCount++;
        line = word + ' ';
      } else {
        line = test;
      }
    }
    total += lineCount;
  }

  return total;
}

export function countSonotradeCaptionLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlayCaption: string,
  font: string = SONOTRADE_CAP_FONT,   // caption size is configurable, so callers pass the resolved font
  maxWidth: number = SONOTRADE_CAPTION_MAX_W,   // …and horizontal padding is configurable, so callers pass the resolved wrap width
): number {
  return countCaptionLines(ctx, overlayCaption, font, maxWidth);
}
