// Server-only: fetch Reddit's public .json endpoints through a real headless Chrome session.
// Reddit hard-403s plain HTTP clients, but a real browser passes its JS challenge; once passed,
// in-page fetch() calls return clean JSON for the whole session. One browser instance is kept
// alive across requests (dev-server process lifetime) so only the first import pays the ~5s
// challenge cost. Used as the fallback transport when REDDIT_CLIENT_ID/SECRET aren't configured.

import type { Browser, Page } from 'puppeteer-core';

const CHROME_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let pagePromise: Promise<Page> | null = null;

async function getPage(): Promise<Page> {
  pagePromise ??= (async () => {
    const executablePath = process.env.REDDIT_CHROME_PATH ?? CHROME_PATHS[process.platform];
    if (!executablePath) throw new Error('No Chrome path for this platform — set REDDIT_CHROME_PATH');
    const puppeteer = (await import('puppeteer-core')).default;
    const browser: Browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await passChallenge(page);
    return page;
  })().catch(e => { pagePromise = null; throw e; });
  return pagePromise;
}

async function passChallenge(page: Page): Promise<void> {
  await page.goto('https://www.reddit.com/r/popular/', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  // the challenge redirects back to a real page; shreddit-app only exists once we're through
  await page.waitForSelector('shreddit-app', { timeout: 30_000 }).catch(() => {});
}

/** GET a reddit.com path (e.g. "/comments/abc123.json?raw_json=1") inside the browser session.
    Retries once through a fresh challenge pass if the wall reappears. */
export async function redditBrowserJson(path: string): Promise<unknown> {
  const page = await getPage();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await page.evaluate(async (p: string) => {
      try {
        const res = await fetch(p, { headers: { accept: 'application/json' } });
        const text = await res.text();
        return { status: res.status, text: text.slice(0, 5_000_000) };
      } catch (e) {
        return { status: 0, text: String(e) };
      }
    }, path);
    const body = result.text.trimStart();
    if (result.status === 200 && (body.startsWith('{') || body.startsWith('['))) {
      try { return JSON.parse(result.text); } catch { /* fall through to retry */ }
    }
    if (attempt === 0) await passChallenge(page);   // wall came back — re-clear once
  }
  throw new Error(`reddit browser fetch failed for ${path}`);
}
