import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSafePublicUrl } from '@/lib/http';

// Force Node.js runtime for CommonJS dependencies
export const runtime = 'nodejs';

const API_TIMEOUT = 30000;

// Classify by the parsed HOSTNAME (not a substring of the whole URL) so a payload like
// `https://169.254.169.254/?x=tiktok.com` or `https://vm.tiktok.com@169.254.169.254/` can't masquerade.
function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
const hostMatches = (h: string, base: string) => h === base || h.endsWith('.' + base);

function isTikTokUrl(url: string): boolean {
  return hostMatches(hostOf(url), 'tiktok.com');
}

function isInstagramUrl(url: string): boolean {
  return hostMatches(hostOf(url), 'instagram.com');
}

function isXUrl(url: string): boolean {
  const h = hostOf(url);
  return hostMatches(h, 'twitter.com') || hostMatches(h, 'x.com');
}

async function resolveShortUrl(url: string): Promise<string> {
  const h = hostOf(url);
  if (h === 'vm.tiktok.com' || h === 'vt.tiktok.com') {
    // SSRF guard: never fetch a user-supplied URL that resolves to an internal/private address.
    if (!(await isSafePublicUrl(url))) return url;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const location = response.headers.get('location');
      if (location) return location;
    } catch (err) {
      console.error('Failed to resolve short URL:', err);
    }
  }
  return url;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

type InstagramDownloader = (url: string) => Promise<{
  result?: Array<{ url: string; filename?: string; thumbnail?: string; type?: string }>;
  error?: string;
}>;

export async function POST(request: NextRequest) {
  const Schema = z.object({ url: z.string().max(2000) });
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  const trimmedUrl = parsed.data.url.trim();

  try {
    if (isTikTokUrl(trimmedUrl)) {
      const resolvedUrl = await resolveShortUrl(trimmedUrl);
      const form = new URLSearchParams({ url: resolvedUrl, hd: '1' });

      const res = await fetchWithTimeout('https://www.tikwm.com/api/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

      if (!res.ok) {
        console.error('TikWM API error:', res.status, res.statusText);
        return NextResponse.json({ error: 'Upstream service error' }, { status: 502 });
      }

      const json = await res.json() as { code: number; msg?: string; data?: unknown };

      if (json.code !== 0) {
        console.error('TikWM error:', json.msg);
        const errorMsg = json.msg || 'Failed to fetch TikTok video';
        let userMessage = errorMsg;
        if (errorMsg.includes('not found') || errorMsg.includes('Video not found')) {
          userMessage = 'Video not found. The link may be private, deleted, or invalid.';
        } else if (errorMsg.includes('Api rate limit') || errorMsg.includes('rate limit')) {
          userMessage = 'Too many requests. Please wait a moment and try again.';
        } else if (errorMsg.includes('Url parsing') || errorMsg.includes('invalid')) {
          userMessage = 'Invalid TikTok URL. Please check the link and try again.';
        }
        return NextResponse.json({ error: userMessage }, { status: 400 });
      }

      return NextResponse.json(json.data);
    }

    if (isInstagramUrl(trimmedUrl)) {
      const { igdl } = await import('btch-downloader');
      // igdl accepts no abort signal, so bound it with Promise.race — otherwise a hung Instagram fetch
      // holds the serverless function (and the client's request) open until the platform kills it, which
      // was one way the reel download got stuck. (Previously an AbortController was created but its signal
      // was never passed to igdl, so the timeout did nothing.)
      const data = await Promise.race([
        igdl(trimmedUrl),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Instagram fetch timed out')), API_TIMEOUT)),
      ]) as Awaited<ReturnType<InstagramDownloader>>;

      if (!data.result || data.result.length === 0) {
        return NextResponse.json({ error: data.error || 'Failed to fetch Instagram media' }, { status: 400 });
      }

      const firstResult = data.result[0];
      return NextResponse.json({
        id: Date.now().toString(),
        title: '',
        cover: firstResult.thumbnail || '',
        author: { uniqueId: 'instagram', nickname: 'Instagram User', avatarThumb: '' },
        play: firstResult.url || '',
        wmplay: firstResult.url || '',
        hdplay: firstResult.url || '',
        duration: 0,
        size: 0,
      });
    }

    if (isXUrl(trimmedUrl)) {
      const match = trimmedUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/);
      if (!match) {
        return NextResponse.json({ error: 'Invalid X/Twitter URL format' }, { status: 400 });
      }
      const [, user, statusId] = match;

      const fxRes = await fetchWithTimeout(`https://api.fxtwitter.com/${user}/status/${statusId}`);
      if (!fxRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch X/Twitter post' }, { status: 502 });
      }

      const fxJson = await fxRes.json() as {
        tweet?: {
          text?: string;
          author?: { screen_name?: string; name?: string; avatar_url?: string };
          media?: {
            videos?: Array<{ variants?: Array<{ url: string; bitrate?: number; content_type?: string }>; thumbnail_url?: string; duration?: number }>;
            photos?: Array<{ url: string }>;
          };
        };
      };
      const tweet = fxJson.tweet;
      if (!tweet) {
        return NextResponse.json({ error: 'Post not found or unavailable' }, { status: 400 });
      }

      const author = tweet.author;
      const authorResult = {
        uniqueId: author?.screen_name || 'x',
        nickname: author?.name || 'X User',
        avatarThumb: author?.avatar_url || '',
      };

      const videos = tweet.media?.videos?.[0]?.variants ?? [];
      const photos = tweet.media?.photos ?? [];

      if (videos.length > 0) {
        const mp4Variants = videos.filter(v => v.content_type === 'video/mp4' && v.url);
        const best = mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || videos[0];
        return NextResponse.json({
          id: statusId,
          title: tweet.text || '',
          cover: tweet.media?.videos?.[0]?.thumbnail_url || '',
          author: authorResult,
          play: best.url,
          wmplay: best.url,
          hdplay: best.url,
          duration: Math.round(tweet.media?.videos?.[0]?.duration || 0),
          size: 0,
        });
      }

      if (photos.length > 0) {
        return NextResponse.json({
          id: statusId,
          title: tweet.text || '',
          cover: photos[0].url,
          author: authorResult,
          play: '',
          wmplay: '',
          hdplay: '',
          duration: 0,
          size: 0,
          images: photos.map((p) => p.url),
        });
      }

      return NextResponse.json({ error: 'No media found in this post' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Unsupported URL. Please provide a TikTok, Instagram, or X/Twitter URL.' }, { status: 400 });
  } catch (error: unknown) {
    const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'));
    if (isAbort) {
      return NextResponse.json({ error: 'Request timeout. The server took too long to respond.' }, { status: 504 });
    }
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to fetch video data' }, { status: 502 });
  }
}
