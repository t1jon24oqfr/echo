// Vision captioning — describe a user-sent photo in one vivid emotional sentence.
const BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';

export function visionModel(): string {
  return process.env.VISION_MODEL ?? 'qwen/qwen3-vl-8b-instruct';
}

const CAPTION_PROMPT =
  'Describe this photo in one vivid sentence, focusing on what matters emotionally — who/what is in it, mood, setting.';

/**
 * Caption an image via the vision model (OpenRouter chat with an image_url data URL).
 * Never throws: on missing key or any failure returns "(a photo)" so chat keeps flowing.
 */
export async function captionImage(buf: Buffer, mime: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return '(a photo)';
  try {
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'persona-web',
      },
      body: JSON.stringify({
        model: visionModel(),
        temperature: 0.4,
        max_tokens: 120,
        provider: { data_collection: 'deny' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: CAPTION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`vision ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : '(a photo)';
  } catch (e) {
    console.warn(`[vision] caption failed: ${e instanceof Error ? e.message : String(e)}`);
    return '(a photo)';
  }
}
