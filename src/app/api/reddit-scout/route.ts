import { NextRequest, NextResponse } from 'next/server';
import { deleteDecision, getSeenIds, markDecision, listUsed } from '@/lib/redditScout/ledger';
import { postIdFromUrl, subredditFromUrl } from '@/lib/redditScout/handoff';
import { runScan } from '@/lib/redditScout/scan';
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

// Serialized scan QUEUE: App Router handlers run concurrently in one Node process, so two scans would
// interleave through the shared browser chain, defeating the §4.1 politeness gap. A chained tail runs
// scans strictly one-at-a-time — and, unlike a single-flight promise, each caller awaits its OWN run, so
// two scans with DIFFERENT subreddit selections can't cross results (a joiner getting the other's subs).
let scanQueue: Promise<unknown> = Promise.resolve();

export async function POST(request: NextRequest) {
  // `?? {}`: a literal `null` JSON body parses successfully (json() doesn't reject), so the catch alone
  // wouldn't stop `body.action` from throwing on null → a wrong 500 instead of a 400.
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const action = body.action;
  try {
    if (action === 'scan') {
      // Optional subreddit subset from the client — filter CONFIG to the requested names (case-insensitive)
      // so only configured subs can ever be fetched (no arbitrary sub / SSRF). Absent → all (default).
      const requested = Array.isArray(body.subs)
        ? new Set(body.subs.filter((s): s is string => typeof s === 'string').map(s => s.toLowerCase()))
        : null;
      const subs = requested ? SCOUT_SUBREDDITS.filter(s => requested.has(s.name.toLowerCase())) : undefined;
      // Chain onto the queue tail (both branches re-invoke so a prior scan's rejection can't poison it);
      // await THIS run's own result. The panel's disabled-while-scanning guard makes same-tab dupes moot.
      const run = scanQueue.then(() => runScan(browserSource, { getSeenIds, subs }), () => runScan(browserSource, { getSeenIds, subs }));
      scanQueue = run.catch(() => {});
      return NextResponse.json(await run);
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
