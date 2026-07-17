import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSafePublicUrl } from '@/lib/http';
import { redditBrowserJson } from '@/lib/redditBrowser';

// Resolve a Reddit thread URL into normalized card data for the Reddit template. Two transports:
// the official OAuth API when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are configured (a free
// "script" app from reddit.com/prefs/apps — preferred, ToS-clean), else a headless-Chrome session
// that passes Reddit's bot challenge and reads the public .json endpoints (Reddit hard-403s plain
// HTTP clients). Avatars are fetched server-side and inlined as data URIs so the canvas renderer
// never deals with cross-origin images.

export const runtime = 'nodejs';

const UA = 'web:reels-studio:v1.0 (footage importer)';
const MAX_COMMENTS = 50;      // returned to the client for selection (top-level + one reply each)
const MAX_AVATARS = 12;       // unique authors whose avatar images we inline

// skipAvatars: don't fetch per-author profile pictures. Avatar enrichment fires ~12 profile
// lookups + image downloads per thread, which throttles Reddit and jams the shared browser page
// under bulk import — bulk callers set this and cards fall back to colored initial discs.
// preferApify: use the Apify transport first (separate HTTP call — reliable and non-blocking) rather
// than the headless-browser transport, which is slow and stalls the server under bulk load.
const Schema = z.object({
  url: z.string().min(8).max(2000),
  skipAvatars: z.boolean().optional(),
  preferApify: z.boolean().optional(),
});

// ── token cache (module scope survives across requests in one server process) ───────────────────
let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new ConfigError();
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const json = await res.json() as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

class ConfigError extends Error {}

