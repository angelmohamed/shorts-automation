'use client';

import { useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { DISPLAY_SCALE, MIN_DIM, CANVAS_W } from '../constants';
import type { Box, Handle } from '../types';

interface DragState {
  handle: Handle;
  sx: number;
  sy: number;
  sb: Box;
  videoOffsetStart: { x: number; y: number };
  scale: number;   // screen-px → canvas-px ratio captured at drag start (see startDrag)
  axisLock: 'x' | 'y' | null;   // Shift-drag pan: locked axis (first detected direction), null = free
}

interface UseDragParams {
  boxRef: MutableRefObject<Box>;
  setBox: (b: Box) => void;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;   // for the real on-screen scale (folds in CSS zoom)
  onChange?: () => void;   // fired once a drag ends — covers panning the video inside the crop (videoOffset)
                           // and box resizes, so the workspace can autosave framing (pan changes only a ref).
}

export function useDrag({ boxRef, setBox, videoOffsetRef, canvasRef, onChange }: UseDragParams) {
  const drag = useRef<DragState | null>(null);
  const isDraggingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    function applyDrag(dx: number, dy: number, shiftKey: boolean) {
      if (!drag.current) return;
      const { handle: h, sb, videoOffsetStart } = drag.current;
      const nx = sb.x, nw = sb.w;
      let ny = sb.y, nh = sb.h;

      if (h === 'move') {
        // Shift locks panning to a single axis — whichever direction is detected first. It stays locked
        // while Shift is held; releasing Shift frees it (and re-detects on the next press).
        let ddx = dx, ddy = dy;
        if (shiftKey) {
          const AXIS_TH = 2;   // canvas-px of movement before an axis is committed
          if (!drag.current.axisLock && (Math.abs(dx) > AXIS_TH || Math.abs(dy) > AXIS_TH)) {
            drag.current.axisLock = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          }
          if (drag.current.axisLock === 'x') ddy = 0;
          else if (drag.current.axisLock === 'y') ddx = 0;
        } else {
          drag.current.axisLock = null;
        }
        videoOffsetRef.current = { x: videoOffsetStart.x + ddx, y: videoOffsetStart.y + ddy };
        return;
      }

      switch (h) {
        case 'br': case 'bl':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h + dy * 2 : sb.h + dy);
          if (shiftKey) ny = sb.y - dy;
          break;
        case 'tr': case 'tl': case 'tc':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h - dy * 2 : sb.h - dy);
          ny = shiftKey ? sb.y + dy : sb.y + sb.h - nh;
          break;
        case 'bc':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h + dy * 2 : sb.h + dy);
          if (shiftKey) ny = sb.y - dy;
          break;
      }

      const b = { x: nx, y: ny, w: nw, h: nh };
      boxRef.current = b;
      setBox({ ...b });
    }

    function onMove(e: MouseEvent) {
      if (!drag.current) return;
      isDraggingRef.current = true;
      // Convert the screen-px delta to canvas px using the scale captured at drag start (the canvas's real
      // on-screen size ÷ CANVAS_W). A fixed DISPLAY_SCALE was wrong: the grid CSS-zooms the canvas wrapper
      // (zoom: fitFactor * viewScale), so the canvas is actually DISPLAY_SCALE × that on screen.
      const s = drag.current.scale;
      applyDrag(
        (e.clientX - drag.current.sx) / s,
        (e.clientY - drag.current.sy) / s,
        e.shiftKey,
      );
    }
    function onUp() {
      const wasDragging = isDraggingRef.current;
      drag.current = null;
      isDraggingRef.current = false;
      if (wasDragging) onChangeRef.current?.();   // commit framing (incl. video pan inside the crop)
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    // Measure the canvas's ACTUAL on-screen width to get the true screen→canvas ratio. getBoundingClientRect
    // already reflects whatever scaling is applied (the grid's CSS `zoom`, device pixel ratio, etc.), so the
    // drag stays 1:1 with the cursor at any preview zoom. Fall back to DISPLAY_SCALE if the rect isn't ready.
    const rect = canvasRef.current?.getBoundingClientRect();
    const scale = rect && rect.width > 0 ? rect.width / CANVAS_W : DISPLAY_SCALE;
    drag.current = {
      handle,
      sx: e.clientX,
      sy: e.clientY,
      sb: { ...boxRef.current },
      videoOffsetStart: { ...videoOffsetRef.current },
      scale,
      axisLock: null,
    };
  }

  return { startDrag, isDraggingRef };
}
