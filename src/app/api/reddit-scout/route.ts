import { NextRequest, NextResponse } from 'next/server';
import { markDecision, postIdFromUrl, subredditFromUrl } from '@/lib/redditScout/ledger';

// Reddit Scout ledger writes (server-side — the Supabase secret key never reaches the browser).
// Phase 3 handles the two write actions; Phase 5 will add `{action:'scan'}` for candidate discovery.
//   POST { action:'mark-used', url, title }          — shared-ledger hook from the reel-build path
//   POST { action:'decide', id, status, subreddit?, title? } — a Use/Reject from the Scout panel

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  try {
    if (action === 'mark-used') {
      const url = String(body.url ?? '');
      const id = postIdFromUrl(url);
      if (!id) return NextResponse.json({ error: 'unrecognised reddit url' }, { status: 400 });
      await markDecision({ id, subreddit: subredditFromUrl(url) ?? 'unknown', title: String(body.title ?? '') }, 'used');
      return NextResponse.json({ ok: true, id });
    }
    if (action === 'decide') {
      const id = String(body.id ?? '');
      const status = body.status;
      if (!id || (status !== 'used' && status !== 'rejected')) {
        return NextResponse.json({ error: 'id and status(used|rejected) required' }, { status: 400 });
      }
      await markDecision({ id, subreddit: String(body.subreddit ?? 'unknown'), title: String(body.title ?? '') }, status);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'ledger error' }, { status: 500 });
  }
}
