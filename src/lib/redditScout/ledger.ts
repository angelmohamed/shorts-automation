import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DecisionFeatures } from './features';

// Server-only Supabase client for the Scout's no-repeat ledger (table: reddit_seen — see
// docs/reddit-scout/schema.sql). Used exclusively from API routes; the SECRET key must never
// reach the browser. Env (in .env.local):
//   SCOUT_SUPABASE_URL=https://<project-ref>.supabase.co
//   SCOUT_SUPABASE_SECRET_KEY=sb_secret_…   (new-format key; the legacy service_role JWT also works)

export type SeenStatus = 'used' | 'rejected';

export interface SeenPost {
  id: string;          // Reddit base36 id, no "t3_" prefix
  subreddit: string;
  title: string;
}

let client: SupabaseClient | null = null;

/** Lazily create (and reuse) the server-side client. Throws a clear error when env is missing so a
    misconfigured run fails loudly instead of silently scouting with no memory. */
function ledger(): SupabaseClient {
  if (client) return client;
  const url = process.env.SCOUT_SUPABASE_URL;
  const key = process.env.SCOUT_SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      'Reddit Scout ledger is not configured — set SCOUT_SUPABASE_URL and SCOUT_SUPABASE_SECRET_KEY in .env.local ' +
      '(create the table with docs/reddit-scout/schema.sql first).',
    );
  }
  // Server usage: no session persistence / auto-refresh (there is no user session — just the secret key).
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Every post id ever decided (used OR rejected) — the candidate filter removes all of these. */
export async function getSeenIds(): Promise<Set<string>> {
  const { data, error } = await ledger().from('reddit_seen').select('post_id');
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return new Set((data ?? []).map(r => r.post_id as string));
}

/** Record a decision permanently, optionally with the candidate FEATURES (training data for the future
    learned ranker). Write strategy:
    - WITH features (a Scout decide): one upsert providing every column — a decide is the canonical,
      full snapshot and may refresh the whole row.
    - WITHOUT features (the mark-used hook from a reel build): update ONLY the status of an existing
      row — decide-time decided_at / subreddit / title / features are the training data and must
      survive the re-mark untouched (the build time is NOT the decision time) — else insert the base
      row for a genuinely-new post (manual build of a never-scouted url).
    (Note: a single-object PostgREST upsert would also preserve omitted columns — ON CONFLICT DO UPDATE
    SET covers only the payload's columns; the notorious wiped-column reports are specific to BULK array
    upserts. update-then-insert is kept regardless: it makes "touch only the status" explicit rather
    than dependent on that nuance.) */
export async function markDecision(post: SeenPost, status: SeenStatus, features?: DecisionFeatures): Promise<void> {
  const base = { post_id: post.id, status, subreddit: post.subreddit, title: post.title, decided_at: new Date().toISOString() };
  if (features) {
    const { error } = await ledger()
      .from('reddit_seen')
      .upsert({
        ...base,
        body: features.body ?? null,
        score: features.score ?? null,
        num_comments: features.numComments ?? null,
        created_utc: features.createdUtc ?? null,
        category: features.category ?? null,
      }, { onConflict: 'post_id' });
    if (error) throw new Error(`ledger write failed: ${error.message}`);
    return;
  }
  // Feature-less path: flip ONLY the status of an existing row (never decided_at/subreddit/title —
  // see the docblock)…
  const upd = await ledger().from('reddit_seen').update({ status }).eq('post_id', post.id).select('post_id');
  if (upd.error) throw new Error(`ledger write failed: ${upd.error.message}`);
  if (upd.data?.length) return;
  // …or insert a fresh base row. On a 23505 PK race (a concurrent write landed the row first), RETRY
  // the status update once so our status is deterministically applied — a bare swallow could leave a
  // built reel labeled 'rejected' if the racer was a decide(rejected). A 0-row retry means a concurrent
  // undecide deleted the row — that flow's prerogative; do not re-insert.
  const ins = await ledger().from('reddit_seen').insert(base);
  if (ins.error) {
    if (ins.error.code !== '23505') throw new Error(`ledger write failed: ${ins.error.message}`);
    const retry = await ledger().from('reddit_seen').update({ status }).eq('post_id', post.id).select('post_id');
    if (retry.error) throw new Error(`ledger write failed: ${retry.error.message}`);
  }
}

/** Remove a decision — the §4.6 session-level UNDO for a misclicked Use/Reject. The post becomes
    suggestible again (that is the point of undo); permanence applies to decisions the user keeps. */
export async function deleteDecision(postId: string): Promise<void> {
  const { error } = await ledger().from('reddit_seen').delete().eq('post_id', postId);
  if (error) throw new Error(`ledger delete failed: ${error.message}`);
}

/** Extract the Reddit base36 post id from any thread-url shape the app handles:
    …/comments/<id>/…, redd.it/<id>, /gallery/<id>, or a bare "t3_<id>". Returns null if unrecognisable. */
export function postIdFromUrl(url: string): string | null {
  const m =
    /\/comments\/([a-z0-9]+)/i.exec(url) ??
    /redd\.it\/([a-z0-9]+)/i.exec(url) ??
    /\/gallery\/([a-z0-9]+)/i.exec(url) ??
    /^t3_([a-z0-9]+)$/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** The subreddit name from a reddit thread url (`…/r/<name>/…`), or null. Case is preserved (Reddit
    sub names are case-insensitive but conventionally cased); used only for the ledger row's readability. */
export function subredditFromUrl(url: string): string | null {
  const m = /\/r\/([A-Za-z0-9_]+)/.exec(url);
  return m ? m[1] : null;
}
