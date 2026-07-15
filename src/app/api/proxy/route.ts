import { NextRequest, NextResponse } from 'next/server';
import { isSafePublicUrl } from '@/lib/http';
import { FOOTAGE_PUBLIC_BASE } from '@/lib/footage';

const ALLOWED_HOSTS = [
  new URL(FOOTAGE_PUBLIC_BASE).hostname,   // R2 footage library (shared background segments)
  'tikwm.com',
  'tiktokcdn.com',
  'tiktokv.com',
  'tiktokcdn-us.com',
  'tokcdn.com',
  'muscdn.app',
  'fastdl.muscdn.app',
  'rapidcdn.app',
  'd.rapidcdn.app',
  'cdninstagram.com',
  'instagram.com',
  'twimg.com',
  'video.twimg.com',
  'pbs.twimg.com',
];

function isAllowedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const filename = request.nextUrl.searchParams.get('filename') || 'tiktok-download';
  const stream = request.nextUrl.searchParams.get('stream') === '1';

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isAllowedHost(url)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  try {
    const parsedUrl = new URL(url);
    const referer = parsedUrl.hostname.includes('twimg.com')
      ? 'https://x.com/'
      : 'https://www.tiktok.com/';

    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': referer,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
    const range = request.headers.get('Range');
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // Follow redirects MANUALLY so EVERY hop is re-validated against the allowlist AND the SSRF guard.
    // (Previously the post-redirect fetch used the default redirect:'follow', so an allowed CDN could
    // bounce a later hop to an internal address like 169.254.169.254. Now each Location is re-checked.)
    let currentUrl = url;
    let upstream = await fetch(currentUrl, { headers: upstreamHeaders, redirect: 'manual' });
    for (let hops = 0; hops < 5 && [301, 302, 303, 307, 308].includes(upstream.status); hops++) {
      const location = upstream.headers.get('location');
      if (!location) break;
      const resolved = new URL(location, currentUrl).toString();
      if (!isAllowedHost(resolved) || !(await isSafePublicUrl(resolved))) {
        return NextResponse.json({ error: 'Redirect target not allowed' }, { status: 403 });
      }
      currentUrl = resolved;
      upstream = await fetch(currentUrl, { headers: upstreamHeaders, redirect: 'manual' });
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Failed to fetch file' }, { status: 502 });
    }

    return buildProxyResponse(upstream, filename, stream);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Proxy error' }, { status: 502 });
  }
}

function buildProxyResponse(upstream: Response, filename: string, stream: boolean): NextResponse {
  let contentType = upstream.headers.get('Content-Type') || '';

  // Fix incorrect content types for video
  if (contentType.includes('octet-stream') || contentType.includes('charset=UTF-8')) {
    contentType = 'video/mp4';
  }

  const contentLength = upstream.headers.get('Content-Length');

  const headers = new Headers();
  if (!stream) {
    // Strip characters that could break out of the header value.
    const safeName = filename.replace(/[\r\n"\\]/g, '').slice(0, 150) || 'download';
    headers.set('Content-Disposition', `attachment; filename="${safeName}"`);
  }
  headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);

  // No Access-Control-Allow-Origin: the app consumes this endpoint strictly
  // same-origin; a wildcard would let any website stream through our proxy.
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  // Preserve range-related headers for video playback when present
  const acceptRanges = upstream.headers.get('Accept-Ranges');
  const contentRange = upstream.headers.get('Content-Range');
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
  if (contentRange) headers.set('Content-Range', contentRange);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