async function oauthGet(path: string): Promise<unknown> {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    headers: { Authorization: `Bearer ${await getToken()}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`reddit api ${res.status}`);
  return res.json();
}

/** Transport-agnostic GET: OAuth when configured, else the headless-browser session.
    `path` has no .json suffix (e.g. "/comments/abc123"); `query` is the raw query string. */
async function redditGet(path: string, query: string): Promise<unknown> {
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    return oauthGet(`${path}?${query}`);
  }
  return redditBrowserJson(`${path}.json?${query}`);
}

// ── Apify transport (primary when APIFY_TOKEN is set) ────────────────────────────────────────────
// Pay-per-result actor; returns a flat dataset of one post item + comment items in a single
// synchronous call. Reddit hides vote data from it, so scores are best-effort and often 0 —
// zero scores are mapped to '' so the template hides them instead of rendering "0".
const APIFY_ACTOR = process.env.APIFY_ACTOR ?? 'automation-lab~reddit-scraper';

interface ApifyItem {
  type: 'post' | 'comment';
  title?: string; author?: string; subreddit?: string; selfText?: string;
  body?: string; score?: number; numComments?: number; createdAt?: string;
  depth?: number; isSubmitter?: boolean;
}

const isoToEpoch = (iso?: string): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Date.now() / 1000 : t / 1000;
};

async function apifyImport(threadUrl: string) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [threadUrl], includeComments: true, maxCommentsPerPost: 60, commentDepth: 4 }),
      signal: AbortSignal.timeout(180_000),
    },
  );
  if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = await res.json() as ApifyItem[];
  const p = items.find(i => i.type === 'post');
  if (!p?.title) throw new Error('apify returned no post');

  const body = p.selfText && !/^submitted by \/u\//.test(p.selfText) ? plainText(p.selfText) : undefined;
  const comments: OutComment[] = items
    .filter(i => i.type === 'comment')
    .map(c => ({ ...c, cleanBody: plainText(c.body ?? '') }))
    .filter(c => c.author && c.author !== '[deleted]' && c.author !== 'AutoModerator'
      && c.cleanBody && c.cleanBody !== '[removed]' && c.cleanBody !== '[deleted]')
    .slice(0, MAX_COMMENTS)
    .map(c => ({
      user: { name: c.author! },
      body: c.cleanBody,
      timeAgo: timeAgo(isoToEpoch(c.createdAt)),
      score: c.score && c.score > 0 ? fmtScore(c.score) : '',
      depth: Math.max(0, c.depth ?? 0),
      isOP: !!c.isSubmitter,
    }));

  return {
    post: {
      user: { name: `u/${p.author ?? 'unknown'}` },
      subreddit: p.subreddit ? `r/${p.subreddit}` : undefined,
      timeAgo: timeAgo(isoToEpoch(p.createdAt)),
      title: plainText(p.title),
      body,
      score: p.score && p.score > 0 ? fmtScore(p.score) : '',
      commentCount: p.numComments && p.numComments > 0 ? fmtScore(p.numComments) : '',
    },
    comments,
  };
}

// ── URL → thread id ──────────────────────────────────────────────────────────────────────────────
async function resolveThreadId(raw: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^old\.|^new\.|^np\./, '');
  if (host === 'redd.it') return url.pathname.split('/').filter(Boolean)[0] ?? null;
  if (host !== 'reddit.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const ci = parts.indexOf('comments');
  if (ci >= 0 && parts[ci + 1]) return parts[ci + 1];
  // share links: /r/<sub>/s/<token> — follow the redirect (no auth needed for a 3xx Location)
  if (parts.length >= 3 && parts[2] === 's' && await isSafePublicUrl(raw)) {
    const res = await fetch(raw, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    const loc = res.headers.get('location');
    if (loc) return resolveThreadId(loc);
  }
  return null;
}

// ── formatting helpers ───────────────────────────────────────────────────────────────────────────
const fmtScore = (n: number): string =>
  n >= 100_000 ? `${Math.round(n / 1000)}K` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

function timeAgo(createdUtc: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - createdUtc));
  const units: [number, string][] = [[31_536_000, 'y'], [2_592_000, 'mo'], [86_400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [div, label] of units) if (s >= div) return `${Math.floor(s / div)}${label} ago`;
  return 'now';
}

/** Strip the markdown that would read wrong on canvas/narration; keep the words. */
function plainText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links → label
    .replace(/[*_~^]{1,3}([^*_~^]+)[*_~^]{1,3}/g, '$1')
    .replace(/^&gt;.*$/gm, '')                      // quote lines
    .replace(/&(amp|lt|gt|#x27|#39|quot);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#x27;': "'", '&#39;': "'", '&quot;': '"' }[m] ?? m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface RawComment {
  kind: string;
  data: {
    author?: string; body?: string; score?: number; created_utc?: number; depth?: number;
    distinguished?: string | null; stickied?: boolean;
    replies?: { data?: { children?: RawComment[] } } | '';
  };
}

interface OutComment {
  user: { name: string; avatar?: string };
  body: string; timeAgo: string; score: string; depth: number; isOP: boolean;
}

// Flatten a reddit comment listing to top-level comments, each followed by AT MOST ONE reply (depth 1)
// — the picker groups a comment with a single reply, and the card renderer nests by depth. The listing
// is fetched with depth=2 so one reply level is available; deeper replies are intentionally dropped.
function flattenComments(children: RawComment[], postAuthor: string): OutComment[] {
  const out: OutComment[] = [];
  const push = (d: RawComment['data'], depth: number): boolean => {
    const body = plainText(d.body ?? '');
    const skip = !d.author || d.author === '[deleted]' || d.author === 'AutoModerator'
      || d.stickied || !body || body === '[removed]' || body === '[deleted]';
    if (skip) return false;
    out.push({
      user: { name: d.author! },
      body,
      timeAgo: timeAgo(d.created_utc ?? Date.now() / 1000),
      score: fmtScore(d.score ?? 0),
      depth,
      isOP: d.author === postAuthor,
    });
    return true;
  };
  for (const child of children) {
    if (out.length >= MAX_COMMENTS) break;
    if (child.kind !== 't1') continue;
    if (!push(child.data, 0)) continue;
    // Attach the first usable reply (if any) right after its parent, then move on — one reply per comment.
    const replies = typeof child.data.replies === 'object' ? child.data.replies?.data?.children : undefined;
    if (replies) {
      for (const rc of replies) {
        if (out.length >= MAX_COMMENTS) break;
        if (rc.kind === 't1' && push(rc.data, 1)) break;
      }
    }
  }
  return out;
}

/** Fetch a user's avatar and inline it as a data URI (undefined on any failure — renderer falls
    back to the colored initial disc). */
async function fetchAvatar(name: string): Promise<string | undefined> {
  try {
    const about = await redditGet(`/user/${encodeURIComponent(name)}/about`, 'raw_json=1') as
      { data?: { snoovatar_img?: string; icon_img?: string } };
    const src = about.data?.snoovatar_img || about.data?.icon_img;
    if (!src || !(await isSafePublicUrl(src))) return undefined;
    const res = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? 'image/png';
    if (!type.startsWith('image/')) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 300_000) return undefined;   // keep the response payload sane
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return undefined; }
}

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const threadId = await resolveThreadId(parsed.data.url.trim());
    if (!threadId) {
      return NextResponse.json({ error: 'That doesn’t look like a Reddit thread link.' }, { status: 400 });
    }

    // Transport order: native (oauth/browser) first — it carries the real comment TREE, scores and
    // avatars, while the Apify actor flattens every comment to depth 0 and hides votes. Apify is
    // the fallback for environments without Chrome, or the primary with REDDIT_TRANSPORT=apify.
    const skipAvatars = parsed.data.skipAvatars === true;
    // Apify first when the caller prefers it (bulk) or REDDIT_TRANSPORT=apify; else native first.
    const apifyFirst = (parsed.data.preferApify === true || process.env.REDDIT_TRANSPORT === 'apify') && !!process.env.APIFY_TOKEN;
    if (apifyFirst) {
      try { return NextResponse.json(await apifyWithAvatars(threadId, skipAvatars)); }
      catch (e) { console.error('[reddit] apify transport failed, trying native:', e); }
    }
    try {
      return NextResponse.json(await nativeImport(threadId, skipAvatars));
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      if (!apifyFirst && process.env.APIFY_TOKEN) {
        console.error('[reddit] native transport failed, falling back to apify:', e);
        return NextResponse.json(await apifyWithAvatars(threadId, skipAvatars));
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      return NextResponse.json(
        { error: 'Reddit import isn’t configured — add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to .env.local (create a free script app at reddit.com/prefs/apps).' },
        { status: 501 },
      );
    }
    console.error('[reddit]', e);
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? 'Reddit took too long — try again.' : 'Couldn’t fetch that thread from Reddit.' }, { status: 502 });
  }
}

/** Apify thread import + best-effort avatar enrichment over the native transport (the actor
    doesn't scrape user profiles). Enrichment failure just leaves the initial discs. */
async function apifyWithAvatars(threadId: string, skipAvatars = false) {
  const data = await apifyImport(`https://www.reddit.com/comments/${threadId}/`);
  if (skipAvatars) return data;
  try {
    const names = [...new Set([
      data.post.user.name.replace(/^u\//, ''),
      ...data.comments.map(c => c.user.name),
    ])].slice(0, MAX_AVATARS);
    const avatars = new Map(await Promise.all(names.map(async n => [n, await fetchAvatar(n)] as const)));
    const postAuthor = data.post.user.name.replace(/^u\//, '');
    (data.post.user as { avatar?: string }).avatar = avatars.get(postAuthor);
    for (const c of data.comments) c.user.avatar = avatars.get(c.user.name) ?? undefined;
  } catch (e) {
    console.warn('[reddit] avatar enrichment unavailable:', e instanceof Error ? e.message : e);
  }
  return data;
}

/** Full-fidelity import over oauth/browser: real comment tree, scores, and avatars. */
async function nativeImport(threadId: string, skipAvatars = false) {
  const listing = await redditGet(`/comments/${threadId}`, 'limit=60&depth=2&raw_json=1&sort=top') as
      [{ data: { children: [{ data: Record<string, unknown> }] } }, { data: { children: RawComment[] } }];
    const p = listing[0]?.data?.children?.[0]?.data as {
      author?: string; title?: string; selftext?: string; score?: number;
      num_comments?: number; created_utc?: number; subreddit_name_prefixed?: string;
    } | undefined;
    if (!p?.title) throw new Error('thread unreadable — deleted or private?');

    const comments = flattenComments(listing[1]?.data?.children ?? [], p.author ?? '');

    // avatars: post author first, then commenters in order, capped (skipped for bulk — the
    // per-author lookups are what throttle Reddit and jam the shared browser page under load).
    const avatars = new Map<string, string | undefined>();
    if (!skipAvatars) {
      const names = [...new Set([p.author, ...comments.map(c => c.user.name)])].filter((n): n is string => !!n && n !== '[deleted]').slice(0, MAX_AVATARS);
      for (const [n, a] of await Promise.all(names.map(async n => [n, await fetchAvatar(n)] as const))) avatars.set(n, a);
      for (const c of comments) c.user.avatar = avatars.get(c.user.name) ?? undefined;
    }

    return {
      post: {
        user: { name: `u/${p.author ?? 'unknown'}`, avatar: p.author ? avatars.get(p.author) : undefined },
        subreddit: p.subreddit_name_prefixed,
        timeAgo: timeAgo(p.created_utc ?? Date.now() / 1000),
        title: plainText(p.title),
        body: p.selftext ? plainText(p.selftext) : undefined,
        score: fmtScore(p.score ?? 0),
        commentCount: fmtScore(p.num_comments ?? 0),
      },
      comments,
    };
}
