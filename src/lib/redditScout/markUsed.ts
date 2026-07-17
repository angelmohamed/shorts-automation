// Client-safe (no server imports) — the shared-ledger hook fired from the reel-build path so a post
// built into a reel (manually via the bulk builder, OR later via the Scout) is recorded 'used' and never
// re-suggested. BEST-EFFORT: never throws and never blocks the build — a ledger blip or an unconfigured
// Supabase must not stop reels from being created.

/** Mark a Reddit post (by its thread url) as 'used' in the no-repeat ledger. Fire-and-forget. */
export async function markRedditUsed(url: string, title: string): Promise<void> {
  try {
    const res = await fetch('/api/reddit-scout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark-used', url, title }),
    });
    if (!res.ok) console.warn('[scout] mark-used failed', res.status);   // logged, not thrown
  } catch (e) {
    console.warn('[scout] mark-used error', e);
  }
}
