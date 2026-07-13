import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ElevenLabs text-to-speech with character timestamps, proxied so the browser needs no CORS help.
// The API key comes from the client per-request (it lives in the user's localStorage — this app has
// no accounts or server-side secrets); nothing is stored here.

export const runtime = 'nodejs';

const Schema = z.object({
  apiKey: z.string().min(8).max(200),
  voiceId: z.string().min(4).max(80),
  text: z.string().min(1).max(5000),
  modelId: z.string().max(80).optional(),
  /** ElevenLabs delivery knobs — the client sends an excited "brainrot narrator" preset. */
  voiceSettings: z.object({
    stability: z.number().min(0).max(1),
    similarity_boost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    use_speaker_boost: z.boolean(),
  }).partial().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'apiKey, voiceId and text are required' }, { status: 400 });
  const { apiKey, voiceId, text, modelId, voiceSettings } = parsed.data;

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
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    // { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }
    return NextResponse.json(await res.json());
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? 'Narration timed out — try shorter text.' : 'Could not reach ElevenLabs.' }, { status: 504 });
  }
}
