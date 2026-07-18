import { NextRequest, NextResponse } from 'next/server';
import { deleteDecision, getSeenIds, markDecision, listUsed } from '@/lib/redditScout/ledger';
import { postIdFromUrl, subredditFromUrl } from '@/lib/redditScout/handoff';
import { runScan, type ScanResult } from '@/lib/redditScout/scan';
import { browserSource } from '@/lib/redditScout/source';
import { SCOUT_SUBREDDITS } from '@/lib/redditScout/config';
import { sanitizeDecisionFeatures, cleanText, MAX_TITLE_CHARS } from '@/lib/redditScout/features';

// Reddit Scout API (server-side — the Supabase secret key and the browser transport never reach the client).
//   POST { action:'scan' }                                — fetch + filter + rank a session of candidates
//   POST { action:'decide', id, status, subreddit?, title? } — a Use/Reject from the Scout panel
//   POST { action:'mark-used', url, title }               — shared-ledger hook from the reel-build path
//   POST { action:'undecide', id }                        — §4.6 undo of the last decision
//   POST { action:'list-used' }                           — recent used rows (lost-buffer recovery)
// (The former 'comments' action was removed with the direct-build path — comment capture now happens at
// the Import handoff via /api/reddit, which fetches the full tree.)

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
    if (action === 'mark-used') {
      const url = String(body.url ?? '');
      const id = postIdFromUrl(url);
      if (!id) return NextResponse.json({ error: 'unrecognised reddit url' }, { status: 400 });
      await markDecision({ id, subreddit: subredditFromUrl(url) ?? 'unknown', title: cleanText(body.title, MAX_TITLE_CHARS) }, 'used');
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
      // Candidate features ride along as TRAINING DATA for the future learned ranker. Category is
      // derived server-side from config (never trusted from the client); every string is scrubbed
      // (length cap + well-formed UTF-16 + NUL-free — a poisoned title/body would 500 the Postgres
      // write and leave the post permanently undecidable).
      const subreddit = cleanText(body.subreddit, 50) || 'unknown';
      const category = SCOUT_SUBREDDITS.find(s => s.name.toLowerCase() === subreddit.toLowerCase())?.category;
      const features = sanitizeDecisionFeatures(body, category);
      await markDecision({ id, subreddit, title: cleanText(body.title, MAX_TITLE_CHARS) }, status, features);
      return NextResponse.json({ ok: true });
    }
    if (action === 'list-used') {
      // Recovery: recent used-but-unbuilt rows so a lost approved buffer can be reconstructed. `|| 50`
      // guards a bare Number() → NaN reaching listUsed's clamp; listUsed bounds it to [1, 200].
      const limit = Number(body.limit) || 50;
      return NextResponse.json({ used: await listUsed(limit) });
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
