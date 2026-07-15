import { proxyStreamUrl } from './utils';
import type { VideoData } from '@/app/types';

// Shared background-footage library: a public R2 bucket holding pre-cut gameplay segments
// (uploaded via scripts/footage-upload.sh, which also regenerates manifest.json). Everything is
// H.264 by construction — the upload script's source folder is codec-checked — so segments are
// always exportable. Served through /api/proxy (r2.dev sends no CORS headers).
export const FOOTAGE_PUBLIC_BASE = 'https://pub-63dabe78ed9342c5a94e50b584141711.r2.dev';
const MANIFEST_URL = `${FOOTAGE_PUBLIC_BASE}/manifest.json`;

export interface FootageSegment {
  name: string;    // "video1.3.mp4"
  group: string;   // "video1"
  size: number;    // bytes
  url: string;     // public R2 URL
}

export function isFootageUrl(url: string): boolean {
  return url.startsWith(`${FOOTAGE_PUBLIC_BASE}/`);
}

/** VideoData for a footage segment — the shape a fetched link produces, with no resolver call. */
export function footageVideoData(url: string): VideoData {
  const name = decodeURIComponent(url.split('/').pop() ?? 'footage');
  return {
    id: name,
    title: name.replace(/\.mp4$/, ''),
    cover: '',
    author: { uniqueId: 'footage', nickname: 'Footage library', avatarThumb: '' },
    play: url,
    wmplay: '',
    hdplay: url,
    duration: 0,
    size: 0,
  };
}

let manifestCache: FootageSegment[] | null = null;
let manifestPromise: Promise<FootageSegment[]> | null = null;

/** Fetch the footage manifest through the proxy. Cached for the session; concurrent calls coalesce. */
export function fetchFootageManifest(): Promise<FootageSegment[]> {
  if (manifestCache) return Promise.resolve(manifestCache);
  manifestPromise ??= (async () => {
    const res = await fetch(proxyStreamUrl(MANIFEST_URL), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`);
    const json = await res.json() as { segments?: FootageSegment[] };
    manifestCache = (json.segments ?? []).filter(s => !!s?.url && !!s?.name);
    return manifestCache;
  })().catch(e => { manifestPromise = null; throw e; });
  return manifestPromise;
}
