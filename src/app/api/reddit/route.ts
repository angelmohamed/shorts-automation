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
const MAX_COMMENTS = 30;      // returned to the client for selection
const MAX_AVATARS = 12;       // unique authors whose avatar images we inline

const Schema = z.object({ url: z.string().min(8).max(2000) });

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

function flattenComments(children: RawComment[], postAuthor: string, depth = 0, out: OutComment[] = []): OutComment[] {
  for (const child of children) {
    if (out.length >= MAX_COMMENTS) break;
    if (child.kind !== 't1') continue;
    const d = child.data;
    const body = plainText(d.body ?? '');
    const skip = !d.author || d.author === '[deleted]' || d.author === 'AutoModerator'
      || d.stickied || !body || body === '[removed]' || body === '[deleted]';
    if (!skip) {
      out.push({
        user: { name: d.author! },
        body,
        timeAgo: timeAgo(d.created_utc ?? Date.now() / 1000),
        score: fmtScore(d.score ?? 0),
        depth,
        isOP: d.author === postAuthor,
      });
    }
    const replies = typeof d.replies === 'object' ? d.replies?.data?.children : undefined;
    if (replies && !skip) flattenComments(replies, postAuthor, depth + 1, out);
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

    const listing = await redditGet(`/comments/${threadId}`, 'limit=60&depth=4&raw_json=1&sort=top') as
      [{ data: { children: [{ data: Record<string, unknown> }] } }, { data: { children: RawComment[] } }];
    const p = listing[0]?.data?.children?.[0]?.data as {
      author?: string; title?: string; selftext?: string; score?: number;
      num_comments?: number; created_utc?: number; subreddit_name_prefixed?: string;
    } | undefined;
    if (!p?.title) return NextResponse.json({ error: 'Couldn’t read that thread — is it public?' }, { status: 404 });

    const comments = flattenComments(listing[1]?.data?.children ?? [], p.author ?? '');

    // avatars: post author first, then commenters in order, capped
    const names = [...new Set([p.author, ...comments.map(c => c.user.name)])].filter((n): n is string => !!n && n !== '[deleted]').slice(0, MAX_AVATARS);
    const avatars = new Map(await Promise.all(names.map(async n => [n, await fetchAvatar(n)] as const)));
    for (const c of comments) c.user.avatar = avatars.get(c.user.name) ?? undefined;

    return NextResponse.json({
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
    });
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
