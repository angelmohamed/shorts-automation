// Style settings for the Twitter/X video-reel overlay (the header drawn over a video in Video Reels).
// Defaults reproduce the previously-hardcoded look exactly, so an overlay rendered with the defaults is
// pixel-identical to before this template system existed. Kept intentionally to "style essentials" —
// colors, caption size, avatar shape, show/hide toggles, and optional identity overrides — with no raw
// geometry (paddings, font geometry) exposed, so the authentic Twitter layout can't be broken.

import type { CarouselFontLabel, CarouselFontWeight, CarouselTextAlign, ShadowStyle } from './templateEditorTypes';

export type TwitterAvatarShape = 'roundedSquare' | 'circle';

// A reel is laid out as [top cell] · video band · [bottom cell] (equal cells). Each cell holds one item.
// 'bannerText' combines a banner (avatar/name/handle) on top with the rich text element below it — it uses
// the same `banner` + `text`/`textStyle`/`isCaption` fields as those two types.
export type ReelsCellType = 'empty' | 'banner' | 'text' | 'image' | 'bannerText';

// Per-cell banner styling overrides — only meaningful when a cell's type === 'banner'. Every field is
// OPTIONAL: an unset field falls back to the template-level TwitterTemplateSettings value at draw time
// (drawReelCell merges { ...settings, ...cell.banner }), so each banner cell styles independently while
// still inheriting sensible defaults. Field names mirror TwitterTemplateSettings so the merge is direct.
export interface BannerStyle {
  // Avatar
  showAvatar?: boolean;
  avatarShape?: TwitterAvatarShape;
  avatarUrl?: string;        // custom avatar image (dropped onto the banner); overrides the brand logo
  avatarStroke?: boolean;
  avatarStrokeColor?: string;
  avatarStrokeWidth?: number;
  avatarImageScale?: number;
  avatarOffsetX?: number;
  avatarOffsetY?: number;
  avatarSize?: number;
  // Display name
  showName?: boolean;
  nameColor?: string;
  nameFontSize?: number;
  // @handle
  showHandle?: boolean;
  handleColor?: string;
  handleFontSize?: number;
  // Verified badge
  showVerified?: boolean;
  // Identity overrides (null → fall back to the brand kit)
  defaultDisplayName?: string | null;
  defaultHandle?: string | null;
  // Layout / position
  headerPaddingX?: number;
  headerPaddingTop?: number;
  nameHandleGap?: number;
  nameHandleOffsetX?: number;
  nameHandleOffsetY?: number;
}

// Per-cell text styling — only meaningful when a cell's type === 'text'. Mirrors the carousel template
// editor's text-box styling (shared font list / weights / shadow types), so a reel text cell has the same
// rich controls. All optional → drawCellText falls back to sensible defaults. captionColor/captionFontSize
// are retained as legacy fallbacks for text cells saved before this rich model (captionLineHeight is kept
// only for back-compat and is NOT applied — the old 1–2 multiplier is incompatible with the 0–100 lineHeight).
export interface TextStyle {
  fontLabel?: CarouselFontLabel;
  fontSize?: number;          // px on the 1080-wide canvas
  fontWeight?: CarouselFontWeight;
  italic?: boolean;
  allCaps?: boolean;
  color?: string;
  align?: CarouselTextAlign;
  paddingTop?: number;        // DEPRECATED — text boxes now auto-fit their height; retained so old templates don't break
  vAlign?: 'top' | 'middle' | 'bottom';   // DEPRECATED — a text box hugs its content (auto-height, top-anchored),
                                          // so there's nothing to vertically align within; kept for back-compat
  // Vertical grow direction of the auto-height box. 'down' (default): the TOP edge stays where the box was
  // placed and it grows DOWNWARD as the text gets taller. 'up': the BOTTOM edge (where the editor sample
  // ends) stays fixed and the box grows UPWARD. Only has a visible effect when the rendered text differs in
  // length from the editor sample — i.e. a per-post caption longer/shorter than the sample sentence.
  growDir?: 'down' | 'up';
  letterSpacing?: number;     // px
  lineHeight?: number;        // carousel semantics: 0-100 (actual line = size * (1 + v/100 * 1.2))
  opacity?: number;           // 0-100
  shadow?: ShadowStyle;
  // Legacy fallbacks (pre-rich model)
  captionColor?: string;
  captionFontSize?: number;
  captionLineHeight?: number;
}

