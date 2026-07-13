// Centralized layout constants — were magic numbers scattered across Sidebar, CanvasGrid,
// TemplateEditorGrid, BuilderGrid. Values are UNCHANGED so no layout shifts.
export const RAIL_W = 220;         // sidebar width (px) — labeled rows; centralizes editor offsets
export const RAIL_W_COLLAPSED = 64; // sidebar width (px) when collapsed to icons-only
export const HEADER_H = 52;        // editor toolbar / sticky header height (px)
export const RIGHT_PANEL_W = 360;  // right settings/inspector dock width (px) — JS max fallback
export const LEFT_PANEL_W = 300;   // left elements rail width (px) — JS max fallback
export const LEFT_LIST_W = 208;    // twitter-template list column width (px)

// Responsive panel widths (CSS): shrink a little on small desktops, capped at the px max above so
// they never get fat on 4K. Driven from a single CSS var on <main> so the fixed panel width and the
// scroll-area padding that clears it ALWAYS read the same value (overlap-proof). See page.tsx.
export const RIGHT_PANEL_W_CSS = 'clamp(264px, 19vw, 300px)';
export const LEFT_PANEL_W_CSS = 'clamp(248px, 20vw, 300px)';
// CSS var references emitted on <main> and consumed by the editor shells.
export const LEFT_PANEL_VAR = 'var(--left-panel)';
export const RIGHT_PANEL_VAR = 'var(--right-panel)';
// Live sidebar width: emitted as --rail-w on the app-shell wrapper (page.tsx) and consumed by the
// <main> margin + every fixed editor rail (ElementRail, BuilderGrid panel, TemplateEditor zoom bar)
// so they all follow the sidebar as it collapses/expands. Falls back to the expanded width.
export const RAIL_VAR = 'var(--rail-w, 220px)';
