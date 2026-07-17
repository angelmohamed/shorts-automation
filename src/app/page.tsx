'use client';

import { useEffect, useState } from 'react';
import { useVideoEntries } from './hooks/useVideoEntries';
import { CanvasGrid } from './components/CanvasGrid';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GRID_BG_STYLE } from '@/lib/ui-constants';
import type { BrandProps } from './types';

// Standalone client-side reels studio: paste a link or upload a video, crop/trim on the timeline,
// and export MP4s. Everything persists in the browser (localStorage + IndexedDB) — no backend.

// A single local "user": the persistence hooks only need a non-null id to switch on.
const LOCAL_USER = 'local';

const EMPTY_BRAND: BrandProps = {
  logoSrc: '',
  logos: [],
  fonts: [],
  displayName: '',
  handle: '',
  colors: [],
};

export default function Home() {
  const {
    entries, setEntries, canvasRefsMap,
    addRow, addReels, removeRow, duplicateRow, deleteAllReels, updateEntry, updateLocalVideo, handleVideoError,
    fetchVideo,
  } = useVideoEntries();

  const [restored, setRestored] = useState(false);

  // No sidebar in this app — the element rail docks at the viewport's left edge.
  useEffect(() => {
    document.documentElement.style.setProperty('--rail-w', '0px');
  }, []);

  return (
    <div className="flex flex-col h-screen" style={GRID_BG_STYLE}>
      <div className="flex-1 min-h-0">
        <ErrorBoundary>
          <CanvasGrid
            entries={entries}
            setEntries={setEntries}
            canvasRefsMap={canvasRefsMap}
            brand={EMPTY_BRAND}
            onAddRow={addRow}
            onAddReels={addReels}
            onRemoveRow={removeRow}
            onDuplicateRow={duplicateRow}
            onDeleteAllReels={deleteAllReels}
            onHandleVideoError={handleVideoError}
            onUpdateEntry={updateEntry}
            onUpdateLocalVideo={updateLocalVideo}
            onFetchVideo={fetchVideo}
            userId={LOCAL_USER}
            videoMode={entries[0]?.mode === 'caption' ? 'caption' : 'twitter'}
            onRestored={() => setRestored(true)}
            restored={restored}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
