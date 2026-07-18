import 'server-only';   // hard guard: this module drags in supabase-js + the secret key — never bundle it client-side
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
  // Feature-less path = the mark-used hook, fired when a REEL IS BUILT — so it stamps built_at (server-
  // authoritative "a reel exists for this post"; recovery excludes these). It flips ONLY status + built_at
  // of an existing row (never decided_at/subreddit/title/features — the decide-time training data)…
  const builtMark = { status, built_at: base.decided_at };   // decided_at holds the ISO now
  const upd = await ledger().from('reddit_seen').update(builtMark).eq('post_id', post.id).select('post_id');
  if (upd.error) throw new Error(`ledger write failed: ${upd.error.message}`);
  if (upd.data?.length) return;
  // …or insert a fresh base row (built_at set — this is a build). On a 23505 PK race (a concurrent write
  // landed the row first), RETRY the mark once so our status/built_at is applied — a bare swallow could
  // leave a built reel labeled 'rejected' if the racer was a decide(rejected). A 0-row retry means a
  // concurrent undecide deleted the row — that flow's prerogative; do not re-insert.
  const ins = await ledger().from('reddit_seen').insert({ ...base, built_at: base.decided_at });
  if (ins.error) {
    if (ins.error.code !== '23505') throw new Error(`ledger write failed: ${ins.error.message}`);
    const retry = await ledger().from('reddit_seen').update(builtMark).eq('post_id', post.id).select('post_id');
    if (retry.error) throw new Error(`ledger write failed: ${retry.error.message}`);
  }
}

/** Recent 'used' but NOT-YET-BUILT rows with their decide-time features — the recovery source for a lost
    approved buffer. `built_at IS NULL` is the server-authoritative guarantee that a restore can never
    resurrect a completed post (whose reel exists) into a duplicate build — something the per-browser
    workspace filter alone couldn't promise (localStorage is exactly what was lost). */
export interface UsedRow {
  post_id: string; subreddit: string; title: string; decided_at: string;
  body: string | null; score: number | null; num_comments: number | null; created_utc: number | null;
}
export async function listUsed(limit = 50): Promise<UsedRow[]> {
  const { data, error } = await ledger()
    .from('reddit_seen')
    .select('post_id, subreddit, title, decided_at, body, score, num_comments, created_utc')
    .eq('status', 'used')
    .is('built_at', null)
    .order('decided_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return (data ?? []) as UsedRow[];
}

/** Remove a decision — the §4.6 session-level UNDO for a misclicked Use/Reject. The post becomes
    suggestible again (that is the point of undo); permanence applies to decisions the user keeps. */
export async function deleteDecision(postId: string): Promise<void> {
  const { error } = await ledger().from('reddit_seen').delete().eq('post_id', postId);
  if (error) throw new Error(`ledger delete failed: ${error.message}`);
}

// postIdFromUrl / subredditFromUrl moved to '@/lib/redditScout/handoff' — they're PURE url helpers the
// CLIENT also needs (filtering already-built posts), and this module drags supabase-js into any bundle
// that imports it.
