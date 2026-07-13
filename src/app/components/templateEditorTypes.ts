// ── Shared types, interfaces and constants for the Carousel feature ──────────

import type { ElementInput } from '@/lib/customElements/runtime';

export const MAX_FONT = 88;
export const SUB_MAX  = 52;

export interface TemplateEditorCanvasRef {
  startDownload: () => Promise<void>;
  // Render the current slide to a PNG Blob (same pixels as startDownload, but returned instead of
  // downloaded) so callers can upload it — e.g. "Send to scheduler". Null for video slides / on failure.
  exportBlob: () => Promise<Blob | null>;
  addOverlay: (url: string) => void;
  // Paste-to-canvas landing path: place already-uploaded media as a new box centred on the slide
  // (the Grid uploads the clipboard file to storage first, then calls this on the active canvas).
  addMediaBoxCentered: (url: string, kind: 'image' | 'video') => void;
  cancelExport: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetTransform: () => void;
  setZoom: (s: number) => void;
  enterCropMode: () => void;
  toggleSplit: () => void;
  toggleBlur: () => void;
  // Video control (for VideoControlsBar in video sub-mode)
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  resetBox: () => void;
  centerBox: () => void;
  // Rich-text run styling — applied to the current selection inside the inline text-box editor
  setSelectionWeight: (weight: number) => void;
  toggleSelectionItalic: () => void;
  setSelectionColor: (color: string) => void;
  // Select a free element (logo etc.) from outside the canvas — drives the panel↔canvas
  // selection/expand binding. null deselects.
  selectFreeEl: (i: number | null) => void;
  selectImageBox: (i: number | null) => void;
  selectZoneLogo: (i: number | null) => void;
  // Plain text-box selection (outline + handles), zone tag/quote/swipe slots, and headline/sub
  // edit mode — driven from the panel so an island opening ⟺ its element selected on the frame.
  selectTextBox: (i: number | null) => void;
  selectZoneSlot: (kind: 'logo' | 'tag' | 'quote' | 'swipe', i: number | null) => void;
  setRichEdit: (t: 'headline' | 'sub' | null) => void;
  // Clear every selection + exit any text editor (commits its content). For clicking the editor void.
  deselectAll: () => void;
  getVideoElement: () => HTMLVideoElement | null;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number };
}

