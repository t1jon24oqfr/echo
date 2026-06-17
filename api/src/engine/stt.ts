// Speech-to-text — transcribe a user voice message via fal whisper.
import { fal } from '@fal-ai/client';

const STT_TIMEOUT_MS = 60_000;

export const FAL_STT_MODEL = process.env.FAL_STT_MODEL ?? 'fal-ai/whisper';

export class SttUnavailableError extends Error {
  constructor() {
    super('stt_unavailable');
    this.name = 'SttUnavailableError';
  }
}

export function hasSttKey(): boolean {
  return Boolean(process.env.FAL_KEY);
}

interface FalWhisperResult {
  data?: { text?: string; transcription?: string };
}

/**
 * Transcribe an audio blob. Uploads to fal storage, runs whisper, returns text.
 * Throws SttUnavailableError when FAL_KEY is missing (caller maps to 501).
 * Other failures (timeout / fal error) propagate so the caller can map to 502.
 */
export async function transcribeAudio(buf: Buffer, mime: string): Promise<string> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new SttUnavailableError();
  fal.config({ credentials: falKey });

  const result = await withTimeout(
    (async (): Promise<FalWhisperResult> => {
      const audioUrl = await fal.storage.upload(
        new Blob([new Uint8Array(buf)], { type: mime }),
      );
      return (await fal.subscribe(FAL_STT_MODEL, {
        input: { audio_url: audioUrl, language: 'uk' },
      })) as FalWhisperResult;
    })(),
    STT_TIMEOUT_MS,
  );

  const text = (result.data?.text ?? result.data?.transcription ?? '').trim();
  return text;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fal whisper timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}