export type ImageFit = 'cover' | 'contain';

// Per-cell image styling — only meaningful when a cell's type === 'image'. The template never had image
// settings, so these have no template-level fallback; drawCellImage reads them directly with hardcoded
// defaults. 'cover' (default) fills the cell with optional zoom/pan; 'contain' fits the whole image with
// bgColor behind the letterbox.
export interface ImageStyle {
  fit?: ImageFit;            // default 'cover'
  bgColor?: string;          // cell background, shown where the image doesn't cover (contain letterbox, or a
                             // cover image zoomed below 1); unset → the reel's headerBgColor shows through
  cornerRadius?: number;     // rounded-corner radius in px (default 24)
  imageScale?: number;       // 'cover' zoom (default 1; >1 crops tighter)
  offsetX?: number;          // 'cover' pan, normalized [-1, 1] (default 0)
  offsetY?: number;
  border?: boolean;          // draw a ring just inside the cell edge (default off)
  borderColor?: string;      // ring colour (default '#ffffff')
  borderWidth?: number;      // ring width in px (default 8)
}

export interface ReelsCell {
  type: ReelsCellType;
  text?: string;        // body text for 'text' (used when NOT a caption)
  // For a 'text' element: when true (the default), it renders each post's caption (the editor shows a
  // sample). When false it renders its own `text`. Only one text element should be the caption.
  isCaption?: boolean;
  textStyle?: TextStyle;   // per-cell text styling (only applied when type === 'text')
  imageUrl?: string;    // 'image'
  imageStyle?: ImageStyle; // per-cell image styling (only applied when type === 'image')
  banner?: BannerStyle; // per-cell banner styling (only applied when type === 'banner')
  bannerTextGap?: number;  // 'bannerText' only: extra px between the banner and the text below it (default 0; may be negative)
}

// A free-form, draggable/resizable overlay element placed anywhere on the reel canvas — an alternative to
// the four premade cells. It IS a ReelsCell (so drawReelCell renders it directly) plus an id and a rect in
// canvas (1080×1920) coords. Drawn on top of the cells + video band, in array order.
export interface FreeElement extends ReelsCell {
  id: string;
  x: number; y: number; width: number; height: number;
  hidden?: boolean;   // hidden via the Layers panel (skipped in draw + interaction; still listed to un-hide)
}

// Legacy templates may have stored the removed 'bannerCaption' type — degrade it to a plain banner
// (keeps the banner; the old caption text is dropped) so saved templates don't break.
function normalizeReelsCell(cell?: ReelsCell): ReelsCell | undefined {
  if (cell && (cell.type as string) === 'bannerCaption') return { type: 'banner' };
  return cell;
}

export interface TwitterTemplateSettings {
  // Header / canvas background (also fills the letterbox area behind the video so they stay cohesive).
  headerBgColor: string;
  // Text colors.
  nameColor: string;
  handleColor: string;
  captionColor: string;
  // Caption size (px on the 1080-wide canvas). Affects line wrapping + header height; line spacing scales with it.
  captionFontSize: number;
  // Avatar.
  avatarShape: TwitterAvatarShape;
  showAvatar: boolean;
  // Optional ring/stroke around the avatar — all optional so untouched templates render unchanged.
  avatarStroke?: boolean;        // draw a ring around the avatar (default on)
  avatarStrokeColor?: string;    // ring colour (default '#00CD40' — the brand green)
  avatarStrokeWidth?: number;    // ring width in px on the 1080 canvas (default 3)
  // Pan + zoom of the pfp WITHIN the avatar frame, driven by the "Adjust" cropper popup.
  // avatarImageScale: zoom ≥ 1 (1 = today's center-crop fill; higher crops tighter).
  // avatarOffsetX/Y: normalized pan in [-1, 1] (0 = centred). All optional → default 1 / 0 / 0.
  avatarImageScale?: number;
  avatarOffsetX?: number;
  avatarOffsetY?: number;
  // Toggles.
  showName: boolean;
  showHandle: boolean;
  showVerified: boolean;
  // Identity overrides — when null, the brand kit's display name / handle are used.
  defaultDisplayName: string | null;
  defaultHandle: string | null;

