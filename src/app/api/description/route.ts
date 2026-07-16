import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Generate the YouTube title + description for a reel in ONE Gemini call, fed the actual scraped
// thread (post + comments) instead of asking the model to search for it — no grounding dependency,
// no ungrounded-answer risk, half the quota of separate calls. Structured JSON output (no tools in
// play) returns { title, description } directly. Key pool + boundary-aware caps kept from the
// sonotool engine. Limits: title 100 chars, description 5000 chars (YouTube's hard limits).

export const runtime = 'nodejs';
export const maxDuration = 60;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TITLE_MAX = 100;
const DESC_MAX = 5000;
const THREAD_TEXT_MAX = 16_000;   // plenty of context, bounded cost

const Schema = z.object({
  url: z.string().min(8).max(2000),
  thread: z.object({
    post: z.object({
      user: z.object({ name: z.string() }).passthrough(),
      title: z.string(),
      body: z.string().optional(),
    }).passthrough(),
    comments: z.array(z.object({
      user: z.object({ name: z.string() }).passthrough(),
      body: z.string(),
    }).passthrough()).max(60),
  }),
});

function threadToText(t: z.infer<typeof Schema>['thread']): string {
  const lines = [
    `POST by ${t.post.user.name}: ${t.post.title}`,
    ...(t.post.body ? [t.post.body] : []),
    '',
    'COMMENTS:',
    ...t.comments.map(c => `${c.user.name}: ${c.body}`),
  ];
  const text = lines.join('\n');
  return text.length > THREAD_TEXT_MAX ? `${text.slice(0, THREAD_TEXT_MAX)}…` : text;
}

const buildPrompt = (url: string, threadText: string) =>
  `My youtube short is about this reddit thread: ${url}\n\n` +
  `Here is the full thread content:\n\n${threadText}\n\n` +
  'Based only on the thread above, generate BOTH of the following:\n' +
  `1. "title" — a viral hook to use as the youtube short's title. No more than ${TITLE_MAX} characters ` +
  '(including spaces), no emojis, no hashtags, no quotation marks around it.\n' +
  `2. "description" — a youtube description, no emojis, in exactly 2 paragraphs. Hard requirement: at most ` +
  `${DESC_MAX} characters (including spaces) — do not exceed this under any circumstances. Aim for roughly 4500 characters.\n` +
  'Return only JSON with the keys "title" and "description".';

function getGeminiKeys(): string[] {
  const pool = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = process.env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}

type GeminiResult =
  | { ok: true; title: string; description: string }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

async function generateWithGemini(prompt: string, apiKey: string): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { title: { type: 'STRING' }, description: { type: 'STRING' } },
            required: ['title', 'description'],
          },
        },
      }),
      signal: AbortSignal.timeout(55_000),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, rateLimited: res.status === 429 || res.status === 503, status: res.status, detail };
  }
  const data = await res.json();
  const raw = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  try {
    const parsed = JSON.parse(raw) as { title?: string; description?: string };
    return { ok: true, title: (parsed.title ?? '').trim(), description: (parsed.description ?? '').trim() };
  } catch {
    return { ok: false, rateLimited: false, status: 200, detail: `unparseable model output: ${raw.slice(0, 200)}` };
  }
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
  if (!parsed.success) return NextResponse.json({ error: 'url and thread are required' }, { status: 400 });

  const keys = getGeminiKeys();
  if (!keys.length) {
    return NextResponse.json(
      { error: 'Copy generation isn’t configured — add GEMINI_API_KEY (or GEMINI_API_KEYS) to .env.local. Free keys: aistudio.google.com/apikey.' },
      { status: 501 },
    );
  }

  const prompt = buildPrompt(parsed.data.url.trim(), threadToText(parsed.data.thread));
  let lastFailure: Extract<GeminiResult, { ok: false }> | null = null;

  for (let i = 0; i < keys.length; i++) {
    const attempt = await generateWithGemini(prompt, keys[i]).catch((e): GeminiResult => (
      { ok: false, rateLimited: false, status: 0, detail: String(e) }
    ));
    if (attempt.ok) {
      const title = capText(attempt.title.replace(/^["'“”]+|["'“”]+$/g, '').trim(), TITLE_MAX);
      const description = capText(attempt.description, DESC_MAX);
      if (!title && !description) return NextResponse.json({ error: 'Gemini returned an empty result.' }, { status: 502 });
      return NextResponse.json({ title, description });
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
