import type { ScoutCandidate, ScoutRedditComment, ScoutRedditPost } from './types';

// Pure parsers: turn Reddit's raw .json responses into Scout shapes. No I/O — fully unit-testable.
// Grounded in Reddit's verified response shape: a listing is { kind:'Listing', data:{ children:[{ kind:'t3',
// data:{…} }] } }; a comments response is a TWO-element array [ postListing, commentListing ] where each
// comment child is { kind:'t1', data:{ …, depth, replies } } and `replies` is "" | a listing | a kind:'more'.

// Author names of bots whose comments are never "content". Lowercase; extend freely.
const COMMENT_BOTS = new Set(['automoderator', 'reddit', 'sub_mentions', 'timestamp_bot']);

interface RawChild { kind?: string; data?: Record<string, unknown> }
interface RawListing { data?: { children?: RawChild[] } }

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const bool = (v: unknown): boolean => v === true;

/** Map a subreddit `top` listing to candidates. Skips non-post (t3) children and anything malformed. */
export function parseListing(json: unknown): ScoutCandidate[] {
  const children = (json as RawListing | undefined)?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: ScoutCandidate[] = [];
  for (const c of children) {
    if (c?.kind !== 't3' || !c.data) continue;
    const d = c.data;
    // Lowercased to match postIdFromUrl's normalization — Reddit id36 is lowercase (0-9a-z) by spec, but
    // both ledger key paths normalizing the same way makes the no-repeat match unconditional.
    const id = str(d.id).toLowerCase();
    if (!id) continue;
    const permalink = str(d.permalink);
    out.push({
      id,
      subreddit: str(d.subreddit),
      title: str(d.title),
      body: str(d.selftext),
      score: num(d.score),
      numComments: num(d.num_comments),
      createdUtc: num(d.created_utc),
      over18: bool(d.over_18),
      stickied: bool(d.stickied) || bool(d.pinned),
      isImage: isImagePost(d),
      permalink: permalink ? `https://www.reddit.com${permalink}` : `https://redd.it/${id}`,
      author: str(d.author),
    });
  }
  return out;
}

/** An image/gallery post (excluded in v1). Detect via gallery flag, post_hint, or a direct image url. */
export function isImagePost(d: Record<string, unknown>): boolean {
  if (bool(d.is_gallery)) return true;
  if (str(d.post_hint) === 'image') return true;
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(str(d.url));
}

/** Top N usable TOP-LEVEL comments by score, from a comments response (the 2nd listing). Excludes
    deleted/removed, empty, stickied (mod-pinned), and bot (AutoModerator etc.) comments FIRST, then sorts. */
export function topComments(commentsJson: unknown, n: number): ScoutRedditComment[] {
  const listing = Array.isArray(commentsJson) ? (commentsJson[1] as RawListing | undefined) : undefined;
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  const usable = children
    .filter(c => c?.kind === 't1' && c.data)                  // real comments only (drop the kind:'more' tail)
    .map(c => c.data as Record<string, unknown>)
    .filter(d => (d.depth === undefined || num(d.depth) === 0) && !isBadComment(d));
  usable.sort((a, b) => num(b.score) - num(a.score));
  return usable.slice(0, Math.max(0, n)).map(d => ({
    user: { name: 'u/' + str(d.author) },
    body: str(d.body),
    score: String(num(d.score)),
    depth: 0,
    isOP: bool(d.is_submitter),
  }));
}

/** Deleted/removed/empty, stickied, or bot comment — never surfaced as content. */
export function isBadComment(d: Record<string, unknown>): boolean {
  if (bool(d.stickied)) return true;
  const author = str(d.author).toLowerCase();
  const body = str(d.body).trim();
  if (author === '' || author === '[deleted]') return true;
  if (body === '' || body === '[deleted]' || body === '[removed]') return true;
  if (COMMENT_BOTS.has(author)) return true;
  return false;
}

/** Candidate → the ImportedRedditPost shape buildReelsFromThreads consumes. */
export function toImportedPost(c: ScoutCandidate): ScoutRedditPost {
  return {
    user: { name: 'u/' + c.author },
    title: c.title,
    body: c.body || undefined,
    score: String(c.score),
    commentCount: String(c.numComments),
  };
}
