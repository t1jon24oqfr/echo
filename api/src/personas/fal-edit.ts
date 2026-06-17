import { fal } from '@fal-ai/client';

const FAL_TIMEOUT_MS = 30_000;

interface FalImageResult {
  data?: { images?: { url?: string }[]; image?: { url?: string } };
}

export const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function hasFalKey(): boolean {
  return Boolean(process.env.FAL_KEY);
}

/**
 * One image-edit round-trip: upload the source photo to fal storage,
 * run the edit model with the prompt, download the resulting image.
 * Throws on missing key, timeout, or an empty result.
 */
export async function falEditImage(source: Buffer, mime: string, prompt: string): Promise<Buffer> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('FAL_KEY missing');
  fal.config({ credentials: falKey });
  const model = process.env.FAL_EDIT_MODEL ?? 'fal-ai/qwen-image-edit';

  const result = await withTimeout(
    (async (): Promise<FalImageResult> => {
      const imageUrl = await fal.storage.upload(
        new Blob([new Uint8Array(source)], { type: mime }),
      );
      return (await fal.subscribe(model, {
        input: { image_url: imageUrl, prompt },
      })) as FalImageResult;
    })(),
    FAL_TIMEOUT_MS,
  );

  const url = result.data?.images?.[0]?.url ?? result.data?.image?.url;
  if (!url) throw new Error('fal returned no image');

  const imgRes = await withTimeout(fetch(url), FAL_TIMEOUT_MS);
  if (!imgRes.ok) throw new Error(`image download failed: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fal.ai timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}
