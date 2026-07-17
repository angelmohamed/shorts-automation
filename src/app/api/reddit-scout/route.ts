import { NextRequest, NextResponse } from 'next/server';
import { deleteDecision, getSeenIds, markDecision, postIdFromUrl, subredditFromUrl } from '@/lib/redditScout/ledger';
import { runScan, type ScanResult } from '@/lib/redditScout/scan';
import { browserSource } from '@/lib/redditScout/source';
import { topComments } from '@/lib/redditScout/parse';
import { SCOUT_COMMENTS_PER_POST } from '@/lib/redditScout/config';

// Reddit Scout API (server-side — the Supabase secret key and the browser transport never reach the client).
//   POST { action:'scan' }                                — fetch + filter + rank a session of candidates
//   POST { action:'comments', id, n? }                    — top usable comments for one post (preview / package)
//   POST { action:'decide', id, status, subreddit?, title? } — a Use/Reject from the Scout panel
//   POST { action:'mark-used', url, title }               — shared-ledger hook from the reel-build path

export const runtime = 'nodejs';
// A scan is ~13 sequential listing fetches with a 1s politeness gap (~15-25s). No effect on a local/
// self-hosted Node server (no route timeout there); declared for any platform that enforces limits.
export const maxDuration = 120;

// Single-flight for 'scan': App Router handlers run concurrently in one Node process, so a double-clicked
// "Scout now" (or an impatient retry) would interleave two full scans through the serialized browser chain,
// defeating the §4.1 politeness gap. Concurrent callers join the SAME in-flight scan and share its result.
let scanInFlight: Promise<ScanResult> | null = null;

export async function POST(request: NextRequest) {
  // `?? {}`: a literal `null` JSON body parses successfully (json() doesn't reject), so the catch alone
  // wouldn't stop `body.action` from throwing on null → a wrong 500 instead of a 400.
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const action = body.action;
  try {
    if (action === 'scan') {
      scanInFlight ??= runScan(browserSource, { getSeenIds }).finally(() => { scanInFlight = null; });
      return NextResponse.json(await scanInFlight);
    }
    if (action === 'comments') {
      const id = String(body.id ?? '');
      if (!/^[a-z0-9]+$/i.test(id)) return NextResponse.json({ error: 'valid post id required' }, { status: 400 });
      // n: absent/null → the configured default; otherwise clamp to [1, 20] (floor floats, junk → default).
      const nRaw = body.n == null ? NaN : Number(body.n);
      const n = Number.isFinite(nRaw) ? Math.min(20, Math.max(1, Math.floor(nRaw))) : SCOUT_COMMENTS_PER_POST;
      const raw = await browserSource.fetchCommentsRaw(id.toLowerCase(), 50);   // depth=1 → all 50 are top-level
      return NextResponse.json({ comments: topComments(raw, n) });
    }
    if (action === 'mark-used') {
      const url = String(body.url ?? '');
      const id = postIdFromUrl(url);
      if (!id) return NextResponse.json({ error: 'unrecognised reddit url' }, { status: 400 });
      await markDecision({ id, subreddit: subredditFromUrl(url) ?? 'unknown', title: String(body.title ?? '') }, 'used');
      return NextResponse.json({ ok: true, id });
    }
    if (action === 'decide') {
      // Validate + lowercase like every other ledger-key path (postIdFromUrl, parseListing) — a raw
      // mixed-case id from a client would create a divergent ledger row the filter never matches.
      const id = String(body.id ?? '').toLowerCase();
      const status = body.status;
      if (!/^[a-z0-9]+$/.test(id) || (status !== 'used' && status !== 'rejected')) {
        return NextResponse.json({ error: 'valid id and status(used|rejected) required' }, { status: 400 });
      }
      await markDecision({ id, subreddit: String(body.subreddit ?? 'unknown'), title: String(body.title ?? '') }, status);
      return NextResponse.json({ ok: true });
    }
    if (action === 'undecide') {
      // §4.6 undo of the LAST decision — deletes the ledger row so the post is suggestible again.
      const id = String(body.id ?? '').toLowerCase();
      if (!/^[a-z0-9]+$/.test(id)) return NextResponse.json({ error: 'valid id required' }, { status: 400 });
      await deleteDecision(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'scout error' }, { status: 500 });
  }
}
