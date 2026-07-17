// Legacy shared button class strings — kept for call sites not yet migrated to the ui/ primitives.
// Re-implemented on design tokens so the whole app inherits the HIG look for free. New code should
// prefer <Button>/<IconButton> from '@/app/components/ui'.

/** Icon-only square button — token-based ghost icon button (32px). */
export const BTN_ICON =
  'flex items-center justify-center w-8 h-8 rounded-md text-fg-2 hover:text-fg hover:bg-hover ' +
  'focus-ring transition-[background-color,color] duration-[var(--dur-fast)] disabled:opacity-40 disabled:cursor-not-allowed';

/** Text/label button with horizontal padding — token-based secondary button. */
export const BTN_TEXT =
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-label font-medium border border-line ' +
  'bg-surface-2 text-fg-2 hover:text-fg hover:border-line-strong ' +
  'focus-ring transition-[background-color,border-color,color] duration-[var(--dur-fast)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** Max characters for a user-named asset (carousel / reel template / automation). Header triggers show
 *  the name truncated with an ellipsis; the inline rename inputs enforce this limit and reveal it fully. */
export const NAME_MAX_LENGTH = 60;

/** Inline style object for the dot-grid page background (also available as the `.bg-dot-grid` class). */
export const GRID_BG_STYLE: React.CSSProperties = {
  // Grid line colour is theme-aware (--grid-line: faint white on dark, faint warm-grey on light).
  backgroundImage:
    'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
  backgroundSize: '96px 96px',
};

/** Dotted-canvas background for the flow/pipeline view — small dots on a fine grid, n8n-style.
 *  Dot colour is theme-aware (--canvas-dot: faint white on dark, faint warm-grey on light). */
export const DOT_CANVAS_STYLE: React.CSSProperties = {
  backgroundImage: 'radial-gradient(var(--canvas-dot, rgba(255,255,255,0.16)) 1.2px, transparent 1.2px)',
  backgroundSize: '22px 22px',
};
