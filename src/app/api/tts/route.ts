import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ElevenLabs text-to-speech with character timestamps, proxied so the browser needs no CORS help.
// The API key comes from the client per-request (it lives in the user's localStorage — this app has
// no accounts or server-side secrets); nothing is stored here.

export const runtime = 'nodejs';

const Schema = z.object({
  // Optional when the server has ELEVENLABS_API_KEY configured (.env.local) — the client key,
  // if present, still wins so individual users can keep their own quota.
  apiKey: z.string().max(200).optional(),
  voiceId: z.string().min(4).max(80),
  text: z.string().min(1).max(5000),
  modelId: z.string().max(80).optional(),
  /** ElevenLabs delivery knobs — the client sends an excited "brainrot narrator" preset. */
  voiceSettings: z.object({
    stability: z.number().min(0).max(1),
    similarity_boost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    use_speaker_boost: z.boolean(),
    /** ElevenLabs native delivery speed (1 = natural, max 1.2). Timestamps reflect the sped audio,
        so reveal sync holds with no extra work. */
    speed: z.number().min(0.7).max(1.2),
  }).partial().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'voiceId and text are required' }, { status: 400 });
  const { voiceId, text, modelId, voiceSettings } = parsed.data;
  const apiKey = parsed.data.apiKey?.trim() || process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey.length < 8) {
    return NextResponse.json(
      { error: 'No ElevenLabs key — paste one in the Narration panel, or set ELEVENLABS_API_KEY in .env.local.' },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: modelId ?? 'eleven_multilingual_v2',
          ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const msg = res.status === 401 ? 'ElevenLabs rejected the API key.'
        : res.status === 402 ? 'That voice needs a paid ElevenLabs plan — free keys can only use premade voices (e.g. Liam, the default).'
        : res.status === 422 ? 'ElevenLabs rejected the request — check the voice ID.'
        : `ElevenLabs error (${res.status}).`;
      console.error('[tts]', res.status, detail.slice(0, 300));
      // Only 429 (rate limit) / upstream 5xx are worth a client retry; 401/402/422 are deterministic config
      // errors that won't improve on retry. Surface both the upstream status and a retryable hint so the client
      // can back off on the former and fail fast (with the real message) on the latter.
      const retryable = res.status === 429 || res.status >= 500;
      return NextResponse.json({ error: msg, upstreamStatus: res.status, retryable }, { status: 502 });
    }
    // { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }
    return NextResponse.json(await res.json());
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? 'Narration timed out — try shorter text.' : 'Could not reach ElevenLabs.' }, { status: 504 });
  }
}
