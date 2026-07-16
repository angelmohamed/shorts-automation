import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Generate YouTube copy for a reel from its Reddit thread link — kind: 'description' (2-paragraph,
// <=5000 chars: YouTube's description limit) or 'title' (viral hook, <=100 chars: YouTube's title
// limit). Ported from sonotool's sheet caption engine: Gemini with Google Search grounding (the
// model must look the thread up, not answer from prior knowledge), a rotating key pool for
// free-tier quota, and a boundary-aware hard cap.

export const runtime = 'nodejs';
export const maxDuration = 60;   // a grounded call can take tens of seconds

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const Schema = z.object({
  url: z.string().min(8).max(2000),
  kind: z.enum(['description', 'title']).default('description'),
});

const KINDS = {
  description: {
    max: 5000,
    prompt: (url: string) =>
      `My youtube short is about this reddit thread: ${url}\n\n` +
      'Generate me a youtube description, no emojis, in exactly 2 paragraphs, on this thread. ' +
      'Before writing, you must use Google Search to look up that thread. ' +
      'Hard requirement: the entire caption must be at most 5000 characters (including spaces) ' +
      'do not exceed this under any circumstances. Aim for roughly 4500 characters. ' +
      'Output only the caption text, nothing else.',
  },
  title: {
    max: 100,
    prompt: (url: string) =>
      `My youtube short is about this reddit thread: ${url}\n\n` +
      'Generate me a viral hook as a title for the youtube short, based on this thread. ' +
      'Before writing, you must use Google Search to look up that thread. ' +
      'Hard requirement: the title must be no more than 100 characters (including spaces) — ' +
      'do not exceed this under any circumstances. No emojis, no quotation marks around it, no hashtags. ' +
      'Output only the title text, nothing else.',
  },
} as const;

// Pool of Gemini API keys tried in rotation. GEMINI_API_KEYS = comma-separated (primary first);
// falls back to the single GEMINI_API_KEY. Keys from separate Google Cloud projects multiply the
// free-tier quota, which is scoped per project.
function getGeminiKeys(): string[] {
  const pool = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = process.env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}

type GeminiResult =
  | { ok: true; text: string; searchQueries: string[] }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

async function generateWithGemini(prompt: string, apiKey: string): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
      signal: AbortSignal.timeout(55_000),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, rateLimited: res.status === 429 || res.status === 503, status: res.status, detail };
  }
  const data = await res.json();
  const searchQueries: string[] = data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  return { ok: true, text, searchQueries };
}

/** Trim to the limit without cutting mid-sentence/word (model character counts are unreliable). */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
  if (lastSentence > max * 0.6) return slice.slice(0, lastSentence + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  const keys = getGeminiKeys();
  if (!keys.length) {
    return NextResponse.json(
      { error: 'Description generation isn’t configured — add GEMINI_API_KEY (or GEMINI_API_KEYS) to .env.local. Free keys: aistudio.google.com/apikey.' },
      { status: 501 },
    );
  }

  const kind = KINDS[parsed.data.kind];
  const prompt = kind.prompt(parsed.data.url.trim());
  let lastFailure: Extract<GeminiResult, { ok: false }> | null = null;

  for (let i = 0; i < keys.length; i++) {
    const attempt = await generateWithGemini(prompt, keys[i]).catch((e): GeminiResult => (
      { ok: false, rateLimited: false, status: 0, detail: String(e) }
    ));
    if (attempt.ok) {
      if (attempt.searchQueries.length) {
        console.log('[yt-copy] 🔎 searched:', attempt.searchQueries.join(' | '));
      } else {
        console.warn('[yt-copy] ⚠️ no web search performed — description is ungrounded');
      }
      // Titles sometimes come back wrapped in quotes despite instructions — strip them.
      const cleaned = parsed.data.kind === 'title' ? attempt.text.replace(/^["'“”]+|["'“”]+$/g, '').trim() : attempt.text;
      const text = capText(cleaned, kind.max);
      if (!text) return NextResponse.json({ error: 'Gemini returned an empty result.' }, { status: 502 });
      return NextResponse.json({ text, grounded: attempt.searchQueries.length > 0 });
    }
    lastFailure = attempt;
    console.warn(`[yt-copy] Gemini key #${i + 1}/${keys.length} failed (${attempt.status})${i < keys.length - 1 ? ' — trying next key' : ''}`);
    if (!attempt.rateLimited) console.error('[yt-copy] detail:', attempt.detail.slice(0, 300));
  }

  const rateLimited = lastFailure?.rateLimited ?? false;
  return NextResponse.json(
    { error: rateLimited ? 'All Gemini keys are rate limited — try again in a minute.' : `Gemini API error (${lastFailure?.status ?? '?'})` },
    { status: rateLimited ? 429 : 502 },
  );
}
