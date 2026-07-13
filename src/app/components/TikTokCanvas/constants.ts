// Internal canvas resolution (1080p portrait for highest export quality)
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;
// Target width for video fitting (1000px leaves 40px padding on each side)
export const VIDEO_TARGET_W = 1000;
// Display scale so the on-screen canvas isn't huge
export const DISPLAY_SCALE = 0.38; // 1080×1920 → ~410×730 on screen
export const MIN_DIM = 40;
export const H_SIZE = 10; // handle square side length

// Header/caption layout
export const BASE_HEADER_HEIGHT = 148;   // 18 top + 108 avatar + 22 bottom
export const CAPTION_LINE_HEIGHT = 55;
export const CAPTION_TOP_PADDING = 38;   // derived: handles formula BASE+38+N*55-18 matching drawn position
export const HEADER_PADDING_X = 32;
export const HEADER_PADDING_TOP = 18;

// Sonotrade (Twitter) template — caption lives in the right column (same X as name)
export const SONOTRADE_AVATAR_SIZE = 108;
export const SONOTRADE_PADDING_X = HEADER_PADDING_X + 33; // 65 — 3px tighter each side than reference
export const SONOTRADE_TEXT_X = SONOTRADE_PADDING_X + SONOTRADE_AVATAR_SIZE + 28; // 65+108+28 = 201
export const SONOTRADE_CAPTION_MAX_W = CANVAS_W - SONOTRADE_PADDING_X * 2; // 1080-130 = 950
export const SONOTRADE_CAPTION_FONT = '"Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const CURSORS: Record<string, string> = {
  tl: 'n-resize', tc: 'n-resize', tr: 'n-resize',
  bl: 's-resize', bc: 's-resize', br: 's-resize',
  move: 'move',
};

// Exact verified tick SVG (from X) rendered into the canvas via a data URL image
export const VERIFIED_TICK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" aria-hidden="true">
  <g>
    <path clip-rule="evenodd"
          d="M13.596 3.011L11 .5 8.404 3.011l-3.576-.506-.624 3.558-3.19 1.692L2.6 11l-1.586 3.245 3.19 1.692.624 3.558 3.576-.506L11 21.5l2.596-2.511 3.576.506.624-3.558 3.19-1.692L19.4 11l1.586-3.245-3.19-1.692-.624-3.558-3.576.506zM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39z"
          fill="url(#paint0_linear_8728_433881)"
          fill-rule="evenodd" />
    <path clip-rule="evenodd"
          d="M13.348 3.772L11 1.5 8.651 3.772l-3.235-.458-.565 3.219-2.886 1.531L3.4 11l-1.435 2.936 2.886 1.531.565 3.219 3.235-.458L11 20.5l2.348-2.272 3.236.458.564-3.219 2.887-1.531L18.6 11l1.435-2.936-2.887-1.531-.564-3.219-3.236.458zM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39z"
          fill="url(#paint1_linear_8728_433881)"
          fill-rule="evenodd" />
    <path clip-rule="evenodd"
          d="M6 11.39l3.74 3.74 6.197-6.767h.003V9.76l-6.2 6.77L6 12.79v-1.4zm0 0z"
          fill="#D18800"
          fill-rule="evenodd" />
    <defs>
      <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_8728_433881" x1="4" x2="19.5" y1="1.5" y2="22">
        <stop stop-color="#F4E72A" />
        <stop offset=".539" stop-color="#CD8105" />
        <stop offset=".68" stop-color="#CB7B00" />
        <stop offset="1" stop-color="#F4EC26" />
        <stop offset="1" stop-color="#F4E72A" />
      </linearGradient>
      <linearGradient gradientUnits="userSpaceOnUse" id="paint1_linear_8728_433881" x1="5" x2="17.5" y1="2.5" y2="19.5">
        <stop stop-color="#F9E87F" />
        <stop offset=".406" stop-color="#E2B719" />
        <stop offset=".989" stop-color="#E2B719" />
      </linearGradient>
    </defs>
  </g>
</svg>
`.trim();
