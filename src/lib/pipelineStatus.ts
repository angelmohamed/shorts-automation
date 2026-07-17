import type { VideoEntry } from '@/app/types';
import type { Framing } from '@/app/components/TikTokCanvas/types';
import type { StageInfo } from '@/app/components/PipelineView';
import { resolveMusicId, trackById, DEFAULT_MUSIC_ID } from '@/lib/music';

// Pure status/derivation for the bulk Pipeline view — extracted from CanvasGrid so the (bug-prone) count
// logic is unit-testable. A reel is a "Reddit reel" iff it carries a card overlay named exactly "Reddit thread".

type FramingMap = Record<string, Framing>;
const isRedditReel = (id: string, fm: FramingMap) => (fm[id]?.overlays ?? []).some(o => o.name === 'Reddit thread');

export interface PipelineRunState {
  batchOp: null | 'narration' | 'copy';
  batchProgress: { done: number; total: number };
  isDownloadingAll: boolean;
  downloadProgress: { done: number; total: number };
}

/** Per-stage {done,total,running,progress} over the workspace's Reddit reels. total = # of Reddit reels. */
export function computePipelineStages(entries: VideoEntry[], framingMap: FramingMap, run: PipelineRunState): StageInfo[] {
  const reddit = entries.filter(e => isRedditReel(e.id, framingMap));
  const total = reddit.length;
  const withFootage = reddit.filter(e => e.localVideoSrc || e.videoUrl || e.data).length;
  // "Done" = the reel will have AUDIBLE music. resolveMusicId(undefined) → default track → done; '' ("No
  // music") → null → not done; a valid id → done; a STALE/removed id resolves non-null but trackById() is
  // null (nothing plays), so validate against the library — else a stale reel would falsely read done.
  const withMusic = reddit.filter(e => trackById(resolveMusicId(framingMap[e.id]?.musicId)) !== null).length;
  const narrated = reddit.filter(e => ((framingMap[e.id]?.overlays ?? []).find(o => o.name === 'Reddit thread')?.audioDuration ?? 0) > 0).length;
  const copied = reddit.filter(e => framingMap[e.id]?.ytTitle && framingMap[e.id]?.description).length;
  const narrRunning = run.batchOp === 'narration', copyRunning = run.batchOp === 'copy';
  return [
    { key: 'import',  done: total,       total, running: false },
    { key: 'pick',    done: total,       total, running: false },
    { key: 'footage', done: withFootage, total, running: false },
    { key: 'music',   done: withMusic,   total, running: false },
    { key: 'narrate', done: narrated,    total, running: narrRunning, progress: narrRunning ? run.batchProgress : null },
    { key: 'copy',    done: copied,      total, running: copyRunning, progress: copyRunning ? run.batchProgress : null },
    // Export completion isn't persisted, so show live progress while running and idle (0/N) otherwise —
    // never a false "Done".
    { key: 'export',  done: run.isDownloadingAll ? run.downloadProgress.done : 0, total, running: run.isDownloadingAll, progress: run.isDownloadingAll ? run.downloadProgress : null },
  ];
}

/** The music track shared by ALL Reddit reels (for the drawer radio): the common raw musicId, defaulting only
 *  the UNSET (undefined) case to the default track so a fresh reel highlights it — while '' (explicit No music)
 *  stays '' and a genuinely mixed selection returns null (nothing highlighted). */
export function computePipelineMusicId(entries: VideoEntry[], framingMap: FramingMap): string | null {
  const reddit = entries.filter(e => isRedditReel(e.id, framingMap));
  if (!reddit.length) return null;
  const first = framingMap[reddit[0].id]?.musicId ?? DEFAULT_MUSIC_ID;
  return reddit.every(e => (framingMap[e.id]?.musicId ?? DEFAULT_MUSIC_ID) === first) ? first : null;
}
