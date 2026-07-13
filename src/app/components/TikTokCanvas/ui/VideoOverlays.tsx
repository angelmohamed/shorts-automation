import { CANVAS_W, CANVAS_H, DISPLAY_SCALE } from '../constants';

interface VideoOverlaysProps {
  isVideoLoading: boolean;
  videoError: string | null;
}

export function VideoOverlays({ isVideoLoading, videoError }: VideoOverlaysProps) {
  const style = { width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE };

  if (videoError) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-2xl"
        style={style}
      >
        <div className="text-center px-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 mx-auto mb-2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="text-red-400 text-sm font-medium">{videoError}</p>
          <p className="text-zinc-500 text-xs mt-1">Try fetching the video again</p>
        </div>
      </div>
    );
  }

  if (isVideoLoading) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl"
        style={style}
      >
        <div className="text-center px-4">
          <svg className="animate-spin mx-auto mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/>
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="opacity-75"/>
          </svg>
          <p className="text-zinc-300 text-sm font-medium">Loading video...</p>
          <p className="text-zinc-500 text-xs mt-1">Large videos may take a minute</p>
        </div>
      </div>
    );
  }

  return null;
}