export type CarouselTextAlign  = 'left' | 'center' | 'right' | 'justify';
export type CarouselFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export const CAROUSEL_FONTS = [
  // Geometric / Modern Sans
  { label: 'Inter',                css: 'Inter, sans-serif',                          google: 'Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Libre Franklin',       css: '"Libre Franklin", sans-serif',               google: 'Libre+Franklin:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Outfit',               css: '"Outfit", sans-serif',                       google: 'Outfit:wght@300;400;500;600;700;800;900' },
  { label: 'Poppins',              css: '"Poppins", sans-serif',                      google: 'Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Montserrat',           css: '"Montserrat", sans-serif',                   google: 'Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Raleway',              css: '"Raleway", sans-serif',                      google: 'Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Plus Jakarta Sans',    css: '"Plus Jakarta Sans", sans-serif',            google: 'Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Figtree',              css: '"Figtree", sans-serif',                      google: 'Figtree:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Space Grotesk',        css: '"Space Grotesk", sans-serif',                google: 'Space+Grotesk:wght@300;400;500;600;700' },
  { label: 'Urbanist',             css: '"Urbanist", sans-serif',                     google: 'Urbanist:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Syne',                 css: '"Syne", sans-serif',                         google: 'Syne:wght@400;500;600;700;800' },
  { label: 'Unbounded',            css: '"Unbounded", sans-serif',                    google: 'Unbounded:wght@200;300;400;500;600;700;800;900' },
  // Humanist Sans
  { label: 'Open Sans',            css: '"Open Sans", sans-serif',                    google: 'Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Lato',                 css: '"Lato", sans-serif',                         google: 'Lato:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Nunito',               css: '"Nunito", sans-serif',                       google: 'Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Work Sans',            css: '"Work Sans", sans-serif',                    google: 'Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Roboto',               css: '"Roboto", sans-serif',                       google: 'Roboto:ital,wght@0,300;0,400;0,500;0,700;0,900;1,300;1,400;1,500;1,700;1,900' },
  { label: 'DM Sans',              css: '"DM Sans", sans-serif',                      google: 'DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,300;1,9..40,400;1,9..40,500;1,9..40,600;1,9..40,700;1,9..40,800;1,9..40,900' },
  { label: 'Manrope',              css: '"Manrope", sans-serif',                      google: 'Manrope:wght@200;300;400;500;600;700;800' },
  { label: 'Karla',                css: '"Karla", sans-serif',                        google: 'Karla:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Mulish',               css: '"Mulish", sans-serif',                       google: 'Mulish:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Jost',                 css: '"Jost", sans-serif',                         google: 'Jost:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Grotesque / Neutral
  { label: 'Barlow',               css: '"Barlow", sans-serif',                       google: 'Barlow:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Archivo',              css: '"Archivo", sans-serif',                      google: 'Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Source Sans 3',        css: '"Source Sans 3", sans-serif',                google: 'Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'PT Sans',              css: '"PT Sans", sans-serif',                      google: 'PT+Sans:ital,wght@0,400;0,700;1,400;1,700' },
  { label: 'Overpass',             css: '"Overpass", sans-serif',                     google: 'Overpass:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Display / Condensed
  { label: 'Oswald',               css: '"Oswald", sans-serif',                       google: 'Oswald:wght@200;300;400;500;600;700' },
  { label: 'Bebas Neue',           css: '"Bebas Neue", sans-serif',                   google: 'Bebas+Neue' },
  { label: 'Anton',                css: '"Anton", sans-serif',                        google: 'Anton' },
  { label: 'Barlow Condensed',     css: '"Barlow Condensed", sans-serif',             google: 'Barlow+Condensed:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Fjalla One',           css: '"Fjalla One", sans-serif',                   google: 'Fjalla+One' },
  { label: 'Russo One',            css: '"Russo One", sans-serif',                    google: 'Russo+One' },
  { label: 'Black Han Sans',       css: '"Black Han Sans", sans-serif',               google: 'Black+Han+Sans' },
  { label: 'Exo 2',                css: '"Exo 2", sans-serif',                        google: 'Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Teko',                 css: '"Teko", sans-serif',                         google: 'Teko:wght@300;400;500;600;700' },
  { label: 'Big Shoulders Display',css: '"Big Shoulders Display", sans-serif',        google: 'Big+Shoulders+Display:wght@100;200;300;400;500;600;700;800;900' },
  { label: 'Orbitron',             css: '"Orbitron", sans-serif',                     google: 'Orbitron:wght@400;500;600;700;800;900' },
  { label: 'Chakra Petch',         css: '"Chakra Petch", sans-serif',                 google: 'Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  // Display — Bold / Expressive
  { label: 'Abril Fatface',        css: '"Abril Fatface", cursive',                   google: 'Abril+Fatface' },
  { label: 'Righteous',            css: '"Righteous", sans-serif',                    google: 'Righteous' },
  { label: 'Paytone One',          css: '"Paytone One", sans-serif',                  google: 'Paytone+One' },
  { label: 'Passion One',          css: '"Passion One", sans-serif',                  google: 'Passion+One:wght@400;700;900' },
  { label: 'Boogaloo',             css: '"Boogaloo", sans-serif',                     google: 'Boogaloo' },
  { label: 'Lilita One',           css: '"Lilita One", sans-serif',                   google: 'Lilita+One' },
  // Serif — Elegant
  { label: 'Playfair Display',     css: '"Playfair Display", serif',                  google: 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Merriweather',         css: '"Merriweather", serif',                      google: 'Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Lora',                 css: '"Lora", serif',                              google: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700' },
  { label: 'EB Garamond',          css: '"EB Garamond", serif',                       google: 'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Cormorant',            css: '"Cormorant Garamond", serif',                google: 'Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  { label: 'Libre Baskerville',    css: '"Libre Baskerville", serif',                 google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
  { label: 'Crimson Pro',          css: '"Crimson Pro", serif',                       google: 'Crimson+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Spectral',             css: '"Spectral", serif',                          google: 'Spectral:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Domine',               css: '"Domine", serif',                            google: 'Domine:wght@400;500;600;700' },
  // Serif — Display
  { label: 'Bodoni Moda',          css: '"Bodoni Moda", serif',                       google: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;0,6..96,700;0,6..96,800;0,6..96,900;1,6..96,400;1,6..96,500;1,6..96,600;1,6..96,700;1,6..96,800;1,6..96,900' },
  { label: 'Cinzel',               css: '"Cinzel", serif',                            google: 'Cinzel:wght@400;500;600;700;800;900' },
  { label: 'DM Serif Display',     css: '"DM Serif Display", serif',                  google: 'DM+Serif+Display:ital,wght@0,400;1,400' },
  // Script / Decorative
  { label: 'Dancing Script',       css: '"Dancing Script", cursive',                  google: 'Dancing+Script:wght@400;500;600;700' },
  { label: 'Pacifico',             css: '"Pacifico", cursive',                        google: 'Pacifico' },
  { label: 'Lobster',              css: '"Lobster", cursive',                         google: 'Lobster' },
  // System
  { label: 'Georgia',              css: 'Georgia, serif',                             google: null },
  { label: 'Impact',               css: 'Impact, sans-serif',                         google: null },
] as const;

// Built-in labels (autocomplete) plus any string, so user-uploaded font labels are valid too.
export type CarouselFontLabel = typeof CAROUSEL_FONTS[number]['label'] | (string & {});

export const CAROUSEL_WEIGHTS = [
  { label: 'Light',   value: 300 as CarouselFontWeight },
  { label: 'Regular', value: 400 as CarouselFontWeight },
  { label: 'Medium',  value: 500 as CarouselFontWeight },
  { label: 'Semi',    value: 600 as CarouselFontWeight },
  { label: 'Bold',    value: 700 as CarouselFontWeight },
  { label: 'XBold',   value: 900 as CarouselFontWeight },
];

// ── Tag system ────────────────────────────────────────────────────────────────

export interface ShadowStyle {
  enabled:  boolean;
  color:    string;
  blur:     number;
  offsetX:  number;
  offsetY:  number;
  opacity:  number;
  lift:     number;
}
export function defaultShadowStyle(): ShadowStyle {
  return { enabled: false, color: '#000000', blur: 16, offsetX: 0, offsetY: 6, opacity: 60, lift: 0 };
}

export interface TagStyle {
  bgColor:       string;
  bgOpacity:     number;   // 0-100
  borderColor:   string;
  borderWidth:   number;   // 0-8
  borderOpacity: number;   // 0-100
  cornerRadius:  number;   // 0-40
  textColor:     string;
  fontSize:      number;   // 8-36
  fontWeight:    CarouselFontWeight;
  italic:        boolean;
  fontLabel:     CarouselFontLabel;
  paddingX:      number;   // 0-32
  paddingY:      number;   // 0-20
  letterSpacing: number;   // 0-20 px
  textCase:      'none' | 'upper' | 'smallcaps';
  shadow?:       ShadowStyle;
}

export function defaultTagStyle(): TagStyle {
  return {
    bgColor: '#dc2626', bgOpacity: 100,
    borderColor: '#ffffff', borderWidth: 0, borderOpacity: 100,
    cornerRadius: 4,
    textColor: '#ffffff',
    fontSize: 13, fontWeight: 700, italic: false, fontLabel: 'Inter',
    paddingX: 10, paddingY: 4,
    letterSpacing: 0, textCase: 'none',
  };
}

export interface TagPreset { id: string; label: string; initStyle: Partial<TagStyle> }

export const TAG_PRESETS: TagPreset[] = [
  { id: 'breaking',   label: 'BREAKING',   initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'trending',   label: 'TRENDING',   initStyle: { bgColor: '#ea580c', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'live',       label: '● LIVE',     initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 20 } },
  { id: 'exclusive',  label: 'EXCLUSIVE',  initStyle: { bgColor: '#000000', bgOpacity: 90,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 60 } },
  { id: 'developing', label: 'DEVELOPING', initStyle: { bgColor: '#fbbf24', bgOpacity: 100, textColor: '#000000', fontWeight: 700, cornerRadius: 3 } },
  { id: 'new',        label: 'NEWS',       initStyle: { bgColor: '#16a34a', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'alert',      label: 'ALERT',      initStyle: { bgColor: '#7c3aed', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'update',     label: 'UPDATE',     initStyle: { bgColor: '#0284c7', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'opinion',    label: 'OPINION',    initStyle: { bgColor: '#00000000', bgOpacity: 0,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 100 } },
];

export type SwipeArrowType = 'line' | 'triangle' | 'chevron' | 'double-chevron' | 'curved';
export type SwipeLayout = 'text-arrow' | 'arrow-text' | 'stacked' | 'arrow-only' | 'text-only';
export type SwipeDirection = 'left' | 'right';

export interface SwipeStyle {
  text: string;
  allCaps: boolean;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  fontSize: number;        // canvas px
  textColor: string;
  letterSpacing: number;   // canvas px
  arrowType: SwipeArrowType;
  arrowLength: number;     // canvas px (line length, 0 = head only)
  arrowColor: string;
  arrowWeight: number;     // stroke width canvas px
  arrowHeadSize: number;   // half-height of arrowhead canvas px
  direction: SwipeDirection;
  layout: SwipeLayout;
  gap: number;             // canvas px between text and arrow
  opacity: number;         // 0-100
  shadow?: ShadowStyle;
}

export function defaultSwipeStyle(): SwipeStyle {
  return {
    text: 'SWIPE', allCaps: true,
    fontLabel: 'Inter', fontWeight: 700,
    fontSize: 22, textColor: '#ffffff', letterSpacing: 3,
    arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff',
    arrowWeight: 2, arrowHeadSize: 10,
    direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100,
  };
}

export const SWIPE_PRESETS: { id: string; label: string; style: SwipeStyle }[] = [
  { id: 'swipe-right',      label: 'Swipe →',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100 } },
  { id: 'swipe-left',       label: '← Swipe',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'swipe-for-more',   label: 'Swipe for more',  style: { text: 'Swipe for more', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 17, textColor: '#a1a1aa', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#a1a1aa', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 8, opacity: 100 } },
  { id: 'swipe-to-end',     label: 'Swipe to the end', style: { text: 'Swipe to the end', allCaps: false, fontLabel: 'Inter', fontWeight: 300, fontSize: 16, textColor: '#ffffff', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 6, opacity: 80 } },
  { id: 'explore-more',     label: 'Explore more',    style: { text: 'EXPLORE MORE', allCaps: true, fontLabel: 'Outfit', fontWeight: 500, fontSize: 16, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 40, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 10, opacity: 100 } },
  { id: 'double-chevron-r', label: '>>',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'double-chevron-l', label: '<<',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'left', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'long-arrow',       label: 'Long arrow',      style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'line', arrowLength: 120, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 10, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'bold-swipe-left',  label: 'Bold ←',          style: { text: 'SWIPE LEFT', allCaps: true, fontLabel: 'Bebas Neue', fontWeight: 400, fontSize: 26, textColor: '#ffffff', letterSpacing: 4, arrowType: 'triangle', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 3, arrowHeadSize: 14, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'stacked-swipe',    label: 'Stacked',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 600, fontSize: 18, textColor: '#ffffff', letterSpacing: 5, arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'stacked', gap: 8, opacity: 100 } },
];

export interface TextSpan {
  text:    string;
  color?:  string;
  bold?:   boolean;
  italic?: boolean;
  weight?: number;   // explicit per-run font weight (100-900); overrides `bold` when set
}

// Reframe for a circular photo slot: pan the source (x/y in −1..1, 0 = centred) and zoom into it
// (zoom ≥ 1). Only meaningful when image slots are circular; ignored for rectangular slots.
export interface SlotCrop { x?: number; y?: number; zoom?: number }
export type SlotContent = { type: 'image'; url: string };
export interface QuoteSlotContent { styleId: string }
export type LayerId = 'background' | 'circle' | 'circle2' | 'subject';

export interface SidebarElementData {
  type: 'divider' | 'tag' | 'logo' | 'quote' | 'swipe' | 'image' | 'video' | 'text';
  id?: string;
  text?: string;
  url?: string;
  style?: TagStyle;
  swipeStyle?: SwipeStyle;
  textPreset?: Partial<TextBoxStyle>;   // type 'text': styling seed for the dropped text box
}

export type DividerSubSlotContent =
  | { type: 'image'; url: string; crop?: SlotCrop }
  | { type: 'tag'; text: string; style: TagStyle }
  | { type: 'swipe'; style: SwipeStyle };

export interface DividerStyleSettings {
  lineColor:      string;   // hex color
  lineOpacity:    number;   // 0-100 (primary line opacity; secondary ~64% of this)
  lineWeight:     number;   // 1-20 canvas px
  dashLen:        number;   // dashed: dash length (canvas px)
  dashGap:        number;   // dashed: gap between dashes (canvas px)
  dotSize:        number;   // dotted: dot diameter (canvas px)
  dotSpacing:     number;   // dotted: gap between dots (canvas px)
  doubleSpacing:  number;   // double / double-fade / tag-double: half-offset from center (canvas px)
  tripleSpacing:  number;   // triple: offset of outer lines from center (canvas px)
  centerWeight:   number;   // triple: center line weight (canvas px)
  dotRadius:      number;   // dot-center: dot radius (canvas px)
  dotGap:         number;   // dot-center: gap from dot edge to line start (canvas px)
  taperHeight:    number;   // taper / thick-taper: height as % of slot height (5-60)
  shortLength:    number;   // short-center: total length as % of slot width (10-90)
  waveAmplitude:  number;   // wave: amplitude as % of slot height (2-50)
  bracketWidth:   number;   // brackets: bracket arm width (canvas px)
  bracketMargin:  number;   // brackets: margin from slot edge (canvas px)
  contentGap:     number;   // tag-* / logo-*: gap between content and line ends (canvas px)
  fadeSpread:     number;   // fade dividers: 0-50 for symmetric (% each side), 0-100 for directional (% of width that fades)
  shadow?:        ShadowStyle;
}

export function defaultDividerSettings(divId?: string): DividerStyleSettings {
  return {
    lineColor:     '#ffffff',
    lineOpacity:   55,
    lineWeight:    divId === 'thick' ? 6 : 2,
    dashLen:       28,
    dashGap:       20,
    dotSize:       3,
    dotSpacing:    18,
    doubleSpacing: divId === 'tag-double' ? 10 : divId === 'double-fade' ? 7 : 8,
    tripleSpacing: 10,
    centerWeight:  5,
    dotRadius:     8,
    dotGap:        20,
    taperHeight:   divId === 'thick-taper' ? 35 : 25,
    shortLength:   33,
    waveAmplitude: 18,
    bracketWidth:  24,
    bracketMargin: 30,
    contentGap:    20,
    fadeSpread:
      divId === 'double-fade' ? 25 :
      divId === 'dashed-fade' || divId === 'taper-dashed' ? 20 :
      divId === 'logo-center-fade' || divId === 'tag-center-fade' ? 40 :
      divId === 'fade-left' || divId === 'logo-left-fade' || divId === 'tag-left-fade' ? 100 :
      30,
  };
}

export interface TextBoxStyle {
  id:            string;
  text:          string;
  x:             number;   // anchor X in canvas px (0-1080)
  y:             number;   // top   Y in canvas px (0-1350)
  fontLabel:     CarouselFontLabel;
  fontSize:      number;   // canvas (design) px
  fontWeight:    CarouselFontWeight;
  secondaryWeight?: CarouselFontWeight;  // optional 2nd weight (same family) for highlighting; placeholder filler alternates primary/secondary per word
  italic:        boolean;
  allCaps?:      boolean;  // render the text uppercase (non-destructive — the typed text is unchanged)
  spans?:        TextSpan[];  // rich per-run styling (weight/italic/colour); when set, overrides `text` for rendering
  fillPlaceholder?: boolean;  // fill `text` with `placeholderWords` lorem words; off the moment the user types
  placeholderWords?: number;  // how many lorem words to insert when fillPlaceholder is on (default 8)
  color:         string;
  align:         CarouselTextAlign;   // left | center | right | justify
  fitToWidth?:   boolean;             // poster mode: auto-break + scale each line's font size to fill the box (overrides align)
  vAlign:        'top' | 'middle' | 'bottom';
  width:         number;   // box width  in canvas px (text wraps to this)
  height:        number;   // box height in canvas px (vertical-align region)
  letterSpacing: number;   // px
  lineHeight:    number;   // 0-100 (multiplier = 1 + v/100 * 1.2)
  opacity:       number;   // 0-100
  shadow?:       ShadowStyle;
  hidden?:       boolean;  // layers panel: skip rendering + canvas interaction
  locked?:       boolean;  // layers panel: render but block selection/move/resize on the canvas
  label?:        string;   // role name shown in the settings panel (e.g. 'Headline', 'Body 1')
}

export function defaultTextBox(): TextBoxStyle {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `tb-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return {
    id,
    text: 'Lorem ipsum',   // replaced by fitted filler once the canvas measures the box (fillPlaceholder)
    x: 270, y: 575, width: 540, height: 200,   // canvas px (1080×1350 space)
    fontLabel: 'Inter', fontSize: 40, fontWeight: 700, italic: false,
    fillPlaceholder: true, placeholderWords: 8,
    color: '#ffffff', align: 'center', vAlign: 'middle',
    letterSpacing: 0, lineHeight: 15, opacity: 100,
  };
}

// A free, positioned image dropped onto the canvas (from Uploads)
// Per-edge fade for an image box. Each value is 0-100 (% of that dimension that
// fades). color omitted/empty → fade to transparent; otherwise fade into the colour.
export type FadeEdge = 'top' | 'bottom' | 'left' | 'right';

// One stop in an edge's fade curve. loc runs 0 (at the edge) → 100 (at the reach distance);
// opacity is the image's visibility there (0 = fully faded, 100 = solid). mid is the
// Photoshop-style blend midpoint toward the next stop (0-100, default 50).
export interface FadeStop {
  loc:     number;
  opacity: number;
  mid?:    number;
}

export interface ImageBoxFade {
  enabled?: boolean;  // false collapses the controls and skips rendering; undefined = derive from edge values (legacy)
  top:    number;
  bottom: number;
  left:   number;
  right:  number;
  color?: string;
  // Per-edge opacity curve. Absent edge → default linear ramp (faded at the edge → solid at reach).
  stops?: Partial<Record<FadeEdge, FadeStop[]>>;
}

// Default fade curve = the original linear ramp: fully faded at the edge → solid at the reach distance.
export function defaultFadeStops(): FadeStop[] {
  return [{ loc: 0, opacity: 0, mid: 50 }, { loc: 100, opacity: 100 }];
}

// Sample a fade curve (honouring per-stop midpoints) into gradient stops.
// Returns [{ pos: 0-1 along the fade, vis: 0-1 image visibility }]; end stops are extended to 0/1.
export function sampleFadeStops(stops: FadeStop[]): { pos: number; vis: number }[] {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const sorted = [...stops].sort((a, b) => a.loc - b.loc);
  if (sorted.length === 0) return [{ pos: 0, vis: 1 }, { pos: 1, vis: 1 }];
  if (sorted.length === 1) { const v = clamp01(sorted[0].opacity / 100); return [{ pos: 0, vis: v }, { pos: 1, vis: v }]; }
  const out: { pos: number; vis: number }[] = [];
  if (sorted[0].loc > 0) out.push({ pos: 0, vis: clamp01(sorted[0].opacity / 100) });
  for (let i = 0; i < sorted.length - 1; i++) {
    const A = sorted[i], B = sorted[i + 1];
    const pa = clamp01(A.loc / 100), pb = clamp01(B.loc / 100);
    const midPct = A.mid ?? 50;
    const linear = Math.abs(midPct - 50) < 0.5 || pb <= pa;
    const expo = linear ? 1 : Math.log(0.5) / Math.log(Math.min(0.999, Math.max(0.001, midPct / 100)));
    const steps = linear ? 1 : 12;
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const t = linear ? p : Math.pow(p, expo);
      out.push({ pos: pa + (pb - pa) * p, vis: clamp01((A.opacity + (B.opacity - A.opacity) * t) / 100) });
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.loc < 100) out.push({ pos: 1, vis: clamp01(last.opacity / 100) });
  return out;
}

// Per-edge crop for an image box. Each value is 0-1 (fraction of the source image
// hidden on that edge). Dragging a box's centre-edge handle adjusts these — revealing
// or hiding source pixels at a fixed scale rather than scaling, so it changes the box aspect.
export interface ImageBoxCrop {
  top:    number;
  bottom: number;
  left:   number;
  right:  number;
}

// Per-layer adjustments for an image box's foreground (subject) and background,
// available once subject/background split is enabled. brightness: -100..100 (0 = none);
// blur: 0..40 canvas px (gaussian); noise: 0..100 monochromatic grayscale grain.
export interface ImageEffects {
  brightness?:   number;
  blur?:         number;
  noise?:        number;
  blurEdgeFade?: boolean;   // blur edge style (box-filling layers): false (default) = solid edge-to-edge; true = fade to transparent at the edges
}

// Perspective/distort transform: per-corner offsets (canvas px) added to the box's natural
// rectangle corners, defining the destination quadrilateral the image is warped onto. All-zero
// (or undefined) = no transform. Stored on the box; the warp is applied in drawImageBox so it
// survives reload and exports at any scale. The three edit modes (Distort/Perspective/Skew) only
// constrain how a drag updates these offsets — the stored shape and rendering are identical.
export interface ImageBoxPerspective {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}

export type PerspectiveMode = 'distort' | 'perspective' | 'skew';

export interface ImageBox {
  id:           string;
  url:          string;
  x:            number;   // top-left, canvas px (0-1080)
  y:            number;   // top-left, canvas px (0-1350)
  width:        number;   // canvas px
  height:       number;   // canvas px
  opacity:      number;   // 0-100
  cornerRadius: number;   // px
  shape?:       'rect' | 'circle';   // circle → clip to a circle inscribed in the box (overrides corner radius)
  aspect?:      number;   // native width/height (full precision) — preserved for aspect-lock
  shadow?:      ShadowStyle;  // drop shadow
  fade?:        ImageBoxFade; // per-edge fade — foreground (subject when split) / whole image when not split
  bgFade?:      ImageBoxFade; // per-edge fade for the background layer (when "detect background" is on)
  crop?:        ImageBoxCrop; // source-rect crop (fraction off each edge); set by dragging centre-edge handles
  circleCrop?:  SlotCrop;     // circle only: reframe within the disc (pan x/y −1..1 + zoom ≥1); cover-crop, ignores `crop`
  perspective?: ImageBoxPerspective; // per-corner offsets warping the box onto a quad (Distort/Perspective/Skew)
  hidden?:      boolean;      // layers panel: skip rendering + canvas interaction
  locked?:      boolean;      // layers panel: render but block selection/move/resize on the canvas
  blend?:       string;       // canvas globalCompositeOperation (blend mode); default 'source-over'
  isOverlay?:   boolean;      // developer overlay texture: full-canvas, Screen blend, no canvas frame (managed via Layers)
  // ── Video: when set, the box plays a video (mp4 / H.264) in place of the static image at `url`. Posts only. ──
  videoUrl?:    string;       // public URL of the uploaded video (post-videos bucket); box renders its live frames
  videoMuted?:  boolean;      // editor-preview audio (default muted)
  // ── Subject split: per-box background removal + independent fg/bg effects ──
  splitEnabled?: boolean;       // split active — gates the (async) removeBackground run and the split draw path
  fgUrl?:        string;        // persisted cut-out PNG (subject on transparent bg) public URL — survives reload/export
  fgEffects?:    ImageEffects;  // foreground (subject) layer adjustments
  bgEffects?:    ImageEffects;  // background (everything-else) layer adjustments
}

export type LayerKind = 'image' | 'text' | 'fade' | 'free' | 'skeleton' | 'skeletonlogos' | 'headline' | 'sub' | 'zonelogo'
  // Skeleton tag/quote/swipe slots hoisted out of the monolithic skeleton pass so each stacks + hides
  // like any other layer. Row-* = the 3 row-aligned slots; zone-* = the 3×3 grid slots.
  | 'rowtag' | 'rowquote' | 'zonetag' | 'zonequote' | 'zoneswipe';

// Reserved layer id for the settings fade (bottom/top gradient overlay) so it can be ordered
// among the free elements. It's a sentinel, not a real element id.
export const FADE_LAYER_ID = '__fade__';

// Reserved layer ids so the skeleton's parts can each be positioned in the layer order. SKELETON =
// the boxed zone content (logos/tags/quotes/dividers/swipes); HEADLINE / SUB = the two text lines.
// Each is a sentinel; if absent it defaults near the top (in front), so existing templates render
// unchanged (text in front of the boxed overlays).
export const SKELETON_LAYER_ID = '__skeleton__';
// The row logos (3 row-aligned brand logos) draw as their own band BEHIND the hoisted tag/quote/swipe
// layers (their historical back-most skeleton position), so they get a sentinel separate from the
// dividers-only SKELETON pass. Draw-only — no panel row (row logos aren't user-reorderable today).
export const SKELETON_LOGOS_LAYER_ID = '__skeletonlogos__';
export const HEADLINE_LAYER_ID = '__headline__';
export const SUB_LAYER_ID = '__sub__';

// Resolve the unified bottom→top draw order of the free elements (image + text boxes), and
// optionally the settings fade. Honours `orderIds`; elements missing from it are appended on top
// (images before text). The fade, if included and unordered, defaults to the very bottom (its
// original position, under everything) — so existing templates render unchanged.
export function orderedLayerIds(
  imageBoxes: { id: string }[],
  textBoxes: { id: string }[],
  freeElements: { id: string }[],
  orderIds?: string[],
  includeFade = false,
  includeSkeleton = false,
  zoneLogoSlots?: (string | null)[],   // 3×3 grid logo slots — each filled slot is its own layer id (zonelogo-<i>)
  // Skeleton tag/quote/swipe content (row-aligned slots + 3×3 zone slots). Each filled slot becomes its
  // own layer id (rowtag-<i> / rowquote-<i> / zonetag-<i> / zonequote-<i> / zoneswipe-<i>) so it stacks
  // and hides like every other layer, instead of being baked into the single skeleton pass.
  zoneContent?: {
    tagSlots?:       readonly unknown[];
    quoteSlots?:     readonly unknown[];
    tagZoneSlots?:   readonly unknown[];
    quoteZoneSlots?: readonly unknown[];
    swipeZoneSlots?: readonly unknown[];
  },
): { kind: LayerKind; id: string }[] {
  // Filled skeleton tag/quote/swipe slots, as their own layer ids — emitted in the SAME order the old
  // monolithic skeleton pass painted them (all row tags, then all row quotes, then per-zone
  // tag→quote→swipe), so their default stacking is unchanged. Capped to the real slot counts (3 row, 9 zone).
  const zc = zoneContent ?? {};
  const zoneItems: { kind: LayerKind; id: string }[] = [];
  for (let i = 0; i < 3; i++) if (zc.tagSlots?.[i])   zoneItems.push({ kind: 'rowtag',   id: `rowtag-${i}` });
  for (let i = 0; i < 3; i++) if (zc.quoteSlots?.[i]) zoneItems.push({ kind: 'rowquote', id: `rowquote-${i}` });
  for (let fi = 0; fi < 9; fi++) {
    if (zc.tagZoneSlots?.[fi])   zoneItems.push({ kind: 'zonetag',   id: `zonetag-${fi}` });
    if (zc.quoteZoneSlots?.[fi]) zoneItems.push({ kind: 'zonequote', id: `zonequote-${fi}` });
    if (zc.swipeZoneSlots?.[fi]) zoneItems.push({ kind: 'zoneswipe', id: `zoneswipe-${fi}` });
  }

  const kindById = new Map<string, LayerKind>();
  for (const e of freeElements) kindById.set(e.id, 'free');
  for (const b of imageBoxes) kindById.set(b.id, 'image');
  for (const t of textBoxes) kindById.set(t.id, 'text');
  (zoneLogoSlots ?? []).forEach((slot, fi) => { if (slot) kindById.set(`zonelogo-${fi}`, 'zonelogo'); });
  for (const it of zoneItems) kindById.set(it.id, it.kind);
  if (includeFade) kindById.set(FADE_LAYER_ID, 'fade');
  if (includeSkeleton) {
    kindById.set(SKELETON_LAYER_ID, 'skeleton');
    kindById.set(SKELETON_LOGOS_LAYER_ID, 'skeletonlogos');
    kindById.set(HEADLINE_LAYER_ID, 'headline');
    kindById.set(SUB_LAYER_ID, 'sub');
  }
  const out: { kind: LayerKind; id: string }[] = [];
  const seen = new Set<string>();
  for (const id of orderIds ?? []) {
    const kind = kindById.get(id);
    if (kind && !seen.has(id)) { out.push({ kind, id }); seen.add(id); }
  }
  if (includeFade && !seen.has(FADE_LAYER_ID)) { out.unshift({ kind: 'fade', id: FADE_LAYER_ID }); seen.add(FADE_LAYER_ID); }
  // Ids not yet ordered stack newest-on-top, free elements beneath the boxes
  // (matching their historical draw position).
  for (const e of freeElements) if (!seen.has(e.id)) { out.push({ kind: 'free', id: e.id }); seen.add(e.id); }
  for (const b of imageBoxes) if (!seen.has(b.id)) { out.push({ kind: 'image', id: b.id }); seen.add(b.id); }
  for (const t of textBoxes) if (!seen.has(t.id)) { out.push({ kind: 'text', id: t.id }); seen.add(t.id); }
  (zoneLogoSlots ?? []).forEach((slot, fi) => { const id = `zonelogo-${fi}`; if (slot && !seen.has(id)) { out.push({ kind: 'zonelogo', id }); seen.add(id); } });
  // Unordered skeleton tag/quote/swipe default into the skeleton band — below the dividers and above the
  // row logos (which are re-anchored below, after the rest of the band is laid out).
  for (const it of zoneItems) if (!seen.has(it.id)) { out.push(it); seen.add(it.id); }
  // Skeleton parts, if unordered, default near the top: boxed overlays, then headline, then sub on
  // top — its historical paint order (text in front of overlays), so existing templates are unchanged.
  if (includeSkeleton) {
    if (!seen.has(SKELETON_LAYER_ID)) { out.push({ kind: 'skeleton', id: SKELETON_LAYER_ID }); seen.add(SKELETON_LAYER_ID); }
    if (!seen.has(SUB_LAYER_ID)) { out.push({ kind: 'sub', id: SUB_LAYER_ID }); seen.add(SUB_LAYER_ID); }
    if (!seen.has(HEADLINE_LAYER_ID)) { out.push({ kind: 'headline', id: HEADLINE_LAYER_ID }); seen.add(HEADLINE_LAYER_ID); }
    // Row logos are a draw-only band with no panel row, so they can't persist a z-position of their own.
    // Re-anchor them on EVERY build to sit just BEHIND the bottom-most tag/quote/swipe item (or the
    // dividers sentinel, if there are none) — their historical back-most skeleton position. This keeps
    // them behind that content no matter how the user reordered it, and even after the tag/quote/swipe
    // ids get persisted into layerOrderIds (which would otherwise strand the un-rowed logos at the front).
    if (!seen.has(SKELETON_LOGOS_LAYER_ID)) {
      const anchorIds = new Set<string>([...zoneItems.map(z => z.id), SKELETON_LAYER_ID]);
      const at = out.findIndex(o => anchorIds.has(o.id));
      const entry: { kind: LayerKind; id: string } = { kind: 'skeletonlogos', id: SKELETON_LOGOS_LAYER_ID };
      if (at >= 0) out.splice(at, 0, entry); else out.push(entry);
      seen.add(SKELETON_LOGOS_LAYER_ID);
    }
  }
  return out;
}

export interface CarouselSettings {
  showFade: boolean;
  fadeReach: number;
  fadeIntensity: number;
  fadeFloor: number;
  showTopFade: boolean;
  topFadeReach: number;
  topFadeIntensity: number;
  topFadeFloor: number;
  fontSize: number;
  lSpacing: number;
  lHeight: number;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  italic: boolean;
  textAlign: CarouselTextAlign;
  allCaps: boolean;
  subFontSize: number;
  subLSpacing: number;
  subLHeight: number;
  subFontLabel: CarouselFontLabel;
  subFontWeight: CarouselFontWeight;
  subItalic: boolean;
  subTextAlign: CarouselTextAlign;
  subAllCaps: boolean;
  headSubGap: number;
  aboveLogoGap: number;
  logoOpacity: number;
  logoScale: number;
  logoCornerRadius: number;
  logoShape?: 'rect' | 'circle';    // circle → clip logos to a circle (overrides corner radius)
  imageShape?: 'rect' | 'circle';   // circle → clip image slots (uploaded photos) to a circle
  contentPadding: number;
  tagStyle: TagStyle;
  tagSlots:       ({ text: string; style: TagStyle } | null)[];
  tagSlotsHidden?:  (boolean | null)[];   // layers panel: per-row-tag hide flag (parallels tagSlots)
  tagSlotAligns?:  ('left' | 'center' | 'right')[];
  logoSlotAligns?: ('left' | 'center' | 'right')[];
  // Zone-level independent slots: 9 entries, index = row*3 + zone (0=left,1=center,2=right)
  tagZoneSlots?:   ({ text: string; style: TagStyle } | null)[];
  tagZoneHidden?:   (boolean | null)[];   // layers panel: per-zone-tag hide (parallels tagZoneSlots)
  quoteZoneSlots?: (string | null)[];
  quoteZoneHidden?: (boolean | null)[];   // layers panel: per-zone-quote hide (parallels quoteZoneSlots)
  zoneLogoSlots?:  (string | null)[];      // 9 entries — logo URL per zone, null = empty
  zoneLogoStyles?: ({ opacity?: number; scale?: number; cornerRadius?: number; shape?: 'rect' | 'circle'; shadow?: ShadowStyle; hidden?: boolean } | null)[];  // per-zone-logo style override, parallels zoneLogoSlots
  logoRowSlots?:   (string | null)[];     // 3 entries — logo URL per row slot, null = empty
  swipeZoneSlots?: (SwipeStyle | null)[];  // 9 entries, row*3+zone
  swipeZoneHidden?: (boolean | null)[];   // layers panel: per-zone-swipe hide (parallels swipeZoneSlots)
  // Freeform elements: zone-style content (tag/quote/swipe/logo/divider) that has
  // been dragged OUT of a skeleton box (or dropped outside one). x/y/width/height
  // in canvas px; content draws centered inside the box, like its zone version.
  freeElements?:   FreeElement[];
  bgBlurEnabled:  boolean;
  bgBlurAmount:   number;
  bgDarkenAmount: number;
  canvasColor:    string;
  canvasTransparent?: boolean;   // render the background transparent (checkerboard in editor); keeps canvasColor so it can be restored
  textBoxes:      TextBoxStyle[];
  imageBoxes:     ImageBox[];
  // Unified bottom→top draw order for free elements (image + text boxes) + the fade (FADE_LAYER_ID).
  // Ids missing here render on top (images before text); the fade defaults to the bottom.
  layerOrderIds?: string[];
  fadeHidden?:    boolean;   // layers panel: hide the settings fade without touching its on/reach values
  headlineHidden?: boolean;  // layers panel: hide the skeleton headline without clearing its text/style
  subHidden?:      boolean;  // layers panel: hide the skeleton sub-headline without clearing its text/style
  layerOrder:     LayerId[];
  circleBorderWidth:   number;
  circleBorderColor:   string;
  circleBorderOpacity: number;
  circleShadowEnabled: boolean;
  circleShadowBlur:    number;
  circleShadowOffsetX: number;
  circleShadowOffsetY: number;
  circleShadowColor:   string;
  circleShadowOpacity: number;
  circleLift:          number;
  quoteSlots:     (string | null)[];
  quoteSlotsHidden?: (boolean | null)[];  // layers panel: per-row-quote hide flag (parallels quoteSlots)
  dividerSlots?:     (string | null)[];
  dividerSubSlots?:  (DividerSubSlotContent | null)[];
  dividerSettings?:  (Partial<DividerStyleSettings> | null)[];
  quoteColor:     string;
  quoteSize:      number;
  quoteOpacity:   number;
  quoteGap:       number;
  headlineColor:  string;
  subheadlineColor: string;
  headlineShadow?:    ShadowStyle;
  subShadow?:         ShadowStyle;
  logoShadow?:        ShadowStyle;
  quoteShadow?:       ShadowStyle;
  headlineSpans:  TextSpan[] | null;
  subSpans:       TextSpan[] | null;
  circle2BorderWidth:   number;
  circle2BorderColor:   string;
  circle2BorderOpacity: number;
  circle2ShadowEnabled: boolean;
  circle2ShadowBlur:    number;
  circle2ShadowOffsetX: number;
  circle2ShadowOffsetY: number;
  circle2ShadowColor:   string;
  circle2ShadowOpacity: number;
  circle2Lift:          number;
}

// A zone-style element living freely on the canvas (escaped from a skeleton box).
export type FreeElement = {
  id: string;
  x: number;       // canvas px, top-left
  y: number;
  width: number;   // canvas px
  height: number;
  hidden?: boolean;   // layers panel: skip rendering + canvas interaction
} & (
  | { kind: 'tag';     text: string; style: TagStyle }
  | { kind: 'quote';   styleId: string }
  | { kind: 'swipe';   style: SwipeStyle }
  | { kind: 'logo';    url: string; opacity?: number; scale?: number; cornerRadius?: number; shape?: 'rect' | 'circle'; shadow?: ShadowStyle }
  | { kind: 'divider'; dividerId: string; settings?: Partial<DividerStyleSettings> | null; sub?: DividerSubSlotContent | null }
  // AI-generated custom element (chart/table/etc.). `code` is snapshotted onto the instance so a placed
  // element keeps rendering even if the library row changes; `elementId` links back for re-edit. `data` is
  // its current data (defaultData at design time; a node maps live data in when bound). See AI_ELEMENTS_DESIGN.md.
  | { kind: 'custom'; elementId: string; name: string; code: string; inputSchema?: ElementInput[]; data?: unknown }
);

export function defaultCarouselSettings(): CarouselSettings {
  return {
    showFade: true, fadeReach: 40, fadeIntensity: 85, fadeFloor: 20,
    showTopFade: false, topFadeReach: 40, topFadeIntensity: 85, topFadeFloor: 20,
    fontSize: 68, lSpacing: 0, lHeight: 15,
    fontLabel: 'Inter', fontWeight: 700, italic: false, textAlign: 'left', allCaps: false,
    subFontSize: 32, subLSpacing: 0, subLHeight: 10,
    subFontLabel: 'Inter', subFontWeight: 400, subItalic: false, subTextAlign: 'left', subAllCaps: false,
    headSubGap: 20, aboveLogoGap: 8, logoOpacity: 100, logoScale: 100, logoCornerRadius: 0, contentPadding: 50,
    tagStyle: defaultTagStyle(),
    tagSlots: Array(3).fill(null),
    bgBlurEnabled: false, bgBlurAmount: 10, bgDarkenAmount: 0, canvasColor: '#000000',
    freeElements: [],
    textBoxes: [],
    imageBoxes: [],
    layerOrder: ['background', 'subject'] as LayerId[],
    circleBorderWidth: 10, circleBorderColor: '#ffffff', circleBorderOpacity: 100,
    circleShadowEnabled: false,
    circleShadowBlur: 20, circleShadowOffsetX: 0, circleShadowOffsetY: 8,
    circleShadowColor: '#000000', circleShadowOpacity: 50,
    circleLift: 0,
    quoteSlots:    Array(3).fill(null),
    quoteColor:    '#ffffff',
    quoteSize:     120,
    quoteOpacity:  100,
    quoteGap:      8,
    headlineColor: '#ffffff',
    subheadlineColor: '#ffffff',
    headlineSpans: null,
    subSpans:      null,
    circle2BorderWidth: 10, circle2BorderColor: '#ffffff', circle2BorderOpacity: 100,
    circle2ShadowEnabled: false,
    circle2ShadowBlur: 20, circle2ShadowOffsetX: 0, circle2ShadowOffsetY: 8,
    circle2ShadowColor: '#000000', circle2ShadowOpacity: 50,
    circle2Lift: 0,
  };
}

export interface CarouselBgLayerState {
  fgMaskReady: boolean;
  isBgProcessing: boolean;
  bgProcessError: boolean;
}

export interface TextBoxRichTextControls {
  activeBox: number | null;            // index of the text box currently being inline-edited (null = none)
  hasSelection: boolean;               // whether a run is selected inside that editor
  setWeight: (weight: number) => void; // style the current selection
  toggleItalic: () => void;
  setColor: (color: string) => void;
}

export interface TemplateEditorSettingsPanelProps {
  settings: CarouselSettings;
  onChange: (partial: Partial<CarouselSettings>) => void;
  videoMode?: boolean;
  isPosts?: boolean;   // Background section is posts-only (hidden in templates)
  // Skeleton text slots: section shows only while the slot holds text — once the
  // text is dragged out (freeform), its branched settings live on the text box card.
  headlineOccupied?: boolean;
  subheadlineOccupied?: boolean;
  selectedImageBox?: number | null;
  selectedFreeEl?: number | null;
  selectedTextBox?: number | null;
  // Drive canvas selection from the panel (an island opening ⟺ its element selected on the frame).
  onSelectFreeEl?: (i: number | null) => void;
  onSelectImageBox?: (i: number | null) => void;
  onSelectZoneLogo?: (i: number | null) => void;
  onSelectTextBox?: (i: number | null) => void;
  onSelectZoneSlot?: (kind: 'logo' | 'tag' | 'quote' | 'swipe', i: number | null) => void;
  onSetRichEditTarget?: (t: 'headline' | 'sub' | null) => void;
  selectedZoneSlot?: { kind: 'logo' | 'tag' | 'quote' | 'swipe'; index: number } | null;
  richEditTarget?: 'headline' | 'sub' | null;
  // Measured auto-heights for text boxes (canvas units), keyed by box id — for the read-only Height field.
  textBoxAutoHeights?: Record<string, number>;
  lockImageAspect?: boolean;
  onLockImageAspectChange?: (v: boolean) => void;
  richText?: TextBoxRichTextControls;
  // Per-box subject-split bg-removal status (keyed by image box id) for the Background/Foreground UI.
  imageBoxBgState?: Record<string, 'processing' | 'error'>;
  // Per-box BRIA image-expansion status (keyed by box id) + the action that runs the expand.
  imageBoxExpandState?: Record<string, 'processing' | 'error'>;
  onExpandImageBox?: (boxId: string) => void;
  // Image-expansion preview: the box currently being set up (its fill area is shaded on the canvas),
  // and the toggle to enter (boxId) / exit (null) that preview before generating.
  expandPreviewBoxId?: string | null;
  onExpandPreview?: (boxId: string | null) => void;
  // Perspective/distort transform: the box currently in corner-edit mode (its corner handles show
  // on the canvas), the active edit mode, and the toggles to enter/exit + switch mode.
  perspectiveBoxId?: string | null;
  onPerspectiveBox?: (boxId: string | null) => void;
  perspectiveMode?: PerspectiveMode;
  onPerspectiveMode?: (mode: PerspectiveMode) => void;
}
