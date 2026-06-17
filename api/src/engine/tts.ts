// Text-to-speech — synthesize a persona voice reply via fal.
// Two paths: a cloned voice (minimax speech-02-hd) when a voiceId is known,
// else a gender-appropriate ElevenLabs preset voice. Ukrainian-capable.
import { fal } from '@fal-ai/client';

const TTS_TIMEOUT_MS = 30_000;

export class TtsUnavailableError extends Error {
  constructor() {
    super('tts_unavailable');
    this.name = 'TtsUnavailableError';
  }
}

export function hasTtsKey(): boolean {
  return Boolean(process.env.FAL_KEY);
}

// fal "File" shape (audio.url is what we download).
interface FalFile {
  url?: string;
  content_type?: string;
  file_name?: string;
}
interface FalTtsResult {
  data?: { audio?: FalFile };
}
interface FalCloneResult {
  data?: { custom_voice_id?: string };
}

function extFromUrl(url: string, fallback = '.mp3'): string {
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}

/**
 * Synthesize speech for `text`.
 * - No FAL_KEY -> TtsUnavailableError (caller falls back to text).
 * - voiceId present -> FAL_TTS_CLONE_MODEL (minimax) with voice_setting.voice_id.
 * - else -> FAL_TTS_MODEL (elevenlabs) with the gender-appropriate preset voice.
 * Downloads the result audio. 30s timeout; raw provider errors are never leaked
 * (caller logs, falls back to text).
 */
export async function synthesizeSpeech(
  text: string,
  opts: { voiceId?: string | null; gender?: string | null },
): Promise<{ buffer: Buffer; ext: string }> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new TtsUnavailableError();
  const clean = (text ?? '').trim();
  if (!clean) throw new Error('empty tts text');
  fal.config({ credentials: falKey });

  let url: string;
  if (opts.voiceId) {
    // Cloned voice via minimax speech-02-hd. Voice id lives in voice_setting.voice_id;
    // output_format must be 'url' (default is 'hex') so we get a downloadable file.
    const cloneModel = process.env.FAL_TTS_CLONE_MODEL ?? 'fal-ai/minimax/speech-02-hd';
    const result = await withTimeout(
      fal.subscribe(cloneModel, {
        input: {
          text: clean,
          output_format: 'url',
          language_boost: 'Ukrainian',
          voice_setting: { voice_id: opts.voiceId },
        },
      }) as Promise<FalTtsResult>,
      TTS_TIMEOUT_MS,
    );
    url = result.data?.audio?.url ?? '';
  } else {
    // Preset voice via ElevenLabs multilingual-v2. Field is `voice` (a preset name).
    const ttsModel = process.env.FAL_TTS_MODEL ?? 'fal-ai/elevenlabs/tts/multilingual-v2';
    const female = process.env.FAL_TTS_VOICE_FEMALE ?? 'Sarah';
    const male = process.env.FAL_TTS_VOICE_MALE ?? 'Brian';
    const voice = opts.gender === 'male' ? male : female;
    const result = await withTimeout(
      fal.subscribe(ttsModel, {
        input: { text: clean, voice, language_code: 'uk' },
      }) as Promise<FalTtsResult>,
      TTS_TIMEOUT_MS,
    );
    url = result.data?.audio?.url ?? '';
  }

  if (!url) throw new Error('fal returned no audio');
  const audioRes = await withTimeout(fetch(url), TTS_TIMEOUT_MS);
  if (!audioRes.ok) throw new Error(`audio download failed: ${audioRes.status}`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  return { buffer, ext: extFromUrl(url) };
}

/**
 * Clone a voice from a sample: upload to fal storage, run FAL_VOICE_CLONE_MODEL,
 * return the new custom_voice_id. Throws on missing key or failure.
 */
export async function cloneVoice(sample: Buffer, mime: string): Promise<string> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new TtsUnavailableError();
  fal.config({ credentials: falKey });
  const model = process.env.FAL_VOICE_CLONE_MODEL ?? 'fal-ai/minimax/voice-clone';

  const result = await withTimeout(
    (async (): Promise<FalCloneResult> => {
      const audioUrl = await fal.storage.upload(
        new Blob([new Uint8Array(sample)], { type: mime }),
      );
      return (await fal.subscribe(model, {
        input: { audio_url: audioUrl },
      })) as FalCloneResult;
    })(),
    TTS_TIMEOUT_MS,
  );

  const voiceId = result.data?.custom_voice_id;
  if (!voiceId) throw new Error('fal returned no voice id');
  return voiceId;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fal tts timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}
