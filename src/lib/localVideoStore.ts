// IndexedDB store for uploaded reel videos, so an uploaded file survives a page reload without any
// backend. Keyed by the reel entry id; each record holds the raw Blob plus the original filename.
// (Pasted-link reels are NOT stored here — they re-fetch from their link on load, like the original.)

const DB_NAME = 'reels-local';
const STORE = 'videos';
const IMAGE_STORE = 'images';   // image-overlay blobs, keyed by overlay id

interface StoredVideo { blob: Blob; name: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains(IMAGE_STORE)) req.result.createObjectStore(IMAGE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = run(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Persist an uploaded video blob for a reel. Best-effort — a failure just means no reload survival. */
export async function saveLocalVideo(id: string, blob: Blob, name: string): Promise<void> {
  try { await withStore('readwrite', s => s.put({ blob, name } satisfies StoredVideo, id)); } catch { /* best-effort */ }
}

/** The stored upload for a reel, if any. */
export async function getLocalVideo(id: string): Promise<StoredVideo | null> {
  try {
    const hit = await withStore<StoredVideo | undefined>('readonly', s => s.get(id) as IDBRequest<StoredVideo | undefined>);
    return hit && hit.blob instanceof Blob ? hit : null;
  } catch {
    return null;
  }
}

/** Drop a reel's stored upload (reel deleted, or its video removed/replaced by a link). */
export async function deleteLocalVideo(id: string): Promise<void> {
  try { await withStore('readwrite', s => s.delete(id)); } catch { /* best-effort */ }
}

/** Drop every stored upload except the given live reel ids ("delete all" / GC). */
export async function pruneLocalVideos(liveIds: string[]): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', s => s.getAllKeys());
    const live = new Set(liveIds);
    await Promise.all(keys.filter(k => typeof k === 'string' && !live.has(k)).map(k => deleteLocalVideo(k as string)));
  } catch { /* best-effort */ }
}

// ── Image-overlay blobs ───────────────────────────────────────────────────────
// Same durability contract as uploaded videos: the overlay's placement/timing lives in the saved
// framing JSON; the pixels live here, keyed by the overlay id, and are re-hydrated on load.

/** Persist an overlay image's blob. Best-effort. */
export async function saveOverlayImage(id: string, blob: Blob, name: string): Promise<void> {
  try { await withStore('readwrite', s => s.put({ blob, name } satisfies { blob: Blob; name: string }, id), IMAGE_STORE); } catch { /* best-effort */ }
}

/** The stored image for an overlay id, if any. */
export async function getOverlayImage(id: string): Promise<{ blob: Blob; name: string } | null> {
  try {
    const hit = await withStore<{ blob: Blob; name: string } | undefined>('readonly', s => s.get(id) as IDBRequest<{ blob: Blob; name: string } | undefined>, IMAGE_STORE);
    return hit && hit.blob instanceof Blob ? hit : null;
  } catch {
    return null;
  }
}

/** Drop an overlay's stored image (overlay deleted). */
export async function deleteOverlayImage(id: string): Promise<void> {
  try { await withStore('readwrite', s => s.delete(id), IMAGE_STORE); } catch { /* best-effort */ }
}

/** Drop every stored overlay image ("delete all reels"). */
export async function clearOverlayImages(): Promise<void> {
  try { await withStore('readwrite', s => s.clear(), IMAGE_STORE); } catch { /* best-effort */ }
}
