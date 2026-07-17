import { describe, it, expect, vi, afterEach } from 'vitest';
import { FOOTAGE_PUBLIC_BASE, isFootageUrl, footageVideoData } from './footage';
import { bestVideoUrl, proxyStreamUrl } from './utils';

// -----------------------------------------------------------------------------
// Ground truth used to derive expectations from first principles (NOT copied
// from the implementation output):
//
// * FOOTAGE_PUBLIC_BASE is the public R2 dev bucket for this project. The same
//   bucket host appears in src/lib/music.ts, so the domain is verifiable.
// * encodeURIComponent (verified, MDN): leaves A-Z a-z 0-9 - _ . ! ~ * ' ( )
//   unescaped; escapes ":" -> %3A, "/" -> %2F, " " -> %20. => hyphens, dots and
//   digits inside the R2 host survive; scheme "://" and path "/" get escaped.
// * decodeURIComponent (verified, MDN): %20 -> space, %C3%A9 -> "é" (UTF-8),
//   and does NOT turn "+" into a space.
// * String.prototype.split (verified, MDN): "".split("/") === [""], so
//   "".split("/").pop() === "" (never undefined) => the `?? 'footage'` fallback
//   in footageVideoData is unreachable for a string input.
// -----------------------------------------------------------------------------

const BASE = 'https://pub-63dabe78ed9342c5a94e50b584141711.r2.dev';

describe('FOOTAGE_PUBLIC_BASE constant', () => {
  it('is the expected public R2 bucket origin, with no trailing slash', () => {
    // Locks the domain so a typo in the bucket host is caught.
    expect(FOOTAGE_PUBLIC_BASE).toBe('https://pub-63dabe78ed9342c5a94e50b584141711.r2.dev');
    expect(FOOTAGE_PUBLIC_BASE.endsWith('/')).toBe(false);
  });
});

describe('isFootageUrl — true positives (URLs inside the footage bucket)', () => {
  it('matches a segment URL under the bucket', () => {
    expect(isFootageUrl(`${BASE}/segments/video1.3.mp4`)).toBe(true);
  });

  it('matches a file at the bucket root (e.g. manifest.json)', () => {
    expect(isFootageUrl(`${BASE}/manifest.json`)).toBe(true);
  });

  it('matches any path under the bucket — the contract is bucket membership', () => {
    // NOTE (documenting behaviour, not a bug): the check is a bucket-origin
    // prefix test, so a NON-footage asset that happens to live in the same R2
    // bucket (music lives at /music/... per src/lib/music.ts) also returns true.
    expect(isFootageUrl(`${BASE}/music/elevator-music.mp3`)).toBe(true);
  });
});

describe('isFootageUrl — false positives / adversarial', () => {
  it('rejects a completely different host', () => {
    expect(isFootageUrl('https://www.tiktok.com/@a/video/123')).toBe(false);
  });

  it('rejects the wrong scheme (http vs https)', () => {
    // startsWith is scheme-sensitive; base is https.
    expect(isFootageUrl(`http://pub-63dabe78ed9342c5a94e50b584141711.r2.dev/x.mp4`)).toBe(false);
  });

  it('rejects a domain-suffix look-alike (trailing-slash guard)', () => {
    // Starts with the base STRING but the next char is "." not "/", so the
    // required base+"/" prefix fails. This is exactly why the impl appends "/".
    expect(isFootageUrl(`${BASE}.evil.com/segments/x.mp4`)).toBe(false);
  });

  it('rejects the bucket host appearing as a substring, not a prefix', () => {
    expect(isFootageUrl(`https://evil.com/?redirect=${BASE}/segments/x.mp4`)).toBe(false);
  });

  it('rejects the bare bucket base with no trailing slash', () => {
    // base itself is not base+"/" -> false. The bare origin names no object.
    expect(isFootageUrl(BASE)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isFootageUrl('')).toBe(false);
  });

  it('is not null-safe: throws on undefined (declared type is string)', () => {
    // Documents robustness: undefined.startsWith is a TypeError. In-contract
    // callers always pass a string, so this is a robustness note, not a defect
    // against any spec.
    expect(() => isFootageUrl(undefined as unknown as string)).toThrow(TypeError);
  });
});

describe('footageVideoData — shape', () => {
  it('produces the full VideoData for a normal segment URL', () => {
    const url = `${BASE}/segments/video1.3.mp4`;
    expect(footageVideoData(url)).toEqual({
      id: 'video1.3.mp4',
      title: 'video1.3', // only the trailing ".mp4" is stripped
      cover: '',
      author: { uniqueId: 'footage', nickname: 'Footage library', avatarThumb: '' },
      play: url,
      wmplay: '',
      hdplay: url,
      duration: 0,
      size: 0,
    });
  });

  it('sets play === hdplay === url and wmplay === "" (round-trip precondition)', () => {
    const url = `${BASE}/segments/clip.mp4`;
    const d = footageVideoData(url);
    expect(d.play).toBe(url);
    expect(d.hdplay).toBe(url);
    expect(d.wmplay).toBe('');
  });
});

