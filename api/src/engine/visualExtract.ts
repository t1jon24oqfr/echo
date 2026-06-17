// Per-frame vision extraction: send each downscaled chat frame to the vision
// model (Qwen3-VL by default) with a strict json_schema response_format and read
// back the visible bubbles as structured rows. Reuses the OpenRouter image_url
// data-URL pattern from engine/vision.ts. Read env at call-time.
import { visionModel } from './vision';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';
}

export type RowSide = 'left' | 'right' | 'center';
export type RowKind = 'message' | 'date' | 'system' | 'media';

export interface VisualRow {
  side: RowSide;
  sender?: string;
  text: string;
  time?: string | null;
  kind: RowKind;
}

const SYSTEM_PROMPT = [
  'You read screenshots of a one-on-one messaging chat (Telegram/WhatsApp/iMessage/Viber/Instagram, any language).',
  'Convention: a right-aligned bubble is the person who recorded this screen ("me"); a left-aligned bubble is the OTHER person; centered text is a date separator or a system notice.',
  'Read strictly top to bottom. Transcribe the text of every message bubble VERBATIM, including Cyrillic and emoji — do not translate, summarise, autocorrect, or invent.',
  'Never invent a timestamp: set "time" to null unless a clock time is literally printed next to that bubble. If a sender name label is visible above a left bubble, put it in "sender", otherwise omit it.',
  'For stickers, photos, videos, voice notes or GIFs use kind:"media" with text:"". For a centered date use kind:"date" with the date string in text. For "X joined", "missed call", "message deleted" etc. use kind:"system".',
  'Output ONLY rows you can actually see in THIS image. If the image has no chat at all, return an empty rows array.',
].join(' ');

const JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'chat_frame',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['side', 'text', 'kind', 'time', 'sender'],
            properties: {
              side: { type: 'string', enum: ['left', 'right', 'center'] },
              sender: { type: ['string', 'null'] },
              text: { type: 'string' },
              time: { type: ['string', 'null'] },
              kind: { type: 'string', enum: ['message', 'date', 'system', 'media'] },
            },
          },
        },
      },
    },
  },
} as const;

function coerceRows(parsed: unknown): VisualRow[] {
  const rows = (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  const out: VisualRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const side = o.side === 'right' || o.side === 'center' ? o.side : 'left';
    const kind: RowKind =
      o.kind === 'date' || o.kind === 'system' || o.kind === 'media' ? o.kind : 'message';
    const text = typeof o.text === 'string' ? o.text : '';
    const sender = typeof o.sender === 'string' && o.sender.trim() ? o.sender.trim() : undefined;
    const time = typeof o.time === 'string' && o.time.trim() ? o.time.trim() : null;
    if (kind === 'message' && !text.trim()) continue; // skip empty text bubbles
    out.push({ side: side as RowSide, sender, text, time, kind });
  }
  return out;
}

/**
 * Extract the visible rows from a single downscaled frame. Never throws — on any
 * failure (no key, network, bad JSON) returns [] so one bad frame can't sink the
 * whole import; the merge pass tolerates gaps via scroll overlap.
 */
export async function extractFrame(jpeg: Buffer): Promise<VisualRow[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  try {
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'persona-web',
      },
      body: JSON.stringify({
        model: visionModel(),
        temperature: 0,
        max_tokens: 1500,
        provider: { data_collection: 'deny' },
        response_format: JSON_SCHEMA,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the chat rows from this screenshot as JSON.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`vision ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some providers wrap JSON in prose/fences; grab the outermost object.
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { rows: [] };
    }
    return coerceRows(parsed);
  } catch (e) {
    console.warn(`[visualExtract] frame failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Run extractFrame over all frames with a small concurrency limit (default 4),
 * preserving frame order in the returned rows-per-frame array. onProgress lets
 * the endpoint surface a stage like "extract:reading 12/40".
 */
export async function extractFrames(
  frames: Buffer[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<VisualRow[][]> {
  const concurrency = Math.max(1, opts.concurrency ?? Number(process.env.IMPORT_VLM_CONCURRENCY ?? 4));
  const results: VisualRow[][] = new Array(frames.length);
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= frames.length) return;
      results[i] = await extractFrame(frames[i]);
      done++;
      opts.onProgress?.(done, frames.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, frames.length) }, worker));
  return results;
}
