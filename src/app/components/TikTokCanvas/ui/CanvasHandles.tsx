import type { Handle, Box } from '../types';
import { DISPLAY_SCALE, H_SIZE, CURSORS } from '../constants';

interface HandlePoint { type: Handle; cx: number; cy: number }

interface CanvasHandlesProps {
  box: Box;
  onStartDrag: (e: React.MouseEvent, handle: Handle) => void;
  // Reels (cellMode): the video band resizes VERTICALLY only (its width is fixed to the layout band), so
  // show just the top-/bottom-centre handles — no corners (diagonal) or sides. The box drives the band's
  // vertical extent in the draw, so these are functional. The move/pan area + border still show.
  verticalOnly?: boolean;
}

export function CanvasHandles({ box, onStartDrag, verticalOnly }: CanvasHandlesProps) {
  const handles: HandlePoint[] = [
    { type: 'tl', cx: box.x * DISPLAY_SCALE,                    cy: box.y * DISPLAY_SCALE },
    { type: 'tc', cx: (box.x + box.w / 2) * DISPLAY_SCALE,      cy: box.y * DISPLAY_SCALE },
    { type: 'tr', cx: (box.x + box.w) * DISPLAY_SCALE,          cy: box.y * DISPLAY_SCALE },
    { type: 'bl', cx: box.x * DISPLAY_SCALE,                    cy: (box.y + box.h) * DISPLAY_SCALE },
    { type: 'bc', cx: (box.x + box.w / 2) * DISPLAY_SCALE,      cy: (box.y + box.h) * DISPLAY_SCALE },
    { type: 'br', cx: (box.x + box.w) * DISPLAY_SCALE,          cy: (box.y + box.h) * DISPLAY_SCALE },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
      {/* Selection border — frames the resizable box (the video band in reels) */}
      <div
        style={{
          position: 'absolute',
          left: box.x * DISPLAY_SCALE,
          top: box.y * DISPLAY_SCALE,
          width: box.w * DISPLAY_SCALE,
          height: box.h * DISPLAY_SCALE,
          border: '1px solid rgba(255,255,255,0.35)',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }}
      />

      {/* Move hit-area */}
      <div
        style={{
          position: 'absolute',
          left: box.x * DISPLAY_SCALE + H_SIZE,
          top: box.y * DISPLAY_SCALE + H_SIZE,
          width: Math.max(0, box.w * DISPLAY_SCALE - H_SIZE * 2),
          height: Math.max(0, box.h * DISPLAY_SCALE - H_SIZE * 2),
          cursor: 'move',
          pointerEvents: 'auto',
        }}
        onMouseDown={e => onStartDrag(e, 'move')}
      />

      {/* Resize handles — all 8 for clean/market; only top-/bottom-centre (vertical) for reels */}
      {(verticalOnly ? handles.filter(h => h.type === 'tc' || h.type === 'bc') : handles).map(h => (
        <div
          key={h.type}
          onMouseDown={e => onStartDrag(e, h.type)}
          style={{
            position: 'absolute',
            left: h.cx - H_SIZE / 2,
            top: h.cy - H_SIZE / 2,
            width: H_SIZE,
            height: H_SIZE,
            background: '#fff',
            border: '1.5px solid rgba(0,0,0,0.4)',
            borderRadius: 2,
            cursor: CURSORS[h.type],
            pointerEvents: 'auto',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}
        />
      ))}
    </div>
  );
}