  // ── Layout geometry (px on the 1080-wide canvas; ratio for line spacing) ──────────────────
  // All OPTIONAL: when absent the overlay falls back to the authentic-Twitter defaults baked into
  // drawHeader.ts, so existing templates render pixel-identically. Exposed via the Reels editor's
  // Layout section and applied identically when the overlay is recorded onto real reels.
  headerPaddingX?: number;     // left/right edge inset (default 65)
  headerPaddingTop?: number;   // top inset / vertical position of the header block (default 18)
  avatarSize?: number;         // avatar square/circle size (default 108)
  captionGap?: number;         // gap from the @handle baseline down to the caption (default 24)
  nameFontSize?: number;       // display-name size (default 42)
  handleFontSize?: number;     // @handle size (default 40)
  captionLineHeight?: number;  // caption line-height multiplier on the caption font size (default ≈1.31)
  // Joined name+handle block — move the pair together, and set the space between the two rows.
  nameHandleGap?: number;      // vertical space between the name and handle rows (default 10)
  nameHandleOffsetX?: number;  // shift the joined block horizontally, px (default 0; + = away from avatar)
  nameHandleOffsetY?: number;  // shift the joined block vertically, px (default 0; + = down)
  // Left/right inset of the VIDEO on the reel (default 40 → the classic 1000px-wide centred video).
  // Drives the editor preview placeholder AND the real exported reel's video framing.
  videoPaddingX?: number;

  // ── Cell layout: [top · top2] · video band · [bottom · bottom2] ──────────────────────────────
  // Each side of the video splits into two stacked equal cells. Top region = cellTop (upper) +
  // cellTop2 (lower); bottom region = cellBottom (upper) + cellBottom2 (lower).
  cellTop?: ReelsCell;        // default { type: 'banner' } — the logo/name/handle banner
  cellTop2?: ReelsCell;       // default empty
  cellBottom?: ReelsCell;     // default empty
  cellBottom2?: ReelsCell;    // default empty
  videoBandHeight?: number;   // height of the centred video band in px (default 900); cells fill the rest equally
  videoCornerRadius?: number; // corner radius of the centred video band in px (default 24) — rounds the editor placeholder AND the live/exported video clip
  cellMargin?: number;        // gap around/between the cells in px (default 60)
  freeElements?: FreeElement[];   // free-form overlay elements (banner/text/image) at arbitrary canvas positions
  // The video band is itself a reorderable z-layer in the Layers panel. videoLayer = how many free elements
  // (counted from the BACK of the freeElements array) draw BEHIND the band; the rest draw in front. Default 0
  // → the band sits behind every free element (the original look, before the video became a layer).
  videoLayer?: number;
}

export function defaultTwitterTemplateSettings(): TwitterTemplateSettings {
  return {
    headerBgColor: '#000000',
    nameColor: '#e7e9ea',     // rgb(231,233,234)
    handleColor: '#71767b',   // rgb(113,118,123)
    captionColor: '#e7e9ea',
    captionFontSize: 42,
    avatarShape: 'circle',
    showAvatar: true,
    avatarStroke: true, avatarStrokeColor: '#00CD40', avatarStrokeWidth: 3,
    showName: true,
    showHandle: true,
    showVerified: true,
    defaultDisplayName: null,
    defaultHandle: null,
    headerPaddingX: 40,       // reel-banner default (tighter than the authentic-Twitter 65)
    nameHandleOffsetY: -5,    // nudge the name/handle block up slightly by default
    // Full-bleed reel: the video band covers the whole 1080×1920 canvas, with no banner/caption
    // cells and no corner rounding — the uploaded/linked video IS the reel.
    cellTop: { type: 'empty' },   // suppress the implicit banner fallback
    videoBandHeight: 1920,
    cellMargin: 0,
    videoCornerRadius: 0,
  };
}

// Merge a (possibly partial / from-DB) settings blob over the defaults so missing fields stay valid.
export function resolveTwitterTemplateSettings(
  partial?: Partial<TwitterTemplateSettings> | null,
): TwitterTemplateSettings {
  const merged = { ...defaultTwitterTemplateSettings(), ...(partial ?? {}) };
  merged.cellTop = normalizeReelsCell(merged.cellTop);
  merged.cellTop2 = normalizeReelsCell(merged.cellTop2);
  merged.cellBottom = normalizeReelsCell(merged.cellBottom);
  merged.cellBottom2 = normalizeReelsCell(merged.cellBottom2);
  return merged;
}