describe('footageVideoData — filename parsing', () => {
  it('percent-decodes a space (%20) in the filename', () => {
    const d = footageVideoData(`${BASE}/segments/my%20clip.mp4`);
    expect(d.id).toBe('my clip.mp4');
    expect(d.title).toBe('my clip');
  });

  it('percent-decodes a UTF-8 unicode filename (%C3%A9 -> é)', () => {
    const d = footageVideoData(`${BASE}/segments/caf%C3%A9.mp4`);
    expect(d.id).toBe('café.mp4');
    expect(d.title).toBe('café');
  });

  it('leaves a "+" in the filename intact (decodeURIComponent does not form-decode)', () => {
    const d = footageVideoData(`${BASE}/segments/a+b.mp4`);
    expect(d.id).toBe('a+b.mp4');
    expect(d.title).toBe('a+b');
  });

  it('does not strip a non-.mp4 extension from the title', () => {
    const d = footageVideoData(`${BASE}/manifest.json`);
    expect(d.id).toBe('manifest.json');
    expect(d.title).toBe('manifest.json');
  });

  it('strips only the TRAILING ".mp4", not an internal one', () => {
    const d = footageVideoData(`${BASE}/segments/intro.mp4.backup.mp4`);
    expect(d.id).toBe('intro.mp4.backup.mp4');
    expect(d.title).toBe('intro.mp4.backup');
  });

  it('is case-sensitive on the extension (.MP4 is not stripped)', () => {
    // Regex /\.mp4$/ has no `i` flag. Footage is lowercase by construction, so
    // this is documented behaviour, not a defect for in-contract inputs.
    const d = footageVideoData(`${BASE}/segments/CLIP.MP4`);
    expect(d.id).toBe('CLIP.MP4');
    expect(d.title).toBe('CLIP.MP4');
  });

  it('for an empty URL falls back to the "footage" default name', () => {
    // "".split("/").pop() === "" (a string, never undefined); the code uses `|| 'footage'` so the empty
    // string is replaced by the intended default (a `??` here would wrongly leave an empty name).
    const d = footageVideoData('');
    expect(d.id).toBe('footage');
    expect(d.title).toBe('footage');
  });
});

describe('footageVideoData × utils round-trip', () => {
  const url = `${BASE}/segments/video1.3.mp4`;

  it('bestVideoUrl(footageVideoData(url)) round-trips to proxyStreamUrl(url)', () => {
    expect(bestVideoUrl(footageVideoData(url))).toBe(proxyStreamUrl(url));
  });

  it('produces the exact hand-encoded proxy URL (independent of the impl)', () => {
    // Hand-derived from the encodeURIComponent spec: ":"->%3A, "/"->%2F, and the
    // hyphens/dots/digits in the host are left untouched.
    const expected =
      '/api/proxy?stream=1&url=https%3A%2F%2Fpub-63dabe78ed9342c5a94e50b584141711.r2.dev%2Fsegments%2Fvideo1.3.mp4';
    expect(bestVideoUrl(footageVideoData(url))).toBe(expected);
  });

  it('the round-trip rides on hdplay (bestVideoUrl prefers hdplay > play > wmplay)', () => {
    // Guards the ordering that makes the round-trip meaningful: footageVideoData
    // sets hdplay, and bestVideoUrl must pick it first.
    expect(bestVideoUrl({ hdplay: 'HD', play: 'SD', wmplay: 'WM' })).toBe(proxyStreamUrl('HD'));
    expect(bestVideoUrl({ play: 'SD', wmplay: 'WM' })).toBe(proxyStreamUrl('SD'));
    expect(bestVideoUrl({ wmplay: 'WM' })).toBe(proxyStreamUrl('WM'));
  });
});

// -----------------------------------------------------------------------------
// fetchFootageManifest — network is fully mocked. Each test resets module state
// (vi.resetModules) and re-imports so the module-level manifest cache/promise is
// fresh, then stubs global.fetch.
// -----------------------------------------------------------------------------
describe('fetchFootageManifest (mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const okJson = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('fetches through the proxy and keeps only entries with both name and url', async () => {
    const fetchMock = vi.fn(async () =>
      okJson({
        segments: [
          { name: 'video1.3.mp4', group: 'video1', size: 10, url: `${BASE}/segments/video1.3.mp4` },
          { name: 'no-url.mp4', group: 'x', size: 5 }, // dropped: no url
          { group: 'y', size: 5, url: `${BASE}/segments/no-name.mp4` }, // dropped: no name
          { name: '', size: 5, url: `${BASE}/segments/empty-name.mp4` }, // dropped: empty name
          null, // dropped: nullish entry
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { fetchFootageManifest } = await import('./footage');
    const segs = await fetchFootageManifest();

    expect(segs).toEqual([
      { name: 'video1.3.mp4', group: 'video1', size: 10, url: `${BASE}/segments/video1.3.mp4` },
    ]);

    // Must request the proxied manifest URL, not the raw r2.dev URL.
    const calledWith = (fetchMock.mock.calls[0] as unknown[])[0];
    expect(calledWith).toBe(
      '/api/proxy?stream=1&url=https%3A%2F%2Fpub-63dabe78ed9342c5a94e50b584141711.r2.dev%2Fmanifest.json',
    );
  });

  it('returns [] when the JSON has no segments key', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { fetchFootageManifest } = await import('./footage');
    expect(await fetchFootageManifest()).toEqual([]);
  });

  it('caches the result: a second call does not re-fetch', async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ segments: [{ name: 'a.mp4', group: 'a', size: 1, url: `${BASE}/segments/a.mp4` }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { fetchFootageManifest } = await import('./footage');
    const first = await fetchFootageManifest();
    const second = await fetchFootageManifest();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with the status code on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { fetchFootageManifest } = await import('./footage');
    await expect(fetchFootageManifest()).rejects.toThrow('503');
  });

  it('clears the in-flight promise on failure so a later call can retry', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      return okJson({ segments: [{ name: 'b.mp4', group: 'b', size: 2, url: `${BASE}/segments/b.mp4` }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    const { fetchFootageManifest } = await import('./footage');

    await expect(fetchFootageManifest()).rejects.toThrow('500');
    // Retry must actually hit the network again (promise was reset in .catch).
    const segs = await fetchFootageManifest();
    expect(segs).toEqual([{ name: 'b.mp4', group: 'b', size: 2, url: `${BASE}/segments/b.mp4` }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
