import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Generate the YouTube title + description for a reel in ONE model call via OpenRouter, fed the
// actual scraped thread (post + comments) — no web-search dependency. JSON response_format returns
// { title, description } directly; boundary-aware caps enforce YouTube's hard limits (title 100,
// description 5000). Model is configurable via OPENROUTER_MODEL to A/B copy quality without code.

export const runtime = 'nodejs';
export const maxDuration = 60;

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
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

type ModelResult =
  | { ok: true; title: string; description: string }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

async function generateViaOpenRouter(prompt: string, apiKey: string): Promise<ModelResult> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'reels-studio',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, rateLimited: res.status === 429 || res.status === 503, status: res.status, detail };
  }
  const data = await res.json();
  const raw: string = (data.choices?.[0]?.message?.content ?? '').trim();
  try {
    // Some models wrap JSON in a code fence despite response_format — unwrap before parsing.
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText) as { title?: string; description?: string };
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

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Copy generation isn’t configured — add OPENROUTER_API_KEY to .env.local.' },
      { status: 501 },
    );
  }

  const prompt = buildPrompt(parsed.data.url.trim(), threadToText(parsed.data.thread));
  // One retry on transient failures (rate limit / overload / unparseable output).
  let lastFailure: Extract<ModelResult, { ok: false }> | null = null;
  for (let attemptN = 0; attemptN < 2; attemptN++) {
    const attempt = await generateViaOpenRouter(prompt, apiKey).catch((e): ModelResult => (
      { ok: false, rateLimited: false, status: 0, detail: String(e) }
    ));
    if (attempt.ok) {
      const title = capText(attempt.title.replace(/^["'“”]+|["'“”]+$/g, '').trim(), TITLE_MAX);
      const description = capText(attempt.description, DESC_MAX);
      if (!title && !description) return NextResponse.json({ error: 'The model returned an empty result.' }, { status: 502 });
      return NextResponse.json({ title, description, model: OPENROUTER_MODEL });
    }
    lastFailure = attempt;
    console.warn(`[yt-copy] ${OPENROUTER_MODEL} attempt ${attemptN + 1} failed (${attempt.status})`);
    if (!attempt.rateLimited) console.error('[yt-copy] detail:', attempt.detail.slice(0, 300));
  }

  const rateLimited = lastFailure?.rateLimited ?? false;
  return NextResponse.json(
    { error: rateLimited ? 'The model is rate limited — try again in a minute.' : `Model error (${lastFailure?.status ?? '?'})` },
    { status: rateLimited ? 429 : 502 },
  );
}
